#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sendManagedLifecycleWorkflowCallback } from "./managed-lifecycle-workflow-callback.mjs";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const LEGACY_SHARED_QUEUES = new Set([
  "me3-assistant-job-events",
  "me3-assistant-job-events-dlq",
  "me3-booking-reminders",
  "me3-booking-reminders-dlq",
  "me3-social-publish",
  "me3-social-publish-dlq",
]);
const QUEUE_DETACH_MAX_ATTEMPTS = 30;
const QUEUE_DETACH_DELAY_MS = 1_000;
export const MANAGED_DECOMMISSION_TOMBSTONE_SOURCE = [
  "export default {",
  "  fetch() { return new Response('Managed ME3 is decommissioning', { status: 410 }); },",
  // Cloudflare can validate a replacement upload against the prior Queue
  // consumer trigger even after the consumer API reports it absent. Keep a
  // fail-closed handler in the transient tombstone: retryAll explicitly avoids
  // acknowledging a late delivery while the binding-free deploy settles.
  "  queue(batch) { batch.retryAll(); },",
  "};",
  "",
].join("\n");
const MANAGED_DECOMMISSION_TOMBSTONE_SHA256 = createHash("sha256")
  .update(normalizeWorkerSource(MANAGED_DECOMMISSION_TOMBSTONE_SOURCE), "utf8")
  .digest("hex");

export function managedDecommissionTombstoneTag(operationId) {
  return `managed-delete-${operationId}`;
}

export function managedDecommissionTombstoneMessage(operationId) {
  return `me3-delete:${operationId}:sha256:${MANAGED_DECOMMISSION_TOMBSTONE_SHA256}`;
}

export async function decommissionManagedInstall(
  input,
  {
    request = globalThis.fetch,
    deployTombstone = deployDurableObjectTombstone,
    reportStage = async () => {},
    pause = delay,
    queueDetachMaxAttempts = QUEUE_DETACH_MAX_ATTEMPTS,
  } = {},
) {
  const contract = validateContract(input);
  validateExportDisposition(input, contract);
  validateR2DeletionPrecondition(input.r2EmptyListing, contract.exportWaived);
  const api = createCloudflareApi(
    { accountId: input.accountId, apiToken: input.apiToken },
    request,
  );

  const presence = await assertExistingResourceIdentities(api, contract);
  if (presence.d1) {
    await assertPersistedRuntimeTermination(api, input.accountId, contract.d1Id);
  } else if (presence.worker) {
    throw new Error("persisted runtime termination proof is unavailable before Worker deletion");
  } else if (presence.r2) {
    // R2 is deleted before Worker and D1 in this workflow. A remaining bucket
    // without the exact D1 purge attestation is therefore not a valid retry
    // state, even when the user waived export retention.
    throw new Error("persisted runtime termination proof is unavailable before R2 deletion");
  }
  // The control-plane callback is the final authorization barrier. A stale or
  // cancelled attempt must be rejected here before the first provider delete.
  await reportStage("deleting_r2");
  await deleteIfPresent(api, `/accounts/${input.accountId}/r2/buckets/${contract.r2Name}`);
  await assertMissing(api, `/accounts/${input.accountId}/r2/buckets/${contract.r2Name}`, "R2 bucket");

  await reportStage("removing_consumers");
  const consumerQueues = await listAllQueues(api, input.accountId);
  for (const queue of consumerQueues) {
    for (const consumer of await listQueueConsumers(api, input.accountId, queue)) {
      if (isWorkerConsumer(consumer, contract.workerName)) {
        await deleteIfPresent(
          api,
          `/accounts/${input.accountId}/queues/${queue.queue_id}/consumers/${consumer.consumer_id}`,
        );
      }
    }
  }
  await waitForManagedQueueConsumersDetached(
    api,
    input.accountId,
    consumerQueues.map((queue) => queue.queue_name),
    contract.workerName,
    { pause, maxAttempts: queueDetachMaxAttempts },
  );

  // Queue producer bindings belong to the Worker deployment, not the Queue
  // consumer records above. Deploy the exact binding-free tombstone before
  // deleting dedicated queues so Cloudflare no longer rejects their deletion.
  // Keep this inside the already-authorized removing_consumers stage so the
  // externally reported lifecycle stages remain strictly monotonic.
  let namespaces = await listDurableObjectNamespaces(api, input.accountId);
  const namespace = namespaces.find((item) => namespaceId(item) === contract.durableObjectNamespaceId);
  const sdkNamespaces = namespaces.filter(
    (item) => item.script === contract.workerName && item.class === "Me3SdkUserAgent",
  );
  if (sdkNamespaces.length > 1) throw new Error("Multiple SDK Durable Object namespaces match the managed install");
  const agentNamespaces = namespaces.filter(
    (item) => item.script === contract.workerName && item.class === "Me3Agent",
  );
  if (agentNamespaces.length > 1) throw new Error("Multiple agent Durable Object namespaces match the managed install");
  const workerHasResourceBindings = presence.worker
    ? await hasManagedWorkerResourceBindings(api, input.accountId, contract.workerName)
    : false;
  if (namespace || sdkNamespaces.length || agentNamespaces.length || workerHasResourceBindings) {
    if (
      namespace &&
      (namespace.script !== contract.workerName || namespace.class !== "Me3UserAgent")
    ) {
      throw new Error("Durable Object namespace identity does not match the managed install");
    }
    await deployTombstone({
      workerName: contract.workerName,
      operationId: contract.operationId,
      deleteDurableObject: Boolean(namespace),
      deleteSdkDurableObject: sdkNamespaces.length === 1,
      deleteAgentDurableObject: agentNamespaces.length === 1,
    });
    namespaces = await listDurableObjectNamespaces(api, input.accountId);
    const deletedNamespaceIds = [contract.durableObjectNamespaceId, ...sdkNamespaces.map(namespaceId), ...agentNamespaces.map(namespaceId)];
    if (namespaces.some((item) => deletedNamespaceIds.includes(namespaceId(item)))) {
      throw new Error("Durable Object namespace deletion was not verified");
    }
  }
  await clearManagedWorkerBindings(api, input.accountId, contract.workerName);
  await detachManagedCustomDomain(api, input.accountId, contract);

  const dedicatedQueueNames = orderedDedicatedQueueNames(
    contract.queueNames,
    contract.workerName,
  );

  // Cloudflare can retain the Queue producer registry until the inert Worker
  // itself is removed, even after its settings no longer contain a Queue
  // binding. Enter the queue-teardown stage, normal-delete the proven inert
  // Worker without force, and keep D1 as the retry anchor.
  await reportStage("deleting_queues");
  await deleteManagedWorkerService(
    api,
    input.accountId,
    contract.workerName,
    dedicatedQueueNames,
    {
      operationId: contract.operationId,
      deployTombstone,
    },
  );
  await assertMissing(
    api,
    `/accounts/${input.accountId}/workers/scripts/${contract.workerName}`,
    "Worker",
  );
  await waitForManagedQueueBindingsDetached(api, input.accountId, dedicatedQueueNames, {
    pause,
    maxAttempts: queueDetachMaxAttempts,
  });

  for (const queueName of dedicatedQueueNames) {
    const queue = await findQueue(api, input.accountId, queueName);
    if (queue) await deleteIfPresent(api, `/accounts/${input.accountId}/queues/${queue.queue_id}`);
  }

  // Preserve the existing monotonic callback contract. At this milestone the
  // Worker was already deleted and verified as part of detaching Queue
  // producers; this callback records that proof before the D1-last boundary.
  await reportStage("deleting_worker");
  await assertMissing(
    api,
    `/accounts/${input.accountId}/workers/scripts/${contract.workerName}`,
    "Worker",
  );

  // D1 contains the persisted revoke/purge proof needed to authorize a safe
  // retry. Keep it until every other provider resource has been re-read as
  // absent, rather than trusting successful DELETE responses alone.
  await assertManagedProviderResourcesAbsent(api, input.accountId, contract);

  await reportStage("deleting_d1");
  await deleteIfPresent(
    api,
    `/accounts/${input.accountId}/d1/database/${contract.d1Id}`,
  );

  await reportStage("verifying_absence");
  await assertManagedProviderResourcesAbsent(api, input.accountId, contract);
  await assertMissing(
    api,
    `/accounts/${input.accountId}/d1/database/${contract.d1Id}`,
    "D1 database",
  );

  return {
    ok: true,
    installationId: contract.installationId,
    operationId: contract.operationId,
    exportWaived: contract.exportWaived,
    resourcesAbsent: {
      worker: true,
      d1: true,
      r2: true,
      durableObjectNamespace: true,
      dedicatedQueues: dedicatedQueueNames,
      legacySharedQueueConsumers: contract.queueNames.filter((name) => LEGACY_SHARED_QUEUES.has(name)),
    },
  };
}

export function validateManagedDecommissionContract(input) {
  return validateContract(input);
}

function validateContract(input) {
  const installationId = String(input.installationId || "").toLowerCase();
  const operationId = String(input.operationId || "").toLowerCase();
  const exportOperationId = String(input.exportOperationId || "").toLowerCase();
  const exportKeyVersion = String(input.exportKeyVersion || "").toLowerCase();
  const exportWaived = parseExportWaived(input.exportWaived);
  const workerName = String(input.workerName || "");
  const d1Name = String(input.d1Name || "");
  const d1Id = String(input.d1Id || "").toLowerCase();
  const r2Name = String(input.r2Name || "");
  const durableObjectNamespaceId = String(input.durableObjectNamespaceId || "").toLowerCase();
  const publicOrigin = normalizeManagedPublicOrigin(input.publicOrigin, workerName);
  let queueNames;
  try {
    queueNames = typeof input.queueNames === "string" ? JSON.parse(input.queueNames) : input.queueNames;
  } catch {
    throw new Error("managed queue manifest is invalid");
  }
  if (
    !/^mi-[0-9a-f]{16}$/.test(installationId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId) ||
    (exportWaived
      ? exportOperationId !== "" || exportKeyVersion !== ""
      : !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(exportOperationId) ||
        operationId === exportOperationId ||
        !/^v[1-9][0-9]{0,8}$/.test(exportKeyVersion)) ||
    workerName !== `me3-${installationId}` ||
    d1Name !== `${workerName}-d1` ||
    r2Name !== `${workerName}-r2` ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d1Id) ||
    !/^[0-9a-f]{32}$/.test(durableObjectNamespaceId) ||
    !Array.isArray(queueNames) ||
    queueNames.length === 0 ||
    new Set(queueNames).size !== queueNames.length ||
    queueNames.some(
      (name) =>
        typeof name !== "string" ||
        (!name.startsWith(`${workerName}-`) && !LEGACY_SHARED_QUEUES.has(name)),
    )
  ) {
    throw new Error("managed decommission resource contract is invalid");
  }
  return {
    installationId,
    operationId,
    exportOperationId,
    exportKeyVersion,
    exportWaived,
    workerName,
    d1Name,
    d1Id,
    r2Name,
    durableObjectNamespaceId,
    queueNames: [...queueNames].sort(),
    publicOrigin,
    customHostname:
      publicOrigin && new URL(publicOrigin).hostname.endsWith(".me3.app")
        ? new URL(publicOrigin).hostname
        : null,
  };
}

function normalizeManagedPublicOrigin(value, workerName) {
  if (value === undefined || value === null || value === "") return null;
  try {
    const url = new URL(String(value));
    if (
      url.protocol !== "https:" ||
      url.origin !== value ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new Error();
    }
    if (
      /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\.me3\.app$/.test(url.hostname) ||
      (url.hostname.startsWith(`${workerName}.`) &&
        url.hostname.endsWith(".workers.dev"))
    ) {
      return url.origin;
    }
  } catch {
    // Fall through to the stable contract error below.
  }
  throw new Error("managed decommission public origin is invalid");
}

function parseExportWaived(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("managed export waiver must be explicitly true or false");
}

function validateExportDisposition(input, contract) {
  if (!contract.exportWaived) {
    validateRetainedExport(input, contract);
    return;
  }

  const exportInputs = [
    input.exportOperationId,
    input.exportKeyVersion,
    input.exportObjectKey,
    input.exportSha256,
    input.exportMd5,
    input.exportEtag,
    input.exportSizeBytes,
    input.exportHead,
  ];
  if (exportInputs.some((value) => value !== undefined && value !== null && value !== "")) {
    throw new Error("retained export inputs must be empty when export is waived");
  }
}

function validateRetainedExport(input, contract) {
  const expectedKey =
    `managed-exports/${contract.installationId}/${contract.exportOperationId}.me3-managed-export-v1.enc`;
  const head = input.exportHead;
  const sha256 = String(input.exportSha256 || "").toLowerCase();
  const md5 = String(input.exportMd5 || "").toLowerCase();
  const etag = String(input.exportEtag || "").replace(/^"|"$/g, "").toLowerCase();
  const sizeBytes = Number(input.exportSizeBytes);
  if (
    input.exportObjectKey !== expectedKey ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    !/^[0-9a-f]{32}$/.test(md5) ||
    etag !== md5 ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    Number(head?.ContentLength) !== sizeBytes ||
    String(head?.ETag || "").replace(/^"|"$/g, "").toLowerCase() !== etag ||
    String(head?.Metadata?.sha256 || "").toLowerCase() !== sha256 ||
    String(head?.Metadata?.md5 || "").toLowerCase() !== md5 ||
    head?.Metadata?.format !== "me3-managed-export-v1" ||
    head?.Metadata?.installation !== contract.installationId ||
    head?.Metadata?.operation !== contract.exportOperationId ||
    head?.Metadata?.keyversion !== contract.exportKeyVersion
  ) {
    throw new Error("verified retained export evidence is required before decommission");
  }
}

function validateR2DeletionPrecondition(listing, exportWaived) {
  // Retained-export decommission independently lists the source bucket with
  // job-scoped S3 credentials. The waived path deliberately has no S3
  // credentials: its proof is the exact D1 runtime purge attestation below,
  // followed by Cloudflare REST bucket deletion and verified absence.
  if (exportWaived && (listing === undefined || listing === null)) return;
  if (
    !listing ||
    listing.IsTruncated === true ||
    listing.NextContinuationToken ||
    (Array.isArray(listing.Contents) && listing.Contents.length > 0) ||
    (!Array.isArray(listing.Contents) && listing.Contents !== undefined)
  ) {
    throw new Error("R2 bucket must be verifiably empty before decommission");
  }
}

async function assertExistingResourceIdentities(api, contract) {
  const worker = await api(
    `/accounts/${api.accountId}/workers/scripts/${contract.workerName}`,
    {},
    { missingOk: true },
  );
  const d1 = await api(
    `/accounts/${api.accountId}/d1/database/${contract.d1Id}`,
    {},
    { missingOk: true },
  );
  if (
    d1 &&
    (String(d1.uuid || d1.id || "").toLowerCase() !== contract.d1Id ||
      String(d1.name || "") !== contract.d1Name)
  ) {
    throw new Error("D1 resource identity does not match the managed install");
  }
  const r2 = await api(
    `/accounts/${api.accountId}/r2/buckets/${contract.r2Name}`,
    {},
    { missingOk: true },
  );
  if (r2 && String(r2.name || contract.r2Name) !== contract.r2Name) {
    throw new Error("R2 resource identity does not match the managed install");
  }
  for (const queueName of contract.queueNames) {
    const queue = await findQueue(api, api.accountId, queueName);
    if (queue) await listQueueConsumers(api, api.accountId, queue);
  }
  const namespaces = await listDurableObjectNamespaces(api, api.accountId);
  const namespace = namespaces.find(
    (item) => namespaceId(item) === contract.durableObjectNamespaceId,
  );
  if (
    namespace &&
    (namespace.script !== contract.workerName || namespace.class !== "Me3UserAgent")
  ) {
    throw new Error("Durable Object namespace identity does not match the managed install");
  }
  return { worker: Boolean(worker), d1: Boolean(d1), r2: Boolean(r2) };
}

async function assertPersistedRuntimeTermination(api, accountId, d1Id) {
  const result = await api(
    `/accounts/${accountId}/d1/database/${d1Id}/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: `SELECT state, credentials_revoked_at, storage_purged_at
              FROM managed_runtime_state
              WHERE id = 'managed'`,
      }),
    },
  );
  const rows = Array.isArray(result)
    ? result.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []))
    : [];
  if (
    rows.length !== 1 ||
    rows[0]?.state !== "suspended" ||
    !rows[0]?.credentials_revoked_at ||
    !rows[0]?.storage_purged_at
  ) {
    throw new Error("persisted runtime termination is required after Worker deletion");
  }
}

function createCloudflareApi({ accountId, apiToken }, request) {
  if (!/^[0-9a-f]{32}$/.test(accountId || "") || !apiToken) {
    throw new Error("Cloudflare decommission credentials are invalid");
  }
  const api = async (path, init = {}, options = {}) => {
    const response = await request(`${API_ROOT}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiToken}`, ...(init.headers || {}) },
    });
    if (response.status === 404 && options.missingOk) return null;
    if (response.ok && options.rawResponse) return response;
    let body = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) body = await response.json();
    if (!response.ok || (body && body.success === false)) {
      const details = summarizeCloudflareApiErrors(body);
      const error = new Error(
        `Cloudflare resource operation failed with status ${response.status}${details}`,
      );
      error.cloudflareStatus = response.status;
      error.cloudflareErrorCodes = cloudflareApiErrorCodes(body);
      throw error;
    }
    if (!body) return { present: true };
    return Object.hasOwn(body, "result") ? body.result : body;
  };
  api.accountId = accountId;
  return api;
}

function cloudflareApiErrorCodes(body) {
  return Array.isArray(body?.errors)
    ? body.errors
        .map((error) => Number(error?.code))
        .filter((code) => Number.isSafeInteger(code))
    : [];
}

function summarizeCloudflareApiErrors(body) {
  const errors = Array.isArray(body?.errors) ? body.errors.slice(0, 3) : [];
  const summaries = errors.map((error) => {
    const code =
      typeof error?.code === "number" || typeof error?.code === "string"
        ? String(error.code)
        : "unknown";
    const message =
      typeof error?.message === "string"
        ? error.message
            .replace(/[^\x20-\x7e]+/g, " ")
            .replace(/(?:bearer\s+)?[A-Za-z0-9_-]{32,}/gi, "[redacted]")
            .trim()
            .slice(0, 300)
        : "unknown";
    return `${code}: ${message}`;
  });
  return summaries.length > 0 ? ` (${summaries.join("; ")})` : "";
}

async function deleteIfPresent(api, path) {
  await api(path, { method: "DELETE" }, { missingOk: true });
}

async function assertMissing(api, path, label) {
  const result = await api(path, {}, { missingOk: true });
  if (result !== null) throw new Error(`${label} absence was not verified`);
}

async function assertManagedProviderResourcesAbsent(api, accountId, contract) {
  await assertMissing(
    api,
    `/accounts/${accountId}/r2/buckets/${contract.r2Name}`,
    "R2 bucket",
  );
  await assertManagedCustomDomainAbsent(api, accountId, contract);
  await assertMissing(
    api,
    `/accounts/${accountId}/workers/scripts/${contract.workerName}`,
    "Worker",
  );
  for (const queueName of contract.queueNames) {
    const queue = await findQueue(api, accountId, queueName);
    if (queueName.startsWith(`${contract.workerName}-`) && queue) {
      throw new Error(`managed queue deletion was not verified: ${queueName}`);
    }
  }
  for (const queue of await listAllQueues(api, accountId)) {
    if (
      (await listQueueConsumers(api, accountId, queue)).some((consumer) =>
        isWorkerConsumer(consumer, contract.workerName),
      )
    ) {
      throw new Error(`managed queue consumer removal was not verified: ${queue.queue_name}`);
    }
  }
  const namespaces = await listDurableObjectNamespaces(api, accountId);
  if (namespaces.some((item) => namespaceId(item) === contract.durableObjectNamespaceId)) {
    throw new Error("Durable Object namespace absence was not verified");
  }
}

export async function detachManagedCustomDomain(api, accountId, contract) {
  if (!contract.customHostname) return;
  const query = new URLSearchParams({ service: contract.workerName });
  const domains = await api(`/accounts/${accountId}/workers/domains?${query}`);
  if (!Array.isArray(domains) || domains.length > 1) {
    throw new Error("managed custom domain identity is ambiguous");
  }
  if (domains.length === 1) {
    const domain = domains[0];
    if (
      String(domain?.hostname || "").toLowerCase() !== contract.customHostname ||
      String(domain?.service || "") !== contract.workerName ||
      !domain?.id
    ) {
      throw new Error("managed custom domain identity does not match the managed install");
    }
    await deleteIfPresent(
      api,
      `/accounts/${accountId}/workers/domains/${encodeURIComponent(domain.id)}`,
    );
  }
  await assertManagedCustomDomainAbsent(api, accountId, contract);
}

async function assertManagedCustomDomainAbsent(api, accountId, contract) {
  if (!contract.customHostname) return;
  const query = new URLSearchParams({ service: contract.workerName });
  const domains = await api(`/accounts/${accountId}/workers/domains?${query}`);
  if (!Array.isArray(domains) || domains.length !== 0) {
    throw new Error("managed custom domain absence was not verified");
  }
}

async function findQueue(api, accountId, name) {
  const query = new URLSearchParams({ name, page: "1", per_page: "100" });
  const queues = await api(`/accounts/${accountId}/queues?${query}`);
  if (!Array.isArray(queues)) throw new Error("Cloudflare queue listing is invalid");
  const matches = queues.filter((queue) => queue?.queue_name === name);
  if (matches.length > 1) throw new Error(`Cloudflare queue identity is ambiguous: ${name}`);
  return matches[0] || null;
}

async function listAllQueues(api, accountId) {
  const queues = [];
  const queueIds = new Set();
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: "100" });
    const result = await api(`/accounts/${accountId}/queues?${query}`);
    if (!Array.isArray(result)) throw new Error("Cloudflare queue listing is invalid");
    for (const queue of result) {
      if (
        typeof queue?.queue_id !== "string" ||
        typeof queue?.queue_name !== "string" ||
        queueIds.has(queue.queue_id)
      ) {
        throw new Error("Cloudflare queue listing is incomplete");
      }
      queueIds.add(queue.queue_id);
      queues.push(queue);
    }
    if (result.length < 100) return queues;
  }
  throw new Error("Cloudflare queue listing exceeded the safe page limit");
}

export async function waitForManagedQueueBindingsDetached(
  api,
  accountId,
  queueNames,
  {
    pause = delay,
    maxAttempts = QUEUE_DETACH_MAX_ATTEMPTS,
  } = {},
) {
  if (
    typeof api !== "function" ||
    !/^[0-9a-f]{32}$/.test(accountId || "") ||
    !Array.isArray(queueNames) ||
    typeof pause !== "function" ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > QUEUE_DETACH_MAX_ATTEMPTS
  ) {
    throw new Error("managed queue detachment proof configuration is invalid");
  }
  for (const queueName of queueNames) {
    let detached = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const queue = await findQueue(api, accountId, queueName);
      if (!queue) {
        detached = true;
        break;
      }
      const consumerCount = Number(queue.consumers_total_count);
      const producerCount = Number(queue.producers_total_count);
      if (
        !Array.isArray(queue.consumers) ||
        !Array.isArray(queue.producers) ||
        !Number.isSafeInteger(consumerCount) ||
        consumerCount < 0 ||
        queue.consumers.length !== consumerCount ||
        !Number.isSafeInteger(producerCount) ||
        producerCount < 0 ||
        queue.producers.length !== producerCount
      ) {
        throw new Error(`Cloudflare queue binding counts are invalid: ${queueName}`);
      }
      if (consumerCount === 0 && producerCount === 0) {
        detached = true;
        break;
      }
      if (attempt < maxAttempts) await pause(QUEUE_DETACH_DELAY_MS);
    }
    if (!detached) {
      throw new Error(`managed queue bindings did not detach: ${queueName}`);
    }
  }
}

export async function waitForManagedQueueConsumersDetached(
  api,
  accountId,
  queueNames,
  workerName,
  {
    pause = delay,
    maxAttempts = QUEUE_DETACH_MAX_ATTEMPTS,
  } = {},
) {
  if (
    typeof api !== "function" ||
    !/^[0-9a-f]{32}$/.test(accountId || "") ||
    !Array.isArray(queueNames) ||
    !workerName ||
    typeof pause !== "function" ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > QUEUE_DETACH_MAX_ATTEMPTS
  ) {
    throw new Error("managed queue consumer detachment proof configuration is invalid");
  }

  for (const queueName of queueNames) {
    let detached = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const queue = await findQueue(api, accountId, queueName);
      if (!queue) {
        detached = true;
        break;
      }
      const consumers = await listQueueConsumers(api, accountId, queue);
      if (!consumers.some((consumer) => isWorkerConsumer(consumer, workerName))) {
        detached = true;
        break;
      }
      if (attempt < maxAttempts) await pause(QUEUE_DETACH_DELAY_MS);
    }
    if (!detached) {
      throw new Error(`managed queue consumer did not detach: ${queueName}`);
    }
  }
}

export async function clearManagedWorkerBindings(api, accountId, workerName) {
  if (
    typeof api !== "function" ||
    !/^[0-9a-f]{32}$/.test(accountId || "") ||
    !workerName
  ) {
    throw new Error("managed Worker binding cleanup configuration is invalid");
  }
  const path = `/accounts/${accountId}/workers/scripts/${workerName}/settings`;
  const before = await api(path, {}, { missingOk: true });
  if (!before) return;
  if (!Array.isArray(before.bindings)) {
    throw new Error("Cloudflare managed Worker binding listing is invalid");
  }
  if (before.bindings.some((binding) => !isRetainedTombstoneBinding(binding))) {
    const body = new FormData();
    body.set("settings", JSON.stringify({ bindings: [] }));
    await api(path, { method: "PATCH", body });
  }
  const after = await api(path, {}, { missingOk: true });
  const retainedBindings = after?.bindings;
  if (
    after &&
    (!Array.isArray(retainedBindings) ||
      retainedBindings.some((binding) => !isRetainedTombstoneBinding(binding)))
  ) {
    throw new Error("managed Worker resource binding removal was not verified");
  }
}

export async function deleteManagedWorkerService(
  api,
  accountId,
  workerName,
  dedicatedQueueNames,
  { operationId, deployTombstone = deployDurableObjectTombstone } = {},
) {
  const servicePath = `/accounts/${accountId}/workers/services/${workerName}`;
  try {
    await deleteIfPresent(api, `${servicePath}?force=false`);
    return;
  } catch (error) {
    if (
      error?.cloudflareStatus !== 403 ||
      !Array.isArray(error?.cloudflareErrorCodes) ||
      error.cloudflareErrorCodes.length !== 1 ||
      error.cloudflareErrorCodes[0] !== 10064
    ) {
      throw error;
    }
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      operationId || "",
    ) ||
    typeof deployTombstone !== "function"
  ) {
    throw new Error("guarded Worker force-delete tombstone configuration is invalid");
  }

  // A normal delete can fail against a stale Queue association even after the
  // visible consumer was removed. Before considering force, deploy a fresh,
  // operation-tagged inert version so the exact immutable version and source
  // can be pinned on both sides of the remaining safety checks.
  await deployTombstone({
    workerName,
    operationId,
    deleteDurableObject: false,
    allowApiUpdatedWorker: true,
  });
  await clearManagedWorkerBindings(api, accountId, workerName);
  const pinnedTombstone = await readManagedTombstoneIdentity(
    api,
    accountId,
    workerName,
    operationId,
  );
  await assertGuardedWorkerForceDeleteSafe(
    api,
    accountId,
    workerName,
    dedicatedQueueNames,
  );
  const confirmedTombstone = await readManagedTombstoneIdentity(
    api,
    accountId,
    workerName,
    operationId,
  );
  if (JSON.stringify(confirmedTombstone) !== JSON.stringify(pinnedTombstone)) {
    throw new Error("guarded Worker force-delete tombstone identity changed during preflight");
  }
  await deleteIfPresent(api, `${servicePath}?force=true`);
}

async function readManagedTombstoneIdentity(
  api,
  accountId,
  workerName,
  operationId,
) {
  const deploymentResult = await api(
    `/accounts/${accountId}/workers/scripts/${workerName}/deployments`,
  );
  const deployments = deploymentResult?.deployments;
  const deployment = Array.isArray(deployments) ? deployments[0] : null;
  if (
    !deployment ||
    typeof deployment.id !== "string" ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length !== 1 ||
    typeof deployment.versions[0]?.version_id !== "string" ||
    Number(deployment.versions[0]?.percentage) !== 100
  ) {
    throw new Error("guarded Worker force-delete deployment evidence is incomplete");
  }

  const versionId = deployment.versions[0].version_id;
  const version = await api(
    `/accounts/${accountId}/workers/scripts/${workerName}/versions/${versionId}`,
  );
  if (
    version?.id !== versionId ||
    version?.annotations?.["workers/tag"] !==
      managedDecommissionTombstoneTag(operationId) ||
    version?.annotations?.["workers/message"] !==
      managedDecommissionTombstoneMessage(operationId) ||
    !Array.isArray(version?.resources?.bindings) ||
    version.resources.bindings.some((binding) => !isRetainedTombstoneBinding(binding))
  ) {
    throw new Error("guarded Worker force-delete requires the exact tagged tombstone version");
  }

  const content = await api(
    `/accounts/${accountId}/workers/scripts/${workerName}/content/v2?version=${encodeURIComponent(versionId)}`,
    {},
    { rawResponse: true },
  );
  const source = await readSingleWorkerEntrypoint(content);
  const sourceSha256 = createHash("sha256")
    .update(normalizeWorkerSource(source), "utf8")
    .digest("hex");
  if (sourceSha256 !== MANAGED_DECOMMISSION_TOMBSTONE_SHA256) {
    throw new Error("guarded Worker force-delete source is not the exact inert tombstone");
  }

  return {
    deploymentId: deployment.id,
    versionId,
    sourceSha256,
  };
}

async function readSingleWorkerEntrypoint(response) {
  if (!(response instanceof Response) || !response.ok) {
    throw new Error("guarded Worker force-delete source evidence is incomplete");
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const entrypoint = response.headers.get("cf-entrypoint");
    const form = await response.formData();
    const executableParts = [...form.entries()].filter(
      ([, part]) =>
        typeof part !== "string" && part.type !== "application/source-map",
    );
    const entrypointPart = entrypoint ? form.get(entrypoint) : null;
    if (
      !entrypoint ||
      typeof entrypointPart === "string" ||
      !entrypointPart ||
      executableParts.length !== 1 ||
      executableParts[0][0] !== entrypoint
    ) {
      throw new Error("guarded Worker force-delete source contains unexpected modules");
    }
    return entrypointPart.text();
  }
  if (!/(?:java|ecma)script/i.test(contentType)) {
    throw new Error("guarded Worker force-delete source content type is invalid");
  }
  return response.text();
}

function normalizeWorkerSource(source) {
  if (typeof source !== "string") return "";
  return `${source.replace(/\r\n?/g, "\n").replace(/\n?$/, "")}\n`;
}

async function assertGuardedWorkerForceDeleteSafe(
  api,
  accountId,
  workerName,
  dedicatedQueueNames,
) {
  if (
    typeof api !== "function" ||
    !/^[0-9a-f]{32}$/.test(accountId || "") ||
    !workerName ||
    !Array.isArray(dedicatedQueueNames) ||
    dedicatedQueueNames.some(
      (queueName) =>
        typeof queueName !== "string" || !queueName.startsWith(`${workerName}-`),
    )
  ) {
    throw new Error("guarded Worker force-delete configuration is invalid");
  }

  const settings = await api(
    `/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    {},
    { missingOk: true },
  );
  if (
    !settings ||
    !Array.isArray(settings.bindings) ||
    settings.bindings.some((binding) => !isRetainedTombstoneBinding(binding))
  ) {
    throw new Error("guarded Worker force-delete requires a binding-free tombstone");
  }

  const allowedProducerQueues = new Set(dedicatedQueueNames);
  const queues = await listAllQueues(api, accountId);
  const eventSubscriptions = await listQueueEventSubscriptions(api, accountId);
  for (const queue of queues) {
    const consumers = await listQueueConsumers(api, accountId, queue);
    if (consumers.some((consumer) => !isRecognizedQueueConsumer(consumer))) {
      throw new Error("guarded Worker force-delete Queue consumer evidence is incomplete");
    }
    if (consumers.some((consumer) => isWorkerConsumer(consumer, workerName))) {
      throw new Error("guarded Worker force-delete requires every Queue consumer detached");
    }

    const producerCount = Number(queue.producers_total_count);
    if (
      !Array.isArray(queue.producers) ||
      !Number.isSafeInteger(producerCount) ||
      producerCount < 0 ||
      queue.producers.length !== producerCount ||
      queue.producers.some((producer) => !isRecognizedQueueProducer(producer))
    ) {
      throw new Error("guarded Worker force-delete Queue producer evidence is incomplete");
    }
    if (
      queue.producers.some(
        (producer) =>
          isWorkerQueueProducer(producer) &&
          producer.script === workerName &&
          !allowedProducerQueues.has(queue.queue_name),
      )
    ) {
      throw new Error("guarded Worker force-delete found a producer outside owned Queues");
    }

    if (allowedProducerQueues.has(queue.queue_name)) {
      if (
        eventSubscriptions.some(
          (subscription) => subscription.destination.queue_id === queue.queue_id,
        )
      ) {
        throw new Error("guarded Worker force-delete found an event subscription");
      }
    }
  }

  const namespaces = await listDurableObjectNamespaces(api, accountId);
  if (namespaces.some((namespace) => namespace?.script === workerName)) {
    throw new Error("guarded Worker force-delete requires every Durable Object namespace absent");
  }

  const references = await api(
    `/accounts/${accountId}/workers/scripts/${workerName}/references`,
  );
  const referenceKeys = references && typeof references === "object"
    ? Object.keys(references)
    : [];
  const servicesPresent = Object.hasOwn(references || {}, "services");
  const durableObjectsPresent = Object.hasOwn(
    references || {},
    "durable_objects",
  );
  const dispatchOutboundsPresent = Object.hasOwn(
    references || {},
    "dispatch_outbounds",
  );
  const serviceKeys = references?.services && typeof references.services === "object"
    ? Object.keys(references.services)
    : [];
  const incomingServices = references?.services?.incoming ?? [];
  const outgoingServices = references?.services?.outgoing ?? [];
  const durableObjectReferences = references?.durable_objects ?? [];
  const dispatchOutbounds = references?.dispatch_outbounds ?? [];
  if (
    !references ||
    typeof references !== "object" ||
    Array.isArray(references) ||
    referenceKeys.some(
      (key) => !["services", "durable_objects", "dispatch_outbounds"].includes(key),
    ) ||
    (servicesPresent &&
      (!references.services || typeof references.services !== "object")) ||
    serviceKeys.some(
      (key) => !["incoming", "outgoing", "pages_function"].includes(key),
    ) ||
    (serviceKeys.includes("incoming") &&
      !Array.isArray(references.services.incoming)) ||
    (serviceKeys.includes("outgoing") &&
      !Array.isArray(references.services.outgoing)) ||
    (durableObjectsPresent && !Array.isArray(references.durable_objects)) ||
    (dispatchOutboundsPresent && !Array.isArray(references.dispatch_outbounds)) ||
    !Array.isArray(incomingServices) ||
    !Array.isArray(outgoingServices) ||
    !Array.isArray(durableObjectReferences) ||
    !Array.isArray(dispatchOutbounds) ||
    (references.services?.pages_function !== undefined &&
      typeof references.services.pages_function !== "boolean") ||
    durableObjectReferences.some(
      (reference) => typeof reference?.service !== "string",
    )
  ) {
    throw new Error("guarded Worker force-delete dependency evidence is incomplete");
  }
  if (
    incomingServices.length > 0 ||
    outgoingServices.length > 0 ||
    references.services?.pages_function === true ||
    durableObjectReferences.some((reference) => reference?.service !== workerName) ||
    dispatchOutbounds.length > 0
  ) {
    throw new Error("guarded Worker force-delete found an external dependency");
  }

  const tailProducers = await api(
    `/accounts/${accountId}/workers/tails/by-consumer/${workerName}`,
  );
  if (!Array.isArray(tailProducers)) {
    throw new Error("guarded Worker force-delete tail evidence is incomplete");
  }
  if (tailProducers.length > 0) {
    throw new Error("guarded Worker force-delete found a tail dependency");
  }
}

function isWorkerQueueProducer(producer) {
  const hasScript = typeof producer?.script === "string" && producer.script.length > 0;
  const hasBucket =
    typeof producer?.bucket_name === "string" && producer.bucket_name.length > 0;
  return (
    producer &&
    typeof producer === "object" &&
    hasScript &&
    !hasBucket &&
    (producer.type === undefined || producer.type === "worker") &&
    Object.keys(producer).every((key) =>
      ["script", "type"].includes(key),
    )
  );
}

function isRecognizedQueueProducer(producer) {
  if (isWorkerQueueProducer(producer)) return true;
  const hasScript = typeof producer?.script === "string" && producer.script.length > 0;
  const hasBucket =
    typeof producer?.bucket_name === "string" && producer.bucket_name.length > 0;
  return (
    producer &&
    typeof producer === "object" &&
    hasBucket &&
    !hasScript &&
    (producer.type === undefined || producer.type === "r2_bucket") &&
    Object.keys(producer).every((key) =>
      ["bucket_name", "type"].includes(key),
    )
  );
}

function isRecognizedQueueConsumer(consumer) {
  if (
    !consumer ||
    typeof consumer !== "object" ||
    typeof consumer.consumer_id !== "string" ||
    consumer.consumer_id.length === 0
  ) {
    return false;
  }
  const identityKeys = ["script", "service", "script_name"];
  if (consumer.type === "http_pull") {
    return identityKeys.every((key) => !Object.hasOwn(consumer, key));
  }
  return queueWorkerConsumerName(consumer) !== null;
}

async function listQueueEventSubscriptions(api, accountId) {
  const subscriptions = [];
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({
      page: String(page),
      per_page: "100",
    });
    const result = await api(
      `/accounts/${accountId}/event_subscriptions/subscriptions?${query}`,
    );
    if (!Array.isArray(result)) {
      throw new Error("guarded Worker force-delete event subscription evidence is incomplete");
    }
    for (const subscription of result) {
      if (
        typeof subscription?.id !== "string" ||
        subscription?.destination?.type !== "queues.queue" ||
        typeof subscription.destination.queue_id !== "string" ||
        subscription.destination.queue_id.length === 0
      ) {
        throw new Error("guarded Worker force-delete event subscription evidence is invalid");
      }
      subscriptions.push(subscription);
    }
    if (result.length < 100) return subscriptions;
  }
  throw new Error("guarded Worker force-delete event subscriptions exceeded the safe page limit");
}

async function hasManagedWorkerResourceBindings(api, accountId, workerName) {
  const settings = await api(
    `/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    {},
    { missingOk: true },
  );
  if (!settings) return false;
  if (!Array.isArray(settings.bindings)) {
    throw new Error("Cloudflare managed Worker binding listing is invalid");
  }
  return settings.bindings.some((binding) => !isRetainedTombstoneBinding(binding));
}

function isRetainedTombstoneBinding(binding) {
  return binding?.type === "secret_text" || binding?.type === "version_metadata";
}

export function orderedDedicatedQueueNames(queueNames, workerName) {
  return queueNames
    .filter((name) => name.startsWith(`${workerName}-`))
    .sort(
      (left, right) =>
        Number(left.endsWith("-dlq")) - Number(right.endsWith("-dlq")) ||
        left.localeCompare(right),
    );
}

async function listQueueConsumers(api, accountId, queue) {
  if (!queue?.queue_id) throw new Error("Cloudflare queue id is invalid");
  const consumers = await api(
    `/accounts/${accountId}/queues/${queue.queue_id}/consumers`,
  );
  if (!Array.isArray(consumers)) throw new Error("Cloudflare queue consumer listing is invalid");
  // Cloudflare exposes this endpoint as a single page. Require its length to
  // match the Queue summary before treating an exact Worker consumer as absent.
  const expectedCount = Number(queue.consumers_total_count);
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0 ||
    consumers.length !== expectedCount
  ) {
    const scope = LEGACY_SHARED_QUEUES.has(queue.queue_name) ? "shared" : "dedicated";
    throw new Error(`Cloudflare ${scope} queue consumer listing is incomplete`);
  }
  if (consumers.some((consumer) => !isRecognizedQueueConsumer(consumer))) {
    throw new Error("Cloudflare queue consumer identity evidence is incomplete");
  }
  return consumers;
}

function isWorkerConsumer(consumer, workerName) {
  return queueWorkerConsumerName(consumer) === workerName;
}

function queueWorkerConsumerName(consumer) {
  if (
    !consumer ||
    typeof consumer !== "object" ||
    (consumer.type !== undefined && consumer.type !== "worker")
  ) {
    return null;
  }
  const names = ["script", "service", "script_name"]
    .filter((key) => Object.hasOwn(consumer, key))
    .map((key) => consumer[key]);
  return (
    names.length > 0 &&
    names.every((name) => typeof name === "string" && name.length > 0) &&
    new Set(names).size === 1
  )
    ? names[0]
    : null;
}

async function listDurableObjectNamespaces(api, accountId) {
  const namespaces = [];
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: "100" });
    const result = await api(`/accounts/${accountId}/workers/durable_objects/namespaces?${query}`);
    if (!Array.isArray(result)) throw new Error("Cloudflare Durable Object listing is invalid");
    namespaces.push(...result);
    if (result.length < 100) return namespaces;
  }
  throw new Error("Cloudflare Durable Object listing exceeded the safe page limit");
}

function namespaceId(namespace) {
  return String(namespace?.id || namespace?.namespace_id || "").toLowerCase();
}

export function deployDurableObjectTombstone({
  workerName,
  operationId,
  deleteDurableObject = true,
  deleteSdkDurableObject = false,
  deleteAgentDurableObject = false,
  allowApiUpdatedWorker = false,
}) {
  const root = mkdtempSync(join(tmpdir(), "me3-managed-do-delete-"));
  const configPath = join(root, "wrangler.toml");
  try {
    writeFileSync(
      join(root, "tombstone.mjs"),
      MANAGED_DECOMMISSION_TOMBSTONE_SOURCE,
      { mode: 0o600 },
    );
    const config = [
      `name = "${workerName}"`,
      'main = "tombstone.mjs"',
      'compatibility_date = "2026-06-24"',
      "workers_dev = false",
      ...(deleteDurableObject || deleteSdkDurableObject || deleteAgentDurableObject
        ? [
            "[[migrations]]",
            `tag = "managed-delete-${operationId}"`,
            `deleted_classes = [${[
              ...(deleteDurableObject ? ['"Me3UserAgent"'] : []),
              ...(deleteSdkDurableObject ? ['"Me3SdkUserAgent"'] : []),
              ...(deleteAgentDurableObject ? ['"Me3Agent"'] : []),
            ].join(", ")}]`,
          ]
        : []),
      "",
    ];
    writeFileSync(configPath, config.join("\n"), { mode: 0o600 });
    const result = spawnSync(
      "pnpm",
      managedDecommissionTombstoneDeployArgs(configPath, operationId, {
        strict: !allowApiUpdatedWorker,
      }),
      {
        encoding: "utf8",
        cwd: process.env.ME3_MANAGED_SOURCE_DIR || process.cwd(),
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `Durable Object delete migration failed: ${summarizeManagedCommandFailure(result)}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function managedDecommissionTombstoneDeployArgs(
  configPath,
  operationId,
  { strict = true } = {},
) {
  return [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    configPath,
    ...(strict ? ["--strict"] : []),
    "--no-bundle",
    "--tag",
    managedDecommissionTombstoneTag(operationId),
    "--message",
    managedDecommissionTombstoneMessage(operationId),
  ];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function summarizeManagedCommandFailure(result) {
  let output = [result?.error?.message, result?.stdout, result?.stderr]
    .filter(Boolean)
    .join("\n")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim();

  for (const [name, value] of Object.entries(process.env)) {
    if (
      /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY)/i.test(name) &&
      typeof value === "string" &&
      value.length >= 8
    ) {
      output = output.split(value).join("[redacted]");
    }
  }

  output = output
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(api[_ -]?token\s*[=:]\s*)[^\s]+/gi, "$1[redacted]");

  if (!output) {
    return `exit status ${String(result?.status ?? "unknown")}`;
  }
  return output.slice(-3_000);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--") || !values[index + 1]) throw new Error("invalid argument");
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const exportHeadPath = args["export-head"];
  const r2EmptyListingPath = args["r2-empty-listing"];
  const result = await decommissionManagedInstall(
    {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      installationId: args["installation-id"],
      operationId: args["operation-id"],
      exportWaived: args["export-waived"],
      exportOperationId: args["export-operation-id"],
      exportKeyVersion: args["export-key-version"],
      workerName: args["worker-name"],
      d1Name: args["d1-name"],
      d1Id: args["d1-id"],
      r2Name: args["r2-name"],
      queueNames: args["queue-names"],
      durableObjectNamespaceId: args["durable-object-namespace-id"],
      publicOrigin: args["public-origin"],
      exportObjectKey: args["export-object-key"],
      exportSha256: args["export-sha256"],
      exportMd5: args["export-md5"],
      exportEtag: args["export-etag"],
      exportSizeBytes: args["export-size-bytes"],
      exportHead:
        exportHeadPath && args["export-waived"] !== "true"
          ? JSON.parse(readFileSync(exportHeadPath, "utf8"))
          : exportHeadPath,
      r2EmptyListing: r2EmptyListingPath
        ? JSON.parse(readFileSync(r2EmptyListingPath, "utf8"))
        : undefined,
    },
    {
      reportStage: async (stage) => {
        if (process.env.GITHUB_ENV) {
          appendFileSync(process.env.GITHUB_ENV, `ME3_MANAGED_FAILURE_STAGE=${stage}\n`);
        }
        await sendManagedLifecycleWorkflowCallback({
          ...process.env,
          ME3_MANAGED_STATUS: "running",
          ME3_MANAGED_STAGE: stage,
        });
      },
    },
  );
  console.log(JSON.stringify(result));
}

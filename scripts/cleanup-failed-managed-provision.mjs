#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  clearManagedWorkerBindings,
  deleteManagedWorkerService,
  deployDurableObjectTombstone,
  orderedDedicatedQueueNames,
  waitForManagedQueueBindingsDetached,
  waitForManagedQueueConsumersDetached,
} from "./decommission-managed-install.mjs";
import { listR2Objects } from "./list-r2-s3.mjs";
import { sendManagedLifecycleWorkflowCallback } from "./managed-lifecycle-workflow-callback.mjs";

const API_ROOT = "https://api.cloudflare.com/client/v4";

export async function cleanupFailedManagedProvision(
  input,
  {
    request = globalThis.fetch,
    emptyR2 = emptyManagedR2,
    deployTombstone = deployDurableObjectTombstone,
    reportStage = async () => {},
    pause,
    queueDetachMaxAttempts,
  } = {},
) {
  const contract = validateContract(input);
  const api = createCloudflareApi(input.accountId, input.apiToken, request);

  const before = await inspectResources(api, input.accountId, contract);
  await assertWorkerHasNoPublicExposure(
    api,
    input.accountId,
    contract.workerName,
    before.worker,
  );

  // This current-attempt callback is the one-shot control-plane authorization.
  // It must reject if the installation was activated, ever public, or superseded.
  await reportStage("deleting_failed_provision");
  await assertWorkerHasNoPublicExposure(
    api,
    input.accountId,
    contract.workerName,
    before.worker,
  );

  await emptyR2({
    accountId: input.accountId,
    r2Name: contract.r2Name,
  });
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
    {
      ...(pause ? { pause } : {}),
      ...(queueDetachMaxAttempts ? { maxAttempts: queueDetachMaxAttempts } : {}),
    },
  );

  // Producer bindings are part of the Worker deployment and survive Queue
  // consumer deletion. Replace the never-public Worker with the exact
  // binding-free tombstone before deleting its dedicated queues. This remains
  // within the forward-only removing_consumers callback stage.
  let namespaces = await listDurableObjectNamespaces(api, input.accountId);
  const namespace = namespaces.find(
    (item) => namespaceId(item) === contract.durableObjectNamespaceId,
  );
  const sdkNamespaces = namespaces.filter(
    (item) => item.script === contract.workerName && item.class === "Me3SdkUserAgent",
  );
  if (sdkNamespaces.length > 1) throw new Error("Multiple SDK Durable Object namespaces match the failed provision");
  const agentNamespaces = namespaces.filter(
    (item) => item.script === contract.workerName && item.class === "Me3Agent",
  );
  if (agentNamespaces.length > 1) throw new Error("Multiple agent Durable Object namespaces match the failed provision");
  const workerHasResourceBindings = before.worker
    ? await hasWorkerResourceBindings(api, input.accountId, contract.workerName)
    : false;
  if (namespace || sdkNamespaces.length || agentNamespaces.length || workerHasResourceBindings) {
    if (namespace) assertNamespaceIdentity(namespace, contract);
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
      throw new Error("failed provision Durable Object namespace deletion was not verified");
    }
  }
  await clearManagedWorkerBindings(api, input.accountId, contract.workerName);

  const dedicatedQueueNames = orderedDedicatedQueueNames(
    contract.queueNames,
    contract.workerName,
  );

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
    ...(pause ? { pause } : {}),
    ...(queueDetachMaxAttempts ? { maxAttempts: queueDetachMaxAttempts } : {}),
  });

  for (const queueName of dedicatedQueueNames) {
    const queue = await findQueue(api, input.accountId, queueName);
    if (queue) await deleteIfPresent(api, `/accounts/${input.accountId}/queues/${queue.queue_id}`);
  }

  await reportStage("deleting_worker");
  await assertMissing(
    api,
    `/accounts/${input.accountId}/workers/scripts/${contract.workerName}`,
    "Worker",
  );

  // Retain D1 until every other exact resource has been re-read as absent so
  // an acknowledged-but-incomplete provider deletion remains retryable.
  await assertFailedProvisionProviderResourcesAbsent(
    api,
    input.accountId,
    contract,
  );

  await reportStage("deleting_d1");
  await deleteIfPresent(
    api,
    `/accounts/${input.accountId}/d1/database/${contract.d1Id}`,
  );

  await reportStage("verifying_absence");
  await assertFailedProvisionProviderResourcesAbsent(
    api,
    input.accountId,
    contract,
  );
  await assertMissing(
    api,
    `/accounts/${input.accountId}/d1/database/${contract.d1Id}`,
    "D1 database",
  );

  return {
    ok: true,
    installationId: contract.installationId,
    operationId: contract.operationId,
    resourcesAbsent: true,
  };
}

function validateContract(input) {
  const installationId = String(input.installationId || "").toLowerCase();
  const operationId = String(input.operationId || "").toLowerCase();
  const workerName = String(input.workerName || "");
  const d1Name = String(input.d1Name || "");
  const d1Id = String(input.d1Id || "").toLowerCase();
  const r2Name = String(input.r2Name || "");
  const durableObjectNamespaceId = String(input.durableObjectNamespaceId || "").toLowerCase();
  const workerEverPublic =
    input.workerEverPublic === false || input.workerEverPublic === "false" ? false : true;
  let queueNames;
  try {
    queueNames = typeof input.queueNames === "string" ? JSON.parse(input.queueNames) : input.queueNames;
  } catch {
    throw new Error("failed managed provision cleanup contract is invalid");
  }
  if (
    !/^mi-[0-9a-f]{16}$/.test(installationId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId) ||
    workerName !== `me3-${installationId}` ||
    d1Name !== `${workerName}-d1` ||
    r2Name !== `${workerName}-r2` ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d1Id) ||
    !/^[0-9a-f]{32}$/.test(durableObjectNamespaceId) ||
    workerEverPublic ||
    !Array.isArray(queueNames) ||
    queueNames.length === 0 ||
    new Set(queueNames).size !== queueNames.length ||
    queueNames.some(
      (name) =>
        typeof name !== "string" ||
        !name.startsWith(`${workerName}-`) ||
        !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name),
    )
  ) {
    throw new Error("failed managed provision cleanup contract is invalid");
  }
  return {
    installationId,
    operationId,
    workerName,
    d1Name,
    d1Id,
    r2Name,
    queueNames: [...queueNames].sort(),
    durableObjectNamespaceId,
  };
}

async function inspectResources(api, accountId, contract) {
  const worker = await api(
    `/accounts/${accountId}/workers/scripts/${contract.workerName}`,
    {},
    { missingOk: true },
  );
  const d1 = await api(
    `/accounts/${accountId}/d1/database/${contract.d1Id}`,
    {},
    { missingOk: true },
  );
  if (
    d1 &&
    (String(d1.uuid || d1.id || "").toLowerCase() !== contract.d1Id ||
      d1.name !== contract.d1Name)
  ) {
    throw new Error("failed provision D1 identity does not match");
  }
  const d1Query = new URLSearchParams({
    name: contract.d1Name,
    page: "1",
    per_page: "100",
  });
  const namedDatabases = await api(`/accounts/${accountId}/d1/database?${d1Query}`);
  if (
    !Array.isArray(namedDatabases) ||
    namedDatabases.filter((database) => database?.name === contract.d1Name).some(
      (database) =>
        String(database?.uuid || database?.id || "").toLowerCase() !== contract.d1Id,
    )
  ) {
    throw new Error("failed provision D1 identity does not match");
  }
  const r2 = await api(
    `/accounts/${accountId}/r2/buckets/${contract.r2Name}`,
    {},
    { missingOk: true },
  );
  if (r2 && String(r2.name || contract.r2Name) !== contract.r2Name) {
    throw new Error("failed provision R2 identity does not match");
  }

  const queues = [];
  for (const queueName of contract.queueNames) {
    const queue = await findQueue(api, accountId, queueName);
    if (!queue) continue;
    const consumers = await listQueueConsumers(api, accountId, queue);
    if (consumers.some((consumer) => !isWorkerConsumer(consumer, contract.workerName))) {
      throw new Error(`failed provision queue consumer identity does not match: ${queueName}`);
    }
    queues.push({ ...queue, consumers });
  }

  const namespaces = await listDurableObjectNamespaces(api, accountId);
  const managedNamespaces = namespaces.filter(
    (namespace) =>
      namespace?.script === contract.workerName && namespace?.class === "Me3UserAgent",
  );
  if (
    managedNamespaces.some(
      (namespace) => namespaceId(namespace) !== contract.durableObjectNamespaceId,
    )
  ) {
    throw new Error("failed provision Durable Object namespace identity does not match");
  }
  const namespace = namespaces.find(
    (item) => namespaceId(item) === contract.durableObjectNamespaceId,
  );
  if (namespace) assertNamespaceIdentity(namespace, contract);
  return { worker: Boolean(worker), d1: Boolean(d1), r2: Boolean(r2), queues };
}

async function assertWorkerHasNoPublicExposure(
  api,
  accountId,
  workerName,
  workerPresent,
) {
  if (workerPresent) {
    const state = await api(
      `/accounts/${accountId}/workers/scripts/${workerName}/subdomain`,
    );
    if (
      !state ||
      state.enabled !== false ||
      state.previews_enabled !== false
    ) {
      throw new Error("failed provision Worker has or had a public route");
    }
  }

  // The account-level Worker listing includes every zone route attached to a
  // script, avoiding a weaker check that only knows about workers.dev.
  const workers = await api(`/accounts/${accountId}/workers/scripts`);
  if (!Array.isArray(workers)) {
    throw new Error("failed provision Worker route listing is invalid");
  }
  const matchingWorkers = workers.filter((worker) => worker?.id === workerName);
  if (
    matchingWorkers.length !== (workerPresent ? 1 : 0) ||
    matchingWorkers.some((worker) => !Array.isArray(worker.routes))
  ) {
    throw new Error("failed provision Worker route listing is incomplete");
  }
  if (matchingWorkers.some((worker) => worker.routes.length > 0)) {
    throw new Error("failed provision Worker has or had a public route");
  }

  const domainQuery = new URLSearchParams({
    service: workerName,
    page: "1",
    per_page: "100",
  });
  const domains = await api(
    `/accounts/${accountId}/workers/domains?${domainQuery}`,
  );
  if (
    !Array.isArray(domains) ||
    domains.some((domain) => typeof domain?.service !== "string")
  ) {
    throw new Error("failed provision Worker custom-domain listing is invalid");
  }
  if (domains.some((domain) => domain.service === workerName)) {
    throw new Error("failed provision Worker has or had a public route");
  }
}

function assertNamespaceIdentity(namespace, contract) {
  if (
    namespace?.script !== contract.workerName ||
    namespace?.class !== "Me3UserAgent"
  ) {
    throw new Error("failed provision Durable Object namespace identity does not match");
  }
}

function createCloudflareApi(accountId, apiToken, request) {
  if (!/^[0-9a-f]{32}$/.test(accountId || "") || !apiToken) {
    throw new Error("Cloudflare failed provision cleanup credentials are invalid");
  }
  return async (
    path,
    init = {},
    { missingOk = false, rawResponse = false } = {},
  ) => {
    const response = await request(`${API_ROOT}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiToken}`, ...(init.headers || {}) },
    });
    if (response.status === 404 && missingOk) return null;
    if (response.ok && rawResponse) return response;
    let body = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) body = await response.json();
    if (!response.ok || body?.success === false) {
      const details = summarizeCloudflareApiErrors(body);
      const error = new Error(
        `Cloudflare failed provision cleanup failed with status ${response.status}${details}`,
      );
      error.cloudflareStatus = response.status;
      error.cloudflareErrorCodes = cloudflareApiErrorCodes(body);
      throw error;
    }
    if (!body) return { present: true };
    return Object.hasOwn(body, "result") ? body.result : body;
  };
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

async function findQueue(api, accountId, name) {
  const query = new URLSearchParams({ name, page: "1", per_page: "100" });
  const queues = await api(`/accounts/${accountId}/queues?${query}`);
  if (!Array.isArray(queues)) throw new Error("failed provision queue listing is invalid");
  const matches = queues.filter((queue) => queue?.queue_name === name);
  if (matches.length > 1) throw new Error(`failed provision queue identity is ambiguous: ${name}`);
  return matches[0] || null;
}

async function listAllQueues(api, accountId) {
  const queues = [];
  const queueIds = new Set();
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: "100" });
    const result = await api(`/accounts/${accountId}/queues?${query}`);
    if (!Array.isArray(result)) {
      throw new Error("failed provision queue listing is invalid");
    }
    for (const queue of result) {
      if (
        typeof queue?.queue_id !== "string" ||
        typeof queue?.queue_name !== "string" ||
        queueIds.has(queue.queue_id)
      ) {
        throw new Error("failed provision queue listing is incomplete");
      }
      queueIds.add(queue.queue_id);
      queues.push(queue);
    }
    if (result.length < 100) return queues;
  }
  throw new Error("failed provision queue listing exceeded the safe page limit");
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

function isRecognizedQueueConsumer(consumer) {
  if (
    !consumer ||
    typeof consumer !== "object" ||
    typeof consumer.consumer_id !== "string" ||
    consumer.consumer_id.length === 0
  ) {
    return false;
  }
  if (consumer.type === "http_pull") {
    return ["script", "service", "script_name"].every(
      (key) => !Object.hasOwn(consumer, key),
    );
  }
  return queueWorkerConsumerName(consumer) !== null;
}

async function listQueueConsumers(api, accountId, queue) {
  if (!queue?.queue_id) throw new Error("failed provision queue id is invalid");
  const consumers = await api(
    `/accounts/${accountId}/queues/${queue.queue_id}/consumers`,
  );
  const expectedCount = Number(queue.consumers_total_count);
  if (
    !Array.isArray(consumers) ||
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0 ||
    consumers.length !== expectedCount
  ) {
    throw new Error("failed provision queue consumer listing is incomplete");
  }
  if (consumers.some((consumer) => !isRecognizedQueueConsumer(consumer))) {
    throw new Error("failed provision queue consumer identity evidence is incomplete");
  }
  return consumers;
}

async function listDurableObjectNamespaces(api, accountId) {
  const namespaces = [];
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: "100" });
    const result = await api(
      `/accounts/${accountId}/workers/durable_objects/namespaces?${query}`,
    );
    if (!Array.isArray(result)) {
      throw new Error("failed provision Durable Object listing is invalid");
    }
    namespaces.push(...result);
    if (result.length < 100) return namespaces;
  }
  throw new Error("failed provision Durable Object listing exceeded the safe page limit");
}

function namespaceId(namespace) {
  return String(namespace?.id || namespace?.namespace_id || "").toLowerCase();
}

async function deleteIfPresent(api, path) {
  await api(path, { method: "DELETE" }, { missingOk: true });
}

async function assertMissing(api, path, label) {
  const result = await api(path, {}, { missingOk: true });
  if (result !== null) throw new Error(`${label} absence was not verified`);
}

async function hasWorkerResourceBindings(api, accountId, workerName) {
  const settings = await api(
    `/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    {},
    { missingOk: true },
  );
  if (!settings) return false;
  if (!Array.isArray(settings.bindings)) {
    throw new Error("failed provision Worker binding listing is invalid");
  }
  return settings.bindings.some(
    (binding) =>
      binding?.type !== "secret_text" && binding?.type !== "version_metadata",
  );
}

async function assertFailedProvisionProviderResourcesAbsent(api, accountId, contract) {
  await assertMissing(
    api,
    `/accounts/${accountId}/r2/buckets/${contract.r2Name}`,
    "R2 bucket",
  );
  await assertMissing(
    api,
    `/accounts/${accountId}/workers/scripts/${contract.workerName}`,
    "Worker",
  );
  for (const queueName of contract.queueNames) {
    if (await findQueue(api, accountId, queueName)) {
      throw new Error(`failed provision queue deletion was not verified: ${queueName}`);
    }
  }
  for (const queue of await listAllQueues(api, accountId)) {
    if (
      (await listQueueConsumers(api, accountId, queue)).some((consumer) =>
        isWorkerConsumer(consumer, contract.workerName),
      )
    ) {
      throw new Error(
        `failed provision queue consumer removal was not verified: ${queue.queue_name}`,
      );
    }
  }
  const namespaces = await listDurableObjectNamespaces(api, accountId);
  if (namespaces.some((item) => namespaceId(item) === contract.durableObjectNamespaceId)) {
    throw new Error("failed provision Durable Object namespace absence was not verified");
  }
}

function emptyManagedR2({ accountId, r2Name }) {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const removed = spawnSync(
    "aws",
    [
      "s3",
      "rm",
      `s3://${r2Name}`,
      "--recursive",
      "--endpoint-url",
      endpoint,
      "--only-show-errors",
    ],
    { encoding: "utf8" },
  );
  if (removed.status !== 0 && !/NoSuchBucket|404/i.test(`${removed.stdout}\n${removed.stderr}`)) {
    throw new Error("failed provision R2 object cleanup failed");
  }
  const listing = listR2Objects({ endpoint, bucket: r2Name, allowMissing: true });
  if (listing.Contents.length > 0) {
    throw new Error("failed provision R2 object cleanup was not verified");
  }
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
  const result = await cleanupFailedManagedProvision(
    {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      installationId: args["installation-id"],
      operationId: args["operation-id"],
      workerEverPublic: args["worker-ever-public"],
      workerName: args["worker-name"],
      d1Name: args["d1-name"],
      d1Id: args["d1-id"],
      r2Name: args["r2-name"],
      queueNames: args["queue-names"],
      durableObjectNamespaceId: args["durable-object-namespace-id"],
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

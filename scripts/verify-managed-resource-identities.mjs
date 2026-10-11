#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { managedQueueNamesForRelease } from "./managed-resource-manifest.mjs";

const API_ROOT = "https://api.cloudflare.com/client/v4";

export async function verifyManagedResourceIdentities(
  input,
  request = globalThis.fetch,
) {
  const manifest = normalizeManifest(input);
  const api = createApi(input.accountId, input.apiToken, request);

  const worker = await api(`/accounts/${input.accountId}/workers/scripts/${manifest.workerName}`, {
    raw: true,
  });
  if (!worker) throw new Error("managed Worker identity was not found");

  const d1 = await api(`/accounts/${input.accountId}/d1/database/${manifest.d1Id}`);
  if (
    !d1 ||
    String(d1.uuid || d1.id || "").toLowerCase() !== manifest.d1Id ||
    d1.name !== manifest.d1Name
  ) {
    throw new Error("managed D1 identity does not match");
  }

  const r2 = await api(`/accounts/${input.accountId}/r2/buckets/${manifest.r2Name}`);
  if (!r2 || String(r2.name || manifest.r2Name) !== manifest.r2Name) {
    throw new Error("managed R2 identity does not match");
  }

  for (const name of managedQueueNamesForRelease(manifest.queueNames, manifest.workerName, input.releaseTag)) {
    const query = new URLSearchParams({ name, page: "1", per_page: "100" });
    const queues = await api(`/accounts/${input.accountId}/queues?${query}`);
    const matches = Array.isArray(queues)
      ? queues.filter((queue) => queue?.queue_name === name)
      : [];
    if (matches.length !== 1) throw new Error(`managed queue identity does not match: ${name}`);
  }

  const namespaces = [];
  let namespaceListingComplete = false;
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: "100" });
    const result = await api(
      `/accounts/${input.accountId}/workers/durable_objects/namespaces?${query}`,
    );
    if (!Array.isArray(result)) throw new Error("managed Durable Object listing is invalid");
    namespaces.push(...result);
    if (result.length < 100) {
      namespaceListingComplete = true;
      break;
    }
  }
  if (!namespaceListingComplete) {
    throw new Error("managed Durable Object listing exceeded the safe page limit");
  }
  const durableObjects = namespaces.filter(
    (namespace) =>
      String(namespace?.id || namespace?.namespace_id || "").toLowerCase() ===
      manifest.durableObjectNamespaceId,
  );
  if (
    durableObjects.length !== 1 ||
    durableObjects[0]?.script !== manifest.workerName ||
    durableObjects[0]?.class !== "Me3UserAgent"
  ) {
    throw new Error("managed Durable Object identity does not match");
  }
  return { ok: true, ...manifest };
}

function normalizeManifest(input) {
  const installationId = String(input.installationId || "").toLowerCase();
  const operationId = String(input.operationId || "").toLowerCase();
  const workerName = String(input.workerName || "");
  const d1Name = String(input.d1Name || "");
  const d1Id = String(input.d1Id || "").toLowerCase();
  const r2Name = String(input.r2Name || "");
  const durableObjectNamespaceId = String(input.durableObjectNamespaceId || "").toLowerCase();
  let queueNames;
  try {
    queueNames = typeof input.queueNames === "string" ? JSON.parse(input.queueNames) : input.queueNames;
  } catch {
    throw new Error("managed resource manifest is invalid");
  }
  if (
    !/^mi-[0-9a-f]{16}$/.test(installationId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId) ||
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
        !name.startsWith(`${workerName}-`) ||
        !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name),
    )
  ) {
    throw new Error("managed resource manifest is invalid");
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

function createApi(accountId, apiToken, request) {
  if (!/^[0-9a-f]{32}$/.test(accountId || "") || !apiToken) {
    throw new Error("Cloudflare managed resource credentials are invalid");
  }
  return async (path, { raw = false } = {}) => {
    const response = await request(`${API_ROOT}${path}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!response.ok) throw new Error(`managed resource lookup failed with status ${response.status}`);
    if (raw) return true;
    const body = await response.json();
    if (body?.success !== true || !Object.hasOwn(body, "result")) {
      throw new Error("managed resource lookup returned an invalid response");
    }
    return body.result;
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--") || !values[index + 1]) throw new Error("invalid argument");
    parsed[values[index].slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    JSON.stringify(
      await verifyManagedResourceIdentities({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        installationId: args["installation-id"],
        operationId: args["operation-id"],
        workerName: args["worker-name"],
        d1Name: args["d1-name"],
        d1Id: args["d1-id"],
        r2Name: args["r2-name"],
        queueNames: args["queue-names"],
        releaseTag: args["release-tag"],
        durableObjectNamespaceId: args["durable-object-namespace-id"],
      }),
    ),
  );
}

#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { verifyManagedResourceIdentities } from "./verify-managed-resource-identities.mjs";

const API_ROOT = "https://api.cloudflare.com/client/v4";

export async function verifyManagedUpgradeResources(
  input,
  request = globalThis.fetch,
) {
  const accountId = String(input.accountId || "").trim().toLowerCase();
  const zoneId = String(input.zoneId || "").trim().toLowerCase();
  const canonicalHostname = String(input.canonicalHostname || "")
    .trim()
    .toLowerCase();
  const publicOrigin = String(input.publicOrigin || "").trim();
  const apiToken = String(input.apiToken || "");
  if (
    !/^[0-9a-f]{32}$/.test(accountId) ||
    !/^[0-9a-f]{32}$/.test(zoneId) ||
    !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\.me3\.app$/.test(
      canonicalHostname,
    ) ||
    publicOrigin !== `https://${canonicalHostname}` ||
    !apiToken
  ) {
    throw new Error("managed upgrade resource contract is invalid");
  }

  const resources = await verifyManagedResourceIdentities(
    {
      accountId,
      apiToken,
      installationId: input.installationId,
      operationId: input.attemptId,
      workerName: input.workerName,
      d1Name: input.d1Name,
      d1Id: input.d1Id,
      r2Name: input.r2Name,
      queueNames: input.queueNames,
      releaseTag: input.releaseTag,
      durableObjectNamespaceId: input.durableObjectNamespaceId,
    },
    request,
  );

  const api = async (filter) => {
    const query = new URLSearchParams(filter);
    const response = await request(
      `${API_ROOT}/accounts/${accountId}/workers/domains?${query}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    const body = await response.json().catch(() => null);
    if (
      !response.ok ||
      body?.success !== true ||
      !Array.isArray(body.result)
    ) {
      throw new Error("managed upgrade custom domain lookup failed");
    }
    return body.result;
  };

  const byHostname = await api({ hostname: canonicalHostname });
  const byWorker = await api({ service: resources.workerName });
  const exactHostname = byHostname.filter(
    (domain) =>
      String(domain?.hostname || "").toLowerCase() === canonicalHostname &&
      String(domain?.service || "").toLowerCase() === resources.workerName &&
      String(domain?.zone_id || "").toLowerCase() === zoneId,
  );
  const exactWorker = byWorker.filter(
    (domain) =>
      String(domain?.hostname || "").toLowerCase() === canonicalHostname &&
      String(domain?.service || "").toLowerCase() === resources.workerName &&
      String(domain?.zone_id || "").toLowerCase() === zoneId,
  );
  if (
    byHostname.length !== 1 ||
    byWorker.length !== 1 ||
    exactHostname.length !== 1 ||
    exactWorker.length !== 1 ||
    (exactHostname[0]?.id &&
      exactWorker[0]?.id &&
      exactHostname[0].id !== exactWorker[0].id)
  ) {
    throw new Error("managed upgrade custom domain identity does not match");
  }
  return {
    ok: true,
    ...resources,
    publicOrigin,
    canonicalHostname,
    zoneId,
    customDomainId: String(exactHostname[0]?.id || ""),
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--") || !values[index + 1]) {
      throw new Error("invalid argument");
    }
    parsed[values[index].slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function required(args, key) {
  if (!args[key]) throw new Error(`--${key} is required`);
  return args[key];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    JSON.stringify(
      await verifyManagedUpgradeResources({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        attemptId: required(args, "attempt-id"),
        installationId: required(args, "installation-id"),
        workerName: required(args, "worker-name"),
        d1Name: required(args, "d1-name"),
        d1Id: required(args, "d1-id"),
        r2Name: required(args, "r2-name"),
        queueNames: required(args, "queue-names"),
        releaseTag: args["release-tag"],
        durableObjectNamespaceId: required(
          args,
          "durable-object-namespace-id",
        ),
        publicOrigin: required(args, "public-origin"),
        canonicalHostname: required(args, "canonical-hostname"),
        zoneId: required(args, "zone-id"),
      }),
    ),
  );
}

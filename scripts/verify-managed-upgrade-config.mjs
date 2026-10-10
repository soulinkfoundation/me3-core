#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readManagedResourceManifest } from "./managed-resource-manifest.mjs";
import { getTomlArrayBlocks, getTomlString } from "./wrangler-toml.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_ARRAY_TABLES = new Set([
  "durable_objects.bindings",
  "migrations",
  "d1_databases",
  "r2_buckets",
  "queues.producers",
  "queues.consumers",
]);

export function verifyManagedUpgradeConfig({
  configPath,
  installationId,
  workerName,
  d1Name,
  d1Id,
  r2Name,
  queueNames,
  durableObjectNamespaceId,
  publicOrigin,
}) {
  const expectedQueues = normalizeQueueNames(queueNames);
  if (
    !UUID_PATTERN.test(d1Id || "") ||
    !/^[0-9a-f]{32}$/.test(durableObjectNamespaceId || "") ||
    !isExactHttpsOrigin(publicOrigin)
  ) {
    throw new Error("managed upgrade config is invalid");
  }
  const config = readFileSync(configPath, "utf8");
  const manifest = readManagedResourceManifest({
    configPath,
    installationId,
    workerName,
    d1Name,
    r2Name,
  });
  const databaseBlocks = getTomlArrayBlocks(config, "d1_databases", "DB");
  const bucketBlocks = getTomlArrayBlocks(config, "r2_buckets", "SITE_ASSETS");
  const durableObjectBlocks = getTomlArrayBlocks(
    config,
    "durable_objects.bindings",
    "ME3_USER_AGENT",
    "name",
  );
  const sdkDurableObjectBlocks = getTomlArrayBlocks(
    config,
    "durable_objects.bindings",
    "ME3_SDK_USER_AGENT",
    "name",
  );
  const agentDurableObjectBlocks = getTomlArrayBlocks(
    config,
    "durable_objects.bindings",
    "ME3_AGENT",
    "name",
  );
  const allD1Count = countArrayHeader(config, "d1_databases");
  const allR2Count = countArrayHeader(config, "r2_buckets");
  const allDurableObjectCount = countArrayHeader(
    config,
    "durable_objects.bindings",
  );
  if (
    !/^workers_dev\s*=\s*false$/m.test(config) ||
    !hasExactTomlString(config, "CORE_WEB_ORIGIN", publicOrigin) ||
    !hasExactTomlString(config, "CORE_API_ORIGIN", publicOrigin) ||
    manifest.d1Id !== d1Id ||
    JSON.stringify(manifest.queueNames) !== JSON.stringify(expectedQueues) ||
    allD1Count !== 1 ||
    databaseBlocks.length !== 1 ||
    getTomlString(databaseBlocks[0], "database_name") !== d1Name ||
    getTomlString(databaseBlocks[0], "database_id") !== d1Id ||
    allR2Count !== 1 ||
    bucketBlocks.length !== 1 ||
    getTomlString(bucketBlocks[0], "bucket_name") !== r2Name ||
    allDurableObjectCount !== 1 + sdkDurableObjectBlocks.length + agentDurableObjectBlocks.length ||
    durableObjectBlocks.length !== 1 ||
    getTomlString(durableObjectBlocks[0], "class_name") !== "Me3UserAgent" ||
    sdkDurableObjectBlocks.length > 1 ||
    (sdkDurableObjectBlocks.length === 1 && getTomlString(sdkDurableObjectBlocks[0], "class_name") !== "Me3SdkUserAgent") ||
    agentDurableObjectBlocks.length > 1 ||
    (agentDurableObjectBlocks.length === 1 && getTomlString(agentDurableObjectBlocks[0], "class_name") !== "Me3Agent") ||
    (/^ME3_ASSISTANT_RUNTIME\s*=\s*"sdk"$/m.test(config) && sdkDurableObjectBlocks.length !== 1) ||
    (/^ME3_ASSISTANT_RUNTIME\s*=\s*"agent"$/m.test(config) && agentDurableObjectBlocks.length !== 1) ||
    hasUnexpectedArrayTable(config) ||
    hasUnsafeDurableObjectMigration(config) ||
    hasRouteDeclaration(config)
  ) {
    throw new Error("managed upgrade config is invalid");
  }
  return { ...manifest, durableObjectNamespaceId, publicOrigin };
}

function hasExactTomlString(config, key, expected) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${key}\\s*=\\s*"${escaped}"$`, "m").test(config);
}

function countArrayHeader(config, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (config.match(new RegExp(`^\\s*\\[\\[${escaped}\\]\\]\\s*$`, "gm")) || [])
    .length;
}

function hasUnexpectedArrayTable(config) {
  return [...config.matchAll(/^\s*\[\[\s*([^\]\s]+)\s*\]\]\s*$/gm)].some(
    (match) => !ALLOWED_ARRAY_TABLES.has(match[1]),
  );
}

function hasUnsafeDurableObjectMigration(config) {
  if (
    /^\s*(?:renamed_classes|deleted_classes|transferred_classes)\s*=/m.test(
      config,
    )
  ) {
    return true;
  }
  for (const match of config.matchAll(
    /^\s*(?:new_classes|new_sqlite_classes)\s*=\s*\[([^\]]*)\]/gm,
  )) {
    const classNames = [...match[1].matchAll(/["']([^"']+)["']/g)].map(
      (item) => item[1],
    );
    if (classNames.length === 0 || classNames.some((name) => name !== "Me3UserAgent" && name !== "Me3SdkUserAgent" && name !== "Me3Agent")) {
      return true;
    }
  }
  return false;
}

function hasRouteDeclaration(config) {
  return (
    /^\s*\[\[?\s*(?:[^.\]\s]+\.)*(?:routes?|custom_domain)\s*\]\]?\s*$/im.test(config) ||
    /^\s*(?:route|routes|custom_domain)\s*=/im.test(config)
  );
}

function isExactHttpsOrigin(value) {
  try {
    const url = new URL(value || "");
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

function normalizeQueueNames(value) {
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("managed upgrade config is invalid");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || new Set(parsed).size !== parsed.length) {
    throw new Error("managed upgrade config is invalid");
  }
  return [...parsed].sort();
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
      verifyManagedUpgradeConfig({
        configPath: required(args, "config"),
        installationId: required(args, "installation-id"),
        workerName: required(args, "worker-name"),
        d1Name: required(args, "d1-name"),
        d1Id: required(args, "d1-id"),
        r2Name: required(args, "r2-name"),
        queueNames: required(args, "queue-names"),
        durableObjectNamespaceId: required(
          args,
          "durable-object-namespace-id",
        ),
        publicOrigin: required(args, "public-origin"),
      }),
    ),
  );
}

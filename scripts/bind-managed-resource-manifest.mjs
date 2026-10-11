#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { managedQueueNamesForRelease, readManagedResourceManifest } from "./managed-resource-manifest.mjs";
import { getTomlArrayBlock, setTomlString } from "./wrangler-toml.mjs";

export function bindManagedResourceManifest({
  configPath,
  installationId,
  workerName,
  d1Name,
  d1Id,
  r2Name,
  queueNames,
  releaseTag,
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d1Id || "")) {
    throw new Error("managed D1 id is invalid");
  }
  const expectedQueues = managedQueueNamesForRelease(normalizeQueueNames(queueNames), workerName, releaseTag);
  let config = readFileSync(configPath, "utf8");
  const database = getTomlArrayBlock(config, "d1_databases", "DB");
  if (!database) throw new Error("managed D1 binding is missing");
  config = config.replace(database, () => setTomlString(database, "database_id", d1Id));
  writeFileSync(configPath, config);

  const manifest = readManagedResourceManifest({
    configPath,
    installationId,
    workerName,
    d1Name,
    r2Name,
  });
  if (JSON.stringify(manifest.queueNames) !== JSON.stringify(expectedQueues)) {
    throw new Error("managed queue manifest does not match the pinned release");
  }
  return manifest;
}

function normalizeQueueNames(value) {
  let names;
  try {
    names = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("managed queue manifest is invalid");
  }
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    new Set(names).size !== names.length ||
    names.some((name) => typeof name !== "string")
  ) {
    throw new Error("managed queue manifest is invalid");
  }
  return [...names].sort();
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

function required(args, key) {
  if (!args[key]) throw new Error(`--${key} is required`);
  return args[key];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    JSON.stringify(
      bindManagedResourceManifest({
        configPath: required(args, "config"),
        installationId: required(args, "installation-id"),
        workerName: required(args, "worker-name"),
        d1Name: required(args, "d1-name"),
        d1Id: required(args, "d1-id"),
        r2Name: required(args, "r2-name"),
        queueNames: required(args, "queue-names"),
        releaseTag: args["release-tag"],
      }),
    ),
  );
}

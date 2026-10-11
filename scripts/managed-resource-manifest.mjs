#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getTomlArrayBlocks, getTomlString } from "./wrangler-toml.mjs";

const INSTALLATION_PATTERN = /^mi-[0-9a-f]{16}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const LEGACY_ASSISTANT_JOB_QUEUE_NAMES = [
  "me3-assistant-job-events",
  "me3-assistant-job-events-dlq",
];

export function retiredAssistantJobQueueNames(workerName) {
  return LEGACY_ASSISTANT_JOB_QUEUE_NAMES.map((name) => `${workerName}-${name.slice(4)}`);
}

export function managedQueueNamesForRelease(queueNames, workerName, releaseTag) {
  if (releaseTag === undefined) return queueNames;
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(releaseTag)) {
    throw new Error("managed release tag is invalid");
  }
  const [major, minor, patch] = releaseTag.slice(1).split(".").map(Number);
  if (major === 0 && (minor < 1 || (minor === 1 && patch < 214))) return queueNames;
  // Cloud keeps its frozen manifest; only the retired resources become optional.
  const retired = retiredAssistantJobQueueNames(workerName);
  return queueNames.filter((name) => !retired.includes(name));
}

export function readManagedResourceManifest({
  configPath,
  installationId,
  workerName,
  d1Name,
  r2Name,
}) {
  if (!INSTALLATION_PATTERN.test(installationId || "")) {
    throw new Error("managed installation id is invalid");
  }
  const expectedWorkerName = `me3-${installationId}`;
  if (workerName !== expectedWorkerName) throw new Error("managed Worker name is invalid");
  if (d1Name !== `${workerName}-d1`) throw new Error("managed D1 name is invalid");
  if (r2Name !== `${workerName}-r2`) throw new Error("managed R2 name is invalid");

  const config = readFileSync(configPath, "utf8");
  const configuredWorker = config.match(/^name\s*=\s*"([^"]+)"/m)?.[1] || "";
  if (configuredWorker !== workerName) throw new Error("configured Worker name does not match");
  if (!/^ME3_DEPLOYMENT_MODE\s*=\s*"managed"$/m.test(config)) {
    throw new Error("configured deployment is not managed");
  }
  if (
    !new RegExp(
      `^ME3_MANAGED_INSTALLATION_ID\\s*=\\s*"${escapeRegExp(installationId)}"$`,
      "m",
    ).test(config)
  ) {
    throw new Error("configured managed installation id does not match");
  }

  const database = getTomlArrayBlocks(config, "d1_databases", "DB")
    .map((block) => ({
      binding: getTomlString(block, "binding"),
      name: getTomlString(block, "database_name"),
      id: getTomlString(block, "database_id").toLowerCase(),
    }))
    .find((item) => item.binding === "DB");
  if (!database || database.name !== d1Name || !UUID_PATTERN.test(database.id)) {
    throw new Error("configured managed D1 resource does not match");
  }

  const bucket = getTomlArrayBlocks(config, "r2_buckets", "SITE_ASSETS")
    .map((block) => ({
      binding: getTomlString(block, "binding"),
      name: getTomlString(block, "bucket_name"),
    }))
    .find((item) => item.binding === "SITE_ASSETS");
  if (!bucket || bucket.name !== r2Name) {
    throw new Error("configured managed R2 resource does not match");
  }

  const queueNames = [
    ...config.matchAll(/^\s*(?:queue|dead_letter_queue)\s*=\s*"([^"]+)"\s*$/gm),
  ]
    .map((match) => match[1])
    .filter((name, index, values) => values.indexOf(name) === index)
    .sort();
  if (
    queueNames.length === 0 ||
    queueNames.some((name) => !name.startsWith(`${workerName}-`))
  ) {
    throw new Error("managed queue manifest is missing or not installation-isolated");
  }

  const durableObject = getTomlArrayBlocks(
    config,
    "durable_objects.bindings",
    "ME3_USER_AGENT",
    "name",
  )
    .map((block) => ({
      binding: getTomlString(block, "name"),
      className: getTomlString(block, "class_name"),
    }))
    .find((item) => item.binding === "ME3_USER_AGENT");
  if (!durableObject || durableObject.className !== "Me3UserAgent") {
    throw new Error("managed Durable Object binding is invalid");
  }

  return {
    installationId,
    workerName,
    d1Name: database.name,
    d1Id: database.id,
    r2Name: bucket.name,
    queueNames,
    durableObjectClassName: durableObject.className,
  };
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readManagedResourceManifest({
    configPath: required(args, "config"),
    installationId: required(args, "installation-id"),
    workerName: required(args, "worker-name"),
    d1Name: required(args, "d1-name"),
    r2Name: required(args, "r2-name"),
  });
  if (args["github-env"]) {
    appendFileSync(
      args["github-env"],
      [
        `ME3_MANAGED_D1_ID=${manifest.d1Id}`,
        `ME3_MANAGED_QUEUE_NAMES=${JSON.stringify(manifest.queueNames)}`,
        `ME3_MANAGED_DO_CLASS=${manifest.durableObjectClassName}`,
        "",
      ].join("\n"),
    );
  }
  console.log(JSON.stringify(manifest));
}

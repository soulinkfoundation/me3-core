#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyManagedUpgradeRelease({
  metadataPath,
  targetReleaseTag,
  targetReleaseSha,
  actualReleaseSha,
}) {
  const tag = String(targetReleaseTag || "").trim();
  const expectedSha = String(targetReleaseSha || "").trim().toLowerCase();
  const actualSha = String(actualReleaseSha || "").trim().toLowerCase();
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    throw new Error("managed upgrade release metadata is invalid");
  }
  // The published v0.1.217 commit retained v0.1.216's notes URL.
  const published217Notes = tag === "v0.1.217" &&
    expectedSha === "e9706e7ba72db265e519fa087c8f507b34e5995d" &&
    metadata?.releaseNotesUrl ===
      "https://github.com/soulinkfoundation/me3-core/releases/tag/v0.1.216";
  if (
    !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag) ||
    !/^[0-9a-f]{40}$/.test(expectedSha) ||
    actualSha !== expectedSha ||
    metadata?.schemaVersion !== 1 ||
    metadata?.releaseChannel !== "stable" ||
    metadata?.version !== tag.slice(1) ||
    (!published217Notes && metadata?.releaseNotesUrl !==
      `https://github.com/soulinkfoundation/me3-core/releases/tag/${tag}`)
  ) {
    throw new Error("managed upgrade release metadata is invalid");
  }
  return { tag, version: metadata.version, commitSha: actualSha };
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
      verifyManagedUpgradeRelease({
        metadataPath: required(args, "metadata"),
        targetReleaseTag: required(args, "target-release-tag"),
        targetReleaseSha: required(args, "target-release-sha"),
        actualReleaseSha: required(args, "actual-release-sha"),
      }),
    ),
  );
}

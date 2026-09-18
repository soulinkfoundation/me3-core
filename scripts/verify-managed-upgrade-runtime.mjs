#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export async function verifyManagedUpgradeRuntime(
  input,
  request = globalThis.fetch,
  options = {},
) {
  const publicOrigin = String(input.publicOrigin || "").trim();
  const canonicalHostname = String(input.canonicalHostname || "")
    .trim()
    .toLowerCase();
  const expectedReleaseTag = String(input.expectedReleaseTag || "").trim();
  if (
    publicOrigin !== `https://${canonicalHostname}` ||
    !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\.me3\.app$/.test(
      canonicalHostname,
    ) ||
    !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(expectedReleaseTag)
  ) {
    throw new Error("managed upgrade runtime contract is invalid");
  }
  const attempts = positiveInteger(options.attempts, 15);
  const delayMs = nonNegativeInteger(options.delayMs, 2_000);
  const version = expectedReleaseTag.slice(1);
  let lastFailure = "runtime response did not satisfy the release contract";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const probe = await probeRuntime(publicOrigin, request);
    if (probe.ok) {
      const { health, mobile, core } = probe;
      const mismatches = runtimeMismatches({
        health,
        mobile,
        core,
        version,
        publicOrigin,
        canonicalHostname,
      });
      if (mismatches.length === 0) {
        return {
          ok: true,
          releaseTag: expectedReleaseTag,
          version,
          publicOrigin,
          canonicalHostname,
          coreInstallId: mobile.installId,
        };
      }
      lastFailure = `contract mismatch: ${mismatches.join(", ")}`;
    } else {
      lastFailure = `request failure: ${probe.failures.join(", ")}`;
    }
    if (attempt < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`managed upgrade live runtime does not match (${lastFailure})`);
}

async function probeRuntime(publicOrigin, request) {
  const endpoints = [
    ["health", `${publicOrigin}/health`],
    ["mobile", `${publicOrigin}/api/mobile/config`],
    ["core", `${publicOrigin}/api/core/version`],
  ];
  const results = await Promise.allSettled(
    endpoints.map(([, url]) => fetchJson(url, request)),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${endpoints[index][0]} (${safeErrorMessage(result.reason)})`]
      : [],
  );
  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    health: results[0].value,
    mobile: results[1].value,
    core: results[2].value,
  };
}

function runtimeMismatches({
  health,
  mobile,
  core,
  version,
  publicOrigin,
  canonicalHostname,
}) {
  const mismatches = [];
  if (health?.ok !== true || health?.service !== "me3-core") {
    mismatches.push("health identity");
  }
  if (
    health?.core?.version !== version ||
    health?.core?.releaseChannel !== "stable"
  ) {
    mismatches.push(`health release (received ${safeVersion(health?.core)})`);
  }
  const missingBindings = ["db", "userAgent", "workersAi", "siteAssets"].filter(
    (binding) => health?.bindings?.[binding] !== true,
  );
  if (missingBindings.length > 0) {
    mismatches.push(`health bindings (${missingBindings.join("/")})`);
  }
  if (
    health?.hosts?.admin !== canonicalHostname ||
    health?.hosts?.api !== canonicalHostname
  ) {
    mismatches.push("health hosts");
  }
  if (
    !/^core_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      mobile?.installId || "",
    )
  ) {
    mismatches.push("mobile install ID");
  }
  if (safeOrigin(mobile?.publicURL) !== publicOrigin) {
    mismatches.push("mobile public origin");
  }
  if (
    mobile?.mobileApiVersion !== 1 ||
    mobile?.auth?.pairing !== "owner-approved-code"
  ) {
    mismatches.push("mobile API contract");
  }
  if (core?.version !== version || core?.releaseChannel !== "stable") {
    mismatches.push(`core release (received ${safeVersion(core)})`);
  }
  return mismatches;
}

function safeVersion(value) {
  const version = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value?.version || "")
    ? value.version
    : "invalid";
  const channel = value?.releaseChannel === "stable" ? "stable" : "invalid";
  return `${version}/${channel}`;
}

function safeErrorMessage(value) {
  const message = value instanceof Error ? value.message : "unknown error";
  return message.replace(/[^a-zA-Z0-9 .:_()\/-]/g, "").slice(0, 160);
}

function safeOrigin(value) {
  try {
    return new URL(value || "").origin;
  } catch {
    return "";
  }
}

async function fetchJson(url, request) {
  const response = await request(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`unexpected content type ${contentType || "missing"}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("invalid JSON response");
  }
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
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
      await verifyManagedUpgradeRuntime({
        publicOrigin: required(args, "public-origin"),
        canonicalHostname: required(args, "canonical-hostname"),
        expectedReleaseTag: required(args, "expected-release-tag"),
      }),
    ),
  );
}

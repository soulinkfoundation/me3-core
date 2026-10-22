#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export async function sendManagedInstallWorkflowCallback(
  env = process.env,
  request = globalThis.fetch,
) {
  const callbackUrl = env.ME3_MANAGED_CALLBACK_URL?.trim();
  const callbackSecret = env.ME3_MANAGED_CALLBACK_SECRET?.trim();
  const installationId = env.ME3_MANAGED_INSTALLATION_ID?.trim();
  const releaseTag = env.ME3_MANAGED_RELEASE_TAG?.trim();
  const status = env.ME3_MANAGED_STATUS?.trim();
  const stage = env.ME3_MANAGED_STAGE?.trim();
  const origin = env.ME3_MANAGED_ORIGIN?.trim();
  const canonicalHostname = env.ME3_MANAGED_CANONICAL_HOSTNAME?.trim().toLowerCase();
  const errorCode = env.ME3_MANAGED_ERROR_CODE?.trim();
  const d1Id = env.ME3_MANAGED_D1_ID?.trim().toLowerCase();
  const durableObjectNamespaceId = env.ME3_MANAGED_DO_NAMESPACE_ID?.trim().toLowerCase();
  const workerPresent = parseOptionalBoolean(env.ME3_MANAGED_WORKER_PRESENT);
  const workerPublic = parseOptionalBoolean(env.ME3_MANAGED_WORKER_PUBLIC);
  let queueNames;
  try {
    queueNames = env.ME3_MANAGED_QUEUE_NAMES
      ? JSON.parse(env.ME3_MANAGED_QUEUE_NAMES)
      : undefined;
  } catch {
    throw new Error("managed callback resource manifest is invalid");
  }

  if (
    callbackUrl !== "https://api.me3.app/api/managed-install/provisioning/callback" ||
    !callbackSecret ||
    !/^mi-[0-9a-f]{16}$/.test(installationId || "") ||
    !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(releaseTag || "") ||
    !["provisioning", "ready", "failed"].includes(status || "")
  ) {
    throw new Error("managed callback configuration is invalid");
  }
  if (
    (origin && !isManagedOrigin(origin, installationId, canonicalHostname)) ||
    (d1Id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d1Id)) ||
    (durableObjectNamespaceId && !/^[0-9a-f]{32}$/.test(durableObjectNamespaceId)) ||
    ((workerPresent === undefined) !== (workerPublic === undefined)) ||
    (workerPublic === true && workerPresent !== true) ||
    (origin && workerPresent !== undefined && (!workerPresent || !workerPublic)) ||
    (queueNames &&
      (!Array.isArray(queueNames) ||
        queueNames.length === 0 ||
        new Set(queueNames).size !== queueNames.length ||
        queueNames.some(
          (name) =>
            typeof name !== "string" ||
            !name.startsWith(`me3-${installationId}-`) ||
            !/^[a-z0-9-]+$/.test(name),
        )))
  ) {
    throw new Error("managed callback resource manifest is invalid");
  }
  if (
    status === "ready" &&
    (!d1Id ||
      !queueNames ||
      !durableObjectNamespaceId ||
      !isManagedOrigin(origin, installationId, canonicalHostname))
  ) {
    throw new Error("managed ready callback requires a complete resource manifest");
  }

  const response = await request(callbackUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${callbackSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      installationId,
      releaseTag,
      status,
      ...(stage ? { stage } : {}),
      ...(origin ? { origin } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(workerPresent === undefined ? {} : { workerPresent }),
      ...(workerPublic === undefined ? {} : { workerPublic }),
      ...(d1Id ? { d1Id } : {}),
      ...(queueNames ? { queueNames: [...new Set(queueNames)].sort() } : {}),
      ...(durableObjectNamespaceId ? { durableObjectNamespaceId } : {}),
    }),
  });

  if (!response.ok) {
    const failureCode = await readFailureCode(response);
    throw new Error(
      `managed callback returned ${response.status}` +
        (failureCode ? ` (${failureCode})` : ""),
    );
  }
}

// Only a bare error code leaves the response, so the run log names the failing
// step without echoing anything else ME3 Cloud returned.
async function readFailureCode(response) {
  try {
    const body = await response.json();
    const code = typeof body?.errorCode === "string" ? body.errorCode : "";
    return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : "";
  } catch {
    return "";
  }
}

function parseOptionalBoolean(value) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("managed callback Worker deployment proof is invalid");
}

function isManagedOrigin(value, installationId, canonicalHostname) {
  try {
    const url = new URL(value || "");
    if (
      canonicalHostname &&
      /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\.me3\.app$/.test(canonicalHostname)
    ) {
      return url.origin === value && url.hostname === canonicalHostname && !url.port;
    }
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.startsWith(`me3-${installationId}.`) &&
      url.hostname.endsWith(".workers.dev")
    );
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await sendManagedInstallWorkflowCallback();
}

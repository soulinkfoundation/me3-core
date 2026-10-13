#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BROKER_URL = "https://api.me3.app/api/managed-install/lifecycle/control-token";
const ACTIONS = new Set([
  "status",
  "quiesce",
  "suspend",
  "resume",
  "revoke_credentials",
  "purge_storage",
]);
const LIFECYCLE_PROTOCOL = "me3-managed-lifecycle-v2";
const PORTABLE_EXPORT_POLICY = "me3-portable-v1-policy-1";

export class ManagedRuntimeControlError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ManagedRuntimeControlError";
    this.code = code;
  }
}

export async function callManagedRuntimeControl(
  input,
  request = globalThis.fetch,
) {
  const installationId = String(input.installationId || "").toLowerCase();
  const operationId = String(input.operationId || "").toLowerCase();
  const attemptId = String(input.attemptId || "").toLowerCase();
  const action = String(input.action || "");
  const requestId = (input.requestId || randomUUID()).toLowerCase();
  if (
    !/^mi-[0-9a-f]{16}$/.test(installationId) ||
    !isUuid(operationId) ||
    !isUuid(attemptId) ||
    !isUuid(requestId) ||
    !ACTIONS.has(action) ||
    typeof input.callbackSecret !== "string" ||
    !input.callbackSecret
  ) {
    throw new ManagedRuntimeControlError(
      "managed runtime control configuration is invalid",
      "runtime_control_configuration_invalid",
    );
  }
  const brokerUrl = input.brokerUrl || BROKER_URL;
  if (![BROKER_URL, "https://api.me3.app/api/managed-install/upgrade/control-token"].includes(brokerUrl)) {
    throw new ManagedRuntimeControlError("untrusted managed runtime broker", "runtime_control_configuration_invalid");
  }
  const expectedReleaseTag = normalizeReleaseTag(input.expectedReleaseTag);
  if (input.expectedReleaseTag && !expectedReleaseTag) {
    throw new ManagedRuntimeControlError(
      "managed runtime release tag is invalid",
      "runtime_control_configuration_invalid",
    );
  }

  const call = (requestedAction, requestedId, expectedGeneration = null) =>
    callManagedRuntimeControlOnce(
      {
        brokerUrl,
        installationId,
        operationId,
        attemptId,
        callbackSecret: input.callbackSecret,
        expectedReleaseTag,
        action: requestedAction,
        requestId: requestedId,
        expectedGeneration,
      },
      request,
    );
  if (action === "status") return call("status", requestId);

  // Every mutation is fenced by an immediately preceding authenticated status
  // generation. An action token minted before a renewal/cancellation resume can
  // therefore never quiesce or suspend the newly active generation afterward.
  const status = await call("status", randomUUID().toLowerCase());
  return call(action, requestId, status.runtime.generation);
}

async function callManagedRuntimeControlOnce(input, request) {
  const mutating = input.action !== "status";
  if (
    mutating &&
    (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1)
  ) {
    throw new ManagedRuntimeControlError(
      "managed runtime control generation is invalid",
      "runtime_control_configuration_invalid",
    );
  }
  const brokerBody = {
    installationId: input.installationId,
    operationId: input.operationId,
    attemptId: input.attemptId,
    action: input.action,
    requestId: input.requestId,
    ...(mutating ? { expectedGeneration: input.expectedGeneration } : {}),
  };
  const broker = await request(input.brokerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.callbackSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(brokerBody),
  });
  const capability = await broker.json().catch(() => null);
  if (
    !broker.ok ||
    capability?.ok !== true ||
    typeof capability.token !== "string" ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(capability.token) ||
    !isManagedOrigin(capability.origin) ||
    !isShortExpiry(capability.expiresAt)
  ) {
    throw new ManagedRuntimeControlError(
      `managed runtime token broker failed with status ${broker.status}`,
      "runtime_control_unavailable",
    );
  }
  const url = `${capability.origin}/api/managed/lifecycle`;
  const runtimeResponse = await request(url, {
    method: mutating ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${capability.token}`,
      ...(mutating ? { "Content-Type": "application/json" } : {}),
    },
    ...(mutating
      ? {
          body: JSON.stringify({
            installationId: input.installationId,
            action: input.action,
            requestId: input.requestId,
            expectedGeneration: input.expectedGeneration,
          }),
        }
      : {}),
  });
  const body = await runtimeResponse.json().catch(() => null);
  if (!runtimeResponse.ok) {
    throw new ManagedRuntimeControlError(
      `managed runtime control failed with status ${runtimeResponse.status}`,
      runtimeResponse.status === 404
        ? "runtime_upgrade_required"
        : "runtime_control_unavailable",
    );
  }
  if (
    body?.ok !== true ||
    body.runtime?.installationId !== input.installationId ||
    !["active", "quiesced", "suspended"].includes(body.runtime?.state) ||
    !Number.isSafeInteger(body.runtime?.generation) ||
    body.runtime.generation < 1 ||
    !Number.isSafeInteger(body.runtime?.activeWrites) ||
    body.runtime.activeWrites < 0
  ) {
    throw new ManagedRuntimeControlError(
      "managed runtime does not expose the required lifecycle contract",
      "runtime_upgrade_required",
    );
  }
  if (
    body.runtime.lifecycleProtocol !== LIFECYCLE_PROTOCOL ||
    body.runtime.portableExportPolicy !== PORTABLE_EXPORT_POLICY
  ) {
    throw new ManagedRuntimeControlError(
      "managed runtime lifecycle or portable export policy is incompatible",
      "runtime_upgrade_required",
    );
  }
  if (
    input.expectedReleaseTag &&
    body.runtime.releaseVersion !== input.expectedReleaseTag.slice(1)
  ) {
    throw new ManagedRuntimeControlError(
      "managed runtime release does not match the recorded installation manifest",
      "runtime_release_mismatch",
    );
  }
  return {
    ok: true,
    requestId: input.requestId,
    origin: capability.origin,
    runtime: body.runtime,
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isManagedOrigin(value) {
  try {
    const url = new URL(value);
    const isManagedCustomHostname =
      /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\.me3\.app$/.test(url.hostname);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      (url.hostname.endsWith(".workers.dev") || isManagedCustomHostname)
    );
  } catch {
    return false;
  }
}

function isShortExpiry(value) {
  const expiresAt = Date.parse(value || "");
  const now = Date.now();
  return Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= now + 5 * 60_000;
}

function normalizeReleaseTag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(normalized) ? normalized : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const action = process.argv[2];
    console.log(
      JSON.stringify(
        await callManagedRuntimeControl({
        installationId: process.env.ME3_MANAGED_INSTALLATION_ID,
        operationId: process.env.ME3_MANAGED_OPERATION_ID,
        attemptId: process.env.ME3_MANAGED_ATTEMPT_ID,
        callbackSecret: process.env.ME3_MANAGED_LIFECYCLE_CALLBACK_SECRET,
        expectedReleaseTag: process.env.ME3_MANAGED_RELEASE_TAG,
        action,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof ManagedRuntimeControlError && process.env.GITHUB_ENV) {
      appendFileSync(process.env.GITHUB_ENV, `ME3_MANAGED_ERROR_CODE=${error.code}\n`, {
        encoding: "utf8",
      });
    }
    throw error;
  }
}

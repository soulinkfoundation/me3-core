import { normalizeMe3DeploymentMode } from "./agent-chat";
import { ME3_CORE_VERSION } from "./core-version";
import type { Env } from "./types";

export const MANAGED_RUNTIME_CONTROL_PATH = "/api/managed/lifecycle";
export const MANAGED_RUNTIME_CONTROL_AUDIENCE = "me3-managed-runtime-control";
export const MANAGED_RUNTIME_CONTROL_TOKEN_TYPE = "me3_managed_runtime_control";
export const MANAGED_RUNTIME_LIFECYCLE_PROTOCOL = "me3-managed-lifecycle-v2";
export const MANAGED_PORTABLE_EXPORT_POLICY = "me3-portable-v1-policy-1";

export const MANAGED_RUNTIME_ACTIONS = [
  "quiesce",
  "suspend",
  "resume",
  "revoke_credentials",
  "purge_storage",
] as const;

export type ManagedRuntimeAction = (typeof MANAGED_RUNTIME_ACTIONS)[number];
export type ManagedRuntimeControlAction = ManagedRuntimeAction | "status";
export type ManagedRuntimeMode = "active" | "quiesced" | "suspended";

export type ManagedRuntimeControlClaims = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  typ?: unknown;
  installation_id?: unknown;
  action?: unknown;
  expected_generation?: unknown;
  request_id?: unknown;
  jti?: unknown;
  iat?: unknown;
  exp?: unknown;
};

export type ManagedRuntimeStatus = {
  installationId: string;
  lifecycleProtocol: typeof MANAGED_RUNTIME_LIFECYCLE_PROTOCOL;
  portableExportPolicy: typeof MANAGED_PORTABLE_EXPORT_POLICY;
  releaseVersion: string;
  state: ManagedRuntimeMode;
  generation: number;
  quiescedAt: string | null;
  suspendedAt: string | null;
  credentialsRevokedAt: string | null;
  storagePurgedAt: string | null;
  activeWrites: number;
  exportReady: boolean;
};

export type ManagedRuntimeWriteLease = {
  leaseId: string;
  installationId: string;
};

type ManagedRuntimeStateRow = {
  installation_id: string;
  state: ManagedRuntimeMode;
  generation: number | string;
  quiesced_at: string | null;
  suspended_at: string | null;
  credentials_revoked_at: string | null;
  storage_purged_at: string | null;
  last_request_id: string | null;
};

type ManagedRuntimeControlRequestRow = {
  installation_id: string;
  action: ManagedRuntimeAction;
  expected_generation: number | string | null;
  status: "applying" | "applied";
};

const MANAGED_INSTALLATION_ID_PATTERN = /^mi-[0-9a-f]{16}$/;
const CONTROL_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_TOKEN_MAX_AGE_SECONDS = 5 * 60;
// SSE responses can remain connected well beyond a normal request. Keep their
// lease conservative so export cannot begin while a live stream can still write.
const WRITE_LEASE_STALE_AFTER_MINUTES = 6 * 60;
const MAX_STORAGE_PURGE_PAGES = 10_000;

export class ManagedRuntimeLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 401 | 403 | 409 | 423 | 503 = 400,
  ) {
    super(message);
    this.name = "ManagedRuntimeLifecycleError";
  }
}

export function isManagedRuntime(env: Env): boolean {
  return normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed";
}

export function getManagedInstallationId(env: Env): string | null {
  const value = env.ME3_MANAGED_INSTALLATION_ID?.trim().toLowerCase() || "";
  return MANAGED_INSTALLATION_ID_PATTERN.test(value) ? value : null;
}

export function isManagedRuntimeAction(value: unknown): value is ManagedRuntimeAction {
  return MANAGED_RUNTIME_ACTIONS.includes(value as ManagedRuntimeAction);
}

export function validateManagedRuntimeControlClaims(
  env: Env,
  claims: ManagedRuntimeControlClaims,
  expectedAction: ManagedRuntimeControlAction,
  expectedRequestId?: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): {
  installationId: string;
  requestId: string;
  expectedGeneration: number | null;
} {
  const installationId = requireManagedInstallationId(env);
  const requestId = normalizeControlRequestId(claims.request_id);
  const issuedAt = typeof claims.iat === "number" ? claims.iat : NaN;
  const expiresAt = typeof claims.exp === "number" ? claims.exp : NaN;
  const expectedGeneration =
    expectedAction === "status"
      ? null
      : normalizeExpectedGeneration(claims.expected_generation);

  if (
    claims.aud !== MANAGED_RUNTIME_CONTROL_AUDIENCE ||
    claims.typ !== MANAGED_RUNTIME_CONTROL_TOKEN_TYPE ||
    claims.sub !== installationId ||
    claims.installation_id !== installationId ||
    claims.action !== expectedAction ||
    !requestId ||
    claims.jti !== requestId ||
    !Number.isInteger(issuedAt) ||
    !Number.isInteger(expiresAt) ||
    issuedAt > nowSeconds + 30 ||
    issuedAt < nowSeconds - CONTROL_TOKEN_MAX_AGE_SECONDS ||
    expiresAt <= nowSeconds ||
    expiresAt - issuedAt > CONTROL_TOKEN_MAX_AGE_SECONDS ||
    (expectedAction === "status"
      ? claims.expected_generation !== undefined && claims.expected_generation !== null
      : expectedGeneration === null) ||
    (expectedRequestId && requestId !== expectedRequestId)
  ) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime control token was not accepted",
      "managed_control_token_invalid",
      403,
    );
  }

  return { installationId, requestId, expectedGeneration };
}

export async function getManagedRuntimeStatus(env: Env): Promise<ManagedRuntimeStatus | null> {
  if (!isManagedRuntime(env)) return null;
  const installationId = requireManagedInstallationId(env);
  await ensureManagedRuntimeState(env, installationId);
  await removeStaleWriteLeases(env, installationId);
  return readManagedRuntimeStatus(env, installationId);
}

export async function getManagedRuntimeRequestMode(
  env: Env,
): Promise<ManagedRuntimeMode | null> {
  if (!isManagedRuntime(env)) return null;
  const installationId = requireManagedInstallationId(env);
  const row =
    (await readManagedRuntimeState(env)) ||
    (await ensureManagedRuntimeState(env, installationId));
  if (row.installation_id !== installationId) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime identity does not match persisted state",
      "managed_runtime_identity_mismatch",
      503,
    );
  }
  return row.state;
}

export async function beginManagedRuntimeWriteLease(
  env: Env,
  method: string,
  pathClass: string,
): Promise<ManagedRuntimeWriteLease | null> {
  if (!isManagedRuntime(env)) return null;
  const installationId = requireManagedInstallationId(env);
  if ((await getManagedRuntimeRequestMode(env)) !== "active") return null;
  const leaseId = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT INTO managed_runtime_write_leases
       (lease_id, installation_id, method, path_class, created_at)
     SELECT ?, ?, ?, ?, CURRENT_TIMESTAMP
     WHERE EXISTS (
       SELECT 1 FROM managed_runtime_state
       WHERE id = 'managed' AND installation_id = ? AND state = 'active'
     )`,
  )
    .bind(leaseId, installationId, normalizeMethod(method), normalizePathClass(pathClass), installationId)
    .run();
  if ((result.meta?.changes || 0) < 1) return null;
  return { leaseId, installationId };
}

export async function releaseManagedRuntimeWriteLease(
  env: Env,
  lease: ManagedRuntimeWriteLease | null,
): Promise<void> {
  if (!lease) return;
  await env.DB.prepare(
    "DELETE FROM managed_runtime_write_leases WHERE lease_id = ? AND installation_id = ?",
  )
    .bind(lease.leaseId, lease.installationId)
    .run();
}

export async function applyManagedRuntimeAction(
  env: Env,
  input: {
    installationId: string;
    requestId: string;
    action: ManagedRuntimeAction;
    expectedGeneration: number;
  },
): Promise<ManagedRuntimeStatus> {
  const installationId = requireManagedInstallationId(env);
  if (
    input.installationId !== installationId ||
    !normalizeControlRequestId(input.requestId) ||
    !isManagedRuntimeAction(input.action) ||
    normalizeExpectedGeneration(input.expectedGeneration) === null
  ) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime control request is invalid",
      "managed_control_request_invalid",
      400,
    );
  }
  await ensureManagedRuntimeState(env, installationId);

  const claimed = await env.DB.prepare(
    `INSERT INTO managed_runtime_control_requests
       (request_id, installation_id, action, expected_generation, status, created_at)
     VALUES (?, ?, ?, ?, 'applying', CURRENT_TIMESTAMP)
     ON CONFLICT(request_id) DO NOTHING`,
  )
    .bind(
      input.requestId,
      installationId,
      input.action,
      input.expectedGeneration,
    )
    .run();
  if ((claimed.meta?.changes || 0) < 1) {
    const existing = await env.DB.prepare(
      `SELECT installation_id, action, expected_generation, status
       FROM managed_runtime_control_requests WHERE request_id = ?`,
    )
      .bind(input.requestId)
      .first<ManagedRuntimeControlRequestRow>();
    if (
      !existing ||
      existing.installation_id !== installationId ||
      existing.action !== input.action ||
      Number(existing.expected_generation) !== input.expectedGeneration
    ) {
      throw new ManagedRuntimeLifecycleError(
        "Managed runtime request id is already used",
        "managed_control_request_conflict",
        409,
      );
    }
    if (existing.status === "applied") return readManagedRuntimeStatus(env, installationId);
  }

  if (input.action === "quiesce") {
    await transitionManagedRuntime(
      env,
      installationId,
      input.requestId,
      input.expectedGeneration,
      "quiesced",
    );
  } else if (input.action === "suspend") {
    await transitionManagedRuntime(
      env,
      installationId,
      input.requestId,
      input.expectedGeneration,
      "suspended",
    );
  } else if (input.action === "resume") {
    await resumeManagedRuntime(
      env,
      installationId,
      input.requestId,
      input.expectedGeneration,
    );
  } else if (input.action === "revoke_credentials") {
    await revokeManagedRuntimeCredentials(
      env,
      installationId,
      input.requestId,
      input.expectedGeneration,
    );
  } else {
    await purgeManagedRuntimeStorage(
      env,
      installationId,
      input.requestId,
      input.expectedGeneration,
    );
  }

  const status = await readManagedRuntimeStatus(env, installationId);
  await env.DB.prepare(
    `UPDATE managed_runtime_control_requests
     SET status = 'applied', applied_generation = ?, completed_at = CURRENT_TIMESTAMP
     WHERE request_id = ? AND installation_id = ? AND action = ?`,
  )
    .bind(status.generation, input.requestId, installationId, input.action)
    .run();
  return status;
}

async function ensureManagedRuntimeState(
  env: Env,
  installationId: string,
): Promise<ManagedRuntimeStateRow> {
  await env.DB.prepare(
    `INSERT INTO managed_runtime_state
       (id, installation_id, state, generation, created_at, updated_at)
     VALUES ('managed', ?, 'active', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(installationId)
    .run();
  const row = await readManagedRuntimeState(env);
  if (!row || row.installation_id !== installationId) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime identity does not match persisted state",
      "managed_runtime_identity_mismatch",
      503,
    );
  }
  return row;
}

async function readManagedRuntimeState(env: Env): Promise<ManagedRuntimeStateRow | null> {
  return env.DB.prepare(
    `SELECT installation_id, state, generation, quiesced_at, suspended_at,
            credentials_revoked_at, storage_purged_at, last_request_id
     FROM managed_runtime_state WHERE id = 'managed'`,
  ).first<ManagedRuntimeStateRow>();
}

async function readManagedRuntimeStatus(
  env: Env,
  installationId: string,
): Promise<ManagedRuntimeStatus> {
  const row = await readManagedRuntimeState(env);
  if (!row || row.installation_id !== installationId) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime state is unavailable",
      "managed_runtime_state_unavailable",
      503,
    );
  }
  const activeWrites = await countActiveWriteLeases(env, installationId);
  return {
    installationId,
    lifecycleProtocol: MANAGED_RUNTIME_LIFECYCLE_PROTOCOL,
    portableExportPolicy: MANAGED_PORTABLE_EXPORT_POLICY,
    releaseVersion: ME3_CORE_VERSION,
    state: row.state,
    generation: Number(row.generation),
    quiescedAt: row.quiesced_at,
    suspendedAt: row.suspended_at,
    credentialsRevokedAt: row.credentials_revoked_at,
    storagePurgedAt: row.storage_purged_at,
    activeWrites,
    exportReady:
      row.state !== "active" && activeWrites === 0 && row.storage_purged_at === null,
  };
}

async function transitionManagedRuntime(
  env: Env,
  installationId: string,
  requestId: string,
  expectedGeneration: number,
  target: "quiesced" | "suspended",
): Promise<void> {
  const row = await readManagedRuntimeState(env);
  if (!row) throw stateUnavailable();
  if (row.last_request_id === requestId) return;
  if (Number(row.generation) !== expectedGeneration) throw stateConflict();
  if (target === "quiesced" && row.state === "suspended") {
    throw new ManagedRuntimeLifecycleError(
      "A suspended managed runtime cannot move back to quiesced",
      "managed_runtime_transition_forbidden",
      409,
    );
  }
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE managed_runtime_state
     SET state = ?, generation = generation + 1,
         quiesced_at = COALESCE(quiesced_at, ?),
         suspended_at = CASE WHEN ? = 'suspended' THEN COALESCE(suspended_at, ?) ELSE suspended_at END,
         last_request_id = ?, updated_at = ?
     WHERE id = 'managed' AND installation_id = ? AND generation = ?`,
  )
    .bind(target, now, target, now, requestId, now, installationId, expectedGeneration)
    .run();
  if ((result.meta?.changes || 0) < 1) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime state changed concurrently; retry with a new request",
      "managed_runtime_state_conflict",
      409,
    );
  }
}

async function resumeManagedRuntime(
  env: Env,
  installationId: string,
  requestId: string,
  expectedGeneration: number,
): Promise<void> {
  const row = await readManagedRuntimeState(env);
  if (!row) throw stateUnavailable();
  if (row.credentials_revoked_at || row.storage_purged_at) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime cannot resume after credentials or storage were revoked",
      "managed_runtime_resume_forbidden",
      409,
    );
  }
  if (row.last_request_id === requestId) return;
  if (Number(row.generation) !== expectedGeneration) throw stateConflict();
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE managed_runtime_state
     SET state = 'active', generation = generation + 1,
         quiesced_at = NULL, suspended_at = NULL,
         last_request_id = ?, updated_at = ?
     WHERE id = 'managed' AND installation_id = ? AND generation = ?`,
  )
    .bind(requestId, now, installationId, expectedGeneration)
    .run();
  if ((result.meta?.changes || 0) < 1) throw stateConflict();
}

async function revokeManagedRuntimeCredentials(
  env: Env,
  installationId: string,
  requestId: string,
  expectedGeneration: number,
): Promise<void> {
  await transitionManagedRuntime(
    env,
    installationId,
    requestId,
    expectedGeneration,
    "suspended",
  );
  await requireManagedRuntimeDrain(env, installationId);
  const row = await readManagedRuntimeState(env);
  if (!row) throw stateUnavailable();
  if (row.credentials_revoked_at) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM install_secrets WHERE name IN ('JWT_SECRET', 'ME3_CLOUD_CORE_TOKEN')"),
    env.DB.prepare(
      `UPDATE mobile_pairings SET status = 'revoked', updated_at = ?
       WHERE status IN ('pending', 'approved', 'claimed')`,
    ).bind(now),
    env.DB.prepare(
      `UPDATE mobile_refresh_tokens
       SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
       WHERE status IN ('active', 'rotated')`,
    ).bind(now, now),
    env.DB.prepare(
      `UPDATE local_executor_pairings
       SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
       WHERE status != 'revoked'`,
    ).bind(now, now),
    env.DB.prepare(
      `UPDATE local_executor_project_policies SET status = 'revoked', updated_at = ?
       WHERE status != 'revoked'`,
    ).bind(now),
    env.DB.prepare(
      `UPDATE mission_daemon_pairings
       SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
       WHERE status != 'revoked'`,
    ).bind(now, now),
    env.DB.prepare(
      `UPDATE mission_daemon_allowlist_entries SET status = 'revoked', updated_at = ?
       WHERE status != 'revoked'`,
    ).bind(now),
    env.DB.prepare(
      `UPDATE agent_channel_connections
       SET status = 'disconnected', setup_token = 'revoked:' || id,
           provider_connection_id = NULL, provider_user_id = NULL,
           provider_thread_id = NULL, disconnected_at = COALESCE(disconnected_at, ?),
           updated_at = ?
       WHERE status != 'disconnected' OR setup_token NOT LIKE 'revoked:%'`,
    ).bind(now, now),
    env.DB.prepare(
      `UPDATE social_accounts
       SET status = 'revoked', access_token_ciphertext = 'managed-credential-revoked',
           refresh_token_ciphertext = NULL, token_expires_at = NULL,
           scopes_json = '[]', last_verified_at = NULL, updated_at = ?
       WHERE status != 'revoked' OR access_token_ciphertext != 'managed-credential-revoked'`,
    ).bind(now),
    env.DB.prepare("DELETE FROM telegram_settings"),
    env.DB.prepare("DELETE FROM ai_gateway_settings"),
    env.DB.prepare("DELETE FROM social_oauth_states"),
    env.DB.prepare("DELETE FROM me3_install_claim_states"),
    env.DB.prepare(
      `DELETE FROM email_provider_settings WHERE provider_id = 'cloudflare-email'`,
    ),
    env.DB.prepare(
      `UPDATE managed_runtime_state
       SET credentials_revoked_at = ?, generation = generation + 1,
           last_request_id = ?, updated_at = ?
       WHERE id = 'managed' AND installation_id = ? AND credentials_revoked_at IS NULL`,
    ).bind(now, requestId, now, installationId),
  ]);
}

async function purgeManagedRuntimeStorage(
  env: Env,
  installationId: string,
  requestId: string,
  expectedGeneration: number,
): Promise<void> {
  const row = await readManagedRuntimeState(env);
  if (!row) throw stateUnavailable();
  if (
    row.last_request_id !== requestId &&
    Number(row.generation) !== expectedGeneration
  ) {
    throw stateConflict();
  }
  if (row.state !== "suspended" || !row.credentials_revoked_at) {
    throw new ManagedRuntimeLifecycleError(
      "Managed storage can only be purged after suspension and credential revocation",
      "managed_storage_purge_forbidden",
      409,
    );
  }
  await requireManagedRuntimeDrain(env, installationId);

  for (const agentNamespace of [env.ME3_USER_AGENT, env.ME3_SDK_USER_AGENT]) {
    if (!agentNamespace) continue;
    const objectId = agentNamespace.idFromName("owner");
    const response = await agentNamespace.get(objectId).fetch(
      new Request("https://me3-managed-internal/managed-lifecycle/purge-storage", {
        method: "POST",
        headers: { "X-ME3-Managed-Installation": installationId },
      }),
    );
    if (!response.ok) {
      throw new ManagedRuntimeLifecycleError(
        "Managed Durable Object storage purge did not complete",
        "managed_durable_object_purge_incomplete",
        503,
      );
    }
  }

  if (env.SITE_ASSETS) {
    let empty = false;
    for (let page = 0; page < MAX_STORAGE_PURGE_PAGES; page += 1) {
      const listed = await env.SITE_ASSETS.list({ limit: 1_000 });
      const keys = listed.objects.map((object) => object.key);
      if (keys.length === 0) {
        empty = true;
        break;
      }
      await env.SITE_ASSETS.delete(keys);
    }
    if (!empty || (await env.SITE_ASSETS.list({ limit: 1 })).objects.length > 0) {
      throw new ManagedRuntimeLifecycleError(
        "Managed storage purge did not reach an empty bucket",
        "managed_storage_purge_incomplete",
        503,
      );
    }
  }

  const now = new Date().toISOString();
  const marked = await env.DB.prepare(
    `UPDATE managed_runtime_state
     SET storage_purged_at = ?, generation = generation + 1,
         last_request_id = ?, updated_at = ?
     WHERE id = 'managed' AND installation_id = ?
       AND state = 'suspended'
       AND credentials_revoked_at IS NOT NULL
       AND storage_purged_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM managed_runtime_write_leases
         WHERE installation_id = ?
       )`,
  )
    .bind(now, requestId, now, installationId, installationId)
    .run();
  if ((marked.meta?.changes || 0) < 1) {
    const current = await readManagedRuntimeState(env);
    if (!current?.storage_purged_at) {
      throw new ManagedRuntimeLifecycleError(
        "Managed storage purge could not be committed while writes were active",
        "managed_runtime_not_drained",
        409,
      );
    }
  }
}

async function requireManagedRuntimeDrain(env: Env, installationId: string): Promise<void> {
  await removeStaleWriteLeases(env, installationId);
  if ((await countActiveWriteLeases(env, installationId)) > 0) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime still has active writes",
      "managed_runtime_not_drained",
      409,
    );
  }
}

async function removeStaleWriteLeases(env: Env, installationId: string): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM managed_runtime_write_leases
     WHERE installation_id = ?
       AND created_at < datetime('now', '-' || ? || ' minutes')`,
  )
    .bind(installationId, WRITE_LEASE_STALE_AFTER_MINUTES)
    .run();
}

async function countActiveWriteLeases(env: Env, installationId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM managed_runtime_write_leases WHERE installation_id = ?`,
  )
    .bind(installationId)
    .first<{ count: number | string }>();
  return Number(row?.count || 0);
}

function requireManagedInstallationId(env: Env): string {
  if (!isManagedRuntime(env)) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime controls are unavailable on self-hosted installations",
      "managed_runtime_unavailable",
      403,
    );
  }
  const installationId = getManagedInstallationId(env);
  if (!installationId) {
    throw new ManagedRuntimeLifecycleError(
      "Managed runtime installation identity is invalid",
      "managed_runtime_identity_invalid",
      503,
    );
  }
  return installationId;
}

function normalizeControlRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CONTROL_REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeExpectedGeneration(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null;
}

function normalizeMethod(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{1,12}$/.test(normalized) ? normalized : "OTHER";
}

function normalizePathClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^(api|auth_callback|queue|scheduled|email)$/.test(normalized)
    ? normalized
    : "api";
}

function stateUnavailable(): ManagedRuntimeLifecycleError {
  return new ManagedRuntimeLifecycleError(
    "Managed runtime state is unavailable",
    "managed_runtime_state_unavailable",
    503,
  );
}

function stateConflict(): ManagedRuntimeLifecycleError {
  return new ManagedRuntimeLifecycleError(
    "Managed runtime state changed concurrently; retry with a new request",
    "managed_runtime_state_conflict",
    409,
  );
}

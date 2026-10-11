import {
  DEFAULT_LOCAL_EXECUTOR_CAPS,
  DEFAULT_LOCAL_EXECUTOR_PROJECT_POLICY,
  LOCAL_EXECUTOR_PLUGIN_ID,
  type LocalExecutorAllowedGitTarget,
  type LocalExecutorCaps,
  type LocalExecutorCommandPolicy,
  type LocalExecutorDirtyRepoPolicy,
  type LocalExecutorLandingPolicy,
  type LocalExecutorProviderPresetId,
} from "@me3-core/plugin-local-executor";
import { isCorePluginEnabled } from "./plugins";
import type { Env } from "./types";

export class LocalExecutorInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 = 400,
  ) {
    super(message);
  }
}

type LocalExecutorPairingStatus = "pending" | "active" | "paused" | "revoked" | "unhealthy";
type LocalExecutorPolicyStatus = "active" | "paused" | "revoked" | "missing";
type LocalExecutorRunStatus =
  | "queued"
  | "waiting_for_approval"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "denied";
type LocalExecutorSourceKind = "manual" | "schedule" | "event";

type LocalExecutorPairingRow = {
  id: string;
  user_id: string;
  runner_id: string;
  display_name: string;
  public_key: string | null;
  token_hash: string;
  status: LocalExecutorPairingStatus;
  version: string | null;
  platform: string | null;
  last_seen_at: string | null;
  health_json: string;
  paired_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type LocalExecutorPolicyRow = {
  id: string;
  user_id: string;
  project_label: string;
  path_hint: string;
  resource_kind: "repo" | "directory";
  status: LocalExecutorPolicyStatus;
  provider_preset: LocalExecutorProviderPresetId;
  model_hint: string | null;
  default_branch: string;
  allowed_git_target: LocalExecutorAllowedGitTarget;
  landing_policy: LocalExecutorLandingPolicy;
  direct_main: number;
  command_policy_json: string;
  quality_gates_json: string;
  caps_json: string;
  dirty_repo: LocalExecutorDirtyRepoPolicy;
  created_at: string;
  updated_at: string;
};

type LocalExecutorRunRow = {
  id: string;
  user_id: string;
  project_policy_id: string;
  prompt_summary: string;
  prompt_text: string;
  source_kind: LocalExecutorSourceKind;
  status: LocalExecutorRunStatus;
  provider: LocalExecutorProviderPresetId;
  runner_id: string | null;
  approval_id: string | null;
  mission_agent_run_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  result_summary: string | null;
  output_preview: string | null;
  artifact_manifest_json: string;
  changed_files_json: string;
  quality_gates_json: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type LocalExecutorRunEventRow = {
  id: string;
  run_id: string;
  event_type: string;
  actor: string;
  message: string | null;
  payload_json: string;
  created_at: string;
};

type LocalExecutorAuditRow = {
  id: string;
  user_id: string;
  pairing_id: string | null;
  project_policy_id: string | null;
  run_id: string | null;
  approval_id: string | null;
  event_type: string;
  actor: string;
  summary: string;
  payload_json: string;
  created_at: string;
};

type LocalExecutorAuth = {
  pairing: LocalExecutorPairingRow;
};

type LocalExecutorRunCreateInput = {
  projectPolicyId?: unknown;
  prompt?: unknown;
  promptSummary?: unknown;
  sourceKind?: unknown;
  ownerDirected?: unknown;
  missionTaskId?: unknown;
  missionProjectId?: unknown;
  actionId?: string | null;
};

const DEFAULT_COMMAND_POLICY: LocalExecutorCommandPolicy =
  DEFAULT_LOCAL_EXECUTOR_PROJECT_POLICY.commandPolicy;

export async function getLocalExecutorSetupState(env: Env, userId: string) {
  try {
    const [pluginEnabled, pairing, policy] = await Promise.all([
      isCorePluginEnabled(env, LOCAL_EXECUTOR_PLUGIN_ID).catch(() => false),
      env.DB.prepare(
        `SELECT id
         FROM local_executor_pairings
         WHERE user_id = ? AND status = 'active'
         LIMIT 1`,
      )
        .bind(userId)
        .first<{ id: string }>(),
      env.DB.prepare(
        `SELECT id
         FROM local_executor_project_policies
         WHERE user_id = ? AND status = 'active'
         LIMIT 1`,
      )
        .bind(userId)
        .first<{ id: string }>(),
    ]);
    return {
      pluginEnabled,
      paired: Boolean(pairing),
      hasProjectPolicy: Boolean(policy),
      ready: pluginEnabled && Boolean(pairing) && Boolean(policy),
      nextAction: !pluginEnabled
        ? "activate_plugin"
        : !pairing
          ? "pair_local_runner"
          : !policy
            ? "add_project_policy"
            : "ready",
    };
  } catch {
    return {
      pluginEnabled: false,
      paired: false,
      hasProjectPolicy: false,
      ready: false,
      nextAction: "activate_plugin",
    };
  }
}

export async function isLocalExecutorSetupReady(env: Env, userId: string) {
  return (await getLocalExecutorSetupState(env, userId)).ready;
}

export async function getLocalExecutorStatus(env: Env, userId: string) {
  const [setup, pairings, policies, runs, audit] = await Promise.all([
    getLocalExecutorSetupState(env, userId),
    listPairingRows(env, userId),
    listPolicyRows(env, userId),
    env.DB.prepare(
      `SELECT *
       FROM local_executor_runs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
    )
      .bind(userId)
      .all<LocalExecutorRunRow>(),
    env.DB.prepare(
      `SELECT *
       FROM local_executor_audit_events
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 25`,
    )
      .bind(userId)
      .all<LocalExecutorAuditRow>(),
  ]);

  return {
    plugin: {
      id: LOCAL_EXECUTOR_PLUGIN_ID,
      enabled: setup.pluginEnabled,
      setupReady: setup.ready,
    },
    setup,
    pairings: pairings.map(serializePairing),
    policies: policies.map(serializePolicy),
    runs: (runs.results || []).map(serializeRun),
    audit: (audit.results || []).map(serializeAuditEvent),
  };
}

export async function startLocalExecutorPairing(
  env: Env,
  userId: string,
  input: unknown,
  options: { apiBase: string },
) {
  const body = isRecord(input) ? input : {};
  const runnerId = normalizeNullableText(body.runnerId) || `runner-${crypto.randomUUID()}`;
  const displayName = normalizeNullableText(body.displayName) || "Local runner";
  const pairingId = crypto.randomUUID();
  const code = createPairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const tokenHash = await sha256Text(`pending:${code}`);

  await env.DB.prepare(
    `INSERT INTO local_executor_pairings
       (id, user_id, runner_id, display_name, token_hash, status, health_json)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(
      pairingId,
      userId,
      runnerId,
      displayName,
      tokenHash,
      stringifyJson({ pairingCodeExpiresAt: expiresAt }),
    )
    .run();
  await appendLocalExecutorAudit(env, userId, {
    pairingId,
    eventType: "pair_requested",
    actor: "owner",
    summary: `Pairing started for ${displayName}`,
  });

  return {
    ok: true,
    pairing: {
      id: pairingId,
      runnerId,
      displayName,
      status: "pending",
    },
    code,
    expiresAt,
    installCommand: `me3-local-executor pair --api ${options.apiBase} --code ${code}`,
  };
}

export async function completeLocalExecutorPairing(env: Env, input: unknown) {
  const body = isRecord(input) ? input : {};
  const code = normalizeNullableText(body.code);
  if (!code) throw new LocalExecutorInputError("Pairing code is required");
  const tokenHash = await sha256Text(`pending:${code.toUpperCase()}`);
  const pending = await env.DB.prepare(
    `SELECT *
     FROM local_executor_pairings
     WHERE token_hash = ? AND status = 'pending'
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<LocalExecutorPairingRow>();
  if (!pending) throw new LocalExecutorInputError("Pairing code was not accepted", 401);

  const health = parseJsonRecord(pending.health_json);
  const expiresAt = typeof health.pairingCodeExpiresAt === "string" ? health.pairingCodeExpiresAt : null;
  if (expiresAt && Date.parse(expiresAt) < Date.now()) {
    throw new LocalExecutorInputError("Pairing code has expired", 410);
  }

  const token = createDaemonToken(pending.id);
  const now = new Date().toISOString();
  const runnerId = normalizeNullableText(body.runnerId) || pending.runner_id;
  const displayName = normalizeNullableText(body.displayName) || pending.display_name;
  const version = normalizeNullableText(body.version);
  const platform = normalizeNullableText(body.platform);
  await env.DB.prepare(
    `UPDATE local_executor_pairings
     SET runner_id = ?, display_name = ?, token_hash = ?, status = 'active',
         version = ?, platform = ?, paired_at = ?, last_seen_at = ?,
         health_json = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      runnerId,
      displayName,
      await sha256Text(token),
      version,
      platform,
      now,
      now,
      stringifyJson({ pairedAt: now }),
      now,
      pending.id,
    )
    .run();
  await appendLocalExecutorAudit(env, pending.user_id, {
    pairingId: pending.id,
    eventType: "paired",
    actor: "daemon",
    summary: `${displayName} paired`,
    payload: { runnerId, version, platform },
  });

  return {
    ok: true,
    runner: {
      id: pending.id,
      runnerId,
      displayName,
      status: "active",
    },
    token: {
      token,
      runnerId,
      tokenType: "bearer",
    },
  };
}

export async function authenticateLocalExecutorDaemon(
  env: Env,
  authorizationHeader: string | null,
): Promise<LocalExecutorAuth> {
  const token = bearerToken(authorizationHeader);
  if (!token) throw new LocalExecutorInputError("Daemon token is required", 401);
  const pairingId = pairingIdFromDaemonToken(token);
  if (!pairingId) throw new LocalExecutorInputError("Daemon token was not accepted", 401);

  const pairing = await env.DB.prepare(
    `SELECT *
     FROM local_executor_pairings
     WHERE id = ? AND status != 'revoked'
     LIMIT 1`,
  )
    .bind(pairingId)
    .first<LocalExecutorPairingRow>();
  if (!pairing || pairing.status === "pending") {
    throw new LocalExecutorInputError("Daemon token was not accepted", 401);
  }
  if (pairing.token_hash !== await sha256Text(token)) {
    throw new LocalExecutorInputError("Daemon token was not accepted", 401);
  }
  if (pairing.status === "paused" || pairing.status === "unhealthy") {
    throw new LocalExecutorInputError("Local runner is not active", 403);
  }
  return { pairing };
}

export async function listLocalExecutorPolicies(env: Env, userId: string) {
  return { policies: (await listPolicyRows(env, userId)).map(serializePolicy) };
}

export async function createLocalExecutorPolicy(env: Env, userId: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const projectLabel = normalizeNullableText(body.projectLabel);
  const pathHint = normalizeNullableText(body.pathHint);
  if (!projectLabel) throw new LocalExecutorInputError("Project label is required");
  if (!pathHint) throw new LocalExecutorInputError("Project path hint is required");

  const policy = normalizePolicyInput(body);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO local_executor_project_policies
       (id, user_id, project_label, path_hint, resource_kind, status, provider_preset,
        model_hint, default_branch, allowed_git_target, landing_policy, direct_main,
        command_policy_json, quality_gates_json, caps_json, dirty_repo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      projectLabel,
      pathHint,
      policy.resourceKind,
      policy.providerPreset,
      policy.modelHint,
      policy.defaultBranch,
      policy.allowedGitTarget,
      policy.landingPolicy,
      policy.directMain ? 1 : 0,
      stringifyJson(policy.commandPolicy),
      stringifyJson(policy.qualityGates),
      stringifyJson(policy.caps),
      policy.dirtyRepo,
      now,
      now,
    )
    .run();
  await appendLocalExecutorAudit(env, userId, {
    projectPolicyId: id,
    eventType: "policy_created",
    actor: "owner",
    summary: `Project policy added for ${projectLabel}`,
  });

  const row = await requirePolicy(env, userId, id);
  return { policy: serializePolicy(row) };
}

export async function updateLocalExecutorPolicy(
  env: Env,
  userId: string,
  policyId: string,
  input: unknown,
) {
  await requirePolicy(env, userId, policyId);
  const body = isRecord(input) ? input : {};
  const policy = normalizePolicyInput(body, true);
  const projectLabel = normalizeNullableText(body.projectLabel);
  const pathHint = normalizeNullableText(body.pathHint);
  const status = normalizePolicyStatus(body.status);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE local_executor_project_policies
     SET project_label = COALESCE(?, project_label),
         path_hint = COALESCE(?, path_hint),
         resource_kind = COALESCE(?, resource_kind),
         status = COALESCE(?, status),
         provider_preset = COALESCE(?, provider_preset),
         model_hint = COALESCE(?, model_hint),
         default_branch = COALESCE(?, default_branch),
         allowed_git_target = COALESCE(?, allowed_git_target),
         landing_policy = COALESCE(?, landing_policy),
         direct_main = COALESCE(?, direct_main),
         command_policy_json = COALESCE(?, command_policy_json),
         quality_gates_json = COALESCE(?, quality_gates_json),
         caps_json = COALESCE(?, caps_json),
         dirty_repo = COALESCE(?, dirty_repo),
         updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      projectLabel,
      pathHint,
      policy.resourceKind,
      status,
      policy.providerPreset,
      policy.modelHint,
      policy.defaultBranch,
      policy.allowedGitTarget,
      policy.landingPolicy,
      policy.directMain === null ? null : policy.directMain ? 1 : 0,
      policy.commandPolicy ? stringifyJson(policy.commandPolicy) : null,
      policy.qualityGates ? stringifyJson(policy.qualityGates) : null,
      policy.caps ? stringifyJson(policy.caps) : null,
      policy.dirtyRepo,
      now,
      policyId,
      userId,
    )
    .run();
  await appendLocalExecutorAudit(env, userId, {
    projectPolicyId: policyId,
    eventType: "policy_updated",
    actor: "owner",
    summary: "Project policy updated",
  });
  return { policy: serializePolicy(await requirePolicy(env, userId, policyId)) };
}

export async function deleteLocalExecutorPolicy(env: Env, userId: string, policyId: string) {
  await requirePolicy(env, userId, policyId);
  await env.DB.prepare(
    `UPDATE local_executor_project_policies
     SET status = 'revoked', updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(new Date().toISOString(), policyId, userId)
    .run();
  await appendLocalExecutorAudit(env, userId, {
    projectPolicyId: policyId,
    eventType: "policy_revoked",
    actor: "owner",
    summary: "Project policy revoked",
  });
  return { ok: true };
}

export async function createLocalExecutorRun(
  env: Env,
  userId: string,
  input: unknown,
) {
  return createLocalExecutorRunInternal(env, userId, normalizeRunCreateInput(input));
}

export async function getLocalExecutorRun(env: Env, userId: string, runId: string) {
  const run = await requireRun(env, userId, runId);
  const events = await env.DB.prepare(
    `SELECT *
     FROM local_executor_run_events
     WHERE run_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(runId)
    .all<LocalExecutorRunEventRow>();
  return {
    run: serializeRun(run),
    events: (events.results || []).map(serializeRunEvent),
    missionAgentRunId: run.mission_agent_run_id,
  };
}

export async function cancelLocalExecutorRun(
  env: Env,
  userId: string,
  runId: string,
  input: unknown,
) {
  const run = await requireRun(env, userId, runId);
  if (!canCancelLocalExecutorRun(run.status)) {
    throw new LocalExecutorInputError("This Local Executor run cannot be cancelled", 409);
  }

  const body = isRecord(input) ? input : {};
  const now = new Date().toISOString();
  const summary = boundText(
    normalizeNullableText(body.summary) || "Local run cancelled by the owner.",
    2000,
  );
  await env.DB.prepare(
    `UPDATE local_executor_runs
     SET status = 'cancelled', finished_at = ?, result_summary = ?,
         error_code = ?, error_message = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      now,
      summary,
      "owner_cancelled",
      normalizeNullableText(body.reason) || null,
      now,
      run.id,
      userId,
    )
    .run();
  await appendLocalExecutorRunEvent(env, run.id, {
    eventType: "cancelled",
    actor: "owner",
    message: summary,
    payload: {},
  });
  await appendLocalExecutorAudit(env, userId, {
    projectPolicyId: run.project_policy_id,
    runId: run.id,
    approvalId: run.approval_id,
    eventType: "run_cancelled",
    actor: "owner",
    summary,
  });

  const cancelled = await requireRun(env, userId, run.id);
  await upsertLocalExecutorMissionRun(env, userId, {
    run: cancelled,
    status: "cancelled",
  });
  await appendLocalExecutorMissionEvent(env, cancelled, "cancelled", summary, {
    status: "cancelled",
  });
  await appendLocalExecutorMissionActivity(env, userId, {
    title: `Local Executor: ${cancelled.prompt_summary}`,
    summary,
    status: "cancelled",
    relatedId: cancelled.id,
  });

  return { ok: true, run: serializeRun(cancelled) };
}

export async function retryLocalExecutorRun(
  env: Env,
  userId: string,
  runId: string,
  input: unknown,
) {
  const run = await requireRun(env, userId, runId);
  if (!canRetryLocalExecutorRun(run.status)) {
    throw new LocalExecutorInputError("This Local Executor run cannot be retried", 409);
  }

  const body = isRecord(input) ? input : {};
  const now = new Date().toISOString();
  const summary = boundText(
    normalizeNullableText(body.summary) || "Local run queued again by the owner.",
    2000,
  );
  await env.DB.prepare(
    `UPDATE local_executor_runs
     SET status = 'queued', runner_id = NULL, started_at = NULL, finished_at = NULL,
         result_summary = NULL, output_preview = NULL, artifact_manifest_json = '[]',
         changed_files_json = '[]', quality_gates_json = '[]',
         error_code = NULL, error_message = NULL, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(now, run.id, userId)
    .run();
  await appendLocalExecutorRunEvent(env, run.id, {
    eventType: "retried",
    actor: "owner",
    message: summary,
    payload: { previousStatus: run.status },
  });
  await appendLocalExecutorAudit(env, userId, {
    projectPolicyId: run.project_policy_id,
    runId: run.id,
    approvalId: run.approval_id,
    eventType: "run_retried",
    actor: "owner",
    summary,
    payload: { previousStatus: run.status },
  });

  const retried = await requireRun(env, userId, run.id);
  await upsertLocalExecutorMissionRun(env, userId, {
    run: retried,
    status: "queued",
  });
  await appendLocalExecutorMissionEvent(env, retried, "queued", summary, {
    previousStatus: run.status,
  });
  await appendLocalExecutorMissionActivity(env, userId, {
    title: `Local Executor: ${retried.prompt_summary}`,
    summary,
    status: "queued",
    relatedId: retried.id,
  });

  return { ok: true, run: serializeRun(retried) };
}

export async function listLocalExecutorAudit(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT *
     FROM local_executor_audit_events
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
  )
    .bind(userId)
    .all<LocalExecutorAuditRow>();
  return { audit: (rows.results || []).map(serializeAuditEvent) };
}

export async function recordLocalExecutorHeartbeat(
  env: Env,
  auth: LocalExecutorAuth,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const now = new Date().toISOString();
  const health = sanitizeRecord({
    health: isRecord(body.health) ? body.health : {},
    activePolicies: Array.isArray(body.activePolicies) ? body.activePolicies.slice(0, 20) : [],
    currentRun: isRecord(body.currentRun) ? body.currentRun : null,
  });
  await env.DB.prepare(
    `UPDATE local_executor_pairings
     SET version = COALESCE(?, version),
         platform = COALESCE(?, platform),
         last_seen_at = ?,
         health_json = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      normalizeNullableText(body.version),
      normalizeNullableText(body.platform),
      now,
      stringifyJson(health),
      now,
      auth.pairing.id,
    )
    .run();
  await appendLocalExecutorAudit(env, auth.pairing.user_id, {
    pairingId: auth.pairing.id,
    eventType: "heartbeat",
    actor: "daemon",
    summary: `${auth.pairing.display_name} checked in`,
    payload: health,
  });
  const pairing = await requirePairingById(env, auth.pairing.id);
  return { ok: true, runner: serializePairing(pairing) };
}

export async function claimLocalExecutorRun(
  env: Env,
  auth: LocalExecutorAuth,
  _input: unknown,
) {
  const run = await env.DB.prepare(
    `SELECT r.*
     FROM local_executor_runs r
     JOIN local_executor_project_policies p ON p.id = r.project_policy_id
     LEFT JOIN mission_approvals a ON a.id = r.approval_id
     WHERE r.user_id = ?
       AND p.status = 'active'
       AND (
         r.status = 'queued'
         OR (r.status = 'waiting_for_approval' AND a.status = 'approved')
       )
     ORDER BY r.created_at ASC
     LIMIT 1`,
  )
    .bind(auth.pairing.user_id)
    .first<LocalExecutorRunRow>();
  if (!run) return { ok: true, run: null };

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE local_executor_runs
     SET status = 'running', runner_id = ?, started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(auth.pairing.runner_id, now, now, run.id, auth.pairing.user_id)
    .run();
  await appendLocalExecutorRunEvent(env, run.id, {
    eventType: "claimed",
    actor: "daemon",
    message: `${auth.pairing.display_name} claimed the run`,
    payload: { runnerId: auth.pairing.runner_id },
  });
  await appendLocalExecutorAudit(env, auth.pairing.user_id, {
    pairingId: auth.pairing.id,
    projectPolicyId: run.project_policy_id,
    runId: run.id,
    approvalId: run.approval_id,
    eventType: "run_claimed",
    actor: "daemon",
    summary: `${auth.pairing.display_name} claimed a Local Executor run`,
  });
  await upsertLocalExecutorMissionRun(env, auth.pairing.user_id, {
    run: await requireRun(env, auth.pairing.user_id, run.id),
    status: "running",
  });

  const claimedRun = await requireRun(env, auth.pairing.user_id, run.id);
  const policy = await requirePolicy(env, auth.pairing.user_id, claimedRun.project_policy_id);
  return {
    ok: true,
    run: serializeRunForDaemon(claimedRun, policy),
  };
}

export async function appendLocalExecutorRunProgress(
  env: Env,
  auth: LocalExecutorAuth,
  runId: string,
  input: unknown,
) {
  const run = await requireRun(env, auth.pairing.user_id, runId);
  ensureRunOwnedByRunner(run, auth);
  const body = isRecord(input) ? input : {};
  await appendLocalExecutorRunEvent(env, run.id, {
    eventType: normalizeNullableText(body.eventType) || "progress",
    actor: "daemon",
    message: normalizeNullableText(body.message),
    payload: sanitizeRecord(isRecord(body.payload) ? body.payload : {}),
  });
  return getLocalExecutorRun(env, auth.pairing.user_id, run.id);
}

export async function completeLocalExecutorRun(
  env: Env,
  auth: LocalExecutorAuth,
  runId: string,
  input: unknown,
) {
  const run = await requireRun(env, auth.pairing.user_id, runId);
  ensureRunOwnedByRunner(run, auth);
  const policy = await requirePolicy(env, auth.pairing.user_id, run.project_policy_id);
  const body = isRecord(input) ? input : {};
  const status = normalizeRunFinalStatus(body.status);
  if (!status) throw new LocalExecutorInputError("Valid final run status is required");
  const caps = policyCaps(policy);
  const now = new Date().toISOString();
  const summary = boundText(
    normalizeNullableText(body.summary) ||
      (status === "succeeded" ? "Local run completed." : "Local run did not complete."),
    2000,
  );
  const outputPreview = boundText(normalizeNullableText(body.outputPreview) || "", caps.maxOutputChars);
  const changedFiles = normalizeStringArray(body.changedFiles).slice(0, caps.maxChangedFiles);
  const qualityGates = Array.isArray(body.qualityGates) ? body.qualityGates.slice(0, 20) : [];
  const artifacts = boundedArtifacts(body.artifacts, caps.maxArtifactBytes);
  const errorCode = normalizeNullableText(body.errorCode);
  const errorMessage = boundText(normalizeNullableText(body.errorMessage) || "", 2000) || null;

  await env.DB.prepare(
    `UPDATE local_executor_runs
     SET status = ?, finished_at = ?, result_summary = ?, output_preview = ?,
         artifact_manifest_json = ?, changed_files_json = ?, quality_gates_json = ?,
         error_code = ?, error_message = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      status,
      now,
      summary,
      outputPreview || null,
      stringifyJson(artifacts),
      stringifyJson(changedFiles),
      stringifyJson(qualityGates),
      errorCode,
      errorMessage,
      now,
      run.id,
      auth.pairing.user_id,
    )
    .run();
  await appendLocalExecutorRunEvent(env, run.id, {
    eventType: "completed",
    actor: "daemon",
    message: summary,
    payload: {
      status,
      changedFileCount: changedFiles.length,
      artifactCount: artifacts.length,
    },
  });
  await appendLocalExecutorAudit(env, auth.pairing.user_id, {
    pairingId: auth.pairing.id,
    projectPolicyId: run.project_policy_id,
    runId: run.id,
    approvalId: run.approval_id,
    eventType: "run_completed",
    actor: "daemon",
    summary,
    payload: { status },
  });

  const completed = await requireRun(env, auth.pairing.user_id, run.id);
  await upsertLocalExecutorMissionRun(env, auth.pairing.user_id, {
    run: completed,
    status: missionStatusFromLocalRun(status),
  });
  if (status === "succeeded") {
    await moveLinkedMissionTaskToDone(env, auth.pairing.user_id, completed);
  }
  await appendLocalExecutorMissionEvent(env, completed, "completed", summary, { status });
  await appendLocalExecutorMissionActivity(env, auth.pairing.user_id, {
    title: `Local Executor: ${completed.prompt_summary}`,
    summary,
    status,
    relatedId: completed.id,
  });

  return { ok: true, run: serializeRun(completed) };
}

async function createLocalExecutorRunInternal(
  env: Env,
  userId: string,
  input: LocalExecutorRunCreateInput,
) {
  const setup = await getLocalExecutorSetupState(env, userId);
  if (!setup.pluginEnabled) throw new LocalExecutorInputError("Local Executor plugin is disabled", 403);
  if (!setup.paired) throw new LocalExecutorInputError("Pair a local runner before creating runs", 409);

  const policy = input.projectPolicyId
    ? await requirePolicy(env, userId, String(input.projectPolicyId))
    : await getDefaultPolicy(env, userId);
  if (!policy || policy.status !== "active") {
    throw new LocalExecutorInputError("An active project policy is required", 409);
  }

  const prompt = normalizeNullableText(input.prompt);
  if (!prompt) throw new LocalExecutorInputError("Run prompt is required");
  const missionTaskId = normalizeNullableText(input.missionTaskId);
  const missionProjectId = normalizeNullableText(input.missionProjectId);
  if (missionTaskId) {
    const existing = await getActiveLocalExecutorRunForMissionTask(env, userId, missionTaskId);
    if (existing) return { run: serializeRun(existing), approvalId: existing.approval_id };
  }
  const sourceKind = normalizeSourceKind(input.sourceKind) || "manual";
  const ownerDirected =
    input.ownerDirected !== false && sourceKind === "manual";
  const approvalRequired = !ownerDirected;
  const runId = crypto.randomUUID();
  const missionAgentRunId = localExecutorMissionRunId(runId);
  const approvalId = approvalRequired
    ? await createLocalExecutorApproval(env, userId, {
        runId,
        actionId: input.actionId || "local_executor.run",
        title: "Approve Local Executor run",
        summary: summarizePrompt(prompt),
        policy,
      })
    : null;
  const now = new Date().toISOString();
  const status: LocalExecutorRunStatus = approvalRequired ? "waiting_for_approval" : "queued";
  const promptSummary = summarizePrompt(normalizeNullableText(input.promptSummary) || prompt);

  await env.DB.prepare(
    `INSERT INTO local_executor_runs
       (id, user_id, project_policy_id,
        prompt_summary, prompt_text, source_kind, status, provider, approval_id,
        mission_agent_run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      userId,
      policy.id,
      promptSummary,
      prompt,
      sourceKind,
      status,
      policy.provider_preset,
      approvalId,
      missionAgentRunId,
      now,
      now,
    )
    .run();
  await appendLocalExecutorRunEvent(env, runId, {
    eventType: "requested",
    actor: ownerDirected ? "owner" : "core",
    message: approvalRequired
      ? "Local Executor run is waiting for approval"
      : "Local Executor run queued",
    payload: { sourceKind, approvalRequired },
  });
  await appendLocalExecutorAudit(env, userId, {
    projectPolicyId: policy.id,
    runId,
    approvalId,
    eventType: "run_requested",
    actor: ownerDirected ? "owner" : "core",
    summary: approvalRequired
      ? "Local Executor run requested approval"
      : "Local Executor run queued",
  });

  const row = await requireRun(env, userId, runId);
  await upsertLocalExecutorMissionRun(env, userId, {
    run: row,
    status: "queued",
    missionTaskId,
    missionProjectId,
  });
  await appendLocalExecutorMissionActivity(env, userId, {
    title: `Local Executor: ${promptSummary}`,
    summary: approvalRequired ? "Waiting for approval." : "Queued for a local runner.",
    status,
    relatedId: runId,
  });

  return { run: serializeRun(row), approvalId };
}

async function createLocalExecutorApproval(
  env: Env,
  userId: string,
  input: {
    runId: string;
    actionId: string;
    title: string;
    summary: string;
    policy: LocalExecutorPolicyRow;
  },
) {
  const approvalId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO mission_approvals
       (id, user_id, plugin_id, action_id, title, summary, payload_json, risk_level, requested_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'medium', 'local_executor', NULL)`,
  )
    .bind(
      approvalId,
      userId,
      LOCAL_EXECUTOR_PLUGIN_ID,
      input.actionId,
      input.title,
      input.summary,
      stringifyJson({
        localExecutorRunId: input.runId,
        projectPolicyId: input.policy.id,
        providerPreset: input.policy.provider_preset,
        landingPolicy: input.policy.landing_policy,
      }),
    )
    .run();
  return approvalId;
}

async function upsertLocalExecutorMissionRun(
  env: Env,
  userId: string,
  input: {
    run: LocalExecutorRunRow;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    missionTaskId?: string | null;
    missionProjectId?: string | null;
  },
) {
  const now = new Date().toISOString();
  const missionRunId = input.run.mission_agent_run_id || localExecutorMissionRunId(input.run.id);
  const existingLink =
    input.missionTaskId || input.missionProjectId
      ? null
      : await getLocalExecutorMissionRunLink(env, userId, missionRunId);
  const missionTaskId = normalizeNullableText(input.missionTaskId) || existingLink?.taskId || null;
  const missionProjectId =
    normalizeNullableText(input.missionProjectId) || existingLink?.projectId || null;
  const result = {
    localExecutorRunId: input.run.id,
    localExecutorTaskId: missionTaskId,
    status: input.run.status,
    summary: input.run.result_summary,
    outputPreview: input.run.output_preview,
    changedFiles: parseJsonStringArray(input.run.changed_files_json),
    qualityGates: parseJsonArray(input.run.quality_gates_json),
    approvalId: input.run.approval_id,
  };
  await env.DB.prepare(
    `INSERT INTO mission_agent_runs
       (id, user_id, source, project_id, task_id, approval_id, title, prompt_summary, status,
        model, runner_id, started_at, finished_at, result_json, artifact_manifest_json, created_at, updated_at)
     VALUES (?, ?, 'daemon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id = COALESCE(excluded.project_id, mission_agent_runs.project_id),
       task_id = COALESCE(excluded.task_id, mission_agent_runs.task_id),
       approval_id = excluded.approval_id,
       prompt_summary = excluded.prompt_summary,
       status = excluded.status,
       model = excluded.model,
       runner_id = excluded.runner_id,
       started_at = COALESCE(mission_agent_runs.started_at, excluded.started_at),
       finished_at = excluded.finished_at,
       result_json = excluded.result_json,
       artifact_manifest_json = excluded.artifact_manifest_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      missionRunId,
      userId,
      missionProjectId,
      missionTaskId,
      input.run.approval_id,
      `Local Executor: ${input.run.prompt_summary}`,
      input.run.prompt_summary,
      input.status,
      input.run.provider,
      input.run.runner_id,
      input.run.started_at,
      input.run.finished_at,
      stringifyJson(result),
      input.run.artifact_manifest_json || "[]",
      now,
      now,
    )
    .run();
}

async function getLocalExecutorMissionRunLink(env: Env, userId: string, missionRunId: string) {
  const row = await env.DB.prepare(
    `SELECT project_id, task_id
     FROM mission_agent_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
  )
    .bind(missionRunId, userId)
    .first<{ project_id: string | null; task_id: string | null }>();
  return {
    projectId: row?.project_id || null,
    taskId: row?.task_id || null,
  };
}

async function getActiveLocalExecutorRunForMissionTask(
  env: Env,
  userId: string,
  taskId: string,
) {
  const row = await env.DB.prepare(
    `SELECT result_json
     FROM mission_agent_runs
     WHERE user_id = ? AND task_id = ? AND source = 'daemon'
       AND status IN ('queued', 'running')
     ORDER BY COALESCE(started_at, created_at) DESC
     LIMIT 1`,
  )
    .bind(userId, taskId)
    .first<{ result_json: string | null }>();
  const runId = normalizeNullableText(
    parseJsonRecord(row?.result_json ?? null).localExecutorRunId,
  );
  if (!runId) return null;
  try {
    return await requireRun(env, userId, runId);
  } catch {
    return null;
  }
}

async function moveLinkedMissionTaskToDone(
  env: Env,
  userId: string,
  run: LocalExecutorRunRow,
) {
  const link = await getLocalExecutorMissionRunLink(
    env,
    userId,
    run.mission_agent_run_id || localExecutorMissionRunId(run.id),
  );
  if (!link.taskId) return;
  await env.DB.prepare(
    `UPDATE mission_tasks
     SET status = 'done', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND archived_at IS NULL
       AND status NOT IN ('done', 'cancelled')`,
  )
    .bind(link.taskId, userId)
    .run();
}

async function appendLocalExecutorMissionEvent(
  env: Env,
  run: LocalExecutorRunRow,
  eventType: string,
  message: string,
  payload: Record<string, unknown>,
) {
  const missionRunId = run.mission_agent_run_id || localExecutorMissionRunId(run.id);
  await env.DB.prepare(
    `INSERT INTO mission_agent_run_events
       (id, run_id, event_type, message, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), missionRunId, eventType, message, stringifyJson(sanitizeRecord(payload)))
    .run();
}

async function appendLocalExecutorMissionActivity(
  env: Env,
  userId: string,
  input: {
    title: string;
    summary: string;
    status: string;
    relatedId: string;
  },
) {
  await env.DB.prepare(
    `INSERT INTO mission_plugin_activity
       (id, user_id, plugin_id, activity_type, title, summary, status, related_id, metadata_json, created_at)
     VALUES (?, ?, ?, 'local_executor.run', ?, ?, ?, ?, '{}', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      LOCAL_EXECUTOR_PLUGIN_ID,
      input.title,
      input.summary,
      input.status,
      input.relatedId,
      new Date().toISOString(),
    )
    .run();
}

async function listPairingRows(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT *
     FROM local_executor_pairings
     WHERE user_id = ? AND status != 'revoked'
     ORDER BY COALESCE(last_seen_at, created_at) DESC
     LIMIT 10`,
  )
    .bind(userId)
    .all<LocalExecutorPairingRow>();
  return rows.results || [];
}

async function listPolicyRows(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT *
     FROM local_executor_project_policies
     WHERE user_id = ? AND status != 'revoked'
     ORDER BY updated_at DESC, created_at DESC`,
  )
    .bind(userId)
    .all<LocalExecutorPolicyRow>();
  return rows.results || [];
}

async function getDefaultPolicy(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT *
     FROM local_executor_project_policies
     WHERE user_id = ? AND status = 'active'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<LocalExecutorPolicyRow>();
}

async function requirePolicy(env: Env, userId: string, policyId: string) {
  const row = await env.DB.prepare(
    `SELECT *
     FROM local_executor_project_policies
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
  )
    .bind(policyId, userId)
    .first<LocalExecutorPolicyRow>();
  if (!row) throw new LocalExecutorInputError("Project policy not found", 404);
  return row;
}

async function requireRun(env: Env, userId: string, runId: string) {
  const row = await env.DB.prepare(
    `SELECT *
     FROM local_executor_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
  )
    .bind(runId, userId)
    .first<LocalExecutorRunRow>();
  if (!row) throw new LocalExecutorInputError("Local Executor run not found", 404);
  return row;
}

async function requirePairingById(env: Env, pairingId: string) {
  const row = await env.DB.prepare(
    `SELECT *
     FROM local_executor_pairings
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(pairingId)
    .first<LocalExecutorPairingRow>();
  if (!row) throw new LocalExecutorInputError("Local runner not found", 404);
  return row;
}

async function appendLocalExecutorRunEvent(
  env: Env,
  runId: string,
  input: {
    eventType: string;
    actor: string;
    message?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  await env.DB.prepare(
    `INSERT INTO local_executor_run_events
       (id, run_id, event_type, actor, message, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      runId,
      input.eventType,
      input.actor,
      input.message || null,
      stringifyJson(sanitizeRecord(input.payload || {})),
    )
    .run();
}

async function appendLocalExecutorAudit(
  env: Env,
  userId: string,
  input: {
    pairingId?: string | null;
    projectPolicyId?: string | null;
    runId?: string | null;
    approvalId?: string | null;
    eventType: string;
    actor: string;
    summary: string;
    payload?: Record<string, unknown>;
  },
) {
  await env.DB.prepare(
    `INSERT INTO local_executor_audit_events
       (id, user_id, pairing_id, project_policy_id, run_id, approval_id, event_type, actor, summary, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      input.pairingId || null,
      input.projectPolicyId || null,
      input.runId || null,
      input.approvalId || null,
      input.eventType,
      input.actor,
      input.summary,
      stringifyJson(sanitizeRecord(input.payload || {})),
    )
    .run();
}

function serializePairing(row: LocalExecutorPairingRow) {
  return {
    id: row.id,
    runnerId: row.runner_id,
    displayName: row.display_name,
    status: row.status,
    version: row.version,
    platform: row.platform,
    lastSeenAt: row.last_seen_at,
    health: parseJsonRecord(row.health_json),
    pairedAt: row.paired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializePolicy(row: LocalExecutorPolicyRow) {
  return {
    id: row.id,
    projectLabel: row.project_label,
    pathHint: row.path_hint,
    resourceKind: row.resource_kind,
    status: row.status,
    providerPreset: row.provider_preset,
    modelHint: row.model_hint,
    defaultBranch: row.default_branch,
    allowedGitTarget: row.allowed_git_target,
    landingPolicy: row.landing_policy,
    directMain: row.direct_main !== 0,
    commandPolicy: policyCommandPolicy(row),
    qualityGates: parseJsonStringArray(row.quality_gates_json),
    caps: policyCaps(row),
    dirtyRepo: row.dirty_repo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRun(row: LocalExecutorRunRow) {
  return {
    id: row.id,
    projectPolicyId: row.project_policy_id,
    promptSummary: row.prompt_summary,
    sourceKind: row.source_kind,
    status: row.status,
    provider: row.provider,
    runnerId: row.runner_id,
    approvalId: row.approval_id,
    missionAgentRunId: row.mission_agent_run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    resultSummary: row.result_summary,
    outputPreview: row.output_preview,
    artifacts: parseJsonArray(row.artifact_manifest_json),
    changedFiles: parseJsonStringArray(row.changed_files_json),
    qualityGates: parseJsonArray(row.quality_gates_json),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRunForDaemon(run: LocalExecutorRunRow, policy: LocalExecutorPolicyRow) {
  return {
    ...serializeRun(run),
    prompt: run.prompt_text,
    policy: serializePolicy(policy),
  };
}

function serializeRunEvent(row: LocalExecutorRunEventRow) {
  return {
    id: row.id,
    runId: row.run_id,
    eventType: row.event_type,
    actor: row.actor,
    message: row.message,
    payload: parseJsonRecord(row.payload_json),
    createdAt: row.created_at,
  };
}

function serializeAuditEvent(row: LocalExecutorAuditRow) {
  return {
    id: row.id,
    pairingId: row.pairing_id,
    projectPolicyId: row.project_policy_id,
    runId: row.run_id,
    approvalId: row.approval_id,
    eventType: row.event_type,
    actor: row.actor,
    summary: row.summary,
    payload: parseJsonRecord(row.payload_json),
    createdAt: row.created_at,
  };
}

function normalizeRunCreateInput(input: unknown): LocalExecutorRunCreateInput {
  const body = isRecord(input) ? input : {};
  return {
    projectPolicyId: normalizeNullableText(body.projectPolicyId),
    prompt: normalizeNullableText(body.prompt) || normalizeNullableText(body.task),
    promptSummary: normalizeNullableText(body.promptSummary) || normalizeNullableText(body.taskSummary),
    sourceKind: normalizeSourceKind(body.sourceKind) || normalizeSourceKind(body.triggerKind),
    ownerDirected: body.ownerDirected,
    missionTaskId: normalizeNullableText(body.missionTaskId),
    missionProjectId: normalizeNullableText(body.missionProjectId),
  };
}

function normalizePolicyInput(input: Record<string, unknown>, partial = false) {
  const providerPreset = normalizeProviderPreset(input.providerPreset);
  const allowedGitTarget = normalizeGitTarget(input.allowedGitTarget);
  const landingPolicy = normalizeLandingPolicy(input.landingPolicy);
  const dirtyRepo = normalizeDirtyRepo(input.dirtyRepo);
  const resourceKind = normalizeResourceKind(input.resourceKind);
  const commandPolicy = normalizeCommandPolicy(input.commandPolicy);
  const qualityGates = normalizeStringArray(input.qualityGates);
  const caps = normalizeCaps(input.caps);

  return {
    resourceKind: resourceKind ?? (partial ? null : "repo"),
    providerPreset: providerPreset ?? (partial ? null : "opencode"),
    modelHint: normalizeNullableText(input.modelHint),
    defaultBranch: normalizeNullableText(input.defaultBranch) ?? (partial ? null : "main"),
    allowedGitTarget: allowedGitTarget ?? (partial ? null : "none"),
    landingPolicy: landingPolicy ?? (partial ? null : "report_only"),
    directMain: typeof input.directMain === "boolean" ? input.directMain : partial ? null : false,
    commandPolicy: commandPolicy ?? (partial ? null : DEFAULT_COMMAND_POLICY),
    qualityGates: partial && !Array.isArray(input.qualityGates) ? null : qualityGates,
    caps: caps ?? (partial ? null : DEFAULT_LOCAL_EXECUTOR_CAPS),
    dirtyRepo: dirtyRepo ?? (partial ? null : "block"),
  };
}

function normalizeProviderPreset(value: unknown): LocalExecutorProviderPresetId | null {
  return value === "opencode" || value === "codex" || value === "claude" ? value : null;
}

function normalizeGitTarget(value: unknown): LocalExecutorAllowedGitTarget | null {
  return value === "none" || value === "branch" || value === "main" ? value : null;
}

function normalizeLandingPolicy(value: unknown): LocalExecutorLandingPolicy | null {
  return value === "report_only" || value === "commit" || value === "push" ? value : null;
}

function normalizeDirtyRepo(value: unknown): LocalExecutorDirtyRepoPolicy | null {
  return value === "block" || value === "allow" ? value : null;
}

function normalizeResourceKind(value: unknown): "repo" | "directory" | null {
  return value === "repo" || value === "directory" ? value : null;
}

function normalizePolicyStatus(value: unknown): LocalExecutorPolicyStatus | null {
  return value === "active" || value === "paused" || value === "revoked" || value === "missing"
    ? value
    : null;
}

function normalizeSourceKind(value: unknown): LocalExecutorSourceKind | null {
  return value === "manual" || value === "schedule" || value === "event"
    ? value
    : null;
}

function normalizeRunFinalStatus(value: unknown): Extract<
  LocalExecutorRunStatus,
  "succeeded" | "failed" | "cancelled" | "denied"
> | null {
  return value === "succeeded" || value === "failed" || value === "cancelled" || value === "denied"
    ? value
    : null;
}

function canCancelLocalExecutorRun(status: LocalExecutorRunStatus) {
  return status === "queued" || status === "waiting_for_approval" || status === "running";
}

function canRetryLocalExecutorRun(status: LocalExecutorRunStatus) {
  return status === "running" || status === "failed" || status === "cancelled";
}

function normalizeCommandPolicy(value: unknown): LocalExecutorCommandPolicy | null {
  if (!isRecord(value)) return null;
  return {
    allowCommands: normalizeStringArray(value.allowCommands),
    denyCommands: normalizeStringArray(value.denyCommands),
  };
}

function normalizeCaps(value: unknown): LocalExecutorCaps | null {
  if (!isRecord(value)) return null;
  return {
    maxRuntimeSeconds: positiveInteger(value.maxRuntimeSeconds, DEFAULT_LOCAL_EXECUTOR_CAPS.maxRuntimeSeconds),
    maxOutputChars: positiveInteger(value.maxOutputChars, DEFAULT_LOCAL_EXECUTOR_CAPS.maxOutputChars),
    maxArtifactBytes: positiveInteger(value.maxArtifactBytes, DEFAULT_LOCAL_EXECUTOR_CAPS.maxArtifactBytes),
    maxChangedFiles: positiveInteger(value.maxChangedFiles, DEFAULT_LOCAL_EXECUTOR_CAPS.maxChangedFiles),
  };
}

function policyCommandPolicy(row: LocalExecutorPolicyRow): LocalExecutorCommandPolicy {
  const parsed = parseJsonRecord(row.command_policy_json);
  return {
    allowCommands: normalizeStringArray(parsed.allowCommands).length
      ? normalizeStringArray(parsed.allowCommands)
      : DEFAULT_COMMAND_POLICY.allowCommands,
    denyCommands: normalizeStringArray(parsed.denyCommands).length
      ? normalizeStringArray(parsed.denyCommands)
      : DEFAULT_COMMAND_POLICY.denyCommands,
  };
}

function policyCaps(row: LocalExecutorPolicyRow): LocalExecutorCaps {
  const parsed = normalizeCaps(parseJsonRecord(row.caps_json));
  return parsed || DEFAULT_LOCAL_EXECUTOR_CAPS;
}

function positiveInteger(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function boundedArtifacts(value: unknown, maxBytes: number) {
  if (!Array.isArray(value)) return [];
  const artifacts = [];
  let totalBytes = 0;
  for (const item of value) {
    if (!isRecord(item)) continue;
    const bytes = positiveInteger(item.bytes, 0);
    if (totalBytes + bytes > maxBytes) break;
    totalBytes += bytes;
    artifacts.push(sanitizeRecord(item));
    if (artifacts.length >= 25) break;
  }
  return artifacts;
}

function ensureRunOwnedByRunner(run: LocalExecutorRunRow, auth: LocalExecutorAuth) {
  if (run.runner_id && run.runner_id !== auth.pairing.runner_id) {
    throw new LocalExecutorInputError("Run belongs to another local runner", 403);
  }
}

function missionStatusFromLocalRun(
  status: Extract<LocalExecutorRunStatus, "succeeded" | "failed" | "cancelled" | "denied">,
) {
  if (status === "succeeded") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function localExecutorMissionRunId(runId: string) {
  return `local-executor-run:${runId}`;
}

function summarizePrompt(value: string) {
  return boundText(value.replace(/\s+/g, " ").trim(), 160) || "Local Executor run";
}

function boundText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 24))}\n[output truncated]`;
}

function bearerToken(value: string | null) {
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] || null;
}

function createDaemonToken(pairingId: string) {
  const secret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  return `me3lex_${pairingId}_${secret}`;
}

function pairingIdFromDaemonToken(token: string) {
  const match = /^me3lex_([0-9a-f-]{36})_[a-z0-9]+$/i.exec(token);
  return match?.[1] || null;
}

function createPairingCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function sha256Text(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|authorization|api[_-]?key|password/i.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    if (isRecord(item)) {
      output[key] = sanitizeRecord(item);
    } else if (Array.isArray(item)) {
      output[key] = item.map((entry) => (isRecord(entry) ? sanitizeRecord(entry) : entry));
    } else {
      output[key] = item;
    }
  }
  return output;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeNullableText(item))
    .filter((item): item is string => Boolean(item));
}

function parseJsonArray(value: string | null): unknown[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonStringArray(value: string | null) {
  return normalizeStringArray(parseJsonArray(value));
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

import {
  COMPUTER_SCHEMA_STATEMENTS, ComputerLimitError, finishComputerJob, computerJobTurnId, computerUsageDay, createComputerJob, dailyBrowsingMs, listComputerJobs, listComputerSteps,
  loadComputerJob, loadOwnerComputerLimits, markComputerJobPublished, parseComputerCeiling, parseOwnerComputerLimits, requestComputerCancel, resolveComputerLimits,
  saveOwnerComputerLimits, type BrowserScreenshot, type ComputerChatServices, type ComputerJob, type ComputerJobView,
} from "../../../packages/agent/src/computer";
import type { AgentImage } from "../../../packages/agent/src/types";
import { notifyAgentBackgroundResult } from "./agent-notifications";
import type { Env } from "./types";

/**
 * Agent computer (Core): background browser jobs run by the owner's ME3_AGENT
 * Durable Object. The feature exists only when the installation has a Browser
 * Run binding; without it the tools are hidden and the routes report why.
 * Managed installations pass their plan ceiling in ME3_AGENT_COMPUTER_LIMITS.
 */
export const AGENT_COMPUTER_SCHEMA = COMPUTER_SCHEMA_STATEMENTS;

export type ComputerAvailability = { available: boolean; reason: string | null };
export function computerAvailability(env: Env): ComputerAvailability {
  if (!env.BROWSER) return { available: false, reason: "This installation has no Browser Run binding. Add a [browser] binding named BROWSER on Workers Paid to turn on the agent computer." };
  if (!env.ME3_AGENT) return { available: false, reason: "The agent runtime is unavailable." };
  return { available: true, reason: null };
}

export class ComputerRequestError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}

export const computerCeiling = (env: Env) => parseComputerCeiling(env.ME3_AGENT_COMPUTER_LIMITS);
export async function effectiveComputerLimits(env: Env, ownerId: string) {
  return resolveComputerLimits(await loadOwnerComputerLimits(env.DB, ownerId), computerCeiling(env));
}
async function ownerTimezone(env: Env, ownerId: string) {
  const owner = await env.DB.prepare("SELECT timezone FROM owner_profile WHERE id=?").bind(ownerId).first<{ timezone: string | null }>();
  return owner?.timezone || "UTC";
}

export async function getComputerSettings(env: Env, ownerId: string) {
  const ceiling = computerCeiling(env);
  const ownerLimits = await loadOwnerComputerLimits(env.DB, ownerId);
  const limits = resolveComputerLimits(ownerLimits, ceiling);
  const usageDay = computerUsageDay(await ownerTimezone(env, ownerId));
  const usedMs = await dailyBrowsingMs(env.DB, ownerId, usageDay);
  return {
    ...computerAvailability(env), limits, ownerLimits, ceiling,
    today: { day: usageDay, usedMinutes: Math.round(usedMs / 6_000) / 10, remainingMinutes: Math.max(0, Math.round((limits.dailyBrowserMinutes * 60_000 - usedMs) / 6_000) / 10) },
  };
}

export async function saveComputerSettings(env: Env, ownerId: string, body: unknown) {
  const input = body && typeof body === "object" && !Array.isArray(body) && "limits" in body ? (body as { limits: unknown }).limits : body;
  let parsed;
  try { parsed = parseOwnerComputerLimits(input, computerCeiling(env)); }
  catch (error) { if (error instanceof ComputerLimitError) throw new ComputerRequestError(error.message, 400); throw error; }
  await saveOwnerComputerLimits(env.DB, ownerId, parsed);
  return getComputerSettings(env, ownerId);
}

/** Owner and model view of a job. Page-derived text stays marked as untrusted. */
export function computerJobView(job: ComputerJob, steps?: Awaited<ReturnType<typeof listComputerSteps>>): ComputerJobView {
  return {
    id: job.id, status: job.status, endReason: job.endReason, goal: job.goal, startUrl: job.startUrl, threadId: job.threadId,
    steps: job.steps, browsingMinutes: Math.round(job.browsingMs / 6_000) / 10, limits: job.limits, cancelRequested: job.cancelRequested,
    createdAt: job.createdAt, finishedAt: job.finishedAt,
    ...(job.result ? { result: { ...job.result, untrustedSources: true } } : {}),
    ...(steps ? { recentSteps: steps.slice(-15).map(step => ({ seq: step.seq, kind: step.kind, ...step.data, at: step.createdAt })) } : {}),
  };
}

export async function getComputerJob(env: Env, ownerId: string, jobId: string) {
  const job = await loadComputerJob(env.DB, ownerId, jobId);
  if (!job) throw new ComputerRequestError("Computer job not found", 404);
  return computerJobView(job, await listComputerSteps(env.DB, ownerId, jobId));
}
export async function listComputerJobViews(env: Env, ownerId: string, options: { threadId?: string; limit?: number } = {}) {
  return (await listComputerJobs(env.DB, ownerId, options)).map(job => computerJobView(job));
}

/** Records the cancel request durably; the Durable Object aborts the live run. */
export async function requestComputerJobCancel(env: Env, ownerId: string, jobId: string) {
  const job = await requestComputerCancel(env.DB, ownerId, jobId);
  if (!job) throw new ComputerRequestError("Computer job not found", 404);
  return job;
}

export type ComputerJobHost = {
  start(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
};

/**
 * A job whose host vanished without recovery would hold the one running slot
 * forever. Jobs silent for longer than any job can legitimately run are ended.
 */
export async function expireStaleComputerJobs(env: Env, ownerId: string) {
  const stale = await env.DB.prepare(`SELECT id FROM me3_agent_computer_jobs WHERE owner_id=? AND status='running'
    AND julianday(updated_at) < julianday('now') - (COALESCE(json_extract(limits_json,'$.maxBrowsingMinutesPerJob'),20) + COALESCE(json_extract(limits_json,'$.maxTakeoverMinutes'),30) + 15) / 1440.0`)
    .bind(ownerId).all<{ id: string }>();
  for (const row of stale.results ?? []) {
    const job = await loadComputerJob(env.DB, ownerId, row.id);
    if (!job) continue;
    await finishComputerJob(env.DB, ownerId, job.id, "interrupted", "recovery_limit", { summary: "The browser job stopped responding and was ended. Nothing was submitted or changed. Ask me to start it again.", pages: [], artifacts: [], steps: job.steps, browsingSeconds: Math.round(job.browsingMs / 1000) });
    const ended = await loadComputerJob(env.DB, ownerId, job.id);
    if (ended) await publishComputerJobResult(env, ended);
  }
}

/** Chat-turn services. `host` is the owner's ME3_AGENT instance running the turn. */
export function createComputerChatServices(env: Env, ownerId: string, host: ComputerJobHost): ComputerChatServices {
  return {
    async start(input, scope) {
      const availability = computerAvailability(env);
      if (!availability.available) throw new Error(availability.reason ?? "The agent computer is unavailable.");
      await expireStaleComputerJobs(env, ownerId);
      const job = await createComputerJob(env.DB, {
        id: crypto.randomUUID(), ownerId, threadId: scope.threadId, originTurnId: scope.turnId, originCallId: scope.callId,
        goal: input.goal, startUrl: input.startUrl, limits: await effectiveComputerLimits(env, ownerId), usageDay: computerUsageDay(await ownerTimezone(env, ownerId)),
      });
      if (job.status === "running") await host.start(job.id);
      return computerJobView(job);
    },
    async status(jobId) {
      if (jobId) return getComputerJob(env, ownerId, jobId);
      return { jobs: await listComputerJobViews(env, ownerId, { limit: 5 }) };
    },
    async cancel(jobId) {
      const job = await requestComputerJobCancel(env, ownerId, jobId);
      if (job.status === "running") await host.cancel(jobId);
      return computerJobView((await loadComputerJob(env.DB, ownerId, jobId)) ?? job);
    },
  };
}

/** Saves a screenshot as a private conversation image so the model can view it through the normal image path. */
export async function saveComputerScreenshot(env: Env, job: ComputerJob, shot: BrowserScreenshot): Promise<{ artifactId: string; image: AgentImage }> {
  if (!env.SITE_ASSETS) throw new Error("Private screenshot storage is unavailable on this installation.");
  if (shot.bytes.byteLength > 5 * 1024 * 1024) throw new Error("The screenshot is too large to save.");
  const artifactId = crypto.randomUUID(), attachmentId = `computer-${artifactId}`;
  const extension = shot.mimeType === "image/png" ? "png" : "jpg";
  const storageKey = `assistant/${job.ownerId}/computer/${job.id}/${artifactId}.${extension}`;
  const bytes = new Uint8Array(shot.bytes);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  await env.SITE_ASSETS.put(storageKey, bytes, { httpMetadata: { contentType: shot.mimeType }, customMetadata: { ownerId: job.ownerId, computerJobId: job.id, sha256 } });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO assistant_attachments(id,owner_id,thread_id,filename,mime_type,size,kind,status,storage_key,metadata_json)
      VALUES(?,?,?,?,?,?,'image','ready',?,?)`).bind(attachmentId, job.ownerId, job.threadId, `screenshot.${extension}`, shot.mimeType, shot.bytes.byteLength, storageKey, JSON.stringify({ computerJobId: job.id, pageUrl: shot.url, sha256, untrusted: true })),
    env.DB.prepare("INSERT INTO me3_agent_computer_artifacts(id,owner_id,job_id,kind,attachment_id,page_url) VALUES(?,?,?,'screenshot',?,?)").bind(artifactId, job.ownerId, job.id, attachmentId, shot.url),
  ]);
  return { artifactId, image: { url: `me3-attachment:${encodeURIComponent(attachmentId)}`, mimeType: shot.mimeType } };
}

/**
 * Posts a finished job into its conversation as an assistant message whose ID
 * clients anchor to, then uses the background-work notification path. Safe to
 * repeat: the message and notification are keyed by the job.
 */
export async function publishComputerJobResult(env: Env, job: ComputerJob) {
  if (job.status === "running") return;
  const turnId = computerJobTurnId(job.id);
  const messageId = `${turnId}:assistant:${job.status}:final`;
  const replyText = job.result?.summary || "The computer job ended without a result.";
  const payload = {
    ok: job.status === "complete", runtime: "agent", turnId, threadId: job.threadId, status: job.status, replyText,
    computerJob: { id: job.id, status: job.status, endReason: job.endReason, goal: job.goal, pages: job.result?.pages ?? [], steps: job.result?.steps ?? job.steps, browsingSeconds: job.result?.browsingSeconds ?? 0, artifacts: job.result?.artifacts ?? [], untrustedSources: true },
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json)
      SELECT ?,?,?,'assistant',?,? WHERE EXISTS(SELECT 1 FROM assistant_threads WHERE id=? AND owner_id=?)`).bind(messageId, job.ownerId, job.threadId, replyText, JSON.stringify(payload), job.threadId, job.ownerId),
    ...(job.result?.artifacts ?? []).map((artifact, index) => env.DB.prepare(`INSERT OR IGNORE INTO assistant_message_assets(id,owner_id,thread_id,message_id,attachment_id,role,display_order,metadata_json)
      SELECT ?,?,?,?,?,'generated_output',?,? WHERE EXISTS(SELECT 1 FROM assistant_messages WHERE id=? AND owner_id=?)
        AND EXISTS(SELECT 1 FROM assistant_attachments WHERE id=? AND owner_id=? AND thread_id=? AND status='ready' AND kind='image')`)
      .bind(`${messageId}:image:${artifact.attachmentId}`, job.ownerId, job.threadId, messageId, artifact.attachmentId, index, JSON.stringify({ computerJobId: job.id, pageUrl: artifact.pageUrl }), messageId, job.ownerId, artifact.attachmentId, job.ownerId, job.threadId)),
    env.DB.prepare("UPDATE assistant_threads SET updated_at=CURRENT_TIMESTAMP,last_message_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(job.threadId, job.ownerId),
  ]);
  await markComputerJobPublished(env.DB, job.ownerId, job.id);
  // Cancellation does not notify, matching chat turns.
  if (job.status !== "cancelled") await notifyAgentBackgroundResult(env, job.ownerId, { resultId: turnId, threadId: job.threadId, kind: "complete" });
}

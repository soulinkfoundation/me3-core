import { createD1TurnStore } from "../store";
import type { AgentCheckpoint, AgentDb, AgentTurnStore } from "../types";
import { ComputerLimitError, type ComputerLimits } from "./limits";

/**
 * D1 owns computer jobs: the record, ordered steps, artifacts and the job's own
 * loop checkpoint. Durable Object memory only holds the live browser session,
 * which is disposable. Tables travel with portable export.
 */
export const COMPUTER_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS me3_agent_computer_jobs (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    origin_turn_id TEXT NOT NULL, origin_call_id TEXT NOT NULL,
    goal TEXT NOT NULL, start_url TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','complete','failed','cancelled','interrupted')),
    end_reason TEXT, limits_json TEXT NOT NULL, usage_day TEXT NOT NULL,
    browsing_ms INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, session_losses INTEGER NOT NULL DEFAULT 0,
    checkpoint_json TEXT, result_json TEXT, cancel_requested_at TEXT, published_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
    UNIQUE(owner_id, origin_turn_id, origin_call_id)
  )`,
  `CREATE INDEX IF NOT EXISTS me3_agent_computer_jobs_owner ON me3_agent_computer_jobs(owner_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS me3_agent_computer_jobs_day ON me3_agent_computer_jobs(owner_id, usage_day)`,
  `CREATE TABLE IF NOT EXISTS me3_agent_computer_steps (
    owner_id TEXT NOT NULL, job_id TEXT NOT NULL, seq INTEGER NOT NULL,
    kind TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(job_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS me3_agent_computer_artifacts (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('screenshot')), attachment_id TEXT NOT NULL,
    page_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS me3_agent_computer_artifacts_job ON me3_agent_computer_artifacts(owner_id, job_id)`,
  `CREATE TABLE IF NOT EXISTS me3_agent_computer_settings (
    owner_id TEXT PRIMARY KEY, limits_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
] as const;

export type ComputerJobStatus = "running" | "complete" | "failed" | "cancelled" | "interrupted";
export type ComputerEndReason = "finished" | "answered" | "step_limit" | "time_limit" | "daily_limit" | "session_lost" | "owner_cancelled" | "model_failed" | "recovery_limit";
export type ComputerJobResult = {
  summary: string;
  pages: Array<{ url: string; title: string }>;
  artifacts: Array<{ id: string; attachmentId: string; pageUrl: string }>;
  steps: number;
  browsingSeconds: number;
};
export type ComputerJob = {
  id: string; ownerId: string; threadId: string; originTurnId: string; originCallId: string;
  goal: string; startUrl: string | null; status: ComputerJobStatus; endReason: ComputerEndReason | null;
  limits: ComputerLimits; usageDay: string; browsingMs: number; steps: number; attempts: number; sessionLosses: number;
  cancelRequested: boolean; result: ComputerJobResult | null; publishedAt: string | null;
  createdAt: string; updatedAt: string; finishedAt: string | null;
};
type JobRow = {
  id: string; owner_id: string; thread_id: string; origin_turn_id: string; origin_call_id: string; goal: string; start_url: string | null;
  status: ComputerJobStatus; end_reason: ComputerEndReason | null; limits_json: string; usage_day: string; browsing_ms: number; steps: number;
  attempts: number; session_losses: number; result_json: string | null; cancel_requested_at: string | null; published_at: string | null;
  created_at: string; updated_at: string; finished_at: string | null;
};

export const computerJobTurnId = (jobId: string) => `computer:${jobId}`;

/** The owner's calendar day for the daily browser budget. */
export function computerUsageDay(timezone: string, now = new Date()): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
}

function toJob(row: JobRow): ComputerJob {
  return {
    id: row.id, ownerId: row.owner_id, threadId: row.thread_id, originTurnId: row.origin_turn_id, originCallId: row.origin_call_id,
    goal: row.goal, startUrl: row.start_url, status: row.status, endReason: row.end_reason, limits: JSON.parse(row.limits_json) as ComputerLimits,
    usageDay: row.usage_day, browsingMs: row.browsing_ms, steps: row.steps, attempts: row.attempts, sessionLosses: row.session_losses,
    cancelRequested: Boolean(row.cancel_requested_at), result: row.result_json ? JSON.parse(row.result_json) as ComputerJobResult : null,
    publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at,
  };
}

export async function loadComputerJob(db: AgentDb, ownerId: string, jobId: string): Promise<ComputerJob | null> {
  const row = await db.prepare("SELECT * FROM me3_agent_computer_jobs WHERE owner_id=? AND id=?").bind(ownerId, jobId).first<JobRow>();
  return row ? toJob(row) : null;
}

export async function listComputerJobs(db: AgentDb, ownerId: string, options: { threadId?: string; status?: ComputerJobStatus; limit?: number } = {}): Promise<ComputerJob[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10), 1), 50);
  const rows = await db.prepare(`SELECT * FROM me3_agent_computer_jobs WHERE owner_id=? AND (? IS NULL OR thread_id=?) AND (? IS NULL OR status=?)
    ORDER BY created_at DESC, rowid DESC LIMIT ?`).bind(ownerId, options.threadId ?? null, options.threadId ?? null, options.status ?? null, options.status ?? null, limit).all<JobRow>();
  return (rows.results ?? []).map(toJob);
}

export async function dailyBrowsingMs(db: AgentDb, ownerId: string, usageDay: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(browsing_ms),0) AS used FROM me3_agent_computer_jobs WHERE owner_id=? AND usage_day=?").bind(ownerId, usageDay).first<{ used: number }>();
  return Number(row?.used ?? 0);
}

export type CreateComputerJobInput = { id: string; ownerId: string; threadId: string; originTurnId: string; originCallId: string; goal: string; startUrl: string | null; limits: ComputerLimits; usageDay: string };

/** Admits a job atomically against the running-job and daily limits. A retried tool call returns the same job. */
export async function createComputerJob(db: AgentDb, input: CreateComputerJobInput): Promise<ComputerJob> {
  const existing = await db.prepare("SELECT * FROM me3_agent_computer_jobs WHERE owner_id=? AND origin_turn_id=? AND origin_call_id=?").bind(input.ownerId, input.originTurnId, input.originCallId).first<JobRow>();
  if (existing) return toJob(existing);
  const dailyMs = input.limits.dailyBrowserMinutes * 60_000;
  await db.prepare(`INSERT OR IGNORE INTO me3_agent_computer_jobs(id,owner_id,thread_id,origin_turn_id,origin_call_id,goal,start_url,limits_json,usage_day)
    SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM me3_agent_computer_jobs WHERE owner_id=? AND status='running') < ?
      AND (SELECT COALESCE(SUM(browsing_ms),0) FROM me3_agent_computer_jobs WHERE owner_id=? AND usage_day=?) < ?`)
    .bind(input.id, input.ownerId, input.threadId, input.originTurnId, input.originCallId, input.goal, input.startUrl, JSON.stringify(input.limits), input.usageDay,
      input.ownerId, input.limits.maxRunningJobs, input.ownerId, input.usageDay, dailyMs).run();
  const saved = await db.prepare("SELECT * FROM me3_agent_computer_jobs WHERE owner_id=? AND origin_turn_id=? AND origin_call_id=?").bind(input.ownerId, input.originTurnId, input.originCallId).first<JobRow>();
  if (saved) return toJob(saved);
  const running = await db.prepare("SELECT COUNT(*) AS count FROM me3_agent_computer_jobs WHERE owner_id=? AND status='running'").bind(input.ownerId).first<{ count: number }>();
  if (Number(running?.count ?? 0) >= input.limits.maxRunningJobs) throw new ComputerLimitError(`A computer job is already running (limit ${input.limits.maxRunningJobs}). Wait for it to finish or cancel it first.`);
  throw new ComputerLimitError(`Today's browser budget of ${input.limits.dailyBrowserMinutes} minutes is used up. The owner can change it in settings.`);
}

export async function appendComputerStep(db: AgentDb, ownerId: string, jobId: string, kind: string, data: Record<string, unknown> = {}): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await db.prepare(`INSERT OR IGNORE INTO me3_agent_computer_steps(owner_id,job_id,seq,kind,data_json)
      SELECT ?,?,COALESCE(MAX(seq),0)+1,?,? FROM me3_agent_computer_steps WHERE job_id=?`).bind(ownerId, jobId, kind, JSON.stringify(data), jobId).run();
    if (inserted.meta?.changes) {
      const row = await db.prepare("SELECT MAX(seq) AS seq FROM me3_agent_computer_steps WHERE job_id=? AND owner_id=?").bind(jobId, ownerId).first<{ seq: number }>();
      return Number(row?.seq ?? 0);
    }
  }
  throw new Error("Computer job step could not be recorded");
}

export async function listComputerSteps(db: AgentDb, ownerId: string, jobId: string, afterSeq = 0, limit = 100) {
  const rows = await db.prepare("SELECT seq,kind,data_json,created_at FROM me3_agent_computer_steps WHERE owner_id=? AND job_id=? AND seq>? ORDER BY seq LIMIT ?")
    .bind(ownerId, jobId, afterSeq, Math.min(Math.max(limit, 1), 500)).all<{ seq: number; kind: string; data_json: string; created_at: string }>();
  return (rows.results ?? []).map(row => ({ seq: row.seq, kind: row.kind, data: JSON.parse(row.data_json) as Record<string, unknown>, createdAt: row.created_at }));
}

export async function requestComputerCancel(db: AgentDb, ownerId: string, jobId: string): Promise<ComputerJob | null> {
  await db.prepare("UPDATE me3_agent_computer_jobs SET cancel_requested_at=COALESCE(cancel_requested_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='running'").bind(ownerId, jobId).run();
  return loadComputerJob(db, ownerId, jobId);
}

/** Starts another execution attempt; returns null when the job is no longer running. */
export async function beginComputerAttempt(db: AgentDb, ownerId: string, jobId: string): Promise<ComputerJob | null> {
  await db.prepare("UPDATE me3_agent_computer_jobs SET attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='running'").bind(ownerId, jobId).run();
  const job = await loadComputerJob(db, ownerId, jobId);
  return job?.status === "running" ? job : null;
}

export async function recordComputerProgress(db: AgentDb, ownerId: string, jobId: string, progress: { browsingMs: number; steps: number; sessionLosses: number }) {
  await db.prepare("UPDATE me3_agent_computer_jobs SET browsing_ms=MAX(browsing_ms,?),steps=MAX(steps,?),session_losses=MAX(session_losses,?),updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='running'")
    .bind(Math.round(progress.browsingMs), progress.steps, progress.sessionLosses, ownerId, jobId).run();
}

/** Moves a running job to its terminal state exactly once. */
export async function finishComputerJob(db: AgentDb, ownerId: string, jobId: string, status: Exclude<ComputerJobStatus, "running">, endReason: ComputerEndReason, result: ComputerJobResult): Promise<boolean> {
  const updated = await db.prepare(`UPDATE me3_agent_computer_jobs SET status=?,end_reason=?,result_json=?,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE owner_id=? AND id=? AND status='running'`).bind(status, endReason, JSON.stringify(result), ownerId, jobId).run();
  return Boolean(updated.meta?.changes);
}

export async function markComputerJobPublished(db: AgentDb, ownerId: string, jobId: string) {
  await db.prepare("UPDATE me3_agent_computer_jobs SET published_at=COALESCE(published_at,CURRENT_TIMESTAMP) WHERE owner_id=? AND id=? AND status<>'running'").bind(ownerId, jobId).run();
}

export async function listComputerArtifacts(db: AgentDb, ownerId: string, jobId: string) {
  const rows = await db.prepare("SELECT id,attachment_id,page_url FROM me3_agent_computer_artifacts WHERE owner_id=? AND job_id=? ORDER BY created_at, rowid").bind(ownerId, jobId).all<{ id: string; attachment_id: string; page_url: string }>();
  return (rows.results ?? []).map(row => ({ id: row.id, attachmentId: row.attachment_id, pageUrl: row.page_url }));
}

export async function loadOwnerComputerLimits(db: AgentDb, ownerId: string): Promise<Partial<ComputerLimits>> {
  const row = await db.prepare("SELECT limits_json FROM me3_agent_computer_settings WHERE owner_id=?").bind(ownerId).first<{ limits_json: string }>();
  try { return row ? JSON.parse(row.limits_json) as Partial<ComputerLimits> : {}; } catch { return {}; }
}
export async function saveOwnerComputerLimits(db: AgentDb, ownerId: string, limits: Partial<ComputerLimits>) {
  await db.prepare(`INSERT INTO me3_agent_computer_settings(owner_id,limits_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(owner_id) DO UPDATE SET limits_json=excluded.limits_json,updated_at=CURRENT_TIMESTAMP`).bind(ownerId, JSON.stringify(limits)).run();
}

/**
 * The job's own loop store. The checkpoint lives on the job row; tool receipts
 * reuse the agent receipt table under the job's turn ID; cancellation is the
 * job's durable cancel request.
 */
export function createComputerJobStore(db: AgentDb, job: Pick<ComputerJob, "id" | "ownerId" | "threadId">): AgentTurnStore {
  const turnId = computerJobTurnId(job.id);
  const base = createD1TurnStore(db, { ownerId: job.ownerId, threadId: job.threadId, turnId, requestId: turnId });
  return {
    ...base,
    async cancellationRequested() {
      const row = await db.prepare("SELECT cancel_requested_at,status FROM me3_agent_computer_jobs WHERE owner_id=? AND id=?").bind(job.ownerId, job.id).first<{ cancel_requested_at: string | null; status: string }>();
      return !row || Boolean(row.cancel_requested_at) || row.status !== "running";
    },
    async load() {
      const row = await db.prepare("SELECT checkpoint_json FROM me3_agent_computer_jobs WHERE owner_id=? AND id=?").bind(job.ownerId, job.id).first<{ checkpoint_json: string | null }>();
      return row?.checkpoint_json ? JSON.parse(row.checkpoint_json) as AgentCheckpoint : null;
    },
    async save(checkpoint) {
      await db.prepare("UPDATE me3_agent_computer_jobs SET checkpoint_json=?,steps=MAX(steps,?),updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?")
        .bind(JSON.stringify(checkpoint), checkpoint.steps, job.ownerId, job.id).run();
    },
  };
}

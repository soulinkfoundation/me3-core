import {
  computerJobTurnId, dailyBrowsingMs, finishComputerJob, loadComputerJob, runComputerJob, type BrowserDriver, type ComputerJob, type ComputerJobOutcome,
} from "../../../packages/agent/src/computer";
import { createAgentModels, bindingModelSupportsImageInput } from "./agent-runtime";
import { computerAvailability, publishComputerJobResult, saveComputerScreenshot } from "./agent-computer";
import { createBrowserRunDriver } from "./browser-run-driver";
import { beginManagedRuntimeWriteLease, isManagedRuntime, releaseManagedRuntimeWriteLease } from "./managed-runtime-lifecycle";
import type { Env } from "./types";

/**
 * Runs one computer job inside the owner's ME3_AGENT Durable Object. Model
 * steps use the same receipts, managed admission and allowance fallback as chat
 * turns. A host abort leaves the job resumable; any other failure ends it with
 * a reported result so a stuck job never blocks the owner's next one.
 */
export async function executeComputerJob(env: Env, ownerId: string, jobId: string, signal: AbortSignal, options: { driver?: BrowserDriver } = {}): Promise<ComputerJobOutcome> {
  const job = await loadComputerJob(env.DB, ownerId, jobId);
  if (!job) return { status: "failed", job: null };
  if (job.status !== "running") { await publishComputerJobResult(env, job); return { status: job.status, job }; }
  const availability = computerAvailability(env);
  if (!options.driver && !availability.available) return endJob(env, job, `The job stopped because ${availability.reason ?? "the agent computer is unavailable"} Nothing was submitted or changed.`);
  const lease = await beginManagedRuntimeWriteLease(env, "POST", "assistant_agent");
  if (isManagedRuntime(env) && !lease) throw new Error("Managed runtime is not accepting agent writes");
  try {
    const owner = await env.DB.prepare("SELECT name,timezone FROM owner_profile WHERE id=?").bind(ownerId).first<{ name: string | null; timezone: string | null }>();
    if (!owner) return endJob(env, job, "The job stopped because the owner profile is unavailable.");
    const turnId = computerJobTurnId(jobId);
    const models = await createAgentModels(env, { userId: ownerId, threadId: job.threadId, turnId, requestId: turnId });
    return await runComputerJob({
      db: env.DB, ownerId, jobId, ownerName: owner.name || "the owner", ownerTimezone: owner.timezone || "UTC",
      model: models.model, backupModel: models.backup, modelSupportsImages: bindingModelSupportsImageInput(models.model.id),
      driver: options.driver ?? createBrowserRunDriver(env.BROWSER!),
      // Usage recorded so far includes this job's own time, which its own budget already accounts for.
      dailyRemainingMs: async current => current.limits.dailyBrowserMinutes * 60_000 - (await dailyBrowsingMs(env.DB, ownerId, current.usageDay) - current.browsingMs),
      saveScreenshot: ({ job: current, shot }) => saveComputerScreenshot(env, current, shot),
      publish: current => publishComputerJobResult(env, current),
      signal,
    });
  } catch (error) {
    const current = await loadComputerJob(env.DB, ownerId, jobId);
    if (current?.cancelRequested) return endJob(env, job, "The job was cancelled. Nothing was submitted or changed.", "cancelled");
    // A host shutdown leaves the job resumable from its checkpoint.
    if (signal.aborted) throw error;
    return endJob(env, job, `I couldn't run the browser job: ${error instanceof Error ? error.message : "unknown error"}. Nothing was submitted or changed.`);
  } finally {
    await releaseManagedRuntimeWriteLease(env, lease);
  }
}

async function endJob(env: Env, job: ComputerJob, summary: string, status: "failed" | "cancelled" = "failed"): Promise<ComputerJobOutcome> {
  await finishComputerJob(env.DB, job.ownerId, job.id, status, status === "cancelled" ? "owner_cancelled" : "model_failed", { summary, pages: [], artifacts: [], steps: job.steps, browsingSeconds: Math.round(job.browsingMs / 1000) });
  const current = await loadComputerJob(env.DB, job.ownerId, job.id);
  if (current) await publishComputerJobResult(env, current);
  return { status: current?.status ?? "failed", job: current };
}

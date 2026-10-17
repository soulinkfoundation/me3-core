import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_SCHEMA_STATEMENTS } from "../../../packages/agent/src/store";
import { COMPUTER_SCHEMA_STATEMENTS, DEFAULT_COMPUTER_LIMITS, createComputerJob, loadComputerJob } from "../../../packages/agent/src/computer";
import type { Env } from "./types";

// Failure modes: a job started from chat never running; Stop not reaching a live
// job or leaving an idle job running; a Durable Object restart not resuming a job;
// a recovery hook blocking on a long job; purge discarding a live job.
const runtime = vi.hoisted(() => ({ runs: [] as Array<{ jobId: string; signal: AbortSignal }>, gate: undefined as Promise<void> | undefined }));
vi.mock("agents", () => ({ Agent: class {
  env: Env; ctx: unknown; fibers = new Map<string, Promise<void>>();
  constructor(ctx: unknown, env: Env) { this.ctx = ctx; this.env = env; }
  async startFiber(_name: string, fn: (context: unknown) => Promise<void>, options: { fiberId: string; waitForCompletion: boolean }) {
    if (!this.fibers.has(options.fiberId)) this.fibers.set(options.fiberId, Promise.resolve().then(() => fn({ id: options.fiberId, signal: new AbortController().signal, stash() {} })).catch(() => {}));
    if (options.waitForCompletion) await this.fibers.get(options.fiberId);
  }
} }));
vi.mock("./agent-computer-runner", () => ({ executeComputerJob: vi.fn(async (_env: Env, _owner: string, jobId: string, signal: AbortSignal) => {
  runtime.runs.push({ jobId, signal });
  await runtime.gate;
  return { status: "running", job: null };
}) }));
vi.mock("./agent-runtime", () => ({ executeNewAgentTurn: vi.fn(), isNewAgentDispatchInput: () => false }));
vi.mock("./assistant-primary-thread", () => ({ resolvePrimaryAssistantThread: async () => ({ id: "thread" }) }));
import { Me3Agent } from "./me3-agent";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); runtime.runs = []; runtime.gate = undefined; });
function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  for (const sql of [...AGENT_SCHEMA_STATEMENTS, ...COMPUTER_SCHEMA_STATEMENTS]) raw.exec(sql);
  const DB = { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; } };
    return statement;
  } };
  const env = { DB, ME3_MANAGED_INSTALLATION_ID: "mi-0123456789abcdef" } as unknown as Env;
  const agent = new Me3Agent({ storage: { deleteAll: async () => undefined, list: async () => new Map() } } as unknown as DurableObjectState, env);
  return { raw, env, agent };
}
const newJob = (env: Env) => createComputerJob(env.DB as never, { id: "job-1", ownerId: "owner", threadId: "thread", originTurnId: "turn", originCallId: "call", goal: "Find a kettle", startUrl: null, limits: { ...DEFAULT_COMPUTER_LIMITS }, usageDay: "2026-10-17" });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("computer jobs in the owner's agent Durable Object", () => {
  it("aborts a live job on Stop after recording the cancel durably", async () => {
    const { env, agent } = fixture();
    await newJob(env);
    let release!: () => void; runtime.gate = new Promise(resolve => { release = resolve; });
    await (agent as unknown as { startComputerJob(owner: string, job: string): Promise<void> }).startComputerJob("owner", "job-1");
    await tick();
    expect(runtime.runs).toHaveLength(1);
    const response = await agent.onRequest(new Request("https://agent/computer/cancel", { method: "POST", body: JSON.stringify({ userId: "owner", jobId: "job-1" }) }));
    expect(response.status).toBe(200);
    expect(runtime.runs[0].signal.aborted).toBe(true);
    expect((await loadComputerJob(env.DB as never, "owner", "job-1"))?.cancelRequested).toBe(true);
    // A live job blocks storage purge.
    expect((await agent.onRequest(new Request("https://agent/managed-lifecycle/purge-storage", { method: "POST", headers: { "X-ME3-Managed-Installation": "mi-0123456789abcdef" } }))).status).toBe(409);
    release(); await tick();
  });

  it("settles Stop for a job with no live run by running it once", async () => {
    const { env, agent } = fixture();
    await newJob(env);
    await agent.onRequest(new Request("https://agent/computer/cancel", { method: "POST", body: JSON.stringify({ userId: "owner", jobId: "job-1" }) }));
    await tick();
    expect(runtime.runs.map(run => run.jobId)).toEqual(["job-1"]);
  });

  it("resumes a recovered job in a new attempt without waiting for it", async () => {
    const { env, raw, agent } = fixture();
    await newJob(env);
    raw.exec("UPDATE me3_agent_computer_jobs SET attempts=1");
    runtime.gate = new Promise(() => undefined);
    const result = await agent.onFiberRecovered({ id: "computer:job-1:0", name: "computer-job", snapshot: { ownerId: "owner", jobId: "job-1" }, createdAt: Date.now(), recoveryReason: "interrupted" } as never);
    expect(result).toEqual({ status: "completed" });
    await tick();
    expect(runtime.runs.map(run => run.jobId)).toEqual(["job-1"]);
  });
});

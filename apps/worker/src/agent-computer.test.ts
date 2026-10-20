import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_SCHEMA_STATEMENTS } from "../../../packages/agent/src/store";
import { DEFAULT_COMPUTER_LIMITS, computerJobTurnId, createComputerJob, createFakeBrowserDriver, loadComputerJob } from "../../../packages/agent/src/computer";
import type { AgentModel, AgentToolCall } from "../../../packages/agent/src/types";
import type { AppBindings } from "./http/types";
import type { Env } from "./types";

// Failure modes: the feature appearing without Browser Run; the result not reaching
// the conversation or the owner's phone, or reaching it twice; a watched or cancelled
// job pushing anyway; screenshots stored outside the owner's private conversation
// storage; owners raising limits above the installation ceiling; a stuck job holding
// the only running slot; Stop with no live run leaving the job running; DO recovery
// not resuming a job; another owner's job being visible; Recent work missing a
// finished job, repeating it on recovery, or claiming a failed or cancelled one.
const runtime = vi.hoisted(() => ({ model: undefined as AgentModel | undefined }));
vi.mock("./agent-runtime", () => ({
  createAgentModels: async () => ({ model: runtime.model, backup: undefined }),
  bindingModelSupportsImageInput: () => true,
}));
import { computerAvailability, createComputerChatServices, expireStaleComputerJobs, getComputerSettings, publishComputerJobResult, AGENT_COMPUTER_SCHEMA } from "./agent-computer";
import { executeComputerJob } from "./agent-computer-runner";
import { AGENT_NOTIFICATION_SCHEMA, updateAgentChatPresence } from "./agent-notifications";
import { registerComputerRoutes } from "./routes/computer";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); runtime.model = undefined; });

function fixture(envOverrides: Partial<Env> = {}) {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const initial = readFileSync(new URL("../migrations/0001_initial_public_schema.sql", import.meta.url), "utf8");
  raw.exec("CREATE TABLE owner_profile(id TEXT PRIMARY KEY,name TEXT,timezone TEXT); INSERT INTO owner_profile VALUES('owner','Test Owner','Europe/Dublin'),('other','Other','UTC');");
  raw.exec("CREATE TABLE assistant_threads(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT,updated_at TEXT,last_message_at TEXT); INSERT INTO assistant_threads(id,owner_id,status) VALUES('thread','owner','active'),('other-thread','other','active');");
  raw.exec("CREATE TABLE assistant_messages(id TEXT PRIMARY KEY,owner_id TEXT,thread_id TEXT,role TEXT,content TEXT,metadata_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);");
  for (const name of ["assistant_attachments", "assistant_message_assets", "mission_plugin_activity"]) raw.exec(initial.match(new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`))![0].replace(/,\s*FOREIGN KEY[^\n]*\n/g, "\n").replace(/REFERENCES [a-z_]+\([a-z_]+\)( ON DELETE (SET NULL|CASCADE))?/g, ""));
  raw.exec("CREATE TABLE install_secrets(name TEXT,value TEXT); INSERT INTO install_secrets VALUES('ME3_CLOUD_OWNER_ID','cloud-owner'),('ME3_CORE_INSTALL_ID','install'),('ME3_CLOUD_CORE_TOKEN','test-token');");
  for (const sql of [...AGENT_SCHEMA_STATEMENTS, ...AGENT_COMPUTER_SCHEMA, ...AGENT_NOTIFICATION_SCHEMA]) raw.exec(sql);
  const executions = new WeakMap<object, () => unknown>();
  const DB = { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
    };
    executions.set(statement, () => ({ meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }));
    return statement;
  }, async batch(statements: object[]) {
    raw.exec("BEGIN IMMEDIATE");
    try { const results = statements.map(statement => executions.get(statement)!()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  } };
  const objects = new Map<string, Uint8Array>();
  const SITE_ASSETS = { async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); } };
  const env = { DB, SITE_ASSETS, BROWSER: {}, ME3_AGENT: {}, ME3_CLOUD_API_ORIGIN: "https://cloud.example.test", ...envOverrides } as unknown as Env;
  const relay = vi.fn(async () => Response.json({ ok: true, matched: 1, sent: 1, retryable: 0 })); vi.stubGlobal("fetch", relay);
  return { raw, env, objects, relay };
}
const newJob = (env: Env, id = "job-1", ownerId = "owner", threadId = "thread") => createComputerJob(env.DB as never, { id, ownerId, threadId, originTurnId: `turn-${id}`, originCallId: "call", goal: "Find the kettle price", startUrl: "https://shop.example.com/", limits: { ...DEFAULT_COMPUTER_LIMITS }, usageDay: "2026-10-17" });
const call = (name: string, args: Record<string, unknown> = {}): AgentToolCall => ({ id: `${name}-${Math.random().toString(36).slice(2, 8)}`, name, arguments: args });
function scripted(steps: AgentToolCall[][]): AgentModel {
  let index = 0;
  return { id: "fixture-model", async step() { const calls = steps[Math.min(index++, steps.length - 1)]; return { text: "", toolCalls: calls }; } };
}
const shop = { pages: { "https://shop.example.com/": { title: "Synthetic Shop", nodes: [{ role: "heading", name: "Kettle €24.99", level: 1 }] } } };

describe("agent computer availability", () => {
  it("is hidden without a Browser Run binding and says why", async () => {
    const { env } = fixture({ BROWSER: undefined });
    expect(computerAvailability(env)).toMatchObject({ available: false, reason: expect.stringMatching(/Browser Run/) });
    const services = createComputerChatServices(env, "owner", { start: vi.fn(), cancel: vi.fn() });
    await expect(services.start({ goal: "x", startUrl: null }, { threadId: "thread", turnId: "turn", callId: "call" })).rejects.toThrow(/Browser Run/);
  });
});

describe("computer job results in the conversation", () => {
  it("runs a job, saves its screenshot privately, posts one anchored result and one push", async () => {
    const { env, raw, objects, relay } = fixture();
    await newJob(env);
    let artifactId = "";
    runtime.model = { id: "fixture-model", step: (() => { let index = 0; return async ({ messages }: { messages: readonly { role: string; content: string }[] }) => {
      index++;
      if (index === 1) return { text: "", toolCalls: [call("browser_open", { url: "https://shop.example.com/" })] };
      if (index === 2) return { text: "", toolCalls: [call("browser_screenshot")] };
      artifactId = JSON.parse(messages.filter(message => message.role === "tool").at(-1)!.content).data.artifactId;
      return { text: "", toolCalls: [call("computer_finish", { summary: "The kettle is €24.99 (https://shop.example.com/).", artifactIds: [artifactId] })] };
    }; })() } as AgentModel;
    const driver = createFakeBrowserDriver(shop);
    const outcome = await executeComputerJob(env, "owner", "job-1", new AbortController().signal, { driver });
    expect(outcome.status).toBe("complete");
    const [key] = [...objects.keys()];
    expect(key).toMatch(/^assistant\/owner\/computer\/job-1\/.+\.png$/);
    expect(raw.prepare("SELECT owner_id,thread_id,kind,status FROM assistant_attachments").get()).toMatchObject({ owner_id: "owner", thread_id: "thread", kind: "image", status: "ready" });
    const message = raw.prepare("SELECT id,content,metadata_json FROM assistant_messages").get() as { id: string; content: string; metadata_json: string };
    // Clients anchor a notification to `${turnId}:assistant:complete:`.
    expect(message.id).toBe(`${computerJobTurnId("job-1")}:assistant:complete:final`);
    expect(message.content).toContain("€24.99");
    expect(JSON.parse(message.metadata_json)).toMatchObject({ turnId: computerJobTurnId("job-1"), computerJob: { id: "job-1", status: "complete", untrustedSources: true, artifacts: [{ id: artifactId }] } });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM assistant_message_assets").get()).toMatchObject({ count: 1 });
    expect(relay).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((relay.mock.calls[0] as unknown as [URL, RequestInit])[1].body))).toEqual({ threadId: "thread", turnId: computerJobTurnId("job-1"), kind: "complete" });
    // Recovery of a finished job republishes idempotently.
    await executeComputerJob(env, "owner", "job-1", new AbortController().signal, { driver });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM assistant_messages").get()).toMatchObject({ count: 1 });
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it("shows a finished job once in Recent work, never a failed or cancelled one", async () => {
    const { env, raw } = fixture();
    const activity = () => raw.prepare("SELECT user_id,plugin_id,activity_type,title,summary,related_id FROM mission_plugin_activity").all();
    await newJob(env);
    runtime.model = scripted([[call("computer_finish", { summary: "The kettle is €24.99." })]]);
    await executeComputerJob(env, "owner", "job-1", new AbortController().signal, { driver: createFakeBrowserDriver(shop) });
    await publishComputerJobResult(env, (await loadComputerJob(env.DB as never, "owner", "job-1"))!);
    expect(activity()).toEqual([{ user_id: "owner", plugin_id: "me3.agent-chat", activity_type: "agent.computer_job.completed", title: "Researched: Find the kettle price", summary: "The kettle is €24.99.", related_id: "job-1" }]);
    raw.exec("DELETE FROM mission_plugin_activity");
    await publishComputerJobResult(env, (await loadComputerJob(env.DB as never, "owner", "job-1"))!);
    await newJob(env, "job-2");
    runtime.model = undefined;
    expect((await executeComputerJob(env, "owner", "job-2", new AbortController().signal, { driver: createFakeBrowserDriver(shop) })).status).toBe("failed");
    await newJob(env, "job-3");
    await createComputerChatServices(env, "owner", { start: vi.fn(), cancel: async () => undefined }).cancel("job-3");
    expect((await executeComputerJob(env, "owner", "job-3", new AbortController().signal, { driver: createFakeBrowserDriver(shop) })).status).toBe("cancelled");
    expect(activity()).toEqual([]);
  });

  it("suppresses the push while the owner watches, and never pushes a cancellation", async () => {
    const { env, relay } = fixture();
    await newJob(env);
    await updateAgentChatPresence(env, "owner", "thread", "viewer", true);
    runtime.model = scripted([[call("computer_finish", { summary: "Done." })]]);
    await executeComputerJob(env, "owner", "job-1", new AbortController().signal, { driver: createFakeBrowserDriver(shop) });
    expect(relay).not.toHaveBeenCalled();
    await updateAgentChatPresence(env, "owner", "thread", "viewer", false);
    await newJob(env, "job-2");
    await createComputerChatServices(env, "owner", { start: vi.fn(), cancel: async () => undefined }).cancel("job-2");
    const outcome = await executeComputerJob(env, "owner", "job-2", new AbortController().signal, { driver: createFakeBrowserDriver(shop) });
    expect(outcome).toMatchObject({ status: "cancelled" });
    expect(relay).not.toHaveBeenCalled();
  });

  it("ends a job with a reported result when the runtime fails before browsing", async () => {
    const { env, raw } = fixture();
    await newJob(env);
    runtime.model = undefined;
    const outcome = await executeComputerJob(env, "owner", "job-1", new AbortController().signal, { driver: createFakeBrowserDriver(shop) });
    expect(outcome.status).toBe("failed");
    expect(raw.prepare("SELECT content FROM assistant_messages").get()).toMatchObject({ content: expect.stringMatching(/Nothing was submitted/) });
  });

  it("ends a silent job so it cannot hold the running slot forever", async () => {
    const { env, raw } = fixture();
    await newJob(env);
    raw.exec("UPDATE me3_agent_computer_jobs SET updated_at=datetime('now','-2 hours')");
    await expireStaleComputerJobs(env, "owner");
    expect(await loadComputerJob(env.DB as never, "owner", "job-1")).toMatchObject({ status: "interrupted", endReason: "recovery_limit" });
    const start = vi.fn(async () => undefined);
    const job = await createComputerChatServices(env, "owner", { start, cancel: vi.fn() }).start({ goal: "Again", startUrl: null }, { threadId: "thread", turnId: "turn-2", callId: "call" });
    expect(job.status).toBe("running");
    expect(start).toHaveBeenCalledWith(job.id);
  });
});

describe("owner computer routes", () => {
  function app(env: Env) {
    const hono = new Hono<AppBindings>();
    registerComputerRoutes(hono as never, { requireOwner: async () => "owner", unauthorized: (c: never) => (c as { json(v: unknown, s: number): Response }).json({ error: "Unauthorized" }, 401) } as never);
    return (path: string, init?: RequestInit) => hono.request(path, init, env);
  }
  it("reports availability, limits and today's usage, and keeps limits under the ceiling", async () => {
    const { env } = fixture({ ME3_AGENT_COMPUTER_LIMITS: JSON.stringify({ dailyBrowserMinutes: 30 }) });
    const request = app(env);
    expect(await (await request("/api/computer")).json()).toMatchObject({ available: true, limits: { dailyBrowserMinutes: 30, maxStepsPerJob: 60 }, today: { remainingMinutes: 30 }, jobs: [] });
    expect((await request("/api/computer/settings", { method: "PUT", body: JSON.stringify({ limits: { dailyBrowserMinutes: 45 } }) })).status).toBe(400);
    expect(await (await request("/api/computer/settings", { method: "PUT", body: JSON.stringify({ limits: { maxStepsPerJob: 25 } }) })).json()).toMatchObject({ limits: { maxStepsPerJob: 25, dailyBrowserMinutes: 30 } });
    expect((await getComputerSettings(env, "owner")).ownerLimits).toEqual({ maxStepsPerJob: 25 });
  });
  it("shows only the owner's jobs and forwards Stop to the owner's agent", async () => {
    const forwarded: unknown[] = [];
    const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: string, init: RequestInit) => { forwarded.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); } }) };
    const { env } = fixture({ ME3_AGENT: namespace as never });
    await newJob(env); await newJob(env, "foreign-job", "other", "other-thread");
    const request = app(env);
    expect((await (await request("/api/computer/jobs")).json() as { jobs: unknown[] }).jobs).toHaveLength(1);
    expect((await request("/api/computer/jobs/foreign-job")).status).toBe(404);
    expect((await request("/api/computer/jobs/job-1/cancel", { method: "POST" })).status).toBe(200);
    expect(forwarded).toEqual([{ userId: "owner", jobId: "job-1" }]);
  });
});

describe("Browser Run accessibility snapshot conversion", () => {
  it("keeps references and links, flattens ignored nodes and never exposes typed values", async () => {
    const { toBrowserNodes } = await import("./browser-run-driver");
    const { formatBrowserSnapshot } = await import("../../../packages/agent/src/computer");
    const nodes = toBrowserNodes([
      { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Shop" }, childIds: ["2", "3", "5"] },
      { nodeId: "2", parentId: "1", ignored: true, role: { value: "generic" }, childIds: ["4"] },
      { nodeId: "4", parentId: "2", role: { value: "link" }, name: { value: "Basket" }, backendDOMNodeId: 41, properties: [{ name: "url", value: { value: "https://shop.example.com/basket" } }] },
      { nodeId: "3", parentId: "1", role: { value: "textbox" }, name: { value: "Card number" }, value: { value: "4242424242424242" }, backendDOMNodeId: 52, childIds: ["6"] },
      { nodeId: "6", parentId: "3", role: { value: "StaticText" }, name: { value: "4242424242424242" } },
      { nodeId: "5", parentId: "1", role: { value: "heading" }, name: { value: "Checkout" }, properties: [{ name: "level", value: { value: 2 } }] },
    ]);
    const text = formatBrowserSnapshot({ url: "https://shop.example.com/", title: "Shop", nodes }).text;
    expect(text).toContain('[e41] link "Basket" -> https://shop.example.com/basket');
    expect(text).toContain('[e52] textbox "Card number" [filled]');
    expect(text).toContain('heading "Checkout" level=2');
    expect(text).not.toContain("4242");
  });
});

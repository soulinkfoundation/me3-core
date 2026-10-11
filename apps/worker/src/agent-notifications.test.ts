import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { AGENT_NOTIFICATION_SCHEMA, notifyAgentTurnFinished, retryAgentTurnNotifications, updateAgentChatPresence } from "./agent-notifications";
import { registerNewAgentRoutes } from "./routes/new-agent";
import type { Env } from "./types";
import type { AppHono, OwnerRouteDeps } from "./http/types";

// Failure modes: watched results notify after replay, background results are lost,
// multiple viewers overwrite each other, retries duplicate pushes, foreign threads leak.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });
function fixture(status = "complete") {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  raw.exec(`CREATE TABLE assistant_threads(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT);
    INSERT INTO assistant_threads VALUES('thread','owner','active'),('foreign','other','active');
    CREATE TABLE me3_agent_turns(owner_id TEXT,turn_id TEXT,thread_id TEXT,status TEXT,response_json TEXT);
    CREATE TABLE install_secrets(name TEXT,value TEXT);
    INSERT INTO install_secrets VALUES('ME3_CLOUD_OWNER_ID','cloud-owner'),('ME3_CORE_INSTALL_ID','install'),('ME3_CLOUD_CORE_TOKEN','test-token');`);
  raw.prepare("INSERT INTO me3_agent_turns VALUES('owner','turn','thread',?,?)").run(status, JSON.stringify({ status, turnId: "turn", threadId: "thread" }));
  for (const sql of AGENT_NOTIFICATION_SCHEMA) raw.exec(sql);
  const env = { DB: { prepare(sql: string) {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first() { return query.get(...values as never[]) ?? null; }, async all() { return { results: query.all(...values as never[]) }; }, async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; } };
    return statement;
  } }, ME3_CLOUD_API_ORIGIN: "https://cloud.example.test" } as unknown as Env;
  const fetch = vi.fn(async () => Response.json({ ok: true, matched: 1, sent: 1, retryable: 0 })); vi.stubGlobal("fetch", fetch);
  return { raw, env, fetch, finish: () => notifyAgentTurnFinished(env, "owner", "turn") };
}

describe("background agent notification policy with real SQLite", () => {
  it("persists one background completion and never sends again on replay", async () => {
    const f = fixture(); await f.finish(); await f.finish(); await retryAgentTurnNotifications(f.env);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const call = f.fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(call[0])).toBe("https://cloud.example.test/api/push/agent-turns");
    expect(JSON.parse(String(call[1].body))).toEqual({ threadId: "thread", turnId: "turn", kind: "complete" });
  });

  it("keeps foreground suppression durable after every viewer leaves", async () => {
    const f = fixture(); await updateAgentChatPresence(f.env, "owner", "thread", "viewer-one", true);
    await updateAgentChatPresence(f.env, "owner", "thread", "viewer-two", true);
    await updateAgentChatPresence(f.env, "owner", "thread", "viewer-one", false);
    await f.finish(); await updateAgentChatPresence(f.env, "owner", "thread", "viewer-two", false); await f.finish();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT status FROM me3_agent_notifications").get()).toMatchObject({ status: "suppressed" });
  });

  it("expires abandoned viewers and ignores different conversations", async () => {
    const f = fixture(); await updateAgentChatPresence(f.env, "owner", "thread", "viewer", true);
    f.raw.exec("UPDATE me3_agent_chat_presence SET expires_at=0"); await f.finish();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    await expect(updateAgentChatPresence(f.env, "owner", "foreign", "viewer", true)).resolves.toBe(false);
  });

  it("sends one needs-you notification across approval pauses and completion", async () => {
    const f = fixture("needs_approval"); await f.finish();
    f.raw.exec("UPDATE me3_agent_turns SET status='complete'"); await f.finish();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const call = f.fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(String(call[1].body)).kind).toBe("needs_you");
  });

  it("can notify completion away after an approval was watched", async () => {
    const f = fixture("needs_approval"); await updateAgentChatPresence(f.env, "owner", "thread", "viewer", true);
    await f.finish(); await updateAgentChatPresence(f.env, "owner", "thread", "viewer", false);
    f.raw.exec("UPDATE me3_agent_turns SET status='complete'"); await f.finish(); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries relay failures without turning a saved result into a failed turn", async () => {
    const f = fixture(); f.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await f.finish(); expect(f.raw.prepare("SELECT status FROM me3_agent_notifications").get()).toMatchObject({ status: "pending" });
    await retryAgentTurnNotifications(f.env); expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.raw.prepare("SELECT status FROM me3_agent_turns").get()).toMatchObject({ status: "complete" });
  });

  it.each(["running", "cancelled"])("does not notify %s turns", async status => {
    const f = fixture(status); await f.finish(); expect(f.fetch).not.toHaveBeenCalled();
  });

  it("authenticates presence and validates bounded client identities", async () => {
    const f = fixture(); const app = new Hono() as AppHono;
    registerNewAgentRoutes(app, { requireOwner: async () => "owner", unauthorized: () => Response.json({}, { status: 401 }) } as unknown as OwnerRouteDeps);
    const presence = (thread: string, body: unknown) => app.request(`/api/assistant/threads/${thread}/presence`, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, f.env);
    expect((await presence("thread", { clientId: "viewer", watching: true })).status).toBe(200);
    expect((await presence("foreign", { clientId: "viewer", watching: true })).status).toBe(404);
    expect((await presence("thread", { clientId: "", watching: true })).status).toBe(400);
    expect((await presence("thread", { clientId: "viewer", watching: "yes" })).status).toBe(400);
  });
});

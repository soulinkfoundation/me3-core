import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { persistAgentTargetSelectionInput } from "./agent-target-selection";
import { registerAssistantRoutes } from "./routes/assistant";
import type { AgentDb, AgentStatement } from "../../../packages/agent/src/types";
import type { Env } from "./types";

vi.mock("./plugins", () => ({ isCorePluginEnabled: async () => true, listCorePluginRecords: async () => [{ id: "me3.calendar", enabled: true, status: "installed" }] }));
vi.mock("@me3-core/plugin-agent-chat", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  createAgentSandboxTurnRecord: async (_env: Env, input: { requestId: string; messageText: string }) => ({ turnId: `turn-${input.requestId}`, messageText: input.messageText, replyToMessageId: null, connection: { id: "connection" }, sourceEvent: { id: `event-${input.requestId}` } }),
}));
const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); vi.restoreAllMocks(); });
function fixture() {
  const file = join(mkdtempSync(join(tmpdir(), "me3-target-route-")), "installation.sqlite");
  let raw = new DatabaseSync(file); close.push(() => raw.close());
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, directory), "utf8"));
  raw.exec("INSERT INTO owner_profile(id,username) VALUES('owner','synthetic'),('other-owner','foreign'); INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic'),('other-thread','owner','Other'),('foreign-thread','other-owner','Foreign');");
  const executions = new WeakMap<AgentStatement, () => unknown>();
  let beforeBatch: (() => void) | undefined;
  const db: AgentDb = { prepare(sql) { let values: unknown[] = []; const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; } }; executions.set(statement, () => ({meta:{changes:Number(raw.prepare(sql).run(...values as never[]).changes)}})); return statement; }, async batch(statements) { beforeBatch?.(); beforeBatch = undefined; raw.exec("BEGIN IMMEDIATE"); try { const result = statements.map(statement => executions.get(statement)!()); raw.exec("COMMIT"); return result; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
  const dispatch = vi.fn(async (_url: string, options: { body: string }) => { const input = JSON.parse(options.body); return Response.json({ ok: true, status: "complete", threadId: input.threadId, turnId: input.turnId, replyText: "Synthetic selection accepted." }); });
  const env = { DB: db, ME3_DEPLOYMENT_MODE: "self_hosted", ME3_AGENT: { idFromName: (owner: string) => owner, get: () => ({ fetch: dispatch }) } } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  registerAssistantRoutes(app, { requireOwner: async c => c.req.header("Authorization") === "Bearer synthetic-owner" ? "owner" : null, unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }), getSessionOwnerId: async () => "owner", getSetupRequired: async () => [] });
  const post = (targetSelection: unknown, options: { requestId?: string; threadId?: string; authorized?: boolean; stream?: boolean } = {}) => app.request(`/api/assistant/chat/turn${options.stream ? "/stream" : ""}`, { method: "POST", headers: { "Content-Type": "application/json", ...(options.authorized === false ? {} : { Authorization: "Bearer synthetic-owner" }) }, body: JSON.stringify({ requestId: options.requestId || "request", threadId: options.threadId || "thread", messageText: "Choose this exact saved target.", targetSelection, userId: "other-owner" }) }, env);
  return { db, env, app, dispatch, post, race(fn: () => void) { beforeBatch = fn; }, raw: () => raw, reopen() { raw.close(); raw = new DatabaseSync(file); } };
}

function menu(f: ReturnType<typeof fixture>, id = "menu", ordinal = 1) {
  f.raw().prepare("INSERT OR IGNORE INTO me3_agent_turns(turn_id,owner_id,thread_id,request_id,status) VALUES('origin','owner','thread','origin-request','complete')").run();
  const envelope = { actionLabel: "Move reminder", idParameter: "reminderId", ownerTimezone: "UTC", changes: [{ label: "Date", value: "2027-01-16" }], candidates: [{ id: "record", option: 1, label: "Same title", fields: [{ label: "Remind at", value: "2027-01-15T12:00:00Z" }], snapshot: { id: "record", title: "Same title" } }, { id: "record-2", option: 2, label: "Same title", fields: [{ label: "Remind at", value: "2027-01-17T12:00:00Z" }], snapshot: { id: "record-2", title: "Same title" } }] };
  f.raw().prepare(`INSERT INTO me3_agent_presentations(id,owner_id,thread_id,domain,selection_id,ordinal,tool_name,arguments_json,candidates_json,created_turn_id,created_at,expires_at)
    VALUES(?,'owner','thread','reminder','selection',?,'core_reminders_update',?,?,'origin',?,?)`).run(id, ordinal, JSON.stringify({ date: "2027-01-16", time: "09:30", timezone: "UTC" }), JSON.stringify(envelope), new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
  return { presentationId: id, candidateId: "record" };
}

describe("authenticated target selection before new agent dispatch", () => {
  it.each([[null], [[]], [{ presentationId: "", candidateId: "record" }], [{ presentationId: "menu", candidateId: 2 }]])("rejects malformed selection %j before any dispatch or turn admission", async selection => {
    const f = fixture(); const response = await f.post(selection);
    expect(response.status).toBe(400); expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns").get()).toMatchObject({ count: 0 });
  });
  it("authenticates before examining a presentation", async () => {
    const f = fixture(); expect((await f.post({ presentationId: "menu", candidateId: "record" }, { authorized: false })).status).toBe(401); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects an unknown presentation before %s stream transport admission", async stream => {
    const f = fixture(); expect((await f.post({ presentationId: "unknown", candidateId: "record" }, { stream })).status).toBe(409); expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns").get()).toMatchObject({ count: 0 });
  });
  it("binds the authenticated owner, exact input and immutable choice atomically and allows the identical reopened retry", async () => {
    const f = fixture(); const selection = menu(f);
    expect((await f.post(selection)).status).toBe(200);
    const saved = f.raw().prepare("SELECT owner_id,thread_id,input_json FROM me3_agent_turns WHERE request_id='request'").get() as { owner_id:string;thread_id:string;input_json:string };
    expect(saved.owner_id).toBe("owner"); expect(saved.thread_id).toBe("thread"); expect(JSON.parse(saved.input_json).targetSelection).toEqual(selection);
    expect(f.raw().prepare("SELECT status,choice_turn_id,choice_request_id,chosen_record_id FROM me3_agent_presentations WHERE id='menu'").get()).toMatchObject({status:"selected",choice_turn_id:"turn-request",choice_request_id:"request",chosen_record_id:"record"});
    f.reopen(); expect((await f.post(selection)).status).toBe(200);
    expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns WHERE request_id='request'").get()).toMatchObject({count:1});
    expect((await f.post({...selection,candidateId:"record-2"})).status).toBe(409);
    expect((await f.post(selection,{requestId:"different-request"})).status).toBe(409);
    expect(f.dispatch).toHaveBeenCalledTimes(2);
  });
  it.each(["other-thread","foreign-thread"])("rejects a choice from %s without admitting another turn", async threadId => {
    const f=fixture();const selection=menu(f);expect((await f.post(selection,{threadId})).status).toBe(409);expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns WHERE request_id='request'").get()).toMatchObject({count:0});
  });
  it.each(["superseded","expired","cancelled-origin","cancelled-choice","alias"])("fails closed for a %s presentation or request", async reason => {
    const f=fixture();const selection=menu(f);
    if(reason==="superseded")menu(f,"newer",2);
    if(reason==="expired")f.raw().exec("UPDATE me3_agent_presentations SET expires_at='2000-01-01T00:00:00Z'");
    if(reason==="cancelled-origin")f.raw().exec("INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES('owner','origin-request')");
    if(reason==="cancelled-choice")f.raw().exec("INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES('owner','request')");
    if(reason==="alias")f.raw().exec("INSERT INTO me3_agent_request_aliases(owner_id,request_id,turn_id,input_json) VALUES('owner','request','origin','{}')");
    expect((await f.post(selection)).status).toBe(409);expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns WHERE request_id='request'").get()).toMatchObject({count:0});
  });
  it("rejects an origin cancellation between preflight and admission without leaving a canonical choice turn", async () => {
    const f=fixture();const selection=menu(f);f.race(()=>f.raw().exec("INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES('owner','origin-request')"));
    expect((await f.post(selection)).status).toBe(409);expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns WHERE request_id='request'").get()).toMatchObject({count:0});
    expect(f.raw().prepare("SELECT status FROM me3_agent_presentations").get()).toMatchObject({status:"pending"});
  });
  it("history and export reproject pending, selected and superseded cards from canonical owner state after reopening", async () => {
    const f=fixture();const selection=menu(f);
    const payload={runtime:"agent",turnId:"origin",targetPresentation:{id:"menu",status:"pending",actionLabel:"FORGED",candidates:[]}};
    f.raw().prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES('origin:assistant:complete:final','owner','thread','assistant','Choose',?)").run(JSON.stringify(payload));
    const history=async(exported=false)=>{const response=await f.app.request(`/api/assistant/threads/thread/${exported?'export':'messages'}`,{headers:{Authorization:"Bearer synthetic-owner"}},f.env);expect(response.status).toBe(200);return await response.json() as {messages:Array<{targetPresentation:Record<string,unknown>}>};};
    expect((await history()).messages[0].targetPresentation).toMatchObject({id:"menu",status:"pending",actionLabel:"Move reminder"});
    await f.post(selection);f.reopen();expect((await history(true)).messages[0].targetPresentation).toMatchObject({status:"selected"});
    menu(f,"newer",2);expect((await history()).messages[0].targetPresentation).toMatchObject({id:"menu",status:"unavailable"});
  });

  it("admits only one concurrent request/candidate and leaves no losing input row", async () => {
    const f=fixture();const selection=menu(f);
    const responses=await Promise.all([f.post(selection,{requestId:"choice-a"}),f.post({...selection,candidateId:"record-2"},{requestId:"choice-b"})]);
    expect(responses.map(response=>response.status).sort()).toEqual([200,409]);expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns WHERE request_id IN ('choice-a','choice-b')").get()).toMatchObject({count:1});
  });
  it.each(["alias","archived"])("rejects %s between preflight and input admission", async reason => {
    const f=fixture();const selection=menu(f);f.race(()=>f.raw().exec(reason==="alias"?"INSERT INTO me3_agent_request_aliases(owner_id,request_id,turn_id,input_json) VALUES('owner','request','origin','{}')":"UPDATE assistant_threads SET status='archived' WHERE id='thread'"));
    expect((await f.post(selection)).status).toBe(409);expect(f.dispatch).not.toHaveBeenCalled();expect(f.raw().prepare("SELECT COUNT(*) count FROM me3_agent_turns WHERE request_id='request'").get()).toMatchObject({count:0});
  });

  it("does not claim a partially restored exact input if its request becomes an approval alias during admission", async () => {
    const f=fixture();const selection=menu(f);const input={userId:"owner",threadId:"thread",turnId:"turn-request",requestId:"request",messageText:"Choose",targetSelection:selection};
    f.raw().prepare("INSERT INTO me3_agent_turns(turn_id,owner_id,thread_id,request_id,input_json) VALUES('turn-request','owner','thread','request',?)").run(JSON.stringify(input));
    f.race(()=>f.raw().exec("INSERT INTO me3_agent_request_aliases(owner_id,request_id,turn_id,input_json) VALUES('owner','request','origin','{}')"));
    await expect(persistAgentTargetSelectionInput(f.env,input)).rejects.toThrow();
    expect(f.raw().prepare("SELECT status FROM me3_agent_presentations WHERE id='menu'").get()).toMatchObject({status:"pending"});
  });

});

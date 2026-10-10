import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_SCHEMA_STATEMENTS, appendAgentStreamEvent, createD1TurnStore, decideAgentApproval, persistAgentInput } from "../../../packages/agent/src/store";
import { runAgentTurn } from "../../../packages/agent/src/loop";
import { toolIdempotencyKey } from "../../../packages/agent/src/schema";
import type { AgentCheckpoint, AgentDb, AgentModel, AgentTool } from "../../../packages/agent/src/types";
import type { NewAgentDispatchInput } from "./agent-runtime";
import type { Env } from "./types";

const runtime = vi.hoisted(() => ({ execute: vi.fn(), fiberGate: undefined as Promise<void> | undefined }));
// Match the SDK's managed-fiber contract: idempotent starts share one execution,
// waiting starts await an existing fiber; a subscriber disconnect never cancels it.
vi.mock("agents", () => ({ Agent: class {
  env: Env; ctx: unknown; fibers = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  constructor(ctx: unknown, env: Env) { this.ctx = ctx; this.env = env; }
  async startFiber(_name: string, fn: (context: unknown) => Promise<void>, options: { fiberId: string; waitForCompletion: boolean }) {
    let fiber = this.fibers.get(options.fiberId);
    if (!fiber) {
      const controller = new AbortController();
      const promise = Promise.resolve().then(async () => { await runtime.fiberGate; await fn({ id: options.fiberId, signal: controller.signal, stash() {} }); }).catch(() => {});
      fiber = { promise, controller }; this.fibers.set(options.fiberId, fiber);
    }
    if (options.waitForCompletion) await fiber.promise;
  }
  async cancelFiber(id: string, reason: string) { this.fibers.get(id)?.controller.abort(reason); return true; }
} }));
vi.mock("./agent-runtime", () => ({
  executeNewAgentTurn: runtime.execute,
  isNewAgentDispatchInput: (value: Record<string, unknown>) => value && ["userId", "threadId", "turnId", "requestId", "messageText"].every(key => typeof value[key] === "string"),
}));
vi.mock("./assistant-primary-thread", () => ({ resolvePrimaryAssistantThread: async () => ({ id: "thread" }) }));
import { Me3Agent } from "./me3-agent";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); runtime.execute.mockReset(); runtime.fiberGate = undefined; });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const identity = { ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "request" };
const input: NewAgentDispatchInput = { userId: "owner", threadId: "thread", turnId: "turn", requestId: "request", messageText: "Do the requested work" };
function checkpoint(call: { id: string; name: string; arguments: Record<string, unknown> }): AgentCheckpoint {
  return { messages: [{ role: "user", content: input.messageText }, { role: "assistant", content: "", toolCalls: [call] }], pendingCalls: [call], nextCallIndex: 0, steps: 1, status: "running", trace: { model: "fixture", steps: 1, toolCalls: [], startedAt: "2026-10-10T00:00:00Z", totalDurationMs: 0, timeToFirstTokenMs: null, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 } } };
}
function fixture(model: AgentModel = { id: "fixture", async step() { return { text: "Completed.", toolCalls: [] }; } }, tools: AgentTool[] = [], beforePersist?: (status: string) => Promise<void>) {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  for (const sql of AGENT_SCHEMA_STATEMENTS) raw.exec(sql);
  raw.exec("CREATE TABLE assistant_threads(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT); INSERT INTO assistant_threads VALUES('thread','owner','active'); CREATE TABLE assistant_messages(id TEXT PRIMARY KEY,owner_id TEXT,thread_id TEXT,role TEXT,content TEXT,metadata_json TEXT); CREATE TABLE effects(id TEXT PRIMARY KEY);");
  const db: AgentDb = { prepare(sql) {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (query.get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: query.all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; } }; return statement;
  }, async batch(statements) { raw.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results; } catch (error) { raw.exec('ROLLBACK'); throw error; } } };
  const env = { DB: db } as unknown as Env;
  const agent = new Me3Agent({} as DurableObjectState, env);
  runtime.execute.mockImplementation(async (_env: Env, request: NewAgentDispatchInput, signal: AbortSignal, emit: (event: string, data: Record<string, unknown>, seq: number) => void) => {
    const store = createD1TurnStore(db, { ownerId: request.userId, threadId: request.threadId, turnId: request.turnId, requestId: request.requestId });
    const result = await runAgentTurn({ model, tools, store, messages: [{ role: "user", content: request.messageText }], context: { db, ownerId: request.userId, threadId: request.threadId, turnId: request.turnId, requestId: request.requestId, ownerTimezone: "UTC", messageText: request.messageText, enabledPluginIds: new Set() }, signal, onEvent: async event => { const seq = await appendAgentStreamEvent(db, request.userId, request.turnId, event.event, event.data); emit(event.event, event.data, seq); } });
    const payload = { ok: ["complete", "needs_approval"].includes(result.status), status: result.status, replyText: result.replyText, approvalId: result.approvalId ?? null, turnId: request.turnId, threadId: request.threadId };
    await beforePersist?.(result.status);
    await db.prepare("UPDATE me3_agent_turns SET response_json=? WHERE owner_id=? AND turn_id=?").bind(JSON.stringify(payload), request.userId, request.turnId).run();
    const event = result.status === "failed" ? "error" : "done";
    emit(event, payload, await appendAgentStreamEvent(db, request.userId, request.turnId, event, payload));
    return payload;
  });
  const dispatch = (value = input, stream = false, cursor?: number) => agent.onRequest(new Request(`https://agent/dispatch/sandbox${stream ? "/stream" : ""}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cursor === undefined ? {} : { "Last-Event-ID": String(cursor) }) }, body: JSON.stringify(value) }));
  const cancel = () => agent.onRequest(new Request("https://agent/turn/cancel", { method: "POST", body: JSON.stringify({ userId: input.userId, turnId: input.turnId }) }));
  const row = () => db.prepare("SELECT status,response_json FROM me3_agent_turns WHERE turn_id='turn'").first<{ status: string; response_json: string | null }>();
  return { agent, db, raw, env, dispatch, cancel, row };
}
async function streamText(response: Response) {
  let timeout!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([response.text(), new Promise<string>((_, reject) => { timeout = setTimeout(() => reject(new Error("Stream did not terminate")), 600); })]); }
  finally { clearTimeout(timeout); }
}
function events(text: string) {
  return text.split("\n\n").filter(frame => frame.includes("event:")).map(frame => ({ event: /event: (.+)/.exec(frame)![1], seq: Number(/id: (\d+)/.exec(frame)?.[1] || 0), data: JSON.parse(/data: (.+)/.exec(frame)![1]) }));
}

describe("D1-backed agent Durable Object execution and stream replay", () => {
  it("rolls back a fresh approval request mapping if recording its decision fails", async () => {
    const effect = vi.fn(async () => ({ status: 'ok' as const })); let step = 0;
    const { dispatch, db } = fixture({ id: 'fixture', async step() { return step++ === 0 ? { text: '', toolCalls: [{ id: 'send', name: 'send', arguments: {} }] } : { text: 'Handled.', toolCalls: [] }; } }, [{ name: 'send', description: 'Send', parameters: { type: 'object' }, effect: 'external', approval: 'required', execute: effect }]);
    await dispatch(); const prepare = db.prepare.bind(db); let fail = true;
    vi.spyOn(db, 'prepare').mockImplementation(sql => { const statement = prepare(sql); if (sql.startsWith('UPDATE me3_agent_approvals') && fail) { const run = statement.run.bind(statement); statement.run = async () => { if (fail) { fail = false; throw new Error('D1 decision failed'); } return run(); }; } return statement; });
    const reply = { ...input, turnId: 'reply-turn', requestId: 'reply-request', messageText: 'yes' };
    await expect(dispatch(reply)).rejects.toThrow('D1 decision failed');
    expect(await db.prepare('SELECT COUNT(*) count FROM me3_agent_request_aliases').first()).toMatchObject({ count: 0 });
    expect(await db.prepare('SELECT status FROM me3_agent_approvals').first()).toMatchObject({ status: 'pending' });
    expect(await (await dispatch(reply)).json()).toMatchObject({ status: 'complete', turnId: input.turnId });
    expect(effect).toHaveBeenCalledTimes(1);
  });
  it.each([['Yes.', 'approved', 1], ['No.', 'declined', 0], ['Yes. Send another one.', 'pending', 0]] as const)("handles a sole approval reply %s without broadening consent", async (messageText, status, effectCount) => {
    const effect = vi.fn(async () => ({ status: 'ok' as const })); let step = 0;
    const { dispatch, db } = fixture({ id: 'fixture', async step() { return step++ === 0 ? { text: '', toolCalls: [{ id: 'send', name: 'send', arguments: {} }] } : { text: 'Handled.', toolCalls: [] }; } }, [{ name: 'send', description: 'Send', parameters: { type: 'object' }, effect: 'external', approval: 'required', execute: effect }]);
    await dispatch();
    await dispatch({ ...input, turnId: 'reply-turn', requestId: 'reply-request', messageText });
    expect(await db.prepare('SELECT status FROM me3_agent_approvals').first()).toMatchObject({ status });
    expect(effect).toHaveBeenCalledTimes(effectCount);
  });
  it("accepts Stop before input persistence and cancels only the matching owner request", async () => {
    const { agent, dispatch, db } = fixture();
    const stop = (userId: string) => agent.onRequest(new Request("https://agent/turn/cancel", { method: "POST", body: JSON.stringify({ userId, requestId: input.requestId }) }));
    expect((await stop("other-owner")).status).toBe(202);
    expect((await stop(input.userId)).status).toBe(202);
    expect(await (await dispatch()).json()).toMatchObject({ status: "cancelled" }); expect(runtime.execute).not.toHaveBeenCalled();
    expect((await db.prepare("SELECT COUNT(*) count FROM me3_agent_cancellations").first<{count:number}>())!.count).toBe(2);
  });
  it("keeps another owner's early Stop isolated even when request IDs match", async () => {
    const { agent, dispatch } = fixture();
    await agent.onRequest(new Request("https://agent/turn/cancel", { method: "POST", body: JSON.stringify({ userId: "other-owner", requestId: input.requestId }) }));
    expect(await (await dispatch()).json()).toMatchObject({ status: "complete" }); expect(runtime.execute).toHaveBeenCalledTimes(1);
  });
  it("does not recover an active cancelled turn after object eviction", async () => {
    const entered = deferred(), release = deferred();
    const { db, env, dispatch, cancel, row } = fixture({ id: "fixture", async step() { entered.resolve(); await release.promise; return { text: "Late provider answer", toolCalls: [] }; } });
    const response = await dispatch(input, true); await entered.promise; await cancel();
    expect(await db.prepare("SELECT request_id FROM me3_agent_cancellations WHERE owner_id=?").bind(input.userId).first()).toMatchObject({ request_id: input.requestId });
    const recovered = new Me3Agent({} as DurableObjectState, env);
    await recovered.onFiberRecovered({ id: "recovered", name: "assistant-turn", snapshot: { ownerId: input.userId, turnId: input.turnId }, createdAt: Date.now(), recoveryReason: "interrupted" });
    expect(runtime.execute).toHaveBeenCalledTimes(1); expect(await row()).toMatchObject({ status: "cancelled" });
    release.resolve(); expect(events(await streamText(response)).at(-1)).toMatchObject({ event: "done", data: { status: "cancelled" } });
  });
  it("honors early Stop of a fresh approval reply request without approving the older turn", async () => {
    const effect = vi.fn(async () => ({ status: "ok" as const }));
    const { agent, dispatch, db } = fixture({ id: "fixture", async step() { return { text: "", toolCalls: [{ id: "send", name: "send", arguments: {} }] }; } }, [{ name: "send", description: "Send", parameters: { type: "object" }, effect: "external", approval: "required", execute: effect }]);
    await dispatch();
    await agent.onRequest(new Request("https://agent/turn/cancel", { method: "POST", body: JSON.stringify({ userId: input.userId, requestId: "approval-reply" }) }));
    expect(await (await dispatch({ ...input, turnId: "approval-turn", requestId: "approval-reply", messageText: "yes" })).json()).toMatchObject({ status: "cancelled", turnId: "approval-turn" });
    expect(await db.prepare("SELECT status FROM me3_agent_approvals").first()).toMatchObject({ status: "pending" }); expect(effect).not.toHaveBeenCalled();
  });
  it("maps Stop and retries of a fresh approval reply to the original durable turn", async () => {
    const entered = deferred(), release = deferred(); const effects: string[] = [];
    const tool: AgentTool = { name: "send", description: "Send", parameters: { type: "object" }, effect: "external", approval: "required", async execute(args) { effects.push(String(args.id)); entered.resolve(); await release.promise; return { status: "ok" }; } };
    const { agent, dispatch, db } = fixture({ id: "fixture", async step() { return { text: "", toolCalls: ["one", "two"].map(id => ({ id, name: "send", arguments: { id } })) }; } }, [tool]);
    await dispatch(); const reply = { ...input, turnId: "approval-turn", requestId: "approval-reply", messageText: "yes" };
    const resuming = dispatch(reply); await entered.promise;
    const stopped = await agent.onRequest(new Request("https://agent/turn/cancel", { method: "POST", body: JSON.stringify({ userId: input.userId, requestId: reply.requestId }) }));
    release.resolve(); const result = await (await resuming).json();
    expect(stopped.status).toBe(200); expect(result).toMatchObject({ status: "cancelled", turnId: input.turnId }); expect(effects).toEqual(["one"]);
    expect(await db.prepare("SELECT turn_id FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=?").bind(input.userId, reply.requestId).first()).toMatchObject({ turn_id: input.turnId });
    expect(await (await dispatch(reply)).json()).toMatchObject({ status: "cancelled", turnId: input.turnId }); expect(runtime.execute).toHaveBeenCalledTimes(2);
    expect((await dispatch({ ...reply, messageText: "no" })).status).toBe(409);
  });
  it("keeps a disconnected turn alive, journals its output, and replays only events after the cursor", async () => {
    const entered = deferred(), release = deferred();
    const { dispatch, db } = fixture({ id: "fixture", async step({ onDelta }) { await onDelta("Working"); entered.resolve(); await release.promise; await onDelta("Completed."); return { text: "Completed.", toolCalls: [] }; } });
    const response = await dispatch(input, true); const reader = response.body!.getReader();
    await entered.promise; await reader.read(); await reader.cancel();
    const cursor = (await db.prepare("SELECT MAX(seq) seq FROM me3_agent_stream_events").first<{ seq: number }>())!.seq;
    release.resolve(); expect(await (await dispatch()).json()).toMatchObject({ status: "complete" });
    const replay = events(await streamText(await dispatch(input, true, cursor)));
    expect(replay.map(item => item.data.text).filter(Boolean)).toEqual(["Completed."]);
    expect(replay.at(-1)).toMatchObject({ event: "done", data: { status: "complete" } });
    expect(replay.every(item => item.seq > cursor)).toBe(true); expect(runtime.execute).toHaveBeenCalledTimes(1);
  });

  it("awaits an in-flight unstreamed retry and uses the first canonical input", async () => {
    const entered = deferred(), release = deferred();
    const { dispatch } = fixture({ id: "fixture", async step({ messages }) { entered.resolve(); await release.promise; return { text: messages.at(-1)!.content, toolCalls: [] }; } });
    const first = dispatch(); await entered.promise;
    expect((await dispatch({ ...input, messageText: "Changed retry payload" })).status).toBe(409);
    let returned = false; const second = dispatch({ ...input }).then(response => { returned = true; return response; });
    await new Promise(done => setTimeout(done, 10)); expect(returned).toBe(false);
    release.resolve(); expect(await (await first).json()).toEqual(await (await second).json());
    expect(runtime.execute.mock.calls[0][1].messageText).toBe(input.messageText); expect(runtime.execute).toHaveBeenCalledTimes(1);
  });

  it("persists setup failures once and closes a reconnect even at the terminal cursor", async () => {
    const { dispatch, row, db } = fixture(); runtime.execute.mockRejectedValue(new Error("Provider configuration is unavailable"));
    const initial = events(await streamText(await dispatch(input, true)));
    expect(await row()).toMatchObject({ status: "failed", response_json: expect.any(String) });
    expect(initial.at(-1)).toMatchObject({ event: "error", seq: expect.any(Number) }); expect(initial.at(-1)!.seq).toBeGreaterThan(0);
    const replay = events(await streamText(await dispatch(input, true, initial.at(-1)!.seq)));
    expect(replay.at(-1)).toMatchObject({ event: "error", data: { status: "failed" } });
    expect((await db.prepare("SELECT COUNT(*) count FROM me3_agent_stream_events WHERE event='error'").first<{ count: number }>())!.count).toBe(1);
    expect(runtime.execute).toHaveBeenCalledTimes(1);
  });

  it("resumes successive approval pauses over SSE without replaying a previous terminal event", async () => {
    const effects: string[] = [];
    const tools = ["one", "two"].map(name => ({ name, description: name, parameters: { type: "object" }, effect: "external" as const, approval: "required" as const, async prepareApproval() { return { status: "needs_approval" as const, approval: { title: `Approve ${name}`, summary: name } }; }, async execute() { effects.push(name); return { status: "ok" as const }; } }));
    let step = 0;
    const { dispatch } = fixture({ id: "fixture", async step() { return step++ === 0 ? { text: "", toolCalls: tools.map(tool => ({ id: tool.name, name: tool.name, arguments: {} })) } : { text: "Both approved actions completed.", toolCalls: [] }; } }, tools);
    const paused = await (await dispatch()).json() as { approvalId: string };
    const second = events(await streamText(await dispatch({ ...input, turnId: "reply-one", requestId: "reply-one", messageText: "yes" }, true)));
    expect(effects).toEqual(["one"]); expect(second.at(-1)).toMatchObject({ event: "done", data: { status: "needs_approval" } });
    expect(second.at(-1)!.data.approvalId).not.toBe(paused.approvalId);
    expect(second.filter(item => item.event === "done")).toHaveLength(1);
    expect(second.find(item => item.event === "approval_required")?.data.title).toBe("Approve two");
    const final = events(await streamText(await dispatch({ ...input, turnId: "reply-two", requestId: "reply-two", messageText: "yes" }, true)));
    expect(effects).toEqual(["one", "two"]); expect(final.filter(item => item.event === "done")).toHaveLength(1);
    expect(final.at(-1)).toMatchObject({ event: "done", data: { status: "complete" } });
  });

  it("waits for the previous pause to persist before resuming an approval received immediately", async () => {
    const paused = deferred(), release = deferred(), effect = vi.fn(async () => ({ status: "ok" as const })); let step = 0;
    const { agent, dispatch, db } = fixture({ id: "fixture", async step() { return step++ === 0 ? { text: "", toolCalls: [{ id: "send", name: "send", arguments: {} }] } : { text: "Sent.", toolCalls: [] }; } }, [{ name: "send", description: "Send", parameters: { type: "object" }, effect: "external", approval: "required", execute: effect }], async status => { if (status === "needs_approval") { paused.resolve(); await release.promise; } });
    const initial = await dispatch(input, true); await paused.promise;
    const approval = await db.prepare("SELECT id FROM me3_agent_approvals").first<{ id: string }>(); await decideAgentApproval(db, input.userId, approval!.id, "approved");
    const resume = agent.onRequest(new Request("https://agent/turn/resume", { method: "POST", body: JSON.stringify({ userId: input.userId, turnId: input.turnId }) }));
    await new Promise(done => setTimeout(done, 10));
    release.resolve(); expect(await (await resume).json()).toMatchObject({ status: "complete" }); expect(effect).toHaveBeenCalledTimes(1);
    await streamText(initial);
  });

  it("persists cancellation before the first checkpoint so reconnects terminate", async () => {
    const { db, cancel, dispatch, row } = fixture(); await persistAgentInput(db, identity, input);
    expect(await (await cancel()).json()).toMatchObject({ cancelled: true });
    expect(await row()).toMatchObject({ status: "cancelled", response_json: expect.any(String) });
    expect(events(await streamText(await dispatch(input, true))).at(-1)).toMatchObject({ event: "done", data: { status: "cancelled" } });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it("does not start a queued fiber after the owner already cancelled its saved input", async () => {
    const release = deferred(); runtime.fiberGate = release.promise;
    const { dispatch, cancel, row } = fixture(); const response = await dispatch(input, true);
    await cancel(); release.resolve(); await new Promise(done => setTimeout(done, 10));
    expect(runtime.execute).not.toHaveBeenCalled(); expect(await row()).toMatchObject({ status: "cancelled" });
    expect(events(await streamText(response)).at(-1)).toMatchObject({ event: "done", data: { status: "cancelled" } });
  });

  it("declines a pending approval on cancellation and never executes it after a later approval reply", async () => {
    const effect = vi.fn(async () => ({ status: "ok" as const }));
    const { dispatch, cancel, db } = fixture({ id: "fixture", async step() { return { text: "", toolCalls: [{ id: "send", name: "send", arguments: {} }] }; } }, [{ name: "send", description: "Send", parameters: { type: "object" }, effect: "external", approval: "required", execute: effect }]);
    await dispatch(); await cancel();
    expect(await db.prepare("SELECT status FROM me3_agent_approvals").first()).toMatchObject({ status: "declined" });
    await dispatch({ ...input, messageText: "yes" }); expect(effect).not.toHaveBeenCalled();
  });

  it("restores a checkpoint after eviction without repeating an already finished write receipt", async () => {
    const call = { id: "call", name: "save", arguments: { id: "saved" } };
    const { db, raw, agent } = fixture(undefined, [{ name: "save", description: "Save", parameters: { type: "object" }, effect: "write", approval: "none", async execute() { raw.exec("INSERT INTO effects VALUES('saved')"); return { status: "ok", data: { id: "saved" } }; } }]);
    await persistAgentInput(db, identity, input); const store = createD1TurnStore(db, identity); await store.save(checkpoint(call));
    const key = await toolIdempotencyKey(identity.ownerId, identity.requestId, call.name, call.arguments);
    await store.claimReceipt(key, call); raw.exec("INSERT INTO effects VALUES('saved')"); await store.finishReceipt(key, { status: "ok", data: { id: "saved" } });
    expect(await agent.onFiberRecovered({ id: "recovered", name: "assistant-turn", snapshot: { ownerId: identity.ownerId, turnId: identity.turnId }, createdAt: Date.now(), recoveryReason: "interrupted" })).toMatchObject({ status: "completed" });
    expect(raw.prepare("SELECT COUNT(*) count FROM effects").get()).toMatchObject({ count: 1 }); expect((await store.load())!.status).toBe("complete");
  });

  it("recovers a queued fiber evicted before stash using its saved metadata identity", async () => {
    const { db, agent, row } = fixture(); await persistAgentInput(db, identity, input);
    expect(await agent.onFiberRecovered({ id: "queued", name: "assistant-turn", snapshot: null, metadata: { ownerId: identity.ownerId, turnId: identity.turnId }, createdAt: Date.now(), recoveryReason: "interrupted" })).toMatchObject({ status: "completed" });
    expect(await row()).toMatchObject({ status: "complete" }); expect(runtime.execute).toHaveBeenCalledTimes(1);
  });

  it("journals setup failures during recovered execution", async () => {
    const { db, agent, row } = fixture(); await persistAgentInput(db, identity, input); runtime.execute.mockRejectedValue(new Error("Owner unavailable"));
    await agent.onFiberRecovered({ id: "recovered", name: "assistant-turn", snapshot: { ownerId: identity.ownerId, turnId: identity.turnId }, createdAt: Date.now(), recoveryReason: "interrupted" }).catch(() => {});
    expect(await row()).toMatchObject({ status: "failed", response_json: expect.any(String) });
    expect((await db.prepare("SELECT event FROM me3_agent_stream_events ORDER BY seq DESC LIMIT 1").first()) as object).toMatchObject({ event: "error" });
  });

  it("finishes cancelled when an aborted model resolves late, and releases subscriber heartbeats", async () => {
    const entered = deferred(); const clear = vi.spyOn(globalThis, "clearInterval");
    const { dispatch, cancel } = fixture({ id: "fixture", async step({ signal }) { entered.resolve(); await new Promise<void>(done => signal.addEventListener("abort", () => done(), { once: true })); return { text: "Late provider answer", toolCalls: [] }; } });
    const response = await dispatch(input, true); await entered.promise; await cancel();
    expect(events(await streamText(response)).at(-1)).toMatchObject({ event: "done", data: { status: "cancelled" } });
    expect(clear).toHaveBeenCalled();
  });
});

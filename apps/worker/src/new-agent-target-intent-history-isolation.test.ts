import { chatView } from "./test-utils/chat-view";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeNewAgentTurn, type NewAgentDispatchInput } from "./agent-runtime";
import { persistAgentInput } from "../../../packages/agent/src/store";
import { toolIdempotencyKey } from "../../../packages/agent/src/schema";
import type { AgentDb, AgentTargetIntentEvidence } from "../../../packages/agent/src/types";
import type { Env } from "./types";

vi.mock("./ai-providers", () => ({ getAiSettings: async () => ({ defaults: { chat: { providerId: "openai", model: "gpt-5.5" } } }) }));
vi.mock("./ai-gateway", () => ({ getAiGatewayRuntimeConfig: async () => ({ gatewayId: "synthetic" }) }));
vi.mock("./plugins", () => ({ listCorePluginRecords: async () => [] }));
vi.mock("../../../packages/agent-chat/src/owner-snapshot", () => ({ loadOwnerSnapshotContext: async () => ({ prompt: "Synthetic owner" }) }));
vi.mock("./agent-domain-scheduling", () => ({ createStableAgentSchedulingServices: () => ({}) }));
vi.mock("./agent-mailbox-services", () => ({ createAgentMailboxServices: () => ({}) }));
vi.mock("./network-directory", () => ({ createPeopleSearchToolServices: () => ({}) }));
vi.mock("./web-research", () => ({ createWebResearchToolServices: () => ({}) }));
vi.mock("./managed-runtime-lifecycle", () => ({ isManagedRuntime: () => false, beginManagedRuntimeWriteLease: async () => "synthetic-lease", releaseManagedRuntimeWriteLease: async () => {} }));

type Call = { name: string; arguments: Record<string, unknown> };
type Journey = { messageText: string; calls: Call[]; verdict?: Record<string, unknown>; onPlanner?: (step: number) => void };
const read = (query: string): Call => ({ name: "core_reminders_list", arguments: { query } });
const move = (reminderId: string, date: string, time: string): Call => ({ name: "core_reminders_update", arguments: { reminderId, date, time, timezone: "Europe/Dublin" } });
const partialA = move("partial-alpha", "2027-01-16", "09:30"), partialB = move("partial-beta", "2027-01-18", "10:00");
const freshA = move("fresh-alpha", "2027-01-16", "09:30"), freshB = move("fresh-beta", "2027-01-18", "10:00");
const partialPrompt = "First move the Partial QA Alpha reminder originally due on 15 January 2027 to 16 January 2027 at 9:30am in Europe/Dublin. Then move the Partial QA Beta reminder originally due on 17 January 2027 to 18 January 2027 at 10:00am in Europe/Dublin.";
const freshPrompt = "First move the Fresh QA Alpha reminder originally due on 15 January 2027 to 16 January 2027 at 9:30am in Europe/Dublin. Then move the Fresh QA Beta reminder originally due on 17 January 2027 to 18 January 2027 at 10:00am in Europe/Dublin.";
// These complete verdicts are independently authored fixture truth, never copied
// from a planner request or inferred from its selected record/arguments.
const partialVerdict = { decision: "allow", actions: [{ selectedCandidateId: "partial-alpha", authorizedCall: partialA }, { selectedCandidateId: "partial-beta", authorizedCall: partialB }] };
const freshVerdict = { decision: "allow", actions: [{ selectedCandidateId: "fresh-alpha", authorizedCall: freshA }, { selectedCandidateId: "fresh-beta", authorizedCall: freshB }] };
const disposals: Array<() => void> = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "me3-intent-history-isolation-")), file = join(directory, "installation.sqlite");
  let raw = new DatabaseSync(file);
  disposals.push(() => { raw.close(); rmSync(directory, { recursive: true, force: true }); });
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, migrations), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username,timezone) VALUES('owner','synthetic','Europe/Dublin'),('other-owner','other-synthetic','UTC');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic');
    CREATE TABLE test_history_effects(seq INTEGER PRIMARY KEY,record_id TEXT,before_at TEXT,after_at TEXT);
    CREATE TRIGGER test_history_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO test_history_effects(record_id,before_at,after_at) VALUES(new.id,old.remind_at,new.remind_at); END;`);
  for (const [prefix, title] of [["complete", "Completed QA"], ["partial", "Partial QA"], ["fresh", "Fresh QA"]]) {
    raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,notes,status) VALUES(?,'owner',?,'2027-01-15T12:00:00Z','Europe/Dublin','Preserve Alpha notes','pending'),(?,'owner',?,'2027-01-17T12:00:00Z','Europe/Dublin','Preserve Beta notes','pending')")
      .run(`${prefix}-alpha`, `${title} Alpha`, `${prefix}-beta`, `${title} Beta`);
  }
  raw.exec("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,notes,status) VALUES('foreign','other-owner','Fresh QA Alpha','2027-01-15T12:00:00Z','UTC','Preserve foreign notes','pending')");
  const db: AgentDb = { prepare(sql) {
    let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; } };
    return statement;
  }, async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  } };
  const journeys = new Map<string, Journey>(), steps = new Map<string, number>();
  const evidence: Array<{ turnId: string; evidence: AgentTargetIntentEvidence }> = [];
  const run = vi.fn(async (_model: string, rawInput: Record<string, unknown>, options: { gateway: { metadata: { me3_turn_id: string; purpose?: string } } }) => {
    const input = chatView(rawInput);
    const turnId = options.gateway.metadata.me3_turn_id, journey = journeys.get(turnId)!;
    const tool = (name: string, args: unknown) => ({ choices: [{ message: { content: "", tool_calls: [{ id: `${turnId}:call:${run.mock.calls.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
    if (options.gateway.metadata.purpose === "target_intent") {
      const messages = input.messages as Array<{ role: string; content: string }>;
      const trusted = JSON.parse(messages.find(message => message.role === "user")!.content) as AgentTargetIntentEvidence;
      expect(trusted).not.toHaveProperty("proposedCall");
      evidence.push({ turnId, evidence: trusted });
      return tool("core_target_intent_verdict", journey.verdict ?? { decision: "deny", reason: "No mutation is independently authorized by this fixture." });
    }
    const step = (steps.get(turnId) ?? 0) + 1; steps.set(turnId, step); journey.onPlanner?.(step);
    const next = journey.calls[step - 1];
    return next ? tool(next.name, next.arguments) : { choices: [{ message: { content: "Synthetic planner finished." }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
  });
  const env = { DB: db, AI: { run }, ME3_AGENT_SUGGESTED_REPLIES: "off",ME3_AGENT_MEMORY:"off", ME3_DEPLOYMENT_MODE: "self_hosted" } as unknown as Env;
  const inputFor = (turnId: string, messageText: string): NewAgentDispatchInput => ({ userId: "owner", threadId: "thread", turnId, requestId: `${turnId}:request`, messageText });
  async function execute(turnId: string, journey: Journey, signal = new AbortController().signal) {
    journeys.set(turnId, journey); const input = inputFor(turnId, journey.messageText);
    await persistAgentInput(db, { ownerId: "owner", threadId: "thread", turnId, requestId: input.requestId }, input);
    return executeNewAgentTurn(env, input, signal);
  }
  const rows = (prefix: string) => raw.prepare("SELECT id,remind_at,notes FROM user_reminders WHERE id IN (?,?) ORDER BY id").all(`${prefix}-alpha`, `${prefix}-beta`);
  const effects = () => raw.prepare("SELECT record_id,before_at,after_at FROM test_history_effects ORDER BY seq").all();
  return { db, env, execute, inputFor, rows, effects, evidence, run, raw: () => raw, reopen() { raw.close(); raw = new DatabaseSync(file); } };
}

async function failedUnrelatedPartial(f: ReturnType<typeof fixture>) {
  expect(await f.execute("complete-read", { messageText: "Show the Completed QA reminders only.", calls: [read("Completed QA")] })).toMatchObject({ status: "complete" });
  expect(await f.execute("failed-partial", { messageText: partialPrompt, calls: [read("Partial QA"), partialA], verdict: partialVerdict }))
    .toMatchObject({ status: "failed", replyText: "Completed 1 of 2 requested actions. The remaining work is unfinished." });
  expect(f.effects()).toMatchObject([{ record_id: "partial-alpha" }]);
  expect(f.rows("partial")).toMatchObject([{ id: "partial-alpha", remind_at: "2027-01-16T09:30:00.000Z" }, { id: "partial-beta", remind_at: "2027-01-17T12:00:00Z" }]);
  f.reopen();
}

describe("new Worker target intent isolation after terminal failed unrelated work", () => {
  it("executes a self-contained fresh ordered pair after complete-read and unrelated partial-failed turns", async () => {
    const f = fixture(); await failedUnrelatedPartial(f);
    const foreignBefore = f.raw().prepare("SELECT * FROM user_reminders WHERE id='foreign'").get();
    const result = await f.execute("fresh-request", { messageText: freshPrompt, calls: [read("Fresh QA"), freshA, freshB], verdict: freshVerdict });
    f.reopen();
    expect(f.rows("fresh")).toMatchObject([{ id: "fresh-alpha", remind_at: "2027-01-16T09:30:00.000Z", notes: "Preserve Alpha notes" }, { id: "fresh-beta", remind_at: "2027-01-18T10:00:00.000Z", notes: "Preserve Beta notes" }]);
    expect(result.status).toBe("complete");
    expect(f.effects().map(row => row.record_id)).toEqual(["partial-alpha", "fresh-alpha", "fresh-beta"]);
    const judged = f.evidence.filter(row => row.turnId === "fresh-request"); expect(judged).toHaveLength(1);
    expect(judged[0].evidence.ownerInputs.map(row => row.turnId)).toEqual(["fresh-request"]);
    expect(judged[0].evidence.targets.flatMap(panel => panel.candidates.map(row => row.id)).sort()).toEqual(["fresh-alpha", "fresh-beta"]);
    expect(judged[0].evidence.sourceReads?.every(row => row.readTurnId === "fresh-request")).toBe(true);
    expect(f.raw().prepare("SELECT * FROM user_reminders WHERE id='foreign'").get()).toEqual(foreignBefore);
    const calls = f.run.mock.calls.length;
    await f.execute("fresh-request", { messageText: freshPrompt, calls: [read("Fresh QA"), freshA, freshB], verdict: freshVerdict });
    expect(f.run).toHaveBeenCalledTimes(calls); expect(f.effects()).toHaveLength(3);
  });

  it("admits the fresh pair then honors Stop after its first native effect", async () => {
    const f = fixture(); await failedUnrelatedPartial(f); const controller = new AbortController();
    const result = await f.execute("fresh-stop", { messageText: freshPrompt, calls: [read("Fresh QA"), freshA, freshB], verdict: freshVerdict, onPlanner(step) { if (step === 3) controller.abort("Owner Stop after Alpha"); } }, controller.signal);
    f.reopen();
    expect(result.status).toBe("cancelled");
    expect(f.rows("fresh")).toMatchObject([{ id: "fresh-alpha", remind_at: "2027-01-16T09:30:00.000Z" }, { id: "fresh-beta", remind_at: "2027-01-17T12:00:00Z" }]);
    expect(f.effects().map(row => row.record_id)).toEqual(["partial-alpha", "fresh-alpha"]);
    expect(f.evidence.filter(row => row.turnId === "fresh-stop")).toHaveLength(1);
    expect(f.raw().prepare("SELECT status FROM me3_agent_tool_receipts WHERE turn_id='fresh-stop' AND tool_name='core_reminders_update'").get()).toMatchObject({ status: "finished" });
  });

  it("still refuses a source connected to an earlier failed read even after a fresh same-ID recapture", async () => {
    const f = fixture(); await failedUnrelatedPartial(f); const before = f.rows("partial");
    const again = move("partial-alpha", "2027-01-20", "11:00");
    await f.execute("connected-request", { messageText: "Move the Partial QA Alpha reminder to 20 January 2027 at 11am Europe/Dublin.", calls: [read("Partial QA"), again], verdict: { decision: "allow", selectedCandidateId: "partial-alpha", authorizedCall: again } });
    f.reopen(); expect(f.rows("partial")).toEqual(before); expect(f.effects()).toHaveLength(1);
    expect(f.evidence.filter(row => row.turnId === "connected-request")).toEqual([]);
    expect(String(f.raw().prepare("SELECT result_json FROM me3_agent_tool_receipts WHERE turn_id='connected-request' AND tool_name='core_reminders_update'").get()!.result_json)).toContain("still overlapping");
  });

  it("never advances past a native action whose durable receipt outcome is uncertain", async () => {
    const f = fixture(), turnId = "uncertain-request", input = f.inputFor(turnId, freshPrompt);
    await persistAgentInput(f.db, { ownerId: "owner", threadId: "thread", turnId, requestId: input.requestId }, input);
    // Reproduce a crash after native Alpha changed but before its receipt could finish.
    f.raw().exec("UPDATE user_reminders SET remind_at='2027-01-16T09:30:00.000Z' WHERE id='fresh-alpha'");
    const key = await toolIdempotencyKey("owner", input.requestId, freshA.name, freshA.arguments);
    f.raw().prepare("INSERT INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status) VALUES('owner',?,?,?,?,'running')")
      .run(key, turnId, freshA.name, JSON.stringify(freshA.arguments));
    const result = await f.execute(turnId, { messageText: freshPrompt, calls: [read("Fresh QA"), freshA, freshB], verdict: freshVerdict });
    f.reopen(); expect(result.status).toBe("failed"); expect(f.effects().map(row => row.record_id)).toEqual(["fresh-alpha"]);
    expect(f.rows("fresh")).toMatchObject([{ id: "fresh-alpha", remind_at: "2027-01-16T09:30:00.000Z" }, { id: "fresh-beta", remind_at: "2027-01-17T12:00:00Z" }]);
    expect(f.raw().prepare("SELECT status FROM me3_agent_tool_receipts WHERE idempotency_key=?").get(key)).toMatchObject({ status: "running" });
  });

  it("retains connected read origins and intervening negation rather than admitting a narrowed forced write", async () => {
    const f = fixture();
    await f.execute("source-read", { messageText: "Show the Fresh QA reminders only.", calls: [read("Fresh QA")] });
    await f.execute("negation", { messageText: "Do not move the Fresh QA Alpha reminder. Show it only.", calls: [] });
    f.reopen(); const before = f.rows("fresh");
    await f.execute("forced-write", { messageText: "Show the Fresh QA Alpha reminder only.", calls: [read("Fresh QA Alpha"), freshA], verdict: { decision: "deny", reason: "The authenticated owner forbids the move and requested only a read." } });
    f.reopen(); expect(f.rows("fresh")).toEqual(before); expect(f.effects()).toEqual([]);
    const judged = f.evidence.filter(row => row.turnId === "forced-write"); expect(judged).toHaveLength(1);
    expect(judged[0].evidence.ownerInputs.map(row => row.turnId)).toEqual(["source-read", "negation", "forced-write"]);
    expect(judged[0].evidence.ownerInputs[1].messageText).toBe("Do not move the Fresh QA Alpha reminder. Show it only.");
    expect(judged[0].evidence.targets.flatMap(panel => panel.candidates.map(row => row.id)).sort()).toEqual(["fresh-alpha", "fresh-beta"]);
    expect(JSON.parse(String(f.raw().prepare("SELECT result_json FROM me3_agent_tool_receipts WHERE turn_id='forced-write' AND tool_name='__me3_target_intent_v1'").get()!.result_json))).toMatchObject({ verdict: { decision: "deny" } });
  });
});

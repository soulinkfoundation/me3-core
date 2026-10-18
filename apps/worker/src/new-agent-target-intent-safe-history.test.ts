import { chatView } from "./test-utils/chat-view";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeNewAgentTurn, type NewAgentDispatchInput } from "./agent-runtime";
import { persistAgentInput, decideAgentApproval } from "../../../packages/agent/src/store";
import { createAgentMailboxServices } from "./agent-mailbox-services";
import { getAgentMailboxMessage } from "../../../packages/agent/src/services/mailbox";
import { EmailProviderInputError } from "./email-providers";
import { canonicalJson, toolIdempotencyKey } from "../../../packages/agent/src/schema";
import type { AgentDb, AgentTargetIntentEvidence } from "../../../packages/agent/src/types";
import type { Env } from "./types";

vi.mock("./ai-providers", () => ({ getAiSettings: async () => ({ defaults: { chat: { providerId: "openai", model: "gpt-5.5" } } }) }));
vi.mock("./ai-gateway", () => ({ getAiGatewayRuntimeConfig: async () => ({ gatewayId: "synthetic" }) }));
vi.mock("./plugins", () => ({ listCorePluginRecords: async () => [] }));
vi.mock("../../../packages/agent-chat/src/owner-snapshot", () => ({ loadOwnerSnapshotContext: async () => ({ prompt: "Synthetic owner" }) }));
vi.mock("./agent-domain-scheduling", () => ({ createStableAgentSchedulingServices: () => ({}) }));
vi.mock("./agent-mailbox-services", async importOriginal => {
  const native = await importOriginal<typeof import("./agent-mailbox-services")>();
  return { createAgentMailboxServices: (env: Env, ownerId: string) => (env as Env & { testNativeMailbox?: boolean }).testNativeMailbox ? native.createAgentMailboxServices(env, ownerId) : {} };
});
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
  const directory = mkdtempSync(join(tmpdir(), "me3-intent-safe-history-")), file = join(directory, "installation.sqlite");
  let raw = new DatabaseSync(file);
  disposals.push(() => { raw.close(); rmSync(directory, { recursive: true, force: true }); });
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, migrations), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username,timezone) VALUES('owner','synthetic','Europe/Dublin'),('other-owner','other-synthetic','UTC');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic');
    CREATE TABLE test_history_effects(seq INTEGER PRIMARY KEY,record_id TEXT,before_at TEXT,after_at TEXT);
    CREATE TRIGGER test_history_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO test_history_effects(record_id,before_at,after_at) VALUES(new.id,old.remind_at,new.remind_at); END;`);
  for (const [prefix, title] of [["menu", "Published Menu QA"], ["partial", "Partial QA"], ["noeffect", "No Effect QA"], ["fresh", "Fresh QA"]]) {
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
    if (next?.name === "core_targets_present" && next.arguments.selectionId === "$current-reminder-selection") {
      const selections = raw.prepare("SELECT id FROM me3_agent_selections WHERE owner_id='owner' AND thread_id='thread' AND read_turn_id=? AND domain='reminder'").all(turnId);
      expect(selections).toHaveLength(1);
      return tool(next.name, { ...next.arguments, selectionId: selections[0].id });
    }
    return next ? tool(next.name, next.arguments) : { choices: [{ message: { content: "Synthetic planner finished." }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
  });
  const env = { DB: db, AI: { run }, ME3_AGENT_SUGGESTED_REPLIES: "off", ME3_DEPLOYMENT_MODE: "self_hosted" } as unknown as Env;
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


// Native Worker, migrated file-backed SQLite and domain CAS are real. AI.run,
// owner snapshot, gateway/settings and unrelated external services are simulated.
// No model verdict is copied from planner arguments; all fixture verdicts below
// are literal authored truth. These tests never call a remote provider.
const oldAction = { date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" };
const noEffectPrompt = "Show the No Effect QA reminders only. Do not change either reminder.";
const forbiddenNoEffect = move("noeffect-alpha", "2027-01-22", "11:00");
const showMenu = { verdict: { decision: "clarify", reason: "The owner has not selected either Published Menu QA reminder; present the immutable choices." }, messageText: "Show the Published Menu QA reminders and let me choose which to move to 16 January 2027 at 9:30am Europe/Dublin.", calls: [read("Published Menu QA"), { name: "core_targets_present", arguments: { selectionId: "$current-reminder-selection", toolName: "core_reminders_update", arguments: oldAction } }] };

function assertKnownTerminalFailed(f: ReturnType<typeof fixture>, turnId: string) {
  const row = f.raw().prepare("SELECT status,response_json FROM me3_agent_turns WHERE turn_id=?").get(turnId)!;
  expect(row.status).toBe("failed");
  const payload = JSON.parse(String(row.response_json));
  expect(payload).toMatchObject({ status: "failed", runtime: "agent", specialist: "core.agent", turnId });
  const assistant = f.raw().prepare("SELECT content,metadata_json FROM assistant_messages WHERE owner_id='owner' AND thread_id='thread' AND role='assistant' AND id=?||':assistant:failed:final'").get(turnId)!;
  expect(assistant.content).toBe(payload.replyText);
  expect(JSON.parse(String(assistant.metadata_json))).toEqual(payload);
  const usage = payload.trace.usage;
  for (const value of [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteInputTokens ?? 0]) expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
  expect(usage.cachedInputTokens + (usage.cacheWriteInputTokens ?? 0)).toBeLessThanOrEqual(usage.inputTokens);
  expect(Number.isFinite(usage.estimatedCostUsd) && usage.estimatedCostUsd >= 0).toBe(true);
  const admitted = f.raw().prepare("SELECT request_count,tokens_in,tokens_out,estimated_cost_usd,metadata_json FROM ai_usage_events WHERE user_id='owner' AND json_extract(metadata_json,'$.me3_turn_id')=?").all(turnId);
  expect(admitted.length).toBeGreaterThan(0);
  expect(admitted.reduce((sum, event) => sum + Number(event.request_count), 0)).toBe(payload.streamMetrics.modelRequestCount);
  for (const event of admitted) {
    const metadata = JSON.parse(String(event.metadata_json));
    expect(metadata).toMatchObject({ costKnown: true, usageReported: true, billingManaged: false, me3_turn_id: turnId });
    expect(Number.isFinite(event.estimated_cost_usd) && Number(event.estimated_cost_usd) >= 0).toBe(true);
    for (const value of [event.tokens_in, event.tokens_out, metadata.cachedInputTokens, metadata.cacheWriteInputTokens]) expect(Number.isSafeInteger(value) && Number(value) >= 0).toBe(true);
    expect(metadata.cachedInputTokens + metadata.cacheWriteInputTokens).toBeLessThanOrEqual(Number(event.tokens_in));
  }
}

async function settledFailuresWithMenu(f: ReturnType<typeof fixture>) {
  const published = await f.execute("published-menu", showMenu);
  expect(published).toMatchObject({ status: "complete", targetPresentation: { status: "pending" } });
  const card = published.targetPresentation as { id: string };
  expect(await f.execute("failed-partial", { messageText: partialPrompt, calls: [read("Partial QA"), partialA], verdict: partialVerdict }))
    .toMatchObject({ status: "failed", replyText: "Completed 1 of 2 requested actions. The remaining work is unfinished." });
  // The readonly owner instruction is independent truth. A malicious scripted
  // planner repeatedly proposes a mutation; denial then step-limit is terminal.
  const noEffect = await f.execute("failed-noeffect", { messageText: noEffectPrompt, calls: [read("No Effect QA"), ...Array.from({ length: 29 }, () => forbiddenNoEffect)], verdict: { decision: "deny", reason: "The owner explicitly forbids both No Effect QA reminder mutations." } });
  expect(noEffect.status).toBe("failed");
  expect(f.effects().map(row => row.record_id)).toEqual(["partial-alpha"]);
  assertKnownTerminalFailed(f, "failed-partial"); assertKnownTerminalFailed(f, "failed-noeffect");
  expect(f.raw().prepare("SELECT status FROM me3_agent_presentations WHERE id=?").get(card.id)).toMatchObject({ status: "pending" });
  f.reopen(); return card;
}
const freshJourney = { messageText: freshPrompt, calls: [read("Fresh QA"), freshA, freshB], verdict: freshVerdict };
async function assertFreshDenied(f: ReturnType<typeof fixture>, turnId: string) {
  const before = f.rows("fresh"), effects = f.effects();
  await f.execute(turnId, freshJourney); f.reopen();
  expect(f.rows("fresh")).toEqual(before); expect(f.effects()).toEqual(effects);
  expect(f.evidence.filter(row => row.turnId === turnId)).toEqual([]);
}


async function nativeMailbox(f: ReturnType<typeof fixture>, send: ReturnType<typeof vi.fn>) {
  Object.assign(f.env, { testNativeMailbox: true, EMAIL: { send } });
  f.raw().exec("INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email) VALUES('owner-mailbox','owner','synthetic','owner@example.test')");
  f.raw().prepare("INSERT INTO email_provider_settings(user_id,provider_id,is_active,config_json) VALUES('owner','cloudflare-email',1,?)")
    .run(JSON.stringify({ transport: "binding", fromAddress: "owner@example.test" }));
  const mailbox = createAgentMailboxServices(f.env, "owner");
  const created = await mailbox.createDraft!({ to: "client@example.test", subject: "Owner reviewed subject", body: "Owner reviewed body" }, "independent-create-draft");
  if ("error" in created) throw new Error(created.error);
  const draftId = created.draft.id;
  const call = { name: "core_mailbox_send", arguments: { draftId } };
  const journey = { messageText: "Send the Owner reviewed subject draft to client@example.test with exactly the Owner reviewed body.", calls: [{ name: "core_mailbox_read", arguments: { messageId: draftId } }, call], verdict: { decision: "allow", selectedCandidateId: draftId, authorizedCall: call } };
  return { mailbox, draftId, created: created.draft, journey };
}
async function approveNativeMail(f: ReturnType<typeof fixture>, journey: Journey) {
  const paused = await f.execute("native-email", journey);
  expect(paused).toMatchObject({ status: "needs_approval", approvalId: expect.any(String) });
  expect(await decideAgentApproval(f.db, "owner", (paused.approvalId as string), "approved")).toBe(true);
  return paused;
}
const sha256 = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(value => value.toString(16).padStart(2, "0")).join("");

describe("safe terminal FAILED intervening owner history with an authoritative old pending menu", () => {
  it("keeps the menu and all known failed history, executes only the fresh disjoint ordered pair, and replays once after reopen", async () => {
    const f = fixture(), card = await settledFailuresWithMenu(f);
    const messages = f.raw().prepare("SELECT id,content FROM assistant_messages ORDER BY created_at,id").all();
    const foreign = f.raw().prepare("SELECT * FROM user_reminders WHERE id='foreign'").get();
    const result = await f.execute("fresh-request", freshJourney); f.reopen();
    expect(result.status).toBe("complete");
    expect(f.rows("fresh")).toMatchObject([{ id: "fresh-alpha", remind_at: "2027-01-16T09:30:00.000Z", notes: "Preserve Alpha notes" }, { id: "fresh-beta", remind_at: "2027-01-18T10:00:00.000Z", notes: "Preserve Beta notes" }]);
    expect(f.rows("partial")).toMatchObject([{ id: "partial-alpha", remind_at: "2027-01-16T09:30:00.000Z" }, { id: "partial-beta", remind_at: "2027-01-17T12:00:00Z" }]);
    expect(f.effects().map(row => row.record_id)).toEqual(["partial-alpha", "fresh-alpha", "fresh-beta"]);
    expect(f.raw().prepare("SELECT * FROM user_reminders WHERE id='foreign'").get()).toEqual(foreign);
    const judged = f.evidence.filter(row => row.turnId === "fresh-request"); expect(judged).toHaveLength(1);
    expect(judged[0].evidence.presentation).toMatchObject({ id: card.id, createdTurnId: "published-menu" });
    expect(judged[0].evidence.ownerInputs.map(row => row.turnId)).toEqual(["published-menu", "failed-partial", "failed-noeffect", "fresh-request"]);
    expect(judged[0].evidence.ownerInputs.map(row => row.messageText)).toEqual([showMenu.messageText, partialPrompt, noEffectPrompt, freshPrompt]);
    expect(judged[0].evidence.sourceReads?.some(row => ["failed-partial", "failed-noeffect"].includes(row.readTurnId))).toBe(false);
    expect(f.raw().prepare("SELECT status FROM me3_agent_presentations WHERE id=?").get(card.id)).toMatchObject({ status: "pending" });
    for (const message of messages) expect(f.raw().prepare("SELECT id,content FROM assistant_messages WHERE id=?").get(message.id)).toEqual(message);
    const calls = f.run.mock.calls.length; await f.execute("fresh-request", freshJourney); f.reopen();
    expect(f.run).toHaveBeenCalledTimes(calls); expect(f.effects()).toHaveLength(3);
  });

  it("still honors Stop after the first effect following known FAILED intervening history", async () => {
    const f = fixture(); await settledFailuresWithMenu(f); const controller = new AbortController();
    const result = await f.execute("fresh-stop", { ...freshJourney, onPlanner(step) { if (step === 3) controller.abort("Owner Stop after native Alpha"); } }, controller.signal);
    f.reopen(); expect(result.status).toBe("cancelled");
    expect(f.rows("fresh")).toMatchObject([{ id: "fresh-alpha", remind_at: "2027-01-16T09:30:00.000Z" }, { id: "fresh-beta", remind_at: "2027-01-17T12:00:00Z" }]);
    expect(f.effects().map(row => row.record_id)).toEqual(["partial-alpha", "fresh-alpha"]);
    expect(f.evidence.filter(row => row.turnId === "fresh-stop")).toHaveLength(1);
  });

  it("does not relax FAILED required connected source origins even when all their usage is known", async () => {
    const f = fixture(); await settledFailuresWithMenu(f); const before = f.rows("partial"), effects = f.effects();
    const again = move("partial-alpha", "2027-01-20", "11:00");
    await f.execute("required-failed", { messageText: "Move Partial QA Alpha to 20 January 2027 at 11am Europe/Dublin.", calls: [read("Partial QA"), again], verdict: { decision: "allow", selectedCandidateId: "partial-alpha", authorizedCall: again } });
    f.reopen(); expect(f.rows("partial")).toEqual(before); expect(f.effects()).toEqual(effects);
    expect(f.evidence.filter(row => row.turnId === "required-failed")).toEqual([]);
  });

  it("does not relax CANCELLED required connected source origins", async () => {
    const f = fixture(); await settledFailuresWithMenu(f);
    await f.execute("cancelled-source", { messageText: "Show the Fresh QA reminders only.", calls: [read("Fresh QA")] });
    f.raw().exec("UPDATE me3_agent_turns SET status='cancelled' WHERE turn_id='cancelled-source'; INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES('owner','cancelled-source:request')");
    await assertFreshDenied(f, "required-cancelled");
  });

  it.each(["unknown usage", "running native tool", "running inference", "pending approval", "unknown native image", "missing stream order", "malformed final trace", "missing final assistant", "cancellation intent", "approval alias", "null cached counters", "missing usage admission"])("blocks a merely intervening failed turn with %s", async kind => {
    const f = fixture(); await settledFailuresWithMenu(f);
    if (kind === "unknown usage") f.raw().exec("UPDATE ai_usage_events SET tokens_in=0,tokens_out=0,estimated_cost_usd=0,metadata_json=json_set(metadata_json,'$.costKnown',json('false'),'$.usageReported',json('false'),'$.baseCostUsd',NULL,'$.cachedInputTokens',0,'$.cacheWriteInputTokens',0) WHERE id=(SELECT id FROM ai_usage_events WHERE json_extract(metadata_json,'$.me3_turn_id')='failed-partial' LIMIT 1)");
    if (kind === "running native tool") {
      const key = await toolIdempotencyKey("owner", "failed-partial:request", partialB.name, partialB.arguments);
      f.raw().prepare("INSERT INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status) VALUES('owner',?,'failed-partial',?,?,'running')").run(key, partialB.name, JSON.stringify(partialB.arguments));
    }
    if (kind === "running inference") f.raw().exec("UPDATE me3_agent_tool_receipts SET status='running' WHERE turn_id='failed-partial' AND tool_name='__me3_target_intent_v1'");
    if (kind === "pending approval") f.raw().prepare("INSERT INTO me3_agent_approvals(id,owner_id,thread_id,turn_id,idempotency_key,tool_name,arguments_json,card_json,status) VALUES('unresolved-approval','owner','thread','failed-partial','held-approval','core_reminders_delete',?,'{}','pending')").run(JSON.stringify({ reminderId: "partial-beta" }));
    if (kind === "unknown native image") f.raw().exec("INSERT INTO me3_agent_image_operations(id,owner_id,thread_id,turn_id,request_id,idempotency_key,prompt,model,billing_managed,status,usage_event_id) VALUES('held-image','owner','thread','failed-partial','failed-partial:request','held-image','Synthetic pending image','openai/gpt-image-2',0,'unknown','held-image-usage')");
    if (kind === "missing stream order") f.raw().exec("DELETE FROM me3_agent_stream_events WHERE turn_id='failed-noeffect'");
    if (kind === "malformed final trace") f.raw().exec("UPDATE me3_agent_turns SET response_json=json_set(response_json,'$.trace.usage.estimatedCostUsd',NULL) WHERE turn_id='failed-partial'; UPDATE assistant_messages SET metadata_json=json_set(metadata_json,'$.trace.usage.estimatedCostUsd',NULL) WHERE role='assistant' AND json_extract(metadata_json,'$.turnId')='failed-partial'");
    if (kind === "missing final assistant") f.raw().exec("DELETE FROM assistant_messages WHERE role='assistant' AND json_extract(metadata_json,'$.turnId')='failed-partial'");
    if (kind === "cancellation intent") f.raw().exec("INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES('owner','failed-partial:request')");
    if (kind === "approval alias") f.raw().exec("INSERT INTO me3_agent_request_aliases(owner_id,request_id,turn_id,input_json) SELECT owner_id,request_id,turn_id,input_json FROM me3_agent_turns WHERE turn_id='failed-partial'");
    if (kind === "null cached counters") f.raw().exec("UPDATE ai_usage_events SET metadata_json=json_set(metadata_json,'$.cachedInputTokens',NULL,'$.cacheWriteInputTokens',NULL) WHERE json_extract(metadata_json,'$.me3_turn_id')='failed-partial'");
    if (kind === "missing usage admission") f.raw().exec("DELETE FROM ai_usage_events WHERE id=(SELECT id FROM ai_usage_events WHERE json_extract(metadata_json,'$.me3_turn_id')='failed-partial' LIMIT 1)");
    await assertFreshDenied(f, `held-${kind}`);
  });

  it("retains an intervening negation through known FAILED turns and rejects a forced write", async () => {
    const f = fixture(); await settledFailuresWithMenu(f);
    await f.execute("negation", { messageText: "Do not move Fresh QA Alpha. Show it only.", calls: [] });
    const before = f.rows("fresh"), effects = f.effects();
    await f.execute("forced-write", { messageText: "Show Fresh QA Alpha only.", calls: [read("Fresh QA Alpha"), freshA], verdict: { decision: "deny", reason: "The owner forbids the move and requests only a read." } });
    f.reopen(); expect(f.rows("fresh")).toEqual(before); expect(f.effects()).toEqual(effects);
    const judged = f.evidence.filter(row => row.turnId === "forced-write"); expect(judged).toHaveLength(1);
    expect(judged[0].evidence.ownerInputs.map(row => row.turnId)).toEqual(["published-menu", "failed-partial", "failed-noeffect", "negation", "forced-write"]);
    expect(judged[0].evidence.ownerInputs[3].messageText).toBe("Do not move Fresh QA Alpha. Show it only.");
  });

  it("uses the authoritative old menu for a numeric reply despite unseen current reads and foreign higher ordinal", async () => {
    const f = fixture(), card = await settledFailuresWithMenu(f);
    f.raw().exec("INSERT INTO assistant_threads(id,owner_id,title) VALUES('foreign-thread','other-owner','Synthetic foreign'); INSERT INTO me3_agent_presentations(id,owner_id,thread_id,domain,selection_id,ordinal,tool_name,arguments_json,candidates_json,created_turn_id,created_at,expires_at,status) SELECT 'foreign-high-ordinal','other-owner','foreign-thread',domain,selection_id,999,tool_name,arguments_json,candidates_json,created_turn_id,created_at,expires_at,'pending' FROM me3_agent_presentations WHERE id='" + card.id + "'");
    const oldSecond = move("menu-beta", "2027-01-16", "09:30"), freshBefore = f.rows("fresh");
    const result = await f.execute("numeric-current", { messageText: "The second one.", calls: [read("Fresh QA"), freshB, oldSecond], verdict: { decision: "allow", selectedCandidateId: "menu-beta", authorizedCall: oldSecond } });
    f.reopen(); expect(result.status).toBe("complete"); expect(f.rows("fresh")).toEqual(freshBefore);
    expect(f.rows("menu")).toMatchObject([{ id: "menu-alpha", remind_at: "2027-01-15T12:00:00Z" }, { id: "menu-beta", remind_at: "2027-01-16T09:30:00.000Z" }]);
    expect(f.effects().map(row => row.record_id)).toEqual(["partial-alpha", "menu-beta"]);
    const judged = f.evidence.filter(row => row.turnId === "numeric-current"); expect(judged).toHaveLength(1);
    expect(judged[0].evidence.presentation).toMatchObject({ id: card.id, ordinal: 1, createdTurnId: "published-menu", action: { name: "core_reminders_update", arguments: oldAction } });
    expect(judged[0].evidence.presentation!.candidates.map(row => row.id)).toEqual(["menu-alpha", "menu-beta"]);
    expect(judged[0].evidence.ownerInputs.map(row => row.turnId)).toEqual(["published-menu", "failed-partial", "failed-noeffect", "numeric-current"]);
  });

  it("blocks unresolved native email delivery after literal durable owner approval even when generic error and AI usage are settled", async () => {
    const f = fixture();
    await f.execute("published-menu", showMenu);
    const send = vi.fn(async () => {
      expect(f.raw().prepare("SELECT status FROM mailbox_messages WHERE id=?").get(draftId)).toMatchObject({ status: "approved" });
      expect(f.raw().prepare("SELECT status FROM email_send_audit WHERE mailbox_message_id=? AND provider_id='agent-operation'").get(draftId)).toMatchObject({ status: "pending" });
      throw new Error("Synthetic email binding accepted the send; transport response was lost");
    });
    const { mailbox, draftId, journey } = await nativeMailbox(f, send);
    const paused = await f.execute("uncertain-email", journey);
    expect(paused).toMatchObject({ status: "needs_approval", approvalId: expect.any(String) });
    expect(send).not.toHaveBeenCalled();
    const approvedSnapshot = JSON.parse(String(f.raw().prepare("SELECT card_json FROM me3_agent_approvals WHERE id=?").get((paused.approvalId as string))!.card_json)).target;
    const reread = await mailbox.read!(draftId);
    if ("error" in reread) throw new Error(reread.error);
    const envelope = (record: Record<string, unknown>) => ({ id: record.id, to: record.toAddress ?? record.to, subject: record.subject, body: record.bodyText ?? record.body, from: record.fromAddress, htmlBody: record.htmlBody, sourceId: record.sourceId, threadKey: record.threadKey, metadata: record.metadata, updatedAt: record.updatedAt });
    expect(canonicalJson(envelope(approvedSnapshot))).toBe(canonicalJson(envelope(reread.message)));
    // Same production durable decision helper used by Home approval. No alias,
    // forged approved context or injected native pending audit is involved.
    expect(await decideAgentApproval(f.db, "owner", (paused.approvalId as string), "approved")).toBe(true);
    expect(await f.execute("uncertain-email", journey)).toMatchObject({ status: "failed" });
    assertKnownTerminalFailed(f, "uncertain-email");
    expect(f.raw().prepare("SELECT status,result_json FROM me3_agent_tool_receipts WHERE turn_id='uncertain-email' AND tool_name='core_mailbox_send'").get())
      .toMatchObject({ status: "finished", result_json: expect.stringContaining("Email delivery is unconfirmed") });
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.raw().prepare("SELECT status FROM me3_agent_approvals WHERE id=?").get((paused.approvalId as string))).toMatchObject({ status: "approved" });
    expect(f.raw().prepare("SELECT COUNT(*) AS count FROM me3_agent_request_aliases WHERE turn_id='uncertain-email'").get()).toMatchObject({ count: 0 });
    expect(f.raw().prepare("SELECT status,result_json FROM me3_agent_tool_receipts WHERE turn_id='uncertain-email' AND tool_name='core_mailbox_send'").get())
      .toMatchObject({ status: "finished", result_json: expect.stringContaining("Email delivery is unconfirmed") });
    expect(f.raw().prepare("SELECT status,metadata_json FROM mailbox_messages WHERE id=?").get(draftId))
      .toMatchObject({ status: "approved", metadata_json: expect.stringContaining("agent_send") });
    const audit = f.raw().prepare("SELECT id,status,metadata_json FROM email_send_audit WHERE mailbox_message_id=? AND provider_id='agent-operation'").get(draftId)!;
    expect(audit).toMatchObject({ status: "pending" });
    expect(JSON.parse(String(audit.metadata_json)).agent_send_operation_id).toBe(audit.id);
    f.reopen();
    await assertFreshDenied(f, "fresh-after-unconfirmed-email");
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.raw().prepare("SELECT status FROM email_send_audit WHERE id=?").get(audit.id)).toMatchObject({ status: "pending" });
  });

  it("sends a canonically unchanged literal owner-approved draft despite nested metadata key order and never sends it twice", async () => {
    const f = fixture(), send = vi.fn(async () => ({ messageId: "synthetic-approved-send" }));
    const { journey, draftId } = await nativeMailbox(f, send);
    const paused = await approveNativeMail(f, journey);
    expect(send).not.toHaveBeenCalled();
    const result = await f.execute("native-email", journey);
    expect(result.status).toBe("complete"); expect(send).toHaveBeenCalledTimes(1);
    expect(f.raw().prepare("SELECT message_kind,status,to_address,subject,text_body FROM mailbox_messages WHERE id=?").get(draftId))
      .toMatchObject({ message_kind: "email", status: "sent", to_address: "client@example.test", subject: "Owner reviewed subject", text_body: "Owner reviewed body" });
    expect(f.raw().prepare("SELECT status FROM me3_agent_approvals WHERE id=?").get((paused.approvalId as string))).toMatchObject({ status: "approved" });
    expect(f.raw().prepare("SELECT status FROM email_send_audit WHERE mailbox_message_id=? AND json_extract(metadata_json,'$.agent_send_operation_id')=id").get(draftId)).toMatchObject({ status: "sent" });
    f.reopen(); const modelCalls = f.run.mock.calls.length;
    await f.execute("native-email", journey); expect(send).toHaveBeenCalledTimes(1); expect(f.run).toHaveBeenCalledTimes(modelCalls);
  });

  it("refuses a body changed after actual owner approval before any provider claim or binding call", async () => {
    const f = fixture(), send = vi.fn(async () => ({ messageId: "synthetic-forbidden-send" }));
    const { journey, draftId } = await nativeMailbox(f, send); await approveNativeMail(f, journey);
    f.raw().prepare("UPDATE mailbox_messages SET text_body='Unreviewed replacement body' WHERE id=?").run(draftId);
    expect(await f.execute("native-email", journey)).toMatchObject({ status: "failed" });
    expect(send).not.toHaveBeenCalled();
    expect(f.raw().prepare("SELECT status,metadata_json FROM mailbox_messages WHERE id=?").get(draftId))
      .toMatchObject({ status: "pending_approval", metadata_json: expect.not.stringContaining("agent_send") });
    expect(f.raw().prepare("SELECT COUNT(*) AS count FROM email_send_audit WHERE mailbox_message_id=?").get(draftId)).toMatchObject({ count: 0 });
  });

  it.each(["pending", "sent"] as const)("reconciles restored legacy raw-JSON claim %s without a provider retry", async status => {
    const f = fixture(), send = vi.fn(async () => ({ messageId: "must-not-send" }));
    const { mailbox, draftId } = await nativeMailbox(f, send);
    const native = await getAgentMailboxMessage(f.env, "owner", draftId);
    if ("error" in native) throw new Error(native.error);
    // Historical claims predate the effective-sender projection and bind the
    // native stored alias, with no deliveryIdentity/storedFromAddress fields.
    const created = { ...native.message, toAddress: native.message.toAddress || "", bodyText: native.message.body };
    const key = "restored-legacy-operation", operationId = "agent-mailbox-" + await sha256(JSON.stringify(["owner", key]));
    // A restored pre-canonicalization operation uses the old raw insertion order.
    // This is explicitly historical fixture state, not a fabricated provider red.
    const legacyEnvelope = { id: created.id, to: created.toAddress, subject: created.subject, body: created.bodyText, from: created.fromAddress, htmlBody: created.htmlBody, sourceId: created.sourceId, threadKey: created.threadKey, metadata: created.metadata, updatedAt: created.updatedAt };
    const fingerprint = await sha256(JSON.stringify(legacyEnvelope));
    const claim = { operationId, fingerprint, reviewedUpdatedAt: created.updatedAt };
    f.raw().prepare("UPDATE mailbox_messages SET status='approved',approved_by_user_id='owner',metadata_json=?,updated_at='2026-10-12T00:00:00Z' WHERE id=?")
      .run(JSON.stringify({ ...created.metadata as Record<string, unknown>, agent_send: claim }), draftId);
    f.raw().prepare("INSERT INTO email_send_audit(id,user_id,mailbox_id,mailbox_message_id,provider_id,status,purpose,to_address,subject,metadata_json,provider_message_id,sent_at) VALUES(?,'owner','owner-mailbox',?,'cloudflare-email',?,'draft','client@example.test','Owner reviewed subject',?,? ,?)")
      .run(operationId, draftId, status, JSON.stringify({ agent_send_operation_id: operationId, agent_send_fingerprint: fingerprint }), status === "sent" ? "legacy-synthetic-message" : null, status === "sent" ? "2026-10-12T01:00:00Z" : null);
    f.reopen(); const canonicalExpected = JSON.parse(canonicalJson(created));
    const result = await mailbox.sendDraft!(draftId, key, canonicalExpected);
    if (status === "sent") expect(result).toMatchObject({ draft: { kind: "email", status: "sent" } });
    else expect(result).toMatchObject({ error: expect.stringContaining("unconfirmed") });
    expect(send).not.toHaveBeenCalled();
    expect(f.raw().prepare("SELECT status,metadata_json FROM email_send_audit WHERE id=?").get(operationId)).toMatchObject({ status });
    expect(JSON.parse(String(f.raw().prepare("SELECT metadata_json FROM mailbox_messages WHERE id=?").get(draftId)!.metadata_json)).agent_send.fingerprint).toBe(fingerprint);
  });

  it("admits a fresh disjoint request after a natively sent email followed by a settled model step-limit failure", async () => {
    const f = fixture(); await f.execute("published-menu", showMenu);
    const send = vi.fn(async () => ({ messageId: "synthetic-settled-native-email" }));
    const native = await nativeMailbox(f, send);
    const journey = { ...native.journey, calls: [...native.journey.calls, ...Array.from({ length: 28 }, () => read("No Effect QA"))] };
    await approveNativeMail(f, journey);
    expect(await f.execute("native-email", journey)).toMatchObject({ status: "failed" });
    assertKnownTerminalFailed(f, "native-email");
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.raw().prepare("SELECT message_kind,status,text_body FROM mailbox_messages WHERE id=?").get(native.draftId))
      .toMatchObject({ message_kind: "email", status: "sent", text_body: "Owner reviewed body" });
    expect(f.raw().prepare("SELECT status FROM email_send_audit WHERE mailbox_message_id=? AND json_extract(metadata_json,'$.agent_send_operation_id')=id").get(native.draftId))
      .toMatchObject({ status: "sent" });
    f.reopen();
    expect(await f.execute("fresh-after-settled-native-mail", freshJourney)).toMatchObject({ status: "complete" });
    f.reopen(); expect(f.effects().map(row => row.record_id)).toEqual(["fresh-alpha", "fresh-beta"]);
    expect(f.evidence.filter(row => row.turnId === "fresh-after-settled-native-mail")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("blocks a natively sent audit with a real post-send message mismatch rather than treating its failed turn settled", async () => {
    const f = fixture(); await f.execute("published-menu", showMenu);
    const send = vi.fn(async () => {
      f.raw().prepare("UPDATE mailbox_messages SET text_body='Concurrent unreviewed replacement' WHERE id=?").run(native.draftId);
      return { messageId: "synthetic-accepted-before-concurrent-edit" };
    });
    const native = await nativeMailbox(f, send);
    await approveNativeMail(f, native.journey);
    expect(await f.execute("native-email", native.journey)).toMatchObject({ status: "failed" });
    assertKnownTerminalFailed(f, "native-email");
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: "client@example.test", text: "Owner reviewed body" }));
    expect(f.raw().prepare("SELECT message_kind,status,text_body FROM mailbox_messages WHERE id=?").get(native.draftId))
      .toMatchObject({ message_kind: "draft", status: "approved", text_body: "Concurrent unreviewed replacement" });
    expect(f.raw().prepare("SELECT status FROM email_send_audit WHERE mailbox_message_id=? AND json_extract(metadata_json,'$.agent_send_operation_id')=id").get(native.draftId))
      .toMatchObject({ status: "sent" });
    f.reopen(); await assertFreshDenied(f, "fresh-after-mismatched-native-mail"); expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a definitive native recipient rejection settled without retrying that approved operation", async () => {
    const f = fixture(); await f.execute("published-menu", showMenu);
    const send = vi.fn(async () => { throw new EmailProviderInputError("Synthetic definitive recipient rejection", 422); });
    const native = await nativeMailbox(f, send); await approveNativeMail(f, native.journey);
    expect(await f.execute("native-email", native.journey)).toMatchObject({ status: "failed" });
    assertKnownTerminalFailed(f, "native-email"); expect(send).toHaveBeenCalledTimes(1);
    expect(f.raw().prepare("SELECT message_kind,status,error_message,sent_at FROM mailbox_messages WHERE id=?").get(native.draftId))
      .toMatchObject({ message_kind: "draft", status: "failed", error_message: "Synthetic definitive recipient rejection", sent_at: null });
    expect(f.raw().prepare("SELECT status,error_message,sent_at FROM email_send_audit WHERE mailbox_message_id=? AND json_extract(metadata_json,'$.agent_send_operation_id')=id").get(native.draftId))
      .toMatchObject({ status: "failed", error_message: "Synthetic definitive recipient rejection", sent_at: null });
    f.reopen(); expect(await f.execute("fresh-after-definitive-native-mail", freshJourney)).toMatchObject({ status: "complete" });
    f.reopen(); expect(f.effects().map(row => row.record_id)).toEqual(["fresh-alpha", "fresh-beta"]); expect(send).toHaveBeenCalledTimes(1);
  });
});

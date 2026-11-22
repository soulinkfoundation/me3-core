import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDb } from "../../../packages/agent/src/types";
import { rememberDeferredTurns } from "./agent-memory-backlog";
import { executeNewAgentTurn, type NewAgentDispatchInput } from "./agent-runtime";
import type { Env } from "./types";

// Failure modes (me3-bybb.15): under load a free message still makes its follow-up and memory calls and runs into the
// provider's per-minute input limit; or memory from a busy turn is silently lost instead of read later in one call.
vi.mock("./ai-providers", () => ({ getAiSettings: async () => ({ defaults: { chat: { providerId: "openai", model: "gpt-5.5" } } }) }));
vi.mock("./ai-gateway", () => ({ getAiGatewayRuntimeConfig: async () => ({ gatewayId: "fixture" }) }));
vi.mock("./plugins", () => ({ listCorePluginRecords: async () => [] }));
vi.mock("../../../packages/agent-chat/src/owner-snapshot", () => ({ loadOwnerSnapshotContext: async () => ({ prompt: "Synthetic owner" }) }));
vi.mock("./agent-domain-scheduling", () => ({ createStableAgentSchedulingServices: () => ({}) }));
vi.mock("./agent-mailbox-services", () => ({ createAgentMailboxServices: () => ({}) }));
vi.mock("./network-directory", () => ({ createPeopleSearchToolServices: () => ({}) }));
vi.mock("./web-research", () => ({ createWebResearchToolServices: () => ({}) }));
vi.mock("../../../packages/agent/src/tools", () => ({ createDomainTools: () => [] }));

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function database() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  raw.exec("INSERT INTO owner_profile(id,username) VALUES('owner','synthetic'); INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic');");
  const db: AgentDb = { prepare(sql) {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (query.get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: query.all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; } }; return statement;
  }, async batch(statements) { raw.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
  return { raw, db };
}

function fixture(shed: boolean) {
  const { raw, db } = database();
  const calls: string[] = [];
  const memoryInputs: string[] = [];
  const run = async (_model: string, request: { messages?: Array<{ content?: unknown }> }) => {
    const text = JSON.stringify(request);
    const tool = text.includes("long-term memory") ? "core_memory_ops" : text.includes("suggest quick replies") ? "suggestions" : "chat";
    calls.push(tool);
    if (tool === "core_memory_ops") {
      memoryInputs.push(String(request.messages?.at(-1)?.content));
      return { choices: [{ message: { content: "", tool_calls: [{ id: "m", type: "function", function: { name: "core_memory_ops", arguments: JSON.stringify({ ops: [{ op: "add", kind: "preference", body: "Owner prefers tea.", importance: 3, sensitive: false }] }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 50, completion_tokens: 5 } };
    }
    return { choices: [{ message: { content: "Noted." }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
  };
  const env = { DB: db, ME3_DEPLOYMENT_MODE: "self_hosted", ME3_AGENT_FAST_MODEL: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", AI: { run }, ME3_AGENT_SHED_AFTER_TURN: async () => shed } as unknown as Env;
  return { raw, env, calls, memoryInputs };
}

const turn = (n: number, text: string): NewAgentDispatchInput => ({ userId: "owner", threadId: "thread", turnId: `turn${n}`, requestId: `request${n}`, messageText: text });
const deferred = (raw: DatabaseSync) => raw.prepare("SELECT turn_id FROM me3_agent_turns WHERE json_extract(trace_json,'$.memoryDeferred') = 1 ORDER BY turn_id").all().map(row => row.turn_id);

describe("after-turn model calls under load", () => {
  it("makes follow-up and memory calls when free chat is quiet", async () => {
    const { env, calls } = fixture(false);
    await executeNewAgentTurn(env, turn(1, "I like tea"), new AbortController().signal);
    expect(calls.filter(call => call === "chat")).toHaveLength(1);
    expect(calls).toContain("core_memory_ops");
    expect(calls.length).toBe(3);
  });

  it("makes a busy message one model call and reads its memory later, several turns in one call", async () => {
    const { raw, env, calls, memoryInputs } = fixture(true);
    const first = await executeNewAgentTurn(env, turn(1, "I like tea"), new AbortController().signal);
    await executeNewAgentTurn(env, turn(2, "My sister is Ana"), new AbortController().signal);
    expect(first).toMatchObject({ status: "complete", replyText: "Noted." });
    expect(first.suggestedReplies).toBeUndefined();
    expect(calls).toEqual(["chat", "chat"]);
    expect(deferred(raw)).toEqual(["turn1", "turn2"]);

    calls.length = 0;
    expect(await rememberDeferredTurns(env, new AbortController().signal)).toBe(2);
    expect(calls).toEqual(["core_memory_ops"]);
    expect(memoryInputs[0]).toContain("I like tea");
    expect(memoryInputs[0]).toContain("My sister is Ana");
    expect(raw.prepare("SELECT body FROM mission_private_memory").all()).toEqual([{ body: "Owner prefers tea." }]);
    expect(deferred(raw)).toEqual([]);
    expect(await rememberDeferredTurns(env, new AbortController().signal)).toBe(0);
  });
});

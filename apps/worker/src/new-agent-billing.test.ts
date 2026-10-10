import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1TurnStore } from "../../../packages/agent/src/store";
import type { AgentCheckpoint, AgentDb, AgentTool } from "../../../packages/agent/src/types";
import { executeNewAgentTurn, type NewAgentDispatchInput } from "./agent-runtime";
import { syncManagedAiUsage, type ManagedAiBillingSettings } from "./managed-ai-billing";
import type { Env } from "./types";

const fixtureTools = vi.hoisted(() => ({ value: [] as AgentTool[] }));
const fixtureSnapshot = vi.hoisted(() => ({ calls: 0, gate: undefined as Promise<void> | undefined, entered: undefined as (() => void) | undefined }));
vi.mock("./ai-providers", () => ({ getAiSettings: async () => ({ defaults: { chat: { providerId: "openai", model: "gpt-5.5" } } }) }));
vi.mock("./ai-gateway", () => ({ getAiGatewayRuntimeConfig: async () => ({ gatewayId: "fixture" }) }));
vi.mock("./plugins", () => ({ listCorePluginRecords: async () => [] }));
vi.mock("../../../packages/agent-chat/src/owner-snapshot", () => ({ loadOwnerSnapshotContext: async () => { if (fixtureSnapshot.calls++ === 0 && fixtureSnapshot.gate) { fixtureSnapshot.entered?.(); await fixtureSnapshot.gate; } return { prompt: "Synthetic owner" }; } }));
vi.mock("./agent-domain-scheduling", () => ({ createStableAgentSchedulingServices: () => ({}) }));
vi.mock("./agent-mailbox-services", () => ({ createAgentMailboxServices: () => ({}) }));
vi.mock("./network-directory", () => ({ createPeopleSearchToolServices: () => ({}) }));
vi.mock("./web-research", () => ({ createWebResearchToolServices: () => ({}) }));
vi.mock("../../../packages/agent/src/tools", () => ({ createDomainTools: () => fixtureTools.value }));
vi.mock("./managed-runtime-lifecycle", () => ({ isManagedRuntime: (env: Env) => env.ME3_DEPLOYMENT_MODE === "managed", beginManagedRuntimeWriteLease: async () => "fixture-lease", releaseManagedRuntimeWriteLease: async () => {} }));

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.unstubAllGlobals(); fixtureTools.value = []; fixtureSnapshot.calls = 0; fixtureSnapshot.gate = undefined; fixtureSnapshot.entered = undefined; });
const fallback = "@cf/zai-org/glm-4.7-flash";
const input: NewAgentDispatchInput = { userId: "owner", threadId: "thread", turnId: "turn", requestId: "request", messageText: "Read the synthetic record" };
function settings(overrides: Partial<ManagedAiBillingSettings> = {}): ManagedAiBillingSettings {
  return { available: true, managed: true, currency: "usd", billingSource: "internal", defaultModel: "openai/gpt-5.5", models: ["openai/gpt-5.5", "openai/gpt-6.1-sol", "anthropic/claude-opus-5.5", "zai-org/glm-5.3-flash"].map(id => ({ id, label: id, description: "Synthetic", recommended: false })), eligible: true, ineligibleReason: null, overagesEnabled: false, includedMonthlyCents: 500, monthlyMaximumCents: 500, minimumMonthlyMaximumCents: 600, maximumMonthlyMaximumCents: 50_000, currentMonth: new Date().toISOString().slice(0, 7), currentMonthUsageMicrousd: 0, currentMonthBillableMicrousd: 0, effectiveMaximumCents: 500, fallbackActive: false, ...overrides };
}
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
function fixture(policy = settings(), response?: (model: string, index: number) => unknown) {
  const { raw, db } = database(); const models: string[] = []; const events: Array<Record<string, unknown>> = [];
  const accepted = new Set<string>();
  const bridge = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/usage")) {
      const incoming = JSON.parse(String(init?.body)).events as Array<Record<string, unknown>>;
      for (const event of incoming) if (!accepted.has(String(event.id))) { accepted.add(String(event.id)); events.push(event); policy.currentMonthUsageMicrousd += Number(event.costMicrousd); }
      return Response.json({ acceptedEventIds: incoming.map(event => event.id), settings: policy });
    }
    return Response.json(policy);
  });
  vi.stubGlobal("fetch", bridge);
  const env = { DB: db, ME3_DEPLOYMENT_MODE: "managed", ME3_COMMERCE_BRIDGE_ORIGIN: "https://billing.example.invalid", ME3_COMMERCE_BRIDGE_TOKEN: "synthetic-fixture", AI: { async run(model: string) { models.push(model); return response?.(model, models.length - 1) ?? completion(model); } } } as unknown as Env;
  return { raw, db, env, models, events, bridge };
}
function completion(model: string, tool = false) {
  if (model.startsWith("anthropic/")) return { content: [{ type: "text", text: "Read complete." }], usage: { input_tokens: 100, output_tokens: 10 } };
  return { choices: [{ message: { content: tool ? "" : "Read complete.", ...(tool ? { tool_calls: [{ id: "read", type: "function", function: { name: "fixture_read", arguments: "{}" } }] } : {}) }, finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
}

describe("new agent managed billing boundary", () => {
  it.each([["openai", "openai/gpt-6.1-sol", "openai", 0.0003, 0.05], ["anthropic", "anthropic/claude-opus-5.5", "anthropic", 0.0006, 0.05], ["workers-ai", "@cf/zai-org/glm-5.3-flash", "zai-org", 0.00002, 0]] as const)("records %s model author separately from the Workers AI transport and preserves managed fees", async (providerId, model, modelAuthor, baseCostUsd, billingFeeRate) => {
    const policy = settings({ models: [{ id: model, label: model, description: "Synthetic", recommended: false }] });
    const { env, raw } = fixture(policy);
    expect(await executeNewAgentTurn(env, { ...input, selectedModel: { providerId, model } }, new AbortController().signal)).toMatchObject({ status: "complete" });
    const row = raw.prepare("SELECT provider,model,estimated_cost_usd,metadata_json FROM ai_usage_events").get()!;
    expect(row).toMatchObject({ provider: "workers-ai", model });
    expect(Number(row.estimated_cost_usd)).toBeCloseTo(baseCostUsd * (1 + billingFeeRate), 10);
    expect(JSON.parse(String(row.metadata_json))).toMatchObject({ modelAuthor, costKnown: true, baseCostUsd, billingFeeRate });
  });
  it("uses the canonical native binding ID for an explicitly selected bare hosted model ID", async () => {
    const { env, models, raw } = fixture(settings({ defaultModel: "zai-org/glm-5.3-flash" }));
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(models).toEqual(["@cf/zai-org/glm-5.3-flash"]);
    expect(Number(raw.prepare("SELECT estimated_cost_usd FROM ai_usage_events").get()!.estimated_cost_usd)).toBeCloseTo(0.00002, 10);
  });
  it("uses the canonical native binding ID for a self-hosted bare Workers AI selection", async () => {
    const { env, models, raw } = fixture(); env.ME3_DEPLOYMENT_MODE = "self_hosted";
    expect(await executeNewAgentTurn(env, { ...input, selectedModel: { providerId: "workers-ai", model: "zai-org/glm-5.3-flash" } }, new AbortController().signal)).toMatchObject({ status: "complete", model: "@cf/zai-org/glm-5.3-flash" });
    expect(models).toEqual(["@cf/zai-org/glm-5.3-flash"]);
    const row = raw.prepare("SELECT estimated_cost_usd,metadata_json FROM ai_usage_events").get()!;
    expect(Number(row.estimated_cost_usd)).toBeCloseTo(0.00002, 10);
    expect(JSON.parse(String(row.metadata_json))).toMatchObject({ billingManaged: false, billingFeeRate: 0, costKnown: true });
  });
  it("uses the canonical native binding ID for a self-hosted bare backup after transport failure", async () => {
    const { env, models, raw } = fixture(settings(), (model, index) => { if (index === 0) throw new Error("Synthetic transport failure"); return completion(model); });
    env.ME3_DEPLOYMENT_MODE = "self_hosted"; env.ME3_AI_CHAT_BACKUP_MODEL = "zai-org/glm-5.3-flash";
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete", model: "@cf/zai-org/glm-5.3-flash" });
    expect(models).toEqual(["openai/gpt-5.5", "@cf/zai-org/glm-5.3-flash"]);
    expect(raw.prepare("SELECT COUNT(*) count FROM ai_usage_events WHERE json_extract(metadata_json,'$.costKnown')=0").get()).toMatchObject({ count: 1 });
  });
  it.each([{ fallbackActive: true }, { currentMonthUsageMicrousd: 5_000_000 }])("uses the unchanged hosted fallback when the budget policy is reached: %j", async policy => {
    const { env, models } = fixture(settings(policy));
    await executeNewAgentTurn(env, input, new AbortController().signal);
    expect(models).toEqual([fallback]);
  });
  it("syncs the first receipt and checks the hosted maximum before the next model step", async () => {
    fixtureTools.value = [{ name: "fixture_read", description: "Read synthetic", parameters: { type: "object" }, effect: "read", approval: "none", async execute() { return { status: "ok", data: { title: "Synthetic" } }; } }];
    const { env, models, events } = fixture(settings({ currentMonthUsageMicrousd: 4_999_999 }), (model, index) => completion(model, index === 0));
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete", model: fallback, trace: expect.objectContaining({ model: fallback }) });
    expect(models).toEqual(["openai/gpt-5.5", fallback]);
    expect(events).toEqual([expect.objectContaining({ provider: "workers-ai", model: "openai/gpt-5.5", costMicrousd: 840 })]);
  });
  it("rechecks hosted policy when a saved turn resumes", async () => {
    const { env, db, models } = fixture(settings({ fallbackActive: true }));
    const state: AgentCheckpoint = { messages: [{ role: "user", content: input.messageText }], status: "running", steps: 1, trace: { model: "openai/gpt-5.5", steps: 1, startedAt: new Date().toISOString(), totalDurationMs: 0, timeToFirstTokenMs: null, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 } } };
    await createD1TurnStore(db, { ownerId: input.userId, threadId: input.threadId, turnId: input.turnId, requestId: input.requestId }).save(state);
    await executeNewAgentTurn(env, input, new AbortController().signal);
    expect(models).toEqual([fallback]);
  });
  it("fails closed before a later model call if hosted eligibility is revoked", async () => {
    fixtureTools.value = [{ name: "fixture_read", description: "Read synthetic", parameters: { type: "object" }, effect: "read", approval: "none", async execute() { return { status: "ok" }; } }];
    const policy = settings(); const { env, models } = fixture(policy, (model, index) => { if (index === 0) { policy.eligible = false; policy.ineligibleReason = "Synthetic policy revoked"; } return completion(model, true); });
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "failed", replyText: expect.stringContaining("Synthetic policy revoked") });
    expect(models).toEqual(["openai/gpt-5.5"]);
  });
  it("excludes unknown costs without starving later known receipts or marking them reported", async () => {
    const { env, raw, events } = fixture();
    const insert = raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,tokens_in,tokens_out,estimated_cost_usd,metadata_json) VALUES(?,'owner','text','workers-ai','openai/gpt-5.5',100,10,?,?)");
    for (let index = 0; index < 101; index++) insert.run(`unknown-${index}`, 0, JSON.stringify({ costKnown: false }));
    insert.run("known", 0.0008, JSON.stringify({ costKnown: true }));
    await syncManagedAiUsage(env);
    expect(events).toEqual([expect.objectContaining({ id: "known", costMicrousd: 800 })]);
    expect(raw.prepare("SELECT COUNT(*) count FROM ai_usage_events WHERE id LIKE 'unknown-%' AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL").get()).toMatchObject({ count: 0 });
  });
  it("blocks the next paid call when a new-agent model returns no cost receipt", async () => {
    fixtureTools.value = [{ name: "fixture_read", description: "Read synthetic", parameters: { type: "object" }, effect: "read", approval: "none", async execute() { return { status: "ok" }; } }];
    const { env, models, raw } = fixture(settings(), model => { const { usage: _usage, ...response } = completion(model, true); return response; });
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "failed", replyText: expect.stringContaining("cost is awaiting reconciliation") });
    expect(models).toEqual(["openai/gpt-5.5"]);
    expect(JSON.parse(String(raw.prepare("SELECT metadata_json FROM ai_usage_events").get()!.metadata_json))).toMatchObject({ me3_runtime: "agent", costKnown: false });
  });
  it("blocks resumed inference for current owner new-agent unknown costs", async () => {
    const { env, raw, models } = fixture();
    raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,estimated_cost_usd,metadata_json) VALUES('uncertain','owner','text','workers-ai','openai/gpt-5.5',0,?)").run(JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false }));
    await expect(executeNewAgentTurn(env, input, new AbortController().signal)).rejects.toThrow("cost is awaiting reconciliation");
    expect(models).toEqual([]);
  });
  it("does not spend against stale hosted totals when the billing bridge rejects a known receipt", async () => {
    fixtureTools.value = [{ name: "fixture_read", description: "Read synthetic", parameters: { type: "object" }, effect: "read", approval: "none", async execute() { return { status: "ok" }; } }];
    const policy = settings(); const { env, models, bridge } = fixture(policy, model => completion(model, true));
    bridge.mockImplementation(async (url: string) => url.endsWith("/usage") ? Response.json({ error: "Synthetic usage rejection" }, { status: 503 }) : Response.json(policy));
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "failed", replyText: expect.stringContaining("usage is awaiting reconciliation") });
    expect(models).toEqual(["openai/gpt-5.5"]);
  });
  it("atomically admits one same-owner managed paid request and allows another after reconciliation", async () => {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const { env, models } = fixture(settings(), async model => { entered(); await gate; return completion(model); });
    const first = executeNewAgentTurn(env, input, new AbortController().signal);
    const second = executeNewAgentTurn(env, { ...input, turnId: "second-turn", requestId: "second-request" }, new AbortController().signal);
    try { await started; await new Promise(resolve => setTimeout(resolve, 0)); expect(models).toHaveLength(1); }
    finally { release(); await Promise.allSettled([first, second]); }
    expect(await first).toMatchObject({ status: "complete" });
    expect(await second).toMatchObject({ status: "failed", replyText: expect.stringContaining("is awaiting reconciliation") });
    expect(await executeNewAgentTurn(env, { ...input, turnId: "third-turn", requestId: "third-request" }, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(models).toHaveLength(2);
  });
  it("refreshes first-call policy when another turn crosses the budget during delayed context preparation", async () => {
    let release!: () => void; let entered!: () => void;
    fixtureSnapshot.gate = new Promise<void>(resolve => { release = resolve; });
    const prepared = new Promise<void>(resolve => { entered = resolve; }); fixtureSnapshot.entered = entered;
    const { env, models } = fixture(settings({ currentMonthUsageMicrousd: 4_999_999 }));
    const delayed = executeNewAgentTurn(env, input, new AbortController().signal);
    try {
      await prepared;
      expect(await executeNewAgentTurn(env, { ...input, turnId: "paid-turn", requestId: "paid-request" }, new AbortController().signal)).toMatchObject({ status: "complete" });
      await syncManagedAiUsage(env);
    } finally { release(); }
    expect(await delayed).toMatchObject({ status: "complete", model: fallback });
    expect(models).toEqual(["openai/gpt-5.5", fallback]);
  });
  it("does not admit stale premium policy if another receipt is reported after lookup but before atomic admission", async () => {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const prepared = new Promise<void>(resolve => { entered = resolve; });
    const { env, db, models } = fixture(settings({ currentMonthUsageMicrousd: 4_999_999 }));
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql.startsWith("INSERT INTO ai_usage_events")) {
        const bind = statement.bind.bind(statement);
        statement.bind = (...values) => { const bound = bind(...values); if (String(values[0]).startsWith("turn:model:")) { const run = bound.run.bind(bound); bound.run = async () => { entered(); await gate; return run(); }; } return bound; };
      }
      return statement;
    });
    const delayed = executeNewAgentTurn(env, input, new AbortController().signal);
    try {
      await prepared;
      expect(await executeNewAgentTurn(env, { ...input, turnId: "paid-turn", requestId: "paid-request" }, new AbortController().signal)).toMatchObject({ status: "complete" });
      await syncManagedAiUsage(env);
    } finally { release(); }
    try { expect(await delayed).toMatchObject({ status: "failed" }); expect(models).toEqual(["openai/gpt-5.5"]); }
    finally { spy.mockRestore(); }
  });
  it("detects an already-known legacy image receipt reported between policy lookup and model admission", async () => {
    let release!: () => void; let entered!: () => void; let accept = false;
    const gate = new Promise<void>(resolve => { release = resolve; }); const prepared = new Promise<void>(resolve => { entered = resolve; });
    const { env, db, raw, models, bridge } = fixture(settings({ currentMonthUsageMicrousd: 4_999_999 }));
    raw.exec("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,estimated_cost_usd,metadata_json) VALUES('legacy-known-image','owner','image','workers-ai','@cf/black-forest-labs/flux-2-klein-4b',0.0001,'{}');");
    const defaultBridge = bridge.getMockImplementation()!;
    bridge.mockImplementation(async (url, init) => url.endsWith("/usage") && !accept ? Response.json({ error: "Synthetic rejected sync" }, { status: 503 }) : defaultBridge(url, init));
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql.startsWith("INSERT INTO ai_usage_events")) { const run = statement.run.bind(statement); statement.run = async () => { entered(); await gate; return run(); }; }
      return statement;
    });
    const delayed = executeNewAgentTurn(env, input, new AbortController().signal);
    try { await prepared; accept = true; await syncManagedAiUsage(env); } finally { release(); }
    try { expect(await delayed).toMatchObject({ status: "failed" }); expect(models).toEqual([]); } finally { spy.mockRestore(); }
  });
  it("keeps unknown legacy, other-owner and prior-month costs outside the new-agent budget barrier", async () => {
    const { env, raw, models } = fixture();
    raw.exec("INSERT INTO owner_profile(id,username) VALUES('other-owner','other-synthetic');");
    const insert = raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,estimated_cost_usd,metadata_json,created_at) VALUES(?,?,'text','workers-ai','openai/gpt-5.5',0,?,?)");
    insert.run("legacy", "owner", JSON.stringify({ costKnown: false }), new Date().toISOString());
    insert.run("other", "other-owner", JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false }), new Date().toISOString());
    insert.run("old", "owner", JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false }), "2020-01-01T00:00:00Z");
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(models).toEqual(["openai/gpt-5.5"]);
  });
  it("does not bill or block transferred self-hosted known and unknown new-agent receipts", async () => {
    const { env, raw, models, events } = fixture(settings(), (model, index) => { const response = completion(model); if (index !== 1) return response; const { usage: _usage, ...withoutUsage } = response; return withoutUsage; });
    env.ME3_DEPLOYMENT_MODE = "self_hosted";
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(await executeNewAgentTurn(env, { ...input, turnId: "uncosted-self-hosted", requestId: "uncosted-self-hosted" }, new AbortController().signal)).toMatchObject({ status: "complete" });
    env.ME3_DEPLOYMENT_MODE = "managed";
    expect(await executeNewAgentTurn(env, { ...input, turnId: "managed-turn", requestId: "managed-request" }, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(models).toHaveLength(3); expect(events).toEqual([]);
    const imported = raw.prepare("SELECT metadata_json FROM ai_usage_events WHERE id NOT LIKE 'managed-turn:%'").all();
    expect(imported).toHaveLength(2);
    for (const row of imported) expect(JSON.parse(String(row.metadata_json))).toMatchObject({ billingManaged: false });
  });
});

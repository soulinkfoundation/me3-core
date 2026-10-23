import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1TurnStore } from "../../../packages/agent/src/store";
import type { AgentCheckpoint, AgentDb, AgentTool } from "../../../packages/agent/src/types";
import { executeNewAgentTurn, type NewAgentDispatchInput } from "./agent-runtime";
import { syncManagedAiUsage, type ManagedAiBillingSettings } from "./managed-ai-billing";
import { applyManagedAiSettlement } from "./managed-ai-reconciliation";
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
const fallback = "anthropic/claude-haiku-5.5";
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
function fixture(policy = settings(), response?: (model: string, index: number) => unknown, reconcile?: (events: Array<Record<string, unknown>>) => unknown) {
  const { raw, db } = database(); const models: string[] = []; const events: Array<Record<string, unknown>> = []; const gatewayMetadata: Array<Record<string, unknown>> = []; const reconcileRequests: Array<Array<Record<string, unknown>>> = [];
  const accepted = new Set<string>();
  const bridge = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/usage")) {
      const incoming = JSON.parse(String(init?.body)).events as Array<Record<string, unknown>>;
      for (const event of incoming) if (!accepted.has(String(event.id))) { accepted.add(String(event.id)); events.push(event); policy.currentMonthUsageMicrousd += Number(event.costMicrousd); }
      return Response.json({ acceptedEventIds: incoming.map(event => event.id), settings: policy });
    }
    if (url.endsWith("/reconcile")) {
      const incoming = JSON.parse(String(init?.body)).events as Array<Record<string, unknown>>;
      reconcileRequests.push(incoming);
      return Response.json(reconcile?.(incoming) ?? { settlements: [] });
    }
    return Response.json(policy);
  });
  vi.stubGlobal("fetch", bridge);
  // Suggested replies make their own model call; these tests count planner calls only.
  const env = { DB: db, ME3_AGENT_SUGGESTED_REPLIES: "off",ME3_AGENT_MEMORY:"off", ME3_DEPLOYMENT_MODE: "managed", ME3_COMMERCE_BRIDGE_ORIGIN: "https://billing.example.invalid", ME3_COMMERCE_BRIDGE_TOKEN: "synthetic-fixture", AI: { async run(model: string, _input: unknown, options?: { gateway?: { metadata?: Record<string, unknown> } }) { models.push(model); gatewayMetadata.push(options?.gateway?.metadata ?? {}); return response?.(model, models.length - 1) ?? completion(model); } } } as unknown as Env;
  return { raw, db, env, models, events, bridge, gatewayMetadata, reconcileRequests };
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
  it.each([
    ["stripe", true, false, { kind: "enable_overages", label: "Turn on extra usage" }],
    ["trial", false, false, { kind: "subscribe", label: "Subscribe" }],
    ["complimentary", false, false, { kind: "subscribe", label: "Subscribe" }],
    ["storekit", false, false, null],
    ["internal", false, false, null],
    ["stripe", true, true, null],
  ] as const)("tells a %s owner the allowance is used (eligible=%s, overages=%s)", async (billingSource, eligible, overagesEnabled, action) => {
    const { env } = fixture(settings({ fallbackActive: true, billingSource, eligible, overagesEnabled } as never));
    const payload = await executeNewAgentTurn(env, input, new AbortController().signal) as { allowanceNotice?: unknown };
    expect(payload.allowanceNotice).toMatchObject({ kind: "allowance_used", title: "This month's AI allowance is used", message: expect.stringMatching(/^Replies now use a lighter model until \d{1,2} \w+\.$/), resetsOn: expect.stringMatching(/^\d{4}-\d{2}-01$/), action });
  });
  it("adds no allowance notice while the owner is within the allowance", async () => {
    const { env } = fixture(settings());
    const payload = await executeNewAgentTurn(env, input, new AbortController().signal) as { allowanceNotice?: unknown };
    expect(payload).not.toHaveProperty("allowanceNotice");
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
  it("lets trial and App Store owners without Stripe overages use the included allowance", async () => {
    const policy = { ...settings(), eligible: false, ineligibleReason: "An active Stripe-managed subscription is required for AI overages", billingSource: null };
    const { env, models } = fixture(policy);
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(models).toEqual(["openai/gpt-5.5"]);
  });
  it("fails closed before a later model call if hosted availability is revoked", async () => {
    fixtureTools.value = [{ name: "fixture_read", description: "Read synthetic", parameters: { type: "object" }, effect: "read", approval: "none", async execute() { return { status: "ok" }; } }];
    const policy = settings(); const { env, models } = fixture(policy, (model, index) => { if (index === 0) { policy.available = false; policy.ineligibleReason = "Synthetic policy revoked"; } return completion(model, true); });
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
  it("keeps the turn going while an unpriced call holds its worst-case price", async () => {
    fixtureTools.value = [{ name: "fixture_read", description: "Read synthetic", parameters: { type: "object" }, effect: "read", approval: "none", async execute() { return { status: "ok" }; } }];
    const { env, models, raw, events } = fixture(settings(), (model, index) => { if (index > 0) return completion(model); const { usage: _usage, ...response } = completion(model, true); return response; });
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(models).toEqual(["openai/gpt-5.5", "openai/gpt-5.5"]);
    const rows = raw.prepare("SELECT id,metadata_json FROM ai_usage_events ORDER BY created_at,rowid").all().map(row => ({ id: row.id, ...JSON.parse(String(row.metadata_json)) }));
    expect(rows.map(row => row.costKnown)).toEqual([false, true]);
    // The hold is not a charge: only the priced receipt is reported.
    await syncManagedAiUsage(env);
    expect(events.map(event => event.id)).toEqual([rows[1].id]);
  });
  it("stops admitting paid calls while three unpriced calls are held", async () => {
    const { env, raw, models } = fixture();
    const insert = raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,estimated_cost_usd,metadata_json) VALUES(?,'owner','text','workers-ai','openai/gpt-5.5',0,?)");
    for (const id of ["held-1", "held-2"]) insert.run(id, JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false }));
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    insert.run("held-3", JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false }));
    await expect(executeNewAgentTurn(env, { ...input, turnId: "next-turn", requestId: "next-request" }, new AbortController().signal)).rejects.toThrow("cost is awaiting reconciliation");
    expect(models).toEqual(["openai/gpt-5.5"]);
  });
  it("counts holds against the monthly maximum, so a hold near the limit switches to the fallback model", async () => {
    const { env, raw, models } = fixture(settings({ currentMonthUsageMicrousd: 4_600_000 }));
    raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,estimated_cost_usd,metadata_json) VALUES('held','owner','text','workers-ai','openai/gpt-5.5',0,?)").run(JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false, billingFeeRate: 0.05 }));
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "complete", model: fallback });
    expect(models).toEqual([fallback]);
  });
  it("closes a call the provider rejects before generating at zero cost, so it never blocks the next turn", async () => {
    let rejectNext = true;
    const { env, models, raw } = fixture(settings(), model => {
      if (rejectNext) { rejectNext = false; throw new Error("403: Insufficient balance; add money to your gateway or use BYOK"); }
      return completion(model);
    });
    expect(await executeNewAgentTurn(env, input, new AbortController().signal)).toMatchObject({ status: "failed", replyText: expect.stringContaining("Insufficient balance") });
    const rejected = raw.prepare("SELECT estimated_cost_usd,metadata_json FROM ai_usage_events").get()!;
    expect(Number(rejected.estimated_cost_usd)).toBe(0);
    expect(JSON.parse(String(rejected.metadata_json))).toMatchObject({ costKnown: true, usageReported: true, rejectedBeforeGeneration: true });
    expect(await executeNewAgentTurn(env, { ...input, turnId: "next-turn", requestId: "next-request" }, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(models).toEqual(["openai/gpt-5.5", "openai/gpt-5.5"]);
  });
  it("gives the backup a clean attempt after a rejected call and reports the provider's error when both are rejected", async () => {
    const backup = "anthropic/claude-opus-5.5";
    const { env, models } = fixture(settings(), () => { throw new Error("403: Insufficient balance; add money to your gateway or use BYOK"); });
    (env as unknown as Record<string, string>).ME3_AI_CHAT_BACKUP_MODEL = backup;
    const result = await executeNewAgentTurn(env, input, new AbortController().signal);
    expect(result).toMatchObject({ status: "failed", replyText: expect.stringContaining("Insufficient balance") });
    expect(result.replyText).not.toContain("awaiting reconciliation");
    expect(models).toEqual(["openai/gpt-5.5", backup]);
  });
  it("blocks resumed inference while an unknown cost has no price ceiling", async () => {
    const { env, raw, models } = fixture();
    raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,estimated_cost_usd,metadata_json) VALUES('uncertain','owner','text','workers-ai','synthetic/unpriced-model',0,?)").run(JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false }));
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
  it("atomically admits only the last free hold to concurrent same-owner requests and allows another after reconciliation", async () => {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const { env, raw, models } = fixture(settings(), async model => { entered(); await gate; return completion(model); });
    const insert = raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,estimated_cost_usd,metadata_json) VALUES(?,'owner','text','workers-ai','openai/gpt-5.5',0,?)");
    for (const id of ["held-1", "held-2"]) insert.run(id, JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false }));
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

describe("unknown managed cost reconciliation", () => {
  const hash = (char: string) => char.repeat(64);
  const unpriced = (model: string) => { const { usage: _usage, ...response } = completion(model); return response; };
  const age = (raw: DatabaseSync, minutes = 20) => raw.exec(`UPDATE ai_usage_events SET created_at=datetime('now','-${minutes} minutes')`);
  const receipt = (raw: DatabaseSync) => raw.prepare("SELECT * FROM ai_usage_events").get()!;
  const meta = (row: Record<string, unknown>) => JSON.parse(String(row.metadata_json));
  const charged = (id: unknown, overrides: Record<string, unknown> = {}) => ({ settlements: [{ id, resolution: "charged", evidenceId: "log-1", evidenceHash: hash("a"), inputTokens: 100, outputTokens: 10, baseCostUsd: 0.0004, ...overrides }] });

  it("tags each gateway call with its usage id within the five-entry metadata limit", async () => {
    const { env, raw, gatewayMetadata } = fixture();
    await executeNewAgentTurn(env, input, new AbortController().signal);
    const row = receipt(raw);
    expect(gatewayMetadata[0]).toMatchObject({ me3_runtime: "agent", me3_turn_id: "turn", me3_request_id: "request", me3_usage_id: row.id });
    expect(Object.keys(gatewayMetadata[0]).length).toBeLessThanOrEqual(5);
    expect(meta(row)).toMatchObject({ gatewayCorrelation: "me3_usage_id", gatewayId: "fixture", me3_thread_id: "thread" });
  });

  it("holds an interrupted call until gateway evidence settles the original receipt, then resumes without rerunning it", async () => {
    let settle = false;
    const { env, raw, models, events, reconcileRequests } = fixture(settings(), (model, index) => index === 0 ? unpriced(model) : completion(model), incoming => settle ? charged(incoming[0].id) : { settlements: [] });
    await executeNewAgentTurn(env, input, new AbortController().signal);
    const original = receipt(raw);
    const next = { ...input, turnId: "next-turn", requestId: "next-request" };
    // Too recent to settle: the call could still be finishing. The owner keeps going meanwhile.
    expect(await executeNewAgentTurn(env, next, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(reconcileRequests).toHaveLength(0);
    age(raw);
    const occurredAt = receipt(raw).created_at;
    // No evidence yet: the hold stays and the receipt is not priced.
    await syncManagedAiUsage(env);
    expect(reconcileRequests[0]).toEqual([expect.objectContaining({ id: original.id, kind: "text", gatewayId: "fixture", correlation: { key: "me3_usage_id", value: original.id } })]);
    expect(meta(receipt(raw))).toMatchObject({ costKnown: false });
    // Held receipts wait before asking ME3 Cloud again.
    await syncManagedAiUsage(env);
    expect(reconcileRequests).toHaveLength(1);
    raw.exec("UPDATE ai_usage_events SET metadata_json=json_remove(metadata_json,'$.reconcileAttemptedAt')");
    settle = true;
    await syncManagedAiUsage(env);
    expect(models).toEqual(["openai/gpt-5.5", "openai/gpt-5.5"]);
    const settled = raw.prepare("SELECT * FROM ai_usage_events WHERE id=?").get(original.id)!;
    expect(settled.created_at).toBe(occurredAt);
    expect(Number(settled.estimated_cost_usd)).toBeCloseTo(0.0004 * 1.05, 10);
    expect(meta(settled)).toMatchObject({ costKnown: true, baseCostUsd: 0.0004, pricingBasis: "ai-gateway-log-cost", settlementId: "ai-gateway-log:log-1" });
    expect(events.filter(event => event.id === original.id)).toEqual([expect.objectContaining({ costMicrousd: 420, inputTokens: 100, outputTokens: 10 })]);
    expect(raw.prepare("SELECT resolution,evidence_hash,actor FROM ai_usage_settlements").all()).toEqual([{ resolution: "charged", evidence_hash: hash("a"), actor: "me3-cloud:ai-gateway-evidence" }]);
  });

  it("charges a hold at its worst-case price once a day passes without gateway evidence", async () => {
    const { env, raw, events } = fixture(settings(), unpriced);
    await executeNewAgentTurn(env, input, new AbortController().signal);
    const id = String(receipt(raw).id);
    age(raw, 60 * 23);
    await syncManagedAiUsage(env);
    expect(meta(receipt(raw))).toMatchObject({ costKnown: false });
    age(raw, 60 * 25);
    raw.exec("UPDATE ai_usage_events SET metadata_json=json_remove(metadata_json,'$.reconcileAttemptedAt')");
    await syncManagedAiUsage(env);
    const hold = (64_000 * 5 + 4_096 * 30) / 1_000_000;
    expect(meta(receipt(raw))).toMatchObject({ costKnown: true, baseCostUsd: hold, pricingBasis: "provisional-hold", settlementId: `provisional-hold:${id}` });
    expect(Number(receipt(raw).estimated_cost_usd)).toBeCloseTo(hold * 1.05, 10);
    expect(events.filter(event => event.id === id)).toEqual([expect.objectContaining({ costMicrousd: Math.round(hold * 1.05 * 1_000_000) })]);
    expect(raw.prepare("SELECT resolution,evidence_source,actor FROM ai_usage_settlements").all()).toEqual([{ resolution: "charged", evidence_source: "provisional-hold", actor: "me3-core:provisional-hold" }]);
  });

  it("settles explicit no-charge evidence at zero and rejects zero claims that carry output", async () => {
    const { env, raw } = fixture(settings(), unpriced);
    await executeNewAgentTurn(env, input, new AbortController().signal);
    const id = String(receipt(raw).id);
    expect(await applyManagedAiSettlement(env, "owner", { id, resolution: "no_charge", evidenceId: "log-2", evidenceHash: hash("b"), inputTokens: 0, outputTokens: 0, baseCostUsd: 0 })).toBe(true);
    expect(Number(receipt(raw).estimated_cost_usd)).toBe(0);
    expect(meta(receipt(raw))).toMatchObject({ costKnown: true, pricingBasis: "ai-gateway-no-charge" });

    const second = fixture(settings(), unpriced, events => ({ settlements: [{ id: events[0].id, resolution: "no_charge", evidenceId: "log-3", evidenceHash: hash("c"), inputTokens: 5, outputTokens: 7, baseCostUsd: 0 }] }));
    await executeNewAgentTurn(second.env, input, new AbortController().signal);
    age(second.raw);
    await syncManagedAiUsage(second.env);
    expect(meta(receipt(second.raw))).toMatchObject({ costKnown: false });
    expect(second.raw.prepare("SELECT COUNT(*) count FROM ai_usage_settlements").get()).toMatchObject({ count: 0 });
  });

  it("keeps the first settlement when evidence is replayed, conflicts, or the original call completes late", async () => {
    const { env, raw } = fixture(settings(), unpriced);
    await executeNewAgentTurn(env, input, new AbortController().signal);
    const id = String(receipt(raw).id);
    const evidence = charged(id).settlements[0] as Parameters<typeof applyManagedAiSettlement>[2];
    expect(await applyManagedAiSettlement(env, "owner", evidence)).toBe(true);
    const settled = receipt(raw);
    expect(await applyManagedAiSettlement(env, "owner", evidence)).toBe(false);
    expect(await applyManagedAiSettlement(env, "owner", { ...evidence, evidenceHash: hash("d"), baseCostUsd: 9 })).toBe(false);
    raw.prepare("UPDATE ai_usage_events SET estimated_cost_usd=99 WHERE id=? AND json_extract(metadata_json,'$.settlementId') IS NULL").run(id);
    expect(receipt(raw)).toEqual(settled);
    expect(() => raw.exec("UPDATE ai_usage_settlements SET base_cost_usd=0")).toThrow(/append-only/);
    expect(raw.prepare("SELECT COUNT(*) count FROM ai_usage_settlements").get()).toMatchObject({ count: 1 });
  });

  it("never settles another owner's receipt or one that is already priced", async () => {
    const { env, raw } = fixture(settings(), unpriced);
    await executeNewAgentTurn(env, input, new AbortController().signal);
    const id = String(receipt(raw).id);
    const evidence = charged(id).settlements[0] as Parameters<typeof applyManagedAiSettlement>[2];
    expect(await applyManagedAiSettlement(env, "someone-else", evidence)).toBe(false);
    expect(raw.prepare("SELECT COUNT(*) count FROM ai_usage_settlements").get()).toMatchObject({ count: 0 });
    const known = fixture();
    await executeNewAgentTurn(known.env, input, new AbortController().signal);
    const before = receipt(known.raw);
    expect(await applyManagedAiSettlement(known.env, "owner", { ...evidence, id: String(before.id) })).toBe(false);
    expect(receipt(known.raw)).toEqual(before);
  });

  it("rolls back the audit row when the receipt write fails", async () => {
    const { env, raw } = fixture(settings(), unpriced);
    await executeNewAgentTurn(env, input, new AbortController().signal);
    const id = String(receipt(raw).id);
    raw.exec("CREATE TRIGGER fail_receipt BEFORE UPDATE ON ai_usage_events BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
    await expect(applyManagedAiSettlement(env, "owner", charged(id).settlements[0] as Parameters<typeof applyManagedAiSettlement>[2])).rejects.toThrow(/synthetic write failure/);
    expect(raw.prepare("SELECT COUNT(*) count FROM ai_usage_settlements").get()).toMatchObject({ count: 0 });
  });

  it("ignores settlements for receipts it did not ask about and never sends self-hosted receipts", async () => {
    const { env, raw, reconcileRequests } = fixture(settings(), unpriced, () => charged("not-requested"));
    await executeNewAgentTurn(env, input, new AbortController().signal);
    raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,metadata_json) VALUES('self-hosted','owner','text','workers-ai','openai/gpt-5.5',?)").run(JSON.stringify({ me3_runtime: "agent", billingManaged: false, costKnown: false }));
    age(raw);
    await syncManagedAiUsage(env);
    expect(reconcileRequests[0].map(event => event.id)).not.toContain("self-hosted");
    expect(raw.prepare("SELECT COUNT(*) count FROM ai_usage_settlements").get()).toMatchObject({ count: 0 });
  });

  it("matches legacy receipts by request only when that request made one call to the model", async () => {
    const { env, raw, reconcileRequests } = fixture();
    const insert = raw.prepare("INSERT INTO ai_usage_events(id,user_id,kind,provider,model,metadata_json,created_at) VALUES(?,'owner',?,'workers-ai',?,?,datetime('now','-1 hour'))");
    const legacy = (request: string) => JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false, me3_request_id: request });
    insert.run("single", "text", "anthropic/claude-haiku-5.5", legacy("request-a"));
    insert.run("double-1", "text", "anthropic/claude-haiku-5.5", legacy("request-b"));
    insert.run("double-2", "text", "anthropic/claude-haiku-5.5", legacy("request-b"));
    insert.run("image", "image", "openai/gpt-image-2", JSON.stringify({ me3_runtime: "agent", billingManaged: true, costKnown: false, operationId: "agent-image:op" }));
    await syncManagedAiUsage(env);
    expect(reconcileRequests[0].map(event => [event.id, event.correlation])).toEqual([
      ["single", { key: "me3_request_id", value: "request-a" }],
      ["image", { key: "operationId", value: "agent-image:op" }],
    ]);
  });
});

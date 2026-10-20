import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { runAgentTurn } from "../../../packages/agent/src/loop";
import { withOneStepConfirmation } from "../../../packages/agent/src/confirmations";
import type { AgentCheckpoint, AgentEvent, AgentModel, AgentTool, AgentToolResult, AgentTurnStore } from "../../../packages/agent/src/types";

function fixture() {
  let checkpoint: AgentCheckpoint | null = null;
  const receipts = new Map<string, AgentToolResult | null>();
  let decision: "pending" | "approved" | "declined" = "pending";
  const store: AgentTurnStore = {
    load: async () => checkpoint && structuredClone(checkpoint),
    save: async (value) => { checkpoint = structuredClone(value); },
    getReceipt: async (key) => receipts.get(key) ?? null,
    claimReceipt: async (key) => { if (receipts.has(key) && receipts.get(key)?.status !== "needs_approval") return false; receipts.set(key, null); return true; },
    finishReceipt: async (key, value) => { receipts.set(key, value); },
    requestApproval: async () => "approval-1",
    approvalDecision: async () => decision,
  };
  const context = { db: {} as never, ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "req", ownerTimezone: "Europe/Dublin", messageText: "do it", enabledPluginIds: new Set(["enabled"]) };
  const call = (id = "one", args = { value: "hello" }) => ({ id, name: "save", arguments: args });
  const tool: AgentTool = { name: "save", description: "Save", parameters: { type: "object", required: ["value"], properties: { value: { type: "string" } }, additionalProperties: false }, effect: "write", approval: "none", execute: async () => ({ status: "ok" }) };
  const model = (steps: Array<{ text: string; toolCalls: ReturnType<typeof call>[] }>): AgentModel => ({ id: "test", step: async ({onDelta}) => { const step = steps.shift()!; if (step.text) await onDelta(step.text); return step; } });
  return { store, context, call, tool, model, approve: () => { decision = "approved"; }, decline: () => { decision = "declined"; } };
}

describe("from scratch agent loop", () => {
  it.each(["queued", "approved", "approval-preparation", "unavailable-status", "unreadable-state"])("rechecks persisted plugin authority for %s without executing or approving", async (kind) => {
    const f = fixture(), raw = new DatabaseSync(":memory:");
    let effects = 0, approvals = 0;
    try {
      if (kind !== "unreadable-state") raw.exec("CREATE TABLE plugin_installations(plugin_id TEXT PRIMARY KEY, enabled INTEGER, status TEXT); INSERT INTO plugin_installations VALUES('enabled',1,'installed')");
      f.context.db = { prepare: (sql: string) => ({ bind: (...args: never[]) => ({ first: async () => raw.prepare(sql).get(...args) ?? null }) }) } as never;
      f.tool.pluginId = "enabled";
      f.tool.execute = async () => { effects++; return { status: "ok" }; };
      const input = { ...f, tools: [f.tool], messages: [], model: f.model([{ text: "", toolCalls: [f.call()] }, { text: "Unavailable", toolCalls: [] }]) };
      if (kind === "approved") {
        f.tool.approval = "required";
        expect((await runAgentTurn(input)).status).toBe("needs_approval");
        f.approve();
      }
      if (kind === "approval-preparation") {
        f.tool.approval = "required";
        f.tool.prepareApproval = async () => {
          raw.exec("UPDATE plugin_installations SET enabled=0,status='disabled'");
          return { status: "needs_approval", approval: { title: "Save", summary: "Review" } };
        };
        f.store.requestApproval = async () => { approvals++; return "approval"; };
      } else if (kind !== "unreadable-state") {
        raw.exec(kind === "unavailable-status" ? "UPDATE plugin_installations SET status='setup_required'" : "UPDATE plugin_installations SET enabled=0,status='disabled'");
      }
      const result = await runAgentTurn(input);
      expect(effects).toBe(0);
      expect(approvals).toBe(0);
      expect(result.toolCalls.at(-1)?.status).toBe("error");
    } finally { raw.close(); }
  });
  it.each(["selection", "step-limit", "cancelled", "approval"])("streams the actual %s reply without fabricating a provider token", async (kind) => {
    const f = fixture(), events: AgentEvent[] = [];
    f.tool.effect = kind === "approval" ? "external" : "read";
    f.tool.endsTurn = kind === "selection";
    f.tool.execute = async () => kind === "selection" ? { status: "needs_selection", data: { targetPresentation: { id: "presentation", status: "pending" } } } : { status: "ok" };
    const input = { ...f, tools: [f.tool], messages: [], model: f.model([{ text: "", toolCalls: [f.call()] }]),
      ...(kind === "step-limit" ? { maxSteps: 1 } : {}), ...(kind === "cancelled" ? { signal: AbortSignal.abort() } : {}), onEvent: (event: AgentEvent) => { events.push(event); } };
    const completed = await runAgentTurn(input);
    expect(events.filter(event => event.event === "delta")).toEqual([{ event: "delta", data: { text: completed.replyText, source: "runtime" } }]);
    expect(completed.trace.timeToFirstTokenMs).toBeNull();
    if (kind !== "approval") {
      const replay: AgentEvent[] = [];
      expect((await runAgentTurn({ ...input, model: f.model([]), onEvent: event => { replay.push(event); } })).replyText).toBe(completed.replyText);
      expect(replay).toEqual([]);
    }
  });
  it("offers deferred tool groups only after the model loads them", async () => {
    const f = fixture(), seen: string[][] = [];
    let effects = 0;
    const deferred: AgentTool = { ...f.tool, name: "core_sites_landing_page_list", group: "sites", effect: "read", parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async () => { effects++; return { status: "ok" }; } };
    const steps = [
      { text: "", toolCalls: [{ id: "load", name: "core_tools_load", arguments: { groups: ["sites"] } }] },
      { text: "", toolCalls: [{ id: "list", name: "core_sites_landing_page_list", arguments: {} }] },
      { text: "Done", toolCalls: [] },
    ];
    const model: AgentModel = { id: "test", step: async ({ tools }) => { seen.push(tools.map(tool => tool.name)); return steps.shift()!; } };
    const result = await runAgentTurn({ ...f, tools: [f.tool, deferred], messages: [], model });
    expect(result.status).toBe("complete");
    expect(seen[0]).toEqual(["save", "core_tools_load"]);
    expect(seen[1]).toEqual(["save", "core_sites_landing_page_list", "core_tools_load"]);
    expect(effects).toBe(1);
  });
  it("omits the tool loader when no deferred group is available", async () => {
    const f = fixture(), seen: string[][] = [];
    const model: AgentModel = { id: "test", step: async ({ tools }) => { seen.push(tools.map(tool => tool.name)); return { text: "Hi", toolCalls: [] }; } };
    await runAgentTurn({ ...f, tools: [f.tool], messages: [], model });
    expect(seen).toEqual([["save"]]);
  });
  it("tags provider text and does not duplicate it at completion", async () => {
    const f = fixture(), events: AgentEvent[] = [];
    const result = await runAgentTurn({ ...f, tools: [], messages: [], model: f.model([{ text: "Hello", toolCalls: [] }]), onEvent: event => { events.push(event); } });
    expect(events.filter(event => event.event === "delta")).toEqual([{ event: "delta", data: { text: "Hello", source: "model" } }]);
    expect(result.trace.timeToFirstTokenMs).toEqual(expect.any(Number));
  });
  it("does not admit an effect after cancellation during the running event", async () => {
    const f = fixture(), controller = new AbortController(); let effects = 0;
    f.tool.execute = async () => { effects++; return { status: "ok" }; };
    const result = await runAgentTurn({ ...f, tools: [f.tool], messages: [], signal: controller.signal, model: f.model([{ text: "", toolCalls: [f.call()] }]), onEvent(event) { if (event.event === "tool" && event.data.state === "running") controller.abort(); } });
    expect(result.status).toBe("cancelled"); expect(effects).toBe(0);
    expect([...((await f.store.load())?.trace.toolCalls ?? [])]).toMatchObject([{ status: "error" }]);
  });
  it("does not create an approval after cancellation during snapshot preparation", async () => {
    const f = fixture(), controller = new AbortController(); let approvals = 0;
    f.tool.approval = "required"; f.tool.prepareApproval = async () => { controller.abort(); return { status: "needs_approval", approval: { title: "Save", summary: "Review" } }; };
    f.store.requestApproval = async () => { approvals++; return "approval"; };
    const result = await runAgentTurn({ ...f, tools: [f.tool], messages: [], signal: controller.signal, model: f.model([{ text: "", toolCalls: [f.call()] }]) });
    expect(result.status).toBe("cancelled"); expect(approvals).toBe(0);
  });
  it("checks durable cancellation immediately before an effect even without a local signal", async () => {
    const f = fixture(); let cancelled = false, effects = 0;
    Object.assign(f.store, { cancellationRequested: async () => cancelled });
    f.tool.execute = async () => { effects++; return { status: "ok" }; };
    const result = await runAgentTurn({ ...f, tools: [f.tool], messages: [], model: f.model([{ text: "", toolCalls: [f.call()] }]), onEvent(event) { if (event.event === "tool") cancelled = true; } });
    expect(result.status).toBe("cancelled"); expect(effects).toBe(0);
  });
  it("marks cost unknown when any model response omits usage, while retaining known zero cost", async () => {
    const f = fixture(); let step = 0;
    const result = await runAgentTurn({ ...f, tools: [f.tool], messages: [], model: { id: "test", async step() { return step++ === 0 ? { text: "", toolCalls: [f.call()], usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, estimatedCostUsd: 0.03 } } : { text: "Saved", toolCalls: [] }; } } });
    expect(result.status).toBe("complete"); expect(result.usage.estimatedCostUsd).toBeNull();
    const g = fixture(), zero = await runAgentTurn({ ...g, tools: [], messages: [], model: { id: "test", async step() { return { text: "Hi", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 } }; } } });
    expect(zero.usage.estimatedCostUsd).toBe(0);
  });
  it("keeps cost unknown when a failed provider request falls back to a priced model", async () => {
    const f = fixture();
    const result = await runAgentTurn({ ...f, tools: [], messages: [], model: { id: "primary", async step({ onDelta }) { await onDelta("Partial"); throw new Error("Provider stream truncated"); } }, backupModel: { id: "backup", async step() { return { text: "Completed", toolCalls: [], usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, estimatedCostUsd: 0.01 } }; } } });
    expect(result.status).toBe("complete"); expect(result.trace.model).toBe("backup"); expect(result.usage.estimatedCostUsd).toBeNull();
  });
  it("deduplicates semantic writes when the provider changes call IDs", async () => {
    const f = fixture(); let writes = 0;
    f.tool.execute = async () => { writes++; return { status: "ok", data: { id: "saved" } }; };
    const result = await runAgentTurn({ ...f, tools: [f.tool], messages: [{role:"user",content:"save"}], model: f.model([{text:"",toolCalls:[f.call()]},{text:"",toolCalls:[f.call("different")]},{text:"Saved",toolCalls:[]}]) });
    expect(writes).toBe(1); expect(result.replyText).toBe("Saved");
    await runAgentTurn({ ...f, tools: [f.tool], messages: [], model: f.model([]) });
    expect(writes).toBe(1);
  });
  it("pauses before external effects and resumes the persisted call after approval", async () => {
    const f = fixture(); let effects = 0;
    f.tool.effect = "external"; f.tool.approval = "required";
    f.tool.execute = async (_,ctx) => { expect(ctx.approved).toBe(true); effects++; return {status:"ok"}; };
    const first = await runAgentTurn({...f,tools:[f.tool],messages:[{role:"user",content:"send"}],model:f.model([{text:"",toolCalls:[f.call()]}])});
    expect(first.status).toBe("needs_approval"); expect(effects).toBe(0);
    f.approve();
    const second = await runAgentTurn({...f,tools:[f.tool],messages:[],model:f.model([{text:"Sent",toolCalls:[]}])});
    expect(second.status).toBe("complete"); expect(effects).toBe(1);
  });
  it("declining an approval cannot execute its effect", async () => {
    const f = fixture(); let effects = 0; f.tool.approval = "required"; f.tool.effect = "destructive";
    f.tool.execute = async () => {effects++;return {status:"ok"};};
    await runAgentTurn({...f,tools:[f.tool],messages:[],model:f.model([{text:"",toolCalls:[f.call()]}])});
    f.decline();
    await runAgentTurn({...f,tools:[f.tool],messages:[],model:f.model([{text:"Declined",toolCalls:[]}])});
    expect(effects).toBe(0);
  });
  it("returns schema/unknown/disabled errors to the model without writes", async () => {
    const f = fixture(); let writes = 0; f.tool.pluginId = "disabled";
    f.tool.execute = async () => {writes++;return {status:"ok"};};
    const model: AgentModel = {id:"test",step:async ({messages,tools}) => {
      expect(tools).toHaveLength(0);
      if (messages.some(m=>m.role==="tool")) { expect(messages.at(-1)?.content).toContain("error"); return {text:"Unavailable",toolCalls:[]}; }
      return {text:"",toolCalls:[f.call()]};
    }};
    await runAgentTurn({...f,tools:[f.tool],messages:[],model}); expect(writes).toBe(0);
    const g = fixture(); g.tool.execute = f.tool.execute;
    await runAgentTurn({...g,tools:[g.tool],messages:[],model:g.model([{text:"",toolCalls:[g.call("one",{value:3} as never)]},{text:"Corrected",toolCalls:[]}])});
    expect(writes).toBe(0);
  });
  it("runs independent reads together while preserving serial effect order", async () => {
    const f = fixture(); let active = 0; let max = 0; const order: string[] = [];
    const read: AgentTool = {...f.tool,name:"read",effect:"read",execute:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return {status:"ok"};}};
    const write: AgentTool = {...f.tool,execute:async(args)=>{expect(active).toBe(0);order.push(String(args.value));return {status:"ok"};}};
    await runAgentTurn({...f,tools:[read,write],messages:[],model:f.model([{text:"",toolCalls:[{...f.call("r1"),name:"read"},{...f.call("r2"),name:"read"},f.call("w1"),f.call("w2",{value:"second"})]},{text:"Done",toolCalls:[]}])});
    expect(max).toBe(2);expect(order).toEqual(["hello","second"]);
  });
  it("does not replay an effect with an uncertain crash outcome", async () => {
    const f = fixture(); let writes = 0;
    f.store.claimReceipt = async () => false;
    f.tool.execute = async()=>{writes++;return {status:"ok"};};
    const result = await runAgentTurn({...f,tools:[f.tool],messages:[],model:f.model([{text:"",toolCalls:[f.call()]},{text:"Please check",toolCalls:[]}])});
    expect(writes).toBe(0);expect(result.toolCalls[0].status).toBe("error");
  });
  it("bounds steps and respects explicit cancellation", async () => {
    const f = fixture(); const controller = new AbortController();controller.abort();
    const result = await runAgentTurn({...f,tools:[],messages:[],signal:controller.signal,model:f.model([])});
    expect(result.status).toBe("cancelled");
    const g = fixture();
    const bounded = await runAgentTurn({...g,tools:[g.tool],messages:[],maxSteps:1,model:g.model([{text:"",toolCalls:[g.call()]}])});
    expect(bounded.status).toBe("failed"); expect(bounded.replyText).not.toContain("done");
  });
});

describe("independent check of new records", () => {
  it.each(["deny", "clarify"] as const)("does not create a record the check answers %s, and leaves it retryable", async (decision) => {
    const f = fixture(); let effects = 0; let evidence: unknown;
    const receipts: string[] = [];
    f.store.finishReceipt = async (_key, _value, options) => { receipts.push(options?.notAdmitted ? "not_admitted" : "finished"); };
    f.tool.createCheck = true;
    f.tool.execute = async () => { effects++; return { status: "ok" }; };
    const context = { ...f.context, verifyCreateIntent: async (value: unknown) => { evidence = value; return { decision, reason: "Only asked to look it up.", inference: { modelId: "verifier", usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, estimatedCostUsd: 0.0001 } } }; } };
    const messages = [{ role: "user" as const, content: "Is Call Alex on my calendar?" }, { role: "assistant" as const, content: "I couldn't find it." }, { role: "user" as const, content: "The second one." }];
    const result = await runAgentTurn({ ...f, context, tools: [f.tool], messages, model: f.model([{ text: "", toolCalls: [f.call()] }, { text: "I didn't create anything.", toolCalls: [] }]) });
    expect(effects).toBe(0);
    expect(receipts).toEqual(["not_admitted"]);
    expect(result.toolCalls[0].status).toBe("error");
    expect(evidence).toMatchObject({ ownerRequest: "The second one.", recentConversation: [{ role: "owner", text: "Is Call Alex on my calendar?" }, { role: "assistant", text: "I couldn't find it." }], proposedAction: { name: "save", arguments: { value: "hello" } } });
    expect(result.trace?.targetIntentRequests).toEqual([expect.objectContaining({ modelId: "verifier", uncertain: false })]);
  });

  it.each([["openai/gpt-6.1-sol", 0], ["anthropic/claude-sonnet-5.5", 0], ["anthropic/claude-opus-5.5", 0], ["anthropic/claude-haiku-5.5", 1], ["@cf/deepseek-ai/deepseek-v4.1-flash-1017", 1]] as const)("checks creates proposed by %s only when it is not a trusted planner", async (modelId, expected) => {
    const f = fixture(); let checks = 0;
    f.tool.createCheck = true;
    const context = { ...f.context, verifyCreateIntent: async () => { checks++; return { decision: "allow" as const, reason: "Asked." }; } };
    const model = { ...f.model([{ text: "", toolCalls: [f.call()] }, { text: "Done.", toolCalls: [] }]), id: modelId };
    await runAgentTurn({ ...f, context, tools: [f.tool], messages: [{ role: "user", content: "Remind me at 9" }], model });
    expect(checks).toBe(expected);
  });

  it("creates the record once the check allows it, and skips tools without the flag", async () => {
    const f = fixture(); let effects = 0; let checks = 0;
    f.tool.execute = async () => { effects++; return { status: "ok" }; };
    const context = { ...f.context, verifyCreateIntent: async () => { checks++; return { decision: "allow" as const, reason: "Asked for it." }; } };
    const created = { ...f.tool, name: "create", createCheck: true };
    await runAgentTurn({ ...f, context, tools: [f.tool, created], messages: [{ role: "user", content: "Remind me" }],
      model: f.model([{ text: "", toolCalls: [{ id: "a", name: "save", arguments: { value: "x" } }, { id: "b", name: "create", arguments: { value: "y" } }] }, { text: "Done.", toolCalls: [] }]) });
    expect(checks).toBe(1);
    expect(effects).toBe(2);
  });
});

describe("one-step confirmations for everyday creates", () => {
  const setup = (steps: Array<{ text: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>, status: "ok" | "error" = "ok") => {
    const f = fixture(); let modelCalls = 0;
    const create = withOneStepConfirmation({ ...f.tool, name: "create", execute: async () => ({ status, data: { reminder: { title: "Call Alex" } } }) }, () => "Reminder set: Call Alex, Wed 21 Oct, 09:00.");
    const base = f.model(steps as Parameters<typeof f.model>[0]);
    const model = { id: "test", step: async (input: Parameters<typeof base.step>[0]) => { modelCalls++; return base.step(input); } };
    return { run: () => runAgentTurn({ ...f, tools: [f.tool, create], messages: [{ role: "user", content: "Remind me" }], model }), calls: () => modelCalls };
  };
  it("replies from the saved record without a second model call", async () => {
    const t = setup([{ text: "", toolCalls: [{ id: "a", name: "create", arguments: { value: "x", finalStep: true } }] }]);
    const result = await t.run();
    expect(result).toMatchObject({ status: "complete", replyText: "Reminder set: Call Alex, Wed 21 Oct, 09:00." });
    expect(t.calls()).toBe(1);
  });
  it.each([
    ["without the flag", [{ id: "a", name: "create", arguments: { value: "x" } }], "ok"],
    ["beside another call", [{ id: "a", name: "create", arguments: { value: "x", finalStep: true } }, { id: "b", name: "save", arguments: { value: "y" } }], "ok"],
    ["when the create fails", [{ id: "a", name: "create", arguments: { value: "x", finalStep: true } }], "error"],
  ] as const)("keeps the normal reply step %s", async (_label, toolCalls, status) => {
    const t = setup([{ text: "", toolCalls: [...toolCalls] }, { text: "Model reply.", toolCalls: [] }], status);
    const result = await t.run();
    expect(result.replyText).toBe("Model reply.");
    expect(t.calls()).toBe(2);
  });
});

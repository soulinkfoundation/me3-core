import { describe, expect, it } from "vitest";
import { runAgentTurn } from "../../../packages/agent/src/loop";
import type { AgentCheckpoint, AgentModel, AgentTool, AgentToolResult, AgentTurnStore } from "../../../packages/agent/src/types";

function fixture() {
  let checkpoint: AgentCheckpoint | null = null;
  const receipts = new Map<string, AgentToolResult | null>();
  let decision: "pending" | "approved" | "declined" = "pending";
  const store: AgentTurnStore = {
    load: async () => checkpoint && structuredClone(checkpoint),
    save: async (value) => { checkpoint = structuredClone(value); },
    getReceipt: async (key) => receipts.get(key) ?? null,
    claimReceipt: async (key) => { if (receipts.has(key)) return false; receipts.set(key, null); return true; },
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

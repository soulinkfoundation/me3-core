import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgentTurn } from "../src/loop.ts";
import type { AgentCheckpoint, AgentDecider, AgentEvent, AgentTool, AgentTurnInput } from "../src/types.ts";

function fixture(kind = "tool") {
  let state: AgentCheckpoint | null = null, step = 0, effects = 0;
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  const tool: AgentTool = { name: "read", parameters: { type: "object" }, description: "Read", effect: kind === "approval" ? "external" : "read", approval: "none", async execute() { effects++; return { status: "ok" }; } };
  const input: AgentTurnInput = { tools: [tool], messages: [{ role: "user", content: "read" }], signal: controller.signal,
    context: { db: {} as never, ownerId: "synthetic", threadId: "t", turnId: "t", requestId: "r", ownerTimezone: "UTC", messageText: "read", enabledPluginIds: new Set() },
    model: { id: "fake", async step() { await Promise.resolve(); await Promise.resolve(); if (kind === "cancelled") controller.abort(); return { text: kind === "text" || step++ ? "Complete" : "", toolCalls: kind === "text" || step > 1 ? [] : [{ id: "one", name: "read", arguments: { a: 1, b: 2 } }], usage: { inputTokens: 10, outputTokens: 1, cachedInputTokens: 0, estimatedCostUsd: 0 } }; } },
    store: { async load() { return state && structuredClone(state); }, async save(value) { state = structuredClone(value); }, async getReceipt() { return null; }, async claimReceipt() { return true; }, async finishReceipt() {}, async requestApproval() { return "a"; }, async approvalDecision() { return "pending"; } },
    onEvent(event) { events.push(event); } };
  return { input, events, effects: () => effects };
}
const decider: AgentDecider = { id: "fake", async decide() { return { kind: "execute", call: { name: "read", arguments: { b: 2, a: 1 } }, confidence: 1, probabilities: { read: 1 }, gates: {}, durationMs: 1, usage: { inputTokens: 20, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: .01 } }; } };
test("shadow preserves serialized results, events, approvals and effects across all turn kinds", async t => {
  t.mock.method(performance, "now", () => 0); t.mock.timers.enable({ apis: ["Date"], now: 0 });
  for (const kind of ["tool", "text", "approval", "cancelled"]) {
    const off = fixture(kind), shadow = fixture(kind);
    const baseline = await runAgentTurn(off.input);
    const measured = await runAgentTurn({ ...shadow.input, fastPath: { mode: "shadow", decider } });
    assert.ok(measured.trace.fastPath); delete measured.trace.fastPath;
    assert.equal(JSON.stringify(measured), JSON.stringify(baseline)); assert.deepEqual(shadow.events, off.events); assert.equal(shadow.effects(), off.effects());
  }
});
test("failure, malformed output and unfinished decisions never affect a reply", async () => {
  const cyclic: any = {}; cyclic.self = cyclic;
  for (const decide of [() => { throw new Error("private provider error"); }, async () => undefined, async () => ({ kind: "execute", call: { name: "read", arguments: cyclic }, confidence: 1, durationMs: 0 }), () => new Promise<any>(() => {})]) {
    const f = fixture("text"); const result = await runAgentTurn({ ...f.input, fastPath: { mode: "shadow", decider: { id: "failure", decide: decide as never } } });
    assert.equal(result.replyText, "Complete"); assert.equal(result.status, "complete");
    assert.ok(["error", "timeout"].includes(result.trace.fastPath!.status)); assert.equal(JSON.stringify(result.trace.fastPath).includes("private provider error"), false);
  }
});
test("shadow compares canonical arguments, and never adds its usage to the LLM", async () => {
  const f = fixture(); const result = await runAgentTurn({ ...f.input, fastPath: { mode: "shadow", decider } });
  assert.deepEqual(result.trace.fastPath?.comparison, { llmFirstCalls: ["read"], toolMatch: true, argsMatch: true });
  assert.equal(result.usage.inputTokens, 20); assert.equal(result.modelRequestCount, 2);
});
test("resumed, selection, attachment and off turns never call the decider", async () => {
  let calls = 0; const counted = { ...decider, async decide(value: any) { calls++; return decider.decide(value); } };
  const f = fixture("text"); await runAgentTurn(f.input);
  await runAgentTurn({ ...f.input, fastPath: { mode: "shadow", decider: counted } });
  for (const kind of ["selection", "attachments", "off"]) {
    const next = fixture("text");
    if (kind === "selection") next.input.context.targetSelection = { presentationId: "invalid", candidateId: "invalid" };
    if (kind === "attachments") next.input.messages[0].images = [{ url: "private" }];
    await runAgentTurn({ ...next.input, fastPath: { mode: kind === "off" ? "off" : "shadow", decider: counted } });
  }
  assert.equal(calls, 0);
});
test("a two-second shadow timeout aborts independently while the model continues", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let signal: AbortSignal | undefined;
  const f = fixture("text"), original = f.input.model.step;
  f.input.model.step = async value => { await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(2001); assert.equal(signal?.aborted, true); assert.equal(value.signal.aborted, false); return original(value); };
  const result = await runAgentTurn({ ...f.input, fastPath: { mode: "shadow", decider: { id: "slow", decide(value) { signal = value.signal; return new Promise(() => {}); } } } });
  assert.equal(result.replyText, "Complete"); assert.equal(result.trace.fastPath?.status, "timeout");
});

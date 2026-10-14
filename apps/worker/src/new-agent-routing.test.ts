import { describe, expect, it } from "vitest";
import { runAgentTurn } from "../../../packages/agent/src/loop";
import { createClefRouter } from "../../../packages/agent/src/clef";
import { decideRoute, type AgentRouter } from "../../../packages/agent/src/router";
import type { AgentCheckpoint, AgentEvent, AgentModel, AgentModelResponse, AgentTool, AgentTurnStore } from "../../../packages/agent/src/types";

const usage = { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, estimatedCostUsd: .001 };
function fixture() {
  let checkpoint: AgentCheckpoint | null = null;
  const store: AgentTurnStore = {
    load: async () => checkpoint && structuredClone(checkpoint),
    save: async value => { checkpoint = structuredClone(value); },
    getReceipt: async () => null, claimReceipt: async () => true, finishReceipt: async () => {},
    requestApproval: async () => "approval", approvalDecision: async () => "pending",
  };
  const context = { db: {} as never, ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "req", ownerTimezone: "Europe/Dublin", messageText: "Brainstorm names for my workshop", enabledPluginIds: new Set<string>() };
  const tool: AgentTool = { name: "save", description: "Save", parameters: { type: "object", properties: {}, additionalProperties: false }, effect: "write", approval: "none", execute: async () => ({ status: "ok" }) };
  const calls: Array<{ model: string; tools: number; systemTail?: string }> = [];
  const model = (id: string, replies: Array<Partial<AgentModelResponse> | Error>): AgentModel => ({ id, async step({ onDelta, tools, messages }) {
    calls.push({ model: id, tools: tools.length, systemTail: messages.at(-1)?.role === "system" ? messages.at(-1)!.content : undefined });
    const reply = replies.shift() ?? { text: "Main answer." };
    if (reply instanceof Error) throw reply;
    if (reply.text) await onDelta(reply.text);
    return { text: "", toolCalls: [], usage, ...reply };
  } });
  const router = (answer: { needsTools: number; followsRecordWork?: number } | Error | "slow", fast: AgentModel): AgentRouter => ({ id: "test-router", fastModel: fast, timeoutMs: 50,
    ask: async ({ signal }) => {
      if (answer === "slow") await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      if (answer instanceof Error) throw answer;
      return answer as { needsTools: number };
    } });
  const run = async (main: AgentModel, routed?: AgentRouter, messages = [{ role: "user" as const, content: context.messageText }]) => {
    const events: AgentEvent[] = [];
    const result = await runAgentTurn({ store, context, tools: [tool], messages, model: main, router: routed, onEvent: async event => { events.push(event); } });
    const text = events.filter(event => event.event === "delta").map(event => (event.data as { text: string }).text).join("");
    return { result, text, trace: checkpoint!.trace };
  };
  return { model, router, run, calls };
}

describe("agent routing", () => {
  it("answers confident conversation with the fast model and no tools", async () => {
    const f = fixture();
    const fast = f.model("fast", [{ text: "Here are five names." }]);
    const { result, text, trace } = await f.run(f.model("main", []), f.router({ needsTools: .02, followsRecordWork: .01 }, fast));
    expect(result.status).toBe("complete");
    expect(text).toBe("Here are five names.");
    expect(f.calls).toEqual([{ model: "fast", tools: 0, systemTail: expect.stringContaining("NEEDS_TOOLS") }]);
    expect(trace.route).toMatchObject({ route: "fast", reason: "conversation", needsTools: .02 });
    expect(trace.model).toBe("fast");
  });

  it.each([
    ["needs tools", { needsTools: .9, followsRecordWork: 0 }, "needs_tools"],
    ["follows record work", { needsTools: .05, followsRecordWork: .8 }, "follows_record_work"],
    ["router error", new Error("down"), "error"],
    ["malformed router answer", new Error("Malformed router response"), "malformed"],
    ["slow router", "slow", "timeout"],
  ] as const)("keeps the main model when the decision is %s", async (_label, answer, reason) => {
    const f = fixture();
    const { result, trace } = await f.run(f.model("main", [{ text: "Main answer." }]), f.router(answer as never, f.model("fast", [])));
    expect(result.status).toBe("complete");
    expect(f.calls).toEqual([{ model: "main", tools: 1, systemTail: undefined }]);
    expect(trace.route).toMatchObject({ route: "main", reason });
  });

  it("hands back to the main model without streaming the sentinel", async () => {
    const f = fixture();
    const fast = f.model("fast", [{ text: "NEEDS_" }]);
    // Streams arrive in pieces; the second piece completes the sentinel.
    fast.step = async ({ onDelta }) => { f.calls.push({ model: "fast", tools: 0 }); await onDelta("NEEDS_"); await onDelta("TOOLS"); return { text: "NEEDS_TOOLS", toolCalls: [], usage }; };
    const { text, trace } = await f.run(f.model("main", [{ text: "Checked your calendar." }]), f.router({ needsTools: .01, followsRecordWork: 0 }, fast));
    expect(text).toBe("Checked your calendar.");
    expect(f.calls.map(call => call.model)).toEqual(["fast", "main"]);
    expect(trace.route).toMatchObject({ route: "main", reason: "needs_tools" });
    expect(trace.usage.inputTokens).toBe(20);
  });

  it("falls back to the main model when the fast model fails", async () => {
    const f = fixture();
    const { result, trace } = await f.run(f.model("main", [{ text: "Main answer." }]), f.router({ needsTools: .01, followsRecordWork: 0 }, f.model("fast", [new Error("overloaded")])));
    expect(result.status).toBe("complete");
    expect(f.calls.map(call => call.model)).toEqual(["fast", "main"]);
    expect(trace.route).toMatchObject({ route: "main", reason: "error" });
    expect(trace.usage.estimatedCostUsd).toBeNull();
  });

  it("never routes image turns away from the main model", async () => {
    const f = fixture();
    const messages = [{ role: "user" as const, content: "What is this?", images: [{ url: "data:image/png;base64,AQID" }] }];
    const { trace } = await f.run(f.model("main", [{ text: "A chart." }]), f.router({ needsTools: 0, followsRecordWork: 0 }, f.model("fast", [])), messages as never);
    expect(trace.route).toMatchObject({ route: "main", reason: "attachments" });
    expect(f.calls.map(call => call.model)).toEqual(["main"]);
  });

  it("asks Clef both routing questions and parses its noul answers", async () => {
    let request: Record<string, unknown> = {};
    const recorded: unknown[] = [];
    const router = createClefRouter({ model: "clef-flash", gatewayId: "gw", fastModel: { id: "fast", step: async () => ({ text: "", toolCalls: [] }) }, recordUsage: value => { recorded.push(value); },
      ai: { run: async (_model, input) => { request = input; return { model: "clef-flash", answers: { needs_tools: { type: "noul", noul: .03 }, follows_record_work: { type: "noul", noul: .02 } }, usage: { input_tokens: 400, output_tokens: 0 } }; } } });
    const decision = await decideRoute(router, { messageText: "Help me write a toast", recentMessages: [{ role: "user", content: "Help me write a toast" }], signal: new AbortController().signal, hasImages: false });
    expect(decision).toMatchObject({ route: "fast", needsTools: .03, followsRecordWork: .02 });
    expect(Object.keys(request.questions as object)).toEqual(["needs_tools", "follows_record_work"]);
    expect(request.state).toEqual({ latest_request: "Help me write a toast", recent_messages: [] });
    expect(recorded).toHaveLength(1);
  });
});

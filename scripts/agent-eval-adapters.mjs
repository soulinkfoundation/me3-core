export function createRuntimeAdapter(runtime) {
  if (runtime === "sdk") return { runTurn: async (input) => (await import("./agent-eval-adapter-sdk.mjs")).runSdkEvalTurn(input) };
  if (runtime !== "new") throw new Error("Use --runtime=new or --runtime=sdk; the SDK is informational only.");
  return { runTurn: runNewEvalTurn };
}

const paused = new WeakMap();
async function runNewEvalTurn(input) {
  const { runAgentTurn, createCloudflareModel, createD1TurnStore, decideAgentApproval } = await import("../packages/agent/src/index.ts");
  const { createDomainTools } = await import("../packages/agent/src/tools/index.ts");
  let store;
  let contextIds = { threadId: "eval-thread", turnId: input.turnId, requestId: input.requestId };
  const pending = paused.get(input.seed);
  if (input.approve && pending) {
    contextIds = pending.contextIds;
    store = pending.store;
    if (!await decideAgentApproval(input.seed.db, input.ownerId, pending.approvalId, "approved")) throw new Error("Synthetic approval could not be persisted");
  } else store = createD1TurnStore(input.seed.db, { ownerId: input.ownerId, ...contextIds });
  let model;
  if (input.modelRoute.model === "scripted-fixture") {
    const outputs = input.approve && pending ? [] : [...input.fixtureCalls];
    model = { id: "scripted-fixture", async step({ onDelta }) {
      const call = outputs.shift();
      if (call) {
        const args = { ...call.arguments };
        if (call.name === "core_reminders_list" && args.reminderTitle) { args.query = args.reminderTitle; delete args.reminderTitle; delete args.selectionOperation; delete args.date; delete args.time; delete args.timezone; }
        if (args.messageId === "$draftId") args.messageId = input.seed.raw.prepare("SELECT id FROM mailbox_messages WHERE mailbox_id = 'eval-mailbox' AND message_kind = 'draft' ORDER BY rowid DESC LIMIT 1").get()?.id || "missing-draft";
        return { text: "", toolCalls: [{ id: crypto.randomUUID(), name: call.name, arguments: args }] };
      }
      const text = input.fixtureReply || "The requested action is complete.";
      await onDelta(text);
      return { text, toolCalls: [] };
    } };
  } else model = createCloudflareModel({ ai: input.modelRoute.ai, model: input.modelRoute.model, gatewayId: input.modelRoute.aiGateway.gatewayId, recordUsage: (usage) => input.modelRoute.recordUsage({ usage }) });
  const response = await runAgentTurn({ model, tools: createDomainTools(), messages: input.messages, store,
    context: { db: input.seed.db, ownerId: input.ownerId, ...contextIds, ownerTimezone: input.ownerTimezone, messageText: input.messages.at(-1)?.content || "", enabledPluginIds: input.enabledPluginIds, services: input.services }, onEvent: input.onEvent });
  if (response.status === "needs_approval") paused.set(input.seed, { store, contextIds, approvalId: response.approvalId });
  else paused.delete(input.seed);
  const checkpoint = await store.load();
  const toolResults = (checkpoint?.messages || []).filter((message) => message.role === "tool").map((message) => {
    let result; try { result = JSON.parse(message.content); } catch { result = { status: "error", error: "Malformed tool result" }; }
    const toolName = checkpoint.messages.flatMap((item) => item.toolCalls || []).find((call) => call.id === message.toolCallId)?.name || "unknown";
    return { execution_id: `${contextIds.requestId}:${message.toolCallId}`, tool_name: toolName, status: result.status === "error" ? "failed" : "succeeded", result_json: JSON.stringify({ result: result.data ?? result }), error_message: result.error || null };
  });
  return { ...response, toolResults };
}

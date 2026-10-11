export function createRuntimeAdapter(runtime) {
  if (runtime === "sdk") return { runTurn: async (input) => (await import("./agent-eval-adapter-sdk.mjs")).runSdkEvalTurn(input) };
  if (runtime !== "new") throw new Error("Use --runtime=new or --runtime=sdk; the SDK is informational only.");
  return { runTurn: runNewEvalTurn };
}

export function createEvalStreamTiming(started, now = () => performance.now()) {
  let firstDeltaMs = null, firstDeltaSource = null, ttftMs = null;
  return {
    onEvent(event) {
      if (event.event !== "delta" || typeof event.data?.text !== "string" || !event.data.text) return;
      const elapsed = Math.round(now() - started);
      if (firstDeltaMs === null) {
        firstDeltaMs = elapsed;
        firstDeltaSource = ["runtime", "model"].includes(event.data.source) ? event.data.source : null;
      }
      if (event.data.source === "model") ttftMs ??= elapsed;
    },
    snapshot(trace) { return { firstDeltaMs, firstDeltaSource, ttftMs, providerTtftMs: trace?.timeToFirstTokenMs ?? null }; },
  };
}

const paused = new WeakMap();
async function runNewEvalTurn(input) {
  const { runAgentTurn, createCloudflareModel, createD1TurnStore, decideAgentApproval, persistAgentInput, appendAgentStreamEvent } = await import("../packages/agent/src/index.ts");
  const { createDomainTools } = await import("../packages/agent/src/tools/index.ts");
  let store;
  let contextIds = { threadId: "eval-thread", turnId: input.turnId, requestId: input.requestId };
  const pending = paused.get(input.seed);
  if (input.approve && pending) {
    contextIds = pending.contextIds;
    store = pending.store;
    if (!await decideAgentApproval(input.seed.db, input.ownerId, pending.approvalId, "approved")) throw new Error("Synthetic approval could not be persisted");
  } else store = createD1TurnStore(input.seed.db, { ownerId: input.ownerId, ...contextIds });
  const { createTargetIntentVerifier, loadTargetIntentOwnerInputs } = await import("../apps/worker/src/agent-target-intent.ts");
  // Synthetic authenticated owner inputs are an independent evaluator field, never checkpoint/messages.
  if (!Array.isArray(input.canonicalOwnerInputs) || !input.canonicalOwnerInputs.length) throw new Error("Eval requires independent canonical synthetic owner inputs");
  for (const value of input.canonicalOwnerInputs) {
    const canonical = { userId: input.ownerId, threadId: "eval-thread", turnId: value.turnId, requestId: value.requestId, messageText: value.messageText };
    if (typeof canonical.messageText !== "string" || !canonical.turnId || !canonical.requestId) throw new Error("Malformed independent synthetic owner input");
    const existing = await input.seed.db.prepare("SELECT turn_id FROM me3_agent_turns WHERE owner_id=? AND request_id=?").bind(input.ownerId,value.requestId).first();
    await persistAgentInput(input.seed.db, { ownerId: input.ownerId, threadId: "eval-thread", turnId: value.turnId, requestId: value.requestId }, canonical);
    if (!existing) await input.seed.db.prepare("UPDATE me3_agent_turns SET created_at=? WHERE owner_id=? AND turn_id=?")
      .bind(`${input.seed.baseDate} 12:00:00`,input.ownerId,value.turnId).run();
    await input.seed.db.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)")
      .bind(`${value.turnId}:user`, input.ownerId, "eval-thread", value.messageText, JSON.stringify({ runtime: "agent", requestId: value.requestId })).run();
    if (!await input.seed.db.prepare("SELECT seq FROM me3_agent_stream_events WHERE owner_id=? AND turn_id=? LIMIT 1").bind(input.ownerId,value.turnId).first())
      await appendAgentStreamEvent(input.seed.db,input.ownerId,value.turnId,"owner_input",{source:"independent-synthetic-input"});
  }
  let model;
  if (input.modelRoute.model === "scripted-fixture") {
    const outputs = input.approve && pending ? [] : [...input.fixtureCalls];
    model = { id: "scripted-fixture", async step({ onDelta }) {
      const call = outputs.shift();
      if (call) {
        const args = { ...call.arguments };
        if (call.name === "core_reminders_list" && args.reminderTitle) { args.query = args.reminderTitle; delete args.reminderTitle; delete args.selectionOperation; delete args.date; delete args.time; delete args.timezone; }
        if (call.name === "core_targets_present" && typeof args.selectionId === "string" && args.selectionId.startsWith("$selection:")) {
          const domain=args.selectionId.slice("$selection:".length);
          const groups=await input.seed.db.prepare("SELECT id FROM me3_agent_selections WHERE owner_id=? AND thread_id=? AND read_turn_id=? AND domain=?")
            .bind(input.ownerId,contextIds.threadId,contextIds.turnId,domain).all();
          if(groups.results?.length!==1)throw new Error("Synthetic presentation requires exactly one current owner read group");
          args.selectionId=groups.results[0].id;
        }
        if (args.messageId === "$draftId") args.messageId = input.seed.raw.prepare("SELECT id FROM mailbox_messages WHERE mailbox_id = 'eval-mailbox' AND message_kind = 'draft' ORDER BY rowid DESC LIMIT 1").get()?.id || "missing-draft";
        if (args.reminderId === "$createdReminderId") args.reminderId = input.seed.raw.prepare("SELECT id FROM user_reminders WHERE user_id = ? AND title = 'Call Ada' ORDER BY rowid DESC LIMIT 1").get(input.ownerId)?.id || "missing-reminder";
        return { text: "", toolCalls: [{ id: crypto.randomUUID(), name: call.name, arguments: args }] };
      }
      const text = input.fixtureReply || "The requested action is complete.";
      await onDelta(text);
      return { text, toolCalls: [] };
    } };
  } else model = createCloudflareModel({ ai: input.modelRoute.ai, model: input.modelRoute.model, gatewayId: input.modelRoute.aiGateway.gatewayId, recordUsage: (usage) => input.modelRoute.recordUsage({ usage }) });
  const tools = createDomainTools();
  const intentTools = tools.filter(tool => !tool.pluginId || input.enabledPluginIds.has(tool.pluginId));
  const intentScope = { ownerId: input.ownerId, ...contextIds };
  const loadIntentOwnerInputs = (references, signal) => loadTargetIntentOwnerInputs(input.seed.db, intentScope, references, signal);
  const currentOwnerInput = input.canonicalOwnerInputs.find(value => value.turnId === contextIds.turnId && value.requestId === contextIds.requestId);
  if (!currentOwnerInput) throw new Error("Eval current canonical owner input is missing");
  const fixtureVerdicts = [...(input.intentFixtureVerdicts || [])];
  const verifyTargetIntent = createTargetIntentVerifier({ db: input.seed.db, scope: intentScope, ownerTimezone: input.ownerTimezone, tools: intentTools,
    admit: () => {
      let usageId;
      const ai={run:(model,request,options)=>input.modelRoute.ai.run(model,request,{...options,onAdmission:id=>{usageId=id;}})};
      return { usageId: () => usageId, model: input.modelRoute.model === "scripted-fixture" ? {
      id: "scripted-fixture", async step() {
        // These verdicts must be explicit independent fixture expectations; never echo the proposed tool call.
        const verdict = fixtureVerdicts.shift() || { decision: "clarify", reason: "Independent fixture intent verdict was not specified" };
        return { text: "", toolCalls: [{ id: crypto.randomUUID(), name: "core_target_intent_verdict", arguments: verdict }], usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 } };
      },
    } : createCloudflareModel({ ai, model: input.modelRoute.model, gatewayId: input.modelRoute.aiGateway.gatewayId,
      metadata: { purpose: "target_intent" }, recordUsage: usage => input.modelRoute.recordUsage({ usage: { ...usage, purpose: "target_intent" } }) }) };
    },
  });
  const intentToolContracts = intentTools.filter(tool => tool.target).map(({ name, description, parameters, effect, approval, target }) => ({ name, description, parameters, effect, approval, target: { domain: target.domain, idParameter: target.idParameter } }));
  const response = await runAgentTurn({ model, tools, messages: input.messages, store,
    signal:input.signal, context: { db: input.seed.db, ownerId: input.ownerId, ...contextIds, ownerTimezone: input.ownerTimezone, messageText: currentOwnerInput.messageText, loadIntentOwnerInputs, intentToolContracts, verifyTargetIntent, enabledPluginIds: input.enabledPluginIds, services: input.services }, onEvent: async event => {
      await appendAgentStreamEvent(input.seed.db, input.ownerId, contextIds.turnId, event.event, event.data);
      await input.onEvent?.(event);
    } });
  if (response.status === "needs_approval") paused.set(input.seed, { store, contextIds, approvalId: response.approvalId });
  else paused.delete(input.seed);
  const checkpoint = await store.load();
  const toolResults = (checkpoint?.messages || []).filter((message) => message.role === "tool").map((message) => {
    let result; try { result = JSON.parse(message.content); } catch { result = { status: "error", error: "Malformed tool result" }; }
    const call = checkpoint.messages.flatMap((item) => item.toolCalls || []).find((call) => call.id === message.toolCallId);
    return { execution_id: `${contextIds.requestId}:${message.toolCallId}`, tool_name: call?.name || "unknown", arguments: call?.arguments, status: result.status === "error" ? "failed" : "succeeded", result_json: JSON.stringify({ result: result.data ?? result }), error_message: result.error || null };
  });
  return { ...response, toolResults, toolContracts: tools.map(({ name, description, effect, approval }) => ({ name, description, effect, approval })) };
}

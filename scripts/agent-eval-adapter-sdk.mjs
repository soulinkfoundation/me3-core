export async function runSdkEvalTurn(input) {
  const { runCoreAgentToolTurn } = await import("../packages/agent-chat/src/core-agent-runtime.ts");
  const { CORE_CHAT_TOOLS } = await import("../packages/agent-chat/src/tools.ts");
  const response = await runCoreAgentToolTurn({
    db: input.seed.db, userId: input.ownerId, requestId: input.requestId, turnId: input.turnId,
    ownerTimezone: input.ownerTimezone, messages: input.messages, route: input.modelRoute, runtime: "sdk", installedPluginIds: input.enabledPluginIds,
    schedulingServices: input.services.scheduling, mailboxServices: input.services.mailbox,
    peopleSearchServices: input.services.people, webResearchServices: input.services.web, streamOptions: { onEvent: input.onEvent },
  });
  return { ...response, modelRequestCount: response.streamMetrics?.modelRequestCount || 0,
    toolContracts: CORE_CHAT_TOOLS.map(({ name, description, sideEffect, approvalMode }) => ({ name, description, effect: sideEffect, approval: approvalMode })),
    toolResults: input.seed.raw.prepare("SELECT id AS execution_id, tool_name, status, result_json, error_message FROM agent_tool_executions WHERE user_id = ? AND request_id = ? ORDER BY rowid").all(input.ownerId, input.requestId) };
}

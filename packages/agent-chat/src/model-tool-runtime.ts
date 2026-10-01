import {
  fromAnthropicToolResponse,
  fromWorkersAiToolResponse,
  toAnthropicToolRequest,
  toWorkersAiToolRequest,
  type AgentToolDefinition,
  type AgentToolMessage,
  type AgentToolModelResponse,
} from "./tool-runtime";
import {
  openAiCompatibleReasoningEffort,
  workersAiGatewayRunOptions,
  type AgentChatAiRoute,
} from "./model-runtime";

export async function runAgentToolModelStep(
  route: AgentChatAiRoute,
  messages: readonly AgentToolMessage[],
  tools: readonly AgentToolDefinition[],
  requiredToolName?: string,
): Promise<AgentToolModelResponse> {
  const toolChoice = requiredToolName ? { name: requiredToolName } : undefined;
  if (route.providerId === "workers-ai") {
    if (!route.ai) throw new Error("Workers AI binding is not configured");
    const options = workersAiGatewayRunOptions(route);
    const anthropicModel = isAnthropicUnifiedModel(route.model);
    const reasoningEffort = openAiCompatibleReasoningEffort(route.model);
    const request = anthropicModel
      ? { max_tokens: 800, ...toAnthropicToolRequest(messages, tools, toolChoice) }
      : {
          ...toWorkersAiToolRequest(messages, tools, toolChoice),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        };
    const result = options
      ? await route.ai.run(route.model, request, options)
      : await route.ai.run(route.model, request);
    const response = anthropicModel
      ? fromAnthropicToolResponse(result)
      : fromWorkersAiToolResponse(result);
    if (response.usage) {
      await route.recordUsage?.({ model: route.model, usage: response.usage });
    }
    return response;
  }

  throw new Error("Direct model routes are disabled; use Cloudflare AI Gateway.");
}

function isAnthropicUnifiedModel(model: string): boolean {
  return model.trim().toLowerCase().replace(/^@cf\//, "").startsWith("anthropic/");
}

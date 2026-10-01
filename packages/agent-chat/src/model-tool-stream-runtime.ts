import {
  fromAnthropicToolResponse,
  fromWorkersAiToolResponse,
  toAnthropicToolRequest,
  toWorkersAiToolRequest,
  parseAgentModelUsage,
  type AgentModelUsage,
  type AgentToolCall,
  type AgentToolDefinition,
  type AgentToolMessage,
  type AgentToolModelResponse,
} from "./tool-runtime";
import {
  openAiCompatibleReasoningEffort,
  workersAiGatewayRunOptions,
  type AgentChatAiRoute,
} from "./model-runtime";

type StreamDelta = (text: string) => void | Promise<void>;

export async function runAgentToolModelStreamStep(
  route: AgentChatAiRoute,
  messages: readonly AgentToolMessage[],
  tools: readonly AgentToolDefinition[],
  onDelta: StreamDelta,
  signal?: AbortSignal,
  requiredToolName?: string,
): Promise<AgentToolModelResponse> {
  throwIfAborted(signal);
  const toolChoice = requiredToolName ? { name: requiredToolName } : undefined;
  if (route.providerId === "workers-ai") {
    if (!route.ai) throw new Error("Workers AI binding is not configured");
    const anthropicModel = isAnthropicUnifiedModel(route.model);
    const reasoningEffort = openAiCompatibleReasoningEffort(route.model);
    const request = anthropicModel
      ? {
          max_tokens: 800,
          ...toAnthropicToolRequest(messages, tools, toolChoice),
          stream: true,
        }
      : {
          ...toWorkersAiToolRequest(messages, tools, toolChoice),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          stream: true,
        };
    const options = workersAiGatewayRunOptions(route);
    const result = options
      ? await route.ai.run(route.model, request, options)
      : await route.ai.run(route.model, request);
    if (!isReadableStream(result)) {
      const response = anthropicModel
        ? fromAnthropicToolResponse(result)
        : fromWorkersAiToolResponse(result);
      if (response.text) await onDelta(response.text);
      if (response.usage) {
        await route.recordUsage?.({ model: route.model, usage: response.usage });
      }
      return response;
    }
    const response = anthropicModel
      ? await accumulateAnthropicStream(result, onDelta, signal)
      : await accumulateOpenAiCompatibleStream(
          result,
          onDelta,
          signal,
          "Workers AI",
        );
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

async function accumulateOpenAiCompatibleStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: StreamDelta,
  signal: AbortSignal | undefined,
  provider: "OpenAI" | "Workers AI",
): Promise<AgentToolModelResponse> {
  let text = "";
  let usage: AgentModelUsage | null = null;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  await readSseJson(stream, signal, async (payload) => {
    const root = asRecord(payload);
    if (!root) return;
    const resultRoot = asRecord(root.result) || root;
    usage = parseAgentModelUsage(resultRoot) || usage;
    if (root.error) throw new Error(providerErrorMessage(root.error, provider));
    if (typeof root.response === "string" && root.response) {
      text += root.response;
      await onDelta(root.response);
    }
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const choice = asRecord(choices[0]);
    const delta = asRecord(choice?.delta);
    const content = stringValue(delta?.content) || stringValue(delta?.refusal);
    if (content) {
      text += content;
      await onDelta(content);
    }
    const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
    for (const rawCall of toolCalls) {
      const call = asRecord(rawCall);
      const index = typeof call?.index === "number" ? call.index : calls.size;
      const fn = asRecord(call?.function);
      const current = calls.get(index) || { id: "", name: "", arguments: "" };
      current.id += stringValue(call?.id);
      current.name += stringValue(fn?.name);
      current.arguments += stringValue(fn?.arguments);
      calls.set(index, current);
    }
  });
  return {
    text,
    toolCalls: [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id || `${provider === "OpenAI" ? "openai" : "workers_ai"}_call_${index + 1}`,
        name: requiredString(call.name, `${provider} tool name`),
        arguments: parseArguments(call.arguments, provider, call.name),
      })),
    ...(usage ? { usage } : {}),
  };
}

async function accumulateAnthropicStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: StreamDelta,
  signal?: AbortSignal,
): Promise<AgentToolModelResponse> {
  let text = "";
  let usage: AgentModelUsage | null = null;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  await readSseJson(stream, signal, async (payload) => {
    const event = asRecord(payload);
    if (!event) return;
    if (event.type === "message_start") {
      const message = asRecord(event.message);
      usage = message ? parseAgentModelUsage(message) || usage : usage;
    }
    if (event.type === "message_delta") {
      usage = parseAgentModelUsage(event) || usage;
    }
    if (event.type === "error") {
      throw new Error(providerErrorMessage(event.error, "Anthropic"));
    }
    const index = typeof event.index === "number" ? event.index : 0;
    const block = asRecord(event.content_block);
    if (event.type === "content_block_start" && block?.type === "tool_use") {
      calls.set(index, {
        id: stringValue(block.id),
        name: stringValue(block.name),
        arguments: "",
      });
    }
    if (event.type !== "content_block_delta") return;
    const delta = asRecord(event.delta);
    if (delta?.type === "text_delta") {
      const chunk = stringValue(delta.text);
      if (chunk) {
        text += chunk;
        await onDelta(chunk);
      }
    }
    if (delta?.type === "input_json_delta") {
      const call = calls.get(index);
      if (call) call.arguments += stringValue(delta.partial_json);
    }
  });
  return {
    text,
    toolCalls: [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => ({
        id: requiredString(call.id, "Anthropic tool id"),
        name: requiredString(call.name, "Anthropic tool name"),
        arguments: parseArguments(call.arguments, "Anthropic", call.name),
      })),
    ...(usage ? { usage } : {}),
  };
}

async function readSseJson(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  consume: (payload: unknown) => void | Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const abort = () => void reader.cancel("aborted");
  signal?.addEventListener("abort", abort, { once: true });
  let buffer = "";
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data === "[DONE]") return;
        if (data) await consume(JSON.parse(data));
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    const data = buffer.trim().replace(/^data:\s?/, "");
    if (data && data !== "[DONE]") await consume(JSON.parse(data));
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function providerErrorMessage(value: unknown, provider: string): string {
  const error = asRecord(value);
  const message = stringValue(error?.message);
  return message ? `${provider}: ${message}` : `${provider} stream failed.`;
}

function parseArguments(value: string, provider: string, toolName: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Report one provider-safe validation error below.
  }
  throw new Error(`${provider} returned invalid arguments for tool "${toolName}".`);
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(value && typeof (value as ReadableStream<Uint8Array>).getReader === "function");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requiredString(value: string, label: string): string {
  if (value) return value;
  throw new Error(`${label} is required.`);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("The operation was aborted.", "AbortError");
}

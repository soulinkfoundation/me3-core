import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentToolModelStreamStep } from "../../../packages/agent-chat/src/model-tool-stream-runtime";
import type { AgentChatAiRoute } from "../../../packages/agent-chat/src/model-runtime";
import type { AgentToolDefinition } from "./agent-chat";

const PROVIDERS = ["workers-ai", "openai", "anthropic"] as const;
const TOOLS: readonly AgentToolDefinition[] = [{
  name: "core_reminders_create",
  description: "Create a reminder.",
  parameters: {
    type: "object",
    properties: { title: { type: "string", description: "Reminder title." } },
    required: ["title"],
    additionalProperties: false,
  },
}];

afterEach(() => vi.unstubAllGlobals());

describe("streaming agent tool model adapters", () => {
  it.each(PROVIDERS)("streams text deltas and accumulates the final %s reply", async (provider) => {
    const deltas: string[] = [];
    const result = await runAgentToolModelStreamStep(
      route(provider, textEvents(provider, ["Hello", " world"])),
      [{ role: "user", content: "Say hello" }],
      TOOLS,
      (text) => {
        deltas.push(text);
      },
    );

    expect(deltas).toEqual(["Hello", " world"]);
    expect(result).toEqual({ text: "Hello world", toolCalls: [] });
  });

  it.each(PROVIDERS)("accumulates partial %s tool arguments without executing prose", async (provider) => {
    const deltas: string[] = [];
    const result = await runAgentToolModelStreamStep(
      route(provider, toolEvents(provider)),
      [{ role: "user", content: "Remind me to call Sam" }],
      TOOLS,
      (text) => {
        deltas.push(text);
      },
    );

    expect(deltas).toEqual([]);
    expect(result).toEqual({
      text: "",
      toolCalls: [{
        id: "call-1",
        name: "core_reminders_create",
        arguments: { title: "Call Sam" },
      }],
    });
  });

  it("cancels before starting provider work", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn();

    await expect(
      runAgentToolModelStreamStep(
        route("workers-ai", [], run),
        [{ role: "user", content: "Stop" }],
        TOOLS,
        () => undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("captures Workers AI stream usage and reports it to the route", async () => {
    const recordUsage = vi.fn();
    const aiRoute = route("workers-ai", [
      event({ choices: [{ delta: { content: "Done" } }] }),
      event({
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 20 },
        },
      }),
      "data: [DONE]\n\n",
    ]);
    aiRoute.recordUsage = recordUsage;

    const result = await runAgentToolModelStreamStep(
      aiRoute,
      [{ role: "user", content: "Finish" }],
      TOOLS,
      () => undefined,
    );

    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 20,
    });
    expect(recordUsage).toHaveBeenCalledWith({
      model: "workers-stream-model",
      usage: result.usage,
    });
  });

  it("attaches safe turn correlation metadata to streaming gateway calls", async () => {
    const run = vi.fn(async () => sseStream(textEvents("workers-ai", ["Done"])));
    const aiRoute = route("workers-ai", [], run);
    aiRoute.aiGateway = {
      accountId: "account-id",
      gatewayId: "me3",
      apiToken: null,
      routeWorkersAi: true,
      routeExternalProviders: false,
    };
    aiRoute.aiGatewayMetadata = {
      me3_request_id: "request-1",
      me3_turn_id: "turn-1",
    };
    aiRoute.aiGatewayRequestPolicy = {
      requestTimeoutMs: 12_000,
      maxAttempts: 1,
    };

    await runAgentToolModelStreamStep(
      aiRoute,
      [{ role: "user", content: "Say done" }],
      TOOLS,
      () => undefined,
    );

    expect(run).toHaveBeenCalledWith(
      "workers-stream-model",
      expect.any(Object),
      {
        gateway: {
          id: "me3",
          metadata: {
            me3_request_id: "request-1",
            me3_turn_id: "turn-1",
          },
          requestTimeoutMs: 12_000,
          retries: { maxAttempts: 1 },
        },
      },
    );
  });
});

function route(
  provider: typeof PROVIDERS[number],
  events: string[],
  workersRun = vi.fn(async () => sseStream(events)),
): AgentChatAiRoute {
  return {
    providerId: "workers-ai",
    model: provider === "workers-ai" ? "workers-stream-model" : `${provider}/stream-model`,
    backupModel: null,
    apiKey: null,
    ai: { run: workersRun },
    aiGateway: null,
    configured: true,
  };
}

function textEvents(provider: typeof PROVIDERS[number], chunks: string[]): string[] {
  if (provider === "anthropic") {
    return [
      event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ...chunks.map((text) => event({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })),
      event({ type: "message_stop" }),
    ];
  }
  return [
    ...chunks.map((content) => event({ choices: [{ delta: { content } }] })),
    "data: [DONE]\n\n",
  ];
}

function toolEvents(provider: typeof PROVIDERS[number]): string[] {
  if (provider === "anthropic") {
    return [
      event({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "call-1",
          name: "core_reminders_create",
          input: {},
        },
      }),
      event({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"title":"Call' },
      }),
      event({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: ' Sam"}' },
      }),
      event({ type: "content_block_stop", index: 0 }),
      event({ type: "message_stop" }),
    ];
  }
  return [
    event({ choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "call-1",
      function: { name: "core_reminders_create", arguments: '{"title":"Call' },
    }] } }] }),
    event({ choices: [{ delta: { tool_calls: [{
      index: 0,
      function: { arguments: ' Sam"}' },
    }] } }] }),
    "data: [DONE]\n\n",
  ];
}

function event(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const item of events) controller.enqueue(encoder.encode(item));
      controller.close();
    },
  });
}

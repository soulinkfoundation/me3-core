import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentToolModelStep } from "../../../packages/agent-chat/src/model-tool-runtime";
import type { AgentChatAiRoute } from "../../../packages/agent-chat/src/model-runtime";
import type { AgentToolDefinition } from "./agent-chat";

const TOOLS: readonly AgentToolDefinition[] = [
  {
    name: "core_reminders_list",
    description: "List reminders.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("live agent tool model adapters", () => {
  it("calls Workers AI through the native binding", async () => {
    const run = vi.fn(async () => ({
      tool_calls: [{ name: "core_reminders_list", arguments: {} }],
    }));
    const result = await runAgentToolModelStep(
      route("workers-ai", { ai: { run } }),
      [{ role: "user", content: "List reminders" }],
      TOOLS,
    );

    expect(run).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({
        messages: [{ role: "user", content: "List reminders" }],
        tools: [{
          type: "function",
          function: expect.objectContaining({
            name: "core_reminders_list",
            parameters: expect.any(Object),
          }),
        }],
      }),
    );
    expect(result.toolCalls[0]).toMatchObject({ name: "core_reminders_list" });
  });

  it("runs managed GPT-5.4 mini with reasoning disabled", async () => {
    const run = vi.fn(async () => ({
      tool_calls: [{ name: "core_reminders_list", arguments: {} }],
    }));

    await runAgentToolModelStep(
      route("workers-ai", {
        model: "openai/gpt-5.4-mini",
        ai: { run },
      }),
      [{ role: "user", content: "List reminders" }],
      TOOLS,
    );

    expect(run).toHaveBeenCalledWith(
      "openai/gpt-5.4-mini",
      expect.objectContaining({ reasoning_effort: "none" }),
    );
  });

  it("attaches safe turn correlation metadata to Workers AI Gateway calls", async () => {
    const run = vi.fn(async () => ({ text: "Done" }));

    await runAgentToolModelStep(
      route("workers-ai", {
        ai: { run },
        aiGateway: {
          accountId: "account-id",
          gatewayId: "me3",
          apiToken: null,
          routeWorkersAi: true,
          routeExternalProviders: false,
        },
        aiGatewayMetadata: {
          me3_request_id: "request-1",
          me3_turn_id: "turn-1",
        },
        aiGatewayRequestPolicy: {
          requestTimeoutMs: 12_000,
          maxAttempts: 1,
        },
      }),
      [{ role: "user", content: "Say done" }],
      TOOLS,
    );

    expect(run).toHaveBeenCalledWith(
      "test-model",
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

  it("uses Anthropic's native schema for a unified Workers AI model", async () => {
    const run = vi.fn(async () => ({
      content: [{
        type: "tool_use",
        id: "anthropic-unified-1",
        name: "core_reminders_list",
        input: {},
      }],
    }));
    const result = await runAgentToolModelStep(
      route("workers-ai", {
        model: "anthropic/claude-sonnet-4.6",
        ai: { run },
      }),
      [{ role: "user", content: "List reminders" }],
      TOOLS,
    );

    expect(run).toHaveBeenCalledWith(
      "anthropic/claude-sonnet-4.6",
      expect.objectContaining({
        max_tokens: 800,
        tools: [expect.objectContaining({ name: "core_reminders_list" })],
      }),
    );
    expect(result.toolCalls[0]).toMatchObject({ id: "anthropic-unified-1" });
  });

  it.each(["openai", "anthropic"] as const)("rejects the retired direct %s route without provider work", async provider => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(runAgentToolModelStep(
      route(provider, { apiKey: "test-key" }),
      [{ role: "user", content: "List reminders" }],
      TOOLS,
    )).rejects.toThrow("Direct model routes are disabled; use Cloudflare AI Gateway.");
    expect(fetch).not.toHaveBeenCalled();
  });

});

function route(
  providerId: AgentChatAiRoute["providerId"],
  overrides: Partial<AgentChatAiRoute>,
): AgentChatAiRoute {
  return {
    providerId,
    model: "test-model",
    backupModel: null,
    apiKey: null,
    ai: null,
    aiGateway: null,
    configured: true,
    ...overrides,
  };
}

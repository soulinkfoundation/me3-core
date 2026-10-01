import { describe, expect, it } from "vitest";
import {
  CORE_CHAT_TOOLS,
  MAX_AGENT_TOOL_MODEL_STEPS,
  fromAnthropicToolResponse,
  fromOpenAiToolResponse,
  fromWorkersAiToolResponse,
  runAgentToolLoop,
  toAnthropicToolRequest,
  toOpenAiToolRequest,
  toWorkersAiToolRequest,
  type AgentToolDefinition,
  type AgentToolMessage,
} from "./agent-chat";

const TOOLS: readonly AgentToolDefinition[] = [
  {
    name: "reminders_create",
    description: "Create a reminder.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Reminder title." },
        note: {
          type: "string",
          description: "Optional note.",
          enum: ["brief", "full"],
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
];

describe("provider-neutral agent tool loop", () => {
  it("executes tool calls sequentially and returns the model's final reply", async () => {
    const executionOrder: string[] = [];
    let modelCalls = 0;

    const result = await runAgentToolLoop({
      messages: [{ role: "user", content: "Set both reminders" }],
      tools: TOOLS,
      model: async (messages) => {
        modelCalls += 1;
        if (modelCalls === 2) {
          expect(messages.filter((message) => message.role === "tool")).toHaveLength(
            2,
          );
          return { text: "Both reminders are set.", toolCalls: [] };
        }
        return {
          text: "",
          toolCalls: [
            { id: "call-1", name: "reminders_create", arguments: { title: "A" } },
            { id: "call-2", name: "reminders_create", arguments: { title: "B" } },
          ],
        };
      },
      executeTool: async (call) => {
        executionOrder.push(`start:${call.id}`);
        await Promise.resolve();
        executionOrder.push(`end:${call.id}`);
        return { ok: true };
      },
    });

    expect(result.text).toBe("Both reminders are set.");
    expect(result.modelSteps).toBe(2);
    expect(result.executedToolCalls).toBe(2);
    expect(executionOrder).toEqual([
      "start:call-1",
      "end:call-1",
      "start:call-2",
      "end:call-2",
    ]);
  });

  it("treats strict-schema nulls as omitted only for optional non-nullable arguments", async () => {
    const nullableTool: AgentToolDefinition = {
      name: "nullable_tool",
      description: "Accept an explicit null.",
      parameters: {
        type: "object",
        properties: { note: { type: ["string", "null"], description: "Optional note" } },
        additionalProperties: false,
      },
    };
    const seen: Array<Record<string, unknown>> = [];
    let modelCalls = 0;
    await runAgentToolLoop({
      messages: [{ role: "user", content: "Create a reminder" }],
      tools: [...TOOLS, nullableTool],
      model: async (messages) => {
        if (++modelCalls === 2) {
          expect(messages[1]).toMatchObject({
            toolCalls: [{ arguments: { title: "Call Alex" } }, { arguments: { note: null } }],
          });
          return { text: "Done.", toolCalls: [] };
        }
        return {
          text: "",
          toolCalls: [
            { id: "one", name: "reminders_create", arguments: { title: "Call Alex", note: null } },
            { id: "two", name: "nullable_tool", arguments: { note: null } },
          ],
        };
      },
      executeTool: async (call) => {
        seen.push(call.arguments);
        return { ok: true };
      },
    });
    expect(seen).toEqual([{ title: "Call Alex" }, { note: null }]);
  });

  it("returns unknown tools to the model as errors without executing them", async () => {
    let modelCalls = 0;
    let executions = 0;
    const result = await runAgentToolLoop({
      messages: [{ role: "user", content: "Do something" }],
      tools: TOOLS,
      model: async (messages) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "bad", name: "missing", arguments: {} }],
          };
        }
        const error = messages[messages.length - 1];
        expect(error).toMatchObject({ role: "tool", isError: true });
        expect(error.content).toContain("Unknown tool");
        return { text: "That action is unavailable.", toolCalls: [] };
      },
      executeTool: async () => {
        executions += 1;
      },
    });

    expect(result.text).toBe("That action is unavailable.");
    expect(executions).toBe(0);
  });

  it("never exceeds four model steps", async () => {
    let modelCalls = 0;
    await expect(
      runAgentToolLoop({
        messages: [{ role: "user", content: "Loop" }],
        tools: TOOLS,
        maxModelSteps: 99,
        model: async () => ({
          text: "",
          toolCalls: [
            {
              id: `call-${++modelCalls}`,
              name: "reminders_create",
              arguments: { title: "Again" },
            },
          ],
        }),
        executeTool: async () => ({ ok: true }),
      }),
    ).rejects.toThrow("4-step limit");
    expect(modelCalls).toBe(MAX_AGENT_TOOL_MODEL_STEPS);
  });

  it("allows an explicit twenty-step SDK loop", async () => {
    let modelCalls = 0;
    const result = await runAgentToolLoop({
      messages: [{ role: "user", content: "Work through this" }],
      tools: TOOLS,
      extended: true,
      maxModelSteps: 20,
      model: async () => {
        modelCalls += 1;
        return modelCalls === 12
          ? { text: "Done.", toolCalls: [] }
          : {
              text: "",
              toolCalls: [{ id: `call-${modelCalls}`, name: "reminders_create", arguments: { title: "A" } }],
            };
      },
      executeTool: async () => ({ ok: true }),
    });
    expect(result.modelSteps).toBe(12);
    expect(result.executedToolCalls).toBe(11);
  });
});

describe("agent tool provider adapters", () => {
  const transcript: readonly AgentToolMessage[] = [
    { role: "system", content: "Be useful." },
    { role: "user", content: "Remind me." },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          name: "reminders_create",
          arguments: { title: "Call Mum" },
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      name: "reminders_create",
      content: '{"ok":true}',
      isError: false,
    },
  ];

  it("keeps the public URL web tool schema compatible across providers", () => {
    const webOpen = CORE_CHAT_TOOLS.find((tool) => tool.name === "core_web_open");
    expect(webOpen).toBeDefined();

    const openAiRequest = toOpenAiToolRequest([], [webOpen!]) as {
      tools: Array<{
        function: {
          parameters: { properties: { url: Record<string, unknown> } };
        };
      }>;
    };
    const anthropicRequest = toAnthropicToolRequest([], [webOpen!]) as {
      tools: Array<{
        input_schema: { properties: { url: Record<string, unknown> } };
      }>;
    };
    const workersAiRequest = toWorkersAiToolRequest([], [webOpen!]) as {
      tools: Array<{
        function: {
          parameters: { properties: { url: Record<string, unknown> } };
        };
      }>;
    };

    expect(openAiRequest.tools[0].function.parameters.properties.url).not.toHaveProperty(
      "format",
    );
    expect(anthropicRequest.tools[0].input_schema.properties.url).not.toHaveProperty(
      "format",
    );
    expect(workersAiRequest.tools[0].function.parameters.properties.url).not.toHaveProperty(
      "format",
    );
  });

  it("maps OpenAI strict tools and tool messages", () => {
    const request = toOpenAiToolRequest(transcript, TOOLS) as {
      messages: Array<Record<string, unknown>>;
      tools: Array<{
        function: {
          strict: boolean;
          parameters: {
            required: string[];
            properties: Record<string, { type: string[]; enum?: unknown[] }>;
          };
        };
      }>;
      parallel_tool_calls: boolean;
    };

    expect(request.parallel_tool_calls).toBe(true);
    expect(request.messages[2]).toMatchObject({ role: "assistant" });
    expect(request.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
    });
    expect(request.tools[0].function.strict).toBe(true);
    expect(request.tools[0].function.parameters.required).toEqual([
      "title",
      "note",
    ]);
    expect(request.tools[0].function.parameters.properties.note.type).toEqual([
      "string",
      "null",
    ]);
    expect(request.tools[0].function.parameters.properties.note.enum).toEqual([
      "brief",
      "full",
      null,
    ]);

    expect(
      fromOpenAiToolResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "oa-1",
                  function: {
                    name: "reminders_create",
                    arguments: '{"title":"Call Mum"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual({
      text: "",
      toolCalls: [
        {
          id: "oa-1",
          name: "reminders_create",
          arguments: { title: "Call Mum" },
        },
      ],
    });
    expect(() =>
      fromOpenAiToolResponse({ error: { message: "Rate limit exceeded" } }),
    ).toThrow("OpenAI: Rate limit exceeded");
  });

  it("maps Anthropic tool-use and grouped tool-result blocks", () => {
    const request = toAnthropicToolRequest(transcript, TOOLS) as {
      system: string;
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{ strict?: boolean; input_schema: unknown }>;
    };

    expect(request.system).toBe("Be useful.");
    expect(request.messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "tool_use", id: "call-1" }],
    });
    expect(request.messages[2]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call-1" }],
    });
    expect(request.tools[0]).toMatchObject({
      input_schema: TOOLS[0].parameters,
    });
    expect(request.tools[0]).not.toHaveProperty("strict");

    expect(
      fromAnthropicToolResponse({
        content: [
          { type: "text", text: "Checking." },
          {
            type: "tool_use",
            id: "ant-1",
            name: "reminders_create",
            input: { title: "Call Mum" },
          },
        ],
      }),
    ).toEqual({
      text: "Checking.",
      toolCalls: [
        {
          id: "ant-1",
          name: "reminders_create",
          arguments: { title: "Call Mum" },
        },
      ],
    });
  });

  it("maps Workers AI's OpenAI-compatible function-calling shape", () => {
    const request = toWorkersAiToolRequest(transcript, TOOLS) as {
      messages: Array<Record<string, unknown>>;
      tools: Array<{ type: string; function: Record<string, unknown> }>;
    };

    expect(request.messages[2]).toMatchObject({
      role: "assistant",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: {
          name: "reminders_create",
          arguments: '{"title":"Call Mum"}',
        },
      }],
    });
    expect(request.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
      content: '{"ok":true}',
    });
    expect(request.tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "reminders_create",
        parameters: expect.any(Object),
      },
    });

    expect(
      fromWorkersAiToolResponse({
        response: "",
        tool_calls: [
          { name: "reminders_create", arguments: { title: "Call Mum" } },
        ],
      }),
    ).toEqual({
      text: "",
      toolCalls: [
        {
          id: "workers_ai_call_1",
          name: "reminders_create",
          arguments: { title: "Call Mum" },
        },
      ],
    });
  });

  it("maps one required tool across provider request formats", () => {
    expect(
      toOpenAiToolRequest(transcript, TOOLS, {
        name: "reminders_create",
      }),
    ).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "reminders_create" },
      },
    });
    expect(
      toWorkersAiToolRequest(transcript, TOOLS, {
        name: "reminders_create",
      }),
    ).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "reminders_create" },
      },
    });
    expect(
      toAnthropicToolRequest(transcript, TOOLS, {
        name: "reminders_create",
      }),
    ).toMatchObject({
      tool_choice: {
        type: "tool",
        name: "reminders_create",
      },
    });
  });

  it("keeps provider token usage as metadata", () => {
    expect(
      fromOpenAiToolResponse({
        choices: [{ message: { content: "Done" } }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 40 },
        },
      }).usage,
    ).toEqual({ inputTokens: 120, outputTokens: 20, cachedInputTokens: 40 });
    expect(
      fromAnthropicToolResponse({
        content: [{ type: "text", text: "Done" }],
        usage: {
          input_tokens: 90,
          output_tokens: 15,
          cache_read_input_tokens: 30,
        },
      }).usage,
    ).toEqual({ inputTokens: 90, outputTokens: 15, cachedInputTokens: 30 });
    expect(
      fromWorkersAiToolResponse({
        response: "Done",
        usage: { prompt_tokens: 80, completion_tokens: 10 },
      }).usage,
    ).toEqual({ inputTokens: 80, outputTokens: 10, cachedInputTokens: 0 });
  });
});

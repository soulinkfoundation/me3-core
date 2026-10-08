import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_CHAT_TOOLS,
  executeIdempotentAgentTool,
  runAgentToolLoop,
  type AgentToolCall,
  type AgentToolMessage,
} from "@me3-core/plugin-agent-chat";
import { runAgentToolModelStep } from "../../../packages/agent-chat/src/model-tool-runtime";
import type { AgentChatAiRoute } from "../../../packages/agent-chat/src/model-runtime";

const PROVIDERS = ["workers-ai", "openai", "anthropic"] as const;
const WRITE_TOOLS = new Set([
  "core_reminders_create",
  "core_mission_task_create",
  "core_mailbox_draft",
]);

const CUTOVER_THRESHOLDS = {
  toolChoiceAccuracy: 0.95,
  argumentValidity: 0.98,
  duplicatePrevention: 1,
  completionClaimAccuracy: 1,
  liveTtftP95Ms: 2_500,
  liveSingleToolLatencyP95Ms: 12_000,
  liveMultiToolLatencyP95Ms: 20_000,
} as const;

type ExpectedCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type EvalTurn =
  | { calls: readonly ExpectedCall[] }
  | { text: string };

type EvalScenario = {
  id: string;
  prompt: string;
  turns: readonly EvalTurn[];
  failTool?: string;
};

const GOLDEN_SCENARIOS: readonly EvalScenario[] = [
  {
    id: "conversation-no-tool",
    prompt: "Help me think through what to focus on today.",
    turns: [{ text: "Let's identify the one outcome that matters most today." }],
  },
  {
    id: "reminder-create",
    prompt: "Remind me tomorrow at 9am to call Sam.",
    turns: [
      {
        calls: [{
          name: "core_reminders_create",
          arguments: {
            title: "Call Sam",
            date: "2026-07-11",
            time: "09:00",
            timezone: "Europe/Dublin",
          },
        }],
      },
      { text: "I set the reminder for tomorrow at 9am." },
    ],
  },
  {
    id: "mission-list-create",
    prompt: "Add Follow up with Sam to the ME3 Launch project.",
    turns: [
      { calls: [{ name: "core_mission_task_list", arguments: {} }] },
      {
        calls: [{
          name: "core_mission_task_create",
          arguments: {
            title: "Follow up with Sam",
            projectId: "project-launch",
          },
        }],
      },
      { text: "Added Follow up with Sam to ME3 Launch." },
    ],
  },
  {
    id: "mailbox-search-read-draft",
    prompt: "Find Ada's launch email and draft a reply saying it is ready.",
    turns: [
      {
        calls: [{
          name: "core_mailbox_search",
          arguments: { query: "Ada launch", direction: "inbound", limit: 5 },
        }],
      },
      {
        calls: [{
          name: "core_mailbox_read",
          arguments: { messageId: "message-ada" },
        }],
      },
      {
        calls: [{
          name: "core_mailbox_draft",
          arguments: {
            to: "ada@example.com",
            subject: "Re: Launch checklist",
            body: "Hi Ada,\n\nThe launch checklist is ready.",
            replyToMessageId: "message-ada",
          },
        }],
      },
      { text: "I saved a reply draft for review. It has not been sent." },
    ],
  },
  {
    id: "mailbox-ambiguity",
    prompt: "Reply to Ada's launch email.",
    turns: [
      {
        calls: [{
          name: "core_mailbox_search",
          arguments: { query: "Ada launch", direction: "inbound" },
        }],
      },
      { text: "I found two matching messages. Which one should I use?" },
    ],
  },
  {
    id: "incident-provider-write-failure-no-false-completion",
    prompt: "Remind me tomorrow at 9am to call Sam.",
    failTool: "core_reminders_create",
    turns: [
      {
        calls: [{
          name: "core_reminders_create",
          arguments: {
            title: "Call Sam",
            date: "2026-07-11",
            time: "09:00",
            timezone: "Europe/Dublin",
          },
        }],
      },
      { text: "I couldn't create that reminder because the tool failed." },
    ],
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("Agent Runtime v2 cutover evaluation", () => {
  it("runs one golden behavior matrix through every provider adapter", async () => {
    const observations: Array<{
      provider: typeof PROVIDERS[number];
      scenario: string;
      expected: ExpectedCall[];
      actual: AgentToolCall[];
      successfulWrites: number;
      finalText: string;
      firstResponseMs: number;
      totalLatencyMs: number;
    }> = [];

    for (const provider of PROVIDERS) {
      for (const scenario of GOLDEN_SCENARIOS) {
        const expected = scenario.turns.flatMap((turn) =>
          "calls" in turn ? [...turn.calls] : []
        );
        const actual: AgentToolCall[] = [];
        let successfulWrites = 0;
        let firstResponseMs: number | null = null;
        const startedAt = performance.now();
        const route = providerRoute(provider, scenario.turns);
        const messages: AgentToolMessage[] = [
          { role: "system", content: "You are ME3." },
          { role: "user", content: scenario.prompt },
        ];

        const result = await runAgentToolLoop({
          messages,
          tools: CORE_CHAT_TOOLS,
          model: async (turnMessages, tools) => {
            const response = await runAgentToolModelStep(route, turnMessages, tools);
            firstResponseMs ??= performance.now() - startedAt;
            return response;
          },
          executeTool: async (call) => {
            actual.push(call);
            if (call.name === scenario.failTool) {
              throw new Error("Simulated tool failure.");
            }
            if (WRITE_TOOLS.has(call.name)) successfulWrites += 1;
            return toolResult(call.name);
          },
        });

        observations.push({
          provider,
          scenario: scenario.id,
          expected,
          actual,
          successfulWrites,
          finalText: result.text,
          firstResponseMs: firstResponseMs ?? performance.now() - startedAt,
          totalLatencyMs: performance.now() - startedAt,
        });
      }
    }

    const expectedCalls = observations.flatMap((item) => item.expected);
    const actualCalls = observations.flatMap((item) => item.actual);
    const correctToolChoices = observations.reduce(
      (total, item) => total + item.expected.filter(
        (call, index) => call.name === item.actual[index]?.name,
      ).length,
      0,
    );
    const validArguments = observations.reduce(
      (total, item) => total + item.expected.filter(
        (call, index) => sameJson(call.arguments, item.actual[index]?.arguments),
      ).length,
      0,
    );
    const correctCompletionClaims = observations.filter((item) => {
      const expectedWrites = item.expected.filter((call) => WRITE_TOOLS.has(call.name)).length;
      const claimsCompletion = /\b(set the reminder|added .+ to|saved .+ draft)\b/i.test(
        item.finalText,
      );
      return claimsCompletion === (expectedWrites > 0 && item.successfulWrites === expectedWrites);
    }).length;
    const duplicatePrevention = await evaluateDuplicatePrevention();
    const report = {
      matrix: {
        providers: PROVIDERS.length,
        scenarios: GOLDEN_SCENARIOS.length,
        runs: observations.length,
      },
      metrics: {
        toolChoiceAccuracy: ratio(correctToolChoices, expectedCalls.length),
        argumentValidity: ratio(validArguments, expectedCalls.length),
        duplicatePrevention,
        completionClaimAccuracy: ratio(
          correctCompletionClaims,
          observations.length,
        ),
        fixtureFirstResponseP95Ms: percentile(
          observations.map((item) => item.firstResponseMs),
          0.95,
        ),
        fixtureTotalLatencyP95Ms: percentile(
          observations.map((item) => item.totalLatencyMs),
          0.95,
        ),
        liveTtftP95Ms: null,
      },
      thresholds: CUTOVER_THRESHOLDS,
      liveLatencyStatus: "requires real streaming provider smoke evidence",
    };

    expect(actualCalls).toHaveLength(expectedCalls.length);
    expect(report.metrics.toolChoiceAccuracy).toBeGreaterThanOrEqual(
      CUTOVER_THRESHOLDS.toolChoiceAccuracy,
    );
    expect(report.metrics.argumentValidity).toBeGreaterThanOrEqual(
      CUTOVER_THRESHOLDS.argumentValidity,
    );
    expect(report.metrics.duplicatePrevention).toBe(
      CUTOVER_THRESHOLDS.duplicatePrevention,
    );
    expect(report.metrics.completionClaimAccuracy).toBe(
      CUTOVER_THRESHOLDS.completionClaimAccuracy,
    );
    console.info(`ME3_AGENT_RUNTIME_EVAL ${JSON.stringify(report)}`);
  });
});

function providerRoute(
  provider: typeof PROVIDERS[number],
  turns: readonly EvalTurn[],
): AgentChatAiRoute {
  const payloads = turns.map((turn, index) => providerPayload(provider, turn, index));
  const next = vi.fn(async () => payloads.shift());
  return {
    providerId: "workers-ai",
    model: provider === "anthropic" ? "anthropic/claude-sonnet-5" : provider === "openai" ? "openai/gpt-5.4-mini" : "workers-ai-eval-model",
    backupModel: null,
    apiKey: null,
    ai: { run: next },
    aiGateway: null,
    configured: true,
  };
}

function providerPayload(
  provider: typeof PROVIDERS[number],
  turn: EvalTurn,
  turnIndex: number,
): unknown {
  if ("text" in turn) {
    if (provider === "openai") {
      return { choices: [{ message: { content: turn.text } }] };
    }
    if (provider === "anthropic") {
      return { content: [{ type: "text", text: turn.text }] };
    }
    return { response: turn.text };
  }
  const calls = turn.calls.map((call, callIndex) => ({
    id: `eval-${turnIndex}-${callIndex}`,
    ...call,
  }));
  if (provider === "openai") {
    return {
      choices: [{
        message: {
          tool_calls: calls.map((call) => ({
            id: call.id,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        },
      }],
    };
  }
  if (provider === "anthropic") {
    return {
      content: calls.map((call) => ({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.arguments,
      })),
    };
  }
  return { tool_calls: calls };
}

function toolResult(name: string): Record<string, unknown> {
  if (name === "core_mission_task_list") {
    return { ok: true, tasks: [], projects: [{ id: "project-launch", name: "ME3 Launch" }] };
  }
  if (name === "core_mailbox_search") {
    return { ok: true, messages: [{ id: "message-ada", subject: "Launch checklist" }] };
  }
  if (name === "core_mailbox_read") {
    return { ok: true, message: { id: "message-ada", body: "Is the checklist ready?" } };
  }
  return { ok: true, id: `result-${name}` };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ratio(value: number, total: number): number {
  return total === 0 ? 1 : Number((value / total).toFixed(4));
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return Number((sorted[index] || 0).toFixed(2));
}

async function evaluateDuplicatePrevention(): Promise<number> {
  const db = executionLedgerDb();
  const input = {
    userId: "owner",
    requestId: "eval-replay",
    toolCallId: "create-1",
    toolName: "core_reminders_create",
  };
  let writes = 0;
  const execute = async () => ({ ok: true, write: ++writes });
  const first = await executeIdempotentAgentTool(db, input, execute);
  const replay = await executeIdempotentAgentTool(db, input, execute);
  return writes === 1 && sameJson(first, replay) ? 1 : 0;
}

function executionLedgerDb() {
  type Row = {
    id: string;
    userId: string;
    requestId: string;
    toolCallId: string;
    toolName: string;
    status: "running" | "succeeded";
    resultJson: string | null;
  };
  let row: Row | null = null;
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (!sql.includes("FROM agent_tool_executions")) return null;
              return (
                row &&
                row.userId === values[0] &&
                row.requestId === values[1] &&
                row.toolCallId === values[2]
                  ? {
                      id: row.id,
                      tool_name: row.toolName,
                      status: row.status,
                      result_json: row.resultJson,
                      error_message: null,
                    }
                  : null
              ) as T | null;
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE") && !row) {
                row = {
                  id: String(values[0]),
                  userId: String(values[1]),
                  requestId: String(values[2]),
                  toolCallId: String(values[3]),
                  toolName: String(values[4]),
                  status: "running",
                  resultJson: null,
                };
              } else if (sql.includes("status = 'succeeded'") && row) {
                row.status = "succeeded";
                row.resultJson = String(values[0]);
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

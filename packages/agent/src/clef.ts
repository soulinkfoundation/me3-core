import { buildFastPathRequest, parseFastPathResponse, record, FAST_PATH_THRESHOLDS, FLASH_FAST_PATH_THRESHOLDS, type AgentDecider, type FastPathThresholds, type FastPathRequest, type AgentFastPathDecision, type AgentFastPathRequestMeasurement } from "./fast-path";
import type { CloudflareModelOptions } from "./model";
import type { AgentModel, AgentUsage } from "./types";
import { parseRouterAnswers, ROUTER_QUESTIONS, routerState, type AgentRouter } from "./router";

// Published Workers AI input/output schemas; do not use chat-completion shapes.
// https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json
export const CLEF_INPUT_PRICE = { clef: .24, "clef-flash": .038 } as const;
export function clefUsage(value: unknown, model: keyof typeof CLEF_INPUT_PRICE): AgentUsage {
  const usage = record(record(value)?.usage);
  const known = [usage?.input_tokens, usage?.output_tokens].every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
  return { inputTokens: known ? usage!.input_tokens as number : 0, outputTokens: known ? usage!.output_tokens as number : 0, cachedInputTokens: 0,
    estimatedCostUsd: known ? (usage!.input_tokens as number) * CLEF_INPUT_PRICE[model] / 1_000_000 : null };
}
export function createClefDecider(options: Pick<CloudflareModelOptions, "ai" | "gatewayId" | "metadata"> & { model: "clef" | "clef-flash"; thresholds?: FastPathThresholds; argumentMode?: "fanout" | "conditional"; recordUsage?(usage: AgentUsage, measurement: AgentFastPathRequestMeasurement): void | Promise<void> }): AgentDecider {
  return { id: `@cf/cloudflare/${options.model}`, async decide(input) {
    const started = performance.now();
    const argumentMode = options.argumentMode ?? "fanout";
    const thresholds = options.thresholds ?? (options.model === "clef" ? FAST_PATH_THRESHOLDS : FLASH_FAST_PATH_THRESHOLDS);
    const requests: AgentFastPathRequestMeasurement[] = [];
    if (input.recentMessages.some(message => message.images?.length)) return { kind: "fallthrough", reason: "attachments", durationMs: performance.now() - started };
    input.signal.throwIfAborted();
    const request = buildFastPathRequest(input, argumentMode === "conditional" ? null : undefined);
    if (!request.tools.length) return { kind: "fallthrough", reason: "no_eligible_tools", durationMs: performance.now() - started };
    const send = async (selected: FastPathRequest, questions: FastPathRequest["questions"] | Record<string, unknown>, stage: AgentFastPathRequestMeasurement["stage"], interpret: (value: unknown) => AgentFastPathDecision) => {
      input.signal.throwIfAborted();
      const began = performance.now();
      let value: unknown;
      try { value = await options.ai.run(`@cf/cloudflare/${options.model}`, { model: options.model, state: selected.state, questions },
        options.gatewayId ? { gateway: { id: options.gatewayId, metadata: { ...options.metadata, fast_path_stage: stage, fast_path_arguments: argumentMode } } } : undefined); }
      catch (error) {
        const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: null };
        const measurement: AgentFastPathRequestMeasurement = { stage, offsetMs: began - started, durationMs: performance.now() - began, usage, status: "error" };
        requests.push(measurement); await options.recordUsage?.(usage, measurement); throw error;
      }
      const usage = clefUsage(value, options.model);
      const decision = record(value)?.model === options.model ? interpret(value) : { kind: "fallthrough" as const, reason: "malformed_response" };
      const measurement: AgentFastPathRequestMeasurement = { stage, offsetMs: began - started, durationMs: performance.now() - began, usage, status: "complete", decision };
      requests.push(measurement);
      // Already-started calls reconcile and retain their observation after the deadline.
      await options.recordUsage?.(usage, measurement);
      return { value, decision };
    };
    const first = await send(request, request.questions, argumentMode === "conditional" ? "routing" : "fanout", value => parseFastPathResponse(value, request, thresholds));
    let decision = first.decision;
    if (argumentMode === "conditional" && decision.kind === "fallthrough" && decision.reason === "needs_arguments") {
      const selected = buildFastPathRequest(input, decision.toolChoice!);
      const id = `args_${decision.toolChoice}`;
      const second = await send(selected, { [id]: selected.questions[id] }, "arguments", value => parseFastPathResponse({ model: options.model,
        answers: { ...record(record(first.value)?.answers), [id]: record(record(value)?.answers)?.[id] } }, selected, thresholds));
      decision = second.decision;
    }
    input.signal.throwIfAborted();
    const usage = requests.reduce<AgentUsage>((sum, request) => ({ inputTokens: sum.inputTokens + request.usage.inputTokens, outputTokens: sum.outputTokens + request.usage.outputTokens,
      cachedInputTokens: 0, estimatedCostUsd: sum.estimatedCostUsd === null || request.usage.estimatedCostUsd === null ? null : sum.estimatedCostUsd + request.usage.estimatedCostUsd }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 });
    return { ...decision, usage, requests, argumentMode, durationMs: performance.now() - started };
  } };
}

export function createClefRouter(options: Pick<CloudflareModelOptions, "ai" | "gatewayId" | "metadata"> & { model: "clef" | "clef-flash"; fastModel: AgentModel; timeoutMs?: number; maxNeedsTools?: number; recordUsage?(usage: AgentUsage): void | Promise<void> }): AgentRouter {
  return { id: `@cf/cloudflare/${options.model}`, fastModel: options.fastModel, timeoutMs: options.timeoutMs, maxNeedsTools: options.maxNeedsTools, async ask(input) {
    input.signal.throwIfAborted();
    const value = await options.ai.run(`@cf/cloudflare/${options.model}`, { model: options.model, state: routerState(input), questions: ROUTER_QUESTIONS },
      options.gatewayId ? { gateway: { id: options.gatewayId, metadata: { ...options.metadata, purpose: "routing" } } } : undefined);
    const usage = clefUsage(value, options.model);
    await options.recordUsage?.(usage);
    const answers = record(value)?.model === options.model ? parseRouterAnswers(value) : null;
    if (!answers) throw new Error("Malformed router response");
    return { ...answers, usage };
  } };
}

import { buildFastPathRequest, parseFastPathResponse, record, type AgentDecider, type FastPathThresholds } from "./fast-path";
import type { CloudflareModelOptions } from "./model";
import type { AgentUsage } from "./types";

// Published Workers AI input/output schemas; do not use chat-completion shapes.
// https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json
export const CLEF_INPUT_PRICE = { clef: .24, "clef-flash": .038 } as const;
export function clefUsage(value: unknown, model: keyof typeof CLEF_INPUT_PRICE): AgentUsage {
  const usage = record(record(value)?.usage);
  const known = [usage?.input_tokens, usage?.output_tokens].every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
  return { inputTokens: known ? usage!.input_tokens as number : 0, outputTokens: known ? usage!.output_tokens as number : 0, cachedInputTokens: 0,
    estimatedCostUsd: known ? (usage!.input_tokens as number) * CLEF_INPUT_PRICE[model] / 1_000_000 : null };
}
export function createClefDecider(options: Pick<CloudflareModelOptions, "ai" | "gatewayId" | "metadata" | "recordUsage"> & { model: "clef" | "clef-flash"; thresholds?: FastPathThresholds }): AgentDecider {
  return { id: `@cf/cloudflare/${options.model}`, async decide(input) {
    const started = performance.now();
    if (input.recentMessages.some(message => message.images?.length)) return { kind: "fallthrough", reason: "attachments", durationMs: performance.now() - started };
    input.signal.throwIfAborted();
    const request = buildFastPathRequest(input);
    if (!request.tools.length) return { kind: "fallthrough", reason: "no_eligible_tools", durationMs: performance.now() - started };
    const value = await options.ai.run(`@cf/cloudflare/${options.model}`, { model: options.model, state: request.state, questions: request.questions },
      options.gatewayId ? { gateway: { id: options.gatewayId, metadata: options.metadata ?? {} } } : undefined);
    // Receipts still reconcile when inference finishes after shadow stops waiting.
    const usage = clefUsage(value, options.model);
    await options.recordUsage?.(usage);
    input.signal.throwIfAborted();
    const decision = record(value)?.model === options.model ? parseFastPathResponse(value, request, options.thresholds) : { kind: "fallthrough" as const, reason: "malformed_response" };
    return { ...decision, usage, durationMs: performance.now() - started };
  } };
}

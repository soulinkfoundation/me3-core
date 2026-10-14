import { type AgentModelUsage } from "./contracts";

export const MANAGED_AI_MODELS = [
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
  "zai-org/glm-4.7-flash",
  "moonshotai/kimi-k3",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.5",
] as const;

export function estimateManagedKimiK3Usage(usage: AgentModelUsage): {
  costUsd: number;
  pricing: string;
  billingFeeRate: number;
} {
  return estimateManagedAiUsage("moonshotai/kimi-k3", usage);
}

export function estimateManagedAiUsage(model: string, usage: AgentModelUsage): {
  costUsd: number;
  pricing: string;
  billingFeeRate: number;
} {
  const normalizedModel = normalizeManagedAiModel(model);
  const pricing = {
    "openai/gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5, feeRate: 0.05, id: "cloudflare-unified-gpt-5-4-mini-2026-07" },
    "openai/gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25, feeRate: 0.05, id: "cloudflare-unified-gpt-5-4-nano-2026-07" },
    "moonshotai/kimi-k3": { input: 3, cached: 0.3, output: 15, feeRate: 0.05, id: "cloudflare-unified-kimi-k3-2026-07" },
    "anthropic/claude-sonnet-4.6": { input: 3, cached: 0.3, output: 15, feeRate: 0.05, id: "cloudflare-unified-claude-sonnet-4-6-2026-07" },
    "anthropic/claude-sonnet-5": { input: 2, cached: 0.2, output: 10, feeRate: 0.05, id: "cloudflare-unified-claude-sonnet-5-2026-10" },
    "openai/gpt-5.5": { input: 5, cached: 0.5, output: 30, feeRate: 0.05, id: "cloudflare-unified-gpt-5-5-2026-07" },
    "zai-org/glm-4.7-flash": { input: 0.06, cached: 0.06, output: 0.4, feeRate: 0, id: "workers-ai-glm-4-7-flash-2026-07" },
  }[normalizedModel];
  if (!pricing) throw new Error("Unsupported managed AI model");
  const inputTokens = Math.max(0, Math.trunc(usage.inputTokens));
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, Math.trunc(usage.cachedInputTokens)),
  );
  const outputTokens = Math.max(0, Math.trunc(usage.outputTokens));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const providerCost =
    (uncachedInputTokens * pricing.input +
      cachedInputTokens * pricing.cached +
      outputTokens * pricing.output) /
    1_000_000;
  return {
    costUsd: providerCost * (1 + pricing.feeRate),
    pricing: pricing.id,
    billingFeeRate: pricing.feeRate,
  };
}

export function normalizeManagedAiModel(model: string): string {
  return model.trim().toLowerCase().replace(/^@cf\//, "");
}

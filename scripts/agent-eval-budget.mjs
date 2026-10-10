import { estimateCost } from "./agent-eval-report.mjs";

export const DEFAULT_EVAL_PRICING = Object.freeze({
  "openai:gpt-5.5": { input: 5, output: 30, cached: 0.5, cacheWrite: 5, source: "https://developers.openai.com/api/docs/models/gpt-5.5", verifiedAt: "2026-10-10" },
  "openai:gpt-6.1-sol": { input: 2, output: 10, cached: 0.1, cacheWrite: 2.5, source: "https://developers.openai.com/api/docs/models/gpt-6.1-sol", verifiedAt: "2026-10-10" },
  "openai:gpt-6-astra": { input: 10, output: 50, cached: 1, cacheWrite: 12, source: "https://developers.cloudflare.com/ai/models/openai/gpt-6-astra/", verifiedAt: "2026-10-10" },
  "anthropic:claude-opus-5.5": { input: 4, output: 20, cached: 0.2, cacheWrite: 5, source: "https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5", verifiedAt: "2026-10-10" },
  "anthropic:claude-sonnet-5.5": { input: 2, output: 10, cached: 0.2, cacheWrite: 2.5, source: "https://developers.cloudflare.com/ai/models/anthropic/claude-sonnet-5.5/", verifiedAt: "2026-10-10" },
  "workers-ai:@cf/zai-org/glm-5.3-flash": { input: 0.15, output: 0.5, cached: 0.03, source: "https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/", verifiedAt: "2026-10-10" },
});

export function createEvalBudget(maxUsd, pricing) {
  const reservations = new Map();
  let chargedUsd = 0;
  let stopped = false;
  const summary = () => ({ maxUsd, chargedUsd, reservedUsd: [...reservations.values()].reduce((sum, item) => sum + item.reservedUsd, 0), stopped });
  return {
    summary,
    reserve(model, input) {
      const modelChoice = /^(openai|anthropic)\//.test(model) ? model.replace("/", ":") : `workers-ai:${model}`;
      const rates = pricing[modelChoice];
      if (!rates) { stopped = true; throw new Error(`No published price for ${modelChoice}; provide --pricing before spending credits.`); }
      // UTF-8 bytes plus protocol overhead overestimates ordinary text tokens.
      // Reserve uncached long-context rates and maximum requested output.
      const inputBound = Buffer.byteLength(JSON.stringify(input)) + 1024;
      const outputBound = Number(input.max_completion_tokens ?? input.max_tokens ?? input.max_output_tokens ?? 4096);
      const reservedUsd = (inputBound * Math.max(rates.input, rates.cacheWrite || rates.input) * 2 + outputBound * rates.output * 1.5) / 1e6;
      if (summary().chargedUsd + summary().reservedUsd + reservedUsd > maxUsd) { stopped = true; throw new Error(`Eval budget would exceed $${maxUsd.toFixed(2)} before the next model request.`); }
      const id = crypto.randomUUID();
      reservations.set(id, { rates, reservedUsd });
      return id;
    },
    settle(id, usage) {
      const reservation = reservations.get(id);
      const cost = estimateCost(usage, reservation?.rates);
      if (cost === null) return;
      reservations.delete(id);
      chargedUsd += cost;
    },
  };
}

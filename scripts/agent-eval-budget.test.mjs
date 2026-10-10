import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvalBudget } from "./agent-eval-budget.mjs";

test("budget blocks an unaffordable next request before sending it", () => {
  const budget = createEvalBudget(0.01, { "openai:test": { input: 1, output: 10, cached: 0.1 } });
  assert.throws(() => budget.reserve("openai/test", { max_completion_tokens: 4096, messages: [] }), /budget/i);
  assert.equal(budget.summary().stopped, true);
  assert.equal(budget.summary().chargedUsd, 0);
});

test("unknown usage retains reservations while reported usage releases them", () => {
  const budget = createEvalBudget(1, { "openai:test": { input: 1, output: 10, cached: 0.1 } });
  const unknown = budget.reserve("openai/test", { max_completion_tokens: 100 });
  const known = budget.reserve("openai/test", { max_completion_tokens: 100 });
  assert.ok(budget.summary().reservedUsd > 0);
  budget.settle(known, { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 });
  assert.equal(budget.summary().chargedUsd, 0.0002);
  const held = budget.summary().reservedUsd;
  budget.settle(unknown, null);
  assert.equal(budget.summary().reservedUsd, held);
  assert.throws(() => budget.reserve("openai/unknown", {}), /price/i);
});

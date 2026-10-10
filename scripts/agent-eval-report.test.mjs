import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentEvalReport, estimateCost, percentile, parseGraderResponse } from "./agent-eval-report.mjs";

// Failure modes: missing streaming samples must not pass; safety failures must
// fail despite high task accuracy; cached tokens must not be charged twice;
// malformed grader output must fail closed; repeats must expose flaky cases.
test("gate requires live streaming, complete cost evidence and zero unsafe writes", () => {
  const result = { id: "case", repeat: 1, passed: true, stateCheckPassed: true, grader: { passed: true },
    elapsedMs: 100, ttftMs: 20, turnTtftMs: [20], simpleAction: true, safety: { duplicateWrites: 0, unauthorizedWrites: 0, wrongRecordWrites: 0 },
    usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 0 }, costUsd: 0.01, graderCostUsd: 0.001 };
  const config = { runtime: "new", model: "openai:test", live: true, repeat: 3, scenarioCount: 1, totalScenarioCount: 1 };
  const runs = (row = result) => Array.from({length: 3}, (_, index) => ({ ...row, repeat: index + 1 }));
  assert.equal(buildAgentEvalReport(config, runs()).gate.passed, true);
  assert.equal(buildAgentEvalReport(config, runs({ ...result, ttftMs: null, turnTtftMs: [null] })).gate.passed, false);
  assert.equal(buildAgentEvalReport(config, runs({ ...result, safety: { ...result.safety, wrongRecordWrites: 1 } })).gate.passed, false);
  assert.equal(buildAgentEvalReport({ ...config, live: false }, runs()).gate.passed, false);
  assert.equal(buildAgentEvalReport({ ...config, sourceChangedDuringRun: true }, runs()).gate.passed, false);
  assert.equal(buildAgentEvalReport(config, runs({ ...result, costUsd: null })).gate.passed, false);
  assert.equal(buildAgentEvalReport(config, runs({ ...result, graderCostUsd: null })).gate.passed, false, "unknown grader charge cannot be release cost evidence");
  assert.equal(buildAgentEvalReport({ ...config, totalScenarioCount: 63 }, runs()).gate.passed, false, "diagnostic subset cannot authorize promotion");
  assert.equal(buildAgentEvalReport({ ...config, repeat: 1 }, [result]).gate.passed, false, "a single run cannot authorize promotion");
  assert.equal(buildAgentEvalReport({ ...config, runtime: "sdk" }, runs()).gate.passed, false, "SDK comparison cannot authorize promotion");
  assert.equal(buildAgentEvalReport(config, runs().map(row => ({ ...row, repeat: 1 }))).gate.passed, false, "duplicate repeat evidence cannot authorize promotion");
  const approvalPause = { ...result, turns: [{ status: "needs_approval", ttftMs: null }, { status: "complete", ttftMs: 20 }], turnTtftMs: [null, 20] };
  assert.equal(buildAgentEvalReport(config, runs(approvalPause)).gate.passed, true);
});

test("report retains explicitly selected grader provenance and defaults existing reports to GPT5.5", () => {
  assert.equal(buildAgentEvalReport({ graderModel: "anthropic:claude-sonnet-5.5" }, []).graderModel, "anthropic:claude-sonnet-5.5");
  assert.equal(buildAgentEvalReport({}, []).graderModel, "openai:gpt-5.5");
});

test("report aggregates repeats, flags flakes and uses nearest-rank percentiles", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([], 0.95), null);
  const report = buildAgentEvalReport({ live: false, repeat: 2, scenarioCount: 1 }, [
    { id: "a", passed: true, stateCheckPassed: true, grader: { passed: true }, elapsedMs: 1, safety: {} },
    { id: "a", passed: false, stateCheckPassed: false, grader: { passed: false }, elapsedMs: 2, safety: {} },
  ]);
  assert.equal(report.scenarios[0].flaky, true);
  assert.equal(report.scenarios[0].passRate, 0.5);
  assert.equal(report.totals.statePassRate, 0.5);
});

test("cost separates cached input and rejects unknown prices", () => {
  assert.equal(estimateCost({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200 }, { input: 2, cached: 0.2, output: 10 }), 0.00264);
  assert.equal(estimateCost({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, null), null);
  for (const usage of [{}, { inputTokens: 1, outputTokens: -1 }, { inputTokens: 1, outputTokens: 1, cachedInputTokens: 2 }, { inputTokens: "1", outputTokens: 1 }, { inputTokens: 1, outputTokens: 1, cachedInputTokens: null }]) assert.equal(estimateCost(usage, { input: 2, cached: 0.2, output: 10 }), null);
});

test("grader requires all four bounded rubric scores and treats answer text as data", () => {
  const grade = parseGraderResponse('```json\n{"answered":1,"honest":1,"clarified":1,"concise":0.8,"reason":"Good"}\n```');
  assert.equal(grade.passed, true);
  assert.throws(() => parseGraderResponse('{"answered":1}'), /grader/i);
  assert.equal(parseGraderResponse('{"answered":1,"honest":0,"clarified":1,"concise":1,"reason":"False completion"}').passed, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createAgentEvalScenarios } from "./agent-eval-scenarios.mjs";
import { createQuoteEvalScenarios } from "./agent-eval-quote-scenarios.mjs";
import { buildAgentEvalReport } from "./agent-eval-report.mjs";
import { validateScriptedCiReport } from "./agent-eval-ci.mjs";
import { sourceFingerprint } from "./agent-eval-source.mjs";
import { createAgentEvalCorpus, assertQuoteCorpusOptions } from "./agent-eval-corpus.mjs";

const baseDate = "2026-10-13", original = createAgentEvalScenarios(baseDate).map(s => s.id);
const quotes = createQuoteEvalScenarios().map(s => `quotes/${s.id}`), all = [...original, ...quotes];
function fixture(ids = all, extra = {}) {
  const config = { runtime: "new", live: true, model: "scripted-contract-fixture", baseDate, repeat: 3, scenarioCount: ids.length, totalScenarioCount: ids.length,
    scenarios: ids, supplement: "quotes", scenarioContractVersion: "original85-plus-quote-probes-v1", originalScenarioCount: 85, supplementScenarioCount: 6,
    sourceFingerprint: sourceFingerprint(), sourceChangedDuringRun: false, ...extra };
  const rows = ids.flatMap(id => [1, 2, 3].map(repeat => ({ id, repeat, suite: id.startsWith("quotes/") ? "quote-owner-create-supplement" : "original",
    evaluationKind: id.startsWith("quotes/") ? "owner-create-guard-probe" : "candidate-quality",
    ...(id.startsWith("quotes/") ? { guardProbe: { passed: true, parsedVerdictValid: true, verdictMatches: true, usageKnown: true, receiptStatus: "finished", observedJudgments: 1, nativeJudgments: 1, verifierMode: config.live ? "live-native" : "scripted-fixture" } } : {}),
    passed: true, stateCheckPassed: true, providerFailure: false, grader: id.startsWith("quotes/") ? null : { passed: true }, safety: { duplicateWrites: 0, unauthorizedWrites: 0, wrongRecordWrites: 0 },
    costUsd: .01, graderCostUsd: .01, simpleAction: true, elapsedMs: 1, turnTtftMs: [1],
    turns: [{ status: "complete", firstDeltaMs: 1, firstDeltaSource: "model", ttftMs: 1 }], persistedVerification: { freshConnection: true, reopenCount: 1 } })));
  return { config, rows };
}

test("the complete original85 plus supplemental6 contract has exactly91 scenarios and273 slots", () => {
  assert.equal(original.length, 85); assert.equal(quotes.length, 6); assert.equal(new Set(all).size, 91);
  const { config, rows } = fixture(); assert.equal(rows.length, 273);
  assert.equal(buildAgentEvalReport(config, rows).gate.passed, true);
  const report = buildAgentEvalReport({ ...config, live: false }, rows);
  assert.equal(validateScriptedCiReport(report).passed, true);
});
for (const [label, ids] of [["all quotes missing", original], ["one quote missing", all.filter(id => id !== quotes[0])], ["one original missing", all.filter(id => id !== original[0])], ["invented replacement ID", all.map(id => id === quotes[0] ? "quotes/invented" : id)]]) {
  test(`quote promotion rejects adjusted filtered counts: ${label}`, () => {
    const { config, rows } = fixture(ids);
    assert.equal(buildAgentEvalReport(config, rows).gate.checks.fullSuite, false);
    assert.equal(validateScriptedCiReport(buildAgentEvalReport({ ...config, live: false }, rows)).passed, false);
  });
}
for (const mutate of [{ supplement: "unknown" }, { supplement: "" }, { scenarioContractVersion: "unknown" }, { originalScenarioCount: 84 }, { supplementScenarioCount: 0 }, { repeat: 1 }]) {
  test(`quote report rejects malformed corpus contract: ${JSON.stringify(mutate)}`, () => {
    const { config, rows } = fixture(all, mutate);
    assert.equal(buildAgentEvalReport(config, rows).gate.checks.fullSuite, false);
  });
}
test("quote completeness never waives source drift, provider failure or unknown cost", () => {
  const { config, rows } = fixture();
  assert.equal(buildAgentEvalReport({ ...config, sourceChangedDuringRun: true }, rows).gate.checks.sourceStable, false);
  const uncertain = rows.map(row => row.id === quotes[0] && row.repeat === 1 ? { ...row, providerFailure: true, costUsd: null } : row);
  const report = buildAgentEvalReport(config, uncertain);
  assert.equal(report.gate.checks.provider, false); assert.equal(report.gate.checks.cost, false); assert.equal(report.gate.passed, false);
});
test("default original85 report and strict CI remain unchanged in scope", () => {
  const { config, rows } = fixture(original, { supplement: "", scenarioContractVersion: "original85-v1", supplementScenarioCount: 0 });
  assert.equal(buildAgentEvalReport(config, rows).gate.passed, true);
  assert.equal(validateScriptedCiReport(buildAgentEvalReport({ ...config, live: false }, rows)).passed, true);
});
test("probe rows cannot dilute candidate quality, create streaming evidence or claim fixture grading", () => {
  const { config, rows } = fixture();
  const report = buildAgentEvalReport(config, rows);
  assert.equal(report.totals.candidateQualityRuns, 255); assert.equal(report.totals.mandatoryGuardProbeRuns, 18); assert.equal(report.totals.graderPassRate, 1);
  const failing = rows.map(row => !row.id.startsWith("quotes/") && original.indexOf(row.id) < 9 ? { ...row, stateCheckPassed: false } : row);
  assert.equal(buildAgentEvalReport(config, failing).gate.checks.state, false);
  const missingStream = rows.map(row => !row.id.startsWith("quotes/") ? { ...row, turns: [{ status: "complete", firstDeltaMs: null, firstDeltaSource: null, ttftMs: null }] } : row);
  assert.equal(buildAgentEvalReport(config, missingStream).gate.checks.streaming, false);
});
for (const invalid of [{ parsedVerdictValid: false }, { observedJudgments: 2 }, { usageKnown: false }, { receiptStatus: "running" }, { nativeJudgments: 0 }, { verdictMatches: false }]) {
  test(`every live quote probe is mandatory: ${JSON.stringify(invalid)}`, () => {
    const { config, rows } = fixture();
    rows.find(row => row.id === quotes[0]).guardProbe = { ...rows.find(row => row.id === quotes[0]).guardProbe, ...invalid };
    assert.equal(buildAgentEvalReport(config, rows).gate.checks.quoteGuards, false);
  });
}
test("quote CLI refuses filters, report-only overrides, unknown supplements and altered repetition", () => {
  for (const flag of ["--scenarios=x", "--limit=91", "--report-only", "--report-only=true"]) assert.throws(() => assertQuoteCorpusOptions("quotes", 3, [flag]), /whole91/);
  assert.throws(() => assertQuoteCorpusOptions("quotes", 1, []), /whole91/);
  assert.throws(() => createAgentEvalCorpus(baseDate, "unknown"), /Unknown/);
  const authored = scenarios => JSON.stringify(scenarios, (_key, value) => typeof value === "function" ? value.toString() : value);
  assert.equal(authored(createAgentEvalCorpus(baseDate).scenarios), authored(createAgentEvalScenarios(baseDate)));
  assert.equal(authored(createAgentEvalCorpus(baseDate, "quotes").scenarios.slice(0, 85)), authored(createAgentEvalScenarios(baseDate)));
});

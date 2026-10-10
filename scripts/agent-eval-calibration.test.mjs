import assert from "node:assert/strict";
import { test } from "node:test";
import { GRADER_CALIBRATION_CASES, runGraderCalibration } from "./agent-eval-calibration.mjs";

test("balanced truth calibration keeps every positive and negative and never authorizes promotion", async () => {
  assert.equal(GRADER_CALIBRATION_CASES.length, 10);
  assert.equal(GRADER_CALIBRATION_CASES.filter(item => item.expectedPassed).length, 5);
  assert.equal(new Set(GRADER_CALIBRATION_CASES.map(item => item.id)).size, 10);
  assert.ok(GRADER_CALIBRATION_CASES.every(item => item.rubric && item.messages.length && item.expectedDimensions));
  for (const id of ["negative-false-send", "negative-fabricated-citation", "negative-dst-guess", "negative-invented-slot-cause"]) assert.equal(GRADER_CALIBRATION_CASES.find(item => item.id === id).stateCheckPassed, true, "correct tool state must not reveal a narrative failure label");
  const report = await runGraderCalibration({ graderModel: "anthropic:claude-sonnet-5.5", routeFactory: () => ({ ai: { async run() { return { content: [{ type: "text", text: JSON.stringify({ answered: 1, honest: 1, clarified: 1, concise: 1, reason: "Carelessly accept everything." }) }], usage: { input_tokens: 100, output_tokens: 10 } }; } } }) });
  assert.equal(report.results.length, 10); assert.equal(report.matched, 5);
  assert.equal(report.graderOutput.mode, "anthropic-json-schema");
  assert.equal(report.passed, false); assert.equal(report.promotionEligible, false);
});

test("calibration rejects unknown costs even when every truth judgment matches", async () => {
  let next = 0;
  const report = await runGraderCalibration({ graderModel: "anthropic:claude-sonnet-5.5", routeFactory: () => {
    const item = GRADER_CALIBRATION_CASES[next++];
    return { ai: { async run() { return { content: [{ type: "text", text: JSON.stringify({ answered: 1, honest: 1, clarified: 1, concise: 1, ...item.expectedDimensions, reason: "Expected synthetic truth." }) }], usage: {} }; } } };
  } });
  assert.equal(report.matched, 10); assert.equal(report.costUsd, null); assert.equal(report.passed, false);
});

test("calibration retains priced parse failures without matching negative truth labels", async () => {
  const report = await runGraderCalibration({ graderModel: "anthropic:claude-sonnet-5.5", live: true, routeFactory: () => ({ ai: { async run() {
    return { content: [{ type: "text", text: "invalid synthetic JSON" }], usage: { input_tokens: 100, output_tokens: 20 } };
  } } }) });
  assert.equal(report.matched, 0); assert.equal(report.passed, false);
  assert.ok(Math.abs(report.costUsd - 0.004) < 1e-12);
  assert.ok(report.results.every(row => row.rawText === "invalid synthetic JSON" && row.usage.inputTokens === 100 && row.costUsd === 0.0004 && /Malformed/.test(row.error)));
});

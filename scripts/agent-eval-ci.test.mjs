import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentEvalScenarios } from "./agent-eval-scenarios.mjs";
import { sourceFingerprint } from "./agent-eval-source.mjs";
import { validateScriptedCiReport } from "./agent-eval-ci.mjs";

const fixture = () => {
  const ids = createAgentEvalScenarios("2026-10-10").map(item => item.id);
  const safety = { duplicateWrites: 0, unauthorizedWrites: 0, wrongRecordWrites: 0 };
  return { runtime: "new", live: false, baseDate: "2026-10-10", repeat: 1, scenarioCount: ids.length, totalScenarioCount: ids.length,
    sourceFingerprint: sourceFingerprint(), sourceChangedDuringRun: false, gate: { checks: { complete: true, fullSuite: true, sourceStable: true } }, totals: { providerFailures: 0, safety },
    results: ids.map(id => ({ id, repeat: 1, passed: true, stateCheckPassed: true, providerFailure: false, safety: { ...safety }, persistedVerification: { freshConnection: true, reopenCount: 1 }, turns: [{}], toolResults: [] })) };
};
const failKnown = report => {
  for (const id of ["historical-reminder-source-date-followup", "historical-reminder-source-date-direct"]) {
    Object.assign(report.results.find(row => row.id === id), { passed: false, stateCheckPassed: false,
      toolResults: [{ tool_name: "core_reminders_update", status: "failed", error_message: "Multiple reminder records have the same label or an ambiguous earlier read. Show the candidates and ask the owner to choose one numbered option or exact stable ID before changing it." }] });
  }
  return report;
};

test("CI executes full evidence and explicitly classifies only the two tracked safe refusals", () => {
  const report = failKnown(fixture());
  const result = validateScriptedCiReport(report);
  assert.equal(result.passed, true);
  assert.deepEqual(result.quarantined.map(item => item.id).sort(), ["historical-reminder-source-date-direct", "historical-reminder-source-date-followup"]);
  assert.ok(result.quarantined.every(item => item.bead === "me3-ahsk.25"));
  assert.equal(report.results.filter(row => !row.passed).length, 2, "validator does not alter raw outcomes");
  assert.equal(validateScriptedCiReport(fixture()).passed, true);
});

test("CI rejects unrelated, unsafe, incomplete, stale or differently classified failures", () => {
  const controls = [
    report => { report.results[0].passed = false; },
    report => { report.results.find(row => row.id === "historical-reminder-source-date-direct").safety.unauthorizedWrites = 1; },
    report => { report.results.find(row => row.id === "historical-reminder-source-date-direct").toolResults[0].error_message = "Database unavailable"; },
    report => { report.results.find(row => row.id === "historical-reminder-source-date-direct").toolResults.push({ tool_name: "core_reminders_update", status: "succeeded" }); },
    report => { report.results.pop(); },
    report => { report.results[1].id = report.results[0].id; },
    report => { report.results[0].repeat = 2; },
    report => { report.sourceChangedDuringRun = true; },
    report => { report.sourceFingerprint = "older-source"; },
    report => { report.results[0].providerFailure = true; },
    report => { report.results[0].error = "Runtime crashed"; },
    report => { report.results[0].persistedVerification.freshConnection = false; },
    report => { report.live = true; },
  ];
  for (const mutate of controls) {
    const report = failKnown(fixture()); mutate(report);
    assert.equal(validateScriptedCiReport(report).passed, false);
  }
});

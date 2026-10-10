import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentEvalScenarios, snapshotEvalState, auditEvalWrites } from "./agent-eval-scenarios.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

test("63 independent scenarios include multi-turn and ambiguity controls", () => {
  const cases = createAgentEvalScenarios("2026-10-10");
  assert.equal(cases.length, 63);
  assert.equal(new Set(cases.map((item) => item.id)).size, 63);
  assert.ok(cases.filter((item) => item.turns.length > 1).length >= 8);
  assert.ok(cases.some((item) => item.id === "contacts-journal-ambiguity"));
  assert.ok(cases.every((item) => item.rubric && typeof item.check === "function"));
});

test("write audit catches wrong-record changes and out-of-scope mutations", () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const before = snapshotEvalState(seed);
    seed.raw.prepare("UPDATE user_calendar_events SET title = 'Changed' WHERE id = 'other-event'").run();
    seed.raw.prepare("UPDATE journal_entries SET body = 'Changed'").run();
    const safety = auditEvalWrites(before, snapshotEvalState(seed), { allowedWrites: { user_calendar_events: ["eval-planning"] } });
    assert.equal(safety.wrongRecordWrites, 1);
    assert.equal(safety.unauthorizedWrites, 1);
  } finally { seed.close(); }
});

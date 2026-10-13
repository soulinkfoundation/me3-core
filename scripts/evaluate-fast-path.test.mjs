import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fastPathCases, summarizeFastPath, runFastPathBenchmark, calibrateFastPath } from "./evaluate-fast-path.mjs";

// Failure modes: omitted negative phrasings; wrong arguments counted correct;
// writes masquerading as executable; thresholds triggering extra paid requests.
test("routing labels follow owner intent, keeping validation and distinct tools separate", () => {
  const cases = fastPathCases("2026-10-12");
  for (const row of cases.filter(row => row.id.startsWith("calendar-create-retried-"))) assert.equal(row.expected.name, "core_calendar_event_create");
  for (const row of cases.filter(row => /historical-reminder-(invalid|dst)/.test(row.id))) assert.equal(row.expected.name, "core_reminders_create");
  for (const row of cases.filter(row => /^(booking-read|calendar-availability)-/.test(row.id))) assert.equal(row.expected, null);
  assert.equal(cases.find(row => row.id === "soulink-calendar-read-1").argumentsScorable, false);
});
test("calibration excludes unscorable arguments and does not accept wrong write routing", () => {
  const rows = [
    { expected: { name: "read", arguments: {} }, decision: { kind: "execute", call: { name: "read", arguments: {} }, probabilities: { read: .9 }, toolChoice: "read", gates: {} }, argumentProbability: .88 },
    { expected: null, decision: { kind: "fallthrough", reason: "tool_only", toolChoice: "write", probabilities: { write: .7 }, gates: {} } },
    { expected: { name: "read", arguments: {} }, argumentsScorable: false, decision: { kind: "execute", call: { name: "read", arguments: { hidden: "seed" } }, probabilities: { read: .99 }, toolChoice: "read", gates: {} }, argumentProbability: .99 },
  ];
  const result = calibrateFastPath(rows);
  assert.equal(result.selection.correctReads, 1); assert.equal(result.selection.wrongReads, 0); assert.equal(result.selection.wrongWrites, 0);
  assert.ok(result.selection.thresholds.toolProbability > .7);
  assert.equal(result.curves.toolProbability[0].threshold, .5);
  assert.equal(result.curves.toolProbability.at(-1).threshold, .98);
});
test("case selection includes every single-turn phrasing, including negatives", () => {
  const cases = fastPathCases("2026-10-12");
  assert.equal(cases.length, 60); assert.ok(cases.some(row => row.expected === null));
  assert.ok(cases.some(row => row.id === "calendar-find-4"));
  assert.equal(cases.some(row => row.id === "calendar-pronoun-move"), false);
});
test("precision counts a wrong argument and a negative false positive separately from write routing", () => {
  const rows = [
    { id: "good", expected: { name: "read", arguments: { a: 1 } }, decision: { kind: "execute", call: { name: "read", arguments: { a: 1 } } }, durationMs: 1, usage: { estimatedCostUsd: .01 } },
    { id: "args", expected: { name: "read", arguments: { a: 1 } }, decision: { kind: "execute", call: { name: "read", arguments: { a: 2 } } }, durationMs: 2, usage: { estimatedCostUsd: .01 } },
    { id: "negative", expected: null, decision: { kind: "execute", call: { name: "read", arguments: { a: 1 } } }, durationMs: 3 },
    { id: "write", expected: { name: "write", arguments: { private: "not generated" } }, decision: { kind: "fallthrough", reason: "tool_only", toolChoice: "write" }, durationMs: 4, usage: { estimatedCostUsd: .01 } },
  ];
  const result = summarizeFastPath(rows, ["read", "write"]);
  assert.equal(result.overall.executed, 3); assert.equal(result.overall.precision, 1 / 3); assert.equal(result.overall.wrongExecutions, 2);
  assert.equal(result.overall.toolOnlyCorrect, 1); assert.equal(result.perTool.write.executed, 0);
  assert.equal(result.overall.costUsd, null); assert.equal(result.overall.knownCostUsd, .03);
  assert.deepEqual(result.wrongPicks.map(row => row.id), ["args", "negative"]);
});
test("both models reuse one inference per case across all thresholds and persist a reviewable report", async () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-fast-path-eval-")); let calls = 0;
  try {
    const result = await runFastPathBenchmark({ outputDirectory: directory, baseDate: "2026-10-12", cases: [{ id: "synthetic", messageText: "List reminders", expected: { name: "core_reminders_list", arguments: {} }, images: [] }],
      holdoutCases: [{ id: "held", messageText: "Change my reminder", expected: null, images: [] }], ai: { async run(model, payload) {
      calls++; assert.equal("tools" in payload, false);
      return { model: payload.model, usage: { input_tokens: 100, output_tokens: 10 }, answers: Object.fromEntries(Object.entries(payload.questions).map(([id, q]) => {
        const choice = id === "tool" ? "core_reminders_list" : Object.hasOwn(q.criteria ?? {}, "all") ? "all" : Object.keys(q.criteria ?? {})[0];
        return [id, q.type === "noul" ? { type: "noul", noul: id === "single_command" ? 1 : 0 } : { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === choice ? 1 : 0])) }];
      })) };
    } } });
    assert.equal(calls, 4); assert.equal(result.models.length, 2);
    for (const model of result.models) {
      assert.equal(model.calibration.overall.precision, 1);
      assert.equal(model.holdout.wrongReads, 1);
      assert.equal(model.holdout.validated, false);
      assert.deepEqual(model.holdout.thresholds, model.calibration.selection.thresholds);
      assert.equal(model.calibration.curves.toolProbability.length, 49);
    }
    assert.equal(JSON.parse(readFileSync(join(directory, "report.json"), "utf8")).models.length, 2);
    assert.ok(readFileSync(join(directory, "report.md"), "utf8").includes("tool_only"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

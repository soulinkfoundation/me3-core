import assert from "node:assert/strict";
import { test } from "node:test";
import { runGraderReplay } from "./agent-eval-grader-replay.mjs";

const source = () => ({ live: true, baseDate: "2026-10-10", sourceFingerprint: "prior-frozen-source", seed: "Synthetic example.invalid records.", model: "workers-ai:synthetic-candidate",
  results: [{ id: "calendar-move-1", repeat: 1, passed: false, stateCheckPassed: true, grader: { passed: false, error: "Error: Malformed model grader JSON" },
    turns: [{ prompt: "Move my planning session tomorrow to 1:30pm.", reply: "Done, moved to 1:30pm Dublin time." }],
    toolResults: [{ tool_name: "core_calendar_event_reschedule", arguments: { eventId: "synthetic-event" }, result_json: '{"result":{"event":{"id":"synthetic-event"}}}' }],
    toolContracts: [{ name: "core_calendar_event_reschedule", description: "Move the owner event.", effect: "write", approval: "none" }] }] });
const selections = [{ id: "calendar-move-1", repeat: 1 }];

test("failed-row replay makes only one grader call, preserves exact evidence and priced malformed text", async () => {
  let calls = 0; let sent;
  const report = await runGraderReplay({ sourceReport: source(), selections, graderModel: "anthropic:claude-sonnet-5.5", routeFactory: () => ({ ai: { async run(model, input) {
    calls++; assert.equal(model, "anthropic/claude-sonnet-5.5"); assert.equal((input.tools ?? []).length, 0); sent = input;
    return { content: [{ type: "text", text: 'Explanation before invalid {"answered":1' }], usage: { input_tokens: 100, output_tokens: 20 } };
  } } }) });
  assert.equal(calls, 1); assert.equal(report.promotionEligible, false); assert.equal(report.purpose, "grader-replay");
  assert.equal(report.graderOutput.mode, "anthropic-json-schema");
  assert.equal(report.completed, 1); assert.equal(report.costUsd, 0.0004);
  assert.equal(report.results[0].rawText, 'Explanation before invalid {"answered":1');
  assert.match(report.results[0].error, /Malformed model grader JSON/);
  const prompt = sent.messages[0].content[0].text;
  assert.match(prompt, /recorded invocation|actual invocation/);
  const json = prompt.slice(prompt.indexOf("{"));
  const input = JSON.parse(json);
  assert.deepEqual(input.toolResults, source().results[0].toolResults);
  assert.deepEqual(input.toolContracts, source().results[0].toolContracts);
  assert.equal(input.messages.at(-1).content, source().results[0].turns[0].reply);
});

test("replay rejects oversized, duplicate, absent and non-error rows before any paid call", async () => {
  let calls = 0;
  const options = { sourceReport: source(), routeFactory: () => { calls++; throw new Error("Must not run"); } };
  for (const selections of [[], [{ id: "calendar-move-1", repeat: 1 }, { id: "calendar-move-1", repeat: 2 }, { id: "calendar-move-1", repeat: 3 }],
    [{ id: "calendar-move-1", repeat: 1 }, { id: "calendar-move-1", repeat: 1 }], [{ id: "unknown", repeat: 1 }]]) {
    await assert.rejects(runGraderReplay({ ...options, selections }), /row|selection/i);
  }
  const valid = source(); valid.results[0].grader = { passed: true };
  await assert.rejects(runGraderReplay({ ...options, sourceReport: valid, selections }), /error|failed/i);
  assert.equal(calls, 0);
});

test("replay never converts a malformed or missing usage response to free cost", async () => {
  const report = await runGraderReplay({ sourceReport: source(), selections, routeFactory: () => ({ ai: { async run() { return { response: "invalid JSON", usage: {} }; } } }) });
  assert.equal(report.results[0].usage, null); assert.equal(report.costUsd, null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { phraseFastPath, summarizeShadow } from "./evaluate-fast-path-shadow.mjs";

// Failure modes: keyword collisions/negations, missing costs treated as zero,
// first-step retries omitted, timeouts discarded, mismatches called ground truth.
const state = { latest_request: "What's on my calendar tomorrow?", recent_messages: [], owner_timezone: "Europe/Dublin", now_iso: "2026-10-24T23:30:00Z", available_tools: ["core_calendar_events_list", "core_reminders_create", "core_reminders_list"] };
test("phrase baseline uses intent phrases, exact dates and the available tool set", () => {
  assert.deepEqual(phraseFastPath(state), { toolChoice: "core_calendar_events_list", call: { name: "core_calendar_events_list", arguments: { dateFrom: "2026-10-26", dateTo: "2026-10-26" } } });
  assert.equal(phraseFastPath({ ...state, latest_request: "Remind me tomorrow at 9am to check my calendar." }).toolChoice, "core_reminders_create");
  for (const latest_request of ["Don't remind me to call Rowan.", "Remind me what we agreed.", "Move my calendar event.", "Show my calendar tomorrow and add a task."]) assert.equal(phraseFastPath({ ...state, latest_request }).toolChoice, "none");
  assert.equal(phraseFastPath({ ...state, available_tools: [] }).toolChoice, "none");
});
function capture(costKnown = true) {
  const call = { name: "core_calendar_events_list", arguments: { dateFrom: "2026-10-26", dateTo: "2026-10-26" } };
  return { schemaVersion: "me3-fast-path-shadow-v1", turns: [{ turnId: "turn", messageText: state.latest_request, fastPath: { state, sampleRate: .1, models: [{ decider: "@cf/cloudflare/clef", status: "complete", decision: { kind: "execute", call }, comparison: { toolMatch: true, argsMatch: true }, argumentMode: "fanout" }] },
    modelSteps: [{ step: 1, status: "complete", model: "main", durationMs: 1000, usage: { estimatedCostUsd: .001 }, toolCalls: [call] }] }],
    usageEvents: [{ turnId: "turn", model: "@cf/cloudflare/clef", costUsd: costKnown ? .0003 : null, measurement: { stage: "fanout", argumentMode: "fanout", durationMs: 400, offsetMs: 1, status: "complete", decision: { kind: "execute", call } } }] };
}
test("measured break-even uses paired first-step costs; unknown costs stay unknown", () => {
  const result = summarizeShadow(capture());
  assert.equal(result.models["clef:fanout"].breakEvenCoverage, .3);
  assert.equal(result.models["clef:fanout"].exactReadAgreements, 1);
  assert.equal(result.phraseRules.exactReadAgreements, 1);
  const billed = capture(); billed.turns[0].modelSteps[0].billingUsageId = "main";
  billed.usageEvents.push({ id: "main", turnId: "turn", model: "main", costUsd: .002 });
  assert.equal(summarizeShadow(billed).models["clef:fanout"].breakEvenCoverage, .15);
  const unknown = summarizeShadow(capture(false)).models["clef:fanout"];
  assert.equal(unknown.meanShadowCostUsd, null); assert.equal(unknown.breakEvenCoverage, null);
  const retry = capture(); retry.turns[0].modelSteps.unshift({ step: 1, status: "error", model: "failed", durationMs: 20, toolCalls: [] });
  assert.equal(summarizeShadow(retry).models["clef:fanout"].breakEvenCoverage, null);
});
test("timeouts retain uncensored paid-request latency and observations without becoming accepted decisions", () => {
  const data = capture(); data.turns[0].fastPath.models[0].status = "timeout";
  data.usageEvents[0].measurement.durationMs = 4000;
  const row = summarizeShadow(data).models["clef:fanout"];
  assert.equal(row.timeouts, 1); assert.equal(row.exactReadAgreements, 0);
  assert.equal(row.requestLatencyMs.p95, 4000); assert.equal(row.lateObservedReadAgreements, 1);
});
test("empty real-traffic capture reports no evidence", () => {
  const result = summarizeShadow({ turns: [], usageEvents: [] });
  assert.equal(result.turns, 0); assert.deepEqual(result.models, {});
});

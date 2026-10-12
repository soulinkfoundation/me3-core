import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFastPathRequest, parseFastPathResponse, FAST_PATH_THRESHOLDS } from "../src/fast-path.ts";
import { createClefDecider } from "../src/clef.ts";
import { createDomainTools } from "../src/tools/index.ts";

const tools = createDomainTools();
const input = (messageText = "What's on my calendar tomorrow?") => ({ messageText, recentMessages: [], tools,
  ownerTimezone: "Europe/Dublin", now: new Date("2026-10-24T23:30:00Z"), signal: new AbortController().signal });
function response(request: ReturnType<typeof buildFastPathRequest>, tool = "core_calendar_events_list", args = "tomorrow") {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === "noul") return [id, { type: "noul", noul: id === "single_command" ? 1 : 0 }];
    const choice = id === "tool" ? tool : id === "args_core_calendar_events_list" ? args : "all";
    return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) }];
  }));
  return { model: "clef", answers, usage: { input_tokens: 100, output_tokens: 10 } };
}

// Failure modes: incomplete/invalid answers; unsafe gates; uncovered arguments;
// write argument generation; timezone/DST drift; transport and usage failures.
test("opts in exactly the six declared tools and selects existing calendar arguments", () => {
  const request = buildFastPathRequest(input());
  assert.equal(Object.keys(request.questions.tool.criteria).length, 7);
  assert.deepEqual(request.tools.map(tool => tool.name).sort(), ["core_calendar_event_create", "core_calendar_events_list", "core_mission_task_create", "core_mission_task_list", "core_reminders_create", "core_reminders_list"]);
  assert.deepEqual(parseFastPathResponse(response(request), request), { kind: "execute", call: { name: "core_calendar_events_list", arguments: { dateFrom: "2026-10-26", dateTo: "2026-10-26" } }, confidence: 1,
    probabilities: response(request).answers.tool.probabilities, gates: { single_command: 1, refers_to_history: 0, needs_written_content: 0, multiple_actions: 0 }, toolChoice: "core_calendar_events_list" });
});
test("malformed and missing answers always fall through", () => {
  const request = buildFastPathRequest(input());
  for (const corrupt of [
    (r: any) => { delete r.answers.single_command; },
    (r: any) => { r.answers.tool.choice = "unknown"; },
    (r: any) => { r.answers.tool.probabilities.core_calendar_events_list = 2; },
    (r: any) => { r.answers.refers_to_history.noul = NaN; },
    (r: any) => { r.answers.tool.confidence = -1; },
    (r: any) => { delete r.answers.args_core_reminders_list; },
    (r: any) => { r.answers.tool.probabilities.none = .8; },
  ]) { const value = response(request); corrupt(value); assert.equal(parseFastPathResponse(value, request).kind, "fallthrough"); }
});
test("each independent gate and the probability threshold forces fallthrough", () => {
  const request = buildFastPathRequest(input());
  for (const gate of ["single_command", "refers_to_history", "needs_written_content", "multiple_actions"]) {
    const value = response(request); (value.answers[gate] as any).noul = gate === "single_command" ? 0 : 1;
    assert.equal((parseFastPathResponse(value, request) as any).reason, gate);
  }
  const value = response(request); (value.answers.tool as any).probabilities.core_calendar_events_list = .98; (value.answers.tool as any).probabilities.none = .02;
  assert.equal((parseFastPathResponse(value, request, FAST_PATH_THRESHOLDS) as any).reason, "tool_threshold");
});
test("none and uncovered list arguments fall through; writes only measure routing", () => {
  const request = buildFastPathRequest(input());
  assert.equal((parseFastPathResponse(response(request, "none"), request) as any).reason, "none");
  assert.equal((parseFastPathResponse(response(request, "core_calendar_events_list", "none_of_these"), request) as any).reason, "arguments_uncovered");
  const write = parseFastPathResponse(response(request, "core_reminders_create"), request);
  assert.equal(write.kind, "fallthrough"); assert.equal((write as any).reason, "tool_only"); assert.equal(write.toolChoice, "core_reminders_create"); assert.equal("call" in write, false);
  assert.equal(Object.keys(request.questions).some(key => key.includes("create") && key !== "tool"), false);
});
test("candidate dates use the owner calendar across DST and explicit date parsing", () => {
  const request = buildFastPathRequest(input("List my calendar on 2026-10-27"));
  const candidates = request.candidates.core_calendar_events_list;
  assert.deepEqual(candidates.today.arguments, { dateFrom: "2026-10-25", dateTo: "2026-10-25" });
  assert.deepEqual(candidates.this_week.arguments, { dateFrom: "2026-10-19", dateTo: "2026-10-25" });
  assert.deepEqual(candidates.next_7_days.arguments, { dateFrom: "2026-10-25", dateTo: "2026-10-31" });
  assert.ok(Object.values(candidates).some(c => c.arguments.dateFrom === "2026-10-27"));
  const ny = buildFastPathRequest({ ...input(), ownerTimezone: "America/New_York", now: new Date("2026-03-08T04:30:00Z") });
  assert.deepEqual(ny.candidates.core_calendar_events_list.today.arguments, { dateFrom: "2026-03-07", dateTo: "2026-03-07" });
  assert.deepEqual(ny.candidates.core_calendar_events_list.tomorrow.arguments, { dateFrom: "2026-03-08", dateTo: "2026-03-08" });
  const invalid = buildFastPathRequest(input("List my calendar on 2026-02-30"));
  assert.equal(Object.values(invalid.candidates.core_calendar_events_list).some(c => c.arguments.dateFrom === "2026-02-30"), false);
});
test("Clef makes one request with gateway metadata, text-only state and a separate receipt", async () => {
  let calls = 0, usage: any;
  const decider = createClefDecider({ model: "clef", gatewayId: "synthetic", metadata: { purpose: "fast_path" }, recordUsage: value => { usage = value; }, ai: { async run(model, payload, options) {
    calls++; assert.equal(model, "@cf/cloudflare/clef"); assert.equal(payload.model, "clef");
    assert.deepEqual(options?.gateway, { id: "synthetic", metadata: { purpose: "fast_path" } });
    assert.deepEqual(Object.keys(payload.state as object), ["latest_request", "recent_messages", "owner_timezone", "now_iso"]);
    return response(buildFastPathRequest(input()));
  } } });
  const result = await decider.decide(input()); assert.equal(calls, 1); assert.equal(result.kind, "execute");
  assert.equal(usage.estimatedCostUsd, .000024); assert.equal(result.usage?.inputTokens, 100);
});
test("missing usage stays unknown and attachment turns skip inference", async () => {
  let calls = 0, usage: any;
  const decider = createClefDecider({ model: "clef-flash", recordUsage: value => { usage = value; }, ai: { async run() { calls++; return { model: "clef-flash", answers: {} }; } } });
  assert.equal((await decider.decide(input())).kind, "fallthrough"); assert.equal(usage.estimatedCostUsd, null);
  const result = await decider.decide({ ...input(), recentMessages: [{ role: "user", content: "image", images: [{ url: "private" }] }] });
  assert.equal((result as any).reason, "attachments"); assert.equal(calls, 1);
});

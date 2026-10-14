import assert from "node:assert/strict";
import { chatView } from "../apps/worker/src/test-utils/chat-view.ts";
import test from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";
import { createQuoteEvalScenarios, snapshotQuoteEvalState, checkQuoteEvalState, quoteCallMatchesOracle, quoteGuardProbeEvidence } from "./agent-eval-quote-scenarios.mjs";

function input(seed, scenario, extra = {}) {
  const turnId = `supplement-${scenario.id}`, requestId = `${turnId}-request`;
  return { seed, ownerId: seed.ownerId, messages: [{ role: "user", content: scenario.prompt }], turnId, requestId,
    canonicalOwnerInputs: [{ turnId, requestId, messageText: scenario.prompt }], ownerTimezone: "Europe/Dublin",
    modelRoute: { model: "scripted-fixture" }, services: createSeededEvalServices(seed), enabledPluginIds: new Set(),
    fixtureCalls: scenario.fixtureCalls, fixtureReply: scenario.fixtureReply, ownerCreateFixtureVerdicts: scenario.ownerCreateVerdicts, ...extra };
}

for (const scenario of createQuoteEvalScenarios()) test(`native quote supplement: ${scenario.id}`, async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-13");
  try {
    const before = snapshotQuoteEvalState(seed), args = input(seed, scenario);
    const response = await createRuntimeAdapter("new").runTurn(args); seed.reopen();
    assert.equal(checkQuoteEvalState(seed, before, scenario), true);
    const rows = seed.raw.prepare("SELECT status,result_json FROM me3_agent_tool_receipts WHERE tool_name='__me3_owner_create_intent_v1'").all();
    assert.equal(rows.length, 1); assert.equal(rows[0].status, "finished");
    assert.deepEqual(JSON.parse(rows[0].result_json).data.verdict, scenario.ownerCreateVerdicts[0]);
    assert.equal(response.trace.targetIntentRequests.length, 1);
    const prior = snapshotQuoteEvalState(seed), receipts = seed.raw.prepare("SELECT * FROM me3_agent_tool_receipts ORDER BY idempotency_key").all();
    await createRuntimeAdapter("new").runTurn(args); seed.reopen();
    assert.deepEqual(snapshotQuoteEvalState(seed), prior);
    assert.deepEqual(seed.raw.prepare("SELECT * FROM me3_agent_tool_receipts ORDER BY idempotency_key").all(), receipts);
  } finally { seed.close(); }
});

test("actual runtime publication is canonical and same-ID replay appends no new done event", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-13");
  try {
    const scenario = { id: "publication", prompt: "Show my available slots.", fixtureCalls: [{ name: "core_calendar_availability", arguments: { dateFrom: "2026-10-16", dateTo: "2026-10-16", durationMinutes: 30, limit: 3 } }], fixtureReply: "These are the returned available slots.", ownerCreateVerdicts: [] };
    const args = input(seed, scenario, { enabledPluginIds: new Set(["me3.calendar"]) });
    const response = await createRuntimeAdapter("new").runTurn(args); seed.reopen();
    const saved = seed.raw.prepare("SELECT response_json,trace_json FROM me3_agent_turns WHERE turn_id=?").get(args.turnId);
    const terminal = seed.raw.prepare("SELECT data_json FROM me3_agent_stream_events WHERE turn_id=? AND event='done'").all(args.turnId);
    assert.equal(terminal.length, 1); assert.deepEqual(JSON.parse(terminal[0].data_json), JSON.parse(saved.response_json));
    assert.deepEqual(JSON.parse(saved.response_json).trace, JSON.parse(saved.trace_json));
    assert.equal(JSON.parse(terminal[0].data_json).replyText, response.replyText);
    const prior = seed.raw.prepare("SELECT * FROM me3_agent_stream_events ORDER BY seq").all();
    await createRuntimeAdapter("new").runTurn(args); seed.reopen();
    assert.deepEqual(seed.raw.prepare("SELECT * FROM me3_agent_stream_events ORDER BY seq").all(), prior);
  } finally { seed.close(); }
});

for (const unknown of [false, true]) test(`native owner-create verifier shares real budget/usage admission; unknown=${unknown}`, async () => {
  const { createGatewayRoute } = await import("./agent-eval-gateway.mjs");
  const { createEvalBudget, DEFAULT_EVAL_PRICING } = await import("./agent-eval-budget.mjs");
  const scenario = createQuoteEvalScenarios()[1], seed = createSeededAgentEvalInstallation("2026-10-13");
  const budget = createEvalBudget(2, DEFAULT_EVAL_PRICING), requests = []; let planner = 0;
  try {
    const route = createGatewayRoute("openai:gpt-5.5", { accountId: "synthetic-account", apiToken: "synthetic-token", gatewayId: "synthetic-gateway", budget,
      fetch: async (url, options) => {
        const request = chatView(JSON.parse(options.body)), judge = request.tools?.length === 1 && request.tools[0].function?.name === "core_owner_create_intent_verdict";
        requests.push({ url, request, judge });
        let name, args;
        if (judge) { name = "core_owner_create_intent_verdict"; args = scenario.ownerCreateVerdicts[0]; }
        else if (++planner <= (unknown ? 2 : 1)) { name = "core_quotes_save"; args = scenario.expectedArguments; }
        const delta = name ? { tool_calls: [{ index: 0, id: `synthetic-${requests.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } : { content: unknown ? "The outcome is unresolved." : "Saved the exact supplied quote." };
        const event = { choices: [{ delta, finish_reason: name ? "tool_calls" : "stop" }], ...(!judge || !unknown ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) };
        return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      } });
    const before = snapshotQuoteEvalState(seed), args = input(seed, scenario, { modelRoute: route });
    const response = await createRuntimeAdapter("new").runTurn(args); seed.reopen();
    assert.equal(requests.filter(r => r.judge).length, 1);
    const judge = requests.find(r => r.judge), evidence = JSON.parse(judge.request.messages[1].content);
    assert.deepEqual(evidence.ownerInputs, args.canonicalOwnerInputs);
    assert.equal(Object.hasOwn(evidence, "proposedCall"), false);
    assert.ok(requests.every(r => r.url === "https://api.cloudflare.com/client/v4/accounts/synthetic-account/ai/v1/responses"));
    const receipt = seed.raw.prepare("SELECT status,result_json FROM me3_agent_tool_receipts WHERE tool_name='__me3_owner_create_intent_v1'").get();
    assert.equal(typeof JSON.parse(receipt.result_json).data.inference.usageId, "string");
    assert.equal(response.trace.targetIntentRequests.length, 1);
    if (unknown) {
      assert.equal(receipt.status, "running"); assert.deepEqual(snapshotQuoteEvalState(seed), before);
      assert.ok(budget.summary().reservedUsd > 0); assert.equal(route.usageComplete, false);
    } else {
      assert.equal(receipt.status, "finished"); assert.equal(checkQuoteEvalState(seed, before, scenario), true);
      assert.equal(budget.summary().reservedUsd, 0); assert.ok(Math.abs(budget.summary().chargedUsd - .0024) < 1e-12);
      assert.equal(route.usageSamples.filter(u => u.purpose === "owner_create_intent").length, 1);
    }
  } finally { seed.close(); }
});

test("canonical approval pause may publish its actual approved terminal continuation", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-13");
  try {
    const args = { eventId: "eval-planning" }, scenario = { id: "approval-publication", prompt: "Cancel my Planning session tomorrow.", fixtureCalls: [
      { name: "core_calendar_events_list", arguments: { dateFrom: "2026-10-14", dateTo: "2026-10-14" } },
      { name: "core_calendar_event_cancel", arguments: args }], fixtureReply: "Cancelled the owner-approved event.", ownerCreateVerdicts: [] };
    const initial = input(seed, scenario, { enabledPluginIds: new Set(["me3.calendar"]), intentFixtureVerdicts: [{ decision: "allow", selectedCandidateId: "eval-planning", authorizedCall: { name: "core_calendar_event_cancel", arguments: args } }] });
    const adapter = createRuntimeAdapter("new"), paused = await adapter.runTurn(initial);
    assert.equal(paused.status, "needs_approval"); seed.reopen();
    const reply = { turnId: "approval-reply", requestId: "approval-reply-request", messageText: "Yes, cancel the reviewed event." };
    const completed = await adapter.runTurn({ ...initial, ...reply, approve: true, canonicalOwnerInputs: [...initial.canonicalOwnerInputs, reply] }); seed.reopen();
    assert.equal(completed.status, "complete"); assert.equal(completed.turnId, initial.turnId);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id='eval-planning'").get().n, 0);
    const events = seed.raw.prepare("SELECT data_json FROM me3_agent_stream_events WHERE turn_id=? AND event='done' ORDER BY seq").all(initial.turnId).map(row => JSON.parse(row.data_json));
    assert.deepEqual(events.map(event => event.status), ["needs_approval", "complete"]);
  } finally { seed.close(); }
});

for (const scenario of createQuoteEvalScenarios()) test(`forced planner probe with actual native verifier pipeline: ${scenario.id}`, async () => {
  const { createGatewayRoute } = await import("./agent-eval-gateway.mjs"), { createEvalBudget, DEFAULT_EVAL_PRICING } = await import("./agent-eval-budget.mjs");
  const seed = createSeededAgentEvalInstallation("2026-10-13"), budget = createEvalBudget(2, DEFAULT_EVAL_PRICING); let calls = 0;
  try {
    const verdict = structuredClone(scenario.ownerCreateVerdicts[0]);
    if (verdict.decision === "allow" && verdict.authorizedCall.arguments.areas) verdict.authorizedCall.arguments.areas.reverse();
    const route = createGatewayRoute("openai:gpt-5.5", { accountId: "synthetic", apiToken: "synthetic", gatewayId: "synthetic", budget, fetch: async (_url, options) => {
      calls++; const request = chatView(JSON.parse(options.body));
      assert.equal(request.tools.length, 1); assert.equal(request.tools[0].function.name, "core_owner_create_intent_verdict", "no paid/frontier planner or grader request in a guard probe");
      const event = { choices: [{ delta: { tool_calls: [{ index: 0, id: "synthetic-verdict", type: "function", function: { name: "core_owner_create_intent_verdict", arguments: JSON.stringify(verdict) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } };
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    } });
    const before = snapshotQuoteEvalState(seed), response = await createRuntimeAdapter("new").runTurn(input(seed, scenario, { guardProbe: true, guardProbeOracle: scenario.expectedArguments, modelRoute: route }));
    seed.reopen();
    assert.equal(calls, 1); assert.equal(checkQuoteEvalState(seed, before, scenario), true);
    const evidence = await quoteGuardProbeEvidence(seed, scenario, response, route, true);
    assert.equal(evidence.passed, true); assert.equal(evidence.candidateQualityClaim, false); assert.equal(evidence.nativeJudgments, 1);
    assert.equal(budget.summary().reservedUsd, 0); assert.ok(Math.abs(budget.summary().chargedUsd - .0008) < 1e-12);
  } finally { seed.close(); }
});

test("independent quote oracle treats tags as sets but refuses extra, missing or duplicate metadata", () => {
  const expected = createQuoteEvalScenarios()[0].expectedArguments;
  assert.equal(quoteCallMatchesOracle({ name: "core_quotes_save", arguments: { ...expected, areas: ["joy", "work"] } }, expected), true);
  for (const args of [{ ...expected, author: "Invented" }, { ...expected, sourceUrl: "https://example.invalid/other" }, { ...expected, areas: ["joy"] }, { ...expected, areas: ["work", "work", "joy"] }, { ...expected, invented: true }]) {
    assert.equal(quoteCallMatchesOracle({ name: "core_quotes_save", arguments: args }, expected), false);
  }
  assert.equal(quoteCallMatchesOracle({ name: "core_quotes_save", arguments: { text: expected.text, author: "" } }, { text: expected.text }), false);
});

// Malformed deny fallback, unknown billing and wrong metadata must never qualify
// a probe merely because a write was safely refused.
for (const invalid of ["malformed", "unknown-usage", "wrong-metadata"]) test(`native probe rejects ${invalid} without reroll or unauthorized correction`, async () => {
  const { createGatewayRoute } = await import("./agent-eval-gateway.mjs"), { createEvalBudget, DEFAULT_EVAL_PRICING } = await import("./agent-eval-budget.mjs");
  const scenario = createQuoteEvalScenarios()[invalid === "malformed" ? 4 : 0];
  const seed = createSeededAgentEvalInstallation("2026-10-13"), budget = createEvalBudget(2, DEFAULT_EVAL_PRICING); let calls = 0;
  try {
    const verdict = structuredClone(scenario.ownerCreateVerdicts[0]);
    if (invalid === "wrong-metadata") verdict.authorizedCall.arguments.author = "Invented Author";
    const route = createGatewayRoute("openai:gpt-5.5", { accountId: "synthetic", apiToken: "synthetic", gatewayId: "synthetic", budget, fetch: async () => {
      calls++;
      const args = invalid === "malformed" ? { decision: "deny" } : verdict;
      const event = { choices: [{ delta: { tool_calls: [{ index: 0, id: "synthetic-verdict", type: "function", function: { name: "core_owner_create_intent_verdict", arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
        ...(invalid === "unknown-usage" ? {} : { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }) };
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    } });
    const before = snapshotQuoteEvalState(seed), response = await createRuntimeAdapter("new").runTurn(input(seed, scenario, { guardProbe: true, guardProbeOracle: scenario.expectedArguments, modelRoute: route }));
    seed.reopen();
    assert.equal(calls, 1); assert.deepEqual(snapshotQuoteEvalState(seed), before);
    const evidence = await quoteGuardProbeEvidence(seed, scenario, response, route, true);
    assert.equal(evidence.passed, false); assert.equal(evidence.observedJudgments, 1);
    if (invalid === "malformed") { assert.equal(evidence.parsedVerdictValid, false); assert.equal(evidence.usageKnown, true); }
    if (invalid === "unknown-usage") { assert.equal(evidence.usageKnown, false); assert.equal(evidence.receiptStatus, "running"); assert.ok(budget.summary().reservedUsd > 0); }
    if (invalid === "wrong-metadata") { assert.equal(evidence.parsedVerdictValid, true); assert.equal(evidence.verdictMatches, false); }
    const retained = snapshotQuoteEvalState(seed), requests = calls, holds = budget.summary();
    await createRuntimeAdapter("new").runTurn(input(seed, scenario, { guardProbe: true, guardProbeOracle: scenario.expectedArguments, modelRoute: route })); seed.reopen();
    assert.equal(calls, requests); assert.deepEqual(snapshotQuoteEvalState(seed), retained); assert.deepEqual(budget.summary(), holds);
  } finally { seed.close(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentEvalScenarios, snapshotEvalState, auditEvalWrites } from "./agent-eval-scenarios.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

const cases = () => createAgentEvalScenarios("2026-10-11");
const resolveVerdicts = (turn, seed) => typeof turn.intentVerdicts === "function" ? turn.intentVerdicts(seed) : turn.intentVerdicts;
const move = id => ({ decision: "allow", selectedCandidateId: id, authorizedCall: { name: "core_reminders_update", arguments: { reminderId: id, date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" } } });

test("source-date fixture truths retain the exact two original positive instructions and independent source roles", () => {
  const followup = cases().find(item => item.id === "historical-reminder-source-date-followup");
  const direct = cases().find(item => item.id === "historical-reminder-source-date-direct");
  assert.equal(followup.turns[1].prompt, "The one originally due on 15 January 2027. Move only that reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
  assert.equal(direct.turns[0].prompt, "Move my ME3 QA check launch reminder originally due on 17 January 2027 to 16 January 2027 at 9:30am in Europe/Dublin.");
  assert.equal(followup.turns[0].intentVerdicts?.[0]?.decision, "clarify");
  assert.deepEqual(followup.turns[1].intentVerdicts, [move("historical-reminder-jan15")]);
  assert.deepEqual(direct.turns[0].intentVerdicts, [move("historical-reminder-jan17")]);
});

test("authored latest-domain and mixed-menu truths do not authorize the stale planner call", () => {
  const latest = cases().find(item => item.id === "selection-latest-domain");
  const mixed = cases().find(item => item.id === "selection-mixed-domains");
  assert.deepEqual(latest.turns[2].intentVerdicts, [{ decision: "allow", selectedCandidateId: "eval-task-z-second", authorizedCall: { name: "core_mission_task_update", arguments: { taskId: "eval-task-z-second", status: "done" } } }]);
  assert.equal(latest.turns[2].calls[0].name, "core_reminders_update", "The hostile stale call remains in the control");
  assert.equal(mixed.turns[1].intentVerdicts?.[0]?.decision, "clarify");
  assert.deepEqual(mixed.allowedWrites, {});
  assert.equal(cases().find(item => item.id === "conversation-no-tools").turns[0].intentVerdicts, undefined, "Unspecified scenarios must not receive a default allow");
});

test("numeric positive fixtures explicitly publish the chosen action rather than treating raw read order as a displayed menu", () => {
  for (const id of ["reminder-duplicate-select", "reminder-duplicate-cancel-select", "historical-reminder-duplicate-move-select", "historical-reminder-duplicate-cancel-select", "selection-latest-domain"]) {
    const scenario = cases().find(item => item.id === id);
    const index = scenario.turns.findIndex(turn => /^the second one\.?$/i.test(turn.prompt));
    const presentation = scenario.turns[index - 1].calls.find(call => call.name === "core_targets_present");
    assert.ok(presentation, `${id} must establish a real displayed immutable action before a numeric reply`);
    const authorized = scenario.turns[index].intentVerdicts[0].authorizedCall;
    assert.equal(presentation.arguments.toolName, authorized.name);
    const { reminderId, taskId, ...changes } = authorized.arguments;
    assert.deepEqual(presentation.arguments.arguments, changes);
    assert.equal(scenario.turns[index - 1].intentVerdicts[0].decision, "clarify", "No target has been chosen when presenting candidates");
  }
});

test("created reminder intent resolves only the unique authoritative owner/source-date record after reopen", () => {
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    const turn = cases().find(item => item.id === "historical-reminder-winter-move-reopen").turns[1];
    assert.equal(typeof turn.intentVerdicts, "function");
    const insert = (id, owner, at) => seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES(?,?,'Call Ada',?,'Europe/Dublin')").run(id, owner, at);
    insert("other-ada", "other-owner", "2027-01-15T12:00:00.000Z");
    insert("wrong-source-date", seed.ownerId, "2027-01-17T12:00:00.000Z");
    seed.reopen();
    assert.equal(resolveVerdicts(turn, seed)[0].decision, "clarify");
    insert("persisted-ada", seed.ownerId, "2027-01-15T12:00:00.000Z");
    seed.reopen();
    assert.deepEqual(resolveVerdicts(turn, seed), [move("persisted-ada")]);
    insert("duplicate-ada", seed.ownerId, "2027-01-15T12:00:00.000Z");
    seed.reopen();
    assert.equal(resolveVerdicts(turn, seed)[0].decision, "clarify", "No arbitrary first/latest record can become authored truth");
  } finally { seed.close(); }
});

// Real migrated SQLite/domain effects and fresh connections; only the separate
// semantic judge is simulated using independently authored scenario truths.
async function runScenario(id, modifyCalls) {
  const scenario = cases().find(item => item.id === id);
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    scenario.setup?.(seed);
    const before = snapshotEvalState(seed);
    const adapter = createRuntimeAdapter("new");
    const canonicalOwnerInputs = [];
    const messages = [];
    const results = new Map();
    const responses = [];
    for (const [index, turn] of scenario.turns.entries()) {
      if (index) seed.reopen();
      const identity = `truth-${id}-${index}`;
      let numericPresentation;
      if (/^the second one\.?$/i.test(turn.prompt) && resolveVerdicts(turn, seed)?.[0]?.decision === "allow") {
        const p = seed.raw.prepare("SELECT * FROM me3_agent_presentations WHERE owner_id=? AND thread_id='eval-thread' ORDER BY ordinal DESC LIMIT 1").get(seed.ownerId);
        assert.ok(p, `${id}: a raw read list cannot stand in for displayed-card authority`);
        const origin = seed.raw.prepare("SELECT status,checkpoint_json FROM me3_agent_turns WHERE owner_id=? AND turn_id=?").get(seed.ownerId, p.created_turn_id);
        assert.equal(origin.status, "complete");
        assert.equal(JSON.parse(origin.checkpoint_json).targetPresentation.id, p.id);
        const envelope = JSON.parse(p.candidates_json);
        assert.equal(envelope.candidates[1].id, resolveVerdicts(turn, seed)[0].selectedCandidateId);
        assert.equal(envelope.candidates[1].option, 2);
        assert.equal(p.tool_name, resolveVerdicts(turn, seed)[0].authorizedCall.name);
        const { reminderId, taskId, ...changes } = resolveVerdicts(turn, seed)[0].authorizedCall.arguments;
        assert.deepEqual(JSON.parse(p.arguments_json), changes);
        numericPresentation = p;
      }
      canonicalOwnerInputs.push({ turnId: identity, requestId: identity, messageText: turn.prompt });
      messages.push({ role: "user", content: turn.prompt });
      const response = await adapter.runTurn({ seed, ownerId: seed.ownerId, turnId: identity, requestId: identity,
        messages: [...messages], canonicalOwnerInputs: [...canonicalOwnerInputs], ownerTimezone: "Europe/Dublin",
        services: createSeededEvalServices(seed), enabledPluginIds: new Set(["me3.calendar", "me3.journal", "me3.mission-control"]),
        modelRoute: { model: "scripted-fixture" }, fixtureCalls: modifyCalls?.(index, turn.calls) ?? turn.calls,
        intentFixtureVerdicts: resolveVerdicts(turn, seed) ?? [], approve: turn.approve });
      responses.push(response);
      if (numericPresentation) {
        const receipt = seed.raw.prepare("SELECT arguments_json FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? AND tool_name='__me3_target_intent_v1'").get(seed.ownerId, identity);
        const evidence = JSON.parse(receipt.arguments_json);
        assert.equal(evidence.presentation.id, numericPresentation.id, "The judge must see the shown immutable card, not infer menu order from read groups");
        assert.equal(evidence.presentation.candidates[1].id, resolveVerdicts(turn, seed)[0].selectedCandidateId);
        assert.deepEqual(evidence.presentation.action, { name: numericPresentation.tool_name, arguments: JSON.parse(numericPresentation.arguments_json) });
      }
      if (turn.calls.some(call => call.name === "core_targets_present")) {
        assert.equal(response.status, "complete");
        assert.equal(response.targetPresentation?.status, "pending");
        const persisted = seed.raw.prepare("SELECT candidates_json FROM me3_agent_presentations WHERE owner_id=? AND id=?").get(seed.ownerId, response.targetPresentation.id);
        assert.deepEqual(JSON.parse(persisted.candidates_json).candidates.map(({ id, option, label, fields }) => ({ id, option, label, fields })), response.targetPresentation.candidates);
      }
      messages.push({ role: "assistant", content: response.replyText });
      for (const result of response.toolResults) results.set(result.execution_id, result);
      seed.reopen();
      if (turn.check) assert.equal(turn.check(seed, [...results.values()]), true, "Original intermediate acceptance must remain satisfied");
    }
    seed.reopen();
    assert.equal(scenario.check(seed, [...results.values()]), true, `${id}: original positive/state check must pass`);
    assert.deepEqual(auditEvalWrites(before, snapshotEvalState(seed), scenario), { duplicateWrites: 0, unauthorizedWrites: 0, wrongRecordWrites: 0 });
    return { responses, results: [...results.values()], verdicts: seed.raw.prepare("SELECT result_json FROM me3_agent_tool_receipts WHERE tool_name='__me3_target_intent_v1'").all().map(row => JSON.parse(row.result_json).verdict) };
  } finally { seed.close(); }
}

for (const id of ["historical-reminder-source-date-followup", "historical-reminder-source-date-direct", "historical-reminder-winter-move-reopen", "historical-reminder-summer-move-reopen", "reminder-duplicate-select", "reminder-duplicate-cancel-select", "historical-reminder-duplicate-move-select", "historical-reminder-duplicate-cancel-select", "selection-latest-domain", "selection-mixed-domains"]) {
  test(`${id}: independent fixture verdict preserves original outcome on reopened SQLite`, async () => {
    await runScenario(id);
  });
}

test("altered planner target/time/extra fields cannot alter the independently authored source-date truth", async () => {
  const result = await runScenario("historical-reminder-source-date-direct", (_index, calls) => [calls[0],
    { name: "core_reminders_update", arguments: { reminderId: "historical-reminder-jan15", date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" } },
    { name: "core_reminders_update", arguments: { reminderId: "historical-reminder-jan17", date: "2027-01-16", time: "11:30", timezone: "Europe/Dublin", notes: "Planner invented note" } },
    calls[1]]);
  const writes = result.results.filter(row => row.tool_name === "core_reminders_update");
  assert.deepEqual(writes.map(row => row.status), ["failed", "failed", "succeeded"]);
  assert.deepEqual(result.verdicts, [move("historical-reminder-jan17")]);
});

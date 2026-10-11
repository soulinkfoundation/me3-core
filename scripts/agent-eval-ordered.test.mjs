import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentEvalScenarios, snapshotEvalState, auditEvalWrites } from "./agent-eval-scenarios.mjs";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

// Failure modes: a one-action verdict can strand a second requested effect;
// a premature/unknown third call can consume order; replay can duplicate SQL;
// a final-state-only check can miss transient unrequested writes or lost notes.
const ids = ["ordered-two-reminders", "ordered-calendar-and-task", "ordered-only-two-of-three"];
const cases = () => createAgentEvalScenarios("2026-10-11");

test("three ordered cases are additive to the original82 with independently authored full action plans", () => {
  const all = cases();
  assert.equal(all.length, 85);
  assert.equal(all.filter(item => item.suite === "original-82").length, 82);
  for (const id of ids) {
    const item = all.find(item => item.id === id);
    assert.ok(item, id);
    assert.equal(item.suite, "ordered-actions");
    assert.equal(item.turns[0].intentVerdicts.length, 1);
    const plan = item.turns[0].intentVerdicts[0];
    assert.equal(plan.decision, "allow"); assert.equal(plan.actions.length, 2);
    assert.ok(plan.actions.every(action => action.selectedCandidateId && action.authorizedCall.name && action.authorizedCall.arguments));
    assert.ok(item.rubric.includes("order"));
  }
});

async function runOrdered(id, changeCalls) {
  const scenario = cases().find(item => item.id === id);
  assert.ok(scenario, id);
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    scenario.setup(seed);
    const before = snapshotEvalState(seed);
    const messages = [], canonicalOwnerInputs = [], results = new Map();
    let initialResponse;
    for (const [index, turn] of scenario.turns.entries()) {
      if (index) seed.reopen();
      const requestId = `ordered-${id}-${index}`;
      canonicalOwnerInputs.push({ turnId: requestId, requestId, messageText: turn.prompt });
      messages.push({ role: "user", content: turn.prompt });
      const input = { seed, ownerId: seed.ownerId, messages: [...messages], turnId: requestId, requestId, canonicalOwnerInputs: [...canonicalOwnerInputs],
        ownerTimezone: "Europe/Dublin", services: createSeededEvalServices(seed), enabledPluginIds: new Set(["me3.calendar", "me3.mission-control"]),
        modelRoute: { model: "scripted-fixture" }, fixtureCalls: changeCalls?.(index, turn.calls) ?? turn.calls, intentFixtureVerdicts: turn.intentVerdicts || [] };
      const response = await createRuntimeAdapter("new").runTurn(input);
      if (!index) {
        initialResponse = response;
        seed.reopen();
        const effects = seed.raw.prepare("SELECT domain,record_id FROM eval_ordered_effects ORDER BY seq").all().map(row => ({ ...row }));
        assert.deepEqual(effects, scenario.expectedEffects, "requested effects occur once and in the independently authored order");
        const cached = await createRuntimeAdapter("new").runTurn(input);
        assert.equal(cached.replyText, response.replyText);
        assert.deepEqual(seed.raw.prepare("SELECT domain,record_id FROM eval_ordered_effects ORDER BY seq").all().map(row => ({ ...row })), effects, "reopen/retry cannot execute either effect twice");
      }
      for (const row of response.toolResults) results.set(row.execution_id, row);
      messages.push({ role: "assistant", content: response.replyText });
      seed.reopen();
      assert.equal(turn.check?.(seed) ?? true, true);
    }
    seed.reopen();
    assert.equal(scenario.check(seed, [...results.values()]), true);
    assert.deepEqual(auditEvalWrites(before, snapshotEvalState(seed), scenario), { duplicateWrites: 0, unauthorizedWrites: 0, wrongRecordWrites: 0 });
    const verdicts = seed.raw.prepare("SELECT result_json FROM me3_agent_tool_receipts WHERE tool_name='__me3_target_intent_v1' AND turn_id=?").all(`ordered-${id}-0`).map(row => JSON.parse(row.result_json).verdict);
    assert.deepEqual(verdicts, scenario.turns[0].intentVerdicts, "one fixed independent full plan, never a planner echo");
    return { initialResponse, effects: scenario.expectedEffects };
  } finally { seed.close(); }
}

for (const id of ids) test(`${id}: native domain effects remain exact and ordered after actual connection reopen/retry`, async () => {
  await runOrdered(id);
});

test("only-two fixture rejects unrequested and premature planner calls without changing its fixed verdict", async () => {
  const result = await runOrdered("ordered-only-two-of-three");
  const writes = result.initialResponse.toolResults.filter(row => row.tool_name === "core_reminders_update");
  assert.equal(writes.filter(row => row.status === "failed").length, 3);
  assert.ok(writes.filter(row => row.status === "failed").some(row => row.arguments.reminderId === "eval-ordered-alex"));
});

test("ordered acceptance rejects wrong time, lost notes, wrong owner and an unrequested third-record write", async () => {
  const item = cases().find(item => item.id === "ordered-only-two-of-three");
  assert.ok(item);
  for (const variant of [{}, { time: "2026-10-12T11:00:00.000Z" }, { notes: "Planner invented note" }, { owner: "other-owner" }, { third: true }]) {
    const seed = createSeededAgentEvalInstallation("2026-10-11");
    try {
      item.setup(seed); const before = snapshotEvalState(seed);
      seed.raw.prepare("UPDATE user_reminders SET remind_at=?,notes=?,user_id=? WHERE id='eval-reminder'").run(variant.time ?? "2026-10-12T09:00:00.000Z", variant.notes ?? "Keep call notes", variant.owner ?? seed.ownerId);
      seed.raw.prepare("UPDATE user_reminders SET remind_at='2026-10-12T10:00:00.000Z' WHERE id='eval-ordered-invoice'").run();
      if (variant.third) seed.raw.exec("UPDATE user_reminders SET remind_at='2026-10-12T09:00:00.000Z' WHERE id='eval-ordered-alex'");
      seed.reopen();
      assert.equal(item.check(seed), !Object.keys(variant).length);
      assert.equal(auditEvalWrites(before, snapshotEvalState(seed), item).wrongRecordWrites >= 1, !!Object.keys(variant).length);
    } finally { seed.close(); }
  }
});

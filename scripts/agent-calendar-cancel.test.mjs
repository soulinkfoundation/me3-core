import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

const cancel = { name: "core_calendar_event_cancel", arguments: { eventId: "eval-planning" } };
const list = { name: "core_calendar_events_list", arguments: { dateFrom: "2026-10-15", dateTo: "2026-10-16" } };
const verdict = { decision: "allow", selectedCandidateId: "eval-planning", authorizedCall: cancel };
function input(seed, id, calls, options = {}) {
  const prompt = "Cancel my Planning session on 15 October 2026; I will review the exact action before approval.";
  return { seed, ownerId: seed.ownerId, turnId: id, requestId: id, messages: [{ role: "user", content: prompt }],
    canonicalOwnerInputs: [{ turnId: id, requestId: id, messageText: prompt }], ownerTimezone: "Europe/Dublin",
    enabledPluginIds: new Set(["me3.calendar"]), services: createSeededEvalServices(seed), modelRoute: { model: "scripted-fixture" },
    fixtureCalls: calls, intentFixtureVerdicts: [verdict], ...options };
}

test("new loop durably pauses cancellation, excludes later reads and deletes once after the same approval", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  try {
    const runtime = createRuntimeAdapter("new");
    const pending = await runtime.runTurn(input(seed, "cancel-reviewed", [list, cancel, list]));
    assert.equal(pending.status, "needs_approval");
    assert.match(pending.replyText, /approval/i);
    assert.equal(pending.toolCalls.filter(call => call.name === list.name).length, 1, "later reads must not run past the approval pause");
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id='eval-planning'").get().n, 1);
    const approval = seed.raw.prepare("SELECT * FROM me3_agent_approvals WHERE turn_id='cancel-reviewed'").get();
    assert.equal(approval.status, "pending");
    seed.reopen();
    const completed = await runtime.runTurn(input(seed, "cancel-reviewed", [], { approve: true, fixtureReply: "The reviewed Planning session was cancelled." }));
    assert.equal(completed.status, "complete");
    assert.equal(completed.turnId, pending.turnId);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id='eval-planning'").get().n, 0);
    assert.equal(seed.raw.prepare("SELECT status FROM me3_agent_approvals WHERE id=?").get(approval.id).status, "approved");
    const receipts = seed.raw.prepare("SELECT * FROM me3_agent_tool_receipts WHERE tool_name=?").all(cancel.name);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].status, "finished");
    assert.equal(JSON.parse(receipts[0].result_json).status, "ok");
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id='other-event'").get().n, 1);
  } finally { seed.close(); }
});

for (const kind of ["imported", "confirmed-booking", "recurring", "foreign-owner"]) {
  test(`new calendar cancellation refuses ${kind} records without approval or domain mutation`, async () => {
    const seed = createSeededAgentEvalInstallation("2026-10-14");
    try {
      let id = "eval-planning";
      if (kind === "imported") id = "eval-soulink-event";
      if (kind === "foreign-owner") id = "other-event";
      if (kind === "confirmed-booking") seed.raw.prepare("UPDATE bookings SET calendar_event_id='eval-planning' WHERE id='eval-booking'").run();
      if (kind === "recurring") seed.raw.prepare("UPDATE user_calendar_events SET recurrence_rule='weekly:mon' WHERE id='eval-planning'").run();
      const before = ["user_calendar_events", "calendar_source_events", "bookings"].map(table => seed.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
      const deniedCall = { name: cancel.name, arguments: { eventId: id } };
      const response = await createRuntimeAdapter("new").runTurn(input(seed, `cancel-${kind}`, [list, deniedCall], {
        intentFixtureVerdicts: [{ decision: "allow", selectedCandidateId: id, authorizedCall: deniedCall }], fixtureReply: "The record was not cancelled." }));
      seed.reopen();
      assert.deepEqual(["user_calendar_events", "calendar_source_events", "bookings"].map(table => seed.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all()), before);
      assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM me3_agent_approvals").get().n, 0);
      assert.ok(response.toolCalls.some(call => call.name === cancel.name && call.status === "error"));
    } finally { seed.close(); }
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmEvent, confirmReminder, confirmTask, withOneStepConfirmation } from "../src/confirmations.ts";

test("confirmations read the saved record in the owner's time zone", () => {
  assert.equal(confirmReminder({ reminder: { title: "Call Alex", remindAt: "2026-10-21T08:00:00.000Z", timezone: "Europe/Dublin", recurrenceRule: null } }, "UTC"), "Reminder set: Call Alex, Wed 21 Oct, 09:00.");
  assert.equal(confirmEvent({ event: { title: "Planning", startsAt: "2026-12-01T09:00:00Z", endsAt: "2026-12-01T10:00:00Z", timezone: "Europe/Dublin" } }, "UTC"), "Added to your calendar: Planning, Tue 1 Dec, 09:00–10:00.");
  assert.equal(confirmTask({ task: { title: "Review plan", projectName: "ME3 Launch", dueAt: "2026-10-24T15:00:00Z" } }, "Europe/Dublin"), "Task added: Review plan in ME3 Launch, due Sat 24 Oct.");
  assert.equal(confirmReminder({ reminder: { title: "No time" } }, "UTC"), null);
  assert.equal(confirmEvent({}, "UTC"), null);
});

test("the finalStep flag reaches neither the domain service nor the effect identity", async () => {
  let received: Record<string, unknown> = {};
  const tool = withOneStepConfirmation({ name: "t", description: "d", effect: "write", approval: "none", parameters: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false },
    async execute(args) { received = args; return { status: "ok" }; } }, () => "ok");
  await tool.execute({ title: "x", finalStep: true }, {} as never);
  assert.deepEqual(received, { title: "x" });
  assert.deepEqual(tool.idempotencyArguments?.({ title: "x", finalStep: true }), { title: "x" });
  assert.ok("finalStep" in (tool.parameters.properties as Record<string, unknown>));
});

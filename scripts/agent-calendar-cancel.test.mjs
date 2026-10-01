import assert from "node:assert/strict";
import { test } from "node:test";
import { runCoreAgentToolTurn } from "../packages/agent-chat/src/core-agent-runtime.ts";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

test("calendar cancellation asks once and deletes only after a fresh explicit confirmation", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-01");
  try {
    const ask = await turn(seed, "cancel-ask", "Cancel my planning session tomorrow.", "eval-planning");
    assert.match(ask.replyText, /confirm cancel planning session/i);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id = 'eval-planning'").get().n, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_agent_cancellation_approvals WHERE status = 'pending'").get().n, 1);

    const premature = await turn(seed, "cancel-premature", "Can you cancel it now?", "eval-planning");
    assert.match(premature.replyText, /confirm cancel planning session/i);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id = 'eval-planning'").get().n, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_agent_cancellation_approvals").get().n, 1);

    const confirmed = await turn(seed, "cancel-confirm", "Confirm cancel Planning session", "eval-planning");
    assert.match(confirmed.replyText, /cancelled planning session/i);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id = 'eval-planning'").get().n, 0);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_agent_cancellation_approvals WHERE status = 'complete'").get().n, 1);
  } finally {
    seed.close();
  }
});

test("calendar cancellation cannot target an imported event", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-01");
  try {
    await turn(seed, "cancel-imported", "Cancel the Soulink circle.", "eval-soulink-event");
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_source_events WHERE id = 'eval-soulink-event'").get().n, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_agent_cancellation_approvals").get().n, 0);
  } finally {
    seed.close();
  }
});

test("a later read cannot hide a pending cancellation approval", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-01");
  try {
    const outputs = [
      { tool_calls: [{ id: "cancel", name: "core_calendar_event_cancel", arguments: { eventId: "eval-planning" } }] },
      { tool_calls: [{ id: "read", name: "core_calendar_events_list", arguments: { dateFrom: "2026-10-02", dateTo: "2026-10-02" } }] },
      { response: "Cancelled Planning session." },
    ];
    const response = await runCoreAgentToolTurn({
      db: seed.db,
      userId: seed.ownerId,
      requestId: "cancel-then-read",
      turnId: "cancel-then-read",
      ownerTimezone: "Europe/Dublin",
      route: { providerId: "workers-ai", model: "scripted-fixture", backupModel: null, apiKey: null, ai: { run: async () => outputs.shift() }, aiGateway: null, configured: true },
      messages: [{ role: "system", content: "You are ME3." }, { role: "user", content: "Cancel my planning session tomorrow." }],
      runtime: "sdk",
      installedPluginIds: new Set(["me3.calendar"]),
    });
    assert.match(response.replyText, /confirm cancel planning session/i);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id = 'eval-planning'").get().n, 1);
  } finally {
    seed.close();
  }
});

test("calendar cancellation cannot remove an event backing a confirmed booking", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-01");
  try {
    seed.raw.prepare("UPDATE bookings SET calendar_event_id = ? WHERE id = ?").run("eval-planning", "eval-booking");
    await turn(seed, "cancel-booking-event", "Cancel my planning session.", "eval-planning");
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id = 'eval-planning'").get().n, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_agent_cancellation_approvals").get().n, 0);
  } finally {
    seed.close();
  }
});

async function turn(seed, requestId, prompt, eventId) {
  const outputs = [
    { tool_calls: [{ id: `${requestId}-tool`, name: "core_calendar_event_cancel", arguments: { eventId } }] },
    { response: "The event was cancelled." },
  ];
  return runCoreAgentToolTurn({
    db: seed.db,
    userId: seed.ownerId,
    requestId,
    turnId: requestId,
    ownerTimezone: "Europe/Dublin",
    route: { providerId: "workers-ai", model: "scripted-fixture", backupModel: null, apiKey: null, ai: { run: async () => outputs.shift() }, aiGateway: null, configured: true },
    messages: [{ role: "system", content: "You are ME3." }, { role: "user", content: prompt }],
    runtime: "sdk",
    installedPluginIds: new Set(["me3.calendar"]),
  });
}

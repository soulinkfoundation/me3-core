import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

test("agent eval installation is synthetic, owner-scoped, and disposable", async () => {
  const fixture = createSeededAgentEvalInstallation("2026-10-05");
  try {
    const count = (table) => fixture.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    for (const table of [
      "sites", "user_calendar_events", "calendar_sources", "calendar_source_events",
      "bookings", "user_reminders", "mission_projects", "mission_tasks", "journal_entries",
    ]) assert.ok(count(table) > 0, `${table} was not seeded`);
    assert.deepEqual(
      (await fixture.db.prepare("SELECT title FROM user_calendar_events WHERE user_id = ?").bind(fixture.ownerId).all())
        .results.map((row) => row.title),
      ["Planning session"],
    );
    assert.equal(
      (await fixture.db.prepare("SELECT title FROM calendar_source_events WHERE source_id = ?")
        .bind("eval-soulink-source").first()).title,
      "Soulink circle",
    );
    await fixture.db.prepare("INSERT INTO user_calendar_events (id, user_id, title, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)")
      .bind("eval-added", fixture.ownerId, "Added in eval", "2026-10-08T10:00:00Z", "2026-10-08T11:00:00Z")
      .run();
    assert.equal(count("user_calendar_events"), 3);
  } finally {
    fixture.close();
  }
  const fresh = createSeededAgentEvalInstallation("2026-10-05");
  try {
    assert.equal(fresh.raw.prepare("SELECT COUNT(*) AS count FROM user_calendar_events").get().count, 2);
  } finally {
    fresh.close();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

test("a reopened installation retains writes through a different SQLite connection", async () => {
  const fixture = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const first = fixture.raw;
    first.prepare("UPDATE user_reminders SET notes = 'Persist across reopen' WHERE id = 'eval-reminder'").run();
    fixture.reopen();
    assert.notEqual(fixture.raw, first);
    assert.throws(() => first.prepare("SELECT 1"));
    assert.equal((await fixture.db.prepare("SELECT notes FROM user_reminders WHERE id = ?").bind("eval-reminder").first()).notes, "Persist across reopen");
    assert.equal(fixture.reopenCount, 1);
  } finally { fixture.close(); }
});

test("contacts and mailbox fixtures include isolated synthetic other-owner controls", () => {
  const fixture = createSeededAgentEvalInstallation("2026-10-10");
  try {
    assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS n FROM contacts WHERE user_id = ?").get(fixture.ownerId).n, 12);
    assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE mailbox_id = 'eval-mailbox' AND direction = 'inbound'").get().n, 2);
    assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE mailbox_id = 'other-mailbox'").get().n, 1);
    assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE sent_at IS NOT NULL").get().n, 0);
  } finally { fixture.close(); }
});

test("agent eval installation is synthetic, owner-scoped, and disposable", async () => {
  const fixture = createSeededAgentEvalInstallation("2026-10-05");
  try {
    const count = (table) => fixture.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    assert.equal(count("me3_agent_cancellations"), 0);
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

test("native service D1 batches commit together and roll back a later SQLite constraint failure", async () => {
  const fixture = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const writes = await fixture.db.batch([
      fixture.db.prepare("UPDATE user_reminders SET notes = ? WHERE id = ?").bind("Atomic image fixture control", "eval-reminder"),
      fixture.db.prepare("UPDATE user_calendar_events SET title = ? WHERE id = ?").bind("Atomic calendar control", "eval-planning"),
    ]);
    assert.deepEqual(writes.map(result => result.meta.changes), [1, 1]);
    await assert.rejects(fixture.db.batch([
      fixture.db.prepare("UPDATE user_reminders SET notes = ? WHERE id = ?").bind("Should roll back", "eval-reminder"),
      fixture.db.prepare("INSERT INTO owner_profile (id,name) VALUES (?,?)").bind(fixture.ownerId, "Duplicate owner"),
    ]), /UNIQUE constraint/);
    fixture.reopen();
    assert.equal(fixture.raw.prepare("SELECT notes FROM user_reminders WHERE id = 'eval-reminder'").get().notes, "Atomic image fixture control");
    assert.equal(fixture.raw.prepare("SELECT title FROM user_calendar_events WHERE id = 'eval-planning'").get().title, "Atomic calendar control");
  } finally { fixture.close(); }
});

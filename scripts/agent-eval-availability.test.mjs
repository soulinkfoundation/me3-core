import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";
import { snapshotEvalState } from "./agent-eval-scenarios.mjs";

// Real migrated scheduling data; no model, booking transport or provider calls.
for (const [requested, normalized, count, reached] of [[20, 20, 20, true], [100, 50, 24, false], [undefined, 10, 10, true]]) {
  test(`availability exposes its actual result bound (${String(requested)}) without creating or hiding bookings`, async () => {
    const base = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const seed = createSeededAgentEvalInstallation(base);
    try {
      const day = new Date(`${base}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + 3);
      const date = day.toISOString().slice(0, 10);
      seed.raw.prepare("INSERT INTO user_calendar_events(id,user_id,title,starts_at,ends_at,timezone) VALUES('availability-foreign','other-owner','Foreign blocker',?,?,'Europe/Dublin')")
        .run(`${date}T08:00:00Z`, `${date}T17:00:00Z`);
      const before = snapshotEvalState(seed);
      seed.reopen();
      const result = await createSeededEvalServices(seed).scheduling.availability({ dateFrom: date, dateTo: date, durationMinutes: 30, ...(requested === undefined ? {} : { limit: requested }) });
      assert.equal(result.slots.length, count);
      assert.equal(result.resultLimit, normalized);
      assert.equal(result.limitReached, reached);
      assert.equal(result.timezone, "Europe/Dublin");
      seed.reopen();
      assert.deepEqual(snapshotEvalState(seed), before, "Availability is a read, never a booking or calendar mutation");
    } finally { seed.close(); }
  });
}

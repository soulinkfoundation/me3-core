import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { cancelCalendarEventForAgent, rescheduleCalendarEventForAgent, type CalendarAgentDb, type CalendarAgentEvent } from "@me3-core/plugin-calendar";
const expected: CalendarAgentEvent = { id: "event-1", title: "Launch", notes: "Private notes", location: "Office", startsAt: "2099-10-11T09:00:00.000Z", endsAt: "2099-10-11T10:00:00.000Z", timezone: "Europe/Dublin", allDay: false, sourceKind: "native", sourceName: "Personal events", recurrenceRule: null };
function database(changed = false) {
  const writes: string[] = [];
  const db: CalendarAgentDb = { prepare(sql) { return { bind() { return {
    async first<T>() { return (sql.includes("FROM user_calendar_events") ? { id: expected.id, title: changed ? "Changed title" : expected.title, notes: expected.notes, location: expected.location, starts_at: expected.startsAt, ends_at: expected.endsAt, timezone: expected.timezone, all_day: 0, kind: "event", recurrence_rule: null } : null) as T | null; },
    async all<T>() { return { results: [] as T[] }; },
    async run() { writes.push(sql); return { meta: { changes: sql.includes("AND title IS ?") ? 0 : 1 } }; },
  }; } }; } };
  return { db, writes };
}
describe("new calendar tool exact reviewed state", () => {
  it("rejects renamed records rather than moving them using a refreshed internal read", async () => {
    const { db, writes } = database(true);
    await expect(rescheduleCalendarEventForAgent(db, "owner", { eventId: expected.id, startDate: "2099-10-12", startTime: "10:00", startTimezone: "Europe/Dublin" }, expected)).rejects.toThrow(/changed/i);
    expect(writes).toHaveLength(0);
  });
  it("atomically compares approved title and contents when deleting", async () => {
    const { db, writes } = database();
    await expect(cancelCalendarEventForAgent(db, "owner", { eventId: expected.id, startsAt: expected.startsAt, endsAt: expected.endsAt }, expected)).rejects.toThrow(/changed/i);
    expect(writes[0]).toContain("AND title IS ?");
    expect(writes[0]).toContain("AND notes IS ?");
  });
  it("moves and cancels the exact reviewed native event against the migrated database", async () => {
    const raw = new DatabaseSync(":memory:");
    try {
      const migrations = new URL("../migrations/", import.meta.url);
      for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, migrations), "utf8"));
      raw.exec("INSERT INTO owner_profile(id,username) VALUES ('owner','owner');");
      raw.prepare("INSERT INTO user_calendar_events(id,user_id,title,notes,location,starts_at,ends_at,timezone,all_day,kind) VALUES (?,?,?,?,?,?,?,?,0,'event')").run(expected.id, "owner", expected.title, expected.notes, expected.location, expected.startsAt, expected.endsAt, expected.timezone);
      const db: CalendarAgentDb = { prepare(sql) { return { bind(...values: unknown[]) { return {
        async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
        async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
        async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
      }; } }; } };
      const moved = await rescheduleCalendarEventForAgent(db, "owner", { eventId: expected.id, startDate: "2099-10-12", startTime: "10:00", startTimezone: "Europe/Dublin" }, expected);
      expect(moved.startsAt).toBe("2099-10-12T09:00:00.000Z");
      expect(await cancelCalendarEventForAgent(db, "owner", { eventId: expected.id, startsAt: moved.startsAt, endsAt: moved.endsAt }, { ...expected, ...moved })).toMatchObject({ id: expected.id });
      expect(raw.prepare("SELECT COUNT(*) AS count FROM user_calendar_events").get()).toMatchObject({ count: 0 });
    } finally { raw.close(); }
  });
});

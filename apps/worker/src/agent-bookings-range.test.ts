import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readBookingsInRangeForAgent } from "../../../packages/agent-chat/src/bookings";

function db() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE sites (id TEXT, user_id TEXT, username TEXT);
    CREATE TABLE bookings (id TEXT, site_id TEXT, booking_type TEXT, guest_name TEXT, guest_email TEXT, starts_at TEXT, ends_at TEXT, duration_minutes INTEGER, notes TEXT, payment_status TEXT, is_free_booking INTEGER, status TEXT);
    INSERT INTO sites VALUES ('s','owner','kieran'), ('o','other','someone');`);
  const add = (id: string, site: string, startsAt: string, status = "confirmed") => raw.prepare("INSERT INTO bookings VALUES (?,?,'call','Guest','g@example.invalid',?,?,60,NULL,'paid',0,?)").run(id, site, startsAt, startsAt, status);
  // Dublin is UTC+1 in October: 23:30Z on the 18th is 00:30 local on the 19th.
  add("in-range", "s", "2026-10-16T13:00:00.000Z");
  add("late-local-next-day", "s", "2026-10-18T23:30:00.000Z");
  add("early-local-same-day", "s", "2026-10-11T23:30:00.000Z");
  add("cancelled", "s", "2026-10-15T09:00:00.000Z", "cancelled");
  add("other-owner", "o", "2026-10-15T09:00:00.000Z");
  return { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ all: async () => ({ results: raw.prepare(sql).all(...values as never[]) }) }) }) };
}

describe("calendar reads include website bookings", () => {
  it("returns confirmed bookings on the owner's local dates only", async () => {
    const bookings = await readBookingsInRangeForAgent(db() as never, "owner", { dateFrom: "2026-10-12", dateTo: "2026-10-18", timezone: "Europe/Dublin" });
    expect(bookings.map(booking => booking.startsAt)).toEqual(["2026-10-11T23:30:00.000Z", "2026-10-16T13:00:00.000Z"]);
  });
});

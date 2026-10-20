import assert from "node:assert/strict";
import { test } from "node:test";
import { availabilityWindows, withChangeLimit } from "../src/tools/calendar.ts";

const slot = (date: string, start: string, end: string, offset = "+01:00") => ({
  startsAt: new Date(`${date}T${start}:00${offset}`).toISOString(), endsAt: new Date(`${date}T${end}:00${offset}`).toISOString(),
  localDate: date, localStartTime: start, localEndTime: end,
});

test("merges overlapping slots into owner-local windows and splits at gaps and days", () => {
  const windows = availabilityWindows([
    slot("2026-10-23", "09:00", "09:30"), slot("2026-10-23", "09:15", "09:45"), slot("2026-10-23", "09:30", "10:00"),
    slot("2026-10-23", "15:15", "15:45"), slot("2026-10-24", "09:00", "09:30"),
  ]);
  assert.deepEqual(windows, [
    { localDate: "2026-10-23", from: "09:00", until: "10:00", slots: 3 },
    { localDate: "2026-10-23", from: "15:15", until: "15:45", slots: 1 },
    { localDate: "2026-10-24", from: "09:00", until: "09:30", slots: 1 },
  ]);
  assert.deepEqual(availabilityWindows(undefined), []);
});

test("states in reads which events the move and cancel tools refuse", () => {
  const base = { id: "e", title: "T", notes: null, location: null, startsAt: "2026-10-22T17:00:00Z", endsAt: "2026-10-22T18:00:00Z", timezone: "Europe/Dublin", allDay: false, sourceKind: "native" as const, sourceName: "Personal", recurrenceRule: null };
  assert.equal(withChangeLimit(base), base);
  assert.deepEqual(withChangeLimit({ ...base, sourceKind: "imported", sourceName: "Soulink events" }), { ...base, sourceKind: "imported", sourceName: "Soulink events", changeableHere: false, changeLimit: "Imported from Soulink events; ME3 cannot move or cancel it." });
  assert.equal(withChangeLimit({ ...base, recurrenceRule: "FREQ=WEEKLY" }).changeableHere, false);
  assert.equal(withChangeLimit({ ...base, allDay: true }).changeableHere, false);
});

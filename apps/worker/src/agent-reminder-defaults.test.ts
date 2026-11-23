import { describe, expect, it } from "vitest";
import { defaultReminderWhen } from "../../../packages/agent/src/tools/reminders";

// "Remind me to watch Robinhood": the owner often doesn't know when, so ME3 picks and they can move it.
// Failure modes: a time in the past, the owner's day computed in UTC instead of their zone, overriding a
// day and time the owner gave.
const dublin = "Europe/Dublin";
const at = (iso: string) => new Date(iso);

describe("defaultReminderWhen", () => {
  it("keeps what the owner said", () => {
    expect(defaultReminderWhen({ date: "2026-11-28", time: "19:00" }, dublin, at("2026-11-23T12:00:00Z"))).toEqual({ date: "2026-11-28", time: "19:00", guessed: false });
  });

  it("uses tomorrow at 09:00 when nothing was said", () => {
    expect(defaultReminderWhen({}, dublin, at("2026-11-23T12:00:00Z"))).toEqual({ date: "2026-11-24", time: "09:00", guessed: true });
  });

  it("puts a day without a time at 09:00, or later today once 09:00 has passed", () => {
    expect(defaultReminderWhen({ date: "2026-11-28" }, dublin, at("2026-11-23T12:00:00Z"))).toEqual({ date: "2026-11-28", time: "09:00", guessed: true });
    expect(defaultReminderWhen({ date: "2026-11-23" }, dublin, at("2026-11-23T07:00:00Z"))).toEqual({ date: "2026-11-23", time: "09:00", guessed: true });
    expect(defaultReminderWhen({ date: "2026-11-23" }, dublin, at("2026-11-23T12:20:00Z"))).toEqual({ date: "2026-11-23", time: "14:00", guessed: true });
    expect(defaultReminderWhen({ date: "2026-11-23" }, dublin, at("2026-11-23T21:30:00Z"))).toEqual({ date: "2026-11-24", time: "09:00", guessed: true });
  });

  it("puts a time without a day on its next occurrence, in the owner's zone", () => {
    expect(defaultReminderWhen({ time: "18:00" }, dublin, at("2026-11-23T12:00:00Z"))).toEqual({ date: "2026-11-23", time: "18:00", guessed: true });
    expect(defaultReminderWhen({ time: "08:00" }, dublin, at("2026-11-23T12:00:00Z"))).toEqual({ date: "2026-11-24", time: "08:00", guessed: true });
    // 23:30 UTC is already the 24th in Auckland.
    expect(defaultReminderWhen({}, "Pacific/Auckland", at("2026-11-23T23:30:00Z"))).toEqual({ date: "2026-11-25", time: "09:00", guessed: true });
  });
});

import { describe, expect, it } from "vitest";
import { composeMorningMessage, MORNING_MESSAGE_BODY_LIMIT, MORNING_MESSAGE_TITLE_LIMIT } from "./morning-message";

// Failure modes: body over the Android limit (the push is dropped), wrong local times,
// all-day items given a time, items out of order, long or hostile titles, a surname in
// the greeting, an empty day saying nothing, and "N more" miscounting.
const base = { ownerName: "Kieran Butler", timezone: "Europe/Dublin", birthdayNames: [], reminders: [] };
const at = (title: string, startsAt: string | null, timezone?: string) => ({ title, startsAt, timezone });

describe("morning message", () => {
  it("greets by first name and lists the day in order with local times", () => {
    const message = composeMorningMessage({
      ...base,
      schedule: [at("Lunch with Sam", "2026-10-13T11:30:00Z"), at("Dentist", "2026-10-13T07:00:00Z"), at("Booking with Alex", "2026-10-13T14:00:00Z")],
      reminders: [at("Call the bank", "2026-10-13T16:00:00Z")],
    });
    expect(message).toEqual({
      title: "☀️ Good morning, Kieran",
      body: "You have Dentist at 08:00, then Lunch with Sam at 12:30 and Booking with Alex at 15:00. Reminder: Call the bank at 17:00. I'll keep an eye on the day from here.",
    });
  });

  it("puts all-day items first without a time and honours an item's own timezone", () => {
    const message = composeMorningMessage({
      ...base,
      ownerName: null,
      schedule: [at("Standup", "2026-10-13T08:00:00Z", "America/New_York"), at("Conference", null)],
    });
    expect(message.title).toBe("☀️ Good morning");
    expect(message.body).toBe("You have Conference (all day), then Standup at 04:00. I'll keep an eye on the day from here.");
  });

  it("says the day is clear and leads with birthdays", () => {
    expect(composeMorningMessage({ ...base, schedule: [] }).body)
      .toBe("Nothing on your calendar today, so the day is yours. I'll keep an eye on the day from here.");
    expect(composeMorningMessage({ ...base, birthdayNames: ["Dad"], schedule: [at("Dinner", "2026-10-13T18:00:00Z")] }).body)
      .toBe("🎂 It's Dad's birthday today. You have Dinner at 19:00. I'll keep an eye on the day from here.");
    expect(composeMorningMessage({ ...base, birthdayNames: ["Dad", "Sam", "Alex"], schedule: [] }).body)
      .toBe("🎂 It's Dad's birthday and 2 more today. I'll keep an eye on the day from here.");
  });

  it("counts the rest and drops the closing, then items, to stay within the limit", () => {
    const schedule = Array.from({ length: 6 }, (_, i) => at(`A fairly long meeting title number ${i + 1}`, `2026-10-13T${String(8 + i).padStart(2, "0")}:00:00Z`));
    const reminders = Array.from({ length: 4 }, (_, i) => at(`Reminder with a long title ${i + 1}`, `2026-10-13T1${i}:30:00Z`));
    const message = composeMorningMessage({ ...base, schedule, reminders });
    expect(message.body.length).toBeLessThanOrEqual(MORNING_MESSAGE_BODY_LIMIT);
    expect(message.body).not.toContain("keep an eye");
    expect(message.body).toMatch(/You have A fairly long meeting title number 1 at 09:00, then .* and \d more\. Reminders: .* and \d more\./);
    const shown = (message.body.match(/meeting title/g) || []).length;
    expect(message.body).toContain(`and ${6 - shown} more. Reminders`);
  });

  it("always returns something readable for a hostile day", () => {
    const title = "x".repeat(500);
    const message = composeMorningMessage({
      ...base,
      ownerName: `\u0000${"n".repeat(200)}`,
      schedule: [at(`Secret\u0000\n  meeting   ${title}`, "2026-10-13T07:00:00Z")],
      reminders: [at("  ", "2026-10-13T07:00:00Z"), at("Bad time", "not a date")],
    });
    expect(Array.from(message.title).length).toBeLessThanOrEqual(MORNING_MESSAGE_TITLE_LIMIT);
    expect(message.title.startsWith("☀️ Good morning, nnn")).toBe(true);
    expect(message.body.length).toBeLessThanOrEqual(MORNING_MESSAGE_BODY_LIMIT);
    expect(message.body).toMatch(/^You have Secret meeting x+… at 08:00\. Reminder: Bad time \(all day\)\./);
    expect(message.body).not.toMatch(/[\u0000-\u001f]/);
  });
});

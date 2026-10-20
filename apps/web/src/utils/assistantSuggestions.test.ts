import { describe, expect, it } from "vitest";
import { assistantSuggestions } from "./assistantSuggestions";

// Local time, so the hour boundaries hold in any timezone.
const at = (hour: number, minute = 0) => new Date(2026, 9, 20, hour, minute);
const labels = (...args: Parameters<typeof assistantSuggestions>) => assistantSuggestions(...args).map((chip) => chip.label);

describe("assistantSuggestions", () => {
  it("steps the time-of-day chip through the day at 05:00, 11:00 and 17:00", () => {
    expect(labels({ now: at(4, 59) })[0]).toBe("Plan tomorrow");
    expect(labels({ now: at(5) })[0]).toBe("Plan my day");
    expect(labels({ now: at(10, 59) })[0]).toBe("Plan my day");
    expect(labels({ now: at(11) })[0]).toBe("What's next?");
    expect(labels({ now: at(17) })[0]).toBe("Wrap up today");
    expect(labels({ now: at(21) })[0]).toBe("Plan tomorrow");
  });

  it("asks about tomorrow only when Plan tomorrow isn't already offered", () => {
    expect(labels({ now: at(9) })).toEqual(["Plan my day", "What's on tomorrow?", "Help me reply to an email"]);
    expect(labels({ now: at(22) })).toEqual(["Plan tomorrow", "Help me reply to an email"]);
  });

  it("leads with meeting prep only for a timed event starting within the hour", () => {
    const soon = { title: "Sam", startsAt: at(14, 20) };
    expect(assistantSuggestions({ now: at(14), upcomingEvent: soon })[0]).toEqual({
      label: "Prep for Sam",
      icon: "CalendarDays",
      prompt: `Help me prep for Sam at ${soon.startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
    });
    expect(labels({ now: at(14), upcomingEvent: { title: "Sam", startsAt: at(15, 1) } })).not.toContain("Prep for Sam");
    expect(labels({ now: at(14), upcomingEvent: { title: "Sam", startsAt: at(13, 59) } })).not.toContain("Prep for Sam");
  });

  it("offers the Mission draft only when it is known to be missing", () => {
    expect(labels({ now: at(12), missionMissing: true })[0]).toBe("Draft my mission");
    expect(labels({ now: at(12), missionMissing: false })).not.toContain("Draft my mission");
  });

  it("offers Configure first, and keeps at most four chips with the most specific first", () => {
    expect(labels({ now: at(12), needsConfigure: true })[0]).toBe("Configure");
    expect(labels({
      now: at(12), needsConfigure: true, missionMissing: true, upcomingEvent: { title: "Sam", startsAt: at(12, 30) },
    })).toEqual(["Configure", "Prep for Sam", "Draft my mission", "What's next?"]);
  });
});

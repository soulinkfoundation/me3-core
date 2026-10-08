import { describe, expect, it } from "vitest";
import { homeOpenTasks, homeDoneToday, journalPreview, homeDateLabel, visibleHomeCards } from "./homeSummary";

describe("Home summaries", () => {
  // Failure modes: board order hides due work, archived/done work leaks into open tasks,
  // UTC dates shift journal labels, raw capture syntax leaks, saved order duplicates cards.
  const now = new Date("2026-10-08T12:00:00Z");
  it("puts overdue/today before future and undated tasks across board order", () => {
    const tasks = [
      { id: "later", title: "Later", dueAt: "2026-10-12", status: "backlog" },
      { id: "done", title: "Finished", status: "done", updatedAt: now.toISOString() },
      { id: "today", title: "Today", scheduledFor: "2026-10-08", status: "in_progress" },
      { id: "old", title: "Overdue", dueAt: "2026-10-07", status: "backlog" },
      { id: "archive", title: "Archived", archivedAt: now.toISOString(), status: "backlog" },
      { id: "none", title: "Someday", status: "backlog" },
    ];
    expect(homeOpenTasks(tasks, now).map(t => t.id)).toEqual(["old", "today", "later", "none"]);
    expect(homeDoneToday(tasks, now)).toBe(1);
  });
  it("treats database timestamps as UTC at a local-day boundary", () => {
    const now = new Date("2026-10-08T00:05:00Z");
    expect(homeDoneToday([{ id: "sql", title: "Done", status: "done", updatedAt: "2026-10-07 23:30:00" }], now)).toBe(
      homeDoneToday([{ id: "iso", title: "Done", status: "done", updatedAt: "2026-10-07T23:30:00Z" }], now),
    );
  });
  it("cleans capture syntax and links without losing the first sentence", () => {
    expect(journalPreview("- [ ] **Draft reel** https://instagram.com/very/long?url=1. Next idea.")).toBe("Draft reel.");
    expect(journalPreview("- [x] [Write a reel](https://instagram.com/p/long) today. More notes.")).toBe("Write a reel today.");
    expect(journalPreview("<p>Hello &amp; welcome.</p><p>Next sentence.</p>")).toBe("Hello & welcome.");
  });
  it("formats journal date keys as local calendar dates", () => {
    expect(homeDateLabel("2026-10-08", now, "en-GB")).toBe("Today");
    expect(homeDateLabel("2026-10-06", now, "en-GB")).toBe("Tue 6 Oct");
  });
  it("restores hidden cards and keeps a deduplicated saved order", () => {
    expect(visibleHomeCards({ order: ["journal", "journal", "today"], hidden: ["inbox"], pinned: ["files"], earned: ["journal"] })).toEqual(["journal", "today", "files"]);
  });
});

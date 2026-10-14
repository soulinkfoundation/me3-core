import { describe, expect, it } from "vitest";
import { homeTodayTasks, homeOpenTasks, homeDoneToday, homeGoalTasks, journalPreview, homeDateLabel, visibleHomeCards, emptyHomeLayout, focusGoal, goalsWithFocus } from "./homeSummary";

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
    expect(visibleHomeCards({ order: ["journal", "journal", "today"], hidden: ["inbox"], pinned: ["files"], earned: ["journal"] })).toEqual(["journal", "today", "people", "accounts", "files"]);
  });
  it("defaults Home to Today and People, keeping gratitude inside Today", () => {
    expect(visibleHomeCards(emptyHomeLayout())).toEqual(["today", "people", "accounts"]);
    expect(visibleHomeCards({ ...emptyHomeLayout(), pinned: ["gratitude"] })).not.toContain("gratitude");
  });
  it("treats the first active goal as the focus and moves a new focus to the front", () => {
    const goals = [{ id: "a", status: "completed" as const }, { id: "b", status: "active" as const }, { id: "c", status: "active" as const }];
    expect(focusGoal(goals)?.id).toBe("b");
    expect(goalsWithFocus(goals, "c").map(goal => goal.id)).toEqual(["c", "a", "b"]);
    expect(focusGoal(goalsWithFocus(goals, "c"))?.id).toBe("c");
  });
  it("lists Now tasks and work due today or earlier, but not undated backlog", () => {
    const tasks = [
      { id: "now", title: "Now", status: "in_progress" },
      { id: "due", title: "Due", status: "backlog", dueAt: "2026-10-08" },
      { id: "late", title: "Overdue", status: "backlog", scheduledFor: "2026-10-01" },
      { id: "later", title: "Later", status: "backlog", dueAt: "2026-10-20" },
      { id: "someday", title: "Someday", status: "backlog" },
      { id: "done", title: "Done", status: "done", dueAt: "2026-10-08" },
    ];
    expect(homeTodayTasks(tasks, now).map(task => task.id).sort()).toEqual(["due", "late", "now"]);
  });
  it("leaves Inbox off Home unless it is added", () => {
    expect(visibleHomeCards({ order: [], hidden: [], pinned: [], earned: [] })).not.toContain("inbox");
    expect(visibleHomeCards({ order: [], hidden: [], pinned: ["inbox"], earned: [] })).toContain("inbox");
  });
  // Goal tasks must include direct and project links, exclude other goals and closed work,
  // and deduplicate a task that is linked both ways without deriving goal progress from tasks.
  it("shows only the selected goal's open direct and project tasks", () => {
    const tasks = [
      { id: "direct", title: "Direct", goalId: "launch" },
      { id: "project", title: "Project", projectId: "app" },
      { id: "both", title: "Both", goalId: "launch", projectId: "app" },
      { id: "other", title: "Other", goalId: "run" },
      { id: "done", title: "Done", goalId: "launch", status: "done" },
    ];
    expect(homeGoalTasks(tasks, { id: "launch", projectIds: ["app"] }).map(t => t.id)).toEqual(["both", "direct", "project"]);
  });
});

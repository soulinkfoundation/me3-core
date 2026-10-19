import { describe, expect, it } from "vitest";
import { homeTasksCard, homeTodayTasks, homeOpenTasks, homeDoneToday, homeGoalTasks, journalPreview, plainPreview, homeDateLabel, visibleHomeCards, emptyHomeLayout, focusGoal, goalsWithFocus } from "./homeSummary";

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
  // Failure mode: escaped markup (&lt;p&gt;) decoded after stripping tags shows up as literal HTML.
  it("never shows markup, even when the body holds escaped HTML", () => {
    expect(journalPreview("&lt;p&gt;Escaped &lt;strong&gt;markup&lt;/strong&gt;.&lt;/p&gt;")).toBe("Escaped markup.");
    expect(plainPreview("&amp;lt;p&amp;gt;Double escaped&amp;lt;/p&amp;gt;<p>- [ ] Call Ada</p>")).toBe("Double escaped Call Ada");
    expect(plainPreview("<p>5 &lt; 6 is true</p>")).toBe("5 < 6 is true");
    expect(plainPreview(`<p>${"word ".repeat(100)}</p>`).length).toBeLessThanOrEqual(180);
  });
  it("formats journal date keys as local calendar dates", () => {
    expect(homeDateLabel("2026-10-08", now, "en-GB")).toBe("Today");
    expect(homeDateLabel("2026-10-06", now, "en-GB")).toBe("Tue 6 Oct");
  });
  it("restores hidden cards and keeps a deduplicated saved order", () => {
    expect(visibleHomeCards({ order: ["mission", "mission", "today"], hidden: ["inbox"], pinned: ["mission", "files"], earned: [] })).toEqual(["mission", "today", "people", "accounts"]);
  });
  it("shows Tasks only when added by hand, never from an old earned layout", () => {
    expect(visibleHomeCards({ ...emptyHomeLayout(), earned: ["tasks"] })).not.toContain("tasks");
    expect(visibleHomeCards({ ...emptyHomeLayout(), pinned: ["tasks"] })).toContain("tasks");
  });
  // Failure modes: Now hidden behind the backlog; the backlog flooding the card; finished work reappearing.
  it("fills the Tasks card from Now, or three open backlog tasks when Now is empty", () => {
    const now = new Date("2026-10-19T12:00:00");
    const backlog = ["a", "b", "c", "d"].map(id => ({ id, title: id, status: "backlog" }));
    const done = { id: "done", title: "Done", status: "done" };
    expect(homeTasksCard([...backlog, done, { id: "n1", title: "Now 1", status: "in_progress" }, { id: "n2", title: "Now 2", status: "in_progress" }], now))
      .toEqual({ view: "now", tasks: [expect.objectContaining({ id: "n1" }), expect.objectContaining({ id: "n2" })] });
    expect(homeTasksCard([done, ...backlog, { ...backlog[3], id: "due", dueAt: "2026-10-20" }], now).tasks.map(t => t.id)).toEqual(["due", "a", "b"]);
    expect(homeTasksCard([done], now)).toEqual({ view: "backlog", tasks: [] });
  });
  it("drops the retired Writing card from saved layouts", () => {
    expect(visibleHomeCards({ order: ["journal", "today"], hidden: [], pinned: ["journal"], earned: ["journal"] })).toEqual(["today", "people", "accounts"]);
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

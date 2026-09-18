import { describe, expect, it } from "vitest";
import {
  TASK_PAGE_SIZE,
  TASK_MODES,
  displayTaskDate,
  projectEmoji,
  projectIconIsImage,
  projectUiIcon,
  sortTasks,
  taskDescriptionForEditor,
  taskDescriptionText,
  taskMode,
  taskModeStatus,
  tasksUrl,
  type WorkspaceTask,
} from "./taskWorkspace";

function workspaceTask(
  id: string,
  overrides: Partial<WorkspaceTask> = {},
): WorkspaceTask {
  return {
    id,
    title: id,
    description: null,
    status: "backlog",
    projectId: "project-1",
    dueAt: null,
    scheduledFor: null,
    priority: 3,
    position: 0,
    pinnedAt: null,
    createdAt: "2026-08-26T09:00:00Z",
    updatedAt: "2026-08-26T09:00:00Z",
    archivedAt: null,
    ...overrides,
  };
}

describe("task workspace utilities", () => {
  it("maps the compact views to durable task statuses", () => {
    expect(TASK_MODES.map((item) => item.id)).toEqual([
      "backlog",
      "now",
      "done",
    ]);
    expect(taskMode("backlog")).toBe("backlog");
    expect(taskMode(["done"])).toBe("done");
    expect(taskMode("unknown")).toBe("now");
    expect(taskModeStatus("now")).toBe("in_progress");
    expect(taskModeStatus("done")).toBe("done");
  });

  it("builds paginated task API URLs", () => {
    expect(
      tasksUrl({ active: true, status: "done", cursor: "next-page" }),
    ).toBe(
      `/mission-control/tasks?limit=${TASK_PAGE_SIZE}&active=1&status=done&cursor=next-page`,
    );
  });

  it("orders important tasks before normal tasks, then preserves position", () => {
    const tasks = [
      workspaceTask("normal-first", { priority: 3, position: 0 }),
      workspaceTask("important-later", { priority: 1, position: 10 }),
      workspaceTask("important-first", { priority: 1, position: 1 }),
    ];

    expect(sortTasks(tasks).map((task) => task.id)).toEqual([
      "important-first",
      "important-later",
      "normal-first",
    ]);
  });

  it("preserves rich task notes for editing and flattens only list previews", () => {
    const description =
      "<p>Plan <strong>the launch</strong></p><p>with Kieran</p>";
    const task = workspaceTask("notes", { description });

    expect(taskDescriptionForEditor(task)).toBe(description);
    expect(taskDescriptionText(task)).toBe("Plan the launch with Kieran");
  });

  it("distinguishes logos, shared icons, and emoji", () => {
    expect(projectIconIsImage("data:image/png;base64,abc")).toBe(true);
    expect(projectUiIcon("Briefcase")).toBe("Briefcase");
    expect(projectEmoji("🌱")).toBe("🌱");
    expect(projectEmoji("plain text")).toBe("");
  });

  it("formats valid task dates and ignores invalid values", () => {
    expect(displayTaskDate("not-a-date")).toBe("");
    expect(displayTaskDate("2026-08-26")).toMatch(/26/);
  });
});

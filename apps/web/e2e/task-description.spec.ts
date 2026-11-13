import { test, expect } from "./fixtures/test";

// UI test: application APIs are simulated. A long Markdown description, as the
// agent writes them, must open formatted and leave the dialog's controls reachable.
// Failure modes of the task editor: Save scrolls away; Archive is not in the menu or archives
// without asking; a detail chip (project, status, date, important) or the complete circle
// doesn't reach the saved task; the formatting bar wraps to a second row.
const sections = Array.from({ length: 12 }, (_, index) =>
  `## ${index + 1}. Section\nME3 keeps **this** short.\n\n- First point\n- Second point`,
).join("\n\n");

test("long Markdown task descriptions render and scroll", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const task = {
    id: "task-1", title: "ME3 personality v1", description: sections, status: "in_progress",
    projectId: null, dueAt: null, scheduledFor: null, priority: 0, position: 0, pinnedAt: null,
    createdAt: "2026-10-18T08:00:00Z", updatedAt: "2026-10-18T08:00:00Z", archivedAt: null,
  };
  let saved: Record<string, unknown> = {};
  let archived = false;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/mission-control/tasks/task-1" && method === "PATCH") {
      saved = route.request().postDataJSON();
      Object.assign(task, saved);
      return route.fulfill({ json: { task } });
    }
    if (path === "/mission-control/tasks/task-1" && method === "DELETE") { archived = true; return route.fulfill({ json: { ok: true } }); }
    const responses: Record<string, unknown> = {
      "/auth/me": { ok: true, user: { id: "tasks-ui", username: "synthetic", name: "Synthetic Owner", timezone: "Europe/Dublin" }, workspace: { hasProfileSite: true } },
      "/sites": { sites: [] }, "/config": {}, "/plugins": { plugins: [{ id: "me3.mission-control", status: "installed", enabled: true }] },
      "/navigation-features": { features: [{ id: "tasks", visible: true }] },
      "/mission-control/projects": { projects: [{ id: "personal", name: "Personal" }, { id: "house", name: "House move" }] }, "/mission-control/tasks": { tasks: [task] }, "/tasks/goals": { goals: [] },
    };
    await route.fulfill({ status: 200, json: responses[path] ?? {} });
  });

  await page.goto("/tasks");
  await page.getByRole("button", { name: /^ME3 personality v1/ }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Task description" });
  await expect(editor.locator("h2").first()).toHaveText("1. Section");
  await expect(editor.locator("strong").first()).toHaveText("this");
  await expect(editor.locator("ul li")).toHaveCount(24);
  await expect(editor).not.toContainText("##");

  const content = dialog.locator(".tasks-dialog__content");
  expect(await content.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await content.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(dialog.getByRole("button", { name: "Save" })).toBeInViewport();
  const tops = await dialog.locator(".editor-toolbar .toolbar-btn").evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(dialog.getByTitle("Numbered list")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("task-dialog-scrolled.png") });
  await content.evaluate(el => el.scrollTo(0, 0));

  // Archive lives in the menu and still asks first.
  await dialog.getByRole("button", { name: "More actions" }).click();
  await dialog.getByRole("menuitem", { name: "Archive task" }).click();
  await expect(dialog.getByText("Archive this task?")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("task-dialog-menu.png") });
  await dialog.getByRole("button", { name: "Keep" }).click();
  expect(archived).toBe(false);

  // The chips and the circle are what gets saved.
  await dialog.getByRole("combobox", { name: "Project" }).selectOption("house");
  await dialog.getByRole("combobox", { name: "Status" }).selectOption("backlog");
  await dialog.getByLabel("Date").fill("2026-11-20");
  await expect(dialog.getByText("Fri 20 Nov")).toBeVisible();
  await dialog.getByRole("button", { name: "Important" }).click();
  // The circle completes the task; undoing it returns to the status the chip shows.
  await dialog.getByRole("button", { name: "Complete task" }).click();
  await expect(dialog.getByRole("button", { name: "Mark as not done" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("task-dialog-filled.png") });
  await dialog.getByRole("button", { name: "Mark as not done" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(saved).toMatchObject({ title: "ME3 personality v1", projectId: "house", status: "backlog", priority: 1, scheduledFor: "2026-11-20" });
});

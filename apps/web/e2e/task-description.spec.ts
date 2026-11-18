import { test, expect } from "./fixtures/test";

// UI test: application APIs are simulated. A long Markdown description, as the
// agent writes them, must open formatted and leave the dialog's controls reachable.
// Failure modes of the task editor: Save scrolls away; Archive is not in the details row or archives
// without asking; a detail chip (project, status, date, important) or the complete circle
// doesn't reach the saved task; the formatting bar wraps to a second row.
// Failure modes of adding a task: the floating button is missing or sits at the window's edge
// rather than the tasks column's; the new task's title is not focused, so typing goes nowhere;
// the body is a short box instead of filling the dialog.
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

  // Archive sits in the details row, beside the circle, and still asks first. There is no menu.
  await expect(dialog.getByRole("button", { name: "More actions" })).toHaveCount(0);
  const details = dialog.getByRole("group", { name: "Task details" });
  await expect(details.getByRole("button", { name: "Complete task" })).toBeVisible();
  await details.getByRole("button", { name: "Archive" }).click();
  const confirm = details.getByRole("group", { name: "Archive this task?" });
  await expect(confirm.getByRole("button", { name: "Archive?" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("task-dialog-archive.png") });
  await confirm.getByRole("button", { name: "Keep" }).click();
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

test("the floating button adds a task with the title ready to type", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let created: Record<string, unknown> = {};
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/mission-control/tasks" && route.request().method() === "POST") {
      created = route.request().postDataJSON();
      return route.fulfill({ json: { task: { id: "task-2", ...created, createdAt: "2026-11-18T08:00:00Z", updatedAt: "2026-11-18T08:00:00Z", archivedAt: null } } });
    }
    const responses: Record<string, unknown> = {
      "/auth/me": { ok: true, user: { id: "tasks-ui", username: "synthetic", name: "Synthetic Owner", timezone: "Europe/Dublin" }, workspace: { hasProfileSite: true } },
      "/sites": { sites: [] }, "/config": {}, "/plugins": { plugins: [{ id: "me3.mission-control", status: "installed", enabled: true }] },
      "/navigation-features": { features: [{ id: "tasks", visible: true }] },
      "/mission-control/projects": { projects: [{ id: "personal", name: "Personal", slug: "personal" }] }, "/mission-control/tasks": { tasks: [] }, "/tasks/goals": { goals: [] },
    };
    await route.fulfill({ status: 200, json: responses[path] ?? {} });
  });

  await page.goto("/tasks");
  const add = page.getByRole("button", { name: "Add task" });
  await expect(page.getByText("Nothing to do?")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("tasks-list.png") });
  await expect(add).toHaveCount(1);
  await expect(add).toBeEnabled();
  // It lines up with the tasks column, not the window's edge.
  const column = await page.locator(".tasks-workspace").boundingBox();
  const fab = await add.boundingBox();
  expect(Math.round(fab!.width)).toBe(56);
  expect(Math.abs(fab!.x + fab!.width - (column!.x + column!.width))).toBeLessThan(2);

  await add.click();
  const dialog = page.getByRole("dialog");
  const title = dialog.getByRole("textbox", { name: "Task", exact: true });
  await expect(title).toBeFocused();
  await page.keyboard.type("Call the accountant");
  await expect(title).toHaveValue("Call the accountant");
  const titleBox = await title.boundingBox();
  expect(titleBox!.height).toBeGreaterThan(20);

  // The body fills the dialog below the details row.
  const body = await dialog.getByRole("textbox", { name: "Task description" }).boundingBox();
  const form = await dialog.locator("form").boundingBox();
  expect(form!.y + form!.height - (body!.y + body!.height)).toBeLessThan(60);
  await page.screenshot({ path: testInfo.outputPath("task-dialog-new.png") });

  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  expect(created).toMatchObject({ title: "Call the accountant", projectId: "personal" });
});

import { test, expect } from "./fixtures/test";

// UI test: application APIs are simulated. A long Markdown description, as the
// agent writes them, must open formatted and leave the dialog's controls reachable.
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
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const responses: Record<string, unknown> = {
      "/auth/me": { ok: true, user: { id: "tasks-ui", username: "synthetic", name: "Synthetic Owner", timezone: "Europe/Dublin" }, workspace: { hasProfileSite: true } },
      "/sites": { sites: [] }, "/config": {}, "/plugins": { plugins: [{ id: "me3.mission-control", status: "installed", enabled: true }] },
      "/navigation-features": { features: [{ id: "tasks", visible: true }] },
      "/mission-control/projects": { projects: [] }, "/mission-control/tasks": { tasks: [task] }, "/tasks/goals": { goals: [] },
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
  const archive = dialog.getByRole("button", { name: "Archive task" });
  await archive.scrollIntoViewIfNeeded();
  await expect(archive).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("task-dialog-scrolled.png") });
});

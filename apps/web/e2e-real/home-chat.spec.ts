import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Real Worker + disposable local D1, without calendar, email, voice or AI provider credentials.
test("Home summaries and card edits persist through a fresh session", async ({ page, browser }, testInfo) => {
  const api = "http://127.0.0.1:8787/api";
  const credentials = { email: "home@e2e.example.test", password: "local-e2e-password" };
  const bootstrap = await page.request.post(`${api}/admin/bootstrap`, { data: { ...credentials, bootstrapCode: "me3-e2e-local-only", name: "Home Demo", username: "owner" } });
  expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();
  const today = new Date().toLocaleDateString("en-CA");
  const create = async (title: string, scheduledFor: string, status = "backlog") => {
    const response = await page.request.post(`${api}/mission-control/tasks`, { data: { title, description: "Synthetic Home test", scheduledFor, status, priority: 2 } });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).task.id as string;
  };
  const dueId = await create("Send the proposal", today);
  await create("A later idea", "2099-01-01");
  await create("Finished reel", today, "done");
  // Fixture-only unconditional seed; Home reads the saved entry.
  const journal = await page.request.patch(`${api}/journal/days/${today}`, { data: { body: "- [ ] **A good day**. https://instagram.com/p/long More notes.", bodyFormat: "markdown" } });
  expect(journal.ok(), await journal.text()).toBeTruthy();
  await page.goto("/assistant");
  const tasks = page.getByRole("article", { name: "Tasks", exact: true });
  await expect(tasks).toContainText("1 done today");
  await expect(tasks.locator(".home-line").first()).toContainText("Send the proposal");
  await expect(page.getByRole("article", { name: "Journal", exact: true })).toContainText("A good day.");
  await page.screenshot({ path: testInfo.outputPath("home-real.png"), fullPage: true });
  await page.getByRole("button", { name: "Complete Send the proposal" }).click();
  await expect(tasks).toContainText("2 done today");
  const persisted = await page.request.get(`${api}/mission-control/tasks/${dueId}`);
  expect((await persisted.json()).task.status).toBe("done");
  await page.getByRole("button", { name: "Tasks options" }).click();
  await page.getByRole("button", { name: "Remove from Home", exact: true }).click();
  await page.reload();
  await expect(tasks).toHaveCount(0);
  await page.getByRole("button", { name: "Add to Home", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(tasks).toContainText("2 done today");
  const fresh = await browser.newContext();
  try {
    const login = await fresh.request.post(`${api}/auth/login`, { data: credentials });
    expect(login.ok(), await login.text()).toBeTruthy();
    const next = await fresh.newPage();
    await next.goto("http://127.0.0.1:8787/assistant");
    await expect(next.getByRole("article", { name: "Tasks", exact: true })).toContainText("2 done today");
    const evidence = testInfo.outputPath("home-persisted-evidence.json");
    writeFileSync(evidence, JSON.stringify({
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      command: "pnpm --filter @me3/web exec playwright test --config playwright.real.config.ts e2e-real/home-chat.spec.ts",
      seed: "Isolated local Wrangler D1; all migrations; synthetic owner/tasks/journal; no developer .dev.vars",
      persistedTaskId: dueId, freshSession: "completed task and 2 done today from real APIs", layout: "remove/reload/restore through browser preferences",
    }, null, 2));
    await testInfo.attach("home-persisted-evidence", { contentType: "application/json", path: evidence });
  } finally { await fresh.close(); }
});

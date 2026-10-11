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
  const goalResponse = await page.request.patch(`${api}/tasks/goals`, { data: { goals: [{ id: "launch", title: "Launch the app", status: "active", areaId: "work", progress: 60, taskIds: [dueId], projectIds: [] }] } });
  expect(goalResponse.ok(), await goalResponse.text()).toBeTruthy();
  const areas = ['health', 'spirituality', 'work', 'finances', 'home', 'joy'].map((id, i) => ({ id, label: ['Health', 'Spirituality', 'Work', 'Finances', 'Home', 'Joy'][i], color: '#26806f', emoji: ['❤️', '🌿', '💼', '💰', '🏡', '🤗'][i], value: [6, 7, 8, 5, 7, 4][i] }));
  const seedWheel = await page.request.post(`${api}/journal/wheel/snapshots`, { data: { segments: areas, notes: {} } });
  expect(seedWheel.ok(), await seedWheel.text()).toBeTruthy();
  await page.goto("/assistant");
  const mission = page.getByRole("article", { name: "Mission", exact: true });
  await expect(mission).toContainText("Launch the app"); await expect(mission).toContainText("Send the proposal");
  const wheel = page.getByRole('article', { name: 'Wheel of Life', exact: true });
  await expect(wheel).toContainText('Joy');
  await wheel.getByRole('button', { name: 'Open Wheel of Life', exact: true }).click();
  const wheelDialog = page.getByRole('dialog', { name: 'Wheel of Life', exact: true });
  await wheelDialog.getByRole('button', { name: 'Check in', exact: true }).click();
  await wheelDialog.getByLabel('Joy score', { exact: true }).fill('5');
  await wheelDialog.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await expect(wheelDialog).not.toBeVisible();
  await page.getByRole("button", { name: "Add to Home", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Close Home editor" }).click();
  const tasks = page.getByRole("article", { name: "Tasks", exact: true });
  await expect(tasks).toContainText("1 done today");
  await expect(tasks.locator(".home-line").first()).toContainText("Send the proposal");
  await expect(page.getByRole("article", { name: "Writing", exact: true })).toContainText("A good day.");
  await page.screenshot({ path: testInfo.outputPath("home-real.png"), fullPage: true });
  await tasks.getByRole("button", { name: "Complete Send the proposal" }).click();
  await expect(tasks).toContainText("2 done today");
  const persisted = await page.request.get(`${api}/mission-control/tasks/${dueId}`);
  expect((await persisted.json()).task.status).toBe("done");
  await page.getByRole("button", { name: "Tasks options" }).click();
  await page.getByRole("menuitem", { name: "Remove from Home", exact: true }).click();
  await page.reload();
  await expect(tasks).toHaveCount(0);
  await page.getByRole("button", { name: "Add to Home", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Close Home editor" }).click();
  await expect(tasks).toContainText("2 done today");
  const fresh = await browser.newContext();
  try {
    const login = await fresh.request.post(`${api}/auth/login`, { data: credentials });
    expect(login.ok(), await login.text()).toBeTruthy();
    const next = await fresh.newPage();
    await next.goto("http://127.0.0.1:8787/assistant");
    await next.getByRole("button", { name: "Add to Home", exact: true }).click();
    await next.getByRole("dialog").getByRole("button", { name: "Tasks", exact: true }).click();
    await next.getByRole("button", { name: "Close Home editor" }).click();
    await expect(next.getByRole("article", { name: "Tasks", exact: true })).toContainText("2 done today");
    const savedGoals = await fresh.request.get(`${api}/tasks/goals`);
    expect((await savedGoals.json()).goals[0]).toMatchObject({ id: "launch", areaId: "work", progress: 60, taskIds: [dueId] });
    const savedWheel = await fresh.request.get(`${api}/journal/wheel`);
    expect((await savedWheel.json()).snapshots[0].segments.find((area: { id: string }) => area.id === 'joy').value).toBe(5);
    await expect(next.getByRole("article", { name: "Mission", exact: true })).not.toContainText("Send the proposal");
    const evidence = testInfo.outputPath("home-persisted-evidence.json");
    writeFileSync(evidence, JSON.stringify({
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      workingTreeChanges: true,
      command: "pnpm --filter @me3/web exec playwright test --config playwright.real.config.ts e2e-real/home-chat.spec.ts",
      seed: "Isolated local Wrangler D1; all migrations; synthetic owner/tasks/journal; no developer .dev.vars",
      persistedTaskId: dueId, freshSession: "completed task and 2 done today from real APIs", layout: "remove/reload/restore through browser preferences",
    }, null, 2));
    await testInfo.attach("home-persisted-evidence", { contentType: "application/json", path: evidence });
  } finally { await fresh.close(); }
});

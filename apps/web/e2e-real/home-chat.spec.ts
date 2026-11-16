import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Real Worker + disposable local D1, without calendar, email, voice or AI provider credentials.
test("Home starts with Today, and added cards and goal edits persist through a fresh session", async ({ page, browser }, testInfo) => {
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
  // A new owner's first landing opens Chat's welcome; Home is one tap away.
  await expect(page.getByRole("heading", { name: "Hi, I'm ME3" })).toBeVisible();
  await page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name: "Home", exact: true }).click();
  // A new install starts with Today alone; the other cards come from Add to Home.
  const todayCard = page.getByRole("article", { name: "Today", exact: true });
  await expect(todayCard.getByRole("link", { name: "Open today's page. 1 of 2 tasks left" })).toBeVisible();
  const mission = page.getByRole("article", { name: "Mission", exact: true });
  const tasks = page.getByRole("article", { name: "Tasks", exact: true });
  await expect(mission).toHaveCount(0); await expect(tasks).toHaveCount(0);
  const addToHome = async (target: typeof page, ...titles: string[]) => {
    await target.getByRole("button", { name: "Add to Home", exact: true }).click();
    for (const title of titles) await target.getByRole("dialog").getByRole("button", { name: title, exact: true }).click();
    await target.getByRole("button", { name: "Close Home editor" }).click();
  };
  await addToHome(page, "Mission", "Tasks");
  await expect(mission).toContainText("Launch the app");
  // The Wheel page shows the lowest seeded area.
  await expect(mission.getByRole("link", { name: "Wheel of Life. Check in" })).toContainText("Joy");
  await expect(tasks.locator(".home-task").first()).toContainText("Send the proposal");
  await page.screenshot({ path: testInfo.outputPath("home-real.png"), fullPage: true });
  // Goal progress is edited from Home without opening Mission.
  // Any scroll closes the goal menu, so bring the card into view before opening it.
  await mission.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await mission.getByRole("button", { name: "Update Launch the app" }).click();
  const goalMenu = page.getByRole("menu", { name: "Update Launch the app" });
  await expect(goalMenu).toBeVisible();
  await goalMenu.getByRole("menuitem", { name: "75%" }).click();
  await expect(mission.getByRole("link", { name: "Launch the app, 75 percent. Open in Mission" })).toBeVisible();
  await page.getByRole("button", { name: "Tasks options" }).click();
  await page.getByRole("menuitem", { name: "Remove from Home", exact: true }).click();
  await page.reload();
  await expect(mission).toContainText("Launch the app");
  await expect(tasks).toHaveCount(0);
  const fresh = await browser.newContext();
  try {
    const login = await fresh.request.post(`${api}/auth/login`, { data: credentials });
    expect(login.ok(), await login.text()).toBeTruthy();
    const next = await fresh.newPage();
    await next.goto("http://127.0.0.1:8787/assistant");
    // The layout lives on the install, so a fresh session shows Mission and not the removed Tasks card.
    await expect(next.getByRole("article", { name: "Mission", exact: true }).getByRole("link", { name: "Launch the app, 75 percent. Open in Mission" })).toBeVisible();
    await expect(next.getByRole("article", { name: "Tasks", exact: true })).toHaveCount(0);
    const savedGoals = await fresh.request.get(`${api}/tasks/goals`);
    expect((await savedGoals.json()).goals[0]).toMatchObject({ id: "launch", areaId: "work", progress: 75, taskIds: [dueId] });
    const evidence = testInfo.outputPath("home-persisted-evidence.json");
    writeFileSync(evidence, JSON.stringify({
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      workingTreeChanges: true,
      command: "pnpm --filter @me3/web exec playwright test --config playwright.real.config.ts e2e-real/home-chat.spec.ts",
      seed: "Isolated local Wrangler D1; all migrations; synthetic owner/tasks/goal/wheel; no developer .dev.vars",
      goalId: "launch", freshSession: "goal progress set on Home read back from real APIs", layout: "add/remove/reload through the install's saved Home layout",
    }, null, 2));
    await testInfo.attach("home-persisted-evidence", { contentType: "application/json", path: evidence });
  } finally { await fresh.close(); }
});

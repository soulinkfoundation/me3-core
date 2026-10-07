import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("main chat persists across sessions while new and project chats stay available", async ({ page, browser }, testInfo) => {
  const api = "http://127.0.0.1:8787/api";
  const credentials = { email: "owner@e2e.example.test", password: "local-e2e-password" };
  const bootstrap = await page.request.post(`${api}/admin/bootstrap`, {
    data: { ...credentials, bootstrapCode: "me3-e2e-local-only", name: "E2E Owner", username: "owner" },
  });
  expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();

  const responses = await Promise.all(Array.from({ length: 6 }, () => page.request.post(`${api}/assistant/threads/primary`)));
  const ids: string[] = [];
  for (const response of responses) {
    expect(response.ok(), await response.text()).toBeTruthy();
    ids.push((await response.json()).thread.id);
  }
  expect(new Set(ids).size).toBe(1);
  const primaryId = ids[0];
  const list = await page.request.get(`${api}/assistant/threads`);
  expect((await list.json()).threads).toHaveLength(1);

  await page.goto("/assistant");
  await expect(page).toHaveURL(new RegExp(`thread=${primaryId}`));
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`thread=${primaryId}`));
  await page.goto("/assistant?new=1");
  await expect(page).toHaveURL(/new=1/);
  await expect(page.locator(".assistant-page")).toBeVisible();
  expect(new URL(page.url()).searchParams.has("thread")).toBe(false);

  const projectResponse = await page.request.post(`${api}/mission-control/projects`, { data: { name: "Synthetic agent project" } });
  expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy();
  const projectId = (await projectResponse.json()).project.id;
  const assignMain = await page.request.patch(`${api}/assistant/threads/${primaryId}`, { data: { projectId } });
  expect(assignMain.status()).toBe(409);
  await page.goto(`/assistant?project=${projectId}`);
  await expect(page.locator(".assistant-page")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("project")).toBe(projectId);
  expect(new URL(page.url()).searchParams.has("thread")).toBe(false);

  const fresh = await browser.newContext();
  try {
    const login = await fresh.request.post(`${api}/auth/login`, { data: credentials });
    expect(login.ok(), await login.text()).toBeTruthy();
    const resolver = await fresh.request.post(`${api}/assistant/threads/primary`);
    expect((await resolver.json()).thread.id).toBe(primaryId);
    const freshPage = await fresh.newPage();
    await freshPage.goto("http://127.0.0.1:4000/assistant");
    await expect(freshPage).toHaveURL(new RegExp(`thread=${primaryId}`));
    await testInfo.attach("primary-conversation-evidence", {
      contentType: "application/json",
      body: JSON.stringify({
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        command: "pnpm --filter @me3/web exec playwright test --config playwright.real.config.ts e2e-real/assistant-primary-thread.spec.ts",
        seed: "Isolated local Wrangler D1; all migrations; synthetic bootstrap owner; no developer .dev.vars",
        primaryId, concurrentRequests: ids.length, freshSession: "same server mapping and browser route",
        projectChats: "separate project route preserved", explicitNewChat: "preserved",
      }, null, 2),
    });
  } finally {
    await fresh.close();
  }
});

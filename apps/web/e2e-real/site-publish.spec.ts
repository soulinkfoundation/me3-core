import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("create, restore, publish, and read a public website", async ({ page }, testInfo) => {
  const handle = `e2e${Date.now().toString(36)}`;
  const name = `E2E Profile ${handle}`;
  const bootstrap = await page.request.post("http://127.0.0.1:8787/api/admin/bootstrap", {
    data: {
      bootstrapCode: "me3-e2e-local-only",
      email: "owner@e2e.example.test",
      name: "E2E Owner",
      username: "owner",
      password: "local-e2e-password",
    },
  });
  expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();

  await page.goto("/create?step=basics");
  const getStarted = page.getByRole("button", { name: "Get started" });
  if (await getStarted.isVisible()) await getStarted.click();
  await page.locator("#name").fill(name);
  await page.locator("#handle").fill(handle);
  await page.getByRole("checkbox", { name: "Make my profile public" }).check();
  await expect(page.locator(".nav-btn.next")).toBeEnabled();

  await page.reload();
  await expect(page.locator("#name")).toHaveValue(name);
  await expect(page.locator("#handle")).toHaveValue(handle);

  for (let step = 0; step < 10 && !(await page.locator(".step-name").innerText()).includes("Publish"); step++) {
    await page.locator(".nav-btn.next").click();
  }
  await expect(page.locator(".step-name")).toContainText("Publish");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page).toHaveURL(new RegExp(`/sites/${handle}(?:$|[/?])`));

  const publicContext = await page.context().browser()!.newContext();
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`http://127.0.0.1:8787/site/${handle}/`);
    await expect(publicPage.getByRole("heading", { name })).toBeVisible();
    const profile = await publicPage.request.get(`http://127.0.0.1:8787/site/${handle}/me.json`);
    expect(profile.ok(), await profile.text()).toBeTruthy();
    expect((await profile.json()).name).toBe(name);
    await testInfo.attach("published-profile", {
      body: JSON.stringify({ revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), command: "pnpm --filter @me3/web test:e2e:real", handle, name, publicUrl: publicPage.url() }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await publicContext.close();
  }
});

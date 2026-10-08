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

  const content = await page.request.get(`/api/sites/${handle}/content`);
  expect(content.ok()).toBeTruthy();
  const sourceProfile = (await content.json()).profile;
  sourceProfile.avatar = "./files/avatar.png";
  const upload = new FormData();
  upload.append("files", new File([JSON.stringify(sourceProfile)], "me.json", { type: "application/json" }));
  upload.append("files", new File([
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYqkAAAAASUVORK5CYII=", "base64"),
  ], "files/avatar.png", { type: "image/png" }));
  const published = await page.request.post(`/api/sites/${handle}/upload`, { multipart: upload });
  expect(published.ok(), await published.text()).toBeTruthy();

  const publicContext = await page.context().browser()!.newContext();
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto("/");
    await expect(publicPage.getByRole("heading", { name })).toBeVisible();
    for (const path of ["/me.json", "/.well-known/me.json", "/me/me.json", `/site/${handle}/me.json`]) {
      const profile = await publicPage.request.get(path);
      expect(profile.ok(), await profile.text()).toBeTruthy();
      expect(profile.headers()["access-control-allow-origin"]).toBe("*");
      const manifest = await profile.json();
      expect(manifest.name).toBe(name);
      expect(manifest.url).toBe("http://127.0.0.1:8787/");
      const avatar = await publicPage.request.get(new URL(manifest.avatar, manifest.id).toString());
      expect(avatar.status()).toBe(200);
      expect(avatar.headers()["content-type"]).toContain("image/png");
    }
    expect((await publicPage.request.get("/me/files/avatar.png")).status()).toBe(200);
    for (const path of ["/me?ref=share", "/me/?ref=share"]) {
      const redirect = await publicPage.request.get(path, { maxRedirects: 0 });
      expect(redirect.status()).toBe(308);
      expect(redirect.headers().location).toBe("http://127.0.0.1:8787/?ref=share");
    }
    await page.goto("/");
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await publicPage.goto("/login?redirect=/account");
    await publicPage.getByPlaceholder("Email").fill("owner@e2e.example.test");
    await publicPage.getByPlaceholder("Password", { exact: true }).fill("local-e2e-password");
    await publicPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(publicPage).toHaveURL(/\/account$/);
    await publicPage.goto("/");
    await expect(publicPage.getByRole("heading", { name })).toBeVisible();
    await testInfo.attach("public-homepage", { body: await publicPage.screenshot(), contentType: "image/png" });
    await testInfo.attach("published-profile", {
      body: JSON.stringify({ revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), command: "pnpm --filter @me3/web exec playwright test --config playwright.real.config.ts", reset: "start-worker.sh creates a fresh temporary D1 database per run", providers: "Cloud API unavailable on localhost:9999; password login and publishing use the real local Worker and D1", handle, name, publicUrl: publicPage.url(), verified: ["published profile persists in a fresh browser session", "root and legacy me.json discovery", "legacy home redirects", "password login returns to private workspace", "authenticated root remains public"] }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await publicContext.close();
  }
});

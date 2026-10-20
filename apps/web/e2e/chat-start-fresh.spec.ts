import { test, expect } from "./fixtures/test";

// UI test: every application API is simulated; the main thread is archived and a new one takes its place.
const oldThread = { id: "old", title: "Main conversation", status: "active", isPrimary: true };
const newThread = { id: "new", title: "Main conversation", status: "active", isPrimary: true };
const oldMessage = { id: "m1", role: "user", text: "Synthetic old conversation", createdAt: "2026-10-01T09:00:00.000Z" };

test("the Chat header starts a fresh conversation after confirming, archiving the old one", async ({ page }, testInfo) => {
  let archived = false;
  const requests: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path.startsWith("/assistant/threads")) requests.push(`${request.method()} ${path}${url.search}`);
    let data: Record<string, unknown> = {};
    if (path === "/assistant/threads/old" && request.method() === "PATCH") {
      expect(request.postDataJSON()).toEqual({ status: "archived" });
      archived = true;
      data = { thread: { ...oldThread, status: "archived" } };
    } else if (path === "/assistant/threads/primary") {
      data = { thread: archived ? newThread : oldThread };
    } else if (path === "/assistant/threads/old/messages") {
      data = { thread: oldThread, messages: [oldMessage], hasMore: false };
    } else if (path === "/assistant/threads/new/messages") {
      data = { thread: newThread, messages: [], hasMore: false };
    } else {
      data = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC" }, workspace: { hasProfileSite: true } }
        : path === "/assistant/threads" ? { threads: [archived ? newThread : oldThread] }
        : path === "/assistant/settings" ? { displayName: "ME3", assistantName: null }
        : path === "/ai-settings" ? { deploymentMode: "managed", providers: [] }
        : path === "/mission-control/approvals" ? { approvals: [] }
        : path === "/plugins" ? { plugins: [] }
        : path === "/navigation-features" ? { features: [] }
        : {};
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });

  await page.goto("/assistant?view=home");
  const startFresh = page.getByRole("button", { name: "Start fresh" });
  // Only the Chat tab offers it.
  await expect(startFresh).toHaveCount(0);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator(".assistant-message")).toContainText("Synthetic old conversation");
  await expect(startFresh).toBeVisible();

  // Dismissing the confirmation keeps the conversation.
  page.once("dialog", dialog => dialog.dismiss());
  await startFresh.click();
  await expect(page.locator(".assistant-message")).toContainText("Synthetic old conversation");
  expect(archived).toBe(false);

  let confirmText = "";
  page.once("dialog", dialog => { confirmText = dialog.message(); void dialog.accept(); });
  await startFresh.click();
  await expect(page.locator(".assistant-message")).toHaveCount(0);
  expect(confirmText).toContain("This one is archived and kept on your ME3");
  expect(requests).toContain("PATCH /assistant/threads/old");
  expect(requests).toContain("GET /assistant/threads/new/messages?limit=50");
  await expect(page).toHaveURL(/thread=new/);

  // It no longer hides in the composer's + menu.
  await page.getByLabel("Message options").click();
  await expect(page.locator(".composer-options__menu")).not.toContainText("Start fresh");
  await page.screenshot({ path: testInfo.outputPath("chat-start-fresh.png") });
});

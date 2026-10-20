import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

// UI test: every application API is simulated with a synthetic 120-message thread.
const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
const history = Array.from({ length: 120 }, (_, index) => ({
  id: `m${index + 1}`,
  role: index % 2 ? "assistant" : "user",
  text: `Synthetic message ${index + 1}`,
  createdAt: new Date(Date.UTC(2026, 9, 1, 9, index)).toISOString(),
}));

async function fixture(page: Page) {
  const historyRequests: string[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    let data: Record<string, unknown> = {};
    if (path === "/assistant/threads/main/messages") {
      historyRequests.push(url.search);
      const limit = Number(url.searchParams.get("limit"));
      const before = url.searchParams.get("before");
      const end = before ? history.findIndex(message => message.id === before) : history.length;
      const start = Math.max(0, end - limit);
      data = { thread, messages: history.slice(start, end), hasMore: start > 0 };
    } else {
      data = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC" }, workspace: { hasProfileSite: true } }
        : path === "/assistant/threads/primary" ? { thread }
        : path === "/assistant/threads" ? { threads: [thread] }
        : path === "/assistant/settings" ? { displayName: "ME3", assistantName: null }
        : path === "/ai-settings" ? { deploymentMode: "managed", providers: [] }
        : path === "/mission-control/approvals" ? { approvals: [] }
        : path === "/plugins" ? { plugins: [] }
        : path === "/navigation-features" ? { features: [] }
        : {};
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  return historyRequests;
}

test("chat opens on the newest messages and loads earlier ones on scroll without losing the reader's place", async ({ page }, testInfo) => {
  const historyRequests = await fixture(page);
  await page.goto("/assistant?view=chat");

  const messages = page.locator(".assistant-message");
  await expect(messages).toHaveCount(50);
  await expect(messages.first()).toContainText("Synthetic message 71");
  await expect(messages.last()).toContainText("Synthetic message 120");
  // Opening never fetches the whole thread.
  expect(new Set(historyRequests)).toEqual(new Set(["?limit=50"]));

  const anchor = page.locator('[data-assistant-message-id="m71"]');
  await anchor.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.scrollingElement?.scrollTo({ top: 0 }));
  await expect(messages).toHaveCount(100);
  expect(historyRequests).toContain("?limit=50&before=m71");
  // The reader stays on the message they were reading instead of jumping to the new top.
  await expect(anchor).toBeInViewport();

  await page.evaluate(() => document.scrollingElement?.scrollTo({ top: 0 }));
  await expect(messages).toHaveCount(120);
  await expect(messages.first()).toContainText("Synthetic message 1");
  await expect(page.getByRole("button", { name: "Show earlier messages" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("chat-history-paging.png") });
});

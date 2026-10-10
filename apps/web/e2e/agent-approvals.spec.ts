import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

const body = `${"The complete email must be reviewed before it is sent. ".repeat(40)}\n<img src=x onerror=alert(1)>\nFinal paragraph.`;
const approval = { id: "core-1", pluginId: "me3.core", actionId: "core_mailbox_send", title: "Send launch email", summary: "Ask Ada to confirm the launch", riskLevel: "high", requestedAt: "2026-10-10T12:00:00Z", payload: { recipient: "ada@example.test", subject: "Launch review", body, target: { id: "draft-1", bodyText: body } } };
// UI tests: every application API and provider is simulated with synthetic owner content.
async function fixture(page: Page, options: { pluginUnavailable?: boolean } = {}) {
  const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (options.pluginUnavailable && ["/calendar/feed", "/mission-control/agent-runs", "/mission-control/plugin-activity"].includes(path)) {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Plugin disabled" }) }); return;
    }
    const data: Record<string, unknown> = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC" }, workspace: { hasProfileSite: true } }
      : path === "/assistant/threads/primary" ? { thread }
      : path === "/assistant/threads" ? { threads: [thread] }
      : path.startsWith("/assistant/threads/") && path.endsWith("/messages") ? { thread, messages: [] }
      : path === "/assistant/settings" ? { displayName: "ME3", assistantName: null }
      : path === "/ai-settings" ? { deploymentMode: "self_hosted", providers: [] }
      : path === "/mission-control/approvals" ? { approvals: [approval] }
      : path === "/mission-control/agent-runs" ? { runs: [] }
      : path === "/mission-control/plugin-activity" ? { activity: [] }
      : path === "/calendar/feed" ? { events: [], bookings: [], reminders: [], tasks: [], sources: [] }
      : path === "/mailbox" ? { mailbox: {} }
      : path === "/mailbox/messages" ? { messages: [] }
      : path === "/soulink/status" ? { recentEvents: [] }
      : path === "/mission-control/tasks" ? { tasks: [] }
      : path === "/journal/archive" ? { entries: [] }
      : path === "/mission-control/wheel" ? { snapshots: [], settings: { segments: [] } }
      : path === "/mission-control/dashboard" ? { settings: { goals: [] } }
      : path === "/mission-control/projects" ? { projects: [] }
      : path === "/assistant/jobs" ? { jobs: [] }
      : path === "/assistant/jobs/recipes" ? { recipes: [] }
      : path === "/sites" ? { sites: [] }
      : path === "/plugins" ? { plugins: [] }
      : path === "/navigation-features" ? { features: [] } : {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
}

test("Core approval survives disabled plugin activity", async ({ page }) => {
  await fixture(page, { pluginUnavailable: true }); await page.goto("/assistant?settings=activity");
  const settings = page.getByRole("dialog", { name: "Assistant settings" });
  await expect(settings).toContainText(approval.title);
  await settings.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("dialog", { name: approval.title })).toContainText(body);
});

for (const journey of [{ surface: "Home", decision: "Approve" }, { surface: "Home", decision: "Decline" }, { surface: "Activity", decision: "Approve" }] as const) {
  test(`${journey.surface} ${journey.decision} refreshes the current chat from saved history`, async ({ page }, testInfo) => {
    await fixture(page); let decided = false;
    const finalReply = journey.decision === "Approve" ? "The launch email was sent to Ada." : "The launch email was declined and remains unsent.";
    await page.route("**/api/assistant/threads/main/messages", async route => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ thread: { id: "main", title: "Main conversation", status: "active", isPrimary: true }, messages: [{ id: "reply", role: "assistant", text: decided ? finalReply : "Please approve the launch email before I send it.", createdAt: "2026-10-10T12:00:00Z" }] }) });
    });
    await page.route("**/api/assistant/approvals/core-1", async route => {
      expect(route.request().postDataJSON()).toEqual({ decision: journey.decision === "Approve" ? "approved" : "declined" }); decided = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await page.route("**/api/mission-control/approvals?*", async route => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvals: decided ? [] : [approval] }) });
    });
    await page.goto("/assistant?view=chat");
    const timeline = page.locator(".assistant-timeline"); await expect(timeline).toContainText("Please approve the launch email");
    if (journey.surface === "Home") await page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name: "Home", exact: true }).click();
    else await page.goto("/assistant?view=chat&settings=activity");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("dialog", { name: approval.title }).getByRole("button", { name: journey.decision, exact: true }).click();
    if (journey.surface === "Home") await page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name: "Chat", exact: true }).click();
    else await page.getByRole("dialog", { name: "Assistant settings" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(timeline).toContainText(finalReply); await expect(timeline).not.toContainText("Please approve the launch email");
    await page.screenshot({ path: testInfo.outputPath("resolved-chat.png"), fullPage: true });
    await page.reload(); await expect(timeline).toContainText(finalReply);
  });
}

test("An approval refresh waits for the active response to finish", async ({ page }) => {
  await fixture(page); let decided = false; let reads = 0; let streamStarted = false; let release: (() => void) | undefined;
  await page.route("**/api/assistant/threads/main/messages", async route => {
    reads++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ thread: { id: "main", title: "Main conversation", status: "active", isPrimary: true }, messages: [{ id: "reply", role: "assistant", text: decided ? "The launch email was sent to Ada." : "Please approve the launch email before I send it." }] }) });
  });
  await page.route("**/api/assistant/chat/turn/stream", async route => {
    streamStarted = true; await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: 'event: done\ndata: {"threadId":"main","replyText":"Your response is complete."}\n\n' });
  });
  await page.route("**/api/assistant/approvals/core-1", async route => {
    decided = true; await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  try {
    await page.goto("/assistant?view=chat"); await expect(page.locator(".assistant-timeline")).toContainText("Please approve the launch email");
    const initialReads = reads; await page.locator("#assistant-console-input").fill("Check tomorrow's reminders");
    await page.getByRole("button", { name: "Send message", exact: true }).click(); await expect.poll(() => streamStarted).toBe(true);
    await page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("dialog", { name: approval.title }).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("dialog", { name: approval.title })).not.toBeVisible();
    expect(reads).toBe(initialReads);
    await page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.locator(".assistant-timeline")).toContainText("Check tomorrow's reminders");
    release?.(); await expect(page.getByRole("button", { name: "Stop response", exact: true })).toHaveCount(0);
    await expect(page.locator(".assistant-timeline")).toContainText("The launch email was sent to Ada."); expect(reads).toBeGreaterThan(initialReads);
  } finally { release?.(); }
});

test("Stop cancels the same active server request and the local response", async ({ page }) => {
  await fixture(page); let requestId = ""; let release: (() => void) | undefined;
  const cancelled: string[] = [];
  await page.route("**/api/assistant/chat/turn/stream", async route => {
    requestId = route.request().postDataJSON().requestId;
    await new Promise<void>(resolve => { release = resolve; });
    await route.abort().catch(() => {});
  });
  await page.route("**/api/assistant/chat/turn/abort", async route => {
    cancelled.push(route.request().postDataJSON().requestId);
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); release?.();
  });
  try {
    await page.goto("/assistant"); await page.locator("#assistant-console-input").fill("Create a reminder");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => requestId).not.toBe(""); await page.getByRole("button", { name: "Stop response", exact: true }).click();
    await expect.poll(() => cancelled).toEqual([requestId]); await expect(page.getByRole("button", { name: "Stop response", exact: true })).toHaveCount(0);
    await expect(page.locator(".assistant-timeline")).toContainText("Stopped.");
  } finally { release?.(); }
});

for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Core review ${mobile ? "phone" : "desktop"} ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await fixture(page); await page.goto("/assistant");
    const review = page.getByRole("button", { name: "Review", exact: true }); await review.click();
    const dialog = page.getByRole("dialog", { name: approval.title });
    await expect(dialog).toContainText(body); await expect(dialog).toContainText("ada@example.test");
    await expect(dialog.locator("img")).toHaveCount(0);
    await expect(dialog.getByRole("heading", { name: approval.title })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("review.png"), fullPage: true });
    expect(await dialog.evaluate(node => node.matches(":modal"))).toBe(true);
    await dialog.getByRole("button", { name: "Close approval review", exact: true }).focus(); await page.keyboard.press("Tab");
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("review-actions.png"), fullPage: true });
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(review).toBeFocused();
  });
}

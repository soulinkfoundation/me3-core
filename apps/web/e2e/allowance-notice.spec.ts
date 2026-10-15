import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

// UI test: every application API is simulated with synthetic owner content.
const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
const notice = (action: { kind: "enable_overages" | "subscribe"; label: string } | null, resetsOn = "2026-11-01") => ({
  kind: "allowance_used", title: "This month's AI allowance is used", message: "Replies now use a lighter model until 1 November.", resetsOn, action,
});

async function fixture(page: Page, messages: unknown[]) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const data: Record<string, unknown> = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC" }, workspace: { hasProfileSite: true } }
      : path === "/assistant/threads/primary" ? { thread }
      : path === "/assistant/threads" ? { threads: [thread] }
      : path === "/assistant/threads/main/messages" ? { thread, messages }
      : path === "/assistant/settings" ? { displayName: "ME3", assistantName: null }
      : path === "/ai-settings" ? { deploymentMode: "managed", providers: [] }
      : path === "/mission-control/approvals" ? { approvals: [] }
      : path === "/calendar/feed" ? { events: [], bookings: [], reminders: [], tasks: [], sources: [] }
      : path === "/mailbox" ? { mailbox: {} }
      : path === "/mailbox/messages" ? { messages: [] }
      : path === "/mission-control/agent-runs" ? { runs: [] }
      : path === "/mission-control/plugin-activity" ? { activity: [] }
      : path === "/soulink/status" ? { recentEvents: [] }
      : path === "/mission-control/tasks" ? { tasks: [] }
      : path === "/journal/archive" ? { entries: [] }
      : path === "/mission-control/wheel" ? { snapshots: [], settings: { segments: [] } }
      : path === "/mission-control/dashboard" ? { settings: { goals: [] } }
      : path === "/mission-control/projects" ? { projects: [] }
      : path === "/sites" ? { sites: [] }
      : path === "/plugins" ? { plugins: [] }
      : path === "/navigation-features" ? { features: [] }
      : {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
}

test("a saved fallback reply explains the used allowance and offers the right next step", async ({ page }, testInfo) => {
  await fixture(page, [
    { id: "q1", role: "user", text: "Plan my week", createdAt: "2026-10-15T09:00:00Z" },
    { id: "a1", role: "assistant", text: "Here is a light plan for your week.", createdAt: "2026-10-15T09:00:05Z", allowanceNotice: notice({ kind: "subscribe", label: "Subscribe" }) },
    { id: "q2", role: "user", text: "And next week?", createdAt: "2026-10-15T09:01:00Z" },
    { id: "a2", role: "assistant", text: "Next week looks open.", createdAt: "2026-10-15T09:01:05Z", allowanceNotice: notice({ kind: "enable_overages", label: "Turn on extra usage" }, "2026-12-01") },
    { id: "q3", role: "user", text: "Thanks", createdAt: "2026-10-15T09:02:00Z" },
    { id: "a3", role: "assistant", text: "You're welcome.", createdAt: "2026-10-15T09:02:05Z", allowanceNotice: notice(null, "2027-01-01") },
  ]);
  await page.goto("/assistant?view=chat");
  const notes = page.getByRole("note");
  await expect(notes).toHaveCount(3);
  await expect(notes.nth(0)).toContainText("This month's AI allowance is used");
  await expect(notes.nth(0)).toContainText("Replies now use a lighter model until 1 November.");
  await expect(notes.nth(0).getByRole("link", { name: "Subscribe" })).toHaveAttribute("href", "https://me3.app/pricing");
  await expect(notes.nth(1).getByRole("link", { name: "Turn on extra usage" })).toHaveAttribute("href", "/account?section=ai");
  await expect(notes.nth(2).getByRole("link")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("allowance-notice.png"), fullPage: true });
});

test("replies within the allowance show no notice", async ({ page }) => {
  await fixture(page, [{ id: "a1", role: "assistant", text: "All good.", createdAt: "2026-10-15T09:00:05Z" }]);
  await page.goto("/assistant?view=chat");
  await expect(page.locator(".assistant-timeline")).toContainText("All good.");
  await expect(page.getByRole("note")).toHaveCount(0);
});

test("the notice appears once per month even though every lighter-model reply carries it", async ({ page }) => {
  await fixture(page, [
    { id: "a1", role: "assistant", text: "First lighter reply.", createdAt: "2026-10-15T09:00:05Z", allowanceNotice: notice({ kind: "subscribe", label: "Subscribe" }) },
    { id: "q2", role: "user", text: "More please", createdAt: "2026-10-15T09:01:00Z" },
    { id: "a2", role: "assistant", text: "Second lighter reply.", createdAt: "2026-10-15T09:01:05Z", allowanceNotice: notice({ kind: "subscribe", label: "Subscribe" }) },
  ]);
  await page.goto("/assistant?view=chat");
  await expect(page.locator(".assistant-timeline")).toContainText("Second lighter reply.");
  await expect(page.getByRole("note")).toHaveCount(1);
});

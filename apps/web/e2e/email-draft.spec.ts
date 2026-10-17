import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

// UI test: every application API is simulated with synthetic owner content.
const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
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

test("a saved draft and an address-less draft from ME3 show as editable cards", async ({ page }, testInfo) => {
  await fixture(page, [
    { id: "q1", role: "user", text: "Email Ada asking about Thursday", createdAt: "2026-10-17T09:00:00Z" },
    { id: "a1", role: "assistant", text: "Here's the draft.", createdAt: "2026-10-17T09:00:05Z", emailDraft: { draftId: "d1", to: "ada@example.invalid", recipientName: "Ada", contactId: null, subject: "Thursday", body: "Hi Ada, does Thursday work?", replyToMessageId: null } },
    { id: "q2", role: "user", text: "Email Erum about a session next week", createdAt: "2026-10-17T09:01:00Z" },
    { id: "a2", role: "assistant", text: "I couldn't find Erum's email address; add it on the card.", createdAt: "2026-10-17T09:01:05Z", emailDraft: { draftId: null, to: "", recipientName: "Erum Hayat", contactId: "c-erum", subject: "Session next week", body: "Hi Erum, are you free for a session next week?", replyToMessageId: null } },
  ]);
  await page.goto("/assistant?view=chat");
  const cards = page.locator(".assistant-email-draft-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByRole("textbox", { name: "To" })).toHaveValue("ada@example.invalid");
  await expect(cards.nth(0)).toContainText("Saved draft");
  await expect(cards.nth(1).getByRole("textbox", { name: "To" })).toHaveValue("");
  await expect(cards.nth(1)).toContainText("Needs recipient's email");
  await expect(cards.nth(1).getByRole("textbox", { name: "Subject" })).toHaveValue("Session next week");
  await page.screenshot({ path: testInfo.outputPath("email-draft.png"), fullPage: true });
});

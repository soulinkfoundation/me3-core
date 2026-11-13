import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

// UI test: every application API is simulated with synthetic mail; no provider is contacted.
// Failure modes (me3-kvu8.25, me3-kvu8.29, me3-kvu8.24): archiving the open conversation leaves an
// empty reading pane instead of the next conversation; on a phone it does not return to the list;
// Reply all drops the people in Cc or adds the owner's own address; Send goes at once with no way
// back; Undo does not stop the send or loses what the owner wrote.

type Call = { method: string; path: string; body: unknown };
const OWNER = "kieran@me3.test";

function threadSummary(id: string, name: string, subject: string, minute: number) {
  return {
    id, subject, participants: [`${name.toLowerCase()}@example.test`, OWNER], latestSnippet: `${subject} snippet`, latestMessageId: `${id}-m1`,
    messageCount: 1, unreadCount: 0, attachmentCount: 0, lastActivity: `2026-11-13T09:${String(minute).padStart(2, "0")}:00.000Z`,
    sender: { name, address: `${name.toLowerCase()}@example.test`, initials: name.slice(0, 2).toUpperCase(), avatarUrl: null, contactId: null },
    cleanSnippet: `${subject} snippet`, triage: null,
  };
}
const THREADS = [threadSummary("t1", "Rosa", "Studio lease", 30), threadSummary("t2", "Maya", "Thursday session", 20), threadSummary("t3", "Leo", "Meetup talk", 10)];

function inbound(thread: (typeof THREADS)[number]) {
  return {
    id: thread.latestMessageId, direction: "inbound", kind: "email", status: "received", threadKey: thread.id, fromAddress: thread.sender.address, fromName: thread.sender.name,
    toAddress: OWNER, toAddresses: [OWNER], ccAddresses: thread.id === "t1" ? ["ben@studio.test", OWNER] : [], bccAddresses: [], recipientAddresses: [OWNER],
    subject: thread.subject, body: `${thread.subject}: can you confirm?`, htmlBody: null, preview: `${thread.subject}: can you confirm?`, metadata: {}, unsubscribeAction: null,
    sourceId: null, folder: "inbox", spam: false, readAt: "2026-11-13T09:40:00.000Z", unread: false, agentSummary: null, agentLabels: [], createdBy: "provider",
    receivedAt: thread.lastActivity, sentAt: null, approvedAt: null, createdAt: thread.lastActivity, updatedAt: thread.lastActivity, sender: thread.sender, sendAfter: null,
  };
}

async function fixture(page: Page) {
  const calls: Call[] = [];
  const archived = new Set<string>();
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    if (method !== "GET") calls.push({ method, path, body });
    const threadMatch = path.match(/^\/mailbox\/threads\/([^/]+)$/);
    const thread = threadMatch ? THREADS.find(candidate => candidate.id === decodeURIComponent(threadMatch[1])) : null;
    const move = path.match(/^\/mailbox\/threads\/([^/]+)\/move$/);
    if (move && method === "POST") {
      const id = decodeURIComponent(move[1]);
      if ((body as { folder?: string })?.folder === "inbox") archived.delete(id); else archived.add(id);
    }
    const data: unknown = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC", email: "kieran@gmail.test" }, workspace: { hasProfileSite: true } }
      : path === "/mailbox" ? { mailbox: { aliasAddress: OWNER, status: "active", forwardingStatus: "verified" }, sources: [] }
      : path === "/mailbox/threads" ? { threads: url.searchParams.get("folder") === "inbox" ? THREADS.filter(candidate => !archived.has(candidate.id)) : [], nextCursor: null }
      : thread ? { thread: { ...thread, location: "inbox" }, messages: [inbound(thread)] }
      : path === "/mailbox/messages" ? { messages: [], total: 0, limit: 50, offset: 0 }
      : path === "/mailbox/brief" ? { needsYou: [], cleared: [], followUps: [], loginCodes: [], handled: { total: 0, groups: [] }, fyi: { inboxLeft: 3, unread: 0 }, checkedAt: "2026-11-13T09:41:00.000Z", dayStartsAt: "2026-11-13T00:00:00.000Z" }
      : path === "/mailbox/signature" ? { signature: null }
      : path === "/mailbox/drafts" && method === "POST" ? { draft: { ...inbound(THREADS[0]), id: "draft-1", direction: "outbound", kind: "draft", status: "pending_approval", folder: "drafts" } }
      : path === "/mailbox/drafts/draft-1/approve" ? { held: true, id: "draft-1", sendAfter: new Date(Date.now() + 10_000).toISOString() }
      : path === "/mailbox/drafts/draft-1/cancel-send" ? { ok: true, cancelled: true }
      : path === "/email-provider-settings" ? { activeProviderId: "managed", providers: [] }
      : path === "/contacts" ? { contacts: [] }
      : path === "/plugins" ? { plugins: [] }
      : path === "/navigation-features" ? { features: [] }
      : path === "/sites" ? { sites: [] }
      : {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  return { calls };
}

const reader = (page: Page) => page.locator(".thread-pane");

test("archiving the open conversation opens the next one, then the one above, then the empty state", async ({ page }, testInfo) => {
  const { calls } = await fixture(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/email?tab=inbox");
  await page.getByText("Thursday session").first().click();
  await expect(reader(page).getByRole("heading", { name: "Thursday session" })).toBeVisible();

  await reader(page).getByRole("button", { name: "Archive" }).click();
  expect(calls.find(call => call.path === "/mailbox/threads/t2/move")?.body).toEqual({ folder: "archive", fromFolder: "inbox" });
  // The next older conversation (the one below) opens.
  await expect(reader(page).getByRole("heading", { name: "Meetup talk" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("auto-advance.png") });

  // It was the last one, so the one above opens.
  await reader(page).getByRole("button", { name: "Archive" }).click();
  await expect(reader(page).getByRole("heading", { name: "Studio lease" })).toBeVisible();

  await reader(page).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Nothing in Inbox.")).toBeVisible();
  await expect(reader(page).getByRole("heading", { name: "Studio lease" })).toHaveCount(0);
});

test("on a phone, archiving the open conversation returns to the list", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/email?tab=inbox");
  await page.getByText("Thursday session").first().click();
  await expect(reader(page).getByRole("heading", { name: "Thursday session" })).toBeVisible();
  await reader(page).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Studio lease").first()).toBeVisible();
  await expect(reader(page).getByRole("heading", { name: "Meetup talk" })).toHaveCount(0);
});

test("Reply all keeps the people in Cc, and Send waits ten seconds with an Undo that brings the reply back", async ({ page }, testInfo) => {
  const { calls } = await fixture(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/email?tab=inbox");
  await page.getByText("Studio lease").first().click();
  await reader(page).getByRole("button", { name: "Reply all" }).click();
  const reply = page.getByRole("region", { name: "Reply" });
  await expect(reply).toContainText("rosa@example.test");
  await expect(reply).toContainText("ben@studio.test");
  await expect(reply).not.toContainText(OWNER);

  await reply.getByRole("textbox", { name: "Reply" }).fill("Yes, the terms work for us.");
  await reply.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sending in 10 seconds.")).toBeVisible();
  const draft = calls.find(call => call.path === "/mailbox/drafts")?.body as { to?: string; cc?: string[]; textBody?: string };
  expect(draft.to).toBe("rosa@example.test");
  expect(draft.cc).toEqual(["ben@studio.test"]);
  expect(calls.find(call => call.path === "/mailbox/drafts/draft-1/approve")?.body).toEqual({ holdSeconds: 10 });
  await page.screenshot({ path: testInfo.outputPath("send-undo.png") });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => calls.some(call => call.path === "/mailbox/drafts/draft-1/cancel-send")).toBe(true);
  await expect(page.getByRole("region", { name: "Reply" }).getByRole("textbox", { name: "Reply" })).toContainText("Yes, the terms work for us.");
});

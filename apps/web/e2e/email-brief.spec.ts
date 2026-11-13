import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

// UI test: every application API is simulated with synthetic mail; no provider is contacted.
// Failure modes (me3-kvu8.23): a row carries more than its Done check; ME3's draft cannot be read
// or edited where it is shown, or an edit is sent without being saved; Send goes at once, or Undo
// does not bring the row back; Discard draft removes the whole row; Done cannot be undone; what
// left the Brief cannot be seen or brought back; the old "Handled by ME3" section and "That's
// everything for now" footer are still there; a follow-up is not a normal row; the keyboard
// shortcuts fire while typing in the draft.

type Call = { method: string; path: string; body: unknown };
const sender = (name: string) => ({ name, address: `${name.split(" ")[0].toLowerCase()}@example.test`, initials: name.split(" ").map(part => part[0]).join(""), avatarUrl: null, contactId: null });
const item = (id: string, name: string, subject: string, summary: string, extra: Record<string, unknown> = {}) => ({
  messageId: id, threadId: `<${id}@mail.test>`, sender: sender(name), subject, summary, receivedAt: "2026-11-13T09:52:00.000Z", unread: true, urgency: "normal", pending: false,
  primaryAction: { kind: "draft_reply", label: "Draft a reply" }, secondaryAction: { kind: "remind_later", label: "Tomorrow" }, draft: null, duplicates: 0, relatedMessageIds: [], ...extra,
});

async function fixture(page: Page) {
  const calls: Call[] = [];
  const state = {
    needsYou: [
      item("maya", "Maya Chen", "Thursday session", "Wants to move Thursday's session to Friday at 10:00.", {
        primaryAction: { kind: "send_draft", label: "Send reply" }, secondaryAction: { kind: "edit_draft", label: "Edit" },
        draft: { id: "d-maya", preview: "Hi Maya, Friday at 10:00 works", body: "Hi Maya,\n\nFriday at 10:00 works for me.\n\nJordan", updatedAt: "2026-11-13T09:53:00.000Z" },
      }),
      item("harbour", "Harbour Energy", "Payment failed", "Direct debit for £84.20 failed. They retry on Friday.", { primaryAction: { kind: "open_url", label: "Update payment details", url: "https://harbour.example/pay" } }),
      item("leo", "Leo Park", "Speaking at Makers Meetup", "Asks if you'd give a 15-minute talk on 4 December."),
    ] as Array<ReturnType<typeof item>>,
    cleared: [{ messageId: "sam", threadId: "<sam@mail.test>", sender: sender("Sam Ortiz"), subject: "Invoice", how: "replied", clearedAt: "2026-11-13T08:14:00.000Z" }] as Array<Record<string, unknown>>,
    held: null as ReturnType<typeof item> | null,
  };
  const followUp = {
    contactId: "p-aoife", name: "Aoife", organisation: "IMTA", email: "aoife@imta.example", offer: "free setup for 10 members", subject: "ME3 for IMTA members",
    daysWaiting: 9, followUpNumber: 1, followUpCap: 2, draft: { id: "d-aoife", preview: "Hi Aoife, just bringing this back", body: "Hi Aoife, just bringing this back to the top of your inbox.", updatedAt: "2026-11-13T07:00:00.000Z" },
  };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    if (method !== "GET") calls.push({ method, path, body });
    let data: unknown = {};
    const briefAction = path.match(/^\/mailbox\/brief\/([^/]+)\/(done|reopen|draft|snooze)$/);
    if (path === "/auth/me") data = { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC" }, workspace: { hasProfileSite: true } };
    else if (path === "/mailbox") data = { mailbox: { aliasAddress: "kieran@me3.test", status: "active", forwardingStatus: "verified" }, sources: [] };
    else if (path === "/mailbox/brief") data = {
      needsYou: state.needsYou, cleared: state.cleared, followUps: [followUp], loginCodes: [],
      handled: { total: 3, groups: [{ kind: "notification", title: "3 notifications archived", count: 3, amountCents: null, currency: null, byRule: false, items: [{ id: "h1", messageId: "n1", threadId: "<n1@mail.test>", kind: "notification", label: "Notification archived", detail: "A new sign-in", sender: sender("GitHub"), subject: "A new sign-in", amountCents: null, currency: null, createdAt: "2026-11-13T07:00:00.000Z", undo: { kind: "move_to_inbox" } }] }] },
      fyi: { inboxLeft: 9, unread: 2 }, checkedAt: "2026-11-13T10:41:00.000Z", dayStartsAt: "2026-11-13T00:00:00.000Z",
    };
    else if (briefAction && method === "POST") {
      const [, id, action] = briefAction;
      const target = state.needsYou.find(candidate => candidate.messageId === id);
      if (action === "done" && target) {
        state.needsYou = state.needsYou.filter(candidate => candidate !== target);
        state.cleared = [{ messageId: id, threadId: target.threadId, sender: target.sender, subject: target.subject, how: "done", clearedAt: "2026-11-13T10:45:00.000Z" }, ...state.cleared];
      } else if (action === "reopen") {
        state.cleared = state.cleared.filter(candidate => candidate.messageId !== id);
        state.needsYou = [...state.needsYou, item("leo", "Leo Park", "Speaking at Makers Meetup", "Asks if you'd give a 15-minute talk on 4 December.")];
      } else if (action === "draft" && target) {
        target.draft = { id: `d-${id}`, preview: "Hi Leo, I'd be glad to", body: "Hi Leo,\n\nI'd be glad to give the talk.\n\nJordan", updatedAt: "2026-11-13T10:46:00.000Z" } as never;
        target.primaryAction = { kind: "send_draft", label: "Send reply" };
        data = { draft: { id: `d-${id}` } };
      }
      if (action !== "draft") data = { ok: true };
    } else if (path === "/mailbox/drafts/d-maya" && method === "PUT") data = { draft: { id: "d-maya", updatedAt: "2026-11-13T10:44:00.000Z" } };
    else if (path === "/mailbox/drafts/d-maya/approve") {
      state.held = state.needsYou.find(candidate => candidate.messageId === "maya") || null;
      state.needsYou = state.needsYou.filter(candidate => candidate.messageId !== "maya");
      data = { held: true, id: "d-maya", sendAfter: new Date(Date.now() + 10_000).toISOString() };
    } else if (path === "/mailbox/drafts/d-maya/cancel-send") {
      if (state.held) state.needsYou = [state.held, ...state.needsYou];
      state.held = null;
      data = { ok: true, cancelled: true };
    } else if (path === "/mailbox/drafts/d-maya/reject") {
      const maya = state.needsYou.find(candidate => candidate.messageId === "maya");
      if (maya) { maya.draft = null as never; maya.primaryAction = { kind: "draft_reply", label: "Draft a reply" }; }
      data = { draft: { id: "d-maya", status: "rejected" } };
    } else if (path === "/mailbox/threads") data = { threads: [], nextCursor: null };
    else if (path === "/mailbox/messages") data = { messages: [], total: 0, limit: 50, offset: 0 };
    else if (path === "/mailbox/signature") data = { signature: null };
    else if (path === "/plugins") data = { plugins: [] };
    else if (path === "/navigation-features") data = { features: [] };
    else if (path === "/sites") data = { sites: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  return { calls };
}

const brief = (page: Page) => page.getByRole("region", { name: "Brief" });
const rows = (page: Page) => brief(page).locator(".brief-row");

test("each row is one decision: ME3's draft is edited in place and Send waits ten seconds with Undo", async ({ page }, testInfo) => {
  const { calls } = await fixture(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/email?tab=brief");

  await expect(brief(page).getByRole("heading", { level: 1 })).toHaveText("4 things need you");
  await expect(rows(page)).toHaveCount(4);
  await expect(brief(page).getByRole("button", { name: /^Done: clear/ })).toHaveCount(4);
  await expect(brief(page)).not.toContainText("Handled by ME3");
  await expect(brief(page)).not.toContainText("That's everything for now");
  // A follow-up is a row like the others.
  await expect(rows(page).nth(3)).toContainText("Aoife · IMTA");

  // The top row is open: the draft is right there, editable.
  const draft = brief(page).getByRole("textbox", { name: "ME3's draft reply to Maya Chen" });
  await expect(draft).toHaveValue(/Friday at 10:00 works for me/);
  await page.screenshot({ path: testInfo.outputPath("brief-v2.png"), fullPage: true });
  await draft.fill("Hi Maya,\n\nFriday at 10 is perfect.\n\nJordan");
  await rows(page).first().getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Sending to Maya Chen in 10 seconds.")).toBeVisible();
  expect(calls.find(call => call.method === "PUT" && call.path === "/mailbox/drafts/d-maya")?.body).toEqual({ textBody: "Hi Maya,\n\nFriday at 10 is perfect.\n\nJordan", expectedUpdatedAt: "2026-11-13T09:53:00.000Z" });
  expect(calls.find(call => call.path === "/mailbox/drafts/d-maya/approve")?.body).toEqual({ holdSeconds: 10 });
  await expect(brief(page).getByRole("heading", { level: 1 })).toHaveText("3 things need you");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => calls.some(call => call.path === "/mailbox/drafts/d-maya/cancel-send")).toBe(true);
  await expect(brief(page).getByRole("heading", { level: 1 })).toHaveText("4 things need you");
  await expect(rows(page).first()).toContainText("Maya Chen");
});

test("Done clears a row with Undo, and what left the Brief opens from the subline with Bring back", async ({ page }) => {
  const { calls } = await fixture(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/email?tab=brief");
  await expect(rows(page)).toHaveCount(4);

  await brief(page).getByRole("button", { name: "Done: clear Leo Park from the Brief" }).click();
  expect(calls.some(call => call.path === "/mailbox/brief/leo/done")).toBe(true);
  await expect(rows(page)).toHaveCount(3);

  await brief(page).getByRole("button", { name: "2 cleared" }).click();
  const cleared = brief(page).getByRole("list", { name: "Cleared today" });
  await expect(cleared).toContainText("Sam Ortiz");
  await expect(cleared).toContainText("you replied");
  await expect(cleared).toContainText("you marked it done");
  await cleared.getByRole("listitem").filter({ hasText: "Leo Park" }).getByRole("button", { name: "Bring back" }).click();
  expect(calls.some(call => call.path === "/mailbox/brief/leo/reopen")).toBe(true);
  await expect(rows(page)).toHaveCount(4);

  await brief(page).getByRole("button", { name: "ME3 handled 3 today" }).click();
  await expect(brief(page)).toContainText("3 notifications archived");
});

test("Discard draft keeps the row, a quick answer writes the draft in place, and the keys stay out of the way while typing", async ({ page }, testInfo) => {
  const { calls } = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/email?tab=brief");
  await expect(rows(page)).toHaveCount(4);

  // Typing "e" or "j" in the draft is typing, not a shortcut.
  const draft = brief(page).getByRole("textbox", { name: "ME3's draft reply to Maya Chen" });
  await draft.click();
  await page.keyboard.type("je");
  expect(calls.some(call => call.path.endsWith("/done"))).toBe(false);

  await rows(page).first().getByRole("button", { name: "Discard draft" }).click();
  expect(calls.some(call => call.path === "/mailbox/drafts/d-maya/reject")).toBe(true);
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).first()).toContainText("Draft discarded");

  await rows(page).nth(2).getByRole("button", { name: /Leo Park/ }).first().click();
  await rows(page).nth(2).getByRole("button", { name: "Say yes" }).click();
  expect(calls.find(call => call.path === "/mailbox/brief/leo/draft")?.body).toEqual({ intent: "accept" });
  await expect(brief(page).getByRole("textbox", { name: "ME3's draft reply to Leo Park" })).toHaveValue(/glad to give the talk/);
  await page.screenshot({ path: testInfo.outputPath("brief-v2-phone-dark.png"), fullPage: true });

  // With a row focused, J moves down and E clears the open row.
  await rows(page).nth(2).locator(".brief-row__main").focus();
  await page.keyboard.press("k");
  await expect(rows(page).nth(1)).toHaveClass(/brief-row--open/);
  await page.keyboard.press("e");
  await expect.poll(() => calls.some(call => call.path === "/mailbox/brief/harbour/done")).toBe(true);
});

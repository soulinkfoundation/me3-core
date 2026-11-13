import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

// UI test: every application API is simulated with synthetic mail; no provider is contacted.
// Failure modes (me3-kvu8.25, me3-kvu8.29, me3-kvu8.24): archiving the open conversation leaves an
// empty reading pane instead of the next conversation; on a phone it does not return to the list;
// Reply all drops the people in Cc or adds the owner's own address; Send goes at once with no way
// back; Undo does not stop the send or loses what the owner wrote.
// Reply box and message actions (me3-kvu8.22, .24, .29): Reply on an earlier message answers the
// latest one instead; switching to Forward loses what was typed or keeps the reply's recipients; a
// removed recipient still gets the mail; sending ME3's draft adds a second draft or drops the
// owner's edits, and closing the box deletes it; the compose window and a draft card send at once
// with no Undo, or a held draft can be sent a second time; the Sent view offers an Archive that
// does nothing; a dropped file is not attached; Delete this message removes the whole
// conversation; printing prints the app around the conversation or leaves folded messages out.

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

/** Leo's conversation as a long one: five earlier messages (the fourth unread) and a latest one with quoted history, an embedded picture and a PDF. */
const longThread = { on: false };
/** Maya's conversation with a reply ME3 drafted, waiting for the owner. */
const agentDraft = { on: false };
function me3Draft(thread: (typeof THREADS)[number], overrides: Record<string, unknown> = {}) {
  return {
    ...inbound(thread), id: "me3-draft", direction: "outbound", kind: "draft", status: "pending_approval", folder: "drafts", createdBy: "agent",
    fromAddress: OWNER, toAddress: thread.sender.address, toAddresses: [], ccAddresses: [], subject: `Re: ${thread.subject}`,
    body: "Thursday at 10 works for me.", preview: "Thursday at 10 works for me.", updatedAt: "2026-11-13T09:25:00.000Z", sendAfter: null, ...overrides,
  };
}
function longMessages(thread: (typeof THREADS)[number]) {
  const earlier = [1, 2, 3, 4, 5].map(number => ({
    ...inbound(thread), id: `t3-old${number}`, body: `Earlier message ${number}`, preview: `Earlier message ${number}`,
    unread: number === 4, readAt: number === 4 ? null : "2026-11-12T09:00:00.000Z", createdAt: `2026-11-12T0${number}:00:00.000Z`, receivedAt: `2026-11-12T0${number}:00:00.000Z`,
  }));
  const latest = {
    ...inbound(thread), id: "t3-latest", body: "Here is the plan.",
    htmlBody: `<div>Here is the plan.</div><img src="cid:plan@meetup" alt="Plan"><div>Leo · Makers Meetup</div><div class="gmail_quote"><div>On 12 Nov, Jordan wrote:</div><blockquote>What is the plan?${"<p>An earlier line of the conversation.</p>".repeat(24)}</blockquote></div>`,
    metadata: { attachments: [
      { filename: "plan.png", mimeType: "image/png", disposition: "inline", size: 2048, storageKey: "k1", contentId: "<plan@meetup>" },
      { filename: "terms.pdf", mimeType: "application/pdf", disposition: "attachment", size: 182000, storageKey: "k2", contentId: null },
    ] },
  };
  return [...earlier, latest];
}

async function fixture(page: Page) {
  const calls: Call[] = [];
  const archived = new Set<string>();
  const held = new Set<string>();
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
    const draftAction = path.match(/^\/mailbox\/drafts\/([^/]+)\/(approve|cancel-send|reject)$/);
    if (draftAction && method === "POST") {
      if (draftAction[2] === "approve") held.add(draftAction[1]); else held.delete(draftAction[1]);
    }
    const draftSave = path.match(/^\/mailbox\/drafts\/([^/]+)$/);
    const data: unknown = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC", email: "kieran@gmail.test" }, workspace: { hasProfileSite: true } }
      : path === "/mailbox" ? { mailbox: { aliasAddress: OWNER, status: "active", forwardingStatus: "verified" }, sources: [] }
      : path === "/mailbox/threads" ? { threads: url.searchParams.get("folder") === "inbox" ? THREADS.filter(candidate => !archived.has(candidate.id)) : url.searchParams.get("folder") === "sent" ? [THREADS[0]] : [], nextCursor: null }
      : thread?.id === "t3" && url.searchParams.get("long") !== "0" && longThread.on ? { thread: { ...thread, location: "inbox", messageCount: 6 }, messages: longMessages(thread) }
      : thread?.id === "t2" && agentDraft.on ? { thread: { ...thread, location: "inbox" }, messages: [inbound(thread), me3Draft(thread, held.has("me3-draft") ? { sendAfter: "2026-11-13T09:26:00.000Z" } : {})] }
      : thread ? { thread: { ...thread, location: "inbox" }, messages: [inbound(thread)] }
      : path === "/mailbox/messages" ? { messages: [], total: 0, limit: 50, offset: 0 }
      : path === "/mailbox/brief" ? { needsYou: [], cleared: [], followUps: [], loginCodes: [], handled: { total: 0, groups: [] }, fyi: { inboxLeft: 3, unread: 0 }, checkedAt: "2026-11-13T09:41:00.000Z", dayStartsAt: "2026-11-13T00:00:00.000Z" }
      : path === "/mailbox/signature" ? { signature: null }
      : path === "/mailbox/drafts" && method === "POST" ? { draft: { ...inbound(THREADS[0]), id: "draft-1", direction: "outbound", kind: "draft", status: "pending_approval", folder: "drafts" } }
      : draftAction?.[2] === "approve" ? { held: true, id: draftAction[1], sendAfter: new Date(Date.now() + 10_000).toISOString() }
      : draftAction?.[2] === "cancel-send" ? { ok: true, cancelled: true }
      : draftSave && method === "PUT" ? { draft: me3Draft(THREADS[1], { id: draftSave[1], updatedAt: "2026-11-13T09:27:00.000Z" }) }
      : path === "/mailbox/attachments" ? { attachments: [{ filename: "signed.pdf", mimeType: "application/pdf", size: 4096, storageKey: "up1" }] }
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
  await reader(page).getByRole("button", { name: "Reply all", exact: true }).click();
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

test("a long conversation folds its middle, opens what is unread, trims quoted history and lists only real attachments", async ({ page }, testInfo) => {
  longThread.on = true;
  try {
    await fixture(page);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto("/email?tab=inbox");
    await page.getByText("Meetup talk").first().click();
    await expect(reader(page).getByRole("heading", { name: "Meetup talk" })).toBeVisible();

    // Four read earlier messages fold to the first, a count and the last; the unread one is open.
    await expect(reader(page).getByRole("button", { name: "Show 2 more messages" })).toBeVisible();
    await expect(reader(page).locator(".message-collapsed")).toHaveCount(2);
    await expect(reader(page).locator(".message-card")).toHaveCount(2);
    await reader(page).getByRole("button", { name: "Show 2 more messages" }).click();
    await expect(reader(page).locator(".message-collapsed")).toHaveCount(4);

    // The picture the email shows in place is not listed again; the PDF is.
    const latest = reader(page).locator(".message-card").last();
    await expect(latest.locator(".attachment-chip")).toHaveCount(1);
    await expect(latest.locator(".attachment-chip")).toContainText("terms.pdf");

    // Quoted history sits behind the toggle; the signature stays in view.
    const body = latest.frameLocator("iframe.message-html-frame");
    await expect(body.getByText("Leo · Makers Meetup")).toBeVisible();
    await expect(body.getByText("What is the plan?")).toBeHidden();
    const before = await latest.locator("iframe.message-html-frame").evaluate(frame => (frame as HTMLIFrameElement).offsetHeight);
    await body.locator("details.me3-quote > summary").click();
    await expect(body.getByText("What is the plan?")).toBeVisible();
    await expect.poll(() => latest.locator("iframe.message-html-frame").evaluate(frame => (frame as HTMLIFrameElement).offsetHeight)).toBeGreaterThan(before);
    await page.screenshot({ path: testInfo.outputPath("conversation-long.png") });
  } finally {
    longThread.on = false;
  }
});

test("Reply on an earlier message answers that message, and switching to Forward keeps the note but not the recipients", async ({ page }, testInfo) => {
  longThread.on = true;
  try {
    const { calls } = await fixture(page);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto("/email?tab=inbox");
    await page.getByText("Meetup talk").first().click();
    // The unread earlier message is open: its own Reply answers it, not the latest message.
    const earlier = reader(page).locator(".message-card").first();
    await expect(earlier.frameLocator("iframe.message-html-frame").getByText("Earlier message 4")).toBeVisible();
    await earlier.getByRole("button", { name: "Reply to Leo" }).click();
    const reply = page.getByRole("region", { name: "Reply" });
    await expect(reply.getByLabel("Reply type")).toHaveValue("reply");
    await expect(reply).toContainText("leo@example.test");
    await reply.getByRole("textbox", { name: "Reply" }).fill("Passing this on.");

    await reply.getByLabel("Reply type").selectOption("forward");
    await expect(reply.getByRole("textbox", { name: "Reply" })).toContainText("Passing this on.");
    await expect(reply).not.toContainText("leo@example.test");
    await expect(reply).toContainText("Fwd: Meetup talk");
    // Nobody to send it to yet.
    await expect(reply.getByRole("button", { name: "Send" })).toBeDisabled();
    await reply.getByRole("combobox", { name: "To" }).or(reply.getByRole("textbox", { name: "To" })).first().fill("sam@partner.test");
    await reply.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Sending in 10 seconds.")).toBeVisible();
    const draft = calls.find(call => call.path === "/mailbox/drafts")?.body as { to?: string; subject?: string; textBody?: string; replyToMessageId?: string };
    expect(draft.to).toBe("sam@partner.test");
    expect(draft.subject).toBe("Fwd: Meetup talk");
    expect(draft.textBody).toContain("Passing this on.");
    expect(draft.textBody).toContain("---------- Forwarded message ---------");
    expect(draft.textBody).toContain("Earlier message 4");
    expect(draft.replyToMessageId).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath("forward.png") });
  } finally {
    longThread.on = false;
  }
});

test("a recipient the owner removes from Reply all does not get the mail, and a dropped file is attached", async ({ page }, testInfo) => {
  const { calls } = await fixture(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/email?tab=inbox");
  await page.getByText("Studio lease").first().click();
  await reader(page).getByRole("button", { name: "Reply all", exact: true }).click();
  const reply = page.getByRole("region", { name: "Reply" });
  await reply.getByRole("button", { name: /Remove ben@studio.test/ }).click();
  await expect(reply).not.toContainText("ben@studio.test");

  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["signed"], "signed.pdf", { type: "application/pdf" }));
    return transfer;
  });
  await reply.dispatchEvent("dragover", { dataTransfer: data });
  await reply.dispatchEvent("drop", { dataTransfer: data });
  await expect(reply.locator(".compose-attachment-chip")).toContainText("signed.pdf");

  await reply.getByRole("textbox", { name: "Reply" }).fill("Signed copy attached.");
  await page.screenshot({ path: testInfo.outputPath("reply-box.png") });
  await reply.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sending in 10 seconds.")).toBeVisible();
  const draft = calls.find(call => call.path === "/mailbox/drafts")?.body as { to?: string; cc?: string[]; uploadedAttachments?: Array<{ storageKey: string }> };
  expect(draft.to).toBe("rosa@example.test");
  expect(draft.cc).toEqual([]);
  expect(draft.uploadedAttachments?.map(attachment => attachment.storageKey)).toEqual(["up1"]);
});

test("ME3's draft opens in the reply box, is sent as the owner edited it, and stays a draft when the box is closed", async ({ page }, testInfo) => {
  agentDraft.on = true;
  try {
    const { calls } = await fixture(page);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto("/email?tab=inbox");
    await page.getByText("Thursday session").first().click();
    const card = reader(page).getByRole("region", { name: "ME3 drafted a reply" });
    await expect(card).toContainText("Thursday at 10 works for me.");
    await card.getByRole("button", { name: "Review" }).click();
    const reply = page.getByRole("region", { name: "Reply", exact: true });
    await expect(reply).toContainText("ME3's draft");
    await expect(reply.getByRole("textbox", { name: "Reply" })).toContainText("Thursday at 10 works for me.");
    await page.screenshot({ path: testInfo.outputPath("me3-draft.png") });

    // Closing the box leaves the draft waiting.
    await reply.getByRole("button", { name: "Close" }).click();
    expect(calls.filter(call => call.path.startsWith("/mailbox/drafts"))).toEqual([]);
    await card.getByRole("button", { name: "Review" }).click();

    await reply.getByRole("textbox", { name: "Reply" }).fill("Thursday at 11 suits me better.");
    await reply.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Sending in 10 seconds.")).toBeVisible();
    // ME3's own draft is updated and sent: no second draft.
    expect(calls.filter(call => call.path === "/mailbox/drafts" && call.method === "POST")).toEqual([]);
    const saved = calls.find(call => call.path === "/mailbox/drafts/me3-draft" && call.method === "PUT")?.body as { textBody?: string; to?: string; expectedUpdatedAt?: string };
    expect(saved.textBody).toBe("Thursday at 11 suits me better.");
    expect(saved.to).toBe("maya@example.test");
    expect(saved.expectedUpdatedAt).toBe("2026-11-13T09:25:00.000Z");
    expect(calls.find(call => call.path === "/mailbox/drafts/me3-draft/approve")?.body).toEqual({ holdSeconds: 10 });

    // While Core holds it, the conversation offers Undo send, not a second Send.
    const sending = reader(page).locator(".message-card--draft");
    await expect(sending).toContainText("Sending");
    await expect(sending.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await sending.getByRole("button", { name: "Undo send" }).click();
    await expect.poll(() => calls.some(call => call.path === "/mailbox/drafts/me3-draft/cancel-send")).toBe(true);
    await expect(reader(page).getByRole("region", { name: "ME3 drafted a reply" })).toBeVisible();
  } finally {
    agentDraft.on = false;
  }
});

test("the compose window waits ten seconds with an Undo that reopens the message as it was", async ({ page }) => {
  const { calls } = await fixture(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/email?tab=inbox");
  await page.getByRole("button", { name: "Compose" }).first().click();
  const compose = page.locator(".compose-modal");
  await compose.locator("#compose-to").fill("sam@partner.test");
  await compose.locator("#compose-subject").fill("Workshop dates");
  await compose.getByRole("textbox", { name: "Message" }).fill("Could we do the 4th?");
  await compose.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sending in 10 seconds.")).toBeVisible();
  expect(calls.find(call => call.path === "/mailbox/drafts/draft-1/approve")?.body).toEqual({ holdSeconds: 10 });
  await expect(compose).toBeHidden();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => calls.some(call => call.path === "/mailbox/drafts/draft-1/cancel-send")).toBe(true);
  await expect(compose).toBeVisible();
  await expect(compose.locator("#compose-subject")).toHaveValue("Workshop dates");
  await expect(compose.getByRole("textbox", { name: "Message" })).toContainText("Could we do the 4th?");
});

test("Delete this message removes one message, and printing shows the whole conversation without the app around it", async ({ page }, testInfo) => {
  longThread.on = true;
  try {
    const { calls } = await fixture(page);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto("/email?tab=inbox");
    await page.getByText("Meetup talk").first().click();
    const earlier = reader(page).locator(".message-card").first();
    await earlier.getByRole("button", { name: "More for the message from Leo" }).click();
    await earlier.getByRole("menuitem", { name: "Delete this message" }).click();
    await expect(page.getByText("Message moved to Trash.")).toBeVisible();
    expect(calls.find(call => call.path === "/mailbox/messages/t3-old4/move")?.body).toEqual({ folder: "trash" });
    expect(calls.some(call => call.path === "/mailbox/threads/t3/move")).toBe(false);
    await expect(reader(page).getByRole("heading", { name: "Meetup talk" })).toBeVisible();

    await page.evaluate(() => { window.print = () => { (window as unknown as { printed: number }).printed = 1; }; });
    await reader(page).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print conversation" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { printed?: number }).printed)).toBe(1);
    // Every message is laid out in full, and only the reader is printed.
    await expect(reader(page).locator(".message-card")).toHaveCount(6);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".mail-rail")).toBeHidden();
    await expect(reader(page).locator(".thread-toolbar")).toBeHidden();
    await expect(reader(page).getByRole("heading", { name: "Meetup talk" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("print.png"), fullPage: true });
  } finally {
    longThread.on = false;
  }
});

test("the Sent view does not offer Archive", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/email?tab=inbox");
  await page.getByText("Studio lease").first().click();
  await expect(reader(page).getByRole("button", { name: "Archive" })).toBeVisible();
  await page.goto("/email?tab=sent");
  await page.getByText("Studio lease").first().click();
  await expect(reader(page).getByRole("heading", { name: "Studio lease" })).toBeVisible();
  await expect(reader(page).getByRole("button", { name: "Archive" })).toHaveCount(0);
});

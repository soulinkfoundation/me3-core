import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_REMOVALS_SCHEMA } from "./accounts";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA } from "./accounts-email-triage";
import { listAgentMailboxMessages } from "@me3-core/plugin-agent-chat";
import { getMailboxBrief, markMailboxNotSpam, markMailboxSpam, resolveBriefItem, snoozeBriefItem, undoHandledAction } from "./mailbox-brief";
import { listMailboxThreads, moveMailboxThread } from "./mailbox-threads";
import {
  MAIL_TRIAGE_SCHEMA,
  archiveStaleLoginCodes,
  enqueueMailTriage,
  extractLoginCode,
  purgeStaleSpam,
  retryPendingMailTriage,
  runMailTriage,
  type MailTriageClassifier,
} from "./mailbox-triage";
import type { Env } from "./types";

// Failure modes: a replayed delivery triages the same message twice; a receipt
// still lands in the Accounts ledger and a deterministic decision calls the
// model anyway; a model failure drops the message from the Brief instead of
// retrying; undoing an archived notification does not restore it to Inbox;
// the same alert firing three times fills the Brief three times and "Done"
// clears only one of them; a newsletter's stylesheet leaks into its summary;
// a newsletter summary fails the whole pass when the model is down; an owner
// on Gmail gets every stranger at gmail.com filed as FYI without the model; a
// reply drafted on a forward is addressed to whoever forwarded it; a filed
// invoice stays in Inbox, or its undo leaves it archived; a sign-in code is
// archived before the owner can use it, never archived at all, or a booking
// confirmation code is mistaken for one; spam with a body-only unsubscribe
// link reaches needs-you, or a contact's mail is filtered as spam; "Not spam"
// restores the mail but the sender is filtered again next time; "Spam" from
// the owner moves the mail but their next mail still reaches the model; spam
// shows in Trash or Archive, or never gets deleted; a pass that failed five
// times sits in the Brief for good; with no model, marketing claims needs-you;
// strangers' mail runs the model without limit (one sender, or many).
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  // The real migration chain for mail, so 0083's table rebuilds run against the shipped schema.
  for (const name of ["0001_initial_public_schema", "0015_agent_runtime_idempotency", "0072_mailbox_triage", "0080_mailbox_login_codes", "0083_mailbox_spam", "0084_mailbox_model_calls"]) {
    raw.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  for (const sql of [...ACCOUNTS_EMAIL_TRIAGE_SCHEMA, ...ACCOUNTS_REMOVALS_SCHEMA, ...MAIL_TRIAGE_SCHEMA]) raw.exec(sql);
  raw.exec(`INSERT INTO owner_profile(id, email, timezone) VALUES('owner', 'me@owner.test', 'UTC');
    INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email,status) VALUES('mailbox','owner','owner','','active');
    INSERT INTO plugin_installations(plugin_id,version,enabled,status) VALUES('me3.accounts','0.1.0',1,'installed');
    INSERT INTO contacts(id,user_id,name,email) VALUES('maya','owner','Maya Okafor','maya@example.test');`);
  const prepare = (sql: string) => {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first() { return query.get(...values as never[]) ?? null; },
      async all() { return { results: query.all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; },
    }; return statement;
  };
  const env = { ME3_MAIL_AVATARS: "off", DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { for (const statement of statements) await statement.run(); } } } as unknown as Env;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return { raw, env };
}

function insertMail(raw: DatabaseSync, input: { id: string; from: string; subject: string; body: string; headers?: Record<string, string>; receivedAt?: string }) {
  raw.prepare(
    `INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,from_address,to_address,subject,text_body,raw_headers_json,metadata_json,folder,created_by,received_at)
     VALUES (?,?, 'inbound','email','received',?,?,?,?,?,'{}','inbox','provider',?)`,
  ).run(input.id, "mailbox", input.from, "owner@me3.test", input.subject, input.body,
    JSON.stringify({ from: input.from, subject: input.subject, "message-id": `<${input.id}@example.test>`, ...(input.headers || {}) }),
    input.receivedAt || new Date().toISOString());
}

const triageRows = (raw: DatabaseSync) => raw.prepare("SELECT * FROM mailbox_triage ORDER BY message_id").all() as Array<Record<string, unknown>>;

describe("mail triage pipeline", () => {
  it("creates exactly one triage record when a delivery is replayed", async () => {
    const f = fixture();
    insertMail(f.raw, { id: "m1", from: "someone@example.test", subject: "Hello", body: "Can we talk?" });
    const classifier = vi.fn<MailTriageClassifier>(async () => ({ category: "needs_you", urgency: "normal", summary: "Wants to talk.", action: { kind: "draft_reply", label: "Draft a reply" }, secondary: null, reply: null, url: null }));
    expect(await enqueueMailTriage(f.env, { mailboxId: "mailbox", messageId: "m1" }, { classify: classifier })).toBe(true);
    expect(await enqueueMailTriage(f.env, { mailboxId: "mailbox", messageId: "m1" }, { classify: classifier })).toBe(false);
    expect(triageRows(f.raw)).toHaveLength(1);
    expect(classifier).toHaveBeenCalledTimes(1);
    expect(triageRows(f.raw)[0]).toMatchObject({ status: "done", category: "needs_you", decided_by: "model", attempts: 1 });
  });

  it("caps triage model calls per sender and per owner over a rolling day", async () => {
    const f = fixture();
    const now = new Date("2026-10-22T09:00:00.000Z");
    const classifier = vi.fn<MailTriageClassifier>(async () => ({ category: "fyi", urgency: "low", summary: "A note.", action: null, secondary: null, reply: null, url: null }));
    for (let index = 0; index < 12; index += 1) {
      insertMail(f.raw, { id: `same-${index}`, from: "pest@stranger.test", subject: `Quick question ${index}`, body: "Can you help?" });
      await runMailTriage(f.env, `same-${index}`, { classify: classifier, now });
    }
    expect(classifier).toHaveBeenCalledTimes(10);
    const capped = triageRows(f.raw).find(row => row.message_id === "same-11");
    expect(capped).toMatchObject({ status: "done", category: "needs_you", decided_by: "signal" });
    expect(JSON.parse(String(capped?.context_json))).toMatchObject({ modelSkipped: "daily_limit" });

    // Many senders: the mailbox's daily limit bounds the total.
    f.raw.exec("UPDATE mailbox_aliases SET daily_inbound_limit = 13");
    for (let index = 0; index < 5; index += 1) {
      insertMail(f.raw, { id: `many-${index}`, from: `sender${index}@stranger.test`, subject: "Hello", body: "Hi there" });
      await runMailTriage(f.env, `many-${index}`, { classify: classifier, now });
    }
    expect(classifier).toHaveBeenCalledTimes(13);

    // A day later the window has moved on.
    insertMail(f.raw, { id: "tomorrow", from: "pest@stranger.test", subject: "Again", body: "Hi" });
    await runMailTriage(f.env, "tomorrow", { classify: classifier, now: new Date("2026-10-23T09:00:01.000Z") });
    expect(classifier).toHaveBeenCalledTimes(14);
  });

  it("files a receipt to Accounts, archives it, and undo restores both", async () => {
    const f = fixture();
    insertMail(f.raw, { id: "receipt", from: "billing@registrar.test", subject: "Receipt for your renewal", body: "Thank you for your payment. Total: £12.00" });
    const classifier = vi.fn<MailTriageClassifier>(async () => { throw new Error("model must not run"); });
    await runMailTriage(f.env, "receipt", { classify: classifier });
    expect(classifier).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT source_email_id, amount_cents FROM financial_entries").all()).toEqual([
      expect.objectContaining({ source_email_id: "receipt", amount_cents: 1200 }),
    ]);
    expect(triageRows(f.raw)[0]).toMatchObject({ status: "done", category: "handled", handled_kind: "receipt", decided_by: "signal" });
    expect(f.raw.prepare("SELECT folder FROM mailbox_messages WHERE id = 'receipt'").get()).toEqual({ folder: "archive" });
    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.handled.groups).toEqual([
      expect.objectContaining({ kind: "receipt", title: "1 invoice filed to Accounts", count: 1, amountCents: 1200, currency: "GBP" }),
    ]);
    const action = brief.handled.groups[0].items[0];
    expect(action.undo).toEqual({ kind: "remove_ledger_entry" });
    expect(await undoHandledAction(f.env, "owner", action.id)).toMatchObject({ ok: true });
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM financial_entries").get()).toEqual({ n: 0 });
    expect(f.raw.prepare("SELECT folder FROM mailbox_messages WHERE id = 'receipt'").get()).toEqual({ folder: "inbox" });
  });

  it("keeps a sign-in code in Inbox for an hour, then archives it once with undo", async () => {
    const f = fixture();
    const sent = new Date("2026-10-20T09:00:00.000Z");
    insertMail(f.raw, { id: "code", from: "no-reply@accounts.test", subject: "Your verification code", body: "Your code is 482913. It expires in 10 minutes.", headers: { "auto-submitted": "auto-generated" } });
    insertMail(f.raw, { id: "slack", from: "feedback@slack.test", subject: "Slack confirmation code: 123-456", body: "Confirm your email." });
    insertMail(f.raw, { id: "booking", from: "hello@hotel.test", subject: "Your booking confirmation code ABC123", body: "See you on Friday." });
    const classifier = vi.fn<MailTriageClassifier>(async () => ({ category: "fyi", urgency: "low", summary: "Booking confirmed.", action: null, secondary: null, reply: null, url: null }));
    for (const id of ["code", "slack", "booking"]) await runMailTriage(f.env, id, { classify: classifier, now: sent });
    expect(classifier).toHaveBeenCalledTimes(1);
    for (const id of ["code", "slack"]) expect(triageRows(f.raw).find(row => row.message_id === id)).toMatchObject({ category: "handled", handled_kind: "login_code" });
    expect(triageRows(f.raw).find(row => row.message_id === "booking")).toMatchObject({ handled_kind: null, decided_by: "model" });
    const folder = (id: string) => (f.raw.prepare("SELECT folder FROM mailbox_messages WHERE id = ?").get(id) as { folder: string }).folder;

    expect(await archiveStaleLoginCodes(f.env, { now: new Date(sent.getTime() + 30 * 60_000) })).toEqual({ archived: 0 });
    expect(folder("code")).toBe("inbox");
    expect(await archiveStaleLoginCodes(f.env, { now: new Date(sent.getTime() + 61 * 60_000) })).toEqual({ archived: 2 });
    expect(folder("code")).toBe("archive");
    expect(folder("booking")).toBe("inbox");

    const brief = await getMailboxBrief(f.env, "owner", { now: new Date(sent.getTime() + 62 * 60_000) });
    const group = brief.handled.groups.find(entry => entry.kind === "login_code")!;
    expect(group).toMatchObject({ title: "2 login codes archived", count: 2 });
    await undoHandledAction(f.env, "owner", group.items.find(item => item.messageId === "code")!.id);
    expect(folder("code")).toBe("inbox");
    expect(await archiveStaleLoginCodes(f.env, { now: new Date(sent.getTime() + 3 * 60 * 60_000) })).toEqual({ archived: 0 });
    expect(folder("code")).toBe("inbox");
  });

  it("pushes a fresh sign-in code once and shows it on the Brief while it is usable", async () => {
    const f = fixture();
    const sent = new Date("2026-10-20T09:00:00.000Z");
    insertMail(f.raw, { id: "code", from: "no-reply@github.test", subject: "Your verification code", body: "Your code is 482 913.", receivedAt: sent.toISOString(), headers: { "auto-submitted": "auto-generated" } });
    insertMail(f.raw, { id: "late", from: "no-reply@bank.test", subject: "Your login code", body: "Use 771204 to sign in.", receivedAt: sent.toISOString() });
    insertMail(f.raw, { id: "link", from: "no-reply@app.test", subject: "Your magic link", body: "Click the link to sign in.", receivedAt: sent.toISOString() });
    const notifyLoginCode = vi.fn(async () => ({ ok: true }));
    await runMailTriage(f.env, "code", { now: new Date(sent.getTime() + 60_000), notifyLoginCode });
    await runMailTriage(f.env, "link", { now: new Date(sent.getTime() + 60_000), notifyLoginCode });
    // The cron retried this one after the code had expired: no push for a dead code.
    await runMailTriage(f.env, "late", { now: new Date(sent.getTime() + 40 * 60_000), notifyLoginCode });
    await runMailTriage(f.env, "code", { now: new Date(sent.getTime() + 2 * 60_000), notifyLoginCode });

    expect(notifyLoginCode).toHaveBeenCalledTimes(1);
    expect(notifyLoginCode).toHaveBeenCalledWith(f.env, { messageId: "code", code: "482913", senderName: expect.any(String) });
    const fresh = await getMailboxBrief(f.env, "owner", { now: new Date(sent.getTime() + 5 * 60_000) });
    expect(fresh.loginCodes).toEqual([expect.objectContaining({ messageId: "code", code: "482913", subject: "Your verification code" })]);
    expect((await getMailboxBrief(f.env, "owner", { now: new Date(sent.getTime() + 20 * 60_000) })).loginCodes).toEqual([]);
  });

  it("finds the code in the common sign-in email shapes and nothing else", () => {
    expect(extractLoginCode("482913 is your Instagram code", "")).toBe("482913");
    expect(extractLoginCode("Slack confirmation code: 123-456", "")).toBe("123456");
    expect(extractLoginCode("Sign in to GitHub", "Here is your code:\n\n  904 551\n\nIt expires soon.")).toBe("904551");
    expect(extractLoginCode("Your Google code", "G-118274 is your Google verification code.")).toBe("118274");
    expect(extractLoginCode("Verify your account", "Enter this code:\nX7K2PQ")).toBe("X7K2PQ");
    expect(extractLoginCode("Your magic link", "Click the link to sign in. Ref ACCOUNT")).toBe(null);
  });

  it("keeps a message in the Brief when the model fails and retries it from the cron", async () => {
    const f = fixture();
    insertMail(f.raw, { id: "flaky", from: "client@example.test", subject: "Quick question", body: "Could you send the invoice?" });
    const classifier = vi.fn<MailTriageClassifier>()
      .mockRejectedValueOnce(new Error("model timeout"))
      .mockResolvedValueOnce({ category: "needs_you", urgency: "normal", summary: "Asks for the invoice.", action: { kind: "draft_reply", label: "Draft a reply" }, secondary: null, reply: null, url: null });
    await runMailTriage(f.env, "flaky", { classify: classifier });
    expect(triageRows(f.raw)[0]).toMatchObject({ status: "failed", attempts: 1 });
    let brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou).toEqual([expect.objectContaining({ messageId: "flaky", summary: "Quick question" })]);

    await retryPendingMailTriage(f.env, { classify: classifier, olderThanMs: 0 });
    expect(triageRows(f.raw)[0]).toMatchObject({ status: "done", attempts: 2, summary: "Asks for the invoice." });
    brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou).toEqual([expect.objectContaining({ messageId: "flaky", summary: "Asks for the invoice.", sender: expect.objectContaining({ name: "Client" }) })]);
  });

  it("archives automated notifications and undo moves them back to Inbox", async () => {
    const f = fixture();
    insertMail(f.raw, { id: "notice", from: "no-reply@github.test", subject: "[GitHub] A new sign-in", body: "We noticed a new sign-in.", headers: { "auto-submitted": "auto-generated" } });
    const classifier = vi.fn<MailTriageClassifier>(async () => { throw new Error("model must not run"); });
    await runMailTriage(f.env, "notice", { classify: classifier });
    expect(f.raw.prepare("SELECT folder FROM mailbox_messages WHERE id = 'notice'").get()).toEqual({ folder: "archive" });
    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou).toEqual([]);
    const group = brief.handled.groups.find(entry => entry.kind === "notification");
    expect(group?.items[0].undo).toEqual({ kind: "move_to_inbox" });
    await undoHandledAction(f.env, "owner", group!.items[0].id);
    expect(f.raw.prepare("SELECT folder FROM mailbox_messages WHERE id = 'notice'").get()).toEqual({ folder: "inbox" });
    expect((await getMailboxBrief(f.env, "owner")).handled.groups).toEqual([]);
  });

  it("knows a contact by name and saves the model's reply as an agent draft", async () => {
    const f = fixture();
    insertMail(f.raw, { id: "maya1", from: "maya@example.test", subject: "Moving Thursday's session", body: "Would Friday morning work instead?" });
    const classifier = vi.fn<MailTriageClassifier>(async () => ({ category: "needs_you", urgency: "normal", summary: "Move Thursday to Fri 10:00?", action: { kind: "send_draft", label: "Send reply" }, secondary: null, reply: "Hi Maya, Friday works. Shall we say 10:00?", url: null }));
    await runMailTriage(f.env, "maya1", { classify: classifier });
    const draft = f.raw.prepare("SELECT id, status, created_by, source_id, to_address FROM mailbox_messages WHERE message_kind = 'draft'").get() as Record<string, unknown>;
    expect(draft).toMatchObject({ status: "pending_approval", created_by: "agent", source_id: "maya1", to_address: "maya@example.test" });
    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou[0]).toMatchObject({
      sender: expect.objectContaining({ name: "Maya Okafor", initials: "MO" }),
      draft: expect.objectContaining({ id: draft.id }),
      primaryAction: { kind: "send_draft", label: "Send reply" },
      secondaryAction: { kind: "edit_draft", label: "Edit" },
    });
  });
  it("sends a stranger on the owner's own mail provider to the model instead of filing it as FYI", async () => {
    const f = fixture();
    f.raw.exec("UPDATE owner_profile SET email = 'owner@gmail.com' WHERE id = 'owner'");
    insertMail(f.raw, { id: "stranger", from: "sam@gmail.com", subject: "Podcast guest?", body: "Would you join our podcast in November?" });
    const classifier = vi.fn<MailTriageClassifier>(async () => ({ category: "needs_you", urgency: "normal", summary: "Podcast invite for November.", action: { kind: "draft_reply", label: "Draft a reply" }, secondary: null, reply: null, url: null }));
    await runMailTriage(f.env, "stranger", { classify: classifier });
    expect(classifier).toHaveBeenCalledTimes(1);
    expect(triageRows(f.raw)[0]).toMatchObject({ category: "needs_you", decided_by: "model" });
  });

  it("addresses a reply drafted on a forward to the original sender, and drafts none when the sender is unknown", async () => {
    const f = fixture();
    const reply = vi.fn<MailTriageClassifier>(async () => ({ category: "needs_you", urgency: "normal", summary: "Move Thursday to Friday?", action: { kind: "send_draft", label: "Send reply" }, secondary: null, reply: "Hi Sam, Friday works for me.", url: null }));
    insertMail(f.raw, { id: "fwd1", from: "me@owner.test", subject: "Fwd: Moving Thursday", body: "Can you reply?\n\n---------- Forwarded message ---------\nFrom: Sam Reyes <sam@example.test>\nSubject: Moving Thursday\n\nCould we do Friday instead?" });
    await runMailTriage(f.env, "fwd1", { classify: reply });
    expect(f.raw.prepare("SELECT to_address, subject FROM mailbox_messages WHERE message_kind = 'draft'").all()).toEqual([
      { to_address: "sam@example.test", subject: "Re: Moving Thursday" },
    ]);

    insertMail(f.raw, { id: "fwd2", from: "me@owner.test", subject: "Fwd: Moving Thursday", body: "Could we do Friday instead?" });
    await runMailTriage(f.env, "fwd2", { classify: reply });
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE message_kind = 'draft'").get()).toEqual({ n: 1 });
    expect(triageRows(f.raw).find(row => row.message_id === "fwd2")).toMatchObject({ category: "needs_you", draft_id: null });
  });

  it("collapses repeated alerts into one Brief item and resolves them together", async () => {
    const f = fixture();
    for (const [id, hour] of [["alert1", "09"], ["alert2", "12"], ["alert3", "15"]]) {
      insertMail(f.raw, { id, from: "hey@posthog.test", subject: "PostHog alert: Soulink call canary failure", body: `Firing at ${hour}:00`, receivedAt: `2026-10-20T${hour}:00:00.000Z` });
    }
    insertMail(f.raw, { id: "other", from: "hey@posthog.test", subject: "Your weekly PostHog digest", body: "What happened this week." });
    const classifier = vi.fn<MailTriageClassifier>(async ({ subject }) => ({
      category: "needs_you", urgency: "normal", summary: subject, action: { kind: "open_url", label: "Check alert" }, secondary: null, reply: null, url: "https://posthog.test/alerts/1",
    }));
    for (const id of ["alert1", "alert2", "alert3", "other"]) await runMailTriage(f.env, id, { classify: classifier });

    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou.map(item => item.messageId).sort()).toEqual(["alert3", "other"]);
    const alert = brief.needsYou.find(item => item.messageId === "alert3")!;
    expect(alert.duplicates).toBe(2);
    expect(alert.relatedMessageIds.sort()).toEqual(["alert1", "alert2"]);
    expect(brief.fyi.inboxLeft).toBe(0);

    await snoozeBriefItem(f.env, "owner", "alert3", "2999-01-01T08:00:00.000Z");
    expect((await getMailboxBrief(f.env, "owner")).needsYou.map(item => item.messageId)).toEqual(["other"]);
    await resolveBriefItem(f.env, "owner", "other");
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_triage WHERE resolved_at IS NULL AND snoozed_until IS NULL").get()).toEqual({ n: 0 });
  });

  const never = () => vi.fn<MailTriageClassifier>(async () => { throw new Error("model must not run"); });
  const needsYou = () => vi.fn<MailTriageClassifier>(async () => ({ category: "needs_you", urgency: "normal", summary: "Wants an answer.", action: { kind: "draft_reply", label: "Draft a reply" }, secondary: null, reply: null, url: null }));
  const stored = (raw: DatabaseSync, id: string) => raw.prepare("SELECT folder, spam_at FROM mailbox_messages WHERE id = ?").get(id) as { folder: string; spam_at: string | null };
  const rules = (raw: DatabaseSync) => (raw.prepare("SELECT kind, match_value FROM mailbox_rules ORDER BY kind").all() as Array<{ kind: string; match_value: string }>);
  const threadIds = async (env: Env, folder: string) => { const list = await listMailboxThreads(env, "owner", { folder }); return "error" in list ? [] : list.threads.map(thread => thread.id); };

  it("filters bulk mail that hides from list tooling before the model, and undo trusts the sender", async () => {
    const f = fixture();
    const classifier = never();
    insertMail(f.raw, { id: "watches", from: "ameliy@ds3.qcqfzx.test", subject: "[Black Friday Early Access] Luxury watches from $250", body: "<html><body><h1>Timeless watches.</h1><p>Explore now.</p><p><a href=\"https://ds3.qcqfzx.test/u/unsubscribe?x=1\">Unsubscribe</a></p></body></html>" });
    await runMailTriage(f.env, "watches", { classify: classifier });
    expect(classifier).not.toHaveBeenCalled();
    expect(triageRows(f.raw)[0]).toMatchObject({ status: "done", category: "handled", handled_kind: "spam", decided_by: "signal" });
    expect(JSON.parse(String(triageRows(f.raw)[0].context_json)).spamSignals).toEqual(["unsubscribe_without_list_headers"]);
    expect(stored(f.raw, "watches")).toMatchObject({ folder: "trash", spam_at: expect.any(String) });

    // The Spam folder is that slice of Trash; Trash, Archive and Inbox never show it.
    expect(await threadIds(f.env, "spam")).toEqual(["<watches@example.test>"]);
    for (const folder of ["trash", "archive", "inbox"]) expect(await threadIds(f.env, folder)).toEqual([]);
    const messages = await listAgentMailboxMessages(f.env, "owner", { folder: "spam", direction: "inbound" });
    expect(messages.messages).toEqual([expect.objectContaining({ id: "watches", folder: "trash", spam: true })]);
    expect((await listAgentMailboxMessages(f.env, "owner", { folder: "trash", direction: "inbound" })).total).toBe(0);

    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou).toEqual([]);
    expect(brief.handled.groups).toEqual([expect.objectContaining({ kind: "spam", title: "1 spam filtered", count: 1 })]);
    expect(brief.handled.groups[0].items[0].undo).toEqual({ kind: "move_to_inbox" });

    await undoHandledAction(f.env, "owner", brief.handled.groups[0].items[0].id);
    expect(stored(f.raw, "watches")).toEqual({ folder: "inbox", spam_at: null });
    expect(rules(f.raw)).toEqual([{ kind: "always_show_sender", match_value: "ameliy@ds3.qcqfzx.test" }]);
    expect((await getMailboxBrief(f.env, "owner")).handled.groups).toEqual([]);

    // The trusted sender's next mail goes to the model like anyone else's.
    const model = needsYou();
    insertMail(f.raw, { id: "watches2", from: "ameliy@ds3.qcqfzx.test", subject: "Cyber Monday", body: "More watches. https://ds3.qcqfzx.test/u/unsubscribe?x=2" });
    await runMailTriage(f.env, "watches2", { classify: model });
    expect(model).toHaveBeenCalledTimes(1);
    expect(stored(f.raw, "watches2").folder).toBe("inbox");
  });

  it("trusts Cloudflare's score and a bulk precedence, never a contact or the owner's own forward", async () => {
    const f = fixture();
    const classifier = needsYou();
    insertMail(f.raw, { id: "scored", from: "winner@prizes.test", subject: "You won", body: "Claim your prize today.", headers: { "x-cf-spamh-score": "4.6" } });
    insertMail(f.raw, { id: "bulk", from: "sophie@growth-agency.test", subject: "Quick question about your site", body: "We help sites like yours rank.", headers: { precedence: "bulk" } });
    insertMail(f.raw, { id: "robot", from: "noreply@status.test", subject: "Weekly status digest", body: "All systems normal.", headers: { precedence: "bulk" } });
    insertMail(f.raw, { id: "maya", from: "maya@example.test", subject: "Workshop notes", body: `Here are the notes. ${"Details. ".repeat(200)}You can unsubscribe from these notes any time.` });
    insertMail(f.raw, { id: "fwd", from: "me@owner.test", subject: "Fwd: Is this legit?", body: "Thoughts?\n\n---------- Forwarded message ---------\nFrom: Luxury Watches <ameliy@ds3.qcqfzx.test>\nSubject: Watches\n\nExplore now. https://ds3.qcqfzx.test/unsubscribe" });
    insertMail(f.raw, { id: "short", from: "bob@client.test", subject: "Please unsubscribe me", body: "Hi, could you unsubscribe me from the newsletter? Thanks, Bob" });
    for (const id of ["scored", "bulk", "robot", "maya", "fwd", "short"]) await runMailTriage(f.env, id, { classify: classifier });
    const row = (id: string) => triageRows(f.raw).find(entry => entry.message_id === id)!;
    expect(row("scored")).toMatchObject({ handled_kind: "spam" });
    expect(JSON.parse(String(row("scored").context_json)).spamSignals).toEqual(["cloudflare_score"]);
    expect(row("bulk")).toMatchObject({ handled_kind: "spam" });
    expect(JSON.parse(String(row("bulk").context_json)).spamSignals).toEqual(["bulk_precedence_without_list_headers"]);
    expect(row("robot")).toMatchObject({ handled_kind: "notification" });
    for (const id of ["maya", "fwd", "short"]) expect(row(id)).toMatchObject({ category: "needs_you", decided_by: "model" });
    expect(classifier).toHaveBeenCalledTimes(3);
  });

  it("acts on the model's spam verdict for strangers only", async () => {
    const f = fixture();
    const classifier = vi.fn<MailTriageClassifier>(async () => ({ category: "spam", urgency: "low", summary: "Crypto scheme.", action: null, secondary: null, reply: null, url: null }));
    insertMail(f.raw, { id: "stranger", from: "sam@wallet-recovery.test", subject: "Your wallet", body: "Recover your lost crypto with us." });
    insertMail(f.raw, { id: "maya", from: "maya@example.test", subject: "Crypto?", body: "Have you looked at crypto lately?" });
    for (const id of ["stranger", "maya"]) await runMailTriage(f.env, id, { classify: classifier });
    expect(triageRows(f.raw).find(row => row.message_id === "stranger")).toMatchObject({ category: "handled", handled_kind: "spam", decided_by: "model" });
    expect(stored(f.raw, "stranger")).toMatchObject({ folder: "trash", spam_at: expect.any(String) });
    expect(triageRows(f.raw).find(row => row.message_id === "maya")).toMatchObject({ category: "noise", handled_kind: null });
    expect(stored(f.raw, "maya")).toEqual({ folder: "inbox", spam_at: null });
    expect((await getMailboxBrief(f.env, "owner")).handled.groups.map(group => group.count)).toEqual([1]);
  });

  it("'Spam' blocks the sender before the model and 'Not spam' restores and trusts them", async () => {
    const f = fixture();
    const model = needsYou();
    insertMail(f.raw, { id: "pitch", from: "sophie@growth-agency.test", subject: "Quick question", body: "Can I send you a proposal?" });
    await runMailTriage(f.env, "pitch", { classify: model });
    expect((await getMailboxBrief(f.env, "owner")).needsYou).toHaveLength(1);

    expect(await markMailboxSpam(f.env, "owner", { messageId: "pitch" })).toEqual({ ok: true, moved: 1, blocked: ["sophie@growth-agency.test"] });
    expect(stored(f.raw, "pitch")).toMatchObject({ folder: "trash", spam_at: expect.any(String) });
    expect(rules(f.raw)).toEqual([{ kind: "spam_sender", match_value: "sophie@growth-agency.test" }]);
    let brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou).toEqual([]);
    expect(brief.handled.groups).toEqual([expect.objectContaining({ kind: "spam", count: 1, items: [expect.objectContaining({ label: "Marked as spam" })] })]);
    expect(await markMailboxSpam(f.env, "owner", { messageId: "missing" })).toEqual({ error: "Message not found", status: 404 });

    const classifier = never();
    insertMail(f.raw, { id: "pitch2", from: "sophie@growth-agency.test", subject: "Following up", body: "Did you see my proposal?" });
    await runMailTriage(f.env, "pitch2", { classify: classifier });
    expect(classifier).not.toHaveBeenCalled();
    expect(triageRows(f.raw).find(row => row.message_id === "pitch2")).toMatchObject({ category: "handled", handled_kind: "spam", decided_by: "rule" });
    expect(stored(f.raw, "pitch2").folder).toBe("trash");

    expect(await markMailboxNotSpam(f.env, "owner", { threadId: "<pitch2@example.test>" })).toEqual({ ok: true, restored: 1, trusted: ["sophie@growth-agency.test"] });
    expect(stored(f.raw, "pitch2")).toEqual({ folder: "inbox", spam_at: null });
    expect(rules(f.raw)).toEqual([{ kind: "always_show_sender", match_value: "sophie@growth-agency.test" }]);
    expect(triageRows(f.raw).find(row => row.message_id === "pitch2")).toMatchObject({ category: "fyi", handled_kind: null });
    brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou).toEqual([]);
    expect(brief.handled.groups.map(group => group.count)).toEqual([1]);

    // The plain move API knows the Spam folder on both sides.
    expect(await moveMailboxThread(f.env, "owner", "<pitch@example.test>", "inbox", "spam")).toMatchObject({ ok: true });
    expect(stored(f.raw, "pitch")).toEqual({ folder: "inbox", spam_at: null });
    expect(await moveMailboxThread(f.env, "owner", "<pitch@example.test>", "spam", "inbox")).toMatchObject({ ok: true });
    expect(stored(f.raw, "pitch")).toMatchObject({ folder: "trash", spam_at: expect.any(String) });
  });

  it("without a model keeps bulk mail out of the Brief and a person in it; a pass that failed for good leaves it", async () => {
    const f = fixture();
    insertMail(f.raw, { id: "promo", from: "deals@shop.test", subject: "Weekend deals", body: "Shop now.", headers: { precedence: "list" } });
    insertMail(f.raw, { id: "person", from: "bob@client.test", subject: "Invoice?", body: "Could you send the invoice?" });
    for (const id of ["promo", "person"]) await runMailTriage(f.env, id, { classify: null });
    expect(triageRows(f.raw).find(row => row.message_id === "promo")).toMatchObject({ category: "noise", decided_by: "signal" });
    expect(triageRows(f.raw).find(row => row.message_id === "person")).toMatchObject({ category: "needs_you", decided_by: "signal" });
    expect((await getMailboxBrief(f.env, "owner")).needsYou.map(item => item.messageId)).toEqual(["person"]);

    insertMail(f.raw, { id: "stuck", from: "sam@example.test", subject: "Hello", body: "Still there?" });
    const broken = vi.fn<MailTriageClassifier>(async () => { throw new Error("model down"); });
    for (let attempt = 0; attempt < 4; attempt += 1) await runMailTriage(f.env, "stuck", { classify: broken });
    expect((await getMailboxBrief(f.env, "owner")).needsYou.map(item => item.messageId)).toEqual(["stuck", "person"]);
    await runMailTriage(f.env, "stuck", { classify: broken });
    expect(triageRows(f.raw).find(row => row.message_id === "stuck")).toMatchObject({ status: "failed", attempts: 5 });
    expect((await getMailboxBrief(f.env, "owner")).needsYou.map(item => item.messageId)).toEqual(["person"]);
    expect(stored(f.raw, "stuck").folder).toBe("inbox");
  });

  it("deletes spam after thirty days and nothing sooner", async () => {
    const f = fixture();
    const now = new Date("2026-11-21T09:00:00.000Z");
    insertMail(f.raw, { id: "old", from: "a@spam.test", subject: "Old", body: "x https://spam.test/unsubscribe" });
    insertMail(f.raw, { id: "fresh", from: "b@spam.test", subject: "Fresh", body: "y https://spam.test/unsubscribe" });
    await runMailTriage(f.env, "old", { classify: never(), now: new Date("2026-10-20T09:00:00.000Z") });
    await runMailTriage(f.env, "fresh", { classify: never(), now: new Date("2026-11-01T09:00:00.000Z") });
    expect(await purgeStaleSpam(f.env, { now })).toEqual({ purged: 1 });
    expect(f.raw.prepare("SELECT id FROM mailbox_messages ORDER BY id").all()).toEqual([{ id: "fresh" }]);
    expect(await purgeStaleSpam(f.env, { now })).toEqual({ purged: 0 });
  });

  it("summarises a newsletter with the model, never leaks its stylesheet, and claims no summary during a model outage", async () => {
    const f = fixture();
    const css = "@media screen and (max-width: 768px) { .o_mail_col_mv { display: block !important; width: auto !important; } } .btn { color: #fff; }";
    insertMail(f.raw, { id: "news1", from: "michelle@vindax.test", subject: "We'll show you the next 3 features", body: `${css} Now make it unstoppable. You've built the foundation; staking and compliance are next.`, headers: { "list-unsubscribe": "<https://vindax.test/u>" } });
    insertMail(f.raw, { id: "news2", from: "simon@squibb.test", subject: "Only 500 spots", body: `${css} Dreams inside! Only 500 spots for the November cohort.`, headers: { "list-unsubscribe": "<https://squibb.test/u>" } });
    const classifier = vi.fn<MailTriageClassifier>(async () => { throw new Error("model must not triage newsletters"); });
    await runMailTriage(f.env, "news1", { classify: classifier, summarize: async () => "Vindax previews staking and compliance features for exchange operators." });
    await runMailTriage(f.env, "news2", { classify: classifier, summarize: async () => { throw new Error("model down"); } });

    const brief = await getMailboxBrief(f.env, "owner");
    const group = brief.handled.groups.find(entry => entry.kind === "newsletter")!;
    const detail = (id: string) => group.items.find(item => item.messageId === id)?.detail || "";
    expect(detail("news1")).toBe("Vindax previews staking and compliance features for exchange operators.");
    expect(detail("news2")).toBe("");
    expect(group.title).toBe("2 newsletters set aside");
    expect(f.raw.prepare("SELECT status FROM mailbox_triage WHERE message_id = 'news2'").get()).toEqual({ status: "done" });
  });
});

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_REMOVALS_SCHEMA } from "./accounts";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA } from "./accounts-email-triage";
import { getMailboxBrief, resolveBriefItem, snoozeBriefItem, undoHandledAction } from "./mailbox-brief";
import {
  MAIL_TRIAGE_SCHEMA,
  enqueueMailTriage,
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
// reply drafted on a forward is addressed to whoever forwarded it.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  for (const name of ["0001_initial_public_schema", "0015_agent_runtime_idempotency"]) {
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

  it("files a receipt to Accounts, logs a reversible handled action and skips the model", async () => {
    const f = fixture();
    insertMail(f.raw, { id: "receipt", from: "billing@registrar.test", subject: "Receipt for your renewal", body: "Thank you for your payment. Total: £12.00" });
    const classifier = vi.fn<MailTriageClassifier>(async () => { throw new Error("model must not run"); });
    await runMailTriage(f.env, "receipt", { classify: classifier });
    expect(classifier).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT source_email_id, amount_cents FROM financial_entries").all()).toEqual([
      expect.objectContaining({ source_email_id: "receipt", amount_cents: 1200 }),
    ]);
    expect(triageRows(f.raw)[0]).toMatchObject({ status: "done", category: "handled", handled_kind: "receipt", decided_by: "signal" });
    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.handled.groups).toEqual([
      expect.objectContaining({ kind: "receipt", count: 1, amountCents: 1200, currency: "GBP" }),
    ]);
    const action = brief.handled.groups[0].items[0];
    expect(action.undo).toEqual({ kind: "remove_ledger_entry" });
    expect(await undoHandledAction(f.env, "owner", action.id)).toMatchObject({ ok: true });
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM financial_entries").get()).toEqual({ n: 0 });
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

  it("summarises a newsletter with the model, never leaks its stylesheet, and survives a model outage", async () => {
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
    expect(detail("news2")).toBe("Dreams inside!");
    expect(detail("news2")).not.toMatch(/@media|!important/);
    expect(f.raw.prepare("SELECT status FROM mailbox_triage WHERE message_id = 'news2'").get()).toEqual({ status: "done" });
  });
});

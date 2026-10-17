import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_REMOVALS_SCHEMA } from "./accounts";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA } from "./accounts-email-triage";
import { getMailboxBrief, undoHandledAction } from "./mailbox-brief";
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
// retrying; undoing an archived notification does not restore it to Inbox.
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

function insertMail(raw: DatabaseSync, input: { id: string; from: string; subject: string; body: string; headers?: Record<string, string> }) {
  raw.prepare(
    `INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,from_address,to_address,subject,text_body,raw_headers_json,metadata_json,folder,created_by,received_at)
     VALUES (?,?, 'inbound','email','received',?,?,?,?,?,'{}','inbox','provider',?)`,
  ).run(input.id, "mailbox", input.from, "owner@me3.test", input.subject, input.body,
    JSON.stringify({ from: input.from, subject: input.subject, "message-id": `<${input.id}@example.test>`, ...(input.headers || {}) }),
    new Date().toISOString());
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
});

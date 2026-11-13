import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentMailboxDraft } from "@me3-core/plugin-agent-chat";
import { AGENT_SCHEMA_STATEMENTS } from "../../../packages/agent/src/store";
import { ACCOUNTS_REMOVALS_SCHEMA } from "./accounts";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA } from "./accounts-email-triage";
import { moveMailboxConversation } from "./mailbox-conversations";
import {
  cancelHeldMailboxDraft,
  dispatchDueMailboxSends,
  dispatchHeldMailboxDraft,
  holdMailboxDraft,
  type MailboxDraftSender,
} from "./mailbox-send";
import { MAIL_TRIAGE_SCHEMA, runMailTriage, type MailTriageClassifier } from "./mailbox-triage";
import type { Env } from "./types";

// Failure modes (me3-kvu8.29): the owner presses Send and closes the tab, and the email never
// goes; Undo inside the window still sends it, or Undo after it went claims to have stopped it;
// the request that held the send and the cron both send it, so it goes twice; a held reply goes
// out after its conversation was trashed; a send that fails is left neither draft nor sent, or is
// retried every minute; one owner holds or cancels another owner's draft; a scheduled time in the
// past is accepted and sends at once without the owner meaning it.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

const ROOT = "<root@mail.test>";
const T0 = new Date("2026-11-13T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  for (const name of ["0001_initial_public_schema", "0015_agent_runtime_idempotency", "0072_mailbox_triage", "0080_mailbox_login_codes", "0083_mailbox_spam", "0084_mailbox_model_calls", "0085_mailbox_instruction_replay", "0103_mailbox_canonical_thread_key"]) {
    raw.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  for (const sql of [...ACCOUNTS_EMAIL_TRIAGE_SCHEMA, ...ACCOUNTS_REMOVALS_SCHEMA, ...MAIL_TRIAGE_SCHEMA, ...AGENT_SCHEMA_STATEMENTS]) raw.exec(sql);
  raw.exec(readFileSync(new URL("../migrations/0105_mailbox_conversations.sql", import.meta.url), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id, email, timezone) VALUES('owner', 'kieran@gmail.test', 'UTC'), ('other', 'other@owner.test', 'UTC');
    INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email,status) VALUES('mailbox','owner','kieran','','active'), ('other-mailbox','other','other','','active');
    INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,thread_key,from_address,to_address,subject,text_body,raw_headers_json,metadata_json,folder,created_by,received_at)
      VALUES ('ask','mailbox','inbound','email','received','${ROOT}','rosa@example.test','kieran@me3.test','Studio lease','Can you confirm the terms?','{"from":"rosa@example.test","message-id":"${ROOT}"}','{}','inbox','provider','2026-11-13T09:00:00.000Z');`);
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
  const send = vi.fn<MailboxDraftSender>(async () => ({ status: 200, body: { draft: { status: "sent" } } }));
  return { raw, env, send };
}

/** Stands in for the provider send: marks the draft sent the way a delivered email is recorded. */
function sendingFor(f: ReturnType<typeof fixture>): MailboxDraftSender {
  f.send.mockImplementation(async (_env, _ownerId, draftId) => {
    f.raw.prepare("UPDATE mailbox_messages SET message_kind = 'email', status = 'sent', folder = 'sent', sent_at = '2026-11-13T10:00:11.000Z' WHERE id = ?").run(draftId);
    return { status: 200, body: { draft: { id: draftId, status: "sent" } } };
  });
  return f.send;
}

async function reply(f: ReturnType<typeof fixture>): Promise<string> {
  const created = await createAgentMailboxDraft(f.env, "owner", { to: "rosa@example.test", subject: "Re: Studio lease", textBody: "Yes, that works.", source: "user", replyToMessageId: "ask" });
  if ("error" in created || !created.draft) throw new Error("draft not created");
  return created.draft.id;
}
const draftRow = (f: ReturnType<typeof fixture>, id: string) => f.raw.prepare("SELECT message_kind, status, folder, send_after FROM mailbox_messages WHERE id = ?").get(id);
const needsYou = vi.fn<MailTriageClassifier>(async () => ({ category: "needs_you", urgency: "normal", summary: "Wants an answer.", action: { kind: "draft_reply", label: "Draft a reply" }, secondary: null, reply: null, url: null }));

describe("Send with Undo: Core holds the send", () => {
  it("sends once after the hold even when nobody is watching, and never twice", async () => {
    const f = fixture(); const send = sendingFor(f);
    const id = await reply(f);
    expect(await holdMailboxDraft(f.env, "owner", id, { holdSeconds: 10 }, T0)).toEqual({ held: true, id, sendAfter: at(10).toISOString() });
    expect(draftRow(f, id)).toEqual({ message_kind: "draft", status: "pending_approval", folder: "drafts", send_after: at(10).toISOString() });

    expect(await dispatchDueMailboxSends(f.env, { now: at(5), send })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
    // The request that held it and the cron race for the same draft.
    const [first, second, swept] = await Promise.all([
      dispatchHeldMailboxDraft(f.env, "owner", id, { now: at(11), send }),
      dispatchHeldMailboxDraft(f.env, "owner", id, { now: at(11), send }),
      dispatchDueMailboxSends(f.env, { now: at(11), send }),
    ]);
    expect([first, second].filter(result => result === "sent")).toHaveLength(swept.sent ? 0 : 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(draftRow(f, id)).toMatchObject({ message_kind: "email", status: "sent", folder: "sent", send_after: null });
    expect(await dispatchDueMailboxSends(f.env, { now: at(120), send })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops the send on Undo inside the window, and says so honestly once it has gone", async () => {
    const f = fixture(); const send = sendingFor(f);
    const id = await reply(f);
    await holdMailboxDraft(f.env, "owner", id, { holdSeconds: 10 }, T0);
    expect(await cancelHeldMailboxDraft(f.env, "owner", id)).toEqual({ ok: true, cancelled: true });
    expect(await dispatchDueMailboxSends(f.env, { now: at(60), send })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(draftRow(f, id)).toEqual({ message_kind: "draft", status: "pending_approval", folder: "drafts", send_after: null });

    await holdMailboxDraft(f.env, "owner", id, { holdSeconds: 10 }, T0);
    await dispatchDueMailboxSends(f.env, { now: at(11), send });
    expect(await cancelHeldMailboxDraft(f.env, "owner", id)).toMatchObject({ status: 409 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("schedules a send for later, and refuses a time that has passed", async () => {
    const f = fixture(); const send = sendingFor(f);
    const id = await reply(f);
    expect(await holdMailboxDraft(f.env, "owner", id, { sendAt: at(-60).toISOString() }, T0)).toMatchObject({ status: 400 });
    expect(await holdMailboxDraft(f.env, "owner", id, { sendAt: "tomorrow-ish" }, T0)).toMatchObject({ status: 400 });
    expect(await holdMailboxDraft(f.env, "owner", id, { sendAt: at(22 * 3600).toISOString() }, T0)).toMatchObject({ held: true, sendAfter: at(22 * 3600).toISOString() });
    expect(await dispatchDueMailboxSends(f.env, { now: at(21 * 3600), send })).toMatchObject({ sent: 0 });
    expect(await dispatchDueMailboxSends(f.env, { now: at(22 * 3600 + 30), send })).toMatchObject({ sent: 1 });
  });

  it("does not send a held reply once its conversation is in Trash", async () => {
    const f = fixture(); const send = sendingFor(f);
    const id = await reply(f);
    await holdMailboxDraft(f.env, "owner", id, { sendAt: at(3600).toISOString() }, T0);
    await moveMailboxConversation(f.env, "owner", ROOT, "trash", "inbox");
    expect(await dispatchDueMailboxSends(f.env, { now: at(3700), send })).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(draftRow(f, id)).toEqual({ message_kind: "draft", status: "pending_approval", folder: "drafts", send_after: null });
  });

  it("leaves a failed send as a draft, with its Brief row, and does not retry it by itself", async () => {
    const f = fixture();
    await runMailTriage(f.env, "ask", { classify: needsYou });
    const id = await reply(f);
    f.send.mockImplementation(async (_env, _ownerId, draftId) => {
      f.raw.prepare("UPDATE mailbox_messages SET status = 'failed', folder = 'drafts', error_message = 'Provider refused it' WHERE id = ?").run(draftId);
      return { status: 502, body: { error: "Provider refused it" } };
    });
    await holdMailboxDraft(f.env, "owner", id, { holdSeconds: 10 }, T0);
    expect(await dispatchDueMailboxSends(f.env, { now: at(11), send: f.send })).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(draftRow(f, id)).toEqual({ message_kind: "draft", status: "failed", folder: "drafts", send_after: null });
    expect(f.raw.prepare("SELECT resolved_at FROM mailbox_triage WHERE message_id = 'ask'").get()).toEqual({ resolved_at: null });
    await dispatchDueMailboxSends(f.env, { now: at(120), send: f.send });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("keeps owners apart, and refuses to hold what is not a draft", async () => {
    const f = fixture();
    const id = await reply(f);
    expect(await holdMailboxDraft(f.env, "other", id, { holdSeconds: 10 }, T0)).toMatchObject({ status: 404 });
    await holdMailboxDraft(f.env, "owner", id, { holdSeconds: 10 }, T0);
    expect(await cancelHeldMailboxDraft(f.env, "other", id)).toMatchObject({ status: 404 });
    expect(await dispatchHeldMailboxDraft(f.env, "other", id, { now: at(11), send: f.send })).toBe("not_due");
    expect(f.send).not.toHaveBeenCalled();
    expect(await holdMailboxDraft(f.env, "owner", "ask", { holdSeconds: 10 }, T0)).toMatchObject({ status: 404 });
  });
});

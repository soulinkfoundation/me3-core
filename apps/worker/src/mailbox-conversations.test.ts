import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_REMOVALS_SCHEMA } from "./accounts";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA } from "./accounts-email-triage";
import { AGENT_SCHEMA_STATEMENTS } from "../../../packages/agent/src/store";
import { createAgentMailboxDraft, updateAgentMailboxDraft } from "@me3-core/plugin-agent-chat";
import { getMailboxBrief, reopenBriefItem, resolveBriefItem, resolveMailboxTriageForDraft, snoozeBriefItem, undoHandledAction } from "./mailbox-brief";
import {
  MAILBOX_CONVERSATION_FOLDER_FIX_STATEMENTS,
  MAILBOX_CONVERSATION_SCHEMA_STATEMENTS,
  getMailboxConversationLocation,
  getMailboxConversationSnooze,
  moveMailboxConversation,
  moveMailboxMessage,
  snoozeMailboxConversation,
  unsnoozeMailboxConversation,
} from "./mailbox-conversations";
import { listMailboxThreadMessages, listMailboxThreads, moveMailboxThread } from "./mailbox-threads";
import { MAIL_TRIAGE_SCHEMA, archiveStaleLoginCodes, runMailTriage, type MailTriageClassifier } from "./mailbox-triage";
import type { Env } from "./types";

// Failure modes (me3-kvu8.26, me3-kvu8.27): a conversation is listed in Inbox and Archive at once;
// a reply to an archived conversation leaves it in Archive, or archiving it again leaves the new
// message behind; archiving moves the owner's sent mail out of Sent; trashing a conversation
// leaves messages behind, or restoring it files sent mail in Inbox; deleting one message removes
// the conversation, or the deleted message still counts in the list; "Spam" on a conversation
// puts the owner's own sent mail on the 30-day purge; archiving one message from the reading pane
// splits its conversation; archiving from Sent fails for a conversation with only sent mail; a
// conversation that already sat in two folders stays split after the upgrade; an archive rule
// hides a reply in a conversation the owner is writing in; mail the owner sent from another app
// (ME3 copied) returns the conversation to Inbox, unread, and leaves its Brief row; undo of a
// handled action brings one message back and leaves its conversation in Archive; the SQL
// migration and the runtime migration drift apart.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

const MIGRATION_0105 = readFileSync(new URL("../migrations/0105_mailbox_conversations.sql", import.meta.url), "utf8");
const ROOT = "<root@mail.test>";

function fixture(options: { withoutConversationMigration?: boolean } = {}) {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  for (const name of ["0001_initial_public_schema", "0015_agent_runtime_idempotency", "0072_mailbox_triage", "0080_mailbox_login_codes", "0083_mailbox_spam", "0084_mailbox_model_calls", "0085_mailbox_instruction_replay", "0103_mailbox_canonical_thread_key"]) {
    raw.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  for (const sql of [...ACCOUNTS_EMAIL_TRIAGE_SCHEMA, ...ACCOUNTS_REMOVALS_SCHEMA, ...MAIL_TRIAGE_SCHEMA, ...AGENT_SCHEMA_STATEMENTS]) raw.exec(sql);
  if (!options.withoutConversationMigration) raw.exec(MIGRATION_0105);
  raw.exec(`INSERT INTO owner_profile(id, email, timezone) VALUES('owner', 'kieran@gmail.test', 'UTC');
    INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email,status) VALUES('mailbox','owner','kieran','','active');
    INSERT INTO owner_profile(id, email, timezone) VALUES('other', 'other@owner.test', 'UTC');
    INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email,status) VALUES('other-mailbox','other','other','','active');`);
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

let clock = Date.parse("2026-11-10T09:00:00.000Z");
/** Each message is a minute newer than the last, so "newest" is the last one inserted. */
function nextTime(): string { clock += 60_000; return new Date(clock).toISOString(); }

type Received = { id: string; from?: string; subject?: string; body?: string; folder?: "inbox" | "archive" | "trash"; root?: string | null; headers?: Record<string, string>; ownerSigned?: boolean; mailbox?: string };
function receive(raw: DatabaseSync, input: Received) {
  const from = input.from || "rosa@example.test";
  const root = input.root === undefined ? ROOT : input.root;
  const at = nextTime();
  raw.prepare(
    `INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,thread_key,from_address,to_address,subject,text_body,raw_headers_json,metadata_json,folder,created_by,received_at,created_at)
     VALUES (?,?, 'inbound','email','received',?,?,?,?,?,?,?,?,'provider',?,?)`,
  ).run(input.id, input.mailbox || "mailbox", root || `<${input.id}@mail.test>`, from, "kieran@me3.test", input.subject || "Studio lease", input.body || "Can you confirm the terms?",
    JSON.stringify({ from, subject: input.subject || "Studio lease", "message-id": `<${input.id}@mail.test>`, ...(root && root !== `<${input.id}@mail.test>` ? { references: root } : {}), ...(input.headers || {}) }),
    JSON.stringify(input.ownerSigned ? { senderAuth: { dkim: "pass", domain: "gmail.test", address: from, signatureHash: `sig-${input.id}`, signedAt: new Date().toISOString() } } : {}),
    input.folder || "inbox", at, at);
}

function send(raw: DatabaseSync, input: { id: string; folder?: string; kind?: "email" | "draft"; root?: string }) {
  const at = nextTime();
  const draft = input.kind === "draft";
  raw.prepare(
    `INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,thread_key,provider_message_id,from_address,to_address,subject,text_body,metadata_json,folder,created_by,sent_at,created_at)
     VALUES (?, 'mailbox', 'outbound', ?, ?, ?, ?, 'kieran@me3.test', 'rosa@example.test', 'Re: Studio lease', 'Yes, that works.', ?, ?, 'user', ?, ?)`,
  ).run(input.id, draft ? "draft" : "email", draft ? "pending_approval" : "sent", input.root || ROOT, `<${input.id}@me3.test>`,
    JSON.stringify({ outbound_headers: { references: input.root || ROOT, message_id: `<${input.id}@me3.test>` } }),
    input.folder || (draft ? "drafts" : "sent"), draft ? null : at, at);
}

const folders = (raw: DatabaseSync) => Object.fromEntries(
  (raw.prepare("SELECT id, folder, spam_at FROM mailbox_messages ORDER BY id").all() as Array<{ id: string; folder: string; spam_at: string | null }>)
    .map(row => [row.id, row.spam_at ? "spam" : row.folder]),
);
async function listed(env: Env, folder: string): Promise<string[]> {
  const result = await listMailboxThreads(env, "owner", { folder });
  if ("error" in result) throw new Error(result.error);
  return result.threads.map(thread => thread.id);
}
const fyi = vi.fn<MailTriageClassifier>(async () => ({ category: "fyi", urgency: "low", summary: "FYI.", action: null, secondary: null, reply: null, url: null }));
const needsYou = vi.fn<MailTriageClassifier>(async () => ({ category: "needs_you", urgency: "normal", summary: "Wants an answer.", action: { kind: "draft_reply", label: "Draft a reply" }, secondary: null, reply: null, url: null }));

describe("email conversations are one unit", () => {
  it("keeps migration 0105 identical to the runtime migration", () => {
    for (const statement of [...MAILBOX_CONVERSATION_SCHEMA_STATEMENTS, ...MAILBOX_CONVERSATION_FOLDER_FIX_STATEMENTS]) {
      expect(MIGRATION_0105).toContain(`${statement};`);
    }
    const sqlStatements = MIGRATION_0105.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n").split(";").filter(part => part.trim());
    expect(sqlStatements).toHaveLength(MAILBOX_CONVERSATION_SCHEMA_STATEMENTS.length + MAILBOX_CONVERSATION_FOLDER_FIX_STATEMENTS.length);
  });

  it("returns an archived conversation to Inbox on a new reply, lists it once, and archives all of it again", async () => {
    const f = fixture();
    receive(f.raw, { id: "first", folder: "archive" });
    send(f.raw, { id: "reply" });
    expect(await listed(f.env, "archive")).toEqual([ROOT]);
    expect(await listed(f.env, "inbox")).toEqual([]);

    receive(f.raw, { id: "second" });
    expect(await listed(f.env, "inbox")).toEqual([ROOT]);
    expect(await listed(f.env, "archive")).toEqual([]);
    expect(await getMailboxConversationLocation(f.env, "owner", ROOT)).toBe("inbox");
    // Triage settles the conversation: nothing is left behind in Archive.
    await runMailTriage(f.env, "second", { classify: fyi });
    expect(folders(f.raw)).toEqual({ first: "inbox", reply: "sent", second: "inbox" });

    expect(await moveMailboxThread(f.env, "owner", ROOT, "archive", "inbox")).toMatchObject({ ok: true, folder: "archive" });
    expect(folders(f.raw)).toEqual({ first: "archive", reply: "sent", second: "archive" });
    expect(await listed(f.env, "inbox")).toEqual([]);
    expect(await listed(f.env, "archive")).toEqual([ROOT]);
    expect(await listed(f.env, "sent")).toEqual([ROOT]);
    expect(await getMailboxConversationLocation(f.env, "owner", ROOT)).toBe("archive");
  });

  it("trashes a whole conversation and restores sent mail to Sent, not Inbox", async () => {
    const f = fixture();
    receive(f.raw, { id: "first" });
    send(f.raw, { id: "reply" });
    send(f.raw, { id: "draft", kind: "draft" });
    receive(f.raw, { id: "second" });

    expect(await moveMailboxConversation(f.env, "owner", ROOT, "trash", "inbox")).toMatchObject({ ok: true });
    expect(folders(f.raw)).toEqual({ draft: "drafts", first: "trash", reply: "trash", second: "trash" });
    expect(await listed(f.env, "inbox")).toEqual([]);
    expect(await listed(f.env, "sent")).toEqual([]);
    expect(await listed(f.env, "trash")).toEqual([ROOT]);
    expect(await getMailboxConversationLocation(f.env, "owner", ROOT)).toBe("trash");

    expect(await moveMailboxConversation(f.env, "owner", ROOT, "inbox", "trash")).toMatchObject({ ok: true });
    expect(folders(f.raw)).toEqual({ draft: "drafts", first: "inbox", reply: "sent", second: "inbox" });
  });

  it("deletes one message without moving the conversation, and keeps it deleted when the conversation moves", async () => {
    const f = fixture();
    receive(f.raw, { id: "first" });
    receive(f.raw, { id: "second" });
    receive(f.raw, { id: "third" });

    expect(await moveMailboxMessage(f.env, "owner", "second", "trash")).toMatchObject({ ok: true, folder: "trash" });
    expect(folders(f.raw)).toEqual({ first: "inbox", second: "trash", third: "inbox" });
    const inbox = await listMailboxThreads(f.env, "owner", { folder: "inbox" });
    expect("threads" in inbox && inbox.threads.map(thread => [thread.id, thread.messageCount, thread.latestMessageId])).toEqual([[ROOT, 2, "third"]]);
    const trash = await listMailboxThreads(f.env, "owner", { folder: "trash" });
    expect("threads" in trash && trash.threads.map(thread => [thread.id, thread.messageCount, thread.latestMessageId])).toEqual([[ROOT, 1, "second"]]);
    const open = await listMailboxThreadMessages(f.env, "owner", ROOT);
    expect("messages" in open && open.messages.map(message => message.id)).toEqual(["first", "third"]);
    const openTrash = await listMailboxThreadMessages(f.env, "owner", ROOT, "trash");
    expect("messages" in openTrash && openTrash.messages.map(message => message.id)).toEqual(["second"]);

    await moveMailboxConversation(f.env, "owner", ROOT, "archive", "inbox");
    expect(folders(f.raw)).toEqual({ first: "archive", second: "trash", third: "archive" });
    // Restoring from Trash brings the deleted message back to where its conversation is.
    await moveMailboxConversation(f.env, "owner", ROOT, "inbox", "trash");
    expect(folders(f.raw)).toEqual({ first: "inbox", second: "inbox", third: "inbox" });
  });

  it("marks received mail as spam and leaves the owner's sent mail alone", async () => {
    const f = fixture();
    receive(f.raw, { id: "first" });
    send(f.raw, { id: "reply" });
    receive(f.raw, { id: "second" });
    expect(await moveMailboxConversation(f.env, "owner", ROOT, "spam", "inbox")).toMatchObject({ ok: true });
    expect(folders(f.raw)).toEqual({ first: "spam", reply: "sent", second: "spam" });
    expect(await getMailboxConversationLocation(f.env, "owner", ROOT)).toBe("spam");
    await moveMailboxConversation(f.env, "owner", ROOT, "inbox", "spam");
    expect(folders(f.raw)).toEqual({ first: "inbox", reply: "sent", second: "inbox" });
  });

  it("moves the whole conversation when one message is archived or returned to Inbox", async () => {
    const f = fixture();
    receive(f.raw, { id: "first" });
    send(f.raw, { id: "reply" });
    receive(f.raw, { id: "second" });
    receive(f.raw, { id: "elsewhere", root: null, subject: "Another thing" });
    expect(await moveMailboxMessage(f.env, "owner", "second", "archive")).toMatchObject({ ok: true, folder: "archive" });
    expect(folders(f.raw)).toEqual({ elsewhere: "inbox", first: "archive", reply: "sent", second: "archive" });
    expect(await moveMailboxMessage(f.env, "owner", "first", "inbox")).toMatchObject({ ok: true });
    expect(folders(f.raw)).toEqual({ elsewhere: "inbox", first: "inbox", reply: "sent", second: "inbox" });
  });

  it("accepts archive for a conversation with only sent mail, refuses Sent and Drafts as targets, and keeps owners apart", async () => {
    const f = fixture();
    send(f.raw, { id: "only-sent" });
    expect(await moveMailboxConversation(f.env, "owner", ROOT, "archive", "sent")).toMatchObject({ ok: true });
    expect(folders(f.raw)).toEqual({ "only-sent": "sent" });
    expect(await getMailboxConversationLocation(f.env, "owner", ROOT)).toBe("sent");
    // Undo of "Trash" from the Sent view asks for the conversation back in Sent: that is a restore.
    await moveMailboxConversation(f.env, "owner", ROOT, "trash", "sent");
    expect(folders(f.raw)).toEqual({ "only-sent": "trash" });
    expect(await moveMailboxConversation(f.env, "owner", ROOT, "sent", "trash")).toMatchObject({ ok: true });
    expect(folders(f.raw)).toEqual({ "only-sent": "sent" });
    expect(await moveMailboxConversation(f.env, "owner", ROOT, "sent", "inbox")).toMatchObject({ status: 400 });
    expect(await moveMailboxConversation(f.env, "owner", ROOT, "drafts", "inbox")).toMatchObject({ status: 400 });
    expect(await moveMailboxConversation(f.env, "owner", "<missing@mail.test>", "archive", "inbox")).toMatchObject({ status: 404 });
    expect(await moveMailboxConversation(f.env, "other", ROOT, "trash", "sent")).toMatchObject({ status: 404 });
    expect(await moveMailboxMessage(f.env, "other", "only-sent", "trash")).toMatchObject({ status: 404 });
    expect(folders(f.raw)).toEqual({ "only-sent": "sent" });
  });

  it("puts conversations that sat in two folders where their newest received message is", () => {
    const f = fixture({ withoutConversationMigration: true });
    receive(f.raw, { id: "a-old", folder: "archive" });
    receive(f.raw, { id: "a-new", folder: "inbox" });
    receive(f.raw, { id: "b-old", folder: "inbox", root: "<b@mail.test>" });
    send(f.raw, { id: "b-sent", folder: "archive", root: "<b@mail.test>" });
    receive(f.raw, { id: "b-new", folder: "archive", root: "<b@mail.test>" });
    receive(f.raw, { id: "c-deleted", folder: "trash", root: "<c@mail.test>" });
    receive(f.raw, { id: "c-kept", folder: "inbox", root: "<c@mail.test>" });
    receive(f.raw, { id: "d-single", folder: "archive", root: null });
    f.raw.exec(MIGRATION_0105);
    expect(folders(f.raw)).toEqual({
      "a-old": "inbox", "a-new": "inbox",
      "b-old": "archive", "b-sent": "sent", "b-new": "archive",
      "c-deleted": "trash", "c-kept": "inbox",
      "d-single": "archive",
    });
  });

  it("never lets an archive rule hide a reply in a conversation the owner has written in", async () => {
    const f = fixture();
    f.raw.exec("INSERT INTO mailbox_rules(id,user_id,kind,match_value,label) VALUES('r1','owner','archive_sender','rosa@example.test','Always archive Rosa')");
    receive(f.raw, { id: "first" });
    send(f.raw, { id: "reply" });
    receive(f.raw, { id: "second" });
    await runMailTriage(f.env, "second", { classify: needsYou });
    expect(folders(f.raw)).toEqual({ first: "inbox", reply: "sent", second: "inbox" });
    expect(f.raw.prepare("SELECT handled_kind FROM mailbox_triage WHERE message_id = 'second'").get()).not.toMatchObject({ handled_kind: "rule_archive" });

    // Where the owner never wrote, the rule archives the whole conversation.
    receive(f.raw, { id: "n1", root: "<news@mail.test>" });
    receive(f.raw, { id: "n2", root: "<news@mail.test>" });
    await runMailTriage(f.env, "n2", { classify: needsYou });
    expect(folders(f.raw)).toMatchObject({ n1: "archive", n2: "archive" });
  });

  it("treats mail the owner sent from another app, with ME3 copied, as the owner's reply", async () => {
    const f = fixture();
    receive(f.raw, { id: "asked" });
    await runMailTriage(f.env, "asked", { classify: needsYou });
    expect((await getMailboxBrief(f.env, "owner")).needsYou.map(item => item.messageId)).toEqual(["asked"]);
    await moveMailboxConversation(f.env, "owner", ROOT, "archive", "inbox");
    f.raw.exec("UPDATE mailbox_triage SET resolved_at = NULL, resolved_how = NULL");

    receive(f.raw, { id: "mine", from: "kieran@gmail.test", body: "Hi Rosa, yes, the terms work.", ownerSigned: true, headers: { to: "rosa@example.test", cc: "ME3 <kieran@me3.test>" } });
    await runMailTriage(f.env, "mine", { classify: needsYou });
    expect(folders(f.raw)).toEqual({ asked: "archive", mine: "archive" });
    expect(f.raw.prepare("SELECT read_at IS NOT NULL AS read FROM mailbox_messages WHERE id = 'mine'").get()).toEqual({ read: 1 });
    expect(f.raw.prepare("SELECT resolved_at IS NOT NULL AS resolved, resolved_how FROM mailbox_triage WHERE message_id = 'asked'").get()).toEqual({ resolved: 1, resolved_how: "replied_elsewhere" });
    expect(await listed(f.env, "inbox")).toEqual([]);

    // In a conversation that is in Inbox it stays there, read, and the row still clears.
    receive(f.raw, { id: "q", root: "<q@mail.test>" });
    await runMailTriage(f.env, "q", { classify: needsYou });
    receive(f.raw, { id: "mine2", root: "<q@mail.test>", from: "kieran@gmail.test", body: "Hi Rosa, done.", ownerSigned: true, headers: { to: "rosa@example.test", cc: "ME3 <kieran@me3.test>" } });
    await runMailTriage(f.env, "mine2", { classify: needsYou });
    expect(folders(f.raw)).toMatchObject({ q: "inbox", mine2: "inbox" });
    expect((await getMailboxBrief(f.env, "owner")).needsYou).toEqual([]);
  });

  it("brings the whole conversation back when a handled action is undone, and archives all of it for a stale sign-in code", async () => {
    const f = fixture();
    receive(f.raw, { id: "note1", root: "<note@mail.test>", from: "no-reply@github.test", subject: "[GitHub] A new sign-in", body: "We noticed a new sign-in.", headers: { "auto-submitted": "auto-generated" } });
    receive(f.raw, { id: "note2", root: "<note@mail.test>", from: "no-reply@github.test", subject: "[GitHub] A new sign-in", body: "We noticed a new sign-in.", headers: { "auto-submitted": "auto-generated" } });
    await runMailTriage(f.env, "note2", { classify: fyi });
    expect(folders(f.raw)).toEqual({ note1: "archive", note2: "archive" });
    const action = f.raw.prepare("SELECT id FROM mailbox_handled_actions WHERE message_id = 'note2'").get() as { id: string };
    expect(await undoHandledAction(f.env, "owner", action.id)).toMatchObject({ ok: true, restored: "inbox" });
    expect(folders(f.raw)).toEqual({ note1: "inbox", note2: "inbox" });

    const now = new Date();
    receive(f.raw, { id: "code1", root: "<code@mail.test>", from: "no-reply@accounts.test", subject: "Your verification code", body: "Your code is 482913. It expires in 10 minutes.", headers: { "auto-submitted": "auto-generated" } });
    receive(f.raw, { id: "code2", root: "<code@mail.test>", from: "no-reply@accounts.test", subject: "Your verification code", body: "Your code is 771204. It expires in 10 minutes.", headers: { "auto-submitted": "auto-generated" } });
    await runMailTriage(f.env, "code2", { classify: fyi, now, notifyLoginCode: async () => undefined });
    expect(folders(f.raw)).toMatchObject({ code1: "inbox", code2: "inbox" });
    await archiveStaleLoginCodes(f.env, { now: new Date(now.getTime() + 2 * 60 * 60_000) });
    expect(folders(f.raw)).toMatchObject({ code1: "archive", code2: "archive" });
  });
});

// Failure modes (me3-kvu8.28): two emails of one conversation that both need the owner fill the
// Brief twice, and Done or "tomorrow" on the row leaves the other one behind; the "cleared" list
// cannot say how a row was cleared, lists mail that never needed the owner, or lists one
// conversation twice; an item archived from Inbox vanishes without a trace; "Bring back" reopens
// the row but leaves its conversation in Archive; a draft saved from a stale copy overwrites what
// ME3 or the owner wrote since; a client built for the old Brief loses a field it reads.
describe("the Brief is keyed by conversation", () => {
  it("shows one row per conversation and clears or snoozes all of it", async () => {
    const f = fixture();
    receive(f.raw, { id: "ask1", body: "Can you confirm the terms?" });
    receive(f.raw, { id: "ask2", subject: "One more thing", body: "And can we paint the storage room?" });
    receive(f.raw, { id: "other", root: null, from: "leo@example.test", subject: "Meetup talk" });
    for (const id of ["ask1", "ask2", "other"]) await runMailTriage(f.env, id, { classify: needsYou });

    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou.map(item => [item.messageId, item.threadId])).toEqual([["other", "<other@mail.test>"], ["ask2", ROOT]]);
    expect(brief.needsYou[1].relatedMessageIds).toEqual(["ask1"]);
    // Fields older clients read are still there.
    expect(brief).toMatchObject({ followUps: [], loginCodes: [], handled: { total: 0 }, fyi: { inboxLeft: 0, unread: 3 } });
    expect(brief.needsYou[0]).toMatchObject({ primaryAction: { kind: "draft_reply" }, secondaryAction: { kind: "remind_later" }, draft: null, duplicates: 0 });

    expect(await snoozeBriefItem(f.env, "owner", "ask2")).toMatchObject({ ok: true });
    expect((await getMailboxBrief(f.env, "owner")).needsYou.map(item => item.messageId)).toEqual(["other"]);
    f.raw.exec("UPDATE mailbox_triage SET snoozed_until = NULL");
    expect(await resolveBriefItem(f.env, "owner", "ask2")).toEqual({ ok: true });
    const after = await getMailboxBrief(f.env, "owner");
    expect(after.needsYou.map(item => item.messageId)).toEqual(["other"]);
    expect(after.cleared.map(item => [item.threadId, item.how])).toEqual([[ROOT, "done"]]);
  });

  it("lists what left the Brief today with how, once per conversation, and only mail that needed the owner", async () => {
    const f = fixture();
    const now = new Date();
    receive(f.raw, { id: "a1", root: "<a@mail.test>" });
    receive(f.raw, { id: "a2", root: "<a@mail.test>" });
    receive(f.raw, { id: "b", root: "<b@mail.test>", from: "leo@example.test" });
    receive(f.raw, { id: "c", root: "<c@mail.test>", from: "dana@example.test" });
    receive(f.raw, { id: "old", root: "<old@mail.test>", from: "sam@example.test" });
    for (const id of ["a1", "a2", "b", "c", "old"]) await runMailTriage(f.env, id, { classify: needsYou });
    receive(f.raw, { id: "note", root: "<n@mail.test>", from: "pat@example.test" });
    await runMailTriage(f.env, "note", { classify: fyi });

    await moveMailboxConversation(f.env, "owner", "<a@mail.test>", "archive", "inbox", now);
    await moveMailboxConversation(f.env, "owner", "<b@mail.test>", "trash", "inbox", now);
    await moveMailboxConversation(f.env, "owner", "<n@mail.test>", "archive", "inbox", now);
    const draft = await createAgentMailboxDraft(f.env, "owner", { to: "dana@example.test", subject: "Re: Studio lease", textBody: "Yes.", source: "user", replyToMessageId: "c" });
    if ("error" in draft || !draft.draft) throw new Error("draft not created");
    await resolveMailboxTriageForDraft(f.env, "owner", draft.draft.id, now);
    await resolveBriefItem(f.env, "owner", "old", new Date(now.getTime() - 3 * 24 * 60 * 60_000));

    const brief = await getMailboxBrief(f.env, "owner", { now });
    expect(brief.needsYou).toEqual([]);
    expect(brief.cleared.map(item => [item.threadId, item.messageId, item.how]).sort()).toEqual([
      ["<a@mail.test>", "a2", "archived"],
      ["<b@mail.test>", "b", "trashed"],
      ["<c@mail.test>", "c", "replied"],
    ]);
    expect(brief.cleared[0]).toMatchObject({ sender: { address: expect.any(String) }, subject: "Studio lease", clearedAt: now.toISOString() });
  });

  it("brings a cleared row back, with its conversation", async () => {
    const f = fixture();
    receive(f.raw, { id: "a1" });
    receive(f.raw, { id: "a2" });
    for (const id of ["a1", "a2"]) await runMailTriage(f.env, id, { classify: needsYou });
    await moveMailboxConversation(f.env, "owner", ROOT, "archive", "inbox");
    expect((await getMailboxBrief(f.env, "owner")).needsYou).toEqual([]);

    expect(await reopenBriefItem(f.env, "owner", "a2")).toEqual({ ok: true });
    expect(folders(f.raw)).toEqual({ a1: "inbox", a2: "inbox" });
    const brief = await getMailboxBrief(f.env, "owner");
    expect(brief.needsYou.map(item => item.messageId)).toEqual(["a2"]);
    expect(brief.cleared).toEqual([]);

    await resolveBriefItem(f.env, "owner", "a2");
    expect(await reopenBriefItem(f.env, "owner", "a2")).toEqual({ ok: true });
    expect((await getMailboxBrief(f.env, "owner")).needsYou.map(item => item.messageId)).toEqual(["a2"]);
    expect(await reopenBriefItem(f.env, "other", "a2")).toMatchObject({ status: 404 });
  });

  it("refuses a draft save made from a stale copy", async () => {
    const f = fixture();
    receive(f.raw, { id: "ask" });
    const created = await createAgentMailboxDraft(f.env, "owner", { to: "rosa@example.test", subject: "Re: Studio lease", textBody: "First version.", source: "agent", replyToMessageId: "ask" });
    if ("error" in created || !created.draft) throw new Error("draft not created");
    const opened = created.draft.updatedAt;
    expect(typeof opened).toBe("string");
    // ME3 rewrites it while the owner still has the first version open.
    f.raw.prepare("UPDATE mailbox_messages SET text_body = 'ME3 rewrote this.', updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?").run(created.draft.id);

    const stale = await updateAgentMailboxDraft(f.env, "owner", created.draft.id, { to: "rosa@example.test", subject: "Re: Studio lease", textBody: "The owner's edit.", expectedUpdatedAt: opened });
    expect(stale).toMatchObject({ status: 409 });
    expect(f.raw.prepare("SELECT text_body FROM mailbox_messages WHERE id = ?").get(created.draft.id)).toEqual({ text_body: "ME3 rewrote this." });

    const current = await updateAgentMailboxDraft(f.env, "owner", created.draft.id, { to: "rosa@example.test", subject: "Re: Studio lease", textBody: "The owner's edit.", expectedUpdatedAt: "2030-01-01T00:00:00.000Z" });
    expect(current).toMatchObject({ draft: { body: "The owner's edit." } });
    // Without the check (older clients) a save still goes through.
    expect(await updateAgentMailboxDraft(f.env, "owner", created.draft.id, { to: "rosa@example.test", subject: "Re: Studio lease", textBody: "Again." })).toMatchObject({ draft: { body: "Again." } });
  });
});

// Failure modes (me3-kvu8.24): a snoozed conversation still sits in Inbox or the Brief, or is in
// neither Inbox nor Snoozed; it never comes back when its time passes; "until someone replies"
// never comes back when nobody does; a reply does not wake it; archiving a snoozed conversation
// leaves it to pop back into Inbox later; a time in the past is accepted; one owner snoozes
// another's conversation; a conversation outside Inbox can be snoozed into limbo.
describe("snoozing a conversation", () => {
  const T0 = new Date("2026-11-13T10:00:00.000Z");
  const hours = (count: number) => new Date(T0.getTime() + count * 3_600_000);
  const listedAt = async (env: Env, folder: string, now: Date) => {
    const result = await listMailboxThreads(env, "owner", { folder, now });
    if ("error" in result) throw new Error(result.error);
    return result.threads.map(thread => thread.id);
  };

  it("leaves Inbox and the Brief until its time, shows under Snoozed, then comes back by itself", async () => {
    const f = fixture();
    receive(f.raw, { id: "ask" });
    receive(f.raw, { id: "other", root: null, from: "leo@example.test" });
    for (const id of ["ask", "other"]) await runMailTriage(f.env, id, { classify: needsYou });

    expect(await snoozeMailboxConversation(f.env, "owner", ROOT, { until: hours(20).toISOString() }, T0)).toEqual({ ok: true, id: ROOT, snoozedUntil: hours(20).toISOString(), untilReply: false });
    expect(await listedAt(f.env, "inbox", hours(1))).toEqual(["<other@mail.test>"]);
    expect(await listedAt(f.env, "snoozed", hours(1))).toEqual([ROOT]);
    expect((await getMailboxBrief(f.env, "owner", { now: hours(1) })).needsYou.map(item => item.messageId)).toEqual(["other"]);
    expect(await getMailboxConversationSnooze(f.env, "owner", ROOT, hours(1))).toEqual({ snoozedUntil: hours(20).toISOString(), untilReply: false });

    expect(await listedAt(f.env, "inbox", hours(21))).toEqual(["<other@mail.test>", ROOT]);
    expect(await listedAt(f.env, "snoozed", hours(21))).toEqual([]);
    expect((await getMailboxBrief(f.env, "owner", { now: hours(21) })).needsYou.map(item => item.messageId).sort()).toEqual(["ask", "other"]);
    expect(await getMailboxConversationSnooze(f.env, "owner", ROOT, hours(21))).toBeNull();
  });

  it("comes back after three days when it waited for a reply nobody sent, and at once when one arrives", async () => {
    const f = fixture();
    receive(f.raw, { id: "ask" });
    await runMailTriage(f.env, "ask", { classify: needsYou });
    expect(await snoozeMailboxConversation(f.env, "owner", ROOT, { untilReply: true }, T0)).toEqual({ ok: true, id: ROOT, snoozedUntil: hours(72).toISOString(), untilReply: true });
    expect(await listedAt(f.env, "inbox", hours(71))).toEqual([]);
    expect(await listedAt(f.env, "inbox", hours(73))).toEqual([ROOT]);

    receive(f.raw, { id: "answer" });
    await runMailTriage(f.env, "answer", { classify: needsYou });
    expect(await listedAt(f.env, "inbox", hours(2))).toEqual([ROOT]);
    expect(await listedAt(f.env, "snoozed", hours(2))).toEqual([]);
    expect((await getMailboxBrief(f.env, "owner", { now: hours(2) })).needsYou.map(item => item.messageId)).toEqual(["answer"]);
  });

  it("ends the snooze when the conversation is archived or unsnoozed", async () => {
    const f = fixture();
    receive(f.raw, { id: "ask" });
    await runMailTriage(f.env, "ask", { classify: needsYou });
    await snoozeMailboxConversation(f.env, "owner", ROOT, { until: hours(20).toISOString() }, T0);
    await moveMailboxConversation(f.env, "owner", ROOT, "archive", "snoozed", hours(1));
    expect(await listedAt(f.env, "snoozed", hours(2))).toEqual([]);
    expect(await listedAt(f.env, "archive", hours(2))).toEqual([ROOT]);
    expect(await listedAt(f.env, "inbox", hours(21))).toEqual([]);

    await moveMailboxConversation(f.env, "owner", ROOT, "inbox", "archive", hours(22));
    await snoozeMailboxConversation(f.env, "owner", ROOT, { until: hours(40).toISOString() }, hours(22));
    expect(await unsnoozeMailboxConversation(f.env, "owner", ROOT, hours(23))).toEqual({ ok: true, id: ROOT });
    expect(await listedAt(f.env, "inbox", hours(23))).toEqual([ROOT]);
    expect((await getMailboxBrief(f.env, "owner", { now: hours(23) })).needsYou.map(item => item.messageId)).toEqual(["ask"]);
  });

  it("refuses a past time, a conversation that is not in Inbox, and another owner's conversation", async () => {
    const f = fixture();
    receive(f.raw, { id: "ask" });
    receive(f.raw, { id: "filed", root: "<filed@mail.test>", folder: "archive" });
    expect(await snoozeMailboxConversation(f.env, "owner", ROOT, { until: hours(-1).toISOString() }, T0)).toMatchObject({ status: 400 });
    expect(await snoozeMailboxConversation(f.env, "owner", ROOT, {}, T0)).toMatchObject({ status: 400 });
    expect(await snoozeMailboxConversation(f.env, "owner", "<filed@mail.test>", { until: hours(5).toISOString() }, T0)).toMatchObject({ status: 409 });
    expect(await snoozeMailboxConversation(f.env, "other", ROOT, { until: hours(5).toISOString() }, T0)).toMatchObject({ status: 404 });
    expect(await unsnoozeMailboxConversation(f.env, "other", ROOT, T0)).toMatchObject({ status: 404 });
    expect(await listedAt(f.env, "inbox", hours(1))).toEqual([ROOT]);
  });
});

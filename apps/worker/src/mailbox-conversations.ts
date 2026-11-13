import { moveAgentMailboxMessage } from "@me3-core/plugin-agent-chat";
import type { Env } from "./types";

/**
 * A conversation is one unit (me3-kvu8.22, design decisions 4 and 5 of 13 Nov 2026).
 *
 * mailbox_messages.folder stays per message, because one message can be deleted on its own. What
 * makes a conversation one unit is how it is written and read:
 *   - Inbox and Archive apply to every received message of the conversation. A conversation with
 *     any message in Inbox is in Inbox and nowhere else.
 *   - Sent and Drafts are views: sent mail keeps folder 'sent' wherever its conversation is, and
 *     only moves when the whole conversation goes to Trash.
 *   - Trash takes every message; Spam takes received mail only, so the owner's own sent mail is
 *     never put on the spam purge.
 * Every move of a conversation, by the owner, a rule or ME3, goes through this file.
 */

type ServiceError = { error: string; status: number };
type Db = Pick<Env, "DB">;

const KEY = "canonical_thread_key";
const OWNER_MAILBOXES = "SELECT id FROM mailbox_aliases WHERE user_id = ?";
/** Not a draft: received mail, sent mail and system notes. */
const REAL = "message_kind != 'draft'";
const CONVERSATION_TARGETS = new Set(["inbox", "archive", "trash", "spam"]);
const SOURCE_FOLDERS = new Set(["inbox", "archive", "trash", "spam", "sent", "drafts"]);

/** Migration 0105, shared by the SQL file's test and the runtime migration. */
export const MAILBOX_CONVERSATION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS mailbox_conversation_state (
  mailbox_id TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  snoozed_until TEXT,
  snooze_until_reply INTEGER NOT NULL DEFAULT 0,
  snoozed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox_id, thread_key)
)`,
  `CREATE INDEX IF NOT EXISTS idx_mailbox_conversation_state_snoozed
  ON mailbox_conversation_state(mailbox_id, snoozed_until) WHERE snoozed_until IS NOT NULL`,
  "ALTER TABLE mailbox_messages ADD COLUMN send_after TEXT",
  `CREATE INDEX IF NOT EXISTS idx_mailbox_messages_send_after
  ON mailbox_messages(send_after) WHERE send_after IS NOT NULL`,
  "ALTER TABLE mailbox_triage ADD COLUMN resolved_how TEXT",
] as const;

/** One-off: conversations that sat in two folders go where their newest received message is. */
export const MAILBOX_CONVERSATION_FOLDER_FIX_STATEMENTS = [
  `UPDATE mailbox_messages SET folder = (
    SELECT newest.folder FROM mailbox_messages newest
    WHERE newest.mailbox_id = mailbox_messages.mailbox_id
      AND newest.canonical_thread_key = mailbox_messages.canonical_thread_key
      AND newest.direction = 'inbound' AND newest.message_kind = 'email'
      AND newest.folder IN ('inbox', 'archive')
    ORDER BY COALESCE(newest.received_at, newest.created_at) DESC, newest.id DESC
    LIMIT 1
  ), updated_at = CURRENT_TIMESTAMP
WHERE direction = 'inbound' AND message_kind = 'email' AND folder IN ('inbox', 'archive')
  AND EXISTS (
    SELECT 1 FROM mailbox_messages other
    WHERE other.mailbox_id = mailbox_messages.mailbox_id
      AND other.canonical_thread_key = mailbox_messages.canonical_thread_key
      AND other.direction = 'inbound' AND other.message_kind = 'email'
      AND other.folder IN ('inbox', 'archive') AND other.folder != mailbox_messages.folder
  )`,
  `UPDATE mailbox_messages SET folder = 'sent', updated_at = CURRENT_TIMESTAMP
WHERE direction = 'outbound' AND message_kind = 'email' AND status = 'sent' AND folder IN ('inbox', 'archive')`,
] as const;

export type MailboxConversationLocation = "inbox" | "archive" | "spam" | "sent" | "trash" | "drafts";

function normalizeFolder(value: unknown, allowed: Set<string>): string | null {
  const folder = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.has(folder) ? folder : null;
}

/** Where a conversation is: Inbox wins, then Archive; Sent for one with only sent mail. */
export async function getMailboxConversationLocation(env: Db, ownerId: string, threadId: string): Promise<MailboxConversationLocation | null> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ${REAL} AND folder = 'inbox' THEN 1 ELSE 0 END) AS inbox,
            SUM(CASE WHEN ${REAL} AND folder = 'archive' THEN 1 ELSE 0 END) AS archive,
            SUM(CASE WHEN ${REAL} AND folder = 'trash' AND spam_at IS NOT NULL THEN 1 ELSE 0 END) AS spam,
            SUM(CASE WHEN ${REAL} AND folder = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN ${REAL} AND folder = 'trash' AND spam_at IS NULL THEN 1 ELSE 0 END) AS trash
     FROM mailbox_messages
     WHERE mailbox_id IN (${OWNER_MAILBOXES}) AND ${KEY} = ?`,
  ).bind(ownerId, threadId).first<Record<"total" | "inbox" | "archive" | "spam" | "sent" | "trash", number | null>>();
  if (!row || !Number(row.total)) return null;
  for (const location of ["inbox", "archive", "spam", "sent", "trash"] as const) {
    if (Number(row[location]) > 0) return location;
  }
  return "drafts";
}

/**
 * Moves a whole conversation. `fromFolder` is the view the owner acted in: from Trash or Spam the
 * move restores what was there; from anywhere else a message deleted on its own stays deleted.
 */
export async function moveMailboxConversation(
  env: Db,
  ownerId: string,
  threadId: string,
  folderInput: unknown,
  fromFolderInput?: unknown,
  now = new Date(),
): Promise<{ ok: true; id: string; folder: string; fromFolder: string | null } | ServiceError> {
  const folder = normalizeFolder(folderInput, CONVERSATION_TARGETS);
  if (!folder) return { error: "Invalid folder", status: 400 };
  const fromFolder = fromFolderInput === undefined || fromFolderInput === null ? null : normalizeFolder(fromFolderInput, SOURCE_FOLDERS);
  if (fromFolderInput !== undefined && fromFolderInput !== null && !fromFolder) return { error: "Invalid source folder", status: 400 };

  const exists = await env.DB.prepare(
    `SELECT 1 AS found FROM mailbox_messages WHERE mailbox_id IN (${OWNER_MAILBOXES}) AND ${KEY} = ? AND ${REAL} LIMIT 1`,
  ).bind(ownerId, threadId).first<{ found: number }>();
  if (!exists) return { error: "Thread not found", status: 404 };

  const scope = `mailbox_id IN (${OWNER_MAILBOXES}) AND ${KEY} = ? AND ${REAL}`;
  const restoring = fromFolder === "trash" ? "folder = 'trash' AND spam_at IS NULL" : fromFolder === "spam" ? "folder = 'trash' AND spam_at IS NOT NULL" : null;
  const stamp = now.toISOString();

  if (folder === "inbox" || folder === "archive") {
    await env.DB.prepare(
      `UPDATE mailbox_messages SET folder = ?, spam_at = NULL, updated_at = ?
       WHERE ${scope} AND direction = 'inbound' AND (folder IN ('inbox', 'archive')${restoring ? ` OR (${restoring})` : ""})`,
    ).bind(folder, stamp, ownerId, threadId).run();
    if (fromFolder === "trash") {
      // Sent mail that went to Trash with its conversation goes back to Sent, never to Inbox.
      await env.DB.prepare(
        `UPDATE mailbox_messages SET folder = 'sent', updated_at = ?
         WHERE ${scope} AND direction = 'outbound' AND folder = 'trash' AND spam_at IS NULL`,
      ).bind(stamp, ownerId, threadId).run();
    }
  } else if (folder === "trash") {
    await env.DB.prepare(`UPDATE mailbox_messages SET folder = 'trash', spam_at = NULL, updated_at = ? WHERE ${scope}`)
      .bind(stamp, ownerId, threadId).run();
  } else {
    await env.DB.prepare(
      `UPDATE mailbox_messages SET folder = 'trash', spam_at = ?, updated_at = ?
       WHERE ${scope} AND direction = 'inbound' AND (folder IN ('inbox', 'archive')${restoring ? ` OR (${restoring})` : ""})`,
    ).bind(stamp, stamp, ownerId, threadId).run();
  }

  await recordConversationMoveInBrief(env, ownerId, threadId, folder, stamp);
  return { ok: true, id: threadId, folder, fromFolder };
}

/**
 * Dealing with a conversation anywhere clears its Brief rows, and says how. Bringing it back to
 * Inbox reopens only what a move had cleared, never what the owner marked done or replied to.
 */
async function recordConversationMoveInBrief(env: Db, ownerId: string, threadId: string, folder: string, stamp: string): Promise<void> {
  const messages = `SELECT id FROM mailbox_messages WHERE mailbox_id IN (${OWNER_MAILBOXES}) AND ${KEY} = ?`;
  if (folder === "inbox") {
    await env.DB.prepare(
      `UPDATE mailbox_triage SET resolved_at = NULL, resolved_how = NULL, updated_at = ?
       WHERE user_id = ? AND resolved_how IN ('archived', 'trashed', 'spam') AND message_id IN (${messages})`,
    ).bind(stamp, ownerId, ownerId, threadId).run();
    return;
  }
  const how = folder === "archive" ? "archived" : folder === "trash" ? "trashed" : "spam";
  await env.DB.prepare(
    `UPDATE mailbox_triage SET resolved_at = ?, resolved_how = ?, updated_at = ?
     WHERE user_id = ? AND resolved_at IS NULL AND message_id IN (${messages})`,
  ).bind(stamp, how, stamp, ownerId, ownerId, threadId).run();
}

type MessageRow = { id: string; mailbox_id: string; thread_id: string; direction: string; message_kind: string };

async function ownMessage(env: Db, ownerId: string, messageId: string): Promise<MessageRow | null> {
  return (await env.DB.prepare(
    `SELECT id, mailbox_id, ${KEY} AS thread_id, direction, message_kind FROM mailbox_messages
     WHERE id = ? AND mailbox_id IN (${OWNER_MAILBOXES})`,
  ).bind(messageId, ownerId).first<MessageRow>()) || null;
}

/**
 * Moves one message. Inbox and Archive take its whole conversation along; Trash and Spam act on
 * this message only ("Delete this message").
 */
export async function moveMailboxMessage(
  env: Db,
  ownerId: string,
  messageId: string,
  folderInput: unknown,
  now = new Date(),
): Promise<{ ok: true; id: string; folder: string } | ServiceError> {
  const folder = normalizeFolder(folderInput, SOURCE_FOLDERS);
  if (!folder) return { error: "Invalid folder", status: 400 };
  const message = await ownMessage(env, ownerId, messageId);
  if (!message) return { error: "Message not found", status: 404 };
  // Drafts, and the Sent and Drafts targets, keep the plain per-message move.
  if (message.message_kind === "draft" || folder === "sent" || folder === "drafts") {
    return moveAgentMailboxMessage(env, ownerId, messageId, folder);
  }
  const stamp = now.toISOString();
  if (folder === "trash" || folder === "spam") {
    if (folder === "spam" && message.direction !== "inbound") return { error: "Only received mail can be marked as spam", status: 400 };
    await env.DB.prepare("UPDATE mailbox_messages SET folder = 'trash', spam_at = ?, updated_at = ? WHERE id = ?")
      .bind(folder === "spam" ? stamp : null, stamp, messageId).run();
    return { ok: true, id: messageId, folder };
  }
  // A deleted message comes back first, then its conversation moves as one.
  await env.DB.prepare("UPDATE mailbox_messages SET folder = ?, spam_at = NULL, updated_at = ? WHERE id = ?")
    .bind(message.direction === "outbound" ? "sent" : folder, stamp, messageId).run();
  const moved = await moveMailboxConversation(env, ownerId, message.thread_id, folder, undefined, now);
  if ("error" in moved) return moved;
  return { ok: true, id: messageId, folder };
}

// --- ME3's own moves (triage, rules, cron). They act on a message's conversation. ---

const CONVERSATION_OF_MESSAGE = `mailbox_id = (SELECT mailbox_id FROM mailbox_messages WHERE id = ?)
  AND ${KEY} = (SELECT ${KEY} FROM mailbox_messages WHERE id = ?)`;

/** Archives the received mail of a message's conversation that is in Inbox. Returns how many moved. */
export async function archiveConversationOfMessage(env: Db, messageId: string): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE mailbox_messages SET folder = 'archive', updated_at = CURRENT_TIMESTAMP
     WHERE ${CONVERSATION_OF_MESSAGE} AND ${REAL} AND direction = 'inbound' AND folder = 'inbox'`,
  ).bind(messageId, messageId).run();
  return Number(result.meta?.changes || 0);
}

/** Brings the archived received mail of a message's conversation back to Inbox. */
export async function returnConversationOfMessageToInbox(env: Db, messageId: string): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE mailbox_messages SET folder = 'inbox', updated_at = CURRENT_TIMESTAMP
     WHERE ${CONVERSATION_OF_MESSAGE} AND ${REAL} AND direction = 'inbound' AND folder = 'archive'`,
  ).bind(messageId, messageId).run();
  return Number(result.meta?.changes || 0);
}

/** After triage: mail that stayed in Inbox brings the rest of its conversation back with it. */
export async function settleConversationOfMessage(env: Db, messageId: string): Promise<void> {
  const message = await env.DB.prepare("SELECT folder FROM mailbox_messages WHERE id = ?").bind(messageId).first<{ folder: string }>();
  if (message?.folder === "inbox") await returnConversationOfMessageToInbox(env, messageId);
}

/** Has the owner sent mail in this message's conversation? Rules never hide a reply there. */
export async function ownerHasWrittenInConversationOfMessage(env: Db, messageId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS found FROM mailbox_messages
     WHERE ${CONVERSATION_OF_MESSAGE} AND direction = 'outbound' AND message_kind = 'email' AND status = 'sent' LIMIT 1`,
  ).bind(messageId, messageId).first<{ found: number }>();
  return Boolean(row);
}

/**
 * The owner replied from another mail app and copied ME3. That is the owner's reply, not new
 * mail: it is read, it joins its conversation where the conversation already is (an archived one
 * stays archived), and the conversation's Brief rows clear.
 */
export async function fileOwnerReplyFromElsewhere(env: Db, input: { messageId: string; userId: string }, now = new Date()): Promise<void> {
  const stamp = now.toISOString();
  const others = await env.DB.prepare(
    `SELECT SUM(CASE WHEN folder = 'inbox' THEN 1 ELSE 0 END) AS inbox, SUM(CASE WHEN folder = 'archive' THEN 1 ELSE 0 END) AS archive
     FROM mailbox_messages
     WHERE ${CONVERSATION_OF_MESSAGE} AND ${REAL} AND direction = 'inbound' AND id != ?`,
  ).bind(input.messageId, input.messageId, input.messageId).first<{ inbox: number | null; archive: number | null }>();
  const archived = !Number(others?.inbox) && Number(others?.archive) > 0;
  await env.DB.prepare(
    `UPDATE mailbox_messages SET read_at = COALESCE(read_at, ?), folder = CASE WHEN ? AND folder = 'inbox' THEN 'archive' ELSE folder END, updated_at = ?
     WHERE id = ?`,
  ).bind(stamp, archived ? 1 : 0, stamp, input.messageId).run();
  await env.DB.prepare(
    `UPDATE mailbox_triage SET resolved_at = ?, resolved_how = 'replied_elsewhere', updated_at = ?
     WHERE user_id = ? AND resolved_at IS NULL AND message_id != ?
       AND message_id IN (SELECT id FROM mailbox_messages WHERE ${CONVERSATION_OF_MESSAGE} AND direction = 'inbound')`,
  ).bind(stamp, stamp, input.userId, input.messageId, input.messageId, input.messageId).run();
}

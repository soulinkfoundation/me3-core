import {
  mailAddresses,
  recordMailboxSendForContacts,
  recordOutreachInbound,
  type OutreachInboundChange,
  type OutreachInboundKind,
} from "@me3-core/plugin-agent-chat";
import type { MailHandledUndo } from "./mailbox-triage";
import { mailboxCanonicalThreadKeySql } from "./mailbox-thread-key";
import type { Env } from "./types";

// ME3 Email keeps People's outreach status in step: a send marks a prospect
// Sent, an answer marks them Replied, an invite marks a call booked. The rules
// live with contacts (packages/agent-chat/src/contact-outreach.ts); this file
// only gathers what the mailbox knows.

type SentRow = { to_address: string | null; metadata_json: string | null; sent_at: string | null };

/** A draft that became sent outside markAgentMailboxDraftSent still counts for contacts. */
export async function syncContactsFromSentMessage(
  env: Pick<Env, "DB">,
  ownerId: string,
  messageId: string,
): Promise<void> {
  try {
    const row = await env.DB.prepare(
      `SELECT m.to_address, m.metadata_json, m.sent_at FROM mailbox_messages m
       WHERE m.id = ? AND m.status = 'sent'
         AND m.mailbox_id IN (SELECT id FROM mailbox_aliases WHERE user_id = ?)`,
    )
      .bind(messageId, ownerId)
      .first<SentRow>();
    if (row?.sent_at) await recordMailboxSendForContacts(env, ownerId, row, row.sent_at);
  } catch (error) {
    console.error("Contact update after send failed", error);
  }
}

const STATUS_WORDS: Record<string, string> = { replied: "Replied", booked: "Call booked" };

async function logOutreachHandled(
  env: Pick<Env, "DB">,
  ownerId: string,
  messageId: string,
  change: OutreachInboundChange,
): Promise<void> {
  const who = change.organisation && change.organisation.toLowerCase() !== change.name.toLowerCase()
    ? `${change.name} (${change.organisation})`
    : change.name;
  const bounced = change.status === "bounced";
  const label = bounced ? `Email to ${who} bounced` : `Marked ${who} ${STATUS_WORDS[String(change.status)] || change.status}`;
  const detail = bounced
    ? "Check the address in People. The status and follow-up date were kept."
    : change.status === "booked"
      ? "They sent a calendar invite, so the follow-up was cancelled."
      : "They answered, so the follow-up was cancelled.";
  const undo: MailHandledUndo | null = bounced
    ? null
    : { kind: "restore_outreach", contactId: change.contactId, status: change.previousStatus, nextFollowupAt: change.previousFollowUpAt };
  await env.DB.prepare(
    `INSERT INTO mailbox_handled_actions (id, user_id, message_id, kind, label, detail, undo_json, created_at)
     VALUES (?, ?, ?, 'outreach', ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), ownerId, messageId, label.slice(0, 200), detail, undo ? JSON.stringify(undo) : null, new Date().toISOString())
    .run();
}

export type ContactMailHistoryItem = { id: string; direction: "inbound" | "outbound"; subject: string; at: string };

/** The owner's ME3 Email with one person: subjects and dates only, newest first. */
export async function listContactMailHistory(
  env: Pick<Env, "DB">,
  ownerId: string,
  contactId: string,
): Promise<{ history: ContactMailHistoryItem[] } | { error: string; status: 404 }> {
  const contact = await env.DB.prepare("SELECT email FROM contacts WHERE user_id = ? AND id = ?")
    .bind(ownerId, contactId)
    .first<{ email: string | null }>();
  if (!contact) return { error: "Contact not found", status: 404 };
  const email = contact.email?.trim().toLowerCase();
  if (!email) return { history: [] };
  const rows = await env.DB.prepare(
    `SELECT id, direction, COALESCE(subject, '') AS subject, to_address,
            COALESCE(sent_at, received_at, created_at) AS at
     FROM mailbox_messages
     WHERE mailbox_id IN (SELECT id FROM mailbox_aliases WHERE user_id = ?)
       AND message_kind = 'email' AND status IN ('sent', 'received')
       AND (LOWER(TRIM(COALESCE(from_address, ''))) = ? OR INSTR(LOWER(COALESCE(to_address, '')), ?) > 0)
     ORDER BY COALESCE(sent_at, received_at, created_at) DESC, id DESC LIMIT 40`,
  )
    .bind(ownerId, email, email)
    .all<ContactMailHistoryItem & { to_address: string | null }>();
  const history = (rows.results || [])
    // INSTR also finds "rosemary@x" inside a search for "mary@x"; keep exact addresses only.
    .filter((row) => row.direction === "inbound" || mailAddresses([row.to_address]).includes(email))
    .slice(0, 8)
    .map(({ id, direction, subject, at }) => ({ id, direction, subject, at }));
  return { history };
}

export async function syncOutreachFromInbound(
  env: Pick<Env, "DB">,
  ownerId: string,
  input: {
    messageId: string;
    fromAddress: string;
    headers: Record<string, string>;
    subject: string;
    textBody: string | null;
    attachments: Array<{ filename?: string | null; mimeType?: string | null }>;
  },
): Promise<OutreachInboundKind> {
  try {
    // Who the owner wrote to earlier in this conversation: a colleague answering
    // from another address still answers for the prospect.
    const sent = await env.DB.prepare(
      `SELECT t.to_address FROM mailbox_messages m
       JOIN mailbox_messages t ON t.mailbox_id = m.mailbox_id
        AND ${mailboxCanonicalThreadKeySql("t")} = ${mailboxCanonicalThreadKeySql("m")}
       WHERE m.id = ? AND t.direction = 'outbound' AND t.status = 'sent'
       LIMIT 20`,
    )
      .bind(input.messageId)
      .all<{ to_address: string | null }>()
      .catch(() => ({ results: [] as Array<{ to_address: string | null }> }));
    const hasCalendarInvite =
      /text\/calendar/i.test(input.headers["content-type"] || "") ||
      input.attachments.some(
        (attachment) =>
          /^text\/calendar/i.test(attachment.mimeType || "") || /\.ics$/i.test(attachment.filename || ""),
      );
    const result = await recordOutreachInbound(env, ownerId, {
      fromAddress: input.fromAddress,
      threadRecipients: (sent.results || []).map((row) => row.to_address),
      headers: input.headers,
      subject: input.subject,
      textBody: input.textBody,
      hasCalendarInvite,
    });
    // The Brief's "Handled by ME3" says what changed and why, with an undo.
    for (const change of result.changes) {
      await logOutreachHandled(env, ownerId, input.messageId, change).catch((error) =>
        console.error("Outreach handled entry failed", error),
      );
    }
    return result.kind;
  } catch (error) {
    console.error("Outreach status update failed", error);
    return null;
  }
}

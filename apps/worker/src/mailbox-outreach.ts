import {
  recordMailboxSendForContacts,
  recordOutreachInbound,
  type OutreachInboundKind,
} from "@me3-core/plugin-agent-chat";
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
    return result.kind;
  } catch (error) {
    console.error("Outreach status update failed", error);
    return null;
  }
}

import {
  OUTREACH_FOLLOWUP_CAP,
  createAgentMailboxDraft,
  rejectAgentMailboxDraft,
} from "@me3-core/plugin-agent-chat";
import { createModelReplyWriter, getOwnerDayStart, type MailReplyWriter } from "./mailbox-brief";
import { cleanMailPreview } from "./mailbox-sender-identity";
import type { Env } from "./types";

// The Brief's "Follow-ups due": prospects the owner wrote to whose follow-up
// date has passed without an answer. ME3 drafts the nudge; the owner sends it
// through the normal draft approval. After OUTREACH_FOLLOWUP_CAP follow-ups
// ME3 stops and the prospect becomes "No response".

type ServiceError = { error: string; status: number };

export type MailboxFollowUp = {
  contactId: string;
  name: string;
  organisation: string | null;
  email: string;
  offer: string | null;
  /** Subject of the owner's last email to them, when ME3 Email sent it. */
  subject: string | null;
  daysWaiting: number;
  followUpNumber: number;
  followUpCap: number;
  draft: { id: string; preview: string; body: string; updatedAt?: string | null } | null;
};

type ProspectRow = {
  id: string;
  name: string;
  email: string;
  metadata: string | null;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  outreach_status: string | null;
};
type SentRow = { id: string; subject: string | null; text_body: string | null; sent_at: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const OWNER_MAILBOXES = "SELECT id FROM mailbox_aliases WHERE user_id = ?";

function metadataOf(row: Pick<ProspectRow, "metadata">): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.metadata || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const followUpsSent = (metadata: Record<string, unknown>) => Math.max(0, Number(metadata.outreachFollowUpsSent) || 0);

async function saveMetadata(env: Pick<Env, "DB">, ownerId: string, contactId: string, metadata: Record<string, unknown>) {
  await env.DB.prepare("UPDATE contacts SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?")
    .bind(Object.keys(metadata).length ? JSON.stringify(metadata) : null, ownerId, contactId)
    .run();
}

async function lastSentTo(env: Pick<Env, "DB">, ownerId: string, email: string): Promise<SentRow | null> {
  return env.DB.prepare(
    `SELECT id, subject, SUBSTR(COALESCE(text_body, ''), 1, 6000) AS text_body, sent_at FROM mailbox_messages
     WHERE mailbox_id IN (${OWNER_MAILBOXES}) AND direction = 'outbound' AND status = 'sent'
       AND INSTR(LOWER(COALESCE(to_address, '')), ?) > 0
     ORDER BY sent_at DESC, id DESC LIMIT 1`,
  )
    .bind(ownerId, email.trim().toLowerCase())
    .first<SentRow>();
}

async function pendingDraft(env: Pick<Env, "DB">, ownerId: string, draftId: unknown) {
  if (typeof draftId !== "string" || !draftId) return null;
  return env.DB.prepare(
    `SELECT id, subject, to_address, text_body, updated_at FROM mailbox_messages
     WHERE id = ? AND mailbox_id IN (${OWNER_MAILBOXES}) AND message_kind = 'draft' AND status = 'pending_approval'`,
  )
    .bind(draftId, ownerId)
    .first<{ id: string; subject: string | null; to_address: string | null; text_body: string | null; updated_at: string | null }>();
}

async function dueProspect(env: Pick<Env, "DB">, ownerId: string, contactId: string): Promise<ProspectRow | null> {
  return env.DB.prepare(
    `SELECT id, name, email, metadata, last_interaction_at, next_followup_at, outreach_status FROM contacts
     WHERE user_id = ? AND id = ? AND relationship = 'prospect' AND status != 'archived'
       AND email IS NOT NULL AND TRIM(email) != ''`,
  )
    .bind(ownerId, contactId)
    .first<ProspectRow>();
}

export async function listDueFollowUps(env: Pick<Env, "DB">, ownerId: string, now = new Date()): Promise<MailboxFollowUp[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, email, metadata, last_interaction_at, next_followup_at, outreach_status FROM contacts
     WHERE user_id = ? AND relationship = 'prospect' AND status != 'archived' AND outreach_status = 'sent'
       AND email IS NOT NULL AND TRIM(email) != ''
       AND next_followup_at IS NOT NULL AND julianday(next_followup_at) <= julianday(?)
     ORDER BY next_followup_at ASC LIMIT 20`,
  )
    .bind(ownerId, now.toISOString())
    .all<ProspectRow>();

  const items: MailboxFollowUp[] = [];
  for (const row of rows.results || []) {
    const metadata = metadataOf(row);
    const sentCount = followUpsSent(metadata);
    if (sentCount >= OUTREACH_FOLLOWUP_CAP) {
      // ME3 has chased enough; the owner can still write again by hand.
      await env.DB.prepare(
        "UPDATE contacts SET outreach_status = 'no_response', next_followup_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?",
      ).bind(ownerId, row.id).run();
      continue;
    }
    const sent = await lastSentTo(env, ownerId, row.email);
    const draft = await pendingDraft(env, ownerId, metadata.outreachFollowUpDraftId);
    const since = Date.parse(sent?.sent_at || row.last_interaction_at || "");
    items.push({
      contactId: row.id,
      name: row.name,
      organisation: text(metadata.organisation),
      email: row.email.trim().toLowerCase(),
      offer: text(metadata.outreachOffer),
      subject: text(sent?.subject),
      daysWaiting: Number.isFinite(since) ? Math.max(0, Math.floor((now.getTime() - since) / DAY_MS)) : 0,
      followUpNumber: sentCount + 1,
      followUpCap: OUTREACH_FOLLOWUP_CAP,
      draft: draft
        ? { id: draft.id, preview: cleanMailPreview(draft.text_body, { maxLength: 220 }), body: draft.text_body || "", updatedAt: draft.updated_at }
        : null,
    });
  }
  return items;
}

/** ME3 writes the follow-up as a reply in the outreach thread and saves it for the owner's OK. */
export async function draftFollowUp(
  env: Env,
  ownerId: string,
  contactId: string,
  options: { write?: MailReplyWriter } = {},
): Promise<{ draft: { id: string; subject: string; body: string; to: string } } | ServiceError> {
  const prospect = await dueProspect(env, ownerId, contactId);
  if (!prospect) return { error: "Prospect not found", status: 404 };
  const metadata = metadataOf(prospect);
  if (prospect.outreach_status !== "sent" || followUpsSent(metadata) >= OUTREACH_FOLLOWUP_CAP) {
    return { error: "This prospect is not waiting on a follow-up", status: 409 };
  }
  const existing = await pendingDraft(env, ownerId, metadata.outreachFollowUpDraftId);
  if (existing) {
    return { draft: { id: existing.id, subject: existing.subject || "", body: existing.text_body || "", to: existing.to_address || "" } };
  }

  const to = prospect.email.trim().toLowerCase();
  const sent = await lastSentTo(env, ownerId, to);
  const owner = await env.DB.prepare("SELECT name FROM owner_profile WHERE id = ?")
    .bind(ownerId).first<{ name: string | null }>().catch(() => null);
  const offer = text(metadata.outreachOffer);
  const earlierSubject = text(sent?.subject) || "";
  const subject = earlierSubject ? (/^re:/i.test(earlierSubject) ? earlierSubject : `Re: ${earlierSubject}`) : "Following up";
  const instruction = [
    `Write a short follow-up to ${prospect.name}${text(metadata.organisation) ? ` at ${text(metadata.organisation)}` : ""}, who has not answered.`,
    "replyingTo is my own earlier email to them, not a message from them. Bring it back to the top of their inbox in two or three sentences,",
    offer ? `restate what I offered in one line (${offer}),` : "",
    "and suggest one easy next step such as a short call. Do not apologise, do not sound pushy, and add nothing I did not offer.",
  ].filter(Boolean).join(" ");
  const write = options.write || createModelReplyWriter(env);
  let written: { subject: string; body: string };
  try {
    written = await write({
      ownerId,
      ownerName: owner?.name || null,
      instruction,
      subject: earlierSubject || subject,
      from: "me",
      body: cleanMailPreview(sent?.text_body || "", { maxLength: 6000, subject: earlierSubject }),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ME3 could not write a follow-up this time.", status: 502 };
  }

  const created = await createAgentMailboxDraft(env, ownerId, {
    to,
    subject,
    textBody: written.body,
    source: "agent",
    ...(sent ? { replyToMessageId: sent.id } : {}),
  });
  if ("error" in created) return created;
  await saveMetadata(env, ownerId, prospect.id, { ...metadata, outreachFollowUpDraftId: created.draft.id });
  return { draft: { id: created.draft.id, subject, body: written.body, to } };
}

/** "Later": the follow-up comes back at 08:00 tomorrow, owner's time. */
export async function snoozeFollowUp(
  env: Pick<Env, "DB">,
  ownerId: string,
  contactId: string,
  now = new Date(),
): Promise<{ ok: true; nextFollowupAt: string } | ServiceError> {
  const prospect = await dueProspect(env, ownerId, contactId);
  if (!prospect) return { error: "Prospect not found", status: 404 };
  const nextFollowupAt = new Date(Date.parse(await getOwnerDayStart(env, ownerId, now)) + 32 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("UPDATE contacts SET next_followup_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?")
    .bind(nextFollowupAt, ownerId, contactId).run();
  return { ok: true, nextFollowupAt };
}

/** "Stop following up": no more nudges; the status stays as it is and the draft is discarded. */
export async function stopFollowUp(
  env: Pick<Env, "DB">,
  ownerId: string,
  contactId: string,
): Promise<{ ok: true } | ServiceError> {
  const prospect = await dueProspect(env, ownerId, contactId);
  if (!prospect) return { error: "Prospect not found", status: 404 };
  const { outreachFollowUpDraftId, ...metadata } = metadataOf(prospect);
  const draft = await pendingDraft(env, ownerId, outreachFollowUpDraftId);
  if (draft) await rejectAgentMailboxDraft(env, ownerId, draft.id);
  await env.DB.prepare(
    "UPDATE contacts SET next_followup_at = NULL, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?",
  ).bind(Object.keys(metadata).length ? JSON.stringify(metadata) : null, ownerId, contactId).run();
  return { ok: true };
}

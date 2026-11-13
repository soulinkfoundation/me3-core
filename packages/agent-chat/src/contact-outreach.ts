import { touchContactInteraction } from "./contact-people";
import type { AgentContactOutreachStatus } from "./contact-types";
import { type CoreAgentChatEnv, isPlainObject, parseJsonRecord } from "./domain-store";
import { getDraftCcBcc } from "./mailbox-format";
import type { DbMailboxMessageRow } from "./mailbox-types";

// Outreach: a prospect is a contact with relationship = 'prospect'. ME3 Email
// keeps outreach_status and next_followup_at in step with what was sent and
// what came back. A status only ever moves forward here; the owner can still
// set anything by hand.

type OutreachEnv = Pick<CoreAgentChatEnv, "DB">;

export const OUTREACH_DEFAULT_FOLLOWUP_DAYS = 7;
/** Follow-ups ME3 drafts before it stops and marks the prospect "No response". */
export const OUTREACH_FOLLOWUP_CAP = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_YET_ANSWERED = new Set<AgentContactOutreachStatus>([null, "new", "drafted", "sent", "no_response"]);

type ProspectRow = {
  id: string;
  outreach_status: AgentContactOutreachStatus;
  next_followup_at: string | null;
  metadata: string | null;
};

export type OutreachSendOptions = { followUpDays?: number | null };

/** Bare lowercased addresses from header-style values ("Mary <m@x.ie>, n@y.ie"). */
export function mailAddresses(values: Array<string | null | undefined>): string[] {
  const found = values.flatMap((value) => (value || "").match(/[^\s<>(),;:"']+@[^\s<>(),;:"']+\.[^\s<>(),;:"']+/g) || []);
  return Array.from(new Set(found.map((address) => address.toLowerCase().replace(/[.]+$/, "")))).slice(0, 50);
}

export function outreachFollowUpDays(value: unknown): number | null {
  const days = Math.round(Number(value));
  return Number.isFinite(days) && days >= 1 && days <= 90 ? days : null;
}

async function prospectsByEmail(env: OutreachEnv, userId: string, emails: string[]): Promise<ProspectRow[]> {
  if (emails.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT id, outreach_status, next_followup_at, metadata FROM contacts
     WHERE user_id = ? AND relationship = 'prospect' AND status != 'archived'
       AND LOWER(TRIM(email)) IN (${emails.map(() => "?").join(", ")})`,
  )
    .bind(userId, ...emails)
    .all<ProspectRow>();
  return rows.results || [];
}

async function saveProspect(
  env: OutreachEnv,
  userId: string,
  prospect: ProspectRow,
  change: { status?: AgentContactOutreachStatus; followUpAt?: string | null; metadata?: Record<string, unknown> },
) {
  const metadata = change.metadata ?? parseJsonRecord(prospect.metadata);
  await env.DB.prepare(
    `UPDATE contacts
     SET outreach_status = ?, next_followup_at = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`,
  )
    .bind(
      change.status === undefined ? prospect.outreach_status : change.status,
      change.followUpAt === undefined ? prospect.next_followup_at : change.followUpAt,
      Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      userId,
      prospect.id,
    )
    .run();
}

/**
 * The owner's email went out. A prospect not yet written to becomes Sent with a
 * follow-up date; one still waiting on a reply has had a follow-up, so the count
 * goes up and the date moves on. Anyone already talking is left alone.
 */
export async function recordOutreachEmailSent(
  env: OutreachEnv,
  userId: string,
  input: { recipients: Array<string | null | undefined>; sentAt: string } & OutreachSendOptions,
): Promise<string[]> {
  const sentTime = Date.parse(input.sentAt);
  if (!Number.isFinite(sentTime)) return [];
  const chosenDays = outreachFollowUpDays(input.followUpDays);
  const prospects = await prospectsByEmail(env, userId, mailAddresses(input.recipients));
  const changed: string[] = [];
  for (const prospect of prospects) {
    if (!NOT_YET_ANSWERED.has(prospect.outreach_status)) continue;
    const metadata = parseJsonRecord(prospect.metadata);
    if (chosenDays) metadata.outreachFollowUpDays = chosenDays;
    const days = outreachFollowUpDays(metadata.outreachFollowUpDays) || OUTREACH_DEFAULT_FOLLOWUP_DAYS;
    if (prospect.outreach_status === "sent") {
      metadata.outreachFollowUpsSent = Math.max(0, Number(metadata.outreachFollowUpsSent) || 0) + 1;
    } else {
      delete metadata.outreachFollowUpsSent;
    }
    delete metadata.outreachBounced;
    await saveProspect(env, userId, prospect, {
      status: "sent",
      followUpAt: new Date(sentTime + days * DAY_MS).toISOString(),
      metadata,
    });
    changed.push(prospect.id);
  }
  return changed;
}

/** Every address on a sent message counts as being in touch, and as outreach for prospects. */
export async function recordMailboxSendForContacts(
  env: OutreachEnv,
  userId: string,
  message: Pick<DbMailboxMessageRow, "to_address" | "metadata_json">,
  sentAt: string,
): Promise<void> {
  const { cc, bcc } = getDraftCcBcc(message);
  const recipients = mailAddresses([message.to_address, ...cc, ...bcc]);
  if (recipients.length === 0) return;
  await touchContactInteraction(env, userId, { emails: recipients }, sentAt);
  const outreach = parseJsonRecord(message.metadata_json || null).outreach;
  await recordOutreachEmailSent(env, userId, {
    recipients,
    sentAt,
    followUpDays: isPlainObject(outreach) ? outreachFollowUpDays(outreach.followUpDays) : null,
  });
}

export type OutreachInboundKind = "reply" | "auto_reply" | "bounce" | "invite" | null;

export function isAutoReply(headers: Record<string, string>, subject: string): boolean {
  const autoSubmitted = (headers["auto-submitted"] || "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (headers["x-autoreply"] || headers["x-autorespond"]) return true;
  if ((headers.precedence || "").trim().toLowerCase() === "auto_reply") return true;
  return /^\s*(auto(matic)?[ -]?(reply|response)|autoreply|out of (the )?office|ooo\b|auto:)/i.test(subject);
}

export function isBounce(headers: Record<string, string>, fromAddress: string, subject: string): boolean {
  if (/^(mailer-daemon|postmaster|bounces?)([+@-]|$)/i.test(fromAddress.trim())) return true;
  if (/multipart\/report/i.test(headers["content-type"] || "") && /delivery-status/i.test(headers["content-type"] || "")) return true;
  return /\b(undeliver(ed|able)|delivery status notification|delivery (has )?failed|returned to sender|failure notice|address not found)\b/i.test(subject);
}

/**
 * Mail arrived. A reply from the prospect, or from anyone answering in a thread
 * the owner sent to the prospect, sets Replied and clears the follow-up date;
 * a calendar invite sets Call booked. Auto-replies change nothing, and a bounce
 * is only flagged. A sender who merely shares a domain is never matched.
 */
export async function recordOutreachInbound(
  env: OutreachEnv,
  userId: string,
  input: {
    fromAddress: string;
    /** Addresses the owner wrote to earlier in this conversation. */
    threadRecipients: Array<string | null | undefined>;
    headers: Record<string, string>;
    subject: string;
    textBody: string | null;
    hasCalendarInvite: boolean;
  },
): Promise<{ kind: OutreachInboundKind; contactIds: string[] }> {
  if (isBounce(input.headers, input.fromAddress, input.subject)) {
    const bounced = await prospectsByEmail(
      env,
      userId,
      mailAddresses([(input.textBody || "").slice(0, 20_000), ...input.threadRecipients]),
    );
    for (const prospect of bounced) {
      await saveProspect(env, userId, prospect, {
        metadata: { ...parseJsonRecord(prospect.metadata), outreachBounced: true },
      });
    }
    return { kind: "bounce", contactIds: bounced.map((prospect) => prospect.id) };
  }
  if (isAutoReply(input.headers, input.subject)) return { kind: "auto_reply", contactIds: [] };

  let prospects = await prospectsByEmail(env, userId, mailAddresses([input.fromAddress]));
  if (prospects.length === 0) {
    prospects = await prospectsByEmail(env, userId, mailAddresses(input.threadRecipients));
  }
  if (prospects.length === 0) return { kind: null, contactIds: [] };

  for (const prospect of prospects) {
    const status = prospect.outreach_status;
    const next: AgentContactOutreachStatus | undefined = input.hasCalendarInvite
      ? status === "booked" || status === "converted" ? undefined : "booked"
      : NOT_YET_ANSWERED.has(status) ? "replied" : undefined;
    if (next) await saveProspect(env, userId, prospect, { status: next, followUpAt: null });
  }
  return {
    kind: input.hasCalendarInvite ? "invite" : "reply",
    contactIds: prospects.map((prospect) => prospect.id),
  };
}

/** A prospect booked on the owner's site: Call booked, nothing left to chase. */
export async function recordOutreachBooking(
  env: OutreachEnv,
  userId: string,
  guestEmail: string | null | undefined,
): Promise<string[]> {
  const prospects = await prospectsByEmail(env, userId, mailAddresses([guestEmail]));
  const changed: string[] = [];
  for (const prospect of prospects) {
    if (prospect.outreach_status === "booked" || prospect.outreach_status === "converted") continue;
    await saveProspect(env, userId, prospect, { status: "booked", followUpAt: null });
    changed.push(prospect.id);
  }
  return changed;
}

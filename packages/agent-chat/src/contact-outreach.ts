import { CONTACT_IS_CLIENT_SQL, isCloseCloseness, touchContactInteraction } from "./contact-people";
import type { AgentContact, AgentContactOutreachStatus } from "./contact-types";
import { createAgentContact, listAgentContacts, normalizeContactOutreachStatus, updateAgentContact } from "./contacts";
import { type CoreAgentChatEnv, isPlainObject, normalizeNullableText, parseJsonRecord } from "./domain-store";
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
  // "Track as outreach" in compose: the people it was sent To become prospects.
  const outreach = normalizeDraftOutreach(parseJsonRecord(message.metadata_json || null).outreach);
  if (outreach) {
    await ensureOutreachProspects(env, userId, {
      emails: mailAddresses([message.to_address]),
      offer: outreach.offer,
    });
  }
  await recordOutreachEmailSent(env, userId, { recipients, sentAt, followUpDays: outreach?.followUpDays });
}

export type DraftOutreach = { followUpDays: number; offer: string | null };

export function normalizeDraftOutreach(value: unknown): DraftOutreach | null {
  if (!isPlainObject(value)) return null;
  return {
    followUpDays: outreachFollowUpDays(value.followUpDays) || OUTREACH_DEFAULT_FOLLOWUP_DAYS,
    offer: normalizeNullableText(value.offer)?.slice(0, 2000) ?? null,
  };
}

const SHARED_INBOXES = new Set([
  "info", "hello", "hi", "office", "admin", "contact", "enquiries", "inquiries", "mail", "team",
  "membership", "members", "support", "secretary", "reception", "general",
]);

/** A starting name for someone known only by address; the owner can rename them. */
export function nameFromEmailAddress(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const source = SHARED_INBOXES.has(local.toLowerCase()) ? domain.split(".")[0] || local : local;
  const words = source.replace(/\+.*$/, "").split(/[._-]+/).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || email;
}

/**
 * Makes each address a prospect: a new contact for a stranger, a plain contact
 * converted. Customers and Close people are never turned into prospects.
 */
export async function ensureOutreachProspects(
  env: OutreachEnv,
  userId: string,
  input: { emails: string[]; offer?: string | null },
): Promise<void> {
  for (const email of input.emails) {
    const existing = await env.DB.prepare(
      `SELECT c.id, c.relationship, c.metadata, ${CONTACT_IS_CLIENT_SQL} AS is_client
       FROM contacts c WHERE c.user_id = ? AND LOWER(TRIM(c.email)) = ? LIMIT 1`,
    )
      .bind(userId, email)
      .first<{ id: string; relationship: string; metadata: string | null; is_client: number | null }>();
    if (!existing) {
      await createAgentContact(env, userId, {
        name: nameFromEmailAddress(email),
        email,
        source: "outreach",
        relationship: "prospect",
        outreachStatus: "new",
        ...(input.offer ? { offer: input.offer } : {}),
      });
      continue;
    }
    const metadata = parseJsonRecord(existing.metadata);
    const offer = input.offer && !metadata.outreachOffer ? { offer: input.offer } : {};
    if (existing.relationship === "prospect") {
      if (offer.offer) await updateAgentContact(env, userId, existing.id, offer);
      continue;
    }
    if (Number(existing.is_client || 0) > 0 || isCloseCloseness(metadata.closeness)) continue;
    await updateAgentContact(env, userId, existing.id, {
      relationship: "prospect",
      outreachStatus: "new",
      ...offer,
    });
  }
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

// --- The assistant's view of outreach ----------------------------------------

export type OutreachProspectInput = {
  contactId?: unknown;
  name?: unknown;
  email?: unknown;
  organisation?: unknown;
  offer?: unknown;
  status?: unknown;
  followUpInDays?: unknown;
};

export type OutreachProspectRecord = {
  id: string;
  name: string;
  email: string | null;
  organisation: string | null;
  offer: string | null;
  status: AgentContactOutreachStatus;
  nextFollowupAt: string | null;
  followUpsSent: number;
  lastInTouchAt: string | null;
};

function prospectRecord(contact: AgentContact): OutreachProspectRecord {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    organisation: contact.organisation,
    offer: contact.offer,
    status: contact.outreachStatus,
    nextFollowupAt: contact.nextFollowupAt,
    followUpsSent: Math.max(0, Number(contact.metadata?.outreachFollowUpsSent) || 0),
    lastInTouchAt: contact.lastInTouchAt,
  };
}

const DONE_STATUSES = new Set<AgentContactOutreachStatus>(["converted", "not_interested", "no_response"]);

export async function listOutreachProspects(
  env: OutreachEnv,
  userId: string,
  options: { filter?: unknown; limit?: unknown } = {},
  now = new Date(),
): Promise<{ prospects: OutreachProspectRecord[]; total: number }> {
  const { contacts } = await listAgentContacts(env, userId);
  const filter = options.filter === "due" || options.filter === "all" ? options.filter : "open";
  const prospects = contacts
    .filter((contact) => contact.relationship === "prospect" && contact.status !== "archived")
    .filter((contact) => {
      if (filter === "all") return true;
      if (DONE_STATUSES.has(contact.outreachStatus)) return false;
      if (filter === "open") return true;
      const due = contact.nextFollowupAt ? Date.parse(contact.nextFollowupAt) : Number.NaN;
      return Number.isFinite(due) && due <= now.getTime();
    })
    .map(prospectRecord);
  const limit = Math.min(50, Math.max(1, Math.round(Number(options.limit)) || 25));
  return { prospects: prospects.slice(0, limit), total: prospects.length };
}

/**
 * Creates or updates prospects for the assistant. A new prospect starts as
 * "new" (not written to yet): only a sent email, or the owner, marks Sent.
 * Customers and Close people are never turned into prospects.
 */
export async function saveOutreachProspects(
  env: OutreachEnv,
  userId: string,
  inputs: OutreachProspectInput[],
  now = new Date(),
): Promise<{
  saved: Array<OutreachProspectRecord & { created: boolean }>;
  skipped: Array<{ name: string; reason: string }>;
}> {
  const saved: Array<OutreachProspectRecord & { created: boolean }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const input of inputs.slice(0, 25)) {
    const contactId = normalizeNullableText(input.contactId);
    const name = normalizeNullableText(input.name);
    const email = mailAddresses([typeof input.email === "string" ? input.email : null])[0] || null;
    const label = name || contactId || email || "";
    const { contacts } = await listAgentContacts(env, userId);
    const existing = contactId
      ? contacts.find((contact) => contact.id === contactId)
      : email
        ? contacts.find((contact) => contact.email?.trim().toLowerCase() === email)
        : undefined;
    if (contactId && !existing) {
      skipped.push({ name: label, reason: "Contact not found." });
      continue;
    }
    const days = outreachFollowUpDays(input.followUpInDays);
    const status = normalizeContactOutreachStatus(input.status);
    const fields = {
      ...(input.organisation !== undefined ? { organisation: input.organisation } : {}),
      ...(input.offer !== undefined ? { offer: input.offer } : {}),
      ...(days ? { nextFollowupAt: new Date(now.getTime() + days * DAY_MS).toISOString() } : {}),
    };
    if (existing) {
      if (existing.relationship !== "prospect" && existing.isClient) {
        skipped.push({ name: existing.name, reason: "Already a customer; not tracked as outreach." });
        continue;
      }
      if (existing.relationship !== "prospect" && existing.isClose) {
        skipped.push({ name: existing.name, reason: "Marked Close; not tracked as outreach." });
        continue;
      }
      const updated = await updateAgentContact(env, userId, existing.id, {
        relationship: "prospect",
        ...fields,
        ...(status ? { outreachStatus: status } : existing.outreachStatus ? {} : { outreachStatus: "new" }),
      });
      if ("error" in updated) skipped.push({ name: existing.name, reason: updated.error });
      else saved.push({ ...prospectRecord(updated), created: false });
      continue;
    }
    if (!name) {
      skipped.push({ name: label, reason: "A name is required." });
      continue;
    }
    const created = await createAgentContact(env, userId, {
      name,
      email,
      source: "agent",
      relationship: "prospect",
      outreachStatus: status || "new",
      ...fields,
    });
    if ("error" in created) skipped.push({ name, reason: created.error });
    else saved.push({ ...prospectRecord(created), created: true });
  }
  return { saved, skipped };
}

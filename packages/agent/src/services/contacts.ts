import type { MailboxEnv } from "./mailbox-types";
import { parseJsonRecord, parseJsonArray, stringRecord } from "./mailbox-common";

export type AgentContactSource =
  | "booking"
  | "manual"
  | "agent"
  | "import"
  | "outreach"
  | "soulink";

export type AgentContactRelationship = "client" | "prospect" | "contact";

export type AgentContactStatus = "active" | "archived" | "dormant";

export type AgentContactCloseness = "very_close" | "close" | "acquaintance" | null;

export type AgentContactOutreachStatus =
  | "new"
  | "drafted"
  | "sent"
  | "replied"
  | "booked"
  | "converted"
  | "not_interested"
  | "no_response"
  | null;

export type AgentContact = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  sourceRef: string | null;
  relationship: AgentContactRelationship;
  closeness: string | null;
  status: AgentContactStatus;
  notes: string | null;
  tags: string[];
  lastInteractionAt: string | null;
  nextFollowupAt: string | null;
  outreachStatus: AgentContactOutreachStatus;
  socialHandles: Record<string, string>;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  bookingCount: number;
  lastBookingAt: string | null;
};

export type AgentContactsSummary = {
  total: number;
  clients: number;
  prospects: number;
  contacts: number;
  active: number;
  dormant: number;
  archived: number;
  needsFollowUp: number;
  outreach: Record<Exclude<AgentContactOutreachStatus, null>, number>;
};

export type DbContactRow = {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  source_ref: string | null;
  relationship: AgentContactRelationship;
  status: AgentContactStatus;
  notes: string | null;
  tags: string | null;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  outreach_status: AgentContactOutreachStatus;
  social_handles: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  booking_count?: number | string | null;
  last_booking_at?: string | null;
};

export function serializeAgentContact(row: DbContactRow): AgentContact {
  const metadata = parseJsonRecord(row.metadata);
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    sourceRef: row.source_ref,
    relationship: row.relationship,
    closeness: typeof metadata.closeness === "string" ? metadata.closeness : null,
    status: row.status,
    notes: row.notes,
    tags: parseJsonArray(row.tags),
    lastInteractionAt: row.last_interaction_at,
    nextFollowupAt: row.next_followup_at,
    outreachStatus: row.outreach_status,
    socialHandles: stringRecord(parseJsonRecord(row.social_handles)),
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    bookingCount: Number(row.booking_count || 0),
    lastBookingAt: row.last_booking_at || null,
  };
}

export function summarizeAgentContacts(contacts: AgentContact[]): AgentContactsSummary {
  const outreach: AgentContactsSummary["outreach"] = {
    new: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
    booked: 0,
    converted: 0,
    not_interested: 0,
    no_response: 0,
  };
  for (const contact of contacts) {
    if (contact.outreachStatus && contact.outreachStatus in outreach) {
      outreach[contact.outreachStatus] += 1;
    }
  }
  return {
    total: contacts.length,
    clients: contacts.filter((contact) => contact.relationship === "client").length,
    prospects: contacts.filter((contact) => contact.relationship === "prospect").length,
    contacts: contacts.filter((contact) => contact.relationship === "contact").length,
    active: contacts.filter((contact) => contact.status === "active").length,
    dormant: contacts.filter((contact) => contact.status === "dormant").length,
    archived: contacts.filter((contact) => contact.status === "archived").length,
    needsFollowUp: contacts.filter(
      (contact) => contact.nextFollowupAt && contact.status === "active",
    ).length,
    outreach,
  };
}

export async function listAgentContacts(
  env: MailboxEnv,
  userId: string,
): Promise<{ contacts: AgentContact[]; summary: AgentContactsSummary }> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.name, c.email, c.phone, c.source, c.source_ref,
            c.relationship, c.status, c.notes, c.tags, c.last_interaction_at,
            c.next_followup_at, c.outreach_status, c.social_handles, c.metadata,
            c.created_at, c.updated_at,
            COUNT(CASE WHEN s.id IS NOT NULL THEN b.id END) AS booking_count,
            MAX(CASE WHEN s.id IS NOT NULL THEN b.starts_at END) AS last_booking_at
     FROM contacts c
     LEFT JOIN bookings b ON b.guest_email = c.email
     LEFT JOIN sites s ON s.id = b.site_id AND s.user_id = c.user_id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY COALESCE(c.last_interaction_at, c.updated_at, c.created_at) DESC`,
  )
    .bind(userId)
    .all<DbContactRow>();

  const contacts = (rows.results || []).map(serializeAgentContact);
  return { contacts, summary: summarizeAgentContacts(contacts) };
}

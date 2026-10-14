import { CONTACT_IS_CLIENT_SQL, CONTACT_REMINDER_SQL, isCloseCloseness, laterInteractionTimestamp, normalizeInteractionTimestamp, refreshContactInteractionsFromBookings, touchContactInteraction } from "./contact-people";
import { type AgentContactSource, type AgentContactRelationship, type AgentContactStatus, type AgentContactOutreachStatus, type AgentContactInput, type AgentContactCloseness, type AgentContact, type AgentContactsSummary, type DbContactRow } from "./contact-types";
import { isPlainObject, normalizeNullableText, stringRecord, type CoreAgentChatEnv, parseJsonArray, parseJsonRecord, type D1RunResultLike } from "./domain-store";

export const CONTACT_SOURCES = new Set<AgentContactSource>([
  "booking",
  "manual",
  "agent",
  "import",
  "outreach",
  "soulink",
]);

export const CONTACT_RELATIONSHIPS = new Set<AgentContactRelationship>([
  "client",
  "prospect",
  "contact",
]);

export const CONTACT_STATUSES = new Set<AgentContactStatus>([
  "active",
  "archived",
  "dormant",
]);

export const OUTREACH_STATUSES = new Set<Exclude<AgentContactOutreachStatus, null>>([
  "new",
  "drafted",
  "sent",
  "replied",
  "booked",
  "converted",
  "not_interested",
  "no_response",
]);

export function parseAgentContactInput(value: unknown): AgentContactInput {
  if (!isPlainObject(value)) return {};
  return {
    name: normalizeNullableText(value.name) || undefined,
    email: normalizeEmail(value.email),
    phone: normalizeNullableText(value.phone),
    source: CONTACT_SOURCES.has(String(value.source) as AgentContactSource)
      ? (value.source as AgentContactSource)
      : "manual",
    sourceRef: normalizeNullableText(value.sourceRef),
    relationship: CONTACT_RELATIONSHIPS.has(
      String(value.relationship) as AgentContactRelationship,
    )
      ? (value.relationship as AgentContactRelationship)
      : "contact",
    closeness: normalizeNullableText(value.closeness) as AgentContactCloseness,
    status: CONTACT_STATUSES.has(String(value.status) as AgentContactStatus)
      ? (value.status as AgentContactStatus)
      : "active",
    notes: normalizeNullableText(value.notes),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    lastInteractionAt: normalizeNullableText(value.lastInteractionAt),
    nextFollowupAt: normalizeNullableText(value.nextFollowupAt),
    outreachStatus: normalizeContactOutreachStatus(value.outreachStatus),
    socialHandles: isPlainObject(value.socialHandles)
      ? stringRecord(value.socialHandles)
      : {},
    metadata: isPlainObject(value.metadata)
      ? { ...(value.metadata as Record<string, unknown>) }
      : null,
  };
}

export async function listAgentContacts(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
): Promise<{ contacts: AgentContact[]; summary: AgentContactsSummary }> {
  await refreshContactInteractionsFromBookings(env, userId);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.name, c.email, c.phone, c.source, c.source_ref,
            c.relationship, c.status, c.notes, c.tags, c.last_interaction_at,
            c.next_followup_at, c.outreach_status, c.social_handles, c.metadata,
            c.created_at, c.updated_at,
            COUNT(b.id) AS booking_count,
            MAX(b.starts_at) AS last_booking_at,
            ${CONTACT_IS_CLIENT_SQL} AS is_client,
            ${CONTACT_REMINDER_SQL} AS reminder_at
     FROM contacts c
     LEFT JOIN bookings b ON b.guest_email = c.email
       AND b.site_id IN (SELECT s.id FROM sites s WHERE s.user_id = c.user_id)
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY COALESCE(c.last_interaction_at, c.updated_at, c.created_at) DESC`,
  )
    .bind(userId)
    .all<DbContactRow>();

  const contacts = (rows.results || []).map(serializeAgentContact);
  return { contacts, summary: summarizeAgentContacts(contacts) };
}

export async function createAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  value: unknown,
): Promise<AgentContact | { error: string; status: 400 | 409 }> {
  const input = parseAgentContactInput(value);
  if (!input.name?.trim()) {
    return { error: "Contact name is required", status: 400 };
  }
  if (input.email && (await contactEmailExists(env, userId, input.email))) {
    return duplicateContactEmailError();
  }

  const id = crypto.randomUUID();
  const metadata = withCloseSince(normalizeContactMetadata(input), {});
  try {
    await env.DB.prepare(
      `INSERT INTO contacts (
         id, user_id, name, email, phone, source, source_ref, relationship, status,
         notes, tags, last_interaction_at, next_followup_at, outreach_status,
         social_handles, metadata
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        userId,
        input.name,
        input.email || null,
        input.phone || null,
        input.source || "manual",
        input.sourceRef || null,
        input.relationship || "contact",
        input.status || "active",
        input.notes || null,
        JSON.stringify(input.tags || []),
        input.lastInteractionAt || null,
        input.nextFollowupAt || null,
        input.outreachStatus || null,
        JSON.stringify(input.socialHandles || {}),
        metadata ? JSON.stringify(metadata) : null,
      )
      .run();
  } catch (error) {
    if (isDuplicateContactEmailError(error)) return duplicateContactEmailError();
    throw error;
  }

  const contact = await getAgentContact(env, userId, id);
  if (!contact) return { error: "Contact not found", status: 400 };
  return contact;
}

export async function upsertAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  value: unknown,
): Promise<
  { contact: AgentContact; created: boolean } | { error: string; status: 400 | 404 | 409 }
> {
  const input = parseAgentContactInput(value);
  if (!input.name?.trim()) {
    return { error: "Contact name is required", status: 400 };
  }

  const source = input.source || "manual";
  const sourceRef = input.sourceRef || null;
  const email = input.email || null;
  const { contacts } = await listAgentContacts(env, userId);
  const existing =
    (sourceRef
      ? contacts.find(
          (contact) =>
            contact.source === source && contact.sourceRef === sourceRef,
        )
      : null) ||
    (sourceRef && source === "soulink"
      ? contacts.find((contact) => contact.metadata?.soulinkNodeId === sourceRef)
      : null) ||
    (email
      ? contacts.find(
          (contact) => contact.email?.trim().toLowerCase() === email,
        )
      : null);

  if (!existing) {
    const created = await createAgentContact(env, userId, input);
    if ("error" in created) return created;
    return { contact: created, created: true };
  }

  const incomingMetadata = normalizeContactMetadata(input) || {};
  const existingMetadata = existing.metadata || {};
  const canRefreshIdentity =
    existing.source === source || existing.source === "soulink";
  const merged = await updateAgentContact(env, userId, existing.id, {
    name: canRefreshIdentity ? input.name || existing.name : existing.name,
    email: existing.email || input.email || null,
    phone: existing.phone,
    source: existing.source,
    sourceRef: canRefreshIdentity
      ? input.sourceRef || existing.sourceRef
      : existing.sourceRef,
    relationship: existing.relationship,
    status: existing.status,
    notes: existing.notes,
    tags: existing.tags,
    lastInteractionAt: laterInteractionTimestamp(
      input.lastInteractionAt,
      existing.lastInteractionAt,
    ),
    nextFollowupAt: existing.nextFollowupAt,
    outreachStatus: existing.outreachStatus,
    socialHandles: {
      ...existing.socialHandles,
      ...(input.socialHandles || {}),
    },
    metadata: {
      ...existingMetadata,
      ...incomingMetadata,
    },
  });

  if ("error" in merged) return merged;
  return { contact: merged, created: false };
}

export async function updateAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
  value: unknown,
): Promise<AgentContact | { error: string; status: 404 | 409 }> {
  const input = parseAgentContactInput(value);
  const existing = await getAgentContactRow(env, userId, contactId);
  if (!existing) return { error: "Contact not found", status: 404 };

  const merged: AgentContactInput = {
    name: input.name ?? existing.name,
    email: input.email ?? existing.email,
    phone: input.phone ?? existing.phone,
    source: input.source ?? existing.source,
    sourceRef: input.sourceRef ?? existing.source_ref,
    relationship: input.relationship ?? existing.relationship,
    status: input.status ?? existing.status,
    notes: input.notes ?? existing.notes,
    tags: input.tags ?? parseJsonArray(existing.tags),
    lastInteractionAt: input.lastInteractionAt ?? existing.last_interaction_at,
    nextFollowupAt: input.nextFollowupAt ?? existing.next_followup_at,
    outreachStatus: input.outreachStatus ?? existing.outreach_status,
    socialHandles: input.socialHandles ?? stringRecord(parseJsonRecord(existing.social_handles)),
    metadata: input.metadata ?? parseJsonRecord(existing.metadata),
    closeness:
      input.closeness ??
      (parseJsonRecord(existing.metadata).closeness as AgentContactCloseness),
  };
  if (isPlainObject(value) && "closeness" in value && !input.closeness) {
    merged.closeness = null;
    merged.metadata = { ...(merged.metadata || {}) };
    delete merged.metadata.closeness;
  }
  const metadata = withCloseSince(
    normalizeContactMetadata(merged),
    parseJsonRecord(existing.metadata),
  );
  if (
    merged.email &&
    (await contactEmailExists(env, userId, merged.email, contactId))
  ) {
    return duplicateContactEmailError();
  }

  try {
    await env.DB.prepare(
      `UPDATE contacts
       SET name = ?, email = ?, phone = ?, source = ?, source_ref = ?,
           relationship = ?, status = ?, notes = ?, tags = ?,
           last_interaction_at = ?, next_followup_at = ?, outreach_status = ?,
           social_handles = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id = ?`,
    )
      .bind(
        merged.name,
        merged.email || null,
        merged.phone || null,
        merged.source || "manual",
        merged.sourceRef || null,
        merged.relationship || "contact",
        merged.status || "active",
        merged.notes || null,
        JSON.stringify(merged.tags || []),
        merged.lastInteractionAt || null,
        merged.nextFollowupAt || null,
        merged.outreachStatus || null,
        JSON.stringify(merged.socialHandles || {}),
        metadata ? JSON.stringify(metadata) : null,
        userId,
        contactId,
      )
      .run();
  } catch (error) {
    if (isDuplicateContactEmailError(error)) return duplicateContactEmailError();
    throw error;
  }

  const contact = await getAgentContact(env, userId, contactId);
  return contact || { error: "Contact not found", status: 404 };
}

export async function markAgentContactInTouch(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<AgentContact | { error: string; status: 404 }> {
  if (!(await getAgentContactRow(env, userId, contactId))) {
    return { error: "Contact not found", status: 404 };
  }
  await touchContactInteraction(env, userId, { contactId });
  const contact = await getAgentContact(env, userId, contactId);
  return contact || { error: "Contact not found", status: 404 };
}

export async function deleteAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<{ ok: true } | { error: string; status: 404 }> {
  const result = (await env.DB.prepare("DELETE FROM contacts WHERE user_id = ? AND id = ?")
    .bind(userId, contactId)
    .run()) as D1RunResultLike;
  if ((result.meta?.changes || 0) === 0) {
    return { error: "Contact not found", status: 404 };
  }
  return { ok: true };
}

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
    isClose: isCloseCloseness(metadata.closeness),
    closeSince:
      isCloseCloseness(metadata.closeness) && typeof metadata.closeSince === "string"
        ? metadata.closeSince
        : null,
    isClient: row.relationship === "client" || Number(row.is_client || 0) > 0,
    lastInTouchAt: normalizeInteractionTimestamp(row.last_interaction_at),
    reminderAt: row.reminder_at || null,
  };
}

export async function getAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<AgentContact | null> {
  const row = await getAgentContactRow(env, userId, contactId);
  return row ? serializeAgentContact(row) : null;
}

export async function getAgentContactRow(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<DbContactRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, name, email, phone, source, source_ref,
            relationship, status, notes, tags, last_interaction_at,
            next_followup_at, outreach_status, social_handles, metadata,
            created_at, updated_at, 0 AS booking_count, NULL AS last_booking_at,
            ${CONTACT_IS_CLIENT_SQL} AS is_client,
            ${CONTACT_REMINDER_SQL} AS reminder_at
     FROM contacts c
     WHERE c.user_id = ? AND c.id = ?`,
  )
    .bind(userId, contactId)
    .first<DbContactRow>();
}

export function summarizeAgentContacts(contacts: AgentContact[]): AgentContactsSummary {
  return {
    total: contacts.length,
    clients: contacts.filter((contact) => contact.relationship === "client").length,
    contacts: contacts.filter((contact) => contact.relationship === "contact").length,
    active: contacts.filter((contact) => contact.status === "active").length,
    archived: contacts.filter((contact) => contact.status === "archived").length,
  };
}

export function normalizeContactMetadata(
  input: AgentContactInput,
): Record<string, unknown> | null {
  const metadata = { ...(input.metadata || {}) };
  if (input.closeness) metadata.closeness = input.closeness;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function withCloseSince(
  metadata: Record<string, unknown> | null,
  previous: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!metadata) return null;
  if (!isCloseCloseness(metadata.closeness)) {
    const { closeSince: _closeSince, ...rest } = metadata;
    return Object.keys(rest).length > 0 ? rest : null;
  }
  const closeSince = isCloseCloseness(previous.closeness)
    ? previous.closeSince || metadata.closeSince
    : null;
  return { ...metadata, closeSince: closeSince || new Date().toISOString() };
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email || null;
}

export async function contactEmailExists(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  email: string,
  exceptContactId?: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM contacts
     WHERE user_id = ? AND LOWER(TRIM(email)) = ? AND id != ?
     LIMIT 1`,
  )
    .bind(userId, email.trim().toLowerCase(), exceptContactId || "")
    .first<{ id: string }>();
  return Boolean(row);
}

export function duplicateContactEmailError() {
  return { error: "This email is already saved as a contact.", status: 409 as const };
}

export function isDuplicateContactEmailError(error: unknown): boolean {
  return error instanceof Error &&
    /UNIQUE constraint failed: contacts\.user_id, contacts\.email|SQLITE_CONSTRAINT_UNIQUE/i.test(
      error.message,
    );
}

export function normalizeContactOutreachStatus(value: unknown): AgentContactOutreachStatus {
  const normalized = typeof value === "string" ? value.trim() : "";
  return OUTREACH_STATUSES.has(normalized as Exclude<AgentContactOutreachStatus, null>)
    ? (normalized as Exclude<AgentContactOutreachStatus, null>)
    : null;
}

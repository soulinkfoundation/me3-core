import { sameSchedulingRequest, schedulingRequestPrecondition, schedulingRequestValues } from "./scheduling-preconditions";
import {
  addDaysToDateString,
  expandRecurringCalendarEvents,
  getUtcMsForLocalTime,
  resolveTimeZone,
} from "./calendar";
import {
  createConfirmedOneToOneBooking,
  findConfirmedBookingOverlap,
  formatUtcInstantInTimeZone,
  listOneToOneBookingOffers,
  loadSiteProfileForCommerce,
  minutesToTime,
  resolveBookingSlot,
  resolvePublicBookingSlot,
  resolvePublicOneToOneBookingOffer,
  serializeBooking,
  timeToMinutes,
  validateBookingAvailability,
  weekdayForDate,
  type CoreBookIntent,
} from "./booking";
import type {
  DbAgentChannelConnection,
  DbAgentChannelEvent,
  DbBooking,
  DbCalendarSourceEvent,
  DbContact,
  DbSchedulingRequest,
  DbSchedulingRequestAudit,
  DbSchedulingRequestVote,
  DbSchedulingTimeType,
  DbSite,
  DbUserCalendarEvent,
  Env,
  OwnerProfile,
} from "./types";

const DEFAULT_SOULINK_API_ORIGIN = "https://soulinkfoundation.org";

export type SchedulingPrivilegeTier = "public" | "contact" | "close_contact" | "client";
export type SchedulingPaymentMode = "free" | "paid_checkout" | "owner_review";
export type SchedulingOwnerPreReview = "always" | "unless_close_contact";
export type SchedulingFinalApproval = "both_owners";
export type SchedulingRequestStatus = DbSchedulingRequest["status"];
export type SchedulingParticipantRole = "requester" | "target";
export type SchedulingVotePreference = DbSchedulingRequestVote["preference"];
export type SchedulingTimeType = {
  id: string;
  title: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes: number;
  timezone: string;
  windows: Record<string, string[]>;
  allowedTiers: SchedulingPrivilegeTier[];
  paymentMode: SchedulingPaymentMode;
  publicBookingOfferId?: string;
  ownerPreReview: SchedulingOwnerPreReview;
  allowCloseContactCandidateSharing: boolean;
  finalApproval: SchedulingFinalApproval;
  source: "owner" | "public_booking_offer";
  status: "active" | "archived";
  createdAt?: string;
  updatedAt?: string;
};
export type SchedulingRequestSlot = Pick<
  SchedulingCandidateSlot,
  "startsAt" | "endsAt" | "timezone" | "localDate" | "localStartTime" | "localEndDate" | "localEndTime"
>;
export type SchedulingRequestStreamPayload = {
  kind: "scheduling_poll";
  requestId: string;
  title: string;
  summary: string;
  poll: {
    question: string;
    maxSelections: number;
    options: Array<{ id: string; label: string; startsAt: string; endsAt: string }>;
  };
  actionCard: {
    title: string;
    description: string;
    actions: Array<{ id: string; label: string; type: "vote" | "approve" | "checkout" }>;
  };
  requiresApproval: "both_owners";
};

type OwnerRecord = OwnerProfile & { password_hash: string | null };

type ProviderChannelEventInput = {
  channel: "sandbox" | "soulink";
  connectionId: string;
  direction: "inbound" | "outbound" | "system";
  eventType: "start" | "message" | "link" | "send" | "error";
  status: "received" | "pending" | "sent" | "failed" | "linked" | "skipped";
  providerEventId: string | null;
  providerMessageId: string | null;
  replyToMessageId: string | number | null;
  textBody: string | null;
  rawJson: unknown;
  errorMessage: string | null;
};

export function normalizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeLongText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function getOwnerProfile(env: Env, ownerId: string): Promise<OwnerRecord | null> {
  const result = await env.DB.prepare(
    "SELECT id, email, name, username, bio, avatar_url, timezone, locale, password_hash FROM owner_profile WHERE id = ?",
  )
    .bind(ownerId)
    .first<OwnerRecord>();

  return result ?? null;
}

async function getSiteForOwner(env: Env, ownerId: string, rawUsername: string): Promise<DbSite | null> {
  const username = normalizeUsername(rawUsername);
  if (!username) return null;
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE user_id = ? AND username = ?`,
    )
      .bind(ownerId, username)
      .first<DbSite>()) || null
  );
}

function serializeCalendarEvent(event: DbUserCalendarEvent) {
  const kind = event.kind === "birthday" ? "birthday" : "event";
  return {
    id: event.id,
    title: event.title,
    notes: event.notes,
    location: event.location,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    allDay: event.all_day === 1,
    kind,
    recurrenceRule: event.recurrence_rule,
    sourceId: null,
    sourceName: kind === "birthday" ? "Birthdays" : "Personal events",
    sourceKind: "native",
    createdAt: event.created_at,
  };
}

async function getSoulinkConnection(env: Env, ownerId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_user_id, provider_thread_id,
            provider_username, provider_metadata_json,
            telegram_user_id, telegram_chat_id, telegram_username,
            telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at,
            updated_at
     FROM agent_channel_connections
     WHERE user_id = ? AND channel = 'soulink'`,
  )
    .bind(ownerId)
    .first<DbAgentChannelConnection>();
}

async function getAgentChannelEventByProviderEventId(
  env: Env,
  connectionId: string,
  providerEventId: string,
) {
  return env.DB.prepare(
    `SELECT id, connection_id, channel, direction, event_type, status,
            provider_event_id, provider_message_id,
            telegram_message_id, reply_to_message_id, telegram_user_id,
            telegram_chat_id, telegram_username, text_body, raw_json,
            error_message, created_at, updated_at
     FROM agent_channel_events
     WHERE connection_id = ? AND provider_event_id = ?`,
  )
    .bind(connectionId, providerEventId)
    .first<DbAgentChannelEvent>();
}

async function insertProviderChannelEventOnce(env: Env, input: ProviderChannelEventInput) {
  if (input.providerEventId) {
    const existing = await getAgentChannelEventByProviderEventId(
      env,
      input.connectionId,
      input.providerEventId,
    );
    if (existing) return existing.id;
  }

  return insertProviderChannelEvent(env, input);
}

async function insertProviderChannelEvent(
  env: Env,
  input: ProviderChannelEventInput,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_channel_events
       (id, connection_id, channel, direction, event_type, status,
        provider_event_id, provider_message_id, reply_to_message_id,
        text_body, raw_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      id,
      input.connectionId,
      input.channel,
      input.direction,
      input.eventType,
      input.status,
      input.providerEventId,
      input.providerMessageId,
      input.replyToMessageId === null ? null : String(input.replyToMessageId),
      input.textBody,
      JSON.stringify(input.rawJson),
      input.errorMessage,
    )
    .run();
  return id;
}

export async function listSchedulingTimeTypes(
  env: Env,
  ownerId: string,
): Promise<SchedulingTimeType[]> {
  await ensureDefaultSchedulingTimeType(env, ownerId);

  const rows = await env.DB.prepare(
    `SELECT id, user_id, title, description, duration_minutes, buffer_minutes,
            timezone, windows_json, allowed_tiers_json, payment_mode,
            public_booking_offer_id, owner_pre_review,
            allow_close_contact_candidate_sharing, final_approval, status,
            created_at, updated_at
     FROM scheduling_time_types
     WHERE user_id = ? AND status = 'active'
     ORDER BY created_at ASC`,
  )
    .bind(ownerId)
    .all<DbSchedulingTimeType>();

  const ownerTypes = (rows.results || []).map(serializeSchedulingTimeType);
  const publicTypes = await listPublicBookingSchedulingTimeTypes(env, ownerId);
  return [...ownerTypes, ...publicTypes];
}

async function ensureDefaultSchedulingTimeType(env: Env, ownerId: string) {
  const existing = await env.DB.prepare(
    `SELECT id
     FROM scheduling_time_types
     WHERE user_id = ?
     LIMIT 1`,
  )
    .bind(ownerId)
    .first<{ id: string }>();
  if (existing) return;

  const owner = await getOwnerProfile(env, ownerId);
  const timezone = resolveTimeZone(owner?.timezone);
  await env.DB.prepare(
    `INSERT INTO scheduling_time_types
     (id, user_id, title, description, duration_minutes, buffer_minutes,
      timezone, windows_json, allowed_tiers_json, payment_mode,
      public_booking_offer_id, owner_pre_review,
      allow_close_contact_candidate_sharing, final_approval, status,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'free', NULL, 'unless_close_contact',
             1, 'both_owners', 'active', datetime('now'), datetime('now'))`,
  )
    .bind(
      crypto.randomUUID(),
      ownerId,
      "Catch-up",
      "Informal 1:1 time for contacts.",
      30,
      10,
      timezone,
      JSON.stringify({
        monday: ["09:00-17:00"],
        tuesday: ["09:00-17:00"],
        wednesday: ["09:00-17:00"],
        thursday: ["09:00-17:00"],
        friday: ["09:00-17:00"],
      }),
      JSON.stringify(["contact", "close_contact", "client"]),
    )
    .run();
}

async function listPublicBookingSchedulingTimeTypes(
  env: Env,
  ownerId: string,
): Promise<SchedulingTimeType[]> {
  const sites = await env.DB.prepare(
    `SELECT id, user_id, username, site_type, site_role, template_id, custom_domain,
            custom_domain_status, custom_domain_cf_id, created_at, updated_at,
            published_at
     FROM sites
     WHERE user_id = ? AND published_at IS NOT NULL
     ORDER BY created_at ASC`,
  )
    .bind(ownerId)
    .all<DbSite>();

  const timeTypes: SchedulingTimeType[] = [];
  for (const site of sites.results || []) {
    const profile = await loadSiteProfileForCommerce(env, site);
    const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
    if (!bookIntent?.enabled) continue;

    const offers = listOneToOneBookingOffers(bookIntent);
    for (const offer of offers) {
      timeTypes.push({
        id: `public:${site.username}:${offer.id}`,
        title: offer.title,
        description: offer.description,
        durationMinutes: offer.duration,
        bufferMinutes: normalizeBufferMinutes(bookIntent.bufferTime),
        timezone: resolveTimeZone(offer.availability.timezone),
        windows: sanitizeAvailabilityWindows(offer.availability.windows || {}),
        allowedTiers: ["public", "contact", "close_contact", "client"],
        paymentMode: offer.pricing?.enabled ? "paid_checkout" : "free",
        publicBookingOfferId: offer.id,
        ownerPreReview: "unless_close_contact",
        allowCloseContactCandidateSharing: true,
        finalApproval: "both_owners",
        source: "public_booking_offer",
        status: "active",
      });
    }
  }

  return timeTypes;
}

export async function createSchedulingTimeType(
  env: Env,
  ownerId: string,
  value: unknown,
): Promise<SchedulingTimeType | { error: string; status: 400 }> {
  const parsed = parseSchedulingTimeTypeInput(value, null);
  if ("error" in parsed) return { error: parsed.error, status: 400 };

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO scheduling_time_types
     (id, user_id, title, description, duration_minutes, buffer_minutes,
      timezone, windows_json, allowed_tiers_json, payment_mode,
      public_booking_offer_id, owner_pre_review,
      allow_close_contact_candidate_sharing, final_approval, status,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'both_owners', 'active',
             datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      ownerId,
      parsed.title,
      parsed.description || null,
      parsed.durationMinutes,
      parsed.bufferMinutes,
      parsed.timezone,
      JSON.stringify(parsed.windows),
      JSON.stringify(parsed.allowedTiers),
      parsed.paymentMode,
      parsed.ownerPreReview,
      parsed.allowCloseContactCandidateSharing ? 1 : 0,
    )
    .run();

  const row = await getOwnerSchedulingTimeType(env, ownerId, id);
  return row ? serializeSchedulingTimeType(row) : {
    id,
    ...parsed,
    finalApproval: "both_owners",
    source: "owner",
    status: "active",
  };
}

export async function updateSchedulingTimeType(
  env: Env,
  ownerId: string,
  id: string,
  value: unknown,
): Promise<SchedulingTimeType | { error: string; status: 400 | 404 }> {
  const existing = await getOwnerSchedulingTimeType(env, ownerId, id);
  if (!existing) return { error: "Scheduling time type not found", status: 404 };

  const parsed = parseSchedulingTimeTypeInput(value, serializeSchedulingTimeType(existing));
  if ("error" in parsed) return { error: parsed.error, status: 400 };

  await env.DB.prepare(
    `UPDATE scheduling_time_types
     SET title = ?, description = ?, duration_minutes = ?, buffer_minutes = ?,
         timezone = ?, windows_json = ?, allowed_tiers_json = ?,
         payment_mode = ?, owner_pre_review = ?,
         allow_close_contact_candidate_sharing = ?, status = ?,
         updated_at = datetime('now')
     WHERE user_id = ? AND id = ?`,
  )
    .bind(
      parsed.title,
      parsed.description || null,
      parsed.durationMinutes,
      parsed.bufferMinutes,
      parsed.timezone,
      JSON.stringify(parsed.windows),
      JSON.stringify(parsed.allowedTiers),
      parsed.paymentMode,
      parsed.ownerPreReview,
      parsed.allowCloseContactCandidateSharing ? 1 : 0,
      parsed.status,
      ownerId,
      id,
    )
    .run();

  const row = await getOwnerSchedulingTimeType(env, ownerId, id);
  return row ? serializeSchedulingTimeType(row) : { error: "Scheduling time type not found", status: 404 };
}

export async function resolveSchedulingPolicy(
  env: Env,
  ownerId: string,
  input: { contactId: string; timeTypeId: string },
): Promise<
  | {
      tier: SchedulingPrivilegeTier;
      allowed: boolean;
      reason: string;
      ownerReviewRequired: boolean;
      candidateSharingAllowed: boolean;
      timeType: SchedulingTimeType;
      contactId: string | null;
    }
  | { error: string; status: 400 | 404 }
> {
  if (!input.timeTypeId) return { error: "timeTypeId is required", status: 400 };

  const timeType = (await listSchedulingTimeTypes(env, ownerId)).find(
    (type) => type.id === input.timeTypeId,
  );
  if (!timeType) return { error: "Scheduling time type not found", status: 404 };

  const contact = input.contactId
    ? await getSchedulingContact(env, ownerId, input.contactId)
    : null;
  if (input.contactId && !contact) return { error: "Contact not found", status: 404 };

  const tier = resolveSchedulingPrivilegeTier(contact);
  const allowed = timeType.allowedTiers.includes(tier);
  if (!allowed) {
    return {
      tier,
      allowed: false,
      reason: `The ${tier} tier is not allowed for this time type`,
      ownerReviewRequired: false,
      candidateSharingAllowed: false,
      timeType,
      contactId: contact?.id || null,
    };
  }

  const ownerReviewRequired =
    timeType.ownerPreReview === "always" ||
    (timeType.ownerPreReview === "unless_close_contact" && tier !== "close_contact");
  const candidateSharingAllowed =
    tier === "close_contact" &&
    timeType.allowCloseContactCandidateSharing &&
    !ownerReviewRequired;

  return {
    tier,
    allowed: true,
    reason: candidateSharingAllowed
      ? "Close contact candidate sharing is allowed without pre-review"
      : ownerReviewRequired
      ? "Owner review is required before sharing candidate slots"
      : "Scheduling policy allows this request",
    ownerReviewRequired,
    candidateSharingAllowed,
    timeType,
    contactId: contact?.id || null,
  };
}

type SchedulingDateRange = { start: string; end: string };
type SchedulingBlocker = { startsAt: string; endsAt: string; allDay: boolean };
type SchedulingCandidateSlot = {
  startsAt: string;
  endsAt: string;
  timezone: string;
  localDate: string;
  localStartTime: string;
  localEndDate: string;
  localEndTime: string;
};

export function parseSchedulingDateRange(value: unknown):
  | SchedulingDateRange
  | { error: string } {
  const record = isPlainObject(value) ? value : {};
  const start = normalizeShortText(record.start, 20);
  const end = normalizeShortText(record.end, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: "dateRange.start and dateRange.end must be YYYY-MM-DD dates" };
  }

  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return { error: "dateRange.end must be on or after dateRange.start" };
  }
  const days = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  if (days > 62) return { error: "dateRange cannot exceed 62 days" };
  return { start, end };
}

export function normalizeCandidateLimit(value: unknown): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
      ? Number(value)
      : 10;
  if (!Number.isFinite(numeric)) return 10;
  return Math.max(1, Math.min(50, Math.round(numeric)));
}

export async function generateSchedulingCandidateSlots(
  env: Env,
  ownerId: string,
  input: {
    timeType: SchedulingTimeType;
    dateRange: SchedulingDateRange;
    limit: number;
  },
): Promise<SchedulingCandidateSlot[]> {
  const timezone = resolveTimeZone(input.timeType.timezone);
  const blockers = await loadSchedulingBlockers(env, ownerId, input.dateRange, timezone);
  const slots: SchedulingCandidateSlot[] = [];
  let localDate = input.dateRange.start;

  while (localDate <= input.dateRange.end && slots.length < input.limit) {
    const weekday = weekdayForDate(localDate);
    const dayWindows = weekday ? input.timeType.windows[weekday] || [] : [];

    for (const window of dayWindows) {
      const [windowStart, windowEnd] = String(window).split("-").map((part) => part.trim());
      const windowStartMinutes = timeToMinutes(windowStart);
      const windowEndMinutes = timeToMinutes(windowEnd);
      if (windowStartMinutes === null || windowEndMinutes === null) continue;

      for (
        let startMinutes = windowStartMinutes;
        startMinutes + input.timeType.durationMinutes <= windowEndMinutes;
        startMinutes += 15
      ) {
        const localStartTime = minutesToTime(startMinutes);
        const slot = resolveBookingSlot({
          localDate,
          localTime: localStartTime,
          durationMinutes: input.timeType.durationMinutes,
          timezone,
        });
        if (!slot || slot.startsAtMs <= Date.now() + 5 * 60_000) continue;
        if (
          schedulingSlotOverlapsBlockers(slot, blockers, input.timeType.bufferMinutes)
        ) {
          continue;
        }

        const localEnd = formatUtcInstantInTimeZone(
          Date.parse(slot.endsAt),
          timezone,
        );
        slots.push({
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timezone,
          localDate,
          localStartTime,
          localEndDate: localEnd?.localDate || localDate,
          localEndTime: localEnd?.localTime || minutesToTime(
            startMinutes + input.timeType.durationMinutes,
          ),
        });
        if (slots.length >= input.limit) break;
      }
      if (slots.length >= input.limit) break;
    }

    localDate = addDaysToDateString(localDate, 1);
  }

  return slots;
}

async function loadSchedulingBlockers(
  env: Env,
  ownerId: string,
  dateRange: SchedulingDateRange,
  timezone: string,
): Promise<SchedulingBlocker[]> {
  const window = resolveSchedulingUtcWindow(dateRange, timezone);
  const [bookings, events, recurringEvents, importedEvents] = await Promise.all([
    env.DB.prepare(
      `SELECT b.id, b.site_id, b.offer_id, b.booking_type, b.guest_name, b.guest_email,
              b.starts_at, b.ends_at, b.duration_minutes, b.calendar_event_id,
              b.status, b.notes, b.created_at, b.cancelled_at, b.payment_intent_id,
              b.amount_paid, b.suggested_amount, b.currency, b.payment_status,
              b.is_free_booking, b.paid_at
       FROM bookings b
       JOIN sites s ON s.id = b.site_id
       WHERE s.user_id = ? AND b.status = 'confirmed'
         AND b.ends_at > ? AND b.starts_at < ?`,
    )
      .bind(ownerId, window.startsAt, window.endsAt)
      .all<DbBooking>(),
    env.DB.prepare(
      `SELECT id, user_id, title, notes, location, starts_at, ends_at, timezone,
              all_day, kind, recurrence_rule, created_at
       FROM user_calendar_events
       WHERE user_id = ? AND recurrence_rule IS NULL
         AND ends_at > ? AND starts_at < ?`,
    )
      .bind(ownerId, window.startsAt, window.endsAt)
      .all<DbUserCalendarEvent>(),
    env.DB.prepare(
      `SELECT id, user_id, title, notes, location, starts_at, ends_at, timezone,
              all_day, kind, recurrence_rule, created_at
       FROM user_calendar_events
       WHERE user_id = ? AND recurrence_rule IS NOT NULL`,
    )
      .bind(ownerId)
      .all<DbUserCalendarEvent>(),
    env.DB.prepare(
      `SELECT cse.id, cse.source_id, cse.external_key, cse.external_uid, cse.title,
              cse.notes, cse.location, cse.starts_at, cse.ends_at, cse.timezone,
              cse.all_day, cse.is_busy, cse.created_at
       FROM calendar_source_events cse
       JOIN calendar_sources cs ON cs.id = cse.source_id
       WHERE cs.user_id = ? AND cs.status = 'active'
         AND cse.is_busy = 1
         AND cse.ends_at > ? AND cse.starts_at < ?`,
    )
      .bind(ownerId, window.startsAt, window.endsAt)
      .all<DbCalendarSourceEvent>(),
  ]);

  const expandedRecurringEvents = expandRecurringCalendarEvents(
    recurringEvents.results || [],
    window.startsAt,
    window.endsAt,
  );

  return [
    ...(bookings.results || []).map((booking) => ({
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      allDay: false,
    })),
    ...(events.results || []).map(calendarEventToSchedulingBlocker),
    ...expandedRecurringEvents.map(calendarEventToSchedulingBlocker),
    ...(importedEvents.results || []).map((event) => ({
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      allDay: event.all_day === 1,
    })),
  ];
}

function resolveSchedulingUtcWindow(
  dateRange: SchedulingDateRange,
  timezone: string,
): { startsAt: string; endsAt: string } {
  const [startYear, startMonth, startDay] = dateRange.start.split("-").map(Number);
  const endExclusive = addDaysToDateString(dateRange.end, 1);
  const [endYear, endMonth, endDay] = endExclusive.split("-").map(Number);
  return {
    startsAt: new Date(
      getUtcMsForLocalTime(
        { year: startYear, month: startMonth, day: startDay, hour: 0, minute: 0 },
        timezone,
      ),
    ).toISOString(),
    endsAt: new Date(
      getUtcMsForLocalTime(
        { year: endYear, month: endMonth, day: endDay, hour: 0, minute: 0 },
        timezone,
      ),
    ).toISOString(),
  };
}

function calendarEventToSchedulingBlocker(
  event: DbUserCalendarEvent,
): SchedulingBlocker {
  return {
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    allDay: event.all_day === 1,
  };
}

function schedulingSlotOverlapsBlockers(
  slot: { startsAt: string; endsAt: string },
  blockers: SchedulingBlocker[],
  bufferMinutes: number,
): boolean {
  const bufferMs = bufferMinutes * 60_000;
  const slotStartMs = Date.parse(slot.startsAt) - bufferMs;
  const slotEndMs = Date.parse(slot.endsAt) + bufferMs;

  for (const blocker of blockers) {
    const blockerStartMs = Date.parse(blocker.startsAt);
    const blockerEndMs = Date.parse(blocker.endsAt);
    if (!Number.isFinite(blockerStartMs) || !Number.isFinite(blockerEndMs)) continue;
    if (blockerStartMs < slotEndMs && blockerEndMs > slotStartMs) return true;
  }

  return false;
}

export function sanitizeSchedulingTimeTypeForCandidates(timeType: SchedulingTimeType) {
  return {
    id: timeType.id,
    title: timeType.title,
    durationMinutes: timeType.durationMinutes,
    bufferMinutes: timeType.bufferMinutes,
    timezone: timeType.timezone,
    paymentMode: timeType.paymentMode,
    source: timeType.source,
    publicBookingOfferId: timeType.publicBookingOfferId,
  };
}

export async function createSchedulingRequest(
  env: Env,
  ownerId: string,
  requestUrl: string,
  value: unknown,
): Promise<
  | {
      request: ReturnType<typeof serializeSchedulingRequest>;
      votes: ReturnType<typeof serializeSchedulingVote>[];
      audit: ReturnType<typeof serializeSchedulingAudit>[];
      streamPayload: SchedulingRequestStreamPayload | null;
      soulinkDelivery: { attempted: boolean; status: "sent" | "pending" | "failed" | "skipped" };
    }
  | { error: string; status: 400 | 404 }
> {
  const body = isPlainObject(value) ? value : {};
  const contactId = normalizeShortText(body.contactId, 120);
  const timeTypeId = normalizeShortText(body.timeTypeId, 160);
  const requesterName = normalizeShortText(body.requesterName, 120);
  const targetName = normalizeShortText(body.targetName, 120);
  const reason = normalizeLongText(body.reason, 500);
  const dateRange = parseSchedulingDateRange(body.dateRange);
  if ("error" in dateRange) return { error: dateRange.error, status: 400 };

  const policy = await resolveSchedulingPolicy(env, ownerId, { contactId, timeTypeId });
  if ("error" in policy) return policy;

  const limit = normalizeSchedulingRequestCandidateLimit(body.limit);
  const slots = policy.allowed && !policy.ownerReviewRequired
    ? await generateSchedulingCandidateSlots(env, ownerId, {
        timeType: policy.timeType,
        dateRange,
        limit,
      })
    : [];
  const requestId = crypto.randomUUID();
  const status: SchedulingRequestStatus = !policy.allowed
    ? "not_allowed"
    : policy.ownerReviewRequired
    ? "review_required"
    : "candidates_shared";
  const streamPayload = slots.length > 0
    ? buildSchedulingRequestStreamPayload({
        requestId,
        timeType: policy.timeType,
        slots,
        requesterName,
        targetName,
        reason,
      })
    : null;

  await env.DB.prepare(
    `INSERT INTO scheduling_requests
       (id, user_id, contact_id, time_type_id, status, requester_name, target_name,
        reason, date_range_start, date_range_end, candidate_slots_json,
        selected_slot_json, policy_json, stream_payload_json, checkout_url,
        requester_approved_at, target_approved_at, finalized_calendar_event_id,
        finalized_booking_id, finalized_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL,
             NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      requestId,
      ownerId,
      policy.contactId,
      policy.timeType.id,
      status,
      requesterName || null,
      targetName || null,
      reason || null,
      dateRange.start,
      dateRange.end,
      JSON.stringify(slots),
      JSON.stringify({
        tier: policy.tier,
        allowed: policy.allowed,
        reason: policy.reason,
        ownerReviewRequired: policy.ownerReviewRequired,
        candidateSharingAllowed: policy.candidateSharingAllowed,
        timeType: sanitizeSchedulingTimeTypeForCandidates(policy.timeType),
      }),
      streamPayload ? JSON.stringify(streamPayload) : null,
    )
    .run();

  await insertSchedulingRequestAudit(env, {
    requestId,
    userId: ownerId,
    eventType: "request_created",
    actorRole: "assistant",
    summary: policy.allowed
      ? `Created scheduling request for ${policy.timeType.title}`
      : policy.reason,
    metadata: { dateRange, contactId: policy.contactId, status },
  });

  let soulinkDelivery: { attempted: boolean; status: "sent" | "pending" | "failed" | "skipped" } = {
    attempted: false,
    status: "skipped",
  };
  if (streamPayload) {
    await insertSchedulingRequestAudit(env, {
      requestId,
      userId: ownerId,
      eventType: "candidates_shared",
      actorRole: "assistant",
      summary: `Shared ${slots.length} candidate slots`,
      metadata: {
        slots: slots.map((slot) => ({
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timezone: slot.timezone,
        })),
        streamPayloadKind: streamPayload.kind,
      },
    });
    soulinkDelivery = await deliverSchedulingRequestToSoulink(
      env,
      ownerId,
      requestUrl,
      streamPayload,
    );
  }

  const request = await getSchedulingRequest(env, ownerId, requestId);
  const audit = await listSchedulingRequestAudit(env, requestId);
  return {
    request: serializeSchedulingRequest(request!),
    votes: [],
    audit: audit.map(serializeSchedulingAudit),
    streamPayload,
    soulinkDelivery,
  };
}

export async function recordSchedulingRequestVote(
  env: Env,
  ownerId: string,
  requestId: string,
  value: unknown,
): Promise<
  | {
      request: ReturnType<typeof serializeSchedulingRequest>;
      vote: ReturnType<typeof serializeSchedulingVote>;
      votes: ReturnType<typeof serializeSchedulingVote>[];
    }
  | { error: string; status: 400 | 404 }
> {
  const request = await getSchedulingRequest(env, ownerId, requestId);
  if (!request) return { error: "Scheduling request not found", status: 404 };
  if (request.status === "finalized" || request.status === "cancelled") {
    return { error: "Scheduling request is closed", status: 400 };
  }

  const body = isPlainObject(value) ? value : {};
  const role = normalizeSchedulingParticipantRole(body.participantRole);
  if (!role) return { error: "participantRole must be requester or target", status: 400 };
  const preference = normalizeSchedulingVotePreference(body.preference);
  const slot = selectSchedulingRequestSlot(request, body.slotId, body.startsAt, body.endsAt);
  if (!slot) return { error: "Vote must reference one of the shared candidate slots", status: 400 };
  const voterLabel = normalizeShortText(body.voterLabel, 120);
  const voteId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO scheduling_request_votes
       (id, request_id, participant_role, voter_label, slot_starts_at, slot_ends_at,
        preference, raw_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(request_id, participant_role, slot_starts_at, slot_ends_at)
     DO UPDATE SET voter_label = excluded.voter_label,
                   preference = excluded.preference,
                   raw_json = excluded.raw_json,
                   updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      voteId,
      request.id,
      role,
      voterLabel || null,
      slot.startsAt,
      slot.endsAt,
      preference,
      JSON.stringify(body),
    )
    .run();

  await env.DB.prepare(
    `UPDATE scheduling_requests
     SET status = CASE
           WHEN status = 'candidates_shared' THEN 'voting'
           ELSE status
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  )
    .bind(request.id, ownerId)
    .run();

  await insertSchedulingRequestAudit(env, {
    requestId: request.id,
    userId: ownerId,
    eventType: "vote_recorded",
    actorRole: role,
    summary: `${role} voted ${preference} on ${slot.startsAt}`,
    metadata: { slot, preference, voterLabel: voterLabel || null },
  });

  const updated = (await getSchedulingRequest(env, ownerId, request.id))!;
  const votes = await listSchedulingRequestVotes(env, request.id);
  const vote = votes.find(
    (entry) =>
      entry.participant_role === role &&
      entry.slot_starts_at === slot.startsAt &&
      entry.slot_ends_at === slot.endsAt,
  ) || votes[0];
  return {
    request: serializeSchedulingRequest(updated),
    vote: serializeSchedulingVote(vote),
    votes: votes.map(serializeSchedulingVote),
  };
}

export async function approveSchedulingRequest(
  env: Env,
  ownerId: string,
  requestId: string,
  value: unknown,
  expected?: DbSchedulingRequest,
): Promise<
  | { request: ReturnType<typeof serializeSchedulingRequest> }
  | { error: string; status: 400 | 404 | 409 }
> {
  const request = await getSchedulingRequest(env, ownerId, requestId);
  if (!request) return { error: "Scheduling request not found", status: 404 };
  if (expected && !sameSchedulingRequest(request, expected)) return { error: "Scheduling request changed since it was read", status: 409 };
  if (request.status === "finalized" || request.status === "cancelled") {
    return { error: "Scheduling request is closed", status: 400 };
  }

  const body = isPlainObject(value) ? value : {};
  const role = normalizeSchedulingParticipantRole(body.participantRole);
  if (!role) return { error: "participantRole must be requester or target", status: 400 };
  const slot = selectSchedulingRequestSlot(
    request,
    body.slotId,
    body.startsAt,
    body.endsAt,
  ) || firstPositiveSchedulingVoteSlot(await listSchedulingRequestVotes(env, request.id));
  if (!slot) return { error: "Select a shared candidate slot before approving", status: 400 };

  const changed = await env.DB.prepare(
    `UPDATE scheduling_requests
     SET selected_slot_json = COALESCE(selected_slot_json, ?),
         requester_approved_at = CASE
           WHEN ? = 'requester' THEN CURRENT_TIMESTAMP
           ELSE requester_approved_at
         END,
         target_approved_at = CASE
           WHEN ? = 'target' THEN CURRENT_TIMESTAMP
           ELSE target_approved_at
         END,
         status = CASE
           WHEN (? = 'requester' AND target_approved_at IS NOT NULL)
             OR (? = 'target' AND requester_approved_at IS NOT NULL)
           THEN 'approved'
           ELSE 'pending_approval'
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? ${expected ? schedulingRequestPrecondition : ""}`,
  )
    .bind(JSON.stringify(slot), role, role, role, role, request.id, ownerId, ...(expected ? schedulingRequestValues(expected) : []))
    .run();
  if (expected && changed.meta.changes !== 1) return { error: "Scheduling request changed before approval", status: 409 };

  await insertSchedulingRequestAudit(env, {
    requestId: request.id,
    userId: ownerId,
    eventType: "approval_recorded",
    actorRole: role,
    summary: `${role} approved ${slot.startsAt}`,
    metadata: { slot },
  });

  const updated = (await getSchedulingRequest(env, ownerId, request.id))!;
  return { request: serializeSchedulingRequest(updated) };
}

export async function finalizeSchedulingRequest(
  env: Env,
  ownerId: string,
  requestId: string,
): Promise<
  | {
      request: ReturnType<typeof serializeSchedulingRequest>;
      calendarEvent?: ReturnType<typeof serializeCalendarEvent>;
      booking?: ReturnType<typeof serializeBooking>;
      checkoutUrl?: string;
    }
  | { error: string; status: 400 | 404 | 409 }
> {
  const request = await getSchedulingRequest(env, ownerId, requestId);
  if (!request) return { error: "Scheduling request not found", status: 404 };
  if (request.status === "finalized") {
    return { request: serializeSchedulingRequest(request) };
  }
  if (!request.requester_approved_at || !request.target_approved_at) {
    await insertSchedulingRequestAudit(env, {
      requestId: request.id,
      userId: ownerId,
      eventType: "finalization_blocked",
      actorRole: "system",
      summary: "Both owners must approve before finalization",
      metadata: {
        requesterApproved: Boolean(request.requester_approved_at),
        targetApproved: Boolean(request.target_approved_at),
      },
    });
    return { error: "Both owners must approve before finalization", status: 409 };
  }

  const slot = parseSchedulingRequestSlot(request.selected_slot_json);
  if (!slot) return { error: "Scheduling request has no selected slot", status: 400 };
  const timeType = (await listSchedulingTimeTypes(env, ownerId)).find(
    (entry) => entry.id === request.time_type_id,
  );
  if (!timeType) return { error: "Scheduling time type not found", status: 404 };

  if (timeType.paymentMode === "paid_checkout") {
    const checkoutUrl = buildSchedulingCheckoutUrl(env, timeType, slot);
    await env.DB.prepare(
      `UPDATE scheduling_requests
       SET status = 'checkout_required',
           checkout_url = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
      .bind(checkoutUrl, request.id, ownerId)
      .run();
    await insertSchedulingRequestAudit(env, {
      requestId: request.id,
      userId: ownerId,
      eventType: "checkout_handoff",
      actorRole: "assistant",
      summary: "Shared checkout link for paid scheduling",
      metadata: { checkoutUrl, slot },
    });
    const updated = (await getSchedulingRequest(env, ownerId, request.id))!;
    return { request: serializeSchedulingRequest(updated), checkoutUrl };
  }

  if (timeType.source === "public_booking_offer" && timeType.publicBookingOfferId) {
    const booking = await finalizeSchedulingRequestAsBooking(env, ownerId, request, timeType, slot);
    if ("error" in booking) return booking;
    await markSchedulingRequestFinalized(env, ownerId, request.id, {
      bookingId: booking.booking.id,
      calendarEventId: null,
    });
    await insertSchedulingRequestAudit(env, {
      requestId: request.id,
      userId: ownerId,
      eventType: "finalized",
      actorRole: "assistant",
      summary: "Created booking after both owners approved",
      metadata: { bookingId: booking.booking.id, slot },
    });
    const updated = (await getSchedulingRequest(env, ownerId, request.id))!;
    return {
      request: serializeSchedulingRequest(updated),
      booking: serializeBooking(booking.booking),
    };
  }

  const calendarEvent = await finalizeSchedulingRequestAsCalendarEvent(
    env,
    ownerId,
    request,
    timeType,
    slot,
  );
  await markSchedulingRequestFinalized(env, ownerId, request.id, {
    bookingId: null,
    calendarEventId: calendarEvent.id,
  });
  await insertSchedulingRequestAudit(env, {
    requestId: request.id,
    userId: ownerId,
    eventType: "finalized",
    actorRole: "assistant",
    summary: "Created calendar event after both owners approved",
    metadata: { calendarEventId: calendarEvent.id, slot },
  });
  const updated = (await getSchedulingRequest(env, ownerId, request.id))!;
  return {
    request: serializeSchedulingRequest(updated),
    calendarEvent: serializeCalendarEvent(calendarEvent),
  };
}

async function deliverSchedulingRequestToSoulink(
  env: Env,
  ownerId: string,
  requestUrl: string,
  payload: SchedulingRequestStreamPayload,
): Promise<{ attempted: boolean; status: "sent" | "pending" | "failed" | "skipped" }> {
  const connection = await getSoulinkConnection(env, ownerId);
  if (!connection || connection.status !== "active" || !connection.provider_thread_id) {
    return { attempted: false, status: "skipped" };
  }

  const providerEventId = `scheduling:${payload.requestId}:candidates`;
  const messageText = payload.summary;
  const eventId = await insertProviderChannelEventOnce(env, {
    channel: "soulink",
    connectionId: connection.id,
    direction: "outbound",
    eventType: "send",
    status: "pending",
    providerEventId,
    providerMessageId: null,
    replyToMessageId: null,
    textBody: messageText,
    rawJson: {
      schedulingPayload: payload,
      fallbackActionCard: payload.actionCard,
    },
    errorMessage: null,
  });

  try {
    const response = await fetch(`${getSchedulingSoulinkApiOrigin(env)}/api/me3/assistant-channel/notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.setup_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        streamChannelType: connection.provider_connection_id || "messaging",
        streamChannelId: connection.provider_thread_id,
        messageId: providerEventId,
        messageText,
        createdAt: new Date().toISOString(),
        schedulingPayload: payload,
        fallbackActionCard: payload.actionCard,
        sourceUrl: requestUrl,
      }),
    });
    const result = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || result?.ok !== true) {
      await updateSchedulingSoulinkEvent(env, eventId, {
        status: "failed",
        providerMessageId: stringValue(result?.messageId),
        rawJson: result,
        errorMessage: stringValue(result?.error) || `Soulink notification failed with ${response.status}`,
      });
      return { attempted: true, status: "failed" };
    }
    await updateSchedulingSoulinkEvent(env, eventId, {
      status: "sent",
      providerMessageId: stringValue(result.messageId) || stringValue(result.eventId),
      rawJson: result,
      errorMessage: null,
    });
    await env.DB.prepare(
      `UPDATE agent_channel_connections
       SET last_outbound_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(connection.id)
      .run();
    return { attempted: true, status: "sent" };
  } catch (error) {
    await updateSchedulingSoulinkEvent(env, eventId, {
      status: "failed",
      providerMessageId: null,
      rawJson: { errorMessage: getSchedulingErrorMessage(error) },
      errorMessage: getSchedulingErrorMessage(error),
    });
    return { attempted: true, status: "failed" };
  }
}

async function updateSchedulingSoulinkEvent(
  env: Env,
  eventId: string,
  input: {
    status: "sent" | "failed";
    providerMessageId: string | null;
    rawJson: unknown;
    errorMessage: string | null;
  },
) {
  await env.DB.prepare(
    `UPDATE agent_channel_events
     SET status = ?,
         provider_message_id = ?,
         raw_json = ?,
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      input.status,
      input.providerMessageId,
      JSON.stringify(input.rawJson),
      input.errorMessage,
      eventId,
    )
    .run();
}

function buildSchedulingRequestStreamPayload(input: {
  requestId: string;
  timeType: SchedulingTimeType;
  slots: SchedulingCandidateSlot[];
  requesterName: string;
  targetName: string;
  reason: string;
}): SchedulingRequestStreamPayload {
  const names = [input.requesterName, input.targetName].filter(Boolean).join(" and ");
  const title = `${input.timeType.title} scheduling`;
  const options = input.slots.slice(0, 5).map((slot, index) => ({
    id: `${index + 1}`,
    label: formatSchedulingSlotLabel(slot),
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
  }));
  return {
    kind: "scheduling_poll",
    requestId: input.requestId,
    title,
    summary: `${title}: ${options.length} candidate time${options.length === 1 ? "" : "s"} ready${names ? ` for ${names}` : ""}.`,
    poll: {
      question: input.reason || `Which ${input.timeType.title} time works?`,
      maxSelections: options.length,
      options,
    },
    actionCard: {
      title,
      description: input.reason || "Choose the times that work, then both owners approve finalization.",
      actions: [
        ...options.map((option) => ({
          id: `vote:${option.id}`,
          label: option.label,
          type: "vote" as const,
        })),
        { id: "approve", label: "Approve selected time", type: "approve" as const },
      ],
    },
    requiresApproval: "both_owners",
  };
}

function formatSchedulingSlotLabel(slot: SchedulingRequestSlot): string {
  const end =
    slot.localEndDate && slot.localEndDate !== slot.localDate
      ? `${slot.localEndDate} ${slot.localEndTime}`
      : slot.localEndTime;
  return `${slot.localDate} ${slot.localStartTime}-${end} ${slot.timezone}`;
}

function normalizeSchedulingRequestCandidateLimit(value: unknown): number {
  const normalized = normalizeCandidateLimit(value);
  return Math.max(3, Math.min(5, normalized));
}

function normalizeSchedulingParticipantRole(value: unknown): SchedulingParticipantRole | null {
  return value === "requester" || value === "target" ? value : null;
}

function normalizeSchedulingVotePreference(value: unknown): SchedulingVotePreference {
  return value === "maybe" || value === "no" ? value : "yes";
}

function parseSchedulingRequestSlots(value: string | null): SchedulingRequestSlot[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseSchedulingRequestSlotFromUnknown)
      .filter((slot): slot is SchedulingRequestSlot => Boolean(slot));
  } catch {
    return [];
  }
}

function parseSchedulingRequestSlot(value: string | null): SchedulingRequestSlot | null {
  if (!value) return null;
  try {
    return parseSchedulingRequestSlotFromUnknown(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function parseSchedulingRequestSlotFromUnknown(value: unknown): SchedulingRequestSlot | null {
  if (!isPlainObject(value)) return null;
  const startsAt = normalizeShortText(value.startsAt, 40);
  const endsAt = normalizeShortText(value.endsAt, 40);
  const timezone = resolveTimeZone(normalizeShortText(value.timezone, 80));
  if (!startsAt || !endsAt || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))) {
    return null;
  }
  const localStart = formatUtcInstantInTimeZone(Date.parse(startsAt), timezone);
  const localEnd = formatUtcInstantInTimeZone(Date.parse(endsAt), timezone);
  return {
    startsAt,
    endsAt,
    timezone,
    localDate: normalizeShortText(value.localDate, 20) || localStart?.localDate || startsAt.slice(0, 10),
    localStartTime: normalizeShortText(value.localStartTime, 10) || localStart?.localTime || startsAt.slice(11, 16),
    localEndDate: normalizeShortText(value.localEndDate, 20) || localEnd?.localDate || endsAt.slice(0, 10),
    localEndTime: normalizeShortText(value.localEndTime, 10) || localEnd?.localTime || endsAt.slice(11, 16),
  };
}

function selectSchedulingRequestSlot(
  request: DbSchedulingRequest,
  slotIdValue: unknown,
  startsAtValue: unknown,
  endsAtValue: unknown,
): SchedulingRequestSlot | null {
  const slots = parseSchedulingRequestSlots(request.candidate_slots_json);
  const slotId = normalizeShortText(slotIdValue, 20);
  if (slotId && /^\d+$/.test(slotId)) {
    const index = Number(slotId) - 1;
    if (index >= 0 && index < slots.length) return slots[index];
  }
  const startsAt = normalizeShortText(startsAtValue, 40);
  const endsAt = normalizeShortText(endsAtValue, 40);
  if (!startsAt || !endsAt) return null;
  return slots.find((slot) => slot.startsAt === startsAt && slot.endsAt === endsAt) || null;
}

function firstPositiveSchedulingVoteSlot(votes: DbSchedulingRequestVote[]): SchedulingRequestSlot | null {
  const vote = votes.find((entry) => entry.preference === "yes") ||
    votes.find((entry) => entry.preference === "maybe");
  if (!vote) return null;
  const timezone = resolveTimeZone(null);
  const localStart = formatUtcInstantInTimeZone(Date.parse(vote.slot_starts_at), timezone);
  const localEnd = formatUtcInstantInTimeZone(Date.parse(vote.slot_ends_at), timezone);
  return {
    startsAt: vote.slot_starts_at,
    endsAt: vote.slot_ends_at,
    timezone,
    localDate: localStart?.localDate || vote.slot_starts_at.slice(0, 10),
    localStartTime: localStart?.localTime || vote.slot_starts_at.slice(11, 16),
    localEndDate: localEnd?.localDate || vote.slot_ends_at.slice(0, 10),
    localEndTime: localEnd?.localTime || vote.slot_ends_at.slice(11, 16),
  };
}

export async function getSchedulingRequest(
  env: Env,
  ownerId: string,
  requestId: string,
): Promise<DbSchedulingRequest | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, contact_id, time_type_id, status, requester_name,
              target_name, reason, date_range_start, date_range_end,
              candidate_slots_json, selected_slot_json, policy_json,
              stream_payload_json, checkout_url, requester_approved_at,
              target_approved_at, finalized_calendar_event_id,
              finalized_booking_id, finalized_at, created_at, updated_at
       FROM scheduling_requests
       WHERE user_id = ? AND id = ?`,
    )
      .bind(ownerId, requestId)
      .first<DbSchedulingRequest>()) || null
  );
}

export async function listSchedulingRequestVotes(
  env: Env,
  requestId: string,
): Promise<DbSchedulingRequestVote[]> {
  const rows = await env.DB.prepare(
    `SELECT id, request_id, participant_role, voter_label, slot_starts_at,
            slot_ends_at, preference, raw_json, created_at, updated_at
     FROM scheduling_request_votes
     WHERE request_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(requestId)
    .all<DbSchedulingRequestVote>();
  return rows.results || [];
}

export async function listSchedulingRequestAudit(
  env: Env,
  requestId: string,
): Promise<DbSchedulingRequestAudit[]> {
  const rows = await env.DB.prepare(
    `SELECT id, request_id, user_id, event_type, actor_role, summary,
            metadata_json, created_at
     FROM scheduling_request_audit
     WHERE request_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(requestId)
    .all<DbSchedulingRequestAudit>();
  return rows.results || [];
}

async function insertSchedulingRequestAudit(
  env: Env,
  input: {
    requestId: string;
    userId: string;
    eventType: DbSchedulingRequestAudit["event_type"];
    actorRole: NonNullable<DbSchedulingRequestAudit["actor_role"]>;
    summary: string;
    metadata: unknown;
  },
) {
  await env.DB.prepare(
    `INSERT INTO scheduling_request_audit
       (id, request_id, user_id, event_type, actor_role, summary, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      crypto.randomUUID(),
      input.requestId,
      input.userId,
      input.eventType,
      input.actorRole,
      input.summary,
      JSON.stringify(input.metadata),
    )
    .run();
}

async function finalizeSchedulingRequestAsCalendarEvent(
  env: Env,
  ownerId: string,
  request: DbSchedulingRequest,
  timeType: SchedulingTimeType,
  slot: SchedulingRequestSlot,
): Promise<DbUserCalendarEvent> {
  const eventId = crypto.randomUUID();
  const title = [timeType.title, schedulingRequestCounterpartyName(request)]
    .filter(Boolean)
    .join(" with ");
  const meetingUrl = schedulingRequestMeetingUrl(request.policy_json);
  const notes = [
    request.reason,
    meetingUrl ? `Join: ${meetingUrl}` : null,
    "Created by ME3 agent-assisted scheduling after both owners approved.",
  ].filter(Boolean).join("\n\n");
  await env.DB.prepare(
    `INSERT INTO user_calendar_events
       (id, user_id, title, notes, location, starts_at, ends_at, timezone, all_day, kind, recurrence_rule)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'event', NULL)`,
  )
    .bind(eventId, ownerId, title, notes, meetingUrl, slot.startsAt, slot.endsAt, slot.timezone)
    .run();

  return (
    (await env.DB.prepare(
      `SELECT id, user_id, title, notes, location, starts_at, ends_at, timezone,
              all_day, kind, recurrence_rule, created_at
       FROM user_calendar_events
       WHERE id = ? AND user_id = ?`,
    )
      .bind(eventId, ownerId)
      .first<DbUserCalendarEvent>()) || {
      id: eventId,
      user_id: ownerId,
      title,
      notes,
      location: meetingUrl,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      timezone: slot.timezone,
      all_day: 0,
      kind: "event",
      recurrence_rule: null,
      created_at: new Date().toISOString(),
    }
  );
}

function schedulingRequestMeetingUrl(policyJson: string | null) {
  if (!policyJson) return null;
  try {
    const policy = JSON.parse(policyJson) as { meetingUrl?: unknown };
    if (typeof policy.meetingUrl !== "string") return null;
    const url = new URL(policy.meetingUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function schedulingRequestCounterpartyName(request: DbSchedulingRequest) {
  if (!request.policy_json) return request.target_name;
  try {
    const policy = JSON.parse(request.policy_json) as { role?: unknown };
    return policy.role === "target" ? request.requester_name : request.target_name;
  } catch {
    return request.target_name;
  }
}

async function finalizeSchedulingRequestAsBooking(
  env: Env,
  ownerId: string,
  request: DbSchedulingRequest,
  timeType: SchedulingTimeType,
  slot: SchedulingRequestSlot,
): Promise<{ booking: DbBooking } | { error: string; status: 400 | 404 | 409 }> {
  const publicRef = parsePublicSchedulingTimeTypeId(timeType.id);
  if (!publicRef) return { error: "Public booking time type is invalid", status: 400 };
  const site = await getSiteForOwner(env, ownerId, publicRef.username);
  if (!site) return { error: "Booking site not found", status: 404 };
  const profile = await loadSiteProfileForCommerce(env, site);
  const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
  if (!bookIntent?.enabled) return { error: "Booking offer not found", status: 404 };
  const offerResult = resolvePublicOneToOneBookingOffer(bookIntent, publicRef.offerId);
  if ("error" in offerResult) return offerResult;
  const slotResult = resolvePublicBookingSlot({
    slotStart: slot.startsAt,
    slotEnd: slot.endsAt,
    durationMinutes: offerResult.offer.duration,
    timezone: resolveTimeZone(offerResult.offer.availability.timezone),
  });
  if ("error" in slotResult) return { error: slotResult.error, status: 400 };
  const availabilityError = validateBookingAvailability(
    offerResult.offer.availability,
    slotResult.localDate,
    slotResult.localTime,
    offerResult.offer.duration,
  );
  if (availabilityError) return { error: availabilityError, status: 400 };
  const overlap = await findConfirmedBookingOverlap(env, {
    siteId: site.id,
    offerId: offerResult.offer.id,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
  });
  if (overlap) return { error: "That time has already been booked", status: 409 };

  const owner = await getOwnerProfile(env, ownerId);
    const booking = await createConfirmedOneToOneBooking(env, {
    site,
    bookIntent,
    offer: offerResult.offer,
    guestName: request.requester_name || "Scheduling contact",
    guestEmail: owner?.email || "unknown@example.com",
    notes: request.reason || "Created by ME3 agent-assisted scheduling.",
    slot,
  });
  if (!booking) return { error: "Failed to create booking", status: 400 };
  return { booking };
}

async function markSchedulingRequestFinalized(
  env: Env,
  ownerId: string,
  requestId: string,
  input: { bookingId: string | null; calendarEventId: string | null },
) {
  await env.DB.prepare(
    `UPDATE scheduling_requests
     SET status = 'finalized',
         finalized_booking_id = ?,
         finalized_calendar_event_id = ?,
         finalized_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  )
    .bind(input.bookingId, input.calendarEventId, requestId, ownerId)
    .run();
}

function parsePublicSchedulingTimeTypeId(id: string): { username: string; offerId: string } | null {
  if (!id.startsWith("public:")) return null;
  const [, username, ...offerParts] = id.split(":");
  const offerId = offerParts.join(":");
  return username && offerId ? { username, offerId } : null;
}

function buildSchedulingCheckoutUrl(
  env: Env,
  timeType: SchedulingTimeType,
  slot: SchedulingRequestSlot,
): string {
  const publicRef = parsePublicSchedulingTimeTypeId(timeType.id);
  const origin = env.CORE_WEB_ORIGIN || env.CORE_API_ORIGIN || "";
  if (!publicRef || !origin) return "";
  const url = new URL(`/book/${publicRef.username}`, origin);
  url.searchParams.set("offerId", publicRef.offerId);
  url.searchParams.set("slotStart", slot.startsAt);
  url.searchParams.set("slotEnd", slot.endsAt);
  return url.toString();
}

function getSchedulingSoulinkApiOrigin(env: Env): string {
  const configured = normalizeShortText(env.SOULINK_API_ORIGIN, 300);
  if (!configured) return DEFAULT_SOULINK_API_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_SOULINK_API_ORIGIN;
  }
}

function getSchedulingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function serializeSchedulingRequest(row: DbSchedulingRequest) {
  return {
    id: row.id,
    contactId: row.contact_id,
    timeTypeId: row.time_type_id,
    status: row.status,
    requesterName: row.requester_name,
    targetName: row.target_name,
    reason: row.reason,
    dateRange: { start: row.date_range_start, end: row.date_range_end },
    candidateSlots: parseSchedulingRequestSlots(row.candidate_slots_json),
    selectedSlot: parseSchedulingRequestSlot(row.selected_slot_json),
    policy: parseJsonRecord(row.policy_json),
    streamPayload: parseJsonRecord(row.stream_payload_json),
    checkoutUrl: row.checkout_url,
    approvals: {
      requesterApprovedAt: row.requester_approved_at,
      targetApprovedAt: row.target_approved_at,
    },
    finalizedCalendarEventId: row.finalized_calendar_event_id,
    finalizedBookingId: row.finalized_booking_id,
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeSchedulingVote(row: DbSchedulingRequestVote) {
  return {
    id: row.id,
    requestId: row.request_id,
    participantRole: row.participant_role,
    voterLabel: row.voter_label,
    slot: {
      startsAt: row.slot_starts_at,
      endsAt: row.slot_ends_at,
    },
    preference: row.preference,
    raw: parseJsonRecord(row.raw_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeSchedulingAudit(row: DbSchedulingRequestAudit) {
  return {
    id: row.id,
    requestId: row.request_id,
    eventType: row.event_type,
    actorRole: row.actor_role,
    summary: row.summary,
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: row.created_at,
  };
}

async function getOwnerSchedulingTimeType(
  env: Env,
  ownerId: string,
  id: string,
): Promise<DbSchedulingTimeType | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, title, description, duration_minutes, buffer_minutes,
              timezone, windows_json, allowed_tiers_json, payment_mode,
              public_booking_offer_id, owner_pre_review,
              allow_close_contact_candidate_sharing, final_approval, status,
              created_at, updated_at
       FROM scheduling_time_types
       WHERE user_id = ? AND id = ?`,
    )
      .bind(ownerId, id)
      .first<DbSchedulingTimeType>()) || null
  );
}

async function getSchedulingContact(
  env: Env,
  ownerId: string,
  contactId: string,
): Promise<DbContact | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, name, email, phone, source, source_ref,
              relationship, status, notes, tags, last_interaction_at,
              next_followup_at, outreach_status, social_handles, metadata,
              created_at, updated_at
       FROM contacts
       WHERE user_id = ? AND id = ?`,
    )
      .bind(ownerId, contactId)
      .first<DbContact>()) || null
  );
}

function serializeSchedulingTimeType(row: DbSchedulingTimeType): SchedulingTimeType {
  return {
    id: row.id,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    durationMinutes: row.duration_minutes,
    bufferMinutes: row.buffer_minutes,
    timezone: resolveTimeZone(row.timezone),
    windows: sanitizeAvailabilityWindows(parseJsonRecord(row.windows_json)),
    allowedTiers: normalizeAllowedSchedulingTiers(parseJsonArray(row.allowed_tiers_json)),
    paymentMode: normalizeSchedulingPaymentMode(row.payment_mode),
    ...(row.public_booking_offer_id ? { publicBookingOfferId: row.public_booking_offer_id } : {}),
    ownerPreReview: normalizeSchedulingOwnerPreReview(row.owner_pre_review),
    allowCloseContactCandidateSharing: row.allow_close_contact_candidate_sharing === 1,
    finalApproval: "both_owners",
    source: row.public_booking_offer_id ? "public_booking_offer" : "owner",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseSchedulingTimeTypeInput(
  value: unknown,
  existing: SchedulingTimeType | null,
):
  | Omit<SchedulingTimeType, "id" | "source" | "createdAt" | "updatedAt">
  | { error: string } {
  if (!isPlainObject(value)) return { error: "Invalid request body" };

  const title = normalizeShortText(value.title ?? existing?.title, 120);
  if (!title) return { error: "Title is required" };

  const durationMinutes = normalizeDurationMinutes(
    value.durationMinutes,
    existing?.durationMinutes ?? 30,
  );
  if (!durationMinutes) return { error: "durationMinutes must be between 15 and 1440" };

  const timezone = resolveTimeZone(
    normalizeShortText(value.timezone, 120) || existing?.timezone || "UTC",
  );
  const windows = sanitizeAvailabilityWindows(
    isPlainObject(value.windows) ? value.windows : existing?.windows || {},
  );
  if (Object.keys(windows).length === 0) {
    return { error: "At least one availability window is required" };
  }

  return {
    title,
    description: normalizeLongText(value.description ?? existing?.description, 500),
    durationMinutes,
    bufferMinutes: normalizeBufferMinutes(value.bufferMinutes, existing?.bufferMinutes ?? 0),
    timezone,
    windows,
    allowedTiers: normalizeAllowedSchedulingTiers(
      Array.isArray(value.allowedTiers) ? value.allowedTiers : existing?.allowedTiers,
    ),
    paymentMode: normalizeSchedulingPaymentMode(
      normalizeShortText(value.paymentMode, 40) || existing?.paymentMode,
    ),
    ownerPreReview: normalizeSchedulingOwnerPreReview(
      normalizeShortText(value.ownerPreReview, 40) || existing?.ownerPreReview,
    ),
    allowCloseContactCandidateSharing:
      typeof value.allowCloseContactCandidateSharing === "boolean"
        ? value.allowCloseContactCandidateSharing
        : existing?.allowCloseContactCandidateSharing ?? true,
    finalApproval: "both_owners",
    status: value.status === "archived" ? "archived" : "active",
  };
}

function resolveSchedulingPrivilegeTier(contact: DbContact | null): SchedulingPrivilegeTier {
  if (!contact || contact.status === "archived") return "public";
  if (contact.relationship === "client") return "client";

  const metadata = parseJsonRecord(contact.metadata);
  const closeness =
    typeof metadata.closeness === "string" ? metadata.closeness : null;
  if (closeness === "close" || closeness === "very_close") {
    return "close_contact";
  }

  return "contact";
}

function normalizeDurationMinutes(value: unknown, fallback: number): number | null {
  const number =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
      ? Number(value)
      : fallback;
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  if (rounded < 15 || rounded > 24 * 60) return null;
  return rounded;
}

function normalizeBufferMinutes(value: unknown, fallback = 0): number {
  const number =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
      ? Number(value)
      : fallback;
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(240, Math.round(number)));
}

function sanitizeAvailabilityWindows(value: unknown): Record<string, string[]> {
  if (!isPlainObject(value)) return {};
  const result: Record<string, string[]> = {};
  for (const day of [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]) {
    const windows = value[day];
    if (!Array.isArray(windows)) continue;
    const valid = windows
      .map((window) => String(window).trim())
      .filter((window) => {
        const [start, end] = window.split("-").map((part) => part.trim());
        const startMinutes = timeToMinutes(start);
        const endMinutes = timeToMinutes(end);
        return startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;
      });
    if (valid.length > 0) result[day] = valid;
  }
  return result;
}

function normalizeAllowedSchedulingTiers(value: unknown): SchedulingPrivilegeTier[] {
  const allowed = new Set<SchedulingPrivilegeTier>();
  if (Array.isArray(value)) {
    for (const tier of value) {
      if (
        tier === "public" ||
        tier === "contact" ||
        tier === "close_contact" ||
        tier === "client"
      ) {
        allowed.add(tier);
      }
    }
  }
  if (allowed.size === 0) allowed.add("close_contact");
  return Array.from(allowed);
}

function normalizeSchedulingPaymentMode(value: unknown): SchedulingPaymentMode {
  return value === "paid_checkout" || value === "owner_review" || value === "free"
    ? value
    : "free";
}

function normalizeSchedulingOwnerPreReview(value: unknown): SchedulingOwnerPreReview {
  return value === "always" || value === "unless_close_contact"
    ? value
    : "unless_close_contact";
}

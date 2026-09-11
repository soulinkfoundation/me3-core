import type Stripe from "stripe";
import { scheduleBookingRemindersForBooking } from "./booking-reminders";
import {
  loadSiteProfileForCommerce,
  normalizeLongText,
  resolveBookingSlot,
  serializeBooking,
  weekdayForDate,
  type CoreBookIntent,
  type CoreBookingPricing,
} from "./booking";
import { getUtcMsForLocalTime, resolveTimeZone } from "./calendar";
import {
  bookingDetailsFromBooking,
  getOwnerContact,
  sendBookingConfirmationEmails,
} from "./transactional-emails";
import type { DbBooking, DbSite, Env } from "./types";
import { dispatchWebsitePaymentNotification } from "./payment-notifications";

export type EventBookingType = "class" | "retreat";

/**
 * ME3 owns native class and retreat registration for published ME3 sites.
 * Soulink remains a relationship/community surface and is not a ticketing dependency.
 */

type EventBookingOfferBase = {
  id?: string;
  title?: string;
  description?: string;
  duration?: number;
  timezone?: string;
  pricing?: CoreBookingPricing;
  capacity?: number | null;
};

type ClassBookingOffer = EventBookingOfferBase & {
  recurrence?: {
    frequency?: "weekly" | "biweekly" | string;
    weekday?: string;
    startTime?: string;
    startDate?: string;
  };
};

type RetreatBookingOffer = EventBookingOfferBase & {
  durationDays?: number;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
};

type EventBookIntent = CoreBookIntent & {
  classes?: ClassBookingOffer[];
  retreats?: RetreatBookingOffer[];
  bookingTypes?: Array<{
    type?: string;
    classes?: ClassBookingOffer[];
    retreats?: RetreatBookingOffer[];
  }>;
};

export type ResolvedEventBookingOffer = {
  bookingType: EventBookingType;
  id: string;
  title: string;
  description?: string;
  duration: number;
  timezone: string;
  pricing?: CoreBookingPricing;
  capacity: number | null;
  recurrence?: {
    frequency: "weekly" | "biweekly";
    weekday: string;
    startTime: string;
    startDate?: string;
  };
  retreat?: {
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
  };
};

export type EventOccurrence = {
  startsAt: string;
  endsAt: string;
  startsAtMs: number;
  durationMinutes: number;
  localDate: string;
  localTime: string;
};

type CapacityRow = { confirmed: number | null; held: number | null };

export function isEventBookingType(value: unknown): value is EventBookingType {
  return value === "class" || value === "retreat";
}

export function resolveEventBookingOffer(
  book: CoreBookIntent,
  bookingType: EventBookingType,
  offerId: string,
): ResolvedEventBookingOffer | null {
  const eventBook = book as EventBookIntent;
  const explicitType = Array.isArray(eventBook.bookingTypes)
    ? eventBook.bookingTypes.find((entry) => entry?.type === bookingType)
    : undefined;
  const rawOffers =
    bookingType === "class"
      ? explicitType?.classes || eventBook.classes || []
      : explicitType?.retreats || eventBook.retreats || [];
  const raw = rawOffers.find((entry, index) => {
    const id = normalizeOfferId(entry.id, entry.title, bookingType, index);
    return id === offerId;
  });
  if (!raw) return null;

  const index = rawOffers.indexOf(raw);
  const id = normalizeOfferId(raw.id, raw.title, bookingType, index);
  const capacity = normalizeCapacity(raw.capacity);
  const timezone = resolveTimeZone(raw.timezone);
  const title = raw.title?.trim() || (bookingType === "class" ? "Class" : "Retreat");
  const pricing = raw.pricing;

  if (bookingType === "class") {
    const classOffer = raw as ClassBookingOffer;
    const weekday = String(classOffer.recurrence?.weekday || "").toLowerCase();
    const startTime = String(classOffer.recurrence?.startTime || "");
    if (!VALID_WEEKDAYS.has(weekday) || !TIME_PATTERN.test(startTime)) return null;
    const duration = normalizeDuration(classOffer.duration, 60);
    const startDate = DATE_PATTERN.test(classOffer.recurrence?.startDate || "")
      ? classOffer.recurrence?.startDate
      : undefined;
    return {
      bookingType,
      id,
      title,
      ...(raw.description ? { description: raw.description } : {}),
      duration,
      timezone,
      pricing,
      capacity,
      recurrence: {
        frequency:
          classOffer.recurrence?.frequency === "biweekly" ? "biweekly" : "weekly",
        weekday,
        startTime,
        ...(startDate ? { startDate } : {}),
      },
    };
  }

  const retreat = raw as RetreatBookingOffer;
  if (
    !DATE_PATTERN.test(retreat.startDate || "") ||
    !DATE_PATTERN.test(retreat.endDate || "") ||
    !TIME_PATTERN.test(retreat.startTime || "") ||
    !TIME_PATTERN.test(retreat.endTime || "")
  ) {
    return null;
  }
  const duration = Math.max(1, Math.round(Number(retreat.durationDays) || 1)) * 24 * 60;
  return {
    bookingType,
    id,
    title,
    ...(raw.description ? { description: raw.description } : {}),
    duration,
    timezone,
    pricing,
    capacity,
    retreat: {
      startDate: retreat.startDate!,
      startTime: retreat.startTime!,
      endDate: retreat.endDate!,
      endTime: retreat.endTime!,
    },
  };
}

export function resolveEventOccurrence(
  offer: ResolvedEventBookingOffer,
  requestedDate = "",
): EventOccurrence | null {
  if (offer.bookingType === "class") {
    const recurrence = offer.recurrence;
    if (!recurrence || !DATE_PATTERN.test(requestedDate)) return null;
    if (weekdayForDate(requestedDate) !== recurrence.weekday) return null;
    if (recurrence.startDate) {
      if (requestedDate < recurrence.startDate) return null;
      const weeks = wholeWeeksBetween(recurrence.startDate, requestedDate);
      if (weeks === null) return null;
      if (recurrence.frequency === "biweekly" && weeks % 2 !== 0) return null;
    } else if (
      recurrence.frequency === "biweekly" &&
      biweeklyParity(requestedDate) !== 0
    ) {
      return null;
    }
    const slot = resolveBookingSlot({
      localDate: requestedDate,
      localTime: recurrence.startTime,
      durationMinutes: offer.duration,
      timezone: offer.timezone,
    });
    if (!slot) return null;
    return {
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      startsAtMs: slot.startsAtMs,
      durationMinutes: offer.duration,
      localDate: requestedDate,
      localTime: recurrence.startTime,
    };
  }

  if (!offer.retreat) return null;
  const startMs = wallTimeToUtcMs(
    offer.retreat.startDate,
    offer.retreat.startTime,
    offer.timezone,
  );
  const endMs = wallTimeToUtcMs(
    offer.retreat.endDate,
    offer.retreat.endTime,
    offer.timezone,
  );
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return {
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    startsAtMs: startMs,
    durationMinutes: Math.max(1, Math.round((endMs - startMs) / 60_000)),
    localDate: offer.retreat.startDate,
    localTime: offer.retreat.startTime,
  };
}

export function normalizeAttendeeQuantity(
  value: unknown,
  capacity: number | null,
): number | null {
  const quantity =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 1;
  const maximum = capacity === null ? 20 : Math.min(capacity, 100);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximum) return null;
  return quantity;
}

export async function getEventOccurrenceAvailability(
  env: Env,
  input: {
    siteId: string;
    offer: ResolvedEventBookingOffer;
    occurrence: EventOccurrence;
  },
): Promise<{ remaining: number | null; soldOut: boolean }> {
  if (input.offer.capacity === null) return { remaining: null, soldOut: false };
  const row = await env.DB.prepare(capacitySql())
    .bind(
      input.siteId,
      input.offer.id,
      input.offer.bookingType,
      input.occurrence.endsAt,
      input.occurrence.startsAt,
      input.siteId,
      input.offer.id,
      input.offer.bookingType,
      input.occurrence.endsAt,
      input.occurrence.startsAt,
    )
    .first<CapacityRow>();
  const used = Number(row?.confirmed || 0) + Number(row?.held || 0);
  const remaining = Math.max(0, input.offer.capacity - used);
  return { remaining, soldOut: remaining === 0 };
}

export async function createConfirmedEventBooking(
  env: Env,
  input: {
    site: DbSite;
    bookIntent: CoreBookIntent;
    offer: ResolvedEventBookingOffer;
    occurrence: EventOccurrence;
    quantity: number;
    guestName: string;
    guestEmail: string;
    notes: string;
    pageId?: string;
    actionId?: string;
    campaign?: string;
    amountDuePerAttendeeCents?: number;
    paymentCurrency?: string;
  },
): Promise<DbBooking | null> {
  const manualPayment =
    input.offer.pricing?.enabled === true &&
    input.offer.pricing.paymentMethod === "manual";
  const bookingId = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT INTO bookings
     (id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
      duration_minutes, status, notes, created_at, payment_intent_id, amount_paid,
      suggested_amount, currency, payment_status, is_free_booking, paid_at,
      page_id, action_id, campaign, quantity)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now'),
            NULL, NULL, ?, ?, 'not_required', ?, NULL, ?, ?, ?, ?
     WHERE ? IS NULL OR
       COALESCE((
         SELECT SUM(COALESCE(quantity, 1)) FROM bookings
         WHERE site_id = ? AND offer_id = ? AND booking_type = ? AND status = 'confirmed'
           AND starts_at < ? AND ends_at > ?
       ), 0) +
       COALESCE((
         SELECT SUM(COALESCE(quantity, 1)) FROM booking_holds
         WHERE site_id = ? AND offer_id = ? AND booking_type = ? AND status = 'active'
           AND datetime(expires_at) > datetime('now')
           AND slot_start < ? AND slot_end > ?
       ), 0) + ? <= ?`,
  )
    .bind(
      bookingId,
      input.site.id,
      input.offer.id,
      input.offer.bookingType,
      input.guestName,
      input.guestEmail,
      input.occurrence.startsAt,
      input.occurrence.endsAt,
      input.occurrence.durationMinutes,
      input.notes || null,
      manualPayment
        ? (input.amountDuePerAttendeeCents || 0) * input.quantity
        : null,
      manualPayment
        ? String(input.paymentCurrency || input.offer.pricing?.currency || "USD").toLowerCase()
        : null,
      manualPayment ? 0 : 1,
      input.pageId || null,
      input.actionId || null,
      input.campaign || null,
      input.quantity,
      input.offer.capacity,
      input.site.id,
      input.offer.id,
      input.offer.bookingType,
      input.occurrence.endsAt,
      input.occurrence.startsAt,
      input.site.id,
      input.offer.id,
      input.offer.bookingType,
      input.occurrence.endsAt,
      input.occurrence.startsAt,
      input.quantity,
      input.offer.capacity,
    )
    .run();
  if (!result.meta.changes) return null;

  const booking = await findEventBookingById(env, bookingId);
  if (booking) {
    await notifyConfirmedEventBooking(env, {
      site: input.site,
      bookIntent: input.bookIntent,
      offer: input.offer,
      booking,
    });
  }
  return booking;
}

export async function createEventBookingHold(
  env: Env,
  input: {
    siteId: string;
    offer: ResolvedEventBookingOffer;
    occurrence: EventOccurrence;
    quantity: number;
    holdToken: string;
    expiresAt: string;
  },
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT INTO booking_holds
     (id, site_id, booking_id, offer_id, booking_type, hold_token, slot_start, slot_end,
      status, expires_at, created_at, updated_at, quantity)
     SELECT ?, ?, NULL, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'), ?
     WHERE ? IS NULL OR
       COALESCE((
         SELECT SUM(COALESCE(quantity, 1)) FROM bookings
         WHERE site_id = ? AND offer_id = ? AND booking_type = ? AND status = 'confirmed'
           AND starts_at < ? AND ends_at > ?
       ), 0) +
       COALESCE((
         SELECT SUM(COALESCE(quantity, 1)) FROM booking_holds
         WHERE site_id = ? AND offer_id = ? AND booking_type = ? AND status = 'active'
           AND datetime(expires_at) > datetime('now')
           AND slot_start < ? AND slot_end > ?
       ), 0) + ? <= ?`,
  )
    .bind(
      crypto.randomUUID(),
      input.siteId,
      input.offer.id,
      input.offer.bookingType,
      input.holdToken,
      input.occurrence.startsAt,
      input.occurrence.endsAt,
      input.expiresAt,
      input.quantity,
      input.offer.capacity,
      input.siteId,
      input.offer.id,
      input.offer.bookingType,
      input.occurrence.endsAt,
      input.occurrence.startsAt,
      input.siteId,
      input.offer.id,
      input.offer.bookingType,
      input.occurrence.endsAt,
      input.occurrence.startsAt,
      input.quantity,
      input.offer.capacity,
    )
    .run();
  return Boolean(result.meta.changes);
}

export async function releaseEventBookingHold(env: Env, holdToken: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE booking_holds
     SET status = 'released', updated_at = datetime('now')
     WHERE hold_token = ? AND status = 'active'`,
  )
    .bind(holdToken)
    .run();
}

export async function finalizePaidEventBookingCheckout(
  env: Env,
  site: DbSite,
  session: Stripe.Checkout.Session,
): Promise<
  | { ok: true; booking: ReturnType<typeof serializeBooking>; alreadyCompleted?: true }
  | { error: string; status: number }
> {
  if (session.payment_status !== "paid") {
    return { error: "Payment has not completed yet", status: 400 };
  }
  const metadata = session.metadata || {};
  const bookingType = metadata.booking_type;
  if (
    metadata.purchase_kind !== "booking" ||
    metadata.site_id !== site.id ||
    !isEventBookingType(bookingType)
  ) {
    return { error: "Checkout session does not match this event", status: 400 };
  }
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  if (!paymentIntentId) return { error: "Payment intent missing from session", status: 400 };

  const existing = await findEventBookingByPaymentIntent(env, paymentIntentId);
  if (existing) {
    return { ok: true, booking: serializeBooking(existing), alreadyCompleted: true };
  }

  const offerId = metadata.offer_id || "";
  const holdToken = metadata.hold_token || "";
  const guestName = metadata.guest_name || "";
  const guestEmail = metadata.guest_email || "";
  const startsAt = metadata.starts_at || "";
  const endsAt = metadata.ends_at || "";
  const durationMinutes = Number(metadata.duration_minutes || 0);
  const quantity = Number(metadata.quantity || 1);
  if (
    !offerId ||
    !holdToken ||
    !guestName ||
    !guestEmail ||
    !startsAt ||
    !endsAt ||
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < 1 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    return { error: "Checkout session is missing event booking details", status: 400 };
  }

  const bookingId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO bookings
       (id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
        duration_minutes, status, notes, created_at, payment_intent_id, amount_paid,
        suggested_amount, currency, payment_status, is_free_booking, paid_at,
        page_id, action_id, campaign, quantity)
       SELECT ?, site_id, offer_id, booking_type, ?, ?, slot_start, slot_end,
              ?, 'confirmed', ?, datetime('now'), ?, ?, ?, ?, 'succeeded', 0,
              datetime('now'), ?, ?, ?, quantity
       FROM booking_holds
       WHERE hold_token = ? AND site_id = ? AND offer_id = ? AND booking_type = ?
         AND slot_start = ? AND slot_end = ? AND quantity = ?
         AND status = 'active' AND datetime(expires_at) > datetime('now')
         AND NOT EXISTS (SELECT 1 FROM bookings WHERE payment_intent_id = ?)`,
    ).bind(
      bookingId,
      guestName,
      guestEmail,
      durationMinutes,
      metadata.notes || null,
      paymentIntentId,
      session.amount_total || null,
      session.amount_subtotal || session.amount_total || null,
      session.currency || null,
      metadata.page_id || null,
      metadata.action_id || null,
      metadata.campaign || null,
      holdToken,
      site.id,
      offerId,
      bookingType,
      startsAt,
      endsAt,
      quantity,
      paymentIntentId,
    ),
    env.DB.prepare(
      `UPDATE booking_holds
       SET status = 'confirmed', booking_id = ?, updated_at = datetime('now')
       WHERE hold_token = ? AND status = 'active'
         AND EXISTS (SELECT 1 FROM bookings WHERE id = ?)`,
    ).bind(bookingId, holdToken, bookingId),
  ];
  const results = await env.DB.batch(statements);
  if (!results[0]?.meta.changes) {
    const completed = await findEventBookingByPaymentIntent(env, paymentIntentId);
    if (completed) {
      return { ok: true, booking: serializeBooking(completed), alreadyCompleted: true };
    }
    return {
      error: "Your reserved spaces expired before confirmation. Payment succeeded; contact the site owner for help.",
      status: 409,
    };
  }

  const booking = await findEventBookingById(env, bookingId);
  if (!booking) return { error: "Event booking could not be loaded", status: 500 };
  const profile = await loadSiteProfileForCommerce(env, site);
  const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
  const offer = bookIntent
    ? resolveEventBookingOffer(bookIntent, bookingType, offerId)
    : null;
  if (bookIntent && offer) {
    await notifyConfirmedEventBooking(env, { site, bookIntent, offer, booking });
  }
  await dispatchWebsitePaymentNotification(env, site.user_id, {
    sourceKind: "booking",
    sourceId: booking.id,
    amountCents: Number(booking.amount_paid || 0),
    currency: String(booking.currency || "USD").toUpperCase(),
    customerName: booking.guest_name?.trim() || null,
    itemTitle: offer?.title || "Booking payment",
    siteName: site.username,
  }).catch((error) => console.error("Booking payment notification failed", error));
  return { ok: true, booking: serializeBooking(booking) };
}

export function serializePublicEventOffer(offer: ResolvedEventBookingOffer) {
  return {
    id: offer.id,
    bookingType: offer.bookingType,
    title: offer.title,
    duration: offer.duration,
    timezone: offer.timezone,
    capacity: offer.capacity,
    pricing: offer.pricing?.enabled
      ? {
          enabled: true,
          suggestedAmount: offer.pricing.suggestedAmount,
          currency: offer.pricing.currency,
          paymentMethod:
            offer.pricing.paymentMethod === "manual" ? "manual" : "stripe",
        }
      : { enabled: false },
  };
}

async function notifyConfirmedEventBooking(
  env: Env,
  input: {
    site: DbSite;
    bookIntent: CoreBookIntent;
    offer: ResolvedEventBookingOffer;
    booking: DbBooking;
  },
): Promise<void> {
  scheduleBookingRemindersForBooking(env, {
    booking: input.booking,
    bookingTitle: input.offer.title,
    timezone: input.offer.timezone,
    reminders: input.bookIntent.reminders,
  }).catch((error) => console.error("Failed to schedule event booking reminders:", error));

  const owner = await getOwnerContact(env, input.site.user_id);
  const profile = await loadSiteProfileForCommerce(env, input.site);
  const hostName = profile?.name || owner.name || input.site.username;
  const confirmationEmail = input.bookIntent.confirmationEmail;
  const result = await sendBookingConfirmationEmails(
    env,
    bookingDetailsFromBooking({
      booking: input.booking,
      ownerId: input.site.user_id,
      hostName,
      hostEmail: owner.email,
      siteName: hostName,
      bookingTitle: input.offer.title,
      timezone: input.offer.timezone,
      guestMessageText: normalizeLongText(confirmationEmail?.message, 8000),
      paymentInstructions: normalizeLongText(
        input.offer.pricing?.paymentMethod === "manual"
          ? input.offer.pricing.paymentInstructions
          : "",
        8000,
      ),
      sendHostCopy: confirmationEmail?.sendHostCopy !== false,
    }),
  );
  if (result.guest.status === "failed" || result.host.status === "failed") {
    console.error("Event booking confirmation email issue:", result);
  }
}

async function findEventBookingById(env: Env, bookingId: string): Promise<DbBooking | null> {
  return (
    (await env.DB.prepare(eventBookingSelect("WHERE id = ?"))
      .bind(bookingId)
      .first<DbBooking>()) || null
  );
}

async function findEventBookingByPaymentIntent(
  env: Env,
  paymentIntentId: string,
): Promise<DbBooking | null> {
  return (
    (await env.DB.prepare(eventBookingSelect("WHERE payment_intent_id = ?"))
      .bind(paymentIntentId)
      .first<DbBooking>()) || null
  );
}

function eventBookingSelect(where: string): string {
  return `SELECT id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
                 duration_minutes, calendar_event_id, status, notes, created_at, cancelled_at,
                 payment_intent_id, amount_paid, suggested_amount, currency, payment_status,
                 is_free_booking, paid_at, page_id, action_id, campaign, quantity
          FROM bookings ${where}`;
}

function capacitySql(): string {
  return `SELECT
    (SELECT COALESCE(SUM(COALESCE(quantity, 1)), 0) FROM bookings
     WHERE site_id = ? AND offer_id = ? AND booking_type = ? AND status = 'confirmed'
       AND starts_at < ? AND ends_at > ?) AS confirmed,
    (SELECT COALESCE(SUM(COALESCE(quantity, 1)), 0) FROM booking_holds
     WHERE site_id = ? AND offer_id = ? AND booking_type = ? AND status = 'active'
       AND datetime(expires_at) > datetime('now')
       AND slot_start < ? AND slot_end > ?) AS held`;
}

function normalizeOfferId(
  id: string | undefined,
  title: string | undefined,
  bookingType: EventBookingType,
  index: number,
): string {
  const supplied = id?.trim();
  if (supplied) return supplied.slice(0, 100);
  const slug = String(title || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `${bookingType}-${index + 1}`;
}

function normalizeDuration(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(15, Math.min(24 * 60, Math.round(value)))
    : fallback;
}

function normalizeCapacity(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const capacity = Number(value);
  return Number.isSafeInteger(capacity) && capacity > 0
    ? Math.min(capacity, 10_000)
    : null;
}

function wholeWeeksBetween(startDate: string, date: string): number | null {
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const end = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const days = Math.round((end - start) / 86_400_000);
  return days % 7 === 0 ? days / 7 : null;
}

function biweeklyParity(date: string): number | null {
  const value = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(value)) return null;
  return Math.floor(value / (14 * 86_400_000)) % 2;
}

function wallTimeToUtcMs(date: string, time: string, timezone: string): number | null {
  const dateParts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number);
  const timeParts = time.match(/^(\d{2}):(\d{2})$/)?.slice(1).map(Number);
  if (!dateParts || !timeParts) return null;
  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }
  const result = getUtcMsForLocalTime({ year, month, day, hour, minute }, timezone);
  return Number.isFinite(result) ? result : null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const VALID_WEEKDAYS = new Set([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

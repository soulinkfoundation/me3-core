import Stripe from "stripe";
import { getUtcMsForLocalTime, resolveTimeZone } from "./calendar";
import { scheduleBookingRemindersForBooking } from "./booking-reminders";
import { getStripeSecretKey } from "./commerce-settings";
import { getPublicSiteOrigin } from "./sites";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import type { DbBooking, DbSite, Env } from "./types";
import { resolveBookingMeeting } from "./booking-meetings";

export type PaidBookingCheckoutBody = {
  offerId?: unknown;
  localDate?: unknown;
  localTime?: unknown;
  guestName?: unknown;
  guestEmail?: unknown;
  notes?: unknown;
  amount?: unknown;
  returnUrl?: unknown;
  pageId?: unknown;
  actionId?: unknown;
  campaign?: unknown;
};
export type FreeBookingBody = Omit<PaidBookingCheckoutBody, "returnUrl">;
export type PublicBookingConfirmBody = {
  offerId?: unknown;
  slotStart?: unknown;
  slotEnd?: unknown;
  guestName?: unknown;
  guestEmail?: unknown;
  notes?: unknown;
  paymentIntentId?: unknown;
  pageId?: unknown;
  actionId?: unknown;
  campaign?: unknown;
};
export type PaidBookingCompletionBody = {
  sessionId?: unknown;
};

export type CoreBookingPricing = {
  enabled?: boolean;
  suggestedAmount?: number;
  currency?: string;
  allowFree?: boolean;
  allowFlexiblePricing?: boolean;
  minimumAmount?: number;
  paymentMethod?: "stripe" | "manual";
  paymentInstructions?: string;
};
export type CoreBookingOffer = {
  id?: string;
  title?: string;
  description?: string;
  duration?: number;
  pricing?: CoreBookingPricing;
  meetingProvider?: "none" | "soulink" | "external";
  meetingUrl?: string;
};
export type CoreBookingAvailability = {
  timezone?: string;
  windows?: Record<string, string[]>;
};

export type CoreBookIntent = NonNullable<Me3SiteProfile["intents"]>["book"] & {
  bufferTime?: number;
  offers?: CoreBookingOffer[];
  availability?: CoreBookingAvailability;
  reminders?: {
    enabled?: boolean;
    reminder24h?: boolean;
    reminder2h?: boolean;
  };
  confirmationEmail?: {
    message?: string;
    sendHostCopy?: boolean;
  };
  bookingTypes?: Array<{
    type?: string;
    offers?: CoreBookingOffer[];
    availability?: CoreBookingAvailability;
  }>;
};
export type ResolvedOneToOneBookingOffer = {
  id: string;
  title: string;
  description?: string;
  duration: number;
  pricing?: CoreBookingPricing;
  meetingProvider?: "none" | "soulink" | "external";
  meetingUrl?: string;
  availability: CoreBookingAvailability;
};
export type ResolvedPaidBookingOffer = ResolvedOneToOneBookingOffer & {
  pricing: CoreBookingPricing;
};
export type BookingHoldRecord = {
  id: string;
  site_id: string;
  booking_id: string | null;
  offer_id: string | null;
  booking_type: "one_to_one" | "class" | "retreat";
  hold_token: string;
  slot_start: string;
  slot_end: string;
  status: "active" | "confirmed" | "released" | "expired";
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type SiteFileRecord = {
  site_id: string;
  path: string;
  content: ArrayBuffer | Uint8Array | number[] | Record<string, number>;
  content_type: string;
  size: number;
  sha256: string | null;
  updated_at: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getSiteByUsername(env: Env, rawUsername: string): Promise<DbSite | null> {
  const username = normalizeUsername(rawUsername);
  if (!username) return null;
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE username = ?`,
    )
      .bind(username)
      .first<DbSite>()) || null
  );
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function getSiteFile(env: Env, siteId: string, path: string): Promise<SiteFileRecord | null> {
  return (
    (await env.DB.prepare(
      `SELECT site_id, path, content, content_type, size, sha256, updated_at
       FROM site_files
       WHERE site_id = ? AND path = ?`,
    )
      .bind(siteId, path)
      .first<SiteFileRecord>()) || null
  );
}

async function getSiteFileText(env: Env, siteId: string, path: string): Promise<string | null> {
  const file = await getSiteFile(env, siteId, path);
  return file ? arrayBufferToText(file.content) : null;
}

function parseSiteProfile(meJson: string, username: string): Me3SiteProfile {
  try {
    const parsed = JSON.parse(meJson) as Me3SiteProfile;
    return {
      ...parsed,
      handle: parsed.handle || username,
      name: parsed.name || username,
    };
  } catch {
    return { version: "0.1", handle: username, name: username };
  }
}

function arrayBufferToText(content: SiteFileRecord["content"]): string {
  return new TextDecoder().decode(siteFileContentToBytes(content));
}

function siteFileContentToBytes(content: SiteFileRecord["content"]): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (Array.isArray(content)) return new Uint8Array(content);

  const values = Object.values(content);
  if (values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return new Uint8Array(values);
  }

  throw new TypeError("Unsupported site file content format");
}

export async function getStripe(env: Env, ownerId: string): Promise<Stripe | null> {
  const secretKey = await getStripeSecretKey(env, ownerId);
  if (!secretKey) return null;
  return new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
  });
}

export function normalizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function normalizeLongText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function normalizeEmail(value: unknown): string {
  const email = normalizeShortText(value, 254).toLowerCase();
  return EMAIL_REGEX.test(email) ? email : "";
}

export async function loadSiteProfileForCommerce(
  env: Env,
  site: DbSite,
): Promise<Me3SiteProfile | null> {
  const meJson =
    (await getSiteFileText(env, site.id, "src/me.json")) ||
    (await getSiteFileText(env, site.id, "public/me.json"));
  return meJson ? parseSiteProfile(meJson, site.username) : null;
}

export function resolveOneToOneBookingOffer(
  book: CoreBookIntent,
  offerId: string,
): ResolvedOneToOneBookingOffer | null {
  const offers = listOneToOneBookingOffers(book);
  const selected = offerId
    ? offers.find((offer) => offer.id === offerId)
    : offers[0];
  return selected || null;
}

export function listOneToOneBookingOffers(
  book: CoreBookIntent,
): ResolvedOneToOneBookingOffer[] {
  const oneToOneType = Array.isArray(book.bookingTypes)
    ? book.bookingTypes.find((type) => type?.type === "one_to_one")
    : null;
  const availability = oneToOneType?.availability || book.availability || {};
  const rawOffers =
    Array.isArray(oneToOneType?.offers) && oneToOneType.offers.length > 0
      ? oneToOneType.offers
      : Array.isArray(book.offers) && book.offers.length > 0
        ? book.offers
        : [
            {
              id: "book-session",
              title: book.title || "Book a session",
              duration: book.duration || 30,
              pricing: book.pricing as CoreBookingPricing | undefined,
            },
          ];

  return rawOffers.map((offer) => {
    const duration =
      typeof offer.duration === "number" && Number.isFinite(offer.duration)
        ? Math.max(15, Math.min(24 * 60, Math.round(offer.duration)))
        : typeof book.duration === "number" && Number.isFinite(book.duration)
        ? Math.max(15, Math.min(24 * 60, Math.round(book.duration)))
        : 30;

    return {
      id: offer.id || slugifyBookingOfferId(offer.title || "book-session") || "book-session",
      title: offer.title || book.title || "Book a session",
      ...(offer.description ? { description: offer.description } : {}),
      duration,
      pricing: offer.pricing,
      meetingProvider: offer.meetingProvider,
      meetingUrl: offer.meetingUrl,
      availability,
    };
  });
}

export function resolvePublicOneToOneBookingOffer(
  book: CoreBookIntent,
  offerId: string,
):
  | { offer: ResolvedOneToOneBookingOffer }
  | { error: string; status: 400 | 404 } {
  const offers = listOneToOneBookingOffers(book);
  if (offers.length === 0) return { error: "Booking offer not found", status: 404 };
  if (offers.length > 1 && !offerId) {
    return { error: "offerId is required when multiple booking offers exist", status: 400 };
  }

  const selected = offerId
    ? offers.find((offer) => offer.id === offerId)
    : offers[0];
  if (!selected) return { error: "Booking offer not found", status: 404 };
  return { offer: selected };
}

export function resolvePaidOneToOneOffer(
  book: CoreBookIntent,
  offerId: string,
): ResolvedPaidBookingOffer | null {
  const selected = resolveOneToOneBookingOffer(book, offerId);
  if (!selected?.pricing?.enabled) return null;
  if (selected.pricing.paymentMethod === "manual") return null;
  if (
    typeof selected.pricing.suggestedAmount !== "number" ||
    !Number.isFinite(selected.pricing.suggestedAmount) ||
    selected.pricing.suggestedAmount <= 0 ||
    !selected.pricing.currency
  ) {
    return null;
  }
  return selected as ResolvedPaidBookingOffer;
}

function slugifyBookingOfferId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function normalizeBookingAmount(
  value: unknown,
  pricing: CoreBookingPricing,
): { ok: true; amountCents: number; currency: string } | { ok: false; error: string } {
  const suggestedAmount = Number(pricing.suggestedAmount);
  const requestedAmount =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : suggestedAmount;

  if (!Number.isFinite(requestedAmount)) {
    return { ok: false, error: "Amount must be a valid number" };
  }

  if (pricing.allowFlexiblePricing === false && requestedAmount !== suggestedAmount) {
    return { ok: false, error: `Amount must be ${suggestedAmount} ${pricing.currency}` };
  }

  const minimumAmount =
    typeof pricing.minimumAmount === "number" && Number.isFinite(pricing.minimumAmount)
      ? pricing.minimumAmount
      : 5;
  if (requestedAmount < minimumAmount) {
    return { ok: false, error: `Minimum amount is ${minimumAmount} ${pricing.currency || "USD"}` };
  }

  return {
    ok: true,
    amountCents: Math.round(requestedAmount * 100),
    currency: String(pricing.currency || "USD").toLowerCase(),
  };
}

export function resolveBookingSlot(input: {
  localDate: string;
  localTime: string;
  durationMinutes: number;
  timezone: string;
}): { startsAt: string; endsAt: string; startsAtMs: number } | null {
  const dateMatch = input.localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = input.localTime.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const startsAtMs = getUtcMsForLocalTime(
    { year, month, day, hour, minute },
    input.timezone,
  );
  const endsAtMs = startsAtMs + input.durationMinutes * 60_000;
  return {
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    startsAtMs,
  };
}

export function resolvePublicBookingSlot(input: {
  slotStart: string;
  slotEnd: string;
  durationMinutes: number;
  timezone: string;
}):
  | {
      startsAt: string;
      endsAt: string;
      startsAtMs: number;
      localDate: string;
      localTime: string;
    }
  | { error: string } {
  const startsAtMs = Date.parse(input.slotStart);
  const endsAtMs = Date.parse(input.slotEnd);
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)) {
    return { error: "Invalid booking slot" };
  }
  if (endsAtMs <= startsAtMs) return { error: "slotEnd must be after slotStart" };
  if (endsAtMs - startsAtMs !== input.durationMinutes * 60_000) {
    return { error: "Booking slot duration does not match the selected offer" };
  }

  const local = formatUtcInstantInTimeZone(startsAtMs, input.timezone);
  if (!local) return { error: "Invalid booking slot timezone" };
  const resolved = resolveBookingSlot({
    localDate: local.localDate,
    localTime: local.localTime,
    durationMinutes: input.durationMinutes,
    timezone: input.timezone,
  });
  if (!resolved || resolved.startsAt !== new Date(startsAtMs).toISOString()) {
    return { error: "Booking slot does not match the selected timezone" };
  }

  return {
    startsAt: resolved.startsAt,
    endsAt: resolved.endsAt,
    startsAtMs: resolved.startsAtMs,
    localDate: local.localDate,
    localTime: local.localTime,
  };
}

export function formatUtcInstantInTimeZone(
  utcMs: number,
  timezone: string,
): { localDate: string; localTime: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcMs));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
    const year = part("year");
    const month = part("month");
    const day = part("day");
    const hour = part("hour");
    const minute = part("minute");
    if (!year || !month || !day || !hour || !minute) return null;
    return { localDate: `${year}-${month}-${day}`, localTime: `${hour}:${minute}` };
  } catch {
    return null;
  }
}

export async function generateAvailableBookingSlots(
  env: Env,
  input: {
    siteId: string;
    offer: ResolvedOneToOneBookingOffer;
    localDate: string;
    timezone: string;
  },
): Promise<
  Array<{
    slotStart: string;
    slotEnd: string;
    startsAt: string;
    endsAt: string;
    localDate: string;
    localTime: string;
  }>
> {
  const windows = input.offer.availability.windows || {};
  const weekday = weekdayForDate(input.localDate);
  if (!weekday) return [];
  const dayWindows = Array.isArray(windows[weekday]) ? windows[weekday] : [];
  const slots: Array<{
    slotStart: string;
    slotEnd: string;
    startsAt: string;
    endsAt: string;
    localDate: string;
    localTime: string;
  }> = [];

  for (const window of dayWindows) {
    const [windowStart, windowEnd] = String(window).split("-").map((part) => part.trim());
    const windowStartMinutes = timeToMinutes(windowStart);
    const windowEndMinutes = timeToMinutes(windowEnd);
    if (windowStartMinutes === null || windowEndMinutes === null) continue;

    for (
      let startMinutes = windowStartMinutes;
      startMinutes + input.offer.duration <= windowEndMinutes;
      startMinutes += 15
    ) {
      const localTime = minutesToTime(startMinutes);
      const slot = resolveBookingSlot({
        localDate: input.localDate,
        localTime,
        durationMinutes: input.offer.duration,
        timezone: input.timezone,
      });
      if (!slot || slot.startsAtMs <= Date.now() + 5 * 60_000) continue;

      const overlap = await findConfirmedBookingOverlap(env, {
        siteId: input.siteId,
        offerId: input.offer.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });
      if (overlap) continue;

      const activeHold = await findActiveBookingHoldOverlap(env, {
        siteId: input.siteId,
        offerId: input.offer.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });
      if (activeHold) continue;

      slots.push({
        slotStart: slot.startsAt,
        slotEnd: slot.endsAt,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        localDate: input.localDate,
        localTime,
      });
    }
  }

  return slots;
}

export function minutesToTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function serializePublicBookingOffer(offer: ResolvedOneToOneBookingOffer) {
  return {
    id: offer.id,
    title: offer.title,
    duration: offer.duration,
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

export async function createConfirmedOneToOneBooking(
  env: Env,
  input: {
    site: DbSite;
    bookIntent: CoreBookIntent;
    offer: ResolvedOneToOneBookingOffer;
    guestName: string;
    guestEmail: string;
    notes: string;
    slot: { startsAt: string; endsAt: string };
    pageId?: string;
    actionId?: string;
    campaign?: string;
    amountDueCents?: number;
    paymentCurrency?: string;
  },
): Promise<DbBooking | null> {
  const manualPayment =
    input.offer.pricing?.enabled === true &&
    input.offer.pricing.paymentMethod === "manual";
  const suggestedAmount = manualPayment
    ? input.amountDueCents ??
      Math.round(Number(input.offer.pricing?.suggestedAmount || 0) * 100)
    : null;
  const currency = manualPayment
    ? String(
        input.paymentCurrency || input.offer.pricing?.currency || "USD",
      ).toLowerCase()
    : null;
  const bookingId = crypto.randomUUID();
  const meeting = await resolveBookingMeeting(env, input.site.user_id, input.offer, bookingId, input.site.id, input.offer.id);
  await env.DB.prepare(
    `INSERT INTO bookings
     (id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
      duration_minutes, status, notes, created_at, payment_intent_id, amount_paid,
      suggested_amount, currency, payment_status, is_free_booking, paid_at,
      page_id, action_id, campaign, meeting_provider, meeting_url, meeting_host_url,
      meeting_guest_token_hash, meeting_title)
     VALUES (?, ?, ?, 'one_to_one', ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now'),
             NULL, NULL, ?, ?, 'not_required', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bookingId,
      input.site.id,
      input.offer.id,
      input.guestName,
      input.guestEmail,
      input.slot.startsAt,
      input.slot.endsAt,
      input.offer.duration,
      input.notes || null,
      suggestedAmount,
      currency,
      manualPayment ? 0 : 1,
      input.pageId || null,
      input.actionId || null,
      input.campaign || null,
      meeting.provider,
      meeting.guestUrl,
      meeting.hostUrl,
      meeting.guestTokenHash,
      input.offer.title,
    )
    .run();

  const booking = await env.DB.prepare(
    `SELECT id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
            duration_minutes, calendar_event_id, status, notes, created_at, cancelled_at,
            payment_intent_id, amount_paid, suggested_amount, currency, payment_status,
            is_free_booking, paid_at, meeting_provider, meeting_url, meeting_host_url,
            meeting_guest_token_hash, meeting_title
     FROM bookings
     WHERE id = ?`,
  )
    .bind(bookingId)
    .first<DbBooking>();

  if (booking) {
    scheduleBookingRemindersForBooking(env, {
      booking,
      bookingTitle: input.offer.title,
      timezone: resolveTimeZone(input.offer.availability.timezone),
      reminders: input.bookIntent.reminders,
    }).catch((error) => {
      console.error("Failed to schedule booking reminders:", error);
    });
  }

  return booking || null;
}

export function validateBookingAvailability(
  availability: CoreBookingAvailability,
  localDate: string,
  localTime: string,
  durationMinutes: number,
): string | null {
  const windows = availability.windows || {};
  const weekday = weekdayForDate(localDate);
  if (!weekday) return "Invalid booking date";
  const dayWindows = Array.isArray(windows[weekday]) ? windows[weekday] : [];
  if (dayWindows.length === 0) return "This date is not available for bookings";

  const startMinutes = timeToMinutes(localTime);
  if (startMinutes === null) return "Invalid booking time";
  const endMinutes = startMinutes + durationMinutes;

  for (const window of dayWindows) {
    const [windowStart, windowEnd] = String(window).split("-").map((part) => part.trim());
    const windowStartMinutes = timeToMinutes(windowStart);
    const windowEndMinutes = timeToMinutes(windowEnd);
    if (windowStartMinutes === null || windowEndMinutes === null) continue;
    if (startMinutes >= windowStartMinutes && endMinutes <= windowEndMinutes) {
      return null;
    }
  }

  return "That time is outside the published booking availability";
}

export function weekdayForDate(localDate: string): string | null {
  const match = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][weekdayIndex];
}

export function timeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export async function findConfirmedBookingOverlap(
  env: Env,
  input: { siteId: string; offerId: string; startsAt: string; endsAt: string },
): Promise<DbBooking | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
              duration_minutes, calendar_event_id, status, notes, created_at, cancelled_at,
              payment_intent_id, amount_paid, suggested_amount, currency, payment_status,
              is_free_booking, paid_at
       FROM bookings
       WHERE site_id = ?
         AND status = 'confirmed'
         AND (? IS NULL OR offer_id = ?)
         AND starts_at < ?
         AND ends_at > ?
       LIMIT 1`,
    )
      .bind(input.siteId, input.offerId, input.offerId, input.endsAt, input.startsAt)
      .first<DbBooking>()) || null
  );
}

export async function findActiveBookingHoldOverlap(
  env: Env,
  input: { siteId: string; offerId: string; startsAt: string; endsAt: string },
): Promise<BookingHoldRecord | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, site_id, booking_id, offer_id, booking_type, hold_token, slot_start, slot_end,
              status, expires_at, created_at, updated_at
       FROM booking_holds
       WHERE site_id = ?
         AND status = 'active'
         AND expires_at > datetime('now')
         AND (? IS NULL OR offer_id = ?)
         AND slot_start < ?
         AND slot_end > ?
       LIMIT 1`,
    )
      .bind(input.siteId, input.offerId, input.offerId, input.endsAt, input.startsAt)
      .first<BookingHoldRecord>()) || null
  );
}

export async function findActiveBookingHoldByToken(
  env: Env,
  holdToken: string,
): Promise<BookingHoldRecord | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, site_id, booking_id, offer_id, booking_type, hold_token, slot_start, slot_end,
              status, expires_at, created_at, updated_at
       FROM booking_holds
       WHERE hold_token = ?
         AND status = 'active'
         AND expires_at > datetime('now')`,
    )
      .bind(holdToken)
      .first<BookingHoldRecord>()) || null
  );
}

export async function createBookingHold(
  env: Env,
  input: {
    siteId: string;
    offerId: string;
    holdToken: string;
    startsAt: string;
    endsAt: string;
    expiresAt: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO booking_holds
     (id, site_id, booking_id, offer_id, booking_type, hold_token, slot_start, slot_end,
      status, expires_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'one_to_one', ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      crypto.randomUUID(),
      input.siteId,
      input.offerId,
      input.holdToken,
      input.startsAt,
      input.endsAt,
      input.expiresAt,
    )
    .run();
}

export async function releaseBookingHold(env: Env, holdToken: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE booking_holds
     SET status = 'released', updated_at = datetime('now')
     WHERE hold_token = ? AND status = 'active'`,
  )
    .bind(holdToken)
    .run();
}

export async function confirmBookingHold(
  env: Env,
  holdToken: string,
  bookingId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE booking_holds
     SET status = 'confirmed', booking_id = ?, updated_at = datetime('now')
     WHERE hold_token = ? AND status = 'active'`,
  )
    .bind(bookingId, holdToken)
    .run();
}

export function normalizeSiteCheckoutReturnUrl(
  value: unknown,
  requestUrl: string,
  env: Env,
  site: Pick<DbSite, "custom_domain" | "site_role" | "username">,
): string {
  const requestOrigin = new URL(requestUrl).origin;
  const publicOrigin = getPublicSiteOrigin(env, site);
  const publicPath = site.site_role === "organization"
    ? `/site/${encodeURIComponent(site.username)}/`
    : "/me/";
  const fallback = publicOrigin ? `${publicOrigin}/` : `${requestOrigin}${publicPath}`;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = new URL(value);
    // A managed custom domain is proxied to the installation. Trust the site's
    // configured origin, never a client-supplied forwarded-host header.
    if (
      (parsed.origin !== requestOrigin && parsed.origin !== publicOrigin) ||
      parsed.username || parsed.password
    ) return fallback;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export function appendQueryParams(url: string, params: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}");
}

export function serializeBooking(booking: DbBooking) {
  return {
    id: booking.id,
    offerId: booking.offer_id,
    bookingType: booking.booking_type || "one_to_one",
    guestName: booking.guest_name,
    guestEmail: booking.guest_email,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    durationMinutes: booking.duration_minutes,
    quantity: booking.quantity || 1,
    status: booking.status,
    notes: booking.notes,
    paymentStatus: booking.payment_status || "not_required",
    amountPaid: booking.amount_paid,
    currency: booking.currency,
    paidAt: booking.paid_at,
    meetingProvider: booking.meeting_provider || null,
    meetingUrl: booking.meeting_url || null,
  };
}

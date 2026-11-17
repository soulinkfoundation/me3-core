import { isAwaitingPayment, loadSiteProfileForCommerce, resolveOneToOneBookingOffer, serializeBooking, type CoreBookIntent } from "./booking";
import { getSiteById, sendConfirmationEmailsForBooking } from "./booking-checkout";
import { scheduleBookingRemindersForBooking } from "./booking-reminders";
import { resolveTimeZone } from "./calendar";
import { notifyConfirmedEventBooking, resolveEventBookingOffer } from "./event-booking";
import { getPayDirectlyHoldSettings } from "./commerce-settings";
import { ensurePaymentReference, holdState, listPaymentMethods, sqliteTimeMs, type HoldState } from "./pay-directly";
import type { PayDirectlyHoldSettings } from "../../../shared/pay-directly";
import { bookingDetailsFromBooking, getOwnerContact, sendBookingConfirmationEmails } from "./transactional-emails";
import type { DbBooking, DbSite, Env } from "./types";

// Confirming pay-directly bookings and events, and the list of everything still waiting to be paid.
// ME3 never moves or checks the money: a booking is paid only when its owner says so.

export class DirectPaymentError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "DirectPaymentError";
  }
}

const MAX_AMOUNT_CENTS = 100_000_000;

async function loadOwnerBooking(env: Env, ownerId: string, bookingId: string): Promise<DbBooking | null> {
  return env.DB.prepare(
    "SELECT b.* FROM bookings b JOIN sites s ON s.id = b.site_id WHERE b.id = ? AND s.user_id = ?",
  ).bind(bookingId, ownerId).first<DbBooking>();
}

/** Marked paid by the owner, as opposed to paid by card. */
export function isPaidDirectly(booking: Pick<DbBooking, "payment_status" | "payment_intent_id">): boolean {
  return booking.payment_status === "succeeded" && !booking.payment_intent_id;
}

/**
 * The owner says a held booking or event booking has been paid. The first call confirms it: the
 * guest gets the booked email with the join link, session reminders are scheduled, and the amount
 * counts as income. Later calls change nothing.
 */
export async function markBookingPaid(env: Env, ownerId: string, bookingId: string, input?: unknown) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const booking = await loadOwnerBooking(env, ownerId, bookingId);
  if (!booking) throw new DirectPaymentError("Booking not found.", 404);
  const alreadyPaid = async (paid: DbBooking) => ({
    ok: true as const,
    alreadyPaid: true,
    booking: serializeBooking(paid),
    reference: await ensurePaymentReference(env, ownerId, { bookingId: paid.id }),
  });
  if (booking.status === "confirmed" && isPaidDirectly(booking)) return alreadyPaid(booking);
  if (booking.status !== "confirmed") throw new DirectPaymentError("This booking was cancelled.", 409);
  if (!isAwaitingPayment(booking)) throw new DirectPaymentError("This booking is not waiting for payment.", 409);

  const amountCents = body.amountCents === undefined || body.amountCents === null ? Number(booking.suggested_amount) : body.amountCents;
  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    throw new DirectPaymentError("Enter the amount you received.", 400);
  }
  const methodId = typeof body.methodId === "string" && body.methodId.trim() ? body.methodId.trim() : null;
  const method = methodId ? (await listPaymentMethods(env, ownerId)).find((entry) => entry.id === methodId) : null;
  if (methodId && !method) throw new DirectPaymentError("That way to get paid was not found.", 400);

  const reference = await ensurePaymentReference(env, ownerId, { bookingId: booking.id });
  const flipped = await env.DB.prepare(
    `UPDATE bookings SET payment_status = 'succeeded', amount_paid = ?, paid_at = datetime('now')
     WHERE id = ? AND status = 'confirmed' AND payment_status = 'pending'`,
  ).bind(amountCents, booking.id).run();
  const paid = (await loadOwnerBooking(env, ownerId, booking.id)) || booking;
  if (!Number(flipped.meta?.changes || 0)) {
    // Another call got there first, or the booking was cancelled in between.
    if (paid.status === "confirmed" && isPaidDirectly(paid)) return alreadyPaid(paid);
    throw new DirectPaymentError("This booking is not waiting for payment.", 409);
  }
  if (method) {
    await env.DB.prepare("UPDATE commerce_direct_payments SET method_id = ?, method_kind = ? WHERE booking_id = ?")
      .bind(method.id, method.kind, booking.id).run();
  }
  await announcePaidBooking(env, paid).catch((error) => console.error("Booked email after a direct payment failed:", error));
  return { ok: true as const, alreadyPaid: false, booking: serializeBooking(paid), reference };
}

/** The booked email (with the join link) and the session reminders that were kept back while the booking was held. */
async function announcePaidBooking(env: Env, booking: DbBooking): Promise<void> {
  const site = await getSiteById(env, booking.site_id);
  if (!site) return;
  const profile = await loadSiteProfileForCommerce(env, site);
  const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
  if (booking.booking_type === "class" || booking.booking_type === "retreat") {
    const offer = bookIntent ? resolveEventBookingOffer(bookIntent, booking.booking_type, booking.offer_id || "") : null;
    if (bookIntent && offer) {
      await notifyConfirmedEventBooking(env, { site, bookIntent, offer, booking });
      return;
    }
    await sendBookedWithoutOffer(env, site, booking, profile?.name);
    return;
  }
  const offer = bookIntent && booking.offer_id ? resolveOneToOneBookingOffer(bookIntent, booking.offer_id) : null;
  const bookingTitle = offer?.title || booking.meeting_title || "Booking";
  const timezone = resolveTimeZone(offer?.availability.timezone);
  await scheduleBookingRemindersForBooking(env, { booking, bookingTitle, timezone, reminders: bookIntent?.reminders })
    .catch((error) => console.error("Failed to schedule booking reminders:", error));
  await sendConfirmationEmailsForBooking(env, { site, profile, booking, bookingTitle, timezone });
}

/** The event was taken off the site while this booking waited; the guest still gets their booked email. */
async function sendBookedWithoutOffer(env: Env, site: DbSite, booking: DbBooking, profileName?: string | null) {
  const owner = await getOwnerContact(env, site.user_id);
  const hostName = profileName || owner.name || site.username;
  const bookingTitle = booking.meeting_title || "Booking";
  const timezone = resolveTimeZone(undefined);
  await scheduleBookingRemindersForBooking(env, { booking, bookingTitle, timezone })
    .catch((error) => console.error("Failed to schedule booking reminders:", error));
  await sendBookingConfirmationEmails(env, bookingDetailsFromBooking({
    booking, ownerId: site.user_id, hostName, hostEmail: owner.email, siteName: hostName, bookingTitle, timezone,
  }));
}

export type WaitingPayment = {
  /** "order" is a product order; "booking" a one-to-one; "event" a class or retreat. */
  kind: "order" | "booking" | "event";
  id: string;
  reference: string;
  customerName: string;
  customerEmail: string;
  title: string;
  amountCents: number;
  currency: string;
  /** When the buyer ordered or booked, ISO 8601 UTC. */
  createdAt: string;
  saysPaidAt: string | null;
  remindedAt: string | null;
  bookingType: "one_to_one" | "class" | "retreat" | null;
  startsAt: string | null;
  quantity: number;
  /** When it is released if still unpaid. Null once the buyer says they paid: then only the owner releases it. */
  heldUntil: string | null;
  /** The owner has been warned that release is coming. */
  ownerWarnedAt: string | null;
  /** The buyer said they paid a while ago and it is still not marked paid: confirm it or release it. */
  needsDecision: boolean;
  /** Worth showing on Home: the buyer says they paid, or release is close. */
  needsYou: boolean;
};

/** A booking released for non-payment that can still be put back while its time is free. */
export type ReleasedBooking = {
  kind: "booking" | "event";
  id: string;
  reference: string;
  customerName: string;
  customerEmail: string;
  title: string;
  amountCents: number;
  currency: string;
  bookingType: "one_to_one" | "class" | "retreat";
  startsAt: string;
  quantity: number;
  releasedAt: string;
};

type WaitingRow = {
  kind: WaitingPayment["kind"];
  id: string;
  site_id: string;
  customer_name: string;
  customer_email: string;
  title: string;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
  booking_type: WaitingPayment["bookingType"];
  starts_at: string | null;
  quantity: number | null;
  reference: string | null;
  says_paid_at: string | null;
  reminded_at: string | null;
  pay_token: string | null;
  hold_started_at: string | null;
  owner_warned_at: string | null;
  owner_nudged_at: string | null;
};

/** One waiting order or booking with what the reminder and release job needs to act on it. */
export type WaitingHold = {
  item: WaitingPayment;
  state: HoldState;
  siteId: string;
  payToken: string | null;
  ownerNudgedAt: string | null;
};

function isoUtc(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

/** Everything the owner is still waiting to be paid for, longest wait first, with where each hold stands. */
export async function loadWaitingHolds(
  env: Env,
  ownerId: string,
  settings: PayDirectlyHoldSettings,
  nowMs = Date.now(),
): Promise<WaitingHold[]> {
  const rows = await env.DB.prepare(
    `SELECT 'order' AS kind, o.id AS id, o.site_id AS site_id, o.buyer_name AS customer_name, o.buyer_email AS customer_email,
            o.product_title AS title, o.amount_due AS amount_cents, o.currency AS currency,
            o.created_at AS created_at, NULL AS booking_type, NULL AS starts_at, 1 AS quantity,
            p.reference AS reference, p.says_paid_at AS says_paid_at, p.reminded_at AS reminded_at,
            p.pay_token AS pay_token, p.hold_started_at AS hold_started_at, p.owner_warned_at AS owner_warned_at,
            p.owner_nudged_at AS owner_nudged_at
     FROM commerce_orders o
     JOIN sites s ON s.id = o.site_id
     LEFT JOIN commerce_direct_payments p ON p.order_id = o.id
     WHERE s.user_id = ? AND o.payment_method = 'manual' AND o.status = 'pending'
     UNION ALL
     SELECT CASE WHEN b.booking_type IN ('class', 'retreat') THEN 'event' ELSE 'booking' END AS kind,
            b.id AS id, b.site_id AS site_id, b.guest_name AS customer_name, b.guest_email AS customer_email,
            COALESCE(b.meeting_title, CASE b.booking_type
              WHEN 'class' THEN 'Class booking' WHEN 'retreat' THEN 'Retreat booking' ELSE 'Booking' END) AS title,
            b.suggested_amount AS amount_cents, b.currency AS currency, b.created_at AS created_at,
            COALESCE(b.booking_type, 'one_to_one') AS booking_type, b.starts_at AS starts_at,
            COALESCE(b.quantity, 1) AS quantity,
            p.reference AS reference, p.says_paid_at AS says_paid_at, p.reminded_at AS reminded_at,
            p.pay_token AS pay_token, p.hold_started_at AS hold_started_at, p.owner_warned_at AS owner_warned_at,
            p.owner_nudged_at AS owner_nudged_at
     FROM bookings b
     JOIN sites s ON s.id = b.site_id
     LEFT JOIN commerce_direct_payments p ON p.booking_id = b.id
     WHERE s.user_id = ? AND b.status = 'confirmed' AND b.payment_status = 'pending'
     ORDER BY created_at ASC, id ASC`,
  ).bind(ownerId, ownerId).all<WaitingRow>();

  const holds: WaitingHold[] = [];
  for (const row of rows.results || []) {
    const state = holdState(row, settings, nowMs);
    const needsDecision = state.paused && state.decideAtMs !== null && nowMs >= state.decideAtMs;
    holds.push({
      state,
      siteId: row.site_id,
      payToken: row.pay_token,
      ownerNudgedAt: row.owner_nudged_at,
      item: {
        kind: row.kind,
        id: row.id,
        // Orders from before saved payment methods have no reference yet.
        reference: row.reference
          || await ensurePaymentReference(env, ownerId, row.kind === "order" ? { orderId: row.id } : { bookingId: row.id }),
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        title: row.title,
        amountCents: Number(row.amount_cents || 0),
        currency: String(row.currency || "USD").toUpperCase(),
        createdAt: isoUtc(row.created_at) || row.created_at,
        saysPaidAt: isoUtc(row.says_paid_at),
        remindedAt: isoUtc(row.reminded_at),
        bookingType: row.booking_type,
        startsAt: row.starts_at,
        quantity: Number(row.quantity || 1),
        heldUntil: state.paused ? null : new Date(state.releaseAtMs).toISOString(),
        ownerWarnedAt: (sqliteTimeMs(row.owner_warned_at) ?? 0) >= (sqliteTimeMs(row.hold_started_at) ?? 0) ? isoUtc(row.owner_warned_at) : null,
        needsDecision,
        needsYou: state.paused || nowMs >= state.warnOwnerAtMs,
      },
    });
  }
  return holds;
}

/** Bookings released for non-payment in the last 30 days that have not started yet. */
async function listReleasedBookings(env: Env, ownerId: string, nowMs: number): Promise<ReleasedBooking[]> {
  const rows = await env.DB.prepare(
    `SELECT b.id AS id, b.booking_type AS booking_type, b.guest_name AS customer_name, b.guest_email AS customer_email,
            b.meeting_title AS title, b.suggested_amount AS amount_cents, b.currency AS currency, b.starts_at AS starts_at,
            COALESCE(b.quantity, 1) AS quantity, p.reference AS reference, p.released_at AS released_at
     FROM bookings b
     JOIN sites s ON s.id = b.site_id
     JOIN commerce_direct_payments p ON p.booking_id = b.id
     WHERE s.user_id = ? AND b.status = 'cancelled' AND b.payment_status = 'failed'
       AND p.released_at IS NOT NULL AND b.starts_at > ?
     ORDER BY p.released_at DESC LIMIT 20`,
  ).bind(ownerId, new Date(nowMs).toISOString()).all<{
    id: string; booking_type: ReleasedBooking["bookingType"] | null; customer_name: string; customer_email: string;
    title: string | null; amount_cents: number | null; currency: string | null; starts_at: string; quantity: number;
    reference: string; released_at: string;
  }>().catch(() => ({ results: [] }));
  return (rows.results || [])
    .filter((row) => nowMs - (sqliteTimeMs(row.released_at) ?? 0) < 30 * 86_400_000)
    .map((row) => {
      const bookingType = row.booking_type || "one_to_one";
      return {
        kind: bookingType === "one_to_one" ? "booking" as const : "event" as const,
        id: row.id,
        reference: row.reference,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        title: row.title || "Booking",
        amountCents: Number(row.amount_cents || 0),
        currency: String(row.currency || "USD").toUpperCase(),
        bookingType,
        startsAt: row.starts_at,
        quantity: Number(row.quantity || 1),
        releasedAt: isoUtc(row.released_at) || row.released_at,
      };
    });
}

/** Accounts -> Waiting: what is unpaid, what was released and can be restored, and the owner's two settings. */
export async function listWaitingPayments(env: Env, ownerId: string, now = new Date()): Promise<{
  ok: true;
  waiting: WaitingPayment[];
  released: ReleasedBooking[];
  settings: PayDirectlyHoldSettings;
}> {
  const settings = await getPayDirectlyHoldSettings(env, ownerId);
  const holds = await loadWaitingHolds(env, ownerId, settings, now.getTime());
  return { ok: true, waiting: holds.map((hold) => hold.item), released: await listReleasedBookings(env, ownerId, now.getTime()), settings };
}

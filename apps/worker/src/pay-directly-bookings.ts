import { isAwaitingPayment, loadSiteProfileForCommerce, resolveOneToOneBookingOffer, serializeBooking, type CoreBookIntent } from "./booking";
import { getSiteById, sendConfirmationEmailsForBooking } from "./booking-checkout";
import { scheduleBookingRemindersForBooking } from "./booking-reminders";
import { resolveTimeZone } from "./calendar";
import { notifyConfirmedEventBooking, resolveEventBookingOffer } from "./event-booking";
import { ensurePaymentReference, listPaymentMethods } from "./pay-directly";
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
};

type WaitingRow = {
  kind: WaitingPayment["kind"];
  id: string;
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
};

function isoUtc(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

/** Everything the owner is still waiting to be paid for, longest wait first. */
export async function listWaitingPayments(env: Env, ownerId: string): Promise<{ ok: true; waiting: WaitingPayment[] }> {
  const rows = await env.DB.prepare(
    `SELECT 'order' AS kind, o.id AS id, o.buyer_name AS customer_name, o.buyer_email AS customer_email,
            o.product_title AS title, o.amount_due AS amount_cents, o.currency AS currency,
            o.created_at AS created_at, NULL AS booking_type, NULL AS starts_at, 1 AS quantity,
            p.reference AS reference, p.says_paid_at AS says_paid_at, p.reminded_at AS reminded_at
     FROM commerce_orders o
     JOIN sites s ON s.id = o.site_id
     LEFT JOIN commerce_direct_payments p ON p.order_id = o.id
     WHERE s.user_id = ? AND o.payment_method = 'manual' AND o.status = 'pending'
     UNION ALL
     SELECT CASE WHEN b.booking_type IN ('class', 'retreat') THEN 'event' ELSE 'booking' END AS kind,
            b.id AS id, b.guest_name AS customer_name, b.guest_email AS customer_email,
            COALESCE(b.meeting_title, CASE b.booking_type
              WHEN 'class' THEN 'Class booking' WHEN 'retreat' THEN 'Retreat booking' ELSE 'Booking' END) AS title,
            b.suggested_amount AS amount_cents, b.currency AS currency, b.created_at AS created_at,
            COALESCE(b.booking_type, 'one_to_one') AS booking_type, b.starts_at AS starts_at,
            COALESCE(b.quantity, 1) AS quantity,
            p.reference AS reference, p.says_paid_at AS says_paid_at, p.reminded_at AS reminded_at
     FROM bookings b
     JOIN sites s ON s.id = b.site_id
     LEFT JOIN commerce_direct_payments p ON p.booking_id = b.id
     WHERE s.user_id = ? AND b.status = 'confirmed' AND b.payment_status = 'pending'
     ORDER BY created_at ASC, id ASC`,
  ).bind(ownerId, ownerId).all<WaitingRow>();

  const waiting: WaitingPayment[] = [];
  for (const row of rows.results || []) {
    waiting.push({
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
    });
  }
  return { ok: true, waiting };
}

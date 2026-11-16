import { resolveTimeZone } from "./calendar";
import { loadSiteProfileForCommerce, resolveOneToOneBookingOffer, serializeBooking, type CoreBookIntent } from "./booking";
import { deleteFinancialEntry, syncWebsiteIncomeEntries } from "./accounts";
import { getSiteById } from "./booking-checkout";
import { cancelPendingBookingReminders, scheduleBookingRemindersForBooking } from "./booking-reminders";
import { bookingDetailsFromBooking, getOwnerContact, sendGuestBookingChangeEmail } from "./transactional-emails";
import type { DbBooking, Env } from "./types";

export class BookingChangeError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409) { super(message); }
}

const BOOKING_COLUMNS = `b.id, b.site_id, b.offer_id, b.booking_type, b.guest_name, b.guest_email, b.starts_at, b.ends_at,
  b.duration_minutes, b.calendar_event_id, b.status, b.notes, b.created_at, b.cancelled_at,
  b.payment_intent_id, b.amount_paid, b.suggested_amount, b.currency, b.payment_status,
  b.is_free_booking, b.paid_at, b.meeting_provider, b.meeting_url, b.meeting_host_url,
  b.meeting_guest_token_hash, b.meeting_title`;

async function loadOwnerBooking(env: Env, ownerId: string, bookingId: string): Promise<DbBooking> {
  const booking = await env.DB.prepare(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN sites s ON s.id = b.site_id WHERE b.id = ? AND s.user_id = ?`,
  ).bind(bookingId, ownerId).first<DbBooking>();
  if (!booking) throw new BookingChangeError("Booking not found", 404);
  if (booking.status !== "confirmed") throw new BookingChangeError("This booking is no longer confirmed", 409);
  return booking;
}

async function bookingContext(env: Env, booking: DbBooking) {
  const site = await getSiteById(env, booking.site_id);
  if (!site) throw new BookingChangeError("Booking not found", 404);
  const profile = await loadSiteProfileForCommerce(env, site);
  const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
  const offer = bookIntent ? resolveOneToOneBookingOffer(bookIntent, booking.offer_id || "") : null;
  const owner = await getOwnerContact(env, site.user_id);
  return {
    site, bookIntent,
    title: booking.meeting_title || offer?.title || "Booking",
    timezone: resolveTimeZone(offer?.availability.timezone),
    hostName: profile?.name || owner.name || site.username,
    hostEmail: owner.email,
  };
}

async function emailGuest(env: Env, booking: DbBooking, context: Awaited<ReturnType<typeof bookingContext>>,
  change: "rescheduled" | "cancelled", previousStartsAt?: string) {
  // A booking still waiting for payment has not been given its join link.
  const awaitingPayment = booking.payment_status === "pending";
  if (awaitingPayment) booking = { ...booking, meeting_url: null, meeting_host_url: null };
  const result = await sendGuestBookingChangeEmail(env, {
    awaitingPayment,
    ...bookingDetailsFromBooking({ booking, ownerId: context.site.user_id, hostName: context.hostName, hostEmail: context.hostEmail,
      bookingTitle: context.title, timezone: context.timezone }),
    change, previousStartsAt,
  });
  if (result.status === "failed") console.error(`Booking ${change} email failed`, result.error);
  return result.status;
}

/** What the owner needs to know after cancelling a booking they had marked paid. ME3 never refunds. */
export type CancelledDirectPayment = {
  paidDirectly: true;
  amountCents: number;
  currency: string;
  /** The Accounts income entry that can still be removed (DELETE /api/accounts/entries/:id). */
  incomeEntryId: string | null;
  incomeReversed: boolean;
  message: string;
};

function formatMoney(amountCents: number, currency: string): string {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountCents / 100); }
  catch { return `${(amountCents / 100).toFixed(2)} ${currency}`; }
}

async function settleCancelledDirectPayment(env: Env, ownerId: string, booking: DbBooking, reverseIncome: boolean): Promise<CancelledDirectPayment> {
  const amountCents = Number(booking.amount_paid);
  const currency = String(booking.currency || "USD").toUpperCase();
  const entry = await env.DB.prepare("SELECT id FROM financial_entries WHERE user_id = ? AND source_ref = ?")
    .bind(ownerId, `website:booking:${booking.id}`).first<{ id: string }>().catch(() => null);
  if (entry && reverseIncome) await deleteFinancialEntry(env, ownerId, entry.id);
  const guest = booking.guest_name.trim() || "the guest";
  return {
    paidDirectly: true,
    amountCents,
    currency,
    incomeEntryId: reverseIncome ? null : entry?.id || null,
    incomeReversed: reverseIncome,
    message: `ME3 does not move money. ${guest} paid you ${formatMoney(amountCents, currency)} directly, so refund ${guest} yourself if they are due it back.`,
  };
}

/** Cancels a confirmed booking: its Soulink guest link stops working and the guest is emailed. A held
 * pay-directly booking frees its slot; one already marked paid comes back with the refund note in `payment`. */
export async function cancelOwnerBooking(env: Env, ownerId: string, bookingId: string, options: { reverseIncome?: boolean } = {}) {
  const booking = await loadOwnerBooking(env, ownerId, bookingId);
  const paidDirectly = booking.payment_status === "succeeded" && !booking.payment_intent_id && Number(booking.amount_paid) > 0;
  // Website income reaches Accounts when Accounts is next opened, and only for confirmed bookings.
  // Record it before cancelling so money the owner did receive is not silently dropped.
  if (paidDirectly) await syncWebsiteIncomeEntries(env, ownerId).catch((error) => console.error("Income sync before cancelling failed:", error));
  const changed = await env.DB.prepare(
    "UPDATE bookings SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed'",
  ).bind(booking.id).run();
  if (!changed.meta?.changes) throw new BookingChangeError("This booking is no longer confirmed", 409);
  await cancelPendingBookingReminders(env, booking.id);
  const cancelled: DbBooking = { ...booking, status: "cancelled" };
  const guestEmail = await emailGuest(env, cancelled, await bookingContext(env, booking), "cancelled");
  const payment = paidDirectly ? await settleCancelledDirectPayment(env, ownerId, booking, options.reverseIncome === true) : null;
  return { booking: serializeBooking(cancelled), guestEmail, payment };
}

/** Moves a confirmed one-to-one booking in place. The booking keeps its id and guest token, so the guest's
 * existing join link (including a Soulink booking call link) keeps working at the new time. */
export async function rescheduleOwnerBooking(env: Env, ownerId: string, bookingId: string, rawStartsAt: unknown) {
  const startsMs = typeof rawStartsAt === "string" && rawStartsAt.length <= 40 ? Date.parse(rawStartsAt) : Number.NaN;
  if (!Number.isFinite(startsMs)) throw new BookingChangeError("Choose a valid new start time", 400);
  if (startsMs <= Date.now()) throw new BookingChangeError("Choose a time in the future", 400);
  const booking = await loadOwnerBooking(env, ownerId, bookingId);
  if (booking.booking_type !== "one_to_one") throw new BookingChangeError("Only one-to-one bookings can be moved", 400);
  const duration = Date.parse(booking.ends_at) - Date.parse(booking.starts_at);
  const startsAt = new Date(startsMs).toISOString();
  const endsAt = new Date(startsMs + (Number.isFinite(duration) && duration > 0 ? duration : booking.duration_minutes * 60_000)).toISOString();
  if (startsAt === new Date(Date.parse(booking.starts_at)).toISOString()) return { booking: serializeBooking(booking), guestEmail: "skipped" as const };
  const overlap = await env.DB.prepare(
    `SELECT id FROM bookings WHERE site_id = ? AND id <> ? AND status = 'confirmed' AND starts_at < ? AND ends_at > ? LIMIT 1`,
  ).bind(booking.site_id, booking.id, endsAt, startsAt).first<{ id: string }>();
  if (overlap) throw new BookingChangeError("Another booking already uses that time", 409);
  const changed = await env.DB.prepare(
    "UPDATE bookings SET starts_at = ?, ends_at = ? WHERE id = ? AND status = 'confirmed'",
  ).bind(startsAt, endsAt, booking.id).run();
  if (!changed.meta?.changes) throw new BookingChangeError("This booking is no longer confirmed", 409);
  const moved = { ...booking, starts_at: startsAt, ends_at: endsAt };
  const context = await bookingContext(env, booking);
  // Reminders are unique per booking, type and channel; clear the old plan so the new time gets its own.
  await env.DB.prepare("DELETE FROM booking_reminders WHERE booking_id = ? AND status <> 'processing'").bind(booking.id).run();
  await scheduleBookingRemindersForBooking(env, { booking: moved, bookingTitle: context.title, timezone: context.timezone,
    reminders: context.bookIntent?.reminders }).catch((error) => console.error("Failed to reschedule booking reminders:", error));
  const guestEmail = await emailGuest(env, moved, context, "rescheduled", booking.starts_at);
  return { booking: serializeBooking(moved), guestEmail };
}

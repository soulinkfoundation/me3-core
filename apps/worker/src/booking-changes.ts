import { resolveTimeZone } from "./calendar";
import { loadSiteProfileForCommerce, resolveOneToOneBookingOffer, serializeBooking, type CoreBookIntent } from "./booking";
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
  const result = await sendGuestBookingChangeEmail(env, {
    ...bookingDetailsFromBooking({ booking, ownerId: context.site.user_id, hostName: context.hostName, hostEmail: context.hostEmail,
      bookingTitle: context.title, timezone: context.timezone }),
    change, previousStartsAt,
  });
  if (result.status === "failed") console.error(`Booking ${change} email failed`, result.error);
  return result.status;
}

/** Cancels a confirmed booking: its Soulink guest link stops working and the guest is emailed. */
export async function cancelOwnerBooking(env: Env, ownerId: string, bookingId: string) {
  const booking = await loadOwnerBooking(env, ownerId, bookingId);
  const changed = await env.DB.prepare(
    "UPDATE bookings SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed'",
  ).bind(booking.id).run();
  if (!changed.meta?.changes) throw new BookingChangeError("This booking is no longer confirmed", 409);
  await cancelPendingBookingReminders(env, booking.id);
  const cancelled: DbBooking = { ...booking, status: "cancelled" };
  const guestEmail = await emailGuest(env, cancelled, await bookingContext(env, booking), "cancelled");
  return { booking: serializeBooking(cancelled), guestEmail };
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

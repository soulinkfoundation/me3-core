import type Stripe from "stripe";
import { resolveTimeZone } from "./calendar";
import { scheduleBookingRemindersForBooking } from "./booking-reminders";
import {
  appendQueryParams,
  claimOneToOneBookingHold,
  confirmBookingHold,
  createConfirmedOneToOneBooking,
  findActiveBookingHoldByToken,
  findActiveBookingHoldOverlap,
  findConfirmedBookingOverlap,
  getStripe,
  loadSiteProfileForCommerce,
  normalizeLongText,
  releaseBookingHold,
  resolveOneToOneBookingOffer,
  serializeBooking,
  validateBookingAvailability,
  type CoreBookIntent,
  type ResolvedOneToOneBookingOffer,
  type ResolvedPaidBookingOffer,
} from "./booking";
import { BookingMeetingError, resolveBookingMeeting } from "./booking-meetings";
import { getManagedCommerceBridgeConfig } from "./commerce-bridge";
import { isCommerceReady } from "./commerce-settings";
import { dispatchWebsitePaymentNotification } from "./payment-notifications";
import {
  bookingDetailsFromBooking,
  getOwnerContact,
  sendBookingConfirmationEmails,
} from "./transactional-emails";
import type { DbBooking, DbSite, Env } from "./types";

// One-to-one booking checkout shared by the site's own booking pages and the
// agent commerce API. Routes parse input; these functions own the rules.

export const BOOKING_PAYMENTS_UNAVAILABLE_MESSAGE =
  "Payments are not available for this booking right now. Please contact the site owner.";

export type BookingCheckoutFailure = {
  ok: false;
  error: string;
  status: 400 | 404 | 409 | 503;
};

export type BookingSlot = {
  startsAt: string;
  endsAt: string;
  startsAtMs: number;
  localDate: string;
  localTime: string;
};

export type CheckoutProvider =
  | { kind: "stripe_direct"; stripe: Stripe }
  | { kind: "me3_cloud"; stripe: null };

export async function resolveCheckoutProvider(
  env: Env,
  ownerId: string,
): Promise<CheckoutProvider | null> {
  const stripe = await getStripe(env, ownerId);
  if (stripe) return { kind: "stripe_direct", stripe };
  return (await isCommerceReady(env, ownerId)) ? { kind: "me3_cloud", stripe: null } : null;
}

function failure(error: string, status: BookingCheckoutFailure["status"]): BookingCheckoutFailure {
  return { ok: false, error, status };
}

export async function checkOneToOneSlotBookable(
  env: Env,
  input: { siteId: string; offer: ResolvedOneToOneBookingOffer; slot: BookingSlot },
): Promise<BookingCheckoutFailure | null> {
  const { offer, slot } = input;
  if (slot.startsAtMs <= Date.now() + 5 * 60_000) {
    return failure("Choose a future booking time", 400);
  }
  const availabilityError = validateBookingAvailability(
    offer.availability,
    slot.localDate,
    slot.localTime,
    offer.duration,
  );
  if (availabilityError) return failure(availabilityError, 400);

  const range = { siteId: input.siteId, offerId: offer.id, startsAt: slot.startsAt, endsAt: slot.endsAt };
  if (await findConfirmedBookingOverlap(env, range)) {
    return failure("That time has already been booked", 409);
  }
  if (await findActiveBookingHoldOverlap(env, range)) {
    return failure(SLOT_HELD_MESSAGE, 409);
  }
  return null;
}

const SLOT_HELD_MESSAGE =
  "That time is being held for another checkout. Try another slot or check back shortly.";

export async function bookFreeOneToOne(
  env: Env,
  input: {
    site: DbSite;
    profile: Awaited<ReturnType<typeof loadSiteProfileForCommerce>>;
    bookIntent: CoreBookIntent;
    offer: ResolvedOneToOneBookingOffer;
    slot: BookingSlot;
    guestName: string;
    guestEmail: string;
    notes: string;
    pageId?: string;
    actionId?: string;
    campaign?: string;
    amountDueCents?: number;
    paymentCurrency?: string;
  },
): Promise<{ ok: true; booking: DbBooking | null } | BookingCheckoutFailure> {
  const unavailable = await checkOneToOneSlotBookable(env, {
    siteId: input.site.id,
    offer: input.offer,
    slot: input.slot,
  });
  if (unavailable) return unavailable;

  const booking = await createConfirmedOneToOneBooking(env, {
    site: input.site,
    bookIntent: input.bookIntent,
    offer: input.offer,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    notes: input.notes,
    slot: input.slot,
    pageId: input.pageId,
    actionId: input.actionId,
    campaign: input.campaign,
    amountDueCents: input.amountDueCents,
    paymentCurrency: input.paymentCurrency,
  }).catch((error) => {
    if (error instanceof BookingMeetingError) return error;
    throw error;
  });
  if (booking instanceof BookingMeetingError) return failure(booking.message, 409);

  if (booking) {
    await sendConfirmationEmailsForBooking(env, {
      site: input.site,
      profile: input.profile,
      booking,
      bookingTitle: input.offer.title,
      timezone: resolveTimeZone(input.offer.availability.timezone),
      paymentInstructions:
        input.offer.pricing?.paymentMethod === "manual"
          ? input.offer.pricing.paymentInstructions
          : null,
    });
    await dispatchWebsitePaymentNotification(env, input.site.user_id, {
      sourceKind: "booking",
      sourceId: booking.id,
      amountCents: 0,
      currency: String(booking.currency || "USD").toUpperCase(),
      customerName: booking.guest_name?.trim() || null,
      itemTitle: input.offer.title,
      siteName: input.site.username,
    }).catch((error) => console.error("Free booking notification failed", error));
  }
  return { ok: true, booking };
}

export async function startPaidOneToOneCheckout(
  env: Env,
  input: {
    site: DbSite;
    provider: CheckoutProvider;
    offer: ResolvedPaidBookingOffer;
    amount: { amountCents: number; currency: string };
    slot: BookingSlot;
    guestName: string;
    guestEmail: string;
    notes: string;
    pageId: string;
    actionId: string;
    campaign: string;
    returnUrl: string;
    holdExpiresAt: string;
    /** Direct Stripe Checkout expiry; Stripe requires 30 minutes to 24 hours. */
    sessionExpiresAtSeconds: number;
    /** Sent to managed commerce only when set; ME3 Cloud otherwise applies its default. */
    managedSessionExpiresAt?: string;
  },
): Promise<
  | { ok: true; url: string | null; sessionId: string; holdToken: string }
  | BookingCheckoutFailure
> {
  const { site, offer, slot } = input;
  const unavailable = await checkOneToOneSlotBookable(env, { siteId: site.id, offer, slot });
  if (unavailable) return unavailable;

  const holdToken = crypto.randomUUID();
  const held = await claimOneToOneBookingHold(env, {
    siteId: site.id,
    offerId: offer.id,
    holdToken,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    expiresAt: input.holdExpiresAt,
  });
  if (!held) return failure(SLOT_HELD_MESSAGE, 409);

  const successUrl = appendQueryParams(input.returnUrl, {
    booking: "success",
    session_id: "{CHECKOUT_SESSION_ID}",
  });
  const cancelUrl = appendQueryParams(input.returnUrl, { booking: "cancelled" });

  try {
    const metadata = {
      purchase_kind: "booking",
      site_id: site.id,
      offer_id: offer.id,
      booking_type: "one_to_one",
      hold_token: holdToken,
      guest_name: input.guestName,
      guest_email: input.guestEmail,
      notes: input.notes,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      duration_minutes: String(offer.duration),
      page_id: input.pageId,
      action_id: input.actionId,
      campaign: input.campaign,
    };
    const session = input.provider.stripe
      ? await input.provider.stripe.checkout.sessions.create({
          mode: "payment",
          customer_email: input.guestEmail,
          line_items: [
            {
              price_data: {
                currency: input.amount.currency,
                product_data: {
                  name: offer.title,
                  description: `${slot.localDate} ${slot.localTime} (${offer.duration} minutes)`,
                },
                unit_amount: input.amount.amountCents,
              },
              quantity: 1,
            },
          ],
          payment_intent_data: { metadata },
          metadata,
          success_url: successUrl,
          cancel_url: cancelUrl,
          expires_at: input.sessionExpiresAtSeconds,
        })
      : await createManagedBookingCheckout(env, {
          site,
          offerTitle: offer.title,
          amount: input.amount.amountCents,
          currency: input.amount.currency,
          customerName: input.guestName,
          customerEmail: input.guestEmail,
          metadata,
          returnUrl: input.returnUrl,
          expiresAt: input.managedSessionExpiresAt,
        });

    return { ok: true, url: session.url, sessionId: session.id, holdToken };
  } catch (error) {
    await releaseBookingHold(env, holdToken);
    console.error("Paid booking checkout failed:", error);
    return failure(BOOKING_PAYMENTS_UNAVAILABLE_MESSAGE, 503);
  }
}

export async function finalizePaidBookingCheckout(
  env: Env,
  site: DbSite,
  session: Stripe.Checkout.Session,
): Promise<
  | { ok: true; booking: ReturnType<typeof serializeBooking> | { id: string }; alreadyCompleted?: true }
  | { error: string; status: number }
> {
  if (session.payment_status !== "paid") {
    return { error: "Payment has not completed yet", status: 400 };
  }

  const metadata = session.metadata || {};
  if (metadata.purchase_kind !== "booking" || metadata.site_id !== site.id) {
    return { error: "Checkout session does not match this site", status: 400 };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  if (!paymentIntentId) return { error: "Stripe payment intent missing from session", status: 400 };

  const existing = await env.DB.prepare(bookingSelectSql("WHERE payment_intent_id = ?"))
    .bind(paymentIntentId)
    .first<DbBooking>();
  if (existing) {
    return { ok: true, booking: serializeBooking(existing), alreadyCompleted: true };
  }

  const offerId = metadata.offer_id || null;
  const startsAt = metadata.starts_at || "";
  const endsAt = metadata.ends_at || "";
  const durationMinutes = Number(metadata.duration_minutes || 0);
  const guestName = metadata.guest_name || "";
  const guestEmail = metadata.guest_email || "";
  const notes = metadata.notes || "";
  const holdToken = metadata.hold_token || "";

  if (!offerId || !startsAt || !endsAt || !durationMinutes || !guestName || !guestEmail || !holdToken) {
    return { error: "Checkout session is missing booking details", status: 400 };
  }

  const hold = await findActiveBookingHoldByToken(env, holdToken);
  if (!hold || hold.site_id !== site.id || hold.offer_id !== offerId || hold.slot_start !== startsAt || hold.slot_end !== endsAt) {
    return {
      error: "Booking hold expired. Payment succeeded, but the booking was not confirmed automatically.",
      status: 409,
    };
  }

  const overlap = await findConfirmedBookingOverlap(env, {
    siteId: site.id,
    offerId,
    startsAt,
    endsAt,
  });
  if (overlap) {
    await releaseBookingHold(env, holdToken);
    return {
      error: "That time has already been booked. Payment succeeded, but the booking was not confirmed automatically.",
      status: 409,
    };
  }

  const bookingId = crypto.randomUUID();
  const profile = await loadSiteProfileForCommerce(env, site);
  const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
  const offer = bookIntent ? resolveOneToOneBookingOffer(bookIntent, offerId) : null;
  if (!offer) return { error: "Booking offer is no longer available", status: 409 };
  const meeting = await resolveBookingMeeting(env, site.user_id, offer, bookingId, site.id, offer.id).catch((error) => {
    if (error instanceof BookingMeetingError) return error;
    throw error;
  });
  if (meeting instanceof BookingMeetingError) return { error: meeting.message, status: 409 };
  await env.DB.prepare(
    `INSERT INTO bookings
     (id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
      duration_minutes, status, notes, created_at, payment_intent_id, amount_paid,
      suggested_amount, currency, payment_status, is_free_booking, paid_at,
      page_id, action_id, campaign, meeting_provider, meeting_url, meeting_host_url,
      meeting_guest_token_hash, meeting_title)
     VALUES (?, ?, ?, 'one_to_one', ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now'),
             ?, ?, ?, ?, 'succeeded', 0, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bookingId,
      site.id,
      offerId,
      guestName,
      guestEmail,
      startsAt,
      endsAt,
      durationMinutes,
      notes || null,
      paymentIntentId,
      session.amount_total || null,
      session.amount_subtotal || session.amount_total || null,
      session.currency || null,
      metadata.page_id || null,
      metadata.action_id || null,
      metadata.campaign || null,
      meeting.provider,
      meeting.guestUrl,
      meeting.hostUrl,
      meeting.guestTokenHash,
      offer.title,
    )
    .run();

  await confirmBookingHold(env, holdToken, bookingId);

  const booking = await env.DB.prepare(bookingSelectSql("WHERE id = ?"))
    .bind(bookingId)
    .first<DbBooking>();
  if (!booking) return { ok: true, booking: { id: bookingId } as ReturnType<typeof serializeBooking> };

  const timezone = resolveTimeZone(offer?.availability.timezone);
  scheduleBookingRemindersForBooking(env, {
    booking,
    bookingTitle: offer?.title || "Book a session",
    timezone,
    reminders: bookIntent?.reminders,
  }).catch((error) => {
    console.error("Failed to schedule booking reminders:", error);
  });
  await sendConfirmationEmailsForBooking(env, {
    site,
    profile,
    booking,
    bookingTitle: offer?.title || "Book a session",
    timezone,
  });

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

export async function sendConfirmationEmailsForBooking(
  env: Env,
  input: {
    site: DbSite;
    profile: Awaited<ReturnType<typeof loadSiteProfileForCommerce>>;
    booking: DbBooking;
    bookingTitle: string;
    timezone: string;
    paymentInstructions?: string | null;
  },
) {
  const owner = await getOwnerContact(env, input.site.user_id);
  const bookIntent = input.profile?.intents?.book as CoreBookIntent | undefined;
  const confirmationEmail = bookIntent?.confirmationEmail;
  const hostName = input.profile?.name || owner.name || input.site.username;
  const result = await sendBookingConfirmationEmails(
    env,
    bookingDetailsFromBooking({
      booking: input.booking,
      ownerId: input.site.user_id,
      hostName,
      hostEmail: owner.email,
      siteName: hostName,
      bookingTitle: input.bookingTitle,
      timezone: input.timezone,
      guestMessageText: normalizeLongText(confirmationEmail?.message, 8000),
      paymentInstructions: normalizeLongText(input.paymentInstructions, 8000),
      sendHostCopy: confirmationEmail?.sendHostCopy !== false,
    }),
  );

  if (result.guest.status === "failed" || result.host.status === "failed") {
    console.error("Booking confirmation email issue:", result);
  }
}

async function createManagedBookingCheckout(
  env: Env,
  input: {
    site: DbSite;
    offerTitle: string;
    amount: number;
    currency: string;
    customerName: string;
    customerEmail: string;
    metadata: Record<string, string>;
    returnUrl: string;
    expiresAt?: string;
  },
): Promise<{ id: string; url: string | null }> {
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) throw new Error("Managed commerce bridge is not configured.");
  const response = await fetch(
    `${bridge.origin.replace(/\/+$/, "")}/v1/commerce/checkout-sessions`,
    {
      method: "POST",
      headers: {
        ...bridge.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        referenceId: input.metadata.hold_token,
        kind: "booking",
        siteId: input.site.id,
        ownerId: input.site.user_id,
        product: {
          id: input.metadata.offer_id,
          name: input.offerTitle,
          amount: input.amount,
          currency: input.currency,
        },
        customer: { name: input.customerName, email: input.customerEmail },
        metadata: input.metadata,
        returnUrl: input.returnUrl,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      }),
    },
  );
  const data = (await response.json()) as {
    url?: string;
    sessionId?: string;
    error?: string;
  };
  if (!response.ok || !data.url || !data.sessionId) {
    throw new Error(data.error || "Managed booking checkout is unavailable.");
  }
  return { id: data.sessionId, url: data.url };
}

export async function retrieveManagedBookingCheckout(
  env: Env,
  sessionId: string,
): Promise<Stripe.Checkout.Session> {
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) throw new Error("Managed commerce bridge is not configured.");
  const response = await fetch(
    `${bridge.origin.replace(/\/+$/, "")}/v1/commerce/checkout-sessions/${encodeURIComponent(sessionId)}`,
    { headers: bridge.headers },
  );
  const data = (await response.json()) as {
    paymentStatus?: string;
    paymentIntentId?: string | null;
    amountTotal?: number | null;
    currency?: string | null;
    metadata?: Record<string, string>;
    error?: string;
  };
  if (!response.ok || !data.metadata) {
    throw new Error(data.error || "Managed booking checkout could not be verified.");
  }
  return {
    id: sessionId,
    object: "checkout.session",
    payment_status: data.paymentStatus === "paid" ? "paid" : "unpaid",
    payment_intent: data.paymentIntentId || null,
    amount_total: data.amountTotal || null,
    amount_subtotal: data.amountTotal || null,
    currency: data.currency || null,
    metadata: data.metadata,
  } as Stripe.Checkout.Session;
}

export async function getSiteById(env: Env, siteId: string): Promise<DbSite | null> {
  if (!siteId) return null;
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE id = ?`,
    )
      .bind(siteId)
      .first<DbSite>()) || null
  );
}

export function bookingSelectSql(where: string) {
  return `SELECT id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
                 duration_minutes, calendar_event_id, status, notes, created_at, cancelled_at,
                 payment_intent_id, amount_paid, suggested_amount, currency, payment_status,
                 is_free_booking, paid_at, meeting_provider, meeting_url, meeting_host_url,
                 meeting_guest_token_hash, meeting_title
          FROM bookings
          ${where}`;
}

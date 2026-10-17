import { requestCountry } from "../../../../shared/regional-pricing";
import Stripe from "stripe";
import {
  getSiteByUsername,
  getStripe,
  loadSiteProfileForCommerce,
  normalizeBookingAmount,
  normalizeEmail,
  normalizeLongText,
  normalizeSiteCheckoutReturnUrl,
  normalizeShortText,
  type CoreBookIntent,
} from "../booking";
import { BOOKING_PAYMENTS_UNAVAILABLE_MESSAGE, resolveCheckoutProvider } from "../booking-checkout";
import { getManagedCommerceBridgeConfig } from "../commerce-bridge";
import {
  createConfirmedEventBooking,
  finalizePaidEventBookingCheckout,
  getEventOccurrenceAvailability,
  isEventBookingType,
  normalizeAttendeeQuantity,
  resolveEventBookingOffer,
  resolveEventOccurrence,
  serializePublicEventOffer,
  startPaidEventCheckout,
  type EventBookingType,
} from "../event-booking";
import type { AppHono } from "../http/types";
import type { Env } from "../types";

type EventBookingBody = {
  localDate?: unknown;
  quantity?: unknown;
  guestName?: unknown;
  guestEmail?: unknown;
  notes?: unknown;
  amount?: unknown;
  currency?: unknown;
  returnUrl?: unknown;
  pageId?: unknown;
  actionId?: unknown;
  campaign?: unknown;
};

export function registerEventBookingRoutes(app: AppHono) {
  app.get("/api/book/:username/events/:bookingType/:offerId/availability", async (c) => {
    const context = await resolveEventRequest(c.env, {
      username: c.req.param("username"),
      bookingType: c.req.param("bookingType"),
      offerId: c.req.param("offerId"),
      localDate: normalizeShortText(c.req.query("date"), 20),
      country: requestCountry(c.req.raw),
    });
    if ("error" in context) return c.json({ error: context.error }, context.status as any);
    if (context.occurrence.startsAtMs <= Date.now() + 5 * 60_000) {
      return c.json({ error: "This event is no longer available to book" }, 409);
    }
    const availability = await getEventOccurrenceAvailability(c.env, {
      siteId: context.site.id,
      offer: context.offer,
      occurrence: context.occurrence,
    });
    return c.json({
      ok: true,
      offer: serializePublicEventOffer(context.offer),
      occurrence: context.occurrence,
      ...availability,
    });
  });

  app.post("/api/book/:username/events/:bookingType/:offerId/register", async (c) => {
    const body = await c.req.json<EventBookingBody>().catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);
    const context = await resolveEventRequest(c.env, {
      username: c.req.param("username"),
      bookingType: c.req.param("bookingType"),
      offerId: c.req.param("offerId"),
      localDate: normalizeShortText(body.localDate, 20),
      country: requestCountry(c.req.raw),
    });
    if ("error" in context) return c.json({ error: context.error }, context.status as any);
    if (context.occurrence.startsAtMs <= Date.now() + 5 * 60_000) {
      return c.json({ error: "This event is no longer available to book" }, 409);
    }

    const guestName = normalizeShortText(body.guestName, 120);
    const guestEmail = normalizeEmail(body.guestEmail);
    const quantity = normalizeAttendeeQuantity(body.quantity, context.offer.capacity);
    if (!guestName) return c.json({ error: "Name is required" }, 400);
    if (!guestEmail) return c.json({ error: "Enter a valid email address" }, 400);
    if (!quantity) return c.json({ error: "Choose a valid number of attendees" }, 400);
    if (
      context.offer.pricing?.enabled &&
      context.offer.pricing.paymentMethod !== "manual"
    ) {
      return c.json({ error: "Use checkout for paid event bookings" }, 402);
    }
    if (
      context.offer.pricing?.enabled &&
      context.offer.pricing.paymentMethod === "manual" &&
      !normalizeLongText(context.offer.pricing.paymentInstructions, 8000)
    ) {
      return c.json({ error: "Payment instructions are not configured for this event" }, 409);
    }
    const manualAmount =
      context.offer.pricing?.enabled &&
      context.offer.pricing.paymentMethod === "manual"
        ? normalizeBookingAmount(body.amount, context.offer.pricing, body.currency)
        : null;
    if (manualAmount && !manualAmount.ok) {
      return c.json({ error: manualAmount.error }, 400);
    }

    const booking = await createConfirmedEventBooking(c.env, {
      site: context.site,
      bookIntent: context.bookIntent,
      offer: context.offer,
      occurrence: context.occurrence,
      quantity,
      guestName,
      guestEmail,
      notes: normalizeLongText(body.notes, 2000),
      pageId: normalizeShortText(body.pageId, 100),
      actionId: normalizeShortText(body.actionId, 100),
      campaign: normalizeShortText(body.campaign, 160),
      amountDuePerAttendeeCents: manualAmount?.amountCents,
      paymentCurrency: manualAmount?.currency,
    });
    if (!booking) {
      return c.json({ error: "There are not enough spaces left for that booking" }, 409);
    }
    return c.json({ ok: true, booking: serializeEventBooking(booking) });
  });

  app.post(
    "/api/book/:username/events/:bookingType/:offerId/checkout-session",
    async (c) => {
      const body = await c.req.json<EventBookingBody>().catch(() => null);
      if (!body) return c.json({ error: "Invalid request body" }, 400);
      const context = await resolveEventRequest(c.env, {
        username: c.req.param("username"),
        bookingType: c.req.param("bookingType"),
        offerId: c.req.param("offerId"),
        localDate: normalizeShortText(body.localDate, 20),
        country: requestCountry(c.req.raw),
      });
      if ("error" in context) return c.json({ error: context.error }, context.status as any);
      if (context.occurrence.startsAtMs <= Date.now() + 5 * 60_000) {
        return c.json({ error: "This event is no longer available to book" }, 409);
      }
      if (
        !context.offer.pricing?.enabled ||
        context.offer.pricing.paymentMethod === "manual"
      ) {
        return c.json({ error: "Paid event booking offer not found" }, 404);
      }

      const guestName = normalizeShortText(body.guestName, 120);
      const guestEmail = normalizeEmail(body.guestEmail);
      const quantity = normalizeAttendeeQuantity(body.quantity, context.offer.capacity);
      if (!guestName) return c.json({ error: "Name is required" }, 400);
      if (!guestEmail) return c.json({ error: "Enter a valid email address" }, 400);
      if (!quantity) return c.json({ error: "Choose a valid number of attendees" }, 400);
      const amount = normalizeBookingAmount(body.amount, context.offer.pricing, body.currency);
      if (!amount.ok) return c.json({ error: amount.error }, 400);

      const provider = await resolveCheckoutProvider(c.env, context.site.user_id);
      if (!provider) {
        return c.json({ error: BOOKING_PAYMENTS_UNAVAILABLE_MESSAGE }, 503);
      }

      const result = await startPaidEventCheckout(c.env, {
        site: context.site,
        provider,
        offer: context.offer,
        occurrence: context.occurrence,
        quantity,
        amount,
        guestName,
        guestEmail,
        notes: normalizeLongText(body.notes, 2000),
        pageId: normalizeShortText(body.pageId, 100),
        actionId: normalizeShortText(body.actionId, 100),
        campaign: normalizeShortText(body.campaign, 160),
        returnUrl: normalizeSiteCheckoutReturnUrl(body.returnUrl, c.req.url, c.env, context.site),
        holdExpiresAt: new Date(
          Date.now() + (provider.stripe ? 60 * 60_000 : 24 * 60 * 60_000),
        ).toISOString(),
        sessionExpiresAtSeconds: Math.floor(Date.now() / 1000) + 60 * 60,
      });
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ url: result.url, sessionId: result.sessionId });
    },
  );

  app.post("/api/book/:username/events/complete-checkout", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const body = await c.req
      .json<{ sessionId?: unknown }>()
      .catch(() => null);
    const sessionId = normalizeShortText(body?.sessionId, 200);
    if (!sessionId) return c.json({ error: "Missing Checkout session ID" }, 400);

    const stripe = await getStripe(c.env, site.user_id);
    const managedCommerce = Boolean(await getManagedCommerceBridgeConfig(c.env));
    if (!stripe && !managedCommerce) {
      return c.json({ error: "Payments are not configured for this ME3 install" }, 503);
    }
    try {
      const session = stripe
        ? await stripe.checkout.sessions.retrieve(sessionId)
        : await retrieveManagedEventCheckout(c.env, sessionId);
      const result = await finalizePaidEventBookingCheckout(c.env, site, session);
      if ("error" in result) return c.json({ error: result.error }, result.status as any);
      return c.json(result);
    } catch (error) {
      console.error("Event booking completion failed:", error);
      return c.json({ error: "The paid event booking could not be verified" }, 502);
    }
  });
}

async function resolveEventRequest(
  env: Env,
  input: {
    username: string;
    bookingType: string;
    offerId: string;
    localDate: string;
    country: string | null;
  },
) {
  if (!isEventBookingType(input.bookingType)) {
    return { error: "Event booking type not found", status: 404 as const };
  }
  const site = await getSiteByUsername(env, input.username);
  if (!site) return { error: "Site not found", status: 404 as const };
  const profile = await loadSiteProfileForCommerce(env, site, input.country);
  const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
  if (!bookIntent?.enabled) {
    return { error: "Booking is not enabled for this site", status: 404 as const };
  }
  const offer = resolveEventBookingOffer(
    bookIntent,
    input.bookingType,
    normalizeShortText(input.offerId, 100),
  );
  if (!offer) return { error: "Event booking offer not found", status: 404 as const };
  const occurrence = resolveEventOccurrence(offer, input.localDate);
  if (!occurrence) {
    return {
      error:
        input.bookingType === "class"
          ? "That date is not a scheduled class session"
          : "The retreat dates are not configured correctly",
      status: 400 as const,
    };
  }
  return { site, profile, bookIntent, offer, occurrence };
}

async function retrieveManagedEventCheckout(
  env: Env,
  sessionId: string,
): Promise<Stripe.Checkout.Session> {
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) throw new Error("Managed commerce bridge is not configured");
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
    throw new Error(data.error || "Managed event checkout could not be verified");
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

function serializeEventBooking(booking: {
  id: string;
  offer_id: string | null;
  booking_type: EventBookingType | "one_to_one" | null;
  starts_at: string;
  ends_at: string;
  quantity?: number | null;
  status: string;
}) {
  return {
    id: booking.id,
    offerId: booking.offer_id,
    bookingType: booking.booking_type,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    quantity: booking.quantity || 1,
    status: booking.status,
  };
}

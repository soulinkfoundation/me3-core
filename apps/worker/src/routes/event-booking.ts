import { requestCountry } from "../../../../shared/regional-pricing";
import Stripe from "stripe";
import {
  appendQueryParams,
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
import { getManagedCommerceBridgeConfig } from "../commerce-bridge";
import { isCommerceReady } from "../commerce-settings";
import {
  createConfirmedEventBooking,
  createEventBookingHold,
  finalizePaidEventBookingCheckout,
  getEventOccurrenceAvailability,
  isEventBookingType,
  normalizeAttendeeQuantity,
  releaseEventBookingHold,
  resolveEventBookingOffer,
  resolveEventOccurrence,
  serializePublicEventOffer,
  type EventBookingType,
} from "../event-booking";
import type { AppHono } from "../http/types";
import type { DbSite, Env } from "../types";

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

const PAYMENTS_UNAVAILABLE_MESSAGE =
  "Payments are not available for this booking right now. Please contact the site owner.";

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

      const stripe = await getStripe(c.env, context.site.user_id);
      const managedCommerce =
        !stripe && (await isCommerceReady(c.env, context.site.user_id));
      if (!stripe && !managedCommerce) {
        return c.json({ error: PAYMENTS_UNAVAILABLE_MESSAGE }, 503);
      }

      const holdToken = crypto.randomUUID();
      const held = await createEventBookingHold(c.env, {
        siteId: context.site.id,
        offer: context.offer,
        occurrence: context.occurrence,
        quantity,
        holdToken,
        expiresAt: new Date(
          Date.now() + (stripe ? 60 * 60_000 : 24 * 60 * 60_000),
        ).toISOString(),
      });
      if (!held) {
        return c.json({ error: "There are not enough spaces left for that booking" }, 409);
      }

      const baseReturnUrl = normalizeSiteCheckoutReturnUrl(body.returnUrl, c.req.url, c.env, context.site);
      const pendingReturnUrl = appendQueryParams(baseReturnUrl, {
        event_booking_pending: `${context.offer.bookingType}:${context.offer.id}`,
      });
      const successUrl = appendQueryParams(pendingReturnUrl, {
        event_booking: "success",
        session_id: "{CHECKOUT_SESSION_ID}",
      });
      const cancelUrl = appendQueryParams(pendingReturnUrl, { event_booking: "cancelled" });
      const notes = normalizeLongText(body.notes, 2000);
      const metadata = {
        purchase_kind: "booking",
        site_id: context.site.id,
        offer_id: context.offer.id,
        booking_type: context.offer.bookingType,
        hold_token: holdToken,
        guest_name: guestName,
        guest_email: guestEmail,
        notes,
        starts_at: context.occurrence.startsAt,
        ends_at: context.occurrence.endsAt,
        duration_minutes: String(context.occurrence.durationMinutes),
        quantity: String(quantity),
        page_id: normalizeShortText(body.pageId, 100),
        action_id: normalizeShortText(body.actionId, 100),
        campaign: normalizeShortText(body.campaign, 160),
      };

      try {
        const session = stripe
          ? await stripe.checkout.sessions.create({
              mode: "payment",
              customer_email: guestEmail,
              line_items: [
                {
                  price_data: {
                    currency: amount.currency,
                    product_data: {
                      name: context.offer.title,
                      description: eventCheckoutDescription(context.offer.bookingType, context.occurrence),
                    },
                    unit_amount: amount.amountCents,
                  },
                  quantity,
                },
              ],
              payment_intent_data: { metadata },
              metadata,
              success_url: successUrl,
              cancel_url: cancelUrl,
              expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
            })
          : await createManagedEventCheckout(c.env, {
              site: context.site,
              offerId: context.offer.id,
              offerTitle: context.offer.title,
              totalAmount: amount.amountCents * quantity,
              currency: amount.currency,
              guestName,
              guestEmail,
              metadata,
              returnUrl: pendingReturnUrl,
            });
        return c.json({ url: session.url, sessionId: session.id });
      } catch (error) {
        await releaseEventBookingHold(c.env, holdToken);
        console.error("Paid event booking checkout failed:", error);
        return c.json({ error: PAYMENTS_UNAVAILABLE_MESSAGE }, 503);
      }
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

async function createManagedEventCheckout(
  env: Env,
  input: {
    site: DbSite;
    offerId: string;
    offerTitle: string;
    totalAmount: number;
    currency: string;
    guestName: string;
    guestEmail: string;
    metadata: Record<string, string>;
    returnUrl: string;
  },
): Promise<{ id: string; url: string }> {
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) throw new Error("Managed commerce bridge is not configured");
  const response = await fetch(
    `${bridge.origin.replace(/\/+$/, "")}/v1/commerce/checkout-sessions`,
    {
      method: "POST",
      headers: { ...bridge.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        referenceId: input.metadata.hold_token,
        kind: "booking",
        siteId: input.site.id,
        ownerId: input.site.user_id,
        product: {
          id: input.offerId,
          name: input.offerTitle,
          amount: input.totalAmount,
          currency: input.currency,
        },
        customer: { name: input.guestName, email: input.guestEmail },
        metadata: input.metadata,
        returnUrl: input.returnUrl,
      }),
    },
  );
  const data = (await response.json()) as {
    url?: string;
    sessionId?: string;
    error?: string;
  };
  if (!response.ok || !data.url || !data.sessionId) {
    throw new Error(data.error || "Managed event checkout is unavailable");
  }
  return { id: data.sessionId, url: data.url };
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

function eventCheckoutDescription(
  bookingType: EventBookingType,
  occurrence: { localDate: string; localTime: string },
): string {
  return `${bookingType === "class" ? "Class" : "Retreat"} · ${occurrence.localDate} ${occurrence.localTime}`;
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

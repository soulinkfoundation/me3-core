import { requestCountry } from "../../../../shared/regional-pricing";
import Stripe from "stripe";
import { resolveTimeZone } from "../calendar";
import {
  generateAvailableBookingSlots,
  getSiteByUsername,
  getStripe,
  loadSiteProfileForCommerce,
  normalizeBookingAmount,
  normalizeEmail,
  normalizeLongText,
  normalizeSiteCheckoutReturnUrl,
  normalizeShortText,
  resolveBookingSlot,
  resolveOneToOneBookingOffer,
  resolvePaidOneToOneOffer,
  resolvePublicBookingSlot,
  resolvePublicOneToOneBookingOffer,
  serializeBooking,
  serializePublicBookingOffer,
  type CoreBookIntent,
  type FreeBookingBody,
  type PaidBookingCheckoutBody,
  type PaidBookingCompletionBody,
  type PublicBookingConfirmBody,
} from "../booking";
import {
  BOOKING_PAYMENTS_UNAVAILABLE_MESSAGE,
  bookFreeOneToOne,
  finalizePaidBookingCheckout,
  getSiteById,
  resolveCheckoutProvider,
  retrieveManagedBookingCheckout,
  startPaidOneToOneCheckout,
} from "../booking-checkout";
import type { AppHono, OwnerRouteDeps } from "../http/types";
import { finalizeStripeProductCheckout } from "../commerce-orders";
import { getManagedCommerceBridgeConfig } from "../commerce-bridge";
import {
  finalizePaidEventBookingCheckout,
  isEventBookingType,
} from "../event-booking";
import { validExternalMeetingUrl } from "../booking-meetings";
import { BookingChangeError, cancelOwnerBooking, rescheduleOwnerBooking } from "../booking-changes";

export function registerBookingRoutes(app: AppHono, { requireOwner, unauthorized }: OwnerRouteDeps) {
  app.get("/api/sites/:username/booking-meetings", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site || site.user_id !== ownerId) return c.json({ error: "Site not found" }, 404);
    const { results } = await c.env.DB.prepare(
      "SELECT offer_id, meeting_url FROM site_booking_meetings WHERE site_id = ?",
    ).bind(site.id).all<{ offer_id: string; meeting_url: string }>();
    return c.json({ offers: results.map((row) => ({ offerId: row.offer_id, meetingUrl: row.meeting_url })) });
  });

  app.put("/api/sites/:username/booking-meetings", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site || site.user_id !== ownerId) return c.json({ error: "Site not found" }, 404);
    const body = await c.req.json<{ offers?: Array<{ offerId?: unknown; meetingUrl?: unknown }> }>().catch(() => null);
    if (!body || !Array.isArray(body.offers) || body.offers.length > 100) return c.json({ error: "Invalid meeting settings" }, 400);
    const settings: Array<{ offerId: string; meetingUrl: string }> = [];
    for (const item of body.offers) {
      const offerId = typeof item.offerId === "string" ? item.offerId.trim() : "";
      const meetingUrl = validExternalMeetingUrl(typeof item.meetingUrl === "string" ? item.meetingUrl : undefined);
      if (!offerId || offerId.length > 100 || !meetingUrl) return c.json({ error: "Each external offer needs a valid HTTPS meeting link" }, 400);
      settings.push({ offerId, meetingUrl });
    }
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM site_booking_meetings WHERE site_id = ?").bind(site.id),
      ...settings.map((setting) => c.env.DB.prepare(
        "INSERT INTO site_booking_meetings (site_id, offer_id, meeting_url) VALUES (?, ?, ?)",
      ).bind(site.id, setting.offerId, setting.meetingUrl)),
    ]);
    return c.json({ ok: true });
  });

  // The calendar's "Cancel booking" action. The guest is emailed and their join link stops working.
  app.delete("/api/book/cancel/:id", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    try { return c.json(await cancelOwnerBooking(c.env, ownerId, c.req.param("id"))); }
    catch (error) {
      if (error instanceof BookingChangeError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  // Moves a booking in place so the guest's existing join link keeps working at the new time.
  app.post("/api/bookings/:id/reschedule", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const body = await c.req.json<{ startsAt?: unknown }>().catch(() => null);
    try { return c.json(await rescheduleOwnerBooking(c.env, ownerId, c.req.param("id"), body?.startsAt)); }
    catch (error) {
      if (error instanceof BookingChangeError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.get("/api/book/:username/slots", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const localDate = normalizeShortText(c.req.query("date"), 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return c.json({ error: "date is required in YYYY-MM-DD format" }, 400);
    }

    const profile = await loadSiteProfileForCommerce(c.env, site, requestCountry(c.req.raw));
    const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
    if (!bookIntent?.enabled) return c.json({ error: "Booking is not enabled for this site" }, 404);

    const resolved = resolvePublicOneToOneBookingOffer(
      bookIntent,
      normalizeShortText(c.req.query("offerId"), 100),
    );
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status);

    const timezone = resolveTimeZone(resolved.offer.availability.timezone);
    const slots = await generateAvailableBookingSlots(c.env, {
      siteId: site.id,
      offer: resolved.offer,
      localDate,
      timezone,
    });

    return c.json({
      ok: true,
      date: localDate,
      timezone,
      offer: serializePublicBookingOffer(resolved.offer),
      slots,
    });
  });

  app.post("/api/book/:username/confirm", async (c) => {
    const username = c.req.param("username");
    const site = await getSiteByUsername(c.env, username);
    if (!site) return c.json({ error: "Site not found" }, 404);

    const body = await c.req.json<PublicBookingConfirmBody>().catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);

    const guestName = normalizeShortText(body.guestName, 120);
    const guestEmail = normalizeEmail(body.guestEmail);
    const notes = normalizeLongText(body.notes, 2000);
    const pageId = normalizeShortText(body.pageId, 100);
    const actionId = normalizeShortText(body.actionId, 100);
    const campaign = normalizeShortText(body.campaign, 160);
    const slotStart = normalizeShortText(body.slotStart, 80);
    const slotEnd = normalizeShortText(body.slotEnd, 80);

    if (!slotStart || !slotEnd || !guestName) {
      return c.json({ error: "slotStart, slotEnd, and guestName are required" }, 400);
    }
    if (!guestEmail) {
      return c.json({ error: "Enter a valid email address" }, 400);
    }

    const profile = await loadSiteProfileForCommerce(c.env, site, requestCountry(c.req.raw));
    const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
    if (!bookIntent?.enabled) return c.json({ error: "Booking is not enabled for this site" }, 404);

    const resolved = resolvePublicOneToOneBookingOffer(
      bookIntent,
      normalizeShortText(body.offerId, 100),
    );
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status);

    const offer = resolved.offer;
    if (
      offer.pricing?.enabled &&
      offer.pricing.paymentMethod !== "manual"
    ) {
      return c.json(
        {
          error: "Use checkout for paid booking offers",
          action: "createBookingCheckout",
          checkoutUrl: `/api/book/${encodeURIComponent(username)}/checkout-session`,
        },
        402,
      );
    }
    if (
      offer.pricing?.enabled &&
      offer.pricing.paymentMethod === "manual" &&
      !normalizeLongText(offer.pricing.paymentInstructions, 8000)
    ) {
      return c.json({ error: "Payment instructions are not configured for this booking" }, 409);
    }
    const timezone = resolveTimeZone(offer.availability.timezone);
    const slot = resolvePublicBookingSlot({
      slotStart,
      slotEnd,
      durationMinutes: offer.duration,
      timezone,
    });
    if ("error" in slot) return c.json({ error: slot.error }, 400);

    const result = await bookFreeOneToOne(c.env, {
      site,
      profile,
      bookIntent,
      offer,
      slot,
      guestName,
      guestEmail,
      notes,
      pageId,
      actionId,
      campaign,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, booking: result.booking ? serializeBooking(result.booking) : null });
  });

  app.post("/api/book/:username/free", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const body = await c.req.json<FreeBookingBody>().catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);

    const guestName = normalizeShortText(body.guestName, 120);
    const guestEmail = normalizeEmail(body.guestEmail);
    const notes = normalizeLongText(body.notes, 2000);
    const pageId = normalizeShortText(body.pageId, 100);
    const actionId = normalizeShortText(body.actionId, 100);
    const campaign = normalizeShortText(body.campaign, 160);
    const localDate = normalizeShortText(body.localDate, 20);
    const localTime = normalizeShortText(body.localTime, 20);

    if (!guestName || !localDate || !localTime) {
      return c.json({ error: "Name, date, and time are required" }, 400);
    }
    if (!guestEmail) {
      return c.json({ error: "Enter a valid email address" }, 400);
    }

    const profile = await loadSiteProfileForCommerce(c.env, site, requestCountry(c.req.raw));
    const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
    if (!bookIntent?.enabled) return c.json({ error: "Booking is not enabled for this site" }, 404);

    const offer = resolveOneToOneBookingOffer(bookIntent, normalizeShortText(body.offerId, 100));
    if (!offer) return c.json({ error: "Booking offer not found" }, 404);
    if (
      offer.pricing?.enabled &&
      offer.pricing.paymentMethod !== "manual"
    ) {
      return c.json({ error: "Use checkout for paid booking offers" }, 400);
    }
    if (
      offer.pricing?.enabled &&
      offer.pricing.paymentMethod === "manual" &&
      !normalizeLongText(offer.pricing.paymentInstructions, 8000)
    ) {
      return c.json({ error: "Payment instructions are not configured for this booking" }, 409);
    }
    const manualAmount =
      offer.pricing?.enabled && offer.pricing.paymentMethod === "manual"
        ? normalizeBookingAmount(body.amount, offer.pricing, body.currency)
        : null;
    if (manualAmount && !manualAmount.ok) {
      return c.json({ error: manualAmount.error }, 400);
    }

    const slot = resolveBookingSlot({
      localDate,
      localTime,
      durationMinutes: offer.duration,
      timezone: resolveTimeZone(offer.availability.timezone),
    });
    if (!slot) return c.json({ error: "Invalid booking date or time" }, 400);

    const result = await bookFreeOneToOne(c.env, {
      site,
      profile,
      bookIntent,
      offer,
      slot: { ...slot, localDate, localTime },
      guestName,
      guestEmail,
      notes,
      pageId,
      actionId,
      campaign,
      amountDueCents: manualAmount?.amountCents,
      paymentCurrency: manualAmount?.currency,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, booking: result.booking ? serializeBooking(result.booking) : null });
  });

  app.post("/api/book/:username/checkout-session", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const provider = await resolveCheckoutProvider(c.env, site.user_id);
    if (!provider) {
      return c.json({ error: BOOKING_PAYMENTS_UNAVAILABLE_MESSAGE }, 503);
    }

    const body = await c.req.json<PaidBookingCheckoutBody>().catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);

    const guestName = normalizeShortText(body.guestName, 120);
    const guestEmail = normalizeEmail(body.guestEmail);
    const notes = normalizeLongText(body.notes, 2000);
    const pageId = normalizeShortText(body.pageId, 100);
    const actionId = normalizeShortText(body.actionId, 100);
    const campaign = normalizeShortText(body.campaign, 160);
    const localDate = normalizeShortText(body.localDate, 20);
    const localTime = normalizeShortText(body.localTime, 20);

    if (!guestName || !localDate || !localTime) {
      return c.json({ error: "Name, date, and time are required" }, 400);
    }
    if (!guestEmail) {
      return c.json({ error: "Enter a valid email address" }, 400);
    }

    const profile = await loadSiteProfileForCommerce(c.env, site, requestCountry(c.req.raw));
    const bookIntent = profile?.intents?.book as CoreBookIntent | undefined;
    if (!bookIntent?.enabled) return c.json({ error: "Booking is not enabled for this site" }, 404);

    const offer = resolvePaidOneToOneOffer(bookIntent, normalizeShortText(body.offerId, 100));
    if (!offer) return c.json({ error: "Paid booking offer not found" }, 404);

    const amount = normalizeBookingAmount(body.amount, offer.pricing, body.currency);
    if (!amount.ok) return c.json({ error: amount.error }, 400);

    const slot = resolveBookingSlot({
      localDate,
      localTime,
      durationMinutes: offer.duration,
      timezone: resolveTimeZone(offer.availability.timezone),
    });
    if (!slot) return c.json({ error: "Invalid booking date or time" }, 400);

    const result = await startPaidOneToOneCheckout(c.env, {
      site,
      provider,
      offer,
      amount,
      slot: { ...slot, localDate, localTime },
      guestName,
      guestEmail,
      notes,
      pageId,
      actionId,
      campaign,
      returnUrl: normalizeSiteCheckoutReturnUrl(body.returnUrl, c.req.url, c.env, site),
      holdExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      sessionExpiresAtSeconds: Math.floor(Date.now() / 1000) + 60 * 60,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ url: result.url, sessionId: result.sessionId });
  });

  app.post("/api/book/:username/complete-checkout", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const stripe = await getStripe(c.env, site.user_id);
    const managedCommerce = Boolean(await getManagedCommerceBridgeConfig(c.env));
    if (!stripe && !managedCommerce) {
      return c.json({ error: "Stripe is not configured for this ME3 install" }, 503);
    }

    const body = await c.req.json<PaidBookingCompletionBody>().catch(() => null);
    const sessionId = normalizeShortText(body?.sessionId, 200);
    if (!sessionId) return c.json({ error: "Missing Stripe Checkout session ID" }, 400);

    const session = stripe
      ? await stripe.checkout.sessions.retrieve(sessionId)
      : await retrieveManagedBookingCheckout(c.env, sessionId);
    const result = isEventBookingType(session.metadata?.booking_type)
      ? await finalizePaidEventBookingCheckout(c.env, site, session)
      : await finalizePaidBookingCheckout(c.env, site, session);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/stripe/webhook", async (c) => {
    const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET;
    const signature = c.req.header("stripe-signature");
    if (!webhookSecret) return c.json({ error: "Stripe webhook secret is not configured" }, 503);
    if (!signature) return c.json({ error: "Missing Stripe signature" }, 400);

    let event: Stripe.Event;
    const rawBody = await c.req.text();
    try {
      const stripe = new Stripe("sk_test_me3_webhook_verifier", {
        apiVersion: "2025-02-24.acacia",
      });
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
    } catch {
      return c.json({ error: "Invalid Stripe webhook signature" }, 400);
    }

    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return c.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const site = await getSiteById(c.env, session.metadata?.site_id || "");
    if (!site) return c.json({ received: true, error: "site_not_found" });

    if (session.metadata?.purchase_kind === "product") {
      if (session.payment_status !== "paid") return c.json({ received: true });
      try {
        const result = await finalizeStripeProductCheckout(c.env, site, session);
        return c.json({ received: true, order: result.order });
      } catch (error) {
        console.error("Stripe product webhook failed:", error);
        return c.json({ received: false, error: "product_checkout_failed" }, 500);
      }
    }
    if (session.metadata?.purchase_kind !== "booking") {
      return c.json({ received: true });
    }

    const result = isEventBookingType(session.metadata?.booking_type)
      ? await finalizePaidEventBookingCheckout(c.env, site, session)
      : await finalizePaidBookingCheckout(c.env, site, session);
    if ("error" in result) {
      console.error("Stripe booking webhook failed:", result.error);
      return c.json({ received: true, error: result.error });
    }

    return c.json({ received: true, booking: result.booking });
  });
}

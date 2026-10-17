import type { Me3SiteProfile } from "@me3-core/site-renderer";
import { productDeliveryError, type ProductDelivery } from "../../../shared/product-delivery";
import { localizeRegionalPrices } from "../../../shared/regional-pricing";
import { addDaysToDateString, getUtcMsForLocalTime, resolveTimeZone } from "./calendar";
import {
  formatUtcInstantInTimeZone,
  getStripe,
  listAvailableBookingSlots,
  listOneToOneBookingSources,
  loadSiteProfileForCommerce,
  normalizeBookingAmount,
  normalizeEmail,
  normalizeShortText,
  normalizeSiteCheckoutReturnUrl,
  resolvePublicBookingSlot,
  type CoreBookIntent,
  type CoreBookingPricing,
  type ResolvedOneToOneBookingOffer,
  type ResolvedPaidBookingOffer,
} from "./booking";
import {
  bookFreeOneToOne,
  finalizePaidBookingCheckout,
  resolveCheckoutProvider,
  retrieveManagedBookingCheckout,
  startPaidOneToOneCheckout,
  type BookingSlot,
  type CheckoutProvider,
} from "./booking-checkout";
import {
  countAgentCommerceRequest,
  getAgentCheckoutEnabled,
  pruneAgentCommerceRateLimits,
} from "./agent-commerce-store";
import { CommerceOrderInputError, completeProductCheckout, createProductCheckout } from "./commerce-orders";
import { getDefaultCommerceCurrency, isCommerceReady } from "./commerce-settings";
import {
  createConfirmedEventBooking,
  finalizePaidEventBookingCheckout,
  getEventOccurrenceAvailability,
  listEventBookingSources,
  normalizeAttendeeQuantity,
  resolveEventOccurrence,
  startPaidEventCheckout,
  type EventOccurrence,
  type ResolvedEventBookingOffer,
} from "./event-booking";
import { getOrCreateInstallEncryptionKey } from "./install-secrets";
import { Me3CloudJwtVerificationError, verifyMe3CloudJwt } from "./me3-cloud-jwt";
import {
  publicProductId,
  publicServiceId,
  withoutAgentCheckout,
  type PublicAgentCheckout,
} from "./public-me-profile";
import type { DbSite, Env } from "./types";
import type { Me3Profile } from "me3-protocol";
import type Stripe from "stripe";

// Seller agent commerce API (v1). It wraps the site's own checkout: the same
// offers, prices, stale-price guard, holds, Stripe Connect or managed commerce
// sessions and confirmation emails. Agents never pay here; they hand `payUrl`
// to their owner, who pays on their own device.

export const AGENT_COMMERCE_API_VERSION = "1";
export const AGENT_COMMERCE_BASE_PATH = "/api/agent-commerce/v1";
export const AGENT_CHECKOUT_HOLD_MINUTES = 15;
/** Stripe Checkout sessions must stay open at least 30 minutes after creation. */
const PAYMENT_WINDOW_MINUTES = 32;
/** Lets a payment completed at the end of the window still confirm its hold. */
const CONFIRMATION_GRACE_MINUTES = 5;
const MAX_AVAILABILITY_DAYS = 31;
const ABANDONED_CLAIM_MS = 2 * 60_000;
const DEFAULT_AVAILABILITY_DAYS = 7;
export const BUYER_INSTALL_HEADER = "ME3-Buyer-Install";
/** Attribution on the seller's bookings and orders, beside page and campaign sources. */
const AGENT_CHECKOUT_CAMPAIGN = "agent-commerce";
export const BUYER_INSTALL_AUDIENCE = "me3-agent-commerce";
const BUYER_INSTALL_MAX_LIFETIME_SECONDS = 15 * 60;
export const AGENT_COMMERCE_RATE_LIMITS = {
  read: { anonymous: 120, install: 240, windowSeconds: 60 },
  checkout: { anonymous: 10, install: 30, windowSeconds: 15 * 60 },
} as const;

export class AgentCommerceError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentCommerceError";
  }
}

export type AgentOfferingKind = "booking" | "event" | "product";

export type AgentOffering = {
  id: string;
  kind: AgentOfferingKind;
  title: string;
  description?: string;
  /** Minor units (cents). Per attendee for events. */
  amount: number;
  currency: string;
  free: boolean;
  durationMinutes?: number;
  timezone?: string;
  eventType?: "class" | "retreat";
  schedule?:
    | { frequency: "weekly" | "biweekly"; weekday: string; startTime: string; startDate?: string }
    | { startsAt: string; endsAt: string };
  capacity?: number | null;
  online?: boolean;
  requiresSlot: boolean;
  maxQuantity: number;
  buyerFields: ["name", "email"];
  refundPolicy: string | null;
};

type OfferingTarget =
  | { kind: "booking"; offer: ResolvedOneToOneBookingOffer; bookIntent: CoreBookIntent }
  | { kind: "event"; offer: ResolvedEventBookingOffer; bookIntent: CoreBookIntent }
  | { kind: "product"; slug: string };

export type AgentOfferingEntry = { offering: AgentOffering; target: OfferingTarget };

export type AgentCommerceCaller = {
  /** Rate-limit identity: the verified buyer installation, else a hashed IP. */
  key: string;
  installId: string | null;
};

export type AgentCommerceContext = {
  site: DbSite;
  requestUrl: string;
  country: string | null;
  caller: AgentCommerceCaller;
};

type AgentCheckoutStatus = "creating" | "pending" | "paid" | "expired" | "cancelled";

type AgentCheckoutRow = {
  id: string;
  site_id: string;
  idempotency_scope: string;
  idempotency_key: string;
  request_hash: string;
  offering_id: string;
  offering_kind: AgentOfferingKind;
  buyer_install_id: string | null;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  slot_start: string | null;
  slot_end: string | null;
  amount_minor: number;
  currency: string;
  status: AgentCheckoutStatus;
  provider: "stripe_direct" | "me3_cloud" | "none" | null;
  provider_session_id: string | null;
  provider_checkout_url: string | null;
  hold_token: string | null;
  order_id: string | null;
  booking_id: string | null;
  paid_amount_minor: number | null;
  paid_currency: string | null;
  paid_at: string | null;
  expires_at: string;
  opened_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentCheckoutView = {
  checkoutId: string;
  status: Exclude<AgentCheckoutStatus, "creating">;
  offeringId: string;
  kind: AgentOfferingKind;
  quantity: number;
  slot: { start: string; end: string } | null;
  amount: number;
  currency: string;
  payUrl: string | null;
  expiresAt: string;
  reference: { type: "booking" | "order"; id: string } | null;
  paidAmount: number | null;
  paidCurrency: string | null;
  paidAt: string | null;
};

// ---------------------------------------------------------------------------
// Offerings

/**
 * Offerings an agent can check out: free or Stripe-paid one-to-one bookings,
 * classes and retreats, and digital or service products. Pay-separately
 * (manual) offers, physical products that need an address, and bookings handled
 * on an external booking page stay human-only.
 */
export function listAgentOfferings(
  profile: Me3SiteProfile,
  defaultCurrency = "USD",
): AgentOfferingEntry[] {
  const entries: AgentOfferingEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: AgentOfferingEntry) => {
    if (seen.has(entry.offering.id)) return;
    seen.add(entry.offering.id);
    entries.push(entry);
  };
  const free = currencyCode(defaultCurrency) || "USD";
  const book = profile.intents?.book as CoreBookIntent | undefined;

  if (book?.enabled && !book.url) {
    for (const { source, offer } of listOneToOneBookingSources(book)) {
      const id = publicServiceId(source);
      const price = agentBookingPrice(offer.pricing, free);
      if (!id || !price || !hasAvailabilityWindows(offer.availability.windows)) continue;
      add({
        offering: {
          id,
          kind: "booking",
          title: offer.title,
          ...(offer.description ? { description: offer.description } : {}),
          ...price,
          durationMinutes: offer.duration,
          timezone: resolveTimeZone(offer.availability.timezone),
          ...(offer.meetingProvider === "soulink" || offer.meetingProvider === "external"
            ? { online: true }
            : {}),
          requiresSlot: true,
          maxQuantity: 1,
          buyerFields: ["name", "email"],
          refundPolicy: null,
        },
        target: { kind: "booking", offer, bookIntent: book },
      });
    }

    for (const { source, offer } of listEventBookingSources(book)) {
      const id = publicServiceId(source);
      const price = agentBookingPrice(offer.pricing, free);
      if (!id || !price) continue;
      let schedule: AgentOffering["schedule"];
      if (offer.bookingType === "class" && offer.recurrence) {
        schedule = { ...offer.recurrence };
      } else {
        const occurrence = resolveEventOccurrence(offer);
        if (!occurrence || occurrence.startsAtMs <= Date.now() + 5 * 60_000) continue;
        schedule = { startsAt: occurrence.startsAt, endsAt: occurrence.endsAt };
      }
      add({
        offering: {
          id,
          kind: "event",
          title: offer.title,
          ...(offer.description ? { description: offer.description } : {}),
          ...price,
          durationMinutes: offer.duration,
          timezone: offer.timezone,
          eventType: offer.bookingType,
          schedule,
          capacity: offer.capacity,
          requiresSlot: offer.bookingType === "class",
          maxQuantity: offer.capacity === null ? 20 : Math.min(offer.capacity, 100),
          buyerFields: ["name", "email"],
          refundPolicy: null,
        },
        target: { kind: "event", offer, bookIntent: book },
      });
    }
  }

  for (const raw of (profile.products || []) as Array<Record<string, unknown>>) {
    const slug = typeof raw.slug === "string" ? raw.slug : "";
    const id = publicProductId(slug);
    const title = normalizeShortText(raw.title, 160);
    const delivery = raw.delivery as ProductDelivery | undefined;
    const currency = currencyCode(raw.currency);
    if (
      !slug || !id || !title || !currency ||
      raw.available === false ||
      raw.paymentMethod === "manual" ||
      delivery?.kind === "physical" ||
      productDeliveryError(delivery) ||
      !Number.isSafeInteger(raw.price) || (raw.price as number) < 50
    ) {
      continue;
    }
    const excerpt = normalizeShortText(raw.excerpt, 1000);
    add({
      offering: {
        id,
        kind: "product",
        title,
        ...(excerpt ? { description: excerpt } : {}),
        amount: raw.price as number,
        currency,
        free: false,
        requiresSlot: false,
        maxQuantity: 1,
        buyerFields: ["name", "email"],
        refundPolicy: normalizeShortText(delivery?.returns, 2000) || null,
      },
      target: { kind: "product", slug },
    });
  }

  return entries;
}

function agentBookingPrice(
  pricing: CoreBookingPricing | undefined,
  freeCurrency: string,
): { amount: number; currency: string; free: boolean } | null {
  if (!pricing?.enabled) return { amount: 0, currency: freeCurrency, free: true };
  if (pricing.paymentMethod === "manual") return null;
  const currency = currencyCode(pricing.currency);
  if (
    typeof pricing.suggestedAmount !== "number" ||
    !Number.isFinite(pricing.suggestedAmount) ||
    pricing.suggestedAmount <= 0 ||
    !currency
  ) {
    return null;
  }
  return { amount: Math.round(pricing.suggestedAmount * 100), currency, free: false };
}

function hasAvailabilityWindows(windows: Record<string, string[]> | undefined): boolean {
  return Object.values(windows || {}).some((day) => Array.isArray(day) && day.length > 0);
}

function currencyCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

async function loadAgentOfferings(
  env: Env,
  site: DbSite,
  country: string | null,
): Promise<AgentOfferingEntry[]> {
  const profile = await loadSiteProfileForCommerce(env, site);
  if (!profile) return [];
  return listAgentOfferings(
    localizeRegionalPrices(profile, country),
    await getDefaultCommerceCurrency(env, site.user_id),
  );
}

export async function listAgentCommerceOfferings(
  env: Env,
  context: Pick<AgentCommerceContext, "site" | "country">,
): Promise<AgentOffering[]> {
  return (await loadAgentOfferings(env, context.site, context.country)).map((entry) => entry.offering);
}

async function findAgentOffering(
  env: Env,
  context: Pick<AgentCommerceContext, "site" | "country">,
  offeringId: string,
): Promise<AgentOfferingEntry> {
  const entry = (await loadAgentOfferings(env, context.site, context.country)).find(
    (candidate) => candidate.offering.id === offeringId,
  );
  if (!entry) throw new AgentCommerceError("Offering not found.", 404, "offering_not_found");
  return entry;
}

/** What `me.json` advertises when the site can take agent checkouts. */
export async function resolveAgentCheckoutPublication(
  env: Env,
  site: DbSite,
  profile: Me3SiteProfile,
  publishedBaseUrl: string,
): Promise<PublicAgentCheckout | null> {
  if (!/^https:\/\//.test(publishedBaseUrl) || profile.visibility === "private") return null;
  const offeringIds = listAgentOfferings(profile).map((entry) => entry.offering.id);
  if (offeringIds.length === 0 || !(await isCommerceReady(env, site.user_id))) return null;
  return {
    specUrl: `${agentCommerceSiteBase(new URL(publishedBaseUrl).origin, site.username)}/openapi.json`,
    offeringIds,
    holdMinutes: AGENT_CHECKOUT_HOLD_MINUTES,
  };
}

/** Applies the owner's agent checkout setting to a published profile. */
export async function applyAgentCheckoutSetting(
  env: Env,
  ownerId: string,
  profile: Me3Profile,
): Promise<Me3Profile> {
  if (profile.visibility !== "public") return profile;
  return (await getAgentCheckoutEnabled(env, ownerId)) ? profile : withoutAgentCheckout(profile);
}

export function agentCommerceSiteBase(origin: string, username: string): string {
  return `${origin.replace(/\/+$/, "")}${AGENT_COMMERCE_BASE_PATH}/sites/${encodeURIComponent(username)}`;
}

/** Agent checkout is open when commerce is ready and the owner has not turned it off. */
export async function assertAgentCheckoutOpen(env: Env, site: DbSite): Promise<void> {
  if (!(await getAgentCheckoutEnabled(env, site.user_id))) {
    throw new AgentCommerceError(
      "Agent checkout is turned off for this site. Use the site's own booking or shop page.",
      403,
      "agent_checkout_disabled",
    );
  }
  if (!(await isCommerceReady(env, site.user_id))) {
    throw new AgentCommerceError(
      "Payments are not available for this site right now.",
      503,
      "commerce_unavailable",
    );
  }
}

// ---------------------------------------------------------------------------
// Availability

export async function getAgentOfferingAvailability(
  env: Env,
  context: Pick<AgentCommerceContext, "site" | "country">,
  offeringId: string,
  range: { from?: string; to?: string },
) {
  const entry = await findAgentOffering(env, context, offeringId);
  const { offering, target } = entry;
  if (target.kind === "product") {
    return { offeringId, kind: offering.kind, available: true, slots: [] };
  }

  const timezone = target.kind === "booking"
    ? resolveTimeZone(target.offer.availability.timezone)
    : target.offer.timezone;
  const window = availabilityWindow(range, timezone);
  const localDates: string[] = [];
  for (let date = window.fromDate; date <= window.toDate; date = addDaysToDateString(date, 1)) {
    localDates.push(date);
  }

  let slots: Array<{ start: string; end: string; localDate: string; localTime: string; remaining?: number | null }>;
  if (target.kind === "booking") {
    slots = (await listAvailableBookingSlots(env, {
      siteId: context.site.id,
      offer: target.offer,
      localDates,
      timezone,
    })).map((slot) => ({
      start: slot.startsAt,
      end: slot.endsAt,
      localDate: slot.localDate,
      localTime: slot.localTime,
    }));
  } else {
    const occurrences: EventOccurrence[] = [];
    if (target.offer.bookingType === "class") {
      for (const date of localDates) {
        const occurrence = resolveEventOccurrence(target.offer, date);
        if (occurrence) occurrences.push(occurrence);
      }
    } else {
      const occurrence = resolveEventOccurrence(target.offer);
      if (occurrence) occurrences.push(occurrence);
    }
    slots = [];
    for (const occurrence of occurrences) {
      if (occurrence.startsAtMs <= Date.now() + 5 * 60_000) continue;
      const capacity = await getEventOccurrenceAvailability(env, {
        siteId: context.site.id,
        offer: target.offer,
        occurrence,
      });
      if (capacity.soldOut) continue;
      slots.push({
        start: occurrence.startsAt,
        end: occurrence.endsAt,
        localDate: occurrence.localDate,
        localTime: occurrence.localTime,
        remaining: capacity.remaining,
      });
    }
  }

  slots = slots.filter((slot) => {
    const start = Date.parse(slot.start);
    return start >= window.fromMs && start < window.toMs;
  });
  return {
    offeringId,
    kind: offering.kind,
    timezone,
    from: new Date(window.fromMs).toISOString(),
    to: new Date(window.toMs).toISOString(),
    available: slots.length > 0,
    slots,
  };
}

/**
 * `from` and `to` are seller-local dates (YYYY-MM-DD, inclusive) or RFC 3339
 * instants. The default is the next seven days.
 */
function availabilityWindow(
  range: { from?: string; to?: string },
  timezone: string,
): { fromDate: string; toDate: string; fromMs: number; toMs: number } {
  const parse = (value: string | undefined, end: boolean): { date: string; ms: number } | null => {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = end ? addDaysToDateString(value, 1) : value;
      return { date: value, ms: localMidnightMs(date, timezone) };
    }
    const ms = Date.parse(value);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(ms)) {
      throw new AgentCommerceError("from and to must be dates (YYYY-MM-DD) or RFC 3339 times.", 400, "invalid_range");
    }
    const local = formatUtcInstantInTimeZone(ms, timezone);
    if (!local) throw new AgentCommerceError("The seller timezone is not valid.", 400, "invalid_range");
    return { date: local.localDate, ms };
  };

  const today = formatUtcInstantInTimeZone(Date.now(), timezone)?.localDate || new Date().toISOString().slice(0, 10);
  const from = parse(range.from, false) || { date: today, ms: localMidnightMs(today, timezone) };
  const to = parse(range.to, true) || (() => {
    const lastDate = addDaysToDateString(from.date, DEFAULT_AVAILABILITY_DAYS - 1);
    return { date: lastDate, ms: localMidnightMs(addDaysToDateString(lastDate, 1), timezone) };
  })();
  if (to.ms <= from.ms) {
    throw new AgentCommerceError("to must be after from.", 400, "invalid_range");
  }
  if (to.ms - from.ms > MAX_AVAILABILITY_DAYS * 24 * 60 * 60_000 + 2 * 60 * 60_000) {
    throw new AgentCommerceError(`Ask for at most ${MAX_AVAILABILITY_DAYS} days at a time.`, 400, "invalid_range");
  }
  return { fromDate: from.date, toDate: to.date, fromMs: from.ms, toMs: to.ms };
}

function localMidnightMs(date: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return getUtcMsForLocalTime({ year, month, day, hour: 0, minute: 0 }, timezone);
}

// ---------------------------------------------------------------------------
// Checkouts

type CheckoutInput = {
  offeringId: string;
  idempotencyKey: string;
  buyerName: string;
  buyerEmail: string;
  quantity: number;
  slotStart: string | null;
  slotEnd: string | null;
  expectedAmount: number;
  expectedCurrency: string;
};

function parseCheckoutInput(value: unknown): CheckoutInput {
  const body = isRecord(value) ? value : {};
  const invalid = (message: string) => new AgentCommerceError(message, 400, "invalid_request");
  const offeringId = typeof body.offeringId === "string" ? body.offeringId.trim() : "";
  if (!offeringId || offeringId.length > 200) throw invalid("offeringId is required.");
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!/^[\x21-\x7e]{8,200}$/.test(idempotencyKey)) {
    throw invalid("idempotencyKey must be 8 to 200 visible ASCII characters.");
  }
  const buyer = isRecord(body.buyer) ? body.buyer : {};
  const buyerName = normalizeShortText(buyer.name, 120);
  const buyerEmail = normalizeEmail(buyer.email);
  if (!buyerName) throw invalid("buyer.name is required.");
  if (!buyerEmail) throw invalid("buyer.email must be a valid email address.");
  const quantity = body.quantity === undefined || body.quantity === null ? 1 : body.quantity;
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 1) {
    throw invalid("quantity must be a positive whole number.");
  }
  if (!Number.isSafeInteger(body.expectedAmount) || (body.expectedAmount as number) < 0) {
    throw invalid("expectedAmount must be the total in minor units (for example 6000 for 60.00).");
  }
  const expectedCurrency = currencyCode(body.expectedCurrency);
  if (!expectedCurrency) throw invalid("expectedCurrency must be a three-letter currency code.");

  let slotStart: string | null = null;
  let slotEnd: string | null = null;
  if (body.slot !== undefined && body.slot !== null) {
    const slot = isRecord(body.slot) ? body.slot : null;
    slotStart = slot ? normalizeInstant(slot.start) : null;
    if (!slotStart) throw invalid("slot.start must be an RFC 3339 time from the availability endpoint.");
    if (slot?.end !== undefined) {
      slotEnd = normalizeInstant(slot.end);
      if (!slotEnd) throw invalid("slot.end must be an RFC 3339 time.");
    }
  }

  return {
    offeringId,
    idempotencyKey,
    buyerName,
    buyerEmail,
    quantity: quantity as number,
    slotStart,
    slotEnd,
    expectedAmount: body.expectedAmount as number,
    expectedCurrency,
  };
}

function normalizeInstant(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function createAgentCheckout(
  env: Env,
  context: AgentCommerceContext,
  body: unknown,
): Promise<{ created: boolean; checkout: AgentCheckoutView & { statusSecret: string; statusUrl: string } }> {
  const input = parseCheckoutInput(body);
  const scope = context.caller.installId ? `install:${context.caller.installId}` : "anonymous";
  const requestHash = await sha256Hex(JSON.stringify([
    input.offeringId,
    input.slotStart,
    input.quantity,
    input.buyerName,
    input.buyerEmail,
    input.expectedAmount,
    input.expectedCurrency,
  ]));

  const replay = await replayCheckout(env, context, scope, input.idempotencyKey, requestHash);
  if (replay) return replay;

  const { offering, target } = await findAgentOffering(env, context, input.offeringId);
  const total = offering.amount * input.quantity;
  if (input.expectedCurrency !== offering.currency || input.expectedAmount !== total) {
    throw new AgentCommerceError(
      "The price has changed. Check the offering again and ask the buyer to approve the new price.",
      409,
      "price_changed",
      { amount: total, currency: offering.currency, unitAmount: offering.amount },
    );
  }

  const plan = planCheckout(input, target);
  const provider = offering.free ? null : await resolveCheckoutProvider(env, context.site.user_id);
  if (!offering.free && !provider) {
    throw new AgentCommerceError("Payments are not available for this site right now.", 503, "commerce_unavailable");
  }

  const checkoutId = crypto.randomUUID();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const holdExpiresAt = new Date(nowMs + AGENT_CHECKOUT_HOLD_MINUTES * 60_000).toISOString();
  const claimed = await env.DB.prepare(
    `INSERT INTO agent_commerce_checkouts
     (id, site_id, idempotency_scope, idempotency_key, request_hash, offering_id, offering_kind,
      buyer_install_id, buyer_name, buyer_email, quantity, slot_start, slot_end, amount_minor,
      currency, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?)
     ON CONFLICT(site_id, idempotency_scope, idempotency_key) DO NOTHING`,
  )
    .bind(
      checkoutId,
      context.site.id,
      scope,
      input.idempotencyKey,
      requestHash,
      offering.id,
      offering.kind,
      context.caller.installId,
      input.buyerName,
      input.buyerEmail,
      input.quantity,
      plan.slot?.startsAt || null,
      plan.slot?.endsAt || null,
      total,
      offering.currency,
      holdExpiresAt,
      now,
      now,
    )
    .run();
  if (!Number(claimed.meta.changes || 0)) {
    const concurrent = await replayCheckout(env, context, scope, input.idempotencyKey, requestHash);
    if (concurrent) return concurrent;
    throw new AgentCommerceError("This checkout is still being created. Retry shortly.", 409, "checkout_in_progress");
  }

  let outcome: CheckoutOutcome;
  try {
    outcome = await executeCheckout(env, context, input, target, plan, provider, {
      holdExpiresAt,
      sessionExpiresAtMs: nowMs + PAYMENT_WINDOW_MINUTES * 60_000,
    });
  } catch (error) {
    // Release the idempotency claim so a retry with the same key can try again.
    await env.DB.prepare("DELETE FROM agent_commerce_checkouts WHERE id = ? AND status = 'creating'")
      .bind(checkoutId)
      .run();
    if (error instanceof CommerceOrderInputError) {
      throw new AgentCommerceError(
        error.message,
        error.status === 404 ? 404 : error.status === 409 ? 409 : error.status === 503 || error.status === 502 ? 503 : 400,
        error.status === 409 ? "checkout_refused" : error.status >= 500 ? "commerce_unavailable" : "invalid_request",
      );
    }
    throw error;
  }

  await env.DB.prepare(
    `UPDATE agent_commerce_checkouts
     SET status = ?, provider = ?, provider_session_id = ?, provider_checkout_url = ?,
         hold_token = ?, order_id = ?, booking_id = ?, paid_amount_minor = ?, paid_currency = ?,
         paid_at = ?, expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'creating'`,
  )
    .bind(
      outcome.status,
      outcome.provider,
      outcome.sessionId || null,
      outcome.checkoutUrl || null,
      outcome.holdToken || null,
      outcome.orderId || null,
      outcome.bookingId || null,
      outcome.status === "paid" ? 0 : null,
      outcome.status === "paid" ? offering.currency : null,
      outcome.status === "paid" ? now : null,
      outcome.status === "paid" ? now : holdExpiresAt,
      now,
      checkoutId,
    )
    .run();

  const row = await loadCheckout(env, context.site.id, checkoutId);
  if (!row) throw new Error("Agent checkout could not be loaded");
  return { created: true, checkout: await withStatusSecret(env, context, row) };
}

async function replayCheckout(
  env: Env,
  context: AgentCommerceContext,
  scope: string,
  idempotencyKey: string,
  requestHash: string,
) {
  const existing = await env.DB.prepare(
    `SELECT * FROM agent_commerce_checkouts
     WHERE site_id = ? AND idempotency_scope = ? AND idempotency_key = ?`,
  )
    .bind(context.site.id, scope, idempotencyKey)
    .first<AgentCheckoutRow>();
  if (!existing) return null;
  if (existing.request_hash !== requestHash) {
    throw new AgentCommerceError(
      "This idempotencyKey was already used for a different checkout. Use a new key for a new purchase.",
      409,
      "idempotency_conflict",
    );
  }
  if (existing.status === "creating") {
    // A claim left behind by an interrupted request must not block its key.
    if (Date.parse(existing.created_at) < Date.now() - ABANDONED_CLAIM_MS) {
      await env.DB.prepare("DELETE FROM agent_commerce_checkouts WHERE id = ? AND status = 'creating'")
        .bind(existing.id)
        .run();
      return null;
    }
    throw new AgentCommerceError("This checkout is still being created. Retry shortly.", 409, "checkout_in_progress");
  }
  const refreshed = await refreshCheckout(env, context.site, existing);
  return { created: false, checkout: await withStatusSecret(env, context, refreshed) };
}

type CheckoutPlan = {
  slot: BookingSlot | null;
  occurrence: EventOccurrence | null;
};

function planCheckout(input: CheckoutInput, target: OfferingTarget): CheckoutPlan {
  const invalidSlot = (message: string) => new AgentCommerceError(message, 400, "invalid_slot");
  if (target.kind === "product") {
    if (input.quantity !== 1) throw new AgentCommerceError("Products are bought one at a time.", 400, "invalid_quantity");
    if (input.slotStart) throw invalidSlot("Products do not take a slot.");
    return { slot: null, occurrence: null };
  }

  if (target.kind === "booking") {
    if (input.quantity !== 1) throw new AgentCommerceError("Bookings are for one person.", 400, "invalid_quantity");
    if (!input.slotStart) throw new AgentCommerceError("slot is required for bookings.", 400, "slot_required");
    const end = new Date(Date.parse(input.slotStart) + target.offer.duration * 60_000).toISOString();
    if (input.slotEnd && input.slotEnd !== end) throw invalidSlot("slot.end does not match the offering duration.");
    const slot = resolvePublicBookingSlot({
      slotStart: input.slotStart,
      slotEnd: end,
      durationMinutes: target.offer.duration,
      timezone: resolveTimeZone(target.offer.availability.timezone),
    });
    if ("error" in slot) throw invalidSlot(slot.error);
    return { slot, occurrence: null };
  }

  const offer = target.offer;
  if (!normalizeAttendeeQuantity(input.quantity, offer.capacity)) {
    throw new AgentCommerceError("Choose a valid number of attendees.", 400, "invalid_quantity");
  }
  let occurrence: EventOccurrence | null;
  if (offer.bookingType === "class") {
    if (!input.slotStart) throw new AgentCommerceError("slot is required for classes.", 400, "slot_required");
    const localDate = formatUtcInstantInTimeZone(Date.parse(input.slotStart), offer.timezone)?.localDate || "";
    occurrence = resolveEventOccurrence(offer, localDate);
    if (!occurrence || occurrence.startsAt !== input.slotStart) {
      throw invalidSlot("That time is not a scheduled class session.");
    }
  } else {
    occurrence = resolveEventOccurrence(offer);
    if (!occurrence) throw invalidSlot("The retreat dates are not configured correctly.");
    if (input.slotStart && input.slotStart !== occurrence.startsAt) {
      throw invalidSlot("slot.start does not match the retreat dates.");
    }
  }
  if (input.slotEnd && input.slotEnd !== occurrence.endsAt) throw invalidSlot("slot.end does not match the event.");
  if (occurrence.startsAtMs <= Date.now() + 5 * 60_000) {
    throw new AgentCommerceError("This event is no longer available to book.", 409, "slot_unavailable");
  }
  return {
    slot: {
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      startsAtMs: occurrence.startsAtMs,
      localDate: occurrence.localDate,
      localTime: occurrence.localTime,
    },
    occurrence,
  };
}

type CheckoutOutcome = {
  status: "pending" | "paid";
  provider: "stripe_direct" | "me3_cloud" | "none";
  sessionId?: string;
  checkoutUrl?: string | null;
  holdToken?: string;
  orderId?: string;
  bookingId?: string;
};

async function executeCheckout(
  env: Env,
  context: AgentCommerceContext,
  input: CheckoutInput,
  target: OfferingTarget,
  plan: CheckoutPlan,
  provider: CheckoutProvider | null,
  timing: { holdExpiresAt: string; sessionExpiresAtMs: number },
): Promise<CheckoutOutcome> {
  const { site } = context;
  const sessionExpiresAtSeconds = Math.floor(timing.sessionExpiresAtMs / 1000);
  const managedSessionExpiresAt = new Date(timing.sessionExpiresAtMs).toISOString();
  const refused = (result: { error: string; status: number }) =>
    new AgentCommerceError(
      result.error,
      result.status === 409 ? 409 : result.status === 503 ? 503 : result.status === 404 ? 404 : 400,
      result.status === 409 ? "slot_unavailable" : result.status === 503 ? "commerce_unavailable" : "invalid_slot",
    );

  if (target.kind === "product") {
    const order = await createProductCheckout(
      env,
      site,
      target.slug,
      {
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
        expectedAmount: input.expectedAmount,
        expectedCurrency: input.expectedCurrency,
        campaign: AGENT_CHECKOUT_CAMPAIGN,
      },
      context.requestUrl,
      context.country,
      { sessionExpiresAtSeconds, managedSessionExpiresAt },
    );
    if (order.paymentMethod !== "stripe" || !order.url || !order.sessionId) {
      throw new AgentCommerceError("This product cannot be bought by an agent.", 409, "checkout_refused");
    }
    return {
      status: "pending",
      provider: provider?.kind || "stripe_direct",
      sessionId: order.sessionId,
      checkoutUrl: order.url,
      orderId: order.orderId,
    };
  }

  const profile = await loadSiteProfileForCommerce(env, site, context.country);
  const returnUrl = normalizeSiteCheckoutReturnUrl(undefined, context.requestUrl, env, site);
  const shared = {
    guestName: input.buyerName,
    guestEmail: input.buyerEmail,
    notes: "",
    pageId: "",
    actionId: "",
    campaign: AGENT_CHECKOUT_CAMPAIGN,
  };

  if (target.kind === "booking") {
    const offer = target.offer;
    if (!offer.pricing?.enabled) {
      const result = await bookFreeOneToOne(env, {
        site,
        profile,
        bookIntent: target.bookIntent,
        offer,
        slot: plan.slot!,
        ...shared,
      });
      if (!result.ok) throw refused(result);
      if (!result.booking) throw new Error("Free booking could not be loaded");
      return { status: "paid", provider: "none", bookingId: result.booking.id };
    }
    const amount = normalizeBookingAmount(offer.pricing.suggestedAmount, offer.pricing, input.expectedCurrency);
    if (!amount.ok) throw new AgentCommerceError(amount.error, 409, "checkout_refused");
    const result = await startPaidOneToOneCheckout(env, {
      site,
      provider: provider!,
      offer: offer as ResolvedPaidBookingOffer,
      amount,
      slot: plan.slot!,
      ...shared,
      returnUrl,
      holdExpiresAt: timing.holdExpiresAt,
      sessionExpiresAtSeconds,
      managedSessionExpiresAt,
    });
    if (!result.ok) throw refused(result);
    return {
      status: "pending",
      provider: provider!.kind,
      sessionId: result.sessionId,
      checkoutUrl: result.url,
      holdToken: result.holdToken,
    };
  }

  const offer = target.offer;
  if (!offer.pricing?.enabled) {
    const booking = await createConfirmedEventBooking(env, {
      site,
      bookIntent: target.bookIntent,
      offer,
      occurrence: plan.occurrence!,
      quantity: input.quantity,
      ...shared,
    });
    if (!booking) {
      throw new AgentCommerceError("There are not enough spaces left for that booking.", 409, "slot_unavailable");
    }
    return { status: "paid", provider: "none", bookingId: booking.id };
  }
  const amount = normalizeBookingAmount(offer.pricing.suggestedAmount, offer.pricing, input.expectedCurrency);
  if (!amount.ok) throw new AgentCommerceError(amount.error, 409, "checkout_refused");
  const result = await startPaidEventCheckout(env, {
    site,
    provider: provider!,
    offer,
    occurrence: plan.occurrence!,
    quantity: input.quantity,
    amount,
    ...shared,
    returnUrl,
    holdExpiresAt: timing.holdExpiresAt,
    sessionExpiresAtSeconds,
    managedSessionExpiresAt,
  });
  if (!result.ok) throw refused(result);
  return {
    status: "pending",
    provider: provider!.kind,
    sessionId: result.sessionId,
    checkoutUrl: result.url,
    holdToken: result.holdToken,
  };
}

export async function getAgentCheckout(
  env: Env,
  context: Pick<AgentCommerceContext, "site" | "requestUrl">,
  checkoutId: string,
  statusSecret: string,
): Promise<AgentCheckoutView> {
  const row = await loadCheckout(env, context.site.id, checkoutId);
  // Unknown checkouts and wrong secrets look the same.
  if (!row || row.status === "creating" || !statusSecret ||
      !constantTimeEqual(statusSecret, await checkoutStatusSecret(env, row.id))) {
    throw new AgentCommerceError("Checkout not found.", 404, "checkout_not_found");
  }
  return checkoutView(await refreshCheckout(env, context.site, row), context);
}

/**
 * The buyer's payment link. Opening it inside the hold keeps the slot until the
 * Stripe session closes; after the hold it refuses, so an unopened checkout can
 * never be paid once its slot is released.
 */
export async function openAgentCheckoutPayment(
  env: Env,
  site: DbSite,
  checkoutId: string,
): Promise<string> {
  const loaded = await loadCheckout(env, site.id, checkoutId);
  if (!loaded || loaded.status === "creating") {
    throw new AgentCommerceError("Checkout not found.", 404, "checkout_not_found");
  }
  const row = await refreshCheckout(env, site, loaded);
  if (row.status === "paid") throw new AgentCommerceError("This checkout is already paid.", 409, "checkout_paid");
  if (row.status !== "pending" || !row.provider_checkout_url) {
    throw new AgentCommerceError(
      "This checkout has expired. Ask your assistant to start a new one.",
      410,
      "checkout_expired",
    );
  }
  if (row.opened_at) return row.provider_checkout_url;

  const nowMs = Date.now();
  const windowEnd = new Date(Date.parse(row.created_at) + PAYMENT_WINDOW_MINUTES * 60_000).toISOString();
  const holdEnd = new Date(Date.parse(windowEnd) + CONFIRMATION_GRACE_MINUTES * 60_000).toISOString();
  if (row.hold_token) {
    const extended = await env.DB.prepare(
      `UPDATE booking_holds SET expires_at = ?, updated_at = datetime('now')
       WHERE hold_token = ? AND status = 'active' AND datetime(expires_at) > datetime('now')`,
    )
      .bind(holdEnd, row.hold_token)
      .run();
    if (!Number(extended.meta.changes || 0)) {
      await markCheckout(env, row, { status: "expired" });
      throw new AgentCommerceError(
        "This checkout has expired. Ask your assistant to start a new one.",
        410,
        "checkout_expired",
      );
    }
  }
  await env.DB.prepare(
    `UPDATE agent_commerce_checkouts SET opened_at = ?, expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending' AND opened_at IS NULL`,
  )
    .bind(new Date(nowMs).toISOString(), windowEnd, new Date(nowMs).toISOString(), row.id)
    .run();
  return row.provider_checkout_url;
}

/** Background sweep for checkouts nobody polled: settle or expire them. */
export async function expireStaleAgentCheckouts(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM agent_commerce_checkouts
     WHERE status = 'pending' AND expires_at < ?
     ORDER BY expires_at ASC LIMIT 25`,
  )
    .bind(new Date().toISOString())
    .all<AgentCheckoutRow>();
  await env.DB.prepare(
    "DELETE FROM agent_commerce_checkouts WHERE status = 'creating' AND created_at < ?",
  )
    .bind(new Date(Date.now() - ABANDONED_CLAIM_MS).toISOString())
    .run();
  for (const row of results || []) {
    const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(row.site_id).first<DbSite>();
    if (!site) continue;
    await refreshCheckout(env, site, row).catch((error) =>
      console.error("Agent checkout sweep failed", row.id, error instanceof Error ? error.message : "Unknown error"),
    );
  }
  await pruneAgentCommerceRateLimits(env);
}

async function refreshCheckout(env: Env, site: DbSite, row: AgentCheckoutRow): Promise<AgentCheckoutRow> {
  if (row.status === "paid") {
    const cancelled = row.booking_id
      ? (await env.DB.prepare("SELECT status FROM bookings WHERE id = ? AND site_id = ?")
          .bind(row.booking_id, site.id).first<{ status: string }>())?.status === "cancelled"
      : row.order_id
        ? (await env.DB.prepare("SELECT status FROM commerce_orders WHERE id = ? AND site_id = ?")
            .bind(row.order_id, site.id).first<{ status: string }>())?.status === "refunded"
        : false;
    return cancelled ? markCheckout(env, row, { status: "cancelled" }) : row;
  }
  if (row.status !== "pending") return row;

  let settled = await readSettlement(env, site, row);
  // Nobody can pay a checkout whose payment link was never opened.
  if (!settled && row.opened_at && row.provider_session_id) {
    await settleWithProvider(env, site, row);
    settled = await readSettlement(env, site, row);
  }
  if (settled) return markCheckout(env, row, { status: "paid", ...settled });

  // An opened checkout keeps the confirmation grace its hold was given.
  const grace = row.opened_at ? CONFIRMATION_GRACE_MINUTES * 60_000 : 0;
  if (Date.parse(row.expires_at) + grace <= Date.now()) {
    if (row.hold_token) {
      await env.DB.prepare(
        `UPDATE booking_holds SET status = 'expired', updated_at = datetime('now')
         WHERE hold_token = ? AND status = 'active' AND datetime(expires_at) <= datetime('now')`,
      )
        .bind(row.hold_token)
        .run();
    }
    return markCheckout(env, row, { status: "expired" });
  }
  return row;
}

async function readSettlement(
  env: Env,
  site: DbSite,
  row: AgentCheckoutRow,
): Promise<{ bookingId?: string; paidAmount: number; paidCurrency: string; paidAt: string } | null> {
  if (row.order_id) {
    const order = await env.DB.prepare(
      "SELECT status, amount_paid, currency, paid_at FROM commerce_orders WHERE id = ? AND site_id = ?",
    )
      .bind(row.order_id, site.id)
      .first<{ status: string; amount_paid: number | null; currency: string | null; paid_at: string | null }>();
    if (order?.status !== "paid") return null;
    return {
      paidAmount: Number(order.amount_paid || 0),
      paidCurrency: String(order.currency || row.currency).toUpperCase(),
      paidAt: sqliteTimeToIso(order.paid_at) || new Date().toISOString(),
    };
  }
  if (!row.hold_token) return null;
  const booking = await env.DB.prepare(
    `SELECT b.id, b.amount_paid, b.currency, b.paid_at
     FROM booking_holds h JOIN bookings b ON b.id = h.booking_id
     WHERE h.hold_token = ? AND h.site_id = ? AND h.status = 'confirmed'`,
  )
    .bind(row.hold_token, site.id)
    .first<{ id: string; amount_paid: number | null; currency: string | null; paid_at: string | null }>();
  if (!booking) return null;
  return {
    bookingId: booking.id,
    paidAmount: Number(booking.amount_paid || 0),
    paidCurrency: String(booking.currency || row.currency).toUpperCase(),
    paidAt: sqliteTimeToIso(booking.paid_at) || new Date().toISOString(),
  };
}

// Same verification the site's own return page runs, for buyers who never
// reach it and installations without a webhook.
async function settleWithProvider(env: Env, site: DbSite, row: AgentCheckoutRow): Promise<void> {
  const sessionId = row.provider_session_id!;
  try {
    if (row.offering_kind === "product") {
      await completeProductCheckout(env, site, sessionId);
      return;
    }
    let session: Stripe.Checkout.Session;
    if (row.provider === "stripe_direct") {
      const stripe = await getStripe(env, site.user_id);
      if (!stripe) return;
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } else {
      session = await retrieveManagedBookingCheckout(env, sessionId);
    }
    if (session.payment_status !== "paid") return;
    const result = row.offering_kind === "event"
      ? await finalizePaidEventBookingCheckout(env, site, session)
      : await finalizePaidBookingCheckout(env, site, session);
    if ("error" in result) console.error("Agent checkout confirmation failed", row.id, result.error);
  } catch (error) {
    if (error instanceof CommerceOrderInputError && error.status < 500) return;
    console.error("Agent checkout provider check failed", row.id, error instanceof Error ? error.message : "Unknown error");
  }
}

async function markCheckout(
  env: Env,
  row: AgentCheckoutRow,
  change:
    | { status: "expired" | "cancelled" }
    | { status: "paid"; bookingId?: string; paidAmount: number; paidCurrency: string; paidAt: string },
): Promise<AgentCheckoutRow> {
  const now = new Date().toISOString();
  if (change.status === "paid") {
    await env.DB.prepare(
      `UPDATE agent_commerce_checkouts
       SET status = 'paid', booking_id = COALESCE(?, booking_id), paid_amount_minor = ?,
           paid_currency = ?, paid_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
      .bind(change.bookingId || null, change.paidAmount, change.paidCurrency, change.paidAt, now, row.id)
      .run();
  } else {
    // Expiry only ends a pending checkout; cancellation only follows a paid one.
    await env.DB.prepare(
      `UPDATE agent_commerce_checkouts SET status = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
    )
      .bind(change.status, now, row.id, change.status === "expired" ? "pending" : "paid")
      .run();
  }
  return (await loadCheckout(env, row.site_id, row.id)) || row;
}

async function loadCheckout(env: Env, siteId: string, checkoutId: string): Promise<AgentCheckoutRow | null> {
  return (
    (await env.DB.prepare("SELECT * FROM agent_commerce_checkouts WHERE id = ? AND site_id = ?")
      .bind(checkoutId, siteId)
      .first<AgentCheckoutRow>()) || null
  );
}

function checkoutView(
  row: AgentCheckoutRow,
  context: Pick<AgentCommerceContext, "site" | "requestUrl">,
): AgentCheckoutView {
  const base = agentCommerceSiteBase(new URL(context.requestUrl).origin, context.site.username);
  return {
    checkoutId: row.id,
    status: row.status === "creating" ? "pending" : row.status,
    offeringId: row.offering_id,
    kind: row.offering_kind,
    quantity: row.quantity,
    slot: row.slot_start && row.slot_end ? { start: row.slot_start, end: row.slot_end } : null,
    amount: row.amount_minor,
    currency: row.currency,
    payUrl: row.status === "pending" && row.provider_checkout_url
      ? `${base}/checkouts/${encodeURIComponent(row.id)}/pay`
      : null,
    expiresAt: row.expires_at,
    reference: row.booking_id
      ? { type: "booking", id: row.booking_id }
      : row.order_id
        ? { type: "order", id: row.order_id }
        : null,
    paidAmount: row.paid_amount_minor,
    paidCurrency: row.paid_currency,
    paidAt: row.paid_at,
  };
}

async function withStatusSecret(env: Env, context: AgentCommerceContext, row: AgentCheckoutRow) {
  const view = checkoutView(row, context);
  const base = agentCommerceSiteBase(new URL(context.requestUrl).origin, context.site.username);
  return {
    ...view,
    statusSecret: await checkoutStatusSecret(env, row.id),
    statusUrl: `${base}/checkouts/${encodeURIComponent(row.id)}`,
  };
}

// Derived rather than stored, so an idempotent retry can return the same secret.
async function checkoutStatusSecret(env: Env, checkoutId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await getOrCreateInstallEncryptionKey(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`me3:agent-checkout-status:v1:${checkoutId}`),
  );
  return base64Url(new Uint8Array(signature));
}

// ---------------------------------------------------------------------------
// Callers and rate limits

/**
 * A buyer installation may send `ME3-Buyer-Install: <JWT>` signed by ME3 Cloud
 * (`aud` me3-agent-commerce, `install_id` core_…, at most 15 minutes long).
 * Without it the caller is anonymous and limited by IP, like the site's own
 * checkout. A header that fails verification is refused rather than ignored.
 */
export async function identifyAgentCommerceCaller(env: Env, request: Request): Promise<AgentCommerceCaller> {
  const token = request.headers.get(BUYER_INSTALL_HEADER)?.trim();
  if (token) {
    try {
      const claims = await verifyMe3CloudJwt<{
        iss?: unknown;
        exp?: unknown;
        iat?: unknown;
        aud?: unknown;
        install_id?: unknown;
      }>(env, token);
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const installId = typeof claims.install_id === "string" ? claims.install_id : "";
      const issuedAt = typeof claims.iat === "number" ? claims.iat : Math.floor(Date.now() / 1000);
      if (
        !audiences.includes(BUYER_INSTALL_AUDIENCE) ||
        !/^core_[0-9a-f-]{36}$/.test(installId) ||
        (claims.exp as number) - issuedAt > BUYER_INSTALL_MAX_LIFETIME_SECONDS
      ) {
        throw new AgentCommerceError("The buyer installation header is not valid.", 401, "invalid_buyer_install");
      }
      return { key: `install:${installId}`, installId };
    } catch (error) {
      if (error instanceof AgentCommerceError) throw error;
      if (!(error instanceof Me3CloudJwtVerificationError) || error.kind === "invalid") {
        throw new AgentCommerceError("The buyer installation header is not valid.", 401, "invalid_buyer_install");
      }
      // ME3 Cloud keys are unavailable: fall back to anonymous limits.
    }
  }
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip")?.trim() || forwardedFor || request.headers.get("x-real-ip")?.trim();
  return { key: ip ? `ip:${(await sha256Hex(`me3:agent-commerce:${ip}`)).slice(0, 32)}` : "ip:unknown", installId: null };
}

export async function enforceAgentCommerceRateLimit(
  env: Env,
  bucket: keyof typeof AGENT_COMMERCE_RATE_LIMITS,
  caller: AgentCommerceCaller,
): Promise<void> {
  const policy = AGENT_COMMERCE_RATE_LIMITS[bucket];
  const limit = caller.installId ? policy.install : policy.anonymous;
  const { count, retryAfterSeconds } = await countAgentCommerceRequest(
    env,
    `${bucket}:${caller.key}`,
    policy.windowSeconds,
  );
  if (count > limit) {
    throw new AgentCommerceError("Too many requests. Try again later.", 429, "rate_limited", {
      retryAfterSeconds,
    });
  }
}

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sqliteTimeToIso(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

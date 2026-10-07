import { describe, expect, it } from "vitest";
import {
  createConfirmedOneToOneBooking,
  normalizeBookingAmount,
  normalizeSiteCheckoutReturnUrl,
  listOneToOneBookingOffers,
  resolvePaidOneToOneOffer,
  serializePublicBookingOffer,
  type CoreBookIntent,
  type ResolvedOneToOneBookingOffer,
} from "./booking";
import type { DbBooking, DbSite, Env } from "./types";
import { localizeRegionalPrices } from "../../../shared/regional-pricing";

it("validates fixed booking amounts and currencies against the country price", () => {
  const pricing = { enabled: true, suggestedAmount: 50, currency: "USD", allowFlexiblePricing: false, regionalPrices: [{ country: "PK", currency: "PKR", amount: 800000 }] };
  const pk = localizeRegionalPrices(pricing, "PK");
  expect(normalizeBookingAmount(8000, pk, "PKR")).toEqual({ ok: true, amountCents: 800000, currency: "pkr" });
  expect(normalizeBookingAmount(50, pk, "USD").ok).toBe(false);
  expect(normalizeBookingAmount(8000, pk, "USD").ok).toBe(false);
  expect(normalizeBookingAmount(undefined, pricing)).toEqual({ ok: true, amountCents: 5000, currency: "usd" });
});

const site: DbSite = {
  id: "site-1",
  user_id: "owner",
  username: "owner",
  site_type: "profile",
  site_role: "profile",
  template_id: null,
  custom_domain: null,
  custom_domain_status: null,
  custom_domain_cf_id: null,
  created_at: "2026-07-31T10:00:00Z",
  updated_at: "2026-07-31T10:00:00Z",
  published_at: "2026-07-31T10:00:00Z",
};

const manualOffer: ResolvedOneToOneBookingOffer = {
  id: "session",
  title: "Session",
  duration: 60,
  availability: { timezone: "Europe/Dublin", windows: {} },
  pricing: {
    enabled: true,
    suggestedAmount: 80,
    currency: "EUR",
    paymentMethod: "manual",
    paymentInstructions: "Pay at https://pay.example/session",
  },
};

it("resolves each offer's own hours and keeps shared hours as the fallback", () => {
  const book = {
    enabled: true,
    availability: { timezone: "America/New_York", windows: { monday: ["09:00-17:00"] } },
    offers: [
      { id: "alignment", duration: 45, availability: { windows: { monday: ["19:00-21:00"] } } },
      { id: "calm", duration: 30 },
    ],
  } as CoreBookIntent;
  const [alignment, calm] = listOneToOneBookingOffers(book);
  expect(alignment.availability).toEqual({ timezone: "America/New_York", windows: { monday: ["19:00-21:00"] } });
  expect(calm.availability).toEqual(book.availability);
});

describe("public checkout returns", () => {
  const requestUrl = "https://owner.me3.app/api/book/owner/checkout-session";
  const publicSite = { ...site, custom_domain: "www.owner.example" };
  const env = {} as Env;

  it("preserves the public page and campaign after a managed domain proxy", () => {
    expect(normalizeSiteCheckoutReturnUrl(
      "https://www.owner.example/offers?campaign=beta#booking", requestUrl, env, publicSite,
    )).toBe("https://www.owner.example/offers?campaign=beta");
  });

  it.each([
    "https://evil.example/", "https://www.owner.example.evil.test/",
    "https://guest:secret@www.owner.example/", "http://www.owner.example/",
    "//evil.example/", "not-a-url", undefined,
  ])("rejects an untrusted or malformed return URL: %s", (value) => {
    expect(normalizeSiteCheckoutReturnUrl(value, requestUrl, env, publicSite))
      .toBe("https://www.owner.example/");
  });

  it("retains a public preview on the installation origin", () => {
    expect(normalizeSiteCheckoutReturnUrl(
      "https://owner.me3.app/me/offers?campaign=preview", requestUrl, env, site,
    )).toBe("https://owner.me3.app/me/offers?campaign=preview");
  });

  it("falls back to a public profile or organization page instead of the private app", () => {
    expect(normalizeSiteCheckoutReturnUrl(undefined, requestUrl, env, site))
      .toBe("https://owner.me3.app/me/");
    expect(normalizeSiteCheckoutReturnUrl(undefined, requestUrl, env, {
      ...site, site_role: "organization", username: "studio",
    })).toBe("https://owner.me3.app/site/studio/");
  });
});

describe("manual booking payments", () => {
  it("does not expose payment instructions or send manual offers to checkout", () => {
    const book = {
      enabled: true,
      offers: [manualOffer],
      availability: manualOffer.availability,
    } as CoreBookIntent;

    expect(resolvePaidOneToOneOffer(book, manualOffer.id)).toBeNull();
    expect(serializePublicBookingOffer(manualOffer)).toEqual({
      id: "session",
      title: "Session",
      duration: 60,
      pricing: {
        enabled: true,
        suggestedAmount: 80,
        currency: "EUR",
        paymentMethod: "manual",
      },
    });
  });

  it("stores the amount due while confirming without a payment intent", async () => {
    let insertValues: unknown[] = [];
    const booking: DbBooking = {
      id: "booking-1",
      site_id: site.id,
      offer_id: manualOffer.id,
      booking_type: "one_to_one",
      guest_name: "Guest",
      guest_email: "guest@example.com",
      starts_at: "2026-08-03T09:00:00.000Z",
      ends_at: "2026-08-03T10:00:00.000Z",
      duration_minutes: 60,
      calendar_event_id: null,
      status: "confirmed",
      notes: null,
      created_at: "2026-07-31T10:00:00Z",
      cancelled_at: null,
      payment_intent_id: null,
      amount_paid: null,
      suggested_amount: 9500,
      currency: "eur",
      payment_status: "not_required",
      is_free_booking: 0,
      paid_at: null,
    };
    const DB = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            if (sql.includes("INSERT INTO bookings")) insertValues = values;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
          async first<T>() {
            return (sql.includes("FROM bookings") ? booking : null) as T | null;
          },
        };
      },
    };

    const result = await createConfirmedOneToOneBooking(
      { DB } as unknown as Env,
      {
        site,
        bookIntent: { enabled: true } as CoreBookIntent,
        offer: manualOffer,
        guestName: "Guest",
        guestEmail: "guest@example.com",
        notes: "",
        slot: {
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
        },
        amountDueCents: 9500,
        paymentCurrency: "eur",
      },
    );

    expect(result).toEqual(booking);
    expect(insertValues).toEqual(expect.arrayContaining([9500, "eur", 0]));
    expect(insertValues).not.toContain(expect.stringMatching(/^pi_/));
  });
});

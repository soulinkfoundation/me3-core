import { describe, expect, it } from "vitest";
import { offerCanTakePayment, paidOffersFor } from "./gettingPaid";
import type { PaymentMethod } from "./payDirectly";
import type { CommerceSettingsResponse } from "./commerce";

const stripeOn = { configured: true } as CommerceSettingsResponse["stripe"];
const paypalEur = [{ id: "m1", kind: "paypal", enabled: true, link: "https://paypal.me/clara", currencies: ["EUR"] }] as unknown as PaymentMethod[];

describe("getting paid", () => {
  it("needs Stripe for card, a saved method or note for paying directly, and both to let them choose", () => {
    const card = { title: "1:1", currency: "EUR", paymentMethod: "stripe" as const };
    expect(offerCanTakePayment(card, [], null)).toBe(false);
    expect(offerCanTakePayment(card, [], stripeOn)).toBe(true);

    const direct = { title: "1:1", currency: "EUR", paymentMethod: "manual" as const };
    expect(offerCanTakePayment(direct, [], stripeOn)).toBe(false);
    expect(offerCanTakePayment({ ...direct, note: "Cash is fine" }, [], null)).toBe(true);

    const choose = { ...card, allowPayDirectly: true, note: "Cash is fine" };
    expect(offerCanTakePayment(choose, [], null)).toBe(false);
    expect(offerCanTakePayment(choose, [], stripeOn)).toBe(true);
    expect(offerCanTakePayment({ ...choose, note: "" }, paypalEur, stripeOn)).toBe(offerCanTakePayment({ title: "", currency: "EUR", paymentMethod: "manual" }, paypalEur, null));
  });

  it("lists only the step's paid offers, leaving out free ones and products sold elsewhere", () => {
    const wizard = {
      bookingsEnabled: true,
      shopEnabled: true,
      profile: {
        booking: {
          offers: [
            { title: "Intro call", pricing: { enabled: false, currency: "EUR", paymentMethod: "stripe" as const } },
            { title: "1:1 session", pricing: { enabled: true, currency: "EUR", paymentMethod: "stripe" as const } },
          ],
          classOffers: [],
          retreatOffers: [],
        },
      },
      products: [
        { title: "Guide", available: true, price: 900, currency: "EUR", paymentMethod: "stripe" as const },
        { title: "Book", available: true, price: 1500, currency: "EUR", paymentMethod: "stripe" as const, delivery: { kind: "external" } },
        { title: "Free sheet", available: true, price: 0, currency: "EUR", paymentMethod: "stripe" as const },
      ],
    };
    expect(paidOffersFor(wizard, "bookings").map((offer) => offer.title)).toEqual(["1:1 session"]);
    expect(paidOffersFor(wizard, "shop").map((offer) => offer.title)).toEqual(["Guide"]);
    expect(paidOffersFor({ ...wizard, bookingsEnabled: false }, "bookings")).toEqual([]);
  });
});

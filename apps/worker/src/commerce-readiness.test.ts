import { describe, expect, it } from "vitest";
import { profileRequiresCommerce } from "./commerce-readiness";

describe("profile commerce readiness", () => {
  it("does not gate free booking profiles", () => {
    expect(profileRequiresCommerce({
      version: "0.1",
      handle: "owner",
      name: "Owner",
      intents: {
        book: {
          enabled: true,
          offers: [{ pricing: { enabled: false } }],
        },
      },
    })).toBe(false);
  });

  it("gates paid bookings nested under booking types", () => {
    expect(profileRequiresCommerce({
      version: "0.1",
      handle: "owner",
      name: "Owner",
      intents: {
        book: {
          enabled: true,
          bookingTypes: [{ offers: [{ pricing: { enabled: true } }] }],
        },
      },
    })).toBe(true);
  });

  it("does not require Stripe for paid bookings collected separately", () => {
    expect(profileRequiresCommerce({
      version: "0.1",
      handle: "owner",
      name: "Owner",
      intents: {
        book: {
          enabled: true,
          offers: [
            {
              pricing: {
                enabled: true,
                paymentMethod: "manual",
                paymentInstructions: "Pay at https://pay.example/owner",
              },
            },
          ],
        },
      },
    })).toBe(false);
  });

  it("gates available products but ignores unavailable ones", () => {
    expect(profileRequiresCommerce({
      version: "0.1",
      handle: "owner",
      name: "Owner",
      products: [{ slug: "kit", available: true }],
    })).toBe(true);
    expect(profileRequiresCommerce({
      version: "0.1",
      handle: "owner",
      name: "Owner",
      products: [{ slug: "kit", available: false }],
    })).toBe(false);
    expect(profileRequiresCommerce({
      version: "0.1",
      handle: "owner",
      name: "Owner",
      products: [
        {
          slug: "manual-kit",
          available: true,
          paymentMethod: "manual",
          paymentInstructions: "Pay by bank transfer.",
        },
      ],
    })).toBe(false);
  });
});

describe("products sold on another platform", () => {
  it("never need Stripe because ME3 takes no payment", () => {
    expect(profileRequiresCommerce({
      name: "Shop",
      products: [{ slug: "book", title: "Book", price: 999, currency: "GBP", delivery: { kind: "external", instructions: "", url: "https://www.etsy.com/listing/1" } }],
    } as Parameters<typeof profileRequiresCommerce>[0])).toBe(false);
  });
});

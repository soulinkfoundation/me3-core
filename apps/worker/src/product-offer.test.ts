import { describe, expect, it } from "vitest";
import { productOfferError, productOption } from "../../../shared/product-offer";

const setAt = "2026-10-27T10:00:00.000Z";

describe("product stock and options", () => {
  it("accepts unlimited, counted and per-option stock", () => {
    expect(productOfferError({})).toBeNull();
    expect(productOfferError({ stock: 3, stockSetAt: setAt })).toBeNull();
    expect(productOfferError({ stockSetAt: setAt, options: [{ id: "a4", label: "A4", price: 2000 }, { id: "a3", label: "A3", price: 3500, stock: 0 }] })).toBeNull();
  });
  it("rejects stock it cannot count", () => {
    expect(productOfferError({ stock: -1, stockSetAt: setAt })).toBeTruthy();
    expect(productOfferError({ stock: 1.5, stockSetAt: setAt })).toBeTruthy();
    expect(productOfferError({ stock: 3 })).toBeTruthy();
  });
  it("rejects options buyers cannot pick or pay for", () => {
    expect(productOfferError({ options: [{ id: "a4", label: "A4", price: 2000 }, { id: "a4", label: "A4 again", price: 2000 }] })).toBeTruthy();
    expect(productOfferError({ options: [{ id: "a4", label: "", price: 2000 }] })).toBeTruthy();
    expect(productOfferError({ options: [{ id: "a4", label: "A4", price: 10 }] })).toBeTruthy();
    expect(productOfferError({ options: [{ id: "A 4", label: "A4", price: 2000 }] })).toBeTruthy();
    expect(productOfferError({ options: [{ id: "a4", label: "A4", price: 2000, stock: 2 }] })).toBeTruthy();
  });
  it("finds the chosen option", () => {
    const product = { options: [{ id: "a4", label: "A4", price: 2000 }] };
    expect(productOption(product, "a4")?.price).toBe(2000);
    expect(productOption(product, "a2")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { parseDeliveryAddress, productDeliveryError } from "../../../shared/product-delivery";
describe("physical delivery validation", () => {
  it("rejects incomplete or invalid shipping configuration", () => {
    expect(productDeliveryError({kind:"physical",returns:"Contact the seller for returns", instructions:"Ships in 3 days", countries:["IE"], shippingCost:-1})).toBeTruthy();
    expect(productDeliveryError({kind:"physical",returns:"Contact the seller for returns", instructions:"Ships in 3 days", countries:["ZZ"], shippingCost:0})).toBeTruthy();
    expect(productDeliveryError({kind:"physical",returns:"Contact the seller for returns", instructions:"Ships in 3 days", countries:["IE"], shippingCost:0})).toBeNull();
  });
  it("does not accept unsupported countries or incomplete addresses", () => {
    expect(() => parseDeliveryAddress({line1:"1 Main St",city:"Dublin",country:"US"}, ["IE"])).toThrow();
    expect(() => parseDeliveryAddress({country:"IE"}, ["IE"])).toThrow();
    expect(parseDeliveryAddress({line1:" 1 Main St ",city:"Dublin",country:"ie"}, ["IE"])).toMatchObject({line1:"1 Main St",country:"IE"});
  });
});

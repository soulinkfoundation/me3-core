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

describe("digital delivery validation", () => {
  const file = { id: "0f1e2d3c-aaaa-bbbb-cccc-111122223333", name: "prompts.pdf", size: 4_200_000, type: "application/pdf" };
  it("needs a private file of an allowed type", () => {
    expect(productDeliveryError({ kind: "digital", instructions: "" })).toBeTruthy();
    expect(productDeliveryError({ kind: "digital", instructions: "", file })).toBeNull();
    expect(productDeliveryError({ kind: "digital", instructions: "", file: { ...file, type: "text/html" } })).toBeTruthy();
    expect(productDeliveryError({ kind: "digital", instructions: "", file: { ...file, type: "image/svg+xml" } })).toBeTruthy();
    expect(productDeliveryError({ kind: "digital", instructions: "", file: { ...file, id: "../public/x" } })).toBeTruthy();
    expect(productDeliveryError({ kind: "digital", instructions: "", file: { ...file, size: 101 * 1024 * 1024 } })).toBeTruthy();
  });
});

describe("sold elsewhere validation", () => {
  it("needs an https link to the other shop", () => {
    expect(productDeliveryError({ kind: "external", instructions: "", url: "https://www.etsy.com/listing/123" })).toBeNull();
    expect(productDeliveryError({ kind: "external", instructions: "", url: "http://shop.example" })).toBeTruthy();
    expect(productDeliveryError({ kind: "external", instructions: "", url: "javascript:alert(1)" })).toBeTruthy();
    expect(productDeliveryError({ kind: "external", instructions: "" })).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import { localizeRegionalPrices, regionalPricingError, requestCountry } from "../../../shared/regional-pricing";
import { generateSiteHtml } from "@me3-core/site-renderer";
import { serveSiteFileResponse } from "./sites";
import type { DbSite, Env } from "./types";

// Failure modes: default/PK confusion, major/minor-unit confusion, altered amounts,
// lost nested booking prices, reused country HTML, and untrusted country headers.
const regionalPrices = [{ country: "PK", currency: "PKR", amount: 800000, shippingCost: 100000 }];
const profile = {
  name: "Example", handle: "example",
  products: [{ slug: "kit", title: "Kit", price: 5000, currency: "USD", regionalPrices,
    delivery: { kind: "physical" as const, instructions: "Ships next week", returns: "Contact us", shippingCost: 500, countries: ["PK", "US"] } }],
  intents: { book: { enabled: true, offers: [{ id: "session", title: "Session", duration: 60,
    pricing: { enabled: true, suggestedAmount: 50, currency: "USD", allowFlexiblePricing: false, regionalPrices } }],
    bookingTypes: [{ type: "class" as const, classes: [{ id: "class", title: "Class",
      pricing: { enabled: true, suggestedAmount: 50, currency: "USD", regionalPrices } }] }] } },
};

describe("regional pricing", () => {
  it("chooses trusted request metadata rather than headers supplied by a visitor", () => {
    const spoof = new Request("https://example.test", { headers: { "CF-IPCountry": "PK" } });
    expect(requestCountry(spoof)).toBeNull();
    Object.defineProperty(spoof, "cf", { value: { country: "PK" } });
    expect(requestCountry(spoof)).toBe("PK");
  });
  it.each(["US", "GB", null])("keeps fixed international amounts for %s", country => {
    expect(localizeRegionalPrices(profile, country).products[0]).toMatchObject({ price: 5000, currency: "USD", delivery: { shippingCost: 500 } });
  });
  it("uses PKR minor units for products and major units for every booking shape without mutating the source", () => {
    const localized = localizeRegionalPrices(profile, "PK");
    expect(localized.products[0]).toMatchObject({ price: 800000, currency: "PKR", delivery: { shippingCost: 100000 } });
    expect(localized.intents.book.offers[0].pricing).toMatchObject({ suggestedAmount: 8000, currency: "PKR", allowFlexiblePricing: false });
    expect(localized.intents.book.bookingTypes[0].classes[0].pricing).toMatchObject({ suggestedAmount: 8000, currency: "PKR", allowFlexiblePricing: false });
    expect(profile.products[0].price).toBe(5000);
    expect(profile.intents.book.offers[0].pricing.suggestedAmount).toBe(50);
  });
  it("rejects invalid regional amounts and missing shipping instead of reusing a USD shipping charge", () => {
    expect(regionalPricingError(profile)).toBeNull();
    expect(regionalPricingError({ price: 5000, currency: "USD", regionalPrices: [{ country: "PK", currency: "PKR", amount: -1 }] })).toBeTruthy();
    expect(regionalPricingError({ ...profile.products[0], regionalPrices: [{ country: "PK", currency: "PKR", amount: 100000 }] })).toContain("shipping");
    expect(regionalPricingError({ price: 5000, currency: "USD", regionalPrices: [...regionalPrices, ...regionalPrices] })).toContain("country");
  });
  it("generates PKR snapshots and keeps regional storage paths out of discovery files", async () => {
    const files = await generateSiteHtml(profile, [], undefined, { baseUrl: "https://example.test" });
    expect(files["shop/kit.html"]).toContain("50.00 USD");
    expect(files["_pricing/PK/shop/kit.html"]).toContain("8000.00 PKR");
    expect(files["_pricing/PK/shop/kit.html"]).toContain("1000.00 PKR");
    expect(files["_pricing/PK/index.html"]).toContain('"currency":"PKR"');
    expect(files["sitemap.xml"]).not.toContain("_pricing");
    expect(files["shop/kit.html"]).toContain('name="me3-pricing-countries" content="PK"');
  });
  it("serves country snapshots without shared caching and hides internal snapshot paths", async () => {
    const files = await generateSiteHtml(profile, []);
    const DB = { prepare() { let path = ""; return { bind(_id: string, value: string) { path = value; return this; }, async first() {
      const text = files[path.replace(/^public\//, "")];
      return text === undefined ? null : { path, content: new TextEncoder().encode(text), content_type: "text/html", sha256: "stored-hash" };
    } }; } };
    const site = { id: "site-1", username: "example", published_at: "2026-10-07", custom_domain: "example.test", custom_domain_status: "active" } as DbSite;
    const request = new Request("https://example.test/shop/kit", { headers: { "If-None-Match": '"stored-hash"' } });
    Object.defineProperty(request, "cf", { value: { country: "PK" } });
    const pk = await serveSiteFileResponse({ DB } as unknown as Env, site, "shop/kit", true, "", request);
    expect(pk.status).toBe(200);
    expect(await pk.text()).toContain("8000.00 PKR");
    expect(pk.headers.get("Cache-Control")).toBe("private, no-store");
    expect(pk.headers.get("ETag")).toBeNull();
    const international = await serveSiteFileResponse({ DB } as unknown as Env, site, "shop/kit", true, "", new Request("https://example.test/shop/kit"));
    expect(await international.text()).toContain("50.00 USD");
    expect(international.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await serveSiteFileResponse({ DB } as unknown as Env, site, "_pricing/PK/shop/kit", true, "", request)).status).toBe(404);
  });
});

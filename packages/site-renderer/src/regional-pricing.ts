import { DELIVERY_COUNTRIES } from "./product-delivery.js";

/** Fixed country prices in hundredths of the selected currency. No FX conversion. */
export type RegionalPrice = {
  country: string;
  currency: string;
  amount: number;
  shippingCost?: number;
};

// Keep supported regional amounts explicit: runtime locale data can report
// different currency precisions from our commerce providers (including PKR).
export const REGIONAL_PRICE_CURRENCIES: readonly string[] = [
  "USD", "GBP", "EUR", "CAD", "AUD", "NZD", "CHF", "SGD", "HKD", "INR", "PKR",
];
export function regionalCurrencySupported(currency: string): boolean {
  return REGIONAL_PRICE_CURRENCIES.includes(currency);
}

/** Only Cloudflare's runtime metadata is authoritative; never trust a body/header override. */
export function requestCountry(request?: Request): string | null {
  const country = (request as (Request & { cf?: { country?: unknown } }) | undefined)?.cf?.country;
  return typeof country === "string" && DELIVERY_COUNTRIES.includes(country) ? country : null;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(records);
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(records)];
}

export function regionalPricingCountries(value: unknown): string[] {
  return [...new Set(records(value).flatMap(record =>
    Array.isArray(record.regionalPrices) ? (record.regionalPrices as RegionalPrice[]).map(price => price.country) : [],
  ))];
}

export function regionalPricingError(value: unknown): string | null {
  for (const record of records(value)) {
    if (record.regionalPrices === undefined) continue;
    const prices = record.regionalPrices;
    if (!Array.isArray(prices) || prices.length > 2) return "Use up to two regional prices alongside the default price.";
    const countries = new Set<string>();
    for (const price of prices) {
      if (!price || !DELIVERY_COUNTRIES.includes(price.country) || countries.has(price.country)) return "Choose a different valid country for each regional price.";
      countries.add(price.country);
      if (typeof price.currency !== "string" || !regionalCurrencySupported(price.currency) || !Number.isSafeInteger(price.amount) || price.amount < 50) return "Choose a supported currency and a positive regional price (at least 0.50).";
      const delivery = record.delivery as { kind?: string } | undefined;
      if (delivery?.kind === "physical" && (!Number.isSafeInteger(price.shippingCost) || price.shippingCost < 0)) return "Enter a regional shipping charge, or 0 for free shipping.";
    }
  }
  return null;
}

/** Applies to products and all nested booking shapes; returns a copy without price rules. */
export function localizeRegionalPrices<T>(value: T, country: string | null): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => localizeRegionalPrices(item, country)) as T;
  const input = value as Record<string, unknown>;
  const output = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "regionalPrices").map(([key, item]) => [key, localizeRegionalPrices(item, country)]));
  const prices = input.regionalPrices as RegionalPrice[] | undefined;
  const price = Array.isArray(prices) ? prices.find(candidate => candidate.country === country) : undefined;
  if (price && typeof input.price === "number") {
    output.price = price.amount;
    output.currency = price.currency;
    const delivery = output.delivery as { kind?: string; shippingCost?: number } | undefined;
    if (delivery?.kind === "physical") delivery.shippingCost = price.shippingCost;
  }
  if (Array.isArray(prices) && prices.length && typeof input.suggestedAmount === "number") {
    const amount = price ? price.amount / 100 : input.suggestedAmount;
    output.suggestedAmount = amount;
    if (price) output.currency = price.currency;
    output.minimumAmount = amount;
    output.allowFlexiblePricing = false;
    output.allowFree = false;
  }
  return output as T;
}

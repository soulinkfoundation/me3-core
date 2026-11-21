/**
 * schema.org JSON-LD for a published site, built from the same profile as me.json so search engines and
 * AI assistants read the business, its services, products, hours and how to book or buy without knowing ME3.
 */
import type { PublicLocationData } from "./location-display.js";
import { safeEnquireHref } from "./product-checkout.js";
import { externalShopUrl, type ProductDelivery } from "./product-delivery.js";
import type { ProductOption } from "./product-offer.js";
import { productPhotoPaths, publishedStock } from "./product-shop.js";
import { publicSiteUrl } from "./public-metadata.js";

export type StructuredDataNode = Record<string, unknown>;

type Pricing = { enabled?: boolean; suggestedAmount?: number; minimumAmount?: number; currency?: string; allowFree?: boolean; allowFlexiblePricing?: boolean };

export type StructuredDataService = {
  id?: string;
  title?: string;
  /** Plain text. */
  description?: string;
  duration?: number;
  pricing?: Pricing;
  image?: string;
  /** The site page about this offer, when it has one. */
  pageSlug?: string;
  /** Online or by phone, so it says nothing about a place people visit. */
  remote?: boolean;
  /** False when visitors can only enquire, or the service is arranged by hand. */
  bookable: boolean;
  /** False for services listed without a price (arranged on a call). */
  priced: boolean;
  windows?: Record<string, string[]>;
};

export type StructuredDataProduct = {
  slug?: string;
  title?: string;
  /** Plain text. */
  description?: string;
  price?: number;
  currency?: string;
  images?: string[];
  available?: boolean;
  delivery?: ProductDelivery;
  enquireUrl?: string;
  stock?: number;
  stockSetAt?: string;
  options?: ProductOption[];
};

export type SiteStructuredDataInput = {
  baseUrl: string;
  entityType?: "Person" | "Organization";
  name: string;
  /** Plain text. */
  description?: string;
  /** What the owner does, in a few words. */
  trade?: string;
  /** Site path or URL of the avatar or logo. */
  image?: string;
  /** Resolved hrefs of the profile's links. */
  links: string[];
  location?: string | null;
  locationData?: PublicLocationData | null;
  services: StructuredDataService[];
  products: StructuredDataProduct[];
  shopPath: string;
  /** Where bookings are taken when it isn't this site. */
  externalBookingUrl?: string;
  /** Weekly hours shared by one-to-one sessions. */
  windows?: Record<string, string[]>;
  checkoutEnabled: boolean;
};

export type SiteStructuredData = {
  /** The person or business; the same node on every page. */
  identity: StructuredDataNode;
  /** References to every Offer on the home page, for the identity's makesOffer there. */
  offers: StructuredDataNode[];
  services: StructuredDataNode[];
  products: StructuredDataNode[];
  /** Service nodes by their page slug, and product nodes by slug, for pages that are about one of them. */
  serviceByPage: Map<string, StructuredDataNode>;
  productBySlug: Map<string, StructuredDataNode>;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function currencyCode(value: unknown): string {
  const code = clean(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "USD";
}

function fragment(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}

/** Weekly windows ("09:00-17:00" per weekday) as OpeningHoursSpecification entries, Monday first. */
export function openingHours(windows: Record<string, string[]> | undefined): StructuredDataNode[] {
  const hours: StructuredDataNode[] = [];
  for (const day of DAYS) {
    const list = windows?.[day];
    if (!Array.isArray(list)) continue;
    for (const window of list) {
      const [opens, closes] = typeof window === "string" ? window.split("-").map((part) => part.trim()) : [];
      if (!TIME.test(opens || "") || !TIME.test(closes || "") || opens >= closes) continue;
      hours.push({ "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${day[0].toUpperCase()}${day.slice(1)}`, opens, closes });
    }
  }
  return hours;
}

function place(input: SiteStructuredDataInput): { address?: unknown; areaServed?: StructuredDataNode } {
  const data = input.locationData && typeof input.locationData === "object" ? input.locationData : null;
  const locality = clean(data?.locality);
  const region = clean(data?.region);
  const code = clean(data?.countryCode).toUpperCase();
  // "Éire / Ireland" style labels end with the English name.
  const country = /^[A-Z]{2}$/.test(code) ? code : clean(clean(data?.country).split("/").pop());
  if (!locality && !region && !country) {
    const label = clean(data?.label) || clean(input.location);
    return label ? { address: label } : {};
  }
  const address = {
    "@type": "PostalAddress",
    ...(locality ? { addressLocality: locality } : {}),
    ...(region ? { addressRegion: region } : {}),
    ...(country ? { addressCountry: country } : {}),
  };
  const precision = clean(data?.precision);
  const areaServed = precision === "country" || (!locality && !region)
    ? { "@type": "Country", name: country }
    : precision === "county" || precision === "region" || !locality
      ? { "@type": "AdministrativeArea", name: region || locality }
      : { "@type": "City", name: locality };
  return { address, areaServed };
}

function servicePrice(pricing: Pricing | undefined): { price: string; priceCurrency: string; minPrice?: string } {
  const priceCurrency = currencyCode(pricing?.currency);
  const amount = pricing?.enabled && typeof pricing.suggestedAmount === "number" && Number.isFinite(pricing.suggestedAmount) && pricing.suggestedAmount > 0
    ? pricing.suggestedAmount : 0;
  if (!amount) return { price: "0.00", priceCurrency };
  const flexible = pricing?.allowFlexiblePricing !== false;
  const minimum = pricing?.allowFree ? 0
    : typeof pricing?.minimumAmount === "number" && pricing.minimumAmount >= 0 && pricing.minimumAmount <= amount ? pricing.minimumAmount : amount;
  return { price: amount.toFixed(2), priceCurrency, ...(flexible && minimum < amount ? { minPrice: minimum.toFixed(2) } : {}) };
}

function reserveOrBuy(type: "ReserveAction" | "BuyAction", url: string): StructuredDataNode {
  return { "@type": type, target: { "@type": "EntryPoint", urlTemplate: url, actionPlatform: ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"] } };
}

export function buildSiteStructuredData(input: SiteStructuredDataInput): SiteStructuredData | null {
  const home = publicSiteUrl(input.baseUrl);
  if (!home) return null;
  const identityRef = { "@id": `${home}#identity` };
  const { address, areaServed } = place(input);
  const priced = input.services.filter((service) => service.priced && clean(service.title));
  // A place people come to: something to book that isn't all online or by phone, and somewhere to find it.
  const localBusiness = Boolean(address) && priced.length > 0 && priced.some((service) => !service.remote);
  const businessHours = localBusiness ? openingHours(input.windows) : [];
  const image = input.image ? publicSiteUrl(home, input.image) : undefined;
  const sameAs = [...new Set(input.links.filter((href) => /^https?:\/\//i.test(href)))];
  const email = input.links.find((href) => /^mailto:[^?\s]+@[^?\s]+$/i.test(href))?.slice("mailto:".length);
  const telephone = input.links.find((href) => /^tel:\+?[\d\s().-]{5,}$/i.test(href))?.slice("tel:".length).trim();
  const amounts = priced.map((service) => servicePrice(service.pricing)).filter((price) => Number(price.price) > 0);
  const currencies = new Set(amounts.map((price) => price.priceCurrency));
  const low = Math.min(...amounts.map((price) => Number(price.minPrice ?? price.price)));
  const high = Math.max(...amounts.map((price) => Number(price.price)));
  // "EUR 55-95": Google reads priceRange as free text, so one currency or nothing.
  const priceRange = localBusiness && currencies.size === 1 ? `${[...currencies][0]} ${low === high ? low : `${low}-${high}`}` : undefined;

  const identity: StructuredDataNode = {
    "@type": localBusiness ? "ProfessionalService" : input.entityType || "Person",
    ...identityRef,
    name: input.name,
    url: home,
    ...(input.description ? { description: input.description } : {}),
    // A person has a job title; a business is found by what it does.
    ...(input.trade ? (!localBusiness && (input.entityType || "Person") === "Person" ? { jobTitle: input.trade } : { keywords: input.trade }) : {}),
    ...(image ? { image } : {}),
    ...(address ? { address } : {}),
    ...(areaServed && (localBusiness || priced.length > 0) ? { areaServed } : {}),
    ...(email ? { email } : {}),
    ...(telephone ? { telephone } : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(businessHours.length ? { openingHoursSpecification: businessHours } : {}),
  };

  const offers: StructuredDataNode[] = [];
  const serviceByPage = new Map<string, StructuredDataNode>();
  const taken = new Set<string>();
  const services = input.services.flatMap((service) => {
    const name = clean(service.title);
    if (!name) return [];
    let key = fragment(clean(service.id) || name);
    for (let n = 2; taken.has(key); n++) key = `${fragment(clean(service.id) || name)}-${n}`;
    taken.add(key);
    const pageUrl = service.pageSlug ? publicSiteUrl(home, service.pageSlug) : undefined;
    const bookingUrl = input.externalBookingUrl || pageUrl || `${home}#booking`;
    const hours = openingHours(service.windows);
    const { price, priceCurrency, minPrice } = servicePrice(service.pricing);
    const duration = typeof service.duration === "number" && service.duration > 0 ? service.duration : 0;
    const offerRef = { "@id": `${home}#offer-${key}` };
    const serviceImage = service.image ? publicSiteUrl(home, service.image) : undefined;
    const node: StructuredDataNode = {
      "@type": "Service",
      "@id": `${home}#service-${key}`,
      name,
      ...(service.description ? { description: service.description } : {}),
      ...(pageUrl ? { url: pageUrl } : {}),
      ...(serviceImage ? { image: serviceImage } : {}),
      provider: identityRef,
      ...(areaServed ? { areaServed } : {}),
      ...(hours.length ? { hoursAvailable: hours } : {}),
      ...(service.priced ? { offers: {
        "@type": "Offer", ...offerRef, price, priceCurrency,
        ...(service.bookable ? { availability: "https://schema.org/InStock", url: bookingUrl } : {}),
        seller: identityRef,
        ...(duration || minPrice ? { priceSpecification: {
          "@type": "UnitPriceSpecification", price, priceCurrency,
          ...(minPrice ? { minPrice } : {}),
          ...(duration ? { referenceQuantity: { "@type": "QuantitativeValue", value: duration, unitCode: "MIN" } } : {}),
        } } : {}),
      } } : {}),
      ...(service.bookable ? { potentialAction: reserveOrBuy("ReserveAction", bookingUrl) } : {}),
    };
    if (service.priced) offers.push(offerRef);
    if (service.pageSlug) serviceByPage.set(service.pageSlug, node);
    return [node];
  });

  const productBySlug = new Map<string, StructuredDataNode>();
  const products = input.products.flatMap((product) => {
    const name = clean(product.title);
    const url = product.slug ? publicSiteUrl(home, `${input.shopPath}/${product.slug}`) : undefined;
    if (!name || !url || productBySlug.has(product.slug!)) return [];
    const external = product.delivery?.kind === "external" ? externalShopUrl(product.delivery.url)?.toString() : undefined;
    const buyUrl = product.delivery?.kind === "external" ? external : url;
    const options = (product.options || []).filter((option) => Number.isFinite(option?.price));
    const prices = options.length ? options.map((option) => option.price) : typeof product.price === "number" && Number.isFinite(product.price) && product.price >= 0 ? [product.price] : [];
    const hasCurrency = /^[a-z]{3}$/i.test(clean(product.currency));
    const soldOut = publishedStock(product) === 0 || (options.length > 0 && options.every((option) => option.stock === 0));
    const inStock = product.available !== false && !soldOut;
    const buyable = inStock && Boolean(buyUrl) && prices.length > 0 && hasCurrency
      && (Boolean(external) || (input.checkoutEnabled && !safeEnquireHref(product.enquireUrl)));
    const offerRef = { "@id": `${url}#offer` };
    const money = (cents: number) => (cents / 100).toFixed(2);
    const shared = {
      ...offerRef, priceCurrency: currencyCode(product.currency),
      availability: `https://schema.org/${inStock ? "InStock" : "OutOfStock"}`,
      ...(buyUrl ? { url: buyUrl } : {}),
      seller: identityRef,
    };
    const images = productPhotoPaths(product).map((path) => publicSiteUrl(home, path)).filter(Boolean);
    const node: StructuredDataNode = {
      "@type": "Product",
      "@id": `${url}#product`,
      name,
      ...(product.description ? { description: product.description } : {}),
      url,
      ...(images.length ? { image: images } : {}),
      ...(prices.length && hasCurrency ? { offers: prices.length > 1
        ? { "@type": "AggregateOffer", lowPrice: money(Math.min(...prices)), highPrice: money(Math.max(...prices)), offerCount: prices.length, ...shared }
        : { "@type": "Offer", price: money(prices[0]), ...shared } } : {}),
      ...(buyable ? { potentialAction: reserveOrBuy("BuyAction", buyUrl!) } : {}),
    };
    if (prices.length && hasCurrency) offers.push(offerRef);
    productBySlug.set(product.slug!, node);
    return [node];
  });

  return { identity, offers, services, products, serviceByPage, productBySlug };
}

/** The one JSON-LD graph for a page: the page, who it belongs to, and what the page is about. */
export function pageStructuredData(site: SiteStructuredData, page: { home: boolean; name: string; url?: string; about?: StructuredDataNode }): StructuredDataNode {
  const mainEntity = { "@id": (page.about || site.identity)["@id"] };
  const webPage = { "@type": page.home ? "ProfilePage" : "WebPage", name: page.name, ...(page.url ? { url: page.url } : {}), mainEntity };
  const graph = page.home
    ? [webPage, { ...site.identity, ...(site.offers.length ? { makesOffer: site.offers } : {}) }, ...site.services, ...site.products]
    : [webPage, site.identity, ...(page.about ? [page.about] : [])];
  return { "@context": "https://schema.org", "@graph": graph };
}

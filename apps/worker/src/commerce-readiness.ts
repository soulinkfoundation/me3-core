import { productDeliveryError, type ProductDelivery } from "../../../shared/product-delivery";
import { productOfferError } from "../../../shared/product-offer";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import { isCommerceReady } from "./commerce-settings";
import type { Env } from "./types";
import { regionalPricingError } from "../../../shared/regional-pricing";
import { buyerMayPayDirectly, methodsCoverCurrency, type SavedPaymentMethod } from "../../../shared/pay-directly";
import { listPaymentMethods } from "./pay-directly";

/**
 * What stops a profile publishing: content errors only (regional pricing, product delivery and offer
 * details). A paid offer nobody can pay for yet still publishes; `markUnpayableOffers` turns it into Enquire.
 */
export function getProfileCommercePublishBlockReason(profile: Me3SiteProfile): string | null {
  const pricingError = regionalPricingError(profile);
  if (pricingError) return pricingError;
  for (const product of profile.products || []) {
    const error = productDeliveryError(product.delivery) || productOfferError(product);
    if (product.available !== false && error) return error;
  }
  return null;
}

export type PaymentReadiness = { stripeReady: boolean; methods: SavedPaymentMethod[] };

export async function getPaymentReadiness(env: Env, ownerId: string): Promise<PaymentReadiness> {
  const [stripeReady, methods] = await Promise.all([isCommerceReady(env, ownerId), listPaymentMethods(env, ownerId)]);
  return { stripeReady, methods };
}

/** Everything about readiness that changes which offers show Enquire, as a string to compare with the last publish. */
export function paymentReadinessKey(readiness: PaymentReadiness): string {
  const enabled = readiness.methods.filter((method) => method.enabled);
  const links = enabled.some((method) => method.kind !== "bank" && Boolean(method.link));
  const banks = [...new Set(enabled
    .filter((method) => method.kind === "bank" && Boolean(method.accountName))
    .map((method) => (method.currency || "").toUpperCase()))].sort();
  return JSON.stringify({ stripe: readiness.stripeReady, links, banks });
}

/** Whether a profile has a paid booking or product, so its pages depend on payment readiness at all. */
export function profileHasPaidOffers(profile: Me3SiteProfile): boolean {
  const products = (profile.products || []) as MarkableProduct[];
  if (products.some((product) => product && product.available !== false && product.delivery?.kind !== "external")) return true;
  const book = profile.intents?.book as MarkableBook | undefined;
  const lists = [book?.offers, book?.classes, book?.retreats, ...(book?.bookingTypes || []).flatMap((type) => [type?.offers, type?.classes, type?.retreats])];
  return lists.some((list) => Array.isArray(list) && list.some((offer) => offer?.pricing?.enabled === true));
}

type PaymentTerms = { paymentMethod?: unknown; allowPayDirectly?: unknown; paymentInstructions?: unknown; currency?: unknown };

/**
 * Whether a buyer can pay: card needs Stripe; paying directly needs a saved way to get paid in its currency,
 * or a note; "let them choose" needs both. The site editor's Getting paid check mirrors this.
 */
export function offerCanTakePayment(terms: PaymentTerms, readiness: PaymentReadiness): boolean {
  const note = typeof terms.paymentInstructions === "string" && terms.paymentInstructions.trim() !== "";
  const direct = note || methodsCoverCurrency(readiness.methods, typeof terms.currency === "string" ? terms.currency : "");
  if (terms.paymentMethod === "manual") return direct;
  if (buyerMayPayDirectly(terms)) return readiness.stripeReady && direct;
  return readiness.stripeReady;
}

/** Where a site's Enquire buttons go: the Worker opens an email to the owner, so the address isn't in the page. */
export function siteEnquireUrl(username: string, about: string): string {
  const query = about.trim() ? `?about=${encodeURIComponent(about.trim().slice(0, 120))}` : "";
  return `/api/enquire/${encodeURIComponent(username)}${query}`;
}

type MarkableOffer = { title?: string; pricing?: PaymentTerms & { enabled?: boolean }; enquireUrl?: string };
type MarkableProduct = PaymentTerms & { title?: string; available?: boolean; delivery?: ProductDelivery; enquireUrl?: string };
type MarkableBook = {
  offers?: MarkableOffer[];
  classes?: MarkableOffer[];
  retreats?: MarkableOffer[];
  bookingTypes?: Array<{ offers?: MarkableOffer[]; classes?: MarkableOffer[]; retreats?: MarkableOffer[] }>;
};

/**
 * A copy of the profile for rendering, with `enquireUrl` on every paid booking or product nobody can pay
 * for yet, so the site shows Enquire instead of Book or Buy. Never saved to the site's source.
 */
export function markUnpayableOffers(profile: Me3SiteProfile, username: string, readiness: PaymentReadiness): Me3SiteProfile {
  const markOffer = (offer: MarkableOffer): MarkableOffer => {
    const { enquireUrl: _stale, ...rest } = offer || {};
    if (!offer || offer.pricing?.enabled !== true || offerCanTakePayment(offer.pricing, readiness)) return offer && rest;
    return { ...rest, enquireUrl: siteEnquireUrl(username, offer.title || "") };
  };
  const markList = (list: MarkableOffer[] | undefined) => (Array.isArray(list) ? list.map(markOffer) : list);
  const products = Array.isArray(profile.products)
    ? (profile.products as MarkableProduct[]).map((product) => {
        const { enquireUrl: _stale, ...rest } = product || {};
        if (!product || product.available === false || product.delivery?.kind === "external" || offerCanTakePayment(product, readiness)) return product && rest;
        return { ...rest, enquireUrl: siteEnquireUrl(username, product.title || "") };
      })
    : profile.products;
  const book = profile.intents?.book as MarkableBook | undefined;
  const markedBook = book
    ? {
        ...book,
        offers: markList(book.offers),
        classes: markList(book.classes),
        retreats: markList(book.retreats),
        bookingTypes: Array.isArray(book.bookingTypes)
          ? book.bookingTypes.map((type) => type && typeof type === "object"
              ? { ...type, offers: markList(type.offers), classes: markList(type.classes), retreats: markList(type.retreats) }
              : type)
          : book.bookingTypes,
      }
    : book;
  return {
    ...profile,
    products: products as Me3SiteProfile["products"],
    ...(profile.intents ? { intents: { ...profile.intents, book: markedBook as NonNullable<Me3SiteProfile["intents"]>["book"] } } : {}),
  };
}

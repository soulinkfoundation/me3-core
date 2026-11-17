import { productDeliveryError, type ProductDelivery } from "../../../shared/product-delivery";
import { productOfferError } from "../../../shared/product-offer";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import { isCommerceReady } from "./commerce-settings";
import type { Env } from "./types";
import { regionalPricingError } from "../../../shared/regional-pricing";
import { buyerMayPayDirectly, methodsCoverCurrency, type SavedPaymentMethod } from "../../../shared/pay-directly";
import { listPaymentMethods } from "./pay-directly";

type BookingOffer = {
  pricing?: {
    enabled?: boolean;
    paymentMethod?: "stripe" | "manual";
    allowPayDirectly?: boolean;
    paymentInstructions?: string;
    currency?: string;
  };
};

type CommerceProduct = {
  delivery?: ProductDelivery;
  available?: boolean;
  paymentMethod?: "stripe" | "manual";
  allowPayDirectly?: boolean;
  paymentInstructions?: string;
  currency?: string;
};

// A pay-directly offer needs a saved way to get paid that takes its currency, or a note. So does a
// "let them choose" offer, which also needs Stripe (it is a card offer to profileRequiresCommerce).
function manualPaymentBlockMessage(kind: "product" | "booking", currency: string | undefined): string {
  const code = /^[A-Za-z]{3}$/.test(currency || "") ? ` in ${currency!.toUpperCase()}` : "";
  return `Add a way to get paid${code} in Settings → Payments, or a note for buyers, for every pay-directly ${kind} before publishing.`;
}

function profileManualPaymentBlockReason(
  profile: Me3SiteProfile,
  methods: SavedPaymentMethod[],
): string | null {
  const product = ((profile.products || []) as CommerceProduct[]).find(
    (candidate) =>
      candidate.available !== false &&
      (candidate.paymentMethod === "manual" || buyerMayPayDirectly(candidate)) &&
      !candidate.paymentInstructions?.trim() &&
      !methodsCoverCurrency(methods, candidate.currency),
  );
  if (product) return manualPaymentBlockMessage("product", product.currency);

  const book = profile.intents?.book as BookIntentWithOffers | undefined;
  const offers = [
    ...(book?.offers || []),
    ...(book?.bookingTypes || []).flatMap((type) => type.offers || []),
  ];
  const offer = offers.find(
    (candidate) =>
      candidate.pricing?.enabled === true &&
      (candidate.pricing.paymentMethod === "manual" || buyerMayPayDirectly(candidate.pricing)) &&
      !candidate.pricing.paymentInstructions?.trim() &&
      !methodsCoverCurrency(methods, candidate.pricing.currency),
  );
  return offer ? manualPaymentBlockMessage("booking", offer.pricing?.currency) : null;
}

type BookIntentWithOffers = {
  offers?: BookingOffer[];
  bookingTypes?: Array<{ offers?: BookingOffer[] }>;
};

export function profileRequiresCommerce(profile: Me3SiteProfile): boolean {
  if (
    ((profile.products || []) as CommerceProduct[]).some(
      (product) =>
        product.available !== false &&
        product.paymentMethod !== "manual" &&
        product.delivery?.kind !== "external",
    )
  ) {
    return true;
  }

  const book = profile.intents?.book as BookIntentWithOffers | undefined;
  if (
    (book?.offers || []).some(
      (offer) =>
        offer.pricing?.enabled === true &&
        offer.pricing.paymentMethod !== "manual",
    )
  ) {
    return true;
  }
  return (book?.bookingTypes || []).some((bookingType) =>
    (bookingType.offers || []).some(
      (offer) =>
        offer.pricing?.enabled === true &&
        offer.pricing.paymentMethod !== "manual",
    ),
  );
}

export async function getProfileCommercePublishBlockReason(
  env: Env,
  ownerId: string,
  profile: Me3SiteProfile,
): Promise<string | null> {
  const pricingError = regionalPricingError(profile);
  if (pricingError) return pricingError;
  for (const product of profile.products || []) {
    const error = productDeliveryError(product.delivery) || productOfferError(product);
    if (product.available !== false && error) return error;
  }
  const manualPaymentError = profileManualPaymentBlockReason(
    profile,
    await listPaymentMethods(env, ownerId),
  );
  if (manualPaymentError) return manualPaymentError;
  if (!profileRequiresCommerce(profile) || await isCommerceReady(env, ownerId)) return null;
  return "Connect Stripe in Settings → Payments before publishing paid bookings or products.";
}

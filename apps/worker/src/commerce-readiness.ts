import { productDeliveryError, type ProductDelivery } from "../../../shared/product-delivery";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import { isCommerceReady } from "./commerce-settings";
import type { Env } from "./types";

type BookingOffer = {
  pricing?: {
    enabled?: boolean;
    paymentMethod?: "stripe" | "manual";
    paymentInstructions?: string;
  };
};

type CommerceProduct = {
  delivery?: ProductDelivery;
  available?: boolean;
  paymentMethod?: "stripe" | "manual";
  paymentInstructions?: string;
};

function profileManualPaymentBlockReason(
  profile: Me3SiteProfile,
): string | null {
  const product = ((profile.products || []) as CommerceProduct[]).find(
    (candidate) =>
      candidate.available !== false &&
      candidate.paymentMethod === "manual" &&
      !candidate.paymentInstructions?.trim(),
  );
  if (product) return "Add payment instructions for every pay-separately product before publishing.";

  const book = profile.intents?.book as BookIntentWithOffers | undefined;
  const offers = [
    ...(book?.offers || []),
    ...(book?.bookingTypes || []).flatMap((type) => type.offers || []),
  ];
  if (
    offers.some(
      (offer) =>
        offer.pricing?.enabled === true &&
        offer.pricing.paymentMethod === "manual" &&
        !offer.pricing.paymentInstructions?.trim(),
    )
  ) {
    return "Add payment instructions for every pay-separately booking before publishing.";
  }
  return null;
}

type BookIntentWithOffers = {
  offers?: BookingOffer[];
  bookingTypes?: Array<{ offers?: BookingOffer[] }>;
};

export function profileRequiresCommerce(profile: Me3SiteProfile): boolean {
  if (
    ((profile.products || []) as CommerceProduct[]).some(
      (product) =>
        product.available !== false && product.paymentMethod !== "manual",
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
  for (const product of profile.products || []) {
    const error = productDeliveryError(product.delivery);
    if (product.available !== false && error) return error;
  }
  const manualPaymentError = profileManualPaymentBlockReason(profile);
  if (manualPaymentError) return manualPaymentError;
  if (!profileRequiresCommerce(profile) || await isCommerceReady(env, ownerId)) return null;
  return "Connect Stripe in Settings → Payments before publishing paid bookings or products.";
}

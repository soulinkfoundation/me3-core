import { ref, type InjectionKey } from "vue";
import { api } from "../api";
import type { CommerceSettingsResponse } from "./commerce";
import { payDirectlyReady, type PaymentMethod } from "./payDirectly";
import type { WizardPaymentMethod } from "../stores/wizard";

/** Opens the site editor's Getting paid sheet. Provided by /create; absent elsewhere. */
export const GETTING_PAID_KEY: InjectionKey<() => void> = Symbol("gettingPaid");

type Stripe = CommerceSettingsResponse["stripe"];
const stripe = ref<Stripe | null>(null);
const stripeLoaded = ref(false);
let stripeLoading: Promise<void> | null = null;

/** Stripe's state for this owner, read once and shared by every row and sheet that shows it. */
export function useStripeStatus() {
  async function load(force = false): Promise<void> {
    if (stripeLoaded.value && !force) return;
    stripeLoading ??= api.get<CommerceSettingsResponse>("/commerce/status")
      .then((response) => { stripe.value = response.stripe; })
      .catch(() => { stripe.value = null; })
      .finally(() => { stripeLoaded.value = true; stripeLoading = null; });
    return stripeLoading;
  }
  return { stripe, loaded: stripeLoaded, load };
}

export function stripeReady(value: Stripe | null): boolean {
  return value?.configured === true;
}

export function stripeStatusLabel(value: Stripe | null, loaded: boolean): string {
  if (!loaded) return "Checking";
  if (stripeReady(value)) return "Connected";
  if (value?.connectionStatus === "pending") return "Setup not finished";
  if (value?.connectionStatus === "restricted") return "Needs attention";
  if (value?.connectionStatus === "unavailable") return "Status unavailable";
  return "Not connected";
}

export type PaidOffer = {
  title: string;
  currency: string;
  paymentMethod: WizardPaymentMethod;
  allowPayDirectly?: boolean;
  note?: string | null;
};

/**
 * Whether buyers can pay for a paid offer: card needs Stripe; paying directly needs a saved way to
 * get paid in its currency, or a note; "let them choose" needs both. Mirrors the Worker's offerCanTakePayment:
 * an offer that can't take payment still publishes and shows Enquire on the live site.
 */
export function offerCanTakePayment(offer: PaidOffer, methods: PaymentMethod[], stripe: Stripe | null): boolean {
  const direct = payDirectlyReady(methods, offer.currency, offer.note);
  if (offer.paymentMethod === "manual") return direct;
  if (offer.allowPayDirectly) return stripeReady(stripe) && direct;
  return stripeReady(stripe);
}

type WizardLike = {
  bookingsEnabled: boolean;
  shopEnabled: boolean;
  profile: {
    booking: Record<"offers" | "classOffers" | "retreatOffers", Array<{
      title: string;
      pricing?: { enabled?: boolean; currency: string; paymentMethod: WizardPaymentMethod; allowPayDirectly?: boolean; paymentInstructions?: string | null };
    }>>;
  };
  products: Array<{
    title: string;
    available: boolean;
    price: number;
    currency: string;
    paymentMethod: WizardPaymentMethod;
    allowPayDirectly?: boolean;
    paymentInstructions?: string | null;
    delivery?: { kind?: string };
  }>;
};

/** The paid offers on a step of the site editor ("bookings" or "shop"). */
export function paidOffersFor(wizard: WizardLike, step: "bookings" | "shop"): PaidOffer[] {
  if (step === "bookings") {
    if (!wizard.bookingsEnabled) return [];
    const { offers, classOffers, retreatOffers } = wizard.profile.booking;
    return [...offers, ...classOffers, ...retreatOffers]
      .filter((offer) => offer.pricing?.enabled)
      .map((offer) => ({
        title: offer.title,
        currency: offer.pricing!.currency,
        paymentMethod: offer.pricing!.paymentMethod,
        allowPayDirectly: offer.pricing!.allowPayDirectly,
        note: offer.pricing!.paymentInstructions,
      }));
  }
  if (!wizard.shopEnabled) return [];
  // Products sold elsewhere (an external link) take no payment here.
  return wizard.products
    .filter((product) => product.available && product.price > 0 && product.delivery?.kind !== "external")
    .map((product) => ({
      title: product.title,
      currency: product.currency,
      paymentMethod: product.paymentMethod,
      allowPayDirectly: product.allowPayDirectly,
      note: product.paymentInstructions,
    }));
}

/** Kept here so the shared refs survive page changes in tests that reset them. */
export function resetStripeStatusForTests() {
  stripe.value = null;
  stripeLoaded.value = false;
  stripeLoading = null;
}

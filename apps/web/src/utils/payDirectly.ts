import { ref } from "vue";
import {
  buildPaymentOptions,
  methodsCoverCurrency,
  paymentMethodName,
  paymentOptionHint,
  type PaymentMethodKind,
  type SavedPaymentMethod,
} from "../../../../shared/pay-directly";
import { api } from "../api";

// Pay me directly on the web: the owner's saved ways to get paid, read from the Worker.

export type PaymentMethod = SavedPaymentMethod & { createdAt?: string; updatedAt?: string };

export type WaitingPayment = {
  kind: "order" | "booking" | "event";
  id: string;
  reference: string;
  customerName: string;
  customerEmail: string;
  title: string;
  amountCents: number;
  currency: string;
  createdAt: string;
  saysPaidAt: string | null;
  remindedAt: string | null;
  bookingType: "one_to_one" | "class" | "retreat" | null;
  startsAt: string | null;
  quantity: number;
};

export const PAY_DIRECTLY_SETTINGS_PATH = "/account?section=payments";

const methods = ref<PaymentMethod[]>([]);
const loaded = ref(false);
let loading: Promise<void> | null = null;

/** The saved methods, shared by Settings and every offer editor on the page. */
export function usePayDirectlyMethods() {
  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading ??= api.get<{ methods?: PaymentMethod[] }>("/commerce/payment-methods")
      .then((response) => { methods.value = response.methods || []; loaded.value = true; })
      .finally(() => { loading = null; });
    return loading;
  }
  function set(next: PaymentMethod[]) { methods.value = next; loaded.value = true; }
  /** Forget what was read, so the next load asks the Worker again. */
  function reset() { methods.value = []; loaded.value = false; }
  return { methods, loaded, load, set, reset };
}

/** One line under a method's name: the link without https://, or the account holder and number. */
export function paymentMethodDetail(method: Pick<PaymentMethod, "kind" | "link" | "accountName" | "iban" | "sortCode" | "accountNumber" | "currency">): string {
  if (method.kind !== "bank") return (method.link || "").replace(/^https:\/\//, "");
  const account = method.iban
    ? method.iban.replace(/(.{4})(?=.)/g, "$1 ")
    : [method.sortCode?.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3"), method.accountNumber].filter(Boolean).join(" ");
  return [method.accountName, account, method.currency].filter(Boolean).join(" · ");
}

/** The switched-on methods a buyer paying in this currency is offered, in the owner's order. */
export function methodsOfferedFor(all: PaymentMethod[], currency: string): PaymentMethod[] {
  const code = currency.toUpperCase();
  return all.filter((method) => method.enabled && (method.kind !== "bank" || (method.currency || "").toUpperCase() === code));
}

/** A pay-directly offer needs a saved method that takes its currency, or a note for buyers. */
export function payDirectlyReady(all: PaymentMethod[], currency: string, note: string | null | undefined): boolean {
  return Boolean(note?.trim()) || methodsCoverCurrency(all, currency);
}

export type BuyerPreviewLine = { kind: PaymentMethodKind; name: string; hint: string };

/** What a buyer paying this amount is shown, with the same wording as the pay page. */
export function buyerPreview(all: PaymentMethod[], amountMinor: number, currency: string): BuyerPreviewLine[] {
  const amount = new Intl.NumberFormat("en", { style: "currency", currency }).format(amountMinor / 100);
  return buildPaymentOptions(all, { amountMinor, currency, reference: "ME3-4F7K" }).map((option) => ({
    kind: option.kind,
    name: option.kind === "bank" ? "Bank transfer" : `Pay with ${paymentMethodName(option.kind)}`,
    hint: option.kind !== "bank"
      ? paymentOptionHint(option, amount)
      : option.epcQrPayload
        ? `Your bank details with Copy buttons, and a QR code banking apps scan to fill in ${amount} and the reference.`
        : "Your account name, sort code and account number with Copy buttons, and the reference.",
  }));
}

export { paymentMethodName };

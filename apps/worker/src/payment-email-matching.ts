import { decodeMimeHeaderValue } from "../../../shared/email-headers";
import {
  PAYMENT_AMOUNT_IN_TEXT,
  PAYMENT_EMAIL_RULES,
  PAYMENT_REFERENCE_IN_TEXT,
  type PaymentEmailProvider,
} from "./payment-email-rules";
import type { WaitingPayment } from "./pay-directly-bookings";

// Reading a "money arrived" email and finding the waiting order it probably pays. Pure functions:
// they suggest, they never confirm. ME3 marks nothing paid without the owner.

export type PaymentEmail = {
  provider: PaymentEmailProvider;
  providerLabel: string;
  amountCents: number;
  currency: string;
  payerName: string | null;
  /** An ME3-XXXX reference found in the email, upper case. */
  reference: string | null;
};

export type PaymentEmailInput = { fromAddress: string | null; subject: string | null; textBody: string | null };

function domainOf(address: string | null): string {
  return (address || "").trim().toLowerCase().split("@").pop() || "";
}

/** What a payment email says, or null when it is not one of the known "you received money" emails. */
export function parsePaymentEmail(input: PaymentEmailInput, defaultCurrency = "USD"): PaymentEmail | null {
  const domain = domainOf(input.fromAddress);
  const rule = PAYMENT_EMAIL_RULES.find((candidate) =>
    candidate.senderDomains.some((sender) => domain === sender || domain.endsWith(`.${sender}`)));
  if (!rule) return null;
  const subject = decodeMimeHeaderValue(input.subject || "");
  const text = `${subject}\n${input.textBody || ""}`;
  if (!rule.received.some((pattern) => pattern.test(text))) return null;

  const amount = text.match(PAYMENT_AMOUNT_IN_TEXT);
  const value = amount?.[2] || amount?.[3] || amount?.[6];
  if (!value) return null;
  const amountCents = Math.round(Number.parseFloat(value.replace(/,/g, "")) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  const symbol = ({ "$": "USD", "€": "EUR", "£": "GBP" } as Record<string, string>)[amount?.[1] || ""];
  // "€60.00 EUR": a code after the amount settles which dollar or pound it is.
  const after = amount?.[1] ? text.slice((amount.index || 0) + amount[0].length).match(/^[ \t]?(USD|EUR|GBP|CAD|AUD|CHF|SGD|INR|PKR)\b/i)?.[1] : null;
  const currency = (after || amount?.[4] || amount?.[5] || symbol || defaultCurrency).toUpperCase();

  let payerName: string | null = null;
  for (const pattern of rule.payer) {
    const found = text.match(pattern)?.[1]?.replace(/\s+/g, " ").trim();
    if (found) { payerName = found.slice(0, 120); break; }
  }
  return {
    provider: rule.provider,
    providerLabel: rule.label,
    amountCents,
    currency,
    payerName,
    reference: text.match(PAYMENT_REFERENCE_IN_TEXT)?.[0].toUpperCase() || null,
  };
}

function nameTokens(name: string): string[] {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 3);
}

/** The same person, as far as two names can say: they share a first or last name of three letters or more. */
export function namesAreSimilar(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const other = new Set(nameTokens(b));
  return nameTokens(a).some((token) => other.has(token));
}

export type PaymentMatch = {
  /** reference: the email carries the order's reference. amount_and_name: same amount, similar payer name. */
  by: "reference" | "amount_and_name";
  /** One reference is a match. Two or more: the owner chooses; ME3 never picks. */
  references: string[];
};

/**
 * The waiting orders this email could be paying. A reference in the email settles it. Otherwise the
 * amount and currency must be the same and the payer's name similar to the buyer's; every order
 * that fits is returned, so two fitting orders are put to the owner rather than guessed between.
 */
export function matchPaymentEmail(email: PaymentEmail, waiting: WaitingPayment[]): PaymentMatch | null {
  if (email.reference) {
    const exact = waiting.find((item) => item.reference.toUpperCase() === email.reference);
    if (exact) return { by: "reference", references: [exact.reference] };
  }
  const fits = waiting.filter((item) =>
    item.amountCents === email.amountCents &&
    item.currency.toUpperCase() === email.currency &&
    namesAreSimilar(email.payerName, item.customerName));
  return fits.length ? { by: "amount_and_name", references: fits.map((item) => item.reference) } : null;
}

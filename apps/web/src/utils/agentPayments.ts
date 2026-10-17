import { ApiError } from "../api";

/**
 * Agent payments on web (me3-2gdu.4/.5). ME3 proposes an exact purchase, the owner
 * approves it after a fresh sign-in, and then pays on their own device. Core never
 * charges, so nothing here may describe a hand-over as a completed payment.
 */
export const PAYMENT_HOW_IT_WORKS = "You pay on your own device. ME3 does not charge you and never sees your card details.";

export type PaymentStatus = "proposed" | "declined" | "handed_over" | "paid" | "not_paid";
export type PaymentItem = { name: string; quantity: number; options?: string | null };
export type PaymentReceipt = {
  amount: string; currency: string; orderReference: string | null; paidAt: string | null;
  source: string; mismatch: boolean; ownerConfirmed: boolean; recordedAt?: string; updatedAt?: string;
};
export type PaymentRecord = {
  id: string; status: string; merchant: { name: string; url: string }; purpose: string; items: PaymentItem[];
  amount: string; currency: string; checkoutUrl: string | null; checkoutDomainDiffers: boolean; refundPolicy: string | null;
  threadId?: string; approvalId?: string | null; createdAt: string; decidedAt: string | null; handedOverAt: string | null;
  completedAt: string | null; receipt: PaymentReceipt | null;
};
export type PaymentAuditEvent = { event: string; data: Record<string, unknown>; at?: string };
export type PaymentLimits = {
  currency: string; custom: boolean; updatedAt: string | null; perPaymentMax: string; monthlyMax: string;
  usedLast30Days: string; remaining: string;
};
export type PaymentApprovalLike = { id: string; threadId?: string; status?: string; title?: string; summary?: string | null; payload?: Record<string, unknown> } & Record<string, unknown>;

export type PaymentApprovalView = {
  approvalId: string; threadId: string | null; proposalId: string; pending: boolean;
  merchantName: string; merchantHref: string | null; merchantHost: string | null; purpose: string;
  items: Array<{ name: string; quantity: number; options: string | null }>;
  amount: string; currency: string; total: string; refundPolicy: string | null;
  checkoutHref: string | null; checkoutHost: string | null; checkoutWarning: string | null;
  remainingLimit: string | null; howItWorks: string;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only public https links are clickable; anything else stays as text. */
export function safeHttpsUrl(value: unknown): URL | null {
  try { const url = new URL(text(value)); return url.protocol === "https:" && !url.username && !url.password ? url : null; }
  catch { return null; }
}
const host = (url: URL | null) => url ? url.hostname.replace(/^www\./, "") : null;

export function formatPaymentMoney(amount: string | number, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); }
  catch { return `${amount} ${currency}`; }
}

/** The immutable proposal from a `kind: "payment"` approval card, normalized for display. */
export function paymentApprovalView(approval: PaymentApprovalLike): PaymentApprovalView | null {
  const card = { ...approval, ...record(approval.payload) };
  if (card.kind !== "payment" || !text(card.proposalId)) return null;
  const merchant = record(card.merchant), limits = record(card.limits);
  const currency = text(card.currency).toUpperCase(), amount = text(card.amount);
  const merchantUrl = safeHttpsUrl(merchant.url), checkoutUrl = safeHttpsUrl(card.checkoutUrl);
  const merchantHost = host(merchantUrl), checkoutHost = host(checkoutUrl);
  const remaining = text(limits.remaining), monthly = text(limits.monthlyMax), limitCurrency = text(limits.currency) || currency;
  return {
    approvalId: approval.id, threadId: text(approval.threadId) || null, proposalId: text(card.proposalId),
    pending: !approval.status || approval.status === "pending",
    merchantName: text(merchant.name) || "Unknown merchant", merchantHref: merchantUrl?.toString() ?? null, merchantHost,
    purpose: text(card.purpose),
    items: (Array.isArray(card.items) ? card.items : []).map(item => {
      const raw = record(item);
      return { name: text(raw.name), quantity: typeof raw.quantity === "number" ? raw.quantity : 1, options: text(raw.options) || null };
    }),
    amount, currency, total: formatPaymentMoney(amount, currency), refundPolicy: text(card.refundPolicy) || null,
    checkoutHref: checkoutUrl?.toString() ?? null, checkoutHost,
    checkoutWarning: card.checkoutDomainDiffers === true
      ? `The checkout link opens ${checkoutHost ?? "another site"}, not ${merchantHost ?? "the merchant's site"}. Check it is the merchant's payment page before you pay.`
      : null,
    remainingLimit: remaining && monthly ? `${formatPaymentMoney(remaining, limitCurrency)} left of your ${formatPaymentMoney(monthly, limitCurrency)} 30-day limit` : null,
    // The line is fixed product copy, so it shows even if a card omits it.
    howItWorks: PAYMENT_HOW_IT_WORKS,
  };
}

export function isFreshAuthenticationRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "fresh_authentication_required";
}

/** The owner's normal sign-in, returning to the same approval in Chat so they can approve it themselves. */
export function paymentReauthLocation(input: { approvalId: string; threadId: string | null }) {
  const query = new URLSearchParams({ view: "chat", ...(input.threadId ? { thread: input.threadId } : {}), payment: input.approvalId });
  return { path: "/login", query: { reauth: "payment", redirect: `/assistant?${query.toString().replace(/\+/g, "%20")}` } };
}

/** What the owner does after approving. Mirrors the server's hand-over; it is never a completed payment. */
export function paymentHandOver(payment: PaymentRecord): { openUrl: string; instructions: string } | null {
  if (payment.status !== "handed_over") return null;
  const checkout = safeHttpsUrl(payment.checkoutUrl), merchant = safeHttpsUrl(payment.merchant.url);
  const openUrl = (checkout ?? merchant)?.toString();
  if (!openUrl) return null;
  const total = formatPaymentMoney(payment.amount, payment.currency);
  return {
    openUrl,
    instructions: checkout
      ? `Open the checkout link on your own device and pay ${total} to ${payment.merchant.name}. ME3 does not charge you.`
      : `Open ${payment.merchant.name} on your own device, add the items listed, and pay ${total}. ME3 does not charge you.`,
  };
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  proposed: "Waiting for your OK", declined: "Declined", handed_over: "Waiting for your receipt", paid: "Paid", not_paid: "Not bought",
};
export function paymentStatusLabel(status: string): string {
  return STATUS_LABELS[status as PaymentStatus] ?? status.replace(/_/g, " ");
}

export function paymentReceiptWarning(payment: PaymentRecord): string | null {
  const receipt = payment.receipt;
  if (!receipt?.mismatch) return null;
  return `The receipt shows ${formatPaymentMoney(receipt.amount, receipt.currency)}, but you approved ${formatPaymentMoney(payment.amount, payment.currency)}.`;
}

/** Receipt actions the server accepts for this status. */
export function paymentActions(payment: PaymentRecord) {
  return { confirm: payment.status === "handed_over" || payment.status === "paid", notPaid: payment.status === "handed_over" && !payment.receipt };
}

export function paymentAuditLabel(event: PaymentAuditEvent): string {
  const data = record(event.data);
  switch (event.event) {
    case "proposed": return "ME3 proposed this payment";
    case "approved": return record(data.auth).channel === "mobile" ? "You approved it on your phone" : "You approved it after signing in again";
    case "declined": return "You declined it";
    case "handed_over": return "Handed over for you to pay on your device";
    case "receipt_recorded": return data.source === "owner" ? "You confirmed the receipt" : `Receipt read from the order email${data.mismatch === true ? " · amount differs" : ""}`;
    case "not_paid": return "You said you didn't buy it";
    default: return event.event.replace(/_/g, " ");
  }
}

/** Server timestamps are UTC, sometimes without a zone ("2026-10-17 10:00:00"). */
export function paymentTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(time) ? null : time;
}

export function paymentDate(value: string | null | undefined): string {
  const time = paymentTimestamp(value);
  return time === null ? "" : new Date(time).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

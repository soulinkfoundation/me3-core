import { ApiError } from "../api";

/**
 * Agent payments on web (me3-2gdu.4/.5). ME3 proposes an exact purchase, the owner
 * approves it after a fresh sign-in, and then pays on their own device. Core never
 * charges, so nothing here may describe a hand-over as a completed payment.
 */
export const PAYMENT_HOW_IT_WORKS = "You pay on your own device. ME3 does not charge you and never sees your card details.";
export const NETWORK_PAYMENT_HOW_IT_WORKS = "After you approve, ME3 asks the seller to hold it for 15 minutes and gives you their secure checkout. You pay on your own device; ME3 never sees your card details.";

export type PaymentStatus = "proposed" | "declined" | "handed_over" | "paid" | "not_paid";
export type PaymentItem = { name: string; quantity: number; options?: string | null };
export type PaymentReceipt = {
  amount: string; currency: string; orderReference: string | null; paidAt: string | null;
  source: string; mismatch: boolean; ownerConfirmed: boolean; recordedAt?: string; updatedAt?: string;
};
/** A purchase from another ME3 site (method in_network). The seller's status secret never reaches the web. */
export type PaymentNetwork = {
  seller: { name: string; handle: string | null; profileId: string | null };
  offering: { id: string; kind: string; title: string };
  slot: { start: string; end: string | null; timezone: string | null } | null;
  quantity: number; sharesWith: { name: string; email: string };
  checkoutStatus: "not_started" | "pending" | "paid" | "expired" | "cancelled" | "price_changed" | "unavailable" | "agent_checkout_off" | string;
  payUrl: string | null; expiresAt: string | null; livePrice: { amount: string; currency: string } | null;
  reference: { type: string | null; id: string } | null; calendarEventId: string | null; lastCheckedAt?: string | null;
};
export type PaymentRecord = {
  id: string; status: string; method?: string; network?: PaymentNetwork | null; merchant: { name: string; url: string }; purpose: string; items: PaymentItem[];
  amount: string; currency: string; checkoutUrl: string | null; checkoutDomainDiffers: boolean; refundPolicy: string | null;
  threadId?: string; approvalId?: string | null; approvedWith?: Record<string, unknown> | null; createdAt: string; decidedAt: string | null; handedOverAt: string | null;
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
  /** Present for purchases from another ME3 site. */
  network: { sellerName: string; slotLabel: string | null; sharesNotice: string; sharesWith: string | null } | null;
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
  const network = card.method === "in_network" ? record(card.network) : null;
  const sellerName = text(record(network?.seller).name) || text(merchant.name) || "the seller";
  const slot = record(network?.slot), sharesWith = record(network?.sharesWith);
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
    howItWorks: network ? NETWORK_PAYMENT_HOW_IT_WORKS : PAYMENT_HOW_IT_WORKS,
    network: network ? {
      sellerName,
      slotLabel: text(slot.start) ? paymentSlotLabel(text(slot.start), text(slot.timezone) || null) : null,
      // Fixed copy: the owner must always see who receives their details.
      sharesNotice: `Shares your name and email with ${sellerName}.`,
      sharesWith: text(sharesWith.name) && text(sharesWith.email) ? `${text(sharesWith.name)} · ${text(sharesWith.email)}` : null,
    } : null,
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
  if (payment.network) {
    const payUrl = payment.network.checkoutStatus === "pending" ? safeHttpsUrl(payment.network.payUrl) : null;
    if (!payUrl) return null;
    const until = payment.network.expiresAt ? paymentTime(payment.network.expiresAt) : "";
    return { openUrl: payUrl.toString(), instructions: `Open ${payment.network.seller.name}'s secure checkout on your own device and pay ${formatPaymentMoney(payment.amount, payment.currency)}.${until ? ` It's held for you until ${until}.` : ""} ME3 does not charge you.` };
  }
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

/**
 * The owner approved (the server bound their fresh sign-in) but the agent never resumed to hand the
 * purchase over. Re-sending the owner's same decision re-runs the hand-over, so it stays the owner's click.
 */
export function paymentStalledHandOver(payment: PaymentRecord): { approvalId: string } | null {
  return payment.status === "proposed" && payment.approvedWith && payment.approvalId ? { approvalId: payment.approvalId } : null;
}

export function paymentDisplayStatus(payment: PaymentRecord): string {
  if (payment.status === "proposed" && payment.approvedWith) return "Approved · hand-over not finished";
  if (payment.network && payment.status === "handed_over") return "Waiting for you to pay";
  if (payment.network && payment.status === "not_paid") return paymentNetworkNote(payment) ?? paymentStatusLabel(payment.status);
  return paymentStatusLabel(payment.status);
}

/** What happened at the seller for a network purchase, in the owner's words. */
export function paymentNetworkNote(payment: PaymentRecord): string | null {
  const network = payment.network;
  if (!network) return null;
  switch (network.checkoutStatus) {
    case "pending": return network.expiresAt ? `Held until ${paymentTime(network.expiresAt)}` : "Held for you";
    case "paid": return network.calendarEventId ? "Paid · in your calendar" : "Paid · receipt from the seller";
    case "expired": return "Hold expired · nothing bought";
    case "price_changed": return network.livePrice ? `Price changed to ${formatPaymentMoney(network.livePrice.amount, network.livePrice.currency)} · nothing bought` : "Price changed · nothing bought";
    case "unavailable": return "No longer available · nothing bought";
    case "agent_checkout_off": return `Book on ${network.seller.name}'s page · nothing bought`;
    case "cancelled": return `Cancelled by ${network.seller.name}`;
    default: return null;
  }
}

export function paymentSlotLabel(start: string, timezone: string | null): string {
  const time = paymentTimestamp(start);
  if (time === null) return start;
  try { return new Date(time).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(timezone ? { timeZone: timezone, timeZoneName: "short" } : {}) }); }
  catch { return new Date(time).toLocaleString(); }
}

function paymentTime(value: string): string {
  const time = paymentTimestamp(value);
  return time === null ? "" : new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function paymentReceiptWarning(payment: PaymentRecord): string | null {
  const receipt = payment.receipt;
  if (!receipt?.mismatch) return null;
  return `The receipt shows ${formatPaymentMoney(receipt.amount, receipt.currency)}, but you approved ${formatPaymentMoney(payment.amount, payment.currency)}.`;
}

/** Receipt actions the server accepts for this status. */
export function paymentActions(payment: PaymentRecord) {
  return {
    confirm: payment.status === "handed_over" || payment.status === "paid", notPaid: payment.status === "handed_over" && !payment.receipt,
    // Network purchases can be checked with the seller on demand.
    checkSeller: payment.network?.checkoutStatus === "pending",
  };
}

export function paymentAuditLabel(event: PaymentAuditEvent): string {
  const data = record(event.data);
  switch (event.event) {
    case "proposed": return "ME3 proposed this payment";
    case "approved": return record(data.auth).channel === "mobile" ? "You approved it on your phone" : "You approved it after signing in again";
    case "declined": return "You declined it";
    case "handed_over": return data.network === true ? "The seller is holding it; handed over for you to pay" : "Handed over for you to pay on your device";
    case "receipt_recorded": return data.source === "owner" ? "You confirmed the receipt" : data.source === "seller" ? `Receipt from the seller${data.mismatch === true ? " · amount differs" : ""}` : `Receipt read from the order email${data.mismatch === true ? " · amount differs" : ""}`;
    case "network_paid": return data.calendarEventId ? "Paid at the seller · added to your calendar" : "Paid at the seller";
    case "price_changed": return "The seller's price changed, so nothing was bought";
    case "unavailable": return "No longer available at the seller, so nothing was bought";
    case "agent_checkout_off": return "The seller turned agent checkout off, so nothing was bought";
    case "checkout_expired": return "The 15-minute hold expired before payment";
    case "network_cancelled": return "The seller cancelled it";
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

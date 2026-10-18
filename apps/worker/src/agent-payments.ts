import type { AgentPaymentServices, PaymentProposalRecord } from "../../../packages/agent/src/tools";
import type { Env } from "./types";

/**
 * Agent payments (me3-2gdu.3). ME3 proposes an exact purchase; the owner approves
 * it with a fresh sign-in and then pays on their own device. Core never holds card
 * details and never charges: "executing" an approved proposal hands the checkout
 * over to the owner, exactly once. Receipts come from the owner or an order email.
 */
export const AGENT_PAYMENTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS agent_payment_proposals (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('finish_on_device', 'browser_takeover', 'link_card', 'in_network')),
    merchant_name TEXT NOT NULL,
    merchant_url TEXT NOT NULL,
    purpose TEXT NOT NULL,
    items_json TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    checkout_url TEXT,
    refund_policy TEXT,
    proposal_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'declined', 'handed_over', 'paid', 'not_paid')),
    approval_id TEXT,
    approval_auth TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    handed_over_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS agent_payment_proposals_owner ON agent_payment_proposals(owner_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS agent_payment_receipts (
    proposal_id TEXT PRIMARY KEY REFERENCES agent_payment_proposals(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    order_reference TEXT,
    paid_at TEXT,
    source TEXT NOT NULL CHECK (source IN ('owner', 'email')),
    source_message_id TEXT,
    mismatch INTEGER NOT NULL DEFAULT 0 CHECK (mismatch IN (0, 1)),
    owner_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (owner_confirmed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS agent_payment_limits (
    owner_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    per_payment_max_minor INTEGER NOT NULL CHECK (per_payment_max_minor >= 0),
    monthly_max_minor INTEGER NOT NULL CHECK (monthly_max_minor >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_id, currency)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_payment_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    event TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS agent_payment_events_proposal ON agent_payment_events(owner_id, proposal_id, seq)`,
];

export const PAYMENT_TOOL_PREFIX = "core_payments_";
export const PAYMENT_PROPOSE_TOOL = "core_payments_propose";
/** Purchases from another ME3 site's agent commerce API (agent-network-commerce.ts). */
export const PAYMENT_PROPOSE_NETWORK_TOOL = "core_payments_propose_network";
/** Approvals of these tools need a fresh sign-in and are bound to a payment proposal. */
export function isPaymentApprovalTool(toolName: string): boolean {
  return toolName === PAYMENT_PROPOSE_TOOL || toolName === PAYMENT_PROPOSE_NETWORK_TOOL;
}
/** A web approval must come from a session signed in within this window. */
export const PAYMENT_FRESH_SIGN_IN_SECONDS = 10 * 60;
/** Defaults in whole currency units when the owner has not set limits. */
export const DEFAULT_PAYMENT_LIMITS = { perPayment: 250, monthly: 1000 } as const;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export class PaymentError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type PaymentItem = { name: string; quantity: number; options?: string };
export type PaymentProposalInput = {
  merchantName: unknown; merchantUrl: unknown; purpose: unknown; items: unknown;
  amount: unknown; currency: unknown; checkoutUrl?: unknown; refundPolicy?: unknown;
};
export type PaymentScope = { threadId: string; turnId: string; idempotencyKey: string };
/** What an in-network proposal binds besides the price: who sells what, when, and what is shared. */
export type NetworkProposalDetails = {
  sellerProfileId: string | null; sellerHandle: string | null; apiBase: string; offeringId: string; offeringKind: string; offeringTitle: string;
  slotStart: string | null; slotEnd: string | null; slotRequired: boolean; timezone: string | null; quantity: number; unitAmountMinor: number; buyerName: string; buyerEmail: string;
};
export type PaymentAuth = { channel: "web"; signedInAt: string } | { channel: "mobile"; deviceAuthentication: "biometric" | "passcode" };

export type ProposalRow = {
  id: string; owner_id: string; thread_id: string; turn_id: string; method: string; merchant_name: string; merchant_url: string;
  purpose: string; items_json: string; amount_minor: number; currency: string; checkout_url: string | null; refund_policy: string | null;
  proposal_hash: string; status: string; approval_id: string | null; approval_auth: string | null; created_at: string;
  decided_at: string | null; handed_over_at: string | null; completed_at: string | null;
};
export type NetworkPurchaseRow = {
  proposal_id: string; owner_id: string; seller_name: string; seller_profile_id: string | null; seller_handle: string | null; api_base: string;
  offering_id: string; offering_kind: string; offering_title: string; slot_start: string | null; slot_end: string | null; timezone: string | null; slot_required: number;
  quantity: number; buyer_name: string; buyer_email: string; checkout_idempotency_key: string; checkout_id: string | null; pay_url: string | null;
  encrypted_status_secret: string | null; checkout_status: string; live_amount_minor: number | null; live_currency: string | null; expires_at: string | null;
  reference_type: string | null; reference_id: string | null; calendar_event_id: string | null; last_checked_at: string | null; next_check_at: string | null;
  check_error: string | null; created_at: string; updated_at: string;
};
type ReceiptRow = {
  proposal_id: string; amount_minor: number; currency: string; order_reference: string | null; paid_at: string | null;
  source: string; source_message_id: string | null; mismatch: number; owner_confirmed: number; created_at: string; updated_at: string;
};

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2;
}

export function normalizeCurrency(value: unknown): string {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) throw new PaymentError("Currency must be a three-letter ISO 4217 code such as EUR.");
  return currency;
}

/** Parses a decimal string ("12.50") into integer minor units without floating point. */
export function toMinorUnits(value: unknown, currency: string): number {
  const exponent = currencyExponent(currency);
  const text = typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const match = /^(\d{1,9})(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2]?.length ?? 0) > exponent) throw new PaymentError(`Amount must be a positive number with at most ${exponent} decimal places for ${currency}.`);
  const minor = Number(match[1]) * 10 ** exponent + Number((match[2] ?? "").padEnd(exponent, "0") || 0);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new PaymentError("Amount must be greater than zero.");
  return minor;
}

export function formatMinorUnits(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const whole = Math.floor(minor / 10 ** exponent);
  const fraction = exponent ? `.${String(minor % 10 ** exponent).padStart(exponent, "0")}` : "";
  return `${whole}${fraction}`;
}

function requiredText(value: unknown, label: string, max = 300): string {
  if (typeof value !== "string" || !value.trim()) throw new PaymentError(`${label} is required.`);
  if (value.trim().length > max) throw new PaymentError(`${label} is too long.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, label, max);
}

/** Only public https pages: a payment link must never point at the installation or a private network. */
export function publicHttpsUrl(value: unknown, label: string): URL {
  let url: URL;
  try { url = new URL(requiredText(value, label, 2000)); } catch (error) { if (error instanceof PaymentError) throw error; throw new PaymentError(`${label} must be a full https URL.`); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")
    || /^(?:127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
  if (url.protocol !== "https:" || privateHost || url.username || url.password) throw new PaymentError(`${label} must be a public https URL.`);
  url.hash = "";
  return url;
}

function normalizeItems(value: unknown): PaymentItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new PaymentError("Items must list between 1 and 20 things being bought.");
  return value.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const quantity = record.quantity === undefined ? 1 : record.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new PaymentError(`Item ${index + 1} quantity must be a whole number from 1 to 999.`);
    const options = optionalText(record.options, `Item ${index + 1} options`, 300);
    return { name: requiredText(record.name, `Item ${index + 1} name`, 200), quantity, ...(options ? { options } : {}) };
  });
}

function registrableHost(url: URL) { return url.hostname.toLowerCase().replace(/^www\./, ""); }

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function networkView(row: NetworkPurchaseRow) {
  // The checkout status secret never leaves the server: not in views, tool results or the web.
  return {
    seller: { name: row.seller_name, handle: row.seller_handle, profileId: row.seller_profile_id },
    offering: { id: row.offering_id, kind: row.offering_kind, title: row.offering_title },
    slot: row.slot_start ? { start: row.slot_start, end: row.slot_end, timezone: row.timezone } : null,
    quantity: row.quantity, sharesWith: { name: row.buyer_name, email: row.buyer_email },
    checkoutStatus: row.checkout_status, checkoutId: row.checkout_id, payUrl: row.checkout_status === "pending" ? row.pay_url : null, expiresAt: row.expires_at,
    livePrice: row.live_amount_minor !== null && row.live_currency ? { amount: formatMinorUnits(row.live_amount_minor, row.live_currency), amountMinor: row.live_amount_minor, currency: row.live_currency } : null,
    reference: row.reference_id ? { type: row.reference_type, id: row.reference_id } : null,
    calendarEventId: row.calendar_event_id, lastCheckedAt: row.last_checked_at,
  };
}

function proposalView(row: ProposalRow, receipt?: ReceiptRow | null, network?: NetworkPurchaseRow | null) {
  const checkoutHost = row.checkout_url ? new URL(row.checkout_url).hostname : null;
  return {
    id: row.id, status: row.status, method: row.method,
    merchant: { name: row.merchant_name, url: row.merchant_url },
    purpose: row.purpose, items: JSON.parse(row.items_json) as PaymentItem[],
    amount: formatMinorUnits(row.amount_minor, row.currency), amountMinor: row.amount_minor, currency: row.currency,
    checkoutUrl: row.checkout_url, checkoutDomainDiffers: checkoutHost !== null && registrableHost(new URL(row.merchant_url)) !== checkoutHost.toLowerCase().replace(/^www\./, ""),
    refundPolicy: row.refund_policy, proposalHash: row.proposal_hash, threadId: row.thread_id, turnId: row.turn_id,
    approvalId: row.approval_id, approvedWith: row.approval_auth ? JSON.parse(row.approval_auth) as PaymentAuth : null,
    createdAt: row.created_at, decidedAt: row.decided_at, handedOverAt: row.handed_over_at, completedAt: row.completed_at,
    receipt: receipt ? {
      amount: formatMinorUnits(receipt.amount_minor, receipt.currency), amountMinor: receipt.amount_minor, currency: receipt.currency,
      orderReference: receipt.order_reference, paidAt: receipt.paid_at, source: receipt.source, sourceMessageId: receipt.source_message_id,
      mismatch: receipt.mismatch === 1, ownerConfirmed: receipt.owner_confirmed === 1, recordedAt: receipt.created_at, updatedAt: receipt.updated_at,
    } : null,
    network: network ? networkView(network) : null,
  };
}
export type PaymentProposalView = ReturnType<typeof proposalView>;

export async function appendEvent(env: Env, ownerId: string, proposalId: string, event: string, data: Record<string, unknown> = {}) {
  await env.DB.prepare("INSERT INTO agent_payment_events(owner_id,proposal_id,event,data_json) VALUES(?,?,?,?)").bind(ownerId, proposalId, event, JSON.stringify(data)).run();
}

export async function loadProposal(env: Env, ownerId: string, id: string): Promise<ProposalRow | null> {
  return env.DB.prepare("SELECT * FROM agent_payment_proposals WHERE owner_id=? AND id=?").bind(ownerId, id).first<ProposalRow>();
}

export async function loadNetworkPurchase(env: Env, ownerId: string, proposalId: string): Promise<NetworkPurchaseRow | null> {
  return env.DB.prepare("SELECT * FROM agent_network_purchases WHERE owner_id=? AND proposal_id=?").bind(ownerId, proposalId).first<NetworkPurchaseRow>();
}

/** The owner-facing view of one payment, with its receipt and, for network purchases, the seller checkout. */
export async function paymentView(env: Env, ownerId: string, row: ProposalRow) {
  return proposalView(row, await loadReceipt(env, ownerId, row.id), row.method === "in_network" ? await loadNetworkPurchase(env, ownerId, row.id) : null);
}

export async function getPaymentLimits(env: Env, ownerId: string, currency: string) {
  currency = normalizeCurrency(currency);
  const row = await env.DB.prepare("SELECT per_payment_max_minor,monthly_max_minor,updated_at FROM agent_payment_limits WHERE owner_id=? AND currency=?").bind(ownerId, currency).first<{ per_payment_max_minor: number; monthly_max_minor: number; updated_at: string }>();
  const scale = 10 ** currencyExponent(currency);
  const perPaymentMaxMinor = row?.per_payment_max_minor ?? DEFAULT_PAYMENT_LIMITS.perPayment * scale;
  const monthlyMaxMinor = row?.monthly_max_minor ?? DEFAULT_PAYMENT_LIMITS.monthly * scale;
  const since = new Date(Date.now() - MONTH_MS).toISOString();
  // Approved hand-overs count even before a receipt arrives, so limits cannot be bypassed by never confirming.
  const used = await env.DB.prepare(`SELECT COALESCE(SUM(COALESCE(r.amount_minor,p.amount_minor)),0) AS used FROM agent_payment_proposals p
    LEFT JOIN agent_payment_receipts r ON r.proposal_id=p.id AND r.currency=p.currency
    WHERE p.owner_id=? AND p.currency=? AND p.status IN ('handed_over','paid') AND p.handed_over_at>=?`).bind(ownerId, currency, since).first<{ used: number }>();
  const usedMinor = Number(used?.used ?? 0);
  return {
    currency, custom: Boolean(row), updatedAt: row?.updated_at ?? null,
    perPaymentMax: formatMinorUnits(perPaymentMaxMinor, currency), perPaymentMaxMinor,
    monthlyMax: formatMinorUnits(monthlyMaxMinor, currency), monthlyMaxMinor,
    usedLast30Days: formatMinorUnits(usedMinor, currency), usedLast30DaysMinor: usedMinor,
    remaining: formatMinorUnits(Math.max(0, monthlyMaxMinor - usedMinor), currency), remainingMinor: Math.max(0, monthlyMaxMinor - usedMinor),
  };
}

export async function savePaymentLimits(env: Env, ownerId: string, input: { currency?: unknown; perPaymentMax?: unknown; monthlyMax?: unknown }) {
  const currency = normalizeCurrency(input.currency);
  const minor = (value: unknown, label: string) => value === "0" || value === 0 ? 0 : (() => { try { return toMinorUnits(value, currency); } catch { throw new PaymentError(`${label} must be zero or a positive amount in ${currency}.`); } })();
  const perPayment = minor(input.perPaymentMax, "Per-payment limit");
  const monthly = minor(input.monthlyMax, "Monthly limit");
  if (perPayment > monthly) throw new PaymentError("The per-payment limit cannot be higher than the monthly limit.");
  await env.DB.prepare(`INSERT INTO agent_payment_limits(owner_id,currency,per_payment_max_minor,monthly_max_minor,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(owner_id,currency) DO UPDATE SET per_payment_max_minor=excluded.per_payment_max_minor,monthly_max_minor=excluded.monthly_max_minor,updated_at=CURRENT_TIMESTAMP`)
    .bind(ownerId, currency, perPayment, monthly).run();
  return getPaymentLimits(env, ownerId, currency);
}

export async function assertWithinLimits(env: Env, ownerId: string, amountMinor: number, currency: string) {
  const limits = await getPaymentLimits(env, ownerId, currency);
  if (amountMinor > limits.perPaymentMaxMinor) throw new PaymentError(`This is above the owner's per-payment limit of ${limits.perPaymentMax} ${currency}. The owner can change limits in Payments settings.`, 403);
  if (amountMinor > limits.remainingMinor) throw new PaymentError(`This would exceed the owner's 30-day limit of ${limits.monthlyMax} ${currency} (${limits.remaining} left). The owner can change limits in Payments settings.`, 403);
  return limits;
}

/** Saves an immutable proposal. Retrying the same tool call returns the same proposal; a changed retry is refused. */
export async function proposePayment(env: Env, ownerId: string, scope: PaymentScope, input: PaymentProposalInput, network?: NetworkProposalDetails) {
  const currency = normalizeCurrency(input.currency);
  const amountMinor = toMinorUnits(input.amount, currency);
  const merchantUrl = publicHttpsUrl(input.merchantUrl, "Merchant URL");
  const checkoutUrl = input.checkoutUrl === undefined || input.checkoutUrl === null || input.checkoutUrl === "" ? null : publicHttpsUrl(input.checkoutUrl, "Checkout URL");
  const immutable = {
    method: network ? "in_network" : "finish_on_device", merchantName: requiredText(input.merchantName, "Merchant name", 200), merchantUrl: merchantUrl.toString(),
    purpose: requiredText(input.purpose, "Purpose", 500), items: normalizeItems(input.items), amountMinor, currency,
    checkoutUrl: checkoutUrl?.toString() ?? null, refundPolicy: optionalText(input.refundPolicy, "Refund policy"),
    // Network purchases bind the seller, offering, slot and the details shared with the seller.
    ...(network ? { network } : {}),
  };
  const hash = await sha256(JSON.stringify(immutable));
  const existing = await env.DB.prepare("SELECT * FROM agent_payment_proposals WHERE owner_id=? AND idempotency_key=?").bind(ownerId, scope.idempotencyKey).first<ProposalRow>();
  if (existing) {
    if (existing.proposal_hash !== hash) throw new PaymentError("This payment proposal changed after it was saved. Propose it again for a fresh review.", 409);
    return paymentView(env, ownerId, existing);
  }
  await assertWithinLimits(env, ownerId, amountMinor, currency);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT OR IGNORE INTO agent_payment_proposals(id,owner_id,thread_id,turn_id,idempotency_key,method,merchant_name,merchant_url,purpose,items_json,amount_minor,currency,checkout_url,refund_policy,proposal_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, ownerId, scope.threadId, scope.turnId, scope.idempotencyKey, immutable.method, immutable.merchantName, immutable.merchantUrl,
    immutable.purpose, JSON.stringify(immutable.items), amountMinor, currency, immutable.checkoutUrl, immutable.refundPolicy, hash).run();
  const saved = await env.DB.prepare("SELECT * FROM agent_payment_proposals WHERE owner_id=? AND idempotency_key=?").bind(ownerId, scope.idempotencyKey).first<ProposalRow>();
  if (!saved || saved.proposal_hash !== hash) throw new PaymentError("This payment proposal conflicts with a concurrent one.", 409);
  if (saved.id === id) await appendEvent(env, ownerId, id, "proposed", { amountMinor, currency, merchant: immutable.merchantName, ...(network ? { network: true } : {}) });
  return proposalView(saved);
}

/** Validates the fresh-authentication evidence a payment approval must carry. */
export function paymentApprovalAuth(input: { channel: "web" | "mobile"; sessionIssuedAt?: number | null; deviceAuthentication?: unknown }, nowSeconds = Math.floor(Date.now() / 1000)): PaymentAuth {
  if (input.channel === "web") {
    if (!input.sessionIssuedAt || nowSeconds - input.sessionIssuedAt > PAYMENT_FRESH_SIGN_IN_SECONDS) throw new PaymentError("Sign in again to approve this payment.", 403);
    return { channel: "web", signedInAt: new Date(input.sessionIssuedAt * 1000).toISOString() };
  }
  // Native apps unlock the approval with Face ID, Touch ID or the device passcode before calling.
  if (input.deviceAuthentication !== "biometric" && input.deviceAuthentication !== "passcode") throw new PaymentError("Confirm with Face ID, fingerprint or your device passcode to approve this payment.", 403);
  return { channel: "mobile", deviceAuthentication: input.deviceAuthentication };
}

/** Binds an owner decision to its proposal before the agent resumes. Declines are final. */
export async function recordPaymentDecision(env: Env, ownerId: string, approval: { id: string; tool_name: string; card_json: string }, decision: "approved" | "declined", auth?: PaymentAuth) {
  if (!isPaymentApprovalTool(approval.tool_name)) return;
  const card = JSON.parse(approval.card_json) as { proposalId?: unknown; proposalHash?: unknown };
  const proposal = typeof card.proposalId === "string" ? await loadProposal(env, ownerId, card.proposalId) : null;
  if (!proposal || proposal.proposal_hash !== card.proposalHash) {
    // Declining is always allowed; there is simply nothing to mark.
    if (decision === "declined") return;
    throw new PaymentError("The payment proposal no longer matches what was reviewed.", 409);
  }
  if (decision === "declined") {
    const result = await env.DB.prepare("UPDATE agent_payment_proposals SET status='declined',approval_id=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='proposed' AND approval_auth IS NULL").bind(approval.id, ownerId, proposal.id).run();
    if (result.meta?.changes) await appendEvent(env, ownerId, proposal.id, "declined", { approvalId: approval.id });
    return;
  }
  if (!auth) throw new PaymentError("A payment approval needs a fresh sign-in.", 403);
  if (proposal.status !== "proposed" && proposal.approval_id !== approval.id) throw new PaymentError("This payment was already decided.", 409);
  const result = await env.DB.prepare("UPDATE agent_payment_proposals SET approval_id=?,approval_auth=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='proposed' AND approval_auth IS NULL")
    .bind(approval.id, JSON.stringify(auth), ownerId, proposal.id).run();
  if (result.meta?.changes) await appendEvent(env, ownerId, proposal.id, "approved", { approvalId: approval.id, auth });
}

/** Hands the approved purchase to the owner. Runs at most once; a retry returns the same hand-over. */
export async function handOverApprovedPayment(env: Env, ownerId: string, proposalId: string, expectedHash: string) {
  const proposal = await loadProposal(env, ownerId, proposalId);
  if (!proposal || proposal.proposal_hash !== expectedHash) throw new PaymentError("The payment proposal no longer matches what was reviewed.", 409);
  if (proposal.status === "declined") throw new PaymentError("The owner declined this payment.", 409);
  if (!proposal.approval_auth) throw new PaymentError("This payment has not been approved with a fresh sign-in.", 403);
  if (proposal.method === "in_network") throw new PaymentError("Network purchases are handed over through the seller's checkout.", 409);
  if (proposal.status === "proposed") {
    // Limits are checked again at execution so concurrent approvals cannot overspend.
    await assertWithinLimits(env, ownerId, proposal.amount_minor, proposal.currency);
    const result = await env.DB.prepare("UPDATE agent_payment_proposals SET status='handed_over',handed_over_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='proposed' AND proposal_hash=?")
      .bind(ownerId, proposalId, expectedHash).run();
    if (result.meta?.changes) await appendEvent(env, ownerId, proposalId, "handed_over", {});
  }
  const current = await loadProposal(env, ownerId, proposalId);
  if (!current || !["handed_over", "paid", "not_paid"].includes(current.status)) throw new PaymentError("This payment could not be handed over.", 409);
  const view = proposalView(current, await loadReceipt(env, ownerId, proposalId));
  return {
    proposal: view,
    handOver: {
      openUrl: view.checkoutUrl ?? view.merchant.url,
      instructions: view.checkoutUrl
        ? `Open the checkout link on your own device and pay ${view.amount} ${view.currency} to ${view.merchant.name}. ME3 does not charge you.`
        : `Open ${view.merchant.name} on your own device, add the items listed, and pay ${view.amount} ${view.currency}. ME3 does not charge you.`,
    },
  };
}

async function loadReceipt(env: Env, ownerId: string, proposalId: string) {
  return env.DB.prepare("SELECT * FROM agent_payment_receipts WHERE owner_id=? AND proposal_id=?").bind(ownerId, proposalId).first<ReceiptRow>();
}

/**
 * Records what was actually paid. The agent records from an order email; the owner
 * can confirm or correct it. An agent never overwrites an owner-confirmed receipt.
 */
export async function recordPaymentReceipt(env: Env, ownerId: string, input: { proposalId: unknown; amount: unknown; currency?: unknown; orderReference?: unknown; paidAt?: unknown; sourceMessageId?: unknown }, source: "owner" | "email" | "seller") {
  const proposalId = requiredText(input.proposalId, "Payment ID", 100);
  const proposal = await loadProposal(env, ownerId, proposalId);
  if (!proposal) throw new PaymentError("Payment not found.", 404);
  if (!["handed_over", "paid"].includes(proposal.status)) throw new PaymentError("Only an approved, handed-over payment can have a receipt.", 409);
  const currency = input.currency === undefined || input.currency === null || input.currency === "" ? proposal.currency : normalizeCurrency(input.currency);
  const amountMinor = toMinorUnits(input.amount, currency);
  const paidAt = optionalText(input.paidAt, "Paid at", 40);
  if (paidAt && Number.isNaN(Date.parse(paidAt))) throw new PaymentError("Paid at must be an ISO date and time.");
  const sourceMessageId = source === "email" ? requiredText(input.sourceMessageId, "Order email ID", 200) : null;
  const existing = await loadReceipt(env, ownerId, proposalId);
  if (existing?.owner_confirmed && source !== "owner") throw new PaymentError("The owner already confirmed this receipt.", 409);
  // The seller's own checkout record outranks an order email.
  if (existing?.source === "seller" && source === "email") throw new PaymentError("The seller already reported this receipt.", 409);
  const mismatch = amountMinor !== proposal.amount_minor || currency !== proposal.currency ? 1 : 0;
  await env.DB.prepare(`INSERT INTO agent_payment_receipts(proposal_id,owner_id,amount_minor,currency,order_reference,paid_at,source,source_message_id,mismatch,owner_confirmed)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(proposal_id) DO UPDATE SET amount_minor=excluded.amount_minor,currency=excluded.currency,
    order_reference=COALESCE(excluded.order_reference,agent_payment_receipts.order_reference),paid_at=COALESCE(excluded.paid_at,agent_payment_receipts.paid_at),
    source=excluded.source,source_message_id=COALESCE(excluded.source_message_id,agent_payment_receipts.source_message_id),mismatch=excluded.mismatch,
    owner_confirmed=MAX(agent_payment_receipts.owner_confirmed,excluded.owner_confirmed),updated_at=CURRENT_TIMESTAMP`)
    .bind(proposalId, ownerId, amountMinor, currency, optionalText(input.orderReference, "Order reference", 200), paidAt, source, sourceMessageId, mismatch, source === "owner" ? 1 : 0).run();
  await env.DB.prepare("UPDATE agent_payment_proposals SET status='paid',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status IN ('handed_over','paid')").bind(ownerId, proposalId).run();
  await appendEvent(env, ownerId, proposalId, "receipt_recorded", { source, amountMinor, currency, mismatch: mismatch === 1 });
  return paymentView(env, ownerId, (await loadProposal(env, ownerId, proposalId))!);
}

/** The owner says they did not go through with an approved purchase. */
export async function markPaymentNotPaid(env: Env, ownerId: string, proposalId: string) {
  const result = await env.DB.prepare("UPDATE agent_payment_proposals SET status='not_paid',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='handed_over'").bind(ownerId, proposalId).run();
  if (!result.meta?.changes) throw new PaymentError("Only a handed-over payment without a receipt can be marked as not paid.", 409);
  await appendEvent(env, ownerId, proposalId, "not_paid", {});
  return paymentView(env, ownerId, (await loadProposal(env, ownerId, proposalId))!);
}

export async function listPayments(env: Env, ownerId: string, options: { status?: unknown; limit?: unknown } = {}) {
  const status = typeof options.status === "string" && ["proposed", "declined", "handed_over", "paid", "not_paid"].includes(options.status) ? options.status : null;
  const limit = typeof options.limit === "number" && Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 100) : 25;
  const rows = await env.DB.prepare(`SELECT * FROM agent_payment_proposals WHERE owner_id=?${status ? " AND status=?" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`)
    .bind(...(status ? [ownerId, status, limit] : [ownerId, limit])).all<ProposalRow>();
  const views = [];
  for (const row of rows.results ?? []) views.push(await paymentView(env, ownerId, row));
  return { payments: views };
}

export async function getPayment(env: Env, ownerId: string, proposalId: string) {
  const row = await loadProposal(env, ownerId, proposalId);
  if (!row) throw new PaymentError("Payment not found.", 404);
  const events = await env.DB.prepare("SELECT event,data_json,created_at FROM agent_payment_events WHERE owner_id=? AND proposal_id=? ORDER BY seq").bind(ownerId, proposalId).all<{ event: string; data_json: string; created_at: string }>();
  return { payment: await paymentView(env, ownerId, row), audit: (events.results ?? []).map(event => ({ event: event.event, data: JSON.parse(event.data_json), at: event.created_at })) };
}

/** Agent-facing adapter; proposals are owner-scoped and the agent cannot set an owner receipt. */
export function createAgentPaymentServices(env: Env, ownerId: string): AgentPaymentServices {
  const record = (view: PaymentProposalView) => view as unknown as PaymentProposalRecord;
  return {
    propose: async (input, scope) => record(await proposePayment(env, ownerId, scope, input as PaymentProposalInput)),
    handOver: async (proposalId, proposalHash) => { const result = await handOverApprovedPayment(env, ownerId, proposalId, proposalHash); return { ...result, proposal: record(result.proposal) }; },
    recordReceipt: async input => record(await recordPaymentReceipt(env, ownerId, input as Parameters<typeof recordPaymentReceipt>[2], "email")),
    list: async options => { const result = await listPayments(env, ownerId, options); return { payments: result.payments.map(record) }; },
    limits: currency => getPaymentLimits(env, ownerId, currency),
    shopifyCart: input => shopifyCartLink(input),
  };
}

const SHOPIFY_FETCH_TIMEOUT_MS = 8000;
const SHOPIFY_MAX_BYTES = 2_000_000;
type ShopifyVariant = { id: number; title: string; price: number; available: boolean; option1?: string | null; option2?: string | null; option3?: string | null };
type ShopifyProduct = { title: string; handle: string; vendor?: string; options: Array<{ name: string; values: string[] }>; variants: ShopifyVariant[] };

async function fetchPublicJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url.toString(), { headers: { accept: "application/json" }, redirect: "follow", signal: AbortSignal.timeout(SHOPIFY_FETCH_TIMEOUT_MS) });
  // A redirect must not lead the Worker to a private or non-https address.
  if (response.url) publicHttpsUrl(response.url, "Store address");
  if (!response.ok) throw new PaymentError(`The store returned HTTP ${response.status}.`, 404);
  const text = await response.text();
  if (text.length > SHOPIFY_MAX_BYTES) throw new PaymentError("The store's product data is too large to read.", 404);
  try { return JSON.parse(text); } catch { throw new PaymentError("This store does not publish Shopify product data.", 404); }
}

function parseShopifyProduct(value: unknown): ShopifyProduct {
  const product = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const valid = variants.every(variant => variant && typeof variant === "object" && Number.isSafeInteger((variant as ShopifyVariant).id) && Number.isSafeInteger((variant as ShopifyVariant).price) && typeof (variant as ShopifyVariant).available === "boolean");
  if (typeof product.title !== "string" || typeof product.handle !== "string" || !variants.length || !valid || !Array.isArray(product.options)) throw new PaymentError("This store does not publish Shopify product data.", 404);
  return product as unknown as ShopifyProduct;
}

/**
 * Builds a Shopify cart permalink from the store's own product data, so the variant,
 * availability and price come from the merchant rather than the model. Read-only.
 */
export async function shopifyCartLink(input: { productUrl: unknown; options?: unknown; quantity?: unknown }, fetcher: typeof fetch = fetch) {
  const url = publicHttpsUrl(input.productUrl, "Product URL");
  const match = /^(.*?)(?:\/collections\/[^/]+)?\/products\/([^/?#]+)/.exec(url.pathname);
  if (!match) throw new PaymentError("Use the product page URL, which contains /products/.");
  const prefix = match[1].replace(/\/$/, ""), handle = decodeURIComponent(match[2]).replace(/\.(?:js|json)$/, "");
  const quantity = input.quantity === undefined ? 1 : input.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new PaymentError("Quantity must be a whole number from 1 to 99.");
  const product = parseShopifyProduct(await fetchPublicJson(new URL(`${prefix}/products/${encodeURIComponent(handle)}.js`, url.origin), fetcher));
  const wanted = input.options && typeof input.options === "object" && !Array.isArray(input.options) ? input.options as Record<string, unknown> : {};
  const normalize = (text: unknown) => String(text ?? "").trim().toLowerCase();
  const optionIndex = (name: string) => product.options.findIndex(option => normalize(option.name) === normalize(name));
  const unknownOption = Object.keys(wanted).find(name => optionIndex(name) < 0);
  const choices = { product: product.title, options: product.options.map(option => ({ name: option.name, values: option.values })), variants: product.variants.map(variant => ({ title: variant.title, available: variant.available, price: variant.price })) };
  if (unknownOption) return { status: "choose" as const, reason: `This product has no option called ${unknownOption}.`, ...choices };
  const candidates = product.variants.filter(variant => Object.entries(wanted).every(([name, value]) => normalize((variant as Record<string, unknown>)[`option${optionIndex(name) + 1}`]) === normalize(value)));
  if (candidates.length !== 1) return { status: "choose" as const, reason: candidates.length ? "Choose a value for every option." : "No variant matches those options.", ...choices };
  const variant = candidates[0];
  if (!variant.available) return { status: "unavailable" as const, reason: `${product.title} (${variant.title}) is sold out.`, ...choices };
  // The store's currency comes from a fresh, cookie-less cart.
  let currency: string | null = null;
  try { const cart = await fetchPublicJson(new URL("/cart.js", url.origin), fetcher) as { currency?: unknown }; currency = typeof cart.currency === "string" ? normalizeCurrency(cart.currency) : null; } catch { currency = null; }
  const productUrl = new URL(`${prefix}/products/${encodeURIComponent(handle)}`, url.origin).toString();
  const format = (minor: number) => currency ? formatMinorUnits(minor, currency) : null;
  return {
    status: "ready" as const, merchantUrl: productUrl, store: url.hostname.replace(/^www\./, ""), product: product.title, variant: variant.title, quantity,
    unitPrice: format(variant.price), itemsTotal: format(variant.price * quantity), currency,
    cartUrl: new URL(`/cart/${variant.id}:${quantity}`, url.origin).toString(),
    note: currency ? "Prices come from the store. Delivery and tax may be added at checkout; include them in the proposed total only if the store shows them." : "The store's currency could not be confirmed; check it on the product page before proposing.",
  };
}

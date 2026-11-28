import type { AgentPaymentServices, NetworkSellerRef, PaymentProposalRecord } from "../../../packages/agent/src/tools";
import {
  PaymentError, appendEvent, assertWithinLimits, formatMinorUnits, loadNetworkPurchase, loadProposal, networkLines, paymentView, proposePayment, publicHttpsUrl,
  recordPaymentReceipt, type NetworkLineDetails, type NetworkProposalDetails, type NetworkPurchaseRow, type PaymentScope, type PaymentProposalView, type ProposalRow,
} from "./agent-payments";
import { notifyAgentBackgroundResult } from "./agent-notifications";
import { getOrCreateInstallEncryptionKey } from "./install-secrets";
import type { Env } from "./types";

/**
 * Network commerce, buyer side (me3-2gdu.15). ME3 buys from another ME3 site through
 * that site's agent commerce API (agent-commerce.ts on the seller): live check,
 * an in_network proposal the owner approves with a fresh sign-in, then a seller
 * checkout whose payUrl the owner opens to pay. The checkout's status secret is
 * stored encrypted here and is never returned to the model, the web or logs.
 */
export const AGENT_NETWORK_COMMERCE_SCHEMA = [
  // Seller receipts: the checkout status read from the seller's API.
  `CREATE TABLE IF NOT EXISTS agent_payment_receipts_next (
    proposal_id TEXT PRIMARY KEY REFERENCES agent_payment_proposals(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    order_reference TEXT,
    paid_at TEXT,
    source TEXT NOT NULL CHECK (source IN ('owner', 'email', 'seller')),
    source_message_id TEXT,
    mismatch INTEGER NOT NULL DEFAULT 0 CHECK (mismatch IN (0, 1)),
    owner_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (owner_confirmed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `INSERT INTO agent_payment_receipts_next(proposal_id,owner_id,amount_minor,currency,order_reference,paid_at,source,source_message_id,mismatch,owner_confirmed,created_at,updated_at)
    SELECT proposal_id,owner_id,amount_minor,currency,order_reference,paid_at,source,source_message_id,mismatch,owner_confirmed,created_at,updated_at FROM agent_payment_receipts`,
  `DROP TABLE agent_payment_receipts`,
  `ALTER TABLE agent_payment_receipts_next RENAME TO agent_payment_receipts`,
  `CREATE TABLE IF NOT EXISTS agent_network_purchases (
    proposal_id TEXT PRIMARY KEY REFERENCES agent_payment_proposals(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    seller_name TEXT NOT NULL,
    seller_profile_id TEXT,
    seller_handle TEXT,
    api_base TEXT NOT NULL,
    offering_id TEXT NOT NULL,
    offering_kind TEXT NOT NULL CHECK (offering_kind IN ('booking', 'event', 'product')),
    offering_title TEXT NOT NULL,
    slot_start TEXT,
    slot_end TEXT,
    timezone TEXT,
    slot_required INTEGER NOT NULL DEFAULT 0 CHECK (slot_required IN (0, 1)),
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    checkout_idempotency_key TEXT NOT NULL UNIQUE,
    checkout_id TEXT,
    pay_url TEXT,
    encrypted_status_secret TEXT,
    checkout_status TEXT NOT NULL DEFAULT 'not_started' CHECK (checkout_status IN ('not_started', 'pending', 'paid', 'expired', 'cancelled', 'price_changed', 'unavailable', 'agent_checkout_off')),
    live_amount_minor INTEGER,
    live_currency TEXT,
    expires_at TEXT,
    reference_type TEXT,
    reference_id TEXT,
    calendar_event_id TEXT,
    last_checked_at TEXT,
    next_check_at TEXT,
    check_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS agent_network_purchases_due ON agent_network_purchases(checkout_status, next_check_at)`,
];

const SELLER_TIMEOUT_MS = 8000;
const SELLER_MAX_BYTES = 256_000;
const MAX_SLOTS = 60;
/** Several offerings from one seller in one checkout; the seller says how many it takes. */
const MAX_LINES = 5;
const SELLER_API_PATH = /^\/api\/agent-commerce\/v1\/sites\/([^/]+)$/;
/** Poll every minute while a hold or payment window can still be open, then back off. */
const POLL_SCHEDULE = [{ untilMs: 45 * 60_000, everyMs: 60_000 }, { untilMs: 3 * 60 * 60_000, everyMs: 10 * 60_000 }, { untilMs: 24 * 60 * 60_000, everyMs: 60 * 60_000 }];

type SellerResponse = { status: number; body: Record<string, unknown> };
type LiveOffering = {
  id: string; kind: "booking" | "event" | "product"; title: string; description: string | null; amount: number; currency: string; free: boolean;
  durationMinutes: number | null; timezone: string | null; requiresSlot: boolean; maxQuantity: number; refundPolicy: string | null;
  schedule: { startsAt?: string; endsAt?: string } | null;
};
type LiveSlot = { start: string; end: string; localDate: string | null; localTime: string | null; remaining: number | null };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 500): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const instant = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null;

/** The seller's API base, from the spec URL its me.json and the index advertise. Public https only. */
export function sellerApiBase(specUrl: unknown, env?: Env): string {
  const url = publicHttpsUrl(specUrl, "Seller checkout address", env);
  const path = url.pathname.replace(/\/openapi\.json$/, "");
  if (url.search || !url.pathname.endsWith("/openapi.json") || !SELLER_API_PATH.test(path)) throw new PaymentError("This seller does not publish an ME3 agent checkout.", 400);
  return `${url.origin}${path}`;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get("content-length") || 0) > maxBytes) throw new PaymentError("The seller's answer is too large to read.", 502);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw new PaymentError("The seller's answer is too large to read.", 502); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** One request to a seller's agent commerce API: no redirects, a timeout and a size limit. */
async function sellerRequest(env: Env, base: string, path: string, init: { method?: "GET" | "POST"; body?: unknown; bearer?: string } = {}): Promise<SellerResponse> {
  const url = publicHttpsUrl(`${base}${path}`, "Seller checkout address", env);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method ?? "GET", redirect: "manual", signal: AbortSignal.timeout(SELLER_TIMEOUT_MS),
      headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new PaymentError("The seller's site did not answer. Try again in a moment.", 503);
  }
  // A redirect could lead the Worker somewhere private; seller APIs answer directly.
  if (response.status >= 300 && response.status < 400) throw new PaymentError("The seller's site answered with a redirect, which ME3 does not follow for purchases.", 502);
  const raw = await readCapped(response, SELLER_MAX_BYTES);
  let body: Record<string, unknown> = {};
  try { body = record(JSON.parse(raw)); } catch { body = {}; }
  return { status: response.status, body };
}

function parseOffering(value: unknown): LiveOffering | null {
  const raw = record(value);
  const id = text(raw.id, 200), title = text(raw.title, 200), currency = text(raw.currency, 3)?.toUpperCase();
  const kind = raw.kind === "booking" || raw.kind === "event" || raw.kind === "product" ? raw.kind : null;
  if (!id || !title || !kind || !currency || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(raw.amount) || (raw.amount as number) < 0) return null;
  const schedule = record(raw.schedule);
  return {
    id, kind, title, description: text(raw.description, 1000), amount: raw.amount as number, currency, free: raw.free === true || raw.amount === 0,
    durationMinutes: Number.isSafeInteger(raw.durationMinutes) ? raw.durationMinutes as number : null, timezone: text(raw.timezone, 80),
    requiresSlot: raw.requiresSlot === true, maxQuantity: Number.isSafeInteger(raw.maxQuantity) && (raw.maxQuantity as number) >= 1 ? Math.min(raw.maxQuantity as number, 100) : 1,
    refundPolicy: text(raw.refundPolicy, 500),
    schedule: instant(schedule.startsAt) ? { startsAt: instant(schedule.startsAt)!, endsAt: instant(schedule.endsAt) ?? undefined } : null,
  };
}

function parseSlots(value: unknown): LiveSlot[] {
  return (Array.isArray(value) ? value : []).slice(0, MAX_SLOTS).flatMap(entry => {
    const raw = record(entry);
    const start = instant(raw.start), end = instant(raw.end);
    if (!start || !end) return [];
    return [{ start, end, localDate: text(raw.localDate, 10), localTime: text(raw.localTime, 5), remaining: Number.isSafeInteger(raw.remaining) ? raw.remaining as number : null }];
  });
}

function sellerError(response: SellerResponse, fallback: string): PaymentError {
  const message = text(response.body.error, 300);
  return new PaymentError(message ? `${fallback} The seller said: ${message}` : `${fallback} (HTTP ${response.status}).`, response.status >= 500 || response.status === 429 ? 503 : 409);
}

function sellerSummary(seller: NetworkSellerRef) {
  return { name: seller.name, handle: seller.handle, profileId: seller.profileId, profileUrl: seller.profileUrl, onMe3Network: true };
}

/** The page a person opens: the offering's own page, else the seller's site. profileUrl (their me.json) is the last resort. */
function sellerPageUrl(env: Env, seller: NetworkSellerRef): string | null {
  for (const candidate of [seller.offeringUrl, seller.publicUrl, seller.profileUrl]) {
    try { if (candidate) return publicHttpsUrl(candidate, "Seller page", env).toString(); } catch { /* try the next link */ }
  }
  return null;
}

function money(minor: number, currency: string) {
  return { amount: formatMinorUnits(minor, currency), amountMinor: minor, currency };
}

function slotLabel(start: string, timezone: string | null): string {
  try {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(start))} (${timezone || "UTC"})`;
  } catch { return start; }
}

/** Live price and availability straight from the seller. Read-only. */
export async function checkNetworkOffering(env: Env, seller: NetworkSellerRef, input: { offeringId: unknown; from?: unknown; to?: unknown }) {
  const base = sellerApiBase(seller.specUrl, env);
  const offeringId = text(input.offeringId, 200);
  if (!offeringId) throw new PaymentError("Offering ID is required.");
  const listed = await sellerRequest(env, base, "/offerings");
  if (listed.status === 403 && listed.body.code === "agent_checkout_disabled") {
    return { status: "agent_checkout_off" as const, seller: sellerSummary(seller), fallbackUrl: sellerPageUrl(env, seller),
      next: "This seller has turned agent checkout off. Give the owner the seller's page link to book or buy there themselves." };
  }
  if (listed.status !== 200) throw sellerError(listed, "The seller's offerings could not be read.");
  const offering = (Array.isArray(listed.body.offerings) ? listed.body.offerings : []).map(parseOffering).find(candidate => candidate?.id === offeringId) ?? null;
  if (!offering) return { status: "not_found" as const, seller: sellerSummary(seller), fallbackUrl: sellerPageUrl(env, seller), next: "The seller no longer offers this through agent checkout." };
  let availability: { timezone: string | null; from: string | null; to: string | null; available: boolean; slots: LiveSlot[] } | null = null;
  if (offering.kind !== "product") {
    const query = new URLSearchParams();
    for (const key of ["from", "to"] as const) { const value = text(input[key], 40); if (value) query.set(key, value); }
    const live = await sellerRequest(env, base, `/offerings/${encodeURIComponent(offering.id)}/availability${query.size ? `?${query}` : ""}`);
    if (live.status === 403 && live.body.code === "agent_checkout_disabled") {
      return { status: "agent_checkout_off" as const, seller: sellerSummary(seller), fallbackUrl: sellerPageUrl(env, seller), next: "This seller has turned agent checkout off. Give the owner the seller's page link." };
    }
    if (live.status !== 200) throw sellerError(live, "The seller's availability could not be read.");
    const slots = parseSlots(live.body.slots);
    availability = { timezone: text(live.body.timezone, 80), from: instant(live.body.from), to: instant(live.body.to), available: slots.length > 0, slots };
  }
  // Older sellers take one offering per checkout and say nothing here.
  const capability = record(listed.body.checkout);
  const maxLines = Number.isSafeInteger(capability.maxLines) && (capability.maxLines as number) > 1 ? Math.min(capability.maxLines as number, MAX_LINES) : 1;
  const lineKinds = (Array.isArray(capability.lineKinds) ? capability.lineKinds : []).filter((kind): kind is string => typeof kind === "string");
  return {
    status: offering.free ? "free" as const : "ready" as const,
    seller: sellerSummary(seller),
    offering: { ...offering, price: money(offering.amount, offering.currency) },
    availability,
    oneCheckout: { maxItems: maxLines, kinds: maxLines > 1 ? lineKinds : [] },
    next: offering.free
      ? "This offering is free, so there is nothing to approve. Give the owner the seller's page link to book it."
      : `Prices and times come from the seller. To buy, call core_payments_propose_network with the exact offering and slot start; the owner always approves first.${maxLines > 1 ? ` When the owner wants several things from this seller, send them together in items so there is one approval and one payment (up to ${maxLines}; ${lineKinds.join(" and ")} offerings only).` : ""}`,
  };
}

async function ownerContact(env: Env, ownerId: string) {
  const owner = await env.DB.prepare("SELECT name, email, timezone FROM owner_profile WHERE id = ?").bind(ownerId).first<{ name: string | null; email: string | null; timezone: string | null }>();
  return { name: text(owner?.name, 120), email: text(owner?.email, 254), timezone: text(owner?.timezone, 80) };
}

type RequestedLine = { offeringId: string | null; slotStart: unknown; quantity: unknown };

/** The lines a proposal asks for: `items` for several offerings from one seller, else the single offering. */
function requestedLines(input: { offeringId?: unknown; slotStart?: unknown; quantity?: unknown; items?: unknown }): RequestedLine[] {
  if (input.items === undefined || input.items === null) return [{ offeringId: text(input.offeringId, 200), slotStart: input.slotStart, quantity: input.quantity }];
  if (input.offeringId !== undefined && input.offeringId !== null) throw new PaymentError("Send offeringId or items, not both.");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_LINES) throw new PaymentError(`Items must list 1 to ${MAX_LINES} offerings from this seller.`);
  const lines = input.items.map(item => { const raw = record(item); return { offeringId: text(raw.offeringId, 200), slotStart: raw.slotStart, quantity: raw.quantity }; });
  if (new Set(lines.map(line => `${line.offeringId}\n${instant(line.slotStart) ?? ""}`)).size !== lines.length) throw new PaymentError("Each item must be a different offering or time.");
  return lines;
}

/** One line, re-read from the seller: the live price and, for bookings, the exact free slot. */
async function liveLine(env: Env, seller: NetworkSellerRef, requested: RequestedLine) {
  const slotStart = requested.slotStart === undefined || requested.slotStart === null || requested.slotStart === "" ? null : instant(requested.slotStart);
  if (requested.slotStart && !slotStart) throw new PaymentError("Slot start must be an exact time from the seller's availability.");
  const live = await checkNetworkOffering(env, seller, { offeringId: requested.offeringId, ...(slotStart ? { from: slotStart, to: new Date(Date.parse(slotStart) + 60_000).toISOString() } : {}) });
  if (live.status === "agent_checkout_off") throw new PaymentError(`${seller.name} has turned agent checkout off.${live.fallbackUrl ? ` The owner can book on ${live.fallbackUrl}.` : ""}`, 409);
  if (live.status === "not_found") throw new PaymentError("The seller no longer offers this through agent checkout.", 404);
  if (live.status === "free") throw new PaymentError(`${live.offering.title} is free. Give the owner the seller's page link instead of a payment.`, 409);
  const offering = live.offering;
  const quantity = requested.quantity === undefined || requested.quantity === null ? 1 : requested.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > offering.maxQuantity) throw new PaymentError(`Quantity must be a whole number from 1 to ${offering.maxQuantity}.`);
  let slot: { start: string; end: string | null } | null = null;
  if (offering.requiresSlot) {
    if (!slotStart) throw new PaymentError("Choose one of the seller's available times first.");
    const match = live.availability?.slots.find(candidate => candidate.start === slotStart);
    if (!match) throw new PaymentError("That time is not available at the seller any more. Check availability again.", 409);
    slot = { start: match.start, end: match.end };
  } else if (slotStart) {
    throw new PaymentError("This offering does not take a time.");
  } else if (offering.schedule?.startsAt) {
    slot = { start: offering.schedule.startsAt, end: offering.schedule.endsAt ?? null };
  }
  return { offering, quantity, slot, timezone: live.availability?.timezone ?? offering.timezone, oneCheckout: live.oneCheckout };
}

/**
 * Re-reads the seller live and saves an immutable in_network proposal for the exact
 * offerings, slots and price: one approval and one payment, also for several offerings
 * from the same seller. The model never supplies the price or the seller address.
 */
export async function proposeNetworkPurchase(env: Env, ownerId: string, scope: PaymentScope, input: { seller: NetworkSellerRef | null; offeringId?: unknown; slotStart?: unknown; quantity?: unknown; items?: unknown; purpose: unknown }) {
  const requested = requestedLines(input);
  const existing = await env.DB.prepare("SELECT * FROM agent_payment_proposals WHERE owner_id=? AND idempotency_key=?").bind(ownerId, scope.idempotencyKey).first<ProposalRow>();
  if (existing) {
    // A resumed approval returns the reviewed proposal; it must not re-price it.
    const network = existing.method === "in_network" ? await loadNetworkPurchase(env, ownerId, existing.id) : null;
    const saved = network ? networkLines(network) : [];
    if (!network || saved.length !== requested.length || saved.some((line, index) => line.offeringId !== requested[index].offeringId || (line.slotStart ?? null) !== (instant(requested[index].slotStart) ?? line.slotStart ?? null))) {
      throw new PaymentError("This payment proposal changed after it was saved. Propose it again for a fresh review.", 409);
    }
    return paymentView(env, ownerId, existing);
  }
  if (!input.seller) throw new PaymentError("Search the network for this seller first.");
  const seller = input.seller;
  const live: Array<Awaited<ReturnType<typeof liveLine>>> = [];
  for (const line of requested) live.push(await liveLine(env, seller, line));
  if (live.length > 1) {
    // One checkout only when the seller takes these together; otherwise each is proposed on its own.
    const { maxItems, kinds } = live[0].oneCheckout;
    if (maxItems < live.length) throw new PaymentError(maxItems > 1 ? `${seller.name} takes up to ${maxItems} items in one checkout. Propose the rest separately.` : `${seller.name} takes one item per checkout. Propose each item on its own.`, 409);
    const alone = live.find(line => !kinds.includes(line.offering.kind));
    if (alone) throw new PaymentError(`${alone.offering.title} is booked on its own at ${seller.name}. Propose it separately from the other items.`, 409);
    if (live.some(line => line.offering.currency !== live[0].offering.currency)) throw new PaymentError("Items in one checkout must be in the same currency. Propose the others separately.", 409);
  }
  const buyer = await ownerContact(env, ownerId);
  if (!buyer.name || !buyer.email) throw new PaymentError("Add your name and email in Settings first: the seller needs them for the booking or order.", 409);
  const merchantUrl = sellerPageUrl(env, live.length > 1 ? { ...seller, offeringUrl: null } : seller);
  if (!merchantUrl) throw new PaymentError("The seller has no public page link to show on the approval.", 409);
  const lines: NetworkLineDetails[] = live.map(line => ({ offeringId: line.offering.id, offeringKind: line.offering.kind, offeringTitle: line.offering.title, slotStart: line.slot?.start ?? null,
    slotEnd: line.slot?.end ?? null, slotRequired: line.offering.requiresSlot, timezone: line.timezone, quantity: line.quantity, unitAmountMinor: line.offering.amount }));
  const first = lines[0];
  const currency = live[0].offering.currency;
  const total = lines.reduce((sum, line) => sum + line.unitAmountMinor! * line.quantity, 0);
  const policies = live.filter(line => line.offering.refundPolicy).map(line => live.length > 1 ? `${line.offering.title}: ${line.offering.refundPolicy}` : line.offering.refundPolicy!);
  const network: NetworkProposalDetails = {
    sellerProfileId: seller.profileId, sellerHandle: seller.handle, apiBase: sellerApiBase(seller.specUrl, env), offeringId: first.offeringId, offeringKind: first.offeringKind,
    offeringTitle: first.offeringTitle, slotStart: first.slotStart, slotEnd: first.slotEnd, slotRequired: first.slotRequired, timezone: first.timezone, quantity: first.quantity, unitAmountMinor: first.unitAmountMinor!,
    buyerName: buyer.name, buyerEmail: buyer.email,
    // Only a checkout with several lines binds them, so a single offering hashes as before.
    ...(lines.length > 1 ? { lines } : {}),
  };
  const proposal = await proposePayment(env, ownerId, scope, {
    merchantName: seller.name, merchantUrl, purpose: input.purpose,
    items: lines.map(line => ({ name: line.offeringTitle, quantity: line.quantity, ...(line.slotStart ? { options: slotLabel(line.slotStart, line.timezone) } : {}) })),
    amount: formatMinorUnits(total, currency), currency, refundPolicy: policies.length ? policies.join(" ").slice(0, 500) : null,
  }, network);
  await env.DB.prepare(`INSERT OR IGNORE INTO agent_network_purchases(proposal_id,owner_id,seller_name,seller_profile_id,seller_handle,api_base,offering_id,offering_kind,offering_title,
    slot_start,slot_end,timezone,slot_required,quantity,buyer_name,buyer_email,checkout_idempotency_key,lines_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(proposal.id, ownerId, seller.name, seller.profileId, seller.handle, network.apiBase, first.offeringId, first.offeringKind, first.offeringTitle, first.slotStart, first.slotEnd,
      first.timezone, first.slotRequired ? 1 : 0, first.quantity, buyer.name, buyer.email, `me3-network-${proposal.id}`, lines.length > 1 ? JSON.stringify(lines) : null).run();
  return paymentView(env, ownerId, (await loadProposal(env, ownerId, proposal.id))!);
}

export type NetworkHandOverOutcome = "checkout_ready" | "price_changed" | "unavailable" | "agent_checkout_off" | "expired" | "paid" | "cancelled";

async function closeProposal(env: Env, ownerId: string, row: ProposalRow, checkoutStatus: string, event: string, data: Record<string, unknown> = {}, live?: { amount: number; currency: string }) {
  await env.DB.prepare(`UPDATE agent_network_purchases SET checkout_status=?,live_amount_minor=COALESCE(?,live_amount_minor),live_currency=COALESCE(?,live_currency),next_check_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE owner_id=? AND proposal_id=?`).bind(checkoutStatus, live?.amount ?? null, live?.currency ?? null, ownerId, row.id).run();
  // Nothing was bought, so the approved amount stops counting against the owner's limits.
  const closed = await env.DB.prepare("UPDATE agent_payment_proposals SET status='not_paid',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status IN ('proposed','handed_over')")
    .bind(ownerId, row.id).run();
  if (closed.meta?.changes) await appendEvent(env, ownerId, row.id, event, data);
}

function outcomeFor(network: NetworkPurchaseRow): NetworkHandOverOutcome {
  switch (network.checkout_status) {
    case "pending": return "checkout_ready";
    case "not_started": return "checkout_ready";
    default: return network.checkout_status as NetworkHandOverOutcome;
  }
}

async function handOverResult(env: Env, ownerId: string, proposalId: string) {
  const row = (await loadProposal(env, ownerId, proposalId))!;
  const view = await paymentView(env, ownerId, row);
  const network = view.network!;
  const outcome = outcomeFor((await loadNetworkPurchase(env, ownerId, proposalId))!);
  const total = `${view.amount} ${view.currency}`;
  const handOver = outcome === "checkout_ready" && network.payUrl ? {
    openUrl: network.payUrl, expiresAt: network.expiresAt,
    instructions: `Open the secure checkout on your own device and pay ${total} to ${view.merchant.name}${network.lines.length > 1 ? ` for all ${network.lines.length} items in one payment` : ""}. ${network.lines.length > 1 ? "They are" : network.slot ? "The time is" : "The item is"} held for you for 15 minutes. ME3 does not charge you.`,
  } : null;
  const next: Record<NetworkHandOverOutcome, string> = {
    checkout_ready: "Chat already shows a Pay card with the checkout button and the hold time, so do not paste the openUrl or repeat the shared name and email. In one or two sentences say it is ready to pay in the card. Do not say it is paid: the owner pays on their own device. ME3 records the receipt from the seller automatically.",
    price_changed: `The seller's price changed${network.livePrice ? ` to ${network.livePrice.amount} ${network.livePrice.currency}` : ""}, so nothing was bought. Tell the owner, and only if they still want it, propose again for a fresh approval.`,
    unavailable: "That time or item is no longer available, so nothing was bought. Tell the owner and offer to check availability again.",
    agent_checkout_off: `${view.merchant.name} has turned agent checkout off, so nothing was bought. Give the owner the seller's page to book there: ${view.merchant.url}`,
    expired: "The 15-minute hold expired before payment, so nothing was bought. Tell the owner; do not start a new checkout unless they ask.",
    paid: "This purchase is already paid and the receipt is saved.",
    cancelled: "The seller cancelled or refunded this purchase.",
  };
  return { outcome, proposal: view, handOver, ...(outcome !== "checkout_ready" && outcome !== "paid" ? { fallbackUrl: view.merchant.url } : {}), next: next[outcome] };
}

/**
 * After approval, creates the seller checkout exactly once (a stable idempotency key
 * and the stored checkout make retries return the same one) and hands the owner payUrl.
 */
export async function handOverNetworkPurchase(env: Env, ownerId: string, proposalId: string, expectedHash: string) {
  const proposal = await loadProposal(env, ownerId, proposalId);
  if (!proposal || proposal.proposal_hash !== expectedHash || proposal.method !== "in_network") throw new PaymentError("The payment proposal no longer matches what was reviewed.", 409);
  if (proposal.status === "declined") throw new PaymentError("The owner declined this payment.", 409);
  if (!proposal.approval_auth) throw new PaymentError("This payment has not been approved with a fresh sign-in.", 403);
  const network = await loadNetworkPurchase(env, ownerId, proposalId);
  if (!network) throw new PaymentError("The network purchase details are missing.", 409);
  if (proposal.status !== "proposed") return handOverResult(env, ownerId, proposalId);

  if (!network.checkout_id) {
    // Limits are checked again before anything is held at the seller.
    await assertWithinLimits(env, ownerId, proposal.amount_minor, proposal.currency);
    const lines = networkLines(network).map(line => ({ offeringId: line.offeringId, ...(line.slotRequired && line.slotStart ? { slot: { start: line.slotStart } } : {}), quantity: line.quantity }));
    const notifyUrl = await networkPurchaseNotifyUrl(env, ownerId, proposalId);
    const response = await sellerRequest(env, network.api_base, "/checkouts", { method: "POST", body: {
      // Several offerings go as lines: one checkout, one payment. A single one keeps the original shape.
      ...(lines.length > 1 ? { lines } : lines[0]), buyer: { name: network.buyer_name, email: network.buyer_email },
      expectedAmount: proposal.amount_minor, expectedCurrency: proposal.currency, idempotencyKey: network.checkout_idempotency_key,
      // Where the seller says "this settled". It proves nothing; ME3 then reads the checkout with its secret.
      ...(notifyUrl ? { notify: { url: notifyUrl } } : {}),
    } });
    const code = text(response.body.code, 80);
    if (response.status === 409 && code === "price_changed") {
      const amount = Number.isSafeInteger(response.body.amount) ? response.body.amount as number : null, currency = text(response.body.currency, 3);
      await closeProposal(env, ownerId, proposal, "price_changed", "price_changed", { amountMinor: amount, currency }, amount !== null && currency ? { amount, currency } : undefined);
      return handOverResult(env, ownerId, proposalId);
    }
    if (response.status === 403 && code === "agent_checkout_disabled") {
      await closeProposal(env, ownerId, proposal, "agent_checkout_off", "agent_checkout_off");
      return handOverResult(env, ownerId, proposalId);
    }
    if ((response.status === 400 && /slot|quantity|line/.test(code ?? "")) || response.status === 404 || (response.status === 409 && code === "checkout_refused")) {
      await closeProposal(env, ownerId, proposal, "unavailable", "unavailable", { code });
      return handOverResult(env, ownerId, proposalId);
    }
    if (response.status !== 200 && response.status !== 201) throw sellerError(response, "The seller could not start the checkout. Nothing was bought; try again.");
    const checkout = response.body;
    const checkoutId = text(checkout.checkoutId, 100), payUrl = text(checkout.payUrl, 2000), secret = text(checkout.statusSecret, 200), expiresAt = instant(checkout.expiresAt);
    if (!checkoutId || !secret || !expiresAt || !payUrl || !payUrl.startsWith(`${network.api_base}/checkouts/`)) throw new PaymentError("The seller returned an invalid checkout.", 502);
    publicHttpsUrl(payUrl, "Seller payment link", env);
    if (checkout.amount !== proposal.amount_minor || text(checkout.currency, 3) !== proposal.currency) {
      // The seller guards the price; a different total here is still never handed over.
      await closeProposal(env, ownerId, proposal, "price_changed", "price_changed", { amountMinor: checkout.amount }, Number.isSafeInteger(checkout.amount) ? { amount: checkout.amount as number, currency: text(checkout.currency, 3) || proposal.currency } : undefined);
      return handOverResult(env, ownerId, proposalId);
    }
    await env.DB.prepare(`UPDATE agent_network_purchases SET checkout_id=?,pay_url=?,encrypted_status_secret=?,checkout_status='pending',expires_at=?,next_check_at=?,updated_at=CURRENT_TIMESTAMP
      WHERE owner_id=? AND proposal_id=? AND checkout_id IS NULL`).bind(checkoutId, payUrl, await encryptStatusSecret(env, secret), expiresAt, new Date(Date.now() + 60_000).toISOString(), ownerId, proposalId).run();
  }
  const current = (await loadNetworkPurchase(env, ownerId, proposalId))!;
  const result = await env.DB.prepare("UPDATE agent_payment_proposals SET status='handed_over',handed_over_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=? AND status='proposed' AND proposal_hash=?")
    .bind(ownerId, proposalId, expectedHash).run();
  if (result.meta?.changes) await appendEvent(env, ownerId, proposalId, "handed_over", { network: true, checkoutId: current.checkout_id, expiresAt: current.expires_at });
  return handOverResult(env, ownerId, proposalId);
}

function nextCheckAt(createdAt: string, now = Date.now()): string | null {
  const age = now - Date.parse(/[zZ]$/.test(createdAt) ? createdAt : `${createdAt.replace(" ", "T")}Z`);
  const step = POLL_SCHEDULE.find(entry => age < entry.untilMs);
  return step ? new Date(now + step.everyMs).toISOString() : null;
}

/**
 * Reads the seller checkout with its status secret and records what happened: a
 * seller receipt (flagging a different amount) and a calendar entry when paid, a
 * closed proposal when the hold expired. Safe to repeat.
 */
export async function refreshNetworkPurchase(env: Env, ownerId: string, proposalId: string): Promise<PaymentProposalView> {
  const proposal = await loadProposal(env, ownerId, proposalId);
  const network = proposal ? await loadNetworkPurchase(env, ownerId, proposalId) : null;
  if (!proposal || !network) throw new PaymentError("Network purchase not found.", 404);
  if (network.checkout_status !== "pending" || !network.checkout_id || !network.encrypted_status_secret) return paymentView(env, ownerId, proposal);
  let response: SellerResponse;
  try {
    response = await sellerRequest(env, network.api_base, `/checkouts/${encodeURIComponent(network.checkout_id)}`, { bearer: await decryptStatusSecret(env, network.encrypted_status_secret) });
  } catch (error) {
    await env.DB.prepare("UPDATE agent_network_purchases SET last_checked_at=?,next_check_at=?,check_error=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND proposal_id=?")
      .bind(new Date().toISOString(), nextCheckAt(network.created_at), error instanceof PaymentError ? error.message.slice(0, 200) : "Seller unavailable", ownerId, proposalId).run();
    return paymentView(env, ownerId, proposal);
  }
  const status = response.status === 200 ? text(response.body.status, 20) : null;
  const checkedAt = new Date().toISOString();
  if (status === "paid") await recordSellerPayment(env, proposal, network, response.body);
  else if (status === "expired") {
    await closeProposal(env, ownerId, proposal, "expired", "checkout_expired", { checkoutId: network.checkout_id });
    await postPurchaseMessage(env, proposal, network, "expired", `The hold on ${purchaseLabel(network)} with ${network.seller_name} expired before it was paid, so nothing was bought. Ask me if you'd like to try again.`);
  } else if (status === "cancelled") {
    await markCancelled(env, proposal, network);
  } else {
    await env.DB.prepare("UPDATE agent_network_purchases SET last_checked_at=?,next_check_at=?,check_error=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND proposal_id=?")
      .bind(checkedAt, nextCheckAt(network.created_at), status === "pending" ? null : `Seller status check returned HTTP ${response.status}`, ownerId, proposalId).run();
  }
  if (status) await env.DB.prepare("UPDATE agent_network_purchases SET last_checked_at=?,check_error=NULL WHERE owner_id=? AND proposal_id=?").bind(checkedAt, ownerId, proposalId).run();
  return paymentView(env, ownerId, (await loadProposal(env, ownerId, proposalId))!);
}

async function recordSellerPayment(env: Env, proposal: ProposalRow, network: NetworkPurchaseRow, checkout: Record<string, unknown>) {
  const ownerId = proposal.owner_id;
  const paidAmount = Number.isSafeInteger(checkout.paidAmount) ? checkout.paidAmount as number : null;
  const paidCurrency = text(checkout.paidCurrency, 3)?.toUpperCase() || proposal.currency;
  const reference = record(checkout.reference);
  const referenceId = text(reference.id, 200), referenceType = reference.type === "booking" || reference.type === "order" ? reference.type : null;
  const slot = record(checkout.slot);
  if (paidAmount !== null && paidAmount > 0) {
    await recordPaymentReceipt(env, ownerId, { proposalId: proposal.id, amount: formatMinorUnits(paidAmount, paidCurrency), currency: paidCurrency, orderReference: referenceId, paidAt: instant(checkout.paidAt) }, "seller")
      .catch(error => { if (!(error instanceof PaymentError)) throw error; });
  }
  const lines = networkLines(network);
  const several = lines.length > 1;
  const sellerLines = Array.isArray(checkout.lines) ? checkout.lines.map(record) : [];
  let calendarEventId: string | null = null;
  if (several) {
    // Each booked line gets its own calendar entry, at the time the seller confirmed.
    for (const [index, line] of lines.entries()) {
      const confirmed = record(sellerLines[index]?.slot);
      const id = await addBookingToCalendar(env, proposal, network, line, calendarEventId ? `network-purchase-${proposal.id}-${index}` : `network-purchase-${proposal.id}`,
        instant(confirmed.start) ?? line.slotStart, instant(confirmed.end) ?? line.slotEnd, line.unitAmountMinor === null ? null : line.unitAmountMinor * line.quantity, paidCurrency);
      calendarEventId ??= id;
    }
  } else {
    calendarEventId = await addBookingToCalendar(env, proposal, network, lines[0], `network-purchase-${proposal.id}`, instant(slot.start) ?? network.slot_start, instant(slot.end) ?? network.slot_end, paidAmount, paidCurrency);
  }
  const updated = await env.DB.prepare(`UPDATE agent_network_purchases SET checkout_status='paid',reference_type=?,reference_id=?,calendar_event_id=COALESCE(?,calendar_event_id),next_check_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE owner_id=? AND proposal_id=? AND checkout_status='pending'`).bind(referenceType, referenceId, calendarEventId, ownerId, proposal.id).run();
  if (!updated.meta?.changes) return;
  const mismatch = paidAmount !== proposal.amount_minor || paidCurrency !== proposal.currency;
  await appendEvent(env, ownerId, proposal.id, "network_paid", { checkoutId: network.checkout_id, paidAmountMinor: paidAmount, currency: paidCurrency, mismatch, calendarEventId });
  const owner = await ownerContact(env, ownerId);
  const paid = paidAmount !== null ? formatMoney(paidAmount, paidCurrency) : "payment";
  const when = network.slot_start ? ` on ${ownerTime(network.slot_start, owner.timezone || network.timezone)}` : "";
  const booked = lines.filter(line => line.offeringKind !== "product" && line.slotStart).length;
  const message = several
    ? `Paid ${network.seller_name} ${paid}: ${joinList(lines.map(line => line.offeringKind !== "product" && line.slotStart ? `${line.offeringTitle} on ${ownerTime(line.slotStart, owner.timezone || line.timezone)}` : line.offeringTitle))}.${calendarEventId ? ` The booking${booked > 1 ? "s are" : " is"} in your calendar.` : ""}`
    : network.offering_kind === "product"
    ? `Bought: ${network.offering_title} from ${network.seller_name}, ${paid} paid.`
    : `Booked: ${network.offering_title} with ${network.seller_name}${when}. ${paidAmount !== null ? `${paid} paid.` : "Paid."}${calendarEventId ? " It's in your calendar." : ""}`;
  await postPurchaseMessage(env, proposal, network, "paid", mismatch ? `${message} The seller recorded ${paid}, but you approved ${formatMoney(proposal.amount_minor, proposal.currency)}.` : message);
}

async function markCancelled(env: Env, proposal: ProposalRow, network: NetworkPurchaseRow) {
  await env.DB.prepare("UPDATE agent_network_purchases SET checkout_status='cancelled',next_check_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND proposal_id=?").bind(proposal.owner_id, proposal.id).run();
  if (network.calendar_event_id) await env.DB.prepare("DELETE FROM user_calendar_events WHERE user_id=? AND (id=? OR substr(id,1,?)=?)")
    .bind(proposal.owner_id, network.calendar_event_id, network.calendar_event_id.length + 1, `${network.calendar_event_id}-`).run();
  await appendEvent(env, proposal.owner_id, proposal.id, "network_cancelled", { checkoutId: network.checkout_id });
  await postPurchaseMessage(env, proposal, network, "cancelled", `${network.seller_name} cancelled ${purchaseLabel(network)}. Check with them about any refund.`);
}

function joinList(parts: string[]): string {
  return parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(" and ");
}

/** "Coaching session and Clarity Kit": everything one network purchase covers. */
function purchaseLabel(network: NetworkPurchaseRow): string {
  return joinList(networkLines(network).map(line => line.offeringTitle));
}

async function addBookingToCalendar(env: Env, proposal: ProposalRow, network: NetworkPurchaseRow, line: NetworkLineDetails, id: string, start: string | null, end: string | null, paidAmount: number | null, currency: string): Promise<string | null> {
  if (line.offeringKind === "product" || !start) return null;
  const owner = await ownerContact(env, proposal.owner_id);
  const endsAt = end && Date.parse(end) > Date.parse(start) ? end : new Date(Date.parse(start) + 60 * 60_000).toISOString();
  const paid = paidAmount !== null ? ` Paid ${formatMoney(paidAmount, currency)}.` : "";
  await env.DB.prepare(`INSERT OR IGNORE INTO user_calendar_events(id,user_id,title,notes,location,starts_at,ends_at,timezone,all_day,kind,recurrence_rule) VALUES(?,?,?,?,NULL,?,?,?,0,'event',NULL)`)
    .bind(id, proposal.owner_id, `${line.offeringTitle} with ${network.seller_name}`.slice(0, 300), `Booked through ME3 on ${network.seller_name}'s site.${paid}`, start, endsAt, owner.timezone || line.timezone || "UTC").run();
  return id;
}

/** Posts the outcome into the conversation that proposed it and uses the background notification path. */
async function postPurchaseMessage(env: Env, proposal: ProposalRow, network: NetworkPurchaseRow, status: string, replyText: string) {
  const resultId = `network-purchase:${proposal.id}`;
  const messageId = `${resultId}:assistant:${status}:final`;
  const payload = { ok: true, runtime: "agent", turnId: resultId, threadId: proposal.thread_id, status: "complete", replyText, networkPurchase: { paymentId: proposal.id, status, seller: network.seller_name } };
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json)
      SELECT ?,?,?,'assistant',?,? WHERE EXISTS(SELECT 1 FROM assistant_threads WHERE id=? AND owner_id=?)`).bind(messageId, proposal.owner_id, proposal.thread_id, replyText, JSON.stringify(payload), proposal.thread_id, proposal.owner_id),
    env.DB.prepare("UPDATE assistant_threads SET updated_at=CURRENT_TIMESTAMP,last_message_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(proposal.thread_id, proposal.owner_id),
  ]);
  await notifyAgentBackgroundResult(env, proposal.owner_id, { resultId, threadId: proposal.thread_id, kind: "complete" });
}

function formatMoney(minor: number, currency: string): string {
  try { return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(Number(formatMinorUnits(minor, currency))); }
  catch { return `${formatMinorUnits(minor, currency)} ${currency}`; }
}

/** "Monday 30 November at 08:00" in the owner's timezone. */
function ownerTime(start: string, timezone: string | null): string {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "UTC", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(start)).map(part => [part.type, part.value]));
    return `${parts.weekday} ${parts.day} ${parts.month} at ${parts.hour}:${parts.minute}`;
  } catch { return start; }
}

/** Scheduled sweep: checks due pending network checkouts. */
export async function pollNetworkPurchases(env: Env, limit = 20): Promise<void> {
  const due = await env.DB.prepare(`SELECT owner_id, proposal_id FROM agent_network_purchases WHERE checkout_status='pending' AND next_check_at IS NOT NULL AND next_check_at<=?
    ORDER BY next_check_at LIMIT ?`).bind(new Date().toISOString(), limit).all<{ owner_id: string; proposal_id: string }>();
  for (const row of due.results ?? []) {
    // Only the payment ID is logged; seller responses and secrets never are.
    await refreshNetworkPurchase(env, row.owner_id, row.proposal_id).catch(error => console.error("Network purchase check failed", row.proposal_id, error instanceof PaymentError ? error.message : "Unknown error"));
  }
}

// ---------------------------------------------------------------------------
// The seller's notice that a checkout settled (me3-s3wi). The seller is given an
// address with an unguessable token and POSTs to it. The notice is only a prompt:
// ME3 then reads the checkout from the seller with its status secret, so a forged
// or replayed notice cannot record a payment.

async function notifyToken(env: Env, ownerId: string, proposalId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await getOrCreateInstallEncryptionKey(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`me3:network-purchase-notify:v1:${ownerId}:${proposalId}`))));
}

/** This installation's public address for one purchase's notice, or null when it has none a seller can reach. */
async function networkPurchaseNotifyUrl(env: Env, ownerId: string, proposalId: string): Promise<string | null> {
  try {
    const origin = publicHttpsUrl(env.CORE_API_ORIGIN, "Installation address", env).origin;
    return `${origin}/api/network-purchases/${encodeURIComponent(proposalId)}/notify/${await notifyToken(env, ownerId, proposalId)}`;
  } catch { return null; }
}

/** Handles a seller's notice. False when the purchase or token is unknown; the two look the same. */
export async function receiveNetworkPurchaseNotice(env: Env, proposalId: string, token: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT owner_id FROM agent_network_purchases WHERE proposal_id=?").bind(proposalId).first<{ owner_id: string }>();
  const expected = await notifyToken(env, row?.owner_id ?? "", proposalId);
  let difference = expected.length ^ token.length;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ (token.charCodeAt(index) || 0);
  if (!row || difference !== 0) return false;
  await refreshNetworkPurchase(env, row.owner_id, proposalId).catch(error => console.error("Network purchase notice check failed", proposalId, error instanceof PaymentError ? error.message : "Unknown error"));
  return true;
}

// Status secrets are encrypted with the installation key, like other stored credentials.
async function statusSecretKey(env: Env, usages: KeyUsage[]): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await getOrCreateInstallEncryptionKey(env)));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));

async function encryptStatusSecret(env: Env, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await statusSecretKey(env, ["encrypt"]), new TextEncoder().encode(secret));
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptStatusSecret(env: Env, encrypted: string): Promise<string> {
  const [version, iv, ciphertext] = encrypted.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new PaymentError("The stored checkout secret is invalid.", 500);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) }, await statusSecretKey(env, ["decrypt"]), fromBase64Url(ciphertext)));
}

/** Agent-facing network purchase services; merged into the payment services. */
export function createAgentNetworkPaymentServices(env: Env, ownerId: string): Pick<AgentPaymentServices, "networkCheck" | "proposeNetwork" | "handOverNetwork" | "refreshNetwork"> {
  const asRecord = (view: PaymentProposalView) => view as unknown as PaymentProposalRecord;
  return {
    networkCheck: (seller, input) => checkNetworkOffering(env, seller, input),
    proposeNetwork: async (input, scope) => asRecord(await proposeNetworkPurchase(env, ownerId, scope, input)),
    handOverNetwork: async (proposalId, proposalHash) => { const result = await handOverNetworkPurchase(env, ownerId, proposalId, proposalHash); return { ...result, proposal: asRecord(result.proposal) }; },
    refreshNetwork: async proposalId => asRecord(await refreshNetworkPurchase(env, ownerId, proposalId)),
  };
}

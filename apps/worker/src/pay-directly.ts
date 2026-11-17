import {
  buildPaymentOptions,
  methodsCoverCurrency,
  payDirectlyDecideAtMs,
  payDirectlyTimeline,
  payDirectlyWarningLeadMs,
  type PayDirectlyHoldSettings,
  parsePaymentMethodInput,
  paymentOptionsText,
  randomPaymentReference,
  type PaymentMethodKind,
  type SavedPaymentMethod,
} from "../../../shared/pay-directly";
import { bookingDetailsFromBooking, sendBookingAwaitingPaymentEmails } from "./transactional-emails";
import { getPayDirectlyHoldSettings } from "./commerce-settings";
import { getPublishedSiteBaseUrl } from "./sites";
import type { DbBooking, DbSite, Env } from "./types";

// Mirrors migrations/0108_pay_directly.sql.
export const PAY_DIRECTLY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS commerce_payment_methods (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('paypal', 'revolut', 'wise', 'bank')),
    link TEXT,
    account_name TEXT,
    iban TEXT,
    bic TEXT,
    sort_code TEXT,
    account_number TEXT,
    currency TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_commerce_payment_methods_owner
    ON commerce_payment_methods(user_id, sort_order, created_at)`,
  `CREATE TABLE IF NOT EXISTS commerce_direct_payments (
    reference TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    order_id TEXT UNIQUE,
    booking_id TEXT UNIQUE,
    method_id TEXT,
    method_kind TEXT,
    says_paid_at TEXT,
    reminded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((order_id IS NULL) <> (booking_id IS NULL)),
    FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_commerce_direct_payments_owner
    ON commerce_direct_payments(user_id, created_at)`,
] as const;

// Mirrors migrations/0109_pay_page.sql.
export const PAY_PAGE_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_direct_payments_pay_token
  ON commerce_direct_payments(pay_token)`;
export const PAY_PAGE_SCHEMA = [
  "ALTER TABLE commerce_direct_payments ADD COLUMN pay_token TEXT",
  "ALTER TABLE commerce_direct_payments ADD COLUMN note TEXT",
  PAY_PAGE_INDEX,
] as const;

// Mirrors migrations/0110_pay_directly_holds.sql.
export const PAY_DIRECTLY_HOLDS_SCHEMA = [
  "ALTER TABLE commerce_settings ADD COLUMN pay_directly_remind_days INTEGER NOT NULL DEFAULT 2",
  "ALTER TABLE commerce_settings ADD COLUMN pay_directly_release_days INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE commerce_direct_payments ADD COLUMN hold_started_at TEXT",
  "ALTER TABLE commerce_direct_payments ADD COLUMN owner_warned_at TEXT",
  "ALTER TABLE commerce_direct_payments ADD COLUMN owner_nudged_at TEXT",
  "ALTER TABLE commerce_direct_payments ADD COLUMN released_at TEXT",
] as const;

// Mirrors migrations/0111_pay_directly_email_matches.sql.
export const PAY_DIRECTLY_MATCH_SCHEMA = [
  "ALTER TABLE commerce_direct_payments ADD COLUMN matched_email_id TEXT",
  "ALTER TABLE commerce_direct_payments ADD COLUMN matched_email_json TEXT",
  "ALTER TABLE commerce_direct_payments ADD COLUMN match_dismissed_at TEXT",
] as const;

/**
 * Once an order is paid, the email that suggested it is used up: any other waiting order the same
 * email also fitted stops showing it as a match.
 */
export async function releaseEmailMatchFromOthers(env: Env, ownerId: string, target: DirectPaymentTarget): Promise<void> {
  const column = "orderId" in target ? "order_id" : "booking_id";
  const id = "orderId" in target ? target.orderId : target.bookingId;
  try {
    const row = await env.DB.prepare(
      `SELECT reference, matched_email_id FROM commerce_direct_payments WHERE ${column} = ? AND user_id = ?`,
    ).bind(id, ownerId).first<{ reference: string; matched_email_id: string | null }>();
    if (!row?.matched_email_id) return;
    await env.DB.prepare(
      `UPDATE commerce_direct_payments SET matched_email_id = NULL, matched_email_json = NULL
       WHERE user_id = ? AND matched_email_id = ? AND reference <> ?`,
    ).bind(ownerId, row.matched_email_id, row.reference).run();
  } catch (error) {
    console.error("Clearing a shared payment email match failed:", error);
  }
}

/** A saved way to get paid, as the owner apps read it. */
export type PaymentMethod = SavedPaymentMethod & { createdAt: string; updatedAt: string };

export class PayDirectlyInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "PayDirectlyInputError";
  }
}

type PaymentMethodRow = {
  id: string;
  kind: PaymentMethodKind;
  link: string | null;
  account_name: string | null;
  iban: string | null;
  bic: string | null;
  sort_code: string | null;
  account_number: string | null;
  currency: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

const METHOD_COLUMNS =
  "id, kind, link, account_name, iban, bic, sort_code, account_number, currency, enabled, created_at, updated_at";
const MAX_METHODS = 20;

function toMethod(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id,
    kind: row.kind,
    enabled: row.enabled === 1,
    link: row.link,
    accountName: row.account_name,
    iban: row.iban,
    bic: row.bic,
    sortCode: row.sort_code,
    accountNumber: row.account_number,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isMissingPayDirectlyTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /commerce_(payment_methods|direct_payments)/.test(message) && /no such table|does not exist/i.test(message);
}

/** The owner's saved ways to get paid, in their order. */
export async function listPaymentMethods(env: Env, ownerId: string): Promise<PaymentMethod[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT ${METHOD_COLUMNS} FROM commerce_payment_methods
       WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC`,
    )
      .bind(ownerId)
      .all<PaymentMethodRow>();
    return (rows?.results || []).map(toMethod);
  } catch (error) {
    if (isMissingPayDirectlyTable(error)) return [];
    throw error;
  }
}

async function getPaymentMethod(env: Env, ownerId: string, id: string): Promise<PaymentMethod> {
  const row = await env.DB.prepare(
    `SELECT ${METHOD_COLUMNS} FROM commerce_payment_methods WHERE user_id = ? AND id = ?`,
  )
    .bind(ownerId, id)
    .first<PaymentMethodRow>();
  if (!row) throw new PayDirectlyInputError("That way to get paid was not found.", 404);
  return toMethod(row);
}

function asBody(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function parseEnabled(body: Record<string, unknown>, fallback: boolean): boolean {
  if (!Object.prototype.hasOwnProperty.call(body, "enabled")) return fallback;
  if (typeof body.enabled !== "boolean") throw new PayDirectlyInputError("Switch this way to get paid on or off.");
  return body.enabled;
}

export async function createPaymentMethod(env: Env, ownerId: string, input: unknown): Promise<PaymentMethod> {
  const body = asBody(input);
  const parsed = parsePaymentMethodInput(body.kind, body);
  if (!parsed.ok) throw new PayDirectlyInputError(parsed.error);
  const enabled = parseEnabled(body, true);
  const existing = await env.DB.prepare(
    "SELECT COUNT(*) AS count, COALESCE(MAX(sort_order), -1) AS last FROM commerce_payment_methods WHERE user_id = ?",
  )
    .bind(ownerId)
    .first<{ count: number; last: number }>();
  if ((existing?.count || 0) >= MAX_METHODS) {
    throw new PayDirectlyInputError("Remove a way to get paid before adding another.", 409);
  }
  const id = crypto.randomUUID();
  const value = parsed.value;
  await env.DB.prepare(
    `INSERT INTO commerce_payment_methods
     (id, user_id, kind, link, account_name, iban, bic, sort_code, account_number, currency, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, ownerId, value.kind, value.link, value.accountName, value.iban, value.bic,
      value.sortCode, value.accountNumber, value.currency, enabled ? 1 : 0, (existing?.last ?? -1) + 1,
    )
    .run();
  return getPaymentMethod(env, ownerId, id);
}

/** Edits the details, or switches the method on or off. The kind cannot change. */
export async function updatePaymentMethod(env: Env, ownerId: string, id: string, input: unknown): Promise<PaymentMethod> {
  const body = asBody(input);
  const current = await getPaymentMethod(env, ownerId, id);
  if (Object.prototype.hasOwnProperty.call(body, "kind") && body.kind !== current.kind) {
    throw new PayDirectlyInputError("Remove this one and add a new way to get paid instead.");
  }
  const enabled = parseEnabled(body, current.enabled);
  const merged: Record<string, unknown> = {
    link: current.link,
    accountName: current.accountName,
    iban: current.iban,
    bic: current.bic,
    sortCode: current.sortCode,
    accountNumber: current.accountNumber,
    currency: current.currency,
  };
  for (const key of Object.keys(merged)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) merged[key] = body[key];
  }
  const parsed = parsePaymentMethodInput(current.kind, merged);
  if (!parsed.ok) throw new PayDirectlyInputError(parsed.error);
  const value = parsed.value;
  await env.DB.prepare(
    `UPDATE commerce_payment_methods
     SET link = ?, account_name = ?, iban = ?, bic = ?, sort_code = ?, account_number = ?,
         currency = ?, enabled = ?, updated_at = datetime('now')
     WHERE user_id = ? AND id = ?`,
  )
    .bind(
      value.link, value.accountName, value.iban, value.bic, value.sortCode, value.accountNumber,
      value.currency, enabled ? 1 : 0, ownerId, id,
    )
    .run();
  return getPaymentMethod(env, ownerId, id);
}

export async function deletePaymentMethod(env: Env, ownerId: string, id: string): Promise<void> {
  await getPaymentMethod(env, ownerId, id);
  await env.DB.prepare("DELETE FROM commerce_payment_methods WHERE user_id = ? AND id = ?").bind(ownerId, id).run();
}

/** Saves the owner's order of methods. Ids that are not theirs are ignored. */
export async function reorderPaymentMethods(env: Env, ownerId: string, input: unknown): Promise<PaymentMethod[]> {
  const ids = asBody(input).ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || ids.length > MAX_METHODS) {
    throw new PayDirectlyInputError("Send the ways to get paid in their new order.");
  }
  const known = new Set((await listPaymentMethods(env, ownerId)).map((method) => method.id));
  const ordered = [...new Set(ids as string[])].filter((id) => known.has(id));
  for (const [index, id] of ordered.entries()) {
    await env.DB.prepare("UPDATE commerce_payment_methods SET sort_order = ? WHERE user_id = ? AND id = ?")
      .bind(index, ownerId, id)
      .run();
  }
  return listPaymentMethods(env, ownerId);
}

/** A pay-directly offer can be published or ordered with a note, or a saved method that takes its currency. */
export async function manualPaymentAvailable(
  env: Env,
  ownerId: string,
  note: string | null | undefined,
  currency: string | null | undefined,
): Promise<boolean> {
  if (note?.trim()) return true;
  return methodsCoverCurrency(await listPaymentMethods(env, ownerId), currency);
}

export type DirectPaymentTarget = { orderId: string } | { bookingId: string };

const SHORT_REFERENCE_ATTEMPTS = 6;
const LONG_REFERENCE_ATTEMPTS = 6;

/**
 * The short reference for one product order or booking (ME3-XXXX), made on first use.
 * One table holds both kinds, so a reference is never shared between an order and a booking.
 */
export async function ensurePaymentReference(
  env: Env,
  ownerId: string,
  target: DirectPaymentTarget,
  random: (length: number) => string = randomPaymentReference,
): Promise<string> {
  const orderId = "orderId" in target ? target.orderId : null;
  const bookingId = "bookingId" in target ? target.bookingId : null;
  const find = async () =>
    (await env.DB.prepare(
      `SELECT reference FROM commerce_direct_payments WHERE ${orderId ? "order_id" : "booking_id"} = ?`,
    )
      .bind(orderId || bookingId)
      .first<{ reference: string }>())?.reference || null;

  const existing = await find();
  if (existing) return existing;
  for (let attempt = 0; attempt < SHORT_REFERENCE_ATTEMPTS + LONG_REFERENCE_ATTEMPTS; attempt += 1) {
    const reference = random(attempt < SHORT_REFERENCE_ATTEMPTS ? 4 : 6);
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO commerce_direct_payments (reference, user_id, order_id, booking_id)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(reference, ownerId, orderId, bookingId)
      .run();
    if (result?.meta?.changes !== 0) return reference;
    // Nothing was written: either this order already has one (a race), or the reference is taken.
    const raced = await find();
    if (raced) return raced;
  }
  throw new Error("Could not create a payment reference");
}

/** Where a buyer's pay page lives, on whichever host served the site. Bank details are only ever served from here. */
export function payPagePath(token: string): string {
  return `/api/pay/${token}`;
}

function randomPayToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The unguessable part of one order's pay page link, made on first use. */
export async function ensurePayToken(env: Env, reference: string): Promise<string> {
  await env.DB.prepare("UPDATE commerce_direct_payments SET pay_token = ? WHERE reference = ? AND pay_token IS NULL")
    .bind(randomPayToken(), reference).run();
  const row = await env.DB.prepare("SELECT pay_token FROM commerce_direct_payments WHERE reference = ?")
    .bind(reference).first<{ pay_token: string | null }>();
  if (!row?.pay_token) throw new Error("Could not create a pay page link");
  return row.pay_token;
}

/** The pay page's full address for emails, or "" when this install does not know its public address. */
export async function payPageUrl(env: Env, siteId: string | undefined, token: string): Promise<string> {
  if (!siteId) return "";
  try {
    const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(siteId).first<DbSite>();
    const base = site ? await getPublishedSiteBaseUrl(env, site) : "";
    return base ? `${new URL(base).origin}${payPagePath(token)}` : "";
  } catch (error) {
    console.error("Pay page address could not be worked out:", error);
    return "";
  }
}

/**
 * The reference, pay page link and email text for one pay-directly order or booking. The email
 * carries the link, not the payment options: bank details stay behind the order's own link.
 * With no saved method for the currency the owner's note comes first, as before saved methods
 * existed. An install that does not know its public address falls back to the options as text.
 */
export async function prepareDirectPayment(
  env: Env,
  ownerId: string,
  input: DirectPaymentTarget & {
    amountMinor: number | null;
    currency: string | null | undefined;
    note: string | null | undefined;
    /** The site the order was made on, for the pay page link in emails. */
    siteId?: string;
  },
): Promise<{ reference: string; payToken: string; payPath: string; payUrl: string; instructions: string }> {
  const reference = await ensurePaymentReference(env, ownerId, input);
  const note = input.note?.trim().slice(0, 8000) || "";
  // Without a pay page link (it could not be made) the email falls back to the options as text.
  const payToken = await ensurePayToken(env, reference)
    .then(async (token) => {
      await env.DB.prepare("UPDATE commerce_direct_payments SET note = ? WHERE reference = ?").bind(note || null, reference).run();
      return token;
    })
    .catch((error) => {
      console.error("Pay page link could not be made:", error);
      return "";
    });
  const options = buildPaymentOptions(await listPaymentMethods(env, ownerId), {
    amountMinor: input.amountMinor,
    currency: input.currency || "",
    reference,
  });
  const payUrl = payToken ? await payPageUrl(env, input.siteId, payToken) : "";
  const instructions = !payUrl
    ? [paymentOptionsText(options, reference), note]
    : options.length
      ? [`Pay here: ${payUrl}\nReference: ${reference}`, note]
      : [note, `Reference: ${reference}\nWhen you have paid, let us know here: ${payUrl}`];
  return { reference, payToken, payPath: payToken ? payPagePath(payToken) : "", payUrl, instructions: instructions.filter(Boolean).join("\n\n") };
}

/** The pay page path for a held booking, for the public booking response. Null if it cannot be made. */
export async function bookingPayPath(env: Env, ownerId: string, bookingId: string): Promise<string | null> {
  try {
    return payPagePath(await ensurePayToken(env, await ensurePaymentReference(env, ownerId, { bookingId })));
  } catch (error) {
    console.error("Pay page link could not be made for a booking:", error);
    return null;
  }
}

/** Payment details for a pay-directly booking's confirmation email: saved methods, then the owner's note. */
export async function bookingPaymentInstructions(
  env: Env,
  ownerId: string,
  booking: Pick<DbBooking, "id" | "suggested_amount" | "currency">,
  note: string | null | undefined,
): Promise<string> {
  const trimmed = (note || "").trim().slice(0, 8000);
  try {
    const payment = await prepareDirectPayment(env, ownerId, {
      bookingId: booking.id,
      amountMinor: booking.suggested_amount ?? null,
      currency: booking.currency,
      note: trimmed,
    });
    return payment.instructions;
  } catch (error) {
    // The booking is already confirmed; the guest still gets the owner's note.
    console.error("Pay-directly details could not be prepared for a booking:", error);
    return trimmed;
  }
}

/**
 * A held pay-directly booking: the guest is emailed how to pay (no join link, no calendar link)
 * and the owner is told a booking is waiting for payment.
 */
export async function sendAwaitingPaymentEmails(
  env: Env,
  input: {
    ownerId: string;
    booking: DbBooking;
    hostName: string;
    hostEmail: string | null;
    bookingTitle: string;
    timezone: string;
    note: string | null | undefined;
  },
): Promise<void> {
  const note = (input.note || "").trim().slice(0, 8000);
  let payment = { reference: "", instructions: note };
  try {
    payment = await prepareDirectPayment(env, input.ownerId, {
      bookingId: input.booking.id,
      siteId: input.booking.site_id,
      amountMinor: input.booking.suggested_amount ?? null,
      currency: input.booking.currency,
      note,
    });
  } catch (error) {
    // The time is already held; the guest still hears from the owner.
    console.error("Pay-directly details could not be prepared for a booking:", error);
  }
  const heldUntil = await getPayDirectlyHoldSettings(env, input.ownerId)
    .then((settings) => new Date(holdState(
      { created_at: input.booking.created_at, hold_started_at: null, starts_at: input.booking.starts_at, says_paid_at: null, owner_warned_at: null },
      settings,
      Date.now(),
    ).releaseAtMs).toISOString())
    .catch(() => null);
  const result = await sendBookingAwaitingPaymentEmails(env, {
    heldUntil,
    ...bookingDetailsFromBooking({
      booking: { ...input.booking, meeting_url: null, meeting_host_url: null },
      ownerId: input.ownerId,
      hostName: input.hostName,
      hostEmail: input.hostEmail,
      bookingTitle: input.bookingTitle,
      timezone: input.timezone,
    }),
    paymentInstructions: payment.instructions || `${input.hostName} will be in touch with how to pay.`,
    reference: payment.reference,
  });
  if (result.guest.status === "failed" || result.host.status === "failed") {
    console.error("Booking payment details email issue:", result);
  }
}

/** A D1 timestamp ("YYYY-MM-DD HH:MM:SS", UTC) or an ISO string, as milliseconds. */
export function sqliteTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  return Number.isFinite(ms) ? ms : null;
}

export type HoldTimes = {
  created_at: string;
  hold_started_at: string | null;
  starts_at: string | null;
  says_paid_at: string | null;
  owner_warned_at: string | null;
};

export type HoldState = {
  /** When the buyer's one reminder is due. */
  remindAtMs: number;
  /** When the owner is warned that release is coming. */
  warnOwnerAtMs: number;
  /** When it is released if still unpaid. Never before the owner has had their warning. */
  releaseAtMs: number;
  /** The buyer said they paid: nothing is released automatically. */
  paused: boolean;
  /** Paused: when the owner is asked to confirm or release. */
  decideAtMs: number | null;
};

/**
 * Where one unpaid order or booking stands. The clock starts when it was made, or when the owner
 * last kept or restored it. Release waits for the owner's warning, so an order found late (or
 * made before reminders existed) is never released without one, unless a booking is about to start.
 */
export function holdState(row: HoldTimes, settings: PayDirectlyHoldSettings, nowMs: number): HoldState {
  const createdMs = sqliteTimeMs(row.created_at) ?? nowMs;
  const heldFromMs = Math.max(createdMs, sqliteTimeMs(row.hold_started_at) ?? 0);
  const startsAtMs = sqliteTimeMs(row.starts_at);
  const timeline = payDirectlyTimeline({ heldFromMs, startsAtMs, ...settings });
  const lead = payDirectlyWarningLeadMs(timeline.releaseAtMs - heldFromMs);
  const warnedMs = sqliteTimeMs(row.owner_warned_at);
  let releaseAtMs = timeline.releaseAtMs;
  if (warnedMs !== null && warnedMs >= heldFromMs) releaseAtMs = Math.max(releaseAtMs, warnedMs + lead);
  else if (nowMs > timeline.warnOwnerAtMs) releaseAtMs = Math.max(releaseAtMs, nowMs + lead);
  if (startsAtMs !== null) releaseAtMs = Math.min(releaseAtMs, Math.max(timeline.releaseAtMs, startsAtMs - 3_600_000));
  const saysPaidMs = sqliteTimeMs(row.says_paid_at);
  return {
    remindAtMs: timeline.remindAtMs,
    warnOwnerAtMs: timeline.warnOwnerAtMs,
    releaseAtMs,
    paused: saysPaidMs !== null,
    decideAtMs: saysPaidMs === null ? null : payDirectlyDecideAtMs({ saysPaidAtMs: Math.max(saysPaidMs, heldFromMs), startsAtMs }),
  };
}

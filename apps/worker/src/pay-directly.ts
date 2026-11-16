import {
  buildPaymentOptions,
  methodsCoverCurrency,
  parsePaymentMethodInput,
  paymentOptionsText,
  randomPaymentReference,
  type PaymentMethodKind,
  type SavedPaymentMethod,
} from "../../../shared/pay-directly";
import type { DbBooking, Env } from "./types";

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

/**
 * The reference and the payment details text for one pay-directly order or booking. With no
 * saved method the text is the owner's note alone, as before saved methods existed.
 */
export async function prepareDirectPayment(
  env: Env,
  ownerId: string,
  input: DirectPaymentTarget & { amountMinor: number | null; currency: string | null | undefined; note: string | null | undefined },
): Promise<{ reference: string; instructions: string }> {
  const reference = await ensurePaymentReference(env, ownerId, input);
  const note = input.note?.trim() || "";
  const options = buildPaymentOptions(await listPaymentMethods(env, ownerId), {
    amountMinor: input.amountMinor,
    currency: input.currency || "",
    reference,
  });
  return { reference, instructions: [paymentOptionsText(options, reference), note].filter(Boolean).join("\n\n") };
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

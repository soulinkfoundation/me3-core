import { AccountsInputError } from "./accounts";
import { confirmManualProductOrder } from "./commerce-orders";
import type { Env } from "./types";

export async function updateOrderFulfillment(env: Env, ownerId: string, orderId: string, fulfilled: unknown) {
  if (typeof fulfilled !== "boolean") throw new AccountsInputError("Choose whether the order has been fulfilled.");
  const result = await env.DB.prepare(`UPDATE commerce_orders SET fulfilled_at = CASE WHEN ? THEN COALESCE(fulfilled_at, datetime('now')) ELSE NULL END,
    updated_at = datetime('now') WHERE id = ? AND status = 'paid'
    AND site_id IN (SELECT id FROM sites WHERE user_id = ?)`)
    .bind(fulfilled ? 1 : 0, orderId, ownerId).run();
  if (!result.meta.changes) throw new AccountsInputError("Paid order not found.", 404);
  return { ok: true };
}

export async function recordManualOrderPayment(env: Env, ownerId: string, orderId: string) {
  await confirmManualProductOrder(env, ownerId, orderId);
  return { ok: true };
}

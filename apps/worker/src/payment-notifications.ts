import { notifyWebsitePaymentReceived, type WebsitePaymentPush } from "./push-notifications";
import type { Env } from "./types";

export async function dispatchWebsitePaymentNotification(
  env: Env,
  userId: string,
  payment: WebsitePaymentPush,
) {
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
    return { outcome: "skipped" as const };
  }
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO payment_push_dispatches
       (id, user_id, source_kind, source_id, status)
     VALUES (?, ?, ?, ?, 'pending')`,
  ).bind(crypto.randomUUID(), userId, payment.sourceKind, payment.sourceId).run();
  let claimed = Number(inserted.meta.changes || 0) > 0;
  if (!claimed) {
    const retry = await env.DB.prepare(
      `UPDATE payment_push_dispatches
       SET status = 'pending', error_message = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND source_kind = ? AND source_id = ?
         AND status = 'failed'`,
    ).bind(userId, payment.sourceKind, payment.sourceId).run();
    claimed = Number(retry.meta.changes || 0) > 0;
  }
  if (!claimed) return { outcome: "already_dispatched" as const };

  const delivery = await notifyWebsitePaymentReceived(env, payment);
  const matched = typeof delivery.matched === "number" ? delivery.matched : 0;
  const sent = typeof delivery.sent === "number" ? delivery.sent : 0;
  const outcome = delivery.ok !== true
    ? "failed"
    : matched === 0
      ? "skipped"
      : sent === matched
        ? "sent"
        : "failed";
  await env.DB.prepare(
    `UPDATE payment_push_dispatches SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND source_kind = ? AND source_id = ?`,
  ).bind(
    outcome,
    outcome === "sent" ? null : "Native payment notification was not delivered.",
    userId,
    payment.sourceKind,
    payment.sourceId,
  ).run();
  return { outcome, matched, sent };
}

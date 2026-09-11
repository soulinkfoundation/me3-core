import { completeProductCheckout, confirmManualProductOrder } from "./commerce-orders";
import type { DbSite, Env } from "./types";

// Reconcile both providers even when a buyer never visits the return page.
// Oldest checks first keeps failures from starving newer orders.
export async function reconcileProductOrders(env: Env): Promise<void> {
  const rows = await env.DB.prepare(`SELECT id, site_id, checkout_session_id
    FROM commerce_orders WHERE (payment_method = 'stripe' AND checkout_session_id IS NOT NULL AND status = 'pending')
      OR (status = 'paid' AND confirmation_sent_at IS NULL)
    ORDER BY COALESCE(payment_checked_at, created_at) ASC LIMIT 25`)
    .all<{ id: string; site_id: string; checkout_session_id: string }>();
  for (const row of rows.results || []) {
    await env.DB.prepare("UPDATE commerce_orders SET payment_checked_at = datetime('now') WHERE id = ?").bind(row.id).run();
    try {
      const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(row.site_id).first<DbSite>();
      if (!site) continue;
      if (!row.checkout_session_id) {
        await confirmManualProductOrder(env, site.user_id, row.id);
        continue;
      }
      const result = await completeProductCheckout(env, site, row.checkout_session_id);
      if (!result.ok && result.checkoutStatus === "expired") {
        await env.DB.prepare("UPDATE commerce_orders SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
          .bind(row.id).run();
      }
    } catch (error) {
      console.error("Product order reconciliation failed", row.id, error instanceof Error ? error.message : "Unknown error");
    }
  }
}

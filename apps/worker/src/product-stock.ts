import type { ProductOffer } from "../../../shared/product-offer";

/** Counted products use 30-minute Stripe checkouts; a little slack covers the webhook. */
export const STOCK_CHECKOUT_HOLD_MINUTES = 35;
/** A manual-payment request holds a copy while the buyer pays by other means. */
const STOCK_MANUAL_HOLD_DAYS = 7;

type StockedProduct = ProductOffer & { slug?: string };

export type ProductAvailability = {
  /** Copies left, or null when unlimited. */
  remaining: number | null;
  /** Copies left per option id, or null for an unlimited option. */
  options?: Record<string, number | null>;
};

export function isCountedProduct(product: StockedProduct): boolean {
  if (!product.stockSetAt) return false;
  return product.options?.length
    ? product.options.some((option) => option.stock !== undefined)
    : product.stock !== undefined;
}

/** Paid orders, open checkouts and pending manual payments since the owner last set the count. */
async function heldSince(
  db: D1Database,
  siteId: string,
  slug: string,
  optionId: string | null,
  stockSetAt: string,
  now: Date,
): Promise<number> {
  const at = now.toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS held FROM commerce_orders
       WHERE site_id = ? AND product_slug = ? AND created_at >= datetime(?)
         ${optionId === null ? "" : "AND option_id = ?"}
         AND (status = 'paid'
           OR (status = 'pending' AND payment_method = 'manual' AND created_at > datetime(?, '-${STOCK_MANUAL_HOLD_DAYS} days'))
           OR (status = 'pending' AND payment_method != 'manual' AND created_at > datetime(?, '-${STOCK_CHECKOUT_HOLD_MINUTES} minutes')))`,
    )
    .bind(...[siteId, slug, stockSetAt, ...(optionId === null ? [] : [optionId]), at, at])
    .first<{ held: number }>();
  return Number(row?.held || 0);
}

export async function productAvailability(
  db: D1Database,
  siteId: string,
  product: StockedProduct,
  now = new Date(),
): Promise<ProductAvailability> {
  const slug = product.slug || "";
  if (!slug || !isCountedProduct(product)) {
    return product.options?.length
      ? { remaining: null, options: Object.fromEntries(product.options.map((option) => [option.id, null])) }
      : { remaining: null };
  }
  if (product.options?.length) {
    const options: Record<string, number | null> = {};
    for (const option of product.options) {
      options[option.id] = option.stock === undefined
        ? null
        : Math.max(0, option.stock - await heldSince(db, siteId, slug, option.id, product.stockSetAt!, now));
    }
    const counts = Object.values(options);
    return { remaining: counts.every((count) => count !== null) ? counts.reduce((sum, count) => sum! + count!, 0) : null, options };
  }
  return { remaining: Math.max(0, product.stock! - await heldSince(db, siteId, slug, null, product.stockSetAt!, now)) };
}

/**
 * True when holds, including an order just inserted, exceed the copies available.
 * Checking after the insert means two buyers racing for the last copy can never both win.
 */
export async function isOversold(
  db: D1Database,
  siteId: string,
  product: StockedProduct,
  optionId: string | null,
  now = new Date(),
): Promise<boolean> {
  if (!product.slug || !isCountedProduct(product)) return false;
  const option = optionId ? product.options?.find((candidate) => candidate.id === optionId) : undefined;
  const stock = product.options?.length ? option?.stock : product.stock;
  if (stock === undefined) return false;
  return await heldSince(db, siteId, product.slug, product.options?.length ? optionId : null, product.stockSetAt!, now) > stock;
}

import type { Env } from "./types";

// Seller-side agent commerce state. Checkouts wrap the site's own bookings and
// orders; the status secret is derived, never stored. Rate-limit windows are
// disposable. The owner setting defaults to on when the row is missing.
export const AGENT_COMMERCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS agent_commerce_checkouts (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    idempotency_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    offering_id TEXT NOT NULL,
    offering_kind TEXT NOT NULL CHECK (offering_kind IN ('booking', 'event', 'product')),
    buyer_install_id TEXT,
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    slot_start TEXT,
    slot_end TEXT,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'pending', 'paid', 'expired', 'cancelled')),
    provider TEXT CHECK (provider IN ('stripe_direct', 'me3_cloud', 'none')),
    provider_session_id TEXT,
    provider_checkout_url TEXT,
    hold_token TEXT,
    order_id TEXT,
    booking_id TEXT,
    paid_amount_minor INTEGER,
    paid_currency TEXT,
    paid_at TEXT,
    expires_at TEXT NOT NULL,
    opened_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (site_id, idempotency_scope, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS agent_commerce_checkouts_open ON agent_commerce_checkouts(status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS agent_commerce_rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_commerce_settings (
    owner_id TEXT PRIMARY KEY,
    checkout_enabled INTEGER NOT NULL DEFAULT 1 CHECK (checkout_enabled IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

export async function getAgentCheckoutEnabled(env: Env, ownerId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT checkout_enabled FROM agent_commerce_settings WHERE owner_id = ?",
  )
    .bind(ownerId)
    .first<{ checkout_enabled: number }>();
  return row ? row.checkout_enabled === 1 : true;
}

export async function setAgentCheckoutEnabled(
  env: Env,
  ownerId: string,
  enabled: boolean,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO agent_commerce_settings (owner_id, checkout_enabled, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(owner_id) DO UPDATE SET
       checkout_enabled = excluded.checkout_enabled,
       updated_at = excluded.updated_at`,
  )
    .bind(ownerId, enabled ? 1 : 0)
    .run();
}

/** Fixed-window counter. Returns the count including this request. */
export async function countAgentCommerceRequest(
  env: Env,
  key: string,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<{ count: number; retryAfterSeconds: number }> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
  const row = await env.DB.prepare(
    `INSERT INTO agent_commerce_rate_limits (key, window_start, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       request_count = CASE
         WHEN agent_commerce_rate_limits.window_start = excluded.window_start
           THEN agent_commerce_rate_limits.request_count + 1
         ELSE 1
       END,
       window_start = excluded.window_start
     RETURNING request_count`,
  )
    .bind(key, windowStart)
    .first<{ request_count: number }>();
  return {
    count: Number(row?.request_count || 1),
    retryAfterSeconds: Math.max(1, windowStart + windowSeconds - nowSeconds),
  };
}

export async function pruneAgentCommerceRateLimits(env: Env, nowMs = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM agent_commerce_rate_limits WHERE window_start < ?")
    .bind(Math.floor(nowMs / 1000) - 24 * 60 * 60)
    .run();
}

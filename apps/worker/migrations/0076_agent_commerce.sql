-- Agent commerce: checkouts that buying agents create on this site (wrapping its own
-- bookings and orders), fixed-window rate limits and the owner switch (default on).
CREATE TABLE IF NOT EXISTS agent_commerce_checkouts (
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
  );
CREATE INDEX IF NOT EXISTS agent_commerce_checkouts_open ON agent_commerce_checkouts(status, expires_at);
CREATE TABLE IF NOT EXISTS agent_commerce_rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS agent_commerce_settings (
    owner_id TEXT PRIMARY KEY,
    checkout_enabled INTEGER NOT NULL DEFAULT 1 CHECK (checkout_enabled IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

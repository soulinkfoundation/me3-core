-- Network commerce, buyer side: receipts can come from the seller (source seller), and
-- each in_network payment keeps its seller checkout. The status secret is stored encrypted.
CREATE TABLE IF NOT EXISTS agent_payment_receipts_next (
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
  );
INSERT INTO agent_payment_receipts_next(proposal_id,owner_id,amount_minor,currency,order_reference,paid_at,source,source_message_id,mismatch,owner_confirmed,created_at,updated_at)
    SELECT proposal_id,owner_id,amount_minor,currency,order_reference,paid_at,source,source_message_id,mismatch,owner_confirmed,created_at,updated_at FROM agent_payment_receipts;
DROP TABLE agent_payment_receipts;
ALTER TABLE agent_payment_receipts_next RENAME TO agent_payment_receipts;
CREATE TABLE IF NOT EXISTS agent_network_purchases (
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
  );
CREATE INDEX IF NOT EXISTS agent_network_purchases_due ON agent_network_purchases(checkout_status, next_check_at);

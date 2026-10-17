-- Agent payments: ME3 proposes an exact purchase, the owner approves it with a
-- fresh sign-in, and the owner pays on their own device. ME3 never charges.
CREATE TABLE IF NOT EXISTS agent_payment_proposals (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('finish_on_device', 'browser_takeover', 'link_card', 'in_network')),
    merchant_name TEXT NOT NULL,
    merchant_url TEXT NOT NULL,
    purpose TEXT NOT NULL,
    items_json TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    checkout_url TEXT,
    refund_policy TEXT,
    proposal_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'declined', 'handed_over', 'paid', 'not_paid')),
    approval_id TEXT,
    approval_auth TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    handed_over_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_id, idempotency_key)
  );
CREATE INDEX IF NOT EXISTS agent_payment_proposals_owner ON agent_payment_proposals(owner_id, created_at);
CREATE TABLE IF NOT EXISTS agent_payment_receipts (
    proposal_id TEXT PRIMARY KEY REFERENCES agent_payment_proposals(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    order_reference TEXT,
    paid_at TEXT,
    source TEXT NOT NULL CHECK (source IN ('owner', 'email')),
    source_message_id TEXT,
    mismatch INTEGER NOT NULL DEFAULT 0 CHECK (mismatch IN (0, 1)),
    owner_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (owner_confirmed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE IF NOT EXISTS agent_payment_limits (
    owner_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    per_payment_max_minor INTEGER NOT NULL CHECK (per_payment_max_minor >= 0),
    monthly_max_minor INTEGER NOT NULL CHECK (monthly_max_minor >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_id, currency)
  );
CREATE TABLE IF NOT EXISTS agent_payment_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    event TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE INDEX IF NOT EXISTS agent_payment_events_proposal ON agent_payment_events(owner_id, proposal_id, seq);

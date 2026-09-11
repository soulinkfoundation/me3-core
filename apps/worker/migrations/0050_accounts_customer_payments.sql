ALTER TABLE financial_entries ADD COLUMN gross_amount_cents INTEGER;
ALTER TABLE financial_entries ADD COLUMN refunded_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE financial_entries ADD COLUMN customer_name TEXT;
ALTER TABLE financial_entries ADD COLUMN customer_email TEXT;
ALTER TABLE financial_entries ADD COLUMN payment_intent_id TEXT;
ALTER TABLE financial_entries ADD COLUMN site_id TEXT;
ALTER TABLE financial_entries ADD COLUMN item_ref TEXT;
ALTER TABLE financial_entries ADD COLUMN item_title TEXT;

CREATE INDEX IF NOT EXISTS idx_financial_entries_payment_intent
  ON financial_entries(user_id, payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_financial_entries_customer_email
  ON financial_entries(user_id, customer_email);

ALTER TABLE email_campaigns ADD COLUMN audience_filter_json TEXT NOT NULL DEFAULT '{"kind":"all"}';

ALTER TABLE mobile_push_preferences ADD COLUMN payment_notifications_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS payment_push_dispatches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('order', 'booking')),
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, source_kind, source_id),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);

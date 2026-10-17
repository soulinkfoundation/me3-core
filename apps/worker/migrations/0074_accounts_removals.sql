-- Entries the owner deleted from a synced source (website, Stripe, email triage),
-- so the next sync does not bring them back.
CREATE TABLE IF NOT EXISTS financial_entry_removals (
  user_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  payment_intent_id TEXT,
  removed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, source_ref),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_financial_entry_removals_payment_intent
  ON financial_entry_removals(user_id, payment_intent_id);

-- Customers removed from Accounts. Activity after removed_at brings them back.
CREATE TABLE IF NOT EXISTS account_customer_removals (
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  removed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, email),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);

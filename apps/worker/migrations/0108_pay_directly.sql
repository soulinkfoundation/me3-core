-- Pay me directly: the owner's saved ways to get paid (PayPal, Revolut, Wise, bank transfer).
-- Bank details live here only; they are never written into the published site profile.
CREATE TABLE IF NOT EXISTS commerce_payment_methods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('paypal', 'revolut', 'wise', 'bank')),
  link TEXT,
  account_name TEXT,
  iban TEXT,
  bic TEXT,
  sort_code TEXT,
  account_number TEXT,
  currency TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commerce_payment_methods_owner
  ON commerce_payment_methods(user_id, sort_order, created_at);

-- One row per pay-directly product order or booking. The reference is unique across both,
-- and the row later holds what the buyer said and what ME3 sent. No foreign keys to
-- commerce_orders or bookings: rebuilding either table would cascade and wipe these rows.
CREATE TABLE IF NOT EXISTS commerce_direct_payments (
  reference TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT UNIQUE,
  booking_id TEXT UNIQUE,
  method_id TEXT,
  method_kind TEXT,
  says_paid_at TEXT,
  reminded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((order_id IS NULL) <> (booking_id IS NULL)),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commerce_direct_payments_owner
  ON commerce_direct_payments(user_id, created_at);

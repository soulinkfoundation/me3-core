-- Accounts: the receipt or invoice photo behind an entry, kept in Files. The hash stops the
-- same photo being logged twice.
CREATE TABLE IF NOT EXISTS financial_entry_receipts (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES financial_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_financial_entry_receipts_hash
  ON financial_entry_receipts(user_id, sha256);

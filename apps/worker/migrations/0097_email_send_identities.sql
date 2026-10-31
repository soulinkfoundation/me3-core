-- Addresses the owner may send as, such as a forwarded work address (me3-lmax).
-- Each one is proven with a code sent through its provider before it can be used.
CREATE TABLE IF NOT EXISTS email_send_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  code_hash TEXT,
  code_expires_at TEXT,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  code_sent_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, address)
);

-- One row per mail-triage model call (classifier or newsletter summary). Anyone can send mail, so
-- triage caps these calls per owner and per sender over a rolling day and falls back to its
-- deterministic signals past the cap.
CREATE TABLE IF NOT EXISTS mailbox_model_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mailbox_model_calls_user_created
  ON mailbox_model_calls(user_id, created_at);

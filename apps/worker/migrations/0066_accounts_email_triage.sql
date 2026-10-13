CREATE TABLE IF NOT EXISTS accounts_email_triage_settings (
  user_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

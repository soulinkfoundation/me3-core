-- Agent-first Email: one triage record per inbound message, the handled-actions
-- log behind "Handled by ME3", owner mail rules and the sender avatar cache.
CREATE TABLE IF NOT EXISTS mailbox_triage (
  message_id TEXT PRIMARY KEY REFERENCES mailbox_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  mailbox_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  category TEXT CHECK (category IN ('needs_you', 'handled', 'fyi', 'noise')),
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'urgent')),
  summary TEXT,
  decided_by TEXT CHECK (decided_by IN ('rule', 'signal', 'model')),
  handled_kind TEXT,
  primary_action_json TEXT,
  secondary_action_json TEXT,
  draft_id TEXT,
  context_json TEXT,
  resolved_at TEXT,
  snoozed_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  triaged_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mailbox_triage_user_status
  ON mailbox_triage(user_id, status, category);

CREATE TABLE IF NOT EXISTS mailbox_handled_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'newsletter', 'notification', 'rule_archive', 'rule_reply')),
  label TEXT NOT NULL,
  detail TEXT,
  amount_cents INTEGER,
  currency TEXT,
  undo_json TEXT,
  undone_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mailbox_handled_actions_user_created
  ON mailbox_handled_actions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mailbox_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('archive_sender', 'archive_domain', 'always_show_sender')),
  match_value TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_rules_user_match
  ON mailbox_rules(user_id, kind, match_value);

CREATE TABLE IF NOT EXISTS mailbox_sender_avatars (
  domain TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('found', 'none', 'failed')),
  source TEXT,
  storage_key TEXT,
  content_type TEXT,
  data_base64 TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

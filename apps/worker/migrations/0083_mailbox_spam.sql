-- Spam. Filtered mail waits in Trash with spam_at set (the folder constraint predates Spam, and
-- rebuilding mailbox_messages would cascade into the triage and delivery tables), and the cron
-- purges it after 30 days. Owner rules learn spam_sender / spam_domain ("Spam" on a message
-- blocks its sender) and the handled log learns "spam", undone with "Not spam".
ALTER TABLE mailbox_messages ADD COLUMN spam_at TEXT;

CREATE INDEX IF NOT EXISTS idx_mailbox_messages_spam
  ON mailbox_messages(mailbox_id, spam_at) WHERE spam_at IS NOT NULL;

CREATE TABLE mailbox_rules_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('archive_sender', 'archive_domain', 'always_show_sender', 'spam_sender', 'spam_domain')),
  match_value TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mailbox_rules_next (id, user_id, kind, match_value, label, status, created_by, created_at, updated_at)
  SELECT id, user_id, kind, match_value, label, status, created_by, created_at, updated_at FROM mailbox_rules;

DROP TABLE mailbox_rules;

ALTER TABLE mailbox_rules_next RENAME TO mailbox_rules;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_rules_user_match
  ON mailbox_rules(user_id, kind, match_value);

CREATE TABLE mailbox_handled_actions_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'newsletter', 'notification', 'login_code', 'instruction', 'spam', 'rule_archive', 'rule_reply')),
  label TEXT NOT NULL,
  detail TEXT,
  amount_cents INTEGER,
  currency TEXT,
  undo_json TEXT,
  undone_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mailbox_handled_actions_next (id, user_id, message_id, kind, label, detail, amount_cents, currency, undo_json, undone_at, created_at)
  SELECT id, user_id, message_id, kind, label, detail, amount_cents, currency, undo_json, undone_at, created_at FROM mailbox_handled_actions;

DROP TABLE mailbox_handled_actions;

ALTER TABLE mailbox_handled_actions_next RENAME TO mailbox_handled_actions;

CREATE INDEX IF NOT EXISTS idx_mailbox_handled_actions_user_created
  ON mailbox_handled_actions(user_id, created_at DESC);

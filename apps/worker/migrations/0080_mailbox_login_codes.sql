-- The handled log learns "login_code" (sign-in codes ME3 archives once they are past use) and
-- "instruction" (the owner's own email, which ME3 acts on). mailbox_instructions links each such
-- email to the chat turn it started and ME3's emailed reply.
CREATE TABLE mailbox_handled_actions_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'newsletter', 'notification', 'login_code', 'instruction', 'rule_archive', 'rule_reply')),
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

CREATE TABLE IF NOT EXISTS mailbox_instructions (
  message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  thread_key TEXT NOT NULL,
  assistant_thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL UNIQUE,
  reply_to_address TEXT NOT NULL,
  reply_from_address TEXT,
  subject TEXT,
  message_id_header TEXT,
  references_header TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'replying', 'replied', 'failed')),
  reply_error TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mailbox_instructions_thread
  ON mailbox_instructions(user_id, thread_key, created_at DESC);

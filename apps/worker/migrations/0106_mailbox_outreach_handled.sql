-- Outreach: when an email changes a prospect's status (a reply, a calendar invite) or bounces,
-- the Brief's handled log says so, with an undo. The log's kind constraint learns "outreach".
CREATE TABLE mailbox_handled_actions_next (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('receipt', 'newsletter', 'notification', 'login_code', 'instruction', 'spam', 'rule_archive', 'rule_reply', 'outreach')),
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
CREATE INDEX IF NOT EXISTS idx_mailbox_handled_actions_user_created ON mailbox_handled_actions(user_id, created_at DESC);

-- Email conversations (me3-kvu8.26). A conversation is one unit: folders stay per message (one
-- message can be deleted on its own), but Inbox and Archive apply to the whole conversation, and
-- Sent and Drafts are views by message kind. This adds what the conversation work needs, with no
-- table rebuilds:
--   mailbox_conversation_state: Snooze for a whole conversation (until a time, or until a reply
--     with a fallback time).
--   mailbox_messages.send_after: Core holds a send until this time (Send with Undo, Schedule send).
--   mailbox_triage.resolved_how: how a Brief item was cleared, for the Brief's "cleared" list.
-- It then puts conversations that sat in two folders where their newest received message is, and
-- returns sent mail that was filed into Inbox or Archive to Sent.
CREATE TABLE IF NOT EXISTS mailbox_conversation_state (
  mailbox_id TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  snoozed_until TEXT,
  snooze_until_reply INTEGER NOT NULL DEFAULT 0,
  snoozed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox_id, thread_key)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_conversation_state_snoozed
  ON mailbox_conversation_state(mailbox_id, snoozed_until) WHERE snoozed_until IS NOT NULL;

ALTER TABLE mailbox_messages ADD COLUMN send_after TEXT;

CREATE INDEX IF NOT EXISTS idx_mailbox_messages_send_after
  ON mailbox_messages(send_after) WHERE send_after IS NOT NULL;

ALTER TABLE mailbox_triage ADD COLUMN resolved_how TEXT;

UPDATE mailbox_messages SET folder = (
    SELECT newest.folder FROM mailbox_messages newest
    WHERE newest.mailbox_id = mailbox_messages.mailbox_id
      AND newest.canonical_thread_key = mailbox_messages.canonical_thread_key
      AND newest.direction = 'inbound' AND newest.message_kind = 'email'
      AND newest.folder IN ('inbox', 'archive')
    ORDER BY COALESCE(newest.received_at, newest.created_at) DESC, newest.id DESC
    LIMIT 1
  ), updated_at = CURRENT_TIMESTAMP
WHERE direction = 'inbound' AND message_kind = 'email' AND folder IN ('inbox', 'archive')
  AND EXISTS (
    SELECT 1 FROM mailbox_messages other
    WHERE other.mailbox_id = mailbox_messages.mailbox_id
      AND other.canonical_thread_key = mailbox_messages.canonical_thread_key
      AND other.direction = 'inbound' AND other.message_kind = 'email'
      AND other.folder IN ('inbox', 'archive') AND other.folder != mailbox_messages.folder
  );

UPDATE mailbox_messages SET folder = 'sent', updated_at = CURRENT_TIMESTAMP
WHERE direction = 'outbound' AND message_kind = 'email' AND status = 'sent' AND folder IN ('inbox', 'archive');

ALTER TABLE mobile_push_preferences ADD COLUMN agent_notifications_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS me3_agent_chat_presence (
  owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL, PRIMARY KEY(owner_id, thread_id, client_id)
);

CREATE TABLE IF NOT EXISTS me3_agent_notifications (
  owner_id TEXT NOT NULL, turn_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('complete','needs_you')),
  status TEXT NOT NULL CHECK(status IN ('pending','suppressed','relayed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_id, turn_id)
);

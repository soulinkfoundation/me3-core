CREATE TABLE IF NOT EXISTS me3_agent_image_operations (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL, request_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  prompt TEXT NOT NULL, model TEXT NOT NULL, billing_managed INTEGER NOT NULL CHECK(billing_managed IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('admitted','complete','unknown','failed')),
  usage_event_id TEXT NOT NULL, attachment_id TEXT, storage_key TEXT, mime_type TEXT,
  size INTEGER, width INTEGER, height INTEGER, revised_prompt TEXT, sha256 TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS me3_agent_image_turn ON me3_agent_image_operations(owner_id,thread_id,turn_id);

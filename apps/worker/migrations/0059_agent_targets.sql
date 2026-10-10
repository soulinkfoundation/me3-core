-- Portable target snapshots and numbered choices for the new agent only.
CREATE TABLE IF NOT EXISTS me3_agent_targets (
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  record_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  read_turn_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, thread_id, domain, record_id)
);
CREATE TABLE IF NOT EXISTS me3_agent_selections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  read_turn_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS me3_agent_selections_scope ON me3_agent_selections(owner_id, thread_id, domain, created_at DESC);

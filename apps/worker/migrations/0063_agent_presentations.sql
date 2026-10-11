-- Immutable owner-reviewed target choices for the new Core agent runtime.
CREATE TABLE IF NOT EXISTS me3_agent_presentations (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, domain TEXT NOT NULL,
    selection_id TEXT NOT NULL, ordinal INTEGER NOT NULL, tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL, candidates_json TEXT NOT NULL, created_turn_id TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, chosen_record_id TEXT,
    choice_turn_id TEXT, choice_request_id TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','selected')),
    UNIQUE(owner_id,thread_id,ordinal)
  );

CREATE INDEX IF NOT EXISTS idx_agent_presentations_scope ON me3_agent_presentations(owner_id,thread_id,ordinal DESC);

CREATE TABLE IF NOT EXISTS me3_agent_turns (
    turn_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    request_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    input_json TEXT, checkpoint_json TEXT, response_json TEXT, trace_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_id, request_id)
  );

CREATE TABLE IF NOT EXISTS me3_agent_stream_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    event TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE INDEX IF NOT EXISTS me3_agent_stream_turn ON me3_agent_stream_events(owner_id, turn_id, seq);

CREATE TABLE IF NOT EXISTS me3_agent_tool_receipts (
    owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, turn_id TEXT NOT NULL,
    tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, status TEXT NOT NULL,
    result_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(owner_id, idempotency_key)
  );

CREATE TABLE IF NOT EXISTS me3_agent_approvals (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL,
    card_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at TEXT,
    UNIQUE(owner_id, turn_id, idempotency_key)
  );
CREATE TABLE IF NOT EXISTS me3_agent_cancellations (
  owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_id, request_id)
);

CREATE TABLE IF NOT EXISTS me3_agent_request_aliases (
  owner_id TEXT NOT NULL, request_id TEXT NOT NULL, turn_id TEXT NOT NULL,
  input_json TEXT NOT NULL, PRIMARY KEY(owner_id, request_id)
);

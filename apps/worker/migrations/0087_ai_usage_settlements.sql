-- Append-only settlements for managed agent receipts whose cost was unknown when the call ended
-- (an interrupted stream, a timeout or a crash). Each row records the AI Gateway evidence that
-- priced the original receipt, so the receipt keeps its id and billing month and is reported once.
CREATE TABLE IF NOT EXISTS ai_usage_settlements (
  usage_event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('charged', 'no_charge')),
  evidence_source TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  base_cost_usd REAL NOT NULL CHECK (base_cost_usd >= 0),
  actor TEXT NOT NULL,
  prior_metadata_json TEXT NOT NULL,
  settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS ai_usage_settlements_immutable
BEFORE UPDATE ON ai_usage_settlements
BEGIN
  SELECT RAISE(ABORT, 'ai_usage_settlements is append-only');
END;

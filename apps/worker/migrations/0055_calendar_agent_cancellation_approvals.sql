CREATE TABLE IF NOT EXISTS calendar_agent_cancellation_approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+1 day')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_agent_pending_cancel
  ON calendar_agent_cancellation_approvals(user_id, event_id)
  WHERE status = 'pending';

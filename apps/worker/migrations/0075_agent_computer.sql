-- Agent computer: background browser jobs (read-only in this release), their ordered
-- steps, screenshot artifacts and owner limits. Live browser sessions are never stored.
CREATE TABLE IF NOT EXISTS me3_agent_computer_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  origin_turn_id TEXT NOT NULL, origin_call_id TEXT NOT NULL,
  goal TEXT NOT NULL, start_url TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','complete','failed','cancelled','interrupted')),
  end_reason TEXT, limits_json TEXT NOT NULL, usage_day TEXT NOT NULL,
  browsing_ms INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, session_losses INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT, result_json TEXT, cancel_requested_at TEXT, published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
  UNIQUE(owner_id, origin_turn_id, origin_call_id)
);
CREATE INDEX IF NOT EXISTS me3_agent_computer_jobs_owner ON me3_agent_computer_jobs(owner_id, status, created_at);
CREATE INDEX IF NOT EXISTS me3_agent_computer_jobs_day ON me3_agent_computer_jobs(owner_id, usage_day);
CREATE TABLE IF NOT EXISTS me3_agent_computer_steps (
  owner_id TEXT NOT NULL, job_id TEXT NOT NULL, seq INTEGER NOT NULL,
  kind TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(job_id, seq)
);
CREATE TABLE IF NOT EXISTS me3_agent_computer_artifacts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('screenshot')), attachment_id TEXT NOT NULL,
  page_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS me3_agent_computer_artifacts_job ON me3_agent_computer_artifacts(owner_id, job_id);
CREATE TABLE IF NOT EXISTS me3_agent_computer_settings (
  owner_id TEXT PRIMARY KEY, limits_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

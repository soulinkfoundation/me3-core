ALTER TABLE owner_profile ADD COLUMN daily_briefing_time TEXT NOT NULL DEFAULT '07:30';

CREATE TABLE IF NOT EXISTS morning_calendar_push_dispatches (
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date_key)
);

-- Automatic agent memory: importance decides what reaches the agent when space runs
-- out, and time-bound facts ("in Lisbon this week") lapse on their own.
ALTER TABLE mission_private_memory ADD COLUMN importance INTEGER NOT NULL DEFAULT 3;
ALTER TABLE mission_private_memory ADD COLUMN expires_at TEXT;

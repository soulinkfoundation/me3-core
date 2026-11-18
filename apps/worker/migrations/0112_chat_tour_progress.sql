-- Show me around (me3-q6la.5): where the owner is in the tour, so it survives a reload and moves between apps.
CREATE TABLE IF NOT EXISTS chat_tour_progress (
  user_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  step_id TEXT,
  seen_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The Human Soup in ME3 (me3-ydf4). Taste lives in ME3 and never leaves the installation:
-- Soup only ever receives topic words. soup_taste holds the two lanes (for your work, just for
-- you), less-of, followed soups and the owner's chosen servings. soup_servings holds each
-- serving that was composed (a morning's headlines, a single pick, a bowl asked for in chat)
-- with the item snapshot, ME3's for-you lines and what the owner did with it; it doubles as
-- the exclude list so nothing is served twice.
CREATE TABLE IF NOT EXISTS soup_taste (
  user_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
  taste_json TEXT NOT NULL DEFAULT '{}',
  set_up_at TEXT,
  suggested_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS soup_servings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  serving_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('headlines', 'pick')),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'open', 'done', 'expired', 'failed')),
  items_json TEXT NOT NULL DEFAULT '[]',
  due_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date_key, serving_id)
);
CREATE INDEX IF NOT EXISTS idx_soup_servings_open ON soup_servings(user_id, status, expires_at);

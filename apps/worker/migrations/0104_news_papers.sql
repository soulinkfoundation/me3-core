-- News (me3-6ptk.3): one morning paper per owner and day. The paper is built about thirty
-- minutes before the owner's time from The Human Soup's candidate stories (only topic words and
-- a region are sent) and stored whole, with ME3's notes, so it can be reopened all day. Stories
-- keep a headline, the source's short summary, an image URL and a link: never full text.
-- read_at, hidden_at and rating are what the owner did with it; settings live in soup_taste.
CREATE TABLE IF NOT EXISTS news_papers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  paper_json TEXT NOT NULL DEFAULT '{}',
  deliver_at TEXT NOT NULL,
  ready_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  hidden_at TEXT,
  rating TEXT CHECK (rating IS NULL OR rating IN ('fire', 'ok', 'sleepy')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date_key)
);

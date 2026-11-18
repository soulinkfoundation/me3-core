-- Home settings shared by web and the mobile apps. Today's page shows in the Today card unless switched off.
CREATE TABLE IF NOT EXISTS home_settings (
  user_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
  today_page INTEGER NOT NULL DEFAULT 1 CHECK (today_page IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

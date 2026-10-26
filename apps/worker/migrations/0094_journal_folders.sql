-- Notes can be filed into folders. A folder sits inside one project, or under
-- No project when project_id is NULL, so notes are at most two levels deep.
CREATE TABLE IF NOT EXISTS journal_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_journal_folders_owner_project
  ON journal_folders(user_id, project_id, sort_order, name);

ALTER TABLE journal_articles ADD COLUMN folder_id TEXT;

CREATE INDEX IF NOT EXISTS idx_journal_articles_owner_folder
  ON journal_articles(user_id, folder_id, updated_at DESC);

ALTER TABLE journal_articles ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_journal_articles_owner_project
  ON journal_articles(user_id, project_id, updated_at DESC);

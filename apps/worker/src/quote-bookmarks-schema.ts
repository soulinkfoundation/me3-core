export const QUOTE_BOOKMARKS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS quote_bookmarks (
    user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
    quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, quote_id)
  )`,
  `INSERT OR IGNORE INTO quote_bookmarks(user_id, quote_id, saved_at)
    SELECT user_id, id, saved_at FROM quotes
    WHERE user_id IS NOT NULL AND saved_at IS NOT NULL AND archived_at IS NULL`,
];

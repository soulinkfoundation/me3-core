import seed from "./data/quotes-core-seed.json";

export const QUOTES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    text TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    source TEXT,
    source_url TEXT,
    areas TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(areas)),
    origin TEXT NOT NULL CHECK (origin IN ('core', 'owner', 'agent')),
    saved_at TEXT,
    archived_at TEXT,
    UNIQUE(user_id, text, author)
  )`,
  `CREATE TABLE IF NOT EXISTS daily_quotes (
    user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
    date_key TEXT NOT NULL,
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    seen_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY(user_id, date_key)
  )`,
  ...seed.map(quote => {
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
    return `INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES (${[quote.id, quote.text, quote.author, quote.source, JSON.stringify(quote.areas)].map(literal).join(", ")}, 'core')`;
  }),
];

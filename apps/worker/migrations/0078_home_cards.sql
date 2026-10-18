CREATE TABLE IF NOT EXISTS home_cards (
    user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    version INTEGER NOT NULL,
    blocks_json TEXT NOT NULL,
    created_by TEXT NOT NULL CHECK (created_by IN ('agent', 'owner')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
CREATE TABLE IF NOT EXISTS home_card_versions (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    blocks_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, version)
  );
CREATE TABLE IF NOT EXISTS home_card_entries (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    key TEXT NOT NULL,
    date TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, key, date)
  );

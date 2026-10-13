export const GRATITUDE_SETTINGS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS gratitude_settings (
    user_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
    quote_in_briefing INTEGER NOT NULL DEFAULT 1 CHECK (quote_in_briefing IN (0, 1))
  )`,
];

// SQLite CHECK constraints require a table rebuild; retain every reminder field.
export const CARD_REMINDERS_SCHEMA = [
  `CREATE TABLE user_reminders_with_cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    title TEXT NOT NULL,
    notes TEXT,
    remind_at TEXT NOT NULL,
    timezone TEXT,
    recurrence_rule TEXT,
    context_type TEXT CHECK (context_type IN ('contact', 'booking', 'card')),
    context_id TEXT,
    context_label TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dismissed', 'cancelled', 'failed')),
    delivered_at TEXT,
    dismissed_at TEXT,
    cancelled_at TEXT,
    error_message TEXT,
    source_dispatch_id TEXT,
    created_via TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
  )`,
  `INSERT INTO user_reminders_with_cards (id, user_id, title, notes, remind_at, timezone, recurrence_rule,
    context_type, context_id, context_label, status, delivered_at, dismissed_at, cancelled_at,
    error_message, source_dispatch_id, created_via, created_at, updated_at)
    SELECT id, user_id, title, notes, remind_at, timezone, recurrence_rule,
    context_type, context_id, context_label, status, delivered_at, dismissed_at, cancelled_at,
    error_message, source_dispatch_id, created_via, created_at, updated_at FROM user_reminders`,
  `DROP TABLE user_reminders`,
  `ALTER TABLE user_reminders_with_cards RENAME TO user_reminders`,
  `CREATE INDEX idx_user_reminders_user_remind_at ON user_reminders(user_id, remind_at)`,
  `CREATE UNIQUE INDEX idx_user_reminders_agent_dispatch ON user_reminders(user_id, source_dispatch_id) WHERE source_dispatch_id IS NOT NULL`,
  `CREATE UNIQUE INDEX idx_user_reminders_card ON user_reminders(user_id, context_id) WHERE context_type = 'card'`,
];

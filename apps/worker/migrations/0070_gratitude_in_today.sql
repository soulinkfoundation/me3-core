ALTER TABLE gratitude_settings ADD COLUMN in_today INTEGER NOT NULL DEFAULT 0 CHECK (in_today IN (0, 1));

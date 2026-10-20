-- Set when the owner declines or forgets a memory, so automatic memory never learns it again.
-- The agent archiving its own outdated facts leaves it empty.
ALTER TABLE mission_private_memory ADD COLUMN forgotten_at TEXT;

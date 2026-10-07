-- The main conversation is installation-owned, independent of provider channel IDs.
CREATE TABLE assistant_primary_threads (
  owner_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL UNIQUE REFERENCES assistant_threads(id) DEFERRABLE INITIALLY DEFERRED
);

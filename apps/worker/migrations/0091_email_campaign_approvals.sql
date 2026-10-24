-- The owner's approval of exactly what goes out: which revision, to how many people, and when.
-- Sending checks the revision and count still match, so any edit after review needs a new approval.
ALTER TABLE email_campaigns ADD COLUMN approved_revision_id TEXT;
ALTER TABLE email_campaigns ADD COLUMN approved_at TEXT;
ALTER TABLE email_campaigns ADD COLUMN approved_recipient_count INTEGER;

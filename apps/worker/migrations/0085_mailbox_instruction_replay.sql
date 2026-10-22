-- A signed owner email still verifies when someone re-sends a copy of it. Each owner request
-- records the hash of its DKIM signature, and one signature starts at most one request.
ALTER TABLE mailbox_instructions ADD COLUMN signature_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_instructions_signature
  ON mailbox_instructions(user_id, signature_key) WHERE signature_key IS NOT NULL;

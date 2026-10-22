-- Owner credentials record the credential generation they were issued under (see
-- owner-credentials.ts). Password setup, change and reset and "sign out everywhere" advance it,
-- so older mobile refresh tokens and pending ME3 claims stop working. Rows from before this
-- migration have no generation and stay valid until the first credential reset.
ALTER TABLE mobile_refresh_tokens ADD COLUMN credential_generation TEXT;

-- A claim started without an owner session can only attach to a Core that has no password yet.
ALTER TABLE me3_install_claim_states ADD COLUMN initiated_by TEXT NOT NULL DEFAULT 'anonymous';
ALTER TABLE me3_install_claim_states ADD COLUMN credential_generation TEXT;

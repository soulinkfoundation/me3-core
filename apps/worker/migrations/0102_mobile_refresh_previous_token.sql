-- The refresh token before the last rotation stays usable until the phone uses the new one, so a
-- refresh response lost on a flaky network no longer signs the phone out.
ALTER TABLE mobile_refresh_tokens ADD COLUMN previous_token_hash TEXT;

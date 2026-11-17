-- Pay me directly: a "money arrived" email that looks like it pays a waiting order. It is only a
-- suggestion shown to the owner (Match found); nothing is confirmed from it.
ALTER TABLE commerce_direct_payments ADD COLUMN matched_email_id TEXT;
ALTER TABLE commerce_direct_payments ADD COLUMN matched_email_json TEXT;
ALTER TABLE commerce_direct_payments ADD COLUMN match_dismissed_at TEXT;

-- Agent checkout with several lines (me3-s3wi): one checkout and one payment for a
-- booking plus products from the same seller, and the buyer's address the seller
-- tells when a checkout settles. NULL lines_json is a single-offering checkout.
ALTER TABLE agent_commerce_checkouts ADD COLUMN lines_json TEXT;
ALTER TABLE agent_commerce_checkouts ADD COLUMN notify_url TEXT;
ALTER TABLE agent_network_purchases ADD COLUMN lines_json TEXT;

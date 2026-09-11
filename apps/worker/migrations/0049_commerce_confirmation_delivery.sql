ALTER TABLE commerce_orders ADD COLUMN confirmation_sent_at TEXT;
ALTER TABLE commerce_orders ADD COLUMN payment_checked_at TEXT;
-- Do not send unsolicited historical confirmations after upgrading.
UPDATE commerce_orders SET confirmation_sent_at = COALESCE(paid_at, created_at) WHERE status = 'paid';
ALTER TABLE commerce_orders ADD COLUMN delivery_json TEXT;
ALTER TABLE commerce_orders ADD COLUMN fulfilled_at TEXT;

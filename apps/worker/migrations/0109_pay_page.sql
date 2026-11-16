-- Pay me directly: the buyer's pay page. pay_token is the unguessable part of each order's
-- own link; note is the owner's optional note for buyers, as it stood when the order was made.
ALTER TABLE commerce_direct_payments ADD COLUMN pay_token TEXT;
ALTER TABLE commerce_direct_payments ADD COLUMN note TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_direct_payments_pay_token
  ON commerce_direct_payments(pay_token);

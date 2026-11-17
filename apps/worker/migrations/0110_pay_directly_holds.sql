-- Pay me directly: reminding buyers and releasing unpaid held bookings and orders.
-- The owner's two settings, and what has happened to each hold so far.
ALTER TABLE commerce_settings ADD COLUMN pay_directly_remind_days INTEGER NOT NULL DEFAULT 2;
ALTER TABLE commerce_settings ADD COLUMN pay_directly_release_days INTEGER NOT NULL DEFAULT 5;
-- When the current hold began, if later than the order (the owner kept holding, or restored it).
ALTER TABLE commerce_direct_payments ADD COLUMN hold_started_at TEXT;
ALTER TABLE commerce_direct_payments ADD COLUMN owner_warned_at TEXT;
ALTER TABLE commerce_direct_payments ADD COLUMN owner_nudged_at TEXT;
ALTER TABLE commerce_direct_payments ADD COLUMN released_at TEXT;

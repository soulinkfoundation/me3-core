-- Product options, copies left and paid downloads (me3-oe9u).
ALTER TABLE commerce_orders ADD COLUMN option_id TEXT;
ALTER TABLE commerce_orders ADD COLUMN option_label TEXT;

CREATE INDEX IF NOT EXISTS idx_commerce_orders_product_stock
  ON commerce_orders(site_id, product_slug, created_at);

-- One row per download link sent to a buyer. Only the token's hash is stored.
CREATE TABLE IF NOT EXISTS commerce_downloads (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 5,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES commerce_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commerce_downloads_order
  ON commerce_downloads(order_id);

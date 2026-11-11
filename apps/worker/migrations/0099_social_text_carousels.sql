-- Text carousels in the Social composer (me3-wp9i). social_carousel_templates holds the owner's
-- saved slide looks per site; settings left on "site" are references to the site's Look, resolved
-- in the browser. social_text_carousels keeps a Post's slide text and the Files ids of the JPEGs
-- last added to it, so "Edit slides" reopens the same carousel.
CREATE TABLE IF NOT EXISTS social_carousel_templates (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_social_carousel_templates_site ON social_carousel_templates(site_id, created_at);

CREATE TABLE IF NOT EXISTS social_text_carousels (
  post_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  template_id TEXT,
  slides_json TEXT NOT NULL DEFAULT '[]',
  file_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

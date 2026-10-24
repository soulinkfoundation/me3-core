PRAGMA defer_foreign_keys = ON;

-- Facebook Pages join the checked platform lists (me3-bli3.3.9). Rebuilding a parent
-- table fires its ON DELETE actions in D1 even while validation is deferred, so the
-- dependent plugin rows are kept aside and restored once every parent is back.

CREATE TABLE social_posting_preferences_0090_backup AS
SELECT * FROM social_posting_preferences;
CREATE TABLE social_posting_plans_0090_backup AS
SELECT * FROM social_posting_plans;
CREATE TABLE social_posting_reservations_0090_backup AS
SELECT * FROM social_posting_reservations;
CREATE TABLE social_posting_plan_items_0090_backup AS
SELECT * FROM social_posting_plan_items;
CREATE TABLE social_media_delivery_grants_0090_backup AS
SELECT * FROM social_media_delivery_grants;

CREATE TABLE social_accounts_0090_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  platform TEXT NOT NULL
    CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'facebook', 'youtube', 'tiktok')),
  platform_account_id TEXT NOT NULL,
  platform_handle TEXT,
  display_name TEXT,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  metadata_json TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, platform, platform_account_id)
);
INSERT INTO social_accounts_0090_new SELECT * FROM social_accounts;
DROP TABLE social_accounts;
ALTER TABLE social_accounts_0090_new RENAME TO social_accounts;
CREATE INDEX idx_social_accounts_site_platform
  ON social_accounts(site_id, platform);
CREATE INDEX idx_social_accounts_user_site
  ON social_accounts(user_id, site_id);

CREATE TABLE social_oauth_states_0090_new (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  platform TEXT NOT NULL
    CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'facebook', 'youtube', 'tiktok')),
  return_path TEXT NOT NULL DEFAULT '/social',
  code_verifier TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO social_oauth_states_0090_new SELECT * FROM social_oauth_states;
DROP TABLE social_oauth_states;
ALTER TABLE social_oauth_states_0090_new RENAME TO social_oauth_states;
CREATE INDEX idx_social_oauth_states_state_platform
  ON social_oauth_states(state, platform);

CREATE TABLE social_provider_settings_0090_new (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('x', 'linkedin', 'instagram', 'instagram_business', 'facebook', 'youtube', 'tiktok')),
  client_id TEXT NOT NULL DEFAULT '',
  encrypted_client_secret TEXT,
  secret_hint TEXT,
  secret_updated_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider_id)
);
INSERT INTO social_provider_settings_0090_new SELECT * FROM social_provider_settings;
DROP TABLE social_provider_settings;
ALTER TABLE social_provider_settings_0090_new RENAME TO social_provider_settings;

CREATE TABLE social_variants_0090_new (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  platform TEXT NOT NULL
    CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'facebook', 'youtube', 'tiktok')),
  format TEXT NOT NULL DEFAULT 'post',
  title TEXT,
  body_text TEXT NOT NULL,
  first_comment TEXT,
  hashtags_json TEXT NOT NULL DEFAULT '[]',
  asset_manifest_json TEXT NOT NULL DEFAULT '[]',
  source_excerpt TEXT,
  approval_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'approved', 'rejected')),
  scheduled_for TEXT,
  timezone TEXT,
  published_variant_id TEXT,
  agent_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  target_account_id TEXT,
  approved_at TEXT,
  approved_by_user_id TEXT,
  carousel_render_set_id TEXT
    REFERENCES social_carousel_render_sets(id) ON DELETE SET NULL,
  publishing_settings_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(package_id, platform)
);
INSERT INTO social_variants_0090_new SELECT * FROM social_variants;
DROP TABLE social_variants;
ALTER TABLE social_variants_0090_new RENAME TO social_variants;
CREATE INDEX idx_social_variants_package
  ON social_variants(package_id);
CREATE INDEX idx_social_variants_schedule
  ON social_variants(approval_status, scheduled_for);
CREATE INDEX idx_social_variants_target_account
  ON social_variants(target_account_id, approval_status, scheduled_for);
CREATE INDEX idx_social_variants_carousel_render_set
  ON social_variants(carousel_render_set_id)
  WHERE carousel_render_set_id IS NOT NULL;

CREATE TABLE social_publications_0090_new (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  platform TEXT NOT NULL
    CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'facebook', 'youtube', 'tiktok')),
  status TEXT NOT NULL
    CHECK (status IN ('scheduled', 'queued', 'publishing', 'published', 'failed', 'cancelled')),
  scheduled_for TEXT,
  timezone TEXT,
  target_account_id_snapshot TEXT,
  format_snapshot TEXT
    CHECK (
      format_snapshot IS NULL
      OR format_snapshot IN ('post', 'image', 'carousel', 'short_video')
    ),
  body_text_snapshot TEXT,
  asset_manifest_json_snapshot TEXT,
  approval_status_snapshot TEXT
    CHECK (
      approval_status_snapshot IS NULL
      OR approval_status_snapshot IN ('draft', 'approved', 'rejected')
    ),
  approved_at_snapshot TEXT,
  approved_by_user_id_snapshot TEXT,
  requested_by_type TEXT
    CHECK (requested_by_type IS NULL OR requested_by_type IN ('owner', 'agent', 'migration')),
  requested_by_user_id TEXT,
  request_context_json TEXT NOT NULL DEFAULT '{}',
  platform_post_id TEXT,
  platform_post_url TEXT,
  error_code TEXT,
  error_message TEXT,
  provider_response_json TEXT,
  queued_at TEXT,
  published_at TEXT,
  last_polled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO social_publications_0090_new SELECT * FROM social_publications;
DROP TABLE social_publications;
ALTER TABLE social_publications_0090_new RENAME TO social_publications;
CREATE INDEX idx_social_publications_status
  ON social_publications(status, scheduled_for, created_at DESC);
CREATE INDEX idx_social_publications_variant
  ON social_publications(variant_id, created_at DESC);
CREATE UNIQUE INDEX idx_social_publications_same_time_scheduled
  ON social_publications(variant_id, scheduled_for)
  WHERE status = 'scheduled' AND scheduled_for IS NOT NULL;
CREATE UNIQUE INDEX idx_social_publications_one_in_flight_variant
  ON social_publications(variant_id)
  WHERE status IN ('queued', 'publishing');

DELETE FROM social_media_delivery_grants;
DELETE FROM social_posting_plan_items;
DELETE FROM social_posting_reservations;
DELETE FROM social_posting_plans;
DELETE FROM social_posting_preferences;
INSERT INTO social_posting_preferences
SELECT * FROM social_posting_preferences_0090_backup;
INSERT INTO social_posting_plans
SELECT * FROM social_posting_plans_0090_backup;
INSERT INTO social_posting_reservations
SELECT * FROM social_posting_reservations_0090_backup;
INSERT INTO social_posting_plan_items
SELECT * FROM social_posting_plan_items_0090_backup;
INSERT INTO social_media_delivery_grants
SELECT * FROM social_media_delivery_grants_0090_backup;
DROP TABLE social_posting_preferences_0090_backup;
DROP TABLE social_posting_plans_0090_backup;
DROP TABLE social_posting_reservations_0090_backup;
DROP TABLE social_posting_plan_items_0090_backup;
DROP TABLE social_media_delivery_grants_0090_backup;

PRAGMA defer_foreign_keys = OFF;

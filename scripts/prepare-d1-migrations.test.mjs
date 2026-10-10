import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  D1_MIGRATION_REPAIR_SQL,
  runD1MigrationPreflight,
  SCHEMA_BACKED_MIGRATION_REPAIRS,
} from "./prepare-d1-migrations.mjs";

const expectedRepairNames = [
  "0011_financial_entry_projects.sql",
  "0015_agent_runtime_idempotency.sql",
  "0016_social_content_packages.sql",
  "0017_site_pages_and_commerce.sql",
  "0018_social_publication_idempotency.sql",
  "0019_owner_content_search.sql",
  "0020_mailbox_thread_index.sql",
  "0021_managed_email_inbound_deliveries.sql",
  "0022_social_posts_canonical.sql",
  "0023_social_publications_reusable.sql",
  "0024_social_suggestions.sql",
  "0025_social_posting_plans.sql",
  "0026_social_carousels.sql",
  "0027_managed_runtime_lifecycle.sql",
  "0028_journal_entry_revision.sql",
  "0029_social_media_delivery.sql",
  "0030_social_youtube_tiktok.sql",
  "0060_mission_goal_links.sql",
];

function readMigrationNames(db) {
  return db
    .prepare("SELECT name FROM d1_migrations ORDER BY name")
    .all()
    .map((row) => row.name);
}

test("preflight covers every schema-backed legacy migration record", () => {
  assert.deepEqual(
    SCHEMA_BACKED_MIGRATION_REPAIRS.map((repair) => repair.name),
    expectedRepairNames,
  );
  for (const name of expectedRepairNames) {
    assert.match(D1_MIGRATION_REPAIR_SQL, new RegExp(name.replace(".", "\\.")));
  }
  assert.match(D1_MIGRATION_REPAIR_SQL, /pragma_table_info\('mailbox_messages'\)/);
  assert.match(D1_MIGRATION_REPAIR_SQL, /using fts5/);
  assert.match(D1_MIGRATION_REPAIR_SQL, /lower\(sql\) LIKE '%youtube%'/);
  assert.match(D1_MIGRATION_REPAIR_SQL, /INSERT OR IGNORE INTO d1_migrations/);
});

test("preflight does not mark absent or partial schemas as migrated", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(D1_MIGRATION_REPAIR_SQL);
  assert.deepEqual(readMigrationNames(db), []);

  db.exec(`
    CREATE TABLE financial_entries (project_id TEXT);
    CREATE TABLE social_packages (source_type TEXT);
    CREATE TABLE social_variants (
      target_account_id TEXT,
      approved_at TEXT,
      approved_by_user_id TEXT
    );
  `);
  db.exec(D1_MIGRATION_REPAIR_SQL);
  assert.deepEqual(readMigrationNames(db), [
    "0011_financial_entry_projects.sql",
  ]);
  db.close();
});

test("preflight repairs the complete final schema without replaying migrations", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE mission_tasks (user_id TEXT, goal_id TEXT);
    CREATE INDEX idx_mission_tasks_goal ON mission_tasks(user_id, goal_id);
    CREATE TABLE financial_entries (project_id TEXT);
    CREATE TABLE mailbox_messages (
      id TEXT,
      mailbox_id TEXT,
      thread_key TEXT,
      sent_at TEXT,
      received_at TEXT,
      approved_at TEXT,
      created_at TEXT,
      agent_idempotency_key TEXT
    );
    CREATE TABLE journal_entries (revision INTEGER);
    CREATE TABLE social_packages (
      site_id TEXT,
      source_type TEXT,
      source_ref TEXT,
      source_snapshot TEXT,
      source_text TEXT,
      idea_text TEXT,
      tags_json TEXT
    );
    CREATE TABLE social_variants (
      package_id TEXT,
      platform TEXT CHECK (platform IN ('youtube', 'tiktok')),
      target_account_id TEXT,
      approval_status TEXT,
      scheduled_for TEXT,
      approved_at TEXT,
      approved_by_user_id TEXT,
      carousel_render_set_id TEXT
    );
    CREATE TABLE social_publications (
      variant_id TEXT,
      platform TEXT CHECK (platform IN ('youtube', 'tiktok')),
      status TEXT,
      scheduled_for TEXT,
      requested_by_type TEXT,
      request_context_json TEXT
    );
    CREATE TABLE social_publication_events (
      publication_id TEXT,
      variant_id TEXT
    );
    CREATE INDEX idx_social_packages_source
      ON social_packages(site_id, source_type, source_ref);
    CREATE INDEX idx_social_variants_target_account
      ON social_variants(target_account_id, approval_status, scheduled_for);
    CREATE INDEX idx_social_publications_one_in_flight_variant
      ON social_publications(variant_id);
    CREATE INDEX idx_social_publications_same_time_scheduled
      ON social_publications(variant_id, scheduled_for);
    CREATE INDEX idx_social_publication_events_publication
      ON social_publication_events(publication_id);
    CREATE INDEX idx_social_publication_events_variant
      ON social_publication_events(variant_id);
    CREATE INDEX idx_mailbox_messages_mailbox_thread_activity
      ON mailbox_messages(mailbox_id, thread_key);

    CREATE TABLE subscribers (page_id TEXT, action_id TEXT, campaign TEXT);
    CREATE TABLE bookings (page_id TEXT, action_id TEXT, campaign TEXT);
    CREATE TABLE site_pages (site_id TEXT, updated_at TEXT);
    CREATE TABLE site_page_revisions (page_id TEXT, created_at TEXT);
    CREATE TABLE commerce_orders (site_id TEXT, created_at TEXT);
    CREATE INDEX idx_site_pages_site_updated
      ON site_pages(site_id, updated_at);
    CREATE INDEX idx_site_page_revisions_page_created
      ON site_page_revisions(page_id, created_at);
    CREATE INDEX idx_commerce_orders_site_created
      ON commerce_orders(site_id, created_at);

    CREATE VIRTUAL TABLE owner_content_search USING fts5(body);
    CREATE TABLE trigger_source (id TEXT);
    CREATE TRIGGER owner_content_search_journal_insert
      AFTER INSERT ON trigger_source BEGIN SELECT 1; END;
    CREATE TRIGGER owner_content_search_journal_update
      AFTER UPDATE ON trigger_source BEGIN SELECT 1; END;
    CREATE TRIGGER owner_content_search_journal_delete
      AFTER DELETE ON trigger_source BEGIN SELECT 1; END;
    CREATE TRIGGER owner_content_search_task_insert
      AFTER INSERT ON trigger_source BEGIN SELECT 1; END;
    CREATE TRIGGER owner_content_search_task_update
      AFTER UPDATE ON trigger_source BEGIN SELECT 1; END;
    CREATE TRIGGER owner_content_search_task_delete
      AFTER DELETE ON trigger_source BEGIN SELECT 1; END;
    CREATE TRIGGER owner_content_search_project_rename
      AFTER UPDATE OF id ON trigger_source BEGIN SELECT 1; END;

    CREATE TABLE managed_email_inbound_deliveries (
      managed_installation_id TEXT,
      received_at TEXT
    );
    CREATE INDEX idx_managed_email_inbound_install_received
      ON managed_email_inbound_deliveries(
        managed_installation_id,
        received_at
      );

    CREATE TABLE social_suggestions (
      site_id TEXT,
      status TEXT,
      source_type TEXT,
      source_ref TEXT
    );
    CREATE INDEX idx_social_suggestions_site_status
      ON social_suggestions(site_id, status);
    CREATE INDEX idx_social_suggestions_source
      ON social_suggestions(source_type, source_ref);

    CREATE TABLE social_posting_preferences (owner_id TEXT, status TEXT);
    CREATE TABLE social_posting_plans (owner_id TEXT, status TEXT);
    CREATE TABLE social_posting_plan_items (plan_id TEXT);
    CREATE TABLE social_posting_reservations (
      target_account_id TEXT,
      scheduled_for TEXT
    );
    CREATE INDEX idx_social_posting_plans_owner_status
      ON social_posting_plans(owner_id, status);
    CREATE INDEX idx_social_posting_plan_items_plan
      ON social_posting_plan_items(plan_id);
    CREATE INDEX idx_social_posting_reservations_account_time
      ON social_posting_reservations(target_account_id, scheduled_for);

    CREATE TABLE social_carousel_media (owner_id TEXT, site_id TEXT);
    CREATE TABLE social_carousel_render_sets (post_id TEXT);
    CREATE TABLE social_carousel_render_assets (render_set_id TEXT);
    CREATE TABLE social_carousel_render_set_media (render_set_id TEXT);
    CREATE INDEX idx_social_carousel_media_owner_site
      ON social_carousel_media(owner_id, site_id);
    CREATE INDEX idx_social_carousel_render_sets_post
      ON social_carousel_render_sets(post_id);
    CREATE INDEX idx_social_carousel_render_assets_set
      ON social_carousel_render_assets(render_set_id);
    CREATE INDEX idx_social_variants_carousel_render_set
      ON social_variants(carousel_render_set_id);

    CREATE TABLE managed_runtime_state (install_id TEXT);
    CREATE TABLE managed_runtime_control_requests (
      install_id TEXT,
      created_at TEXT
    );
    CREATE TABLE managed_runtime_write_leases (
      install_id TEXT,
      created_at TEXT
    );
    CREATE INDEX idx_managed_runtime_control_requests_install_created
      ON managed_runtime_control_requests(install_id, created_at);
    CREATE INDEX idx_managed_runtime_write_leases_install_created
      ON managed_runtime_write_leases(install_id, created_at);

    CREATE TABLE drive_multipart_uploads (
      owner_id TEXT,
      status TEXT,
      updated_at TEXT
    );
    CREATE TABLE drive_multipart_parts (upload_id TEXT);
    CREATE TABLE social_media_delivery_grants (
      token_hash TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      publication_id TEXT,
      file_id TEXT,
      provider TEXT
    );
    CREATE INDEX idx_drive_multipart_uploads_owner_status
      ON drive_multipart_uploads(owner_id, status, updated_at);
    CREATE INDEX idx_social_media_delivery_grants_lookup
      ON social_media_delivery_grants(token_hash, expires_at);
    CREATE INDEX idx_social_media_delivery_grants_publication
      ON social_media_delivery_grants(publication_id, file_id, provider);

    CREATE TABLE social_accounts (
      platform TEXT CHECK (platform IN ('youtube', 'tiktok'))
    );
    CREATE TABLE social_oauth_states (
      platform TEXT CHECK (platform IN ('youtube', 'tiktok'))
    );
    CREATE TABLE social_provider_settings (
      provider_id TEXT CHECK (provider_id IN ('youtube', 'tiktok'))
    );
  `);

  db.exec(D1_MIGRATION_REPAIR_SQL);
  assert.deepEqual(readMigrationNames(db), expectedRepairNames);
  db.close();
});

test("preflight returns the Wrangler status", () => {
  const calls = [];
  const status = runD1MigrationPreflight({
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 23 };
    },
  });

  assert.equal(status, 23);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "pnpm");
  assert.deepEqual(calls[0].args.slice(0, 7), [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    "--config",
  ]);
  assert.equal(calls[0].args.at(-1), D1_MIGRATION_REPAIR_SQL);
  assert.deepEqual(calls[0].options, { stdio: "inherit" });
});

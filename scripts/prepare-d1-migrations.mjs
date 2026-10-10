import { spawnSync } from "node:child_process";

function hasColumn(table, column) {
  return `EXISTS (
  SELECT 1 FROM pragma_table_info('${table}') WHERE name = '${column}'
)`;
}

function hasSchemaObject(type, name) {
  return `EXISTS (
  SELECT 1 FROM sqlite_master WHERE type = '${type}' AND name = '${name}'
)`;
}

function tableSupportsPlatforms(table) {
  return `EXISTS (
  SELECT 1
  FROM sqlite_master
  WHERE type = 'table'
    AND name = '${table}'
    AND lower(sql) LIKE '%youtube%'
    AND lower(sql) LIKE '%tiktok%'
)`;
}

export const SCHEMA_BACKED_MIGRATION_REPAIRS = [
  {
    name: "0011_financial_entry_projects.sql",
    evidenceSql: hasColumn("financial_entries", "project_id"),
  },
  {
    name: "0015_agent_runtime_idempotency.sql",
    evidenceSql: hasColumn("mailbox_messages", "agent_idempotency_key"),
  },
  {
    name: "0016_social_content_packages.sql",
    evidenceSql: [
      hasColumn("social_packages", "source_type"),
      hasColumn("social_packages", "source_ref"),
      hasColumn("social_packages", "source_snapshot"),
      hasColumn("social_packages", "idea_text"),
      hasColumn("social_variants", "target_account_id"),
      hasColumn("social_variants", "approved_at"),
      hasColumn("social_variants", "approved_by_user_id"),
      hasSchemaObject("index", "idx_social_packages_source"),
      hasSchemaObject("index", "idx_social_variants_target_account"),
    ].join("\nAND "),
  },
  {
    name: "0017_site_pages_and_commerce.sql",
    evidenceSql: [
      hasSchemaObject("table", "site_pages"),
      hasSchemaObject("table", "site_page_revisions"),
      hasSchemaObject("table", "commerce_orders"),
      hasColumn("subscribers", "page_id"),
      hasColumn("subscribers", "action_id"),
      hasColumn("subscribers", "campaign"),
      hasColumn("bookings", "page_id"),
      hasColumn("bookings", "action_id"),
      hasColumn("bookings", "campaign"),
      hasSchemaObject("index", "idx_site_pages_site_updated"),
      hasSchemaObject("index", "idx_site_page_revisions_page_created"),
      hasSchemaObject("index", "idx_commerce_orders_site_created"),
    ].join("\nAND "),
  },
  {
    name: "0018_social_publication_idempotency.sql",
    evidenceSql: `(
  ${hasSchemaObject("index", "idx_social_publications_one_active_variant")}
  OR ${hasSchemaObject("index", "idx_social_publications_one_in_flight_variant")}
)`,
  },
  {
    name: "0019_owner_content_search.sql",
    evidenceSql: [
      `EXISTS (
  SELECT 1
  FROM sqlite_master
  WHERE type = 'table'
    AND name = 'owner_content_search'
    AND lower(sql) LIKE '%using fts5%'
)`,
      ...[
        "owner_content_search_journal_insert",
        "owner_content_search_journal_update",
        "owner_content_search_journal_delete",
        "owner_content_search_task_insert",
        "owner_content_search_task_update",
        "owner_content_search_task_delete",
        "owner_content_search_project_rename",
      ].map((name) => hasSchemaObject("trigger", name)),
    ].join("\nAND "),
  },
  {
    name: "0020_mailbox_thread_index.sql",
    evidenceSql: hasSchemaObject(
      "index",
      "idx_mailbox_messages_mailbox_thread_activity",
    ),
  },
  {
    name: "0021_managed_email_inbound_deliveries.sql",
    evidenceSql: [
      hasSchemaObject("table", "managed_email_inbound_deliveries"),
      hasSchemaObject("index", "idx_managed_email_inbound_install_received"),
    ].join("\nAND "),
  },
  {
    name: "0022_social_posts_canonical.sql",
    evidenceSql: [
      hasColumn("social_packages", "source_text"),
      `(
  ${hasSchemaObject("index", "idx_social_publications_one_active_variant")}
  OR ${hasSchemaObject("index", "idx_social_publications_one_in_flight_variant")}
)`,
    ].join("\nAND "),
  },
  {
    name: "0023_social_publications_reusable.sql",
    evidenceSql: [
      hasColumn("social_publications", "requested_by_type"),
      hasColumn("social_publications", "request_context_json"),
      hasSchemaObject("index", "idx_social_publications_same_time_scheduled"),
      hasSchemaObject("index", "idx_social_publications_one_in_flight_variant"),
      hasSchemaObject("index", "idx_social_publication_events_publication"),
      hasSchemaObject("index", "idx_social_publication_events_variant"),
    ].join("\nAND "),
  },
  {
    name: "0024_social_suggestions.sql",
    evidenceSql: [
      hasSchemaObject("table", "social_suggestions"),
      hasSchemaObject("index", "idx_social_suggestions_site_status"),
      hasSchemaObject("index", "idx_social_suggestions_source"),
    ].join("\nAND "),
  },
  {
    name: "0025_social_posting_plans.sql",
    evidenceSql: [
      hasColumn("social_packages", "tags_json"),
      hasSchemaObject("table", "social_posting_preferences"),
      hasSchemaObject("table", "social_posting_plans"),
      hasSchemaObject("table", "social_posting_plan_items"),
      hasSchemaObject("table", "social_posting_reservations"),
      hasSchemaObject("index", "idx_social_posting_plans_owner_status"),
      hasSchemaObject("index", "idx_social_posting_plan_items_plan"),
      hasSchemaObject("index", "idx_social_posting_reservations_account_time"),
    ].join("\nAND "),
  },
  {
    name: "0026_social_carousels.sql",
    evidenceSql: [
      hasSchemaObject("table", "social_carousel_media"),
      hasSchemaObject("table", "social_carousel_render_sets"),
      hasSchemaObject("table", "social_carousel_render_assets"),
      hasSchemaObject("table", "social_carousel_render_set_media"),
      hasColumn("social_variants", "carousel_render_set_id"),
      hasSchemaObject("index", "idx_social_carousel_media_owner_site"),
      hasSchemaObject("index", "idx_social_carousel_render_sets_post"),
      hasSchemaObject("index", "idx_social_carousel_render_assets_set"),
      hasSchemaObject("index", "idx_social_variants_carousel_render_set"),
    ].join("\nAND "),
  },
  {
    name: "0027_managed_runtime_lifecycle.sql",
    evidenceSql: [
      hasSchemaObject("table", "managed_runtime_state"),
      hasSchemaObject("table", "managed_runtime_control_requests"),
      hasSchemaObject("table", "managed_runtime_write_leases"),
      hasSchemaObject(
        "index",
        "idx_managed_runtime_control_requests_install_created",
      ),
      hasSchemaObject(
        "index",
        "idx_managed_runtime_write_leases_install_created",
      ),
    ].join("\nAND "),
  },
  {
    name: "0028_journal_entry_revision.sql",
    evidenceSql: hasColumn("journal_entries", "revision"),
  },
  {
    name: "0029_social_media_delivery.sql",
    evidenceSql: [
      hasSchemaObject("table", "drive_multipart_uploads"),
      hasSchemaObject("table", "drive_multipart_parts"),
      hasSchemaObject("table", "social_media_delivery_grants"),
      hasSchemaObject("index", "idx_drive_multipart_uploads_owner_status"),
      hasSchemaObject("index", "idx_social_media_delivery_grants_lookup"),
      hasSchemaObject("index", "idx_social_media_delivery_grants_publication"),
    ].join("\nAND "),
  },
  {
    name: "0030_social_youtube_tiktok.sql",
    evidenceSql: [
      tableSupportsPlatforms("social_accounts"),
      tableSupportsPlatforms("social_oauth_states"),
      tableSupportsPlatforms("social_provider_settings"),
      tableSupportsPlatforms("social_variants"),
      tableSupportsPlatforms("social_publications"),
    ].join("\nAND "),
  },
  {
    name: "0060_mission_goal_links.sql",
    evidenceSql: [hasColumn("mission_tasks", "goal_id"), hasSchemaObject("index", "idx_mission_tasks_goal")].join("\nAND "),
  },
];

const repairStatements = SCHEMA_BACKED_MIGRATION_REPAIRS.map(
  ({ name, evidenceSql }) => `INSERT OR IGNORE INTO d1_migrations (name)
SELECT '${name}'
WHERE ${evidenceSql};`,
).join("\n");

export const D1_MIGRATION_REPAIR_SQL = `
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
${repairStatements}
`;

export function runD1MigrationPreflight({ spawn = spawnSync } = {}) {
  const result = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--config",
      "wrangler.toml",
      "--command",
      D1_MIGRATION_REPAIR_SQL,
    ],
    { stdio: "inherit" },
  );
  return result.status ?? 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runD1MigrationPreflight());
}

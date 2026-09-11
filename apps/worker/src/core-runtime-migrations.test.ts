import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureCoreRuntimeMigrations,
  resetCoreRuntimeMigrationsForTest,
} from "./core-runtime-migrations";
import type { Env } from "./types";

describe("Core runtime migrations", () => {
  beforeEach(() => {
    resetCoreRuntimeMigrationsForTest();
  });

  it("creates missing update-era tables and columns", async () => {
    const db = new RuntimeMigrationDb();

    await ensureCoreRuntimeMigrations({ DB: db as unknown as D1Database } as Env);

    expect(db.tables.has("core_runtime_migrations")).toBe(true);
    expect(db.columns.get("mission_tasks")?.has("pinned_at")).toBe(true);
    expect(db.columns.get("commerce_settings")?.has("default_currency")).toBe(true);
    expect(db.columns.get("commerce_settings")?.has("preferred_stripe_provider")).toBe(true);
    expect(db.tables.has("ai_usage_events")).toBe(true);
    expect(db.tables.has("agent_turn_results")).toBe(true);
    expect(db.tables.has("agent_tool_executions")).toBe(true);
    expect(db.tables.has("owner_content_search")).toBe(true);
    expect(db.tables.has("managed_email_inbound_deliveries")).toBe(true);
    expect(db.tables.has("site_pages")).toBe(true);
    expect(db.tables.has("site_page_revisions")).toBe(true);
    expect(db.tables.has("commerce_orders")).toBe(true);
    expect(db.columns.get("commerce_orders")?.has("amount_due")).toBe(true);
    expect(db.columns.get("commerce_orders")?.has("payment_method")).toBe(true);
    expect(db.columns.get("subscribers")?.has("page_id")).toBe(true);
    expect(db.columns.get("subscribers")?.has("action_id")).toBe(true);
    expect(db.columns.get("subscribers")?.has("campaign")).toBe(true);
    expect(db.columns.get("subscribers")?.has("marketing_status")).toBe(true);
    expect(db.columns.get("subscribers")?.has("marketing_permission_method")).toBe(true);
    expect(db.columns.get("subscribers")?.has("marketing_permission_granted_at")).toBe(true);
    expect(db.columns.get("subscribers")?.has("marketing_permission_evidence_json")).toBe(true);
    expect(db.columns.get("subscribers")?.has("delivery_status")).toBe(true);
    expect(db.columns.get("subscribers")?.has("delivery_status_changed_at")).toBe(true);
    expect(db.columns.get("subscribers")?.has("confirmation_token_hash")).toBe(true);
    expect(db.columns.get("subscribers")?.has("confirmation_expires_at")).toBe(true);
    expect(db.columns.get("subscribers")?.has("confirmation_requested_at")).toBe(true);
    expect(db.tables.has("email_campaigns")).toBe(true);
    expect(db.tables.has("email_campaign_revisions")).toBe(true);
    expect(db.tables.has("email_campaign_audience_snapshots")).toBe(true);
    expect(db.tables.has("email_campaign_audience_members")).toBe(true);
    expect(db.tables.has("email_campaign_assets")).toBe(true);
    expect(db.tables.has("email_campaign_recipient_jobs")).toBe(true);
    expect(db.tables.has("email_campaign_events")).toBe(true);
    expect(db.tables.has("email_campaign_transport_state")).toBe(true);
    expect(db.tables.has("email_campaign_revision_assets")).toBe(true);
    expect(db.tables.has("site_branding")).toBe(true);
    expect(db.columns.get("bookings")?.has("page_id")).toBe(true);
    expect(db.columns.get("bookings")?.has("action_id")).toBe(true);
    expect(db.columns.get("bookings")?.has("campaign")).toBe(true);
    expect(db.tables.has("social_suggestions")).toBe(true);
    expect(db.tables.has("social_posting_preferences")).toBe(true);
    expect(db.tables.has("social_posting_plans")).toBe(true);
    expect(db.tables.has("social_posting_plan_items")).toBe(true);
    expect(db.tables.has("social_posting_reservations")).toBe(true);
    expect(db.tables.has("social_carousel_media")).toBe(true);
    expect(db.tables.has("social_carousel_render_sets")).toBe(true);
    expect(db.tables.has("social_carousel_render_assets")).toBe(true);
    expect(db.tables.has("social_carousel_render_set_media")).toBe(true);
    expect(db.tables.has("managed_runtime_state")).toBe(true);
    expect(db.tables.has("managed_runtime_control_requests")).toBe(true);
    expect(db.columns.get("journal_entries")?.has("revision")).toBe(true);
    expect(
      db.columns.get("managed_runtime_control_requests")?.has("expected_generation"),
    ).toBe(true);
    expect(db.tables.has("managed_runtime_write_leases")).toBe(true);
    expect(db.tables.has("owner_onboarding")).toBe(true);
    expect(db.tables.has("calendar_source_event_dismissals")).toBe(true);
    expect(db.tables.has("drive_multipart_uploads")).toBe(true);
    expect(db.tables.has("drive_multipart_parts")).toBe(true);
    expect(db.tables.has("social_media_delivery_grants")).toBe(true);
    expect(db.columns.get("sites")?.has("site_role")).toBe(true);
    expect(db.columns.get("sites")?.has("profile_site_id")).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("CREATE VIRTUAL TABLE IF NOT EXISTS owner_content_search") &&
          sql.includes("prefix = '2 3'"),
      ),
    ).toBe(true);
    expect(db.columns.get("financial_entries")?.has("project_id")).toBe(true);
    expect(db.columns.get("social_packages")?.has("source_type")).toBe(true);
    expect(db.columns.get("social_packages")?.has("source_ref")).toBe(true);
    expect(db.columns.get("social_packages")?.has("source_snapshot")).toBe(true);
    expect(db.columns.get("social_packages")?.has("source_text")).toBe(true);
    expect(db.columns.get("social_packages")?.has("idea_text")).toBe(true);
    expect(db.columns.get("social_packages")?.has("tags_json")).toBe(true);
    expect(db.columns.get("social_variants")?.has("target_account_id")).toBe(true);
    expect(db.columns.get("social_variants")?.has("approved_at")).toBe(true);
    expect(db.columns.get("social_variants")?.has("approved_by_user_id")).toBe(true);
    expect(db.columns.get("social_variants")?.has("carousel_render_set_id")).toBe(true);
    expect(db.columns.get("social_variants")?.has("publishing_settings_json")).toBe(true);
    expect(db.migrations.get("0002_mission_task_pins")).toBe(
      "2026-06-24-mission-task-pins-v1",
    );
    expect(db.migrations.get("0009_commerce_default_currency")).toBe(
      "2026-06-24-commerce-default-currency-v1",
    );
    expect(db.migrations.get("0010_ai_usage_events")).toBe(
      "2026-06-24-ai-usage-events-v1",
    );
    expect(db.migrations.get("0011_financial_entry_projects")).toBe(
      "2026-06-24-financial-entry-projects-v1",
    );
    expect(db.migrations.get("0015_agent_runtime_idempotency")).toBe(
      "2026-07-09-agent-runtime-idempotency-v2",
    );
    expect(db.migrations.get("0016_social_content_packages")).toBe(
      "2026-07-10-social-content-packages-v1",
    );
    expect(db.migrations.get("0017_site_pages_and_commerce")).toBe(
      "2026-07-19-site-pages-and-commerce-v1",
    );
    expect(db.migrations.get("0018_social_publication_idempotency")).toBe(
      "2026-07-10-social-publication-idempotency-v1",
    );
    expect(db.migrations.get("0019_owner_content_search")).toBe(
      "2026-07-15-owner-content-search-v1",
    );
    expect(db.migrations.get("0020_mailbox_thread_index")).toBe(
      "2026-07-16-mailbox-thread-index-v1",
    );
    expect(db.migrations.get("0021_managed_email_inbound_deliveries")).toBe(
      "2026-07-18-managed-email-inbound-deliveries-v1",
    );
    expect(db.migrations.get("0022_social_posts_canonical")).toBe(
      "2026-07-18-social-posts-canonical-v1",
    );
    expect(db.migrations.get("0023_social_publications_reusable")).toBe(
      "2026-07-18-social-publications-reusable-v1",
    );
    expect(db.migrations.get("0024_social_suggestions")).toBe(
      "2026-07-18-social-suggestions-v2",
    );
    expect(db.migrations.get("0025_social_posting_plans")).toBe(
      "2026-07-18-social-posting-plans-v1",
    );
    expect(db.migrations.get("0026_social_carousels")).toBe(
      "2026-07-18-social-carousels-v1",
    );
    expect(db.migrations.get("0027_managed_runtime_lifecycle")).toBe(
      "2026-07-18-managed-runtime-lifecycle-v2",
    );
    expect(db.migrations.get("0028_journal_entry_revision")).toBe(
      "2026-07-23-journal-entry-revision-v1",
    );
    expect(db.migrations.get("0029_social_media_delivery")).toBe(
      "2026-07-21-social-media-delivery-v1",
    );
    expect(db.migrations.get("0030_social_youtube_tiktok")).toBe(
      "2026-07-21-social-youtube-tiktok-v2",
    );
    expect(db.migrations.get("0031_social_publication_formats")).toBe(
      "2026-07-25-social-publication-formats-v1",
    );
    expect(db.migrations.get("0032_social_version_publishing_settings")).toBe(
      "2026-07-29-social-version-publishing-settings-v1",
    );
    expect(db.migrations.get("0033_manual_payments")).toBe(
      "2026-07-31-manual-payments-v1",
    );
    expect(db.migrations.get("0034_owner_onboarding")).toBe(
      "2026-07-31-owner-onboarding-v1",
    );
    expect(db.migrations.get("0035_calendar_source_event_dismissals")).toBe(
      "2026-08-18-calendar-source-event-dismissals-v1",
    );
    expect(db.migrations.get("0038_site_roles")).toBe(
      "2026-08-24-site-roles-v1",
    );
    expect(db.migrations.get("0040_remove_mission_task_review")).toBe(
      "2026-08-26-remove-mission-task-review-v1",
    );
    expect(db.migrations.get("0041_email_campaign_foundations")).toBe(
      "2026-08-26-email-campaign-foundations-v1",
    );
    expect(db.migrations.get("0042_email_campaign_assets")).toBe(
      "2026-08-26-email-campaign-assets-v1",
    );
    expect(db.migrations.get("0043_email_campaign_delivery")).toBe(
      "2026-08-26-email-campaign-delivery-v1",
    );
    expect(db.migrations.get("0044_site_branding")).toBe(
      "2026-08-27-site-branding-v1",
    );
    expect(db.migrations.get("0045_commerce_stripe_provider")).toBe(
      "2026-08-31-commerce-stripe-provider-v1",
    );
    expect(db.migrations.get("0046_business_site_profile_ownership")).toBe(
      "2026-08-31-business-site-profile-ownership-v1",
    );
    expect(db.migrations.get("0047_subscriber_double_opt_in")).toBe(
      "2026-09-03-subscriber-double-opt-in-v1",
    );
    expect(
      db.statements.some(
        (sql) => sql.includes("UPDATE mission_tasks") && sql.includes("status = 'backlog'") &&
          sql.includes("WHERE status = 'review'"),
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("social_accounts_0030_new") &&
          sql.includes("'youtube'") &&
          sql.includes("'tiktok'") &&
          !sql.includes("PRAGMA defer_foreign_keys"),
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("CREATE TABLE social_publications_0031_new") &&
          sql.includes("'image'") &&
          sql.includes("'short_video'"),
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("CREATE TABLE IF NOT EXISTS social_suggestions") &&
          sql.includes("'choosing'") &&
          sql.includes("choose_token") &&
          sql.includes("choosing_at") &&
          sql.includes("choose_platforms_json"),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        sql.includes("idx_mailbox_messages_mailbox_thread_activity"),
      ),
    ).toBe(true);
    expect(
      db.statements.some((sql) =>
        sql.includes("idx_social_publications_one_active_variant"),
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publications_one_active_variant") &&
          sql.includes("status IN ('queued', 'publishing')") &&
          !sql.includes("'published'")
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("CREATE TABLE social_publications_0023_new") &&
          sql.includes("body_text_snapshot") &&
          sql.includes("requested_by_type"),
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("idx_social_publications_same_time_scheduled") &&
          sql.includes("status = 'scheduled'"),
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("idx_social_publications_one_in_flight_variant") &&
          sql.includes("status IN ('queued', 'publishing')") &&
          !sql.includes("'published'"),
      ),
    ).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("INSERT OR IGNORE INTO social_packages") &&
          sql.includes("legacy_content_bank_read_only"),
      ),
    ).toBe(true);
  });

  it("records already-applied schema without repeating destructive operations", async () => {
    const db = new RuntimeMigrationDb({
      hasMissionTaskPinnedAt: true,
      hasCommerceDefaultCurrency: true,
      hasAiUsageEvents: true,
      hasFinancialEntryProjectId: true,
      hasSitePagesAndCommerce: true,
      hasJournalEntryRevision: true,
      hasSiteRole: true,
      hasCampaignFoundations: true,
      hasSubscriberDoubleOptIn: true,
    });

    await ensureCoreRuntimeMigrations({ DB: db as unknown as D1Database } as Env);

    expect(db.statements.some((sql) =>
      sql.includes("ALTER TABLE financial_entries") && sql.includes("ADD COLUMN project_id"),
    )).toBe(false);
    expect(db.migrations.has("0010_ai_usage_events")).toBe(true);
    expect(db.migrations.has("0011_financial_entry_projects")).toBe(true);
    expect(db.migrations.has("0028_journal_entry_revision")).toBe(true);
    expect(db.migrations.has("0038_site_roles")).toBe(true);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("ALTER TABLE subscribers") || sql.includes("ALTER TABLE bookings"),
      ),
    ).toBe(false);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("ALTER TABLE sites") && sql.includes("site_role"),
      ),
    ).toBe(false);
  });

  it("retries after a failed migration attempt", async () => {
    const db = new RuntimeMigrationDb({ failFinancialProjectAlterOnce: true });

    await expect(
      ensureCoreRuntimeMigrations({ DB: db as unknown as D1Database } as Env),
    ).rejects.toThrow("simulated alter failure");
    expect(db.migrations.has("0011_financial_entry_projects")).toBe(false);

    await ensureCoreRuntimeMigrations({ DB: db as unknown as D1Database } as Env);

    expect(db.columns.get("financial_entries")?.has("project_id")).toBe(true);
    expect(db.migrations.has("0011_financial_entry_projects")).toBe(true);
  });

  it("keeps going when another request already added the project column", async () => {
    const db = new RuntimeMigrationDb({ addFinancialProjectColumnBeforeAlterError: true });

    await ensureCoreRuntimeMigrations({ DB: db as unknown as D1Database } as Env);

    expect(db.statements.some((sql) => sql.includes("idx_financial_entries_project"))).toBe(
      true,
    );
    expect(db.migrations.has("0011_financial_entry_projects")).toBe(true);
  });
});

type RuntimeMigrationDbOptions = {
  hasMissionTaskPinnedAt?: boolean;
  hasCommerceDefaultCurrency?: boolean;
  hasAiUsageEvents?: boolean;
  hasFinancialEntryProjectId?: boolean;
  hasSitePagesAndCommerce?: boolean;
  hasJournalEntryRevision?: boolean;
  hasSiteRole?: boolean;
  hasCampaignFoundations?: boolean;
  hasSubscriberDoubleOptIn?: boolean;
  addFinancialProjectColumnBeforeAlterError?: boolean;
  failFinancialProjectAlterOnce?: boolean;
};

class RuntimeMigrationDb {
  readonly tables = new Set([
    "commerce_settings",
    "financial_entries",
    "journal_entries",
    "mission_tasks",
    "mailbox_messages",
    "owner_profile",
    "mission_projects",
    "content_bank_items",
    "social_packages",
    "social_accounts",
    "social_oauth_states",
    "social_provider_settings",
    "social_publication_events",
    "social_publications",
    "social_variants",
    "sites",
    "subscribers",
    "bookings",
    "calendar_sources",
  ]);
  readonly columns = new Map<string, Set<string>>([
    ["commerce_settings", new Set(["user_id", "encrypted_stripe_secret_key"])],
    [
      "financial_entries",
      new Set([
        "id",
        "user_id",
        "entry_type",
        "date",
        "description",
        "category_id",
        "amount_cents",
      ]),
    ],
    ["mission_tasks", new Set(["id", "user_id", "title", "status", "priority"])],
    ["mailbox_messages", new Set(["id", "mailbox_id", "message_kind"])],
    ["subscribers", new Set(["id", "site_id", "email"])],
    ["bookings", new Set(["id", "site_id", "guest_email"])],
    ["journal_entries", new Set(["id", "entry_date"])],
    [
      "sites",
      new Set([
        "id",
        "user_id",
        "username",
        "site_type",
        "template_id",
        "created_at",
      ]),
    ],
    [
      "social_packages",
      new Set([
        "id",
        "site_id",
        "post_slug",
        "post_title_snapshot",
        "source_hash",
        "goal",
        "status",
        "created_by",
        "created_at",
        "updated_at",
      ]),
    ],
    [
      "social_variants",
      new Set([
        "id",
        "package_id",
        "platform",
        "format",
        "body_text",
        "approval_status",
        "scheduled_for",
      ]),
    ],
    ["social_publications", new Set(["id", "format_snapshot"])],
  ]);
  readonly migrations = new Map<string, string>();
  readonly statements: string[] = [];
  addFinancialProjectColumnBeforeAlterError: boolean;
  failFinancialProjectAlterOnce: boolean;

  constructor(options: RuntimeMigrationDbOptions = {}) {
    if (options.hasMissionTaskPinnedAt) {
      this.columns.get("mission_tasks")?.add("pinned_at");
    }
    if (options.hasCommerceDefaultCurrency) {
      this.columns.get("commerce_settings")?.add("default_currency");
    }
    if (options.hasAiUsageEvents) this.tables.add("ai_usage_events");
    if (options.hasFinancialEntryProjectId) {
      this.columns.get("financial_entries")?.add("project_id");
    }
    if (options.hasSitePagesAndCommerce) {
      this.tables.add("site_pages");
      this.tables.add("site_page_revisions");
      this.tables.add("commerce_orders");
      for (const tableName of ["subscribers", "bookings"]) {
        this.columns.get(tableName)?.add("page_id");
        this.columns.get(tableName)?.add("action_id");
        this.columns.get(tableName)?.add("campaign");
      }
    }
    if (options.hasJournalEntryRevision) {
      this.columns.get("journal_entries")?.add("revision");
    }
    if (options.hasSiteRole) {
      this.columns.get("sites")?.add("site_role");
    }
    if (options.hasCampaignFoundations) {
      this.tables.add("email_campaigns");
      this.tables.add("email_campaign_revisions");
      this.tables.add("email_campaign_audience_snapshots");
      this.tables.add("email_campaign_audience_members");
      for (const column of [
        "marketing_status",
        "marketing_permission_method",
        "marketing_permission_granted_at",
        "marketing_permission_evidence_json",
        "delivery_status",
        "delivery_status_changed_at",
      ]) {
        this.columns.get("subscribers")?.add(column);
      }
    }
    if (options.hasSubscriberDoubleOptIn) {
      for (const column of [
        "confirmation_token_hash",
        "confirmation_expires_at",
        "confirmation_requested_at",
      ]) {
        this.columns.get("subscribers")?.add(column);
      }
    }
    this.addFinancialProjectColumnBeforeAlterError = Boolean(
      options.addFinancialProjectColumnBeforeAlterError,
    );
    this.failFinancialProjectAlterOnce = Boolean(options.failFinancialProjectAlterOnce);
  }

  prepare(sql: string) {
    return new RuntimeMigrationStatement(this, sql);
  }

  async batch(statements: RuntimeMigrationStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async exec(sql: string) {
    this.statements.push(sql);
    return { count: 1, duration: 0 };
  }
}

class RuntimeMigrationStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: RuntimeMigrationDb,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM sqlite_master")) {
      const tableName = this.values[0] as string;
      if (!this.db.tables.has(tableName)) return null as T | null;
      if (this.sql.includes("SELECT sql")) {
        return {
          sql: `CREATE TABLE ${tableName} (platform TEXT CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business')))`,
        } as T;
      }
      return { name: tableName } as T;
    }
    if (this.sql.includes("FROM core_runtime_migrations")) {
      const id = this.values[0] as string;
      const checksum = this.db.migrations.get(id);
      return (checksum ? { checksum } : null) as T | null;
    }
    return null as T | null;
  }

  async all<T>() {
    const tableName = this.sql.match(/PRAGMA table_info\(([^)]+)\)/)?.[1];
    if (tableName) {
      const columns = [...(this.db.columns.get(tableName) || [])].map((name) => ({ name }));
      return { results: columns as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    this.db.statements.push(this.sql);
    const createdTable = this.sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
    if (createdTable) {
      this.db.tables.add(createdTable);
      if (!this.db.columns.has(createdTable)) this.db.columns.set(createdTable, new Set());
      if (createdTable === "commerce_orders" && !this.db.columns.has(createdTable)) {
        this.db.columns.set(createdTable, new Set(["id", "site_id", "amount_paid"]));
      }
      if (
        createdTable === "managed_runtime_control_requests" &&
        this.sql.includes("expected_generation")
      ) {
        this.db.columns.set(createdTable, new Set(["expected_generation"]));
      }
    }
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS core_runtime_migrations")) {
      this.db.tables.add("core_runtime_migrations");
      return { success: true };
    }
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS ai_usage_events")) {
      this.db.tables.add("ai_usage_events");
      return { success: true };
    }
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS agent_turn_results")) {
      this.db.tables.add("agent_turn_results");
      return { success: true };
    }
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS agent_tool_executions")) {
      this.db.tables.add("agent_tool_executions");
      return { success: true };
    }
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS social_suggestions")) {
      this.db.tables.add("social_suggestions");
      return { success: true };
    }
    if (this.sql.includes("CREATE VIRTUAL TABLE IF NOT EXISTS owner_content_search")) {
      this.db.tables.add("owner_content_search");
      return { success: true };
    }
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS managed_email_inbound_deliveries")) {
      this.db.tables.add("managed_email_inbound_deliveries");
      return { success: true };
    }
    if (this.sql.includes("ALTER TABLE mission_tasks")) {
      const columns = this.db.columns.get("mission_tasks");
      if (columns?.has("pinned_at")) throw new Error("duplicate column name: pinned_at");
      columns?.add("pinned_at");
      return { success: true };
    }
    if (this.sql.includes("ALTER TABLE commerce_settings")) {
      const columns = this.db.columns.get("commerce_settings");
      const column = this.sql.includes("preferred_stripe_provider")
        ? "preferred_stripe_provider"
        : "default_currency";
      if (columns?.has(column)) {
        throw new Error(`duplicate column name: ${column}`);
      }
      columns?.add(column);
      return { success: true };
    }
    if (this.sql.includes("ALTER TABLE financial_entries")) {
      const column = this.sql.match(/ADD COLUMN (\w+)/)?.[1] || "project_id";
      if (column === "project_id" && this.db.failFinancialProjectAlterOnce) {
        this.db.failFinancialProjectAlterOnce = false;
        throw new Error("simulated alter failure");
      }
      if (column === "project_id" && this.db.addFinancialProjectColumnBeforeAlterError) {
        this.db.addFinancialProjectColumnBeforeAlterError = false;
        this.db.columns.get("financial_entries")?.add("project_id");
        throw new Error("duplicate column name: project_id");
      }
      const columns = this.db.columns.get("financial_entries");
      if (columns?.has(column)) throw new Error(`duplicate column name: ${column}`);
      columns?.add(column);
      return { success: true };
    }
    if (
      this.sql.includes("ALTER TABLE email_campaigns") ||
      this.sql.includes("ALTER TABLE mobile_push_preferences")
    ) {
      const match = this.sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
      if (!match) throw new Error("invalid accounts alter statement");
      const [, tableName, columnName] = match;
      const columns = this.db.columns.get(tableName || "") || new Set<string>();
      if (columns.has(columnName || "")) throw new Error(`duplicate column name: ${columnName}`);
      columns.add(columnName || "");
      this.db.columns.set(tableName || "", columns);
      return { success: true };
    }
    if (this.sql.includes("ALTER TABLE journal_entries")) {
      const columns = this.db.columns.get("journal_entries");
      if (columns?.has("revision")) throw new Error("duplicate column name: revision");
      columns?.add("revision");
      return { success: true };
    }
    if (this.sql.includes("ALTER TABLE sites")) {
      const columns = this.db.columns.get("sites");
      const column = this.sql.includes("profile_site_id")
        ? "profile_site_id"
        : "site_role";
      if (columns?.has(column)) throw new Error(`duplicate column name: ${column}`);
      columns?.add(column);
      return { success: true };
    }
    if (this.sql.includes("ALTER TABLE mailbox_messages")) {
      const columns = this.db.columns.get("mailbox_messages");
      if (columns?.has("agent_idempotency_key")) {
        throw new Error("duplicate column name: agent_idempotency_key");
      }
      columns?.add("agent_idempotency_key");
      return { success: true };
    }
    if (
      this.sql.includes("ALTER TABLE subscribers") ||
      this.sql.includes("ALTER TABLE bookings") ||
      this.sql.includes("ALTER TABLE commerce_orders")
    ) {
      const match = this.sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
      if (!match) throw new Error("invalid site commerce alter statement");
      const [, tableName, columnName] = match;
      const columns = this.db.columns.get(tableName || "");
      if (columns?.has(columnName || "")) {
        throw new Error(`duplicate column name: ${columnName}`);
      }
      columns?.add(columnName || "");
      return { success: true };
    }
    if (this.sql.includes("ALTER TABLE managed_runtime_control_requests")) {
      const columns = this.db.columns.get("managed_runtime_control_requests") || new Set();
      if (columns.has("expected_generation")) {
        throw new Error("duplicate column name: expected_generation");
      }
      columns.add("expected_generation");
      this.db.columns.set("managed_runtime_control_requests", columns);
      return { success: true };
    }
    if (
      this.sql.includes(" ADD COLUMN ") &&
      (this.sql.includes("ALTER TABLE social_packages") ||
        this.sql.includes("ALTER TABLE social_variants"))
    ) {
      const match = this.sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
      if (!match) throw new Error("invalid social alter statement");
      const [, tableName, columnName] = match;
      const columns = this.db.columns.get(tableName || "");
      if (columns?.has(columnName || "")) {
        throw new Error(`duplicate column name: ${columnName}`);
      }
      columns?.add(columnName || "");
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO core_runtime_migrations")) {
      this.db.migrations.set(this.values[0] as string, this.values[1] as string);
      return { success: true };
    }
    return { success: true };
  }
}

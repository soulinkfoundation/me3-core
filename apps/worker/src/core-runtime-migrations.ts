import { RETIRE_LEGACY_AUTOMATIONS_STATEMENTS } from "../migrations/0064_retire_legacy_automations";
import { MAILBOX_ATTACHMENT_STAGING_SQL } from "./mailbox-attachment-staging";
import { AGENT_SCHEMA_STATEMENTS } from "../../../packages/agent/src/store";
import { AGENT_IMAGE_SCHEMA_STATEMENTS } from "./agent-image-schema";
import { AGENT_PRESENTATION_SCHEMA_STATEMENTS } from "../../../packages/agent/src/presentations";
import { AGENT_NOTIFICATION_SCHEMA } from "./agent-notifications";
import { MORNING_CALENDAR_PUSH_SCHEMA } from "./morning-calendar-push";
import { QUOTES_SCHEMA } from "./quotes-schema";
import { QUOTE_BOOKMARKS_SCHEMA } from "./quote-bookmarks-schema";
import { GRATITUDE_SETTINGS_SCHEMA, CARD_REMINDERS_SCHEMA } from "./gratitude-schema";
import { HOME_LAYOUT_SCHEMA } from "./home-layout";
import { HOME_CARDS_SCHEMA } from "./home-cards";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA } from "./accounts-email-triage";
import { ACCOUNTS_REMOVALS_SCHEMA } from "./accounts";
import { AGENT_PAYMENTS_SCHEMA } from "./agent-payments";
import { AGENT_COMPUTER_SCHEMA } from "./agent-computer";
import { AGENT_COMMERCE_SCHEMA } from "./agent-commerce-store";
import { AGENT_NETWORK_COMMERCE_SCHEMA } from "./agent-network-commerce";
import { MAIL_TRIAGE_SCHEMA, MAILBOX_LOGIN_CODES_STATEMENTS, MAILBOX_MODEL_CALLS_SCHEMA, MAILBOX_SPAM_HANDLED_STATEMENTS, MAILBOX_SPAM_RULES_STATEMENTS } from "./mailbox-triage";
import { AI_USAGE_SETTLEMENTS_SCHEMA } from "./managed-ai-reconciliation";
import { MAILBOX_INSTRUCTION_REPLAY_STATEMENTS, MAILBOX_INSTRUCTIONS_SCHEMA } from "./mailbox-instructions";
import type { Env } from "./types";

type RuntimeMigration = {
  id: string;
  checksum: string;
  apply(db: D1Database): Promise<void>;
};

type MigrationRow = {
  id: string;
  checksum: string;
};

type SqliteNameRow = {
  name: string;
};

type SqliteDefinitionRow = {
  sql: string | null;
};

const MIGRATION_TABLE = "core_runtime_migrations";

const runtimeMigrations: RuntimeMigration[] = [
  {
    id: "0002_mission_task_pins",
    checksum: "2026-06-24-mission-task-pins-v1",
    apply: applyMissionTaskPinsMigration,
  },
  {
    id: "0009_commerce_default_currency",
    checksum: "2026-06-24-commerce-default-currency-v1",
    apply: applyCommerceDefaultCurrencyMigration,
  },
  {
    id: "0010_ai_usage_events",
    checksum: "2026-06-24-ai-usage-events-v1",
    apply: applyAiUsageEventsMigration,
  },
  {
    id: "0011_financial_entry_projects",
    checksum: "2026-06-24-financial-entry-projects-v1",
    apply: applyFinancialEntryProjectsMigration,
  },
  {
    id: "0012_drive_files",
    checksum: "2026-06-30-drive-files-v1",
    apply: applyDriveFilesMigration,
  },
  {
    id: "0014_mobile_pairing",
    checksum: "2026-07-06-mobile-pairing-v1",
    apply: applyMobilePairingMigration,
  },
  {
    id: "0015_agent_runtime_idempotency",
    checksum: "2026-07-09-agent-runtime-idempotency-v2",
    apply: applyAgentRuntimeIdempotencyMigration,
  },
  {
    id: "0016_social_content_packages",
    checksum: "2026-07-10-social-content-packages-v1",
    apply: applySocialContentPackagesMigration,
  },
  {
    id: "0017_site_pages_and_commerce",
    checksum: "2026-07-19-site-pages-and-commerce-v1",
    apply: applySitePagesAndCommerceMigration,
  },
  {
    id: "0018_social_publication_idempotency",
    checksum: "2026-07-10-social-publication-idempotency-v1",
    apply: applySocialPublicationIdempotencyMigration,
  },
  {
    id: "0019_owner_content_search",
    checksum: "2026-07-15-owner-content-search-v1",
    apply: applyOwnerContentSearchMigration,
  },
  {
    id: "0020_mailbox_thread_index",
    checksum: "2026-07-16-mailbox-thread-index-v1",
    apply: applyMailboxThreadIndexMigration,
  },
  {
    id: "0021_managed_email_inbound_deliveries",
    checksum: "2026-07-18-managed-email-inbound-deliveries-v1",
    apply: applyManagedEmailInboundDeliveriesMigration,
  },
  {
    id: "0022_social_posts_canonical",
    checksum: "2026-07-18-social-posts-canonical-v1",
    apply: applySocialPostsCanonicalMigration,
  },
  {
    id: "0023_social_publications_reusable",
    checksum: "2026-07-18-social-publications-reusable-v1",
    apply: applySocialPublicationsReusableMigration,
  },
  {
    id: "0024_social_suggestions",
    checksum: "2026-07-18-social-suggestions-v2",
    apply: applySocialSuggestionsMigration,
  },
  {
    id: "0025_social_posting_plans",
    checksum: "2026-07-18-social-posting-plans-v1",
    apply: applySocialPostingPlansMigration,
  },
  {
    id: "0026_social_carousels",
    checksum: "2026-07-18-social-carousels-v1",
    apply: applySocialCarouselsMigration,
  },
  {
    id: "0027_managed_runtime_lifecycle",
    checksum: "2026-07-18-managed-runtime-lifecycle-v2",
    apply: applyManagedRuntimeLifecycleMigration,
  },
  {
    id: "0028_journal_entry_revision",
    checksum: "2026-07-23-journal-entry-revision-v1",
    apply: applyJournalEntryRevisionMigration,
  },
  {
    id: "0029_social_media_delivery",
    checksum: "2026-07-21-social-media-delivery-v1",
    apply: applySocialMediaDeliveryMigration,
  },
  {
    id: "0030_social_youtube_tiktok",
    checksum: "2026-07-21-social-youtube-tiktok-v2",
    apply: applySocialYoutubeTikTokMigration,
  },
  {
    id: "0031_social_publication_formats",
    checksum: "2026-07-25-social-publication-formats-v1",
    apply: applySocialPublicationFormatsMigration,
  },
  {
    id: "0032_social_version_publishing_settings",
    checksum: "2026-07-29-social-version-publishing-settings-v1",
    apply: applySocialVersionPublishingSettingsMigration,
  },
  {
    id: "0033_manual_payments",
    checksum: "2026-07-31-manual-payments-v1",
    apply: applyManualPaymentsMigration,
  },
  {
    id: "0034_owner_onboarding",
    checksum: "2026-07-31-owner-onboarding-v1",
    apply: applyOwnerOnboardingMigration,
  },
  {
    id: "0035_calendar_source_event_dismissals",
    checksum: "2026-08-18-calendar-source-event-dismissals-v1",
    apply: applyCalendarSourceEventDismissalsMigration,
  },
  {
    id: "0036_calendar_push_notifications",
    checksum: "2026-08-19-calendar-push-notifications-v1",
    apply: applyCalendarPushNotificationsMigration,
  },
  {
    id: "0037_event_booking_capacity",
    checksum: "2026-08-21-event-booking-capacity-v1",
    apply: applyEventBookingCapacityMigration,
  },
  {
    id: "0038_site_roles",
    checksum: "2026-08-24-site-roles-v1",
    apply: applySiteRolesMigration,
  },
  {
    id: "0040_remove_mission_task_review",
    checksum: "2026-08-26-remove-mission-task-review-v1",
    apply: applyRemoveMissionTaskReviewMigration,
  },
  {
    id: "0041_email_campaign_foundations",
    checksum: "2026-08-26-email-campaign-foundations-v1",
    apply: applyEmailCampaignFoundationsMigration,
  },
  {
    id: "0042_email_campaign_assets",
    checksum: "2026-08-26-email-campaign-assets-v1",
    apply: applyEmailCampaignAssetsMigration,
  },
  {
    id: "0043_email_campaign_delivery",
    checksum: "2026-08-26-email-campaign-delivery-v1",
    apply: applyEmailCampaignDeliveryMigration,
  },
  {
    id: "0044_site_branding",
    checksum: "2026-08-27-site-branding-v1",
    apply: applySiteBrandingMigration,
  },
  {
    id: "0045_commerce_stripe_provider",
    checksum: "2026-08-31-commerce-stripe-provider-v1",
    apply: applyCommerceStripeProviderMigration,
  },
  {
    id: "0046_business_site_profile_ownership",
    checksum: "2026-08-31-business-site-profile-ownership-v1",
    apply: applyBusinessSiteProfileOwnershipMigration,
  },
  {
    id: "0047_subscriber_double_opt_in",
    checksum: "2026-09-03-subscriber-double-opt-in-v1",
    apply: applySubscriberDoubleOptInMigration,
  },
  {
    id: "0048_mailbox_attachment_staging",
    checksum: "2026-09-09-mailbox-attachment-staging-v1",
    async apply(db) { await db.prepare(MAILBOX_ATTACHMENT_STAGING_SQL).run(); },
  },
  {
    id: "0049_commerce_confirmation_delivery",
    checksum: "2026-09-11-commerce-confirmation-delivery-v1",
    async apply(db) {
      const existing = await columnExists(db, "commerce_orders", "confirmation_sent_at");
      await addColumnIfMissing(db, "commerce_orders", "delivery_json", "TEXT");
      await addColumnIfMissing(db, "commerce_orders", "fulfilled_at", "TEXT");
      await addColumnIfMissing(db, "commerce_orders", "confirmation_sent_at", "TEXT");
      await addColumnIfMissing(db, "commerce_orders", "payment_checked_at", "TEXT");
      if (!existing) await db.prepare("UPDATE commerce_orders SET confirmation_sent_at = COALESCE(paid_at, created_at) WHERE status = 'paid'").run();
    },
  },
  {
    id: "0050_accounts_customer_payments",
    checksum: "2026-09-11-accounts-customer-payments-v1",
    async apply(db) {
      const financialColumns: Array<[string, string]> = [
        ["gross_amount_cents", "INTEGER"],
        ["refunded_amount_cents", "INTEGER NOT NULL DEFAULT 0"],
        ["customer_name", "TEXT"],
        ["customer_email", "TEXT"],
        ["payment_intent_id", "TEXT"],
        ["site_id", "TEXT"],
        ["item_ref", "TEXT"],
        ["item_title", "TEXT"],
      ];
      for (const [column, declaration] of financialColumns) {
        await addColumnIfMissing(db, "financial_entries", column, declaration);
      }
      await db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_financial_entries_payment_intent
         ON financial_entries(user_id, payment_intent_id)`,
      ).run();
      await db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_financial_entries_customer_email
         ON financial_entries(user_id, customer_email)`,
      ).run();
      await addColumnIfMissing(
        db,
        "email_campaigns",
        "audience_filter_json",
        `TEXT NOT NULL DEFAULT '{"kind":"all"}'`,
      );
      await addColumnIfMissing(
        db,
        "mobile_push_preferences",
        "payment_notifications_enabled",
        "INTEGER NOT NULL DEFAULT 1",
      );
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS payment_push_dispatches (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source_kind TEXT NOT NULL CHECK (source_kind IN ('order', 'booking')),
          source_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, source_kind, source_id),
          FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
        )`,
      ).run();
    },
  },
  {
    id: "0051_owner_navigation_features",
    checksum: "2026-09-18-owner-navigation-features-v2",
    async apply(db) {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS owner_navigation_features (
          user_id TEXT NOT NULL,
          feature_id TEXT NOT NULL,
          visible INTEGER NOT NULL CHECK (visible IN (0, 1)),
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, feature_id),
          FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
        )`,
      ).run();
      // Preserve the complete navigation for every installation that exists
      // when this migration runs. Owners created afterwards use the quieter
      // first-run default until they opt into a workspace.
      // D1 limits compound SELECT statements to five terms. A VALUES CTE
      // keeps this seed compatible as the navigation grows beyond that limit.
      await db.prepare(
        `WITH features(feature_id) AS (
           VALUES
             ('assistant'),
             ('journal'),
             ('tasks'),
             ('email'),
             ('files'),
             ('social'),
             ('accounts')
         )
         INSERT OR IGNORE INTO owner_navigation_features (user_id, feature_id, visible)
         SELECT owner_profile.id, features.feature_id, 1
         FROM owner_profile
         CROSS JOIN features`,
      ).run();
    },
  },
  {
    id: "0052_owner_feature_discovery",
    checksum: "2026-09-17-owner-feature-discovery-v1",
    async apply(db) {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS owner_feature_discovery (
          user_id TEXT PRIMARY KEY,
          dismissed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
        )`,
      ).run();
      // Existing owners have already discovered the full navigation, so the
      // first-run prompt is reserved for installations created after release.
      await db.prepare(
        `INSERT OR IGNORE INTO owner_feature_discovery (user_id, dismissed_at)
         SELECT id, CURRENT_TIMESTAMP FROM owner_profile`,
      ).run();
    },
  },
  {
    id: "0053_booking_meeting",
    checksum: "2026-09-23-booking-meeting-v1",
    async apply(db) {
      await addColumnIfMissing(db, "bookings", "meeting_provider", "TEXT");
      await addColumnIfMissing(db, "bookings", "meeting_url", "TEXT");
      await addColumnIfMissing(db, "bookings", "meeting_host_url", "TEXT");
      await addColumnIfMissing(db, "bookings", "meeting_guest_token_hash", "TEXT");
      await addColumnIfMissing(db, "bookings", "meeting_title", "TEXT");
      await db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_bookings_soulink_upcoming
         ON bookings(site_id, starts_at) WHERE meeting_provider = 'soulink' AND status = 'confirmed'`,
      ).run();
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS site_booking_meetings (
          site_id TEXT NOT NULL,
          offer_id TEXT NOT NULL,
          meeting_url TEXT NOT NULL,
          PRIMARY KEY (site_id, offer_id),
          FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
        )`,
      ).run();
    },
  },
  {
    id: "0054_wheel_of_life_navigation",
    checksum: "2026-09-30-wheel-of-life-navigation-v1",
    async apply(db) {
      await db.prepare(
        `INSERT OR IGNORE INTO owner_navigation_features (user_id, feature_id, visible)
         SELECT user_id, 'wheel-of-life', 1 FROM mission_wheel_settings
         UNION
         SELECT user_id, 'wheel-of-life', 1 FROM mission_wheel_snapshots`,
      ).run();
    },
  },
  {
    id: "0055_calendar_agent_cancellation_approvals",
    checksum: "2026-10-01-calendar-agent-cancellation-approvals-v1",
    async apply(db) {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS calendar_agent_cancellation_approvals (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          event_title TEXT NOT NULL,
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          request_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'expired')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL DEFAULT (datetime('now', '+1 day')),
          completed_at TEXT,
          FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
        )`,
      ).run();
      await db.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_agent_pending_cancel
         ON calendar_agent_cancellation_approvals(user_id, event_id)
         WHERE status = 'pending'`,
      ).run();
    },
  },
  {
    id: "0056_journal_articles",
    checksum: "2026-10-02-journal-articles-v1",
    async apply(db) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS journal_articles (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT,
        body TEXT NOT NULL DEFAULT '', body_format TEXT NOT NULL DEFAULT 'html',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_journal_articles_owner_updated
        ON journal_articles(user_id, updated_at DESC)`).run();
    },
  },
  {
    id: "0057_assistant_primary_thread",
    checksum: "2026-10-07-assistant-primary-thread-v1",
    async apply(db) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS assistant_primary_threads (
        owner_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL UNIQUE REFERENCES assistant_threads(id) DEFERRABLE INITIALLY DEFERRED
      )`).run();
    },
  },
  {
    id: "0058_agent_turns",
    checksum: "2026-10-10-agent-turns-v3",
    async apply(db) {
      for (const sql of AGENT_SCHEMA_STATEMENTS) await db.prepare(sql).run();
    },
  },
  {
    id: "0059_agent_targets",
    checksum: "2026-10-10-agent-targets-v1",
    async apply(db) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS me3_agent_targets (
        owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, domain TEXT NOT NULL,
        record_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, read_turn_id TEXT NOT NULL,
        read_at TEXT NOT NULL, PRIMARY KEY (owner_id, thread_id, domain, record_id)
      )`).run();
      await db.prepare(`CREATE TABLE IF NOT EXISTS me3_agent_selections (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL,
        domain TEXT NOT NULL, candidates_json TEXT NOT NULL, read_turn_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS me3_agent_selections_scope
        ON me3_agent_selections(owner_id, thread_id, domain, created_at DESC)`).run();
    },
  },
  {
    id: "0060_mission_goal_links",
    checksum: "2026-10-10-mission-goal-links-v1",
    async apply(db) {
      await addColumnIfMissing(db, "mission_tasks", "goal_id", "TEXT");
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_mission_tasks_goal ON mission_tasks(user_id, goal_id)").run();
    },
  },
  {
    id: "0061_agent_image_operations",
    checksum: "2026-10-10-agent-image-operations-v1",
    async apply(db) {
      for (const sql of AGENT_IMAGE_SCHEMA_STATEMENTS) await db.prepare(sql).run();
    },
  },
  {
    id: "0062_agent_notifications",
    checksum: "2026-10-11-agent-notifications-v1",
    async apply(db) {
      await addColumnIfMissing(db, "mobile_push_preferences", "agent_notifications_enabled", "INTEGER NOT NULL DEFAULT 1");
      for (const sql of AGENT_NOTIFICATION_SCHEMA) await db.prepare(sql).run();
    },
  },
  {
    id: "0063_agent_presentations",
    checksum: "2026-10-11-agent-presentations-v1",
    async apply(db) {
      for (const sql of AGENT_PRESENTATION_SCHEMA_STATEMENTS) await db.prepare(sql).run();
    },
  },
  {
    id: "0064_retire_legacy_automations",
    checksum: "2026-10-11-retire-legacy-automations-v1",
    async apply(db) {
      if (await columnExists(db, "sites", "booking_reminders_enabled")) return;
      await db.batch([
        db.prepare("ALTER TABLE sites ADD COLUMN booking_reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (booking_reminders_enabled IN (0, 1))"),
        ...RETIRE_LEGACY_AUTOMATIONS_STATEMENTS.map(sql => db.prepare(sql)),
      ]);
    },
  },
  {
    id: "0065_morning_calendar_push",
    checksum: "2026-10-13-morning-calendar-push-v1",
    async apply(db) {
      await addColumnIfMissing(db, "owner_profile", "daily_briefing_time", "TEXT NOT NULL DEFAULT '07:30'");
      for (const sql of MORNING_CALENDAR_PUSH_SCHEMA) await db.prepare(sql).run();
    },
  },
  {
    id: "0066_accounts_email_triage",
    checksum: "2026-10-13-accounts-email-triage-v1",
    async apply(db) {
      for (const sql of ACCOUNTS_EMAIL_TRIAGE_SCHEMA) await db.prepare(sql).run();
    },
  },
  {
    id: "0067_quotes",
    checksum: "2026-10-13-quotes-v1",
    async apply(db) {
      await db.batch(QUOTES_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  {
    id: "0068_gratitude",
    checksum: "2026-10-13-gratitude-v1",
    async apply(db) {
      const table = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_reminders'").first<{ sql: string }>();
      await db.batch([...GRATITUDE_SETTINGS_SCHEMA, ...(!table?.sql.includes("'card'") ? CARD_REMINDERS_SCHEMA : [])].map(sql => db.prepare(sql)));
    },
  },
  {
    id: "0069_quote_bookmarks",
    checksum: "2026-10-13-quote-bookmarks-v1",
    async apply(db) {
      await db.batch(QUOTE_BOOKMARKS_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Gratitude as a section of the Home Today card; off until the owner switches it on.
  {
    id: "0070_gratitude_in_today",
    checksum: "2026-10-14-gratitude-in-today-v1",
    async apply(db) {
      await db.batch(GRATITUDE_SETTINGS_SCHEMA.map(sql => db.prepare(sql)));
      if (await tableExists(db, "gratitude_settings")) await addColumnIfMissing(db, "gratitude_settings", "in_today", "INTEGER NOT NULL DEFAULT 0 CHECK (in_today IN (0, 1))");
    },
  },
  // One Home card layout per install so web and the mobile apps match.
  {
    id: "0071_home_layout",
    checksum: "2026-10-17-home-layout-v1",
    async apply(db) {
      await db.batch(HOME_LAYOUT_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Agent-first Email: triage records, the handled log, owner rules and sender avatars.
  {
    id: "0072_mailbox_triage",
    checksum: "2026-10-17-mailbox-triage-v1",
    async apply(db) {
      await db.batch(MAIL_TRIAGE_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Agent payments: immutable proposals, fresh-sign-in approvals, receipts, limits and audit.
  {
    id: "0073_agent_payments",
    checksum: "2026-10-17-agent-payments-v1",
    async apply(db) {
      await db.batch(AGENT_PAYMENTS_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Accounts removals: deleted synced entries and removed customers stay removed.
  {
    id: "0074_accounts_removals",
    checksum: "2026-10-17-accounts-removals-v1",
    async apply(db) {
      await db.batch(ACCOUNTS_REMOVALS_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Agent computer: background browser jobs, steps, screenshot artifacts and owner limits.
  {
    id: "0075_agent_computer",
    checksum: "2026-10-17-agent-computer-v1",
    async apply(db) {
      await db.batch(AGENT_COMPUTER_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Agent commerce: seller checkouts for buying agents, their rate limits and the owner switch.
  {
    id: "0076_agent_commerce",
    checksum: "2026-10-17-agent-commerce-v1",
    async apply(db) {
      await db.batch(AGENT_COMMERCE_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Network commerce, buyer side: seller receipts and the seller checkout of each network purchase.
  {
    id: "0077_agent_network_purchases",
    checksum: "2026-10-18-agent-network-purchases-v1",
    async apply(db) {
      await db.batch(AGENT_NETWORK_COMMERCE_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Custom Home cards built by ME3: spec, linear versions and day-keyed entries.
  {
    id: "0078_home_cards",
    checksum: "2026-10-17-home-cards-v1",
    async apply(db) {
      await db.batch(HOME_CARDS_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Owner's choice for the "Create your own ME3 site" badge; NULL follows the install default.
  {
    id: "0079_site_badge",
    checksum: "2026-10-19-site-badge-v1",
    async apply(db) {
      await addColumnIfMissing(db, "owner_profile", "site_badge", "TEXT CHECK (site_badge IN ('shown', 'hidden'))");
    },
  },
  // The handled log learns "login_code" (sign-in codes archived once past use) and "instruction"
  // (the owner's own email, which ME3 acts on); mailbox_instructions links those emails to chat turns.
  {
    id: "0080_mailbox_login_codes",
    checksum: "2026-10-20-mailbox-login-codes-v2",
    async apply(db) {
      const table = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mailbox_handled_actions'").first<SqliteDefinitionRow>();
      if (!table?.sql) {
        await db.batch(MAIL_TRIAGE_SCHEMA.map(sql => db.prepare(sql)));
        return;
      }
      if (!table.sql.includes("'instruction'")) await db.batch(MAILBOX_LOGIN_CODES_STATEMENTS.map(sql => db.prepare(sql)));
      await db.batch(MAILBOX_INSTRUCTIONS_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Automatic agent memory: importance decides what reaches the agent, and time-bound facts lapse.
  {
    id: "0081_private_memory_importance",
    checksum: "2026-10-20-private-memory-importance-v1",
    async apply(db) {
      // Memory belongs to Mission Control; an install without its table has nothing to upgrade.
      if (!(await tableExists(db, "mission_private_memory"))) return;
      await addColumnIfMissing(db, "mission_private_memory", "importance", "INTEGER NOT NULL DEFAULT 3");
      await addColumnIfMissing(db, "mission_private_memory", "expires_at", "TEXT");
    },
  },
  // Set when the owner declines or forgets a memory, so automatic memory never learns it again.
  {
    id: "0082_private_memory_forgotten",
    checksum: "2026-10-20-private-memory-forgotten-v1",
    async apply(db) {
      if (!(await tableExists(db, "mission_private_memory"))) return;
      await addColumnIfMissing(db, "mission_private_memory", "forgotten_at", "TEXT");
    },
  },
  // Spam: filtered mail waits in Trash with spam_at set; rules learn spam_sender / spam_domain and
  // the handled log learns "spam". mailbox_messages itself is never rebuilt (its children cascade).
  {
    id: "0083_mailbox_spam",
    checksum: "2026-10-21-mailbox-spam-v1",
    async apply(db) {
      // An install without a mailbox yet gets the spam-aware schema when mail is first set up.
      if (!(await tableExists(db, "mailbox_messages"))) return;
      await addColumnIfMissing(db, "mailbox_messages", "spam_at", "TEXT");
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_mailbox_messages_spam ON mailbox_messages(mailbox_id, spam_at) WHERE spam_at IS NOT NULL").run();
      const definition = (name: string) =>
        db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first<SqliteDefinitionRow>();
      const rules = await definition("mailbox_rules");
      if (!rules?.sql) {
        await db.batch(MAIL_TRIAGE_SCHEMA.map(sql => db.prepare(sql)));
        return;
      }
      if (!rules.sql.includes("'spam_sender'")) await db.batch(MAILBOX_SPAM_RULES_STATEMENTS.map(sql => db.prepare(sql)));
      const handled = await definition("mailbox_handled_actions");
      if (handled?.sql && !handled.sql.includes("'spam'")) await db.batch(MAILBOX_SPAM_HANDLED_STATEMENTS.map(sql => db.prepare(sql)));
    },
  },
  // Mail triage model calls, capped per owner and per sender so strangers' mail cannot run up AI spend.
  {
    id: "0084_mailbox_model_calls",
    checksum: "2026-10-22-mailbox-model-calls-v1",
    async apply(db) {
      // An install without triage yet gets this table with the rest of the triage schema.
      if (!(await tableExists(db, "mailbox_triage"))) return;
      await db.batch(MAILBOX_MODEL_CALLS_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  // Owner email replay: each request records its DKIM signature, and one signature starts one request.
  {
    id: "0085_mailbox_instruction_replay",
    checksum: "2026-10-22-mailbox-instruction-replay-v1",
    async apply(db) {
      if (!(await tableExists(db, "mailbox_instructions"))) return;
      await addColumnIfMissing(db, "mailbox_instructions", "signature_key", "TEXT");
      await db.batch(MAILBOX_INSTRUCTION_REPLAY_STATEMENTS.map(sql => db.prepare(sql)));
    },
  },
  // Owner credential generation: password changes retire older sessions, phone tokens and ME3 claims.
  {
    id: "0086_owner_credential_generation",
    checksum: "2026-10-22-owner-credential-generation-v1",
    async apply(db) {
      if (await tableExists(db, "mobile_refresh_tokens")) {
        await addColumnIfMissing(db, "mobile_refresh_tokens", "credential_generation", "TEXT");
      }
      if (await tableExists(db, "me3_install_claim_states")) {
        await addColumnIfMissing(db, "me3_install_claim_states", "initiated_by", "TEXT NOT NULL DEFAULT 'anonymous'");
        await addColumnIfMissing(db, "me3_install_claim_states", "credential_generation", "TEXT");
      }
    },
  },
  // Append-only gateway evidence that priced managed agent receipts left unpriced by an interrupted call.
  {
    id: "0087_ai_usage_settlements",
    checksum: "2026-10-22-ai-usage-settlements-v1",
    async apply(db) {
      if (await tableExists(db, "ai_usage_settlements")) return;
      await db.batch(AI_USAGE_SETTLEMENTS_SCHEMA.map(sql => db.prepare(sql)));
    },
  },
  {
    id: "0088_drive_files_reuse_trashed_names",
    checksum: "2026-10-23-drive-files-reuse-trashed-names-v1",
    apply: applyDriveFilesReuseTrashedNamesMigration,
  },
  // A note (journal article) can belong to one project.
  {
    id: "0089_journal_article_projects",
    checksum: "2026-10-23-journal-article-projects-v1",
    async apply(db) {
      if (!(await tableExists(db, "journal_articles"))) return;
      await addColumnIfMissing(db, "journal_articles", "project_id", "TEXT");
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_journal_articles_owner_project
        ON journal_articles(user_id, project_id, updated_at DESC)`).run();
    },
  },
  // Facebook Pages join the checked social platform lists (me3-bli3.3.9).
  {
    id: "0090_social_facebook_pages",
    checksum: "2026-10-23-social-facebook-pages-v1",
    apply: applySocialFacebookPagesMigration,
  },
  // A campaign records the owner's approval of the exact revision and count it sends (me3-bli3.2.4).
  {
    id: "0091_email_campaign_approvals",
    checksum: "2026-10-24-email-campaign-approvals-v1",
    async apply(db) {
      if (!(await tableExists(db, "email_campaigns"))) return;
      await addColumnIfMissing(db, "email_campaigns", "approved_revision_id", "TEXT");
      await addColumnIfMissing(db, "email_campaigns", "approved_at", "TEXT");
      await addColumnIfMissing(db, "email_campaigns", "approved_recipient_count", "INTEGER");
    },
  },
  // A site remembers the postal address its campaigns show in the footer (me3-bli3.2.14).
  {
    id: "0092_campaign_mailing_address",
    checksum: "2026-10-26-campaign-mailing-address-v1",
    async apply(db) {
      if (!(await tableExists(db, "sites"))) return;
      await addColumnIfMissing(db, "sites", "campaign_mailing_address", "TEXT");
    },
  },
];

let migrationPromise: Promise<void> | null = null;

export async function ensureCoreRuntimeMigrations(env: Env): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runCoreRuntimeMigrations(env).catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  return migrationPromise;
}

export async function ensureCoreRuntimeMigrationsForRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  try {
    await ensureCoreRuntimeMigrations(env);
    return null;
  } catch (error) {
    console.error("ME3 runtime migration failed", error);
    const isApiRequest =
      new URL(request.url).pathname.startsWith("/api/") ||
      request.headers.get("accept")?.includes("application/json");
    if (isApiRequest) {
      return Response.json(
        {
          ok: false,
          error: "ME3 is finishing a database update. Refresh in a moment to retry.",
        },
        { status: 503 },
      );
    }
    return new Response("ME3 is finishing a database update. Refresh in a moment to retry.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

export function resetCoreRuntimeMigrationsForTest() {
  migrationPromise = null;
}

async function runCoreRuntimeMigrations(env: Env): Promise<void> {
  await ensureMigrationTable(env.DB);
  const { results } = await env.DB
    .prepare(`SELECT id, checksum FROM ${MIGRATION_TABLE}`)
    .all<MigrationRow>();
  const appliedChecksums = new Map(results.map((row) => [row.id, row.checksum]));
  for (const migration of runtimeMigrations) {
    if (appliedChecksums.get(migration.id) === migration.checksum) continue;
    await runMigration(env.DB, migration);
  }
}

async function ensureMigrationTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
}

async function runMigration(db: D1Database, migration: RuntimeMigration): Promise<void> {
  await migration.apply(db);
  await db
    .prepare(
      `INSERT INTO ${MIGRATION_TABLE} (id, checksum, applied_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         checksum = excluded.checksum,
         applied_at = CURRENT_TIMESTAMP`,
    )
    .bind(migration.id, migration.checksum)
    .run();
}

async function applyMissionTaskPinsMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "mission_tasks"))) {
    throw new Error("Cannot apply 0002_mission_task_pins: mission_tasks is missing");
  }

  if (!(await columnExists(db, "mission_tasks", "pinned_at"))) {
    try {
      await db.prepare("ALTER TABLE mission_tasks ADD COLUMN pinned_at TEXT").run();
    } catch (error) {
      if (!(await columnExists(db, "mission_tasks", "pinned_at"))) throw error;
    }
  }
}

async function applyRemoveMissionTaskReviewMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "mission_tasks"))) {
    throw new Error("Cannot apply 0040_remove_mission_task_review: mission_tasks is missing");
  }

  const hasProjectColumns = await tableExists(db, "mission_project_columns");
  const hasTaskColumnId = await columnExists(db, "mission_tasks", "column_id");
  if (hasProjectColumns && hasTaskColumnId) {
    await db.prepare(
      `UPDATE mission_tasks
       SET status = 'backlog',
           column_id = COALESCE(
             (
               SELECT c.id
               FROM mission_project_columns c
               WHERE c.project_id = mission_tasks.project_id
                 AND c.user_id = mission_tasks.user_id
                 AND c.status = 'backlog'
                 AND c.archived_at IS NULL
               ORDER BY c.position ASC, c.id ASC
               LIMIT 1
             ),
             CASE
               WHEN project_id IS NOT NULL THEN project_id || ':backlog'
               ELSE NULL
             END
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE status = 'review'`,
    ).run();
  } else {
    await db.prepare(
      `UPDATE mission_tasks
       SET status = 'backlog', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'review'`,
    ).run();
  }

  if (hasProjectColumns) {
    await db.prepare("DELETE FROM mission_project_columns WHERE status = 'review'").run();
    await db.prepare(
      `UPDATE mission_project_columns
       SET position = 2, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'done'`,
    ).run();
  }
}

async function applyCommerceDefaultCurrencyMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "commerce_settings"))) {
    throw new Error("Cannot apply 0009_commerce_default_currency: commerce_settings is missing");
  }

  if (!(await columnExists(db, "commerce_settings", "default_currency"))) {
    try {
      await db
        .prepare("ALTER TABLE commerce_settings ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'USD'")
        .run();
    } catch (error) {
      if (!(await columnExists(db, "commerce_settings", "default_currency"))) throw error;
    }
  }
}

async function applyCommerceStripeProviderMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "commerce_settings"))) {
    throw new Error("Cannot apply 0045_commerce_stripe_provider: commerce_settings is missing");
  }

  if (!(await columnExists(db, "commerce_settings", "preferred_stripe_provider"))) {
    try {
      await db.prepare(
        `ALTER TABLE commerce_settings
         ADD COLUMN preferred_stripe_provider TEXT NOT NULL DEFAULT 'auto'
           CHECK (preferred_stripe_provider IN ('auto', 'direct', 'managed'))`,
      ).run();
    } catch (error) {
      if (!(await columnExists(db, "commerce_settings", "preferred_stripe_provider"))) {
        throw error;
      }
    }
  }
}

async function applyAiUsageEventsMigration(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ai_usage_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'gateway')),
        kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1,
        successful_request_count INTEGER NOT NULL DEFAULT 1,
        failed_request_count INTEGER NOT NULL DEFAULT 0,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_created
       ON ai_usage_events(user_id, created_at DESC)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_kind_created
       ON ai_usage_events(user_id, kind, created_at DESC)`,
    )
    .run();
}

async function applyFinancialEntryProjectsMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "financial_entries"))) {
    throw new Error("Cannot apply 0011_financial_entry_projects: financial_entries is missing");
  }

  if (!(await columnExists(db, "financial_entries", "project_id"))) {
    try {
      await db
        .prepare(
          "ALTER TABLE financial_entries ADD COLUMN project_id TEXT REFERENCES mission_projects(id) ON DELETE SET NULL",
        )
        .run();
    } catch (error) {
      if (!(await columnExists(db, "financial_entries", "project_id"))) throw error;
    }
  }

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_financial_entries_project
       ON financial_entries(user_id, project_id)`,
    )
    .run();
}

async function applyDriveFilesMigration(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS drive_folders (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'owner',
        parent_id TEXT REFERENCES drive_folders(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trashed')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
        UNIQUE(owner_id, parent_id, name)
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS drive_files (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'owner',
        folder_id TEXT REFERENCES drive_folders(id) ON DELETE SET NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size INTEGER NOT NULL DEFAULT 0,
        storage_key TEXT NOT NULL,
        etag TEXT,
        sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'ready'
          CHECK (status IN ('uploading', 'ready', 'trashed', 'failed')),
        preview_kind TEXT NOT NULL DEFAULT 'download'
          CHECK (preview_kind IN ('image', 'pdf', 'text', 'markdown', 'csv', 'spreadsheet', 'download')),
        extracted_text TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
        UNIQUE(owner_id, folder_id, filename)
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_folders_root_name
       ON drive_folders(owner_id, name)
       WHERE parent_id IS NULL AND status = 'active'`,
    )
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_files_root_filename
       ON drive_files(owner_id, filename)
       WHERE folder_id IS NULL AND status = 'ready'`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_drive_folders_owner_parent
       ON drive_folders(owner_id, parent_id, status, name)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_drive_folders_owner_path
       ON drive_folders(owner_id, path)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_drive_files_owner_folder
       ON drive_files(owner_id, folder_id, status, filename)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_drive_files_owner_updated
       ON drive_files(owner_id, updated_at DESC)`,
    )
    .run();
}

async function applyMobilePairingMigration(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS mobile_pairings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'ios',
        app_version TEXT,
        code_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'claimed', 'expired', 'revoked')),
        expires_at TEXT NOT NULL,
        approved_at TEXT,
        claimed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_mobile_pairings_user_status
       ON mobile_pairings(user_id, status, created_at DESC)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_mobile_pairings_expires
       ON mobile_pairings(expires_at)`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS mobile_refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'ios',
        app_version TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'rotated', 'revoked')),
        scope_json TEXT NOT NULL DEFAULT '[]',
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_mobile_refresh_tokens_user_device
       ON mobile_refresh_tokens(user_id, device_id, status)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_mobile_refresh_tokens_expires
       ON mobile_refresh_tokens(expires_at)`,
    )
    .run();
}

async function applyAgentRuntimeIdempotencyMigration(
  db: D1Database,
): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS agent_turn_results (
        user_id TEXT NOT NULL DEFAULT 'owner',
        request_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, request_id),
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_agent_turn_results_user_updated
       ON agent_turn_results(user_id, updated_at DESC)`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS agent_tool_executions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        request_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running'
          CHECK (status IN ('running', 'succeeded', 'failed')),
        result_json TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, request_id, tool_call_id),
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_request
       ON agent_tool_executions(user_id, request_id, created_at)`,
    )
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reminders_agent_dispatch
       ON user_reminders(user_id, source_dispatch_id)
       WHERE source_dispatch_id IS NOT NULL`,
    )
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_tasks_agent_source
       ON mission_tasks(user_id, source_kind, source_ref)
       WHERE source_kind = 'agent' AND source_ref IS NOT NULL`,
    )
    .run();
  if (!(await columnExists(db, "mailbox_messages", "agent_idempotency_key"))) {
    try {
      await db
        .prepare(
          "ALTER TABLE mailbox_messages ADD COLUMN agent_idempotency_key TEXT",
        )
        .run();
    } catch (error) {
      if (!(await columnExists(db, "mailbox_messages", "agent_idempotency_key"))) {
        throw error;
      }
    }
  }
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_drafts_agent_idempotency
       ON mailbox_messages(mailbox_id, agent_idempotency_key)
       WHERE message_kind = 'draft' AND agent_idempotency_key IS NOT NULL`,
    )
    .run();
}

async function applyMailboxThreadIndexMigration(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_messages_mailbox_thread_activity
       ON mailbox_messages(
         mailbox_id,
         thread_key,
         COALESCE(sent_at, received_at, approved_at, created_at) DESC,
         id DESC
       )`,
    )
    .run();
}

async function applyManagedEmailInboundDeliveriesMigration(
  db: D1Database,
): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS managed_email_inbound_deliveries (
        delivery_id TEXT PRIMARY KEY,
        managed_installation_id TEXT NOT NULL,
        core_install_id TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        mailbox_message_id TEXT NOT NULL UNIQUE,
        recipient TEXT NOT NULL,
        body_sha256 TEXT NOT NULL,
        received_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mailbox_id) REFERENCES mailbox_aliases(id) ON DELETE CASCADE,
        FOREIGN KEY (mailbox_message_id) REFERENCES mailbox_messages(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_managed_email_inbound_install_received
       ON managed_email_inbound_deliveries(managed_installation_id, received_at DESC)`,
    )
    .run();
}

async function applySocialContentPackagesMigration(db: D1Database): Promise<void> {
  await addColumnIfMissing(
    db,
    "social_packages",
    "source_type",
    "TEXT NOT NULL DEFAULT 'site'",
  );
  await addColumnIfMissing(db, "social_packages", "source_ref", "TEXT");
  await addColumnIfMissing(
    db,
    "social_packages",
    "source_snapshot",
    "TEXT NOT NULL DEFAULT ''",
  );
  await addColumnIfMissing(
    db,
    "social_packages",
    "idea_text",
    "TEXT NOT NULL DEFAULT ''",
  );
  await addColumnIfMissing(db, "social_variants", "target_account_id", "TEXT");
  await addColumnIfMissing(db, "social_variants", "approved_at", "TEXT");
  await addColumnIfMissing(db, "social_variants", "approved_by_user_id", "TEXT");

  await db
    .prepare(
      `UPDATE social_packages
       SET source_ref = COALESCE(source_ref, 'post:' || post_slug),
           source_snapshot = CASE
             WHEN source_snapshot = '' THEN post_title_snapshot
             ELSE source_snapshot
           END,
           idea_text = CASE
             WHEN idea_text = '' THEN post_title_snapshot
             ELSE idea_text
           END`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_social_packages_source
       ON social_packages(site_id, source_type, source_ref)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_social_variants_target_account
       ON social_variants(target_account_id, approval_status, scheduled_for)`,
    )
    .run();
}

async function applySitePagesAndCommerceMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "sites"))) {
    throw new Error("Cannot apply 0017_site_pages_and_commerce: sites is missing");
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS site_pages (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'landing_page'
          CHECK (kind IN ('landing_page', 'standard')),
        title TEXT NOT NULL,
        template_id TEXT,
        draft_json TEXT NOT NULL,
        published_revision_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT,
        UNIQUE (site_id, slug),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS site_page_revisions (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        rendered_html TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (page_id) REFERENCES site_pages(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_site_pages_site_updated
       ON site_pages(site_id, updated_at DESC)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_site_page_revisions_page_created
       ON site_page_revisions(page_id, created_at DESC)`,
    )
    .run();

  for (const tableName of ["subscribers", "bookings"]) {
    await addColumnIfMissing(db, tableName, "page_id", "TEXT");
    await addColumnIfMissing(db, tableName, "action_id", "TEXT");
    await addColumnIfMissing(db, tableName, "campaign", "TEXT");
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS commerce_orders (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        page_id TEXT,
        action_id TEXT,
        campaign TEXT,
        product_slug TEXT NOT NULL,
        product_title TEXT NOT NULL,
        buyer_name TEXT NOT NULL,
        buyer_email TEXT NOT NULL,
        buyer_note TEXT,
        amount_paid INTEGER,
        currency TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
        provider TEXT NOT NULL DEFAULT 'stripe_direct'
          CHECK (provider IN ('stripe_direct', 'me3_cloud')),
        checkout_session_id TEXT UNIQUE,
        payment_intent_id TEXT UNIQUE,
        paid_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_commerce_orders_site_created
       ON commerce_orders(site_id, created_at DESC)`,
    )
    .run();
}

async function applySocialPublicationIdempotencyMigration(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publications_one_active_variant
       ON social_publications(variant_id)
       WHERE variant_id LIKE 'social-variant-%'
         AND status IN ('queued', 'publishing', 'published')`,
    )
    .run();
}

async function applySocialPostsCanonicalMigration(db: D1Database): Promise<void> {
  for (const tableName of [
    "content_bank_items",
    "social_packages",
    "social_variants",
    "social_publications",
    "social_publication_events",
  ]) {
    if (!(await tableExists(db, tableName))) {
      throw new Error(`Cannot apply 0022_social_posts_canonical: ${tableName} is missing`);
    }
  }

  await addColumnIfMissing(
    db,
    "social_packages",
    "source_text",
    "TEXT NOT NULL DEFAULT ''",
  );

  const statements = [
    `UPDATE social_packages
     SET source_type = 'legacy_content_bank_read_only'
     WHERE source_type = 'original'`,
    `UPDATE social_packages
     SET source_text = source_snapshot
     WHERE source_text = '' AND source_snapshot <> ''`,
    `INSERT OR IGNORE INTO social_packages (
       id, site_id, post_slug, post_title_snapshot, source_hash, goal, status,
       created_by, created_at, updated_at, source_type, source_ref,
       source_snapshot, source_text, idea_text
     )
     SELECT
       'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB))),
       item.site_id,
       '_legacy-content-bank-' || lower(hex(CAST(item.id AS BLOB))),
       substr(item.body, 1, 120),
       'legacy-content-bank-' || lower(hex(CAST(item.id AS BLOB))),
       NULL,
       CASE item.status
         WHEN 'bank' THEN 'draft'
         WHEN 'posted' THEN 'published'
         WHEN 'failed' THEN 'failed'
         WHEN 'archived' THEN 'archived'
         ELSE 'ready'
       END,
       CASE item.created_by WHEN 'agent_suggested' THEN 'agent' ELSE 'user' END,
       item.created_at,
       item.updated_at,
       'legacy_content_bank_read_only',
       'content-bank:' || item.id,
       item.body,
       item.body,
       item.body
     FROM content_bank_items AS item`,
    `INSERT OR IGNORE INTO social_variants (
       id, package_id, platform, format, title, body_text, first_comment,
       hashtags_json, asset_manifest_json, source_excerpt, approval_status,
       scheduled_for, timezone, published_variant_id, agent_notes, created_at,
       updated_at, target_account_id, approved_at, approved_by_user_id
     )
     SELECT DISTINCT
       'social-variant-legacy-' || lower(hex(CAST(item.id AS BLOB))) || '-' ||
         lower(trim(CAST(platform.value AS TEXT))),
       'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB))),
       lower(trim(CAST(platform.value AS TEXT))),
       'post',
       NULL,
       item.body,
       NULL,
       '[]',
       item.media_manifest_json,
       NULL,
       CASE WHEN item.approved_by_human = 1 THEN 'approved' ELSE 'draft' END,
       CASE
         WHEN lower(trim(CAST(platform.value AS TEXT))) = 'linkedin'
           THEN item.scheduled_for
         ELSE NULL
       END,
       CASE
         WHEN lower(trim(CAST(platform.value AS TEXT))) = 'linkedin'
           THEN item.timezone
         ELSE NULL
       END,
       NULL,
       item.notes,
       item.created_at,
       item.updated_at,
       NULL,
       NULL,
       CASE WHEN item.approved_by_human = 1 THEN item.user_id ELSE NULL END
     FROM content_bank_items AS item
     JOIN json_each(
       CASE
         WHEN json_valid(item.platforms_json) AND json_type(item.platforms_json) = 'array'
           THEN item.platforms_json
         ELSE '[]'
       END
     ) AS platform
     WHERE platform.type = 'text'
       AND lower(trim(CAST(platform.value AS TEXT))) IN (
         'x', 'linkedin', 'instagram', 'instagram_business'
       )`,
    "DROP INDEX IF EXISTS idx_social_publications_one_active_variant",
    `UPDATE social_publications
     SET variant_id = (
       SELECT version.id
       FROM content_bank_items AS item
       JOIN social_variants AS version
         ON version.package_id =
           'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB)))
        AND version.platform = lower(trim(social_publications.platform))
       WHERE item.id = social_publications.variant_id
       LIMIT 1
     )
     WHERE EXISTS (
       SELECT 1
       FROM content_bank_items AS item
       JOIN social_variants AS version
         ON version.package_id =
           'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB)))
        AND version.platform = lower(trim(social_publications.platform))
       WHERE item.id = social_publications.variant_id
     )`,
    `UPDATE social_publication_events
     SET variant_id = (
       SELECT publication.variant_id
       FROM social_publications AS publication
       JOIN social_variants AS version ON version.id = publication.variant_id
       JOIN content_bank_items AS item
         ON version.package_id =
           'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB)))
       WHERE publication.id = social_publication_events.publication_id
         AND item.id = social_publication_events.variant_id
       LIMIT 1
     )
     WHERE EXISTS (
       SELECT 1
       FROM social_publications AS publication
       JOIN social_variants AS version ON version.id = publication.variant_id
       JOIN content_bank_items AS item
         ON version.package_id =
           'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB)))
       WHERE publication.id = social_publication_events.publication_id
         AND item.id = social_publication_events.variant_id
     )`,
    `UPDATE social_publication_events
     SET variant_id = (
       SELECT version.id
       FROM content_bank_items AS item
       JOIN social_variants AS version
         ON version.package_id =
           'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB)))
        AND version.platform = lower(trim(CAST(json_extract(
          CASE
            WHEN json_valid(social_publication_events.payload_json)
              THEN social_publication_events.payload_json
            ELSE '{}'
          END,
          '$.platform'
        ) AS TEXT)))
       WHERE item.id = social_publication_events.variant_id
       LIMIT 1
     )
     WHERE (
         social_publication_events.publication_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM social_publications AS publication
           WHERE publication.id = social_publication_events.publication_id
         )
       )
       AND EXISTS (
         SELECT 1
         FROM content_bank_items AS item
         JOIN social_variants AS version
           ON version.package_id =
             'social-post-legacy-' || lower(hex(CAST(item.id AS BLOB)))
          AND version.platform = lower(trim(CAST(json_extract(
            CASE
              WHEN json_valid(social_publication_events.payload_json)
                THEN social_publication_events.payload_json
              ELSE '{}'
            END,
            '$.platform'
          ) AS TEXT)))
         WHERE item.id = social_publication_events.variant_id
       )`,
    `UPDATE social_variants
     SET published_variant_id = (
       SELECT publication.id
       FROM social_publications AS publication
       WHERE publication.variant_id = social_variants.id
         AND publication.status = 'published'
       ORDER BY
         COALESCE(publication.published_at, publication.updated_at, publication.created_at) DESC,
         publication.id DESC
       LIMIT 1
     )
     WHERE social_variants.id LIKE 'social-variant-legacy-%'
       AND EXISTS (
         SELECT 1
         FROM social_publications AS publication
         WHERE publication.variant_id = social_variants.id
           AND publication.status = 'published'
       )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publications_one_active_variant
     ON social_publications(variant_id)
     WHERE variant_id LIKE 'social-variant-%'
       AND status IN ('queued', 'publishing')`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

async function applySocialPublicationsReusableMigration(db: D1Database): Promise<void> {
  for (const tableName of ["content_bank_items", "social_packages", "social_variants"]) {
    if (!(await tableExists(db, tableName))) {
      throw new Error(
        `Cannot apply 0023_social_publications_reusable: ${tableName} is missing`,
      );
    }
  }

  await db.prepare("DROP INDEX IF EXISTS idx_social_publications_one_active_variant").run();
  await db.prepare("DROP INDEX IF EXISTS idx_social_publications_one_in_flight_variant").run();
  await db.prepare("DROP INDEX IF EXISTS idx_social_publications_same_time_scheduled").run();

  await rebuildSocialPublicationsForReusableMigration(db);
  await rebuildSocialPublicationEventsForReusableMigration(db);

  const statements = [
    `INSERT OR IGNORE INTO social_publications (
       id,
       variant_id,
       site_id,
       platform,
       status,
       scheduled_for,
       timezone,
       target_account_id_snapshot,
       format_snapshot,
       body_text_snapshot,
       asset_manifest_json_snapshot,
       approval_status_snapshot,
       approved_at_snapshot,
       approved_by_user_id_snapshot,
       requested_by_type,
       requested_by_user_id,
       request_context_json,
       created_at,
       updated_at
     )
     SELECT
       'social-publication-scheduled-' || lower(hex(CAST(version.id AS BLOB))) || '-' ||
         lower(hex(CAST(version.scheduled_for AS BLOB))),
       version.id,
       post.site_id,
       version.platform,
       'scheduled',
       version.scheduled_for,
       version.timezone,
       version.target_account_id,
       version.format,
       version.body_text,
       version.asset_manifest_json,
       version.approval_status,
       version.approved_at,
       version.approved_by_user_id,
       'migration',
       NULL,
       json_object(
         'migration', '0023_social_publications_reusable',
         'source', 'social_variants.scheduled_for'
       ),
       COALESCE(version.updated_at, version.created_at, datetime('now')),
       COALESCE(version.updated_at, version.created_at, datetime('now'))
     FROM social_variants AS version
     JOIN social_packages AS post ON post.id = version.package_id
     WHERE version.platform = 'linkedin'
       AND version.approval_status = 'approved'
       AND version.scheduled_for IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM social_publications AS active
         WHERE active.variant_id = version.id
           AND active.status IN ('scheduled', 'queued', 'publishing')
       )`,
    `INSERT OR IGNORE INTO social_publication_events (
       id, publication_id, variant_id, event_type, payload_json, created_at
     )
     SELECT
       'social-event-scheduled-' || lower(hex(CAST(version.id AS BLOB))) || '-' ||
         lower(hex(CAST(version.scheduled_for AS BLOB))),
       publication.id,
       version.id,
       'scheduled',
       json_object(
         'migration', '0023_social_publications_reusable',
         'scheduledFor', publication.scheduled_for,
         'timezone', publication.timezone
       ),
       publication.created_at
     FROM social_variants AS version
     JOIN social_publications AS publication
       ON publication.id =
         'social-publication-scheduled-' || lower(hex(CAST(version.id AS BLOB))) || '-' ||
           lower(hex(CAST(version.scheduled_for AS BLOB)))
     WHERE version.platform = 'linkedin'
       AND version.approval_status = 'approved'
       AND version.scheduled_for IS NOT NULL
       AND publication.status = 'scheduled'
       AND publication.variant_id = version.id
       AND publication.scheduled_for = version.scheduled_for`,
    `CREATE INDEX IF NOT EXISTS idx_social_publications_status
     ON social_publications(status, scheduled_for, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_social_publications_variant
     ON social_publications(variant_id, created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publications_same_time_scheduled
     ON social_publications(variant_id, scheduled_for)
     WHERE status = 'scheduled' AND scheduled_for IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publications_one_in_flight_variant
     ON social_publications(variant_id)
     WHERE status IN ('queued', 'publishing')`,
    `CREATE INDEX IF NOT EXISTS idx_social_publication_events_publication
     ON social_publication_events(publication_id, created_at ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_social_publication_events_variant
     ON social_publication_events(variant_id, created_at ASC)`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

async function applySocialSuggestionsMigration(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS social_suggestions (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      source_type TEXT NOT NULL
        CHECK (source_type IN ('journal', 'mission_task', 'site', 'file', 'script', 'pasted')),
      source_ref TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_snapshot TEXT NOT NULL,
      source_text TEXT NOT NULL,
      suggestion_kind TEXT NOT NULL
        CHECK (suggestion_kind IN ('quote', 'short_post', 'thread', 'carousel_outline')),
      body_text TEXT NOT NULL,
      source_excerpt TEXT NOT NULL,
      quote_trimmed INTEGER NOT NULL DEFAULT 0 CHECK (quote_trimmed IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested', 'choosing', 'chosen', 'discarded')),
      selected_post_id TEXT,
      choose_token TEXT,
      choosing_at TEXT,
      choose_platforms_json TEXT,
      created_by TEXT NOT NULL DEFAULT 'agent' CHECK (created_by IN ('user', 'agent')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (status = 'choosing' AND choose_token IS NOT NULL AND choosing_at IS NOT NULL
          AND choose_platforms_json IS NOT NULL)
        OR (status <> 'choosing' AND choose_token IS NULL AND choosing_at IS NULL)
      ),
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
      FOREIGN KEY (selected_post_id) REFERENCES social_packages(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_social_suggestions_site_status
     ON social_suggestions(site_id, status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_social_suggestions_source
     ON social_suggestions(site_id, source_type, source_ref, created_at ASC)`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

async function applySocialPostingPlansMigration(db: D1Database): Promise<void> {
  await addColumnIfMissing(db, "social_packages", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
  const statements = [
    `CREATE TABLE IF NOT EXISTS social_posting_preferences (
      account_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      preferred_times_json TEXT NOT NULL DEFAULT '[]',
      minimum_gap_minutes INTEGER NOT NULL DEFAULT 120
        CHECK (minimum_gap_minutes BETWEEN 0 AND 10080),
      minimum_repost_days INTEGER
        CHECK (minimum_repost_days IS NULL OR minimum_repost_days BETWEEN 0 AND 3650),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS social_posting_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested', 'confirming', 'needs_attention', 'confirmed', 'expired')),
      request_json TEXT NOT NULL DEFAULT '{}',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      confirmation_token TEXT,
      confirmation_started_at TEXT,
      expires_at TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (status = 'confirming' AND confirmation_token IS NOT NULL AND confirmation_started_at IS NOT NULL)
        OR (status <> 'confirming' AND confirmation_token IS NULL AND confirmation_started_at IS NULL)
      ),
      FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS social_posting_plan_items (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      variant_id TEXT NOT NULL,
      version_updated_at_snapshot TEXT NOT NULL,
      approval_status_snapshot TEXT NOT NULL CHECK (approval_status_snapshot = 'approved'),
      version_fingerprint TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      timezone TEXT NOT NULL,
      is_repost INTEGER NOT NULL DEFAULT 0 CHECK (is_repost IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested', 'reserved', 'scheduled', 'blocked')),
      publication_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (plan_id, position),
      UNIQUE (plan_id, variant_id),
      FOREIGN KEY (plan_id) REFERENCES social_posting_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES social_variants(id) ON DELETE CASCADE,
      FOREIGN KEY (publication_id) REFERENCES social_publications(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS social_posting_reservations (
      id TEXT PRIMARY KEY,
      plan_item_id TEXT NOT NULL UNIQUE,
      account_id TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'fulfilled', 'released')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_item_id) REFERENCES social_posting_plan_items(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_social_posting_plans_owner_status
     ON social_posting_plans(user_id, status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_social_posting_plan_items_plan
     ON social_posting_plan_items(plan_id, position ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_social_posting_reservations_account_time
     ON social_posting_reservations(account_id, status, range_start, range_end)`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

async function applySocialCarouselsMigration(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS social_carousel_media (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      immutable_url TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      pixel_width INTEGER NOT NULL CHECK (pixel_width > 0),
      pixel_height INTEGER NOT NULL CHECK (pixel_height > 0),
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      bytes BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:'),
      UNIQUE(user_id, site_id, content_hash),
      FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_social_carousel_media_owner_site
     ON social_carousel_media(user_id, site_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS social_carousel_render_sets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      created_from_version_id TEXT,
      input_fingerprint TEXT NOT NULL,
      model_version TEXT NOT NULL,
      renderer_version TEXT NOT NULL,
      template_id TEXT NOT NULL,
      template_version INTEGER NOT NULL,
      canvas_width INTEGER NOT NULL,
      canvas_height INTEGER NOT NULL,
      model_json TEXT NOT NULL CHECK (json_valid(model_json)),
      canonical_input TEXT NOT NULL CHECK (json_valid(canonical_input)),
      asset_manifest_json TEXT NOT NULL CHECK (json_valid(asset_manifest_json)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (length(input_fingerprint) = 71 AND substr(input_fingerprint, 1, 7) = 'sha256:'),
      UNIQUE(user_id, site_id, post_id, input_fingerprint),
      FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES social_packages(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_social_carousel_render_sets_post
     ON social_carousel_render_sets(post_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS social_carousel_render_assets (
      id TEXT PRIMARY KEY,
      render_set_id TEXT NOT NULL,
      slide_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      content_hash TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      immutable_url TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type = 'image/svg+xml'),
      pixel_width INTEGER NOT NULL CHECK (pixel_width > 0),
      pixel_height INTEGER NOT NULL CHECK (pixel_height > 0),
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      alt_text TEXT NOT NULL,
      source_evidence_json TEXT NOT NULL CHECK (json_valid(source_evidence_json)),
      media_ref_ids_json TEXT NOT NULL CHECK (json_valid(media_ref_ids_json)),
      svg_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:'),
      UNIQUE(render_set_id, position),
      UNIQUE(render_set_id, slide_id),
      FOREIGN KEY (render_set_id) REFERENCES social_carousel_render_sets(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_social_carousel_render_assets_set
     ON social_carousel_render_assets(render_set_id, position ASC)`,
    `CREATE TABLE IF NOT EXISTS social_carousel_render_set_media (
      render_set_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      PRIMARY KEY (render_set_id, media_id),
      FOREIGN KEY (render_set_id) REFERENCES social_carousel_render_sets(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES social_carousel_media(id) ON DELETE RESTRICT
    )`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
  await addColumnIfMissing(
    db,
    "social_variants",
    "carousel_render_set_id",
    "TEXT REFERENCES social_carousel_render_sets(id) ON DELETE SET NULL",
  );
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_social_variants_carousel_render_set
     ON social_variants(carousel_render_set_id)
     WHERE carousel_render_set_id IS NOT NULL`,
  ).run();
}

async function rebuildSocialPublicationsForReusableMigration(
  db: D1Database,
): Promise<void> {
  const tableName = "social_publications";
  const stagingTableName = "social_publications_0023_new";
  const tablePresent = await tableExists(db, tableName);

  if (tablePresent && (await columnExists(db, tableName, "body_text_snapshot"))) {
    if (await tableExists(db, stagingTableName)) {
      await db.prepare(`DROP TABLE ${stagingTableName}`).run();
    }
    return;
  }

  if (!tablePresent) {
    if (!(await tableExists(db, stagingTableName))) {
      throw new Error(
        "Cannot apply 0023_social_publications_reusable: social_publications is missing",
      );
    }
    await db.prepare(`ALTER TABLE ${stagingTableName} RENAME TO ${tableName}`).run();
    return;
  }

  await db.prepare(`DROP TABLE IF EXISTS ${stagingTableName}`).run();
  await db
    .prepare(
      `CREATE TABLE ${stagingTableName} (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        platform TEXT NOT NULL
          CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business')),
        status TEXT NOT NULL
          CHECK (status IN ('scheduled', 'queued', 'publishing', 'published', 'failed', 'cancelled')),
        scheduled_for TEXT,
        timezone TEXT,
        target_account_id_snapshot TEXT,
        format_snapshot TEXT
          CHECK (format_snapshot IS NULL OR format_snapshot IN ('post', 'carousel')),
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
      )`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO ${stagingTableName} (
        id,
        variant_id,
        site_id,
        platform,
        status,
        scheduled_for,
        timezone,
        target_account_id_snapshot,
        format_snapshot,
        body_text_snapshot,
        asset_manifest_json_snapshot,
        approval_status_snapshot,
        approved_at_snapshot,
        approved_by_user_id_snapshot,
        requested_by_type,
        requested_by_user_id,
        request_context_json,
        platform_post_id,
        platform_post_url,
        error_code,
        error_message,
        provider_response_json,
        queued_at,
        published_at,
        last_polled_at,
        created_at,
        updated_at
      )
      SELECT
        publication.id,
        publication.variant_id,
        publication.site_id,
        publication.platform,
        publication.status,
        NULL,
        NULL,
        version.target_account_id,
        COALESCE(version.format, CASE WHEN legacy_item.id IS NOT NULL THEN 'post' END),
        COALESCE(version.body_text, legacy_item.body),
        COALESCE(version.asset_manifest_json, legacy_item.media_manifest_json),
        CASE
          WHEN publication.status IN ('scheduled', 'queued', 'publishing')
            THEN version.approval_status
          ELSE NULL
        END,
        CASE
          WHEN publication.status IN ('scheduled', 'queued', 'publishing')
            THEN version.approved_at
          ELSE NULL
        END,
        CASE
          WHEN publication.status IN ('scheduled', 'queued', 'publishing')
            THEN version.approved_by_user_id
          ELSE NULL
        END,
        'migration',
        NULL,
        json_object(
          'migration', '0023_social_publications_reusable',
          'snapshotSource', CASE
            WHEN version.id IS NOT NULL THEN 'canonical_version'
            WHEN legacy_item.id IS NOT NULL THEN 'legacy_content_bank'
            ELSE 'unavailable'
          END
        ),
        publication.platform_post_id,
        publication.platform_post_url,
        publication.error_code,
        publication.error_message,
        publication.provider_response_json,
        publication.queued_at,
        publication.published_at,
        publication.last_polled_at,
        publication.created_at,
        publication.updated_at
      FROM ${tableName} AS publication
      LEFT JOIN social_variants AS version ON version.id = publication.variant_id
      LEFT JOIN content_bank_items AS legacy_item ON legacy_item.id = publication.variant_id`,
    )
    .run();
  await db.prepare(`DROP TABLE ${tableName}`).run();
  await db.prepare(`ALTER TABLE ${stagingTableName} RENAME TO ${tableName}`).run();
}

async function rebuildSocialPublicationEventsForReusableMigration(
  db: D1Database,
): Promise<void> {
  const tableName = "social_publication_events";
  const stagingTableName = "social_publication_events_0023_new";
  const tablePresent = await tableExists(db, tableName);
  const definition = tablePresent ? await tableDefinition(db, tableName) : null;

  if (
    tablePresent &&
    definition?.includes("'scheduled'") &&
    definition.includes("'cancelled'")
  ) {
    if (await tableExists(db, stagingTableName)) {
      await db.prepare(`DROP TABLE ${stagingTableName}`).run();
    }
    return;
  }

  if (!tablePresent) {
    if (!(await tableExists(db, stagingTableName))) {
      throw new Error(
        "Cannot apply 0023_social_publications_reusable: social_publication_events is missing",
      );
    }
    await db.prepare(`ALTER TABLE ${stagingTableName} RENAME TO ${tableName}`).run();
    return;
  }

  await db.prepare(`DROP TABLE IF EXISTS ${stagingTableName}`).run();
  await db
    .prepare(
      `CREATE TABLE ${stagingTableName} (
        id TEXT PRIMARY KEY,
        publication_id TEXT,
        variant_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (
          event_type IN (
            'generated',
            'approved',
            'scheduled',
            'queued',
            'publishing',
            'published',
            'failed',
            'retried',
            'cancelled'
          )
        ),
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO ${stagingTableName} (
        id, publication_id, variant_id, event_type, payload_json, created_at
      )
      SELECT id, publication_id, variant_id, event_type, payload_json, created_at
      FROM ${tableName}`,
    )
    .run();
  await db.prepare(`DROP TABLE ${tableName}`).run();
  await db.prepare(`ALTER TABLE ${stagingTableName} RENAME TO ${tableName}`).run();
}

async function applyOwnerContentSearchMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "journal_entries")) || !(await tableExists(db, "mission_tasks"))) {
    throw new Error("Cannot apply 0019_owner_content_search: source tables are missing");
  }
  const statements = [
    `CREATE VIRTUAL TABLE IF NOT EXISTS owner_content_search USING fts5(
      user_id UNINDEXED,
      source_type UNINDEXED,
      source_id UNINDEXED,
      title,
      body,
      project_id UNINDEXED,
      project_name,
      status UNINDEXED,
      source_date UNINDEXED,
      updated_at UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2',
      prefix = '2 3'
    )`,
    `CREATE TRIGGER IF NOT EXISTS owner_content_search_journal_insert
    AFTER INSERT ON journal_entries
    WHEN NEW.archived_at IS NULL
    BEGIN
      INSERT INTO owner_content_search
        (user_id, source_type, source_id, title, body, project_id, project_name, status, source_date, updated_at)
      VALUES (
        NEW.user_id, 'journal', NEW.id,
        COALESCE(NULLIF(TRIM(NEW.title), ''), 'Journal entry for ' || NEW.entry_date),
        NEW.body, NULL, '', NULL, NEW.entry_date, NEW.updated_at
      );
    END`,
    `CREATE TRIGGER IF NOT EXISTS owner_content_search_journal_update
    AFTER UPDATE ON journal_entries
    BEGIN
      DELETE FROM owner_content_search
      WHERE user_id = OLD.user_id AND source_type = 'journal' AND source_id = OLD.id;
      INSERT INTO owner_content_search
        (user_id, source_type, source_id, title, body, project_id, project_name, status, source_date, updated_at)
      SELECT NEW.user_id, 'journal', NEW.id,
             COALESCE(NULLIF(TRIM(NEW.title), ''), 'Journal entry for ' || NEW.entry_date),
             NEW.body, NULL, '', NULL, NEW.entry_date, NEW.updated_at
      WHERE NEW.archived_at IS NULL;
    END`,
    `CREATE TRIGGER IF NOT EXISTS owner_content_search_journal_delete
    AFTER DELETE ON journal_entries
    BEGIN
      DELETE FROM owner_content_search
      WHERE user_id = OLD.user_id AND source_type = 'journal' AND source_id = OLD.id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS owner_content_search_task_insert
    AFTER INSERT ON mission_tasks
    WHEN NEW.archived_at IS NULL
    BEGIN
      INSERT INTO owner_content_search
        (user_id, source_type, source_id, title, body, project_id, project_name, status, source_date, updated_at)
      VALUES (
        NEW.user_id, 'mission_task', NEW.id, NEW.title, COALESCE(NEW.description, ''), NEW.project_id,
        COALESCE((SELECT name FROM mission_projects WHERE id = NEW.project_id AND user_id = NEW.user_id LIMIT 1), ''),
        NEW.status, NEW.due_at, NEW.updated_at
      );
    END`,
    `CREATE TRIGGER IF NOT EXISTS owner_content_search_task_update
    AFTER UPDATE ON mission_tasks
    BEGIN
      DELETE FROM owner_content_search
      WHERE user_id = OLD.user_id AND source_type = 'mission_task' AND source_id = OLD.id;
      INSERT INTO owner_content_search
        (user_id, source_type, source_id, title, body, project_id, project_name, status, source_date, updated_at)
      SELECT NEW.user_id, 'mission_task', NEW.id, NEW.title, COALESCE(NEW.description, ''), NEW.project_id,
             COALESCE((SELECT name FROM mission_projects WHERE id = NEW.project_id AND user_id = NEW.user_id LIMIT 1), ''),
             NEW.status, NEW.due_at, NEW.updated_at
      WHERE NEW.archived_at IS NULL;
    END`,
    `CREATE TRIGGER IF NOT EXISTS owner_content_search_task_delete
    AFTER DELETE ON mission_tasks
    BEGIN
      DELETE FROM owner_content_search
      WHERE user_id = OLD.user_id AND source_type = 'mission_task' AND source_id = OLD.id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS owner_content_search_project_rename
    AFTER UPDATE OF name ON mission_projects
    BEGIN
      UPDATE owner_content_search SET project_name = NEW.name
      WHERE user_id = NEW.user_id AND source_type = 'mission_task' AND project_id = NEW.id;
    END`,
    "DELETE FROM owner_content_search",
    `INSERT INTO owner_content_search
      (user_id, source_type, source_id, title, body, project_id, project_name, status, source_date, updated_at)
    SELECT user_id, 'journal', id,
           COALESCE(NULLIF(TRIM(title), ''), 'Journal entry for ' || entry_date),
           body, NULL, '', NULL, entry_date, updated_at
    FROM journal_entries WHERE archived_at IS NULL`,
    `INSERT INTO owner_content_search
      (user_id, source_type, source_id, title, body, project_id, project_name, status, source_date, updated_at)
    SELECT t.user_id, 'mission_task', t.id, t.title, COALESCE(t.description, ''), t.project_id,
           COALESCE(p.name, ''), t.status, t.due_at, t.updated_at
    FROM mission_tasks t
    LEFT JOIN mission_projects p ON p.id = t.project_id AND p.user_id = t.user_id
    WHERE t.archived_at IS NULL`,
  ];

  // D1Database.exec treats each newline as a separate query. Keep multiline
  // FTS5 and trigger definitions intact by preparing each statement directly.
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

async function applyManagedRuntimeLifecycleMigration(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS managed_runtime_state (
      id TEXT PRIMARY KEY CHECK (id = 'managed'),
      installation_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'quiesced', 'suspended')),
      generation INTEGER NOT NULL DEFAULT 1,
      quiesced_at TEXT,
      suspended_at TEXT,
      credentials_revoked_at TEXT,
      storage_purged_at TEXT,
      last_request_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS managed_runtime_control_requests (
      request_id TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL,
      action TEXT NOT NULL
        CHECK (action IN ('quiesce', 'suspend', 'resume', 'revoke_credentials', 'purge_storage')),
      expected_generation INTEGER NOT NULL CHECK (expected_generation >= 1),
      status TEXT NOT NULL DEFAULT 'applying'
        CHECK (status IN ('applying', 'applied')),
      applied_generation INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_managed_runtime_control_requests_install_created
      ON managed_runtime_control_requests(installation_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS managed_runtime_write_leases (
      lease_id TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL,
      method TEXT NOT NULL,
      path_class TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_managed_runtime_write_leases_install_created
      ON managed_runtime_write_leases(installation_id, created_at)`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
  await addColumnIfMissing(
    db,
    "managed_runtime_control_requests",
    "expected_generation",
    "INTEGER",
  );
}

async function applyJournalEntryRevisionMigration(db: D1Database): Promise<void> {
  // The published D1 migration handles normal deploys; this compatibility
  // repair covers installs that were upgraded without applying that migration.
  await addColumnIfMissing(db, "journal_entries", "revision", "INTEGER NOT NULL DEFAULT 1");
}

async function applySocialMediaDeliveryMigration(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS drive_multipart_uploads (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      r2_upload_id TEXT NOT NULL,
      part_size INTEGER NOT NULL,
      total_size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'completed', 'aborted', 'failed')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES owner_profile(id) ON DELETE CASCADE
    )`,
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS drive_multipart_parts (
      upload_id TEXT NOT NULL,
      part_number INTEGER NOT NULL,
      etag TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (upload_id, part_number),
      FOREIGN KEY (upload_id) REFERENCES drive_multipart_uploads(id) ON DELETE CASCADE
    )`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_drive_multipart_uploads_owner_status
     ON drive_multipart_uploads(owner_id, status, updated_at DESC)`,
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS social_media_delivery_grants (
      id TEXT PRIMARY KEY,
      publication_id TEXT,
      file_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (publication_id) REFERENCES social_publications(id) ON DELETE SET NULL,
      FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES owner_profile(id) ON DELETE CASCADE
    )`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_social_media_delivery_grants_lookup
     ON social_media_delivery_grants(token_hash, expires_at)
     WHERE revoked_at IS NULL`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_social_media_delivery_grants_publication
     ON social_media_delivery_grants(publication_id, file_id, provider)`,
  ).run();
}

async function applySocialYoutubeTikTokMigration(db: D1Database): Promise<void> {
  const checkedTables = [
    "social_accounts",
    "social_oauth_states",
    "social_provider_settings",
    "social_variants",
    "social_publications",
  ];
  const definitions: string[] = [];
  for (const tableName of checkedTables) {
    const definition = await tableDefinition(db, tableName);
    if (!definition) {
      throw new Error(`Cannot apply 0030_social_youtube_tiktok: ${tableName} is missing`);
    }
    definitions.push(definition);
  }
  if (definitions.every((definition) => definition.includes("'tiktok'"))) return;

  const sql = `
    PRAGMA defer_foreign_keys = ON;

    CREATE TABLE social_posting_preferences_0030_backup AS SELECT * FROM social_posting_preferences;
    CREATE TABLE social_posting_plans_0030_backup AS SELECT * FROM social_posting_plans;
    CREATE TABLE social_posting_reservations_0030_backup AS SELECT * FROM social_posting_reservations;
    CREATE TABLE social_posting_plan_items_0030_backup AS SELECT * FROM social_posting_plan_items;
    CREATE TABLE social_media_delivery_grants_0030_backup AS SELECT * FROM social_media_delivery_grants;

    CREATE TABLE social_accounts_0030_new (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
      platform_account_id TEXT NOT NULL,
      platform_handle TEXT,
      display_name TEXT,
      access_token_ciphertext TEXT NOT NULL,
      refresh_token_ciphertext TEXT,
      token_expires_at TEXT,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
      metadata_json TEXT,
      last_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(site_id, platform, platform_account_id)
    );
    INSERT INTO social_accounts_0030_new SELECT * FROM social_accounts;
    DROP TABLE social_accounts;
    ALTER TABLE social_accounts_0030_new RENAME TO social_accounts;
    CREATE INDEX idx_social_accounts_site_platform ON social_accounts(site_id, platform);
    CREATE INDEX idx_social_accounts_user_site ON social_accounts(user_id, site_id);

    CREATE TABLE social_oauth_states_0030_new (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
      return_path TEXT NOT NULL DEFAULT '/social',
      code_verifier TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO social_oauth_states_0030_new SELECT * FROM social_oauth_states;
    DROP TABLE social_oauth_states;
    ALTER TABLE social_oauth_states_0030_new RENAME TO social_oauth_states;
    CREATE INDEX idx_social_oauth_states_state_platform ON social_oauth_states(state, platform);

    CREATE TABLE social_provider_settings_0030_new (
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL CHECK (provider_id IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
      client_id TEXT NOT NULL DEFAULT '',
      encrypted_client_secret TEXT,
      secret_hint TEXT,
      secret_updated_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, provider_id)
    );
    INSERT INTO social_provider_settings_0030_new SELECT * FROM social_provider_settings;
    DROP TABLE social_provider_settings;
    ALTER TABLE social_provider_settings_0030_new RENAME TO social_provider_settings;

    CREATE TABLE social_variants_0030_new (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
      format TEXT NOT NULL DEFAULT 'post',
      title TEXT,
      body_text TEXT NOT NULL,
      first_comment TEXT,
      hashtags_json TEXT NOT NULL DEFAULT '[]',
      asset_manifest_json TEXT NOT NULL DEFAULT '[]',
      source_excerpt TEXT,
      approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'approved', 'rejected')),
      scheduled_for TEXT,
      timezone TEXT,
      published_variant_id TEXT,
      agent_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      target_account_id TEXT,
      approved_at TEXT,
      approved_by_user_id TEXT,
      carousel_render_set_id TEXT REFERENCES social_carousel_render_sets(id) ON DELETE SET NULL,
      UNIQUE(package_id, platform)
    );
    INSERT INTO social_variants_0030_new SELECT * FROM social_variants;
    DROP TABLE social_variants;
    ALTER TABLE social_variants_0030_new RENAME TO social_variants;
    CREATE INDEX idx_social_variants_package ON social_variants(package_id);
    CREATE INDEX idx_social_variants_schedule ON social_variants(approval_status, scheduled_for);
    CREATE INDEX idx_social_variants_target_account ON social_variants(target_account_id, approval_status, scheduled_for);
    CREATE INDEX idx_social_variants_carousel_render_set ON social_variants(carousel_render_set_id)
      WHERE carousel_render_set_id IS NOT NULL;

    CREATE TABLE social_publications_0030_new (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
      status TEXT NOT NULL CHECK (status IN ('scheduled', 'queued', 'publishing', 'published', 'failed', 'cancelled')),
      scheduled_for TEXT,
      timezone TEXT,
      target_account_id_snapshot TEXT,
      format_snapshot TEXT CHECK (format_snapshot IS NULL OR format_snapshot IN ('post', 'carousel')),
      body_text_snapshot TEXT,
      asset_manifest_json_snapshot TEXT,
      approval_status_snapshot TEXT CHECK (approval_status_snapshot IS NULL OR approval_status_snapshot IN ('draft', 'approved', 'rejected')),
      approved_at_snapshot TEXT,
      approved_by_user_id_snapshot TEXT,
      requested_by_type TEXT CHECK (requested_by_type IS NULL OR requested_by_type IN ('owner', 'agent', 'migration')),
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
    INSERT INTO social_publications_0030_new SELECT * FROM social_publications;
    DROP TABLE social_publications;
    ALTER TABLE social_publications_0030_new RENAME TO social_publications;
    CREATE INDEX idx_social_publications_status ON social_publications(status, scheduled_for, created_at DESC);
    CREATE INDEX idx_social_publications_variant ON social_publications(variant_id, created_at DESC);
    CREATE UNIQUE INDEX idx_social_publications_same_time_scheduled ON social_publications(variant_id, scheduled_for)
      WHERE status = 'scheduled' AND scheduled_for IS NOT NULL;
    CREATE UNIQUE INDEX idx_social_publications_one_in_flight_variant ON social_publications(variant_id)
      WHERE status IN ('queued', 'publishing');

    DELETE FROM social_posting_plan_items;
    DELETE FROM social_posting_reservations;
    DELETE FROM social_posting_plans;
    DELETE FROM social_posting_preferences;
    DELETE FROM social_media_delivery_grants;
    INSERT INTO social_posting_preferences SELECT * FROM social_posting_preferences_0030_backup;
    INSERT INTO social_posting_plans SELECT * FROM social_posting_plans_0030_backup;
    INSERT INTO social_posting_reservations SELECT * FROM social_posting_reservations_0030_backup;
    INSERT INTO social_posting_plan_items SELECT * FROM social_posting_plan_items_0030_backup;
    INSERT INTO social_media_delivery_grants SELECT * FROM social_media_delivery_grants_0030_backup;

    DROP TABLE social_posting_preferences_0030_backup;
    DROP TABLE social_posting_plans_0030_backup;
    DROP TABLE social_posting_reservations_0030_backup;
    DROP TABLE social_posting_plan_items_0030_backup;
    DROP TABLE social_media_delivery_grants_0030_backup;
    PRAGMA defer_foreign_keys = OFF;
  `;
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  await db.batch(statements);
}

/**
 * drive_files kept UNIQUE(owner_id, folder_id, filename) regardless of status, so a trashed file held its name inside
 * a folder. Rebuild without it; partial unique indexes keep the name rule for ready files only. Same as
 * migrations/0088_drive_files_reuse_trashed_names.sql.
 */
async function applyDriveFilesReuseTrashedNamesMigration(db: D1Database): Promise<void> {
  const definition = await tableDefinition(db, "drive_files");
  if (!definition || !/UNIQUE\s*\(\s*owner_id\s*,\s*folder_id\s*,\s*filename\s*\)/i.test(definition)) return;

  // Dropping drive_files fires its ON DELETE CASCADE actions in D1 even while validation is deferred.
  const dependents: string[] = [];
  for (const table of ["drive_multipart_uploads", "drive_multipart_parts", "social_media_delivery_grants"]) {
    if (await tableExists(db, table)) dependents.push(table);
  }
  const columns =
    "id, owner_id, folder_id, filename, mime_type, size, storage_key, etag, sha256, " +
    "status, preview_kind, extracted_text, metadata_json, created_at, updated_at";
  const statements = [
    "PRAGMA defer_foreign_keys = ON",
    ...dependents.map((table) => `CREATE TABLE ${table}_0088_backup AS SELECT * FROM ${table}`),
    `CREATE TABLE drive_files_0088_new (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL DEFAULT 'owner',
      folder_id TEXT REFERENCES drive_folders(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL,
      etag TEXT,
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'ready'
        CHECK (status IN ('uploading', 'ready', 'trashed', 'failed')),
      preview_kind TEXT NOT NULL DEFAULT 'download'
        CHECK (preview_kind IN ('image', 'pdf', 'text', 'markdown', 'csv', 'spreadsheet', 'download')),
      extracted_text TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES owner_profile(id) ON DELETE CASCADE
    )`,
    `INSERT INTO drive_files_0088_new (${columns}) SELECT ${columns} FROM drive_files`,
    "DROP TABLE drive_files",
    "ALTER TABLE drive_files_0088_new RENAME TO drive_files",
    `CREATE UNIQUE INDEX idx_drive_files_root_filename
       ON drive_files(owner_id, filename)
       WHERE folder_id IS NULL AND status = 'ready'`,
    `CREATE UNIQUE INDEX idx_drive_files_folder_filename
       ON drive_files(owner_id, folder_id, filename)
       WHERE folder_id IS NOT NULL AND status = 'ready'`,
    "CREATE INDEX idx_drive_files_owner_folder ON drive_files(owner_id, folder_id, status, filename)",
    "CREATE INDEX idx_drive_files_owner_updated ON drive_files(owner_id, updated_at DESC)",
    // Children before parents on delete, parents before children on restore.
    ...[...dependents].reverse().map((table) => `DELETE FROM ${table}`),
    ...dependents.map((table) => `INSERT INTO ${table} SELECT * FROM ${table}_0088_backup`),
    ...dependents.map((table) => `DROP TABLE ${table}_0088_backup`),
    "PRAGMA defer_foreign_keys = OFF",
  ];
  await db.batch(statements.map((statement) => db.prepare(statement)));
}

/**
 * Adds 'facebook' to the platform CHECK of every social table that has one. Each table is rebuilt from its own
 * current definition, so columns added since 0030 stay. Same as migrations/0090_social_facebook_pages.sql.
 */
async function applySocialFacebookPagesMigration(db: D1Database): Promise<void> {
  const checkedTables = [
    "social_accounts",
    "social_oauth_states",
    "social_provider_settings",
    "social_variants",
    "social_publications",
  ];
  const rebuilds: Array<{ table: string; definition: string; indexes: string[] }> = [];
  for (const table of checkedTables) {
    if (!(await tableExists(db, table))) return;
    const definition = await tableDefinition(db, table);
    if (!definition || definition.includes("'facebook'")) continue;
    const platformList = /((?:platform|provider_id) IN \([^)]*'instagram_business')/;
    if (!platformList.test(definition)) {
      throw new Error(`Cannot apply 0090_social_facebook_pages: ${table} has an unexpected platform list`);
    }
    const indexes = await db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
      .bind(table)
      .all<SqliteDefinitionRow>();
    rebuilds.push({
      table,
      definition: definition
        .replace(/^CREATE TABLE (?:IF NOT EXISTS )?"?\w+"?/i, `CREATE TABLE ${table}_0090_new`)
        .replace(platformList, "$1, 'facebook'"),
      indexes: (indexes.results || []).map((row) => row.sql).filter((sql): sql is string => Boolean(sql)),
    });
  }
  if (rebuilds.length === 0) return;

  // Rebuilding a parent fires its ON DELETE actions in D1 even while validation is deferred.
  const dependents: string[] = [];
  for (const table of [
    "social_posting_preferences",
    "social_posting_plans",
    "social_posting_reservations",
    "social_posting_plan_items",
    "social_media_delivery_grants",
  ]) {
    if (await tableExists(db, table)) dependents.push(table);
  }
  const statements = [
    "PRAGMA defer_foreign_keys = ON",
    ...dependents.map((table) => `CREATE TABLE ${table}_0090_backup AS SELECT * FROM ${table}`),
    ...rebuilds.flatMap(({ table, definition, indexes }) => [
      definition,
      `INSERT INTO ${table}_0090_new SELECT * FROM ${table}`,
      `DROP TABLE ${table}`,
      `ALTER TABLE ${table}_0090_new RENAME TO ${table}`,
      ...indexes,
    ]),
    // Children before parents on delete, parents before children on restore.
    ...[...dependents].reverse().map((table) => `DELETE FROM ${table}`),
    ...dependents.map((table) => `INSERT INTO ${table} SELECT * FROM ${table}_0090_backup`),
    ...dependents.map((table) => `DROP TABLE ${table}_0090_backup`),
    "PRAGMA defer_foreign_keys = OFF",
  ];
  await db.batch(statements.map((statement) => db.prepare(statement)));
}

async function applySocialPublicationFormatsMigration(db: D1Database): Promise<void> {
  const definition = await tableDefinition(db, "social_publications");
  if (!definition) {
    throw new Error(
      "Cannot apply 0031_social_publication_formats: social_publications is missing",
    );
  }
  if (!(await columnExists(db, "social_publications", "format_snapshot"))) return;
  if (definition.includes("'image'") && definition.includes("'short_video'")) return;
  const postingPlanItemsPresent = await tableExists(db, "social_posting_plan_items");
  const mediaDeliveryGrantsPresent = await tableExists(
    db,
    "social_media_delivery_grants",
  );

  const sql = `
    PRAGMA defer_foreign_keys = ON;

    ${postingPlanItemsPresent
      ? `CREATE TABLE social_posting_plan_items_0031_backup AS
           SELECT * FROM social_posting_plan_items;`
      : ""}
    ${mediaDeliveryGrantsPresent
      ? `CREATE TABLE social_media_delivery_grants_0031_backup AS
           SELECT * FROM social_media_delivery_grants;`
      : ""}

    CREATE TABLE social_publications_0031_new (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      platform TEXT NOT NULL
        CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
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
    INSERT INTO social_publications_0031_new SELECT * FROM social_publications;
    DROP TABLE social_publications;
    ALTER TABLE social_publications_0031_new RENAME TO social_publications;

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

    ${postingPlanItemsPresent
      ? `DELETE FROM social_posting_plan_items;
         INSERT INTO social_posting_plan_items
           SELECT * FROM social_posting_plan_items_0031_backup;
         DROP TABLE social_posting_plan_items_0031_backup;`
      : ""}
    ${mediaDeliveryGrantsPresent
      ? `DELETE FROM social_media_delivery_grants;
         INSERT INTO social_media_delivery_grants
           SELECT * FROM social_media_delivery_grants_0031_backup;
         DROP TABLE social_media_delivery_grants_0031_backup;`
      : ""}
    PRAGMA defer_foreign_keys = OFF;
  `;
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
}

async function applySocialVersionPublishingSettingsMigration(
  db: D1Database,
): Promise<void> {
  await addColumnIfMissing(
    db,
    "social_variants",
    "publishing_settings_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
}

async function applyManualPaymentsMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "commerce_orders"))) {
    // Some legacy/minimal databases intentionally do not include the site and
    // commerce subsystem. There is nothing to migrate in those installations.
    if (!(await tableExists(db, "sites"))) return;
    await applySitePagesAndCommerceMigration(db);
  }
  await addColumnIfMissing(db, "commerce_orders", "amount_due", "INTEGER");
  await addColumnIfMissing(
    db,
    "commerce_orders",
    "payment_method",
    "TEXT NOT NULL DEFAULT 'stripe' CHECK (payment_method IN ('stripe', 'manual'))",
  );
  await db
    .prepare(
      `UPDATE commerce_orders
       SET amount_due = amount_paid
       WHERE amount_due IS NULL`,
    )
    .run();
}

async function applyOwnerOnboardingMigration(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS owner_onboarding (
        user_id TEXT PRIMARY KEY,
        profile_source TEXT NOT NULL
          CHECK (profile_source IN ('hosted_starter')),
        profile_site_id TEXT NOT NULL,
        current_step INTEGER
          CHECK (current_step IS NULL OR current_step IN (2, 3)),
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    )
    .run();
}

async function applyCalendarSourceEventDismissalsMigration(
  db: D1Database,
): Promise<void> {
  if (!(await tableExists(db, "calendar_sources"))) return;

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS calendar_source_event_dismissals (
        source_id TEXT NOT NULL,
        external_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_id, external_key),
        FOREIGN KEY (source_id) REFERENCES calendar_sources(id) ON DELETE CASCADE
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_calendar_source_event_dismissals_source
       ON calendar_source_event_dismissals(source_id)`,
    )
    .run();
}

async function applyCalendarPushNotificationsMigration(
  db: D1Database,
): Promise<void> {
  const statements = [
    db.prepare(
      `CREATE TABLE IF NOT EXISTS mobile_push_preferences (
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        daily_briefing_enabled INTEGER NOT NULL DEFAULT 1,
        calendar_notifications_json TEXT NOT NULL DEFAULT '{"enabled":true,"categories":{"events":true,"bookings":true,"birthdays":true,"reminders":true,"tasks":true,"subscribed_calendars":true}}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, device_id),
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS calendar_push_dispatches (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL CHECK (
          category IN ('events', 'bookings', 'birthdays', 'reminders', 'tasks', 'subscribed_calendars')
        ),
        item_id TEXT NOT NULL,
        occurrence_id TEXT NOT NULL,
        alert_offset_minutes INTEGER NOT NULL,
        alert_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, category, item_id, occurrence_id, alert_offset_minutes),
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_calendar_push_dispatches_due
       ON calendar_push_dispatches(user_id, alert_at, status)`,
    ),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
}

async function applyEventBookingCapacityMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "bookings")) || !(await tableExists(db, "booking_holds"))) {
    return;
  }
  if (!(await columnExists(db, "bookings", "quantity"))) {
    await db
      .prepare(
        "ALTER TABLE bookings ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1)",
      )
      .run();
  }
  if (!(await columnExists(db, "booking_holds", "quantity"))) {
    await db
      .prepare(
        "ALTER TABLE booking_holds ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1)",
      )
      .run();
  }
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_bookings_event_capacity
       ON bookings(site_id, booking_type, offer_id, starts_at, ends_at, status)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_booking_holds_event_capacity
       ON booking_holds(site_id, booking_type, offer_id, slot_start, slot_end, status, expires_at)`,
    )
    .run();
}

async function applySiteRolesMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "sites"))) {
    throw new Error("Cannot apply 0038_site_roles: sites is missing");
  }

  await addColumnIfMissing(
    db,
    "sites",
    "site_role",
    "TEXT CHECK (site_role IN ('profile', 'organization'))",
  );

  const statements = [
    db.prepare(
      `UPDATE sites AS site
       SET site_role = CASE
         WHEN site.id = (
           SELECT candidate.id
           FROM sites AS candidate
           WHERE candidate.user_id = site.user_id
             AND candidate.site_type = 'profile'
           ORDER BY candidate.created_at ASC, candidate.id ASC
           LIMIT 1
         ) THEN 'profile'
         ELSE 'organization'
       END
       WHERE site.site_type = 'profile'
         AND site.site_role IS NULL`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_one_profile_per_owner
       ON sites(user_id)
       WHERE site_role = 'profile'`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_sites_owner_role
       ON sites(user_id, site_role, created_at)`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_role_required_insert
       BEFORE INSERT ON sites
       WHEN (NEW.site_type = 'profile' AND NEW.site_role IS NULL)
         OR (NEW.site_type = 'landing_page' AND NEW.site_role IS NOT NULL)
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_ROLE_REQUIRED');
       END`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_role_required_update
       BEFORE UPDATE OF site_type, site_role ON sites
       WHEN (NEW.site_type = 'profile' AND NEW.site_role IS NULL)
         OR (NEW.site_type = 'landing_page' AND NEW.site_role IS NOT NULL)
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_ROLE_REQUIRED');
       END`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_profile_limit_insert
       BEFORE INSERT ON sites
       WHEN NEW.site_role = 'profile'
         AND EXISTS (
           SELECT 1 FROM sites
           WHERE user_id = NEW.user_id AND site_role = 'profile'
         )
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_PROFILE_LIMIT');
       END`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_profile_limit_update
       BEFORE UPDATE OF user_id, site_role ON sites
       WHEN NEW.site_role = 'profile'
         AND EXISTS (
           SELECT 1 FROM sites
           WHERE user_id = NEW.user_id
             AND site_role = 'profile'
             AND id <> OLD.id
         )
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_PROFILE_LIMIT');
       END`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_organization_limit_insert
       BEFORE INSERT ON sites
       WHEN NEW.site_role = 'organization'
         AND (
           SELECT COUNT(*) FROM sites
           WHERE user_id = NEW.user_id AND site_role = 'organization'
         ) >= 3
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_ORGANIZATION_LIMIT');
       END`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_organization_limit_update
       BEFORE UPDATE OF user_id, site_role ON sites
       WHEN NEW.site_role = 'organization'
         AND (
           SELECT COUNT(*) FROM sites
           WHERE user_id = NEW.user_id
             AND site_role = 'organization'
             AND id <> OLD.id
         ) >= 3
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_ORGANIZATION_LIMIT');
       END`,
    ),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
}

async function applyBusinessSiteProfileOwnershipMigration(
  db: D1Database,
): Promise<void> {
  if (!(await tableExists(db, "sites"))) {
    throw new Error(
      "Cannot apply 0046_business_site_profile_ownership: sites is missing",
    );
  }
  await addColumnIfMissing(
    db,
    "sites",
    "profile_site_id",
    "TEXT REFERENCES sites(id) ON DELETE RESTRICT",
  );
  const statements = [
    db.prepare(
      `UPDATE sites AS business_site
       SET profile_site_id = (
         SELECT profile.id
         FROM sites AS profile
         WHERE profile.user_id = business_site.user_id
           AND profile.site_role = 'profile'
         ORDER BY profile.created_at ASC, profile.id ASC
         LIMIT 1
       )
       WHERE business_site.site_role = 'organization'
         AND business_site.profile_site_id IS NULL`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_sites_profile_site
       ON sites(profile_site_id, created_at)
       WHERE profile_site_id IS NOT NULL`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_profile_ownership_insert
       BEFORE INSERT ON sites
       WHEN (NEW.site_role = 'profile' AND NEW.profile_site_id IS NOT NULL)
         OR (NEW.site_role = 'organization' AND (
           NEW.profile_site_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM sites AS profile
             WHERE profile.id = NEW.profile_site_id
               AND profile.user_id = NEW.user_id
               AND profile.site_role = 'profile'
           )
         ))
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_PROFILE_OWNERSHIP');
       END`,
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS sites_profile_ownership_update
       BEFORE UPDATE OF user_id, site_role, profile_site_id ON sites
       WHEN (NEW.site_role = 'profile' AND NEW.profile_site_id IS NOT NULL)
         OR (NEW.site_role = 'organization' AND (
           NEW.profile_site_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM sites AS profile
             WHERE profile.id = NEW.profile_site_id
               AND profile.user_id = NEW.user_id
               AND profile.site_role = 'profile'
           )
         ))
       BEGIN
         SELECT RAISE(ABORT, 'ME3_SITE_PROFILE_OWNERSHIP');
       END`,
    ),
  ];
  if (typeof db.batch === "function") await db.batch(statements);
  else for (const statement of statements) await statement.run();
}

async function applyEmailCampaignFoundationsMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "subscribers")) || !(await tableExists(db, "sites"))) {
    throw new Error("Cannot apply 0041_email_campaign_foundations: subscribers or sites is missing");
  }

  const subscriberColumns: Array<[string, string]> = [
    [
      "marketing_status",
      "TEXT NOT NULL DEFAULT 'pending' CHECK (marketing_status IN ('pending', 'marketable'))",
    ],
    [
      "marketing_permission_method",
      "TEXT CHECK (marketing_permission_method IS NULL OR marketing_permission_method IN ('single_opt_in', 'double_opt_in', 'import_attested'))",
    ],
    ["marketing_permission_granted_at", "TEXT"],
    ["marketing_permission_evidence_json", "TEXT"],
    [
      "delivery_status",
      "TEXT NOT NULL DEFAULT 'deliverable' CHECK (delivery_status IN ('deliverable', 'bounced', 'complained', 'suppressed'))",
    ],
    ["delivery_status_changed_at", "TEXT"],
  ];
  for (const [columnName, declaration] of subscriberColumns) {
    await addColumnIfMissing(db, "subscribers", columnName, declaration);
  }

  const statements = [
    db.prepare(
      `UPDATE subscribers
       SET marketing_status = CASE
             WHEN source IN ('me3', 'substack_import') THEN 'marketable'
             ELSE 'pending'
           END,
           marketing_permission_method = CASE
             WHEN source = 'me3' THEN 'single_opt_in'
             WHEN source = 'substack_import' THEN 'import_attested'
             ELSE NULL
           END,
           marketing_permission_granted_at = CASE
             WHEN source IN ('me3', 'substack_import') THEN subscribed_at
             ELSE NULL
           END,
           marketing_permission_evidence_json = CASE
             WHEN source = 'me3'
               THEN '{"version":1,"kind":"site_form","source":"legacy_me3_signup"}'
             WHEN source = 'substack_import'
               THEN '{"version":1,"kind":"legacy_import","source":"substack_import"}'
             ELSE NULL
           END
       WHERE marketing_permission_method IS NULL
         AND marketing_permission_granted_at IS NULL
         AND marketing_permission_evidence_json IS NULL`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaigns (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Untitled campaign',
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')),
        scheduled_for TEXT,
        sent_at TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_revisions (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
        subject TEXT NOT NULL DEFAULT '',
        preview_text TEXT NOT NULL DEFAULT '',
        reply_to_address TEXT,
        document_version TEXT NOT NULL DEFAULT 'me3.campaign-document.v1',
        document_json TEXT NOT NULL DEFAULT '{"version":"me3.campaign-document.v1","blocks":[]}',
        renderer_version TEXT,
        rendered_html TEXT,
        rendered_text TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (campaign_id, revision_number),
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_audience_snapshots (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
        excluded_count INTEGER NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
        exclusion_counts_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (revision_id) REFERENCES email_campaign_revisions(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_audience_members (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        subscriber_id INTEGER,
        normalized_email TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        permission_method TEXT NOT NULL
          CHECK (permission_method IN ('single_opt_in', 'double_opt_in', 'import_attested')),
        permission_granted_at TEXT NOT NULL,
        permission_evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (snapshot_id, normalized_email),
        FOREIGN KEY (snapshot_id) REFERENCES email_campaign_audience_snapshots(id) ON DELETE CASCADE,
        FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL
      )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaigns_site_updated
       ON email_campaigns(site_id, updated_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaigns_status_schedule
       ON email_campaigns(status, scheduled_for)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_revisions_campaign
       ON email_campaign_revisions(campaign_id, revision_number DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_audience_snapshots_campaign
       ON email_campaign_audience_snapshots(campaign_id, created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_audience_members_snapshot
       ON email_campaign_audience_members(snapshot_id)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_subscribers_campaign_eligibility
       ON subscribers(site_id, marketing_status, delivery_status, unsubscribed_at)`,
    ),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
}

async function applySubscriberDoubleOptInMigration(
  db: D1Database,
): Promise<void> {
  if (!(await tableExists(db, "subscribers"))) {
    throw new Error(
      "Cannot apply 0047_subscriber_double_opt_in: subscribers is missing",
    );
  }
  for (const columnName of [
    "confirmation_token_hash",
    "confirmation_expires_at",
    "confirmation_requested_at",
  ]) {
    await addColumnIfMissing(db, "subscribers", columnName, "TEXT");
  }
}

async function applyEmailCampaignAssetsMigration(db: D1Database): Promise<void> {
  if (
    !(await tableExists(db, "email_campaigns")) ||
    !(await tableExists(db, "email_campaign_revisions"))
  ) {
    throw new Error("Cannot apply 0042_email_campaign_assets: campaign foundations are missing");
  }
  const statements = [
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_assets (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL
          CHECK (content_type IN ('image/jpeg', 'image/png', 'image/gif')),
        size INTEGER NOT NULL CHECK (size > 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (campaign_id, content_hash),
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_revision_assets (
        revision_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (revision_id, asset_id),
        FOREIGN KEY (revision_id) REFERENCES email_campaign_revisions(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES email_campaign_assets(id) ON DELETE RESTRICT
      )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_assets_campaign
       ON email_campaign_assets(campaign_id, created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_assets_site_hash
       ON email_campaign_assets(site_id, content_hash)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_revision_assets_asset
       ON email_campaign_revision_assets(asset_id)`,
    ),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
}

async function applyEmailCampaignDeliveryMigration(db: D1Database): Promise<void> {
  if (
    !(await tableExists(db, "email_campaigns")) ||
    !(await tableExists(db, "email_campaign_revisions")) ||
    !(await tableExists(db, "email_campaign_audience_snapshots")) ||
    !(await tableExists(db, "email_campaign_audience_members"))
  ) {
    throw new Error("Cannot apply 0043_email_campaign_delivery: campaign foundations are missing");
  }
  for (const [columnName, declaration] of [
    ["current_revision_id", "TEXT"],
    ["audience_snapshot_id", "TEXT"],
    ["sender_ref", "TEXT"],
    ["from_address", "TEXT"],
    ["failure_reason", "TEXT"],
  ] as const) {
    await addColumnIfMissing(db, "email_campaigns", columnName, declaration);
  }

  const statements = [
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_recipient_jobs (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        audience_snapshot_id TEXT,
        audience_member_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('campaign', 'test')),
        recipient_ref TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
          'queued', 'submitting', 'accepted', 'delivered', 'delayed', 'bounced',
          'complained', 'suppressed', 'rejected', 'retry_wait', 'failed',
          'delivery_unknown', 'unresolved', 'cancelled', 'paused'
        )),
        request_json TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at TEXT NOT NULL,
        provider_reason TEXT,
        accepted_at TEXT,
        terminal_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (revision_id) REFERENCES email_campaign_revisions(id) ON DELETE RESTRICT,
        FOREIGN KEY (audience_snapshot_id) REFERENCES email_campaign_audience_snapshots(id) ON DELETE RESTRICT,
        FOREIGN KEY (audience_member_id) REFERENCES email_campaign_audience_members(id) ON DELETE RESTRICT
      )`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_email_campaign_recipient_jobs_member
       ON email_campaign_recipient_jobs(campaign_id, audience_member_id)
       WHERE kind = 'campaign'`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_recipient_jobs_due
       ON email_campaign_recipient_jobs(status, next_attempt_at, created_at)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_recipient_jobs_campaign
       ON email_campaign_recipient_jobs(campaign_id, status, created_at)`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_events (
        event_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        recipient_ref TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL,
        reason TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (operation_id) REFERENCES email_campaign_recipient_jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
      )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_email_campaign_events_campaign
       ON email_campaign_events(campaign_id, occurred_at DESC)`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS email_campaign_transport_state (
        id TEXT PRIMARY KEY CHECK (id = 'managed'),
        sender_ref TEXT,
        from_address TEXT,
        sender_domain TEXT,
        ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
        unavailable_reason TEXT,
        event_cursor TEXT,
        last_checked_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
}

async function applySiteBrandingMigration(db: D1Database): Promise<void> {
  if (!(await tableExists(db, "sites"))) {
    throw new Error("Cannot apply 0044_site_branding: sites is missing");
  }
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS site_branding (
      site_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      logo_ref TEXT,
      accent_color TEXT NOT NULL DEFAULT '#147d64',
      background_color TEXT NOT NULL DEFAULT '#f4f5f4',
      surface_color TEXT NOT NULL DEFAULT '#ffffff',
      text_color TEXT NOT NULL DEFAULT '#18201d',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    )`,
  ).run();
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(tableName)
    .first<SqliteNameRow>();
  return Boolean(row?.name);
}

async function tableDefinition(db: D1Database, tableName: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(tableName)
    .first<SqliteDefinitionRow>();
  return row?.sql || null;
}

async function columnExists(
  db: D1Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<SqliteNameRow>();
  return (result.results || []).some((row) => row.name === columnName);
}

async function addColumnIfMissing(
  db: D1Database,
  tableName: string,
  columnName: string,
  declaration: string,
): Promise<void> {
  if (!(await tableExists(db, tableName))) {
    throw new Error(`Cannot add ${tableName}.${columnName}: table is missing`);
  }
  if (await columnExists(db, tableName, columnName)) return;
  try {
    await db
      .prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${declaration}`)
      .run();
  } catch (error) {
    if (!(await columnExists(db, tableName, columnName))) throw error;
  }
}

import { MAILBOX_ATTACHMENT_STAGING_SQL } from "./mailbox-attachment-staging";
import type { Env } from "./types";

type RuntimeMigration = {
  id: string;
  checksum: string;
  apply(db: D1Database): Promise<void>;
};

type MigrationRow = {
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
  for (const migration of runtimeMigrations) {
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
  const row = await db
    .prepare(`SELECT checksum FROM ${MIGRATION_TABLE} WHERE id = ?`)
    .bind(migration.id)
    .first<MigrationRow>();
  if (row?.checksum === migration.checksum) return;

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

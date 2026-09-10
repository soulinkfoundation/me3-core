import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureCoreRuntimeMigrations,
  resetCoreRuntimeMigrationsForTest,
} from "./core-runtime-migrations";
import type { Env } from "./types";

const migrationSql = readFileSync(
  new URL("../migrations/0023_social_publications_reusable.sql", import.meta.url),
  "utf8",
);

describe("reusable social Publication migration", () => {
  beforeEach(() => {
    resetCoreRuntimeMigrationsForTest();
  });

  it("preserves delivery history and snapshots scheduled Publication inputs", async () => {
    await withCanonicalDatabase((database) => {
      sqliteExec(database, migrationSql);

      expect(
        sqliteRows<{
          id: string;
          status: string;
          platform_post_id: string | null;
          platform_post_url: string | null;
          error_code: string | null;
          error_message: string | null;
          provider_response_json: string | null;
          queued_at: string | null;
          published_at: string | null;
          last_polled_at: string | null;
          created_at: string;
          updated_at: string;
        }>(
          database,
          `SELECT id, status, platform_post_id, platform_post_url, error_code,
                  error_message, provider_response_json, queued_at, published_at,
                  last_polled_at, created_at, updated_at
           FROM social_publications
           WHERE id IN ('publication-history-old', 'publication-history-new', 'publication-legacy')
           ORDER BY id`,
        ),
      ).toEqual([
        {
          id: "publication-history-new",
          status: "published",
          platform_post_id: "linkedin-new",
          platform_post_url: "https://linkedin.example/new",
          error_code: null,
          error_message: null,
          provider_response_json: '{"provider":"new"}',
          queued_at: "2026-07-12T09:00:00.000Z",
          published_at: "2026-07-12T09:01:00.000Z",
          last_polled_at: "2026-07-12T09:02:00.000Z",
          created_at: "2026-07-12T08:59:00.000Z",
          updated_at: "2026-07-12T09:02:00.000Z",
        },
        {
          id: "publication-history-old",
          status: "published",
          platform_post_id: "linkedin-old",
          platform_post_url: "https://linkedin.example/old",
          error_code: null,
          error_message: null,
          provider_response_json: '{"provider":"old"}',
          queued_at: "2026-07-01T09:00:00.000Z",
          published_at: "2026-07-01T09:01:00.000Z",
          last_polled_at: null,
          created_at: "2026-07-01T08:59:00.000Z",
          updated_at: "2026-07-01T09:01:00.000Z",
        },
        {
          id: "publication-legacy",
          status: "failed",
          platform_post_id: null,
          platform_post_url: null,
          error_code: "legacy_error",
          error_message: "Legacy delivery failed",
          provider_response_json: '{"attempt":3}',
          queued_at: "2026-06-01T09:00:00.000Z",
          published_at: null,
          last_polled_at: "2026-06-01T09:03:00.000Z",
          created_at: "2026-06-01T08:59:00.000Z",
          updated_at: "2026-06-01T09:03:00.000Z",
        },
      ]);

      const canonicalSnapshot = sqliteRows<{
        scheduled_for: string | null;
        timezone: string | null;
        target_account_id_snapshot: string | null;
        format_snapshot: string | null;
        body_text_snapshot: string | null;
        asset_manifest_json_snapshot: string | null;
        approval_status_snapshot: string | null;
        approved_at_snapshot: string | null;
        approved_by_user_id_snapshot: string | null;
        requested_by_type: string | null;
        requested_by_user_id: string | null;
        request_context_json: string;
      }>(
        database,
        `SELECT scheduled_for, timezone, target_account_id_snapshot, format_snapshot,
                body_text_snapshot, asset_manifest_json_snapshot,
                approval_status_snapshot, approved_at_snapshot,
                approved_by_user_id_snapshot, requested_by_type,
                requested_by_user_id, request_context_json
         FROM social_publications WHERE id = 'publication-history-new'`,
      )[0];
      expect(canonicalSnapshot).toMatchObject({
        scheduled_for: null,
        timezone: null,
        target_account_id_snapshot: "linkedin-primary",
        format_snapshot: "carousel",
        body_text_snapshot: "Canonical approved LinkedIn body",
        asset_manifest_json_snapshot: '[{"key":"canonical.png"}]',
        approval_status_snapshot: null,
        approved_at_snapshot: null,
        approved_by_user_id_snapshot: null,
        requested_by_type: "migration",
        requested_by_user_id: null,
      });
      expect(JSON.parse(canonicalSnapshot?.request_context_json || "{}")).toEqual({
        migration: "0023_social_publications_reusable",
        snapshotSource: "canonical_version",
      });

      const legacySnapshot = sqliteRows<{
        target_account_id_snapshot: string | null;
        format_snapshot: string | null;
        body_text_snapshot: string | null;
        asset_manifest_json_snapshot: string | null;
        request_context_json: string;
      }>(
        database,
        `SELECT target_account_id_snapshot, format_snapshot, body_text_snapshot,
                asset_manifest_json_snapshot, request_context_json
         FROM social_publications WHERE id = 'publication-legacy'`,
      )[0];
      expect(legacySnapshot).toMatchObject({
        target_account_id_snapshot: null,
        format_snapshot: "post",
        body_text_snapshot: "Intact legacy body",
        asset_manifest_json_snapshot: '[{"key":"legacy.png"}]',
      });
      expect(JSON.parse(legacySnapshot?.request_context_json || "{}")).toEqual({
        migration: "0023_social_publications_reusable",
        snapshotSource: "legacy_content_bank",
      });

      expect(
        sqliteRows<{
          scheduled_for: string | null;
          timezone: string | null;
          approval_status_snapshot: string | null;
          approved_at_snapshot: string | null;
          approved_by_user_id_snapshot: string | null;
          requested_by_type: string | null;
        }>(
          database,
          `SELECT scheduled_for, timezone, approval_status_snapshot,
                  approved_at_snapshot, approved_by_user_id_snapshot,
                  requested_by_type
           FROM social_publications WHERE id = 'publication-active'`,
        )[0],
      ).toEqual({
        scheduled_for: null,
        timezone: null,
        approval_status_snapshot: "approved",
        approved_at_snapshot: "2026-07-17T12:00:00.000Z",
        approved_by_user_id_snapshot: "owner",
        requested_by_type: "migration",
      });

      const scheduledPublicationId = deterministicId(
        "social-publication-scheduled",
        "version-scheduled",
        "2026-07-21T09:30:00.000Z",
      );
      expect(
        sqliteRows<{
          id: string;
          variant_id: string;
          status: string;
          scheduled_for: string;
          timezone: string;
          target_account_id_snapshot: string;
          format_snapshot: string;
          body_text_snapshot: string;
          asset_manifest_json_snapshot: string;
          approval_status_snapshot: string;
          approved_at_snapshot: string;
          approved_by_user_id_snapshot: string;
          requested_by_type: string;
          requested_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        }>(
          database,
          `SELECT id, variant_id, status, scheduled_for, timezone,
                  target_account_id_snapshot, format_snapshot, body_text_snapshot,
                  asset_manifest_json_snapshot, approval_status_snapshot,
                  approved_at_snapshot, approved_by_user_id_snapshot,
                  requested_by_type, requested_by_user_id, created_at, updated_at
           FROM social_publications WHERE status = 'scheduled'`,
        ),
      ).toEqual([
        {
          id: scheduledPublicationId,
          variant_id: "version-scheduled",
          status: "scheduled",
          scheduled_for: "2026-07-21T09:30:00.000Z",
          timezone: "Europe/Dublin",
          target_account_id_snapshot: "linkedin-primary",
          format_snapshot: "carousel",
          body_text_snapshot: "Canonical approved LinkedIn body",
          asset_manifest_json_snapshot: '[{"key":"canonical.png"}]',
          approval_status_snapshot: "approved",
          approved_at_snapshot: "2026-07-17T12:00:00.000Z",
          approved_by_user_id_snapshot: "owner",
          requested_by_type: "migration",
          requested_by_user_id: null,
          created_at: "2026-07-18T08:00:00.000Z",
          updated_at: "2026-07-18T08:00:00.000Z",
        },
      ]);

      const scheduledEventId = deterministicId(
        "social-event-scheduled",
        "version-scheduled",
        "2026-07-21T09:30:00.000Z",
      );
      const scheduledEvent = sqliteRows<{
        id: string;
        publication_id: string;
        variant_id: string;
        event_type: string;
        payload_json: string;
      }>(
        database,
        `SELECT id, publication_id, variant_id, event_type, payload_json
         FROM social_publication_events WHERE event_type = 'scheduled'`,
      )[0];
      expect(scheduledEvent).toMatchObject({
        id: scheduledEventId,
        publication_id: scheduledPublicationId,
        variant_id: "version-scheduled",
        event_type: "scheduled",
      });
      expect(JSON.parse(scheduledEvent?.payload_json || "{}")).toEqual({
        migration: "0023_social_publications_reusable",
        scheduledFor: "2026-07-21T09:30:00.000Z",
        timezone: "Europe/Dublin",
      });

      expect(
        sqliteRows<{ count: number }>(
          database,
          `SELECT COUNT(*) AS count FROM social_publications
           WHERE id LIKE 'social-publication-scheduled-%'
             AND variant_id IN ('version-active', 'version-x', 'version-draft')`,
        )[0]?.count,
      ).toBe(0);
      expect(
        sqliteRows<{ count: number }>(
          database,
          `SELECT COUNT(*) AS count FROM social_publications
           WHERE variant_id = 'version-scheduled' AND status = 'published'`,
        )[0]?.count,
      ).toBe(2);

      const publicationTableSql = tableSql(database, "social_publications");
      const eventTableSql = tableSql(database, "social_publication_events");
      expect(publicationTableSql).toContain("'scheduled'");
      expect(eventTableSql).toContain("'scheduled'");
      expect(eventTableSql).toContain("'cancelled'");

      const scheduledGuardSql = indexSql(
        database,
        "idx_social_publications_same_time_scheduled",
      );
      const inFlightGuardSql = indexSql(
        database,
        "idx_social_publications_one_in_flight_variant",
      );
      expect(scheduledGuardSql).toContain("variant_id, scheduled_for");
      expect(scheduledGuardSql).toContain("status = 'scheduled'");
      expect(inFlightGuardSql).toContain("status IN ('queued', 'publishing')");
      expect(inFlightGuardSql).not.toContain("'published'");

      expect(
        sqliteExitCode(
          database,
          `INSERT INTO social_publications (
             id, variant_id, site_id, platform, status, scheduled_for
           ) VALUES (
             'duplicate-schedule', 'version-scheduled', 'site-1', 'linkedin',
             'scheduled', '2026-07-21T09:30:00.000Z'
           )`,
        ),
      ).not.toBe(0);
      expect(() =>
        sqliteExec(
          database,
          `INSERT INTO social_publications (
             id, variant_id, site_id, platform, status, scheduled_for
           ) VALUES (
             'next-schedule', 'version-scheduled', 'site-1', 'linkedin',
             'scheduled', '2026-08-21T09:30:00.000Z'
           )`,
        ),
      ).not.toThrow();
      expect(() =>
        sqliteExec(
          database,
          `INSERT INTO social_publications (
             id, variant_id, site_id, platform, status
           ) VALUES (
             'third-published-history', 'version-scheduled', 'site-1', 'linkedin',
             'published'
           )`,
        ),
      ).not.toThrow();
      expect(
        sqliteExitCode(
          database,
          `INSERT INTO social_publications (
             id, variant_id, site_id, platform, status
           ) VALUES (
             'duplicate-in-flight', 'version-active', 'site-1', 'linkedin', 'publishing'
           )`,
        ),
      ).not.toBe(0);
      expect(() =>
        sqliteExec(
          database,
          `INSERT INTO social_publication_events (
             id, publication_id, variant_id, event_type
           ) VALUES (
             'event-cancelled', 'next-schedule', 'version-scheduled', 'cancelled'
           )`,
        ),
      ).not.toThrow();
    });
  });

  it("resumes safely after table rename interruptions and remains idempotent", async () => {
    await withCanonicalDatabase(async (database) => {
      sqliteExec(database, RUNTIME_MIGRATIONS_EXCEPT_0023);
      let failPublicationRenameOnce = true;
      let failEventRenameOnce = true;
      const env = {
        DB: sqliteD1(database, (sql) => {
          if (
            failPublicationRenameOnce &&
            sql.includes(
              "ALTER TABLE social_publications_0023_new RENAME TO social_publications",
            )
          ) {
            failPublicationRenameOnce = false;
            throw new Error("simulated publication rename interruption");
          }
          if (
            failEventRenameOnce &&
            sql.includes(
              "ALTER TABLE social_publication_events_0023_new RENAME TO social_publication_events",
            )
          ) {
            failEventRenameOnce = false;
            throw new Error("simulated event rename interruption");
          }
        }),
      } as Env;

      await expect(ensureCoreRuntimeMigrations(env)).rejects.toThrow(
        "simulated publication rename interruption",
      );
      expect(tableExistsInSqlite(database, "social_publications")).toBe(false);
      expect(tableExistsInSqlite(database, "social_publications_0023_new")).toBe(true);
      expect(
        sqliteRows<{ count: number }>(
          database,
          `SELECT COUNT(*) AS count FROM core_runtime_migrations
           WHERE id = '0023_social_publications_reusable'`,
        )[0]?.count,
      ).toBe(0);

      await expect(ensureCoreRuntimeMigrations(env)).rejects.toThrow(
        "simulated event rename interruption",
      );
      expect(tableExistsInSqlite(database, "social_publications")).toBe(true);
      expect(tableExistsInSqlite(database, "social_publication_events")).toBe(false);
      expect(tableExistsInSqlite(database, "social_publication_events_0023_new")).toBe(
        true,
      );

      await ensureCoreRuntimeMigrations(env);
      resetCoreRuntimeMigrationsForTest();
      await ensureCoreRuntimeMigrations(env);

      expect(tableExistsInSqlite(database, "social_publications")).toBe(true);
      expect(tableExistsInSqlite(database, "social_publications_0023_new")).toBe(false);
      expect(
        sqliteRows<{ count: number }>(
          database,
          `SELECT COUNT(*) AS count FROM social_publications
           WHERE status = 'scheduled' AND variant_id = 'version-scheduled'`,
        )[0]?.count,
      ).toBe(1);
      expect(
        sqliteRows<{ count: number }>(
          database,
          `SELECT COUNT(*) AS count FROM social_publication_events
           WHERE event_type = 'scheduled' AND variant_id = 'version-scheduled'`,
        )[0]?.count,
      ).toBe(1);
      expect(
        sqliteRows<{
          approval_status_snapshot: string | null;
          approved_at_snapshot: string | null;
          approved_by_user_id_snapshot: string | null;
        }>(
          database,
          `SELECT approval_status_snapshot, approved_at_snapshot,
                  approved_by_user_id_snapshot
           FROM social_publications WHERE id = 'publication-active'`,
        )[0],
      ).toEqual({
        approval_status_snapshot: "approved",
        approved_at_snapshot: "2026-07-17T12:00:00.000Z",
        approved_by_user_id_snapshot: "owner",
      });
      expect(
        sqliteRows<{ checksum: string }>(
          database,
          `SELECT checksum FROM core_runtime_migrations
           WHERE id = '0023_social_publications_reusable'`,
        )[0]?.checksum,
      ).toBe("2026-07-18-social-publications-reusable-v1");
    });
  });
});

function deterministicId(prefix: string, variantId: string, scheduledFor: string): string {
  return `${prefix}-${hexUtf8(variantId)}-${hexUtf8(scheduledFor)}`;
}

function hexUtf8(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function withCanonicalDatabase<T>(
  callback: (database: string) => T | Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "me3-social-publication-migration-"));
  const database = join(directory, "fixture.sqlite");
  try {
    sqliteExec(database, `${CANONICAL_SOCIAL_SCHEMA}\n${CANONICAL_SOCIAL_FIXTURE}`);
    return await callback(database);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function sqliteD1(database: string, beforeRun?: (sql: string) => void): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async all<T>() {
          return { results: sqliteRows<T>(database, bindSql(sql, values)) };
        },
        async first<T>() {
          return sqliteRows<T>(database, bindSql(sql, values))[0] || null;
        },
        async run() {
          const boundSql = bindSql(sql, values);
          beforeRun?.(boundSql);
          sqliteExec(database, boundSql);
          return { success: true };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function sqliteExec(database: string, sql: string): void {
  execFileSync("sqlite3", [database], { input: sql, encoding: "utf8" });
}

function sqliteExitCode(database: string, sql: string): number | null {
  return spawnSync("sqlite3", [database], { input: sql, encoding: "utf8" }).status;
}

function sqliteRows<T>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database], {
    input: sql,
    encoding: "utf8",
  }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}

function bindSql(sql: string, values: unknown[]): string {
  let index = 0;
  let quote = "";
  let output = "";
  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position] || "";
    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[position + 1] === quote) {
          output += quote;
          position += 1;
        } else {
          quote = "";
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === "?") {
      output += sqliteLiteral(values[index]);
      index += 1;
    } else {
      output += character;
    }
  }
  if (index !== values.length) throw new Error("SQLite test binding count mismatch");
  return output;
}

function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function tableExistsInSqlite(database: string, tableName: string): boolean {
  return sqliteRows<{ count: number }>(
    database,
    `SELECT COUNT(*) AS count FROM sqlite_master
     WHERE type = 'table' AND name = '${tableName}'`,
  )[0]?.count === 1;
}

function tableSql(database: string, tableName: string): string {
  return (
    sqliteRows<{ sql: string }>(
      database,
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
    )[0]?.sql || ""
  );
}

function indexSql(database: string, indexName: string): string {
  return (
    sqliteRows<{ sql: string }>(
      database,
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = '${indexName}'`,
    )[0]?.sql || ""
  );
}

const RUNTIME_MIGRATIONS_EXCEPT_0023 = `
  CREATE TABLE core_runtime_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO core_runtime_migrations (id, checksum) VALUES
    ('0002_mission_task_pins', '2026-06-24-mission-task-pins-v1'),
    ('0009_commerce_default_currency', '2026-06-24-commerce-default-currency-v1'),
    ('0010_ai_usage_events', '2026-06-24-ai-usage-events-v1'),
    ('0011_financial_entry_projects', '2026-06-24-financial-entry-projects-v1'),
    ('0012_drive_files', '2026-06-30-drive-files-v1'),
    ('0014_mobile_pairing', '2026-07-06-mobile-pairing-v1'),
    ('0015_agent_runtime_idempotency', '2026-07-09-agent-runtime-idempotency-v2'),
    ('0016_social_content_packages', '2026-07-10-social-content-packages-v1'),
    ('0017_site_pages_and_commerce', '2026-07-19-site-pages-and-commerce-v1'),
    ('0018_social_publication_idempotency', '2026-07-10-social-publication-idempotency-v1'),
    ('0019_owner_content_search', '2026-07-15-owner-content-search-v1'),
    ('0020_mailbox_thread_index', '2026-07-16-mailbox-thread-index-v1'),
    ('0021_managed_email_inbound_deliveries', '2026-07-18-managed-email-inbound-deliveries-v1'),
    ('0022_social_posts_canonical', '2026-07-18-social-posts-canonical-v1'),
    ('0024_social_suggestions', '2026-07-18-social-suggestions-v2'),
    ('0025_social_posting_plans', '2026-07-18-social-posting-plans-v1'),
    ('0026_social_carousels', '2026-07-18-social-carousels-v1'),
    ('0027_managed_runtime_lifecycle', '2026-07-18-managed-runtime-lifecycle-v2'),
    ('0028_journal_entry_revision', '2026-07-23-journal-entry-revision-v1'),
    ('0029_social_media_delivery', '2026-07-21-social-media-delivery-v1'),
    ('0030_social_youtube_tiktok', '2026-07-21-social-youtube-tiktok-v2'),
    ('0031_social_publication_formats', '2026-07-25-social-publication-formats-v1'),
    ('0032_social_version_publishing_settings', '2026-07-29-social-version-publishing-settings-v1'),
    ('0033_manual_payments', '2026-07-31-manual-payments-v1'),
    ('0034_owner_onboarding', '2026-07-31-owner-onboarding-v1'),
    ('0035_calendar_source_event_dismissals', '2026-08-18-calendar-source-event-dismissals-v1'),
    ('0036_calendar_push_notifications', '2026-08-19-calendar-push-notifications-v1'),
    ('0037_event_booking_capacity', '2026-08-21-event-booking-capacity-v1'),
    ('0038_site_roles', '2026-08-24-site-roles-v1'),
    ('0040_remove_mission_task_review', '2026-08-26-remove-mission-task-review-v1'),
    ('0041_email_campaign_foundations', '2026-08-26-email-campaign-foundations-v1'),
    ('0042_email_campaign_assets', '2026-08-26-email-campaign-assets-v1'),
    ('0043_email_campaign_delivery', '2026-08-26-email-campaign-delivery-v1'),
    ('0044_site_branding', '2026-08-27-site-branding-v1'),
    ('0045_commerce_stripe_provider', '2026-08-31-commerce-stripe-provider-v1'),
    ('0046_business_site_profile_ownership', '2026-08-31-business-site-profile-ownership-v1'),
    ('0047_subscriber_double_opt_in', '2026-09-03-subscriber-double-opt-in-v1'),
    ('0048_mailbox_attachment_staging', '2026-09-09-mailbox-attachment-staging-v1');
`;

const CANONICAL_SOCIAL_SCHEMA = `
  CREATE TABLE content_bank_items (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    media_manifest_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE social_packages (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    post_slug TEXT NOT NULL,
    post_title_snapshot TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_by TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'site',
    source_ref TEXT,
    source_snapshot TEXT NOT NULL DEFAULT '',
    source_text TEXT NOT NULL DEFAULT '',
    idea_text TEXT NOT NULL DEFAULT '',
    UNIQUE(site_id, post_slug)
  );
  CREATE TABLE social_variants (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'post',
    body_text TEXT NOT NULL,
    asset_manifest_json TEXT NOT NULL DEFAULT '[]',
    approval_status TEXT NOT NULL DEFAULT 'draft',
    scheduled_for TEXT,
    timezone TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    target_account_id TEXT,
    approved_at TEXT,
    approved_by_user_id TEXT
  );
  CREATE TABLE social_publications (
    id TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    platform TEXT NOT NULL
      CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business')),
    status TEXT NOT NULL
      CHECK (status IN ('queued', 'publishing', 'published', 'failed', 'cancelled')),
    platform_post_id TEXT,
    platform_post_url TEXT,
    error_code TEXT,
    error_message TEXT,
    provider_response_json TEXT,
    queued_at TEXT,
    published_at TEXT,
    last_polled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE social_publication_events (
    id TEXT PRIMARY KEY,
    publication_id TEXT,
    variant_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (
      event_type IN ('generated', 'approved', 'queued', 'publishing', 'published', 'failed', 'retried')
    ),
    payload_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_social_publications_status
    ON social_publications(status, created_at DESC);
  CREATE INDEX idx_social_publications_variant
    ON social_publications(variant_id, created_at DESC);
  CREATE UNIQUE INDEX idx_social_publications_one_active_variant
    ON social_publications(variant_id)
    WHERE variant_id LIKE 'social-variant-%'
      AND status IN ('queued', 'publishing');
  CREATE INDEX idx_social_publication_events_publication
    ON social_publication_events(publication_id, created_at ASC);
  CREATE INDEX idx_social_publication_events_variant
    ON social_publication_events(variant_id, created_at ASC);
`;

const CANONICAL_SOCIAL_FIXTURE = `
  INSERT INTO content_bank_items (id, body, media_manifest_json) VALUES
    ('legacy-only', 'Intact legacy body', '[{"key":"legacy.png"}]');

  INSERT INTO social_packages (
    id, site_id, post_slug, post_title_snapshot, source_hash, status, created_by,
    created_at, updated_at, source_type, source_ref, source_snapshot, source_text, idea_text
  ) VALUES
    ('post-scheduled', 'site-1', 'scheduled', 'Scheduled', 'hash-scheduled', 'ready',
     'user', '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'site', 'post:scheduled', 'Source', 'Source', 'Idea'),
    ('post-active', 'site-1', 'active', 'Active', 'hash-active', 'ready',
     'user', '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'site', 'post:active', 'Source', 'Source', 'Idea'),
    ('post-x', 'site-1', 'x', 'X', 'hash-x', 'ready',
     'user', '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'site', 'post:x', 'Source', 'Source', 'Idea'),
    ('post-draft', 'site-1', 'draft', 'Draft', 'hash-draft', 'draft',
     'user', '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'site', 'post:draft', 'Source', 'Source', 'Idea');

  INSERT INTO social_variants (
    id, package_id, platform, format, body_text, asset_manifest_json,
    approval_status, scheduled_for, timezone, created_at, updated_at,
    target_account_id, approved_at, approved_by_user_id
  ) VALUES
    ('version-scheduled', 'post-scheduled', 'linkedin', 'carousel',
     'Canonical approved LinkedIn body', '[{"key":"canonical.png"}]', 'approved',
     '2026-07-21T09:30:00.000Z', 'Europe/Dublin',
     '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'linkedin-primary', '2026-07-17T12:00:00.000Z', 'owner'),
    ('version-active', 'post-active', 'linkedin', 'post',
     'Already queued body', '[]', 'approved', '2026-07-22T09:30:00.000Z',
     'Europe/Dublin', '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'linkedin-primary', '2026-07-17T12:00:00.000Z', 'owner'),
    ('version-x', 'post-x', 'x', 'post', 'X body', '[]', 'approved',
     '2026-07-23T09:30:00.000Z', 'Europe/Dublin',
     '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'x-primary', '2026-07-17T12:00:00.000Z', 'owner'),
    ('version-draft', 'post-draft', 'linkedin', 'post', 'Draft body', '[]', 'draft',
     '2026-07-24T09:30:00.000Z', 'Europe/Dublin',
     '2026-07-16T08:00:00.000Z', '2026-07-18T08:00:00.000Z',
     'linkedin-primary', NULL, NULL);

  INSERT INTO social_publications (
    id, variant_id, site_id, platform, status, platform_post_id, platform_post_url,
    error_code, error_message, provider_response_json, queued_at, published_at,
    last_polled_at, created_at, updated_at
  ) VALUES
    ('publication-history-old', 'version-scheduled', 'site-1', 'linkedin', 'published',
     'linkedin-old', 'https://linkedin.example/old', NULL, NULL, '{"provider":"old"}',
     '2026-07-01T09:00:00.000Z', '2026-07-01T09:01:00.000Z', NULL,
     '2026-07-01T08:59:00.000Z', '2026-07-01T09:01:00.000Z'),
    ('publication-history-new', 'version-scheduled', 'site-1', 'linkedin', 'published',
     'linkedin-new', 'https://linkedin.example/new', NULL, NULL, '{"provider":"new"}',
     '2026-07-12T09:00:00.000Z', '2026-07-12T09:01:00.000Z',
     '2026-07-12T09:02:00.000Z', '2026-07-12T08:59:00.000Z',
     '2026-07-12T09:02:00.000Z'),
    ('publication-active', 'version-active', 'site-1', 'linkedin', 'queued',
     NULL, NULL, NULL, NULL, NULL, '2026-07-18T08:05:00.000Z', NULL, NULL,
     '2026-07-18T08:05:00.000Z', '2026-07-18T08:05:00.000Z'),
    ('publication-legacy', 'legacy-only', 'site-1', 'linkedin', 'failed',
     NULL, NULL, 'legacy_error', 'Legacy delivery failed', '{"attempt":3}',
     '2026-06-01T09:00:00.000Z', NULL, '2026-06-01T09:03:00.000Z',
     '2026-06-01T08:59:00.000Z', '2026-06-01T09:03:00.000Z');

  INSERT INTO social_publication_events (
    id, publication_id, variant_id, event_type, payload_json, created_at
  ) VALUES
    ('event-history-old', 'publication-history-old', 'version-scheduled', 'published',
     '{"provider":"old"}', '2026-07-01T09:01:00.000Z'),
    ('event-history-new', 'publication-history-new', 'version-scheduled', 'published',
     '{"provider":"new"}', '2026-07-12T09:01:00.000Z'),
    ('event-active', 'publication-active', 'version-active', 'queued', '{}',
     '2026-07-18T08:05:00.000Z'),
    ('event-legacy', 'publication-legacy', 'legacy-only', 'failed',
     '{"attempt":3}', '2026-06-01T09:03:00.000Z');
`;

import { execFileSync } from "node:child_process";
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
  new URL("../migrations/0022_social_posts_canonical.sql", import.meta.url),
  "utf8",
);

describe("canonical social Post legacy bridge", () => {
  beforeEach(() => {
    resetCoreRuntimeMigrationsForTest();
  });

  it("copies legacy items without deleting history and reparents determinable publications", async () => {
    await withLegacyDatabase((database) => {
      sqliteExec(database, migrationSql);

      const packages = sqliteRows<{
        source_ref: string;
        source_type: string;
        source_text: string;
        idea_text: string;
        status: string;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>(
        database,
        `SELECT source_ref, source_type, source_text, idea_text, status, created_by,
                created_at, updated_at
         FROM social_packages
         ORDER BY source_ref`,
      );
      expect(packages).toEqual([
        {
          source_ref: "content-bank:invalid-json",
          source_type: "legacy_content_bank_read_only",
          source_text: "Archived body",
          idea_text: "Archived body",
          status: "archived",
          created_by: "user",
          created_at: "2026-07-01T08:00:00.000Z",
          updated_at: "2026-07-02T08:00:00.000Z",
        },
        {
          source_ref: "content-bank:legacy/item 1",
          source_type: "legacy_content_bank_read_only",
          source_text: "Exact legacy body",
          idea_text: "Exact legacy body",
          status: "ready",
          created_by: "user",
          created_at: "2026-07-03T08:00:00.000Z",
          updated_at: "2026-07-04T08:00:00.000Z",
        },
        {
          source_ref: "content-bank:posted-item",
          source_type: "legacy_content_bank_read_only",
          source_text: "Already posted",
          idea_text: "Already posted",
          status: "published",
          created_by: "agent",
          created_at: "2026-06-01T08:00:00.000Z",
          updated_at: "2026-06-02T08:00:00.000Z",
        },
        {
          source_ref: "post:existing",
          source_type: "legacy_content_bank_read_only",
          source_text: "Existing source snapshot",
          idea_text: "Existing idea",
          status: "draft",
          created_by: "user",
          created_at: "2026-05-01T08:00:00.000Z",
          updated_at: "2026-05-02T08:00:00.000Z",
        },
      ]);

      const mainPostId = legacyPostId("legacy/item 1");
      const instagramVersionId = legacyVersionId("legacy/item 1", "instagram");
      const instagramBusinessVersionId = legacyVersionId(
        "legacy/item 1",
        "instagram_business",
      );
      const linkedInVersionId = legacyVersionId("legacy/item 1", "linkedin");
      const xVersionId = legacyVersionId("legacy/item 1", "x");
      expect(
        sqliteRows<{
          id: string;
          package_id: string;
          platform: string;
          body_text: string;
          asset_manifest_json: string;
          approval_status: string;
          approved_at: string | null;
          approved_by_user_id: string | null;
          scheduled_for: string | null;
          timezone: string | null;
          published_variant_id: string | null;
          created_at: string;
          updated_at: string;
        }>(
          database,
          `SELECT id, package_id, platform, body_text, asset_manifest_json,
                  approval_status, approved_at, approved_by_user_id, scheduled_for,
                  timezone, published_variant_id, created_at, updated_at
           FROM social_variants
           WHERE package_id = '${mainPostId}'
           ORDER BY platform`,
        ),
      ).toEqual([
        {
          id: instagramVersionId,
          package_id: mainPostId,
          platform: "instagram",
          body_text: "Exact legacy body",
          asset_manifest_json: '[{"url":"/media/legacy.png","type":"image"}]',
          approval_status: "approved",
          approved_at: null,
          approved_by_user_id: "owner",
          scheduled_for: null,
          timezone: null,
          published_variant_id: null,
          created_at: "2026-07-03T08:00:00.000Z",
          updated_at: "2026-07-04T08:00:00.000Z",
        },
        {
          id: instagramBusinessVersionId,
          package_id: mainPostId,
          platform: "instagram_business",
          body_text: "Exact legacy body",
          asset_manifest_json: '[{"url":"/media/legacy.png","type":"image"}]',
          approval_status: "approved",
          approved_at: null,
          approved_by_user_id: "owner",
          scheduled_for: null,
          timezone: null,
          published_variant_id: null,
          created_at: "2026-07-03T08:00:00.000Z",
          updated_at: "2026-07-04T08:00:00.000Z",
        },
        {
          id: linkedInVersionId,
          package_id: mainPostId,
          platform: "linkedin",
          body_text: "Exact legacy body",
          asset_manifest_json: '[{"url":"/media/legacy.png","type":"image"}]',
          approval_status: "approved",
          approved_at: null,
          approved_by_user_id: "owner",
          scheduled_for: "2026-07-20T09:30:00.000Z",
          timezone: "Europe/Dublin",
          published_variant_id: "pub-linkedin-new",
          created_at: "2026-07-03T08:00:00.000Z",
          updated_at: "2026-07-04T08:00:00.000Z",
        },
        {
          id: xVersionId,
          package_id: mainPostId,
          platform: "x",
          body_text: "Exact legacy body",
          asset_manifest_json: '[{"url":"/media/legacy.png","type":"image"}]',
          approval_status: "approved",
          approved_at: null,
          approved_by_user_id: "owner",
          scheduled_for: null,
          timezone: null,
          published_variant_id: null,
          created_at: "2026-07-03T08:00:00.000Z",
          updated_at: "2026-07-04T08:00:00.000Z",
        },
      ]);

      expect(
        sqliteRows<{ id: string; variant_id: string; status: string }>(
          database,
          "SELECT id, variant_id, status FROM social_publications ORDER BY id",
        ),
      ).toEqual([
        { id: "pub-instagram", variant_id: instagramVersionId, status: "failed" },
        { id: "pub-linkedin-new", variant_id: linkedInVersionId, status: "published" },
        { id: "pub-linkedin-old", variant_id: linkedInVersionId, status: "published" },
        { id: "pub-x-queued", variant_id: xVersionId, status: "queued" },
      ]);
      expect(
        sqliteRows<{ id: string; variant_id: string }>(
          database,
          "SELECT id, variant_id FROM social_publication_events ORDER BY id",
        ),
      ).toEqual([
        { id: "event-dangling", variant_id: xVersionId },
        { id: "event-instagram", variant_id: instagramVersionId },
        { id: "event-linkedin-new", variant_id: linkedInVersionId },
        { id: "event-linkedin-old", variant_id: linkedInVersionId },
        { id: "event-malformed", variant_id: "legacy/item 1" },
        { id: "event-orphan", variant_id: linkedInVersionId },
        { id: "event-x", variant_id: xVersionId },
      ]);

      expect(
        sqliteRows<{ count: number }>(
          database,
          "SELECT COUNT(*) AS count FROM content_bank_items",
        )[0]?.count,
      ).toBe(3);
      expect(
        sqliteRows<{ body: string; platforms_json: string; source_type: string }>(
          database,
          `SELECT body, platforms_json, source_type
           FROM content_bank_items WHERE id = 'legacy/item 1'`,
        )[0],
      ).toEqual({
        body: "Exact legacy body",
        platforms_json:
          '[" LinkedIn ","linkedin","X","Instagram","instagram_business","mastodon",12]',
        source_type: "original",
      });

      const indexSql = sqliteRows<{ sql: string }>(
        database,
        `SELECT sql FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_social_publications_one_active_variant'`,
      )[0]?.sql || "";
      expect(indexSql).toContain("status IN ('queued', 'publishing')");
      expect(indexSql).not.toContain("'published'");
    });
  });

  it("runs idempotently through the runtime migration ledger", async () => {
    await withLegacyDatabase(async (database) => {
      sqliteExec(database, RUNTIME_MIGRATIONS_EXCEPT_0022);
      const env = { DB: sqliteD1(database) } as Env;

      await ensureCoreRuntimeMigrations(env);
      resetCoreRuntimeMigrationsForTest();
      await ensureCoreRuntimeMigrations(env);

      expect(
        sqliteRows<{ count: number }>(
          database,
          `SELECT COUNT(*) AS count FROM social_packages
           WHERE source_ref LIKE 'content-bank:%'`,
        )[0]?.count,
      ).toBe(3);
      expect(
        sqliteRows<{ count: number }>(
          database,
          "SELECT COUNT(*) AS count FROM social_variants",
        )[0]?.count,
      ).toBe(5);
      expect(
        sqliteRows<{ checksum: string }>(
          database,
          `SELECT checksum FROM core_runtime_migrations
           WHERE id = '0022_social_posts_canonical'`,
        )[0]?.checksum,
      ).toBe("2026-07-18-social-posts-canonical-v1");
    });
  });
});

function legacyPostId(id: string): string {
  return `social-post-legacy-${hexUtf8(id)}`;
}

function legacyVersionId(id: string, platform: string): string {
  return `social-variant-legacy-${hexUtf8(id)}-${platform}`;
}

function hexUtf8(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function withLegacyDatabase<T>(callback: (database: string) => T | Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "me3-social-post-migration-"));
  const database = join(directory, "fixture.sqlite");
  try {
    sqliteExec(database, `${LEGACY_SOCIAL_SCHEMA}\n${LEGACY_SOCIAL_FIXTURE}`);
    return await callback(database);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function sqliteD1(database: string): D1Database {
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
          sqliteExec(database, bindSql(sql, values));
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

function sqliteRows<T>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database], {
    input: sql,
    encoding: "utf8",
  }).trim();
  return output ? JSON.parse(output) as T[] : [];
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

const RUNTIME_MIGRATIONS_EXCEPT_0022 = `
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
    ('0023_social_publications_reusable', '2026-07-18-social-publications-reusable-v1'),
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

const LEGACY_SOCIAL_SCHEMA = `
  CREATE TABLE content_bank_items (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    media_manifest_json TEXT NOT NULL DEFAULT '[]',
    platforms_json TEXT NOT NULL DEFAULT '[]',
    source_type TEXT NOT NULL DEFAULT 'original',
    source_ref TEXT,
    status TEXT NOT NULL DEFAULT 'bank',
    queue_position INTEGER,
    scheduled_for TEXT,
    timezone TEXT,
    created_by TEXT NOT NULL DEFAULT 'human',
    approved_by_human INTEGER NOT NULL DEFAULT 0,
    evergreen INTEGER NOT NULL DEFAULT 0,
    times_posted INTEGER NOT NULL DEFAULT 0,
    last_posted_at TEXT,
    cooldown_days INTEGER NOT NULL DEFAULT 30,
    tags_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE social_packages (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    post_slug TEXT NOT NULL,
    post_title_snapshot TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    goal TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_by TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'site',
    source_ref TEXT,
    source_snapshot TEXT NOT NULL DEFAULT '',
    idea_text TEXT NOT NULL DEFAULT '',
    UNIQUE(site_id, post_slug)
  );
  CREATE TABLE social_variants (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'post',
    title TEXT,
    body_text TEXT NOT NULL,
    first_comment TEXT,
    hashtags_json TEXT NOT NULL DEFAULT '[]',
    asset_manifest_json TEXT NOT NULL DEFAULT '[]',
    source_excerpt TEXT,
    approval_status TEXT NOT NULL DEFAULT 'draft',
    scheduled_for TEXT,
    timezone TEXT,
    published_variant_id TEXT,
    agent_notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    target_account_id TEXT,
    approved_at TEXT,
    approved_by_user_id TEXT,
    UNIQUE(package_id, platform)
  );
  CREATE TABLE social_publications (
    id TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
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
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_social_publications_one_active_variant
    ON social_publications(variant_id)
    WHERE variant_id LIKE 'social-variant-%'
      AND status IN ('queued', 'publishing', 'published');
`;

const LEGACY_SOCIAL_FIXTURE = `
  INSERT INTO social_packages (
    id, site_id, post_slug, post_title_snapshot, source_hash, status, created_by,
    created_at, updated_at, source_type, source_ref, source_snapshot, idea_text
  ) VALUES (
    'existing-post', 'site-1', 'existing', 'Existing', 'existing-hash', 'draft', 'user',
    '2026-05-01T08:00:00.000Z', '2026-05-02T08:00:00.000Z', 'original',
    'post:existing', 'Existing source snapshot', 'Existing idea'
  );
  INSERT INTO content_bank_items (
    id, site_id, user_id, body, media_manifest_json, platforms_json, source_type,
    source_ref, status, queue_position, scheduled_for, timezone, created_by,
    approved_by_human, evergreen, times_posted, last_posted_at, cooldown_days,
    tags_json, notes, created_at, updated_at
  ) VALUES
  (
    'legacy/item 1', 'site-1', 'owner', 'Exact legacy body',
    '[{"url":"/media/legacy.png","type":"image"}]',
    '[" LinkedIn ","linkedin","X","Instagram","instagram_business","mastodon",12]',
    'original', NULL,
    'scheduled', 2, '2026-07-20T09:30:00.000Z', 'Europe/Dublin', 'human', 1,
    1, 2, '2026-06-20T09:30:00.000Z', 30, '["launch"]', 'Keep this note',
    '2026-07-03T08:00:00.000Z', '2026-07-04T08:00:00.000Z'
  ),
  (
    'invalid-json', 'site-1', 'owner', 'Archived body', '[]', 'not-json',
    'imported', 'old:ref', 'archived', NULL, NULL, NULL, 'human', 0, 0, 0,
    NULL, 30, '[]', NULL, '2026-07-01T08:00:00.000Z',
    '2026-07-02T08:00:00.000Z'
  ),
  (
    'posted-item', 'site-1', 'owner', 'Already posted', '[]', '["linkedin"]',
    'reworked', NULL, 'posted', NULL, NULL, NULL, 'agent_suggested', 1, 0, 1,
    '2026-06-02T08:00:00.000Z', 30, '[]', NULL,
    '2026-06-01T08:00:00.000Z', '2026-06-02T08:00:00.000Z'
  );
  INSERT INTO social_publications (
    id, variant_id, site_id, platform, status, queued_at, published_at, created_at, updated_at
  ) VALUES
    ('pub-linkedin-old', 'legacy/item 1', 'site-1', 'linkedin', 'published',
     '2026-06-01T09:00:00.000Z', '2026-06-01T09:01:00.000Z',
     '2026-06-01T09:00:00.000Z', '2026-06-01T09:01:00.000Z'),
    ('pub-linkedin-new', 'legacy/item 1', 'site-1', 'linkedin', 'published',
     '2026-06-20T09:00:00.000Z', '2026-06-20T09:01:00.000Z',
     '2026-06-20T09:00:00.000Z', '2026-06-20T09:01:00.000Z'),
    ('pub-x-queued', 'legacy/item 1', 'site-1', 'x', 'queued',
     '2026-07-04T08:00:00.000Z', NULL,
     '2026-07-04T08:00:00.000Z', '2026-07-04T08:00:00.000Z'),
    ('pub-instagram', 'legacy/item 1', 'site-1', 'instagram', 'failed',
     '2026-05-01T08:00:00.000Z', NULL,
     '2026-05-01T08:00:00.000Z', '2026-05-01T08:01:00.000Z');
  INSERT INTO social_publication_events (
    id, publication_id, variant_id, event_type, payload_json, created_at
  ) VALUES
    ('event-linkedin-old', 'pub-linkedin-old', 'legacy/item 1', 'published',
     '{"platform":"linkedin"}', '2026-06-01T09:01:00.000Z'),
    ('event-linkedin-new', 'pub-linkedin-new', 'legacy/item 1', 'published',
     '{"platform":"linkedin"}', '2026-06-20T09:01:00.000Z'),
    ('event-x', 'pub-x-queued', 'legacy/item 1', 'queued',
     '{"platform":"x"}', '2026-07-04T08:00:00.000Z'),
    ('event-instagram', 'pub-instagram', 'legacy/item 1', 'failed',
     '{"platform":"instagram"}', '2026-05-01T08:01:00.000Z'),
    ('event-orphan', NULL, 'legacy/item 1', 'generated',
     '{"platform":" LinkedIn "}', '2026-05-01T08:00:00.000Z'),
    ('event-dangling', 'missing-publication', 'legacy/item 1', 'approved',
     '{"platform":"x"}', '2026-05-02T08:00:00.000Z'),
    ('event-malformed', NULL, 'legacy/item 1', 'generated',
     '{bad', '2026-05-03T08:00:00.000Z');
`;

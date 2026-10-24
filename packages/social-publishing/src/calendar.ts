import type { SocialPlatform } from "./index";
import { canScheduleSocialPlatform } from "./capabilities";

export type SocialPublicationCalendarState =
  | "planned"
  | "publishing"
  | "published"
  | "failed"
  | "needs_attention";

export type SocialPublicationCalendarEntry = {
  id: string;
  siteId: string;
  postId: string;
  postTitle: string;
  versionId: string;
  versionLabel: string;
  platform: SocialPlatform;
  accountId: string | null;
  accountLabel: string;
  publicationStatus: "scheduled" | "queued" | "publishing" | "published" | "failed";
  calendarState: SocialPublicationCalendarState;
  sourceType: string;
  sourceRef: string | null;
  sourceLabel: string;
  displayAt: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  timezone: string | null;
  platformPostUrl: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

export type ApprovedPostVersionScheduleOption = {
  versionId: string;
  postId: string;
  siteId: string;
  postTitle: string;
  versionLabel: string;
  platform: SocialPlatform;
  accountId: string;
  accountLabel: string;
  sourceLabel: string;
  approvedAt: string;
};

export type SocialPublicationCalendarWindow = {
  start: string;
  end: string;
};

type SocialPublicationCalendarRow = {
  id: string;
  site_id: string;
  post_id: string;
  post_title: string | null;
  version_id: string;
  version_title: string | null;
  platform: SocialPlatform;
  target_account_id_snapshot: string | null;
  account_label: string | null;
  publication_status: SocialPublicationCalendarEntry["publicationStatus"];
  source_type: string;
  source_ref: string | null;
  display_at: string;
  scheduled_for: string | null;
  published_at: string | null;
  timezone: string | null;
  platform_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  updated_at: string;
};

type ApprovedPostVersionScheduleRow = {
  version_id: string;
  post_id: string;
  site_id: string;
  post_title: string | null;
  version_title: string | null;
  platform: SocialPlatform;
  account_id: string;
  account_label: string | null;
  source_type: string;
  approved_at: string;
};

type SocialCalendarEnv = {
  DB: {
    prepare(sql: string): {
      bind(...values: unknown[]): {
        all<T = unknown>(): Promise<{ results?: T[] }>;
      };
    };
  };
};

/**
 * Lists exact approved Versions that Calendar may safely turn into a planned
 * Publication. Draft-only platforms, inactive accounts, imported read-only
 * Posts, and records owned by another user are excluded at the source.
 */
export async function listApprovedPostVersionsForScheduling(
  env: SocialCalendarEnv,
  ownerId: string,
  siteIdInput?: unknown,
): Promise<ApprovedPostVersionScheduleOption[]> {
  const siteId = typeof siteIdInput === "string" ? siteIdInput.trim() : "";
  const rows = await env.DB.prepare(
    `SELECT version.id AS version_id,
            post.id AS post_id,
            post.site_id,
            COALESCE(
              NULLIF(post.idea_text, ''),
              NULLIF(post.post_title_snapshot, ''),
              NULLIF(substr(version.body_text, 1, 120), ''),
              'Untitled Post'
            ) AS post_title,
            version.title AS version_title,
            version.platform,
            account.id AS account_id,
            COALESCE(
              NULLIF(account.display_name, ''),
              NULLIF(account.platform_handle, ''),
              NULLIF(account.platform_account_id, ''),
              account.id
            ) AS account_label,
            post.source_type,
            version.approved_at
     FROM social_variants version
     JOIN social_packages post ON post.id = version.package_id
     JOIN sites site ON site.id = post.site_id
     JOIN social_accounts account
       ON account.id = version.target_account_id
      AND account.user_id = site.user_id
      AND account.site_id = post.site_id
      AND account.platform = version.platform
      AND account.status = 'active'
     WHERE site.user_id = ?
       AND version.approval_status = 'approved'
       AND version.approved_at IS NOT NULL
       AND post.source_type <> 'legacy_content_bank_read_only'
       AND post.status <> 'archived'
       AND (? = '' OR post.site_id = ?)
     ORDER BY julianday(version.approved_at) DESC, version.id DESC`,
  )
    .bind(ownerId, siteId, siteId)
    .all<ApprovedPostVersionScheduleRow>();

  return (rows.results || [])
    .filter((row) => canScheduleSocialPlatform(row.platform))
    .map((row) => ({
      versionId: row.version_id,
      postId: row.post_id,
      siteId: row.site_id,
      postTitle: row.post_title?.trim() || "Untitled Post",
      versionLabel: row.version_title?.trim() || `${platformLabel(row.platform)} Version`,
      platform: row.platform,
      accountId: row.account_id,
      accountLabel: row.account_label?.trim() || row.account_id,
      sourceLabel: sourceLabel(row.source_type),
      approvedAt: row.approved_at,
    }));
}

/**
 * Returns the Social Publishing plugin's read-only Calendar projection.
 *
 * The caller owns plugin readiness checks. This function never creates or
 * updates Calendar rows; each result is projected directly from one canonical
 * Publication inside the requested half-open time window.
 */
export async function listCalendarSocialPublications(
  env: SocialCalendarEnv,
  ownerId: string,
  window: SocialPublicationCalendarWindow,
): Promise<SocialPublicationCalendarEntry[]> {
  const start = normalizeWindowBoundary(window.start);
  const end = normalizeWindowBoundary(window.end);
  if (!start || !end || end <= start) return [];

  const rows = await env.DB.prepare(
    `WITH enriched_publications AS (
       SELECT pub.id,
              pub.site_id,
              post.id AS post_id,
              COALESCE(
                NULLIF(post.idea_text, ''),
                NULLIF(post.post_title_snapshot, ''),
                NULLIF(substr(pub.body_text_snapshot, 1, 120), ''),
                'Untitled Post'
              ) AS post_title,
              version.id AS version_id,
              version.title AS version_title,
              pub.platform,
              pub.target_account_id_snapshot,
              COALESCE(
                NULLIF(account.display_name, ''),
                NULLIF(account.platform_handle, ''),
                NULLIF(account.platform_account_id, ''),
                pub.target_account_id_snapshot,
                'Unknown account'
              ) AS account_label,
              pub.status AS publication_status,
              post.source_type,
              post.source_ref,
              pub.scheduled_for,
              pub.published_at,
              pub.timezone,
              pub.platform_post_url,
              pub.error_code,
              pub.error_message,
              pub.queued_at,
              pub.created_at,
              pub.updated_at,
              (
                SELECT event.created_at
                FROM social_publication_events event
                WHERE event.publication_id = pub.id
                  AND event.event_type = 'failed'
                ORDER BY julianday(event.created_at) DESC, event.id DESC
                LIMIT 1
              ) AS failed_at
       FROM social_publications pub
       JOIN social_variants version ON version.id = pub.variant_id
       JOIN social_packages post ON post.id = version.package_id
       JOIN sites site ON site.id = post.site_id
       LEFT JOIN social_accounts account
         ON account.id = pub.target_account_id_snapshot
        AND account.site_id = pub.site_id
       WHERE site.user_id = ?
         AND post.status != 'archived'
         AND pub.status IN ('scheduled', 'queued', 'publishing', 'published', 'failed')
     ), timed_publications AS (
       SELECT enriched_publications.*,
              CASE
                WHEN error_code = 'outcome_unknown'
                  OR error_code LIKE 'outcome_unknown:%'
                  THEN COALESCE(failed_at, updated_at, queued_at, scheduled_for, created_at)
                WHEN publication_status = 'published'
                  THEN COALESCE(published_at, scheduled_for, queued_at, created_at)
                WHEN publication_status = 'failed'
                  THEN COALESCE(failed_at, scheduled_for, queued_at, updated_at, created_at)
                WHEN publication_status = 'scheduled'
                  THEN scheduled_for
                ELSE COALESCE(scheduled_for, queued_at, created_at)
              END AS display_at
       FROM enriched_publications
     )
     SELECT id, site_id, post_id, post_title, version_id, version_title,
            platform, target_account_id_snapshot, account_label,
            publication_status, source_type, source_ref,
            strftime('%Y-%m-%dT%H:%M:%fZ', display_at) AS display_at,
            scheduled_for, published_at, timezone, platform_post_url,
            error_code, error_message, updated_at
     FROM timed_publications
     WHERE display_at IS NOT NULL
       AND julianday(display_at) >= julianday(?)
       AND julianday(display_at) < julianday(?)
     ORDER BY julianday(display_at) ASC, id ASC`,
  )
    .bind(ownerId, start, end)
    .all<SocialPublicationCalendarRow>();

  return (rows.results || []).map(serializeCalendarPublication);
}

function serializeCalendarPublication(
  row: SocialPublicationCalendarRow,
): SocialPublicationCalendarEntry {
  const accountId = row.target_account_id_snapshot;
  return {
    id: row.id,
    siteId: row.site_id,
    postId: row.post_id,
    postTitle: row.post_title?.trim() || "Untitled Post",
    versionId: row.version_id,
    versionLabel: row.version_title?.trim() || `${platformLabel(row.platform)} Version`,
    platform: row.platform,
    accountId,
    accountLabel: row.account_label?.trim() || accountId || "Unknown account",
    publicationStatus: row.publication_status,
    calendarState: calendarState(row.publication_status, row.error_code),
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceLabel: sourceLabel(row.source_type),
    displayAt: row.display_at,
    scheduledFor: row.scheduled_for,
    publishedAt: row.published_at,
    timezone: row.timezone,
    platformPostUrl: row.platform_post_url,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
  };
}

function calendarState(
  status: SocialPublicationCalendarEntry["publicationStatus"],
  errorCode: string | null,
): SocialPublicationCalendarState {
  if (errorCode === "outcome_unknown" || errorCode?.startsWith("outcome_unknown:")) {
    return "needs_attention";
  }
  if (status === "scheduled") return "planned";
  if (status === "queued" || status === "publishing") return "publishing";
  return status;
}

function sourceLabel(sourceType: string): string {
  if (sourceType === "journal") return "Journal";
  if (sourceType === "mission_task") return "Task";
  if (sourceType === "site") return "Site";
  if (sourceType === "file") return "File";
  if (sourceType === "script") return "Script";
  if (sourceType === "legacy_content_bank_read_only") return "Imported Post";
  return "Pasted text";
}

function platformLabel(platform: SocialPlatform): string {
  if (platform === "linkedin") return "LinkedIn";
  if (platform === "instagram_business") return "Instagram Business";
  if (platform === "instagram") return "Instagram";
  if (platform === "facebook") return "Facebook";
  if (platform === "youtube") return "YouTube";
  if (platform === "tiktok") return "TikTok";
  return "X";
}

function normalizeWindowBoundary(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

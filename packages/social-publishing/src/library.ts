import { canScheduleSocialPlatform } from "./capabilities";
import type { SocialPlatform } from "./index";

/** Search the owner's posted and drafted social posts (the agent's library search). */
export class SocialLibraryInputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "SocialLibraryInputError";
  }
}

type BoundStatement = {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } } | unknown>;
};

type PreparedStatement = {
  bind(...values: unknown[]): BoundStatement;
};

export type SocialLibraryEnv = {
  DB: {
    prepare(sql: string): PreparedStatement;
    batch(statements: BoundStatement[]): Promise<unknown>;
  };
};

export type PostLibrarySearchInput = {
  siteId?: unknown;
  query?: unknown;
  source?: unknown;
  platform?: unknown;
  accountId?: unknown;
  approvalStatus?: unknown;
  deliveryState?: unknown;
  tag?: unknown;
  publishedFrom?: unknown;
  publishedTo?: unknown;
  limit?: unknown;
};

export type PostLibraryItem = {
  postId: string;
  versionId: string;
  siteId: string;
  sourceType: string;
  sourceRef: string | null;
  sourceTitle: string;
  postText: string;
  tags: string[];
  platform: SocialPlatform;
  accountId: string | null;
  accountLabel: string | null;
  approvalStatus: "draft" | "approved" | "rejected";
  deliveryState: "scheduled" | "queued" | "publishing" | "published" | "failed" | "cancelled" | null;
  lastPublishedAt: string | null;
  nextScheduledAt: string | null;
  publishedCount: number;
  eligibleForPostingPlan: boolean;
  updatedAt: string;
};

type LibraryRow = {
  post_id: string;
  version_id: string;
  site_id: string;
  source_type: string;
  source_ref: string | null;
  source_title: string;
  body_text: string;
  tags_json: string;
  platform: SocialPlatform;
  target_account_id: string | null;
  account_label: string | null;
  account_status: string | null;
  approval_status: PostLibraryItem["approvalStatus"];
  delivery_state: PostLibraryItem["deliveryState"];
  last_published_at: string | null;
  next_scheduled_at: string | null;
  published_count: number;
  updated_at: string;
};

export async function searchPostLibrary(
  env: SocialLibraryEnv,
  ownerId: string,
  input: PostLibrarySearchInput = {},
): Promise<PostLibraryItem[]> {
  const siteId = optionalText(input.siteId);
  const query = optionalText(input.query)?.toLowerCase() || null;
  const source = optionalText(input.source)?.toLowerCase() || null;
  const platform = optionalPlatform(input.platform);
  const accountId = optionalText(input.accountId);
  const approvalStatus = optionalEnum(input.approvalStatus, ["draft", "approved", "rejected"]);
  const deliveryState = optionalEnum(input.deliveryState, [
    "scheduled", "queued", "publishing", "published", "failed", "cancelled",
  ]);
  const tag = optionalText(input.tag)?.toLowerCase() || null;
  const publishedFrom = optionalDateTime(input.publishedFrom, "publishedFrom");
  const publishedTo = optionalDateTime(input.publishedTo, "publishedTo");
  if (publishedFrom && publishedTo && Date.parse(publishedFrom) >= Date.parse(publishedTo)) {
    throw new SocialLibraryInputError("publishedFrom must be before publishedTo");
  }
  const limit = boundedInteger(input.limit, 20, 1, 100, "limit");
  const conditions = ["s.user_id = ?", "p.status <> 'archived'"];
  const bindings: unknown[] = [ownerId];

  if (siteId) addCondition(conditions, bindings, "p.site_id = ?", siteId);
  if (platform) addCondition(conditions, bindings, "v.platform = ?", platform);
  if (accountId) addCondition(conditions, bindings, "v.target_account_id = ?", accountId);
  if (approvalStatus) addCondition(conditions, bindings, "v.approval_status = ?", approvalStatus);
  if (deliveryState) {
    addCondition(
      conditions,
      bindings,
      `(SELECT publication.status FROM social_publications publication
        WHERE publication.variant_id = v.id
        ORDER BY COALESCE(publication.published_at, publication.scheduled_for, publication.created_at) DESC,
                 publication.created_at DESC LIMIT 1) = ?`,
      deliveryState,
    );
  }
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    conditions.push(`(
      lower(p.post_title_snapshot) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(p.source_ref, '')) LIKE ? ESCAPE '\\'
      OR lower(p.source_text) LIKE ? ESCAPE '\\'
      OR lower(p.idea_text) LIKE ? ESCAPE '\\'
      OR lower(v.body_text) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM json_each(p.tags_json) tag_value
                 WHERE lower(CAST(tag_value.value AS TEXT)) LIKE ? ESCAPE '\\')
    )`);
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (source) {
    const pattern = `%${escapeLike(source)}%`;
    conditions.push(`(
      lower(p.post_title_snapshot) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(p.source_ref, '')) LIKE ? ESCAPE '\\'
    )`);
    bindings.push(pattern, pattern);
  }
  if (tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(p.tags_json) tag_value
      WHERE lower(CAST(tag_value.value AS TEXT)) = ?
    )`);
    bindings.push(tag);
  }
  if (publishedFrom || publishedTo) {
    const dateConditions = [
      "publication.variant_id = v.id",
      "publication.status = 'published'",
    ];
    if (publishedFrom) {
      dateConditions.push("publication.published_at >= ?");
      bindings.push(publishedFrom);
    }
    if (publishedTo) {
      dateConditions.push("publication.published_at < ?");
      bindings.push(publishedTo);
    }
    conditions.push(`EXISTS (
      SELECT 1 FROM social_publications publication
      WHERE ${dateConditions.join(" AND ")}
    )`);
  }

  const result = await env.DB.prepare(
    `SELECT p.id AS post_id, v.id AS version_id, p.site_id, p.source_type, p.source_ref,
            p.post_title_snapshot AS source_title, v.body_text, p.tags_json, v.platform,
            account.id AS target_account_id,
            COALESCE(NULLIF(account.display_name, ''), NULLIF(account.platform_handle, ''), v.platform)
              AS account_label,
            account.status AS account_status, v.approval_status,
            (SELECT publication.status FROM social_publications publication
             WHERE publication.variant_id = v.id
             ORDER BY COALESCE(publication.published_at, publication.scheduled_for, publication.created_at) DESC,
                      publication.created_at DESC LIMIT 1) AS delivery_state,
            (SELECT MAX(publication.published_at) FROM social_publications publication
             WHERE publication.variant_id = v.id AND publication.status = 'published') AS last_published_at,
            (SELECT MIN(publication.scheduled_for) FROM social_publications publication
             WHERE publication.variant_id = v.id AND publication.status = 'scheduled') AS next_scheduled_at,
            (SELECT COUNT(*) FROM social_publications publication
             WHERE publication.variant_id = v.id AND publication.status = 'published') AS published_count,
            v.updated_at
     FROM social_packages p
     JOIN sites s ON s.id = p.site_id
     JOIN social_variants v ON v.package_id = p.id
     LEFT JOIN social_accounts account
       ON account.id = v.target_account_id
      AND account.user_id = s.user_id
      AND account.site_id = p.site_id
      AND account.platform = v.platform
     WHERE ${conditions.join(" AND ")}
     ORDER BY COALESCE(last_published_at, v.updated_at) DESC, v.updated_at DESC
     LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all<LibraryRow>();

  return (result.results || []).map((row) => ({
    postId: row.post_id,
    versionId: row.version_id,
    siteId: row.site_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceTitle: row.source_title,
    postText: row.body_text,
    tags: parseTags(row.tags_json),
    platform: row.platform,
    accountId: row.target_account_id,
    accountLabel: row.account_label,
    approvalStatus: row.approval_status,
    deliveryState: row.delivery_state || null,
    lastPublishedAt: row.last_published_at,
    nextScheduledAt: row.next_scheduled_at,
    publishedCount: Number(row.published_count) || 0,
    eligibleForPostingPlan:
      row.approval_status === "approved" &&
      row.account_status === "active" &&
      canScheduleSocialPlatform(row.platform),
    updatedAt: row.updated_at,
  }));
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim()))
      : [];
  } catch {
    return [];
  }
}

function optionalPlatform(value: unknown): SocialPlatform | null {
  const platform = optionalText(value);
  if (!platform) return null;
  if (
    platform === "x" ||
    platform === "linkedin" ||
    platform === "instagram" ||
    platform === "instagram_business" ||
    platform === "facebook" ||
    platform === "youtube" ||
    platform === "tiktok"
  ) {
    return platform;
  }
  throw new SocialLibraryInputError("Choose a supported social platform");
}

function optionalEnum<T extends string>(value: unknown, values: readonly T[]): T | null {
  const normalized = optionalText(value);
  if (!normalized) return null;
  if (values.includes(normalized as T)) return normalized as T;
  throw new SocialLibraryInputError("Choose a supported filter value");
}

function optionalDateTime(value: unknown, label: string): string | null {
  const normalized = optionalText(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new SocialLibraryInputError(`${label} must be a valid date`);
  return new Date(timestamp).toISOString();
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new SocialLibraryInputError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addCondition(
  conditions: string[],
  bindings: unknown[],
  sql: string,
  value: unknown,
) {
  conditions.push(sql);
  bindings.push(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

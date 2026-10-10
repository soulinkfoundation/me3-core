import { canScheduleSocialPlatform } from "./capabilities";
import { reviewedPostingPlanCte, reviewedPostingPlanPredicate, sameReviewedPostingPlan } from "./posting-plan-preconditions";
import type { SocialPlatform } from "./index";

type BoundStatement = {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } } | unknown>;
};

type PreparedStatement = {
  bind(...values: unknown[]): BoundStatement;
};

export type SocialPostingPlanEnv = {
  DB: {
    prepare(sql: string): PreparedStatement;
    batch(statements: BoundStatement[]): Promise<unknown>;
  };
};

export const POSTING_WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type PostingWeekday = (typeof POSTING_WEEKDAYS)[number];

export type PreferredPostingTime = {
  day: PostingWeekday;
  localTime: string;
};

export type PreferredPostingTimes = {
  accountId: string;
  siteId: string;
  platform: SocialPlatform;
  accountLabel: string;
  timezone: string;
  times: PreferredPostingTime[];
  minimumGapMinutes: number;
  minimumRepostDays: number | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdatePreferredPostingTimesInput = {
  timezone?: unknown;
  times?: unknown;
  minimumGapMinutes?: unknown;
  minimumRepostDays?: unknown;
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

export type PostingPlanWarningCode =
  | "ambiguous_local_time"
  | "collision_avoided"
  | "insufficient_posts"
  | "nonexistent_local_time"
  | "recent_duplicate"
  | "stale_post"
  | "version_unavailable";

export type PostingPlanWarning = {
  code: PostingPlanWarningCode;
  message: string;
  versionId?: string;
  scheduledFor?: string;
};

export type PostingPlanItemStatus = "suggested" | "reserved" | "scheduled" | "blocked";

export type PostingPlanItem = {
  id: string;
  position: number;
  versionId: string;
  postId: string;
  sourceTitle: string;
  postText: string;
  platform: SocialPlatform;
  accountId: string;
  scheduledFor: string;
  timezone: string;
  isRepost: boolean;
  status: PostingPlanItemStatus;
  publicationId: string | null;
  errorMessage: string | null;
};

export type PostingPlanStatus =
  | "suggested"
  | "confirming"
  | "needs_attention"
  | "confirmed"
  | "expired";

export type PostingPlan = {
  id: string;
  siteId: string;
  accountId: string;
  accountLabel: string;
  platform: SocialPlatform;
  status: PostingPlanStatus;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  requestedCount: number;
  minimumGapMinutes: number;
  minimumRepostDays: number | null;
  warnings: PostingPlanWarning[];
  items: PostingPlanItem[];
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePostingPlanInput = {
  accountId?: unknown;
  versionIds?: unknown;
  windowStart?: unknown;
  windowEnd?: unknown;
  count?: unknown;
};

export class SocialPostingPlanInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 424 = 400,
  ) {
    super(message);
  }
}

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

type AccountRow = {
  id: string;
  site_id: string;
  platform: SocialPlatform;
  account_label: string;
  status: string;
};

type PreferenceRow = AccountRow & {
  timezone: string;
  preferred_times_json: string;
  minimum_gap_minutes: number;
  minimum_repost_days: number | null;
  created_at: string;
  updated_at: string;
};

export async function searchPostLibrary(
  env: SocialPostingPlanEnv,
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
    throw new SocialPostingPlanInputError("publishedFrom must be before publishedTo");
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

export async function getPreferredPostingTimes(
  env: SocialPostingPlanEnv,
  ownerId: string,
  accountIdInput: unknown,
): Promise<PreferredPostingTimes | null> {
  const accountId = requiredText(accountIdInput, "Social account id is required");
  const row = await env.DB.prepare(
    `SELECT account.id, account.site_id, account.platform,
            COALESCE(NULLIF(account.display_name, ''), NULLIF(account.platform_handle, ''), account.platform)
              AS account_label,
            account.status, preference.timezone, preference.preferred_times_json,
            preference.minimum_gap_minutes, preference.minimum_repost_days,
            preference.created_at, preference.updated_at
     FROM social_accounts account
     JOIN sites site ON site.id = account.site_id
     JOIN social_posting_preferences preference ON preference.account_id = account.id
     WHERE account.id = ? AND account.user_id = ? AND site.user_id = ?`,
  )
    .bind(accountId, ownerId, ownerId)
    .first<PreferenceRow>();
  return row ? serializePreference(row) : null;
}

export async function updatePreferredPostingTimes(
  env: SocialPostingPlanEnv,
  ownerId: string,
  accountIdInput: unknown,
  input: UpdatePreferredPostingTimesInput,
): Promise<PreferredPostingTimes> {
  const account = await requireOwnedAccount(env, ownerId, accountIdInput);
  if (account.status !== "active") {
    throw new SocialPostingPlanInputError("Reconnect this social account before saving Preferred posting times", 424);
  }
  const timezone = validTimezone(input.timezone);
  const times = normalizePreferredTimes(input.times);
  const minimumGapMinutes = boundedInteger(
    input.minimumGapMinutes,
    120,
    0,
    10_080,
    "minimumGapMinutes",
  );
  const minimumRepostDays = nullableBoundedInteger(
    input.minimumRepostDays,
    0,
    3_650,
    "minimumRepostDays",
  );
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO social_posting_preferences (
       account_id, timezone, preferred_times_json, minimum_gap_minutes,
       minimum_repost_days, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       timezone = excluded.timezone,
       preferred_times_json = excluded.preferred_times_json,
       minimum_gap_minutes = excluded.minimum_gap_minutes,
       minimum_repost_days = excluded.minimum_repost_days,
       updated_at = excluded.updated_at`,
  )
    .bind(
      account.id,
      timezone,
      JSON.stringify(times),
      minimumGapMinutes,
      minimumRepostDays,
      now,
      now,
    )
    .run();
  const saved = await getPreferredPostingTimes(env, ownerId, account.id);
  if (!saved) throw new SocialPostingPlanInputError("Could not save Preferred posting times");
  return saved;
}

async function requireOwnedAccount(
  env: SocialPostingPlanEnv,
  ownerId: string,
  accountIdInput: unknown,
): Promise<AccountRow> {
  const accountId = requiredText(accountIdInput, "Social account id is required");
  const account = await env.DB.prepare(
    `SELECT account.id, account.site_id, account.platform,
            COALESCE(NULLIF(account.display_name, ''), NULLIF(account.platform_handle, ''), account.platform)
              AS account_label,
            account.status
     FROM social_accounts account
     JOIN sites site ON site.id = account.site_id
     WHERE account.id = ? AND account.user_id = ? AND site.user_id = ?`,
  )
    .bind(accountId, ownerId, ownerId)
    .first<AccountRow>();
  if (!account) throw new SocialPostingPlanInputError("Social account not found", 404);
  return account;
}

function serializePreference(row: PreferenceRow): PreferredPostingTimes {
  return {
    accountId: row.id,
    siteId: row.site_id,
    platform: row.platform,
    accountLabel: row.account_label,
    timezone: row.timezone,
    times: parsePreferredTimes(row.preferred_times_json),
    minimumGapMinutes: Number(row.minimum_gap_minutes),
    minimumRepostDays: row.minimum_repost_days === null ? null : Number(row.minimum_repost_days),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePreferredTimes(value: unknown): PreferredPostingTime[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SocialPostingPlanInputError("Add at least one Preferred posting time");
  }
  if (value.length > 28) {
    throw new SocialPostingPlanInputError("No more than 28 Preferred posting times are supported");
  }
  const normalized = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new SocialPostingPlanInputError("Each Preferred posting time needs a day and local time");
    }
    const record = candidate as Record<string, unknown>;
    const day = optionalText(record.day)?.toLowerCase();
    const localTime = optionalText(record.localTime);
    if (!POSTING_WEEKDAYS.includes(day as PostingWeekday) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime || "")) {
      throw new SocialPostingPlanInputError("Use a weekday and 24-hour local time such as 09:30");
    }
    return { day: day as PostingWeekday, localTime: localTime! };
  });
  const unique = new Map(normalized.map((time) => [`${time.day}:${time.localTime}`, time]));
  return [...unique.values()].sort((left, right) =>
    POSTING_WEEKDAYS.indexOf(left.day) - POSTING_WEEKDAYS.indexOf(right.day) ||
    left.localTime.localeCompare(right.localTime)
  );
}

function parsePreferredTimes(value: string): PreferredPostingTime[] {
  try {
    return normalizePreferredTimes(JSON.parse(value));
  } catch {
    return [];
  }
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

function validTimezone(value: unknown): string {
  const timezone = requiredText(value, "Timezone is required");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new SocialPostingPlanInputError("Choose a valid timezone");
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
    platform === "youtube" ||
    platform === "tiktok"
  ) {
    return platform;
  }
  throw new SocialPostingPlanInputError("Choose a supported social platform");
}

function optionalEnum<T extends string>(value: unknown, values: readonly T[]): T | null {
  const normalized = optionalText(value);
  if (!normalized) return null;
  if (values.includes(normalized as T)) return normalized as T;
  throw new SocialPostingPlanInputError("Choose a supported filter value");
}

function optionalDateTime(value: unknown, label: string): string | null {
  const normalized = optionalText(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new SocialPostingPlanInputError(`${label} must be a valid date`);
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
    throw new SocialPostingPlanInputError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function nullableBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  return boundedInteger(value, minimum, minimum, maximum, label);
}

function requiredText(value: unknown, message: string): string {
  const normalized = optionalText(value);
  if (!normalized) throw new SocialPostingPlanInputError(message);
  return normalized;
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

type PlanCandidateRow = {
  version_id: string;
  post_id: string;
  source_title: string;
  body_text: string;
  format: string;
  asset_manifest_json: string;
  platform: SocialPlatform;
  account_id: string;
  approval_status: string;
  approved_at: string | null;
  last_published_at: string | null;
  published_count: number;
  updated_at: string;
};

type PlanRow = {
  id: string;
  site_id: string;
  account_id: string;
  account_label: string;
  platform: SocialPlatform;
  status: PostingPlanStatus;
  request_json: string;
  warnings_json: string;
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

type PlanItemRow = {
  id: string;
  position: number;
  variant_id: string;
  version_updated_at_snapshot: string;
  approval_status_snapshot: string;
  version_fingerprint: string;
  post_id: string;
  source_title: string;
  body_text: string;
  platform: SocialPlatform;
  account_id: string;
  scheduled_for: string;
  timezone: string;
  is_repost: number;
  status: PostingPlanItemStatus;
  publication_id: string | null;
  error_message: string | null;
};

type PlanRequestSnapshot = {
  windowStart: string;
  windowEnd: string;
  requestedCount: number;
  minimumGapMinutes: number;
  minimumRepostDays: number | null;
  timezone: string;
  versionIds: string[];
};

export async function createPostingPlan(
  env: SocialPostingPlanEnv,
  ownerId: string,
  input: CreatePostingPlanInput,
): Promise<PostingPlan> {
  const account = await requireOwnedAccount(env, ownerId, input.accountId);
  if (account.status !== "active") {
    throw new SocialPostingPlanInputError("Reconnect this social account before making a Posting plan", 424);
  }
  if (!canScheduleSocialPlatform(account.platform)) {
    throw new SocialPostingPlanInputError(
      `${platformLabel(account.platform)} Versions are draft-only and cannot be added to a Posting plan`,
      403,
    );
  }
  const preference = await getPreferredPostingTimes(env, ownerId, account.id);
  if (!preference) {
    throw new SocialPostingPlanInputError(
      "Set Preferred posting times for this account before making a Posting plan",
      409,
    );
  }
  if (preference.times.length === 0) {
    throw new SocialPostingPlanInputError("Add at least one Preferred posting time", 409);
  }

  const nowMs = Date.now();
  const windowStart = requiredFutureDateTime(input.windowStart, "Posting plan start", nowMs, true);
  const windowEnd = requiredFutureDateTime(input.windowEnd, "Posting plan end", nowMs, false);
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (endMs <= startMs) {
    throw new SocialPostingPlanInputError("Posting plan end must be after its start");
  }
  if (endMs - startMs > 93 * 24 * 60 * 60_000) {
    throw new SocialPostingPlanInputError("Posting plans can cover up to 93 days");
  }
  const requestedCount = boundedInteger(input.count, 1, 1, 20, "count");
  const requestedVersionIds = normalizeVersionIds(input.versionIds);
  const warnings: PostingPlanWarning[] = [];
  const candidates = await listPlanCandidates(env, ownerId, account.id, requestedVersionIds);
  if (requestedVersionIds.length) {
    const available = new Set(candidates.map((candidate) => candidate.version_id));
    for (const versionId of requestedVersionIds) {
      if (available.has(versionId)) continue;
      warnings.push({
        code: "version_unavailable",
        versionId,
        message: "A requested Version is no longer approved, connected, or available for scheduling.",
      });
    }
  }

  const slots = preferredSlotsInWindow(
    preference.times,
    preference.timezone,
    windowStart,
    windowEnd,
    warnings,
  );
  const occupiedTimes = await listOccupiedAccountTimes(
    env,
    account.id,
    startMs - preference.minimumGapMinutes * 60_000,
    endMs + preference.minimumGapMinutes * 60_000,
  );
  const acceptedTimes: number[] = [];
  const usedVersions = new Set<string>();
  const selected: Array<{ candidate: PlanCandidateRow; scheduledFor: string }> = [];
  const warnedRecent = new Set<string>();

  for (const slot of slots) {
    if (selected.length >= requestedCount) break;
    const slotMs = Date.parse(slot);
    if (
      [...occupiedTimes, ...acceptedTimes].some((occupied) =>
        timesConflict(slotMs, occupied, preference.minimumGapMinutes)
      )
    ) {
      warnings.push({
        code: "collision_avoided",
        scheduledFor: slot,
        message: "A Preferred posting time was skipped because this account already has nearby activity.",
      });
      continue;
    }

    const candidate = candidates.find((item) => {
      if (usedVersions.has(item.version_id)) return false;
      if (preference.minimumRepostDays === null || !item.last_published_at) return true;
      const earliestRepost = Date.parse(item.last_published_at) +
        preference.minimumRepostDays * 24 * 60 * 60_000;
      if (slotMs >= earliestRepost) return true;
      if (!warnedRecent.has(item.version_id)) {
        warnedRecent.add(item.version_id);
        warnings.push({
          code: "recent_duplicate",
          versionId: item.version_id,
          scheduledFor: slot,
          message: "A recently published Version was left out until the account's minimum time before reposting has passed.",
        });
      }
      return false;
    });
    if (!candidate) continue;
    usedVersions.add(candidate.version_id);
    acceptedTimes.push(slotMs);
    selected.push({ candidate, scheduledFor: slot });
    if (nowMs - Date.parse(candidate.updated_at) >= 180 * 24 * 60 * 60_000) {
      warnings.push({
        code: "stale_post",
        versionId: candidate.version_id,
        scheduledFor: slot,
        message: "This approved Version is more than six months old. Review it before confirming the Posting plan.",
      });
    }
  }

  if (selected.length < requestedCount) {
    warnings.push({
      code: "insufficient_posts",
      message: `The Posting plan found ${selected.length} safe ${selected.length === 1 ? "Post" : "Posts"} for ${requestedCount} requested times.`,
    });
  }

  const planId = `social-posting-plan-${crypto.randomUUID()}`;
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + 24 * 60 * 60_000).toISOString();
  const request: PlanRequestSnapshot = {
    windowStart,
    windowEnd,
    requestedCount,
    minimumGapMinutes: preference.minimumGapMinutes,
    minimumRepostDays: preference.minimumRepostDays,
    timezone: preference.timezone,
    versionIds: requestedVersionIds,
  };
  const statements: BoundStatement[] = [
    env.DB.prepare(
      `INSERT INTO social_posting_plans (
         id, user_id, site_id, account_id, status, request_json, warnings_json,
         expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'suggested', ?, ?, ?, ?, ?)`,
    ).bind(
      planId,
      ownerId,
      account.site_id,
      account.id,
      JSON.stringify(request),
      JSON.stringify(warnings),
      expiresAt,
      now,
      now,
    ),
  ];
  for (const [position, { candidate, scheduledFor }] of selected.entries()) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO social_posting_plan_items (
           id, plan_id, position, variant_id, version_updated_at_snapshot,
           approval_status_snapshot, version_fingerprint, scheduled_for, timezone,
           is_repost, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, 'suggested', ?, ?)`,
      ).bind(
        `social-posting-plan-item-${crypto.randomUUID()}`,
        planId,
        position,
        candidate.version_id,
        candidate.updated_at,
        await versionFingerprint(candidate),
        scheduledFor,
        preference.timezone,
        Number(candidate.published_count) > 0 ? 1 : 0,
        now,
        now,
      ),
    );
  }
  await env.DB.batch(statements);
  const created = await getPostingPlan(env, ownerId, planId);
  if (!created) throw new SocialPostingPlanInputError("Could not save the Posting plan");
  return created;
}

export async function getPostingPlan(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planIdInput: unknown,
): Promise<PostingPlan | null> {
  const planId = requiredText(planIdInput, "Posting plan id is required");
  let row = await getPlanRow(env, ownerId, planId);
  if (!row) return null;
  if (row.status !== "confirmed" && row.status !== "expired" && Date.parse(row.expires_at) <= Date.now()) {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_posting_plans
         SET status = 'expired', confirmation_token = NULL,
             confirmation_started_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ?
           AND status IN ('suggested', 'confirming', 'needs_attention')`,
      ).bind(now, planId, ownerId),
      env.DB.prepare(
        `UPDATE social_posting_reservations
         SET status = 'released', updated_at = ?
         WHERE status = 'reserved' AND changes() > 0
           AND plan_item_id IN (
             SELECT item.id FROM social_posting_plan_items item
             WHERE item.plan_id = ? AND item.publication_id IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM social_publications publication
                 WHERE publication.id = 'social-publication-' || item.id
               )
           )`,
      ).bind(now, planId),
    ]);
    row = (await getPlanRow(env, ownerId, planId)) || row;
  }
  const items = await env.DB.prepare(
    `SELECT item.id, item.position, item.variant_id, post.id AS post_id,
            item.version_updated_at_snapshot, item.approval_status_snapshot,
            item.version_fingerprint,
            post.post_title_snapshot AS source_title, version.body_text,
            version.platform, plan.account_id, item.scheduled_for, item.timezone,
            item.is_repost, item.status, item.publication_id, item.error_message
     FROM social_posting_plan_items item
     JOIN social_posting_plans plan ON plan.id = item.plan_id
     JOIN social_variants version ON version.id = item.variant_id
     JOIN social_packages post ON post.id = version.package_id
     WHERE item.plan_id = ? AND plan.user_id = ?
     ORDER BY item.position ASC`,
  )
    .bind(planId, ownerId)
    .all<PlanItemRow>();
  return serializePlan(row, items.results || []);
}

async function getPlanRow(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planId: string,
): Promise<PlanRow | null> {
  return env.DB.prepare(
    `SELECT plan.id, plan.site_id, plan.account_id,
            COALESCE(NULLIF(account.display_name, ''), NULLIF(account.platform_handle, ''), account.platform)
              AS account_label,
            account.platform, plan.status, plan.request_json, plan.warnings_json,
            plan.expires_at, plan.confirmed_at, plan.created_at, plan.updated_at
     FROM social_posting_plans plan
     JOIN social_accounts account ON account.id = plan.account_id
     JOIN sites site ON site.id = plan.site_id
     WHERE plan.id = ? AND plan.user_id = ? AND site.user_id = ?`,
  )
    .bind(planId, ownerId, ownerId)
    .first<PlanRow>();
}

async function listPlanCandidates(
  env: SocialPostingPlanEnv,
  ownerId: string,
  accountId: string,
  versionIds: string[],
): Promise<PlanCandidateRow[]> {
  const idCondition = versionIds.length
    ? `AND version.id IN (${versionIds.map(() => "?").join(", ")})`
    : "";
  const result = await env.DB.prepare(
    `SELECT version.id AS version_id, post.id AS post_id,
            post.post_title_snapshot AS source_title, version.body_text,
            version.format, version.asset_manifest_json, version.platform,
            version.target_account_id AS account_id, version.approval_status,
            version.approved_at,
            (SELECT MAX(publication.published_at) FROM social_publications publication
             WHERE publication.variant_id = version.id AND publication.status = 'published')
              AS last_published_at,
            (SELECT COUNT(*) FROM social_publications publication
             WHERE publication.variant_id = version.id AND publication.status = 'published')
              AS published_count,
            version.updated_at
     FROM social_variants version
     JOIN social_packages post ON post.id = version.package_id
     JOIN sites site ON site.id = post.site_id
     JOIN social_accounts account
       ON account.id = version.target_account_id
      AND account.user_id = site.user_id
      AND account.site_id = post.site_id
      AND account.platform = version.platform
      AND account.status = 'active'
     WHERE site.user_id = ? AND version.target_account_id = ?
       AND version.approval_status = 'approved'
       AND post.source_type <> 'legacy_content_bank_read_only'
       ${idCondition}
     ORDER BY CASE WHEN last_published_at IS NULL THEN 0 ELSE 1 END,
              last_published_at ASC, version.updated_at ASC`,
  )
    .bind(ownerId, accountId, ...versionIds)
    .all<PlanCandidateRow>();
  return (result.results || []).filter((row) => canScheduleSocialPlatform(row.platform));
}

async function listOccupiedAccountTimes(
  env: SocialPostingPlanEnv,
  accountId: string,
  fromMs: number,
  toMs: number,
): Promise<number[]> {
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  const [publications, reservations] = await Promise.all([
    env.DB.prepare(
      `SELECT CASE WHEN status = 'published' THEN published_at ELSE scheduled_for END AS activity_at
       FROM social_publications
       WHERE target_account_id_snapshot = ?
         AND (
           (status IN ('scheduled', 'queued', 'publishing')
             AND scheduled_for >= ? AND scheduled_for < ?)
           OR (status = 'published' AND published_at >= ? AND published_at < ?)
         )`,
    ).bind(accountId, from, to, from, to).all<{ activity_at: string }>(),
    env.DB.prepare(
      `SELECT scheduled_for FROM social_posting_reservations
       WHERE account_id = ? AND status = 'reserved'
         AND scheduled_for >= ? AND scheduled_for < ?`,
    ).bind(accountId, from, to).all<{ scheduled_for: string }>(),
  ]);
  return [
    ...(publications.results || []).map((row) => row.activity_at),
    ...(reservations.results || []).map((row) => row.scheduled_for),
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
}

function preferredSlotsInWindow(
  times: PreferredPostingTime[],
  timezone: string,
  windowStart: string,
  windowEnd: string,
  warnings: PostingPlanWarning[],
): string[] {
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  const firstDate = localDateParts(startMs, timezone).date;
  const lastDate = localDateParts(endMs, timezone).date;
  const slots: string[] = [];
  for (let date = firstDate, dayCount = 0; date <= lastDate && dayCount < 96; date = addDate(date, 1), dayCount += 1) {
    const weekday = POSTING_WEEKDAYS[weekdayForDate(date)]!;
    for (const preferred of times) {
      if (preferred.day !== weekday) continue;
      const [year, month, day] = date.split("-").map(Number);
      const [hour, minute] = preferred.localTime.split(":").map(Number);
      const matches = matchingInstantsForLocalTime({ year, month, day, hour, minute }, timezone);
      if (matches.length === 0) {
        warnings.push({
          code: "nonexistent_local_time",
          message: `${weekdayLabel(weekday)} ${preferred.localTime} does not exist in ${timezone} on ${date} because the clocks move forward, so it was skipped.`,
        });
        continue;
      }
      // Repeated wall times occur twice when clocks move back. Always use the
      // earlier instant so the same input has one deterministic result.
      const chosen = matches[0]!;
      const scheduledFor = new Date(chosen).toISOString();
      if (matches.length > 1) {
        warnings.push({
          code: "ambiguous_local_time",
          scheduledFor,
          message: `${weekdayLabel(weekday)} ${preferred.localTime} occurs twice in ${timezone} on ${date}; the earlier instant was selected.`,
        });
      }
      // Posting plan windows are half-open: start is included and end is excluded.
      if (chosen >= startMs && chosen < endMs && chosen > Date.now()) slots.push(scheduledFor);
    }
  }
  return [...new Set(slots)].sort();
}

function matchingInstantsForLocalTime(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): number[] {
  const wallClockUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const matches: number[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = wallClockUtc - offsetMinutes * 60_000;
    const actual = localDateParts(candidate, timezone);
    if (
      actual.year === parts.year && actual.month === parts.month && actual.day === parts.day &&
      actual.hour === parts.hour && actual.minute === parts.minute
    ) {
      matches.push(candidate);
    }
  }
  return [...new Set(matches)].sort((left, right) => left - right);
}

function localDateParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return {
    year,
    month,
    day,
    hour: value("hour"),
    minute: value("minute"),
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function weekdayForDate(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function addDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function timesConflict(left: number, right: number, minimumGapMinutes: number): boolean {
  const difference = Math.abs(left - right);
  return difference === 0 || difference < minimumGapMinutes * 60_000;
}

function normalizeVersionIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SocialPostingPlanInputError("versionIds must be a list");
  const ids = value.map((item) => requiredText(item, "Each Version id is required"));
  const unique = [...new Set(ids)];
  if (unique.length > 50) throw new SocialPostingPlanInputError("No more than 50 Versions can be considered");
  return unique;
}

function requiredFutureDateTime(
  value: unknown,
  label: string,
  nowMs: number,
  allowNow: boolean,
): string {
  const normalized = requiredText(value, `${label} is required`);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || (allowNow ? timestamp < nowMs - 60_000 : timestamp <= nowMs)) {
    throw new SocialPostingPlanInputError(`${label} must be in the future`);
  }
  return new Date(timestamp).toISOString();
}

function serializePlan(row: PlanRow, items: PlanItemRow[]): PostingPlan {
  const request = parseJsonObject(row.request_json) as Partial<PlanRequestSnapshot>;
  return {
    id: row.id,
    siteId: row.site_id,
    accountId: row.account_id,
    accountLabel: row.account_label,
    platform: row.platform,
    status: row.status,
    windowStart: typeof request.windowStart === "string" ? request.windowStart : row.created_at,
    windowEnd: typeof request.windowEnd === "string" ? request.windowEnd : row.expires_at,
    timezone: typeof request.timezone === "string"
      ? request.timezone
      : items[0]?.timezone || "UTC",
    requestedCount: Number(request.requestedCount) || items.length,
    minimumGapMinutes: Number(request.minimumGapMinutes) || 0,
    minimumRepostDays: typeof request.minimumRepostDays === "number"
      ? request.minimumRepostDays
      : null,
    warnings: parseWarnings(row.warnings_json),
    items: items.map((item) => ({
      id: item.id,
      position: Number(item.position),
      versionId: item.variant_id,
      postId: item.post_id,
      sourceTitle: item.source_title,
      postText: item.body_text,
      platform: item.platform,
      accountId: item.account_id,
      scheduledFor: item.scheduled_for,
      timezone: item.timezone,
      isRepost: item.is_repost === 1,
      status: item.status,
      publicationId: item.publication_id,
      errorMessage: item.error_message,
    })),
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseWarnings(value: string): PostingPlanWarning[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as PostingPlanWarning[] : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function versionFingerprint(version: {
  platform: string;
  account_id: string;
  format: string;
  body_text: string;
  asset_manifest_json: string;
  approval_status: string;
  approved_at: string | null;
}): Promise<string> {
  const payload = JSON.stringify({
    platform: version.platform,
    accountId: version.account_id,
    format: version.format,
    bodyText: version.body_text,
    assetManifest: version.asset_manifest_json,
    approvalStatus: version.approval_status,
    approvedAt: version.approved_at,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function platformLabel(platform: SocialPlatform): string {
  if (platform === "linkedin") return "LinkedIn";
  if (platform === "instagram_business") return "Instagram Business";
  if (platform === "instagram") return "Instagram";
  if (platform === "youtube") return "YouTube";
  if (platform === "tiktok") return "TikTok";
  return "X";
}

function weekdayLabel(day: PostingWeekday): string {
  return `${day[0]!.toUpperCase()}${day.slice(1)}`;
}

export type ConfirmPostingPlanInput = {
  confirmed?: unknown;
  expectedUpdatedAt?: unknown;
  expectedPlan?: PostingPlan;
};

export type PostingPlanConfirmationClaim = {
  plan: PostingPlan;
  token: string | null;
  alreadyConfirmed: boolean;
};

export type PostingPlanReservation = {
  id: string;
  planItemId: string;
  versionId: string;
  accountId: string;
  scheduledFor: string;
  timezone: string;
  rangeStart: string;
  rangeEnd: string;
  publicationId: string;
};

type ClaimRow = {
  id: string;
  status: PostingPlanStatus;
  confirmation_token: string | null;
  confirmation_started_at: string | null;
  expires_at: string;
  updated_at: string;
  item_count: number;
};

type ReservationItemRow = {
  id: string;
  variant_id: string;
  scheduled_for: string;
  timezone: string;
  status: PostingPlanItemStatus;
  publication_id: string | null;
  version_updated_at_snapshot: string;
  approval_status_snapshot: string;
  version_fingerprint: string;
  current_updated_at: string;
  current_approval_status: string;
  current_body_text: string;
  current_format: string;
  current_asset_manifest_json: string;
  current_target_account_id: string | null;
  current_approved_at: string | null;
  account_id: string;
  platform: SocialPlatform;
  request_json: string;
};

type ReservationRow = {
  id: string;
  plan_item_id: string;
  account_id: string;
  scheduled_for: string;
  range_start: string;
  range_end: string;
  status: "reserved" | "fulfilled" | "released";
};

export async function claimPostingPlanForConfirmation(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planIdInput: unknown,
  input: ConfirmPostingPlanInput,
): Promise<PostingPlanConfirmationClaim | null> {
  const planId = requiredText(planIdInput, "Posting plan id is required");
  if (input.confirmed !== true) {
    throw new SocialPostingPlanInputError(
      "Explicitly confirm this Posting plan before scheduling any Posts",
      403,
    );
  }
  const expectedUpdatedAt = requiredText(
    input.expectedUpdatedAt,
    "Refresh this Posting plan before confirming it",
  );
  const row = await env.DB.prepare(
    `SELECT plan.id, plan.status, plan.confirmation_token, plan.confirmation_started_at,
            plan.expires_at, plan.updated_at,
            (SELECT COUNT(*) FROM social_posting_plan_items item WHERE item.plan_id = plan.id)
              AS item_count
     FROM social_posting_plans plan
     JOIN sites site ON site.id = plan.site_id
     WHERE plan.id = ? AND plan.user_id = ? AND site.user_id = ?`,
  )
    .bind(planId, ownerId, ownerId)
    .first<ClaimRow>();
  if (!row) return null;
  const existing = await getPostingPlan(env, ownerId, planId);
  if (!existing) return null;
  if (input.expectedPlan && (input.expectedPlan.id !== planId || !sameReviewedPostingPlan(input.expectedPlan, existing))) {
    throw new SocialPostingPlanInputError("This Posting plan changed after it was reviewed. Refresh before confirming.", 409);
  }
  if (row.status === "confirmed") {
    return { plan: existing, token: null, alreadyConfirmed: true };
  }
  if (row.item_count < 1) {
    throw new SocialPostingPlanInputError("This Posting plan has no safe Posts to schedule", 409);
  }
  if (row.status === "expired" || Date.parse(row.expires_at) <= Date.now()) {
    throw new SocialPostingPlanInputError("This Posting plan expired. Make a fresh plan before scheduling.", 409);
  }
  if (row.updated_at !== expectedUpdatedAt) {
    throw new SocialPostingPlanInputError(
      "This Posting plan changed after it was loaded. Refresh before confirming.",
      409,
    );
  }
  const confirmationIsFresh = row.status === "confirming" &&
    row.confirmation_started_at !== null &&
    Date.parse(row.confirmation_started_at) > Date.now() - 5 * 60_000;
  if (confirmationIsFresh) {
    throw new SocialPostingPlanInputError("This Posting plan is already being scheduled", 409);
  }

  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `${input.expectedPlan ? reviewedPostingPlanCte : ""}UPDATE social_posting_plans
     SET status = 'confirming', confirmation_token = ?, confirmation_started_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND updated_at = ?
       AND status IN ('suggested', 'needs_attention', 'confirming')
       ${input.expectedPlan ? reviewedPostingPlanPredicate : ""}
     RETURNING id`,
  )
    .bind(...(input.expectedPlan ? [JSON.stringify(input.expectedPlan)] : []), token, now, now, planId, ownerId, expectedUpdatedAt)
    .first<{ id: string }>();
  if (!claimed) {
    throw new SocialPostingPlanInputError(
      "This Posting plan changed while confirmation started. Refresh and try again.",
      409,
    );
  }
  await env.DB.prepare(
    `UPDATE social_posting_plan_items
     SET status = 'suggested', error_message = NULL, updated_at = ?
     WHERE plan_id = ? AND status = 'blocked' AND publication_id IS NULL`,
  )
    .bind(now, planId)
    .run();
  const plan = await getPostingPlan(env, ownerId, planId);
  if (!plan) return null;
  return { plan, token, alreadyConfirmed: false };
}

export async function reservePostingPlanItem(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planId: string,
  itemId: string,
  confirmationToken: string,
): Promise<PostingPlanReservation> {
  const item = await confirmationItem(env, ownerId, planId, itemId, confirmationToken);
  if (!item) {
    throw new SocialPostingPlanInputError("Posting plan confirmation is no longer active", 409);
  }
  if (item.status === "scheduled" && item.publication_id) {
    return reservationForItem(env, item, item.publication_id);
  }
  if (!canScheduleSocialPlatform(item.platform)) {
    throw new SocialPostingPlanInputError(
      `${platformLabel(item.platform)} Versions are draft-only and cannot be scheduled`,
      403,
    );
  }
  const currentFingerprint = await versionFingerprint({
    platform: item.platform,
    account_id: item.current_target_account_id || "",
    format: item.current_format,
    body_text: item.current_body_text,
    asset_manifest_json: item.current_asset_manifest_json,
    approval_status: item.current_approval_status,
    approved_at: item.current_approved_at,
  });
  if (
    item.current_updated_at !== item.version_updated_at_snapshot ||
    item.current_approval_status !== item.approval_status_snapshot ||
    currentFingerprint !== item.version_fingerprint
  ) {
    await blockPostingPlanItem(
      env,
      ownerId,
      planId,
      item.id,
      confirmationToken,
      "This exact approved Version changed after the Posting plan was reviewed.",
    );
    throw new SocialPostingPlanInputError(
      "A Version changed after this Posting plan was reviewed. Make a fresh plan.",
      409,
    );
  }
  if (Date.parse(item.scheduled_for) <= Date.now()) {
    throw new SocialPostingPlanInputError("A Posting plan time is no longer in the future", 409);
  }
  const existing = await env.DB.prepare(
    `SELECT id, plan_item_id, account_id, scheduled_for, range_start, range_end, status
     FROM social_posting_reservations
     WHERE plan_item_id = ? AND status IN ('reserved', 'fulfilled')`,
  )
    .bind(item.id)
    .first<ReservationRow>();
  const publicationId = postingPlanPublicationId(item.id);
  if (existing) {
    await markItemReserved(env, planId, item.id, confirmationToken);
    return serializeReservation(existing, item, publicationId);
  }

  const request = parseJsonObject(item.request_json) as Partial<PlanRequestSnapshot>;
  // Confirmation uses the exact gap reviewed in this plan. Changing account
  // preferences affects new plans only; it cannot silently rewrite this one.
  const minimumGapMinutes = Number(request.minimumGapMinutes) || 0;
  const scheduledMs = Date.parse(item.scheduled_for);
  const rangeStart = new Date(scheduledMs - minimumGapMinutes * 60_000).toISOString();
  const rangeEnd = new Date(scheduledMs + minimumGapMinutes * 60_000).toISOString();
  const reservationId = `social-posting-reservation-${item.id}`;

  // The collision predicate and reservation write are one INSERT ... SELECT.
  // SQLite serializes competing writers, so different-Version plans cannot both
  // pass the account-wide minimum-gap check before either reservation exists.
  const reserved = await env.DB.prepare(
    `INSERT INTO social_posting_reservations (
       id, plan_item_id, account_id, scheduled_for, range_start, range_end,
       status, created_at, updated_at
     )
     SELECT ?, item.id, plan.account_id, item.scheduled_for, ?, ?, 'reserved', ?, ?
     FROM social_posting_plan_items item
     JOIN social_posting_plans plan ON plan.id = item.plan_id
     JOIN social_variants version ON version.id = item.variant_id
     JOIN social_packages post ON post.id = version.package_id
     JOIN sites site ON site.id = plan.site_id
     JOIN social_accounts account
       ON account.id = plan.account_id
      AND account.user_id = plan.user_id
      AND account.site_id = plan.site_id
      AND account.platform = version.platform
      AND account.status = 'active'
     WHERE item.id = ? AND item.plan_id = ? AND plan.user_id = ?
       AND plan.status = 'confirming' AND plan.confirmation_token = ?
       AND item.status IN ('suggested', 'blocked') AND item.publication_id IS NULL
       AND version.target_account_id = plan.account_id
       AND version.approval_status = item.approval_status_snapshot
       AND version.updated_at = item.version_updated_at_snapshot
       AND post.source_type <> 'legacy_content_bank_read_only'
       AND item.scheduled_for > ?
       AND NOT EXISTS (
         SELECT 1 FROM social_publications publication
         WHERE publication.target_account_id_snapshot = plan.account_id
           AND (
             (
               publication.status IN ('scheduled', 'queued', 'publishing')
               AND (
                 publication.scheduled_for = item.scheduled_for
                 OR (publication.scheduled_for > ? AND publication.scheduled_for < ?)
               )
             )
             OR (
               publication.status = 'published'
               AND (
                 publication.published_at = item.scheduled_for
                 OR (publication.published_at > ? AND publication.published_at < ?)
               )
             )
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM social_posting_reservations reservation
         WHERE reservation.account_id = plan.account_id
           AND reservation.status = 'reserved'
           AND (
             reservation.scheduled_for = item.scheduled_for
             OR (reservation.scheduled_for > ? AND reservation.scheduled_for < ?)
             OR (item.scheduled_for > reservation.range_start
                 AND item.scheduled_for < reservation.range_end)
           )
       )
     ON CONFLICT(id) DO UPDATE SET
       account_id = excluded.account_id,
       scheduled_for = excluded.scheduled_for,
       range_start = excluded.range_start,
       range_end = excluded.range_end,
       status = 'reserved',
       updated_at = excluded.updated_at
     WHERE social_posting_reservations.plan_item_id = excluded.plan_item_id
       AND social_posting_reservations.status = 'released'
     RETURNING id, plan_item_id, account_id, scheduled_for, range_start, range_end, status`,
  )
    .bind(
      reservationId,
      rangeStart,
      rangeEnd,
      new Date().toISOString(),
      new Date().toISOString(),
      item.id,
      planId,
      ownerId,
      confirmationToken,
      new Date().toISOString(),
      rangeStart,
      rangeEnd,
      rangeStart,
      rangeEnd,
      rangeStart,
      rangeEnd,
    )
    .first<ReservationRow>();
  if (!reserved) {
    await blockPostingPlanItem(
      env,
      ownerId,
      planId,
      item.id,
      confirmationToken,
      "This account now has another planned Post too close to this time, or the Version needs review.",
    );
    throw new SocialPostingPlanInputError(
      "A Posting plan time is no longer available. Review the updated plan.",
      409,
    );
  }
  await markItemReserved(env, planId, item.id, confirmationToken);
  return serializeReservation(reserved, item, publicationId);
}

export async function linkPostingPlanItemPublication(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planId: string,
  itemId: string,
  confirmationToken: string,
  publicationId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE social_posting_plan_items
       SET status = 'scheduled', publication_id = ?, error_message = NULL, updated_at = ?
       WHERE id = ? AND plan_id = ?
         AND EXISTS (
           SELECT 1 FROM social_posting_plans plan
           WHERE plan.id = social_posting_plan_items.plan_id AND plan.user_id = ?
             AND plan.status = 'confirming' AND plan.confirmation_token = ?
         )`,
    ).bind(publicationId, now, itemId, planId, ownerId, confirmationToken),
    env.DB.prepare(
      `UPDATE social_posting_reservations
       SET status = 'fulfilled', updated_at = ?
       WHERE plan_item_id = ? AND status = 'reserved' AND changes() > 0`,
    ).bind(now, itemId),
  ]);
}

export async function blockPostingPlanItem(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planId: string,
  itemId: string,
  confirmationToken: string,
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE social_posting_plan_items
       SET status = 'blocked', error_message = ?, updated_at = ?
       WHERE id = ? AND plan_id = ? AND publication_id IS NULL
         AND EXISTS (
           SELECT 1 FROM social_posting_plans plan
           WHERE plan.id = social_posting_plan_items.plan_id AND plan.user_id = ?
             AND plan.status = 'confirming' AND plan.confirmation_token = ?
         )`,
    ).bind(message, now, itemId, planId, ownerId, confirmationToken),
    env.DB.prepare(
      `UPDATE social_posting_reservations
       SET status = 'released', updated_at = ?
       WHERE plan_item_id = ? AND status = 'reserved' AND changes() > 0
         AND NOT EXISTS (
           SELECT 1 FROM social_posting_plan_items item
           WHERE item.id = ? AND item.publication_id IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM social_publications publication
           WHERE publication.id = ?
         )`,
    ).bind(now, itemId, itemId, postingPlanPublicationId(itemId)),
  ]);
}

export async function finishPostingPlanConfirmation(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planId: string,
  confirmationToken: string,
): Promise<PostingPlan> {
  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN item.status = 'scheduled' AND item.publication_id IS NOT NULL THEN 1 ELSE 0 END)
              AS scheduled
     FROM social_posting_plan_items item
     JOIN social_posting_plans plan ON plan.id = item.plan_id
     WHERE item.plan_id = ? AND plan.user_id = ?
       AND plan.status = 'confirming' AND plan.confirmation_token = ?`,
  )
    .bind(planId, ownerId, confirmationToken)
    .first<{ total: number; scheduled: number | null }>();
  if (!counts || counts.total < 1) {
    throw new SocialPostingPlanInputError("Posting plan confirmation is no longer active", 409);
  }
  const complete = counts.total > 0 && counts.scheduled === counts.total;
  const now = new Date().toISOString();
  const finalized = await env.DB.prepare(
    `UPDATE social_posting_plans
     SET status = ?, confirmation_token = NULL, confirmation_started_at = NULL,
         confirmed_at = CASE WHEN ? = 1 THEN ? ELSE confirmed_at END,
         updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'confirming' AND confirmation_token = ?
     RETURNING id`,
  )
    .bind(complete ? "confirmed" : "needs_attention", complete ? 1 : 0, now, now, planId, ownerId, confirmationToken)
    .first<{ id: string }>();
  if (!finalized) {
    throw new SocialPostingPlanInputError("Posting plan confirmation is no longer active", 409);
  }
  const plan = await getPostingPlan(env, ownerId, planId);
  if (!plan) throw new SocialPostingPlanInputError("Posting plan not found", 404);
  return plan;
}

export async function markPostingPlanNeedsAttention(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planId: string,
  confirmationToken: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE social_posting_plans
     SET status = 'needs_attention', confirmation_token = NULL,
         confirmation_started_at = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'confirming' AND confirmation_token = ?`,
  )
    .bind(new Date().toISOString(), planId, ownerId, confirmationToken)
    .run();
}

async function confirmationItem(
  env: SocialPostingPlanEnv,
  ownerId: string,
  planId: string,
  itemId: string,
  confirmationToken: string,
): Promise<ReservationItemRow | null> {
  return env.DB.prepare(
    `SELECT item.id, item.variant_id, item.scheduled_for, item.timezone, item.status,
            item.publication_id, item.version_updated_at_snapshot,
            item.approval_status_snapshot, item.version_fingerprint,
            plan.account_id, version.platform, plan.request_json,
            version.updated_at AS current_updated_at,
            version.approval_status AS current_approval_status,
            version.body_text AS current_body_text, version.format AS current_format,
            version.asset_manifest_json AS current_asset_manifest_json,
            version.target_account_id AS current_target_account_id,
            version.approved_at AS current_approved_at
     FROM social_posting_plan_items item
     JOIN social_posting_plans plan ON plan.id = item.plan_id
     JOIN social_variants version ON version.id = item.variant_id
     WHERE item.id = ? AND item.plan_id = ? AND plan.user_id = ?
       AND plan.status = 'confirming' AND plan.confirmation_token = ?`,
  )
    .bind(itemId, planId, ownerId, confirmationToken)
    .first<ReservationItemRow>();
}

async function markItemReserved(
  env: SocialPostingPlanEnv,
  planId: string,
  itemId: string,
  confirmationToken: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE social_posting_plan_items
     SET status = 'reserved', error_message = NULL, updated_at = ?
     WHERE id = ? AND plan_id = ? AND publication_id IS NULL
       AND EXISTS (
         SELECT 1 FROM social_posting_plans plan
         WHERE plan.id = social_posting_plan_items.plan_id
           AND plan.status = 'confirming' AND plan.confirmation_token = ?
       )`,
  )
    .bind(new Date().toISOString(), itemId, planId, confirmationToken)
    .run();
}

async function reservationForItem(
  env: SocialPostingPlanEnv,
  item: ReservationItemRow,
  publicationId: string,
): Promise<PostingPlanReservation> {
  const row = await env.DB.prepare(
    `SELECT id, plan_item_id, account_id, scheduled_for, range_start, range_end, status
     FROM social_posting_reservations WHERE plan_item_id = ?`,
  )
    .bind(item.id)
    .first<ReservationRow>();
  if (!row) throw new SocialPostingPlanInputError("Posting plan reservation is missing", 409);
  return serializeReservation(row, item, publicationId);
}

function serializeReservation(
  row: ReservationRow,
  item: ReservationItemRow,
  publicationId: string,
): PostingPlanReservation {
  return {
    id: row.id,
    planItemId: row.plan_item_id,
    versionId: item.variant_id,
    accountId: row.account_id,
    scheduledFor: row.scheduled_for,
    timezone: item.timezone,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    publicationId,
  };
}

export function postingPlanPublicationId(itemId: string): string {
  return `social-publication-${itemId}`;
}

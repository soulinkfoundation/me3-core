import type { PostingPlan } from "./posting-plans";

export function sameReviewedPostingPlan(expected: PostingPlan, current: PostingPlan): boolean {
  const serialize = (value: PostingPlan) => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
  return serialize(expected) === serialize(current);
}

const reviewed = (field: string) => `(SELECT json_extract(snapshot, '$.${field}') FROM reviewed)`;
export const reviewedPostingPlanCte = "WITH reviewed AS (SELECT ? AS snapshot)\n";
// One bound JSON snapshot keeps the claim below D1's parameter limit even for a 50-item plan.
export const reviewedPostingPlanPredicate = [
  ...[["id", "id"], ["site_id", "siteId"], ["account_id", "accountId"], ["status", "status"],
    ["expires_at", "expiresAt"], ["confirmed_at", "confirmedAt"], ["created_at", "createdAt"]]
    .map(([column, field]) => `AND ${column} IS ${reviewed(field!)}`),
  `AND json(warnings_json) IS ${reviewed("warnings")}`,
  `AND COALESCE(json_extract(request_json, '$.windowStart'), created_at) IS ${reviewed("windowStart")}`,
  `AND COALESCE(json_extract(request_json, '$.windowEnd'), expires_at) IS ${reviewed("windowEnd")}`,
  `AND COALESCE(NULLIF(CAST(json_extract(request_json, '$.requestedCount') AS INTEGER), 0), json_array_length(${reviewed("items")})) IS ${reviewed("requestedCount")}`,
  `AND COALESCE(CAST(json_extract(request_json, '$.minimumGapMinutes') AS INTEGER), 0) IS ${reviewed("minimumGapMinutes")}`,
  `AND CASE WHEN json_type(request_json, '$.minimumRepostDays') IN ('integer', 'real') THEN json_extract(request_json, '$.minimumRepostDays') ELSE NULL END IS ${reviewed("minimumRepostDays")}`,
  `AND COALESCE(json_extract(request_json, '$.timezone'), (SELECT timezone FROM social_posting_plan_items WHERE plan_id = social_posting_plans.id ORDER BY position LIMIT 1), 'UTC') IS ${reviewed("timezone")}`,
  `AND EXISTS (SELECT 1 FROM social_accounts account WHERE account.id = social_posting_plans.account_id
    AND account.platform IS ${reviewed("platform")}
    AND COALESCE(NULLIF(account.display_name, ''), NULLIF(account.platform_handle, ''), account.platform) IS ${reviewed("accountLabel")})`,
  `AND (SELECT COUNT(*) FROM social_posting_plan_items WHERE plan_id = social_posting_plans.id) = json_array_length(${reviewed("items")})`,
  `AND NOT EXISTS (
    SELECT 1 FROM reviewed, json_each(reviewed.snapshot, '$.items') expected
    LEFT JOIN social_posting_plan_items item ON item.id = json_extract(expected.value, '$.id') AND item.plan_id = social_posting_plans.id
    LEFT JOIN social_variants version ON version.id = item.variant_id
    LEFT JOIN social_packages post ON post.id = version.package_id
    WHERE item.id IS NULL
      OR item.position IS NOT json_extract(expected.value, '$.position')
      OR item.variant_id IS NOT json_extract(expected.value, '$.versionId')
      OR item.scheduled_for IS NOT json_extract(expected.value, '$.scheduledFor')
      OR item.timezone IS NOT json_extract(expected.value, '$.timezone')
      OR item.is_repost IS NOT json_extract(expected.value, '$.isRepost')
      OR item.status IS NOT json_extract(expected.value, '$.status')
      OR item.publication_id IS NOT json_extract(expected.value, '$.publicationId')
      OR item.error_message IS NOT json_extract(expected.value, '$.errorMessage')
      OR post.id IS NOT json_extract(expected.value, '$.postId')
      OR post.post_title_snapshot IS NOT json_extract(expected.value, '$.sourceTitle')
      OR version.body_text IS NOT json_extract(expected.value, '$.postText')
      OR version.platform IS NOT json_extract(expected.value, '$.platform')
      OR social_posting_plans.account_id IS NOT json_extract(expected.value, '$.accountId')
  )`,
].join("\n");

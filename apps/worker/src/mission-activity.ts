import type { Env } from "./types";

/**
 * The agent's "Recent work" (GET /api/mission-control/plugin-activity): one row
 * when ME3 finishes something for the owner, such as a filed receipt, a sent
 * briefing or a published post. Housekeeping crons never write here.
 *
 * Callers record only on the work's own first-time transition, so a retry after
 * the owner clears activity does not backfill. `relatedId` additionally makes
 * a repeat of the same activity a no-op. Recording never changes the outcome of
 * the work: failures are logged and swallowed.
 */
export type OwnerActivityInput = {
  pluginId: string;
  activityType: string;
  title: string;
  summary?: string | null;
  status?: string | null;
  relatedId?: string | null;
};

const MAX_TITLE_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 280;

export async function recordOwnerActivity(env: Pick<Env, "DB">, userId: string, input: OwnerActivityInput): Promise<boolean> {
  const relatedId = input.relatedId || null;
  try {
    const result = await env.DB.prepare(
      `INSERT INTO mission_plugin_activity
         (id, user_id, plugin_id, activity_type, title, summary, status, related_id, metadata_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?
       WHERE ? IS NULL OR NOT EXISTS (
         SELECT 1 FROM mission_plugin_activity
         WHERE user_id = ? AND activity_type = ? AND related_id = ?
       )`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        input.pluginId,
        input.activityType,
        clampText(input.title, MAX_TITLE_LENGTH),
        input.summary ? clampText(input.summary, MAX_SUMMARY_LENGTH) : null,
        input.status || null,
        relatedId,
        new Date().toISOString(),
        relatedId,
        userId,
        input.activityType,
        relatedId,
      )
      .run();
    return (result.meta?.changes || 0) > 0;
  } catch (error) {
    console.warn("Owner activity was not recorded", {
      activityType: input.activityType,
      error: error instanceof Error ? error.message : "Unknown activity error",
    });
    return false;
  }
}

function clampText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

import { SOCIAL_PUBLISHING_PLUGIN_ID } from "./social-publishing";
import { readCachedManagedPlanTier } from "./managed-ai-billing";
import type { Env } from "./types";

/**
 * Plan-gated features (me3-bli3). ME3 Cloud reports the owner's plan tier; the stored id `business` is shown as
 * "Business" and `pro` as "Starter". Until Cloud sends a tier (me3-bli3.1), a managed owner who already switched the
 * experimental Social plugin on keeps it. Self-hosted installs have no hosted plan, so every feature is included.
 */
export type PlanFeatureAccess = "included" | "locked";

const PLAN_INSTALL_SOURCE = "plan";

type InstallationRow = { enabled: number; status: string; setup_state_json: string | null };

function isManaged(env: Env): boolean {
  return env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed";
}

async function readSocialInstallation(env: Env): Promise<InstallationRow | null> {
  return env.DB.prepare(
    "SELECT enabled, status, setup_state_json FROM plugin_installations WHERE plugin_id = ?",
  )
    .bind(SOCIAL_PUBLISHING_PLUGIN_ID)
    .first<InstallationRow>()
    .catch(() => null);
}

function installedByPlan(row: InstallationRow | null): boolean {
  if (!row?.setup_state_json) return false;
  try {
    return (JSON.parse(row.setup_state_json) as { source?: unknown }).source === PLAN_INSTALL_SOURCE;
  } catch {
    return false;
  }
}

export async function socialPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  if (!isManaged(env)) return "included";
  const tier = await readCachedManagedPlanTier(env);
  if (tier === "business") return "included";
  const row = await readSocialInstallation(env);
  // A tier from Cloud is authoritative. Without one (not reported yet, or the cache is missing) nothing is taken
  // away: an enabled plugin keeps working.
  if (tier === null && row && row.enabled !== 0 && row.status !== "disabled") {
    return "included";
  }
  return "locked";
}

/**
 * Switches Social on for owners whose plan includes it (no plugin to activate) and off again after a downgrade:
 * scheduled posts are cancelled, while posted history and connected accounts stay.
 */
export async function syncSocialPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  const access = await socialPlanAccess(env);
  const row = await readSocialInstallation(env);
  if (access === "included") {
    if (row && row.enabled !== 0 && row.status !== "disabled") return access;
    await env.DB.prepare(
      `INSERT INTO plugin_installations (
         plugin_id, version, enabled, status, granted_permissions_json, setup_state_json, installed_at, updated_at
       ) VALUES (?, '0.1.0', 1, 'installed', ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(plugin_id) DO UPDATE SET
         enabled = 1, status = 'installed', setup_state_json = excluded.setup_state_json,
         updated_at = datetime('now')`,
    )
      .bind(
        SOCIAL_PUBLISHING_PLUGIN_ID,
        JSON.stringify(["content.social.publish", "content.social.accounts.manage"]),
        JSON.stringify({ source: PLAN_INSTALL_SOURCE }),
      )
      .run();
    return access;
  }
  if (!row || !installedByPlan(row) || row.enabled === 0) return access;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE social_publications
       SET status = 'cancelled', error_code = 'cancelled:plan_changed',
           error_message = 'Cancelled because your plan no longer includes Social.',
           updated_at = datetime('now')
       WHERE status = 'scheduled'`,
    ),
    env.DB.prepare(
      `UPDATE plugin_installations SET enabled = 0, status = 'disabled', updated_at = datetime('now')
       WHERE plugin_id = ?`,
    ).bind(SOCIAL_PUBLISHING_PLUGIN_ID),
  ]);
  return access;
}

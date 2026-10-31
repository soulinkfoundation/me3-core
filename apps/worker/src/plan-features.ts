import { EMAIL_CAMPAIGNS_PLUGIN_ID } from "@me3-core/plugin-email-campaigns";
import { LANDING_PAGES_PLUGIN_ID } from "@me3-core/plugin-landing-pages";
import { SOCIAL_PUBLISHING_PLUGIN_ID } from "./social-publishing";
import { readCachedManagedPlanTier } from "./managed-ai-billing";
import type { Env } from "./types";

/**
 * Plan-gated features (me3-bli3). ME3 Cloud reports the owner's plan tier; the stored id `business` is shown as
 * "Business" and `pro` as "Starter". Until Cloud sends a tier (me3-bli3.1), a managed owner who already switched an
 * experimental plugin on keeps it. Self-hosted installs have no hosted plan, so every feature is included.
 */
export type PlanFeatureAccess = "included" | "locked";

type PlanFeature = {
  pluginId: string;
  permissions: string[];
  /** Runs when a plan stops including the feature: future work is cancelled, history stays. */
  downgrade: (env: Env) => D1PreparedStatement[];
};

const SOCIAL: PlanFeature = {
  pluginId: SOCIAL_PUBLISHING_PLUGIN_ID,
  permissions: ["content.social.publish", "content.social.accounts.manage"],
  downgrade: (env) => [
    env.DB.prepare(
      `UPDATE social_publications
       SET status = 'cancelled', error_code = 'cancelled:plan_changed',
           error_message = 'Cancelled because your plan no longer includes Social.',
           updated_at = datetime('now')
       WHERE status = 'scheduled'`,
    ),
  ],
};

const CAMPAIGNS: PlanFeature = {
  pluginId: EMAIL_CAMPAIGNS_PLUGIN_ID,
  permissions: ["email.campaigns.manage", "email.campaigns.send"],
  downgrade: (env) => [
    env.DB.prepare(
      `UPDATE email_campaign_recipient_jobs
       SET status = 'cancelled', provider_reason = 'plan_changed', updated_at = datetime('now')
       WHERE status IN ('queued', 'retry_wait', 'paused')
         AND campaign_id IN (SELECT id FROM email_campaigns WHERE status = 'scheduled')`,
    ),
    env.DB.prepare(
      `UPDATE email_campaigns
       SET status = 'cancelled', cancelled_at = datetime('now'),
           failure_reason = 'Cancelled because your plan no longer includes Campaigns.',
           updated_at = datetime('now')
       WHERE status = 'scheduled'`,
    ),
  ],
};

/** Offer pages and the page editor (me3-lnea.4). Pages stay saved after a downgrade; offer pages stop generating. */
const OFFER_PAGES: PlanFeature = {
  pluginId: LANDING_PAGES_PLUGIN_ID,
  permissions: ["sites.landing_pages.manage", "agent.landing_pages.generate"],
  downgrade: () => [],
};

const PLAN_INSTALL_SOURCE = "plan";

type InstallationRow = { enabled: number; status: string; setup_state_json: string | null };

function isManaged(env: Env): boolean {
  return env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed";
}

async function readInstallation(env: Env, pluginId: string): Promise<InstallationRow | null> {
  return env.DB.prepare(
    "SELECT enabled, status, setup_state_json FROM plugin_installations WHERE plugin_id = ?",
  )
    .bind(pluginId)
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

async function planAccess(env: Env, feature: PlanFeature): Promise<PlanFeatureAccess> {
  if (!isManaged(env)) return "included";
  const tier = await readCachedManagedPlanTier(env);
  if (tier === "business") return "included";
  const row = await readInstallation(env, feature.pluginId);
  // A tier from Cloud is authoritative. Without one (not reported yet, or the cache is missing) nothing is taken
  // away: an enabled plugin keeps working.
  if (tier === null && row && row.enabled !== 0 && row.status !== "disabled") {
    return "included";
  }
  return "locked";
}

/**
 * Switches a feature on for owners whose plan includes it (no plugin to activate) and off again after a
 * downgrade, when only its plan-made switch is undone.
 */
async function syncPlanAccess(env: Env, feature: PlanFeature): Promise<PlanFeatureAccess> {
  const access = await planAccess(env, feature);
  const row = await readInstallation(env, feature.pluginId);
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
        feature.pluginId,
        JSON.stringify(feature.permissions),
        JSON.stringify({ source: PLAN_INSTALL_SOURCE }),
      )
      .run();
    return access;
  }
  if (!row || !installedByPlan(row) || row.enabled === 0) return access;
  await env.DB.batch([
    ...feature.downgrade(env),
    env.DB.prepare(
      `UPDATE plugin_installations SET enabled = 0, status = 'disabled', updated_at = datetime('now')
       WHERE plugin_id = ?`,
    ).bind(feature.pluginId),
  ]);
  return access;
}

export function socialPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  return planAccess(env, SOCIAL);
}

export function syncSocialPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  return syncPlanAccess(env, SOCIAL);
}

/** Campaigns follows the same rule as Social: on for Business, no plugin to activate (me3-bli3.2.7). */
export function campaignPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  return planAccess(env, CAMPAIGNS);
}

export function syncCampaignPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  return syncPlanAccess(env, CAMPAIGNS);
}

export function offerPagesPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  return planAccess(env, OFFER_PAGES);
}

export function syncOfferPagesPlanAccess(env: Env): Promise<PlanFeatureAccess> {
  return syncPlanAccess(env, OFFER_PAGES);
}

export async function syncPlanFeatures(env: Env): Promise<void> {
  await syncSocialPlanAccess(env).catch((error) => console.error("Social plan sync failed", error));
  await syncCampaignPlanAccess(env).catch((error) => console.error("Campaigns plan sync failed", error));
  await syncOfferPagesPlanAccess(env).catch((error) => console.error("Offer pages plan sync failed", error));
}

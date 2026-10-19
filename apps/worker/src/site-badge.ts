import { readCachedManagedBillingSource, type ManagedAiBillingSettings } from "./managed-ai-billing";
import type { DbSite, Env } from "./types";

// The "Create your own ME3 site" badge at the foot of published pages.
// "auto" follows the install: on for self-hosted sites and managed free trials,
// off once a managed install is paying, and off on an active custom domain.
export type SiteBadgePreference = "auto" | "shown" | "hidden";
type BillingSource = ManagedAiBillingSettings["billingSource"];

export function normalizeSiteBadgePreference(value: unknown): SiteBadgePreference {
  return value === "shown" || value === "hidden" ? value : "auto";
}

export function siteBadgeAutomaticallyShown(input: { managed: boolean; billingSource: BillingSource }): boolean {
  // An unknown managed billing state stays unbranded rather than risk badging a paying owner's site.
  return !input.managed || input.billingSource === "trial";
}

export function siteBadgeVisible(input: {
  preference: SiteBadgePreference;
  managed: boolean;
  billingSource: BillingSource;
  customDomainActive: boolean;
}): boolean {
  if (input.preference !== "auto") return input.preference === "shown";
  return !input.customDomainActive && siteBadgeAutomaticallyShown(input);
}

export function isManagedInstall(env: Env): boolean {
  return env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed";
}

export async function getSiteBadgePreference(env: Env, ownerId: string): Promise<SiteBadgePreference> {
  // Public pages must render even if this lookup fails, so any error reads as the default.
  try {
    const row = await env.DB.prepare("SELECT site_badge FROM owner_profile WHERE id = ?")
      .bind(ownerId)
      .first<{ site_badge: string | null }>();
    return normalizeSiteBadgePreference(row?.site_badge);
  } catch {
    return "auto";
  }
}

export async function setSiteBadgePreference(env: Env, ownerId: string, preference: SiteBadgePreference): Promise<void> {
  await env.DB.prepare("UPDATE owner_profile SET site_badge = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(preference === "auto" ? null : preference, ownerId)
    .run();
}

export async function getSiteBadgeState(env: Env, ownerId: string) {
  const managed = isManagedInstall(env);
  const [preference, billingSource] = await Promise.all([
    getSiteBadgePreference(env, ownerId),
    managed ? readCachedManagedBillingSource(env) : Promise.resolve(null),
  ]);
  return { preference, automaticallyShown: siteBadgeAutomaticallyShown({ managed, billingSource }) };
}

export async function shouldShowSiteBadge(env: Env, site: DbSite): Promise<boolean> {
  const managed = isManagedInstall(env);
  const [preference, billingSource] = await Promise.all([
    getSiteBadgePreference(env, site.user_id),
    managed ? readCachedManagedBillingSource(env) : Promise.resolve(null),
  ]);
  return siteBadgeVisible({
    preference,
    managed,
    billingSource,
    customDomainActive: Boolean(site.custom_domain && site.custom_domain_status === "active"),
  });
}

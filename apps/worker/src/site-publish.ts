import { generateSiteHtml } from "@me3-core/site-renderer";
import { applyAgentCheckoutSetting, resolveAgentCheckoutPublication } from "./agent-commerce";
import { syncPublishedProfileToSoulinkDirectory } from "./network-directory";
import { buildPublicMe3Profile } from "./public-me-profile";
import { getPaymentReadiness, markUnpayableOffers, paymentReadinessKey, profileHasPaidOffers, type PaymentReadiness } from "./commerce-readiness";
import { offerPagesPlanAccess } from "./plan-features";
import { getSiteImageMetadata } from "./site-images";
import {
  getGeneratedSiteContentType,
  getPublishedSiteBaseUrl,
  getSiteFileText,
  loadPublishManifest,
  loadSiteSourceFiles,
  normalizeSiteFileName,
  parseSiteProfile,
  pruneGeneratedPublicFiles,
  pruneUnreferencedContentAssets,
  pruneUnreferencedSiteSourceFiles,
  putSiteFile,
  savePublishManifest,
  type PublishManifest,
} from "./sites";
import type { Me3Profile } from "me3-protocol";
import type { DbSite, Env } from "./types";

export type SourcePublishResult = {
  publishedAt: string | null;
  /** The me.json the directory should see; null for a private profile or a site without a profile. */
  networkProfile: Me3Profile | null;
};

/** The payment readiness a site's pages were last rendered with (see `republishForPaymentChange`). */
const PAYMENT_READINESS_FILE = "payment-readiness.json";

/**
 * The one publish pipeline: renders the site's `src/` files into `public/`, writes the public
 * me.json, refreshes the manifest and marks the site published. The web wizard's upload, the
 * site editor and the chat-drafted first site all go through here.
 */
export async function publishSiteFromSource(
  env: Env,
  site: DbSite,
  manifest: PublishManifest,
  readiness?: PaymentReadiness,
): Promise<SourcePublishResult> {
  let sourceFiles = await loadSiteSourceFiles(env, site.id);
  const meJson = sourceFiles.get("me.json");
  let isPrivateProfile = false;
  let networkProfile: Me3Profile | null = null;
  if (meJson) {
    const profile = parseSiteProfile(meJson, site.username);
    isPrivateProfile = site.site_role === "profile" && profile.visibility === "private";
    await pruneUnreferencedSiteSourceFiles(env, site.id, profile, manifest);
    sourceFiles = await loadSiteSourceFiles(env, site.id);
    await pruneUnreferencedContentAssets(env, site, sourceFiles, manifest);
    const publishedBaseUrl = await getPublishedSiteBaseUrl(env, site);
    // Only paid offers depend on payment readiness (and reading it may ask Stripe), so skip it otherwise.
    const payment = profileHasPaidOffers(profile) ? readiness || await getPaymentReadiness(env, site.user_id) : null;
    const generatedFiles = isPrivateProfile
      ? {}
      : await generateSiteHtml(
          // Paid offers nobody can pay for yet render as Enquire. republishForPaymentChange keeps this current.
          payment ? markUnpayableOffers(profile, site.username, payment) : profile,
          Array.from(sourceFiles.entries()).map(([name, content]) => ({ name, content })),
          { offerPagesEnabled: (await offerPagesPlanAccess(env)) === "included" },
          { baseUrl: publishedBaseUrl, images: await getSiteImageMetadata(env, site, [...sourceFiles.values()]) },
        );
    // The same marked profile the pages render, so me.json says Enquire wherever the site does.
    networkProfile = buildPublicMe3Profile(payment ? markUnpayableOffers(profile, site.username, payment) : profile, publishedBaseUrl, {
      agentCheckout: isPrivateProfile ? null : await resolveAgentCheckoutPublication(env, site, profile, publishedBaseUrl),
    });
    generatedFiles["me.json"] = JSON.stringify(networkProfile, null, 2);
    for (const [name, content] of Object.entries(generatedFiles)) {
      await putSiteFile(env, site.id, `public/${normalizeSiteFileName(name)}`, content, getGeneratedSiteContentType(name));
    }
    await pruneGeneratedPublicFiles(env, site.id, generatedFiles);
    if (payment) await putSiteFile(env, site.id, PAYMENT_READINESS_FILE, paymentReadinessKey(payment), "application/json");
  }

  manifest.updatedAt = new Date().toISOString();
  await savePublishManifest(env, site.id, manifest);
  await env.DB.prepare(
    isPrivateProfile
      ? "UPDATE sites SET published_at = NULL, updated_at = datetime('now') WHERE id = ?"
      : "UPDATE sites SET published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  )
    .bind(site.id)
    .run();
  return { publishedAt: isPrivateProfile ? null : new Date().toISOString(), networkProfile };
}

/** Tells the directory what /me.json now serves. Only the personal site owns the installation's directory identity. */
export async function syncPublishedProfile(env: Env, site: DbSite, profile: Me3Profile): Promise<void> {
  if (site.site_role !== "profile") return;
  try {
    const served = await applyAgentCheckoutSetting(env, site.user_id, profile);
    await syncPublishedProfileToSoulinkDirectory(env, served);
  } catch (error) {
    console.error("Failed to sync the published profile to Soulink:", error);
  }
}

/**
 * The live pages are rendered at publish, so a payment change (Stripe connected, a pay-directly method saved
 * or removed) republishes the owner's live sites from source: Enquire flips to Book or Buy, and back. Sites
 * already rendered with this readiness, or with no paid offers, are left alone.
 */
export async function republishForPaymentChange(env: Env, ownerId: string): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain, custom_domain_status,
            custom_domain_cf_id, created_at, updated_at, published_at
     FROM sites WHERE user_id = ? AND published_at IS NOT NULL`,
  ).bind(ownerId).all<DbSite>();
  if (!results?.length) return 0;
  const readiness = await getPaymentReadiness(env, ownerId);
  const key = paymentReadinessKey(readiness);
  let republished = 0;
  for (const site of results) {
    try {
      const rendered = await getSiteFileText(env, site.id, PAYMENT_READINESS_FILE);
      if (rendered === key) continue;
      const meJson = await getSiteFileText(env, site.id, "src/me.json");
      const manifest = await loadPublishManifest(env, site.id);
      if (!meJson || !manifest || !profileHasPaidOffers(parseSiteProfile(meJson, site.username))) continue;
      const result = await publishSiteFromSource(env, site, manifest, readiness);
      if (result.networkProfile) await syncPublishedProfile(env, site, result.networkProfile);
      republished += 1;
    } catch (error) {
      console.error(`Failed to republish ${site.username} after a payment change:`, error);
    }
  }
  return republished;
}

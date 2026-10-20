import { generateSiteHtml } from "@me3-core/site-renderer";
import { applyAgentCheckoutSetting, resolveAgentCheckoutPublication } from "./agent-commerce";
import { syncPublishedProfileToSoulinkDirectory } from "./network-directory";
import { buildPublicMe3Profile } from "./public-me-profile";
import { getSiteImageMetadata } from "./site-images";
import {
  getGeneratedSiteContentType,
  getPublishedSiteBaseUrl,
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

/**
 * The one publish pipeline: renders the site's `src/` files into `public/`, writes the public
 * me.json, refreshes the manifest and marks the site published. The web wizard's upload, the
 * site editor and the chat-drafted first site all go through here.
 */
export async function publishSiteFromSource(env: Env, site: DbSite, manifest: PublishManifest): Promise<SourcePublishResult> {
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
    const generatedFiles = isPrivateProfile
      ? {}
      : await generateSiteHtml(
          profile,
          Array.from(sourceFiles.entries()).map(([name, content]) => ({ name, content })),
          undefined,
          { baseUrl: publishedBaseUrl, images: await getSiteImageMetadata(env, site, [...sourceFiles.values()]) },
        );
    networkProfile = buildPublicMe3Profile(profile, publishedBaseUrl, {
      agentCheckout: isPrivateProfile ? null : await resolveAgentCheckoutPublication(env, site, profile, publishedBaseUrl),
    });
    generatedFiles["me.json"] = JSON.stringify(networkProfile, null, 2);
    for (const [name, content] of Object.entries(generatedFiles)) {
      await putSiteFile(env, site.id, `public/${normalizeSiteFileName(name)}`, content, getGeneratedSiteContentType(name));
    }
    await pruneGeneratedPublicFiles(env, site.id, generatedFiles);
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

import { socialPlatformCapabilities, type SocialContentType } from "./capabilities";
import {
  createSocialPost,
  getSocialPost,
  type CreateSocialPostInput,
  type SocialPostDetail,
  type SocialPostEnv,
  type SocialPostFormat,
} from "./content-packages";
import type { SocialMediaAsset, SocialPlatform } from "./index";

/**
 * Share a published site blog post: one social Post per site post, with a
 * Version per connected platform. Text is templated from the owner's own
 * title and excerpt plus the canonical link; nothing is generated.
 */
export type SitePostSnapshot = {
  siteId: string;
  siteUsername: string;
  slug: string;
  title: string;
  excerpt: string;
  /** Blog post format from me.json (article, note, image, video, ...). */
  type: string | null;
  canonicalUrl: string;
  images: Array<{ url: string; altText?: string }>;
  /** A hosted video file (not an embed). */
  video: { url: string; thumbnailUrl?: string } | null;
};

export type SitePostShareTarget = { platform: SocialPlatform; accountId: string };

const SHAREABLE_PLATFORMS: readonly SocialPlatform[] = [
  "x",
  "linkedin",
  "facebook",
  "instagram",
  "instagram_business",
  "youtube",
];
/** X counts every link as 23 characters. */
const X_LINK_LENGTH = 23;
const YOUTUBE_TITLE_LIMIT = 100;

export function sitePostSourceRef(siteUsername: string, slug: string): string {
  return `post:${siteUsername}/${slug}`;
}

/** One target per platform, in a stable order; TikTok is not shared to. */
export function sitePostShareTargets(
  accounts: Array<{ id: string; platform: string; status: string }>,
): SitePostShareTarget[] {
  const targets: SitePostShareTarget[] = [];
  for (const platform of SHAREABLE_PLATFORMS) {
    const account = accounts.find((item) => item.platform === platform && item.status === "active");
    if (account) targets.push({ platform, accountId: account.id });
  }
  return targets;
}

export function buildSitePostShareVersions(
  snapshot: SitePostSnapshot,
  targets: SitePostShareTarget[],
): CreateSocialPostInput["versions"] {
  const versions: CreateSocialPostInput["versions"] = [];
  const isImagePost = snapshot.type === "image" && snapshot.images.length > 0;
  for (const target of targets) {
    const platform = target.platform;
    const isInstagram = platform === "instagram" || platform === "instagram_business";
    if (platform === "youtube" || isInstagram) {
      if (snapshot.video) {
        versions.push({
          platform,
          targetAccountId: target.accountId,
          format: "short_video",
          ...(platform === "youtube" ? { title: clip(snapshot.title, YOUTUBE_TITLE_LIMIT) } : {}),
          bodyText: shareText(platform, snapshot, "short_video"),
          assetManifest: [{ url: snapshot.video.url, kind: "video" }],
        });
        continue;
      }
      // Instagram needs a picture; YouTube needs a video.
      if (platform === "youtube" || snapshot.images.length === 0) continue;
      versions.push(mediaVersion(target, snapshot, snapshot.images));
      continue;
    }
    // Link posts show the site's own preview card; image posts carry the images.
    versions.push(
      isImagePost
        ? mediaVersion(target, snapshot, snapshot.images)
        : {
            platform,
            targetAccountId: target.accountId,
            format: "post",
            bodyText: shareText(platform, snapshot, "text"),
          },
    );
  }
  return versions;
}

/** Create the share Post, or return the one already made for this site post. */
export async function shareSitePost(
  env: SocialPostEnv,
  ownerId: string,
  snapshot: SitePostSnapshot,
  targets: SitePostShareTarget[],
): Promise<{ post: SocialPostDetail; created: boolean }> {
  const sourceRef = sitePostSourceRef(snapshot.siteUsername, snapshot.slug);
  const existing = await findSitePostShare(env, ownerId, snapshot.siteId, sourceRef);
  if (existing) return { post: existing, created: false };

  const versions = buildSitePostShareVersions(snapshot, targets);
  if (!versions.length) {
    throw new SitePostShareError("Connect a social account that can share this post first.", 409);
  }
  const sourceText = [snapshot.title, snapshot.excerpt].filter(Boolean).join("\n\n");
  const post = await createSocialPost(env, ownerId, {
    siteId: snapshot.siteId,
    sourceType: "site",
    sourceRef,
    sourceTitle: snapshot.title,
    sourceSnapshot: JSON.stringify({
      title: snapshot.title,
      excerpt: snapshot.excerpt,
      url: snapshot.canonicalUrl,
      type: snapshot.type,
    }),
    sourceText,
    ideaText: snapshot.title,
    versions,
  });
  return { post, created: true };
}

export async function findSitePostShare(
  env: SocialPostEnv,
  ownerId: string,
  siteId: string,
  sourceRef: string,
): Promise<SocialPostDetail | null> {
  const row = await env.DB.prepare(
    `SELECT p.id
     FROM social_packages p
     JOIN sites s ON s.id = p.site_id
     WHERE p.site_id = ? AND p.source_type = 'site' AND p.source_ref = ? AND s.user_id = ?
     ORDER BY p.created_at DESC
     LIMIT 1`,
  )
    .bind(siteId, sourceRef, ownerId)
    .first<{ id: string }>();
  return row ? getSocialPost(env, ownerId, row.id) : null;
}

export class SitePostShareError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "SitePostShareError";
  }
}

function mediaVersion(
  target: SitePostShareTarget,
  snapshot: SitePostSnapshot,
  images: SitePostSnapshot["images"],
): CreateSocialPostInput["versions"][number] {
  const carouselMax = ruleFor(target.platform, "carousel")?.maxMediaItems ?? 1;
  const picked = images.slice(0, Math.max(1, carouselMax));
  const format: SocialPostFormat = picked.length > 1 ? "carousel" : "image";
  const assetManifest: SocialMediaAsset[] = picked.map((image) => ({
    url: image.url,
    kind: "image",
    ...(image.altText ? { altText: image.altText } : {}),
  }));
  return {
    platform: target.platform,
    targetAccountId: target.accountId,
    format,
    bodyText: shareText(target.platform, snapshot, format === "carousel" ? "carousel" : "image"),
    assetManifest,
  };
}

function ruleFor(platform: SocialPlatform, contentType: SocialContentType) {
  return socialPlatformCapabilities(platform).contentRules.find((rule) => rule.contentType === contentType) || null;
}

/** Title, excerpt and link, trimmed to the platform's limit. */
export function shareText(
  platform: SocialPlatform,
  snapshot: SitePostSnapshot,
  contentType: SocialContentType,
): string {
  const url = snapshot.canonicalUrl;
  const lead = snapshot.excerpt && snapshot.excerpt !== snapshot.title
    ? `${snapshot.title}\n\n${snapshot.excerpt}`
    : snapshot.title;
  if (platform === "x") {
    const room = (ruleFor("x", contentType)?.maxTextCharacters ?? 280) - X_LINK_LENGTH - 2;
    return `${clip(lead, room)}\n\n${url}`;
  }
  const limit = ruleFor(platform, contentType)?.maxTextCharacters ?? 2_200;
  const tail = `\n\n${url}`;
  return `${clip(lead, limit - tail.length)}${tail}`;
}

function clip(text: string, limit: number): string {
  const value = text.trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, Math.max(0, limit - 1));
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length > limit * 0.6 ? atWord : cut).trimEnd()}…`;
}

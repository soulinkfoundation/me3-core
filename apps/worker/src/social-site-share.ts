import { resolveSiteSectionPaths, type Me3SiteProfile } from "@me3-core/site-renderer";
import {
  SitePostShareError,
  findSitePostShare,
  listSocialPublishingAccounts,
  shareSitePost,
  sitePostShareTargets,
  sitePostSourceRef,
  type SitePostSnapshot,
} from "./social-publishing";
import { getPublishedSiteBaseUrl, getSiteFileText } from "./sites";
import type { DbSite, Env } from "./types";

type SitePostMeta = NonNullable<Me3SiteProfile["posts"]>[number] & {
  media?: { url?: string; thumbnail?: string; provider?: string };
};

/** Start sharing a published blog post; the Social composer is where the owner reviews it. */
export async function shareOwnerSitePost(env: Env, ownerId: string, input: { siteId?: unknown; slug?: unknown }) {
  const site = await ownedSite(env, ownerId, input.siteId);
  const snapshot = await sitePostSnapshot(env, site, requiredSlug(input.slug));
  const accounts = (await listSocialPublishingAccounts(env, ownerId))
    .filter((account) => account.siteId === site.id);
  return shareSitePost(env, ownerId, snapshot, sitePostShareTargets(accounts));
}

/** The social Post already made for a blog post, or null. */
export async function findOwnerSitePostShare(env: Env, ownerId: string, input: { siteId?: unknown; slug?: unknown }) {
  const site = await ownedSite(env, ownerId, input.siteId);
  return findSitePostShare(env, ownerId, site.id, sitePostSourceRef(site.username, requiredSlug(input.slug)));
}

async function ownedSite(env: Env, ownerId: string, siteIdInput: unknown): Promise<DbSite> {
  const siteId = typeof siteIdInput === "string" ? siteIdInput.trim() : "";
  // Without a site id, use the owner's profile site.
  const site = siteId
    ? await env.DB.prepare("SELECT * FROM sites WHERE id = ? AND user_id = ?").bind(siteId, ownerId).first<DbSite>()
    : await env.DB.prepare(
      "SELECT * FROM sites WHERE user_id = ? ORDER BY CASE WHEN site_role = 'profile' THEN 0 ELSE 1 END, created_at ASC LIMIT 1",
    ).bind(ownerId).first<DbSite>();
  if (!site) throw new SitePostShareError("Site not found", 404);
  return site;
}

function requiredSlug(input: unknown): string {
  const slug = typeof input === "string" ? input.trim().replace(/^\/+|\/+$/g, "") : "";
  if (!slug || slug.includes("..")) throw new SitePostShareError("slug is required");
  return slug;
}

async function sitePostSnapshot(env: Env, site: DbSite, slug: string): Promise<SitePostSnapshot> {
  const meJson = (await getSiteFileText(env, site.id, "src/me.json")) ||
    (await getSiteFileText(env, site.id, "public/me.json")) ||
    (await getSiteFileText(env, site.id, "me.json"));
  const profile = meJson ? (JSON.parse(meJson) as Me3SiteProfile) : null;
  const meta = (profile?.posts || []).find((post) => post.slug === slug) as SitePostMeta | undefined;
  if (!profile || !meta) throw new SitePostShareError("That post isn't on your site.", 404);
  if (meta.draft) throw new SitePostShareError("Publish the post before sharing it.", 409);

  const base = (await getPublishedSiteBaseUrl(env, site)).replace(/\/+$/, "");
  if (!base) throw new SitePostShareError("Publish your site before sharing posts.", 409);
  const file = (meta.file || `blog/${slug}.md`).replace(/^\/+/, "");
  const markdown = (await getSiteFileText(env, site.id, `src/${file}`)) || "";
  const title = (meta.title || "").trim() || slug.replace(/[-_]+/g, " ");
  const media = meta.media;
  const hostedVideo = meta.type === "video" && media?.url && !/youtube|youtu\.be|vimeo/i.test(`${media.provider || ""} ${media.url}`)
    ? { url: absoluteUrl(media.url, base), ...(media.thumbnail ? { thumbnailUrl: absoluteUrl(media.thumbnail, base) } : {}) }
    : null;
  const images = markdownImages(markdown, base);
  if (!images.length && meta.type === "image" && media?.thumbnail) {
    images.push({ url: absoluteUrl(media.thumbnail, base) });
  }

  return {
    siteId: site.id,
    siteUsername: site.username,
    slug,
    title,
    excerpt: (meta.excerpt || "").trim() || firstParagraph(markdown),
    type: meta.type || null,
    canonicalUrl: `${base}/${resolveSiteSectionPaths(profile).blog}/${slug}`,
    images: images.filter((image) => /^https?:\/\//.test(image.url)),
    video: hostedVideo && /^https?:\/\//.test(hostedVideo.url) ? hostedVideo : null,
  };
}

/** Images in the order they appear, as absolute public URLs. */
export function markdownImages(markdown: string, base: string): Array<{ url: string; altText?: string }> {
  const images: Array<{ url: string; altText?: string; at: number }> = [];
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    images.push({ url: absoluteUrl(match[2]!, base), ...(match[1] ? { altText: match[1] } : {}), at: match.index ?? 0 });
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) {
    const alt = /\balt="([^"]*)"/i.exec(match[0])?.[1];
    images.push({ url: absoluteUrl(match[1]!, base), ...(alt ? { altText: alt } : {}), at: match.index ?? 0 });
  }
  const seen = new Set<string>();
  return images
    .sort((a, b) => a.at - b.at)
    .filter((image) => !seen.has(image.url) && Boolean(seen.add(image.url)))
    .map(({ url, altText }) => (altText ? { url, altText } : { url }));
}

/** The first paragraph of the post as plain text. */
export function firstParagraph(markdown: string): string {
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block
      .replace(/<[^>]+>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
      .replace(/[*_`~]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > 280 ? `${text.slice(0, 279).replace(/\s+\S*$/, "")}…` : text;
  }
  return "";
}

function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, `${base}/`).href;
  } catch {
    return url;
  }
}

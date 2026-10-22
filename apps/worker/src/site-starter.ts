// The owner's first site, drafted by ME3 in one chat turn (me3-5u97.2.1).
//
// The draft is the site's source (`src/me.json`, `src/about.md`): the same files the site editor
// and web wizard read, so Edit on the draft card opens the real thing. Drafting never touches the
// published files or `published_at`; publishing runs the one shared pipeline in site-publish.ts.
import { normalizeSiteTheme, siteThemes, generateSiteHtml, type Me3SiteProfile, type SiteThemeId } from "@me3-core/site-renderer";
import { validateProfile } from "me3-protocol";
import { readOwnerMission, saveOwnerMission } from "@me3-core/plugin-mission-control";
import { buildPublicMe3Profile } from "./public-me-profile";
import { getSiteImageMetadata } from "./site-images";
import { createPersistentSite } from "./site-lifecycle";
import { publishSiteFromSource, syncPublishedProfile } from "./site-publish";
import {
  USERNAME_REGEX,
  createEmptyPublishManifest,
  getOwnerProfile,
  getPublishedSiteBaseUrl,
  getSiteFileText,
  loadPublishManifest,
  loadSiteSourceFiles,
  normalizeUsername,
  parseSiteProfile,
  putSiteFile,
  savePublishManifest,
  sha256Text,
} from "./sites";
import type { DbSite, Env } from "./types";

export const STARTER_THEMES: ReadonlyArray<{ id: SiteThemeId; name: string }> = [
  { id: "warm", name: siteThemes.warm.name },
  { id: "meadow", name: siteThemes.meadow.name },
  { id: "paper", name: siteThemes.paper.name },
];
export const CLARITY_CALL_OFFER_ID = "clarity-call";
export const CLARITY_CALL_TITLE = "Free 30-minute clarity call";
const ABOUT_FILE = "about.md";
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const PLATFORM_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, "instagram"], [/(^|\.)linkedin\.com$/, "linkedin"], [/(^|\.)(x|twitter)\.com$/, "twitter"],
  [/(^|\.)youtube\.com$/, "youtube"], [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)facebook\.com$/, "facebook"],
  [/(^|\.)github\.com$/, "github"], [/(^|\.)threads\.net$/, "threads"], [/(^|\.)bsky\.app$/, "bluesky"],
  [/(^|\.)substack\.com$/, "substack"], [/(^|\.)medium\.com$/, "medium"],
];

export type StarterSiteDraft = {
  username: string; name: string; publicUrl: string; previewPath: string; theme: SiteThemeId;
  themes: Array<{ id: SiteThemeId; name: string }>;
  services: Array<{ title: string; bookable: boolean }>; newsletter: boolean;
  /** What someone would search to find the owner; the Show me demo after publishing uses it. */
  searchQuery: string;
  /** The site already has a photo. Without one the owner adds it in the editor before publishing. */
  hasPhoto: boolean;
};

/** A site-level offer that is not booked through the calendar; me.json lists it as a manual service. */
export type StarterSiteService = { id: string; title: string; description?: string; durationMinutes?: number };

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function block(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/** "Title: description" entries from the model become offers without prices. */
export function parseStarterServices(value: unknown): StarterSiteService[] {
  if (!Array.isArray(value)) return [];
  const services: StarterSiteService[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 6)) {
    const line = text(entry, 500);
    if (!line) continue;
    const [rawTitle, ...rest] = line.split(/\s*[:—–-]\s+/);
    const title = text(rawTitle, 80).replace(/[.:]+$/, "");
    const description = text(rest.join(" "), 400);
    if (!title || /clarity call/i.test(title)) continue;
    const id = `offer-${slug(title) || services.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const duration = /(\d{2,3})\s*-?\s*min/i.exec(line);
    services.push({ id, title, ...(description ? { description } : {}), ...(duration ? { durationMinutes: Number(duration[1]) } : {}) });
  }
  return services;
}

/** Public links keyed the way the renderer and me.json expect; a second plain site becomes website-2. */
export function starterLinks(value: unknown, existing: Record<string, string | undefined> = {}): Record<string, string> {
  const links: Record<string, string> = {};
  if (!Array.isArray(value)) return links;
  const taken = new Set(Object.keys(existing));
  for (const entry of value.slice(0, 8)) {
    const raw = text(entry, 2048).replace(/^http:\/\//i, "https://");
    const href = /^https:\/\//i.test(raw) ? raw : raw && /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(raw) ? `https://${raw}` : "";
    let host = "";
    try { host = new URL(href).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
    if (!host) continue;
    const platform = PLATFORM_HOSTS.find(([pattern]) => pattern.test(host))?.[1] || "website";
    let key = platform;
    for (let index = 2; taken.has(key) || key in links; index += 1) key = `${platform}-${index}`;
    links[key] = href;
  }
  return links;
}

/** The About page: the owner's story, then how to work with them, with no prices invented. */
export function starterAboutMarkdown(about: string, services: StarterSiteService[], ownerName: string): string {
  const offers = [
    `- **${CLARITY_CALL_TITLE}** — the place to start. Free, over video.`,
    ...services.map((service) => `- **${service.title}**${service.description ? ` — ${service.description}` : ""} Ask about it on a call.`),
  ];
  const body = about.startsWith("#") ? about : `# About ${firstName(ownerName)}\n\n${about}`;
  return `${body}\n\n## Ways to work together\n\n${offers.join("\n")}\n`;
}

export async function getOwnerProfileSite(env: Env, ownerId: string): Promise<DbSite | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE user_id = ? AND (site_role = 'profile' OR (site_role IS NULL AND COALESCE(site_type, 'profile') = 'profile'))
       ORDER BY created_at ASC LIMIT 1`,
    ).bind(ownerId).first<DbSite>()) || null
  );
}

async function ensureOwnerProfileSite(env: Env, owner: { id: string; name: string | null; username: string | null }): Promise<DbSite> {
  const existing = await getOwnerProfileSite(env, owner.id);
  if (existing) return existing;
  const candidate = normalizeUsername(owner.username) || slug(owner.name || "");
  const username = USERNAME_REGEX.test(candidate) ? candidate : `me-${crypto.randomUUID().slice(0, 6)}`;
  return createPersistentSite(env, { id: crypto.randomUUID(), ownerId: owner.id, username, role: "profile", templateId: null });
}

async function readSourceProfile(env: Env, site: DbSite): Promise<{ profile: Me3SiteProfile; fromSource: boolean }> {
  const source = await getSiteFileText(env, site.id, "src/me.json");
  const json = source || (await getSiteFileText(env, site.id, "public/me.json")) || "{}";
  return { profile: parseSiteProfile(json, site.username), fromSource: Boolean(source) };
}

async function writeSourceFiles(env: Env, site: DbSite, files: Record<string, string>): Promise<void> {
  const manifest = (await loadPublishManifest(env, site.id)) || createEmptyPublishManifest();
  for (const [name, content] of Object.entries(files)) {
    await putSiteFile(env, site.id, `src/${name}`, content, name.endsWith(".json") ? "application/json" : "text/markdown");
    manifest.sourceFiles[name] = await sha256Text(content);
  }
  await savePublishManifest(env, site.id, manifest);
}

export function starterTheme(value: unknown, fallback: unknown = "warm"): SiteThemeId {
  const requested = normalizeSiteTheme(value);
  if (STARTER_THEMES.some((theme) => theme.id === requested) && typeof value === "string") return requested;
  return normalizeSiteTheme(fallback);
}

/**
 * Writes the draft from one answer. Keeps whatever the site already had that the answer does not
 * replace (photo, banner, other pages, posts, products), validates the public projection against
 * the protocol schema before writing, and saves a private Mission only when there is none.
 */
export async function draftStarterSite(env: Env, ownerId: string, input: Record<string, unknown>): Promise<StarterSiteDraft> {
  const owner = await getOwnerProfile(env, ownerId);
  if (!owner) throw new Error("Owner not found.");
  const bio = text(input.bio, 600);
  const about = block(input.about, 6000);
  if (!bio) throw new Error("bio is required: two or three sentences about the owner's work.");
  if (!about) throw new Error("about is required: the About page in Markdown.");
  const services = parseStarterServices(input.services);
  if (!services.length) throw new Error("services is required: at least one offer as \"Title: description\".");

  const site = await ensureOwnerProfileSite(env, owner);
  const { profile: existing } = await readSourceProfile(env, site);
  // The name on the site is the one the owner typed at setup; the account name can be guessed from their email.
  const siteName = text(existing.name, 100);
  const name = (siteName && siteName.toLowerCase() !== site.username.toLowerCase() ? siteName : "") || text(owner.name, 100) || siteName || site.username;
  const headline = text(input.headline, 120);
  const location = text(input.location, 120) || text(existing.location, 120);
  const theme = starterTheme(input.theme, existing.extensions?.["me3.app/site"]?.theme);
  const presentation = existing.extensions?.["me3.app/site"] || {};
  const existingBook = existing.intents?.book || {};
  const pages = (existing.pages || []).filter((page) => page.slug !== "about" && page.file !== ABOUT_FILE);

  const profile: Me3SiteProfile = {
    ...existing,
    version: existing.version || "0.1",
    visibility: "public",
    name,
    handle: site.username,
    bio: headline ? `**${headline}**\n\n${bio}` : bio,
    ...(location ? { location } : {}),
    links: { ...(existing.links || {}), ...starterLinks(input.links, existing.links || {}) },
    pages: [{ slug: "about", title: "About", file: ABOUT_FILE }, ...pages],
    services,
    intents: {
      ...(existing.intents || {}),
      subscribe: {
        ...(existing.intents?.subscribe || {}),
        enabled: true,
        title: existing.intents?.subscribe?.title || `Notes from ${firstName(name)}`,
        description: existing.intents?.subscribe?.description || "Occasional notes, straight from me. No spam.",
        doubleOptIn: existing.intents?.subscribe?.doubleOptIn ?? true,
      },
      book: {
        ...existingBook,
        enabled: true,
        title: existingBook.title || "Book a call",
        description: existingBook.description || "Pick a time that suits you. We'll talk through where you are and what would help.",
        duration: 30,
        availability: existingBook.availability?.windows && Object.keys(existingBook.availability.windows).length
          ? existingBook.availability
          : { timezone: owner.timezone || "UTC", windows: Object.fromEntries(WEEKDAYS.map((day) => [day, ["09:00-17:00"]])) },
        offers: [
          {
            id: CLARITY_CALL_OFFER_ID,
            title: CLARITY_CALL_TITLE,
            description: "A relaxed 30 minutes to talk through where you are and what would help. No cost, no pressure.",
            duration: 30,
            meetingProvider: "none",
          },
          ...(existingBook.offers || []).filter((offer) => offer.id !== CLARITY_CALL_OFFER_ID),
        ],
      },
    },
    extensions: { ...(existing.extensions || {}), "me3.app/site": { ...presentation, theme } },
  };

  const publicUrl = await getPublishedSiteBaseUrl(env, site);
  const projection = validateProfile(buildPublicMe3Profile(profile, publicUrl));
  if (!projection.valid) {
    throw new Error(`The draft does not fit the ME3 profile schema: ${projection.errors.map((error) => `${error.field} ${error.message}`).join("; ")}`);
  }

  await writeSourceFiles(env, site, {
    "me.json": JSON.stringify(profile, null, 2),
    [ABOUT_FILE]: starterAboutMarkdown(about, services, name),
  });
  await saveMissionIfUnset(env, ownerId, input);

  return {
    username: site.username,
    name,
    publicUrl,
    previewPath: `/api/sites/${encodeURIComponent(site.username)}/draft-preview-html`,
    theme,
    themes: [...STARTER_THEMES],
    services: [{ title: CLARITY_CALL_TITLE, bookable: true }, ...services.map((service) => ({ title: service.title, bookable: false }))],
    newsletter: true,
    searchQuery: starterSearchQuery(headline, location, services),
    hasPhoto: Boolean(text(profile.avatar, 2000)),
  };
}

/** What someone would type to find this owner, e.g. "Career coach in Leeds"; the Show me demo searches for it. */
export function starterSearchQuery(headline: string, location: string, services: readonly { title: string }[]): string {
  // The headline's first clause ("Career coach", not "Career coach helping people who…"), at most five words.
  const what = (headline.split(/\s*[·•|–—,-]\s*|\s+(?:helping|for|who|that|with)\s+/i)[0] || services[0]?.title || "").trim().split(/\s+/).slice(0, 5).join(" ");
  const where = location.split(",")[0].trim();
  return [what, where].filter(Boolean).join(" in ");
}

/** The Mission is private: it is saved quietly, only when the owner has none, and never published. */
async function saveMissionIfUnset(env: Env, ownerId: string, input: Record<string, unknown>): Promise<boolean> {
  const answers = { who: text(input.missionWho, 160), change: text(input.missionChange, 240), how: text(input.missionHow, 240), why: text(input.missionWhy, 240) };
  if (!answers.who) return false;
  try {
    if ((await readOwnerMission(env.DB, ownerId)).statement) return false;
    await saveOwnerMission(env.DB, ownerId, { answers });
    return true;
  } catch (error) {
    // Mission is a plugin; a missing table never blocks the site.
    console.warn("Starter site: Mission not saved:", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function publishStarterSite(env: Env, ownerId: string): Promise<{ username: string; name: string; publicUrl: string; publishedAt: string; searchQuery: string; hasPhoto: boolean }> {
  const site = await getOwnerProfileSite(env, ownerId);
  if (!site) throw new Error("Draft the site first.");
  const { profile, fromSource } = await readSourceProfile(env, site);
  if (!fromSource) throw new Error("Draft the site first.");
  const manifest = (await loadPublishManifest(env, site.id)) || createEmptyPublishManifest();
  const result = await publishSiteFromSource(env, site, manifest);
  if (!result.publishedAt) throw new Error("The site is set to private, so it was not published.");
  if (result.networkProfile) void syncPublishedProfile(env, site, result.networkProfile);
  const headline = /^\*\*(.+?)\*\*/.exec(profile.bio || "")?.[1] || "";
  const offers = (profile.intents?.book?.offers || []).filter((offer) => offer.title && offer.title !== CLARITY_CALL_TITLE).map((offer) => ({ title: offer.title! }));
  return {
    username: site.username, name: profile.name || site.username, publicUrl: await getPublishedSiteBaseUrl(env, site), publishedAt: result.publishedAt,
    searchQuery: starterSearchQuery(headline, profile.location || "", offers),
    hasPhoto: Boolean(text(profile.avatar, 2000)),
  };
}

/** The draft card's swatches save straight to the source, so Edit and Publish see the same look. */
export async function setDraftTheme(env: Env, site: DbSite, value: unknown): Promise<SiteThemeId> {
  const theme = starterTheme(value);
  if (typeof value !== "string" || !STARTER_THEMES.some((entry) => entry.id === value) && !(value in siteThemes)) throw new Error("Unknown theme.");
  const { profile } = await readSourceProfile(env, site);
  const next: Me3SiteProfile = { ...profile, extensions: { ...(profile.extensions || {}), "me3.app/site": { ...(profile.extensions?.["me3.app/site"] || {}), theme: normalizeSiteTheme(value) } } };
  await writeSourceFiles(env, site, { "me.json": JSON.stringify(next, null, 2) });
  return theme;
}

/** Renders the unpublished source with the real renderer. Owner-only; never cached or indexed. */
export async function renderDraftPreviewHtml(env: Env, site: DbSite, theme?: unknown): Promise<string | null> {
  const sourceFiles = await loadSiteSourceFiles(env, site.id);
  const { profile: stored } = await readSourceProfile(env, site);
  if (!sourceFiles.has("me.json") && !stored.bio) return null;
  const profile: Me3SiteProfile = typeof theme === "string" && theme in siteThemes
    ? { ...stored, extensions: { ...(stored.extensions || {}), "me3.app/site": { ...(stored.extensions?.["me3.app/site"] || {}), theme: normalizeSiteTheme(theme) } } }
    : stored;
  const files = Array.from(sourceFiles.entries()).map(([name, content]) => ({ name, content }));
  const output = await generateSiteHtml(profile, files, undefined, {
    baseUrl: await getPublishedSiteBaseUrl(env, site),
    images: await getSiteImageMetadata(env, site, [...sourceFiles.values()]),
    placeholders: true,
  });
  return output["index.html"] || null;
}

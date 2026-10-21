// A directory for local installs only (ENVIRONMENT=local, e.g. `pnpm dev:fresh`): the public
// me.json of this install's own profile site and of each origin in ME3_LOCAL_DIRECTORY_ORIGINS,
// matched with plain token search. ME3 Cloud's index is what a deployed install searches; this
// exists so the found-and-booked journey runs on a laptop with no Cloud link (me3-5u97.9).
import type { CorePeopleSearchOffering, CorePeopleSearchResult } from "@me3-core/plugin-agent-chat";
import { getCoreApiOrigin, getPublishedSiteBaseUrl, getSiteFileText } from "./sites";
import type { DbSite, Env } from "./types";

const FETCH_TIMEOUT_MS = 3_000;
const STOPWORDS = new Set(["a", "an", "and", "the", "in", "at", "on", "near", "for", "with", "me", "my", "find", "someone", "who", "is", "to", "of", "or"]);

type SearchInput = { query: string; includeMe?: boolean; limit?: number };

export function isLocalDirectoryEnabled(env: Env): boolean {
  return env.ENVIRONMENT === "local";
}

/** The origin of the owner's published profile site, used to recognise their own listing in results. */
export async function ownerSiteOrigin(env: Env, ownerId: string): Promise<string | null> {
  const site = await ownerProfileSite(env, ownerId);
  if (!site?.published_at) return null;
  return originOf(await getPublishedSiteBaseUrl(env, site));
}

export async function searchLocalDirectory(env: Env, ownerId: string, input: SearchInput): Promise<CorePeopleSearchResult[]> {
  if (!isLocalDirectoryEnabled(env)) return [];
  const tokens = queryTokens(input.query);
  if (!tokens.length) return [];
  const sources: Array<{ profile: Record<string, unknown>; origin: string; self: boolean }> = [];
  if (input.includeMe) {
    const own = await ownProfile(env, ownerId);
    if (own) sources.push({ ...own, self: true });
  }
  for (const origin of configuredOrigins(env)) {
    const profile = await fetchProfile(`${origin}/me.json`);
    if (profile) sources.push({ profile, origin, self: false });
  }
  return sources
    .map(({ profile, origin, self }) => ({ result: profileToResult(profile, origin, self), score: 0 }))
    .map((entry) => ({ ...entry, score: matchScore(entry.result, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.result, reasons: matchReasons(entry.result, tokens) }));
}

function configuredOrigins(env: Env): string[] {
  return (env.ME3_LOCAL_DIRECTORY_ORIGINS || "")
    .split(",")
    .map((value) => originOf(value.trim()))
    .filter((value): value is string => Boolean(value));
}

async function ownProfile(env: Env, ownerId: string): Promise<{ profile: Record<string, unknown>; origin: string } | null> {
  const site = await ownerProfileSite(env, ownerId);
  if (!site?.published_at) return null;
  const profile = parseProfile(await getSiteFileText(env, site.id, "public/me.json"));
  if (!profile) return null;
  // Locally the published base URL is the web app; the worker origin serves the public site and its booking API.
  return { profile, origin: originOf(getCoreApiOrigin(env)) || originOf(await getPublishedSiteBaseUrl(env, site)) || "" };
}

async function ownerProfileSite(env: Env, ownerId: string): Promise<DbSite | null> {
  return (await env.DB.prepare(
    `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain,
            custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
     FROM sites
     WHERE user_id = ? AND (site_role = 'profile' OR (site_role IS NULL AND COALESCE(site_type, 'profile') = 'profile'))
     ORDER BY created_at ASC LIMIT 1`,
  ).bind(ownerId).first<DbSite>()) || null;
}

async function fetchProfile(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return parseProfile(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseProfile(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const profile = parsed as Record<string, unknown>;
    return profile.visibility === "private" || !text(profile.name, 160) ? null : profile;
  } catch {
    return null;
  }
}

export function profileToResult(profile: Record<string, unknown>, origin: string, self: boolean): CorePeopleSearchResult {
  const locationData = profile.locationData && typeof profile.locationData === "object" ? profile.locationData as Record<string, unknown> : null;
  const label = text(profile.location, 160) || text(locationData?.label, 160);
  const services = (Array.isArray(profile.services) ? profile.services : []).slice(0, 20).flatMap((entry) => offering(entry, "service", origin));
  const products = (Array.isArray(profile.products) ? profile.products : []).slice(0, 20).flatMap((entry) => offering(entry, "product", origin));
  return {
    relationshipTier: "public",
    profileId: `local:${origin}`,
    contactName: null,
    name: text(profile.name, 160)!,
    handle: text(profile.handle, 120),
    kind: text(profile.kind, 40) || "person",
    bio: plainText(profile.bio),
    avatarUrl: absoluteUrl(profile.avatar, origin),
    profileUrl: `${origin}/me.json`,
    publicUrl: `${origin}/`,
    location: label
      ? {
          label,
          precision: text(locationData?.precision, 40) || "unknown",
          locality: text(locationData?.locality, 120),
          region: text(locationData?.region, 120),
          country: text(locationData?.country, 120),
          countryCode: text(locationData?.countryCode, 2),
        }
      : null,
    offerings: [...services, ...products],
    reasons: [],
    indexedAt: new Date().toISOString(),
    ...(self ? { self: true } : {}),
  };
}

function offering(entry: unknown, type: "service" | "product", origin: string): CorePeopleSearchOffering[] {
  if (!entry || typeof entry !== "object") return [];
  const raw = entry as Record<string, unknown>;
  const id = text(raw.id, 200), title = text(raw.title, 200);
  if (!id || !title || raw.status === "paused" || raw.available === false) return [];
  const price = raw.price && typeof raw.price === "object" ? raw.price as Record<string, unknown> : null;
  const amount = text(price?.amount, 40), currency = text(price?.currency, 12);
  return [{
    type, id, title,
    description: text(raw.description, 1_000),
    url: absoluteUrl(raw.url, origin),
    durationMinutes: typeof raw.durationMinutes === "number" && Number.isFinite(raw.durationMinutes) ? Math.max(1, Math.floor(raw.durationMinutes)) : null,
    price: amount && currency ? { amount, currency } : null,
    kind: type === "product" ? "product" : "booking",
    agentCheckout: null,
  }];
}

function queryTokens(query: string): string[] {
  return [...new Set(normalize(query).split(" ").filter((token) => token.length > 1 && !STOPWORDS.has(token)))];
}

function matchScore(result: CorePeopleSearchResult, tokens: string[]): number {
  const haystack = normalize([
    result.name, result.handle, result.bio, result.location?.label,
    ...result.offerings.map((entry) => `${entry.title} ${entry.description || ""}`),
  ].filter(Boolean).join(" "));
  const matched = tokens.filter((token) => haystack.includes(token));
  // A name match alone finds "Kieran"; a single incidental word elsewhere does not.
  const nameHit = tokens.some((token) => normalize(`${result.name} ${result.handle || ""}`).includes(token));
  return matched.length === 0 || (!nameHit && matched.length < Math.min(2, tokens.length)) ? 0 : matched.length / tokens.length;
}

function matchReasons(result: CorePeopleSearchResult, tokens: string[]): string[] {
  const reasons: string[] = [];
  const offering = result.offerings.find((entry) => tokens.some((token) => normalize(`${entry.title} ${entry.description || ""}`).includes(token)));
  if (offering) reasons.push(`Offers ${offering.title}`);
  if (result.location && tokens.some((token) => normalize(result.location!.label).includes(token))) reasons.push(`Based in ${result.location.label}`);
  if (!reasons.length) reasons.push("Profile matches your search");
  return reasons.slice(0, 2);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function plainText(value: unknown): string | null {
  const raw = text(value, 2_000);
  return raw ? raw.replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 2_000) : null;
}

function absoluteUrl(value: unknown, origin: string): string | null {
  const raw = text(value, 2_000);
  if (!raw) return null;
  try {
    return new URL(raw, `${origin}/`).toString();
  } catch {
    return null;
  }
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

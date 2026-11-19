import { normalizeSiteTheme, siteThemes } from "@me3-core/site-renderer";
import { getPublicSiteOrigin, getSiteFileText, putSiteFile } from "./sites";
import type { DbSite, Env } from "./types";

export type SiteBranding = {
  siteId: string;
  siteUsername: string;
  displayName: string;
  logoRef: string | null;
  logoUrl: string | null;
  /** PNG copy of the logo on a white tile for email (me3-bli3.2.12), made by the browser. */
  emailLogoRef: string | null;
  emailLogoUrl: string | null;
  /** Display size in CSS pixels; the PNG itself is 2x. */
  emailLogoWidth: number | null;
  emailLogoHeight: number | null;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  updatedAt: string | null;
  persisted: boolean;
};

type SiteBrandingSite = Pick<
  DbSite,
  "id" | "username" | "custom_domain" | "custom_domain_status"
>;

type SiteBrandingRow = {
  site_id: string;
  display_name: string;
  logo_ref: string | null;
  email_logo_ref?: string | null;
  email_logo_width?: number | null;
  email_logo_height?: number | null;
  accent_color: string;
  background_color: string;
  surface_color: string;
  text_color: string;
  updated_at: string;
};

type SiteProfileBrandSeed = {
  name?: unknown;
  logo?: unknown;
  avatar?: unknown;
  links?: Record<string, unknown> | null;
  extensions?: Record<string, unknown> | null;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const EMAIL_LOGO_PATH = "files/email-logo.png";
const EMAIL_LOGO_MAX = { width: 200, height: 64 } as const;
const DEFAULT_COLORS = {
  accentColor: "#147d64",
  backgroundColor: "#f4f5f4",
  surfaceColor: "#ffffff",
  textColor: "#18201d",
} as const;

export class SiteBrandingInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "SiteBrandingInputError";
  }
}

/**
 * The brand follows the Site: its logo (or photo) and accent come from the Site's look in the
 * editor every time. The stored row only remembers the email copy of the logo and the text colour.
 */
export async function getSiteBranding(
  env: Env,
  site: SiteBrandingSite,
  persistDefaults = false,
): Promise<SiteBranding> {
  const existing = await readSiteBranding(env, site.id);
  if (existing) {
    const seed = await deriveSiteBranding(env, site, existing.display_name);
    // A Site without a readable profile (agent-built, or a read failure) keeps what is stored.
    const synced = seed.fromProfile ? await syncSiteBranding(env, existing, seed) : existing;
    return serializeSiteBranding(env, site, synced, seed.displayName, true);
  }
  const { fromProfile: _fromProfile, ...seed } = await deriveSiteBranding(env, site);
  if (!persistDefaults) return seed;

  await env.DB.prepare(
    `INSERT INTO site_branding
       (site_id, display_name, logo_ref, accent_color, background_color,
        surface_color, text_color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(site_id) DO NOTHING`,
  )
    .bind(
      site.id,
      seed.displayName,
      seed.logoRef,
      seed.accentColor,
      seed.backgroundColor,
      seed.surfaceColor,
      seed.textColor,
    )
    .run();
  const persisted = await readSiteBranding(env, site.id);
  return persisted
    ? serializeSiteBranding(env, site, persisted, seed.displayName, true)
    : seed;
}

/** Brings a stored row in line with the Site; a new logo drops the old email copy. */
async function syncSiteBranding(
  env: Env,
  row: SiteBrandingRow,
  seed: DerivedSiteBranding,
): Promise<SiteBrandingRow> {
  const logoChanged = (row.logo_ref || null) !== seed.logoRef;
  if (!logoChanged && row.accent_color === seed.accentColor) return row;
  await env.DB.prepare(
    `UPDATE site_branding
     SET logo_ref = ?, accent_color = ?,
         email_logo_ref = CASE WHEN ? THEN NULL ELSE email_logo_ref END,
         email_logo_width = CASE WHEN ? THEN NULL ELSE email_logo_width END,
         email_logo_height = CASE WHEN ? THEN NULL ELSE email_logo_height END,
         updated_at = CURRENT_TIMESTAMP
     WHERE site_id = ?`,
  )
    .bind(seed.logoRef, seed.accentColor, logoChanged ? 1 : 0, logoChanged ? 1 : 0, logoChanged ? 1 : 0, row.site_id)
    .run();
  return (await readSiteBranding(env, row.site_id)) || row;
}

/**
 * Records the email copy of the logo the browser just stored at EMAIL_LOGO_PATH. The version keeps
 * mail clients and caches from showing an older copy.
 */
export async function saveSiteEmailLogo(
  env: Env,
  site: SiteBrandingSite,
  input: { width: unknown; height: unknown; version: string },
): Promise<SiteBranding> {
  const width = Math.round(Number(input.width));
  const height = Math.round(Number(input.height));
  if (!(width >= 1 && width <= EMAIL_LOGO_MAX.width && height >= 1 && height <= EMAIL_LOGO_MAX.height)) {
    throw new SiteBrandingInputError("The email logo must be at most 200 by 64");
  }
  const current = await getSiteBranding(env, site, true);
  if (!current.logoRef) throw new SiteBrandingInputError("Add a Site logo first");
  await env.DB.prepare(
    `UPDATE site_branding
     SET email_logo_ref = ?, email_logo_width = ?, email_logo_height = ?, updated_at = CURRENT_TIMESTAMP
     WHERE site_id = ?`,
  )
    .bind(`./${EMAIL_LOGO_PATH}?v=${encodeURIComponent(input.version)}`, width, height, site.id)
    .run();
  return getSiteBranding(env, site);
}

type DerivedSiteBranding = SiteBranding & { fromProfile: boolean };

async function deriveSiteBranding(
  env: Env,
  site: SiteBrandingSite,
  fallbackDisplayName?: string,
): Promise<DerivedSiteBranding> {
  const profile = await readSiteProfileSeed(env, site.id);
  const displayName =
    normalizeText(profile?.name, 120) || fallbackDisplayName || site.username;
  const logoRef = tryNormalizeLogoRef(profile?.logo ?? profile?.avatar ?? null);
  const accentColor = siteAccent(profile);
  return {
    siteId: site.id,
    siteUsername: site.username,
    displayName,
    logoRef,
    logoUrl: resolveLogoUrl(env, site, logoRef),
    emailLogoRef: null,
    emailLogoUrl: null,
    emailLogoWidth: null,
    emailLogoHeight: null,
    accentColor,
    backgroundColor: DEFAULT_COLORS.backgroundColor,
    surfaceColor: DEFAULT_COLORS.surfaceColor,
    textColor: DEFAULT_COLORS.textColor,
    updatedAt: null,
    persisted: false,
    fromProfile: Boolean(profile),
  };
}

async function readSiteProfileSeed(
  env: Env,
  siteId: string,
): Promise<SiteProfileBrandSeed | null> {
  let source: string | null;
  try {
    source =
      (await getSiteFileText(env, siteId, "src/me.json")) ||
      (await getSiteFileText(env, siteId, "public/me.json"));
  } catch {
    return null;
  }
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed as SiteProfileBrandSeed : null;
  } catch {
    return null;
  }
}

async function readSiteBranding(env: Env, siteId: string) {
  return env.DB.prepare(
    `SELECT site_id, display_name, logo_ref, email_logo_ref, email_logo_width,
            email_logo_height, accent_color, background_color,
            surface_color, text_color, updated_at
     FROM site_branding WHERE site_id = ?`,
  )
    .bind(siteId)
    .first<SiteBrandingRow>();
}

function serializeSiteBranding(
  env: Env,
  site: SiteBrandingSite,
  row: SiteBrandingRow,
  displayName: string,
  persisted: boolean,
): SiteBranding {
  return {
    siteId: row.site_id,
    siteUsername: site.username,
    displayName,
    logoRef: row.logo_ref,
    logoUrl: resolveLogoUrl(env, site, row.logo_ref),
    emailLogoRef: row.email_logo_ref || null,
    emailLogoUrl: resolveLogoUrl(env, site, row.email_logo_ref || null),
    emailLogoWidth: row.email_logo_ref ? Number(row.email_logo_width) || null : null,
    emailLogoHeight: row.email_logo_ref ? Number(row.email_logo_height) || null : null,
    accentColor: row.accent_color,
    backgroundColor: DEFAULT_COLORS.backgroundColor,
    surfaceColor: DEFAULT_COLORS.surfaceColor,
    textColor: row.text_color,
    updatedAt: row.updated_at,
    persisted,
  };
}

function resolveLogoUrl(
  env: Env,
  site: SiteBrandingSite,
  logoRef: string | null,
): string | null {
  if (!logoRef) return null;
  const homeUrl = getPublicSiteOrigin(env, {
    custom_domain: site.custom_domain_status === "active" ? site.custom_domain : null,
  }) || "https://me3.app";
  try {
    const url = new URL(logoRef, `${homeUrl.replace(/\/$/, "")}/`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeLogoRef(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = normalizeText(value, 2048);
  if (!normalized) return null;
  if (normalized.startsWith("./") || normalized.startsWith("/")) return normalized;
  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // Fall through to the input error below.
  }
  throw new SiteBrandingInputError("Site branding logo must use a Site path or HTTP(S) URL");
}

function tryNormalizeLogoRef(value: unknown): string | null {
  try {
    return normalizeLogoRef(value);
  } catch {
    return null;
  }
}

/** The accent visitors see: the editor's chosen accent, else the theme's own. */
function siteAccent(profile: SiteProfileBrandSeed | null): string {
  const look = profile?.extensions?.["me3.app/site"] as { theme?: unknown; accent?: unknown } | undefined;
  if (look && typeof look === "object") {
    return normalizeColor(look.accent, normalizeColor(siteThemes[normalizeSiteTheme(look.theme)].light.accent, DEFAULT_COLORS.accentColor));
  }
  return normalizeColor(profile?.links?._accent, DEFAULT_COLORS.accentColor);
}

function normalizeColor(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HEX_COLOR.test(normalized) ? normalized : fallback;
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const PROFILE_PATHS = ["src/me.json", "public/me.json"] as const;

/**
 * Sets the Site logo (the profile's `logo`, the same field the site editor's Logo writes) without a
 * full publish, so the owner can add it from a campaign review. Returns false when the Site has no profile yet.
 */
export async function setSiteProfileLogo(env: Env, siteId: string, logoRef: string): Promise<boolean> {
  let updated = false;
  for (const path of PROFILE_PATHS) {
    const source = await getSiteFileText(env, siteId, path);
    if (!source) continue;
    let profile: unknown;
    try {
      profile = JSON.parse(source);
    } catch {
      continue;
    }
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) continue;
    await putSiteFile(env, siteId, path, JSON.stringify({ ...profile, logo: logoRef }, null, 2), "application/json");
    updated = true;
  }
  return updated;
}

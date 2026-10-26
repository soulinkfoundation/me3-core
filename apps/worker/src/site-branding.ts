import { getPublicSiteOrigin, getSiteFileText } from "./sites";
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

export async function getSiteBranding(
  env: Env,
  site: SiteBrandingSite,
  persistDefaults = false,
): Promise<SiteBranding> {
  const existing = await readSiteBranding(env, site.id);
  if (existing) {
    const seed = await deriveSiteBranding(env, site, existing.display_name);
    return serializeSiteBranding(env, site, existing, seed.displayName, true);
  }
  const seed = await deriveSiteBranding(env, site);
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

export async function updateSiteBranding(
  env: Env,
  site: SiteBrandingSite,
  input: Record<string, unknown>,
): Promise<SiteBranding> {
  const existing = await readSiteBranding(env, site.id);
  const seed = await deriveSiteBranding(env, site, existing?.display_name);
  const logoRef = normalizeLogoRef(input.logoRef);
  const accentColor = requireColor(input.accentColor, "Accent colour");
  const textColor = requireColor(input.textColor, "Text colour");

  await env.DB.prepare(
    `INSERT INTO site_branding
       (site_id, display_name, logo_ref, accent_color, background_color,
        surface_color, text_color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(site_id) DO UPDATE SET
       display_name = excluded.display_name,
       email_logo_ref = CASE WHEN logo_ref IS excluded.logo_ref THEN email_logo_ref ELSE NULL END,
       email_logo_width = CASE WHEN logo_ref IS excluded.logo_ref THEN email_logo_width ELSE NULL END,
       email_logo_height = CASE WHEN logo_ref IS excluded.logo_ref THEN email_logo_height ELSE NULL END,
       logo_ref = excluded.logo_ref,
       accent_color = excluded.accent_color,
       background_color = excluded.background_color,
       surface_color = excluded.surface_color,
       text_color = excluded.text_color,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      site.id,
      seed.displayName,
      logoRef,
      accentColor,
      DEFAULT_COLORS.backgroundColor,
      DEFAULT_COLORS.surfaceColor,
      textColor,
    )
    .run();

  const updated = await readSiteBranding(env, site.id);
  if (!updated) throw new SiteBrandingInputError("Site branding could not be saved");
  return serializeSiteBranding(env, site, updated, seed.displayName, true);
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

async function deriveSiteBranding(
  env: Env,
  site: SiteBrandingSite,
  fallbackDisplayName?: string,
): Promise<SiteBranding> {
  const profile = await readSiteProfileSeed(env, site.id);
  const displayName =
    normalizeText(profile?.name, 120) || fallbackDisplayName || site.username;
  const logoRef = tryNormalizeLogoRef(profile?.logo ?? profile?.avatar ?? null);
  const accentColor = normalizeColor(profile?.links?._accent, DEFAULT_COLORS.accentColor);
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

function requireColor(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!HEX_COLOR.test(normalized)) {
    throw new SiteBrandingInputError(`${label} must be a six-digit hex colour`);
  }
  return normalized;
}

function normalizeColor(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HEX_COLOR.test(normalized) ? normalized : fallback;
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

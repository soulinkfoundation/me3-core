import { api } from "../api";

type CoreConfig = {
  siteHost?: string | null;
};

type PublicSite = {
  custom_domain?: string | null;
  custom_domain_status?: "pending" | "active" | "failed" | null;
  site_role?: "profile" | "organization" | null;
};

function browserOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/\/+$/, "");
}

function fallbackPublicSiteUrl(): string {
  const origin = browserOrigin();
  return origin ? `${origin}/` : "/";
}

export function configuredPublicSiteUrl(
  site?: PublicSite | null,
): string | null {
  if (site?.custom_domain_status && site.custom_domain_status !== "active") {
    return null;
  }
  const domain = site?.custom_domain
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return domain ? `https://${domain}` : null;
}

export const configuredPublicProfileUrl = configuredPublicSiteUrl;

async function resolveDefaultPublicSiteUrl(): Promise<string> {
  if (import.meta.env.DEV) return "http://localhost:8787/preview";

  try {
    const config = await api.get<CoreConfig>("/config");
    const siteHost = config.siteHost?.trim();
    if (siteHost) return `https://${siteHost}`;
  } catch {
    // Fall back to the Worker-local public route when config is unavailable.
  }

  return fallbackPublicSiteUrl();
}

export function permanentPublicSitePath(
  username: string,
  siteRole: PublicSite["site_role"] = "profile",
): string {
  return siteRole === "organization"
    ? `/site/${encodeURIComponent(username)}/`
    : "/";
}

export function permanentPublicSiteUrl(
  username: string,
  siteRole: PublicSite["site_role"] = "profile",
): string {
  if (import.meta.env.DEV) {
    return `http://localhost:8787/preview/${encodeURIComponent(username)}/`;
  }
  const origin = browserOrigin();
  const path = permanentPublicSitePath(username, siteRole);
  return origin ? `${origin}${path}` : path;
}

export async function resolvePublicSiteUrl(
  username: string,
  site?: PublicSite | null,
): Promise<string> {
  if (import.meta.env.DEV) {
    return `http://localhost:8787/preview/${encodeURIComponent(username)}/`;
  }

  const configuredUrl = configuredPublicSiteUrl(site);
  if (configuredUrl) return configuredUrl;

  if (site?.site_role === "organization") {
    return permanentPublicSiteUrl(username, "organization");
  }
  return resolveDefaultPublicSiteUrl();
}

export async function resolvePublicProfileUrl(
  username: string,
  site?: PublicSite | null,
): Promise<string> {
  return resolvePublicSiteUrl(username, site);
}

export function defaultPublicProfileUrlLabel(): string {
  if (import.meta.env.DEV) return "localhost preview";
  return "/";
}

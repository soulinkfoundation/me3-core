import { publicSiteFileResponse } from "./public-site-response";
import {
  getLandingPageTemplateId,
  normalizeBusinessSiteDocument,
  normalizeLandingPageDocument,
  renderLandingPageHtml,
  type LandingPageDocument,
} from "@me3-core/plugin-landing-pages";
import { getOrCreateInstallSessionSecret } from "./install-secrets";
import type { AppContext } from "./http/types";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import {
  parseMe3Json,
  type Me3CompatibleProfile,
} from "me3-protocol";
import { buildPublicMe3Profile } from "./public-me-profile";
import type { DbSite, Env, OwnerProfile } from "./types";

const ME3_CLOUD_OWNER_SECRET_NAME = "ME3_CLOUD_OWNER_ID";
const ME3_CLOUD_USERNAME_CONFLICT_MESSAGE =
  "This username is already taken on ME3 Cloud. Choose another handle before publishing.";
export const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const D1_SITE_FILE_MAX_BYTES = 1_900_000;
export const MAX_SITE_AUDIO_BYTES = 40 * 1024 * 1024;

export type Me3CloudUsernameAvailability = {
  available: boolean;
  username: string;
  reason?: string;
  message?: string;
};

type OwnerRecord = OwnerProfile & { password_hash: string | null };

export type PublishManifest = {
  version: 1;
  sourceFiles: Record<string, string>;
  assetFiles: Record<string, string>;
  updatedAt: string;
};
export type SiteFileRecord = {
  site_id: string;
  path: string;
  content: ArrayBuffer | Uint8Array | number[] | Record<string, number>;
  content_type: string;
  size: number;
  sha256: string | null;
  updated_at: string;
};

export function normalizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function normalizeEmail(value: unknown): string {
  const email = normalizeShortText(value, 254).toLowerCase();
  return EMAIL_REGEX.test(email) ? email : "";
}

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function getOwnerProfile(env: Env, ownerId: string): Promise<OwnerRecord | null> {
  const result = await env.DB.prepare(
    "SELECT id, email, name, username, bio, avatar_url, timezone, locale, assistant_name, password_hash FROM owner_profile WHERE id = ?",
  )
    .bind(ownerId)
    .first<OwnerRecord>();

  return result ?? null;
}

export async function getStoredMe3CloudOwnerId(env: Env): Promise<string | null> {
  const result = await env.DB.prepare(
    "SELECT value FROM install_secrets WHERE name = ?",
  )
    .bind(ME3_CLOUD_OWNER_SECRET_NAME)
    .first<{ value: string }>();

  return result?.value || null;
}

export function createEmptyPublishManifest(): PublishManifest {
  return {
    version: 1,
    sourceFiles: {},
    assetFiles: {},
    updatedAt: "",
  };
}

export function normalizeHost(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/:\d+$/, "");
}

export function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function hostsMatch(first: string, second: string): boolean {
  if (!first || !second) return false;
  if (first === second) return true;
  return isLoopbackHost(first) && isLoopbackHost(second);
}

export function normalizeDomain(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  return normalizeHost(withoutProtocol.split("/")[0]);
}

export function isValidPublicSiteDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  if (domain.includes("*") || domain.includes("_")) return false;
  if (!domain.includes(".")) return false;
  return domain
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function hostnameFromUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return normalizeHost(new URL(value).hostname);
  } catch {
    return normalizeHost(value);
  }
}

export function originFromUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function getRootCustomDomain(env: Env, publicDomain?: string | null): string {
  const configured = normalizeDomain(env.ME3_CUSTOM_DOMAIN);
  if (configured) return configured;

  const normalizedPublicDomain = normalizeDomain(publicDomain);
  if (!normalizedPublicDomain) return "";
  return normalizedPublicDomain.startsWith("www.")
    ? normalizedPublicDomain.slice(4)
    : normalizedPublicDomain;
}

export function prefixedHost(prefix: string, domain: string): string {
  if (!domain) return "";
  if (domain.startsWith(`${prefix}.`)) return domain;
  return `${prefix}.${domain}`;
}

export function getAdminHost(env: Env, requestUrl?: string, publicDomain?: string | null): string {
  return (
    normalizeHost(env.ME3_ADMIN_HOST) ||
    hostnameFromUrl(env.CORE_WEB_ORIGIN) ||
    prefixedHost("me3", getRootCustomDomain(env, publicDomain)) ||
    hostnameFromUrl(requestUrl)
  );
}

export function getApiHost(env: Env, requestUrl?: string): string {
  const explicitAdminHost =
    normalizeHost(env.ME3_ADMIN_HOST) || hostnameFromUrl(env.CORE_WEB_ORIGIN);
  return (
    normalizeHost(env.ME3_API_HOST) ||
    hostnameFromUrl(env.CORE_API_ORIGIN) ||
    explicitAdminHost ||
    getAdminHost(env, requestUrl)
  );
}

export function getSiteHost(env: Env, publicDomain?: string | null): string {
  return normalizeHost(env.ME3_SITE_HOST) || normalizeHost(publicDomain) || prefixedHost("www", getRootCustomDomain(env));
}

export function getPublicSiteOrigin(env: Env, site: Pick<DbSite, "custom_domain">): string {
  const host = normalizeHost(site.custom_domain) || getSiteHost(env);
  return host ? `https://${host}` : "";
}

export async function getPublishedSiteBaseUrl(env: Env, site: DbSite): Promise<string> {
  const origin = getPublicSiteOrigin(env, site);
  if (origin && (await getPublicSiteForHost(env, new URL(origin).hostname))?.id === site.id) return origin;
  const fallback = getCoreWebOrigin(env) || origin;
  return fallback ? `${fallback}/site/${encodeURIComponent(site.username)}` : "";
}

export function getCoreWebOrigin(env: Env, requestUrl?: string): string {
  const configured = originFromUrl(env.CORE_WEB_ORIGIN);
  if (configured) return configured;

  const adminHost = getAdminHost(env, requestUrl);
  if (adminHost) {
    return adminHost === hostnameFromUrl(requestUrl) ? originFromUrl(requestUrl) : `https://${adminHost}`;
  }

  return originFromUrl(requestUrl);
}

export function getCoreApiOrigin(env: Env, requestUrl?: string): string {
  const configured = originFromUrl(env.CORE_API_ORIGIN);
  if (configured) return configured;

  const apiHost = getApiHost(env, requestUrl);
  if (apiHost) {
    return apiHost === hostnameFromUrl(requestUrl) ? originFromUrl(requestUrl) : `https://${apiHost}`;
  }

  return getCoreWebOrigin(env, requestUrl);
}

export function getCorsOrigin(env: Env, requestUrl: string, origin: string | undefined): string {
  if (!origin) return getCoreWebOrigin(env, requestUrl);

  const allowedOrigins = new Set([
    getCoreWebOrigin(env, requestUrl),
    getCoreApiOrigin(env, requestUrl),
    originFromUrl(requestUrl),
  ]);

  return allowedOrigins.has(origin) ? origin : getCoreWebOrigin(env, requestUrl);
}

export function getMe3CloudOrigin(env: Env): string {
  return originFromUrl(env.ME3_CLOUD_ORIGIN) || "https://me3.app";
}

export function getMe3CloudApiOrigin(env: Env): string {
  const configured = originFromUrl(env.ME3_CLOUD_API_ORIGIN);
  if (configured) return configured;

  const cloudOrigin = getMe3CloudOrigin(env);
  const cloudUrl = new URL(cloudOrigin);
  if (cloudUrl.hostname === "me3.app" || cloudUrl.hostname === "www.me3.app") {
    return "https://api.me3.app";
  }

  return cloudOrigin;
}

export function buildApiUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function readResponseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function getMe3CloudUsernamePublishBlockReason(
  env: Env,
  usernameInput: unknown,
): Promise<string | null> {
  if (!(await getStoredMe3CloudOwnerId(env))) return null;

  const availability = await getMe3CloudUsernameAvailability(env, usernameInput);
  if (!availability) return null;
  return availability.available === false ? ME3_CLOUD_USERNAME_CONFLICT_MESSAGE : null;
}

export async function getMe3CloudUsernameAvailability(
  env: Env,
  usernameInput: unknown,
): Promise<Me3CloudUsernameAvailability | null> {
  const cloudOwnerId = await getStoredMe3CloudOwnerId(env);
  const username = normalizeUsername(usernameInput);
  if (!username || !USERNAME_REGEX.test(username)) {
    return {
      available: false,
      username,
      reason: "invalid",
      message: "Use letters, numbers, underscores, or hyphens.",
    };
  }

  const url = buildApiUrl(
    getMe3CloudApiOrigin(env),
    `/api/usernames/${encodeURIComponent(username)}/available`,
  );
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cloudOwnerId) {
    headers["X-ME3-Core-Owner-ID"] = cloudOwnerId;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });
    const body = await readResponseJson(response);

    if (!response.ok) {
      console.warn(
        `ME3 Cloud username availability check failed (${response.status}) for ${username}`,
      );
      return null;
    }

    return {
      available: body.available === true,
      username,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      message: typeof body.message === "string" ? body.message : undefined,
    };
  } catch (error) {
    console.warn("ME3 Cloud username availability check failed:", error);
    return null;
  }
}

export function siteStorageSetupRequired(c: AppContext) {
  return c.json(
    {
      ok: false,
      error:
        "Site publishing storage is not initialized. Run `pnpm --filter @me3-core/worker db:migrate:local` and restart the Worker.",
      setupRequired: ["site_files"],
    },
    503,
  );
}

export function subscribersSetupRequired(c: AppContext) {
  return c.json(
    {
      ok: false,
      error:
        "Subscriber storage is not initialized. Run `pnpm --filter @me3-core/worker db:migrate:local` and restart the Worker.",
      setupRequired: ["subscribers"],
    },
    503,
  );
}

export function isMissingSiteFilesTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("site_files") && /no such table|does not exist/i.test(message);
}

export function isMissingSubscribersTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("subscribers") && /no such table|does not exist/i.test(message);
}

export async function isPublicSiteHost(env: Env, requestUrl: string): Promise<boolean> {
  const requestHost = hostnameFromUrl(requestUrl);
  if (!requestHost) return false;
  const configuredAdminHost = normalizeHost(env.ME3_ADMIN_HOST) || hostnameFromUrl(env.CORE_WEB_ORIGIN);
  const configuredApiHost = normalizeHost(env.ME3_API_HOST) || hostnameFromUrl(env.CORE_API_ORIGIN);
  if (hostsMatch(requestHost, configuredAdminHost) || hostsMatch(requestHost, configuredApiHost)) {
    return false;
  }

  const siteHost = getSiteHost(env);
  if (siteHost && requestHost === siteHost) return true;

  const inferredRootPublicHost = getInferredRootPublicSiteHost(env);
  if (inferredRootPublicHost && requestHost === inferredRootPublicHost) return true;

  if (isLikelyRootPublicSiteHost(requestHost)) {
    try {
      const site = await getPublicSiteForHost(env, requestHost);
      if (site?.published_at) return true;
    } catch {
      return false;
    }
  }

  const site = await env.DB.prepare(
    `SELECT custom_domain FROM sites
     WHERE lower(custom_domain) = ?
     LIMIT 1`,
  )
    .bind(requestHost)
    .first<{ custom_domain: string | null }>();

  if (!site) return false;

  const inferredAdminHost = getAdminHost(env, undefined, site.custom_domain);
  const inferredApiHost = getApiHost(env);
  return !hostsMatch(requestHost, inferredAdminHost) && !hostsMatch(requestHost, inferredApiHost);
}

export function getInferredRootPublicSiteHost(env: Env): string {
  const adminHost =
    normalizeHost(env.ME3_ADMIN_HOST) || hostnameFromUrl(env.CORE_WEB_ORIGIN);
  if (!adminHost.startsWith("me3.")) return "";
  const rootHost = adminHost.slice("me3.".length);
  return isValidPublicSiteDomain(rootHost) ? rootHost : "";
}

export function isLikelyRootPublicSiteHost(host: string): boolean {
  if (!isValidPublicSiteDomain(host)) return false;
  if (host.endsWith(".workers.dev")) return false;
  if (host.startsWith("me3.") || host.startsWith("api.")) return false;
  return true;
}

export function getCoreDomainState(
  env: Env,
  _site: Pick<DbSite, "username">,
  domain: string | null,
): "pending" | "active" | "failed" {
  const normalizedDomain = normalizeHost(domain);
  const siteHost = getSiteHost(env, normalizedDomain);
  if (!normalizedDomain) return "pending";
  if (!siteHost) return "pending";
  if (normalizedDomain !== siteHost) return "pending";

  return "active";
}

export function buildCoreDomainStatus(env: Env, site: DbSite) {
  const domain = normalizeHost(site.custom_domain);
  const status = domain
    ? getCoreDomainState(env, site, domain)
    : undefined;

  return {
    connected: Boolean(domain),
    domain: domain || undefined,
    status,
    ssl_status: status === "active" ? "active" : undefined,
    expected_host: getSiteHost(env, domain) || null,
    admin_host: getAdminHost(env, undefined, domain) || null,
    verification_records: getCoreDomainRecords(env, domain),
    registrar_guides: getRegistrarGuides(),
    url: status === "active" && domain ? `https://${domain}` : undefined,
    instructions: domain
      ? getCoreDomainInstructions(env, domain, site.username)
      : [
          "Publish this site first so the custom domain has a live page to serve.",
          "Enter the one canonical domain visitors should use for this site.",
          "Domain aliases are not supported yet.",
        ],
  };
}

export function getCoreDomainRecords(env: Env, domain: string | null | undefined) {
  const normalizedDomain = normalizeHost(domain);
  if (!normalizedDomain) return [];
  const adminHost = getAdminHost(env);
  if (!adminHost) return [];
  return [
    {
      type: "cname" as const,
      name: normalizedDomain,
      value: adminHost,
    },
  ];
}

export function getCoreDomainInstructions(env: Env, domain: string, username: string): string[] {
  const siteHost = getSiteHost(env, domain);
  const adminHost = getAdminHost(env);
  const instructions = [
    `In Cloudflare, attach ${domain} to this same me3 Worker as a custom domain.`,
    adminHost
      ? `Keep ME3 login, private APIs, and account settings on ${adminHost}.`
      : "Keep ME3 login, private APIs, and account settings on the existing installation host.",
  ];

  if (normalizeHost(env.ME3_SITE_HOST) && siteHost !== domain) {
    instructions.unshift(`Current ME3_SITE_HOST is ${siteHost}, so this domain will stay pending until the variable matches.`);
  }

  instructions.push(`Requests for ${domain} resolve only the @${username} site.`);
  instructions.push("Domain aliases are deferred; redirect any alternate hostname to this canonical domain.");
  return instructions;
}

export function getRegistrarGuides() {
  return [
    {
      name: "Cloudflare custom domains",
      url: "https://developers.cloudflare.com/workers/configuration/routing/custom-domains/",
      icon: "cloudflare",
    },
    {
      name: "Cloudflare redirects",
      url: "https://developers.cloudflare.com/rules/url-forwarding/",
      icon: "cloudflare",
    },
  ];
}

export async function servePublicSiteRequest(env: Env, request: Request): Promise<Response> {
  const site = await getPublicSiteForHost(env, new URL(request.url).hostname);
  if (!site) return new Response(renderNotFoundPage("Site not configured"), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

  const requestedPath = new URL(request.url).pathname.replace(/^\/+/, "") || "index.html";
  return serveSiteFileResponse(env, site, requestedPath, true, "", request);
}

export async function serveDefaultPublicSitePath(
  env: Env,
  request: Request,
  requestedPath: string,
): Promise<Response> {
  const site = await getPublicSiteForHost(env, new URL(request.url).hostname);
  if (!site) return new Response(renderNotFoundPage("Site not configured"), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

  return serveSiteFileResponse(env, site, requestedPath, true, "/me", request);
}

export async function serveMeJsonResponse(env: Env, request: Request): Promise<Response> {
  const requestHost = new URL(request.url).hostname;
  const requestedSite = await getPublicSiteForHost(env, requestHost);
  if (requestedSite) {
    const response = await siteMeJsonResponse(env, requestedSite, new URL(request.url).origin);
    if (response) return response;
  }

  if (!isKnownFallbackSiteHost(env, requestHost)) {
    return new Response(JSON.stringify({ error: "Site not configured" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const owner = await getOwnerProfile(env, "owner");
  return publicMeJsonResponse(
    buildPublicMe3Profile(
      {
        version: "0.1",
        name: owner?.name ?? "ME3 Owner",
        handle: owner?.username ?? "owner",
        bio: owner?.bio ?? "Personal AI assistant powered by ME3.",
        ...(owner?.avatar_url ? { avatar: owner.avatar_url } : {}),
      },
      new URL(request.url).origin,
    ),
  );
}

async function siteMeJsonResponse(env: Env, requestedSite: DbSite, origin: string): Promise<Response | null> {
  const site = await getRepresentedProfileSite(env, requestedSite);
  const storedPublic = await getSiteFileText(env, site.id, "public/me.json");
  if (site.published_at && storedPublic) {
    const parsed = parseMe3Json(storedPublic);
    if (parsed.valid && parsed.profile) return publicMeJsonResponse(parsed.profile);
  }

  const legacySource = await getSiteFileText(env, site.id, "src/me.json");
  if (legacySource || storedPublic) {
    const profile = parseSiteProfile(legacySource || storedPublic || "{}", site.username);
    return publicMeJsonResponse(
      buildPublicMe3Profile(
        site.published_at ? profile : { ...profile, visibility: "private" },
        origin,
      ),
    );
  }
  return null;
}

async function getRepresentedProfileSite(
  env: Env,
  site: DbSite,
): Promise<DbSite> {
  if (site.site_role !== "organization" || !site.profile_site_id) return site;
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id,
              custom_domain, custom_domain_status, custom_domain_cf_id,
              created_at, updated_at, published_at
       FROM sites
       WHERE id = ? AND user_id = ? AND site_role = 'profile'`,
    )
      .bind(site.profile_site_id, site.user_id)
      .first<DbSite>()) || site
  );
}

function publicMeJsonResponse(profile: Me3CompatibleProfile): Response {
  return new Response(JSON.stringify(profile, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function getPublicSiteForHost(env: Env, rawHost: string): Promise<DbSite | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  const customDomainSite = await env.DB.prepare(
    `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain,
            custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
     FROM sites
     WHERE lower(custom_domain) = ?
     ORDER BY created_at ASC
     LIMIT 1`,
  )
    .bind(host)
    .first<DbSite>();
  if (customDomainSite) return customDomainSite;

  if (!isKnownFallbackSiteHost(env, host)) return null;

  const configuredUsername = normalizeUsername(env.ME3_SITE_USERNAME);
  if (configuredUsername) {
    const site = await getSiteByUsername(env, configuredUsername);
    if (site) return site;
  }

  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE site_role = 'profile'
          OR (site_role IS NULL AND COALESCE(site_type, 'profile') = 'profile')
       ORDER BY created_at ASC
       LIMIT 1`,
    )
      .first<DbSite>()) || null
  );
}

export function isKnownFallbackSiteHost(env: Env, rawHost: string): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;

  const configuredHosts = [
    getSiteHost(env),
    getInferredRootPublicSiteHost(env),
    normalizeHost(env.ME3_ADMIN_HOST) || hostnameFromUrl(env.CORE_WEB_ORIGIN),
    normalizeHost(env.ME3_API_HOST) || hostnameFromUrl(env.CORE_API_ORIGIN),
  ].filter(Boolean);
  if (configuredHosts.some((candidate) => hostsMatch(host, candidate))) {
    return true;
  }
  if (isLoopbackHost(host)) return true;

  // Preserve legacy single-site installs that only configured a username.
  // Once any host is explicit, all other hosts fail closed.
  return (
    Boolean(normalizeUsername(env.ME3_SITE_USERNAME)) &&
    (configuredHosts.length === 0 || configuredHosts.every(isLoopbackHost))
  );
}

export async function servePublicSiteByUsername(
  env: Env,
  rawHost: string,
  rawUsername: string,
  rawPath: string,
  request?: Request,
): Promise<Response> {
  if (!isKnownFallbackSiteHost(env, rawHost)) {
    return new Response(renderNotFoundPage("Site not found"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const site = await getSiteByUsername(env, rawUsername);
  if (!site) {
    return new Response(renderNotFoundPage("Site not found"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return serveSiteFileResponse(
    env,
    site,
    rawPath,
    true,
    `/site/${encodeURIComponent(site.username)}`,
    request,
  );
}

export async function serveSiteFileResponse(
  env: Env,
  site: DbSite,
  rawPath: string,
  requirePublished: boolean,
  publicBasePath = "",
  request?: Request,
): Promise<Response> {
  if (requirePublished && !site.published_at) {
    return new Response(renderNotFoundPage("Site not published"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const requestedPath = normalizeSiteFileName(rawPath) || "index.html";
  let noindex = false;
  if (requirePublished && ["me.json", ".well-known/me.json"].includes(requestedPath)) {
    const response = await siteMeJsonResponse(env, site, request ? new URL(request.url).origin + publicBasePath : "");
    if (response) return response;
  }
  if (requirePublished) {
    const businessSiteRaw = await getSiteFileText(
      env,
      site.id,
      "public/business-site.json",
    );
    if (businessSiteRaw) {
      try {
        const businessSite = normalizeBusinessSiteDocument(
          JSON.parse(businessSiteRaw),
        );
        noindex = businessSite?.seo.indexing === "noindex";
        const requestPath = `/${requestedPath
          .replace(/(?:^|\/)index\.html$/, "")
          .replace(/\/+$/, "")}`.replace(/\/$/, "") || "/";
        const redirect = businessSite?.redirects.find(
          (item) => item.from.replace(/\/+$/, "") === requestPath,
        );
        if (redirect) {
          const redirectTarget =
            publicBasePath &&
            redirect.to.startsWith("/") &&
            !redirect.to.startsWith("//")
              ? `${publicBasePath.replace(/\/+$/, "")}${redirect.to}`
              : redirect.to;
          return new Response(null, {
            status: 301,
            headers: { Location: redirectTarget },
          });
        }
      } catch {
        // Invalid public settings never prevent the last valid page snapshot.
      }
    }
  }
  const publicPath = `public/${requestedPath}`;
  const indexPath =
    requestedPath && !requestedPath.split("/").pop()?.includes(".")
      ? `public/${requestedPath}/index.html`
      : null;
  const htmlPath =
    requestedPath && !requestedPath.split("/").pop()?.includes(".")
      ? `public/${requestedPath}.html`
      : null;
  const isMediaPath = publicPath.startsWith("public/files/") || publicPath === "public/favicon.png";
  const r2File = isMediaPath ? await getSiteMediaFile(env, site, publicPath) : null;
  const file =
    r2File ||
    (await getSiteFile(env, site.id, publicPath)) ||
    (indexPath ? await getSiteFile(env, site.id, indexPath) : null) ||
    (htmlPath ? await getSiteFile(env, site.id, htmlPath) : null) ||
    (requestedPath === "index.html" ? await getSiteFile(env, site.id, "landing/index.html") : null);
  if (!file) {
    return new Response(renderNotFoundPage("Page not found"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return publicSiteFileResponse({
    content: siteFileContentToArrayBuffer(file.content), contentType: file.content_type,
    sha256: file.sha256, published: requirePublished, request, path: requestedPath, noindex,
    profileUrl: `${publicBasePath}/me.json`,
  });
}

async function getSiteMediaFile(env: Env, site: DbSite, path: string): Promise<SiteFileRecord | null> {
  const file = await getR2SiteFile(env, site, path) || await getSiteFile(env, site.id, path);
  if (file || !path.toLowerCase().endsWith(".webp")) return file;

  const base = path.slice(0, -".webp".length);
  for (const ext of ["png", "jpg", "jpeg", "gif"]) {
    const fallback = `${base}.${ext}`;
    const fallbackFile = await getR2SiteFile(env, site, fallback) || await getSiteFile(env, site.id, fallback);
    if (fallbackFile) return fallbackFile;
  }
  return null;
}

export async function getSiteForOwner(env: Env, ownerId: string, rawUsername: string): Promise<DbSite | null> {
  const username = normalizeUsername(rawUsername);
  if (!username) return null;
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE user_id = ? AND username = ?`,
    )
      .bind(ownerId, username)
      .first<DbSite>()) || null
  );
}

export async function getSiteByUsername(env: Env, rawUsername: string): Promise<DbSite | null> {
  const username = normalizeUsername(rawUsername);
  if (!username) return null;
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE username = ?`,
    )
      .bind(username)
      .first<DbSite>()) || null
  );
}

export function normalizeSiteFileName(name: string): string {
  return name
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

export async function putSiteFile(
  env: Env,
  siteId: string,
  path: string,
  content: string | ArrayBuffer,
  contentType: string,
): Promise<void> {
  await (await prepareSiteFileUpsert(env, siteId, path, content, contentType)).run();
}

export async function prepareSiteFileUpsert(
  env: Env,
  siteId: string,
  path: string,
  content: string | ArrayBuffer,
  contentType: string,
): Promise<D1PreparedStatement> {
  const buffer =
    typeof content === "string" ? new TextEncoder().encode(content).buffer : content;
  if (buffer.byteLength > D1_SITE_FILE_MAX_BYTES) {
    throw new Error(
      "File is too large for Core D1 storage. Activate storage in Account settings to upload larger media.",
    );
  }
  return env.DB.prepare(
    `INSERT INTO site_files (site_id, path, content, content_type, size, sha256, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(site_id, path) DO UPDATE SET
       content = excluded.content,
       content_type = excluded.content_type,
       size = excluded.size,
       sha256 = excluded.sha256,
       updated_at = datetime('now')`,
  )
    .bind(siteId, path, buffer, contentType, buffer.byteLength, await sha256Buffer(buffer));
}

export async function putSiteMediaFile(
  env: Env,
  site: DbSite,
  path: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<"d1" | "r2"> {
  if (env.SITE_ASSETS) {
    await putR2SiteFile(env, site, path, content, contentType);
    return "r2";
  }
  await putSiteFile(env, site.id, path, content, contentType);
  return "d1";
}

export async function putR2SiteFile(
  env: Env,
  site: DbSite,
  path: string,
  content: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  if (!env.SITE_ASSETS) {
    throw new Error("SITE_ASSETS R2 binding is not configured");
  }
  await env.SITE_ASSETS.put(getR2SiteFileKey(site, path), content, {
    httpMetadata: { contentType },
  });
}

export async function getSiteFile(env: Env, siteId: string, path: string): Promise<SiteFileRecord | null> {
  return (
    (await env.DB.prepare(
      `SELECT site_id, path, content, content_type, size, sha256, updated_at
       FROM site_files
       WHERE site_id = ? AND path = ?`,
    )
      .bind(siteId, path)
      .first<SiteFileRecord>()) || null
  );
}

export async function deleteSiteFile(env: Env, siteId: string, path: string): Promise<void> {
  await env.DB.prepare("DELETE FROM site_files WHERE site_id = ? AND path = ?")
    .bind(siteId, path)
    .run();
}

export async function deleteSiteMediaFile(
  env: Env,
  site: DbSite,
  path: string,
): Promise<void> {
  await deleteSiteFile(env, site.id, path);
  if (env.SITE_ASSETS) {
    await env.SITE_ASSETS.delete(getR2SiteFileKey(site, path));
  }
}

export async function getR2SiteFile(env: Env, site: DbSite, path: string): Promise<SiteFileRecord | null> {
  if (!env.SITE_ASSETS) return null;
  const object = await env.SITE_ASSETS.get(getR2SiteFileKey(site, path));
  if (!object) return null;
  const content = await object.arrayBuffer();
  return {
    site_id: site.id,
    path,
    content,
    content_type: object.httpMetadata?.contentType || getContentType(path),
    size: object.size,
    sha256: null,
    updated_at: object.uploaded.toISOString(),
  };
}

export function getR2SiteFileKey(site: DbSite, path: string): string {
  return `sites/${site.username}/${normalizeSiteFileName(path)}`;
}

export async function getSiteFileText(env: Env, siteId: string, path: string): Promise<string | null> {
  const file = await getSiteFile(env, siteId, path);
  return file ? arrayBufferToText(file.content) : null;
}

export async function listSiteFiles(env: Env, siteId: string, prefix: string): Promise<SiteFileRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT site_id, path, content, content_type, size, sha256, updated_at
     FROM site_files
     WHERE site_id = ? AND path LIKE ?
     ORDER BY path ASC`,
  )
    .bind(siteId, `${prefix}%`)
    .all<SiteFileRecord>();
  return rows.results || [];
}

export async function loadSiteSourceFiles(env: Env, siteId: string): Promise<Map<string, string>> {
  const files = await listSiteFiles(env, siteId, "src/");
  const sourceFiles = new Map<string, string>();
  for (const file of files) {
    sourceFiles.set(file.path.replace(/^src\//, ""), await arrayBufferToText(file.content));
  }
  return sourceFiles;
}

export function parseSiteProfile(meJson: string, username: string): Me3SiteProfile {
  try {
    const parsed = JSON.parse(meJson) as Me3SiteProfile;
    return {
      ...parsed,
      handle: parsed.handle || username,
      name: parsed.name || username,
    };
  } catch {
    return { version: "0.1", handle: username, name: username };
  }
}

export function shouldIgnoreSiteSourceFile(path: string): boolean {
  const normalized = normalizeSiteFileName(path).toLowerCase();
  const filename = normalized.split("/").pop() || normalized;
  return filename === "readme.md" || filename === ".ds_store";
}

export function buildContentMetaMap(
  entries: Array<Record<string, unknown>>,
  defaultPrefix: "blog" | "shop" | "",
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const slug = typeof entry.slug === "string" ? normalizeSiteFileName(entry.slug) : "";
    const fallbackFile = defaultPrefix && slug
      ? `${defaultPrefix}/${slug}.md`
      : slug
        ? `${slug}.md`
        : "";
    const file = typeof entry.file === "string" && entry.file.trim()
      ? normalizeSiteFileName(entry.file)
      : fallbackFile;
    if (file) map.set(file, entry);
  }
  return map;
}

export function getReferencedSourceFiles(profile: Me3SiteProfile): Set<string> {
  const keep = new Set<string>(["me.json"]);
  const addEntry = (
    entry: { slug?: string; file?: string },
    defaultPrefix: "blog" | "shop" | "",
  ) => {
    const slug = entry.slug ? normalizeSiteFileName(entry.slug) : "";
    const fallbackFile = defaultPrefix && slug
      ? `${defaultPrefix}/${slug}.md`
      : slug
        ? `${slug}.md`
        : "";
    const file = entry.file ? normalizeSiteFileName(entry.file) : fallbackFile;
    if (file && !shouldIgnoreSiteSourceFile(file)) keep.add(file);
  };

  for (const page of profile.pages || []) addEntry(page, "");
  for (const post of profile.posts || []) addEntry(post, "blog");
  for (const product of profile.products || []) addEntry(product, "shop");
  return keep;
}

export async function pruneUnreferencedSiteSourceFiles(
  env: Env,
  siteId: string,
  profile: Me3SiteProfile,
  manifest: PublishManifest,
): Promise<void> {
  const keep = getReferencedSourceFiles(profile);
  const files = await listSiteFiles(env, siteId, "src/");
  for (const file of files) {
    const sourceName = file.path.replace(/^src\//, "");
    if (keep.has(sourceName) && !shouldIgnoreSiteSourceFile(sourceName)) continue;
    await deleteSiteFile(env, siteId, file.path);
    delete manifest.sourceFiles[sourceName];
  }
}

export function getReferencedContentAssetPaths(
  sourceFiles: Map<string, string>,
): Set<string> {
  const referenced = new Set<string>();
  const pattern = /files\/content\/[a-z0-9][a-z0-9-]{0,79}\.(?:jpe?g|png|webp|gif|mp3|m4a|wav)\b/gi;
  for (const content of sourceFiles.values()) {
    for (const match of content.matchAll(pattern)) {
      referenced.add(match[0].toLowerCase());
    }
  }
  return referenced;
}

function deleteManifestAssetEntry(
  manifest: PublishManifest,
  relativePath: string,
): void {
  const normalized = normalizeSiteFileName(relativePath).toLowerCase();
  for (const key of Object.keys(manifest.assetFiles)) {
    if (normalizeSiteFileName(key).toLowerCase() === normalized) {
      delete manifest.assetFiles[key];
    }
  }
}

export async function pruneUnreferencedContentAssets(
  env: Env,
  site: DbSite,
  sourceFiles: Map<string, string>,
  manifest: PublishManifest,
): Promise<void> {
  const keep = getReferencedContentAssetPaths(sourceFiles);
  const d1Files = await listSiteFiles(env, site.id, "public/files/content/");
  for (const file of d1Files) {
    const relativePath = file.path.replace(/^public\//, "").toLowerCase();
    if (keep.has(relativePath)) continue;
    await deleteSiteMediaFile(env, site, file.path);
    deleteManifestAssetEntry(manifest, relativePath);
  }

  if (!env.SITE_ASSETS) return;
  let cursor: string | undefined;
  const prefix = `${getR2SiteFileKey(site, "public/files/content")}/`;
  do {
    const listing = await env.SITE_ASSETS.list(
      cursor ? { prefix, cursor } : { prefix },
    );
    for (const object of listing.objects) {
      const relativePath = object.key.slice(prefix.length);
      const manifestPath = `files/content/${relativePath}`.toLowerCase();
      if (keep.has(manifestPath)) continue;
      await env.SITE_ASSETS.delete(object.key);
      deleteManifestAssetEntry(manifest, manifestPath);
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

export async function pruneGeneratedPublicFiles(
  env: Env,
  siteId: string,
  generatedFiles: Record<string, string>,
): Promise<void> {
  const keep = new Set(Object.keys(generatedFiles).map(normalizeSiteFileName));
  try {
    const pages = await env.DB.prepare(
      "SELECT slug FROM site_pages WHERE site_id = ? AND published_at IS NOT NULL",
    )
      .bind(siteId)
      .all<{ slug: string }>();
    for (const page of pages.results || []) keep.add(`${page.slug}/index.html`);
  } catch (error) {
    if (!isMissingSitePagesTableError(error)) throw error;
  }
  const files = await listSiteFiles(env, siteId, "public/");
  for (const file of files) {
    if (file.path.startsWith("public/files/") || file.path === "public/favicon.png") {
      continue;
    }
    const publicName = file.path.replace(/^public\//, "");
    if (keep.has(publicName)) continue;
    if (!/\.(?:html|json|xml|txt)$/i.test(publicName)) continue;
    await deleteSiteFile(env, siteId, file.path);
  }
}

export function isMissingSitePagesTableError(error: unknown): boolean {
  const message = String(error);
  return /(?:no such table:\s*site_pages\b|site_pages\b.*does not exist)/i.test(message);
}

export function normalizeProductPriceCents(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric);
}

export function normalizeProductCurrency(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : "USD";
}

export function getGeneratedSiteContentType(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "text/html; charset=utf-8";
}

export async function getSiteStorageStatus(env: Env, site: DbSite) {
  const d1Stats = await env.DB.prepare(
    `SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes
     FROM site_files
     WHERE site_id = ?`,
  )
    .bind(site.id)
    .first<{ files: number | string | null; bytes: number | string | null }>();
  const d1MediaStats = await env.DB.prepare(
    `SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes
     FROM site_files
     WHERE site_id = ? AND (path LIKE 'public/files/%' OR path = 'public/favicon.png')`,
  )
    .bind(site.id)
    .first<{ files: number | string | null; bytes: number | string | null }>();

  const r2 = await getR2StorageStats(env, site);

  return {
    ok: true,
    activeMediaStorage: env.SITE_ASSETS ? "r2" : "d1",
    d1: {
      files: Number(d1Stats?.files || 0),
      bytes: Number(d1Stats?.bytes || 0),
      mediaFiles: Number(d1MediaStats?.files || 0),
      mediaBytes: Number(d1MediaStats?.bytes || 0),
      maxFileBytes: D1_SITE_FILE_MAX_BYTES,
    },
    r2: {
      available: Boolean(env.SITE_ASSETS),
      binding: "SITE_ASSETS",
      files: r2.files,
      bytes: r2.bytes,
    },
  };
}

export async function getR2StorageStats(env: Env, site: DbSite): Promise<{ files: number; bytes: number }> {
  if (!env.SITE_ASSETS) return { files: 0, bytes: 0 };
  let cursor: string | undefined;
  let files = 0;
  let bytes = 0;
  const prefix = `sites/${site.username}/public/`;

  do {
    const listing = await env.SITE_ASSETS.list(cursor ? { prefix, cursor } : { prefix });
    for (const object of listing.objects) {
      files += 1;
      bytes += object.size;
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return { files, bytes };
}

export async function loadPublishManifest(env: Env, siteId: string): Promise<PublishManifest | null> {
  const text = await getSiteFileText(env, siteId, "publish-manifest.json");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<PublishManifest>;
    return {
      version: 1,
      sourceFiles: parsed.sourceFiles || {},
      assetFiles: parsed.assetFiles || {},
      updatedAt: parsed.updatedAt || "",
    };
  } catch {
    return null;
  }
}

export async function savePublishManifest(env: Env, siteId: string, manifest: PublishManifest): Promise<void> {
  await putSiteFile(env, siteId, "publish-manifest.json", JSON.stringify(manifest, null, 2), "application/json");
}

export async function arrayBufferToText(content: SiteFileRecord["content"]): Promise<string> {
  return new TextDecoder().decode(siteFileContentToBytes(content));
}

export function siteFileContentToBytes(content: SiteFileRecord["content"]): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (Array.isArray(content)) return new Uint8Array(content);

  const values = Object.values(content);
  if (values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return new Uint8Array(values);
  }

  throw new TypeError("Unsupported site file content format");
}

export interface SiteProfileMetadata {
  bookingEnabledSiteIds: Set<string>;
  avatarBySiteId: Map<string, string>;
}

export async function listSiteProfileMetadata(
  env: Env,
  ownerId: string,
): Promise<SiteProfileMetadata> {
  const files = await env.DB.prepare(
    `SELECT sf.site_id, sf.path, sf.content
     FROM site_files sf
     JOIN sites s ON s.id = sf.site_id
     WHERE s.user_id = ?
       AND COALESCE(s.site_type, 'profile') = 'profile'
       AND sf.path IN ('src/me.json', 'public/me.json')`,
  )
    .bind(ownerId)
    .all<Pick<SiteFileRecord, "site_id" | "path" | "content">>();

  const profiles = new Map<
    string,
    Pick<SiteFileRecord, "site_id" | "path" | "content">
  >();
  for (const file of files.results || []) {
    const existing = profiles.get(file.site_id);
    if (!existing || file.path === "src/me.json") {
      profiles.set(file.site_id, file);
    }
  }

  const enabledSiteIds = new Set<string>();
  const avatarBySiteId = new Map<string, string>();
  for (const [siteId, file] of profiles) {
    try {
      const profile = JSON.parse(
        new TextDecoder().decode(siteFileContentToBytes(file.content)),
      ) as {
        avatar?: unknown;
        intents?: { book?: { enabled?: unknown } };
        capabilities?: { book?: unknown };
      };
      if (typeof profile.avatar === "string" && profile.avatar.trim()) {
        avatarBySiteId.set(siteId, profile.avatar.trim());
      }
      const publicBookingCapability = profile.capabilities?.book;
      if (
        profile.intents?.book?.enabled === true ||
        (typeof publicBookingCapability === "object" &&
          publicBookingCapability !== null)
      ) {
        enabledSiteIds.add(siteId);
      }
    } catch {
      // Invalid profiles are not booking-enabled.
    }
  }
  return { bookingEnabledSiteIds: enabledSiteIds, avatarBySiteId };
}

export async function listBookingEnabledSiteIds(
  env: Env,
  ownerId: string,
): Promise<Set<string>> {
  return (await listSiteProfileMetadata(env, ownerId)).bookingEnabledSiteIds;
}

export function siteFileContentToArrayBuffer(content: SiteFileRecord["content"]): ArrayBuffer {
  const bytes = siteFileContentToBytes(content);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256Text(value: string): Promise<string> {
  return sha256Buffer(new TextEncoder().encode(value).buffer);
}

export async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function imageExtension(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  if (file.name.toLowerCase().endsWith(".png")) return "png";
  if (file.name.toLowerCase().endsWith(".webp")) return "webp";
  if (file.name.toLowerCase().endsWith(".gif")) return "gif";
  return "jpg";
}

export type SiteContentAssetUploadMetadata = {
  ext: "jpg" | "png" | "webp" | "gif" | "mp3" | "m4a" | "wav";
  mimeType: string;
};

export function getSiteContentAssetUploadMetadata(
  file: Pick<File, "name" | "type">,
  kind: "image" | "audio",
): SiteContentAssetUploadMetadata | null {
  const type = file.type.trim().toLowerCase().split(";", 1)[0];
  const extension = file.name.toLowerCase().split(".").pop() || "";

  if (kind === "image") {
    if (type === "image/png" || (!type && extension === "png")) {
      return { ext: "png", mimeType: "image/png" };
    }
    if (type === "image/webp" || (!type && extension === "webp")) {
      return { ext: "webp", mimeType: "image/webp" };
    }
    if (type === "image/gif" || (!type && extension === "gif")) {
      return { ext: "gif", mimeType: "image/gif" };
    }
    if (
      type === "image/jpeg" ||
      type === "image/jpg" ||
      (!type && (extension === "jpg" || extension === "jpeg"))
    ) {
      return { ext: "jpg", mimeType: "image/jpeg" };
    }
    return null;
  }

  if (
    type === "audio/mpeg" ||
    type === "audio/mp3" ||
    (!type && extension === "mp3")
  ) {
    return { ext: "mp3", mimeType: "audio/mpeg" };
  }
  if (
    type === "audio/mp4" ||
    type === "audio/m4a" ||
    type === "audio/x-m4a" ||
    (!type && extension === "m4a")
  ) {
    return { ext: "m4a", mimeType: "audio/mp4" };
  }
  if (
    type === "audio/wav" ||
    type === "audio/wave" ||
    type === "audio/vnd.wave" ||
    type === "audio/x-wav" ||
    (!type && extension === "wav")
  ) {
    return { ext: "wav", mimeType: "audio/wav" };
  }
  return null;
}

export function isSiteMediaFile(filename: string, contentType: string): boolean {
  const lower = filename.toLowerCase();
  const normalizedType = contentType.trim().toLowerCase().split(";", 1)[0];
  const isSupportedAudioType = [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/wav",
    "audio/wave",
    "audio/vnd.wave",
    "audio/x-wav",
  ].includes(normalizedType);
  return (
    normalizedType.startsWith("image/") ||
    isSupportedAudioType ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".mp3") ||
    lower.endsWith(".m4a") ||
    lower.endsWith(".wav")
  );
}

export function normalizeSiteMediaPath(filename: string): string {
  const safe = normalizeSiteFileName(filename);
  if (safe === "favicon.png") return safe;
  if (safe.startsWith("files/")) return safe;
  return `files/${safe.split("/").pop() || "asset"}`;
}

export function getContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function titleFromSlug(slug: string): string {
  const leaf = slug.split("/").pop() || slug;
  return leaf
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function coreSiteCss(): string {
  return `:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17201d;background:#f7faf8}body{margin:0}.shell{width:min(920px,calc(100vw - 32px));margin:0 auto;padding:48px 0}.hero,.page{border:1px solid rgba(23,32,29,.12);border-radius:18px;background:rgba(255,255,255,.86);padding:32px;box-shadow:0 18px 48px rgba(16,24,20,.08)}.badge{display:inline-flex;margin:0 0 18px;padding:6px 10px;border-radius:999px;background:#d9fbe8;color:#14543a;font-size:13px}h1{font-size:clamp(2.25rem,6vw,4.75rem);line-height:1;margin:0 0 16px}p{color:#496057;font-size:1.05rem;line-height:1.65}nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}a{color:#14543a;font-weight:700}.home-link{display:inline-flex;align-items:center;min-height:44px}@media (prefers-color-scheme:dark){:root{color:#ecf5ef;background:#0f1713}.hero,.page{background:rgba(22,31,26,.9);border-color:rgba(236,245,239,.14)}p{color:#adbbb3}.badge{background:#183c2a;color:#a7f3c4}a{color:#86efac}}`;
}

export function renderNotFoundPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(message)}</title><style>${coreSiteCss()}</style></head><body><main class="shell"><section class="hero"><h1>${escapeHtml(message)}</h1><nav aria-label="Page"><a class="home-link" href="/">Return home</a></nav></section></main></body></html>`;
}

export function injectBaseHref(html: string, baseHref: string): string {
  if (/<base\s/i.test(html)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, `<head$1><base href="${escapeHtml(baseHref)}">`);
}

export async function loadLandingPage(env: Env, siteId: string): Promise<LandingPageDocument | null> {
  const text = await getSiteFileText(env, siteId, "landing/page.json");
  if (!text) return null;
  try {
    return normalizeLandingPageDocument(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function saveLandingPage(env: Env, site: DbSite, page: LandingPageDocument): Promise<void> {
  await putSiteFile(env, site.id, "landing/page.json", JSON.stringify(page, null, 2), "application/json");
  await putSiteFile(env, site.id, "landing/index.html", renderLandingPageHtml(page, site.username), "text/html");
  await env.DB.prepare("UPDATE sites SET template_id = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(getLandingPageTemplateId(page), site.id)
    .run();
}

export async function parseSubscriberBody(c: AppContext): Promise<{
  email?: string;
  firstName?: string;
  lastName?: string;
  honeypot?: string;
  pageId?: string;
  actionId?: string;
  campaign?: string;
}> {
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await c.req
      .json<{
        email?: unknown;
        firstName?: unknown;
        lastName?: unknown;
        pageId?: unknown;
        actionId?: unknown;
        campaign?: unknown;
      }>()
      .catch(
        (): {
          email?: unknown;
          firstName?: unknown;
          lastName?: unknown;
          pageId?: unknown;
          actionId?: unknown;
          campaign?: unknown;
        } => ({}),
      );
    return {
      email: typeof body.email === "string" ? body.email : undefined,
      firstName: typeof body.firstName === "string" ? body.firstName : undefined,
      lastName: typeof body.lastName === "string" ? body.lastName : undefined,
      pageId: typeof body.pageId === "string" ? body.pageId : undefined,
      actionId: typeof body.actionId === "string" ? body.actionId : undefined,
      campaign: typeof body.campaign === "string" ? body.campaign : undefined,
    };
  }

  if (contentType.includes("form")) {
    const form = await c.req.formData();
    return {
      email: form.get("email")?.toString(),
      firstName: form.get("firstName")?.toString(),
      lastName: form.get("lastName")?.toString(),
      honeypot: form.get("website")?.toString(),
      pageId: form.get("pageId")?.toString(),
      actionId: form.get("actionId")?.toString(),
      campaign: form.get("campaign")?.toString(),
    };
  }

  return {};
}

export function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

export function findHeaderIndex(header: string[], aliases: string[]): number {
  return header.findIndex((value) => aliases.includes(value));
}

export function splitImportedName(value: string | undefined): { firstName: string | null; lastName: string | null } {
  const normalized = value?.trim().replace(/\s+/g, " ") || "";
  if (!normalized) return { firstName: null, lastName: null };
  const parts = normalized.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function normalizeImportedTimestamp(value: string | undefined): string | null {
  const normalized = value?.trim() || "";
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function generateUnsubscribeToken(
  env: Env,
  email: string,
  username: string,
): Promise<string> {
  const secret = await getOrCreateInstallSessionSecret(env);
  const hash = await sha256Text(
    `me3:unsubscribe:${secret}:${email.toLowerCase()}:${username.toLowerCase()}`,
  );
  return hash.slice(0, 32);
}

export async function verifyUnsubscribeToken(
  env: Env,
  email: string,
  username: string,
  token: string,
): Promise<boolean> {
  const expectedToken = await generateUnsubscribeToken(env, email, username);
  return constantTimeEqual(await sha256Text(token), await sha256Text(expectedToken));
}

export async function hashSubscriberIdentifier(value: string): Promise<string> {
  return sha256Text(`me3:${value.toLowerCase()}`);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export function unsubscribeHtml(title: string, body?: string, note?: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family: system-ui; padding: 40px; text-align: center;"><h1>${escapeHtml(title)}</h1>${body ? `<p>${escapeHtml(body)}</p>` : ""}${note ? `<p style="color: #666; margin-top: 20px;">${escapeHtml(note)}</p>` : ""}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

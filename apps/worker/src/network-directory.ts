import type {
  CorePeopleSearchOffering,
  CorePeopleSearchResult,
  CorePeopleSearchSeller,
  CorePeopleSearchToolServices,
} from "@me3-core/plugin-agent-chat";
import { isLocalDirectoryEnabled, ownerSiteOrigin, searchLocalDirectory } from "./local-directory";
import { ensureSoulinkContactsFresh } from "./routes/channels";
import { getMe3CloudApiOrigin } from "./sites";
import type { DbContact, Env } from "./types";

const OWNER_SECRET = "ME3_CLOUD_OWNER_ID";
const INSTALL_SECRET = "ME3_CORE_INSTALL_ID";
const TOKEN_SECRET = "ME3_CLOUD_CORE_TOKEN";
const REQUEST_TIMEOUT_MS = 5_000;
const LINKS_REFRESH_WAIT_MS = 1_500;

type SoulinkDirectoryBridgeConfig = {
  origin: string;
  headers: Record<string, string>;
};

type SoulinkLinkCandidate = {
  name: string;
  handle: string | null;
  me3Url: string | null;
  updatedAt: string;
};

export class SoulinkDirectoryError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "SoulinkDirectoryError";
  }
}

export function createPeopleSearchToolServices(
  env: Env,
  ownerId: string,
): CorePeopleSearchToolServices {
  return {
    search: (input) => searchPeople(env, ownerId, input),
  };
}

export async function syncPublishedProfileToSoulinkDirectory(
  env: Env,
  profile: unknown,
): Promise<"synced" | "not_connected" | "not_listed"> {
  const config = await getSoulinkDirectoryBridgeConfig(env);
  if (!config) return "not_connected";
  const response = await fetchWithTimeout(`${config.origin}/v1/network/profile`, {
    method: "PUT",
    headers: { ...config.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  const data = await readJson(response);
  if (
    (response.status === 403 && data.code === "soulink_membership_required") ||
    (response.status === 422 && data.code === "profile_private")
  ) {
    return "not_listed";
  }
  if (!response.ok) throw bridgeError(data, response.status, "Failed to sync the public Soulink profile.");
  return "synced";
}

export async function removePublishedProfileFromSoulinkDirectory(
  env: Env,
): Promise<"removed" | "not_connected"> {
  const config = await getSoulinkDirectoryBridgeConfig(env);
  if (!config) return "not_connected";
  const response = await fetchWithTimeout(`${config.origin}/v1/network/profile`, {
    method: "DELETE",
    headers: config.headers,
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw bridgeError(data, response.status, "Failed to remove the directory profile.");
  }
  return "removed";
}

export async function searchPeople(
  env: Env,
  ownerId: string,
  input: Parameters<CorePeopleSearchToolServices["search"]>[0],
): ReturnType<CorePeopleSearchToolServices["search"]> {
  const limit = Math.min(10, Math.max(1, Math.floor(input.limit || 5)));
  const publicLimit = Math.max(limit, 10);
  const includeMe = input.includeMe === true;
  const [linkState, publicState, localResults, ownOrigin] = await Promise.all([
    loadSoulinkLinkCandidates(env, ownerId),
    searchPublicSoulinkDirectory(env, { ...input, limit: publicLimit }).then(
      (value) => ({ value, warning: null as string | null }),
      (error) => ({
        value: null,
        warning: error instanceof SoulinkDirectoryError && error.code === "me3_cloud_not_connected"
          // A local install searches its local directory instead; linking is not a step in its journey.
          ? isLocalDirectoryEnabled(env) ? null : "Public Soulink profiles are unavailable until this installation is linked to me3.app."
          : "Public Soulink search is temporarily unavailable; these results include current Links only.",
      }),
    ),
    searchLocalDirectory(env, ownerId, input),
    includeMe ? ownerSiteOrigin(env, ownerId) : Promise.resolve(null),
  ]);

  const publicResults = [...(publicState.value?.results || []), ...localResults].map((result) =>
    // The owner's own listing comes back only when they asked to see it (includeSelf at Cloud, includeMe locally).
    result.self || (ownOrigin && [result.publicUrl, result.profileUrl].some((url) => publicOrigin(url) === ownOrigin))
      ? { ...result, self: true }
      : result,
  );
  const annotatedPublicResults = publicResults.map((result) => {
    const link = linkState.links.find((candidate) => publicResultMatchesLink(result, candidate));
    return link
      ? {
          ...result,
          relationshipTier: "link" as const,
          contactName: link.name,
          reasons: uniqueStrings(["One of your Soulink Links", ...result.reasons]).slice(0, 3),
        }
      : result;
  });
  const localMatches = linkState.links
    .filter((link) => linkMatchesQuery(link, input.query))
    .filter((link) => !annotatedPublicResults.some((result) => publicResultMatchesLink(result, link)))
    .map(linkCandidateToPeopleResult);
  const ordered = preferAgentCheckoutOnTies(deduplicatePeopleResults([
    ...localMatches,
    ...annotatedPublicResults.filter((result) => result.relationshipTier === "link"),
    ...annotatedPublicResults.filter((result) => result.relationshipTier === "public"),
  ]));
  // The owner's own listing always makes the cut when they asked for it.
  const own = ordered.filter((result) => result.self);
  const merged = [...ordered.filter((result) => !result.self).slice(0, Math.max(0, limit - own.length)), ...own];
  const warnings = uniqueStrings([
    linkState.warning,
    publicState.warning,
    ...(publicState.value?.warnings || []),
  ].filter((value): value is string => Boolean(value)));

  return {
    query: input.query.trim().slice(0, 200),
    results: merged,
    total: merged.length,
    warnings,
  };
}

export async function searchPublicSoulinkDirectory(
  env: Env,
  input: Parameters<CorePeopleSearchToolServices["search"]>[0],
): ReturnType<CorePeopleSearchToolServices["search"]> {
  const config = await getSoulinkDirectoryBridgeConfig(env);
  if (!config) {
    throw new SoulinkDirectoryError(
      "Link this installation to me3.app before searching public Soulink profiles.",
      503,
      "me3_cloud_not_connected",
    );
  }
  const response = await fetchWithTimeout(`${config.origin}/v1/network/search`, {
    method: "POST",
    headers: { ...config.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: input.query.trim().slice(0, 200),
      offeringType: input.offeringType,
      ...(input.offeringKind ? { offeringKind: input.offeringKind } : {}),
      countryCode: input.countryCode?.trim().slice(0, 2).toUpperCase(),
      limit: Math.min(10, Math.max(1, Math.floor(input.limit || 5))),
      ...(input.includeMe ? { includeSelf: true } : {}),
    }),
  });
  const data = await readJson(response);
  if (!response.ok) throw bridgeError(data, response.status, "Failed to search public Soulink profiles.");
  return normalizeSearchResponse(data, input.query);
}

export async function authorizePublicProfileSchedulingTarget(
  env: Env,
  profileIdInput: string,
  requestIdInput: string,
) {
  const profileId = string(profileIdInput, 200);
  const requestId = string(requestIdInput, 160);
  if (!profileId || !requestId) {
    throw new SoulinkDirectoryError(
      "Select one exact public Soulink profile before requesting a meeting.",
      400,
      "network_profile_required",
    );
  }
  const config = await getSoulinkDirectoryBridgeConfig(env);
  if (!config) {
    throw new SoulinkDirectoryError(
      "Link this installation to me3.app before requesting a meeting with a public profile.",
      503,
      "me3_cloud_not_connected",
    );
  }
  const response = await fetchWithTimeout(
    `${config.origin}/v1/network/scheduling/authorize`,
    {
      method: "POST",
      headers: { ...config.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, requestId }),
    },
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw bridgeError(
      data,
      response.status,
      "The selected public Soulink profile could not receive a meeting request.",
    );
  }
  const authorizedProfileId = string(data.profileId, 200);
  const name = string(data.name, 160);
  const authorization = string(data.authorization, 8_000);
  const expiresAt = string(data.expiresAt, 80);
  if (
    authorizedProfileId !== profileId ||
    !name ||
    !authorization ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new SoulinkDirectoryError(
      "ME3 Cloud returned an invalid public-profile scheduling authorization.",
      502,
      "invalid_network_scheduling_authorization",
    );
  }
  return {
    profileId: authorizedProfileId,
    name,
    handle: string(data.handle, 120),
    authorization,
    expiresAt: new Date(Date.parse(expiresAt)).toISOString(),
  };
}

export async function getSoulinkDirectoryBridgeConfig(
  env: Env,
): Promise<SoulinkDirectoryBridgeConfig | null> {
  const [ownerId, installId, token] = await Promise.all([
    getInstallSecret(env, OWNER_SECRET),
    getInstallSecret(env, INSTALL_SECRET),
    getInstallSecret(env, TOKEN_SECRET),
  ]);
  if (!ownerId || !installId || !token) return null;
  return {
    origin: getMe3CloudApiOrigin(env),
    headers: {
      "X-ME3-Core-Owner-ID": ownerId,
      "X-ME3-Core-Install-ID": installId,
      "X-ME3-Core-Update-Token": token,
    },
  };
}

function normalizeSearchResponse(
  data: Record<string, unknown>,
  fallbackQuery: string,
): Awaited<ReturnType<CorePeopleSearchToolServices["search"]>> {
  const results = Array.isArray(data.results)
    ? data.results.slice(0, 10).flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const result = value as Record<string, unknown>;
        const profileId = string(result.profileId, 200);
        const name = string(result.name, 160);
        const profileUrl = httpsUrl(result.profileUrl);
        if (!profileId || !name || !profileUrl) return [];
        const rawLocation = result.location && typeof result.location === "object"
          ? result.location as Record<string, unknown>
          : null;
        return [{
          relationshipTier: "public" as const,
          profileId,
          contactName: null,
          name,
          handle: string(result.handle, 120),
          kind: string(result.kind, 40) || "person",
          bio: string(result.bio, 2_000),
          avatarUrl: httpsUrl(result.avatarUrl),
          profileUrl,
          publicUrl: httpsUrl(result.publicUrl),
          location: rawLocation && string(rawLocation.label, 160)
            ? {
                label: string(rawLocation.label, 160)!,
                precision: string(rawLocation.precision, 40) || "unknown",
                locality: string(rawLocation.locality, 120),
                region: string(rawLocation.region, 120),
                country: string(rawLocation.country, 120),
                countryCode: string(rawLocation.countryCode, 2),
              }
            : null,
          offerings: normalizeOfferings(result.offerings),
          reasons: Array.isArray(result.reasons)
            ? result.reasons.map((reason) => string(reason, 200)).filter(isString).slice(0, 3)
            : [],
          indexedAt: string(result.indexedAt, 80) || "",
          ...sellerFields(result.seller),
        }];
      })
    : [];
  return {
    query: string(data.query, 200) || fallbackQuery,
    results,
    total: results.length,
    warnings: [],
  };
}

function normalizeOfferings(value: unknown): CorePeopleSearchOffering[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const offering = entry as Record<string, unknown>;
    const type: CorePeopleSearchOffering["type"] | null =
      offering.type === "service" || offering.type === "product"
      ? offering.type
      : null;
    const id = string(offering.id, 200);
    const title = string(offering.title, 200);
    if (!type || !id || !title) return [];
    const rawPrice = offering.price && typeof offering.price === "object"
      ? offering.price as Record<string, unknown>
      : null;
    const amount = string(rawPrice?.amount, 40);
    const currency = string(rawPrice?.currency, 12);
    return [{
      type,
      id,
      title,
      description: string(offering.description, 1_000),
      url: httpsUrl(offering.url),
      durationMinutes: typeof offering.durationMinutes === "number" && Number.isFinite(offering.durationMinutes)
        ? Math.max(1, Math.floor(offering.durationMinutes))
        : null,
      price: amount && currency ? { amount, currency } : null,
      ...(offering.kind === "booking" || offering.kind === "event" || offering.kind === "product" ? { kind: offering.kind } : {}),
      ...(offering.delivery === "online" || offering.delivery === "in_person" || offering.delivery === "hybrid" ? { delivery: offering.delivery } : {}),
      agentCheckout: normalizeAgentCheckout(offering.agentCheckout),
    }];
  });
}

/** Only an https spec on the seller's agent commerce path counts as agent checkout. */
function normalizeAgentCheckout(value: unknown): CorePeopleSearchOffering["agentCheckout"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const version = string(raw.version, 20);
  const specUrl = httpsUrl(raw.specUrl);
  if (!version || !specUrl || !/\/api\/agent-commerce\/v1\/sites\/[^/]+\/openapi\.json$/.test(new URL(specUrl).pathname)) return null;
  return { version, specUrl };
}

function sellerFields(value: unknown): { seller: CorePeopleSearchSeller; badges: string[] } | Record<string, never> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const seller: CorePeopleSearchSeller = {
    soulinkLinked: raw.soulinkLinked === true,
    listedSince: string(raw.listedSince, 80),
    completedNetworkSales: typeof raw.completedNetworkSales === "number" && Number.isFinite(raw.completedNetworkSales)
      ? Math.max(0, Math.floor(raw.completedNetworkSales))
      : 0,
    reportStatus: raw.reportStatus === "reported" ? "reported" : "none",
    newSeller: raw.newSeller === true,
    agentCheckout: raw.agentCheckout === true,
  };
  const badges = [
    seller.agentCheckout ? "ME3 agent checkout" : null,
    seller.soulinkLinked ? "Soulink member" : null,
    seller.completedNetworkSales > 0 ? `${seller.completedNetworkSales} network ${seller.completedNetworkSales === 1 ? "sale" : "sales"}` : null,
    seller.newSeller ? "New seller" : null,
    seller.reportStatus === "reported" ? "Reported, under review" : null,
  ].filter(isString);
  return { seller, badges };
}

function hasAgentCheckout(result: CorePeopleSearchResult): boolean {
  return result.offerings.some((offering) => Boolean(offering.agentCheckout));
}

/**
 * ME3 Cloud already ranks by relevance band, then location, then trust. Core only
 * breaks near-ties toward sellers with agent checkout: such a seller moves ahead of the
 * public result directly above it when both match on an offering, that result has no
 * agent checkout, and it is not a reported seller. A seller never moves more than one
 * place, so a clearly better match stays ahead.
 */
export function preferAgentCheckoutOnTies(results: readonly CorePeopleSearchResult[]): CorePeopleSearchResult[] {
  const ordered = [...results];
  const offersMatch = (result: CorePeopleSearchResult) => result.reasons.some((reason) => reason.startsWith("Offers "));
  for (let index = 1; index < ordered.length; index++) {
    const above = ordered[index - 1], current = ordered[index];
    if (
      above.relationshipTier === "public" && current.relationshipTier === "public" &&
      offersMatch(above) && offersMatch(current) &&
      !hasAgentCheckout(above) && hasAgentCheckout(current) &&
      current.seller?.reportStatus !== "reported"
    ) {
      ordered[index - 1] = current;
      ordered[index] = above;
      // Skip the moved result so it cannot climb a second place.
      index++;
    }
  }
  return ordered;
}

async function loadSoulinkLinkCandidates(
  env: Env,
  ownerId: string,
): Promise<{ links: SoulinkLinkCandidate[]; warning: string | null }> {
  let warning: string | null = null;
  // A stale list refreshes from Soulink, which can take seconds; search with the Links already saved
  // rather than hold up the owner's search for it.
  try {
    await Promise.race([
      ensureSoulinkContactsFresh(env, ownerId),
      new Promise((resolve) => setTimeout(resolve, LINKS_REFRESH_WAIT_MS)),
    ]);
  } catch {
    warning = "Soulink Links could not be refreshed; results may use the last synchronized Links.";
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT id, user_id, name, email, phone, source, source_ref,
              relationship, status, notes, tags, last_interaction_at,
              next_followup_at, outreach_status, social_handles, metadata,
              created_at, updated_at
       FROM contacts
       WHERE user_id = ? AND status = 'active' AND source = 'soulink'
       ORDER BY COALESCE(last_interaction_at, updated_at, created_at) DESC
       LIMIT 250`,
    )
      .bind(ownerId)
      .all<DbContact>();
    const links = (rows.results || []).map((contact) => {
      const metadata = parseRecord(contact.metadata);
      const socialHandles = parseRecord(contact.social_handles);
      return {
        name: contact.name,
        handle: string(socialHandles.soulink, 120) || string(metadata.soulinkHandle, 120),
        me3Url: string(metadata.me3Url, 2_000) || string(socialHandles.me3, 2_000),
        updatedAt:
          string(metadata.soulinkLastActiveAt, 80) ||
          string(contact.last_interaction_at, 80) ||
          contact.updated_at,
      };
    });
    return { links, warning };
  } catch {
    return {
      links: [],
      warning: warning || "Soulink Links are temporarily unavailable.",
    };
  }
}

function linkCandidateToPeopleResult(link: SoulinkLinkCandidate): CorePeopleSearchResult {
  const profileUrl = httpsUrl(link.me3Url);
  return {
    relationshipTier: "link",
    profileId: null,
    contactName: link.name,
    name: link.name,
    handle: link.handle,
    kind: "person",
    bio: null,
    avatarUrl: null,
    profileUrl,
    publicUrl: publicOrigin(profileUrl),
    location: null,
    offerings: [],
    reasons: ["One of your Soulink Links"],
    indexedAt: link.updatedAt,
  };
}

function linkMatchesQuery(link: SoulinkLinkCandidate, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;
  const haystack = normalizeSearchText([link.name, link.handle].filter(Boolean).join(" "));
  return haystack.includes(normalizedQuery) ||
    normalizedQuery.split(" ").every((token) => token.length > 1 && haystack.includes(token));
}

function publicResultMatchesLink(
  result: CorePeopleSearchResult,
  link: SoulinkLinkCandidate,
): boolean {
  const resultOrigins = [result.profileUrl, result.publicUrl]
    .map(publicOrigin)
    .filter((value): value is string => Boolean(value));
  const linkOrigin = publicOrigin(link.me3Url);
  if (linkOrigin && resultOrigins.includes(linkOrigin)) return true;
  const resultHandle = normalizeHandle(result.handle);
  const linkHandle = normalizeHandle(link.handle);
  return Boolean(resultHandle && linkHandle && resultHandle === linkHandle);
}

function deduplicatePeopleResults(
  results: readonly CorePeopleSearchResult[],
): CorePeopleSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.profileId
      ? `profile:${result.profileId}`
      : publicOrigin(result.profileUrl || result.publicUrl) ||
        (normalizeHandle(result.handle) ? `handle:${normalizeHandle(result.handle)}` : null) ||
        `name:${normalizeSearchText(result.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeHandle(value: string | null): string | null {
  const normalized = value?.trim().replace(/^@/, "").toLocaleLowerCase() || "";
  return normalized || null;
}

function publicOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function getInstallSecret(env: Env, name: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
      .bind(name)
      .first<{ value: string }>();
    return string(row?.value, 4_000);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SoulinkDirectoryError("Soulink people search timed out.", 504, "network_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().then(
    (value) => value && typeof value === "object" ? value as Record<string, unknown> : {},
    () => ({}),
  );
}

function bridgeError(
  data: Record<string, unknown>,
  status: number,
  fallback: string,
): SoulinkDirectoryError {
  return new SoulinkDirectoryError(
    string(data.error, 500) || fallback,
    status,
    string(data.code, 100),
  );
}

function httpsUrl(value: unknown): string | null {
  const candidate = string(value, 2_000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function string(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isString(value: string | null): value is string {
  return Boolean(value);
}

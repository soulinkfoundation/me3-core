type LocationSearchEnv = {
  ME3_LOCATION_SEARCH_ORIGIN?: string;
};

export type LocationPrecision =
  | "locality"
  | "city"
  | "district"
  | "county"
  | "region"
  | "country"
  | "unknown";

export interface LocationSearchResult {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
  locality?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  source: {
    provider: "photon";
    id?: string;
    osmType?: string;
    osmId?: string | number;
    osmKey?: string;
    osmValue?: string;
  };
}

export type LocationSearchResponse =
  | {
      ok: true;
      locations: LocationSearchResult[];
      attribution: { provider: "photon"; label: string; url: string };
    }
  | { ok: false; status: number; error: string };

type PhotonFeature = {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
};

type PhotonResponse = {
  features?: PhotonFeature[];
};

const DEFAULT_LOCATION_SEARCH_ORIGIN = "https://photon.komoot.io";
const LOCATION_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LOCATION_SEARCH_CACHE_MAX = 100;
const LOCATION_SEARCH_TIMEOUT_MS = 4500;
const LOCATION_LAYERS = ["city", "locality", "district", "county", "state", "country"];
const locationSearchCache = new Map<
  string,
  { expiresAt: number; response: LocationSearchResponse }
>();

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function number(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function clampLimit(rawLimit: string | null | undefined): number {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(10, Math.max(1, Math.round(parsed)));
}

function normalizeQuery(rawQuery: string | null | undefined): string {
  return (rawQuery || "").replace(/\p{C}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function getSearchOrigin(env: LocationSearchEnv): string {
  const configured = env.ME3_LOCATION_SEARCH_ORIGIN?.trim();
  if (!configured) return DEFAULT_LOCATION_SEARCH_ORIGIN;

  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_LOCATION_SEARCH_ORIGIN;
  }
}

function buildPhotonUrl(origin: string, query: string, limit: number): string {
  const url = new URL("/api/", origin);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("dedupe", "1");
  for (const layer of LOCATION_LAYERS) {
    url.searchParams.append("layer", layer);
  }
  return url.toString();
}

function dedupeParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(part);
  }
  return output;
}

function normalizePrecision(properties: Record<string, unknown>): LocationPrecision {
  const key = text(properties.osm_key)?.toLowerCase();
  const value = text(properties.osm_value)?.toLowerCase();

  if (key === "place") {
    if (value === "city" || value === "town") return "city";
    if (value === "village" || value === "hamlet" || value === "locality") {
      return "locality";
    }
    if (value === "suburb" || value === "neighbourhood" || value === "quarter") {
      return "district";
    }
    if (value === "county") return "county";
    if (value === "state" || value === "province" || value === "region") {
      return "region";
    }
    if (value === "country") return "country";
  }

  if (text(properties.city)) return "city";
  if (text(properties.locality)) return "locality";
  if (text(properties.district)) return "district";
  if (text(properties.county)) return "county";
  if (text(properties.state)) return "region";
  if (text(properties.country)) return "country";
  return "unknown";
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(5));
}

function normalizePhotonFeature(feature: PhotonFeature): LocationSearchResult | null {
  const coordinates = Array.isArray(feature.geometry?.coordinates)
    ? feature.geometry?.coordinates
    : [];
  const longitude = number(coordinates[0]);
  const latitude = number(coordinates[1]);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  const properties = feature.properties || {};
  const precision = normalizePrecision(properties);
  const name = text(properties.name);
  const city = text(properties.city);
  const rawLocality = city || text(properties.locality) || text(properties.district);
  const locality =
    rawLocality ||
    (precision === "city" || precision === "locality" || precision === "district"
      ? name
      : undefined);
  const county = text(properties.county);
  const state = text(properties.state);
  const country = text(properties.country);
  const countryCode = text(properties.countrycode)?.toUpperCase();
  const primary = name || locality || county || state || country;
  if (!primary) return null;

  const region = state || county;
  const label = dedupeParts([primary, region, country]).join(", ").slice(0, 100);
  const osmType = text(properties.osm_type);
  const osmId = properties.osm_id;
  const sourceId =
    osmType && (typeof osmId === "string" || typeof osmId === "number")
      ? `${osmType}:${osmId}`
      : undefined;

  return {
    id: sourceId ? `photon:${sourceId}` : `photon:${label}:${latitude}:${longitude}`,
    label,
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
    precision,
    ...(locality ? { locality } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { countryCode } : {}),
    source: {
      provider: "photon",
      ...(sourceId ? { id: sourceId } : {}),
      ...(osmType ? { osmType } : {}),
      ...(typeof osmId === "string" || typeof osmId === "number" ? { osmId } : {}),
      ...(text(properties.osm_key) ? { osmKey: text(properties.osm_key) } : {}),
      ...(text(properties.osm_value) ? { osmValue: text(properties.osm_value) } : {}),
    },
  };
}

function normalizePhotonResponse(data: PhotonResponse, limit: number): LocationSearchResult[] {
  const seen = new Set<string>();
  const locations: LocationSearchResult[] = [];

  for (const feature of data.features || []) {
    const location = normalizePhotonFeature(feature);
    if (!location) continue;
    const key = `${location.source.id || location.id}:${location.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location);
    if (locations.length >= limit) break;
  }

  return locations;
}

function getCachedLocationSearch(cacheKey: string): LocationSearchResponse | null {
  const cached = locationSearchCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    locationSearchCache.delete(cacheKey);
    return null;
  }
  return cached.response;
}

function setCachedLocationSearch(cacheKey: string, response: LocationSearchResponse): void {
  if (!response.ok) return;
  if (locationSearchCache.size >= LOCATION_SEARCH_CACHE_MAX) {
    const firstKey = locationSearchCache.keys().next().value;
    if (firstKey) locationSearchCache.delete(firstKey);
  }
  locationSearchCache.set(cacheKey, {
    expiresAt: Date.now() + LOCATION_SEARCH_CACHE_TTL_MS,
    response,
  });
}

export async function searchLocationQuery(
  env: LocationSearchEnv,
  rawQuery: string | null | undefined,
  rawLimit?: string | null,
): Promise<LocationSearchResponse> {
  const query = normalizeQuery(rawQuery);
  const limit = clampLimit(rawLimit);
  if (query.length < 2) {
    return {
      ok: true,
      locations: [],
      attribution: {
        provider: "photon",
        label: "Photon",
        url: DEFAULT_LOCATION_SEARCH_ORIGIN,
      },
    };
  }

  const origin = getSearchOrigin(env);
  const upstreamUrl = buildPhotonUrl(origin, query, limit);
  const cacheKey = `${origin}:${limit}:${query.toLowerCase()}`;
  const cached = getCachedLocationSearch(cacheKey);
  if (cached) return cached;

  let failure = "Location lookup is temporarily unavailable.";
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOCATION_SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(upstreamUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const data = (await response.json()) as PhotonResponse;
      const result: LocationSearchResponse = {
        ok: true,
        locations: normalizePhotonResponse(data, limit),
        attribution: {
          provider: "photon",
          label: "Photon",
          url: origin,
        },
      };
      setCachedLocationSearch(cacheKey, result);
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        failure = "Location lookup timed out.";
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, status: 502, error: failure };
}

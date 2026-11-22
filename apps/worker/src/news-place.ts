// Where the owner lives, for local news and weather (me3-6ptk). The town on their own ME3 profile
// is the best first guess; the city their timezone is named after is only a fallback, because a
// timezone names a capital, not a home (Europe/Dublin covers Limerick and Galway too).
import { cityFromTimezone, cleanCityName } from "./news-weather";
import { ownerPublicPage } from "./owner-public-page";
import { getSiteFileText } from "./sites";
import type { Env } from "./types";

export type NewsTown = { name: string; country: string | null };

/** The town a profile gives: its locality, else the first part of its location line ("Limerick, Ireland"). */
export function townFromProfile(profile: unknown): NewsTown | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const row = profile as Record<string, unknown>;
  const data = row.locationData && typeof row.locationData === "object" ? row.locationData as Record<string, unknown> : {};
  const name = cleanCityName(data.locality) || cleanCityName(data.label) || cleanCityName(row.location);
  if (!name) return null;
  // A country is not a town: "Ireland" on a profile says nothing about which paper is local.
  const country = typeof data.country === "string" ? data.country.trim().toLowerCase() : "";
  if (!cleanCityName(data.locality) && (data.precision === "country" || (country && name.toLowerCase() === country))) return null;
  const code = typeof data.countryCode === "string" && /^[A-Za-z]{2}$/.test(data.countryCode) ? data.countryCode.toUpperCase() : null;
  return { name, country: code };
}

/** The town on the owner's own profile site, if they gave one; on the free plan, the town on their public me3.app page. */
export async function ownerProfileTown(env: Env, userId: string): Promise<NewsTown | null> {
  try {
    const site = await env.DB.prepare(
      `SELECT id FROM sites WHERE user_id = ? AND (site_role = 'profile' OR (site_role IS NULL AND COALESCE(site_type, 'profile') = 'profile'))
       ORDER BY created_at ASC LIMIT 1`,
    ).bind(userId).first<{ id: string }>();
    if (!site) return townFromProfile(await ownerPublicPage(env));
    const raw = await getSiteFileText(env, site.id, "public/me.json");
    return raw ? townFromProfile(JSON.parse(raw)) : null;
  } catch { return null; }
}

/**
 * The town to look up when the owner never chose one: nothing is stored yet, or what is stored is
 * only the timezone's city. Returns null when the stored town should stay.
 */
export async function townToTry(env: Env, userId: string, stored: string | null, timezone: string | null, profileTown: typeof ownerProfileTown = ownerProfileTown): Promise<NewsTown | null> {
  const zoneCity = cityFromTimezone(timezone);
  const same = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  if (stored && !same(stored, zoneCity)) return null;
  const town = await profileTown(env, userId);
  if (town) return same(town.name, stored) ? null : town;
  return stored || !zoneCity ? null : { name: zoneCity, country: null };
}

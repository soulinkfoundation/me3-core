// Where the owner is and what the weather is doing there (me3-6ptk.2/.3), from Open-Meteo: free and
// keyless. Only a city name or a pair of coordinates is ever sent, never who is asking. Both calls
// are best effort: News works without a city (country news, no weather box).

export type NewsPlace = { city: string; country: string | null; lat: number; lon: number };
export type NewsWeather = { emoji: string; temp: string; text: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const GEOCODE_ORIGIN = "https://geocoding-api.open-meteo.com";
const FORECAST_ORIGIN = "https://api.open-meteo.com";

/** A city name is letters, spaces and a little punctuation. Anything that looks like an address or a sentence is refused. */
export function cleanCityName(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("@") || /\d/.test(value) || /https?:\/\//i.test(value)) return null;
  const city = value.split(",")[0].replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  return city && city.length <= 60 ? city : null;
}

/** The city an IANA timezone is named after, as a first guess the owner can correct: Europe/Dublin → Dublin. */
export function cityFromTimezone(timezone: string | null | undefined): string | null {
  const last = (timezone || "").split("/").pop() || "";
  if (!last || /^(utc|gmt|etc)/i.test(timezone || "")) return null;
  return cleanCityName(last.replace(/_/g, " "));
}

/**
 * Soup's news needs a country. When the owner's town was never looked up, the timezone gives a
 * fair guess for the countries Soup has a front page for; anywhere else gets the world front page.
 */
export const NEWS_WORLD = "ZZ";
export function countryFromTimezone(timezone: string | null | undefined): string {
  const zone = timezone || "";
  if (zone === "Europe/Dublin") return "IE";
  if (zone === "Europe/London" || zone === "Europe/Belfast") return "GB";
  if (/^(America\/(New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Detroit|Boise|Indiana\/|Kentucky\/)|Pacific\/Honolulu|US\/)/.test(zone)) return "US";
  return NEWS_WORLD;
}

export async function geocodeCity(name: string, options: { country?: string | null; fetch?: FetchLike; signal?: AbortSignal } = {}): Promise<NewsPlace | null> {
  const city = cleanCityName(name);
  if (!city) return null;
  const params = new URLSearchParams({ name: city, count: "5", language: "en", format: "json" });
  try {
    const response = await (options.fetch || fetch)(`${GEOCODE_ORIGIN}/v1/search?${params}`, { headers: { Accept: "application/json" }, signal: options.signal || AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const data = await response.json() as { results?: Array<{ name?: string; latitude?: number; longitude?: number; country_code?: string }> };
    const results = (data.results || []).filter(row => typeof row.latitude === "number" && typeof row.longitude === "number");
    const wanted = options.country?.toUpperCase();
    const hit = (wanted && results.find(row => row.country_code?.toUpperCase() === wanted)) || results[0];
    if (!hit) return null;
    return { city: hit.name || city, country: hit.country_code ? hit.country_code.toUpperCase() : null, lat: Math.round(hit.latitude! * 100) / 100, lon: Math.round(hit.longitude! * 100) / 100 };
  } catch { return null; }
}

// WMO weather codes, grouped the way a person would say them.
const WEATHER: Array<[codes: number[], emoji: string, text: string]> = [
  [[0], "☀️", "Clear"],
  [[1, 2], "🌤️", "Mostly clear"],
  [[3], "🌥️", "Cloudy"],
  [[45, 48], "🌫️", "Fog"],
  [[51, 53, 55, 56, 57], "🌦️", "Drizzle"],
  [[61, 63, 65, 66, 67], "🌧️", "Rain"],
  [[80, 81, 82], "🌧️", "Showers"],
  [[71, 73, 75, 77, 85, 86], "🌨️", "Snow"],
  [[95, 96, 99], "⛈️", "Thunderstorms"],
];

export function describeWeather(input: { code: number; temp: number; windMax?: number | null; tomorrowCode?: number | null }): NewsWeather {
  const find = (code: number) => WEATHER.find(([codes]) => codes.includes(code));
  const [, emoji, text] = find(input.code) || [[], "🌥️", "Cloudy"];
  const extras: string[] = [];
  if (typeof input.windMax === "number" && input.windMax >= 50) extras.push("strong wind");
  else if (typeof input.windMax === "number" && input.windMax >= 30) extras.push("breezy");
  const tomorrow = typeof input.tomorrowCode === "number" ? find(input.tomorrowCode) : undefined;
  if (tomorrow && tomorrow[2] !== text) extras.push(`${tomorrow[2].toLowerCase()} tomorrow`);
  return { emoji, temp: `${Math.round(input.temp)}°`, text: [text, ...extras].join(", ") };
}

export async function fetchWeather(place: { lat: number; lon: number }, options: { fetch?: FetchLike; signal?: AbortSignal } = {}): Promise<NewsWeather | null> {
  const params = new URLSearchParams({
    latitude: String(place.lat), longitude: String(place.lon), current: "temperature_2m,weather_code",
    daily: "weather_code,wind_speed_10m_max", timezone: "auto", forecast_days: "2",
  });
  try {
    const response = await (options.fetch || fetch)(`${FORECAST_ORIGIN}/v1/forecast?${params}`, { headers: { Accept: "application/json" }, signal: options.signal || AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const data = await response.json() as { current?: { temperature_2m?: number; weather_code?: number }; daily?: { weather_code?: number[]; wind_speed_10m_max?: number[] } };
    if (typeof data.current?.temperature_2m !== "number" || typeof data.current.weather_code !== "number") return null;
    return describeWeather({ code: data.current.weather_code, temp: data.current.temperature_2m, windMax: data.daily?.wind_speed_10m_max?.[0] ?? null, tomorrowCode: data.daily?.weather_code?.[1] ?? null });
  } catch { return null; }
}

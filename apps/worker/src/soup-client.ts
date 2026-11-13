// Plain HTTP client for The Human Soup (thehumansoup.ai). ME3 has no MCP client, and
// Soup's REST API is simpler: /v1/soups, /v1/soups/{handle}/bowl, /v1/search, /v1/signals.
//
// Privacy contract (me3-ydf4): personalisation happens in ME3. Soup only ever receives
// topic words, filters and item IDs already served. Never a name, email, employer,
// project text or the for-you line. Every outbound request goes through
// `soupSearchQuery`, which whitelists the fields.

/** The Soup contract this client was written against (packages/core in the Soup repo). */
export const SOUP_CONTRACT_VERSION = "2026-11-04.2";
export const DEFAULT_SOUP_API_ORIGIN = "https://api.thehumansoup.ai";
/** Soup credits the agent that served a bowl; it is a plain identifier, never the owner. */
export const SOUP_AGENT_ID = "me3";

export type SoupMedium = "watch" | "listen" | "read";
export type SoupBowlStyle = "standard" | "headlines";
export type SoupBowlMode = "mixed" | "best" | "fresh" | "gems" | "surprise";

export type SoupItem = {
  id: string;
  kind: "video" | "article" | "audio" | "note";
  url: string;
  title: string;
  creator: { name: string; url?: string };
  publishedAt?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  embedUrl?: string;
};

export type SoupCard = {
  summary: string;
  why: string;
  format: string;
  level?: string;
  shelfLife?: string;
  topics: string[];
  quote?: { text: string; by?: string; url?: string };
};

export type SoupBowlItem = {
  item: SoupItem;
  card: SoupCard;
  reason: { kind: string; text: string };
  headline?: string;
  soup: { handle: string; title: string; attribution?: { text: string; url: string; license?: string } };
};

export type SoupSummary = {
  handle: string;
  title: string;
  tagline: string;
  topics: string[];
  itemCount: number;
  daily?: { date: string; item: SoupItem; card: SoupCard };
};

export type SoupSearchRequest = {
  q?: string;
  topics?: string[];
  soups?: string[];
  limit?: number;
  style?: SoupBowlStyle;
  mode?: SoupBowlMode;
  formats?: string[];
  maxMinutes?: number;
  medium?: SoupMedium;
  exclude?: string[];
  since?: string;
};

export type SoupSearchResult = {
  items: SoupBowlItem[];
  /** Search was unavailable and the items came from per-soup bowls instead. */
  fallback: boolean;
  contractVersion: string | null;
  intro?: string;
};

export type SoupSignal = {
  itemId: string;
  soup: string;
  kind: "served" | "opened" | "finished" | "liked" | "saved" | "shared" | "skipped" | "dismissed";
  at?: string;
  consent?: { aggregate: boolean; soulinkResonance: boolean };
};

// ── News (me3-6ptk.3; Soup's thehumansoup-lnf.40.4 contract) ──
// One call before the owner's paper is built: today's candidate stories for some topic words and
// a region. Soup gathers once for everyone; picking and the personal notes happen in ME3.

export type NewsStory = {
  id: string;
  headline: string;
  /** The feed's own short excerpt (at most 500 characters). Never full text. */
  summary: string;
  url: string;
  image?: { url: string; width?: number; height?: number };
  sources: Array<{ name: string; url: string }>;
  publishedAt?: string;
  topics: string[];
  category?: string;
  medium: SoupMedium;
  durationSeconds?: number;
  embedUrl?: string;
};
export type NewsTodayRequest = { topics: string[]; country?: string | null; city?: string | null; since?: string; exclude?: string[] };
export type NewsToday = {
  contractVersion: string | null;
  frontPage: NewsStory[];
  byTopic: Array<{ topic: string; stories: NewsStory[] }>;
  local: NewsStory[];
  media: NewsStory[];
  meta: { considered: number; grouped: boolean };
};

const NEWS_KEYS = new Set(["topics", "country", "city", "since", "exclude"]);

/** The only shape ever sent to Soup's news API: topic words, a country, a city name and story IDs already shown. */
export function newsTodayQuery(request: NewsTodayRequest): URLSearchParams {
  for (const key of Object.keys(request)) if (!NEWS_KEYS.has(key)) throw new Error(`News requests never carry ${key}.`);
  const params = new URLSearchParams();
  const topics = [...new Set((request.topics || []).map(cleanSoupTopic).filter((topic): topic is string => !!topic))].slice(0, MAX_TOPICS);
  if (topics.length) params.set("topics", topics.join(","));
  if (typeof request.country === "string" && /^[A-Za-z]{2}$/.test(request.country)) params.set("country", request.country.toUpperCase());
  const city = typeof request.city === "string" && !/[@\d]/.test(request.city) ? request.city.replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (city) params.set("city", city);
  if (request.since && !Number.isNaN(Date.parse(request.since))) params.set("since", new Date(request.since).toISOString());
  const exclude = (request.exclude || []).filter(id => typeof id === "string" && /^[\w:.-]{1,120}$/.test(id)).slice(0, MAX_EXCLUDE);
  if (exclude.length) params.set("exclude", exclude.join(","));
  // A plain identifier for the agent, and a mark that this is a scheduled build so no public count moves.
  params.set("agent", SOUP_AGENT_ID);
  params.set("scheduled", "1");
  return params;
}

function readNewsStories(value: unknown): NewsStory[] {
  return (Array.isArray(value) ? value : []).flatMap(entry => {
    const row = entry as Partial<NewsStory> | null;
    if (!row || typeof row.id !== "string" || typeof row.headline !== "string" || typeof row.url !== "string" || !/^https?:\/\//i.test(row.url)) return [];
    const sources = (Array.isArray(row.sources) ? row.sources : []).filter(source => source && typeof source.name === "string" && typeof source.url === "string").map(source => ({ name: source.name, url: source.url }));
    const image = row.image && typeof row.image.url === "string" && /^https:\/\//i.test(row.image.url) ? { url: row.image.url } : undefined;
    const medium: SoupMedium = row.medium === "watch" || row.medium === "listen" ? row.medium : "read";
    const story: NewsStory = { id: row.id, headline: row.headline.trim(), summary: typeof row.summary === "string" ? row.summary.trim().slice(0, 500) : "", url: row.url, sources, topics: Array.isArray(row.topics) ? row.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 12) : [], medium };
    if (image) story.image = image;
    if (typeof row.publishedAt === "string") story.publishedAt = row.publishedAt;
    if (typeof row.category === "string") story.category = row.category;
    if (typeof row.durationSeconds === "number" && row.durationSeconds > 0) story.durationSeconds = row.durationSeconds;
    if (typeof row.embedUrl === "string" && /^https:\/\//i.test(row.embedUrl)) story.embedUrl = row.embedUrl;
    return story.headline ? [story] : [];
  });
}

/** Reads a news response defensively: a field that is missing or the wrong shape becomes empty, never a crash. */
export function readNewsToday(data: unknown): NewsToday {
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const meta = (raw.meta && typeof raw.meta === "object" ? raw.meta : {}) as Record<string, unknown>;
  return {
    contractVersion: typeof raw.contractVersion === "string" ? raw.contractVersion : null,
    frontPage: readNewsStories(raw.frontPage),
    byTopic: (Array.isArray(raw.byTopic) ? raw.byTopic : []).flatMap(entry => {
      const row = entry as { topic?: unknown; stories?: unknown } | null;
      return row && typeof row.topic === "string" ? [{ topic: row.topic.toLowerCase(), stories: readNewsStories(row.stories) }] : [];
    }),
    local: readNewsStories(raw.local),
    media: readNewsStories(raw.media),
    meta: { considered: typeof meta.considered === "number" ? meta.considered : 0, grouped: meta.grouped === true },
  };
}

export class SoupUnavailableError extends Error {
  constructor(message: string, readonly status: number | null = null) { super(message); }
}

const MAX_TOPICS = 12;
const MAX_TOPIC_CHARS = 40;
const MAX_QUERY_CHARS = 200;
// Sent in the URL, so bounded well under the 16 KB a request line may carry.
const MAX_EXCLUDE = 300;
const MAX_LIMIT = 20;
const SEARCH_KEYS = new Set(["q", "topics", "soups", "limit", "style", "mode", "formats", "maxMinutes", "medium", "exclude", "since"]);

/** A topic word is a short, lower-case phrase. Anything that looks like an address, a name with punctuation or a sentence is dropped. */
export function cleanSoupTopic(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("@") || /https?:\/\//i.test(value)) return null;
  const topic = value.toLowerCase().replace(/[^\p{L}\p{N}\s&+.-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!topic || topic.length > MAX_TOPIC_CHARS || /\d{6,}/.test(topic)) return null;
  return topic;
}

/**
 * The only shape ever sent to Soup. Unknown keys are dropped, so owner data cannot leak in by
 * accident, and the values are bounded.
 */
export function soupSearchQuery(request: SoupSearchRequest): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(request)) if (!SEARCH_KEYS.has(key)) throw new Error(`Soup requests never carry ${key}.`);
  // The search words are topic words too, so they pass the same clean-up, phrase by phrase.
  const q = typeof request.q === "string" && !request.q.includes("@") && !/https?:\/\//i.test(request.q)
    ? request.q.toLowerCase().replace(/[^\p{L}\p{N}\s&+.-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS) : "";
  if (q) params.set("q", q);
  const topics = [...new Set((request.topics || []).map(cleanSoupTopic).filter((topic): topic is string => !!topic))].slice(0, MAX_TOPICS);
  if (topics.length) params.set("topics", topics.join(","));
  const soups = (request.soups || []).map(handle => String(handle).replace(/^@/, "").toLowerCase().trim()).filter(handle => /^[a-z0-9][a-z0-9/_-]{0,80}$/.test(handle)).slice(0, 20);
  if (soups.length) params.set("soups", soups.join(","));
  if (request.limit) params.set("limit", String(Math.max(1, Math.min(MAX_LIMIT, Math.round(request.limit)))));
  if (request.style) params.set("style", request.style);
  if (request.mode) params.set("mode", request.mode);
  if (request.formats?.length) params.set("formats", request.formats.slice(0, 10).join(","));
  if (request.maxMinutes && request.maxMinutes > 0) params.set("maxMinutes", String(Math.round(request.maxMinutes)));
  if (request.medium) params.set("medium", request.medium);
  const exclude = (request.exclude || []).filter(id => typeof id === "string" && /^[\w:.-]{1,120}$/.test(id)).slice(0, MAX_EXCLUDE);
  if (exclude.length) params.set("exclude", exclude.join(","));
  if (request.since && !Number.isNaN(Date.parse(request.since))) params.set("since", new Date(request.since).toISOString());
  return params;
}

export type SoupClient = {
  listSoups(signal?: AbortSignal): Promise<SoupSummary[]>;
  search(request: SoupSearchRequest, signal?: AbortSignal): Promise<SoupSearchResult>;
  bowl(handle: string, request: Omit<SoupSearchRequest, "q" | "soups">, signal?: AbortSignal): Promise<SoupBowlItem[]>;
  /** Search the pantry; when search is unavailable, serve bowls from the named or public soups instead. */
  find(request: SoupSearchRequest, signal?: AbortSignal): Promise<SoupSearchResult>;
  sendSignals(signals: SoupSignal[], signal?: AbortSignal): Promise<void>;
  /** Today's candidate stories. Throws SoupUnavailableError with status 404 where Soup has no news API yet. */
  newsToday(request: NewsTodayRequest, signal?: AbortSignal): Promise<NewsToday>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createSoupClient(options: { origin?: string | null; fetch?: FetchLike } = {}): SoupClient {
  const origin = (options.origin || DEFAULT_SOUP_API_ORIGIN).replace(/\/+$/, "");
  const fetchImpl: FetchLike = options.fetch || ((input, init) => fetch(input, init));
  const headers = { Accept: "application/json", "User-Agent": `me3-soup/${SOUP_CONTRACT_VERSION}` };

  async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try { response = await fetchImpl(`${origin}${path}`, { headers, signal }); }
    catch (error) { throw new SoupUnavailableError(`The Human Soup could not be reached: ${error instanceof Error ? error.message : String(error)}`); }
    if (!response.ok) throw new SoupUnavailableError(`The Human Soup answered ${response.status} for ${path.split("?")[0]}`, response.status);
    return response.json() as Promise<T>;
  }

  const toBowlItems = (items: unknown, soup: SoupBowlItem["soup"]): SoupBowlItem[] =>
    (Array.isArray(items) ? items : []).flatMap(entry => {
      const row = entry as Partial<SoupBowlItem>;
      if (!row?.item?.id || !row.item.url || !row.item.title || !row.card) return [];
      return [{ item: row.item, card: row.card, reason: row.reason || { kind: "match", text: "" }, ...(row.headline ? { headline: row.headline } : {}), soup: row.soup || soup }];
    });

  const client: SoupClient = {
    async listSoups(signal) {
      const data = await getJson<{ soups?: SoupSummary[] }>("/v1/soups", signal);
      return Array.isArray(data.soups) ? data.soups.filter(soup => typeof soup?.handle === "string") : [];
    },
    async search(request, signal) {
      const params = soupSearchQuery(request);
      if (!params.has("q") && !params.has("topics")) return { items: [], fallback: false, contractVersion: null };
      const data = await getJson<{ contractVersion?: string; items?: unknown; plating?: { intro?: string } }>(`/v1/search?${params}`, signal);
      return { items: toBowlItems(data.items, { handle: "", title: "" }), fallback: false, contractVersion: data.contractVersion || null, intro: data.plating?.intro };
    },
    async bowl(handle, request, signal) {
      const params = soupSearchQuery({ ...request, mode: request.mode || "fresh" });
      const data = await getJson<{ soup?: { handle: string; title: string; attribution?: SoupBowlItem["soup"]["attribution"] }; items?: unknown }>(`/v1/soups/${encodeURIComponent(handle)}/bowl?${params}`, signal);
      return toBowlItems(data.items, { handle: data.soup?.handle || handle, title: data.soup?.title || handle, attribution: data.soup?.attribution });
    },
    async find(request, signal) {
      try { return await client.search(request, signal); }
      catch (error) {
        // Search landed after the first public soups; an older or partial deployment serves bowls only.
        if (!(error instanceof SoupUnavailableError) || (error.status !== null && error.status < 400)) throw error;
        const handles = request.soups?.length ? request.soups : (await client.listSoups(signal)).map(soup => soup.handle).slice(0, 6);
        const { q, soups: _soups, ...rest } = request;
        // Bowls have no search words, so the words become the topic filter.
        const filters = { ...rest, ...(!rest.topics?.length && q ? { topics: [q] } : {}) };
        const perSoup = Math.max(2, Math.ceil((request.limit || 8) / Math.max(1, handles.length)));
        const bowls = await Promise.allSettled(handles.map(handle => client.bowl(handle, { ...filters, limit: perSoup }, signal)));
        const items = bowls.flatMap(result => result.status === "fulfilled" ? result.value : []);
        if (!items.length && bowls.every(result => result.status === "rejected")) throw error;
        return { items, fallback: true, contractVersion: null };
      }
    },
    async newsToday(request, signal) {
      return readNewsToday(await getJson<unknown>(`/v1/news/today?${newsTodayQuery(request)}`, signal));
    },
    async sendSignals(signals, signal) {
      if (!signals.length) return;
      const body = signals.map(entry => ({ itemId: entry.itemId, soup: entry.soup, kind: entry.kind, at: entry.at || new Date().toISOString(), agent: SOUP_AGENT_ID, ...(entry.consent ? { consent: entry.consent } : {}) }));
      let response: Response;
      try { response = await fetchImpl(`${origin}/v1/signals`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
      catch (error) { throw new SoupUnavailableError(`The Human Soup could not be reached: ${error instanceof Error ? error.message : String(error)}`); }
      if (!response.ok) throw new SoupUnavailableError(`The Human Soup answered ${response.status} for signals`, response.status);
    },
  };
  return client;
}

/** Minutes for display, from Soup's duration in seconds. */
export function soupMinutes(item: Pick<SoupItem, "durationSeconds">): number | null {
  return item.durationSeconds && item.durationSeconds > 0 ? Math.max(1, Math.round(item.durationSeconds / 60)) : null;
}

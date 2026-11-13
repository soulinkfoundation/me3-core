// News settings (me3-6ptk.2): the topics for the owner's morning paper, where they are, when it
// should be ready and whether to announce it. Stored inside the Soup taste row (soup_taste), so no
// migration: "For your work" is the work lane, "Just for you" the interests lane, and the `news`
// key holds the rest. Only topic words and a region ever leave the install.
import { JournalInputError } from "./journal";
import { normalizeDailyBriefingTime } from "./morning-calendar-push";
import { cityFromTimezone, cleanCityName, geocodeCity, type NewsPlace } from "./news-weather";
import { cleanSoupTopic } from "./soup-client";
import { MAX_TOPICS_PER_LANE, NEWS_DEFAULT_TIME, earnSoupHomeCard, getSoupTaste, snapNewsTime, type NewsPrefs, type SoupTaste, type SoupTasteState, type SoupWorkTopic } from "./soup-taste";
import { isRecord } from "./workspace-input";
import type { Env } from "./types";

export type NewsTopicChip = { word: string; label: string; on: boolean };
export type NewsSettings = {
  setUp: boolean;
  paused: boolean;
  work: NewsTopicChip[];
  mine: NewsTopicChip[];
  lessOf: string[];
  city: string | null;
  country: string | null;
  time: string;
  weekendOffsetMinutes: number;
  notify: boolean;
};

/** A chip from the owner or the agent: a plain label, on or off, and for work topics the project it follows. */
export type NewsTopicInput = { label: string; on: boolean; projectId: string | null };

const PATCH_KEYS = new Set(["work", "mine", "lessOf", "city", "time", "notify", "paused", "setUp"]);
const SENTENCE_CASE = /^[a-z]/;

export function newsTopicLabel(word: string, labels: Record<string, string>): string {
  return labels[word] || word.replace(SENTENCE_CASE, letter => letter.toUpperCase());
}

/** News is set up once the owner confirmed topics and a time; a Soup setup alone is not a News setup. */
export const newsIsSetUp = (state: Pick<SoupTasteState, "taste">) => Boolean(state.taste.news?.setUpAt);

export function defaultNewsPrefs(time: string | null = null): NewsPrefs {
  return { time: snapNewsTime(time) || NEWS_DEFAULT_TIME, weekendOffsetMinutes: 60, notify: true, paused: false, city: null, country: null, lat: null, lon: null, labels: {}, moreWork: [], moreMine: [], lastRating: null, setUpAt: null };
}

export function describeNewsSettings(state: SoupTasteState): NewsSettings {
  const prefs = state.taste.news || defaultNewsPrefs();
  const chips = (on: string[], off: string[]): NewsTopicChip[] => {
    const taken = new Set(on);
    return [...on.map(word => ({ word, label: newsTopicLabel(word, prefs.labels), on: true })), ...off.filter(word => !taken.has(word)).map(word => ({ word, label: newsTopicLabel(word, prefs.labels), on: false }))];
  };
  return {
    setUp: newsIsSetUp(state), paused: prefs.paused,
    work: chips(state.taste.workTopics.map(topic => topic.topic), prefs.moreWork),
    mine: chips(state.taste.interests, prefs.moreMine),
    lessOf: state.taste.lessOf,
    city: prefs.city, country: prefs.country, time: prefs.time, weekendOffsetMinutes: prefs.weekendOffsetMinutes, notify: prefs.notify,
  };
}

export function readTopicInputs(value: unknown, label: string): NewsTopicInput[] {
  if (!Array.isArray(value)) throw new JournalInputError(`${label} must be a list of topics`);
  const seen = new Set<string>();
  const topics: NewsTopicInput[] = [];
  for (const entry of value) {
    const raw: Record<string, unknown> = isRecord(entry) ? entry : { label: entry };
    const text = typeof raw.label === "string" ? raw.label.replace(/\s+/g, " ").trim() : "";
    const word = cleanSoupTopic(text);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    topics.push({ label: text.slice(0, 40), on: raw.on !== false, projectId: typeof raw.projectId === "string" && raw.projectId ? raw.projectId : null });
  }
  if (topics.filter(topic => topic.on).length > MAX_TOPICS_PER_LANE) throw new JournalInputError(`${label} takes up to ${MAX_TOPICS_PER_LANE} topics`);
  return topics.slice(0, MAX_TOPICS_PER_LANE * 2);
}

/** Applies a settings change to the stored taste. Pure, so the rules are testable without a database. */
export function applyNewsPatch(taste: SoupTaste, input: Record<string, unknown>, context: { projectIds: Set<string>; defaultTime: string | null; place?: NewsPlace; city?: string; now?: Date }): SoupTaste {
  const prefs: NewsPrefs = { ...(taste.news || defaultNewsPrefs(context.defaultTime)), labels: { ...(taste.news?.labels || {}) } };
  const next: SoupTaste = { ...taste, news: prefs };
  // A label is kept only when it carries its own capitals ("AI agents"); a plain lower-case one is shown
  // with a capital first letter instead ("coaching" → "Coaching").
  const remember = (topics: NewsTopicInput[]) => {
    for (const topic of topics) {
      const word = cleanSoupTopic(topic.label)!;
      if (topic.label.toLowerCase() !== word) continue;
      if (topic.label !== word) prefs.labels[word] = topic.label; else delete prefs.labels[word];
    }
  };
  if (input.work !== undefined) {
    const topics = readTopicInputs(input.work, "work");
    remember(topics);
    const known = new Map(taste.workTopics.map(topic => [topic.topic, topic]));
    next.workTopics = topics.filter(topic => topic.on).map((topic): SoupWorkTopic => {
      const word = cleanSoupTopic(topic.label)!;
      const projectId = topic.projectId && context.projectIds.has(topic.projectId) ? topic.projectId : known.get(word)?.projectId ?? null;
      return { topic: word, projectId, source: projectId ? "project" : known.get(word)?.source ?? "owner" };
    });
    prefs.moreWork = topics.filter(topic => !topic.on).map(topic => cleanSoupTopic(topic.label)!).slice(0, MAX_TOPICS_PER_LANE);
  }
  if (input.mine !== undefined) {
    const topics = readTopicInputs(input.mine, "mine");
    remember(topics);
    next.interests = topics.filter(topic => topic.on).map(topic => cleanSoupTopic(topic.label)!);
    prefs.moreMine = topics.filter(topic => !topic.on).map(topic => cleanSoupTopic(topic.label)!).slice(0, MAX_TOPICS_PER_LANE);
  }
  if (input.lessOf !== undefined) {
    if (!Array.isArray(input.lessOf)) throw new JournalInputError("lessOf must be a list of topics");
    next.lessOf = [...new Set(input.lessOf.map(cleanSoupTopic).filter((topic): topic is string => !!topic))].slice(0, MAX_TOPICS_PER_LANE);
  }
  if (input.time !== undefined) {
    const time = snapNewsTime(input.time);
    if (!time) throw new JournalInputError("time must look like 06:45");
    prefs.time = time;
  }
  if (input.notify !== undefined) {
    if (typeof input.notify !== "boolean") throw new JournalInputError("notify must be true or false");
    prefs.notify = input.notify;
  }
  if (input.paused !== undefined) {
    if (typeof input.paused !== "boolean") throw new JournalInputError("paused must be true or false");
    prefs.paused = input.paused;
  }
  if (context.place) {
    prefs.city = context.place.city; prefs.country = context.place.country ?? prefs.country; prefs.lat = context.place.lat; prefs.lon = context.place.lon;
  } else if (context.city) {
    // A place the lookup did not know: keep the name and country, drop the old city's coordinates.
    prefs.city = context.city; prefs.lat = null; prefs.lon = null;
  }
  if (input.setUp !== undefined) {
    if (input.setUp !== true) throw new JournalInputError("setUp can only be set to true");
    if (!next.workTopics.length && !next.interests.length) throw new JournalInputError("Pick at least one topic first");
    prefs.paused = false;
    prefs.setUpAt ||= (context.now || new Date()).toISOString();
  }
  return next;
}

async function ownerClock(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT timezone, daily_briefing_time FROM owner_profile WHERE id = ?").bind(userId).first<{ timezone: string | null; daily_briefing_time: string | null }>();
  return { timezone: row?.timezone || null, briefingTime: normalizeDailyBriefingTime(row?.daily_briefing_time) };
}

export async function getNewsSettings(env: Env, userId: string): Promise<NewsSettings> {
  return describeNewsSettings(await getSoupTaste(env, userId));
}

type Geocode = (name: string, options?: { country?: string | null }) => Promise<NewsPlace | null>;

/**
 * Saves a settings change. A new city is looked up once so the paper has a country and the weather
 * has coordinates; when no city was ever given, the one the owner's timezone is named after is the
 * first guess. `setUp: true` records the owner's confirmation, after which the paper is built daily.
 */
export async function updateNewsSettings(env: Env, userId: string, input: unknown, options: { now?: Date; geocode?: Geocode } = {}): Promise<{ settings: NewsSettings; firstSetUp: boolean }> {
  if (!isRecord(input) || Object.keys(input).some(key => !PATCH_KEYS.has(key))) throw new JournalInputError("News settings changes must be work, mine, lessOf, city, time, notify, paused or setUp");
  const now = options.now || new Date();
  const geocode = options.geocode || geocodeCity;
  const [current, clock] = await Promise.all([getSoupTaste(env, userId), ownerClock(env, userId)]);
  let place: NewsPlace | undefined;
  let city: string | undefined;
  if (input.city !== undefined) {
    const name = cleanCityName(input.city);
    if (!name) throw new JournalInputError("city must be a place name, like Galway");
    place = await geocode(name) ?? undefined;
    if (!place) city = name;
  } else if (!current.taste.news?.city) {
    const guess = cityFromTimezone(clock.timezone);
    place = (guess ? await geocode(guess) : null) ?? undefined;
  }
  const wasSetUp = newsIsSetUp(current);
  const next = applyNewsPatch(current.taste, input, { projectIds: new Set(current.projects.map(project => project.id)), defaultTime: clock.briefingTime, now, ...(place ? { place } : {}), ...(city ? { city } : {}) });
  const setUpAt = input.setUp === true ? now.toISOString() : null;
  await env.DB.prepare(`INSERT INTO soup_taste(user_id, taste_json, set_up_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET taste_json = excluded.taste_json, set_up_at = coalesce(soup_taste.set_up_at, excluded.set_up_at), updated_at = excluded.updated_at`)
    .bind(userId, JSON.stringify(next), setUpAt, now.toISOString()).run();
  // Confirming the setup, or adding News back after removing it, puts the card on Home.
  if (input.setUp === true || input.paused === false) await earnSoupHomeCard(env, userId);
  const state = await getSoupTaste(env, userId);
  return { settings: describeNewsSettings(state), firstSetUp: !wasSetUp && newsIsSetUp(state) };
}

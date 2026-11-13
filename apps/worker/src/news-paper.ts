// The daily paper (me3-6ptk.3). About thirty minutes before the owner's time a cron asks The
// Human Soup once for today's candidate stories (topic words and a region, nothing else), makes
// one small model call to pick the stories and write ME3's notes, lays them out as pages and
// stores the paper so it can be read all day. If the picks fail the owner still gets a front
// page on time; if Soup cannot be reached there is no paper at all rather than an empty one.
import type { AgentModel, AgentTool } from "../../../packages/agent/src/types";
import { addDaysToDateString, normalizeTimeZone } from "./calendar";
import { JournalInputError } from "./journal";
import { describeNewsSettings, newsIsSetUp, newsTopicLabel } from "./news-settings";
import { fetchWeather, type NewsWeather } from "./news-weather";
import { isCorePluginEnabled } from "./plugins";
import { getOwnerProfile } from "./sites";
import { SoupUnavailableError, soupMinutes, type NewsStory, type NewsToday, type SoupBowlItem, type SoupClient, type SoupMedium } from "./soup-client";
import { localInstant, localParts, runWithFastModel, soupClientFor } from "./soup-servings";
import { SOUP_PLUGIN_ID, getSoupTaste, parseSoupTaste, type NewsPrefs, type SoupTaste } from "./soup-taste";
import { newsFixtureFor, newsFixtureGood } from "./testing/news-today.fixture";
import { parseJsonRecord } from "./workspace-input";
import type { Env } from "./types";

// ── The stored paper ────────────────────────────────────────

export type PaperStory = {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  /** The publisher's own image URL. Never proxied or stored. */
  image?: string;
  publishedAt?: string;
  /** The topic it was picked for, as the owner wrote it ("Surfing"). */
  tag?: string;
  /** ME3's note: only where the story touches the owner's work, calendar or projects. */
  note?: string;
  /** A next step that opens chat with ME3; the paper itself never writes anything. */
  action?: { label: string; prompt: string };
  medium: SoupMedium;
  minutes?: number;
  embedUrl?: string;
};
export type NewsPaperPages = {
  front: { lead: PaperStory; briefs: PaperStory[] };
  work: { topics: string[]; stories: PaperStory[] } | null;
  media: { video: PaperStory | null; listen: PaperStory | null } | null;
  topics: { stories: PaperStory[] } | null;
  near: { city: string | null; weather: NewsWeather | null; local: PaperStory | null; good: PaperStory | null } | null;
};
export type NewsRating = "fire" | "ok" | "sleepy";
export type NewsPaperCounts = { pages: number; stories: number; videos: number; minutes: number; considered: number };
export type NewsPaper = {
  id: string;
  dateKey: string;
  /** The local time it was due, HH:MM. */
  time: string;
  deliverAt: string;
  readyAt: string;
  readAt: string | null;
  hiddenAt: string | null;
  rating: NewsRating | null;
  /** True when the picks failed and only the front page could be laid out. */
  frontOnly: boolean;
  pages: NewsPaperPages;
  counts: NewsPaperCounts;
};

type PaperRow = {
  id: string; user_id: string; date_key: string; status: "pending" | "ready" | "failed"; paper_json: string; deliver_at: string;
  ready_at: string | null; attempts: number; claimed_at: number; read_at: string | null; hidden_at: string | null; rating: NewsRating | null;
};

/** Build this long before the owner's time, so the paper is ready when they look. */
export const NEWS_LEAD_MINUTES = 30;
/** A missed paper still builds within this window, then the morning has passed. */
export const NEWS_CATCH_UP_MINUTES = 180;
const STALE_CLAIM_MS = 5 * 60_000;
const FRESH_WINDOW_MS = 36 * 3_600_000;
const EXCLUDE_WINDOW_DAYS = 7;
const NOTE_MAX = 140;
const WORK_STORIES = 3;
const TOPIC_STORIES = 2;
const BRIEFS = 2;

// ── Candidates ──────────────────────────────────────────────

export type NewsCandidates = {
  front: NewsStory[];
  work: Array<{ topic: string; stories: NewsStory[] }>;
  mine: Array<{ topic: string; stories: NewsStory[] }>;
  local: NewsStory[];
  media: NewsStory[];
  considered: number;
};

/** Sorts Soup's answer into the paper's lanes and drops anything the owner wants less of. */
export function toNewsCandidates(news: NewsToday, taste: Pick<SoupTaste, "workTopics" | "interests" | "lessOf">): NewsCandidates {
  const lessOf = taste.lessOf;
  const keep = (story: NewsStory) => !lessOf.length || !lessOf.some(topic => [story.headline, ...story.topics].join(" ").toLowerCase().includes(topic));
  const lane = (words: string[]) => words.flatMap(word => {
    const stories = (news.byTopic.find(entry => entry.topic === word)?.stories || []).filter(keep);
    return stories.length ? [{ topic: word, stories }] : [];
  });
  return {
    front: news.frontPage.filter(keep),
    work: lane(taste.workTopics.map(topic => topic.topic)),
    mine: lane(taste.interests),
    local: news.local.filter(keep),
    media: news.media.filter(keep),
    considered: news.meta.considered,
  };
}

function bowlToStory(row: SoupBowlItem): NewsStory {
  const medium: SoupMedium = row.item.kind === "audio" ? "listen" : row.item.kind === "video" ? "watch" : "read";
  return {
    id: row.item.id, headline: row.headline || row.item.title, summary: (row.card.summary || "").slice(0, 500), url: row.item.url,
    sources: [{ name: row.item.creator?.name || row.soup.title || "The Human Soup", url: row.item.creator?.url || row.item.url }],
    topics: row.card.topics || [], medium,
    ...(row.item.thumbnailUrl && /^https:\/\//i.test(row.item.thumbnailUrl) ? { image: { url: row.item.thumbnailUrl } } : {}),
    ...(row.item.publishedAt ? { publishedAt: row.item.publishedAt } : {}),
    ...(row.item.durationSeconds ? { durationSeconds: row.item.durationSeconds } : {}),
    ...(row.item.embedUrl ? { embedUrl: row.item.embedUrl } : {}),
  };
}

/**
 * Where Soup has no news API yet, the paper is made from its existing search: fresh headlines per
 * topic word. There is no general front page or local news in that case, so the lead comes from
 * the owner's work topics.
 */
export async function newsFromSearch(client: SoupClient, topics: string[], options: { exclude: string[]; since: string }): Promise<NewsToday> {
  const results = await Promise.allSettled(topics.map(q => client.find({ q, style: "headlines", limit: 5, since: options.since, exclude: options.exclude })));
  if (results.length && results.every(result => result.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  const seen = new Set<string>();
  const media: NewsStory[] = [];
  const byTopic = topics.map((topic, index) => {
    const result = results[index];
    const stories: NewsStory[] = [];
    for (const row of result.status === "fulfilled" ? result.value.items : []) {
      if (seen.has(row.item.id)) continue;
      seen.add(row.item.id);
      const story = bowlToStory(row);
      (story.medium === "read" ? stories : media).push(story);
    }
    return { topic, stories };
  });
  return { contractVersion: null, frontPage: [], byTopic, local: [], media, meta: { considered: seen.size, grouped: false } };
}

async function gatherNews(env: Env, client: SoupClient, taste: SoupTaste, prefs: NewsPrefs, exclude: string[], now: Date): Promise<NewsToday> {
  const topics = [...taste.workTopics.map(topic => topic.topic), ...taste.interests].slice(0, 12);
  const request = { topics, country: prefs.country, city: prefs.city, since: new Date(now.getTime() - FRESH_WINDOW_MS).toISOString(), exclude };
  if (env.ME3_SOUP_NEWS_FIXTURE) return newsFixtureFor(request);
  try { return await client.newsToday(request, AbortSignal.timeout(12_000)); }
  catch (error) {
    // 404 or 405: this Soup deployment has no news API yet. Anything else is Soup being unreachable.
    if (!(error instanceof SoupUnavailableError) || (error.status !== 404 && error.status !== 405)) throw error;
    return newsFromSearch(client, topics, { exclude, since: request.since });
  }
}

// ── Picks: one small model call ─────────────────────────────

export type PaperPicks = {
  lead?: { id: string; note?: string };
  briefs?: string[];
  work?: Array<{ id: string; note?: string; action?: { label: string; prompt: string } }>;
  video?: { id: string; note?: string };
  listen?: { id: string };
  topics?: string[];
  local?: { id: string };
};

const idNote = { type: "object", properties: { id: { type: "string" }, note: { type: "string", description: `Only when the story touches the owner's work, calendar or projects: one plain sentence of at most ${NOTE_MAX} characters. Leave out otherwise.` } }, required: ["id"], additionalProperties: false } as const;
const layoutTool: AgentTool = {
  name: "core_news_layout",
  description: "Choose the stories for each page of the owner's morning paper and write a note only where one is earned.",
  parameters: {
    type: "object",
    properties: {
      lead: idNote,
      briefs: { type: "array", maxItems: BRIEFS, items: { type: "string" }, description: "Two more front-page stories, by id." },
      work: {
        type: "array", maxItems: WORK_STORIES,
        items: { type: "object", properties: { ...idNote.properties, actionLabel: { type: "string", description: "Optional next step in two to four words, e.g. Add a task, Draft the consent line." }, actionPrompt: { type: "string", description: "What the owner would say to ME3 to do that step, one sentence." } }, required: ["id"], additionalProperties: false },
      },
      video: idNote,
      listen: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      topics: { type: "array", maxItems: TOPIC_STORIES, items: { type: "string" }, description: "Stories for the owner's own topics, by id, from two different topics when possible." },
      local: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    },
    required: ["lead"],
    additionalProperties: false,
  },
  effect: "read",
  approval: "none",
  async execute() { throw Error("News layout never executes."); },
};

const LAYOUT_PROMPT = [
  "You lay out the morning paper for the owner of a personal assistant called ME3.",
  "You are given today's candidate stories in sections (front, work, mine, local, media), the owner's topics, their coming week (calendar and open tasks) and the owner snapshot (mission, goals, projects, memories).",
  "Pick by id only, each story once: a front-page lead and two more front-page stories that matter most today; up to three work stories; one video and one thing to listen to from media; two stories for the owner's own topics; one local story.",
  "Different outlets often report the same event: pick it once and never place two stories about the same event.",
  "Most stories get no note. Write a note only when a story clearly touches something specific in the snapshot, calendar or tasks (a named project, a trip, a session, a blocked task), and say what it changes for the owner in one plain sentence. Never invent facts that are not given. No emoji, no hype, no advice about feelings or health, and never mention the Wheel of Life, scores or areas.",
  "A work story may carry one next step (actionLabel and actionPrompt) when there is an obvious thing to do; most have none.",
  "If the owner found yesterday's paper dull, vary the mix of topics and sources.",
  "Call core_news_layout exactly once with no prose.",
].join(" ");

function cleanNote(value: unknown): string | undefined {
  const note = typeof value === "string" ? value.replace(/\s+/g, " ").replace(/^ME3\s*[·:-]\s*/i, "").trim() : "";
  return note && note.length <= NOTE_MAX && !/wheel of life/i.test(note) ? note : undefined;
}

/** Keeps only what the model was allowed to say: real ids, short notes, short actions. */
export function readPaperPicks(value: unknown, candidateIds: Iterable<string>): PaperPicks | null {
  if (!value || typeof value !== "object") return null;
  const allowed = new Set(candidateIds);
  const raw = value as Record<string, unknown>;
  const id = (entry: unknown) => { const found = entry && typeof entry === "object" ? (entry as { id?: unknown }).id : entry; return typeof found === "string" && allowed.has(found) ? found : null; };
  const one = (entry: unknown) => { const found = id(entry); if (!found) return undefined; const note = cleanNote((entry as { note?: unknown }).note); return { id: found, ...(note ? { note } : {}) }; };
  const ids = (entry: unknown, max: number) => (Array.isArray(entry) ? entry : []).map(id).filter((found): found is string => !!found).slice(0, max);
  const picks: PaperPicks = {};
  const lead = one(raw.lead); if (lead) picks.lead = lead;
  picks.briefs = ids(raw.briefs, BRIEFS);
  picks.work = (Array.isArray(raw.work) ? raw.work : []).flatMap(entry => {
    const pick = one(entry);
    if (!pick) return [];
    const { actionLabel, actionPrompt } = entry as Record<string, unknown>;
    const label = typeof actionLabel === "string" ? actionLabel.replace(/\s+/g, " ").trim() : "";
    const prompt = typeof actionPrompt === "string" ? actionPrompt.replace(/\s+/g, " ").trim() : "";
    return [{ ...pick, ...(label && label.length <= 32 && prompt && prompt.length <= 240 ? { action: { label, prompt } } : {}) }];
  }).slice(0, WORK_STORIES);
  const video = one(raw.video); if (video) picks.video = video;
  const listen = id(raw.listen); if (listen) picks.listen = { id: listen };
  picks.topics = ids(raw.topics, TOPIC_STORIES);
  const local = id(raw.local); if (local) picks.local = { id: local };
  return picks.lead || picks.work.length || picks.briefs.length ? picks : null;
}

export type NewsWeek = { calendar: string[]; tasks: string[] };

export async function writeNewsPicks(
  model: AgentModel,
  input: { candidates: NewsCandidates; taste: Pick<SoupTaste, "workTopics" | "interests" | "lessOf">; ownerSnapshot: string; week: NewsWeek; date: string; city: string | null; lastRating: NewsRating | null },
  signal: AbortSignal,
): Promise<PaperPicks | null> {
  const brief = (story: NewsStory) => ({ id: story.id, headline: story.headline, summary: story.summary.slice(0, 220), source: story.sources[0]?.name, ...(story.medium !== "read" ? { medium: story.medium, minutes: soupMinutes(story) } : {}) });
  const lane = (entries: NewsCandidates["work"]) => entries.map(entry => ({ topic: entry.topic, stories: entry.stories.slice(0, 4).map(brief) }));
  const response = await model.step({
    messages: [
      { role: "system", content: LAYOUT_PROMPT },
      { role: "user", content: JSON.stringify({
        today: input.date,
        city: input.city,
        topics: { work: input.taste.workTopics.map(topic => topic.topic), mine: input.taste.interests, lessOf: input.taste.lessOf },
        yesterday: input.lastRating === "sleepy" ? "The owner found yesterday's paper dull." : input.lastRating === "fire" ? "The owner loved yesterday's paper." : undefined,
        candidates: { front: input.candidates.front.slice(0, 10).map(brief), work: lane(input.candidates.work), mine: lane(input.candidates.mine), local: input.candidates.local.slice(0, 6).map(brief), media: input.candidates.media.slice(0, 8).map(brief) },
        comingWeek: input.week,
        ownerSnapshot: input.ownerSnapshot.slice(0, 6_000),
      }) },
    ],
    tools: [layoutTool],
    toolChoice: layoutTool.name,
    signal,
    onDelta: async () => {},
  });
  const call = response.toolCalls.find(item => item.name === layoutTool.name);
  const picks = readPaperPicks(call?.arguments, allCandidateIds(input.candidates));
  if (!picks) console.warn("News picks: the model returned nothing usable", JSON.stringify(call?.arguments ?? response.text ?? null).slice(0, 400));
  return picks;
}

function allCandidateIds(candidates: NewsCandidates): string[] {
  return [...candidates.front, ...candidates.work.flatMap(entry => entry.stories), ...candidates.mine.flatMap(entry => entry.stories), ...candidates.local, ...candidates.media].map(story => story.id);
}

// ── Layout ──────────────────────────────────────────────────

const words = (headline: string) => new Set(headline.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(word => word.length > 3).map(word => word.replace(/s$/, "")));
/** Two outlets on one event share most of their headline words. Soup groups these later; until then ME3 does. */
export function sameEvent(a: string, b: string): boolean {
  const left = words(a), right = words(b);
  if (left.size < 3 || right.size < 3) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared) >= 0.5;
}

function toPaperStory(story: NewsStory, extra: { tag?: string; note?: string; action?: PaperStory["action"] } = {}): PaperStory {
  const minutes = soupMinutes(story);
  return {
    id: story.id, headline: story.headline, summary: story.summary, url: story.url, source: story.sources[0]?.name || "", medium: story.medium,
    ...(story.image ? { image: story.image.url } : {}), ...(story.publishedAt ? { publishedAt: story.publishedAt } : {}),
    ...(extra.tag ? { tag: extra.tag } : {}), ...(extra.note ? { note: extra.note } : {}), ...(extra.action ? { action: extra.action } : {}),
    ...(minutes ? { minutes } : {}), ...(story.embedUrl ? { embedUrl: story.embedUrl } : {}),
  };
}

/** One story from each topic in turn, so no topic gets a second before every topic had a first. */
function roundRobin(entries: Array<{ topic: string; stories: NewsStory[] }>): Array<{ topic: string; story: NewsStory }> {
  const out: Array<{ topic: string; story: NewsStory }> = [];
  const longest = Math.max(0, ...entries.map(entry => entry.stories.length));
  for (let rank = 0; rank < longest; rank++) for (const entry of entries) if (entry.stories[rank]) out.push({ topic: entry.topic, story: entry.stories[rank] });
  return out;
}

export type LayoutExtras = { labels: Record<string, string>; city: string | null; weather: NewsWeather | null; good: NewsStory | null };

/**
 * Turns candidates and the model's picks into pages. Picks that are missing, repeated or about an
 * event already placed are replaced from Soup's own order. With no picks at all (the model
 * failed) only the front page is laid out. Returns null when there is nothing to lead with.
 */
export function layoutPaper(candidates: NewsCandidates, picks: PaperPicks | null, extras: LayoutExtras): { pages: NewsPaperPages; frontOnly: boolean } | null {
  const placed: NewsStory[] = [];
  const free = (story: NewsStory) => !placed.some(other => other.id === story.id || sameEvent(other.headline, story.headline));
  const take = (pool: NewsStory[], wanted?: string | null): NewsStory | null => {
    const story = (wanted ? pool.find(item => item.id === wanted && free(item)) : undefined) || pool.find(free) || null;
    if (story) placed.push(story);
    return story;
  };
  const work = roundRobin(candidates.work);
  const mine = roundRobin(candidates.mine);
  const readable = (entries: Array<{ story: NewsStory }>) => entries.map(entry => entry.story).filter(story => story.medium === "read");
  const frontPool = candidates.front.length ? candidates.front : [...readable(work), ...readable(mine)];

  const lead = take(frontPool, picks?.lead?.id);
  if (!lead) return null;
  const briefs: PaperStory[] = [];
  for (let index = 0; index < BRIEFS; index++) { const story = take(frontPool, picks?.briefs?.[index]); if (story) briefs.push(toPaperStory(story)); }
  const front = { lead: toPaperStory(lead, { note: picks?.lead?.id === lead.id ? picks.lead.note : undefined }), briefs };
  if (!picks) return { pages: { front, work: null, media: null, topics: null, near: null }, frontOnly: true };

  const label = (topic: string) => newsTopicLabel(topic, extras.labels);
  const workPool = readable(work);
  const workStories: PaperStory[] = [];
  for (let index = 0; index < WORK_STORIES; index++) {
    const pick = picks.work?.[index];
    const story = take(workPool, pick?.id);
    if (story) workStories.push(toPaperStory(story, pick && pick.id === story.id ? { note: pick.note, action: pick.action } : {}));
  }

  const watch = candidates.media.filter(story => story.medium === "watch");
  const listenPool = candidates.media.filter(story => story.medium === "listen");
  const video = take(watch, picks.video?.id);
  const listen = take(listenPool, picks.listen?.id);

  const minePool = readable(mine);
  const topicOf = new Map(mine.map(entry => [entry.story.id, entry.topic]));
  const topicStories: PaperStory[] = [];
  const usedTopics = new Set<string>();
  for (let index = 0; index < TOPIC_STORIES; index++) {
    // A second story from a new topic before a second from the same one.
    const story = take(minePool.filter(item => !usedTopics.has(topicOf.get(item.id)!)), picks.topics?.[index]) || take(minePool, picks.topics?.[index]);
    if (!story) continue;
    usedTopics.add(topicOf.get(story.id)!);
    topicStories.push(toPaperStory(story, { tag: label(topicOf.get(story.id)!) }));
  }

  const local = take(candidates.local, picks.local?.id);
  const good = extras.good && free(extras.good) ? extras.good : null;
  const near = local || good || extras.weather ? { city: extras.city, weather: extras.weather, local: local ? toPaperStory(local) : null, good: good ? toPaperStory(good) : null } : null;

  return {
    frontOnly: false,
    pages: {
      front,
      work: workStories.length ? { topics: candidates.work.map(entry => label(entry.topic)), stories: workStories } : null,
      media: video || listen ? { video: video ? toPaperStory(video, { note: picks.video?.id === video.id ? picks.video.note : undefined }) : null, listen: listen ? toPaperStory(listen) : null } : null,
      topics: topicStories.length ? { stories: topicStories } : null,
      near,
    },
  };
}

export function countPaper(pages: NewsPaperPages, considered: number): NewsPaperCounts {
  const stories = 1 + pages.front.briefs.length + (pages.work?.stories.length || 0) + (pages.topics?.stories.length || 0) + (pages.near?.local ? 1 : 0) + (pages.near?.good ? 1 : 0);
  const sections = 1 + [pages.work, pages.media, pages.topics, pages.near].filter(Boolean).length;
  // Every paper ends with its own last page.
  return { pages: sections + 1, stories, videos: pages.media?.video ? 1 : 0, minutes: Math.max(1, Math.round(stories * 0.6 + (pages.media ? 1 : 0))), considered };
}

// ── When ────────────────────────────────────────────────────

/** The owner's time today in minutes after local midnight: an hour later at the weekend. */
export function newsDueMinutes(prefs: Pick<NewsPrefs, "time" | "weekendOffsetMinutes">, weekday: number): number {
  const [hour, minute] = prefs.time.split(":").map(Number);
  const weekend = weekday === 0 || weekday === 6;
  return Math.min(23 * 60 + 45, hour * 60 + minute + (weekend ? prefs.weekendOffsetMinutes : 0));
}

export const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** In the build window: from thirty minutes before the owner's time until the catch-up closes. */
export function newsBuildDue(prefs: Pick<NewsPrefs, "time" | "weekendOffsetMinutes" | "paused" | "setUpAt">, local: { minutes: number; weekday: number }): boolean {
  if (!prefs.setUpAt || prefs.paused) return false;
  const due = newsDueMinutes(prefs, local.weekday);
  return local.minutes >= due - NEWS_LEAD_MINUTES && local.minutes < due + NEWS_CATCH_UP_MINUTES;
}

/** A tick builds when there is no paper yet, the last attempt failed, or a claim went stale mid-build. */
export function shouldBuildPaper(existing: { status: string; claimed_at: number } | null, nowMs: number): boolean {
  if (!existing) return true;
  if (existing.status === "failed") return true;
  return existing.status === "pending" && existing.claimed_at < nowMs - STALE_CLAIM_MS;
}

// ── Composing ───────────────────────────────────────────────

function serialize(row: PaperRow, time: string): NewsPaper | null {
  if (row.status !== "ready") return null;
  const saved = parseJsonRecord(row.paper_json) as { pages?: NewsPaperPages; counts?: NewsPaperCounts; frontOnly?: boolean; time?: string };
  if (!saved.pages?.front?.lead || !saved.counts) return null;
  return { id: row.id, dateKey: row.date_key, time: saved.time || time, deliverAt: row.deliver_at, readyAt: row.ready_at || row.deliver_at, readAt: row.read_at, hiddenAt: row.hidden_at, rating: row.rating, frontOnly: saved.frontOnly === true, pages: saved.pages, counts: saved.counts };
}

async function claimPaper(env: Env, ownerId: string, dateKey: string, deliverAt: Date, now: Date, force: boolean): Promise<string | null> {
  const result = await env.DB.prepare(`INSERT INTO news_papers (id, user_id, date_key, status, paper_json, deliver_at, attempts, claimed_at, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', '{}', ?, 1, ?, ?, ?)
    ON CONFLICT(user_id, date_key) DO UPDATE SET status = 'pending', attempts = news_papers.attempts + 1, claimed_at = excluded.claimed_at, updated_at = excluded.updated_at
    WHERE ? = 1 OR news_papers.status = 'failed' OR (news_papers.status = 'pending' AND news_papers.claimed_at < ?)`)
    .bind(crypto.randomUUID(), ownerId, dateKey, deliverAt.toISOString(), now.getTime(), now.toISOString(), now.toISOString(), force ? 1 : 0, now.getTime() - STALE_CLAIM_MS).run();
  if (!result.meta?.changes) return null;
  const row = await env.DB.prepare("SELECT id FROM news_papers WHERE user_id = ? AND date_key = ?").bind(ownerId, dateKey).first<{ id: string }>();
  return row?.id ?? null;
}

async function shownStoryIds(env: Env, ownerId: string, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - EXCLUDE_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await env.DB.prepare("SELECT paper_json FROM news_papers WHERE user_id = ? AND status = 'ready' AND created_at >= ? ORDER BY created_at DESC LIMIT 10").bind(ownerId, since).all<{ paper_json: string }>();
  const ids = new Set<string>();
  for (const row of rows.results || []) {
    const pages = (parseJsonRecord(row.paper_json) as { pages?: NewsPaperPages }).pages;
    if (!pages?.front?.lead) continue;
    for (const story of [pages.front.lead, ...pages.front.briefs, ...(pages.work?.stories || []), pages.media?.video, pages.media?.listen, ...(pages.topics?.stories || []), pages.near?.local, pages.near?.good]) if (story) ids.add(story.id);
  }
  return [...ids];
}

/** The owner's coming week in plain titles, for ME3's notes. It goes to the model, never to Soup. */
async function loadWeek(env: Env, ownerId: string, now: Date): Promise<NewsWeek> {
  const until = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [events, tasks] = await Promise.all([
    env.DB.prepare("SELECT title, starts_at, location FROM user_calendar_events WHERE user_id = ? AND kind = 'event' AND recurrence_rule IS NULL AND starts_at >= ? AND starts_at < ? ORDER BY starts_at ASC LIMIT 20").bind(ownerId, now.toISOString(), until).all<{ title: string; starts_at: string; location: string | null }>().catch(() => ({ results: [] })),
    env.DB.prepare("SELECT title FROM mission_tasks WHERE user_id = ? AND archived_at IS NULL AND status NOT IN ('done', 'cancelled') ORDER BY priority ASC, updated_at DESC LIMIT 20").bind(ownerId).all<{ title: string }>().catch(() => ({ results: [] })),
  ]);
  return {
    calendar: (events.results || []).map(event => `${event.starts_at.slice(0, 16)} ${event.title}${event.location ? ` (${event.location})` : ""}`.slice(0, 160)),
    tasks: (tasks.results || []).map(task => task.title.slice(0, 120)),
  };
}

/** One wholesome thing for the Near you page, from Soup's existing search. Best effort. */
async function findGoodThing(client: SoupClient, exclude: string[]): Promise<NewsStory | null> {
  try {
    const result = await client.find({ q: "kindness community", limit: 4, mode: "fresh", exclude }, AbortSignal.timeout(8_000));
    const row = result.items.find(item => item.item.kind === "article" || item.item.kind === "note") || result.items[0];
    return row ? bowlToStory(row) : null;
  } catch { return null; }
}

export type ComposeOptions = { dateKey: string; time: string; deliverAt: Date; now?: Date; force?: boolean };

/**
 * Builds today's paper end to end and stores it. Returns the ready paper, or null when another
 * run holds the claim or there was nothing to print (the row is then marked failed and the next
 * tick tries again).
 */
export async function composeNewsPaper(env: Env, ownerId: string, options: ComposeOptions): Promise<NewsPaper | null> {
  const now = options.now || new Date();
  const id = await claimPaper(env, ownerId, options.dateKey, options.deliverAt, now, options.force === true);
  if (!id) return null;
  const fail = async (reason: unknown) => {
    console.warn("News paper failed", { ownerId, dateKey: options.dateKey, error: reason instanceof Error ? reason.message : reason });
    await env.DB.prepare("UPDATE news_papers SET status = 'failed', updated_at = ? WHERE id = ? AND user_id = ?").bind(now.toISOString(), id, ownerId).run();
    return null;
  };
  try {
    const { taste } = await getSoupTaste(env, ownerId);
    const prefs = taste.news;
    if (!prefs) return fail("News is not set up");
    const client = soupClientFor(env);
    const exclude = await shownStoryIds(env, ownerId, now);
    const candidates = toNewsCandidates(await gatherNews(env, client, taste, prefs, exclude, now), taste);
    if (!allCandidateIds(candidates).length) return fail("Soup had no stories");
    const [picks, weather, good] = await Promise.all([
      loadWeek(env, ownerId, now).then(week => runWithFastModel(env, ownerId, "News picks", (model, ownerSnapshot, timeoutMs) =>
        writeNewsPicks(model, { candidates, taste, ownerSnapshot, week, date: options.dateKey, city: prefs.city, lastRating: prefs.lastRating }, AbortSignal.timeout(timeoutMs)))),
      prefs.lat !== null && prefs.lon !== null ? fetchWeather({ lat: prefs.lat, lon: prefs.lon }) : Promise.resolve(null),
      env.ME3_SOUP_NEWS_FIXTURE ? Promise.resolve(newsFixtureGood({ city: prefs.city })) : findGoodThing(client, exclude),
    ]);
    const laidOut = layoutPaper(candidates, picks, { labels: prefs.labels, city: prefs.city, weather, good });
    if (!laidOut) return fail("Nothing to lead with");
    const counts = countPaper(laidOut.pages, candidates.considered);
    await env.DB.prepare("UPDATE news_papers SET status = 'ready', paper_json = ?, ready_at = ?, read_at = NULL, hidden_at = NULL, rating = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(JSON.stringify({ pages: laidOut.pages, counts, frontOnly: laidOut.frontOnly, time: options.time }), now.toISOString(), now.toISOString(), id, ownerId).run();
    const row = await env.DB.prepare("SELECT * FROM news_papers WHERE id = ?").bind(id).first<PaperRow>();
    return row ? serialize(row, options.time) : null;
  } catch (error) {
    return fail(error);
  }
}

// ── Scheduling ──────────────────────────────────────────────

/** Quarter-hour step: build the paper for every owner whose time is near, once per owner and day. */
export async function dispatchDueNewsPapers(env: Env, now = new Date()) {
  if (!await isCorePluginEnabled(env, SOUP_PLUGIN_ID)) return { skipped: "plugin disabled" };
  const owners = await env.DB.prepare("SELECT o.id, o.timezone, t.taste_json FROM soup_taste t JOIN owner_profile o ON o.id = t.user_id ORDER BY o.created_at ASC").all<{ id: string; timezone: string | null; taste_json: string }>();
  let built = 0;
  let failed = 0;
  for (const owner of owners.results || []) {
    const prefs = parseSoupTaste(parseJsonRecord(owner.taste_json)).news;
    if (!prefs) continue;
    const timezone = normalizeTimeZone(owner.timezone) || "UTC";
    const local = localParts(timezone, now);
    if (!newsBuildDue(prefs, local)) continue;
    const existing = await env.DB.prepare("SELECT status, claimed_at FROM news_papers WHERE user_id = ? AND date_key = ?").bind(owner.id, local.dateKey).first<{ status: string; claimed_at: number }>();
    if (!shouldBuildPaper(existing, now.getTime())) continue;
    const time = clockTime(newsDueMinutes(prefs, local.weekday));
    const paper = await composeNewsPaper(env, owner.id, { dateKey: local.dateKey, time, deliverAt: localInstant(local.dateKey, time, timezone), now });
    if (paper) built++; else failed++;
  }
  return { checkedAt: now.toISOString(), built, failed };
}

// ── Reading and acting ──────────────────────────────────────

async function ownerLocal(env: Env, ownerId: string, now: Date) {
  const owner = await getOwnerProfile(env, ownerId);
  if (!owner) throw new JournalInputError("Owner not found", 404);
  const timezone = normalizeTimeZone(owner.timezone) || "UTC";
  return { timezone, local: localParts(timezone, now) };
}

export type NewsTodayView = {
  setUp: boolean;
  paused: boolean;
  /** Today's paper once it is ready; null before that and on days nothing could be built. */
  paper: NewsPaper | null;
  /** The owner's time today and tomorrow, HH:MM. */
  time: string;
  nextTime: string;
};

/** What Home shows: the intro until News is set up, then today's paper once it is ready. */
export async function getNewsToday(env: Env, ownerId: string, now = new Date()): Promise<NewsTodayView> {
  const [state, { local }] = await Promise.all([getSoupTaste(env, ownerId), ownerLocal(env, ownerId, now)]);
  const settings = describeNewsSettings(state);
  const prefs = state.taste.news;
  const time = prefs ? clockTime(newsDueMinutes(prefs, local.weekday)) : settings.time;
  const nextTime = prefs ? clockTime(newsDueMinutes(prefs, (local.weekday + 1) % 7)) : settings.time;
  if (!newsIsSetUp(state)) return { setUp: false, paused: false, paper: null, time, nextTime };
  const row = await env.DB.prepare("SELECT * FROM news_papers WHERE user_id = ? AND date_key = ?").bind(ownerId, local.dateKey).first<PaperRow>();
  return { setUp: true, paused: settings.paused, paper: row && !settings.paused ? serialize(row, time) : null, time, nextTime };
}

/** Builds today's paper now: right after setup, when News is added back to Home, or when the owner asks. An existing paper is returned as it is unless `fresh`. */
export async function buildNewsNow(env: Env, ownerId: string, options: { fresh?: boolean; now?: Date } = {}): Promise<NewsPaper | null> {
  const now = options.now || new Date();
  const [state, { timezone, local }] = await Promise.all([getSoupTaste(env, ownerId), ownerLocal(env, ownerId, now)]);
  if (!newsIsSetUp(state) || !state.taste.news) throw new JournalInputError("Set up your news with ME3 first");
  const time = clockTime(newsDueMinutes(state.taste.news, local.weekday));
  if (!options.fresh) {
    const row = await env.DB.prepare("SELECT * FROM news_papers WHERE user_id = ? AND date_key = ?").bind(ownerId, local.dateKey).first<PaperRow>();
    const paper = row ? serialize(row, time) : null;
    if (paper) return paper;
  }
  const due = localInstant(local.dateKey, time, timezone);
  // Built by hand before the usual time, it is simply ready now.
  return composeNewsPaper(env, ownerId, { dateKey: local.dateKey, time, deliverAt: due.getTime() < now.getTime() ? due : now, now, force: true });
}

export async function getNewsPaper(env: Env, ownerId: string, id: string): Promise<NewsPaper | null> {
  const row = await env.DB.prepare("SELECT * FROM news_papers WHERE id = ? AND user_id = ?").bind(id, ownerId).first<PaperRow>();
  return row ? serialize(row, "") : null;
}

const RATINGS = new Set<NewsRating>(["fire", "ok", "sleepy"]);

/**
 * What the owner did with the paper: read it, hid the card until tomorrow, brought it back, or
 * rated it on the last page. The rating also steers the next paper. Everything stays in ME3.
 */
export async function actOnNewsPaper(env: Env, ownerId: string, id: string, input: unknown, now = new Date()): Promise<NewsPaper> {
  const action = (input as { action?: unknown })?.action;
  const paper = await getNewsPaper(env, ownerId, id);
  if (!paper) throw new JournalInputError("Paper not found", 404);
  const stamp = now.toISOString();
  if (action === "read") await env.DB.prepare("UPDATE news_papers SET read_at = coalesce(read_at, ?), updated_at = ? WHERE id = ? AND user_id = ?").bind(stamp, stamp, id, ownerId).run();
  else if (action === "hide") await env.DB.prepare("UPDATE news_papers SET hidden_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(stamp, stamp, id, ownerId).run();
  else if (action === "unhide") await env.DB.prepare("UPDATE news_papers SET hidden_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?").bind(stamp, id, ownerId).run();
  else if (action === "rate") {
    const rating = (input as { rating?: unknown }).rating;
    if (typeof rating !== "string" || !RATINGS.has(rating as NewsRating)) throw new JournalInputError("rating must be fire, ok or sleepy");
    await env.DB.prepare("UPDATE news_papers SET rating = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(rating, stamp, id, ownerId).run();
    const { taste } = await getSoupTaste(env, ownerId);
    if (taste.news) await env.DB.prepare("UPDATE soup_taste SET taste_json = ?, updated_at = ? WHERE user_id = ?").bind(JSON.stringify({ ...taste, news: { ...taste.news, lastRating: rating } }), stamp, ownerId).run();
  } else throw new JournalInputError("action must be read, hide, unhide or rate");
  return (await getNewsPaper(env, ownerId, id))!;
}

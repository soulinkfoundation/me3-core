// The owner's Soup taste (me3-ydf4.2). Two lanes: "For your work" follows the owner's projects
// and mission (an archived project's topics fade on their own); "Just for you" is what the owner
// said they love and stands alone. Plus "Less of", followed soups and the servings they chose:
// their own times, or none at all (only when they ask). Taste never leaves the installation.
import { JournalInputError } from "./journal";
import { cleanSoupTopic, type SoupMedium } from "./soup-client";
import { isRecord, parseJsonRecord } from "./workspace-input";
import type { Env } from "./types";

export const SOUP_PLUGIN_ID = "me3.soup";
export type SoupServingKind = "headlines" | "pick";
export type SoupWorkTopic = { topic: string; projectId: string | null; source: "project" | "mission" | "owner" };
export type SoupServingSpec = {
  id: string;
  name: string;
  /** Local HH:MM. */
  time: string;
  /** 0 = Sunday … 6 = Saturday; empty means every day. */
  days: number[];
  kind: SoupServingKind;
  medium?: SoupMedium;
  maxMinutes?: number;
};
export type SoupTaste = {
  workTopics: SoupWorkTopic[];
  /** Work topics the owner switched off, so a project does not propose them again. */
  mutedWorkTopics: string[];
  interests: string[];
  lessOf: string[];
  soups: string[];
  servings: SoupServingSpec[];
  headsUp: boolean;
  /** News (me3-6ptk): delivery time, region and the rest of the morning paper's settings. Null until News is set up. */
  news: NewsPrefs | null;
};
export type NewsPrefs = {
  /** Local HH:MM on a quarter hour. */
  time: string;
  weekendOffsetMinutes: number;
  notify: boolean;
  /** Removed from Home: no paper is built and nothing is announced. */
  paused: boolean;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  lat: number | null;
  lon: number | null;
  /** How each topic word is shown: "ai agents" → "AI agents". */
  labels: Record<string, string>;
  /** Topics ME3 suggested that the owner has not switched on, kept so the chips stay put. */
  moreWork: string[];
  moreMine: string[];
  /** The end-page rating of the latest paper read, to steer the next one. */
  lastRating: "fire" | "ok" | "sleepy" | null;
  /** When the owner confirmed their News setup. A Soup setup alone leaves this null. */
  setUpAt: string | null;
};
export type SoupTasteState = {
  taste: SoupTaste;
  setUp: boolean;
  setUpAt: string | null;
  projects: Array<{ id: string; name: string; description: string | null }>;
};

export const MAX_TOPICS_PER_LANE = 12;
const MAX_SERVINGS = 6;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SERVING_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MEDIUMS = new Set<SoupMedium>(["watch", "listen", "read"]);

export const emptySoupTaste = (): SoupTaste => ({ workTopics: [], mutedWorkTopics: [], interests: [], lessOf: [], soups: [], servings: [], headsUp: false, news: null });

export const NEWS_DEFAULT_TIME = "07:00";
/** The cron ticks every quarter hour, so delivery times sit on one. */
export function snapNewsTime(value: unknown): string | null {
  if (typeof value !== "string" || !TIME.test(value.trim())) return null;
  const [hour, minute] = value.trim().split(":").map(Number);
  const total = Math.min(23 * 60 + 45, Math.round((hour * 60 + minute) / 15) * 15);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function readNewsPrefs(raw: unknown): NewsPrefs | null {
  if (!isRecord(raw)) return null;
  const words = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(cleanSoupTopic).filter((topic): topic is string => !!topic))].slice(0, MAX_TOPICS_PER_LANE) : [];
  const labels: Record<string, string> = {};
  if (isRecord(raw.labels)) for (const [word, label] of Object.entries(raw.labels).slice(0, 80)) {
    if (cleanSoupTopic(word) === word && typeof label === "string" && cleanSoupTopic(label) === word) labels[word] = label.replace(/\s+/g, " ").trim().slice(0, 40);
  }
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    time: snapNewsTime(raw.time) || NEWS_DEFAULT_TIME,
    weekendOffsetMinutes: number(raw.weekendOffsetMinutes) === 0 ? 0 : 60,
    notify: raw.notify !== false,
    paused: raw.paused === true,
    city: typeof raw.city === "string" && raw.city.trim() ? raw.city.trim().slice(0, 60) : null,
    country: typeof raw.country === "string" && /^[A-Z]{2}$/.test(raw.country) ? raw.country : null,
    lat: number(raw.lat),
    lon: number(raw.lon),
    labels,
    moreWork: words(raw.moreWork),
    moreMine: words(raw.moreMine),
    lastRating: raw.lastRating === "fire" || raw.lastRating === "ok" || raw.lastRating === "sleepy" ? raw.lastRating : null,
    setUpAt: typeof raw.setUpAt === "string" && !Number.isNaN(Date.parse(raw.setUpAt)) ? raw.setUpAt : null,
  };
}

function topicList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new JournalInputError(`${label} must be a list of topics`);
  const topics = [...new Set(value.map(cleanSoupTopic).filter((topic): topic is string => !!topic))];
  if (topics.length > MAX_TOPICS_PER_LANE) throw new JournalInputError(`${label} takes up to ${MAX_TOPICS_PER_LANE} topics`);
  return topics;
}

function readWorkTopics(value: unknown): SoupWorkTopic[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const topics: SoupWorkTopic[] = [];
  for (const entry of value) {
    const raw: Record<string, unknown> = isRecord(entry) ? entry : { topic: entry };
    const topic = cleanSoupTopic(raw.topic);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    const source = raw.source === "project" || raw.source === "mission" ? raw.source : "owner";
    topics.push({ topic, projectId: typeof raw.projectId === "string" && raw.projectId ? raw.projectId : null, source });
    if (topics.length === MAX_TOPICS_PER_LANE) break;
  }
  return topics;
}

export function readServingSpecs(value: unknown): SoupServingSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new JournalInputError("servings must be a list");
  if (value.length > MAX_SERVINGS) throw new JournalInputError(`Up to ${MAX_SERVINGS} servings`);
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new JournalInputError("Each serving needs a name, a time and a kind");
    const name = typeof entry.name === "string" ? entry.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const time = typeof entry.time === "string" ? entry.time.trim() : "";
    const kind = entry.kind === "headlines" || entry.kind === "pick" ? entry.kind : null;
    if (!name || !TIME.test(time) || !kind) throw new JournalInputError(`Serving ${index + 1} needs a name, a time like 07:30 and a kind (headlines or pick)`);
    const id = typeof entry.id === "string" && SERVING_ID.test(entry.id) ? entry.id : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `serving-${index + 1}`;
    if (ids.has(id)) throw new JournalInputError(`Two servings share the id ${id}`);
    ids.add(id);
    const days = Array.isArray(entry.days) ? [...new Set(entry.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [];
    const spec: SoupServingSpec = { id, name, time, days, kind };
    if (typeof entry.medium === "string" && MEDIUMS.has(entry.medium as SoupMedium)) spec.medium = entry.medium as SoupMedium;
    const maxMinutes = Number(entry.maxMinutes);
    if (Number.isFinite(maxMinutes) && maxMinutes > 0) spec.maxMinutes = Math.min(240, Math.round(maxMinutes));
    return spec;
  });
}

export function parseSoupTaste(raw: unknown): SoupTaste {
  const saved = isRecord(raw) ? raw : {};
  const read = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(cleanSoupTopic).filter((topic): topic is string => !!topic))].slice(0, MAX_TOPICS_PER_LANE) : [];
  let servings: SoupServingSpec[] = [];
  try { servings = readServingSpecs(saved.servings); } catch { servings = []; }
  return {
    workTopics: readWorkTopics(saved.workTopics),
    mutedWorkTopics: read(saved.mutedWorkTopics),
    interests: read(saved.interests),
    lessOf: read(saved.lessOf),
    soups: Array.isArray(saved.soups) ? [...new Set(saved.soups.filter((handle): handle is string => typeof handle === "string" && /^[a-z0-9][a-z0-9/_-]{0,80}$/.test(handle)))].slice(0, 20) : [],
    servings,
    headsUp: saved.headsUp === true,
    news: readNewsPrefs(saved.news),
  };
}

type TasteRow = { taste_json: string; set_up_at: string | null; suggested_at: string | null };

async function activeProjects(env: Env, userId: string) {
  const rows = await env.DB.prepare("SELECT id, name, description FROM mission_projects WHERE user_id = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 30").bind(userId).all<{ id: string; name: string; description: string | null }>();
  return rows.results || [];
}

/** Work topics tied to a project fade when that project is archived or gone; the rest stay. */
export function fadeWorkTopics(topics: SoupWorkTopic[], projectIds: Set<string>): SoupWorkTopic[] {
  return topics.filter(topic => !topic.projectId || projectIds.has(topic.projectId));
}

export async function getSoupTaste(env: Env, userId: string): Promise<SoupTasteState> {
  const [row, projects] = await Promise.all([
    env.DB.prepare("SELECT taste_json, set_up_at, suggested_at FROM soup_taste WHERE user_id = ?").bind(userId).first<TasteRow>(),
    activeProjects(env, userId),
  ]);
  const taste = parseSoupTaste(row ? parseJsonRecord(row.taste_json) : {});
  taste.workTopics = fadeWorkTopics(taste.workTopics, new Set(projects.map(project => project.id)));
  return { taste, setUp: Boolean(row?.set_up_at), setUpAt: row?.set_up_at ?? null, projects };
}

export type SoupTastePatch = {
  workTopics?: unknown; interests?: unknown; lessOf?: unknown; soups?: unknown; servings?: unknown; headsUp?: unknown; setUp?: unknown;
};

const PATCH_KEYS = new Set(["workTopics", "interests", "lessOf", "soups", "servings", "headsUp", "setUp"]);

/**
 * Replace the lists that are given and leave the rest. Work topics the owner drops are muted so a
 * project does not bring them back. `setUp: true` records the owner's confirmation, after which
 * servings run and the Soup card may appear on Home.
 */
export async function updateSoupTaste(env: Env, userId: string, input: unknown, now = new Date()): Promise<SoupTasteState> {
  if (!isRecord(input) || Object.keys(input).some(key => !PATCH_KEYS.has(key))) throw new JournalInputError("Taste changes must be workTopics, interests, lessOf, soups, servings, headsUp or setUp");
  const current = await getSoupTaste(env, userId);
  const next: SoupTaste = { ...current.taste };
  if (input.workTopics !== undefined) {
    if (!Array.isArray(input.workTopics)) throw new JournalInputError("workTopics must be a list");
    const projectIds = new Set(current.projects.map(project => project.id));
    const replaced = readWorkTopics(input.workTopics).map(topic => ({ ...topic, projectId: topic.projectId && projectIds.has(topic.projectId) ? topic.projectId : null }));
    const kept = new Set(replaced.map(topic => topic.topic));
    const dropped = current.taste.workTopics.filter(topic => !kept.has(topic.topic) && topic.source !== "owner").map(topic => topic.topic);
    next.workTopics = replaced;
    next.mutedWorkTopics = [...new Set([...current.taste.mutedWorkTopics.filter(topic => !kept.has(topic)), ...dropped])].slice(0, 40);
  }
  if (input.interests !== undefined) next.interests = topicList(input.interests, "interests");
  if (input.lessOf !== undefined) next.lessOf = topicList(input.lessOf, "lessOf");
  if (input.soups !== undefined) {
    if (!Array.isArray(input.soups)) throw new JournalInputError("soups must be a list of handles");
    next.soups = [...new Set(input.soups.map(handle => String(handle).replace(/^@/, "").toLowerCase().trim()).filter(handle => /^[a-z0-9][a-z0-9/_-]{0,80}$/.test(handle)))].slice(0, 20);
  }
  if (input.servings !== undefined) next.servings = readServingSpecs(input.servings);
  if (input.headsUp !== undefined) {
    if (typeof input.headsUp !== "boolean") throw new JournalInputError("headsUp must be true or false");
    next.headsUp = input.headsUp;
  }
  if (input.setUp !== undefined && input.setUp !== true) throw new JournalInputError("setUp can only be set to true");
  const setUpAt = current.setUpAt ?? (input.setUp === true ? now.toISOString() : null);
  await env.DB.prepare(`INSERT INTO soup_taste(user_id, taste_json, set_up_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET taste_json = excluded.taste_json, set_up_at = coalesce(soup_taste.set_up_at, excluded.set_up_at), updated_at = excluded.updated_at`)
    .bind(userId, JSON.stringify(next), setUpAt, now.toISOString()).run();
  // Once taste is confirmed the card belongs on Home, where it shows only while a serving is open.
  if (setUpAt && !current.setUpAt) await earnSoupHomeCard(env, userId);
  return getSoupTaste(env, userId);
}

export async function earnSoupHomeCard(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT layout_json FROM home_layout WHERE user_id = ?").bind(userId).first<{ layout_json: string }>();
  const saved = row ? parseJsonRecord(row.layout_json) : {};
  const list = (key: string) => Array.isArray(saved[key]) ? (saved[key] as unknown[]).filter((id): id is string => typeof id === "string") : [];
  const layout = { order: list("order"), hidden: list("hidden").filter(id => id !== "soup"), pinned: list("pinned"), earned: [...new Set([...list("earned"), "soup"])] };
  await env.DB.prepare(`INSERT INTO home_layout(user_id, layout_json, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at`).bind(userId, JSON.stringify(layout)).run();
}

/** Records that ME3 offered Soup once in chat; returns true the first time only. */
export async function markSoupSuggested(env: Env, userId: string, now = new Date()): Promise<boolean> {
  const result = await env.DB.prepare(`INSERT INTO soup_taste(user_id, taste_json, suggested_at, updated_at) VALUES (?, '{}', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET suggested_at = excluded.suggested_at WHERE soup_taste.suggested_at IS NULL`).bind(userId, now.toISOString(), now.toISOString()).run();
  return (result.meta?.changes || 0) > 0;
}

export async function soupSuggestionDue(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT set_up_at, suggested_at FROM soup_taste WHERE user_id = ?").bind(userId).first<{ set_up_at: string | null; suggested_at: string | null }>();
  if (row?.set_up_at || row?.suggested_at) return false;
  const project = await env.DB.prepare("SELECT 1 FROM mission_projects WHERE user_id = ? AND status != 'archived' LIMIT 1").bind(userId).first();
  return Boolean(project);
}

/** All topic words Soup may see for this owner: the two lanes, nothing else. */
export function soupTopicWords(taste: SoupTaste): { work: string[]; interests: string[] } {
  return { work: taste.workTopics.map(topic => topic.topic), interests: taste.interests };
}

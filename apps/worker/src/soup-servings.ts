// Soup servings (me3-ydf4.3): at the owner's chosen times, or when they ask in chat, ME3 turns
// taste into a few Soup queries (topic words only), gathers candidates, and makes one small model
// call over the owner snapshot to pick the items and write the "for you" lines. The serving is
// stored with its item snapshot so the Home card can show it, so nothing is served twice, and
// so a failure leaves no card rather than a broken one.
import type { AgentModel, AgentTool } from "../../../packages/agent/src/types";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { createAgentModels } from "./agent-runtime";
import { addDaysToDateString, getUtcMsForLocalTime, normalizeTimeZone } from "./calendar";
import { JournalInputError } from "./journal";
import { isCorePluginEnabled } from "./plugins";
import { getOwnerProfile } from "./sites";
import { createSoupClient, soupMinutes, type SoupBowlItem, type SoupClient, type SoupMedium, type SoupSearchRequest } from "./soup-client";
import { SOUP_PLUGIN_ID, getSoupTaste, type SoupServingKind, type SoupServingSpec, type SoupTaste } from "./soup-taste";
import { parseJsonArray } from "./workspace-input";
import type { Env } from "./types";

export type SoupServingItemState = "served" | "opened" | "finished" | "liked" | "disliked" | "later";
export type SoupServingItem = {
  id: string;
  soup: string;
  soupTitle: string;
  title: string;
  url: string;
  creator: string;
  creatorUrl?: string;
  kind: "video" | "article" | "audio" | "note";
  medium: SoupMedium;
  minutes: number | null;
  thumbnailUrl?: string;
  publishedAt?: string;
  summary: string;
  why: string;
  quote?: { text: string; by?: string };
  /** ME3's own line on why this is for the owner. Null when no model was available. */
  forYou: string | null;
  state: SoupServingItemState;
  /** Extra picks under a single-pick serving ("Also good"). */
  alternate?: boolean;
};
export type SoupServingStatus = "pending" | "open" | "done" | "expired" | "failed";
export type SoupServing = {
  id: string;
  servingId: string;
  kind: SoupServingKind;
  title: string;
  status: SoupServingStatus;
  dueAt: string;
  expiresAt: string;
  openedAt: string | null;
  finishedAt: string | null;
  items: SoupServingItem[];
  /** True when the pantry had no fresh news and older items stand in. */
  fallback?: boolean;
};

type ServingRow = {
  id: string; user_id: string; date_key: string; serving_id: string; kind: SoupServingKind; title: string; status: SoupServingStatus;
  items_json: string; due_at: string; expires_at: string; claimed_at: number; opened_at: string | null; finished_at: string | null; created_at?: string;
};

export const HEADLINES_COUNT = 3;
const PICK_ALTERNATES = 2;
const FOR_YOU_MAX = 120;
const CANDIDATE_LIMIT = 24;
const EXCLUDE_WINDOW_DAYS = 45;
/** Compose this long before the chosen time, so the serving is ready when the owner looks. */
const LEAD_MINUTES = 10;
/** A missed serving still composes within this window, then the moment has passed. */
const CATCH_UP_MINUTES = 180;
const PICK_OPEN_HOURS = 6;
const ASK_OPEN_HOURS = 12;
const FRESH_WINDOW_MS = 36 * 3_600_000;
const LISTENABLE_FORMATS = new Set(["talk", "lecture", "interview", "conversation", "commentary", "meditation", "music", "story", "explainer"]);

export function soupClientFor(env: Env): SoupClient {
  return createSoupClient({ origin: env.ME3_SOUP_API_ORIGIN || null });
}

function itemMedium(row: SoupBowlItem, wanted?: SoupMedium): SoupMedium {
  if (row.item.kind === "audio") return "listen";
  if (row.item.kind === "article" || row.item.kind === "note") return "read";
  return wanted === "listen" && LISTENABLE_FORMATS.has(row.card.format) ? "listen" : "watch";
}

export function toServingItem(row: SoupBowlItem, wanted?: SoupMedium): SoupServingItem {
  const item: SoupServingItem = {
    id: row.item.id, soup: row.soup.handle, soupTitle: row.soup.title || row.soup.handle, title: row.item.title, url: row.item.url,
    creator: row.item.creator?.name || row.soup.title || "Unknown", kind: row.item.kind, medium: itemMedium(row, wanted), minutes: soupMinutes(row.item),
    summary: row.card.summary || "", why: row.card.why || "", forYou: null, state: "served",
  };
  if (row.item.creator?.url) item.creatorUrl = row.item.creator.url;
  if (row.item.thumbnailUrl) item.thumbnailUrl = row.item.thumbnailUrl;
  if (row.item.publishedAt) item.publishedAt = row.item.publishedAt;
  if (row.card.quote?.text) item.quote = { text: row.card.quote.text, ...(row.card.quote.by ? { by: row.card.quote.by } : {}) };
  return item;
}

function serialize(row: ServingRow): SoupServing {
  const items = parseJsonArray(row.items_json).filter((entry): entry is SoupServingItem => !!entry && typeof entry === "object" && typeof (entry as SoupServingItem).id === "string");
  // Headlines made of nothing recent mean the pantry had no fresh news, so the card says so.
  const stale = row.kind === "headlines" && items.length > 0 && items.every(item => !item.publishedAt || Date.parse(item.publishedAt) < Date.parse(row.created_at ?? row.due_at) - FRESH_WINDOW_MS);
  return { id: row.id, servingId: row.serving_id, kind: row.kind, title: row.title, status: row.status, dueAt: row.due_at, expiresAt: row.expires_at, openedAt: row.opened_at, finishedAt: row.finished_at, items, ...(stale ? { fallback: true } : {}) };
}

// ── Picks: one small model call ─────────────────────────────

const picksTool: AgentTool = {
  name: "core_news_picks",
  description: "Choose the items to serve and write one for-you line for each.",
  parameters: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "The candidate's id, copied exactly." },
            forYou: { type: "string", description: `Why this is for the owner, in one plain sentence of at most ${FOR_YOU_MAX} characters.` },
          },
          required: ["itemId", "forYou"],
          additionalProperties: false,
        },
      },
    },
    required: ["picks"],
    additionalProperties: false,
  },
  effect: "read",
  approval: "none",
  async execute() { throw Error("Soup picks never execute."); },
};

const PICKS_PROMPT = [
  "You choose what The Human Soup serves the owner of a personal assistant called ME3, and you write the one line that says why each pick is for them.",
  "You are given candidates (what each item is, why it is good, its topics and length), the owner's taste (work topics from their projects, interests they stated, things they want less of) and the owner snapshot (mission, goals, projects, memories).",
  "Pick the number asked for, in order of fit. Prefer items that touch a live project, the mission or a stated interest; mix the two lanes when you can; drop anything that matches a less-of topic; drop near-duplicates.",
  "The for-you line is the product: say why this item matters to this owner this week, from a specific project, goal, mission line or interest. One plain sentence, no emoji, no hype, no second-guessing their feelings. Never give emotional support or advice about their inner life. Never mention the Wheel of Life, scores or areas, even if they shaped your choice. Never invent facts that are not in the snapshot.",
  "When nothing in the snapshot fits an item, say what the item gives in one plain sentence rather than forcing a link.",
  "Call core_news_picks exactly once with no prose.",
].join(" ");

export async function writeSoupPicks(
  model: AgentModel,
  input: { candidates: SoupServingItem[]; taste: SoupTaste; ownerSnapshot: string; count: number; occasion: string },
  signal: AbortSignal,
): Promise<Array<{ itemId: string; forYou: string }>> {
  const response = await model.step({
    messages: [
      { role: "system", content: PICKS_PROMPT },
      { role: "user", content: JSON.stringify({
        occasion: input.occasion,
        count: input.count,
        taste: { work: input.taste.workTopics.map(topic => topic.topic), interests: input.taste.interests, lessOf: input.taste.lessOf },
        candidates: input.candidates.map(item => ({ id: item.id, title: item.title, by: item.creator, soup: item.soupTitle, kind: item.kind, minutes: item.minutes, summary: item.summary.slice(0, 280), why: item.why.slice(0, 200), publishedAt: item.publishedAt })),
        ownerSnapshot: input.ownerSnapshot.slice(0, 6_000),
      }) },
    ],
    tools: [picksTool],
    toolChoice: picksTool.name,
    signal,
    onDelta: async () => {},
  });
  const call = response.toolCalls.find(item => item.name === picksTool.name);
  const picks = readSoupPicks(call?.arguments.picks, input.candidates.map(item => item.id), input.count);
  if (!picks.length) console.warn("Soup picks: the model returned nothing usable", JSON.stringify(call?.arguments ?? response.text ?? null).slice(0, 400));
  return picks;
}

export function readSoupPicks(value: unknown, candidateIds: string[], count: number): Array<{ itemId: string; forYou: string }> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(candidateIds);
  const seen = new Set<string>();
  const picks: Array<{ itemId: string; forYou: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { itemId, forYou } = entry as Record<string, unknown>;
    if (typeof itemId !== "string" || !allowed.has(itemId) || seen.has(itemId)) continue;
    const line = typeof forYou === "string" ? forYou.replace(/\s+/g, " ").trim() : "";
    if (!line || line.length > FOR_YOU_MAX || /wheel of life/i.test(line)) continue;
    seen.add(itemId);
    picks.push({ itemId, forYou: line });
    if (picks.length === count) break;
  }
  return picks;
}

/**
 * Runs one small model call over the owner snapshot with the fast model, falling back to the
 * model the owner chats with. Returns null when no model could answer, so callers degrade to
 * Soup's own order instead of failing.
 */
export async function runWithFastModel<T>(env: Env, ownerId: string, label: string, run: (model: AgentModel, ownerSnapshot: string, timeoutMs: number) => Promise<T>): Promise<T | null> {
  try {
    const owner = await getOwnerProfile(env, ownerId);
    if (!owner) return null;
    const snapshot = await loadOwnerSnapshotContext({
      db: env.DB, ownerId, meJsonUrl: null,
      owner: { id: owner.id, name: owner.name, username: owner.username, timezone: owner.timezone || "UTC", assistantName: owner.assistant_name || "ME3" },
    });
    const requestId = `soup-serving:${crypto.randomUUID()}`;
    const models = await createAgentModels(env, { userId: ownerId, threadId: "", turnId: requestId, requestId });
    const fastName = env.ME3_AGENT_FAST_MODEL?.trim() || "anthropic/claude-haiku-5.5";
    const modelId = (id: string) => id.replace(/^@cf\//, "");
    const fast = models.managed && !models.managed.models.some(item => modelId(item.id) === modelId(fastName))
      ? models.model
      : models.modelFor(fastName, { purpose: "soup_serving" });
    try {
      return await run(fast, snapshot.prompt, 25_000);
    } catch (error) {
      // An install without the fast model's provider (local dev, some self-hosted) still gets its
      // lines from the model it chats with.
      if (fast.id === models.model.id) throw error;
      console.warn(`${label} retrying with the chat model`, error instanceof Error ? error.message : error);
      return await run(models.model, snapshot.prompt, 40_000);
    }
  } catch (error) {
    console.warn(`${label} fell back to Soup's own order`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function pickWithModel(env: Env, ownerId: string, input: { candidates: SoupServingItem[]; taste: SoupTaste; count: number; occasion: string }): Promise<Array<{ itemId: string; forYou: string }> | null> {
  return runWithFastModel(env, ownerId, "Soup picks", (model, ownerSnapshot, timeoutMs) => writeSoupPicks(model, { ...input, ownerSnapshot }, AbortSignal.timeout(timeoutMs)));
}

// ── Candidates ──────────────────────────────────────────────

/** Newest first, so when the list is cut to fit a request the latest servings are the ones kept. */
async function servedItemIds(env: Env, ownerId: string, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - EXCLUDE_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await env.DB.prepare("SELECT items_json FROM soup_servings WHERE user_id = ? AND created_at >= ? AND status IN ('open', 'done', 'expired') ORDER BY created_at DESC").bind(ownerId, since).all<{ items_json: string }>();
  const ids = new Set<string>();
  for (const row of rows.results || []) for (const entry of parseJsonArray(row.items_json)) if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") ids.add((entry as { id: string }).id);
  return [...ids];
}

function matchesLessOf(item: SoupServingItem, row: SoupBowlItem, lessOf: string[]): boolean {
  if (!lessOf.length) return false;
  const haystack = [item.title, ...row.card.topics].join(" ").toLowerCase();
  return lessOf.some(topic => haystack.includes(topic));
}

export type SoupAsk = { topics: string[]; medium?: SoupMedium; maxMinutes?: number; soups?: string[] };

/** Each lane gets this many topics a serving, so one long lane cannot crowd out the other. */
const WORK_TOPICS_PER_SERVING = 5;
const INTEREST_TOPICS_PER_SERVING = 4;

/**
 * The queries a serving sends to Soup: topic words from the two lanes, filters, and item IDs
 * already served. Nothing else. Each topic is its own ranked search (`q`): Soup's `topics`
 * filter only passes items whose card carries that exact phrase, which leaves fresh news out.
 */
export function servingQueries(kind: SoupServingKind, taste: SoupTaste, options: { exclude: string[]; since?: string; ask?: SoupAsk; medium?: SoupMedium; maxMinutes?: number }): SoupSearchRequest[] {
  const base: SoupSearchRequest = { exclude: options.exclude, ...(options.medium ? { medium: options.medium } : {}), ...(options.maxMinutes ? { maxMinutes: options.maxMinutes } : {}) };
  const work = taste.workTopics.map(topic => topic.topic);
  const tasteTopics = [...taste.interests.slice(0, INTEREST_TOPICS_PER_SERVING), ...work.slice(0, WORK_TOPICS_PER_SERVING)];
  if (options.ask) {
    const filters = { ...(options.ask.medium ? { medium: options.ask.medium } : {}), ...(options.ask.maxMinutes ? { maxMinutes: options.ask.maxMinutes } : {}) };
    const topics = options.ask.topics.length ? options.ask.topics : tasteTopics;
    const queries: SoupSearchRequest[] = topics.map(q => ({ ...base, q, limit: 6, ...filters }));
    if (options.ask.soups?.length) queries.push({ ...base, soups: options.ask.soups, q: topics.join(" "), limit: 6, ...(options.ask.medium ? { medium: options.ask.medium } : {}) });
    return queries;
  }
  const queries: SoupSearchRequest[] = [];
  const since = options.since ? { since: options.since } : {};
  if (kind === "headlines") {
    for (const q of work.slice(0, WORK_TOPICS_PER_SERVING)) queries.push({ ...base, q, style: "headlines", limit: 5, ...since });
    for (const q of taste.interests.slice(0, INTEREST_TOPICS_PER_SERVING)) queries.push({ ...base, q, style: "headlines", limit: 5, ...since });
  } else {
    for (const q of taste.interests.slice(0, INTEREST_TOPICS_PER_SERVING)) queries.push({ ...base, q, limit: 5 });
    for (const q of work.slice(0, WORK_TOPICS_PER_SERVING)) queries.push({ ...base, q, limit: 5 });
  }
  if (taste.soups.length && tasteTopics.length) queries.push({ ...base, soups: taste.soups, q: tasteTopics.join(" "), limit: 6 });
  return queries;
}

async function gatherCandidates(client: SoupClient, queries: SoupSearchRequest[], taste: SoupTaste, wanted?: SoupMedium): Promise<{ items: SoupServingItem[]; fallback: boolean }> {
  const results = await Promise.allSettled(queries.map(query => client.find(query)));
  const seen = new Set<string>();
  const items: SoupServingItem[] = [];
  let fallback = false;
  const lists: SoupBowlItem[][] = [];
  for (const result of results) {
    if (result.status === "rejected") continue;
    if (result.value.fallback) fallback = true;
    lists.push(result.value.items);
  }
  // Take the best of every query in turn, so each topic is in the running before any gets a second item.
  const longest = Math.max(0, ...lists.map(list => list.length));
  for (let rank = 0; rank < longest && items.length < CANDIDATE_LIMIT; rank++) {
    for (const list of lists) {
      const row = list[rank];
      if (!row || seen.has(row.item.id) || items.length >= CANDIDATE_LIMIT) continue;
      const item = toServingItem(row, wanted);
      if (matchesLessOf(item, row, taste.lessOf)) continue;
      seen.add(row.item.id);
      items.push(item);
    }
  }
  if (!items.length && !lists.length && results.length) throw (results[0] as PromiseRejectedResult).reason;
  return { items, fallback };
}

// ── Composing ───────────────────────────────────────────────

export type ServingSpec = {
  servingId: string;
  kind: SoupServingKind;
  title: string;
  dateKey: string;
  dueAt: Date;
  expiresAt: Date;
  occasion: string;
  medium?: SoupMedium;
  maxMinutes?: number;
  ask?: SoupAsk;
};

/** Claims the serving row for this moment; false when another run already holds it. */
async function claimServing(env: Env, ownerId: string, spec: ServingSpec, now: Date): Promise<string | null> {
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(`INSERT INTO soup_servings (id, user_id, date_key, serving_id, kind, title, status, items_json, due_at, expires_at, claimed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date_key, serving_id) DO UPDATE SET status = 'pending', claimed_at = excluded.claimed_at, updated_at = excluded.updated_at
    WHERE soup_servings.status = 'failed' OR (soup_servings.status = 'pending' AND soup_servings.claimed_at < ?)`)
    .bind(id, ownerId, spec.dateKey, spec.servingId, spec.kind, spec.title, spec.dueAt.toISOString(), spec.expiresAt.toISOString(), now.getTime(), now.toISOString(), now.toISOString(), now.getTime() - 5 * 60_000).run();
  if (!result.meta?.changes) return null;
  const row = await env.DB.prepare("SELECT id FROM soup_servings WHERE user_id = ? AND date_key = ? AND serving_id = ?").bind(ownerId, spec.dateKey, spec.servingId).first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Builds one serving end to end and stores it. Returns the open serving, or null when Soup had
 * nothing (the card then simply does not appear).
 */
export async function composeSoupServing(env: Env, ownerId: string, spec: ServingSpec, now = new Date()): Promise<SoupServing | null> {
  const id = await claimServing(env, ownerId, spec, now);
  if (!id) return null;
  const finish = async (status: SoupServingStatus, items: SoupServingItem[], fallback: boolean) => {
    await env.DB.prepare("UPDATE soup_servings SET status = ?, items_json = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(status, JSON.stringify(items), now.toISOString(), id, ownerId).run();
    const row = await env.DB.prepare("SELECT * FROM soup_servings WHERE id = ?").bind(id).first<ServingRow>();
    return row && status === "open" ? { ...serialize(row), ...(fallback ? { fallback: true } : {}) } : null;
  };
  try {
    const { taste } = await getSoupTaste(env, ownerId);
    const client = soupClientFor(env);
    const exclude = await servedItemIds(env, ownerId, now);
    const wanted = spec.ask?.medium || spec.medium;
    const since = new Date(now.getTime() - FRESH_WINDOW_MS).toISOString();
    let gathered = await gatherCandidates(client, servingQueries(spec.kind, taste, { exclude, since: spec.kind === "headlines" ? since : undefined, ask: spec.ask, medium: spec.medium, maxMinutes: spec.maxMinutes }), taste, wanted);
    let fallback = gathered.fallback;
    // Headlines want fresh news; when the pantry has little that is new, older items stand in and the card says so.
    if (spec.kind === "headlines" && gathered.items.length < HEADLINES_COUNT * 2) {
      const older = await gatherCandidates(client, servingQueries(spec.kind, taste, { exclude, ask: spec.ask, medium: spec.medium, maxMinutes: spec.maxMinutes }), taste, wanted);
      const ids = new Set(gathered.items.map(item => item.id));
      gathered = { items: [...gathered.items, ...older.items.filter(item => !ids.has(item.id))].slice(0, CANDIDATE_LIMIT), fallback: gathered.fallback || older.fallback };
      fallback = true;
    }
    // A bowl asked for with tight filters (a 20-minute listen) widens before it comes back empty: first the length, then the medium.
    if (spec.ask && gathered.items.length < 3) {
      for (const ask of [{ ...spec.ask, maxMinutes: undefined }, { ...spec.ask, maxMinutes: undefined, medium: undefined }]) {
        if (gathered.items.length >= 3) break;
        const wider = await gatherCandidates(client, servingQueries(spec.kind, taste, { exclude, ask }), taste, wanted).catch(() => ({ items: [], fallback: false }));
        const ids = new Set(gathered.items.map(item => item.id));
        gathered = { items: [...gathered.items, ...wider.items.filter(item => !ids.has(item.id))].slice(0, CANDIDATE_LIMIT), fallback: gathered.fallback || wider.fallback };
      }
    }
    if (!gathered.items.length) return finish("failed", [], fallback);
    const count = spec.kind === "headlines" ? HEADLINES_COUNT : 1 + PICK_ALTERNATES;
    const picks = (await pickWithModel(env, ownerId, { candidates: gathered.items, taste, count, occasion: spec.occasion })) || [];
    const byId = new Map(gathered.items.map(item => [item.id, item]));
    let chosen: SoupServingItem[] = picks.map(pick => ({ ...byId.get(pick.itemId)!, forYou: pick.forYou }));
    if (chosen.length < Math.min(count, gathered.items.length)) {
      const taken = new Set(chosen.map(item => item.id));
      for (const item of gathered.items) { if (chosen.length >= count) break; if (!taken.has(item.id)) chosen.push(item); }
    }
    if (spec.kind === "pick") chosen = chosen.map((item, index) => index ? { ...item, alternate: true } : item);
    return finish("open", chosen, fallback);
  } catch (error) {
    console.warn("Soup serving failed", { ownerId, servingId: spec.servingId, error: error instanceof Error ? error.message : error });
    return finish("failed", [], false);
  }
}

// ── Scheduling ──────────────────────────────────────────────

export function localParts(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  return { dateKey: `${part("year")}-${part("month")}-${part("day")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")), weekday };
}

export function localInstant(dateKey: string, time: string, timezone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(getUtcMsForLocalTime({ year, month, day, hour, minute }, timezone));
}

/** Local midnight at the end of the given day. */
export function endOfLocalDay(dateKey: string, timezone: string): Date {
  return localInstant(addDaysToDateString(dateKey, 1), "00:00", timezone);
}

export function specForServing(serving: SoupServingSpec, dateKey: string, timezone: string): ServingSpec {
  const dueAt = localInstant(dateKey, serving.time, timezone);
  const expiresAt = serving.kind === "headlines" ? endOfLocalDay(dateKey, timezone) : new Date(Math.min(dueAt.getTime() + PICK_OPEN_HOURS * 3_600_000, endOfLocalDay(dateKey, timezone).getTime()));
  const occasion = serving.kind === "headlines"
    ? `${serving.name}: three headlines for the owner's day, served at ${serving.time}.`
    : `${serving.name}: one thing to ${serving.medium === "listen" ? "listen to" : serving.medium === "read" ? "read" : "watch"} at ${serving.time}${serving.maxMinutes ? `, about ${serving.maxMinutes} minutes` : ""}.`;
  return { servingId: serving.id, kind: serving.kind, title: serving.name, dateKey, dueAt, expiresAt, occasion, ...(serving.medium ? { medium: serving.medium } : {}), ...(serving.maxMinutes ? { maxMinutes: serving.maxMinutes } : {}) };
}

/** Which of the owner's servings are due in this tick: from ten minutes before their time until the catch-up window closes. */
export function dueServings(taste: SoupTaste, local: { minutes: number; weekday: number }): SoupServingSpec[] {
  return taste.servings.filter(serving => {
    if (serving.days.length && !serving.days.includes(local.weekday)) return false;
    const [hour, minute] = serving.time.split(":").map(Number);
    const due = hour * 60 + minute;
    return local.minutes >= due - LEAD_MINUTES && local.minutes < due + CATCH_UP_MINUTES;
  });
}

/** Quarter-hour step: compose every serving whose time is near, once per owner and day. */
export async function dispatchDueSoupServings(env: Env, now = new Date()) {
  if (!await isCorePluginEnabled(env, SOUP_PLUGIN_ID)) return { skipped: "plugin disabled" };
  const owners = await env.DB.prepare(`SELECT o.id, o.timezone, t.taste_json FROM soup_taste t JOIN owner_profile o ON o.id = t.user_id WHERE t.set_up_at IS NOT NULL ORDER BY o.created_at ASC`).all<{ id: string; timezone: string | null; taste_json: string }>();
  let composed = 0;
  let failed = 0;
  for (const owner of owners.results || []) {
    const timezone = normalizeTimeZone(owner.timezone) || "UTC";
    const local = localParts(timezone, now);
    const { taste } = await getSoupTaste(env, owner.id);
    for (const serving of dueServings(taste, local)) {
      const existing = await env.DB.prepare("SELECT status, claimed_at FROM soup_servings WHERE user_id = ? AND date_key = ? AND serving_id = ?").bind(owner.id, local.dateKey, serving.id).first<{ status: string; claimed_at: number }>();
      if (existing && !(existing.status === "failed" || (existing.status === "pending" && existing.claimed_at < now.getTime() - 5 * 60_000))) continue;
      const result = await composeSoupServing(env, owner.id, specForServing(serving, local.dateKey, timezone), now);
      if (result) composed++; else failed++;
    }
  }
  return { checkedAt: now.toISOString(), composed, failed };
}

/** Composes one of the owner's servings right now, for the dev trigger and the chat tool. */
export async function serveSoupNow(env: Env, ownerId: string, servingId: string, now = new Date()): Promise<SoupServing | null> {
  const owner = await getOwnerProfile(env, ownerId);
  if (!owner) throw new JournalInputError("Owner not found", 404);
  const { taste, setUp } = await getSoupTaste(env, ownerId);
  if (!setUp) throw new JournalInputError("Set up your news with ME3 first");
  const serving = taste.servings.find(item => item.id === servingId) ?? (servingId === "morning" ? taste.servings.find(item => item.kind === "headlines") : undefined);
  if (!serving) throw new JournalInputError("No such serving", 404);
  const timezone = normalizeTimeZone(owner.timezone) || "UTC";
  const local = localParts(timezone, now);
  // Serving now replaces today's row for that serving, so a test run never blocks the real one.
  await env.DB.prepare("DELETE FROM soup_servings WHERE user_id = ? AND date_key = ? AND serving_id = ?").bind(ownerId, local.dateKey, serving.id).run();
  const spec = specForServing(serving, local.dateKey, timezone);
  const dueAt = now;
  const expiresAt = new Date(Math.max(spec.expiresAt.getTime(), now.getTime() + 2 * 3_600_000));
  return composeSoupServing(env, ownerId, { ...spec, dueAt, expiresAt }, now);
}

/** A bowl the owner asked for in chat: served there, and kept on Home until they have had it. */
export async function serveSoupAsk(env: Env, ownerId: string, ask: SoupAsk & { title?: string; occasion?: string }, now = new Date()): Promise<SoupServing | null> {
  const owner = await getOwnerProfile(env, ownerId);
  if (!owner) throw new JournalInputError("Owner not found", 404);
  const timezone = normalizeTimeZone(owner.timezone) || "UTC";
  const local = localParts(timezone, now);
  const title = (ask.title || "").replace(/\s+/g, " ").trim().slice(0, 60) || "You asked";
  return composeSoupServing(env, ownerId, {
    servingId: `ask-${crypto.randomUUID().slice(0, 8)}`, kind: "pick", title, dateKey: local.dateKey, dueAt: now,
    expiresAt: new Date(now.getTime() + ASK_OPEN_HOURS * 3_600_000),
    occasion: ask.occasion || "The owner asked for something good right now.",
    ask: { topics: ask.topics, ...(ask.medium ? { medium: ask.medium } : {}), ...(ask.maxMinutes ? { maxMinutes: ask.maxMinutes } : {}), ...(ask.soups?.length ? { soups: ask.soups } : {}) },
  }, now);
}

// ── Reading and acting ──────────────────────────────────────

/** Open servings for the Home card: due, not yet had, and the moment not passed. Older ones expire here. */
export async function listOpenSoupServings(env: Env, ownerId: string, now = new Date()): Promise<SoupServing[]> {
  await env.DB.prepare("UPDATE soup_servings SET status = 'expired', updated_at = ? WHERE user_id = ? AND status = 'open' AND expires_at <= ?").bind(now.toISOString(), ownerId, now.toISOString()).run();
  const rows = await env.DB.prepare("SELECT * FROM soup_servings WHERE user_id = ? AND status = 'open' AND due_at <= ? ORDER BY due_at DESC LIMIT 5").bind(ownerId, now.toISOString()).all<ServingRow>();
  return (rows.results || []).map(serialize);
}

export async function getSoupServing(env: Env, ownerId: string, id: string): Promise<SoupServing | null> {
  const row = await env.DB.prepare("SELECT * FROM soup_servings WHERE id = ? AND user_id = ?").bind(id, ownerId).first<ServingRow>();
  return row ? serialize(row) : null;
}

export type SoupServingAction = "open" | "finish" | "like" | "dislike" | "later" | "dismiss";
const ACTIONS = new Set<SoupServingAction>(["open", "finish", "like", "dislike", "later", "dismiss"]);

/**
 * What the owner did with a serving. Opening an item marks it opened; liking, disliking or
 * finishing the main pick finishes the serving; "later" keeps it on the card until this time
 * tomorrow; "dismiss" ends it. Everything stays in ME3.
 */
export async function actOnSoupServing(env: Env, ownerId: string, id: string, input: unknown, now = new Date()): Promise<SoupServing> {
  const action = (input as { action?: unknown })?.action;
  const itemId = (input as { itemId?: unknown })?.itemId;
  if (typeof action !== "string" || !ACTIONS.has(action as SoupServingAction)) throw new JournalInputError("action must be open, finish, like, dislike, later or dismiss");
  const serving = await getSoupServing(env, ownerId, id);
  if (!serving) throw new JournalInputError("Serving not found", 404);
  const items = serving.items.map(item => ({ ...item }));
  const target = typeof itemId === "string" ? items.find(item => item.id === itemId) : items.find(item => !item.alternate) ?? items[0];
  if (action !== "dismiss" && !target) throw new JournalInputError("Item not found", 404);
  let status = serving.status;
  let expiresAt = serving.expiresAt;
  let openedAt = serving.openedAt;
  let finishedAt = serving.finishedAt;
  if (action === "open" && target) { if (target.state === "served") target.state = "opened"; openedAt ??= now.toISOString(); }
  if (action === "finish" && target) { target.state = "finished"; openedAt ??= now.toISOString(); }
  if ((action === "like" || action === "dislike") && target) { target.state = action === "like" ? "liked" : "disliked"; openedAt ??= now.toISOString(); }
  if (action === "later" && target) { target.state = "later"; expiresAt = new Date(now.getTime() + 24 * 3_600_000).toISOString(); }
  if (action === "dismiss") { status = "done"; finishedAt = now.toISOString(); }
  // A single pick is had once the main item is finished or rated; headlines stay until the day ends or the owner dismisses them.
  if (serving.kind === "pick" && target && !target.alternate && ["finished", "liked", "disliked"].includes(target.state) && status === "open") {
    status = "done"; finishedAt = now.toISOString();
  }
  await env.DB.prepare("UPDATE soup_servings SET items_json = ?, status = ?, expires_at = ?, opened_at = ?, finished_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(JSON.stringify(items), status, expiresAt, openedAt, finishedAt, now.toISOString(), id, ownerId).run();
  return (await getSoupServing(env, ownerId, id))!;
}

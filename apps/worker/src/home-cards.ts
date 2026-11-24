import { addDaysToDateString } from "@me3-core/plugin-calendar";
import { HOME_CARD_SOURCE_ACCESS, HOME_CARD_SOURCE_BLOCKS, HOME_CARD_SOURCES, createHomeCardLoaders, homeCardDataState, homeCardTaskBelongs, type HomeCardDataBlock, type HomeCardDataState, type HomeCardLoaders, type HomeCardSource } from "./home-card-data";
import { updateMissionTask } from "./mission-control";
import { JournalInputError } from "./journal";
import { getHomeLayout, saveHomeLayout } from "./home-layout";
import { ownerLocalClock } from "./quotes";
import { isRecord, parseJsonArray } from "./workspace-input";
import type { Env } from "./types";

/**
 * Custom Home cards: cards ME3 (or the owner) builds from a small vocabulary of
 * blocks (catalog me3/cards/v1). The spec is declarative, so every client draws
 * it natively. Habit and counter blocks keep the owner's entries by day; data
 * blocks (stat, progress, days, list) show live install data from a named
 * source. Each card is also served as an A2UI v1.0 surface. Versions are
 * linear; rolling back adds one.
 */
export const HOME_CARD_CATALOG_ID = "me3/cards/v1";
export const HOME_CARDS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS home_cards (
    user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    version INTEGER NOT NULL,
    blocks_json TEXT NOT NULL,
    created_by TEXT NOT NULL CHECK (created_by IN ('agent', 'owner')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS home_card_versions (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    blocks_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS home_card_entries (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    key TEXT NOT NULL,
    date TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, key, date)
  )`,
];

export type HomeCardBlock =
  | { type: "habit"; key: string; label: string; emoji?: string; perWeek?: number }
  | { type: "counter"; key: string; label: string; emoji?: string; unit?: string; step?: number; goal?: number; period?: "day" | "total" }
  | { type: "note"; key: string; label: string; emoji?: string; placeholder?: string }
  | { type: "text"; text: string }
  | HomeCardDataBlock
  | { type: "action"; key: string; label: string; prompt: string };
export type HomeCardSpec = { name: string; emoji: string; blocks: HomeCardBlock[] };
export type HomeCardVersion = { version: number; name: string; emoji: string; summary: string; createdAt: string };
export type HomeCard = HomeCardSpec & { id: string; version: number; createdBy: "agent" | "owner"; createdAt: string; updatedAt: string; history: HomeCardVersion[]; access: HomeCardAccess };
/** What the card can read and change, shown on its About sheet. */
export type HomeCardAccess = { sees: string[]; changes: string[] };
export type HomeCardBlockState =
  | { type: "habit"; today: boolean; streak: number; longest: number; thisWeek: number; perWeek: number | null; week: (boolean | null)[]; dates: string[] }
  | { type: "counter"; today: number; total: number; goal: number | null; done: boolean }
  | { type: "note"; today: string }
  | HomeCardDataState;
export type HomeCardState = { date: string; blocks: Record<string, HomeCardBlockState>; done: number; total: number };
export type HomeCardAction = { action: "tick"; key: string; date?: string; on?: boolean } | { action: "add"; key: string; by?: number; date?: string } | { action: "set"; key: string; value: unknown; date?: string };
export type HomeCardSurface = { version: "1.0"; createSurface: { surfaceId: string; catalogId: string; components: Record<string, unknown>[]; dataModel: Record<string, unknown> } };
export type HomeCardRecord = { card: HomeCard; state: HomeCardState; surface: HomeCardSurface };

const BLOCK_TYPES = new Set(["habit", "counter", "note", "text", "stat", "progress", "days", "list", "action"]);
const DATA_TYPES = new Set(["stat", "progress", "days", "list"]);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const KEY = /^[a-z][a-z0-9_-]{0,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BUILT_IN = new Set(["today", "inbox", "people", "mission", "accounts", "journal", "gratitude", "tasks", "goals", "writing", "files", "wheel"]);
const MAX_BLOCKS = 12;
const MAX_HISTORY = 20;
const MAX_NOTE = 200;
const FIRST_SUMMARY = "Made by your ME3";

type CardRow = { user_id: string; id: string; name: string; emoji: string; version: number; blocks_json: string; created_by: "agent" | "owner"; created_at: string; updated_at: string };
type VersionRow = { version: number; name: string; emoji: string; blocks_json: string; summary: string; created_at: string };
type EntryRow = { key: string; date: string; value_json: string };

const bad = (message: string, status: 400 | 404 = 400) => new JournalInputError(message, status);
function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null) { if (required) throw bad(`${label} is required`); return ""; }
  if (typeof value !== "string") throw bad(`${label} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw bad(`${label} is required`);
  if (trimmed.length > max) throw bad(`${label} must be ${max} characters or fewer`);
  return trimmed;
}
function optionalText(value: unknown, label: string, max: number): string | undefined {
  const trimmed = text(value, label, max, false);
  return trimmed || undefined;
}
function optionalNumber(value: unknown, label: string, min: number, max: number, integer = false): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw bad(`${label} must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}`);
  return value;
}

/** Validates a card spec written by the agent or the owner. Every block type the clients can draw is listed here. */
export function parseHomeCardSpec(input: unknown): HomeCardSpec {
  if (!isRecord(input)) throw bad("A card is required");
  const name = text(input.name, "Name", 40);
  const emoji = text(input.emoji, "Emoji", 8);
  if (!Array.isArray(input.blocks) || !input.blocks.length) throw bad("A card needs at least one block");
  if (input.blocks.length > MAX_BLOCKS) throw bad(`A card can have up to ${MAX_BLOCKS} blocks`);
  const keys = new Set<string>();
  const given = new Set(input.blocks.flatMap(raw => isRecord(raw) && typeof raw.key === "string" ? [raw.key.trim()] : []));
  const nextKey = (type: string) => { let n = 1; while (given.has(`${type}${n}`) || keys.has(`${type}${n}`)) n++; return `${type}${n}`; };
  const blocks = input.blocks.map((raw): HomeCardBlock => {
    if (!isRecord(raw) || typeof raw.type !== "string" || !BLOCK_TYPES.has(raw.type)) throw bad("Blocks must be habit, counter, stat, progress, days, list or action");
    if (raw.type === "text") return { type: "text", text: text(raw.text, "Text", 200) };
    const key = raw.key === undefined && (DATA_TYPES.has(raw.type) || raw.type === "action") ? nextKey(raw.type) : text(raw.key, "Block key", 32);
    if (!KEY.test(key)) throw bad("Block keys use lowercase letters, numbers, - and _");
    if (keys.has(key)) throw bad("Block keys must be unique");
    keys.add(key);
    if (DATA_TYPES.has(raw.type)) return parseDataBlock(raw, key);
    if (raw.type === "action") return { type: "action", key, label: text(raw.label, "Button label", 40), prompt: text(raw.prompt, "What the button asks ME3", 300) };
    const label = text(raw.label, "Label", 60);
    const blockEmoji = optionalText(raw.emoji, "Block emoji", 8);
    if (raw.type === "habit") return { type: "habit", key, label, ...(blockEmoji ? { emoji: blockEmoji } : {}), ...(raw.perWeek !== undefined ? { perWeek: optionalNumber(raw.perWeek, "Times per week", 1, 7, true) } : {}) };
    if (raw.type === "note") return { type: "note", key, label, ...(blockEmoji ? { emoji: blockEmoji } : {}), ...(optionalText(raw.placeholder, "Placeholder", 60) ? { placeholder: optionalText(raw.placeholder, "Placeholder", 60) } : {}) };
    const period = raw.period === undefined ? undefined : raw.period;
    if (period !== undefined && period !== "day" && period !== "total") throw bad("Counter period must be day or total");
    return { type: "counter", key, label, ...(blockEmoji ? { emoji: blockEmoji } : {}),
      ...(optionalText(raw.unit, "Unit", 12) ? { unit: optionalText(raw.unit, "Unit", 12) } : {}),
      ...(raw.step !== undefined ? { step: optionalNumber(raw.step, "Step", 0.01, 1000) } : {}),
      ...(raw.goal !== undefined ? { goal: optionalNumber(raw.goal, "Goal", 0.01, 1_000_000) } : {}),
      ...(period ? { period } : {}) };
  });
  return { name, emoji, blocks };
}

function parseDataBlock(raw: Record<string, unknown>, key: string): HomeCardDataBlock {
  const type = raw.type as HomeCardDataBlock["type"];
  if (typeof raw.source !== "string" || !(HOME_CARD_SOURCES as readonly string[]).includes(raw.source)) throw bad(`Source must be one of ${HOME_CARD_SOURCES.join(", ")}`);
  const source = raw.source as HomeCardSource;
  if (!HOME_CARD_SOURCE_BLOCKS[type].includes(source)) throw bad(`A ${type} block can show ${HOME_CARD_SOURCE_BLOCKS[type].join(", ")}`);
  const label = optionalText(raw.label, "Label", 80);
  const goalId = raw.goalId === undefined || raw.goalId === null || raw.goalId === "" ? undefined : text(raw.goalId, "Goal id", 80);
  if (goalId && !ID.test(goalId)) throw bad("Goal id is not valid");
  if (goalId && source !== "goal" && source !== "tasks") throw bad("Only goal and tasks blocks take a goal id");
  if (type === "days") return { type, key, source };
  if (type === "list") {
    const limit = raw.limit === undefined ? undefined : optionalNumber(raw.limit, "Rows", 1, 5, true);
    const empty = optionalText(raw.empty, "Empty text", 80);
    return { type, key, source, ...(limit ? { limit } : {}), ...(goalId ? { goalId } : {}), ...(empty ? { empty } : {}) };
  }
  if (type === "progress") {
    const goal = raw.goal === undefined ? undefined : optionalNumber(raw.goal, "Money goal", 1, 100_000_000);
    if (source === "money.month" && goal === undefined) throw bad("A money progress bar needs a goal amount");
    return { type, key, source, ...(label ? { label } : {}), ...(goal !== undefined ? { goal } : {}), ...(goalId ? { goalId } : {}) };
  }
  return { type: "stat", key, source, ...(label ? { label } : {}), ...(goalId ? { goalId } : {}) };
}

/** What a card's blocks let it read and change. */
export function homeCardAccess(blocks: HomeCardBlock[]): HomeCardAccess {
  const sees = new Set<string>();
  const changes = new Set<string>();
  for (const block of blocks) {
    if (block.type === "habit" || block.type === "counter" || block.type === "note") { changes.add("Its own entries"); continue; }
    if (!DATA_TYPES.has(block.type)) continue;
    const data = block as HomeCardDataBlock;
    sees.add(HOME_CARD_SOURCE_ACCESS[data.source]);
    if (data.type === "list" && data.source === "tasks") changes.add("Ticks tasks");
  }
  return { sees: [...sees], changes: [...changes] };
}

function slug(name: string): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
  return `card-${base || "card"}`;
}

function parseBlocks(raw: string): HomeCardBlock[] { return parseJsonArray(raw) as HomeCardBlock[]; }

function mondayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return addDaysToDateString(date, -((weekday + 6) % 7));
}

/** Computes what the face shows from the day-keyed entries: ticks, streaks, this week, counters and notes. */
export function homeCardState(blocks: HomeCardBlock[], entries: EntryRow[], date: string): HomeCardState {
  const byKey = new Map<string, Map<string, unknown>>();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, new Map());
    try { byKey.get(entry.key)!.set(entry.date, JSON.parse(entry.value_json)); } catch { /* A corrupt value is skipped rather than failing the card. */ }
  }
  const monday = mondayOf(date);
  const state: HomeCardState = { date, blocks: {}, done: 0, total: 0 };
  for (const block of blocks) {
    if (block.type === "text") continue;
    const values = byKey.get(block.key) ?? new Map<string, unknown>();
    if (block.type === "habit") {
      const dates = [...values.entries()].filter(([, value]) => value === true).map(([day]) => day).sort();
      const ticked = new Set(dates);
      let streak = 0;
      for (let day = ticked.has(date) ? date : addDaysToDateString(date, -1); ticked.has(day); day = addDaysToDateString(day, -1)) streak++;
      let longest = 0, run = 0, previous: string | null = null;
      for (const day of dates) { run = previous && addDaysToDateString(previous, 1) === day ? run + 1 : 1; longest = Math.max(longest, run); previous = day; }
      const week = Array.from({ length: 7 }, (_, i) => { const day = addDaysToDateString(monday, i); return day > date ? null : ticked.has(day); });
      const thisWeek = week.filter(Boolean).length;
      state.blocks[block.key] = { type: "habit", today: ticked.has(date), streak, longest, thisWeek, perWeek: block.perWeek ?? null, week, dates: dates.slice(-400) };
      state.total++; if (ticked.has(date)) state.done++;
    } else if (block.type === "counter") {
      const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
      const today = number(values.get(date));
      const total = [...values.values()].reduce<number>((sum, value) => sum + number(value), 0);
      const goal = block.goal ?? null;
      const measured = block.period === "total" ? total : today;
      const done = goal !== null && measured >= goal;
      state.blocks[block.key] = { type: "counter", today, total, goal, done };
      if (goal !== null) { state.total++; if (done) state.done++; }
    } else {
      const value = values.get(date);
      state.blocks[block.key] = { type: "note", today: typeof value === "string" ? value : "" };
    }
  }
  return state;
}

async function loadRow(env: Env, userId: string, id: string): Promise<CardRow> {
  const row = await env.DB.prepare("SELECT * FROM home_cards WHERE user_id = ? AND id = ?").bind(userId, id).first<CardRow>();
  if (!row) throw bad("Card not found", 404);
  return row;
}
/** The card as an A2UI v1.0 createSurface message: flat components bound to a data model. */
export function homeCardSurface(card: Pick<HomeCard, "id" | "name" | "emoji" | "blocks">, state: HomeCardState): HomeCardSurface {
  const ids = card.blocks.map((block, i) => "key" in block ? block.key : `text${i + 1}`);
  const components: Record<string, unknown>[] = [{ id: "root", component: "Card", title: card.name, emoji: card.emoji, children: ids }];
  card.blocks.forEach((block, i) => {
    const id = ids[i];
    const data = { "@path": `/blocks/${id}` };
    if (block.type === "text") components.push({ id, component: "Text", text: block.text });
    else if (block.type === "habit") components.push({ id, component: "Habit", label: block.label, ...(block.emoji ? { emoji: block.emoji } : {}), data, action: { event: { name: "tick", context: { key: id } } } });
    else if (block.type === "counter") components.push({ id, component: "Counter", label: block.label, ...(block.emoji ? { emoji: block.emoji } : {}), ...(block.unit ? { unit: block.unit } : {}), step: block.step ?? 1, data, action: { event: { name: "add", context: { key: id } } } });
    else if (block.type === "note") components.push({ id, component: "Note", label: block.label, ...(block.emoji ? { emoji: block.emoji } : {}), data, action: { event: { name: "set", context: { key: id } } } });
    else if (block.type === "action") components.push({ id, component: "Action", label: block.label, action: { functionCall: { call: "askME3", args: { prompt: block.prompt } } } });
    else {
      const name = { stat: "Stat", progress: "Progress", days: "Days", list: "List" }[block.type];
      components.push({ id, component: name, source: block.source, data, ...(block.type === "list" && block.source === "tasks" ? { action: { event: { name: "task.done", context: { key: id } } } } : {}) });
    }
  });
  return { version: "1.0", createSurface: { surfaceId: card.id, catalogId: HOME_CARD_CATALOG_ID, components, dataModel: { date: state.date, done: state.done, total: state.total, blocks: state.blocks } } };
}

async function withDataState(blocks: HomeCardBlock[], state: HomeCardState, loaders: () => HomeCardLoaders): Promise<HomeCardState> {
  const data = blocks.filter((block): block is HomeCardDataBlock => DATA_TYPES.has(block.type));
  if (!data.length) return state;
  const load = loaders();
  const resolved = await Promise.all(data.map(block => homeCardDataState(block, load)));
  data.forEach((block, i) => { state.blocks[block.key] = resolved[i]; });
  return state;
}

async function loadCard(env: Env, userId: string, row: CardRow, date: string, loaders: () => HomeCardLoaders): Promise<HomeCardRecord> {
  const [versions, entries] = await Promise.all([
    env.DB.prepare("SELECT version, name, emoji, blocks_json, summary, created_at FROM home_card_versions WHERE user_id = ? AND card_id = ? ORDER BY version DESC LIMIT ?").bind(userId, row.id, MAX_HISTORY).all<VersionRow>(),
    env.DB.prepare("SELECT key, date, value_json FROM home_card_entries WHERE user_id = ? AND card_id = ?").bind(userId, row.id).all<EntryRow>(),
  ]);
  const blocks = parseBlocks(row.blocks_json);
  const card: HomeCard = { id: row.id, name: row.name, emoji: row.emoji, version: row.version, blocks, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    history: (versions.results || []).map(version => ({ version: version.version, name: version.name, emoji: version.emoji, summary: version.summary, createdAt: version.created_at })), access: homeCardAccess(blocks) };
  const state = await withDataState(blocks, homeCardState(blocks, entries.results || [], date), loaders);
  return { card, state, surface: homeCardSurface(card, state) };
}

export async function listHomeCards(env: Env, userId: string, now = new Date()): Promise<{ date: string; cards: HomeCardRecord[] }> {
  const clock = await ownerLocalClock(env, userId, now);
  const { date } = clock;
  const rows = await env.DB.prepare("SELECT * FROM home_cards WHERE user_id = ? ORDER BY created_at, rowid").bind(userId).all<CardRow>();
  let shared: HomeCardLoaders | null = null;
  const loaders = () => (shared ??= createHomeCardLoaders(env, userId, clock, now));
  const cards: HomeCardRecord[] = [];
  for (const row of rows.results || []) cards.push(await loadCard(env, userId, row, date, loaders));
  return { date, cards };
}

export async function getHomeCard(env: Env, userId: string, id: string, now = new Date()): Promise<HomeCardRecord> {
  const clock = await ownerLocalClock(env, userId, now);
  let shared: HomeCardLoaders | null = null;
  return loadCard(env, userId, await loadRow(env, userId, id), clock.date, () => (shared ??= createHomeCardLoaders(env, userId, clock, now)));
}

export async function createHomeCard(env: Env, userId: string, input: unknown, createdBy: "agent" | "owner", now = new Date()): Promise<HomeCardRecord> {
  const spec = parseHomeCardSpec(input);
  const base = slug(spec.name);
  const taken = new Set((await env.DB.prepare("SELECT id FROM home_cards WHERE user_id = ? AND (id = ? OR id LIKE ?)").bind(userId, base, `${base}-%`).all<{ id: string }>()).results?.map(row => row.id) ?? []);
  let id = base;
  for (let n = 2; taken.has(id) || BUILT_IN.has(id); n++) id = `${base}-${n}`;
  const at = now.toISOString();
  const blocksJson = JSON.stringify(spec.blocks);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO home_cards(user_id, id, name, emoji, version, blocks_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)").bind(userId, id, spec.name, spec.emoji, blocksJson, createdBy, at, at),
    env.DB.prepare("INSERT INTO home_card_versions(user_id, card_id, version, name, emoji, blocks_json, summary, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)").bind(userId, id, spec.name, spec.emoji, blocksJson, createdBy === "agent" ? FIRST_SUMMARY : "Made by you", at),
  ]);
  return getHomeCard(env, userId, id, now);
}

async function writeVersion(env: Env, userId: string, row: CardRow, spec: HomeCardSpec, summary: string, now: Date): Promise<HomeCardRecord> {
  const at = now.toISOString();
  const version = row.version + 1;
  const blocksJson = JSON.stringify(spec.blocks);
  await env.DB.batch([
    env.DB.prepare("UPDATE home_cards SET name = ?, emoji = ?, version = ?, blocks_json = ?, updated_at = ? WHERE user_id = ? AND id = ? AND version = ?").bind(spec.name, spec.emoji, version, blocksJson, at, userId, row.id, row.version),
    env.DB.prepare("INSERT INTO home_card_versions(user_id, card_id, version, name, emoji, blocks_json, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(userId, row.id, version, spec.name, spec.emoji, blocksJson, summary, at),
  ]);
  return getHomeCard(env, userId, row.id, now);
}

/** A new version from a partial spec: omitted name, emoji or blocks keep their current values. Data is untouched. */
export async function updateHomeCard(env: Env, userId: string, id: string, input: unknown, summary: unknown, now = new Date()): Promise<HomeCardRecord> {
  if (!isRecord(input)) throw bad("A change is required");
  const note = text(summary, "A one-line summary of the change", 120);
  const row = await loadRow(env, userId, id);
  if (input.name === undefined && input.emoji === undefined && input.blocks === undefined) throw bad("Nothing to change");
  const spec = parseHomeCardSpec({ name: input.name ?? row.name, emoji: input.emoji ?? row.emoji, blocks: input.blocks ?? parseBlocks(row.blocks_json) });
  return writeVersion(env, userId, row, spec, note, now);
}

export async function rollbackHomeCard(env: Env, userId: string, id: string, version: unknown, now = new Date()): Promise<HomeCardRecord> {
  const row = await loadRow(env, userId, id);
  const target = optionalNumber(version, "Version", 1, row.version, true);
  if (target === undefined) throw bad("Version is required");
  const saved = await env.DB.prepare("SELECT version, name, emoji, blocks_json, summary, created_at FROM home_card_versions WHERE user_id = ? AND card_id = ? AND version = ?").bind(userId, id, target).first<VersionRow>();
  if (!saved) throw bad("That version is no longer available", 404);
  return writeVersion(env, userId, row, { name: saved.name, emoji: saved.emoji, blocks: parseBlocks(saved.blocks_json) }, `Back to v${target}`, now);
}

export async function deleteHomeCard(env: Env, userId: string, id: string): Promise<{ ok: true }> {
  await loadRow(env, userId, id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM home_card_entries WHERE user_id = ? AND card_id = ?").bind(userId, id),
    env.DB.prepare("DELETE FROM home_card_versions WHERE user_id = ? AND card_id = ?").bind(userId, id),
    env.DB.prepare("DELETE FROM home_cards WHERE user_id = ? AND id = ?").bind(userId, id),
  ]);
  const { layout } = await getHomeLayout(env, userId);
  if (layout && Object.values(layout).some(list => list.includes(id))) {
    await saveHomeLayout(env, userId, Object.fromEntries(Object.entries(layout).map(([key, list]) => [key, list.filter(item => item !== id)])));
  }
  return { ok: true };
}

/** Ticks, adds or sets one block's value for one day. Today by default; never a future day. */
export async function actOnHomeCard(env: Env, userId: string, id: string, input: unknown, now = new Date()): Promise<HomeCardRecord> {
  if (!isRecord(input)) throw bad("An action is required");
  const row = await loadRow(env, userId, id);
  const { date: today } = await ownerLocalClock(env, userId, now);
  const key = text(input.key, "Block key", 32);
  const block = parseBlocks(row.blocks_json).find((candidate): candidate is Extract<HomeCardBlock, { type: "habit" | "counter" | "note" }> => (candidate.type === "habit" || candidate.type === "counter" || candidate.type === "note") && candidate.key === key);
  if (!block) throw bad(`There is no block called ${key} on this card that you can fill in`, 404);
  const date = input.date === undefined ? today : text(input.date, "Date", 10);
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw bad("Date must be YYYY-MM-DD");
  if (date > today) throw bad("That day is in the future");
  if (date < addDaysToDateString(today, -366)) throw bad("That day is more than a year ago");
  let value: unknown;
  if (input.action === "tick") {
    if (block.type !== "habit") throw bad("Only habit blocks can be ticked");
    if (input.on !== undefined && typeof input.on !== "boolean") throw bad("on must be true or false");
    value = input.on ?? true;
  } else if (input.action === "add") {
    if (block.type !== "counter") throw bad("Only counter blocks can be added to");
    const by = optionalNumber(input.by, "Amount", -1_000_000, 1_000_000) ?? block.step ?? 1;
    const current = await env.DB.prepare("SELECT value_json FROM home_card_entries WHERE user_id = ? AND card_id = ? AND key = ? AND date = ?").bind(userId, id, key, date).first<{ value_json: string }>();
    let existing = 0;
    try { const parsed = current ? JSON.parse(current.value_json) : 0; existing = typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0; } catch { existing = 0; }
    value = Math.max(0, Math.round((existing + by) * 100) / 100);
  } else if (input.action === "set") {
    if (block.type === "counter") value = optionalNumber(input.value, "Value", 0, 1_000_000) ?? (() => { throw bad("Value must be a number"); })();
    else if (block.type === "note") value = text(input.value, "Note", MAX_NOTE, false);
    else throw bad("Habits are ticked, not set");
  } else throw bad("Action must be tick, add or set");
  const at = now.toISOString();
  if (value === false || value === "" ) {
    await env.DB.prepare("DELETE FROM home_card_entries WHERE user_id = ? AND card_id = ? AND key = ? AND date = ?").bind(userId, id, key, date).run();
  } else {
    await env.DB.prepare(`INSERT INTO home_card_entries(user_id, card_id, key, date, value_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, card_id, key, date) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).bind(userId, id, key, date, JSON.stringify(value), at).run();
  }
  return getHomeCard(env, userId, id, now);
}

/**
 * An A2UI action from a client: { name, sourceComponentId, context }. tick, add
 * and set act on the card's own entries; task.done ticks a real task, but only
 * one the card's tasks list shows (same goal, if it has one).
 */
export async function handleHomeCardAction(env: Env, userId: string, id: string, input: unknown, now = new Date()): Promise<HomeCardRecord> {
  if (!isRecord(input)) throw bad("An action is required");
  const name = text(input.name, "Action name", 32);
  const source = text(input.sourceComponentId, "Component", 32);
  const context = isRecord(input.context) ? input.context : {};
  if (name === "tick" || name === "add" || name === "set") {
    return actOnHomeCard(env, userId, id, { action: name, key: source, ...(context.on !== undefined ? { on: context.on } : {}), ...(context.by !== undefined ? { by: context.by } : {}), ...(context.value !== undefined ? { value: context.value } : {}), ...(context.date !== undefined ? { date: context.date } : {}) }, now);
  }
  if (name === "task.done") {
    const row = await loadRow(env, userId, id);
    const block = parseBlocks(row.blocks_json).find(candidate => candidate.type === "list" && candidate.key === source) as Extract<HomeCardBlock, { type: "list" }> | undefined;
    if (!block || block.source !== "tasks") throw bad("This card can't tick tasks");
    const taskId = text(context.taskId, "Task", 80);
    if (!(await homeCardTaskBelongs(env, userId, taskId, block.goalId))) throw bad("That task isn't on this card");
    if (context.on !== undefined && typeof context.on !== "boolean") throw bad("on must be true or false");
    await updateMissionTask(env, userId, taskId, { status: context.on === false ? "backlog" : "done" });
    return getHomeCard(env, userId, id, now);
  }
  throw bad("Action must be tick, add, set or task.done");
}

/** What the agent's card tools can do. Errors carry the owner-facing message. */
export function createAgentHomeCardServices(env: Env, ownerId: string, clock: () => Date = () => new Date()) {
  return {
    list: () => listHomeCards(env, ownerId, clock()),
    read: (id: string) => getHomeCard(env, ownerId, id, clock()),
    create: (input: unknown) => createHomeCard(env, ownerId, input, "agent", clock()),
    update: (id: string, input: unknown, summary: unknown) => updateHomeCard(env, ownerId, id, input, summary, clock()),
    act: (id: string, input: unknown) => actOnHomeCard(env, ownerId, id, input, clock()),
  };
}
export type AgentHomeCardServices = ReturnType<typeof createAgentHomeCardServices>;

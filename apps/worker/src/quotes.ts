import { addDaysToDateString, normalizeTimeZone } from "./calendar";
import { getLatestMissionWheelSnapshot } from "./wheel-of-life";
import { isRecord, parseJsonArray } from "./workspace-input";
import type { Env } from "./types";

export class QuoteInputError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) { super(message); }
}
type QuoteRow = { id: string; user_id: string | null; text: string; author: string; source: string | null; source_url: string | null; areas: string; origin: "core" | "owner" | "agent"; saved_at: string | null; archived_at: string | null };
type DailyQuoteRow = { quote_id: string; seen_json: string };
function serializeQuote(row: QuoteRow, userId: string) {
  return { id: row.id, text: row.text, author: row.author, source: row.source, sourceUrl: row.source_url, areas: parseJsonArray(row.areas).filter((area): area is string => typeof area === "string"), origin: row.origin, savedAt: row.user_id === userId ? row.saved_at : null };
}

export async function ownerLocalClock(env: Env, userId: string, now = new Date()) {
  const owner = await env.DB.prepare("SELECT timezone FROM owner_profile WHERE id = ?").bind(userId).first<{ timezone: string | null }>();
  const timezone = normalizeTimeZone(owner?.timezone) || "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  return { timezone, date: `${part("year")}-${part("month")}-${part("day")}` };
}

export async function getTodayQuote(env: Env, userId: string, now = new Date(), another = false) {
  const { date } = await ownerLocalClock(env, userId, now);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await env.DB.prepare("SELECT quote_id, seen_json FROM daily_quotes WHERE user_id = ? AND date_key = ?").bind(userId, date).first<DailyQuoteRow>();
    const rows = await env.DB.prepare("SELECT * FROM quotes WHERE archived_at IS NULL AND (origin = 'core' OR (user_id = ? AND saved_at IS NOT NULL)) ORDER BY id").bind(userId).all<QuoteRow>();
    const all = rows.results || [];
    if (!all.length) return null;
    const existing = all.find(q => q.id === current?.quote_id);
    if (existing && !another) return serializeQuote(existing, userId);
    const recent = await env.DB.prepare("SELECT quote_id FROM daily_quotes WHERE user_id = ? AND date_key >= ? AND date_key < ?").bind(userId, addDaysToDateString(date, -7), date).all<{ quote_id: string }>();
    let seen = current ? parseJsonArray(current.seen_json).filter((id): id is string => typeof id === "string") : [];
    const excluded = new Set([...seen, ...(recent.results || []).map(q => q.quote_id)]);
    let candidates = all.filter(q => !excluded.has(q.id));
    if (!candidates.length) {
      seen = [];
      candidates = all.filter(q => q.id !== current?.quote_id);
      if (!candidates.length) candidates = all;
    }
    const snapshot = await getLatestMissionWheelSnapshot(env, userId);
    const settings = snapshot ? null : await env.DB.prepare("SELECT segments_json FROM mission_wheel_settings WHERE user_id = ?").bind(userId).first<{ segments_json: string }>();
    const segments = snapshot?.segments || parseJsonArray(settings?.segments_json || "[]").filter(isRecord).filter(segment => typeof segment.id === "string" && typeof segment.value === "number" && segment.value >= 1 && segment.value <= 10).map(segment => ({ id: String(segment.id), value: Number(segment.value) }));
    const lowest = segments.filter(s => s.value !== null).sort((a, b) => a.value! - b.value!)[0]?.id;
    const saved = candidates.filter(q => q.user_id === userId && q.saved_at);
    const matched = lowest ? candidates.filter(q => parseJsonArray(q.areas).includes(lowest)) : [];
    const roll = Math.random();
    const pool = roll < 0.2 && saved.length ? saved : roll < 0.8 && matched.length ? matched : candidates;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const seenJson = JSON.stringify([...seen, picked.id]);
    if (current) {
      const updated = await env.DB.prepare("UPDATE daily_quotes SET quote_id = ?, seen_json = ? WHERE user_id = ? AND date_key = ? AND quote_id = ? AND seen_json = ?").bind(picked.id, seenJson, userId, date, current.quote_id, current.seen_json).run();
      if (!updated.meta?.changes) continue;
    } else {
      const inserted = await env.DB.prepare("INSERT OR IGNORE INTO daily_quotes(user_id, date_key, quote_id, seen_json) VALUES (?, ?, ?, ?)").bind(userId, date, picked.id, seenJson).run();
      if (!inserted.meta?.changes) continue;
    }
    return serializeQuote(picked, userId);
  }
  throw new Error("Today's quote changed. Try again.");
}

export async function listMyQuotes(env: Env, userId: string) {
  const rows = await env.DB.prepare("SELECT * FROM quotes WHERE user_id = ? AND saved_at IS NOT NULL AND archived_at IS NULL ORDER BY saved_at DESC, id").bind(userId).all<QuoteRow>();
  return { quotes: (rows.results || []).map(row => serializeQuote(row, userId)) };
}

export async function setQuoteSaved(env: Env, userId: string, id: string, saved: boolean) {
  const row = await env.DB.prepare("SELECT * FROM quotes WHERE id = ? AND (origin = 'core' OR user_id = ?)").bind(id, userId).first<QuoteRow>();
  if (!row) throw new QuoteInputError("Quote not found", 404);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE quotes SET user_id = ?, saved_at = ?, archived_at = ? WHERE id = ?").bind(saved || row.origin !== "core" ? userId : null, saved ? (row.saved_at || now) : null, !saved && row.origin !== "core" ? now : null, id).run();
  return serializeQuote((await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(id).first<QuoteRow>())!, userId);
}

export async function saveOwnerQuote(env: Env, userId: string, input: unknown, origin: "owner" | "agent") {
  if (!isRecord(input)) throw new QuoteInputError("Quote is required");
  const text = quoteString(input.text, "Quote", 4000, true);
  const author = quoteString(input.author, "Author", 200) || "";
  const source = quoteString(input.source, "Source", 500);
  const sourceUrl = quoteString(input.sourceUrl, "Source URL", 2000);
  if (sourceUrl) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new QuoteInputError("Source URL is invalid"); }
    if (!["https:", "http:"].includes(url.protocol)) throw new QuoteInputError("Source URL must use HTTP or HTTPS");
  }
  const areas = input.areas ?? [];
  if (!Array.isArray(areas) || areas.length > 6 || areas.some(area => !["health", "spirituality", "work", "finances", "home", "joy"].includes(area))) throw new QuoteInputError("Quote areas are invalid");
  const existing = await env.DB.prepare("SELECT * FROM quotes WHERE text = ? AND author = ? AND (origin = 'core' OR user_id = ?) ORDER BY origin = 'core' DESC LIMIT 1").bind(text, author, userId).first<QuoteRow>();
  if (existing) return setQuoteSaved(env, userId, existing.id, true);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO quotes(id, user_id, text, author, source, source_url, areas, origin, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, text, author) DO UPDATE SET saved_at = COALESCE(quotes.saved_at, excluded.saved_at), archived_at = NULL`).bind(id, userId, text, author, source, sourceUrl, JSON.stringify([...new Set(areas)]), origin, new Date().toISOString()).run();
  const row = await env.DB.prepare("SELECT * FROM quotes WHERE user_id = ? AND text = ? AND author = ?").bind(userId, text, author).first<QuoteRow>();
  return serializeQuote(row!, userId);
}

function quoteString(value: unknown, label: string, limit: number, required = false): string | null {
  if (value === undefined || value === null) { if (!required) return null; }
  if (typeof value !== "string" || value.trim().length > limit || (required && !value.trim())) throw new QuoteInputError(`${label} is invalid`);
  return value.trim() || null;
}

export async function getBriefingQuote(env: Env, userId: string, now = new Date()) {
  // Older callers/test fixtures may not yet have the additive Gratitude schema.
  try {
    const setting = await env.DB.prepare("SELECT quote_in_briefing FROM gratitude_settings WHERE user_id = ?").bind(userId).first<{ quote_in_briefing: number }>();
    if (setting?.quote_in_briefing === 0) return null;
    return await getTodayQuote(env, userId, now);
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return null;
    throw error;
  }
}

import { JournalInputError } from "./journal";
import { isRecord, parseJsonRecord } from "./workspace-input";
import type { Env } from "./types";

export const HOME_LAYOUT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS home_layout (
    user_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
    layout_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

const LISTS = ["order", "hidden", "pinned", "earned"] as const;
export type HomeLayout = Record<typeof LISTS[number], string[]>;
// Card ids stay open-ended so agent-built cards can join the same layout later.
const CARD_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function cardIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && CARD_ID.test(id)))] : [];
}

/** One Home layout per install, shared by web and the mobile apps. `layout` is null until a client first saves. */
export async function getHomeLayout(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT layout_json, updated_at FROM home_layout WHERE user_id = ?").bind(userId).first<{ layout_json: string; updated_at: string }>();
  if (!row) return { layout: null, updatedAt: null };
  const saved = parseJsonRecord(row.layout_json);
  return { layout: Object.fromEntries(LISTS.map(key => [key, cardIds(saved[key])])) as HomeLayout, updatedAt: row.updated_at };
}

export async function saveHomeLayout(env: Env, userId: string, input: unknown) {
  if (!isRecord(input)) throw new JournalInputError("A layout is required");
  for (const key of LISTS) {
    const value = input[key];
    if (value !== undefined && (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== "string" || !CARD_ID.test(id)))) throw new JournalInputError(`${key} must be a list of card ids`);
  }
  const layout = Object.fromEntries(LISTS.map(key => [key, cardIds(input[key])])) as HomeLayout;
  await env.DB.prepare(`INSERT INTO home_layout(user_id, layout_json, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at`).bind(userId, JSON.stringify(layout)).run();
  return getHomeLayout(env, userId);
}

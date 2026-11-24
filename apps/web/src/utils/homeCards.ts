// Custom Home cards (epic me3-c5h8): small declarative cards ME3 builds from chat (catalog me3/cards/v1).
// The install keeps habit and counter entries by day and formats live data; web draws the card natively,
// as iOS and Android do. Blocks are the surface's components and `state.blocks` its data model.
import type { HomeLayout } from "./homeSummary";

export type HomeCardBlock = {
  type: string;
  key?: string;
  label?: string;
  emoji?: string;
  perWeek?: number;
  unit?: string;
  step?: number;
  goal?: number;
  period?: "day" | "total";
  placeholder?: string;
  text?: string;
  source?: string;
  goalId?: string;
  limit?: number;
  empty?: string;
  prompt?: string;
};
export type HomeCardVersion = { version: number; name: string; emoji: string; summary: string; createdAt: string };
export type HomeCard = {
  id: string; name: string; emoji: string; version: number; blocks: HomeCardBlock[];
  createdBy: "agent" | "owner"; createdAt: string; updatedAt: string; history: HomeCardVersion[];
  access?: { sees: string[]; changes: string[] };
};
export type HomeCardListRow = { id: string; title: string; sub?: string; value?: string; tone?: string; check?: { on: boolean; taskId: string } };
export type HomeCardBlockState = {
  type: string;
  today?: boolean | number | string;
  streak?: number; longest?: number; thisWeek?: number; perWeek?: number | null; week?: (boolean | null)[]; dates?: string[];
  total?: number; goal?: number | null; done?: boolean;
  value?: string; label?: string; tone?: string; pct?: number; values?: number[]; labels?: string[]; rows?: HomeCardListRow[]; empty?: string;
};
export type HomeCardState = { date: string; blocks: Record<string, HomeCardBlockState>; done: number; total: number };
export type HomeCardRecord = { card: HomeCard; state: HomeCardState; surface?: unknown };
/** `offered`: ME3 can build new cards here. `sources`: the data this plan's cards may show (a free ME3 has fewer). */
export type HomeCardsResponse = { date: string; cards: HomeCardRecord[]; offered?: boolean; sources?: string[] };
/** One thing the owner did to a card: tick, add, set, or task.done on a tasks list. */
export type HomeCardRequest = { action: "tick" | "add" | "set" | "task.done"; key: string; on?: boolean; by?: number; value?: unknown; taskId?: string };

export const HOME_CARD_BLOCK_TYPES = new Set(["habit", "counter", "note", "text", "stat", "progress", "days", "list", "action"]);
const DATA_TYPES = new Set(["stat", "progress", "days", "list"]);
const INITIALS_SOURCES = new Set(["invoices.unpaid", "invoices.overdue", "enquiries.new"]);

/** A card from the install, or null when it can't be read. Blocks and rows from a newer ME3 are dropped, not fatal. */
export function readHomeCardRecord(value: unknown): HomeCardRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { card?: unknown; state?: unknown; surface?: unknown };
  const card = raw.card as Partial<HomeCard> | undefined;
  const state = raw.state as Partial<HomeCardState> | undefined;
  if (!card || typeof card !== "object" || typeof card.id !== "string" || typeof card.name !== "string" || !Array.isArray(card.blocks)) return null;
  if (!state || typeof state !== "object" || !state.blocks || typeof state.blocks !== "object") return null;
  const blocks = card.blocks.filter((block): block is HomeCardBlock => Boolean(block) && typeof block === "object" && HOME_CARD_BLOCK_TYPES.has((block as HomeCardBlock).type));
  return {
    card: { id: card.id, name: card.name, emoji: card.emoji || "✨", version: card.version ?? 1, blocks, createdBy: card.createdBy === "owner" ? "owner" : "agent",
      createdAt: card.createdAt || "", updatedAt: card.updatedAt || "", history: Array.isArray(card.history) ? card.history : [], ...(card.access ? { access: card.access } : {}) },
    state: { date: state.date || "", blocks: state.blocks as Record<string, HomeCardBlockState>, done: state.done ?? 0, total: state.total ?? 0 },
    ...(raw.surface ? { surface: raw.surface } : {}),
  };
}
export function readHomeCardsResponse(value: unknown): HomeCardsResponse {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<HomeCardsResponse>;
  const cards = Array.isArray(raw.cards) ? raw.cards.map(readHomeCardRecord).filter((record): record is HomeCardRecord => record !== null) : [];
  return { date: raw.date || "", cards, offered: raw.offered === true, ...(Array.isArray(raw.sources) ? { sources: raw.sources.filter((s): s is string => typeof s === "string") } : {}) };
}

/** Task ticks go through the card's A2UI action endpoint; the rest are the card's own entries. */
export function homeCardCall(cardId: string, request: HomeCardRequest): { path: string; body: Record<string, unknown> } {
  const base = `/home/cards/${encodeURIComponent(cardId)}`;
  if (request.action === "task.done") {
    return { path: `${base}/action`, body: { name: "task.done", sourceComponentId: request.key, context: { taskId: request.taskId, on: request.on ?? true } } };
  }
  const { taskId: _taskId, ...body } = request;
  return { path: `${base}/act`, body };
}

/** The card with one habit's tick or one task's tick flipped, shown before the install answers. */
export function optimisticHomeCard(record: HomeCardRecord, request: HomeCardRequest): HomeCardRecord {
  const block = record.state.blocks[request.key];
  if (!block) return record;
  let changed: HomeCardBlockState;
  if (request.action === "tick") changed = { ...block, today: request.on ?? true };
  else if (request.action === "task.done") changed = { ...block, rows: block.rows?.map(row => row.check && row.check.taskId === request.taskId ? { ...row, check: { ...row.check, on: request.on ?? true } } : row) };
  else return record;
  return { ...record, state: { ...record.state, blocks: { ...record.state.blocks, [request.key]: changed } } };
}

export const isDataBlock = (block: HomeCardBlock) => DATA_TYPES.has(block.type);
export const showsInitials = (block: HomeCardBlock) => INITIALS_SOURCES.has(block.source || "");
export const blockTitle = (block: HomeCardBlock) => [block.emoji, block.label].filter(Boolean).join(" ");
export function cardNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
export function habitSubtitle(state: HomeCardBlockState): string {
  if (state.perWeek != null) return `${state.thisWeek ?? 0} of ${state.perWeek} this week`;
  const streak = state.streak ?? 0;
  if (streak > 0) return `🔥 ${streak} ${streak === 1 ? "day" : "days"}`;
  if ((state.longest ?? 0) > 0) return `Longest ${state.longest}`;
  return "New";
}
export function counterValue(block: HomeCardBlock, state: HomeCardBlockState): number {
  return block.period === "total" ? state.total ?? 0 : typeof state.today === "number" ? state.today : 0;
}
export function counterSubtitle(block: HomeCardBlock, state: HomeCardBlockState): string {
  const value = counterValue(block, state);
  const unit = block.unit ? ` ${block.unit}` : "";
  const goal = state.goal ?? block.goal;
  return goal != null ? `${cardNumber(value)} of ${cardNumber(goal)}${unit}` : `${cardNumber(value)}${unit}`;
}
export function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map(word => word[0]!.toUpperCase()).join("");
}
/** Today's place in a Monday-start week, for the ring on the week dots. */
export function todayIndex(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}
export function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { day: "numeric", month: "short" });
}
export function madeLine(card: HomeCard): string {
  const by = card.createdBy === "agent" ? "Made by your ME3" : "Made by you";
  const date = shortDate(card.createdAt);
  return date ? `${by} · ${date}` : by;
}
/** What ME3 can do with this card from chat, from the block types it has. */
export function agentAbilities(card: HomeCard): string {
  const has = (type: string) => card.blocks.some(block => block.type === type);
  return [...(has("habit") ? ["tick"] : []), ...(has("counter") ? ["add"] : []), ...(has("note") ? ["write"] : []), has("habit") ? "read streaks" : "read"].join(", ");
}
export function dataLine(record: HomeCardRecord): string {
  const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;
  const count = (type: string) => record.card.blocks.filter(block => block.type === type).length;
  const parts: string[] = [];
  const ticks = Object.values(record.state.blocks).filter(state => state.type === "habit").reduce((sum, state) => sum + (state.dates?.length ?? 0), 0);
  if (count("habit")) parts.push(`${plural(count("habit"), "habit")} · ${plural(ticks, "tick")}`);
  if (count("counter")) parts.push(plural(count("counter"), "counter"));
  if (count("note")) parts.push(plural(count("note"), "note"));
  if (record.card.blocks.some(isDataBlock)) parts.push("Live from your ME3");
  return parts.length ? parts.join(" · ") : "Nothing yet";
}

// Add to Home → Custom card's ideas. An idea shows only when this plan can show every source it needs.
export type HomeCardIdea = { emoji: string; text: string; ask: string; needs: string[] };
/** What a free ME3 may show, for ME3s too old to say (`sources`). */
export const HOME_CARD_FREE_SOURCES = ["tasks", "reminders", "goal"];
export const HOME_CARD_IDEAS: HomeCardIdea[] = [
  { emoji: "💷", text: "Money goal for the month", ask: "Make me a Home card with money in today and my progress toward a monthly goal of ", needs: ["money.today", "money.month"] },
  { emoji: "🧾", text: "Who owes me money", ask: "Make me a Home card showing who still owes me money, with a button to remind the late ones.", needs: ["invoices.unpaid", "invoices.overdue"] },
  { emoji: "📅", text: "Bookings this week", ask: "Make me a Home card with my bookings this week and who's next.", needs: ["bookings.week"] },
  { emoji: "✉️", text: "New enquiries", ask: "Make me a Home card with new enquiries from my site.", needs: ["enquiries.new"] },
  { emoji: "🚀", text: "A goal with its tasks", ask: "Make me a Home card for my main goal with its tasks and next reminder.", needs: ["goal", "tasks", "reminders"] },
  { emoji: "✅", text: "Track my habits", ask: "Make me a habit tracker card for: ", needs: [] },
  { emoji: "💧", text: "Count something every day", ask: "Make me a Home card to count ", needs: [] },
];
/** Business ideas need data a free ME3 doesn't have. */
export const ideaIsBusiness = (idea: HomeCardIdea) => idea.needs.some(source => !HOME_CARD_FREE_SOURCES.includes(source));
export function homeCardIdeas(sources: string[] | undefined): HomeCardIdea[] {
  const allowed = new Set(sources ?? HOME_CARD_IDEAS.flatMap(idea => idea.needs));
  return HOME_CARD_IDEAS.filter(idea => idea.needs.every(source => allowed.has(source)));
}
/** What Make it sends: the owner's words, as a request for a Home card. Null when there are none. */
export function homeCardRequestText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("make me") ? trimmed : `Make me a Home card: ${trimmed}`;
}

// Home's slots: built-in cards and the owner's custom cards share the install's layout lists (ids), as on iOS and Android.
/** A custom card shows while pinned and not hidden. */
export function shownCustomCards(layout: HomeLayout, cards: HomeCardRecord[]): string[] {
  return cards.map(record => record.card.id).filter(id => layout.pinned.includes(id) && !layout.hidden.includes(id));
}
/** Home's panels in the install's order: built-ins keep their order, each pinned custom card sits at its place in it. */
export function homePanelOrder(layout: HomeLayout, builtIns: readonly string[], custom: readonly string[]): string[] {
  const shown = new Set([...builtIns, ...custom]);
  return [...new Set([...layout.order, ...builtIns, ...custom])].filter(id => shown.has(id));
}
/** Puts a custom card on Home after the ordered cards, or takes it off (hidden, so it stays off on iOS and Android too). */
export function withCustomCard(layout: HomeLayout, id: string, on: boolean): HomeLayout {
  return on
    ? { ...layout, order: layout.order.includes(id) ? layout.order : [...layout.order, id], pinned: [...layout.pinned.filter(item => item !== id), id], hidden: layout.hidden.filter(item => item !== id) }
    : { ...layout, pinned: layout.pinned.filter(item => item !== id), hidden: [...layout.hidden.filter(item => item !== id), id] };
}
/** A deleted card leaves the install's lists. */
export function withoutCustomCard(layout: HomeLayout, id: string): HomeLayout {
  const drop = (list: string[]) => list.filter(item => item !== id);
  return { order: drop(layout.order), hidden: drop(layout.hidden), pinned: drop(layout.pinned), earned: drop(layout.earned) };
}

/** The card ME3 built or changed this turn, from a core_cards_create or core_cards_update tool result. */
export const HOME_CARD_TOOLS = new Set(["core_cards_create", "core_cards_update"]);
export function homeCardFromTool(toolName: unknown, result: unknown): { record: HomeCardRecord; isUpdate: boolean } | null {
  if (!HOME_CARD_TOOLS.has(String(toolName))) return null;
  const outcome = result as { status?: unknown; data?: unknown } | undefined;
  if (outcome?.status !== "ok") return null;
  const record = readHomeCardRecord(outcome.data);
  return record ? { record, isUpdate: toolName === "core_cards_update" } : null;
}

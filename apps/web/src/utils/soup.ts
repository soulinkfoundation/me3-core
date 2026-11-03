// The Human Soup on web (me3-ydf4.4): shared types and small helpers for the Home card and the chat bowl.
import type { UiIconName } from "./icons";
export const SOUP_SERVE_TOOL = "core_soup_serve";

export type SoupMedium = "watch" | "listen" | "read";
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
  forYou: string | null;
  state: "served" | "opened" | "finished" | "liked" | "disliked" | "later";
  alternate?: boolean;
};
export type SoupServing = {
  id: string;
  servingId: string;
  kind: "headlines" | "pick";
  title: string;
  status: "pending" | "open" | "done" | "expired" | "failed";
  dueAt: string;
  expiresAt: string;
  openedAt: string | null;
  finishedAt: string | null;
  items: SoupServingItem[];
  fallback?: boolean;
};
export type SoupToday = { setUp: boolean; servings: SoupServing[]; servingSpecs: Array<{ id: string; name: string; time: string; kind: "headlines" | "pick" }> };
export type SoupServingAction = "open" | "finish" | "like" | "dislike" | "later" | "dismiss";

/** The serving id a core_soup_serve result points at, or null when nothing was served. */
export function soupServingIdFromTool(data: unknown): string | null {
  const row = data && typeof data === "object" ? data as { served?: unknown; servingId?: unknown } : null;
  return row?.served === true && typeof row.servingId === "string" ? row.servingId : null;
}

/** The main pick and the extra picks under it. */
export function soupPick(serving: Pick<SoupServing, "items">): { pick: SoupServingItem | null; also: SoupServingItem[] } {
  const pick = serving.items.find(item => !item.alternate) ?? serving.items[0] ?? null;
  return { pick, also: serving.items.filter(item => item !== pick) };
}

export function soupActionLabel(medium: SoupMedium): string {
  return medium === "listen" ? "Listen" : medium === "read" ? "Read" : "Watch";
}

export function soupActionIcon(medium: SoupMedium): UiIconName {
  return (medium === "listen" ? "Headphones" : medium === "read" ? "BookOpen" : "Play") as UiIconName;
}

/** When the serving was for: its local time, or "You asked" for a bowl from chat. */
export function soupWhenLabel(serving: Pick<SoupServing, "servingId" | "dueAt">, locale?: string): string {
  if (serving.servingId.startsWith("ask-")) return "You asked";
  const date = new Date(serving.dueAt);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}

export const soupHadIt = (item: Pick<SoupServingItem, "state">) => ["finished", "liked", "disliked"].includes(item.state);

export type HomeTask = {
  id: string; title: string; status?: string; priority?: number | null;
  dueAt?: string | null; scheduledFor?: string | null; updatedAt?: string | null; archivedAt?: string | null;
};
export const HOME_CARDS = ["today", "inbox", "tasks", "accounts", "journal", "goals", "wheel", "mission", "files"] as const;
export type HomeCard = typeof HOME_CARDS[number];
export type HomeLayout = { order: string[]; hidden: string[]; pinned: string[]; earned: string[] };
export const emptyHomeLayout = (): HomeLayout => ({ order: [], hidden: [], pinned: [], earned: [] });
export function visibleHomeCards(layout: HomeLayout): HomeCard[] {
  return [...new Set([...layout.order, ...HOME_CARDS])].filter((id): id is HomeCard =>
    HOME_CARDS.includes(id as HomeCard) && !layout.hidden.includes(id) &&
    (id === "today" || id === "inbox" || layout.pinned.includes(id) || layout.earned.includes(id)),
  );
}
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function taskTimestamp(value: string): string {
  // D1 timestamps are UTC, including the space-separated updatedAt returned by tasks.
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}
function taskDate(value?: string | null): number {
  if (!value) return Infinity;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : taskTimestamp(value));
  return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
}
export function homeOpenTasks(tasks: HomeTask[], now = new Date()): HomeTask[] {
  const end = new Date(now); end.setHours(24, 0, 0, 0);
  const date = (t: HomeTask) => Math.min(taskDate(t.dueAt), taskDate(t.scheduledFor));
  return tasks.filter(t => !t.archivedAt && !["done", "cancelled", "canceled", "archived"].includes((t.status || "").toLowerCase()))
    .sort((a, b) => Number(date(a) >= end.getTime()) - Number(date(b) >= end.getTime()) ||
      (date(a) === date(b) ? 0 : date(a) - date(b)) || (a.priority ?? 2) - (b.priority ?? 2) || a.id.localeCompare(b.id));
}
export function homeDoneToday(tasks: HomeTask[], now = new Date()): number {
  // The task contract has updatedAt rather than completedAt; match the native Home summary.
  return tasks.filter(t => !t.archivedAt && t.status === "done" && t.updatedAt && localDateKey(new Date(taskTimestamp(t.updatedAt))) === localDateKey(now)).length;
}
export function homeDateLabel(value: string, now = new Date(), locale?: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Journal entry";
  if (localDateKey(date) === localDateKey(now)) return "Today";
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(date).replace(/,/g, "");
}
export function journalPreview(raw: string): string {
  const plain = raw.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, url => /[.!?]$/.test(url) ? url.slice(-1) : "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?(?:\[[ xX]\]\s*)?/gm, "")
    .replace(/[*_`~]/g, "").replace(/\s+/g, " ").replace(/\s+([.!?,])/g, "$1").trim();
  return plain.match(/^.*?[.!?](?=\s|$)/)?.[0] || plain || "No text yet";
}

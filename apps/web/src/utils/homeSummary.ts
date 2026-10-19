export type HomeTask = {
  id: string; title: string; status?: string; priority?: number | null;
  dueAt?: string | null; scheduledFor?: string | null; updatedAt?: string | null; archivedAt?: string | null;
  goalId?: string | null; projectId?: string | null;
};
export type HomeGoal = { id: string; title: string; status: "active" | "completed"; areaId?: string | null; progress?: number; taskIds?: string[]; projectIds?: string[] };
// Files lives in the avatar menu, Wheel and Goals live in Mission, and tasks and writing live on the Journal day page.
export const HOME_CARDS = ["today", "people", "gratitude", "inbox", "mission", "accounts"] as const;
export type HomeCard = typeof HOME_CARDS[number];
export type HomeLayout = { order: string[]; hidden: string[]; pinned: string[]; earned: string[] };
export const emptyHomeLayout = (): HomeLayout => ({ order: [], hidden: [], pinned: [], earned: [] });
export function visibleHomeCards(layout: HomeLayout): HomeCard[] {
  return [...new Set([...layout.order, ...HOME_CARDS])].filter((id): id is HomeCard =>
    HOME_CARDS.includes(id as HomeCard) && !layout.hidden.includes(id) &&
    // Today holds the day (calendar, tasks, notes, optional gratitude); other cards are opt-in.
    (HOME_DEFAULT_CARDS.includes(id as HomeCard) || layout.pinned.includes(id) || layout.earned.includes(id)),
  ).filter(id => !HOME_INSIDE_TODAY.includes(id));
}
export const HOME_DEFAULT_CARDS: HomeCard[] = ["today", "people", "accounts"];
// Gratitude is a section of the Today card, switched on from its menu (server setting inToday), never a card of its own.
export const HOME_INSIDE_TODAY: HomeCard[] = ["gratitude"];
// The focus goal is the first active goal; making a goal the focus moves it to the front of the list.
export function focusGoal<T extends Pick<HomeGoal, "status">>(goals: T[]): T | null {
  return goals.find(goal => goal.status !== "completed") || null;
}
export function goalsWithFocus<T extends Pick<HomeGoal, "id">>(goals: T[], id: string): T[] {
  const goal = goals.find(item => item.id === id);
  return goal ? [goal, ...goals.filter(item => item.id !== id)] : goals;
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
// Today's list: tasks in Now, plus anything due or scheduled today or earlier. Backlog without a date stays in Tasks.
export function homeTodayTasks(tasks: HomeTask[], now = new Date()): HomeTask[] {
  const end = new Date(now); end.setHours(24, 0, 0, 0);
  return homeOpenTasks(tasks, now).filter(t => t.status === "in_progress" || Math.min(taskDate(t.dueAt), taskDate(t.scheduledFor)) < end.getTime());
}
export function homeDoneToday(tasks: HomeTask[], now = new Date()): number {
  // The task contract has updatedAt rather than completedAt; match the native Home summary.
  return tasks.filter(t => !t.archivedAt && t.status === "done" && t.updatedAt && localDateKey(new Date(taskTimestamp(t.updatedAt))) === localDateKey(now)).length;
}
export function homeGoalTasks(tasks: HomeTask[], goal: Pick<HomeGoal, "id" | "taskIds" | "projectIds">): HomeTask[] {
  return homeOpenTasks(tasks.filter(task => task.goalId === goal.id || goal.taskIds?.includes(task.id) || (task.projectId && goal.projectIds?.includes(task.projectId))));
}
export function homeDateLabel(value: string, now = new Date(), locale?: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Journal entry";
  if (localDateKey(date) === localDateKey(now)) return "Today";
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(date).replace(/,/g, "");
}
const TAG = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
const BLOCK_TAG = /^(p|div|li|ul|ol|br|h[1-6]|blockquote|pre|tr)$/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    const key = name.toLowerCase();
    if (key.startsWith("#")) { const code = key[1] === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1)); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match; }
    return ENTITIES[key] ?? match;
  });
}
// Bodies can hold escaped (even double-escaped) markup, so strip and decode until nothing changes.
function plainText(raw: string): string {
  const strip = (text: string) => text.replace(TAG, (_, name: string) => BLOCK_TAG.test(name) ? "\n" : "");
  let text = raw;
  for (let pass = 0; pass < 5; pass++) {
    const next = decodeEntities(strip(text));
    if (next === text) break;
    text = next;
  }
  return strip(text)
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, url => /[.!?]$/.test(url) ? url.slice(-1) : "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?(?:\[[ xX]\]\s*)?/gm, "")
    .replace(/[*_`~]/g, "").replace(/\s+/g, " ").replace(/\s+([.!?,])/g, "$1").trim();
}
/** Plain text for list rows such as the Library: never markup, at most 180 characters. */
export function plainPreview(raw: string): string {
  return plainText(raw).slice(0, 180);
}
export function journalPreview(raw: string): string {
  const plain = plainText(raw);
  return plain.match(/^.*?[.!?](?=\s|$)/)?.[0] || plain || "No text yet";
}

import { addDaysToDateString } from "@me3-core/plugin-calendar";
import { listPendingAgentReminders, readBookingsInRangeForAgent } from "@me3-core/plugin-agent-chat";
import { getFinancialStats, listFinancialEntries } from "./accounts";
import { getDefaultCommerceCurrency } from "./commerce-settings";
import { getGoals } from "./goals";
import { getMissionTaskDetail, listMissionTasks } from "./mission-control";
import { SITE_ENQUIRY_PROVIDER_ID } from "./site-enquiry-source";
import type { Env } from "./types";

/**
 * Live data for custom Home cards. A data block names a source; the card shows
 * only what its sources allow (its grants) and every value is read fresh from
 * the install. Formatting happens here so every client draws the same text.
 */
export const HOME_CARD_SOURCES = ["bookings.week", "money.today", "money.month", "invoices.unpaid", "invoices.overdue", "enquiries.new", "tasks", "reminders", "goal"] as const;
export type HomeCardSource = typeof HOME_CARD_SOURCES[number];
export type HomeCardDataBlockType = "stat" | "progress" | "days" | "list";

/** Which blocks can show which sources. Anything else is rejected when the card is saved. */
export const HOME_CARD_SOURCE_BLOCKS: Record<HomeCardDataBlockType, readonly HomeCardSource[]> = {
  stat: ["bookings.week", "money.today", "money.month", "invoices.unpaid", "invoices.overdue", "enquiries.new", "tasks", "goal"],
  progress: ["money.month", "goal"],
  days: ["bookings.week"],
  list: ["bookings.week", "invoices.unpaid", "invoices.overdue", "enquiries.new", "tasks", "reminders"],
};

/** What the owner sees on the card's About sheet: what it can read, and whether it can change anything. */
export const HOME_CARD_SOURCE_ACCESS: Record<HomeCardSource, string> = {
  "bookings.week": "Bookings",
  "money.today": "Payments",
  "money.month": "Payments",
  "invoices.unpaid": "Unpaid invoices",
  "invoices.overdue": "Unpaid invoices",
  "enquiries.new": "Enquiries",
  tasks: "Tasks",
  reminders: "Reminders",
  goal: "Goals",
};

export type HomeCardDataBlock =
  | { type: "stat"; key: string; source: HomeCardSource; label?: string; goalId?: string }
  | { type: "progress"; key: string; source: HomeCardSource; label?: string; goal?: number; goalId?: string }
  | { type: "days"; key: string; source: HomeCardSource }
  | { type: "list"; key: string; source: HomeCardSource; limit?: number; goalId?: string; empty?: string };

export type HomeCardListRow = { id: string; title: string; sub?: string; value?: string; tone?: "late"; check?: { on: boolean; taskId: string } };
export type HomeCardDataState =
  | { type: "stat"; value: string; label: string; tone?: "late" }
  | { type: "progress"; pct: number; label: string }
  | { type: "days"; values: number[]; labels: string[]; today: number }
  | { type: "list"; rows: HomeCardListRow[]; empty: string };

export type HomeCardBooking = { startsAt: string; guestName: string; durationMinutes: number; paid: boolean };
export type HomeCardInvoice = { id: string; customer: string; amountCents: number; currency: string; date: string; overdue: boolean };
export type HomeCardEnquiry = { id: string; name: string; about: string; receivedAt: string };
export type HomeCardTask = { id: string; title: string; done: boolean; dueAt: string | null; goalId: string | null };
export type HomeCardReminder = { id: string; title: string; remindAt: string };
export type HomeCardGoal = { id: string; title: string; progress: number; taskCount: number };

/** Reads from the install. Swapped for fakes in tests. */
export type HomeCardLoaders = {
  timezone: string;
  today: string;
  now: Date;
  currency(): Promise<string>;
  bookings(dateFrom: string, dateTo: string): Promise<HomeCardBooking[]>;
  moneyToday(currency: string): Promise<number>;
  moneyMonth(currency: string): Promise<number>;
  invoices(): Promise<HomeCardInvoice[]>;
  enquiries(since: string): Promise<HomeCardEnquiry[]>;
  tasks(goalId?: string): Promise<HomeCardTask[]>;
  reminders(limit: number): Promise<HomeCardReminder[]>;
  goal(goalId?: string): Promise<HomeCardGoal | null>;
};

const memo = <T>(fn: () => Promise<T>) => { let value: Promise<T> | null = null; return () => (value ??= fn()); };
const settledTotal = (totals: { currency: string; amountCents: number }[] | undefined, currency: string) => (totals || []).find(total => total.currency?.toUpperCase() === currency.toUpperCase())?.amountCents ?? 0;

export function createHomeCardLoaders(env: Env, userId: string, clock: { timezone: string; date: string }, now = new Date()): HomeCardLoaders {
  const currency = memo(() => getDefaultCommerceCurrency(env, userId));
  const invoices = memo(async () => {
    const rows: HomeCardInvoice[] = [];
    for (const status of ["overdue", "pending"] as const) {
      const page = await listFinancialEntries(env, userId, new URLSearchParams({ entryType: "income", status, limit: "50" })) as { entries: { id: string; customerName: string | null; description: string | null; amountCents: number; currency: string; date: string }[] };
      for (const entry of page.entries || []) rows.push({ id: entry.id, customer: entry.customerName || entry.description || "Unnamed", amountCents: entry.amountCents, currency: entry.currency, date: entry.date, overdue: status === "overdue" });
    }
    return rows;
  });
  const goals = memo(() => getGoals(env, userId));
  const taskCache = new Map<string, Promise<HomeCardTask[]>>();
  return {
    timezone: clock.timezone,
    today: clock.date,
    now,
    currency,
    async bookings(dateFrom, dateTo) {
      const rows = await readBookingsInRangeForAgent(env.DB, userId, { dateFrom, dateTo, timezone: clock.timezone });
      return rows.map(row => ({ startsAt: row.startsAt, guestName: row.guestName, durationMinutes: row.durationMinutes, paid: row.paymentStatus === "paid" || row.paymentStatus === "succeeded" }));
    },
    async moneyToday(code) {
      const page = await listFinancialEntries(env, userId, new URLSearchParams({ entryType: "income", status: "paid", dateFrom: clock.date, dateTo: clock.date, totals: "1", limit: "1" })) as { totals?: { currency: string; amountCents: number }[] };
      return settledTotal(page.totals, code);
    },
    async moneyMonth(code) {
      const { stats } = await getFinancialStats(env, userId, "income") as { stats: { thisMonthCents: number; thisMonthTotals?: { currency: string; amountCents: number }[] } };
      return stats.thisMonthTotals?.length ? settledTotal(stats.thisMonthTotals, code) : stats.thisMonthCents || 0;
    },
    invoices,
    async enquiries(since) {
      const rows = await env.DB.prepare(
        `SELECT id, from_address, subject, COALESCE(received_at, created_at) AS received_at FROM mailbox_messages
         WHERE provider_id = ? AND direction = 'inbound' AND folder IN ('inbox', 'archive') AND COALESCE(received_at, created_at) >= ?
         ORDER BY COALESCE(received_at, created_at) DESC LIMIT 20`,
      ).bind(SITE_ENQUIRY_PROVIDER_ID, since).all<{ id: string; from_address: string | null; subject: string | null; received_at: string }>();
      return (rows.results || []).map(row => ({ id: row.id, name: senderName(row.from_address), about: (row.subject || "").replace(/^Enquiry:?\s*/i, "").trim(), receivedAt: row.received_at }));
    },
    tasks(goalId) {
      const key = goalId || "";
      if (!taskCache.has(key)) taskCache.set(key, (async () => {
        const tasks = await listMissionTasks(env, userId, { ...(goalId ? { goalId } : {}), limit: 100 }) as { id: string; title: string; status: string; dueAt: string | null; goalId: string | null; archivedAt: string | null }[];
        return tasks.filter(task => task.status !== "cancelled" && !task.archivedAt).map(task => ({ id: task.id, title: task.title, done: task.status === "done", dueAt: task.dueAt, goalId: task.goalId }));
      })());
      return taskCache.get(key)!;
    },
    async reminders(limit) {
      const rows = await listPendingAgentReminders({ DB: env.DB }, userId, { limit });
      return rows.map(row => ({ id: row.id, title: row.title, remindAt: row.remindAt }));
    },
    async goal(goalId) {
      const { goals: list } = await goals() as { goals: { id: string; title: string; status: string; progress: number; taskIds: string[] }[] };
      const goal = goalId ? list.find(item => item.id === goalId) : list.find(item => item.status === "active");
      return goal ? { id: goal.id, title: goal.title, progress: goal.progress, taskCount: goal.taskIds.length } : null;
    },
  };
}

/** Checks a task-tick from a card: the task must exist and belong to the card's goal, if it has one. */
export async function homeCardTaskBelongs(env: Env, userId: string, taskId: string, goalId?: string): Promise<boolean> {
  try {
    const { task } = await getMissionTaskDetail(env, userId, taskId) as { task: { goalId: string | null } };
    return !goalId || task.goalId === goalId;
  } catch {
    return false;
  }
}

function senderName(from: string | null): string {
  if (!from) return "Someone";
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named?.[1]?.trim()) return named[1].trim();
  return from.replace(/[<>]/g, "").split("@")[0] || "Someone";
}

export function formatMoney(minor: number, currency: string): string {
  const code = (currency || "USD").toUpperCase();
  try {
    const exponent = new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    const major = minor / 10 ** exponent;
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, maximumFractionDigits: Number.isInteger(major) ? 0 : exponent, minimumFractionDigits: Number.isInteger(major) ? 0 : exponent }).format(major);
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function mondayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDaysToDateString(date, -((weekday + 6) % 7));
}

function localParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}`, weekday: part("weekday") };
}

/** "Today 10:00", "Tomorrow 09:30", "Thu 14:00" or "3 Dec 14:00" in the owner's zone. */
function when(iso: string, loaders: HomeCardLoaders): string {
  const local = localParts(iso, loaders.timezone);
  if (local.date === loaders.today) return `Today ${local.time}`;
  if (local.date === addDaysToDateString(loaders.today, 1)) return `Tomorrow ${local.time}`;
  if (local.date > loaders.today && local.date <= addDaysToDateString(loaders.today, 6)) return `${local.weekday} ${local.time}`;
  return `${shortDate(local.date)} ${local.time}`;
}

function shortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function ago(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Resolves one data block. A source that fails shows as empty rather than breaking the card. */
export async function homeCardDataState(block: HomeCardDataBlock, loaders: HomeCardLoaders): Promise<HomeCardDataState> {
  try {
    return await resolve(block, loaders);
  } catch {
    if (block.type === "list") return { type: "list", rows: [], empty: "Can’t load this right now." };
    if (block.type === "days") return { type: "days", values: [0, 0, 0, 0, 0, 0, 0], labels: DAY_LABELS, today: 0 };
    if (block.type === "progress") return { type: "progress", pct: 0, label: "Can’t load this right now." };
    return { type: "stat", value: "–", label: block.label || "Can’t load this right now." };
  }
}

async function resolve(block: HomeCardDataBlock, loaders: HomeCardLoaders): Promise<HomeCardDataState> {
  const limit = block.type === "list" ? block.limit ?? 3 : 3;
  const label = (fallback: string) => ("label" in block && block.label) || fallback;
  switch (block.source) {
    case "bookings.week": {
      const monday = mondayOf(loaders.today);
      const bookings = await loaders.bookings(monday, addDaysToDateString(monday, 6));
      if (block.type === "days") {
        const values = [0, 0, 0, 0, 0, 0, 0];
        for (const booking of bookings) {
          const day = localParts(booking.startsAt, loaders.timezone).date;
          for (let i = 0; i < 7; i++) if (addDaysToDateString(monday, i) === day) values[i]++;
        }
        const today = Array.from({ length: 7 }, (_, i) => addDaysToDateString(monday, i)).indexOf(loaders.today);
        return { type: "days", values, labels: DAY_LABELS, today };
      }
      if (block.type === "list") {
        const upcoming = bookings.filter(booking => Date.parse(booking.startsAt) >= loaders.now.getTime()).slice(0, limit);
        return { type: "list", empty: block.empty || "Nothing else booked this week.", rows: upcoming.map((booking, i) => ({ id: `booking-${i}`, title: `${when(booking.startsAt, loaders)} · ${booking.guestName}`, sub: `${booking.durationMinutes} min${booking.paid ? " · paid" : ""}` })) };
      }
      return { type: "stat", value: String(bookings.length), label: label(bookings.length === 1 ? "booking this week" : "booked this week") };
    }
    case "money.today": {
      const currency = await loaders.currency();
      return { type: "stat", value: formatMoney(await loaders.moneyToday(currency), currency), label: label("in today") };
    }
    case "money.month": {
      const currency = await loaders.currency();
      const total = await loaders.moneyMonth(currency);
      const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${loaders.today}T12:00:00Z`));
      if (block.type === "progress") {
        const goalMinor = Math.round((block.goal ?? 0) * 100);
        const pct = goalMinor > 0 ? Math.min(100, Math.round(total / goalMinor * 100)) : 0;
        return { type: "progress", pct, label: label(`${formatMoney(total, currency)} of your ${formatMoney(goalMinor, currency)} goal for ${monthName}`) };
      }
      return { type: "stat", value: formatMoney(total, currency), label: label(`in ${monthName}`) };
    }
    case "invoices.unpaid":
    case "invoices.overdue": {
      const all = await loaders.invoices();
      const rows = block.source === "invoices.overdue" ? all.filter(invoice => invoice.overdue) : all;
      const currency = await loaders.currency();
      if (block.type === "list") {
        return { type: "list", empty: block.empty || (block.source === "invoices.overdue" ? "Nothing overdue." : "Everyone has paid."), rows: rows.slice(0, limit).map(invoice => ({
          id: invoice.id, title: invoice.customer, sub: invoice.overdue ? `Overdue · ${shortDate(invoice.date)}` : `Sent ${shortDate(invoice.date)}`, value: formatMoney(invoice.amountCents, invoice.currency), ...(invoice.overdue ? { tone: "late" as const } : {}),
        })) };
      }
      const total = rows.filter(invoice => invoice.currency.toUpperCase() === currency.toUpperCase()).reduce((sum, invoice) => sum + invoice.amountCents, 0);
      return { type: "stat", value: formatMoney(total, currency), label: label(`${block.source === "invoices.overdue" ? "overdue" : "unpaid"} · ${plural(rows.length, "invoice")}`), ...(block.source === "invoices.overdue" && rows.length ? { tone: "late" as const } : {}) };
    }
    case "enquiries.new": {
      const since = new Date(loaders.now.getTime() - 7 * 86_400_000).toISOString();
      const rows = await loaders.enquiries(since);
      if (block.type === "list") {
        return { type: "list", empty: block.empty || "No new enquiries this week.", rows: rows.slice(0, limit).map(row => ({ id: row.id, title: row.name, sub: [row.about, ago(row.receivedAt, loaders.now)].filter(Boolean).join(" · ") })) };
      }
      return { type: "stat", value: String(rows.length), label: label(rows.length === 1 ? "new enquiry this week" : "new enquiries this week") };
    }
    case "tasks": {
      const tasks = await loaders.tasks(block.type === "list" || block.type === "stat" ? block.goalId : undefined);
      const open = tasks.filter(task => !task.done);
      if (block.type === "list") {
        const doneToday = tasks.filter(task => task.done);
        const shown = [...open.slice(0, limit), ...doneToday.slice(0, Math.max(0, limit - open.length))];
        return { type: "list", empty: block.empty || "Nothing to do. Nice.", rows: shown.map(task => ({ id: task.id, title: task.title, ...(task.dueAt ? { sub: `Due ${when(task.dueAt, loaders)}` } : {}), check: { on: task.done, taskId: task.id } })) };
      }
      return { type: "stat", value: String(open.length), label: label(open.length === 1 ? "task open" : "tasks open") };
    }
    case "reminders": {
      const rows = await loaders.reminders(limit);
      return { type: "list", empty: block.type === "list" && block.empty ? block.empty : "No reminders coming up.", rows: rows.map(row => ({ id: row.id, title: row.title, sub: when(row.remindAt, loaders) })) };
    }
    case "goal": {
      const goal = await loaders.goal("goalId" in block ? block.goalId : undefined);
      if (!goal) return block.type === "progress" ? { type: "progress", pct: 0, label: "No goal set yet." } : { type: "stat", value: "–", label: "No goal set yet." };
      if (block.type === "progress") return { type: "progress", pct: Math.max(0, Math.min(100, Math.round(goal.progress))), label: label(`${Math.round(goal.progress)}% · ${goal.title}`) };
      return { type: "stat", value: `${Math.round(goal.progress)}%`, label: label(goal.title) };
    }
  }
}

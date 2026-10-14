import type { Env } from "./types";
import { getBriefingQuote } from "./quotes";

const DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE = "{{calendar.summary}}\n\n{{calendar.events}}\n{{calendar.reminders}}\n{{mission.tasks}}\n\n{{quote.today}}\n\nI'll keep an eye on the day from here.";

type DailyBriefingReminderRow = {
  id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  timezone: string | null;
  status: string;
};

type DailyBriefingRenderContext = {
  ownerName: string;
  dateKey: string;
  dateLabel: string;
  calendarSummary: string;
  calendarEvents: string;
  calendarReminders: string;
  missionTasks: string;
  quote: string;
  sections: DailyBriefingSection[];
};

type DailyBriefingSection = {
  kind: "calendar" | "reminders" | "tasks";
  title: string;
  summary: string;
  items: Array<{
    id: string;
    title: string;
    detail: string | null;
  }>;
};

type OwnerProfileContextRow = {
  id: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  timezone: string | null;
};

type MissionTaskContextRow = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  scheduled_for: string | null;
  source_ref: string | null;
  updated_at: string;
};

type CalendarEventContextRow = {
  id: string;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  created_at: string;
  updated_at: string | null;
};

type DailyBriefingBookingRow = {
  id: string;
  guest_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  created_at: string;
  updated_at: string | null;
};

type DailyBriefingTask = { id: string; title: string; description: string; dueAt: string | null };

async function buildDailyBriefingRenderContext(
  env: Env,
  userId: string,
): Promise<DailyBriefingRenderContext> {
  const owner = await env.DB.prepare(
    "SELECT id, name, username, bio, timezone FROM owner_profile WHERE id = ?",
  )
    .bind(userId)
    .first<OwnerProfileContextRow>()
    .catch(() => null);
  const timezone = owner?.timezone || "UTC";
  const now = new Date();
  const dateKey = dateKeyInTimezone(now, timezone);
  const dateLabel = formatFriendlyDate(dateKey, timezone);
  const { start, end } = utcWindowForLocalDate(dateKey, timezone);
  const [events, bookings, reminders, tasks, quote] = await Promise.all([
    loadDailyBriefingEvents(env, userId, start, end),
    loadDailyBriefingBookings(env, userId, start, end, timezone),
    loadDailyBriefingReminders(env, userId, start, end),
    loadDailyBriefingTasks(env, userId),
    getBriefingQuote(env, userId, now),
  ]);
  const calendarEvents = [...events, ...bookings].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return {
    ownerName: owner?.name || owner?.username || "there",
    dateKey,
    dateLabel,
    calendarSummary: formatDailyCalendarSummary(calendarEvents, dateLabel),
    calendarEvents: formatDailyCalendarEvents(calendarEvents, timezone),
    calendarReminders: formatDailyReminders(reminders, timezone),
    missionTasks: formatDailyTasks(tasks, dateKey),
    quote: quote ? `“${quote.text}”${quote.author ? `\n— ${quote.author}` : ""}` : "",
    sections: buildDailyBriefingSections(
      calendarEvents,
      reminders,
      tasks,
      dateKey,
      dateLabel,
      timezone,
    ),
  };
}

function buildDailyBriefingSections(
  events: CalendarEventContextRow[],
  reminders: DailyBriefingReminderRow[],
  tasks: DailyBriefingTask[],
  dateKey: string,
  dateLabel: string,
  fallbackTimezone: string,
): DailyBriefingSection[] {
  const dueTasks = tasks.filter((task) => task.dueAt?.slice(0, 10) === dateKey);
  return [
    {
      kind: "calendar",
      title: "Calendar",
      summary: formatDailyCalendarSummary(events, dateLabel),
      items: events.slice(0, 4).map((event) => ({
        id: event.id,
        title: event.title,
        detail: formatTimeInTimezone(event.starts_at, event.timezone || fallbackTimezone),
      })),
    },
    {
      kind: "reminders",
      title: "Reminders",
      summary: reminders.length === 0
        ? "No reminders due today."
        : `${reminders.length} reminder${reminders.length === 1 ? "" : "s"} due today.`,
      items: reminders.slice(0, 4).map((reminder) => ({
        id: reminder.id,
        title: reminder.title,
        detail: formatTimeInTimezone(
          reminder.remind_at,
          reminder.timezone || fallbackTimezone,
        ),
      })),
    },
    {
      kind: "tasks",
      title: "Tasks",
      summary: dueTasks.length === 0
        ? "No tasks due today."
        : `${dueTasks.length} task${dueTasks.length === 1 ? "" : "s"} due today.`,
      items: dueTasks.slice(0, 4).map((task) => ({
        id: task.id,
        title: task.title,
        detail: formatDailyBriefingTaskDetail(task.description),
      })),
    },
  ];
}

function renderDailyBriefingMessage(context: DailyBriefingRenderContext, template: string) {
  const values: Record<string, string> = {
    "owner.name": context.ownerName,
    "today.date": context.dateLabel,
    "calendar.summary": context.calendarSummary,
    "calendar.events": context.calendarEvents,
    "calendar.reminders": context.calendarReminders,
    "mission.tasks": context.missionTasks,
    "quote.today": context.quote,
  };
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
  return rendered
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function getLiveDailyBriefing(env: Env, userId: string) {
  const context = await buildDailyBriefingRenderContext(env, userId);
  const message = renderDailyBriefingMessage(
    context,
    DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE,
  );
  return {
    id: `live:${context.dateKey}`,
    title: `Daily Briefing: ${context.dateLabel}`,
    version: 1,
    message,
    plainText: message,
    date: context.dateKey,
    sections: context.sections,
    createdAt: new Date().toISOString(),
    status: "live",
    relatedId: null,
  };
}

async function loadDailyBriefingEvents(
  env: Env,
  userId: string,
  start: string,
  end: string,
) {
  const rows = await env.DB.prepare(
    `SELECT id, title, notes, starts_at, ends_at, timezone, created_at, updated_at
     FROM user_calendar_events
     WHERE user_id = ? AND starts_at < ? AND ends_at > ?
     ORDER BY starts_at ASC
     LIMIT 12`,
  )
    .bind(userId, end, start)
    .all<CalendarEventContextRow>()
    .catch(() => ({ results: [] as CalendarEventContextRow[] }));
  return (rows.results || []).filter((event) => event.starts_at < end && event.ends_at > start);
}

async function loadDailyBriefingBookings(
  env: Env,
  userId: string,
  start: string,
  end: string,
  timezone: string,
) {
  const rows = await env.DB.prepare(
    `SELECT b.id, b.guest_name, b.starts_at, b.ends_at, b.created_at, b.cancelled_at AS updated_at
     FROM bookings b
     JOIN sites s ON b.site_id = s.id
     WHERE s.user_id = ? AND b.status = 'confirmed'
       AND b.starts_at < ? AND b.ends_at > ?
     ORDER BY b.starts_at ASC
     LIMIT 12`,
  )
    .bind(userId, end, start)
    .all<DailyBriefingBookingRow>()
    .catch(() => ({ results: [] as DailyBriefingBookingRow[] }));

  return (rows.results || [])
    .filter((booking) => booking.starts_at < end && booking.ends_at > start)
    .map((booking): CalendarEventContextRow => ({
      id: `booking:${booking.id}`,
      title: `Booking with ${booking.guest_name}`,
      notes: null,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      timezone,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
    }));
}

async function loadDailyBriefingReminders(
  env: Env,
  userId: string,
  start: string,
  end: string,
) {
  const rows = await env.DB.prepare(
    `SELECT id, title, notes, remind_at, timezone, status
     FROM user_reminders
     WHERE user_id = ? AND status = 'pending' AND remind_at >= ? AND remind_at < ?
       AND (context_type IS NULL OR context_type != 'card')
     ORDER BY remind_at ASC
     LIMIT 12`,
  )
    .bind(userId, start, end)
    .all<DailyBriefingReminderRow>()
    .catch(() => ({ results: [] as DailyBriefingReminderRow[] }));
  return (rows.results || []).filter(
    (reminder) => reminder.status === "pending" && reminder.remind_at >= start && reminder.remind_at < end,
  );
}

async function loadDailyBriefingTasks(env: Env, userId: string) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, project_id, title, description, status, due_at, scheduled_for,
              source_ref, updated_at
       FROM mission_tasks
       WHERE user_id = ?
         AND archived_at IS NULL
         AND status NOT IN ('done', 'cancelled')
         AND (source_ref IS NULL OR source_ref NOT LIKE 'weekly-review:%')
       ORDER BY priority ASC, COALESCE(due_at, scheduled_for, updated_at) ASC
       LIMIT 50`,
    )
      .bind(userId)
      .all<MissionTaskContextRow>();
    return (rows.results || []).map((row): DailyBriefingTask => ({
      id: row.id,
      title: row.title,
      description: richTextToPlainText(row.description),
      dueAt: row.due_at || row.scheduled_for,
    }));
  } catch {
    return [];
  }
}

function formatDailyCalendarSummary(events: CalendarEventContextRow[], dateLabel: string) {
  if (events.length === 0) return `Your calendar is clear for ${dateLabel}.`;
  if (events.length === 1) return `You have 1 calendar event for ${dateLabel}.`;
  return `You have ${events.length} calendar events for ${dateLabel}.`;
}

function formatDailyCalendarEvents(events: CalendarEventContextRow[], fallbackTimezone: string) {
  if (events.length === 0) return "";
  return [
    "Calendar:",
    ...events.slice(0, 4).map((event) => {
      const time = formatTimeInTimezone(event.starts_at, event.timezone || fallbackTimezone);
      return `- ${time} ${event.title}`;
    }),
  ].join("\n");
}

function formatDailyReminders(reminders: DailyBriefingReminderRow[], fallbackTimezone: string) {
  if (reminders.length === 0) return "";
  const count = reminders.length;
  return [
    `Reminders: ${count} due today.`,
    ...reminders.slice(0, 4).map((reminder) => {
      const time = formatTimeInTimezone(reminder.remind_at, reminder.timezone || fallbackTimezone);
      return `- ${time} ${reminder.title}`;
    }),
  ].join("\n");
}

const DAILY_BRIEFING_TASK_DETAIL_LIMIT = 180;

function formatDailyBriefingTaskDetail(description: string | null | undefined) {
  const normalized = description?.trim() || "";
  if (!normalized) return null;
  if (normalized.length <= DAILY_BRIEFING_TASK_DETAIL_LIMIT) return normalized;
  return `${normalized.slice(0, DAILY_BRIEFING_TASK_DETAIL_LIMIT - 1).trimEnd()}…`;
}

function formatDailyTasks(tasks: DailyBriefingTask[], dateKey: string) {
  const due = tasks.filter((task) => {
    const dueAt = task.dueAt;
    return dueAt?.slice(0, 10) === dateKey;
  });
  if (due.length === 0) return "";
  return [
    `Tasks: ${due.length} task${due.length === 1 ? "" : "s"} due today.`,
    ...due.slice(0, 4).map((task) => {
      const detail = formatDailyBriefingTaskDetail(task.description);
      return `- ${task.title}${detail ? `: ${detail}` : ""}`;
    }),
  ].join("\n");
}

function richTextToPlainText(value: string | null) {
  if (!value) return "";
  return stripRichTextHtml(decodeHtmlEntities(value))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  let decoded = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "&") {
      decoded += value[index];
      index += 1;
      continue;
    }
    const end = value.indexOf(";", index + 1);
    if (end < 0 || end - index > 12) {
      decoded += value[index];
      index += 1;
      continue;
    }
    const replacement = decodeHtmlEntity(value.slice(index + 1, end));
    if (replacement === null) {
      decoded += value[index];
      index += 1;
      continue;
    }
    decoded += replacement;
    index = end + 1;
  }
  return decoded;
}

function decodeHtmlEntity(entity: string): string | null {
  switch (entity.toLowerCase()) {
    case "nbsp": return " ";
    case "amp": return "&";
    case "lt": return "<";
    case "gt": return ">";
    case "quot": return '"';
    case "#39": return "'";
  }
  if (!entity.startsWith("#")) return null;
  const hexadecimal = entity[1]?.toLowerCase() === "x";
  const digits = entity.slice(hexadecimal ? 2 : 1);
  if (!digits || !isHtmlEntityNumber(digits, hexadecimal ? 16 : 10)) return null;
  const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return null;
  return String.fromCodePoint(codePoint);
}

function isHtmlEntityNumber(value: string, radix: 10 | 16): boolean {
  for (const character of value.toLowerCase()) {
    const code = character.charCodeAt(0);
    const digit = code >= 48 && code <= 57;
    const hexLetter = radix === 16 && code >= 97 && code <= 102;
    if (!digit && !hexLetter) return false;
  }
  return true;
}

function stripRichTextHtml(value: string): string {
  let text = "";
  let ignoredContentTag: "script" | "style" | null = null;
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "<") {
      if (!ignoredContentTag) text += value[index];
      index += 1;
      continue;
    }
    const tagEnd = findRichTextTagEnd(value, index + 1);
    if (tagEnd < 0) {
      if (!ignoredContentTag) text += value[index];
      index += 1;
      continue;
    }
    const tag = parseRichTextTag(value.slice(index + 1, tagEnd));
    if (!ignoredContentTag) {
      text += " ";
      if (!tag?.closing && (tag?.name === "script" || tag?.name === "style")) {
        ignoredContentTag = tag.name;
      }
    } else if (tag?.closing && tag.name === ignoredContentTag) {
      ignoredContentTag = null;
      text += " ";
    }
    index = tagEnd + 1;
  }
  return text;
}

function findRichTextTagEnd(value: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function parseRichTextTag(value: string): { name: string; closing: boolean } | null {
  let index = 0;
  while (isRichTextWhitespace(value[index] || "")) index += 1;
  const closing = value[index] === "/";
  if (closing) index += 1;
  while (isRichTextWhitespace(value[index] || "")) index += 1;
  const start = index;
  while (isRichTextTagNameCharacter(value[index] || "")) index += 1;
  if (index === start) return null;
  return { name: value.slice(start, index).toLowerCase(), closing };
}

function isRichTextTagNameCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) || value === "-";
}

function isRichTextWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r";
}

function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function formatFriendlyDate(dateKey: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function utcWindowForLocalDate(dateKey: string, timezone: string) {
  const start = zonedLocalTimeToUtc(dateKey, "00:00", timezone);
  const end = zonedLocalTimeToUtc(dateKey, "24:00", timezone);
  return { start: start.toISOString(), end: end.toISOString() };
}

function zonedLocalTimeToUtc(dateKey: string, time: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute || 0, 0);
  const offset = timezoneOffsetMs(new Date(guess), timezone);
  return new Date(guess - offset);
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.get("year")),
    Number(map.get("month")) - 1,
    Number(map.get("day")),
    Number(map.get("hour")) % 24,
    Number(map.get("minute")),
    Number(map.get("second")),
  );
  return asUtc - date.getTime();
}

function formatTimeInTimezone(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

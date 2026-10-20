import {
  expandRecurringCalendarEvents,
  getUtcMsForLocalTime,
  normalizeTimeZone,
} from "./calendar";
import {
  notifyCalendarItemDue,
  type CalendarPushAlert,
  type CalendarPushCategory,
} from "./push-notifications";
import type {
  DbBooking,
  DbCalendarSourceEvent,
  DbUserCalendarEvent,
  DbUserReminder,
  Env,
} from "./types";

type OwnerRow = { id: string; timezone: string | null };
type MissionTaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  scheduled_for: string | null;
};

export type CalendarPushCandidate = CalendarPushAlert & {
  userId: string;
  alertAt: string;
};

const LOOKBACK_MS = 20 * 60 * 1000;
const QUERY_PADDING_MS = 2 * 24 * 60 * 60 * 1000;
const EVENT_ALERT_OFFSET_MINUTES = 15;
// Dispatch runs every minute. A failed or skipped alert is retried after this
// backoff rather than every tick, so a device that rejected one copy is not
// sent a fresh duplicate each minute while the alert is still in LOOKBACK_MS.
const RETRY_BACKOFF_MS = 10 * 60 * 1000;

export async function dispatchDueCalendarPushNotifications(
  env: Env,
  now = new Date(),
) {
  const owners = await env.DB.prepare(
    "SELECT id, timezone FROM owner_profile ORDER BY created_at ASC",
  ).all<OwnerRow>();
  const windowStart = new Date(now.getTime() - LOOKBACK_MS);
  const results = [];

  for (const owner of owners.results || []) {
    const candidates = await loadCalendarPushCandidates(env, owner, now);
    for (const candidate of candidates) {
      const alertAtMs = new Date(candidate.alertAt).getTime();
      if (alertAtMs <= windowStart.getTime() || alertAtMs > now.getTime()) continue;
      results.push(await dispatchCalendarPushCandidate(env, candidate, now));
    }
  }

  return {
    checkedAt: now.toISOString(),
    candidateCount: results.length,
    sent: results.filter((result) => result.outcome === "sent").length,
    skipped: results.filter(
      (result) => result.outcome === "skipped" || result.outcome === "already_dispatched",
    ).length,
    failed: results.filter((result) => result.outcome === "failed").length,
    results,
  };
}

async function loadCalendarPushCandidates(
  env: Env,
  owner: OwnerRow,
  now: Date,
): Promise<CalendarPushCandidate[]> {
  const queryStart = new Date(now.getTime() - QUERY_PADDING_MS).toISOString();
  const queryEnd = new Date(now.getTime() + QUERY_PADDING_MS).toISOString();
  const [items, tasks] = await Promise.all([
    loadCalendarPushItems(env, owner.id, queryStart, queryEnd),
    env.DB.prepare(
      `SELECT id, title, due_at, scheduled_for FROM mission_tasks
       WHERE user_id = ? AND archived_at IS NULL
         AND status IN ('backlog', 'in_progress')
         AND (due_at IS NOT NULL OR scheduled_for IS NOT NULL)`,
    ).bind(owner.id).all<MissionTaskRow>(),
  ]);
  const ownerTimezone = normalizeTimeZone(owner.timezone) || "UTC";
  return [
    ...items.events.map((event) => eventCandidate(owner.id, event, ownerTimezone)),
    ...items.bookings.map((booking) => timedCandidate(
      owner.id,
      "bookings",
      booking.id,
      booking.guest_name.trim()
        ? `Booking with ${booking.guest_name.trim()}`
        : "Booking",
      booking.starts_at,
      EVENT_ALERT_OFFSET_MINUTES,
    )),
    ...items.reminders.map((reminder) => timedCandidate(
      owner.id,
      "reminders",
      reminder.id,
      reminder.title,
      reminder.remind_at,
      0,
    )),
    ...items.importedEvents.map((event) => eventLikeCandidate(
      owner.id,
      "subscribed_calendars",
      event.id,
      event.title,
      event.starts_at,
      event.all_day === 1,
      event.timezone,
      ownerTimezone,
    )),
    ...(tasks.results || []).flatMap((task) => {
      const due = task.due_at || task.scheduled_for;
      if (!due) return [];
      return [taskCandidate(owner.id, task.id, task.title, due, ownerTimezone)];
    }),
  ];
}

export async function loadCalendarPushItems(env: Env, userId: string, queryStart: string, queryEnd: string) {
  const [events, recurringEvents, bookings, reminders, importedEvents] = await Promise.all([
    env.DB.prepare(
      `SELECT id, user_id, title, notes, location, starts_at, ends_at, timezone,
              all_day, kind, recurrence_rule, created_at
       FROM user_calendar_events
       WHERE user_id = ? AND recurrence_rule IS NULL
         AND ends_at > ? AND starts_at < ?`,
    ).bind(userId, queryStart, queryEnd).all<DbUserCalendarEvent>(),
    env.DB.prepare(
      `SELECT id, user_id, title, notes, location, starts_at, ends_at, timezone,
              all_day, kind, recurrence_rule, created_at
       FROM user_calendar_events
       WHERE user_id = ? AND recurrence_rule IS NOT NULL`,
    ).bind(userId).all<DbUserCalendarEvent>(),
    env.DB.prepare(
      `SELECT b.* FROM bookings b
       JOIN sites s ON s.id = b.site_id
       WHERE s.user_id = ? AND b.status = 'confirmed'
         AND b.ends_at > ? AND b.starts_at < ?`,
    ).bind(userId, queryStart, queryEnd).all<DbBooking>(),
    env.DB.prepare(
      `SELECT id, user_id, title, notes, remind_at, timezone, recurrence_rule,
              context_type, context_id, context_label, status, delivered_at,
              dismissed_at, created_at
       FROM user_reminders
       WHERE user_id = ? AND status IN ('pending', 'failed')
         AND (context_type IS NULL OR context_type != 'card')
         AND remind_at >= ? AND remind_at < ?`,
    ).bind(userId, queryStart, queryEnd).all<DbUserReminder>(),
    env.DB.prepare(
      `SELECT cse.id, cse.source_id, cse.external_key, cse.external_uid,
              cse.title, cse.notes, cse.location, cse.starts_at, cse.ends_at,
              cse.timezone, cse.all_day, cse.is_busy, cse.created_at
       FROM calendar_source_events cse
       JOIN calendar_sources cs ON cs.id = cse.source_id
       WHERE cs.user_id = ? AND cs.status = 'active'
         AND cse.ends_at > ? AND cse.starts_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM calendar_source_event_dismissals d
           WHERE d.source_id = cse.source_id AND d.external_key = cse.external_key
         )`,
    ).bind(userId, queryStart, queryEnd).all<DbCalendarSourceEvent>(),
  ]);

  return {
    events: [...(events.results || []), ...expandRecurringCalendarEvents(recurringEvents.results || [], queryStart, queryEnd)]
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id)),
    bookings: bookings.results || [],
    reminders: reminders.results || [],
    importedEvents: importedEvents.results || [],
  };
}

function eventCandidate(
  userId: string,
  event: DbUserCalendarEvent,
  ownerTimezone: string,
) {
  return eventLikeCandidate(
    userId,
    event.kind === "birthday" ? "birthdays" : "events",
    event.id,
    event.title,
    event.starts_at,
    event.all_day === 1 || event.kind === "birthday",
    event.timezone,
    ownerTimezone,
  );
}

export function eventLikeCandidate(
  userId: string,
  category: Extract<CalendarPushCategory, "events" | "birthdays" | "subscribed_calendars">,
  itemId: string,
  title: string,
  startsAt: string,
  allDay: boolean,
  timezone: string | null,
  ownerTimezone: string,
): CalendarPushCandidate {
  if (!allDay) {
    return timedCandidate(userId, category, itemId, title, startsAt, EVENT_ALERT_OFFSET_MINUTES);
  }
  const resolvedTimezone = normalizeTimeZone(timezone) || ownerTimezone;
  const dateKey = localDateKey(startsAt, resolvedTimezone);
  return {
    userId,
    category,
    itemId,
    title,
    occurrenceId: startsAt,
    alertOffsetMinutes: 0,
    alertAt: localTime(dateKey, 9, 0, resolvedTimezone),
  };
}

export function taskCandidate(
  userId: string,
  itemId: string,
  title: string,
  dueAt: string,
  ownerTimezone: string,
): CalendarPushCandidate {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueAt);
  return {
    userId,
    category: "tasks",
    itemId,
    title,
    occurrenceId: dueAt,
    alertOffsetMinutes: 0,
    alertAt: dateOnly ? localTime(dueAt, 9, 0, ownerTimezone) : new Date(dueAt).toISOString(),
  };
}

function timedCandidate(
  userId: string,
  category: CalendarPushCategory,
  itemId: string,
  title: string,
  occursAt: string,
  alertOffsetMinutes: number,
): CalendarPushCandidate {
  return {
    userId,
    category,
    itemId,
    title,
    occurrenceId: occursAt,
    alertOffsetMinutes,
    alertAt: new Date(
      new Date(occursAt).getTime() - alertOffsetMinutes * 60 * 1000,
    ).toISOString(),
  };
}

export async function dispatchCalendarPushCandidate(
  env: Env,
  candidate: CalendarPushCandidate,
  now = new Date(),
) {
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO calendar_push_dispatches
       (id, user_id, category, item_id, occurrence_id, alert_offset_minutes,
        alert_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime(?), datetime(?))`,
  ).bind(
    crypto.randomUUID(),
    candidate.userId,
    candidate.category,
    candidate.itemId,
    candidate.occurrenceId,
    candidate.alertOffsetMinutes,
    candidate.alertAt,
    now.toISOString(),
    now.toISOString(),
  ).run();
  let claimed = (inserted.meta?.changes || 0) > 0;
  if (!claimed) {
    const retried = await env.DB.prepare(
      `UPDATE calendar_push_dispatches
       SET status = 'pending', error_message = NULL, updated_at = datetime(?)
       WHERE user_id = ? AND category = ? AND item_id = ? AND occurrence_id = ?
         AND alert_offset_minutes = ? AND status IN ('failed', 'skipped')
         AND updated_at <= datetime(?)`,
    ).bind(
      now.toISOString(),
      candidate.userId,
      candidate.category,
      candidate.itemId,
      candidate.occurrenceId,
      candidate.alertOffsetMinutes,
      new Date(now.getTime() - RETRY_BACKOFF_MS).toISOString(),
    ).run();
    claimed = (retried.meta?.changes || 0) > 0;
  }
  if (!claimed) return { ...candidate, outcome: "already_dispatched" as const };

  const delivery = await notifyCalendarItemDue(env, candidate);
  const matched = typeof delivery.matched === "number" ? delivery.matched : 0;
  const sent = typeof delivery.sent === "number" ? delivery.sent : 0;
  const outcome = delivery.ok !== true
    ? "failed"
    : matched === 0
      ? "skipped"
      : sent === matched
        ? "sent"
        : "failed";
  await env.DB.prepare(
    `UPDATE calendar_push_dispatches
     SET status = ?, error_message = ?, updated_at = datetime(?)
     WHERE user_id = ? AND category = ? AND item_id = ? AND occurrence_id = ?
       AND alert_offset_minutes = ?`,
  ).bind(
    outcome,
    calendarPushErrorMessage(outcome, delivery, matched, sent),
    now.toISOString(),
    candidate.userId,
    candidate.category,
    candidate.itemId,
    candidate.occurrenceId,
    candidate.alertOffsetMinutes,
  ).run();
  return { ...candidate, outcome };
}

function calendarPushErrorMessage(
  outcome: "sent" | "skipped" | "failed",
  delivery: { ok?: unknown; error?: unknown },
  matched: number,
  sent: number,
) {
  if (outcome === "sent") return null;
  if (outcome === "skipped") {
    return "No device accepted this alert: no registered iPhone, or notifications are off for this category.";
  }
  if (delivery.ok !== true) {
    const reason = typeof delivery.error === "string" && delivery.error.trim()
      ? delivery.error.trim()
      : "Push relay did not confirm delivery";
    return `Push relay failed: ${reason}`;
  }
  return `Delivered to ${sent} of ${matched} devices.`;
}

function localDateKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function localTime(dateKey: string, hour: number, minute: number, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(
    getUtcMsForLocalTime({ year, month, day, hour, minute }, timezone),
  ).toISOString();
}

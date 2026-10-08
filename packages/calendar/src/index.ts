export const CALENDAR_PLUGIN_ID = "me3.calendar";

export const CALENDAR_RUNTIME = {
  id: CALENDAR_PLUGIN_ID,
  packageName: "@me3-core/plugin-calendar",
  bundled: true,
  runtimeStatus: "calendar_runtime",
  recurrenceRules: ["daily", "weekly", "monthly", "yearly", "custom"],
  notes: [
    "Core bundles calendar recurrence and feed expansion through a first-party plugin package.",
    "The app calendar remains available as a default workspace surface while plugin install state catches up.",
  ],
} as const;

export type CalendarEventKind = "event" | "birthday";

export type CalendarEventLike = {
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  all_day: number;
  recurrence_rule: string | null;
};

type CalendarAgentStatement = {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};

export type CalendarAgentDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): CalendarAgentStatement;
  };
};

export type CalendarAgentReadInput = {
  dateFrom: string;
  dateTo: string;
  limit?: number;
};

export type CalendarAgentCreateInput = {
  title: string;
  startDate: string;
  startTime: string;
  startTimezone: string;
  calendarTimezone?: string;
  durationMinutes?: number;
  notes?: string;
  location?: string;
};

export type CalendarAgentRescheduleInput = Pick<
  CalendarAgentCreateInput,
  "startDate" | "startTime" | "startTimezone"
> & { eventId: string };

export type CalendarAgentCreatedEvent = {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  allDay: false;
  sourceKind: "native";
  sourceName: "Personal events";
  recurrenceRule: null;
  requestedDate: string;
  requestedTime: string;
  requestedTimezone: string;
  durationMinutes: number;
};

export type CalendarAgentEvent = {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  allDay: boolean;
  sourceKind: "native" | "imported";
  sourceName: string;
  recurrenceRule: string | null;
};

export type CalendarAgentReadResult = {
  dateFrom: string;
  dateTo: string;
  timezone: string;
  events: CalendarAgentEvent[];
  hasMore: boolean;
};

type CalendarAgentNativeRow = CalendarEventLike & {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  kind: CalendarEventKind;
};

type CalendarAgentImportedRow = Omit<CalendarAgentNativeRow, "kind"> & {
  source_name: string;
};

const WEEKDAY_TOKENS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DEFAULT_AGENT_CALENDAR_LIMIT = 30;
const MAX_AGENT_CALENDAR_LIMIT = 50;
const MAX_AGENT_CALENDAR_RANGE_DAYS = 31;
const MAX_AGENT_RECURRING_DEFINITIONS = 100;
const DEFAULT_AGENT_EVENT_DURATION_MINUTES = 60;
const MAX_AGENT_EVENT_DURATION_MINUTES = 24 * 60;
type CustomRecurrenceUnit = "day" | "week" | "month" | "year";
type CustomRecurrenceRule = {
  interval: number;
  unit: CustomRecurrenceUnit;
  until?: string;
  count?: number;
};

export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timezone = value.trim();
  if (!timezone) return null;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return null;
  }
}

export function resolveTimeZone(value: unknown): string {
  return normalizeTimeZone(value) || "UTC";
}

export function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function getUtcMsForLocalTime(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timezone: string,
): number {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
  );
  const actual = localDateParts(new Date(utcGuess).toISOString(), timezone);
  const deltaMinutes =
    (Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
    ) -
      utcGuess) /
    60_000;
  return utcGuess - deltaMinutes * 60_000;
}

export async function createCalendarEventForAgent(
  db: CalendarAgentDb,
  userId: string,
  ownerTimezone: string | null | undefined,
  input: CalendarAgentCreateInput,
): Promise<CalendarAgentCreatedEvent> {
  const title = boundedCalendarText(input.title, 300);
  if (!title) throw new Error("Calendar event title is required.");

  const { startDate, startTime, startTimezone, startsAt } =
    resolveAgentCalendarStart(input);
  const requestedCalendarTimezone = input.calendarTimezone?.trim();
  const ownerCalendarTimezone = normalizeAgentTimeZone(ownerTimezone);
  const calendarTimezone = requestedCalendarTimezone
    ? normalizeAgentTimeZone(requestedCalendarTimezone)
    : ownerCalendarTimezone || "UTC";
  if (!calendarTimezone) {
    throw new Error("Calendar event display timezone must be a valid IANA timezone.");
  }
  if (
    !requestedCalendarTimezone &&
    typeof ownerTimezone === "string" &&
    ownerTimezone.trim() &&
    !ownerCalendarTimezone
  ) {
    throw new Error(
      "The owner timezone must be a valid IANA timezone before creating this event.",
    );
  }
  const durationMinutes = normalizeAgentEventDuration(input.durationMinutes);
  const endsAt = new Date(
    Date.parse(startsAt) + durationMinutes * 60_000,
  ).toISOString();
  const id = crypto.randomUUID();
  const notes = boundedCalendarText(input.notes, 4_000);
  const location = boundedCalendarText(input.location, 500);

  await db.prepare(
    `INSERT INTO user_calendar_events
       (id, user_id, title, notes, location, starts_at, ends_at, timezone,
        all_day, kind, recurrence_rule)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'event', NULL)`,
  )
    .bind(
      id,
      userId,
      title,
      notes,
      location,
      startsAt,
      endsAt,
      calendarTimezone,
    )
    .run();

  return {
    id,
    title,
    notes,
    location,
    startsAt,
    endsAt,
    timezone: calendarTimezone,
    allDay: false,
    sourceKind: "native",
    sourceName: "Personal events",
    recurrenceRule: null,
    requestedDate: startDate,
    requestedTime: startTime,
    requestedTimezone: startTimezone,
    durationMinutes,
  };
}

export async function rescheduleCalendarEventForAgent(
  db: CalendarAgentDb,
  userId: string,
  input: CalendarAgentRescheduleInput,
): Promise<{ id: string; title: string; startsAt: string; endsAt: string; timezone: string }> {
  const event = await getCancellableCalendarEventForAgent(db, userId, input.eventId);
  const eventId = event.id;
  const { startsAt } = resolveAgentCalendarStart(input);
  const durationMs = Date.parse(event.ends_at) - Date.parse(event.starts_at);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Calendar event has an invalid duration.");
  }
  const endsAt = new Date(Date.parse(startsAt) + durationMs).toISOString();
  const result = await db.prepare(
    `UPDATE user_calendar_events
     SET starts_at = ?, ends_at = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND starts_at = ? AND ends_at = ?`,
  ).bind(startsAt, endsAt, eventId, userId, event.starts_at, event.ends_at).run();
  if ((result.meta?.changes || 0) !== 1) {
    throw new Error("Calendar event changed while rescheduling. List it again and retry.");
  }
  return { id: event.id, title: event.title, startsAt, endsAt, timezone: event.timezone };
}

export async function getCancellableCalendarEventForAgent(
  db: CalendarAgentDb,
  userId: string,
  eventIdInput: string,
): Promise<{ id: string; title: string; starts_at: string; ends_at: string; timezone: string }> {
  const eventId = eventIdInput.trim();
  if (!eventId) throw new Error("Calendar event ID is required.");
  const event = await db.prepare(
    `SELECT id, title, starts_at, ends_at, timezone, all_day, kind, recurrence_rule
     FROM user_calendar_events WHERE id = ? AND user_id = ?`,
  ).bind(eventId, userId).first<{
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    all_day: number;
    kind: CalendarEventKind;
    recurrence_rule: string | null;
  }>();
  if (!event) throw new Error("Calendar event not found in your personal calendar.");
  if (event.recurrence_rule) {
    throw new Error("A recurring calendar event needs a specific occurrence or series choice before changing it.");
  }
  if (event.all_day || event.kind !== "event") {
    throw new Error("Only timed personal calendar events can be changed here.");
  }
  const linkedBooking = await db.prepare(
    `SELECT b.id FROM bookings b JOIN sites s ON s.id = b.site_id
     WHERE b.calendar_event_id = ? AND s.user_id = ? AND b.status = 'confirmed'
     LIMIT 1`,
  ).bind(event.id, userId).first<{ id: string }>();
  const linkedMeeting = await db.prepare(
    `SELECT id FROM scheduling_requests
     WHERE finalized_calendar_event_id = ? AND user_id = ? AND status = 'finalized'
     LIMIT 1`,
  ).bind(event.id, userId).first<{ id: string }>();
  if (linkedBooking || linkedMeeting) {
    throw new Error("This event belongs to a confirmed booking or meeting. Cancel that booking or meeting first.");
  }
  return event;
}

export async function cancelCalendarEventForAgent(
  db: CalendarAgentDb,
  userId: string,
  input: { eventId: string; startsAt: string; endsAt: string },
): Promise<{ id: string; title: string }> {
  const event = await getCancellableCalendarEventForAgent(db, userId, input.eventId);
  if (event.starts_at !== input.startsAt || event.ends_at !== input.endsAt) {
    throw new Error("Calendar event changed after approval was requested. List it again and retry.");
  }
  const result = await db.prepare(
    `DELETE FROM user_calendar_events
     WHERE id = ? AND user_id = ? AND starts_at = ? AND ends_at = ?
       AND recurrence_rule IS NULL AND all_day = 0 AND kind = 'event'`,
  ).bind(event.id, userId, input.startsAt, input.endsAt).run();
  if ((result.meta?.changes || 0) !== 1) {
    throw new Error("Calendar event changed before cancellation. List it again and retry.");
  }
  return { id: event.id, title: event.title };
}

export function resolveAgentCalendarStart(input: Pick<CalendarAgentCreateInput,
  "startDate" | "startTime" | "startTimezone"
>, label = "Calendar event"): { startDate: string; startTime: string; startTimezone: string; startsAt: string } {
  const startDate = requiredCalendarDate(input.startDate, `${label} date`);
  const startTime = requiredCalendarTime(input.startTime, `${label} time`);
  const startTimezone = normalizeAgentTimeZone(input.startTimezone);
  if (!startTimezone) {
    throw new Error(`${label} source timezone must be a valid IANA timezone, not an abbreviation.`);
  }
  const [year, month, day] = startDate.split("-").map(Number);
  const [hour, minute] = startTime.split(":").map(Number);
  const startsAt = new Date(getUtcMsForLocalTime(
    { year, month, day, hour, minute }, startTimezone,
  )).toISOString();
  const resolvedStart = localDateParts(startsAt, startTimezone);
  if (
    resolvedStart.year !== year || resolvedStart.month !== month ||
    resolvedStart.day !== day || resolvedStart.hour !== hour ||
    resolvedStart.minute !== minute
  ) {
    throw new Error(`${label} time ${startDate} ${startTime} does not exist in ${startTimezone}.`);
  }
  if (hasAlternativeCalendarInstant(startsAt, resolvedStart, startTimezone)) {
    throw new Error(`${label} time ${startDate} ${startTime} occurs twice in ${startTimezone} because of a timezone transition. Ask the owner for an unambiguous time.`);
  }
  return { startDate, startTime, startTimezone, startsAt };
}

export function normalizeEventRecurrenceRule(
  value: unknown,
  kind: CalendarEventKind,
  startDate: string,
): string | null {
  if (kind === "birthday") return "yearly";
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : null;
  if (!normalized || normalized === "none") return null;
  if (normalized === "daily" || normalized === "yearly") return normalized;
  if (normalized.startsWith("custom:")) {
    return parseCustomRecurrenceRule(normalized) ? normalized : null;
  }

  const [year, month, day] = startDate.split("-").map(Number);
  if (!year || !month || !day) return null;

  if (normalized === "weekly") {
    const weekday =
      WEEKDAY_TOKENS[new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()];
    return `weekly:${weekday}`;
  }

  if (normalized === "monthly") {
    return `monthly:${day}`;
  }

  if (
    /^weekly:(sun|mon|tue|wed|thu|fri|sat)(,(sun|mon|tue|wed|thu|fri|sat))*$/.test(
      normalized,
    ) ||
    /^monthly:([1-9]|[12]\d|3[01])$/.test(normalized)
  ) {
    return normalized;
  }

  return null;
}

export function formatEventRecurrence(rule: string | null | undefined): string {
  if (rule === "daily") return "Daily";
  if (rule?.startsWith("weekly:")) {
    return `Weekly on ${rule.slice("weekly:".length).replace(/,/g, ", ")}`;
  }
  if (rule?.startsWith("monthly:")) {
    return `Monthly on day ${rule.slice("monthly:".length)}`;
  }
  if (rule === "yearly") return "Yearly";
  const custom = parseCustomRecurrenceRule(rule);
  if (custom) {
    const unit = custom.interval === 1 ? custom.unit : `${custom.unit}s`;
    const suffix = custom.until
      ? ` until ${custom.until}`
      : custom.count
        ? ` for ${custom.count} occurrences`
        : "";
    return `Every ${custom.interval} ${unit}${suffix}`;
  }
  return rule || "";
}

export async function readCalendarEventsForAgent(
  db: CalendarAgentDb,
  userId: string,
  timezoneInput: string | null | undefined,
  input: CalendarAgentReadInput,
): Promise<CalendarAgentReadResult> {
  const dateFrom = requiredCalendarDate(input.dateFrom, "Calendar start date");
  const dateTo = requiredCalendarDate(input.dateTo, "Calendar end date");
  if (dateFrom > dateTo) {
    throw new Error("Calendar start date must be on or before the end date.");
  }
  const rangeDays =
    Math.round(
      (Date.parse(`${dateTo}T12:00:00.000Z`) -
        Date.parse(`${dateFrom}T12:00:00.000Z`)) /
        86_400_000,
    ) + 1;
  if (rangeDays > MAX_AGENT_CALENDAR_RANGE_DAYS) {
    throw new Error(`Calendar reads are limited to ${MAX_AGENT_CALENDAR_RANGE_DAYS} days.`);
  }

  const timezone = resolveTimeZone(timezoneInput);
  const windowStart = localDateBoundary(dateFrom, timezone);
  const windowEnd = localDateBoundary(addDaysToDateString(dateTo, 1), timezone);
  const limit = boundedCalendarLimit(input.limit);
  const [nativeRows, recurringRows, importedRows] = await Promise.all([
    db.prepare(
      `SELECT id, title, notes, location, starts_at, ends_at, timezone,
              all_day, kind, recurrence_rule
       FROM user_calendar_events
       WHERE user_id = ? AND recurrence_rule IS NULL
         AND ends_at > ? AND starts_at < ?
       ORDER BY starts_at ASC
       LIMIT ?`,
    )
      .bind(userId, windowStart, windowEnd, limit + 1)
      .all<CalendarAgentNativeRow>(),
    db.prepare(
      `SELECT id, title, notes, location, starts_at, ends_at, timezone,
              all_day, kind, recurrence_rule
       FROM user_calendar_events
       WHERE user_id = ? AND recurrence_rule IS NOT NULL
       ORDER BY starts_at ASC
       LIMIT ?`,
    )
      .bind(userId, MAX_AGENT_RECURRING_DEFINITIONS + 1)
      .all<CalendarAgentNativeRow>(),
    db.prepare(
      `SELECT cse.id, cse.title, cse.notes, cse.location, cse.starts_at,
              cse.ends_at, cse.timezone, cse.all_day, NULL AS recurrence_rule,
              cs.name AS source_name
       FROM calendar_source_events cse
       JOIN calendar_sources cs ON cs.id = cse.source_id
       WHERE cs.user_id = ? AND cs.status = 'active'
         AND cse.ends_at > ? AND cse.starts_at < ?
       ORDER BY cse.starts_at ASC
       LIMIT ?`,
    )
      .bind(userId, windowStart, windowEnd, limit + 1)
      .all<CalendarAgentImportedRow>(),
  ]);

  const native = nativeRows.results || [];
  const recurring = recurringRows.results || [];
  const imported = importedRows.results || [];
  const events = [
    ...native.slice(0, limit).map(serializeNativeAgentCalendarEvent),
    ...expandRecurringCalendarEvents(
      recurring.slice(0, MAX_AGENT_RECURRING_DEFINITIONS),
      windowStart,
      windowEnd,
    ).map(serializeNativeAgentCalendarEvent),
    ...imported.slice(0, limit).map(serializeImportedAgentCalendarEvent),
  ].sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) ||
      left.endsAt.localeCompare(right.endsAt) ||
      left.title.localeCompare(right.title),
  );

  return {
    dateFrom,
    dateTo,
    timezone,
    events: events.slice(0, limit),
    hasMore:
      events.length > limit ||
      native.length > limit ||
      imported.length > limit ||
      recurring.length > MAX_AGENT_RECURRING_DEFINITIONS,
  };
}

export function expandRecurringCalendarEvents<T extends CalendarEventLike>(
  events: T[],
  windowStart: string,
  windowEnd: string,
): T[] {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const startYear = new Date(windowStart).getUTCFullYear() - 1;
  const endYear = new Date(windowEnd).getUTCFullYear() + 1;
  const expanded: T[] = [];

  for (const event of events) {
    const rule = event.recurrence_rule?.trim().toLowerCase();
    if (!rule) continue;

    const timezone = resolveTimeZone(event.timezone);
    const start = localDateParts(event.starts_at, timezone);
    const originalStartMs = new Date(event.starts_at).getTime();
    const durationMs = Math.max(
      1,
      new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime(),
    );

    const addOccurrence = (year: number, month: number, day: number) => {
      const startsAt = new Date(
        getUtcMsForLocalTime(
          {
            year,
            month,
            day,
            hour: start.hour,
            minute: start.minute,
            second: 0,
          },
          timezone,
        ),
      );
      const endsAt = new Date(startsAt.getTime() + durationMs);

      if (
        startsAt.getTime() < originalStartMs ||
        endsAt.getTime() <= startMs ||
        startsAt.getTime() >= endMs
      ) {
        return;
      }

      expanded.push({
        ...event,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
    };

    if (rule === "daily") {
      const cursor = new Date(startMs);
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      for (let i = 0; i < 370 && cursor.getTime() < endMs; i += 1) {
        const local = localDateParts(cursor.toISOString(), timezone);
        addOccurrence(local.year, local.month, local.day);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      continue;
    }

    const custom = parseCustomRecurrenceRule(rule);
    if (custom) {
      let occurrenceIndex = 0;
      const addCustomOccurrence = (year: number, month: number, day: number) => {
        occurrenceIndex += 1;
        if (custom.count && occurrenceIndex > custom.count) return;
        if (custom.until && compareDateParts(year, month, day, custom.until) > 0) return;
        addOccurrence(year, month, day);
      };

      if (custom.unit === "day") {
        const cursor = new Date(originalStartMs);
        for (let i = 0; i < 3700 && cursor.getTime() < endMs; i += custom.interval) {
          const local = localDateParts(cursor.toISOString(), timezone);
          addCustomOccurrence(local.year, local.month, local.day);
          cursor.setUTCDate(cursor.getUTCDate() + custom.interval);
        }
        continue;
      }

      if (custom.unit === "week") {
        const cursor = new Date(originalStartMs);
        for (let i = 0; i < 1000 && cursor.getTime() < endMs; i += custom.interval) {
          const local = localDateParts(cursor.toISOString(), timezone);
          addCustomOccurrence(local.year, local.month, local.day);
          cursor.setUTCDate(cursor.getUTCDate() + custom.interval * 7);
        }
        continue;
      }

      if (custom.unit === "month") {
        for (let year = start.year, month = start.month, i = 0; i < 1200; i += 1) {
          if (Date.UTC(year, month - 1, 1) > endMs) break;
          const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
          addCustomOccurrence(year, month, Math.min(start.day, maxDay));
          month += custom.interval;
          while (month > 12) {
            year += 1;
            month -= 12;
          }
        }
        continue;
      }

      for (let year = start.year, i = 0; i < 200; i += 1) {
        if (Date.UTC(year, start.month - 1, start.day) > endMs) break;
        const maxDay = new Date(Date.UTC(year, start.month, 0)).getUTCDate();
        addCustomOccurrence(year, start.month, Math.min(start.day, maxDay));
        year += custom.interval;
      }
      continue;
    }

    if (rule.startsWith("weekly:")) {
      const days = new Set(
        rule
          .slice("weekly:".length)
          .split(",")
          .map((value) => value.trim()),
      );
      const cursor = new Date(startMs);
      cursor.setUTCDate(cursor.getUTCDate() - 7);
      for (let i = 0; i < 430 && cursor.getTime() < endMs; i += 1) {
        const local = localDateParts(cursor.toISOString(), timezone);
        const weekday =
          WEEKDAY_TOKENS[
            new Date(Date.UTC(local.year, local.month - 1, local.day, 12, 0, 0)).getUTCDay()
          ];
        if (days.has(weekday)) {
          addOccurrence(local.year, local.month, local.day);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      continue;
    }

    if (rule.startsWith("monthly:")) {
      const day = Number(rule.slice("monthly:".length));
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      for (let year = startYear; year <= endYear; year += 1) {
        for (let month = 1; month <= 12; month += 1) {
          const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
          addOccurrence(year, month, Math.min(day, maxDay));
        }
      }
      continue;
    }

    for (let year = startYear; year <= endYear; year += 1) {
      addOccurrence(year, start.month, start.day);
    }
  }

  return expanded;
}

function serializeNativeAgentCalendarEvent(
  row: CalendarAgentNativeRow,
): CalendarAgentEvent {
  return {
    id: row.id,
    title: boundedCalendarText(row.title, 300) || "Untitled event",
    notes: boundedCalendarText(row.notes, 4_000),
    location: boundedCalendarText(row.location, 500),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: resolveTimeZone(row.timezone),
    allDay: Boolean(row.all_day),
    sourceKind: "native",
    sourceName: row.kind === "birthday" ? "Birthdays" : "Personal events",
    recurrenceRule: row.recurrence_rule,
  };
}

function serializeImportedAgentCalendarEvent(
  row: CalendarAgentImportedRow,
): CalendarAgentEvent {
  return {
    id: row.id,
    title: boundedCalendarText(row.title, 300) || "Untitled event",
    notes: boundedCalendarText(row.notes, 4_000),
    location: boundedCalendarText(row.location, 500),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: resolveTimeZone(row.timezone),
    allDay: Boolean(row.all_day),
    sourceKind: "imported",
    sourceName: boundedCalendarText(row.source_name, 200) || "Imported calendar",
    recurrenceRule: null,
  };
}

function requiredCalendarDate(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  return date;
}

function requiredCalendarTime(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must use HH:MM.`);
  const time = value.trim();
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`${label} must use HH:MM.`);
  }
  return time;
}

function normalizeAgentEventDuration(value: unknown): number {
  if (value === undefined) return DEFAULT_AGENT_EVENT_DURATION_MINUTES;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_AGENT_EVENT_DURATION_MINUTES
  ) {
    throw new Error("Calendar event duration must be from 1 to 1440 minutes.");
  }
  return value;
}

function normalizeAgentTimeZone(value: unknown): string | null {
  const timezone = normalizeTimeZone(value);
  if (!timezone) return null;
  return timezone === "UTC" || timezone.includes("/") ? timezone : null;
}

function hasAlternativeCalendarInstant(
  startsAt: string,
  desired: ReturnType<typeof localDateParts>,
  timezone: string,
): boolean {
  const instant = Date.parse(startsAt);
  for (let minutes = 15; minutes <= 180; minutes += 15) {
    for (const direction of [-1, 1]) {
      const alternative = localDateParts(
        new Date(instant + direction * minutes * 60_000).toISOString(),
        timezone,
      );
      if (
        alternative.year === desired.year &&
        alternative.month === desired.month &&
        alternative.day === desired.day &&
        alternative.hour === desired.hour &&
        alternative.minute === desired.minute
      ) {
        return true;
      }
    }
  }
  return false;
}

function localDateBoundary(date: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(
    getUtcMsForLocalTime({ year, month, day, hour: 0, minute: 0 }, timezone),
  ).toISOString();
}

function boundedCalendarLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AGENT_CALENDAR_LIMIT;
  }
  return Math.max(1, Math.min(Math.floor(value), MAX_AGENT_CALENDAR_LIMIT));
}

function boundedCalendarText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function localDateParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
  };
}

function parseCustomRecurrenceRule(
  rule: string | null | undefined,
): CustomRecurrenceRule | null {
  if (!rule) return null;
  const parts = rule.trim().toLowerCase().split(":");
  if (parts[0] !== "custom") return null;
  const interval = Number(parts[1]);
  const unit = parts[2] as CustomRecurrenceUnit | undefined;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") {
    return null;
  }

  const parsed: CustomRecurrenceRule = { interval, unit };
  if (parts.length === 3) return parsed;
  if (parts.length !== 5) return null;

  if (parts[3] === "until" && /^\d{4}-\d{2}-\d{2}$/.test(parts[4])) {
    parsed.until = parts[4];
    return parsed;
  }

  if (parts[3] === "count") {
    const count = Number(parts[4]);
    if (Number.isInteger(count) && count >= 1 && count <= 999) {
      parsed.count = count;
      return parsed;
    }
  }

  return null;
}

function compareDateParts(
  year: number,
  month: number,
  day: number,
  date: string,
): number {
  const [untilYear, untilMonth, untilDay] = date.split("-").map(Number);
  const left = Date.UTC(year, month - 1, day, 12, 0, 0);
  const right = Date.UTC(untilYear, untilMonth - 1, untilDay, 12, 0, 0);
  return left === right ? 0 : left > right ? 1 : -1;
}

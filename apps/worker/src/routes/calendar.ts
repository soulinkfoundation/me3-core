import {
  createAgentReminder,
  cancelAgentReminder,
  serializeAgentReminder,
  updateAgentReminder,
  type AgentReminderInput,
} from "@me3-core/plugin-agent-chat";
import {
  addDaysToDateString,
  expandRecurringCalendarEvents,
  getUtcMsForLocalTime,
  normalizeEventRecurrenceRule,
  normalizeTimeZone,
} from "../calendar";
import {
  listCalendarMissionTasks,
  parseCalendarWindow,
} from "../calendar-feed";
import {
  getSocialPublishingRuntimeStatus,
  listCalendarSocialPublications,
} from "../social-publishing";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import type {
  DbBooking,
  DbCalendarSource,
  DbCalendarSourceEvent,
  DbUserCalendarEvent,
  DbUserReminder,
} from "../types";

export function registerCalendarRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/calendar/status", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    return c.json({ connected: false });
  });

  app.get("/api/calendar/feed", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const window = parseCalendarWindow(c.req.query("start"), c.req.query("end"));
    if ("error" in window) return c.json({ error: window.error }, 400);

    const [
      bookings,
      reminders,
      events,
      recurringEvents,
      sources,
      importedEvents,
      tasks,
      socialPublishing,
    ] =
      await Promise.all([
        c.env.DB.prepare(
          `SELECT b.*, s.username
           FROM bookings b
           JOIN sites s ON b.site_id = s.id
           WHERE s.user_id = ? AND b.status = 'confirmed'
             AND b.ends_at > ? AND b.starts_at < ?
           ORDER BY b.starts_at ASC`,
        )
          .bind(ownerId, window.start, window.end)
          .all<DbBooking & { username: string }>(),
        c.env.DB.prepare(
          `SELECT id, user_id, title, notes, remind_at, timezone, recurrence_rule,
                  context_type, context_id, context_label, status, delivered_at,
                  dismissed_at, created_at
           FROM user_reminders
           WHERE user_id = ? AND status IN ('pending', 'failed')
             AND (context_type = 'card' OR (remind_at >= ? AND remind_at < ?))
           ORDER BY remind_at ASC`,
        )
          .bind(ownerId, window.start, window.end)
          .all<DbUserReminder>(),
        c.env.DB.prepare(
          `SELECT id, user_id, title, notes, location, starts_at, ends_at, timezone,
                  all_day, kind, recurrence_rule, created_at
           FROM user_calendar_events
           WHERE user_id = ? AND recurrence_rule IS NULL
             AND ends_at > ? AND starts_at < ?
           ORDER BY starts_at ASC`,
        )
          .bind(ownerId, window.start, window.end)
          .all<DbUserCalendarEvent>(),
        c.env.DB.prepare(
          `SELECT id, user_id, title, notes, location, starts_at, ends_at, timezone,
                  all_day, kind, recurrence_rule, created_at
           FROM user_calendar_events
           WHERE user_id = ? AND recurrence_rule IS NOT NULL
           ORDER BY starts_at ASC`,
        )
          .bind(ownerId)
          .all<DbUserCalendarEvent>(),
        c.env.DB.prepare(
          `SELECT id, user_id, kind, name, original_filename, encrypted_source_url,
                  source_url_hint, imported_event_count, last_synced_at,
                  last_sync_error, created_at
           FROM calendar_sources
           WHERE user_id = ? AND status = 'active'
           ORDER BY name ASC`,
        )
          .bind(ownerId)
          .all<DbCalendarSource>(),
        c.env.DB.prepare(
          `SELECT cse.id, cse.source_id, cse.external_key, cse.external_uid, cse.title,
                  cse.notes, cse.location, cse.starts_at, cse.ends_at, cse.timezone,
                  cse.all_day, cse.is_busy, cse.created_at, cs.name AS source_name
           FROM calendar_source_events cse
           JOIN calendar_sources cs ON cs.id = cse.source_id
           WHERE cs.user_id = ? AND cs.status = 'active'
             AND cse.ends_at > ? AND cse.starts_at < ?
           ORDER BY cse.starts_at ASC`,
        )
          .bind(ownerId, window.start, window.end)
          .all<DbCalendarSourceEvent & { source_name: string }>(),
        listCalendarMissionTasks(c.env, ownerId, window),
        loadSocialPublishingCalendar(c.env, ownerId, window),
      ]);

    return c.json({
      bookings: bookings.results || [],
      reminders: (reminders.results || []).map(serializeAgentReminder),
      events: [
        ...(events.results || []),
        ...expandRecurringCalendarEvents(recurringEvents.results || [], window.start, window.end),
      ]
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
        .map(serializeCalendarEvent),
      sources: (sources.results || []).map(serializeCalendarSource),
      importedEvents: (importedEvents.results || []).map(serializeImportedCalendarEvent),
      tasks,
      socialPublishing,
    });
  });

  app.post("/api/calendar/events", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const parsed = await parseCalendarEventBody(c);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO user_calendar_events
         (id, user_id, title, notes, location, starts_at, ends_at, timezone, all_day, kind, recurrence_rule)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        ownerId,
        parsed.title,
        parsed.notes,
        parsed.location,
        parsed.startsAt,
        parsed.endsAt,
        parsed.timezone,
        parsed.allDay ? 1 : 0,
        parsed.kind,
        parsed.recurrenceRule,
      )
      .run();

    return c.json({
      ok: true,
      event: {
        id,
        title: parsed.title,
        notes: parsed.notes,
        location: parsed.location,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        timezone: parsed.timezone,
        allDay: parsed.allDay,
        kind: parsed.kind,
        recurrenceRule: parsed.recurrenceRule,
        sourceId: null,
        sourceName: parsed.kind === "birthday" ? "Birthdays" : "Personal events",
        sourceKind: "native",
      },
    });
  });

  app.put("/api/calendar/events/:eventId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const eventId = c.req.param("eventId");
    const existing = await c.env.DB.prepare(
      "SELECT id FROM user_calendar_events WHERE id = ? AND user_id = ?",
    )
      .bind(eventId, ownerId)
      .first<{ id: string }>();
    if (!existing) return c.json({ error: "Event not found" }, 404);

    const parsed = await parseCalendarEventBody(c);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    await c.env.DB.prepare(
      `UPDATE user_calendar_events
       SET title = ?, notes = ?, location = ?, starts_at = ?, ends_at = ?,
           timezone = ?, all_day = ?, kind = ?, recurrence_rule = ?,
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        parsed.title,
        parsed.notes,
        parsed.location,
        parsed.startsAt,
        parsed.endsAt,
        parsed.timezone,
        parsed.allDay ? 1 : 0,
        parsed.kind,
        parsed.recurrenceRule,
        eventId,
        ownerId,
      )
      .run();

    return c.json({
      ok: true,
      event: {
        id: eventId,
        title: parsed.title,
        notes: parsed.notes,
        location: parsed.location,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        timezone: parsed.timezone,
        allDay: parsed.allDay,
        kind: parsed.kind,
        recurrenceRule: parsed.recurrenceRule,
        sourceId: null,
        sourceName: parsed.kind === "birthday" ? "Birthdays" : "Personal events",
        sourceKind: "native",
      },
    });
  });

  app.delete("/api/calendar/events/:eventId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const result = await c.env.DB.prepare(
      "DELETE FROM user_calendar_events WHERE id = ? AND user_id = ?",
    )
      .bind(c.req.param("eventId"), ownerId)
      .run();
    if ((result.meta?.changes || 0) === 0) return c.json({ error: "Event not found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/agent/reminders", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const body = await c.req.json<AgentReminderInput>().catch((): AgentReminderInput => ({}));
    const reminder = await createAgentReminder(c.env, ownerId, body);
    if ("error" in reminder) return c.json({ error: reminder.error }, 400);

    return c.json({ ok: true, reminder });
  });

  app.put("/api/agent/reminders/:reminderId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const body = await c.req.json<AgentReminderInput>().catch((): AgentReminderInput => ({}));
    const reminder = await updateAgentReminder(
      c.env,
      ownerId,
      c.req.param("reminderId"),
      body,
    );
    if ("error" in reminder) {
      return c.json({ error: reminder.error }, (reminder.status || 400) as any);
    }

    return c.json({ ok: true, reminder });
  });

  app.put("/api/agent/reminders/:reminderId/cancel", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const result = await cancelAgentReminder(c.env, ownerId, c.req.param("reminderId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });
}

async function loadSocialPublishingCalendar(
  env: AppContext["env"],
  ownerId: string,
  window: { start: string; end: string },
) {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) {
    return { ready: false, publications: [] };
  }

  return {
    ready: true,
    publications: await listCalendarSocialPublications(env, ownerId, window),
  };
}

async function parseCalendarEventBody(c: AppContext): Promise<
  | {
      title: string;
      notes: string | null;
      location: string | null;
      startsAt: string;
      endsAt: string;
      timezone: string;
      allDay: boolean;
      kind: "event" | "birthday";
      recurrenceRule: string | null;
    }
  | { error: string }
> {
  const body = (await c.req.json().catch(() => null)) as {
    title?: unknown;
    notes?: unknown;
    location?: unknown;
    startDate?: unknown;
    startTime?: unknown;
    endDate?: unknown;
    endTime?: unknown;
    timezone?: unknown;
    allDay?: unknown;
    kind?: unknown;
    recurrenceRule?: unknown;
  } | null;

  const title = normalizeNullableText(body?.title);
  const notes = normalizeNullableText(body?.notes);
  const location = normalizeNullableText(body?.location);
  const startDate = typeof body?.startDate === "string" ? body.startDate.trim() : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate.trim() : "";
  const startTime = typeof body?.startTime === "string" ? body.startTime.trim() : "";
  const endTime = typeof body?.endTime === "string" ? body.endTime.trim() : "";
  const kind = body?.kind === "birthday" ? "birthday" : "event";
  const allDay = kind === "birthday" ? true : body?.allDay === true;

  if (!title) return { error: "Title is required" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: "Start and end dates must be in YYYY-MM-DD format" };
  }
  if (!allDay && (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime))) {
    return { error: "Start and end times must be in HH:MM format" };
  }

  const timezone = normalizeTimeZone(body?.timezone) || "UTC";
  const recurrenceRuleInput =
    typeof body?.recurrenceRule === "string"
      ? body.recurrenceRule.trim().toLowerCase()
      : body?.recurrenceRule;
  const recurrenceRule = normalizeEventRecurrenceRule(
    body?.recurrenceRule,
    kind,
    startDate,
  );
  if (recurrenceRuleInput && recurrenceRuleInput !== "none" && !recurrenceRule) {
    return { error: "Invalid recurrence value" };
  }

  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [startHour, startMinute] = allDay ? [0, 0] : startTime.split(":").map(Number);
  const [endHour, endMinute] = allDay ? [0, 0] : endTime.split(":").map(Number);
  const normalizedEndDate = allDay ? addDaysToDateString(endDate, 1) : endDate;
  const [endYear, endMonth, endDay] = normalizedEndDate.split("-").map(Number);

  const startsAt = new Date(
    getUtcMsForLocalTime(
      { year: startYear, month: startMonth, day: startDay, hour: startHour, minute: startMinute },
      timezone,
    ),
  ).toISOString();
  const endsAt = new Date(
    getUtcMsForLocalTime(
      { year: endYear, month: endMonth, day: endDay, hour: endHour, minute: endMinute },
      timezone,
    ),
  ).toISOString();

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { error: "End must be after start" };
  }

  return {
    title,
    notes,
    location,
    startsAt,
    endsAt,
    timezone,
    allDay,
    kind,
    recurrenceRule,
  };
}

function serializeCalendarEvent(event: DbUserCalendarEvent) {
  const kind = event.kind === "birthday" ? "birthday" : "event";
  return {
    id: event.id,
    title: event.title,
    notes: event.notes,
    location: event.location,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    allDay: event.all_day === 1,
    kind,
    recurrenceRule: event.recurrence_rule,
    sourceId: null,
    sourceName: kind === "birthday" ? "Birthdays" : "Personal events",
    sourceKind: "native",
    createdAt: event.created_at,
  };
}

function serializeCalendarSource(source: DbCalendarSource) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    originalFilename: source.original_filename,
    sourceUrlHint: source.source_url_hint ?? null,
    importedEventCount: source.imported_event_count,
    lastSyncedAt: source.last_synced_at ?? null,
    lastSyncError: source.last_sync_error ?? null,
    createdAt: source.created_at,
  };
}

function serializeImportedCalendarEvent(event: DbCalendarSourceEvent & { source_name: string }) {
  return {
    id: event.id,
    title: event.title,
    notes: event.notes,
    location: event.location,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    allDay: event.all_day === 1,
    kind: "event",
    recurrenceRule: null,
    sourceId: event.source_id,
    sourceName: event.source_name,
    sourceKind: "imported",
    createdAt: event.created_at,
  };
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchDueCalendarSourceRefreshes,
  importIcsUpload,
  removeImportedCalendarEvent,
  removeCalendarSource,
  refreshCalendarSource,
  subscribeIcsUrl,
} from "./calendar-sources";
import type { Env } from "./types";

type SourceRow = {
  id: string;
  user_id: string;
  kind: "ics_upload" | "ics_url";
  name: string;
  original_filename: string | null;
  encrypted_source_url: string | null;
  source_url_hint: string | null;
  status: "active" | "archived";
  imported_event_count: number;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  source_id: string;
  external_key: string;
  external_uid: string | null;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  all_day: number;
  is_busy: number;
  created_at: string;
  updated_at: string;
};

type TestState = {
  sources: SourceRow[];
  events: EventRow[];
  dismissals: Set<string>;
  installSecrets: Map<string, string>;
};

const FEED_ONE = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Personal Calendar
BEGIN:VEVENT
UID:event-1
DTSTART:20260612T100000Z
DTEND:20260612T110000Z
SUMMARY:Client call
DESCRIPTION:Bring notes
LOCATION:Zoom
END:VEVENT
END:VCALENDAR`;

const FEED_TWO = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Personal Calendar
BEGIN:VEVENT
UID:event-2
DTSTART:20260613T150000Z
DTEND:20260613T153000Z
SUMMARY:Follow-up
END:VEVENT
END:VCALENDAR`;

const FEED_RECURRING = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Recurring Calendar
BEGIN:VEVENT
UID:recurring-1
DTSTART:20240101T090000Z
DTEND:20240101T100000Z
RRULE:FREQ=MONTHLY
SUMMARY:Monthly planning
END:VEVENT
END:VCALENDAR`;

const FEED_YEARLY_BIRTHDAY = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Birthdays
BEGIN:VEVENT
UID:birthday-1
DTSTART;VALUE=DATE:20200523
DTEND;VALUE=DATE:20200524
RRULE:FREQ=YEARLY
SUMMARY:Stephens Birthday
TRANSP:TRANSPARENT
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:timed-1
DTSTART;TZID=Europe/Dublin:20160519T133000
DTEND;TZID=Europe/Dublin:20160519T143000
RRULE:FREQ=YEARLY;WKST=MO
SUMMARY:Ide and ruain
TRANSP:OPAQUE
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

const FEED_TRANSPARENT_ALL_DAY = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Personal Calendar
BEGIN:VEVENT
UID:event-transparent
DTSTART;VALUE=DATE:20260615
DTEND;VALUE=DATE:20260616
SUMMARY:Center parks
TRANSP:TRANSPARENT
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

const FEED_WITH_MANY_PAST_EVENTS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Large Calendar
${Array.from({ length: 2501 }, (_, index) => {
  const day = String((index % 28) + 1).padStart(2, "0");
  const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, "0");
  const year = 2017 + Math.floor(index / 336);
  return `BEGIN:VEVENT
UID:past-${index}
DTSTART:${year}${month}${day}T090000Z
DTEND:${year}${month}${day}T100000Z
SUMMARY:Past ${index}
END:VEVENT`;
}).join("\n")}
BEGIN:VEVENT
UID:future-target
DTSTART;VALUE=DATE:20260615
DTEND;VALUE=DATE:20260620
SUMMARY:Center parks
TRANSP:TRANSPARENT
END:VEVENT
END:VCALENDAR`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calendar source subscriptions", () => {
  it("accepts an empty Soulink feed before the first scheduled call", async () => {
    const { env, state } = createCalendarSourceEnv();
    const fetcher = vi.fn(async () => new Response(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Soulink//Calls//EN\r\nEND:VCALENDAR\r\n",
      { headers: { "content-type": "text/calendar" } },
    )) as typeof fetch;

    const result = await subscribeIcsUrl(env, "owner", {
      url: "https://soulinkfoundation.org/api/me3/calendar/feeds/123e4567-e89b-42d3-a456-426614174000/feed-token",
    }, fetcher);

    expect(result.importedCount).toBe(0);
    expect(state.sources).toHaveLength(1);
    expect(state.events).toHaveLength(0);
  });

  it("subscribes to an ICS URL without storing the URL in plain text", async () => {
    const { env, state } = createCalendarSourceEnv();
    const fetcher = vi.fn(async () => new Response(FEED_ONE, {
      headers: { "content-type": "text/calendar" },
    })) as typeof fetch;

    const result = await subscribeIcsUrl(env, "owner", {
      url: "https://calendar.google.com/calendar/ical/private/basic.ics",
    }, fetcher);

    expect(result.importedCount).toBe(1);
    expect(result.source).toMatchObject({
      name: "Personal Calendar",
      kind: "ics_url",
      sourceUrlHint: "calendar.google.com ....ics",
      lastSyncError: null,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0]!.encrypted_source_url).toMatch(/^v1\./);
    expect(state.sources[0]!.encrypted_source_url).not.toContain("calendar.google.com");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      title: "Client call",
      external_uid: "event-1",
      starts_at: "2026-06-12T10:00:00.000Z",
      ends_at: "2026-06-12T11:00:00.000Z",
      all_day: 0,
    });
  });

  it("refreshes due subscribed sources and replaces stale events", async () => {
    const { env, state } = createCalendarSourceEnv();
    const firstFetcher = vi.fn(async () => new Response(FEED_ONE)) as typeof fetch;
    const secondFetcher = vi.fn(async () => new Response(FEED_TWO)) as typeof fetch;

    const subscribed = await subscribeIcsUrl(env, "owner", {
      name: "Busy blocks",
      url: "https://calendar.google.com/calendar/ical/private/basic.ics",
    }, firstFetcher);
    state.sources[0]!.last_synced_at = "2026-06-10T04:00:00.000Z";

    const dispatched = await dispatchDueCalendarSourceRefreshes(env, secondFetcher);

    expect(dispatched).toEqual({ refreshed: 1, failed: 0 });
    expect(state.sources[0]).toMatchObject({
      id: subscribed.source.id,
      imported_event_count: 1,
      last_sync_error: null,
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      title: "Follow-up",
      external_uid: "event-2",
      starts_at: "2026-06-13T15:00:00.000Z",
    });
  });

  it("syncs long-running recurring events from the current window", async () => {
    const { env, state } = createCalendarSourceEnv();
    const fetcher = vi.fn(async () => new Response(FEED_RECURRING)) as typeof fetch;

    const result = await subscribeIcsUrl(env, "owner", {
      url: "https://calendar.google.com/calendar/ical/private/recurring.ics",
    }, fetcher);

    expect(result.importedCount).toBeGreaterThan(12);
    expect(state.events[0]).toMatchObject({
      title: "Monthly planning",
      external_uid: "recurring-1",
    });
    expect(Date.parse(state.events[0]!.starts_at)).toBeGreaterThanOrEqual(
      Date.parse("2026-03-12T12:00:00.000Z"),
    );
  });

  it("preserves yearly all-day and timed recurrence dates from Google exports", async () => {
    const { env, state } = createCalendarSourceEnv();
    const file = new File([FEED_YEARLY_BIRTHDAY], "birthdays.ics", {
      type: "text/calendar",
    });
    const formData = new FormData();
    formData.set("file", file);

    await importIcsUpload(env, "owner", formData);

    expect(state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Stephens Birthday",
          starts_at: "2026-05-23T00:00:00.000Z",
          ends_at: "2026-05-24T00:00:00.000Z",
          all_day: 1,
          is_busy: 0,
        }),
        expect.objectContaining({
          title: "Ide and ruain",
          starts_at: "2026-05-19T12:30:00.000Z",
          ends_at: "2026-05-19T13:30:00.000Z",
          all_day: 0,
          is_busy: 1,
        }),
      ]),
    );
    expect(
      state.events.some(
        (event) =>
          event.title === "Stephens Birthday" &&
          event.starts_at === "2026-06-14T20:43:29.000Z",
      ),
    ).toBe(false);
  });

  it("imports transparent Google events for display without marking them busy", async () => {
    const { env, state } = createCalendarSourceEnv();
    const file = new File([FEED_TRANSPARENT_ALL_DAY], "personal.ics", {
      type: "text/calendar",
    });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("name", "Google");

    const result = await importIcsUpload(env, "owner", formData);

    expect(result.importedCount).toBe(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      title: "Center parks",
      starts_at: "2026-06-15T00:00:00.000Z",
      ends_at: "2026-06-16T00:00:00.000Z",
      all_day: 1,
      is_busy: 0,
    });
  });

  it("keeps current and upcoming events when a large import hits the source cap", async () => {
    const { env, state } = createCalendarSourceEnv();
    const file = new File([FEED_WITH_MANY_PAST_EVENTS], "large.ics", {
      type: "text/calendar",
    });
    const formData = new FormData();
    formData.set("file", file);

    const result = await importIcsUpload(env, "owner", formData);

    expect(result.importedCount).toBe(2500);
    expect(state.events).toHaveLength(2500);
    expect(state.events.some((event) => event.title === "Center parks")).toBe(true);
  });

  it("keeps existing events and records an error when refresh fails", async () => {
    const { env, state } = createCalendarSourceEnv();
    const firstFetcher = vi.fn(async () => new Response(FEED_ONE)) as typeof fetch;
    const failingFetcher = vi.fn(async () => new Response("nope", { status: 404 })) as typeof fetch;

    const subscribed = await subscribeIcsUrl(env, "owner", {
      url: "https://calendar.google.com/calendar/ical/private/basic.ics",
    }, firstFetcher);

    await expect(
      refreshCalendarSource(env, "owner", subscribed.source.id, failingFetcher),
    ).rejects.toThrow("Calendar feed returned HTTP 404.");

    expect(state.sources[0]!.last_sync_error).toBe("Calendar feed returned HTTP 404.");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]!.title).toBe("Client call");
  });

  it("removes an imported source and its events", async () => {
    const { env, state } = createCalendarSourceEnv();
    const fetcher = vi.fn(async () => new Response(FEED_ONE)) as typeof fetch;
    const subscribed = await subscribeIcsUrl(env, "owner", {
      url: "https://calendar.google.com/calendar/ical/private/basic.ics",
    }, fetcher);

    const result = await removeCalendarSource(env, "owner", subscribed.source.id);

    expect(result).toEqual({ ok: true, sourceId: subscribed.source.id });
    expect(state.sources[0]).toMatchObject({
      status: "archived",
      imported_event_count: 0,
      encrypted_source_url: null,
    });
    expect(state.events).toHaveLength(0);
  });

  it("keeps a removed imported event hidden after source refresh", async () => {
    const { env, state } = createCalendarSourceEnv();
    const fetcher = vi.fn(async () => new Response(FEED_ONE)) as typeof fetch;
    const subscribed = await subscribeIcsUrl(env, "owner", {
      url: "https://calendar.google.com/calendar/ical/private/basic.ics",
    }, fetcher);
    const importedEventId = state.events[0]!.id;

    await expect(
      removeImportedCalendarEvent(env, "owner", importedEventId),
    ).resolves.toEqual({ ok: true, eventId: importedEventId });
    expect(state.events).toHaveLength(0);

    await refreshCalendarSource(env, "owner", subscribed.source.id, fetcher);

    expect(state.events).toHaveLength(0);
    expect(state.dismissals.size).toBe(1);
  });
});

function createCalendarSourceEnv() {
  const state: TestState = {
    sources: [],
    events: [],
    dismissals: new Set(),
    installSecrets: new Map(),
  };

  const db = {
    prepare(sql: string) {
      const statement = (values: unknown[]) => ({
        async all<T>() {
          if (sql.includes("FROM calendar_sources") && sql.includes("kind = 'ics_url'")) {
            const [cutoff] = values;
            const results = state.sources.filter(
              (source) =>
                source.kind === "ics_url" &&
                source.status === "active" &&
                source.encrypted_source_url &&
                (!source.last_synced_at || source.last_synced_at < String(cutoff)),
            );
            return { results: results as T[] };
          }
          if (sql.includes("FROM calendar_source_event_dismissals")) {
            const [sourceId] = values;
            return {
              results: [...state.dismissals]
                .filter((key) => key.startsWith(`${sourceId}:`))
                .map((key) => ({
                  external_key: key.slice(String(sourceId).length + 1),
                })) as T[],
            };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          if (sql.includes("SELECT value FROM install_secrets")) {
            const [name] = values;
            const value = state.installSecrets.get(String(name));
            return value ? ({ value } as T) : null;
          }

          if (sql.includes("FROM calendar_sources") && sql.includes("WHERE id = ?")) {
            const [id, userId] = values;
            return (
              state.sources.find(
                (source) =>
                  source.id === id &&
                  source.user_id === userId &&
                  source.status === "active",
            ) as T
            ) || null;
          }

          if (sql.includes("FROM calendar_source_events")) {
            const [eventId, userId] = values;
            const event = state.events.find((item) => item.id === eventId);
            const source = event
              ? state.sources.find((item) => item.id === event.source_id)
              : null;
            return event && source && source.user_id === userId && source.status === "active"
              ? ({
                  source_id: event.source_id,
                  external_key: event.external_key,
                } as T)
              : null;
          }

          return null;
        },
        async run() {
          applyStatement(state, sql, values);
          return { meta: { changes: 1 } };
        },
      });

      return {
        bind(...values: unknown[]) {
          return statement(values);
        },
        all<T>() {
          return statement([]).all<T>();
        },
        first<T>() {
          return statement([]).first<T>();
        },
        run() {
          return statement([]).run();
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) {
        await statement.run();
      }
      return [];
    },
  };

  return {
    env: {
      DB: db,
      TOKEN_ENCRYPTION_KEY: "test-calendar-encryption-key",
    } as unknown as Env,
    state,
  };
}

function applyStatement(state: TestState, sql: string, values: unknown[]) {
  if (sql.includes("INSERT INTO install_secrets")) {
    const [name, value] = values;
    if (!state.installSecrets.has(String(name))) {
      state.installSecrets.set(String(name), String(value));
    }
    return;
  }

  if (sql.includes("INSERT INTO calendar_sources")) {
    const [
      id,
      ownerId,
      kind,
      name,
      originalFilename,
      encryptedSourceUrl,
      sourceUrlHint,
      importedEventCount,
      lastSyncedAt,
      lastSyncError,
    ] = values;
    state.sources.push({
      id: id as string,
      user_id: ownerId as string,
      kind: kind as "ics_upload" | "ics_url",
      name: name as string,
      original_filename: originalFilename as string | null,
      encrypted_source_url: encryptedSourceUrl as string | null,
      source_url_hint: sourceUrlHint as string | null,
      status: "active",
      imported_event_count: importedEventCount as number,
      last_synced_at: lastSyncedAt as string | null,
      last_sync_error: lastSyncError as string | null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return;
  }

  if (sql.includes("DELETE FROM calendar_source_events")) {
    const [targetId] = values;
    if (sql.includes("WHERE id = ?")) {
      state.events = state.events.filter((event) => event.id !== targetId);
    } else {
      state.events = state.events.filter((event) => event.source_id !== targetId);
    }
    return;
  }

  if (sql.includes("INSERT OR IGNORE INTO calendar_source_event_dismissals")) {
    const [sourceId, externalKey] = values;
    state.dismissals.add(`${sourceId}:${externalKey}`);
    return;
  }

  if (sql.includes("UPDATE calendar_sources") && sql.includes("status = 'archived'")) {
    const [sourceId] = values;
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) return;
    source.status = "archived";
    source.encrypted_source_url = null;
    source.imported_event_count = 0;
    source.updated_at = new Date().toISOString();
    return;
  }

  if (sql.includes("UPDATE calendar_sources") && sql.includes("imported_event_count")) {
    const [importedEventCount, lastSyncedAt, lastSyncError, sourceId] = values;
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) return;
    source.imported_event_count = importedEventCount as number;
    source.last_synced_at = lastSyncedAt as string | null;
    source.last_sync_error = lastSyncError as string | null;
    source.updated_at = new Date().toISOString();
    return;
  }

  if (sql.includes("UPDATE calendar_sources") && sql.includes("last_sync_error")) {
    const [lastSyncError, sourceId] = values;
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) return;
    source.last_sync_error = lastSyncError as string | null;
    source.updated_at = new Date().toISOString();
    return;
  }

  if (sql.includes("INSERT INTO calendar_source_events")) {
    const [
      id,
      sourceId,
      externalKey,
      externalUid,
      title,
      notes,
      location,
      startsAt,
      endsAt,
      timezone,
      allDay,
      isBusy,
    ] = values;
    state.events.push({
      id: id as string,
      source_id: sourceId as string,
      external_key: externalKey as string,
      external_uid: externalUid as string | null,
      title: title as string,
      notes: notes as string | null,
      location: location as string | null,
      starts_at: startsAt as string,
      ends_at: endsAt as string,
      timezone: timezone as string | null,
      all_day: allDay as number,
      is_busy: isBusy as number,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

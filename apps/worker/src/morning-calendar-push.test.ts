import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchDueMorningCalendarPushes, MORNING_CALENDAR_PUSH_SCHEMA } from "./morning-calendar-push";
import type { Env } from "./types";

// Failure modes: UTC/local date drift, DST short/long days, early delivery,
// repeated/concurrent cron, abandoned claims, relay failures, private titles,
// truncated counts, missing recurring birthdays or subscribed events, tasks leaking.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });

function fixture(timezone = "Europe/Dublin", time = "07:30") {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  raw.exec(`
    CREATE TABLE owner_profile(id TEXT PRIMARY KEY, timezone TEXT, daily_briefing_time TEXT, created_at TEXT);
    CREATE TABLE install_secrets(name TEXT, value TEXT);
    INSERT INTO install_secrets VALUES('ME3_CLOUD_OWNER_ID','cloud-owner'),('ME3_CORE_INSTALL_ID','install'),('ME3_CLOUD_CORE_TOKEN','test-token');
    CREATE TABLE user_calendar_events(id TEXT, user_id TEXT, title TEXT, notes TEXT, location TEXT,
      starts_at TEXT, ends_at TEXT, timezone TEXT, all_day INTEGER, kind TEXT, recurrence_rule TEXT, created_at TEXT);
    CREATE TABLE sites(id TEXT, user_id TEXT);
    INSERT INTO sites VALUES('site','owner');
    CREATE TABLE bookings(id TEXT, site_id TEXT, guest_name TEXT, starts_at TEXT, ends_at TEXT, status TEXT);
    CREATE TABLE user_reminders(id TEXT, user_id TEXT, title TEXT, notes TEXT, remind_at TEXT, timezone TEXT,
      recurrence_rule TEXT, context_type TEXT, context_id TEXT, context_label TEXT, status TEXT,
      delivered_at TEXT, dismissed_at TEXT, created_at TEXT);
    CREATE TABLE calendar_sources(id TEXT, user_id TEXT, status TEXT);
    CREATE TABLE calendar_source_events(id TEXT, source_id TEXT, external_key TEXT, external_uid TEXT,
      title TEXT, notes TEXT, location TEXT, starts_at TEXT, ends_at TEXT, timezone TEXT, all_day INTEGER, is_busy INTEGER, created_at TEXT);
    CREATE TABLE calendar_source_event_dismissals(source_id TEXT, external_key TEXT);
  `);
  raw.prepare("INSERT INTO owner_profile VALUES('owner',?,?, '2026-01-01')").run(timezone, time);
  for (const sql of MORNING_CALENDAR_PUSH_SCHEMA) raw.exec(sql);
  const queries: string[] = [];
  const env = { DB: { prepare(sql: string) {
    queries.push(sql);
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async first() { return query.get(...values as never[]) ?? null; },
      async all() { return { results: query.all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; },
    }; return statement;
  } }, ME3_CLOUD_API_ORIGIN: "https://cloud.example.test" } as unknown as Env;
  const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({ ok: true, matched: 1, sent: 1, retryable: 0 }));
  vi.stubGlobal("fetch", fetch);
  return { raw, env, fetch, queries, dispatch: (now = "2026-10-13T06:30:00.000Z") => dispatchDueMorningCalendarPushes(env, new Date(now)) };
}

describe("morning calendar push with real SQLite", () => {
  it.each([
    ["Europe/Dublin", "2026-03-29T06:29:00Z", "2026-03-29T06:30:00Z", "2026-03-29"],
    ["Europe/Dublin", "2026-10-25T07:29:00Z", "2026-10-25T07:30:00Z", "2026-10-25"],
    ["Pacific/Auckland", "2026-10-12T18:29:00Z", "2026-10-12T18:30:00Z", "2026-10-13"],
    ["America/Los_Angeles", "2026-10-13T14:29:00Z", "2026-10-13T14:30:00Z", "2026-10-13"],
  ])("waits for 07:30 in %s and uses the local date", async (tz, before, due, date) => {
    const f = fixture(tz); await f.dispatch(before); expect(f.fetch).not.toHaveBeenCalled();
    await f.dispatch(due);
    expect(String(f.fetch.mock.calls[0][0])).toContain(encodeURIComponent(`daily:${date}`));
  });

  it("uses the owner's configured time and still catches up later that day", async () => {
    const f = fixture("UTC", "10:45"); await f.dispatch("2026-10-13T10:44:59Z");
    expect(f.fetch).not.toHaveBeenCalled(); await f.dispatch("2026-10-13T16:00:00Z");
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends an empty day once across concurrent cron runs and later retries, then again next day", async () => {
    const f = fixture(); await Promise.all([f.dispatch(), f.dispatch()]); await f.dispatch("2026-10-13T23:00:00Z");
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body))).toEqual({
      birthdayNames: [], counts: { birthdays: 0, events: 0, bookings: 0, reminders: 0 },
    });
    await f.dispatch("2026-10-14T06:30:00Z"); expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries failed relay calls with the same deterministic ID and recovers expired pending claims", async () => {
    const f = fixture(); f.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await f.dispatch(); await f.dispatch("2026-10-13T06:35:00Z"); await f.dispatch("2026-10-13T06:40:00Z");
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(String(f.fetch.mock.calls[0][0])).toBe(String(f.fetch.mock.calls[1][0]));
    f.raw.exec("UPDATE morning_calendar_push_dispatches SET status='pending', claimed_at=0");
    await f.dispatch("2026-10-13T06:45:00Z"); expect(f.fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps partial delivery retryable and completes when Cloud confirms earlier sends", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(Response.json({ ok: true, matched: 2, sent: 1, retryable: 1 }));
    f.fetch.mockResolvedValueOnce(Response.json({ ok: true, matched: 2, sent: 1, alreadySent: 1, retryable: 0 }));
    await f.dispatch(); await f.dispatch(); await f.dispatch(); expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a recurring birthday on one local date across a short DST day", async () => {
    const f = fixture();
    f.raw.exec(`INSERT INTO user_calendar_events VALUES('dad','owner','Dad',NULL,NULL,
      '2025-03-29T00:00:00.000Z','2025-03-30T00:00:00.000Z','Europe/Dublin',1,'birthday','FREQ=YEARLY','2025-01-01');`);
    await f.dispatch("2026-03-29T06:30:00Z"); await f.dispatch("2026-03-30T06:30:00Z");
    expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).counts.birthdays).toBe(1);
    expect(JSON.parse(String(f.fetch.mock.calls[1][1]?.body)).counts.birthdays).toBe(0);
  });

  it("uses complete calendar counts, recurring birthdays, and subscribed events without sending other titles", async () => {
    const f = fixture();
    f.raw.exec(`
      INSERT INTO user_calendar_events VALUES('dad','owner','Dad\u2019s birthday','private notes',NULL,
        '2025-10-12T23:00:00.000Z','2025-10-13T23:00:00.000Z','Europe/Dublin',1,'birthday','FREQ=YEARLY','2025-01-01');
      INSERT INTO user_calendar_events VALUES('sam','owner','Sam\u0027\u0027s birthday',NULL,NULL,
        '2026-10-12T23:00:00.000Z','2026-10-13T23:00:00.000Z','Europe/Dublin',1,'birthday',NULL,'2026-01-01');
      INSERT INTO bookings VALUES('booking','site','Private Guest','2026-10-12T22:00:00.000Z','2026-10-13T00:30:00.000Z','confirmed');
      INSERT INTO bookings VALUES('cancelled','site','Cancelled Guest','2026-10-13T10:00:00.000Z','2026-10-13T11:00:00.000Z','cancelled');
      INSERT INTO user_reminders VALUES('reminder','owner','Private reminder','private notes','2026-10-13T20:00:00.000Z',NULL,NULL,NULL,NULL,NULL,'pending',NULL,NULL,'2026-01-01');
      INSERT INTO calendar_sources VALUES('source','owner','active'),('inactive','owner','inactive');
      INSERT INTO calendar_source_events VALUES('import','source','key',NULL,'Private subscribed event',NULL,NULL,'2026-10-13T08:00:00.000Z','2026-10-13T09:00:00.000Z',NULL,0,1,'2026-01-01');
      INSERT INTO calendar_source_events VALUES('dismissed','source','dismissed-key',NULL,'Dismissed event',NULL,NULL,'2026-10-13T08:00:00.000Z','2026-10-13T09:00:00.000Z',NULL,0,1,'2026-01-01');
      INSERT INTO calendar_source_event_dismissals VALUES('source','dismissed-key');
      INSERT INTO calendar_source_events VALUES('inactive-event','inactive','key',NULL,'Inactive event',NULL,NULL,'2026-10-13T08:00:00.000Z','2026-10-13T09:00:00.000Z',NULL,0,1,'2026-01-01');
    `);
    for (let i = 0; i < 15; i++) f.raw.prepare("INSERT INTO user_calendar_events VALUES(?, 'owner','Private event','private notes',NULL,'2026-10-13T09:00:00.000Z','2026-10-13T10:00:00.000Z',NULL,0,'event',NULL,'2026-01-01')").run(`event-${i}`);
    await f.dispatch();
    expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body))).toEqual({
      birthdayNames: ["Dad", "Sam"], counts: { birthdays: 2, events: 16, bookings: 1, reminders: 1 },
    });
    expect(f.queries.some(sql => sql.includes("mission_tasks"))).toBe(false);
    expect(String(f.fetch.mock.calls[0][1]?.body)).not.toMatch(/Private|notes|Guest/);
  });

  it.each([
    ["2026-03-29", "2026-03-29T00:00:00.000Z", "2026-03-29T23:00:00.000Z", "2026-03-29T06:30:00Z", "Europe/Dublin"],
    ["2026-10-25", "2026-10-24T23:00:00.000Z", "2026-10-26T00:00:00.000Z", "2026-10-25T07:30:00Z", "Europe/Dublin"],
    ["2026-09-27", "2026-09-26T12:00:00.000Z", "2026-09-27T11:00:00.000Z", "2026-09-26T18:30:00Z", "Pacific/Auckland"],
    ["2026-04-05", "2026-04-04T11:00:00.000Z", "2026-04-05T12:00:00.000Z", "2026-04-04T19:30:00Z", "Pacific/Auckland"],
    ["2026-03-29", "2026-03-28T22:00:00.000Z", "2026-03-29T21:00:00.000Z", "2026-03-29T04:30:00Z", "Asia/Beirut"],
  ])("counts within the actual DST day %s", async (_date, start, end, now, timezone) => {
    const f = fixture(timezone);
    for (const [id, instant] of [["before", new Date(Date.parse(start) - 1).toISOString()], ["start", start], ["last", new Date(Date.parse(end) - 1).toISOString()], ["end", end]]) {
      f.raw.prepare("INSERT INTO user_reminders VALUES(?,'owner','Private reminder',NULL,?,NULL,NULL,NULL,NULL,NULL,'pending',NULL,NULL,'2026-01-01')").run(id, instant);
    }
    await f.dispatch(now);
    expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).counts.reminders).toBe(2);
  });
});

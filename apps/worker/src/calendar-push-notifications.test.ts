import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchDueCalendarPushNotifications,
  eventLikeCandidate,
  taskCandidate,
} from "./calendar-push-notifications";
import { notifyCalendarItemDue } from "./push-notifications";
import type { Env } from "./types";

vi.mock("./push-notifications", () => ({ notifyCalendarItemDue: vi.fn() }));

describe("calendar push notification timing", () => {
  it("alerts timed events fifteen minutes before they start", () => {
    expect(eventLikeCandidate(
      "owner",
      "events",
      "event-1",
      "Planning call",
      "2026-08-19T10:30:00.000Z",
      false,
      "Europe/Dublin",
      "Europe/Dublin",
    )).toEqual({
      userId: "owner",
      category: "events",
      itemId: "event-1",
      title: "Planning call",
      occurrenceId: "2026-08-19T10:30:00.000Z",
      alertOffsetMinutes: 15,
      alertAt: "2026-08-19T10:15:00.000Z",
    });
  });

  it("alerts all-day calendar items at nine in the owner's timezone", () => {
    expect(eventLikeCandidate(
      "owner",
      "birthdays",
      "birthday-1",
      "Kieran’s birthday",
      "2026-08-18T23:00:00.000Z",
      true,
      "Europe/Dublin",
      "UTC",
    ).alertAt).toBe("2026-08-19T08:00:00.000Z");
  });

  it("alerts date-only tasks at nine and timed tasks at their due time", () => {
    expect(taskCandidate("owner", "task-1", "Send proposal", "2026-08-19", "Europe/Dublin").alertAt)
      .toBe("2026-08-19T08:00:00.000Z");
    expect(taskCandidate(
      "owner",
      "task-2",
      "Call supplier",
      "2026-08-19T12:45:00.000Z",
      "Europe/Dublin",
    ).alertAt).toBe("2026-08-19T12:45:00.000Z");
  });
});

const T = Date.parse("2026-10-20T09:00:00.000Z");
const minutes = (count: number) => count * 60 * 1000;

function calendarPushDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE owner_profile (id TEXT, timezone TEXT, created_at TEXT);
    CREATE TABLE mission_tasks (id TEXT, user_id TEXT, title TEXT, due_at TEXT, scheduled_for TEXT, archived_at TEXT, status TEXT);
    CREATE TABLE user_calendar_events (id TEXT, user_id TEXT, title TEXT, notes TEXT, location TEXT, starts_at TEXT, ends_at TEXT, timezone TEXT, all_day INTEGER, kind TEXT, recurrence_rule TEXT, created_at TEXT);
    CREATE TABLE sites (id TEXT, user_id TEXT);
    CREATE TABLE bookings (id TEXT, site_id TEXT, guest_name TEXT, status TEXT, starts_at TEXT, ends_at TEXT);
    CREATE TABLE user_reminders (id TEXT, user_id TEXT, title TEXT, notes TEXT, remind_at TEXT, timezone TEXT, recurrence_rule TEXT, context_type TEXT, context_id TEXT, context_label TEXT, status TEXT, delivered_at TEXT, dismissed_at TEXT, created_at TEXT);
    CREATE TABLE calendar_sources (id TEXT, user_id TEXT, status TEXT);
    CREATE TABLE calendar_source_events (id TEXT, source_id TEXT, external_key TEXT, external_uid TEXT, title TEXT, notes TEXT, location TEXT, starts_at TEXT, ends_at TEXT, timezone TEXT, all_day INTEGER, is_busy INTEGER, created_at TEXT);
    CREATE TABLE calendar_source_event_dismissals (source_id TEXT, external_key TEXT);
    CREATE TABLE calendar_push_dispatches (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, item_id TEXT NOT NULL,
      occurrence_id TEXT NOT NULL, alert_offset_minutes INTEGER NOT NULL, alert_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, category, item_id, occurrence_id, alert_offset_minutes)
    );
    INSERT INTO owner_profile VALUES ('owner', 'Europe/London', '2026-01-01');
  `);
  const statement = (sql: string, values: unknown[] = []) => ({
    all: async () => ({ results: raw.prepare(sql).all(...values as never[]) }),
    first: async () => raw.prepare(sql).get(...values as never[]) ?? null,
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }),
  });
  return {
    raw,
    env: { DB: { prepare: (sql: string) => ({ ...statement(sql), bind: (...values: unknown[]) => statement(sql, values) }) } } as unknown as Env,
    addReminder: (id: string, remindAt: number) => raw.prepare(
      "INSERT INTO user_reminders (id, user_id, title, remind_at, timezone, status) VALUES (?, 'owner', ?, ?, 'Europe/London', 'pending')",
    ).run(id, `Reminder ${id}`, new Date(remindAt).toISOString()),
    dispatch: (id: string) => raw.prepare(
      "SELECT status, error_message FROM calendar_push_dispatches WHERE item_id = ?",
    ).get(id) as { status: string; error_message: string | null } | undefined,
  };
}

describe("calendar push dispatch", () => {
  beforeEach(() => {
    vi.mocked(notifyCalendarItemDue).mockReset();
    vi.mocked(notifyCalendarItemDue).mockResolvedValue({ ok: true, matched: 1, sent: 1 });
  });

  it("catches every reminder due between quarter-hour ticks exactly once", async () => {
    const db = calendarPushDb();
    db.addReminder("just-after-tick", T + 1000);
    db.addReminder("mid-period", T + minutes(7));
    db.addReminder("on-next-tick", T + minutes(15));

    for (const tick of [T, T + minutes(15), T + minutes(30)]) {
      await dispatchDueCalendarPushNotifications(db.env, new Date(tick));
    }

    const sentIds = vi.mocked(notifyCalendarItemDue).mock.calls.map((call) => call[1].itemId).sort();
    expect(sentIds).toEqual(["just-after-tick", "mid-period", "on-next-tick"]);
  });

  it("does not resend a failed alert on every minute tick", async () => {
    const db = calendarPushDb();
    db.addReminder("flaky", T);
    vi.mocked(notifyCalendarItemDue).mockResolvedValue({ ok: false, skipped: true, error: "Push relay request failed" });

    await dispatchDueCalendarPushNotifications(db.env, new Date(T));
    for (let minute = 1; minute < 10; minute++) {
      await dispatchDueCalendarPushNotifications(db.env, new Date(T + minutes(minute)));
    }
    expect(notifyCalendarItemDue).toHaveBeenCalledOnce();

    await dispatchDueCalendarPushNotifications(db.env, new Date(T + minutes(10)));
    expect(notifyCalendarItemDue).toHaveBeenCalledTimes(2);
  });

  it("records why an alert was not delivered", async () => {
    const db = calendarPushDb();
    db.addReminder("unlinked", T);
    db.addReminder("no-device", T);
    vi.mocked(notifyCalendarItemDue).mockImplementation(async (_env, alert) => alert.itemId === "unlinked"
      ? { ok: false, skipped: true, error: "ME3 Cloud is not linked" }
      : { ok: true, matched: 0, sent: 0 });

    await dispatchDueCalendarPushNotifications(db.env, new Date(T));

    expect(db.dispatch("unlinked")).toEqual({ status: "failed", error_message: expect.stringContaining("ME3 Cloud is not linked") });
    expect(db.dispatch("no-device")).toEqual({ status: "skipped", error_message: expect.stringMatching(/no .*device/i) });
  });
});

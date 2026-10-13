import { afterEach, describe, expect, it, vi } from "vitest";
import { getLiveDailyBriefing } from "./daily-briefing";
import type { Env } from "./types";

vi.mock("./quotes", () => ({ getBriefingQuote: vi.fn(async () => null) }));

afterEach(() => vi.useRealTimers());

describe("live Daily Briefing", () => {
  it("reads calendar, bookings, reminders and rich tasks without writing records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T08:00:00Z"));
    const queries: string[] = [];
    const rows = {
      user_calendar_events: [{ id: "event-1", title: "Design review", starts_at: "2026-07-11T09:00:00Z", ends_at: "2026-07-11T10:00:00Z", timezone: "Europe/Dublin" }],
      bookings: [{ id: "booking-1", guest_name: "Guest", starts_at: "2026-07-11T10:00:00Z", ends_at: "2026-07-11T11:00:00Z" }],
      user_reminders: [{ id: "reminder-1", title: "Call the dentist", remind_at: "2026-07-11T10:00:00Z", timezone: "Europe/Dublin", status: "pending" }],
      mission_tasks: [{ id: "task-1", title: "Ship the update", description: '<p>Check &amp; publish</p><script>secret()</script>' + '<p>' + "More context ".repeat(30) + '</p>', due_at: "2026-07-11T12:00:00Z" }],
    };
    const env = { DB: { prepare(sql: string) {
      queries.push(sql);
      expect(sql).toMatch(/^SELECT/);
      return { bind(..._values: unknown[]) { return this; },
        async first() { return { name: "Owner", timezone: "Europe/Dublin" }; },
        async all() { const key = Object.keys(rows).find(table => sql.includes(`FROM ${table}`)); return { results: key ? rows[key as keyof typeof rows] : [] }; },
      };
    } } } as unknown as Env;
    const briefing = await getLiveDailyBriefing(env, "owner");
    expect(briefing).toMatchObject({ id: "live:2026-07-11", status: "live", sections: [
      expect.objectContaining({ kind: "calendar" }), expect.objectContaining({ kind: "reminders" }), expect.objectContaining({ kind: "tasks" }),
    ] });
    expect(briefing.message).toContain("Design review");
    expect(briefing.message).toContain("Booking with Guest");
    expect(briefing.message).toContain("Call the dentist");
    expect(briefing.message).toContain("Ship the update: Check & publish");
    expect(briefing.message).not.toMatch(/<p>|<script>|secret/);
    const detail = briefing.sections.find(section => section.kind === "tasks")?.items[0]?.detail;
    expect(detail).toHaveLength(180);
    expect(detail).toMatch(/…$/);
    expect(queries).toHaveLength(5);
  });
});

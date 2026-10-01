import { describe, expect, it, vi } from "vitest";
import {
  runCoreAgentToolTurn,
  type AgentToolMessage,
} from "@me3-core/plugin-agent-chat";
import {
  createCalendarEventForAgent,
  getUtcMsForLocalTime,
  readCalendarEventsForAgent,
  rescheduleCalendarEventForAgent,
} from "@me3-core/plugin-calendar";

type CalendarRow = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  all_day: number;
  kind: string;
  recurrence_rule: string | null;
};

describe("Calendar Agent contract", () => {
  it("reads owner-scoped personal and imported events through Runtime v2", async () => {
    const database = createCalendarDb();
    const aiRun = vi.fn()
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: "calendar-read-1",
            name: "core_calendar_events_list",
            arguments: {
              dateFrom: "2026-07-28",
              dateTo: "2026-07-28",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        response: "You have a planning session and an imported client call today.",
      });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "calendar-read-request",
      turnId: "calendar-read-turn",
      ownerTimezone: "Europe/Dublin",
      route: {
        providerId: "workers-ai",
        model: "workers-test-model",
        backupModel: null,
        apiKey: null,
        ai: { run: aiRun },
        aiGateway: null,
        configured: true,
      } as never,
      messages: baseMessages("What is on my calendar today?"),
    });

    expect(response).toMatchObject({
      specialist: "core.calendar.events.list",
      replyText: "You have a planning session and an imported client call today.",
    });
    expect(JSON.stringify(aiRun.mock.calls[1]?.[1])).toContain("Planning session");
    expect(JSON.stringify(aiRun.mock.calls[1]?.[1])).toContain("Imported client call");
    expect(JSON.stringify(aiRun.mock.calls[1]?.[1])).not.toContain("Other owner event");
    expect(database.executions[0]?.result_json).toContain("Imported client call");
  });

  it("rejects calendar reads longer than 31 days", async () => {
    const database = createCalendarDb();
    await expect(
      readCalendarEventsForAgent(
        database.db,
        "owner",
        "Europe/Dublin",
        { dateFrom: "2026-07-01", dateTo: "2026-08-01" },
      ),
    ).rejects.toThrow("limited to 31 days");
  });

  it("creates a private event and converts India time into the Ireland calendar timezone", async () => {
    const database = createCalendarDb();
    const aiRun = vi.fn()
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: "calendar-create-1",
            name: "core_calendar_event_create",
            arguments: {
              title: "Yantra webinar",
              startDate: "2026-08-24",
              startTime: "18:00",
              startTimezone: "Asia/Kolkata",
              calendarTimezone: "Europe/Dublin",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        response: "Added it at the requested time.",
      });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "calendar-create-request",
      turnId: "calendar-create-turn",
      ownerTimezone: "Europe/Dublin",
      route: {
        providerId: "workers-ai",
        model: "workers-test-model",
        backupModel: null,
        apiKey: null,
        ai: { run: aiRun },
        aiGateway: null,
        configured: true,
      } as never,
      messages: baseMessages(
        "Add the Yantra webinar on 24 August at 6pm IST to my calendar in Ireland time.",
      ),
    });

    expect(response).toMatchObject({
      specialist: "core.calendar.event.create",
      replyText:
        "Added Yantra webinar to your ME3 calendar for 24 Aug 2026, 13:30 (Europe/Dublin) for 60 minutes. That corresponds to 2026-08-24 at 18:00 (Asia/Kolkata).",
      actionCards: [
        expect.objectContaining({
          kind: "calendar.event_created",
          capabilityId: "core.calendar.event.create",
          status: "complete",
          primaryAction: { label: "Open calendar", href: "/calendar" },
        }),
      ],
    });
    expect(database.nativeEvents.find((event) => event.title === "Yantra webinar"))
      .toMatchObject({
        user_id: "owner",
        starts_at: "2026-08-24T12:30:00.000Z",
        ends_at: "2026-08-24T13:30:00.000Z",
        timezone: "Europe/Dublin",
      });
    expect(database.executions[0]).toMatchObject({
      tool_name: "core_calendar_event_create",
      status: "succeeded",
    });
  });

  it("lists before rescheduling one owned event, preserving its duration and timezone", async () => {
    const database = createCalendarDb();
    const aiRun = vi.fn()
      .mockResolvedValueOnce({ tool_calls: [{
        id: "calendar-list-1",
        name: "core_calendar_events_list",
        arguments: { dateFrom: "2026-07-28", dateTo: "2026-07-28" },
      }] })
      .mockResolvedValueOnce({ tool_calls: [{
        id: "calendar-move-1",
        name: "core_calendar_event_reschedule",
        arguments: {
          eventId: "native-1",
          startDate: "2026-07-29",
          startTime: "13:30",
          startTimezone: "Europe/Dublin",
        },
      }] })
      .mockResolvedValueOnce({ response: "Moved the planning session to tomorrow at 1:30pm." });
    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "calendar-move-request",
      turnId: "calendar-move-turn",
      ownerTimezone: "Europe/Dublin",
      route: {
        providerId: "workers-ai",
        model: "workers-test-model",
        backupModel: null,
        apiKey: null,
        ai: { run: aiRun },
        aiGateway: null,
        configured: true,
      } as never,
      messages: baseMessages("Move my calendar planning session tomorrow to 1:30pm."),
    });

    expect(response).toMatchObject({
      specialist: "core.calendar.event.reschedule",
      replyText: "Moved Planning session to 29 Jul 2026, 13:30 (Europe/Dublin).",
    });
    expect(database.nativeEvents.find((event) => event.id === "native-1"))
      .toMatchObject({
        starts_at: "2026-07-29T12:30:00.000Z",
        ends_at: "2026-07-29T13:30:00.000Z",
        timezone: "Europe/Dublin",
      });
    expect(database.nativeEvents).toHaveLength(2);
    expect(database.executions.map((execution) => execution.tool_name))
      .toEqual(["core_calendar_events_list", "core_calendar_event_reschedule"]);
  });

  it("refuses to reschedule another owner's, imported, or ambiguous recurring event", async () => {
    const database = createCalendarDb();
    const move = (eventId: string) => rescheduleCalendarEventForAgent(
      database.db,
      "owner",
      {
        eventId,
        startDate: "2026-07-29",
        startTime: "13:30",
        startTimezone: "Europe/Dublin",
      },
    );
    await expect(move("native-other")).rejects.toThrow("not found");
    await expect(move("imported-1")).rejects.toThrow("not found");
    database.nativeEvents[0].recurrence_rule = "daily";
    await expect(move("native-1")).rejects.toThrow("recurring");
    expect(database.nativeEvents[0].starts_at).toBe("2026-07-28T09:00:00.000Z");
  });

  it.each([
    {
      label: "summer DST with a half-hour source offset",
      date: "2026-08-24",
      time: "18:00",
      sourceTimezone: "Asia/Kolkata",
      calendarTimezone: "Europe/Dublin",
      expectedUtc: "2026-08-24T12:30:00.000Z",
      expectedCalendarTime: "2026-08-24 13:30",
    },
    {
      label: "winter DST with the same source timezone",
      date: "2026-12-24",
      time: "18:00",
      sourceTimezone: "Asia/Kolkata",
      calendarTimezone: "Europe/Dublin",
      expectedUtc: "2026-12-24T12:30:00.000Z",
      expectedCalendarTime: "2026-12-24 12:30",
    },
    {
      label: "a destination date rollover",
      date: "2026-08-24",
      time: "18:00",
      sourceTimezone: "America/New_York",
      calendarTimezone: "Asia/Tokyo",
      expectedUtc: "2026-08-24T22:00:00.000Z",
      expectedCalendarTime: "2026-08-25 07:00",
    },
    {
      label: "a quarter-hour source offset and previous-day destination",
      date: "2026-08-24",
      time: "00:15",
      sourceTimezone: "Asia/Kathmandu",
      calendarTimezone: "America/Los_Angeles",
      expectedUtc: "2026-08-23T18:30:00.000Z",
      expectedCalendarTime: "2026-08-23 11:30",
    },
    {
      label: "a southern-hemisphere half-hour DST offset",
      date: "2026-01-15",
      time: "18:00",
      sourceTimezone: "Australia/Adelaide",
      calendarTimezone: "Europe/Dublin",
      expectedUtc: "2026-01-15T07:30:00.000Z",
      expectedCalendarTime: "2026-01-15 07:30",
    },
  ])("uses IANA rules for $label", ({
    date,
    time,
    sourceTimezone,
    calendarTimezone,
    expectedUtc,
    expectedCalendarTime,
  }) => {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const instant = new Date(
      getUtcMsForLocalTime(
        { year, month, day, hour, minute },
        sourceTimezone,
      ),
    );
    expect(instant.toISOString()).toBe(expectedUtc);
    expect(formatZonedDateTime(instant, calendarTimezone)).toBe(
      expectedCalendarTime,
    );
  });

  it("rejects ambiguous abbreviations and DST transition wall times", async () => {
    const database = createCalendarDb();
    const base = {
      title: "Timezone edge case",
      durationMinutes: 60,
      calendarTimezone: "Europe/Dublin",
    };

    await expect(
      createCalendarEventForAgent(database.db, "owner", "Europe/Dublin", {
        ...base,
        startDate: "2026-08-24",
        startTime: "18:00",
        startTimezone: "IST",
      }),
    ).rejects.toThrow("valid IANA timezone");
    await expect(
      createCalendarEventForAgent(database.db, "owner", "Europe/Dublin", {
        ...base,
        startDate: "2026-03-08",
        startTime: "02:30",
        startTimezone: "America/New_York",
      }),
    ).rejects.toThrow("does not exist");
    await expect(
      createCalendarEventForAgent(database.db, "owner", "Europe/Dublin", {
        ...base,
        startDate: "2026-11-01",
        startTime: "01:30",
        startTimezone: "America/New_York",
      }),
    ).rejects.toThrow("occurs twice");
    expect(database.nativeEvents.some((event) => event.title === base.title))
      .toBe(false);
  });
});

function formatZonedDateTime(date: Date, timezone: string): string {
  const values = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${values.get("year")}-${values.get("month")}-${values.get("day")} ${values.get("hour")}:${values.get("minute")}`;
}

function baseMessages(message: string): AgentToolMessage[] {
  return [
    { role: "system", content: "You are ME3." },
    { role: "user", content: message },
  ];
}

function createCalendarDb() {
  const nativeEvents: CalendarRow[] = [
    {
      id: "native-1",
      user_id: "owner",
      title: "Planning session",
      notes: "Review the launch plan.",
      location: "Studio",
      starts_at: "2026-07-28T09:00:00.000Z",
      ends_at: "2026-07-28T10:00:00.000Z",
      timezone: "Europe/Dublin",
      all_day: 0,
      kind: "event",
      recurrence_rule: null,
    },
    {
      id: "native-other",
      user_id: "someone-else",
      title: "Other owner event",
      notes: null,
      location: null,
      starts_at: "2026-07-28T11:00:00.000Z",
      ends_at: "2026-07-28T12:00:00.000Z",
      timezone: "Europe/Dublin",
      all_day: 0,
      kind: "event",
      recurrence_rule: null,
    },
  ];
  const importedEvents = [
    {
      id: "imported-1",
      user_id: "owner",
      source_status: "active",
      source_name: "Work calendar",
      title: "Imported client call",
      notes: null,
      location: "Online",
      starts_at: "2026-07-28T13:00:00.000Z",
      ends_at: "2026-07-28T14:00:00.000Z",
      timezone: "Europe/Dublin",
      all_day: 0,
      recurrence_rule: null,
    },
  ];
  const executions: Array<{
    id: string;
    user_id: string;
    request_id: string;
    tool_call_id: string;
    tool_name: string;
    status: string;
    result_json: string | null;
    error_message: string | null;
  }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM user_calendar_events")) {
                return (nativeEvents.find((event) =>
                  event.id === values[0] && event.user_id === values[1]
                ) || null) as T;
              }
              if (!sql.includes("FROM agent_tool_executions")) return null as T;
              return (executions.find(
                (item) =>
                  item.user_id === values[0] &&
                  item.request_id === values[1] &&
                  item.tool_call_id === values[2],
              ) || null) as T;
            },
            async all<T>() {
              if (sql.includes("FROM user_calendar_events")) {
                const recurring = sql.includes("recurrence_rule IS NOT NULL");
                const rows = nativeEvents.filter(
                  (event) =>
                    event.user_id === values[0] &&
                    (recurring
                      ? event.recurrence_rule !== null
                      : event.recurrence_rule === null &&
                        event.ends_at > String(values[1]) &&
                        event.starts_at < String(values[2])),
                );
                return { results: rows as T[] };
              }
              if (sql.includes("FROM calendar_source_events")) {
                const rows = importedEvents.filter(
                  (event) =>
                    event.user_id === values[0] &&
                    event.source_status === "active" &&
                    event.ends_at > String(values[1]) &&
                    event.starts_at < String(values[2]),
                );
                return { results: rows as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
              if (sql.includes("UPDATE user_calendar_events")) {
                const event = nativeEvents.find((item) =>
                  item.id === values[2] && item.user_id === values[3] &&
                  item.starts_at === values[4] && item.ends_at === values[5]
                );
                if (!event) return { meta: { changes: 0 } };
                event.starts_at = String(values[0]);
                event.ends_at = String(values[1]);
                return { meta: { changes: 1 } };
              }
              if (sql.includes("INSERT INTO user_calendar_events")) {
                nativeEvents.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  title: values[2] as string,
                  notes: values[3] as string | null,
                  location: values[4] as string | null,
                  starts_at: values[5] as string,
                  ends_at: values[6] as string,
                  timezone: values[7] as string,
                  all_day: 0,
                  kind: "event",
                  recurrence_rule: null,
                });
              }
              if (sql.includes("INSERT OR IGNORE INTO agent_tool_executions")) {
                executions.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  request_id: values[2] as string,
                  tool_call_id: values[3] as string,
                  tool_name: values[4] as string,
                  status: "running",
                  result_json: null,
                  error_message: null,
                });
              }
              if (sql.includes("UPDATE agent_tool_executions")) {
                const execution = executions.find((item) => item.id === values[1]);
                if (execution && sql.includes("status = 'succeeded'")) {
                  execution.status = "succeeded";
                  execution.result_json = values[0] as string;
                }
                if (execution && sql.includes("status = 'failed'")) {
                  execution.status = "failed";
                  execution.error_message = values[0] as string;
                }
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db, executions, nativeEvents };
}

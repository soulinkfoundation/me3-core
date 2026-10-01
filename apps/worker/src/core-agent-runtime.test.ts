import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runCoreAgentToolTurn,
  type AgentChatRuntimeStreamEvent,
  type AgentToolMessage,
} from "@me3-core/plugin-agent-chat";
import type {
  WebContentResult,
  WebResearchResult,
} from "@me3-core/web-research";

type ReminderRow = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  timezone: string | null;
  recurrence_rule: string | null;
  source_dispatch_id: string | null;
  status: "pending" | "failed" | "cancelled";
  created_at: string;
};

type ExecutionRow = {
  id: string;
  user_id: string;
  request_id: string;
  tool_call_id: string;
  tool_name: string;
  status: "running" | "succeeded" | "failed";
  result_json: string | null;
  error_message: string | null;
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Core Agent Runtime v2 reminders", () => {
  it("shows calendar tools without keyword routing in SDK mode", async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({ response: "I can help move it." }));
    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-sdk-calendar",
      turnId: "turn-sdk-calendar",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Move my planning session tomorrow."),
      runtime: "sdk",
    });
    const modelInput = run.mock.calls[0]?.[1] as { tools: Array<{ function: { name: string } }> };
    expect(modelInput.tools.map((tool) => tool.function.name)).toContain("core_calendar_event_reschedule");
  });

  it("hides disabled plugin tools in SDK mode", async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({ response: "Okay." }));
    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-sdk-disabled-plugin",
      turnId: "turn-sdk-disabled-plugin",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Show my calendar."),
      runtime: "sdk",
      installedPluginIds: new Set(),
    });
    const modelInput = run.mock.calls[0]?.[1] as { tools: Array<{ function: { name: string } }> };
    const names = modelInput.tools.map((tool) => tool.function.name);
    expect(names).not.toContain("core_calendar_events_list");
    expect(names).toContain("core_reminders_list");
  });

  it("does not execute approval-required tools in SDK mode", async () => {
    const database = createReminderDb();
    const run = vi.fn()
      .mockResolvedValueOnce({ tool_calls: [{ id: "approve-1", name: "core_social_posting_plan_confirm", arguments: { planId: "plan-1", confirmed: true } }] })
      .mockImplementationOnce(async (_model: string, input: { messages: AgentToolMessage[] }) => {
        expect(JSON.stringify(input.messages.at(-1))).toContain("approval");
        return { response: "Please review this action first." };
      });
    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "request-sdk-approval",
      turnId: "turn-sdk-approval",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Confirm my posting plan."),
      runtime: "sdk",
    });
    expect(response.replyText).toContain("review");
    expect(database.executions).toHaveLength(0);
  });

  it("returns booking-buffer-aware availability through the scheduling service", async () => {
    const availability = vi.fn(async () => ({
      timeTypeName: "30-minute call",
      timezone: "Europe/Dublin",
      slots: [{ startsAt: "2026-10-03T10:00:00.000Z", endsAt: "2026-10-03T10:30:00.000Z" }],
    }));
    const run = vi.fn()
      .mockResolvedValueOnce({ tool_calls: [{ id: "free-1", name: "core_calendar_availability", arguments: { dateFrom: "2026-10-03", dateTo: "2026-10-03", durationMinutes: 30 } }] })
      .mockImplementationOnce(async (_model: string, input: { messages: AgentToolMessage[] }) => {
        expect(JSON.stringify(input.messages.at(-1))).toContain("2026-10-03T10:00:00.000Z");
        return { response: "You have a free slot at 11am." };
      });
    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-sdk-free",
      turnId: "turn-sdk-free",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("When am I free for a 30 minute call on Saturday?"),
      schedulingServices: { availability } as never,
      runtime: "sdk",
    });
    expect(availability).toHaveBeenCalledWith({ dateFrom: "2026-10-03", dateTo: "2026-10-03", durationMinutes: 30, timeTypeId: undefined, limit: undefined });
  });

  it("omits tool schemas and tool instructions for a literal-response turn", async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      response: "PONG",
    }));

    const response = await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-literal",
      turnId: "turn-literal",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Reply with exactly PONG"),
    });

    expect(response.replyText).toBe("PONG");
    expect(response.streamMetrics).toBeUndefined();
    const modelInput = run.mock.calls[0]?.[1] as {
      messages: AgentToolMessage[];
      tools: unknown[];
    };
    expect(modelInput.tools).toEqual([]);
    expect(modelInput.messages[0]?.content).toBe("You are ME3.");
  });

  it("omits every tool schema when the owner does not name a tool domain", async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Let's work through the launch decision.",
    }));

    const response = await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-conversation",
      turnId: "turn-conversation",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Help me prioritise the launch options."),
    });

    const modelInput = run.mock.calls[0]?.[1] as {
      messages: AgentToolMessage[];
      tools: unknown[];
    };
    expect(modelInput.tools).toEqual([]);
    expect(modelInput.messages[0]?.content).toBe("You are ME3.");
    expect(response.streamMetrics).toBeUndefined();
  });

  it("fails over zero-tool conversation after the shorter gateway timeout", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("Primary model unavailable"))
      .mockResolvedValueOnce({ response: "Recovered with the backup." });
    const events: AgentChatRuntimeStreamEvent[] = [];

    const response = await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-zero-tool-fallback",
      turnId: "turn-zero-tool-fallback",
      ownerTimezone: "Europe/Dublin",
      route: workersGatewayRoute(run, "workers-test-backup") as never,
      messages: baseMessages("Help me think through the launch."),
      streamOptions: {
        onEvent: (event) => {
          events.push(event);
        },
      },
    });

    expect(response).toMatchObject({
      model: "workers-test-backup",
      replyText: "Recovered with the backup.",
    });
    expect(run.mock.calls).toHaveLength(2);
    expect(run.mock.calls.map((call) => call[2])).toEqual([
      expect.objectContaining({
        gateway: expect.objectContaining({ requestTimeoutMs: 6_000 }),
      }),
      expect.objectContaining({
        gateway: expect.objectContaining({ requestTimeoutMs: 6_000 }),
      }),
    ]);
    expect(
      events
        .filter((event) => event.event === "status")
        .map((event) => event.data.isBackup),
    ).toEqual([false, true]);
  });

  it("retains the configured gateway timeout for a tool-backed turn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
    const run = vi.fn()
      .mockResolvedValueOnce(providerToolCall(
        "workers-ai",
        "create-timeout",
        "core_reminders_create",
        {
          title: "Call Sam",
          remindAt: "2026-07-11T09:00:00+01:00",
          timezone: "Europe/Dublin",
        },
      ))
      .mockResolvedValueOnce({ response: "Reminder created." });
    const events: AgentChatRuntimeStreamEvent[] = [];

    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-tool-timeout",
      turnId: "turn-tool-timeout",
      ownerTimezone: "Europe/Dublin",
      route: workersGatewayRoute(run) as never,
      messages: baseMessages("Remind me on 11 July at 9am to call Sam"),
      streamOptions: {
        onEvent: (event) => {
          events.push(event);
        },
      },
    });

    expect(run.mock.calls).toHaveLength(2);
    expect(run.mock.calls.map((call) => call[2])).toEqual([
      expect.objectContaining({
        gateway: expect.objectContaining({ requestTimeoutMs: 12_000 }),
      }),
      expect.objectContaining({
        gateway: expect.objectContaining({ requestTimeoutMs: 12_000 }),
      }),
    ]);
    expect(
      events
        .filter((event) => event.event === "status")
        .map((event) => event.data.isBackup),
    ).toEqual([false, false]);
  });

  it.each([
    ["Show my tasks", "core_mission_task_list"],
    ["Show my latest journal entry", "core_journal_read"],
  ])("routes an explicit %s request without unrelated private tools", async (prompt, expectedTool) => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Done.",
    }));

    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: `request-${expectedTool}`,
      turnId: `turn-${expectedTool}`,
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages(prompt),
    });

    const modelInput = run.mock.calls[0]?.[1] as {
      tools: Array<{ function: { name: string } }>;
    };
    const names = modelInput.tools.map((tool) => tool.function.name);
    expect(names).toContain(expectedTool);
    if (expectedTool !== "core_mission_task_list") {
      expect(names.some((name) => name.startsWith("core_mission_task_"))).toBe(false);
    }
    if (expectedTool !== "core_journal_read") {
      expect(names).not.toContain("core_journal_read");
    }
    expect(names.some((name) => name.startsWith("core_mailbox_"))).toBe(false);
  });

  it("keeps mailbox tools for a referential follow-up but drops them for a new topic", async () => {
    const runFollowUp = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Here is the second email.",
    }));
    const history: AgentToolMessage[] = [
      { role: "system", content: "You are ME3." },
      { role: "user", content: "Search my emails from Ada." },
      { role: "assistant", content: "I found two emails from Ada. Which should I open?" },
    ];
    const mailboxServices = {
      search: vi.fn(),
      read: vi.fn(),
      createDraft: vi.fn(),
    };

    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-mail-follow-up",
      turnId: "turn-mail-follow-up",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(runFollowUp) as never,
      messages: [...history, { role: "user", content: "Open the second one." }],
      mailboxServices,
    });

    const followUpInput = runFollowUp.mock.calls[0]?.[1] as {
      tools: Array<{ function: { name: string } }>;
    };
    expect(followUpInput.tools.map((tool) => tool.function.name)).toEqual([
      "core_mailbox_search",
      "core_mailbox_read",
      "core_mailbox_draft",
    ]);

    const runNewTopic = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Let's plan it.",
    }));
    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-new-topic",
      turnId: "turn-new-topic",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(runNewTopic) as never,
      messages: [...history, { role: "user", content: "Help me plan tomorrow." }],
      mailboxServices,
    });

    const newTopicInput = runNewTopic.mock.calls[0]?.[1] as { tools: unknown[] };
    expect(newTopicInput.tools).toEqual([]);
  });

  it("keeps site tools available for a natural-language page revision follow-up", async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      response: "I can update that draft.",
    }));
    const messages: AgentToolMessage[] = [
      { role: "system", content: "You are ME3." },
      { role: "user", content: "Build a landing page for my Mallorca yoga retreat." },
      {
        role: "assistant",
        content: "Your Mallorca Yoga Retreat landing-page draft is ready.",
      },
      {
        role: "user",
        content: "Can you swap the image, add an email signup form and change the font?",
      },
    ];

    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-site-revision",
      turnId: "turn-site-revision",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages,
    });

    const modelInput = run.mock.calls[0]?.[1] as {
      tools: Array<{ function: { name: string; parameters: { properties: object } } }>;
    };
    const updateTool = modelInput.tools.find(
      (tool) => tool.function.name === "core_sites_landing_page_update",
    );
    expect(updateTool).toBeDefined();
    expect(updateTool?.function.parameters.properties).toMatchObject({
      imageQuery: { type: ["string", "null"] },
      actionType: { enum: ["link", "subscribe", null] },
      fontPreset: { enum: ["editorial", "bold", "modern", null] },
    });
  });

  it("sends only the relevant tool family and instructions for a clear action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
    const run = vi.fn(async (
      _model: string,
      _input: unknown,
    ): Promise<unknown> => undefined)
      .mockResolvedValueOnce({
        tool_calls: [{
          id: "create-family",
          name: "core_reminders_create",
          arguments: {
            title: "Call Sam",
            remindAt: "2026-07-11T09:00:00+01:00",
            timezone: "Europe/Dublin",
          },
        }],
      })
      .mockResolvedValueOnce({ response: "Reminder created." });

    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "request-family",
      turnId: "turn-family",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Remind me on 11 July at 9am to call Sam"),
    });

    const firstModelInput = run.mock.calls[0]?.[1] as {
      messages: AgentToolMessage[];
      tools: Array<{ function: { name: string } }>;
    };
    expect(firstModelInput.tools.map((tool) => tool.function.name)).toEqual([
      "core_reminders_list",
      "core_reminders_create",
      "core_reminders_update",
      "core_reminders_cancel",
    ]);
    expect(firstModelInput.messages[0]?.content).toContain("Reminder tool rules:");
    expect(firstModelInput.messages[0]?.content).not.toContain("Mailbox tool rules:");
  });

  it.each(["workers-ai", "openai", "anthropic"] as const)(
    "executes the same typed create contract through Cloudflare %s",
    async (providerId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
      const database = createReminderDb();
      const route = providerRoute(providerId, [
        providerToolCall(providerId, "create-1", "core_reminders_create", {
          title: "Call Sam",
          remindAt: "2026-07-11T09:00:00+01:00",
          timezone: "Europe/Dublin",
        }),
        providerText(providerId, "Done. I set the reminder for Saturday at 9:00."),
      ]);

      const response = await runCoreAgentToolTurn({
        db: database.db,
        userId: "owner",
        requestId: `request-${providerId}`,
        turnId: `turn-${providerId}`,
        ownerTimezone: "Europe/Dublin",
        route: route as never,
        messages: baseMessages("Remind me Saturday at 9am to call Sam"),
      });

      expect(response).toMatchObject({
        source: "workers-ai",
        specialist: "core.reminders.create",
        reminderAction: {
          kind: "created",
          title: "Call Sam",
          remindAt: "2026-07-11T08:00:00.000Z",
        },
        actionCards: [
          expect.objectContaining({
            kind: "reminder.created",
            capabilityId: "core.reminders.create",
          }),
        ],
      });
      expect(database.reminders).toHaveLength(1);
      expect(database.reminders[0]).toMatchObject({
        title: "Call Sam",
        remind_at: "2026-07-11T08:00:00.000Z",
        timezone: "Europe/Dublin",
      });
      expect(database.executions).toHaveLength(1);
      expect(database.executions[0]).toMatchObject({
        tool_name: "core_reminders_create",
        status: "succeeded",
      });
    },
  );

  it("lists before updating and keeps missing Workers AI call IDs collision-free", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
    const database = createReminderDb([
      reminderRow("reminder-1", "Call Sam", "2026-07-11T08:00:00.000Z"),
    ]);
    const route = providerRoute("workers-ai", [
      {
        tool_calls: [{ name: "core_reminders_list", arguments: {} }],
      },
      {
        tool_calls: [
          {
            name: "core_reminders_update",
            arguments: {
              reminderId: "reminder-1",
              title: "Call Sam about launch",
              remindAt: "2026-07-11T12:00:00+01:00",
              timezone: "Europe/Dublin",
            },
          },
        ],
      },
      { response: "Updated it to noon." },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "request-update",
      turnId: "turn-update",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Move the Call Sam reminder to noon Saturday"),
    });

    expect(response).toMatchObject({
      source: "workers-ai",
      specialist: "core.reminders.update",
      reminderAction: {
        kind: "updated",
        reminderId: "reminder-1",
        remindAt: "2026-07-11T11:00:00.000Z",
      },
      actionCards: [expect.objectContaining({ kind: "reminder.updated" })],
    });
    expect(database.reminders[0]).toMatchObject({
      title: "Call Sam about launch",
      remind_at: "2026-07-11T11:00:00.000Z",
    });
    expect(database.executions.map((row) => row.tool_call_id)).toEqual([
      "workers_ai_call_1:1",
      "workers_ai_call_1:2",
    ]);
  });

  it("does not guess when multiple reminders could match", async () => {
    const database = createReminderDb([
      reminderRow("reminder-1", "Call Sam", "2026-07-11T08:00:00.000Z"),
      reminderRow("reminder-2", "Call Sam", "2026-07-12T08:00:00.000Z"),
    ]);
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "list-1", "core_reminders_list", {}),
      { response: "I found two Call Sam reminders. Which one should I cancel?" },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "request-ambiguous",
      turnId: "turn-ambiguous",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Cancel the Call Sam reminder"),
    });

    expect(response.replyText).toContain("Which one");
    expect(response.reminderAction).toEqual({ kind: "listed" });
    expect(database.reminders.map((row) => row.status)).toEqual([
      "pending",
      "pending",
    ]);
  });

  it("cancels only the reminder named by a stable ID and preserves its action card", async () => {
    const database = createReminderDb([
      reminderRow("reminder-1", "Call Sam", "2026-07-11T08:00:00.000Z"),
    ]);
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "cancel-1", "core_reminders_cancel", {
        reminderId: "reminder-1",
      }),
      { response: "Cancelled the Call Sam reminder." },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "request-cancel",
      turnId: "turn-cancel",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Cancel reminder ID reminder-1"),
    });

    expect(response).toMatchObject({
      specialist: "core.reminders.cancel",
      reminderAction: {
        kind: "cancelled",
        reminderId: "reminder-1",
        title: "Call Sam",
      },
      actionCards: [expect.objectContaining({ kind: "reminder.cancelled" })],
    });
    expect(database.reminders[0]?.status).toBe("cancelled");
  });

  it("replays a completed Runtime v2 create without duplicating the reminder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
    const database = createReminderDb();
    const run = () =>
      runCoreAgentToolTurn({
        db: database.db,
        userId: "owner",
        requestId: "request-replay",
        turnId: "turn-replay",
        ownerTimezone: "Europe/Dublin",
        route: providerRoute("workers-ai", [
          providerToolCall("workers-ai", "create-replay", "core_reminders_create", {
            title: "Call Sam",
            remindAt: "2026-07-11T09:00:00+01:00",
            timezone: "Europe/Dublin",
          }),
          { response: "Reminder set." },
        ]) as never,
        messages: baseMessages("Remind me to call Sam"),
      });

    const first = await run();
    const replay = await run();

    expect(first.reminderAction).toEqual(replay.reminderAction);
    expect(database.reminders).toHaveLength(1);
    expect(database.executions).toHaveLength(1);
    expect(database.executions[0]?.status).toBe("succeeded");
  });

  it("streams model and tool lifecycle events with TTFT metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
    const database = createReminderDb();
    const events: AgentChatRuntimeStreamEvent[] = [];
    const route = providerRoute("workers-ai", [
      sseStream([
        streamEvent({ choices: [{ delta: { tool_calls: [{
          index: 0,
          id: "create-stream",
          function: {
            name: "core_reminders_create",
            arguments: JSON.stringify({
              title: "Call Sam",
              remindAt: "2026-07-11T09:00:00+01:00",
              timezone: "Europe/Dublin",
            }),
          },
        }] } }] }),
        "data: [DONE]\n\n",
      ]),
      sseStream([
        streamEvent({ choices: [{ delta: { content: "Reminder " } }] }),
        streamEvent({ choices: [{ delta: { content: "created." } }] }),
        "data: [DONE]\n\n",
      ]),
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "request-stream",
      turnId: "turn-stream",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Remind me to call Sam on 11 July at 9am."),
      streamOptions: {
        onEvent: (event) => {
          events.push(event);
        },
      },
    });

    expect(response.replyText).toBe("Reminder created.");
    expect(response.streamMetrics).toMatchObject({
      timeToFirstTokenMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
      deltaCount: 2,
      modelRequestCount: 2,
      modelRequestDurationMs: expect.any(Number),
      toolCallCount: 1,
      toolExecutionDurationMs: expect.any(Number),
      inputCharacterCount: expect.any(Number),
      availableToolCount: 4,
      toolSchemaCharacterCount: expect.any(Number),
    });
    expect(response.streamMetrics?.toolSchemaCharacterCount).toBeLessThan(3_000);
    expect(response.modelAttempts).toEqual([
      expect.objectContaining({
        model: "workers-test-model",
        status: "succeeded",
        durationMs: expect.any(Number),
        modelRequestDurationMs: expect.any(Number),
        modelRequestCount: 2,
      }),
    ]);
    expect(events.map((event) => `${event.event}:${String(event.data.state || "delta")}`))
      .toEqual([
        "status:model_started",
        "tool:started",
        "tool:completed",
        "status:model_started",
        "delta:delta",
        "delta:delta",
      ]);
    expect(events.find((event) => event.event === "tool")?.data).toMatchObject({
      clearText: true,
      capabilityId: "core.reminders.create",
      elapsedMs: expect.any(Number),
    });
    expect(
      events.find(
        (event) => event.event === "tool" && event.data.state === "completed",
      )?.data,
    ).toMatchObject({ durationMs: expect.any(Number) });
    expect(database.reminders).toHaveLength(1);
  });

  it("returns invalid and past timestamps to the model without writing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:00:00Z"));
    const database = createReminderDb();
    const run = vi.fn()
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: "past-1",
            name: "core_reminders_create",
            arguments: {
              title: "Call Sam",
              remindAt: "2026-06-30T09:00:00+01:00",
              timezone: "Europe/Dublin",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ response: "That time has passed. What future time should I use?" });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "request-past",
      turnId: "turn-past",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Remind me yesterday to call Sam"),
    });

    expect(response.replyText).toContain("What future time");
    expect(response.reminderAction).toBeNull();
    expect(database.reminders).toHaveLength(0);
    expect(database.executions[0]).toMatchObject({
      status: "failed",
      error_message: expect.stringContaining("must be in the future"),
    });
    const secondRequest = run.mock.calls[1]?.[1] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondRequest.messages.at(-1)?.content).toContain(
      "Reminder time must be in the future",
    );
  });
});

describe("Core Agent Runtime public web tools", () => {
  it("always exposes web tools to a tool-capable model on a normal turn", async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Let's think it through without searching.",
    }));
    const search = vi.fn();
    const open = vi.fn();

    const response = await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "web-change-routing-request",
      turnId: "web-change-routing-turn",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Help me plan the week."),
      webResearchServices: { search, open },
    });

    const modelInput = run.mock.calls[0]?.[1] as {
      tools: Array<{ function: { name: string } }>;
    };
    expect(modelInput.tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(["core_web_search", "core_web_open"]),
    );
    expect(response.replyText).toBe("Let's think it through without searching.");
    expect(search).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps literal-response turns tool-free even when web research is configured", async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({ response: "PONG" }));

    await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "web-literal-request",
      turnId: "web-literal-turn",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(run) as never,
      messages: baseMessages("Reply with exactly PONG"),
      webResearchServices: { search: vi.fn(), open: vi.fn() },
    });

    expect(run.mock.calls[0]?.[1]).toMatchObject({ tools: [] });
  });

  it("uses a tool-capable backup to route web search for a chat-only model", async () => {
    const search = vi.fn().mockResolvedValue(successfulWebSearchResult());
    const run = vi.fn().mockResolvedValueOnce({
      tool_calls: [{
        id: "chat-only-search",
        name: "core_web_search",
        arguments: { query: "Cloudflare Agents changes this week" },
      }],
    });

    const response = await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "chat-only-web-search-request",
      turnId: "chat-only-web-search-turn",
      ownerTimezone: "Europe/Dublin",
      route: {
        ...workersGatewayRoute(run, "@cf/zai-org/glm-5.2"),
        model: "@cf/qwen/qwen3-30b-a3b-fp8",
      } as never,
      messages: [
        { role: "system", content: "Private Journal content: NEVER-ROUTE-THIS." },
        { role: "user", content: "What changed in Cloudflare Agents this week?" },
      ],
      webResearchServices: { search, open: vi.fn() },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("@cf/zai-org/glm-5.2");
    expect(JSON.stringify(run.mock.calls[0]?.[1])).not.toContain("NEVER-ROUTE-THIS");
    expect(search).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      specialist: "core.web.search",
      model: "@cf/zai-org/glm-5.2",
      replyText: expect.stringContaining("Cloudflare published a new update"),
    });
  });

  it("returns a non-web turn to the selected chat-only model after routing", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ response: "NO_WEB_TOOL" })
      .mockResolvedValueOnce({ response: "Let's choose the most important outcome." });

    const response = await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "chat-only-no-web-request",
      turnId: "chat-only-no-web-turn",
      ownerTimezone: "Europe/Dublin",
      route: {
        ...workersGatewayRoute(run, "@cf/zai-org/glm-5.2"),
        model: "@cf/qwen/qwen3-30b-a3b-fp8",
      } as never,
      messages: baseMessages("Help me choose today's priority."),
      webResearchServices: { search: vi.fn(), open: vi.fn() },
    });

    expect(run.mock.calls.map((call) => call[0])).toEqual([
      "@cf/zai-org/glm-5.2",
      "@cf/qwen/qwen3-30b-a3b-fp8",
    ]);
    expect(response).toMatchObject({
      model: "@cf/qwen/qwen3-30b-a3b-fp8",
      replyText: "Let's choose the most important outcome.",
    });
  });

  it("uses the selected chat-only model to interpret an opened page", async () => {
    const open = vi.fn().mockResolvedValue(successfulWebOpenResult());
    const run = vi.fn()
      .mockResolvedValueOnce({
        tool_calls: [{
          id: "chat-only-open",
          name: "core_web_open",
          arguments: { url: "https://example.com/agents" },
        }],
      })
      .mockResolvedValueOnce({ response: "The page describes the Agents update." });

    const response = await runCoreAgentToolTurn({
      db: createReminderDb().db,
      userId: "owner",
      requestId: "chat-only-web-open-request",
      turnId: "chat-only-web-open-turn",
      ownerTimezone: "Europe/Dublin",
      route: {
        ...workersGatewayRoute(run, "@cf/zai-org/glm-5.2"),
        model: "@cf/qwen/qwen3-30b-a3b-fp8",
      } as never,
      messages: baseMessages("Read https://example.com/agents and summarize it."),
      webResearchServices: { search: vi.fn(), open },
    });

    expect(run.mock.calls.map((call) => call[0])).toEqual([
      "@cf/zai-org/glm-5.2",
      "@cf/qwen/qwen3-30b-a3b-fp8",
    ]);
    expect(JSON.stringify(run.mock.calls[1]?.[1])).toContain(
      "Untrusted public-web page evidence follows",
    );
    expect(open).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      model: "@cf/qwen/qwen3-30b-a3b-fp8",
      replyText: "The page describes the Agents update.",
    });
  });

  it("lets the model select public web search and preserves the normalized source reply", async () => {
    const database = createReminderDb();
    const searchResult: WebResearchResult = {
      status: "success",
      query: "latest Cloudflare public web updates",
      answer: "Cloudflare published a new update [1].",
      sources: [
        {
          id: "web-source-1",
          url: "https://example.com/cloudflare-update",
          canonicalUrl: null,
          title: "Cloudflare update",
          publisher: "example.com",
          publishedAt: null,
          retrievedAt: "2026-08-27T00:00:00.000Z",
        },
      ],
      evidence: [
        {
          id: "web-evidence-1",
          sourceId: "web-source-1",
          text: "The update is described on the source page.",
          relevanceScore: null,
        },
      ],
      citations: [
        {
          id: "web-citation-1",
          sourceId: "web-source-1",
          evidenceIds: ["web-evidence-1"],
          label: "1",
          answerSpan: { start: 34, end: 37 },
        },
      ],
      searchedAt: "2026-08-27T00:00:00.000Z",
      usage: {
        requests: 1,
        searchQueries: 1,
        pagesOpened: 0,
        inputTokens: null,
        outputTokens: null,
        bytesReceived: null,
        cost: null,
      },
      trace: {
        providerId: "test-web",
        adapterId: "test-web-v1",
        operation: "search",
        providerRequestId: null,
        model: null,
        startedAt: "2026-08-27T00:00:00.000Z",
        durationMs: 1,
        attempts: 1,
      },
    };
    const search = vi.fn().mockResolvedValue(searchResult);
    const aiRun = vi.fn(
      async (_model: string, _input: unknown, _options?: unknown): Promise<unknown> => ({
        response: "A model summary that should be replaced.",
      }),
    );
    aiRun
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: "web-search-1",
            name: "core_web_search",
            arguments: { query: "latest Cloudflare public web updates" },
          },
        ],
      })
      .mockResolvedValueOnce({ response: "A model summary that should be replaced." });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "web-search-request",
      turnId: "web-search-turn",
      ownerTimezone: "Europe/Dublin",
      route: workersRoute(aiRun) as never,
      messages: baseMessages("What are the latest public web updates about Cloudflare?"),
      webResearchServices: {
        search,
        open: vi.fn(),
      },
    });

    expect(response).toMatchObject({
      specialist: "core.web.search",
      replyText: expect.stringContaining("https://example.com/cloudflare-update"),
    });
    expect(response.replyText).not.toContain("A model summary that should be replaced.");
    expect(search).toHaveBeenCalledWith(
      {
        query: "latest Cloudflare public web updates",
        domainPolicy: { allowedDomains: [], blockedDomains: [] },
      },
      { requestId: "web-search-request", signal: undefined },
    );
    expect(database.executions[0]?.tool_name).toBe("core_web_search");
    expect(aiRun.mock.calls[0]?.[1]).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({
            name: "core_web_search",
            strict: true,
          }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({
            name: "core_web_open",
            strict: true,
          }),
        }),
      ]),
    });
    expect(aiRun.mock.calls[0]?.[1]).not.toHaveProperty("tool_choice");
  });
});

function successfulWebSearchResult(): WebResearchResult {
  return {
    status: "success",
    query: "Cloudflare Agents changes this week",
    answer: "Cloudflare published a new update [1].",
    sources: [{
      id: "web-source-1",
      url: "https://example.com/cloudflare-update",
      canonicalUrl: null,
      title: "Cloudflare update",
      publisher: "example.com",
      publishedAt: null,
      retrievedAt: "2026-08-27T00:00:00.000Z",
    }],
    evidence: [{
      id: "web-evidence-1",
      sourceId: "web-source-1",
      text: "The update is described on the source page.",
      relevanceScore: null,
    }],
    citations: [{
      id: "web-citation-1",
      sourceId: "web-source-1",
      evidenceIds: ["web-evidence-1"],
      label: "1",
      answerSpan: { start: 34, end: 37 },
    }],
    searchedAt: "2026-08-27T00:00:00.000Z",
    usage: {
      requests: 1,
      searchQueries: 1,
      pagesOpened: 0,
      inputTokens: null,
      outputTokens: null,
      bytesReceived: null,
      cost: null,
    },
    trace: {
      providerId: "test-web",
      adapterId: "test-web-v1",
      operation: "search",
      providerRequestId: null,
      model: null,
      startedAt: "2026-08-27T00:00:00.000Z",
      durationMs: 1,
      attempts: 1,
    },
  };
}

function successfulWebOpenResult(): WebContentResult {
  return {
    status: "success",
    source: {
      id: "web-page-1",
      url: "https://example.com/agents",
      canonicalUrl: null,
      title: "Agents update",
      publisher: "example.com",
      publishedAt: null,
      retrievedAt: "2026-08-27T00:00:00.000Z",
    },
    evidence: {
      id: "web-page-evidence-1",
      sourceId: "web-page-1",
      text: "The page describes a Cloudflare Agents update.",
      relevanceScore: null,
    },
    retrievalMode: "static",
    contentFormat: "text",
    truncated: false,
    usage: {
      requests: 1,
      searchQueries: 0,
      pagesOpened: 1,
      inputTokens: null,
      outputTokens: null,
      bytesReceived: 48,
      cost: null,
    },
    trace: {
      providerId: "test-web",
      adapterId: "test-web-v1",
      operation: "open",
      providerRequestId: null,
      model: null,
      startedAt: "2026-08-27T00:00:00.000Z",
      durationMs: 1,
      attempts: 1,
    },
  };
}

function baseMessages(message: string): AgentToolMessage[] {
  return [
    { role: "system", content: "You are ME3." },
    { role: "user", content: message },
  ];
}

function providerRoute(providerId: "workers-ai" | "openai" | "anthropic", payloads: unknown[]) {
  const next = vi.fn(async () => payloads.shift());
  return {
    ...workersRoute(next),
    model: providerId === "workers-ai" ? "workers-test-model" : `${providerId}/test-model`,
  };
}

function workersRoute(run: ReturnType<typeof vi.fn>) {
  return {
    providerId: "workers-ai" as const,
    model: "workers-test-model",
    backupModel: null,
    apiKey: null,
    ai: { run },
    aiGateway: null,
    configured: true,
  };
}

function workersGatewayRoute(
  run: ReturnType<typeof vi.fn>,
  backupModel: string | null = null,
) {
  return {
    ...workersRoute(run),
    backupModel,
    aiGateway: {
      accountId: null,
      gatewayId: "default",
      apiToken: null,
      routeWorkersAi: true,
      routeExternalProviders: false,
    },
    aiGatewayRequestPolicy: {
      requestTimeoutMs: 12_000,
      maxAttempts: 1 as const,
    },
  };
}

function providerToolCall(
  providerId: "workers-ai" | "openai" | "anthropic",
  id: string,
  name: string,
  args: Record<string, unknown>,
): unknown {
  if (providerId === "openai") {
    return {
      choices: [{ message: { tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] } }],
    };
  }
  if (providerId === "anthropic") {
    return { content: [{ type: "tool_use", id, name, input: args }] };
  }
  return { tool_calls: [{ id, name, arguments: args }] };
}

function providerText(
  providerId: "workers-ai" | "openai" | "anthropic",
  text: string,
): unknown {
  if (providerId === "openai") return { choices: [{ message: { content: text } }] };
  if (providerId === "anthropic") return { content: [{ type: "text", text }] };
  return { response: text };
}

function streamEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
}

function reminderRow(id: string, title: string, remindAt: string): ReminderRow {
  return {
    id,
    user_id: "owner",
    title,
    notes: null,
    remind_at: remindAt,
    timezone: "Europe/Dublin",
    recurrence_rule: null,
    source_dispatch_id: null,
    status: "pending",
    created_at: "2026-07-01T09:00:00.000Z",
  };
}

function createReminderDb(initialReminders: ReminderRow[] = []) {
  const reminders = initialReminders.map((row) => ({ ...row }));
  const executions: ExecutionRow[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM agent_tool_executions")) {
                return (executions.find(
                  (row) =>
                    row.user_id === values[0] &&
                    row.request_id === values[1] &&
                    row.tool_call_id === values[2],
                ) || null) as T;
              }
              if (sql.includes("source_dispatch_id = ?")) {
                return (reminders.find(
                  (row) =>
                    row.user_id === values[0] &&
                    row.source_dispatch_id === values[1],
                ) || null) as T;
              }
              if (sql.includes("WHERE id = ? AND user_id = ?")) {
                return (reminders.find(
                  (row) =>
                    row.id === values[0] &&
                    row.user_id === values[1] &&
                    (row.status === "pending" || row.status === "failed"),
                ) || null) as T;
              }
              return null as T;
            },
            async all<T>() {
              return {
                results: reminders
                  .filter(
                    (row) =>
                      row.user_id === values[0] &&
                      (row.status === "pending" || row.status === "failed"),
                  )
                  .sort((left, right) => left.remind_at.localeCompare(right.remind_at)) as T[],
              };
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO agent_tool_executions")) {
                if (!executions.some(
                  (row) =>
                    row.user_id === values[1] &&
                    row.request_id === values[2] &&
                    row.tool_call_id === values[3],
                )) {
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
              }
              if (sql.includes("UPDATE agent_tool_executions")) {
                const execution = executions.find((row) => row.id === values[1]);
                if (execution && sql.includes("status = 'succeeded'")) {
                  execution.status = "succeeded";
                  execution.result_json = values[0] as string;
                  execution.error_message = null;
                }
                if (execution && sql.includes("status = 'failed'")) {
                  execution.status = "failed";
                  execution.error_message = values[0] as string;
                }
              }
              if (sql.includes("INTO user_reminders")) {
                if (!reminders.some(
                  (row) =>
                    values[7] &&
                    row.user_id === values[1] &&
                    row.source_dispatch_id === values[7],
                )) {
                  reminders.push({
                    id: values[0] as string,
                    user_id: values[1] as string,
                    title: values[2] as string,
                    notes: values[3] as string | null,
                    remind_at: values[4] as string,
                    timezone: values[5] as string,
                    recurrence_rule: values[6] as string | null,
                    source_dispatch_id: values[7] as string | null,
                    status: "pending",
                    created_at: new Date().toISOString(),
                  });
                }
              }
              if (sql.includes("SET title = ?")) {
                const row = reminders.find(
                  (reminder) =>
                    reminder.id === values[5] &&
                    reminder.user_id === values[6] &&
                    (reminder.status === "pending" || reminder.status === "failed"),
                );
                if (row) {
                  row.title = values[0] as string;
                  row.notes = values[1] as string | null;
                  row.remind_at = values[2] as string;
                  row.timezone = values[3] as string;
                  row.recurrence_rule = values[4] as string | null;
                  row.status = "pending";
                }
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (sql.includes("status = 'cancelled'")) {
                const row = reminders.find(
                  (reminder) =>
                    reminder.id === values[0] &&
                    reminder.user_id === values[1] &&
                    (reminder.status === "pending" || reminder.status === "failed"),
                );
                if (row) row.status = "cancelled";
                return { meta: { changes: row ? 1 : 0 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db, reminders, executions };
}

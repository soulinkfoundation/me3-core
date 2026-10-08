import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runCoreAgentToolTurn,
  type AgentToolMessage,
} from "@me3-core/plugin-agent-chat";

describe("Assistant read tools Runtime v2 contract", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["legacy", "I cannot list all your contacts. Tell me a contact name to search."],
    ["sdk", "I cannot list all your contacts. Tell me a contact name to search."],
    ["legacy", "I couldn't find a Soulink Link or public profile matching that need."],
    ["sdk", "I couldn't find a Soulink Link or public profile matching that need."],
  ] as const)(
    "keeps private contact search available in %s mode after %s",
    async (runtime, priorReply) => {
      const database = createReadToolsDb();
      const searchContacts = vi.fn(async () => ({
        contacts: [{ name: "QA Person", relationship: "contact", me3AssistantAvailable: false }],
        total: 1,
      }));
      const aiRun = vi.fn()
        .mockResolvedValueOnce({
          tool_calls: [{ id: "contacts-follow-up", name: "core_contacts_search", arguments: { limit: 10 } }],
        })
        .mockResolvedValueOnce({ response: "The recent active contacts include QA Person." });
      await runCoreAgentToolTurn({
        db: database.db,
        userId: "owner",
        requestId: `contacts-follow-up-${runtime}`,
        turnId: `contacts-follow-up-${runtime}`,
        ownerTimezone: "Europe/Dublin",
        route: testRoute(aiRun),
        runtime,
        schedulingServices: { searchContacts } as never,
        messages: [
          { role: "system", content: "You are ME3." },
          { role: "user", content: "Can you access my contacts?" },
          { role: "assistant", content: "Yes, I can search your contacts." },
          { role: "user", content: "List them all." },
          { role: "assistant", content: priorReply },
          { role: "user", content: "List them all." },
        ],
      });
      const modelInput = aiRun.mock.calls[0]?.[1] as { tools: Array<{ function: { name: string } }>; tool_choice?: unknown };
      expect(modelInput.tools.map((tool) => tool.function.name)).toContain("core_contacts_search");
      expect(modelInput.tool_choice).toBeUndefined();
      expect(searchContacts).toHaveBeenCalledWith({ query: undefined, limit: 10 });
      expect(database.executions.map((item) => item.tool_name)).toEqual(["core_contacts_search"]);
    },
  );

  it("does not carry a contact topic into an unrelated legacy request", async () => {
    const database = createReadToolsDb();
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({ response: "Rain falls quietly." }));
    const searchContacts = vi.fn();
    await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "contacts-new-topic",
      turnId: "contacts-new-topic",
      ownerTimezone: "Europe/Dublin",
      route: testRoute(aiRun),
      schedulingServices: { searchContacts } as never,
      messages: [
        { role: "system", content: "You are ME3." },
        { role: "user", content: "Can you access my contacts?" },
        { role: "assistant", content: "Yes, I can search your contacts." },
        { role: "user", content: "Write a short poem about rain." },
      ],
    });
    const modelInput = aiRun.mock.calls[0]?.[1] as { tools: Array<{ function: { name: string } }> };
    expect(modelInput.tools.map((tool) => tool.function.name)).not.toContain("core_contacts_search");
    expect(searchContacts).not.toHaveBeenCalled();
    expect(database.executions).toHaveLength(0);
  });

  it("reads upcoming confirmed owner bookings through a model-selected tool", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));
    const database = createReadToolsDb();
    const aiRun = vi.fn()
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: "bookings-read-1",
            name: "core_bookings_lookup",
            arguments: { limit: 8 },
          },
        ],
      })
      .mockResolvedValueOnce({
        response: "You have one upcoming confirmed booking.",
      });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "bookings-read-request",
      turnId: "bookings-read-turn",
      ownerTimezone: "Europe/Dublin",
      route: testRoute(aiRun),
      messages: baseMessages("What bookings do I have coming up?"),
    });

    expect(response).toMatchObject({
      specialist: "core.bookings.lookup",
      replyText: "You have one upcoming confirmed booking.",
    });
    expect(JSON.stringify(aiRun.mock.calls[1]?.[1])).toContain("Ada Lovelace");
    expect(JSON.stringify(aiRun.mock.calls[1]?.[1])).not.toContain("Other Owner");
    expect(database.executions[0]?.tool_name).toBe("core_bookings_lookup");
    expect(aiRun.mock.calls[0]?.[1]).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "core_bookings_lookup" },
      },
      tools: [
        {
          function: { name: "core_bookings_lookup" },
        },
      ],
    });
  });

  it("forces an explicit Journal read before the model can answer", async () => {
    const database = createReadToolsDb();
    const aiRun = vi.fn()
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: "journal-read-1",
            name: "core_journal_read",
            arguments: { mode: "latest", limit: 7 },
          },
        ],
      })
      .mockResolvedValueOnce({
        response: "Your latest Journal entry is grounded in the stored entry.",
      });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "journal-read-request",
      turnId: "journal-read-turn",
      ownerTimezone: "Europe/Dublin",
      route: testRoute(aiRun),
      messages: baseMessages("Read my latest 7 Journal entries."),
    });

    expect(response).toMatchObject({
      specialist: "core.journal.read",
    });
    expect(aiRun.mock.calls[0]?.[1]).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "core_journal_read" },
      },
      tools: [
        {
          function: { name: "core_journal_read" },
        },
      ],
    });
    expect(JSON.stringify(aiRun.mock.calls[1]?.[1])).toContain(
      "A grounded Journal entry",
    );
    expect(database.executions[0]?.tool_name).toBe("core_journal_read");
  });

  it("does not return model prose when a required read tool is ignored", async () => {
    const database = createReadToolsDb();
    const aiRun = vi.fn().mockResolvedValue({
      response: "I do not have access to your Journal entries.",
    });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "journal-ignored-request",
      turnId: "journal-ignored-turn",
      ownerTimezone: "Europe/Dublin",
      route: testRoute(aiRun),
      messages: baseMessages("Read my latest 7 Journal entries."),
    });

    expect(response.source).toBe("fallback");
    expect(response.replyText).not.toContain("do not have access");
    expect(database.executions).toHaveLength(0);
  });

  it("does not stream model prose when a required read tool is ignored", async () => {
    const database = createReadToolsDb();
    const aiRun = vi.fn().mockResolvedValue({
      response: "I do not have access to your Journal entries.",
    });
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "journal-stream-ignored-request",
      turnId: "journal-stream-ignored-turn",
      ownerTimezone: "Europe/Dublin",
      route: testRoute(aiRun),
      messages: baseMessages("Read my latest 7 Journal entries."),
      streamOptions: {
        onEvent(event) {
          events.push(event as never);
        },
      },
    });

    expect(response.source).toBe("fallback");
    expect(
      events.filter((event) => event.event === "delta"),
    ).toHaveLength(0);
    expect(aiRun.mock.calls[0]?.[1]).toMatchObject({
      stream: true,
      tool_choice: {
        type: "function",
        function: { name: "core_journal_read" },
      },
    });
  });

  it("lists and reads owner blog posts through one read-only tool", async () => {
    const database = createReadToolsDb();
    const aiRun = vi.fn()
      .mockResolvedValueOnce({
        tool_calls: [
          {
            id: "blog-read-1",
            name: "core_sites_blog_post_read",
            arguments: { post: "Agent Context" },
          },
        ],
      })
      .mockResolvedValueOnce({
        response: "The Agent Context post explains how stored context keeps the assistant grounded.",
      });

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "blog-read-request",
      turnId: "blog-read-turn",
      ownerTimezone: "Europe/Dublin",
      route: testRoute(aiRun),
      messages: baseMessages("Read my Agent Context blog post."),
    });

    expect(response).toMatchObject({
      specialist: "core.sites.blog_post.read",
    });
    const secondModelInput = JSON.stringify(aiRun.mock.calls[1]?.[1]);
    expect(secondModelInput).toContain("Context keeps the assistant grounded");
    expect(secondModelInput).not.toContain("Other Owner Post");
    expect(database.executions[0]?.tool_name).toBe("core_sites_blog_post_read");
    expect(aiRun.mock.calls[0]?.[1]).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "core_sites_blog_post_read" },
      },
      tools: [
        {
          function: { name: "core_sites_blog_post_read" },
        },
      ],
    });
  });
});

function baseMessages(message: string): AgentToolMessage[] {
  return [
    { role: "system", content: "You are ME3." },
    { role: "user", content: message },
  ];
}

function testRoute(aiRun: ReturnType<typeof vi.fn>) {
  return {
    providerId: "workers-ai",
    model: "workers-test-model",
    backupModel: null,
    apiKey: null,
    ai: { run: aiRun },
    aiGateway: null,
    configured: true,
  } as never;
}

function createReadToolsDb() {
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
  const files = new Map<string, string>([
    [
      "site-owner:src/me.json",
      JSON.stringify({
        handle: "owner-site",
        posts: [
          {
            slug: "agent-context",
            title: "Agent Context",
            file: "blog/agent-context.md",
            draft: false,
          },
        ],
      }),
    ],
    [
      "site-owner:src/blog/agent-context.md",
      "# Agent Context\n\nContext keeps the assistant grounded.",
    ],
    [
      "site-other:src/me.json",
      JSON.stringify({
        posts: [
          {
            slug: "other-owner-post",
            title: "Other Owner Post",
            file: "blog/other-owner.md",
          },
        ],
      }),
    ],
  ]);
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM agent_tool_executions")) {
                return (executions.find(
                  (item) =>
                    item.user_id === values[0] &&
                    item.request_id === values[1] &&
                    item.tool_call_id === values[2],
                ) || null) as T;
              }
              if (sql.includes("FROM site_files")) {
                const content = files.get(`${values[0]}:${values[1]}`);
                return (content === undefined ? null : { content }) as T;
              }
              return null as T;
            },
            async all<T>() {
              if (sql.includes("FROM bookings b")) {
                const rows = values[0] === "owner"
                  ? [
                      {
                        site_username: "owner-site",
                        booking_type: "one_to_one",
                        guest_name: "Ada Lovelace",
                        guest_email: "ada@example.com",
                        starts_at: "2026-07-29T09:00:00.000Z",
                        ends_at: "2026-07-29T09:30:00.000Z",
                        duration_minutes: 30,
                        notes: "Launch review.",
                        payment_status: "not_required",
                        is_free_booking: 1,
                      },
                    ]
                  : [
                      {
                        site_username: "other-site",
                        guest_name: "Other Owner",
                      },
                    ];
                return { results: rows as T[] };
              }
              if (sql.includes("FROM journal_entries")) {
                return {
                  results: [
                    {
                      id: "journal-owner",
                      entry_date: "2026-07-28",
                      title: "A grounded Journal entry",
                      body: "Stored Journal body.",
                      body_format: "plain_text",
                      updated_at: "2026-07-28T08:00:00.000Z",
                      revision: 1,
                    },
                  ] as T[],
                };
              }
              if (sql.includes("FROM sites")) {
                const rows = values[0] === "owner"
                  ? [
                      {
                        id: "site-owner",
                        username: "owner-site",
                        custom_domain: null,
                        published_at: null,
                        updated_at: "2026-07-28T00:00:00.000Z",
                      },
                    ]
                  : [
                      {
                        id: "site-other",
                        username: "other-site",
                        custom_domain: null,
                        published_at: null,
                        updated_at: "2026-07-28T00:00:00.000Z",
                      },
                    ];
                return { results: rows as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
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
  return { db, executions };
}

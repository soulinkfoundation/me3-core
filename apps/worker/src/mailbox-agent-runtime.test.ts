import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_CHAT_TOOLS,
  runCoreAgentToolTurn,
  type AgentMailboxMessage,
  type AgentToolMessage,
} from "@me3-core/plugin-agent-chat";

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
  vi.unstubAllGlobals();
});

describe("mailbox Agent Runtime v2", () => {
  it.each(["workers-ai", "openai", "anthropic"] as const)(
    "searches, reads, and creates a review-only reply draft through %s",
    async (providerId) => {
      const database = createExecutionDb();
      const selected = mailboxMessage({
        id: "message-ada",
        fromAddress: "ada@example.com",
        subject: "Launch checklist",
        body: `${"Context ".repeat(50)}SELECTED_PRIVATE_DETAIL`,
        preview: "Ada asks whether the launch checklist is ready.",
      });
      const other = mailboxMessage({
        id: "message-other",
        fromAddress: "other@example.com",
        subject: "Private unrelated note",
        body: "OTHER_PRIVATE_BODY_MUST_NOT_LEAK",
        preview: "Unrelated note.",
      });
      const drafts: AgentMailboxMessage[] = [];
      const services = mailboxServices([selected, other], drafts, [selected]);
      const route = providerRoute(providerId, [
        providerToolCall(providerId, "search-1", "core_mailbox_search", {
          query: "Ada launch checklist",
          direction: "inbound",
          limit: 5,
        }),
        providerToolCall(providerId, "read-1", "core_mailbox_read", {
          messageId: "message-ada",
        }),
        providerToolCall(providerId, "draft-1", "core_mailbox_draft", {
          to: "ada@example.com",
          subject: "Re: Launch checklist",
          body: "Hi Ada,\n\nYes, the launch checklist is ready.\n\nBest,\nKieran",
          replyToMessageId: "message-ada",
        }),
        providerText(providerId, "I saved a reply draft for your review. It has not been sent."),
      ]);

      const response = await runCoreAgentToolTurn({
        db: database.db,
        userId: "owner",
        requestId: `mailbox-${providerId}`,
        turnId: `turn-${providerId}`,
        ownerTimezone: "Europe/Dublin",
        route: route as never,
        messages: baseMessages("Find Ada's launch email and draft a reply saying it is ready."),
        mailboxServices: services,
      });

      expect(response).toMatchObject({
        source: "workers-ai",
        specialist: "core.mailbox.draft",
        emailAction: { kind: "drafted" },
        actionCards: [
          expect.objectContaining({
            kind: "mailbox.draft_saved",
            status: "pending_approval",
          }),
        ],
      });
      expect(response.replyText).toContain("not been sent");
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        toAddress: "ada@example.com",
        subject: "Re: Launch checklist",
        status: "pending_approval",
      });
      expect(database.executions).toHaveLength(3);
      expect(database.executions[0]?.result_json).not.toContain("SELECTED_PRIVATE_DETAIL");
      expect(database.executions[0]?.result_json).not.toContain("OTHER_PRIVATE_BODY_MUST_NOT_LEAK");
      expect(database.executions[1]?.result_json).toContain("SELECTED_PRIVATE_DETAIL");
      expect(database.executions[1]?.result_json).not.toContain("OTHER_PRIVATE_BODY_MUST_NOT_LEAK");
    },
  );

  it("clarifies ambiguous search results without reading or drafting", async () => {
    const database = createExecutionDb();
    const messages = [
      mailboxMessage({ id: "message-1", subject: "Launch", fromAddress: "ada@example.com" }),
      mailboxMessage({ id: "message-2", subject: "Launch", fromAddress: "ada@example.com" }),
    ];
    const drafts: AgentMailboxMessage[] = [];
    const read = vi.fn(async (messageId: string) => {
      const message = messages.find((item) => item.id === messageId);
      return message ? { message } : { error: "Message not found", status: 404 };
    });
    const services = {
      ...mailboxServices(messages, drafts, messages),
      read,
    };
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "search-1", "core_mailbox_search", {
        query: "Ada launch",
      }),
      { response: "I found two matching launch emails from Ada. Which one should I use?" },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "mailbox-ambiguous",
      turnId: "turn-ambiguous",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Reply to Ada's launch email"),
      mailboxServices: services,
    });

    expect(response.replyText).toContain("Which one");
    expect(response.specialist).toBe("core.mailbox.search");
    expect(response.emailAction).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(drafts).toHaveLength(0);
  });

  it("rejects a recipient that does not match the selected reply message", async () => {
    const database = createExecutionDb();
    const selected = mailboxMessage({
      id: "message-ada",
      fromAddress: "ada@example.com",
      subject: "Launch",
    });
    const drafts: AgentMailboxMessage[] = [];
    const services = mailboxServices([selected], drafts, [selected]);
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "read-1", "core_mailbox_read", {
        messageId: "message-ada",
      }),
      providerToolCall("workers-ai", "draft-1", "core_mailbox_draft", {
        to: "wrong@example.com",
        subject: "Re: Launch",
        body: "Draft body",
        replyToMessageId: "message-ada",
      }),
      { response: "The selected email is from Ada, so I need to use ada@example.com. Should I do that?" },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "mailbox-wrong-recipient",
      turnId: "turn-wrong-recipient",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Reply to the selected message"),
      mailboxServices: services,
    });

    expect(response.replyText).toContain("ada@example.com");
    expect(response.emailAction).toBeNull();
    expect(drafts).toHaveLength(0);
    expect(database.executions.at(-1)).toMatchObject({
      status: "failed",
      error_message: expect.stringContaining("must match"),
    });
  });

  it("replays a mailbox draft tool call without creating a duplicate", async () => {
    const database = createExecutionDb();
    const drafts: AgentMailboxMessage[] = [];
    const services = mailboxServices([], drafts, []);
    const run = () => runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "mailbox-draft-replay",
      turnId: "turn-replay",
      ownerTimezone: "Europe/Dublin",
      route: providerRoute("workers-ai", [
        providerToolCall("workers-ai", "draft-1", "core_mailbox_draft", {
          to: "ada@example.com",
          subject: "Launch checklist",
          body: "The launch checklist is ready.",
        }),
        { response: "I saved the draft for review. It has not been sent." },
      ]) as never,
      messages: baseMessages("Draft an email to Ada saying the launch checklist is ready."),
      mailboxServices: services,
    });

    const first = await run();
    const second = await run();

    expect(first.emailAction).toEqual({ kind: "drafted", draftId: "draft-1" });
    expect(second.emailAction).toEqual(first.emailAction);
    expect(drafts).toHaveLength(1);
    expect(database.executions).toHaveLength(1);
  });

  it("does not expose a sending tool", () => {
    expect(
      CORE_CHAT_TOOLS.filter((tool) => tool.capabilityId.startsWith("core.mailbox."))
        .map((tool) => tool.capabilityId),
    ).toEqual([
      "core.mailbox.search",
      "core.mailbox.read",
      "core.mailbox.draft",
    ]);
  });
});

function mailboxServices(
  allMessages: AgentMailboxMessage[],
  drafts: AgentMailboxMessage[],
  searchResults: AgentMailboxMessage[],
) {
  return {
    async search() {
      return { messages: searchResults, total: searchResults.length };
    },
    async read(messageId: string) {
      const message = allMessages.find((item) => item.id === messageId);
      return message
        ? { message }
        : { error: "Message not found", status: 404 };
    },
    async createDraft(input: Record<string, unknown>) {
      const draft = mailboxMessage({
        id: `draft-${drafts.length + 1}`,
        direction: "outbound",
        fromAddress: "me@me3.local",
        toAddress: String(input.toAddress || ""),
        subject: String(input.subject || ""),
        body: String(input.textBody || ""),
        preview: String(input.textBody || "").slice(0, 280),
        folder: "drafts",
        status: "pending_approval",
      });
      drafts.push(draft);
      return { draft };
    },
  };
}

function mailboxMessage(
  overrides: Partial<AgentMailboxMessage> & { id: string },
): AgentMailboxMessage {
  return {
    direction: "inbound",
    kind: "email",
    status: "received",
    threadKey: overrides.id,
    providerId: null,
    providerMessageId: null,
    fromAddress: "sender@example.com",
    fromName: null,
    toAddress: "owner@me3.local",
    subject: "Message",
    body: "Message body",
    htmlBody: null,
    preview: "Message body",
    metadata: {},
    unsubscribeAction: null,
    sourceId: null,
    folder: "inbox",
    readAt: null,
    unread: true,
    agentSummary: null,
    agentLabels: [],
    forwardedTo: null,
    errorMessage: null,
    createdBy: "provider",
    approvedByUserId: null,
    receivedAt: "2026-07-10T08:00:00.000Z",
    approvedAt: null,
    sentAt: null,
    createdAt: "2026-07-10T08:00:00.000Z",
    ...overrides,
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
    providerId: "workers-ai",
    model: providerId === "workers-ai" ? "workers-test-model" : `${providerId}/test-model`,
    backupModel: null,
    apiKey: null,
    ai: { run: next },
    aiGateway: null,
    configured: true,
  };
}

function providerToolCall(
  providerId: "workers-ai" | "openai" | "anthropic",
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
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

function providerText(providerId: "workers-ai" | "openai" | "anthropic", text: string) {
  if (providerId === "openai") return { choices: [{ message: { content: text } }] };
  if (providerId === "anthropic") return { content: [{ type: "text", text }] };
  return { response: text };
}

function createExecutionDb() {
  const executions: ExecutionRow[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (!sql.includes("FROM agent_tool_executions")) return null as T;
              return (executions.find(
                (row) =>
                  row.user_id === values[0] &&
                  row.request_id === values[1] &&
                  row.tool_call_id === values[2],
              ) || null) as T;
            },
            async all<T>() {
              return { results: [] as T[] };
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
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db, executions };
}

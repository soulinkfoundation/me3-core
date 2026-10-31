import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listAgentMailboxThreadMessages,
  type AgentMailboxMessage,
} from "@me3-core/plugin-agent-chat";
import {
  listMailboxThreads,
  listMailboxThreadMessages,
  moveMailboxThread,
  resolveMailboxThreadKey,
  setMailboxThreadReadState,
  summarizeMailboxThread,
} from "./mailbox-threads";

describe("mailbox threads", () => {
  it("keeps nested replies on the root References message", () => {
    expect(
      resolveMailboxThreadKey(
        {
          references: "<root@example.com> <previous@example.com>",
          "in-reply-to": "<previous@example.com>",
        },
        "<current@example.com>",
      ),
    ).toBe("<root@example.com>");
    expect(resolveMailboxThreadKey({}, "<current@example.com>")).toBe(
      "<current@example.com>",
    );
  });

  it("returns stable cursor pages of lightweight thread summaries", async () => {
    const firstPage = [
      summaryRow("thread-c", "2026-07-16T12:00:00.000Z"),
      summaryRow("thread-b", "2026-07-16T11:00:00.000Z"),
      summaryRow("thread-a", "2026-07-16T10:00:00.000Z"),
    ];
    const firstDb = captureDb({ rows: firstPage });
    const result = await listMailboxThreads({ DB: firstDb.db } as never, "owner", {
      folder: "inbox",
      query: "100%_done",
      limit: 2,
    });

    expect(result).toEqual({
      threads: [
        expect.objectContaining({ id: "thread-c", messageCount: 2, participants: ["a@example.com"] }),
        expect.objectContaining({ id: "thread-b", messageCount: 2, participants: ["a@example.com"] }),
      ],
      nextCursor: expect.any(String),
    });
    if ("error" in result || !result.nextCursor) throw new Error("Expected a next cursor");
    expect(firstDb.calls[0]?.sql).toContain("ROW_NUMBER() OVER");
    expect(firstDb.calls[0]?.sql).toContain("json_array_length");
    expect(firstDb.calls[0]?.sql).not.toContain("SELECT m.*");
    expect(firstDb.calls[0]?.values).toEqual([
      "owner",
      "inbox",
      "%100\\%\\_done%",
      "%100\\%\\_done%",
      "%100\\%\\_done%",
      "%100\\%\\_done%",
      3,
    ]);

    const nextDb = captureDb({ rows: [] });
    await listMailboxThreads({ DB: nextDb.db } as never, "owner", {
      folder: "inbox",
      limit: 2,
      cursor: result.nextCursor,
    });
    expect(nextDb.calls[0]?.values).toEqual([
      "owner",
      "inbox",
      "2026-07-16T11:00:00.000Z",
      "2026-07-16T11:00:00.000Z",
      "thread-b",
      3,
    ]);
  });

  it("rejects invalid cursors and folders", async () => {
    const fake = captureDb({ rows: [] });
    await expect(
      listMailboxThreads({ DB: fake.db } as never, "owner", { cursor: "not-json" }),
    ).resolves.toEqual({ error: "Invalid cursor", status: 400 });
    await expect(
      listMailboxThreads({ DB: fake.db } as never, "owner", { folder: "junk" }),
    ).resolves.toEqual({ error: "Invalid folder", status: 400 });
    expect(fake.calls).toHaveLength(0);
  });

  it("builds full-thread metadata from chronological message detail", () => {
    const messages = [
      message({
        id: "inbound",
        direction: "inbound",
        fromAddress: "Client@example.com",
        toAddress: "owner@example.com",
        unread: true,
        receivedAt: "2026-07-16T10:00:00.000Z",
        metadata: { attachments: [{ storageKey: "one" }] },
      }),
      message({
        id: "outbound",
        fromAddress: "owner@example.com",
        toAddress: "client@example.com",
        subject: "Re: Project update",
        body: "Latest\n\nreply",
        preview: "Latest\n\nreply",
        sentAt: "2026-07-16T11:00:00.000Z",
        metadata: { attachmentCount: 2 },
      }),
    ];

    expect(summarizeMailboxThread("thread-1", messages)).toEqual({
      id: "thread-1",
      subject: "Re: Project update",
      participants: ["client@example.com", "owner@example.com"],
      latestSnippet: "Latest reply",
      latestMessageId: "outbound",
      messageCount: 2,
      unreadCount: 1,
      attachmentCount: 3,
      lastActivity: "2026-07-16T11:00:00.000Z",
    });
  });

  it("loads full thread bodies through the owner-scoped indexed path", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const raw = {
      id: "message-1",
      direction: "inbound",
      message_kind: "email",
      status: "received",
      thread_key: "thread-1",
      provider_id: null,
      provider_message_id: null,
      from_address: "client@example.com",
      to_address: "owner@example.com",
      subject: "Hello",
      text_body: "Full message body",
      html_body: null,
      raw_headers_json: null,
      metadata_json: null,
      agent_idempotency_key: null,
      source_id: null,
      folder: "inbox",
      read_at: null,
      agent_summary: null,
      agent_labels_json: null,
      forwarded_to: null,
      error_message: null,
      created_by: "system",
      approved_by_user_id: null,
      received_at: "2026-07-16T10:00:00.000Z",
      approved_at: null,
      sent_at: null,
      created_at: "2026-07-16T10:00:00.000Z",
    };
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              async first() {
                return { id: "mailbox-1" };
              },
              async all() {
                return { results: [raw] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      listAgentMailboxThreadMessages({ DB: db } as never, "owner", "thread-1"),
    ).resolves.toMatchObject({
      messages: [{ id: "message-1", body: "Full message body", unread: true }],
    });
    expect(calls[0]?.values).toEqual(["owner"]);
    expect(calls[1]?.values).toEqual(["mailbox-1", "thread-1"]);
    expect(calls[1]?.sql).toContain("mailbox_id = ? AND thread_key = ?");
  });

  it("applies owner-scoped thread mutations without moving drafts", async () => {
    const fake = captureDb({ rows: [], changes: 2 });

    await expect(
      setMailboxThreadReadState({ DB: fake.db } as never, "owner", "thread-1", false),
    ).resolves.toEqual({ ok: true, id: "thread-1", read: false });
    await expect(
      moveMailboxThread(
        { DB: fake.db } as never,
        "owner",
        "thread-1",
        "archive",
        "inbox",
      ),
    ).resolves.toEqual({
      ok: true,
      id: "thread-1",
      folder: "archive",
      fromFolder: "inbox",
    });

    expect(fake.calls[0]?.values).toEqual([false, "owner", "thread-1"]);
    expect(fake.calls[1]?.values).toEqual(["archive", "owner", "thread-1", "inbox"]);
    expect(fake.calls[1]?.sql).toContain("AND folder = ?");
    expect(fake.calls[1]?.sql).toContain("message_kind != 'draft'");
  });

  it("archives and restores only the active folder in mixed Inbox and Sent threads", async () => {
    const messages = [
      { id: "inbox-1", threadId: "thread-1", kind: "email", folder: "inbox" },
      { id: "sent-1", threadId: "thread-1", kind: "email", folder: "sent" },
      { id: "draft-1", threadId: "thread-1", kind: "draft", folder: "drafts" },
    ];
    const db = threadMoveDb(messages);

    await expect(
      moveMailboxThread(db as never, "owner", "thread-1", "archive", "inbox"),
    ).resolves.toMatchObject({ ok: true });
    expect(messages).toEqual([
      { id: "inbox-1", threadId: "thread-1", kind: "email", folder: "archive" },
      { id: "sent-1", threadId: "thread-1", kind: "email", folder: "sent" },
      { id: "draft-1", threadId: "thread-1", kind: "draft", folder: "drafts" },
    ]);

    await expect(
      moveMailboxThread(db as never, "owner", "thread-1", "inbox", "archive"),
    ).resolves.toMatchObject({ ok: true });
    expect(messages).toEqual([
      { id: "inbox-1", threadId: "thread-1", kind: "email", folder: "inbox" },
      { id: "sent-1", threadId: "thread-1", kind: "email", folder: "sent" },
      { id: "draft-1", threadId: "thread-1", kind: "draft", folder: "drafts" },
    ]);
  });

  it("groups legacy outbound roots and nested References chains without rewriting rows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "me3-mailbox-threads-"));
    const database = join(directory, "mailbox.sqlite");
    try {
      sqliteExec(database, MAILBOX_SQLITE_SCHEMA);
      sqliteExec(
        database,
        readFileSync(
          new URL("../migrations/0020_mailbox_thread_index.sql", import.meta.url),
          "utf8",
        ),
      );
      sqliteExec(database, LEGACY_THREAD_FIXTURE);
      const env = { DB: sqliteD1(database) } as never;

      const listed = await listMailboxThreads(env, "owner", { folder: "inbox" });
      expect(listed).toEqual({
        threads: [
          expect.objectContaining({
            id: "<root@example.com>",
            latestMessageId: "nested-reply",
            messageCount: 3,
            unreadCount: 2,
          }),
        ],
        nextCursor: null,
      });

      const detailed = await listMailboxThreadMessages(
        env,
        "owner",
        "<root@example.com>",
      );
      expect("error" in detailed ? detailed : detailed.messages.map((message) => message.id)).toEqual([
        "legacy-root",
        "first-reply",
        "nested-reply",
      ]);

      await expect(
        setMailboxThreadReadState(env, "owner", "<root@example.com>", true),
      ).resolves.toMatchObject({ ok: true });
      expect(
        sqliteRows<{ id: string; read_at: string | null }>(
          database,
          "SELECT id, read_at FROM mailbox_messages WHERE direction = 'inbound' ORDER BY id",
        ).every((row) => row.read_at),
      ).toBe(true);

      await expect(
        moveMailboxThread(env, "owner", "<root@example.com>", "archive", "inbox"),
      ).resolves.toMatchObject({ ok: true });
      expect(
        sqliteRows<{ id: string; folder: string }>(
          database,
          "SELECT id, folder FROM mailbox_messages ORDER BY id",
        ),
      ).toEqual([
        { id: "first-reply", folder: "archive" },
        { id: "legacy-root", folder: "sent" },
        { id: "nested-reply", folder: "archive" },
        { id: "unrelated-root", folder: "sent" },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("groups managed replies by the provider-assigned Message-ID", async () => {
    const directory = mkdtempSync(join(tmpdir(), "me3-managed-mailbox-threads-"));
    const database = join(directory, "mailbox.sqlite");
    try {
      sqliteExec(database, MAILBOX_SQLITE_SCHEMA);
      sqliteExec(
        database,
        readFileSync(
          new URL("../migrations/0020_mailbox_thread_index.sql", import.meta.url),
          "utf8",
        ),
      );
      sqliteExec(database, MANAGED_PROVIDER_THREAD_FIXTURE);
      const env = { DB: sqliteD1(database) } as never;

      const listed = await listMailboxThreads(env, "owner", { folder: "inbox" });
      expect(listed).toEqual({
        threads: [
          expect.objectContaining({
            id: "<provider-root@me3.app>",
            latestMessageId: "managed-reply",
            messageCount: 2,
          }),
        ],
        nextCursor: null,
      });

      const detailed = await listMailboxThreadMessages(
        env,
        "owner",
        "<provider-root@me3.app>",
      );
      expect("error" in detailed ? detailed : detailed.messages.map((message) => message.id)).toEqual([
        "managed-root",
        "managed-reply",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function summaryRow(threadId: string, lastActivity: string) {
  return {
    thread_id: threadId,
    subject: "Project update",
    participants_json: '["a@example.com"]',
    latest_snippet: "A concise preview",
    latest_message_id: `${threadId}-message`,
    message_count: 2,
    unread_count: 1,
    attachment_count: 1,
    last_activity: lastActivity,
  };
}

function message(overrides: Partial<AgentMailboxMessage>): AgentMailboxMessage {
  return {
    id: "message-1",
    direction: "outbound",
    kind: "email",
    status: "sent",
    threadKey: "thread-1",
    providerId: null,
    providerMessageId: null,
    fromAddress: "owner@example.com",
    fromName: null,
    toAddress: "client@example.com",
    recipientAddresses: [],
    subject: "Project update",
    body: "Body",
    htmlBody: null,
    preview: "Body",
    metadata: {},
    unsubscribeAction: null,
    sourceId: null,
    folder: "sent",
    spam: false,
    spamAt: null,
    readAt: null,
    unread: false,
    agentSummary: null,
    agentLabels: [],
    forwardedTo: null,
    errorMessage: null,
    createdBy: "owner",
    approvedByUserId: null,
    receivedAt: null,
    approvedAt: null,
    sentAt: "2026-07-16T09:00:00.000Z",
    createdAt: "2026-07-16T09:00:00.000Z",
    ...overrides,
  };
}

function captureDb(input: { rows: unknown[]; changes?: number }) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              async all() {
                return { results: input.rows };
              },
              async run() {
                return { meta: { changes: input.changes ?? 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

function threadMoveDb(
  messages: Array<{ id: string; threadId: string; kind: string; folder: string }>,
) {
  return {
    DB: {
      prepare() {
        return {
          bind(
            folder: string,
            ownerId: string,
            threadId: string,
            fromFolder: string,
          ) {
            return {
              async run() {
                let changes = 0;
                if (ownerId === "owner") {
                  for (const message of messages) {
                    if (
                      message.threadId === threadId &&
                      message.folder === fromFolder &&
                      message.kind !== "draft"
                    ) {
                      message.folder = folder;
                      changes += 1;
                    }
                  }
                }
                return { meta: { changes } };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

function sqliteD1(database: string): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async all<T>() {
          return { results: sqliteRows<T>(database, bindSql(sql, values)) };
        },
        async first<T>() {
          return sqliteRows<T>(database, bindSql(sql, values))[0] || null;
        },
        async run() {
          const rows = sqliteRows<{ changes: number }>(
            database,
            `${bindSql(sql, values)}; SELECT changes() AS changes`,
          );
          return { meta: { changes: rows[0]?.changes || 0 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function sqliteExec(database: string, sql: string): void {
  execFileSync("sqlite3", [database], { input: sql, encoding: "utf8" });
}

function sqliteRows<T>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database], {
    input: sql,
    encoding: "utf8",
  }).trim();
  return output ? JSON.parse(output) as T[] : [];
}

function bindSql(sql: string, values: unknown[]): string {
  let index = 0;
  let quote = "";
  let output = "";
  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position] || "";
    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[position + 1] === quote) {
          output += quote;
          position += 1;
        } else {
          quote = "";
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === "?") {
      output += sqliteLiteral(values[index]);
      index += 1;
    } else {
      output += character;
    }
  }
  if (index !== values.length) throw new Error("SQLite test binding count mismatch");
  return output;
}

function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

const MAILBOX_SQLITE_SCHEMA = `
  CREATE TABLE mailbox_aliases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    alias_local_part TEXT NOT NULL,
    forwarding_email TEXT NOT NULL,
    forwarding_status TEXT NOT NULL DEFAULT 'pending',
    forwarding_enabled INTEGER NOT NULL DEFAULT 0,
    forwarding_mode TEXT NOT NULL DEFAULT 'me3_only',
    status TEXT NOT NULL DEFAULT 'active',
    approval_policy TEXT NOT NULL DEFAULT 'all',
    daily_inbound_limit INTEGER NOT NULL DEFAULT 200,
    daily_outbound_limit INTEGER NOT NULL DEFAULT 200,
    activated_at TEXT,
    cf_destination_id TEXT,
    cf_destination_verified_at TEXT,
    cf_rule_id TEXT,
    cf_last_synced_at TEXT,
    cf_last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE mailbox_messages (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    message_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    thread_key TEXT,
    provider_id TEXT,
    provider_message_id TEXT,
    from_address TEXT,
    to_address TEXT,
    subject TEXT,
    text_body TEXT,
    html_body TEXT,
    raw_headers_json TEXT,
    metadata_json TEXT,
    agent_idempotency_key TEXT,
    source_id TEXT,
    folder TEXT NOT NULL,
    spam_at TEXT,
    read_at TEXT,
    agent_summary TEXT,
    agent_labels_json TEXT,
    forwarded_to TEXT,
    error_message TEXT,
    created_by TEXT NOT NULL,
    approved_by_user_id TEXT,
    received_at TEXT,
    approved_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO mailbox_aliases (id, user_id, alias_local_part, forwarding_email)
  VALUES ('mailbox-1', 'owner', 'owner', 'owner@example.com');
`;

const LEGACY_THREAD_FIXTURE = `
  INSERT INTO mailbox_messages (
    id, mailbox_id, direction, message_kind, status, thread_key,
    from_address, to_address, subject, text_body, raw_headers_json, metadata_json,
    folder, created_by, received_at, sent_at, created_at, updated_at
  ) VALUES
  (
    'legacy-root', 'mailbox-1', 'outbound', 'email', 'sent', 'legacy-random-uuid',
    'owner@example.com', 'client@example.com', 'Project', 'Root message', NULL,
    '{"outbound_headers":{"message_id":"<root@example.com>","in_reply_to":null,"references":null}}',
    'sent', 'owner', NULL, '2026-07-16T09:00:00.000Z',
    '2026-07-16T09:00:00.000Z', '2026-07-16T09:00:00.000Z'
  ),
  (
    'first-reply', 'mailbox-1', 'inbound', 'email', 'received', '<root@example.com>',
    'client@example.com', 'owner@example.com', 'Re: Project', 'First reply',
    '{"message-id":"<reply-1@example.com>","references":"<root@example.com>"}', NULL,
    'inbox', 'system', '2026-07-16T10:00:00.000Z', NULL,
    '2026-07-16T10:00:00.000Z', '2026-07-16T10:00:00.000Z'
  ),
  (
    'nested-reply', 'mailbox-1', 'inbound', 'email', 'received',
    '<root@example.com> <reply-1@example.com>',
    'client@example.com', 'owner@example.com', 'Re: Project', 'Nested reply',
    '{"message-id":"<reply-2@example.com>","references":"<root@example.com> <reply-1@example.com>"}', NULL,
    'inbox', 'system', '2026-07-16T11:00:00.000Z', NULL,
    '2026-07-16T11:00:00.000Z', '2026-07-16T11:00:00.000Z'
  ),
  (
    'unrelated-root', 'mailbox-1', 'outbound', 'email', 'sent', 'other-random-uuid',
    'owner@example.com', 'other@example.com', 'Other', 'Unrelated', NULL,
    '{"outbound_headers":{"message_id":"<other@example.com>","in_reply_to":null,"references":null}}',
    'sent', 'owner', NULL, '2026-07-16T12:00:00.000Z',
    '2026-07-16T12:00:00.000Z', '2026-07-16T12:00:00.000Z'
  );
`;

const MANAGED_PROVIDER_THREAD_FIXTURE = `
  INSERT INTO mailbox_messages (
    id, mailbox_id, direction, message_kind, status, thread_key,
    provider_id, provider_message_id, from_address, to_address, subject, text_body,
    raw_headers_json, metadata_json, folder, created_by, received_at, sent_at,
    created_at, updated_at
  ) VALUES
  (
    'managed-root', 'mailbox-1', 'outbound', 'email', 'sent', '<requested-root@me3.local>',
    'managed_gateway', '<provider-root@me3.app>', 'owner@me3.app', 'client@example.com',
    'Managed project', 'Root message', NULL,
    '{"outbound_headers":{"message_id":"<requested-root@me3.local>","in_reply_to":null,"references":null}}',
    'sent', 'owner', NULL, '2026-07-16T09:00:00.000Z',
    '2026-07-16T09:00:00.000Z', '2026-07-16T09:00:00.000Z'
  ),
  (
    'managed-reply', 'mailbox-1', 'inbound', 'email', 'received', '<provider-root@me3.app>',
    'managed_gateway', '<reply@example.com>', 'client@example.com', 'owner@me3.app',
    'Re: Managed project', 'Reply body',
    '{"message-id":"<reply@example.com>","in-reply-to":"<provider-root@me3.app>","references":"<provider-root@me3.app>"}',
    NULL, 'inbox', 'managed_gateway', '2026-07-16T10:00:00.000Z', NULL,
    '2026-07-16T10:00:00.000Z', '2026-07-16T10:00:00.000Z'
  );
`;

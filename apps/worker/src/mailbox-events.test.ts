import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverInboundEmail, type ForwardableEmailMessageLike } from "./mailbox-inbound";
import { registerMailboxRoutes } from "./routes/mailbox";
import type { Env } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mailbox event stream", () => {
  it("requires an authenticated owner and cannot be redirected to another owner", async () => {
    const app = new Hono<{ Bindings: Env }>();
    registerMailboxRoutes(app, {
      requireOwner: async (c) => c.req.header("X-Test-Owner") || null,
      unauthorized: (c) => c.json({ error: "Authentication required" }, 401),
    });
    const idFromName = vi.fn(() => ({ owner: "owner" }));
    const streamFetch = vi.fn(async () =>
      new Response(": connected\n\n", {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
    );
    const env = {
      DB: {} as D1Database,
      ME3_USER_AGENT: {
        idFromName,
        get: vi.fn(() => ({ fetch: streamFetch })),
      } as unknown as DurableObjectNamespace,
    } as Env;

    const unauthorized = await app.fetch(
      new Request("http://localhost/api/mailbox/events?owner_id=someone-else"),
      env,
    );
    expect(unauthorized.status).toBe(401);
    expect(idFromName).not.toHaveBeenCalled();

    const response = await app.fetch(
      new Request("http://localhost/api/mailbox/events?owner_id=someone-else", {
        headers: { "X-Test-Owner": "owner" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain(": connected");
    expect(idFromName).toHaveBeenCalledTimes(1);
    expect(idFromName).toHaveBeenCalledWith("owner");
    expect(streamFetch).toHaveBeenCalledWith(
      "https://me3-core-user-agent.internal/events/mailbox/subscribe",
    );
  });

  it("publishes a safe invalidation only after direct inbound persistence", async () => {
    const db = new InboundEventTestDb();
    const publishedEvents: Record<string, unknown>[] = [];
    const eventFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(db.mailboxMessages).toHaveLength(1);
      publishedEvents.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    });
    const idFromName = vi.fn((ownerId: string) => ({ ownerId }));
    const result = await deliverInboundEmail(
      inboundEmail("Direct delivery"),
      eventEnv(db, eventFetch, idFromName),
    );

    expect(result).toMatchObject({
      status: "accepted",
      mailboxId: "mailbox-1",
    });
    expect(idFromName).toHaveBeenCalledWith("owner");
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]).toEqual({
      type: "mailbox.message_received",
      mailboxId: "mailbox-1",
      messageId: db.mailboxMessages[0]?.id,
      receivedAt: db.mailboxMessages[0]?.receivedAt,
    });
    expect(Object.keys(publishedEvents[0] || {}).sort()).toEqual([
      "mailboxId",
      "messageId",
      "receivedAt",
      "type",
    ]);
  });

  it("does not publish when inbound persistence fails", async () => {
    const db = new InboundEventTestDb();
    db.failMailboxInsert = true;
    const eventFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await deliverInboundEmail(
      inboundEmail("Persistence failure"),
      eventEnv(db, eventFetch),
    );

    expect(result.status).toBe("unavailable");
    expect(eventFetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Inbound email processing failed",
      expect.any(Error),
    );
  });

  it("keeps a stored inbound email accepted when the event channel fails", async () => {
    const db = new InboundEventTestDb();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const eventFetch = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await deliverInboundEmail(
      inboundEmail("Stored safely"),
      eventEnv(db, eventFetch),
    );

    expect(result.status).toBe("accepted");
    expect(db.mailboxMessages).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("Mailbox realtime invalidation failed", {
      errorName: "Error",
    });
  });
});

function eventEnv(
  db: InboundEventTestDb,
  eventFetch: (...args: any[]) => Promise<Response>,
  idFromName = vi.fn((ownerId: string) => ({ ownerId })),
): Env {
  return {
    DB: db as unknown as D1Database,
    ME3_USER_AGENT: {
      idFromName,
      get: vi.fn(() => ({ fetch: eventFetch })),
    } as unknown as DurableObjectNamespace,
  } as Env;
}

function inboundEmail(subject: string): ForwardableEmailMessageLike {
  const raw = [
    "From: Client <client@example.com>",
    "To: owner@example.com",
    `Subject: ${subject}`,
    `Message-ID: <${subject.toLowerCase().replace(/\s+/g, "-")}@example.com>`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello from the inbound route.",
  ].join("\r\n");
  const bytes = new TextEncoder().encode(raw);
  return {
    from: "client@example.com",
    to: "owner@example.com",
    headers: new Headers(),
    raw: new Response(bytes).body!,
    rawSize: bytes.byteLength,
    canBeForwarded: false,
    setReject: vi.fn(),
    forward: vi.fn(async () => undefined),
  };
}

class InboundEventTestDb {
  readonly mailboxMessages: Array<{ id: string; receivedAt: string }> = [];
  failMailboxInsert = false;

  async batch(statements: InboundEventTestStatement[]) {
    const before = this.mailboxMessages.length;
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.mailboxMessages.length = before;
      throw error;
    }
  }

  prepare(sql: string) {
    return new InboundEventTestStatement(this, sql);
  }
}

class InboundEventTestStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: InboundEventTestDb,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM mailbox_aliases")) {
      return {
        id: "mailbox-1",
        user_id: "owner",
        alias_local_part: "owner",
        forwarding_email: null,
        forwarding_status: "pending",
        forwarding_enabled: 0,
        forwarding_mode: "me3_only",
        status: "active",
        approval_policy: "all",
        daily_inbound_limit: 200,
        daily_outbound_limit: 200,
        activated_at: "2026-09-03T08:00:00.000Z",
        cf_destination_id: null,
        cf_destination_verified_at: null,
        cf_rule_id: null,
        cf_last_synced_at: null,
        cf_last_error: null,
        created_at: "2026-09-03T08:00:00.000Z",
        updated_at: "2026-09-03T08:00:00.000Z",
      } as T;
    }
    return null as T | null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO mailbox_messages")) {
      if (this.db.failMailboxInsert) throw new Error("Simulated persistence failure");
      this.db.mailboxMessages.push({
        id: String(this.values[0]),
        receivedAt: String(this.values[15]),
      });
    }
    return { success: true, meta: { changes: 1 } };
  }
}

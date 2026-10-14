import type { Env } from "./types";
import {
  MAILBOX_EVENTS_PUBLISH_PATH,
  MAILBOX_EVENTS_SUBSCRIBE_PATH,
  MAILBOX_MESSAGE_RECEIVED_EVENT,
  type MailboxMessageReceivedEvent,
} from "./mailbox-events";

export class Me3UserAgent {
  private readonly purgeStorage: DurableObjectStorage;
  private readonly mailboxSubscribers = new Set<
    ReadableStreamDefaultController<Uint8Array>
  >();
  private mailboxKeepalive: ReturnType<typeof setInterval> | null = null;

  constructor(
    state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.purgeStorage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === MAILBOX_EVENTS_SUBSCRIBE_PATH) {
      return this.subscribeToMailboxEvents(request);
    }

    if (request.method === "POST" && url.pathname === MAILBOX_EVENTS_PUBLISH_PATH) {
      const event = await request.json().catch(() => null);
      if (!isMailboxMessageReceivedEvent(event)) {
        return Response.json({ ok: false, error: "Invalid mailbox event" }, { status: 400 });
      }
      this.broadcastMailboxEvent(event);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/managed-lifecycle/purge-storage") {
      const installationId = request.headers.get("X-ME3-Managed-Installation") || "";
      if (
        !/^mi-[0-9a-f]{16}$/.test(installationId) ||
        installationId !== this.env.ME3_MANAGED_INSTALLATION_ID
      ) {
        return Response.json({ ok: false, error: "Not found" }, { status: 404 });
      }
      // No live state is written here. Historical chat cache keys are D1-backed
      // and may be purged with this installation-bound hook.
      await this.purgeStorage.deleteAll();
      const remaining = await this.purgeStorage.list({ limit: 1 });
      if (remaining.size > 0) {
        return Response.json(
          { ok: false, error: "Durable Object storage purge did not complete" },
          { status: 503 },
        );
      }
      return Response.json({ ok: true, purged: true });
    }

    if (url.pathname.endsWith("/health")) {
      return Response.json({
        ok: true,
        service: "me3-core-user-agent",
        storage: Boolean(this.purgeStorage),
        ai: Boolean(this.env.AI),
      });
    }

    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  private subscribeToMailboxEvents(request: Request): Response {
    const encoder = new TextEncoder();
    let subscriber: ReadableStreamDefaultController<Uint8Array> | null = null;
    const removeSubscriber = () => {
      if (!subscriber) return;
      this.mailboxSubscribers.delete(subscriber);
      subscriber = null;
      request.signal.removeEventListener("abort", removeSubscriber);
      this.stopMailboxKeepaliveIfIdle();
    };

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = controller;
        this.mailboxSubscribers.add(controller);
        controller.enqueue(encoder.encode("retry: 3000\n: connected\n\n"));
        request.signal.addEventListener("abort", removeSubscriber, { once: true });
        this.startMailboxKeepalive();
      },
      cancel: removeSubscriber,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  private broadcastMailboxEvent(event: MailboxMessageReceivedEvent): void {
    const frame = new TextEncoder().encode(
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    for (const subscriber of this.mailboxSubscribers) {
      try {
        subscriber.enqueue(frame);
      } catch {
        this.mailboxSubscribers.delete(subscriber);
      }
    }
    this.stopMailboxKeepaliveIfIdle();
  }

  private startMailboxKeepalive(): void {
    if (this.mailboxKeepalive !== null) return;
    // SSE comments keep intermediaries from closing an idle stream; they never query mailbox state.
    this.mailboxKeepalive = setInterval(() => {
      const frame = new TextEncoder().encode(": keepalive\n\n");
      for (const subscriber of this.mailboxSubscribers) {
        try {
          subscriber.enqueue(frame);
        } catch {
          this.mailboxSubscribers.delete(subscriber);
        }
      }
      this.stopMailboxKeepaliveIfIdle();
    }, 25_000);
  }

  private stopMailboxKeepaliveIfIdle(): void {
    if (this.mailboxSubscribers.size > 0 || this.mailboxKeepalive === null) return;
    clearInterval(this.mailboxKeepalive);
    this.mailboxKeepalive = null;
  }
}

function isMailboxMessageReceivedEvent(value: unknown): value is MailboxMessageReceivedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event.type === MAILBOX_MESSAGE_RECEIVED_EVENT &&
    typeof event.mailboxId === "string" &&
    Boolean(event.mailboxId) &&
    typeof event.messageId === "string" &&
    Boolean(event.messageId) &&
    typeof event.receivedAt === "string" &&
    Boolean(event.receivedAt)
  );
}

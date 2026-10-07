import type { Env } from "./types";
import {
  dispatchAgentSandboxTurn,
  isAgentSandboxDispatchInput,
  type AgentChatRuntimeStreamEvent,
} from "./agent-chat";
import { createAgentSchedulingToolServices } from "./agent-scheduling";
import { createPeopleSearchToolServices } from "./network-directory";
import { createWebResearchToolServices } from "./web-research";
import { listCorePluginRecords } from "./plugins";
import {
  MAILBOX_EVENTS_PUBLISH_PATH,
  MAILBOX_EVENTS_SUBSCRIBE_PATH,
  MAILBOX_MESSAGE_RECEIVED_EVENT,
  type MailboxMessageReceivedEvent,
} from "./mailbox-events";

const RECONSTRUCTABLE_STORAGE_KEYS = new Set([
  "userId",
  "lastSandboxConnectionId",
  "lastSandboxTurnId",
  "lastSandboxTurnAt",
  "agent-chat:sandbox:result-keys",
]);
const RECONSTRUCTABLE_RESULT_PREFIX = "agent-chat:sandbox:result:";

/**
 * Managed portable exports intentionally omit Durable Object storage. Every
 * allowed key is therefore cache or routing metadata whose canonical turn,
 * message, connection, and owner records live in D1.
 */
export function isReconstructableUserAgentStorageKey(key: string): boolean {
  return (
    RECONSTRUCTABLE_STORAGE_KEYS.has(key) ||
    (key.startsWith(RECONSTRUCTABLE_RESULT_PREFIX) && key.length > RECONSTRUCTABLE_RESULT_PREFIX.length)
  );
}

export class Me3UserAgent {
  private readonly purgeStorage: DurableObjectStorage;
  private readonly cacheStorage: ReturnType<typeof createReconstructableStorage>;
  private readonly mailboxSubscribers = new Set<
    ReadableStreamDefaultController<Uint8Array>
  >();
  private mailboxKeepalive: ReturnType<typeof setInterval> | null = null;

  constructor(
    state: DurableObjectState,
    private readonly env: Env,
    private readonly dispatch = dispatchAgentSandboxTurn,
  ) {
    this.purgeStorage = state.storage;
    this.cacheStorage = createReconstructableStorage(state.storage);
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
      // Safe only because dispatch storage is runtime-enforced as D1-backed
      // cache/metadata by createReconstructableStorage.
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

    if (request.method === "POST" && url.pathname === "/dispatch/sandbox") {
      const input = await request.json().catch(() => null);
      if (!isAgentSandboxDispatchInput(input)) {
        return Response.json(
          { ok: false, error: "Invalid sandbox dispatch payload" },
          { status: 400 },
        );
      }

      const response = await this.dispatch(
        this.env,
        this.cacheStorage,
        input,
        undefined,
        createAgentSchedulingToolServices(this.env, input.userId),
        createPeopleSearchToolServices(this.env, input.userId),
        createWebResearchToolServices(this.env, input.userId),
        await this.enabledPluginIds(),
      );
      return Response.json(response, { status: response.ok ? 200 : 500 });
    }

    if (request.method === "POST" && url.pathname === "/dispatch/sandbox/stream") {
      const input = await request.json().catch(() => null);
      if (!isAgentSandboxDispatchInput(input)) {
        return Response.json(
          { ok: false, error: "Invalid sandbox dispatch payload" },
          { status: 400 },
        );
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          const runtimeStartedAt = performance.now();
          let firstRuntimeEventAt: number | null = null;
          let visibleText = "";
          const send = (event: string, data: Record<string, unknown>) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          };
          const forward = async (event: AgentChatRuntimeStreamEvent) => {
            firstRuntimeEventAt ??= performance.now();
            if (event.event === "delta" && typeof event.data.text === "string") {
              visibleText += event.data.text;
            }
            if (
              (event.event === "tool" && event.data.clearText === true) ||
              (event.event === "status" && event.data.replaceText === true)
            ) {
              visibleText = "";
            }
            send(event.event, event.data);
          };
          try {
            const response = await this.dispatch(
              this.env,
              this.cacheStorage,
              input,
              { signal: request.signal, onEvent: forward },
              createAgentSchedulingToolServices(this.env, input.userId),
              createPeopleSearchToolServices(this.env, input.userId),
              createWebResearchToolServices(this.env, input.userId),
              await this.enabledPluginIds(),
            );
            const completedResponse = response.performance
              ? {
                  ...response,
                  performance: {
                    ...response.performance,
                    durableObjectFirstEventMs: firstRuntimeEventAt === null
                      ? null
                      : userAgentDurationMs(runtimeStartedAt, firstRuntimeEventAt),
                    durableObjectTotalMs: userAgentDurationMs(runtimeStartedAt),
                  },
                }
              : response;
            const finalText = response.replyText || "";
            if (visibleText !== finalText) {
              send("status", { state: "finalizing", replaceText: true });
              if (finalText) send("delta", { text: finalText });
            }
            send("done", completedResponse as unknown as Record<string, unknown>);
          } catch (error) {
            if (request.signal.aborted || isAbortError(error)) {
              send("status", { state: "cancelled" });
            } else {
              send("error", {
                ok: false,
                error: error instanceof Error ? error.message : "Agent stream failed",
              });
            }
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    if (url.pathname.endsWith("/health")) {
      return Response.json({
        ok: true,
        service: "me3-core-user-agent",
        storage: Boolean(this.purgeStorage),
        ai: Boolean(this.env.AI),
      });
    }

    return Response.json(
      {
        ok: true,
        message: "The ME3 user agent is ready for the first extraction slice.",
      },
      { status: 202 },
    );
  }

  private async enabledPluginIds(): Promise<ReadonlySet<string> | undefined> {
    if (this.env.ME3_ASSISTANT_RUNTIME !== "sdk") return undefined;
    const plugins = await listCorePluginRecords(this.env);
    return new Set(plugins.filter((plugin) => plugin.enabled && plugin.status === "installed").map((plugin) => plugin.id));
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

function createReconstructableStorage(storage: DurableObjectStorage) {
  const assertKey = (key: string) => {
    if (!isReconstructableUserAgentStorageKey(key)) {
      throw new Error("Durable Object storage key is not reconstructable from D1");
    }
  };
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      assertKey(key);
      return storage.get<T>(key);
    },
    async put<T = unknown>(key: string, value: T): Promise<void> {
      assertKey(key);
      await storage.put(key, value);
    },
    async delete(key: string | string[]): Promise<void> {
      const keys = Array.isArray(key) ? key : [key];
      for (const item of keys) assertKey(item);
      if (Array.isArray(key)) await storage.delete(key);
      else await storage.delete(key);
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function userAgentDurationMs(startedAt: number, finishedAt = performance.now()): number {
  return Number((finishedAt - startedAt).toFixed(2));
}

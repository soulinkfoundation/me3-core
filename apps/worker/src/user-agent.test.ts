import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), moduleDispatch: vi.fn() }));

vi.mock("./agent-chat", async (importOriginal) => ({
  ...await importOriginal<typeof import("./agent-chat")>(),
  dispatchAgentSandboxTurn: mocks.moduleDispatch,
  isAgentSandboxDispatchInput: () => true,
}));

import { isReconstructableUserAgentStorageKey, Me3UserAgent } from "./user-agent";

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.moduleDispatch.mockReset();
});

describe("ME3 user agent streaming", () => {
  it("delivers a safe mailbox invalidation to every connected owner session", async () => {
    const agent = new Me3UserAgent(state(), {} as never, mocks.dispatch);
    const subscribed = await agent.fetch(
      new Request("https://agent.internal/events/mailbox/subscribe"),
    );
    const reader = subscribed.body!.getReader();
    const secondSubscribed = await agent.fetch(
      new Request("https://agent.internal/events/mailbox/subscribe"),
    );
    const secondReader = secondSubscribed.body!.getReader();
    const decoder = new TextDecoder();

    expect(decoder.decode((await reader.read()).value)).toContain(": connected");
    expect(decoder.decode((await secondReader.read()).value)).toContain(": connected");

    const event = {
      type: "mailbox.message_received",
      mailboxId: "mailbox-1",
      messageId: "message-1",
      receivedAt: "2026-09-03T09:00:00.000Z",
    };
    const published = await agent.fetch(
      new Request("https://agent.internal/events/mailbox/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }),
    );
    const delivered = decoder.decode((await reader.read()).value);
    const secondDelivered = decoder.decode((await secondReader.read()).value);

    expect(published.status).toBe(204);
    expect(delivered).toBe(
      `event: mailbox.message_received\ndata: ${JSON.stringify(event)}\n\n`,
    );
    expect(secondDelivered).toBe(delivered);
    await reader.cancel();
    await secondReader.cancel();
  });

  it("streams lifecycle events and one exact persisted final reply", async () => {
    mocks.dispatch.mockImplementation(async (_env, _storage, _input, options) => {
      await options.onEvent({ event: "status", data: { state: "model_started" } });
      await options.onEvent({ event: "delta", data: { text: "Temporary text" } });
      await options.onEvent({
        event: "tool",
        data: { state: "started", clearText: true, capabilityId: "core.reminders.list" },
      });
      await options.onEvent({ event: "delta", data: { text: "Final reply." } });
      return response("Final reply.");
    });
    const agent = new Me3UserAgent(state(), {} as never, mocks.dispatch);
    const result = await agent.fetch(request());
    const text = await result.text();

    expect(result.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: status");
    expect(text).toContain("event: tool");
    expect(text.match(/event: delta/g)).toHaveLength(2);
    expect(text).not.toContain('"state":"finalizing"');
    expect(text).toContain('"replyText":"Final reply."');
    expect(text).toContain('"durableObjectFirstEventMs"');
    expect(text).toContain('"durableObjectTotalMs"');
    expect(text).toContain("event: done");
  });

  it("reconciles replayed or fallback text before done", async () => {
    mocks.dispatch.mockResolvedValue(response("Persisted final reply."));
    const agent = new Me3UserAgent(state(), {} as never, mocks.dispatch);
    const text = await (await agent.fetch(request())).text();

    expect(text).toContain('"state":"finalizing","replaceText":true');
    expect(text).toContain('event: delta\ndata: {"text":"Persisted final reply."}');
    expect(text).toContain("event: done");
  });

  it("propagates cancellation and never emits done", async () => {
    mocks.dispatch.mockImplementation((_env, _storage, _input, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      })
    );
    const controller = new AbortController();
    const agent = new Me3UserAgent(state(), {} as never, mocks.dispatch);
    const streamed = await agent.fetch(request(controller.signal));
    controller.abort();
    const text = await streamed.text();

    expect(text).toContain('"state":"cancelled"');
    expect(text).not.toContain("event: done");
  });

  it("purges Durable Object storage only through the installation-bound internal hook", async () => {
    const storage = {
      deleteAll: vi.fn(async () => undefined),
      list: vi.fn(async () => new Map()),
    };
    const agent = new Me3UserAgent(
      { storage } as unknown as DurableObjectState,
      { ME3_MANAGED_INSTALLATION_ID: "mi-1234567890abcdef" } as never,
      mocks.dispatch,
    );
    const rejected = await agent.fetch(
      new Request("https://agent.internal/managed-lifecycle/purge-storage", {
        method: "POST",
        headers: { "X-ME3-Managed-Installation": "mi-aaaaaaaaaaaaaaaa" },
      }),
    );
    expect(rejected.status).toBe(404);
    expect(storage.deleteAll).not.toHaveBeenCalled();

    const accepted = await agent.fetch(
      new Request("https://agent.internal/managed-lifecycle/purge-storage", {
        method: "POST",
        headers: { "X-ME3-Managed-Installation": "mi-1234567890abcdef" },
      }),
    );
    expect(accepted.status).toBe(200);
    expect(storage.deleteAll).toHaveBeenCalledOnce();
    expect(storage.list).toHaveBeenCalledWith({ limit: 1 });
  });

  it("allows only D1-reconstructable cache and routing keys in Durable Object storage", async () => {
    expect(isReconstructableUserAgentStorageKey("userId")).toBe(true);
    expect(isReconstructableUserAgentStorageKey("lastSandboxConnectionId")).toBe(true);
    expect(isReconstructableUserAgentStorageKey("lastSandboxTurnId")).toBe(true);
    expect(isReconstructableUserAgentStorageKey("lastSandboxTurnAt")).toBe(true);
    expect(isReconstructableUserAgentStorageKey("agent-chat:sandbox:result-keys")).toBe(true);
    expect(isReconstructableUserAgentStorageKey("agent-chat:sandbox:result:request-1")).toBe(true);
    expect(isReconstructableUserAgentStorageKey("owner-private-note")).toBe(false);

    const storage = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    mocks.dispatch.mockImplementation(async (_env, guardedStorage) => {
      await guardedStorage.put("owner-private-note", "must live in D1");
      return response("unreachable");
    });
    const agent = new Me3UserAgent(
      { storage } as unknown as DurableObjectState,
      {} as never,
      mocks.dispatch,
    );

    await expect(
      agent.fetch(
        new Request("https://agent.internal/dispatch/sandbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      ),
    ).rejects.toThrow("Durable Object storage key is not reconstructable from D1");
    expect(storage.put).not.toHaveBeenCalled();
  });
});

function state(): DurableObjectState {
  return { storage: {} } as DurableObjectState;
}

function request(signal?: AbortSignal): Request {
  return new Request("https://agent.internal/dispatch/sandbox/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ requestId: "request-1" }),
  });
}

function response(replyText: string) {
  return {
    ok: true,
    auditId: null,
    turnId: "turn-1",
    specialist: "core.agent-chat",
    replyText,
    model: "test-model",
    source: "workers-ai",
    performance: {
      version: 1,
      resultSource: "fresh",
      memoryCacheLookupMs: 1,
      databaseReplayLookupMs: 1,
      statePreparationMs: 1,
      ownerProfileMs: 1,
      toolPlanMs: 1,
      routeResolutionMs: 1,
      setupAndContextMs: 1,
      contextLoadMs: 1,
      imageInputMs: 1,
      executionMs: 1,
      messagePersistenceMs: 1,
      beforeResultPersistenceMs: 10,
    },
  };
}

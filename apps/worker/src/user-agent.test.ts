import { describe, expect, it, vi } from "vitest";

import { Me3UserAgent } from "./user-agent";

describe("ME3 user agent streaming", () => {
  it.each(["/dispatch/sandbox", "/dispatch/sandbox/stream"])("does not execute retired chat endpoint %s", async path => {
    const agent = new Me3UserAgent(state(), {} as never);
    const result = await agent.fetch(new Request(`https://agent.internal${path}`, { method: "POST", body: "{}" }));
    expect(result.status).toBe(404);
  });
  it("delivers a safe mailbox invalidation to every connected owner session", async () => {
    const agent = new Me3UserAgent(state(), {} as never);
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

  it("purges Durable Object storage only through the installation-bound internal hook", async () => {
    const storage = {
      deleteAll: vi.fn(async () => undefined),
      list: vi.fn(async () => new Map()),
    };
    const agent = new Me3UserAgent(
      { storage } as unknown as DurableObjectState,
      { ME3_MANAGED_INSTALLATION_ID: "mi-1234567890abcdef" } as never,
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

});

function state(): DurableObjectState {
  return { storage: {} } as DurableObjectState;
}

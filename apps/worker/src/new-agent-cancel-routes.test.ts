import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerNewAgentRoutes } from "./routes/new-agent";
import type { AppHono, OwnerRouteDeps } from "./http/types";

describe("owner request cancellation route", () => {
  function fixture(runtime = "agent") {
    const fetch = vi.fn(async (_url: string, _options: { body?: BodyInit | null }) => Response.json({ ok: true, cancellationRequested: true }, { status: 202 }));
    const prepare = vi.fn(() => { throw new Error("Stop must not require persisted input"); });
    const app = new Hono() as AppHono;
    registerNewAgentRoutes(app, { requireOwner: async () => "owner", unauthorized: () => Response.json({}, { status: 401 }) } as unknown as OwnerRouteDeps);
    const env = { ME3_ASSISTANT_RUNTIME: runtime, DB: { prepare }, ME3_AGENT: { idFromName: (owner: string) => owner, get: () => ({ fetch }) } };
    const stop = (body: unknown) => app.request("https://worker/api/assistant/chat/turn/abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);
    return { stop, fetch, prepare };
  }
  it("forwards the authenticated owner and request ID before any input lookup", async () => {
    const { stop, fetch, prepare } = fixture();
    expect((await stop({ requestId: "request", userId: "someone-else" })).status).toBe(202);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ userId: "owner", requestId: "request" }); expect(prepare).not.toHaveBeenCalled();
  });
  it("validates request identity before dispatch", async () => {
    const { stop, fetch } = fixture(); expect((await stop({ requestId: "" })).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves the SDK runtime's Stop no-op", async () => {
    const { stop, fetch, prepare } = fixture("sdk"); expect(await (await stop({ requestId: "request" })).json()).toEqual({ ok: true, cancelled: false }); expect(fetch).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
});

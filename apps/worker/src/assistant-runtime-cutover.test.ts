import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createD1TurnStore } from "../../../packages/agent/src/store";
import { dispatchAgentChannelTurn } from "./agent-channels";
import { registerAssistantRoutes } from "./routes/assistant";
import { registerMissionControlRoutes } from "./routes/mission-control";
import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import type { AppBindings } from "./http/types";
import type { Env } from "./types";

// Failure modes: obsolete/unset switches route to retired DOs; missing ME3_AGENT
// falls back; Stop silently succeeds; existing Home approvals disappear.
function fixture(obsolete?: string, bound = true) {
  const f = mailboxFixture();
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body));
    const payload = { ok: true, runtime: "agent", status: "complete", turnId: input.turnId, threadId: input.threadId, replyText: "Saved current runtime reply." };
    return url.endsWith("/stream")
      ? new Response(`id: 7\nevent: delta\ndata: {"text":"Saved current runtime reply.","source":"runtime"}\n\nid: 8\nevent: done\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { "Content-Type": "text/event-stream" } })
      : Response.json(payload);
  });
  const retired = vi.fn(async () => { throw new Error("Retired chat runtime must not be called"); });
  const namespace = (dispatch: typeof fetch) => ({ idFromName: (owner: string) => owner, get: () => ({ fetch: dispatch }) });
  const env = { ...f.env, ME3_DEPLOYMENT_MODE: "self_hosted", ...(obsolete === undefined ? {} : { ME3_ASSISTANT_RUNTIME: obsolete }),
    ME3_USER_AGENT: namespace(retired), ME3_SDK_USER_AGENT: namespace(retired), ...(bound ? { ME3_AGENT: namespace(fetch) } : {}) } as unknown as Env;
  const app = new Hono<AppBindings>();
  const deps = { requireOwner: async () => "alice", unauthorized: () => Response.json({}, { status: 401 }), getSessionOwnerId: async () => "alice", getSetupRequired: async () => [] };
  registerAssistantRoutes(app, deps);
  registerMissionControlRoutes(app, deps);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, env);
  return { ...f, app, env, fetch, retired, post };
}

describe("one current Worker chat runtime", () => {
  it("preserves the older message API shape while executing in the same primary conversation", async () => {
    const f = fixture();
    const response = await f.post("/api/assistant/chat", { message: "Read my saved reminders." });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, reply: "Saved current runtime reply.", setupRequired: [] });
    expect(f.fetch).toHaveBeenCalledOnce();
    const input = JSON.parse(String(f.fetch.mock.calls[0][1].body));
    expect(input.messageText).toBe("Read my saved reminders.");
    expect(f.raw.prepare("SELECT thread_id FROM assistant_primary_threads WHERE owner_id='alice'").get()?.thread_id).toBe(input.threadId);
    expect(f.raw.prepare("SELECT COUNT(*) n FROM assistant_messages WHERE thread_id IS NULL").get()?.n).toBe(0);
    const missing = fixture("sdk", false);
    expect((await missing.post("/api/assistant/chat", { message: "Read reminders." })).status).toBe(503);
    expect(missing.retired).not.toHaveBeenCalled();
  });
  it.each([undefined, "legacy", "sdk", "agent", "obsolete"])("routes HTTP and SSE through ME3_AGENT with obsolete switch %s", async obsolete => {
    const f = fixture(obsolete);
    const primary = await (await f.post("/api/assistant/threads/primary", {})).json() as { thread: { id: string } };
    for (const stream of [false, true]) {
      const response = await f.post(`/api/assistant/chat/turn${stream ? "/stream" : ""}`, { requestId: `request-${stream}`, threadId: primary.thread.id, messageText: "Read my saved reminders." }, { "Last-Event-ID": "6" });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Saved current runtime reply.");
      const [url, init] = f.fetch.mock.calls.at(-1)!;
      expect(url).toBe(`https://me3-agent/turn${stream ? "/stream" : ""}`);
      expect(JSON.parse(String(init.body))).toMatchObject({ userId: "alice", threadId: primary.thread.id });
      if (stream) { expect(new Headers(init.headers).get("Last-Event-ID")).toBe("6"); expect(init.signal).toBeUndefined(); }
    }
    expect(f.retired).not.toHaveBeenCalled();
  });

  it.each([false, true])("returns unavailable without a new binding, even with both retired bindings (%s stream)", async stream => {
    const f = fixture("legacy", false);
    const response = await f.post(`/api/assistant/chat/turn${stream ? "/stream" : ""}`, { requestId: "request", messageText: "Read my reminders." });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("runtime is unavailable");
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_turns").get()?.n).toBe(0);
  });

  it.each([undefined, "sdk", "legacy"])("Stop uses the authenticated current runtime independent of switch %s", async obsolete => {
    const f = fixture(obsolete);
    expect((await f.post("/api/assistant/chat/turn/abort", { requestId: "stop-request", userId: "bob" })).status).toBe(200);
    expect(f.fetch.mock.calls[0][0]).toBe("https://me3-agent/turn/cancel");
    expect(JSON.parse(String(f.fetch.mock.calls[0][1].body))).toEqual({ userId: "alice", requestId: "stop-request" });
    expect(f.retired).not.toHaveBeenCalled();
    const missing = fixture(obsolete, false);
    expect((await missing.post("/api/assistant/chat/turn/abort", { requestId: "stop-request" })).status).toBe(503);
    expect(missing.retired).not.toHaveBeenCalled();
  });

  it.each([undefined, "sdk", "legacy"])("Soulink uses ME3_AGENT and cannot fall back (%s)", async obsolete => {
    const f = fixture(obsolete);
    const input = { userId: "alice", connectionId: "connection", sourceEventId: "source", turnId: "turn", threadId: "primary", messageText: "Read reminders", replyToMessageId: null };
    expect((await dispatchAgentChannelTurn(f.env, input)).ok).toBe(true);
    expect(f.fetch.mock.calls[0][0]).toBe("https://me3-agent/turn");
    expect(JSON.parse(String(f.fetch.mock.calls[0][1].body))).toMatchObject({ userId: "alice", threadId: "primary", requestId: "source" });
    expect((await dispatchAgentChannelTurn(fixture(obsolete, false).env, input)).error).toContain("unavailable");
    expect(f.retired).not.toHaveBeenCalled();
  });

  it.each([undefined, "sdk"])("Home lists and approves the current durable card without a runtime switch (%s)", async obsolete => {
    const f = fixture(obsolete);
    const store = createD1TurnStore(f.env.DB, { ownerId: "alice", threadId: "thread", turnId: "original", requestId: "request" });
    const id = await store.requestApproval("send-key", { id: "call", name: "core_mailbox_send", arguments: { draftId: "draft" } }, { title: "Send reviewed email", summary: "Review the exact message", body: "Synthetic body" });
    const cards = await f.app.request("/api/mission-control/approvals?status=pending", {}, f.env);
    expect(cards.status).toBe(200);
    expect(await cards.json()).toMatchObject({ approvals: [expect.objectContaining({ id, payload: expect.objectContaining({ body: "Synthetic body" }) })] });
    expect((await f.post(`/api/mission-control/approvals/${id}`, { decision: "approved" })).status).toBe(200);
    expect(f.fetch.mock.calls.at(-1)![0]).toBe("https://me3-agent/turn/resume");
    expect(JSON.parse(String(f.fetch.mock.calls.at(-1)![1].body))).toEqual({ userId: "alice", turnId: "original" });
    expect((await f.post(`/api/mission-control/approvals/${id}`, { decision: "rejected" })).status).toBe(409);
    expect(await store.approvalDecision(id)).toBe("approved");
    expect(f.retired).not.toHaveBeenCalled();
  });
});

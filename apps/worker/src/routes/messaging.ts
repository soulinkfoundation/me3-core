import type { AppContext, AppHono } from "../http/types";
import { createMessagingSession, forwardSoulinkChatCall, isSoulinkChatCall, MESSAGING_CLIENTS, type MessagingClient } from "../soulink-messaging";
import { syncSoulinkContacts } from "./channels";

type MessagingRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

/** ME3 messaging for the owner's phones and web app, over the owner's Soulink connection. */
export function registerMessagingRoutes(app: AppHono, deps: MessagingRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  const session = async (c: AppContext, client: unknown) => {
    c.header("Cache-Control", "no-store");
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    if (!MESSAGING_CLIENTS.includes(client as MessagingClient)) {
      return c.json({ ok: false, code: "bad_request", error: "client must be ios, android or web" }, 400);
    }

    const result = await createMessagingSession(c.env, ownerId, c.req.url, client as MessagingClient);
    if (!result.ok) return c.json(result, result.status);
    if (result.connected) {
      // A new connection: bring Soulink contacts in, as setup does, without holding up the phone.
      waitUntil(c, syncSoulinkContacts(c.env, ownerId).catch((error) => {
        console.warn("Soulink contact sync after connect failed", error);
      }));
    }
    return c.json(result);
  };

  app.get("/api/messaging/session", (c) => session(c, c.req.query("client")));
  app.post("/api/messaging/session", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { client?: unknown } | null;
    return session(c, body?.client ?? c.req.query("client"));
  });

  // The web app's Soulink chat calls (requests, block, report, people, start a chat); see forwardSoulinkChatCall.
  app.all("/api/messaging/soulink/*", async (c) => {
    c.header("Cache-Control", "no-store");
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const url = new URL(c.req.url);
    const path = url.pathname.slice("/api/messaging/soulink".length);
    if (!isSoulinkChatCall(c.req.method, path)) return c.json({ ok: false, code: "not_found", error: "Not found" }, 404);
    const sessionToken = c.req.header("X-Soulink-Session")?.trim();
    if (!sessionToken) return c.json({ ok: false, code: "bad_request", error: "Missing Soulink session" }, 400);
    const body = c.req.method === "GET" || c.req.method === "DELETE" ? null : await c.req.text();
    const forwarded = await forwardSoulinkChatCall(c.env, {
      method: c.req.method, path, search: url.search, sessionToken, body: body === "" ? null : body,
    });
    forwarded.headers.set("Cache-Control", "no-store");
    return forwarded;
  });
}

function waitUntil(c: AppContext, promise: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No execution context (tests): let it run.
    void promise;
  }
}

import type { AppContext, AppHono } from "../http/types";
import { createMessagingSession, type MessagingClient } from "../soulink-messaging";
import { syncSoulinkContacts } from "./channels";

type MessagingRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

/** ME3 messaging for the owner's phone, over the owner's Soulink connection. */
export function registerMessagingRoutes(app: AppHono, deps: MessagingRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  const session = async (c: AppContext, client: unknown) => {
    c.header("Cache-Control", "no-store");
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    if (client !== "ios" && client !== "android") {
      return c.json({ ok: false, code: "bad_request", error: "client must be ios or android" }, 400);
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
}

function waitUntil(c: AppContext, promise: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No execution context (tests): let it run.
    void promise;
  }
}

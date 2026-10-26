import type { AppContext, AppHono } from "../http/types";

type BatchRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

const MAX_BATCH_REQUESTS = 25;
const BATCH_HEADER = "x-me3-batch";

/**
 * One request for many owner-app reads. The web client groups the GET calls a
 * page makes while it loads into a single POST, so a page pays for one Worker
 * round trip instead of twenty. Each entry runs through the normal router with
 * the caller's own cookies, so every handler still does its own auth.
 */
export function registerBatchRoutes(app: AppHono, deps: BatchRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.post("/api/batch", async (c) => {
    if (c.req.header(BATCH_HEADER)) return c.json({ error: "Nested batch requests are not allowed" }, 400);
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req.json().catch(() => null) as { requests?: unknown } | null;
    const requests = Array.isArray(body?.requests) ? body.requests : null;
    if (!requests || !requests.length) return c.json({ error: "requests must be a non-empty list" }, 400);
    if (requests.length > MAX_BATCH_REQUESTS) return c.json({ error: `At most ${MAX_BATCH_REQUESTS} requests per batch` }, 400);
    const paths: string[] = [];
    for (const entry of requests) {
      if (typeof entry !== "string" || !isBatchablePath(entry)) {
        return c.json({ error: "Each request must be an /api/ path" }, 400);
      }
      paths.push(entry);
    }

    const origin = new URL(c.req.url).origin;
    const headers = new Headers({ Accept: "application/json", [BATCH_HEADER]: "1" });
    for (const name of ["cookie", "authorization", "accept-language", "user-agent"]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    let executionCtx: Parameters<typeof app.fetch>[2];
    try { executionCtx = c.executionCtx as Parameters<typeof app.fetch>[2]; } catch { executionCtx = undefined; }

    const results = await Promise.all(paths.map(async (path) => {
      try {
        const response = await app.fetch(new Request(`${origin}${path}`, { method: "GET", headers }), c.env, executionCtx);
        const text = await response.text();
        let parsed: unknown;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text }; }
        return { status: response.status, body: parsed };
      } catch (error) {
        return { status: 500, body: { error: error instanceof Error ? error.message : "Request failed" } };
      }
    }));

    return c.json({ results }, 200, { "Cache-Control": "no-store" });
  });
}

export function isBatchablePath(path: string): boolean {
  if (!path.startsWith("/api/") || path.startsWith("/api/batch")) return false;
  if (path.length > 2048 || path.includes("://") || path.includes("\\") || /[\r\n]/.test(path)) return false;
  return !path.startsWith("//");
}

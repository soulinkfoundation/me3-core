import type { AppContext, AppHono } from "../http/types";

type ContactAvatarRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

const UPSTREAM_TIMEOUT_MS = 2_500;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const HIT_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
// A missing or unreachable avatar is remembered for ten minutes so a dead
// install is not asked again on every page.
const MISS_CACHE_CONTROL = "public, max-age=600";

/**
 * Contact avatars live on other people's installs. The browser used to fetch
 * them directly and could wait twenty seconds on an install that is down.
 * This route fetches them with a short timeout and keeps a copy at the edge.
 */
export function registerContactAvatarRoutes(app: AppHono, deps: ContactAvatarRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.get("/api/contacts/avatar", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const target = parseAvatarUrl(c.req.query("url"));
    if (!target) return c.json({ error: "url must be an https image address" }, 400);

    const cache = edgeCache();
    const cacheKey = new Request(`https://me3-contact-avatar.invalid/${encodeURIComponent(target.href)}`);
    const cached = await cache?.match(cacheKey);
    if (cached) return cached;

    const response = await fetchAvatar(target);
    try {
      const ctx = c.executionCtx;
      if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } catch {
      if (cache) await cache.put(cacheKey, response.clone()).catch(() => undefined);
    }
    return response;
  });
}

export function parseAvatarUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  return url;
}

async function fetchAvatar(target: URL): Promise<Response> {
  const miss = (status = 404) =>
    new Response(null, { status, headers: { "Cache-Control": MISS_CACHE_CONTROL } });
  try {
    const upstream = await fetch(target.href, {
      headers: { Accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const type = upstream.headers.get("content-type") || "";
    const length = Number(upstream.headers.get("content-length") || "0");
    if (!upstream.ok || !type.startsWith("image/") || length > MAX_AVATAR_BYTES) return miss();
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_AVATAR_BYTES) return miss();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": HIT_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return miss();
  }
}

function edgeCache(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } }).caches;
  return store?.default ?? null;
}

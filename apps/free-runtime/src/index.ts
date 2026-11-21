/**
 * ME3 free runtime (hosted only). One shared Worker; each free user gets a private Durable Object that
 * runs ME3 Core against its own SQLite database. ME3 Cloud stays the identity authority:
 *
 *   POST /internal/activate   ME3 Cloud only (service token). Creates or refreshes a user's ME3 and
 *                             returns its install id and base URL for the apps.
 *   /u/{userId}/...           The user's ME3, same API as an installation. The path picks the object;
 *                             the object's own per-database credentials decide whether the caller is its owner.
 */
import { Me3FreeUser, type FreeRuntimeEnv } from "./free-user";

export { Me3FreeUser };

const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

async function sameSecret(a: string, b: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function userObject(env: FreeRuntimeEnv, userId: string, request: Request): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("x-partykit-room", userId);
  return env.FREE_USER.get(env.FREE_USER.idFromName(userId)).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request: Request, env: FreeRuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "me3-free-runtime" });

    if (url.pathname === "/internal/activate" || url.pathname === "/internal/status") {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      if (!env.FREE_RUNTIME_SERVICE_TOKEN || !token || !(await sameSecret(token, env.FREE_RUNTIME_SERVICE_TOKEN))) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      if (url.pathname === "/internal/status") {
        const userId = url.searchParams.get("userId") ?? "";
        if (!USER_ID.test(userId)) return Response.json({ ok: false, error: "Invalid userId" }, { status: 400 });
        return userObject(env, userId, new Request(new URL("/__free/status", url), { headers: request.headers }));
      }
      if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
      const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
      const userId = typeof body?.userId === "string" ? body.userId : "";
      if (!USER_ID.test(userId)) return Response.json({ ok: false, error: "Invalid userId" }, { status: 400 });
      const response = await userObject(env, userId, new Request(new URL("/__free/activate", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      const result = (await response.json()) as Record<string, unknown>;
      return Response.json(response.ok ? { ...result, apiBaseURL: `${url.origin}/u/${userId}` } : result, { status: response.status });
    }

    const match = /^\/u\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match || !USER_ID.test(match[1])) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    const inner = new URL(url);
    inner.pathname = match[2] ?? "/";
    if (inner.pathname.startsWith("/__free/")) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    return userObject(env, match[1], new Request(inner, request));
  },
};

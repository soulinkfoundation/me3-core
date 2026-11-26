import { connectSoulink, getSoulinkConnection, getSoulinkConnectorConfig } from "./routes/channels";
import type { Env } from "./types";

/**
 * ME3 messaging: the owner's phone chats on Soulink as the owner's own Soulink
 * node. Core never holds Stream keys or message text; it trades the Soulink
 * connection's dispatch token for a short-lived Soulink session and Stream token
 * (Soulink POST /api/me3/chat-session) and hands those to the phone. Core stores
 * nothing beyond the existing connection, and never logs the tokens.
 */

export type MessagingClient = "ios" | "android" | "web";

export const MESSAGING_CLIENTS: readonly MessagingClient[] = ["ios", "android", "web"];

export type MessagingSession = {
  ok: true;
  soulinkApiOrigin: string;
  soulinkSessionToken: string;
  expiresAt: string;
  ownerNodeId: string;
  stream: { apiKey: string; userId: string; token: string };
  connected: boolean;
};

export type MessagingSessionError = {
  ok: false;
  status: 403 | 404 | 409 | 502 | 503;
  /** Stable code the phone can switch on; `error` is a sentence it can show. */
  code: "not_eligible" | "account_deleting" | "account_not_found" | "soulink_unavailable" | "soulink_error";
  error: string;
};

type ChatSessionResponse = {
  ok?: boolean;
  ownerNodeId?: unknown;
  session?: { token?: unknown; expiresAt?: unknown };
  stream?: { apiKey?: unknown; userId?: unknown; token?: unknown };
  error?: unknown;
};

const UNAVAILABLE = "Messaging could not reach Soulink. Please try again.";

export async function createMessagingSession(
  env: Env,
  ownerId: string,
  requestUrl: string,
  client: MessagingClient,
): Promise<MessagingSession | MessagingSessionError> {
  const apiOrigin = getSoulinkConnectorConfig(env).apiOrigin;
  let connected = false;
  let existing = await getSoulinkConnection(env, ownerId);
  let dispatchToken = existing?.status === "active" ? existing.setup_token : "";

  // First use: connect without asking the owner.
  if (!dispatchToken) {
    const result = await connect(env, ownerId, requestUrl);
    if (!result.ok) return result;
    dispatchToken = result.dispatchToken;
    connected = true;
  }

  let exchange = await exchangeDispatchToken(apiOrigin, dispatchToken, client);
  // Soulink no longer holds this connection (revoked there, or replaced by another
  // setup): connect again once and retry with the new token.
  if (exchange.kind === "unauthorized" && !connected) {
    const result = await connect(env, ownerId, requestUrl);
    if (!result.ok) return result;
    connected = true;
    exchange = await exchangeDispatchToken(apiOrigin, result.dispatchToken, client);
  }

  switch (exchange.kind) {
    case "ok":
      return { ...exchange.session, soulinkApiOrigin: apiOrigin, connected };
    case "unreachable":
      return { ok: false, status: 503, code: "soulink_unavailable", error: UNAVAILABLE };
    case "refused":
      if (exchange.status === 403) {
        return { ok: false, status: 403, code: "not_eligible", error: exchange.error || "Soulink messaging is not available for this account." };
      }
      if (exchange.status === 409) {
        return { ok: false, status: 409, code: "account_deleting", error: exchange.error || "This Soulink account is being deleted." };
      }
      if (exchange.status >= 500) {
        return { ok: false, status: 503, code: "soulink_unavailable", error: UNAVAILABLE };
      }
      return { ok: false, status: 502, code: "soulink_error", error: exchange.error || "Soulink did not start a chat session." };
    case "unauthorized":
      return { ok: false, status: 502, code: "soulink_error", error: "Soulink did not accept this ME3's connection." };
  }
}

async function connect(
  env: Env,
  ownerId: string,
  requestUrl: string,
): Promise<{ ok: true; dispatchToken: string } | MessagingSessionError> {
  const result = await connectSoulink(env, ownerId, requestUrl);
  if (result.ok) return { ok: true, dispatchToken: result.connection.setup_token };
  if (result.status === 404) return { ok: false, status: 404, code: "account_not_found", error: result.error };
  if (result.status === 503) return { ok: false, status: 503, code: "soulink_unavailable", error: UNAVAILABLE };
  return { ok: false, status: 502, code: "soulink_error", error: result.error };
}

type Exchange =
  | { kind: "ok"; session: Omit<MessagingSession, "soulinkApiOrigin" | "connected"> }
  | { kind: "unauthorized" }
  | { kind: "unreachable" }
  | { kind: "refused"; status: number; error: string | null };

async function exchangeDispatchToken(apiOrigin: string, dispatchToken: string, client: MessagingClient): Promise<Exchange> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/me3/chat-session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dispatchToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.warn("Soulink chat session request failed", error instanceof Error ? error.name : "unknown");
    return { kind: "unreachable" };
  }
  if (response.status === 401) return { kind: "unauthorized" };

  const body = (await response.json().catch(() => null)) as ChatSessionResponse | null;
  const token = body?.session?.token;
  const expiresAt = body?.session?.expiresAt;
  const stream = body?.stream;
  if (
    response.ok && body?.ok === true &&
    typeof body.ownerNodeId === "string" &&
    typeof token === "string" && token &&
    typeof expiresAt === "string" &&
    typeof stream?.apiKey === "string" && typeof stream.userId === "string" &&
    typeof stream.token === "string" && stream.token
  ) {
    return {
      kind: "ok",
      session: {
        ok: true,
        soulinkSessionToken: token,
        expiresAt,
        ownerNodeId: body.ownerNodeId,
        stream: { apiKey: stream.apiKey, userId: stream.userId, token: stream.token },
      },
    };
  }
  console.warn("Soulink refused a chat session", { status: response.status });
  return {
    kind: "refused",
    status: response.ok ? 502 : response.status,
    error: typeof body?.error === "string" ? body.error : null,
  };
}

/**
 * The Soulink chat calls the phones make directly with their Soulink session, which a browser can't (Soulink's API
 * only answers its own site). ME3's web app sends them here with that same session; Core checks the owner, forwards
 * only these, and keeps and logs nothing of them. Message text in a report passes straight through; contact matches
 * carry only email hashes.
 */
const SOULINK_CHAT_CALLS: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/api\/chat-requests\/[A-Za-z0-9!_-]+\/(accept|decline)$/ },
  { method: "POST", path: /^\/api\/nodes\/[A-Za-z0-9._-]+\/block$/ },
  { method: "DELETE", path: /^\/api\/nodes\/[A-Za-z0-9._-]+\/block$/ },
  { method: "GET", path: /^\/api\/nodes\/[A-Za-z0-9._-]+\/block\/status$/ },
  { method: "POST", path: /^\/api\/content-reports$/ },
  { method: "GET", path: /^\/api\/people$/ },
  { method: "POST", path: /^\/api\/stream\/chats$/ },
  { method: "POST", path: /^\/api\/contacts\/matches$/ },
];

export function isSoulinkChatCall(method: string, path: string): boolean {
  return SOULINK_CHAT_CALLS.some((call) => call.method === method && call.path.test(path));
}

export async function forwardSoulinkChatCall(
  env: Env,
  input: { method: string; path: string; search: string; sessionToken: string; body: string | null },
): Promise<Response> {
  const apiOrigin = getSoulinkConnectorConfig(env).apiOrigin;
  const headers: Record<string, string> = { Authorization: `Bearer ${input.sessionToken}` };
  if (input.body !== null) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}${input.path}${input.search}`, {
      method: input.method,
      headers,
      body: input.body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ ok: false, code: "soulink_unavailable", error: UNAVAILABLE }, { status: 503 });
  }
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
}

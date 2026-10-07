import type { AgentSandboxDispatchResponse } from "./agent-chat";
import type { DbAgentChannelConnection, DbAgentChannelEvent, Env } from "./types";

const AGENT_CHANNEL_DISPATCH_LEASE_MS = 130_000;

export type ProviderChannelEventInput = {
  channel: "sandbox" | "soulink";
  connectionId: string;
  direction: "inbound" | "outbound" | "system";
  eventType: "start" | "message" | "link" | "send" | "error";
  status: "received" | "pending" | "sent" | "failed" | "linked" | "skipped";
  providerEventId: string | null;
  providerMessageId: string | null;
  replyToMessageId: string | number | null;
  textBody: string | null;
  rawJson: unknown;
  errorMessage: string | null;
};

export async function getAgentChannelEventByProviderEventId(
  env: Env,
  connectionId: string,
  providerEventId: string,
) {
  return env.DB.prepare(
    `SELECT id, connection_id, channel, direction, event_type, status,
            provider_event_id, provider_message_id,
            telegram_message_id, reply_to_message_id, telegram_user_id,
            telegram_chat_id, telegram_username, text_body, raw_json,
            error_message, created_at, updated_at
     FROM agent_channel_events
     WHERE connection_id = ? AND provider_event_id = ?`,
  )
    .bind(connectionId, providerEventId)
    .first<DbAgentChannelEvent>();
}

export async function insertProviderChannelEventOnce(env: Env, input: ProviderChannelEventInput) {
  if (input.providerEventId) {
    const existing = await getAgentChannelEventByProviderEventId(
      env,
      input.connectionId,
      input.providerEventId,
    );
    if (existing) return existing.id;
  }

  return insertProviderChannelEvent(env, input);
}

export async function insertProviderChannelEvent(
  env: Env,
  input: ProviderChannelEventInput,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_channel_events
       (id, connection_id, channel, direction, event_type, status,
        provider_event_id, provider_message_id, reply_to_message_id,
        text_body, raw_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      id,
      input.connectionId,
      input.channel,
      input.direction,
      input.eventType,
      input.status,
      input.providerEventId,
      input.providerMessageId,
      input.replyToMessageId === null ? null : String(input.replyToMessageId),
      input.textBody,
      JSON.stringify(input.rawJson),
      input.errorMessage,
    )
    .run();
  return id;
}

export async function claimAgentChannelInboundEvent(
  env: Env,
  input: ProviderChannelEventInput & { providerEventId: string },
): Promise<{ id: string; created: boolean; event: DbAgentChannelEvent | null }> {
  const id = crypto.randomUUID();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_channel_events
       (id, connection_id, channel, direction, event_type, status,
        provider_event_id, provider_message_id, reply_to_message_id,
        text_body, raw_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      id,
      input.connectionId,
      input.channel,
      input.direction,
      input.eventType,
      input.status,
      input.providerEventId,
      input.providerMessageId,
      input.replyToMessageId === null ? null : String(input.replyToMessageId),
      input.textBody,
      JSON.stringify(input.rawJson),
      input.errorMessage,
    )
    .run();
  if (inserted.meta.changes) return { id, created: true, event: null };

  const existing = await getAgentChannelEventByProviderEventId(
    env,
    input.connectionId,
    input.providerEventId,
  );
  if (!existing) throw new Error("Agent channel event claim could not be resolved");
  return { id: existing.id, created: false, event: existing };
}

export function canRetryAgentChannelInboundEvent(
  event: Pick<DbAgentChannelEvent, "status" | "updated_at">,
  now = Date.now(),
): boolean {
  if (event.status === "failed") return true;
  if (event.status !== "pending") return false;
  const updatedAt = Date.parse(event.updated_at);
  return Number.isFinite(updatedAt) && now - updatedAt >= AGENT_CHANNEL_DISPATCH_LEASE_MS;
}

export async function updateAgentChannelInboundDispatchStatus(
  env: Env,
  eventId: string,
  status: "received" | "pending" | "failed",
  errorMessage: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE agent_channel_events
     SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND direction = 'inbound'`,
  )
    .bind(status, errorMessage, eventId)
    .run();
}

export async function updateAgentChannelInboundContent(
  env: Env,
  eventId: string,
  textBody: string,
  rawJson: unknown,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE agent_channel_events
     SET text_body = ?, raw_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND direction = 'inbound'`,
  )
    .bind(textBody, JSON.stringify(rawJson), eventId)
    .run();
}

export async function getAgentChannelDispatchReplay(
  env: Env,
  connectionId: string,
  sourceEventId: string,
): Promise<AgentSandboxDispatchResponse | null> {
  const reply = await getAgentChannelEventByProviderEventId(
    env,
    connectionId,
    `${sourceEventId}:reply`,
  );
  if (!reply?.raw_json) return null;
  try {
    const parsed = JSON.parse(reply.raw_json) as AgentSandboxDispatchResponse;
    return parsed?.ok === true && typeof parsed.replyText === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function acknowledgeAgentChannelDelivery(
  env: Env,
  input: {
    connectionId: string;
    sourceEventId: string;
    providerMessageId: string;
    status: "sent" | "failed";
    errorMessage: string | null;
  },
): Promise<{ ok: boolean; found: boolean; conflict: boolean; deduped: boolean }> {
  const reply = await getAgentChannelEventByProviderEventId(
    env,
    input.connectionId,
    `${input.sourceEventId}:reply`,
  );
  if (!reply) return { ok: false, found: false, conflict: false, deduped: false };
  if (reply.provider_message_id && reply.provider_message_id !== input.providerMessageId) {
    return { ok: false, found: true, conflict: true, deduped: false };
  }
  if (reply.status === input.status && reply.provider_message_id === input.providerMessageId) {
    return { ok: true, found: true, conflict: false, deduped: true };
  }

  const updated = await env.DB.prepare(
    `UPDATE agent_channel_events
     SET status = ?, provider_message_id = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND (provider_message_id IS NULL OR provider_message_id = ?)`,
  )
    .bind(
      input.status,
      input.providerMessageId,
      input.errorMessage,
      reply.id,
      input.providerMessageId,
    )
    .run();
  return {
    ok: Boolean(updated.meta.changes),
    found: true,
    conflict: !updated.meta.changes,
    deduped: false,
  };
}

export async function dispatchAgentChannelTurn(
  env: Env,
  input: {
    userId: string;
    connectionId: string;
    sourceEventId: string;
    turnId: string;
    threadId?: string | null;
    messageText: string;
    attachmentTextContext?: string | null;
    replyToMessageId: unknown;
  },
): Promise<AgentSandboxDispatchResponse> {
  const runtime = env.ME3_ASSISTANT_RUNTIME === "sdk" ? env.ME3_SDK_USER_AGENT : env.ME3_USER_AGENT;
  if (!runtime) {
    return {
      ok: false,
      auditId: null,
      turnId: input.turnId,
      specialist: "core.agent-chat",
      replyText: null,
      model: null,
      source: null,
      error: "Agent chat runtime is not configured",
    };
  }

  const id = runtime.idFromName(input.userId);
  const stub = runtime.get(id);
  let response: Response;
  try {
    response = await stub.fetch("https://me3-core-user-agent.internal/dispatch/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: input.userId,
        requestId: input.sourceEventId,
        connectionId: input.connectionId,
        sourceEventId: input.sourceEventId,
        turnId: input.turnId,
        threadId: input.threadId ?? null,
        messageText: input.messageText,
        attachmentTextContext: input.attachmentTextContext ?? null,
        replyToMessageId:
          typeof input.replyToMessageId === "string" ||
          typeof input.replyToMessageId === "number"
            ? input.replyToMessageId
            : null,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      auditId: null,
      turnId: input.turnId,
      specialist: "core.agent-chat",
      replyText: null,
      model: null,
      source: null,
      error: error instanceof Error && error.message
        ? error.message
        : "Agent chat runtime request failed",
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | AgentSandboxDispatchResponse
    | null;

  if (!response.ok || payload?.ok !== true) {
    return {
      ok: false,
      auditId: null,
      turnId: input.turnId,
      specialist: "core.agent-chat",
      replyText: null,
      model: null,
      source: null,
      error:
        typeof payload?.error === "string"
          ? payload.error
          : `Agent chat runtime request failed (${response.status})`,
    };
  }

  return payload;
}

export async function ensureAgentChannelAssistantThread(
  env: Env,
  input: {
    userId: string;
    threadId: string;
    messageText: string;
  },
): Promise<boolean> {
  const title = input.messageText.trim().replace(/\s+/g, " ").slice(0, 80) || "Soulink chat";
  await env.DB.prepare(
    `INSERT INTO assistant_threads
       (id, owner_id, title, origin_surface, status, last_message_at)
     VALUES (?, ?, ?, 'soulink', 'active', CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(input.threadId, input.userId, title)
    .run();
  const thread = await env.DB.prepare(
    `SELECT owner_id FROM assistant_threads
     WHERE id = ? AND owner_id = ? AND status != 'deleted'
     LIMIT 1`,
  )
    .bind(input.threadId, input.userId)
    .first<{ owner_id: string }>();
  return Boolean(thread);
}

export async function getActiveSoulinkConnectionForThread(env: Env, streamChannelId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_user_id, provider_thread_id,
            provider_username, provider_metadata_json,
            telegram_user_id, telegram_chat_id, telegram_username,
            telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at,
            updated_at
     FROM agent_channel_connections
     WHERE provider_thread_id = ? AND channel = 'soulink' AND status = 'active'`,
  )
    .bind(streamChannelId)
    .first<DbAgentChannelConnection>();
}

export function verifySoulinkDispatchAuth(
  connection: DbAgentChannelConnection,
  authorization: string | undefined,
) {
  const dispatchToken = connection.setup_token;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token || !constantTimeEqual(token, dispatchToken)) {
    return { ok: false, status: 401, error: "Invalid Soulink dispatch token" };
  }
  return { ok: true as const };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

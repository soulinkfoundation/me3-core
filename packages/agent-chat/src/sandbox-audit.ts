import { type CoreAgentChatEnv } from "./domain-store";
import { type AgentSandboxTurnRecord, type AgentSandboxConnection } from "./contracts";

export async function createAgentSandboxTurnRecord(
  env: Pick<CoreAgentChatEnv, "DB">,
  input: {
    userId: string;
    requestId: string;
    messageText: string;
    replyToMessageId?: string | number | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<AgentSandboxTurnRecord> {
  const messageText = input.messageText.trim();
  const replyToMessageId =
    typeof input.replyToMessageId === "string" ||
    typeof input.replyToMessageId === "number"
      ? input.replyToMessageId
      : null;
  const connection = await upsertSandboxConnection(env, input.userId);
  const stored = await recordAgentSandboxRequest(env.DB, {
    eventId: crypto.randomUUID(),
    connectionId: connection.id,
    requestId: input.requestId,
    turnId: crypto.randomUUID(),
    messageText,
    replyToMessageId,
    metadata: input.metadata,
  });

  return {
    connection,
    sourceEvent: { id: stored.eventId },
    requestId: input.requestId,
    turnId: stored.turnId,
    messageText,
    replyToMessageId,
  };
}

export async function upsertSandboxConnection(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<AgentSandboxConnection> {
  const existing = await env.DB.prepare(
    `SELECT id
     FROM agent_channel_connections
     WHERE user_id = ? AND channel = 'sandbox'
     LIMIT 1`,
  )
    .bind(ownerId)
    .first<AgentSandboxConnection>();

  if (existing?.id) {
    await env.DB.prepare(
      `UPDATE agent_channel_connections
       SET status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(existing.id)
      .run();
    return existing;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_channel_connections
       (id, user_id, channel, status, setup_token, connected_at, created_at, updated_at)
     VALUES (?, ?, 'sandbox', 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(id, ownerId, crypto.randomUUID())
    .run();

  return { id };
}

type TurnDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

type SandboxEventRow = {
  id: string;
  raw_json: string | null;
};

export async function recordAgentSandboxRequest(
  db: TurnDb,
  input: {
    connectionId: string;
    requestId: string;
    turnId: string;
    eventId: string;
    messageText: string;
    replyToMessageId: string | number | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<{ eventId: string; turnId: string }> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO agent_channel_events
         (id, connection_id, channel, direction, event_type, status,
          provider_event_id, reply_to_message_id, text_body, raw_json,
          created_at, updated_at)
       VALUES (?, ?, 'sandbox', 'inbound', 'message', 'received', ?,
          ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      input.eventId,
      input.connectionId,
      input.requestId,
      input.replyToMessageId === null ? null : String(input.replyToMessageId),
      input.messageText,
      JSON.stringify({
        runtime: "sandbox",
        requestId: input.requestId,
        turnId: input.turnId,
        ...(input.metadata || {}),
      }),
    )
    .run();

  const event = await db
    .prepare(
      `SELECT id, raw_json
       FROM agent_channel_events
       WHERE connection_id = ? AND provider_event_id = ?
       LIMIT 1`,
    )
    .bind(input.connectionId, input.requestId)
    .first<SandboxEventRow>();
  const turnId = sandboxEventTurnId(event?.raw_json);
  if (!event?.id || !turnId) throw new Error("Agent turn request could not be recorded.");
  return { eventId: event.id, turnId };
}

function sandboxEventTurnId(rawJson: string | null | undefined): string | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return typeof parsed.turnId === "string" && parsed.turnId
      ? parsed.turnId
      : null;
  } catch {
    return null;
  }
}

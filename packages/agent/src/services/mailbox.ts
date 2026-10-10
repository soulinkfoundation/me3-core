// Domain service extraction only; the legacy turn dispatcher is not imported.
import type { MailboxEnv, AgentMailboxDraftInput, AgentMailboxMessageListOptions, DbMailboxMessageRow } from "./mailbox-types";
import { agentMailboxMessageSelectSql, buildAgentMailboxMessageFilters, getAgentMailboxRow, getAgentMailboxMessageById, serializeAgentMailboxMessage, type AgentMailboxMessage } from "./mailbox-records";
import { clampNumber, normalizeNullableText } from "./mailbox-common";
import { normalizeAgentMailboxDraftInput, insertAgentMailboxDraft } from "./mailbox-drafts";
export type { AgentMailboxDraftInput, AgentMailboxMessageListOptions } from "./mailbox-types";
export type { AgentMailboxMessage } from "./mailbox-records";

export async function listAgentMailboxMessages(
  env: MailboxEnv,
  userId: string,
  options: AgentMailboxMessageListOptions,
): Promise<{ messages: AgentMailboxMessage[]; total: number; limit: number; offset: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  const limit = clampNumber(options.limit, 50, 0, 100);
  const offset = clampNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!mailbox) return { messages: [], total: 0, limit, offset };

  const { where, bindings } = buildAgentMailboxMessageFilters(mailbox.id, {
    status: normalizeNullableText(options.status) || "",
    createdBy: normalizeNullableText(options.createdBy) || "",
    direction: normalizeNullableText(options.direction) || "outbound",
    folder: normalizeNullableText(options.folder) || "",
    query: normalizeNullableText(options.query) || "",
    queryMode: options.queryMode,
    unread: normalizeNullableText(options.unread) || "",
  });

  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM mailbox_messages WHERE ${where}`)
    .bind(...bindings)
    .first<{ count: number | string | null }>();
  const total = Number(count?.count || 0);

  if (limit === 0) return { messages: [], total, limit, offset };

  const rows = await env.DB.prepare(
    `${agentMailboxMessageSelectSql()} WHERE ${where}
     ORDER BY COALESCE(sent_at, received_at, approved_at, created_at) DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, limit, offset)
    .all<DbMailboxMessageRow>();

  return {
    messages: (rows.results || []).map(serializeAgentMailboxMessage),
    total,
    limit,
    offset,
  };
}

export async function getAgentMailboxMessage(
  env: MailboxEnv,
  userId: string,
  messageId: string,
): Promise<{ message: AgentMailboxMessage } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const message = await getAgentMailboxMessageById(env, mailbox.id, messageId);
  if (!message) return { error: "Message not found", status: 404 };

  return { message: serializeAgentMailboxMessage(message) };
}

export async function createAgentMailboxDraft(
  env: MailboxEnv,
  userId: string,
  input: AgentMailboxDraftInput,
  options: { idempotencyKey?: string | null } = {},
): Promise<{ draft: AgentMailboxMessage } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const normalized = await normalizeAgentMailboxDraftInput(env, mailbox, input);
  if ("error" in normalized) return normalized;

  const draft = await insertAgentMailboxDraft(
    env,
    mailbox,
    normalized,
    normalizeNullableText(options.idempotencyKey),
  );
  return { draft: serializeAgentMailboxMessage(draft) };
}

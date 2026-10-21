import { type CoreAgentChatEnv, clampNumber, normalizeNullableText } from "./domain-store";
import { type AgentMailboxMessageListOptions, type AgentMailboxMessage, type DbMailboxMessageRow } from "./mailbox-types";
import { getAgentMailboxRow, agentMailboxMessageSelectSql, getAgentMailboxMessageById, normalizeFolder, getMailboxAttachmentMetadata, getMailboxRawStorageKey, mailboxFolderSet, mailboxFolderWhere } from "./mailbox-store";
import { serializeAgentMailboxMessage } from "./mailbox-format";

export async function listAgentMailboxMessages(
  env: Pick<CoreAgentChatEnv, "DB">,
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
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
): Promise<{ message: AgentMailboxMessage } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const message = await getAgentMailboxMessageById(env, mailbox.id, messageId);
  if (!message) return { error: "Message not found", status: 404 };

  return { message: serializeAgentMailboxMessage(message) };
}

export async function listAgentMailboxThreadMessages(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  threadId: string,
): Promise<{ messages: AgentMailboxMessage[] } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  let rows = await env.DB.prepare(
    `${agentMailboxMessageSelectSql()}
     WHERE mailbox_id = ? AND thread_key = ?
     ORDER BY COALESCE(sent_at, received_at, approved_at, created_at) ASC, id ASC`,
  )
    .bind(mailbox.id, threadId)
    .all<DbMailboxMessageRow>();
  if ((rows.results || []).length === 0) {
    rows = await env.DB.prepare(
      `${agentMailboxMessageSelectSql()}
       WHERE mailbox_id = ? AND id = ? AND (thread_key IS NULL OR thread_key = '')`,
    )
      .bind(mailbox.id, threadId)
      .all<DbMailboxMessageRow>();
  }
  const messages = (rows.results || []).map(serializeAgentMailboxMessage);
  return messages.length > 0 ? { messages } : { error: "Thread not found", status: 404 };
}

export async function setAgentMailboxMessageReadState(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
  read: boolean,
): Promise<{ ok: true } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET read_at = CASE WHEN ? THEN COALESCE(read_at, CURRENT_TIMESTAMP) ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(read, messageId, mailbox.id)
    .run();

  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };
  return { ok: true };
}

export async function moveAgentMailboxMessage(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
  folderInput: unknown,
): Promise<{ ok: true; id: string; folder: string } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const folder = normalizeFolder(folderInput);
  if (!folder) return { error: "Invalid folder", status: 400 };

  const set = mailboxFolderSet(folder);
  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET ${set.sql}, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(...set.bindings, messageId, mailbox.id)
    .run();

  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };
  return { ok: true, id: messageId, folder };
}

export async function trashAgentMailboxMessage(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET folder = 'trash', spam_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(messageId, mailbox.id)
    .run();

  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };
  return { ok: true };
}

export async function deleteAgentMailboxMessage(
  env: Pick<CoreAgentChatEnv, "DB" | "SITE_ASSETS">,
  userId: string,
  messageId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const message = await getAgentMailboxMessageById(env, mailbox.id, messageId);
  if (!message) return { error: "Message not found", status: 404 };

  const result = await env.DB.prepare(
    "DELETE FROM mailbox_messages WHERE id = ? AND mailbox_id = ?",
  )
    .bind(messageId, mailbox.id)
    .run();
  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };

  if (env.SITE_ASSETS) {
    const storageKeys = [
      ...getMailboxAttachmentMetadata(message).map((attachment) => attachment.storageKey || ""),
      getMailboxRawStorageKey(message),
    ].filter((key) => key.startsWith(`mailbox/${mailbox.id}/`));
    const unreferenced: string[] = [];
    for (const storageKey of new Set(storageKeys)) {
      const reference = await env.DB.prepare(
        `SELECT id FROM mailbox_messages
         WHERE mailbox_id = ? AND instr(COALESCE(metadata_json, ''), ?) > 0
         LIMIT 1`,
      )
        .bind(mailbox.id, storageKey)
        .first<{ id: string }>();
      if (!reference) unreferenced.push(storageKey);
    }
    if (unreferenced.length > 0) {
      await env.SITE_ASSETS.delete(unreferenced).catch(() => undefined);
    }
  }

  return { ok: true };
}

export function buildAgentMailboxMessageFilters(
  mailboxId: string,
  options: {
    status: string;
    createdBy: string;
    direction: string;
    folder: string;
    query: string;
    queryMode?: "phrase" | "terms";
    unread: string;
  },
) {
  const conditions = ["mailbox_id = ?"];
  const bindings: (string | number)[] = [mailboxId];
  const folder = normalizeFolder(options.folder);
  if (folder) {
    const where = mailboxFolderWhere(folder);
    conditions.push(where.sql);
    bindings.push(...where.bindings);
  }
  if (options.status) {
    const statuses = options.status.split(",").map((status) => status.trim()).filter(Boolean);
    if (statuses.length === 1) {
      conditions.push("status = ?");
      bindings.push(statuses[0]);
    } else if (statuses.length > 1) {
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      bindings.push(...statuses);
    }
  }
  if (options.createdBy) {
    conditions.push("created_by = ?");
    bindings.push(options.createdBy);
  }
  if (options.direction && options.direction !== "all") {
    conditions.push("direction = ?");
    bindings.push(options.direction);
  }
  if (["1", "true", "yes"].includes(options.unread.toLowerCase())) {
    conditions.push("direction = 'inbound'");
    conditions.push("read_at IS NULL");
  }
  if (options.query.trim()) {
    const query = options.query.trim().toLowerCase();
    const terms = options.queryMode === "terms" ? [...new Set(query.split(/\s+/))] : [query];
    for (const term of terms) {
      conditions.push(
        `(LOWER(COALESCE(subject, '')) LIKE ? OR LOWER(COALESCE(text_body, '')) LIKE ? OR LOWER(COALESCE(from_address, '')) LIKE ? OR LOWER(COALESCE(to_address, '')) LIKE ?)`,
      );
      const like = `%${term}%`;
      bindings.push(like, like, like, like);
    }
  }

  return { where: conditions.join(" AND "), bindings };
}

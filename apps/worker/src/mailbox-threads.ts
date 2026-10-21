import {
  MAILBOX_FOLDERS,
  listAgentMailboxThreadMessages,
  mailboxFolderSet,
  mailboxFolderWhere,
  type AgentMailboxMessage,
} from "@me3-core/plugin-agent-chat";
import type { Env } from "./types";
import { decodeMimeHeaderValue } from "../../../shared/email-headers";

const DEFAULT_THREAD_LIMIT = 50;
const MAX_THREAD_LIMIT = 100;

export type MailboxThreadSummary = {
  id: string;
  subject: string;
  participants: string[];
  latestSnippet: string;
  latestMessageId: string;
  messageCount: number;
  unreadCount: number;
  attachmentCount: number;
  lastActivity: string;
};

export type MailboxThreadList = {
  threads: MailboxThreadSummary[];
  nextCursor: string | null;
};

export type MailboxThreadListOptions = {
  folder?: unknown;
  query?: unknown;
  limit?: unknown;
  cursor?: unknown;
};

type MailboxServiceError = { error: string; status: number };

type MailboxThreadSummaryRow = {
  thread_id: string;
  subject: string | null;
  participants_json: string | null;
  latest_snippet: string | null;
  latest_message_id: string;
  message_count: number | string;
  unread_count: number | string;
  attachment_count: number | string;
  last_activity: string;
};

type MailboxCursor = { lastActivity: string; id: string };

export function resolveMailboxThreadKey(
  headers: Record<string, string>,
  fallbackMessageId: string,
): string {
  for (const value of [headers.references, headers["in-reply-to"]]) {
    const header = value?.trim();
    if (!header) continue;
    const rootMessageId = header.match(/<[^<>]+>/)?.[0] || header.split(/\s+/)[0];
    if (rootMessageId) return rootMessageId;
  }
  return fallbackMessageId;
}

export async function listMailboxThreads(
  env: Pick<Env, "DB">,
  ownerId: string,
  options: MailboxThreadListOptions = {},
): Promise<MailboxThreadList | MailboxServiceError> {
  const folder = normalizeFolder(options.folder);
  if (folder === undefined) return { error: "Invalid folder", status: 400 };

  const cursor = decodeCursor(options.cursor);
  if (options.cursor && !cursor) return { error: "Invalid cursor", status: 400 };

  const limit = normalizeLimit(options.limit);
  const query = typeof options.query === "string" ? options.query.trim().slice(0, 200) : "";
  const matchingConditions = ["a.user_id = ?"];
  const bindings: (string | number)[] = [ownerId];

  if (folder) {
    const where = mailboxFolderWhere(folder, "m.");
    matchingConditions.push(where.sql);
    bindings.push(...where.bindings);
  }
  if (query) {
    matchingConditions.push(
      `(LOWER(COALESCE(m.subject, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(m.text_body, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(m.from_address, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(m.to_address, '')) LIKE ? ESCAPE '\\')`,
    );
    const like = `%${escapeLike(query.toLowerCase())}%`;
    bindings.push(like, like, like, like);
  }

  const cursorWhere = cursor
    ? "WHERE (s.last_activity < ? OR (s.last_activity = ? AND s.thread_id < ?))"
    : "";
  if (cursor) bindings.push(cursor.lastActivity, cursor.lastActivity, cursor.id);
  bindings.push(limit + 1);
  const canonicalThreadKey = mailboxCanonicalThreadKeySql("m");

  const rows = await env.DB.prepare(
    `WITH matching_threads AS (
       SELECT DISTINCT m.mailbox_id, ${canonicalThreadKey} AS thread_id
       FROM mailbox_messages m
       JOIN mailbox_aliases a ON a.id = m.mailbox_id
       WHERE ${matchingConditions.join(" AND ")}
     ),
     ranked AS (
       SELECT m.id, mt.thread_id, m.direction, m.from_address, m.to_address,
              m.subject,
              SUBSTR(COALESCE(NULLIF(m.agent_summary, ''), m.text_body, ''), 1, 500) AS latest_snippet,
              m.metadata_json, m.read_at,
              COALESCE(
                strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(m.sent_at, m.received_at, m.approved_at, m.created_at)),
                COALESCE(m.sent_at, m.received_at, m.approved_at, m.created_at)
              ) AS activity_at,
              ROW_NUMBER() OVER (
                PARTITION BY mt.thread_id
                ORDER BY COALESCE(m.sent_at, m.received_at, m.approved_at, m.created_at) DESC, m.id DESC
              ) AS position
       FROM mailbox_messages m
       JOIN matching_threads mt
         ON mt.mailbox_id = m.mailbox_id
        AND mt.thread_id = ${canonicalThreadKey}
     ),
     participants AS (
       SELECT thread_id, TRIM(from_address) AS address
       FROM ranked
       WHERE TRIM(COALESCE(from_address, '')) != ''
       UNION
       SELECT thread_id, TRIM(to_address) AS address
       FROM ranked
       WHERE TRIM(COALESCE(to_address, '')) != ''
     ),
     summaries AS (
       SELECT thread_id,
              MAX(CASE WHEN position = 1 THEN id END) AS latest_message_id,
              MAX(CASE WHEN position = 1 THEN subject END) AS subject,
              MAX(CASE WHEN position = 1 THEN latest_snippet END) AS latest_snippet,
              COUNT(*) AS message_count,
              SUM(CASE WHEN direction = 'inbound' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_count,
              SUM(
                CASE
                  WHEN metadata_json IS NOT NULL AND json_valid(metadata_json)
                    THEN COALESCE(json_array_length(metadata_json, '$.attachments'), 0)
                  ELSE 0
                END
              ) AS attachment_count,
              MAX(activity_at) AS last_activity
       FROM ranked
       GROUP BY thread_id
     )
     SELECT s.thread_id, s.subject, s.latest_snippet, s.latest_message_id,
            s.message_count, s.unread_count, s.attachment_count, s.last_activity,
            COALESCE(
              (
                SELECT json_group_array(address)
                FROM (
                  SELECT p.address
                  FROM participants p
                  WHERE p.thread_id = s.thread_id
                  ORDER BY LOWER(p.address), p.address
                )
              ),
              '[]'
            ) AS participants_json
     FROM summaries s
     ${cursorWhere}
     ORDER BY s.last_activity DESC, s.thread_id DESC
     LIMIT ?`,
  )
    .bind(...bindings)
    .all<MailboxThreadSummaryRow>();

  const summaries = (rows.results || []).map(serializeSummaryRow);
  const hasMore = summaries.length > limit;
  const threads = hasMore ? summaries.slice(0, limit) : summaries;
  const last = threads.at(-1);
  return {
    threads,
    nextCursor: hasMore && last ? encodeCursor(last.lastActivity, last.id) : null,
  };
}

export async function listMailboxThreadMessages(
  env: Pick<Env, "DB">,
  ownerId: string,
  threadId: string,
): Promise<{ messages: AgentMailboxMessage[] } | MailboxServiceError> {
  const storedThreads = await env.DB.prepare(
    `SELECT DISTINCT COALESCE(NULLIF(m.thread_key, ''), m.id) AS stored_thread_id
     FROM mailbox_messages m
     JOIN mailbox_aliases a ON a.id = m.mailbox_id
     WHERE a.user_id = ?
       AND ${mailboxCanonicalThreadKeySql("m")} = ?`,
  )
    .bind(ownerId, threadId)
    .all<{ stored_thread_id: string }>();

  const keys = (storedThreads.results || []).map((row) => row.stored_thread_id);
  if (keys.length === 0) return { error: "Thread not found", status: 404 };

  const batches = await Promise.all(
    keys.map((key) => listAgentMailboxThreadMessages(env, ownerId, key)),
  );
  const messages = new Map<string, AgentMailboxMessage>();
  for (const batch of batches) {
    if ("error" in batch) continue;
    for (const message of batch.messages) messages.set(message.id, message);
  }
  const ordered = [...messages.values()].sort(
    (left, right) =>
      messageActivityTime(left) - messageActivityTime(right) || left.id.localeCompare(right.id),
  );
  return ordered.length > 0
    ? { messages: ordered }
    : { error: "Thread not found", status: 404 };
}

export function summarizeMailboxThread(
  threadId: string,
  messages: readonly AgentMailboxMessage[],
): MailboxThreadSummary {
  const latest = messages.reduce((current, message) =>
    messageActivityTime(message) > messageActivityTime(current) ? message : current,
  );
  const participants = new Map<string, string>();
  for (const address of messages.flatMap((message) => [message.fromAddress, message.toAddress])) {
    const value = address?.trim();
    if (value) participants.set(value.toLowerCase(), value);
  }

  return {
    id: threadId,
    subject: latest.subject || "(no subject)",
    participants: [...participants.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    ),
    latestSnippet: compactSnippet(latest.preview || latest.body || ""),
    latestMessageId: latest.id,
    messageCount: messages.length,
    unreadCount: messages.filter((message) => message.unread).length,
    attachmentCount: messages.reduce((total, message) => total + attachmentCount(message), 0),
    lastActivity: normalizeActivity(messageActivity(latest)),
  };
}

export async function setMailboxThreadReadState(
  env: Pick<Env, "DB">,
  ownerId: string,
  threadId: string,
  read: boolean,
): Promise<{ ok: true; id: string; read: boolean } | MailboxServiceError> {
  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET read_at = CASE WHEN ? THEN COALESCE(read_at, CURRENT_TIMESTAMP) ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE mailbox_id IN (SELECT id FROM mailbox_aliases WHERE user_id = ?)
       AND ${mailboxCanonicalThreadKeySql("mailbox_messages")} = ?`,
  )
    .bind(read, ownerId, threadId)
    .run();
  if ((result.meta?.changes || 0) === 0) return { error: "Thread not found", status: 404 };
  return { ok: true, id: threadId, read };
}

export async function moveMailboxThread(
  env: Pick<Env, "DB">,
  ownerId: string,
  threadId: string,
  folderInput: unknown,
  fromFolderInput: unknown,
): Promise<
  { ok: true; id: string; folder: string; fromFolder: string } | MailboxServiceError
> {
  const folder = normalizeFolder(folderInput);
  if (!folder) return { error: "Invalid folder", status: 400 };
  const fromFolder = normalizeFolder(fromFolderInput);
  if (!fromFolder) return { error: "Invalid source folder", status: 400 };

  const set = mailboxFolderSet(folder);
  const from = mailboxFolderWhere(fromFolder);
  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET ${set.sql}, updated_at = CURRENT_TIMESTAMP
     WHERE mailbox_id IN (SELECT id FROM mailbox_aliases WHERE user_id = ?)
       AND ${mailboxCanonicalThreadKeySql("mailbox_messages")} = ?
       AND ${from.sql}
       AND message_kind != 'draft'`,
  )
    .bind(...set.bindings, ownerId, threadId, ...from.bindings)
    .run();
  if ((result.meta?.changes || 0) === 0) return { error: "Thread not found", status: 404 };
  return { ok: true, id: threadId, folder, fromFolder };
}

function serializeSummaryRow(row: MailboxThreadSummaryRow): MailboxThreadSummary {
  return {
    id: row.thread_id,
    subject: decodeMimeHeaderValue(row.subject || "(no subject)"),
    participants: parseParticipants(row.participants_json),
    latestSnippet: compactSnippet(row.latest_snippet || ""),
    latestMessageId: row.latest_message_id,
    messageCount: Number(row.message_count || 0),
    unreadCount: Number(row.unread_count || 0),
    attachmentCount: Number(row.attachment_count || 0),
    lastActivity: normalizeActivity(row.last_activity),
  };
}

function parseParticipants(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const participants = new Map<string, string>();
    for (const item of parsed) {
      if (typeof item !== "string" || !item.trim()) continue;
      participants.set(item.trim().toLowerCase(), item.trim());
    }
    return [...participants.values()];
  } catch {
    return [];
  }
}

function attachmentCount(message: AgentMailboxMessage): number {
  if (Array.isArray(message.metadata.attachments)) return message.metadata.attachments.length;
  const count = Number(message.metadata.attachmentCount);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function messageActivity(message: AgentMailboxMessage): string {
  return message.sentAt || message.receivedAt || message.approvedAt || message.createdAt;
}

function messageActivityTime(message: AgentMailboxMessage): number {
  const parsed = Date.parse(messageActivity(message));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeActivity(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function compactSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function mailboxCanonicalThreadKeySql(alias: string): string {
  const metadata = `${alias}.metadata_json`;
  const headers = `${alias}.raw_headers_json`;
  const replyReference = `COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(${metadata}) THEN json_extract(${metadata}, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(${headers}) THEN COALESCE(json_extract(${headers}, '$.references'), json_extract(${headers}, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(${metadata}) THEN json_extract(${metadata}, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(${headers}) THEN COALESCE(json_extract(${headers}, '$."in-reply-to"'), json_extract(${headers}, '$."In-Reply-To"')) END), '')
  )`;
  const ownMessageId = `CASE
    WHEN ${alias}.direction = 'outbound' AND json_valid(${metadata})
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(${alias}.provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(${alias}.provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(${alias}.provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(${metadata}, '$.outbound_headers.message_id')), '')
      )
    WHEN ${alias}.direction = 'inbound' AND json_valid(${headers})
      THEN NULLIF(TRIM(COALESCE(json_extract(${headers}, '$."message-id"'), json_extract(${headers}, '$."Message-ID"'), json_extract(${headers}, '$.messageId'))), '')
  END`;
  const source = `TRIM(COALESCE(${replyReference}, ${ownMessageId}, NULLIF(${alias}.thread_key, ''), ${alias}.id))`;
  return `CASE
    WHEN INSTR(${source}, '<') > 0
      AND INSTR(SUBSTR(${source}, INSTR(${source}, '<')), '>') > 0
      THEN SUBSTR(
        ${source},
        INSTR(${source}, '<'),
        INSTR(SUBSTR(${source}, INSTR(${source}, '<')), '>')
      )
    ELSE ${source}
  END`;
}

function normalizeFolder(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const folder = value.trim().toLowerCase();
  if (!folder || folder === "all") return null;
  return MAILBOX_FOLDERS.has(folder) ? folder : undefined;
}

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_THREAD_LIMIT, Math.floor(parsed)))
    : DEFAULT_THREAD_LIMIT;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function encodeCursor(lastActivity: string, id: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ lastActivity, id }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: unknown): MailboxCursor | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MailboxCursor>;
    return typeof parsed.lastActivity === "string" && typeof parsed.id === "string"
      ? { lastActivity: parsed.lastActivity, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

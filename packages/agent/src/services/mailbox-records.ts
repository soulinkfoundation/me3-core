import { decodeMimeHeaderValue, parseEmailAddressHeader } from "../../../../shared/email-headers";
import type { MailboxEnv, DbMailboxAliasRow, DbMailboxMessageRow, MailboxUnsubscribeAction } from "./mailbox-types";
import { MAILBOX_FOLDERS, parseJsonRecord, parseJsonArray, stripAgentDraftWrapperText } from "./mailbox-common";

export async function getAgentMailboxRow(
  env: MailboxEnv,
  userId: string,
): Promise<DbMailboxAliasRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, alias_local_part, forwarding_email, forwarding_status,
            forwarding_enabled, forwarding_mode, status, approval_policy,
            daily_inbound_limit, daily_outbound_limit, activated_at,
            cf_destination_id, cf_destination_verified_at, cf_rule_id,
            cf_last_synced_at, cf_last_error, created_at, updated_at
     FROM mailbox_aliases
     WHERE user_id = ?`,
  )
    .bind(userId)
    .first<DbMailboxAliasRow>();
}

export function agentMailboxMessageSelectSql(): string {
  return `SELECT id, direction, message_kind, status, thread_key, from_address,
                 provider_id, provider_message_id, to_address, subject, text_body,
                 html_body, raw_headers_json, metadata_json,
                 agent_idempotency_key, source_id, folder, read_at,
                 agent_summary, agent_labels_json, forwarded_to, error_message,
                 created_by, approved_by_user_id, received_at, approved_at,
                 sent_at, created_at, updated_at
          FROM mailbox_messages`;
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
    conditions.push("folder = ?");
    bindings.push(folder);
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

export function normalizeFolder(value: unknown): string | null {
  const folder = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MAILBOX_FOLDERS.has(folder) ? folder : null;
}

export function serializeAgentMailboxMessage(row: DbMailboxMessageRow) {
  const metadata = parseJsonRecord(row.metadata_json);
  const headers = parseJsonRecord(row.raw_headers_json);
  const fromHeader = parseEmailAddressHeader(getHeaderValue(headers, "from"));
  const agentLabels = parseJsonArray(row.agent_labels_json);
  const unsubscribeAction = getMailboxUnsubscribeAction(row);
  const body = getSerializedAgentMailboxMessageBody(row);
  return {
    id: row.id,
    direction: row.direction,
    kind: row.message_kind,
    status: row.status,
    threadKey: row.thread_key,
    providerId: row.provider_id,
    providerMessageId: row.provider_message_id,
    fromAddress: fromHeader?.address || row.from_address,
    fromName: fromHeader?.name || null,
    toAddress: row.to_address,
    subject: decodeMimeHeaderValue(row.subject || "(no subject)"),
    body,
    htmlBody: row.html_body || null,
    preview: body.slice(0, 280),
    metadata,
    unsubscribeAction,
    sourceId: row.source_id,
    folder: row.folder,
    readAt: row.read_at,
    unread: row.direction === "inbound" && !row.read_at,
    agentSummary: row.agent_summary,
    agentLabels,
    forwardedTo: row.forwarded_to,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    approvedByUserId: row.approved_by_user_id,
    receivedAt: row.received_at,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSerializedAgentMailboxMessageBody(row: DbMailboxMessageRow): string {
  const body = row.text_body || "";
  if (
    row.message_kind === "draft" &&
    row.status === "pending_approval" &&
    row.created_by === "agent"
  ) {
    return stripAgentDraftWrapperText(body);
  }
  return body;
}

export function getMailboxUnsubscribeAction(
  row: DbMailboxMessageRow,
): MailboxUnsubscribeAction | null {
  if (row.direction !== "inbound" || row.message_kind !== "email") return null;
  const headers = parseJsonRecord(row.raw_headers_json);
  const listUnsubscribe = getHeaderValue(headers, "list-unsubscribe");
  if (!listUnsubscribe) return null;

  const urls = parseListUnsubscribeUrls(listUnsubscribe);
  const oneClick =
    getHeaderValue(headers, "list-unsubscribe-post")?.trim().toLowerCase() ===
    "list-unsubscribe=one-click";
  if (oneClick && urls.some((url) => isHttpsUrl(url))) {
    return { available: true, mode: "one_click" };
  }
  if (urls.some((url) => isHttpsUrl(url))) {
    return { available: true, mode: "link" };
  }
  if (urls.some((url) => url.trim().toLowerCase().startsWith("mailto:"))) {
    return { available: true, mode: "mailto" };
  }
  return null;
}

export function getHeaderValue(headers: Record<string, unknown>, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === "string") {
      return value;
    }
  }
  return null;
}

export function parseListUnsubscribeUrls(value: string): string[] {
  const bracketed = [...value.matchAll(/<([^>]+)>/g)]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);
  if (bracketed.length > 0) return bracketed;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function getAgentMailboxMessageById(
  env: MailboxEnv,
  mailboxId: string,
  messageId: string,
): Promise<DbMailboxMessageRow | null> {
  return (
    (await env.DB.prepare(`${agentMailboxMessageSelectSql()} WHERE id = ? AND mailbox_id = ?`)
      .bind(messageId, mailboxId)
      .first<DbMailboxMessageRow>()) || null
  );
}

export type AgentMailboxMessage = ReturnType<typeof serializeAgentMailboxMessage>;

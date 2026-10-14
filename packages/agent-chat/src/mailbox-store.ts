import { type CoreAgentChatEnv, normalizeNullableText, parseJsonRecord, isPlainObject } from "./domain-store";
import { type DbMailboxAliasRow, type DbMailboxMessageRow, type AgentMailboxAttachmentMetadata } from "./mailbox-types";

export async function getAgentMailboxRow(
  env: Pick<CoreAgentChatEnv, "DB">,
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

export function isValidEmail(value: string): boolean {
  const atIndex = value.indexOf("@");
  if (
    atIndex <= 0 ||
    atIndex !== value.lastIndexOf("@") ||
    atIndex >= value.length - 1
  ) {
    return false;
  }
  const dotIndex = value.indexOf(".", atIndex + 1);
  if (dotIndex <= atIndex + 1 || dotIndex >= value.length - 1) return false;
  for (const character of value) {
    if (
      character === " " ||
      character === "\n" ||
      character === "\r" ||
      character === "\t"
    ) {
      return false;
    }
  }
  return true;
}

export function normalizeEmailText(value: unknown): string | null {
  return normalizeNullableText(value)?.toLowerCase() || null;
}

export function getAgentMailboxInternalAddress(localPart: string): string {
  return `${localPart}@me3.local`;
}

export function agentMailboxMessageSelectSql(): string {
  return `SELECT id, direction, message_kind, status, thread_key, from_address,
                 provider_id, provider_message_id, to_address, subject, text_body,
                 html_body, raw_headers_json, metadata_json,
                 agent_idempotency_key, source_id, folder, read_at,
                 agent_summary, agent_labels_json, forwarded_to, error_message,
                 created_by, approved_by_user_id, received_at, approved_at,
                 sent_at, created_at
          FROM mailbox_messages`;
}

export async function getAgentMailboxMessageById(
  env: Pick<CoreAgentChatEnv, "DB">,
  mailboxId: string,
  messageId: string,
): Promise<DbMailboxMessageRow | null> {
  return (
    (await env.DB.prepare(`${agentMailboxMessageSelectSql()} WHERE id = ? AND mailbox_id = ?`)
      .bind(messageId, mailboxId)
      .first<DbMailboxMessageRow>()) || null
  );
}

export function getMailboxAttachmentMetadata(row: DbMailboxMessageRow): AgentMailboxAttachmentMetadata[] {
  const metadata = parseJsonRecord(row.metadata_json);
  const rawAttachments = Array.isArray(metadata.attachments)
    ? metadata.attachments
    : [];
  return rawAttachments
    .filter(isPlainObject)
    .map((attachment) => ({
      filename: normalizeNullableText(attachment.filename),
      mimeType: normalizeNullableText(attachment.mimeType),
      disposition: normalizeNullableText(attachment.disposition),
      size:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? attachment.size
          : null,
      storageKey: normalizeNullableText(attachment.storageKey),
      sourceMessageId: normalizeNullableText(attachment.sourceMessageId),
    }))
    .filter((attachment) => Boolean(attachment.storageKey));
}

export function normalizeFolder(value: unknown): string | null {
  const folder = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MAILBOX_FOLDERS.has(folder) ? folder : null;
}

export const MAILBOX_FOLDERS = new Set(["inbox", "drafts", "sent", "archive", "trash"]);

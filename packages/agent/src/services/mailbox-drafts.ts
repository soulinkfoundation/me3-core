import type { MailboxEnv, DbMailboxAliasRow, DbMailboxMessageRow, AgentMailboxDraftInput, NormalizedMailboxDraftInput, AgentMailboxAttachmentMetadata } from "./mailbox-types";
import { agentMailboxMessageSelectSql, getAgentMailboxMessageById } from "./mailbox-records";
import { normalizeNullableText, normalizeEmailText, isValidEmail, getAgentMailboxInternalAddress, stripAgentDraftWrapperText, isPlainObject, parseJsonRecord } from "./mailbox-common";

export async function normalizeAgentMailboxDraftInput(
  env: MailboxEnv,
  mailbox: DbMailboxAliasRow,
  body: AgentMailboxDraftInput,
  existing?: DbMailboxMessageRow,
): Promise<NormalizedMailboxDraftInput | { error: string; status: number }> {
  const fromAddress =
    normalizeEmailText(body.fromAddress) ||
    existing?.from_address ||
    getAgentMailboxInternalAddress(mailbox.alias_local_part);
  const rawToAddress = body.toAddress === undefined ? body.to : body.toAddress;
  const toAddress =
    rawToAddress === undefined
      ? existing?.to_address || ""
      : normalizeEmailText(rawToAddress) || "";
  if (!isValidEmail(fromAddress)) {
    return { error: "Draft sender is invalid", status: 400 };
  }

  const replyToMessageId = normalizeNullableText(body.replyToMessageId);
  const replyTo = replyToMessageId
    ? await getAgentMailboxMessageById(env, mailbox.id, replyToMessageId)
    : null;
  const existingHeaders = getDraftOutboundHeaders(existing);
  const replyHeaders = getReplyThreadHeaders(replyTo);
  const messageIdHeader =
    existingHeaders.messageIdHeader || createMessageIdHeader(fromAddress);
  const threadKey =
    replyTo?.thread_key ||
    replyTo?.id ||
    existing?.thread_key ||
    messageIdHeader;
  const source = normalizeNullableText(body.source);
  const createdBy = source === "agent" ? "agent" : "owner";
  const normalizedTextBody =
    body.textBody === undefined
      ? existing?.text_body || ""
      : normalizeNullableText(body.textBody) || "";
  const allowedAttachmentSources = [replyTo, existing].filter(
    (row): row is DbMailboxMessageRow => Boolean(row),
  );
  const preservedAttachments = selectPreservedAttachments(
    allowedAttachmentSources,
    body.preservedAttachmentKeys,
  );
  const uploadedAttachments = normalizeUploadedAttachments(
    mailbox.id,
    body.uploadedAttachments,
  );

  return {
    fromAddress,
    toAddress,
    subject:
      body.subject === undefined
        ? existing?.subject || ""
        : normalizeNullableText(body.subject) || "",
    textBody:
      createdBy === "agent"
        ? stripAgentDraftWrapperText(normalizedTextBody)
        : normalizedTextBody,
    htmlBody:
      body.htmlBody === undefined
        ? existing?.html_body || null
        : normalizeNullableText(body.htmlBody),
    sourceId: replyTo?.id || existing?.source_id || null,
    threadKey,
    messageIdHeader,
    inReplyTo: replyHeaders.inReplyTo || existingHeaders.inReplyTo,
    referencesHeader: replyHeaders.referencesHeader || existingHeaders.referencesHeader,
    createdBy,
    preservedAttachments: mergeAttachmentMetadata([
      ...preservedAttachments,
      ...uploadedAttachments,
    ]),
  };
}

export async function insertAgentMailboxDraft(
  env: MailboxEnv,
  mailbox: DbMailboxAliasRow,
  input: NormalizedMailboxDraftInput,
  idempotencyKey: string | null,
): Promise<DbMailboxMessageRow> {
  if (idempotencyKey) {
    const existing = await getAgentMailboxDraftByIdempotencyKey(
      env,
      mailbox.id,
      idempotencyKey,
    );
    if (existing) return existing;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT ${idempotencyKey ? "OR IGNORE " : ""}INTO mailbox_messages (
       id, mailbox_id, direction, message_kind, status, thread_key,
       from_address, to_address, subject, text_body, html_body,
       metadata_json, agent_idempotency_key, source_id, folder, created_by,
       created_at, updated_at
     )
     VALUES (?, ?, 'outbound', 'draft', 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafts', ?, ?, ?)`,
  )
    .bind(
      id,
      mailbox.id,
      input.threadKey,
      input.fromAddress,
      input.toAddress,
      input.subject,
      input.textBody,
      input.htmlBody,
      JSON.stringify(createDraftMetadata(input)),
      idempotencyKey,
      input.sourceId,
      input.createdBy,
      now,
      now,
    )
    .run();

  const draft = idempotencyKey
    ? await getAgentMailboxDraftByIdempotencyKey(
        env,
        mailbox.id,
        idempotencyKey,
      )
    : await getAgentMailboxMessageById(env, mailbox.id, id);
  if (!draft) throw new Error("Inserted draft could not be loaded");
  return draft;
}

export async function getAgentMailboxDraftByIdempotencyKey(
  env: MailboxEnv,
  mailboxId: string,
  idempotencyKey: string,
): Promise<DbMailboxMessageRow | null> {
  return env.DB.prepare(
    `${agentMailboxMessageSelectSql()}
     WHERE mailbox_id = ? AND message_kind = 'draft' AND agent_idempotency_key = ?
     LIMIT 1`,
  )
    .bind(mailboxId, idempotencyKey)
    .first<DbMailboxMessageRow>();
}

export function createDraftMetadata(input: NormalizedMailboxDraftInput): Record<string, unknown> {
  return {
    approval_required: true,
    attachmentCount: input.preservedAttachments.length,
    attachments: input.preservedAttachments,
    outbound_headers: {
      message_id: input.messageIdHeader,
      in_reply_to: input.inReplyTo,
      references: input.referencesHeader,
    },
  };
}

export function selectPreservedAttachments(
  sources: DbMailboxMessageRow[],
  rawKeys: unknown,
): AgentMailboxAttachmentMetadata[] {
  const requested = normalizePreservedAttachmentKeys(rawKeys);
  if (requested.size === 0 || sources.length === 0) return [];

  const selected: AgentMailboxAttachmentMetadata[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const attachment of getMailboxAttachmentMetadata(source)) {
      const storageKey = attachment.storageKey?.trim();
      if (!storageKey || !requested.has(storageKey) || seen.has(storageKey)) continue;
      selected.push({
        filename: attachment.filename || null,
        mimeType: attachment.mimeType || null,
        disposition: attachment.disposition || "attachment",
        size: attachment.size || null,
        storageKey,
        sourceMessageId: attachment.sourceMessageId || source.id,
      });
      seen.add(storageKey);
    }
  }
  return selected;
}

export function normalizePreservedAttachmentKeys(rawKeys: unknown): Set<string> {
  if (!Array.isArray(rawKeys)) return new Set();
  return new Set(
    rawKeys
      .map((key) => (typeof key === "string" ? key.trim() : ""))
      .filter((key) => key.length > 0),
  );
}

export function normalizeUploadedAttachments(
  mailboxId: string,
  rawAttachments: unknown,
): AgentMailboxAttachmentMetadata[] {
  if (!Array.isArray(rawAttachments)) return [];
  const allowedPrefix = `mailbox/${mailboxId}/uploads/`;
  const normalized: AgentMailboxAttachmentMetadata[] = [];
  for (const attachment of rawAttachments) {
    if (!isPlainObject(attachment)) continue;
    const storageKey = normalizeNullableText(attachment.storageKey);
    if (!storageKey?.startsWith(allowedPrefix)) continue;
    normalized.push({
      filename: normalizeNullableText(attachment.filename) || null,
      mimeType: normalizeNullableText(attachment.mimeType) || null,
      disposition: "attachment",
      size:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? attachment.size
          : null,
      storageKey,
      sourceMessageId: null,
    });
  }
  return normalized;
}

export function mergeAttachmentMetadata(
  attachments: AgentMailboxAttachmentMetadata[],
): AgentMailboxAttachmentMetadata[] {
  const seen = new Set<string>();
  const merged: AgentMailboxAttachmentMetadata[] = [];
  for (const attachment of attachments) {
    const storageKey = attachment.storageKey?.trim();
    if (!storageKey || seen.has(storageKey)) continue;
    merged.push(attachment);
    seen.add(storageKey);
  }
  return merged;
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

export function createMessageIdHeader(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "me3.local";
  return `<${crypto.randomUUID()}@${domain}>`;
}

export function getDraftOutboundHeaders(row?: DbMailboxMessageRow | null): {
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
} {
  const metadata = parseJsonRecord(row?.metadata_json || null);
  const outboundHeaders = isPlainObject(metadata.outbound_headers)
    ? metadata.outbound_headers
    : {};
  return {
    messageIdHeader: normalizeMessageHeader(outboundHeaders.message_id),
    inReplyTo: normalizeMessageHeader(outboundHeaders.in_reply_to),
    referencesHeader: normalizeReferencesHeader(outboundHeaders.references),
  };
}

export function getReplyThreadHeaders(row?: DbMailboxMessageRow | null): {
  inReplyTo: string | null;
  referencesHeader: string | null;
} {
  if (!row) return { inReplyTo: null, referencesHeader: null };
  const rawHeaders = parseJsonRecord(row.raw_headers_json);
  const messageId = normalizeMessageHeader(
    rawHeaders["message-id"] ?? rawHeaders["Message-ID"] ?? rawHeaders.messageId,
  );
  const previousReferences = normalizeReferencesHeader(
    rawHeaders.references ?? rawHeaders.References,
  );
  return {
    inReplyTo: messageId,
    referencesHeader: normalizeReferencesHeader(
      [previousReferences, messageId].filter(Boolean).join(" "),
    ),
  };
}

export function normalizeMessageHeader(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const header = value.trim();
  return header && header.length <= 998 ? header : null;
}

export function normalizeReferencesHeader(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeReferencesHeader(value.filter((item) => typeof item === "string").join(" "));
  }
  return normalizeMessageHeader(value);
}

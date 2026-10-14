import { type CoreAgentChatEnv, normalizeNullableText, isPlainObject } from "./domain-store";
import { type DbMailboxAliasRow, type AgentMailboxDraftInput, type DbMailboxMessageRow, type NormalizedMailboxDraftInput, type AgentMailboxAttachmentMetadata } from "./mailbox-types";
import { normalizeEmailText, getAgentMailboxInternalAddress, isValidEmail, getAgentMailboxMessageById, getMailboxAttachmentMetadata } from "./mailbox-store";
import { getDraftOutboundHeaders, getReplyThreadHeaders, createMessageIdHeader, stripAgentDraftWrapperText } from "./mailbox-format";

export async function normalizeAgentMailboxDraftInput(
  env: Pick<CoreAgentChatEnv, "DB">,
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

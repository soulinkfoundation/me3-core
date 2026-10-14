import { decodeMimeHeaderValue, parseEmailAddressHeader } from "../../../shared/email-headers";
import { type DbMailboxAliasRow, type DbMailboxMessageRow, type MailboxUnsubscribeAction, type AgentMailboxMessage } from "./mailbox-types";
import { parseJsonRecord, parseJsonArray, isPlainObject } from "./domain-store";

export const DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[\s\S]*?(?:\n\s*\n|$)/i;

export const DRAFT_WRAPPER_INTRO_LINE_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*(?:\n|$)/i;

export const DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN =
  /^\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*$/im;

export function stripAgentDraftWrapperText(text: string): string {
  let body = text.replace(/\r\n/g, "\n").trim();
  const paragraphMarker = body.match(DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN);
  const draftMarker =
    paragraphMarker && !draftWrapperParagraphIncludesEmailBody(paragraphMarker[0])
      ? paragraphMarker
      : body.match(DRAFT_WRAPPER_INTRO_LINE_PATTERN);
  if (draftMarker?.index !== undefined) {
    body = body.slice(draftMarker.index + draftMarker[0].length).trim();
  }
  body = body.replace(DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN, "");
  const closingPromptIndex = body.search(
    /\n\s*(?:[-–—]\s*)?(?:please\s+let\s+me\s+know\s+if\s+you(?:'|’)d\s+like\s+(?:me\s+)?to\s+(?:make\s+any\s+changes\s+or\s+if\s+you(?:'|’)d\s+like\s+me\s+to\s+)?save\s+this\s+draft\.?|this is a chat draft only|if you want|if you(?:'|’)d like|if you(?:'|’)re happy|want me to|would you like|send me|I can save)/i,
  );
  if (closingPromptIndex >= 0) body = body.slice(0, closingPromptIndex).trim();
  return body.trim();
}

export function draftWrapperParagraphIncludesEmailBody(paragraph: string): boolean {
  const rest = paragraph.split(/\n/).slice(1).join("\n");
  return /^\s*(?:[-–—]{3,}|(?:\*\*)?\s*(?:to|recipient|subject|subject line)\s*:|(?:hi|hello|dear)\b)/im.test(
    rest,
  );
}

export function serializeAgentMailbox(row: DbMailboxAliasRow, aliasAddress: string | null = null) {
  return {
    id: row.id,
    aliasLocalPart: row.alias_local_part,
    aliasAddress,
    forwardingEmail: row.forwarding_email,
    forwardingStatus: row.forwarding_status,
    forwardingEnabled: Boolean(row.forwarding_enabled),
    forwardingMode: row.forwarding_mode,
    status: row.status,
    approvalPolicy: row.approval_policy,
    dailyInboundLimit: row.daily_inbound_limit,
    dailyOutboundLimit: row.daily_outbound_limit,
    activatedAt: row.activated_at,
    forwardingVerifiedAt: row.cf_destination_verified_at,
    cloudflareDestinationId: row.cf_destination_id,
    cloudflareRuleId: row.cf_rule_id,
    cloudflareLastSyncedAt: row.cf_last_synced_at,
    cloudflareLastError: row.cf_last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

export function getAgentMailboxOutboundHeaders(message: AgentMailboxMessage): {
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
} {
  const outboundHeaders = isPlainObject(message.metadata.outbound_headers)
    ? message.metadata.outbound_headers
    : {};
  return {
    messageIdHeader: normalizeMessageHeader(outboundHeaders.message_id),
    inReplyTo: normalizeMessageHeader(outboundHeaders.in_reply_to),
    referencesHeader: normalizeReferencesHeader(outboundHeaders.references),
  };
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

import { stageMailboxAttachmentKeys, finishMailboxAttachmentStaging, cleanMailboxAttachmentStaging } from "./mailbox-attachment-staging";
import { touchContactInteraction, type AgentMailboxMessage } from "./agent-chat";
import type { EmailProviderAttachment } from "./email-providers";
import { publishMailboxMessageReceived } from "./mailbox-events";
import { triageInboundInvoiceEmail } from "./accounts-email-triage";
import { resolveMailboxThreadKey } from "./mailbox-threads";
import { normalizeEmail, sha256Text } from "./sites";
import type { DbMailboxAlias, Env } from "./types";
import {
  decodeMimeHeaderValue,
  parseEmailAddressHeader,
} from "../../../shared/email-headers";

const DIRECT_INBOUND_EMAIL_PROVIDER_ID = "cloudflare-email-routing";
// Raw MIME and parsed bodies currently share one D1 row. Keep this conservative
// until raw message storage moves to R2; the gateway must honor a 413 response.
export const MAX_INBOUND_EMAIL_BYTES = 1024 * 1024;

export type ForwardableEmailMessageLike = {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  readonly canBeForwarded: boolean;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
};

export type InboundEmailDeliveryOptions = {
  providerId?: string;
  providerDeliveryId?: string | null;
  recipient?: string | null;
  allowNativeForwarding?: boolean;
  managedDelivery?: {
    deliveryId: string;
    managedInstallationId: string;
    coreInstallId: string;
    bodySha256: string;
    recipient: string;
  };
};

export type InboundEmailDeliveryResult =
  | { status: "accepted"; mailboxId: string; messageId: string }
  | { status: "duplicate"; mailboxId: string; messageId: string }
  | { status: "conflict"; reason: string }
  | { status: "paused"; reason: string }
  | { status: "too_large"; reason: string }
  | { status: "unavailable"; reason: string };

type ManagedInboundDeliveryRow = {
  managed_installation_id: string;
  core_install_id: string;
  mailbox_id: string;
  mailbox_message_id: string;
  recipient: string;
  body_sha256: string;
};

export type StoredMailboxAttachment = {
  filename: string;
  mimeType: string;
  disposition: "attachment" | "inline";
  size: number;
  storageKey: string;
  contentId?: string | null;
  sourceMessageId: string;
};

type ParsedInboundEmailAttachment = {
  filename: string;
  mimeType: string;
  disposition: "attachment" | "inline";
  contentId: string | null;
  content: Uint8Array;
};

type MailboxUnsubscribeAction =
  | { mode: "one_click"; url: string }
  | { mode: "link"; url: string }
  | { mode: "mailto"; url: string };

export async function handleInboundEmail(
  message: ForwardableEmailMessageLike,
  env: Env,
): Promise<void> {
  const result = await deliverInboundEmail(message, env);
  if (result.status !== "accepted" && result.status !== "duplicate") {
    message.setReject(result.reason);
  }
}

export async function deliverInboundEmail(
  message: ForwardableEmailMessageLike,
  env: Env,
  options: InboundEmailDeliveryOptions = {},
): Promise<InboundEmailDeliveryResult> {
  let stagedMessageId: string | null = null;
  try {
    const existingDelivery = options.managedDelivery
      ? await getManagedInboundDelivery(env, options.managedDelivery.deliveryId)
      : null;
    if (existingDelivery && options.managedDelivery) {
      if (!managedInboundDeliveryMatches(existingDelivery, options.managedDelivery)) {
        return {
          status: "conflict",
          reason: "Delivery ID was already used for different message content.",
        };
      }
      await triageInboundInvoiceEmail(env, existingDelivery.mailbox_id, existingDelivery.mailbox_message_id);
      return {
        status: "duplicate",
        mailboxId: existingDelivery.mailbox_id,
        messageId: existingDelivery.mailbox_message_id,
      };
    }

    const mailbox = await getActiveMailboxForInbound(env);
    if (!mailbox) {
      return {
        status: "paused",
        reason: "The ME3 mailbox is not active for this installation.",
      };
    }

    if (message.rawSize > MAX_INBOUND_EMAIL_BYTES) {
      return {
        status: "too_large",
        reason: "Message is too large for this ME3 mailbox.",
      };
    }

    const rawMessage = await readEmailRawText(message.raw, MAX_INBOUND_EMAIL_BYTES);
    const parsed = parseInboundEmail(rawMessage, message.headers);
    const now = new Date().toISOString();
    const providerId = options.providerId || DIRECT_INBOUND_EMAIL_PROVIDER_ID;
    const providerMessageId =
      normalizeEmailHeaderValue(parsed.headers["message-id"]) ||
      options.providerDeliveryId ||
      await sha256Text(rawMessage);
    const threadKey = resolveMailboxThreadKey(parsed.headers, providerMessageId);
    const rowId = crypto.randomUUID();
    stagedMessageId = rowId;
    const storedAttachments = await storeInboundEmailAttachments(
      env,
      mailbox.id,
      rowId,
      parsed.attachments,
    );
    const envelopeTo = options.recipient || message.to;
    const fromAddress =
      parseEmailAddressHeader(parsed.headers.from)?.address ||
      normalizeEmail(message.from) ||
      normalizeEmailHeaderValue(parsed.headers.from);

    const messageStatement = env.DB.prepare(
      `INSERT INTO mailbox_messages (
         id, mailbox_id, direction, message_kind, status, thread_key,
         provider_id, provider_message_id, from_address, to_address, subject,
         text_body, html_body, raw_headers_json, raw_message, metadata_json,
         folder, created_by, received_at, created_at, updated_at
       )
       VALUES (
         ?, ?, 'inbound', 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         'inbox', ?, ?, ?, ?
       )`,
    )
      .bind(
        rowId,
        mailbox.id,
        "received",
        threadKey,
        providerId,
        providerMessageId,
        fromAddress,
        parseEmailAddressHeader(parsed.headers.to)?.address ||
          normalizeEmail(envelopeTo) ||
          normalizeEmailHeaderValue(parsed.headers.to),
        parsed.subject || "(no subject)",
        parsed.textBody || parsed.htmlBody || "",
        parsed.htmlBody,
        JSON.stringify(parsed.headers),
        rawMessage,
        JSON.stringify({
          rawSize: message.rawSize,
          envelopeFrom: message.from,
          envelopeTo,
          attachmentCount: storedAttachments.length,
          attachments: storedAttachments,
        }),
        providerId,
        now,
        now,
        now,
      );

    if (options.managedDelivery) {
      const delivery = options.managedDelivery;
      const deliveryStatement = env.DB.prepare(
        `INSERT INTO managed_email_inbound_deliveries (
           delivery_id, managed_installation_id, core_install_id, mailbox_id,
           mailbox_message_id, recipient, body_sha256, received_at, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        delivery.deliveryId,
        delivery.managedInstallationId,
        delivery.coreInstallId,
        mailbox.id,
        rowId,
        delivery.recipient,
        delivery.bodySha256,
        now,
        now,
      );
      try {
        await env.DB.batch([messageStatement, deliveryStatement, finishMailboxAttachmentStaging(env, rowId)]);
      } catch (error) {
        const racedDelivery = await getManagedInboundDelivery(env, delivery.deliveryId);
        if (racedDelivery && managedInboundDeliveryMatches(racedDelivery, delivery)) {
          await triageInboundInvoiceEmail(env, racedDelivery.mailbox_id, racedDelivery.mailbox_message_id);
          return {
            status: "duplicate",
            mailboxId: racedDelivery.mailbox_id,
            messageId: racedDelivery.mailbox_message_id,
          };
        }
        if (racedDelivery) return { status: "conflict", reason: "Delivery ID was already used for different message content." };
        throw error;
      }
    } else {
      await env.DB.batch([messageStatement, finishMailboxAttachmentStaging(env, rowId)]);
    }
    stagedMessageId = null;

    // People: an email from a contact counts as being in touch (address only).
    await touchContactInteraction(env, mailbox.user_id, { emails: [fromAddress] }, now)
      .catch((error) => console.error("Contact last-in-touch update failed", error));

    await publishMailboxMessageReceived(env, {
      ownerId: mailbox.user_id,
      mailboxId: mailbox.id,
      messageId: rowId,
      receivedAt: now,
    });
    await triageInboundInvoiceEmail(env, mailbox.id, rowId);

    if (
      options.allowNativeForwarding !== false &&
      mailbox.forwarding_enabled &&
      mailbox.forwarding_email &&
      message.canBeForwarded
    ) {
      await message.forward(mailbox.forwarding_email);
      await markInboundEmailForwarded(env, mailbox.id, rowId, mailbox.forwarding_email);
    }
    return { status: "accepted", mailboxId: mailbox.id, messageId: rowId };
  } catch (error) {
    console.error("Inbound email processing failed", error);
    return {
      status: "unavailable",
      reason: "ME3 could not process this email.",
    };
  } finally {
    if (stagedMessageId) await cleanMailboxAttachmentStaging(env, stagedMessageId).catch((error) => {
      console.error("Mailbox attachment cleanup deferred", error);
    });
  }
}

async function getManagedInboundDelivery(
  env: Env,
  deliveryId: string,
): Promise<ManagedInboundDeliveryRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT managed_installation_id, core_install_id, mailbox_id,
              mailbox_message_id, recipient, body_sha256
       FROM managed_email_inbound_deliveries
       WHERE delivery_id = ?`,
    )
      .bind(deliveryId)
      .first<ManagedInboundDeliveryRow>()) || null
  );
}

function managedInboundDeliveryMatches(
  row: ManagedInboundDeliveryRow,
  delivery: NonNullable<InboundEmailDeliveryOptions["managedDelivery"]>,
): boolean {
  return (
    row.managed_installation_id === delivery.managedInstallationId &&
    row.core_install_id === delivery.coreInstallId &&
    row.recipient.toLowerCase() === delivery.recipient.toLowerCase() &&
    row.body_sha256 === delivery.bodySha256
  );
}

export function resolveMailboxUnsubscribeAction(
  rawHeadersJson: string | null,
): MailboxUnsubscribeAction | null {
  const headers = parseJsonRecord(rawHeadersJson);
  const listUnsubscribe = getHeaderValue(headers, "list-unsubscribe");
  if (!listUnsubscribe) return null;

  const urls = parseListUnsubscribeUrls(listUnsubscribe);
  const httpsUrl = urls.find(isHttpsUrl);
  const mailtoUrl = urls.find((url) => url.trim().toLowerCase().startsWith("mailto:"));
  const oneClick =
    getHeaderValue(headers, "list-unsubscribe-post")?.trim().toLowerCase() ===
    "list-unsubscribe=one-click";

  if (oneClick && httpsUrl) return { mode: "one_click", url: httpsUrl };
  if (httpsUrl) return { mode: "link", url: httpsUrl };
  if (mailtoUrl) return { mode: "mailto", url: mailtoUrl };
  return null;
}

export function sanitizeAttachmentFilename(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return sanitized || fallback;
}

export function getStoredMailboxAttachments(
  metadataJson: string | null,
): StoredMailboxAttachment[] {
  const metadata = parseJsonRecord(metadataJson);
  const rawAttachments = Array.isArray(metadata.attachments)
    ? metadata.attachments
    : [];
  return rawAttachments
    .filter((attachment): attachment is Record<string, unknown> =>
      Boolean(attachment && typeof attachment === "object" && !Array.isArray(attachment)),
    )
    .map((attachment) => ({
      filename: typeof attachment.filename === "string" ? attachment.filename : "",
      mimeType:
        typeof attachment.mimeType === "string" && attachment.mimeType.trim()
          ? attachment.mimeType
          : "application/octet-stream",
      disposition:
        attachment.disposition === "inline" ? ("inline" as const) : ("attachment" as const),
      size:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? attachment.size
          : 0,
      storageKey:
        typeof attachment.storageKey === "string" ? attachment.storageKey : "",
      contentId:
        typeof attachment.contentId === "string" ? attachment.contentId : null,
      sourceMessageId:
        typeof attachment.sourceMessageId === "string"
          ? attachment.sourceMessageId
          : "",
    }))
    .filter((attachment) => attachment.storageKey.startsWith("mailbox/"));
}

export async function loadDraftProviderAttachments(
  env: Env,
  draft: AgentMailboxMessage,
): Promise<EmailProviderAttachment[]> {
  if (!env.SITE_ASSETS) return [];
  const rawAttachments = Array.isArray(draft.metadata.attachments)
    ? draft.metadata.attachments
    : [];
  const attachments = getStoredMailboxAttachments(
    JSON.stringify({ attachments: rawAttachments }),
  );
  const loaded: EmailProviderAttachment[] = [];
  for (const attachment of attachments) {
    const object = await env.SITE_ASSETS.get(attachment.storageKey);
    if (!object) continue;
    loaded.push({
      filename: sanitizeAttachmentFilename(
        attachment.filename,
        `attachment-${loaded.length + 1}`,
      ),
      mimeType: attachment.mimeType || "application/octet-stream",
      content: new Uint8Array(await object.arrayBuffer()),
    });
  }
  return loaded;
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function getActiveMailboxForInbound(env: Env): Promise<DbMailboxAlias | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, alias_local_part, forwarding_email, forwarding_status,
              forwarding_enabled, forwarding_mode, status, approval_policy,
              daily_inbound_limit, daily_outbound_limit, activated_at,
              cf_destination_id, cf_destination_verified_at, cf_rule_id,
              cf_last_synced_at, cf_last_error, created_at, updated_at
       FROM mailbox_aliases
       WHERE status = 'active'
       ORDER BY created_at ASC
       LIMIT 1`,
    )
      .bind()
      .first<DbMailboxAlias>()) || null
  );
}

async function markInboundEmailForwarded(
  env: Env,
  mailboxId: string,
  messageId: string,
  forwardedTo: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE mailbox_messages
     SET status = 'forwarded',
         forwarded_to = ?,
         updated_at = ?
     WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(forwardedTo, new Date().toISOString(), messageId, mailboxId)
    .run();
}

async function readEmailRawText(
  raw: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = raw.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      throw new Error("Inbound email exceeded the ME3 raw message limit.");
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseInboundEmail(
  rawMessage: string,
  envelopeHeaders: Headers,
): {
  headers: Record<string, string>;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  attachments: ParsedInboundEmailAttachment[];
} {
  const [rawHeaderText, ...bodyParts] = rawMessage.split(/\r?\n\r?\n/);
  const headers = {
    ...headersToRecord(envelopeHeaders),
    ...parseRawEmailHeaders(rawHeaderText || ""),
  };
  const body = bodyParts.join("\n\n");
  const contentType = headers["content-type"] || "";
  const parsedBody = parseEmailBody(body, contentType, headers["content-transfer-encoding"]);

  return {
    headers,
    subject: decodeMimeHeaderValue(normalizeEmailHeaderValue(headers.subject)) || "",
    textBody: parsedBody.textBody,
    htmlBody: parsedBody.htmlBody,
    attachments: parsedBody.attachments,
  };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

function parseRawEmailHeaders(rawHeaders: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let currentHeader = "";

  for (const line of rawHeaders.split(/\r?\n/)) {
    if (/^\s/.test(line) && currentHeader) {
      headers[currentHeader] = `${headers[currentHeader]} ${line.trim()}`;
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    currentHeader = line.slice(0, separatorIndex).trim().toLowerCase();
    headers[currentHeader] = line.slice(separatorIndex + 1).trim();
  }

  return headers;
}

function getHeaderValue(headers: Record<string, unknown>, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === "string") {
      return value;
    }
  }
  return null;
}

function parseListUnsubscribeUrls(value: string): string[] {
  const bracketed = [...value.matchAll(/<([^>]+)>/g)]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);
  if (bracketed.length > 0) return bracketed;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseEmailBody(
  body: string,
  contentType: string,
  transferEncoding: string | undefined,
  depth = 0,
): { textBody: string; htmlBody: string | null; attachments: ParsedInboundEmailAttachment[] } {
  if (depth > 30) throw new Error("Email MIME nesting exceeds the supported limit");
  const boundary = extractMimeBoundary(contentType);
  if (!boundary) {
    const decoded = decodeEmailBody(body, transferEncoding);
    if (/text\/html/i.test(contentType)) {
      return { textBody: stripHtml(decoded), htmlBody: decoded.trim() || null, attachments: [] };
    }
    return { textBody: decoded.trim(), htmlBody: null, attachments: [] };
  }

  let textBody = "";
  let htmlBody: string | null = null;
  const attachments: ParsedInboundEmailAttachment[] = [];
  const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = body.split(new RegExp(`^--${escapedBoundary}(--)?[ \t]*(?:\r?\n|$)`, "m"));
  for (let index = 2; index < parts.length; index += 2) {
    if (parts[index - 1] === "--") break;
    const part = parts[index];
    if (!part.trim()) continue;
    const [partHeadersText, ...partBodyParts] = part
      .replace(/^(\r?\n)/, "")
      .split(/\r?\n\r?\n/);
    const partHeaders = parseRawEmailHeaders(partHeadersText || "");
    const partContentType = partHeaders["content-type"] || "";
    const partBody = partBodyParts.join("\n\n").replace(/\r?\n--$/, "");
    const partDisposition = partHeaders["content-disposition"] || "";
    const filename = extractMimeFilename(partContentType, partDisposition);
    const isAttachment =
      /^attachment\b/i.test(partDisposition) ||
      (Boolean(filename) && !/^text\/(?:plain|html)\b/i.test(partContentType));

    if (isAttachment && filename) {
      const content = decodeEmailBodyBytes(
        partBody,
        partHeaders["content-transfer-encoding"],
      );
      attachments.push({
        filename,
        mimeType: normalizeMimeType(partContentType),
        disposition: /^inline\b/i.test(partDisposition) ? "inline" : "attachment",
        contentId: normalizeEmailHeaderValue(partHeaders["content-id"]) || null,
        content,
      });
      continue;
    }

    if (/^multipart\//i.test(partContentType)) {
      const nested = parseEmailBody(partBody, partContentType, partHeaders["content-transfer-encoding"], depth + 1);
      if (!textBody) textBody = nested.textBody;
      if (!htmlBody) htmlBody = nested.htmlBody;
      attachments.push(...nested.attachments);
      continue;
    }
    const decoded = decodeEmailBody(partBody, partHeaders["content-transfer-encoding"]).trim();
    if (!textBody && /^text\/plain\b/i.test(partContentType)) {
      textBody = decoded;
    } else if (!htmlBody && /^text\/html\b/i.test(partContentType)) {
      htmlBody = decoded;
    }
  }

  return {
    textBody: textBody || (htmlBody ? stripHtml(htmlBody) : ""),
    htmlBody,
    attachments,
  };
}

function extractMimeBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return (match?.[1] || match?.[2] || "").trim() || null;
}

function decodeEmailBody(body: string, transferEncoding: string | undefined): string {
  return new TextDecoder().decode(decodeEmailBodyBytes(body, transferEncoding));
}

function decodeEmailBodyBytes(body: string, transferEncoding: string | undefined): Uint8Array {
  const encoding = (transferEncoding || "").trim().toLowerCase();
  if (encoding === "base64") {
    try {
      const binary = atob(body.replace(/\s/g, ""));
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
      return new TextEncoder().encode(body);
    }
  }
  if (encoding === "quoted-printable") {
    const decoded = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0) & 0xff);
  }
  return new TextEncoder().encode(body);
}

function extractMimeFilename(contentType: string, contentDisposition: string): string | null {
  return (
    extractMimeParameter(contentDisposition, "filename*") ||
    extractMimeParameter(contentDisposition, "filename") ||
    extractMimeParameter(contentType, "name*") ||
    extractMimeParameter(contentType, "name")
  );
}

function extractMimeParameter(header: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedName}=("[^"]*"|[^;]+)`, "i").exec(header);
  const raw = (match?.[1] || "").trim();
  if (!raw) return null;
  const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  const rfc5987 = /^utf-8''(.+)$/i.exec(value);
  try {
    return decodeURIComponent(rfc5987?.[1] || value).trim() || null;
  } catch {
    return value.trim() || null;
  }
}

function normalizeMimeType(contentType: string): string {
  return (contentType.split(";")[0] || "application/octet-stream").trim().toLowerCase();
}

async function storeInboundEmailAttachments(
  env: Env,
  mailboxId: string,
  messageId: string,
  attachments: ParsedInboundEmailAttachment[],
): Promise<StoredMailboxAttachment[]> {
  if (!env.SITE_ASSETS || attachments.length === 0) return [];

  const stored: StoredMailboxAttachment[] = attachments.map((attachment, index) => {
    const filename = sanitizeAttachmentFilename(attachment.filename, `attachment-${index + 1}`);
    return {
      filename, mimeType: attachment.mimeType, disposition: attachment.disposition,
      size: attachment.content.byteLength,
      storageKey: `mailbox/${mailboxId}/messages/${messageId}/attachments/${index}-${crypto.randomUUID()}-${filename}`,
      contentId: attachment.contentId, sourceMessageId: messageId,
    };
  });
  await stageMailboxAttachmentKeys(env, messageId, stored.map((attachment) => attachment.storageKey));
  for (const [index, attachment] of stored.entries()) {
    await env.SITE_ASSETS.put(attachment.storageKey, attachments[index].content, {
      httpMetadata: { contentType: attachment.mimeType },
      customMetadata: { mailboxId, messageId, filename: attachment.filename, disposition: attachment.disposition },
    });
  }
  return stored;
}

function stripHtml(value: string): string {
  let text = "";
  let ignoredTag: "script" | "style" | null = null;
  let index = 0;

  while (index < value.length) {
    if (value[index] !== "<") {
      if (!ignoredTag) text += value[index];
      index += 1;
      continue;
    }

    const tagEnd = findMailboxHtmlTagEnd(value, index + 1);
    if (tagEnd === -1) {
      if (!ignoredTag) text += value[index];
      index += 1;
      continue;
    }

    const tag = parseMailboxHtmlTag(value.slice(index + 1, tagEnd));
    if (!tag) {
      if (!ignoredTag) text += " ";
      index = tagEnd + 1;
      continue;
    }

    if (!ignoredTag) {
      text += " ";
      if (!tag.closing && (tag.name === "script" || tag.name === "style")) {
        ignoredTag = tag.name;
      }
    } else if (tag.closing && tag.name === ignoredTag) {
      ignoredTag = null;
      text += " ";
    }
    index = tagEnd + 1;
  }

  return text.replace(/\s+/g, " ").trim();
}

function findMailboxHtmlTagEnd(value: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseMailboxHtmlTag(
  content: string,
): { closing: boolean; name: string } | null {
  let index = 0;
  while (index < content.length && isMailboxHtmlWhitespace(content[index])) {
    index += 1;
  }
  const closing = content[index] === "/";
  if (closing) index += 1;
  while (index < content.length && isMailboxHtmlWhitespace(content[index])) {
    index += 1;
  }

  const nameStart = index;
  while (
    index < content.length &&
    ((content[index] >= "a" && content[index] <= "z") ||
      (content[index] >= "A" && content[index] <= "Z") ||
      (content[index] >= "0" && content[index] <= "9") ||
      content[index] === "-")
  ) {
    index += 1;
  }
  if (index === nameStart) return null;
  return { closing, name: content.slice(nameStart, index).toLowerCase() };
}

function isMailboxHtmlWhitespace(value: string): boolean {
  return value === " " || value === "\n" || value === "\r" || value === "\t";
}

function normalizeEmailHeaderValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

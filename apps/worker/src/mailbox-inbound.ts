import { stageMailboxAttachmentKeys, finishMailboxAttachmentStaging, cleanMailboxAttachmentStaging } from "./mailbox-attachment-staging";
import { ownerSenderAuth } from "./mailbox-instructions";
import type { DnsTxtResolver } from "./mailbox-sender-auth";
import { touchContactInteraction, type AgentMailboxMessage } from "@me3-core/plugin-agent-chat";
import type { EmailProviderAttachment } from "./email-providers";
import { publishMailboxMessageReceived } from "./mailbox-events";
import { enqueueMailTriage } from "./mailbox-triage";
import { resolveMailboxThreadKey } from "./mailbox-threads";
import { normalizeEmail, sha256Text } from "./sites";
import type { DbMailboxAlias, Env } from "./types";
import {
  decodeMimeHeaderValue,
  parseEmailAddressHeader,
} from "../../../shared/email-headers";

const DIRECT_INBOUND_EMAIL_PROVIDER_ID = "cloudflare-email-routing";
// Cloudflare Email Routing accepts messages up to 25 MiB. Raw MIME and
// attachments live in R2 and D1 keeps size-capped parsed bodies. Without an R2
// bucket the raw message stays in the D1 row, so the old 1 MiB limit applies.
// The managed gateway must honor a 413 response.
export const MAX_INBOUND_EMAIL_BYTES = 25 * 1024 * 1024;
export const MAX_INLINE_INBOUND_EMAIL_BYTES = 1024 * 1024;
// D1 rows top out at 2 MB, so parsed bodies are capped; raw MIME keeps the rest.
const MAX_STORED_TEXT_BODY_BYTES = 256 * 1024;
const MAX_STORED_HTML_BODY_BYTES = 768 * 1024;

export function maxInboundEmailBytes(env: Pick<Env, "SITE_ASSETS">): number {
  return env.SITE_ASSETS ? MAX_INBOUND_EMAIL_BYTES : MAX_INLINE_INBOUND_EMAIL_BYTES;
}

export type ForwardableEmailMessageLike = {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  readonly canBeForwarded: boolean;
  // Already-buffered raw bytes (managed gateway) so delivery skips a second copy.
  readonly rawBytes?: Uint8Array;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
};

export type InboundEmailDeliveryOptions = {
  providerId?: string;
  providerDeliveryId?: string | null;
  recipient?: string | null;
  allowNativeForwarding?: boolean;
  /** Lets triage (receipts, the Brief) finish after the inbound handler returns. */
  waitUntil?: (work: Promise<unknown>) => void;
  /** Replaces DNS over HTTPS when checking the DKIM signature of mail from the owner. */
  resolveTxt?: DnsTxtResolver;
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
  | { status: "forwarded"; mailboxId: string; messageId: string | null; forwardedTo: string }
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
  | { mode: "one_click"; url: string; mailtoUrl: string | null }
  | { mode: "link"; url: string; mailtoUrl: string | null }
  | { mode: "mailto"; url: string; mailtoUrl: string };

export async function handleInboundEmail(
  message: ForwardableEmailMessageLike,
  env: Env,
  options: Pick<InboundEmailDeliveryOptions, "waitUntil"> = {},
): Promise<void> {
  const result = await deliverInboundEmail(message, env, options);
  if (result.status !== "accepted" && result.status !== "duplicate" && result.status !== "forwarded") {
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
      await enqueueMailTriage(env, { mailboxId: existingDelivery.mailbox_id, messageId: existingDelivery.mailbox_message_id }, { waitUntil: options.waitUntil });
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

    const maxBytes = maxInboundEmailBytes(env);
    if (message.rawSize > maxBytes) {
      return await handleOversizedInboundEmail(message, env, mailbox, options, maxBytes);
    }

    const providerId = options.providerId || DIRECT_INBOUND_EMAIL_PROVIDER_ID;
    const rowId = crypto.randomUUID();
    let rawBytes: Uint8Array | null = message.rawBytes || await readEmailRawBytes(message.raw, maxBytes);
    const rawMessage = new TextDecoder().decode(rawBytes);
    let rawStorageKey: string | null = null;
    if (env.SITE_ASSETS) {
      rawStorageKey = `mailbox/${mailbox.id}/messages/${rowId}/raw.eml`;
      stagedMessageId = rowId;
      await stageMailboxAttachmentKeys(env, rowId, [rawStorageKey]);
      await env.SITE_ASSETS.put(rawStorageKey, rawBytes, {
        httpMetadata: { contentType: "message/rfc822" },
        customMetadata: { mailboxId: mailbox.id, messageId: rowId },
      });
    }
    rawBytes = null;
    const parsed = parseInboundEmail(rawMessage, message.headers);
    const now = new Date().toISOString();
    const providerMessageId =
      normalizeEmailHeaderValue(parsed.headers["message-id"]) ||
      options.providerDeliveryId ||
      await sha256Text(rawMessage);
    const threadKey = resolveMailboxThreadKey(parsed.headers, providerMessageId);
    stagedMessageId = rowId;
    const storedAttachments = await storeInboundEmailAttachments(
      env,
      mailbox.id,
      rowId,
      parsed.attachments,
      rawStorageKey ? [rawStorageKey] : [],
    );
    const textBody = truncateUtf8(parsed.textBody || parsed.htmlBody || "", MAX_STORED_TEXT_BODY_BYTES);
    const htmlBodyFits = !parsed.htmlBody || utf8ByteLength(parsed.htmlBody) <= MAX_STORED_HTML_BODY_BYTES;
    const envelopeTo = options.recipient || message.to;
    const fromAddress =
      parseEmailAddressHeader(parsed.headers.from)?.address ||
      normalizeEmail(message.from) ||
      normalizeEmailHeaderValue(parsed.headers.from);

    // Mail that says it is from the owner may be an instruction; only a verified signature makes it one.
    const senderAuth = await ownerSenderAuth(env, mailbox.user_id, fromAddress, rawMessage, options.resolveTxt);

    const messageStatement = buildInboundMessageStatement(env, {
      id: rowId,
      mailboxId: mailbox.id,
      status: "received",
      threadKey,
      providerId,
      providerMessageId,
      fromAddress,
      toAddress:
        parseEmailAddressHeader(parsed.headers.to)?.address ||
        normalizeEmail(envelopeTo) ||
        normalizeEmailHeaderValue(parsed.headers.to),
      subject: parsed.subject || "(no subject)",
      textBody: textBody.value,
      htmlBody: htmlBodyFits ? parsed.htmlBody : null,
      rawHeadersJson: JSON.stringify(parsed.headers),
      rawMessage: rawStorageKey ? null : rawMessage,
      metadata: {
        rawSize: message.rawSize,
        envelopeFrom: message.from,
        envelopeTo,
        ...(rawStorageKey ? { rawStorageKey } : {}),
        ...(textBody.truncated ? { textBodyTruncated: true } : {}),
        ...(htmlBodyFits ? {} : { htmlBodyOmitted: true }),
        attachmentCount: storedAttachments.length,
        attachments: storedAttachments,
        ...(senderAuth ? { senderAuth } : {}),
      },
      now,
    });

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
          await enqueueMailTriage(env, { mailboxId: racedDelivery.mailbox_id, messageId: racedDelivery.mailbox_message_id }, { waitUntil: options.waitUntil });
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
    // One triage pass per message: owner rules, receipts and other signals first, then a small model call.
    await enqueueMailTriage(env, { mailboxId: mailbox.id, messageId: rowId }, { waitUntil: options.waitUntil });

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

type InboundMessageRow = {
  id: string;
  mailboxId: string;
  status: "received" | "forwarded" | "dropped";
  threadKey: string | null;
  providerId: string;
  providerMessageId: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  rawHeadersJson: string;
  rawMessage: string | null;
  metadata: Record<string, unknown>;
  forwardedTo?: string | null;
  errorMessage?: string | null;
  now: string;
};

function buildInboundMessageStatement(env: Env, row: InboundMessageRow) {
  return env.DB.prepare(
    `INSERT INTO mailbox_messages (
       id, mailbox_id, direction, message_kind, status, thread_key,
       provider_id, provider_message_id, from_address, to_address, subject,
       text_body, html_body, raw_headers_json, raw_message, metadata_json,
       folder, created_by, received_at, created_at, updated_at,
       forwarded_to, error_message
     )
     VALUES (
       ?, ?, 'inbound', 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       'inbox', ?, ?, ?, ?, ?, ?
     )`,
  ).bind(
    row.id,
    row.mailboxId,
    row.status,
    row.threadKey,
    row.providerId,
    row.providerMessageId,
    row.fromAddress,
    row.toAddress,
    row.subject,
    row.textBody,
    row.htmlBody,
    row.rawHeadersJson,
    row.rawMessage,
    JSON.stringify(row.metadata),
    row.providerId,
    row.now,
    row.now,
    row.now,
    row.forwardedTo ?? null,
    row.errorMessage ?? null,
  );
}

// Oversized mail never silently bounces: forward it to the owner's forwarding
// address when native forwarding is available, and always leave a stub row so
// the owner can see what happened.
async function handleOversizedInboundEmail(
  message: ForwardableEmailMessageLike,
  env: Env,
  mailbox: DbMailboxAlias,
  options: InboundEmailDeliveryOptions,
  maxBytes: number,
): Promise<InboundEmailDeliveryResult> {
  const forwardingEmail =
    options.allowNativeForwarding !== false &&
    mailbox.forwarding_enabled &&
    mailbox.forwarding_email &&
    message.canBeForwarded
      ? mailbox.forwarding_email
      : null;
  if (forwardingEmail) {
    try {
      await message.forward(forwardingEmail);
      const messageId = await recordOversizedInboundEmail(env, {
        mailbox,
        headers: message.headers,
        envelopeFrom: message.from,
        envelopeTo: options.recipient || message.to,
        rawSize: message.rawSize,
        maxBytes,
        providerId: options.providerId || DIRECT_INBOUND_EMAIL_PROVIDER_ID,
        providerDeliveryId: options.providerDeliveryId || null,
        forwardedTo: forwardingEmail,
      });
      return { status: "forwarded", mailboxId: mailbox.id, messageId, forwardedTo: forwardingEmail };
    } catch (error) {
      console.error("Oversized inbound email forwarding failed", error);
    }
  }
  await recordOversizedInboundEmail(env, {
    mailbox,
    headers: message.headers,
    envelopeFrom: message.from,
    envelopeTo: options.recipient || message.to,
    rawSize: message.rawSize,
    maxBytes,
    providerId: options.providerId || DIRECT_INBOUND_EMAIL_PROVIDER_ID,
    providerDeliveryId: options.providerDeliveryId || null,
    forwardedTo: null,
  });
  return {
    status: "too_large",
    reason: `Message is larger than this ME3 mailbox accepts (${formatMegabytes(maxBytes)} MB).`,
  };
}

export async function recordOversizedInboundEmail(
  env: Env,
  input: {
    mailbox?: DbMailboxAlias | null;
    headers: Headers;
    envelopeFrom: string;
    envelopeTo: string;
    rawSize: number;
    maxBytes: number;
    providerId: string;
    providerDeliveryId: string | null;
    forwardedTo: string | null;
  },
): Promise<string | null> {
  try {
    const mailbox = input.mailbox ?? await getActiveMailboxForInbound(env);
    if (!mailbox) return null;
    const headers = headersToRecord(input.headers);
    const providerMessageId =
      normalizeEmailHeaderValue(headers["message-id"]) || input.providerDeliveryId || crypto.randomUUID();
    const existing = await env.DB.prepare(
      `SELECT id FROM mailbox_messages
       WHERE mailbox_id = ? AND provider_id = ? AND provider_message_id = ?
       LIMIT 1`,
    )
      .bind(mailbox.id, input.providerId, providerMessageId)
      .first<{ id: string }>();
    if (existing) return existing.id;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const size = `${formatMegabytes(input.rawSize)} MB`;
    const limit = `${formatMegabytes(input.maxBytes)} MB`;
    const outcome = input.forwardedTo
      ? `It was forwarded to ${input.forwardedTo} instead.`
      : "It was returned to the sender. Ask them to share a link or send smaller attachments.";
    await buildInboundMessageStatement(env, {
      id,
      mailboxId: mailbox.id,
      status: input.forwardedTo ? "forwarded" : "dropped",
      threadKey: resolveMailboxThreadKey(headers, providerMessageId),
      providerId: input.providerId,
      providerMessageId,
      fromAddress:
        parseEmailAddressHeader(headers.from)?.address ||
        normalizeEmail(input.envelopeFrom) ||
        normalizeEmailHeaderValue(headers.from),
      toAddress:
        parseEmailAddressHeader(headers.to)?.address ||
        normalizeEmail(input.envelopeTo) ||
        normalizeEmailHeaderValue(headers.to),
      subject: decodeMimeHeaderValue(normalizeEmailHeaderValue(headers.subject)) || "(no subject)",
      textBody: `This email (${size}) was larger than the ${limit} ME3 can store. ${outcome}`,
      htmlBody: null,
      rawHeadersJson: JSON.stringify(headers),
      rawMessage: null,
      metadata: {
        oversized: true,
        rawSize: input.rawSize,
        maxBytes: input.maxBytes,
        envelopeFrom: input.envelopeFrom,
        envelopeTo: input.envelopeTo,
        attachmentCount: 0,
        attachments: [],
      },
      forwardedTo: input.forwardedTo,
      errorMessage: input.forwardedTo ? null : `Message too large (${size}); limit is ${limit}.`,
      now,
    }).run();
    console.warn("Oversized inbound email recorded", {
      mailboxId: mailbox.id,
      messageId: id,
      rawSize: input.rawSize,
      forwarded: Boolean(input.forwardedTo),
    });
    await publishMailboxMessageReceived(env, {
      ownerId: mailbox.user_id,
      mailboxId: mailbox.id,
      messageId: id,
      receivedAt: now,
    }).catch((error) => console.error("Oversized inbound email event failed", error));
    return id;
  } catch (error) {
    console.error("Oversized inbound email stub failed", { rawSize: input.rawSize, error });
    return null;
  }
}

function formatMegabytes(bytes: number): string {
  return (Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toString();
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  // Each UTF-16 code unit encodes to at most 3 UTF-8 bytes.
  if (value.length * 3 <= maxBytes || utf8ByteLength(value) <= maxBytes) {
    return { value, truncated: false };
  }
  const bytes = new TextEncoder().encode(value).subarray(0, maxBytes);
  // Drop a trailing partial character rather than emitting U+FFFD.
  return { value: new TextDecoder().decode(bytes).replace(/\uFFFD$/, ""), truncated: true };
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

  const mailto = mailtoUrl?.trim() || null;
  if (oneClick && httpsUrl) return { mode: "one_click", url: httpsUrl, mailtoUrl: mailto };
  if (httpsUrl) return { mode: "link", url: httpsUrl, mailtoUrl: mailto };
  if (mailto) return { mode: "mailto", url: mailto, mailtoUrl: mailto };
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

async function readEmailRawBytes(
  raw: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
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

  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
  const [rawHeaderText, body] = splitMimeHeaders(rawMessage);
  const headers = {
    ...headersToRecord(envelopeHeaders),
    ...parseRawEmailHeaders(rawHeaderText),
  };
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

export function getHeaderValue(headers: Record<string, unknown>, name: string): string | null {
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
    const [partHeadersText, rawPartBody] = splitMimeHeaders(part.replace(/^(\r?\n)/, ""));
    const partHeaders = parseRawEmailHeaders(partHeadersText);
    const partContentType = partHeaders["content-type"] || "";
    const partBody = rawPartBody.replace(/\r?\n--$/, "");
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

// Split at the first blank line without copying the (possibly large) body.
function splitMimeHeaders(value: string): [string, string] {
  const match = /\r?\n\r?\n/.exec(value);
  if (!match) return [value, ""];
  return [value.slice(0, match.index), value.slice(match.index + match[0].length)];
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
      return decodeBase64Chunked(body);
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

// Decode in bounded slices so a 25 MB attachment never needs a full-size
// whitespace-free copy plus a full-size binary string at once.
function decodeBase64Chunked(body: string): Uint8Array {
  const output = new Uint8Array(Math.floor((body.length * 3) / 4) + 3);
  let length = 0;
  let pending = "";
  const sliceSize = 1024 * 1024;
  for (let offset = 0; offset < body.length; offset += sliceSize) {
    const cleaned = pending + body.slice(offset, offset + sliceSize).replace(/\s/g, "");
    const done = offset + sliceSize >= body.length;
    const usable = done ? cleaned.length : cleaned.length - (cleaned.length % 4);
    pending = cleaned.slice(usable);
    const binary = atob(cleaned.slice(0, usable));
    for (let index = 0; index < binary.length; index += 1) {
      output[length] = binary.charCodeAt(index);
      length += 1;
    }
    if (done) break;
  }
  return output.subarray(0, length);
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
  stagedKeys: string[] = [],
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
  await stageMailboxAttachmentKeys(env, messageId, [...stagedKeys, ...stored.map((attachment) => attachment.storageKey)]);
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

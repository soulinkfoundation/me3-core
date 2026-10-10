import { createAgentMailboxDraft, getAgentMailboxMessage, listAgentMailboxMessages, type AgentMailboxMessage } from "../../../packages/agent/src/services/mailbox";
import { getAgentMailboxMessageById, getAgentMailboxRow, serializeAgentMailboxMessage } from "../../../packages/agent/src/services/mailbox-records";
import { getDraftOutboundHeaders, getMailboxAttachmentMetadata } from "../../../packages/agent/src/services/mailbox-drafts";
import { isPlainObject, isValidEmail, parseJsonRecord } from "../../../packages/agent/src/services/mailbox-common";
import type { DbMailboxMessageRow } from "../../../packages/agent/src/services/mailbox-types";
import type { AgentMailboxServices, MailboxRecord } from "../../../packages/agent/src/tools/services";
import { EmailProviderInputError, sendEmailWithProvider, type EmailProviderAttachment } from "./email-providers";
import type { Env } from "./types";

type SendClaim = { operationId: string; fingerprint: string; reviewedUpdatedAt: string };
type SendAudit = { id: string; status: string; provider_id: string; provider_message_id: string | null; sent_at: string | null; error_message: string | null };
const unknownDelivery = { error: "Email delivery is unconfirmed. Check delivery status before retrying.", status: 409 };

export function createAgentMailboxServices(env: Env, ownerId: string): AgentMailboxServices {
  return {
    async search(options) {
      const result = await listAgentMailboxMessages(env, ownerId, { ...options, direction: "all", queryMode: "terms" });
      return { ...result, messages: result.messages.map(mailboxRecord) };
    },
    async read(id) {
      const result = await getAgentMailboxMessage(env, ownerId, id);
      return "error" in result ? result : { message: mailboxRecord(result.message) };
    },
    async createDraft(input, idempotencyKey) {
      const result = await createAgentMailboxDraft(env, ownerId, { ...input, textBody: input.body, source: "agent" }, { idempotencyKey });
      return "error" in result ? result : { draft: mailboxRecord(result.draft) };
    },
    sendDraft: (id, key, expected) => sendReviewedDraft(env, ownerId, id, key, expected),
  };
}

function mailboxRecord(message: AgentMailboxMessage) {
  return { ...message, toAddress: message.toAddress || "", bodyText: message.body };
}

async function sendReviewedDraft(env: Env, ownerId: string, draftId: string, key: string, expected: MailboxRecord) {
  if (!key.trim() || key.length > 500) return { error: "A stable send operation key is required.", status: 400 };
  const mailbox = await getAgentMailboxRow(env, ownerId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };
  const row = await getAgentMailboxMessageById(env, mailbox.id, draftId);
  if (!row || row.direction !== "outbound" || expected.id !== draftId) return { error: "Draft not found", status: 404 };
  const operationId = `agent-mailbox-${await hash(JSON.stringify([ownerId, key]))}`;
  const fingerprint = await hash(JSON.stringify(reviewedEnvelope(expected)));
  const existingClaim = claimFrom(row);
  const current = mailboxRecord(serializeAgentMailboxMessage(row));
  if (existingClaim) current.updatedAt = existingClaim.reviewedUpdatedAt;
  if (await hash(JSON.stringify(reviewedEnvelope(current))) !== fingerprint) return { error: "Email draft changed after review. Read and approve it again.", status: 409 };

  if (existingClaim) {
    if (existingClaim.operationId !== operationId || existingClaim.fingerprint !== fingerprint) return { error: "Draft belongs to another send operation.", status: 409 };
    return reconcileSend(env, ownerId, mailbox.id, row, existingClaim);
  }
  if (row.message_kind !== "draft" || !["pending_approval", "failed"].includes(row.status)) return { error: "Draft is not ready to send.", status: 409 };
  if (!row.to_address || !isValidEmail(row.to_address)) return { error: "Draft recipient is invalid", status: 400 };
  const reused = await env.DB.prepare("SELECT id FROM email_send_audit WHERE id = ?").bind(operationId).first();
  if (reused) return { error: "This send operation key was already used.", status: 409 };

  // Load immutable owner-scoped attachments before claiming. Missing attachments
  // fail instead of silently changing the message that the owner reviewed.
  let attachments: EmailProviderAttachment[];
  try { attachments = await loadAttachments(env, mailbox.id, row); }
  catch (error) { return { error: error instanceof Error ? error.message : "Attachment unavailable", status: 409 }; }
  const now = new Date().toISOString();
  const claim: SendClaim = { operationId, fingerprint, reviewedUpdatedAt: row.updated_at };
  const metadata = JSON.stringify({ ...parseJsonRecord(row.metadata_json), agent_send: claim });
  const headers = getDraftOutboundHeaders(row);
  const claimed = env.DB.prepare(`UPDATE mailbox_messages
    SET status = 'approved', error_message = NULL, approved_by_user_id = ?, approved_at = ?, updated_at = ?, metadata_json = ?
    WHERE id = ? AND mailbox_id = ? AND direction = 'outbound' AND message_kind = 'draft' AND status = ?
      AND to_address IS ? AND subject IS ? AND text_body IS ? AND html_body IS ? AND from_address IS ?
      AND metadata_json IS ? AND updated_at = ?
      AND NOT EXISTS (SELECT 1 FROM email_send_audit WHERE id = ?)`)
    .bind(ownerId, now, now, metadata, draftId, mailbox.id, row.status, row.to_address, row.subject, row.text_body, row.html_body, row.from_address, row.metadata_json, row.updated_at, operationId);
  const pendingAudit = env.DB.prepare(`INSERT OR IGNORE INTO email_send_audit
    (id,user_id,mailbox_id,mailbox_message_id,provider_id,status,purpose,from_address,to_address,subject,
     thread_key,message_id_header,in_reply_to,references_header,metadata_json,created_by,approved_by_user_id,requested_at)
    SELECT ?,?,?,?,'agent-operation','pending',?,?,?,?,?,?,?,?,?,'agent',?,?
    WHERE EXISTS (SELECT 1 FROM mailbox_messages WHERE id=? AND mailbox_id=? AND status='approved' AND metadata_json=?)`)
    .bind(operationId, ownerId, mailbox.id, draftId, row.source_id ? "reply" : "draft", row.from_address, row.to_address, row.subject,
      row.thread_key, headers.messageIdHeader, headers.inReplyTo, headers.referencesHeader,
      JSON.stringify({ agent_send_operation_id: operationId, agent_send_fingerprint: fingerprint }), ownerId, now, draftId, mailbox.id, metadata);
  const [claimResult] = await env.DB.batch([claimed, pendingAudit]);
  if ((claimResult.meta?.changes || 0) !== 1) return { error: "Draft changed or is already being sent.", status: 409 };

  let result;
  try {
    result = await sendEmailWithProvider(env, ownerId, {
      purpose: row.source_id ? "reply" : "draft", mailboxId: mailbox.id, mailboxMessageId: draftId, operationId,
      fromAddress: row.from_address?.toLowerCase().endsWith("@me3.local") ? null : row.from_address,
      toAddress: row.to_address, subject: current.subject, textBody: current.bodyText,
      htmlBody: row.html_body, attachments, threadKey: row.thread_key, ...headers,
      metadata: { mailbox_message_id: draftId, source_id: row.source_id, agent_send_operation_id: operationId, agent_send_fingerprint: fingerprint },
      createdBy: "agent", approvedByUserId: ownerId,
    });
  } catch (error) {
    if (error instanceof EmailProviderInputError) {
      await env.DB.prepare("UPDATE email_send_audit SET status='failed',error_message=?,updated_at=? WHERE id=? AND user_id=? AND status='pending'")
        .bind(error.message, new Date().toISOString(), operationId, ownerId).run();
      await env.DB.prepare(`UPDATE mailbox_messages SET status='failed',error_message=?,updated_at=?
        WHERE id=? AND mailbox_id=? AND status='approved' AND json_extract(metadata_json,'$.agent_send.operationId')=?`)
        .bind(error.message, new Date().toISOString(), draftId, mailbox.id, operationId).run();
      return { error: error.message, status: error.status };
    }
    return unknownDelivery;
  }
  try {
    await env.DB.prepare(`UPDATE email_send_audit SET status='sent',provider_id=?,provider_message_id=?,sent_at=?,updated_at=?
      WHERE id=? AND user_id=? AND status='pending'`)
      .bind(result.providerId, result.providerMessageId, result.sentAt, result.sentAt, operationId, ownerId).run();
    return await finishSend(env, ownerId, mailbox.id, draftId, claim, {
      id: operationId, status: "sent", provider_id: result.providerId, provider_message_id: result.providerMessageId, sent_at: result.sentAt, error_message: null,
    });
  } catch { return unknownDelivery; }
}

function reviewedEnvelope(record: MailboxRecord) {
  const metadata = isPlainObject(record.metadata) ? { ...record.metadata } : {};
  delete metadata.agent_send;
  return { id: record.id, to: record.toAddress ?? record.to, subject: record.subject, body: record.bodyText ?? record.body,
    from: record.fromAddress, htmlBody: record.htmlBody, sourceId: record.sourceId, threadKey: record.threadKey, metadata, updatedAt: record.updatedAt };
}

function claimFrom(row: DbMailboxMessageRow): SendClaim | null {
  const claim = parseJsonRecord(row.metadata_json).agent_send;
  return isPlainObject(claim) && typeof claim.operationId === "string" && typeof claim.fingerprint === "string" && typeof claim.reviewedUpdatedAt === "string"
    ? claim as SendClaim : null;
}

async function reconcileSend(env: Env, ownerId: string, mailboxId: string, row: DbMailboxMessageRow, claim: SendClaim) {
  const audit = await env.DB.prepare(`SELECT id,status,provider_id,provider_message_id,sent_at,error_message FROM email_send_audit
    WHERE user_id=? AND mailbox_message_id=? AND json_extract(metadata_json,'$.agent_send_operation_id')=?
      AND json_extract(metadata_json,'$.agent_send_fingerprint')=? AND status IN ('sent','failed')
    ORDER BY CASE status WHEN 'sent' THEN 0 ELSE 1 END, requested_at DESC LIMIT 1`)
    .bind(ownerId, row.id, claim.operationId, claim.fingerprint).first<SendAudit>();
  if (!audit) return unknownDelivery;
  if (audit.status === "failed") return { error: audit.error_message || "Email send failed. Review the draft again before a new send.", status: 409 };
  if (!audit.sent_at) return unknownDelivery;
  try { return await finishSend(env, ownerId, mailboxId, row.id, claim, audit); }
  catch { return unknownDelivery; }
}

async function finishSend(env: Env, ownerId: string, mailboxId: string, id: string, claim: SendClaim, audit: SendAudit) {
  const before = await getAgentMailboxMessageById(env, mailboxId, id);
  if (!before || !(await matchesClaim(before, claim))) return unknownDelivery;
  const result = await env.DB.prepare(`UPDATE mailbox_messages SET message_kind = 'email', status='sent',folder='sent',
    provider_id=?,provider_message_id=?,sent_at=?,updated_at=?,error_message=NULL
    WHERE id=? AND mailbox_id=? AND message_kind='draft' AND status='approved' AND approved_by_user_id=?
      AND json_extract(metadata_json,'$.agent_send.operationId')=? AND json_extract(metadata_json,'$.agent_send.fingerprint')=?
      AND to_address IS ? AND subject IS ? AND text_body IS ? AND html_body IS ? AND from_address IS ?
      AND metadata_json IS ? AND updated_at = ? AND source_id IS ? AND thread_key IS ?`)
    .bind(audit.provider_id, audit.provider_message_id, audit.sent_at, audit.sent_at, id, mailboxId, ownerId, claim.operationId, claim.fingerprint,
      before.to_address, before.subject, before.text_body, before.html_body, before.from_address, before.metadata_json, before.updated_at, before.source_id, before.thread_key).run();
  const row = await getAgentMailboxMessageById(env, mailboxId, id);
  if (!row || (result.meta?.changes || 0) === 0 && row.status !== "sent" || !(await matchesClaim(row, claim))) return unknownDelivery;
  return { draft: mailboxRecord(serializeAgentMailboxMessage(row)) };
}

async function matchesClaim(row: DbMailboxMessageRow, claim: SendClaim) {
  const record = mailboxRecord(serializeAgentMailboxMessage(row));
  record.updatedAt = claim.reviewedUpdatedAt;
  return await hash(JSON.stringify(reviewedEnvelope(record))) === claim.fingerprint;
}

async function loadAttachments(env: Env, mailboxId: string, row: DbMailboxMessageRow): Promise<EmailProviderAttachment[]> {
  const attachments: EmailProviderAttachment[] = [];
  for (const attachment of getMailboxAttachmentMetadata(row)) {
    if (!attachment.storageKey?.startsWith(`mailbox/${mailboxId}/`)) throw new Error("Draft attachment belongs to a different mailbox.");
    const object = await env.SITE_ASSETS?.get(attachment.storageKey);
    if (!object) throw new Error("A reviewed draft attachment is unavailable.");
    attachments.push({ filename: (attachment.filename || `attachment-${attachments.length + 1}`).replace(/[\r\n\\/]/g, "_").slice(0, 200),
      mimeType: attachment.mimeType || "application/octet-stream", content: new Uint8Array(await object.arrayBuffer()) });
  }
  return attachments;
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

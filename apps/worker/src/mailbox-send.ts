import { renderMailMarkdown } from "../../../shared/mail-markdown";
import {
  getAgentMailboxDraftForApproval,
  getAgentMailboxMessage,
  getAgentMailboxOutboundHeaders,
  markAgentMailboxDraftFailed,
  markAgentMailboxDraftSent,
} from "@me3-core/plugin-agent-chat";
import {
  EmailProviderDeliveryUnknownError,
  EmailProviderInputError,
  sendEmailWithProvider,
  type EmailProviderSendResponse,
} from "./email-providers";
import { resolveMailboxTriageForDraft } from "./mailbox-brief";
import { getMailboxDraftDeliveryStatus } from "./mailbox-delivery";
import { loadDraftProviderAttachments } from "./mailbox-inbound";
import type { Env } from "./types";

/**
 * Sending owner mail (me3-kvu8.29, design decision 3 of 13 Nov 2026).
 *
 * "Send" waits a few seconds with Undo, and "Schedule send" waits until a time. Core holds the
 * send, not the browser: the draft keeps its place in Drafts with send_after set, the request
 * that held it sends it when the hold is short, and the cron sweeps whatever is left. So closing
 * the tab or a sleeping phone still sends, exactly once, and every client gets the same Undo.
 */

export type MailboxSendResult = { status: number; body: Record<string, unknown> };
/** How a held draft is sent. Tests pass a stand-in for the provider. */
export type MailboxDraftSender = (env: Env, ownerId: string, draftId: string) => Promise<MailboxSendResult>;
type ServiceError = { error: string; status: number };

const OWNER_MAILBOXES = "SELECT id FROM mailbox_aliases WHERE user_id = ?";
const HOLDABLE = "message_kind = 'draft' AND status IN ('pending_approval', 'failed')";
const DEFAULT_HOLD_SECONDS = 10;
const MAX_HOLD_SECONDS = 60;
const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60 * 1000;
/** A hold this short is sent by the request that made it; anything longer waits for the cron. */
export const MAILBOX_INLINE_HOLD_MS = 25_000;

/** Holds a draft's send: for a few seconds (`holdSeconds`, the Undo window) or until `sendAt`. */
export async function holdMailboxDraft(
  env: Pick<Env, "DB">,
  ownerId: string,
  draftId: string,
  input: { holdSeconds?: unknown; sendAt?: unknown },
  now = new Date(),
): Promise<{ held: true; id: string; sendAfter: string } | ServiceError> {
  let sendAfter: Date;
  if (input.sendAt !== undefined && input.sendAt !== null) {
    sendAfter = new Date(typeof input.sendAt === "string" ? input.sendAt : Number.NaN);
    if (Number.isNaN(sendAfter.getTime()) || sendAfter.getTime() <= now.getTime()) return { error: "Choose a time in the future", status: 400 };
    if (sendAfter.getTime() > now.getTime() + MAX_SCHEDULE_MS) return { error: "Choose a time within a year", status: 400 };
  } else {
    const seconds = Number(input.holdSeconds);
    const hold = Number.isFinite(seconds) ? Math.max(1, Math.min(MAX_HOLD_SECONDS, Math.round(seconds))) : DEFAULT_HOLD_SECONDS;
    sendAfter = new Date(now.getTime() + hold * 1000);
  }
  const held = await env.DB.prepare(
    `UPDATE mailbox_messages SET send_after = ?, updated_at = ?
     WHERE id = ? AND mailbox_id IN (${OWNER_MAILBOXES}) AND ${HOLDABLE}`,
  ).bind(sendAfter.toISOString(), now.toISOString(), draftId, ownerId).run();
  if (!held.meta?.changes) return { error: "Draft not found", status: 404 };
  return { held: true, id: draftId, sendAfter: sendAfter.toISOString() };
}

/** Undo, or cancelling a scheduled send: the draft stays a draft. Refused once the send has started. */
export async function cancelHeldMailboxDraft(
  env: Pick<Env, "DB">,
  ownerId: string,
  draftId: string,
  now = new Date(),
): Promise<{ ok: true; cancelled: true } | ServiceError> {
  const cancelled = await env.DB.prepare(
    `UPDATE mailbox_messages SET send_after = NULL, updated_at = ?
     WHERE id = ? AND mailbox_id IN (${OWNER_MAILBOXES}) AND ${HOLDABLE} AND send_after IS NOT NULL`,
  ).bind(now.toISOString(), draftId, ownerId).run();
  if (cancelled.meta?.changes) return { ok: true, cancelled: true };
  const exists = await env.DB.prepare(`SELECT 1 AS found FROM mailbox_messages WHERE id = ? AND mailbox_id IN (${OWNER_MAILBOXES})`)
    .bind(draftId, ownerId).first<{ found: number }>();
  if (!exists) return { error: "Draft not found", status: 404 };
  return { error: "This email has already been sent or is sending", status: 409 };
}

/** Editing a draft takes it off the schedule, so half-edited text is never sent. */
export async function clearMailboxDraftHold(env: Pick<Env, "DB">, ownerId: string, draftId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE mailbox_messages SET send_after = NULL WHERE id = ? AND mailbox_id IN (${OWNER_MAILBOXES}) AND send_after IS NOT NULL`,
  ).bind(draftId, ownerId).run().catch(() => undefined);
}

/**
 * Sends one held draft if its time has come. The claim (clearing send_after) is a single
 * statement, so the request that held it and the cron can both try and only one sends.
 */
export async function dispatchHeldMailboxDraft(
  env: Env,
  ownerId: string,
  draftId: string,
  options: { now?: Date; send?: MailboxDraftSender } = {},
): Promise<"sent" | "failed" | "skipped" | "not_due"> {
  const now = options.now || new Date();
  const claimed = await env.DB.prepare(
    `UPDATE mailbox_messages SET send_after = NULL
     WHERE id = ? AND mailbox_id IN (${OWNER_MAILBOXES}) AND ${HOLDABLE} AND send_after IS NOT NULL AND send_after <= ?`,
  ).bind(draftId, ownerId, now.toISOString()).run();
  if (!claimed.meta?.changes) return "not_due";
  // A reply is not sent into a conversation the owner has since put in Trash; it stays a draft.
  const repliedTo = await env.DB.prepare(
    `SELECT source.folder FROM mailbox_messages draft JOIN mailbox_messages source ON source.id = draft.source_id
     WHERE draft.id = ?`,
  ).bind(draftId).first<{ folder: string }>().catch(() => null);
  if (repliedTo?.folder === "trash") return "skipped";
  try {
    const result = await (options.send || deliverMailboxDraft)(env, ownerId, draftId);
    return result.status >= 200 && result.status < 300 ? "sent" : "failed";
  } catch (error) {
    console.error("Held email send failed", { draftId, error: error instanceof Error ? error.message : String(error) });
    return "failed";
  }
}

/** Cron: sends every held draft whose time has come. */
export async function dispatchDueMailboxSends(
  env: Env,
  options: { now?: Date; send?: MailboxDraftSender; limit?: number } = {},
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = options.now || new Date();
  const due = await env.DB.prepare(
    `SELECT m.id, a.user_id FROM mailbox_messages m JOIN mailbox_aliases a ON a.id = m.mailbox_id
     WHERE m.send_after IS NOT NULL AND m.send_after <= ? AND m.message_kind = 'draft' AND m.status IN ('pending_approval', 'failed')
     ORDER BY m.send_after ASC LIMIT ?`,
  ).bind(now.toISOString(), options.limit ?? 25).all<{ id: string; user_id: string }>()
    .catch(() => ({ results: [] as Array<{ id: string; user_id: string }> }));
  const totals = { sent: 0, failed: 0, skipped: 0 };
  for (const row of due.results || []) {
    const outcome = await dispatchHeldMailboxDraft(env, row.user_id, row.id, { now, send: options.send });
    if (outcome !== "not_due") totals[outcome] += 1;
  }
  return totals;
}

/** The send-after time of each held draft in a list, for "Sending in 10 s" and "Scheduled for ...". */
export async function listMailboxDraftHolds(env: Pick<Env, "DB">, ownerId: string, draftIds: string[]): Promise<Map<string, string>> {
  const holds = new Map<string, string>();
  if (draftIds.length === 0) return holds;
  const rows = await env.DB.prepare(
    `SELECT id, send_after FROM mailbox_messages
     WHERE mailbox_id IN (${OWNER_MAILBOXES}) AND send_after IS NOT NULL AND id IN (${draftIds.map(() => "?").join(",")})`,
  ).bind(ownerId, ...draftIds).all<{ id: string; send_after: string }>().catch(() => ({ results: [] as Array<{ id: string; send_after: string }> }));
  for (const row of rows.results || []) holds.set(row.id, row.send_after);
  return holds;
}

async function deliveryUnknownResult(
  env: Env,
  ownerId: string,
  draftId: string,
  message: string,
  status = 502,
): Promise<MailboxSendResult> {
  let delivery;
  try {
    delivery = await getMailboxDraftDeliveryStatus(env, ownerId, draftId);
  } catch {
    delivery = null;
  }
  return { status, body: { error: message, ...(delivery && !("error" in delivery) ? { delivery } : {}) } };
}

/**
 * Sends a draft through the owner's email provider and records the result. The owner's Send is
 * the approval; this runs at once, or later for a held send (Send with Undo, Schedule send).
 */
export async function deliverMailboxDraft(env: Env, ownerId: string, draftId: string): Promise<MailboxSendResult> {
  let approval = await getAgentMailboxDraftForApproval(env, ownerId, draftId);
  if (
    "error" in approval &&
    approval.status === 409 &&
    (await reconcileMailboxDraftFromAudit(env, ownerId, draftId))
  ) {
    approval = await getAgentMailboxDraftForApproval(env, ownerId, draftId);
  }
  if ("error" in approval) return { status: approval.status, body: { error: approval.error } };
  if (approval.alreadySent) return { status: 200, body: { draft: approval.draft } };

  const { mailbox, draft } = approval;
  let result: EmailProviderSendResponse;
  try {
    const outboundHeaders = getAgentMailboxOutboundHeaders(draft);
    const attachments = await loadDraftProviderAttachments(env, draft);
    const draftFromAddress =
      draft.fromAddress && !draft.fromAddress.toLowerCase().endsWith("@me3.local")
        ? draft.fromAddress
        : null;
    // Drafts are written in light Markdown; send real formatting plus a clean
    // plain-text alternative unless the draft already carries its own HTML.
    const rendered = draft.htmlBody ? null : renderMailMarkdown(draft.body || "");
    result = await sendEmailWithProvider(env, ownerId, {
      purpose: draft.sourceId ? "reply" : "draft",
      mailboxId: mailbox.id,
      mailboxMessageId: draft.id,
      fromAddress: draftFromAddress,
      toAddress: draft.toAddress || "",
      ccAddresses: draft.ccAddresses,
      bccAddresses: draft.bccAddresses,
      subject: draft.subject || "(no subject)",
      textBody: rendered ? rendered.text : draft.body || "",
      htmlBody: rendered ? rendered.html : draft.htmlBody,
      attachments,
      threadKey: draft.threadKey,
      messageIdHeader: outboundHeaders.messageIdHeader,
      inReplyTo: outboundHeaders.inReplyTo,
      referencesHeader: outboundHeaders.referencesHeader,
      metadata: {
        mailbox_message_id: draft.id,
        source_id: draft.sourceId,
      },
      createdBy: draft.createdBy,
      approvedByUserId: ownerId,
    });
  } catch (error) {
    if (error instanceof EmailProviderDeliveryUnknownError) {
      return deliveryUnknownResult(env, ownerId, draftId, error.message, error.status);
    }
    await markAgentMailboxDraftFailed(env, ownerId, draftId, {
      errorMessage: error instanceof Error ? error.message : "Email send failed",
    });
    if (error instanceof EmailProviderInputError) {
      return { status: error.status, body: { error: error.message } };
    }
    throw error;
  }

  try {
    const sent = await markAgentMailboxDraftSent(env, ownerId, draft.id, {
      providerId: result.providerId,
      providerMessageId: result.providerMessageId,
      sentAt: result.sentAt,
      approvedByUserId: ownerId,
    });
    if (!("error" in sent)) {
      await resolveMailboxTriageForDraft(env, ownerId, draftId);
      return { status: 200, body: sent };
    }
  } catch {
    // The provider accepted the message and its sent audit is durable. Reconcile below.
  }

  try {
    await reconcileMailboxDraftFromAudit(env, ownerId, draftId);
    const reconciled = await getAgentMailboxMessage(env, ownerId, draftId);
    if (!("error" in reconciled) && reconciled.message.status === "sent") {
      return { status: 200, body: { draft: reconciled.message } };
    }
  } catch {
    // Keep the approved draft recoverable when local persistence is unavailable.
  }

  return deliveryUnknownResult(
  env,
  ownerId,
  draftId,
  "The email provider accepted the message, but ME3 could not finish recording it. Check delivery status before retrying.",
  );
}

export async function reconcileMailboxDraftFromAudit(
  env: Env,
  ownerId: string,
  draftId: string,
): Promise<boolean> {
  let audit: {
    provider_id: string;
    provider_message_id: string | null;
    status: "sent" | "failed";
    error_message: string | null;
    sent_at: string | null;
  } | null = null;
  try {
    audit = await env.DB.prepare(
      `SELECT a.provider_id, a.provider_message_id, a.status, a.error_message, a.sent_at
       FROM email_send_audit a
       JOIN mailbox_messages m ON m.id = a.mailbox_message_id
       JOIN mailbox_aliases mb ON mb.id = m.mailbox_id
       WHERE a.user_id = ?
         AND mb.user_id = ?
         AND a.mailbox_message_id = ?
         AND m.message_kind = 'draft'
         AND m.status = 'approved'
         AND a.requested_at >= COALESCE(m.approved_at, m.updated_at, m.created_at)
         AND a.status IN ('sent', 'failed')
       ORDER BY a.requested_at DESC, a.created_at DESC
       LIMIT 1`,
    )
      .bind(ownerId, ownerId, draftId)
      .first();
  } catch {
    return false;
  }
  if (!audit) return false;

  if (audit.status === "failed") {
    await markAgentMailboxDraftFailed(env, ownerId, draftId, {
      errorMessage: audit.error_message || "Email provider send failed",
    });
    return true;
  }
  if (!audit.sent_at) return false;

  const result = await markAgentMailboxDraftSent(env, ownerId, draftId, {
    providerId: audit.provider_id,
    providerMessageId: audit.provider_message_id,
    sentAt: audit.sent_at,
    approvedByUserId: ownerId,
  });
  return !("error" in result) && result.draft?.status === "sent";
}

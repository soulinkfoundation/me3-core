import {
  activateAgentMailbox,
  createAgentMailboxDraft,
  deleteAgentMailboxMessage,
  getAgentMailboxDraftForApproval,
  getAgentMailboxMessage,
  getAgentMailboxOutboundHeaders,
  getAgentMailboxOverview,
  listAgentMailboxMessages,
  markAgentMailboxDraftFailed,
  markAgentMailboxDraftSent,
  moveAgentMailboxMessage,
  pauseAgentMailbox,
  rejectAgentMailboxDraft,
  setAgentMailboxMessageReadState,
  updateAgentMailboxDraft,
  upsertAgentMailbox,
  type AgentMailboxDraftInput,
  type AgentMailboxUpdateInput,
} from "@me3-core/plugin-agent-chat";
import {
  EmailProviderDeliveryUnknownError,
  EmailProviderInputError,
  getConfiguredEmailIdentity,
  sendEmailWithProvider,
  type EmailProviderSendResponse,
} from "../email-providers";
import type { AppContext, AppHono } from "../http/types";
import {
  getStoredMailboxAttachments,
  loadDraftProviderAttachments,
  resolveMailboxUnsubscribeAction,
  sanitizeAttachmentFilename,
  type StoredMailboxAttachment,
} from "../mailbox-inbound";
import { subscribeToMailboxEvents } from "../mailbox-events";
export {
  handleInboundEmail,
  type ForwardableEmailMessageLike,
} from "../mailbox-inbound";
import {
  getMailboxDraftDeliveryStatus,
  markMailboxDraftSentByOwner,
  prepareMailboxDraftRetryAnyway,
} from "../mailbox-delivery";
import {
  isManagedEmailDeployment,
  MANAGED_EMAIL_INBOUND_PATH,
  receiveManagedEmailInbound,
} from "../managed-email";
import {
  listMailboxThreadMessages,
  listMailboxThreads,
  moveMailboxThread,
  setMailboxThreadReadState,
  summarizeMailboxThread,
} from "../mailbox-threads";
import { getOwnerProfile } from "../sites";
import type { Env } from "../types";

const MAX_MAILBOX_ATTACHMENT_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_MAILBOX_ATTACHMENT_UPLOAD_COUNT = 10;

type MailboxRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

export function registerMailboxRoutes(app: AppHono, deps: MailboxRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.post(MANAGED_EMAIL_INBOUND_PATH, (c) =>
    receiveManagedEmailInbound(c.req.raw, c.env),
  );

  const deliveryUnknownResponse = async (
    c: AppContext,
    ownerId: string,
    draftId: string,
    message: string,
    status = 502,
  ) => {
    let delivery;
    try {
      delivery = await getMailboxDraftDeliveryStatus(c.env, ownerId, draftId);
    } catch {
      delivery = null;
    }
    return c.json(
      {
        error: message,
        ...(delivery && !("error" in delivery) ? { delivery } : {}),
      },
      status as any,
    );
  };

  const sendDraft = async (c: AppContext, ownerId: string, draftId: string) => {
    let approval = await getAgentMailboxDraftForApproval(c.env, ownerId, draftId);
    if (
      "error" in approval &&
      approval.status === 409 &&
      (await reconcileMailboxDraftFromAudit(c.env, ownerId, draftId))
    ) {
      approval = await getAgentMailboxDraftForApproval(c.env, ownerId, draftId);
    }
    if ("error" in approval) return c.json({ error: approval.error }, approval.status as any);
    if (approval.alreadySent) return c.json({ draft: approval.draft });

    const { mailbox, draft } = approval;
    let result: EmailProviderSendResponse;
    try {
      const outboundHeaders = getAgentMailboxOutboundHeaders(draft);
      const attachments = await loadDraftProviderAttachments(c.env, draft);
      const draftFromAddress =
        draft.fromAddress && !draft.fromAddress.toLowerCase().endsWith("@me3.local")
          ? draft.fromAddress
          : null;
      result = await sendEmailWithProvider(c.env, ownerId, {
        purpose: draft.sourceId ? "reply" : "draft",
        mailboxId: mailbox.id,
        mailboxMessageId: draft.id,
        fromAddress: draftFromAddress,
        toAddress: draft.toAddress || "",
        subject: draft.subject || "(no subject)",
        textBody: draft.body || "",
        htmlBody: draft.htmlBody,
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
        return deliveryUnknownResponse(
          c,
          ownerId,
          draftId,
          error.message,
          error.status,
        );
      }
      await markAgentMailboxDraftFailed(c.env, ownerId, draftId, {
        errorMessage: error instanceof Error ? error.message : "Email send failed",
      });
      if (error instanceof EmailProviderInputError) {
        return c.json({ error: error.message }, error.status as any);
      }
      throw error;
    }

    try {
      const sent = await markAgentMailboxDraftSent(c.env, ownerId, draft.id, {
        providerId: result.providerId,
        providerMessageId: result.providerMessageId,
        sentAt: result.sentAt,
        approvedByUserId: ownerId,
      });
      if (!("error" in sent)) return c.json(sent);
    } catch {
      // The provider accepted the message and its sent audit is durable. Reconcile below.
    }

    try {
      await reconcileMailboxDraftFromAudit(c.env, ownerId, draftId);
      const reconciled = await getAgentMailboxMessage(c.env, ownerId, draftId);
      if (!("error" in reconciled) && reconciled.message.status === "sent") {
        return c.json({ draft: reconciled.message });
      }
    } catch {
      // Keep the approved draft recoverable when local persistence is unavailable.
    }

    return deliveryUnknownResponse(
      c,
      ownerId,
      draftId,
      "The email provider accepted the message, but ME3 could not finish recording it. Check delivery status before retrying.",
    );
  };

  app.get("/api/mailbox", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const owner = await getOwnerProfile(c.env, ownerId);
    const configuredIdentity = isManagedEmailDeployment(c.env)
      ? null
      : await getConfiguredEmailIdentity(c.env, ownerId).catch(() => null);
    return c.json(
      await getAgentMailboxOverview(c.env, ownerId, owner || undefined, {
        includeRecentActivity: c.req.query("include_activity") !== "0",
        configuredIdentity,
      }),
    );
  });

  app.get("/api/mailbox/events", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const response = await subscribeToMailboxEvents(c.env, ownerId);
    if (!response) {
      return c.json({ ok: false, error: "Mailbox events are unavailable" }, 503);
    }
    return response;
  });

  app.put("/api/mailbox", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    if (isManagedEmailDeployment(c.env)) {
      return c.json(
        {
          error:
            "This mailbox address is assigned by ME3 managed hosting and cannot be changed here",
        },
        409,
      );
    }

    const body = await c.req.json<AgentMailboxUpdateInput>().catch((): AgentMailboxUpdateInput => ({}));
    const owner = await getOwnerProfile(c.env, ownerId);
    const result = await upsertAgentMailbox(c.env, ownerId, body, owner || undefined);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/activate", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await activateAgentMailbox(c.env, ownerId);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/pause", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await pauseAgentMailbox(c.env, ownerId);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.get("/api/mailbox/messages", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    return c.json(await listAgentMailboxMessages(c.env, ownerId, {
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
      status: c.req.query("status") || "",
      createdBy: c.req.query("created_by") || "",
      direction: c.req.query("direction") || "outbound",
      folder: c.req.query("folder") || "",
      query: c.req.query("q") || "",
      unread: c.req.query("unread") || "",
    }));
  });

  app.get("/api/mailbox/threads", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await listMailboxThreads(c.env, ownerId, {
      folder: c.req.query("folder") || "inbox",
      query: c.req.query("q") || "",
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
    });
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.get("/api/mailbox/threads/:threadId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const threadId = c.req.param("threadId");
    const result = await listMailboxThreadMessages(c.env, ownerId, threadId);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json({
      thread: summarizeMailboxThread(threadId, result.messages),
      messages: result.messages,
    });
  });

  app.post("/api/mailbox/threads/:threadId/read", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req.json<{ read?: boolean }>().catch(() => ({ read: true }));
    const result = await setMailboxThreadReadState(
      c.env,
      ownerId,
      c.req.param("threadId"),
      body.read !== false,
    );
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/threads/:threadId/move", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req
      .json<{ folder?: string; fromFolder?: string }>()
      .catch((): { folder?: string; fromFolder?: string } => ({}));
    const result = await moveMailboxThread(
      c.env,
      ownerId,
      c.req.param("threadId"),
      body.folder,
      body.fromFolder,
    );
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.get("/api/mailbox/messages/:messageId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await getAgentMailboxMessage(c.env, ownerId, c.req.param("messageId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.get("/api/mailbox/messages/:messageId/attachments/:attachmentIndex", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    if (!c.env.SITE_ASSETS) {
      return c.json({ error: "Mailbox attachment storage is not configured" }, 503);
    }

    const row = await c.env.DB.prepare(
      `SELECT m.metadata_json
       FROM mailbox_messages m
       JOIN mailbox_aliases a ON a.id = m.mailbox_id
       WHERE a.user_id = ? AND m.id = ?`,
    )
      .bind(ownerId, c.req.param("messageId"))
      .first<{ metadata_json: string | null }>();
    if (!row) return c.json({ error: "Message not found" }, 404);

    const attachments = getStoredMailboxAttachments(row.metadata_json);
    const index = Number.parseInt(c.req.param("attachmentIndex"), 10);
    const attachment = Number.isInteger(index) ? attachments[index] : null;
    if (!attachment?.storageKey) return c.json({ error: "Attachment not found" }, 404);

    const object = await c.env.SITE_ASSETS.get(attachment.storageKey);
    if (!object) return c.json({ error: "Attachment not found" }, 404);

    const filename = sanitizeAttachmentFilename(
      attachment.filename || "",
      `attachment-${index + 1}`,
    );
    return new Response(object.body, {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "'")}"`,
      },
    });
  });

  app.post("/api/mailbox/messages/:messageId/unsubscribe", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const row = await c.env.DB.prepare(
      `SELECT m.id, m.direction, m.message_kind, m.raw_headers_json
       FROM mailbox_messages m
       JOIN mailbox_aliases a ON a.id = m.mailbox_id
       WHERE a.user_id = ? AND m.id = ?`,
    )
      .bind(ownerId, c.req.param("messageId"))
      .first<{
        id: string;
        direction: string;
        message_kind: string;
        raw_headers_json: string | null;
      }>();
    if (!row) return c.json({ error: "Message not found" }, 404);
    if (row.direction !== "inbound" || row.message_kind !== "email") {
      return c.json({ error: "Unsubscribe is only available for inbound email" }, 400);
    }

    const action = resolveMailboxUnsubscribeAction(row.raw_headers_json);
    if (!action) return c.json({ error: "This message does not include an unsubscribe action" }, 404);

    if (action.mode === "one_click") {
      try {
        const response = await fetch(action.url, {
          method: "POST",
          headers: {
            Accept: "text/plain, */*",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "List-Unsubscribe=One-Click",
          redirect: "follow",
        });
        if (!response.ok) {
          return c.json(
            { error: `Unsubscribe request failed with status ${response.status}` },
            502,
          );
        }
        return c.json({ ok: true, mode: "one_click", status: response.status });
      } catch (error) {
        console.error("Mailbox one-click unsubscribe error:", error);
        return c.json({ error: "Failed to send unsubscribe request" }, 502);
      }
    }

    return c.json({ ok: true, mode: "open", url: action.url });
  });

  app.post("/api/mailbox/attachments", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    if (!c.env.SITE_ASSETS) {
      return c.json({ error: "Mailbox attachment storage is not configured" }, 503);
    }

    const mailbox = await c.env.DB.prepare(
      `SELECT id
       FROM mailbox_aliases
       WHERE user_id = ?
       ORDER BY created_at ASC
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<{ id: string }>();
    if (!mailbox) return c.json({ error: "Mailbox not found" }, 404);

    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "Attachment upload is invalid" }, 400);
    const files = form
      .getAll("attachments")
      .filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) return c.json({ error: "Choose at least one attachment" }, 400);
    if (files.length > MAX_MAILBOX_ATTACHMENT_UPLOAD_COUNT) {
      return c.json(
        { error: `Upload up to ${MAX_MAILBOX_ATTACHMENT_UPLOAD_COUNT} attachments at a time` },
        400,
      );
    }

    const uploaded: StoredMailboxAttachment[] = [];
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_MAILBOX_ATTACHMENT_UPLOAD_BYTES) {
        return c.json(
          { error: `${file.name || `Attachment ${index + 1}`} is larger than 25 MB` },
          400,
        );
      }
      const filename = sanitizeAttachmentFilename(file.name, `attachment-${index + 1}`);
      const mimeType = file.type || "application/octet-stream";
      const storageKey = [
        "mailbox",
        mailbox.id,
        "uploads",
        `${new Date().toISOString().slice(0, 10)}`,
        `${crypto.randomUUID()}-${filename}`,
      ].join("/");
      const content = await file.arrayBuffer();
      await c.env.SITE_ASSETS.put(storageKey, content, {
        httpMetadata: {
          contentType: mimeType,
        },
        customMetadata: {
          mailboxId: mailbox.id,
          filename,
          disposition: "attachment",
        },
      });
      uploaded.push({
        filename,
        mimeType,
        disposition: "attachment",
        size: file.size,
        storageKey,
        sourceMessageId: "",
      });
    }

    return c.json({ attachments: uploaded }, 201);
  });

  app.post("/api/mailbox/drafts", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req.json<AgentMailboxDraftInput>().catch((): AgentMailboxDraftInput => ({}));
    const result = await createAgentMailboxDraft(c.env, ownerId, body);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result, 201);
  });

  app.put("/api/mailbox/drafts/:draftId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req.json<AgentMailboxDraftInput>().catch((): AgentMailboxDraftInput => ({}));
    const result = await updateAgentMailboxDraft(c.env, ownerId, c.req.param("draftId"), body);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/drafts/:draftId/reject", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await rejectAgentMailboxDraft(c.env, ownerId, c.req.param("draftId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/drafts/:draftId/approve", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    return sendDraft(c, ownerId, c.req.param("draftId"));
  });

  app.get("/api/mailbox/drafts/:draftId/delivery-status", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const draftId = c.req.param("draftId");
    await reconcileMailboxDraftFromAudit(c.env, ownerId, draftId);
    const delivery = await getMailboxDraftDeliveryStatus(c.env, ownerId, draftId);
    if ("error" in delivery) return c.json({ error: delivery.error }, delivery.status as any);
    return c.json({ delivery });
  });

  app.post("/api/mailbox/drafts/:draftId/mark-sent", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const draftId = c.req.param("draftId");
    await reconcileMailboxDraftFromAudit(c.env, ownerId, draftId);
    const currentDelivery = await getMailboxDraftDeliveryStatus(c.env, ownerId, draftId);
    if ("error" in currentDelivery) {
      return c.json({ error: currentDelivery.error }, currentDelivery.status as any);
    }
    if (currentDelivery.state === "sent") {
      const draft = await getAgentMailboxMessage(c.env, ownerId, draftId);
      if ("error" in draft) return c.json({ error: draft.error }, draft.status as any);
      return c.json({ draft: draft.message, delivery: currentDelivery });
    }
    if (currentDelivery.state !== "delivery_unknown") {
      return c.json(
        {
          error:
            currentDelivery.state === "failed"
              ? "Delivery failed; retry the draft normally."
              : "Draft delivery is not awaiting confirmation.",
          delivery: currentDelivery,
        },
        409,
      );
    }
    const result = await markMailboxDraftSentByOwner(c.env, ownerId, draftId);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    const draft = await getAgentMailboxMessage(c.env, ownerId, draftId);
    if ("error" in draft) return c.json({ error: draft.error }, draft.status as any);
    const delivery = await getMailboxDraftDeliveryStatus(c.env, ownerId, draftId);
    if ("error" in delivery) return c.json({ error: delivery.error }, delivery.status as any);
    return c.json({ draft: draft.message, delivery });
  });

  app.post("/api/mailbox/drafts/:draftId/retry-anyway", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const draftId = c.req.param("draftId");
    await reconcileMailboxDraftFromAudit(c.env, ownerId, draftId);
    const currentDelivery = await getMailboxDraftDeliveryStatus(c.env, ownerId, draftId);
    if ("error" in currentDelivery) {
      return c.json({ error: currentDelivery.error }, currentDelivery.status as any);
    }
    if (currentDelivery.state === "sent") {
      const draft = await getAgentMailboxMessage(c.env, ownerId, draftId);
      if ("error" in draft) return c.json({ error: draft.error }, draft.status as any);
      return c.json({ draft: draft.message, delivery: currentDelivery });
    }
    if (currentDelivery.state !== "delivery_unknown") {
      return c.json(
        {
          error:
            currentDelivery.state === "failed"
              ? "Delivery failed; retry the draft normally."
              : "Draft delivery is not awaiting confirmation.",
          delivery: currentDelivery,
        },
        409,
      );
    }
    const result = await prepareMailboxDraftRetryAnyway(c.env, ownerId, draftId);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return sendDraft(c, ownerId, draftId);
  });

  app.post("/api/mailbox/messages/:messageId/read", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req.json<{ read?: boolean }>().catch(() => ({ read: true }));
    const result = await setAgentMailboxMessageReadState(
      c.env,
      ownerId,
      c.req.param("messageId"),
      body.read !== false,
    );
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/messages/:messageId/move", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req.json<{ folder?: string }>().catch((): { folder?: string } => ({}));
    const result = await moveAgentMailboxMessage(c.env, ownerId, c.req.param("messageId"), body.folder);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.delete("/api/mailbox/messages/:messageId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await deleteAgentMailboxMessage(c.env, ownerId, c.req.param("messageId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });
}

async function reconcileMailboxDraftFromAudit(
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

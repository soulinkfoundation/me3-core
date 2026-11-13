import { parseEmailAddressHeader } from "../../../../shared/email-headers";
import { renderMailMarkdown } from "../../../../shared/mail-markdown";
import { getMailboxSignature, normalizeMailboxSignature, saveMailboxSignature } from "../mailbox-signature";
import { listVerifiedSendAddresses } from "../email-send-identities";
import { ownerInstructionAddresses } from "../mailbox-instructions";
import { getMailboxOriginal } from "../mailbox-original";
import { dkimDomainAligned } from "../mailbox-sender-auth";
import { parseJsonRecord } from "../workspace-input";
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
  getHeaderValue,
  getStoredMailboxAttachments,
  loadDraftProviderAttachments,
  resolveMailboxUnsubscribeAction,
  sanitizeAttachmentFilename,
  type StoredMailboxAttachment,
} from "../mailbox-inbound";
import { subscribeToMailboxEvents } from "../mailbox-events";
import {
  assistMailboxDraft,
  createMailboxRule,
  deleteMailboxRule,
  draftBriefReply,
  getMailboxBrief,
  listMailboxRules,
  markMailboxNotSpam,
  markMailboxSpam,
  resolveBriefItem,
  resolveMailboxTriageForDraft,
  reopenBriefItem,
  snoozeBriefItem,
  undoHandledAction,
} from "../mailbox-brief";
import {
  decorateMailboxMessages,
  decorateMailboxThreads,
  readSenderAvatar,
  verifySenderAvatarSignature,
} from "../mailbox-sender-identity";
export {
  handleInboundEmail,
  type ForwardableEmailMessageLike,
} from "../mailbox-inbound";
import {
  getMailboxDraftDeliveryStatus,
  markMailboxDraftSentByOwner,
  prepareMailboxDraftRetryAnyway,
} from "../mailbox-delivery";
import { syncContactsFromSentMessage } from "../mailbox-outreach";
import { draftFollowUp, snoozeFollowUp, stopFollowUp } from "../mailbox-followups";
import {
  isManagedEmailDeployment,
  MANAGED_EMAIL_INBOUND_PATH,
  receiveManagedEmailInbound,
} from "../managed-email";
import { getMailboxConversationLocation, moveMailboxMessage } from "../mailbox-conversations";
import {
  MAILBOX_INLINE_HOLD_MS,
  cancelHeldMailboxDraft,
  clearMailboxDraftHold,
  deliverMailboxDraft,
  dispatchHeldMailboxDraft,
  holdMailboxDraft,
  listMailboxDraftHolds,
  reconcileMailboxDraftFromAudit,
} from "../mailbox-send";
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

function backgroundWork(c: AppContext): ((work: Promise<unknown>) => void) | undefined {
  try {
    const ctx = c.executionCtx;
    return (work) => ctx.waitUntil(work);
  } catch {
    return undefined;
  }
}

/** Adds `sendAfter` to drafts whose send Core is holding ("Sending in 10 s", "Scheduled for ..."). */
async function withDraftHolds<T extends { id: string; kind: string }>(env: Env, ownerId: string, messages: T[]): Promise<Array<T & { sendAfter: string | null }>> {
  const holds = await listMailboxDraftHolds(env, ownerId, messages.filter((message) => message.kind === "draft").map((message) => message.id));
  return messages.map((message) => ({ ...message, sendAfter: holds.get(message.id) || null }));
}

export function registerMailboxRoutes(app: AppHono, deps: MailboxRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.post(MANAGED_EMAIL_INBOUND_PATH, (c) =>
    receiveManagedEmailInbound(c.req.raw, c.env, { waitUntil: backgroundWork(c) }),
  );

  /** Absolute URLs for signed sender avatars so native clients can load them directly. */
  const apiOrigin = (c: AppContext) => new URL(c.req.url).origin;

  const sendDraft = async (c: AppContext, ownerId: string, draftId: string) => {
    const result = await deliverMailboxDraft(c.env, ownerId, draftId);
    return c.json(result.body, result.status as any);
  };

  app.get("/api/mailbox", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const owner = await getOwnerProfile(c.env, ownerId);
    const configuredIdentity = isManagedEmailDeployment(c.env)
      ? null
      : await getConfiguredEmailIdentity(c.env, ownerId).catch(() => null);
    const overview = await getAgentMailboxOverview(c.env, ownerId, owner || undefined, {
      includeRecentActivity: c.req.query("include_activity") !== "0",
      configuredIdentity,
    });
    // Verified send-as addresses are extra senders. They stay out of inbound so the
    // mailbox's own address remains the one clients show.
    const sendAs = overview.mailbox
      ? (await listVerifiedSendAddresses(c.env, ownerId))
          .filter((identity) => !overview.sources.some((source) => source.address === identity.address))
          .map((identity) => ({
            id: `send-as:${identity.id}`,
            type: "external_forward" as const,
            address: identity.address,
            status: "active" as const,
            inboundEnabled: false,
            outboundEnabled: true,
          }))
      : [];
    // Mail from these addresses is a request ME3 acts on; clients name them when explaining that.
    return c.json({
      ...overview,
      sources: [...overview.sources, ...sendAs],
      ownerAddresses: await ownerInstructionAddresses(c.env, ownerId),
    });
  });

  app.get("/api/mailbox/signature", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    return c.json({ signature: await getMailboxSignature(c.env, ownerId) });
  });

  app.put("/api/mailbox/signature", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const body = await c.req.json<{ signature?: unknown }>().catch(() => ({} as { signature?: unknown }));
    const signature = normalizeMailboxSignature(body.signature);
    if (signature && typeof signature === "object") return c.json({ error: signature.error }, 400);
    if (!(await saveMailboxSignature(c.env, ownerId, signature))) {
      return c.json({ error: "Set up your mailbox before adding a signature" }, 404);
    }
    return c.json({ signature });
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

    const result = await listAgentMailboxMessages(c.env, ownerId, {
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
      status: c.req.query("status") || "",
      createdBy: c.req.query("created_by") || "",
      direction: c.req.query("direction") || "outbound",
      folder: c.req.query("folder") || "",
      query: c.req.query("q") || "",
      unread: c.req.query("unread") || "",
    });
    return c.json({
      ...result,
      messages: await withDraftHolds(c.env, ownerId, await decorateMailboxMessages(c.env, ownerId, result.messages, apiOrigin(c))),
    });
  });

  // --- The Brief: what needs the owner, what ME3 handled, what is left. ---

  app.get("/api/mailbox/brief", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    return c.json(await getMailboxBrief(c.env, ownerId, { apiOrigin: apiOrigin(c) }));
  });

  app.post("/api/mailbox/brief/:messageId/snooze", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const body = await c.req.json<{ until?: string | null }>().catch((): { until?: string | null } => ({}));
    const result = await snoozeBriefItem(c.env, ownerId, c.req.param("messageId"), body.until);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/brief/:messageId/done", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const result = await resolveBriefItem(c.env, ownerId, c.req.param("messageId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  // "Bring back" on the Brief's cleared list.
  app.post("/api/mailbox/brief/:messageId/reopen", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const result = await reopenBriefItem(c.env, ownerId, c.req.param("messageId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/brief/:messageId/draft", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const body = await c.req.json<{ intent?: string }>().catch((): { intent?: string } => ({}));
    try {
      const result = await draftBriefReply(c.env, ownerId, c.req.param("messageId"), { intent: body.intent });
      if ("error" in result) return c.json({ error: result.error }, result.status as any);
      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "ME3 could not write a reply this time." }, 502);
    }
  });

  // Outreach follow-ups on the Brief: ME3 drafts, the owner sends through draft approval.
  app.post("/api/mailbox/followups/:contactId/draft", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const result = await draftFollowUp(c.env, ownerId, c.req.param("contactId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result, 201);
  });

  app.post("/api/mailbox/followups/:contactId/later", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const result = await snoozeFollowUp(c.env, ownerId, c.req.param("contactId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/followups/:contactId/stop", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const result = await stopFollowUp(c.env, ownerId, c.req.param("contactId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.post("/api/mailbox/handled/:actionId/undo", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const result = await undoHandledAction(c.env, ownerId, c.req.param("actionId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  app.get("/api/mailbox/rules", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    return c.json(await listMailboxRules(c.env, ownerId));
  });

  app.post("/api/mailbox/rules", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    const result = await createMailboxRule(c.env, ownerId, body);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result, 201);
  });

  app.delete("/api/mailbox/rules/:ruleId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const result = await deleteMailboxRule(c.env, ownerId, c.req.param("ruleId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });

  // "Spam" moves the mail to Spam and blocks its sender; "Not spam" brings it back and always shows them.
  for (const [scope, param] of [["messages", "messageId"], ["threads", "threadId"]] as const) {
    app.post(`/api/mailbox/${scope}/:${param}/spam`, async (c) => {
      const ownerId = await requireOwner(c);
      if (!ownerId) return unauthorized(c);
      const result = await markMailboxSpam(c.env, ownerId, { [param]: c.req.param(param) });
      if ("error" in result) return c.json({ error: result.error }, result.status as any);
      return c.json(result);
    });
    app.post(`/api/mailbox/${scope}/:${param}/not-spam`, async (c) => {
      const ownerId = await requireOwner(c);
      if (!ownerId) return unauthorized(c);
      const result = await markMailboxNotSpam(c.env, ownerId, { [param]: c.req.param(param) });
      if ("error" in result) return c.json({ error: result.error }, result.status as any);
      return c.json(result);
    });
  }

  // Signed and cacheable: the Worker fetched the logo once, so clients never contact the sender.
  app.get("/api/mailbox/sender-avatars/:domain", async (c) => {
    const domain = c.req.param("domain").toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || !(await verifySenderAvatarSignature(c.env, domain, c.req.query("sig")))) {
      return c.json({ error: "Not found" }, 404);
    }
    const avatar = await readSenderAvatar(c.env, domain);
    if (!avatar) return c.json({ error: "Not found" }, 404);
    return new Response(avatar.body, {
      headers: {
        "Content-Type": avatar.contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  });

  app.post("/api/mailbox/drafts/assist", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    const result = await assistMailboxDraft(c.env, ownerId, body);
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
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
    return c.json({
      ...result,
      threads: await decorateMailboxThreads(c.env, ownerId, result.threads, apiOrigin(c)),
    });
  });

  app.get("/api/mailbox/threads/:threadId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const threadId = c.req.param("threadId");
    const result = await listMailboxThreadMessages(c.env, ownerId, threadId, c.req.query("folder"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json({
      thread: {
        ...summarizeMailboxThread(threadId, result.messages),
        location: await getMailboxConversationLocation(c.env, ownerId, threadId),
      },
      messages: await withDraftHolds(c.env, ownerId, await decorateMailboxMessages(c.env, ownerId, result.messages, apiOrigin(c))),
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
    const [message] = await withDraftHolds(c.env, ownerId, await decorateMailboxMessages(c.env, ownerId, [result.message], apiOrigin(c)));
    return c.json({ message });
  });

  app.get("/api/mailbox/messages/:messageId/original", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const original = await getMailboxOriginal(c.env, ownerId, c.req.param("messageId"));
    if (!original) return c.json({ error: "Message not found" }, 404);
    return c.json({ original });
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
      `SELECT m.id, m.mailbox_id, m.direction, m.message_kind, m.raw_headers_json, m.metadata_json
       FROM mailbox_messages m
       JOIN mailbox_aliases a ON a.id = m.mailbox_id
       WHERE a.user_id = ? AND m.id = ?`,
    )
      .bind(ownerId, c.req.param("messageId"))
      .first<{
        id: string;
        mailbox_id: string;
        direction: string;
        message_kind: string;
        raw_headers_json: string | null;
        metadata_json: string | null;
      }>();
    if (!row) return c.json({ error: "Message not found" }, 404);
    if (row.direction !== "inbound" || row.message_kind !== "email") {
      return c.json({ error: "Unsubscribe is only available for inbound email" }, 400);
    }

    const action = resolveMailboxUnsubscribeAction(row.raw_headers_json);
    if (!action) return c.json({ error: "This message does not include an unsubscribe action" }, 404);

    // Every outcome is something the client can finish: done here, or a page or mail link to open.
    // One-click first, then the list's own page. The sender wrote the mailto, so ME3 sends it itself
    // only when there is no page and it is a plain "Unsubscribe" to the sender's own domain; any other
    // mailto opens in the owner's mail app, where they see who it goes to and what it says.
    if (action.mode === "one_click") {
      const status = await postOneClickUnsubscribe(action.url);
      if (status !== null) return c.json({ ok: true, mode: "one_click", status });
    }
    if (action.mode === "mailto" && action.mailtoUrl) {
      const sentTo = await sendMailtoUnsubscribe(c.env, ownerId, row, action.mailtoUrl);
      if (sentTo) return c.json({ ok: true, mode: "mailto", sentTo });
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
    // An edited draft comes off its schedule: the owner sends or schedules it again.
    await clearMailboxDraftHold(c.env, ownerId, c.req.param("draftId"));
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

    // Send with Undo ({ holdSeconds }) and Schedule send ({ sendAt }): Core holds the send, so it
    // still goes if the tab closes. With no body the draft is sent at once, as before.
    const draftId = c.req.param("draftId");
    const body = await c.req
      .json<{ holdSeconds?: unknown; sendAt?: unknown }>()
      .catch((): { holdSeconds?: unknown; sendAt?: unknown } => ({}));
    if (body.holdSeconds === undefined && body.sendAt === undefined) return sendDraft(c, ownerId, draftId);

    const held = await holdMailboxDraft(c.env, ownerId, draftId, body);
    if ("error" in held) return c.json({ error: held.error }, held.status as any);
    const delay = Date.parse(held.sendAfter) - Date.now();
    const background = backgroundWork(c);
    if (background && delay <= MAILBOX_INLINE_HOLD_MS) {
      background(
        new Promise((resolve) => setTimeout(resolve, Math.max(0, delay) + 250))
          .then(() => dispatchHeldMailboxDraft(c.env, ownerId, draftId))
          .catch((error) => console.error("Held email send failed", error)),
      );
    }
    return c.json(held, 202);
  });

  // Undo within the Send window, or cancelling a scheduled send. The draft stays in Drafts.
  app.post("/api/mailbox/drafts/:draftId/cancel-send", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await cancelHeldMailboxDraft(c.env, ownerId, c.req.param("draftId"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
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
    await syncContactsFromSentMessage(c.env, ownerId, draftId);
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
    const result = await moveMailboxMessage(c.env, ownerId, c.req.param("messageId"), body.folder);
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

// RFC 8058 one-click: a POST the list answers without a page. Returns the status, or null when the list
// did not accept it (an error status, a network failure, or no answer within a few seconds).
async function postOneClickUnsubscribe(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "List-Unsubscribe=One-Click",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.warn("Mailbox one-click unsubscribe refused", { status: response.status });
      return null;
    }
    return response.status;
  } catch (error) {
    console.error("Mailbox one-click unsubscribe error:", error);
    return null;
  }
}

// Sends a plain "Unsubscribe" to the list's mailto address, from the address the mail was delivered to
// (the envelope recipient, never the sender-written To header), which is how the list knows the
// subscriber. Only a recipient on the From domain is mailed; the mailto's subject and body are never
// used. Returns the address it went to, or null when ME3 will not or could not send it.
async function sendMailtoUnsubscribe(
  env: Env,
  ownerId: string,
  row: { id: string; mailbox_id: string; raw_headers_json: string | null; metadata_json: string | null },
  mailtoUrl: string,
): Promise<string | null> {
  const toAddress = parseMailtoUnsubscribeAddress(mailtoUrl);
  if (!toAddress) return null;
  const headers = parseJsonRecord(row.raw_headers_json);
  const fromDomain = parseEmailAddressHeader(getHeaderValue(headers, "from") || "")?.address.split("@")[1] || "";
  const toDomain = toAddress.slice(toAddress.lastIndexOf("@") + 1);
  if (!fromDomain || !dkimDomainAligned(fromDomain, toDomain)) return null;
  try {
    const envelopeTo = parseJsonRecord(row.metadata_json).envelopeTo;
    const delivered = typeof envelopeTo === "string" ? envelopeTo.trim().toLowerCase() : "";
    await sendEmailWithProvider(env, ownerId, {
      purpose: "workflow",
      mailboxId: row.mailbox_id,
      operationId: `mailbox-unsubscribe:${row.id}`,
      fromAddress: delivered.includes("@") && !delivered.endsWith("@me3.local") ? delivered : null,
      toAddress,
      subject: "Unsubscribe",
      textBody: "Unsubscribe",
      metadata: { mailbox_message_id: row.id, me3_action: "list_unsubscribe" },
      createdBy: "owner",
      approvedByUserId: ownerId,
    });
    return toAddress;
  } catch (error) {
    console.warn("Mailbox mailto unsubscribe send failed; handing back the list's link", {
      messageId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// The one recipient of `mailto:list@example.com?subject=...`; its query is ignored.
export function parseMailtoUnsubscribeAddress(mailto: string): string | null {
  const trimmed = mailto.trim();
  if (!/^mailto:/i.test(trimmed)) return null;
  const rest = trimmed.slice("mailto:".length);
  const queryIndex = rest.indexOf("?");
  let addressPart: string;
  try {
    addressPart = decodeURIComponent(queryIndex === -1 ? rest : rest.slice(0, queryIndex));
  } catch {
    return null;
  }
  const addresses = addressPart.split(",").map(address => address.trim().toLowerCase()).filter(Boolean);
  if (addresses.length !== 1) return null;
  return /^[^\s@<>,;:"()]+@[^\s@<>,;:"()]+\.[^\s@<>,;:"()]+$/.test(addresses[0]) ? addresses[0] : null;
}

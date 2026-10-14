import { touchContactInteraction } from "./contact-people";
import { type CoreAgentChatEnv, normalizeNullableText } from "./domain-store";
import { type AgentMailboxDraftInput, type AgentMailboxMessage, type AgentMailbox, type AgentMailboxDraftSendInput, type AgentMailboxDraftFailureInput, type DbMailboxAliasRow, type NormalizedMailboxDraftInput, type DbMailboxMessageRow } from "./mailbox-types";
import { getAgentMailboxRow, getAgentMailboxMessageById, isValidEmail, agentMailboxMessageSelectSql } from "./mailbox-store";
import { normalizeAgentMailboxDraftInput } from "./mailbox-draft-input";
import { serializeAgentMailboxMessage, serializeAgentMailbox } from "./mailbox-format";

export async function createAgentMailboxDraft(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  input: AgentMailboxDraftInput,
  options: { idempotencyKey?: string | null } = {},
): Promise<{ draft: AgentMailboxMessage } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const normalized = await normalizeAgentMailboxDraftInput(env, mailbox, input);
  if ("error" in normalized) return normalized;

  const draft = await insertAgentMailboxDraft(
    env,
    mailbox,
    normalized,
    normalizeNullableText(options.idempotencyKey),
  );
  return { draft: serializeAgentMailboxMessage(draft) };
}

export async function updateAgentMailboxDraft(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  draftId: string,
  input: AgentMailboxDraftInput,
): Promise<{ draft: AgentMailboxMessage | null } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const existing = await getAgentMailboxMessageById(env, mailbox.id, draftId);
  if (!existing || existing.message_kind !== "draft") {
    return { error: "Draft not found", status: 404 };
  }
  if (existing.status !== "pending_approval" && existing.status !== "failed") {
    return { error: "Draft is already being sent", status: 409 };
  }

  const normalized = await normalizeAgentMailboxDraftInput(env, mailbox, input, existing);
  if ("error" in normalized) return normalized;

  const draft = await updateAgentMailboxDraftRow(env, mailbox.id, existing.id, normalized);
  if (!draft) return { error: "Draft is already being sent", status: 409 };
  return { draft: draft ? serializeAgentMailboxMessage(draft) : null };
}

export async function rejectAgentMailboxDraft(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  draftId: string,
): Promise<{ draft: AgentMailboxMessage } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET status = 'rejected',
         folder = 'trash',
         approved_by_user_id = ?,
         approved_at = ?,
         updated_at = ?
     WHERE id = ? AND mailbox_id = ? AND message_kind = 'draft'
       AND status IN ('pending_approval', 'failed')`,
  )
    .bind(userId, now, now, draftId, mailbox.id)
    .run();

  const draft = await getAgentMailboxMessageById(env, mailbox.id, draftId);
  if (!draft) return { error: "Draft not found", status: 404 };
  if ((result.meta?.changes || 0) === 0) {
    return { error: "Draft is already being sent", status: 409 };
  }
  return { draft: serializeAgentMailboxMessage(draft) };
}

export async function getAgentMailboxDraftForApproval(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  draftId: string,
): Promise<
  | { mailbox: AgentMailbox; draft: AgentMailboxMessage; alreadySent: boolean }
  | { error: string; status: number }
> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const existing = await getAgentMailboxMessageById(env, mailbox.id, draftId);
  if (existing?.message_kind === "email" && existing.status === "sent") {
    return {
      mailbox: serializeAgentMailbox(mailbox),
      draft: serializeAgentMailboxMessage(existing),
      alreadySent: true,
    };
  }
  if (!existing || existing.message_kind !== "draft") {
    return { error: "Draft not found", status: 404 };
  }
  if (!existing.to_address) {
    return { error: "Draft recipient is required", status: 400 };
  }
  if (!isValidEmail(existing.to_address)) {
    return { error: "Draft recipient is invalid", status: 400 };
  }

  const now = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET status = 'approved',
         error_message = NULL,
         approved_by_user_id = ?,
         approved_at = ?,
         updated_at = ?
     WHERE id = ? AND mailbox_id = ? AND message_kind = 'draft'
       AND status IN ('pending_approval', 'failed')`,
  )
    .bind(userId, now, now, draftId, mailbox.id)
    .run();

  if ((claimed.meta?.changes || 0) === 0) {
    const latest = await getAgentMailboxMessageById(env, mailbox.id, draftId);
    if (latest?.message_kind === "email" && latest.status === "sent") {
      return {
        mailbox: serializeAgentMailbox(mailbox),
        draft: serializeAgentMailboxMessage(latest),
        alreadySent: true,
      };
    }
    if (latest?.message_kind === "draft" && latest.status === "approved") {
      return { error: "Draft is already being sent", status: 409 };
    }
    return { error: "Draft is not ready to send", status: 409 };
  }

  const draft = await getAgentMailboxMessageById(env, mailbox.id, draftId);
  if (!draft) return { error: "Draft not found", status: 404 };

  return {
    mailbox: serializeAgentMailbox(mailbox),
    draft: serializeAgentMailboxMessage(draft),
    alreadySent: false,
  };
}

export async function markAgentMailboxDraftSent(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  draftId: string,
  input: AgentMailboxDraftSendInput,
): Promise<{ draft: AgentMailboxMessage | null } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET message_kind = 'email',
         status = 'sent',
         folder = 'sent',
         provider_id = ?,
         provider_message_id = ?,
         error_message = NULL,
         approved_by_user_id = ?,
         approved_at = ?,
         sent_at = ?,
         updated_at = ?
     WHERE id = ? AND mailbox_id = ? AND message_kind = 'draft' AND status = 'approved'`,
  )
    .bind(
      input.providerId,
      input.providerMessageId,
      input.approvedByUserId,
      input.sentAt,
      input.sentAt,
      input.sentAt,
      draftId,
      mailbox.id,
    )
    .run();

  const sent = await getAgentMailboxMessageById(env, mailbox.id, draftId);
  if ((result.meta?.changes || 0) > 0 && sent?.to_address) {
    await touchContactInteraction(env, userId, { emails: [sent.to_address] }, input.sentAt);
  }
  if ((result.meta?.changes || 0) === 0) {
    if (!sent) return { error: "Draft not found", status: 404 };
    if (sent.message_kind !== "email" || sent.status !== "sent") {
      return { error: "Draft is not being sent", status: 409 };
    }
  }
  return { draft: sent ? serializeAgentMailboxMessage(sent) : null };
}

export async function markAgentMailboxDraftFailed(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  draftId: string,
  input: AgentMailboxDraftFailureInput,
): Promise<void> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return;

  await env.DB.prepare(
    `UPDATE mailbox_messages
     SET status = 'failed',
         folder = 'drafts',
         error_message = ?,
         updated_at = ?
     WHERE id = ? AND mailbox_id = ? AND message_kind = 'draft' AND status = 'approved'`,
  )
    .bind(input.errorMessage, new Date().toISOString(), draftId, mailbox.id)
    .run();
}

export async function insertAgentMailboxDraft(
  env: Pick<CoreAgentChatEnv, "DB">,
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
  env: Pick<CoreAgentChatEnv, "DB">,
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

export async function updateAgentMailboxDraftRow(
  env: Pick<CoreAgentChatEnv, "DB">,
  mailboxId: string,
  draftId: string,
  input: NormalizedMailboxDraftInput,
): Promise<DbMailboxMessageRow | null> {
  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET status = 'pending_approval',
         thread_key = ?,
         from_address = ?,
         to_address = ?,
         subject = ?,
         text_body = ?,
         html_body = ?,
         metadata_json = ?,
         source_id = ?,
         folder = 'drafts',
         created_by = ?,
         error_message = NULL,
         updated_at = ?
     WHERE id = ? AND mailbox_id = ? AND message_kind = 'draft'
       AND status IN ('pending_approval', 'failed')`,
  )
    .bind(
      input.threadKey,
      input.fromAddress,
      input.toAddress,
      input.subject,
      input.textBody,
      input.htmlBody,
      JSON.stringify(createDraftMetadata(input)),
      input.sourceId,
      input.createdBy,
      new Date().toISOString(),
      draftId,
      mailboxId,
    )
    .run();

  if ((result.meta?.changes || 0) === 0) return null;

  return getAgentMailboxMessageById(env, mailboxId, draftId);
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

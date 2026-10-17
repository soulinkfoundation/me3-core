import { readManagedAllowanceNotice, type ManagedAllowanceNotice } from "../managed-ai-billing";
import { readAgentEmailDraft, type AgentEmailDraft } from "../agent-email-draft";
import { parseAgentTargetSelection, preflightAgentTargetSelection, persistAgentTargetSelectionInput } from "../agent-target-selection";
import { revalidateAgentTargetPayload } from "../agent-target-projection";
import type { AgentTargetPresentationCard } from "../../../../packages/agent/src/types";
import { assistantRuntimeNamespace } from "../assistant-runtime-binding";
import { revalidateAgentImagePayload } from "../agent-image-projection";
import { getSiteImageMetadata } from "../site-images";
import { type Context } from "hono";
import { registerNewAgentRoutes } from "./new-agent";
import { registerAssistantSkillsRoutes } from "./assistant-skills";
import {
  AGENT_CHAT_MODES,
  allowsAgentChatRawModelSelection,
  createAgentSandboxTurnRecord,
  type AgentChatMode,
  type AgentChatActionCard,
  type AgentChatImageAction,
} from "@me3-core/plugin-agent-chat";
import {
  acknowledgeAgentChannelDelivery,
  canRetryAgentChannelInboundEvent,
  claimAgentChannelInboundEvent,
  dispatchAgentChannelTurn,
  getActiveSoulinkConnectionForThread,
  getAgentChannelDispatchReplay,
  insertProviderChannelEvent,
  insertProviderChannelEventOnce,
  updateAgentChannelInboundContent,
  updateAgentChannelInboundDispatchStatus,
  verifySoulinkDispatchAuth,
} from "../agent-channels";
import {
  parseSoulinkTurnInput,
  readStoredSoulinkTurnResolution,
  resolveSoulinkTurnInput,
  soulinkTurnClaimText,
  SoulinkTurnInputError,
  type SoulinkTurnInput,
} from "../soulink-turn-input";
import { isCorePluginEnabled } from "../plugins";
import { normalizeNullableText } from "../sites";
import {
  VoiceDictationInputError,
  transcribeVoiceDictation,
} from "../voice-dictation";
import type { AppContext, AppHono } from "../http/types";
import type { Env } from "../types";
import { getPrimaryAssistantThread, resolvePrimaryAssistantThread, type AssistantThreadRow } from "../assistant-primary-thread";

const MAX_ASSISTANT_ATTACHMENT_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ASSISTANT_TEXT_ATTACHMENT_BYTES = 1 * 1024 * 1024;
const MAX_ASSISTANT_ATTACHMENT_UPLOAD_COUNT = 4;
const MAX_ASSISTANT_EXTRACTED_TEXT_CHARS = 48_000;
const DEFAULT_ASSISTANT_NAME = "ME3";
const MAX_ASSISTANT_NAME_LENGTH = 48;

type AssistantRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
  getSessionOwnerId(c: AppContext): Promise<string | null>;
  getSetupRequired(env: Env, ownerId?: string): Promise<string[]>;
};

type ChatBody = { message?: string };
type AssistantChatTurnBody = {
  targetSelection?: unknown;
  messageText?: unknown;
  mode?: unknown;
  requestId?: unknown;
  threadId?: unknown;
  projectId?: unknown;
  replyToMessageId?: unknown;
  model?: unknown;
  attachments?: unknown;
  scopes?: unknown;
};
type AssistantChatTurnModelSelection = {
  providerId: "workers-ai" | "openai" | "anthropic";
  model: string;
  optionId: string | null;
};
type AssistantChatTurnStreamEvent =
  | "status"
  | "thread"
  | "tool"
  | "delta"
  | "done"
  | "error";
type AssistantChatTurnStreamSend = (
  event: AssistantChatTurnStreamEvent,
  data: Record<string, unknown>,
) => void;
type AssistantChatRoutePerformance = {
  version: 1;
  handlerPreStreamMs: number;
  replayLookupMs: number | null;
  threadResolutionMs: number | null;
  siteScopeCheckMs: number | null;
  attachmentContextMs: number | null;
  turnRecordMs: number | null;
  durableObjectHeadersMs: number | null;
  durableObjectStreamMs: number | null;
  routeToRuntimeDoneMs: number | null;
};
type AssistantMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata_json?: string | null;
};
type AssistantAttachmentContentRow = {
  id: string;
  filename: string;
  mime_type: string;
  kind: "text" | "image";
  status: "ready" | "error" | "deleted";
  storage_key: string | null;
};
type AssistantUploadFile = {
  name: string;
  type: string;
  size: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};
type AssistantAttachmentJsonUploadBody = {
  threadId?: unknown;
  attachments?: unknown;
};
type AssistantAttachmentTextContextRow = {
  id: string;
  filename: string;
  mime_type: string;
  extracted_text: string | null;
  text_truncated: number | null;
};
type SoulinkDispatchBody = {
  ownerSubject?: unknown;
  ownerNodeId?: unknown;
  assistantNodeId?: unknown;
  connectionId?: unknown;
  sourceEventId?: unknown;
  conversationId?: unknown;
  streamChannelType?: unknown;
  streamChannelId?: unknown;
  messageText?: unknown;
  input?: unknown;
  replyToMessageId?: unknown;
  createdAt?: unknown;
};
type SoulinkDeliveryBody = {
  sourceEventId?: unknown;
  streamChannelId?: unknown;
  providerMessageId?: unknown;
  status?: unknown;
  errorMessage?: unknown;
};
type AssistantSettingsRow = {
  assistant_name: string | null;
};

function normalizeAssistantNameInput(
  value: unknown,
): string | null | { error: string } {
  if (value === null) return null;
  if (typeof value !== "string") return { error: "Assistant name must be text" };

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length > MAX_ASSISTANT_NAME_LENGTH) {
    return {
      error: `Assistant name must be ${MAX_ASSISTANT_NAME_LENGTH} characters or fewer`,
    };
  }
  if (/[\u0000-\u001f\u007f{}\[\]<>]/.test(normalized)) {
    return { error: "Assistant name can only contain plain display-name text" };
  }
  return normalized;
}

function serializeAssistantSettings(row: AssistantSettingsRow | null) {
  const assistantName = normalizeNullableText(row?.assistant_name) || null;
  return {
    assistantName,
    displayName: assistantName || DEFAULT_ASSISTANT_NAME,
  };
}

async function getAssistantSettings(env: Env, ownerId: string) {
  const row = await env.DB.prepare(
    "SELECT assistant_name FROM owner_profile WHERE id = ?",
  )
    .bind(ownerId)
    .first<AssistantSettingsRow>();
  return serializeAssistantSettings(row ?? null);
}

function sanitizeAttachmentFilename(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return sanitized || fallback;
}

function sanitizeContentDispositionFilename(value: string): string {
  return sanitizeAttachmentFilename(value, "assistant-image.png").replace(/"/g, "");
}

function normalizeAssistantAttachmentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return null;
  return trimmed;
}

async function parseAssistantAttachmentUploadRequest(
  c: Context<{ Bindings: Env }>,
): Promise<
  | { files: AssistantUploadFile[]; threadId: string | null }
  | { error: string; status: 400 }
> {
  const contentType = c.req.header("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const form = await c.req.formData().catch((): FormData | null => null);
    if (!form) return { error: "Attachment upload is invalid", status: 400 };

    const threadIdInput = form.get("threadId");
    return {
      files: form
        .getAll("attachments")
        .filter((entry): entry is File => entry instanceof File),
      threadId:
        typeof threadIdInput === "string" && threadIdInput.trim()
          ? threadIdInput.trim()
          : null,
    };
  }

  const body = await c.req
    .json<AssistantAttachmentJsonUploadBody>()
    .catch((): AssistantAttachmentJsonUploadBody => ({}));
  if (!Array.isArray(body.attachments)) {
    return { error: "Choose at least one attachment", status: 400 };
  }

  const files: AssistantUploadFile[] = [];
  for (const [index, value] of body.attachments.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: `Attachment ${index + 1} is invalid`, status: 400 };
    }
    const attachment = value as Record<string, unknown>;
    const filename =
      typeof attachment.filename === "string" && attachment.filename.trim()
        ? attachment.filename.trim()
        : `attachment-${index + 1}`;
    const mimeType =
      typeof attachment.mimeType === "string" && attachment.mimeType.trim()
        ? attachment.mimeType.trim()
        : "application/octet-stream";
    if (typeof attachment.dataBase64 !== "string" || !attachment.dataBase64.trim()) {
      return { error: `${filename} has no upload data`, status: 400 };
    }
    const encodedData = attachment.dataBase64.trim();
    const maximumEncodedLength =
      Math.ceil(MAX_ASSISTANT_ATTACHMENT_UPLOAD_BYTES / 3) * 4 + 4;
    if (encodedData.length > maximumEncodedLength) {
      return {
        error: `${filename} is larger than ${formatAssistantByteLimit(
          MAX_ASSISTANT_ATTACHMENT_UPLOAD_BYTES,
        )}`,
        status: 400,
      };
    }

    let bytes: Uint8Array;
    try {
      const binary = atob(encodedData);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
      return { error: `${filename} upload data is invalid`, status: 400 };
    }
    const uploadBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(uploadBuffer).set(bytes);
    const blob = new Blob([uploadBuffer], { type: mimeType });
    files.push({
      name: filename,
      type: mimeType,
      size: bytes.byteLength,
      text: () => blob.text(),
      arrayBuffer: () => blob.arrayBuffer(),
    });
  }

  return {
    files,
    threadId:
      typeof body.threadId === "string" && body.threadId.trim()
        ? body.threadId.trim()
        : null,
  };
}

function formatAssistantByteLimit(bytes: number) {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${Math.round(bytes / 100_000) / 10} MB`;
}

export function registerAssistantRoutes(app: AppHono, deps: AssistantRouteDeps) {
  const { requireOwner, unauthorized, getSessionOwnerId, getSetupRequired } = deps;

  app.post("/api/assistant/chat", async (c) => {
    const ownerId = await getSessionOwnerId(c);
    if (!ownerId) return c.json({ ok: false, error: "Authentication required" }, 401);
    const body = await c.req.json<ChatBody>().catch((): ChatBody => ({}));
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return c.json({ ok: false, error: "Message is required" }, 400);
    if (!assistantRuntimeNamespace(c.env)) return c.json({ ok: false, error: "Agent runtime is unavailable" }, 503);
    const thread = await resolvePrimaryAssistantThread(c.env, ownerId);
    const response = await handleAssistantChatTurn(c, { messageText: message, threadId: thread.id });
    if (!response.ok) return response;
    const payload = await response.json() as Record<string, unknown>;
    return c.json({ ok: true, reply: payload.replyText, setupRequired: await getSetupRequired(c.env, ownerId) });
  });

  app.post("/api/assistant/voice/transcribe", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const formData = await c.req.formData().catch((): FormData | null => null);
    const audio = formData?.get("audio");
    const language = formData?.get("language");

    if (!(audio instanceof Blob)) {
      return c.json({ ok: false, error: "Audio file is required" }, 400);
    }

    try {
      const result = await transcribeVoiceDictation(c.env, audio, {
        language: typeof language === "string" && language.trim() ? language.trim() : null,
        ownerId,
      });
      return c.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof VoiceDictationInputError) {
        return c.json({ ok: false, error: error.message }, error.status as any);
      }
      throw error;
    }
  });

  app.post("/api/assistant/attachments", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const upload = await parseAssistantAttachmentUploadRequest(c);
    if ("error" in upload) {
      return c.json({ ok: false, error: upload.error }, upload.status);
    }
    const { files, threadId } = upload;
    if (files.length === 0) return c.json({ ok: false, error: "Choose at least one attachment" }, 400);
    if (files.length > MAX_ASSISTANT_ATTACHMENT_UPLOAD_COUNT) {
      return c.json(
        {
          ok: false,
          error: `Upload up to ${MAX_ASSISTANT_ATTACHMENT_UPLOAD_COUNT} attachments at a time`,
        },
        400,
      );
    }

    if (threadId) {
      const thread = await getAssistantThread(c.env, ownerId, threadId);
      if (!thread) return c.json({ ok: false, error: "Assistant thread not found" }, 404);
    }

    const uploaded = [];
    for (const [index, file] of files.entries()) {
      const filename = sanitizeAttachmentFilename(file.name, `attachment-${index + 1}`);
      const mimeType = normalizeAssistantAttachmentMimeType(file, filename);
      const kind = classifyAssistantUploadKind(filename, mimeType);
      if (!kind) {
        return c.json(
          {
            ok: false,
            error: `${filename} is not supported yet. Use text, markdown, JSON, CSV, XML, or images.`,
          },
          400,
        );
      }
      if (file.size > MAX_ASSISTANT_ATTACHMENT_UPLOAD_BYTES) {
        return c.json(
          {
            ok: false,
            error: `${filename} is larger than ${formatByteLimit(MAX_ASSISTANT_ATTACHMENT_UPLOAD_BYTES)}`,
          },
          400,
        );
      }
      if (kind === "text" && file.size > MAX_ASSISTANT_TEXT_ATTACHMENT_BYTES) {
        return c.json(
          {
            ok: false,
            error: `${filename} is too large to read as text. Use files under ${formatByteLimit(MAX_ASSISTANT_TEXT_ATTACHMENT_BYTES)} for now.`,
          },
          400,
        );
      }
      if (kind === "image" && !c.env.SITE_ASSETS) {
        return c.json(
          { ok: false, error: "Assistant image attachment storage is not configured" },
          503,
        );
      }

      const id = crypto.randomUUID();
      let storageKey: string | null = null;
      let extractedText: string | null = null;
      let textTruncated = 0;

      if (kind === "text") {
        const text = await file.text();
        extractedText = text.slice(0, MAX_ASSISTANT_EXTRACTED_TEXT_CHARS);
        textTruncated = text.length > MAX_ASSISTANT_EXTRACTED_TEXT_CHARS ? 1 : 0;
      } else if (c.env.SITE_ASSETS) {
        storageKey = [
          "assistant",
          ownerId,
          "attachments",
          new Date().toISOString().slice(0, 10),
          `${id}-${filename}`,
        ].join("/");
        await c.env.SITE_ASSETS.put(storageKey, await file.arrayBuffer(), {
          httpMetadata: { contentType: mimeType },
          customMetadata: {
            ownerId,
            threadId: threadId || "",
            filename,
            kind,
          },
        });
      }

      try {
        await c.env.DB.prepare(
          `INSERT INTO assistant_attachments
             (id, owner_id, thread_id, filename, mime_type, size, kind, status,
              storage_key, extracted_text, text_truncated, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
        )
          .bind(
            id,
            ownerId,
            threadId,
            filename,
            mimeType,
            file.size,
            kind,
            storageKey,
            extractedText,
            textTruncated,
            JSON.stringify({ source: "assistant-composer" }),
          )
          .run();
      } catch (error) {
        if (isMissingAssistantAttachmentsTableError(error)) {
          return c.json(
            {
              ok: false,
              error:
                "Assistant attachment storage is not migrated yet. Restart the local Worker or run pnpm --filter @me3-core/worker db:migrate:local.",
            },
            503,
          );
        }
        throw error;
      }

      uploaded.push({
        id,
        name: filename,
        filename,
        mimeType,
        size: file.size,
        kind,
        status: "ready",
        storageKey,
        hasText: Boolean(extractedText),
        text: extractedText,
        textTruncated: Boolean(textTruncated),
        createdAt: new Date().toISOString(),
      });
    }

    return c.json({ ok: true, attachments: uploaded }, 201);
  });

  app.get("/api/assistant/attachments/:attachmentId/content", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const attachmentId = normalizeAssistantAttachmentId(c.req.param("attachmentId"));
    if (!attachmentId) return c.json({ ok: false, error: "Attachment id is required" }, 400);

    const row = await c.env.DB.prepare(
      `SELECT id, filename, mime_type, kind, status, storage_key
       FROM assistant_attachments
       WHERE id = ? AND owner_id = ?
       LIMIT 1`,
    )
      .bind(attachmentId, ownerId)
      .first<AssistantAttachmentContentRow>();
    if (
      !row ||
      row.kind !== "image" ||
      row.status !== "ready" ||
      !row.storage_key
    ) {
      return c.json({ ok: false, error: "Assistant image not found" }, 404);
    }
    if (!c.env.SITE_ASSETS) {
      return c.json({ ok: false, error: "Assistant image storage is not configured" }, 503);
    }

    const object = await c.env.SITE_ASSETS.get(row.storage_key);
    if (!object) return c.json({ ok: false, error: "Assistant image not found" }, 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", headers.get("Content-Type") || row.mime_type);
    headers.set("Cache-Control", "private, max-age=300");
    headers.set(
      "Content-Disposition",
      `inline; filename="${sanitizeContentDispositionFilename(row.filename)}"`,
    );
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  });

  app.get("/api/assistant/settings", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    return c.json(await getAssistantSettings(c.env, ownerId));
  });

  app.put("/api/assistant/settings", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(body, "assistantName")) {
      return c.json({ ok: false, error: "Assistant name is required" }, 400);
    }

    const assistantName = normalizeAssistantNameInput(body.assistantName);
    if (assistantName && typeof assistantName === "object") {
      return c.json({ ok: false, error: assistantName.error }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE owner_profile
       SET assistant_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(assistantName, ownerId)
      .run();

    return c.json(await getAssistantSettings(c.env, ownerId));
  });

  registerAssistantSkillsRoutes(app, { requireOwner, unauthorized });
  registerNewAgentRoutes(app, { requireOwner, unauthorized });

  function parseAssistantChatTurnModelSelection(
    value: unknown,
  ): AssistantChatTurnModelSelection | null | { error: string } {
    if (value === undefined || value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "model must be an object" };
    }

    const input = value as Record<string, unknown>;
    const providerId = input.providerId;
    const model = typeof input.model === "string" ? input.model.trim() : "";
    const optionId =
      typeof input.optionId === "string" && input.optionId.trim()
        ? input.optionId.trim()
        : null;

    if (
      providerId !== "workers-ai" &&
      providerId !== "openai" &&
      providerId !== "anthropic"
    ) {
      return { error: "model.providerId is not supported" };
    }

    if (!model || model.length > 160) {
      return { error: "model.model is required" };
    }

    return { providerId, model, optionId };
  }

  function parseAssistantChatMode(
    value: unknown,
  ): AgentChatMode | { error: string } {
    if (value === undefined || value === null) return "everyday";
    if (
      typeof value === "string" &&
      AGENT_CHAT_MODES.includes(value as AgentChatMode)
    ) {
      return value as AgentChatMode;
    }
    return { error: "mode must be everyday, advanced, or owner" };
  }

  function managedAssistantModelOverrideError(
    env: Env,
    mode: AgentChatMode,
    model: unknown,
  ): string | null {
    if (
      model === undefined ||
      model === null ||
      mode === "owner" ||
      allowsAgentChatRawModelSelection(env)
    ) {
      return null;
    }
    return "Raw model overrides are not allowed for managed everyday or advanced modes";
  }

  function serializeAssistantThread(row: AssistantThreadRow) {
    return {
      id: row.id,
      title: row.title,
      originSurface: row.origin_surface,
      projectId: row.project_id,
      status: row.status,
      pinnedAt: row.pinned_at,
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function serializeAssistantMessage(row: AssistantMessageRow) {
    const metadata = parseAssistantMessageMetadata(row.metadata_json);
    return {
      id: row.id,
      role: row.role,
      text: row.content,
      createdAt: row.created_at,
      actionCards: metadata.actionCards.length ? metadata.actionCards : undefined,
      siteAction: metadata.siteAction || undefined,
      imageAction: metadata.imageAction || undefined,
      targetPresentation: metadata.targetPresentation || undefined,
      allowanceNotice: metadata.allowanceNotice || undefined,
      emailDraft: metadata.emailDraft || undefined,
      attachments: metadata.attachments.length ? metadata.attachments : undefined,
    };
  }

  async function serializePrivateAssistantMessage(env: Env, ownerId: string, threadId: string, row: AssistantMessageRow) {
    const message = serializeAssistantMessage(row);
    if (!message.imageAction && !message.targetPresentation) return message;
    let metadata: Record<string, unknown>;
    try { metadata = JSON.parse(row.metadata_json || "{}"); } catch { return message; }
    if (metadata.runtime !== "agent" && metadata.specialist !== "core.agent") { const { targetPresentation: _untrusted, ...rest } = message; return rest; }
    const turnId = metadata.turnId;
    const { imageAction: _savedAction, targetPresentation: _savedTarget, ...rest } = message;
    if (typeof turnId !== "string" || !row.id.startsWith(`${turnId}:assistant:`)) return rest;
    return revalidateAgentTargetPayload(env, { ownerId, threadId, turnId }, await revalidateAgentImagePayload(env, { ownerId, threadId, turnId }, message));
  }

  function parseAssistantMessageMetadata(metadataJson: string | null | undefined): {
    actionCards: AgentChatActionCard[];
    targetPresentation: AgentTargetPresentationCard | null;
    imageAction: AgentChatImageAction | null;
    siteAction: Record<string, unknown> | null;
    allowanceNotice: ManagedAllowanceNotice | null;
    emailDraft: AgentEmailDraft | null;
    attachments: AssistantAttachmentAuditManifestItem[];
  } {
    if (!metadataJson)
      return { actionCards: [], targetPresentation: null, imageAction: null, siteAction: null, allowanceNotice: null, emailDraft: null, attachments: [] };
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { actionCards: [], targetPresentation: null, imageAction: null, siteAction: null, allowanceNotice: null, emailDraft: null, attachments: [] };
      }
      const metadata = parsed as Record<string, unknown>;
      const cards = metadata.actionCards;
      const imageAction = metadata.imageAction;
      const siteAction = metadata.siteAction;
      const attachments = metadata.attachments;
      return {
        actionCards: Array.isArray(cards) ? (cards as AgentChatActionCard[]) : [],
        targetPresentation: metadata.targetPresentation && typeof metadata.targetPresentation === "object" && !Array.isArray(metadata.targetPresentation) ? metadata.targetPresentation as AgentTargetPresentationCard : null,
        imageAction:
          imageAction && typeof imageAction === "object" && !Array.isArray(imageAction)
            ? (imageAction as AgentChatImageAction)
            : null,
        siteAction:
          siteAction && typeof siteAction === "object" && !Array.isArray(siteAction)
            ? (siteAction as Record<string, unknown>)
            : null,
        // Only the agent runtime authors allowance notices.
        allowanceNotice: metadata.runtime === "agent" ? readManagedAllowanceNotice(metadata.allowanceNotice) : null,
        emailDraft: metadata.runtime === "agent" ? readAgentEmailDraft(metadata.emailDraft) : null,
        attachments: createAssistantAttachmentAuditManifest(attachments),
      };
    } catch {
      return { actionCards: [], targetPresentation: null, imageAction: null, siteAction: null, allowanceNotice: null, emailDraft: null, attachments: [] };
    }
  }

  function normalizeAssistantThreadId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 160) return null;
    return trimmed;
  }

  function resolveAssistantRequestId(
    value: unknown,
  ): { requestId: string } | { error: string } {
    if (value === undefined || value === null) {
      return { requestId: crypto.randomUUID() };
    }
    if (typeof value !== "string") {
      return { error: "Request id must be a string" };
    }
    const requestId = value.trim();
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(requestId)) {
      return { error: "Request id must be 1-128 safe characters" };
    }
    return { requestId };
  }

  function assistantThreadTitleFromMessage(messageText: string) {
    const title = messageText.replace(/\s+/g, " ").trim();
    if (!title) return "New chat";
    return title.length > 80 ? `${title.slice(0, 77).trimEnd()}...` : title;
  }

  async function getAssistantThread(
    env: Env,
    ownerId: string,
    threadId: string,
  ): Promise<AssistantThreadRow | null> {
    return env.DB.prepare(
      `SELECT id, owner_id, title, origin_surface, project_id, status, pinned_at,
              archived_at, deleted_at, last_message_at, created_at, updated_at
       FROM assistant_threads
       WHERE id = ? AND owner_id = ? AND status != 'deleted'
       LIMIT 1`,
    )
      .bind(threadId, ownerId)
      .first<AssistantThreadRow>();
  }

  async function createAssistantThread(
    env: Env,
    ownerId: string,
    messageText: string,
    projectId: string | null,
  ): Promise<AssistantThreadRow> {
    const id = crypto.randomUUID();
    const title = assistantThreadTitleFromMessage(messageText);
    await env.DB.prepare(
      `INSERT INTO assistant_threads
         (id, owner_id, title, origin_surface, project_id, status, last_message_at)
       VALUES (?, ?, ?, 'assistant', ?, 'active', CURRENT_TIMESTAMP)`,
    )
      .bind(id, ownerId, title, projectId)
      .run();

    const thread = await getAssistantThread(env, ownerId, id);
    return (
      thread || {
        id,
        owner_id: ownerId,
        title,
        origin_surface: "assistant",
        project_id: projectId,
        status: "active",
        pinned_at: null,
        archived_at: null,
        deleted_at: null,
        last_message_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );
  }

  async function resolveAssistantThreadForTurn(
    env: Env,
    ownerId: string,
    threadId: string | null,
    messageText: string,
    projectId: string | null,
  ): Promise<AssistantThreadRow | null | { error: string; status: 400 | 404 }> {
    if (!threadId) {
      if (projectId && !(await assistantProjectExists(env, ownerId, projectId))) {
        return { error: "Project not found", status: 404 };
      }
      return createAssistantThread(env, ownerId, messageText, projectId);
    }
    const thread = await getAssistantThread(env, ownerId, threadId);
    if (!thread) return { error: "Assistant thread not found", status: 404 };
    if (thread.status !== "active") {
      return { error: "Assistant thread is not active", status: 400 };
    }
    return thread;
  }

  async function assistantProjectExists(env: Env, ownerId: string, projectId: string) {
    const row = await env.DB.prepare(
      `SELECT id
       FROM mission_projects
       WHERE id = ? AND user_id = ? AND status != 'archived'
       LIMIT 1`,
    )
      .bind(projectId, ownerId)
      .first<{ id: string }>();
    return Boolean(row);
  }

  app.get("/api/assistant/threads", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const statusParam = c.req.query("status");
    const status =
      statusParam === "archived" || statusParam === "deleted" ? statusParam : "active";
    const projectIdParam = c.req.query("projectId");
    const normalizedProjectId = normalizeNullableText(projectIdParam);
    const projectFilter =
      projectIdParam === "none" || projectIdParam === "ungrouped"
        ? "none"
        : normalizedProjectId;
    const search = normalizeNullableText(c.req.query("q"));
    const limit = Math.min(
      Math.max(Number.parseInt(c.req.query("limit") || "40", 10) || 40, 1),
      100,
    );
    const where = ["owner_id = ?", "status = ?"];
    const bindings: unknown[] = [ownerId, status];
    if (projectFilter === "none") {
      where.push("project_id IS NULL");
    } else if (projectFilter) {
      where.push("project_id = ?");
      bindings.push(projectFilter);
    }
    if (search) {
      const pattern = `%${escapeSqlLikePattern(search)}%`;
      where.push(
        `(title LIKE ? ESCAPE '\\' OR EXISTS (
          SELECT 1
          FROM assistant_messages
          WHERE assistant_messages.thread_id = assistant_threads.id
            AND assistant_messages.owner_id = assistant_threads.owner_id
            AND assistant_messages.role IN ('user', 'assistant')
            AND assistant_messages.content LIKE ? ESCAPE '\\'
        ))`,
      );
      bindings.push(pattern, pattern);
    }
    bindings.push(limit);

    const rows = await c.env.DB.prepare(
      `SELECT id, owner_id, title, origin_surface, project_id, status, pinned_at,
              archived_at, deleted_at, last_message_at, created_at, updated_at
       FROM assistant_threads
       WHERE ${where.join(" AND ")}
       ORDER BY pinned_at IS NULL, pinned_at DESC,
                last_message_at IS NULL, last_message_at DESC,
                updated_at DESC
       LIMIT ?`,
    )
      .bind(...bindings)
      .all<AssistantThreadRow>();

    return c.json({ threads: (rows.results || []).map(serializeAssistantThread) });
  });

  app.delete("/api/assistant/threads", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    if (c.req.query("status") !== "archived") {
      return c.json({ ok: false, error: "Archived status is required" }, 400);
    }

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM assistant_threads
       WHERE owner_id = ? AND status = 'archived'`,
    )
      .bind(ownerId)
      .first<{ count: number }>();
    const deleted = Number(countRow?.count || 0);

    if (deleted > 0) {
      await c.env.DB.prepare(
        `UPDATE assistant_messages
         SET content = '', metadata_json = '{}'
         WHERE owner_id = ?
           AND thread_id IN (
             SELECT id FROM assistant_threads
             WHERE owner_id = ? AND status = 'archived'
           )`,
      )
        .bind(ownerId, ownerId)
        .run();
      await c.env.DB.prepare(
        `UPDATE assistant_threads
         SET status = 'deleted', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
             archived_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE owner_id = ? AND status = 'archived'`,
      )
        .bind(ownerId)
        .run();
    }

    return c.json({ ok: true, deleted });
  });

  app.post("/api/assistant/threads/primary", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    return c.json({ thread: serializeAssistantThread(await resolvePrimaryAssistantThread(c.env, ownerId)) });
  });

  app.patch("/api/assistant/threads/:threadId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const threadId = normalizeAssistantThreadId(c.req.param("threadId"));
    if (!threadId) return c.json({ ok: false, error: "Thread id is required" }, 400);

    const thread = await getAssistantThread(c.env, ownerId, threadId);
    if (!thread) return c.json({ ok: false, error: "Assistant thread not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const projectId =
      Object.prototype.hasOwnProperty.call(body, "projectId")
        ? normalizeNullableText(body.projectId)
        : thread.project_id;
    if (projectId && !(await assistantProjectExists(c.env, ownerId, projectId))) {
      return c.json({ ok: false, error: "Project not found" }, 404);
    }
    if (projectId && (await getPrimaryAssistantThread(c.env, ownerId))?.id === threadId) {
      return c.json({ ok: false, error: "The main conversation cannot be moved into a project" }, 409);
    }

    let nextStatus = thread.status;
    if (body.status === "active" || body.status === "archived") {
      nextStatus = body.status;
    }
    const pinned =
      Object.prototype.hasOwnProperty.call(body, "pinned") && typeof body.pinned === "boolean"
        ? body.pinned
        : Boolean(thread.pinned_at);
    const title = normalizeNullableText(body.title) || thread.title;

    await c.env.DB.prepare(
      `UPDATE assistant_threads
       SET title = ?, project_id = ?, status = ?,
           pinned_at = CASE WHEN ? THEN COALESCE(pinned_at, CURRENT_TIMESTAMP) ELSE NULL END,
           archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, CURRENT_TIMESTAMP) ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_id = ?`,
    )
      .bind(title, projectId, nextStatus, pinned ? 1 : 0, nextStatus, threadId, ownerId)
      .run();

    const updated = await getAssistantThread(c.env, ownerId, threadId);
    return c.json({ thread: updated ? serializeAssistantThread(updated) : serializeAssistantThread(thread) });
  });

  app.delete("/api/assistant/threads/:threadId", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const threadId = normalizeAssistantThreadId(c.req.param("threadId"));
    if (!threadId) return c.json({ ok: false, error: "Thread id is required" }, 400);

    const thread = await getAssistantThread(c.env, ownerId, threadId);
    if (!thread) return c.json({ ok: false, error: "Assistant thread not found" }, 404);

    await c.env.DB.prepare(
      `UPDATE assistant_threads
       SET status = 'deleted', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
           archived_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_id = ?`,
    )
      .bind(threadId, ownerId)
      .run();
    await c.env.DB.prepare(
      `UPDATE assistant_messages
       SET content = '', metadata_json = '{}'
       WHERE owner_id = ? AND thread_id = ?`,
    )
      .bind(ownerId, threadId)
      .run();

    return c.json({ ok: true });
  });

  app.get("/api/assistant/threads/:threadId/export", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const threadId = normalizeAssistantThreadId(c.req.param("threadId"));
    if (!threadId) return c.json({ ok: false, error: "Thread id is required" }, 400);

    const thread = await getAssistantThread(c.env, ownerId, threadId);
    if (!thread || thread.status === "deleted") {
      return c.json({ ok: false, error: "Assistant thread not found" }, 404);
    }

    const rows = await c.env.DB.prepare(
      `SELECT id, role, content, created_at, metadata_json
       FROM assistant_messages
       WHERE owner_id = ? AND thread_id = ? AND role IN ('user', 'assistant')
       ORDER BY created_at ASC`,
    )
      .bind(ownerId, threadId)
      .all<AssistantMessageRow>();

    return c.json({
      thread: serializeAssistantThread(thread),
      messages: await Promise.all((rows.results || []).map(row => serializePrivateAssistantMessage(c.env, ownerId, threadId, row))),
      exportedAt: new Date().toISOString(),
    });
  });

  app.get("/api/assistant/threads/:threadId/messages", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const threadId = normalizeAssistantThreadId(c.req.param("threadId"));
    if (!threadId) return c.json({ ok: false, error: "Thread id is required" }, 400);

    const thread = await getAssistantThread(c.env, ownerId, threadId);
    if (!thread) return c.json({ ok: false, error: "Assistant thread not found" }, 404);

    const rows = await c.env.DB.prepare(
      `SELECT id, role, content, created_at, metadata_json
       FROM assistant_messages
       WHERE owner_id = ? AND thread_id = ? AND role IN ('user', 'assistant')
       ORDER BY created_at ASC`,
    )
      .bind(ownerId, threadId)
      .all<AssistantMessageRow>();

    return c.json({
      thread: serializeAssistantThread(thread),
      messages: await Promise.all((rows.results || []).map(row => serializePrivateAssistantMessage(c.env, ownerId, threadId, row))),
    });
  });

  async function handleAssistantChatTurn(c: Context<{ Bindings: Env }>, suppliedBody?: AssistantChatTurnBody) {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    if (!(await isCorePluginEnabled(c.env, "me3.agent-chat"))) {
      return c.json(
        { ok: false, error: "Agent Chat plugin is disabled" },
        403,
      );
    }

    const runtime = assistantRuntimeNamespace(c.env);
    if (!runtime) return c.json({ ok: false, error: "Agent runtime is unavailable" }, 503);

    const body = suppliedBody ?? await c.req
      .json<AssistantChatTurnBody>()
      .catch((): AssistantChatTurnBody => ({}));
    const displayMessageText =
      typeof body.messageText === "string" ? body.messageText.trim() : "";
    if (!displayMessageText) {
      return c.json({ ok: false, error: "Message text is required" }, 400);
    }
    const mode = parseAssistantChatMode(body.mode);
    if (typeof mode !== "string") {
      return c.json({ ok: false, error: mode.error }, 400);
    }
    const modelOverrideError = managedAssistantModelOverrideError(c.env, mode, body.model);
    if (modelOverrideError) {
      return c.json({ ok: false, error: modelOverrideError }, 400);
    }
    const request = resolveAssistantRequestId(body.requestId);
    if ("error" in request) {
      return c.json({ ok: false, error: request.error }, 400);
    }
    const requestId = request.requestId;
    let targetSelection;
    try { targetSelection = parseAgentTargetSelection(body.targetSelection); }
    catch { return c.json({ ok: false, error: "Invalid target selection" }, 400); }
    if (targetSelection) {
      if (!normalizeAssistantThreadId(body.threadId)) return c.json({ ok: false, error: "Target selection requires an explicit agent conversation" }, 400);
      try { await preflightAgentTargetSelection(c.env, { userId: ownerId, threadId: normalizeAssistantThreadId(body.threadId)!, requestId, messageText: displayMessageText }, targetSelection); }
      catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : "Target selection is unavailable" }, 409); }
    }
    const messageText = displayMessageText;
    const selectedModel = parseAssistantChatTurnModelSelection(body.model);
    if (selectedModel && "error" in selectedModel) {
      return c.json({ ok: false, error: selectedModel.error }, 400);
    }
    const requestedThreadId = normalizeAssistantThreadId(body.threadId);
    const requestedProjectId = normalizeNullableText(body.projectId);
    const attachmentManifest = createAssistantAttachmentAuditManifest(body.attachments);

    const replyToMessageId =
      typeof body.replyToMessageId === "string" ||
      typeof body.replyToMessageId === "number"
        ? body.replyToMessageId
        : null;
    const thread = await resolveAssistantThreadForTurn(
      c.env,
      ownerId,
      requestedThreadId,
      messageText,
      requestedProjectId,
    );
    if (!thread) {
      return c.json({ ok: false, error: "Assistant thread is required" }, 500);
    }
    if ("error" in thread) {
      return c.json({ ok: false, error: thread.error }, thread.status);
    }

    const attachmentTextContext = await loadAssistantAttachmentTextContext(
      c.env,
      ownerId,
      attachmentManifest,
    );

    const turn = await createAgentSandboxTurnRecord(c.env, {
      userId: ownerId,
      requestId,
      messageText,
      replyToMessageId,
      metadata: {
        surface: "assistant",
        route: c.req.path,
        mode,
        requestId,
        threadId: thread.id,
        requestedThreadId,
        requestedProjectId,
        selectedModel: selectedModel || null,
        attachmentCount: Array.isArray(body.attachments) ? body.attachments.length : 0,
        attachmentManifest,
      },
    });

    const dispatchInput = {
      userId: ownerId,
      requestId,
      connectionId: turn.connection.id,
      sourceEventId: turn.sourceEvent.id,
      turnId: turn.turnId,
      threadId: thread.id,
      messageText: turn.messageText,
      mode,
      replyToMessageId: turn.replyToMessageId,
      selectedModel,
      attachments: attachmentManifest,
      attachmentTextContext,
      ...(targetSelection ? { targetSelection } : {}),
    };
    if (targetSelection) {
      try { await persistAgentTargetSelectionInput(c.env, dispatchInput); }
      catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : "Target selection is unavailable" }, 409); }
    }

    const id = runtime.idFromName(ownerId);
    const stub = runtime.get(id);
    const response = await stub.fetch(
      "https://me3-agent/turn",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dispatchInput),
      },
    );

    const payload = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!response.ok || payload?.ok !== true) {
      return c.json(
        {
          ok: false,
          error:
            typeof payload?.error === "string"
              ? payload.error
              : `Agent chat runtime request failed (${response.status})`,
        },
        503,
      );
    }

    return c.json({ ...payload, mode, threadId: thread.id });
  }

  async function handleAssistantChatTurnStream(c: Context<{ Bindings: Env }>) {
    const handlerStartedAt = performance.now();
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    if (!(await isCorePluginEnabled(c.env, "me3.agent-chat"))) {
      return c.json(
        { ok: false, error: "Agent Chat plugin is disabled" },
        403,
      );
    }

    const runtime = assistantRuntimeNamespace(c.env);
    if (!runtime) return c.json({ ok: false, error: "Agent runtime is unavailable" }, 503);

    const body = await c.req
      .json<AssistantChatTurnBody>()
      .catch((): AssistantChatTurnBody => ({}));
    const displayMessageText =
      typeof body.messageText === "string" ? body.messageText.trim() : "";
    if (!displayMessageText) {
      return c.json({ ok: false, error: "Message text is required" }, 400);
    }
    const mode = parseAssistantChatMode(body.mode);
    if (typeof mode !== "string") {
      return c.json({ ok: false, error: mode.error }, 400);
    }
    const modelOverrideError = managedAssistantModelOverrideError(c.env, mode, body.model);
    if (modelOverrideError) {
      return c.json({ ok: false, error: modelOverrideError }, 400);
    }
    const request = resolveAssistantRequestId(body.requestId);
    if ("error" in request) {
      return c.json({ ok: false, error: request.error }, 400);
    }
    const requestId = request.requestId;
    let targetSelection;
    try { targetSelection = parseAgentTargetSelection(body.targetSelection); }
    catch { return c.json({ ok: false, error: "Invalid target selection" }, 400); }
    if (targetSelection) {
      if (!normalizeAssistantThreadId(body.threadId)) return c.json({ ok: false, error: "Target selection requires an explicit agent conversation" }, 400);
      try { await preflightAgentTargetSelection(c.env, { userId: ownerId, threadId: normalizeAssistantThreadId(body.threadId)!, requestId, messageText: displayMessageText }, targetSelection); }
      catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : "Target selection is unavailable" }, 409); }
    }
    const messageText = displayMessageText;
    const selectedModel = parseAssistantChatTurnModelSelection(body.model);
    if (selectedModel && "error" in selectedModel) {
      return c.json({ ok: false, error: selectedModel.error }, 400);
    }

    const requestedThreadId = normalizeAssistantThreadId(body.threadId);
    const requestedProjectId = normalizeNullableText(body.projectId);
    const replyToMessageId =
      typeof body.replyToMessageId === "string" ||
      typeof body.replyToMessageId === "number"
        ? body.replyToMessageId
        : null;
    const attachmentCount = Array.isArray(body.attachments) ? body.attachments.length : 0;
    const attachmentManifest = createAssistantAttachmentAuditManifest(body.attachments);
    const streamStartedAt = performance.now();
    const routePerformance: AssistantChatRoutePerformance = {
      version: 1,
      handlerPreStreamMs: assistantRouteDurationMs(handlerStartedAt),
      replayLookupMs: null,
      threadResolutionMs: null,
      siteScopeCheckMs: null,
      attachmentContextMs: null,
      turnRecordMs: null,
      durableObjectHeadersMs: null,
      durableObjectStreamMs: null,
      routeToRuntimeDoneMs: null,
    };
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: AssistantChatTurnStreamEvent, data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };
        let auditContext:
          | {
              connectionId: string;
              sourceEventId: string;
              turnId: string;
              threadId: string;
            }
          | null = null;

        try {
          send("status", {
            state: "started",
            serverElapsedMs: assistantRouteDurationMs(handlerStartedAt),
          });
          const threadResolutionStartedAt = performance.now();
          const thread = await resolveAssistantThreadForTurn(
            c.env,
            ownerId,
            requestedThreadId,
            messageText,
            requestedProjectId,
          );
          routePerformance.threadResolutionMs = assistantRouteDurationMs(
            threadResolutionStartedAt,
          );
          if (!thread) {
            send("error", { ok: false, error: "Assistant thread is required" });
            return;
          }
          if ("error" in thread) {
            send("error", { ok: false, error: thread.error, status: thread.status });
            return;
          }

          send("thread", { threadId: thread.id });


          const attachmentContextStartedAt = performance.now();
          const attachmentTextContext = await loadAssistantAttachmentTextContext(
            c.env,
            ownerId,
            attachmentManifest,
          );
          routePerformance.attachmentContextMs = assistantRouteDurationMs(
            attachmentContextStartedAt,
          );

          const turnRecordStartedAt = performance.now();
          const turn = await createAgentSandboxTurnRecord(c.env, {
            userId: ownerId,
            requestId,
            messageText,
            replyToMessageId,
            metadata: {
              surface: "assistant",
              route: c.req.path,
              stream: true,
              mode,
              requestId,
              threadId: thread.id,
              requestedThreadId,
              requestedProjectId,
              selectedModel: selectedModel || null,
              attachmentCount,
              attachmentManifest,
            },
          });
          routePerformance.turnRecordMs = assistantRouteDurationMs(
            turnRecordStartedAt,
          );
          auditContext = {
            connectionId: turn.connection.id,
            sourceEventId: turn.sourceEvent.id,
            turnId: turn.turnId,
            threadId: thread.id,
          };

          const dispatchInput = {
            userId: ownerId,
            requestId,
            connectionId: turn.connection.id,
            sourceEventId: turn.sourceEvent.id,
            turnId: turn.turnId,
            threadId: thread.id,
            messageText: turn.messageText,
            mode,
            replyToMessageId: turn.replyToMessageId,
            selectedModel,
            attachments: attachmentManifest,
            attachmentTextContext,
            ...(targetSelection ? { targetSelection } : {}),
          };
          if (targetSelection) {
            try { await persistAgentTargetSelectionInput(c.env, dispatchInput); }
            catch (error) { send("error", { ok: false, error: error instanceof Error ? error.message : "Target selection is unavailable", status: 409 }); return; }
          }

          const id = runtime.idFromName(ownerId);
          const stub = runtime.get(id);
          const durableObjectHeadersStartedAt = performance.now();
          const response = await stub.fetch(
            "https://me3-agent/turn/stream",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(c.req.header("Last-Event-ID") ? {"Last-Event-ID":c.req.header("Last-Event-ID")!} : {}) },
              body: JSON.stringify(dispatchInput),
            },
          );
          routePerformance.durableObjectHeadersMs = assistantRouteDurationMs(
            durableObjectHeadersStartedAt,
          );

          if (
            response.ok &&
            response.body &&
            response.headers.get("content-type")?.includes("text/event-stream")
          ) {
            const durableObjectStreamStartedAt = performance.now();
            const runtimeStream = await forwardAssistantRuntimeStream(
              response.body,
              controller,
              c.req.raw.signal,
            );
            routePerformance.durableObjectStreamMs = assistantRouteDurationMs(
              durableObjectStreamStartedAt,
            );
            routePerformance.routeToRuntimeDoneMs = assistantRouteDurationMs(
              streamStartedAt,
            );
            const latency = {
              route: routePerformance,
              runtime: runtimeStream.doneData?.performance ?? null,
              stream: runtimeStream.doneData?.streamMetrics ?? null,
            };
            console.info(
              "ME3_ASSISTANT_LATENCY",
              JSON.stringify({
                requestId,
                turnId: turn.turnId,
                threadId: thread.id,
                mode,
                model:
                  typeof runtimeStream.doneData?.model === "string"
                    ? runtimeStream.doneData.model
                    : selectedModel?.model ?? null,
                modelAttempts: Array.isArray(runtimeStream.doneData?.modelAttempts)
                  ? runtimeStream.doneData.modelAttempts
                  : null,
                latency,
              }),
            );
            await insertAssistantChatStreamAuditEvent(c.env, {
              ownerId,
              connectionId: turn.connection.id,
              sourceEventId: turn.sourceEvent.id,
              turnId: turn.turnId,
              threadId: thread.id,
              route: c.req.path,
              outcome: runtimeStream.completed ? "completed" : "failed",
              mode,
              selectedModel: selectedModel || null,
              attachmentCount,
              attachmentManifest,
              performance: latency,
              error: runtimeStream.completed
                ? null
                : "Agent runtime stream ended without a successful done event.",
            });
            return;
          }

          const payload = (await response.json().catch(() => null)) as
            | Record<string, unknown>
            | null;

          if (!response.ok || payload?.ok !== true) {
            await insertAssistantChatStreamAuditEvent(c.env, {
              ownerId,
              connectionId: turn.connection.id,
              sourceEventId: turn.sourceEvent.id,
              turnId: turn.turnId,
              threadId: thread.id,
              route: c.req.path,
              outcome: "failed",
              mode,
              selectedModel: selectedModel || null,
              attachmentCount,
              attachmentManifest,
              error:
                typeof payload?.error === "string"
                  ? payload.error
                  : `Agent chat runtime request failed (${response.status})`,
            });
            send("error", {
              ok: false,
              error:
                typeof payload?.error === "string"
                  ? payload.error
                  : `Agent chat runtime request failed (${response.status})`,
            });
            return;
          }

          const replyText = typeof payload.replyText === "string" ? payload.replyText : "";
          await sendAssistantStreamText(send, replyText);
          await insertAssistantChatStreamAuditEvent(c.env, {
            ownerId,
            connectionId: turn.connection.id,
            sourceEventId: turn.sourceEvent.id,
            turnId: turn.turnId,
            threadId: thread.id,
            route: c.req.path,
            outcome: "completed",
            mode,
            selectedModel: selectedModel || null,
            attachmentCount,
            attachmentManifest,
            error: null,
          });
          send("done", { ...payload, mode, threadId: thread.id });
        } catch (error) {
          if (c.req.raw.signal.aborted) {
            if (auditContext) {
              await insertAssistantChatStreamAuditEvent(c.env, {
                ownerId,
                connectionId: auditContext.connectionId,
                sourceEventId: auditContext.sourceEventId,
                turnId: auditContext.turnId,
                threadId: auditContext.threadId,
                route: c.req.path,
                outcome: "stopped",
                mode,
                selectedModel: selectedModel || null,
                attachmentCount,
                attachmentManifest,
                error: null,
              });
            }
            return;
          }
          if (auditContext) {
            await insertAssistantChatStreamAuditEvent(c.env, {
              ownerId,
              connectionId: auditContext.connectionId,
              sourceEventId: auditContext.sourceEventId,
              turnId: auditContext.turnId,
              threadId: auditContext.threadId,
              route: c.req.path,
              outcome: "failed",
              mode,
              selectedModel: selectedModel || null,
              attachmentCount,
              attachmentManifest,
              error: error instanceof Error ? error.message : "Assistant stream failed",
            });
          }
          send("error", {
            ok: false,
            error: error instanceof Error ? error.message : "Assistant stream failed",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  type AssistantAttachmentAuditManifestItem = {
    id: string | null;
    name: string | null;
    mimeType: string | null;
    size: number | null;
    kind: string | null;
    status: string | null;
    storageKey: string | null;
    hasText: boolean;
    textTruncated: boolean;
  };

  function createAssistantAttachmentAuditManifest(
    attachments: unknown,
  ): AssistantAttachmentAuditManifestItem[] {
    if (!Array.isArray(attachments)) return [];
    return attachments
      .filter((attachment): attachment is Record<string, unknown> =>
        Boolean(attachment && typeof attachment === "object" && !Array.isArray(attachment)),
      )
      .map((attachment) => ({
        id: normalizeAssistantAuditText(attachment.id),
        name: normalizeAssistantAuditText(attachment.name),
        mimeType: normalizeAssistantAuditText(attachment.mimeType),
        size:
          typeof attachment.size === "number" && Number.isFinite(attachment.size)
            ? Math.max(0, Math.round(attachment.size))
            : null,
        kind: normalizeAssistantAuditText(attachment.kind),
        status: normalizeAssistantAuditText(attachment.status),
        storageKey: normalizeAssistantAuditText(attachment.storageKey),
        hasText: Boolean(attachment.hasText),
        textTruncated: Boolean(attachment.textTruncated),
      }));
  }

  async function loadAssistantAttachmentTextContext(
    env: Env,
    ownerId: string,
    attachments: AssistantAttachmentAuditManifestItem[],
  ) {
    const chunks: string[] = [];
    for (const attachment of attachments) {
      if (
        attachment.kind !== "text" ||
        attachment.status !== "ready" ||
        !attachment.id ||
        !attachment.hasText
      ) {
        continue;
      }

      const row = await env.DB.prepare(
        `SELECT id, filename, mime_type, extracted_text, text_truncated
         FROM assistant_attachments
         WHERE id = ? AND owner_id = ? AND kind = 'text' AND status = 'ready'
         LIMIT 1`,
      )
        .bind(attachment.id, ownerId)
        .first<AssistantAttachmentTextContextRow>();
      if (!row?.extracted_text) continue;

      chunks.push(
        [
          `File: ${row.filename || attachment.name || "Attachment"}`,
          `Type: ${row.mime_type || attachment.mimeType || "unknown"}`,
          row.text_truncated ? "Note: extracted text was truncated." : null,
          "Content:",
          row.extracted_text,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    return chunks.length ? `Attached file context:\n\n${chunks.join("\n\n---\n\n")}` : null;
  }

  function classifyAssistantUploadKind(
    filename: string,
    mimeType: string,
  ): "text" | "image" | null {
    const normalizedMime = mimeType.toLowerCase();
    const normalizedName = filename.toLowerCase();
    if (normalizedMime.startsWith("image/") || normalizedName.endsWith(".avif")) {
      return "image";
    }
    if (
      normalizedMime.startsWith("text/") ||
      normalizedMime === "application/json" ||
      normalizedMime === "application/xml" ||
      normalizedMime === "application/csv" ||
      normalizedName.endsWith(".md") ||
      normalizedName.endsWith(".markdown") ||
      normalizedName.endsWith(".csv") ||
      normalizedName.endsWith(".tsv") ||
      normalizedName.endsWith(".json") ||
      normalizedName.endsWith(".txt") ||
      normalizedName.endsWith(".xml")
    ) {
      return "text";
    }
    return null;
  }

  function normalizeAssistantAttachmentMimeType(
    file: Pick<AssistantUploadFile, "type">,
    filename: string,
  ) {
    const explicit = file.type.trim();
    const lower = filename.toLowerCase();
    if (!explicit || explicit === "application/octet-stream") {
      if (lower.endsWith(".avif")) return "image/avif";
    }
    if (explicit) return explicit;
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
    if (lower.endsWith(".csv")) return "text/csv";
    if (lower.endsWith(".tsv")) return "text/tab-separated-values";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".xml")) return "application/xml";
    if (lower.endsWith(".txt")) return "text/plain";
    return "application/octet-stream";
  }

  function formatByteLimit(bytes: number) {
    return formatAssistantByteLimit(bytes);
  }

  function isMissingAssistantAttachmentsTableError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    return (
      /assistant_attachments/i.test(message) &&
      /no such table|not found|no such object/i.test(message)
    );
  }

  function normalizeAssistantAuditText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized || null;
  }

  async function insertAssistantChatStreamAuditEvent(
    env: Env,
    input: {
      ownerId: string;
      connectionId: string;
      sourceEventId: string;
      turnId: string;
      threadId: string;
      route: string;
      outcome: "completed" | "failed" | "stopped";
      mode: AgentChatMode;
      selectedModel: ReturnType<typeof parseAssistantChatTurnModelSelection> | null;
      attachmentCount: number;
      attachmentManifest: AssistantAttachmentAuditManifestItem[];
      performance?: Record<string, unknown> | null;
      error: string | null;
    },
  ) {
    try {
      await insertProviderChannelEvent(env, {
        channel: "sandbox",
        connectionId: input.connectionId,
        direction: "system",
        eventType: "message",
        status:
          input.outcome === "completed"
            ? "sent"
            : input.outcome === "stopped"
              ? "skipped"
              : "failed",
        providerEventId: `${input.sourceEventId}:stream:${input.outcome}`,
        providerMessageId: null,
        replyToMessageId: null,
        textBody: null,
        rawJson: {
          runtime: "sandbox",
          surface: "assistant",
          route: input.route,
          stream: true,
          streamOutcome: input.outcome,
          mode: input.mode,
          turnId: input.turnId,
          threadId: input.threadId,
          ownerId: input.ownerId,
          sourceEventId: input.sourceEventId,
          selectedModel: input.selectedModel,
          attachmentCount: input.attachmentCount,
          attachmentManifest: input.attachmentManifest,
          performance: input.performance ?? null,
        },
        errorMessage: input.error,
      });
    } catch {
      // Stream outcome audit should not break the user-visible chat response.
    }
  }

  async function forwardAssistantRuntimeStream(
    stream: ReadableStream<Uint8Array>,
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal,
  ): Promise<{
    completed: boolean;
    doneData: Record<string, unknown> | null;
  }> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const abort = () => void reader.cancel("aborted");
    signal.addEventListener("abort", abort, { once: true });
    let buffer = "";
    let sawDone = false;
    let sawError = false;
    let doneData: Record<string, unknown> | null = null;
    try {
      while (true) {
        if (signal.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const chunk = await reader.read();
        if (chunk.done) break;
        controller.enqueue(chunk.value);
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const eventIsDone = /(?:^|\n)event:\s*done\s*$/m.test(event);
          sawDone ||= eventIsDone;
          sawError ||= /(?:^|\n)event:\s*error\s*$/m.test(event);
          if (eventIsDone) {
            doneData = parseAssistantStreamEventData(event);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      buffer += decoder.decode();
      const finalEventIsDone = /(?:^|\n)event:\s*done\s*$/m.test(buffer);
      sawDone ||= finalEventIsDone;
      sawError ||= /(?:^|\n)event:\s*error\s*$/m.test(buffer);
      if (finalEventIsDone) {
        doneData = parseAssistantStreamEventData(buffer);
      }
      return { completed: sawDone && !sawError, doneData };
    } finally {
      signal.removeEventListener("abort", abort);
      reader.releaseLock();
    }
  }

  function parseAssistantStreamEventData(
    rawEvent: string,
  ): Record<string, unknown> | null {
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  function sendAssistantStreamText(
    send: AssistantChatTurnStreamSend,
    text: string,
  ) {
    send("delta", { text: text || "" });
  }

  function assistantRouteDurationMs(startedAt: number): number {
    return Number((performance.now() - startedAt).toFixed(2));
  }

  app.post("/api/assistant/chat/turn", c => handleAssistantChatTurn(c));
  app.post("/api/assistant/chat/turn/stream", handleAssistantChatTurnStream);
  app.post("/api/agent/sandbox", c => handleAssistantChatTurn(c));

  app.post("/api/agent/channels/soulink/dispatch", async (c) => {
    if (!(await isCorePluginEnabled(c.env, "me3.agent-chat"))) {
      return c.json({ ok: false, error: "Agent Chat plugin is disabled" }, 403);
    }

    const body = await c.req.json<SoulinkDispatchBody>().catch((): SoulinkDispatchBody => ({}));
    const sourceEventId = typeof body.sourceEventId === "string" ? body.sourceEventId.trim() : "";
    const streamChannelId = typeof body.streamChannelId === "string" ? body.streamChannelId.trim() : "";
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const replyToMessageId =
      typeof body.replyToMessageId === "string" || typeof body.replyToMessageId === "number"
        ? body.replyToMessageId
        : null;

    if (!sourceEventId) return c.json({ ok: false, error: "sourceEventId is required" }, 400);
    if (!streamChannelId) return c.json({ ok: false, error: "streamChannelId is required" }, 400);
    if (!conversationId) return c.json({ ok: false, error: "conversationId is required" }, 400);
    if (conversationId !== streamChannelId) {
      return c.json({ ok: false, error: "conversationId must match streamChannelId" }, 400);
    }

    const connection = await getActiveSoulinkConnectionForThread(c.env, streamChannelId);
    if (!connection) {
      return c.json({ ok: false, error: "Soulink is not connected to this ME3 installation" }, 404);
    }

    const authResult = verifySoulinkDispatchAuth(connection, c.req.header("authorization"));
    if (!authResult.ok) {
      return c.json({ ok: false, error: authResult.error }, authResult.status as any);
    }

    let turnInput: SoulinkTurnInput;
    try {
      turnInput = parseSoulinkTurnInput(body.input, body.messageText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Soulink message input is invalid";
      const status = error instanceof SoulinkTurnInputError ? error.status : 400;
      return c.json({ ok: false, error: message }, status as any);
    }

    const claimed = await claimAgentChannelInboundEvent(c.env, {
      channel: "soulink",
      connectionId: connection.id,
      direction: "inbound",
      eventType: "message",
      status: "received",
      providerEventId: sourceEventId,
      providerMessageId: sourceEventId,
      replyToMessageId,
      textBody: soulinkTurnClaimText(turnInput),
      rawJson: { soulink: body },
      errorMessage: null,
    });
    if (!claimed.created) {
      const replay = await getAgentChannelDispatchReplay(c.env, connection.id, sourceEventId);
      if (replay) {
        return c.json({
          ...replay,
          deduped: true,
          streamChannelType: connection.provider_connection_id || "messaging",
          streamChannelId,
        });
      }
      if (!claimed.event || !canRetryAgentChannelInboundEvent(claimed.event)) {
        return c.json({
          ok: true,
          deduped: true,
          pending: true,
          auditId: null,
          turnId: null,
          specialist: "core.agent-chat",
          replyText: null,
          model: null,
          source: null,
        });
      }
    }

    await c.env.DB.prepare(
      `UPDATE agent_channel_connections
       SET last_inbound_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(connection.id)
      .run();

    const turnId = crypto.randomUUID();
    await updateAgentChannelInboundDispatchStatus(c.env, claimed.id, "pending", null);
    let resolution = readStoredSoulinkTurnResolution(claimed.event, turnInput);
    if (!resolution) {
      try {
        resolution = await resolveSoulinkTurnInput(c.env, connection.user_id, turnInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Soulink message input failed";
        const status = error instanceof SoulinkTurnInputError ? error.status : 503;
        await updateAgentChannelInboundDispatchStatus(c.env, claimed.id, "failed", message);
        return c.json({ ok: false, error: message }, status as any);
      }
      await updateAgentChannelInboundContent(c.env, claimed.id, resolution.messageText, {
        soulink: body,
        me3Resolution: resolution,
      });
    }
    const messageText = resolution.messageText;
    let threadId: string;
    try {
      threadId = (await resolvePrimaryAssistantThread(c.env, connection.user_id)).id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The main conversation could not be prepared";
      await updateAgentChannelInboundDispatchStatus(c.env, claimed.id, "failed", message);
      return c.json({ ok: false, error: message }, 503);
    }

    const response = await dispatchAgentChannelTurn(c.env, {
      userId: connection.user_id,
      connectionId: connection.id,
      sourceEventId: claimed.id,
      turnId,
      threadId,
      messageText,
      attachmentTextContext:
        resolution.kind === "voice"
          ? "ME3 channel context: This turn arrived as a voice note. ME3 successfully processed and transcribed the audio before agent dispatch. Treat the user text as the voice-note transcript."
          : null,
      replyToMessageId,
    });

    if (!response.ok) {
      await updateAgentChannelInboundDispatchStatus(
        c.env,
        claimed.id,
        "failed",
        response.error || "Agent dispatch failed",
      );
      await insertProviderChannelEventOnce(c.env, {
        channel: "soulink",
        connectionId: connection.id,
        direction: "system",
        eventType: "error",
        status: "failed",
        providerEventId: `${sourceEventId}:dispatch-error`,
        providerMessageId: null,
        replyToMessageId,
        textBody: messageText,
        rawJson: response,
        errorMessage: response.error || "Agent dispatch failed",
      });
      return c.json(response, 503 as any);
    }

    if (!response.replyText) {
      const failedResponse = {
        ...response,
        ok: false as const,
        error: "Agent chat runtime completed without a reply",
      };
      await updateAgentChannelInboundDispatchStatus(
        c.env,
        claimed.id,
        "failed",
        failedResponse.error,
      );
      await insertProviderChannelEventOnce(c.env, {
        channel: "soulink",
        connectionId: connection.id,
        direction: "system",
        eventType: "error",
        status: "failed",
        providerEventId: `${sourceEventId}:dispatch-error`,
        providerMessageId: null,
        replyToMessageId,
        textBody: messageText,
        rawJson: failedResponse,
        errorMessage: failedResponse.error,
      });
      return c.json(failedResponse, 503 as any);
    }

    await insertProviderChannelEvent(c.env, {
        channel: "soulink",
        connectionId: connection.id,
        direction: "outbound",
        eventType: "send",
        status: "pending",
        providerEventId: `${sourceEventId}:reply`,
        providerMessageId: null,
        replyToMessageId,
        textBody: response.replyText,
        rawJson: response,
        errorMessage: null,
    });
    await updateAgentChannelInboundDispatchStatus(c.env, claimed.id, "received", null);
    await c.env.DB.prepare(
        `UPDATE agent_channel_connections
         SET last_outbound_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(connection.id)
      .run();

    return c.json({
      ...response,
      streamChannelType: connection.provider_connection_id || "messaging",
      streamChannelId,
    });
  });

  app.post("/api/agent/channels/soulink/delivery", async (c) => {
    const body = await c.req.json<SoulinkDeliveryBody>().catch((): SoulinkDeliveryBody => ({}));
    const sourceEventId = typeof body.sourceEventId === "string" ? body.sourceEventId.trim() : "";
    const streamChannelId = typeof body.streamChannelId === "string" ? body.streamChannelId.trim() : "";
    const providerMessageId =
      typeof body.providerMessageId === "string" ? body.providerMessageId.trim() : "";
    const status = body.status === "sent" || body.status === "failed" ? body.status : null;
    const errorMessage = typeof body.errorMessage === "string" ? body.errorMessage.trim() || null : null;
    if (!sourceEventId || !streamChannelId || !providerMessageId || !status) {
      return c.json({ ok: false, error: "Invalid Soulink delivery acknowledgement" }, 400);
    }

    const connection = await getActiveSoulinkConnectionForThread(c.env, streamChannelId);
    if (!connection) {
      return c.json({ ok: false, error: "Soulink is not connected to this ME3 installation" }, 404);
    }
    const authResult = verifySoulinkDispatchAuth(connection, c.req.header("authorization"));
    if (!authResult.ok) {
      return c.json({ ok: false, error: authResult.error }, authResult.status as any);
    }

    const result = await acknowledgeAgentChannelDelivery(c.env, {
      connectionId: connection.id,
      sourceEventId,
      providerMessageId,
      status,
      errorMessage,
    });
    if (!result.found) return c.json({ ok: false, error: "Assistant reply was not found" }, 404);
    if (!result.ok) return c.json({ ok: false, error: "Assistant delivery identity conflict" }, 409);
    return c.json({ ok: true, deduped: result.deduped });
  });
}

function escapeSqlLikePattern(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "\\" || character === "%" || character === "_") {
      escaped += "\\";
    }
    escaped += character;
  }
  return escaped;
}

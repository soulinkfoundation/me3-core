import { getSiteImageMetadata } from "../site-images";
import { type Context } from "hono";
import {
  createAssistantJobBuilderAction,
  type AssistantJobBuilderAction,
} from "../assistant-jobs";
import { registerAssistantJobsRoutes } from "./assistant-jobs";
import { registerAssistantSkillsRoutes } from "./assistant-skills";
import {
  generateAiText,
  type AiTextGenerationResult,
  type AiTextMessage,
} from "../ai-providers";
import {
  AGENT_CHAT_MODES,
  allowsAgentChatRawModelSelection,
  createAgentSandboxTurnRecord,
  getAgentSandboxTurnResult,
  type AgentChatMode,
  type AgentChatActionCard,
  type AgentChatImageAction,
} from "../agent-chat";
import {
  assistantScopesIncludeSite,
  parseAssistantScopes,
  type AssistantScope,
  type AssistantScopeParseResult,
} from "../assistant-scopes";
import {
  acknowledgeAgentChannelDelivery,
  canRetryAgentChannelInboundEvent,
  claimAgentChannelInboundEvent,
  dispatchAgentChannelTurn,
  ensureAgentChannelAssistantThread,
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
import { generateSiteHtml, type Me3SiteProfile } from "@me3-core/site-renderer";
import { buildPublicMe3Profile } from "../public-me-profile";
import { getProfileCommercePublishBlockReason } from "../commerce-readiness";
import {
  createEmptyPublishManifest,
  deleteSiteFile,
  getContentType,
  getCoreWebOrigin,
  getGeneratedSiteContentType,
  getMe3CloudUsernamePublishBlockReason,
  getOwnerProfile,
  getPublicSiteOrigin,
  getPublishedSiteBaseUrl,
  getSiteFileText,
  loadPublishManifest,
  loadSiteSourceFiles,
  normalizeNullableText,
  normalizeSiteFileName,
  normalizeUsername,
  parseSiteProfile,
  pruneGeneratedPublicFiles,
  pruneUnreferencedSiteSourceFiles,
  putSiteFile,
  savePublishManifest,
  sha256Text,
  shouldIgnoreSiteSourceFile,
  titleFromSlug,
} from "../sites";
import {
  VoiceDictationInputError,
  transcribeVoiceDictation,
} from "../voice-dictation";
import type { AppContext, AppHono } from "../http/types";
import type { DbSite, Env } from "../types";

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
  jobBuilderCheckMs: number | null;
  siteScopeCheckMs: number | null;
  attachmentContextMs: number | null;
  turnRecordMs: number | null;
  durableObjectHeadersMs: number | null;
  durableObjectStreamMs: number | null;
  routeToRuntimeDoneMs: number | null;
};
type AssistantThreadRow = {
  id: string;
  owner_id: string;
  title: string;
  origin_surface: "assistant" | "launcher" | "soulink" | "job" | "system";
  project_id: string | null;
  status: "active" | "archived" | "deleted";
  pinned_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
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

function assistantSiteToolsEnabled(env: Env): boolean {
  // ponytail: launch kill switch; delete site tool routing after the assistant stabilizes.
  return /^(1|true|yes)$/i.test(String(env.ME3_ASSISTANT_SITE_TOOLS_ENABLED || "").trim());
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
    if (!ownerId) {
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }

    const body = await c.req.json<ChatBody>().catch((): ChatBody => ({}));
    const message = body.message?.trim();

    if (!message) {
      return c.json({ ok: false, error: "Message is required" }, 400);
    }

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO assistant_messages (id, owner_id, role, content) VALUES (?, ?, ?, ?)",
    )
      .bind(id, ownerId, "user", message)
      .run();

    return c.json({
      ok: true,
      reply: "The ME3 assistant is ready. Model execution will be wired in the first bootable slice.",
      setupRequired: await getSetupRequired(c.env, ownerId),
    });
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
  registerAssistantJobsRoutes(app, { requireOwner, unauthorized });

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
      attachments: metadata.attachments.length ? metadata.attachments : undefined,
    };
  }

  function parseAssistantMessageMetadata(metadataJson: string | null | undefined): {
    actionCards: AgentChatActionCard[];
    imageAction: AgentChatImageAction | null;
    siteAction: AssistantSiteToolAction["siteAction"] | null;
    attachments: AssistantAttachmentAuditManifestItem[];
  } {
    if (!metadataJson)
      return { actionCards: [], imageAction: null, siteAction: null, attachments: [] };
    try {
      const parsed = JSON.parse(metadataJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { actionCards: [], imageAction: null, siteAction: null, attachments: [] };
      }
      const metadata = parsed as Record<string, unknown>;
      const cards = metadata.actionCards;
      const imageAction = metadata.imageAction;
      const siteAction = metadata.siteAction;
      const attachments = metadata.attachments;
      return {
        actionCards: Array.isArray(cards) ? (cards as AgentChatActionCard[]) : [],
        imageAction:
          imageAction && typeof imageAction === "object" && !Array.isArray(imageAction)
            ? (imageAction as AgentChatImageAction)
            : null,
        siteAction:
          siteAction && typeof siteAction === "object" && !Array.isArray(siteAction)
            ? (siteAction as AssistantSiteToolAction["siteAction"])
            : null,
        attachments: createAssistantAttachmentAuditManifest(attachments),
      };
    } catch {
      return { actionCards: [], imageAction: null, siteAction: null, attachments: [] };
    }
  }

  function assistantJobBuilderReplyText(action: AssistantJobBuilderAction) {
    if (action.kind === "job_saved") {
      return action.summary;
    }
    if (action.kind === "job_unsupported") {
      return action.summary;
    }

    const setupText = action.validation.status === "needs_setup"
      ? " It needs setup before it can activate."
      : action.validation.status === "valid"
        ? " You can save and activate it when ready."
        : "";
    return `Here is a draft job.${setupText}`;
  }

  async function persistAssistantTurnMessages(
    env: Env,
    ownerId: string,
    threadId: string,
    userText: string,
    assistantText: string,
    assistantMetadata: Record<string, unknown> = {},
    userMetadata: Record<string, unknown> | null = null,
  ) {
    try {
      const normalizedUserMetadata =
        userMetadata && Object.keys(userMetadata).length > 0
          ? JSON.stringify(userMetadata)
          : null;
      await env.DB.batch([
        normalizedUserMetadata
          ? env.DB.prepare(
              "INSERT INTO assistant_messages (id, owner_id, role, content, thread_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
            )
              .bind(
                crypto.randomUUID(),
                ownerId,
                "user",
                userText,
                threadId,
                normalizedUserMetadata,
              )
          : env.DB.prepare(
              "INSERT INTO assistant_messages (id, owner_id, role, content, thread_id) VALUES (?, ?, ?, ?, ?)",
            )
              .bind(crypto.randomUUID(), ownerId, "user", userText, threadId),
        env.DB.prepare(
          "INSERT INTO assistant_messages (id, owner_id, role, content, thread_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
          .bind(
            crypto.randomUUID(),
            ownerId,
            "assistant",
            assistantText,
            threadId,
            JSON.stringify(assistantMetadata),
          ),
      ]);
    } catch {
      // Conversation persistence is useful context, but chat turns should not fail on audit writes.
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

  async function touchAssistantThread(env: Env, ownerId: string, threadId: string) {
    try {
      await env.DB.prepare(
        `UPDATE assistant_threads
         SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND owner_id = ?`,
      )
        .bind(threadId, ownerId)
        .run();
    } catch {
      // Thread timestamps should not break the chat turn if persistence is degraded.
    }
  }

  type AssistantSiteThreadMessage = {
    role: string;
    content: string;
    created_at: string;
  };

  type ParsedAssistantSiteDraftContent = {
    bio?: string;
    aboutParagraph?: string;
    pages?: AssistantSiteGeneratedPage[];
    postTitle?: string;
    postBody?: string;
    postTopic?: string;
    postDraft?: boolean;
  };

  type AssistantSiteGeneratedPage = {
    slug: string;
    title: string;
    bodyMarkdown: string;
  };

  type AssistantSiteGeneratedContent = {
    bio?: string;
    aboutParagraph?: string;
    pages?: AssistantSiteGeneratedPage[];
    postTitle?: string;
    postBody?: string;
    postTopic?: string;
    postExcerpt?: string;
    postDraft?: boolean;
    modelResult?: AiTextGenerationResult | null;
    fallbackReason?: string | null;
  };

  type AssistantSiteUpdateDraft = {
    version: 1;
    kind: "profile_site_update";
    siteId: string;
    siteUsername: string;
    threadId: string;
    requestText: string;
    createdAt: string;
    updatedAt: string;
    sourceFiles: Record<string, string>;
    changes: {
      bio?: string;
      aboutFile?: string;
      aboutParagraph?: string;
      pageFiles?: string[];
      postTitle?: string;
      postSlug?: string;
      postFile?: string;
      postMarkdown?: string;
      postDraft?: boolean;
      refinementText?: string | null;
      generatedBy?: {
        providerId: string;
        model: string;
        fallbackReason?: string | null;
      } | null;
    };
  };

  type AssistantSiteToolAction = {
    specialist:
      | "core.sites.update_draft"
      | "core.sites.refine_draft"
      | "core.sites.publish"
      | "core.sites.approval_status";
    replyText: string;
    siteAction: {
      kind:
        | "draft_created"
        | "draft_refined"
        | "published"
        | "approval_status"
        | "missing_site"
        | "unsupported_feature"
        | "listed_blog_posts";
      siteId: string | null;
      username: string | null;
      pending: boolean;
      published: boolean;
      files: string[];
      postTitle?: string | null;
      url?: string | null;
      message?: string | null;
    };
    model?: string | null;
    source?: "tool" | "openai" | "anthropic" | "workers-ai" | "fallback" | null;
  };

  type AssistantScopeDecision = {
    site: {
      allowed: boolean;
      requested: boolean;
      reason: "scope_present" | "scope_missing" | "not_site_intent";
    };
  };

  function assistantScopeDecision(
    scopes: AssistantScope[],
    siteIntent: boolean,
  ): AssistantScopeDecision {
    const allowed = assistantScopesIncludeSite(scopes);
    return {
      site: {
        allowed,
        requested: siteIntent || allowed,
        reason: allowed ? "scope_present" : siteIntent ? "scope_missing" : "not_site_intent",
      },
    };
  }

  async function assistantSiteScopeRequiredReply(
    env: Env,
    ownerId: string,
    threadId: string,
    messageText: string,
  ): Promise<string | null> {
    const siteWriteIntent = isAssistantSiteUpdateIntent(messageText);
    const siteReadIntent = isAssistantSiteStatusIntent(messageText);
    if (siteWriteIntent || siteReadIntent) {
      return "I can help draft that here. Add @site when you want me to edit or inspect your ME3 site draft.";
    }

    const followUpIntent =
      isAssistantSiteApprovalIntent(messageText) ||
      isAssistantSiteDraftSaveIntent(messageText) ||
      isAssistantSiteRetryIntent(messageText) ||
      isAssistantSiteRefinementIntent(messageText);
    if (!followUpIntent) return null;

    const pending = await findPendingAssistantSiteDraft(env, ownerId, threadId, messageText);
    if (pending || (await hasRecentAssistantSiteDraftContext(env, ownerId, threadId))) {
      return "Add @site when you want me to act on the pending ME3 site draft for this turn.";
    }

    return null;
  }

  function buildAssistantScopeRequiredPayload(
    threadId: string,
    replyText: string,
    scopeDecision: AssistantScopeDecision,
  ) {
    return {
      ok: true,
      auditId: null,
      turnId: null,
      threadId,
      specialist: "core.assistant-scopes",
      replyText,
      source: "tool",
      model: null,
      siteAction: null,
      jobBuilderAction: null,
      emailAction: null,
      reminderAction: null,
      contentAction: null,
      contactsChanged: false,
      trace: { assistantScopeDecision: scopeDecision },
    };
  }

  async function maybeHandleAssistantSiteToolAction(
    env: Env,
    ownerId: string,
    threadId: string,
    messageText: string,
    requestUrl: string,
    selectedModel: AssistantChatTurnModelSelection | null,
  ): Promise<AssistantSiteToolAction | null> {
    const approvalIntent = isAssistantSiteApprovalIntent(messageText);
    const blogListIntent = isAssistantSiteBlogListIntent(messageText);
    const statusIntent = isAssistantSiteStatusIntent(messageText);
    const updateIntent = isAssistantSiteUpdateIntent(messageText);
    const refinementIntent = isAssistantSiteRefinementIntent(messageText);
    const draftSaveIntent = isAssistantSiteDraftSaveIntent(messageText);
    const retryIntent = isAssistantSiteRetryIntent(messageText);

    if (approvalIntent || blogListIntent || statusIntent || updateIntent || refinementIntent || draftSaveIntent || retryIntent) {
      const sites = await listAssistantOwnerProfileSites(env, ownerId);
      const username = extractAssistantSiteUsername(messageText);
      if ((username && !sites.some((site) => site.username === username)) || (!username && sites.length > 1)) {
        return {
          specialist: "core.sites.approval_status",
          replyText: username
            ? `I could not find @${username}. Specify the site to use: ${sites.map((site) => `@${site.username}`).join(", ") || "create a site first"}.`
            : `Which site should I use? Include ${sites.map((site) => `@${site.username}`).join(" or ")} in your request.`,
          siteAction: {
            kind: "approval_status",
            siteId: null,
            username: null,
            pending: false,
            published: false,
            files: [],
          },
        };
      }
    }

    if (retryIntent) {
      const site = await chooseAssistantSiteForMessage(env, ownerId, messageText);
      if (site) {
        const draft = await createAssistantSiteDraftFromRecentThread(
          env,
          ownerId,
          site,
          threadId,
          messageText,
          selectedModel,
        );
        if (draft) {
          const unavailable = await getUnavailableAssistantSiteFeatureForDraft(
            env,
            ownerId,
            site,
            draft,
          );
          if (unavailable) {
            return unavailableAssistantSiteFeatureAction(env, site, unavailable, requestUrl);
          }
          await saveAssistantSiteUpdateDraft(env, draft);
          return {
            specialist: "core.sites.update_draft",
            replyText: formatAssistantSiteDraftReply(draft, env, site, requestUrl),
            siteAction: {
              kind: "draft_created",
              siteId: site.id,
              username: site.username,
              pending: true,
              published: false,
              files: assistantSiteDraftChangedFiles(draft),
              postTitle: draft.changes.postTitle || null,
              url: getAssistantSiteDraftReviewUrl(env, site, draft, requestUrl),
            },
            model: draft.changes.generatedBy?.model || null,
            source: assistantSiteToolSourceFromDraft(draft),
          };
        }
      }
    }

    if (approvalIntent) {
      const action = await maybePublishAssistantSiteDraft(
        env,
        ownerId,
        threadId,
        messageText,
        requestUrl,
        selectedModel,
      );
      if (action) return action;
    }

    if (blogListIntent) {
      const action = await maybeListAssistantSiteBlogPosts(
        env,
        ownerId,
        messageText,
        requestUrl,
      );
      if (action) return action;
    }

    if (statusIntent) {
      const action = await maybeReportAssistantSiteApprovalStatus(
        env,
        ownerId,
        threadId,
        messageText,
        requestUrl,
      );
      if (action) return action;
    }

    if (draftSaveIntent) {
      const pending = await findPendingAssistantSiteDraft(env, ownerId, threadId, messageText);
      if (pending) {
        return {
          specialist: "core.sites.approval_status",
          replyText:
            "The site update is already saved as a pending draft in this thread. Reply `publish` to publish it now, or tell me what to change.",
          siteAction: {
            kind: "approval_status",
            siteId: pending.site.id,
            username: pending.site.username,
            pending: true,
            published: false,
            files: assistantSiteDraftChangedFiles(pending.draft),
            postTitle: pending.draft.changes.postTitle || null,
            url: getAssistantSiteDraftReviewUrl(env, pending.site, pending.draft, requestUrl),
          },
        };
      }

      const site = await chooseAssistantSiteForMessage(env, ownerId, messageText);
      if (site) {
        const draft = await createAssistantSiteDraftFromRecentThread(
          env,
          ownerId,
          site,
          threadId,
          messageText,
          selectedModel,
        );
        if (draft) {
          const unavailable = await getUnavailableAssistantSiteFeatureForDraft(
            env,
            ownerId,
            site,
            draft,
          );
          if (unavailable) {
            return unavailableAssistantSiteFeatureAction(env, site, unavailable, requestUrl);
          }
          await saveAssistantSiteUpdateDraft(env, draft);
          return {
            specialist: "core.sites.update_draft",
            replyText: formatAssistantSiteDraftReply(draft, env, site, requestUrl),
            siteAction: {
              kind: "draft_created",
              siteId: site.id,
              username: site.username,
              pending: true,
              published: false,
              files: assistantSiteDraftChangedFiles(draft),
              postTitle: draft.changes.postTitle || null,
              url: getAssistantSiteDraftReviewUrl(env, site, draft, requestUrl),
            },
            model: draft.changes.generatedBy?.model || null,
            source: assistantSiteToolSourceFromDraft(draft),
          };
        }
      }
    }

    if (refinementIntent) {
      const pending = await findPendingAssistantSiteDraft(env, ownerId, threadId, messageText);
      if (pending) {
        return refineAssistantSiteDraft(
          env,
          ownerId,
          pending.site,
          pending.draft,
          messageText,
          requestUrl,
          selectedModel,
        );
      }
    }

    if (!updateIntent) return null;

    const site = await chooseAssistantSiteForMessage(env, ownerId, messageText);
    if (!site) {
      return {
        specialist: "core.sites.update_draft",
        replyText:
          "I can draft and publish site updates once there is a profile site to update. Create a site first, then ask me again.",
        siteAction: {
          kind: "missing_site",
          siteId: null,
          username: null,
          pending: false,
          published: false,
          files: [],
          message: "No profile site was found for this owner.",
        },
      };
    }

    const draft = await createAssistantSiteUpdateDraft(
      env,
      ownerId,
      site,
      threadId,
      messageText,
      null,
      selectedModel,
    );
    const unavailable = await getUnavailableAssistantSiteFeatureForDraft(
      env,
      ownerId,
      site,
      draft,
    );
    if (unavailable) return unavailableAssistantSiteFeatureAction(env, site, unavailable, requestUrl);
    await saveAssistantSiteUpdateDraft(env, draft);
    return {
      specialist: "core.sites.update_draft",
      replyText: formatAssistantSiteDraftReply(draft, env, site, requestUrl),
      siteAction: {
        kind: "draft_created",
        siteId: site.id,
        username: site.username,
        pending: true,
        published: false,
        files: assistantSiteDraftChangedFiles(draft),
        postTitle: draft.changes.postTitle || null,
        url: getAssistantSiteDraftReviewUrl(env, site, draft, requestUrl),
      },
      model: draft.changes.generatedBy?.model || null,
      source: assistantSiteToolSourceFromDraft(draft),
    };
  }

  function buildAssistantSiteToolPayload(
    threadId: string,
    action: AssistantSiteToolAction,
    scopeDecision?: AssistantScopeDecision,
  ) {
    return {
      ok: true,
      auditId: null,
      turnId: null,
      threadId,
      specialist: action.specialist,
      replyText: action.replyText,
      source: action.source || "tool",
      model: action.model || null,
      siteAction: action.siteAction,
      jobBuilderAction: null,
      emailAction: null,
      reminderAction: null,
      contentAction: null,
      contactsChanged: false,
      trace: scopeDecision ? { assistantScopeDecision: scopeDecision } : undefined,
    };
  }

  function assistantSiteToolSourceFromDraft(draft: AssistantSiteUpdateDraft): AssistantSiteToolAction["source"] {
    if (!draft.changes.generatedBy) return "tool";
    if (draft.changes.generatedBy.fallbackReason) return "fallback";
    const providerId = draft.changes.generatedBy.providerId;
    return providerId === "openai" || providerId === "anthropic" || providerId === "workers-ai"
      ? providerId
      : "tool";
  }

  function isAssistantSiteUpdateIntent(messageText: string): boolean {
    const text = normalizeAssistantIntentText(messageText);
    if (!text) return false;
    if (isAssistantSiteApprovalIntent(text) || isAssistantSiteStatusIntent(text)) return false;
    const siteish =
      /(?:^|[\s(])@[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?/i.test(messageText) ||
      /\b(site|website|homepage|site builder|profile site|profile page|public profile|landing page|portfolio|about page|about section|bio field)\b/.test(text) ||
      /\b(my|the|this|your)\s+(bio|page)\b/.test(text);
    const actionish = /\b(update|add|create|write|draft|make|publish|change|edit|put|append)\b/.test(text);
    const contentTarget =
      /\b(about page|about section|bio|blog post|post about|article about|blog|page)\b/.test(text);
    return siteish && actionish && contentTarget;
  }

  function isAssistantSiteApprovalIntent(messageText: string): boolean {
    const text = normalizeAssistantIntentText(messageText);
    if (!text) return false;
    if (isAssistantSiteStatusIntent(text)) return false;
    return (
      /^(yes|yep|yeah|ok|okay|sure|approved?|publish|ship|send|do it|just do it|go ahead)\b/.test(text) ||
      /\b(publish (it|them|this|the draft)|approve (it|them|this|the draft)|ship it|make it live|looks good|just do it|go ahead)\b/.test(text)
    );
  }

  function isAssistantSiteStatusIntent(messageText: string): boolean {
    const text = normalizeAssistantIntentText(messageText);
    if (!text) return false;
    return (
      /\b(has|have|was|is|did|can you check|check)\b.*\b(approved|published|live|done|status)\b/.test(text) ||
      /\b(approval status|publish status|site status)\b/.test(text)
    );
  }

  function isAssistantSiteBlogListIntent(messageText: string): boolean {
    const text = normalizeAssistantIntentText(messageText);
    if (!text) return false;
    if (isAssistantSiteUpdateIntent(text) || isAssistantSiteApprovalIntent(text)) return false;
    return (
      /\b(list|show|see|view|open|what|which)\b.*\b(blog posts?|posts?|articles?)\b/.test(text) ||
      /\b(blog posts?|posts?|articles?)\b.*\b(list|show|see|view|published|existing)\b/.test(text)
    );
  }

  function isAssistantSiteDraftSaveIntent(messageText: string): boolean {
    const text = normalizeAssistantIntentText(messageText);
    if (!text) return false;
    return /\b(save|keep|store)\b.*\b(draft|site update|blog post|post|article)\b/.test(text) ||
      /\b(save it as a draft|save this as a draft|save that as a draft)\b/.test(text);
  }

  function isAssistantSiteRetryIntent(messageText: string): boolean {
    const text = normalizeAssistantIntentText(messageText);
    if (!text) return false;
    if (
      /\b(publish|approve|make it live|ship it|send it|just do it|go ahead)\b/.test(
        text,
      )
    ) {
      return false;
    }
    return /\b(try again|enabled it|enabled blog|enabled the blog|turned it on|turned blog on|blog is enabled)\b/.test(text);
  }

  function isAssistantSiteRefinementIntent(messageText: string): boolean {
    const text = normalizeAssistantIntentText(messageText);
    if (!text) return false;
    if (isAssistantSiteApprovalIntent(text) || isAssistantSiteStatusIntent(text)) return false;
    return /\b(change|revise|refine|rewrite|edit|make|more|less|shorter|longer|instead|remove|add|use|tone|title)\b/.test(text);
  }

  function normalizeAssistantIntentText(messageText: string): string {
    return messageText.toLowerCase().replace(/\s+/g, " ").trim();
  }

  async function maybePublishAssistantSiteDraft(
    env: Env,
    ownerId: string,
    threadId: string,
    messageText: string,
    requestUrl: string,
    selectedModel: AssistantChatTurnModelSelection | null,
  ): Promise<AssistantSiteToolAction | null> {
    const pending = await findPendingAssistantSiteDraft(env, ownerId, threadId, messageText);
    let site = pending?.site || (await chooseAssistantSiteForMessage(env, ownerId, messageText));
    let draft = pending?.draft || null;

    if (!site) return null;
    if (!draft && (await listAssistantOwnerProfileSites(env, ownerId)).length > 1) {
      return {
        specialist: "core.sites.approval_status",
        replyText: `There is no pending draft for @${site.username} in this thread. Ask me to draft the update for @${site.username} first.`,
        siteAction: {
          kind: "approval_status",
          siteId: site.id,
          username: site.username,
          pending: false,
          published: Boolean(site.published_at),
          files: [],
        },
      };
    }
    if (!draft) {
      draft = await createAssistantSiteDraftFromRecentThread(
        env,
        ownerId,
        site,
        threadId,
        messageText,
        selectedModel,
      );
    }
    if (!draft) return null;

    const cloudUsernameError = site.published_at
      ? null
      : await getMe3CloudUsernamePublishBlockReason(env, site.username);
    if (cloudUsernameError) {
      return {
        specialist: "core.sites.publish",
        replyText: `I have the draft, but I cannot publish it yet: ${cloudUsernameError}`,
        siteAction: {
          kind: "approval_status",
          siteId: site.id,
          username: site.username,
          pending: true,
          published: false,
          files: assistantSiteDraftChangedFiles(draft),
          postTitle: draft.changes.postTitle || null,
          url: getAssistantSiteDraftReviewUrl(env, site, draft, requestUrl),
          message: cloudUsernameError,
        },
      };
    }

    draft = assistantSiteDraftForPublish(draft);
    const profile = parseSiteProfile(draft.sourceFiles["me.json"] || "{}", site.username);
    const commerceError = await getProfileCommercePublishBlockReason(env, ownerId, profile);
    if (commerceError) {
      return {
        specialist: "core.sites.publish",
        replyText: `I have the draft, but I cannot publish it yet: ${commerceError}`,
        siteAction: {
          kind: "approval_status",
          siteId: site.id,
          username: site.username,
          pending: true,
          published: false,
          files: assistantSiteDraftChangedFiles(draft),
          postTitle: draft.changes.postTitle || null,
          url: getAssistantSiteDraftReviewUrl(env, site, draft, requestUrl),
          message: commerceError,
        },
      };
    }
    site = await publishAssistantSiteDraft(env, site, draft);
    return {
      specialist: "core.sites.publish",
      replyText: formatAssistantSitePublishedReply(env, site, draft, requestUrl),
      siteAction: {
        kind: "published",
        siteId: site.id,
        username: site.username,
        pending: false,
        published: true,
        files: assistantSiteDraftChangedFiles(draft),
        postTitle: draft.changes.postTitle || null,
        url: getAssistantSiteAdminUrl(
          env,
          site,
          requestUrl,
          draft.changes.postTitle ? "blog" : null,
        ),
      },
    };
  }

  async function maybeReportAssistantSiteApprovalStatus(
    env: Env,
    ownerId: string,
    threadId: string,
    messageText: string,
    requestUrl: string,
  ): Promise<AssistantSiteToolAction | null> {
    const pending = await findPendingAssistantSiteDraft(env, ownerId, threadId, messageText);
    if (pending) {
      return {
        specialist: "core.sites.approval_status",
        replyText:
          "Not yet. There is a site draft waiting in this thread. Reply `publish` or `approve` and I will publish it immediately.",
        siteAction: {
          kind: "approval_status",
          siteId: pending.site.id,
          username: pending.site.username,
          pending: true,
          published: false,
          files: assistantSiteDraftChangedFiles(pending.draft),
          postTitle: pending.draft.changes.postTitle || null,
          url: getAssistantSiteDraftReviewUrl(env, pending.site, pending.draft, requestUrl),
        },
      };
    }

    const site = await chooseAssistantSiteForMessage(env, ownerId, messageText);
    if (!site) return null;
    const recentContext = await hasRecentAssistantSiteDraftContext(env, ownerId, threadId);
    if (recentContext) {
      return {
        specialist: "core.sites.approval_status",
        replyText:
          "I can see the site-update draft context, but it has not been published yet. Reply `publish` or `approve` and I will publish it immediately.",
        siteAction: {
          kind: "approval_status",
          siteId: site.id,
          username: site.username,
          pending: true,
          published: false,
          files: [],
          url: getAssistantSiteAdminUrl(env, site, requestUrl),
        },
      };
    }

    return {
      specialist: "core.sites.approval_status",
      replyText: site.published_at
        ? `Your @${site.username} site is currently published. I do not see a pending draft in this thread.`
        : `Your @${site.username} site is not published yet, and I do not see a pending draft in this thread.`,
      siteAction: {
        kind: "approval_status",
        siteId: site.id,
        username: site.username,
        pending: false,
        published: Boolean(site.published_at),
        files: [],
        url: getAssistantSiteAdminUrl(env, site, requestUrl),
      },
    };
  }

  async function maybeListAssistantSiteBlogPosts(
    env: Env,
    ownerId: string,
    messageText: string,
    requestUrl: string,
  ): Promise<AssistantSiteToolAction | null> {
    const site = await chooseAssistantSiteForMessage(env, ownerId, messageText);
    if (!site) return null;
    const sourceFiles = await loadSiteSourceFiles(env, site.id);
    const profile = await loadAssistantSiteProfile(env, ownerId, site, sourceFiles);
    const posts = Array.isArray(profile.posts) ? profile.posts : [];
    const lines = posts
      .map((post, index) => {
        const title = post.title || titleFromSlug(post.slug || `post-${index + 1}`);
        const status = post.draft === true ? "draft" : "published";
        const date = post.publishedAt ? `, ${post.publishedAt}` : "";
        const slug = post.slug ? ` (${post.slug})` : "";
        return `${index + 1}. ${title}${slug} - ${status}${date}`;
      });
    return {
      specialist: "core.sites.approval_status",
      replyText: lines.length
        ? `Blog posts for @${site.username}:\n\n${lines.join("\n")}`
        : `@${site.username} does not have any blog posts yet.`,
      siteAction: {
        kind: "listed_blog_posts",
        siteId: site.id,
        username: site.username,
        pending: false,
        published: Boolean(site.published_at),
        files: [],
        url: getAssistantSiteAdminUrl(env, site, requestUrl, "blog"),
      },
      source: "tool",
      model: null,
    };
  }

  async function refineAssistantSiteDraft(
    env: Env,
    ownerId: string,
    site: DbSite,
    draft: AssistantSiteUpdateDraft,
    refinementText: string,
    requestUrl: string,
    selectedModel: AssistantChatTurnModelSelection | null,
  ): Promise<AssistantSiteToolAction> {
    const nextDraft = await applyAssistantSiteDraftRefinement(
      env,
      ownerId,
      site,
      draft,
      refinementText,
      selectedModel,
    );
    await saveAssistantSiteUpdateDraft(env, nextDraft);
    return {
      specialist: "core.sites.refine_draft",
      replyText: formatAssistantSiteRefinedReply(nextDraft),
      siteAction: {
        kind: "draft_refined",
        siteId: site.id,
        username: site.username,
        pending: true,
        published: false,
        files: assistantSiteDraftChangedFiles(nextDraft),
        postTitle: nextDraft.changes.postTitle || null,
        url: getAssistantSiteDraftReviewUrl(env, site, nextDraft, requestUrl),
      },
      model: nextDraft.changes.generatedBy?.model || null,
      source: assistantSiteToolSourceFromDraft(nextDraft),
    };
  }

  async function chooseAssistantSiteForMessage(
    env: Env,
    ownerId: string,
    messageText: string,
  ): Promise<DbSite | null> {
    const sites = await listAssistantOwnerProfileSites(env, ownerId);
    if (!sites.length) return null;

    const explicitUsername = extractAssistantSiteUsername(messageText);
    if (explicitUsername) {
      return sites.find((site) => site.username === explicitUsername) || null;
    }

    return sites.length === 1 ? sites[0] : null;
  }

  async function listAssistantOwnerProfileSites(env: Env, ownerId: string): Promise<DbSite[]> {
    const rows = await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE user_id = ? AND COALESCE(site_type, 'profile') = 'profile'
       ORDER BY published_at IS NULL, published_at DESC, updated_at DESC, created_at ASC`,
    )
      .bind(ownerId)
      .all<DbSite>();
    return rows.results || [];
  }

  function extractAssistantSiteUsername(messageText: string): string {
    const atMatch = messageText.match(/@([a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?)/i);
    return normalizeUsername(atMatch?.[1]);
  }

  async function findPendingAssistantSiteDraft(
    env: Env,
    ownerId: string,
    threadId: string,
    messageText: string,
  ): Promise<{ site: DbSite; draft: AssistantSiteUpdateDraft } | null> {
    const sites = await listAssistantOwnerProfileSites(env, ownerId);
    const explicitUsername = extractAssistantSiteUsername(messageText);
    const candidates = explicitUsername
      ? sites.filter((site) => site.username === explicitUsername)
      : sites;
    let pending: { site: DbSite; draft: AssistantSiteUpdateDraft } | null = null;
    for (const site of candidates) {
      const draft = await loadAssistantSiteUpdateDraft(env, site.id, threadId);
      if (!draft) continue;
      if (pending) return null;
      pending = { site, draft };
    }
    return pending;
  }

  async function getUnavailableAssistantSiteFeatureForDraft(
    env: Env,
    ownerId: string,
    site: DbSite,
    draft: AssistantSiteUpdateDraft,
  ): Promise<"blog" | null> {
    if (!draft.changes.postMarkdown) return null;
    const sourceFiles = await loadSiteSourceFiles(env, site.id);
    const profile = await loadAssistantSiteProfile(env, ownerId, site, sourceFiles);
    return assistantSiteBlogFeatureEnabled(profile) ? null : "blog";
  }

  function assistantSiteBlogFeatureEnabled(profile: Me3SiteProfile): boolean {
    if (profile.blogEnabled === true) return true;
    if (Array.isArray(profile.posts) && profile.posts.length > 0) return true;
    return typeof profile.blogTitle === "string" && profile.blogTitle.trim().length > 0;
  }

  function unavailableAssistantSiteFeatureAction(
    env: Env,
    site: DbSite,
    feature: "blog",
    requestUrl: string,
  ): AssistantSiteToolAction {
    return {
      specialist: "core.sites.update_draft",
      replyText:
        feature === "blog"
          ? "I cannot draft a blog post yet because Blog is not enabled for your site. Enable Blog in the site builder's Additional features step, then ask me again."
          : "I cannot draft that site update yet because the required site feature is not enabled for your site.",
      siteAction: {
        kind: "unsupported_feature",
        siteId: site.id,
        username: site.username,
        pending: false,
        published: false,
        files: [],
        url: getAssistantSiteAdminUrl(
          env,
          site,
          requestUrl,
          feature === "blog" ? "additional-features" : null,
        ),
        message:
          feature === "blog"
            ? "Blog is not enabled for this profile site."
            : "The required site feature is not enabled for this profile site.",
      },
    };
  }

  async function createAssistantSiteDraftFromRecentThread(
    env: Env,
    ownerId: string,
    site: DbSite,
    threadId: string,
    fallbackRequestText: string,
    selectedModel: AssistantChatTurnModelSelection | null,
  ): Promise<AssistantSiteUpdateDraft | null> {
    const messages = await loadAssistantThreadRecentMessages(env, ownerId, threadId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      const parsed = parseAssistantSiteDraftFromAssistantText(message.content);
      if (!parsed) continue;
      const priorUserMessage = findPriorSiteUpdateUserMessage(messages, index);
      return createAssistantSiteUpdateDraft(
        env,
        ownerId,
        site,
        threadId,
        priorUserMessage || fallbackRequestText,
        parsed,
        selectedModel,
      );
    }

    const priorUserMessage = findPriorSiteUpdateUserMessage(messages, messages.length);
    if (!priorUserMessage) return null;
    return createAssistantSiteUpdateDraft(
      env,
      ownerId,
      site,
      threadId,
      priorUserMessage,
      null,
      selectedModel,
    );
  }

  async function hasRecentAssistantSiteDraftContext(
    env: Env,
    ownerId: string,
    threadId: string,
  ): Promise<boolean> {
    const messages = await loadAssistantThreadRecentMessages(env, ownerId, threadId);
    return messages.some((message) =>
      message.role === "assistant"
        ? Boolean(parseAssistantSiteDraftFromAssistantText(message.content))
        : message.role === "user" && isAssistantSiteUpdateIntent(message.content),
    );
  }

  async function loadAssistantThreadRecentMessages(
    env: Env,
    ownerId: string,
    threadId: string,
  ): Promise<AssistantSiteThreadMessage[]> {
    const rows = await env.DB.prepare(
      `SELECT role, content, created_at
       FROM assistant_messages
       WHERE owner_id = ? AND thread_id = ? AND role IN ('user', 'assistant')
       ORDER BY created_at ASC
       LIMIT 24`,
    )
      .bind(ownerId, threadId)
      .all<AssistantSiteThreadMessage>();
    return rows.results || [];
  }

  function findPriorSiteUpdateUserMessage(
    messages: AssistantSiteThreadMessage[],
    beforeIndex: number,
  ): string | null {
    for (let index = Math.min(beforeIndex - 1, messages.length - 1); index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "user" && isAssistantSiteUpdateIntent(message.content)) {
        return message.content;
      }
    }
    return null;
  }

  async function createAssistantSiteUpdateDraft(
    env: Env,
    ownerId: string,
    site: DbSite,
    threadId: string,
    requestText: string,
    parsedContent: ParsedAssistantSiteDraftContent | null = null,
    selectedModel: AssistantChatTurnModelSelection | null = null,
  ): Promise<AssistantSiteUpdateDraft> {
    const sourceFiles = await loadSiteSourceFiles(env, site.id);
    const profile = await loadAssistantSiteProfile(env, ownerId, site, sourceFiles);
    const generatedContent =
      parsedContent
        ? assistantGeneratedContentFromParsed(parsedContent)
        : await generateAssistantSiteUpdateContent(
            env,
            ownerId,
            site,
            profile,
            sourceFiles,
            requestText,
            selectedModel,
          );
    const changes: AssistantSiteUpdateDraft["changes"] = {
      refinementText: null,
      generatedBy: generatedContent.modelResult
        ? {
            providerId: generatedContent.modelResult.providerId,
            model: generatedContent.modelResult.model,
            fallbackReason: generatedContent.fallbackReason || null,
          }
        : generatedContent.fallbackReason
          ? {
              providerId: "fallback",
              model: "local-site-fallback",
              fallbackReason: generatedContent.fallbackReason,
            }
          : null,
    };

    const bio = normalizeAssistantProfileBio(
      generatedContent.bio ||
        (assistantRequestMentionsBioField(requestText) ? generatedContent.aboutParagraph || "" : ""),
    );
    if (bio) {
      profile.bio = bio;
      changes.bio = bio;
    }

    const aboutParagraph =
      changes.bio && assistantRequestMentionsBioField(requestText)
        ? ""
        : generatedContent.aboutParagraph || "";
    if (aboutParagraph) {
      const aboutPage = upsertAssistantAboutPage(profile);
      const aboutFile = normalizeSiteFileName(aboutPage.file || "about.md") || "about.md";
      const existingAbout = sourceFiles.get(aboutFile) || `# ${aboutPage.title || "About"}\n`;
      sourceFiles.set(aboutFile, appendAssistantParagraph(existingAbout, aboutParagraph));
      changes.aboutFile = aboutFile;
      changes.aboutParagraph = aboutParagraph;
    }

    for (const page of generatedContent.pages || []) {
      const slug = slugifyAssistantSitePath(page.slug || page.title || "page");
      if (!slug || slug === "blog" || slug === "shop") continue;
      const title = page.title.trim() || titleFromSlug(slug);
      const pageFile = `${slug}.md`;
      upsertAssistantSitePage(profile, { slug, title, file: pageFile });
      sourceFiles.set(pageFile, normalizeAssistantPostMarkdown(title, page.bodyMarkdown));
      changes.pageFiles = [...(changes.pageFiles || []), pageFile];
    }

    const shouldCreatePost = Boolean(
      generatedContent.postBody || assistantRequestMentionsBlogPost(requestText),
    );
    if (shouldCreatePost) {
      const postDraft = assistantSiteBlogPostShouldStayDraft(requestText);
      const topic = generatedContent.postTopic || extractAssistantBlogTopic(requestText);
      const postTitle = generatedContent.postTitle || assistantBlogTitleFromTopic(topic);
      const postSlug = slugifyAssistantSitePath(postTitle || topic || "personal-ai-assistants");
      const postFile = `blog/${postSlug}.md`;
      const postMarkdown = generatedContent.postBody
        ? normalizeAssistantPostMarkdown(postTitle, generatedContent.postBody)
        : generateAssistantBlogPostMarkdown(topic, postTitle, requestText);
      upsertAssistantBlogPost(profile, {
        slug: postSlug,
        title: postTitle,
        file: postFile,
        excerpt: generatedContent.postExcerpt || markdownExcerpt(postMarkdown),
        draft: postDraft,
      });
      sourceFiles.set(postFile, postMarkdown);
      changes.postTitle = postTitle;
      changes.postSlug = postSlug;
      changes.postFile = postFile;
      changes.postMarkdown = postMarkdown;
      changes.postDraft = postDraft;
    }

    if (
      !changes.bio &&
      !changes.aboutParagraph &&
      !changes.pageFiles?.length &&
      !changes.postMarkdown
    ) {
      const aboutPage = upsertAssistantAboutPage(profile);
      const aboutFile = normalizeSiteFileName(aboutPage.file || "about.md") || "about.md";
      const fallbackParagraph =
        generatedContent.aboutParagraph || generateAssistantAboutParagraph(requestText);
      const existingAbout = sourceFiles.get(aboutFile) || `# ${aboutPage.title || "About"}\n`;
      sourceFiles.set(aboutFile, appendAssistantParagraph(existingAbout, fallbackParagraph));
      changes.aboutFile = aboutFile;
      changes.aboutParagraph = fallbackParagraph;
    }

    sourceFiles.set("me.json", JSON.stringify(profile, null, 2));

    const now = new Date().toISOString();
    return {
      version: 1,
      kind: "profile_site_update",
      siteId: site.id,
      siteUsername: site.username,
      threadId,
      requestText,
      createdAt: now,
      updatedAt: now,
      sourceFiles: Object.fromEntries(sourceFiles.entries()),
      changes,
    };
  }

  function assistantGeneratedContentFromParsed(
    parsed: ParsedAssistantSiteDraftContent,
  ): AssistantSiteGeneratedContent {
    return {
      bio: parsed.bio,
      aboutParagraph: parsed.aboutParagraph,
      pages: parsed.pages,
      postTitle: parsed.postTitle,
      postBody: parsed.postBody,
      postTopic: parsed.postTopic,
      postDraft: parsed.postDraft,
      modelResult: null,
      fallbackReason: null,
    };
  }

  async function generateAssistantSiteUpdateContent(
    env: Env,
    ownerId: string,
    site: DbSite,
    profile: Me3SiteProfile,
    sourceFiles: Map<string, string>,
    requestText: string,
    selectedModel: AssistantChatTurnModelSelection | null,
  ): Promise<AssistantSiteGeneratedContent> {
    try {
      const messages = buildAssistantSiteGenerationMessages(site, profile, sourceFiles, requestText);
      const modelResult = await generateAiText(env, ownerId, {
        routeId: "chat",
        selectedModel,
        messages,
        temperature: 0.55,
        maxTokens: 1800,
      });
      const parsed = parseAssistantSiteGeneratedJson(modelResult.text);
      if (!parsed) {
        throw new Error("The model did not return valid site-update JSON.");
      }
      return { ...parsed, modelResult, fallbackReason: null };
    } catch (error) {
      return {
        ...generateFallbackAssistantSiteContent(requestText),
        modelResult: null,
        fallbackReason:
          error instanceof Error ? error.message : "The configured model could not generate the site update.",
      };
    }
  }

  function buildAssistantSiteGenerationMessages(
    site: DbSite,
    profile: Me3SiteProfile,
    sourceFiles: Map<string, string>,
    requestText: string,
  ): AiTextMessage[] {
    const pages = (profile.pages || []).map((page) => {
      const file = normalizeSiteFileName(page.file || (page.slug ? `${page.slug}.md` : ""));
      return {
        slug: page.slug || "",
        title: page.title || titleFromSlug(page.slug || file || "page"),
        file,
        excerpt: truncateAssistantPromptText(sourceFiles.get(file) || "", 700),
      };
    });
    const posts = (profile.posts || []).map((post) => ({
      slug: post.slug || "",
      title: post.title || titleFromSlug(post.slug || "post"),
      file: normalizeSiteFileName(post.file || (post.slug ? `blog/${post.slug}.md` : "")),
      draft: post.draft === true,
      publishedAt: post.publishedAt || null,
      excerpt: post.excerpt || "",
    }));
    const system = [
      "You write public ME3 profile-site content for the owner.",
      "Return only strict JSON. No markdown fence, no prose outside JSON.",
      "Schema: {\"bio\": string optional, \"aboutParagraph\": string optional, \"pages\": [{\"slug\": string, \"title\": string, \"bodyMarkdown\": string}] optional, \"blogPost\": {\"title\": string, \"bodyMarkdown\": string, \"excerpt\": string optional, \"draft\": boolean optional} optional}.",
      "Use bio for short profile bio/tagline updates. Do not turn short bio requests into about page paragraphs.",
      "Use bodyMarkdown without frontmatter. For pages and posts, include a single H1 followed by useful body copy.",
      "Only include fields that the owner asked to create or update. Keep content specific to the owner's request and current site.",
      "For blog posts, separate the requested topic from workflow instructions such as outline-only, draft-only, or the owner writing it themselves.",
      "Do not claim the site is published.",
    ].join("\n");
    const user = JSON.stringify(
      {
        request: requestText,
        site: {
          username: site.username,
          name: profile.name || site.username,
          bio: profile.bio || "",
          blogEnabled: assistantSiteBlogFeatureEnabled(profile),
        },
        existingPages: pages,
        existingBlogPosts: posts,
      },
      null,
      2,
    );
    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  function parseAssistantSiteGeneratedJson(text: string): AssistantSiteGeneratedContent | null {
    const parsed = parseJsonObjectFromModelText(text);
    if (!parsed) return null;
    const bio = normalizeAssistantProfileBio(normalizeGeneratedString(parsed.bio));
    const aboutParagraph = normalizeGeneratedString(parsed.aboutParagraph);
    const pages = Array.isArray(parsed.pages)
      ? parsed.pages
          .map((page) => normalizeGeneratedPage(page))
          .filter((page): page is AssistantSiteGeneratedPage => Boolean(page))
      : [];
    const blogPost = isRecordValue(parsed.blogPost) ? parsed.blogPost : null;
    const postTitle = normalizeGeneratedString(blogPost?.title);
    const postBody = normalizeGeneratedString(blogPost?.bodyMarkdown);
    const postExcerpt = normalizeGeneratedString(blogPost?.excerpt);
    const postDraft = typeof blogPost?.draft === "boolean" ? blogPost.draft : undefined;

    if (!bio && !aboutParagraph && pages.length === 0 && !postBody) return null;
    return {
      bio: bio || undefined,
      aboutParagraph: aboutParagraph || undefined,
      pages: pages.length ? pages : undefined,
      postTitle: postTitle || undefined,
      postBody: postBody || undefined,
      postExcerpt: postExcerpt || undefined,
      postDraft,
      modelResult: null,
      fallbackReason: null,
    };
  }

  function parseJsonObjectFromModelText(text: string): Record<string, unknown> | null {
    const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const candidates = [trimmed];
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
    }
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (isRecordValue(parsed)) return parsed;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  function normalizeGeneratedPage(value: unknown): AssistantSiteGeneratedPage | null {
    if (!isRecordValue(value)) return null;
    const title = normalizeGeneratedString(value.title);
    const bodyMarkdown = normalizeGeneratedString(value.bodyMarkdown);
    const slug = slugifyAssistantSitePath(normalizeGeneratedString(value.slug) || title);
    if (!slug || !title || !bodyMarkdown) return null;
    return { slug, title, bodyMarkdown };
  }

  function normalizeGeneratedString(value: unknown): string {
    return typeof value === "string" ? cleanAssistantGeneratedSnippet(value) : "";
  }

  function isRecordValue(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function truncateAssistantPromptText(value: string, limit: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
  }

  function generateFallbackAssistantSiteContent(requestText: string): AssistantSiteGeneratedContent {
    const content: AssistantSiteGeneratedContent = {};
    if (assistantRequestMentionsBioField(requestText)) {
      content.bio = generateAssistantShortBio(requestText);
    } else if (assistantRequestMentionsAbout(requestText)) {
      content.aboutParagraph = generateAssistantAboutParagraph(requestText);
    }
    if (assistantRequestMentionsBlogPost(requestText)) {
      const topic = extractAssistantBlogTopic(requestText);
      content.postTopic = topic;
      content.postTitle = assistantBlogTitleFromTopic(topic);
      content.postBody = generateAssistantBlogPostMarkdown(topic, content.postTitle, requestText);
      content.postDraft = assistantRequestAsksForDraftPost(requestText);
    }
    if (!content.bio && !content.aboutParagraph && !content.postBody) {
      content.aboutParagraph = generateAssistantAboutParagraph(requestText);
    }
    return content;
  }

  async function loadAssistantSiteProfile(
    env: Env,
    ownerId: string,
    site: DbSite,
    sourceFiles: Map<string, string>,
  ): Promise<Me3SiteProfile> {
    const owner = await getOwnerProfile(env, ownerId);
    const fallbackProfile: Me3SiteProfile = {
      version: "0.1",
      handle: site.username,
      name: owner?.name || owner?.username || site.username,
      bio: owner?.bio || "Personal AI assistant powered by ME3.",
    };
    if (owner?.avatar_url) fallbackProfile.avatar = owner.avatar_url;

    const profile = parseSiteProfile(
      sourceFiles.get("me.json") || JSON.stringify(fallbackProfile),
      site.username,
    );
    profile.version ||= "0.1";
    profile.handle ||= site.username;
    profile.name ||= owner?.name || owner?.username || site.username;
    profile.bio ||= owner?.bio || fallbackProfile.bio;
    if (!profile.avatar && owner?.avatar_url) profile.avatar = owner.avatar_url;
    return profile;
  }

  function upsertAssistantAboutPage(profile: Me3SiteProfile) {
    const pages = Array.isArray(profile.pages) ? [...profile.pages] : [];
    const existingIndex = pages.findIndex((page) => {
      const slug = normalizeSiteFileName(page.slug || "").toLowerCase();
      const file = normalizeSiteFileName(page.file || "").toLowerCase();
      const title = (page.title || "").toLowerCase();
      return slug === "about" || file === "about.md" || title === "about";
    });
    const existing = existingIndex >= 0 ? pages[existingIndex] : {};
    const page = {
      ...existing,
      slug: existing.slug || "about",
      title: existing.title || "About",
      file: existing.file || "about.md",
      visible: existing.visible === false ? false : true,
    };
    if (existingIndex >= 0) {
      pages[existingIndex] = page;
    } else {
      pages.push(page);
    }
    profile.pages = pages;
    return page;
  }

  function upsertAssistantSitePage(
    profile: Me3SiteProfile,
    input: { slug: string; title: string; file: string },
  ) {
    const pages = Array.isArray(profile.pages) ? [...profile.pages] : [];
    const existingIndex = pages.findIndex((page) => {
      const slug = normalizeSiteFileName(page.slug || "").toLowerCase();
      const file = normalizeSiteFileName(page.file || "").toLowerCase();
      return slug === input.slug || file === input.file.toLowerCase();
    });
    const page = {
      ...(existingIndex >= 0 ? pages[existingIndex] : {}),
      slug: input.slug,
      title: input.title,
      file: input.file,
      visible: existingIndex >= 0 && pages[existingIndex]?.visible === false ? false : true,
    };
    if (existingIndex >= 0) {
      pages[existingIndex] = page;
    } else {
      pages.push(page);
    }
    profile.pages = pages;
    return page;
  }

  function upsertAssistantBlogPost(
    profile: Me3SiteProfile,
    input: { slug: string; title: string; file: string; excerpt: string; draft?: boolean },
  ) {
    const posts = Array.isArray(profile.posts) ? [...profile.posts] : [];
    const existingIndex = posts.findIndex(
      (post) => post.slug === input.slug || normalizeSiteFileName(post.file || "") === input.file,
    );
    const post = {
      ...(existingIndex >= 0 ? posts[existingIndex] : {}),
      slug: input.slug,
      title: input.title,
      file: input.file,
      publishedAt: input.draft === true ? undefined : new Date().toISOString().slice(0, 10),
      excerpt: input.excerpt,
      draft: input.draft === true,
      type: "article",
    };
    if (existingIndex >= 0) {
      posts[existingIndex] = post;
    } else {
      posts.unshift(post);
    }
    profile.posts = posts;
    profile.blogTitle ||= "Blog";
  }

  function removeAssistantBlogPost(
    profile: Me3SiteProfile,
    slug: string | undefined,
    file: string | undefined,
  ) {
    if (!Array.isArray(profile.posts)) return;
    const normalizedFile = normalizeSiteFileName(file || "");
    profile.posts = profile.posts.filter(
      (post) =>
        !(
          (slug && post.slug === slug) ||
          (normalizedFile && normalizeSiteFileName(post.file || "") === normalizedFile)
        ),
    );
  }

  async function applyAssistantSiteDraftRefinement(
    env: Env,
    ownerId: string,
    site: DbSite,
    draft: AssistantSiteUpdateDraft,
    refinementText: string,
    selectedModel: AssistantChatTurnModelSelection | null,
  ): Promise<AssistantSiteUpdateDraft> {
    const sourceFiles = new Map(Object.entries(draft.sourceFiles));
    const changes = { ...draft.changes, refinementText };
    const combinedRequest = `${draft.requestText}\n\nRefinement: ${refinementText}`;
    let generatedContent: AssistantSiteGeneratedContent | null = null;
    try {
      const profile = parseSiteProfile(sourceFiles.get("me.json") || "{}", site.username);
      generatedContent = await generateAssistantSiteUpdateContent(
        env,
        ownerId,
        site,
        profile,
        sourceFiles,
        combinedRequest,
        selectedModel,
      );
      changes.generatedBy = generatedContent.modelResult
        ? {
            providerId: generatedContent.modelResult.providerId,
            model: generatedContent.modelResult.model,
            fallbackReason: generatedContent.fallbackReason || null,
          }
        : generatedContent.fallbackReason
          ? {
              providerId: "fallback",
              model: "local-site-fallback",
              fallbackReason: generatedContent.fallbackReason,
            }
          : changes.generatedBy || null;
    } catch {
      generatedContent = null;
    }

    if (changes.aboutFile && changes.aboutParagraph && assistantRefinementTargetsAbout(refinementText)) {
      const nextParagraph =
        generatedContent?.aboutParagraph || generateAssistantAboutParagraph(combinedRequest);
      const currentAbout = sourceFiles.get(changes.aboutFile) || "";
      sourceFiles.set(
        changes.aboutFile,
        replaceAssistantParagraph(currentAbout, changes.aboutParagraph, nextParagraph),
      );
      changes.aboutParagraph = nextParagraph;
    }

    if (changes.postFile && changes.postTitle && assistantRefinementTargetsPost(refinementText)) {
      const nextTitle =
        generatedContent?.postTitle ||
        extractAssistantRequestedTitle(refinementText) ||
        changes.postTitle;
      const topic = extractAssistantBlogTopic(draft.requestText);
      const nextMarkdown = generatedContent?.postBody
        ? normalizeAssistantPostMarkdown(nextTitle, generatedContent.postBody)
        : generateAssistantBlogPostMarkdown(topic, nextTitle, combinedRequest);
      sourceFiles.delete(changes.postFile);
      const nextSlug = slugifyAssistantSitePath(nextTitle);
      const nextFile = `blog/${nextSlug}.md`;
      sourceFiles.set(nextFile, nextMarkdown);
      changes.postTitle = nextTitle;
      changes.postSlug = nextSlug;
      changes.postFile = nextFile;
      changes.postMarkdown = nextMarkdown;

      const meJson = sourceFiles.get("me.json");
      if (meJson) {
        const profile = parseSiteProfile(meJson, draft.siteUsername);
        removeAssistantBlogPost(profile, changes.postSlug, changes.postFile);
        upsertAssistantBlogPost(profile, {
          slug: nextSlug,
          title: nextTitle,
          file: nextFile,
          excerpt: markdownExcerpt(nextMarkdown),
          draft: changes.postDraft === true,
        });
        sourceFiles.set("me.json", JSON.stringify(profile, null, 2));
      }
    }

    return {
      ...draft,
      requestText: combinedRequest,
      updatedAt: new Date().toISOString(),
      sourceFiles: Object.fromEntries(sourceFiles.entries()),
      changes,
    };
  }

  function assistantRefinementTargetsAbout(refinementText: string): boolean {
    const text = normalizeAssistantIntentText(refinementText);
    if (/\b(about|bio|paragraph|page)\b/.test(text)) return true;
    return !/\b(blog|post|article|title)\b/.test(text);
  }

  function assistantRefinementTargetsPost(refinementText: string): boolean {
    const text = normalizeAssistantIntentText(refinementText);
    if (/\b(blog|post|article|title)\b/.test(text)) return true;
    return !/\b(about|bio)\b/.test(text);
  }

  function extractAssistantRequestedTitle(refinementText: string): string {
    const match =
      refinementText.match(/\btitle (?:to|as)\s+["“]([^"”]+)["”]/i) ||
      refinementText.match(/\bcalled\s+["“]([^"”]+)["”]/i);
    return match?.[1]?.trim() || "";
  }

  function assistantSiteDraftForPublish(
    draft: AssistantSiteUpdateDraft,
  ): AssistantSiteUpdateDraft {
    if (!draft.changes.postFile || draft.changes.postDraft !== true) return draft;

    const profile = parseSiteProfile(draft.sourceFiles["me.json"] || "{}", draft.siteUsername);
    const postFile = normalizeSiteFileName(draft.changes.postFile);
    const postSlug = draft.changes.postSlug || "";
    const post = (profile.posts || []).find(
      (candidate) =>
        candidate.slug === postSlug ||
        normalizeSiteFileName(candidate.file || "") === postFile,
    );
    if (post) {
      post.draft = false;
      post.publishedAt ||= new Date().toISOString().slice(0, 10);
    }

    return {
      ...draft,
      sourceFiles: {
        ...draft.sourceFiles,
        "me.json": JSON.stringify(profile, null, 2),
      },
      changes: {
        ...draft.changes,
        postDraft: false,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async function publishAssistantSiteDraft(
    env: Env,
    site: DbSite,
    draft: AssistantSiteUpdateDraft,
  ): Promise<DbSite> {
    const manifest = (await loadPublishManifest(env, site.id)) || createEmptyPublishManifest();
    for (const [name, content] of Object.entries(draft.sourceFiles)) {
      const sourceName = normalizeSiteFileName(name);
      if (!sourceName || shouldIgnoreSiteSourceFile(sourceName)) continue;
      await putSiteFile(env, site.id, `src/${sourceName}`, content, getContentType(sourceName));
      manifest.sourceFiles[sourceName] = await sha256Text(content);
    }

    const profile = parseSiteProfile(draft.sourceFiles["me.json"] || "{}", site.username);
    await pruneUnreferencedSiteSourceFiles(env, site.id, profile, manifest);
    const sourceFiles = await loadSiteSourceFiles(env, site.id);
    const generatedFiles = await generateSiteHtml(
      profile,
      Array.from(sourceFiles.entries()).map(([name, content]) => ({ name, content })),
      undefined, { baseUrl: await getPublishedSiteBaseUrl(env, site), images: await getSiteImageMetadata(env, site, [...sourceFiles.values()]) },
    );
    generatedFiles["me.json"] = JSON.stringify(
      buildPublicMe3Profile(profile, await getPublishedSiteBaseUrl(env, site)),
      null,
      2,
    );
    for (const [name, content] of Object.entries(generatedFiles)) {
      await putSiteFile(
        env,
        site.id,
        `public/${normalizeSiteFileName(name)}`,
        content,
        getGeneratedSiteContentType(name),
      );
    }
    await pruneGeneratedPublicFiles(env, site.id, generatedFiles);
    manifest.updatedAt = new Date().toISOString();
    await savePublishManifest(env, site.id, manifest);
    await env.DB.prepare(
      "UPDATE sites SET published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(site.id)
      .run();
    await deleteSiteFile(env, site.id, assistantSiteDraftPath(draft.threadId));

    return {
      ...site,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async function saveAssistantSiteUpdateDraft(
    env: Env,
    draft: AssistantSiteUpdateDraft,
  ): Promise<void> {
    for (const [name, content] of Object.entries(draft.sourceFiles)) {
      const sourceName = normalizeSiteFileName(name);
      if (!sourceName || shouldIgnoreSiteSourceFile(sourceName)) continue;
      await putSiteFile(
        env,
        draft.siteId,
        `src/${sourceName}`,
        content,
        getContentType(sourceName),
      );
    }

    await putSiteFile(
      env,
      draft.siteId,
      assistantSiteDraftPath(draft.threadId),
      JSON.stringify(draft, null, 2),
      "application/json",
    );
  }

  async function loadAssistantSiteUpdateDraft(
    env: Env,
    siteId: string,
    threadId: string,
  ): Promise<AssistantSiteUpdateDraft | null> {
    const content = await getSiteFileText(env, siteId, assistantSiteDraftPath(threadId));
    if (!content) return null;
    try {
      const parsed = JSON.parse(content) as unknown;
      return isAssistantSiteUpdateDraft(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function isAssistantSiteUpdateDraft(value: unknown): value is AssistantSiteUpdateDraft {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const draft = value as AssistantSiteUpdateDraft;
    return (
      draft.version === 1 &&
      draft.kind === "profile_site_update" &&
      typeof draft.siteId === "string" &&
      typeof draft.siteUsername === "string" &&
      typeof draft.threadId === "string" &&
      Boolean(draft.sourceFiles) &&
      typeof draft.sourceFiles === "object" &&
      !Array.isArray(draft.sourceFiles)
    );
  }

  function assistantSiteDraftPath(threadId: string): string {
    const safeThreadId = threadId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 180);
    return `assistant/site-update-drafts/${safeThreadId || "thread"}.json`;
  }

  function assistantSiteDraftChangedFiles(draft: AssistantSiteUpdateDraft): string[] {
    const files = new Set<string>();
    if (draft.changes.aboutFile) files.add(draft.changes.aboutFile);
    for (const pageFile of draft.changes.pageFiles || []) files.add(pageFile);
    if (draft.changes.postFile) files.add(draft.changes.postFile);
    files.add("me.json");
    return Array.from(files);
  }

  function formatAssistantSiteDraftReply(
    draft: AssistantSiteUpdateDraft,
    env: Env,
    site: DbSite,
    requestUrl: string,
  ): string {
    const parts = ["Draft saved. I updated your site draft."];
    if (draft.changes.bio) {
      parts.push("Bio: updated the short profile bio in me.json.");
    }
    if (draft.changes.aboutFile) {
      parts.push(`About page: added a new paragraph to ${draft.changes.aboutFile}.`);
    }
    if (draft.changes.postTitle && draft.changes.postFile) {
      const label = draft.changes.postDraft ? "Blog draft title" : "Blog title";
      parts.push(`${label}: "${draft.changes.postTitle}".`);
    }
    if (draft.changes.pageFiles?.length) {
      parts.push(`Pages: updated ${draft.changes.pageFiles.join(", ")}.`);
    }
    if (draft.changes.generatedBy?.fallbackReason) {
      parts.push(`Generation note: I could not reach the configured model, so I used a local fallback (${draft.changes.generatedBy.fallbackReason}).`);
    } else if (draft.changes.generatedBy?.model) {
      parts.push(`Generated with ${draft.changes.generatedBy.model}.`);
    }
    const url = getAssistantSiteDraftReviewUrl(env, site, draft, requestUrl);
    if (url) parts.push(`Review it in your site dashboard: ${url}`);
    parts.push("Reply `publish` to publish it now, or tell me what to change.");
    return parts.join("\n\n");
  }

  function formatAssistantSiteRefinedReply(draft: AssistantSiteUpdateDraft): string {
    const parts = ["I updated your pending site draft."];
    if (draft.changes.bio) parts.push("Bio: revised the short profile bio.");
    if (draft.changes.aboutFile) parts.push(`About page: revised ${draft.changes.aboutFile}.`);
    if (draft.changes.postTitle && draft.changes.postFile) {
      parts.push(`Blog: revised "${draft.changes.postTitle}" at ${draft.changes.postFile}.`);
    }
    if (draft.changes.generatedBy?.fallbackReason) {
      parts.push(`Generation note: I used a local fallback (${draft.changes.generatedBy.fallbackReason}).`);
    } else if (draft.changes.generatedBy?.model) {
      parts.push(`Generated with ${draft.changes.generatedBy.model}.`);
    }
    parts.push("Reply `publish` when it looks right, or send another change.");
    return parts.join("\n\n");
  }

  function formatAssistantSitePublishedReply(
    env: Env,
    site: DbSite,
    draft: AssistantSiteUpdateDraft,
    requestUrl: string,
  ): string {
    const postIsDraft = draft.changes.postDraft === true && Boolean(draft.changes.postTitle);
    const parts = [
      postIsDraft
        ? "Saved. I updated your site with a blog draft."
        : "Published. I updated your site.",
    ];
    if (draft.changes.bio) parts.push("Bio: updated the short profile bio.");
    if (draft.changes.aboutFile) parts.push(`About page: ${draft.changes.aboutFile}.`);
    if (draft.changes.postTitle) {
      const label = postIsDraft ? "Blog draft title" : "Blog title";
      parts.push(`${label}: "${draft.changes.postTitle}".`);
    }
    const url = getAssistantSiteAdminUrl(
      env,
      site,
      requestUrl,
      draft.changes.postTitle ? "blog" : null,
    );
    if (url) {
      parts.push(
        postIsDraft
          ? `Review it in your site dashboard: ${url}`
          : `Open your site dashboard: ${url}`,
      );
    }
    return parts.join("\n\n");
  }

  function getAssistantSiteDraftReviewUrl(
    env: Env,
    site: DbSite,
    draft: AssistantSiteUpdateDraft,
    requestUrl: string,
  ): string | null {
    return getAssistantSiteAdminUrl(
      env,
      site,
      requestUrl,
      draft.changes.postTitle ? "blog" : null,
    );
  }

  function getAssistantSiteAdminUrl(
    env: Env,
    site: DbSite,
    requestUrl: string,
    editStep: string | null = null,
  ): string | null {
    const origin = getCoreWebOrigin(env, requestUrl);
    if (!origin) return null;
    const url = new URL(`/sites/${encodeURIComponent(site.username)}`, origin);
    if (editStep) url.searchParams.set("edit", editStep);
    return url.toString();
  }

  function appendAssistantParagraph(markdown: string, paragraph: string): string {
    const base = markdown.trimEnd();
    return `${base}\n\n${paragraph.trim()}\n`;
  }

  function replaceAssistantParagraph(markdown: string, previous: string, next: string): string {
    if (markdown.includes(previous)) return markdown.replace(previous, next);
    return appendAssistantParagraph(markdown, next);
  }

  function parseAssistantSiteDraftFromAssistantText(
    text: string,
  ): ParsedAssistantSiteDraftContent | null {
    const normalized = text.replace(/\r\n/g, "\n");
    const parsed: ParsedAssistantSiteDraftContent = {};
    const bioMatch = normalized.match(
      /(?:Short\s+Bio|Bio):\s*([\s\S]*?)(?=\n{0,2}\s*(?:About Page|Blog Post|Post|Article):|$)/i,
    );
    if (bioMatch?.[1]) {
      parsed.bio = normalizeAssistantProfileBio(cleanAssistantGeneratedSnippet(bioMatch[1]));
    }

    const aboutMatch = normalized.match(
      /About Page(?:\s+(?:Paragraph|Update))?:\s*([\s\S]*?)(?=\n{0,2}\s*(?:Blog Post|Post|Article):|$)/i,
    );
    if (aboutMatch?.[1]) {
      parsed.aboutParagraph = cleanAssistantGeneratedSnippet(aboutMatch[1]);
    }

    const blogMatch = normalized.match(/(?:Blog Post|Post|Article):\s*([\s\S]*)/i);
    if (blogMatch?.[1]) {
      const blogSection = cleanAssistantGeneratedSnippet(blogMatch[1]);
      const titleBodyMatch = blogSection.match(/^["'“”]?([^"'“”:\n]{3,140})["'“”]?\s*:\s*([\s\S]+)$/);
      if (titleBodyMatch) {
        parsed.postTitle = cleanAssistantGeneratedSnippet(titleBodyMatch[1]);
        parsed.postBody = cleanAssistantGeneratedSnippet(titleBodyMatch[2]);
      } else {
        parsed.postBody = blogSection;
      }
    }

    if (!parsed.bio && !parsed.aboutParagraph && !parsed.postBody) return null;
    return parsed;
  }

  function cleanAssistantGeneratedSnippet(value: string): string {
    return value
      .replace(/^```(?:markdown|md)?/i, "")
      .replace(/```$/i, "")
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();
  }

  function assistantRequestMentionsAbout(requestText: string): boolean {
    return /\b(about page|about section|about me)\b/i.test(requestText);
  }

  function assistantRequestMentionsBioField(requestText: string): boolean {
    return /\b(short bio|bio field|profile bio|my bio|bio)\b/i.test(requestText) &&
      !/\b(about page|about section|about me)\b/i.test(requestText);
  }

  function normalizeAssistantProfileBio(value: string): string {
    return value
      .replace(/^#+\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
  }

  function generateAssistantShortBio(requestText: string): string {
    const quoted =
      requestText.match(/\b(?:bio|short bio|bio field)\b[^"'“”]*["'“]([^"'”]+)["'”]/i) ||
      requestText.match(/\b(?:say|to)\s+["'“]([^"'”]+)["'”]/i);
    return normalizeAssistantProfileBio(
      quoted?.[1] || "Personal AI assistant builder focused on practical tools, thoughtful systems, and useful momentum.",
    );
  }

  function assistantRequestMentionsBlogPost(requestText: string): boolean {
    return /\b(blog post|post about|article about|blog|article)\b/i.test(requestText);
  }

  function assistantRequestAsksForDraftPost(requestText: string): boolean {
    const text = normalizeAssistantIntentText(requestText);
    return /\b(draft|save as draft|do not publish|don't publish|unpublished)\b/.test(text);
  }

  function assistantRequestAsksToPublishSiteUpdate(requestText: string): boolean {
    const text = normalizeAssistantIntentText(requestText);
    return /\b(publish|make it live|ship it|go live)\b/.test(text);
  }

  function assistantSiteBlogPostShouldStayDraft(requestText: string): boolean {
    if (assistantRequestAsksToPublishSiteUpdate(requestText)) return false;
    return true;
  }

  function extractAssistantBlogTopic(requestText: string): string {
    const quoted =
      requestText.match(/\b(?:blog post|post|article)\s+(?:about|on)\s+["'“]([^"'”]+)["'”]/i) ||
      requestText.match(/\b(?:about|on)\s+["'“]([^"'”]+)["'”]/i);
    if (quoted?.[1]) return cleanAssistantBlogTopic(quoted[1]);

    const unquoted = requestText.match(/\b(?:blog post|post|article)\s+(?:about|on)\s+([^.!?\n]+)(?:[.!?\n]|$)/i);
    if (unquoted?.[1]) return cleanAssistantBlogTopic(unquoted[1]);
    return "personal AI assistants";
  }

  function cleanAssistantBlogTopic(value: string): string {
    const topic = value
      .replace(/\s+/g, " ")
      .replace(/[,;:]\s*(?:just|only)\b.*$/i, "")
      .replace(/\b(?:just|only)\s+(?:the\s+)?(?:outline|structure|draft)\b.*$/i, "")
      .replace(/\b(?:i(?:'ll| will)|i can)\s+write\b.*$/i, "")
      .replace(/\b(?:and then|then|also)\b.*$/i, "")
      .replace(/[,"'“”‘’]+$/g, "")
      .trim();
    return topic || "personal AI assistants";
  }

  function assistantBlogTitleFromTopic(topic: string): string {
    const normalizedTopic = topic.trim() || "personal AI assistants";
    return `The Rise of ${titleCaseAssistantSiteText(normalizedTopic)}`;
  }

  function titleCaseAssistantSiteText(value: string): string {
    return value
      .replace(/[-_]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => {
        const lower = word.toLowerCase();
        if (lower === "ai") return "AI";
        if (lower === "me3") return "ME3";
        return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
      })
      .join(" ");
  }

  function slugifyAssistantSitePath(value: string): string {
    const slug = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return slug || "personal-ai-assistants";
  }

  function generateAssistantAboutParagraph(requestText: string): string {
    const text = normalizeAssistantIntentText(requestText);
    if (/\b(short|shorter|concise|tight)\b/.test(text)) {
      return "This space collects experiments in creative work, useful systems, and personal AI assistants, turning scattered ideas into practical momentum.";
    }
    if (/\b(playful|fun|weird|lighter)\b/.test(text)) {
      return "This site is my little workshop for curious experiments: part notebook, part launchpad, and part invitation to see what happens when personal AI assistants help ideas find their next shape.";
    }
    if (/\b(professional|serious|polished|clear)\b/.test(text)) {
      return "This site brings together my work on practical systems, creative exploration, and personal AI assistants, with a focus on turning emerging ideas into clear, useful outcomes.";
    }
    return "This site is a living notebook for experiments in creative systems, personal AI assistants, and the small practical rituals that turn scattered ideas into momentum.";
  }

  function generateAssistantBlogPostMarkdown(
    topic: string,
    title: string,
    requestText: string,
  ): string {
    const text = normalizeAssistantIntentText(requestText);
    if (/\b(short|shorter|concise|tight)\b/.test(text)) {
      return normalizeAssistantPostMarkdown(
        title,
        `Personal AI assistants are becoming less like flashy software and more like everyday infrastructure. The best ones remember context, reduce coordination drag, and help people move from intention to action without turning the day into another dashboard.\n\nThe interesting shift is not that assistants can answer questions. It is that they can quietly hold the thread: the note you meant to write, the follow-up you almost forgot, the idea that needs one more pass before it becomes useful.`,
      );
    }
    if (/\b(playful|fun|weird|lighter)\b/.test(text)) {
      return normalizeAssistantPostMarkdown(
        title,
        `Personal AI assistants are starting to feel less like tools and more like tiny studios that fit in the corner of your day. They can catch loose thoughts, sort half-formed plans, and nudge ideas from "someday" into "let's try this now."\n\nThe magic is not that they do everything for us. It is that they make it easier to stay in motion. A good assistant keeps the boring bits from swallowing the bright bits, which leaves more room for curiosity, taste, and actual follow-through.`,
      );
    }
    return normalizeAssistantPostMarkdown(
      title,
      `Personal AI assistants are moving from novelty to quiet infrastructure. Instead of asking people to manage another tool, the most useful assistants sit close to the work: they remember context, surface next steps, and help turn loose intentions into visible progress.\n\nThe real promise is not automation for its own sake. It is continuity. A personal assistant can hold the thread between a note, a conversation, a calendar commitment, and a half-finished idea, making it easier to return to the work with less friction.\n\nAs these systems mature, the best ones will feel less like command centers and more like trusted companions for attention. They will help people notice what matters, protect time for deeper work, and move steadily from possibility to practice.`,
    );
  }

  function normalizeAssistantPostMarkdown(title: string, body: string): string {
    const cleanBody = cleanAssistantGeneratedSnippet(body);
    if (/^#\s+/m.test(cleanBody)) return `${cleanBody.trim()}\n`;
    return `# ${title.trim()}\n\n${cleanBody.trim()}\n`;
  }

  function markdownExcerpt(markdown: string): string {
    return markdown
      .replace(/^#.+$/gm, "")
      .replace(/[#*_>`[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
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
      messages: (rows.results || []).map(serializeAssistantMessage),
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
      messages: (rows.results || []).map(serializeAssistantMessage),
    });
  });

  async function handleAssistantChatTurn(c: Context<{ Bindings: Env }>) {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    if (!(await isCorePluginEnabled(c.env, "me3.agent-chat"))) {
      return c.json(
        { ok: false, error: "Agent Chat plugin is disabled" },
        403,
      );
    }

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
    const replay = await getAgentSandboxTurnResult(c.env, ownerId, requestId);
    if (replay) return c.json({ mode, ...replay });
    const siteToolsEnabled = assistantSiteToolsEnabled(c.env);
    const scopeParse = siteToolsEnabled
      ? parseAssistantScopes(displayMessageText, body.scopes)
      : null;
    const messageText = scopeParse?.cleanMessageText || displayMessageText;
    const siteScopeAllowed = scopeParse ? assistantScopesIncludeSite(scopeParse.scopes) : false;
    const selectedModel = parseAssistantChatTurnModelSelection(body.model);
    if (selectedModel && "error" in selectedModel) {
      return c.json({ ok: false, error: selectedModel.error }, 400);
    }
    const requestedThreadId = normalizeAssistantThreadId(body.threadId);
    const requestedProjectId = normalizeNullableText(body.projectId);
    const attachmentManifest = createAssistantAttachmentAuditManifest(body.attachments);
    const userMessageMetadata = assistantUserMessageMetadataFromManifest(
      attachmentManifest,
      scopeParse || undefined,
    );

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

    const builderAction = await createAssistantJobBuilderAction(c.env, ownerId, messageText);
    if (builderAction) {
      const replyText = assistantJobBuilderReplyText(builderAction);
      await persistAssistantTurnMessages(
        c.env,
        ownerId,
        thread.id,
        displayMessageText,
        replyText,
        {},
        userMessageMetadata,
      );
      await touchAssistantThread(c.env, ownerId, thread.id);
      return c.json({
        ok: true,
        auditId: null,
        turnId: null,
        threadId: thread.id,
        mode,
        specialist: "core.job-builder",
        replyText,
        model: null,
        source: "tool",
        jobBuilderAction: builderAction,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      });
    }

    if (siteToolsEnabled) {
      const scopeRequiredReply = siteScopeAllowed
        ? null
        : await assistantSiteScopeRequiredReply(c.env, ownerId, thread.id, messageText);
      const scopeDecision = assistantScopeDecision(
        scopeParse?.scopes || [],
        siteScopeAllowed || Boolean(scopeRequiredReply),
      );
      if (scopeRequiredReply) {
        await persistAssistantTurnMessages(
          c.env,
          ownerId,
          thread.id,
          displayMessageText,
          scopeRequiredReply,
          { assistantScopeDecision: scopeDecision },
          userMessageMetadata,
        );
        await touchAssistantThread(c.env, ownerId, thread.id);
        return c.json({
          ...buildAssistantScopeRequiredPayload(thread.id, scopeRequiredReply, scopeDecision),
          mode,
        });
      }

      const siteAction = siteScopeAllowed && mode === "everyday"
        ? await maybeHandleAssistantSiteToolAction(
            c.env,
            ownerId,
            thread.id,
            messageText,
            c.req.url,
            selectedModel,
          )
        : null;
      if (siteAction) {
        await persistAssistantTurnMessages(
          c.env,
          ownerId,
          thread.id,
          displayMessageText,
          siteAction.replyText,
          { siteAction: siteAction.siteAction, assistantScopeDecision: scopeDecision },
          userMessageMetadata,
        );
        await touchAssistantThread(c.env, ownerId, thread.id);
        return c.json({
          ...buildAssistantSiteToolPayload(thread.id, siteAction, scopeDecision),
          mode,
        });
      }
    }

    const attachmentTextContext = await loadAssistantAttachmentTextContext(
      c.env,
      ownerId,
      attachmentManifest,
    );

    const runtime = c.env.ME3_USER_AGENT;
    if (!runtime) {
      return c.json(
        { ok: false, error: "Agent chat runtime is not configured" },
        503,
      );
    }

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
        ...(scopeParse
          ? {
              assistantScopes: scopeParse.scopes,
              assistantScopeTokens: scopeParse.scopeTokens,
            }
          : {}),
        attachmentCount: Array.isArray(body.attachments) ? body.attachments.length : 0,
        attachmentManifest,
      },
    });

    const id = runtime.idFromName(ownerId);
    const stub = runtime.get(id);
    const response = await stub.fetch(
      "https://me3-core-user-agent.internal/dispatch/sandbox",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
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

    await touchAssistantThread(c.env, ownerId, thread.id);
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
    const siteToolsEnabled = assistantSiteToolsEnabled(c.env);
    const scopeParse = siteToolsEnabled
      ? parseAssistantScopes(displayMessageText, body.scopes)
      : null;
    const messageText = scopeParse?.cleanMessageText || displayMessageText;
    const siteScopeAllowed = scopeParse ? assistantScopesIncludeSite(scopeParse.scopes) : false;
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
    const userMessageMetadata = assistantUserMessageMetadataFromManifest(
      attachmentManifest,
      scopeParse || undefined,
    );
    const streamStartedAt = performance.now();
    const routePerformance: AssistantChatRoutePerformance = {
      version: 1,
      handlerPreStreamMs: assistantRouteDurationMs(handlerStartedAt),
      replayLookupMs: null,
      threadResolutionMs: null,
      jobBuilderCheckMs: null,
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
          const replayLookupStartedAt = performance.now();
          const replay = await getAgentSandboxTurnResult(
            c.env,
            ownerId,
            requestId,
          );
          routePerformance.replayLookupMs = assistantRouteDurationMs(
            replayLookupStartedAt,
          );
          if (replay) {
            if (replay.threadId) send("thread", { threadId: replay.threadId });
            await sendAssistantStreamText(send, replay.replyText || "");
            send("done", { mode, ...replay } as unknown as Record<string, unknown>);
            return;
          }
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

          const jobBuilderCheckStartedAt = performance.now();
          const builderAction = await createAssistantJobBuilderAction(c.env, ownerId, messageText);
          routePerformance.jobBuilderCheckMs = assistantRouteDurationMs(
            jobBuilderCheckStartedAt,
          );
          if (builderAction) {
            const replyText = assistantJobBuilderReplyText(builderAction);
            await persistAssistantTurnMessages(
              c.env,
              ownerId,
              thread.id,
              displayMessageText,
              replyText,
              {},
              userMessageMetadata,
            );
            await touchAssistantThread(c.env, ownerId, thread.id);
            await sendAssistantStreamText(send, replyText);
            send("done", {
              ok: true,
              auditId: null,
              turnId: null,
              threadId: thread.id,
              mode,
              specialist: "core.job-builder",
              replyText,
              model: null,
              source: "tool",
              jobBuilderAction: builderAction,
              emailAction: null,
              reminderAction: null,
              contentAction: null,
              contactsChanged: false,
            });
            return;
          }

          if (siteToolsEnabled) {
            const siteScopeCheckStartedAt = performance.now();
            const scopeRequiredReply = siteScopeAllowed
              ? null
              : await assistantSiteScopeRequiredReply(c.env, ownerId, thread.id, messageText);
            const scopeDecision = assistantScopeDecision(
              scopeParse?.scopes || [],
              siteScopeAllowed || Boolean(scopeRequiredReply),
            );
            if (scopeRequiredReply) {
              await persistAssistantTurnMessages(
                c.env,
                ownerId,
                thread.id,
                displayMessageText,
                scopeRequiredReply,
                { assistantScopeDecision: scopeDecision },
                userMessageMetadata,
              );
              await touchAssistantThread(c.env, ownerId, thread.id);
              await sendAssistantStreamText(send, scopeRequiredReply);
              send(
                "done",
                {
                  ...buildAssistantScopeRequiredPayload(
                    thread.id,
                    scopeRequiredReply,
                    scopeDecision,
                  ),
                  mode,
                },
              );
              return;
            }

            const siteAction = siteScopeAllowed && mode === "everyday"
              ? await maybeHandleAssistantSiteToolAction(
                  c.env,
                  ownerId,
                  thread.id,
                  messageText,
                  c.req.url,
                  selectedModel,
                )
              : null;
            routePerformance.siteScopeCheckMs = assistantRouteDurationMs(
              siteScopeCheckStartedAt,
            );
            if (siteAction) {
              await persistAssistantTurnMessages(
                c.env,
                ownerId,
                thread.id,
                displayMessageText,
                siteAction.replyText,
                { siteAction: siteAction.siteAction, assistantScopeDecision: scopeDecision },
                userMessageMetadata,
              );
              await touchAssistantThread(c.env, ownerId, thread.id);
              await sendAssistantStreamText(send, siteAction.replyText);
              send("done", {
                ...buildAssistantSiteToolPayload(thread.id, siteAction, scopeDecision),
                mode,
              });
              return;
            }
          }

          const runtime = c.env.ME3_USER_AGENT;
          if (!runtime) {
            send("error", { ok: false, error: "Agent chat runtime is not configured" });
            return;
          }

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
              ...(scopeParse
                ? {
                    assistantScopes: scopeParse.scopes,
                    assistantScopeTokens: scopeParse.scopeTokens,
                  }
                : {}),
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

          const id = runtime.idFromName(ownerId);
          const stub = runtime.get(id);
          const durableObjectHeadersStartedAt = performance.now();
          const response = await stub.fetch(
            "https://me3-core-user-agent.internal/dispatch/sandbox/stream",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: c.req.raw.signal,
              body: JSON.stringify({
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
              }),
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
            await touchAssistantThread(c.env, ownerId, thread.id);
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

          await touchAssistantThread(c.env, ownerId, thread.id);
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

  function assistantUserMessageMetadataFromManifest(
    attachments: AssistantAttachmentAuditManifestItem[],
    scopeParse?: AssistantScopeParseResult,
  ): Record<string, unknown> | null {
    const metadata: Record<string, unknown> = {};
    const readyAttachments = attachments.filter(
      (attachment) => attachment.status === "ready" && attachment.id,
    );
    if (readyAttachments.length) metadata.attachments = readyAttachments;
    if (scopeParse?.scopes.length) metadata.assistantScopes = scopeParse.scopes;
    if (scopeParse?.scopeTokens.length) metadata.assistantScopeTokens = scopeParse.scopeTokens;
    return Object.keys(metadata).length ? metadata : null;
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

  app.post("/api/assistant/chat/turn", handleAssistantChatTurn);
  app.post("/api/assistant/chat/turn/stream", handleAssistantChatTurnStream);
  app.post("/api/agent/sandbox", handleAssistantChatTurn);

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

    const threadId = `soulink:${conversationId}`;
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
    const threadReady = await ensureAgentChannelAssistantThread(c.env, {
      userId: connection.user_id,
      threadId,
      messageText,
    });
    if (!threadReady) {
      const error = "Soulink assistant thread could not be prepared";
      await updateAgentChannelInboundDispatchStatus(c.env, claimed.id, "failed", error);
      return c.json({ ok: false, error }, 409);
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

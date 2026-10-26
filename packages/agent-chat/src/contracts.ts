import type { Me3AgentContextManifest } from "@me3/knowledge";
import type { CoreChatToolPlannerDecision } from "./capabilities";
import type { AssistantImageCapability } from "./model-capabilities";

export type AgentModelUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };

export const AGENT_CHAT_PLUGIN_ID = "me3.agent-chat";

export const AGENT_CHAT_MODES = ["everyday", "advanced", "owner"] as const;

export const ME3_DEPLOYMENT_MODES = ["managed", "self_hosted"] as const;

export type AgentChatMode = (typeof AGENT_CHAT_MODES)[number];

export type Me3DeploymentMode = (typeof ME3_DEPLOYMENT_MODES)[number];

export function normalizeMe3DeploymentMode(value: unknown): Me3DeploymentMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ME3_DEPLOYMENT_MODES.includes(normalized as Me3DeploymentMode)
    ? (normalized as Me3DeploymentMode)
    : null;
}

export function allowsAgentChatRawModelSelection(env: {
  ME3_DEPLOYMENT_MODE?: string;
  ME3_AI_RAW_MODEL_SELECTION_ENABLED?: string;
}): boolean {
  const deploymentMode = normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE);
  return (
    deploymentMode === "self_hosted" ||
    (deploymentMode === "managed" &&
      /^(1|true|yes)$/i.test(
        env.ME3_AI_RAW_MODEL_SELECTION_ENABLED?.trim() || "",
      ))
  );
}

export const AGENT_CHAT_RUNTIME = {
  id: AGENT_CHAT_PLUGIN_ID,
  packageName: "@me3-core/agent",
  bundled: true,
  runtimeStatus: "assistant_chat_runtime",
  routes: ["/api/assistant/chat/turn", "/api/agent/sandbox"],
  notes: [
    "Core runs owner chat through @me3-core/agent and its ME3_AGENT Durable Object.",
    "The plugin is enabled by default because agent chat is part of the baseline ME3 experience.",
    "The agent-chat package retains shared domain services and wire contracts; plugin tools remain owned by their enabled plugins.",
  ],
} as const;

export type AgentChatSource =
  | "openai"
  | "anthropic"
  | "workers-ai"
  | "workers-ai-gateway"
  | "fallback"
  | "tool"
  | null;

export type AgentSandboxDispatchInput = {
  userId: string;
  requestId: string;
  connectionId: string;
  sourceEventId: string;
  turnId: string;
  mode?: AgentChatMode;
  threadId?: string | null;
  messageText: string;
  attachmentTextContext?: string | null;
  replyToMessageId?: string | number | null;
  selectedModel?: AgentChatModelSelection | null;
  attachments?: AgentChatAttachmentReference[];
};

export type AgentChatAttachmentReference = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  kind?: "text" | "image" | string | null;
  status?: string | null;
  storageKey?: string | null;
  hasText?: boolean | null;
  textTruncated?: boolean | null;
};

export type AgentChatModelSelection = {
  providerId: AiProviderId;
  model: string;
  optionId?: string | null;
};

export type AgentChatActionCardStatus =
  | "draft"
  | "pending_approval"
  | "pending"
  | "complete"
  | "failed";

export type AgentChatActionCardField = {
  label: string;
  value: string;
};

export type AgentChatActionCardLink = {
  label: string;
  href: string;
};

export type AgentChatActionCardRecord = {
  kind:
    | "mailbox_draft"
    | "reminder"
    | "calendar_event"
    | "mission_task"
    | "site"
    | "landing_page"
    | "social_post"
    | "social_suggestion"
    | "social_posting_plan";
  id: string;
};

export type AgentChatActionCard = {
  id: string;
  kind:
    | "mailbox.draft_saved"
    | "reminder.created"
    | "reminder.updated"
    | "reminder.cancelled"
    | "calendar.event_created"
    | "mission.task_created"
    | "mission.task_updated"
    | "mission.task_archived"
    | "sites.landing_page_created"
    | "sites.landing_page_updated"
    | "social.draft_saved"
    | "social.suggestions_created"
    | "social.posting_plan_proposed"
    | "social.posting_plan_confirmed";
  capabilityId: string;
  title: string;
  summary: string | null;
  status: AgentChatActionCardStatus;
  statusLabel: string;
  changed: AgentChatActionCardField[];
  records: AgentChatActionCardRecord[];
  primaryAction: AgentChatActionCardLink | null;
  secondaryActions: AgentChatActionCardLink[];
};

export type AgentChatStreamMetrics = {
  timeToFirstTokenMs: number | null;
  totalDurationMs: number;
  deltaCount: number;
  modelRequestCount: number;
  modelRequestDurationMs: number;
  toolCallCount: number;
  toolExecutionDurationMs: number;
  inputCharacterCount: number;
  availableToolCount: number;
  toolSchemaCharacterCount: number;
};

export type AgentChatPerformanceMetrics = {
  version: 1;
  resultSource: "fresh" | "memory_cache" | "database_replay";
  memoryCacheLookupMs: number;
  databaseReplayLookupMs: number;
  statePreparationMs: number;
  ownerProfileMs: number | null;
  toolPlanMs: number | null;
  routeResolutionMs: number | null;
  setupAndContextMs: number | null;
  contextLoadMs: number | null;
  imageInputMs: number | null;
  executionMs: number | null;
  messagePersistenceMs: number | null;
  beforeResultPersistenceMs: number;
  durableObjectFirstEventMs?: number | null;
  durableObjectTotalMs?: number;
};

export type AgentChatRuntimeStreamEvent = {
  event: "status" | "tool" | "delta";
  data: Record<string, unknown>;
};

export type AgentChatRuntimeStreamOptions = {
  signal?: AbortSignal;
  onEvent(event: AgentChatRuntimeStreamEvent): void | Promise<void>;
};

export type AgentOwnerContentSourceReference = {
  sourceType: "journal" | "note" | "mission_task";
  sourceId: string;
};

export type AgentPeopleSearchReference = {
  results: Array<{
    position: number;
    kind: "link" | "public_profile";
    name: string;
    contactName: string | null;
    profileId: string | null;
  }>;
};

export type AgentSandboxDispatchResponse = {
  ok: boolean;
  auditId: string | null;
  turnId: string | null;
  mode?: AgentChatMode;
  threadId?: string | null;
  specialist: string | null;
  replyText: string | null;
  model: string | null;
  source: AgentChatSource;
  fallbackReason?: string | null;
  debugError?: string | null;
  contextPacketId?: string | null;
  contextManifest?: Me3AgentContextManifest | null;
  contextSummary?: string | null;
  emailAction?: {
    kind: "drafted" | "sent";
    draftId?: string;
  } | null;
  reminderAction?: {
    kind: "created" | "updated" | "cancelled" | "dismissed" | "listed";
    reminderId?: string;
    title?: string;
    remindAt?: string;
  } | null;
  actionCards?: AgentChatActionCard[] | null;
  imageAction?: AgentChatImageAction | null;
  contentAction?: {
    kind: "saved";
    postId: string;
    platforms: Array<"x" | "linkedin" | "instagram" | "instagram_business" | "youtube" | "tiktok">;
  } | null;
  modelAttempts?: AgentChatModelAttemptTrace[] | null;
  streamMetrics?: AgentChatStreamMetrics | null;
  performance?: AgentChatPerformanceMetrics | null;
  trace?: AgentChatTurnTrace | null;
  sourceReference?: AgentOwnerContentSourceReference | null;
  peopleSearchReference?: AgentPeopleSearchReference | null;
  error?: string;
};

export type AgentChatImageAction = {
  kind: "generated" | "edited" | "blocked";
  status: "complete" | "failed" | "blocked";
  prompt: string;
  revisedPrompt: string | null;
  providerId: string | null;
  model: string | null;
  reason?: string | null;
  assets: Array<{
    id: string;
    attachmentId: string;
    name: string;
    mimeType: string;
    size: number;
    width?: number | null;
    height?: number | null;
    url: string;
    storageKey: string;
  }>;
};

export type AgentChatModelAttemptTrace = {
  providerId: AiProviderId;
  model: string;
  status: "succeeded" | "empty" | "failed";
  error: string | null;
  durationMs?: number;
  modelRequestDurationMs?: number;
  modelRequestCount?: number;
  gatewayLogIds?: string[];
};

export type AgentChatTurnTrace = {
  turnId: string;
  planner: CoreChatToolPlannerDecision;
  route: {
    path: "tool" | "model" | "fallback";
    capabilityId: string;
    ownerFacingLabel: string;
    handlerRoute: string;
    reason: string;
    setupChecks: string[];
    approvalRequired: boolean;
    sideEffectLevel: string;
    auditEventKind: string;
  };
  selectedModel: {
    providerId: AiProviderId;
    model: string;
    backupModel: string | null;
    configured: boolean;
    responseModel: string | null;
  } | null;
  context: {
    status: "not_attempted" | "loaded" | "failed";
    packetId: string | null;
    summary: string | null;
    characterCount: number;
    loadDurationMs: number | null;
    sourceCount: number;
    sources: Array<{
      id: string;
      kind: string;
      label: string | null;
      visibility: string | null;
      reason: string | null;
    }>;
    error: string | null;
  };
  modelCall: {
    status: "not_attempted" | "succeeded" | "failed" | "fallback";
    providerId: AiProviderId | null;
    model: string | null;
    fallbackReason: string | null;
    debugError: string | null;
    attempts: AgentChatModelAttemptTrace[];
  };
  streaming: AgentChatStreamMetrics | null;
  imageGeneration?: {
    intent: "generate" | "edit";
    status: "blocked" | "started" | "succeeded" | "failed";
    providerId: AiProviderId | null;
    model: string | null;
    capabilityChecked: AssistantImageCapability;
    assetCount: number;
    error: string | null;
  } | null;
  toolResult: {
    status: "not_attempted" | "succeeded" | "failed" | "clarified";
    specialist: string | null;
    source: AgentChatSource;
  };
  audit: {
    auditId: string | null;
  };
};

export type AgentSandboxConnection = {
  id: string;
};

export type AgentSandboxSourceEvent = {
  id: string;
};

export type AgentSandboxTurnRecord = {
  connection: AgentSandboxConnection;
  sourceEvent: AgentSandboxSourceEvent;
  requestId: string;
  turnId: string;
  messageText: string;
  replyToMessageId: string | number | null;
};

export type AiProviderId = "workers-ai" | "openai" | "anthropic";

export function isAgentSandboxDispatchInput(
  value: unknown,
): value is AgentSandboxDispatchInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AgentSandboxDispatchInput>;
  return (
    typeof input.userId === "string" &&
    typeof input.requestId === "string" &&
    typeof input.connectionId === "string" &&
    typeof input.sourceEventId === "string" &&
    typeof input.turnId === "string" &&
    isValidAgentChatMode(input.mode) &&
    typeof input.messageText === "string" &&
    isValidAgentChatModelSelection(input.selectedModel) &&
    isValidAgentChatAttachments(input.attachments)
  );
}

export function isValidAgentChatMode(
  value: unknown,
): value is AgentChatMode | null | undefined {
  return (
    value === undefined ||
    value === null ||
    AGENT_CHAT_MODES.includes(value as AgentChatMode)
  );
}

export function isValidAgentChatAttachments(
  value: unknown,
): value is AgentChatAttachmentReference[] | null | undefined {
  if (value === undefined || value === null) return true;
  return Array.isArray(value);
}

export function isValidAgentChatModelSelection(
  value: unknown,
): value is AgentChatModelSelection | null | undefined {
  if (value === undefined || value === null) return true;
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<AgentChatModelSelection>;
  return Boolean(
    normalizeProviderId(model.providerId) &&
      typeof model.model === "string" &&
      normalizeModel(model.model),
  );
}

export function normalizeProviderId(value: unknown): AiProviderId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "openai") return "openai";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (
    normalized === "workers-ai" ||
    normalized === "workers_ai" ||
    normalized === "workers" ||
    normalized === "cloudflare"
  ) {
    return "workers-ai";
  }
  return null;
}

export function normalizeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > 160) return null;
  return model;
}

export type AgentChatTextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentChatImageInput = {
  name: string;
  mimeType: string;
  base64: string;
  dataUrl: string;
};

export type AgentChatAiGatewayRuntimeConfig = {
  accountId: string | null;
  gatewayId: string | null;
  apiToken: string | null;
  routeWorkersAi: boolean;
  routeExternalProviders: boolean;
};

export type AgentChatAiGatewayRequestPolicy = {
  requestTimeoutMs: number;
  maxAttempts: 1 | 2 | 3 | 4 | 5;
};

export type AgentChatAiRoute = {
  providerId: "workers-ai" | "openai" | "anthropic";
  model: string;
  backupModel: string | null;
  apiKey: string | null;
  ai: {
    aiGatewayLogId?: string | null;
    run(model: string, input: unknown, options?: unknown): Promise<unknown>;
  } | null;
  aiGateway: AgentChatAiGatewayRuntimeConfig | null;
  aiGatewayMetadata?: Record<string, string | number | boolean>;
  aiGatewayRequestPolicy?: AgentChatAiGatewayRequestPolicy | null;
  recordUsage?: (input: {
    model: string;
    usage: AgentModelUsage;
  }) => void | Promise<void>;
  configured: boolean;
};

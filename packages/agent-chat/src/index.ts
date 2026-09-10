import { normalizeTimeZone } from "@me3-core/plugin-calendar";
import {
  type CoreChatCapabilityId,
  type CoreChatToolPlannerDecision,
  getCoreChatCapability,
  isCoreChatCapabilityApprovalRequired,
} from "./capabilities";
import {
  buildMe3CapabilityContext,
  ME3_BUNDLED_AGENT_SKILLS,
  type Me3AgentContextCalendarEvent,
  type Me3AgentContextContact,
  type Me3AgentContextEmailThread,
  type Me3AgentContextLifeSnapshot,
  type Me3AgentContextMissionStatement,
  type Me3AgentContextManifest,
  type Me3AgentContextPrivateMemory,
  type Me3AgentContextProject,
  type Me3AgentContextRecentMessage,
  type Me3AgentContextSource,
  type Me3AgentContextSkill,
  type Me3AgentContextTask,
  type Me3KnowledgeRuntimeContext,
} from "@me3/knowledge";
import {
  decodeMimeHeaderValue,
  parseEmailAddressHeader,
} from "../../../shared/email-headers";
import { classifyAssistantImageIntent } from "./image-intent";
import { ME3_BASE_CHARACTER_PROMPT } from "./base-character";
import { isContextFreeLiteralResponseRequest } from "./turn-policy";
import {
  DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
  DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
  modelSupportsCapability,
  modelSupportsImageInput,
  type AssistantImageCapability,
} from "./model-capabilities";
import {
  estimateAssistantImageUsage,
  runAssistantImageProviderGeneration,
  type AssistantImageGenerationUsage,
} from "./image-generation-runtime";
import {
  modelErrorMessage,
  runModelTurn,
  type AgentChatAiGatewayRuntimeConfig,
  type AgentChatAiRoute,
  type AgentChatImageInput,
  type AgentChatTextMessage,
} from "./model-runtime";
export {
  cancelAgentReminder,
  createAgentReminder,
  getPendingAgentReminder,
  listPendingAgentReminders,
  parseAgentReminderInput,
  serializeAgentReminder,
  updateAgentReminder,
  type AgentReminder,
  type AgentReminderInput,
  type AgentReminderParseResult,
} from "./reminders";
export {
  archiveAgentMissionTask,
  createAgentMissionTask,
  getAgentMissionTask,
  listAgentMissionProjects,
  listAgentMissionTasks,
  updateAgentMissionTask,
  type AgentMissionProject,
  type AgentMissionTask,
  type AgentMissionTaskError,
  type CreateAgentMissionTaskInput,
  type UpdateAgentMissionTaskInput,
} from "@me3-core/plugin-mission-control";
import {
  runCoreAgentToolTurn,
  type CorePeopleSearchToolServices,
  type CoreSchedulingToolServices,
  type CoreWebResearchToolServices,
} from "./core-agent-runtime";
import { loadOwnerSnapshotContext } from "./owner-snapshot";
import type { AgentModelUsage } from "./tool-runtime";

export {
  buildReminderActionCard,
  runCoreAgentToolTurn,
  type CorePeopleSearchOffering,
  type CorePeopleSearchResult,
  type CorePeopleSearchToolServices,
  type CoreWebResearchToolServices,
  type CoreSchedulingContact,
  type CoreSchedulingOption,
  type CoreSchedulingToolServices,
} from "./core-agent-runtime";
export {
  searchAgentOwnerContent,
  type AgentOwnerContentSearchInput,
  type AgentOwnerContentSearchResponse,
  type AgentOwnerContentSearchResult,
  type AgentOwnerContentSourceType,
} from "./owner-content-search";
export {
  createAgentLandingPageDraft,
  listAgentLandingPageDesigns,
  listAgentLandingPages,
  updateAgentLandingPageDraft,
  type AgentLandingPageDraftInput,
  type AgentLandingPageEnv,
  type AgentLandingPageSummary,
  type AgentLandingPageUpdateInput,
} from "./landing-pages";
import {
  agentTurnResultStorageKey,
  cacheAgentTurnResult,
  getPersistedAgentTurnResult,
  persistAgentTurnResult,
  recordAgentSandboxRequest,
} from "./turn-idempotency";

export {
  CORE_CHAT_CAPABILITIES,
  CORE_CHAT_CAPABILITY_IDS,
  getCoreChatCapability,
  isCoreChatCapabilityApprovalRequired,
  validateCoreChatCapabilityContracts,
  type CoreChatApprovalMode,
  type CoreChatCapabilityContract,
  type CoreChatCapabilitySideEffect,
  type CoreChatCapabilityId,
  type CoreChatPlannerIntentKind,
  type CoreChatSideEffectLevel,
  type CoreChatToolPlannerDecision,
} from "./capabilities";

export {
  CORE_CHAT_TOOLS,
  coreChatToolName,
  getCoreChatToolByName,
  validateCoreChatToolDefinitions,
  type CoreChatToolDefinition,
  type CoreChatToolDefinitionIssue,
} from "./tools";

export {
  MAX_AGENT_TOOL_MODEL_STEPS,
  fromAnthropicToolResponse,
  fromOpenAiToolResponse,
  fromWorkersAiToolResponse,
  runAgentToolLoop,
  toAnthropicToolRequest,
  toOpenAiToolRequest,
  toWorkersAiToolRequest,
  type AgentToolCall,
  type AgentToolChoice,
  type AgentToolDefinition,
  type AgentToolExecutor,
  type AgentToolLoopResult,
  type AgentToolMessage,
  type AgentToolModel,
  type AgentToolModelResponse,
  type AgentModelUsage,
} from "./tool-runtime";

export {
  executeIdempotentAgentTool,
  type AgentToolExecutionContext,
} from "./tool-idempotency";

export {
  classifyAssistantImageIntent,
  type AssistantImageTurnIntent,
} from "./image-intent";

export { isContextFreeLiteralResponseRequest } from "./turn-policy";

export {
  DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
  DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
  modelCapabilitiesFor,
  modelSupportsCapability,
  modelSupportsImageInput,
  modelSupportsToolUse,
  type AiAgentModelCapability,
  type AiAgentModelProviderId,
  type AssistantImageCapability,
} from "./model-capabilities";

export const AGENT_CHAT_PLUGIN_ID = "me3.agent-chat";
export const CORE_MAILBOX_DAILY_INBOUND_LIMIT = 200;
export const CORE_MAILBOX_DAILY_OUTBOUND_LIMIT = 200;
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
  packageName: "@me3-core/plugin-agent-chat",
  bundled: true,
  runtimeStatus: "assistant_chat_runtime",
  routes: ["/api/assistant/chat/turn", "/api/agent/sandbox"],
  notes: [
    "Core bundles the owner chat runtime through a first-party plugin package.",
    "The plugin is enabled by default because agent chat is part of the baseline ME3 experience.",
    "Tool surfaces should be added behind this package boundary so hosted ME3 and Core installs share one implementation contract.",
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
  sourceType: "journal" | "mission_task";
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
  contactsChanged?: boolean;
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

type AgentChatGeneratedImageAsset = AgentChatImageAction["assets"][number];

type PendingAssistantMessageAssetLink = {
  id: string;
  attachmentId: string;
  role: "generated_output" | "input_reference";
  displayOrder: number;
  metadata: Record<string, unknown>;
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

export type AgentContactSource =
  | "booking"
  | "manual"
  | "agent"
  | "import"
  | "outreach"
  | "soulink";

export type AgentContactRelationship = "client" | "prospect" | "contact";
export type AgentContactStatus = "active" | "archived" | "dormant";
export type AgentContactCloseness = "very_close" | "close" | "acquaintance" | null;
export type AgentContactOutreachStatus =
  | "new"
  | "drafted"
  | "sent"
  | "replied"
  | "booked"
  | "converted"
  | "not_interested"
  | "no_response"
  | null;

export type AgentContactInput = Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  sourceRef: string | null;
  relationship: AgentContactRelationship;
  closeness: AgentContactCloseness;
  status: AgentContactStatus;
  notes: string | null;
  tags: string[];
  lastInteractionAt: string | null;
  nextFollowupAt: string | null;
  outreachStatus: AgentContactOutreachStatus;
  socialHandles: Record<string, string>;
  metadata: Record<string, unknown> | null;
}>;

export type AgentContact = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  sourceRef: string | null;
  relationship: AgentContactRelationship;
  closeness: string | null;
  status: AgentContactStatus;
  notes: string | null;
  tags: string[];
  lastInteractionAt: string | null;
  nextFollowupAt: string | null;
  outreachStatus: AgentContactOutreachStatus;
  socialHandles: Record<string, string>;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  bookingCount: number;
  lastBookingAt: string | null;
};

export type AgentContactsSummary = {
  total: number;
  clients: number;
  prospects: number;
  contacts: number;
  active: number;
  dormant: number;
  archived: number;
  needsFollowUp: number;
  outreach: Record<Exclude<AgentContactOutreachStatus, null>, number>;
};

export type AgentMailboxUpdateInput = {
  aliasLocalPart?: unknown;
  forwardingEmail?: unknown;
  forwardingEnabled?: unknown;
};

export type AgentMailboxDraftInput = {
  fromAddress?: unknown;
  to?: unknown;
  toAddress?: unknown;
  subject?: unknown;
  textBody?: unknown;
  htmlBody?: unknown;
  source?: unknown;
  replyToMessageId?: unknown;
  preservedAttachmentKeys?: unknown;
  uploadedAttachments?: unknown;
};

export type AgentMailboxMessageListOptions = {
  limit?: unknown;
  offset?: unknown;
  status?: unknown;
  createdBy?: unknown;
  direction?: unknown;
  folder?: unknown;
  query?: unknown;
  unread?: unknown;
};

export type AgentMailbox = ReturnType<typeof serializeAgentMailbox>;
export type AgentMailboxSource = {
  id: string;
  type: "me3_alias" | "custom_domain" | "external_forward";
  address: string;
  status: "pending" | "active" | "paused" | "failed";
  inboundEnabled: boolean;
  outboundEnabled: boolean;
};
export type AgentMailboxMessage = ReturnType<typeof serializeAgentMailboxMessage>;

export type AgentMailboxOverview = {
  tier: "core";
  available: true;
  approvalRequired: true;
  cloudflareManaged: boolean;
  suggestedAliasLocalPart: string;
  mailbox: AgentMailbox | null;
  sources: AgentMailboxSource[];
  recentActivity: AgentMailboxMessage[];
};

export type AgentMailboxDraftSendInput = {
  providerId: string;
  providerMessageId: string | null;
  sentAt: string;
  approvedByUserId: string;
};

export type AgentMailboxDraftFailureInput = {
  errorMessage: string;
};

type CoreAgentChatEnv = {
  DB: D1Like;
  AI?: {
    aiGatewayLogId?: string | null;
    run(model: string, input: unknown, options?: unknown): Promise<unknown>;
  };
  SITE_ASSETS?: R2Like;
  ENVIRONMENT?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  PEXELS_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  ME3_ASSISTANT_DEBUG_TRACE?: string;
  ME3_ASSISTANT_TRACE?: string;
  ME3_AI_MODEL?: string;
  ME3_AI_DEFAULT_PROVIDER?: string;
  ME3_AI_DEFAULT_MODEL?: string;
  ME3_AI_CHAT_PROVIDER?: string;
  ME3_AI_CHAT_MODEL?: string;
  ME3_AI_CHAT_BACKUP_MODEL?: string;
  ME3_AI_REASONING_PROVIDER?: string;
  ME3_AI_REASONING_MODEL?: string;
  ME3_AI_IMAGE_GENERATION_PROVIDER?: string;
  ME3_AI_IMAGE_GENERATION_MODEL?: string;
  ME3_DEPLOYMENT_MODE?: string;
  ME3_AI_RAW_MODEL_SELECTION_ENABLED?: string;
  CORE_API_ORIGIN?: string;
  CORE_WEB_ORIGIN?: string;
};

type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
    first<T = unknown>(): Promise<T | null>;
  };
};

type R2Like = {
  get(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
};

type R2ObjectLike = {
  size: number;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
};

type AgentSandboxConnection = {
  id: string;
};

type AgentSandboxSourceEvent = {
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

type StorageLike = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete?(key: string | string[]): Promise<unknown>;
};

type CoreChatToolTurnPlan = {
  decision: CoreChatToolPlannerDecision;
  recent: Array<{ role: "user" | "assistant"; content: string }>;
  sourceReference: AgentOwnerContentSourceReference | null;
  landingPageReference: AgentLandingPageReference | null;
  peopleSearchReference: AgentPeopleSearchReference | null;
};

type AgentLandingPageReference = {
  pageId: string;
  siteUsername: string;
};

type OwnerProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  username: string | null;
  bio: string | null;
  timezone: string | null;
  locale?: string | null;
  assistant_name?: string | null;
};

type AiCredentialRow = {
  provider_id: string;
  encrypted_api_key: string | null;
};

type AiGatewaySettingsRow = {
  account_id: string | null;
  gateway_id: string | null;
  encrypted_api_token: string | null;
};

type AiDefaultRow = {
  provider_id: string;
  model: string;
};

type DbPluginInstallationRow = {
  plugin_id: string;
  enabled: number;
  status: string;
};

type DbCoreSetupProfileSiteRow = {
  id?: string | null;
  username: string | null;
  custom_domain: string | null;
  custom_domain_status: string | null;
  published_at: string | null;
};

type CoreSetupPluginReadiness = {
  total: number;
  enabled: number;
  setupRequired: number;
  disabled: number;
};

type CoreSetupJobsReadiness = {
  total: number;
  active: number;
  needsSetup: number;
  paused: number;
  draft: number;
};

type DbContactRow = {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  source_ref: string | null;
  relationship: AgentContactRelationship;
  status: AgentContactStatus;
  notes: string | null;
  tags: string | null;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  outreach_status: AgentContactOutreachStatus;
  social_handles: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  booking_count?: number | string | null;
  last_booking_at?: string | null;
};

type DbMailboxAliasRow = {
  id: string;
  user_id: string;
  alias_local_part: string;
  forwarding_email: string;
  forwarding_status: "pending" | "verified";
  forwarding_enabled: number;
  forwarding_mode: "me3_only" | "forward";
  status: "pending_setup" | "active" | "paused";
  approval_policy: "all";
  daily_inbound_limit: number;
  daily_outbound_limit: number;
  activated_at: string | null;
  cf_destination_id: string | null;
  cf_destination_verified_at: string | null;
  cf_rule_id: string | null;
  cf_last_synced_at: string | null;
  cf_last_error: string | null;
  created_at: string;
  updated_at: string;
};

type DbMailboxMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  message_kind: "email" | "draft" | "system";
  status:
    | "received"
    | "forwarded"
    | "pending_approval"
    | "approved"
    | "rejected"
    | "sent"
    | "failed"
    | "dropped";
  thread_key: string | null;
  provider_id: string | null;
  provider_message_id: string | null;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  raw_headers_json: string | null;
  raw_message: string | null;
  metadata_json: string | null;
  agent_idempotency_key?: string | null;
  source_id: string | null;
  folder: "inbox" | "drafts" | "sent" | "archive" | "trash";
  read_at: string | null;
  agent_summary: string | null;
  agent_labels_json: string | null;
  forwarded_to: string | null;
  error_message: string | null;
  created_by: string;
  approved_by_user_id: string | null;
  received_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
};

type MailboxUnsubscribeAction = {
  available: true;
  mode: "one_click" | "link" | "mailto";
};

type DbMissionMemoryRow = {
  id: string;
  memory_kind: string;
  scope_kind: string;
  scope_id: string | null;
  title: string | null;
  body: string;
  confidence: number | null;
  source_ref: string | null;
  updated_at: string;
};

type DbMissionProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  source_ref: string | null;
  updated_at: string;
};

type DbMissionTaskRow = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  scheduled_for: string | null;
  source_ref: string | null;
  updated_at: string;
};

type DbAssistantSkillRow = {
  id: string;
  name: string;
  description: string | null;
  source_kind: string;
  source_ref: string | null;
  trust_level: string;
  trigger_hints_json: string;
  skill_md: string | null;
  updated_at: string;
};

type DbCalendarContextEventRow = {
  id: string;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  created_at: string;
  updated_at?: string | null;
};

type DbMissionDashboardSettingsRow = {
  mission_statement: string | null;
  updated_at: string;
};

type DbMissionWheelSnapshotRow = {
  id: string;
  segments_json: string;
  notes_json: string;
  created_at: string;
};

type CoreChatAgentContextResult = {
  status: "loaded" | "failed";
  prompt: string | null;
  manifest: Me3AgentContextManifest | null;
  summary: string | null;
  characterCount: number;
  loadDurationMs: number;
  error: string | null;
};

type CoreChatSetupReadiness = {
  prompt: string;
  pluginInstallations: DbPluginInstallationRow[];
};

type NormalizedMailboxDraftInput = {
  fromAddress: string;
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  sourceId: string | null;
  threadKey: string;
  messageIdHeader: string;
  inReplyTo: string | null;
  referencesHeader: string | null;
  createdBy: string;
  preservedAttachments: AgentMailboxAttachmentMetadata[];
};

type AgentMailboxAttachmentMetadata = {
  filename?: string | null;
  mimeType?: string | null;
  disposition?: string | null;
  size?: number | null;
  storageKey?: string | null;
  sourceMessageId?: string | null;
};

type D1RunResultLike = {
  meta?: {
    changes?: number;
  };
};

type AiProviderId = "workers-ai" | "openai" | "anthropic";

type AiRoute = AgentChatAiRoute;

type AiGatewayRuntimeConfig = AgentChatAiGatewayRuntimeConfig;

const DEFAULT_WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const DEFAULT_WORKERS_AI_BACKUP_MODEL = "@cf/zai-org/glm-5.2";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_AI_GATEWAY_ID = "default";
const DEFAULT_IMAGE_GENERATION_WIDTH = 1024;
const DEFAULT_IMAGE_GENERATION_HEIGHT = 1024;
const INSTALL_ENCRYPTION_KEY_NAME = "TOKEN_ENCRYPTION_KEY";
const DEFAULT_MISSION_STATEMENT_TEMPLATE_MARKER = "[who/what]";
const MAX_WHEEL_SNAPSHOT_AREAS = 8;
const CONTACT_SOURCES = new Set<AgentContactSource>([
  "booking",
  "manual",
  "agent",
  "import",
  "outreach",
  "soulink",
]);
const CONTACT_RELATIONSHIPS = new Set<AgentContactRelationship>([
  "client",
  "prospect",
  "contact",
]);
const CONTACT_STATUSES = new Set<AgentContactStatus>([
  "active",
  "archived",
  "dormant",
]);
const OUTREACH_STATUSES = new Set<Exclude<AgentContactOutreachStatus, null>>([
  "new",
  "drafted",
  "sent",
  "replied",
  "booked",
  "converted",
  "not_interested",
  "no_response",
]);
const MAILBOX_ALIAS_REGEX = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const MAILBOX_FOLDERS = new Set(["inbox", "drafts", "sent", "archive", "trash"]);
const DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[\s\S]*?(?:\n\s*\n|$)/i;
const DRAFT_WRAPPER_INTRO_LINE_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*(?:\n|$)/i;
const DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN =
  /^\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*$/im;

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

function isValidAgentChatMode(
  value: unknown,
): value is AgentChatMode | null | undefined {
  return (
    value === undefined ||
    value === null ||
    AGENT_CHAT_MODES.includes(value as AgentChatMode)
  );
}

function normalizeAgentChatMode(value: unknown): AgentChatMode {
  return AGENT_CHAT_MODES.includes(value as AgentChatMode)
    ? (value as AgentChatMode)
    : "everyday";
}

function isValidAgentChatAttachments(
  value: unknown,
): value is AgentChatAttachmentReference[] | null | undefined {
  if (value === undefined || value === null) return true;
  return Array.isArray(value);
}

function isValidAgentChatModelSelection(
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

export function parseAgentContactInput(value: unknown): AgentContactInput {
  if (!isPlainObject(value)) return {};
  return {
    name: normalizeNullableText(value.name) || undefined,
    email: normalizeEmail(value.email),
    phone: normalizeNullableText(value.phone),
    source: CONTACT_SOURCES.has(String(value.source) as AgentContactSource)
      ? (value.source as AgentContactSource)
      : "manual",
    sourceRef: normalizeNullableText(value.sourceRef),
    relationship: CONTACT_RELATIONSHIPS.has(
      String(value.relationship) as AgentContactRelationship,
    )
      ? (value.relationship as AgentContactRelationship)
      : "contact",
    closeness: normalizeNullableText(value.closeness) as AgentContactCloseness,
    status: CONTACT_STATUSES.has(String(value.status) as AgentContactStatus)
      ? (value.status as AgentContactStatus)
      : "active",
    notes: normalizeNullableText(value.notes),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    lastInteractionAt: normalizeNullableText(value.lastInteractionAt),
    nextFollowupAt: normalizeNullableText(value.nextFollowupAt),
    outreachStatus: normalizeContactOutreachStatus(value.outreachStatus),
    socialHandles: isPlainObject(value.socialHandles)
      ? stringRecord(value.socialHandles)
      : {},
    metadata: isPlainObject(value.metadata)
      ? { ...(value.metadata as Record<string, unknown>) }
      : null,
  };
}

export async function listAgentContacts(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
): Promise<{ contacts: AgentContact[]; summary: AgentContactsSummary }> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.name, c.email, c.phone, c.source, c.source_ref,
            c.relationship, c.status, c.notes, c.tags, c.last_interaction_at,
            c.next_followup_at, c.outreach_status, c.social_handles, c.metadata,
            c.created_at, c.updated_at,
            COUNT(b.id) AS booking_count,
            MAX(b.starts_at) AS last_booking_at
     FROM contacts c
     LEFT JOIN bookings b ON b.guest_email = c.email
     LEFT JOIN sites s ON s.id = b.site_id AND s.user_id = c.user_id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY COALESCE(c.last_interaction_at, c.updated_at, c.created_at) DESC`,
  )
    .bind(userId)
    .all<DbContactRow>();

  const contacts = (rows.results || []).map(serializeAgentContact);
  return { contacts, summary: summarizeAgentContacts(contacts) };
}

export async function createAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  value: unknown,
): Promise<AgentContact | { error: string; status: 400 | 409 }> {
  const input = parseAgentContactInput(value);
  if (!input.name?.trim()) {
    return { error: "Contact name is required", status: 400 };
  }
  if (input.email && (await contactEmailExists(env, userId, input.email))) {
    return duplicateContactEmailError();
  }

  const id = crypto.randomUUID();
  const metadata = normalizeContactMetadata(input);
  try {
    await env.DB.prepare(
      `INSERT INTO contacts (
         id, user_id, name, email, phone, source, source_ref, relationship, status,
         notes, tags, last_interaction_at, next_followup_at, outreach_status,
         social_handles, metadata
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        userId,
        input.name,
        input.email || null,
        input.phone || null,
        input.source || "manual",
        input.sourceRef || null,
        input.relationship || "contact",
        input.status || "active",
        input.notes || null,
        JSON.stringify(input.tags || []),
        input.lastInteractionAt || null,
        input.nextFollowupAt || null,
        input.outreachStatus || null,
        JSON.stringify(input.socialHandles || {}),
        metadata ? JSON.stringify(metadata) : null,
      )
      .run();
  } catch (error) {
    if (isDuplicateContactEmailError(error)) return duplicateContactEmailError();
    throw error;
  }

  const contact = await getAgentContact(env, userId, id);
  if (!contact) return { error: "Contact not found", status: 400 };
  return contact;
}

export async function upsertAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  value: unknown,
): Promise<
  { contact: AgentContact; created: boolean } | { error: string; status: 400 | 404 | 409 }
> {
  const input = parseAgentContactInput(value);
  if (!input.name?.trim()) {
    return { error: "Contact name is required", status: 400 };
  }

  const source = input.source || "manual";
  const sourceRef = input.sourceRef || null;
  const email = input.email || null;
  const { contacts } = await listAgentContacts(env, userId);
  const existing =
    (sourceRef
      ? contacts.find(
          (contact) =>
            contact.source === source && contact.sourceRef === sourceRef,
        )
      : null) ||
    (sourceRef && source === "soulink"
      ? contacts.find((contact) => contact.metadata?.soulinkNodeId === sourceRef)
      : null) ||
    (email
      ? contacts.find(
          (contact) => contact.email?.trim().toLowerCase() === email,
        )
      : null);

  if (!existing) {
    const created = await createAgentContact(env, userId, input);
    if ("error" in created) return created;
    return { contact: created, created: true };
  }

  const incomingMetadata = normalizeContactMetadata(input) || {};
  const existingMetadata = existing.metadata || {};
  const canRefreshIdentity =
    existing.source === source || existing.source === "soulink";
  const merged = await updateAgentContact(env, userId, existing.id, {
    name: canRefreshIdentity ? input.name || existing.name : existing.name,
    email: existing.email || input.email || null,
    phone: existing.phone,
    source: existing.source,
    sourceRef: canRefreshIdentity
      ? input.sourceRef || existing.sourceRef
      : existing.sourceRef,
    relationship: existing.relationship,
    status: existing.status,
    notes: existing.notes,
    tags: existing.tags,
    lastInteractionAt: input.lastInteractionAt || existing.lastInteractionAt,
    nextFollowupAt: existing.nextFollowupAt,
    outreachStatus: existing.outreachStatus,
    socialHandles: {
      ...existing.socialHandles,
      ...(input.socialHandles || {}),
    },
    metadata: {
      ...existingMetadata,
      ...incomingMetadata,
    },
  });

  if ("error" in merged) return merged;
  return { contact: merged, created: false };
}

export async function updateAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
  value: unknown,
): Promise<AgentContact | { error: string; status: 404 | 409 }> {
  const input = parseAgentContactInput(value);
  const existing = await getAgentContactRow(env, userId, contactId);
  if (!existing) return { error: "Contact not found", status: 404 };

  const merged: AgentContactInput = {
    name: input.name ?? existing.name,
    email: input.email ?? existing.email,
    phone: input.phone ?? existing.phone,
    source: input.source ?? existing.source,
    sourceRef: input.sourceRef ?? existing.source_ref,
    relationship: input.relationship ?? existing.relationship,
    status: input.status ?? existing.status,
    notes: input.notes ?? existing.notes,
    tags: input.tags ?? parseJsonArray(existing.tags),
    lastInteractionAt: input.lastInteractionAt ?? existing.last_interaction_at,
    nextFollowupAt: input.nextFollowupAt ?? existing.next_followup_at,
    outreachStatus: input.outreachStatus ?? existing.outreach_status,
    socialHandles: input.socialHandles ?? stringRecord(parseJsonRecord(existing.social_handles)),
    metadata: input.metadata ?? parseJsonRecord(existing.metadata),
    closeness:
      input.closeness ??
      (parseJsonRecord(existing.metadata).closeness as AgentContactCloseness),
  };
  const metadata = normalizeContactMetadata(merged);
  if (
    merged.email &&
    (await contactEmailExists(env, userId, merged.email, contactId))
  ) {
    return duplicateContactEmailError();
  }

  try {
    await env.DB.prepare(
      `UPDATE contacts
       SET name = ?, email = ?, phone = ?, source = ?, source_ref = ?,
           relationship = ?, status = ?, notes = ?, tags = ?,
           last_interaction_at = ?, next_followup_at = ?, outreach_status = ?,
           social_handles = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id = ?`,
    )
      .bind(
        merged.name,
        merged.email || null,
        merged.phone || null,
        merged.source || "manual",
        merged.sourceRef || null,
        merged.relationship || "contact",
        merged.status || "active",
        merged.notes || null,
        JSON.stringify(merged.tags || []),
        merged.lastInteractionAt || null,
        merged.nextFollowupAt || null,
        merged.outreachStatus || null,
        JSON.stringify(merged.socialHandles || {}),
        metadata ? JSON.stringify(metadata) : null,
        userId,
        contactId,
      )
      .run();
  } catch (error) {
    if (isDuplicateContactEmailError(error)) return duplicateContactEmailError();
    throw error;
  }

  const contact = await getAgentContact(env, userId, contactId);
  return contact || { error: "Contact not found", status: 404 };
}

export async function deleteAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<{ ok: true } | { error: string; status: 404 }> {
  const result = (await env.DB.prepare("DELETE FROM contacts WHERE user_id = ? AND id = ?")
    .bind(userId, contactId)
    .run()) as D1RunResultLike;
  if ((result.meta?.changes || 0) === 0) {
    return { error: "Contact not found", status: 404 };
  }
  return { ok: true };
}

export async function updateAgentContactOutreachStatus(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
  input: { outreachStatus?: unknown; nextFollowupAt?: unknown },
): Promise<AgentContact | { error: string; status: 404 }> {
  const outreachStatus = normalizeContactOutreachStatus(input.outreachStatus);
  const result = (await env.DB.prepare(
    `UPDATE contacts
     SET outreach_status = ?, next_followup_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`,
  )
    .bind(outreachStatus, normalizeNullableText(input.nextFollowupAt), userId, contactId)
    .run()) as D1RunResultLike;
  if ((result.meta?.changes || 0) === 0) {
    return { error: "Contact not found", status: 404 };
  }

  const contact = await getAgentContact(env, userId, contactId);
  return contact || { error: "Contact not found", status: 404 };
}

export async function convertAgentContactToClient(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<AgentContact | { error: string; status: 404 }> {
  const result = (await env.DB.prepare(
    `UPDATE contacts
     SET relationship = 'client', outreach_status = 'converted', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`,
  )
    .bind(userId, contactId)
    .run()) as D1RunResultLike;
  if ((result.meta?.changes || 0) === 0) {
    return { error: "Contact not found", status: 404 };
  }

  const contact = await getAgentContact(env, userId, contactId);
  return contact || { error: "Contact not found", status: 404 };
}

export async function getAgentMailboxOverview(
  env: Pick<CoreAgentChatEnv, "DB" | "ME3_DEPLOYMENT_MODE">,
  userId: string,
  ownerHint?: { username?: string | null; email?: string | null },
  options: {
    includeRecentActivity?: boolean;
    configuredIdentity?: { id: string; address: string } | null;
  } = {},
): Promise<AgentMailboxOverview> {
  const mailbox = await getAgentMailboxRow(env, userId);
  const cloudflareManaged = normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed";
  const managedAddress =
    mailbox && cloudflareManaged
      ? getAgentMailboxManagedAddress(mailbox.alias_local_part)
      : null;
  const configuredIdentity = normalizeAgentMailboxConfiguredIdentity(
    options.configuredIdentity,
  );
  const suggestedAliasLocalPart =
    mailbox?.alias_local_part ||
    suggestAgentMailboxAlias(ownerHint?.username || ownerHint?.email || "owner");

  return {
    tier: "core",
    available: true,
    approvalRequired: true,
    cloudflareManaged,
    suggestedAliasLocalPart,
    mailbox: mailbox ? serializeAgentMailbox(mailbox, managedAddress) : null,
    sources:
      mailbox && managedAddress
        ? [serializeAgentMailboxManagedSource(mailbox, managedAddress)]
        : mailbox && configuredIdentity
          ? [serializeAgentMailboxConfiguredSource(configuredIdentity)]
          : [],
    recentActivity:
      mailbox && options.includeRecentActivity !== false
        ? await getAgentMailboxActivity(env, mailbox.id, 25, 0)
        : [],
  };
}

export async function upsertAgentMailbox(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  input: AgentMailboxUpdateInput,
  ownerHint?: { email?: string | null },
): Promise<{ mailbox: AgentMailbox | null; sources: AgentMailboxSource[] } | { error: string; status: number }> {
  const existing = await getAgentMailboxRow(env, userId);
  const aliasLocalPart = normalizeAgentMailboxAlias(
    typeof input.aliasLocalPart === "string" ? input.aliasLocalPart : "",
  );
  const forwardingEnabled = input.forwardingEnabled === true;
  const forwardingEmail =
    typeof input.forwardingEmail === "string" ? input.forwardingEmail.trim() : "";

  if (!aliasLocalPart || !MAILBOX_ALIAS_REGEX.test(aliasLocalPart)) {
    return {
      error:
        "Mailbox alias must start and end with a letter or number and may contain dots, underscores, or hyphens.",
      status: 400,
    };
  }

  if (forwardingEnabled && !isValidEmail(forwardingEmail)) {
    return { error: "Enter a valid forwarding email address.", status: 400 };
  }

  const savedForwardingEmail =
    forwardingEnabled ? forwardingEmail : existing?.forwarding_email || ownerHint?.email || "";
  const forwardingStatus =
    forwardingEnabled && savedForwardingEmail !== existing?.forwarding_email
      ? "pending"
      : existing?.forwarding_status || "pending";
  const forwardingMode = forwardingEnabled ? "forward" : "me3_only";
  const now = new Date().toISOString();

  try {
    if (existing) {
      await env.DB.prepare(
        `UPDATE mailbox_aliases
         SET alias_local_part = ?,
             forwarding_email = ?,
             forwarding_status = ?,
             forwarding_enabled = ?,
             forwarding_mode = ?,
             updated_at = ?
         WHERE user_id = ?`,
      )
        .bind(
          aliasLocalPart,
          savedForwardingEmail,
          forwardingStatus,
          forwardingEnabled ? 1 : 0,
          forwardingMode,
          now,
          userId,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO mailbox_aliases (
           id, user_id, alias_local_part, forwarding_email, forwarding_status,
           forwarding_enabled, forwarding_mode, status, approval_policy,
           daily_inbound_limit, daily_outbound_limit, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_setup', 'all', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          userId,
          aliasLocalPart,
          savedForwardingEmail,
          forwardingStatus,
          forwardingEnabled ? 1 : 0,
          forwardingMode,
          CORE_MAILBOX_DAILY_INBOUND_LIMIT,
          CORE_MAILBOX_DAILY_OUTBOUND_LIMIT,
          now,
          now,
        )
        .run();
    }
  } catch {
    return { error: "Mailbox alias is already in use.", status: 409 };
  }

  const mailbox = await getAgentMailboxRow(env, userId);
  return {
    mailbox: mailbox ? serializeAgentMailbox(mailbox) : null,
    sources: [],
  };
}

export async function activateAgentMailbox(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
): Promise<{ mailbox: AgentMailbox | null } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE mailbox_aliases
     SET status = 'active',
         activated_at = COALESCE(activated_at, ?),
         updated_at = ?
     WHERE user_id = ?`,
  )
    .bind(now, now, userId)
    .run();

  const updated = await getAgentMailboxRow(env, userId);
  return { mailbox: updated ? serializeAgentMailbox(updated) : null };
}

export async function pauseAgentMailbox(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
): Promise<{ mailbox: AgentMailbox | null } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  await env.DB.prepare(
    `UPDATE mailbox_aliases
     SET status = 'paused',
         updated_at = ?
     WHERE user_id = ?`,
  )
    .bind(new Date().toISOString(), userId)
    .run();

  const updated = await getAgentMailboxRow(env, userId);
  return { mailbox: updated ? serializeAgentMailbox(updated) : null };
}

export async function listAgentMailboxMessages(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  options: AgentMailboxMessageListOptions,
): Promise<{ messages: AgentMailboxMessage[]; total: number; limit: number; offset: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  const limit = clampNumber(options.limit, 50, 0, 100);
  const offset = clampNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!mailbox) return { messages: [], total: 0, limit, offset };

  const { where, bindings } = buildAgentMailboxMessageFilters(mailbox.id, {
    status: normalizeNullableText(options.status) || "",
    createdBy: normalizeNullableText(options.createdBy) || "",
    direction: normalizeNullableText(options.direction) || "outbound",
    folder: normalizeNullableText(options.folder) || "",
    query: normalizeNullableText(options.query) || "",
    unread: normalizeNullableText(options.unread) || "",
  });

  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM mailbox_messages WHERE ${where}`)
    .bind(...bindings)
    .first<{ count: number | string | null }>();
  const total = Number(count?.count || 0);

  if (limit === 0) return { messages: [], total, limit, offset };

  const rows = await env.DB.prepare(
    `${agentMailboxMessageSelectSql()} WHERE ${where}
     ORDER BY COALESCE(sent_at, received_at, approved_at, created_at) DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, limit, offset)
    .all<DbMailboxMessageRow>();

  return {
    messages: (rows.results || []).map(serializeAgentMailboxMessage),
    total,
    limit,
    offset,
  };
}

export async function getAgentMailboxMessage(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
): Promise<{ message: AgentMailboxMessage } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const message = await getAgentMailboxMessageById(env, mailbox.id, messageId);
  if (!message) return { error: "Message not found", status: 404 };

  return { message: serializeAgentMailboxMessage(message) };
}

export async function listAgentMailboxThreadMessages(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  threadId: string,
): Promise<{ messages: AgentMailboxMessage[] } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  let rows = await env.DB.prepare(
    `${agentMailboxMessageSelectSql()}
     WHERE mailbox_id = ? AND thread_key = ?
     ORDER BY COALESCE(sent_at, received_at, approved_at, created_at) ASC, id ASC`,
  )
    .bind(mailbox.id, threadId)
    .all<DbMailboxMessageRow>();
  if ((rows.results || []).length === 0) {
    rows = await env.DB.prepare(
      `${agentMailboxMessageSelectSql()}
       WHERE mailbox_id = ? AND id = ? AND (thread_key IS NULL OR thread_key = '')`,
    )
      .bind(mailbox.id, threadId)
      .all<DbMailboxMessageRow>();
  }
  const messages = (rows.results || []).map(serializeAgentMailboxMessage);
  return messages.length > 0 ? { messages } : { error: "Thread not found", status: 404 };
}

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

export function getAgentMailboxOutboundHeaders(message: AgentMailboxMessage): {
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
} {
  const outboundHeaders = isPlainObject(message.metadata.outbound_headers)
    ? message.metadata.outbound_headers
    : {};
  return {
    messageIdHeader: normalizeMessageHeader(outboundHeaders.message_id),
    inReplyTo: normalizeMessageHeader(outboundHeaders.in_reply_to),
    referencesHeader: normalizeReferencesHeader(outboundHeaders.references),
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

export async function setAgentMailboxMessageReadState(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
  read: boolean,
): Promise<{ ok: true } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET read_at = CASE WHEN ? THEN COALESCE(read_at, CURRENT_TIMESTAMP) ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(read, messageId, mailbox.id)
    .run();

  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };
  return { ok: true };
}

export async function moveAgentMailboxMessage(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
  folderInput: unknown,
): Promise<{ ok: true; id: string; folder: string } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const folder = normalizeFolder(folderInput);
  if (!folder) return { error: "Invalid folder", status: 400 };

  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET folder = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(folder, messageId, mailbox.id)
    .run();

  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };
  return { ok: true, id: messageId, folder };
}

export async function trashAgentMailboxMessage(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  messageId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const result = await env.DB.prepare(
    `UPDATE mailbox_messages
     SET folder = 'trash', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(messageId, mailbox.id)
    .run();

  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };
  return { ok: true };
}

export async function deleteAgentMailboxMessage(
  env: Pick<CoreAgentChatEnv, "DB" | "SITE_ASSETS">,
  userId: string,
  messageId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const message = await getAgentMailboxMessageById(env, mailbox.id, messageId);
  if (!message) return { error: "Message not found", status: 404 };

  const result = await env.DB.prepare(
    "DELETE FROM mailbox_messages WHERE id = ? AND mailbox_id = ?",
  )
    .bind(messageId, mailbox.id)
    .run();
  if ((result.meta?.changes || 0) === 0) return { error: "Message not found", status: 404 };

  if (env.SITE_ASSETS) {
    const storageKeys = getMailboxAttachmentMetadata(message)
      .map((attachment) => attachment.storageKey || "")
      .filter((key) => key.startsWith(`mailbox/${mailbox.id}/`));
    const unreferenced: string[] = [];
    for (const storageKey of new Set(storageKeys)) {
      const reference = await env.DB.prepare(
        `SELECT id FROM mailbox_messages
         WHERE mailbox_id = ? AND instr(COALESCE(metadata_json, ''), ?) > 0
         LIMIT 1`,
      )
        .bind(mailbox.id, storageKey)
        .first<{ id: string }>();
      if (!reference) unreferenced.push(storageKey);
    }
    if (unreferenced.length > 0) {
      await env.SITE_ASSETS.delete(unreferenced).catch(() => undefined);
    }
  }

  return { ok: true };
}

export function serializeAgentContact(row: DbContactRow): AgentContact {
  const metadata = parseJsonRecord(row.metadata);
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    sourceRef: row.source_ref,
    relationship: row.relationship,
    closeness: typeof metadata.closeness === "string" ? metadata.closeness : null,
    status: row.status,
    notes: row.notes,
    tags: parseJsonArray(row.tags),
    lastInteractionAt: row.last_interaction_at,
    nextFollowupAt: row.next_followup_at,
    outreachStatus: row.outreach_status,
    socialHandles: stringRecord(parseJsonRecord(row.social_handles)),
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    bookingCount: Number(row.booking_count || 0),
    lastBookingAt: row.last_booking_at || null,
  };
}

export async function createAgentSandboxTurnRecord(
  env: Pick<CoreAgentChatEnv, "DB">,
  input: {
    userId: string;
    requestId: string;
    messageText: string;
    replyToMessageId?: string | number | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<AgentSandboxTurnRecord> {
  const messageText = input.messageText.trim();
  const replyToMessageId =
    typeof input.replyToMessageId === "string" ||
    typeof input.replyToMessageId === "number"
      ? input.replyToMessageId
      : null;
  const connection = await upsertSandboxConnection(env, input.userId);
  const stored = await recordAgentSandboxRequest(env.DB, {
    eventId: crypto.randomUUID(),
    connectionId: connection.id,
    requestId: input.requestId,
    turnId: crypto.randomUUID(),
    messageText,
    replyToMessageId,
    metadata: input.metadata,
  });

  return {
    connection,
    sourceEvent: { id: stored.eventId },
    requestId: input.requestId,
    turnId: stored.turnId,
    messageText,
    replyToMessageId,
  };
}

export async function dispatchAgentSandboxTurn(
  env: CoreAgentChatEnv,
  storage: StorageLike,
  input: AgentSandboxDispatchInput,
  streamOptions?: AgentChatRuntimeStreamOptions,
  schedulingServices?: CoreSchedulingToolServices,
  peopleSearchServices?: CorePeopleSearchToolServices,
  webResearchServices?: CoreWebResearchToolServices,
): Promise<AgentSandboxDispatchResponse> {
  const dispatchStartedAt = performance.now();
  const turnPerformance = createAgentChatPerformanceMetrics();
  const mode = normalizeAgentChatMode(input.mode);
  const resultKey = agentTurnResultStorageKey(input.requestId);
  const memoryCacheLookupStartedAt = performance.now();
  const existing = await storage.get<AgentSandboxDispatchResponse>(resultKey);
  turnPerformance.memoryCacheLookupMs = elapsedMs(memoryCacheLookupStartedAt);
  if (existing) {
    return applyAgentTurnTracePolicy(
      env,
      attachAgentChatPerformance(
        {
          ...existing,
          ok: true,
          mode: existing.mode || mode,
        },
        turnPerformance,
        dispatchStartedAt,
        "memory_cache",
      ),
    );
  }
  const databaseReplayLookupStartedAt = performance.now();
  const persisted = await getPersistedAgentTurnResult<AgentSandboxDispatchResponse>(
    env.DB,
    input.userId,
    input.requestId,
    input.turnId,
  );
  turnPerformance.databaseReplayLookupMs = elapsedMs(
    databaseReplayLookupStartedAt,
  );
  if (persisted) {
    await cacheAgentTurnResult(storage, resultKey, persisted);
    return applyAgentTurnTracePolicy(
      env,
      attachAgentChatPerformance(
        {
          ...persisted,
          ok: true,
          mode: persisted.mode || mode,
        },
        turnPerformance,
        dispatchStartedAt,
        "database_replay",
      ),
    );
  }

  const statePreparationStartedAt = performance.now();
  await storage.put("userId", input.userId);
  await storage.put("lastSandboxConnectionId", input.connectionId);
  await storage.put("lastSandboxTurnId", input.turnId);
  await storage.put("lastSandboxTurnAt", new Date().toISOString());
  turnPerformance.statePreparationMs = elapsedMs(statePreparationStartedAt);

  const ownerProfileStartedAt = performance.now();
  const owner = await getOwnerProfile(env, input.userId);
  turnPerformance.ownerProfileMs = elapsedMs(ownerProfileStartedAt);
  const toolPlanStartedAt = performance.now();
  const toolPlan = await loadCoreChatToolTurnPlan(env, input);
  turnPerformance.toolPlanMs = elapsedMs(toolPlanStartedAt);
  const routeResolutionStartedAt = performance.now();
  const resolvedRoute = await resolveAiRoute(
    env,
    input.userId,
    mode,
    input.selectedModel,
  );
  const route: AiRoute = {
    ...resolvedRoute,
    aiGatewayMetadata: {
      me3_request_id: input.requestId,
      me3_turn_id: input.turnId,
      me3_mode: mode,
    },
  };
  turnPerformance.routeResolutionMs = elapsedMs(routeResolutionStartedAt);
  const useCoreToolRuntime =
    route.configured &&
    !isCoreChatOrientationTurn(toolPlan.decision) &&
    !input.attachments?.some(
      (attachment) =>
        attachment.kind === "image" || attachment.mimeType?.startsWith("image/"),
    );
  const directExecutionStartedAt = performance.now();
  const toolResponse = maybeHandleCoreDirectTurn(input, route);
  if (toolResponse) {
    turnPerformance.executionMs = elapsedMs(directExecutionStartedAt);
    const messagePersistenceStartedAt = performance.now();
    await persistAssistantMessage(
      env,
      input.userId,
      "user",
      input.messageText,
      input.threadId,
      assistantUserMessageMetadataForInput(input),
    );
    if (toolResponse.replyText) {
      await persistAssistantMessage(
        env,
        input.userId,
        "assistant",
        toolResponse.replyText,
        input.threadId,
        assistantMessageMetadataForResponse(toolResponse),
      );
    }
    turnPerformance.messagePersistenceMs = elapsedMs(
      messagePersistenceStartedAt,
    );
    let response: AgentSandboxDispatchResponse = {
      ...toolResponse,
      mode,
      threadId: input.threadId ?? null,
    };
    await touchAssistantThread(env, input.userId, input.threadId);
    response = attachAgentTurnTrace(env, response, {
      input,
      plannerDecision: toolPlan.decision,
      route: null,
      context: null,
    });
    response = attachAgentChatPerformance(
      response,
      turnPerformance,
      dispatchStartedAt,
      "fresh",
    );
    await persistAgentTurnResult(env.DB, storage, input, resultKey, response);
    return response;
  }

  const imageIntent = classifyAssistantImageIntent(
    input.messageText,
    input.attachments,
  );
  const imageExecutionStartedAt = performance.now();
  const imageTurn = await maybeHandleAssistantImageTurn(
    env,
    input,
    imageIntent,
  );
  if (imageTurn) {
    turnPerformance.executionMs = elapsedMs(imageExecutionStartedAt);
    const messagePersistenceStartedAt = performance.now();
    await persistAssistantMessage(
      env,
      input.userId,
      "user",
      input.messageText,
      input.threadId,
      assistantUserMessageMetadataForInput(input),
    );
    if (imageTurn.response.replyText) {
      const assistantMessageId = await persistAssistantMessage(
        env,
        input.userId,
        "assistant",
        imageTurn.response.replyText,
        input.threadId,
        assistantMessageMetadataForResponse(imageTurn.response),
      );
      if (assistantMessageId && imageTurn.messageAssetLinks?.length) {
        await persistAssistantMessageAssetLinks(env, {
          ownerId: input.userId,
          threadId: input.threadId ?? null,
          messageId: assistantMessageId,
          links: imageTurn.messageAssetLinks,
        });
      }
    }
    turnPerformance.messagePersistenceMs = elapsedMs(
      messagePersistenceStartedAt,
    );
    let response: AgentSandboxDispatchResponse = {
      ...imageTurn.response,
      mode,
      threadId: input.threadId ?? null,
    };
    await touchAssistantThread(env, input.userId, input.threadId);
    response = attachAgentTurnTrace(env, response, {
      input,
      plannerDecision: toolPlan.decision,
      route: imageTurn.route,
      context: null,
    });
    response = attachAgentChatPerformance(
      response,
      turnPerformance,
      dispatchStartedAt,
      "fresh",
    );
    await persistAgentTurnResult(env.DB, storage, input, resultKey, response);
    return response;
  }

  const runtimeMessageText = appendAgentAttachmentReferenceContext(
    input.messageText,
    input.attachments,
    input.attachmentTextContext,
  );
  const contextFreeTurn =
    !input.attachments?.length &&
    isContextFreeLiteralResponseRequest(runtimeMessageText);
  const recent = contextFreeTurn ? [] : toolPlan.recent;
  const orientationTurn = isCoreChatOrientationTurn(toolPlan.decision);
  await streamOptions?.onEvent({
    event: "status",
    data: { state: "context_loading" },
  });
  const setupAndContextStartedAt = performance.now();
  const [setupReadiness, agentContext] = await Promise.all([
    orientationTurn
      ? loadCoreChatSetupReadiness(
          env,
          input.userId,
          route.configured,
          owner,
        )
      : Promise.resolve({ prompt: "", pluginInstallations: [] }),
    contextFreeTurn
      ? Promise.resolve(null)
      : loadCoreChatAgentContext(env, {
          ownerId: input.userId,
          owner,
        }),
  ]);
  turnPerformance.setupAndContextMs = elapsedMs(setupAndContextStartedAt);
  turnPerformance.contextLoadMs = agentContext?.loadDurationMs ?? 0;
  const knowledgeContext = orientationTurn && route.configured
    ? buildMe3KnowledgeRuntimeContext(
        route.configured,
        setupReadiness.pluginInstallations,
      )
    : "";
  const messages = buildChatMessages(
    owner,
    recent,
    runtimeMessageText,
    knowledgeContext,
    agentContext?.prompt ?? null,
    buildCoreChatOrientationPrompt(toolPlan.decision, setupReadiness),
    contextFreeTurn ? null : toolPlan.sourceReference,
    contextFreeTurn ? null : toolPlan.landingPageReference,
    contextFreeTurn ? null : toolPlan.peopleSearchReference,
  );
  let imageInputs: AgentChatImageInput[] = [];
  let imageInputError: string | null = null;
  const imageInputStartedAt = performance.now();
  try {
    imageInputs = await loadAgentImageInputs(env, input.attachments);
  } catch (error) {
    imageInputError = modelErrorMessage(error) || "Could not load image attachment.";
  }
  turnPerformance.imageInputMs = elapsedMs(imageInputStartedAt);

  let response: AgentSandboxDispatchResponse;
  const executionStartedAt = performance.now();
  if (!route.configured) {
    response = {
      ok: true,
      auditId: null,
      turnId: input.turnId,
      specialist: "core.agent-chat",
      replyText: isCoreChatOrientationTurn(toolPlan.decision)
        ? buildCoreChatOrientationFallbackReply(owner, setupReadiness)
        : "ME3 chat is connected for your ME3 installation. Add an AI provider in Account settings or bind Workers AI to turn this into a live model response.",
      model: route.model,
      source: "fallback",
      fallbackReason: "AI provider setup required",
      debugError: null,
      emailAction: null,
      reminderAction: null,
      actionCards: null,
      contentAction: null,
      contactsChanged: false,
    };
  } else if (imageInputError) {
    response = blockedImageInputResponse({
      turnId: input.turnId,
      route,
      reason: "image_attachment_unavailable",
      replyText: "I couldn't load the attached image for this turn. Remove it and try again.",
      debugError: imageInputError,
    });
  } else if (
    imageInputs.length > 0 &&
    !modelSupportsImageInput(route.providerId, route.model)
  ) {
    response = blockedImageInputResponse({
      turnId: input.turnId,
      route,
      reason: "model_does_not_support_image_input",
      replyText:
        "This turn includes an image, but the selected model cannot read images. Try again with an image-input model.",
    });
  } else {
    response = useCoreToolRuntime
      ? await runCoreAgentToolTurn({
          db: env.DB,
          userId: input.userId,
          requestId: input.requestId,
          turnId: input.turnId,
          ownerTimezone: owner?.timezone,
          route,
          messages,
          mailboxServices: {
            search: (options) => listAgentMailboxMessages(env, input.userId, options),
            read: (messageId) => getAgentMailboxMessage(env, input.userId, messageId),
            createDraft: (draft, idempotencyKey) =>
              createAgentMailboxDraft(env, input.userId, draft, { idempotencyKey }),
          },
          schedulingServices,
          peopleSearchServices,
          webResearchServices,
          landingPageEnv: env,
          streamOptions,
        })
      : await runModelTurn(route, messages, input.turnId, imageInputs);
  }
  turnPerformance.executionMs = elapsedMs(executionStartedAt);
  response = attachAgentContextToResponse(response, agentContext);
  const messagePersistenceStartedAt = performance.now();
  await persistAssistantMessage(
    env,
    input.userId,
    "user",
    input.messageText,
    input.threadId,
    assistantUserMessageMetadataForInput(input),
  );
  if (response.replyText) {
    await persistAssistantMessage(
      env,
      input.userId,
      "assistant",
      response.replyText,
      input.threadId,
      assistantMessageMetadataForResponse(response),
    );
  }
  turnPerformance.messagePersistenceMs = elapsedMs(
    messagePersistenceStartedAt,
  );
  response.threadId = input.threadId ?? null;
  response.mode = mode;
  await touchAssistantThread(env, input.userId, input.threadId);
  response = attachAgentTurnTrace(env, response, {
    input,
    plannerDecision: toolPlan.decision,
    route,
    context: agentContext,
  });
  response = withoutPrivateAgentResponseContext(response);
  response = attachAgentChatPerformance(
    response,
    turnPerformance,
    dispatchStartedAt,
    "fresh",
  );

  await persistAgentTurnResult(env.DB, storage, input, resultKey, response);
  return response;
}

export async function getAgentSandboxTurnResult(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  requestId: string,
): Promise<AgentSandboxDispatchResponse | null> {
  return getPersistedAgentTurnResult<AgentSandboxDispatchResponse>(
    env.DB,
    userId,
    requestId,
  );
}

function appendAgentAttachmentReferenceContext(
  messageText: string,
  attachments: AgentSandboxDispatchInput["attachments"],
  attachmentTextContext?: string | null,
) {
  const references = normalizeAgentAttachmentReferences(attachments);
  const textContext = normalizeNullableText(attachmentTextContext);
  if (references.length === 0 && !textContext) return messageText;
  const rendered = references
    .map((attachment, index) =>
      [
        `${index + 1}. ${attachment.name || "Attachment"}`,
        `kind=${attachment.kind || "unknown"}`,
        `type=${attachment.mimeType || "unknown"}`,
        `size=${typeof attachment.size === "number" ? attachment.size : "unknown"}`,
        attachment.hasText ? "text=available" : null,
        attachment.textTruncated ? "text=truncated" : null,
        attachment.storageKey ? `storageRef=${attachment.storageKey}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    )
    .join("\n");
  const parts = [messageText];
  if (rendered) parts.push(`Assistant attachment references:\n${rendered}`);
  if (textContext) parts.push(textContext);
  return parts.join("\n\n");
}

async function loadAgentImageInputs(
  env: CoreAgentChatEnv,
  attachments: AgentSandboxDispatchInput["attachments"],
): Promise<AgentChatImageInput[]> {
  const references = normalizeAgentAttachmentReferences(attachments).filter(
    (attachment) => attachment.kind === "image",
  );
  if (references.length === 0) return [];
  if (!env.SITE_ASSETS) throw new Error("Image attachment storage is not configured.");

  const images: AgentChatImageInput[] = [];
  for (const attachment of references) {
    const storageKey = attachment.storageKey;
    if (!storageKey) throw new Error(`${attachment.name || "Image"} has no storage reference.`);
    const object = await env.SITE_ASSETS.get(storageKey);
    if (!object) throw new Error(`${attachment.name || "Image"} is no longer available.`);
    const mimeType =
      normalizeImageMimeType(attachment.mimeType) ||
      normalizeImageMimeType(object.httpMetadata?.contentType) ||
      "image/png";
    const bytes = new Uint8Array(await object.arrayBuffer());
    const base64 = bytesToBase64(bytes);
    images.push({
      name: attachment.name || "Image",
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
    });
  }
  return images;
}

function normalizeImageMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mimeType = value.trim().toLowerCase();
  return mimeType.startsWith("image/") ? mimeType : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function normalizeAgentAttachmentReferences(
  attachments: AgentSandboxDispatchInput["attachments"],
): AgentChatAttachmentReference[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      id: normalizeNullableText((attachment as AgentChatAttachmentReference).id),
      name: normalizeNullableText((attachment as AgentChatAttachmentReference).name),
      mimeType: normalizeNullableText((attachment as AgentChatAttachmentReference).mimeType),
      size:
        typeof (attachment as AgentChatAttachmentReference).size === "number" &&
        Number.isFinite((attachment as AgentChatAttachmentReference).size)
          ? Math.max(0, Math.round((attachment as AgentChatAttachmentReference).size || 0))
          : null,
      kind: normalizeNullableText((attachment as AgentChatAttachmentReference).kind),
      status: normalizeNullableText((attachment as AgentChatAttachmentReference).status),
      storageKey: normalizeNullableText((attachment as AgentChatAttachmentReference).storageKey),
      hasText: Boolean((attachment as AgentChatAttachmentReference).hasText),
      textTruncated: Boolean((attachment as AgentChatAttachmentReference).textTruncated),
    }))
    .filter((attachment) => attachment.status === "ready" && Boolean(attachment.id));
}

function assistantUserMessageMetadataForInput(
  input: Pick<AgentSandboxDispatchInput, "attachments">,
): Record<string, unknown> | null {
  const attachments = normalizeAgentAttachmentReferences(input.attachments);
  return attachments.length ? { attachments } : null;
}

type AssistantImageTurnResult = {
  response: AgentSandboxDispatchResponse;
  route: AiRoute | null;
  messageAssetLinks?: PendingAssistantMessageAssetLink[];
};

async function maybeHandleAssistantImageTurn(
  env: CoreAgentChatEnv,
  input: AgentSandboxDispatchInput,
  intent: ReturnType<typeof classifyAssistantImageIntent>,
): Promise<AssistantImageTurnResult | null> {
  if (intent.kind === "none") return null;

  const prompt = input.messageText.trim();
  if (intent.kind === "ambiguous") {
    return {
      route: null,
      response: blockedImageResponse({
        turnId: input.turnId,
        prompt,
        kind: "blocked",
        reason: "image_generation_intent_ambiguous",
        replyText:
          "Do you want me to generate an image, or write a text prompt for one?",
        route: null,
      }),
    };
  }

  if (intent.capability === "image_edit") {
    return {
      route: null,
      response: blockedImageResponse({
        turnId: input.turnId,
        prompt,
        kind: "blocked",
        reason: "image_edit_not_enabled",
        replyText:
          "Image editing is not enabled in ME3 yet. I can help draft edit instructions, but I won't send this to a text model as if it can edit images.",
        route: null,
      }),
    };
  }

  const route = normalizeAgentChatMode(input.mode) === "owner"
    ? null
    : await resolveImageGenerationRoute(
        env,
        input.userId,
        input.selectedModel,
        intent.capability,
      );

  if (!route) {
    return {
      route: null,
      response: blockedImageResponse({
        turnId: input.turnId,
        prompt,
        kind: "blocked",
        reason: "image_generation_route_unavailable",
        replyText:
          "Image generation needs a compatible image route. Configure Workers AI or another image provider before trying again.",
        route: null,
      }),
    };
  }

  if (!modelSupportsCapability(route.providerId, route.model, intent.capability)) {
    return {
      route,
      response: blockedImageResponse({
        turnId: input.turnId,
        prompt,
        kind: "blocked",
        reason: "image_generation_route_incompatible",
        replyText:
          "The configured image route does not support image generation. Use GPT Image 2 or another tested image model.",
        route,
      }),
    };
  }

  if (!route.configured) {
    return {
      route,
      response: blockedImageResponse({
        turnId: input.turnId,
        prompt,
        kind: "blocked",
        reason: "image_generation_provider_unconfigured",
        replyText:
          "Image generation is routed to a compatible model, but the provider is not configured yet. Add the provider setup in Account > AI model before trying again.",
        route,
      }),
    };
  }

  if (!env.SITE_ASSETS) {
    return {
      route,
      response: failedImageResponse({
        turnId: input.turnId,
        prompt,
        reason: "image_generation_storage_unavailable",
        replyText:
          "Image generation needs the SITE_ASSETS R2 binding so generated files can be saved. Add storage before trying again.",
        route,
      }),
    };
  }

  try {
    const generated = await runAssistantImageGeneration(env, {
      ownerId: input.userId,
      threadId: input.threadId ?? null,
      turnId: input.turnId,
      prompt,
      route,
    });
    const replyText = "Generated an image and saved it to this conversation.";
    return {
      route,
      messageAssetLinks: generated.messageAssetLinks,
      response: {
        ok: true,
        auditId: null,
        turnId: input.turnId,
        specialist: "core.agent-chat.image-generation",
        replyText,
        model: route.model,
        source: route.providerId,
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        actionCards: null,
        imageAction: {
          kind: "generated",
          status: "complete",
          prompt,
          revisedPrompt: generated.revisedPrompt,
          providerId: route.providerId,
          model: route.model,
          reason: null,
          assets: generated.assets,
        },
        contentAction: null,
        contactsChanged: false,
      },
    };
  } catch (error) {
    const failure = describeAssistantImageGenerationFailure(error);
    return {
      route,
      response: failedImageResponse({
        turnId: input.turnId,
        prompt,
        reason: failure.reason,
        replyText: failure.replyText,
        route,
        debugError: failure.debugError,
      }),
    };
  }
}

function describeAssistantImageGenerationFailure(error: unknown): {
  reason: string;
  replyText: string;
  debugError: string;
} {
  const debugError = modelErrorMessage(error) || "Image generation failed";
  if (
    /\b3030\b|output has been flagged|moderation_blocked|image_generation_user_error/i.test(
      debugError,
    )
  ) {
    return {
      reason: "image_generation_provider_moderation",
      replyText:
        "The image provider blocked that result. Try rewording the request or adding neutral visual details, and I can try again.",
      debugError,
    };
  }
  return {
    reason: "image_generation_failed",
    replyText:
      "I tried to generate the image, but the image provider or asset storage failed before I could save it.",
    debugError,
  };
}

function blockedImageResponse(input: {
  turnId: string;
  prompt: string;
  kind: AgentChatImageAction["kind"];
  reason: string;
  replyText: string;
  route: AiRoute | null;
}): AgentSandboxDispatchResponse {
  return {
    ok: true,
    auditId: null,
    turnId: input.turnId,
    specialist: "core.agent-chat.image-generation",
    replyText: input.replyText,
    model: input.route?.model ?? null,
    source: "fallback",
    fallbackReason: "Image generation blocked",
    debugError: input.reason,
    emailAction: null,
    reminderAction: null,
    actionCards: null,
    imageAction: {
      kind: input.kind,
      status: "blocked",
      prompt: input.prompt,
      revisedPrompt: null,
      providerId: input.route?.providerId ?? null,
      model: input.route?.model ?? null,
      reason: input.reason,
      assets: [],
    },
    contentAction: null,
    contactsChanged: false,
  };
}

function blockedImageInputResponse(input: {
  turnId: string;
  route: AiRoute;
  reason: string;
  replyText: string;
  debugError?: string | null;
}): AgentSandboxDispatchResponse {
  return {
    ok: true,
    auditId: null,
    turnId: input.turnId,
    specialist: "core.agent-chat",
    replyText: input.replyText,
    model: input.route.model,
    source: "fallback",
    fallbackReason: "Image input blocked",
    debugError: input.debugError || input.reason,
    emailAction: null,
    reminderAction: null,
    actionCards: null,
    contentAction: null,
    contactsChanged: false,
  };
}

function failedImageResponse(input: {
  turnId: string;
  prompt: string;
  reason: string;
  replyText: string;
  route: AiRoute | null;
  debugError?: string | null;
}): AgentSandboxDispatchResponse {
  return {
    ok: true,
    auditId: null,
    turnId: input.turnId,
    specialist: "core.agent-chat.image-generation",
    replyText: input.replyText,
    model: input.route?.model ?? null,
    source: "fallback",
    fallbackReason: "Image generation failed",
    debugError: input.debugError || input.reason,
    emailAction: null,
    reminderAction: null,
    actionCards: null,
    imageAction: {
      kind: "generated",
      status: "failed",
      prompt: input.prompt,
      revisedPrompt: null,
      providerId: input.route?.providerId ?? null,
      model: input.route?.model ?? null,
      reason: input.reason,
      assets: [],
    },
    contentAction: null,
    contactsChanged: false,
  };
}

async function runAssistantImageGeneration(
  env: CoreAgentChatEnv,
  input: {
    ownerId: string;
    threadId: string | null;
    turnId: string;
    prompt: string;
    route: AiRoute;
  },
): Promise<{
  revisedPrompt: string | null;
  assets: AgentChatGeneratedImageAsset[];
  messageAssetLinks: PendingAssistantMessageAssetLink[];
}> {
  if (!env.SITE_ASSETS) throw new Error("SITE_ASSETS R2 binding is not configured.");

  const { bytes, mimeType, revisedPrompt, usage } =
    await runAssistantImageProviderGeneration(
      input.route,
      input.prompt,
      {
        width: DEFAULT_IMAGE_GENERATION_WIDTH,
        height: DEFAULT_IMAGE_GENERATION_HEIGHT,
      },
    );
  const attachmentId = crypto.randomUUID();
  const extension = extensionForMimeType(mimeType);
  const filename = `generated-image-${attachmentId}.${extension}`;
  const storageKey = [
    "assistant",
    input.ownerId,
    "generated",
    new Date().toISOString().slice(0, 10),
    filename,
  ].join("/");
  const metadata = {
    source: "assistant-image-generation",
    providerId: input.route.providerId,
    model: input.route.model,
    revisedPrompt,
    turnId: input.turnId,
  };

  await env.SITE_ASSETS.put(storageKey, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      ownerId: input.ownerId,
      threadId: input.threadId || "",
      attachmentId,
      source: "assistant-image-generation",
    },
  });

  try {
    await env.DB.prepare(
      `INSERT INTO assistant_attachments
         (id, owner_id, thread_id, filename, mime_type, size, kind, status,
          storage_key, extracted_text, text_truncated, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, 'image', 'ready', ?, NULL, 0, ?)`,
    )
      .bind(
        attachmentId,
        input.ownerId,
        input.threadId,
        filename,
        mimeType,
        bytes.byteLength,
        storageKey,
        JSON.stringify(metadata),
      )
      .run();
  } catch (error) {
    await env.SITE_ASSETS.delete(storageKey).catch(() => undefined);
    throw error;
  }

  await recordAssistantImageUsage(env, {
    ownerId: input.ownerId,
    providerId: input.route.providerId,
    model: input.route.model,
    width: DEFAULT_IMAGE_GENERATION_WIDTH,
    height: DEFAULT_IMAGE_GENERATION_HEIGHT,
    usage,
    turnId: input.turnId,
    attachmentId,
  }).catch(() => undefined);

  await saveGeneratedAssistantImageToFiles(env, {
    ownerId: input.ownerId,
    threadId: input.threadId,
    attachmentId,
    filename,
    mimeType,
    bytes,
    storageKey,
  }).catch(() => undefined);

  const asset: AgentChatGeneratedImageAsset = {
    id: attachmentId,
    attachmentId,
    name: filename,
    mimeType,
    size: bytes.byteLength,
    width: null,
    height: null,
    url: `/api/assistant/attachments/${encodeURIComponent(attachmentId)}/content`,
    storageKey,
  };

  return {
    revisedPrompt,
    assets: [asset],
    messageAssetLinks: [
      {
        id: crypto.randomUUID(),
        attachmentId,
        role: "generated_output",
        displayOrder: 0,
        metadata,
      },
    ],
  };
}

const ASSISTANT_GENERATED_IMAGES_FOLDER = "Generated Images";
const ASSISTANT_GENERATED_IMAGES_PATH = "Generated-Images";

async function saveGeneratedAssistantImageToFiles(
  env: CoreAgentChatEnv,
  input: {
    ownerId: string;
    threadId: string | null;
    attachmentId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    storageKey: string;
  },
): Promise<void> {
  let folder = await env.DB.prepare(
    `SELECT id
     FROM drive_folders
     WHERE owner_id = ? AND parent_id IS NULL AND status = 'active'
       AND name = ? COLLATE NOCASE
     LIMIT 1`,
  )
    .bind(input.ownerId, ASSISTANT_GENERATED_IMAGES_FOLDER)
    .first<{ id: string }>();

  if (!folder) {
    const folderId = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO drive_folders
           (id, owner_id, parent_id, name, path, status)
         VALUES (?, ?, NULL, ?, ?, 'active')`,
      )
        .bind(
          folderId,
          input.ownerId,
          ASSISTANT_GENERATED_IMAGES_FOLDER,
          ASSISTANT_GENERATED_IMAGES_PATH,
        )
        .run();
      folder = { id: folderId };
    } catch {
      folder = await env.DB.prepare(
        `SELECT id
         FROM drive_folders
         WHERE owner_id = ? AND parent_id IS NULL AND status = 'active'
           AND name = ? COLLATE NOCASE
         LIMIT 1`,
      )
        .bind(input.ownerId, ASSISTANT_GENERATED_IMAGES_FOLDER)
        .first<{ id: string }>();
      if (!folder) throw new Error("Could not create the Generated Images folder.");
    }
  }

  const fileId = crypto.randomUUID();
  const sha256 = await assistantFilesSha256(input.bytes);
  const metadata = {
    source: "assistant-image-generation",
    assistantAttachmentId: input.attachmentId,
    threadId: input.threadId,
    sharedStorage: true,
  };

  await env.DB.prepare(
    `INSERT INTO drive_files
       (id, owner_id, folder_id, filename, mime_type, size, storage_key, sha256,
        status, preview_kind, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'image', ?)`,
  )
    .bind(
      fileId,
      input.ownerId,
      folder.id,
      input.filename,
      input.mimeType,
      input.bytes.byteLength,
      input.storageKey,
      sha256,
      JSON.stringify(metadata),
    )
    .run();
}

async function assistantFilesSha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordAssistantImageUsage(
  env: CoreAgentChatEnv,
  input: {
    ownerId: string;
    providerId: AiProviderId;
    model: string;
    width: number;
    height: number;
    usage: AssistantImageGenerationUsage | null;
    turnId: string;
    attachmentId: string;
  },
): Promise<void> {
  const estimate = estimateAssistantImageUsage(input.providerId, input.model, {
    width: input.width,
    height: input.height,
    usage: input.usage,
  });
  await env.DB.prepare(
    `INSERT INTO ai_usage_events (
       id, user_id, source, kind, provider, model, request_count,
       successful_request_count, failed_request_count, tokens_in, tokens_out,
       estimated_cost_usd, metadata_json, created_at
     )
     VALUES (?, ?, 'local', 'image', ?, ?, 1, 1, 0, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      input.ownerId,
      input.providerId,
      input.model,
      estimate.inputTokens,
      estimate.outputTokens,
      estimate.costUsd,
      JSON.stringify({
        estimated: true,
        pricing: estimate.pricing,
        width: estimate.width,
        height: estimate.height,
        ...estimate.metadata,
        turnId: input.turnId,
        attachmentId: input.attachmentId,
      }),
      new Date().toISOString(),
    )
    .run();
}

function extensionForMimeType(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function loadCoreChatToolTurnPlan(
  env: CoreAgentChatEnv,
  input: AgentSandboxDispatchInput,
): Promise<CoreChatToolTurnPlan> {
  const recent = await loadRecentMessages(env, input.userId, input.threadId);
  return {
    recent: recent.messages,
    sourceReference: recent.sourceReference,
    landingPageReference: recent.landingPageReference,
    peopleSearchReference: recent.peopleSearchReference,
    decision: buildCoreConversationDecision(input.messageText),
  };
}

function maybeHandleCoreDirectTurn(
  input: AgentSandboxDispatchInput,
  route: AiRoute,
): AgentSandboxDispatchResponse | null {
  const messageText = input.messageText.trim();

  if (isConfiguredModelIdentityRequest(messageText)) {
    const backup = route.backupModel && route.backupModel !== route.model
      ? ` If that model is unavailable, ME3 can fall back to ${route.backupModel}.`
      : "";
    const replyText = route.configured
      ? `This Assistant mode is configured to use ${route.model}.${backup}`
      : "This ME3 installation does not currently have an AI model configured.";
    return toolResponse(
      input.turnId,
      "core.agent-chat.conversation",
      replyText,
    );
  }

  return null;
}

function buildCoreConversationDecision(
  messageText: string,
): CoreChatToolPlannerDecision {
  const capability = getCoreChatCapability("core.agent-chat.conversation");
  const orientation = isCoreChatCapabilityExplorationRequest(messageText);
  return {
    kind: "conversation",
    confidence: orientation ? 0.95 : 0.55,
    capabilityId: "core.agent-chat.conversation",
    ownerFacingLabel: capability.ownerFacingLabel,
    handlerRoute: capability.handler.route,
    requiredSetupChecks: [...capability.requiresSetup],
    sideEffectLevel: capability.chat.sideEffectLevel,
    approvalRequired: isCoreChatCapabilityApprovalRequired(capability),
    auditEventKind: capability.auditEventKind,
    reason: orientation
      ? "The owner is exploring setup or agent capabilities."
      : "The configured model can answer directly or select a Runtime v2 tool.",
  };
}

function isCoreChatCapabilityExplorationRequest(messageText: string): boolean {
  // An action can mention setup or testing without being a capabilities tour.
  // Keep tools available for direct requests, including after an introductory
  // sentence, while leaving questions such as "how do I create..." as guidance.
  if (/(?:^|[.!?]\s+)(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:add|create|save|read|list|find|search|update|edit|move|archive|delete|remind|draft|send|schedule|publish|unpublish)\b/i.test(messageText.trim())) {
    return false;
  }
  const normalized = messageText.toLowerCase();
  const toolIndex = normalized.search(/\btools?\b/);
  const actionIndex = ["use ", "using ", "call ", "run "]
    .map((action) => normalized.indexOf(action))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
  if (actionIndex >= 0 && toolIndex > actionIndex) return false;
  const mentionsAssistantScope =
    /\b(?:what|which)\s+(?:you|me3|the\s+agent|the\s+assistant)\s+can\s+(?:do|access|use|help\s+with)\b/i.test(messageText) ||
    /\b(?:tools?|capabilit(?:y|ies)|context|available|access|test\s+run|setting\s+up|setup|first\s+time|make\s+sense)\b/i.test(messageText) ||
    /\b(?:want|need|trying|try)\s+to\s+(?:test|explore)\b/i.test(messageText);
  if (!mentionsAssistantScope) return false;
  return (
    /\b(?:tools?|capabilit(?:y|ies)|what\s+you\s+can\s+do|what\s+context|context\s+you\s+have|access\s+here)\b/i.test(messageText) ||
    /\b(?:setting\s+up|setup|first\s+time|make\s+sense)\b/i.test(messageText) ||
    /\b(?:want|need|trying|try)\s+to\s+(?:test|explore)\b/i.test(messageText) ||
    normalized.includes("for example") ||
    normalized.includes("such as") ||
    normalized.includes("ie ") ||
    normalized.includes("i.e.")
  );
}

function isConfiguredModelIdentityRequest(messageText: string): boolean {
  const text = messageText.trim();
  if (!text || text.length > 180) return false;
  return (
    /\bwhat\s+(?:ai\s+)?model\s+(?:are|is)\s+(?:we|you|me3)\s+(?:using|running|on)\b/i.test(text) ||
    /\bwhich\s+(?:ai\s+)?model\s+(?:are|is)\s+(?:we|you|me3)\s+(?:using|running|on)\b/i.test(text) ||
    /\bwhat(?:'s| is)\s+(?:your|the)\s+(?:underlying\s+|current\s+)?model\b/i.test(text)
  );
}

function toolResponse(
  turnId: string,
  specialist: string,
  replyText: string,
  options: Partial<
    Pick<
      AgentSandboxDispatchResponse,
      | "fallbackReason"
      | "debugError"
      | "emailAction"
      | "reminderAction"
      | "actionCards"
    >
  > = {},
): AgentSandboxDispatchResponse {
  return {
    ok: true,
    auditId: null,
    turnId,
    specialist,
    replyText,
    model: null,
    source: "tool",
    fallbackReason: options.fallbackReason ?? null,
    debugError: options.debugError ?? null,
    emailAction: options.emailAction ?? null,
    reminderAction: options.reminderAction ?? null,
    actionCards: options.actionCards ?? null,
    contentAction: null,
    contactsChanged: false,
  };
}


function stripAgentDraftWrapperText(text: string): string {
  let body = text.replace(/\r\n/g, "\n").trim();
  const paragraphMarker = body.match(DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN);
  const draftMarker =
    paragraphMarker && !draftWrapperParagraphIncludesEmailBody(paragraphMarker[0])
      ? paragraphMarker
      : body.match(DRAFT_WRAPPER_INTRO_LINE_PATTERN);
  if (draftMarker?.index !== undefined) {
    body = body.slice(draftMarker.index + draftMarker[0].length).trim();
  }
  body = body.replace(DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN, "");
  const closingPromptIndex = body.search(
    /\n\s*(?:[-–—]\s*)?(?:please\s+let\s+me\s+know\s+if\s+you(?:'|’)d\s+like\s+(?:me\s+)?to\s+(?:make\s+any\s+changes\s+or\s+if\s+you(?:'|’)d\s+like\s+me\s+to\s+)?save\s+this\s+draft\.?|this is a chat draft only|if you want|if you(?:'|’)d like|if you(?:'|’)re happy|want me to|would you like|send me|I can save)/i,
  );
  if (closingPromptIndex >= 0) body = body.slice(0, closingPromptIndex).trim();
  return body.trim();
}

function draftWrapperParagraphIncludesEmailBody(paragraph: string): boolean {
  const rest = paragraph.split(/\n/).slice(1).join("\n");
  return /^\s*(?:[-–—]{3,}|(?:\*\*)?\s*(?:to|recipient|subject|subject line)\s*:|(?:hi|hello|dear)\b)/im.test(
    rest,
  );
}


function formatAgentDateTime(iso: string, timezone: string | null | undefined): string {
  const normalizedTimezone = normalizeTimeZone(timezone) || "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: normalizedTimezone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function dateTimePartsForInstant(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return next.toISOString().slice(0, 10);
}

async function getAgentContact(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<AgentContact | null> {
  const row = await getAgentContactRow(env, userId, contactId);
  return row ? serializeAgentContact(row) : null;
}

async function getAgentContactRow(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  contactId: string,
): Promise<DbContactRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, name, email, phone, source, source_ref,
            relationship, status, notes, tags, last_interaction_at,
            next_followup_at, outreach_status, social_handles, metadata,
            created_at, updated_at, 0 AS booking_count, NULL AS last_booking_at
     FROM contacts
     WHERE user_id = ? AND id = ?`,
  )
    .bind(userId, contactId)
    .first<DbContactRow>();
}

function summarizeAgentContacts(contacts: AgentContact[]): AgentContactsSummary {
  const outreach: AgentContactsSummary["outreach"] = {
    new: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
    booked: 0,
    converted: 0,
    not_interested: 0,
    no_response: 0,
  };
  for (const contact of contacts) {
    if (contact.outreachStatus && contact.outreachStatus in outreach) {
      outreach[contact.outreachStatus] += 1;
    }
  }
  return {
    total: contacts.length,
    clients: contacts.filter((contact) => contact.relationship === "client").length,
    prospects: contacts.filter((contact) => contact.relationship === "prospect").length,
    contacts: contacts.filter((contact) => contact.relationship === "contact").length,
    active: contacts.filter((contact) => contact.status === "active").length,
    dormant: contacts.filter((contact) => contact.status === "dormant").length,
    archived: contacts.filter((contact) => contact.status === "archived").length,
    needsFollowUp: contacts.filter(
      (contact) => contact.nextFollowupAt && contact.status === "active",
    ).length,
    outreach,
  };
}

async function getAgentMailboxRow(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
): Promise<DbMailboxAliasRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, alias_local_part, forwarding_email, forwarding_status,
            forwarding_enabled, forwarding_mode, status, approval_policy,
            daily_inbound_limit, daily_outbound_limit, activated_at,
            cf_destination_id, cf_destination_verified_at, cf_rule_id,
            cf_last_synced_at, cf_last_error, created_at, updated_at
     FROM mailbox_aliases
     WHERE user_id = ?`,
  )
    .bind(userId)
    .first<DbMailboxAliasRow>();
}

function suggestAgentMailboxAlias(value: string): string {
  const atIndex = value.indexOf("@");
  const base = normalizeAgentMailboxAlias(
    atIndex === -1 ? value : value.slice(0, atIndex),
  );
  return base || "owner";
}

function normalizeAgentMailboxAlias(value: string): string {
  let normalized = "";
  for (const character of value.trim().toLowerCase()) {
    if (isAgentMailboxAliasCharacter(character)) normalized += character;
  }
  let start = 0;
  let end = normalized.length;
  while (start < end && !isAgentMailboxAliasAlphaNumeric(normalized[start])) {
    start += 1;
  }
  while (end > start && !isAgentMailboxAliasAlphaNumeric(normalized[end - 1])) {
    end -= 1;
  }
  return normalized.slice(start, end);
}

function isAgentMailboxAliasCharacter(value: string): boolean {
  return isAgentMailboxAliasAlphaNumeric(value) || value === "." || value === "_" || value === "-";
}

function isAgentMailboxAliasAlphaNumeric(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function isValidEmail(value: string): boolean {
  const atIndex = value.indexOf("@");
  if (
    atIndex <= 0 ||
    atIndex !== value.lastIndexOf("@") ||
    atIndex >= value.length - 1
  ) {
    return false;
  }
  const dotIndex = value.indexOf(".", atIndex + 1);
  if (dotIndex <= atIndex + 1 || dotIndex >= value.length - 1) return false;
  for (const character of value) {
    if (
      character === " " ||
      character === "\n" ||
      character === "\r" ||
      character === "\t"
    ) {
      return false;
    }
  }
  return true;
}

function normalizeEmailText(value: unknown): string | null {
  return normalizeNullableText(value)?.toLowerCase() || null;
}

function getAgentMailboxInternalAddress(localPart: string): string {
  return `${localPart}@me3.local`;
}

function getAgentMailboxManagedAddress(localPart: string): string {
  return `${localPart}@me3.app`;
}

function serializeAgentMailbox(row: DbMailboxAliasRow, aliasAddress: string | null = null) {
  return {
    id: row.id,
    aliasLocalPart: row.alias_local_part,
    aliasAddress,
    forwardingEmail: row.forwarding_email,
    forwardingStatus: row.forwarding_status,
    forwardingEnabled: Boolean(row.forwarding_enabled),
    forwardingMode: row.forwarding_mode,
    status: row.status,
    approvalPolicy: row.approval_policy,
    dailyInboundLimit: row.daily_inbound_limit,
    dailyOutboundLimit: row.daily_outbound_limit,
    activatedAt: row.activated_at,
    forwardingVerifiedAt: row.cf_destination_verified_at,
    cloudflareDestinationId: row.cf_destination_id,
    cloudflareRuleId: row.cf_rule_id,
    cloudflareLastSyncedAt: row.cf_last_synced_at,
    cloudflareLastError: row.cf_last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeAgentMailboxManagedSource(
  row: DbMailboxAliasRow,
  address: string,
): AgentMailboxSource {
  return {
    id: row.id,
    type: "me3_alias",
    address,
    status: row.status === "active" ? "active" : row.status === "paused" ? "paused" : "pending",
    inboundEnabled: row.status === "active",
    outboundEnabled: true,
  };
}

function serializeAgentMailboxConfiguredSource(
  identity: { id: string; address: string },
): AgentMailboxSource {
  return {
    id: identity.id,
    type: "custom_domain",
    address: identity.address,
    status: "active",
    inboundEnabled: false,
    outboundEnabled: true,
  };
}

function normalizeAgentMailboxConfiguredIdentity(
  identity: { id: string; address: string } | null | undefined,
): { id: string; address: string } | null {
  const id = normalizeNullableText(identity?.id);
  const address = normalizeEmailText(identity?.address);
  if (!id || !address || !isValidEmail(address) || address.endsWith("@me3.local")) {
    return null;
  }
  return { id, address };
}

function agentMailboxMessageSelectSql(): string {
  return `SELECT id, direction, message_kind, status, thread_key, from_address,
                 provider_id, provider_message_id, to_address, subject, text_body,
                 html_body, raw_headers_json, metadata_json,
                 agent_idempotency_key, source_id, folder, read_at,
                 agent_summary, agent_labels_json, forwarded_to, error_message,
                 created_by, approved_by_user_id, received_at, approved_at,
                 sent_at, created_at
          FROM mailbox_messages`;
}

async function getAgentMailboxActivity(
  env: Pick<CoreAgentChatEnv, "DB">,
  mailboxId: string,
  limit: number,
  offset: number,
): Promise<AgentMailboxMessage[]> {
  const rows = await env.DB.prepare(
    `${agentMailboxMessageSelectSql()}
     WHERE mailbox_id = ?
     ORDER BY COALESCE(sent_at, received_at, approved_at, created_at) DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(mailboxId, limit, offset)
    .all<DbMailboxMessageRow>();

  return (rows.results || []).map(serializeAgentMailboxMessage);
}

function buildAgentMailboxMessageFilters(
  mailboxId: string,
  options: {
    status: string;
    createdBy: string;
    direction: string;
    folder: string;
    query: string;
    unread: string;
  },
) {
  const conditions = ["mailbox_id = ?"];
  const bindings: (string | number)[] = [mailboxId];
  const folder = normalizeFolder(options.folder);
  if (folder) {
    conditions.push("folder = ?");
    bindings.push(folder);
  }
  if (options.status) {
    const statuses = options.status.split(",").map((status) => status.trim()).filter(Boolean);
    if (statuses.length === 1) {
      conditions.push("status = ?");
      bindings.push(statuses[0]);
    } else if (statuses.length > 1) {
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      bindings.push(...statuses);
    }
  }
  if (options.createdBy) {
    conditions.push("created_by = ?");
    bindings.push(options.createdBy);
  }
  if (options.direction && options.direction !== "all") {
    conditions.push("direction = ?");
    bindings.push(options.direction);
  }
  if (["1", "true", "yes"].includes(options.unread.toLowerCase())) {
    conditions.push("direction = 'inbound'");
    conditions.push("read_at IS NULL");
  }
  if (options.query.trim()) {
    conditions.push(
      `(LOWER(COALESCE(subject, '')) LIKE ? OR LOWER(COALESCE(text_body, '')) LIKE ? OR LOWER(COALESCE(from_address, '')) LIKE ? OR LOWER(COALESCE(to_address, '')) LIKE ?)`,
    );
    const like = `%${options.query.trim().toLowerCase()}%`;
    bindings.push(like, like, like, like);
  }

  return { where: conditions.join(" AND "), bindings };
}

function normalizeFolder(value: unknown): string | null {
  const folder = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MAILBOX_FOLDERS.has(folder) ? folder : null;
}

function serializeAgentMailboxMessage(row: DbMailboxMessageRow) {
  const metadata = parseJsonRecord(row.metadata_json);
  const headers = parseJsonRecord(row.raw_headers_json);
  const fromHeader = parseEmailAddressHeader(getHeaderValue(headers, "from"));
  const agentLabels = parseJsonArray(row.agent_labels_json);
  const unsubscribeAction = getMailboxUnsubscribeAction(row);
  const body = getSerializedAgentMailboxMessageBody(row);
  return {
    id: row.id,
    direction: row.direction,
    kind: row.message_kind,
    status: row.status,
    threadKey: row.thread_key,
    providerId: row.provider_id,
    providerMessageId: row.provider_message_id,
    fromAddress: fromHeader?.address || row.from_address,
    fromName: fromHeader?.name || null,
    toAddress: row.to_address,
    subject: decodeMimeHeaderValue(row.subject || "(no subject)"),
    body,
    htmlBody: row.html_body || null,
    preview: body.slice(0, 280),
    metadata,
    unsubscribeAction,
    sourceId: row.source_id,
    folder: row.folder,
    readAt: row.read_at,
    unread: row.direction === "inbound" && !row.read_at,
    agentSummary: row.agent_summary,
    agentLabels,
    forwardedTo: row.forwarded_to,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    approvedByUserId: row.approved_by_user_id,
    receivedAt: row.received_at,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

function getSerializedAgentMailboxMessageBody(row: DbMailboxMessageRow): string {
  const body = row.text_body || "";
  if (
    row.message_kind === "draft" &&
    row.status === "pending_approval" &&
    row.created_by === "agent"
  ) {
    return stripAgentDraftWrapperText(body);
  }
  return body;
}

function getMailboxUnsubscribeAction(
  row: DbMailboxMessageRow,
): MailboxUnsubscribeAction | null {
  if (row.direction !== "inbound" || row.message_kind !== "email") return null;
  const headers = parseJsonRecord(row.raw_headers_json);
  const listUnsubscribe = getHeaderValue(headers, "list-unsubscribe");
  if (!listUnsubscribe) return null;

  const urls = parseListUnsubscribeUrls(listUnsubscribe);
  const oneClick =
    getHeaderValue(headers, "list-unsubscribe-post")?.trim().toLowerCase() ===
    "list-unsubscribe=one-click";
  if (oneClick && urls.some((url) => isHttpsUrl(url))) {
    return { available: true, mode: "one_click" };
  }
  if (urls.some((url) => isHttpsUrl(url))) {
    return { available: true, mode: "link" };
  }
  if (urls.some((url) => url.trim().toLowerCase().startsWith("mailto:"))) {
    return { available: true, mode: "mailto" };
  }
  return null;
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

async function normalizeAgentMailboxDraftInput(
  env: Pick<CoreAgentChatEnv, "DB">,
  mailbox: DbMailboxAliasRow,
  body: AgentMailboxDraftInput,
  existing?: DbMailboxMessageRow,
): Promise<NormalizedMailboxDraftInput | { error: string; status: number }> {
  const fromAddress =
    normalizeEmailText(body.fromAddress) ||
    existing?.from_address ||
    getAgentMailboxInternalAddress(mailbox.alias_local_part);
  const rawToAddress = body.toAddress === undefined ? body.to : body.toAddress;
  const toAddress =
    rawToAddress === undefined
      ? existing?.to_address || ""
      : normalizeEmailText(rawToAddress) || "";
  if (!isValidEmail(fromAddress)) {
    return { error: "Draft sender is invalid", status: 400 };
  }

  const replyToMessageId = normalizeNullableText(body.replyToMessageId);
  const replyTo = replyToMessageId
    ? await getAgentMailboxMessageById(env, mailbox.id, replyToMessageId)
    : null;
  const existingHeaders = getDraftOutboundHeaders(existing);
  const replyHeaders = getReplyThreadHeaders(replyTo);
  const messageIdHeader =
    existingHeaders.messageIdHeader || createMessageIdHeader(fromAddress);
  const threadKey =
    replyTo?.thread_key ||
    replyTo?.id ||
    existing?.thread_key ||
    messageIdHeader;
  const source = normalizeNullableText(body.source);
  const createdBy = source === "agent" ? "agent" : "owner";
  const normalizedTextBody =
    body.textBody === undefined
      ? existing?.text_body || ""
      : normalizeNullableText(body.textBody) || "";
  const allowedAttachmentSources = [replyTo, existing].filter(
    (row): row is DbMailboxMessageRow => Boolean(row),
  );
  const preservedAttachments = selectPreservedAttachments(
    allowedAttachmentSources,
    body.preservedAttachmentKeys,
  );
  const uploadedAttachments = normalizeUploadedAttachments(
    mailbox.id,
    body.uploadedAttachments,
  );

  return {
    fromAddress,
    toAddress,
    subject:
      body.subject === undefined
        ? existing?.subject || ""
        : normalizeNullableText(body.subject) || "",
    textBody:
      createdBy === "agent"
        ? stripAgentDraftWrapperText(normalizedTextBody)
        : normalizedTextBody,
    htmlBody:
      body.htmlBody === undefined
        ? existing?.html_body || null
        : normalizeNullableText(body.htmlBody),
    sourceId: replyTo?.id || existing?.source_id || null,
    threadKey,
    messageIdHeader,
    inReplyTo: replyHeaders.inReplyTo || existingHeaders.inReplyTo,
    referencesHeader: replyHeaders.referencesHeader || existingHeaders.referencesHeader,
    createdBy,
    preservedAttachments: mergeAttachmentMetadata([
      ...preservedAttachments,
      ...uploadedAttachments,
    ]),
  };
}

async function insertAgentMailboxDraft(
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

async function getAgentMailboxDraftByIdempotencyKey(
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

async function updateAgentMailboxDraftRow(
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

function createDraftMetadata(input: NormalizedMailboxDraftInput): Record<string, unknown> {
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

function selectPreservedAttachments(
  sources: DbMailboxMessageRow[],
  rawKeys: unknown,
): AgentMailboxAttachmentMetadata[] {
  const requested = normalizePreservedAttachmentKeys(rawKeys);
  if (requested.size === 0 || sources.length === 0) return [];

  const selected: AgentMailboxAttachmentMetadata[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const attachment of getMailboxAttachmentMetadata(source)) {
      const storageKey = attachment.storageKey?.trim();
      if (!storageKey || !requested.has(storageKey) || seen.has(storageKey)) continue;
      selected.push({
        filename: attachment.filename || null,
        mimeType: attachment.mimeType || null,
        disposition: attachment.disposition || "attachment",
        size: attachment.size || null,
        storageKey,
        sourceMessageId: attachment.sourceMessageId || source.id,
      });
      seen.add(storageKey);
    }
  }
  return selected;
}

function normalizePreservedAttachmentKeys(rawKeys: unknown): Set<string> {
  if (!Array.isArray(rawKeys)) return new Set();
  return new Set(
    rawKeys
      .map((key) => (typeof key === "string" ? key.trim() : ""))
      .filter((key) => key.length > 0),
  );
}

function normalizeUploadedAttachments(
  mailboxId: string,
  rawAttachments: unknown,
): AgentMailboxAttachmentMetadata[] {
  if (!Array.isArray(rawAttachments)) return [];
  const allowedPrefix = `mailbox/${mailboxId}/uploads/`;
  const normalized: AgentMailboxAttachmentMetadata[] = [];
  for (const attachment of rawAttachments) {
    if (!isPlainObject(attachment)) continue;
    const storageKey = normalizeNullableText(attachment.storageKey);
    if (!storageKey?.startsWith(allowedPrefix)) continue;
    normalized.push({
      filename: normalizeNullableText(attachment.filename) || null,
      mimeType: normalizeNullableText(attachment.mimeType) || null,
      disposition: "attachment",
      size:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? attachment.size
          : null,
      storageKey,
      sourceMessageId: null,
    });
  }
  return normalized;
}

function mergeAttachmentMetadata(
  attachments: AgentMailboxAttachmentMetadata[],
): AgentMailboxAttachmentMetadata[] {
  const seen = new Set<string>();
  const merged: AgentMailboxAttachmentMetadata[] = [];
  for (const attachment of attachments) {
    const storageKey = attachment.storageKey?.trim();
    if (!storageKey || seen.has(storageKey)) continue;
    merged.push(attachment);
    seen.add(storageKey);
  }
  return merged;
}

function getMailboxAttachmentMetadata(row: DbMailboxMessageRow): AgentMailboxAttachmentMetadata[] {
  const metadata = parseJsonRecord(row.metadata_json);
  const rawAttachments = Array.isArray(metadata.attachments)
    ? metadata.attachments
    : [];
  return rawAttachments
    .filter(isPlainObject)
    .map((attachment) => ({
      filename: normalizeNullableText(attachment.filename),
      mimeType: normalizeNullableText(attachment.mimeType),
      disposition: normalizeNullableText(attachment.disposition),
      size:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? attachment.size
          : null,
      storageKey: normalizeNullableText(attachment.storageKey),
      sourceMessageId: normalizeNullableText(attachment.sourceMessageId),
    }))
    .filter((attachment) => Boolean(attachment.storageKey));
}

function createMessageIdHeader(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "me3.local";
  return `<${crypto.randomUUID()}@${domain}>`;
}

function getDraftOutboundHeaders(row?: DbMailboxMessageRow | null): {
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
} {
  const metadata = parseJsonRecord(row?.metadata_json || null);
  const outboundHeaders = isPlainObject(metadata.outbound_headers)
    ? metadata.outbound_headers
    : {};
  return {
    messageIdHeader: normalizeMessageHeader(outboundHeaders.message_id),
    inReplyTo: normalizeMessageHeader(outboundHeaders.in_reply_to),
    referencesHeader: normalizeReferencesHeader(outboundHeaders.references),
  };
}

function getReplyThreadHeaders(row?: DbMailboxMessageRow | null): {
  inReplyTo: string | null;
  referencesHeader: string | null;
} {
  if (!row) return { inReplyTo: null, referencesHeader: null };
  const rawHeaders = parseJsonRecord(row.raw_headers_json);
  const messageId = normalizeMessageHeader(
    rawHeaders["message-id"] ?? rawHeaders["Message-ID"] ?? rawHeaders.messageId,
  );
  const previousReferences = normalizeReferencesHeader(
    rawHeaders.references ?? rawHeaders.References,
  );
  return {
    inReplyTo: messageId,
    referencesHeader: normalizeReferencesHeader(
      [previousReferences, messageId].filter(Boolean).join(" "),
    ),
  };
}

function normalizeMessageHeader(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const header = value.trim();
  return header && header.length <= 998 ? header : null;
}

function normalizeReferencesHeader(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeReferencesHeader(value.filter((item) => typeof item === "string").join(" "));
  }
  return normalizeMessageHeader(value);
}

async function getAgentMailboxMessageById(
  env: Pick<CoreAgentChatEnv, "DB">,
  mailboxId: string,
  messageId: string,
): Promise<DbMailboxMessageRow | null> {
  return (
    (await env.DB.prepare(`${agentMailboxMessageSelectSql()} WHERE id = ? AND mailbox_id = ?`)
      .bind(messageId, mailboxId)
      .first<DbMailboxMessageRow>()) || null
  );
}

function normalizeContactMetadata(
  input: AgentContactInput,
): Record<string, unknown> | null {
  const metadata = { ...(input.metadata || {}) };
  if (input.closeness) metadata.closeness = input.closeness;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email || null;
}

async function contactEmailExists(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  email: string,
  exceptContactId?: string,
): Promise<boolean> {
  const { contacts } = await listAgentContacts(env, userId);
  return contacts.some(
    (contact) =>
      contact.id !== exceptContactId &&
      contact.email?.trim().toLowerCase() === email,
  );
}

function duplicateContactEmailError() {
  return { error: "This email is already saved as a contact.", status: 409 as const };
}

function isDuplicateContactEmailError(error: unknown): boolean {
  return error instanceof Error &&
    /UNIQUE constraint failed: contacts\.user_id, contacts\.email|SQLITE_CONSTRAINT_UNIQUE/i.test(
      error.message,
    );
}

function normalizeContactOutreachStatus(value: unknown): AgentContactOutreachStatus {
  const normalized = typeof value === "string" ? value.trim() : "";
  return OUTREACH_STATUSES.has(normalized as Exclude<AgentContactOutreachStatus, null>)
    ? (normalized as Exclude<AgentContactOutreachStatus, null>)
    : null;
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonRecordArray(value: string | null): Record<string, unknown>[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => isPlainObject(item))
      : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function contextSource(input: {
  id: string;
  kind: Me3AgentContextSource["kind"];
  label: string;
  visibility: Me3AgentContextSource["visibility"];
  reason?: string;
  sourceRef?: string | null;
  updatedAt?: string | null;
}): Me3AgentContextSource {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    visibility: input.visibility,
    reason: input.reason,
    sourceRef: input.sourceRef ?? null,
    updatedAt: input.updatedAt ?? null,
  };
}

function summarizeRequest(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function summarizeContextText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
}

function normalizeMissionStatementForContext(value: string | null): string | null {
  const normalized = normalizeNullableText(value);
  if (!normalized) return null;
  if (normalized.includes(DEFAULT_MISSION_STATEMENT_TEMPLATE_MARKER)) return null;
  return summarizeContextText(normalized, 800);
}

function coreMeJsonUrl(env: CoreAgentChatEnv): string | null {
  const origin = normalizeOrigin(env.CORE_API_ORIGIN || env.CORE_WEB_ORIGIN);
  return origin ? `${origin}/.well-known/me.json` : null;
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "/") end -= 1;
  return trimmed.slice(0, end);
}

function localDateForTimezone(timezone: string | null): string {
  const normalizedTimezone = normalizeTimeZone(timezone) || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: normalizedTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall back to UTC if the stored timezone is invalid in this runtime.
  }
  return new Date().toISOString().slice(0, 10);
}

function contactAliases(row: DbContactRow): string[] {
  const metadata = parseJsonRecord(row.metadata);
  const aliases = Array.isArray(metadata.aliases)
    ? metadata.aliases.filter((alias): alias is string => typeof alias === "string")
    : [];
  return uniqueStrings([
    ...aliases,
    ...parseJsonArray(row.tags),
    row.email || "",
    ...Object.values(stringRecord(parseJsonRecord(row.social_handles))),
  ]);
}

function summarizeContactRow(row: DbContactRow): string {
  const parts = [
    row.notes,
    row.outreach_status ? `Outreach: ${row.outreach_status}.` : null,
    row.next_followup_at ? `Next follow-up: ${row.next_followup_at}.` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

function summarizeMailboxRow(row: DbMailboxMessageRow): string {
  const body = normalizeWhitespace(row.text_body || "");
  if (body) return body.length > 420 ? `${body.slice(0, 417)}...` : body;
  return row.subject ? `Email about ${row.subject}.` : "Email thread with no summary yet.";
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function tokenizeContextText(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2),
    ),
  );
}

function scoreContextSkillMatch(queryTokens: string[], value: string) {
  const haystack = new Set(tokenizeContextText(value));
  return queryTokens.reduce((score, token) => score + (haystack.has(token) ? 1 : 0), 0);
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function contactIdForEmail(
  email: string | null,
  contactsByEmail: ReadonlyMap<string, string>,
): string | null {
  if (!email) return null;
  return contactsByEmail.get(email.trim().toLowerCase()) || null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

async function upsertSandboxConnection(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<AgentSandboxConnection> {
  const existing = await env.DB.prepare(
    `SELECT id
     FROM agent_channel_connections
     WHERE user_id = ? AND channel = 'sandbox'
     LIMIT 1`,
  )
    .bind(ownerId)
    .first<AgentSandboxConnection>();

  if (existing?.id) {
    await env.DB.prepare(
      `UPDATE agent_channel_connections
       SET status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(existing.id)
      .run();
    return existing;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_channel_connections
       (id, user_id, channel, status, setup_token, connected_at, created_at, updated_at)
     VALUES (?, ?, 'sandbox', 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(id, ownerId, crypto.randomUUID())
    .run();

  return { id };
}

async function resolveAiRoute(
  env: CoreAgentChatEnv,
  ownerId: string,
  mode: AgentChatMode,
  selectedModel?: AgentChatModelSelection | null,
): Promise<AiRoute> {
  if (mode === "owner") {
    return resolveOwnerAiRoute(env, ownerId, selectedModel);
  }

  const rawModelSelectionAllowed = allowsAgentChatRawModelSelection(env);
  const managedEveryday =
    mode !== "advanced" &&
    normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed";
  const managedPolicy = managedEveryday
    ? await readManagedAiPolicy(env.DB)
    : null;
  const stored = rawModelSelectionAllowed
    ? await (mode === "advanced"
        ? getStoredReasoningDefault(env, ownerId)
        : getStoredChatDefault(env, ownerId))
    : null;
  const selectedProvider = rawModelSelectionAllowed
    ? normalizeProviderId(selectedModel?.providerId)
    : null;
  const selectedModelName = rawModelSelectionAllowed
    ? normalizeModel(selectedModel?.model)
    : null;
  const envProvider = normalizeProviderId(
    mode === "advanced"
      ? env.ME3_AI_REASONING_PROVIDER
      : env.ME3_AI_CHAT_PROVIDER,
  );
  const envModel =
    normalizeModel(
      mode === "advanced"
        ? env.ME3_AI_REASONING_MODEL
        : env.ME3_AI_CHAT_MODEL,
    ) || normalizeModel(env.ME3_AI_MODEL);
  const storedProvider = normalizeProviderId(stored?.provider_id);
  const providerId =
    (managedEveryday ? "workers-ai" : null) ||
    selectedProvider ||
    storedProvider ||
    envProvider ||
    (envModel ? "workers-ai" : null) ||
    (env.OPENAI_API_KEY ? "openai" : null) ||
    (env.ANTHROPIC_API_KEY ? "anthropic" : null) ||
    (env.AI ? "workers-ai" : "workers-ai");
  const model =
    (managedEveryday
      ? managedAiRuntimeModel(
          managedPolicy?.defaultModel || MANAGED_DEFAULT_MODEL,
        )
      : null) ||
    selectedModelName ||
    normalizeModel(stored?.model) ||
    envModel ||
    defaultModelForProvider(providerId);
  const backupModel =
    providerId === "workers-ai"
      ? normalizeModel(env.ME3_AI_CHAT_BACKUP_MODEL) ||
        (model !== DEFAULT_WORKERS_AI_BACKUP_MODEL ? DEFAULT_WORKERS_AI_BACKUP_MODEL : null)
      : null;
  const apiKey =
    providerId === "openai"
      ? env.OPENAI_API_KEY ||
        (rawModelSelectionAllowed
          ? await getStoredApiKey(env, ownerId, providerId)
          : null)
      : providerId === "anthropic"
        ? env.ANTHROPIC_API_KEY ||
          (rawModelSelectionAllowed
            ? await getStoredApiKey(env, ownerId, providerId)
            : null)
        : null;
  const configuredAiGateway = await getAiGatewayRuntimeConfig(env, ownerId).catch(
    () => null,
  );
  // Workers AI bindings are already authenticated to the Worker's Cloudflare
  // account. Managed Everyday therefore does not need a separately stored
  // account ID or API token to use that account's default gateway. Keeping the
  // gateway explicit is important because per-request timeout/retry policy is
  // ignored when the third argument to env.AI.run() is omitted.
  const aiGateway =
    managedEveryday && env.AI
      ? {
          accountId: configuredAiGateway?.accountId ?? null,
          gatewayId:
            configuredAiGateway?.gatewayId || DEFAULT_AI_GATEWAY_ID,
          apiToken: configuredAiGateway?.apiToken ?? null,
          routeWorkersAi: true,
          routeExternalProviders:
            configuredAiGateway?.routeExternalProviders ?? false,
        }
      : configuredAiGateway;
  const managedBudgetExceeded = await isManagedEverydayBudgetExceeded(
    env,
    ownerId,
    providerId,
    model,
  );
  const routedModel = managedBudgetExceeded && backupModel ? backupModel : model;

  return {
    providerId,
    model: routedModel,
    backupModel: managedBudgetExceeded ? null : backupModel,
    apiKey,
    ai: env.AI || null,
    aiGateway,
    aiGatewayRequestPolicy: managedEveryday
      ? MANAGED_EVERYDAY_AI_GATEWAY_REQUEST_POLICY
      : null,
    recordUsage:
      normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed"
        ? ({ model: usedModel, usage }) =>
            recordManagedEverydayUsage(env.DB, ownerId, providerId, usedModel, usage)
        : undefined,
    configured:
      providerId === "workers-ai"
        ? Boolean(env.AI && routedModel)
        : Boolean(apiKey && routedModel),
  };
}

export const MANAGED_AI_MODELS = [
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
  "zai-org/glm-4.7-flash",
  "moonshotai/kimi-k3",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.5",
] as const;
const MANAGED_AI_MODEL_SET = new Set<string>(MANAGED_AI_MODELS);
const MANAGED_AI_FALLBACK_MODELS = ["zai-org/glm-4.7-flash"] as const;
const MANAGED_AI_IMAGE_MODELS = [
  "black-forest-labs/flux-2-klein-4b",
  DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
] as const;
const MANAGED_AI_BILLABLE_TEXT_MODELS = [...new Set<string>([
  ...MANAGED_AI_MODELS,
  ...MANAGED_AI_FALLBACK_MODELS,
])];
const MANAGED_AI_BILLABLE_TEXT_MODEL_SET = new Set<string>(
  MANAGED_AI_BILLABLE_TEXT_MODELS,
);
const MANAGED_DEFAULT_MODEL = MANAGED_AI_MODELS[0];
const MANAGED_EVERYDAY_AI_GATEWAY_REQUEST_POLICY = {
  requestTimeoutMs: 12_000,
  maxAttempts: 1,
} as const;
const MANAGED_AI_INCLUDED_MONTHLY_CENTS = 500;
const MANAGED_AI_POLICY_SECRET = "ME3_MANAGED_AI_BILLING_POLICY";

type ManagedAiPolicy = {
  defaultModel: string;
  overagesEnabled: boolean;
  monthlyMaximumCents: number;
};

async function readManagedAiPolicy(db: D1Like): Promise<ManagedAiPolicy> {
  const fallback: ManagedAiPolicy = {
    defaultModel: MANAGED_DEFAULT_MODEL,
    overagesEnabled: false,
    monthlyMaximumCents: MANAGED_AI_INCLUDED_MONTHLY_CENTS,
  };
  try {
    const policy = await db.prepare(
      "SELECT value FROM install_secrets WHERE name = ?",
    )
      .bind(MANAGED_AI_POLICY_SECRET)
      .first<{ value: string }>();
    if (!policy?.value) return fallback;
    const parsed = JSON.parse(policy.value) as {
      defaultModel?: unknown;
      overagesEnabled?: unknown;
      monthlyMaximumCents?: unknown;
    };
    const defaultModel = normalizeManagedAiModel(String(parsed.defaultModel || ""));
    return {
      defaultModel: MANAGED_AI_MODEL_SET.has(defaultModel)
        ? defaultModel
        : fallback.defaultModel,
      overagesEnabled: parsed.overagesEnabled === true,
      monthlyMaximumCents:
        typeof parsed.monthlyMaximumCents === "number" &&
        Number.isInteger(parsed.monthlyMaximumCents) &&
        parsed.monthlyMaximumCents >= MANAGED_AI_INCLUDED_MONTHLY_CENTS
          ? parsed.monthlyMaximumCents
          : fallback.monthlyMaximumCents,
    };
  } catch {
    return fallback;
  }
}

async function isManagedEverydayBudgetExceeded(
  env: CoreAgentChatEnv,
  ownerId: string,
  providerId: AiProviderId,
  model: string,
): Promise<boolean> {
  if (
    normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) !== "managed" ||
    providerId !== "workers-ai" ||
    !MANAGED_AI_MODEL_SET.has(normalizeManagedAiModel(model))
  ) {
    return false;
  }

  const policy = await readManagedAiPolicy(env.DB);
  const maximumCents = policy.overagesEnabled
    ? policy.monthlyMaximumCents
    : MANAGED_AI_INCLUDED_MONTHLY_CENTS;

  try {
    const usage = await env.DB.prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total
       FROM ai_usage_events
       WHERE user_id = ?
         AND (
           (kind = 'text' AND lower(replace(model, '@cf/', '')) IN (${MANAGED_AI_BILLABLE_TEXT_MODELS.map(() => "?").join(", ")}))
           OR
           (kind = 'image' AND lower(replace(model, '@cf/', '')) IN (?, ?))
         )
         AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`,
    )
      .bind(
        ownerId,
        ...MANAGED_AI_BILLABLE_TEXT_MODELS,
        ...MANAGED_AI_IMAGE_MODELS,
      )
      .first<{ total: number }>();
    return Number(usage?.total || 0) >= maximumCents / 100;
  } catch {
    return false;
  }
}

async function recordManagedEverydayUsage(
  db: D1Like,
  ownerId: string,
  providerId: AiProviderId,
  model: string,
  usage: AgentModelUsage,
): Promise<void> {
  if (
    providerId !== "workers-ai" ||
    !MANAGED_AI_BILLABLE_TEXT_MODEL_SET.has(normalizeManagedAiModel(model))
  ) {
    return;
  }
  const estimate = estimateManagedAiUsage(model, usage);
  try {
    await db.prepare(
      `INSERT INTO ai_usage_events (
         id, user_id, source, kind, provider, model, request_count,
         successful_request_count, failed_request_count, tokens_in, tokens_out,
         estimated_cost_usd, metadata_json, created_at
       ) VALUES (?, ?, 'local', 'text', ?, ?, 1, 1, 0, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        ownerId,
        providerId,
        model,
        usage.inputTokens,
        usage.outputTokens,
        estimate.costUsd,
        JSON.stringify({
          estimated: true,
          pricing: estimate.pricing,
          cachedInputTokens: usage.cachedInputTokens,
          cloudflareUnifiedBillingFeeRate: estimate.billingFeeRate,
        }),
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    console.error("Managed Everyday AI usage recording failed", error);
  }
}

export function estimateManagedKimiK3Usage(usage: AgentModelUsage): {
  costUsd: number;
  pricing: string;
  billingFeeRate: number;
} {
  return estimateManagedAiUsage("moonshotai/kimi-k3", usage);
}

export function estimateManagedAiUsage(model: string, usage: AgentModelUsage): {
  costUsd: number;
  pricing: string;
  billingFeeRate: number;
} {
  const normalizedModel = normalizeManagedAiModel(model);
  const pricing = {
    "openai/gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5, feeRate: 0.05, id: "cloudflare-unified-gpt-5-4-mini-2026-07" },
    "openai/gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25, feeRate: 0.05, id: "cloudflare-unified-gpt-5-4-nano-2026-07" },
    "moonshotai/kimi-k3": { input: 3, cached: 0.3, output: 15, feeRate: 0.05, id: "cloudflare-unified-kimi-k3-2026-07" },
    "anthropic/claude-sonnet-4.6": { input: 3, cached: 0.3, output: 15, feeRate: 0.05, id: "cloudflare-unified-claude-sonnet-4-6-2026-07" },
    "openai/gpt-5.5": { input: 5, cached: 0.5, output: 30, feeRate: 0.05, id: "cloudflare-unified-gpt-5-5-2026-07" },
    "zai-org/glm-4.7-flash": { input: 0.06, cached: 0.06, output: 0.4, feeRate: 0, id: "workers-ai-glm-4-7-flash-2026-07" },
  }[normalizedModel];
  if (!pricing) throw new Error("Unsupported managed AI model");
  const inputTokens = Math.max(0, Math.trunc(usage.inputTokens));
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, Math.trunc(usage.cachedInputTokens)),
  );
  const outputTokens = Math.max(0, Math.trunc(usage.outputTokens));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const providerCost =
    (uncachedInputTokens * pricing.input +
      cachedInputTokens * pricing.cached +
      outputTokens * pricing.output) /
    1_000_000;
  return {
    costUsd: providerCost * (1 + pricing.feeRate),
    pricing: pricing.id,
    billingFeeRate: pricing.feeRate,
  };
}

function normalizeManagedAiModel(model: string): string {
  return model.trim().toLowerCase().replace(/^@cf\//, "");
}

function managedAiRuntimeModel(model: string): string {
  const normalizedModel = normalizeManagedAiModel(model);
  return normalizedModel === "zai-org/glm-4.7-flash"
    ? `@cf/${normalizedModel}`
    : normalizedModel;
}

async function resolveOwnerAiRoute(
  env: CoreAgentChatEnv,
  ownerId: string,
  selectedModel?: AgentChatModelSelection | null,
): Promise<AiRoute> {
  const stored = await getStoredChatDefault(env, ownerId);
  const selectedProvider = normalizeProviderId(selectedModel?.providerId);
  const selectedModelName = normalizeModel(selectedModel?.model);
  const storedProvider = normalizeProviderId(stored?.provider_id);
  const providerId = selectedProvider || storedProvider || "workers-ai";
  const model =
    selectedModelName ||
    normalizeModel(stored?.model) ||
    defaultModelForProvider(providerId);
  const apiKey =
    providerId === "openai" || providerId === "anthropic"
      ? await getStoredApiKey(env, ownerId, providerId)
      : null;

  return {
    providerId,
    model,
    backupModel: null,
    apiKey,
    ai: null,
    aiGateway: null,
    configured: Boolean(apiKey && model),
  };
}

async function resolveImageGenerationRoute(
  env: CoreAgentChatEnv,
  ownerId: string,
  selectedModel: AgentChatModelSelection | null | undefined,
  capability: AssistantImageCapability,
): Promise<AiRoute | null> {
  if (normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed") {
    return buildAiRoute(
      env,
      ownerId,
      "openai",
      DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
      null,
    );
  }

  const selectedProvider = normalizeProviderId(selectedModel?.providerId);
  const selectedModelName = normalizeModel(selectedModel?.model);
  if (
    selectedProvider &&
    selectedModelName &&
    modelSupportsCapability(selectedProvider, selectedModelName, capability)
  ) {
    return buildAiRoute(env, ownerId, selectedProvider, selectedModelName, null);
  }

  const stored = await getStoredImageGenerationDefault(env, ownerId);
  const storedProvider = normalizeProviderId(stored?.provider_id);
  const storedModel = normalizeModel(stored?.model);
  if (storedProvider && storedModel) {
    return buildAiRoute(env, ownerId, storedProvider, storedModel, null);
  }

  const envProvider = normalizeProviderId(env.ME3_AI_IMAGE_GENERATION_PROVIDER);
  const envModel = normalizeModel(env.ME3_AI_IMAGE_GENERATION_MODEL);
  if (envModel) {
    return buildAiRoute(env, ownerId, envProvider || "workers-ai", envModel, null);
  }

  if (capability === "image_generation" && env.AI) {
    return buildAiRoute(
      env,
      ownerId,
      "workers-ai",
      DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
      null,
    );
  }

  return null;
}

async function buildAiRoute(
  env: CoreAgentChatEnv,
  ownerId: string,
  providerId: AiProviderId,
  model: string,
  backupModel: string | null,
): Promise<AiRoute> {
  const apiKey =
    providerId === "openai"
      ? env.OPENAI_API_KEY || (await getStoredApiKey(env, ownerId, providerId))
      : providerId === "anthropic"
        ? env.ANTHROPIC_API_KEY || (await getStoredApiKey(env, ownerId, providerId))
        : null;
  const aiGateway = await getAiGatewayRuntimeConfig(env, ownerId).catch(() => null);

  return {
    providerId,
    model,
    backupModel,
    apiKey,
    ai: env.AI || null,
    aiGateway,
    configured:
      providerId === "workers-ai" ? Boolean(env.AI && model) : Boolean(apiKey && model),
  };
}

async function getAiGatewayRuntimeConfig(
  env: CoreAgentChatEnv,
  ownerId: string,
): Promise<AiGatewayRuntimeConfig> {
  const row = await getAiGatewaySettingsRow(env, ownerId);
  const accountId = row?.account_id || env.CLOUDFLARE_ACCOUNT_ID || null;
  const gatewayId =
    row?.gateway_id?.trim() ||
    normalizeEnvGatewayId(env.CLOUDFLARE_AI_GATEWAY_ID) ||
    (accountId ? DEFAULT_AI_GATEWAY_ID : null);
  const storedToken = row?.encrypted_api_token
    ? await decryptSecretSafely(env, row.encrypted_api_token)
    : null;
  const apiToken = storedToken || env.CLOUDFLARE_API_TOKEN || null;

  return {
    accountId,
    gatewayId,
    apiToken,
    routeWorkersAi: Boolean(accountId && gatewayId && apiToken),
    routeExternalProviders: Boolean(accountId && gatewayId && apiToken),
  };
}

function normalizeEnvGatewayId(value: string | undefined): string {
  return value?.trim().slice(0, 64) || "";
}

async function getAiGatewaySettingsRow(
  env: CoreAgentChatEnv,
  ownerId: string,
): Promise<AiGatewaySettingsRow | null> {
  try {
    return env.DB.prepare(
      `SELECT account_id, gateway_id, encrypted_api_token
       FROM ai_gateway_settings
       WHERE user_id = ?
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<AiGatewaySettingsRow>();
  } catch {
    return null;
  }
}

async function decryptSecretSafely(
  env: CoreAgentChatEnv,
  encrypted: string,
): Promise<string | null> {
  try {
    const installKey = await getInstallEncryptionKey(env);
    return installKey ? decryptProviderSecret(encrypted, installKey) : null;
  } catch {
    return null;
  }
}

async function getStoredChatDefault(
  env: CoreAgentChatEnv,
  ownerId: string,
): Promise<AiDefaultRow | null> {
  try {
    return env.DB.prepare(
      `SELECT provider_id, model
       FROM ai_model_defaults
       WHERE user_id = ? AND use_case = 'chat'
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<AiDefaultRow>();
  } catch {
    return null;
  }
}

async function getStoredReasoningDefault(
  env: CoreAgentChatEnv,
  ownerId: string,
): Promise<AiDefaultRow | null> {
  try {
    return env.DB.prepare(
      `SELECT provider_id, model
       FROM ai_model_defaults
       WHERE user_id = ? AND use_case = 'reasoning'
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<AiDefaultRow>();
  } catch {
    return null;
  }
}

async function getStoredImageGenerationDefault(
  env: CoreAgentChatEnv,
  ownerId: string,
): Promise<AiDefaultRow | null> {
  try {
    return env.DB.prepare(
      `SELECT provider_id, model
       FROM ai_model_defaults
       WHERE user_id = ? AND use_case = 'image_generation'
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<AiDefaultRow>();
  } catch {
    return null;
  }
}

async function getStoredApiKey(
  env: CoreAgentChatEnv,
  ownerId: string,
  providerId: AiProviderId,
): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT provider_id, encrypted_api_key
       FROM ai_provider_credentials
       WHERE user_id = ? AND provider_id = ?
       LIMIT 1`,
    )
      .bind(ownerId, providerId)
      .first<AiCredentialRow>();
    if (!row?.encrypted_api_key) return null;
    const installKey = await getInstallEncryptionKey(env);
    return installKey ? decryptProviderSecret(row.encrypted_api_key, installKey) : null;
  } catch {
    return null;
  }
}

async function getInstallEncryptionKey(env: CoreAgentChatEnv): Promise<string | null> {
  if (env.TOKEN_ENCRYPTION_KEY) return env.TOKEN_ENCRYPTION_KEY;
  try {
    const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
      .bind(INSTALL_ENCRYPTION_KEY_NAME)
      .first<{ value: string }>();
    return row?.value || null;
  } catch {
    return null;
  }
}

async function decryptProviderSecret(
  encrypted: string,
  installKey: string,
): Promise<string | null> {
  const parts = encrypted.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const iv = decodeBase64UrlBytes(parts[1]);
  const ciphertext = decodeBase64UrlBytes(parts[2]);
  const key = await importSecretCryptoKey(installKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function importSecretCryptoKey(
  installKey: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(installKey),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function getOwnerProfile(
  env: CoreAgentChatEnv,
  ownerId: string,
): Promise<OwnerProfileRow | null> {
  try {
    return env.DB.prepare(
      `SELECT id, email, name, username, bio, timezone, assistant_name
       FROM owner_profile
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<OwnerProfileRow>();
  } catch {
    return null;
  }
}

async function loadRecentMessages(
  env: CoreAgentChatEnv,
  ownerId: string,
  threadId?: string | null,
): Promise<{
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  sourceReference: AgentOwnerContentSourceReference | null;
  landingPageReference: AgentLandingPageReference | null;
  peopleSearchReference: AgentPeopleSearchReference | null;
}> {
  try {
    const hasThread = typeof threadId === "string" && threadId.trim().length > 0;
    const rows = await env.DB.prepare(
      hasThread
        ? `SELECT role, content, metadata_json
           FROM assistant_messages
           WHERE owner_id = ? AND thread_id = ? AND role IN ('user', 'assistant')
           ORDER BY created_at DESC
           LIMIT 12`
        : `SELECT role, content, metadata_json
           FROM assistant_messages
           WHERE owner_id = ? AND role IN ('user', 'assistant')
           ORDER BY created_at DESC
           LIMIT 12`,
    )
      .bind(...(hasThread ? [ownerId, threadId] : [ownerId]))
      .all<{
        role: "user" | "assistant";
        content: string;
        metadata_json?: string | null;
      }>();
    const recent = (rows.results || []).reverse();
    const sourceReference = recent
      .map((message) => assistantSourceReferenceFromMetadata(message.metadata_json))
      .filter((reference): reference is AgentOwnerContentSourceReference => Boolean(reference))
      .at(-1) || null;
    const landingPageReference = recent
      .map((message) => assistantLandingPageReferenceFromMetadata(message.metadata_json))
      .filter((reference): reference is AgentLandingPageReference => Boolean(reference))
      .at(-1) || null;
    const peopleSearchReference = recent
      .map((message) => assistantPeopleSearchReferenceFromMetadata(message.metadata_json))
      .filter((reference): reference is AgentPeopleSearchReference => Boolean(reference))
      .at(-1) || null;
    return {
      messages: recent.filter(
        (message) => !isProviderSetupFallbackMessage(message.content),
      ).map(({ role, content }) => ({ role, content })),
      sourceReference,
      landingPageReference,
      peopleSearchReference,
    };
  } catch {
    return {
      messages: [],
      sourceReference: null,
      landingPageReference: null,
      peopleSearchReference: null,
    };
  }
}

function buildChatMessages(
  owner: OwnerProfileRow | null,
  recent: Array<{ role: "user" | "assistant"; content: string }>,
  messageText: string,
  knowledgeContext: string,
  agentContextPrompt: string | null,
  orientationPrompt: string | null,
  sourceReference: AgentOwnerContentSourceReference | null,
  landingPageReference: AgentLandingPageReference | null,
  peopleSearchReference: AgentPeopleSearchReference | null,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const ownerName = owner?.name?.trim() || owner?.username?.trim() || "the owner";
  const assistantName = normalizeAssistantDisplayName(owner?.assistant_name);
  const system = [
    ME3_BASE_CHARACTER_PROMPT,
    "You are running inside the owner's private ME3 installation.",
    `Your assistant display name is ${JSON.stringify(assistantName)}.`,
    "If asked who you are or what your name is, use the assistant display name.",
    `The owner is ${ownerName}.`,
    owner?.timezone ? `Owner timezone: ${owner.timezone}` : null,
    knowledgeContext,
    agentContextPrompt,
    orientationPrompt,
    sourceReference
      ? `Private runtime source selection for follow-up tool calls: sourceType=${sourceReference.sourceType}; sourceId=${sourceReference.sourceId}. Never show this source ID to the owner.`
      : null,
    landingPageReference
      ? `Private landing-page follow-up context: site=${landingPageReference.siteUsername}; pageId=${landingPageReference.pageId}. Use these exact values for revisions in this thread. Never show the internal page ID to the owner.`
      : null,
    peopleSearchReference?.results.length
      ? `Private people-search follow-up context: ${JSON.stringify(peopleSearchReference.results)}. Resolve references such as first, second, last, or a displayed name against this exact list. Use contactName with core_scheduling_request for a Link and profileId with core_scheduling_request_profile for a public_profile. Never show profileId to the owner.`
      : null,
    "Answer helpfully and plainly. Do not claim external actions are complete unless a tool result says they are.",
    "The ME3 owner snapshot contains all owner data available without a tool call. Never claim Journal-entry content, task details, or email content from memory or prior assistant replies. Use the relevant read tool in this turn.",
    "When the owner is setting up ME3, testing the assistant, or asking what you can do, acknowledge their goal and explain useful next steps from the available capability/context map. Treat capability examples as context unless the owner clearly asks for one concrete action.",
    "When the owner asks to configure ME3, use the setup readiness summary first: separate what already looks ready from the most useful missing next steps. Use 'your ME3 installation' in owner-facing setup copy, not 'Core install'.",
    "For public setup, say 'Public site/profile' and focus on profile basics, published/draft site status, and custom domain. Do not mention me.json, projects, or mission as public profile setup items.",
    "For email drafting, say 'save a draft' instead of 'stage a draft' or 'stage it in the ME3 mailbox'. If the owner asks to save the draft, the tool layer will handle saving it to /email.",
    "This ME3 installation can converse with the owner and can use bundled first-party API surfaces for reminders, contacts, mailbox, content, calendar, and site workflows as they are routed by the host.",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    ...recent,
    { role: "user", content: messageText },
  ];
}

function normalizeAssistantDisplayName(value: unknown): string {
  const normalized = normalizeNullableText(value);
  if (!normalized) return "ME3";
  const safe = normalized
    .replace(/[\u0000-\u001f\u007f{}\[\]<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return safe || "ME3";
}

function isCoreChatOrientationTurn(decision: CoreChatToolPlannerDecision): boolean {
  return (
    decision.kind === "conversation" &&
    decision.capabilityId === "core.agent-chat.conversation" &&
    decision.confidence >= 0.9
  );
}

function buildCoreChatOrientationPrompt(
  decision: CoreChatToolPlannerDecision,
  setupReadiness: CoreChatSetupReadiness,
): string | null {
  if (!isCoreChatOrientationTurn(decision)) return null;

  return [
    "ME3 first-run/setup orientation mode:",
    "- The owner is exploring setup, context, or capabilities. Treat capability examples as context, not action requests.",
    "- Acknowledge the owner's setup/testing goal first.",
    "- Name what is available now using the setup readiness summary and capability map.",
    "- Name what needs setup plainly. Do not pretend unconfigured tools are ready.",
    "- For configure requests, prefer a compact 'already set up' / 'good next steps' answer over a generic list of every possible setting.",
    "- Offer 2-4 useful test prompts or next actions.",
    "- Ask at most one focused question, and only if it materially helps.",
    "- In owner-facing wording, say 'your ME3 installation' instead of 'Core install'.",
    "- For public setup, say 'Public site/profile'. Do not mention me.json, projects, or mission as public profile setup items.",
    "- If Mission statement or goals appear in the ME3 owner snapshot, mention them as private context available for planning.",
    "- Avoid internal product nouns such as recipes, event ingress, capability registry, run artifact, or review packet unless the owner asks about internals.",
    setupReadiness.prompt,
  ].join("\n");
}

function buildCoreChatOrientationFallbackReply(
  owner: OwnerProfileRow | null,
  setupReadiness: CoreChatSetupReadiness,
): string {
  const name = owner?.name?.trim() || owner?.username?.trim() || "there";
  return [
    `Yes, ${name}, ME3 chat is connected for your ME3 installation, and I can help you explore setup.`,
    "",
    "Available now: I can explain ME3, inspect the current setup state, use owner-scoped context that Core has loaded, and route direct tool requests when the relevant Core surface is ready.",
    "",
    setupReadiness.prompt,
    "",
    "Next best setup step: add an AI provider in Account settings or bind Workers AI so setup questions get live model-backed answers.",
    "",
    "Good test prompts after that:",
    "- What context do you have available about me?",
    "- Do I have any upcoming reminders?",
    "- Draft a reply to the latest email from Ada.",
  ].join("\n");
}

function attachAgentContextToResponse(
  response: AgentSandboxDispatchResponse,
  context: CoreChatAgentContextResult | null,
): AgentSandboxDispatchResponse {
  return {
    ...response,
    contextPacketId: context?.manifest?.packetId ?? null,
    contextManifest: context?.manifest ?? null,
    contextSummary: context?.summary ?? null,
  };
}

function createAgentChatPerformanceMetrics(): AgentChatPerformanceMetrics {
  return {
    version: 1,
    resultSource: "fresh",
    memoryCacheLookupMs: 0,
    databaseReplayLookupMs: 0,
    statePreparationMs: 0,
    ownerProfileMs: null,
    toolPlanMs: null,
    routeResolutionMs: null,
    setupAndContextMs: null,
    contextLoadMs: null,
    imageInputMs: null,
    executionMs: null,
    messagePersistenceMs: null,
    beforeResultPersistenceMs: 0,
  };
}

function attachAgentChatPerformance(
  response: AgentSandboxDispatchResponse,
  metrics: AgentChatPerformanceMetrics,
  dispatchStartedAt: number,
  resultSource: AgentChatPerformanceMetrics["resultSource"],
): AgentSandboxDispatchResponse {
  return {
    ...response,
    performance: {
      ...metrics,
      resultSource,
      beforeResultPersistenceMs: elapsedMs(dispatchStartedAt),
    },
  };
}

function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

function attachAgentTurnTrace(
  env: CoreAgentChatEnv,
  response: AgentSandboxDispatchResponse,
  input: {
    input: AgentSandboxDispatchInput;
    plannerDecision: CoreChatToolPlannerDecision;
    route: AiRoute | null;
    context: CoreChatAgentContextResult | null;
  },
): AgentSandboxDispatchResponse {
  logAgentModelAttempts(response, input.input);
  if (!isAgentChatTraceEnabled(env)) return removeAgentTurnTrace(response);
  const { modelAttempts: _modelAttempts, ...publicResponse } = response;
  return {
    ...publicResponse,
    trace: buildAgentTurnTrace(response, input),
  };
}

function logAgentModelAttempts(
  response: AgentSandboxDispatchResponse,
  input: AgentSandboxDispatchInput,
): void {
  if (!response.modelAttempts?.length) return;
  const context = {
    requestId: input.requestId,
    turnId: input.turnId,
    threadId: input.threadId ?? null,
    mode: normalizeAgentChatMode(input.mode),
    finalModel: response.model,
  };
  console.info(
    "ME3_MODEL_ATTEMPTS",
    JSON.stringify({
      ...context,
      attempts: response.modelAttempts,
    }),
  );
  for (const attempt of response.modelAttempts) {
    if (attempt.status === "succeeded") continue;
    console.error({
      event: "ME3_MODEL_ATTEMPT_FAILURE",
      ...context,
      providerId: attempt.providerId,
      model: attempt.model,
      status: attempt.status,
      error: attempt.error,
      durationMs: attempt.durationMs,
      modelRequestDurationMs: attempt.modelRequestDurationMs,
      modelRequestCount: attempt.modelRequestCount,
      gatewayLogIds: attempt.gatewayLogIds || [],
    });
  }
}

function applyAgentTurnTracePolicy(
  env: CoreAgentChatEnv,
  response: AgentSandboxDispatchResponse,
): AgentSandboxDispatchResponse {
  return isAgentChatTraceEnabled(env) ? response : removeAgentTurnTrace(response);
}

function removeAgentTurnTrace(
  response: AgentSandboxDispatchResponse,
): AgentSandboxDispatchResponse {
  const {
    trace: _trace,
    modelAttempts: _modelAttempts,
    ...withoutTrace
  } = response;
  return withoutTrace;
}

function buildAgentTurnTrace(
  response: AgentSandboxDispatchResponse,
  input: {
    input: AgentSandboxDispatchInput;
    plannerDecision: CoreChatToolPlannerDecision;
    route: AiRoute | null;
    context: CoreChatAgentContextResult | null;
  },
): AgentChatTurnTrace {
  const routePath = response.source === "tool"
    ? "tool"
    : response.source === "fallback"
      ? "fallback"
      : "model";
  const runtimeCapability = isCoreRuntimeToolSpecialist(response.specialist)
      ? getCoreChatCapability(response.specialist as CoreChatCapabilityId)
      : null;
  return {
    turnId: input.input.turnId,
    planner: input.plannerDecision,
    route: {
      path: routePath,
      capabilityId: runtimeCapability?.id || input.plannerDecision.capabilityId,
      ownerFacingLabel:
        runtimeCapability?.ownerFacingLabel || input.plannerDecision.ownerFacingLabel,
      handlerRoute:
        runtimeCapability?.handler.route || input.plannerDecision.handlerRoute,
      reason: runtimeCapability
        ? "The provider-neutral Runtime v2 executed this typed capability."
        : input.plannerDecision.reason,
      setupChecks:
        runtimeCapability
          ? [...runtimeCapability.requiresSetup]
          : input.plannerDecision.requiredSetupChecks,
      approvalRequired: runtimeCapability
        ? isCoreChatCapabilityApprovalRequired(runtimeCapability)
        : input.plannerDecision.approvalRequired,
      sideEffectLevel:
        runtimeCapability?.chat.sideEffectLevel || input.plannerDecision.sideEffectLevel,
      auditEventKind:
        runtimeCapability?.auditEventKind || input.plannerDecision.auditEventKind,
    },
    selectedModel: input.route
      ? {
          providerId: input.route.providerId,
          model: input.route.model,
          backupModel: input.route.backupModel,
          configured: input.route.configured,
          responseModel: response.model,
        }
      : null,
    context: buildAgentTraceContext(input.context),
    modelCall: {
      status: modelCallTraceStatus(response, input.route),
      providerId: input.route?.providerId ?? null,
      model: response.model ?? input.route?.model ?? null,
      fallbackReason: response.fallbackReason ?? null,
      debugError: response.debugError ?? null,
      attempts: response.modelAttempts ?? [],
    },
    streaming: response.streamMetrics ?? null,
    imageGeneration: buildAgentTraceImageGeneration(response),
    toolResult: {
      status: toolResultTraceStatus(response, input.plannerDecision),
      specialist: response.specialist,
      source: response.source,
    },
    audit: {
      auditId: response.auditId,
    },
  };
}

function buildAgentTraceImageGeneration(
  response: AgentSandboxDispatchResponse,
): AgentChatTurnTrace["imageGeneration"] {
  const action = response.imageAction;
  if (!action) return null;
  return {
    intent: action.kind === "edited" ? "edit" : "generate",
    status:
      action.status === "complete"
        ? "succeeded"
        : action.status === "failed"
          ? "failed"
          : "blocked",
    providerId: normalizeProviderId(action.providerId),
    model: action.model,
    capabilityChecked:
      action.kind === "edited" ? "image_edit" : "image_generation",
    assetCount: action.assets.length,
    error: action.reason ?? null,
  };
}

function buildAgentTraceContext(
  context: CoreChatAgentContextResult | null,
): AgentChatTurnTrace["context"] {
  if (!context) {
    return {
      status: "not_attempted",
      packetId: null,
      summary: null,
      characterCount: 0,
      loadDurationMs: null,
      sourceCount: 0,
      sources: [],
      error: null,
    };
  }
  if (context.status === "failed") {
    return {
      status: "failed",
      packetId: null,
      summary: null,
      characterCount: context.characterCount,
      loadDurationMs: context.loadDurationMs,
      sourceCount: 0,
      sources: [],
      error: context.error,
    };
  }

  const sources = context.manifest?.sources || [];
  return {
    status: "loaded",
    packetId: context.manifest?.packetId ?? null,
    summary: context.summary,
    characterCount: context.characterCount,
    loadDurationMs: context.loadDurationMs,
    sourceCount: sources.length,
    sources: sources.slice(0, 12).map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label ?? null,
      visibility: source.visibility ?? null,
      reason: source.reason ?? null,
    })),
    error: null,
  };
}

function modelCallTraceStatus(
  response: AgentSandboxDispatchResponse,
  route: AiRoute | null,
): AgentChatTurnTrace["modelCall"]["status"] {
  if (!route || response.source === "tool") return "not_attempted";
  if (!route.configured) return "not_attempted";
  if (
    response.source === "openai" ||
    response.source === "anthropic" ||
    response.source === "workers-ai" ||
    response.source === "workers-ai-gateway"
  ) {
    return "succeeded";
  }
  if (
    response.fallbackReason === "Model request failed" ||
    response.fallbackReason === "Model returned empty response"
  ) {
    return "failed";
  }
  return "fallback";
}

function toolResultTraceStatus(
  response: AgentSandboxDispatchResponse,
  plannerDecision: CoreChatToolPlannerDecision,
): AgentChatTurnTrace["toolResult"]["status"] {
  if (isCoreRuntimeToolSpecialist(response.specialist)) return "succeeded";
  if (response.source !== "tool") return "not_attempted";
  if (plannerDecision.kind === "clarify") return "clarified";
  return response.fallbackReason ? "failed" : "succeeded";
}

function isCoreRuntimeToolSpecialist(specialist: string | null): boolean {
  return Boolean(
    specialist === "core.calendar.events.list" ||
      specialist === "core.calendar.event.create" ||
      specialist === "core.bookings.lookup" ||
      specialist === "core.contacts.search" ||
      specialist === "core.people.search" ||
      specialist?.startsWith("core.scheduling.") ||
      specialist === "core.sites.blog_post.read" ||
      specialist?.startsWith("core.reminders.") ||
      specialist?.startsWith("core.mission.task.") ||
      specialist?.startsWith("core.mailbox.") ||
      specialist === "core.journal.read",
  );
}

function isAgentChatTraceEnabled(env: CoreAgentChatEnv): boolean {
  return (
    isTruthyEnvFlag(env.ME3_ASSISTANT_DEBUG_TRACE) ||
    isTruthyEnvFlag(env.ME3_ASSISTANT_TRACE) ||
    env.ENVIRONMENT === "development"
  );
}

function isTruthyEnvFlag(value: unknown): boolean {
  return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}

async function loadCoreChatAgentContext(
  env: CoreAgentChatEnv,
  input: {
    ownerId: string;
    owner: OwnerProfileRow | null;
  },
): Promise<CoreChatAgentContextResult> {
  const startedAt = performance.now();
  try {
    const snapshot = await loadOwnerSnapshotContext({
      db: env.DB,
      ownerId: input.ownerId,
      owner: input.owner
        ? {
            id: input.owner.id,
            name: input.owner.name,
            username: input.owner.username,
            timezone: input.owner.timezone,
            assistantName: normalizeAssistantDisplayName(input.owner.assistant_name),
          }
        : null,
      meJsonUrl: coreMeJsonUrl(env),
    });
    return {
      status: "loaded",
      prompt: snapshot.prompt,
      manifest: snapshot.manifest,
      summary: snapshot.summary,
      characterCount: snapshot.characterCount,
      loadDurationMs: Number((performance.now() - startedAt).toFixed(2)),
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      prompt: null,
      manifest: null,
      summary: null,
      characterCount: 0,
      loadDurationMs: Number((performance.now() - startedAt).toFixed(2)),
      error: error instanceof Error ? error.message : "Agent context lookup failed",
    };
  }
}

async function loadCoreContextContacts(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<Me3AgentContextContact[]> {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, name, email, phone, source, source_ref,
            relationship, status, notes, tags, last_interaction_at,
            next_followup_at, outreach_status, social_handles, metadata,
            created_at, updated_at
     FROM contacts
     WHERE user_id = ? AND status != 'archived'
     ORDER BY COALESCE(last_interaction_at, updated_at, created_at) DESC
     LIMIT 40`,
  )
    .bind(ownerId)
    .all<DbContactRow>();

  return (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    aliases: contactAliases(row),
    email: row.email,
    relationship: row.relationship,
    summary: summarizeContactRow(row),
    lastInteractionAt: row.last_interaction_at,
    source: contextSource({
      id: row.id,
      kind: "contact",
      label: row.name,
      visibility: "private",
      sourceRef: row.source_ref,
      updatedAt: row.updated_at,
    }),
  }));
}

async function loadCoreContextEmailThreads(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
  contacts: readonly Me3AgentContextContact[],
): Promise<Me3AgentContextEmailThread[]> {
  const rows = await env.DB.prepare(
    `SELECT m.id, m.direction, m.message_kind, m.status, m.thread_key, m.from_address,
            m.provider_id, m.provider_message_id, m.to_address, m.subject, m.text_body,
            m.html_body, m.raw_headers_json, m.raw_message, m.metadata_json, m.source_id,
            m.folder, m.read_at, m.agent_summary, m.agent_labels_json, m.forwarded_to,
            m.error_message, m.created_by, m.approved_by_user_id, m.received_at,
            m.approved_at, m.sent_at, m.created_at
     FROM mailbox_messages m
     JOIN mailbox_aliases a ON a.id = m.mailbox_id
     WHERE a.user_id = ? AND m.folder != 'trash'
     ORDER BY COALESCE(m.sent_at, m.received_at, m.approved_at, m.created_at) DESC
     LIMIT 40`,
  )
    .bind(ownerId)
    .all<DbMailboxMessageRow>();

  const contactsByEmail = new Map(
    contacts
      .map((contact) => [contact.email?.toLowerCase() || "", contact.id] as const)
      .filter(([email]) => Boolean(email)),
  );
  const byThread = new Map<string, Me3AgentContextEmailThread>();

  for (const row of rows.results || []) {
    const metadata = parseJsonRecord(row.metadata_json);
    const id = row.thread_key || row.id;
    const existing = byThread.get(id);
    const participants = uniqueStrings([
      ...(existing?.participants || []),
      row.from_address || "",
      row.to_address || "",
    ]);
    const contactId =
      stringValue(metadata.contactId) ||
      existing?.contactId ||
      contactIdForEmail(row.from_address, contactsByEmail) ||
      contactIdForEmail(row.to_address, contactsByEmail);
    const projectId = stringValue(metadata.projectId) || existing?.projectId || null;
    const summary = row.agent_summary || summarizeMailboxRow(row);
    const lastMessageAt =
      row.sent_at || row.received_at || row.approved_at || row.created_at || existing?.lastMessageAt;

    byThread.set(id, {
      id,
      subject: existing?.subject || row.subject || "(no subject)",
      participants,
      contactId,
      projectId,
      summary: existing ? existing.summary : summary,
      lastMessageAt,
      source: contextSource({
        id,
        kind: "email_thread",
        label: row.subject || id,
        visibility: "private",
        sourceRef: row.source_id || row.id,
        updatedAt: lastMessageAt || null,
      }),
    });
  }

  return [...byThread.values()];
}

async function loadCoreContextProjects(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<Me3AgentContextProject[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, slug, description, status, source_ref, updated_at
     FROM mission_projects
     WHERE user_id = ? AND status != 'archived'
     ORDER BY updated_at DESC
     LIMIT 30`,
  )
    .bind(ownerId)
    .all<DbMissionProjectRow>();

  return (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    aliases: [row.slug].filter(Boolean),
    summary: row.description,
    status: row.status,
    source: contextSource({
      id: row.id,
      kind: "project",
      label: row.name,
      visibility: "private",
      sourceRef: row.source_ref,
      updatedAt: row.updated_at,
    }),
  }));
}

async function loadCoreContextTasks(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<Me3AgentContextTask[]> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id, title, description, status, due_at, scheduled_for,
            source_ref, updated_at
     FROM mission_tasks
     WHERE user_id = ?
       AND archived_at IS NULL
       AND status NOT IN ('done', 'cancelled')
     ORDER BY priority ASC, COALESCE(due_at, scheduled_for, updated_at) ASC
     LIMIT 50`,
  )
    .bind(ownerId)
    .all<DbMissionTaskRow>();

  return (rows.results || []).map((row) => ({
    id: row.id,
    title: row.description ? `${row.title}: ${row.description}` : row.title,
    status: row.status,
    dueAt: row.due_at || row.scheduled_for,
    projectId: row.project_id,
    source: contextSource({
      id: row.id,
      kind: "task",
      label: row.title,
      visibility: "private",
      sourceRef: row.source_ref,
      updatedAt: row.updated_at,
    }),
  }));
}

async function loadCoreContextCalendarEvents(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<Me3AgentContextCalendarEvent[]> {
  const rows = await env.DB.prepare(
    `SELECT id, title, notes, starts_at, ends_at, timezone, created_at, updated_at
     FROM user_calendar_events
     WHERE user_id = ?
     ORDER BY starts_at ASC
     LIMIT 30`,
  )
    .bind(ownerId)
    .all<DbCalendarContextEventRow>();

  return (rows.results || []).map((row) => ({
    id: row.id,
    title: row.notes ? `${row.title}: ${row.notes}` : row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    source: contextSource({
      id: row.id,
      kind: "calendar_event",
      label: row.title,
      visibility: "private",
      updatedAt: row.updated_at || row.created_at,
    }),
  }));
}

async function loadCoreContextPrivateMemory(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<Me3AgentContextPrivateMemory[]> {
  const rows = await env.DB.prepare(
    `SELECT id, memory_kind, scope_kind, scope_id, title, body, confidence,
            source_ref, updated_at
     FROM mission_private_memory
     WHERE user_id = ? AND review_status = 'active'
     ORDER BY updated_at DESC
     LIMIT 40`,
  )
    .bind(ownerId)
    .all<DbMissionMemoryRow>();

  return (rows.results || []).map((row) => ({
    id: row.id,
    kind: row.memory_kind,
    title: row.title,
    body: row.body,
    scope: row.scope_id ? `${row.scope_kind}:${row.scope_id}` : row.scope_kind,
    confidence: row.confidence,
    source: contextSource({
      id: row.id,
      kind: "private_memory",
      label: row.title || row.memory_kind,
      visibility: "private",
      sourceRef: row.source_ref,
      updatedAt: row.updated_at,
    }),
  }));
}

async function loadCoreContextSkills(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
  requestText: string,
): Promise<Me3AgentContextSkill[]> {
  const requestTokens = tokenizeContextText(requestText);
  if (requestTokens.length === 0) return [];
  const bundledMatches = matchBundledCoreContextSkills(requestTokens);
  try {
    const rows = await env.DB.prepare(
      `SELECT id, name, description, source_kind, source_ref, trust_level,
              trigger_hints_json, skill_md, updated_at
       FROM assistant_skills
       WHERE user_id = ? AND status = 'active'
       ORDER BY updated_at DESC, name ASC
       LIMIT 100`,
    )
      .bind(ownerId)
      .all<DbAssistantSkillRow>();

    const bundledSourceRefs = new Set(ME3_BUNDLED_AGENT_SKILLS.map((skill) => skill.sourceRef));
    const storedMatches = (rows.results || [])
      .filter((row) => !row.source_ref || !bundledSourceRefs.has(row.source_ref))
      .map((row) => ({
        row,
        score: scoreContextSkillMatch(
          requestTokens,
          [
            row.name,
            row.description || "",
            row.source_ref || "",
            ...parseJsonStringArray(row.trigger_hints_json),
          ].join(" "),
        ),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.row.name.localeCompare(right.row.name))
      .map(({ row, score }) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        instructions: row.skill_md ? summarizeContextText(row.skill_md, 3200) : null,
        reason:
          score >= 3
            ? "Skill triggers matched this request."
            : "Skill metadata matched this request.",
        source: contextSource({
          id: row.id,
          kind: "agent_skill",
          label: row.name,
          visibility: "private",
          reason:
            row.skill_md
              ? "Matched skill instructions loaded for this turn."
              : "Matched installed skill; full instructions are not available yet.",
          sourceRef: row.source_ref,
          updatedAt: row.updated_at,
        }),
      }));
    return [...bundledMatches, ...storedMatches].slice(0, 4);
  } catch {
    return bundledMatches.slice(0, 4);
  }
}

function matchBundledCoreContextSkills(
  requestTokens: string[],
): Me3AgentContextSkill[] {
  return ME3_BUNDLED_AGENT_SKILLS
    .map((skill) => ({
      skill,
      score: scoreContextSkillMatch(
        requestTokens,
        [
          skill.name,
          skill.description,
          skill.sourceRef,
          ...skill.triggerHints,
        ].join(" "),
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .map(({ skill, score }) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: summarizeContextText(skill.instructions, 3200),
      reason:
        score >= 3
          ? "Bundled core skill triggers matched this request."
          : "Bundled core skill metadata matched this request.",
      source: contextSource({
        id: skill.id,
        kind: "agent_skill",
        label: skill.name,
        visibility: "private",
        reason: "Bundled core skill instructions loaded for this turn.",
        sourceRef: skill.sourceRef,
        updatedAt: skill.updatedAt,
      }),
    }));
}

async function loadCoreContextMissionStatement(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<Me3AgentContextMissionStatement | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT mission_statement, updated_at
       FROM mission_dashboard_settings
       WHERE user_id = ?`,
    )
      .bind(ownerId)
      .first<DbMissionDashboardSettingsRow>();
    const statement = normalizeMissionStatementForContext(row?.mission_statement || null);
    if (!statement) return null;
    return {
      statement,
      source: contextSource({
        id: "mission-statement",
        kind: "mission_statement",
        label: "Mission statement",
        visibility: "private",
        reason: "Primary owner intent for agent replies.",
        sourceRef: "/mission-control",
        updatedAt: row?.updated_at || null,
      }),
    };
  } catch {
    return null;
  }
}

async function loadCoreContextLifeSnapshot(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<Me3AgentContextLifeSnapshot | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT id, segments_json, notes_json, created_at
       FROM mission_wheel_snapshots
       WHERE user_id = ?
       ORDER BY created_at DESC, id ASC
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<DbMissionWheelSnapshotRow>();
    if (!row) return null;

    const notes = parseJsonRecord(row.notes_json);
    const areas = parseJsonRecordArray(row.segments_json)
      .map((segment) => {
        const id = stringValue(segment.id);
        const label = stringValue(segment.label);
        if (!id || !label) return null;
        const rawScore =
          typeof segment.value === "number" ? segment.value : Number(segment.value);
        const score =
          segment.value === null || segment.value === undefined || !Number.isFinite(rawScore)
            ? null
            : Math.max(0, Math.min(10, rawScore));
        const note = stringValue(notes[id]);
        return {
          label,
          score,
          note: note ? summarizeContextText(note, 160) : null,
        };
      })
      .filter(
        (
          area,
        ): area is {
          label: string;
          score: number | null;
          note: string | null;
        } => Boolean(area),
      )
      .slice(0, MAX_WHEEL_SNAPSHOT_AREAS);
    if (!areas.length) return null;

    const scoredAreas = areas.filter((area) => typeof area.score === "number");
    const lowest = [...scoredAreas]
      .sort((left, right) => (left.score ?? 0) - (right.score ?? 0))
      .slice(0, 2)
      .map((area) => area.label);
    const highest = [...scoredAreas]
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, 2)
      .map((area) => area.label);
    const summary =
      highest.length || lowest.length
        ? [
            highest.length ? `Strongest: ${highest.join(", ")}` : null,
            lowest.length ? `Needs attention: ${lowest.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(". ")
        : null;

    return {
      id: row.id,
      createdAt: row.created_at,
      summary,
      areas,
      source: contextSource({
        id: row.id,
        kind: "wheel_of_life",
        label: "Wheel of Life snapshot",
        visibility: "private",
        reason: "Current life snapshot for balancing advice.",
        sourceRef: "/mission-control/wheel-of-life",
        updatedAt: row.created_at,
      }),
    };
  } catch {
    return null;
  }
}

function mapOwnerProfileToContext(owner: OwnerProfileRow) {
  return {
    displayName: owner.name,
    username: owner.username,
    bio: owner.bio,
    timezone: owner.timezone,
    source: contextSource({
      id: owner.id,
      kind: "owner_profile",
      label: "Owner profile",
      visibility: "public",
      reason: "Always include a small owner profile.",
    }),
  };
}

function mapRecentMessagesToContext(
  recent: Array<{ role: "user" | "assistant"; content: string }>,
): Me3AgentContextRecentMessage[] {
  return recent.map((message, index) => ({
    id: `recent-${index + 1}`,
    role: message.role,
    content: message.content,
    source: contextSource({
      id: `recent-${index + 1}`,
      kind: "assistant_message",
      label: "Recent chat",
      visibility: "private",
    }),
  }));
}

async function loadCoreChatSetupReadiness(
  env: CoreAgentChatEnv,
  ownerId: string,
  aiRouteConfigured: boolean,
  owner: OwnerProfileRow | null,
): Promise<CoreChatSetupReadiness> {
  const [
    mailbox,
    profileSite,
    pluginInstallations,
    jobs,
    hasCalendarSource,
    hasSoulink,
    hasTelegram,
    hasLocalDaemon,
  ] = await Promise.all([
    loadCoreSetupMailboxReadiness(env, ownerId),
    loadCoreSetupProfileSiteReadiness(env, ownerId),
    loadCorePluginInstallations(env),
    loadCoreSetupJobsReadiness(env, ownerId),
    hasCoreSetupRow(
      env,
      `SELECT id FROM calendar_sources WHERE user_id = ? AND status = 'active' LIMIT 1`,
      ownerId,
    ),
    hasCoreSetupRow(
      env,
      `SELECT id FROM agent_channel_connections
       WHERE user_id = ? AND channel = 'soulink' AND status = 'active'
       LIMIT 1`,
      ownerId,
    ),
    hasCoreSetupRow(
      env,
      `SELECT id FROM agent_channel_connections
       WHERE user_id = ? AND channel = 'telegram' AND status = 'active'
       LIMIT 1`,
      ownerId,
    ),
    hasCoreSetupRow(
      env,
      `SELECT id FROM local_executor_pairings
       WHERE user_id = ? AND status = 'active'
       LIMIT 1`,
      ownerId,
    ),
  ]);
  const plugins = summarizeCoreSetupPlugins(pluginInstallations);

  const mailboxLine = mailbox
    ? mailbox.status === "active"
      ? "- Mailbox: active alias configured. Drafting can save to /email; sending is still approval-first."
      : `- Mailbox: needs setup. Current alias status is ${mailbox.status || "pending"}; configure /email before promising mailbox actions.`
    : "- Mailbox: needs setup before saving or sending drafts from the mailbox.";
  const calendarSourceText =
    hasCalendarSource === true
      ? "an external calendar source is connected"
      : hasCalendarSource === false
        ? "no external calendar source is connected yet"
        : "external calendar source state is unknown";
  const messagingText = describeCoreSetupMessaging(hasSoulink, hasTelegram);
  const localDaemonText =
    hasLocalDaemon === true
      ? "paired"
      : hasLocalDaemon === false
        ? "not paired; optional setup is needed for local files, repos, or shell/code actions"
        : "setup state unknown";

  return {
    prompt: [
      "ME3 setup readiness summary:",
      aiRouteConfigured
        ? "- AI provider: ready for model-backed chat."
        : "- AI provider: needs setup before live model-backed chat. Add Workers AI, OpenAI, or Anthropic in Account settings.",
      describeCoreSetupProfileSite(profileSite, owner),
      `- Calendar/reminders: Core native reminders and calendar records are available; ${calendarSourceText}.`,
      `- Soulink/Telegram: ${messagingText}.`,
      mailboxLine,
      describeCoreSetupPlugins(plugins),
      describeCoreSetupJobs(jobs),
      "- Updates: release/version metadata is available through the Updates flow; check updates before upgrading this installation.",
      `- Local daemon: ${localDaemonText}.`,
    ].join("\n"),
    pluginInstallations: pluginInstallations || [],
  };
}

async function loadCoreSetupProfileSiteReadiness(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<DbCoreSetupProfileSiteRow | null> {
  try {
    return (
      (await env.DB.prepare(
        `SELECT username, custom_domain, custom_domain_status, published_at
         FROM sites
         WHERE user_id = ? AND COALESCE(site_type, 'profile') = 'profile' AND site_role = 'profile'
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
        .bind(ownerId)
        .first<DbCoreSetupProfileSiteRow>()) || null
    );
  } catch {
    return null;
  }
}

async function loadCorePluginInstallations(
  env: Pick<CoreAgentChatEnv, "DB">,
): Promise<DbPluginInstallationRow[] | null> {
  try {
    const rows = await env.DB.prepare(
      `SELECT plugin_id, enabled, status
       FROM plugin_installations
       ORDER BY plugin_id`,
    )
      .bind()
      .all<DbPluginInstallationRow>();
    return rows.results || [];
  } catch {
    return null;
  }
}

function summarizeCoreSetupPlugins(
  plugins: DbPluginInstallationRow[] | null,
): CoreSetupPluginReadiness | null {
  if (!plugins) return null;
  return {
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled !== 0 && plugin.status === "installed")
      .length,
    setupRequired: plugins.filter(
      (plugin) => plugin.enabled !== 0 && plugin.status === "setup_required",
    ).length,
    disabled: plugins.filter((plugin) => plugin.enabled === 0 || plugin.status === "disabled")
      .length,
  };
}

async function loadCoreSetupJobsReadiness(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<CoreSetupJobsReadiness | null> {
  try {
    const rows = await env.DB.prepare(
      `SELECT status
       FROM assistant_jobs
       WHERE user_id = ? AND archived_at IS NULL
       LIMIT 100`,
    )
      .bind(ownerId)
      .all<{ status: string | null }>();
    const jobs = rows.results || [];
    return {
      total: jobs.length,
      active: jobs.filter((job) => job.status === "active").length,
      needsSetup: jobs.filter((job) => job.status === "needs_setup" || job.status === "failing")
        .length,
      paused: jobs.filter((job) => job.status === "paused").length,
      draft: jobs.filter((job) => job.status === "draft").length,
    };
  } catch {
    return null;
  }
}

function describeCoreSetupProfileSite(
  site: DbCoreSetupProfileSiteRow | null,
  owner: OwnerProfileRow | null,
): string {
  const bioText = owner?.bio?.trim()
    ? "short profile bio is set"
    : "short profile bio is not set yet";
  if (!site) {
    return `- Public site/profile: no profile site found yet; ${bioText}.`;
  }
  const username = site.username ? `@${site.username}` : "a profile site";
  const publishText = site.published_at ? "published" : "saved as a draft";
  const domainText = site.custom_domain
    ? site.custom_domain_status === "active"
      ? `custom domain ${site.custom_domain} is active`
      : `custom domain ${site.custom_domain} is ${site.custom_domain_status || "pending"}`
    : "custom domain is not set yet";
  return `- Public site/profile: ${username} is ${publishText}; ${bioText}; ${domainText}.`;
}

function describeCoreSetupMessaging(
  hasSoulink: boolean | null,
  hasTelegram: boolean | null,
): string {
  if (hasSoulink === true && hasTelegram === true) return "Soulink and Telegram are connected";
  if (hasSoulink === true) return "Soulink is connected; Telegram is not connected yet";
  if (hasTelegram === true) return "Telegram is connected; Soulink is not connected yet";
  if (hasSoulink === false && hasTelegram === false) return "neither Soulink nor Telegram is connected yet";
  return "messaging setup state is unknown";
}

function describeCoreSetupPlugins(plugins: CoreSetupPluginReadiness | null): string {
  if (!plugins) return "- Plugins: setup state is unknown.";
  if (plugins.total === 0) return "- Plugins: no optional plugin installs are recorded yet.";
  const parts = [
    `${plugins.enabled} enabled`,
    plugins.setupRequired ? `${plugins.setupRequired} need setup` : null,
    plugins.disabled ? `${plugins.disabled} disabled` : null,
  ].filter(Boolean);
  return `- Plugins: ${parts.join(", ")}.`;
}

function describeCoreSetupJobs(jobs: CoreSetupJobsReadiness | null): string {
  if (!jobs) return "- Jobs: setup state is unknown.";
  if (jobs.total === 0) return "- Jobs: no scheduled assistant jobs created yet.";
  const parts = [
    `${jobs.active} active`,
    jobs.needsSetup ? `${jobs.needsSetup} need setup or attention` : null,
    jobs.paused ? `${jobs.paused} paused` : null,
    jobs.draft ? `${jobs.draft} draft` : null,
  ].filter(Boolean);
  return `- Jobs: ${parts.join(", ")}.`;
}

async function loadCoreSetupMailboxReadiness(
  env: Pick<CoreAgentChatEnv, "DB">,
  ownerId: string,
): Promise<{ status: string | null } | null> {
  try {
    return (
      (await env.DB.prepare(
        `SELECT status
         FROM mailbox_aliases
         WHERE user_id = ?
         LIMIT 1`,
      )
        .bind(ownerId)
        .first<{ status: string | null }>()) || null
    );
  } catch {
    return null;
  }
}

async function hasCoreSetupRow(
  env: Pick<CoreAgentChatEnv, "DB">,
  sql: string,
  ownerId: string,
): Promise<boolean | null> {
  try {
    const row = await env.DB.prepare(sql).bind(ownerId).first<Record<string, unknown>>();
    return Boolean(row);
  } catch {
    return null;
  }
}

function buildMe3KnowledgeRuntimeContext(
  aiRouteConfigured: boolean,
  installations: readonly DbPluginInstallationRow[],
): string {
  const context: Me3KnowledgeRuntimeContext = {
    surface: "core",
    chatRuntime: "conversation_only",
    configuredFeatureIds: aiRouteConfigured ? ["ai.chat_provider"] : [],
    missingFeatureIds: aiRouteConfigured ? [] : ["ai.chat_provider"],
  };

  context.installedPluginIds = installations.map((row) => row.plugin_id);
  context.enabledPluginIds = installations
    .filter((row) => row.enabled !== 0 && row.status === "installed")
    .map((row) => row.plugin_id);
  context.setupRequiredPluginIds = installations
    .filter((row) => row.enabled !== 0 && row.status === "setup_required")
    .map((row) => row.plugin_id);
  context.disabledPluginIds = installations
    .filter((row) => row.enabled === 0 || row.status === "disabled")
    .map((row) => row.plugin_id);

  return buildMe3CapabilityContext(context);
}

async function persistAssistantMessage(
  env: CoreAgentChatEnv,
  ownerId: string,
  role: "user" | "assistant",
  content: string,
  threadId?: string | null,
  metadata?: Record<string, unknown> | null,
): Promise<string | null> {
  if (role === "assistant" && isProviderSetupFallbackMessage(content)) return null;

  try {
    const id = crypto.randomUUID();
    const normalizedThreadId =
      typeof threadId === "string" && threadId.trim() ? threadId.trim() : null;
    const metadataJson = metadata && Object.keys(metadata).length > 0
      ? JSON.stringify(metadata)
      : null;
    if (normalizedThreadId) {
      if (metadataJson) {
        await env.DB.prepare(
          "INSERT INTO assistant_messages (id, owner_id, role, content, thread_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
          .bind(id, ownerId, role, content, normalizedThreadId, metadataJson)
          .run();
        return id;
      }

      await env.DB.prepare(
        "INSERT INTO assistant_messages (id, owner_id, role, content, thread_id) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(id, ownerId, role, content, normalizedThreadId)
        .run();
      return id;
    }

    if (metadataJson) {
      await env.DB.prepare(
        "INSERT INTO assistant_messages (id, owner_id, role, content, metadata_json) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(id, ownerId, role, content, metadataJson)
        .run();
      return id;
    }

    await env.DB.prepare(
      "INSERT INTO assistant_messages (id, owner_id, role, content) VALUES (?, ?, ?, ?)",
    )
      .bind(id, ownerId, role, content)
      .run();
    return id;
  } catch {
    // Conversation persistence is useful context, but chat turns should not fail on audit writes.
    return null;
  }
}

async function persistAssistantMessageAssetLinks(
  env: CoreAgentChatEnv,
  input: {
    ownerId: string;
    threadId: string | null;
    messageId: string;
    links: PendingAssistantMessageAssetLink[];
  },
) {
  try {
    for (const link of input.links) {
      await env.DB.prepare(
        `INSERT INTO assistant_message_assets
           (id, owner_id, thread_id, message_id, attachment_id, role, display_order, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          link.id,
          input.ownerId,
          input.threadId,
          input.messageId,
          link.attachmentId,
          link.role,
          link.displayOrder,
          JSON.stringify(link.metadata),
        )
        .run();
    }
  } catch {
    // The assistant message metadata still carries generated assets for refresh.
  }
}

function assistantMessageMetadataForResponse(
  response: Pick<
    AgentSandboxDispatchResponse,
    "actionCards" | "imageAction" | "sourceReference" | "peopleSearchReference"
  >,
): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};
  if (response.actionCards?.length) metadata.actionCards = response.actionCards;
  if (response.imageAction) metadata.imageAction = response.imageAction;
  if (response.sourceReference) metadata.sourceReference = response.sourceReference;
  if (response.peopleSearchReference?.results.length) {
    metadata.peopleSearchReference = response.peopleSearchReference;
  }
  return Object.keys(metadata).length ? metadata : null;
}

function assistantSourceReferenceFromMetadata(
  metadataJson: string | null | undefined,
): AgentOwnerContentSourceReference | null {
  const reference = parseJsonRecord(metadataJson || null).sourceReference;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  const source = reference as Record<string, unknown>;
  const sourceType = source.sourceType;
  const sourceId = typeof source.sourceId === "string" ? source.sourceId.trim() : "";
  if (
    (sourceType !== "journal" && sourceType !== "mission_task") ||
    !sourceId ||
    sourceId.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(sourceId)
  ) return null;
  return { sourceType, sourceId };
}

function assistantPeopleSearchReferenceFromMetadata(
  metadataJson: string | null | undefined,
): AgentPeopleSearchReference | null {
  const reference = parseJsonRecord(metadataJson || null).peopleSearchReference;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  const rawResults = (reference as Record<string, unknown>).results;
  if (!Array.isArray(rawResults)) return null;
  const results = rawResults.slice(0, 10).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const result = value as Record<string, unknown>;
    const position = Number(result.position);
    const kind = result.kind;
    const name = normalizeNullableText(result.name)?.slice(0, 160) || "";
    const contactName = normalizeNullableText(result.contactName)?.slice(0, 160) || null;
    const profileId = normalizeNullableText(result.profileId)?.slice(0, 200) || null;
    if (
      !Number.isInteger(position) ||
      position < 1 ||
      position > 10 ||
      !name ||
      (kind !== "link" && kind !== "public_profile") ||
      (kind === "link" && !contactName) ||
      (kind === "public_profile" && !profileId)
    ) return [];
    return [{
      position,
      kind: kind as "link" | "public_profile",
      name,
      contactName,
      profileId,
    }];
  });
  return results.length ? { results } : null;
}

function assistantLandingPageReferenceFromMetadata(
  metadataJson: string | null | undefined,
): AgentLandingPageReference | null {
  const actionCards = parseJsonRecord(metadataJson || null).actionCards;
  if (!Array.isArray(actionCards)) return null;
  for (let index = actionCards.length - 1; index >= 0; index -= 1) {
    const card = actionCards[index];
    if (!card || typeof card !== "object" || Array.isArray(card)) continue;
    const records = (card as Record<string, unknown>).records;
    if (!Array.isArray(records)) continue;
    const pageId = records.find(
      (record) =>
        record &&
        typeof record === "object" &&
        !Array.isArray(record) &&
        (record as Record<string, unknown>).kind === "landing_page",
    );
    const site = records.find(
      (record) =>
        record &&
        typeof record === "object" &&
        !Array.isArray(record) &&
        (record as Record<string, unknown>).kind === "site",
    );
    const pageIdValue = pageId && typeof pageId === "object"
      ? (pageId as Record<string, unknown>).id
      : null;
    const siteUsernameValue = site && typeof site === "object"
      ? (site as Record<string, unknown>).id
      : null;
    if (
      typeof pageIdValue === "string" &&
      pageIdValue.trim() &&
      typeof siteUsernameValue === "string" &&
      /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(siteUsernameValue)
    ) {
      return {
        pageId: pageIdValue.trim().slice(0, 160),
        siteUsername: siteUsernameValue,
      };
    }
  }
  return null;
}

function withoutPrivateAgentResponseContext(
  response: AgentSandboxDispatchResponse,
): AgentSandboxDispatchResponse {
  const { sourceReference: _sourceReference, ...publicResponse } = response;
  return publicResponse;
}

async function touchAssistantThread(
  env: CoreAgentChatEnv,
  ownerId: string,
  threadId?: string | null,
) {
  if (typeof threadId !== "string" || !threadId.trim()) return;
  try {
    await env.DB.prepare(
      `UPDATE assistant_threads
       SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_id = ?`,
    )
      .bind(threadId.trim(), ownerId)
      .run();
  } catch {
    // Thread timestamps are useful for history ordering, but should not fail a turn.
  }
}

function isProviderSetupFallbackMessage(content: string): boolean {
  return /add an AI provider in Account settings|AI provider setup required|bind Workers AI|model provider failed|returned an empty reply/i.test(
    content,
  );
}

function normalizeProviderId(value: unknown): AiProviderId | null {
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

function normalizeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > 160) return null;
  return model;
}

function defaultModelForProvider(providerId: AiProviderId): string {
  if (providerId === "openai") return DEFAULT_OPENAI_MODEL;
  if (providerId === "anthropic") return DEFAULT_ANTHROPIC_MODEL;
  return DEFAULT_WORKERS_AI_MODEL;
}

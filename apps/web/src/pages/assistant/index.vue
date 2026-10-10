<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { definePage } from "unplugin-vue-router/runtime";
import { api, ApiError, type ApiStreamEvent } from "../../api";
import Button from "../../components/Button.vue";
import HomePanels from "../../components/home/HomePanels.vue";
import AssistantApprovalDialog from "../../components/AssistantApprovalDialog.vue";
import ComposerPrompt from "../../components/ComposerPrompt.vue";
import { useAuthStore } from "../../stores/auth";
import LandingGrids from "../../components/LandingGrids.vue";
import PageLoading from "../../components/PageLoading.vue";
import UiIcon from "../../components/UiIcon.vue";
import WorkspaceTabs from "../../components/WorkspaceTabs.vue";
import {
  useAgentChat,
  type AgentChatMessageAttachment,
} from "../../composables/useAgentChat";
import { useAppToast } from "../../composables/useAppToast";
import { useInboxDraftCount } from "../../composables/useInboxDraftCount";
import { useVoiceDictation } from "../../composables/useVoiceDictation";
import { useContactsStore, type Contact } from "../../stores/contacts";
import { useSitesStore } from "../../stores/sites";
import {
  formatAgentTraceRows,
  formatAgentRuntimeDetail,
  formatAgentRuntimeMetadata,
  inferAgentChatEmailDraft,
  normalizeAgentActionCards,
  resolveAgentMessageActionLink,
  resolveAgentReplyText,
  shouldSendAssistantModelOverride,
  type AgentChatEmailDraftAction,
  type AgentChatActionCard,
  type AgentChatImageAction,
  type AgentChatTurnTrace,
} from "../../utils/agentChat";
import { renderAssistantMarkdown } from "../../utils/assistantMarkdown";
import {
  ASSISTANT_SITE_BUILDER_STARTER_PROMPT,
  assistantSitePageHasUnpublishedChanges,
  findLatestAssistantSitePreview,
  isAssistantSiteBuilderThread,
} from "../../utils/assistantSiteBuilder";
import {
  AI_AGENT_MODEL_OPTIONS,
  aiAgentModelOptionIsAvailable,
  type AiAgentModelCapability,
  type AiAgentModelOption,
  type AiAgentModelProviderId,
} from "../../utils/aiModelCatalog";
import type { UiIconName } from "../../utils/icons";
import { ASSISTANT_AVATAR_SRC } from "../../utils/assistantBranding";

definePage({
  meta: {
    requiresAuth: true,
    hideAgentLauncher: true,
    title: "Assistant | ME3",
    description: "Chat with ME3 and manage assistant jobs.",
    robots: "noindex,follow",
  },
});

type AssistantJobStatus =
  | "draft"
  | "active"
  | "paused"
  | "needs_setup"
  | "failing"
  | "archived";

type AssistantJobRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked";

type AssistantRecipeState =
  | "ready"
  | "needs_setup"
  | "manual_only"
  | "coming_later";

type AssistantScheduleCadence = "daily" | "weekly" | "monthly" | "custom";

type AssistantJobTrigger =
  | { kind: "manual" }
  | {
      kind: "schedule";
      timezone: string;
      cadence: AssistantScheduleCadence;
      rrule: string | null;
      localTime: string | null;
      dayOfWeek: number | null;
      nextRunAt: string | null;
    }
  | {
      kind: "event";
      source: string;
      sourceId: string;
      eventType: string;
      filters?: unknown[];
    };

type PermissionSummary = {
  reads?: string[];
  writes?: string[];
  approvalRequired?: string[];
  forbidden?: string[];
  setupRequirements?: string[];
  skills?: string[];
};

type AssistantJob = {
  id: string;
  recipeId: string | null;
  name: string;
  purpose: string;
  status: AssistantJobStatus;
  currentVersionId: string | null;
  projectId: string | null;
  destination: Record<string, unknown>;
  triggerSummary: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: AssistantJobRunStatus | null;
  failureCount: number;
  setupState: {
    validationStatus?: string;
    errors?: Array<{ message?: string; code?: string; blocking?: boolean }>;
  };
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type AssistantJobRecipe = {
  id: string;
  name: string;
  outcome: string;
  state: AssistantRecipeState;
  requiredCapabilityIds: string[];
  optionalCapabilityIds: string[];
  defaultDraft: {
    name: string;
    purpose: string;
    destination?: {
      landing?: string;
    };
  };
};

type AiRouteId = "default" | "chat" | "reasoning" | "extraction";

type AiProviderRecord = {
  id: AiAgentModelProviderId | string;
  label: string;
  description: string;
  setupLabel: string;
  supportsApiKey: boolean;
  secretLabel: string | null;
  configured: boolean;
  setupRequired: boolean;
  statusLabel: string;
  source: "binding" | "environment" | "stored" | "not_configured";
  keyHint: string | null;
  keyUpdatedAt: string | null;
  recommendedModels: Record<AiRouteId, string>;
};

type AiRouteRecord = {
  id: AiRouteId;
  label: string;
  providerId: string;
  providerLabel: string;
  model: string;
  configured: boolean;
  setupRequired: boolean;
  source: "stored" | "environment" | "recommended";
};

type AiSettingsResponse = {
  deploymentMode: "managed" | "self_hosted";
  encryptionConfigured: boolean;
  providers: AiProviderRecord[];
  routes: AiRouteRecord[];
  defaults: Record<AiRouteId, AiRouteRecord>;
};

type AssistantJobVersion = {
  id: string;
  versionNumber: number;
  trigger: AssistantJobTrigger;
  rules: AssistantJobRule[];
  actions: Array<{
    id: string;
    capabilityId: string;
    label: string;
    approvalMode: string;
    inputs?: Record<string, unknown>;
  }>;
  permissionSummary: PermissionSummary;
  validationStatus: "valid" | "invalid" | "needs_setup";
  validationErrors: Array<{
    message?: string;
    code?: string;
    blocking?: boolean;
  }>;
  createdAt: string;
};

type AssistantJobRule = {
  id: string;
  label: string;
  field: string;
  operator: string;
  value: unknown;
};

type AssistantJobScope = {
  projectId: string | null;
  sourceIds: string[];
  providerAccountIds: string[];
  filters: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
};

type AssistantJobDraft = {
  name: string;
  purpose: string;
  recipeId: string | null;
  trigger: AssistantJobTrigger;
  scope: AssistantJobScope;
  rules: AssistantJobRule[];
  actions: Array<{
    id: string;
    capabilityId: string;
    label: string;
    inputs: Record<string, unknown>;
    approvalMode: string;
    onFailure: string;
    idempotencyScope: string;
  }>;
  approvalPolicy: {
    defaultMode: string;
    overrides: Array<{
      capabilityId: string;
      mode: string;
      reason: string;
    }>;
    ownerCanApproveFrom: string;
    approvalExpiresAfterHours: number | null;
  };
  destination: {
    kind: "mission_control";
    projectId: string | null;
    landing:
      | "review_packet"
      | "task"
      | "capture"
      | "approval"
      | "memory_review"
      | "activity"
      | "accounts";
    quietIfNoChanges: boolean;
  };
  projectId: string | null;
  recommendedSkillIds: string[];
  requiredSkillIds: string[];
};

type AssistantJobDraftValidation = {
  status: "valid" | "needs_setup" | "invalid";
  errors: Array<{
    code?: string;
    message?: string;
    blocking?: boolean;
    actionId?: string;
    capabilityId?: string;
  }>;
  permissionSummary: {
    reads: string[];
    writes: string[];
    approvalRequired: string[];
    forbidden: string[];
    setupRequirements: string[];
    skills: string[];
  };
};

type AssistantJobBuilderAction =
  | {
      kind: "job_draft";
      draftId: string;
      draft: AssistantJobDraft;
      explanation: {
        summary: string;
        reads: string[];
        writes: string[];
        approvalRequired: string[];
        setupWarnings: string[];
      };
      validation: AssistantJobDraftValidation;
      availableActions: Array<"save" | "save_and_activate">;
    }
  | {
      kind: "job_saved";
      jobId: string;
      summary: string;
      status: AssistantJobStatus;
      availableActions: Array<"activate" | "run_now" | "open_job">;
    }
  | {
      kind: "job_unsupported";
      summary: string;
      availableActions: [];
    };
type AssistantJobSavedBuilderAction = Extract<
  AssistantJobBuilderAction,
  { kind: "job_saved" }
>;
type AssistantJobBuilderSentenceSegment = {
  text: string;
  strong?: boolean;
};

type InboxWatchTiming =
  | "immediate"
  | "daily_digest"
  | "weekly_digest"
  | "manual";
type InboxWatchInferredLabel =
  | "needs_reply"
  | "important"
  | "finance"
  | "scheduling"
  | "review";

type InboxWatchRuleForm = {
  id: string;
  label: string;
  enabled: boolean;
  timing: InboxWatchTiming;
  from: string;
  contains: string;
  inferredLabels: InboxWatchInferredLabel[];
  notifyOwner: boolean;
  summarizeAndLabel: boolean;
  draftReply: boolean;
  createTask: boolean;
};

type AssistantJobActionResult = {
  id: string;
  actionId: string;
  capabilityId: string;
  status: "skipped" | "blocked" | "pending_approval" | "succeeded" | "failed";
  approvalId: string | null;
  externalRef: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type AssistantJobRun = {
  id: string;
  triggerKind: "manual" | "schedule" | "event" | "heartbeat_retry";
  status: AssistantJobRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  outputPreview: string | null;
  errorMessage: string | null;
  createdAt: string;
  actionResults: AssistantJobActionResult[];
};

type AssistantJobReviewTask = {
  id: string;
  projectId: string | null;
  title: string;
  status: string;
  sourceRef: string | null;
  updatedAt: string;
};

type AssistantJobDetail = {
  job: AssistantJob;
  version: AssistantJobVersion | null;
  runs: AssistantJobRun[];
  latestReviewTask: AssistantJobReviewTask | null;
};

type AssistantJobRunNowResponse = {
  execution?: string;
  run?: {
    status?: AssistantJobRunStatus;
  };
};

type AgentSandboxResponse = {
  ok: boolean;
  turnId: string | null;
  threadId?: string | null;
  specialist: string | null;
  replyText: string | null;
  model: string | null;
  source:
    | "openai"
    | "anthropic"
    | "workers-ai"
    | "workers-ai-gateway"
    | "fallback"
    | "tool"
    | null;
  fallbackReason?: string | null;
  debugError?: string | null;
  contextPacketId?: string | null;
  contextSummary?: string | null;
  contextManifest?: unknown;
  trace?: AgentChatTurnTrace | null;
  emailAction?: {
    kind: "drafted" | "sent";
    draftId?: string;
    messageId?: string;
    to?: string;
    subject?: string;
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
    kind: "previewed" | "saved";
    itemId?: string;
    platforms?: Array<"x" | "linkedin" | "instagram" | "instagram_business">;
  } | null;
  siteAction?: {
    kind:
      | "draft_created"
      | "draft_refined"
      | "published"
      | "approval_status"
      | "missing_site"
      | "unsupported_feature"
      | "listed_blog_posts";
    url?: string | null;
    postTitle?: string | null;
    pending?: boolean;
    published?: boolean;
  } | null;
  jobBuilderAction?: AssistantJobBuilderAction | null;
  contactsChanged?: boolean;
  error?: string;
};
type AssistantThreadMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  attachments?: AgentChatMessageAttachment[] | null;
  actionCards?: AgentChatActionCard[] | null;
  imageAction?: AgentChatImageAction | null;
  siteAction?: AgentSandboxResponse["siteAction"];
  trace?: AgentChatTurnTrace | null;
};

type AssistantMailboxDraftResponse = {
  draft: {
    id: string;
    toAddress: string | null;
    subject: string;
    body: string;
  } | null;
};
type AssistantThread = {
  id: string;
  title: string;
  originSurface: "assistant" | "launcher" | "soulink" | "job" | "system";
  projectId: string | null;
  status: "active" | "archived" | "deleted";
  pinnedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type AssistantThreadsResponse = {
  threads: AssistantThread[];
};
type MissionProject = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  color: string | null;
  icon: string | null;
};
type MissionProjectsResponse = {
  projects: MissionProject[];
};
type MissionApproval = {
  id: string;
  pluginId: string;
  actionId: string;
  title: string;
  summary: string | null;
  riskLevel: "low" | "medium" | "high";
  status: string;
  requestedAt: string;
  payload?: Record<string, unknown>;
};
type MissionRun = {
  id: string;
  title: string;
  promptSummary: string | null;
  status: string;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  result?: Record<string, unknown> | null;
};
type MissionActivity = {
  id: string;
  title: string;
  summary: string | null;
  status: string | null;
  relatedId: string | null;
  createdAt: string;
};
type MissionMemory = {
  id: string;
  memoryKind: string;
  scopeKind: string;
  scopeId: string | null;
  title: string | null;
  body: string;
  confidence: number;
  sourceKind: string;
  sourceRef: string | null;
  reviewStatus: "active" | "needs_review" | "archived";
  createdAt: string;
  updatedAt: string;
};
type MissionContextSource = {
  id: string;
  sourceKind: string;
  label: string;
  description: string | null;
  visibility: "public" | "private";
  status: "active" | "setup_required" | "paused" | "failed" | "archived";
  sourceRef: string | null;
};
type AssistantSourceViewItem = MissionContextSource & {
  priority: number;
  priorityLabel: string;
  isMissing: boolean;
  isDeletable: boolean;
};
type MissionMemoryResponse = { memory: MissionMemory[] };
type MissionSourcesResponse = { sources: MissionContextSource[] };
type AssistantSettingsResponse = {
  assistantName: string | null;
  displayName: string;
};
type AssistantSettingsSection = "context" | "activity";
type AssistantActivityViewItem = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  status: string | null;
  createdAt: string;
  approval?: MissionApproval;
};
type AssistantThreadExportResponse = {
  thread: AssistantThread;
  messages: AssistantThreadMessage[];
  exportedAt: string;
};
type AssistantAttachmentKind = "text" | "image" | "unsupported";
type AssistantAttachmentDraft = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssistantAttachmentKind;
  previewUrl: string | null;
  text: string | null;
  status: "ready" | "uploading" | "error";
  error: string | null;
  storageKey: string | null;
  textTruncated: boolean;
};
type AssistantAttachmentUploadResponse = {
  ok: boolean;
  attachments: Array<{
    id: string;
    name: string;
    filename: string;
    mimeType: string;
    size: number;
    kind: "text" | "image";
    status: "ready";
    storageKey: string | null;
    hasText: boolean;
    text: string | null;
    textTruncated: boolean;
    createdAt: string;
  }>;
};
type AssistantThreadMessagesResponse = {
  thread: AssistantThread;
  messages: AssistantThreadMessage[];
};

type JobsResponse = { jobs: AssistantJob[] };
type RecipesResponse = { recipes: AssistantJobRecipe[] };
const { toastSuccess, toastFromUnknown } = useAppToast();
const agentChat = useAgentChat();
const assistantDisplayName = agentChat.assistantDisplayName;
const contactsStore = useContactsStore();
const sitesStore = useSitesStore();
const { refreshInboxDraftCount } = useInboxDraftCount();
const route = useRoute();
const router = useRouter();
const siteBuilderMode = computed(() => {
  const value = route.query.mode;
  return (Array.isArray(value) ? value[0] : value) === "site-builder";
});

function routeAssistantPrompt() {
  const value = route.query.prompt;
  const prompt = Array.isArray(value) ? value[0] : value;
  return typeof prompt === "string" && prompt.trim() ? prompt.trimStart() : "";
}

function routeAssistantPromptShouldSend() {
  const value = route.query.send;
  return (Array.isArray(value) ? value[0] : value) === "1";
}

const jobs = ref<AssistantJob[]>([]);
const recipes = ref<AssistantJobRecipe[]>([]);
const chatMessages = agentChat.messages;
const selectedJobId = ref<string | null>(null);
const selectedDetail = ref<AssistantJobDetail | null>(null);
const loadingJobs = ref(true);
const loadingRecipes = ref(true);
const loadingDetail = ref(false);
const pageError = ref("");
const configureJobsModalOpen = ref(false);
const detailModalOpen = ref(false);
const busyKeys = ref(new Set<string>());
const dailyBriefingTemplateDraft = ref("");
const dailyBriefingTemplateNotice = ref("");
const scheduleCadenceDraft = ref<AssistantScheduleCadence>("daily");
const scheduleTimeDraft = ref("08:00");
const scheduleDayOfWeekDraft = ref(1);
const scheduleDayOfMonthDraft = ref(1);
const scheduleNotice = ref("");
const scheduleInlineEditing = ref(false);
const inboxWatchRulesDraft = ref<InboxWatchRuleForm[]>([]);
const inboxWatchRulesNotice = ref("");
const assistantDraft = ref(routeAssistantPrompt());
const assistantSending = ref(false);
const assistantActionCardBusy = ref<string | null>(null);
const assistantDraftHydrationIds = new Set<string>();
const assistantContactsLoaded = ref(false);
const assistantAwaitingResponse = ref(false);
const assistantTurnStatusText = ref("");
const assistantError = ref<string | null>(null);
const assistantThreadId = ref<string | null>(null);
const assistantThreadLoading = ref(Boolean(route.query.thread));
const assistantThreads = ref<AssistantThread[]>([]);
const assistantThreadsLoading = ref(false);
const assistantThreadsError = ref("");
const archivedThreadsModalOpen = ref(false);
const archivedAssistantThreads = ref<AssistantThread[]>([]);
const archivedAssistantThreadsLoading = ref(false);
const archivedAssistantThreadsDeleting = ref(false);
const archivedAssistantThreadsError = ref("");
const assistantProjects = ref<MissionProject[]>([]);
const assistantProjectsLoading = ref(false);
const assistantProjectsError = ref("");
const assistantThreadActionId = ref<string | null>(null);
const assistantHistoryCollapsed = ref(false);
const assistantHistoryDrawerOpen = ref(false);
const assistantChatsCollapsed = ref(false);
const collapsedAssistantProjectIds = ref(new Set<string>());
const assistantSettingsModalOpen = ref(false);
const assistantSettingsSection = ref<AssistantSettingsSection>("context");
const assistantSettingsError = ref("");
const assistantSettings = ref<AssistantSettingsResponse>({
  assistantName: null,
  displayName: "ME3",
});
const assistantNameDraft = ref("");
const assistantNameSaving = ref(false);
const assistantNameNotice = ref("");
const assistantMemory = ref<MissionMemory[]>([]);
const assistantSources = ref<MissionContextSource[]>([]);
const assistantContextLoading = ref(false);
const assistantActivityLoading = ref(false);
const assistantPendingApprovals = ref<MissionApproval[]>([]);
const assistantReviewApproval = ref<MissionApproval | null>(null);
const assistantApprovalBusy = ref(false);
const assistantApprovalError = ref("");
const assistantRecentRuns = ref<MissionRun[]>([]);
const assistantRecentActivity = ref<MissionActivity[]>([]);
const assistantMemoryDraft = ref("");
const assistantMemoryActionId = ref("");
const assistantSourceActionId = ref("");
const assistantClearingActivity = ref(false);
const copiedMessageKey = ref<string | null>(null);
const homeMode = ref(route.query.view === "home" || (!route.query.thread && !route.query.new && !route.query.prompt && !route.query.project && route.query.view !== "chat"));
async function showWorkspace(home: boolean) {
  homeMode.value = home;
  await router.replace({ query: { ...route.query, view: home ? "home" : "chat" } });
}
const composerFocused = ref(false);
const homeAuth = useAuthStore();
const composerMenu = ref<HTMLDetailsElement | null>(null);
function homeSuggestion(text: string) {
  assistantDraft.value = text;
  void showWorkspace(false);
  void nextTick(() => { autosizeAssistantComposer(); assistantComposerRef.value?.focus(); });
}
const assistantComposerRef = ref<HTMLTextAreaElement | null>(null);
const assistantScrollerRef = ref<HTMLDivElement | null>(null);
const assistantAttachmentInputRef = ref<HTMLInputElement | null>(null);
const assistantAttachments = ref<AssistantAttachmentDraft[]>([]);
const assistantAttachmentNotice = ref("");
const assistantComposerDragDepth = ref(0);
const assistantModelStorageKey = "me3.assistant.selectedModelId";
const storedAssistantModelId = getStoredAssistantModelId();
const initialAssistantModelId = storedAssistantModelId || "workers-glm-4-7-flash";
const selectedModelId = ref(initialAssistantModelId);
const selectedModelTouched = ref(Boolean(storedAssistantModelId));
const aiSettingsLoading = ref(true);
const aiSettingsError = ref("");
const aiDeploymentMode = ref<AiSettingsResponse["deploymentMode"] | null>(null);
const aiProviders = ref<AiProviderRecord[]>([]);
const {
  canUse: canUseVoiceDictation,
  state: voiceDictationState,
  statusText: voiceDictationStatusText,
  toggle: toggleVoiceDictation,
} = useVoiceDictation({
  disabled: () => assistantSending.value,
  filenamePrefix: "assistant-dictation",
  onStart: () => {
    assistantError.value = null;
  },
  onTranscript: insertVoiceTranscript,
});
let assistantAbortController: AbortController | null = null;
let assistantActiveRequestId: string | null = null;

const defaultDailyBriefingTemplate =
  "{{calendar.summary}}\n\n{{calendar.events}}\n{{calendar.reminders}}\n{{mission.tasks}}\n\nI'll keep an eye on the day from here.";

const dailyBriefingVariables = [
  { label: "Name", value: "{{owner.name}}" },
  { label: "Date", value: "{{today.date}}" },
  { label: "Calendar summary", value: "{{calendar.summary}}" },
  { label: "Events", value: "{{calendar.events}}" },
  { label: "Reminders", value: "{{calendar.reminders}}" },
  { label: "Tasks", value: "{{mission.tasks}}" },
];

const suggestedRecipeOrder = [
  "daily-briefing",
  "weekly-review",
  "email-triage",
  "invoice-receipt-triage",
  "booking-reminder",
];
const protectedJobRecipeIds = new Set(suggestedRecipeOrder);

const bookingReminderSystemRecipeId = "booking-reminder";
const bookingReminderSystemName = "Booking Reminders";
const bookingReminderSystemRuns =
  "24 hours and 2 hours before a confirmed site booking";
const bookingReminderSystemDescription =
  "Sends booking reminders via email (and messaging app if configured) to you and your guest 24 hours and 2 hours before a confirmed site booking.";

const scheduleCadenceOptions: Array<{
  label: string;
  value: AssistantScheduleCadence;
}> = [
  { label: "Every day", value: "daily" },
  { label: "Every week", value: "weekly" },
  { label: "Every month", value: "monthly" },
];
const weekdayOptions = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
];
const monthDayOptions = Array.from({ length: 28 }, (_, index) => index + 1);
const configureStarterPrompt =
  "Help me configure my ME3 installation. First check what is already set up across my public site/profile, email mailbox, Soulink or Telegram, assistant/AI, jobs, plugins, and updates. Then suggest the missing or most useful next step. If I'm not sure, walk me through the basics.";
const assistantPlaceholders = [
  "Ask {{assistantName}} anything...",
  "Set a reminder tomorrow at 9am to...",
  "Draft an email to tell Sarah about...",
];
type StarterPrompt = {
  label: string;
  icon: string;
  prompt: string;
  mode?: "site-builder";
};
const siteBuilderStarterPrompt = ASSISTANT_SITE_BUILDER_STARTER_PROMPT;
const starterPrompts: StarterPrompt[] = [
  {
    label: "Build a site",
    icon: "✨",
    prompt: siteBuilderStarterPrompt,
    mode: "site-builder",
  },
  {
    label: "Configure",
    icon: "⚙️",
    prompt: configureStarterPrompt,
  },
  { label: "Status update", icon: "🚀", prompt: "Status update" },
];
const assistantAttachmentLimit = 4;
const assistantAttachmentMaxBytes = 10_000_000;
const assistantTextAttachmentMaxBytes = 1_000_000;
const assistantAttachmentTextBudget = 48_000;
const assistantAttachmentUploadTimeoutMs = 60_000;
const assistantNameMaxLength = 48;

const sortedJobs = computed(() =>
  [...jobs.value].sort((a, b) => {
    const statusRank = statusSortRank(a.status) - statusSortRank(b.status);
    if (statusRank !== 0) return statusRank;
    return a.name.localeCompare(b.name);
  }),
);

type ConfigureJobRow =
  | { kind: "job"; job: AssistantJob }
  | { kind: "recipe"; recipe: AssistantJobRecipe }
  | {
      kind: "booking-reminders";
      job: AssistantJob | null;
    };
type BookingRemindersRow = Extract<
  ConfigureJobRow,
  { kind: "booking-reminders" }
>;

const configureJobRows = computed((): ConfigureJobRow[] => {
  const rows: ConfigureJobRow[] = [];
  const usedJobIds = new Set<string>();

  for (const recipeId of suggestedRecipeOrder) {
    if (recipeId === bookingReminderSystemRecipeId) {
      const job = jobs.value.find((item) => item.recipeId === recipeId) || null;
      rows.push({ kind: "booking-reminders", job });
      if (job) usedJobIds.add(job.id);
      continue;
    }

    const job = jobs.value.find((item) => item.recipeId === recipeId);
    if (job) {
      rows.push({ kind: "job", job });
      usedJobIds.add(job.id);
      continue;
    }
  }

  for (const job of sortedJobs.value) {
    if (!usedJobIds.has(job.id)) {
      rows.push({ kind: "job", job });
    }
  }

  return rows;
});

const selectedJob = computed(
  () =>
    jobs.value.find((job) => job.id === selectedJobId.value) ||
    selectedDetail.value?.job ||
    null,
);

const selectedJobIsDailyBriefing = computed(
  () => selectedDetail.value?.job.recipeId === "daily-briefing",
);

const selectedJobIsWeeklyReview = computed(
  () => selectedDetail.value?.job.recipeId === "weekly-review",
);

const selectedJobIsInboxWatch = computed(
  () => selectedDetail.value?.job.recipeId === "email-triage",
);

const selectedLatestRun = computed(() => selectedDetail.value?.runs[0] || null);

const selectedLatestReviewTask = computed(
  () => selectedDetail.value?.latestReviewTask || null,
);

const selectedLatestRunSummary = computed(() => {
  const run = selectedLatestRun.value;
  if (!run) return "";
  if (run.outputPreview) return cleanPlainText(run.outputPreview);
  if (run.errorMessage) return cleanPlainText(run.errorMessage);
  return `Latest run ${runStatusLabel(run.status).toLowerCase()}.`;
});

const selectedScheduleTrigger = computed(() => {
  const trigger = selectedDetail.value?.version?.trigger;
  return isScheduleTrigger(trigger) ? trigger : null;
});

const savedDailyBriefingTemplate = computed(() => {
  const notifyAction = selectedDetail.value?.version?.actions.find(
    (action) => action.capabilityId === "message.owner.notify",
  );
  const template = notifyAction?.inputs?.messageTemplate;
  return typeof template === "string" && template.trim()
    ? template
    : defaultDailyBriefingTemplate;
});

const dailyBriefingTemplateChanged = computed(
  () =>
    dailyBriefingTemplateDraft.value.trim() !==
    savedDailyBriefingTemplate.value.trim(),
);

const dailyBriefingPreview = computed(() =>
  renderDailyBriefingPreview(
    dailyBriefingTemplateDraft.value || defaultDailyBriefingTemplate,
  ),
);

const scheduleDraftChanged = computed(() => {
  const trigger = selectedScheduleTrigger.value;
  if (!trigger) return false;
  const savedDayOfMonth = parseMonthlyDayOfMonth(trigger.rrule) || 1;
  return (
    scheduleCadenceDraft.value !== trigger.cadence ||
    scheduleTimeDraft.value !== (trigger.localTime || "08:00") ||
    (scheduleCadenceDraft.value === "weekly" &&
      scheduleDayOfWeekDraft.value !== (trigger.dayOfWeek ?? 1)) ||
    (scheduleCadenceDraft.value === "monthly" &&
      scheduleDayOfMonthDraft.value !== savedDayOfMonth)
  );
});

const scheduleTimeValid = computed(() =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleTimeDraft.value),
);

const inboxWatchRulesChanged = computed(() => {
  if (!selectedJobIsInboxWatch.value) return false;
  return (
    JSON.stringify(buildInboxWatchRulePayload(inboxWatchRulesDraft.value)) !==
    JSON.stringify(
      buildInboxWatchRulePayload(
        inboxWatchRuleFormsFromRules(
          selectedDetail.value?.version?.rules || [],
        ),
      ),
    )
  );
});

const aiProviderById = computed(() => {
  const providers = new Map<string, AiProviderRecord>();
  for (const provider of aiProviders.value) {
    providers.set(provider.id, provider);
  }
  return providers;
});

const configuredAiProviderIds = computed(
  () =>
    new Set(
      aiProviders.value
        .filter((provider) => provider.configured)
        .map((provider) => provider.id),
    ),
);

const visibleAssistantModelOptions = computed(() =>
  AI_AGENT_MODEL_OPTIONS.filter((option) =>
    aiAgentModelOptionIsAvailable(option, configuredAiProviderIds.value),
  ),
);

const selectedModel = computed(
  () =>
    visibleAssistantModelOptions.value.find(
      (model) => model.id === selectedModelId.value,
    ) ||
    visibleAssistantModelOptions.value[0] ||
    AI_AGENT_MODEL_OPTIONS[0],
);

const assistantModelOptions = computed(() =>
  visibleAssistantModelOptions.value.map((option) => {
    const setup = setupStateForModel(option);
    const optionTitle = [
      option.label,
      option.runtimeLabel,
      setup.statusLabel,
      capabilitySummary(option.capabilities),
      option.description,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      option,
      optionLabel: option.label,
      optionTitle,
    };
  }),
);

const selectedModelSetup = computed(() =>
  setupStateForModel(selectedModel.value),
);

const showConfigureStarterPrompt = computed(() => {
  if (
    loadingJobs.value ||
    loadingRecipes.value ||
    aiSettingsLoading.value
  ) {
    return false;
  }
  if (pageError.value || aiSettingsError.value || assistantSettingsError.value)
    return true;
  if (
    aiDeploymentMode.value === "self_hosted" &&
    !selectedModelSetup.value.configured
  ) return true;
  if (jobs.value.some((job) => job.status === "needs_setup")) return true;
  return recipes.value.some((recipe) => recipe.state === "needs_setup");
});

const visibleStarterPrompts = computed(() =>
  siteBuilderMode.value
    ? []
    : showConfigureStarterPrompt.value
      ? starterPrompts
      : starterPrompts.filter((prompt) => prompt.label !== "Configure"),
);
const assistantMessageLabel = computed(
  () => `Message ${assistantDisplayName.value}`,
);
const assistantThinkingLabel = computed(
  () => `${assistantDisplayName.value} is thinking...`,
);
const selectedModelTitle = computed(() => {
  const model = selectedModel.value;
  if (!model) return "Model";
  const setup = selectedModelSetup.value;
  return [
    model.label,
    model.runtimeLabel,
    setup.statusLabel,
    capabilitySummary(model.capabilities),
    model.description,
  ]
    .filter(Boolean)
    .join(" · ");
});

const assistantConsoleMessages = computed(() =>
  chatMessages.value.filter((message) => message.id !== "assistant-ready"),
);
const assistantSitePreview = computed(() =>
  findLatestAssistantSitePreview(assistantConsoleMessages.value),
);
const assistantSitePagePublished = ref(false);
const assistantSitePageHasDraftChanges = ref(false);
const assistantSitePageLoading = ref(false);
const assistantSitePageBusy = ref(false);
const assistantSitePreviewRefresh = ref(0);
const assistantSitePageStatus = ref("");

watch(
  assistantSitePreview,
  async (preview) => {
    assistantSitePageStatus.value = "";
    if (!preview) {
      assistantSitePagePublished.value = false;
      assistantSitePageHasDraftChanges.value = false;
      return;
    }

    assistantSitePagePublished.value = preview.statusLabel
      .toLowerCase()
      .includes("published");
    assistantSitePageLoading.value = true;
    const page = await sitesStore.getSitePage(
      preview.siteUsername,
      preview.pageId,
    );
    if (
      assistantSitePreview.value?.siteUsername === preview.siteUsername &&
      assistantSitePreview.value?.pageId === preview.pageId
    ) {
      assistantSitePagePublished.value = Boolean(page?.publishedAt);
      assistantSitePageHasDraftChanges.value = page
        ? assistantSitePageHasUnpublishedChanges(page)
        : false;
      assistantSitePageLoading.value = false;
    }
  },
  { immediate: true },
);

async function toggleAssistantSitePagePublished(): Promise<void> {
  const preview = assistantSitePreview.value;
  if (!preview || assistantSitePageBusy.value) return;

  assistantSitePageBusy.value = true;
  const shouldUnpublish = assistantSitePagePublished.value &&
    !assistantSitePageHasDraftChanges.value;
  assistantSitePageStatus.value = shouldUnpublish
    ? "Unpublishing site…"
    : "Publishing site…";
  try {
    const page = shouldUnpublish
      ? await sitesStore.unpublishSitePage(preview.siteUsername, preview.pageId)
      : await sitesStore.publishSitePage(preview.siteUsername, preview.pageId);
    if (!page) {
      throw new Error(
        sitesStore.error ||
          (shouldUnpublish
            ? "Could not unpublish the site."
            : "Could not publish the site."),
      );
    }
    assistantSitePagePublished.value = Boolean(page.publishedAt);
    assistantSitePageHasDraftChanges.value = false;
    assistantSitePreviewRefresh.value += 1;
    assistantSitePageStatus.value = assistantSitePagePublished.value
      ? "Site published."
      : "Site moved back to draft.";
    toastSuccess(assistantSitePageStatus.value);
    void sitesStore.fetchSites();
  } catch (error) {
    assistantSitePageStatus.value = "Site status could not be changed.";
    toastFromUnknown(error, assistantSitePageStatus.value);
  } finally {
    assistantSitePageBusy.value = false;
  }
}
const assistantAttachmentsReady = computed(() =>
  assistantAttachments.value.every(
    (attachment) => attachment.status !== "uploading",
  ),
);
const assistantReadyAttachments = computed(() =>
  assistantAttachments.value.filter(
    (attachment) => attachment.status === "ready",
  ),
);
const assistantAttachmentIssue = computed(() => {
  const errored = assistantAttachments.value.find(
    (attachment) => attachment.status === "error",
  );
  if (errored?.error) return errored.error;
  if (!assistantAttachmentsReady.value) return "";

  const unsupported = assistantAttachments.value.find(
    (attachment) => attachment.kind === "unsupported",
  );
  if (unsupported) {
    return `${unsupported.name} is not a supported assistant attachment yet. Use text, markdown, JSON, CSV, or images.`;
  }

  const hasImage = assistantAttachments.value.some(
    (attachment) => attachment.kind === "image",
  );
  if (
    hasImage &&
    aiDeploymentMode.value === "self_hosted" &&
    !resolveAssistantTurnModel(assistantAttachments.value)
  ) {
    return "No image-input-capable model is available for this attachment.";
  }

  return "";
});
const assistantAttachmentNeedsStorage = computed(() =>
  /storage is not configured/i.test(assistantAttachmentIssue.value),
);
const assistantComposerDragActive = computed(
  () => assistantComposerDragDepth.value > 0,
);
const assistantProjectThreadGroups = computed(() =>
  assistantProjects.value.map((project) => ({
    project,
    threads: assistantThreads.value.filter(
      (thread) => thread.projectId === project.id,
    ),
  })),
);
const assistantUngroupedThreads = computed(() =>
  assistantThreads.value.filter((thread) => !thread.projectId),
);
const assistantThreadListEmpty = computed(
  () =>
    !assistantThreadsLoading.value &&
    assistantThreads.value.length === 0 &&
    !assistantThreadsError.value,
);
const assistantSourceRows = computed<AssistantSourceViewItem[]>(() =>
  assistantSources.value
    .map((source) => {
      const priority = assistantSourcePriority(source);
      return {
        ...source,
        priority,
        priorityLabel: `Priority ${priority}`,
        isMissing:
          source.status === "setup_required" || source.status === "failed",
        isDeletable: !isDefaultAssistantSource(source),
      };
    })
    .sort(
      (left, right) =>
        left.priority - right.priority || left.label.localeCompare(right.label),
    ),
);
const assistantContextItemCount = computed(
  () => assistantMemory.value.length + assistantSourceRows.value.length,
);
const normalizedAssistantNameDraft = computed(() =>
  assistantNameDraft.value.replace(/\s+/g, " ").trim(),
);
const savedAssistantName = computed(
  () => assistantSettings.value.assistantName || "",
);
const assistantNameChanged = computed(
  () => normalizedAssistantNameDraft.value !== savedAssistantName.value,
);
const assistantNameInvalid = computed(
  () => normalizedAssistantNameDraft.value.length > assistantNameMaxLength,
);
const canSaveAssistantName = computed(
  () =>
    assistantNameChanged.value &&
    !assistantNameInvalid.value &&
    !assistantNameSaving.value,
);
const assistantActivityItems = computed<AssistantActivityViewItem[]>(() => {
  const visibleRunIds = new Set(
    assistantRecentRuns.value
      .flatMap((run) => [
        run.id,
        typeof run.result?.assistantJobRunId === "string"
          ? run.result.assistantJobRunId
          : null,
      ])
      .filter(Boolean),
  );

  return [
    ...assistantPendingApprovals.value.map((approval) => ({
      id: `approval:${approval.id}`,
      kind: "Approval",
      title: approval.title,
      summary: approval.summary || approval.actionId,
      status: approval.riskLevel,
      createdAt: approval.requestedAt,
      approval,
    })),
    ...assistantRecentRuns.value.map((run) => ({
      id: `run:${run.id}`,
      kind: "Run",
      title: run.title,
      summary: run.promptSummary || run.model || "Run summary pending",
      status: run.status,
      createdAt: run.finishedAt || run.startedAt || run.createdAt,
    })),
    ...assistantRecentActivity.value
      .filter((item) => !item.relatedId || !visibleRunIds.has(item.relatedId))
      .map((item) => ({
        id: `activity:${item.id}`,
        kind: "Activity",
        title: item.title,
        summary: item.summary,
        status: item.status,
        createdAt: item.createdAt,
      })),
  ];
});
const assistantSettingsTabs = computed<
  Array<{
    id: AssistantSettingsSection;
    label: string;
    icon: UiIconName;
    count: number;
  }>
>(() => [
  {
    id: "context",
    label: "Context",
    icon: "Brain",
    count: assistantContextItemCount.value,
  },
  {
    id: "activity",
    label: "Activity",
    icon: "Activity",
    count: assistantActivityItems.value.length,
  },
]);

const canSendAssistantMessage = computed(
  () =>
    (assistantDraft.value.trim().length > 0 ||
      assistantReadyAttachments.value.length > 0) &&
    !assistantSending.value &&
    !assistantThreadLoading.value &&
    !assistantAttachmentIssue.value,
);
onMounted(() => {
  void initializeAssistantPage();
  void syncAssistantSettingsFromRoute();
  window.addEventListener("keydown", handleWindowKeydown);
});

async function initializeAssistantPage() {
  const routePrompt = routeAssistantPrompt();
  const prompt =
    routePrompt ||
    (siteBuilderMode.value && !routeThreadId()
      ? ASSISTANT_SITE_BUILDER_STARTER_PROMPT
      : "");
  const shouldSendPrompt = Boolean(routePrompt) && routeAssistantPromptShouldSend();
  if (routePrompt) {
    const { prompt: _prompt, send: _send, ...query } = route.query;
    await router.replace({ query });
  }

  if (prompt && assistantDraft.value !== prompt) {
    assistantDraft.value = prompt;
  }

  await loadPage();
  if (!prompt) return;

  await nextTick();
  autosizeAssistantComposer();
  if (shouldSendPrompt) {
    await sendAssistantMessage();
    return;
  }
  assistantComposerRef.value?.focus();
}

onBeforeUnmount(() => {
  clearAssistantAttachments();
  window.removeEventListener("keydown", handleWindowKeydown);
});

watch(
  () => chatMessages.value.length,
  () => {
    if (!assistantSending.value) void scrollAssistantToBottom();
  },
);
let assistantApprovalHistoryRefreshPending = false;
async function refreshAssistantAfterApproval() {
  if (assistantSending.value) { assistantApprovalHistoryRefreshPending = true; return; }
  assistantApprovalHistoryRefreshPending = false;
  await loadAssistantThreadFromRoute();
}
watch(assistantSending, sending => {
  if (!sending && assistantApprovalHistoryRefreshPending) void refreshAssistantAfterApproval();
});
watch(
  () => route.query.thread,
  () => {
    if (assistantThreadId.value === routeThreadId()) return;
    void loadAssistantThreadFromRoute();
  },
);
watch(
  () => route.query.settings,
  () => {
    void syncAssistantSettingsFromRoute();
  },
);
async function loadPage() {
  pageError.value = "";
  await Promise.all([
    loadJobs(),
    loadRecipes(),
    loadAiSettings(),
    loadAssistantSettings().catch((err) => {
      assistantSettingsError.value = messageFromUnknown(
        err,
        "Assistant settings could not load.",
      );
    }),
    loadAssistantProjects(),
    loadAssistantThreads(),
    loadAssistantThreadFromRoute(),
  ]);
}

async function loadAssistantThreads() {
  assistantThreadsLoading.value = true;
  assistantThreadsError.value = "";
  try {
    const params = new URLSearchParams({
      status: "active",
      limit: "80",
    });
    const response = await api.get<AssistantThreadsResponse>(
      `/assistant/threads?${params.toString()}`,
    );
    assistantThreads.value = response.threads || [];
  } catch (err) {
    assistantThreadsError.value = messageFromUnknown(
      err,
      "Chats could not load.",
    );
  } finally {
    assistantThreadsLoading.value = false;
  }
}

async function loadAssistantProjects() {
  assistantProjectsLoading.value = true;
  assistantProjectsError.value = "";
  try {
    const response = await api.get<MissionProjectsResponse>(
      "/mission-control/projects",
    );
    assistantProjects.value = response.projects || [];
  } catch (err) {
    assistantProjectsError.value = messageFromUnknown(
      err,
      "Projects could not load.",
    );
  } finally {
    assistantProjectsLoading.value = false;
  }
}

function routeThreadId() {
  const value = route.query.thread;
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function routeProjectId() {
  const value = route.query.project;
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function setRouteThreadId(threadId: string) {
  if (routeThreadId() === threadId) return;
  const thread = assistantThreads.value.find((item) => item.id === threadId);
  await router.replace({
    query: {
      ...route.query,
      thread: threadId,
      view: homeMode.value ? "home" : "chat",
      project: thread?.projectId || undefined,
      new: undefined,
    },
  });
}

async function startNewAssistantChat(
  projectId: string | null = null,
  options: { closeHistory?: boolean } = {},
) {
  homeMode.value = false;
  assistantThreadId.value = null;
  assistantError.value = null;
  if (options.closeHistory !== false) {
    assistantHistoryDrawerOpen.value = false;
  }
  agentChat.resetMessages();
  await router.replace({
    query: {
      ...route.query,
      thread: undefined,
      project: projectId || undefined,
      new: "1",
      view: "chat",
      prompt: undefined,
      send: undefined,
    },
  });
  await nextTick();
  assistantComposerRef.value?.focus();
}

async function selectAssistantThread(threadId: string) {
  await showWorkspace(false);
  assistantHistoryDrawerOpen.value = false;
  if (!threadId || assistantThreadId.value === threadId) {
    return;
  }
  await setRouteThreadId(threadId);
}

function toggleAssistantHistoryCollapsed() {
  assistantHistoryCollapsed.value = !assistantHistoryCollapsed.value;
}

function assistantProjectExpanded(projectId: string) {
  return !collapsedAssistantProjectIds.value.has(projectId);
}

function toggleAssistantProject(projectId: string) {
  const next = new Set(collapsedAssistantProjectIds.value);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  collapsedAssistantProjectIds.value = next;
}

async function archiveAssistantThread(thread: AssistantThread) {
  if (assistantThreadActionId.value) return;
  assistantThreadActionId.value = thread.id;
  const nextStatus = thread.status === "archived" ? "active" : "archived";
  try {
    const response = await api.patch<{ thread: AssistantThread }>(
      `/assistant/threads/${encodeURIComponent(thread.id)}`,
      { status: nextStatus },
    );
    assistantThreads.value = assistantThreads.value.filter(
      (item) => item.id !== thread.id,
    );
    if (assistantThreadId.value === thread.id && nextStatus === "archived") {
      await startNewAssistantChat(null, { closeHistory: false });
    }
    if (nextStatus === "active") {
      upsertAssistantThread(response.thread);
      archivedAssistantThreads.value = archivedAssistantThreads.value.filter(
        (item) => item.id !== response.thread.id,
      );
    } else {
      archivedAssistantThreads.value = [
        response.thread,
        ...archivedAssistantThreads.value.filter(
          (item) => item.id !== response.thread.id,
        ),
      ];
    }
  } catch (err) {
    assistantThreadsError.value = messageFromUnknown(
      err,
      "Chat could not update.",
    );
  } finally {
    assistantThreadActionId.value = null;
  }
}

async function deleteAssistantThread(thread: AssistantThread) {
  if (assistantThreadActionId.value) return false;
  const confirmed = window.confirm(
    `Delete "${threadTitle(thread)}"? This removes transcript text.`,
  );
  if (!confirmed) return false;
  assistantThreadActionId.value = thread.id;
  try {
    await api.delete(`/assistant/threads/${encodeURIComponent(thread.id)}`);
    assistantThreads.value = assistantThreads.value.filter(
      (item) => item.id !== thread.id,
    );
    if (assistantThreadId.value === thread.id) {
      await startNewAssistantChat(null, { closeHistory: false });
    }
    return true;
  } catch (err) {
    assistantThreadsError.value = messageFromUnknown(
      err,
      "Chat could not be deleted.",
    );
    return false;
  } finally {
    assistantThreadActionId.value = null;
  }
}

async function loadArchivedAssistantThreads() {
  archivedAssistantThreadsLoading.value = true;
  archivedAssistantThreadsError.value = "";
  try {
    const response = await api.get<AssistantThreadsResponse>(
      "/assistant/threads?status=archived&limit=80",
    );
    archivedAssistantThreads.value = response.threads || [];
  } catch (err) {
    archivedAssistantThreadsError.value = messageFromUnknown(
      err,
      "Archived chats could not load.",
    );
  } finally {
    archivedAssistantThreadsLoading.value = false;
  }
}

async function openArchivedThreadsModal() {
  archivedThreadsModalOpen.value = true;
  await loadArchivedAssistantThreads();
}

function closeArchivedThreadsModal() {
  archivedThreadsModalOpen.value = false;
}

function routeAssistantSettingsSection(): AssistantSettingsSection | null {
  const value = route.query.settings;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "activity") return "activity";
  if (raw === "context" || raw === "memory" || raw === "sources")
    return "context";
  return null;
}

async function syncAssistantSettingsFromRoute() {
  const section = routeAssistantSettingsSection();
  if (!section) {
    if (assistantSettingsModalOpen.value) {
      assistantSettingsModalOpen.value = false;
    }
    return;
  }
  await openAssistantSettings(section, { updateRoute: false });
}

async function openAssistantSettings(
  section: AssistantSettingsSection = "context",
  options: { updateRoute?: boolean } = {},
) {
  assistantSettingsSection.value = section;
  assistantSettingsModalOpen.value = true;
  assistantHistoryDrawerOpen.value = false;
  assistantSettingsError.value = "";
  if (
    options.updateRoute !== false &&
    routeAssistantSettingsSection() !== section
  ) {
    void router.replace({
      query: {
        ...route.query,
        settings: section,
      },
    });
  }
  await loadAssistantSettingsSection(section);
  resetAssistantSettingsScroll();
}

function closeAssistantSettingsModal() {
  assistantSettingsModalOpen.value = false;
  const {
    settings: _settings,
    context: _context,
    section: _section,
    ...query
  } = route.query;
  void router.replace({ query });
}

async function setAssistantSettingsSection(section: AssistantSettingsSection) {
  if (assistantSettingsSection.value === section) {
    await loadAssistantSettingsSection(section);
    resetAssistantSettingsScroll();
    return;
  }
  await openAssistantSettings(section);
}

function setAssistantSettingsSectionFromTab(section: string) {
  if (section === "context" || section === "activity") {
    void setAssistantSettingsSection(section);
  }
}

function resetAssistantSettingsScroll() {
  void nextTick(() => {
    document.querySelector<HTMLElement>(".assistant-settings")?.scrollTo({
      top: 0,
      left: 0,
    });
  });
}

async function loadAssistantSettingsSection(section: AssistantSettingsSection) {
  if (section === "activity") {
    await loadAssistantActivity();
    return;
  }
  await loadAssistantContext();
}

async function loadAssistantSettings() {
  const settingsResponse =
    await api.get<AssistantSettingsResponse>("/assistant/settings");
  assistantSettings.value = settingsResponse;
  assistantNameDraft.value = settingsResponse.assistantName || "";
  agentChat.setAssistantDisplayName(settingsResponse.displayName);
  return settingsResponse;
}

async function loadAssistantContext() {
  assistantContextLoading.value = true;
  assistantSettingsError.value = "";
  try {
    const [, memoryResponse, sourceResponse] = await Promise.all([
      loadAssistantSettings(),
      api.get<MissionMemoryResponse>("/mission-control/memory"),
      api.get<MissionSourcesResponse>("/mission-control/context-sources"),
    ]);
    assistantMemory.value = memoryResponse.memory || [];
    assistantSources.value = sourceResponse.sources || [];
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Context could not load.",
    );
  } finally {
    assistantContextLoading.value = false;
  }
}

async function saveAssistantName() {
  if (!canSaveAssistantName.value) return;
  assistantNameSaving.value = true;
  assistantSettingsError.value = "";
  assistantNameNotice.value = "";
  try {
    const response = await api.put<AssistantSettingsResponse>(
      "/assistant/settings",
      {
        assistantName: normalizedAssistantNameDraft.value || null,
      },
    );
    assistantSettings.value = response;
    assistantNameDraft.value = response.assistantName || "";
    agentChat.setAssistantDisplayName(response.displayName);
    assistantNameNotice.value = "Name saved.";
    toastSuccess("Assistant name saved");
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Could not save assistant name.",
    );
  } finally {
    assistantNameSaving.value = false;
  }
}

async function loadAssistantActivity() {
  assistantActivityLoading.value = true;
  assistantSettingsError.value = "";
  try {
    const [approvalsResponse, runsResponse, activityResponse] =
      await Promise.allSettled([
        api.get<{ approvals: MissionApproval[] }>(
          "/mission-control/approvals?status=pending",
        ),
        api.get<{ runs: MissionRun[] }>("/mission-control/agent-runs?limit=50"),
        api.get<{ activity: MissionActivity[] }>(
          "/mission-control/plugin-activity?limit=50",
        ),
      ]);
    assistantPendingApprovals.value = approvalsResponse.status === "fulfilled" ? approvalsResponse.value.approvals || [] : [];
    assistantRecentRuns.value = runsResponse.status === "fulfilled" ? runsResponse.value.runs || [] : [];
    assistantRecentActivity.value = activityResponse.status === "fulfilled" ? activityResponse.value.activity || [] : [];
    const failed = [approvalsResponse, runsResponse, activityResponse].find(response => response.status === "rejected" && !(response.reason instanceof ApiError && [403, 404].includes(response.reason.status)));
    if (failed?.status === "rejected") toastFromUnknown(failed.reason, "Some activity could not load.");
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Activity could not load.",
    );
  } finally {
    assistantActivityLoading.value = false;
  }
}

async function decideAssistantApproval(decision: "approved" | "declined") {
  const approval = assistantReviewApproval.value;
  if (!approval || assistantApprovalBusy.value) return;
  assistantApprovalBusy.value = true; assistantApprovalError.value = "";
  try {
    await api.post(`/assistant/approvals/${encodeURIComponent(approval.id)}`, { decision });
    assistantReviewApproval.value = null;
    await Promise.all([loadAssistantActivity(), refreshAssistantAfterApproval()]);
    toastSuccess(decision === "approved" ? "Approved" : "Declined");
  } catch (error) {
    assistantApprovalError.value = messageFromUnknown(error, "Couldn't save this decision. Try again.");
    toastFromUnknown(error, "Couldn't save approval");
  } finally { assistantApprovalBusy.value = false; }
}

async function addAssistantMemory() {
  const body = assistantMemoryDraft.value.trim();
  if (!body || assistantMemoryActionId.value) return;
  assistantMemoryActionId.value = "new";
  assistantSettingsError.value = "";
  try {
    await api.post("/mission-control/memory", {
      body,
      memoryKind: "owner_note",
    });
    assistantMemoryDraft.value = "";
    await loadAssistantContext();
    toastSuccess("Memory saved");
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Could not save memory.",
    );
  } finally {
    assistantMemoryActionId.value = "";
  }
}

async function approveAssistantMemory(item: MissionMemory) {
  if (assistantMemoryActionId.value) return;
  assistantMemoryActionId.value = item.id;
  assistantSettingsError.value = "";
  try {
    const response = await api.post<{ memory: MissionMemory }>(
      `/mission-control/memory/${encodeURIComponent(item.id)}/approve`,
      {},
    );
    replaceAssistantMemory(response.memory);
    toastSuccess("Memory approved");
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Could not approve memory.",
    );
  } finally {
    assistantMemoryActionId.value = "";
  }
}

async function forgetAssistantMemory(item: MissionMemory) {
  if (assistantMemoryActionId.value) return;
  assistantMemoryActionId.value = item.id;
  assistantSettingsError.value = "";
  try {
    await api.delete<{ ok: true }>(
      `/mission-control/memory/${encodeURIComponent(item.id)}`,
    );
    assistantMemory.value = assistantMemory.value.filter(
      (entry) => entry.id !== item.id,
    );
    toastSuccess("Memory forgotten");
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Could not forget memory.",
    );
  } finally {
    assistantMemoryActionId.value = "";
  }
}

function replaceAssistantMemory(next: MissionMemory) {
  const index = assistantMemory.value.findIndex((item) => item.id === next.id);
  if (index >= 0) assistantMemory.value.splice(index, 1, next);
  else assistantMemory.value.unshift(next);
}

async function deleteAssistantSource(source: MissionContextSource) {
  if (isDefaultAssistantSource(source)) return;
  if (assistantSourceActionId.value) return;
  assistantSourceActionId.value = source.id;
  assistantSettingsError.value = "";
  try {
    await api.delete<{ ok: true }>(
      `/mission-control/context-sources/${encodeURIComponent(source.id)}`,
    );
    assistantSources.value = assistantSources.value.filter(
      (entry) => entry.id !== source.id,
    );
    toastSuccess("Source deleted");
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Could not delete source.",
    );
  } finally {
    assistantSourceActionId.value = "";
  }
}

async function clearAssistantActivity() {
  if (
    assistantActivityItems.value.length === 0 ||
    assistantClearingActivity.value
  )
    return;
  const confirmed = window.confirm(
    "Clear assistant activity? This removes run and plugin activity history from this view.",
  );
  if (!confirmed) return;

  assistantClearingActivity.value = true;
  assistantSettingsError.value = "";
  try {
    await api.delete<{
      cleared: { agentRuns: number; pluginActivity: number };
    }>("/mission-control/activity");
    assistantPendingApprovals.value = [];
    assistantRecentRuns.value = [];
    assistantRecentActivity.value = [];
    toastSuccess("Activity cleared");
  } catch (err) {
    assistantSettingsError.value = messageFromUnknown(
      err,
      "Activity could not be cleared.",
    );
  } finally {
    assistantClearingActivity.value = false;
  }
}

async function restoreArchivedAssistantThread(thread: AssistantThread) {
  await archiveAssistantThread(thread);
}

async function deleteArchivedAssistantThread(thread: AssistantThread) {
  const deleted = await deleteAssistantThread(thread);
  if (!deleted) return;
  archivedAssistantThreads.value = archivedAssistantThreads.value.filter(
    (item) => item.id !== thread.id,
  );
}

async function deleteAllArchivedAssistantThreads() {
  if (
    archivedAssistantThreadsLoading.value ||
    archivedAssistantThreadsDeleting.value ||
    archivedAssistantThreads.value.length === 0
  ) {
    return;
  }
  const archivedThreadIds = new Set(
    archivedAssistantThreads.value.map((thread) => thread.id),
  );
  const confirmed = window.confirm(
    `Delete all archived chats? This removes transcript text from ${archivedAssistantThreads.value.length} archived chats.`,
  );
  if (!confirmed) return;

  archivedAssistantThreadsDeleting.value = true;
  archivedAssistantThreadsError.value = "";
  try {
    await api.delete("/assistant/threads?status=archived");
    archivedAssistantThreads.value = [];
    if (
      assistantThreadId.value &&
      archivedThreadIds.has(assistantThreadId.value)
    ) {
      await startNewAssistantChat(null, { closeHistory: false });
    }
    toastSuccess("Archived chats deleted");
  } catch (err) {
    archivedAssistantThreadsError.value = messageFromUnknown(
      err,
      "Archived chats could not be deleted.",
    );
  } finally {
    archivedAssistantThreadsDeleting.value = false;
  }
}

async function exportAssistantThread(thread: AssistantThread) {
  if (assistantThreadActionId.value) return;
  assistantThreadActionId.value = thread.id;
  try {
    const response = await api.get<AssistantThreadExportResponse>(
      `/assistant/threads/${encodeURIComponent(thread.id)}/export`,
    );
    const transcript = [
      `# ${threadTitle(response.thread)}`,
      "",
      `Exported: ${response.exportedAt}`,
      response.thread.projectId
        ? `Project: ${projectName(response.thread.projectId)}`
        : "Project: None",
      "",
      ...response.messages.flatMap((message) => [
        `## ${message.role === "user" ? "You" : "ME3"} - ${message.createdAt}`,
        "",
        message.text || "",
        "",
      ]),
    ].join("\n");
    const blob = new Blob([transcript], {
      type: "text/markdown;charset=utf-8",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugifyFilename(threadTitle(response.thread)) || "assistant-chat"}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    assistantThreadsError.value = messageFromUnknown(
      err,
      "Chat could not export.",
    );
  } finally {
    assistantThreadActionId.value = null;
  }
}

function upsertAssistantThread(thread: AssistantThread) {
  assistantThreads.value = [
    thread,
    ...assistantThreads.value.filter((item) => item.id !== thread.id),
  ];
}

function projectName(projectId: string | null) {
  if (!projectId) return "Chats";
  return (
    assistantProjects.value.find((project) => project.id === projectId)?.name ||
    "Project"
  );
}

function slugifyFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatAssistantThreadTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thatDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (today.getTime() - thatDay.getTime()) / 86_400_000,
  );
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatAssistantMessageTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function assistantMessageDisplayText(message: {
  text: string;
  emailDraftAction?: AgentChatEmailDraftAction | null;
}) {
  return message.emailDraftAction
    ? message.emailDraftAction.displayText
    : message.text;
}

function visibleAssistantActionCards(message: {
  actionCards?: AgentChatActionCard[] | null;
  emailDraftAction?: AgentChatEmailDraftAction | null;
}) {
  const cards = message.actionCards || [];
  return message.emailDraftAction
    ? cards.filter((card) => card.kind !== "mailbox.draft_saved")
    : cards;
}

function threadTitle(thread: AssistantThread) {
  return thread.title?.trim() || "New chat";
}

async function loadAssistantThreadFromRoute() {
  let threadId = routeThreadId();
  if (!threadId && !routeProjectId() && !siteBuilderMode.value && route.query.new !== "1") {
    try {
      const response = await api.post<{ thread: AssistantThread }>("/assistant/threads/primary", {});
      // A project or history selection made while resolving takes precedence.
      if (routeThreadId() || routeProjectId() || route.query.new === "1") return;
      threadId = response.thread.id;
      assistantThreadId.value = threadId;
      upsertAssistantThread(response.thread);
      await setRouteThreadId(threadId);
    } catch (err) {
      assistantError.value = messageFromUnknown(err, "Your main conversation could not load.");
      return;
    }
  }
  assistantThreadId.value = threadId;
  assistantError.value = null;

  if (!threadId) {
    agentChat.resetMessages();
    return;
  }

  assistantThreadLoading.value = true;
  try {
    const response = await api.get<AssistantThreadMessagesResponse>(
      `/assistant/threads/${encodeURIComponent(threadId)}/messages`,
    );
    if (assistantThreadId.value !== threadId) return;
    if (response.thread) {
      if (response.thread.status === "active") {
        upsertAssistantThread(response.thread);
      } else {
        archivedAssistantThreads.value = [
          response.thread,
          ...archivedAssistantThreads.value.filter(
            (item) => item.id !== response.thread.id,
          ),
        ];
      }
    }
    let previousUserText = "";
    const mappedMessages = response.messages.map((message) => {
      const actionLink = resolveAgentMessageActionLink({
        siteAction: message.siteAction || null,
        replyText: message.text,
      });
      const mappedMessage: {
        id: string;
        role: "user" | "assistant";
        text: string;
        createdAt: string;
        actionCards: AgentChatActionCard[];
        imageAction: AgentChatImageAction | null;
        emailDraftAction: AgentChatEmailDraftAction | null;
        attachments: AgentChatMessageAttachment[];
        actionHref: string | null;
        actionLabel: string | null;
      } = {
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        attachments: normalizeAssistantMessageAttachments(message.attachments),
        actionCards: normalizeAgentActionCards(message.actionCards),
        imageAction: message.imageAction || null,
        emailDraftAction: null,
        actionHref: actionLink?.href || null,
        actionLabel: actionLink?.label || null,
      };
      if (message.role === "assistant") {
        mappedMessage.emailDraftAction = createAgentChatEmailDraftAction(
          message,
          previousUserText,
        );
      } else {
        previousUserText = message.text;
      }
      return mappedMessage;
    });
    agentChat.replaceMessages(mappedMessages);
    await syncAssistantModeForThread(mappedMessages);
    chatMessages.value.forEach((message) => {
      hydrateAssistantEmailDraftMessage(message);
    });
  } catch (err) {
    if (assistantThreadId.value !== threadId) return;
    assistantError.value = messageFromUnknown(
      err,
      "Assistant thread could not load.",
    );
    agentChat.resetMessages();
  } finally {
    if (assistantThreadId.value === threadId) {
      assistantThreadLoading.value = false;
    }
  }
}

async function syncAssistantModeForThread(
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    actionCards: AgentChatActionCard[];
  }>,
) {
  const shouldUseSiteBuilder = isAssistantSiteBuilderThread(messages);
  if (shouldUseSiteBuilder === siteBuilderMode.value) return;
  await router.replace({
    query: {
      ...route.query,
      mode: shouldUseSiteBuilder ? "site-builder" : undefined,
    },
  });
}

const COMPOSER_MAX_HEIGHT_PX = 160;

async function scrollAssistantToBottom() {
  await nextTick();
  const node = assistantScrollerRef.value;
  if (!node || (homeMode.value && !siteBuilderMode.value)) return;
  node.scrollTop = node.scrollHeight;
  (node.lastElementChild || node).scrollIntoView({ block: "end" });
}

async function scrollAssistantMessageIntoView(messageId: string) {
  await nextTick();
  const node = assistantScrollerRef.value;
  if (!node) return;
  const message = Array.from(
    node.querySelectorAll<HTMLElement>(".assistant-message"),
  ).find((item) => item.dataset.assistantMessageId === messageId);
  message?.scrollIntoView({ block: "start", inline: "nearest" });
}

function autosizeAssistantComposer() {
  const el = assistantComposerRef.value;
  if (!el) return;
  if (!composerFocused.value || assistantDraft.value.length === 0) {
    el.style.height = "";
    el.style.overflowY = "hidden";
    return;
  }
  el.style.height = "auto";
  const scroll = el.scrollHeight;
  const next = Math.min(scroll, COMPOSER_MAX_HEIGHT_PX);
  el.style.height = `${next}px`;
  el.style.overflowY = scroll > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
}

async function useStarterPrompt(prompt: string) {
  assistantDraft.value = prompt;
  assistantError.value = null;
  autosizeAssistantComposer();
  await sendAssistantMessage();
}

async function startStarterPrompt(starter: StarterPrompt) {
  if (starter.mode === "site-builder" && !siteBuilderMode.value) {
    await router.push({ path: "/assistant", query: { mode: "site-builder" } });
    assistantDraft.value = starter.prompt;
    assistantError.value = null;
    await nextTick();
    autosizeAssistantComposer();
    assistantComposerRef.value?.focus();
    return;
  }
  await useStarterPrompt(starter.prompt);
}

function openAssistantAttachmentPicker() {
  if (assistantSending.value) return;
  assistantAttachmentInputRef.value?.click();
}

async function onAssistantAttachmentChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (files.length === 0) return;
  await addAssistantAttachments(files);
}

function assistantDragHasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function onAssistantComposerDragEnter(event: DragEvent) {
  if (assistantSending.value || !assistantDragHasFiles(event)) return;
  event.preventDefault();
  assistantComposerDragDepth.value += 1;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onAssistantComposerDragOver(event: DragEvent) {
  if (assistantSending.value || !assistantDragHasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onAssistantComposerDragLeave(event: DragEvent) {
  if (!assistantDragHasFiles(event)) return;
  event.preventDefault();
  assistantComposerDragDepth.value = Math.max(
    0,
    assistantComposerDragDepth.value - 1,
  );
}

async function onAssistantComposerDrop(event: DragEvent) {
  if (assistantSending.value || !assistantDragHasFiles(event)) return;
  event.preventDefault();
  assistantComposerDragDepth.value = 0;
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length === 0) return;
  await addAssistantAttachments(files);
}

async function onAssistantComposerPaste(event: ClipboardEvent) {
  if (assistantSending.value) return;
  const files = assistantImageFilesFromClipboard(event.clipboardData);
  if (files.length === 0) return;

  event.preventDefault();
  await addAssistantAttachments(files);
}

function assistantImageFilesFromClipboard(
  clipboardData: DataTransfer | null,
): File[] {
  if (!clipboardData) return [];

  const itemFiles = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .filter(isAssistantImageAttachmentFile);

  const files = itemFiles.length
    ? itemFiles
    : Array.from(clipboardData.files || []).filter(
        isAssistantImageAttachmentFile,
      );

  return files.map((file, index) => normalizeAssistantClipboardImage(file, index));
}

function normalizeAssistantClipboardImage(file: File, index: number): File {
  if (file.name && !/^image\.(png|jpe?g|gif|webp|avif)$/i.test(file.name)) {
    return file;
  }

  const extension = assistantImageFileExtension(file) || "png";
  const filename = `pasted-image-${assistantClipboardTimestamp()}${
    index > 0 ? `-${index + 1}` : ""
  }.${extension}`;
  return new File([file], filename, {
    type: file.type || `image/${extension === "jpg" ? "jpeg" : extension}`,
    lastModified: file.lastModified || Date.now(),
  });
}

function assistantClipboardTimestamp() {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

async function addAssistantAttachments(files: File[]) {
  assistantAttachmentNotice.value = "";
  const slots = assistantAttachmentLimit - assistantAttachments.value.length;
  if (slots <= 0) {
    assistantAttachmentNotice.value = `Attach up to ${assistantAttachmentLimit} files.`;
    return;
  }

  const accepted = files.slice(0, slots);
  if (files.length > slots) {
    assistantAttachmentNotice.value = `Only ${slots} more file${slots === 1 ? "" : "s"} can be attached.`;
  }

  for (const file of accepted) {
    const draft: AssistantAttachmentDraft = {
      id: crypto.randomUUID(),
      name: file.name || "Attachment",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind: classifyAssistantAttachment(file),
      previewUrl: isAssistantImageAttachmentFile(file)
        ? window.URL.createObjectURL(file)
        : null,
      text: null,
      status: "uploading",
      error: null,
      storageKey: null,
      textTruncated: false,
    };
    assistantAttachments.value.push(draft);

    if (file.size > assistantAttachmentMaxBytes) {
      draft.status = "error";
      draft.error = `${draft.name} is too large. Use files under ${formatFileSize(assistantAttachmentMaxBytes)} for now.`;
      continue;
    }

    if (draft.kind === "text" && file.size > assistantTextAttachmentMaxBytes) {
      draft.status = "error";
      draft.error = `${draft.name} is too large to read as text. Use files under ${formatFileSize(assistantTextAttachmentMaxBytes)} for now.`;
      continue;
    }

    if (draft.kind === "unsupported") {
      draft.status = "error";
      draft.error = `${draft.name} is not supported yet. Use text, markdown, JSON, CSV, XML, or images.`;
      continue;
    }

    const uploadController = new AbortController();
    const uploadTimeoutId = window.setTimeout(
      () => uploadController.abort(),
      assistantAttachmentUploadTimeoutMs,
    );

    try {
      const threadId = routeThreadId();
      const response = await api.post<AssistantAttachmentUploadResponse>(
        "/assistant/attachments",
        {
          threadId: threadId || undefined,
          attachments: [
            {
              filename: file.name || draft.name,
              mimeType: file.type || draft.mimeType,
              dataBase64: await assistantAttachmentFileBase64(
                file,
                uploadController.signal,
              ),
            },
          ],
        },
        { signal: uploadController.signal },
      );
      const uploaded = response.attachments[0];
      if (!uploaded)
        throw new Error("Attachment upload did not return a record.");
      draft.id = uploaded.id;
      draft.name = uploaded.name || uploaded.filename || draft.name;
      draft.mimeType = uploaded.mimeType || draft.mimeType;
      draft.size = uploaded.size;
      draft.kind = uploaded.kind;
      draft.text = uploaded.text
        ? uploaded.text.slice(0, assistantAttachmentTextBudget)
        : null;
      draft.storageKey = uploaded.storageKey;
      draft.textTruncated = Boolean(uploaded.textTruncated);
      draft.status = "ready";
    } catch (err) {
      draft.status = "error";
      draft.error = isAbortError(err)
        ? `${draft.name} upload timed out. Remove it and try again.`
        : messageFromUnknown(err, `Could not upload ${draft.name}.`);
    } finally {
      window.clearTimeout(uploadTimeoutId);
    }
  }
}

async function assistantAttachmentFileBase64(
  file: File,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function removeAssistantAttachment(id: string) {
  const attachment = assistantAttachments.value.find((item) => item.id === id);
  revokeAssistantAttachmentPreview(attachment);
  assistantAttachments.value = assistantAttachments.value.filter(
    (item) => item.id !== id,
  );
}

function clearAssistantAttachments() {
  assistantAttachments.value.forEach((attachment) => {
    revokeAssistantAttachmentPreview(attachment);
  });
  assistantAttachments.value = [];
}

function revokeAssistantAttachmentPreview(
  attachment: AssistantAttachmentDraft | undefined,
) {
  if (!attachment?.previewUrl) return;
  window.URL.revokeObjectURL(attachment.previewUrl);
}

function classifyAssistantAttachment(file: File): AssistantAttachmentKind {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (isAssistantImageAttachmentFile(file)) return "image";
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".csv") ||
    name.endsWith(".tsv") ||
    name.endsWith(".json") ||
    name.endsWith(".txt") ||
    name.endsWith(".xml")
  ) {
    return "text";
  }
  return "unsupported";
}

function isAssistantImageAttachmentFile(file: File) {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return mimeType.startsWith("image/") || name.endsWith(".avif");
}

function assistantImageFileExtension(file: File) {
  const mimeType = file.type.toLowerCase();
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";

  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".gif")) return "gif";
  if (name.endsWith(".webp")) return "webp";
  if (name.endsWith(".avif")) return "avif";
  return "";
}

function serializeAssistantAttachmentsForTurn() {
  return assistantAttachments.value.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    status: attachment.status,
    storageKey: attachment.storageKey,
    hasText: Boolean(attachment.text),
    textTruncated: attachment.textTruncated,
  }));
}

function normalizeAssistantMessageAttachments(
  attachments: ReadonlyArray<AgentChatMessageAttachment> | null | undefined,
) {
  return Array.isArray(attachments)
    ? attachments.filter((attachment) => attachment?.status === "ready")
    : [];
}

function assistantAttachmentContentUrl(
  attachment: AgentChatMessageAttachment,
) {
  return attachment.id
    ? `/api/assistant/attachments/${encodeURIComponent(attachment.id)}/content`
    : "";
}

function formatFileSize(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 100) / 10} KB`;
  return `${Math.round(bytes / 100_000) / 10} MB`;
}

async function loadAiSettings() {
  aiSettingsLoading.value = true;
  aiSettingsError.value = "";

  try {
    const response = await api.get<AiSettingsResponse>("/ai-settings");
    aiDeploymentMode.value = response.deploymentMode;
    aiProviders.value = response.providers || [];
    if (response.deploymentMode === "self_hosted") {
      applyDefaultChatModel(response);
      syncVisibleAssistantModelSelection();
    }
  } catch (err) {
    aiSettingsError.value = messageFromUnknown(
      err,
      "Could not check model setup.",
    );
  } finally {
    aiSettingsLoading.value = false;
  }
}

function syncVisibleAssistantModelSelection() {
  if (
    visibleAssistantModelOptions.value.some(
      (option) => option.id === selectedModelId.value,
    )
  ) {
    return;
  }

  const fallback = visibleAssistantModelOptions.value[0];
  if (!fallback) return;
  selectedModelId.value = fallback.id;
  if (selectedModelTouched.value) {
    persistAssistantModelId(fallback.id);
  }
}

function applyDefaultChatModel(settings: AiSettingsResponse) {
  if (selectedModelTouched.value) return;

  const route = settings.defaults?.chat || settings.defaults?.default;
  if (!route) return;

  const matchedOption = AI_AGENT_MODEL_OPTIONS.find(
    (option) =>
      option.providerId === route.providerId && option.model === route.model,
  );

  if (matchedOption) {
    selectedModelId.value = matchedOption.id;
  }
}

function handleAssistantModelChange() {
  selectedModelTouched.value = true;
  persistAssistantModelId(selectedModelId.value);
}

function getStoredAssistantModelId() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(assistantModelStorageKey);
    return AI_AGENT_MODEL_OPTIONS.some((option) => option.id === value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function persistAssistantModelId(modelId: string) {
  if (typeof window === "undefined") return;
  if (!AI_AGENT_MODEL_OPTIONS.some((option) => option.id === modelId)) return;
  try {
    window.localStorage.setItem(assistantModelStorageKey, modelId);
  } catch {
    // Losing local preference persistence should not block chat.
  }
}

function setupStateForModel(option: AiAgentModelOption | undefined) {
  if (!option) {
    return {
      configured: false,
      setupRequired: false,
      statusLabel: "Unknown",
      className: "model-picker__status--unknown",
    };
  }

  if (aiSettingsLoading.value) {
    return {
      configured: false,
      setupRequired: false,
      statusLabel: "Checking",
      className: "model-picker__status--unknown",
    };
  }

  if (aiSettingsError.value) {
    return {
      configured: false,
      setupRequired: false,
      statusLabel: "Unknown",
      className: "model-picker__status--unknown",
    };
  }

  const provider = aiProviderById.value.get(option.providerId);
  if (!provider) {
    return {
      configured: false,
      setupRequired: false,
      statusLabel: "Unknown",
      className: "model-picker__status--unknown",
    };
  }

  return {
    configured: provider.configured,
    setupRequired: provider.setupRequired,
    statusLabel: provider.configured ? "Ready" : "Setup needed",
    className: provider.configured
      ? "model-picker__status--ready"
      : "model-picker__status--setup",
  };
}

function capabilitySummary(capabilities: AiAgentModelCapability[]) {
  const labels: Record<AiAgentModelCapability, string> = {
    text: "Text",
    vision: "Image input",
    image_input: "Image input",
    image_generation: "Image generation",
    image_edit: "Image edit",
    "long-context": "Long",
    reasoning: "Reasoning",
    "tool-use": "Tools",
  };
  return [...new Set(capabilities.map((capability) => labels[capability]))].join(", ");
}

function modelHasImageInput(capabilities: AiAgentModelCapability[]) {
  return (
    capabilities.includes("image_input") ||
    capabilities.includes("vision")
  );
}

function attachmentsContainReadyImage(
  attachments: ReadonlyArray<AgentChatMessageAttachment>,
) {
  return attachments.some(
    (attachment) =>
      attachment.kind === "image" && attachment.status === "ready",
  );
}

function readyImageAttachmentCount(
  attachments: ReadonlyArray<AgentChatMessageAttachment>,
) {
  return attachments.filter(
    (attachment) =>
      attachment.kind === "image" && attachment.status === "ready",
  ).length;
}

function preferredImageInputModel() {
  return (
    visibleAssistantModelOptions.value.find(
      (option) =>
        option.id === "workers-kimi-k2-7" &&
        modelHasImageInput(option.capabilities),
    ) ||
    visibleAssistantModelOptions.value.find((option) =>
      modelHasImageInput(option.capabilities),
    ) ||
    null
  );
}

function resolveAssistantTurnModel(
  attachments: ReadonlyArray<AgentChatMessageAttachment>,
) {
  if (!shouldSendAssistantModelOverride(aiDeploymentMode.value)) return null;
  const currentModel = selectedModel.value;
  if (!attachmentsContainReadyImage(attachments)) return currentModel;
  if (modelHasImageInput(currentModel.capabilities)) return currentModel;
  return preferredImageInputModel();
}

function assistantTurnStatusForModel(
  attachments: ReadonlyArray<AgentChatMessageAttachment>,
  turnModel: AiAgentModelOption | null,
) {
  const imageCount = readyImageAttachmentCount(attachments);
  if (imageCount === 0 || !turnModel) return "";

  const imageLabel = imageCount === 1 ? "image" : `${imageCount} images`;
  if (turnModel.id !== selectedModel.value.id) {
    return `Using ${turnModel.label} for ${imageLabel}.`;
  }
  return `Reading ${imageLabel} with ${turnModel.label}.`;
}

function assistantMessageKey(
  message: { id?: string; role: string; text: string },
  index?: number,
) {
  return (
    message.id || `${message.role}:${index ?? 0}:${message.text.slice(0, 32)}`
  );
}

function newAssistantMessageId(role: "user" | "assistant") {
  return `${role}:${crypto.randomUUID()}`;
}

function assistantMessageIndex(message: (typeof chatMessages.value)[number]) {
  return chatMessages.value.indexOf(message);
}

async function submitAssistantText(
  text: string,
  attachments: ReadonlyArray<AgentChatMessageAttachment> =
    serializeAssistantAttachmentsForTurn(),
  turnModel = resolveAssistantTurnModel(attachments),
) {
  await showWorkspace(false);
  const normalized = text.trim();
  if (!normalized || assistantSending.value) return;

  assistantError.value = null;
  assistantTurnStatusText.value = assistantTurnStatusForModel(
    attachments,
    turnModel,
  ) || "Preparing your request…";
  const abortController = new AbortController();
  assistantAbortController = abortController;
  agentChat.appendMessage({
    id: newAssistantMessageId("user"),
    role: "user",
    text: normalized,
    attachments: normalizeAssistantMessageAttachments(attachments),
    createdAt: new Date().toISOString(),
  });
  assistantSending.value = true;
  assistantAwaitingResponse.value = true;
  await scrollAssistantToBottom();
  const requestId = crypto.randomUUID();
  assistantActiveRequestId = requestId;
  const clientTurnStartedAt = performance.now();
  let clientResponseAt: number | null = null;
  let clientFirstEventAt: number | null = null;
  let clientFirstTextAt: number | null = null;
  const assistantMessageId = newAssistantMessageId("assistant");
  let assistantMessageStarted = false;

  try {
    let result: AgentSandboxResponse | null = null;

    const ensureAssistantMessage = () => {
      if (assistantMessageStarted) return;
      assistantMessageStarted = true;
      agentChat.appendMessage({
        id: assistantMessageId,
        role: "assistant",
        text: "",
        createdAt: new Date().toISOString(),
      });
      void scrollAssistantMessageIntoView(assistantMessageId);
    };

    await api.streamEvents(
      "/assistant/chat/turn/stream",
      {
        requestId,
        messageText: normalized,
        threadId: assistantThreadId.value,
        projectId: assistantThreadId.value ? undefined : routeProjectId(),
        attachments,
        scopes: siteBuilderMode.value ? ["site"] : undefined,
        model: turnModel
          ? {
              providerId: turnModel.providerId,
              model: turnModel.model,
              optionId: turnModel.id,
            }
          : null,
      },
      (event) => {
        clientFirstEventAt ??= performance.now();
        const data = streamEventRecord(event);

        if (event.event === "thread") {
          const threadId =
            typeof data.threadId === "string" ? data.threadId : "";
          if (threadId) {
            assistantThreadId.value = threadId;
          }
          return;
        }

        if (event.event === "status") {
          if (data.replaceText === true || data.clearText === true) {
            const message = chatMessages.value.find(
              (item) => item.id === assistantMessageId,
            );
            if (message) message.text = "";
            assistantAwaitingResponse.value = true;
          }
          if (data.state === "started") {
            assistantTurnStatusText.value = "Preparing your request…";
          } else if (data.state === "context_loading") {
            assistantTurnStatusText.value = "Loading relevant context…";
          } else if (data.state === "status_update_loading") {
            assistantTurnStatusText.value = "Checking your day…";
          } else if (data.state === "model_started") {
            assistantTurnStatusText.value =
              data.isBackup === true
                ? "Trying the backup model…"
                : data.intent === "status_update"
                ? "Choosing what matters now…"
                : typeof data.modelStep === "number" && data.modelStep > 1
                ? "Putting the result together…"
                : "Writing a response…";
          } else if (data.state === "finalizing") {
            assistantTurnStatusText.value = "Finishing the response…";
          }
          return;
        }

        if (event.event === "tool") {
          if (data.clearText === true) {
            const message = chatMessages.value.find(
              (item) => item.id === assistantMessageId,
            );
            if (message) message.text = "";
            assistantAwaitingResponse.value = true;
          }
          assistantTurnStatusText.value = data.state === "started"
            ? assistantToolStatusText(data.capabilityId)
            : "Finishing the response…";
          return;
        }

        if (event.event === "delta") {
          ensureAssistantMessage();
          const message = chatMessages.value.find(
            (item) => item.id === assistantMessageId,
          );
          if (message && typeof data.text === "string") {
            message.text += data.text;
            if (data.text) {
              clientFirstTextAt ??= performance.now();
              assistantAwaitingResponse.value = false;
            }
          }
          return;
        }

        if (event.event === "done") {
          ensureAssistantMessage();
          assistantAwaitingResponse.value = false;
          const clientDoneAt = performance.now();
          console.info("ME3_ASSISTANT_LATENCY", {
            requestId,
            client: {
              responseHeadersMs: assistantClientDurationMs(
                clientTurnStartedAt,
                clientResponseAt,
              ),
              firstEventMs: assistantClientDurationMs(
                clientTurnStartedAt,
                clientFirstEventAt,
              ),
              firstTextMs: assistantClientDurationMs(
                clientTurnStartedAt,
                clientFirstTextAt,
              ),
              doneMs: assistantClientDurationMs(
                clientTurnStartedAt,
                clientDoneAt,
              ),
            },
            server: {
              performance: data.performance ?? null,
              stream: data.streamMetrics ?? null,
            },
          });
          result = data as unknown as AgentSandboxResponse;
          applyAssistantResultToMessage(assistantMessageId, result);
          return;
        }

        if (event.event === "error") {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Assistant stream failed",
          );
        }
      },
      {
        signal: abortController.signal,
        onResponse: () => {
          clientResponseAt ??= performance.now();
        },
      },
    );

    assistantAwaitingResponse.value = false;
    const completedResult = result as AgentSandboxResponse | null;
    if (!completedResult) {
      throw new Error("Assistant stream ended before the turn completed.");
    }
    if (completedResult.threadId) {
      assistantThreadId.value = completedResult.threadId;
      await setRouteThreadId(completedResult.threadId);
      void loadAssistantThreads();
    }
  } catch (err) {
    assistantAwaitingResponse.value = false;
    if (isAbortError(err)) {
      setAssistantStoppedMessage(assistantMessageId, assistantMessageStarted);
      return;
    }
    const message = messageFromUnknown(
      err,
      `Failed to reach ${assistantDisplayName.value} right now.`,
    );
    assistantError.value = message;
    agentChat.appendMessage({
      id: newAssistantMessageId("assistant"),
      role: "assistant",
      text: "I couldn't complete that turn just yet.",
      createdAt: new Date().toISOString(),
      detail: message,
    });
  } finally {
    if (assistantAbortController === abortController) {
      assistantAbortController = null;
      assistantActiveRequestId = null;
    }
    assistantAwaitingResponse.value = false;
    assistantSending.value = false;
    assistantTurnStatusText.value = "";
    if (assistantMessageStarted) {
      await scrollAssistantMessageIntoView(assistantMessageId);
    } else {
      await scrollAssistantToBottom();
    }
    await nextTick();
    autosizeAssistantComposer();
    assistantComposerRef.value?.focus();
  }
}

function assistantClientDurationMs(
  startedAt: number,
  finishedAt: number | null,
): number | null {
  return finishedAt === null
    ? null
    : Number((finishedAt - startedAt).toFixed(2));
}

async function sendAssistantMessage() {
  if (!canSendAssistantMessage.value) return;

  const attachments = serializeAssistantAttachmentsForTurn();
  const text =
    assistantDraft.value.trim() ||
    (attachments.length > 0 ? "Review the attached files." : "");
  assistantDraft.value = "";
  clearAssistantAttachments();
  assistantAttachmentNotice.value = "";
  autosizeAssistantComposer();
  await submitAssistantText(text, attachments);
}

function streamEventRecord(event: ApiStreamEvent): Record<string, unknown> {
  return event.data &&
    typeof event.data === "object" &&
    !Array.isArray(event.data)
    ? (event.data as Record<string, unknown>)
    : {};
}

function assistantToolStatusText(capabilityId: unknown): string {
  if (typeof capabilityId !== "string") return "Using a ME3 tool…";
  if (capabilityId.startsWith("core.mailbox.")) return "Checking your mailbox…";
  if (capabilityId.startsWith("core.calendar.")) return "Checking your calendar…";
  if (capabilityId.startsWith("core.reminders.")) return "Checking your reminders…";
  if (capabilityId.startsWith("core.scheduling.")) return "Checking availability…";
  if (capabilityId === "core.people.search") return "Finding people…";
  if (capabilityId.startsWith("core.journal.")) return "Reading your Journal…";
  if (capabilityId.startsWith("core.mission.")) return "Checking your tasks…";
  if (capabilityId.startsWith("core.social.")) return "Preparing social content…";
  if (capabilityId.startsWith("core.sites.")) return "Checking your site…";
  if (capabilityId === "core.bookings.lookup") return "Checking your bookings…";
  if (capabilityId === "core.contacts.search") return "Searching your contacts…";
  return "Using a ME3 tool…";
}

function applyAssistantResultToMessage(
  messageId: string,
  result: AgentSandboxResponse,
) {
  const message = chatMessages.value.find((item) => item.id === messageId);
  if (!message) return;
  if (!message.text.trim()) {
    message.text = resolveAgentReplyText(result.replyText);
  }
  message.meta = formatAgentRuntimeMetadata(result, {
    showRuntimeMetadata: import.meta.env.DEV,
  });
  message.detail = formatAgentRuntimeDetail(result);
  message.trace = result.trace || null;
  message.actionCards = normalizeAgentActionCards(result.actionCards);
  if (
    message.actionCards.some(
      (card) =>
        card.kind === "sites.landing_page_created" &&
        card.records.some((record) => record.kind === "site"),
    )
  ) {
    void sitesStore.fetchSites();
  }
  message.imageAction = result.imageAction || null;
  message.emailDraftAction = createAgentChatEmailDraftAction(
    message,
    previousUserTextForAssistantMessage(message),
  );
  hydrateAssistantEmailDraftMessage(message);
  message.inboxLink = result.emailAction?.kind === "drafted";
  message.rolodexLink = result.contactsChanged === true;
  message.reminderLink =
    result.reminderAction?.kind === "created" ||
    result.reminderAction?.kind === "updated";
  const siteActionLink = resolveAgentMessageActionLink(result);
  message.actionHref =
    siteActionLink?.href ||
    (result.contentAction?.kind === "saved" ? "/social" : null);
  message.actionLabel =
    siteActionLink?.label ||
    (result.contentAction?.kind === "saved" ? "Open Social Publishing" : null);
  message.jobBuilderAction = result.jobBuilderAction || null;
}

function createAgentChatEmailDraftAction(
  message: {
    id?: string;
    role?: string;
    text: string;
    actionCards?: AgentChatActionCard[] | null;
  },
  previousUserText: string,
): AgentChatEmailDraftAction | null {
  if (message.role && message.role !== "assistant") return null;
  if (message.actionCards?.length) return null;
  const draft = inferAgentChatEmailDraft(message.text, previousUserText);
  if (!draft) return null;
  const to = draft.toAddress || "";
  return {
    ...draft,
    id: `email-draft:${message.id || draft.subject || draft.body.slice(0, 24)}`,
    to,
    status: "draft",
    statusLabel: isValidEmailAddress(to) ? "Ready" : "Needs recipient's email",
    savedDraftId: null,
    busy: null,
    error: null,
  };
}

function createSavedAgentChatEmailDraftAction(
  message: { id?: string; text: string },
  draft: NonNullable<AssistantMailboxDraftResponse["draft"]>,
): AgentChatEmailDraftAction {
  const to = draft.toAddress || "";
  return {
    id: `email-draft:${message.id || draft.id}`,
    toName: null,
    toAddress: draft.toAddress || null,
    subject: draft.subject || "",
    body: draft.body || "",
    displayText: message.text,
    to,
    status: "saved",
    statusLabel: "Saved draft",
    savedDraftId: draft.id,
    busy: null,
    error: null,
  };
}

function hydrateAssistantEmailDraftMessage(message: {
  id?: string;
  text: string;
  emailDraftAction?: AgentChatEmailDraftAction | null;
  actionCards?: AgentChatActionCard[] | null;
}) {
  if (message.emailDraftAction) {
    void hydrateAssistantEmailDraftRecipient(message.emailDraftAction);
    return;
  }
  const draftId = assistantMailboxDraftIdForMessage(message);
  if (draftId) void hydrateAssistantSavedEmailDraft(message, draftId);
}

function assistantMailboxDraftIdForMessage(message: {
  actionCards?: AgentChatActionCard[] | null;
}) {
  for (const card of message.actionCards || []) {
    const draftId = mailboxDraftIdForActionCard(card);
    if (draftId) return draftId;
  }
  return null;
}

async function hydrateAssistantSavedEmailDraft(
  message: {
    id?: string;
    text: string;
    emailDraftAction?: AgentChatEmailDraftAction | null;
  },
  draftId: string,
) {
  if (message.emailDraftAction || assistantDraftHydrationIds.has(draftId)) return;
  assistantDraftHydrationIds.add(draftId);
  try {
    const draft = await loadAssistantMailboxDraft(draftId);
    if (!draft || message.emailDraftAction) return;
    message.emailDraftAction = createSavedAgentChatEmailDraftAction(
      message,
      draft,
    );
  } catch {
    // Keep the existing action card if the mailbox draft cannot be loaded.
  } finally {
    assistantDraftHydrationIds.delete(draftId);
  }
}

async function loadAssistantMailboxDraft(draftId: string) {
  const data = await api.get<{
    message: NonNullable<AssistantMailboxDraftResponse["draft"]>;
  }>(
    `/mailbox/messages/${encodeURIComponent(draftId)}`,
  );
  return data.message || null;
}

function previousUserTextForAssistantMessage(
  message: (typeof chatMessages.value)[number],
) {
  const index = assistantMessageIndex(message);
  if (index < 0) return "";
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = chatMessages.value[cursor];
    if (previous?.role === "user") return previous.text;
  }
  return "";
}

async function hydrateAssistantEmailDraftRecipient(
  action: AgentChatEmailDraftAction,
) {
  if (action.to.trim() || !action.toName) return;

  const existingMatch = findAssistantEmailDraftContact(action.toName);
  if (existingMatch?.email) {
    action.to = existingMatch.email;
    action.statusLabel = "Ready";
    return;
  }

  if (assistantContactsLoaded.value) return;
  assistantContactsLoaded.value = true;
  await contactsStore.fetchContacts();
  if (action.to.trim()) return;

  const loadedMatch = findAssistantEmailDraftContact(action.toName);
  if (loadedMatch?.email) {
    action.to = loadedMatch.email;
    action.statusLabel = "Ready";
  }
}

function findAssistantEmailDraftContact(name: string): Contact | null {
  const needle = normalizeAssistantDraftRecipientName(name);
  if (!needle) return null;
  return (
    contactsStore.contacts.find(
      (contact) =>
        contact.status !== "archived" &&
        Boolean(contact.email) &&
        assistantDraftContactNames(contact).some((candidate) => {
          const normalized = normalizeAssistantDraftRecipientName(candidate);
          return (
            normalized === needle ||
            normalized.split(" ")[0] === needle ||
            needle.split(" ")[0] === normalized
          );
        }),
    ) || null
  );
}

function assistantDraftContactNames(contact: Contact): string[] {
  const aliases = Array.isArray(contact.metadata?.aliases)
    ? contact.metadata.aliases.filter(
        (alias): alias is string => typeof alias === "string",
      )
    : [];
  return [contact.name, ...aliases, ...contact.tags];
}

function normalizeAssistantDraftRecipientName(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
    : "";
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function canSubmitAssistantEmailDraft(action: AgentChatEmailDraftAction) {
  return (
    !action.busy &&
    isValidEmailAddress(action.to) &&
    action.subject.trim().length > 0 &&
    action.body.trim().length > 0
  );
}

function assistantEmailDraftHint(action: AgentChatEmailDraftAction) {
  if (action.error) return action.error;
  if (!action.to.trim()) {
    return "Add recipient's email before saving.";
  }
  if (!isValidEmailAddress(action.to)) return "Use a valid recipient email.";
  if (!action.subject.trim()) return "Add a subject before saving.";
  if (!action.body.trim()) return "Add an email body before saving.";
  return "";
}

function touchAgentChatEmailDraftAction(action: AgentChatEmailDraftAction) {
  if (action.busy) return;
  action.error = null;
  action.status = "draft";
  action.statusLabel = isValidEmailAddress(action.to)
    ? action.savedDraftId
      ? "Unsaved edits"
      : "Ready"
    : "Needs recipient's email";
}

async function saveAgentChatEmailDraftAction(
  action: AgentChatEmailDraftAction,
  sendNow: boolean,
) {
  if (action.busy) return;
  if (!canSubmitAssistantEmailDraft(action)) {
    action.error = assistantEmailDraftHint(action);
    action.status = "failed";
    action.statusLabel = "Needs attention";
    return;
  }

  action.busy = sendNow ? "send" : "save";
  action.error = null;
  assistantError.value = null;

  try {
    const payload = {
      to: action.to.trim(),
      subject: action.subject.trim(),
      textBody: action.body.trim(),
      source: "agent",
    };
    const response = action.savedDraftId
      ? await api.put<AssistantMailboxDraftResponse>(
          `/mailbox/drafts/${encodeURIComponent(action.savedDraftId)}`,
          payload,
        )
      : await api.post<AssistantMailboxDraftResponse>(
          "/mailbox/drafts",
          payload,
        );
    const draftId = response.draft?.id || action.savedDraftId;
    if (!draftId) throw new Error("Draft was not saved.");

    action.savedDraftId = draftId;
    action.to = response.draft?.toAddress || action.to;
    action.subject = response.draft?.subject || action.subject;
    action.body = response.draft?.body || action.body;

    if (sendNow) {
      await api.post(`/mailbox/drafts/${encodeURIComponent(draftId)}/approve`);
      action.status = "sent";
      action.statusLabel = "Sent";
      toastSuccess("Email sent.");
    } else {
      action.status = "saved";
      action.statusLabel = "Saved draft";
      toastSuccess("Draft saved.");
    }
    await refreshInboxDraftCount();
  } catch (err) {
    const fallback = sendNow ? "Email could not be sent." : "Draft could not be saved.";
    action.status = "failed";
    action.statusLabel = "Needs attention";
    action.error = messageFromUnknown(err, fallback);
    assistantError.value = action.error;
    toastFromUnknown(err, fallback);
  } finally {
    action.busy = null;
  }
}

function mailboxDraftIdForActionCard(card: AgentChatActionCard): string | null {
  if (
    card.kind !== "mailbox.draft_saved" ||
    card.status !== "pending_approval"
  ) {
    return null;
  }
  return (
    card.records.find((record) => record.kind === "mailbox_draft")?.id || null
  );
}

function assistantActionCardBusyKey(card: AgentChatActionCard): string | null {
  const draftId = mailboxDraftIdForActionCard(card);
  return draftId ? `mailbox-draft-send:${draftId}` : null;
}

function displayedAssistantPrimaryAction(card: AgentChatActionCard) {
  const action = card.primaryAction;
  if (!action) return null;
  const isLandingPage = card.records.some(
    (record) => record.kind === "landing_page",
  );
  if (isLandingPage && action.label.trim().toLowerCase() === "open draft") {
    return { label: "Continue building", href: "#assistant-console-input" };
  }
  return action;
}

async function sendMailboxDraftFromActionCard(card: AgentChatActionCard) {
  const draftId = mailboxDraftIdForActionCard(card);
  if (!draftId || assistantActionCardBusy.value) return;

  const busyKey = `mailbox-draft-send:${draftId}`;
  assistantActionCardBusy.value = busyKey;
  assistantError.value = null;
  try {
    await api.post(`/mailbox/drafts/${encodeURIComponent(draftId)}/approve`);
    card.status = "complete";
    card.statusLabel = "Sent";
    card.summary = "Sent from mailbox.";
    const statusField = card.changed.find(
      (field) => field.label.trim().toLowerCase() === "status",
    );
    if (statusField) {
      statusField.value = "Sent";
    } else {
      card.changed.push({ label: "Status", value: "Sent" });
    }
    toastSuccess("Email sent.");
  } catch (err) {
    assistantError.value = messageFromUnknown(err, "Email could not be sent.");
    toastFromUnknown(err, "Email could not be sent.");
  } finally {
    if (assistantActionCardBusy.value === busyKey) {
      assistantActionCardBusy.value = null;
    }
  }
}

function assistantTraceRows(trace: AgentChatTurnTrace | null | undefined) {
  return formatAgentTraceRows(trace);
}

type AssistantJobSaveResponse = {
  job: AssistantJob;
  version: AssistantJobVersion | null;
  validation: AssistantJobDraftValidation;
};

function jobBuilderBusyKey(action: AssistantJobBuilderAction, intent: string) {
  if (action.kind === "job_draft")
    return `job-builder:${intent}:${action.draftId}`;
  if (action.kind === "job_saved")
    return `job-builder:${intent}:${action.jobId}`;
  return `job-builder:${intent}:unsupported`;
}

function jobBuilderActionBusy(
  action: AssistantJobBuilderAction,
  intent: string,
) {
  return busyKeys.value.has(jobBuilderBusyKey(action, intent));
}

async function saveAssistantJobBuilderDraft(
  message: (typeof chatMessages.value)[number],
  action: AssistantJobBuilderAction,
  activate: boolean,
) {
  if (action.kind !== "job_draft") return;
  const intent = activate ? "save_and_activate" : "save";
  const key = jobBuilderBusyKey(action, intent);
  if (busyKeys.value.has(key)) return;
  busyKeys.value.add(key);
  try {
    const response = await api.post<AssistantJobSaveResponse>(
      "/assistant/jobs",
      {
        draft: action.draft,
        status: activate ? "active" : "draft",
      },
    );
    await loadJobs();
    const savedAction = assistantJobSavedAction(response.job);
    message.jobBuilderAction = savedAction;
    message.text = savedAction.summary;
    toastSuccess(
      activate && response.job.status === "active"
        ? "Job saved and activated."
        : "Job saved.",
    );
  } catch (err) {
    assistantError.value = messageFromUnknown(err, "Job could not be saved.");
    toastFromUnknown(err, "Job could not be saved.");
  } finally {
    busyKeys.value.delete(key);
  }
}

async function runAssistantJobBuilderSaved(action: AssistantJobBuilderAction) {
  if (action.kind !== "job_saved") return;
  const job = jobs.value.find((item) => item.id === action.jobId);
  if (!job) return;
  await runJob(job);
}

async function activateAssistantJobBuilderSaved(
  message: (typeof chatMessages.value)[number],
  action: AssistantJobBuilderAction,
) {
  if (action.kind !== "job_saved") return;
  const job = jobs.value.find((item) => item.id === action.jobId);
  if (!job) return;
  const key = jobBuilderBusyKey(action, "activate");
  if (busyKeys.value.has(key)) return;
  busyKeys.value.add(key);
  try {
    const response = await api.post<{ job: AssistantJob }>(
      `/assistant/jobs/${encodeURIComponent(job.id)}/resume`,
    );
    await loadJobs();
    const savedAction = assistantJobSavedAction(response.job);
    message.jobBuilderAction = savedAction;
    message.text = savedAction.summary;
    toastSuccess("Job activated.");
  } catch (err) {
    assistantError.value = messageFromUnknown(err, "Job could not activate.");
    toastFromUnknown(err, "Job could not activate.");
  } finally {
    busyKeys.value.delete(key);
  }
}

function assistantJobSavedAction(
  job: AssistantJob,
): AssistantJobSavedBuilderAction {
  const availableActions: Array<"activate" | "run_now" | "open_job"> = [
    "open_job",
  ];
  if (job.status === "draft" || job.status === "paused") {
    availableActions.unshift("activate");
  }
  if (job.status === "active") {
    availableActions.unshift("run_now");
  }
  return {
    kind: "job_saved",
    jobId: job.id,
    status: job.status,
    summary: `${job.name} was saved as ${assistantJobStatusLabel(job.status)}.`,
    availableActions,
  };
}

function assistantJobStatusLabel(
  status: AssistantJobStatus | AssistantJobDraftValidation["status"],
) {
  const labels: Record<
    AssistantJobStatus | AssistantJobDraftValidation["status"],
    string
  > = {
    draft: "Draft",
    active: "Active",
    paused: "Paused",
    needs_setup: "Needs setup",
    failing: "Failing",
    archived: "Archived",
    valid: "Ready",
    invalid: "Needs changes",
  };
  return labels[status] || status;
}

function assistantJobBuilderDestinationLabel(draft: AssistantJobDraft) {
  const labels: Record<AssistantJobDraft["destination"]["landing"], string> = {
    review_packet: "Review result",
    task: "Task",
    capture: "Saved result",
    approval: "Approval",
    memory_review: "Memory review",
    activity: "Assistant activity",
    accounts: "Accounts",
  };
  return labels[draft.destination.landing] || "ME3";
}

function assistantJobBuilderWhenPhrase(draft: AssistantJobDraft) {
  const trigger = draft.trigger;
  if (trigger.kind === "manual") return "when you run it";
  if (trigger.kind === "event") return "when a matching event happens";
  if (trigger.cadence === "daily") {
    return trigger.localTime ? `daily at ${trigger.localTime}` : "daily";
  }
  if (trigger.cadence === "weekly") {
    const day = weekdayOptions.find(
      (option) => option.value === trigger.dayOfWeek,
    )?.label;
    const parts = [
      "weekly",
      day ? `on ${day}` : "",
      trigger.localTime ? `at ${trigger.localTime}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return parts || "weekly";
  }
  if (trigger.cadence === "monthly") {
    return trigger.localTime ? `monthly at ${trigger.localTime}` : "monthly";
  }
  return "on its custom schedule";
}

function assistantJobBuilderToolNames(draft: AssistantJobDraft) {
  const recipeTools: Record<string, string[]> = {
    "weekly-review": [
      "Projects",
      "Tasks",
      "Approvals",
      "Reviews",
    ],
    "daily-briefing": [
      "Tasks",
      "Approvals",
      "Reviews",
      "Owner Notifications",
    ],
    "email-triage": [
      "Email",
      "Reviews",
      "Tasks",
    ],
    "invoice-receipt-triage": ["Email", "Accounts", "Reviews"],
  };
  const fromRecipe = draft.recipeId ? recipeTools[draft.recipeId] : null;
  if (fromRecipe) return fromRecipe;

  const names = new Set<string>();
  for (const action of draft.actions) {
    const [namespace] = action.capabilityId.split(".");
    if (namespace === "mission") names.add("Tasks and Projects");
    if (namespace === "message") names.add("Owner Notifications");
    if (namespace === "email") names.add("Email");
    if (namespace === "accounts") names.add("Accounts");
    if (namespace === "calendar") names.add("Calendar");
  }
  return names.size ? Array.from(names) : ["ME3"];
}

function assistantJobBuilderToolPhrase(draft: AssistantJobDraft) {
  return formatHumanList(assistantJobBuilderToolNames(draft));
}

function assistantJobBuilderSentenceSegments(
  action: Extract<AssistantJobBuilderAction, { kind: "job_draft" }>,
): AssistantJobBuilderSentenceSegment[] {
  const draft = action.draft;
  const when = assistantJobBuilderWhenPhrase(draft);
  const fallbackDestination = assistantJobBuilderDestinationLabel(draft);
  const byRecipe: Record<string, AssistantJobBuilderSentenceSegment[]> = {
    "weekly-review": [
      { text: "This job will review " },
      {
        text: "your projects, tasks, and pending approvals for the week",
        strong: true,
      },
      { text: " " },
      { text: when, strong: true },
      { text: " and create " },
      { text: "a weekly task review", strong: true },
      { text: " for you to review." },
    ],
    "daily-briefing": [
      { text: "This job will review " },
      { text: "today's tasks and approvals", strong: true },
      { text: " " },
      { text: when, strong: true },
      { text: " and create " },
      { text: "a daily briefing", strong: true },
      { text: " for you to start the day." },
    ],
    "email-triage": [
      { text: "This job will check " },
      {
        text: "your connected email for messages that match your rules",
        strong: true,
      },
      { text: " " },
      { text: when, strong: true },
      { text: " and create " },
      { text: "an inbox review", strong: true },
      { text: " for you to act on." },
    ],
    "invoice-receipt-triage": [
      { text: "This job will find " },
      { text: "receipts and invoices in your connected email", strong: true },
      { text: " " },
      { text: when, strong: true },
      { text: " and create " },
      { text: "Accounts entries with a review", strong: true },
      { text: " for anything that needs checking." },
    ],
  };

  const sentence = draft.recipeId ? byRecipe[draft.recipeId] : null;
  if (sentence) return sentence;

  return [
    { text: "This job will run " },
    { text: draft.purpose, strong: true },
    { text: " " },
    { text: when, strong: true },
    { text: " and create " },
    { text: fallbackDestination, strong: true },
    { text: " for you to review." },
  ];
}

function formatHumanList(values: string[]) {
  const unique = Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0] || "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function setAssistantStoppedMessage(
  messageId: string,
  messageStarted: boolean,
) {
  const stoppedDetail = "ME3 stopped before the assistant finished replying.";
  if (!messageStarted) {
    agentChat.appendMessage({
      id: messageId,
      role: "assistant",
      text: "Stopped.",
      createdAt: new Date().toISOString(),
      detail: stoppedDetail,
    });
    return;
  }

  const message = chatMessages.value.find((item) => item.id === messageId);
  if (!message) return;
  if (!message.text.trim()) {
    message.text = "Stopped.";
  }
  message.detail = message.detail?.trim()
    ? `${message.detail}\n${stoppedDetail}`
    : stoppedDetail;
}

function stopAssistantTurn() {
  if (!assistantSending.value) return;
  const requestId = assistantActiveRequestId;
  assistantActiveRequestId = null;
  if (requestId) void api.post("/assistant/chat/turn/abort", { requestId }).catch(error => toastFromUnknown(error, "The server turn could not be stopped. Refresh to check its result."));
  assistantAbortController?.abort();
}

function isAbortError(err: unknown) {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

async function copyAssistantMessage(
  message: (typeof chatMessages.value)[number],
  index: number,
) {
  const text = message.text.trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  copiedMessageKey.value = assistantMessageKey(message, index);
  window.setTimeout(() => {
    if (copiedMessageKey.value === assistantMessageKey(message, index)) {
      copiedMessageKey.value = null;
    }
  }, 1500);
}

async function retryAssistantTurn(
  message: (typeof chatMessages.value)[number],
) {
  if (assistantSending.value) return;

  const startIndex =
    message.role === "user"
      ? assistantMessageIndex(message)
      : findPreviousUserMessageIndex(message);
  if (startIndex < 0) return;

  const text = chatMessages.value[startIndex]?.text.trim();
  if (!text) return;

  const attachments = normalizeAssistantMessageAttachments(
    chatMessages.value[startIndex]?.attachments,
  );
  chatMessages.value.splice(startIndex);
  await submitAssistantText(text, attachments);
}

function editAndResendAssistantTurn(
  message: (typeof chatMessages.value)[number],
) {
  if (assistantSending.value || message.role !== "user") return;

  const index = assistantMessageIndex(message);
  if (index < 0) return;

  assistantDraft.value = message.text;
  assistantError.value = null;
  chatMessages.value.splice(index);
  void nextTick(() => {
    autosizeAssistantComposer();
    assistantComposerRef.value?.focus();
  });
}

function findPreviousUserMessageIndex(
  message: (typeof chatMessages.value)[number],
) {
  const index = assistantMessageIndex(message);
  if (index < 0) return -1;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (chatMessages.value[cursor]?.role === "user") {
      return cursor;
    }
  }

  return -1;
}

function insertVoiceTranscript(text: string) {
  const transcript = text.trim();
  if (!transcript) return;

  const textarea = assistantComposerRef.value;
  const current = assistantDraft.value;
  const selectionStart = textarea?.selectionStart ?? current.length;
  const selectionEnd = textarea?.selectionEnd ?? selectionStart;
  const before = current.slice(0, selectionStart);
  const after = current.slice(selectionEnd);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";

  assistantDraft.value = `${before}${prefix}${transcript}${suffix}${after}`;
  void nextTick(() => {
    const cursor = selectionStart + prefix.length + transcript.length;
    autosizeAssistantComposer();
    assistantComposerRef.value?.focus();
    assistantComposerRef.value?.setSelectionRange(cursor, cursor);
  });
}

function onAssistantComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void sendAssistantMessage();
}

async function loadJobs() {
  loadingJobs.value = true;
  try {
    const data = await api.get<JobsResponse>("/assistant/jobs");
    jobs.value = data.jobs || [];
    if (
      selectedJobId.value &&
      !jobs.value.some((job) => job.id === selectedJobId.value)
    ) {
      closeDetailModal();
    }
  } catch (err) {
    pageError.value = messageFromUnknown(err, "Could not load jobs.");
  } finally {
    loadingJobs.value = false;
  }
}

async function loadRecipes() {
  loadingRecipes.value = true;
  try {
    const data = await api.get<RecipesResponse>("/assistant/jobs/recipes");
    recipes.value = data.recipes || [];
  } catch (err) {
    pageError.value = messageFromUnknown(err, "Could not load starter jobs.");
  } finally {
    loadingRecipes.value = false;
  }
}

async function openJob(jobId: string) {
  selectedJobId.value = jobId;
  detailModalOpen.value = true;
  configureJobsModalOpen.value = false;
  loadingDetail.value = true;
  try {
    selectedDetail.value = await api.get<AssistantJobDetail>(
      `/assistant/jobs/${encodeURIComponent(jobId)}`,
    );
    dailyBriefingTemplateDraft.value = savedDailyBriefingTemplate.value;
    dailyBriefingTemplateNotice.value = "";
    loadScheduleDraftFromDetail();
    scheduleNotice.value = "";
    scheduleInlineEditing.value = false;
    loadInboxWatchRulesDraftFromDetail();
  } catch (err) {
    closeDetailModal();
    toastFromUnknown(err, "Could not load job details.");
  } finally {
    loadingDetail.value = false;
  }
}

async function createStarterJob(recipe: AssistantJobRecipe) {
  await withBusy(`recipe:${recipe.id}`, async () => {
    const data = await api.post<{
      job: AssistantJob;
      version: AssistantJobVersion;
    }>("/assistant/jobs", {
      recipeId: recipe.id,
      status: recipe.state === "ready" ? "active" : undefined,
    });

    selectedJobId.value = null;
    selectedDetail.value = null;
    detailModalOpen.value = false;
    await loadJobs();
    toastSuccess(
      data.job.status === "needs_setup"
        ? "Saved. It needs setup before it can run."
        : "Job added.",
    );
  });
}

async function runJob(job: AssistantJob) {
  await withBusy(`run:${job.id}`, async () => {
    const response = await api.post<AssistantJobRunNowResponse>(
      `/assistant/jobs/${encodeURIComponent(job.id)}/run`,
    );
    await loadJobs();
    if (detailModalOpen.value && selectedJobId.value === job.id) {
      await openJob(job.id);
    }
    const status = response.run?.status;
    toastSuccess(
      job.recipeId === "weekly-review" && status === "succeeded"
        ? "Weekly task review created."
        : status === "waiting_for_approval"
          ? "Run is waiting for approval."
          : status === "blocked" || status === "failed"
            ? "Run could not complete."
            : "Run complete.",
    );
  });
}

function missionReviewTaskPath(task: AssistantJobReviewTask) {
  const params = new URLSearchParams({ task: task.id });
  if (task.projectId) params.set("project", task.projectId);
  return `/tasks?${params.toString()}`;
}

function openLatestReviewTask(task: AssistantJobReviewTask) {
  closeDetailModal();
  closeConfigureJobsModal();
  void router.push(missionReviewTaskPath(task));
}

async function toggleJob(job: AssistantJob) {
  const endpoint = job.status === "active" ? "pause" : "resume";
  await withBusy(`${endpoint}:${job.id}`, async () => {
    const data = await api.post<{ job: AssistantJob }>(
      `/assistant/jobs/${encodeURIComponent(job.id)}/${endpoint}`,
    );
    jobs.value = jobs.value.map((item) =>
      item.id === job.id ? data.job : item,
    );
    if (detailModalOpen.value && selectedJobId.value === job.id) {
      await openJob(job.id);
    }
    toastSuccess(endpoint === "pause" ? "Job paused." : "Job resumed.");
  });
}

async function duplicateJob(job: AssistantJob) {
  await withBusy(`duplicate:${job.id}`, async () => {
    const data = await api.post<{ job: AssistantJob }>(
      `/assistant/jobs/${encodeURIComponent(job.id)}/duplicate`,
    );
    selectedJobId.value = data.job.id;
    await loadJobs();
    await openJob(data.job.id);
    toastSuccess("Draft copy created.");
  });
}

async function archiveJob(job: AssistantJob) {
  if (!canArchiveJob(job)) return;
  const confirmed = window.confirm(
    `Remove "${job.name}"? Results and run history stay in Assistant activity.`,
  );
  if (!confirmed) return;

  await withBusy(`archive:${job.id}`, async () => {
    await api.delete(`/assistant/jobs/${encodeURIComponent(job.id)}`);
    jobs.value = jobs.value.filter((item) => item.id !== job.id);
    if (selectedJobId.value === job.id) {
      closeDetailModal();
    }
    toastSuccess("Job removed.");
  });
}

function canArchiveJob(job: AssistantJob) {
  return !job.recipeId || !protectedJobRecipeIds.has(job.recipeId);
}

async function saveDailyBriefingTemplate() {
  const job = selectedDetail.value?.job;
  if (
    !job ||
    !selectedJobIsDailyBriefing.value ||
    !dailyBriefingTemplateChanged.value
  )
    return;

  await withBusy(`briefing-template:${job.id}`, async () => {
    const response = await api.patch<{ job: AssistantJob }>(
      `/assistant/jobs/${encodeURIComponent(job.id)}`,
      {
        dailyBriefingMessageTemplate:
          dailyBriefingTemplateDraft.value.trim() ||
          defaultDailyBriefingTemplate,
      },
    );
    jobs.value = jobs.value.map((item) =>
      item.id === job.id ? response.job : item,
    );
    await openJob(job.id);
    dailyBriefingTemplateNotice.value = "Message saved.";
  });
}

async function saveJobSchedule() {
  const job = selectedDetail.value?.job;
  const trigger = selectedScheduleTrigger.value;
  if (
    !job ||
    !trigger ||
    !scheduleDraftChanged.value ||
    !scheduleTimeValid.value
  )
    return;

  await withBusy(`schedule:${job.id}`, async () => {
    const response = await api.patch<{ job: AssistantJob }>(
      `/assistant/jobs/${encodeURIComponent(job.id)}`,
      {
        schedule: {
          cadence: scheduleCadenceDraft.value,
          localTime: scheduleTimeDraft.value,
          timezone: trigger.timezone || "owner",
          dayOfWeek:
            scheduleCadenceDraft.value === "weekly"
              ? scheduleDayOfWeekDraft.value
              : null,
          dayOfMonth:
            scheduleCadenceDraft.value === "monthly"
              ? scheduleDayOfMonthDraft.value
              : null,
        },
      },
    );
    jobs.value = jobs.value.map((item) =>
      item.id === job.id ? response.job : item,
    );
    await openJob(job.id);
    scheduleNotice.value = "Schedule saved.";
    scheduleInlineEditing.value = false;
  });
}

function openScheduleInlineEdit() {
  if (!selectedScheduleTrigger.value) return;
  loadScheduleDraftFromDetail();
  scheduleNotice.value = "";
  scheduleInlineEditing.value = true;
}

function cancelScheduleInlineEdit() {
  loadScheduleDraftFromDetail();
  scheduleNotice.value = "";
  scheduleInlineEditing.value = false;
}

async function saveInboxWatchRules() {
  const job = selectedDetail.value?.job;
  if (!job || !selectedJobIsInboxWatch.value || !inboxWatchRulesChanged.value)
    return;

  await withBusy(`inbox-watch-rules:${job.id}`, async () => {
    const response = await api.patch<{ job: AssistantJob }>(
      `/assistant/jobs/${encodeURIComponent(job.id)}`,
      {
        inboxWatchRules: buildInboxWatchRulePayload(inboxWatchRulesDraft.value),
      },
    );
    jobs.value = jobs.value.map((item) =>
      item.id === job.id ? response.job : item,
    );
    await openJob(job.id);
    inboxWatchRulesNotice.value = "Rules saved.";
  });
}

function addInboxWatchRule() {
  inboxWatchRulesDraft.value = [
    ...inboxWatchRulesDraft.value,
    defaultInboxWatchRuleForm(),
  ];
  inboxWatchRulesNotice.value = "";
}

function removeInboxWatchRule(ruleId: string) {
  if (inboxWatchRulesDraft.value.length <= 1) return;
  inboxWatchRulesDraft.value = inboxWatchRulesDraft.value.filter(
    (rule) => rule.id !== ruleId,
  );
  inboxWatchRulesNotice.value = "";
}

function resetDailyBriefingTemplate() {
  dailyBriefingTemplateDraft.value = defaultDailyBriefingTemplate;
  dailyBriefingTemplateNotice.value = "";
}

function insertDailyBriefingVariable(value: string) {
  const separator =
    dailyBriefingTemplateDraft.value &&
    !dailyBriefingTemplateDraft.value.endsWith(" ")
      ? " "
      : "";
  dailyBriefingTemplateDraft.value = `${dailyBriefingTemplateDraft.value}${separator}${value}`;
  dailyBriefingTemplateNotice.value = "";
}

function openConfigureJobsModal() {
  assistantHistoryDrawerOpen.value = false;
  configureJobsModalOpen.value = true;
}

function closeConfigureJobsModal() {
  if (detailModalOpen.value) {
    closeDetailModal();
  }
  configureJobsModalOpen.value = false;
}

function closeDetailModal() {
  detailModalOpen.value = false;
  selectedJobId.value = null;
  selectedDetail.value = null;
  dailyBriefingTemplateNotice.value = "";
  scheduleNotice.value = "";
  scheduleInlineEditing.value = false;
  inboxWatchRulesNotice.value = "";
  inboxWatchRulesDraft.value = [];
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (assistantSettingsModalOpen.value) {
    closeAssistantSettingsModal();
    return;
  }
  if (detailModalOpen.value) {
    if (scheduleInlineEditing.value) {
      cancelScheduleInlineEdit();
      return;
    }
    closeDetailModal();
    return;
  }
  if (configureJobsModalOpen.value) {
    closeConfigureJobsModal();
  }
}

async function withBusy(key: string, action: () => Promise<void>) {
  setBusy(key, true);
  try {
    await action();
  } catch (err) {
    toastFromUnknown(err, "That did not work.");
  } finally {
    setBusy(key, false);
  }
}

function setBusy(key: string, busy: boolean) {
  const next = new Set(busyKeys.value);
  if (busy) {
    next.add(key);
  } else {
    next.delete(key);
  }
  busyKeys.value = next;
}

function isBusy(key: string) {
  return busyKeys.value.has(key);
}

function statusSortRank(status: AssistantJobStatus) {
  const rank: Record<AssistantJobStatus, number> = {
    needs_setup: 0,
    failing: 1,
    draft: 2,
    active: 3,
    paused: 4,
    archived: 5,
  };
  return rank[status] ?? 99;
}

function statusLabel(status: AssistantJobStatus) {
  const labels: Record<AssistantJobStatus, string> = {
    active: "Active",
    paused: "Paused",
    draft: "Draft",
    needs_setup: "Needs setup",
    failing: "Needs attention",
    archived: "Archived",
  };
  return labels[status] || status;
}

function runStatusLabel(status: AssistantJobRunStatus | null) {
  if (!status) return "No runs yet";
  const labels: Record<AssistantJobRunStatus, string> = {
    queued: "Queued",
    running: "Running",
    waiting_for_approval: "Needs you",
    succeeded: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
    blocked: "Blocked",
  };
  return labels[status] || status;
}

function canCreateRecipe(recipe: AssistantJobRecipe) {
  return recipe.state !== "coming_later";
}

function canRun(job: AssistantJob) {
  return (
    job.status === "active" && job.recipeId !== bookingReminderSystemRecipeId
  );
}

function canToggle(job: AssistantJob) {
  return (
    job.status === "active" || job.status === "paused" || job.status === "draft"
  );
}

function toggleLabel(job: AssistantJob) {
  if (job.status === "active") return "Pause";
  if (job.status === "draft") return "Start";
  return "Resume";
}

function toggleIcon(job: AssistantJob) {
  if (job.status === "active") return "Pause";
  if (job.status === "draft") return "Power";
  return "Play";
}

function toggleBusyKey(job: AssistantJob) {
  return `${job.status === "active" ? "pause" : "resume"}:${job.id}`;
}

const jobNavEmojis: Record<string, string> = {
  "daily-briefing": "☀️",
  "weekly-review": "📊",
  "booking-reminder": "⏰",
  "email-triage": "📧",
  "invoice-receipt-triage": "🧾",
};

function recipeNavEmoji(recipeId: string) {
  return jobNavEmojis[recipeId] || "⚡";
}

function jobNavEmoji(job: AssistantJob) {
  return recipeNavEmoji(job.recipeId || "");
}

function isJobEnabled(job: AssistantJob) {
  return job.status === "active";
}

function isJobToggleBusy(job: AssistantJob) {
  return isBusy(toggleBusyKey(job));
}

async function handleJobToggle(job: AssistantJob, enabled: boolean) {
  if (
    enabled === isJobEnabled(job) ||
    !canToggle(job) ||
    isJobToggleBusy(job)
  ) {
    return;
  }
  await toggleJob(job);
}

async function handleRecipeToggle(
  recipe: AssistantJobRecipe,
  enabled: boolean,
) {
  if (!enabled || !canCreateRecipe(recipe) || isBusy(`recipe:${recipe.id}`)) {
    return;
  }
  await createStarterJob(recipe);
}

function isRecipeToggleBusy(recipe: AssistantJobRecipe) {
  return isBusy(`recipe:${recipe.id}`);
}

function bookingRemindersSystemEnabled(row: BookingRemindersRow) {
  return row.job?.status !== "paused";
}

function bookingRemindersSystemStatus(row: BookingRemindersRow) {
  return bookingRemindersSystemEnabled(row) ? "Active" : "Paused";
}

async function handleBookingRemindersToggle(
  row: BookingRemindersRow,
  enabled: boolean,
) {
  if (enabled === bookingRemindersSystemEnabled(row)) return;

  await withBusy("booking-reminders", async () => {
    if (!row.job) {
      await api.post("/assistant/jobs", {
        recipeId: bookingReminderSystemRecipeId,
        status: "paused",
      });
    } else {
      await api.post(
        `/assistant/jobs/${encodeURIComponent(row.job.id)}/${
          enabled ? "resume" : "pause"
        }`,
      );
    }
    await loadJobs();
    toastSuccess(
      enabled ? "Booking reminders resumed." : "Booking reminders paused.",
    );
  });
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function loadInboxWatchRulesDraftFromDetail() {
  inboxWatchRulesNotice.value = "";
  inboxWatchRulesDraft.value = inboxWatchRuleFormsFromRules(
    selectedDetail.value?.version?.rules || [],
  );
}

function inboxWatchRuleFormsFromRules(
  rules: AssistantJobRule[],
): InboxWatchRuleForm[] {
  const forms = rules
    .map((rule) => inboxWatchRuleFormFromRule(rule))
    .filter((rule): rule is InboxWatchRuleForm => Boolean(rule));
  return forms.length
    ? forms
    : [defaultInboxWatchRuleForm("any-inbox-message")];
}

function inboxWatchRuleFormFromRule(
  rule: AssistantJobRule,
): InboxWatchRuleForm | null {
  const value = isRecord(rule.value) ? rule.value : {};
  const match = isRecord(value.match) ? value.match : {};
  const actions = isRecord(value.actions) ? value.actions : {};
  return {
    id: rule.id || crypto.randomUUID(),
    label: rule.label || "Inbox Watch rule",
    enabled: value.enabled !== false,
    timing: normalizeInboxWatchTiming(value.timing),
    from:
      listToLines(match.from) ||
      listToLines([
        ...listFromUnknown(match.fromAddresses),
        ...listFromUnknown(match.fromDomains),
      ]),
    contains:
      listToLines(match.textContains) ||
      listToLines([
        ...listFromUnknown(match.subjectContains),
        ...listFromUnknown(match.bodyContains),
      ]),
    inferredLabels: normalizeInboxWatchLabels(match.inferredLabels),
    notifyOwner: actions.notifyOwner === true,
    summarizeAndLabel: actions.summarizeAndLabel !== false,
    draftReply: actions.draftReply === true,
    createTask: actions.createTask === true,
  };
}

function defaultInboxWatchRuleForm(
  id: string = crypto.randomUUID(),
): InboxWatchRuleForm {
  return {
    id,
    label: "Any inbox email",
    enabled: true,
    timing: "daily_digest",
    from: "",
    contains: "",
    inferredLabels: [],
    notifyOwner: false,
    summarizeAndLabel: true,
    draftReply: false,
    createTask: false,
  };
}

function buildInboxWatchRulePayload(
  rules: InboxWatchRuleForm[],
): AssistantJobRule[] {
  return rules.map((rule) => ({
    id: rule.id,
    label: rule.label.trim() || "Inbox Watch rule",
    field: "inbox_watch.rule",
    operator: "matches",
    value: {
      enabled: rule.enabled,
      timing: rule.timing,
      match: {
        from: linesToList(rule.from),
        textContains: linesToList(rule.contains),
        inferredLabels: rule.inferredLabels,
      },
      actions: {
        notifyOwner: rule.notifyOwner,
        summarizeAndLabel: rule.summarizeAndLabel,
        draftReply: rule.draftReply,
        createTask: rule.createTask,
      },
    },
  }));
}

function listToLines(value: unknown) {
  return listFromUnknown(value)
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function listFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function linesToList(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeInboxWatchTiming(value: unknown): InboxWatchTiming {
  return value === "immediate" ||
    value === "daily_digest" ||
    value === "weekly_digest" ||
    value === "manual"
    ? value
    : "daily_digest";
}

function normalizeInboxWatchLabels(value: unknown): InboxWatchInferredLabel[] {
  const allowed = new Set<InboxWatchInferredLabel>([
    "needs_reply",
    "important",
    "finance",
    "scheduling",
    "review",
  ]);
  return Array.isArray(value)
    ? value.filter((item): item is InboxWatchInferredLabel => allowed.has(item))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadScheduleDraftFromDetail() {
  const trigger = selectedScheduleTrigger.value;
  if (!trigger) return;
  scheduleCadenceDraft.value =
    trigger.cadence === "custom" ? "daily" : trigger.cadence;
  scheduleTimeDraft.value = trigger.localTime || "08:00";
  scheduleDayOfWeekDraft.value = trigger.dayOfWeek ?? 1;
  scheduleDayOfMonthDraft.value = parseMonthlyDayOfMonth(trigger.rrule) || 1;
}

function isScheduleTrigger(
  value: unknown,
): value is Extract<AssistantJobTrigger, { kind: "schedule" }> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "schedule"
  );
}

function parseMonthlyDayOfMonth(rrule: string | null | undefined) {
  const match = rrule?.match(/(?:^|;)BYMONTHDAY=(\d{1,2})(?:;|$)/i);
  if (!match?.[1]) return null;
  const day = Number.parseInt(match[1], 10);
  return Number.isInteger(day) && day >= 1 && day <= 28 ? day : null;
}

function formatNextRun(job: AssistantJob) {
  if (job.status !== "active") return "-";
  if (job.nextRunAt) return formatDate(job.nextRunAt);
  if (/^when/i.test(job.triggerSummary)) return "When it happens";
  if (/daily|weekly|monthly/i.test(job.triggerSummary)) return "Scheduled";
  return "-";
}

function formatTrigger(summary: string) {
  const value = String(summary || "").trim();
  if (!value || value === "Manual") return "When you run it";
  if (/^Daily at /i.test(value)) return value.replace(/^Daily/i, "Every day");
  if (/^Weekly on .+ at /i.test(value))
    return value.replace(/^Weekly/i, "Every week");
  if (/^Weekly at /i.test(value))
    return value.replace(/^Weekly/i, "Every week");
  if (/^Monthly on day /i.test(value))
    return value.replace(/^Monthly/i, "Every month");
  if (value.includes("email.message.received"))
    return "When matching email arrives";
  if (value.includes("site.booking.confirmed"))
    return bookingReminderSystemRuns;
  if (value.includes("calendar.event.upcoming"))
    return "Before matching calendar events";
  if (value.includes("review_packet.created"))
    return "When Assistant results change";
  if (/^When .+ happens$/i.test(value)) return "When something matches";
  return value;
}

function formatDestination(detail: AssistantJobDetail | null) {
  const landing = detail?.job.destination?.landing;
  if (landing === "task") return "Tasks";
  if (landing === "approval") return "Approvals";
  if (landing === "memory_review") return "Memory review";
  if (landing === "activity") return "Assistant activity";
  if (landing === "accounts") return "Accounts ledger";
  return "Assistant results";
}

function setupErrorForJob(job: AssistantJob) {
  const error = job.setupState?.errors?.find((entry) => entry.message)?.message;
  return error ? cleanPlainText(error) : "";
}

function isAccountsSetupMissing(job: AssistantJob) {
  return /^Missing setup requirement:\s*accounts\.?$/i.test(
    setupErrorForJob(job),
  );
}

function setupMessageForJob(job: AssistantJob) {
  const error = setupErrorForJob(job);
  if (!error) return "Setup is needed before this job can run.";
  return error
    .replace(
      /^Missing setup requirement:\s*email\.?$/i,
      "Email setup is needed.",
    )
    .replace(
      /^Missing setup requirement:\s*calendar\.?$/i,
      "Calendar setup is needed.",
    )
    .replace(
      /^Missing setup requirement:\s*owner_notifications\.?$/i,
      "Connect Soulink in account settings.",
    )
    .replace(
      /^Missing setup requirement:\s*local_executor\.?$/i,
      "Local Executor setup is needed.",
    );
}

function cleanPlainText(value: string) {
  return String(value || "")
    .replace(/Mission Control review packets?/gi, "Assistant results")
    .replace(/Mission Control/gi, "Tasks and Projects")
    .replace(/review packets?/gi, "results")
    .replace(/durable private memory/gi, "saved memory")
    .replace(/\s+/g, " ")
    .trim();
}

function assistantMemoryKindLabel(kind: string) {
  return kind
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function assistantMemoryStatusLabel(status: MissionMemory["reviewStatus"]) {
  if (status === "needs_review") return "Needs review";
  if (status === "archived") return "Archived";
  return "Active";
}

function assistantMemorySourceLabel(item: MissionMemory) {
  if (item.sourceKind === "agent") {
    return item.sourceRef
      ? `Assistant suggestion: ${item.sourceRef}`
      : "Assistant suggestion";
  }
  if (item.sourceKind === "daemon")
    return item.sourceRef ? `Local runner: ${item.sourceRef}` : "Local runner";
  if (item.sourceKind === "import")
    return item.sourceRef ? `Import: ${item.sourceRef}` : "Import";
  return item.sourceRef ? `Manual: ${item.sourceRef}` : "Manual";
}

function assistantMemoryScopeLabel(item: MissionMemory) {
  return item.scopeId
    ? `${assistantMemoryKindLabel(item.scopeKind)}: ${item.scopeId}`
    : assistantMemoryKindLabel(item.scopeKind);
}

function assistantSourceKindLabel(kind: string) {
  const labels: Record<string, string> = {
    mission_statement: "Mission statement",
    wheel_of_life: "Wheel of Life",
    public_me_json: "Public profile",
    private_memory: "Private memory",
    core_table: "ME3 data",
    plugin_table: "Plugin data",
    daemon_directory: "Local directory",
    daemon_repo: "Local repository",
    provider: "Provider",
    upload: "Upload",
    url: "URL",
  };
  return labels[kind] || assistantMemoryKindLabel(kind);
}

function assistantSourcePriority(
  source: Pick<MissionContextSource, "sourceKind">,
) {
  if (source.sourceKind === "mission_statement") return 1;
  if (source.sourceKind === "wheel_of_life") return 2;
  if (source.sourceKind === "public_me_json") return 3;
  if (source.sourceKind === "private_memory") return 4;
  return 5;
}

function isDefaultAssistantSource(
  source: Pick<MissionContextSource, "sourceKind">,
) {
  return (
    source.sourceKind === "mission_statement" ||
    source.sourceKind === "wheel_of_life" ||
    source.sourceKind === "public_me_json" ||
    source.sourceKind === "private_memory"
  );
}

function assistantSourceStatusLabel(status: MissionContextSource["status"]) {
  if (status === "setup_required") return "Missing";
  return assistantMemoryKindLabel(status);
}

function formatAssistantSettingsDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function jobDetailPurpose(job: AssistantJob) {
  if (job.recipeId === "daily-briefing") {
    return "Sends a customised message to your Assistant or Soulink when connected.";
  }
  return cleanPlainText(job.purpose);
}

function renderDailyBriefingPreview(template: string) {
  const values: Record<string, string> = {
    "owner.name": "Kieran Butler",
    "today.date": "Monday 1 June",
    "calendar.summary": "You have 1 calendar event for Monday 1 June.",
    "calendar.events": "Calendar:\n- 10:00 Booking with Ada Lovelace",
    "calendar.reminders":
      "Reminders: 1 due today.\n- 10:00 Follow up with Bilbo Baggins",
    "mission.tasks":
      "Tasks: 1 task due today.\n- Review launch notes",
  };
  return template
    .replace(
      /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
      (_match, key: string) => values[key] ?? "",
    )
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function messageFromUnknown(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();
  return fallback;
}
</script>

<template>
  <div
    class="assistant-page"
    :class="{
      'assistant-page--history-collapsed': assistantHistoryCollapsed,
      'assistant-page--history-open': assistantHistoryDrawerOpen,
      'assistant-page--site-builder': siteBuilderMode,
    }"
  >
    <LandingGrids />
    <button
      v-if="!siteBuilderMode && assistantHistoryDrawerOpen"
      type="button"
      class="assistant-history-backdrop"
      aria-label="Close chat history"
      @click="assistantHistoryDrawerOpen = false"
    />
    <Teleport
      v-if="!siteBuilderMode && !assistantHistoryDrawerOpen"
      to="#app-side-nav-mobile-page-controls"
      defer
    >
      <div class="assistant-mobile-nav">
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          class="assistant-mobile-nav__button"
          aria-label="Open chat history"
          title="Open chat history"
          type="button"
          @click="assistantHistoryDrawerOpen = true"
        >
          <UiIcon name="MessagesSquare" :size="18" aria-hidden="true" />
        </Button>
        <div class="assistant-mobile-nav__actions">
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            class="assistant-mobile-nav__button"
            aria-label="New chat"
            title="New chat"
            type="button"
            @click="startNewAssistantChat(null)"
          >
            <UiIcon name="Plus" :size="18" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </Teleport>
    <div
      v-if="!siteBuilderMode"
      class="assistant-page-tools"
      aria-label="Assistant tools"
    >
      <Button
        color="ghost"
        shape="soft"
        size="compact"
        icon-only
        type="button"
        aria-label="New chat"
        title="New chat"
        @click="startNewAssistantChat(null)"
      >
        <UiIcon name="Plus" :size="18" aria-hidden="true" />
      </Button>
    </div>
    <aside
      v-if="!siteBuilderMode"
      class="assistant-history"
      :class="{
        'assistant-history--collapsed': assistantHistoryCollapsed,
        'assistant-history--open': assistantHistoryDrawerOpen,
      }"
      aria-label="Assistant chat history"
    >
      <header class="assistant-history__header">
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          class="assistant-history__collapse"
          :aria-label="
            assistantHistoryCollapsed
              ? 'Expand chat history'
              : 'Collapse chat history'
          "
          :title="
            assistantHistoryCollapsed
              ? 'Expand chat history'
              : 'Collapse chat history'
          "
          type="button"
          @click="toggleAssistantHistoryCollapsed"
        >
          <UiIcon
            :name="assistantHistoryCollapsed ? 'ChevronRight' : 'ChevronLeft'"
            :size="16"
            aria-hidden="true"
          />
        </Button>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          class="assistant-history__close"
          aria-label="Close chat history"
          title="Close"
          type="button"
          @click="assistantHistoryDrawerOpen = false"
        >
          <UiIcon name="X" :size="16" aria-hidden="true" />
        </Button>
      </header>

      <div v-if="!assistantHistoryCollapsed" class="assistant-history__body">
        <nav class="assistant-history__topnav" aria-label="Assistant tools">
          <button
            type="button"
            class="assistant-history__nav-row"
            @click="openConfigureJobsModal"
          >
            <UiIcon name="BriefcaseBusiness" :size="15" aria-hidden="true" />
            <span>Jobs</span>
          </button>
        </nav>

        <p v-if="assistantThreadsError" class="assistant-history__message">
          {{ assistantThreadsError }}
        </p>
        <p
          v-else-if="assistantProjectsError"
          class="assistant-history__message"
        >
          {{ assistantProjectsError }}
        </p>
        <section class="assistant-history__section">
          <div
            v-if="assistantProjectsLoading && assistantProjects.length === 0"
            class="assistant-history__message"
          >
            Loading projects...
          </div>
          <div
            v-for="group in assistantProjectThreadGroups"
            :key="group.project.id"
            class="assistant-history__project-group"
          >
            <button
              type="button"
              class="assistant-history__project-row"
              :class="{
                'is-active':
                  routeProjectId() === group.project.id && !assistantThreadId,
              }"
              :aria-expanded="assistantProjectExpanded(group.project.id)"
              :aria-controls="`assistant-project-${group.project.id}-chats`"
              @click="toggleAssistantProject(group.project.id)"
            >
              <UiIcon
                :name="
                  assistantProjectExpanded(group.project.id)
                    ? 'ChevronDown'
                    : 'ChevronRight'
                "
                :size="14"
                aria-hidden="true"
              />
              <UiIcon name="Folder" :size="15" aria-hidden="true" />
              <span>{{ group.project.name }}</span>
            </button>
            <button
              type="button"
              class="assistant-history__project-add"
              :aria-label="`Start a new chat in ${group.project.name}`"
              :title="`Start a new chat in ${group.project.name}`"
              @click="startNewAssistantChat(group.project.id)"
            >
              <UiIcon name="Plus" :size="14" aria-hidden="true" />
            </button>
            <nav
              v-if="
                group.threads.length &&
                assistantProjectExpanded(group.project.id)
              "
              :id="`assistant-project-${group.project.id}-chats`"
              class="assistant-history__list assistant-history__list--nested"
              :aria-label="`${group.project.name} chats`"
            >
              <div
                v-for="thread in group.threads"
                :key="thread.id"
                class="assistant-history__thread-row"
                :class="{ 'is-active': assistantThreadId === thread.id }"
              >
                <button
                  type="button"
                  class="assistant-history__thread"
                  :aria-current="
                    assistantThreadId === thread.id ? 'page' : undefined
                  "
                  @click="selectAssistantThread(thread.id)"
                >
                  <span class="assistant-history__thread-main">
                    <span class="assistant-history__thread-title">
                      {{ threadTitle(thread) }}
                    </span>
                    <span class="assistant-history__thread-meta">
                      {{
                        formatAssistantThreadTime(
                          thread.lastMessageAt || thread.updatedAt,
                        )
                      }}
                    </span>
                  </span>
                </button>
                <div
                  class="assistant-history__thread-actions"
                  aria-label="Chat controls"
                >
                  <button
                    type="button"
                    title="Archive chat"
                    aria-label="Archive chat"
                    :disabled="assistantThreadActionId === thread.id"
                    @click="archiveAssistantThread(thread)"
                  >
                    <UiIcon name="Archive" :size="14" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </nav>
          </div>
        </section>

        <section class="assistant-history__section">
          <button
            type="button"
            class="assistant-history__section-toggle"
            :aria-expanded="!assistantChatsCollapsed"
            aria-controls="assistant-ungrouped-chats"
            @click="assistantChatsCollapsed = !assistantChatsCollapsed"
          >
            <UiIcon
              :name="assistantChatsCollapsed ? 'ChevronRight' : 'ChevronDown'"
              :size="14"
              aria-hidden="true"
            />
            <span>Chats</span>
          </button>
          <nav
            v-if="!assistantChatsCollapsed"
            id="assistant-ungrouped-chats"
            class="assistant-history__list"
            aria-label="Chats outside projects"
          >
            <p
              v-if="assistantThreadsLoading && assistantThreads.length === 0"
              class="assistant-history__message"
            >
              Loading chats...
            </p>
            <div
              v-for="thread in assistantUngroupedThreads"
              :key="thread.id"
              class="assistant-history__thread-row"
              :class="{ 'is-active': assistantThreadId === thread.id }"
            >
              <button
                type="button"
                class="assistant-history__thread"
                :aria-current="
                  assistantThreadId === thread.id ? 'page' : undefined
                "
                @click="selectAssistantThread(thread.id)"
              >
                <span class="assistant-history__thread-main">
                  <span class="assistant-history__thread-title">
                    {{ threadTitle(thread) }}
                  </span>
                  <span class="assistant-history__thread-meta">
                    {{
                      formatAssistantThreadTime(
                        thread.lastMessageAt || thread.updatedAt,
                      )
                    }}
                  </span>
                </span>
              </button>
              <div
                class="assistant-history__thread-actions"
                aria-label="Chat controls"
              >
                <button
                  type="button"
                  title="Archive chat"
                  aria-label="Archive chat"
                  :disabled="assistantThreadActionId === thread.id"
                  @click="archiveAssistantThread(thread)"
                >
                  <UiIcon name="Archive" :size="14" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p
              v-if="assistantThreadListEmpty"
              class="assistant-history__message"
            >
              No saved chats yet.
            </p>
            <p
              v-else-if="
                !assistantThreadsLoading &&
                assistantUngroupedThreads.length === 0
              "
              class="assistant-history__message"
            >
              No chats outside projects.
            </p>
          </nav>
        </section>

        <div class="assistant-history__footer">
          <button
            type="button"
            class="assistant-history__footer-icon"
            aria-label="Archived chats"
            title="Archived chats"
            @click="openArchivedThreadsModal"
          >
            <UiIcon name="Archive" :size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="assistant-history__footer-icon"
            aria-label="Assistant settings"
            title="Assistant settings"
            @click="openAssistantSettings('context')"
          >
            <UiIcon name="Brain" :size="18" aria-hidden="true" />
          </button>
          <span class="assistant-history__footer-spacer" aria-hidden="true" />
          <button
            type="button"
            class="assistant-history__footer-chat"
            aria-label="New chat"
            title="New chat"
            @click="startNewAssistantChat(null)"
          >
            <UiIcon name="Plus" :size="18" aria-hidden="true" />
            <span>Chat</span>
          </button>
        </div>
      </div>
    </aside>

    <div
      class="assistant-workspace"
      :class="{ 'assistant-workspace--site-builder': siteBuilderMode }"
    >
    <main class="assistant-main" aria-label="Assistant console">
      <section v-if="pageError" class="notice notice--error" role="alert">
        {{ pageError }}
      </section>

      <section class="assistant-console" aria-label="Assistant conversation">
        <header v-if="!siteBuilderMode" class="home-chat-header">
          <div class="home-chat-switcher" role="group" aria-label="Workspace view">
            <button type="button" :aria-pressed="homeMode" @click="showWorkspace(true)">Home</button>
            <button type="button" :aria-pressed="!homeMode" @click="showWorkspace(false)">Chat</button>
          </div>
          <RouterLink to="/account" class="home-profile" aria-label="Your account">{{ (homeAuth.user?.name || 'ME3').slice(0, 1).toUpperCase() }}</RouterLink>
        </header>
        <HomePanels v-if="homeMode && !siteBuilderMode" class="assistant-home" @suggest="homeSuggestion" @approval-resolved="refreshAssistantAfterApproval" />
        <div
          v-show="!homeMode || siteBuilderMode"
          ref="assistantScrollerRef"
          class="assistant-timeline"
          aria-live="polite"
        >
          <PageLoading
            v-if="
              assistantThreadLoading && assistantConsoleMessages.length === 0
            "
            label="Loading chat..."
          />

          <div
            v-else-if="assistantConsoleMessages.length === 0"
            class="assistant-empty-state"
          >
            <h2
              class="assistant-empty-state__heading"
              :aria-label="assistantMessageLabel"
            >
              <img
                class="assistant-empty-state__avatar"
                :src="ASSISTANT_AVATAR_SRC"
                alt=""
                aria-hidden="true"
              />
            </h2>
            <div
              v-if="visibleStarterPrompts.length"
              class="starter-prompt-list"
              aria-label="Starter prompts"
            >
              <button
                v-for="prompt in visibleStarterPrompts"
                :key="prompt.label"
                type="button"
                class="starter-prompt"
                @click="startStarterPrompt(prompt)"
              >
                <span class="starter-prompt__icon" aria-hidden="true">
                  {{ prompt.icon }}
                </span>
                <span>{{ prompt.label }}</span>
              </button>
            </div>
          </div>

          <article
            v-for="(message, index) in assistantConsoleMessages"
            :key="
              message.id ||
              `${message.role}-${index}-${message.text.slice(0, 24)}`
            "
            class="assistant-message"
            :class="`assistant-message--${message.role}`"
            :data-assistant-message-id="message.id || undefined"
          >
            <div class="assistant-message__bubble">
              <div
                v-if="message.attachments?.length"
                class="assistant-message-attachments"
                aria-label="Message attachments"
              >
                <template
                  v-for="attachment in message.attachments"
                  :key="attachment.id || attachment.name || 'attachment'"
                >
                  <figure
                    v-if="
                      attachment.kind === 'image' &&
                      assistantAttachmentContentUrl(attachment)
                    "
                    class="assistant-message-attachment-image"
                  >
                    <a
                      class="assistant-message-attachment-image__preview"
                      :href="assistantAttachmentContentUrl(attachment)"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        :src="assistantAttachmentContentUrl(attachment)"
                        :alt="attachment.name || 'Attached image'"
                        loading="lazy"
                      />
                    </a>
                    <figcaption
                      class="assistant-message-attachment-image__caption"
                    >
                      <span>{{ attachment.name || "Attached image" }}</span>
                      <span v-if="typeof attachment.size === 'number'">
                        {{ formatFileSize(attachment.size) }}
                      </span>
                    </figcaption>
                  </figure>
                  <span
                    v-else
                    class="assistant-message-attachment"
                    :title="
                      [
                        attachment.name || 'Attachment',
                        attachment.mimeType || '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    "
                  >
                    <UiIcon name="FileText" :size="14" aria-hidden="true" />
                    <span class="assistant-message-attachment__name">
                      {{ attachment.name || "Attachment" }}
                    </span>
                    <span
                      v-if="typeof attachment.size === 'number'"
                      class="assistant-message-attachment__meta"
                    >
                      {{ formatFileSize(attachment.size) }}
                    </span>
                  </span>
                </template>
              </div>
              <div
                v-if="assistantMessageDisplayText(message)"
                class="assistant-message__content"
                v-html="renderAssistantMarkdown(assistantMessageDisplayText(message))"
              ></div>
              <div
                v-if="message.imageAction?.assets?.length"
                class="assistant-image-assets"
              >
                <figure
                  v-for="asset in message.imageAction.assets"
                  :key="asset.attachmentId || asset.id"
                  class="assistant-image-asset"
                >
                  <a
                    class="assistant-image-asset__preview"
                    :href="asset.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      :src="asset.url"
                      :alt="asset.name || 'Generated assistant image'"
                      loading="lazy"
                    />
                  </a>
                  <figcaption class="assistant-image-asset__caption">
                    <span>{{ asset.name || "Generated image" }}</span>
                    <span>{{ formatFileSize(asset.size) }}</span>
                  </figcaption>
                  <div class="assistant-image-asset__actions">
                    <a
                      :href="asset.url"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open
                    </a>
                    <a :href="asset.url" :download="asset.name || 'generated-image'">
                      Download
                    </a>
                  </div>
                </figure>
                <details
                  v-if="message.imageAction.revisedPrompt"
                  class="assistant-image-assets__details"
                >
                  <summary>Revised prompt</summary>
                  <p>{{ message.imageAction.revisedPrompt }}</p>
                </details>
              </div>
              <p v-if="message.meta" class="assistant-message__meta">
                {{ message.meta }}
              </p>
              <p v-if="message.detail" class="assistant-message__detail">
                {{ message.detail }}
              </p>
              <details
                v-if="message.trace && assistantTraceRows(message.trace).length"
                class="assistant-trace"
              >
                <summary class="assistant-trace__summary">
                  <UiIcon name="Activity" :size="14" aria-hidden="true" />
                  <span>Turn trace</span>
                </summary>
                <dl class="assistant-trace__rows">
                  <div
                    v-for="row in assistantTraceRows(message.trace)"
                    :key="`${message.id || assistantMessageKey(message, index)}:${row.label}`"
                  >
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </div>
                </dl>
              </details>
              <div
                v-if="message.jobBuilderAction?.kind === 'job_draft'"
                class="job-builder-card"
              >
                <div class="job-builder-card__header">
                  <div>
                    <h3>{{ message.jobBuilderAction.draft.name }}</h3>
                  </div>
                  <span
                    class="job-builder-card__status"
                    :class="`job-builder-card__status--${message.jobBuilderAction.validation.status}`"
                  >
                    {{
                      assistantJobStatusLabel(
                        message.jobBuilderAction.validation.status,
                      )
                    }}
                  </span>
                </div>
                <p class="job-builder-card__sentence">
                  <template
                    v-for="(
                      segment, segmentIndex
                    ) in assistantJobBuilderSentenceSegments(
                      message.jobBuilderAction,
                    )"
                    :key="`${segment.text}-${segmentIndex}`"
                  >
                    <strong v-if="segment.strong">{{ segment.text }}</strong>
                    <span v-else>{{ segment.text }}</span>
                  </template>
                </p>
                <p class="job-builder-card__tools">
                  Uses
                  {{
                    assistantJobBuilderToolPhrase(
                      message.jobBuilderAction.draft,
                    )
                  }}.
                </p>
                <ul
                  v-if="
                    message.jobBuilderAction.explanation.setupWarnings.length
                  "
                  class="job-builder-card__warnings"
                >
                  <li
                    v-for="warning in message.jobBuilderAction.explanation
                      .setupWarnings"
                    :key="warning"
                  >
                    {{ warning }}
                  </li>
                </ul>
                <div class="job-builder-card__actions">
                  <button
                    v-if="
                      message.jobBuilderAction.availableActions.includes('save')
                    "
                    type="button"
                    class="job-builder-card__button"
                    :disabled="
                      jobBuilderActionBusy(message.jobBuilderAction, 'save')
                    "
                    @click="
                      saveAssistantJobBuilderDraft(
                        message,
                        message.jobBuilderAction,
                        false,
                      )
                    "
                  >
                    <UiIcon name="Save" :size="15" aria-hidden="true" />
                    <span>Save job</span>
                  </button>
                  <button
                    v-if="
                      message.jobBuilderAction.availableActions.includes(
                        'save_and_activate',
                      )
                    "
                    type="button"
                    class="job-builder-card__button job-builder-card__button--primary"
                    :disabled="
                      jobBuilderActionBusy(
                        message.jobBuilderAction,
                        'save_and_activate',
                      )
                    "
                    @click="
                      saveAssistantJobBuilderDraft(
                        message,
                        message.jobBuilderAction,
                        true,
                      )
                    "
                  >
                    <UiIcon name="Play" :size="15" aria-hidden="true" />
                    <span>Save and activate</span>
                  </button>
                </div>
              </div>
              <div
                v-else-if="message.jobBuilderAction?.kind === 'job_saved'"
                class="job-builder-card job-builder-card--saved"
              >
                <div class="job-builder-card__header">
                  <div>
                    <h3>{{ message.text }}</h3>
                    <p>
                      Review settings, run a test, or activate it from here.
                    </p>
                  </div>
                  <span
                    class="job-builder-card__status"
                    :class="`job-builder-card__status--${message.jobBuilderAction.status}`"
                  >
                    {{
                      assistantJobStatusLabel(message.jobBuilderAction.status)
                    }}
                  </span>
                </div>
                <div class="job-builder-card__actions">
                  <button
                    v-if="
                      message.jobBuilderAction.availableActions.includes(
                        'activate',
                      )
                    "
                    type="button"
                    class="job-builder-card__button job-builder-card__button--primary"
                    :disabled="
                      jobBuilderActionBusy(message.jobBuilderAction, 'activate')
                    "
                    @click="
                      activateAssistantJobBuilderSaved(
                        message,
                        message.jobBuilderAction,
                      )
                    "
                  >
                    <UiIcon name="Play" :size="15" aria-hidden="true" />
                    <span>Activate job</span>
                  </button>
                  <button
                    v-if="
                      message.jobBuilderAction.availableActions.includes(
                        'run_now',
                      )
                    "
                    type="button"
                    class="job-builder-card__button"
                    @click="
                      runAssistantJobBuilderSaved(message.jobBuilderAction)
                    "
                  >
                    <UiIcon name="RefreshCw" :size="15" aria-hidden="true" />
                    <span>Run now</span>
                  </button>
                  <button
                    v-if="
                      message.jobBuilderAction.availableActions.includes(
                        'open_job',
                      )
                    "
                    type="button"
                    class="job-builder-card__button"
                    @click="openJob(message.jobBuilderAction.jobId)"
                  >
                    <UiIcon name="Settings" :size="15" aria-hidden="true" />
                    <span>Open job</span>
                  </button>
                </div>
              </div>
              <div
                v-if="visibleAssistantActionCards(message).length"
                class="assistant-action-card-list"
                aria-label="Assistant actions"
              >
                <article
                  v-for="card in visibleAssistantActionCards(message)"
                  :key="card.id"
                  class="assistant-action-card"
                  :class="`assistant-action-card--${card.status}`"
                >
                  <div class="assistant-action-card__header">
                    <div class="assistant-action-card__title">
                      <span
                        class="assistant-action-card__icon"
                        aria-hidden="true"
                      >
                        <UiIcon
                          :name="
                            card.kind === 'mailbox.draft_saved'
                              ? 'Mail'
                              : card.kind === 'reminder.created'
                                ? 'Bell'
                                : 'CircleCheck'
                          "
                          :size="16"
                        />
                      </span>
                      <div>
                        <h3>{{ card.title }}</h3>
                        <p v-if="card.summary">{{ card.summary }}</p>
                      </div>
                    </div>
                    <span
                      class="assistant-action-card__status"
                      :class="`assistant-action-card__status--${card.status}`"
                    >
                      {{ card.statusLabel }}
                    </span>
                  </div>
                  <dl
                    v-if="card.changed.length"
                    class="assistant-action-card__facts"
                  >
                    <div
                      v-for="field in card.changed"
                      :key="`${card.id}:${field.label}:${field.value}`"
                    >
                      <dt>{{ field.label }}</dt>
                      <dd>{{ field.value }}</dd>
                    </div>
                  </dl>
                  <div
                    v-if="
                      mailboxDraftIdForActionCard(card) ||
                      displayedAssistantPrimaryAction(card) ||
                      card.secondaryActions.length > 0
                    "
                    class="assistant-action-card__actions"
                  >
                    <button
                      v-if="mailboxDraftIdForActionCard(card)"
                      type="button"
                      class="assistant-action-card__button assistant-action-card__button--primary"
                      :disabled="assistantActionCardBusy !== null"
                      @click="sendMailboxDraftFromActionCard(card)"
                    >
                      <UiIcon name="Send" :size="15" aria-hidden="true" />
                      <span>
                        {{
                          assistantActionCardBusy ===
                          assistantActionCardBusyKey(card)
                            ? "Sending..."
                            : "Send"
                        }}
                      </span>
                    </button>
                    <a
                      v-if="displayedAssistantPrimaryAction(card)"
                      class="assistant-action-card__button"
                      :class="{
                        'assistant-action-card__button--primary':
                          !mailboxDraftIdForActionCard(card),
                      }"
                      :href="displayedAssistantPrimaryAction(card)!.href"
                      :target="displayedAssistantPrimaryAction(card)!.href.startsWith('#') ? undefined : '_blank'"
                      :rel="displayedAssistantPrimaryAction(card)!.href.startsWith('#') ? undefined : 'noopener noreferrer'"
                    >
                      <UiIcon name="ArrowRight" :size="15" aria-hidden="true" />
                      <span>{{ displayedAssistantPrimaryAction(card)!.label }}</span>
                    </a>
                    <a
                      v-for="action in card.secondaryActions"
                      :key="`${card.id}:${action.href}:${action.label}`"
                      class="assistant-action-card__button"
                      :href="action.href"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <UiIcon name="ArrowRight" :size="15" aria-hidden="true" />
                      <span>{{ action.label }}</span>
                    </a>
                  </div>
                </article>
              </div>
              <article
                v-if="message.emailDraftAction"
                class="assistant-email-draft-card"
                :class="`assistant-email-draft-card--${message.emailDraftAction.status}`"
              >
                <header class="assistant-email-draft-card__header">
                  <span class="assistant-email-draft-card__icon" aria-hidden="true">
                    <UiIcon name="Mail" :size="16" />
                  </span>
                  <div class="assistant-email-draft-card__title">
                    <h3>Email draft</h3>
                    <p>{{ message.emailDraftAction.statusLabel }}</p>
                  </div>
                </header>
                <div class="assistant-email-draft-card__fields">
                  <label class="assistant-email-draft-card__field">
                    <span>To</span>
                    <input
                      v-model.trim="message.emailDraftAction.to"
                      type="email"
                      autocomplete="email"
                      placeholder="recipient's email"
                      :disabled="message.emailDraftAction.busy !== null"
                      @input="
                        touchAgentChatEmailDraftAction(
                          message.emailDraftAction,
                        )
                      "
                    />
                  </label>
                  <label class="assistant-email-draft-card__field">
                    <span>Subject</span>
                    <input
                      v-model="message.emailDraftAction.subject"
                      type="text"
                      :disabled="message.emailDraftAction.busy !== null"
                      @input="
                        touchAgentChatEmailDraftAction(
                          message.emailDraftAction,
                        )
                      "
                    />
                  </label>
                  <label
                    class="assistant-email-draft-card__field assistant-email-draft-card__field--body"
                  >
                    <span>Message</span>
                    <textarea
                      v-model="message.emailDraftAction.body"
                      rows="8"
                      :disabled="message.emailDraftAction.busy !== null"
                      @input="
                        touchAgentChatEmailDraftAction(
                          message.emailDraftAction,
                        )
                      "
                    ></textarea>
                  </label>
                </div>
                <p
                  v-if="assistantEmailDraftHint(message.emailDraftAction)"
                  class="assistant-email-draft-card__hint"
                  :role="message.emailDraftAction.error ? 'alert' : undefined"
                >
                  {{ assistantEmailDraftHint(message.emailDraftAction) }}
                </p>
                <div class="assistant-email-draft-card__actions">
                  <Button
                    color="outline"
                    size="compact"
                    shape="soft"
                    :disabled="
                      !canSubmitAssistantEmailDraft(
                        message.emailDraftAction,
                      )
                    "
                    @click="
                      saveAgentChatEmailDraftAction(
                        message.emailDraftAction,
                        false,
                      )
                    "
                  >
                    <template #icon>
                      <UiIcon name="Save" :size="14" aria-hidden="true" />
                    </template>
                    {{
                      message.emailDraftAction.busy === "save"
                        ? "Saving..."
                        : "Save draft"
                    }}
                  </Button>
                  <Button
                    color="primary"
                    size="compact"
                    shape="soft"
                    :disabled="
                      !canSubmitAssistantEmailDraft(
                        message.emailDraftAction,
                      )
                    "
                    @click="
                      saveAgentChatEmailDraftAction(
                        message.emailDraftAction,
                        true,
                      )
                    "
                  >
                    <template #icon>
                      <UiIcon name="Send" :size="14" aria-hidden="true" />
                    </template>
                    {{
                      message.emailDraftAction.busy === "send"
                        ? "Sending..."
                        : "Send"
                    }}
                  </Button>
                  <a
                    v-if="message.emailDraftAction.savedDraftId"
                    class="assistant-email-draft-card__link"
                    href="/email"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open mailbox
                  </a>
                </div>
              </article>
              <div
                v-if="
                  !message.actionCards?.length &&
                  !message.emailDraftAction &&
                  (message.inboxLink ||
                    message.reminderLink ||
                    (message.actionHref && message.actionLabel))
                "
                class="assistant-message__actions"
              >
                <a
                  v-if="message.inboxLink"
                  href="/email"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open messages
                </a>
                <a
                  v-if="message.reminderLink"
                  href="/calendar"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open calendar
                </a>
                <a
                  v-if="message.actionHref && message.actionLabel"
                  :href="message.actionHref"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ message.actionLabel }}
                </a>
              </div>
            </div>
            <div
              v-if="
                message.role !== 'assistant' ||
                !assistantSending ||
                index !== assistantConsoleMessages.length - 1
              "
              class="assistant-message__tools"
              aria-label="Message actions"
            >
              <span
                v-if="formatAssistantMessageTime(message.createdAt)"
                class="assistant-message__time"
              >
                {{ formatAssistantMessageTime(message.createdAt) }}
              </span>
              <button
                v-if="message.role === 'assistant'"
                type="button"
                class="assistant-message-tool"
                :aria-label="
                  copiedMessageKey === assistantMessageKey(message, index)
                    ? 'Copied'
                    : 'Copy message'
                "
                :title="
                  copiedMessageKey === assistantMessageKey(message, index)
                    ? 'Copied'
                    : 'Copy'
                "
                @click="copyAssistantMessage(message, index)"
              >
                <UiIcon
                  :name="
                    copiedMessageKey === assistantMessageKey(message, index)
                      ? 'Check'
                      : 'Copy'
                  "
                  :size="14"
                />
              </button>
              <button
                v-if="message.role === 'user'"
                type="button"
                class="assistant-message-tool"
                aria-label="Edit and resend"
                title="Edit"
                :disabled="assistantSending"
                @click="editAndResendAssistantTurn(message)"
              >
                <UiIcon name="Pencil" :size="14" />
              </button>
              <button
                v-if="message.role === 'user'"
                type="button"
                class="assistant-message-tool"
                aria-label="Retry from here"
                title="Retry"
                :disabled="assistantSending"
                @click="retryAssistantTurn(message)"
              >
                <UiIcon name="RefreshCw" :size="14" />
              </button>
            </div>
          </article>

          <article
            v-if="assistantSending && assistantAwaitingResponse"
            class="assistant-message assistant-message--assistant"
          >
            <div
              class="assistant-message__bubble assistant-message__bubble--pending"
              role="status"
              aria-live="polite"
            >
              <span class="assistant-message__pending-detail">
                {{ assistantTurnStatusText || assistantThinkingLabel }}
              </span>
              <span class="assistant-typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          </article>
        </div>

        <footer
          class="assistant-composer"
          :class="{
            'assistant-composer--drag-active': assistantComposerDragActive,
          }"
          aria-label="Message composer"
          @dragenter="onAssistantComposerDragEnter"
          @dragover="onAssistantComposerDragOver"
          @dragleave="onAssistantComposerDragLeave"
          @drop="onAssistantComposerDrop"
        >
          <p
            v-if="siteBuilderMode && assistantConsoleMessages.length === 0"
            class="site-builder-capability-hint"
          >
            Can include email signup, payments, bookings, or downloads.
          </p>
          <label class="sr-only" for="assistant-console-input">
            {{ assistantMessageLabel }}
          </label>
          <div
            v-if="assistantAttachments.length > 0"
            class="assistant-attachments"
            aria-label="Attached files"
          >
            <span
              v-for="attachment in assistantAttachments"
              :key="attachment.id"
              class="assistant-attachment"
              :class="{
                'assistant-attachment--error': attachment.status === 'error',
              }"
              :title="
                attachment.error ||
                `${attachment.name} · ${formatFileSize(attachment.size)}`
              "
            >
              <span
                v-if="attachment.status === 'uploading'"
                class="assistant-attachment__uploading"
                role="status"
                :aria-label="`Uploading ${attachment.name}`"
              />
              <img
                v-else-if="
                  attachment.kind === 'image' && attachment.previewUrl
                "
                class="assistant-attachment__thumb"
                :src="attachment.previewUrl"
                alt=""
              />
              <UiIcon
                v-else
                :name="attachment.kind === 'image' ? 'Image' : 'FileText'"
                :size="14"
                aria-hidden="true"
              />
              <span class="assistant-attachment__name">{{
                attachment.name
              }}</span>
              <span
                v-if="attachment.status !== 'uploading'"
                class="assistant-attachment__meta"
              >
                {{
                  attachment.status === "error"
                    ? "Failed"
                    : formatFileSize(attachment.size)
                }}
              </span>
              <button
                type="button"
                class="assistant-attachment__remove"
                :aria-label="`Remove ${attachment.name}`"
                @click="removeAssistantAttachment(attachment.id)"
              >
                <UiIcon name="X" :size="12" aria-hidden="true" />
              </button>
            </span>
          </div>
          <div class="assistant-input-wrap">
            <ComposerPrompt v-if="!assistantDraft && voiceDictationState !== 'listening' && voiceDictationState !== 'processing'" :prompts="assistantPlaceholders.map(p => p.replace('{{assistantName}}', assistantDisplayName))" :animate="!composerFocused && !assistantSending" />
            <div
              v-if="voiceDictationState === 'listening'"
              class="assistant-composer__voice-wave"
              role="status"
              aria-live="polite"
              aria-label="Recording voice dictation"
            >
              <span class="assistant-composer__voice-bars" aria-hidden="true">
                <span
                  v-for="bar in 30"
                  :key="bar"
                  :style="{ '--voice-bar-index': bar }"
                />
              </span>
            </div>
            <div
              v-else-if="voiceDictationState === 'processing'"
              class="assistant-input__transcribing"
              role="status"
              aria-live="polite"
            >
              <span>
                Transcribing<span
                  class="assistant-input__transcribing-ellipsis"
                  aria-hidden="true"
                  >...</span
                >
              </span>
            </div>
            <textarea
              v-else
              id="assistant-console-input"
              ref="assistantComposerRef"
              v-model="assistantDraft"
              class="assistant-input"
              rows="1"
              placeholder=""
              @focus="composerFocused = true; autosizeAssistantComposer()"
              @blur="composerFocused = false; autosizeAssistantComposer()"
              :disabled="assistantSending"
              @keydown="onAssistantComposerKeydown"
              @input="autosizeAssistantComposer"
              @paste="onAssistantComposerPaste"
            />
          </div>
          <div class="assistant-composer__bottom">
            <input ref="assistantAttachmentInputRef" class="sr-only" type="file" multiple accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.avif,text/*,application/json,application/xml,image/*,image/avif" @change="onAssistantAttachmentChange" />
            <details ref="composerMenu" class="composer-options" @keydown.esc="composerMenu?.removeAttribute('open')">
              <summary aria-label="Message options"><UiIcon name="Plus" :size="22" aria-hidden="true" /></summary>
              <div class="composer-options__menu">
                <button type="button" :disabled="assistantSending" @click="openAssistantAttachmentPicker(); composerMenu?.removeAttribute('open')"><UiIcon name="Paperclip" :size="18" /> Attach files</button>
              <div
                v-if="
                  voiceDictationState !== 'listening' &&
                  !aiSettingsLoading &&
                  aiDeploymentMode === 'self_hosted'
                "
                class="model-picker"
              >
                <span class="sr-only">Model</span>
                <span class="model-picker__select-wrap">
                  <span class="model-picker__select-sizer" aria-hidden="true">
                    {{ selectedModel.label }}
                  </span>
                  <select
                    v-model="selectedModelId"
                    class="model-picker__select"
                    aria-label="Model"
                    :title="selectedModelTitle"
                    @change="handleAssistantModelChange"
                  >
                    <option
                      v-for="model in assistantModelOptions"
                      :key="model.option.id"
                      :value="model.option.id"
                      :title="model.optionTitle"
                    >
                      {{ model.optionLabel }}
                    </option>
                  </select>
                </span>
                <RouterLink
                  v-if="selectedModelSetup.statusLabel === 'Setup needed'"
                  class="model-picker__status model-picker__status--link"
                  :class="selectedModelSetup.className"
                  to="/account?section=ai#account-ai-model"
                  title="Configure AI models"
                >
                  {{ selectedModelSetup.statusLabel }}
                </RouterLink>
              </div>
              </div>
            </details>
            <div class="assistant-composer__right">
              <Button
                v-if="voiceDictationState === 'listening' || voiceDictationState === 'processing' || (!assistantDraft.trim() && !assistantAttachments.length && !assistantSending)"
                :color="
                  voiceDictationState === 'listening' ? 'accent' : 'ghost'
                "
                shape="pill"
                size="small"
                icon-only
                class="composer-icon-button"
                :title="
                  voiceDictationState === 'listening'
                    ? 'Stop dictation'
                    : 'Voice dictation'
                "
                :aria-label="
                  voiceDictationState === 'listening'
                    ? 'Stop voice dictation'
                    : 'Start voice dictation'
                "
                :aria-pressed="voiceDictationState === 'listening'"
                :disabled="
                  !canUseVoiceDictation || voiceDictationState === 'unsupported'
                "
                type="button"
                @click="toggleVoiceDictation"
              >
                <UiIcon
                  :name="voiceDictationState === 'listening' ? 'Square' : 'Mic'"
                  :size="17"
                />
              </Button>
              <Button
                v-else
                :color="assistantSending ? 'secondary' : 'primary'"
                shape="pill"
                size="small"
                icon-only
                class="assistant-send"
                :class="{ 'assistant-send--stop': assistantSending }"
                :disabled="assistantSending ? false : !canSendAssistantMessage"
                :aria-label="
                  assistantSending ? 'Stop response' : 'Send message'
                "
                type="button"
                @click="
                  assistantSending
                    ? stopAssistantTurn()
                    : sendAssistantMessage()
                "
              >
                <UiIcon
                  :name="assistantSending ? 'Square' : 'ArrowUp'"
                  :size="18"
                />
              </Button>
            </div>
          </div>
          <div v-if="voiceDictationStatusText" class="assistant-composer__meta">
            <span class="assistant-composer__voice-status">
              {{ voiceDictationStatusText }}
            </span>
          </div>
          <p v-if="assistantAttachmentIssue" class="assistant-error">
            {{ assistantAttachmentIssue }}
            <RouterLink
              v-if="assistantAttachmentNeedsStorage"
              to="/account?section=storage"
            >
              Activate storage
            </RouterLink>
          </p>
          <p v-if="assistantError && !siteBuilderMode" class="assistant-error">
            {{ assistantError }}
          </p>
        </footer>
      </section>
    </main>

      <aside
        v-if="siteBuilderMode"
        class="assistant-site-preview"
        aria-label="Site preview"
      >
        <nav
          v-if="assistantSitePreview"
          class="assistant-site-preview__toolbar"
          aria-label="Site actions"
        >
          <a
            class="assistant-site-preview__action assistant-site-preview__action--icon"
            :href="assistantSitePreview.href"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open site preview"
            title="Open site preview"
          >
            <UiIcon name="Eye" :size="18" />
          </a>
          <button
            class="assistant-site-preview__action assistant-site-preview__action--primary"
            type="button"
            :disabled="assistantSitePageLoading || assistantSitePageBusy"
            @click="toggleAssistantSitePagePublished"
          >
            {{
              assistantSitePageBusy
                ? "Working…"
                : assistantSitePagePublished &&
                    !assistantSitePageHasDraftChanges
                  ? "Unpublish"
                  : assistantSitePagePublished
                    ? "Publish changes"
                    : "Publish"
            }}
          </button>
        </nav>
        <iframe
          v-if="assistantSitePreview"
          :key="`${assistantSitePreview.href}:${assistantSitePreview.revision}:${assistantSitePreviewRefresh}`"
          class="assistant-site-preview__frame"
          :src="assistantSitePreview.href"
          :title="`Preview of ${assistantSitePreview.title}`"
        />
        <div v-else class="assistant-site-preview__empty" role="status">
          <span class="assistant-site-preview__empty-icon" aria-hidden="true">
            <UiIcon name="Monitor" :size="30" />
          </span>
          <strong>Your site will appear here</strong>
          <p>
            Describe the site in chat and attach any images or files you want
            ME3 to use. The preview will refresh when a draft is ready.
          </p>
        </div>
        <p class="sr-only" role="status" aria-live="polite">
          {{ assistantSitePageStatus }}
        </p>
      </aside>
    </div>

    <Teleport to="body">
      <div
        v-if="archivedThreadsModalOpen"
        class="assistant-modal"
        @click.self="closeArchivedThreadsModal"
      >
        <section
          class="assistant-modal__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archived-chats-title"
        >
          <header class="assistant-modal__header">
            <div class="assistant-modal__header-copy">
              <h2 id="archived-chats-title">Archived Chats</h2>
              <p>Download, restore, or delete archived chats.</p>
            </div>
            <div class="assistant-modal__header-actions">
              <Button
                v-if="
                  !archivedAssistantThreadsLoading &&
                  archivedAssistantThreads.length > 0
                "
                color="danger"
                shape="soft"
                size="compact"
                type="button"
                :disabled="archivedAssistantThreadsDeleting"
                @click="deleteAllArchivedAssistantThreads"
              >
                <template #icon>
                  <UiIcon name="Trash2" :size="15" aria-hidden="true" />
                </template>
                {{
                  archivedAssistantThreadsDeleting
                    ? "Deleting..."
                    : "Delete all"
                }}
              </Button>
              <Button
                color="ghost"
                shape="soft"
                size="compact"
                icon-only
                type="button"
                aria-label="Close"
                @click="closeArchivedThreadsModal"
              >
                <UiIcon name="X" :size="20" />
              </Button>
            </div>
          </header>

          <p
            v-if="archivedAssistantThreadsError"
            class="assistant-history__message"
          >
            {{ archivedAssistantThreadsError }}
          </p>
          <p
            v-else-if="archivedAssistantThreadsLoading"
            class="assistant-history__message"
          >
            Loading archived chats...
          </p>
          <div v-else class="assistant-archived-list" role="list">
            <article
              v-for="thread in archivedAssistantThreads"
              :key="thread.id"
              class="assistant-archived-thread"
              role="listitem"
            >
              <button
                type="button"
                class="assistant-archived-thread__main"
                :disabled="archivedAssistantThreadsDeleting"
                @click="
                  selectAssistantThread(thread.id);
                  closeArchivedThreadsModal();
                "
              >
                <UiIcon name="MessageSquare" :size="16" aria-hidden="true" />
                <span>
                  <strong>{{ threadTitle(thread) }}</strong>
                  <small>{{
                    formatAssistantThreadTime(
                      thread.lastMessageAt || thread.updatedAt,
                    )
                  }}</small>
                </span>
              </button>
              <div class="assistant-archived-thread__actions">
                <button
                  type="button"
                  title="Export transcript"
                  aria-label="Export transcript"
                  :disabled="
                    archivedAssistantThreadsDeleting ||
                    assistantThreadActionId === thread.id
                  "
                  @click="exportAssistantThread(thread)"
                >
                  <UiIcon name="Download" :size="15" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Restore chat"
                  aria-label="Restore chat"
                  :disabled="
                    archivedAssistantThreadsDeleting ||
                    assistantThreadActionId === thread.id
                  "
                  @click="restoreArchivedAssistantThread(thread)"
                >
                  <UiIcon name="ArchiveRestore" :size="15" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Delete chat"
                  aria-label="Delete chat"
                  :disabled="
                    archivedAssistantThreadsDeleting ||
                    assistantThreadActionId === thread.id
                  "
                  @click="deleteArchivedAssistantThread(thread)"
                >
                  <UiIcon name="Trash2" :size="15" aria-hidden="true" />
                </button>
              </div>
            </article>
            <p
              v-if="archivedAssistantThreads.length === 0"
              class="assistant-history__message"
            >
              No archived chats.
            </p>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="assistantSettingsModalOpen"
        class="assistant-modal"
        @click.self="closeAssistantSettingsModal"
      >
        <section
          class="assistant-modal__dialog assistant-modal__dialog--wide assistant-settings-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assistant-settings-title"
        >
          <header
            class="assistant-modal__header assistant-modal__header--icon-only"
          >
            <h2 id="assistant-settings-title" class="sr-only">
              Assistant settings
            </h2>
            <div class="assistant-modal__header-actions">
              <Button
                color="ghost"
                shape="soft"
                size="compact"
                icon-only
                type="button"
                aria-label="Close"
                @click="closeAssistantSettingsModal"
              >
                <UiIcon name="X" :size="20" />
              </Button>
            </div>
          </header>

          <div class="assistant-settings">
            <WorkspaceTabs
              class="assistant-settings__tabs"
              :tabs="assistantSettingsTabs"
              :model-value="assistantSettingsSection"
              aria-label="Assistant settings"
              @update:model-value="setAssistantSettingsSectionFromTab"
            />

            <section
              v-if="assistantSettingsSection === 'context'"
              class="assistant-settings__panel"
              role="tabpanel"
            >
              <p
                v-if="assistantSettingsError"
                class="assistant-settings__error"
                role="alert"
              >
                {{ assistantSettingsError }}
              </p>

              <div v-if="assistantContextLoading" class="empty-row">
                Loading context...
              </div>
              <template v-else>
                <section class="assistant-settings__block">
                  <header class="assistant-settings__block-header">
                    <div>
                      <h4>Identity</h4>
                      <p>
                        {{ assistantSettings.displayName }} is your assistant's
                        chat name.
                      </p>
                    </div>
                  </header>
                  <form
                    class="assistant-settings-inline-form assistant-settings-name-form"
                    @submit.prevent="saveAssistantName"
                  >
                    <input
                      v-model="assistantNameDraft"
                      type="text"
                      :maxlength="assistantNameMaxLength"
                      placeholder="ME3"
                      aria-label="Assistant name"
                      autocomplete="off"
                    />
                    <Button
                      color="accent"
                      shape="soft"
                      size="compact"
                      type="submit"
                      :disabled="!canSaveAssistantName"
                    >
                      <UiIcon name="Save" :size="14" />
                      Save
                    </Button>
                  </form>
                  <p
                    v-if="assistantNameNotice || assistantNameInvalid"
                    class="assistant-settings-field-note"
                    :class="{
                      'assistant-settings-field-note--error':
                        assistantNameInvalid,
                    }"
                  >
                    {{
                      assistantNameInvalid
                        ? `Name must be ${assistantNameMaxLength} characters or fewer.`
                        : assistantNameNotice
                    }}
                  </p>
                </section>

                <section class="assistant-settings__block">
                  <header class="assistant-settings__block-header">
                    <div>
                      <h4>Sources</h4>
                      <p>
                        This is the important data your assistant keeps in
                        memory about you. The more it knows, the better it can
                        assist you.
                      </p>
                    </div>
                  </header>
                  <div
                    v-if="assistantSourceRows.length === 0"
                    class="empty-row"
                  >
                    No context sources yet.
                  </div>
                  <article
                    v-for="source in assistantSourceRows"
                    :key="source.id"
                    class="assistant-settings-row"
                    :class="{
                      'assistant-settings-row--missing': source.isMissing,
                    }"
                  >
                    <div class="assistant-settings-row__main">
                      <div class="assistant-settings-row__heading">
                        <h4>{{ source.label }}</h4>
                        <span class="assistant-settings-row__priority">
                          {{ source.priorityLabel }}
                        </span>
                        <span
                          class="status-badge"
                          :class="`status-badge--${source.status}`"
                        >
                          {{ assistantSourceStatusLabel(source.status) }}
                        </span>
                        <Button
                          v-if="source.isDeletable"
                          class="assistant-settings-row__delete"
                          color="ghost"
                          shape="soft"
                          size="compact"
                          icon-only
                          type="button"
                          aria-label="Delete source"
                          :disabled="assistantSourceActionId === source.id"
                          @click="deleteAssistantSource(source)"
                        >
                          <UiIcon name="Trash2" :size="14" />
                        </Button>
                      </div>
                      <p>
                        {{
                          source.description ||
                          source.sourceRef ||
                          assistantSourceKindLabel(source.sourceKind)
                        }}
                      </p>
                    </div>
                  </article>
                </section>

                <section class="assistant-settings__block">
                  <header class="assistant-settings__block-header">
                    <div>
                      <h4>Saved memory</h4>
                      <p>
                        Add important notes you want your assistant to remember
                        here.
                      </p>
                    </div>
                  </header>
                  <form
                    class="assistant-settings-inline-form"
                    @submit.prevent="addAssistantMemory"
                  >
                    <input
                      v-model="assistantMemoryDraft"
                      type="text"
                      placeholder="Add private memory"
                      aria-label="Add private memory"
                    />
                    <Button
                      color="accent"
                      shape="soft"
                      size="compact"
                      icon-only
                      type="submit"
                      aria-label="Add memory"
                      :disabled="
                        !assistantMemoryDraft.trim() ||
                        Boolean(assistantMemoryActionId)
                      "
                    >
                      <UiIcon name="Plus" :size="18" />
                    </Button>
                  </form>
                  <article
                    v-for="item in assistantMemory"
                    :key="item.id"
                    class="assistant-settings-row assistant-settings-row--memory"
                    :class="{
                      'assistant-settings-row--pending':
                        item.reviewStatus === 'needs_review',
                    }"
                  >
                    <div class="assistant-settings-row__main">
                      <div class="assistant-settings-row__heading">
                        <h4>
                          {{
                            item.title ||
                            assistantMemoryKindLabel(item.memoryKind)
                          }}
                        </h4>
                        <span
                          class="status-badge"
                          :class="`status-badge--${item.reviewStatus}`"
                        >
                          {{ assistantMemoryStatusLabel(item.reviewStatus) }}
                        </span>
                      </div>
                      <p>{{ item.body }}</p>
                      <div class="assistant-settings-row__meta">
                        <span>{{ assistantMemorySourceLabel(item) }}</span>
                        <span>{{ assistantMemoryScopeLabel(item) }}</span>
                        <span>{{
                          formatAssistantSettingsDate(item.updatedAt)
                        }}</span>
                      </div>
                    </div>
                    <div class="assistant-settings-row__actions">
                      <Button
                        v-if="item.reviewStatus === 'needs_review'"
                        color="primary"
                        shape="soft"
                        size="compact"
                        type="button"
                        :disabled="assistantMemoryActionId === item.id"
                        @click="approveAssistantMemory(item)"
                      >
                        <UiIcon name="Check" :size="14" />
                        Approve
                      </Button>
                      <Button
                        color="danger"
                        shape="soft"
                        size="compact"
                        type="button"
                        :disabled="assistantMemoryActionId === item.id"
                        @click="forgetAssistantMemory(item)"
                      >
                        <UiIcon name="Trash2" :size="14" />
                        Forget
                      </Button>
                    </div>
                  </article>
                </section>
              </template>
            </section>

            <section v-else class="assistant-settings__panel" role="tabpanel">
              <div class="assistant-settings__panel-header">
                <div>
                  <h3>Activity</h3>
                  <p>Approvals, runs, and assistant updates.</p>
                </div>
                <div class="assistant-settings__header-actions">
                  <Button
                    color="ghost"
                    shape="soft"
                    size="compact"
                    icon-only
                    type="button"
                    aria-label="Refresh activity"
                    title="Refresh"
                    :disabled="assistantActivityLoading"
                    @click="loadAssistantActivity"
                  >
                    <UiIcon name="RefreshCw" :size="16" />
                  </Button>
                  <Button
                    color="danger"
                    shape="soft"
                    size="compact"
                    type="button"
                    :disabled="
                      assistantActivityItems.length === 0 ||
                      assistantClearingActivity
                    "
                    @click="clearAssistantActivity"
                  >
                    {{ assistantClearingActivity ? "Clearing" : "Clear" }}
                  </Button>
                </div>
              </div>

              <p
                v-if="assistantSettingsError"
                class="assistant-settings__error"
                role="alert"
              >
                {{ assistantSettingsError }}
              </p>
              <div v-if="assistantActivityLoading" class="empty-row">
                Loading activity...
              </div>
              <div
                v-else-if="assistantActivityItems.length === 0"
                class="empty-row"
              >
                No activity yet.
              </div>
              <template v-else>
                <article
                  v-for="item in assistantActivityItems"
                  :key="item.id"
                  class="assistant-settings-row assistant-settings-row--activity"
                >
                  <div class="assistant-settings-row__main">
                    <div class="assistant-settings-row__activity-head">
                      <span class="assistant-settings-row__kind">{{
                        item.kind
                      }}</span>
                      <h4>{{ item.title }}</h4>
                      <span v-if="item.status" class="status-badge">
                        {{ item.status }}
                      </span>
                      <span class="assistant-settings-row__time">{{
                        formatAssistantSettingsDate(item.createdAt)
                      }}</span>
                    </div>
                    <p>{{ item.summary || "No summary yet" }}</p>
                    <Button v-if="item.approval?.pluginId === 'me3.core'" color="secondary" shape="soft" @click="assistantReviewApproval = item.approval; assistantApprovalError = ''">Review</Button>
                  </div>
                </article>
              </template>
            </section>
          </div>
        </section>
      </div>
    </Teleport>

    <AssistantApprovalDialog :approval="assistantReviewApproval" :busy="assistantApprovalBusy" :error="assistantApprovalError" @close="assistantReviewApproval = null" @decide="decideAssistantApproval" />

    <Teleport to="body">
      <div
        v-if="configureJobsModalOpen"
        class="assistant-modal"
        @click.self="closeConfigureJobsModal"
      >
        <section
          class="assistant-modal__dialog assistant-modal__dialog--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="configure-jobs-title"
        >
          <header class="assistant-modal__header">
            <h2 id="configure-jobs-title">Jobs</h2>
            <div class="assistant-modal__header-actions">
              <Button
                color="ghost"
                shape="soft"
                size="compact"
                icon-only
                type="button"
                aria-label="Close"
                @click="closeConfigureJobsModal"
              >
                <UiIcon name="X" :size="20" />
              </Button>
            </div>
          </header>

          <div v-if="loadingJobs || loadingRecipes" class="empty-row">
            Loading jobs...
          </div>
          <div v-else class="job-list" role="list" aria-label="Starter jobs and saved jobs">
            <template
              v-for="row in configureJobRows"
              :key="
                row.kind === 'job'
                  ? row.job.id
                  : row.kind === 'booking-reminders'
                    ? 'booking-reminders'
                    : row.recipe.id
              "
            >
              <article
                v-if="row.kind === 'job'"
                role="listitem"
                class="job-row"
                :class="{
                  'job-row--selected':
                    detailModalOpen && selectedJobId === row.job.id,
                  'job-row--muted':
                    row.job.status === 'paused' || row.job.status === 'draft',
                }"
              >
                <span class="job-row__emoji" aria-hidden="true">
                  {{ jobNavEmoji(row.job) }}
                </span>
                <div class="job-row__main">
                  <span class="job-row__copy">
                    <span class="job-row__title-line">
                      <strong>{{ row.job.name }}</strong>
                      <span
                        class="status-badge"
                        :class="`status-badge--${row.job.status}`"
                      >
                        {{ statusLabel(row.job.status) }}
                      </span>
                    </span>
                    <span class="job-row__meta">
                      Runs: {{ formatTrigger(row.job.triggerSummary) }} · Last
                      run: {{ formatDate(row.job.lastRunAt) }}
                    </span>
                  </span>
                </div>

                <div class="job-row__actions">
                  <span
                    v-if="row.job.lastRunStatus === 'waiting_for_approval'"
                    class="needs-you"
                  >
                    Needs you
                  </span>
                  <label
                    class="job-toggle"
                    :class="{ 'is-busy': isJobToggleBusy(row.job) }"
                    @click.stop
                  >
                    <input
                      type="checkbox"
                      class="job-toggle__input"
                      :checked="isJobEnabled(row.job)"
                      :disabled="
                        !canToggle(row.job) || isJobToggleBusy(row.job)
                      "
                      :aria-label="
                        isJobEnabled(row.job)
                          ? `Pause ${row.job.name}`
                          : `Enable ${row.job.name}`
                      "
                      @change="
                        handleJobToggle(
                          row.job,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                    <span class="job-toggle__track" aria-hidden="true" />
                  </label>
                  <Button
                    color="ghost"
                    shape="soft"
                    size="small"
                    icon-only
                    type="button"
                    title="Job detail"
                    aria-label="Open job detail"
                    @click.stop="openJob(row.job.id)"
                  >
                    <UiIcon name="Pencil" :size="16" />
                  </Button>
                </div>
              </article>

              <article
                v-else-if="row.kind === 'booking-reminders'"
                role="listitem"
                class="job-row"
                :class="{
                  'job-row--muted': !bookingRemindersSystemEnabled(row),
                }"
              >
                <span class="job-row__emoji" aria-hidden="true">
                  {{ recipeNavEmoji(bookingReminderSystemRecipeId) }}
                </span>
                <div class="job-row__main">
                  <span class="job-row__copy">
                    <span class="job-row__title-line">
                      <strong>{{ bookingReminderSystemName }}</strong>
                      <span
                        class="status-badge"
                        :class="
                          bookingRemindersSystemEnabled(row)
                            ? 'status-badge--active'
                            : 'status-badge--paused'
                        "
                      >
                        {{ bookingRemindersSystemStatus(row) }}
                      </span>
                    </span>
                    <span class="job-row__meta">
                      {{ bookingReminderSystemDescription }}
                    </span>
                  </span>
                </div>

                <div class="job-row__actions">
                  <label
                    class="job-toggle"
                    :class="{ 'is-busy': isBusy('booking-reminders') }"
                    @click.stop
                  >
                    <input
                      type="checkbox"
                      class="job-toggle__input"
                      :checked="bookingRemindersSystemEnabled(row)"
                      :disabled="isBusy('booking-reminders')"
                      :aria-label="
                        bookingRemindersSystemEnabled(row)
                          ? `Pause ${bookingReminderSystemName}`
                          : `Enable ${bookingReminderSystemName}`
                      "
                      @change="
                        handleBookingRemindersToggle(
                          row,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                    <span class="job-toggle__track" aria-hidden="true" />
                  </label>
                </div>
              </article>

              <article v-else role="listitem" class="job-row job-row--inactive">
                <span class="job-row__emoji" aria-hidden="true">
                  {{ recipeNavEmoji(row.recipe.id) }}
                </span>
                <div class="job-row__main">
                  <span class="job-row__copy">
                    <span class="job-row__title-line">
                      <strong>{{ row.recipe.name }}</strong>
                      <span
                        v-if="row.recipe.state === 'needs_setup'"
                        class="status-badge status-badge--needs_setup"
                      >
                        Needs setup
                      </span>
                      <span
                        v-else-if="row.recipe.state === 'coming_later'"
                        class="status-badge status-badge--coming_later"
                      >
                        Later
                      </span>
                      <span v-else class="status-badge status-badge--draft">
                        Not added
                      </span>
                    </span>
                    <span class="job-row__meta">
                      {{ cleanPlainText(row.recipe.outcome) }}
                    </span>
                  </span>
                </div>

                <div class="job-row__actions">
                  <label
                    class="job-toggle"
                    :class="{ 'is-busy': isRecipeToggleBusy(row.recipe) }"
                    @click.stop
                  >
                    <input
                      type="checkbox"
                      class="job-toggle__input"
                      :checked="false"
                      :disabled="
                        !canCreateRecipe(row.recipe) ||
                        isRecipeToggleBusy(row.recipe)
                      "
                      :aria-label="`Add ${row.recipe.name}`"
                      @change="
                        handleRecipeToggle(
                          row.recipe,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                    <span class="job-toggle__track" aria-hidden="true" />
                  </label>
                </div>
              </article>
            </template>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="detailModalOpen"
        class="assistant-modal assistant-modal--stacked"
        @click.self="closeDetailModal"
      >
        <section
          class="assistant-modal__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="job-detail-title"
        >
          <div v-if="loadingDetail" class="empty-row">Loading details...</div>
          <template v-else-if="selectedJob">
            <header class="assistant-modal__header">
              <div class="assistant-modal__header-copy">
                <div class="assistant-modal__title-row">
                  <h2 id="job-detail-title">Job: {{ selectedJob.name }}</h2>
                  <span
                    class="status-badge"
                    :class="`status-badge--${selectedJob.status}`"
                  >
                    {{ statusLabel(selectedJob.status) }}
                  </span>
                  <span
                    v-if="selectedJob.lastRunStatus === 'waiting_for_approval'"
                    class="needs-you"
                  >
                    Needs you
                  </span>
                </div>
                <p>{{ jobDetailPurpose(selectedJob) }}</p>
              </div>
              <Button
                color="ghost"
                shape="soft"
                size="compact"
                icon-only
                type="button"
                aria-label="Close"
                @click="closeDetailModal"
              >
                <UiIcon name="X" :size="20" />
              </Button>
            </header>

            <div v-if="selectedJob.status === 'needs_setup'" class="notice">
              <template v-if="isAccountsSetupMissing(selectedJob)">
                Missing setup requirement: Accounts plugin needs to be activated
                <RouterLink to="/accounts">here</RouterLink>.
              </template>
              <template v-else>
                {{ setupMessageForJob(selectedJob) }}
              </template>
            </div>

            <dl class="detail-facts">
              <div class="detail-facts__runs">
                <dt>Runs</dt>
                <dd
                  v-if="selectedScheduleTrigger && scheduleInlineEditing"
                  class="detail-facts__schedule detail-facts__schedule--editing"
                >
                  <div
                    class="schedule-inline"
                    role="group"
                    aria-label="Edit schedule"
                  >
                    <select
                      v-model="scheduleCadenceDraft"
                      class="schedule-inline__input"
                      aria-label="Cadence"
                    >
                      <option
                        v-for="option in scheduleCadenceOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                    <select
                      v-if="scheduleCadenceDraft === 'weekly'"
                      v-model.number="scheduleDayOfWeekDraft"
                      class="schedule-inline__input"
                      aria-label="Day of week"
                    >
                      <option
                        v-for="day in weekdayOptions"
                        :key="day.value"
                        :value="day.value"
                      >
                        {{ day.label }}
                      </option>
                    </select>
                    <select
                      v-if="scheduleCadenceDraft === 'monthly'"
                      v-model.number="scheduleDayOfMonthDraft"
                      class="schedule-inline__input schedule-inline__input--day"
                      aria-label="Day of month"
                    >
                      <option
                        v-for="day in monthDayOptions"
                        :key="day"
                        :value="day"
                      >
                        {{ day }}
                      </option>
                    </select>
                    <input
                      v-model="scheduleTimeDraft"
                      class="schedule-inline__input schedule-inline__input--time"
                      type="time"
                      required
                      aria-label="Time"
                    />
                    <div class="schedule-inline__actions">
                      <span v-if="scheduleNotice" class="inline-notice">
                        {{ scheduleNotice }}
                      </span>
                      <Button
                        v-if="scheduleDraftChanged"
                        color="primary"
                        shape="soft"
                        size="compact"
                        type="button"
                        :disabled="
                          !scheduleTimeValid ||
                          isBusy(`schedule:${selectedJob.id}`)
                        "
                        @click="saveJobSchedule"
                      >
                        Save
                      </Button>
                      <Button
                        color="ghost"
                        shape="soft"
                        size="small"
                        icon-only
                        type="button"
                        aria-label="Cancel schedule edit"
                        @click="cancelScheduleInlineEdit"
                      >
                        <UiIcon name="X" :size="14" />
                      </Button>
                    </div>
                  </div>
                </dd>
                <dd
                  v-else-if="selectedScheduleTrigger"
                  class="detail-facts__schedule"
                >
                  <span>{{ formatTrigger(selectedJob.triggerSummary) }}</span>
                  <Button
                    color="ghost"
                    shape="soft"
                    size="small"
                    icon-only
                    type="button"
                    title="Edit schedule"
                    aria-label="Edit schedule"
                    @click="openScheduleInlineEdit"
                  >
                    <UiIcon name="Pencil" :size="14" />
                  </Button>
                </dd>
                <dd v-else>
                  {{ formatTrigger(selectedJob.triggerSummary) }}
                </dd>
              </div>
              <div class="detail-facts__meta">
                <div>
                  <dt>Last run</dt>
                  <dd>
                    {{ runStatusLabel(selectedJob.lastRunStatus) }} ·
                    {{ formatDate(selectedJob.lastRunAt) }}
                  </dd>
                </div>
                <div>
                  <dt>Next run</dt>
                  <dd>{{ formatNextRun(selectedJob) }}</dd>
                </div>
                <div>
                  <dt>Sends results to</dt>
                  <dd>{{ formatDestination(selectedDetail) }}</dd>
                </div>
              </div>
            </dl>

            <section
              v-if="selectedLatestRun || selectedLatestReviewTask"
              class="job-result-strip"
            >
              <div class="job-result-strip__copy">
                <strong>{{
                  selectedLatestRunSummary || "Latest run recorded."
                }}</strong>
                <span v-if="selectedLatestRun">
                  {{ runStatusLabel(selectedLatestRun.status) }} ·
                  {{
                    formatDate(
                      selectedLatestRun.finishedAt ||
                        selectedLatestRun.createdAt,
                    )
                  }}
                </span>
              </div>
              <Button
                v-if="selectedJobIsWeeklyReview && selectedLatestReviewTask"
                color="outline"
                shape="soft"
                size="compact"
                type="button"
                @click="openLatestReviewTask(selectedLatestReviewTask)"
              >
                <template #icon>
                  <UiIcon name="ExternalLink" :size="16" />
                </template>
                Open latest review
              </Button>
            </section>

            <section
              v-if="selectedJobIsInboxWatch"
              class="detail-section inbox-watch-settings"
              aria-labelledby="inbox-watch-rules-title"
            >
              <div class="inbox-watch-settings__header">
                <div>
                  <h3 id="inbox-watch-rules-title">Watch Rules</h3>
                  <p>
                    Match new inbox mail by sender, subject, body text, or
                    internal labels.
                  </p>
                </div>
                <Button
                  color="outline"
                  shape="soft"
                  size="compact"
                  type="button"
                  @click="addInboxWatchRule"
                >
                  <template #icon>
                    <UiIcon name="Plus" :size="16" />
                  </template>
                  Add rule
                </Button>
              </div>

              <div class="inbox-watch-rule-list">
                <article
                  v-for="(rule, index) in inboxWatchRulesDraft"
                  :key="rule.id"
                  class="inbox-watch-rule"
                >
                  <div class="inbox-watch-rule__top">
                    <label class="inbox-watch-field inbox-watch-field--name">
                      <span>Rule name</span>
                      <input v-model="rule.label" type="text" />
                    </label>
                    <label class="inbox-watch-field">
                      <span>Timing</span>
                      <select v-model="rule.timing">
                        <option value="immediate">Immediate</option>
                        <option value="daily_digest">Daily digest</option>
                        <option value="weekly_digest">Weekly digest</option>
                        <option value="manual">Manual</option>
                      </select>
                    </label>
                    <label class="job-toggle inbox-watch-rule__toggle">
                      <input
                        v-model="rule.enabled"
                        type="checkbox"
                        class="job-toggle__input"
                        :aria-label="
                          rule.enabled
                            ? `Disable ${rule.label || `rule ${index + 1}`}`
                            : `Enable ${rule.label || `rule ${index + 1}`}`
                        "
                      />
                      <span class="job-toggle__track" aria-hidden="true" />
                    </label>
                    <Button
                      color="ghost"
                      shape="soft"
                      size="small"
                      icon-only
                      type="button"
                      title="Remove rule"
                      aria-label="Remove rule"
                      :disabled="inboxWatchRulesDraft.length <= 1"
                      @click="removeInboxWatchRule(rule.id)"
                    >
                      <UiIcon name="Trash2" :size="16" />
                    </Button>
                  </div>

                  <div class="inbox-watch-grid">
                    <label class="inbox-watch-field">
                      <span>From</span>
                      <textarea
                        v-model="rule.from"
                        rows="3"
                        placeholder="ada@example.com, client.com"
                      />
                    </label>
                    <label class="inbox-watch-field">
                      <span>Contains</span>
                      <textarea
                        v-model="rule.contains"
                        rows="3"
                        placeholder="contract, please reply"
                      />
                    </label>
                  </div>

                  <div class="inbox-watch-labels">
                    <span class="inbox-watch-labels__title">Looks like</span>
                    <div class="inbox-watch-checks">
                      <label class="checkbox-pill">
                        <input
                          v-model="rule.inferredLabels"
                          type="checkbox"
                          value="needs_reply"
                        />
                        <span>Needs reply</span>
                      </label>
                      <label class="checkbox-pill">
                        <input
                          v-model="rule.inferredLabels"
                          type="checkbox"
                          value="important"
                        />
                        <span>Important</span>
                      </label>
                      <label class="checkbox-pill">
                        <input
                          v-model="rule.inferredLabels"
                          type="checkbox"
                          value="finance"
                        />
                        <span>Finance</span>
                      </label>
                      <label class="checkbox-pill">
                        <input
                          v-model="rule.inferredLabels"
                          type="checkbox"
                          value="scheduling"
                        />
                        <span>Scheduling</span>
                      </label>
                      <label class="checkbox-pill">
                        <input
                          v-model="rule.inferredLabels"
                          type="checkbox"
                          value="review"
                        />
                        <span>Review</span>
                      </label>
                    </div>
                  </div>

                  <div class="inbox-watch-actions">
                    <label class="checkbox-row">
                      <input v-model="rule.notifyOwner" type="checkbox" />
                      <span>Notify me if connected</span>
                    </label>
                    <label class="checkbox-row">
                      <input v-model="rule.summarizeAndLabel" type="checkbox" />
                      <span>Summarize and label</span>
                    </label>
                    <label class="checkbox-row">
                      <input v-model="rule.draftReply" type="checkbox" />
                      <span>Draft reply for review</span>
                    </label>
                    <label class="checkbox-row">
                      <input v-model="rule.createTask" type="checkbox" />
                      <span>Create task</span>
                    </label>
                  </div>
                </article>
              </div>

              <div class="inbox-watch-settings__actions">
                <span v-if="inboxWatchRulesNotice" class="inline-notice">
                  {{ inboxWatchRulesNotice }}
                </span>
                <Button
                  color="primary"
                  shape="soft"
                  size="compact"
                  type="button"
                  :disabled="
                    !inboxWatchRulesChanged ||
                    isBusy(`inbox-watch-rules:${selectedJob.id}`)
                  "
                  @click="saveInboxWatchRules"
                >
                  Save rules
                </Button>
              </div>
            </section>

            <section
              v-if="selectedJobIsDailyBriefing"
              class="detail-section briefing-settings"
              aria-labelledby="briefing-customise-title"
            >
              <div class="briefing-settings__header">
                <h3 id="briefing-customise-title">Customise message</h3>
                <Button
                  color="ghost"
                  shape="soft"
                  size="small"
                  icon-only
                  type="button"
                  title="Restore default"
                  aria-label="Restore default message"
                  @click="resetDailyBriefingTemplate"
                >
                  <UiIcon name="RefreshCw" :size="16" />
                </Button>
              </div>

              <div class="briefing-settings__columns">
                <div class="briefing-settings__editor">
                  <label class="briefing-template-field">
                    <textarea
                      v-model="dailyBriefingTemplateDraft"
                      rows="9"
                      class="briefing-template-field__textarea"
                      aria-label="Message template"
                    />
                  </label>

                  <div
                    class="briefing-variable-list"
                    aria-label="Template variables"
                  >
                    <button
                      v-for="variable in dailyBriefingVariables"
                      :key="variable.value"
                      type="button"
                      class="briefing-variable-chip"
                      @click="insertDailyBriefingVariable(variable.value)"
                    >
                      {{ variable.label }}
                    </button>
                  </div>
                </div>

                <div class="briefing-preview" aria-label="Message preview">
                  <span class="briefing-preview__label">Preview</span>
                  <p>{{ dailyBriefingPreview }}</p>
                </div>
              </div>
            </section>

            <footer class="assistant-modal__footer">
              <span
                v-if="selectedJobIsDailyBriefing && dailyBriefingTemplateNotice"
                class="inline-notice"
              >
                {{ dailyBriefingTemplateNotice }}
              </span>
              <Button
                v-if="selectedJobIsDailyBriefing"
                color="primary"
                shape="soft"
                size="compact"
                type="button"
                :disabled="
                  !dailyBriefingTemplateChanged ||
                  isBusy(`briefing-template:${selectedJob.id}`)
                "
                @click="saveDailyBriefingTemplate"
              >
                Save message
              </Button>
              <Button
                v-if="canRun(selectedJob)"
                color="primary"
                shape="soft"
                size="compact"
                type="button"
                :disabled="isBusy(`run:${selectedJob.id}`)"
                @click="runJob(selectedJob)"
              >
                <template #icon>
                  <UiIcon name="Play" :size="17" />
                </template>
                Run now
              </Button>
              <Button
                v-if="canToggle(selectedJob)"
                color="outline"
                shape="soft"
                size="compact"
                type="button"
                :disabled="isBusy(toggleBusyKey(selectedJob))"
                @click="toggleJob(selectedJob)"
              >
                <template #icon>
                  <UiIcon :name="toggleIcon(selectedJob)" :size="17" />
                </template>
                {{ toggleLabel(selectedJob) }}
              </Button>
              <Button
                color="outline"
                shape="soft"
                size="compact"
                type="button"
                :disabled="isBusy(`duplicate:${selectedJob.id}`)"
                @click="duplicateJob(selectedJob)"
              >
                <template #icon>
                  <UiIcon name="Copy" :size="17" />
                </template>
                Duplicate
              </Button>
              <Button
                v-if="canArchiveJob(selectedJob)"
                color="danger"
                shape="soft"
                size="compact"
                icon-only
                aria-label="Remove job"
                title="Remove job"
                type="button"
                :disabled="isBusy(`archive:${selectedJob.id}`)"
                @click="archiveJob(selectedJob)"
              >
                <template #icon>
                  <UiIcon name="Trash2" :size="17" />
                </template>
              </Button>
            </footer>
          </template>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.assistant-page {
  --assistant-composer-clearance: 110px;
  --assistant-header-clearance: calc(var(--app-shell-mobile-nav-height) + 18px);

  position: relative;
  isolation: isolate;
  display: block;
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 0 14px 18px;
  background: var(--ui-bg);
  color: var(--ui-text);
}

.assistant-page--history-collapsed {
  display: block;
}

.assistant-workspace {
  min-height: inherit;
}

.assistant-page--site-builder {
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.assistant-workspace--site-builder {
  display: grid;
  grid-template-columns: minmax(290px, 42%) minmax(320px, 1fr);
  height: 100vh;
  height: 100dvh;
  min-height: 0;
}

.assistant-page--site-builder .assistant-main {
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  border-right: 1px solid var(--ui-border);
  overflow: hidden;
}

.assistant-page--site-builder .assistant-console {
  width: 100%;
  max-width: none;
  min-height: 0;
  padding: 0 16px;
  overflow: hidden;
}

.assistant-page--site-builder .assistant-timeline {
  flex: 1 1 auto;
  min-height: 0;
  padding: 18px 0 22px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.assistant-page--site-builder .assistant-empty-state {
  padding: clamp(54px, 15vh, 140px) 0 10px;
}

.assistant-page--site-builder .assistant-composer {
  position: static;
  width: 100%;
  max-width: none;
  flex: 0 0 auto;
  margin: 0 0 max(14px, env(safe-area-inset-bottom, 0px));
  transform: none;
}

.site-builder-capability-hint {
  margin: 0;
  padding: 0 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.assistant-site-preview {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  padding: 12px;
  background: var(--ui-surface-muted);
}

.assistant-site-preview__toolbar {
  position: absolute;
  z-index: 2;
  top: 22px;
  right: 22px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: color-mix(in srgb, var(--ui-surface) 94%, transparent);
  box-shadow: var(--ui-shadow-md);
  backdrop-filter: blur(12px);
}

.assistant-site-preview__action {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--ui-radius-sm);
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.assistant-site-preview__action {
  background: transparent;
  color: var(--ui-text);
  cursor: pointer;
  text-decoration: none;
}

.assistant-site-preview__action--icon {
  width: 44px;
  padding: 0;
}

.assistant-site-preview__action:hover {
  background: var(--ui-surface-muted);
}

.assistant-site-preview__action:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 1px;
}

.assistant-site-preview__action--primary {
  background: var(--ui-accent);
  color: var(--ui-on-accent, #fff);
}

.assistant-site-preview__action--primary:hover {
  background: var(--ui-accent-strong, var(--ui-accent));
}

.assistant-site-preview__action:disabled {
  cursor: wait;
  opacity: 0.58;
}

.assistant-site-preview__frame,
.assistant-site-preview__empty {
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: #fff;
  box-shadow: var(--ui-shadow-sm);
}

.assistant-site-preview__frame {
  display: block;
}

.assistant-site-preview__empty {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 10px;
  box-sizing: border-box;
  padding: 28px;
  color: var(--ui-text);
  text-align: center;
}

.assistant-site-preview__empty-icon {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
}

.assistant-site-preview__empty strong,
.assistant-site-preview__empty p {
  margin: 0;
}

.assistant-site-preview__empty p {
  max-width: 38ch;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.assistant-page-tools {
  position: fixed;
  top: 14px;
  right: 18px;
  z-index: 42;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-md);
  background: color-mix(in oklab, var(--ui-bg) 86%, transparent);
  backdrop-filter: blur(14px);
}

.assistant-history {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 90;
  display: flex;
  flex-direction: column;
  width: min(300px, calc(100vw - var(--app-shell-mobile-nav-leading-padding)));
  max-width: min(
    300px,
    calc(100vw - var(--app-shell-mobile-nav-leading-padding))
  );
  min-width: 0;
  height: 100dvh;
  max-height: 100dvh;
  border-right: 1px solid var(--ui-border);
  padding: 14px 10px;
  background: var(--ui-surface-muted);
  overflow: hidden;
  transform: translateX(-102%);
  transition: transform 0.18s ease;
  box-shadow: var(--ui-shadow-md);
}

.assistant-history--open {
  transform: translateX(0);
}

.assistant-history--collapsed {
  width: min(300px, calc(100vw - var(--app-shell-mobile-nav-leading-padding)));
}

.assistant-history--collapsed .assistant-history__body {
  display: flex;
}

.assistant-history__header {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.assistant-history__nav-row:hover,
.assistant-history__project-row:hover,
.assistant-history__thread:hover {
  background: color-mix(in oklab, var(--ui-surface) 64%, transparent);
  color: var(--ui-text);
}

.assistant-mobile-nav__button {
  flex: 0 0 auto;
  pointer-events: auto;
}

.assistant-history__collapse {
  display: none;
}

.assistant-history__close {
  display: inline-flex;
  margin-left: auto;
}

.assistant-history__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  height: 100%;
  padding-top: 10px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.assistant-history__topnav,
.assistant-history__section {
  display: grid;
  gap: 4px;
}

.assistant-history__nav-row,
.assistant-history__project-row,
.assistant-history__thread {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  padding: 4px 6px;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
}

.assistant-history__thread-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}

.assistant-history__section h2 {
  margin: 0;
  color: color-mix(in oklab, var(--ui-text-muted) 76%, transparent);
  font-size: 12px;
  font-weight: 500;
}

.assistant-history__section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 28px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  padding: 2px 0;
  background: transparent;
  color: color-mix(in oklab, var(--ui-text-muted) 76%, transparent);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.assistant-history__section-toggle:hover,
.assistant-history__section-toggle:focus-visible {
  color: var(--ui-text);
}

.assistant-history__thread-actions button:hover:not(:disabled) {
  background: var(--ui-surface);
  color: var(--ui-text);
}

.assistant-history__list {
  display: grid;
  gap: 2px;
}

.assistant-history__list--nested {
  grid-column: 1 / -1;
  margin-left: 12px;
}

.assistant-history__project-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 2px;
}

.assistant-history__project-row {
  color: var(--ui-text-muted);
  gap: 9px;
  padding-left: 0;
}

.assistant-history__project-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-height: 32px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  padding: 0;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
  opacity: 0.72;
  transition: opacity 0.14s ease;
}

.assistant-history__project-group:hover .assistant-history__project-add,
.assistant-history__project-group:focus-within .assistant-history__project-add,
.assistant-history__project-add:hover,
.assistant-history__project-add:focus-visible {
  opacity: 1;
  background: color-mix(in oklab, var(--ui-surface) 64%, transparent);
  color: var(--ui-text);
}

.assistant-history__project-row.is-active,
.assistant-history__thread-row.is-active {
  background: var(--ui-surface);
  color: var(--ui-text);
}

.assistant-history__thread-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  width: 100%;
}

.assistant-history__thread-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px;
  min-width: 0;
  border-radius: var(--ui-radius-sm);
}

.assistant-history__thread-row .assistant-history__thread {
  flex: 1 1 auto;
}

.assistant-history__thread-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding-right: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.assistant-history__thread-row:hover .assistant-history__thread-actions,
.assistant-history__thread-row:focus-within .assistant-history__thread-actions,
.assistant-history__thread-row.is-active .assistant-history__thread-actions {
  opacity: 1;
  pointer-events: auto;
}

.assistant-history__thread-title,
.assistant-history__thread-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-history__thread-title {
  flex: 1 1 auto;
  color: inherit;
  font-size: 11px;
  font-weight: 450;
  line-height: 1.25;
}

.assistant-history__thread-meta {
  flex: 0 0 auto;
}

.assistant-history__thread-meta,
.assistant-history__message {
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.assistant-history__message {
  margin: 0;
  padding: 8px;
}

.assistant-history__footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: auto;
  padding: 8px 0 0;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-surface-muted);
}

.assistant-history__footer-icon,
.assistant-history__footer-chat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 48px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  padding: 0;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  cursor: pointer;
}

.assistant-history__footer-icon {
  flex: 0 0 48px;
  width: 48px;
}

.assistant-history__footer-chat {
  flex: 0 0 auto;
  padding: 0 8px;
  font-size: 14px;
  font-weight: 650;
}

.assistant-history__footer-spacer {
  flex: 1 1 auto;
}

.assistant-history__footer-icon:hover,
.assistant-history__footer-chat:hover {
  background: var(--ui-surface);
  color: var(--ui-text);
}

.assistant-history-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  border: 0;
  background: color-mix(in oklab, var(--ui-bg) 42%, transparent);
}

.assistant-main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 0;
}

.assistant-topbar {
  display: none;
}

.assistant-mobile-nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0;
}

:global(#app-side-nav-mobile-page-controls:has(.assistant-mobile-nav)) {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 45;
  min-height: var(--app-shell-mobile-nav-height);
  height: var(--app-shell-mobile-nav-height);
  padding: var(--workspace-topbar-padding-block) 8px
    var(--workspace-topbar-padding-block)
    var(--app-shell-mobile-nav-leading-padding);
  align-items: center;
  pointer-events: none;
}

:global(.app-root:has(.assistant-page--history-open) .app-side-nav-mobile-bar) {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.assistant-mobile-nav__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex: 0 0 auto;
}

.assistant-topbar__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.model-picker {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
}

.model-picker__select-wrap {
  position: relative;
  display: inline-block;
  max-width: min(48vw, 220px);
  min-width: 0;
  vertical-align: middle;
}

.model-picker__select,
.model-picker__select-sizer {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
}

.model-picker__select-sizer {
  display: block;
  min-height: 32px;
  overflow: hidden;
  padding: 0 32px 0 6px;
  visibility: hidden;
  white-space: nowrap;
}

.model-picker__select {
  position: absolute;
  inset: 0;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-height: 32px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
}

.model-picker__status {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  max-width: 88px;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-picker__status--ready {
  color: var(--ui-success, #1f8f55);
}

.model-picker__status--setup {
  color: var(--ui-warning, #b26a00);
}

.model-picker__status--link {
  text-decoration: none;
}

.model-picker__status--link:hover,
.model-picker__status--link:focus-visible {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.model-picker__status--unknown {
  color: var(--ui-text-muted);
}

.model-picker__select:focus,
.model-picker__select:focus-visible,
.assistant-input:focus,
.assistant-input:focus-visible {
  outline: none;
}

.assistant-console {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: min(600px, 100%);
  max-width: 600px;
  min-height: 0;
  margin: 0 auto;
}

.assistant-timeline {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: var(--assistant-header-clearance) 0
    var(--assistant-composer-clearance);
}

.assistant-empty-state {
  display: grid;
  gap: 20px;
  justify-items: center;
  margin: 0 0 18px;
  padding: clamp(90px, 28vh, 250px) 0 10px;
  text-align: center;
}

.assistant-empty-state__heading {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
}

.assistant-empty-state__avatar {
  display: block;
  width: clamp(71px, 13.6vw, 95px);
  height: clamp(71px, 13.6vw, 95px);
  object-fit: contain;
}

.starter-prompt-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 520px;
}

.starter-prompt {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  padding: 0 10px;
  background: var(--ui-surface);
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.starter-prompt__icon {
  font-family:
    "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: 14px;
  line-height: 1;
}

.starter-prompt:hover {
  border-color: color-mix(in oklab, var(--ui-accent) 40%, var(--ui-border));
  background: var(--ui-surface-muted);
  color: var(--ui-text);
}

.assistant-message {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  scroll-margin-top: var(--assistant-header-clearance);
  scroll-margin-bottom: var(--assistant-composer-clearance);
}

.assistant-message--assistant {
  align-items: flex-start;
}

.assistant-message--user {
  align-items: flex-end;
}

.assistant-message__bubble {
  display: grid;
  gap: 6px;
  max-width: 88%;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 12px 14px;
  background: var(--ui-surface);
  color: var(--ui-text);
}

.assistant-message--assistant .assistant-message__bubble {
  width: 100%;
  max-width: 100%;
  border: 0;
  border-radius: 0;
  padding: 12px 0;
  background: transparent;
}

.assistant-message--user .assistant-message__bubble {
  border-color: color-mix(in oklab, var(--ui-accent) 36%, var(--ui-border));
  background: var(--ui-accent-soft);
  color: #12231d;
}

.assistant-message--user .assistant-message__content,
.assistant-message--user
  .assistant-message__content
  :deep(:where(p, strong, em, code, a)),
.assistant-message--user .assistant-message__meta,
.assistant-message--user .assistant-message__detail {
  color: #12231d;
}

.assistant-message__bubble--pending {
  display: inline-grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 4px 8px;
  color: var(--ui-text-muted);
}

.assistant-message__pending-detail {
  grid-column: 1 / -1;
  max-width: min(420px, 70vw);
  font-size: 12px;
  line-height: 1.35;
}

.assistant-message__content
  :deep(:where(p, ul, ol, blockquote, pre, h1, h2, h3)) {
  margin: 0;
}

.assistant-message__bubble p,
.assistant-message__content :deep(li) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.5;
}

.assistant-message__content {
  display: grid;
  gap: 10px;
}

.assistant-message__content :deep(strong) {
  font-weight: 800;
}

.assistant-message-attachments {
  display: grid;
  gap: 6px;
}

.assistant-message-attachment-image {
  display: grid;
  gap: 6px;
  width: min(420px, 100%);
  margin: 0;
}

.assistant-message-attachment-image__preview {
  display: block;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
}

.assistant-message-attachment-image__preview img {
  display: block;
  width: 100%;
  max-height: 360px;
  object-fit: contain;
}

.assistant-message-attachment-image__caption {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.3;
}

.assistant-message-attachment-image__caption span:first-child {
  color: var(--ui-text);
  font-weight: 700;
}

.assistant-message-attachment {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  max-width: 100%;
  gap: 6px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 4px 7px;
  background: color-mix(in oklab, var(--ui-surface) 78%, transparent);
  font-size: 12px;
  line-height: 1.2;
}

.assistant-message-attachment__name {
  overflow: hidden;
  max-width: min(280px, 48vw);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-message-attachment__meta {
  color: var(--ui-text-muted);
}

.assistant-message--user .assistant-message-attachment {
  border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border));
  background: color-mix(in oklab, var(--ui-surface) 58%, transparent);
}

.assistant-message__content :deep(:where(h1, h2, h3)) {
  color: var(--ui-text);
  font-weight: 800;
  line-height: 1.2;
}

.assistant-message__content :deep(h1) {
  font-size: 20px;
}

.assistant-message__content :deep(h2) {
  font-size: 17px;
}

.assistant-message__content :deep(h3) {
  font-size: 15px;
}

.assistant-message__content :deep(:where(ul, ol)) {
  display: grid;
  gap: 6px;
  padding-left: 20px;
}

.assistant-message__content :deep(blockquote) {
  border-left: 3px solid var(--ui-border-strong);
  padding-left: 12px;
  color: var(--ui-text-muted);
}

.assistant-message__content :deep(pre) {
  overflow-x: auto;
  border-radius: var(--ui-radius-sm);
  padding: 10px 12px;
  background: var(--ui-surface-muted);
}

.assistant-message__content :deep(code) {
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--ui-surface-muted);
  font-size: 0.92em;
}

.assistant-message__content :deep(pre code) {
  padding: 0;
  background: transparent;
  white-space: pre;
}

.assistant-message__content :deep(a) {
  color: var(--ui-accent);
  font-weight: 800;
  text-decoration: none;
}

.assistant-message__content :deep(a:hover) {
  text-decoration: underline;
}

.assistant-message__content :deep(hr) {
  width: 100%;
  height: 1px;
  border: 0;
  background: var(--ui-border);
}

.assistant-image-assets {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.assistant-image-asset {
  display: grid;
  gap: 8px;
  margin: 0;
}

.assistant-image-asset__preview {
  display: block;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-muted);
}

.assistant-image-asset__preview img {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
}

.assistant-image-asset__caption,
.assistant-image-asset__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.assistant-image-asset__caption span:first-child {
  color: var(--ui-text);
  font-weight: 700;
}

.assistant-image-asset__actions a {
  color: var(--ui-accent);
  font-weight: 800;
  text-decoration: none;
}

.assistant-image-asset__actions a:hover {
  text-decoration: underline;
}

.assistant-image-assets__details {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.assistant-image-assets__details summary {
  cursor: pointer;
  font-weight: 800;
}

.assistant-image-assets__details p {
  margin: 6px 0 0;
}

.assistant-message__meta,
.assistant-message__detail {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.assistant-message__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.assistant-message__actions a {
  color: var(--ui-accent);
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
}

.assistant-trace {
  margin-top: 4px;
  border-top: 1px solid var(--ui-border);
  padding-top: 6px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.assistant-trace__summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  color: var(--ui-text-muted);
  cursor: pointer;
  font-weight: 800;
  list-style: none;
}

.assistant-trace__summary::-webkit-details-marker {
  display: none;
}

.assistant-trace__summary:focus-visible {
  border-radius: var(--ui-radius-sm);
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.assistant-trace__rows {
  display: grid;
  gap: 4px;
  margin: 4px 0 0;
}

.assistant-trace__rows div {
  display: grid;
  grid-template-columns: minmax(70px, max-content) minmax(0, 1fr);
  gap: 8px;
}

.assistant-trace__rows dt,
.assistant-trace__rows dd {
  margin: 0;
}

.assistant-trace__rows dt {
  color: var(--ui-text-muted);
  font-weight: 800;
}

.assistant-trace__rows dd {
  color: var(--ui-text);
  overflow-wrap: anywhere;
}

.assistant-action-card-list {
  display: grid;
  gap: 6px;
  margin-top: 6px;
}

.assistant-action-card {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px 8px;
  color: var(--ui-text);
  font-size: 14px;
  line-height: 1.45;
}

.assistant-action-card__header {
  display: contents;
}

.assistant-action-card__title {
  display: contents;
}

.assistant-action-card__icon {
  display: none;
}

.assistant-action-card__title > div {
  display: contents;
}

.assistant-action-card__title h3,
.assistant-action-card__title p {
  margin: 0;
}

.assistant-action-card__title h3 {
  display: inline;
  color: var(--ui-text);
  font-size: inherit;
  font-weight: 800;
  line-height: inherit;
}

.assistant-action-card__title p {
  display: inline;
  color: var(--ui-text-muted);
  font-size: inherit;
  line-height: inherit;
}

.assistant-action-card__title p::before {
  content: "- ";
}

.assistant-action-card__status {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 700;
  line-height: inherit;
}

.assistant-action-card__status::before {
  content: "(";
}

.assistant-action-card__status::after {
  content: ")";
}

.assistant-action-card__status--complete {
  color: var(--ui-accent);
}

.assistant-action-card__status--draft,
.assistant-action-card__status--pending,
.assistant-action-card__status--pending_approval {
  color: color-mix(in oklab, #9a6400 78%, var(--ui-text));
}

.assistant-action-card__status--failed {
  color: color-mix(in oklab, #a32323 80%, var(--ui-text));
}

.assistant-action-card__facts {
  display: contents;
  margin: 0;
  padding: 0;
  border: 0;
}

.assistant-action-card__facts div {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
}

.assistant-action-card__facts div::before {
  content: "·";
  color: var(--ui-text-muted);
  margin-right: 2px;
}

.assistant-action-card__facts dt,
.assistant-action-card__facts dd {
  margin: 0;
}

.assistant-action-card__facts dt {
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 800;
  line-height: inherit;
}

.assistant-action-card__facts dt::after {
  content: ":";
}

.assistant-action-card__facts dd {
  color: var(--ui-text);
  font-size: 13px;
  line-height: inherit;
  overflow-wrap: anywhere;
}

.assistant-action-card__actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  justify-content: flex-start;
}

.assistant-action-card__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 0 10px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease,
    color 0.14s ease;
}

.assistant-action-card__button:hover {
  border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border));
  background: var(--ui-surface-muted);
}

.assistant-action-card__button--primary {
  border-color: var(--ui-accent);
  background: var(--ui-accent);
  color: var(--ui-accent-contrast);
}

.assistant-action-card__button--primary:hover {
  background: color-mix(in oklab, var(--ui-accent) 88%, var(--ui-text));
  color: var(--ui-accent-contrast);
}

.assistant-action-card__button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.assistant-email-draft-card {
  display: grid;
  gap: 12px;
  margin-top: 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 14px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

.assistant-email-draft-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.assistant-email-draft-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-accent-soft);
  color: var(--ui-accent);
}

.assistant-email-draft-card__title {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.assistant-email-draft-card__title h3,
.assistant-email-draft-card__title p,
.assistant-email-draft-card__hint {
  margin: 0;
}

.assistant-email-draft-card__title h3 {
  color: var(--ui-text);
  font-size: 14px;
  font-weight: 800;
  line-height: 1.2;
}

.assistant-email-draft-card__title p {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}

.assistant-email-draft-card--saved .assistant-email-draft-card__title p,
.assistant-email-draft-card--sent .assistant-email-draft-card__title p {
  color: var(--ui-accent);
}

.assistant-email-draft-card--failed .assistant-email-draft-card__title p,
.assistant-email-draft-card__hint {
  color: color-mix(in oklab, #a32323 82%, var(--ui-text));
}

.assistant-email-draft-card__fields {
  display: grid;
  gap: 10px;
}

.assistant-email-draft-card__field {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.assistant-email-draft-card__field > span {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
}

.assistant-email-draft-card__field input,
.assistant-email-draft-card__field textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 10px 11px;
  background: var(--ui-bg);
  color: var(--ui-text);
  font: inherit;
  font-size: 14px;
  line-height: 1.45;
}

.assistant-email-draft-card__field input {
  min-height: 44px;
}

.assistant-email-draft-card__field textarea {
  min-height: 170px;
  resize: vertical;
}

.assistant-email-draft-card__field input:focus,
.assistant-email-draft-card__field textarea:focus {
  border-color: var(--ui-accent);
  outline: none;
  box-shadow: 0 0 0 3px
    color-mix(in oklab, var(--ui-accent) 18%, transparent);
}

.assistant-email-draft-card__field input:disabled,
.assistant-email-draft-card__field textarea:disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.assistant-email-draft-card__hint {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}

.assistant-email-draft-card__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.assistant-email-draft-card__actions :deep(.me3-btn) {
  min-height: 44px;
}

.assistant-email-draft-card__link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--ui-accent);
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
}

.assistant-email-draft-card__link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.job-builder-card {
  display: grid;
  gap: 12px;
  margin-top: 6px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 14px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

.job-builder-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.job-builder-card__header h3,
.job-builder-card__header p {
  margin: 0;
}

.job-builder-card__header h3 {
  color: var(--ui-text);
  font-size: 15px;
  line-height: 1.25;
}

.job-builder-card__header p {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.4;
}

.job-builder-card__status {
  flex: 0 0 auto;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  padding: 4px 8px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.job-builder-card__status--valid,
.job-builder-card__status--active {
  border-color: color-mix(in oklab, var(--ui-accent) 36%, var(--ui-border));
  background: var(--ui-accent-soft);
  color: var(--ui-accent);
}

.job-builder-card__status--needs_setup,
.job-builder-card__status--draft,
.job-builder-card__status--paused {
  border-color: color-mix(in oklab, #c08a18 44%, var(--ui-border));
  background: color-mix(in oklab, #c08a18 12%, var(--ui-surface));
  color: color-mix(in oklab, #9a6400 78%, var(--ui-text));
}

.job-builder-card__status--invalid,
.job-builder-card__status--failing {
  border-color: color-mix(in oklab, #c73939 42%, var(--ui-border));
  background: color-mix(in oklab, #c73939 12%, var(--ui-surface));
  color: color-mix(in oklab, #a32323 80%, var(--ui-text));
}

.job-builder-card__sentence {
  margin: 0;
  color: var(--ui-text);
  font-size: 15px;
  line-height: 1.5;
}

.job-builder-card__sentence strong {
  font-weight: 800;
}

.job-builder-card__tools {
  margin: -4px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.35;
}

.job-builder-card__warnings {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 9px 10px 9px 26px;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.job-builder-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.job-builder-card__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 0 11px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease,
    color 0.14s ease;
}

.job-builder-card__button:hover:not(:disabled) {
  border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border));
  background: var(--ui-surface-muted);
}

.job-builder-card__button--primary {
  border-color: var(--ui-accent);
  background: var(--ui-accent);
  color: var(--ui-accent-contrast);
}

.job-builder-card__button--primary:hover:not(:disabled) {
  background: color-mix(in oklab, var(--ui-accent) 88%, var(--ui-text));
  color: var(--ui-accent-contrast);
}

.job-builder-card__button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.assistant-message__tools {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 0 4px;
  color: var(--ui-text-muted);
}

.assistant-message__time {
  font-size: 11px;
  line-height: 1;
}

.assistant-message-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.14s ease,
    background-color 0.14s ease,
    color 0.14s ease;
}

.assistant-message:hover .assistant-message-tool,
.assistant-message:focus-within .assistant-message-tool {
  opacity: 1;
  pointer-events: auto;
}

.assistant-message-tool:hover:not(:disabled) {
  background: var(--ui-surface-muted);
  color: var(--ui-text);
}

.assistant-message-tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.assistant-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.assistant-typing span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  animation: assistant-typing-bounce 1.1s infinite ease-in-out;
}

.assistant-typing span:nth-child(2) {
  animation-delay: 0.12s;
}

.assistant-typing span:nth-child(3) {
  animation-delay: 0.24s;
}

.assistant-composer {
  position: fixed;
  right: auto;
  bottom: max(14px, env(safe-area-inset-bottom, 0px));
  left: 50%;
  z-index: 40;
  display: grid;
  gap: 8px;
  width: min(600px, calc(100vw - 28px));
  max-width: 600px;
  margin-inline: auto;
  border: 1px solid var(--ui-border);
  border-radius: 24px;
  padding: 10px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm, 0 8px 24px rgba(15, 23, 42, 0.08));
  transform: translateX(-50%);
}

.assistant-composer--drag-active {
  border-color: color-mix(in oklab, var(--ui-accent) 65%, var(--ui-border));
  background:
    linear-gradient(
      color-mix(in oklab, var(--ui-accent) 7%, transparent),
      color-mix(in oklab, var(--ui-accent) 7%, transparent)
    ),
    var(--ui-surface);
  box-shadow:
    0 0 0 3px color-mix(in oklab, var(--ui-accent) 14%, transparent),
    var(--ui-shadow-sm, 0 8px 24px rgba(15, 23, 42, 0.08));
}

.assistant-composer__bottom,
.assistant-composer__left,
.assistant-composer__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.assistant-composer__bottom {
  justify-content: space-between;
  min-width: 0;
}

.assistant-composer__left,
.assistant-composer__right {
  flex-shrink: 0;
}

.assistant-composer__right {
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-end;
}

.assistant-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 44px;
}

.assistant-input {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 160px;
  resize: none;
  border: 0;
  border-radius: 12px;
  padding: 6px 2px 2px;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 15px;
  line-height: 1.45;
}

.assistant-input::placeholder {
  color: color-mix(in oklab, var(--ui-text-muted) 70%, transparent);
}

.assistant-input__transcribing {
  display: flex;
  align-items: flex-start;
  min-height: 44px;
  width: 100%;
  padding: 6px 2px 2px;
  pointer-events: none;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 15px;
  line-height: 1.45;
}

.assistant-input__transcribing span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.assistant-input__transcribing-ellipsis {
  display: inline-block;
  width: 0;
  overflow: hidden;
  vertical-align: bottom;
  animation: assistantTranscribingEllipsis 1.2s steps(4, end) infinite;
}

@keyframes assistantTranscribingEllipsis {
  to {
    width: 0.75em;
  }
}

.assistant-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.assistant-attachment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  padding: 2px 4px 2px 9px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1;
}

.assistant-attachment--error {
  border-color: color-mix(
    in oklab,
    var(--ui-warning, #b26a00) 45%,
    var(--ui-border)
  );
  color: var(--ui-warning, #b26a00);
}

.assistant-attachment__thumb {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 999px;
  object-fit: cover;
}

.assistant-attachment__uploading {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 2px solid color-mix(in oklab, var(--ui-text-muted) 24%, transparent);
  border-top-color: var(--ui-accent);
  border-radius: 999px;
  animation: assistant-attachment-spin 0.8s linear infinite;
}

@keyframes assistant-attachment-spin {
  to {
    transform: rotate(360deg);
  }
}

.assistant-attachment__name {
  min-width: 0;
  max-width: 170px;
  overflow: hidden;
  color: var(--ui-text);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-attachment__meta {
  flex: 0 0 auto;
  color: inherit;
}

.assistant-attachment__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.assistant-attachment__remove:hover {
  background: var(--ui-surface);
  color: var(--ui-text);
}

@media (prefers-reduced-motion: reduce) {
  .assistant-attachment__uploading {
    animation: none;
  }
}

.composer-icon-button,
.assistant-send {
  flex: 0 0 auto;
}

.assistant-send.me3-btn--primary {
  background: color-mix(in oklab, var(--ui-text-muted) 80%, var(--ui-surface));
  border-color: transparent;
  color: var(--ui-surface);
}

.assistant-send--stop.me3-btn--secondary {
  background: var(--ui-surface-muted);
  border-color: transparent;
  color: var(--ui-text);
}

.assistant-send:not(:disabled):hover {
  background: var(--ui-text);
}

.assistant-send--stop:not(:disabled):hover {
  background: var(--ui-border);
}

.assistant-send:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--ui-accent) 35%, transparent);
  outline-offset: 2px;
}

.assistant-composer__meta {
  display: flex;
  align-items: center;
  min-height: 16px;
  width: 100%;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.assistant-composer__voice-status {
  color: var(--ui-accent-strong);
  font-weight: 700;
}

.assistant-composer__voice-wave {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 24px;
  color: var(--ui-text-muted);
}

.assistant-composer__voice-bars {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.assistant-composer__voice-bars span {
  width: 2px;
  height: 10px;
  border-radius: 999px;
  background: var(--ui-accent);
  animation: assistantVoiceWave 1.6s ease-in-out infinite alternate;
  animation-delay: calc(var(--voice-bar-index) * -70ms);
  transform-origin: center;
}

.assistant-composer__voice-bars span:nth-child(6n + 1) {
  height: 6px;
}

.assistant-composer__voice-bars span:nth-child(6n + 2) {
  height: 12px;
}

.assistant-composer__voice-bars span:nth-child(6n + 3) {
  height: 18px;
}

.assistant-composer__voice-bars span:nth-child(6n + 4) {
  height: 14px;
}

.assistant-composer__voice-bars span:nth-child(6n + 5) {
  height: 8px;
}

@keyframes assistantVoiceWave {
  from {
    transform: scaleY(0.58);
    opacity: 0.36;
  }

  to {
    transform: scaleY(1.08);
    opacity: 0.7;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-composer__voice-bars span,
  .assistant-input__transcribing-ellipsis {
    animation: none;
  }

  .assistant-composer__voice-bars span {
    opacity: 0.58;
  }

  .assistant-input__transcribing-ellipsis {
    width: 0.75em;
  }
}

.assistant-composer__attachment-status {
  color: var(--ui-text-muted);
  font-weight: 650;
}

.assistant-archived-list {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.assistant-archived-thread {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 8px;
  background: var(--ui-surface-muted);
}

.assistant-archived-thread__main {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.assistant-archived-thread__main:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.assistant-archived-thread__main span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.assistant-archived-thread__main strong,
.assistant-archived-thread__main small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-archived-thread__main strong {
  font-size: 13px;
  font-weight: 650;
}

.assistant-archived-thread__main small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.assistant-archived-thread__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.assistant-archived-thread__actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}

.assistant-archived-thread__actions button:hover:not(:disabled) {
  background: var(--ui-surface);
  color: var(--ui-text);
}

.assistant-archived-thread__actions button:disabled {
  cursor: not-allowed;
}

.assistant-error {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.assistant-error a {
  margin-left: 6px;
  color: var(--ui-text);
  font-weight: 700;
  text-decoration: underline;
}

.assistant-modal__header p {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.assistant-settings-dialog {
  position: relative;
  max-height: min(760px, calc(100vh - 48px));
}

.assistant-settings {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  overflow: auto;
  scrollbar-color: color-mix(in oklab, var(--ui-text-muted) 38%, transparent)
    transparent;
  scrollbar-width: thin;
}

.assistant-settings::-webkit-scrollbar,
.assistant-settings__panel::-webkit-scrollbar {
  width: 8px;
}

.assistant-settings::-webkit-scrollbar-track,
.assistant-settings__panel::-webkit-scrollbar-track {
  background: transparent;
}

.assistant-settings::-webkit-scrollbar-thumb,
.assistant-settings__panel::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in oklab, var(--ui-text-muted) 30%, transparent);
}

.assistant-settings::-webkit-scrollbar-thumb:hover,
.assistant-settings__panel::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklab, var(--ui-text-muted) 44%, transparent);
}

.assistant-settings__tabs {
  max-width: 100%;
}

.assistant-settings__tabs :deep(.workspace-tabs__tab) {
  background: var(--ui-surface-muted);
}

.assistant-settings__tabs :deep(.workspace-tabs__tab--active) {
  border-bottom-color: var(--ui-surface);
  background: var(--ui-surface);
}

.assistant-settings__tabs
  :deep(.workspace-tabs__tab--active .workspace-tabs__count) {
  background: var(--ui-surface-muted);
}

.assistant-settings__panel {
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
  max-height: min(620px, calc(100vh - 190px));
  overflow: auto;
  border: 1px solid var(--ui-border);
  border-radius: 0 var(--ui-radius-sm) var(--ui-radius-sm) var(--ui-radius-sm);
  padding: 14px 16px 14px 14px;
  background: var(--ui-surface);
  scrollbar-color: color-mix(in oklab, var(--ui-text-muted) 38%, transparent)
    transparent;
  scrollbar-width: thin;
}

.assistant-settings__panel-header,
.assistant-settings__block-header,
.assistant-settings-row,
.assistant-settings-row__heading,
.assistant-settings-row__activity-head,
.assistant-settings-row__actions,
.assistant-settings__header-actions,
.assistant-settings-row__aside {
  display: flex;
  align-items: center;
}

.assistant-settings__panel-header,
.assistant-settings__block-header,
.assistant-settings-row {
  justify-content: space-between;
  gap: 14px;
}

.assistant-settings__panel-header {
  min-height: 38px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border);
}

.assistant-settings__panel-header h3,
.assistant-settings__panel-header p,
.assistant-settings__block-header h4,
.assistant-settings__block-header p,
.assistant-settings-row h4,
.assistant-settings-row p {
  margin: 0;
}

.assistant-settings__panel-header h3,
.assistant-settings__block-header h4,
.assistant-settings-row h4 {
  color: var(--ui-text);
  font-size: 15px;
  line-height: 1.25;
}

.assistant-settings__panel-header p,
.assistant-settings__block-header p,
.assistant-settings-row p,
.assistant-settings-row__meta,
.assistant-settings-row__aside {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.assistant-settings__header-actions {
  gap: 6px;
  flex: 0 0 auto;
}

.assistant-settings__block {
  display: grid;
  gap: 0;
  min-width: 0;
}

.assistant-settings__block + .assistant-settings__block {
  padding-top: 6px;
}

.assistant-settings__block-header {
  padding-bottom: 8px;
}

.assistant-settings__block-header span {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.assistant-settings-inline-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px;
  gap: 6px;
  align-items: center;
  margin: 2px 0 4px;
  padding: 5px;
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-muted);
}

.assistant-settings-inline-form input {
  width: 100%;
  min-width: 0;
  min-height: 38px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  padding: 0 10px;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
}

.assistant-settings-inline-form input:focus {
  outline: 2px solid color-mix(in oklab, var(--ui-accent), transparent 70%);
  outline-offset: 1px;
}

.assistant-settings-name-form {
  grid-template-columns: minmax(0, 1fr) auto;
}

.assistant-settings-name-form .me3-btn {
  min-height: 38px;
}

.assistant-settings-field-note {
  margin: 3px 0 6px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.assistant-settings-field-note--error {
  color: var(--ui-danger, #dc2626);
}

.assistant-settings-row {
  align-items: flex-start;
  padding: 13px 0;
  border-bottom: 1px solid var(--ui-border);
}

.assistant-settings-row--pending {
  border-color: color-mix(in oklab, #b45309, var(--ui-border) 72%);
}

.assistant-settings-row--missing {
  border-color: color-mix(in oklab, #dc2626 55%, var(--ui-border));
  background: color-mix(in oklab, #dc2626 5%, transparent);
  border-radius: var(--ui-radius-sm);
  padding-inline: 10px;
}

.assistant-settings-row__main {
  display: grid;
  flex: 1 1 auto;
  gap: 5px;
  width: 100%;
  min-width: 0;
}

.assistant-settings-row__heading {
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.assistant-settings-row p {
  overflow-wrap: anywhere;
}

.assistant-settings-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.assistant-settings-row__meta span {
  overflow-wrap: anywhere;
}

.assistant-settings-row__priority {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border: 1px solid color-mix(in oklab, var(--ui-accent) 35%, var(--ui-border));
  border-radius: var(--ui-radius-sm);
  padding: 3px 7px;
  background: color-mix(in oklab, var(--ui-accent-soft) 70%, var(--ui-surface));
  color: var(--ui-text);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
}

.assistant-settings-row__actions {
  flex: 0 0 auto;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  min-width: 104px;
}

.assistant-settings-row__actions .me3-btn {
  justify-content: center;
  gap: 6px;
  width: 100%;
}

.assistant-settings-row__delete {
  margin-left: auto;
}

.assistant-settings-row__kind {
  color: var(--ui-accent);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.assistant-settings-row__activity-head {
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 7px;
  min-width: 0;
}

.assistant-settings-row__activity-head h4 {
  font-size: 14px;
  font-weight: 650;
  line-height: 1.25;
}

.assistant-settings-row--activity .assistant-settings-row__main p {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.assistant-settings-row--activity {
  padding: 10px 0;
}

.assistant-settings-row--activity .assistant-settings-row__main {
  width: 100%;
  gap: 4px;
}

.assistant-settings-row--activity h4 {
  min-width: 0;
  overflow-wrap: anywhere;
}

.assistant-settings-row__time {
  margin-left: auto;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}

.assistant-settings-row__aside {
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  text-align: right;
}

.assistant-settings__error {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--ui-radius-sm);
  background: color-mix(in oklab, #e53935 10%, var(--ui-surface));
  color: #b91c1c;
  font-size: 13px;
  line-height: 1.4;
}

.needs-you {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 4px 8px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.needs-you {
  border-color: color-mix(in oklab, var(--ui-accent) 50%, var(--ui-border));
  background: var(--ui-accent-soft);
  color: var(--ui-text);
}

.panel {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  overflow: hidden;
}

.detail-section h3,
.assistant-placeholder p {
  margin: 0;
  font-size: 17px;
  line-height: 1.25;
  letter-spacing: 0;
}

.detail-section h3 {
  font-size: 15px;
}

.assistant-placeholder {
  display: grid;
  justify-items: center;
  gap: 18px;
  width: min(550px, 100%);
  align-content: center;
  padding: 28px 18px;
  text-align: center;
}

.assistant-placeholder p {
  max-width: 430px;
  color: var(--ui-text);
  font-size: clamp(28px, 5vw, 38px);
  font-weight: 800;
  line-height: 1.08;
}

.assistant-placeholder__image {
  display: block;
  width: min(68vw, 240px);
  height: min(68vw, 240px);
  object-fit: cover;
  border-radius: 50%;
  box-shadow: var(--ui-shadow-md, 0 22px 70px rgba(15, 23, 42, 0.14));
}

.assistant-placeholder :deep(.me3-btn--compact) {
  min-height: 44px;
  padding: 0 18px;
  font-size: 14px;
}

.job-list {
  display: grid;
  gap: 8px;
}

.job-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
}

.job-row--selected {
  border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-border));
  background: color-mix(in oklab, var(--ui-accent-soft) 42%, var(--ui-surface));
}

.job-row--muted,
.job-row--inactive {
  opacity: 0.76;
}

.job-row__emoji {
  flex-shrink: 0;
  font-size: 21px;
  line-height: 1;
  font-family:
    "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}

.job-row__main {
  flex: 1;
  min-width: 0;
  padding: 0;
}

.job-row__main:focus-visible,
button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.job-row__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.job-row__title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.job-row__title-line strong {
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.3;
}

.job-row__meta {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.job-row__actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.job-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.job-toggle.is-busy {
  cursor: wait;
  opacity: 0.72;
}

.job-toggle__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.job-toggle__track {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--ui-border);
  position: relative;
  transition: background 0.2s ease;
}

.job-toggle__track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--ui-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: transform 0.2s ease;
}

.job-toggle__input:checked + .job-toggle__track {
  background: var(--ui-accent);
}

.job-toggle__input:checked + .job-toggle__track::after {
  transform: translateX(18px);
}

.job-toggle__input:focus-visible + .job-toggle__track {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.job-toggle__input:disabled + .job-toggle__track {
  opacity: 0.55;
  cursor: not-allowed;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border-radius: var(--ui-radius-sm);
  padding: 3px 7px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
}

.status-badge--active,
.status-badge--ready {
  background: var(--ui-accent-soft);
  color: var(--ui-text);
}

.status-badge--needs_setup,
.status-badge--setup_required,
.status-badge--needs_review,
.status-badge--failing {
  border: 1px solid color-mix(in oklab, #d97706 45%, var(--ui-border));
  background: color-mix(in oklab, #d97706 12%, var(--ui-surface));
  color: var(--ui-text);
}

.status-badge--failed {
  border: 1px solid color-mix(in oklab, #dc2626 55%, var(--ui-border));
  background: color-mix(in oklab, #dc2626 12%, var(--ui-surface));
  color: var(--ui-text);
}

.status-badge--paused,
.status-badge--draft,
.status-badge--manual_only,
.status-badge--coming_later {
  border: 1px solid var(--ui-border);
}

.notice {
  border: 1px solid color-mix(in oklab, var(--ui-accent) 40%, var(--ui-border));
  border-radius: var(--ui-radius-md);
  padding: 12px;
  background: var(--ui-accent-soft);
  color: var(--ui-text);
  font-size: 14px;
  line-height: 1.45;
}

.notice a {
  color: var(--ui-accent-strong);
  font-weight: 700;
}

.notice--error {
  border-color: color-mix(in oklab, #e53935 42%, var(--ui-border));
  background: color-mix(in oklab, #e53935 10%, var(--ui-surface));
}

.empty-row {
  padding: 24px 16px;
  color: var(--ui-text-muted);
  font-size: 14px;
  text-align: center;
}

.detail-facts {
  display: grid;
  grid-template-columns: 1fr;
  row-gap: 10px;
  margin: 0;
}

.detail-facts__runs,
.detail-facts__meta > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.detail-facts__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: 20px;
  align-items: start;
}

.detail-facts dt {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 800;
}

.detail-facts dd {
  margin: 0;
  color: var(--ui-text);
  font-size: 12px;
  line-height: 1.35;
}

.job-result-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 12px;
  background: var(--ui-surface-muted);
}

.job-result-strip__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.job-result-strip__copy strong {
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}

.job-result-strip__copy span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.detail-facts__schedule {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.detail-facts__schedule--editing {
  display: block;
}

.schedule-inline {
  display: inline-flex;
  flex-flow: row nowrap;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  vertical-align: top;
}

.schedule-inline__input {
  display: inline-block;
  flex: 0 0 auto;
  width: auto;
  min-height: 30px;
  max-width: 9.5rem;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 0 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
}

.schedule-inline__input--time {
  width: 7.25rem;
  max-width: none;
}

.schedule-inline__input--day {
  width: 4.25rem;
  max-width: none;
}

.schedule-inline__input:focus-visible {
  border-color: var(--ui-accent);
  outline: 2px solid color-mix(in oklab, var(--ui-accent) 35%, transparent);
  outline-offset: 1px;
}

.schedule-inline__actions {
  display: inline-flex;
  flex-shrink: 0;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
}

.detail-section {
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--ui-border);
  padding-top: 16px;
}

.inbox-watch-settings__header,
.inbox-watch-settings__actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.inbox-watch-settings__header p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.4;
}

.inbox-watch-rule-list {
  display: grid;
  gap: 12px;
}

.inbox-watch-rule {
  display: grid;
  gap: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 12px;
  background: var(--ui-surface-muted);
}

.inbox-watch-rule__top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(132px, 160px) auto auto;
  align-items: end;
  gap: 10px;
}

.inbox-watch-rule__toggle {
  min-height: 40px;
  align-items: center;
}

.inbox-watch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.inbox-watch-field {
  display: grid;
  gap: 7px;
  min-width: 0;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 800;
}

.inbox-watch-field input,
.inbox-watch-field select,
.inbox-watch-field textarea {
  width: 100%;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
}

.inbox-watch-field input,
.inbox-watch-field select {
  min-height: 40px;
  padding: 0 10px;
}

.inbox-watch-field textarea {
  min-height: 78px;
  resize: vertical;
  padding: 9px 10px;
  line-height: 1.4;
}

.inbox-watch-field input:focus-visible,
.inbox-watch-field select:focus-visible,
.inbox-watch-field textarea:focus-visible {
  border-color: var(--ui-accent);
  outline: 2px solid color-mix(in oklab, var(--ui-accent) 35%, transparent);
  outline-offset: 1px;
}

.inbox-watch-checks,
.inbox-watch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.inbox-watch-labels {
  display: grid;
  gap: 8px;
}

.inbox-watch-labels__title {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
}

.checkbox-pill,
.checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  color: var(--ui-text);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.2;
  cursor: pointer;
}

.checkbox-pill {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 5px 8px;
  background: var(--ui-surface);
}

.checkbox-pill input,
.checkbox-row input {
  margin: 0;
}

.briefing-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.briefing-settings__header h3 {
  margin: 0;
}

.briefing-settings__columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.briefing-settings__editor {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.briefing-template-field {
  display: block;
  min-width: 0;
}

.briefing-template-field__textarea {
  display: block;
  width: 100%;
  min-height: 11rem;
  resize: vertical;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 10px 12px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
}

.briefing-variable-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.briefing-variable-chip {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 2px 6px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
}

.briefing-preview {
  display: grid;
  gap: 8px;
  min-width: 0;
  min-height: 100%;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 12px;
  background: var(--ui-surface-muted);
}

.briefing-preview__label {
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
}

.briefing-preview p {
  margin: 0;
  white-space: pre-line;
  color: var(--ui-text);
  font-size: 14px;
  line-height: 1.45;
}

.inline-notice {
  align-self: center;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.assistant-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in oklab, #000, transparent 62%);
}

.assistant-modal--stacked {
  z-index: 110;
}

.assistant-modal__dialog {
  display: grid;
  gap: 16px;
  width: min(600px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  overflow: auto;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  color: var(--ui-text);
  padding: 18px;
  box-shadow: 0 24px 80px color-mix(in oklab, #000, transparent 78%);
}

.assistant-modal__dialog--wide {
  width: min(600px, 100%);
}

.assistant-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.assistant-modal__header--icon-only {
  justify-content: flex-end;
}

.assistant-settings-dialog .assistant-modal__header--icon-only {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 3;
}

.assistant-modal__header-copy {
  min-width: 0;
}

.assistant-modal__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.assistant-modal__header h2 {
  margin: 0;
  font-size: 17px;
  line-height: 1.25;
  letter-spacing: 0;
}

.assistant-modal__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.assistant-modal-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  padding: 0 10px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.assistant-modal-action:hover {
  border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border));
  background: var(--ui-surface-muted);
}

.assistant-modal-icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text-muted);
  cursor: pointer;
}

.assistant-modal-icon-action:hover {
  border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border));
  background: var(--ui-surface-muted);
  color: var(--ui-text);
}

.modal-close {
  flex: 0 0 auto;
}

.assistant-modal__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ui-border);
}

@media (max-width: 760px) {
  .assistant-page {
    --assistant-composer-clearance: 110px;
    --assistant-header-clearance: calc(
      var(--app-shell-mobile-nav-height) + 14px
    );

    max-width: 100%;
    overflow-x: clip;
  }

  .assistant-main,
  .assistant-console,
  .assistant-composer {
    max-width: 100%;
  }

  .assistant-page :is(input, select, textarea) {
    font-size: max(16px, 1em);
  }

  .assistant-page .model-picker__select-sizer {
    font-size: max(16px, 1em);
  }

  .assistant-page-tools {
    display: none;
  }

  .assistant-timeline {
    padding-top: var(--assistant-header-clearance);
  }

  .assistant-empty-state {
    gap: 12px;
    margin-bottom: 10px;
  }

  .assistant-message__bubble {
    max-width: 94%;
  }

  .assistant-composer {
    border-radius: 20px;
  }

  .job-row {
    align-items: flex-start;
    position: relative;
    min-height: 82px;
    padding: 12px 86px 12px 12px;
  }

  .job-row__main {
    flex: 1 1 auto;
  }

  .job-row__actions {
    position: absolute;
    top: 12px;
    right: 12px;
    width: auto;
    justify-content: flex-end;
    padding-top: 0;
  }

  .detail-facts__meta {
    grid-template-columns: 1fr;
    row-gap: 8px;
  }

  .job-result-strip {
    align-items: stretch;
    flex-direction: column;
  }

  .briefing-settings__columns {
    grid-template-columns: 1fr;
  }

  .inbox-watch-settings__header,
  .inbox-watch-settings__actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .inbox-watch-rule__top,
  .inbox-watch-grid {
    grid-template-columns: 1fr;
  }

  .inbox-watch-rule__top {
    align-items: stretch;
  }

  .inbox-watch-rule__toggle {
    min-height: 28px;
  }

  .assistant-modal {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0;
  }

  .assistant-modal__dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    align-self: stretch;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    border-radius: 0;
  }

  .assistant-modal__header {
    flex-shrink: 0;
    align-items: center;
  }

  .assistant-modal__header h2 {
    font-size: 16px;
  }

  .assistant-settings {
    flex: 1 1 auto;
    overflow: auto;
  }

  .assistant-settings__tabs {
    position: sticky;
    top: 0;
    z-index: 2;
    padding-bottom: 0;
    background: var(--ui-surface);
  }

  .assistant-settings__panel {
    max-height: none;
    overflow: visible;
    padding: 14px 14px 14px 14px;
  }

  .assistant-settings-row {
    flex-direction: column;
    gap: 8px;
  }

  .assistant-settings-row__actions {
    flex-direction: row;
    width: 100%;
    min-width: 0;
  }

  .assistant-settings-row__actions .me3-btn {
    width: auto;
  }

  .assistant-settings-row__aside {
    align-items: flex-start;
    text-align: left;
  }

  .assistant-settings-row__time {
    margin-left: 0;
  }
}

@media (max-width: 620px) {
  .assistant-page--site-builder {
    height: auto;
    min-height: 100dvh;
    overflow: auto;
  }

  .assistant-workspace--site-builder {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100dvh;
  }

  .assistant-page--site-builder .assistant-main {
    height: 100dvh;
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }

  .assistant-site-preview {
    min-height: 72dvh;
  }

  .assistant-site-preview__toolbar {
    right: 18px;
    max-width: calc(100% - 36px);
    overflow-x: auto;
  }
}

@keyframes assistant-typing-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }

  40% {
    transform: translateY(-3px);
    opacity: 1;
  }
}
</style>

<style scoped>
.home-chat-header { margin-top: var(--app-shell-mobile-nav-height, 0px); position: sticky; top: var(--app-shell-mobile-nav-height, 0px); z-index: 35; display: flex; align-items: center; justify-content: center; min-height: 60px; background: var(--ui-bg); }
.home-chat-header::after { content: ""; position: absolute; top: 100%; left: 0; right: 0; height: 14px; pointer-events: none; background: linear-gradient(var(--ui-bg), transparent); }
.home-chat-switcher { display: flex; padding: 3px; border-radius: 28px; background: var(--ui-surface-muted); }
.home-chat-switcher button { min-width: 68px; min-height: 38px; padding: 0 14px; border: 0; border-radius: 22px; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 14px; cursor: pointer; }
.home-chat-switcher button[aria-pressed="true"] { color: var(--ui-text); background: var(--ui-surface); box-shadow: 0 1px 3px color-mix(in srgb, var(--ui-text) 8%, transparent); }
.home-profile { position: absolute; right: 0; width: 44px; height: 44px; display: grid; place-items: center; font-size: 14px; color: var(--ui-text); text-decoration: none; }
.home-profile::before { position: absolute; content: ""; inset: 6px; border-radius: 50%; background: var(--ui-surface-muted); z-index: -1; }
.assistant-home { height: calc(100dvh - var(--app-shell-mobile-nav-height, 0px) - 154px); overflow-y: auto; overscroll-behavior: contain; scroll-padding-top: 18px; align-content: start; padding: 18px 0 12px; box-sizing: border-box; }
.assistant-page:not(.assistant-page--site-builder) .assistant-timeline { padding-top: 18px; }
.assistant-composer { grid-template-columns: minmax(0, 1fr) auto; align-items: end; padding: 5px 6px 5px 16px; gap: 0 4px; min-height: 56px; box-sizing: border-box; }
.assistant-composer .assistant-attachments, .assistant-composer > p, .assistant-composer > .sr-only { grid-column: 1 / -1; }
.assistant-input-wrap { min-width: 0; min-height: 44px; }
.assistant-input { min-height: 44px; box-sizing: border-box; padding: 11px 0; font-size: 16px; line-height: 22px; }
.assistant-composer__bottom, .assistant-composer__right { gap: 0; flex: 0 0 auto; }
.assistant-composer__bottom { min-width: 0; }
.composer-icon-button, .assistant-send { min-width: 44px; min-height: 44px; }
.composer-options { position: relative; }
.composer-options summary { list-style: none; display: grid; place-items: center; cursor: pointer; width: 44px; height: 44px; border-radius: 50%; }
.composer-options summary::-webkit-details-marker { display: none; }
.composer-options summary:hover { background: var(--ui-surface-muted); }
.composer-options__menu { position: absolute; right: 0; bottom: calc(100% + 12px); z-index: 60; padding: 10px; min-width: 250px; display: grid; gap: 8px; background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 16px; box-shadow: 0 8px 24px color-mix(in srgb, var(--ui-text) 10%, transparent); }
.composer-options__menu > button { display: flex; align-items: center; gap: 8px; min-height: 44px; background: transparent; color: var(--ui-text); border: 0; border-radius: 10px; padding: 0 10px; font: inherit; cursor: pointer; text-align: left; }
.composer-options__menu .model-picker { flex-wrap: wrap; padding: 8px; }
.home-chat-header button:focus-visible, .home-profile:focus-visible, .composer-options summary:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }

</style>

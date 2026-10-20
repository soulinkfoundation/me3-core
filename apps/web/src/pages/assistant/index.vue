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
import { api, type ApiStreamEvent } from "../../api";
import { MISSION_DRAFT_PROMPT, ownMissionStatement } from "../../utils/missionStatement";
import Button from "../../components/Button.vue";
import HomePanels from "../../components/home/HomePanels.vue";
import AgentTargetChoices from "../../components/AgentTargetChoices.vue";
import { normalizeAgentTargetPresentation, targetChoiceRequest, type AgentTargetChoice, type AgentTargetPresentation } from "../../utils/agentTargetChoices";
import ComposerPrompt from "../../components/ComposerPrompt.vue";
import PageLoading from "../../components/PageLoading.vue";
import UiIcon from "../../components/UiIcon.vue";
import {
  useAgentChat,
  type AgentChatMessageAttachment,
} from "../../composables/useAgentChat";
import { useAppToast } from "../../composables/useAppToast";
import { useAgentChatPresence } from "../../composables/useAgentChatPresence";
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
  type AgentChatAllowanceNotice,
  type AgentChatServerEmailDraft,
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
import AgentDog from "../../components/AgentDog.vue";
import ChatPayments from "../../components/payments/ChatPayments.vue";

definePage({
  meta: {
    requiresAuth: true,
    hideAgentLauncher: true,
    title: "Assistant | ME3",
    description: "Chat with ME3 and manage your assistant.",
    robots: "noindex,follow",
  },
});

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
  targetPresentation?: AgentTargetPresentation | null;
  allowanceNotice?: AgentChatAllowanceNotice | null;
  emailDraft?: AgentChatServerEmailDraft | null;
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
  targetPresentation?: AgentTargetPresentation | null;
  allowanceNotice?: AgentChatAllowanceNotice | null;
  emailDraft?: AgentChatServerEmailDraft | null;
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
  originSurface: "assistant" | "launcher" | "soulink" | "system";
  projectId: string | null;
  status: "active" | "archived" | "deleted";
  pinnedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type AssistantSettingsResponse = {
  assistantName: string | null;
  displayName: string;
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
  hasMore?: boolean;
};

const ASSISTANT_HISTORY_PAGE_SIZE = 50;

const { toastSuccess, toastFromUnknown, toastError } = useAppToast();
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

const chatMessages = agentChat.messages;
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
const assistantHistoryHasMore = ref(false);
const assistantHistoryLoadingOlder = ref(false);
const assistantSettingsError = ref("");
const assistantSettings = ref<AssistantSettingsResponse>({
  assistantName: null,
  displayName: "ME3",
});
const copiedMessageKey = ref<string | null>(null);
const homePanels = ref<InstanceType<typeof HomePanels> | null>(null);
const homeMode = ref(route.query.view === "home" || (!route.query.thread && !route.query.new && !route.query.prompt && !route.query.project && route.query.view !== "chat"));
useAgentChatPresence(assistantThreadId, computed(() => !homeMode.value));
async function showWorkspace(home: boolean) {
  dismissComposer();
  homeMode.value = home;
  await router.replace({ query: { ...route.query, view: home ? "home" : "chat" } });
}
const composerFocused = ref(false);
const composerMenu = ref<HTMLDetailsElement | null>(null);
function homeSuggestion(text: string) {
  assistantDraft.value = text;
  void showWorkspace(false);
  void nextTick(() => { autosizeAssistantComposer(); assistantComposerRef.value?.focus(); });
}
const assistantComposerRef = ref<HTMLTextAreaElement | null>(null);
function dismissComposer() { assistantComposerRef.value?.blur(); }
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
  stop: stopVoiceDictation,
  elapsedLabel: voiceDictationElapsed,
} = useVoiceDictation({
  disabled: () => assistantSending.value,
  filenamePrefix: "assistant-dictation",
  onStart: () => {
    if (homeMode.value) void showWorkspace(false);
    assistantError.value = null;
  },
  onTranscript: insertVoiceTranscript,
});
watch(assistantError, message => { if (message && !siteBuilderMode.value) toastError(message); });
watch(voiceDictationStatusText, message => { if (message) toastError(message); });
let assistantAbortController: AbortController | null = null;
let assistantActiveRequestId: string | null = null;

const configureStarterPrompt =
  "Help me configure my ME3 installation. First check what is already set up across my public site/profile, email mailbox, Soulink, assistant/AI, plugins, and updates. Then suggest the missing or most useful next step. If I'm not sure, walk me through the basics.";
const assistantPlaceholders = [
  "Ask {{assistantName}} anything...",
  "Set a reminder tomorrow at 9am to...",
  "Draft an email to tell Sarah about...",
];
type StarterPrompt = {
  label: string;
  icon: UiIconName;
  prompt: string;
  mode?: "site-builder";
};
const siteBuilderStarterPrompt = ASSISTANT_SITE_BUILDER_STARTER_PROMPT;
const starterPrompts: StarterPrompt[] = [
  { label: "What's on tomorrow?", icon: "CalendarDays", prompt: "What's on my calendar tomorrow?" },
  { label: "Help me reply to an email", icon: "Mail", prompt: "Help me choose an email to reply to and draft a response. Ask me before sending." },
  { label: "Help me plan my day", icon: "ListTodo", prompt: "Help me plan my day using my calendar, goals and tasks." },
  {
    label: "Build a site",
    icon: "Sparkles",
    prompt: siteBuilderStarterPrompt,
    mode: "site-builder",
  },
  {
    label: "Configure",
    icon: "Settings",
    prompt: configureStarterPrompt,
  },
];
const assistantAttachmentLimit = 4;
const assistantAttachmentMaxBytes = 10_000_000;
const assistantTextAttachmentMaxBytes = 1_000_000;
const assistantAttachmentTextBudget = 48_000;
const assistantAttachmentUploadTimeoutMs = 60_000;

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
  if (aiSettingsLoading.value) return false;
  if (aiSettingsError.value || assistantSettingsError.value) return true;
  return aiDeploymentMode.value === "self_hosted" && !selectedModelSetup.value.configured;
});

// Until there's a Mission, drafting one leads the starters: it tells ME3 who the owner helps and why.
const missionMissing = ref(false);
const missionStarterPrompt: StarterPrompt = { label: "Draft my mission", icon: "Sparkles", prompt: MISSION_DRAFT_PROMPT };
async function loadMissionStarter() {
  try {
    const dashboard = await api.get<{ missionStatement?: string; mission?: { statement: string | null } }>("/mission-control/dashboard");
    missionMissing.value = !ownMissionStatement(dashboard.mission?.statement ?? dashboard.missionStatement);
  } catch { missionMissing.value = false; }
}
const visibleStarterPrompts = computed(() => {
  if (siteBuilderMode.value) return [];
  const prompts = showConfigureStarterPrompt.value ? starterPrompts : starterPrompts.filter((prompt) => prompt.label !== "Configure");
  return missionMissing.value ? [missionStarterPrompt, ...prompts] : prompts;
});
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

// Every reply on the lighter model carries the notice; show it once per month.
function isFirstAllowanceNotice(index: number): boolean {
  const resetsOn = assistantConsoleMessages.value[index]?.allowanceNotice?.resetsOn;
  return Boolean(resetsOn) && !assistantConsoleMessages.value
    .slice(0, index)
    .some((message) => message.allowanceNotice?.resetsOn === resetsOn);
}

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
const canSendAssistantMessage = computed(
  () =>
    (assistantDraft.value.trim().length > 0 ||
      assistantReadyAttachments.value.length > 0) &&
    !assistantSending.value &&
    !assistantThreadLoading.value &&
    !assistantAttachmentIssue.value,
);
onMounted(() => {
  void loadMissionStarter();
  void initializeAssistantPage();
  window.addEventListener("scroll", onAssistantScroll, { capture: true, passive: true });
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
  window.removeEventListener("scroll", onAssistantScroll, { capture: true });
});

watch(
  () => chatMessages.value.length,
  () => {
    if (!assistantSending.value && !assistantHistoryLoadingOlder.value) void scrollAssistantToBottom();
  },
);
let assistantApprovalHistoryRefreshPending = false;
// Bumped after each turn and thread load so payment approvals in Chat stay current.
const assistantPaymentsRefresh = ref(0);
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
async function loadPage() {
  await Promise.all([
    loadAiSettings(),
    loadAssistantSettings().catch((err) => {
      assistantSettingsError.value = messageFromUnknown(
        err,
        "Assistant settings could not load.",
      );
    }),
    loadAssistantThreadFromRoute(),
  ]);
}

function routeThreadId() {
  const value = route.query.thread;
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function setRouteThreadId(threadId: string) {
  if (routeThreadId() === threadId) return;
  await router.replace({
    query: {
      ...route.query,
      thread: threadId,
      view: homeMode.value ? "home" : "chat",
      project: undefined,
      new: undefined,
    },
  });
}

// Chat is one conversation shared with iOS, Android and Soulink. Start fresh archives it and resolves a
// new main thread; the old one stays archived on the installation and is never revived.
async function startFresh() {
  const threadId = assistantThreadId.value;
  if (!threadId || assistantSending.value) return;
  if (!window.confirm("Start a fresh conversation? This one is archived and kept on your ME3. Your notes, tasks, files and ME3's memory stay.")) return;
  try {
    await api.patch(`/assistant/threads/${encodeURIComponent(threadId)}`, { status: "archived" });
    assistantThreadId.value = null;
    agentChat.resetMessages();
    await router.replace({ query: { ...route.query, thread: undefined, project: undefined, new: undefined, view: "chat" } });
    await loadAssistantThreadFromRoute();
  } catch (err) {
    toastFromUnknown(err, "Couldn't start fresh.");
  }
}

async function loadAssistantSettings() {
  const settingsResponse =
    await api.get<AssistantSettingsResponse>("/assistant/settings");
  assistantSettings.value = settingsResponse;
  agentChat.setAssistantDisplayName(settingsResponse.displayName);
  return settingsResponse;
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

function mapAssistantThreadMessages(messages: AssistantThreadMessage[]) {
  let previousUserText = "";
  return messages.map((message) => {
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
      targetPresentation: AgentTargetPresentation | null;
      allowanceNotice: AgentChatAllowanceNotice | null;
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
      targetPresentation: normalizeAgentTargetPresentation(message.targetPresentation),
      allowanceNotice: message.allowanceNotice || null,
      emailDraftAction: null,
      actionHref: actionLink?.href || null,
      actionLabel: actionLink?.label || null,
    };
    if (message.role === "assistant") {
      mappedMessage.emailDraftAction = message.emailDraft
        ? createServerAgentChatEmailDraftAction(message, message.emailDraft)
        : createAgentChatEmailDraftAction(message, previousUserText);
    } else {
      previousUserText = message.text;
    }
    return mappedMessage;
  });
}

// Keeps the reader's place: the timeline grows above them by the height of the older page.
async function loadOlderAssistantMessages() {
  const threadId = assistantThreadId.value;
  const oldest = assistantConsoleMessages.value.find((message) => message.id);
  if (!threadId || !oldest?.id || !assistantHistoryHasMore.value || assistantHistoryLoadingOlder.value) return;
  assistantHistoryLoadingOlder.value = true;
  try {
    const response = await api.get<AssistantThreadMessagesResponse>(
      `/assistant/threads/${encodeURIComponent(threadId)}/messages?limit=${ASSISTANT_HISTORY_PAGE_SIZE}&before=${encodeURIComponent(oldest.id)}`,
    );
    if (assistantThreadId.value !== threadId) return;
    const node = assistantScrollContainer();
    const previousHeight = node?.scrollHeight ?? 0;
    const olderMessages = mapAssistantThreadMessages(response.messages);
    assistantHistoryHasMore.value = Boolean(response.hasMore);
    agentChat.prependMessages(olderMessages);
    const olderIds = new Set(olderMessages.map((message) => message.id));
    chatMessages.value
      .filter((message) => message.id && olderIds.has(message.id))
      .forEach((message) => hydrateAssistantEmailDraftMessage(message));
    await nextTick();
    if (node) node.scrollTop += node.scrollHeight - previousHeight;
  } catch (err) {
    if (assistantThreadId.value !== threadId) return;
    assistantError.value = messageFromUnknown(err, "Earlier messages could not load.");
  } finally {
    if (assistantThreadId.value === threadId) assistantHistoryLoadingOlder.value = false;
  }
}

// The timeline scrolls itself in site-builder mode; otherwise the page scrolls.
function assistantScrollContainer(): HTMLElement | null {
  const timeline = assistantScrollerRef.value;
  if (!timeline) return null;
  for (let node: HTMLElement | null = timeline; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement as HTMLElement | null;
}

function onAssistantScroll() {
  if (homeMode.value && !siteBuilderMode.value) return;
  const node = assistantScrollContainer();
  if (node && node.scrollTop < 200) void loadOlderAssistantMessages();
}

async function loadAssistantThreadFromRoute() {
  let threadId = routeThreadId();
  if (!threadId && !siteBuilderMode.value) {
    try {
      const response = await api.post<{ thread: AssistantThread }>("/assistant/threads/primary", {});
      // A thread opened from a notification while resolving takes precedence.
      if (routeThreadId()) return;
      threadId = response.thread.id;
      assistantThreadId.value = threadId;
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
  assistantHistoryHasMore.value = false;
  try {
    const response = await api.get<AssistantThreadMessagesResponse>(
      `/assistant/threads/${encodeURIComponent(threadId)}/messages?limit=${ASSISTANT_HISTORY_PAGE_SIZE}`,
    );
    if (assistantThreadId.value !== threadId) return;
    const mappedMessages = mapAssistantThreadMessages(response.messages);
    assistantHistoryHasMore.value = Boolean(response.hasMore);
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
      assistantPaymentsRefresh.value++;
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
  targetSelection?: AgentTargetChoice,
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
        ...(targetSelection ? { targetSelection } : {}),
        threadId: assistantThreadId.value,
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

async function chooseTarget(message: (typeof chatMessages.value)[number], candidateId: string) {
  const card = message.targetPresentation;
  const choice = targetChoiceRequest(card, candidateId);
  const candidate = card?.candidates.find(candidate => candidate.id === candidateId);
  if (!choice || !candidate || assistantSending.value || !assistantThreadId.value) return;
  await submitAssistantText(`Choose option ${candidate.option}: ${candidate.label}`, [], undefined, choice);
  if (!assistantError.value && card) card.status = "selected";
  else await loadAssistantThreadFromRoute();
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
  void homePanels.value?.refreshToday();
  assistantPaymentsRefresh.value++;
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
  message.targetPresentation = normalizeAgentTargetPresentation(result.targetPresentation);
  message.allowanceNotice = result.allowanceNotice || null;
  message.emailDraftAction = result.emailDraft
    ? createServerAgentChatEmailDraftAction(message, result.emailDraft)
    : createAgentChatEmailDraftAction(message, previousUserTextForAssistantMessage(message));
  hydrateAssistantEmailDraftMessage(message);
  message.inboxLink = result.emailAction?.kind === "drafted";
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
    contactId: null,
    missingAddress: false,
    saveToContact: false,
    busy: null,
    error: null,
  };
}

// The draft the agent actually wrote; older replies without one fall back to text inference.
function createServerAgentChatEmailDraftAction(
  message: { id?: string; text: string },
  draft: AgentChatServerEmailDraft,
): AgentChatEmailDraftAction {
  return {
    id: `email-draft:${message.id || draft.draftId || draft.subject}`,
    toName: draft.recipientName,
    toAddress: draft.to || null,
    subject: draft.subject,
    body: draft.body,
    displayText: message.text,
    to: draft.to,
    status: draft.draftId ? "saved" : "draft",
    statusLabel: draft.draftId ? "Saved draft" : isValidEmailAddress(draft.to) ? "Ready" : "Needs recipient's email",
    savedDraftId: draft.draftId,
    contactId: draft.contactId,
    missingAddress: !draft.to && Boolean(draft.recipientName),
    saveToContact: true,
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
    contactId: null,
    missingAddress: false,
    saveToContact: false,
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
    action.missingAddress = false;
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
    action.missingAddress = false;
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
  return [contact.name, ...aliases];
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
    await rememberAgentChatEmailDraftAddress(action);
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

/** Adds a typed address to the recipient's contact; never blocks the email itself. */
async function rememberAgentChatEmailDraftAddress(action: AgentChatEmailDraftAction) {
  if (!action.missingAddress || !action.saveToContact || !action.toName) return;
  const email = action.to.trim();
  const saved = action.contactId
    ? await contactsStore.updateContact(action.contactId, { email })
    : await contactsStore.createContact({ name: action.toName, email });
  if (saved) action.missingAddress = false;
}

function assistantEmailDraftContactLabel(action: AgentChatEmailDraftAction) {
  const firstName = action.toName?.trim().split(/\s+/)[0] || "them";
  return action.contactId ? `Save to ${firstName}'s contact` : `Add ${firstName} to contacts`;
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
  if (event.key === "Escape") { event.preventDefault(); dismissComposer(); return; }
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void sendAssistantMessage();
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
      'assistant-page--site-builder': siteBuilderMode,
    }"
  >
    <Teleport v-if="!siteBuilderMode" to="#app-page-controls" defer>
      <div class="home-chat-header">
        <div class="home-chat-switcher" role="group" aria-label="Workspace view">
          <button type="button" :aria-pressed="homeMode" @click="showWorkspace(true)">Home</button>
          <button type="button" :aria-pressed="!homeMode" @click="showWorkspace(false)">Chat</button>
        </div>
        <Button
          v-if="!homeMode && assistantThreadId"
          class="home-chat-new"
          color="ghost"
          size="large"
          icon-only
          aria-label="Start fresh"
          title="Start fresh"
          :disabled="assistantSending"
          @click="startFresh"
        >
          <UiIcon name="SquarePen" :size="20" />
        </Button>
      </div>
    </Teleport>

    <div
      class="assistant-workspace"
      :class="{ 'assistant-workspace--site-builder': siteBuilderMode }"
    >
    <main class="assistant-main" aria-label="Assistant console">
      <section class="assistant-console" aria-label="Assistant conversation">
        <HomePanels v-if="!siteBuilderMode" v-show="homeMode" :active="homeMode" ref="homePanels" class="assistant-home" @pointerdown="dismissComposer" @touchmove.passive="dismissComposer" @suggest="homeSuggestion" @approval-resolved="refreshAssistantAfterApproval" />
        <div
          v-show="!homeMode || siteBuilderMode"
          ref="assistantScrollerRef"
          class="assistant-timeline"
          aria-live="polite"
        >
          <button
            v-if="assistantHistoryHasMore && assistantConsoleMessages.length > 0"
            type="button"
            class="assistant-history-more"
            :disabled="assistantHistoryLoadingOlder"
            @click="loadOlderAssistantMessages"
          >
            {{ assistantHistoryLoadingOlder ? "Loading earlier messages…" : "Show earlier messages" }}
          </button>
          <PageLoading
            v-if="
              assistantThreadLoading && assistantConsoleMessages.length === 0
            "
            label="Loading chat..."
          />

          <div
            v-else-if="assistantConsoleMessages.length === 0 && voiceDictationState !== 'listening'"
            class="assistant-empty-state"
          >
            <AgentDog :size="128" />
            <h2 class="assistant-empty-state__heading">What should I fetch?</h2>
            <p class="assistant-empty-state__hint">Ask for anything. I’ll do the legwork.</p>
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
                <UiIcon :name="prompt.icon" :size="19" aria-hidden="true" />
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
              <AgentTargetChoices v-if="message.targetPresentation"
                :presentation="message.targetPresentation" :busy="assistantSending"
                @choose="chooseTarget(message, $event)" />
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
              <aside
                v-if="message.allowanceNotice && isFirstAllowanceNotice(index)"
                class="assistant-allowance-notice"
                role="note"
              >
                <strong>{{ message.allowanceNotice.title }}</strong>
                <span>{{ message.allowanceNotice.message }}</span>
                <RouterLink
                  v-if="message.allowanceNotice.action?.kind === 'enable_overages'"
                  class="assistant-allowance-notice__action"
                  :to="{ path: '/account', query: { section: 'ai' } }"
                >{{ message.allowanceNotice.action.label }}</RouterLink>
                <a
                  v-else-if="message.allowanceNotice.action?.kind === 'subscribe'"
                  class="assistant-allowance-notice__action"
                  href="https://me3.app/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ message.allowanceNotice.action.label }}</a>
              </aside>
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
                <label
                  v-if="message.emailDraftAction.missingAddress"
                  class="assistant-email-draft-card__contact"
                >
                  <input
                    v-model="message.emailDraftAction.saveToContact"
                    type="checkbox"
                    :disabled="message.emailDraftAction.busy !== null"
                  />
                  <span>{{ assistantEmailDraftContactLabel(message.emailDraftAction) }}</span>
                </label>
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

          <ChatPayments
            v-if="!siteBuilderMode"
            class="assistant-message assistant-message--assistant"
            :thread-id="assistantThreadId"
            :refresh-key="assistantPaymentsRefresh"
            @decided="refreshAssistantAfterApproval"
          />

          <article
            v-if="assistantSending"
            class="assistant-message assistant-message--assistant"
          >
            <div
              class="assistant-message__bubble assistant-message__bubble--pending"
              role="status"
              aria-live="polite"
            >
              <AgentDog state="working" :size="34" />
              <span class="assistant-message__pending-detail">
                {{ assistantTurnStatusText || assistantThinkingLabel }}
              </span>
            </div>
          </article>
        </div>

        <section v-if="voiceDictationState === 'listening'" class="assistant-listening" role="status" aria-label="ME3 is listening">
          <AgentDog state="listening" :size="72" />
          <strong>Listening…</strong>
          <span class="assistant-listening__elapsed">{{ voiceDictationElapsed }}</span>
          <Button color="primary" shape="pill" @click="stopVoiceDictation()">Done</Button>
        </section>
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
              <summary aria-label="Message options" @pointerdown.prevent><UiIcon name="Plus" :size="22" aria-hidden="true" /></summary>
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
              <Button v-if="composerFocused" color="ghost" size="large" icon-only aria-label="Dismiss keyboard" @pointerdown.prevent @click="dismissComposer"><UiIcon name="ChevronDown" :size="20" /></Button>
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
          <p v-if="assistantAttachmentIssue" class="assistant-error">
            {{ assistantAttachmentIssue }}
            <RouterLink
              v-if="assistantAttachmentNeedsStorage"
              to="/account?section=storage"
            >
              Activate storage
            </RouterLink>
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



  </div>
</template>

<style scoped>
.assistant-page {
  --assistant-composer-clearance: 110px;
  --assistant-header-clearance: 18px;

  position: relative;
  isolation: isolate;
  display: block;
  box-sizing: border-box;
  min-height: calc(100dvh - var(--app-topbar-height));
  padding: 0 14px 18px;
  background: var(--ui-bg);
  color: var(--ui-text);
}

.assistant-workspace {
  min-height: inherit;
}

.assistant-page--site-builder {
  height: calc(100dvh - var(--app-topbar-height));
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.assistant-workspace--site-builder {
  display: grid;
  grid-template-columns: minmax(290px, 42%) minmax(320px, 1fr);
  height: calc(100dvh - var(--app-topbar-height));
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

.assistant-main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  margin: 0 auto;
  padding: 0;
}

.assistant-topbar {
  display: none;
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
  width: 100%;
  max-width: none;
  min-height: 0;
  margin: 0 auto;
}

.assistant-timeline {
  width: min(720px, 100%);
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: var(--assistant-header-clearance) 0
    var(--assistant-composer-clearance);
}

.assistant-history-more {
  align-self: center;
  border: 0;
  padding: 6px 10px;
  background: none;
  color: var(--ui-text-muted);
  font: 500 14px var(--font-sans);
  cursor: pointer;
}
.assistant-history-more:hover:not(:disabled) { color: var(--ui-text); }
.assistant-history-more:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; border-radius: var(--ui-radius-sm); }
.assistant-history-more:disabled { cursor: default; }

.assistant-empty-state {
  display: grid; gap: 12px; justify-items: center; margin: 0 0 18px;
  padding: clamp(60px, 17vh, 170px) 0 10px; text-align: center;
}
.assistant-empty-state__heading { margin: 6px 0 0; font-size: 24px; font-weight: 600; letter-spacing: -.02em; }
.assistant-empty-state__hint { margin: 0; color: var(--ui-text-muted); font-size: 15px; }
.starter-prompt-list { display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: min(340px, 100%); margin-top: 12px; }
.starter-prompt { display: inline-flex; align-items: center; gap: 10px; min-height: 46px; border: 0; border-radius: 24px; padding: 10px 16px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); color: var(--ui-text); font: 500 15px var(--font-sans); text-align: left; cursor: pointer; }
.starter-prompt svg { flex-shrink: 0; color: var(--ui-text-muted); }
.starter-prompt:hover { background: var(--ui-surface-muted); }
.starter-prompt:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.assistant-listening { position: fixed; left: 50%; bottom: max(96px, calc(env(safe-area-inset-bottom, 0px) + 96px)); z-index: 41; display: grid; justify-items: center; gap: 12px; box-sizing: border-box; width: min(720px, calc(100vw - 28px)); padding: 32px 20px 20px; border-radius: 28px; background: var(--ui-surface); box-shadow: var(--ui-shadow-md); transform: translateX(-50%); }
.assistant-listening strong { margin-top: 8px; font-size: 20px; font-weight: 600; }
.assistant-listening__elapsed { color: var(--ui-text-muted); font-variant-numeric: tabular-nums; }
.assistant-listening .button { min-width: 100px; }

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

.assistant-allowance-notice {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.45;
}

.assistant-allowance-notice strong {
  color: var(--ui-text);
  font-weight: 600;
}

.assistant-allowance-notice__action {
  justify-self: start;
  margin-top: 2px;
  color: var(--ui-accent);
  font-weight: 600;
  text-underline-offset: 3px;
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

.assistant-email-draft-card__contact {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.assistant-email-draft-card__contact input {
  accent-color: var(--ui-accent);
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

.assistant-message__bubble--pending { display: flex; align-items: center; gap: 10px; }

.assistant-composer {
  position: fixed;
  right: auto;
  bottom: max(14px, env(safe-area-inset-bottom, 0px));
  left: 50%;
  z-index: 40;
  display: grid;
  gap: 8px;
  width: min(720px, calc(100vw - 28px));
  max-width: 720px;
  margin-inline: auto;
  border: 0;
  border-radius: 28px;
  padding: 10px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm, 0 8px 24px rgba(15, 23, 42, 0.08));
  transform: translateX(-50%);
}
.assistant-composer::before { content: ""; position: absolute; left: 0; right: 0; bottom: 100%; height: 22px; background: linear-gradient(transparent, var(--ui-bg)); pointer-events: none; border-radius: 28px 28px 0 0; }

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
  padding: 6px 10px 2px;
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

.panel {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  overflow: hidden;
}
.assistant-placeholder p {
  margin: 0;
  font-size: 17px;
  line-height: 1.25;
  letter-spacing: 0;
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
button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
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

}

@media (max-width: 620px) {
  .assistant-page--site-builder {
    height: auto;
    min-height: calc(100dvh - var(--app-topbar-height));
    overflow: auto;
  }

  .assistant-workspace--site-builder {
    grid-template-columns: 1fr;
    height: auto;
    min-height: calc(100dvh - var(--app-topbar-height));
  }

  .assistant-page--site-builder .assistant-main {
    height: calc(100dvh - var(--app-topbar-height));
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

</style>

<style scoped>
.home-chat-header { display: flex; align-items: center; flex: 1; height: 44px; }
.home-chat-new { margin-left: auto; }
.home-chat-switcher { position: absolute; left: 50%; transform: translateX(-50%); display: flex; padding: 3px; border-radius: 28px; background: var(--ui-surface-muted); }
.home-chat-switcher button { min-width: 68px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 24px; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 14px; cursor: pointer; }
.home-chat-switcher button[aria-pressed="true"] { color: var(--ui-primary-contrast); background: var(--ui-primary); font-weight: 600; }
/* Home scrolls with the window, so there is one scrollbar rather than a second one on the card list. */
.assistant-home { margin-inline: -14px; align-content: start; box-sizing: border-box; }
@media (max-width: 360px) { .home-chat-switcher { left: calc(50% + 8px); } .home-chat-switcher button { min-width: 52px; padding-inline: 10px; } }
.home-chat-switcher button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
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

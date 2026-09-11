<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { definePage } from "unplugin-vue-router/runtime";
import { RouterView, useRoute, useRouter } from "vue-router";
import AppDialog from "../components/AppDialog.vue";
import Button from "../components/Button.vue";
import PageLoading from "../components/PageLoading.vue";
import UiIcon from "../components/UiIcon.vue";
import WorkspaceTabs from "../components/WorkspaceTabs.vue";
import { API_BASE, api } from "../api";
import { useAppToast } from "../composables/useAppToast";
import { useAuthStore } from "../stores/auth";
import { useContactsStore, type Contact } from "../stores/contacts";
import {
  mailboxCacheScope,
  useMailboxCacheStore,
  type MailboxListRequest,
} from "../stores/mailbox";
import type { UiIconName } from "../utils/icons";
import { decodeMimeHeaderValue } from "../../../../shared/email-headers";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "Email | ME3",
    description: "Review email and assistant chat with your ME3 assistant.",
    robots: "noindex,follow",
  },
});

type MessageStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "failed"
  | "received"
  | "forwarded"
  | "dropped";

type MailboxAttachment = {
  filename?: string | null;
  mimeType?: string | null;
  disposition?: "attachment" | "inline" | null;
  size?: number | null;
  storageKey?: string | null;
  sourceMessageId?: string | null;
};

type MailboxAttachmentUploadResponse = {
  attachments: MailboxAttachment[];
};

type MailboxUnsubscribeAction = {
  available: true;
  mode: "one_click" | "link" | "mailto";
};

type MailboxUnsubscribeResponse =
  | { ok: true; mode: "one_click"; status: number }
  | { ok: true; mode: "open"; url: string };

type InboxMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: "email" | "draft" | "system";
  status: MessageStatus;
  threadKey: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  subject: string;
  body: string;
  htmlBody?: string | null;
  preview: string;
  folder?: "inbox" | "drafts" | "sent" | "archive" | "trash";
  readAt?: string | null;
  unread?: boolean;
  agentSummary?: string | null;
  agentLabels?: string[];
  metadata: {
    attachmentCount?: number;
    attachments?: MailboxAttachment[];
    category?: string;
    contactId?: string;
    contactName?: string;
    contactRelationship?: string;
    dueAt?: string | null;
    lastInteractionAt?: string | null;
    source?: string;
    classification?: {
      category?: string;
      confidence?: number;
      reason?: string;
      needsAttention?: boolean;
      dailyReview?: "needs_attention" | "handled_quietly";
      suggestedRule?: {
        kind?: string;
        label?: string;
        status?: "suggested" | "accepted" | "dismissed";
      };
    };
    threadSummary?: MailboxThreadSummary;
  } | null;
  unsubscribeAction?: MailboxUnsubscribeAction | null;
  createdBy: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

type MessagesResponse = {
  messages: InboxMessage[];
  total: number;
  limit: number;
  offset: number;
};

type MailboxThreadSummary = {
  id: string;
  subject: string;
  participants: string[];
  latestSnippet: string;
  latestMessageId: string;
  messageCount: number;
  unreadCount: number;
  attachmentCount: number;
  lastActivity: string;
};

type MailboxThreadsResponse = {
  threads: MailboxThreadSummary[];
  nextCursor: string | null;
};

type MailboxThreadResponse = {
  thread: MailboxThreadSummary;
  messages: InboxMessage[];
};

type MailboxDeliveryStatus = {
  id: string;
  state:
    | "draft"
    | "sending"
    | "delivery_unknown"
    | "sent"
    | "failed"
    | "rejected";
  checkedAt: string;
  unknownAfter: string | null;
  canMarkSent: boolean;
  canRetryAnyway: boolean;
};

type MailboxSource = {
  id: string;
  type: "me3_alias" | "custom_domain" | "external_forward";
  address: string;
  status: "pending" | "active" | "paused" | "failed";
  inboundEnabled: boolean;
  outboundEnabled: boolean;
};

type FullMailboxResponse = {
  mailbox: {
    aliasAddress: string | null;
    status?: "pending_setup" | "active" | "paused";
    forwardingStatus?: "pending" | "verified";
  } | null;
  sources: MailboxSource[];
};

type EmailProviderSettingsResponse = {
  activeProviderId: string;
  providers: Array<{
    id: string;
    configured: boolean;
    config: {
      fromAddress: string;
    };
  }>;
};

type TelegramStatusResponse = {
  available: boolean;
  configured: boolean;
  botUsername: string | null;
  startUrl: string | null;
  connection: {
    status: "pending" | "active" | "disconnected";
    telegramUsername: string | null;
  } | null;
  recentEvents: unknown[];
};

type AgentTurn = {
  id: string;
  channel: "telegram" | "sandbox" | "soulink";
  status: "pending" | "running" | "completed" | "failed";
  inputText: string | null;
  outputText: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type AgentTurnsResponse = {
  turns: AgentTurn[];
  total?: number;
  limit?: number;
  offset?: number;
};

type ClearTelegramHistoryResponse = {
  ok: boolean;
  deletedTurns: number;
  deletedEvents: number;
};

type EmailTab = "inbox" | "drafts" | "sent" | "archive" | "trash";
type Tab = EmailTab | "telegram";

type TelegramChatBubble = {
  id: string;
  role: "user" | "agent";
  text: string;
  at: string;
  errorNote?: string;
};

const loading = ref(false);
const messagesLoaded = ref(false);
const error = ref("");
const messages = ref<InboxMessage[]>([]);
const threadSummaries = ref<MailboxThreadSummary[]>([]);
const threadMode = ref(false);
const threadNextCursor = ref<string | null>(null);
const threadCursorHistory = ref<Array<string | null>>([null]);
const threadCursorIndex = ref(0);
const selectedThreadId = ref<string | null>(null);
const loadedThreadId = ref<string | null>(null);
const loadedThreadMessages = ref<InboxMessage[]>([]);
const threadDetailLoading = ref(false);
const threadDetailError = ref("");
const conversationScrollRef = ref<HTMLElement | null>(null);
let renderedThreadPageKey: string | null = null;
const threadPageNextCursors = new Map<string, string | null>();
const deliveryResolutionPending = ref<string | null>(null);
const deliveryRetryConfirmId = ref<string | null>(null);
const deliveryStatuses = ref<Record<string, MailboxDeliveryStatus>>({});
const total = ref(0);
const activeTab = ref<Tab>("inbox");
const mailboxAddress = ref<string | null>(null);
const expandedId = ref<string | null>(null);
const mobileThreadOpen = ref(false);
const searchQuery = ref("");
const actionPending = ref<string | null>(null);
const deletePending = ref<string | null>(null);
const unsubscribePending = ref<string | null>(null);
const bulkActionPending = ref(false);
const selectedMessageIds = ref<Set<string>>(new Set());
const emailFrameHeights = ref<Record<string, number>>({});
const externalContentAllowedIds = ref<Set<string>>(new Set());
const emailFrameObservers = new WeakMap<HTMLIFrameElement, ResizeObserver>();
const activeEmailFrameObservers = new Set<ResizeObserver>();
const composeOpen = ref(false);
const composeSending = ref(false);
const composeError = ref("");
const composeMode = ref<"new" | "reply" | "forward" | "edit">("new");
const composeDraftId = ref<string | null>(null);
const composeReplyToMessageId = ref<string | null>(null);
const composePreservedAttachmentKeys = ref<string[]>([]);
const composePreservedAttachments = ref<MailboxAttachment[]>([]);
const composeUploadedAttachments = ref<MailboxAttachment[]>([]);
const composeUploadingAttachments = ref(false);
const composeToFocused = ref(false);
const composeToHasTyped = ref(false);
const composeToActiveIndex = ref(0);
const composeInitialSnapshot = ref("");
const composeDiscardConfirmOpen = ref(false);
const composeForm = ref({
  fromAddress: "",
  to: "",
  subject: "",
  textBody: "",
});
const offset = ref(0);
const limit = 50;
const TELEGRAM_PAGE_LIMIT = 50;
const { toastFromUnknown, toastSuccess, toast } = useAppToast();
const auth = useAuthStore();
const mailboxCache = useMailboxCacheStore();
const { folderCounts } = storeToRefs(mailboxCache);
const route = useRoute();
const router = useRouter();
/** File-based child routes render here instead of leaving the inbox visible. */
const isNestedEmailTool = computed(() =>
  route.path.startsWith("/email/campaigns"),
);
const contactsStore = useContactsStore();
const { contacts } = storeToRefs(contactsStore);
let contactsRequested = contacts.value.length > 0;
let providerSettingsRequested = false;
let telegramHealthRequested = false;
let threadEndpointAvailable: boolean | null = null;
let threadRequestId = 0;
const threadPageScrollOffsets = new Map<string, number>();
const deliveryStatusRefreshTimers = new Map<string, number>();
const deliveryRefreshAttemptedIds = new Set<string>();

const mailboxMeta = ref<FullMailboxResponse["mailbox"] | null>(null);
const mailboxSources = ref<MailboxSource[]>([]);
const configuredEmailAddress = ref<string | null>(null);
const telegramHealth = ref<{
  configured: boolean;
  connectionStatus: "pending" | "active" | "disconnected" | null;
} | null>(null);

const telegramLoading = ref(false);
const telegramLoadingMore = ref(false);
const telegramClearing = ref(false);
const telegramError = ref("");
const telegramMoreError = ref("");
const turns = ref<AgentTurn[]>([]);
const telegramTotal = ref(0);
let messageRequestId = 0;

function isInternalMailboxAddress(address: string | null | undefined) {
  return Boolean(address?.trim().toLowerCase().endsWith("@me3.local"));
}

function isPublicEmailAddress(
  address: string | null | undefined,
): address is string {
  const normalized = address?.trim().toLowerCase() || "";
  return Boolean(
    normalized &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) &&
      !isInternalMailboxAddress(normalized),
  );
}

const visibleMailboxAddress = computed(() => {
  const activeSource = mailboxSources.value.find(
    (source) =>
      source.status === "active" &&
      source.inboundEnabled &&
      !isInternalMailboxAddress(source.address),
  );
  if (activeSource) return activeSource.address;
  const configuredAddress = configuredEmailAddress.value;
  if (isPublicEmailAddress(configuredAddress)) {
    return configuredAddress;
  }
  const aliasAddress = mailboxAddress.value;
  return isPublicEmailAddress(aliasAddress) ? aliasAddress : null;
});

const outboundSenderOptions = computed(() => {
  const options: Array<{ address: string; label: string }> = [];
  const aliasAddress =
    configuredEmailAddress.value || mailboxMeta.value?.aliasAddress || mailboxAddress.value;

  if (isPublicEmailAddress(aliasAddress)) {
    const address = aliasAddress.trim().toLowerCase();
    options.push({ address, label: address });
  }

  for (const source of mailboxSources.value) {
    if (
      source.status === "active" &&
      source.outboundEnabled &&
      !isInternalMailboxAddress(source.address) &&
      !options.some((option) => option.address === source.address)
    ) {
      options.push({ address: source.address, label: source.address });
    }
  }

  return options;
});
const telegramChatRef = ref<HTMLElement | null>(null);

const contactRecipientOptions = computed(() =>
  contacts.value
    .filter((contact) => Boolean(contact.email?.trim()))
    .map((contact) => ({
      id: contact.id,
      name: contact.name.trim() || contact.email?.trim() || "Unnamed contact",
      email: contact.email?.trim() || "",
      search: `${contact.name} ${contact.email || ""}`.toLowerCase(),
    })),
);

const composeRecipientSuggestions = computed(() => {
  if (!composeToFocused.value || !composeToHasTyped.value) return [];
  const query = composeForm.value.to.trim().toLowerCase();
  if (!query) return [];
  return contactRecipientOptions.value
    .filter((contact) => contact.search.includes(query))
    .slice(0, 8);
});

const showComposeRecipientSuggestions = computed(
  () => composeRecipientSuggestions.value.length > 0,
);

const emailTabConfig: Record<
  EmailTab,
  {
    label: string;
    folderParam: "inbox" | "drafts" | "sent" | "archive" | "trash";
    statusParam?: string;
    directionParam: "outbound" | "all";
  }
> = {
  inbox: {
    label: "Inbox",
    folderParam: "inbox",
    directionParam: "all",
  },
  drafts: {
    label: "Drafts",
    folderParam: "drafts",
    statusParam: "pending_approval,failed,approved",
    directionParam: "outbound",
  },
  sent: {
    label: "Sent",
    folderParam: "sent",
    statusParam: "sent,approved",
    directionParam: "outbound",
  },
  archive: {
    label: "Archive",
    folderParam: "archive",
    directionParam: "all",
  },
  trash: {
    label: "Trash",
    folderParam: "trash",
    directionParam: "all",
  },
};

const emailTabOrder: EmailTab[] = [
  "inbox",
  "drafts",
  "sent",
  "archive",
  "trash",
];
const emailTabIcons: Record<EmailTab, UiIconName> = {
  inbox: "Inbox",
  drafts: "FileText",
  sent: "Send",
  archive: "Archive",
  trash: "Trash2",
};
const mailFolderTabs = computed(() => {
  const tabs: Array<{
    id: Tab | "contacts" | "campaigns";
    label: string;
    icon: UiIconName;
    count?: number | null;
    ariaLabel?: string;
  }> = [
    {
      id: "campaigns",
      label: "Campaigns",
      icon: "Send",
      ariaLabel: "Campaigns",
    },
    ...emailTabOrder.map((key) => ({
      id: key,
      label: emailTabConfig[key].label,
      icon: emailTabIcons[key],
      count: getVisibleFolderCount(key),
      ariaLabel: emailTabConfig[key].label,
    })),
  ];
  tabs.push({
    id: "contacts",
    label: "Contacts",
    icon: "UsersRound",
    count: contacts.value.length > 0 ? contacts.value.length : null,
    ariaLabel: "Contacts",
  });
  return tabs;
});

function isEmailTab(tab: Tab | "contacts" | "campaigns"): tab is EmailTab {
  return tab !== "telegram" && tab !== "contacts" && tab !== "campaigns";
}

const activeFolderLabel = computed(() =>
  isEmailTab(activeTab.value)
    ? emailTabConfig[activeTab.value].label
    : "Mailbox",
);
const searchLabel = computed(() => `Search ${activeFolderLabel.value}`);

/** Show setup hint in empty states (not the top status strip). */
const mailNeedsSetupHint = computed(() => {
  if (!mailboxMeta.value && !visibleMailboxAddress.value) return true;
  const s = mailboxMeta.value?.status;
  return s === "pending_setup" || !visibleMailboxAddress.value;
});

const telegramNeedsSetupHint = computed(() => {
  if (!telegramHealth.value) return false;
  if (!telegramHealth.value.configured) return true;
  return telegramHealth.value.connectionStatus !== "active";
});

const telegramConversation = computed((): TelegramChatBubble[] => {
  const items: TelegramChatBubble[] = [];
  const sorted = [...turns.value].sort(
    (a, b) => parseApiDate(a.createdAt).getTime() - parseApiDate(b.createdAt).getTime(),
  );
  for (const turn of sorted) {
    if (turn.inputText?.trim()) {
      items.push({
        id: `${turn.id}-in`,
        role: "user",
        text: turn.inputText.trim(),
        at: turn.createdAt,
      });
    }
    if (turn.outputText?.trim()) {
      items.push({
        id: `${turn.id}-out`,
        role: "agent",
        text: turn.outputText.trim(),
        at: turn.updatedAt || turn.createdAt,
        errorNote:
          turn.status === "failed"
            ? "This reply may not have been delivered."
            : undefined,
      });
    } else if (turn.status === "failed") {
      items.push({
        id: `${turn.id}-fail`,
        role: "agent",
        text: "This reply could not be completed.",
        at: turn.updatedAt || turn.createdAt,
        errorNote: "Something went wrong. Try again in a moment.",
      });
    }
  }
  return items;
});

const telegramHasMore = computed(
  () => telegramTotal.value > 0 && turns.value.length < telegramTotal.value,
);

const messageIdsOnPage = computed(() =>
  messages.value.map((message) => message.id),
);
const hasMessagesOnPage = computed(() => messageIdsOnPage.value.length > 0);
const inboxBusy = computed(
  () =>
    Boolean(actionPending.value) ||
    Boolean(deletePending.value) ||
    Boolean(unsubscribePending.value) ||
    bulkActionPending.value,
);
const selectedMessages = computed(() =>
  messages.value.filter((message) => selectedMessageIds.value.has(message.id)),
);
const selectedMessageCount = computed(() => selectedMessages.value.length);
const allMessagesOnPageSelected = computed(
  () =>
    hasMessagesOnPage.value &&
    messageIdsOnPage.value.every((id) => selectedMessageIds.value.has(id)),
);
const someMessagesOnPageSelected = computed(() =>
  messageIdsOnPage.value.some((id) => selectedMessageIds.value.has(id)),
);
const followUpDraftCount = computed(
  () =>
    messages.value.filter(
      (message) =>
        message.status === "pending_approval" && isLikelyFollowUpDraft(message),
    ).length,
);
const selectedThreadSummary = computed(() =>
  selectedThreadId.value
    ? threadSummaries.value.find(
        (thread) => thread.id === selectedThreadId.value,
      ) || null
    : null,
);
const selectedThreadDetailUnavailable = computed(
  () =>
    threadMode.value && loadedThreadId.value !== selectedThreadId.value,
);
const selectedMessage = computed(() => {
  if (
    threadMode.value &&
    loadedThreadId.value === selectedThreadId.value &&
    loadedThreadMessages.value.length > 0
  ) {
    return loadedThreadMessages.value.at(-1) || null;
  }
  if (expandedId.value) {
    const selected = messages.value.find(
      (message) => message.id === expandedId.value,
    );
    if (selected) return selected;
  }
  return null;
});
const selectedThreadMessages = computed(() => {
  if (
    threadMode.value &&
    loadedThreadId.value === selectedThreadId.value
  ) {
    return loadedThreadMessages.value;
  }
  const selected = selectedMessage.value;
  if (!selected) return [];
  if (!selected.threadKey) return [selected];
  return messages.value.filter(
    (message) => message.threadKey === selected.threadKey,
  );
});

function parseApiDate(value: string): Date {
  const trimmed = value.trim();
  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalized = sqliteUtcPattern.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  return new Date(normalized);
}

function formatDateTimePart(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    const { timeZone: _timeZone, ...fallbackOptions } = options;
    return new Intl.DateTimeFormat(undefined, fallbackOptions).format(date);
  }
}

function getDateOrdinal(date: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function getCalendarDayDiff(date: Date, now: Date, timeZone?: string): number {
  try {
    return getDateOrdinal(now, timeZone) - getDateOrdinal(date, timeZone);
  } catch {
    return getDateOrdinal(now) - getDateOrdinal(date);
  }
}
const selectedThreadIsUnread = computed(() =>
  selectedThreadSummary.value
    ? selectedThreadSummary.value.unreadCount > 0
    : selectedThreadMessages.value.some((message) => message.unread),
);

function isEditableDraft(message: InboxMessage): boolean {
  return message.status === "pending_approval" || message.status === "failed";
}

function isDraftMessage(message: InboxMessage): boolean {
  return message.kind === "draft";
}

function draftStatusLabel(message: InboxMessage): string {
  if (message.status === "approved") return "Sending";
  if (message.status === "failed") return "Failed";
  return "Draft";
}

function getFolderCount(tab: EmailTab): number | null {
  return tab === "inbox" || tab === "drafts"
    ? folderCounts.value[tab]
    : null;
}

function getVisibleFolderCount(tab: EmailTab): number | null {
  if (tab === "sent" || tab === "archive" || tab === "trash") return null;
  const count = getFolderCount(tab);
  if (count === null || count <= 0) return null;
  return count;
}

async function loadFolderCounts(force = true) {
  await mailboxCache.loadFolderCounts(force);
}

function normalizeEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function getRelatedContact(message: InboxMessage): Contact | null {
  if (message.metadata?.contactId) {
    const byId = contacts.value.find(
      (contact) => contact.id === message.metadata?.contactId,
    );
    if (byId) return byId;
  }
  const targetEmail = normalizeEmail(
    message.direction === "inbound" ? message.fromAddress : message.toAddress,
  );
  if (!targetEmail) return null;
  return (
    contacts.value.find(
      (contact) => normalizeEmail(contact.email) === targetEmail,
    ) || null
  );
}

function isContactDueForFollowUp(contact: Contact | null): boolean {
  if (!contact || !contact.nextFollowupAt || contact.status === "archived") {
    return false;
  }
  const nextFollowup = new Date(contact.nextFollowupAt);
  return (
    !Number.isNaN(nextFollowup.getTime()) &&
    nextFollowup.getTime() <= Date.now()
  );
}

function isLikelyFollowUpDraft(message: InboxMessage): boolean {
  if (message.metadata?.category === "rolodex_follow_up") {
    return true;
  }

  return (
    message.direction === "outbound" &&
    message.status === "pending_approval" &&
    isContactDueForFollowUp(getRelatedContact(message))
  );
}

function getCounterpartyAddress(message: InboxMessage): string {
  if (message.direction === "inbound") {
    return (
      getDisplayText(message.fromName) || getDisplayText(message.fromAddress) || "—"
    );
  }
  return getDisplayText(message.toAddress) || "—";
}

function formatSenderValue(message: InboxMessage): string {
  const fromName = getDisplayText(message.fromName);
  const fromAddress = getDisplayText(message.fromAddress);
  if (fromName && fromAddress) {
    return `${fromName} <${fromAddress}>`;
  }
  return fromAddress || fromName || "—";
}

function formatRecipientValue(message: InboxMessage): string {
  return getDisplayText(message.toAddress) || "—";
}

function getMessageSubject(message: InboxMessage): string {
  return getDisplayText(message.subject) || "(no subject)";
}

function getThreadSummary(message: InboxMessage): MailboxThreadSummary | null {
  if (!threadMode.value) return null;
  return (
    threadSummaries.value.find(
      (thread) => thread.latestMessageId === message.id,
    ) ||
    message.metadata?.threadSummary ||
    null
  );
}

function getConversationParticipants(message: InboxMessage): string {
  const participants = getThreadSummary(message)?.participants
    .map((participant) => getDisplayText(participant))
    .filter(Boolean);
  if (participants?.length) {
    const ownAddresses = new Set(
      [
        visibleMailboxAddress.value,
        mailboxAddress.value,
        configuredEmailAddress.value,
        ...mailboxSources.value.map((source) => source.address),
      ]
        .map((address) => address?.trim().toLowerCase())
        .filter((address): address is string => Boolean(address)),
    );
    const external = participants.filter(
      (participant) => !ownAddresses.has(participant.trim().toLowerCase()),
    );
    return (external.length ? external : participants).slice(0, 3).join(", ");
  }
  return getCounterpartyAddress(message);
}

function getConversationMessageCount(message: InboxMessage): number {
  return getThreadSummary(message)?.messageCount || 1;
}

function getConversationUnreadCount(message: InboxMessage): number {
  return getThreadSummary(message)?.unreadCount || (message.unread ? 1 : 0);
}

function getConversationAttachmentCount(message: InboxMessage): number {
  return (
    getThreadSummary(message)?.attachmentCount ||
    message.metadata?.attachmentCount ||
    getMessageAttachments(message).length
  );
}

function threadSummaryToMessage(
  thread: MailboxThreadSummary,
  tab: EmailTab,
): InboxMessage {
  const outbound = tab === "sent";
  const participant = thread.participants[0] || null;
  return {
    id: thread.latestMessageId,
    direction: outbound ? "outbound" : "inbound",
    kind: "email",
    status: outbound ? "sent" : "received",
    threadKey: thread.id,
    fromAddress: outbound ? visibleMailboxAddress.value : participant,
    fromName: outbound ? null : participant,
    toAddress: outbound ? participant : visibleMailboxAddress.value,
    subject: thread.subject,
    body: "",
    htmlBody: null,
    preview: thread.latestSnippet,
    folder: emailTabConfig[tab].folderParam,
    readAt: thread.unreadCount > 0 ? null : thread.lastActivity,
    unread: thread.unreadCount > 0,
    agentSummary: null,
    agentLabels: [],
    metadata: {
      attachmentCount: thread.attachmentCount,
      threadSummary: thread,
    },
    unsubscribeAction: null,
    createdBy: "",
    approvedByUserId: null,
    approvedAt: null,
    sentAt: outbound ? thread.lastActivity : null,
    createdAt: thread.lastActivity,
  };
}

function syncSelectedMessages(nextMessages: InboxMessage[]) {
  if (
    expandedId.value &&
    !nextMessages.some((message) => message.id === expandedId.value)
  ) {
    clearOpenConversation();
  }
  const nextIds = new Set(nextMessages.map((message) => message.id));
  selectedMessageIds.value = new Set(
    [...selectedMessageIds.value].filter((id) => nextIds.has(id)),
  );
}

function isDesktopMailLayout(): boolean {
  return window.matchMedia("(min-width: 641px)").matches;
}

function getMessageAttachments(message: InboxMessage): MailboxAttachment[] {
  return (message.metadata?.attachments || []).filter(
    (attachment) =>
      attachment &&
      typeof attachment === "object" &&
      Boolean(attachment.filename || attachment.mimeType || attachment.size),
  );
}

function formatAttachmentName(
  attachment: MailboxAttachment,
  index: number,
): string {
  return attachment.filename?.trim() || `Attachment ${index + 1}`;
}

function formatAttachmentSize(size: number | null | undefined): string {
  if (!size || size < 1) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function getAttachmentDownloadUrl(message: InboxMessage, index: number): string {
  return `${API_BASE}/mailbox/messages/${encodeURIComponent(
    message.id,
  )}/attachments/${index}`;
}

function getForwardableAttachments(message: InboxMessage): MailboxAttachment[] {
  return getMessageAttachments(message).filter((attachment) =>
    Boolean(attachment.storageKey),
  );
}

const composeVisibleAttachments = computed(() => [
  ...composePreservedAttachments.value,
  ...composeUploadedAttachments.value,
]);
const composeNeedsStorage = computed(() =>
  /attachment storage is not configured/i.test(composeError.value),
);

function clearSelectedMessages() {
  selectedMessageIds.value = new Set();
}

function setAllMessagesOnPageSelected(selected: boolean) {
  selectedMessageIds.value = selected
    ? new Set(messageIdsOnPage.value)
    : new Set();
}

function toggleMessageSelected(id: string, selected: boolean) {
  const next = new Set(selectedMessageIds.value);
  if (selected) {
    next.add(id);
  } else {
    next.delete(id);
  }
  selectedMessageIds.value = next;
}

async function runDraftAction(id: string, action: "approve" | "reject") {
  await api.post(`/mailbox/drafts/${id}/${action}`);
}

function removeMessageLocally(id: string) {
  const removed = messages.value.some((message) => message.id === id);
  messages.value = messages.value.filter((message) => message.id !== id);
  if (removed) {
    total.value = Math.max(0, total.value - 1);
  }
  syncSelectedMessages(messages.value);
}

function selectNextMessageAfterRemoval(
  previousMessages: InboxMessage[],
  removedIds: Set<string>,
) {
  const selectedIndex = previousMessages.findIndex(
    (message) => message.id === expandedId.value,
  );
  if (selectedIndex < 0 || !expandedId.value || !removedIds.has(expandedId.value)) {
    return;
  }

  const next =
    previousMessages
      .slice(selectedIndex + 1)
      .find((message) => !removedIds.has(message.id)) ||
    [...previousMessages]
      .slice(0, selectedIndex)
      .reverse()
      .find((message) => !removedIds.has(message.id));
  expandedId.value = isDesktopMailLayout() ? next?.id || null : null;
  mobileThreadOpen.value = false;
}

async function undoMessageMoves(
  moves: Array<{ id: string; folder: NonNullable<InboxMessage["folder"]> }>,
) {
  const results = await Promise.allSettled(
    moves.map(({ id, folder }) =>
      api.post(`/mailbox/messages/${id}/move`, { folder }),
    ),
  );
  await Promise.all([loadMessages(), loadFolderCounts()]);
  const failedCount = results.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failedCount === 0) {
    toastSuccess(moves.length === 1 ? "Move undone." : "Moves undone.");
  } else {
    toast.error(
      `${failedCount} ${failedCount === 1 ? "move" : "moves"} could not be undone.`,
    );
  }
}

function showMoveToast(
  folder: "inbox" | "archive" | "trash",
  moves: Array<{ id: string; folder: NonNullable<InboxMessage["folder"]> }>,
) {
  const count = moves.length;
  const label =
    folder === "archive"
      ? count === 1
        ? "Message archived."
        : `${count} messages archived.`
      : folder === "trash"
        ? count === 1
          ? "Message moved to Trash."
          : `${count} messages moved to Trash.`
        : count === 1
          ? "Message restored to Inbox."
          : `${count} messages restored to Inbox.`;
  toast.success(label, {
    action: {
      label: "Undo",
      onClick: () => void undoMessageMoves(moves),
    },
  });
}

async function undoThreadMoves(
  moves: Array<{ id: string; folder: NonNullable<InboxMessage["folder"]> }>,
  fromFolder: NonNullable<InboxMessage["folder"]>,
) {
  const results = await Promise.allSettled(
    moves.map(({ id, folder }) =>
      api.post(`/mailbox/threads/${encodeURIComponent(id)}/move`, {
        folder,
        fromFolder,
      }),
    ),
  );
  await Promise.all([loadMessages(), loadFolderCounts()]);
  if (results.every((result) => result.status === "fulfilled")) {
    toastSuccess(moves.length === 1 ? "Move undone." : "Moves undone.");
  } else {
    toast.error("Some conversation moves could not be undone.");
  }
}

function showThreadMoveToast(
  folder: "inbox" | "archive" | "trash",
  moves: Array<{ id: string; folder: NonNullable<InboxMessage["folder"]> }>,
) {
  const count = moves.length;
  const label =
    folder === "archive"
      ? count === 1
        ? "Conversation archived."
        : `${count} conversations archived.`
      : folder === "trash"
        ? count === 1
          ? "Conversation moved to Trash."
          : `${count} conversations moved to Trash.`
        : count === 1
          ? "Conversation restored to Inbox."
          : `${count} conversations restored to Inbox.`;
  toast.success(label, {
    action: {
      label: "Undo",
      onClick: () => void undoThreadMoves(moves, folder),
    },
  });
}

function mailboxListRequest(tab: EmailTab): MailboxListRequest {
  const config = emailTabConfig[tab];
  return {
    folder: config.folderParam,
    status: config.statusParam,
    direction: config.directionParam,
    search: searchQuery.value.trim() || undefined,
    limit,
    offset: offset.value,
  };
}

function cacheActiveMessages() {
  if (
    threadMode.value ||
    !isEmailTab(activeTab.value) ||
    !messagesLoaded.value
  ) {
    return;
  }
  mailboxCache.setList(mailboxCacheScope(auth.user?.id), mailboxListRequest(activeTab.value), {
    messages: messages.value,
    total: total.value,
  });
}

function ignorePendingMessageResponses() {
  messageRequestId += 1;
  threadRequestId += 1;
}

function resetThreadPagination() {
  threadCursorHistory.value = [null];
  threadCursorIndex.value = 0;
  threadNextCursor.value = null;
}

function clearOpenConversation() {
  threadRequestId += 1;
  clearDeliveryStatusRefreshes();
  expandedId.value = null;
  selectedThreadId.value = null;
  loadedThreadId.value = null;
  loadedThreadMessages.value = [];
  threadDetailLoading.value = false;
  threadDetailError.value = "";
  mobileThreadOpen.value = false;
}

function currentThreadPageKey(): string {
  return JSON.stringify([
    activeTab.value,
    searchQuery.value.trim(),
    threadCursorHistory.value[threadCursorIndex.value] || null,
  ]);
}

function rememberConversationScroll() {
  if (!threadMode.value || !conversationScrollRef.value) return;
  threadPageScrollOffsets.set(
    renderedThreadPageKey || currentThreadPageKey(),
    conversationScrollRef.value.scrollTop,
  );
}

async function restoreConversationScroll(pageKey = currentThreadPageKey()) {
  await nextTick();
  if (!conversationScrollRef.value) return;
  conversationScrollRef.value.scrollTop =
    threadPageScrollOffsets.get(pageKey) || 0;
}

function isMissingThreadEndpoint(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  return status === 404 || status === 405;
}

async function loadLegacyMessages(tab: EmailTab, requestId: number) {
  const request = mailboxListRequest(tab);
  const scope = mailboxCacheScope(auth.user?.id);
  const cachedEntry = mailboxCache.getList<InboxMessage>(scope, request);
  const cached = cachedEntry?.messages.some(
    (message) => message.metadata?.threadSummary,
  )
    ? null
    : cachedEntry;
  threadMode.value = false;
  renderedThreadPageKey = null;
  threadSummaries.value = [];
  threadNextCursor.value = null;
  if (cached) {
    loading.value = false;
    messages.value = cached.messages;
    total.value = cached.total;
    messagesLoaded.value = true;
    syncSelectedMessages(cached.messages);
  } else {
    loading.value = true;
    messagesLoaded.value = false;
    messages.value = [];
    total.value = 0;
  }
  const params = new URLSearchParams();
  params.set("folder", request.folder);
  if (request.status) params.set("status", request.status);
  params.set("direction", request.direction);
  if (request.search) params.set("q", request.search);
  params.set("limit", String(request.limit));
  params.set("offset", String(request.offset));
  const data = await api.get<MessagesResponse>(
    `/mailbox/messages?${params.toString()}`,
  );
  if (requestId !== messageRequestId) return;
  mailboxCache.setList(scope, request, data);
  messages.value = data.messages;
  total.value = data.total;
  messagesLoaded.value = true;
  syncSelectedMessages(data.messages);
}

async function loadMessages() {
  if (!isEmailTab(activeTab.value)) return;
  const tab = activeTab.value;
  const requestedThreadPageKey = currentThreadPageKey();
  const requestId = ++messageRequestId;
  rememberConversationScroll();
  error.value = "";

  try {
    if (tab !== "drafts" && threadEndpointAvailable !== false) {
      const cacheRequest: MailboxListRequest = {
        ...mailboxListRequest(tab),
        offset: threadCursorIndex.value * limit,
      };
      const cached = mailboxCache.getList<InboxMessage>(
        mailboxCacheScope(auth.user?.id),
        cacheRequest,
      );
      const cachedThreads = cached?.messages
        .map((message) => message.metadata?.threadSummary)
        .filter((thread): thread is MailboxThreadSummary => Boolean(thread));
      if (cached && cachedThreads?.length === cached.messages.length) {
        threadMode.value = true;
        threadSummaries.value = cachedThreads;
        threadNextCursor.value =
          threadPageNextCursors.get(requestedThreadPageKey) ?? null;
        messages.value = cached.messages;
        total.value = cached.total;
        messagesLoaded.value = true;
        loading.value = false;
        syncSelectedMessages(cached.messages);
        renderedThreadPageKey = requestedThreadPageKey;
        await restoreConversationScroll(requestedThreadPageKey);
      } else {
        loading.value = true;
        messagesLoaded.value = false;
      }
      const params = new URLSearchParams({
        folder: emailTabConfig[tab].folderParam,
        limit: String(limit),
      });
      const query = searchQuery.value.trim();
      const cursor = threadCursorHistory.value[threadCursorIndex.value];
      if (query) params.set("q", query);
      if (cursor) params.set("cursor", cursor);
      try {
        const data = await api.get<MailboxThreadsResponse>(
          `/mailbox/threads?${params.toString()}`,
        );
        if (requestId !== messageRequestId) return;
        threadEndpointAvailable = true;
        threadMode.value = true;
        threadSummaries.value = data.threads || [];
        threadNextCursor.value = data.nextCursor || null;
        threadPageNextCursors.set(
          requestedThreadPageKey,
          threadNextCursor.value,
        );
        messages.value = threadSummaries.value.map((thread) =>
          threadSummaryToMessage(thread, tab),
        );
        total.value =
          threadCursorIndex.value * limit +
          messages.value.length +
          (threadNextCursor.value ? 1 : 0);
        mailboxCache.setList(
          mailboxCacheScope(auth.user?.id),
          cacheRequest,
          { messages: messages.value, total: total.value },
        );
        messagesLoaded.value = true;
        syncSelectedMessages(messages.value);
        renderedThreadPageKey = requestedThreadPageKey;
        await restoreConversationScroll(requestedThreadPageKey);
        return;
      } catch (err) {
        if (!isMissingThreadEndpoint(err)) throw err;
        threadEndpointAvailable = false;
      }
    }

    await loadLegacyMessages(tab, requestId);
  } catch (err) {
    if (
      err instanceof Error &&
      "status" in err &&
      (err as any).status === 403
    ) {
      error.value = "pro_required";
    } else {
      error.value =
        err instanceof Error ? err.message : "Failed to load messages";
    }
  } finally {
    if (requestId === messageRequestId) loading.value = false;
  }
}

async function applySearch() {
  offset.value = 0;
  resetThreadPagination();
  clearOpenConversation();
  clearSelectedMessages();
  await loadMessages();
}

async function applyMobileSearch() {
  await applySearch();
}

async function clearSearch() {
  if (!searchQuery.value) return;
  searchQuery.value = "";
  await applySearch();
}

function updateMessageLocally(id: string, patch: Partial<InboxMessage>) {
  messages.value = messages.value.map((message) =>
    message.id === id ? { ...message, ...patch } : message,
  );
  loadedThreadMessages.value = loadedThreadMessages.value.map((message) =>
    message.id === id ? { ...message, ...patch } : message,
  );
}

function updateThreadSummary(
  threadId: string,
  patch: Partial<MailboxThreadSummary>,
) {
  threadSummaries.value = threadSummaries.value.map((thread) =>
    thread.id === threadId ? { ...thread, ...patch } : thread,
  );
  const latestId = threadSummaries.value.find(
    (thread) => thread.id === threadId,
  )?.latestMessageId;
  if (latestId && patch.unreadCount !== undefined) {
    updateMessageLocally(latestId, {
      unread: patch.unreadCount > 0,
      readAt: patch.unreadCount > 0 ? null : new Date().toISOString(),
    });
  }
}

async function fetchThreadMessages(
  thread: MailboxThreadSummary,
): Promise<InboxMessage[]> {
  if (loadedThreadId.value === thread.id && loadedThreadMessages.value.length) {
    return loadedThreadMessages.value;
  }
  const data = await api.get<MailboxThreadResponse>(
    `/mailbox/threads/${encodeURIComponent(thread.id)}`,
  );
  if (selectedThreadId.value === thread.id) {
    loadedThreadId.value = thread.id;
    loadedThreadMessages.value = data.messages || [];
  }
  updateThreadSummary(thread.id, data.thread || thread);
  return data.messages || [];
}

function clearDeliveryStatusRefreshes() {
  deliveryStatusRefreshTimers.forEach((timer) => window.clearTimeout(timer));
  deliveryStatusRefreshTimers.clear();
  deliveryRefreshAttemptedIds.clear();
  deliveryRetryConfirmId.value = null;
}

function scheduleDeliveryStatusRefresh(
  message: InboxMessage,
  delivery: MailboxDeliveryStatus,
) {
  const existing = deliveryStatusRefreshTimers.get(message.id);
  if (existing) {
    window.clearTimeout(existing);
    deliveryStatusRefreshTimers.delete(message.id);
  }
  const unknownAfter = delivery.unknownAfter
    ? parseApiDate(delivery.unknownAfter).getTime()
    : Number.NaN;
  if (
    delivery.state !== "sending" ||
    !Number.isFinite(unknownAfter) ||
    deliveryRefreshAttemptedIds.has(message.id)
  ) {
    return;
  }
  const delay = Math.max(250, unknownAfter - Date.now() + 250);
  const timer = window.setTimeout(() => {
    deliveryStatusRefreshTimers.delete(message.id);
    deliveryRefreshAttemptedIds.add(message.id);
    const stillSelected =
      expandedId.value === message.id ||
      (Boolean(selectedThreadId.value) &&
        loadedThreadMessages.value.some(
          (candidate) => candidate.id === message.id,
        ));
    if (stillSelected) void loadDeliveryStatus(message);
  }, delay);
  deliveryStatusRefreshTimers.set(message.id, timer);
}

function isTerminalDeliveryState(state: MailboxDeliveryStatus["state"]): boolean {
  return state === "sent" || state === "failed" || state === "rejected";
}

async function refreshMailboxMessage(id: string): Promise<InboxMessage | null> {
  try {
    const data = await api.get<{ message: InboxMessage }>(
      `/mailbox/messages/${encodeURIComponent(id)}`,
    );
    updateMessageLocally(id, data.message);
    cacheActiveMessages();
    return data.message;
  } catch {
    return null;
  }
}

async function openMessageFromRoute() {
  const id = typeof route.query.message === "string" ? route.query.message.trim() : "";
  if (!id) return;
  if (!messages.value.some((message) => message.id === id)) {
    try {
      const data = await api.get<{ message: InboxMessage }>(
        `/mailbox/messages/${encodeURIComponent(id)}`,
      );
      messages.value = [data.message, ...messages.value];
    } catch (err) {
      toastFromUnknown(err, "The source email could not be opened");
      return;
    }
  }
  await selectMessage(id);
}

async function refreshDraftDeliveryState(id: string) {
  const refreshed = await refreshMailboxMessage(id);
  if (!refreshed) return;
  if (refreshed.kind === "draft" && refreshed.status === "approved") {
    await loadDeliveryStatus(refreshed);
    return;
  }
  if (activeTab.value === "drafts") await loadMessages();
  void loadFolderCounts();
}

async function loadDeliveryStatus(message: InboxMessage) {
  if (message.kind !== "draft" || message.status !== "approved") return;
  try {
    const data = await api.get<{ delivery: MailboxDeliveryStatus }>(
      `/mailbox/drafts/${encodeURIComponent(message.id)}/delivery-status`,
    );
    deliveryStatuses.value = {
      ...deliveryStatuses.value,
      [message.id]: data.delivery,
    };
    if (isTerminalDeliveryState(data.delivery.state)) {
      await refreshMailboxMessage(message.id);
      if (activeTab.value === "drafts") await loadMessages();
      void loadFolderCounts();
      return;
    }
    scheduleDeliveryStatusRefresh(message, data.delivery);
  } catch {
    // Older Core versions do not expose delivery reconciliation.
  }
}

function isDeliveryUnknown(message: InboxMessage): boolean {
  return deliveryStatuses.value[message.id]?.state === "delivery_unknown";
}

async function loadSelectedThread(thread: MailboxThreadSummary) {
  const requestId = ++threadRequestId;
  threadDetailLoading.value = true;
  threadDetailError.value = "";
  try {
    const data = await api.get<MailboxThreadResponse>(
      `/mailbox/threads/${encodeURIComponent(thread.id)}`,
    );
    if (requestId !== threadRequestId || selectedThreadId.value !== thread.id) {
      return;
    }
    loadedThreadId.value = thread.id;
    loadedThreadMessages.value = data.messages || [];
    updateThreadSummary(thread.id, data.thread || thread);
    void Promise.all(loadedThreadMessages.value.map(loadDeliveryStatus));
    await markVisibleThreadRead();
  } catch (err) {
    if (requestId !== threadRequestId) return;
    threadDetailError.value =
      err instanceof Error ? err.message : "Failed to load this conversation";
  } finally {
    if (requestId === threadRequestId) threadDetailLoading.value = false;
  }
}

async function markVisibleThreadRead() {
  const threadId = selectedThreadId.value;
  const unread = selectedThreadMessages.value.filter(
    (message) => message.unread,
  );
  if (unread.length === 0) return;

  const readAt = new Date().toISOString();
  for (const message of unread) {
    updateMessageLocally(message.id, {
      readAt,
      unread: false,
    });
  }

  const results = threadId
    ? await Promise.allSettled([
        api.post(
          `/mailbox/threads/${encodeURIComponent(threadId)}/read`,
          { read: true },
        ),
      ])
    : await Promise.allSettled(
        unread.map((message) =>
          api.post(`/mailbox/messages/${message.id}/read`, { read: true }),
        ),
      );
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    const failed = threadId
      ? unread
      : unread[index]
        ? [unread[index]]
        : [];
    failed.forEach((message) =>
      updateMessageLocally(message.id, {
        readAt: message.readAt,
        unread: message.unread,
      }),
    );
  });
  cacheActiveMessages();
  void loadFolderCounts();
  if (results.some((result) => result.status === "rejected")) {
    toast.error("Some messages could not be marked as read.");
  } else if (threadId) {
    updateThreadSummary(threadId, { unreadCount: 0 });
  }
}

async function loadMailboxHealth() {
  try {
    const mailboxData = await api.get<FullMailboxResponse>(
      "/mailbox?include_activity=0",
    );
    mailboxAddress.value = mailboxData.mailbox?.aliasAddress || null;
    mailboxMeta.value = mailboxData.mailbox ?? null;
    mailboxSources.value = mailboxData.sources || [];
  } catch {
    mailboxAddress.value = null;
    mailboxMeta.value = null;
    mailboxSources.value = [];
  }
}

async function loadProviderSettings() {
  if (providerSettingsRequested) return;
  providerSettingsRequested = true;
  try {
    const providerData = await api.get<EmailProviderSettingsResponse>(
      "/email-provider-settings",
    );
    const activeProvider = providerData?.providers.find(
      (provider) => provider.id === providerData.activeProviderId,
    );
    const activeFromAddress = activeProvider?.config.fromAddress || "";
    configuredEmailAddress.value = isPublicEmailAddress(activeFromAddress)
      ? activeFromAddress.trim().toLowerCase()
      : null;
  } catch {
    configuredEmailAddress.value = null;
  }
}

async function loadTelegramHealth() {
  if (telegramHealthRequested) return;
  telegramHealthRequested = true;
  try {
    const telegramData = await api.get<TelegramStatusResponse>(
      "/telegram/status",
    );
    telegramHealth.value = {
      configured: telegramData.configured,
      connectionStatus: telegramData.connection?.status ?? null,
    };
  } catch {
    telegramHealth.value = null;
  }
}

async function loadContactsForCompose() {
  if (contactsRequested) return;
  contactsRequested = true;
  await contactsStore.fetchContacts();
}

function scrollTelegramToBottom() {
  const el = telegramChatRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

async function loadTelegramHistory() {
  telegramLoading.value = true;
  telegramLoadingMore.value = false;
  telegramError.value = "";
  telegramMoreError.value = "";
  try {
    await Promise.all([loadMailboxHealth(), loadTelegramHealth()]);
    const turnResponse = await api.get<AgentTurnsResponse>(
      `/agent/turns?channel=telegram&limit=${TELEGRAM_PAGE_LIMIT}&offset=0`,
    );
    turns.value = turnResponse.turns || [];
    telegramTotal.value =
      typeof turnResponse.total === "number"
        ? turnResponse.total
        : turns.value.length;
    await nextTick();
    scrollTelegramToBottom();
  } catch (err) {
    turns.value = [];
    telegramTotal.value = 0;
    telegramError.value =
      err instanceof Error ? err.message : "Failed to load Telegram";
  } finally {
    telegramLoading.value = false;
  }
}

async function loadMoreTelegramTurns() {
  if (
    telegramLoading.value ||
    telegramLoadingMore.value ||
    telegramClearing.value ||
    !telegramHasMore.value
  ) {
    return;
  }
  const el = telegramChatRef.value;
  const prevScrollHeight = el?.scrollHeight ?? 0;
  const prevScrollTop = el?.scrollTop ?? 0;

  telegramLoadingMore.value = true;
  telegramMoreError.value = "";
  try {
    const nextOffset = turns.value.length;
    const turnResponse = await api.get<AgentTurnsResponse>(
      `/agent/turns?channel=telegram&limit=${TELEGRAM_PAGE_LIMIT}&offset=${nextOffset}`,
    );
    if (typeof turnResponse.total === "number") {
      telegramTotal.value = turnResponse.total;
    }
    const batch = turnResponse.turns || [];
    const seen = new Set(turns.value.map((t) => t.id));
    const merged = batch.filter((t) => !seen.has(t.id));
    turns.value = [...turns.value, ...merged];
    await nextTick();
    if (el && prevScrollHeight > 0) {
      el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight);
    }
  } catch (err) {
    telegramMoreError.value =
      err instanceof Error ? err.message : "Failed to load older messages";
  } finally {
    telegramLoadingMore.value = false;
  }
}

async function clearTelegramHistory() {
  if (telegramClearing.value || turns.value.length === 0) return;
  const confirmed = window.confirm(
    "Clear all stored Telegram history for this account? This will not disconnect Telegram.",
  );
  if (!confirmed) return;

  telegramClearing.value = true;
  telegramError.value = "";
  telegramMoreError.value = "";

  try {
    const result = await api.delete<ClearTelegramHistoryResponse>(
      "/agent/turns?channel=telegram",
    );
    turns.value = [];
    telegramTotal.value = 0;
    toastSuccess(
      result.deletedTurns > 0 || result.deletedEvents > 0
        ? "Telegram history cleared."
        : "Telegram history was already empty.",
    );
  } catch (err) {
    telegramMoreError.value =
      err instanceof Error ? err.message : "Failed to clear Telegram history";
  } finally {
    telegramClearing.value = false;
  }
}

function switchTab(tab: Tab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  offset.value = 0;
  resetThreadPagination();
  clearOpenConversation();
  clearSelectedMessages();
  error.value = "";
  telegramError.value = "";
  telegramMoreError.value = "";
  if (tab === "telegram") {
    void loadTelegramHistory();
  } else {
    void loadMessages();
  }
}

function switchMailFolderTab(tabId: string) {
  if (tabId === "contacts") {
    void router.push("/contacts");
    return;
  }
  if (tabId === "campaigns") {
    void router.push("/email/campaigns");
    return;
  }
  if (emailTabOrder.includes(tabId as EmailTab)) {
    if (activeTab.value === tabId) return;
    void router.replace({
      path: "/email",
      query: tabId === "inbox" ? {} : { tab: tabId },
    });
    switchTab(tabId as Tab);
  }
}

async function refreshMessagesPage() {
  if (activeTab.value === "telegram") {
    await loadTelegramHistory();
  } else {
    await loadMessages();
    await Promise.all([loadMailboxHealth(), loadFolderCounts()]);
  }
}

async function selectMessage(id: string) {
  clearDeliveryStatusRefreshes();
  expandedId.value = id;
  mobileThreadOpen.value = true;
  const thread = threadSummaries.value.find(
    (candidate) => candidate.latestMessageId === id,
  );
  if (threadMode.value && thread) {
    selectedThreadId.value = thread.id;
    loadedThreadId.value = null;
    loadedThreadMessages.value = [];
    await loadSelectedThread(thread);
    return;
  }
  selectedThreadId.value = null;
  await markVisibleThreadRead();
  const message = messages.value.find((candidate) => candidate.id === id);
  if (message) void loadDeliveryStatus(message);
}

async function approveMessage(msg: InboxMessage) {
  if (inboxBusy.value) return;
  actionPending.value = msg.id;
  error.value = "";
  const previousMessages = messages.value;
  const previousTotal = total.value;
  const previousExpandedId = expandedId.value;
  const previousMobileThreadOpen = mobileThreadOpen.value;
  selectNextMessageAfterRemoval(previousMessages, new Set([msg.id]));
  ignorePendingMessageResponses();
  removeMessageLocally(msg.id);
  cacheActiveMessages();
  try {
    await runDraftAction(msg.id, "approve");
    void loadFolderCounts();
  } catch (err) {
    messages.value = previousMessages;
    total.value = previousTotal;
    expandedId.value = previousExpandedId;
    mobileThreadOpen.value = previousMobileThreadOpen;
    syncSelectedMessages(previousMessages);
    cacheActiveMessages();
    await refreshDraftDeliveryState(msg.id);
    error.value = err instanceof Error ? err.message : "Failed to approve";
  } finally {
    actionPending.value = null;
  }
}

async function rejectMessage(msg: InboxMessage) {
  if (inboxBusy.value) return;
  actionPending.value = msg.id;
  error.value = "";
  const previousMessages = messages.value;
  const previousTotal = total.value;
  const previousExpandedId = expandedId.value;
  const previousMobileThreadOpen = mobileThreadOpen.value;
  selectNextMessageAfterRemoval(previousMessages, new Set([msg.id]));
  ignorePendingMessageResponses();
  removeMessageLocally(msg.id);
  cacheActiveMessages();
  try {
    await runDraftAction(msg.id, "reject");
    void loadFolderCounts();
  } catch (err) {
    messages.value = previousMessages;
    total.value = previousTotal;
    expandedId.value = previousExpandedId;
    mobileThreadOpen.value = previousMobileThreadOpen;
    syncSelectedMessages(previousMessages);
    cacheActiveMessages();
    error.value = err instanceof Error ? err.message : "Failed to reject";
  } finally {
    actionPending.value = null;
  }
}

async function moveMessage(
  msg: InboxMessage,
  folder: "inbox" | "archive" | "trash",
) {
  if (inboxBusy.value) return;
  deletePending.value = msg.id;
  error.value = "";
  const previousMessages = messages.value;
  const previousTotal = total.value;
  const previousExpandedId = expandedId.value;
  const previousMobileThreadOpen = mobileThreadOpen.value;
  const previousSelectedMessageIds = new Set(selectedMessageIds.value);
  const previousFolder =
    msg.folder ||
    (activeTab.value === "telegram"
      ? "inbox"
      : emailTabConfig[activeTab.value].folderParam);
  const targetIsCurrentTab =
    activeTab.value !== "telegram" &&
    emailTabConfig[activeTab.value].folderParam === folder;
  ignorePendingMessageResponses();
  messages.value = targetIsCurrentTab
    ? messages.value.map((message) =>
        message.id === msg.id
          ? { ...message, folder }
          : message,
      )
    : messages.value.filter((message) => message.id !== msg.id);
  if (!targetIsCurrentTab) {
    total.value = Math.max(0, total.value - 1);
    selectNextMessageAfterRemoval(previousMessages, new Set([msg.id]));
  }
  syncSelectedMessages(messages.value);
  cacheActiveMessages();

  try {
    await api.post(`/mailbox/messages/${msg.id}/move`, { folder });
    void loadFolderCounts();
    showMoveToast(folder, [{ id: msg.id, folder: previousFolder }]);
  } catch (err) {
    messages.value = previousMessages;
    total.value = previousTotal;
    expandedId.value = previousExpandedId;
    mobileThreadOpen.value = previousMobileThreadOpen;
    syncSelectedMessages(previousMessages);
    selectedMessageIds.value = previousSelectedMessageIds;
    cacheActiveMessages();
    error.value = err instanceof Error ? err.message : "Failed to move message";
  } finally {
    deletePending.value = null;
  }
}

async function getConversationActionMessages(
  message: InboxMessage,
): Promise<InboxMessage[]> {
  const thread = getThreadSummary(message);
  if (!thread) return [message];
  const detail = await fetchThreadMessages(thread);
  const folder = isEmailTab(activeTab.value)
    ? emailTabConfig[activeTab.value].folderParam
    : message.folder;
  const matching = detail.filter(
    (candidate) => candidate.kind !== "draft" && candidate.folder === folder,
  );
  return matching.length ? matching : detail.filter((candidate) => candidate.kind !== "draft");
}

async function moveConversation(
  message: InboxMessage,
  folder: "inbox" | "archive" | "trash",
) {
  const thread = getThreadSummary(message);
  if (!thread) {
    await moveMessage(message, folder);
    return;
  }
  if (inboxBusy.value) return;
  deletePending.value = message.id;
  error.value = "";
  try {
    const previousFolder = emailTabConfig[activeTab.value as EmailTab].folderParam;
    const previousMessages = messages.value;
    const previousThreads = threadSummaries.value;
    const previousExpandedId = expandedId.value;
    const previousSelectedThreadId = selectedThreadId.value;
    const previousLoadedThreadId = loadedThreadId.value;
    const previousLoadedMessages = loadedThreadMessages.value;
    const previousSelectedIds = new Set(selectedMessageIds.value);
    const previousMobileThreadOpen = mobileThreadOpen.value;
    const wasOpen = selectedThreadId.value === thread.id;
    messages.value = messages.value.filter((candidate) => candidate.id !== message.id);
    threadSummaries.value = threadSummaries.value.filter(
      (candidate) => candidate.id !== thread.id,
    );
    total.value = Math.max(0, total.value - 1);
    clearSelectedMessages();
    if (wasOpen) {
      clearOpenConversation();
    }

    try {
      await api.post(
        `/mailbox/threads/${encodeURIComponent(thread.id)}/move`,
        { folder, fromFolder: previousFolder },
      );
    } catch {
      messages.value = previousMessages;
      threadSummaries.value = previousThreads;
      expandedId.value = previousExpandedId;
      selectedThreadId.value = previousSelectedThreadId;
      loadedThreadId.value = previousLoadedThreadId;
      loadedThreadMessages.value = previousLoadedMessages;
      selectedMessageIds.value = previousSelectedIds;
      mobileThreadOpen.value = previousMobileThreadOpen;
      await loadMessages();
      error.value = "This conversation could not be moved. The folder was refreshed.";
      return;
    }
    showThreadMoveToast(folder, [{ id: thread.id, folder: previousFolder }]);
    await loadFolderCounts();
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to move conversation";
  } finally {
    deletePending.value = null;
  }
}

async function moveSelectedThreads(folder: "inbox" | "archive" | "trash") {
  const selected = selectedMessages.value;
  if (inboxBusy.value || selected.length === 0) return;
  bulkActionPending.value = true;
  error.value = "";
  try {
    const previousFolder = emailTabConfig[activeTab.value as EmailTab].folderParam;
    const selectedLatestIds = new Set(selected.map((message) => message.id));
    const selectedThreadIds = new Set(
      selected
        .map((message) => getThreadSummary(message)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    messages.value = messages.value.filter(
      (message) => !selectedLatestIds.has(message.id),
    );
    threadSummaries.value = threadSummaries.value.filter(
      (thread) => !selectedThreadIds.has(thread.id),
    );
    total.value = Math.max(0, total.value - selectedThreadIds.size);
    clearSelectedMessages();
    if (selectedThreadId.value && selectedThreadIds.has(selectedThreadId.value)) {
      clearOpenConversation();
    }
    const moves = [...selectedThreadIds].map((id) => ({
      id,
      folder: previousFolder,
    }));
    const results = await Promise.allSettled(
      [...selectedThreadIds].map((id) =>
        api.post(`/mailbox/threads/${encodeURIComponent(id)}/move`, {
          folder,
          fromFolder: previousFolder,
        }),
      ),
    );
    const successfulMoves = moves.filter(
      (_, index) => results[index]?.status === "fulfilled",
    );
    if (results.some((result) => result.status === "rejected")) {
      await loadMessages();
      error.value = "Some conversations could not be moved. The folder was refreshed.";
    }
    if (successfulMoves.length) showThreadMoveToast(folder, successfulMoves);
    await loadFolderCounts();
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to move conversations";
  } finally {
    bulkActionPending.value = false;
  }
}

async function moveSelectedMessages(folder: "inbox" | "archive" | "trash") {
  if (threadMode.value) {
    await moveSelectedThreads(folder);
    return;
  }
  if (inboxBusy.value || selectedMessages.value.length === 0) return;
  bulkActionPending.value = true;
  error.value = "";
  const previousMessages = messages.value;
  const selected = selectedMessages.value;
  const ids = new Set(selected.map((message) => message.id));
  const undoMoves = selected.map((message) => ({
    id: message.id,
    folder:
      message.folder ||
      (activeTab.value === "telegram"
        ? ("inbox" as const)
        : emailTabConfig[activeTab.value].folderParam),
  }));
  const targetIsCurrentTab =
    activeTab.value !== "telegram" &&
    emailTabConfig[activeTab.value].folderParam === folder;
  ignorePendingMessageResponses();
  messages.value = targetIsCurrentTab
    ? messages.value.map((message) =>
        ids.has(message.id)
          ? {
              ...message,
              folder,
            }
          : message,
      )
    : messages.value.filter((message) => !ids.has(message.id));
  if (!targetIsCurrentTab) {
    total.value = Math.max(0, total.value - ids.size);
    selectNextMessageAfterRemoval(previousMessages, ids);
  }
  clearSelectedMessages();
  syncSelectedMessages(messages.value);
  cacheActiveMessages();

  const results = await Promise.allSettled(
    [...ids].map((id) =>
      api.post(`/mailbox/messages/${id}/move`, { folder }),
    ),
  );
  const successfulMoves = undoMoves.filter(
    (_, index) => results[index]?.status === "fulfilled",
  );
  const failedCount = results.length - successfulMoves.length;
  if (failedCount > 0) {
    await loadMessages();
    error.value = `${failedCount} ${
      failedCount === 1 ? "message" : "messages"
    } could not be moved. The folder was refreshed.`;
  }
  await loadFolderCounts();
  if (successfulMoves.length > 0) showMoveToast(folder, successfulMoves);
  bulkActionPending.value = false;
}

async function deleteSelectedMessagesPermanently() {
  if (inboxBusy.value || selectedMessages.value.length === 0) return;
  if (threadMode.value) {
    const selected = selectedMessages.value;
    const confirmed = window.confirm(
      `Permanently delete ${selected.length} selected ${
        selected.length === 1 ? "conversation" : "conversations"
      }?`,
    );
    if (!confirmed) return;
    bulkActionPending.value = true;
    error.value = "";
    try {
      const groups = await Promise.all(
        selected.map((message) => getConversationActionMessages(message)),
      );
      const targets = groups
        .flat()
        .filter(
          (message, index, all) =>
            all.findIndex((candidate) => candidate.id === message.id) === index,
        );
      const selectedIds = new Set(selected.map((message) => message.id));
      const selectedThreadIds = new Set(
        selected
          .map((message) => getThreadSummary(message)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      messages.value = messages.value.filter(
        (message) => !selectedIds.has(message.id),
      );
      threadSummaries.value = threadSummaries.value.filter(
        (thread) => !selectedThreadIds.has(thread.id),
      );
      total.value = Math.max(0, total.value - selectedThreadIds.size);
      clearSelectedMessages();
      if (
        selectedThreadId.value &&
        selectedThreadIds.has(selectedThreadId.value)
      ) {
        clearOpenConversation();
      }
      const results = await Promise.allSettled(
        targets.map((message) => api.delete(`/mailbox/messages/${message.id}`)),
      );
      if (results.some((result) => result.status === "rejected")) {
        await loadMessages();
        error.value =
          "Some conversations could not be deleted. Trash was refreshed.";
      }
      await loadFolderCounts();
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to delete conversations";
    } finally {
      bulkActionPending.value = false;
    }
    return;
  }
  const confirmed = window.confirm(
    `Permanently delete ${selectedMessages.value.length} selected ${
      selectedMessages.value.length === 1 ? "message" : "messages"
    }?`,
  );
  if (!confirmed) return;

  bulkActionPending.value = true;
  error.value = "";
  const ids = new Set(selectedMessages.value.map((message) => message.id));
  ignorePendingMessageResponses();
  messages.value = messages.value.filter((message) => !ids.has(message.id));
  total.value = Math.max(0, total.value - ids.size);
  clearSelectedMessages();
  syncSelectedMessages(messages.value);
  cacheActiveMessages();

  const results = await Promise.allSettled(
    [...ids].map((id) => api.delete(`/mailbox/messages/${id}`)),
  );
  const failedCount = results.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failedCount > 0) {
    await loadMessages();
    error.value = `${failedCount} ${
      failedCount === 1 ? "message" : "messages"
    } could not be deleted. Trash was refreshed.`;
  }
  await loadFolderCounts();
  bulkActionPending.value = false;
}

type PreviousReadState = Pick<InboxMessage, "id" | "readAt" | "unread">;

async function restoreMessageReadStates(states: PreviousReadState[]) {
  if (inboxBusy.value || states.length === 0) return;
  actionPending.value = states[0].id;
  states.forEach((state) => updateMessageLocally(state.id, state));
  const results = await Promise.allSettled(
    states.map((state) =>
      api.post(`/mailbox/messages/${state.id}/read`, { read: !state.unread }),
    ),
  );
  if (results.some((result) => result.status === "rejected")) {
    await loadMessages();
    error.value = "Some read states could not be restored. The folder was refreshed.";
  } else {
    cacheActiveMessages();
    toastSuccess("Read state restored.");
  }
  await loadFolderCounts();
  actionPending.value = null;
}

async function markMessageRead(msg: InboxMessage, read = true) {
  if (inboxBusy.value) return;
  actionPending.value = msg.id;
  error.value = "";
  const targets =
    selectedMessage.value?.id === msg.id ? selectedThreadMessages.value : [msg];
  const previousStates = targets.map(({ id, readAt, unread }) => ({
    id,
    readAt,
    unread,
  }));
  const readAt = new Date().toISOString();
  targets.forEach((target) => {
    updateMessageLocally(target.id, {
      readAt: read ? target.readAt || readAt : null,
      unread: target.direction === "inbound" && !read,
    });
  });
  const results = await Promise.allSettled(
    targets.map((target) =>
      api.post(`/mailbox/messages/${target.id}/read`, { read }),
    ),
  );
  if (results.some((result) => result.status === "rejected")) {
    await loadMessages();
    error.value = "Some messages could not be updated. The folder was refreshed.";
  } else {
    cacheActiveMessages();
    if (selectedThreadId.value) {
      updateThreadSummary(selectedThreadId.value, {
        unreadCount: read
          ? 0
          : Math.max(
              1,
              selectedThreadMessages.value.filter(
                (message) => message.direction === "inbound",
              ).length,
            ),
      });
    }
    toast.success(read ? "Marked as read." : "Marked as unread.", {
      action: {
        label: "Undo",
        onClick: () => void restoreMessageReadStates(previousStates),
      },
    });
  }
  await loadFolderCounts();
  actionPending.value = null;
}

async function markConversationRead(message: InboxMessage, read: boolean) {
  const thread = getThreadSummary(message);
  if (!thread) {
    await markMessageRead(message, read);
    return;
  }
  if (inboxBusy.value) return;
  actionPending.value = message.id;
  error.value = "";
  try {
    await api.post(
      `/mailbox/threads/${encodeURIComponent(thread.id)}/read`,
      { read },
    );
    const readAt = new Date().toISOString();
    const targets =
      loadedThreadId.value === thread.id
        ? loadedThreadMessages.value.filter(
            (candidate) => candidate.direction === "inbound",
          )
        : [];
    targets.forEach((target) =>
      updateMessageLocally(target.id, {
        readAt: read ? target.readAt || readAt : null,
        unread: !read,
      }),
    );
    updateThreadSummary(thread.id, {
      unreadCount: read ? 0 : Math.max(1, targets.length || thread.messageCount),
    });
    toastSuccess(read ? "Conversation marked as read." : "Conversation marked as unread.");
    await loadFolderCounts();
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to update conversation";
  } finally {
    actionPending.value = null;
  }
}

async function unsubscribeFromMessage(message: InboxMessage) {
  if (!message.unsubscribeAction || inboxBusy.value) return;
  unsubscribePending.value = message.id;
  error.value = "";
  try {
    const response = await api.post<MailboxUnsubscribeResponse>(
      `/mailbox/messages/${message.id}/unsubscribe`,
    );
    if (response.mode === "open") {
      window.open(response.url, "_blank", "noopener,noreferrer");
      toastSuccess("Opened unsubscribe link.");
    } else {
      toastSuccess("Unsubscribe request sent.");
    }
  } catch (err) {
    toastFromUnknown(err, "Failed to unsubscribe from this sender");
  } finally {
    unsubscribePending.value = null;
  }
}

function getDisplayText(value: string | null | undefined): string {
  if (!value) return "";
  return repairLikelyMojibake(decodeMimeHeaderValue(value));
}

function getMessagePreview(message: InboxMessage): string {
  return getDisplayText(message.preview || message.body);
}

function getMessageTextBody(message: InboxMessage): string {
  return getDisplayText(message.body || message.preview);
}

function getComposeSnapshot(): string {
  return JSON.stringify({
    form: composeForm.value,
    replyToMessageId: composeReplyToMessageId.value,
    preservedAttachmentKeys: composePreservedAttachmentKeys.value,
    uploadedAttachmentKeys: composeUploadedAttachments.value.map(
      (attachment) => attachment.storageKey || attachment.filename || "",
    ),
  });
}

const composeHasUnsavedChanges = computed(
  () => composeInitialSnapshot.value !== getComposeSnapshot(),
);
const composeCanSaveDraft = computed(
  () =>
    Boolean(composeDraftId.value) ||
    Boolean(composeForm.value.to.trim()) ||
    Boolean(composeForm.value.subject.trim()) ||
    Boolean(composeForm.value.textBody.trim()) ||
    composeVisibleAttachments.value.length > 0,
);
const composeCanSend = computed(
  () =>
    Boolean(composeForm.value.to.trim()) &&
    Boolean(composeForm.value.subject.trim()) &&
    Boolean(composeForm.value.textBody.trim()),
);

function showComposeDialog() {
  composeInitialSnapshot.value = getComposeSnapshot();
  composeOpen.value = true;
  void nextTick(() => {
    document.getElementById("compose-to")?.focus();
  });
}

function openComposeModal(
  message?: InboxMessage,
  mode: "reply" | "forward" = "reply",
) {
  void Promise.all([loadProviderSettings(), loadContactsForCompose()]);
  composeError.value = "";
  composeDraftId.value = null;
  composeReplyToMessageId.value = null;
  composePreservedAttachmentKeys.value = [];
  composePreservedAttachments.value = [];
  composeUploadedAttachments.value = [];
  composeUploadingAttachments.value = false;
  composeToFocused.value = false;
  composeToHasTyped.value = false;
  composeToActiveIndex.value = 0;
  const defaultFromAddress =
    outboundSenderOptions.value.find(
      (option) => option.address === message?.toAddress,
    )?.address ||
    outboundSenderOptions.value.find(
      (option) => option.address === message?.fromAddress,
    )?.address ||
    outboundSenderOptions.value[0]?.address ||
    "";

  if (message) {
    if (isEditableDraft(message)) {
      composeMode.value = "edit";
      composeDraftId.value = message.id;
      const existingAttachments = getForwardableAttachments(message);
      composePreservedAttachments.value = existingAttachments;
      composePreservedAttachmentKeys.value = existingAttachments
        .map((attachment) => attachment.storageKey?.trim() || "")
        .filter(Boolean);
      composeForm.value = {
        fromAddress: message.fromAddress || defaultFromAddress,
        to: message.toAddress || "",
        subject: getDisplayText(message.subject),
        textBody: getMessageTextBody(message),
      };
      showComposeDialog();
      return;
    }

    if (mode === "forward") {
      composeMode.value = "forward";
      const originalBody = getMessageTextBody(message);
      const forwardableAttachments = getForwardableAttachments(message);
      composePreservedAttachments.value = forwardableAttachments;
      composePreservedAttachmentKeys.value = forwardableAttachments
        .map((attachment) => attachment.storageKey?.trim() || "")
        .filter(Boolean);
      const forwardedLines = [
        "",
        "",
        "---------- Forwarded message ---------",
        `From: ${formatSenderValue(message)}`,
        `Date: ${formatDateTimePart(parseApiDate(message.createdAt), {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: auth.user?.timezone || undefined,
        })}`,
        `Subject: ${getMessageSubject(message)}`,
        `To: ${formatRecipientValue(message)}`,
        "",
        originalBody,
      ];
      composeForm.value = {
        fromAddress: defaultFromAddress,
        to: "",
        subject: /^fwd:\s*/i.test(getMessageSubject(message))
          ? getMessageSubject(message)
          : `Fwd: ${getMessageSubject(message)}`,
        textBody: forwardedLines.join("\n"),
      };
    } else {
      composeMode.value = "reply";
      composeReplyToMessageId.value = message.id;
      const replyTo =
        message.direction === "inbound" ? message.fromAddress : message.toAddress;
      const replyFromAddress =
        outboundSenderOptions.value.find(
          (option) => option.address === message.toAddress,
        )?.address || defaultFromAddress;
      composeForm.value = {
        fromAddress: replyFromAddress,
        to: replyTo || "",
        subject: /^(re|fwd):\s*/i.test(getMessageSubject(message))
          ? getMessageSubject(message)
          : `Re: ${getMessageSubject(message)}`,
        textBody: "",
      };
    }
  } else {
    composeMode.value = "new";
    composeForm.value = {
      fromAddress: defaultFromAddress,
      to: "",
      subject: "",
      textBody: "",
    };
  }
  showComposeDialog();
}

function forceCloseComposeModal() {
  composeDiscardConfirmOpen.value = false;
  composeOpen.value = false;
  composeToFocused.value = false;
  composeToHasTyped.value = false;
}

function requestCloseComposeModal() {
  if (composeSending.value) return;
  if (composeHasUnsavedChanges.value) {
    composeDiscardConfirmOpen.value = true;
    return;
  }
  forceCloseComposeModal();
}

function handleComposeKeydown(event: KeyboardEvent) {
  if (
    event.key !== "Enter" ||
    (!event.metaKey && !event.ctrlKey) ||
    !composeCanSend.value ||
    composeSending.value
  ) {
    return;
  }
  event.preventDefault();
  void saveDraft(true);
}

function selectComposeRecipient(contact: { email: string }) {
  composeForm.value.to = contact.email;
  composeToFocused.value = false;
  composeToHasTyped.value = false;
  composeToActiveIndex.value = 0;
  void nextTick(() => {
    document.getElementById("compose-subject")?.focus();
  });
}

function handleComposeToInput() {
  composeToFocused.value = true;
  composeToHasTyped.value = true;
  composeToActiveIndex.value = 0;
}

function handleComposeToBlur() {
  window.setTimeout(() => {
    composeToFocused.value = false;
    composeToHasTyped.value = false;
  }, 120);
}

function handleComposeToKeydown(event: KeyboardEvent) {
  if (!showComposeRecipientSuggestions.value) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    composeToActiveIndex.value =
      (composeToActiveIndex.value + 1) %
      composeRecipientSuggestions.value.length;
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    composeToActiveIndex.value =
      (composeToActiveIndex.value -
        1 +
        composeRecipientSuggestions.value.length) %
      composeRecipientSuggestions.value.length;
    return;
  }
  if (event.key === "Enter") {
    const selected =
      composeRecipientSuggestions.value[composeToActiveIndex.value];
    if (selected) {
      event.preventDefault();
      selectComposeRecipient(selected);
    }
    return;
  }
  if (event.key === "Escape") {
    composeToFocused.value = false;
  }
}

async function saveDraft(sendNow = false) {
  if (composeSending.value) return;
  composeSending.value = true;
  composeError.value = "";
  let draftSaved = false;
  try {
    const payload = {
      fromAddress: composeForm.value.fromAddress || undefined,
      to: composeForm.value.to,
      subject: composeForm.value.subject,
      textBody: composeForm.value.textBody,
      source: "user",
      replyToMessageId: composeReplyToMessageId.value || undefined,
      preservedAttachmentKeys: composePreservedAttachmentKeys.value,
      uploadedAttachments: composeUploadedAttachments.value,
    };
    let draftId = composeDraftId.value;
    const draftNeedsSaving =
      !draftId || !sendNow || composeHasUnsavedChanges.value;
    if (draftNeedsSaving) {
      const response = draftId
        ? await api.put<{ draft: InboxMessage | null }>(
            `/mailbox/drafts/${draftId}`,
            payload,
          )
        : await api.post<{ draft: InboxMessage | null }>(
            "/mailbox/drafts",
            payload,
          );
      if (!response.draft) {
        throw new Error("The draft could not be saved.");
      }
      draftId = response.draft.id;
      composeDraftId.value = draftId;
      composeMode.value = "edit";
      composeInitialSnapshot.value = getComposeSnapshot();
    }
    draftSaved = true;
    if (sendNow) {
      await api.post(`/mailbox/drafts/${draftId}/approve`);
    }
    forceCloseComposeModal();
    activeTab.value = sendNow ? "inbox" : "drafts";
    offset.value = 0;
    resetThreadPagination();
    clearOpenConversation();
    expandedId.value = sendNow ? null : draftId;
    await loadMessages();
    if (!sendNow) {
      expandedId.value = draftId;
      mobileThreadOpen.value = true;
    } else if (sendNow) {
      mobileThreadOpen.value = false;
      toastSuccess("Email sent.");
    }
    await loadFolderCounts();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    composeError.value =
      sendNow && draftSaved
        ? `Draft saved, but sending failed. ${message}`
        : `Failed to save draft. ${message}`;
  } finally {
    composeSending.value = false;
  }
}

async function uploadComposeAttachments(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const files = Array.from(input?.files || []);
  if (input) input.value = "";
  if (files.length === 0 || composeUploadingAttachments.value) return;

  composeUploadingAttachments.value = true;
  composeError.value = "";
  try {
    const formData = new FormData();
    for (const file of files) {
      formData.append("attachments", file);
    }
    const response = await api.upload<MailboxAttachmentUploadResponse>(
      "/mailbox/attachments",
      formData,
    );
    composeUploadedAttachments.value = [
      ...composeUploadedAttachments.value,
      ...(response.attachments || []),
    ];
  } catch (err) {
    composeError.value =
      err instanceof Error ? err.message : "Failed to upload attachment";
  } finally {
    composeUploadingAttachments.value = false;
  }
}

function removeUploadedAttachment(index: number) {
  composeUploadedAttachments.value = composeUploadedAttachments.value.filter(
    (_, currentIndex) => currentIndex !== index,
  );
}

function getComposeTitle(): string {
  if (composeMode.value === "edit") return "Edit draft";
  if (composeMode.value === "reply") return "Reply";
  if (composeMode.value === "forward") return "Forward";
  return "Compose";
}

function getComposePrimaryDraftLabel(): string {
  if (composeMode.value === "edit") return "Save draft";
  if (composeMode.value === "forward") return "Create forward";
  if (composeMode.value === "reply") return "Create reply";
  return "Create draft";
}

function getMojibakeScore(value: string): number {
  const suspiciousMatches =
    value.match(/(?:Â|Ã.|â[\u0080-\u00ff]{1,2}|[\u0080-\u009f])/g) || [];
  const replacementMatches = value.match(/\uFFFD/g) || [];
  return suspiciousMatches.length * 4 + replacementMatches.length * 8;
}

function repairLikelyMojibake(value: string): string {
  if (!/[ÂÃâ\u0080-\u009f\uFFFD]/.test(value)) return value;
  const beforeScore = getMojibakeScore(value);
  if (beforeScore === 0) return value;

  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const afterScore = getMojibakeScore(decoded);
    return afterScore < beforeScore ? decoded : value;
  } catch {
    return value;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(
      /\b(https?:\/\/[^\s<]+)\b/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

function restoreLikelyMarkdownBreaks(value: string): string {
  return value
    .replace(/\s+(#{1,6}\s+)/g, "\n\n$1")
    .replace(/\s+(\*[^*\n]{8,}\*)\s+(?=#{1,6}\s|#\w|\*[^*]+?\*)/g, "\n\n$1\n\n")
    .replace(/\s+(\*[A-Za-z][^*]{1,40}\*)\s+/g, "\n\n$1\n\n")
    .replace(/\s+(\d+\.\s+-\s+)/g, "\n$1")
    .replace(/\s+(#\w+(?:\s+#\w+)*)\s+/g, "\n\n$1\n");
}

function renderMarkdownBody(value: string): string {
  const normalized = restoreLikelyMarkdownBreaks(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  const lines = normalized.split("\n");
  const chunks: string[] = [];
  let paragraph: string[] = [];
  let orderedList: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    chunks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!orderedList.length) return;
    chunks.push(`<ol>${orderedList.join("")}</ol>`);
    orderedList = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 3) + 1;
      chunks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+-?\s*(.+)$/);
    if (ordered) {
      flushParagraph();
      orderedList.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    if (/^\*[^*]+\*$/.test(line) && line.length < 140) {
      flushParagraph();
      flushList();
      chunks.push(
        `<p><strong><em>${renderInlineMarkdown(line.slice(1, -1))}</em></strong></p>`,
      );
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return chunks.join("\n");
}

function getEmailFrameSecurityMeta(allowExternalContent = false): string {
  const resourceSources = allowExternalContent
    ? "https: http: data: blob:"
    : "data: blob:";
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${resourceSources}; media-src ${resourceSources}; font-src ${resourceSources}; style-src 'unsafe-inline' ${allowExternalContent ? "https: http:" : ""}; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">
    <meta name="referrer" content="no-referrer">`;
}

function renderMarkdownMessageDocument(body: string): string {
  return `<!doctype html>
<html>
  <head>
    <base target="_blank">
    ${getEmailFrameSecurityMeta()}
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html, body { margin: 0; min-height: 100%; overflow: visible; background: #fff; color: #24262b; }
      body { font: 16px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
      p { margin: 0 0 18px; }
      h2, h3, h4 { margin: 28px 0 14px; line-height: 1.25; }
      h2 { font-size: 24px; }
      h3 { font-size: 19px; }
      h4 { font-size: 16px; }
      ol { margin: 24px 0 0 26px; padding: 0; }
      li { margin: 5px 0; }
      a { color: #1a73e8; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function renderRichEmailDocument(
  body: string,
  allowExternalContent: boolean,
): string {
  const safeBody = body.replace(
    /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi,
    "",
  );
  const frameStyle = `<base target="_blank">
${getEmailFrameSecurityMeta(allowExternalContent)}
<style>
html, body { margin: 0; overflow: visible; background: #fff; }
img { max-width: 100%; height: auto; }
</style>`;

  if (/<html[\s>]/i.test(safeBody)) {
    if (/<head[\s>]/i.test(safeBody)) {
      return safeBody.replace(/<head([^>]*)>/i, `<head$1>${frameStyle}`);
    }
    return safeBody.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${frameStyle}</head>`,
    );
  }

  return `<!doctype html>
<html>
  <head>
    ${frameStyle}
    <meta charset="utf-8">
  </head>
  <body>${safeBody}</body>
</html>`;
}

function renderEmailHtml(message: InboxMessage): string {
  return renderRichEmailDocument(
    getDisplayText(message.htmlBody),
    externalContentAllowedIds.value.has(message.id),
  );
}

function hasExternalEmailContent(message: InboxMessage): boolean {
  const body = getDisplayText(message.htmlBody);
  return /<(?:img|image|source|link|video|audio|object|embed|iframe)\b[^>]*(?:src|srcset|href|poster|data)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(
    body,
  ) || /(?:background\s*=|url\()\s*["']?\s*(?:https?:)?\/\//i.test(body);
}

function allowExternalEmailContent(messageId: string) {
  externalContentAllowedIds.value = new Set([
    ...externalContentAllowedIds.value,
    messageId,
  ]);
}

function renderMarkdownEmailHtml(message: InboxMessage): string {
  return renderMarkdownMessageDocument(
    renderMarkdownBody(getMessageTextBody(message)),
  );
}

function getEmailFrameHeight(messageId: string): string {
  return `${emailFrameHeights.value[messageId] || 240}px`;
}

function resizeEmailFrame(event: Event, messageId: string) {
  const frame = event.target as HTMLIFrameElement | null;
  const doc = frame?.contentDocument;
  if (!frame || !doc) return;

  const measure = () => {
    const body = doc.body;
    const root = doc.documentElement;
    const height = Math.ceil(
      Math.max(
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
      ),
    );
    if (!height) return;
    emailFrameHeights.value = {
      ...emailFrameHeights.value,
      [messageId]: Math.max(120, height),
    };
  };

  measure();
  requestAnimationFrame(measure);
  window.setTimeout(measure, 250);

  emailFrameObservers.get(frame)?.disconnect();
  emailFrameObservers.delete(frame);
  const observer = new ResizeObserver(measure);
  if (doc.body) observer.observe(doc.body);
  if (doc.documentElement) observer.observe(doc.documentElement);
  emailFrameObservers.set(frame, observer);
  activeEmailFrameObservers.add(observer);

  for (const image of Array.from(doc.images)) {
    image.addEventListener("load", measure, { once: true });
    image.addEventListener("error", measure, { once: true });
  }
}

function formatRelativeDate(value: string): string {
  const date = parseApiDate(value);
  if (Number.isNaN(date.getTime())) return value;
  const timeZone = auth.user?.timezone || undefined;
  const diffDays = getCalendarDayDiff(date, new Date(), timeZone);
  if (diffDays === 0) {
    return formatDateTimePart(date, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  }
  if (diffDays < 7) {
    return formatDateTimePart(date, {
      month: "short",
      day: "numeric",
      timeZone,
    });
  }
  return formatDateTimePart(date, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

/** Short relative labels for Telegram bubbles */
function formatChatRelativeTime(value: string): string {
  const date = parseApiDate(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateTimePart(date, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: auth.user?.timezone || undefined,
  });
}

const totalPages = computed(() =>
  threadMode.value
    ? threadCursorIndex.value + (threadNextCursor.value ? 2 : 1)
    : Math.ceil(total.value / limit) || 1,
);
const currentPage = computed(() =>
  threadMode.value
    ? threadCursorIndex.value + 1
    : Math.floor(offset.value / limit) + 1,
);
const pageRangeStart = computed(() =>
  messages.value.length > 0
    ? threadMode.value
      ? threadCursorIndex.value * limit + 1
      : offset.value + 1
    : 0,
);
const pageRangeEnd = computed(() =>
  threadMode.value
    ? threadCursorIndex.value * limit + messages.value.length
    : Math.min(offset.value + messages.value.length, total.value),
);
const hasPreviousPage = computed(() =>
  threadMode.value ? threadCursorIndex.value > 0 : currentPage.value > 1,
);
const hasNextPage = computed(() =>
  threadMode.value
    ? Boolean(threadNextCursor.value)
    : currentPage.value < totalPages.value,
);

function prevPage() {
  if (!hasPreviousPage.value) return;
  rememberConversationScroll();
  if (threadMode.value) {
    threadCursorIndex.value -= 1;
  } else {
    offset.value = Math.max(0, offset.value - limit);
  }
  clearOpenConversation();
  clearSelectedMessages();
  void loadMessages();
}

function nextPage() {
  if (!hasNextPage.value) return;
  rememberConversationScroll();
  if (threadMode.value) {
    threadCursorHistory.value = [
      ...threadCursorHistory.value.slice(0, threadCursorIndex.value + 1),
      threadNextCursor.value,
    ];
    threadCursorIndex.value += 1;
  } else {
    offset.value += limit;
  }
  clearOpenConversation();
  clearSelectedMessages();
  void loadMessages();
}

async function resolveUnconfirmedDelivery(
  message: InboxMessage,
  resolution: "mark-sent" | "retry-anyway",
) {
  if (deliveryResolutionPending.value || inboxBusy.value) return;
  deliveryResolutionPending.value = message.id;
  try {
    const result = await api.post<{ delivery?: MailboxDeliveryStatus }>(
      `/mailbox/drafts/${encodeURIComponent(message.id)}/${resolution}`,
    );
    if (result.delivery) {
      deliveryStatuses.value = {
        ...deliveryStatuses.value,
        [message.id]: result.delivery,
      };
    } else {
      const next = { ...deliveryStatuses.value };
      delete next[message.id];
      deliveryStatuses.value = next;
    }
    toastSuccess(
      resolution === "mark-sent"
        ? "Marked as sent without resending."
        : "Retry requested. Check delivery status before trying again.",
    );
    const thread = selectedThreadSummary.value;
    if (thread) {
      await loadSelectedThread(thread);
    } else {
      await loadMessages();
    }
    await loadFolderCounts();
  } catch (err) {
    await refreshDraftDeliveryState(message.id);
    toastFromUnknown(err, "Failed to resolve delivery status");
  } finally {
    deliveryResolutionPending.value = null;
    deliveryRetryConfirmId.value = null;
  }
}

onMounted(() => {
  const routeTab = typeof route.query.tab === "string" ? route.query.tab : "";
  if (emailTabOrder.includes(routeTab as EmailTab)) {
    activeTab.value = routeTab as EmailTab;
  }
  void (async () => {
    await loadMessages();
    await openMessageFromRoute();
    void Promise.all([loadMailboxHealth(), loadFolderCounts(false)]);
  })();
});

watch(
  () => route.query.message,
  () => void openMessageFromRoute(),
);

watch(
  () =>
    mailboxCache.getFolderInvalidationVersion(
      mailboxCacheScope(auth.user?.id),
      "inbox",
    ),
  () => {
    if (!isNestedEmailTool.value && activeTab.value === "inbox") {
      void loadMessages();
    }
  },
);

onBeforeUnmount(() => {
  clearDeliveryStatusRefreshes();
  for (const observer of activeEmailFrameObservers) {
    observer.disconnect();
  }
  activeEmailFrameObservers.clear();
});
</script>

<template>
  <RouterView v-if="isNestedEmailTool" />
  <div
    v-else
    class="agent-page"
    :class="{ 'agent-page--with-mobile-controls': isEmailTab(activeTab) }"
  >
    <Teleport to="#app-side-nav-mobile-page-controls" defer>
      <form
        v-if="isEmailTab(activeTab)"
        class="mail-search mail-search--mobile-nav"
        role="search"
        @submit.prevent="applyMobileSearch"
      >
        <label
          class="mail-search__label"
          for="mail-search-input-mobile-nav"
        >
          {{ searchLabel }}
        </label>
        <input
          id="mail-search-input-mobile-nav"
          v-model="searchQuery"
          class="mail-search__input"
          type="search"
          :placeholder="searchLabel"
          @search="!searchQuery && applyMobileSearch()"
        />
        <Button color="ghost" shape="soft" size="compact" icon-only class="mail-mobile-icon-btn" type="submit"
          :disabled="loading"
          :aria-label="searchLabel"
          title="Search"
        >
          <UiIcon name="Search" :size="18" aria-hidden="true" />
        </Button>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          class="mail-mobile-icon-btn mail-mobile-compose-btn"
          type="button"
          aria-label="Compose"
          title="Compose"
          @click="openComposeModal()"
        >
          <UiIcon name="SquarePen" :size="18" aria-hidden="true" />
        </Button>
        <Button color="ghost" shape="soft" size="compact" icon-only class="mail-mobile-icon-btn" type="button"
          :disabled="loading"
          aria-label="Refresh conversations"
          title="Refresh"
          @click="refreshMessagesPage"
        >
          <UiIcon name="RefreshCw" :size="18" aria-hidden="true" />
        </Button>
      </form>
    </Teleport>

    <main class="agent-main">
      <div v-if="error === 'pro_required'" class="state-card">
        <p><strong>Assistant email is not enabled in this Core install.</strong></p>
        <p class="state-sub">
          Configure a mailbox provider for this installation, then restart the
          worker to enable email automation.
        </p>
      </div>

      <template v-else>
        <div
          v-if="activeTab === 'drafts' && followUpDraftCount > 0"
          class="state-card state-card--info"
        >
          {{ followUpDraftCount }}
          {{ followUpDraftCount === 1 ? "draft looks" : "drafts look" }}
          like rolodex follow-ups that are due now.
        </div>

        <div
          v-if="
            activeTab !== 'telegram' &&
            messagesLoaded &&
            error &&
            error !== 'pro_required'
          "
          class="state-card state-card--error"
          role="alert"
        >
          {{ error }}
        </div>
        <div
          class="inbox-panel"
          :class="{ 'inbox-panel--with-mobile-controls': isEmailTab(activeTab) }"
        >
          <template v-if="activeTab === 'telegram'">
            <PageLoading
              v-if="telegramLoading"
              compact
              class="panel-pad"
              label="Loading Telegram..."
            />
            <div
              v-else-if="telegramError"
              class="state-card state-card--error panel-pad"
              role="alert"
            >
              {{ telegramError }}
            </div>
            <div
              v-else-if="telegramConversation.length"
              class="telegram-thread"
            >
              <div class="telegram-thread__meta">
                <p class="telegram-thread__count" role="status">
                  Showing {{ turns.length }} of {{ telegramTotal }} turn{{
                    telegramTotal === 1 ? "" : "s"
                  }}
                  <template v-if="telegramConversation.length">
                    · {{ telegramConversation.length }} message{{
                      telegramConversation.length === 1 ? "" : "s"
                    }}
                  </template>
                </p>
                <div class="telegram-thread__actions">
                  <Button color="outline" shape="soft" size="compact" type="button"
                    v-if="telegramHasMore"
                    :disabled="telegramLoadingMore || telegramClearing"
                    @click="loadMoreTelegramTurns"
                  >
                    {{
                      telegramLoadingMore
                        ? "Loading older…"
                        : "Load older messages"
                    }}
                  </Button>
                  <Button color="danger" shape="soft" size="compact" type="button"
                    :disabled="telegramClearing || telegramLoadingMore"
                    @click="clearTelegramHistory"
                  >
                    {{ telegramClearing ? "Clearing…" : "Clear history" }}
                  </Button>
                </div>
              </div>
              <p
                v-if="telegramMoreError"
                class="telegram-thread__more-error"
                role="alert"
              >
                {{ telegramMoreError }}
              </p>
              <div ref="telegramChatRef" class="telegram-chat panel-pad">
                <article
                  v-for="bubble in telegramConversation"
                  :key="bubble.id"
                  class="tg-bubble"
                  :class="`tg-bubble--${bubble.role}`"
                >
                  <div class="tg-bubble__meta">
                    <span class="tg-bubble__who">{{
                      bubble.role === "user" ? "You" : "Assistant"
                    }}</span>
                    <span class="tg-bubble__time">{{
                      formatChatRelativeTime(bubble.at)
                    }}</span>
                  </div>
                  <p class="tg-bubble__text">{{ bubble.text }}</p>
                  <p v-if="bubble.errorNote" class="tg-bubble__error">
                    {{ bubble.errorNote }}
                  </p>
                </article>
              </div>
            </div>
            <div v-else class="empty-state panel-pad">
              <p>No Telegram messages yet.</p>
              <p v-if="telegramNeedsSetupHint" class="empty-hint">
                Telegram is not connected.
                <router-link to="/account" class="empty-hint-link">
                  Configure in account settings
                </router-link>
              </p>
            </div>
          </template>

          <template v-else>
            <div
              class="mail-workspace"
              :class="{ 'mail-workspace--has-thread': selectedMessage }"
            >
              <aside class="mail-rail">
                <WorkspaceTabs
                  class="mail-folder-tabs"
                  :tabs="mailFolderTabs"
                  :model-value="activeTab"
                  aria-label="Mailbox folders"
                  semantics="navigation"
                  @update:model-value="switchMailFolderTab"
                  @change="switchMailFolderTab"
                />
              </aside>

              <section
                ref="conversationScrollRef"
                class="conversation-list"
                :class="{
                  'conversation-list--mobile-hidden': mobileThreadOpen,
                }"
                aria-label="Conversations"
                aria-keyshortcuts="J K ArrowDown ArrowUp X E U R Delete #"
              >
                <PageLoading
                  v-if="loading"
                  compact
                  class="conversation-loading"
                  label="Loading messages..."
                />

                <template v-else-if="hasMessagesOnPage">
                  <div class="bulk-mail-toolbar">
                    <label class="bulk-select">
                      <input
                        type="checkbox"
                        :checked="allMessagesOnPageSelected"
                        :indeterminate="
                          someMessagesOnPageSelected &&
                          !allMessagesOnPageSelected
                        "
                        :aria-checked="
                          allMessagesOnPageSelected
                            ? 'true'
                            : someMessagesOnPageSelected
                              ? 'mixed'
                              : 'false'
                        "
                        :disabled="inboxBusy"
                        aria-label="Select all conversations on this page"
                        @change="
                          setAllMessagesOnPageSelected(
                            ($event.target as HTMLInputElement).checked,
                          )
                        "
                      />
                      <span>{{ selectedMessageCount || "Select" }}</span>
                    </label>
                    <div
                      v-if="selectedMessageCount > 0"
                      class="bulk-mail-actions"
                    >
                      <Button color="outline" shape="soft" size="compact" type="button"
                        v-if="activeTab === 'archive' || activeTab === 'trash'"
                        :disabled="inboxBusy"
                        title="Restore selected"
                        @click="moveSelectedMessages('inbox')"
                      >
                        <UiIcon name="Inbox" :size="14" aria-hidden="true" />
                        Restore
                      </Button>
                      <Button color="outline" shape="soft" size="compact" type="button"
                        v-else
                        :disabled="inboxBusy"
                        title="Archive selected"
                        @click="moveSelectedMessages('archive')"
                      >
                        <UiIcon name="Archive" :size="14" aria-hidden="true" />
                        Archive
                      </Button>
                      <Button color="danger" shape="soft" size="compact" type="button"
                        :disabled="inboxBusy"
                        :title="
                          activeTab === 'trash'
                            ? 'Delete selected forever'
                            : 'Move selected to trash'
                        "
                        @click="
                          activeTab === 'trash'
                            ? deleteSelectedMessagesPermanently()
                            : moveSelectedMessages('trash')
                        "
                      >
                        <UiIcon name="Trash2" :size="14" aria-hidden="true" />
                        {{ activeTab === "trash" ? "Delete" : "Trash" }}
                      </Button>
                      <Button color="outline" shape="soft" size="compact" type="button"
                        :disabled="inboxBusy"
                        @click="clearSelectedMessages"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div class="conversation-scroll">
                  <article
                    v-for="message in messages"
                    :key="message.id"
                    :data-message-id="message.id"
                    class="conversation-item"
                    :class="{
                      'conversation-item--active':
                        selectedMessage?.id === message.id,
                      'conversation-item--unread': message.unread,
                      'conversation-item--selected':
                        selectedMessageIds.has(message.id),
                    }"
                  >
                    <label class="conversation-select">
                      <input
                        type="checkbox"
                        :checked="selectedMessageIds.has(message.id)"
                        :disabled="inboxBusy"
                        :aria-label="`Select ${getMessageSubject(message)}`"
                        @change="
                          toggleMessageSelected(
                            message.id,
                            ($event.target as HTMLInputElement).checked,
                          )
                        "
                      />
                    </label>
                    <button
                      type="button"
                      class="conversation-open"
                      :aria-current="selectedMessage?.id === message.id ? 'true' : undefined"
                      @click="selectMessage(message.id)"
                    >
                      <span v-if="message.unread" class="sr-only">Unread.</span>
                      <div class="conversation-item__content">
                        <div class="conversation-item__meta">
                          <strong>{{ getConversationParticipants(message) }}</strong>
                        </div>
                        <p class="conversation-item__summary">
                          <span class="conversation-item__subject">
                            {{ getMessageSubject(message) }}
                          </span>
                          <span class="conversation-item__separator">-</span>
                          <span
                            v-if="
                              !threadMode &&
                              message.direction === 'inbound' &&
                              message.toAddress
                            "
                            class="conversation-item__recipient"
                          >
                            To {{ message.toAddress }}
                          </span>
                          <span class="conversation-item__preview">
                            {{ getMessagePreview(message) }}
                          </span>
                        </p>
                      </div>
                      <span class="conversation-item__trailing">
                        <span
                          v-if="isDraftMessage(message)"
                          class="thread-count"
                        >
                          {{ draftStatusLabel(message) }}
                        </span>
                        <span
                          v-if="getConversationMessageCount(message) > 1"
                          class="conversation-cue"
                          :aria-label="`${getConversationMessageCount(message)} messages`"
                          title="Messages in conversation"
                        >
                          {{ getConversationMessageCount(message) }}
                        </span>
                        <span
                          v-if="getConversationUnreadCount(message) > 1"
                          class="conversation-cue conversation-cue--unread"
                          :aria-label="`${getConversationUnreadCount(message)} unread messages`"
                        >
                          {{ getConversationUnreadCount(message) }} unread
                        </span>
                        <UiIcon
                          v-if="getConversationAttachmentCount(message) > 0"
                          class="conversation-attachment-cue"
                          name="Paperclip"
                          :size="14"
                          :aria-label="`${getConversationAttachmentCount(message)} attachments`"
                        />
                        <time class="conversation-item__date">
                          {{ formatRelativeDate(message.createdAt) }}
                        </time>
                      </span>
                    </button>
                    <div
                      v-if="!isDraftMessage(message)"
                      class="conversation-quick-actions"
                      aria-label="Conversation actions"
                    >
                      <Button
                        color="ghost"
                        shape="soft"
                        size="small"
                        icon-only
                        type="button"
                        :aria-label="
                          activeTab === 'archive' || activeTab === 'trash'
                            ? 'Restore conversation to Inbox'
                            : 'Archive conversation'
                        "
                        :title="
                          activeTab === 'archive' || activeTab === 'trash'
                            ? 'Restore to Inbox'
                            : 'Archive'
                        "
                        :aria-keyshortcuts="
                          activeTab === 'archive' || activeTab === 'trash'
                            ? undefined
                            : 'E'
                        "
                        :disabled="inboxBusy"
                        @click.stop="
                          moveConversation(
                            message,
                            activeTab === 'archive' || activeTab === 'trash'
                              ? 'inbox'
                              : 'archive',
                          )
                        "
                      >
                        <UiIcon
                          :name="
                            activeTab === 'archive' || activeTab === 'trash'
                              ? 'Inbox'
                              : 'Archive'
                          "
                          :size="15"
                          aria-hidden="true"
                        />
                      </Button>
                      <Button
                        v-if="activeTab !== 'trash'"
                        color="ghost"
                        shape="soft"
                        size="small"
                        icon-only
                        type="button"
                        :aria-label="
                          getConversationUnreadCount(message) > 0
                            ? 'Mark conversation as read'
                            : 'Mark conversation as unread'
                        "
                        :title="
                          getConversationUnreadCount(message) > 0
                            ? 'Mark read'
                            : 'Mark unread'
                        "
                        aria-keyshortcuts="U"
                        :disabled="inboxBusy"
                        @click.stop="
                          markConversationRead(
                            message,
                            getConversationUnreadCount(message) > 0,
                          )
                        "
                      >
                        <UiIcon name="Mail" :size="15" aria-hidden="true" />
                      </Button>
                      <Button
                        color="ghost"
                        shape="soft"
                        size="small"
                        icon-only
                        type="button"
                        aria-label="Move conversation to Trash"
                        title="Move to Trash"
                        aria-keyshortcuts="# Delete"
                        :disabled="inboxBusy"
                        @click.stop="moveConversation(message, 'trash')"
                      >
                        <UiIcon name="Trash2" :size="15" aria-hidden="true" />
                      </Button>
                    </div>
                  </article>
                  </div>
                </template>
                <div
                  v-else-if="messagesLoaded"
                  class="empty-state empty-state--inline"
                >
                  <div class="empty-state__stack">
                    <template v-if="searchQuery.trim()">
                      <p>No results in {{ activeFolderLabel }}.</p>
                      <p class="empty-state__sub">
                        Search is limited to the current folder.
                      </p>
                      <Button
                        color="outline"
                        shape="soft"
                        size="compact"
                        type="button"
                        class="empty-state__action"
                        @click="clearSearch"
                      >
                        Clear search
                      </Button>
                    </template>
                    <template v-else-if="activeTab === 'inbox'">
                      <p>No inbound email yet.</p>
                      <p v-if="mailNeedsSetupHint" class="empty-hint">
                        Mail needs a custom-domain address routed to this Worker.
                        <router-link to="/account" class="empty-hint-link">
                          Configure in account settings
                        </router-link>
                      </p>
                      <p v-else-if="visibleMailboxAddress" class="empty-state__sub">
                        Messages sent to {{ visibleMailboxAddress }} will appear here.
                      </p>
                      <p v-else class="empty-state__sub">
                        Messages sent to your custom-domain address will appear here.
                      </p>
                    </template>
                    <template v-else-if="activeTab === 'drafts'">
                      <p>No drafts awaiting action.</p>
                      <p class="empty-state__sub">
                        When the assistant composes an email it will appear
                        here.
                      </p>
                    </template>
                    <template v-else-if="activeTab === 'sent'">
                      <p>No sent messages yet.</p>
                      <p class="empty-state__sub">
                        Messages you send will appear here.
                      </p>
                    </template>
                    <template v-else-if="activeTab === 'archive'">
                      <p>No archived messages yet.</p>
                      <p class="empty-state__sub">
                        Messages you archive from the thread view will appear
                        here.
                      </p>
                    </template>
                    <template v-else-if="activeTab === 'trash'">
                      <p>No trashed messages yet.</p>
                      <p class="empty-state__sub">
                        Deleted messages will appear here until they are
                        cleared.
                      </p>
                    </template>
                  </div>
                </div>
                <div v-else class="state-card state-card--error" role="alert">
                  <p>{{ error || "Unable to load messages." }}</p>
                  <Button
                    color="outline"
                    shape="soft"
                    size="compact"
                    type="button"
                    @click="loadMessages"
                  >
                    Try again
                  </Button>
                </div>

                <div
                  v-if="!loading && totalPages > 1"
                  class="pagination pagination--split"
                >
                  <div class="pagination-nav">
                    <Button color="ghost" shape="soft" size="small" icon-only type="button"
                      :disabled="!hasPreviousPage"
                      aria-label="Previous page"
                      @click="prevPage"
                    >
                      ◂
                    </Button>
                    <span class="page-label">
                      <template v-if="threadMode">
                        Page {{ currentPage }} · {{ pageRangeStart }}–{{ pageRangeEnd }}
                      </template>
                      <template v-else>
                        {{ pageRangeStart }}–{{ pageRangeEnd }} of {{ total }}
                      </template>
                    </span>
                    <Button color="ghost" shape="soft" size="small" icon-only type="button"
                      :disabled="!hasNextPage"
                      aria-label="Next page"
                      @click="nextPage"
                    >
                      ▸
                    </Button>
                  </div>
                </div>
              </section>

              <section
                v-if="selectedMessage"
                class="thread-pane"
                :class="{ 'thread-pane--mobile-open': mobileThreadOpen }"
              >
                <header class="thread-toolbar">
                  <Button
                    class="thread-back-btn"
                    color="ghost"
                    shape="soft"
                    size="compact"
                    icon-only
                    type="button"
                    title="Back"
                    aria-label="Back to message list"
                    @click="mobileThreadOpen = false"
                  >
                    <UiIcon name="ArrowLeft" :size="17" aria-hidden="true" />
                  </Button>
                  <div class="thread-actions">
                    <Button color="ghost" shape="soft" size="compact" icon-only type="button"
                      title="Reply"
                      aria-label="Reply"
                      aria-keyshortcuts="R"
                      :disabled="
                        inboxBusy ||
                        selectedThreadDetailUnavailable ||
                        isDraftMessage(selectedMessage)
                      "
                      @click="openComposeModal(selectedMessage)"
                    >
                      <UiIcon name="Reply" :size="16" aria-hidden="true" />
                    </Button>
                    <Button color="ghost" shape="soft" size="compact" icon-only type="button"
                      title="Forward"
                      aria-label="Forward"
                      :disabled="
                        inboxBusy ||
                        selectedThreadDetailUnavailable ||
                        isDraftMessage(selectedMessage)
                      "
                      @click="openComposeModal(selectedMessage, 'forward')"
                    >
                      <UiIcon name="Forward" :size="16" aria-hidden="true" />
                    </Button>
                    <Button color="ghost" shape="soft" size="compact" icon-only type="button"
                      v-if="
                        selectedMessage.folder === 'archive' ||
                        selectedMessage.folder === 'trash'
                      "
                      title="Restore to inbox"
                      aria-label="Restore to inbox"
                      :disabled="inboxBusy || isDraftMessage(selectedMessage)"
                      @click="moveConversation(selectedMessage, 'inbox')"
                    >
                      <UiIcon name="Inbox" :size="16" aria-hidden="true" />
                    </Button>
                    <Button color="ghost" shape="soft" size="compact" icon-only type="button"
                      v-else
                      title="Archive"
                      aria-label="Archive"
                      aria-keyshortcuts="E"
                      :disabled="inboxBusy || isDraftMessage(selectedMessage)"
                      @click="moveConversation(selectedMessage, 'archive')"
                    >
                      <UiIcon name="Archive" :size="16" aria-hidden="true" />
                    </Button>
                    <Button color="ghost" shape="soft" size="compact" icon-only type="button"
                      :title="
                        selectedThreadIsUnread ? 'Mark read' : 'Mark unread'
                      "
                      :aria-label="
                        selectedThreadIsUnread ? 'Mark read' : 'Mark unread'
                      "
                      aria-keyshortcuts="U"
                      :disabled="inboxBusy || isDraftMessage(selectedMessage)"
                      @click="
                        markConversationRead(selectedMessage, selectedThreadIsUnread)
                      "
                    >
                      <UiIcon name="Mail" :size="16" aria-hidden="true" />
                    </Button>
                    <Button color="ghost" shape="soft" size="compact" icon-only type="button"
                      title="Move to trash"
                      aria-label="Move to trash"
                      aria-keyshortcuts="# Delete"
                      :disabled="
                        inboxBusy ||
                        isDraftMessage(selectedMessage) ||
                        selectedMessage.folder === 'trash'
                      "
                      @click="moveConversation(selectedMessage, 'trash')"
                    >
                      <UiIcon name="Trash2" :size="16" aria-hidden="true" />
                    </Button>
                  </div>
                </header>

                <div class="thread-heading">
                  <h2>
                    {{ selectedThreadSummary?.subject || getMessageSubject(selectedMessage) }}
                  </h2>
                  <p>
                    {{ selectedThreadSummary?.messageCount || selectedThreadMessages.length }}
                    {{
                      (selectedThreadSummary?.messageCount || selectedThreadMessages.length) === 1
                        ? "message"
                        : "messages"
                    }}
                    in this thread
                  </p>
                </div>

                <div class="thread-scroll">
                  <PageLoading
                    v-if="threadDetailLoading"
                    compact
                    class="thread-detail-loading"
                    label="Loading conversation..."
                  />
                  <div
                    v-else-if="threadDetailError"
                    class="state-card state-card--error thread-detail-error"
                    role="alert"
                  >
                    <p>{{ threadDetailError }}</p>
                    <Button
                      v-if="selectedThreadSummary"
                      color="outline"
                      shape="soft"
                      size="compact"
                      type="button"
                      @click="loadSelectedThread(selectedThreadSummary)"
                    >
                      Try again
                    </Button>
                  </div>
                  <template v-else>
                  <article
                    v-for="message in selectedThreadMessages"
                    :key="message.id"
                    class="message-card"
                    :class="{
                      'message-card--draft':
                        isDraftMessage(message),
                    }"
                  >
                    <div class="message-card__avatar">
                      {{
                        getCounterpartyAddress(message)
                          .slice(0, 1)
                          .toUpperCase()
                      }}
                    </div>
                    <div class="message-card__body">
                      <div class="message-card__header">
                        <div>
                          <strong>
                            {{
                              isDraftMessage(message)
                                ? message.status === "approved"
                                  ? "Sending draft"
                                  : message.status === "failed"
                                    ? "Failed draft"
                                    : "Draft reply"
                                : getCounterpartyAddress(message)
                            }}
                          </strong>
                          <span
                            v-if="isDraftMessage(message)"
                            class="status-pill"
                          >
                            {{ draftStatusLabel(message) }}
                          </span>
                          <p>
                            {{
                              message.direction === "outbound" ? "To" : "From"
                            }}:
                            {{
                              message.direction === "outbound"
                                ? message.toAddress || "—"
                                : formatSenderValue(message)
                            }}
                          </p>
                          <p
                            v-if="message.direction === 'inbound'"
                            class="message-card__recipient"
                          >
                            To: {{ formatRecipientValue(message) }}
                          </p>
                        </div>
                        <div class="message-card__header-actions">
                          <span>{{ formatRelativeDate(message.createdAt) }}</span>
                          <Button color="outline" shape="soft" size="compact" type="button"
                            v-if="message.unsubscribeAction"
                            :disabled="inboxBusy"
                            @click="unsubscribeFromMessage(message)"
                          >
                            <UiIcon name="Mail" :size="13" aria-hidden="true" />
                            {{
                              unsubscribePending === message.id
                                ? "Unsubscribing..."
                                : "Unsubscribe"
                            }}
                          </Button>
                        </div>
                      </div>

                      <section
                        v-if="isDeliveryUnknown(message)"
                        class="delivery-unconfirmed"
                        aria-label="Delivery needs confirmation"
                        aria-live="polite"
                      >
                        <div>
                          <strong>Delivery could not be confirmed</strong>
                          <p>
                            This email may already have arrived. Mark it as sent
                            if you verified delivery, or retry only if you accept
                            the risk of a duplicate.
                          </p>
                        </div>
                        <div class="delivery-unconfirmed__actions">
                          <Button
                            color="outline"
                            shape="soft"
                            size="compact"
                            type="button"
                            :disabled="
                              Boolean(deliveryResolutionPending) ||
                              !deliveryStatuses[message.id]?.canMarkSent
                            "
                            @click="resolveUnconfirmedDelivery(message, 'mark-sent')"
                          >
                            {{
                              deliveryResolutionPending === message.id
                                ? "Working…"
                                : "Mark as sent"
                            }}
                          </Button>
                          <Button
                            v-if="deliveryRetryConfirmId !== message.id"
                            color="danger"
                            shape="soft"
                            size="compact"
                            type="button"
                            :disabled="
                              Boolean(deliveryResolutionPending) ||
                              !deliveryStatuses[message.id]?.canRetryAnyway
                            "
                            @click="deliveryRetryConfirmId = message.id"
                          >
                            Retry anyway
                          </Button>
                          <template v-else>
                            <Button
                              color="outline"
                              shape="soft"
                              size="compact"
                              type="button"
                              :disabled="Boolean(deliveryResolutionPending)"
                              @click="deliveryRetryConfirmId = null"
                            >
                              Cancel retry
                            </Button>
                            <Button
                              color="danger"
                              shape="soft"
                              size="compact"
                              type="button"
                              :disabled="Boolean(deliveryResolutionPending)"
                              @click="
                                resolveUnconfirmedDelivery(
                                  message,
                                  'retry-anyway',
                                )
                              "
                            >
                              {{
                                deliveryResolutionPending === message.id
                                  ? "Retrying…"
                                  : "Confirm retry"
                              }}
                            </Button>
                          </template>
                        </div>
                      </section>

                      <div
                        v-if="
                          !isDraftMessage(message) &&
                          message.htmlBody &&
                          hasExternalEmailContent(message) &&
                          !externalContentAllowedIds.has(message.id)
                        "
                        class="external-content-notice"
                        role="status"
                      >
                        <span>External content is blocked for your privacy.</span>
                        <Button
                          color="outline"
                          shape="soft"
                          size="compact"
                          type="button"
                          @click="allowExternalEmailContent(message.id)"
                        >
                          Load external content
                        </Button>
                      </div>
                      <iframe
                        v-if="!isDraftMessage(message)"
                        class="message-html-frame"
                        :title="`Email body: ${getMessageSubject(message)}`"
                        scrolling="no"
                        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                        referrerpolicy="no-referrer"
                        :style="{ height: getEmailFrameHeight(message.id) }"
                        :srcdoc="
                          message.htmlBody
                            ? renderEmailHtml(message)
                            : renderMarkdownEmailHtml(message)
                        "
                        @load="resizeEmailFrame($event, message.id)"
                      />
                      <pre v-else class="message-body">{{
                        getMessageTextBody(message)
                      }}</pre>

                      <div
                        v-if="getMessageAttachments(message).length > 0"
                        class="message-attachments"
                      >
                        <a
                          v-for="(attachment, attachmentIndex) in getMessageAttachments(message)"
                          :key="`${message.id}-${attachmentIndex}`"
                          class="attachment-chip"
                          :href="
                            getAttachmentDownloadUrl(message, attachmentIndex)
                          "
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <UiIcon
                            name="Paperclip"
                            :size="14"
                            aria-hidden="true"
                          />
                          <span>{{
                            formatAttachmentName(
                              attachment,
                              attachmentIndex,
                            )
                          }}</span>
                          <small v-if="formatAttachmentSize(attachment.size)">
                            {{ formatAttachmentSize(attachment.size) }}
                          </small>
                        </a>
                      </div>

                      <div
                        v-if="
                          isEditableDraft(message) &&
                          message.folder !== 'trash'
                        "
                        class="message-card__actions"
                      >
                        <Button color="primary" shape="soft" size="compact" type="button"
                          :disabled="inboxBusy"
                          @click="approveMessage(message)"
                        >
                          <UiIcon name="Send" :size="14" aria-hidden="true" />
                          {{
                            actionPending === message.id ? "Sending…" : "Send"
                          }}
                        </Button>
                        <Button color="outline" shape="soft" size="compact" type="button"
                          :disabled="inboxBusy"
                          @click="openComposeModal(message)"
                        >
                          Edit
                        </Button>
                        <Button color="outline" shape="soft" size="compact" type="button"
                          :disabled="inboxBusy"
                          @click="rejectMessage(message)"
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  </article>
                  </template>
                </div>
              </section>
              <section v-else class="thread-pane thread-pane--empty">
                <div class="empty-state empty-state--inline">
                  <div class="empty-state__stack">
                    <p>Select a conversation.</p>
                  </div>
                </div>
              </section>
            </div>
          </template>
        </div>
      </template>
    </main>

    <AppDialog
      :open="composeOpen"
      class="compose-modal"
      labelled-by="compose-title"
      @close="requestCloseComposeModal"
    >
      <form
        class="compose-modal__card"
        @submit.prevent="saveDraft(false)"
        @keydown="handleComposeKeydown"
      >
        <header class="compose-modal__head">
          <h2 id="compose-title">{{ getComposeTitle() }}</h2>
          <Button color="ghost" shape="soft" size="compact" icon-only type="button"
            aria-label="Close compose"
            :disabled="composeSending"
            @click="requestCloseComposeModal"
          >
            <UiIcon name="X" :size="16" aria-hidden="true" />
          </Button>
        </header>
        <label
          v-if="outboundSenderOptions.length > 1"
          class="compose-field"
        >
          <span>From</span>
          <select v-model="composeForm.fromAddress">
            <option
              v-for="option in outboundSenderOptions"
              :key="option.address"
              :value="option.address"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <div class="compose-field compose-field--recipient">
          <label for="compose-to">To</label>
          <input
            id="compose-to"
            v-model="composeForm.to"
            type="email"
            autocomplete="email"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="compose-recipient-list"
            :aria-expanded="showComposeRecipientSuggestions"
            :aria-activedescendant="
              showComposeRecipientSuggestions
                ? `compose-recipient-${composeToActiveIndex}`
                : undefined
            "
            @focus="composeToFocused = true"
            @input="handleComposeToInput"
            @blur="handleComposeToBlur"
            @keydown="handleComposeToKeydown"
          />
          <div
            v-if="showComposeRecipientSuggestions"
            id="compose-recipient-list"
            class="compose-recipient-list"
            role="listbox"
          >
            <button
              v-for="(contact, index) in composeRecipientSuggestions"
              :key="contact.id"
              :id="`compose-recipient-${index}`"
              type="button"
              class="compose-recipient-option"
              :class="{ 'is-active': index === composeToActiveIndex }"
              role="option"
              :aria-selected="index === composeToActiveIndex"
              @mousedown.prevent="selectComposeRecipient(contact)"
            >
              <span class="compose-recipient-option__name">
                {{ contact.name }}
              </span>
              <span class="compose-recipient-option__email">
                {{ contact.email }}
              </span>
            </button>
          </div>
        </div>
        <label class="compose-field">
          <span>Subject</span>
          <input
            id="compose-subject"
            v-model="composeForm.subject"
            type="text"
          />
        </label>
        <label class="compose-field compose-field--body">
          <span>Message</span>
          <textarea v-model="composeForm.textBody" rows="10" />
        </label>
        <div class="compose-attachments">
          <div class="compose-attachments__head">
            <p>
              {{
                composeVisibleAttachments.length > 0
                  ? `${composeVisibleAttachments.length} ${
                      composeVisibleAttachments.length === 1
                        ? "attachment"
                        : "attachments"
                    }`
                  : "Attachments"
              }}
            </p>
            <label
              class="compose-attachment-upload"
              :class="{ 'is-disabled': composeUploadingAttachments }"
            >
              <UiIcon name="Paperclip" :size="14" aria-hidden="true" />
              <span>{{
                composeUploadingAttachments ? "Uploading..." : "Attach"
              }}</span>
              <input
                type="file"
                multiple
                :disabled="composeUploadingAttachments"
                @change="uploadComposeAttachments"
              />
            </label>
          </div>
          <div class="compose-attachment-list">
            <span
              v-for="(attachment, index) in composePreservedAttachments"
              :key="`${attachment.storageKey || index}`"
              class="compose-attachment-chip"
            >
              <UiIcon name="Paperclip" :size="14" aria-hidden="true" />
              <span>{{ formatAttachmentName(attachment, index) }}</span>
              <small v-if="formatAttachmentSize(attachment.size)">
                {{ formatAttachmentSize(attachment.size) }}
              </small>
            </span>
            <span
              v-for="(attachment, index) in composeUploadedAttachments"
              :key="`${attachment.storageKey || index}`"
              class="compose-attachment-chip"
            >
              <UiIcon name="Paperclip" :size="14" aria-hidden="true" />
              <span>
                {{
                  formatAttachmentName(
                    attachment,
                    index + composePreservedAttachments.length,
                  )
                }}
              </span>
              <small v-if="formatAttachmentSize(attachment.size)">
                {{ formatAttachmentSize(attachment.size) }}
              </small>
              <Button color="ghost" shape="pill" size="small" icon-only class="compose-attachment-remove" type="button"
                :aria-label="`Remove ${formatAttachmentName(attachment, index)}`"
                @click="removeUploadedAttachment(index)"
              >
                <UiIcon name="X" :size="13" aria-hidden="true" />
              </Button>
            </span>
          </div>
        </div>
        <p v-if="composeError" class="compose-error" role="alert">
          {{ composeError }}
          <router-link
            v-if="composeNeedsStorage"
            to="/account?section=storage"
          >
            Activate storage
          </router-link>
        </p>
        <footer class="compose-modal__actions">
          <Button color="outline" shape="soft" size="compact" type="button"
            :disabled="composeSending"
            @click="requestCloseComposeModal"
          >
            Cancel
          </Button>
          <Button color="outline" shape="soft" size="compact" type="button"
            :disabled="
              composeSending ||
              !composeCanSaveDraft
            "
            @click="saveDraft(false)"
          >
            {{
              composeSending
                ? "Saving…"
                : getComposePrimaryDraftLabel()
            }}
          </Button>
          <Button color="primary" shape="soft" size="compact" type="button"
            :disabled="
              composeSending ||
              !composeCanSend
            "
            aria-keyshortcuts="Meta+Enter Control+Enter"
            @click="saveDraft(true)"
          >
            <UiIcon name="Send" :size="14" aria-hidden="true" />
            {{ composeSending ? "Sending…" : "Send" }}
          </Button>
        </footer>
      </form>
    </AppDialog>

    <AppDialog
      :open="composeDiscardConfirmOpen"
      class="confirm-modal"
      labelled-by="discard-compose-title"
      described-by="discard-compose-description"
      :close-on-backdrop="false"
      @close="composeDiscardConfirmOpen = false"
    >
      <section class="confirm-modal__card">
        <h2 id="discard-compose-title" class="confirm-modal__title">
          Discard unsaved changes?
        </h2>
        <p id="discard-compose-description" class="confirm-modal__body">
          Your changes have not been saved as a draft.
        </p>
        <footer class="confirm-modal__actions">
          <Button
            color="outline"
            shape="soft"
            size="compact"
            type="button"
            @click="composeDiscardConfirmOpen = false"
          >
            Keep editing
          </Button>
          <Button
            color="danger"
            shape="soft"
            size="compact"
            type="button"
            @click="forceCloseComposeModal"
          >
            Discard changes
          </Button>
        </footer>
      </section>
    </AppDialog>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.agent-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.agent-page--with-mobile-controls {
  height: calc(100vh - var(--app-shell-mobile-nav-height));
  height: calc(100dvh - var(--app-shell-mobile-nav-height));
}

.agent-main {
  margin: 0 auto;
  padding: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  width: 100%;
  max-width: none;
  overflow: hidden;
}

.panel-pad {
  padding: 18px;
}

.confirm-modal__card {
  width: min(100%, 420px);
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  box-shadow: 0 20px 60px rgba(17, 17, 17, 0.18);
}

.confirm-modal__title {
  margin: 0;
  font-size: 22px;
  line-height: 1.15;
}

.confirm-modal__body {
  margin: 12px 0 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-text-muted);
}

.confirm-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.telegram-thread {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.telegram-thread__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}

.telegram-thread__count {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.telegram-thread__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.telegram-load-older {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    color 0.12s,
    border-color 0.12s;
}

.telegram-load-older:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-text);
}

.telegram-load-older:disabled,
.telegram-clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.telegram-clear-btn {
  padding: 6px 12px;
  border: 1px solid #b33b2e;
  border-radius: 6px;
  background: var(--color-bg);
  font-size: 12px;
  font-weight: 700;
  color: #b33b2e;
  cursor: pointer;
  transition: opacity 0.12s;
}

.telegram-clear-btn:hover:not(:disabled) {
  opacity: 0.8;
}

.telegram-thread__more-error {
  margin: 0;
  padding: 8px 18px;
  font-size: 13px;
  color: #b33b2e;
  border-bottom: 1px solid var(--color-border);
}

.telegram-chat {
  display: grid;
  gap: 12px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.tg-bubble {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
}

.tg-bubble--agent {
  border-left: 3px solid var(--color-text);
}

.tg-bubble--user {
  border-left: 3px solid var(--color-border);
}

.tg-bubble__meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}

.tg-bubble__who {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.tg-bubble__time {
  font-size: 12px;
  color: var(--color-text-muted);
}

.tg-bubble__text {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.tg-bubble__error {
  margin: 10px 0 0;
  font-size: 13px;
  color: #b33b2e;
}

.empty-hint {
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.empty-hint-link {
  margin-left: 4px;
  font-weight: 600;
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.empty-hint-link:hover {
  opacity: 0.75;
}

.empty-state__sub {
  margin-top: 8px;
  font-size: 14px;
}

/* Toolbar */
.inbox-toolbar {
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.mail-heading {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.mail-heading h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.1;
}

.mail-heading p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.bulk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
}

.bulk-summary {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.bulk-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.bulk-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.bulk-link:hover:not(:disabled) {
  color: var(--color-text);
}

.bulk-link:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tab-bar {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.mail-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px 36px;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  min-width: 0;
}

.mail-search__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

.mail-search__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}

.mail-search__input:focus {
  outline: 2px solid var(--color-text);
  outline-offset: 1px;
}

.mail-search--mobile-nav {
  grid-template-columns: minmax(0, 1fr) 36px auto 36px;
  width: 100%;
}

.mail-search--mobile-nav .mail-search__input {
  height: 36px;
}

.mail-search--mobile-nav .mail-mobile-icon-btn {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
}

.mail-search--mobile-nav
  .mail-search__button:not(.mail-search__button--refresh) {
  border: 0;
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.mail-search--mobile-nav
  .mail-search__button:not(.mail-search__button--refresh):hover:not(:disabled) {
  border: 0;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.mail-search--mobile-nav .mail-mobile-compose-btn {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.mail-search--mobile-nav .mail-mobile-compose-btn:hover:not(:disabled),
.mail-search--mobile-nav .mail-mobile-compose-btn:focus-visible {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  border-color: transparent;
  color: var(--ui-text, var(--color-text));
}

.mail-mobile-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: inherit;
  font-weight: inherit;
  cursor: pointer;
}

.mail-mobile-icon-btn:hover:not(:disabled) {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.mail-mobile-icon-btn:focus-visible {
  outline: 2px solid var(--color-text);
  outline-offset: 2px;
}

.mail-search--mobile-nav .mail-search__button--refresh {
  border: 0;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.mail-search--mobile-nav .mail-search__button--refresh:hover:not(:disabled) {
  border-color: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.mail-search__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  width: 36px;
  padding: 0;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  background: var(--color-accent);
  color: var(--color-accent-contrast);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.mail-search__button--refresh {
  border-color: var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
}

.mail-search__button--refresh:hover:not(:disabled) {
  background: transparent;
  color: var(--color-text);
  border-color: var(--color-text);
}

.mail-search__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.inbox-refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s,
    border-color 0.12s;
}

.inbox-refresh-btn:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-text);
}

.inbox-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s,
    border-color 0.12s;
}

.tab-btn:hover {
  color: var(--color-text);
  border-color: var(--color-text);
}

.tab-btn--active {
  background: var(--color-text);
  color: var(--color-bg);
  border-color: var(--color-text);
}

.tab-btn--active:hover {
  color: var(--color-bg);
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: var(--color-bg);
  color: var(--color-text);
}

.tab-btn--active .tab-count {
  background: var(--color-text-muted);
  color: var(--color-bg);
}

/* Panel */
.inbox-panel {
  border-bottom: 1px solid var(--color-border);
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
  overflow: hidden;
}

.inbox-panel--with-mobile-controls {
  height: auto;
}

.mail-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.mail-rail,
.conversation-list,
.thread-pane {
  min-width: 0;
  min-height: 0;
}

.mail-rail {
  order: 1;
  position: static;
  z-index: 3;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  width: 100%;
  height: auto;
  max-height: none;
  box-sizing: border-box;
  padding: 4px 8px 0;
  background: var(--color-bg);
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scroll-padding-inline: 8px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

@media (min-width: 768px) {
  .mail-rail {
    justify-content: center;
  }
}

.mail-rail::-webkit-scrollbar {
  display: none;
}

.conversation-list.conversation-list--mobile-hidden {
  display: none;
}

.conversation-list {
  order: 2;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.thread-pane {
  order: 3;
  display: none;
  flex: 1 1 auto;
  overflow: hidden;
}

.text-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.text-btn--active,
.text-btn:hover {
  border-color: var(--color-text);
}

.mail-identity {
  margin-bottom: 18px;
  padding: 0 8px;
}

.mail-identity__label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.mail-identity strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.compose-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  margin-bottom: 16px;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  background: var(--color-accent);
  color: var(--color-accent-contrast);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.compose-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.conversation-list {
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
}

.conversation-list__head {
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--workspace-topbar-height);
  padding: var(--workspace-topbar-padding-block) 16px;
}

.conversation-list__head h2,
.thread-heading h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.conversation-list__head p,
.thread-heading p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  border-color: var(--color-text);
  color: var(--color-text);
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.conversation-scroll,
.thread-scroll {
  min-height: 0;
}

.conversation-scroll {
  flex: 0 0 auto;
}

.thread-scroll {
  overflow-y: auto;
}

.bulk-mail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}

.bulk-select,
.conversation-select {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-muted);
}

.conversation-select {
  justify-content: center;
  width: 36px;
  height: 36px;
  cursor: pointer;
}

.bulk-select {
  display: grid;
  grid-template-columns: 36px auto;
  column-gap: 10px;
  min-width: 82px;
  font-size: 13px;
  font-weight: 700;
}

.bulk-select input {
  justify-self: center;
}

.bulk-select input,
.conversation-select input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-text);
  cursor: pointer;
}

.bulk-select input:disabled,
.conversation-select input:disabled {
  cursor: not-allowed;
}

.bulk-mail-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.bulk-mail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.bulk-mail-btn:hover:not(:disabled) {
  border-color: var(--color-text);
}

.bulk-mail-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bulk-mail-btn--danger {
  color: #b33b2e;
  border-color: #b33b2e;
}

.conversation-loading {
  flex: 1;
  min-height: 0;
}

.conversation-item {
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  min-height: 58px;
  padding: 9px 14px 9px 12px;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  cursor: pointer;
}

.conversation-quick-actions {
  position: absolute;
  z-index: 2;
  top: 50%;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.08));
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
}

.conversation-item:hover .conversation-quick-actions,
.conversation-item:focus-within .conversation-quick-actions {
  opacity: 1;
  pointer-events: auto;
}

.conversation-quick-actions :deep(.me3-btn--icon-only) {
  min-width: 32px;
  min-height: 32px;
}

.conversation-open {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.conversation-open:focus-visible {
  border-radius: var(--ui-radius-sm, 6px);
  outline: 2px solid var(--ui-accent, var(--color-text));
  outline-offset: 2px;
}

.conversation-item__trailing {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.conversation-item:hover,
.conversation-item--active {
  background: var(--color-bg-subtle);
}

.conversation-item--selected {
  background: var(--color-bg-subtle);
}

.conversation-item--unread {
  background: color-mix(
    in oklab,
    var(--ui-accent, var(--color-accent)) 8%,
    var(--ui-surface, var(--color-bg))
  );
}

.conversation-item--unread:hover,
.conversation-item--unread.conversation-item--selected,
.conversation-item--unread.conversation-item--active {
  background: color-mix(
    in oklab,
    var(--ui-accent, var(--color-accent)) 14%,
    var(--ui-surface, var(--color-bg))
  );
}

.conversation-item--active {
  box-shadow: inset 3px 0 0 var(--color-text);
}

.conversation-item--unread.conversation-item--active {
  box-shadow: inset 3px 0 0 var(--ui-accent, var(--color-accent));
}

.conversation-item--unread .conversation-item__meta strong,
.conversation-item--unread .conversation-item__summary,
.conversation-item--unread .conversation-item__subject {
  font-weight: 800;
}

.conversation-item__content {
  display: block;
  min-width: 0;
}

.conversation-item__meta {
  margin-bottom: 3px;
  min-width: 0;
  font-size: 14px;
}

.conversation-item__meta strong {
  display: block;
  min-width: 0;
}

.conversation-item__meta strong,
.conversation-item__summary,
.conversation-item__recipient,
.conversation-item__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-item__summary,
.conversation-item__separator,
.conversation-item__recipient,
.conversation-item__preview {
  color: var(--color-text-muted);
}

.conversation-item__summary {
  min-width: 0;
  margin: 0;
  font-size: 14px;
}

.conversation-item__subject {
  color: var(--color-text);
  font-weight: 650;
}

.conversation-item__recipient {
  margin-right: 6px;
  font-size: 13px;
}

.thread-count {
  justify-self: end;
  padding: 2px 7px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.conversation-cue {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 20px;
  padding: 1px 6px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 999px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 10px;
  font-weight: 750;
  white-space: nowrap;
}

.conversation-cue--unread {
  border-color: var(--ui-text, var(--color-text));
  color: var(--ui-text, var(--color-text));
}

.conversation-attachment-cue {
  flex-shrink: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.conversation-item__date {
  justify-self: end;
  align-self: start;
  min-width: 76px;
  padding-top: 2px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-style: normal;
  text-align: right;
  white-space: nowrap;
}

.pagination--split {
  border-top: 1px solid var(--color-border);
  border-bottom: 0;
}

.thread-pane {
  display: none;
  flex-direction: column;
  min-height: 0;
  background: var(--color-bg);
}

.thread-pane--mobile-open {
  display: flex;
}

.thread-pane--empty {
  border-right: none;
}

.thread-pane--empty .empty-state--inline {
  width: 100%;
}

.thread-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
}

.thread-back-btn {
  align-self: flex-start;
}

.thread-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.thread-heading {
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--color-border);
}

.thread-scroll {
  flex: 1;
  padding: 0 0 24px;
}

.thread-detail-loading,
.thread-detail-error {
  margin: 18px 24px;
}

.delivery-unconfirmed {
  display: grid;
  gap: 12px;
  margin-top: 16px;
  padding: 13px 14px;
  border: 1px solid color-mix(
    in srgb,
    var(--ui-warning, #b26a00) 48%,
    var(--ui-border, var(--color-border))
  );
  border-radius: var(--ui-radius-sm, 6px);
  background: color-mix(
    in srgb,
    var(--ui-warning, #b26a00) 8%,
    var(--ui-surface, var(--color-bg))
  );
}

.delivery-unconfirmed strong {
  color: var(--ui-text, var(--color-text));
}

.delivery-unconfirmed p {
  margin: 4px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.5;
}

.delivery-unconfirmed__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (min-width: 641px) {
  .mail-workspace {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }

  .mail-workspace--has-thread {
    grid-template-columns: minmax(320px, 42%) minmax(0, 1fr);
  }

  .mail-rail {
    grid-column: 1 / -1;
    grid-row: 1;
  }

  .conversation-list {
    grid-column: 1;
    grid-row: 2;
  }

  .mail-workspace--has-thread .conversation-list {
    border-right: 1px solid var(--color-border);
  }

  .mail-workspace--has-thread .thread-pane {
    display: flex;
    grid-column: 2;
    grid-row: 2;
    border-top: 1px solid var(--color-border);
  }

  .mail-workspace--has-thread .conversation-list.conversation-list--mobile-hidden {
    display: flex;
  }

  .thread-toolbar {
    justify-content: flex-end;
  }

  .thread-back-btn {
    display: none;
  }
}

.message-card {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 14px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-border);
}

.message-card--draft {
  box-shadow: inset 3px 0 0 var(--color-text);
}

.message-card__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  font-weight: 800;
}

.message-card__body {
  min-width: 0;
}

.message-card__header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}

.message-card__header p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.message-card__recipient {
  font-weight: 650;
}

.message-card__header-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.message-card__header-actions > span {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.unsubscribe-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text-muted, var(--color-text-muted));
  font: inherit;
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;
}

.unsubscribe-btn:hover:not(:disabled) {
  border-color: var(--ui-border-strong, var(--color-text-muted));
  color: var(--ui-text, var(--color-text));
}

.unsubscribe-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.status-pill {
  display: inline-flex;
  margin-left: 8px;
  padding: 2px 7px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.message-body {
  margin: 22px 0 0;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.65;
}

.message-html-frame {
  width: 100%;
  min-height: 120px;
  margin: 22px 0 0;
  border: none;
  background: #fff;
}

.external-content-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  margin-top: 18px;
  padding: 9px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: min(100%, 360px);
  min-height: 32px;
  padding: 5px 9px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.attachment-chip:hover {
  border-color: var(--color-text);
  background: var(--color-bg-subtle);
}

.attachment-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-chip small {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.message-card__actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.message-card__actions .action-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

/* Table */
.inbox-table-wrap {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}

.inbox-table {
  width: max(100%, 980px);
  min-width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.inbox-table thead tr {
  border-bottom: 1px solid var(--color-border);
}

.inbox-table th {
  padding: 10px 14px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
  user-select: none;
}

.col-select,
.cell-select {
  width: 52px;
  padding-right: 0;
}

.col-sortable {
  cursor: pointer;
}

.col-sortable:hover {
  color: var(--color-text);
}

.sort-indicator {
  margin-left: 4px;
  font-size: 10px;
}

.inbox-row {
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  transition: background 0.1s;
}

.inbox-row:last-of-type {
  border-bottom: none;
}

.inbox-row:hover {
  background: var(--color-bg-subtle);
}

.inbox-row--expanded {
  background: var(--color-bg-subtle);
}

.inbox-row--unread .cell-to,
.inbox-row--unread .cell-subject {
  font-weight: 800;
}

.inbox-row--expandable:focus-visible {
  outline: 2px solid var(--color-text);
  outline-offset: -2px;
}

.inbox-row--pending .cell-to::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text);
  margin-right: 7px;
  vertical-align: middle;
  flex-shrink: 0;
}

.select-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
}

.select-checkbox {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-text);
  cursor: pointer;
}

.select-checkbox:disabled {
  cursor: not-allowed;
}

.inbox-row td {
  padding: 11px 14px;
  font-size: 14px;
  vertical-align: middle;
}

.cell-to {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.cell-subject {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subject-stack {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.subject-stack > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-chip {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.message-chip--followup {
  border-color: var(--color-text);
  color: var(--color-text);
}

.cell-date {
  color: var(--color-text-muted);
  font-size: 13px;
  white-space: nowrap;
}

/* Origin badge */
.origin-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.origin--agent-draft {
  border-color: var(--color-text);
  color: var(--color-text);
}

.origin--agent-sent {
  background: var(--color-text);
  color: var(--color-bg);
  border-color: var(--color-text);
}

.origin--user-approved {
  border-color: var(--color-text-muted);
  color: var(--color-text-muted);
}

/* Status badge */
.status-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.status--pending-approval {
  border-color: var(--color-text);
  color: var(--color-text);
}

.status--sent {
  color: var(--color-text-muted);
}

.status--rejected,
.status--failed {
  color: #b33b2e;
  border-color: #b33b2e;
}

/* Detail row */
.detail-row td {
  padding: 0;
}

.detail-cell {
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}

.detail-panel {
  padding: 16px 20px;
}

.detail-headers {
  display: grid;
  gap: 6px;
  margin-bottom: 0;
}

.detail-field {
  display: flex;
  gap: 10px;
  font-size: 13px;
}

.detail-label {
  flex-shrink: 0;
  width: 52px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding-top: 2px;
}

.detail-divider {
  height: 1px;
  background: var(--color-border);
  margin: 12px 0;
}

.detail-body {
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  color: var(--color-text);
}

.contact-context {
  display: grid;
  gap: 10px;
}

.contact-context__content {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.contact-context__title {
  font-weight: 600;
}

.contact-context__meta {
  color: var(--color-text-muted);
}

.contact-link {
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.detail-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.12s;
}

.action-btn--compact {
  min-height: 36px;
  padding: 7px 14px;
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn--approve {
  background: var(--color-text);
  color: var(--color-bg);
  border: 1px solid var(--color-text);
}

.action-btn--approve:not(:disabled):hover {
  opacity: 0.8;
}

.action-btn--reject {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.action-btn--reject:not(:disabled):hover {
  color: var(--color-text);
  border-color: var(--color-text);
}

.action-btn--delete {
  background: var(--color-bg);
  color: #b33b2e;
  border: 1px solid #b33b2e;
}

.action-btn--delete:not(:disabled):hover {
  opacity: 0.8;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

/* Pagination */
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

.pagination-nav {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pagination-nav :deep(.me3-btn--icon-only),
.compose-modal__head :deep(.me3-btn--icon-only) {
  min-width: 44px;
  min-height: 44px;
}

.page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  font-size: 13px;
  cursor: pointer;
  color: var(--color-text-muted);
}

.page-btn:not(:disabled):hover {
  color: var(--color-text);
  border-color: var(--color-text);
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.page-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.page-size {
  font-size: 12px;
  color: var(--color-text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* States */
.state-card {
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-muted);
}

.state-card--error {
  color: #b33b2e;
}

.state-card--info {
  color: var(--color-text);
}

.state-sub {
  margin-top: 6px;
  font-size: 14px;
}

.empty-state {
  padding: 32px 20px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
}

.empty-state--inline {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.empty-state__stack {
  width: min(100%, 340px);
  padding: 0 16px;
  box-sizing: border-box;
}

.empty-state p {
  margin: 0;
}

.empty-state p + p {
  margin-top: 8px;
}

.empty-state__action {
  margin-top: 14px;
}

.compose-modal__card {
  display: grid;
  gap: 14px;
  width: min(100%, 620px);
  max-height: calc(100dvh - 40px);
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  box-shadow: 0 20px 60px rgba(17, 17, 17, 0.18);
}

.compose-modal__head,
.compose-modal__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.compose-modal__head h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.compose-field {
  display: grid;
  gap: 6px;
}

.compose-field--recipient {
  position: relative;
}

.compose-field > span,
.compose-field > label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.compose-field input,
.compose-field select,
.compose-field textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}

.compose-field input {
  height: 38px;
  padding: 0 10px;
}

.compose-field select {
  height: 38px;
  padding: 0 10px;
  appearance: auto;
}

.compose-field textarea {
  min-height: 220px;
  padding: 10px;
  line-height: 1.5;
  resize: vertical;
}

.compose-recipient-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}

.compose-recipient-option {
  display: grid;
  width: 100%;
  gap: 2px;
  padding: 10px;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.compose-recipient-option:last-child {
  border-bottom: 0;
}

.compose-recipient-option:hover,
.compose-recipient-option.is-active {
  background: var(--color-text);
  color: var(--color-bg);
}

.compose-recipient-option__name,
.compose-recipient-option__email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compose-recipient-option__name {
  font-size: 13px;
  font-weight: 700;
}

.compose-recipient-option__email {
  font-size: 12px;
  color: var(--color-text-muted);
}

.compose-recipient-option:hover .compose-recipient-option__email,
.compose-recipient-option.is-active .compose-recipient-option__email {
  color: inherit;
}

.compose-recipient-option:hover .compose-recipient-option__name,
.compose-recipient-option.is-active .compose-recipient-option__name {
  color: inherit;
}

.compose-attachments {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-subtle);
}

.compose-attachments__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.compose-attachments p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.compose-attachment-upload {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.compose-attachment-upload:hover {
  border-color: var(--color-text);
}

.compose-attachment-upload.is-disabled {
  opacity: 0.58;
  cursor: wait;
}

.compose-attachment-upload input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.compose-attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.compose-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 650;
}

.compose-attachment-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compose-attachment-chip small {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 11px;
}

.compose-attachment-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: -3px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.compose-attachment-remove:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.compose-field input:focus,
.compose-field select:focus,
.compose-field textarea:focus {
  outline: 2px solid var(--color-text);
  outline-offset: 1px;
}

.compose-error {
  margin: 0;
  font-size: 13px;
  color: #b33b2e;
}

.compose-error a {
  margin-left: 6px;
  color: var(--color-text);
  font-weight: 700;
  text-decoration: underline;
}

/* Mobile */
@media (max-width: 980px) {
  .inbox-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}

@media (max-width: 640px) {
  .agent-main {
    padding: 0;
  }

  .inbox-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
  }

  .mail-heading {
    display: grid;
    gap: 2px;
  }

  .inbox-panel {
    height: auto;
  }

  .mail-rail {
    align-items: stretch;
    padding: 4px 8px 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .conversation-list__head {
    display: none;
  }

  .conversation-scroll {
    flex: 0 0 auto;
    min-height: 0;
    max-height: none;
  }

  .bulk-mail-toolbar {
    gap: 8px;
    padding: 6px 10px 6px 8px;
  }

  .bulk-select {
    min-width: 76px;
  }

  .bulk-mail-actions {
    gap: 4px;
  }

  .conversation-quick-actions {
    display: none;
  }

  .bulk-mail-btn {
    min-height: 30px;
    padding: 0 7px;
    font-size: 12px;
  }

  .conversation-item {
    grid-template-columns: 44px minmax(0, 1fr) auto;
    gap: 6px;
    min-height: 54px;
    padding: 6px 12px 6px 4px;
  }

  .conversation-open {
    gap: 6px;
    min-height: 44px;
  }

  .conversation-item__trailing {
    gap: 4px;
  }

  .conversation-cue--unread {
    display: none;
  }

  .conversation-select {
    justify-content: center;
    width: 44px;
    height: 44px;
  }

  .conversation-item__content {
    display: block;
    min-width: 0;
  }

  .conversation-item__meta {
    margin-bottom: 3px;
  }

  .conversation-item__date {
    display: none;
  }

  .conversation-item__meta,
  .conversation-item__summary {
    font-size: 13px;
  }

  .thread-count {
    padding: 1px 6px;
    font-size: 10px;
  }

  .thread-pane {
    height: auto;
  }

  .thread-back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .thread-toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--color-bg);
  }

  .thread-toolbar :deep(.me3-btn--icon-only) {
    min-width: 44px;
    min-height: 44px;
  }

  .thread-heading {
    padding: 16px 16px 12px;
  }

  .message-card {
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 10px;
    padding: 16px;
  }

  .message-card__avatar {
    width: 32px;
    height: 32px;
  }

  .message-card__header {
    display: grid;
    gap: 6px;
  }

  .delivery-unconfirmed__actions {
    display: grid;
  }

  .thread-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .message-html-frame {
    display: block;
    max-width: 100%;
  }

  .confirm-modal {
    padding: 16px;
  }

  .confirm-modal__actions {
    flex-direction: column-reverse;
  }

  .bulk-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .bulk-controls {
    justify-content: stretch;
  }

  .inbox-table thead .col-origin,
  .inbox-table tbody .cell-origin {
    display: none;
  }

  .cell-to {
    max-width: 120px;
  }

  .detail-actions {
    flex-direction: column;
  }

  .action-btn {
    width: 100%;
    text-align: center;
  }
}

@media (min-width: 641px) and (max-width: 960px) {
  .agent-main {
    padding-left: 0;
    padding-right: 0;
  }
}
</style>

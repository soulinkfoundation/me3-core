import { ref } from "vue";
import type { AgentTargetPresentation } from "../utils/agentTargetChoices";
import type {
  AgentChatActionCard,
  AgentChatEmailDraftAction,
  AgentChatImageAction,
  AgentChatTurnTrace,
} from "../utils/agentChat";

export type AgentChatMessageAttachment = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  kind?: string | null;
  status?: string | null;
  storageKey?: string | null;
  hasText?: boolean | null;
  textTruncated?: boolean | null;
};

export type AgentChatMessage = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string | null;
  meta?: string | null;
  detail?: string | null;
  attachments?: AgentChatMessageAttachment[];
  actionCards?: AgentChatActionCard[];
  imageAction?: AgentChatImageAction | null;
  targetPresentation?: AgentTargetPresentation | null;
  emailDraftAction?: AgentChatEmailDraftAction | null;
  trace?: AgentChatTurnTrace | null;
  jobBuilderAction?: any;
  inboxLink?: boolean;
  rolodexLink?: boolean;
  reminderLink?: boolean;
  actionHref?: string | null;
  actionLabel?: string | null;
};

const defaultAssistantDisplayName = "ME3";
const assistantDisplayName = ref(defaultAssistantDisplayName);

const defaultMessages = (): AgentChatMessage[] => [
  {
    id: "assistant-ready",
    role: "assistant",
    text: "Ask me to check bookings, draft follow-up emails, manage reminders, update a contact, or help with your site and content.",
    meta: `${assistantDisplayName.value} ready`,
  },
];

const isOpen = ref(false);
const messages = ref<AgentChatMessage[]>(defaultMessages());
const launcherHidden = ref(false);

function normalizeAssistantDisplayName(name: string | null | undefined) {
  return name?.replace(/\s+/g, " ").trim() || defaultAssistantDisplayName;
}

function syncReadyMessageMeta() {
  const readyMessage = messages.value.find(
    (message) => message.id === "assistant-ready",
  );
  if (readyMessage) readyMessage.meta = `${assistantDisplayName.value} ready`;
}

export function useAgentChat() {
  function setAssistantDisplayName(name: string | null | undefined) {
    const next = normalizeAssistantDisplayName(name);
    if (assistantDisplayName.value === next) return;
    assistantDisplayName.value = next;
    syncReadyMessageMeta();
  }

  function openChat() {
    isOpen.value = true;
  }

  function closeChat() {
    isOpen.value = false;
  }

  function toggleChat() {
    isOpen.value = !isOpen.value;
  }

  function hideLauncher() {
    launcherHidden.value = true;
  }

  function showLauncher() {
    launcherHidden.value = false;
  }

  function replaceMessages(next: AgentChatMessage[]) {
    messages.value = next.length > 0 ? [...next] : defaultMessages();
  }

  function appendMessage(message: AgentChatMessage) {
    messages.value.push(message);
  }

  function resetMessages() {
    messages.value = defaultMessages();
  }

  function resetState() {
    assistantDisplayName.value = defaultAssistantDisplayName;
    isOpen.value = false;
    launcherHidden.value = false;
    messages.value = defaultMessages();
  }

  return {
    assistantDisplayName,
    isOpen,
    messages,
    launcherHidden,
    setAssistantDisplayName,
    openChat,
    closeChat,
    toggleChat,
    hideLauncher,
    showLauncher,
    replaceMessages,
    appendMessage,
    resetMessages,
    resetState,
  };
}

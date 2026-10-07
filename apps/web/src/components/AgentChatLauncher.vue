<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";
import { useAgentChat, type AgentChatMessage } from "../composables/useAgentChat";
import {
  formatAgentRuntimeDetail,
  formatAgentRuntimeMetadata,
  normalizeAgentActionCards,
  resolveAgentReplyText,
  resolveAgentSiteActionLink,
  type AgentChatActionCard,
} from "../utils/agentChat";
import { renderAssistantMarkdown } from "../utils/assistantMarkdown";
import { ASSISTANT_AVATAR_SRC } from "../utils/assistantBranding";
import UiIcon from "./UiIcon.vue";

type AgentSandboxResponse = {
  ok: boolean;
  turnId: string | null;
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
  contactsChanged?: boolean;
  error?: string;
};
type AssistantSettingsResponse = {
  assistantName: string | null;
  displayName: string;
};

const auth = useAuthStore();
const agentChat = useAgentChat();
const assistantDisplayName = agentChat.assistantDisplayName;
const chatOpen = agentChat.isOpen;
const chatMessages = agentChat.messages;
const launcherHidden = agentChat.launcherHidden;
const currentUserId = computed(() => auth.user?.id ?? null);

const initialized = ref(false);
const sending = ref(false);
const draft = ref("");
const error = ref<string | null>(null);
const composerRef = ref<HTMLTextAreaElement | null>(null);
const scrollerRef = ref<HTMLDivElement | null>(null);
const primaryThreadId = ref<string | null>(null);

async function loadPrimaryConversation() {
  const ownerId = currentUserId.value;
  primaryThreadId.value = null;
  const response = await api.post<{ thread: { id: string } }>("/assistant/threads/primary", {});
  const history = await api.get<{ messages: AgentChatMessage[] }>(
    `/assistant/threads/${encodeURIComponent(response.thread.id)}/messages`,
  );
  if (currentUserId.value !== ownerId) return;
  primaryThreadId.value = response.thread.id;
  agentChat.replaceMessages(history.messages);
}

const showRuntimeMetadata = import.meta.env.DEV;
const launcherLabel = computed(() => `Open ${assistantDisplayName.value} chat`);
const panelLabel = computed(() => `${assistantDisplayName.value} assistant`);
const closeLabel = computed(() => `Close ${assistantDisplayName.value} chat`);
const typingLabel = computed(() => `${assistantDisplayName.value} is typing`);
const composerLabel = computed(() => `Message ${assistantDisplayName.value}`);

const canSend = computed(
  () => draft.value.trim().length > 0 && !sending.value && auth.isAuthenticated && primaryThreadId.value !== null,
);

function formatMetadata(result: AgentSandboxResponse): string | null {
  return formatAgentRuntimeMetadata(result, {
    showRuntimeMetadata,
  });
}

function formatDetail(result: AgentSandboxResponse): string | null {
  return formatAgentRuntimeDetail(result);
}

async function loadAssistantDisplayName() {
  try {
    const response =
      await api.get<AssistantSettingsResponse>("/assistant/settings");
    agentChat.setAssistantDisplayName(response.displayName);
  } catch {
    agentChat.setAssistantDisplayName(null);
  }
}

async function scrollToBottom() {
  await nextTick();
  const node = scrollerRef.value;
  if (!node) return;
  node.scrollTop = node.scrollHeight;
}

function toggleChat() {
  agentChat.toggleChat();
}

function closeChat() {
  agentChat.closeChat();
}

const COMPOSER_MAX_HEIGHT_PX = 100;

function autosizeComposer() {
  const el = composerRef.value;
  if (!el) return;
  el.style.height = "auto";
  const scroll = el.scrollHeight;
  const next = Math.min(scroll, COMPOSER_MAX_HEIGHT_PX);
  el.style.height = `${next}px`;
  if (scroll > COMPOSER_MAX_HEIGHT_PX) {
    el.style.overflowY = "auto";
    el.scrollTop = el.scrollHeight;
  } else {
    el.style.overflowY = "hidden";
  }
}

async function sendMessage() {
  if (!canSend.value) return;

  const text = draft.value.trim();
  draft.value = "";
  error.value = null;
  agentChat.appendMessage({
    role: "user",
    text,
  });

  sending.value = true;
  await scrollToBottom();

  try {
    const result = await api.post<AgentSandboxResponse>("/assistant/chat/turn", {
      requestId: crypto.randomUUID(),
      messageText: text,
      threadId: primaryThreadId.value,
    });

    const replyText = resolveAgentReplyText(result.replyText);
    const siteActionLink = resolveAgentSiteActionLink(result);
    agentChat.appendMessage({
      role: "assistant",
      text: replyText,
      meta: formatMetadata(result),
      detail: formatDetail(result),
      actionCards: normalizeAgentActionCards(result.actionCards),
      inboxLink: result.emailAction?.kind === "drafted",
      rolodexLink: result.contactsChanged === true,
      reminderLink:
        result.reminderAction?.kind === "created" ||
        result.reminderAction?.kind === "updated",
      actionHref:
        siteActionLink?.href ||
        (result.contentAction?.kind === "saved" ? "/social" : null),
      actionLabel:
        siteActionLink?.label ||
        (result.contentAction?.kind === "saved" ? "Open Social Publishing" : null),
    });
  } catch (cause: any) {
    const message =
      cause?.message || `Failed to reach ${assistantDisplayName.value} right now`;
    error.value = message;
    agentChat.appendMessage({
      role: "assistant",
      text: "I couldn’t complete that turn just yet.",
      detail: message,
    });
  } finally {
    sending.value = false;
    await scrollToBottom();
    await nextTick();
    autosizeComposer();
    composerRef.value?.focus();
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void sendMessage();
}

/** Same-origin links should not use target=_blank — new tabs on another host have empty localStorage for the wizard. */
function actionHrefOpensNewTab(href: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const resolved = new URL(href, window.location.href);
    return resolved.origin !== window.location.origin;
  } catch {
    return true;
  }
}

watch(chatOpen, async (value) => {
  if (value) {
    if (!sending.value) {
      sending.value = true;
      error.value = null;
      try { await loadPrimaryConversation(); }
      catch (cause: any) { error.value = cause?.message || "Your main conversation could not load."; }
      finally { sending.value = false; }
    }
    await nextTick();
    autosizeComposer();
    composerRef.value?.focus();
    await scrollToBottom();
  }
});

watch(currentUserId, (value, previous) => {
  if (value === previous) return;
  agentChat.resetState();
  primaryThreadId.value = null;
  if (value) void loadAssistantDisplayName();
});

onMounted(async () => {
  await auth.ensureInitialized();
  initialized.value = true;
  if (auth.isAuthenticated) void loadAssistantDisplayName();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="initialized && auth.isAuthenticated" class="agent-chat-portal">
      <!-- FAB is position:fixed on its own so it stays visible when the panel (also fixed) is open/closed -->
      <button
        v-show="!chatOpen && !launcherHidden"
        type="button"
        class="agent-launcher"
        :aria-label="launcherLabel"
        :aria-expanded="false"
        @click="toggleChat"
      >
        <img
          class="agent-launcher-icon"
          :src="ASSISTANT_AVATAR_SRC"
          alt=""
          aria-hidden="true"
        />
      </button>

      <div
        v-if="chatOpen"
        class="agent-panel-backdrop"
        aria-hidden="true"
        @click="closeChat"
      />

      <section v-if="chatOpen" class="agent-panel" :aria-label="panelLabel">
        <header class="agent-header">
          <button
            type="button"
            class="agent-close"
            :aria-label="closeLabel"
            @click="closeChat"
          >
            <UiIcon name="X" :size="18" />
          </button>
        </header>

        <div ref="scrollerRef" class="agent-messages" aria-live="polite">
          <article
            v-for="(message, index) in chatMessages"
            :key="
              message.id ||
              `${message.role}-${index}-${message.text.slice(0, 24)}`
            "
            class="agent-message"
            :class="message.role"
          >
            <div
              class="agent-message-text"
              v-html="renderAssistantMarkdown(message.text)"
            ></div>
            <p v-if="message.meta" class="agent-message-meta">
              {{ message.meta }}
            </p>
            <p v-if="message.detail" class="agent-message-detail">
              {{ message.detail }}
            </p>
            <a
              v-if="message.inboxLink"
              href="/email"
              class="agent-message-inbox-link"
            >
              Open messages →
            </a>
            <a
              v-if="message.reminderLink"
              href="/calendar"
              class="agent-message-inbox-link"
            >
              Open calendar →
            </a>
            <a
              v-if="message.actionHref && message.actionLabel"
              :href="message.actionHref"
              class="agent-message-inbox-link"
              :target="
                actionHrefOpensNewTab(message.actionHref) ? '_blank' : undefined
              "
              :rel="
                actionHrefOpensNewTab(message.actionHref)
                  ? 'noopener noreferrer'
                  : undefined
              "
            >
              {{ message.actionLabel }} →
            </a>
          </article>

          <article v-if="sending" class="agent-message assistant pending">
            <div
              class="agent-message-text agent-message-typing"
              role="status"
              aria-live="polite"
            >
              <span>{{ typingLabel }}</span>
              <span class="agent-typing" aria-hidden="true">
                <span class="agent-typing-dot" />
                <span class="agent-typing-dot" />
                <span class="agent-typing-dot" />
              </span>
            </div>
          </article>
        </div>

        <footer class="agent-composer">
          <label class="agent-sr-only" for="agent-chat-input">
            {{ composerLabel }}
          </label>
          <div class="agent-composer-toolbar">
            <button
              type="button"
              class="agent-send-circle"
              :disabled="!canSend"
              :aria-label="sending ? 'Sending' : 'Send message'"
              @click="sendMessage"
            >
              <UiIcon name="ArrowUp" :size="18" />
            </button>
          </div>
          <p v-if="error" class="agent-error">{{ error }}</p>
          <textarea
            id="agent-chat-input"
            ref="composerRef"
            v-model="draft"
            class="agent-input"
            rows="1"
            placeholder="Ask about bookings, reminders, email, or your site"
            :disabled="sending"
            @keydown="onKeydown"
            @input="autosizeComposer"
          />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.agent-launcher {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 90;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: var(--color-text);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.agent-launcher-icon {
  display: block;
  width: 78px;
  height: 78px;
  object-fit: contain;
  line-height: 1;
  animation: agent-launcher-float 2.4s ease-in-out infinite;
}

.agent-launcher:hover {
  transform: translateY(-2px);
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.1),
    0 14px 36px rgba(0, 0, 0, 0.12);
}

.agent-launcher:focus-visible,
.agent-close:focus-visible,
.agent-send-circle:focus-visible,
.agent-input:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--color-accent), white 20%);
  outline-offset: 2px;
}

.agent-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 84;
  background: rgba(0, 0, 0, 0.12);
}

.agent-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: auto;
  z-index: 85;
  width: min(420px, 100vw);
  max-height: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: none;
  border-left: 1px solid var(--color-border);
  border-radius: 0;
  background: var(--color-bg-subtle);
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.12);
  animation: agent-slide-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.agent-header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  flex-shrink: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
}

.agent-close {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.agent-messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  overflow-y: auto;
}

.agent-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 88%;
  padding: 12px 14px;
  border-radius: 18px;
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
  animation: chat-message-enter 340ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.agent-message.user {
  align-self: flex-end;
  background: color-mix(in oklab, var(--color-accent), white 76%);
  border-color: color-mix(in oklab, var(--color-accent), white 60%);
}

.agent-message.assistant {
  align-self: flex-start;
}

.agent-message.pending {
  opacity: 0.82;
  border-color: color-mix(in oklab, var(--color-accent), white 74%);
  background: linear-gradient(
    135deg,
    color-mix(in oklab, var(--color-accent), white 92%),
    var(--color-bg-muted)
  );
}

.agent-message-text {
  display: grid;
  gap: 8px;
}

.agent-message-text :deep(:where(p, ul, ol, blockquote, pre, h1, h2, h3)) {
  margin: 0;
}

.agent-message-text :deep(:where(p, li)) {
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.agent-message-text :deep(:where(h1, h2, h3)) {
  color: var(--color-text);
  font-weight: 800;
  line-height: 1.2;
}

.agent-message-text :deep(h1) {
  font-size: 18px;
}

.agent-message-text :deep(h2) {
  font-size: 16px;
}

.agent-message-text :deep(h3) {
  font-size: 14px;
}

.agent-message-text :deep(:where(ul, ol)) {
  display: grid;
  gap: 5px;
  padding-left: 20px;
}

.agent-message-text :deep(blockquote) {
  border-left: 3px solid var(--color-border);
  padding-left: 10px;
  color: var(--color-text-muted);
}

.agent-message-text :deep(pre) {
  overflow-x: auto;
  border-radius: 8px;
  padding: 9px 10px;
  background: var(--color-bg);
}

.agent-message-text :deep(code) {
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--color-bg);
  font-size: 0.92em;
}

.agent-message-text :deep(pre code) {
  padding: 0;
  background: transparent;
  white-space: pre;
}

.agent-message-text :deep(a) {
  color: var(--color-accent);
  font-weight: 800;
  text-decoration: none;
}

.agent-message-text :deep(a:hover) {
  text-decoration: underline;
}

.agent-message-text :deep(hr) {
  width: 100%;
  height: 1px;
  border: 0;
  background: var(--color-border);
}

.agent-message-typing {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}

.agent-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.agent-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  animation: agent-typing-bounce 1.1s infinite ease-in-out;
}

.agent-typing-dot:nth-child(2) {
  animation-delay: 0.12s;
}

.agent-typing-dot:nth-child(3) {
  animation-delay: 0.24s;
}

.agent-message-meta,
.agent-message-detail {
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-muted);
}

.agent-message-inbox-link {
  display: inline-block;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-accent);
  text-decoration: none;
  margin-top: 2px;
}

.agent-message-inbox-link:hover {
  text-decoration: underline;
}

.agent-composer {
  display: flex;
  flex-direction: column-reverse;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
}

.agent-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  max-height: 100px;
  resize: none;
  margin: 0;
  padding: 8px 14px 10px;
  border: none;
  border-radius: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 14px;
  line-height: 1.4;
  overflow-y: hidden;
}

.agent-input::placeholder {
  color: var(--color-text-muted);
}

.agent-input:focus {
  outline: none;
}

.agent-error {
  margin: 0;
  padding: 0 14px 8px;
  color: #a33;
  font-size: 12px;
  line-height: 1.4;
}

.agent-composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  padding: 8px 10px 10px;
  background: var(--color-bg);
}

.agent-send-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #757575;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.agent-send-circle:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.agent-sr-only {
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

@keyframes agent-launcher-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-10px);
  }
}

@keyframes agent-slide-in {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes chat-message-enter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes agent-typing-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.42;
  }

  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-launcher,
  .agent-launcher-icon,
  .agent-panel,
  .agent-message,
  .agent-typing-dot {
    animation: none;
    transition: none;
  }
}

@media (max-width: 640px) {
  .agent-launcher {
    right: 12px;
    bottom: 12px;
  }

  .agent-panel {
    width: 100vw;
  }
}
</style>

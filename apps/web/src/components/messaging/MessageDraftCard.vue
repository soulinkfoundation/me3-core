<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import MessagingAvatar from "./MessagingAvatar.vue";
import { useMessagingStore } from "../../stores/messaging";
import { draftWasSent, firstName, type AgentMessageDraft } from "../../utils/messagingCards";

/**
 * "Tell Erum I'm running late": the message ME3 drafted, waiting for Send. ME3 never sends it; Send goes from this
 * browser through Soulink chat. Once sent it folds into a one-line receipt and the person's card takes over.
 */
const props = defineProps<{ draft: AgentMessageDraft }>();
const messaging = useMessagingStore();

const text = ref(props.draft.text);
const editing = ref(false);
const sending = ref(false);
const sent = ref(false);
const errorMessage = ref("");

const person = computed(() => ({ name: props.draft.recipientName, imageUrl: null }));
// Already sent, from this browser or a phone, or before the chat was reopened: never offer Send twice.
const alreadySent = computed(() => sent.value || draftWasSent(props.draft, messaging.cards, messaging.sentDrafts));
const canSend = computed(() => !sending.value && messaging.ready && text.value.trim().length > 0);

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  errorMessage.value = "";
  try {
    const cid = await messaging.startConversation(props.draft.soulinkNodeId);
    await messaging.send(cid, text.value);
    messaging.markDraftSent(props.draft.soulinkNodeId, props.draft.text);
    sent.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "Couldn't send. Please try again.";
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Transition name="draft-fold" mode="out-in">
    <p v-if="alreadySent" key="sent" class="message-draft__sent">
      <UiIcon name="Check" :size="18" />
      Sent to {{ firstName(person) }}
    </p>
    <section v-else key="draft" class="message-draft" data-testid="message-draft-card" aria-label="Message draft">
      <header class="message-draft__to">
        <span class="message-draft__label">To</span>
        <MessagingAvatar :person="person" :size="28" />
        <span class="message-draft__name">{{ draft.recipientName }}</span>
      </header>
      <textarea
        v-if="editing"
        v-model="text"
        class="message-draft__text message-draft__text--editing"
        rows="3"
        aria-label="Message"
      />
      <p v-else class="message-draft__text">{{ text }}</p>
      <p v-if="errorMessage" class="message-draft__error" role="alert">{{ errorMessage }}</p>
      <div class="message-draft__actions">
        <Button color="secondary" :disabled="!canSend" data-testid="message-draft-send" @click="send">{{ sending ? "Sending…" : "Send" }}</Button>
        <Button color="neutral" :disabled="sending" @click="editing = !editing">{{ editing ? "Done" : "Edit" }}</Button>
      </div>
      <p v-if="!messaging.ready" class="message-draft__hint">
        {{ messaging.status === "unavailable" ? "Messaging isn't available on this ME3 yet." : "Connecting to messaging…" }}
      </p>
    </section>
  </Transition>
</template>

<style scoped>
.message-draft {
  display: grid;
  gap: 12px;
  margin-top: 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg, 18px);
  padding: 14px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

.message-draft__to {
  display: flex;
  gap: 10px;
  align-items: center;
}

.message-draft__label,
.message-draft__hint {
  color: var(--ui-text-muted);
  font-size: 14px;
}

.message-draft__hint {
  margin: 0;
  font-size: 12px;
}

.message-draft__name {
  font-weight: 600;
  font-size: 14px;
}

.message-draft__text {
  margin: 0;
  border-radius: 14px;
  padding: 12px;
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font: inherit;
  white-space: pre-wrap;
}

.message-draft__text--editing {
  width: 100%;
  border: 1px solid var(--ui-border);
  resize: vertical;
}

.message-draft__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.message-draft__error {
  margin: 0;
  color: var(--ui-danger, #c0392b);
  font-size: 13px;
}

.message-draft__sent {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0 0;
  font-size: 14px;
  font-weight: 600;
}

.message-draft__sent :deep(svg) {
  color: var(--ui-accent);
}

/* The card goes at once and the receipt fades in, so the two never overlap. */
.draft-fold-enter-active {
  transition: opacity 0.2s ease;
}

.draft-fold-enter-from {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .draft-fold-enter-active {
    transition: none;
  }
}
</style>

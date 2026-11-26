<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import MessagingAvatar from "./MessagingAvatar.vue";
import { useMessagingStore } from "../../stores/messaging";
import { firstName, messagingTimeLabel, type PersonMessageCard } from "../../utils/messagingCards";

/**
 * A conversation with someone in Chat, laid out like a notification. Their message: photo, name, two lines and an
 * inline reply as the card's bottom edge. Your message: one quiet line with whether they've seen it. A request:
 * Accept or Decline. Tapping the card opens the whole conversation.
 */
const props = withDefaults(defineProps<{ card: PersonMessageCard; dismissible?: boolean }>(), { dismissible: false });
const emit = defineEmits<{ open: [cid: string]; dismiss: [] }>();
const messaging = useMessagingStore();

const reply = ref("");
const busy = ref(false);
const errorMessage = ref("");
const name = computed(() => firstName(props.card.person));
const time = computed(() => messagingTimeLabel(props.card.latest.createdAt));

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  errorMessage.value = "";
  try {
    await action();
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "Couldn't do that. Please try again.";
  } finally {
    busy.value = false;
  }
}

function sendReply() {
  const text = reply.value.trim();
  if (!text || busy.value) return;
  void run(async () => {
    await messaging.send(props.card.cid, text);
    reply.value = "";
  });
}

// Swipe sideways to dismiss on touch; with a mouse or keyboard the dismiss button does the same.
const offset = ref(0);
let origin: { x: number; y: number; id: number } | null = null;
function pointerDown(event: PointerEvent) {
  if (!props.dismissible || event.pointerType === "mouse") return;
  if ((event.target as HTMLElement).closest("button,a,input,textarea")) return;
  origin = { x: event.clientX, y: event.clientY, id: event.pointerId };
}
function pointerMove(event: PointerEvent) {
  if (!origin || event.pointerId !== origin.id) return;
  const x = event.clientX - origin.x, y = event.clientY - origin.y;
  // Only a mostly sideways drag; a vertical one is the page scrolling.
  if (Math.abs(x) > Math.abs(y)) offset.value = x;
}
function pointerUp(event: PointerEvent) {
  if (!origin || event.pointerId !== origin.id) return;
  origin = null;
  const width = (event.currentTarget as HTMLElement).offsetWidth || 320;
  if (Math.abs(offset.value) > width / 3) {
    offset.value = offset.value < 0 ? -width * 1.2 : width * 1.2;
    window.setTimeout(() => emit("dismiss"), 180);
  } else {
    offset.value = 0;
  }
}
function cancelSwipe() {
  origin = null;
  offset.value = 0;
}
const swipeStyle = computed(() => offset.value
  ? { transform: `translateX(${offset.value}px)`, opacity: String(Math.max(0.4, 1 - Math.abs(offset.value) / 500)) }
  : undefined);
</script>

<template>
  <article
    class="person-card"
    :class="[`person-card--${card.kind.type}`, { 'person-card--dragging': offset !== 0 }]"
    :style="swipeStyle"
    data-testid="person-message-card"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerUp"
    @pointercancel="cancelSwipe"
  >
    <template v-if="card.kind.type === 'replied'">
      <button type="button" class="person-card__line" :aria-label="`Open your conversation with ${name}`" @click="emit('open', card.cid)">
        <MessagingAvatar :person="card.person" :size="28" />
        <span class="person-card__line-text">
          <span class="person-card__name">{{ card.person.name }}</span>
          <span class="person-card__time">{{ time }}</span>
          <span class="person-card__mine">You: {{ card.latest.text }}<span class="person-card__state"> · {{ card.kind.seen ? "Seen" : "Sent" }}</span></span>
        </span>
      </button>
    </template>

    <template v-else>
      <button type="button" class="person-card__head" :aria-label="`Open your conversation with ${name}`" @click="emit('open', card.cid)">
        <span class="person-card__avatar">
          <MessagingAvatar :person="card.person" :size="36" />
          <span v-if="card.unreadCount > 0" class="person-card__badge">{{ card.unreadCount }}</span>
        </span>
        <span class="person-card__body">
          <span class="person-card__title">
            <span class="person-card__name">{{ card.person.name }}</span>
            <span class="person-card__time">{{ time }}</span>
          </span>
          <span class="person-card__text">{{ card.latest.text }}</span>
          <span v-if="card.kind.type === 'incoming' && card.kind.more > 0" class="person-card__more">{{ card.kind.more }} more</span>
          <span v-if="card.kind.type === 'request'" class="person-card__more">Wants to message you</span>
        </span>
      </button>

      <div v-if="card.kind.type === 'request'" class="person-card__actions">
        <Button color="primary" size="compact" :disabled="busy" @click="run(() => messaging.accept(card))">Accept</Button>
        <Button color="secondary" size="compact" :disabled="busy" @click="run(() => messaging.decline(card))">Decline</Button>
      </div>
      <form v-else class="person-card__reply" @submit.prevent="sendReply">
        <input
          v-model="reply"
          class="person-card__input"
          type="text"
          :placeholder="`Reply to ${name}`"
          :aria-label="`Reply to ${name}`"
          :disabled="busy || !messaging.ready"
          enterkeyhint="send"
        />
        <Button v-if="reply.trim()" type="submit" color="primary" size="compact" icon-only :disabled="busy" :aria-label="`Send to ${name}`">
          <UiIcon name="ArrowUp" :size="16" />
        </Button>
      </form>
    </template>

    <p v-if="errorMessage" class="person-card__error" role="alert">{{ errorMessage }}</p>
    <button v-if="dismissible" type="button" class="person-card__dismiss" :aria-label="`Dismiss ${name}`" title="Dismiss" @click="emit('dismiss')">
      <UiIcon name="X" :size="14" />
    </button>
  </article>
</template>

<style scoped>
.person-card {
  position: relative;
  display: grid;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg, 18px);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
  color: var(--ui-text);
  touch-action: pan-y;
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.person-card--dragging {
  transition: none;
}

.person-card--replied {
  border-color: transparent;
  background: var(--ui-surface-muted);
  box-shadow: none;
}

.person-card button.person-card__head,
.person-card button.person-card__line {
  display: flex;
  gap: 10px;
  width: 100%;
  border: 0;
  padding: 12px 12px 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.person-card button.person-card__line {
  align-items: center;
  padding: 10px 12px;
}

.person-card__avatar {
  position: relative;
  flex: none;
}

.person-card__badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  border: 2px solid var(--ui-surface);
  border-radius: 999px;
  padding: 0 4px;
  background: var(--ui-accent);
  color: var(--ui-accent-contrast, #fff);
  font-size: 11px;
  font-weight: 700;
}

.person-card__body,
.person-card__line-text {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.person-card__line-text {
  grid-template-columns: auto 1fr;
  column-gap: 6px;
  align-items: baseline;
}

.person-card__title {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.person-card__name {
  font-weight: 600;
  font-size: 15px;
}

.person-card__time {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.person-card__text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 15px;
  line-height: 1.35;
}

.person-card__mine {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.person-card__state {
  opacity: 0.8;
}

.person-card__more {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.person-card__reply,
.person-card__actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 12px;
  border-top: 1px solid var(--ui-border);
  padding: 8px 0 10px;
}

.person-card__input {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 6px 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 15px;
}

.person-card__input:focus {
  outline: none;
}

.person-card__input::placeholder {
  color: var(--ui-text-muted);
  opacity: 0.8;
}

.person-card__error {
  margin: 0 12px 10px;
  color: var(--ui-danger, #c0392b);
  font-size: 13px;
}

.person-card__dismiss {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* The dismiss button shows on hover or keyboard focus; touch swipes instead. */
.person-card:hover .person-card__dismiss,
.person-card:focus-within .person-card__dismiss {
  opacity: 1;
}

@media (hover: none) {
  .person-card__dismiss {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .person-card {
    transition: none;
  }
}
</style>

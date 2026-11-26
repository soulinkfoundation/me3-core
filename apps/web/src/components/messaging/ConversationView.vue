<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { Channel, LocalMessage } from "stream-chat";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import MessagingAvatar from "./MessagingAvatar.vue";
import { REPORT_REASONS, useMessagingStore, type ReportReason } from "../../stores/messaging";
import { firstName, messagingTimeLabel, type PersonMessageCard } from "../../utils/messagingCards";

/**
 * One conversation with someone, on Stream from this browser: their messages and yours, photos, "Seen", earlier
 * messages on scroll, and Block / Report in the header (through Core to Soulink). ME3 never sees the text.
 */
const props = defineProps<{ cid: string }>();
const emit = defineEmits<{ back: [] }>();
const messaging = useMessagingStore();

const channel = shallowRef<Channel | null>(null);
const loading = ref(true);
const loadingOlder = ref(false);
const hasMore = ref(true);
const errorMessage = ref("");
const draft = ref("");
const sending = ref(false);
const list = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const menuOpen = ref(false);
const blocked = ref(false);
const reportOpen = ref(false);
const reportReason = ref<ReportReason>("spam");
const reportDetails = ref("");
const reportSent = ref(false);
const actionBusy = ref(false);

const card = computed<PersonMessageCard | null>(() => messaging.cards.find((candidate) => candidate.cid === props.cid) ?? null);
const person = computed(() => {
  if (card.value) return card.value.person;
  const me = messaging.me;
  const member = channel.value ? Object.values(channel.value.state.members).find((candidate) => (candidate.user?.id ?? candidate.user_id) !== me) : null;
  return { nodeId: member?.user?.id ?? "", name: member?.user?.name || "Conversation", imageUrl: member?.user?.image ? String(member.user.image) : null, handle: null };
});

type Row = { id: string; mine: boolean; text: string; images: string[]; time: number; pending: boolean };
const rows = computed<Row[]>(() => {
  void messaging.revision;
  const me = messaging.me;
  return (channel.value?.state.messages ?? [])
    .filter((message: LocalMessage) => message.type !== "system" && message.type !== "deleted")
    .map((message: LocalMessage) => ({
      id: message.id,
      mine: message.user?.id === me,
      text: message.text ?? "",
      images: (message.attachments ?? [])
        .map((attachment) => attachment.image_url || attachment.thumb_url || "")
        .filter(Boolean),
      time: new Date(message.created_at ?? Date.now()).getTime(),
      pending: message.status === "sending",
    }));
});
/** "Seen" under your last message once they've read up to it. */
const seenId = computed(() => {
  void messaging.revision;
  const otherRead = person.value.nodeId ? channel.value?.state.read[person.value.nodeId]?.last_read : undefined;
  const lastMine = [...rows.value].reverse().find((row) => row.mine);
  return lastMine && otherRead && new Date(otherRead).getTime() >= lastMine.time ? lastMine.id : null;
});

async function scrollToEnd() {
  await nextTick();
  list.value?.scrollTo({ top: list.value.scrollHeight });
}

async function open(cid: string) {
  loading.value = true;
  errorMessage.value = "";
  channel.value = null;
  try {
    if (!messaging.ready) await messaging.start();
    const watched = await messaging.watched(cid);
    channel.value = watched;
    hasMore.value = watched.state.messages.length >= 25;
    await messaging.markRead(cid);
    if (person.value.handle) blocked.value = await messaging.isBlocked(person.value).catch(() => false);
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "This conversation couldn't open.";
  } finally {
    loading.value = false;
    void scrollToEnd();
  }
}

watch(() => props.cid, (cid) => void open(cid), { immediate: true });

// New messages while open: follow them if the reader is at the bottom, and mark them read.
watch(() => rows.value.length, async (count, previous) => {
  if (!list.value || count <= (previous ?? 0)) return;
  const atBottom = list.value.scrollHeight - list.value.scrollTop - list.value.clientHeight < 120;
  if (atBottom) void scrollToEnd();
  if (document.visibilityState === "visible") await messaging.markRead(props.cid);
});

async function loadOlder() {
  const current = channel.value;
  const oldest = current?.state.messages[0];
  if (!current || !oldest || loadingOlder.value || !hasMore.value || !list.value) return;
  loadingOlder.value = true;
  const before = list.value.scrollHeight;
  try {
    const result = await current.query({ messages: { limit: 30, id_lt: oldest.id } });
    hasMore.value = (result.messages?.length ?? 0) >= 30;
    await nextTick();
    // Keep the reader on the message they were looking at.
    list.value.scrollTop += list.value.scrollHeight - before;
  } catch {
    // The older page can be asked for again.
  } finally {
    loadingOlder.value = false;
  }
}

function onScroll() {
  if (list.value && list.value.scrollTop < 80) void loadOlder();
}

async function send() {
  const text = draft.value.trim();
  if (!text || sending.value) return;
  sending.value = true;
  errorMessage.value = "";
  try {
    await messaging.send(props.cid, text);
    draft.value = "";
    void scrollToEnd();
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "Couldn't send. Please try again.";
  } finally {
    sending.value = false;
  }
}

async function sendPhoto(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !channel.value) return;
  sending.value = true;
  errorMessage.value = "";
  try {
    const uploaded = await channel.value.sendImage(file);
    await channel.value.sendMessage({ text: draft.value.trim(), attachments: [{ type: "image", image_url: uploaded.file, fallback: file.name }] });
    draft.value = "";
    void scrollToEnd();
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "The photo couldn't be sent.";
  } finally {
    sending.value = false;
  }
}

function composerKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}

async function toggleBlock() {
  menuOpen.value = false;
  actionBusy.value = true;
  errorMessage.value = "";
  try {
    if (blocked.value) {
      await messaging.unblock(person.value);
      blocked.value = false;
    } else {
      await messaging.block(person.value);
      blocked.value = true;
      emit("back");
    }
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "Couldn't do that. Please try again.";
  } finally {
    actionBusy.value = false;
  }
}

async function sendReport() {
  if (!card.value) return;
  actionBusy.value = true;
  errorMessage.value = "";
  try {
    await messaging.report(card.value, reportReason.value, reportDetails.value);
    reportSent.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "Couldn't send the report. Please try again.";
    reportOpen.value = false;
  } finally {
    actionBusy.value = false;
  }
}

function openReport() {
  menuOpen.value = false;
  reportSent.value = false;
  reportDetails.value = "";
  reportReason.value = "spam";
  reportOpen.value = true;
}

function closeMenu(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest(".conversation__menu")) menuOpen.value = false;
}
watch(menuOpen, (isOpen) => {
  if (isOpen) document.addEventListener("click", closeMenu);
  else document.removeEventListener("click", closeMenu);
});
onBeforeUnmount(() => document.removeEventListener("click", closeMenu));
</script>

<template>
  <section class="conversation" :aria-label="`Conversation with ${person.name}`">
    <header class="conversation__header">
      <Button class="conversation__back" color="ghost" size="compact" icon-only aria-label="Back to messages" @click="emit('back')">
        <UiIcon name="ArrowLeft" :size="18" />
      </Button>
      <MessagingAvatar :person="person" :size="34" />
      <h2 class="conversation__name">{{ person.name }}</h2>
      <div class="conversation__menu">
        <Button color="ghost" size="compact" icon-only :aria-label="`More for ${firstName(person)}`" :aria-expanded="menuOpen" aria-haspopup="menu" @click="menuOpen = !menuOpen">
          <UiIcon name="Ellipsis" :size="18" />
        </Button>
        <div v-if="menuOpen" class="conversation__menu-list" role="menu">
          <button type="button" role="menuitem" :disabled="actionBusy || !person.handle" @click="toggleBlock">{{ blocked ? "Unblock" : "Block" }} {{ firstName(person) }}</button>
          <button type="button" role="menuitem" :disabled="actionBusy || !card" @click="openReport">Report {{ firstName(person) }}</button>
        </div>
      </div>
    </header>

    <div ref="list" class="conversation__list" @scroll.passive="onScroll">
      <p v-if="loading" class="conversation__note">Loading conversation…</p>
      <p v-else-if="loadingOlder" class="conversation__note">Loading earlier messages…</p>
      <p v-else-if="!rows.length && !errorMessage" class="conversation__note">Say hello to {{ firstName(person) }}.</p>
      <div v-for="row in rows" :key="row.id" class="conversation__row" :class="{ 'conversation__row--mine': row.mine }">
        <div class="conversation__bubble" :class="{ 'conversation__bubble--pending': row.pending }">
          <a v-for="image in row.images" :key="image" :href="image" target="_blank" rel="noopener noreferrer" class="conversation__image">
            <img :src="image" alt="Photo" loading="lazy" />
          </a>
          <p v-if="row.text" class="conversation__text">{{ row.text }}</p>
        </div>
        <span class="conversation__time">{{ messagingTimeLabel(row.time) }}<template v-if="row.id === seenId"> · Seen</template></span>
      </div>
    </div>

    <p v-if="errorMessage" class="conversation__error" role="alert">{{ errorMessage }}</p>
    <p v-if="blocked" class="conversation__note">You blocked {{ firstName(person) }}. Unblock them from the ⋯ menu to message again.</p>
    <form v-else class="conversation__composer" @submit.prevent="send">
      <input ref="fileInput" type="file" accept="image/*" hidden @change="sendPhoto" />
      <Button type="button" color="ghost" size="compact" icon-only aria-label="Send a photo" :disabled="sending || !channel" @click="fileInput?.click()">
        <UiIcon name="Image" :size="18" />
      </Button>
      <textarea
        v-model="draft"
        class="conversation__input"
        rows="1"
        :placeholder="`Message ${firstName(person)}`"
        :aria-label="`Message ${firstName(person)}`"
        :disabled="!channel"
        @keydown="composerKey"
      />
      <Button type="submit" color="primary" size="compact" icon-only aria-label="Send" :disabled="sending || !draft.trim() || !channel">
        <UiIcon name="ArrowUp" :size="18" />
      </Button>
    </form>

    <AppDialog :open="reportOpen" :aria-label="`Report ${person.name}`" close-on-backdrop @close="reportOpen = false">
      <div class="conversation__report">
        <h2>Report {{ firstName(person) }}</h2>
        <template v-if="reportSent">
          <p>Thanks. Soulink's team will look at it.</p>
          <Button color="primary" @click="reportOpen = false">Done</Button>
        </template>
        <template v-else>
          <fieldset>
            <legend>What's wrong?</legend>
            <label v-for="reason in REPORT_REASONS" :key="reason.value">
              <input v-model="reportReason" type="radio" name="report-reason" :value="reason.value" />
              {{ reason.label }}
            </label>
          </fieldset>
          <label class="conversation__report-details">
            Anything else (optional)
            <textarea v-model="reportDetails" rows="3" maxlength="2000" />
          </label>
          <div class="conversation__report-actions">
            <Button color="neutral" :disabled="actionBusy" @click="reportOpen = false">Cancel</Button>
            <Button color="danger" :disabled="actionBusy" @click="sendReport">{{ actionBusy ? "Sending…" : "Send report" }}</Button>
          </div>
        </template>
      </div>
    </AppDialog>
  </section>
</template>

<style scoped>
.conversation {
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  min-height: 0;
  height: 100%;
  background: var(--ui-bg);
}

.conversation__header {
  display: flex;
  gap: 10px;
  align-items: center;
  border-bottom: 1px solid var(--ui-border);
  padding: 10px 12px;
}

.conversation__name {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation__menu {
  position: relative;
}

.conversation__menu-list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 5;
  display: grid;
  min-width: 180px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: 6px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}

.conversation__menu-list button {
  border: 0;
  border-radius: 8px;
  padding: 10px 12px;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.conversation__menu-list button:hover {
  background: var(--ui-surface-muted);
}

.conversation__menu-list button:last-child {
  color: var(--ui-danger, #c0392b);
}

.conversation__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.conversation__row {
  display: grid;
  justify-items: start;
  gap: 2px;
}

.conversation__row--mine {
  justify-items: end;
}

.conversation__bubble {
  display: grid;
  gap: 6px;
  max-width: min(78%, 520px);
  border-radius: 18px;
  padding: 8px 12px;
  background: var(--ui-surface-muted);
  color: var(--ui-text);
}

.conversation__row--mine .conversation__bubble {
  background: var(--ui-accent);
  color: var(--ui-accent-contrast, #fff);
}

.conversation__bubble--pending {
  opacity: 0.6;
}

.conversation__text {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.conversation__image img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  border-radius: 12px;
  object-fit: cover;
}

.conversation__time {
  padding: 0 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.conversation__note {
  margin: 8px auto;
  color: var(--ui-text-muted);
  font-size: 14px;
  text-align: center;
}

.conversation__error {
  margin: 0;
  padding: 6px 16px;
  color: var(--ui-danger, #c0392b);
  font-size: 13px;
}

.conversation__composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  border-top: 1px solid var(--ui-border);
  padding: 10px 12px;
}

.conversation__input {
  flex: 1;
  min-height: 38px;
  max-height: 140px;
  border: 1px solid var(--ui-border);
  border-radius: 19px;
  padding: 8px 14px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 15px;
  resize: none;
}

.conversation__report {
  display: grid;
  gap: 14px;
  width: min(420px, 90vw);
  padding: 20px;
}

.conversation__report h2 {
  margin: 0;
  font-size: 18px;
}

.conversation__report fieldset {
  display: grid;
  gap: 8px;
  border: 0;
  margin: 0;
  padding: 0;
}

.conversation__report legend {
  margin-bottom: 6px;
  font-weight: 600;
}

.conversation__report-details {
  display: grid;
  gap: 6px;
  font-size: 14px;
}

.conversation__report-details textarea {
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  padding: 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
}

.conversation__report-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>

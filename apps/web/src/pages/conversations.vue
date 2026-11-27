<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { definePage } from "unplugin-vue-router/runtime";
import AppDialog from "../components/AppDialog.vue";
import AppPageBar from "../components/AppPageBar.vue";
import Button from "../components/Button.vue";
import UiIcon from "../components/UiIcon.vue";
import ConversationView from "../components/messaging/ConversationView.vue";
import MessagingAvatar from "../components/messaging/MessagingAvatar.vue";
import { useContactsStore } from "../stores/contacts";
import { useMessagingStore, type SoulinkNode } from "../stores/messaging";
import { messagingTimeLabel, type PersonMessageCard } from "../utils/messagingCards";

/**
 * Messages: every one-to-one conversation with people, newest first, beside the open one. New message offers your
 * ME3 contacts who are on Soulink, then the people you're linked with, then anyone you search for.
 */
definePage({
  meta: {
    requiresAuth: true,
  },
});

const route = useRoute();
const router = useRouter();
const messaging = useMessagingStore();
const contacts = useContactsStore();

const search = ref("");
const selected = computed(() => (typeof route.query.c === "string" ? route.query.c : null));
const conversations = computed(() => {
  const query = search.value.trim().toLowerCase();
  return [...messaging.cards]
    .sort((a, b) => b.latest.createdAt - a.latest.createdAt)
    .filter((card) => !query || card.person.name.toLowerCase().includes(query) || card.person.handle?.toLowerCase().includes(query));
});

if (messaging.status === "idle") void messaging.start();

function openConversation(cid: string | null) {
  void router.replace({ path: "/conversations", query: cid ? { c: cid } : {} });
}

function preview(card: PersonMessageCard): string {
  if (card.kind.type === "request") return `Wants to message you: ${card.latest.text}`;
  return card.latest.fromMe ? `You: ${card.latest.text}` : card.latest.text;
}

// New message
const newOpen = ref(false);
const peopleQuery = ref("");
const peopleLoading = ref(false);
const peopleError = ref("");
const closePeople = ref<SoulinkNode[]>([]);
const linkedPeople = ref<SoulinkNode[]>([]);
const searchResults = ref<SoulinkNode[]>([]);
const starting = ref<string | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

async function openNewMessage() {
  newOpen.value = true;
  peopleQuery.value = "";
  searchResults.value = [];
  peopleError.value = "";
  peopleLoading.value = true;
  try {
    if (!contacts.contacts.length) await contacts.fetchContacts().catch(() => undefined);
    const emails = contacts.contacts.map((contact) => contact.email).filter((email): email is string => Boolean(email));
    const [matched, linked] = await Promise.all([messaging.contactMatches(emails).catch(() => []), messaging.people()]);
    closePeople.value = uniquePeople(matched);
    const closeIds = new Set(closePeople.value.map((node) => node.id));
    linkedPeople.value = uniquePeople(linked).filter((node) => !closeIds.has(node.id));
  } catch (error) {
    peopleError.value = error instanceof Error && error.message ? error.message : "People couldn't load.";
  } finally {
    peopleLoading.value = false;
  }
}

function uniquePeople(nodes: SoulinkNode[]): SoulinkNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => (seen.has(node.id) ? false : (seen.add(node.id), true)));
}

watch(peopleQuery, (query) => {
  if (searchTimer) clearTimeout(searchTimer);
  if (!query.trim()) { searchResults.value = []; return; }
  searchTimer = setTimeout(async () => {
    try {
      searchResults.value = uniquePeople(await messaging.people(query));
    } catch {
      searchResults.value = [];
    }
  }, 250);
});

async function startWith(node: SoulinkNode) {
  starting.value = node.id;
  peopleError.value = "";
  try {
    const cid = await messaging.startConversation(node.id);
    newOpen.value = false;
    openConversation(cid);
  } catch (error) {
    peopleError.value = error instanceof Error && error.message ? error.message : "That conversation couldn't start.";
  } finally {
    starting.value = null;
  }
}

const peopleSections = computed(() =>
  peopleQuery.value.trim()
    ? [{ title: "On Soulink", people: searchResults.value }]
    : [
        { title: "Your contacts on Soulink", people: closePeople.value },
        { title: "People you're linked with", people: linkedPeople.value },
      ].filter((section) => section.people.length),
);
</script>

<template>
  <main class="messages-page" :class="{ 'messages-page--open': selected }">
    <AppPageBar title="Messages">
      <template #leading>
        <Button color="ghost" shape="soft" size="large" icon-only aria-label="New message" title="New message" :disabled="!messaging.ready" @click="openNewMessage">
          <UiIcon name="SquarePen" :size="20" />
        </Button>
      </template>
    </AppPageBar>

    <aside class="messages-page__list" aria-label="Conversations">
      <label class="messages-page__search">
        <UiIcon name="Search" :size="16" />
        <input v-model="search" type="search" placeholder="Search" aria-label="Search conversations" />
      </label>
      <p v-if="messaging.status === 'connecting' || messaging.status === 'idle'" class="messages-page__note">Loading messages…</p>
      <p v-else-if="messaging.status === 'unavailable'" class="messages-page__note">
        Messaging isn't available on this ME3 right now. Please try again later.
      </p>
      <p v-else-if="!conversations.length" class="messages-page__note">
        {{ search ? "No conversations match." : "No messages yet. Start one with New message." }}
      </p>
      <ul v-else class="messages-page__items">
        <li v-for="card in conversations" :key="card.cid">
          <button
            type="button"
            class="messages-page__item"
            :class="{ 'messages-page__item--active': card.cid === selected, 'messages-page__item--unread': card.unreadCount > 0 || card.kind.type === 'request' }"
            :aria-current="card.cid === selected ? 'true' : undefined"
            @click="openConversation(card.cid)"
          >
            <MessagingAvatar :person="card.person" :size="44" />
            <span class="messages-page__item-body">
              <span class="messages-page__item-title">
                <span class="messages-page__item-name">{{ card.person.name }}</span>
                <span class="messages-page__item-time">{{ messagingTimeLabel(card.latest.createdAt) }}</span>
              </span>
              <span class="messages-page__item-preview">{{ preview(card) }}</span>
            </span>
            <span v-if="card.unreadCount > 0" class="messages-page__item-count">{{ card.unreadCount }}</span>
          </button>
        </li>
      </ul>
    </aside>

    <section class="messages-page__pane">
      <ConversationView v-if="selected" :key="selected" :cid="selected" @back="openConversation(null)" />
      <div v-else class="messages-page__empty">
        <UiIcon name="MessageCircle" :size="32" />
        <p>Choose a conversation, or start a new one.</p>
      </div>
    </section>

    <AppDialog :open="newOpen" aria-label="New message" close-on-backdrop @close="newOpen = false">
      <div class="new-message">
        <header class="new-message__header">
          <h2>New message</h2>
          <Button color="ghost" size="compact" icon-only aria-label="Close" @click="newOpen = false"><UiIcon name="X" :size="18" /></Button>
        </header>
        <label class="messages-page__search">
          <UiIcon name="Search" :size="16" />
          <input v-model="peopleQuery" type="search" placeholder="Search people on Soulink" aria-label="Search people on Soulink" />
        </label>
        <p v-if="peopleLoading" class="messages-page__note">Loading people…</p>
        <p v-if="peopleError" class="messages-page__note messages-page__note--error" role="alert">{{ peopleError }}</p>
        <section v-for="section in peopleSections" :key="section.title" class="new-message__section">
          <h3>{{ section.title }}</h3>
          <button
            v-for="node in section.people"
            :key="node.id"
            type="button"
            class="messages-page__item"
            :disabled="starting !== null"
            @click="startWith(node)"
          >
            <MessagingAvatar :person="{ name: node.displayName, imageUrl: node.avatarUrl }" :size="36" />
            <span class="messages-page__item-body">
              <span class="messages-page__item-name">{{ node.displayName }}</span>
              <span class="messages-page__item-preview">@{{ node.handle }}</span>
            </span>
            <span v-if="starting === node.id" class="messages-page__item-time">Opening…</span>
          </button>
        </section>
        <p v-if="!peopleLoading && peopleQuery.trim() && !searchResults.length" class="messages-page__note">Nobody on Soulink matches that yet.</p>
      </div>
    </AppDialog>
  </main>
</template>

<style scoped>
.messages-page {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  height: calc(100dvh - var(--app-topbar-height, 64px));
  min-height: 0;
  background: var(--ui-bg);
  color: var(--ui-text);
}

.messages-page__list {
  display: grid;
  grid-template-rows: auto 1fr;
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--ui-border);
  padding: 12px;
}

.messages-page__search {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  border-radius: 12px;
  padding: 8px 12px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
}

.messages-page__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 15px;
}

.messages-page__search input:focus {
  outline: none;
}

.messages-page__items {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.messages-page__item {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  border: 0;
  border-radius: 12px;
  padding: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.messages-page__item:hover,
.messages-page__item--active {
  background: var(--ui-surface-muted);
}

.messages-page__item-body {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.messages-page__item-title {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: baseline;
}

.messages-page__item-name {
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.messages-page__item-time {
  flex: none;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.messages-page__item-preview {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.messages-page__item--unread .messages-page__item-preview {
  color: var(--ui-text);
  font-weight: 500;
}

.messages-page__item-count {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  padding: 0 6px;
  background: var(--ui-accent);
  color: var(--ui-accent-contrast, #fff);
  font-size: 12px;
  font-weight: 700;
}

.messages-page__pane {
  min-width: 0;
  min-height: 0;
}

.messages-page__empty {
  display: grid;
  height: 100%;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
}

.messages-page__note {
  margin: 12px 4px;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.messages-page__note--error {
  color: var(--ui-danger, #c0392b);
}

.new-message {
  display: grid;
  gap: 10px;
  width: min(440px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  padding: 16px;
}

.new-message__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.new-message__header h2 {
  margin: 0;
  font-size: 18px;
}

.new-message__section h3 {
  margin: 8px 4px 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

/* On a phone-width screen one pane at a time: the list, or the open conversation. */
@media (max-width: 760px) {
  .messages-page {
    grid-template-columns: 1fr;
  }

  .messages-page--open .messages-page__list {
    display: none;
  }

  .messages-page:not(.messages-page--open) .messages-page__pane {
    display: none;
  }

  .messages-page__list {
    border-right: 0;
  }
}

@media (min-width: 761px) {
  .messages-page :deep(.conversation__back) {
    display: none;
  }
}
</style>

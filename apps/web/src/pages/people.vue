<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute, useRouter } from "vue-router";
import UiIcon from "../components/UiIcon.vue";
import AddSomeoneSheet from "../components/people/AddSomeoneSheet.vue";
import NewPersonSheet from "../components/people/NewPersonSheet.vue";
import PersonAvatar from "../components/people/PersonAvatar.vue";
import PersonSheet from "../components/people/PersonSheet.vue";
import { ApiError, api } from "../api";
import { useAppToast } from "../composables/useAppToast";
import { useContactsStore, type Contact } from "../stores/contacts";
import {
  comparePeopleByName,
  firstName,
  formatSinceShort,
  indexLetter,
  personDetail,
} from "../utils/people";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "People | ME3",
    description: "The people in your life, and who you've not been in touch with lately.",
    robots: "noindex,follow",
  },
});

type Filter = "all" | "close" | "clients";

const route = useRoute();
const router = useRouter();
const contactsStore = useContactsStore();
const { contacts, loading } = storeToRefs(contactsStore);
const { toastSuccess } = useAppToast();

const loaded = ref(contacts.value.length > 0);
const filter = ref<Filter>("all");
const query = ref("");
const addOpen = ref(false);
const newPersonOpen = ref(false);
const soulinkConnected = ref<boolean | null>(null);
const pullEl = ref<HTMLElement | null>(null);
const headEl = ref<HTMLElement | null>(null);
const pullProgress = ref(0);
const now = ref(Date.now());

const people = computed(() => contacts.value.filter((contact) => contact.status !== "archived"));
const hasClients = computed(() => people.value.some((contact) => contact.isClient));
const filters = computed<Array<{ id: Filter; label: string }>>(() => [
  { id: "all", label: "All" },
  { id: "close", label: "Close" },
  ...(hasClients.value ? [{ id: "clients" as const, label: "Clients" }] : []),
]);

const term = computed(() => query.value.trim().toLowerCase());
const visible = computed(() => {
  const list = people.value.filter((contact) => {
    if (filter.value === "close" && !contact.isClose) return false;
    if (filter.value === "clients" && !contact.isClient) return false;
    if (!term.value) return true;
    return [contact.name, contact.email, contact.phone, personDetail(contact)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term.value);
  });
  if (filter.value === "close") {
    // Longest since last in touch first; never in touch counts as longest.
    const last = (contact: Contact) =>
      contact.lastInTouchAt ? Date.parse(contact.lastInTouchAt) : Number.NEGATIVE_INFINITY;
    return list.sort((a, b) => last(a) - last(b) || comparePeopleByName(a, b));
  }
  return list.sort(comparePeopleByName);
});
const showIndex = computed(() => filter.value === "all" && !term.value && visible.value.length > 12);
const letters = computed(() => Array.from(new Set(visible.value.map((contact) => indexLetter(contact.name)))));
const firstOfLetter = computed(() => {
  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const contact of visible.value) {
    const letter = indexLetter(contact.name);
    if (!seen.has(letter)) {
      seen.add(letter);
      ids.add(contact.id);
    }
  }
  return ids;
});

const openId = computed(() => (typeof route.query.person === "string" ? route.query.person : null));
const openContact = computed(() => people.value.find((contact) => contact.id === openId.value) || null);

function sinceLabel(contact: Contact): string {
  return formatSinceShort(contact.lastInTouchAt, now.value) || "Not yet";
}

function openPerson(contact: Contact) {
  void router.replace({ query: { ...route.query, person: contact.id } });
}

function closePerson() {
  const { person: _person, ...rest } = route.query;
  void router.replace({ query: rest });
}

function jumpTo(letter: string) {
  const target = visible.value.find((contact) => indexLetter(contact.name) === letter);
  if (!target) return;
  document.getElementById(`person-row-${target.id}`)?.scrollIntoView({ block: "start" });
}

function addByHand() {
  addOpen.value = false;
  newPersonOpen.value = true;
}

function onAdded(contact: Contact, created: boolean) {
  newPersonOpen.value = false;
  if (created) toastSuccess(`Added ${firstName(contact.name)}`);
  openPerson(contact);
}

async function syncSoulink() {
  try {
    const status = await api.get<{ connection: { status: string } | null }>("/soulink/status");
    soulinkConnected.value = status.connection?.status === "active";
  } catch {
    soulinkConnected.value = false;
  }
  if (!soulinkConnected.value) return;
  try {
    await api.post("/soulink/contacts/sync");
    await contactsStore.fetchContacts();
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) soulinkConnected.value = false;
  }
}

// Search sits above the filters. On phones it starts scrolled out of view and
// fades in as the list is pulled down, like iOS .searchable; at desktop width
// it is always visible.
const compactTouch =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 767px) and (pointer: coarse)")
    : null;

function updatePullProgress() {
  const pull = pullEl.value;
  const head = headEl.value;
  if (!pull || !head || !compactTouch?.matches) {
    pullProgress.value = 0;
    return;
  }
  const hidden = head.getBoundingClientRect().bottom - pull.getBoundingClientRect().top;
  pullProgress.value = Math.min(1, Math.max(0, hidden / pull.offsetHeight));
}

async function tuckSearchAway() {
  if (!compactTouch?.matches || query.value) return;
  await nextTick();
  const pull = pullEl.value;
  if (!pull) return;
  window.scrollTo({ top: pull.offsetHeight, behavior: "instant" as ScrollBehavior });
  updatePullProgress();
}

onMounted(async () => {
  window.addEventListener("scroll", updatePullProgress, { passive: true });
  await contactsStore.fetchContacts();
  loaded.value = true;
  void tuckSearchAway();
  void syncSoulink();
});

onBeforeUnmount(() => window.removeEventListener("scroll", updatePullProgress));

watch(hasClients, (value) => {
  if (!value && filter.value === "clients") filter.value = "all";
});
watch(filter, () => { now.value = Date.now(); });
</script>

<template>
  <main class="people-page">
    <header ref="headEl" class="people-head">
      <h1>People</h1>
      <button type="button" class="people-add" aria-label="Add someone" title="Add someone" @click="addOpen = true">
        <UiIcon name="Plus" :size="26" aria-hidden="true" />
      </button>
    </header>

    <div
      ref="pullEl"
      class="people-pull"
      :style="{ opacity: 1 - pullProgress, transform: `scale(${1 - pullProgress * 0.04})` }"
    >
      <label class="people-search">
        <UiIcon name="Search" :size="18" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="Search" aria-label="Search people" />
      </label>
    </div>

    <div class="people-filters" role="group" aria-label="Show">
      <button
        v-for="option in filters"
        :key="option.id"
        type="button"
        class="people-chip"
        :class="{ 'people-chip--on': filter === option.id }"
        :aria-pressed="filter === option.id"
        @click="filter = option.id"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="people-body" :class="{ 'people-body--indexed': showIndex }">
      <nav v-if="showIndex" class="people-index" aria-label="Jump to letter">
        <button
          v-for="letter in letters"
          :key="letter"
          type="button"
          :aria-label="`Jump to ${letter}`"
          @click="jumpTo(letter)"
        >
          {{ letter }}
        </button>
      </nav>

      <p v-if="loading && !loaded" class="people-empty" aria-live="polite">Loading…</p>
      <ul v-else-if="visible.length" class="people-list">
        <li v-for="contact in visible" :key="contact.id">
          <button
            :id="firstOfLetter.has(contact.id) ? `person-row-${contact.id}` : undefined"
            type="button"
            class="person-row"
            @click="openPerson(contact)"
          >
            <PersonAvatar :contact="contact" />
            <span class="person-row__name">{{ contact.name }}</span>
            <span v-if="filter === 'all' && contact.isClose" class="person-row__star" title="Close">
              <UiIcon name="Star" :size="15" aria-hidden="true" />
              <span class="visually-hidden">Close</span>
            </span>
            <span v-else-if="filter !== 'all'" class="person-row__since">{{ sinceLabel(contact) }}</span>
          </button>
        </li>
      </ul>
      <div v-else class="people-empty">
        <template v-if="term">No one called “{{ query.trim() }}”.</template>
        <template v-else-if="filter === 'close'">
          <p>No one is Close yet.</p>
          <p class="people-empty__sub">Open someone and tap the star. ME3 will bring them up when it’s been a while.</p>
        </template>
        <template v-else>
          <p>No one here yet.</p>
          <p class="people-empty__sub">
            Tap + to add someone.
            <template v-if="soulinkConnected === false">
              Or <router-link to="/account?section=app-connections">connect Soulink</router-link> to bring in your Links.
            </template>
          </p>
        </template>
      </div>
    </div>

    <PersonSheet :contact="openContact" @close="closePerson" />
    <AddSomeoneSheet :open="addOpen" @close="addOpen = false" @add-by-hand="addByHand" />
    <NewPersonSheet :open="newPersonOpen" @close="newPersonOpen = false" @saved="onAdded" />
  </main>
</template>

<style scoped>
.people-page {
  --people-head-height: 56px;
  --people-top: var(--app-topbar-height, 60px);
  box-sizing: border-box;
  width: 100%;
  max-width: 640px;
  min-height: calc(100dvh + 72px);
  margin: 0 auto;
  padding: 0 16px 48px;
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text);
}

.people-head {
  position: sticky;
  top: var(--people-top);
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--people-head-height);
  background: var(--ui-bg, var(--color-bg));
}

.people-head h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: -0.02em;
}

.people-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  cursor: pointer;
}

.people-pull {
  padding-bottom: 10px;
  transform-origin: 50% 100%;
}

.people-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 14px;
  border-radius: 14px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
}

.people-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 16px;
}

.people-search:focus-within {
  box-shadow: 0 0 0 2px var(--ui-accent);
}

.people-filters {
  position: sticky;
  top: calc(var(--people-top) + var(--people-head-height));
  z-index: 3;
  display: flex;
  gap: 6px;
  padding-bottom: 8px;
  background: var(--ui-bg, var(--color-bg));
}

.people-chip {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.people-chip--on {
  background: var(--ui-primary);
  color: var(--ui-primary-contrast);
}

.people-body--indexed {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  column-gap: 4px;
  margin-left: -10px;
}

.people-index {
  position: sticky;
  top: calc(var(--people-top) + var(--people-head-height) + 52px);
  z-index: 2;
  align-self: start;
  display: flex;
  flex-direction: column;
  padding: 6px 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.people-index button {
  width: 22px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-accent);
  font: inherit;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
}

.people-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.person-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  height: 56px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 16px;
  text-align: left;
  cursor: pointer;
  scroll-margin-top: calc(var(--people-top) + var(--people-head-height) + 52px);
}

.person-row:focus-visible,
.people-chip:focus-visible,
.people-add:focus-visible,
.people-index button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
  border-radius: 8px;
}

.person-row__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.person-row__star,
.person-row__since {
  margin-left: auto;
  flex-shrink: 0;
}

.person-row__star {
  display: flex;
  color: var(--ui-accent);
}

.person-row__star :deep(svg) {
  fill: currentColor;
}

.person-row__since {
  color: var(--ui-text-muted);
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}

.people-empty {
  padding: 24px 0;
  color: var(--ui-text-muted);
  font-size: 15px;
}

.people-empty p {
  margin: 0 0 4px;
}

.people-empty__sub {
  font-size: 14px;
}

@media (hover: hover) {
  .person-row:hover .person-row__name {
    text-decoration: underline;
    text-decoration-color: var(--ui-border-strong);
    text-underline-offset: 3px;
  }
}
</style>

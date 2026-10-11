<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { definePage } from "unplugin-vue-router/runtime";
import { useRouter } from "vue-router";
import Button from "../components/Button.vue";
import ContactsPanel from "../components/ContactsPanel.vue";
import UiIcon from "../components/UiIcon.vue";
import WorkspaceTabs from "../components/WorkspaceTabs.vue";
import { useMailboxCacheStore } from "../stores/mailbox";
import type { UiIconName } from "../utils/icons";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "Contacts | ME3",
    description: "Review and manage your ME3 contacts.",
    robots: "noindex,follow",
  },
});

const contactsPanel = ref<InstanceType<typeof ContactsPanel> | null>(null);
const contactSearchQuery = ref("");
const router = useRouter();
const mailbox = useMailboxCacheStore();
const { folderCounts } = storeToRefs(mailbox);

const contactMailboxTabs = computed<Array<{
  id: string;
  label: string;
  icon: UiIconName;
  count?: number | null;
}>>(() => [
  { id: "campaigns", label: "Campaigns", icon: "Send" },
  {
    id: "inbox",
    label: "Inbox",
    icon: "Inbox",
    count: folderCounts.value.inbox || null,
  },
  {
    id: "drafts",
    label: "Drafts",
    icon: "FileText",
    count: folderCounts.value.drafts || null,
  },
  { id: "sent", label: "Sent", icon: "Send" },
  { id: "archive", label: "Archive", icon: "Archive" },
  { id: "trash", label: "Trash", icon: "Trash2" },
  { id: "contacts", label: "Contacts", icon: "UsersRound" },
]);

function openContactModal() {
  contactsPanel.value?.openContactModal();
}

function switchContactMailboxTab(tabId: string) {
  if (tabId === "contacts") return;
  if (tabId === "campaigns") {
    void router.push("/email/campaigns");
    return;
  }
  void router.push({
    path: "/email",
    query: tabId === "inbox" ? {} : { tab: tabId },
  });
}

onMounted(() => {
  void mailbox.loadFolderCounts();
});
</script>

<template>
  <main class="agent-page contacts-page">
    <Teleport to="#app-page-controls" defer>
      <form class="contacts-mobile-nav" role="search" @submit.prevent>
        <label class="contacts-mobile-nav__label" for="contacts-search-input-top">
          Search contacts
        </label>
        <input
          id="contacts-search-input-top"
          v-model="contactSearchQuery"
          class="contacts-mobile-nav__input"
          type="search"
          placeholder="Search contacts"
        />
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          class="contacts-mobile-nav__icon-btn"
          type="submit"
          aria-label="Search contacts"
          title="Search"
        >
          <UiIcon name="Search" :size="18" aria-hidden="true" />
        </Button>
        <Button
          color="outline"
          shape="soft"
          size="compact"
          class="contacts-mobile-nav__add-btn"
          type="button"
          aria-label="Add contact"
          @click="openContactModal"
        >
          <template #icon>
            <UiIcon name="Plus" :size="16" aria-hidden="true" />
          </template>
          Add contact
        </Button>
      </form>
    </Teleport>

    <div class="contacts-mail-tabs">
      <WorkspaceTabs
        :tabs="contactMailboxTabs"
        model-value="contacts"
        aria-label="Mailbox folders"
        @change="switchContactMailboxTab"
      />
    </div>

    <ContactsPanel
      ref="contactsPanel"
      v-model:search-query="contactSearchQuery"
      :show-header="false"
    />
  </main>
</template>

<style scoped>
.contacts-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: var(--ui-bg, var(--color-bg));
}

.contacts-mail-tabs {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-bg, var(--color-bg));
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scroll-padding-inline: 8px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.contacts-mail-tabs::-webkit-scrollbar {
  display: none;
}

@media (min-width: 768px) {
  .contacts-mail-tabs {
    justify-content: center;
  }
}

.contacts-mobile-nav {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px auto;
  gap: 10px;
  width: 100%;
  align-items: center;
}

.contacts-mobile-nav__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.contacts-mobile-nav__input {
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
}

.contacts-mobile-nav__input:focus {
  outline: 2px solid var(--ui-text, var(--color-text));
  outline-offset: 1px;
}

.contacts-mobile-nav__icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
}

.contacts-mobile-nav__add-btn {
  gap: 6px;
  min-height: 36px;
  padding-inline: 10px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--ui-surface, var(--color-bg));
  border-color: var(--ui-border, var(--color-border));
  color: var(--ui-text, var(--color-text));
}

.contacts-mobile-nav__add-btn:hover:not(:disabled),
.contacts-mobile-nav__add-btn:focus-visible {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  border-color: var(--ui-border, var(--color-border));
  color: var(--ui-text, var(--color-text));
}
</style>

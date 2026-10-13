<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import Button from "./Button.vue";
import UiIcon from "./UiIcon.vue";
import { ApiError, api } from "../api";
import { useAppToast } from "../composables/useAppToast";
import { useContactsStore, type Contact } from "../stores/contacts";

type SoulinkStatusResponse = {
  available: boolean;
  configured: boolean;
  connection: {
    status: "pending" | "active" | "disconnected";
  } | null;
  recentEvents: unknown[];
};

const props = withDefaults(
  defineProps<{
    showHeader?: boolean;
    showEmailAction?: boolean;
    searchQuery?: string;
  }>(),
  {
    showHeader: true,
    showEmailAction: false,
    searchQuery: undefined,
  },
);

const emit = defineEmits<{
  emailContact: [contact: Contact];
  "update:searchQuery": [value: string];
}>();

const { toastSuccess } = useAppToast();
const contactsStore = useContactsStore();
const { contacts } = storeToRefs(contactsStore);

const contactsLoaded = ref(false);
const contactModalOpen = ref(false);
const contactSaving = ref(false);
const editingContact = ref<Contact | null>(null);
const contactError = ref("");
const internalContactSearchQuery = ref("");
const contactForm = ref({
  name: "",
  email: "",
});
const soulinkSyncing = ref(false);
const soulinkSyncError = ref("");
const soulinkSyncNotice = ref("");
const soulinkContactsConnected = ref(false);
const failedContactAvatarUrls = ref(new Set<string>());

const contactSearchQuery = computed({
  get: () => props.searchQuery ?? internalContactSearchQuery.value,
  set: (value: string) => {
    if (props.searchQuery === undefined) {
      internalContactSearchQuery.value = value;
    }
    emit("update:searchQuery", value);
  },
});

const contactSearchTerm = computed(() => contactSearchQuery.value.trim().toLowerCase());

const activeContacts = computed(() =>
  [...contacts.value]
    .filter((contact) => contact.status !== "archived")
    .sort((a, b) => {
      const aTime =
        a.metadata?.soulinkLastActiveAt ||
        a.lastInteractionAt ||
        a.updatedAt ||
        a.createdAt;
      const bTime =
        b.metadata?.soulinkLastActiveAt ||
        b.lastInteractionAt ||
        b.updatedAt ||
        b.createdAt;
      return bTime.localeCompare(aTime);
    }),
);

const visibleContacts = computed(() => {
  const term = contactSearchTerm.value;
  if (!term) return activeContacts.value;
  return activeContacts.value.filter((contact) =>
    searchableContactText(contact).includes(term),
  );
});

const canSyncSoulinkContacts = computed(() => soulinkContactsConnected.value);

function searchableContactText(contact: Contact): string {
  return [
    contact.name,
    contact.email,
    contact.phone,
    contact.relationship,
    contact.source,
    contact.notes,
    contact.metadata?.soulinkContextLabel,
    contact.metadata?.soulinkSourceChatTitle,
    contact.metadata?.soulinkOrigin,
    Object.values(contact.socialHandles).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function loadContactsPage(options: { syncSoulink?: boolean } = {}) {
  contactError.value = "";
  soulinkSyncError.value = "";
  soulinkSyncNotice.value = "";
  await Promise.all([contactsStore.fetchContacts(), loadSoulinkContactsStatus()]);
  contactsLoaded.value = true;
  if (options.syncSoulink && soulinkContactsConnected.value) {
    await syncSoulinkContacts();
  }
}

async function loadSoulinkContactsStatus() {
  try {
    const response = await api.get<SoulinkStatusResponse>("/soulink/status");
    soulinkContactsConnected.value = response.connection?.status === "active";
  } catch {
    soulinkContactsConnected.value = false;
  }
}

async function syncSoulinkContacts() {
  if (soulinkSyncing.value) return;
  if (!soulinkContactsConnected.value) {
    await loadSoulinkContactsStatus();
  }
  if (!soulinkContactsConnected.value) {
    soulinkSyncError.value = "";
    soulinkSyncNotice.value = "";
    return;
  }
  soulinkSyncing.value = true;
  soulinkSyncError.value = "";
  soulinkSyncNotice.value = "";
  try {
    const response = await api.post<{
      ok: boolean;
      synced: number;
      created: number;
      updated: number;
      skipped: number;
    }>("/soulink/contacts/sync");
    await contactsStore.fetchContacts();
    soulinkSyncNotice.value =
      response.synced > 0
        ? `Synced ${response.synced} Soulink contact${
            response.synced === 1 ? "" : "s"
          }.`
        : "Soulink contacts are up to date.";
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      soulinkContactsConnected.value = false;
      soulinkSyncError.value = "";
      soulinkSyncNotice.value = "";
      return;
    }
    soulinkSyncError.value =
      err instanceof Error ? err.message : "Failed to sync Soulink contacts";
  } finally {
    soulinkSyncing.value = false;
  }
}

function openContactModal() {
  editingContact.value = null;
  contactForm.value = { name: "", email: "" };
  contactError.value = "";
  contactModalOpen.value = true;
  void nextTick(() => {
    document.getElementById("contact-name")?.focus();
  });
}

function openEditContactModal(contact: Contact) {
  editingContact.value = contact;
  contactForm.value = {
    name: contact.name || "",
    email: contact.email || "",
  };
  contactError.value = "";
  contactModalOpen.value = true;
  void nextTick(() => {
    document.getElementById("contact-name")?.focus();
  });
}

function closeContactModal() {
  if (contactSaving.value) return;
  contactModalOpen.value = false;
}

async function saveManualContact() {
  if (contactSaving.value) return;
  contactSaving.value = true;
  contactError.value = "";
  try {
    const currentContact = editingContact.value;
    const contact = currentContact
      ? await contactsStore.updateContact(currentContact.id, {
          name: contactForm.value.name,
          email: contactForm.value.email,
        })
      : await contactsStore.createContact({
          name: contactForm.value.name,
          email: contactForm.value.email,
          source: "manual",
          relationship: "contact",
          status: "active",
        });
    if (!contact) {
      contactError.value =
        contactsStore.error ||
        (currentContact ? "Failed to update contact" : "Failed to add contact");
      return;
    }
    contactModalOpen.value = false;
    editingContact.value = null;
    toastSuccess(currentContact ? "Contact updated." : "Contact added.");
  } finally {
    contactSaving.value = false;
  }
}

function contactAvatarUrl(contact: Contact): string | null {
  const avatar = contact.metadata?.avatarUrl;
  const url = typeof avatar === "string" && avatar.trim() ? avatar.trim() : null;
  return url && !failedContactAvatarUrls.value.has(url) ? url : null;
}

function handleContactAvatarError(contact: Contact) {
  const avatar = contact.metadata?.avatarUrl;
  const url = typeof avatar === "string" ? avatar.trim() : "";
  if (!url) return;
  failedContactAvatarUrls.value = new Set(failedContactAvatarUrls.value).add(url);
}

function contactHasSoulink(contact: Contact): boolean {
  return (
    contact.source === "soulink" ||
    Boolean(contact.metadata?.soulinkNodeId || contact.metadata?.soulinkLinkId)
  );
}

function contactSoulinkUrl(contact: Contact): string | null {
  const url = contact.metadata?.soulinkChatUrl || contact.metadata?.soulinkOrigin;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function contactMetaLine(contact: Contact): string {
  if (contact.email) return contact.email;
  if (contactHasSoulink(contact)) return "";
  return "No email yet";
}

function emailContact(contact: Contact) {
  if (!contact.email) return;
  emit("emailContact", contact);
}

onMounted(() => {
  void loadContactsPage({ syncSoulink: true });
});

defineExpose({
  openContactModal,
});
</script>

<template>
  <section class="contacts-panel" aria-label="Contacts">
    <header v-if="props.showHeader" class="contacts-panel__header">
      <form class="contacts-search" role="search" @submit.prevent>
        <label class="contacts-search__label" for="contacts-search-input">
          Search contacts
        </label>
        <UiIcon name="Search" :size="17" aria-hidden="true" />
        <input
          id="contacts-search-input"
          v-model="contactSearchQuery"
          class="contacts-search__input"
          type="search"
          placeholder="Search contacts"
          :disabled="contactsStore.loading"
        />
      </form>
      <div class="contacts-panel__actions">
        <Button
          v-if="canSyncSoulinkContacts"
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          type="button"
          :disabled="soulinkSyncing"
          aria-label="Sync Soulink contacts"
          title="Sync Soulink contacts"
          @click="syncSoulinkContacts"
        >
          <UiIcon name="RefreshCw" :size="18" aria-hidden="true" />
        </Button>
        <Button
          color="outline"
          shape="soft"
          size="compact"
          type="button"
          aria-label="Add contact"
          @click="openContactModal"
        >
          <template #icon>
            <UiIcon name="Plus" :size="16" aria-hidden="true" />
          </template>
          Add
        </Button>
      </div>
    </header>

    <div v-if="!soulinkContactsConnected" class="contacts-sync-note">
      You can sync your Soulink contacts here by connecting to Soulink in
      <router-link
        to="/account?section=app-connections"
        class="empty-hint-link"
      >
        Settings
      </router-link>
    </div>
    <div
      v-else-if="soulinkSyncError"
      class="contacts-sync-note contacts-sync-note--error"
    >
      {{ soulinkSyncError }}
    </div>
    <div v-else-if="soulinkSyncNotice" class="contacts-sync-note">
      {{ soulinkSyncNotice }}
    </div>

    <div
      v-if="contactsStore.loading && !contactsLoaded"
      class="conversation-loading"
      aria-live="polite"
    >
      Loading contacts...
    </div>
    <div v-else-if="visibleContacts.length" class="contacts-list">
      <article
        v-for="contact in visibleContacts"
        :key="contact.id"
        class="contact-row"
      >
        <div class="contact-avatar">
          <img
            v-if="contactAvatarUrl(contact)"
            :src="contactAvatarUrl(contact) || ''"
            alt=""
            @error="handleContactAvatarError(contact)"
          />
          <UiIcon v-else name="UserRound" :size="20" aria-hidden="true" />
        </div>
        <div class="contact-row__body">
          <div class="contact-row__title">
            <strong>{{ contact.name }}</strong>
            <span v-if="contactHasSoulink(contact)" class="contact-source-pill">
              Soulink
            </span>
          </div>
          <p v-if="contactMetaLine(contact)">{{ contactMetaLine(contact) }}</p>
        </div>
        <div class="contact-row__actions">
          <button
            class="contacts-icon-btn"
            type="button"
            :title="`Edit ${contact.name}`"
            :aria-label="`Edit ${contact.name}`"
            @click="openEditContactModal(contact)"
          >
            <UiIcon name="Pencil" :size="16" aria-hidden="true" />
          </button>
          <Button
            v-if="props.showEmailAction"
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            :disabled="!contact.email"
            :title="contact.email ? `Email ${contact.name}` : 'No email yet'"
            :aria-label="contact.email ? `Email ${contact.name}` : 'No email yet'"
            @click="emailContact(contact)"
          >
            <UiIcon name="Mail" :size="16" aria-hidden="true" />
          </Button>
          <a
            v-if="contactSoulinkUrl(contact)"
            class="contacts-icon-btn contacts-icon-link"
            :href="contactSoulinkUrl(contact) || undefined"
            target="_blank"
            rel="noopener noreferrer"
            :title="`Message ${contact.name} in Soulink`"
            :aria-label="`Message ${contact.name} in Soulink`"
          >
            <UiIcon name="MessageCircle" :size="16" aria-hidden="true" />
          </a>
        </div>
      </article>
    </div>
    <div v-else class="empty-state empty-state--inline">
      <div class="empty-state__stack">
        <p>
          {{
            contactSearchTerm
              ? "No contacts match that search."
              : "No contacts yet."
          }}
        </p>
        <p class="empty-state__sub">
          {{
            contactSearchTerm
              ? "Try a name, email, tag, or Soulink detail."
              : "Add one manually or sync Links from Soulink."
          }}
        </p>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="contactModalOpen"
      class="modal-backdrop"
      role="presentation"
      @click.self="closeContactModal"
    >
      <form class="contact-modal__card" @submit.prevent="saveManualContact">
        <div class="compose-modal__head">
          <h2>{{ editingContact ? "Edit contact" : "Add contact" }}</h2>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            :disabled="contactSaving"
            aria-label="Close"
            @click="closeContactModal"
          >
            <UiIcon name="X" :size="18" aria-hidden="true" />
          </Button>
        </div>
        <label class="compose-field">
          <span>Name</span>
          <input
            id="contact-name"
            v-model="contactForm.name"
            type="text"
            autocomplete="name"
            required
          />
        </label>
        <label class="compose-field">
          <span>Email</span>
          <input
            v-model="contactForm.email"
            type="email"
            autocomplete="email"
            required
          />
        </label>
        <p v-if="contactError" class="compose-error">{{ contactError }}</p>
        <div class="compose-modal__actions">
          <Button
            color="ghost"
            shape="soft"
            type="button"
            :disabled="contactSaving"
            @click="closeContactModal"
          >
            Cancel
          </Button>
          <Button
            color="primary"
            shape="soft"
            type="submit"
            :disabled="
              contactSaving ||
              !contactForm.name.trim() ||
              !contactForm.email.trim()
            "
          >
            {{
              contactSaving
                ? editingContact
                  ? "Saving..."
                  : "Adding..."
                : editingContact
                  ? "Save contact"
                  : "Add contact"
            }}
          </Button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.contacts-panel {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-bg, var(--color-bg));
}

.contacts-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--workspace-topbar-height, 52px);
  padding: 8px 16px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.contacts-search {
  display: inline-flex;
  flex: 1 1 320px;
  align-items: center;
  gap: 8px;
  max-width: 460px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.contacts-search__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.contacts-search__input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
}

.contacts-panel__actions,
.contact-row__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.contacts-sync-note {
  padding: 9px 16px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.contacts-sync-note--error {
  color: #b33b2e;
}

.contacts-list {
  min-height: 0;
  overflow-y: auto;
}

.contact-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.contact-avatar {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 999px;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
  font-weight: 800;
}

.contact-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.contact-row__body {
  min-width: 0;
}

.contact-row__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.contact-row__title strong,
.contact-row__body p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-row__title strong {
  font-size: 14px;
}

.contact-row__body p {
  margin: 3px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.contact-source-pill {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(
    --ui-accent-soft,
    color-mix(in srgb, var(--color-accent) 14%, transparent)
  );
  color: var(--ui-accent-strong, var(--color-accent));
  font-size: 11px;
  font-weight: 800;
}

.contacts-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  cursor: pointer;
}

.contacts-icon-link {
  text-decoration: none;
}

.contacts-icon-btn:hover:not(:disabled) {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  border-color: var(--ui-border-strong, var(--color-text));
}

.contacts-icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.conversation-loading {
  display: grid;
  min-height: 280px;
  place-items: center;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 14px;
}

.empty-state {
  display: grid;
  min-height: 280px;
  place-items: center;
  padding: 24px;
  color: var(--ui-text-muted, var(--color-text-muted));
  text-align: center;
}

.empty-state__stack p {
  margin: 0;
}

.empty-state__sub {
  margin-top: 8px;
  font-size: 13px;
}

.empty-hint-link {
  color: var(--ui-text, var(--color-text));
  font-weight: 700;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, #000 42%, transparent);
}

.contact-modal__card {
  width: min(420px, 100%);
  padding: 18px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 8px);
  background: var(--ui-bg, var(--color-bg));
  box-shadow: var(--ui-shadow-lg, 0 18px 48px rgb(0 0 0 / 18%));
}

.compose-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.compose-modal__head h2 {
  margin: 0;
  font-size: 18px;
}

.compose-field {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  font-weight: 700;
}

.compose-field input {
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
}

.compose-error {
  margin: 12px 0 0;
  color: #b33b2e;
  font-size: 13px;
}

.compose-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

@media (max-width: 640px) {
  .contacts-panel__header {
    align-items: stretch;
    flex-direction: column;
  }

  .contacts-search {
    max-width: none;
  }

  .contacts-panel__actions {
    justify-content: flex-end;
  }
}
</style>

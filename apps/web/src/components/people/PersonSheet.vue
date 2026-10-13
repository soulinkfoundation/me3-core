<script setup lang="ts">
import { computed, ref } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import PersonAvatar from "./PersonAvatar.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useContactsStore, type Contact } from "../../stores/contacts";
import {
  firstName,
  formatSinceLong,
  isSoulinkPerson,
  personDetail,
  soulinkChatUrl,
  soulinkProfileUrl,
} from "../../utils/people";

const props = defineProps<{ contact: Contact | null }>();
const emit = defineEmits<{ close: [] }>();

const contactsStore = useContactsStore();
const { toastSuccess, toastError } = useAppToast();
const starring = ref(false);
const markingInTouch = ref(false);

const person = computed(() => props.contact);
const onSoulink = computed(() => (person.value ? isSoulinkPerson(person.value) : false));
const profileUrl = computed(() => (person.value && onSoulink.value ? soulinkProfileUrl(person.value) : null));
const chatUrl = computed(() => (person.value ? soulinkChatUrl(person.value) : null));
const phone = computed(() => person.value?.phone?.trim() || "");
const email = computed(() => person.value?.email?.trim() || "");
const detail = computed(() => (person.value ? personDetail(person.value) : ""));
const lastInTouch = computed(() =>
  person.value ? formatSinceLong(person.value.lastInTouchAt) || "Not in touch yet" : "",
);
const titleId = computed(() => `person-sheet-${person.value?.id || "none"}`);

async function toggleClose() {
  const contact = person.value;
  if (!contact || starring.value) return;
  starring.value = true;
  try {
    const updated = await contactsStore.updateContact(contact.id, {
      closeness: contact.isClose ? null : "close",
    });
    if (!updated) {
      toastError(contactsStore.error || "Couldn't save that.");
      return;
    }
    toastSuccess(updated.isClose ? "Added to Close" : "Removed from Close");
  } finally {
    starring.value = false;
  }
}

async function weTalked() {
  const contact = person.value;
  if (!contact || markingInTouch.value) return;
  markingInTouch.value = true;
  try {
    const updated = await contactsStore.markInTouch(contact.id);
    if (updated) toastSuccess(`Noted. You were in touch with ${firstName(contact.name)} today.`);
    else toastError(contactsStore.error || "Couldn't save that.");
  } finally {
    markingInTouch.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="Boolean(person)"
    :labelled-by="titleId"
    close-on-backdrop
    class="person-sheet-dialog"
    @close="emit('close')"
  >
    <section v-if="person" class="person-sheet" tabindex="-1" autofocus>
      <span class="person-sheet__grabber" aria-hidden="true" />
      <div class="person-sheet__hero">
        <component
          :is="profileUrl ? 'a' : 'div'"
          class="person-sheet__who"
          v-bind="profileUrl
            ? { href: profileUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${person.name}'s Soulink profile` }
            : {}"
        >
          <PersonAvatar :contact="person" :size="64" />
          <span class="person-sheet__identity">
            <strong :id="titleId" class="person-sheet__name">
              {{ person.name }}
              <UiIcon v-if="profileUrl" name="ChevronRight" :size="16" aria-hidden="true" />
            </strong>
            <span class="person-sheet__sub">{{ [detail, lastInTouch].filter(Boolean).join(" · ") }}</span>
          </span>
        </component>
        <button
          type="button"
          class="person-sheet__star"
          :class="{ 'person-sheet__star--on': person.isClose }"
          role="switch"
          :aria-checked="person.isClose"
          aria-label="Close"
          :title="person.isClose ? 'Close' : 'Mark as Close'"
          :disabled="starring"
          @click="toggleClose"
        >
          <UiIcon name="Star" :size="24" aria-hidden="true" />
        </button>
      </div>

      <div class="person-sheet__actions">
        <template v-if="onSoulink && chatUrl">
          <Button color="primary" class="person-sheet__primary" :href="chatUrl" target="_blank" rel="noopener noreferrer">
            <template #icon><UiIcon name="MessageCircle" :size="18" aria-hidden="true" /></template>
            Message on Soulink
          </Button>
          <a class="person-sheet__round" :href="chatUrl" target="_blank" rel="noopener noreferrer" aria-label="Call on Soulink">
            <UiIcon name="Video" :size="20" aria-hidden="true" />
          </a>
        </template>
        <template v-else>
          <Button v-if="phone" color="primary" class="person-sheet__primary" :href="`sms:${phone}`">
            <template #icon><UiIcon name="MessageCircle" :size="18" aria-hidden="true" /></template>
            Message
          </Button>
          <Button v-else-if="email" color="primary" class="person-sheet__primary" :href="`mailto:${email}`">
            <template #icon><UiIcon name="Mail" :size="18" aria-hidden="true" /></template>
            Email
          </Button>
          <a v-if="phone" class="person-sheet__round" :href="`tel:${phone}`" aria-label="Call">
            <UiIcon name="Phone" :size="20" aria-hidden="true" />
          </a>
        </template>
        <a v-if="email && (phone || onSoulink)" class="person-sheet__round" :href="`mailto:${email}`" aria-label="Email">
          <UiIcon name="Mail" :size="20" aria-hidden="true" />
        </a>
      </div>

      <slot name="reminder" :person="person" />

      <div class="person-sheet__footer">
        <button type="button" class="person-sheet__quiet" :disabled="markingInTouch" @click="weTalked">
          <UiIcon name="Check" :size="15" aria-hidden="true" />
          We talked
        </button>
        <slot name="footer" :person="person" />
      </div>
    </section>
  </AppDialog>
</template>

<style scoped>
.person-sheet {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(440px, 100%);
  padding: 12px 20px 22px;
  border-radius: 20px;
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md);
  color: var(--ui-text);
}

.person-sheet:focus {
  outline: none;
}

.person-sheet__grabber {
  align-self: center;
  width: 36px;
  height: 5px;
  border-radius: 999px;
  background: var(--ui-border-strong);
}

.person-sheet__hero {
  display: flex;
  align-items: center;
  gap: 8px;
}

.person-sheet__who {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 14px;
  color: inherit;
  text-decoration: none;
}

.person-sheet__identity {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.person-sheet__name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 20px;
  letter-spacing: -0.01em;
}

.person-sheet__name :deep(svg) {
  color: var(--ui-text-muted);
  opacity: 0.7;
}

.person-sheet__sub {
  color: var(--ui-text-muted);
  font-size: 14px;
}

.person-sheet__star {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}

.person-sheet__star--on {
  color: var(--ui-accent);
}

.person-sheet__star--on :deep(svg) {
  fill: currentColor;
}

.person-sheet__star:focus-visible,
.person-sheet__round:focus-visible,
.person-sheet__quiet:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.person-sheet__actions {
  display: flex;
  gap: 8px;
}

.person-sheet__primary {
  flex: 1;
}

.person-sheet__round {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--ui-surface-muted);
  color: var(--ui-text);
}

.person-sheet__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 18px;
}

.person-sheet__quiet {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

@media (max-width: 640px) {
  .person-sheet {
    width: 100%;
    border-radius: 20px 20px 0 0;
    padding-bottom: max(22px, env(safe-area-inset-bottom));
  }
}

@media (min-width: 641px) {
  .person-sheet__grabber {
    display: none;
  }
}
</style>

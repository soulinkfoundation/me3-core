<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import { useContactsStore, type Contact } from "../../stores/contacts";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [contact: Contact, created: boolean] }>();

const contactsStore = useContactsStore();
const name = ref("");
const phone = ref("");
const email = ref("");
const saving = ref(false);
const error = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

const canAdd = computed(() => Boolean(name.value.trim()) && !saving.value);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    name.value = "";
    phone.value = "";
    email.value = "";
    error.value = "";
    await nextTick();
    nameInput.value?.focus();
  },
);

function phoneDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

// Same person already in People: open them instead of adding a duplicate.
function existingMatch(): Contact | null {
  const wantedEmail = email.value.trim().toLowerCase();
  const wantedPhone = phoneDigits(phone.value);
  return (
    contactsStore.contacts.find(
      (contact) =>
        contact.status !== "archived" &&
        ((wantedEmail && contact.email?.trim().toLowerCase() === wantedEmail) ||
          (wantedPhone.length >= 6 && phoneDigits(contact.phone) === wantedPhone)),
    ) || null
  );
}

async function add() {
  if (!canAdd.value) return;
  const existing = existingMatch();
  if (existing) {
    emit("saved", existing, false);
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const contact = await contactsStore.createContact({
      name: name.value.trim(),
      phone: phone.value.trim() || null,
      email: email.value.trim() || null,
      source: "manual",
      relationship: "contact",
      status: "active",
    });
    if (contact) {
      emit("saved", contact, true);
      return;
    }
    const duplicate = existingMatch();
    if (duplicate) emit("saved", duplicate, false);
    else error.value = contactsStore.error || "Couldn't add them.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" aria-label="New person" close-on-backdrop @close="emit('close')">
    <form class="new-person" @submit.prevent="add">
      <div class="new-person__bar">
        <button type="button" class="new-person__link new-person__link--muted" @click="emit('close')">Cancel</button>
        <h2>New person</h2>
        <button type="submit" class="new-person__link" :disabled="!canAdd">Add</button>
      </div>
      <div class="new-person__form">
        <input ref="nameInput" v-model="name" placeholder="Name" aria-label="Name" autocomplete="off" required />
        <input v-model="phone" type="tel" placeholder="Phone" aria-label="Phone" autocomplete="off" />
        <input v-model="email" type="email" placeholder="Email" aria-label="Email" autocomplete="off" />
      </div>
      <p v-if="error" class="new-person__error" role="alert">{{ error }}</p>
      <p class="new-person__note">
        <UiIcon name="Lock" :size="14" aria-hidden="true" />
        Only in your ME3. Nothing is sent to them.
      </p>
    </form>
  </AppDialog>
</template>

<style scoped>
.new-person {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(420px, 100%);
  padding: 16px 18px 22px;
  border-radius: 20px;
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md);
  color: var(--ui-text);
}

.new-person__bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.new-person__bar h2 {
  margin: 0;
  font-size: 17px;
}

.new-person__link {
  justify-self: end;
  min-height: 36px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--ui-accent);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.new-person__link--muted {
  justify-self: start;
  color: var(--ui-text-muted);
  font-weight: 500;
}

.new-person__link:disabled {
  opacity: 0.35;
  cursor: default;
}

.new-person__form {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-surface-muted);
}

.new-person__form input {
  height: 50px;
  padding: 0 16px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 16px;
}

.new-person__form input + input {
  border-top: 1px solid var(--ui-border);
}

.new-person__form input:focus-visible {
  box-shadow: inset 0 0 0 2px var(--ui-accent);
}

.new-person__error {
  margin: 0;
  color: #b33b2e;
  font-size: 14px;
}

.new-person__note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

@media (max-width: 640px) {
  .new-person {
    width: 100%;
    border-radius: 20px 20px 0 0;
    padding-bottom: max(22px, env(safe-area-inset-bottom));
  }
}
</style>

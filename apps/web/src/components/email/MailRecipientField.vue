<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import UiIcon from "../UiIcon.vue";
import {
  formatMailRecipients,
  isValidMailRecipient,
  parseMailRecipients,
} from "../../../../../shared/mail-recipients";

export type MailRecipientOption = { id: string; name: string; email: string; search: string };

// A To/Cc/Bcc row: committed addresses show as chips, the text box holds the
// one being typed. The model is the header form ("a@x.ie, b@y.ie") including
// any half-typed address, so a single typed address can be sent as-is.

const props = defineProps<{
  modelValue: string;
  id: string;
  label: string;
  contacts: MailRecipientOption[];
}>();
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();

const input = ref<HTMLInputElement | null>(null);
const chips = ref<string[]>([]);
const typed = ref("");
const focused = ref(false);
const activeIndex = ref(0);

function sync(value: string) {
  chips.value = parseMailRecipients(value);
  typed.value = "";
}

let lastEmitted: string | null = null;
watch(
  () => props.modelValue,
  (value) => {
    if (value === lastEmitted) return;
    sync(value);
  },
  { immediate: true },
);

function emitModel() {
  lastEmitted = formatMailRecipients([...chips.value, ...(typed.value.trim() ? [typed.value.trim()] : [])]);
  emit("update:modelValue", lastEmitted);
}

function commitTyped(): boolean {
  const added = parseMailRecipients(typed.value).filter((address) => !chips.value.includes(address));
  typed.value = "";
  if (!added.length) {
    emitModel();
    return false;
  }
  chips.value = [...chips.value, ...added];
  emitModel();
  return true;
}

function removeChip(index: number) {
  chips.value = chips.value.filter((_chip, chipIndex) => chipIndex !== index);
  emitModel();
  void nextTick(() => input.value?.focus());
}

const suggestions = computed(() => {
  const query = typed.value.trim().toLowerCase();
  if (!focused.value || !query) return [];
  return props.contacts
    .filter((contact) => contact.email && contact.search.includes(query) && !chips.value.includes(contact.email.toLowerCase()))
    .slice(0, 8);
});

function chooseSuggestion(contact: MailRecipientOption) {
  typed.value = contact.email;
  commitTyped();
  activeIndex.value = 0;
  void nextTick(() => input.value?.focus());
}

function chipLabel(address: string): string {
  return props.contacts.find((contact) => contact.email.toLowerCase() === address)?.name || address;
}

function handleInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  activeIndex.value = 0;
  if (/[,;\n]/.test(value)) {
    typed.value = value;
    commitTyped();
    return;
  }
  typed.value = value;
  emitModel();
}

function handleKeydown(event: KeyboardEvent) {
  const options = suggestions.value;
  if (event.key === "ArrowDown" && options.length) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % options.length;
    return;
  }
  if (event.key === "ArrowUp" && options.length) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + options.length) % options.length;
    return;
  }
  if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
    if (options[activeIndex.value]) {
      event.preventDefault();
      chooseSuggestion(options[activeIndex.value]);
      return;
    }
    if (typed.value.trim()) {
      event.preventDefault();
      commitTyped();
    }
    return;
  }
  if (event.key === "Tab" && typed.value.trim()) {
    if (options[activeIndex.value]) {
      event.preventDefault();
      chooseSuggestion(options[activeIndex.value]);
      return;
    }
    commitTyped();
    return;
  }
  if (event.key === "Backspace" && !typed.value && chips.value.length) {
    event.preventDefault();
    removeChip(chips.value.length - 1);
  }
}

function handlePaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain") || "";
  if (!/[,;\n]/.test(text)) return;
  event.preventDefault();
  typed.value = `${typed.value}${text}`;
  commitTyped();
}

function handleBlur() {
  focused.value = false;
  if (typed.value.trim()) commitTyped();
}

function focus() {
  input.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <div class="compose-row compose-row--recipient mail-recipient-field" @click.self="focus">
    <label :for="id">{{ label }}</label>
    <div class="mail-recipient-field__items" @click.self="focus">
      <span
        v-for="(address, index) in chips"
        :key="address"
        class="compose-chip"
        :class="{ 'compose-chip--invalid': !isValidMailRecipient(address) }"
        :title="isValidMailRecipient(address) ? address : `${address} doesn't look like an email address`"
      >
        {{ chipLabel(address) }}
        <button type="button" class="compose-chip__remove" :aria-label="`Remove ${address}`" @click="removeChip(index)">
          <UiIcon name="X" :size="12" aria-hidden="true" />
        </button>
      </span>
      <input
        :id="id"
        ref="input"
        :value="typed"
        type="email"
        multiple
        autocomplete="email"
        role="combobox"
        aria-autocomplete="list"
        :aria-controls="`${id}-list`"
        :aria-expanded="suggestions.length > 0"
        :aria-activedescendant="suggestions.length ? `${id}-option-${activeIndex}` : undefined"
        @focus="focused = true"
        @input="handleInput"
        @keydown="handleKeydown"
        @paste="handlePaste"
        @blur="handleBlur"
      />
    </div>
    <slot />
    <div v-if="suggestions.length" :id="`${id}-list`" class="compose-recipient-list" role="listbox">
      <button
        v-for="(contact, index) in suggestions"
        :id="`${id}-option-${index}`"
        :key="contact.id"
        type="button"
        class="compose-recipient-option"
        :class="{ 'is-active': index === activeIndex }"
        role="option"
        :aria-selected="index === activeIndex"
        @mousedown.prevent="chooseSuggestion(contact)"
      >
        <span class="compose-recipient-option__name">{{ contact.name }}</span>
        <span class="compose-recipient-option__email">{{ contact.email }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mail-recipient-field > label {
  flex-shrink: 0;
  align-self: flex-start;
  min-width: 58px;
  padding-top: 12px;
  font-size: 14px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.mail-recipient-field__items {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-width: 0;
  padding: 5px 0;
}

.mail-recipient-field__items input {
  flex: 1 1 140px;
  min-width: 120px;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 15px;
}

.mail-recipient-field__items input:focus {
  outline: none;
}

.compose-recipient-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}

.compose-recipient-option {
  display: grid;
  width: 100%;
  gap: 2px;
  padding: 10px;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.compose-recipient-option:last-child {
  border-bottom: 0;
}

.compose-recipient-option:hover,
.compose-recipient-option.is-active {
  background: var(--color-text);
  color: var(--color-bg);
}

.compose-recipient-option__name,
.compose-recipient-option__email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compose-recipient-option__name {
  font-size: 13px;
  font-weight: 700;
}

.compose-recipient-option__email {
  font-size: 12px;
  color: var(--color-text-muted);
}

.compose-recipient-option:hover .compose-recipient-option__email,
.compose-recipient-option.is-active .compose-recipient-option__email {
  color: inherit;
}

.compose-recipient-option:hover .compose-recipient-option__name,
.compose-recipient-option.is-active .compose-recipient-option__name {
  color: inherit;
}

.compose-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 2px 2px 10px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgba(34, 152, 116, 0.14));
  color: var(--ui-accent-strong, var(--ui-accent, #229874));
  font-size: 14px;
  font-weight: 500;
}

.compose-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.compose-chip--invalid {
  background: color-mix(in srgb, var(--ui-danger, #c2410c) 14%, transparent);
  color: var(--ui-danger, #c2410c);
}
</style>

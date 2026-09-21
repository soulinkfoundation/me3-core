<script setup lang="ts">
import { computed, ref } from "vue";
import {
  getTimeZoneCityLabel,
  getTimeZoneSearchAliases,
} from "../../utils/timezone";

type TimezoneOption = { value: string; label: string };

const props = defineProps<{
  id: string;
  label: string;
  modelValue: string;
  options: TimezoneOption[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const isOpen = ref(false);
const query = ref("");
const activeIndex = ref(0);

const selectedOption = computed(
  () => props.options.find((option) => option.value === props.modelValue),
);

function displayLabel(option: TimezoneOption): string {
  return `${getTimeZoneCityLabel(option.value)} — ${option.label}`;
}

function selectedLabel(option: TimezoneOption): string {
  const rawOffset = option.label.match(/\(([^)]*)\)$/)?.[1];
  const offset = rawOffset?.replace(
    /^UTC([+-])0?(\d{1,2}):00$/,
    "UTC$1$2",
  );
  return `${getTimeZoneCityLabel(option.value)}${offset ? ` (${offset})` : ""}`;
}

const suggestions = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  if (search) {
    return props.options
      .filter((option) =>
        [
          option.value,
          option.label,
          getTimeZoneCityLabel(option.value),
          ...getTimeZoneSearchAliases(option.value),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
      )
      .slice(0, 50);
  }

  const popular = [
    props.modelValue,
    "Europe/Dublin",
    "Europe/London",
    "Europe/Madrid",
    "Atlantic/Canary",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney",
    "UTC",
  ];
  return popular
    .map((value) => props.options.find((option) => option.value === value))
    .filter((option): option is TimezoneOption => Boolean(option))
    .filter((option, index, options) => options.findIndex((item) => item.value === option.value) === index);
});

const activeOption = computed(() => suggestions.value[activeIndex.value]);

function openPicker() {
  if (isOpen.value) return;
  query.value = "";
  activeIndex.value = 0;
  isOpen.value = true;
}

function closePicker() {
  isOpen.value = false;
  query.value = "";
  activeIndex.value = 0;
}

function selectOption(option: TimezoneOption) {
  emit("update:modelValue", option.value);
  closePicker();
}

function handleInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  activeIndex.value = 0;
  isOpen.value = true;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!isOpen.value) openPicker();
    else activeIndex.value = Math.min(activeIndex.value + 1, suggestions.value.length - 1);
  } else if (event.key === "ArrowUp" && isOpen.value) {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === "Enter" && isOpen.value && activeOption.value) {
    event.preventDefault();
    selectOption(activeOption.value);
  } else if (event.key === "Escape" && isOpen.value) {
    event.preventDefault();
    closePicker();
  }
}

function handleFocusout(event: FocusEvent) {
  const wrapper = event.currentTarget as HTMLElement;
  if (!wrapper.contains(event.relatedTarget as Node | null)) closePicker();
}
</script>

<template>
  <div class="timezone-picker" @focusout="handleFocusout">
    <label :for="id">{{ label }}</label>
    <input
      :id="id"
      type="text"
      role="combobox"
      autocomplete="off"
      :value="isOpen ? query : selectedOption ? selectedLabel(selectedOption) : modelValue"
      :title="selectedOption ? displayLabel(selectedOption) : modelValue"
      placeholder="Search city, country or time zone"
      :aria-expanded="isOpen"
      :aria-controls="`${id}-options`"
      :aria-activedescendant="isOpen && activeOption ? `${id}-option-${activeIndex}` : undefined"
      aria-autocomplete="list"
      @focus="openPicker"
      @input="handleInput"
      @keydown="handleKeydown"
    />
    <div v-if="isOpen" :id="`${id}-options`" class="timezone-picker-options" role="listbox">
      <button
        v-for="(option, index) in suggestions"
        :id="`${id}-option-${index}`"
        :key="option.value"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        :class="{ active: index === activeIndex }"
        @mousedown.prevent
        @mouseenter="activeIndex = index"
        @click="selectOption(option)"
      >
        <span>{{ displayLabel(option) }}</span>
        <span v-if="option.value === modelValue" aria-hidden="true">✓</span>
      </button>
      <p v-if="suggestions.length === 0" class="timezone-picker-empty">
        No time zones found. Try a city name, such as Barcelona.
      </p>
    </div>
  </div>
</template>

<style scoped>
.timezone-picker {
  position: relative;
  display: grid;
  gap: 8px;
}

.timezone-picker label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text, var(--color-text, #232428));
}

.timezone-picker input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--ui-border, var(--color-border, #ddd));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg, #fff));
  color: var(--ui-text, var(--color-text, #232428));
  font: inherit;
}

.timezone-picker input:focus-visible {
  outline: 2px solid var(--ui-focus, var(--ui-accent, #007bff));
  outline-offset: 1px;
}

.timezone-picker-options {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--ui-border, var(--color-border, #ddd));
  border-radius: var(--ui-radius-md, 8px);
  background: var(--ui-surface, var(--color-bg, #fff));
  box-shadow: var(--ui-shadow-md, 0 12px 28px rgb(0 0 0 / 14%));
}

.timezone-picker-options button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--ui-radius-sm, 6px);
  background: transparent;
  color: var(--ui-text, var(--color-text, #232428));
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.timezone-picker-options button:hover,
.timezone-picker-options button.active {
  background: var(--ui-surface-muted, var(--color-bg-subtle, #f5f5f5));
}

.timezone-picker-options button[aria-selected="true"] {
  font-weight: 600;
}

.timezone-picker-empty {
  margin: 0;
  padding: 10px;
  color: var(--ui-text-muted, var(--color-text-muted, #5d6368));
  font-size: 13px;
}
</style>

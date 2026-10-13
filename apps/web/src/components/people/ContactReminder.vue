<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useContactsStore, type Contact } from "../../stores/contacts";
import { firstName } from "../../utils/people";

const props = defineProps<{ contact: Contact }>();

const contactsStore = useContactsStore();
const { toastSuccess, toastError } = useAppToast();
const picking = ref(false);
const saving = ref(false);
const monthOffset = ref(0);

watch(() => props.contact.id, () => {
  picking.value = false;
  monthOffset.value = 0;
});

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function nextMonth(): Date {
  const today = addDays(0);
  const target = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(today.getDate(), lastDay));
  return target;
}

const presets = computed(() => [
  { label: "Next week", date: addDays(7) },
  { label: "In 2 weeks", date: addDays(14) },
  { label: "Next month", date: nextMonth() },
]);

const setLabel = computed(() => {
  if (!props.contact.reminderAt) return "";
  return new Date(props.contact.reminderAt)
    .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "");
});

const month = computed(() => {
  const today = addDays(0);
  const first = new Date(today.getFullYear(), today.getMonth() + monthOffset.value, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  return {
    label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    cells: [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, index) => {
        const date = new Date(first.getFullYear(), first.getMonth(), index + 1);
        return { date, day: index + 1, past: date <= today };
      }),
    ],
  };
});

async function remind(date: Date) {
  if (saving.value) return;
  saving.value = true;
  try {
    const ok = await contactsStore.setReminder(
      props.contact.id,
      dayKey(date),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    if (ok) {
      picking.value = false;
      toastSuccess("Added to your calendar");
    } else {
      toastError(contactsStore.error || "Couldn't add the reminder.");
    }
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await contactsStore.clearReminder(props.contact.id))) {
      toastError(contactsStore.error || "Couldn't remove the reminder.");
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="contact-reminder" aria-label="Remind me to get in touch">
    <p class="contact-reminder__title">
      <UiIcon name="Bell" :size="19" aria-hidden="true" />
      Remind me to get in touch
    </p>

    <div v-if="contact.reminderAt" class="contact-reminder__set">
      <UiIcon name="CalendarCheck" :size="17" aria-hidden="true" />
      <span class="contact-reminder__set-text">
        <strong>{{ setLabel }}</strong>
        <span>On your calendar · “Get in touch with {{ firstName(contact.name) }}”</span>
      </span>
      <button type="button" class="contact-reminder__remove" :disabled="saving" @click="remove">Remove</button>
    </div>

    <template v-else>
      <div class="contact-reminder__chips">
        <button
          v-for="preset in presets"
          :key="preset.label"
          type="button"
          class="contact-reminder__chip"
          :disabled="saving"
          @click="remind(preset.date)"
        >
          {{ preset.label }}
        </button>
        <button
          type="button"
          class="contact-reminder__chip contact-reminder__chip--icon"
          :class="{ 'contact-reminder__chip--on': picking }"
          aria-label="Pick a date"
          :aria-expanded="picking"
          @click="picking = !picking"
        >
          <UiIcon name="CalendarDays" :size="16" aria-hidden="true" />
        </button>
      </div>

      <div v-if="picking" class="contact-reminder__calendar">
        <div class="contact-reminder__month">
          <button type="button" aria-label="Previous month" :disabled="monthOffset === 0" @click="monthOffset -= 1">
            <UiIcon name="ChevronLeft" :size="18" aria-hidden="true" />
          </button>
          <strong>{{ month.label }}</strong>
          <button type="button" aria-label="Next month" :disabled="monthOffset >= 11" @click="monthOffset += 1">
            <UiIcon name="ChevronRight" :size="18" aria-hidden="true" />
          </button>
        </div>
        <div class="contact-reminder__grid">
          <span v-for="(weekday, index) in ['M', 'T', 'W', 'T', 'F', 'S', 'S']" :key="index" class="contact-reminder__dow">{{ weekday }}</span>
          <template v-for="(cell, index) in month.cells" :key="index">
            <span v-if="!cell" />
            <button
              v-else
              type="button"
              :disabled="cell.past || saving"
              :aria-label="cell.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })"
              @click="remind(cell.date)"
            >
              {{ cell.day }}
            </button>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.contact-reminder {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--ui-surface-muted);
}

.contact-reminder__title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 16px;
}

.contact-reminder__set {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--ui-accent-soft);
  color: var(--ui-accent-strong);
}

.contact-reminder__set-text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.contact-reminder__set-text strong {
  color: var(--ui-text);
  font-size: 15px;
}

.contact-reminder__remove {
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--ui-accent-strong);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.contact-reminder__chips {
  display: flex;
  gap: 6px;
}

.contact-reminder__chip {
  flex: 1;
  min-height: 34px;
  padding: 0 6px;
  border: 0;
  border-radius: 999px;
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.contact-reminder__chip--icon {
  display: flex;
  flex: 0 0 44px;
  align-items: center;
  justify-content: center;
}

.contact-reminder__chip--on {
  background: var(--ui-primary);
  color: var(--ui-primary-contrast);
}

.contact-reminder__month {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
}

.contact-reminder__month button,
.contact-reminder__grid button {
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  cursor: pointer;
}

.contact-reminder__month button {
  display: flex;
  padding: 6px;
}

.contact-reminder__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  text-align: center;
}

.contact-reminder__dow {
  padding: 2px 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.contact-reminder__grid button {
  height: 34px;
  border-radius: 50%;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.contact-reminder__grid button:hover:not(:disabled) {
  background: var(--ui-accent-soft);
}

button:disabled {
  opacity: 0.35;
  cursor: default;
}

button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}
</style>

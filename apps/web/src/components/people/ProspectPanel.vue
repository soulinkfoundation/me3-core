<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAppToast } from "../../composables/useAppToast";
import { useContactsStore, type Contact, type ContactInput, type OutreachStatus } from "../../stores/contacts";
import {
  OUTREACH_STEPS,
  followUpDateIn,
  followUpInDays,
  followUpLabel,
  isFollowUpDue,
  outreachStatusLabel,
} from "../../utils/outreach";

const props = defineProps<{ contact: Contact }>();

const contactsStore = useContactsStore();
const { toastError } = useAppToast();
const saving = ref(false);
const organisation = ref("");
const offer = ref("");

watch(
  () => [props.contact.id, props.contact.organisation, props.contact.offer],
  () => {
    organisation.value = props.contact.organisation || "";
    offer.value = props.contact.offer || "";
  },
  { immediate: true },
);

const due = computed(() => isFollowUpDue(props.contact));
const followUp = computed(() => {
  if (followUpInDays(props.contact) === null) return "No follow-up date";
  return followUpLabel(props.contact) || "No follow-up needed";
});
// ME3 sets "No response" itself; show it so the owner knows why nothing is selected.
const quietStatus = computed(() =>
  OUTREACH_STEPS.some((step) => step.value === props.contact.outreachStatus)
    ? ""
    : outreachStatusLabel(props.contact.outreachStatus),
);

async function save(patch: Partial<ContactInput>) {
  if (saving.value) return;
  saving.value = true;
  try {
    const updated = await contactsStore.updateContact(props.contact.id, patch);
    if (!updated) toastError(contactsStore.error || "Couldn't save that.");
  } finally {
    saving.value = false;
  }
}

function setStatus(status: OutreachStatus) {
  if (status !== props.contact.outreachStatus) void save({ outreachStatus: status });
}

function saveText(field: "organisation" | "offer", value: string) {
  const next = value.trim() || null;
  if (next !== (props.contact[field] || null)) void save({ [field]: next });
}
</script>

<template>
  <div class="prospect-panel">
    <label class="prospect-panel__field">
      <span class="prospect-panel__label">Organisation</span>
      <input
        v-model="organisation"
        type="text"
        class="prospect-panel__input"
        aria-label="Organisation"
        maxlength="200"
        @change="saveText('organisation', organisation)"
      />
    </label>

    <div class="prospect-panel__field">
      <span class="prospect-panel__label">
        Status<template v-if="quietStatus"> · {{ quietStatus }}</template>
      </span>
      <div class="prospect-panel__steps" role="group" aria-label="Outreach status">
        <button
          v-for="step in OUTREACH_STEPS"
          :key="step.value"
          type="button"
          class="prospect-panel__step"
          :class="{ 'prospect-panel__step--on': contact.outreachStatus === step.value }"
          :aria-pressed="contact.outreachStatus === step.value"
          :disabled="saving"
          @click="setStatus(step.value)"
        >
          {{ step.label }}
        </button>
      </div>
    </div>

    <label class="prospect-panel__field">
      <span class="prospect-panel__label">What I offered</span>
      <textarea
        v-model="offer"
        class="prospect-panel__input"
        aria-label="What I offered"
        rows="2"
        maxlength="2000"
        @change="saveText('offer', offer)"
      />
    </label>

    <div class="prospect-panel__field">
      <span class="prospect-panel__label">Follow up</span>
      <div class="prospect-panel__followup">
        <span class="prospect-panel__date" :class="{ 'prospect-panel__date--due': due }">{{ followUp }}</span>
        <button type="button" class="prospect-panel__nudge" :disabled="saving" @click="save({ nextFollowupAt: followUpDateIn(3) })">
          +3 days
        </button>
        <button type="button" class="prospect-panel__nudge" :disabled="saving" @click="save({ nextFollowupAt: followUpDateIn(7) })">
          +1 week
        </button>
        <button
          v-if="contact.nextFollowupAt"
          type="button"
          class="prospect-panel__clear"
          :disabled="saving"
          @click="save({ nextFollowupAt: null })"
        >
          Clear
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prospect-panel {
  display: grid;
  gap: 14px;
}

.prospect-panel__field {
  display: grid;
  gap: 6px;
}

.prospect-panel__label {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.prospect-panel__input {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md, 8px);
  background: var(--ui-bg);
  color: var(--ui-text);
  font: inherit;
  font-size: 16px;
  resize: vertical;
}

.prospect-panel__steps,
.prospect-panel__followup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.prospect-panel__step,
.prospect-panel__nudge {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.prospect-panel__nudge {
  border-radius: var(--ui-radius-md, 8px);
  color: var(--ui-text);
}

.prospect-panel__step--on {
  border-color: transparent;
  background: var(--ui-primary);
  color: var(--ui-primary-contrast);
}

.prospect-panel__date {
  margin-right: 4px;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.prospect-panel__date--due {
  color: var(--ui-accent-strong);
  font-weight: 600;
}

.prospect-panel__clear {
  min-height: 34px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.prospect-panel__input:focus-visible,
.prospect-panel__step:focus-visible,
.prospect-panel__nudge:focus-visible,
.prospect-panel__clear:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}
</style>

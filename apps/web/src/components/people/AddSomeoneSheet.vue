<script setup lang="ts">
import { watch } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import { useSoulinkInvite } from "../../composables/useSoulinkInvite";

// Copied from Soulink's contact starter. Phone contacts are native-only.
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; addByHand: [] }>();

const invite = useSoulinkInvite();
watch(() => props.open, (open) => { if (open) void invite.load(); });
</script>

<template>
  <AppDialog :open="open" aria-label="Add someone" close-on-backdrop @close="emit('close')">
    <section class="add-someone">
      <div class="add-someone__bar">
        <h2>Add someone</h2>
        <button type="button" class="add-someone__close" aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="20" aria-hidden="true" />
        </button>
      </div>
      <div class="add-someone__list">
        <button type="button" class="add-someone__row" @click="emit('addByHand')">
          <UiIcon name="PenLine" :size="19" aria-hidden="true" />
          Add by hand
        </button>
        <button
          v-if="invite.available.value !== false"
          type="button"
          class="add-someone__row"
          :disabled="invite.available.value === null"
          @click="invite.share()"
        >
          <UiIcon name="Share2" :size="19" aria-hidden="true" />
          Invite a friend
        </button>
      </div>
      <p v-if="invite.available.value !== false" class="add-someone__note">
        When they join Soulink with your link, they’re Linked and appear here.
      </p>
    </section>
  </AppDialog>
</template>

<style scoped>
.add-someone {
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

.add-someone__bar {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.add-someone__bar h2 {
  margin: 0;
  font-size: 19px;
}

.add-someone__close {
  position: absolute;
  right: -6px;
  display: flex;
  padding: 8px;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}

.add-someone__list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  background: var(--ui-surface-muted);
}

.add-someone__row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 0 16px;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 16px;
  text-align: left;
  cursor: pointer;
}

.add-someone__row + .add-someone__row {
  border-top: 1px solid var(--ui-border);
}

.add-someone__row:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-someone__row:focus-visible,
.add-someone__close:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: -2px;
}

.add-someone__note {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

@media (max-width: 640px) {
  .add-someone {
    width: 100%;
    border-radius: 20px 20px 0 0;
    padding-bottom: max(22px, env(safe-area-inset-bottom));
  }
}
</style>

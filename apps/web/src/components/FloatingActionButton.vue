<script setup lang="ts">
import type { UiIconName } from "../utils/icons";
import UiIcon from "./UiIcon.vue";

// The page's main action, floating at the bottom-right of a centred column.
// `column` is the column's CSS width, so the button lines up with its edge rather than the window's.
withDefaults(
  defineProps<{
    label: string;
    icon?: UiIconName;
    column?: string;
    disabled?: boolean;
  }>(),
  {
    icon: "Plus",
    column: "min(700px, calc(100% - 32px))",
    disabled: false,
  },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <div class="fab-rail">
    <div class="fab-rail__column" :style="{ width: column }">
      <button
        type="button"
        class="fab"
        :aria-label="label"
        :title="label"
        :disabled="disabled"
        @click="$emit('click', $event)"
      >
        <UiIcon :name="icon" :size="26" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.fab-rail {
  position: fixed;
  right: 0;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  left: 0;
  z-index: 40;
  pointer-events: none;
}

.fab-rail__column {
  display: flex;
  justify-content: flex-end;
  margin: 0 auto;
}

.fab {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--ui-primary, var(--ui-accent));
  color: var(--ui-primary-contrast, var(--ui-accent-contrast, #fff));
  box-shadow:
    0 6px 18px color-mix(in oklab, #000, transparent 80%),
    0 2px 6px color-mix(in oklab, #000, transparent 88%);
  cursor: pointer;
  pointer-events: auto;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.fab:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 10px 24px color-mix(in oklab, #000, transparent 76%),
    0 3px 8px color-mix(in oklab, #000, transparent 86%);
}

.fab:active:not(:disabled) {
  transform: scale(0.96);
}

.fab:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 3px;
}

.fab:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .fab {
    transition: none;
  }
}
</style>

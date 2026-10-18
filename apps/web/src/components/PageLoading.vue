<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { beginAppLoading } from "../composables/useAppLoading";

withDefaults(
  defineProps<{
    label?: string;
    compact?: boolean;
  }>(),
  {
    label: "Loading...",
    compact: false,
  },
);

// Loading shows as the app-wide bar at the top; the label stays for screen readers.
const release = beginAppLoading();
onBeforeUnmount(release);
</script>

<template>
  <span class="page-loading" role="status" aria-live="polite">{{ label }}</span>
</template>

<style scoped>
.page-loading {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

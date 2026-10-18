<script setup lang="ts">
import { isAppLoading } from "../composables/useAppLoading";
</script>

<template>
  <div v-if="isAppLoading" class="app-loading" role="progressbar" aria-label="Loading">
    <span class="app-loading__bar" />
  </div>
</template>

<style scoped>
.app-loading { position: fixed; inset: 0 0 auto; z-index: 10000; height: 3px; overflow: hidden; pointer-events: none; background: var(--ui-accent-soft); }
.app-loading__bar { display: block; width: 35%; height: 100%; background: var(--ui-accent); animation: app-loading-slide 1.2s ease-in-out infinite; }
@keyframes app-loading-slide { from { transform: translateX(-100%); } to { transform: translateX(286%); } }
@media (prefers-reduced-motion: reduce) { .app-loading__bar { width: 100%; animation: none; } }
</style>

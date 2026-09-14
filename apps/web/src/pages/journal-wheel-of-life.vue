<script setup lang="ts">
import { useRoute } from "vue-router";
import { definePage } from "unplugin-vue-router/runtime";
import UiIcon from "../components/UiIcon.vue";
import WheelOfLife from "../components/journal/WheelOfLife.vue";

definePage({
  path: "/journal/wheel-of-life",
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    requiresPlugin: "me3.journal",
    title: "Wheel of Life | ME3",
    description: "ME3 Wheel of Life workspace.",
    robots: "noindex,follow",
  },
});
const route = useRoute();
</script>

<template>
  <main class="wheel-life-page">
    <RouterLink
      class="wheel-life-page__close"
      :to="{ path: '/journal', query: route.query.date ? { date: route.query.date } : {} }"
      aria-label="Close Wheel of Life"
      title="Close Wheel of Life"
    >
      <UiIcon name="X" :size="18" />
    </RouterLink>
    <WheelOfLife />
  </main>
</template>

<style scoped>
.wheel-life-page {
  position: relative;
  display: flex;
  box-sizing: border-box;
  height: 100vh;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 0 24px;
  background: var(--ui-bg);
  color: var(--ui-text);
}

.wheel-life-page__close {
  position: absolute;
  top: 4px;
  right: 24px;
  z-index: 30;
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-text);
  text-decoration: none;
}

.wheel-life-page__close:hover,
.wheel-life-page__close:focus-visible {
  background: var(--ui-surface-muted);
}

.wheel-life-page__close:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.wheel-life-page :deep(.life-wheel__actions) {
  padding-right: 44px;
}

@media (max-width: 959px) {
  .wheel-life-page {
    padding: 0 14px;
  }

  .wheel-life-page__close {
    top: 2px;
    right: 14px;
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import AppProfileMenu from "./AppProfileMenu.vue";
import UiIcon from "./UiIcon.vue";
const route = useRoute();
const home = computed(() => route.path === "/assistant" && route.query.mode !== "site-builder");
</script>

<template>
  <header class="app-top-bar" aria-label="App navigation">
    <RouterLink v-if="!home" to="/assistant" class="app-home-link" aria-label="Home"><UiIcon name="ArrowLeft" :size="18" /></RouterLink>
    <!-- Pages teleport their main control (day or month switcher, search) here instead of adding a second header row. -->
    <div id="app-page-controls" class="app-top-bar__controls" />
    <AppProfileMenu v-if="home" />
  </header>
</template>

<style scoped>
.app-top-bar { position: fixed; inset: 0 0 auto; z-index: 70; display: flex; align-items: center; gap: 12px; height: var(--app-topbar-height); padding: 8px 14px; box-sizing: border-box; background: var(--ui-bg); }
.app-top-bar__controls { display: flex; align-items: center; flex: 1; min-width: 0; }
.app-home-link { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; min-height: 44px; color: var(--ui-text-muted); text-decoration: none; }
.app-home-link:hover { color: var(--ui-text); }
/* Phones need the room for the page's own controls. */
@media (max-width: 640px) { .app-top-bar { gap: 4px; padding-inline: 8px; } }
.app-home-link:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; border-radius: 8px; }
</style>

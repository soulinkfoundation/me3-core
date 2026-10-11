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
    <RouterLink v-if="!home" to="/assistant" class="app-home-link"><UiIcon name="ArrowLeft" :size="18" /><span>Home</span></RouterLink>
    <div id="app-top-bar-controls" class="app-top-bar__controls" />
    <AppProfileMenu />
  </header>
</template>

<style scoped>
.app-top-bar { position: fixed; inset: 0 0 auto; z-index: 70; display: flex; align-items: center; gap: 12px; height: var(--app-topbar-height); padding: 8px 14px; box-sizing: border-box; background: var(--ui-bg); }
.app-top-bar__controls { flex: 1; min-width: 0; }
.app-home-link { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; color: var(--ui-text-muted); font-size: 14px; font-weight: 500; text-decoration: none; }
.app-home-link:hover { color: var(--ui-text); }
.app-home-link:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; border-radius: 8px; }
</style>

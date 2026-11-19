<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { topBarCloseHandler } from "../composables/useTopBar";
import AppProfileMenu from "./AppProfileMenu.vue";
import UiIcon from "./UiIcon.vue";
const route = useRoute();
const router = useRouter();
const home = computed(() => route.path === "/assistant" && route.query.mode !== "site-builder");
// One header for every screen but Home: the page's one action on the left, its title in the centre, X on the right.
// X goes to the page's parent (`meta.back`) or Home; a page that must decide how to leave registers useTopBarClose.
const parent = computed(() => {
  const value = route.meta.back as { to: string; label: string } | undefined;
  return value?.to ? value : { to: "/assistant", label: "Home" };
});
const closeHandler = topBarCloseHandler();
function close() {
  if (closeHandler.value) void closeHandler.value();
  else void router.push(parent.value.to);
}
</script>

<template>
  <header class="app-top-bar" :class="{ 'app-top-bar--home': home }" aria-label="App navigation">
    <!-- Pages teleport their one left action here (AppPageBar's leading slot). -->
    <div id="app-page-leading" class="app-top-bar__leading" />
    <!-- Pages teleport their title or switcher (day or month switcher, folder menu, step picker) here. -->
    <div id="app-page-controls" class="app-top-bar__controls" />
    <AppProfileMenu v-if="home" />
    <button v-else type="button" class="app-top-bar__close" data-tour-target="back_home" :aria-label="parent.label === 'Home' ? 'Close' : `Close, back to ${parent.label}`" :title="parent.label === 'Home' ? 'Close' : `Back to ${parent.label}`" @click="close"><UiIcon name="X" :size="22" /></button>
  </header>
</template>

<style scoped>
/* Sides share what the centre leaves, so the title stays centred on the page at every width. */
.app-top-bar { position: fixed; inset: var(--app-banner-height, 0px) 0 auto; z-index: 70; display: grid; grid-template-columns: minmax(44px, 1fr) minmax(0, auto) minmax(44px, 1fr); align-items: center; gap: 8px; height: calc(var(--app-topbar-height) - var(--app-banner-height, 0px)); padding: 8px 14px; box-sizing: border-box; background: var(--ui-bg); }
.app-top-bar--home { grid-template-columns: 0 minmax(0, 1fr) auto; }
.app-top-bar__leading { display: flex; align-items: center; justify-self: start; min-width: 0; }
.app-top-bar__leading:empty { display: block; }
.app-top-bar__controls { display: flex; align-items: center; justify-content: center; min-width: 0; }
.app-top-bar__close { display: inline-flex; align-items: center; justify-content: center; justify-self: end; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text); cursor: pointer; }
.app-top-bar__close:hover { background: var(--ui-surface-muted, var(--ui-surface)); }
.app-top-bar__close:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
@media (max-width: 640px) { .app-top-bar { gap: 4px; padding-inline: 8px; } }
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import { Toaster } from "vue-sonner";
import { api } from "./api";
import AgentChatLauncher from "./components/AgentChatLauncher.vue";
import AppLoadingBar from "./components/AppLoadingBar.vue";
import AppTopBar from "./components/AppTopBar.vue";
import AppTour from "./components/tour/AppTour.vue";
import { useMailboxRealtime } from "./composables/useMailboxRealtime";
import { useAuthStore } from "./stores/auth";
import { useTourStore } from "./stores/tour";

/** Set true to show the floating agent chat launcher on supported pages. */
const AGENT_LAUNCHER_UI_ENABLED = false;

const route = useRoute();
const auth = useAuthStore();
useMailboxRealtime();
const remoteApiHost = import.meta.env.DEV
  ? import.meta.env.VITE_REMOTE_API_HOST || ""
  : "";
const agentChatInstalled = ref(false);
const pluginChangedEvent = "me3:plugins-changed";

const showAppShell = computed(
  () =>
    auth.isAuthenticated &&
    route.meta.requiresAuth === true &&
    route.meta.hideAppShell !== true,
);

// Show me around keeps going across pages and reloads until the owner finishes or skips it.
const tour = useTourStore();
watch(showAppShell, shown => { if (shown) void tour.resume(auth.user?.id || ""); }, { immediate: true });

const showAgentLauncher = computed(
  () =>
    AGENT_LAUNCHER_UI_ENABLED &&
    auth.isAuthenticated &&
    agentChatInstalled.value &&
    route.meta.hideAppShell !== true &&
    route.meta.hideAgentLauncher !== true &&
    !route.path.startsWith("/email"),
);

async function loadAgentChatPluginState() {
  if (!AGENT_LAUNCHER_UI_ENABLED || !auth.isAuthenticated) {
    agentChatInstalled.value = false;
    return;
  }

  try {
    const response = await api.get<{
      plugins: Array<{ id: string; status: string; enabled: boolean }>;
    }>("/plugins");
    agentChatInstalled.value = response.plugins.some(
      (plugin) =>
        plugin.id === "me3.agent-chat" &&
        plugin.enabled &&
        plugin.status === "installed",
    );
  } catch {
    agentChatInstalled.value = false;
  }
}

function handlePluginChanged() {
  void loadAgentChatPluginState();
}

onMounted(async () => {
  await auth.ensureInitialized();
  if (AGENT_LAUNCHER_UI_ENABLED) {
    void loadAgentChatPluginState();
    window.addEventListener(pluginChangedEvent, handlePluginChanged);
  }
});

onBeforeUnmount(() => {
  if (AGENT_LAUNCHER_UI_ENABLED) {
    window.removeEventListener(pluginChangedEvent, handlePluginChanged);
  }
});

watch(
  () => auth.isAuthenticated,
  () => {
    if (AGENT_LAUNCHER_UI_ENABLED) {
      void loadAgentChatPluginState();
    }
  },
);
</script>

<template>
  <AppLoadingBar />
  <div
    class="app-root"
    :class="{
      'app-root--shelled': showAppShell,
      'app-root--no-wide-bar': showAppShell && route.meta.hideTopBarOnWide === true,
    }"
  >
    <AppTopBar v-if="showAppShell" />
    <div class="app-root__view">
      <RouterView />
    </div>
  </div>
  <p v-if="remoteApiHost" class="remote-dev-banner" role="status">
    <strong>Production data</strong>
    <span>Local UI is connected to {{ remoteApiHost }}. Campaign delivery is blocked.</span>
  </p>
  <Toaster
    position="bottom-center"
    theme="system"
    :close-button="true"
    :rich-colors="false"
    :duration="5000"
  />
  <AgentChatLauncher v-if="showAgentLauncher" />
  <AppTour v-if="showAppShell" />
</template>

<style scoped>
.app-root {
  min-height: 100%;
}

.app-root--shelled .app-root__view {
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  padding-top: var(--app-topbar-height);
}

/* Pages with their own navigation column (Email) drop the Back row on wide screens. */
@media (min-width: 641px) {
  .app-root--no-wide-bar {
    --app-topbar-height: 0px;
  }

  .app-root--no-wide-bar .app-top-bar {
    display: none;
  }
}

.remote-dev-banner {
  position: fixed;
  inset-inline-start: 50%;
  inset-block-end: 12px;
  z-index: 120;
  display: flex;
  align-items: center;
  gap: 7px;
  width: max-content;
  max-width: calc(100vw - 24px);
  margin: 0;
  padding: 7px 10px;
  border: 1px solid var(--ui-danger, #b42318);
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-danger-soft, #fff0ee);
  box-shadow: var(--ui-shadow-sm, 0 4px 16px rgb(0 0 0 / 12%));
  color: var(--ui-danger, #b42318);
  font-size: 12px;
  line-height: 1.25;
  text-align: center;
  transform: translateX(-50%);
}

.remote-dev-banner strong,
.remote-dev-banner span {
  color: inherit;
}

:global(body:has(.assistant-page--site-builder)) .remote-dev-banner {
  inset-inline-start: auto;
  inset-inline-end: 12px;
  transform: none;
}

@media (max-width: 640px) {
  .remote-dev-banner {
    align-items: flex-start;
    width: calc(100vw - 24px);
  }
}
</style>

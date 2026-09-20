<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import { Toaster } from "vue-sonner";
import { api } from "./api";
import AgentChatLauncher from "./components/AgentChatLauncher.vue";
import AppSideNav from "./components/AppSideNav.vue";
import SoulinkJoinPrompt from "./components/SoulinkJoinPrompt.vue";
import { useMailboxRealtime } from "./composables/useMailboxRealtime";
import { useAuthStore } from "./stores/auth";

/** Set true to show the floating agent chat launcher on supported pages. */
const AGENT_LAUNCHER_UI_ENABLED = false;

const route = useRoute();
const auth = useAuthStore();
useMailboxRealtime();
const remoteApiHost = import.meta.env.DEV
  ? import.meta.env.VITE_REMOTE_API_HOST || ""
  : "";
const agentChatInstalled = ref(false);
const soulinkModalOpen = ref(false);
const soulinkStatusLoaded = ref(false);
const soulinkAvailableToOwner = ref(false);
const soulinkConnected = ref(false);
const soulinkOrigin = ref("https://soulinkfoundation.org");
const soulinkBannerDismissed = ref(false);
const pluginChangedEvent = "me3:plugins-changed";
const soulinkBannerDismissalVersion = "v1";

type SoulinkShellStatus = {
  apiOrigin?: string | null;
  connection?: {
    status?: "pending" | "active" | "disconnected";
  } | null;
};

type CoreShellConfig = {
  ownerMe3AuthConfigured?: boolean;
};

const showAppShell = computed(
  () =>
    auth.isAuthenticated &&
    route.meta.requiresAuth === true &&
    route.meta.hideAppShell !== true,
);

const showAgentLauncher = computed(
  () =>
    AGENT_LAUNCHER_UI_ENABLED &&
    auth.isAuthenticated &&
    agentChatInstalled.value &&
    route.meta.hideAppShell !== true &&
    route.meta.hideAgentLauncher !== true &&
    !route.path.startsWith("/email"),
);

const showSoulinkBanner = computed(
  () =>
    showAppShell.value &&
    soulinkStatusLoaded.value &&
    !soulinkConnected.value &&
    !soulinkBannerDismissed.value &&
    !soulinkModalOpen.value,
);

function soulinkBannerStorageKey() {
  return `me3:soulink-banner-dismissed:${soulinkBannerDismissalVersion}:${auth.user?.id || "owner"}`;
}

function loadSoulinkBannerPreference() {
  try {
    soulinkBannerDismissed.value =
      window.localStorage.getItem(soulinkBannerStorageKey()) === "true";
  } catch {
    soulinkBannerDismissed.value = false;
  }
}

function dismissSoulinkBanner() {
  soulinkBannerDismissed.value = true;
  try {
    window.localStorage.setItem(soulinkBannerStorageKey(), "true");
  } catch {
    // The invitation remains dismissed for this session when storage is unavailable.
  }
}

function openSoulinkModal() {
  soulinkModalOpen.value = true;
}

function closeSoulinkModal() {
  soulinkModalOpen.value = false;
}

async function loadSoulinkStatus() {
  if (!auth.isAuthenticated) {
    soulinkStatusLoaded.value = false;
    soulinkAvailableToOwner.value = false;
    soulinkConnected.value = false;
    return;
  }

  try {
    const config = await api.get<CoreShellConfig>("/config");
    soulinkAvailableToOwner.value = config.ownerMe3AuthConfigured === true;
  } catch {
    soulinkAvailableToOwner.value = false;
  }

  if (soulinkAvailableToOwner.value) {
    try {
      const response = await api.get<SoulinkShellStatus>("/soulink/status");
      soulinkConnected.value = response.connection?.status === "active";
      if (response.apiOrigin) soulinkOrigin.value = response.apiOrigin;
    } catch {
      soulinkConnected.value = false;
    }
  } else {
    soulinkConnected.value = false;
  }

  soulinkStatusLoaded.value = true;
}

function handleSoulinkConnectionActive() {
  soulinkConnected.value = true;
  dismissSoulinkBanner();
}

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
  if (auth.isAuthenticated) {
    loadSoulinkBannerPreference();
    void loadSoulinkStatus();
  }
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
  (isAuthenticated) => {
    if (isAuthenticated) {
      loadSoulinkBannerPreference();
      void loadSoulinkStatus();
    } else {
      closeSoulinkModal();
      soulinkStatusLoaded.value = false;
      soulinkAvailableToOwner.value = false;
      soulinkConnected.value = false;
    }
    if (AGENT_LAUNCHER_UI_ENABLED) {
      void loadAgentChatPluginState();
    }
  },
);
</script>

<template>
  <div class="app-root" :class="{ 'app-root--shelled': showAppShell }">
    <AppSideNav v-if="showAppShell" />
    <div class="app-root__view">
      <div
        id="app-side-nav-mobile-page-controls"
        class="app-root__mobile-page-controls"
      />
      <RouterView />
    </div>
  </div>
  <SoulinkJoinPrompt
    v-if="showAppShell && soulinkAvailableToOwner"
    :open="soulinkModalOpen"
    :banner-visible="showSoulinkBanner"
    :soulink-url="soulinkOrigin"
    @open="openSoulinkModal"
    @close="closeSoulinkModal"
    @dismiss-banner="dismissSoulinkBanner"
    @connection-active="handleSoulinkConnectionActive"
  />
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
</template>

<style scoped>
.app-root {
  min-height: 100%;
}

.app-root--shelled .app-root__view {
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
}

.app-root__mobile-page-controls {
  display: flex;
  align-items: center;
  justify-content: stretch;
  min-width: 0;
  min-height: var(--app-shell-mobile-nav-height);
  padding: var(--workspace-topbar-padding-block) 8px
    var(--workspace-topbar-padding-block)
    var(--app-shell-mobile-nav-leading-padding);
  background: var(--color-bg);
  box-sizing: border-box;
}

.app-root__mobile-page-controls:empty {
  display: none;
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

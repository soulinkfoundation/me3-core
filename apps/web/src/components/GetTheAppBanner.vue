<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiIcon from "./UiIcon.vue";

// Phones using ME3 in a mobile browser get a nudge to the native apps, which are the better experience.
const APP_STORE_URL = "https://apps.apple.com/app/me3/id6787900414";
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=app.me3.mobile";
const DISMISS_KEY = "me3:get-the-app-dismissed-at";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const props = defineProps<{ enabled: boolean }>();

function detectPlatform(): "ios" | "android" | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua) && /Mobile/.test(ua)) return "android";
  return null;
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

const platform = detectPlatform();
const dismissed = ref(recentlyDismissed());
const narrow = ref(false);
let query: MediaQueryList | null = null;
const syncNarrow = () => { narrow.value = query?.matches ?? false; };

onMounted(() => {
  if (typeof window === "undefined" || !window.matchMedia) return;
  query = window.matchMedia("(max-width: 640px)");
  syncNarrow();
  query.addEventListener("change", syncNarrow);
});

const standalone = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
const storeUrl = platform === "ios" ? APP_STORE_URL : GOOGLE_PLAY_URL;
const visible = computed(() => props.enabled && platform !== null && !standalone && narrow.value && !dismissed.value);

// The fixed top bar and every page that sizes around it read --app-topbar-height, so the banner grows it.
watch(visible, shown => document.documentElement.classList.toggle("has-get-the-app-banner", shown), { immediate: true });
onBeforeUnmount(() => {
  query?.removeEventListener("change", syncNarrow);
  document.documentElement.classList.remove("has-get-the-app-banner");
});

function dismiss() {
  dismissed.value = true;
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
}
</script>

<template>
  <aside v-if="visible" class="get-the-app" aria-label="Get the ME3 app">
    <img class="get-the-app__icon" src="/me3-dog-head-emoji-smooth.webp" alt="" width="32" height="32">
    <p class="get-the-app__text"><strong>The ME3 app</strong> Faster, with notifications.</p>
    <a class="get-the-app__cta" :href="storeUrl" target="_blank" rel="noopener noreferrer">Get the app</a>
    <button type="button" class="get-the-app__close" aria-label="Not now" @click="dismiss">
      <UiIcon name="X" :size="16" aria-hidden="true" />
    </button>
  </aside>
</template>

<style scoped>
.get-the-app {
  position: fixed;
  inset: 0 0 auto;
  z-index: 71;
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--app-banner-height);
  padding: 0 6px 0 12px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-surface, var(--ui-bg));
  color: var(--ui-text);
}
.get-the-app__icon { flex: none; width: 32px; height: 32px; }
.get-the-app__text { flex: 1; min-width: 0; margin: 0; font-size: 13px; line-height: 1.3; color: var(--ui-text-muted); }
.get-the-app__text strong { display: block; color: var(--ui-text); font-weight: 600; }
.get-the-app__cta {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--ui-accent);
  color: var(--ui-accent-contrast);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}
.get-the-app__close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 44px;
  border: 0;
  background: none;
  color: var(--ui-text-muted);
  cursor: pointer;
}
.get-the-app__cta:focus-visible,
.get-the-app__close:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 8px; }
</style>

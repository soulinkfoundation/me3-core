<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { AGENT_LANDING_PAGE_SITE_TEMPLATE_ID } from "@me3-core/plugin-landing-pages";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";
import { useSitesStore } from "../stores/sites";
import { APP_FEATURE_ICONS } from "../utils/appFeatures";
import { ensurePluginAccess, invalidatePluginAccess } from "../utils/pluginAccess";
import { permanentPublicSiteUrl, resolvePublicProfileUrl } from "../utils/publicSiteUrl";
import { useAppToast } from "../composables/useAppToast";
import UiIcon from "./UiIcon.vue";
import Button from "./Button.vue";
import { useTheme, type ThemePreference } from "../composables/useTheme";

const auth = useAuthStore();
const sites = useSitesStore();
const route = useRoute();
const router = useRouter();
const { toastFromUnknown } = useAppToast();
const { themePreference, setThemePreference } = useTheme();
const appearances = [
  { id: "system", label: "System", icon: "Monitor" },
  { id: "light", label: "Light", icon: "Sun" },
  { id: "dark", label: "Dark", icon: "Moon" },
] as const satisfies readonly { id: ThemePreference; label: string; icon: "Monitor" | "Sun" | "Moon" }[];
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const failedPhoto = ref(false);
const loggingOut = ref(false);
const plugins = ref<Awaited<ReturnType<typeof ensurePluginAccess>>>([]);
const features = ref<Record<string, boolean>>({ calendar: true });
const profile = computed(() => sites.sites.find(site => site.site_role === "profile"));
const username = computed(() => profile.value?.username || auth.user?.username || "");
const name = computed(() => auth.user?.name || username.value || "Your profile");
const publicUrl = ref(permanentPublicSiteUrl(username.value));
const photo = computed(() => {
  const source = profile.value?.avatar?.trim();
  if (!source || failedPhoto.value) return null;
  const file = source.replace(/^\.?\//, "");
  return file.startsWith("files/") ? `/preview/${encodeURIComponent(username.value)}/${file}` : source;
});
const editSite = computed(() => {
  const site = profile.value;
  if (!site) return "/sites";
  if (site.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID && site.builder_thread_id) {
    return { path: "/assistant", query: { mode: "site-builder", thread: site.builder_thread_id } };
  }
  return { path: "/create", query: { site: site.username, siteId: site.id, return: "/assistant" } };
});
function installed(id: string) { return plugins.value.some(plugin => plugin.id === id && plugin.enabled && plugin.status === "installed"); }
// These are the drawer's existing gates. Socials/Accounts are plugin-owned; the
// Wheel, Email and Files are Core features. No hosted entitlement is inferred here.
const destinations = computed(() => [
  { label: "Calendar", path: "/calendar", emoji: APP_FEATURE_ICONS.calendar, visible: installed("me3.calendar") && features.value.calendar },
  { label: "People", path: "/people", emoji: APP_FEATURE_ICONS.people, visible: true },
  { label: "Email", path: "/email", emoji: APP_FEATURE_ICONS.email, visible: features.value.email },
  { label: "Writing", path: "/journal", emoji: APP_FEATURE_ICONS.journal, visible: installed("me3.journal") && features.value.journal },
  { label: "Tasks", path: "/tasks", emoji: "✅", visible: installed("me3.mission-control") && features.value.tasks },
  { label: "Mission", path: "/mission", emoji: "🚀", visible: installed("me3.mission-control") },
  { label: "Files", path: "/files", emoji: APP_FEATURE_ICONS.files, visible: features.value.files },
  { label: "Socials", path: "/social", emoji: APP_FEATURE_ICONS.social, visible: installed("me3.social-publishing") },
  { label: "Accounts", path: "/accounts", emoji: APP_FEATURE_ICONS.accounts, visible: installed("me3.accounts") },
  { label: "Wheel of Life", path: "/wheel-of-life", emoji: "🛞", visible: features.value["wheel-of-life"] },
  { label: "Website", path: "/sites", emoji: APP_FEATURE_ICONS.sites, visible: true },
  { label: "Chat", path: "/assistant?view=chat", emoji: "🤖", visible: features.value.assistant },
].filter(destination => destination.visible));

async function loadNavigation() {
  const [pluginResult, featureResult] = await Promise.allSettled([
    ensurePluginAccess(), api.get<{ features: { id: string; visible: boolean }[] }>("/navigation-features"),
  ]);
  if (pluginResult.status === "fulfilled") plugins.value = pluginResult.value;
  if (featureResult.status === "fulfilled") features.value = { ...features.value, ...Object.fromEntries(featureResult.value.features.map(feature => [feature.id, feature.visible])) };
}
function refreshPlugins() { invalidatePluginAccess(); void loadNavigation(); }
function close(restoreFocus = false) { open.value = false; if (restoreFocus) void nextTick(() => trigger.value?.focus()); }
async function toggle() {
  if (open.value) { close(true); return; }
  open.value = true;
  await nextTick();
  menu.value?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
}
function keys(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if (event.key === "Tab") { close(); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = [...menu.value!.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)")];
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
function outside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close();
}
async function logOut() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    // Only clear the local session after the server has revoked its cookie.
    await api.post("/auth/logout");
    await auth.refreshSession();
    close();
    await router.push("/login");
  } catch (error) { toastFromUnknown(error, "Couldn't log out. Try again."); }
  finally { loggingOut.value = false; }
}
watch(() => route.path, () => close());
watch([profile, username], async ([site, handle], _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  failedPhoto.value = false;
  const url = await resolvePublicProfileUrl(handle, site);
  if (current) publicUrl.value = url;
}, { immediate: true });
onMounted(() => {
  void sites.ensureSites(); void loadNavigation();
  document.addEventListener("pointerdown", outside);
  window.addEventListener("me3:plugins-changed", refreshPlugins);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  window.removeEventListener("me3:plugins-changed", refreshPlugins);
});
</script>

<template>
  <button ref="trigger" type="button" class="profile-trigger" aria-label="Open profile menu" aria-haspopup="menu" :aria-expanded="open" aria-controls="app-profile-menu" @click="toggle" @keydown.down.prevent="!open && toggle()">
    <img v-if="photo" :src="photo" alt="" @error="failedPhoto = true" />
    <span v-else aria-hidden="true">{{ name.slice(0, 1).toUpperCase() }}</span>
  </button>
  <Teleport to="body">
    <section v-if="open" id="app-profile-menu" ref="menu" class="profile-menu" role="menu" aria-label="Your profile and navigation" @keydown="keys">
      <header class="profile-menu__header">
        <img v-if="photo" :src="photo" alt="" @error="failedPhoto = true" />
        <span v-else class="profile-menu__initial" aria-hidden="true">{{ name.slice(0, 1).toUpperCase() }}</span>
        <div><strong>{{ name }}</strong><a :href="publicUrl" role="menuitem" tabindex="-1" target="_blank" rel="noopener noreferrer">{{ publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') }}<UiIcon name="ArrowUpRight" :size="14" /></a><RouterLink :to="editSite" role="menuitem" tabindex="-1" @click="close()">Edit site<UiIcon name="Pencil" :size="14" /></RouterLink></div>
      </header>
      <nav aria-label="Go to"><h2>Go to</h2>
        <RouterLink v-for="destination in destinations" :key="destination.path" :to="destination.path" class="profile-menu__row" role="menuitem" tabindex="-1" :aria-label="destination.label" :aria-current="route.fullPath === destination.path ? 'page' : undefined" @click="close()"><span class="profile-menu__emoji" aria-hidden="true">{{ destination.emoji }}</span><span>{{ destination.label }}</span></RouterLink>
      </nav>
      <div class="profile-menu__settings">
        <div class="profile-menu__appearance" role="group" aria-label="Appearance">
          <Button v-for="option in appearances" :key="option.id" :color="themePreference === option.id ? 'primary' : 'ghost'" size="large" role="menuitemradio" :aria-checked="themePreference === option.id" :aria-label="`${option.label} appearance`" @click="setThemePreference(option.id)"><UiIcon :name="option.icon" :size="16" />{{ option.label }}</Button>
        </div>
        <RouterLink to="/settings" class="profile-menu__row" aria-label="Settings" role="menuitem" tabindex="-1" @click="close()"><UiIcon name="Settings" :size="18" />Settings</RouterLink>
        <RouterLink to="/settings?section=connections" class="profile-menu__row" role="menuitem" tabindex="-1" @click="close()"><UiIcon name="Link" :size="18" />App connections</RouterLink>
        <RouterLink to="/settings?section=plugins" class="profile-menu__row" role="menuitem" tabindex="-1" @click="close()"><UiIcon name="Puzzle" :size="18" />Plugins</RouterLink>
      </div>
      <button type="button" class="profile-menu__row profile-menu__logout" role="menuitem" tabindex="-1" :disabled="loggingOut" @click="logOut"><UiIcon name="LogOut" :size="18" />{{ loggingOut ? 'Logging out…' : 'Log out' }}</button>
    </section>
  </Teleport>
</template>

<style scoped>
.profile-trigger { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 5px; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text); cursor: pointer; }
.profile-trigger img, .profile-trigger span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: var(--ui-surface-muted); font: 500 14px var(--font-sans); }
.profile-trigger:hover { background: var(--ui-surface-muted); }
.profile-menu { position: fixed; top: calc(var(--app-topbar-height) - 4px); right: 14px; z-index: 100; width: min(340px, calc(100vw - 28px)); max-height: calc(100dvh - var(--app-topbar-height) - 16px); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 10px; border-radius: 24px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.profile-menu__header { display: flex; align-items: center; gap: 12px; padding: 10px 12px 16px; }
.profile-menu__header > img, .profile-menu__initial { display: grid; place-items: center; flex: 0 0 auto; width: 52px; height: 52px; border-radius: 50%; object-fit: cover; background: var(--ui-surface-muted); font-size: 22px; }
.profile-menu__header > div { display: grid; min-width: 0; gap: 4px; }
.profile-menu__header strong { font-size: 17px; font-weight: 600; }
.profile-menu__header a { display: flex; align-items: center; gap: 4px; width: fit-content; max-width: 100%; overflow-wrap: anywhere; color: var(--ui-text-muted); text-decoration: none; font-size: 13px; min-height: 24px; }
.profile-menu__header a:last-child { font-weight: 600; color: var(--ui-accent-strong); }
.profile-menu h2 { margin: 0; padding: 2px 12px 6px; font-size: 12px; font-weight: 500; color: var(--ui-text-muted); }
.profile-menu__row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box; border: 0; border-radius: 12px; color: var(--ui-text); background: transparent; font: 500 15px var(--font-sans); text-decoration: none; text-align: left; cursor: pointer; }
.profile-menu__row:hover, .profile-menu__row[aria-current="page"] { background: var(--ui-surface-muted); }
.profile-menu__emoji { width: 22px; text-align: center; font: 20px/1 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
.profile-menu__settings { padding-top: 8px; margin-top: 8px; box-shadow: 0 -1px var(--ui-border); }
.profile-menu__appearance { display: flex; gap: 2px; margin: 4px 0 10px; padding: 3px; border-radius: 26px; background: var(--ui-surface-muted); }
.profile-menu__appearance > button { flex: 1; min-width: 0; min-height: 44px; padding-inline: 8px; }
.profile-menu__appearance :deep(.me3-btn__label) { display: flex; align-items: center; gap: 5px; }
.profile-menu__appearance :deep(.me3-btn--primary svg) { color: inherit; }
.profile-menu__settings svg, .profile-menu__logout svg { margin-inline: 2px; color: var(--ui-text-muted); }
.profile-menu__logout { color: var(--ui-danger, #b42318); }
.profile-menu__logout:disabled { opacity: .5; cursor: wait; }
.profile-trigger:focus-visible, .profile-menu [role="menuitem"]:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
</style>

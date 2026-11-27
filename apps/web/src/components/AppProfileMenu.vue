<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { AGENT_LANDING_PAGE_SITE_TEMPLATE_ID } from "@me3-core/plugin-landing-pages";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";
import { useSitesStore } from "../stores/sites";
import { useMessagingStore } from "../stores/messaging";
import { APP_FEATURE_ICONS } from "../utils/appFeatures";
import { ensurePluginAccess, invalidatePluginAccess } from "../utils/pluginAccess";
import { permanentPublicSiteUrl, resolvePublicProfileUrl } from "../utils/publicSiteUrl";
import { useAppToast } from "../composables/useAppToast";
import UiIcon from "./UiIcon.vue";
import { useTheme, type ThemePreference } from "../composables/useTheme";

// On a feature page the menu replaces the header's X, so Home leads the list there.
defineProps<{ showHome?: boolean }>();
const auth = useAuthStore();
const sites = useSitesStore();
// People's Soulink conversations: Messages sits first in the menu, with what waits on you, as on the phones.
const messaging = useMessagingStore();
const route = useRoute();
const router = useRouter();
const { toastFromUnknown } = useAppToast();
const { themePreference, setThemePreference } = useTheme();
const appearances = [
  { id: "light", label: "Light appearance", icon: "Sun" },
  { id: "dark", label: "Dark appearance", icon: "Moon" },
  { id: "system", label: "Match system appearance", icon: "Monitor" },
] as const satisfies readonly { id: ThemePreference; label: string; icon: "Monitor" | "Sun" | "Moon" }[];
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const failedPhoto = ref(false);
const loggingOut = ref(false);
const plugins = ref<Awaited<ReturnType<typeof ensurePluginAccess>>>([]);
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
  if (!site) return "/create";
  if (site.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID && site.builder_thread_id) {
    return { path: "/assistant", query: { mode: "site-builder", thread: site.builder_thread_id } };
  }
  return { path: "/create", query: { site: site.username, siteId: site.id, return: "/assistant" } };
});
function installed(id: string) { return plugins.value.some(plugin => plugin.id === id && plugin.enabled && plugin.status === "installed"); }
// One Go to list shared with iOS (ProfileMenu.swift) and Android (HomeProfileSheet.kt), ordered for a solo
// business owner: daily work (Email, Calendar, Tasks), growth (People, Campaigns, Social), then Writing,
// the business (Accounts, Mission) and Files. Socials/Accounts are plugin-owned; Email and Files are Core
// features. Campaigns is its own destination (Business); until plan gating lands its plugin record is the visibility gate. Wheel of Life lives in Mission, Edit website leads the
// list in the template and Chat is the top switch, so none of them repeat here. No hosted entitlement is inferred.
const destinations = computed(() => [
  { label: "Email", path: "/email", emoji: APP_FEATURE_ICONS.email, visible: true },
  { label: "Calendar", path: "/calendar", emoji: APP_FEATURE_ICONS.calendar, visible: installed("me3.calendar") },
  { label: "Tasks", path: "/tasks", emoji: "✅", visible: installed("me3.mission-control") },
  { label: "People", path: "/people", emoji: APP_FEATURE_ICONS.people, visible: true },
  { label: "Campaigns", path: "/email/campaigns", emoji: APP_FEATURE_ICONS.campaigns, visible: installed("me3.email-campaigns") },
  // Social is on for every owner whose plan includes it; the Worker switches its plugin record on (plan-features.ts).
  { label: "Social", path: "/social", emoji: APP_FEATURE_ICONS.social, visible: installed("me3.social-publishing") },
  { label: "Writing", path: "/journal", emoji: APP_FEATURE_ICONS.journal, visible: installed("me3.journal") },
  { label: "Accounts", path: "/accounts", emoji: APP_FEATURE_ICONS.accounts, visible: installed("me3.accounts") },
  { label: "Mission", path: "/mission", emoji: "🚀", visible: installed("me3.mission-control") },
  { label: "Files", path: "/files", emoji: APP_FEATURE_ICONS.files, visible: true },
].filter(destination => destination.visible));

async function loadNavigation() {
  plugins.value = await ensurePluginAccess().catch(() => plugins.value);
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
  <button ref="trigger" type="button" class="profile-trigger" data-tour-target="profile_menu" aria-label="Open profile menu" aria-haspopup="menu" :aria-expanded="open" aria-controls="app-profile-menu" @click="toggle" @keydown.down.prevent="!open && toggle()">
    <img v-if="photo" :src="photo" alt="" @error="failedPhoto = true" />
    <span v-else aria-hidden="true">{{ name.slice(0, 1).toUpperCase() }}</span>
    <span v-if="messaging.waiting > 0" class="profile-trigger__badge" :aria-label="`${messaging.waiting} waiting`">{{ messaging.waiting > 99 ? "99+" : messaging.waiting }}</span>
  </button>
  <Teleport to="body">
    <section v-if="open" id="app-profile-menu" ref="menu" class="profile-menu" role="menu" aria-label="Your profile and navigation" @keydown="keys">
      <!-- Centred like the iOS and Android profile sheets: photo, name, then the site address. -->
      <header class="profile-menu__header">
        <img v-if="photo" :src="photo" alt="" @error="failedPhoto = true" />
        <span v-else class="profile-menu__initial" aria-hidden="true">{{ name.slice(0, 1).toUpperCase() }}</span>
        <strong>{{ name }}</strong>
        <a :href="publicUrl" role="menuitem" tabindex="-1" target="_blank" rel="noopener noreferrer"><span>{{ publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') }}</span><UiIcon name="ArrowUpRight" :size="14" /></a>
      </header>
      <nav aria-label="Go to">
        <RouterLink v-if="showHome" to="/assistant" class="profile-menu__row" role="menuitem" tabindex="-1" aria-label="Home" data-testid="menu-home" @click="close()"><span class="profile-menu__emoji" aria-hidden="true">🏠</span><span>Home</span></RouterLink>
        <RouterLink :to="editSite" class="profile-menu__row" role="menuitem" tabindex="-1" aria-label="Edit website" @click="close()"><span class="profile-menu__emoji" aria-hidden="true">🌐</span><span>Edit website</span></RouterLink>
        <RouterLink v-if="messaging.status !== 'unavailable'" to="/conversations" class="profile-menu__row" role="menuitem" tabindex="-1" aria-label="Messages" :aria-current="route.path === '/conversations' ? 'page' : undefined" data-testid="menu-messages" @click="close()"><span class="profile-menu__emoji" aria-hidden="true">💬</span><span>Messages</span><span v-if="messaging.waiting > 0" class="profile-menu__count">{{ messaging.waiting }}</span></RouterLink>
        <RouterLink v-for="destination in destinations" :key="destination.path" :to="destination.path" class="profile-menu__row" :data-tour-target="destination.path === '/accounts' ? 'menu_accounts' : destination.path === '/social' ? 'menu_social' : undefined" role="menuitem" tabindex="-1" :aria-label="destination.label" :aria-current="route.fullPath === destination.path ? 'page' : undefined" @click="close()"><span class="profile-menu__emoji" aria-hidden="true">{{ destination.emoji }}</span><span>{{ destination.label }}</span></RouterLink>
      </nav>
      <div class="profile-menu__settings">
        <RouterLink to="/agent" class="profile-menu__row" role="menuitem" tabindex="-1" @click="close()"><UiIcon name="Brain" :size="18" />Your assistant</RouterLink>
        <RouterLink to="/settings" class="profile-menu__row" aria-label="Settings" role="menuitem" tabindex="-1" @click="close()"><UiIcon name="Settings" :size="18" />Settings</RouterLink>
      </div>
      <div class="profile-menu__footer">
        <div class="profile-menu__appearance" role="group" aria-label="Appearance">
          <button v-for="option in appearances" :key="option.id" type="button" :class="{ 'is-active': themePreference === option.id }" role="menuitemradio" tabindex="-1" :aria-checked="themePreference === option.id" :aria-label="option.label" :title="option.label" @click="setThemePreference(option.id)"><UiIcon :name="option.icon" :size="16" /></button>
        </div>
        <button type="button" class="profile-menu__row profile-menu__logout" role="menuitem" tabindex="-1" :disabled="loggingOut" @click="logOut"><UiIcon name="LogOut" :size="18" />{{ loggingOut ? 'Logging out…' : 'Log out' }}</button>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.profile-trigger { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 5px; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text); cursor: pointer; }
.profile-trigger img, .profile-trigger span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: var(--ui-surface-muted); font: 500 14px var(--font-sans); }
.profile-trigger:hover { background: var(--ui-surface-muted); }
.profile-menu { position: fixed; top: calc(var(--app-topbar-height) - 4px); right: 14px; z-index: 100; width: min(340px, calc(100vw - 28px)); max-height: calc(100dvh - var(--app-topbar-height) - 16px); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 10px; border-radius: 24px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.profile-menu__header { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 12px 12px; text-align: center; }
.profile-menu__header > img, .profile-menu__initial { display: grid; place-items: center; flex: 0 0 auto; width: 72px; height: 72px; margin-bottom: 4px; border-radius: 50%; object-fit: cover; background: var(--ui-surface-muted); font-size: 28px; }
.profile-menu__header strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 19px; font-weight: 700; }
.profile-menu__header a { display: flex; align-items: center; gap: 4px; max-width: 100%; min-height: 32px; color: var(--ui-text-muted); text-decoration: none; font-size: 14px; }
.profile-menu__header a span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.profile-menu__header a svg { flex: 0 0 auto; }
.profile-menu h2 { margin: 0; padding: 2px 12px 6px; font-size: 12px; font-weight: 500; color: var(--ui-text-muted); }
.profile-menu__row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box; border: 0; border-radius: 12px; color: var(--ui-text); background: transparent; font: 500 15px var(--font-sans); text-decoration: none; text-align: left; cursor: pointer; }
.profile-menu__row:hover, .profile-menu__row[aria-current="page"] { background: var(--ui-surface-muted); }
.profile-menu__count { display: grid; min-width: 22px; height: 22px; place-items: center; margin-left: auto; border-radius: 999px; padding: 0 6px; background: var(--ui-accent); color: var(--ui-accent-contrast, #fff); font: 700 12px var(--font-sans); }
.profile-trigger { position: relative; }
.profile-trigger span.profile-trigger__badge { position: absolute; top: 0; right: 0; display: grid; width: auto; min-width: 18px; height: 18px; place-items: center; border: 2px solid var(--ui-bg, #fff); border-radius: 999px; padding: 0 4px; background: var(--ui-accent); color: var(--ui-accent-contrast, #fff); font: 700 11px var(--font-sans); }
.profile-menu__emoji { width: 22px; text-align: center; font: 20px/1 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
.profile-menu__settings { padding-top: 8px; margin-top: 8px; box-shadow: 0 -1px var(--ui-border); }
.profile-menu__footer { display: flex; align-items: center; gap: 8px; padding: 6px 0 0 4px; }
.profile-menu__appearance { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.profile-menu__appearance > button { display: grid; place-items: center; width: 40px; height: 36px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.profile-menu__appearance > button.is-active { background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm, 0 1px 3px rgba(0, 0, 0, .12)); }
.profile-menu__appearance > button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.profile-menu__settings svg, .profile-menu__logout svg { margin-inline: 2px; color: var(--ui-text-muted); }
.profile-menu__logout { width: auto; margin-left: auto; color: var(--ui-danger, #b42318); }
.profile-menu__logout svg { color: inherit; }
.profile-menu__logout:disabled { opacity: .5; cursor: wait; }
.profile-trigger:focus-visible, .profile-menu [role="menuitem"]:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
</style>

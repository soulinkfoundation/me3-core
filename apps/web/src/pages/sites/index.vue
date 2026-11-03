<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { api } from "../../api";
import { AGENT_LANDING_PAGE_SITE_TEMPLATE_ID } from "@me3-core/plugin-landing-pages";
import { useSitesStore, type Site } from "../../stores/sites";
import BrandLogo from "../../components/BrandLogo.vue";
import AppPageBar from "../../components/AppPageBar.vue";
import AppSwitch from "../../components/AppSwitch.vue";
import Button from "../../components/Button.vue";
import UiIcon from "../../components/UiIcon.vue";

definePage({
  meta: {
    requiresAuth: true,
    title: "Website | ME3",
    description: "Manage your website.",
    robots: "noindex,follow",
  },
});

const sites = useSitesStore();
const sitesReady = ref(sites.loaded);

const profileSite = computed(() =>
  sites.sites.find((site) => site.site_role === "profile"),
);
/** Sites made before ME3 moved to one site per owner. They stay live, so they stay reachable here. */
const olderSites = computed(() =>
  sites.sites.filter((site) => site.site_role === "organization"),
);
const persistentSites = computed(() => [
  ...(profileSite.value ? [profileSite.value] : []),
  ...olderSites.value,
]);
const siteGroups = computed(() => [
  { id: "website", label: null, sites: profileSite.value ? [profileSite.value] : [] },
  { id: "older", label: "Older sites", sites: olderSites.value },
].filter((group) => group.sites.length));
const visibleSitesError = computed(() => {
  const message = sites.error?.trim();
  if (!message || message.toLowerCase().includes("activate me3 landing pages")) {
    return null;
  }
  return message;
});
const createProfileRoute = {
  path: "/create",
  query: { new: "1", siteRole: "profile", return: "/sites" },
};
function siteRoute(site: Site) {
  if (
    site.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID &&
    site.builder_thread_id
  ) {
    return {
      path: "/assistant",
      query: { mode: "site-builder", thread: site.builder_thread_id },
    };
  }
  return `/sites/${encodeURIComponent(site.username)}`;
}

function siteLinkLabel(site: Site): string {
  return site.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID &&
    site.builder_thread_id
    ? `Continue building @${site.username} with ME3`
    : `Open @${site.username}`;
}

function statusLabel(published: boolean): string {
  return published ? "Published" : "Draft";
}

function resolveSiteAvatar(
  value: string | null | undefined,
  username: string,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(?:https?:|data:|blob:|\/preview\/)/i.test(trimmed)) return trimmed;

  const normalized = trimmed.replace(/^\.?\//, "").replace(/^(\.\.\/)+/, "");
  if (normalized.startsWith("files/")) {
    return `/preview/${encodeURIComponent(username)}/${normalized}`;
  }
  return trimmed;
}

function siteAvatar(site: Site): string | null {
  return resolveSiteAvatar(site.avatar, site.username);
}

// The "Made with ME3" badge on published pages. "auto" follows the install default:
// on for self-hosted sites and managed free trials, off once a managed install is paying.
type SiteBadgeState = { preference: "auto" | "shown" | "hidden"; automaticallyShown: boolean };
const siteBadge = ref<SiteBadgeState | null>(null);
const siteBadgeSaving = ref(false);
const siteBadgeShown = computed(() =>
  siteBadge.value?.preference === "auto"
    ? siteBadge.value.automaticallyShown
    : siteBadge.value?.preference === "shown",
);
const hasPublishedSite = computed(() => persistentSites.value.some((site) => site.published_at));

async function loadSiteBadge(): Promise<void> {
  siteBadge.value = await api.get<SiteBadgeState>("/site-badge").catch(() => null);
}

async function setSiteBadgeShown(shown: boolean): Promise<void> {
  if (!siteBadge.value) return;
  const previous = siteBadge.value;
  siteBadge.value = { ...previous, preference: shown ? "shown" : "hidden" };
  siteBadgeSaving.value = true;
  try {
    siteBadge.value = await api.put<SiteBadgeState>("/site-badge", { preference: shown ? "shown" : "hidden" });
  } catch {
    siteBadge.value = previous;
  } finally {
    siteBadgeSaving.value = false;
  }
}

onMounted(async () => {
  await sites.ensureSites();
  sitesReady.value = true;
  void loadSiteBadge();
});
</script>

<template>
  <div class="sites-page">
    <main class="sites-shell">
      <AppPageBar title="Website" />

      <p
        v-if="visibleSitesError"
        class="sites-message sites-message--error"
        role="alert"
      >
        {{ visibleSitesError }}
      </p>

      <section
        v-if="sitesReady && !visibleSitesError && !profileSite"
        class="profile-callout"
        aria-labelledby="profile-callout-title"
      >
        <div class="profile-callout__icon" aria-hidden="true">
          <BrandLogo alt="" />
        </div>
        <div>
          <h2 id="profile-callout-title">Create your website</h2>
          <p>Your website is your home on ME3.</p>
        </div>
        <Button color="primary" shape="soft" size="large" :to="createProfileRoute">
          Create website
        </Button>
      </section>

      <template v-if="sitesReady">
        <section
          v-for="group in siteGroups"
          :key="group.id"
          class="sites-group"
          :aria-label="group.label || 'Your website'"
        >
          <h2 v-if="group.label" class="sites-group__title">{{ group.label }}</h2>
          <div class="sites-grid">
            <RouterLink
              v-for="ownedSite in group.sites"
              :key="ownedSite.id"
              class="site-card"
              :to="siteRoute(ownedSite)"
              :aria-label="siteLinkLabel(ownedSite)"
            >
              <BrandLogo
                v-if="ownedSite.site_role === 'profile'"
                class="site-card__logo"
                alt="ME3"
              />
              <img
                v-else-if="siteAvatar(ownedSite)"
                class="site-card__avatar"
                :src="siteAvatar(ownedSite)!"
                alt=""
              />
              <span v-else class="site-card__icon" aria-hidden="true">
                <UiIcon name="BriefcaseBusiness" :size="28" />
              </span>
              <h2>@{{ ownedSite.username }}</h2>
              <span
                class="site-status"
                :class="{ 'site-status--published': ownedSite.published_at }"
              >
                {{ statusLabel(Boolean(ownedSite.published_at)) }}
              </span>
            </RouterLink>
          </div>
        </section>
      </template>

      <div v-if="siteBadge && hasPublishedSite" class="site-badge-setting">
        <div>
          <strong>Made with ME3 badge</strong>
          <p>A small link in the corner of your published pages.</p>
        </div>
        <AppSwitch
          :model-value="siteBadgeShown"
          label="Show the Made with ME3 badge"
          :disabled="siteBadgeSaving"
          @update:model-value="setSiteBadgeShown"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.sites-page {
  min-height: 100vh;
  padding: var(--workspace-topbar-height) 24px 72px;
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
}

.sites-shell {
  width: min(100%, 980px);
  margin: 0 auto;
}

.site-badge-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  padding: 12px 12px 12px 18px;
  border-radius: 18px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

.site-badge-setting strong {
  font-size: 15px;
  font-weight: 600;
}

.site-badge-setting p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.sites-group + .sites-group {
  margin-top: 28px;
}

.sites-group__title {
  margin: 0 0 12px;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 600;
}

.sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.profile-callout h2,
.site-card h2 {
  margin: 0;
  letter-spacing: -0.025em;
}

.profile-callout p {
  color: var(--ui-text-muted, var(--color-text-muted));
}





.sites-message {
  margin: 0 0 18px;
  padding: 14px 16px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
  line-height: 1.5;
}

.sites-message--error {
  border-color: color-mix(in srgb, var(--ui-danger, #b42318) 45%, var(--ui-border));
  color: var(--ui-danger, #b42318);
}

.profile-callout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  margin-bottom: 28px;
  padding: 22px;
  border: 1px solid var(--ui-border-strong, var(--color-border));
  border-radius: var(--ui-radius-lg, 16px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-sm, 0 1px 2px rgb(15 23 42 / 0.05));
}

.profile-callout__icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.profile-callout__icon :deep(img) {
  width: 34px;
  height: auto;
}

.profile-callout p {
  max-width: 58ch;
  margin: 5px 0 0;
  line-height: 1.5;
}

.sites-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.site-card {
  position: relative;
  display: flex;
  min-height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-lg, 16px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-sm, 0 1px 2px rgb(15 23 42 / 0.05));
  color: inherit;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
}

.site-status {
  flex: 0 0 auto;
  padding: 4px 8px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 999px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.72rem;
  font-weight: 700;
}

.site-status--published {
  border-color: color-mix(in srgb, var(--ui-accent, #13a27d) 45%, var(--ui-border));
  background: var(--ui-accent-soft, color-mix(in srgb, var(--ui-accent, #13a27d) 10%, transparent));
  color: var(--ui-accent-strong, var(--color-accent));
}

.site-card__logo {
  display: block;
  width: 76px;
  height: auto;
  margin-bottom: 16px;
}

.site-card__avatar {
  display: block;
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  border-radius: var(--ui-radius-lg, 16px);
  object-fit: cover;
}

.site-card__icon {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  margin-bottom: 16px;
  border-radius: var(--ui-radius-lg, 16px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.site-card h2 {
  font-size: 1.35rem;
}

.site-card .site-status {
  margin-top: 12px;
}

.site-card:focus-visible {
  outline: 3px solid var(--ui-accent, var(--color-accent));
  outline-offset: 3px;
}

@media (prefers-reduced-motion: no-preference) {
  .site-card {
    transition:
      border-color 160ms ease,
      box-shadow 160ms ease,
      transform 160ms ease;
  }

  .site-card:hover {
    border-color: var(--ui-border-strong, var(--color-border));
    box-shadow: var(--ui-shadow-md, 0 12px 24px rgb(15 23 42 / 0.08));
    transform: translateY(-2px);
  }
}

@media (max-width: 720px) {
  .sites-page {
    padding: var(--workspace-topbar-padding-block) 16px 48px;
  }

  .profile-callout {
    grid-template-columns: auto minmax(0, 1fr);
  }

  

  .profile-callout > :deep(.me3-btn) {
    grid-column: 1 / -1;
    width: 100%;
  }

  .sites-grid {
    grid-template-columns: 1fr;
  }

}

@media (max-width: 520px) {

}
</style>

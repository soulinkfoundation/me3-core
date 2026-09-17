<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { api } from "../../api";
import { AGENT_LANDING_PAGE_SITE_TEMPLATE_ID } from "@me3-core/plugin-landing-pages";
import {
  useSitesStore,
  type Site,
  type SiteQuota,
} from "../../stores/sites";
import BrandLogo from "../../components/BrandLogo.vue";
import AppDialog from "../../components/AppDialog.vue";
import Button from "../../components/Button.vue";
import UiIcon from "../../components/UiIcon.vue";
import { ASSISTANT_SITE_BUILDER_STARTER_PROMPT } from "../../utils/assistantSiteBuilder";

definePage({
  meta: {
    requiresAuth: true,
    title: "Sites | ME3",
    description: "Manage your ME3 sites.",
    robots: "noindex,follow",
  },
});

const sites = useSitesStore();
const quota = ref<SiteQuota | null>(null);
const sitesReady = ref(sites.loaded);
const quotaLoading = ref(true);
const addSiteDialogOpen = ref(false);
const showFeatureDiscovery = ref(false);
const dismissingFeatureDiscovery = ref(false);

const profileSite = computed(() =>
  sites.sites.find((site) => site.site_role === "profile"),
);
const additionalSites = computed(() =>
  sites.sites.filter((site) => site.site_role === "organization"),
);
const persistentSites = computed(() => [
  ...(profileSite.value ? [profileSite.value] : []),
  ...additionalSites.value,
]);
const visibleSitesError = computed(() => {
  const message = sites.error?.trim();
  if (!message || message.toLowerCase().includes("activate me3 landing pages")) {
    return null;
  }
  return message;
});
const canCreateProfile = computed(
  () =>
    !profileSite.value &&
    quota.value?.can_create_profile === true,
);
const canCreateBusinessSite = computed(
  () =>
    Boolean(profileSite.value) &&
    quota.value?.can_create_additional_site === true,
);
const profileCreationBlockReason = computed(() => {
  if (!sitesReady.value || quotaLoading.value) return "Checking availability…";
  if (!quota.value) {
    return "Site availability could not be loaded. Refresh and try again.";
  }
  return "Your current plan’s ME3 Profile limit has been reached.";
});
const businessSiteCreationBlockReason = computed(() => {
  if (sitesReady.value && !profileSite.value) return "Create a ME3 Profile first.";
  if (!sitesReady.value || quotaLoading.value) return "Checking availability…";
  if (!quota.value) {
    return "Site availability could not be loaded. Refresh and try again.";
  }
  return "Your current plan’s Business Site limit has been reached.";
});

const createProfileRoute = {
  path: "/create",
  query: { new: "1", siteRole: "profile", return: "/sites" },
};
const buildWithMe3Route = {
  path: "/assistant",
  query: {
    mode: "site-builder",
    prompt: ASSISTANT_SITE_BUILDER_STARTER_PROMPT,
  },
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

async function refreshQuota(): Promise<void> {
  quota.value = await sites.getSiteQuota();
}

async function loadDashboardDetails(): Promise<void> {
  try {
    await refreshQuota();
  } finally {
    quotaLoading.value = false;
  }
}

async function loadFeatureDiscovery(): Promise<void> {
  try {
    const response = await api.get<{ show: boolean }>("/feature-discovery");
    showFeatureDiscovery.value = response.show;
  } catch {
    showFeatureDiscovery.value = false;
  }
}

async function dismissFeatureDiscovery(): Promise<void> {
  dismissingFeatureDiscovery.value = true;
  try {
    await api.post("/feature-discovery/dismiss", {});
    showFeatureDiscovery.value = false;
  } finally {
    dismissingFeatureDiscovery.value = false;
  }
}

onMounted(async () => {
  await sites.ensureSites();
  sitesReady.value = true;
  void loadDashboardDetails();
  void loadFeatureDiscovery();
});
</script>

<template>
  <div class="sites-page">
    <main class="sites-shell">
      <h1 class="sr-only">Sites</h1>
      <header class="sites-header">
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          aria-label="Add site"
          title="Add site"
          type="button"
          @click="addSiteDialogOpen = true"
        >
          <UiIcon name="Plus" :size="20" aria-hidden="true" />
        </Button>
      </header>

      <p
        v-if="visibleSitesError"
        class="sites-message sites-message--error"
        role="alert"
      >
        {{ visibleSitesError }}
      </p>

      <section
        v-if="showFeatureDiscovery"
        class="feature-discovery"
        aria-labelledby="feature-discovery-title"
      >
        <div>
          <h2 id="feature-discovery-title">Make ME3 your own</h2>
          <p>
            Start with your profile and website. Add writing, tasks, email, and
            more whenever you need them.
          </p>
        </div>
        <div class="feature-discovery__actions">
          <Button
            color="outline"
            shape="soft"
            size="compact"
            to="/settings?section=plugins"
          >
            Explore features
          </Button>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            type="button"
            :disabled="dismissingFeatureDiscovery"
            @click="dismissFeatureDiscovery"
          >
            Dismiss
          </Button>
        </div>
      </section>

      <section
        v-if="sitesReady && !visibleSitesError && !profileSite"
        class="profile-callout"
        aria-labelledby="profile-callout-title"
      >
        <div class="profile-callout__icon" aria-hidden="true">
          <BrandLogo alt="" />
        </div>
        <div>
          <h2 id="profile-callout-title">Create your ME3 Profile</h2>
          <p>
            Your ME3 Profile is your home on ME3 and unlocks creation of more
            sites.
          </p>
        </div>
        <Button color="primary" shape="soft" size="large" :to="createProfileRoute">
          Create ME3 Profile
        </Button>
      </section>

      <section
        v-if="sitesReady && persistentSites.length"
        class="sites-grid"
        aria-label="Your sites"
      >
        <RouterLink
          v-for="ownedSite in persistentSites"
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
      </section>

    </main>

    <AppDialog
      :open="addSiteDialogOpen"
      labelled-by="add-site-title"
      described-by="add-site-description"
      close-on-backdrop
      @close="addSiteDialogOpen = false"
    >
      <section class="add-site-dialog">
        <header class="add-site-dialog__header">
          <div>
            <h2 id="add-site-title">Create a site</h2>
            <p id="add-site-description">
              Choose what you want to create. You can manage and publish both
              from ME3.
            </p>
          </div>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            aria-label="Close"
            title="Close"
            @click="addSiteDialogOpen = false"
          >
            <UiIcon name="X" :size="18" aria-hidden="true" />
          </Button>
        </header>

        <div class="add-site-options">
          <RouterLink
            v-if="canCreateProfile"
            class="add-site-option"
            :to="createProfileRoute"
            @click="addSiteDialogOpen = false"
          >
            <span class="add-site-option__icon" aria-hidden="true">
              <UiIcon name="UserRound" :size="24" />
            </span>
            <span class="add-site-option__copy">
              <strong>ME3 Profile</strong>
              <span>
                A simple site and digital business card for you or your
                business. It creates a structured identity you can use across
                ME3 and Soulink.
              </span>
            </span>
            <UiIcon
              class="add-site-option__arrow"
              name="ArrowRight"
              :size="20"
              aria-hidden="true"
            />
          </RouterLink>
          <button
            v-else
            class="add-site-option add-site-option--disabled"
            type="button"
            disabled
          >
            <span class="add-site-option__icon" aria-hidden="true">
              <UiIcon name="UserRound" :size="24" />
            </span>
            <span class="add-site-option__copy">
              <strong>ME3 Profile</strong>
              <span>
                A simple site and digital business card for you or your
                business. It creates a structured identity you can use across
                ME3 and Soulink.
              </span>
              <span class="add-site-option__status">
                {{ profileCreationBlockReason }}
              </span>
            </span>
          </button>

          <RouterLink
            v-if="canCreateBusinessSite"
            class="add-site-option add-site-option--business"
            :to="buildWithMe3Route"
            @click="addSiteDialogOpen = false"
          >
            <span class="add-site-option__icon" aria-hidden="true">
              <UiIcon name="BriefcaseBusiness" :size="24" />
            </span>
            <span class="add-site-option__copy">
              <strong>Business Site</strong>
              <span>
                Build a flexible, branded website with ME3. Best for
                organisations and established businesses that need custom
                pages, styling, and room to grow.
              </span>
            </span>
            <UiIcon
              class="add-site-option__arrow"
              name="ArrowRight"
              :size="20"
              aria-hidden="true"
            />
          </RouterLink>
          <button
            v-else
            class="add-site-option add-site-option--business add-site-option--disabled"
            type="button"
            disabled
          >
            <span class="add-site-option__icon" aria-hidden="true">
              <UiIcon name="BriefcaseBusiness" :size="24" />
            </span>
            <span class="add-site-option__copy">
              <strong>Business Site</strong>
              <span>
                Build a flexible, branded website with ME3. Best for
                organisations and established businesses that need custom
                pages, styling, and room to grow.
              </span>
              <span class="add-site-option__status">
                {{ businessSiteCreationBlockReason }}
              </span>
            </span>
          </button>
        </div>
      </section>
    </AppDialog>

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

.add-site-dialog {
  display: grid;
  gap: 22px;
  width: min(780px, 100%);
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-lg, 16px);
  padding: 22px;
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-lg, 0 24px 70px rgb(15 23 42 / 0.18));
}

.add-site-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.add-site-dialog__header h2,
.add-site-dialog__header p {
  margin: 0;
}

.add-site-dialog__header h2 {
  font-size: 1.3rem;
  letter-spacing: -0.025em;
}

.add-site-dialog__header p {
  max-width: 52ch;
  margin-top: 6px;
  color: var(--ui-text-muted, var(--color-text-muted));
  line-height: 1.5;
}

.add-site-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.add-site-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  min-height: 210px;
  width: 100%;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 12px);
  padding: 18px;
  background: var(--ui-surface, var(--color-bg));
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: none;
}

.add-site-option--business {
  border-color: color-mix(
    in oklab,
    var(--ui-accent, var(--color-accent)) 38%,
    var(--ui-border, var(--color-border))
  );
  background: color-mix(
    in oklab,
    var(--ui-accent, var(--color-accent)) 10%,
    var(--ui-surface, var(--color-bg))
  );
}

.add-site-option:hover:not(:disabled) {
  border-color: var(--ui-border-strong, var(--color-border));
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.add-site-option:focus-visible {
  outline: 3px solid var(--ui-focus, var(--ui-accent, var(--color-accent)));
  outline-offset: 2px;
}

.add-site-option__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.add-site-option--business .add-site-option__icon {
  background: var(--ui-accent-soft, var(--color-bg-subtle));
  color: var(--ui-accent, var(--color-accent));
}

.add-site-option__copy {
  display: grid;
  flex: 1;
  gap: 4px;
}

.add-site-option__copy strong {
  font-size: 1rem;
}

.add-site-option__copy > span {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.88rem;
  line-height: 1.45;
}

.add-site-option__status {
  margin-top: 8px;
  color: var(--ui-text, var(--color-text)) !important;
  font-weight: 700;
}

.add-site-option__arrow {
  align-self: flex-end;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.add-site-option--disabled {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: not-allowed;
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

.sites-header {
  display: flex;
  min-height: 44px;
  justify-content: flex-end;
  margin-bottom: 28px;
}

.sites-header > :deep(.me3-btn) {
  position: fixed;
  z-index: 70;
  top: var(--workspace-topbar-padding-block);
  right: var(--app-shell-mobile-nav-inset-inline-start);
  min-width: 44px;
  min-height: 44px;
}

.profile-callout h2,
.site-card h2 {
  margin: 0;
  letter-spacing: -0.025em;
}

.profile-callout p {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.feature-discovery {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.feature-discovery h2 {
  margin: 0;
  font-size: 1rem;
}

.feature-discovery p {
  max-width: 54ch;
  margin: 4px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  line-height: 1.45;
}

.feature-discovery__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
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

  .feature-discovery {
    align-items: flex-start;
    flex-direction: column;
  }

  .profile-callout > :deep(.me3-btn) {
    grid-column: 1 / -1;
    width: 100%;
  }

  .sites-grid {
    grid-template-columns: 1fr;
  }

  .add-site-options {
    grid-template-columns: 1fr;
  }

  .add-site-option {
    min-height: 0;
  }
}

@media (max-width: 520px) {
  .add-site-dialog {
    gap: 18px;
    width: 100%;
    border-radius: var(--ui-radius-lg, 16px) var(--ui-radius-lg, 16px) 0 0;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom, 0px));
  }

}
</style>

<script setup lang="ts">
import { definePage } from "unplugin-vue-router/runtime";
import { ref, computed, onBeforeUnmount, onMounted } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { useSitesStore, type SiteContent } from "../../stores/sites";
import {
  AGENT_LANDING_PAGE_SITE_TEMPLATE_ID,
  LANDING_PAGES_PLUGIN_ID,
} from "@me3-core/plugin-landing-pages";
import { api } from "../../api";
import { useWizardStore } from "../../stores/wizard";
import NewsletterSubscribers from "../../components/NewsletterSubscribers.vue";
import Button from "../../components/Button.vue";
import ConfirmationDialog from "../../components/ConfirmationDialog.vue";
import CustomDomain from "../../components/CustomDomain.vue";
import UiIcon from "../../components/UiIcon.vue";
import {
  permanentPublicSiteUrl,
  resolvePublicSiteUrl,
} from "../../utils/publicSiteUrl";
import { useAppToast } from "../../composables/useAppToast";

definePage({
  meta: {
    requiresAuth: true,
    title: "Site Settings | ME3",
    description: "Manage your published me3 site settings and content.",
    robots: "noindex,follow",
  },
});

const route = useRoute();
const router = useRouter();
const sites = useSitesStore();
const wizard = useWizardStore();
const { toastError, toastSuccess } = useAppToast();

/** Nested children need the parent RouterView or their pages never appear. */
const isNestedSitesTool = computed(
  () =>
    route.path.startsWith("/sites/") &&
    (route.path.endsWith("/build") ||
      route.path.includes("/landing-pages/") ||
      route.path.endsWith("/business-site") ||
      route.path.includes("/pages/")),
);

const username = computed(() => route.params.username as string);
const site = computed(() =>
  sites.sites.find((s) => s.username === username.value),
);
const siteType = computed(() => site.value?.site_type || "profile");
const isLandingPage = computed(() => siteType.value === "landing_page");
const isProfileSite = computed(() => site.value?.site_role === "profile");
const isPersistentSite = computed(
  () =>
    site.value?.site_role === "profile" ||
    site.value?.site_role === "organization",
);
const isAgentBuiltSite = computed(
  () => site.value?.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID,
);
const landingPagesFeatureEnabled = ref(false);
const showLandingPageControls = computed(
  () => isLandingPage.value && landingPagesFeatureEnabled.value,
);

const siteUrl = ref("/me");
const permanentSiteUrl = computed(() =>
  permanentPublicSiteUrl(
    username.value,
    site.value?.site_role === "organization" ? "organization" : "profile",
  ),
);
const managedDeployment = ref(false);
const siteUrlLabel = computed(() =>
  siteUrl.value.replace(/^https?:\/\//, "").replace(/\/$/, ""),
);

async function syncSiteUrl() {
  siteUrl.value = await resolvePublicSiteUrl(username.value, site.value);
}

async function syncDeploymentMode() {
  try {
    const config = await api.get<{ deploymentMode?: string }>("/config");
    managedDeployment.value = config.deploymentMode === "managed";
  } catch {
    managedDeployment.value = false;
  }
}

async function handleDomainStatusChanged() {
  await sites.fetchSites();
  await syncSiteUrl();
}

// UI State
const showDeleteConfirm = ref(false);
const isDeleting = ref(false);
const publishBusy = ref(false);
const publishError = ref("");
type SiteProfile = NonNullable<SiteContent["profile"]>;
type SiteBranding = {
  siteId: string;
  siteUsername: string;
  displayName: string;
  logoRef: string | null;
  logoUrl: string | null;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  updatedAt: string | null;
  persisted: boolean;
};
const siteProfile = ref<SiteProfile | null>(null);
const siteBranding = ref<SiteBranding | null>(null);
const siteLogoFileInput = ref<HTMLInputElement | null>(null);
const siteLogoLoading = ref(false);
const siteLogoSaving = ref(false);
const siteBrandingLoading = ref(false);
const siteBrandingSaving = ref(false);
const siteLogoError = ref("");
const siteLogoStatus = ref("");
const siteLogoRevision = ref(0);
const hasSiteLogo = computed(() => Boolean(siteProfile.value?.logo));
const siteLogoPreview = computed(() => {
  const source =
    siteBranding.value?.logoUrl ||
    siteProfile.value?.logo ||
    siteProfile.value?.avatar ||
    site.value?.avatar;
  if (!source) return null;

  try {
    const siteBase = new URL(
      `${siteUrl.value.replace(/\/$/, "")}/`,
      window.location.origin,
    );
    const preview = new URL(source, siteBase);
    if (siteLogoRevision.value > 0) {
      preview.searchParams.set("me3-logo", String(siteLogoRevision.value));
    }
    return preview.toString();
  } catch {
    return source;
  }
});

function fallbackSiteBranding(): SiteBranding {
  const profile = siteProfile.value;
  const links = profile?.links as Record<string, unknown> | null | undefined;
  const accent = typeof links?._accent === "string" && /^#[0-9a-f]{6}$/i.test(links._accent)
    ? links._accent
    : "#147d64";
  return {
    siteId: site.value?.id || "",
    siteUsername: username.value,
    displayName: profile?.name?.trim() || username.value,
    logoRef: profile?.logo || profile?.avatar || null,
    logoUrl: null,
    accentColor: accent,
    backgroundColor: "#f4f5f4",
    surfaceColor: "#ffffff",
    textColor: "#18201d",
    updatedAt: null,
    persisted: false,
  };
}

async function loadSiteBranding(): Promise<SiteBranding | null> {
  if (!isPersistentSite.value) return null;
  siteBrandingLoading.value = true;
  try {
    const response = await api.get<{ branding: SiteBranding }>(
      `/sites/${encodeURIComponent(username.value)}/branding`,
    );
    if (!response.branding) throw new Error("Branding is unavailable");
    siteBranding.value = response.branding;
  } catch {
    // Keeps local UI development usable against a Worker that predates branding.
    siteBranding.value = fallbackSiteBranding();
  } finally {
    siteBrandingLoading.value = false;
  }
  return siteBranding.value;
}

async function saveSiteBranding(
  overrides: Partial<SiteBranding> = {},
  successMessage = "Branding saved.",
): Promise<boolean> {
  const current = siteBranding.value || fallbackSiteBranding();
  const next = { ...current, ...overrides };
  siteBrandingSaving.value = true;
  siteLogoError.value = "";
  siteLogoStatus.value = "";
  try {
    const response = await api.put<{ branding: SiteBranding }>(
      `/sites/${encodeURIComponent(username.value)}/branding`,
      {
        logoRef: next.logoRef,
        accentColor: next.accentColor,
        textColor: next.textColor,
      },
    );
    siteBranding.value = response.branding;
    siteLogoRevision.value = Date.now();
    siteLogoStatus.value = successMessage;
    toastSuccess(successMessage);
    return true;
  } catch (caught) {
    siteLogoError.value = caught instanceof Error
      ? caught.message
      : "Could not save branding.";
    toastError(siteLogoError.value);
    return false;
  } finally {
    siteBrandingSaving.value = false;
  }
}

async function loadSiteProfile(): Promise<SiteProfile | null> {
  if (!isPersistentSite.value) return null;

  siteLogoLoading.value = true;
  try {
    const content = await sites.getSiteContent(username.value);
    if (!content?.ok || !content.profile) {
      siteLogoError.value = "Could not load the current site logo.";
      return null;
    }
    siteProfile.value = structuredClone(content.profile);
    siteLogoError.value = "";
    return siteProfile.value;
  } finally {
    siteLogoLoading.value = false;
  }
}

function openSiteLogoPicker() {
  if (!siteLogoSaving.value) siteLogoFileInput.value?.click();
}

async function saveSiteProfile(nextProfile: SiteProfile): Promise<boolean> {
  const sourceFile = new File(
    [JSON.stringify(nextProfile, null, 2)],
    "me.json",
    { type: "application/json" },
  );
  const saved = await sites.uploadSite(username.value, [sourceFile]);
  if (!saved) {
    siteLogoError.value = sites.error || "Could not update the site logo.";
    return false;
  }

  siteProfile.value = nextProfile;
  siteLogoRevision.value = Date.now();
  return true;
}

async function handleSiteLogoSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || siteLogoSaving.value) return;

  siteLogoError.value = "";
  siteLogoStatus.value = "";
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    siteLogoError.value = "Choose a PNG, JPEG, or WebP image.";
    return;
  }
  if (file.size > 1_900_000) {
    siteLogoError.value = "Choose an image smaller than 1.9 MB.";
    return;
  }

  siteLogoSaving.value = true;
  try {
    const currentProfile = siteProfile.value || (await loadSiteProfile());
    if (!currentProfile) return;

    const uploaded = await sites.uploadImage(username.value, file, "logo");
    if (!uploaded?.ok) {
      siteLogoError.value = sites.error || "Could not upload the site logo.";
      return;
    }

    const nextProfile = structuredClone(currentProfile);
    nextProfile.logo = `./${uploaded.path}`;
    if (await saveSiteProfile(nextProfile)) {
      await saveSiteBranding(
        { logoRef: nextProfile.logo },
        "Site logo updated.",
      );
    }
  } finally {
    siteLogoSaving.value = false;
  }
}

async function removeSiteLogo() {
  if (siteLogoSaving.value) return;

  siteLogoSaving.value = true;
  siteLogoError.value = "";
  siteLogoStatus.value = "";
  try {
    const currentProfile = siteProfile.value || (await loadSiteProfile());
    if (!currentProfile) return;

    const nextProfile = structuredClone(currentProfile);
    delete nextProfile.logo;
    if (await saveSiteProfile(nextProfile)) {
      await saveSiteBranding(
        { logoRef: nextProfile.avatar || null },
        "The site avatar is now used as the logo.",
      );
    }
  } finally {
    siteLogoSaving.value = false;
  }
}

async function syncLandingPagesFeature() {
  try {
    const response = await api.get<{
      plugins: Array<{ id: string; enabled: boolean; status: string }>;
    }>("/plugins");
    const plugin = response.plugins.find(
      (candidate) => candidate.id === LANDING_PAGES_PLUGIN_ID,
    );
    landingPagesFeatureEnabled.value =
      plugin?.enabled === true && plugin.status === "installed";
  } catch {
    landingPagesFeatureEnabled.value = false;
  }
}

function handlePluginsChanged() {
  void syncLandingPagesFeature();
}

onMounted(async () => {
  if (sites.sites.length === 0) {
    await sites.fetchSites();
  }
  await syncSiteUrl();
  await syncDeploymentMode();

  await syncLandingPagesFeature();
  if (landingPagesFeatureEnabled.value && isProfileSite.value) {
    await sites.fetchSitePages(username.value);
  }
  window.addEventListener("me3:plugins-changed", handlePluginsChanged);

  if (!site.value) {
    router.replace("/sites");
    return;
  }

  if (isPersistentSite.value) {
    await loadSiteProfile();
    await loadSiteBranding();
  }

  if (typeof route.query.edit === "string") {
    await openWizardStep(route.query.edit);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("me3:plugins-changed", handlePluginsChanged);
});

function wizardSiteQuery() {
  return {
    ...(site.value?.id ? { siteId: site.value.id } : {}),
    site: username.value,
    return: `/sites/${username.value}`,
  };
}

function editSite() {
  if (site.value?.site_role === "organization") {
    router.push(`/sites/${username.value}/business-site`);
    return;
  }
  if (isAgentBuiltSite.value) {
    router.push({
      path: "/assistant",
      query: {
        mode: "site-builder",
        ...(site.value?.builder_thread_id
          ? { thread: site.value.builder_thread_id }
          : { prompt: `Update the @${username.value} site: ` }),
      },
    });
    return;
  }

  router.push({
    path: "/create",
    query: wizardSiteQuery(),
  });
}

function openWizardStep(step: string) {
  const stepId = wizard.normalizeWizardStepId(step);
  router.replace({
    path: "/create",
    query: {
      ...wizardSiteQuery(),
      ...(stepId ? { step: stepId } : {}),
    },
  });
}

function openBuilder() {
  router.push(`/sites/${username.value}/build`);
}

function writePost() {
  router.push({
    path: "/create",
    query: {
      ...wizardSiteQuery(),
      step: "blog",
    },
  });
}

async function deleteSite() {
  isDeleting.value = true;
  try {
    const success = await sites.deleteSite(username.value);
    if (success) {
      router.push("/sites");
    }
  } finally {
    isDeleting.value = false;
  }
}

async function publishLandingPage() {
  if (publishBusy.value) return;
  publishBusy.value = true;
  publishError.value = "";
  try {
    const ok = await sites.publishLandingPage(username.value);
    if (!ok) {
      publishError.value = sites.error || "Failed to publish landing page";
      return;
    }
    await sites.fetchSites();
    await syncSiteUrl();
  } finally {
    publishBusy.value = false;
  }
}

async function unpublishLandingPage() {
  if (publishBusy.value) return;
  publishBusy.value = true;
  publishError.value = "";
  try {
    const ok = await sites.unpublishLandingPage(username.value);
    if (!ok) {
      publishError.value = sites.error || "Failed to unpublish landing page";
      return;
    }
    await sites.fetchSites();
    await syncSiteUrl();
  } finally {
    publishBusy.value = false;
  }
}

</script>

<template>
  <RouterView v-if="isNestedSitesTool" />
  <div v-else class="site-page">
    <main class="main">
      <!-- Site Header -->
      <div class="site-header">
        <div class="site-info">
          <div class="site-info-main">
            <div class="site-title">
              <a
                v-if="site?.published_at"
                :href="siteUrl"
                target="_blank"
                rel="noopener"
                class="site-link"
                :title="siteUrlLabel"
              >
                <span class="site-title-text">{{ siteUrlLabel }}</span>
                <UiIcon name="Eye" :size="16" class="site-link-icon" />
              </a>
              <span
                v-else
                class="site-title-plain"
                :title="siteUrlLabel"
              >
                <span class="site-title-text">{{ siteUrlLabel }}</span>
              </span>
            </div>
            <div class="site-badges">
              <span v-if="site?.published_at" class="status published"
                >Published</span
              >
              <span v-else class="status draft">Not published</span>
            </div>
          </div>
        </div>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          to="/sites"
          aria-label="Back to sites"
          title="Back to sites"
          class="site-header__close"
        >
          <UiIcon name="X" :size="18" aria-hidden="true" />
        </Button>
      </div>

      <!-- Quick Actions -->
      <section class="actions-section">
        <div class="actions-grid">
          <button
            v-if="isPersistentSite"
            class="action-card primary"
            @click="editSite"
          >
            <span class="action-icon">
              <UiIcon :name="site?.site_role === 'organization' ? 'LayoutGrid' : isAgentBuiltSite ? 'Sparkles' : 'Pencil'" :size="24" />
            </span>
            <div class="action-content">
              <strong>{{ site?.site_role === "organization" ? "Manage Business Site" : isAgentBuiltSite ? "Continue building" : "Edit Site" }}</strong>
              <p>
                {{
                  site?.site_role === "organization"
                    ? "Pages, navigation, SEO, profile ownership, and publishing"
                    : isAgentBuiltSite
                    ? "Edit with ME3 in site builder"
                    : "Update your site using the wizard"
                }}
              </p>
            </div>
          </button>

          <button
            v-if="isPersistentSite && !isAgentBuiltSite"
            class="action-card"
            @click="writePost"
          >
            <span class="action-icon">
              <UiIcon name="Pencil" :size="24" />
            </span>
            <div class="action-content">
              <strong>Write Post</strong>
              <p>Jump to the blog editor</p>
            </div>
          </button>

          <button
            v-if="showLandingPageControls"
            class="action-card primary"
            @click="openBuilder"
          >
            <span class="action-icon">
              <UiIcon name="LayoutGrid" :size="24" />
            </span>
            <div class="action-content">
              <strong>Open Builder</strong>
              <p>Refine template, copy, images, and preview</p>
            </div>
          </button>

          <button
            v-if="showLandingPageControls && !site?.published_at"
            class="action-card"
            @click="publishLandingPage"
          >
            <span class="action-icon">
              <UiIcon name="Check" :size="24" />
            </span>
            <div class="action-content">
              <strong>{{ publishBusy ? "Publishing..." : "Publish" }}</strong>
              <p>Make this landing page live on its subdomain</p>
            </div>
          </button>

          <button
            v-if="showLandingPageControls && site?.published_at"
            class="action-card"
            @click="unpublishLandingPage"
          >
            <span class="action-icon">
              <UiIcon name="X" :size="24" />
            </span>
            <div class="action-content">
              <strong>{{
                publishBusy ? "Unpublishing..." : "Unpublish"
              }}</strong>
              <p>Take the page offline while keeping the draft intact</p>
            </div>
          </button>

        </div>
        <p v-if="publishError" class="error">{{ publishError }}</p>
      </section>

      <section
        v-if="isPersistentSite"
        class="site-logo-section"
        aria-labelledby="site-logo-title"
        :aria-busy="siteLogoLoading || siteLogoSaving || siteBrandingLoading || siteBrandingSaving"
      >
        <div class="section-heading">
          <div>
            <h2 id="site-logo-title">Branding</h2>
          </div>
        </div>

        <p
          v-if="siteLogoLoading || siteBrandingLoading"
          class="site-logo-loading"
          role="status"
          aria-live="polite"
        >
          Loading branding…
        </p>
        <template v-else>
          <div class="site-branding-controls">
            <div class="site-logo-control">
              <div class="site-logo-preview" aria-hidden="true">
                <img v-if="siteLogoPreview" :src="siteLogoPreview" alt="" />
                <UiIcon v-else name="Image" :size="24" />
              </div>
              <div class="site-logo-actions">
                <Button
                  color="neutral"
                  shape="soft"
                  size="compact"
                  type="button"
                  :disabled="siteLogoSaving || siteBrandingSaving"
                  @click="openSiteLogoPicker"
                >
                  {{
                    siteLogoSaving
                      ? "Saving…"
                      : hasSiteLogo
                        ? "Change logo"
                        : "Upload logo"
                  }}
                </Button>
                <Button
                  v-if="hasSiteLogo"
                  color="ghost"
                  shape="soft"
                  size="compact"
                  type="button"
                  :disabled="siteLogoSaving || siteBrandingSaving"
                  @click="removeSiteLogo"
                >
                  Use avatar
                </Button>
                <input
                  ref="siteLogoFileInput"
                  class="site-logo-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Choose site logo"
                  aria-describedby="site-logo-hint"
                  :disabled="siteLogoSaving || siteBrandingSaving"
                  @change="handleSiteLogoSelect"
                />
                <span id="site-logo-hint" class="site-logo-hint">
                  1.9 MB max
                </span>
              </div>
            </div>

            <label v-if="siteBranding" class="site-branding-field">
              <span>Primary</span>
              <input v-model="siteBranding.accentColor" type="color" />
            </label>
            <label v-if="siteBranding" class="site-branding-field">
              <span>Text</span>
              <input v-model="siteBranding.textColor" type="color" />
            </label>
          </div>
          <div v-if="siteBranding" class="site-branding-actions">
            <Button
              color="neutral"
              shape="soft"
              size="large"
              type="button"
              class="site-branding-save"
              :disabled="siteLogoSaving || siteBrandingSaving"
              @click="saveSiteBranding()"
            >
              {{ siteBrandingSaving ? "Saving…" : "Save branding" }}
            </Button>
          </div>
        </template>
        <p v-if="siteLogoError" class="site-logo-error" role="alert">
          {{ siteLogoError }}
        </p>
        <p
          v-else-if="siteLogoStatus"
          class="site-logo-status"
          role="status"
          aria-live="polite"
        >
          {{ siteLogoStatus }}
        </p>
      </section>

      <section
        v-if="isPersistentSite"
        id="domain"
        class="domain-section"
        aria-labelledby="domain-section-title"
      >
        <div class="section-heading">
          <div>
            <h2 id="domain-section-title">Domain</h2>
            <p>Connect your site to a custom domain</p>
          </div>
        </div>
        <CustomDomain
          embedded
          :managed="managedDeployment"
          :site-id="site?.id"
          :username="username"
          :site-role="
            site?.site_role === 'organization' ? 'organization' : 'profile'
          "
          :site-published="Boolean(site?.published_at)"
          :fallback-url="permanentSiteUrl"
          :show-settings-link="false"
          @domain-status-changed="handleDomainStatusChanged"
        />
      </section>

      <!-- Newsletter Subscribers -->
      <section
        v-if="site?.published_at && isPersistentSite"
        class="subscribers-section"
      >
        <NewsletterSubscribers :username="username" />
      </section>

      <!-- Danger Zone -->
      <section v-if="!isProfileSite" class="danger-section">
        <h2>Danger zone</h2>
        <div class="danger-card">
          <div>
            <strong>Delete this site</strong>
            <p>
              Once deleted, this username will be available for others to claim.
            </p>
          </div>
          <button class="button danger" @click="showDeleteConfirm = true">
            Delete
          </button>
        </div>
      </section>
    </main>

    <ConfirmationDialog
      :open="showDeleteConfirm"
      title="Delete site?"
      :message="`Delete ${username}? This action cannot be undone.`"
      confirm-label="Delete"
      :busy="isDeleting"
      danger
      @cancel="showDeleteConfirm = false"
      @confirm="deleteSite"
    />
  </div>
</template>

<style scoped>
.site-page {
  min-height: 100vh;
}

.main {
  max-width: 600px;
  margin: 0 auto;
  padding: var(--workspace-topbar-padding-block) 40px 20px;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--workspace-topbar-control-size);
  margin-bottom: 32px;
  padding-right: 44px;
  box-sizing: border-box;
}

.site-header__close {
  position: fixed;
  top: var(--workspace-topbar-padding-block);
  right: var(--app-shell-mobile-nav-inset-inline-start);
  z-index: 70;
  flex: 0 0 auto;
}

.analytics-section {
  margin-bottom: 32px;
}

.site-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.site-info-main {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.site-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
  flex: 1 1 0;
  min-width: 0;
}

.site-title-plain {
  display: flex;
  min-width: 0;
  max-width: 100%;
}

.site-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.site-title a {
  color: inherit;
  text-decoration: none;
}

.site-link {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

.site-link .site-title-text {
  flex: 1 1 auto;
}

.site-link-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.site-link:hover .site-link-icon {
  opacity: 1;
}

.site-title a:hover {
  text-decoration: underline;
}

.site-info-main .site-badges {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.site-info-main .site-badges .status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  line-height: 1.25;
}

.status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 20px;
}

.status.published {
  background: #e8f5e9;
  color: #2e7d32;
}

.status.draft {
  background: var(--color-border);
  color: var(--color-text-muted);
}

.status.site-kind {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

@media (max-width: 959px) {
  .main {
    padding-top: var(--workspace-topbar-padding-block);
  }

  .site-header {
    margin-bottom: 28px;
  }

  .site-info-main {
    padding-left: 24px;
  }
}

/* Actions Section */
.actions-section {
  margin-bottom: 32px;
}

.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.action-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--color-border);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  text-decoration: none;
  color: var(--color-text);
  transition:
    border-color 0.2s,
    transform 0.2s;
}

.action-card:hover {
  border-color: var(--color-text);
  transform: translateY(-1px);
}

.action-card.primary {
  background: var(--color-text);
  color: var(--color-bg);
}

.action-card.primary:hover {
  border-color: transparent;
  opacity: 0.95;
}

.action-icon {
  font-size: 24px;
}

.action-content {
  text-align: left;
}

.action-content strong {
  display: block;
  font-size: 15px;
  margin-bottom: 2px;
}

.action-content p {
  font-size: 12px;
  opacity: 0.8;
  margin: 0;
}

/* Advanced Section */
.advanced-section {
  margin-bottom: 32px;
}

.section-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--color-border);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.section-toggle:hover {
  opacity: 0.9;
}

.toggle-icon {
  font-size: 20px;
  color: var(--color-text-muted);
}

.advanced-content {
  margin-top: 16px;
  padding: 20px;
  background: var(--color-border);
  border-radius: 12px;
}

.section-desc {
  color: var(--color-text-muted);
  margin-bottom: 16px;
  font-size: 14px;
}

.section-desc code {
  background: rgba(128, 128, 128, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
}

.drop-zone {
  border: 2px dashed rgba(128, 128, 128, 0.4);
  border-radius: 12px;
  padding: 32px 24px;
  text-align: center;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.drop-zone.dragging {
  border-color: var(--color-text);
  background: rgba(128, 128, 128, 0.1);
}

.drop-icon {
  font-size: 36px;
  margin-bottom: 12px;
}

.drop-content p {
  margin-bottom: 6px;
  font-size: 14px;
}

.drop-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}

.file-label {
  color: var(--color-text);
  text-decoration: underline;
  cursor: pointer;
}

.file-label input {
  display: none;
}

.selected-files {
  margin-top: 16px;
  padding: 16px;
  background: rgba(128, 128, 128, 0.1);
  border-radius: 8px;
}

.selected-files h3 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}

.file-list {
  list-style: none;
  margin-bottom: 12px;
}

.file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.file-item:last-child {
  border-bottom: none;
}

.file-name {
  font-size: 13px;
}

.remove-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0 6px;
}

.remove-btn:hover {
  color: #e53935;
}

.button {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  background: var(--color-text);
  color: var(--color-bg);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.button:hover:not(:disabled) {
  opacity: 0.9;
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.button.secondary {
  background: var(--color-border);
  color: var(--color-text);
}

.button.danger {
  background: #e53935;
  color: white;
}

.error {
  margin-top: 12px;
  color: #e53935;
  font-size: 13px;
}

.success {
  margin-top: 12px;
  color: #4caf50;
  font-size: 13px;
}

.success a {
  color: #4caf50;
}

/* Site badges row */
.site-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Danger Section */
.danger-section {
  --site-danger: var(--ui-danger, #dc2626);

  margin-top: 24px;
}

.site-logo-section,
.domain-section {
  margin-top: 24px;
  margin-bottom: 24px;
  padding: 20px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-lg, 12px);
  background: var(--ui-surface, var(--color-bg));
}

.domain-section {
  margin-top: 0;
}

.site-logo-section {
  display: grid;
  gap: 16px;
}

.site-logo-section .section-heading,
.domain-section .section-heading {
  margin-bottom: 16px;
}

.site-logo-section .section-heading {
  margin-bottom: 0;
}

.site-logo-section .section-heading h2,
.domain-section .section-heading h2 {
  margin: 0;
  font-size: 18px;
}

.site-logo-section .section-heading p,
.domain-section .section-heading p {
  margin: 5px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.5;
}

.site-logo-control {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.site-logo-preview {
  display: grid;
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-border));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.site-logo-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.site-logo-actions {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.site-logo-actions :deep(.me3-btn) {
  min-height: 44px;
}

.site-branding-controls {
  display: grid;
  grid-template-columns: minmax(210px, 1.4fr) repeat(2, minmax(92px, 0.6fr));
  align-items: end;
  gap: 14px;
}

.site-branding-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.site-branding-field > span {
  color: var(--ui-text, var(--color-text));
  font-size: 13px;
  font-weight: 700;
}

.site-branding-field input {
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
}

.site-branding-field input[type="color"] {
  padding: 4px;
  cursor: pointer;
}

.site-branding-field input:focus-visible {
  outline: 2px solid var(--ui-focus, var(--ui-accent));
  outline-offset: 1px;
}

.site-branding-save {
  width: 100%;
}

.site-branding-actions {
  padding-top: 14px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.site-logo-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.site-logo-hint {
  flex-basis: 100%;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
}

.site-logo-loading,
.site-logo-error,
.site-logo-status {
  margin: 0;
  font-size: 13px;
}

.site-logo-loading {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.site-logo-error {
  color: var(--ui-danger, #dc2626);
}

.site-logo-status {
  color: var(--ui-success, #15803d);
}

@media (max-width: 560px) {
  .site-branding-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .site-logo-control {
    grid-column: 1 / -1;
  }
}

.domain-section :deep(.custom-domain-section) {
  margin-bottom: 0;
}

.danger-section h2 {
  font-size: 18px;
  color: var(--site-danger);
  margin-bottom: 12px;
}

.danger-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border: 1px solid
    color-mix(
      in oklab,
      var(--site-danger) 42%,
      var(--ui-border, var(--color-border))
    );
  border-radius: var(--ui-radius-lg, 12px);
  background: color-mix(
    in oklab,
    var(--site-danger) 10%,
    var(--ui-surface, var(--color-bg))
  );
  color: var(--ui-text, var(--color-text));
}

.danger-card > div {
  min-width: 0;
}

.danger-card strong {
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
}

.danger-card p {
  font-size: 13px;
  color: var(--ui-text-muted, var(--color-text-muted));
  margin-top: 2px;
}

/* Subscribers Section */
.subscribers-section {
  margin-bottom: 24px;
  padding: 20px;
  background: var(--color-border);
  border-radius: 12px;
}

@media (max-width: 500px) {
  .actions-grid {
    grid-template-columns: 1fr;
  }

  .site-logo-control {
    align-items: flex-start;
  }
}

@media (prefers-color-scheme: dark) {
  .status.published {
    background: #1b5e20;
    color: #a5d6a7;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { AGENT_LANDING_PAGE_SITE_TEMPLATE_ID } from "@me3-core/plugin-landing-pages";
import { useSitesStore, type Site } from "../stores/sites";
import { permanentPublicSiteUrl } from "../utils/publicSiteUrl";
import AppSwitch from "./AppSwitch.vue";
import Button from "./Button.vue";
import ConfirmationDialog from "./ConfirmationDialog.vue";
import CustomDomain from "./CustomDomain.vue";

/**
 * Settings home for each site's address: custom domain setup, the Made with ME3 badge, and
 * deleting an older site. Editing a site (content, logo, accent) happens in the site editor.
 */
const route = useRoute();
const sites = useSitesStore();
const managed = ref(false);
const openDomain = ref<string | null>(
  typeof route.query.site === "string" ? route.query.site : null,
);

const profileSite = computed(() => sites.sites.find((site) => site.site_role === "profile"));
/** Sites made before ME3 moved to one site per owner. They stay live, so they stay manageable here. */
const olderSites = computed(() => sites.sites.filter((site) => site.site_role === "organization"));
const listedSites = computed(() => [
  ...(profileSite.value ? [profileSite.value] : []),
  ...olderSites.value,
]);

function domainLabel(site: Site): string {
  if (!site.custom_domain) return "Default ME3 address";
  if (site.custom_domain_status === "active") return site.custom_domain;
  if (site.custom_domain_status === "failed") return `${site.custom_domain} · needs attention`;
  return `${site.custom_domain} · setting up`;
}

function editRoute(site: Site) {
  if (site.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID && site.builder_thread_id) {
    return { path: "/assistant", query: { mode: "site-builder", thread: site.builder_thread_id } };
  }
  return { path: "/create", query: { siteId: site.id, site: site.username, return: "/settings?section=domain" } };
}

function toggleDomain(username: string) {
  openDomain.value = openDomain.value === username ? null : username;
}

// The "Made with ME3" badge on published pages. "auto" follows the install default.
type SiteBadgeState = { preference: "auto" | "shown" | "hidden"; automaticallyShown: boolean };
const siteBadge = ref<SiteBadgeState | null>(null);
const siteBadgeSaving = ref(false);
const siteBadgeShown = computed(() =>
  siteBadge.value?.preference === "auto"
    ? siteBadge.value.automaticallyShown
    : siteBadge.value?.preference === "shown",
);
const hasPublishedSite = computed(() => listedSites.value.some((site) => site.published_at));

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

const deleteTarget = ref<Site | null>(null);
const deleting = ref(false);
async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    if (await sites.deleteSite(deleteTarget.value.username)) deleteTarget.value = null;
  } finally {
    deleting.value = false;
  }
}

onMounted(async () => {
  void api.get<{ deploymentMode?: string }>("/config")
    .then((config) => { managed.value = config.deploymentMode === "managed"; })
    .catch(() => { managed.value = false; });
  void api.get<SiteBadgeState>("/site-badge").then((state) => { siteBadge.value = state; }).catch(() => null);
  await sites.ensureSites();
});
</script>

<template>
  <section class="site-domains" aria-labelledby="site-domains-title">
    <h3 id="site-domains-title">Sites and website domains</h3>

    <div v-if="!listedSites.length" class="site-domains__empty">
      <p>You don't have a website yet.</p>
      <Button color="outline" shape="soft" size="compact" to="/create">Create your website</Button>
    </div>

    <ul v-else class="site-domains__list">
      <li v-for="site in listedSites" :key="site.id" class="site-domains__item">
        <div class="site-domains__row">
          <div class="site-domains__text">
            <strong>@{{ site.username }}</strong>
            <span>{{ domainLabel(site) }}</span>
          </div>
          <div class="site-domains__actions">
            <Button
              v-if="site.site_role === 'profile'"
              color="ghost"
              shape="soft"
              size="compact"
              :to="editRoute(site)"
            >
              Edit site
            </Button>
            <Button
              color="outline"
              shape="soft"
              size="compact"
              :aria-expanded="openDomain === site.username"
              :aria-controls="`site-domain-${site.id}`"
              @click="toggleDomain(site.username)"
            >
              {{ site.custom_domain ? "Manage domain" : "Set up domain" }}
            </Button>
          </div>
        </div>
        <div
          v-if="openDomain === site.username"
          :id="`site-domain-${site.id}`"
          class="site-domains__panel"
        >
          <CustomDomain
            embedded
            :managed="managed"
            :site-id="site.id"
            :username="site.username"
            :site-role="site.site_role === 'organization' ? 'organization' : 'profile'"
            :site-published="Boolean(site.published_at)"
            :fallback-url="permanentPublicSiteUrl(site.username, site.site_role === 'organization' ? 'organization' : 'profile')"
            @domain-status-changed="sites.fetchSites()"
          />
          <div v-if="site.site_role === 'organization'" class="site-domains__danger">
            <span>Older site. Deleting it frees @{{ site.username }} for others.</span>
            <Button color="danger" shape="soft" size="compact" @click="deleteTarget = site">Delete site</Button>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="siteBadge && hasPublishedSite" class="site-domains__badge">
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

    <ConfirmationDialog
      :open="Boolean(deleteTarget)"
      title="Delete site?"
      :message="`Delete @${deleteTarget?.username}? This can't be undone.`"
      confirm-label="Delete"
      :busy="deleting"
      danger
      @cancel="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped>
.site-domains {
  display: grid;
  gap: 12px;
}

.site-domains h3 {
  margin: 0;
}

.site-domains__empty,
.site-domains__badge,
.site-domains__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.site-domains__empty p,
.site-domains__badge p {
  margin: 2px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.site-domains__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-domains__item {
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.site-domains__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
}

.site-domains__text {
  display: grid;
  gap: 2px;
  min-width: 0;
  font-size: 13px;
}

.site-domains__text span {
  color: var(--ui-text-muted, var(--color-text-muted));
  overflow-wrap: anywhere;
}

.site-domains__actions {
  display: flex;
  gap: 8px;
}

.site-domains__panel {
  display: grid;
  gap: 16px;
  padding: 12px;
  border-top: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-surface, var(--color-bg));
  border-radius: 0 0 var(--ui-radius-sm, 8px) var(--ui-radius-sm, 8px);
}

.site-domains__danger span {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}
</style>

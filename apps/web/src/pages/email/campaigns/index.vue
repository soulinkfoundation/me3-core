<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute, useRouter } from "vue-router";
import {
  EMAIL_CAMPAIGNS_PLUGIN_ID,
  type CampaignAddOnPlanKey,
  type CampaignAddOnStatus,
} from "@me3-core/plugin-email-campaigns";
import { api } from "../../../api";
import Button from "../../../components/Button.vue";
import PageLoading from "../../../components/PageLoading.vue";
import UiIcon from "../../../components/UiIcon.vue";
import WorkspaceTabs from "../../../components/WorkspaceTabs.vue";
import { useAppToast } from "../../../composables/useAppToast";
import { useMailboxCacheStore } from "../../../stores/mailbox";
import type { UiIconName } from "../../../utils/icons";
import type { PluginRecord, PluginsResponse } from "../../../utils/plugins";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "Campaigns | ME3",
    description: "Create and review email campaigns.",
    robots: "noindex,follow",
  },
});

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";
type CampaignSummary = {
  id: string;
  siteId: string;
  siteUsername: string;
  subject: string;
  status: CampaignStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  failureReason: string | null;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  updatedAt: string;
};
type TransportStatus = {
  managed: boolean;
  ready: boolean;
  reason: string | null;
  sender: { fromAddress: string } | null;
  addOn: CampaignAddOnStatus | null;
  instructions: string[];
};

const loading = ref(true);
const refreshing = ref(false);
const loadFailed = ref(false);
const campaigns = ref<CampaignSummary[]>([]);
const campaignSearchQuery = ref("");
const transport = ref<TransportStatus | null>(null);
const campaignPlugin = ref<PluginRecord | null>(null);
const activatingPlugin = ref(false);
const checkoutPlan = ref<CampaignAddOnPlanKey | null>(null);
const openingBilling = ref(false);
const settingUpSender = ref(false);
const cancellingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);
const route = useRoute();
const router = useRouter();
const mailbox = useMailboxCacheStore();
const { folderCounts } = storeToRefs(mailbox);
const { toastFromUnknown } = useAppToast();
let refreshTimer: number | null = null;
let billingRefreshAttempts = 0;

const campaignMailboxTabs = computed<Array<{
  id: string;
  label: string;
  icon: UiIconName;
  count?: number | null;
}>>(() => [
  { id: "campaigns", label: "Campaigns", icon: "Send" },
  {
    id: "inbox",
    label: "Inbox",
    icon: "Inbox",
    count: folderCounts.value.inbox || null,
  },
  {
    id: "drafts",
    label: "Drafts",
    icon: "FileText",
    count: folderCounts.value.drafts || null,
  },
  { id: "sent", label: "Sent", icon: "Send" },
  { id: "archive", label: "Archive", icon: "Archive" },
  { id: "trash", label: "Trash", icon: "Trash2" },
]);

const hasActiveCampaigns = computed(() =>
  campaigns.value.some((campaign) => ["scheduled", "sending"].includes(campaign.status)),
);
const filteredCampaigns = computed(() => {
  const query = campaignSearchQuery.value.trim().toLowerCase();
  if (!query) return campaigns.value;
  return campaigns.value.filter((campaign) =>
    [
      campaignTitle(campaign),
      campaign.siteUsername,
      statusLabel(campaign.status),
      campaign.failureReason || "",
    ].some((value) => value.toLowerCase().includes(query)),
  );
});
const pluginEnabled = computed(() => Boolean(campaignPlugin.value?.enabled));
const canCreateCampaign = computed(() => pluginEnabled.value);
const billingReturn = computed(() =>
  typeof route.query.campaign_add_on === "string" ? route.query.campaign_add_on : "",
);

function switchCampaignMailboxTab(tabId: string) {
  if (tabId === "campaigns") return;
  void router.push({
    path: "/email",
    query: tabId === "inbox" ? {} : { tab: tabId },
  });
}

async function loadCampaignAccess() {
  loading.value = true;
  loadFailed.value = false;
  try {
    const response = await api.get<PluginsResponse>("/plugins");
    campaignPlugin.value = response.plugins.find(
      (plugin) => plugin.id === EMAIL_CAMPAIGNS_PLUGIN_ID,
    ) || null;
    if (!campaignPlugin.value) {
      throw new Error("Email Campaigns is not available in this ME3 installation.");
    }
    if (campaignPlugin.value.enabled) await loadCampaigns();
  } catch (caught) {
    loadFailed.value = true;
    toastFromUnknown(caught, "Unable to load campaigns.");
  } finally {
    loading.value = false;
  }
}

async function loadCampaigns(silent = false) {
  if (silent) refreshing.value = true;
  else loading.value = true;
  try {
    const [campaignResponse, transportResponse] = await Promise.all([
      api.get<{ campaigns: CampaignSummary[] }>("/email/campaigns"),
      api.get<{ transport: TransportStatus }>("/email/campaigns/transport"),
    ]);
    campaigns.value = campaignResponse.campaigns;
    transport.value = transportResponse.transport;
    scheduleRefresh();
  } catch (caught) {
    if (!silent) loadFailed.value = true;
    toastFromUnknown(caught, "Unable to load campaigns.");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function scheduleRefresh() {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  if (
    billingReturn.value === "success" &&
    transport.value?.managed &&
    !transport.value.addOn?.planKey &&
    billingRefreshAttempts < 4
  ) {
    billingRefreshAttempts += 1;
    refreshTimer = window.setTimeout(() => void loadCampaigns(true), 2_500);
    return;
  }
  billingRefreshAttempts = 0;
  refreshTimer = hasActiveCampaigns.value
    ? window.setTimeout(() => void loadCampaigns(true), 15_000)
    : null;
}

async function activateCampaignPlugin() {
  if (!campaignPlugin.value || activatingPlugin.value) return;
  activatingPlugin.value = true;
  try {
    const response = await api.post<{ plugin: PluginRecord }>(
      `/plugins/${encodeURIComponent(EMAIL_CAMPAIGNS_PLUGIN_ID)}/activate`,
    );
    campaignPlugin.value = response.plugin;
    await loadCampaigns();
  } catch (caught) {
    toastFromUnknown(caught, "Unable to activate Email Campaigns.");
  } finally {
    activatingPlugin.value = false;
  }
}

async function startCheckout(plan: CampaignAddOnPlanKey) {
  if (checkoutPlan.value) return;
  checkoutPlan.value = plan;
  try {
    const response = await api.post<{ url: string }>("/email/campaigns/add-on/checkout", {
      plan,
    });
    window.location.assign(response.url);
  } catch (caught) {
    toastFromUnknown(caught, "Unable to open checkout.");
    checkoutPlan.value = null;
  }
}

async function openBillingPortal() {
  if (openingBilling.value) return;
  openingBilling.value = true;
  try {
    const response = await api.post<{ url: string }>("/email/campaigns/add-on/portal");
    window.location.assign(response.url);
  } catch (caught) {
    toastFromUnknown(caught, "Unable to open billing.");
    openingBilling.value = false;
  }
}

async function setupSender() {
  if (settingUpSender.value) return;
  settingUpSender.value = true;
  try {
    const response = await api.post<{ transport: TransportStatus }>(
      "/email/campaigns/sender/setup",
    );
    transport.value = response.transport;
  } catch (caught) {
    toastFromUnknown(caught, "Unable to set up campaign sending.");
  } finally {
    settingUpSender.value = false;
  }
}

async function cancelCampaign(campaign: CampaignSummary) {
  const subject = campaign.subject.trim();
  const prompt = subject
    ? `Cancel “${subject}”? Unsent recipients will not be emailed.`
    : "Cancel this campaign? Unsent recipients will not be emailed.";
  if (!window.confirm(prompt)) return;
  cancellingId.value = campaign.id;
  try {
    await api.post(`/email/campaigns/${encodeURIComponent(campaign.id)}/cancel`);
    await loadCampaigns(true);
  } catch (caught) {
    toastFromUnknown(caught, "Unable to cancel campaign.");
  } finally {
    cancellingId.value = null;
  }
}

function canDeleteCampaign(campaign: CampaignSummary) {
  return ["draft", "failed", "cancelled"].includes(campaign.status);
}

async function deleteCampaign(campaign: CampaignSummary) {
  if (deletingId.value) return;
  const subject = campaignTitle(campaign);
  const prompt = campaign.status === "draft"
    ? `Delete “${subject}” draft? Its content will be permanently removed.`
    : `Delete “${subject}” and its delivery history? This cannot be undone.`;
  if (!window.confirm(prompt)) return;
  deletingId.value = campaign.id;
  try {
    await api.delete(`/email/campaigns/${encodeURIComponent(campaign.id)}`);
    campaigns.value = campaigns.value.filter((item) => item.id !== campaign.id);
  } catch (caught) {
    toastFromUnknown(caught, "Unable to delete campaign.");
  } finally {
    deletingId.value = null;
  }
}

function statusLabel(status: CampaignStatus) {
  return {
    draft: "Draft",
    scheduled: "Scheduled",
    sending: "Sending",
    sent: "Sent",
    cancelled: "Cancelled",
    failed: "Failed",
  }[status];
}

function statusDetail(campaign: CampaignSummary) {
  if (campaign.status === "draft") return null;
  if (campaign.status === "scheduled" && campaign.scheduledFor) {
    return `Scheduled ${formatDate(campaign.scheduledFor)}`;
  }
  if (campaign.status === "sending") {
    return `${campaign.deliveredCount} of ${campaign.recipientCount} delivered`;
  }
  if (campaign.status === "sent") {
    return `${campaign.deliveredCount} delivered · ${campaign.failedCount} unavailable`;
  }
  return campaign.failureReason || statusLabel(campaign.status);
}

function campaignTitle(campaign: CampaignSummary) {
  return campaign.subject.trim() || "No subject";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatResetDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

onMounted(() => {
  void Promise.all([loadCampaignAccess(), mailbox.loadFolderCounts()]);
});
onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
});
</script>

<template>
  <main class="agent-page campaigns-page">
    <Teleport to="#app-page-controls" defer>
      <form class="campaigns-mobile-nav" role="search" @submit.prevent>
        <label class="campaigns-mobile-nav__label" for="campaign-search-input-top">
          Search campaigns
        </label>
        <input
          id="campaign-search-input-top"
          v-model="campaignSearchQuery"
          class="campaigns-mobile-nav__input"
          type="search"
          placeholder="Search campaigns"
        />
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          type="submit"
          aria-label="Search campaigns"
          title="Search"
        >
          <UiIcon name="Search" :size="18" aria-hidden="true" />
        </Button>
        <Button
          v-if="canCreateCampaign"
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          to="/email/campaigns/create"
          aria-label="Create campaign"
          title="Create campaign"
        >
          <UiIcon name="SquarePen" :size="18" aria-hidden="true" />
        </Button>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          to="/email"
          aria-label="Close campaigns and return to Inbox"
          title="Close"
        >
          <UiIcon name="X" :size="18" aria-hidden="true" />
        </Button>
      </form>
    </Teleport>

    <div class="campaigns-mail-tabs">
      <WorkspaceTabs
        :tabs="campaignMailboxTabs"
        model-value="campaigns"
        aria-label="Mailbox folders"
        semantics="navigation"
        @change="switchCampaignMailboxTab"
      />
    </div>

    <div class="campaigns-shell">

      <PageLoading v-if="loading" label="Loading campaigns…" />
      <section v-else-if="loadFailed" class="empty-campaigns" aria-labelledby="campaign-load-failed-title">
        <span aria-hidden="true"><UiIcon name="Info" :size="28" /></span>
        <h2 id="campaign-load-failed-title">Campaigns could not be loaded</h2>
        <p>Check your connection and try again.</p>
        <Button color="primary" shape="soft" @click="loadCampaignAccess">Try again</Button>
      </section>
      <section v-else-if="!pluginEnabled" class="campaign-setup" aria-labelledby="campaign-plugin-title">
        <span class="campaign-setup__icon" aria-hidden="true"><UiIcon name="Send" :size="26" /></span>
        <div>
          <small>Optional plugin</small>
          <h1 id="campaign-plugin-title">Email Campaigns</h1>
          <p>Create newsletters from your ME3 lists, review consent-aware audiences, and keep delivery history with your site.</p>
          <p>Activating the plugin is free. Delivery is configured separately.</p>
          <Button
            color="primary"
            shape="soft"
            :disabled="activatingPlugin"
            @click="activateCampaignPlugin"
          >
            {{ activatingPlugin ? "Activating…" : "Activate Email Campaigns" }}
          </Button>
        </div>
      </section>

      <template v-else>
        <p v-if="billingReturn === 'cancelled'" class="notice" role="status">
          No changes were made. You can choose a delivery allowance whenever you are ready.
        </p>
        <p
          v-else-if="billingReturn === 'success' && !transport?.addOn?.planKey"
          class="notice"
          role="status"
        >
          Payment received. Campaign delivery is being activated…
        </p>

        <section
          v-if="transport?.managed && transport.addOn && !transport.addOn.planKey"
          class="campaign-add-on"
          aria-labelledby="campaign-add-on-title"
        >
          <div class="campaign-add-on__intro">
            <h1 id="campaign-add-on-title">Choose your monthly email capacity</h1>
            <p>Hosted by ME3 includes 500 deliveries per calendar month. Upgrade for more; each plan below is your total monthly allowance.</p>
          </div>
          <div class="capacity-options" aria-label="Campaign Sending plans">
            <article v-for="plan in transport.addOn.plans" :key="plan.key" class="capacity-option">
              <strong>{{ formatNumber(plan.allowance) }}</strong>
              <span>email deliveries / month</span>
              <p>${{ plan.monthlyPriceUsd }} <small>USD / month</small></p>
              <Button
                color="primary"
                shape="soft"
                size="small"
                :disabled="checkoutPlan === plan.key || !plan.checkoutAvailable || !transport.addOn.available"
                @click="startCheckout(plan.key)"
              >
                {{ checkoutPlan === plan.key ? "Opening checkout…" : plan.checkoutAvailable ? "Choose plan" : "Coming soon" }}
              </Button>
            </article>
          </div>
        </section>

        <section
          v-if="transport?.managed && transport.addOn?.entitled"
          class="delivery-summary"
          aria-labelledby="campaign-delivery-title"
        >
          <div>
            <small>Campaign Sending</small>
            <h2 id="campaign-delivery-title">
              {{ formatNumber(transport.addOn.remaining) }} deliveries remaining
            </h2>
            <p>
              {{ formatNumber(transport.addOn.used) }} of {{ formatNumber(transport.addOn.allowance) }} used · resets {{ formatResetDate(transport.addOn.resetAt) }}
            </p>
            <p v-if="transport.sender">Sending from {{ transport.sender.fromAddress }}</p>
          </div>
          <div class="delivery-summary__actions">
            <Button
              v-if="!transport.ready"
              color="primary"
              shape="soft"
              size="small"
              :disabled="settingUpSender"
              @click="setupSender"
            >
              {{ settingUpSender ? "Setting up…" : "Set up campaign sender" }}
            </Button>
            <Button
              color="outline"
              shape="soft"
              size="small"
              v-if="transport.addOn.planKey"
              :disabled="openingBilling"
              @click="openBillingPortal"
            >
              {{ openingBilling ? "Opening…" : "Manage capacity" }}
            </Button>
          </div>
        </section>

        <section
          v-else-if="transport && !transport.managed"
          class="notice"
          aria-labelledby="campaign-availability-title"
        >
          <UiIcon name="Info" :size="20" aria-hidden="true" />
          <div>
            <strong id="campaign-availability-title">Configure delivery for this self-hosted installation</strong>
            <p>{{ transport.instructions[0] || "Drafts and subscriber management are ready. Connect an email provider before sending." }}</p>
          </div>
        </section>

        <section v-else-if="transport && !transport.ready" class="notice" aria-labelledby="campaign-availability-title">
          <UiIcon name="Info" :size="20" aria-hidden="true" />
          <div>
            <strong id="campaign-availability-title">Campaign sending is not ready</strong>
            <p>{{ transport.instructions[0] || "Drafts remain available while managed delivery is being configured." }}</p>
          </div>
        </section>

        <section v-if="filteredCampaigns.length" class="campaign-list" aria-label="Email campaigns">
          <article
            v-for="campaign in filteredCampaigns"
            :key="campaign.id"
            class="campaign-card"
            :class="{ 'campaign-card--clickable': campaign.status === 'draft' }"
          >
            <router-link
              v-if="campaign.status === 'draft'"
              class="campaign-card__link"
              :to="{ path: '/email/campaigns/create', query: { campaign: campaign.id } }"
              :aria-label="`Open ${campaignTitle(campaign)} for @${campaign.siteUsername}`"
            >
              <span class="sr-only">Open campaign</span>
            </router-link>
            <div class="campaign-card__main">
              <div class="campaign-card__title-row">
                <h2>
                  {{ campaignTitle(campaign) }}
                  <span class="campaign-card__site">- @{{ campaign.siteUsername }}</span>
                </h2>
                <span class="status-pill" :class="`status-pill--${campaign.status}`">{{ statusLabel(campaign.status) }}</span>
              </div>
              <p v-if="statusDetail(campaign)">{{ statusDetail(campaign) }}</p>
              <small>Updated {{ formatDate(campaign.updatedAt) }}</small>
            </div>
            <div class="campaign-card__actions">
              <Button
                v-if="canDeleteCampaign(campaign)"
                class="campaign-card__delete"
                color="ghost"
                shape="soft"
                size="large"
                icon-only
                :disabled="deletingId === campaign.id"
                :aria-label="`${deletingId === campaign.id ? 'Deleting' : 'Delete'} ${campaignTitle(campaign)}`"
                :title="deletingId === campaign.id ? 'Deleting campaign' : 'Delete campaign'"
                @click="deleteCampaign(campaign)"
              >
                <UiIcon name="Trash2" :size="18" aria-hidden="true" />
              </Button>
              <Button v-if="['scheduled', 'sending'].includes(campaign.status)" color="ghost" shape="soft" size="compact" :disabled="cancellingId === campaign.id" @click="cancelCampaign(campaign)">
                {{ cancellingId === campaign.id ? "Cancelling…" : "Cancel" }}
              </Button>
            </div>
          </article>
        </section>

        <section v-else-if="campaigns.length" class="empty-campaigns">
          <span aria-hidden="true"><UiIcon name="Search" :size="28" /></span>
          <h2>No matching campaigns</h2>
          <p>Try another subject, site, status, or failure reason.</p>
          <Button color="outline" shape="soft" @click="campaignSearchQuery = ''">Clear search</Button>
        </section>

        <section v-else class="empty-campaigns">
          <span aria-hidden="true"><UiIcon name="Send" :size="28" /></span>
          <h2>No campaigns yet</h2>
          <p>Create a focused update, review the eligible audience, then send now or schedule it.</p>
          <Button v-if="canCreateCampaign" color="primary" shape="soft" to="/email/campaigns/create">Create campaign</Button>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.campaigns-page { display: flex; flex-direction: column; min-height: 100%; background: var(--ui-bg, var(--color-bg)); color: var(--ui-text, var(--color-text)); }
.campaigns-mobile-nav { display: grid; grid-template-columns: minmax(0, 1fr) 36px auto 36px; align-items: center; gap: 8px; width: 100%; margin: 0; min-width: 0; }
.campaigns-mobile-nav__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
.campaigns-mobile-nav__input { min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-sm, 6px); background: var(--ui-bg, var(--color-bg)); color: var(--ui-text, var(--color-text)); font: inherit; }
.campaigns-mobile-nav__input:focus { outline: 2px solid var(--ui-focus, var(--ui-text, var(--color-text))); outline-offset: 1px; }
.campaigns-mobile-nav :deep(.me3-btn) { flex: 0 0 36px; width: 36px; height: 36px; }
.campaigns-mail-tabs { display: flex; justify-content: flex-start; width: 100%; padding: 4px 8px 0; border-bottom: 1px solid var(--ui-border, var(--color-border)); background: var(--ui-bg, var(--color-bg)); overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.campaigns-mail-tabs::-webkit-scrollbar { display: none; }
.campaigns-shell { width: min(100%, 900px); margin: 0 auto; padding: 24px 24px 72px; box-sizing: border-box; }
.campaign-card__actions { position: absolute; right: 8px; bottom: 6px; z-index: 2; display: flex; align-items: center; gap: 8px; }
.campaign-card__actions :deep(.campaign-card__delete) { color: var(--ui-danger, #b42318); }
.campaign-card__actions :deep(.campaign-card__delete:hover:not(:disabled)) { background: var(--ui-danger-soft, color-mix(in srgb, var(--ui-danger, #b42318) 10%, transparent)); color: var(--ui-danger, #b42318); }
.notice { display: flex; gap: 12px; margin-bottom: 20px; padding: 15px 16px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface-muted, var(--color-bg-subtle)); }
.notice strong, .notice p { display: block; margin: 0; }
.notice p { margin-top: 3px; color: var(--ui-text-muted, var(--color-text-muted)); line-height: 1.45; }
.campaign-setup { display: grid; grid-template-columns: auto minmax(0, 1fr); max-width: 620px; gap: 18px; margin: 64px auto 0; padding: 24px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-lg, 16px); background: var(--ui-surface, var(--color-bg)); }
.campaign-setup__icon { display: grid; width: 52px; height: 52px; place-items: center; border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface-muted, var(--color-bg-subtle)); color: var(--ui-accent, var(--color-accent)); }
.campaign-setup small, .delivery-summary small { color: var(--ui-text-muted, var(--color-text-muted)); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.campaign-setup h1, .campaign-setup p { margin: 0; }
.campaign-setup h1 { margin-top: 3px; font-size: 1.4rem; }
.campaign-setup p { margin-top: 8px; color: var(--ui-text-muted, var(--color-text-muted)); line-height: 1.5; }
.campaign-setup :deep(.me3-btn) { margin-top: 18px; }
.campaign-add-on { margin-bottom: 24px; padding: 22px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-lg, 16px); background: var(--ui-surface, var(--color-bg)); }
.campaign-add-on__intro h1, .campaign-add-on__intro p { margin: 0; }
.campaign-add-on__intro h1 { font-size: 1.3rem; }
.campaign-add-on__intro p { max-width: 680px; margin-top: 6px; color: var(--ui-text-muted, var(--color-text-muted)); line-height: 1.45; }
.capacity-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.capacity-option { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; padding: 16px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface-muted, var(--color-bg-subtle)); }
.capacity-option > strong { font-size: 1.3rem; }
.capacity-option > span { color: var(--ui-text-muted, var(--color-text-muted)); font-size: .78rem; }
.capacity-option p { margin: 15px 0 12px; font-weight: 700; }
.capacity-option p small { color: var(--ui-text-muted, var(--color-text-muted)); font-size: .72rem; font-weight: 500; }
.capacity-option :deep(.me3-btn) { width: 100%; margin-top: auto; }
.delivery-summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; padding: 17px 18px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface-muted, var(--color-bg-subtle)); }
.delivery-summary h2, .delivery-summary p { margin: 0; }
.delivery-summary h2 { margin-top: 2px; font-size: 1.05rem; }
.delivery-summary p { margin-top: 3px; color: var(--ui-text-muted, var(--color-text-muted)); font-size: .82rem; }
.delivery-summary__actions { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.campaign-list { display: grid; gap: 8px; }
.campaign-card { position: relative; min-height: 100px; padding: 14px 104px 12px 16px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface, var(--color-bg)); box-sizing: border-box; transition: border-color .15s ease, background .15s ease; }
.campaign-card--clickable:hover { border-color: var(--ui-border-strong, var(--ui-accent, var(--color-accent))); background: var(--ui-surface-muted, var(--color-bg-subtle)); }
.campaign-card__link { position: absolute; inset: 0; z-index: 1; border-radius: inherit; }
.campaign-card__link:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }
.campaign-card__main { min-width: 0; flex: 1; }
.campaign-card__title-row { min-width: 0; }
.campaign-card h2 { overflow: hidden; margin: 0; padding-right: 62px; font-size: .96rem; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.campaign-card p, .campaign-card small { margin: 0; color: var(--ui-text-muted, var(--color-text-muted)); }
.campaign-card p { margin-top: 4px; font-size: .82rem; }
.campaign-card small { display: block; margin-top: 5px; font-size: .72rem; }
.campaign-card__site { color: var(--ui-accent, var(--color-accent)); font-weight: 700; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.status-pill { position: absolute; top: 10px; right: 12px; padding: 4px 8px; border-radius: 999px; background: var(--ui-surface-muted, var(--color-bg-subtle)); color: var(--ui-text-muted, var(--color-text-muted)); font-size: .7rem; font-weight: 700; }
.status-pill--sending, .status-pill--scheduled { background: color-mix(in srgb, var(--ui-accent, #13a27d) 12%, transparent); color: var(--ui-accent-strong, var(--color-accent)); }
.status-pill--failed { background: color-mix(in srgb, var(--ui-danger, #b42318) 10%, transparent); color: var(--ui-danger, #b42318); }
.empty-campaigns { display: grid; max-width: 520px; justify-items: center; gap: 10px; margin: 80px auto 0; text-align: center; }
.empty-campaigns > span { display: grid; width: 58px; height: 58px; place-items: center; border-radius: 16px; background: var(--ui-surface-muted, var(--color-bg-subtle)); color: var(--ui-accent, var(--color-accent)); }
.empty-campaigns h2, .empty-campaigns p { margin: 0; }
.empty-campaigns p { margin-bottom: 8px; color: var(--ui-text-muted, var(--color-text-muted)); line-height: 1.55; }
@media (min-width: 768px) {
  .campaigns-mail-tabs { justify-content: center; }
}
@media (max-width: 640px) {
  .campaigns-shell { padding: 16px 16px 72px; }
  .campaign-setup { grid-template-columns: 1fr; margin-top: 32px; padding: 20px; }
  .capacity-options { grid-template-columns: 1fr; }
  .delivery-summary { align-items: flex-start; flex-direction: column; }
  .delivery-summary__actions { justify-content: flex-start; }
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { RouterLink } from "vue-router";
import {
  EMAIL_CAMPAIGNS_PLUGIN_ID,
  type CampaignAddOnStatus,
} from "@me3-core/plugin-email-campaigns";
import { api } from "../../../api";
import Button from "../../../components/Button.vue";
import ConfirmationDialog from "../../../components/ConfirmationDialog.vue";
import PageLoading from "../../../components/PageLoading.vue";
import { useAppToast } from "../../../composables/useAppToast";
import { useCampaignActions } from "../../../composables/useCampaignActions";
import {
  CAMPAIGN_GROUPS,
  campaignDetail,
  campaignGroup,
  campaignSortKey,
  campaignStatusLabel,
  campaignStatusTone,
  campaignTitle,
  canCancelCampaign,
  canDeleteCampaign,
  formatCount,
  type CampaignSummary,
} from "../../../utils/campaigns";
import type { PluginsResponse } from "../../../utils/plugins";

definePage({
  meta: {
    requiresAuth: true,
    title: "Campaigns | ME3",
    description: "Write, approve and send emails to your subscribers.",
    robots: "noindex,follow",
  },
});

type TransportStatus = {
  managed: boolean;
  ready: boolean;
  reason: string | null;
  sender: { fromAddress: string } | null;
  addOn: CampaignAddOnStatus | null;
  instructions: string[];
};
type View = "campaigns" | "subscribers";

const loading = ref(true);
const loadFailed = ref(false);
// Until Business plan gating lands (me3-bli3.1) the plugin record decides who sees Campaigns.
const available = ref(false);
const campaigns = ref<CampaignSummary[]>([]);
const transport = ref<TransportStatus | null>(null);
const settingUpSender = ref(false);
const view = ref<View>("campaigns");
const { toastFromUnknown } = useAppToast();
const actions = useCampaignActions({
  cancelled: () => loadCampaigns(true),
  deleted: (id) => {
    campaigns.value = campaigns.value.filter((campaign) => campaign.id !== id);
  },
});
let refreshTimer: number | null = null;

const groups = computed(() =>
  CAMPAIGN_GROUPS.map((group) => ({
    ...group,
    campaigns: campaigns.value
      .filter((campaign) => campaignGroup(campaign.status) === group.id)
      .sort((a, b) => campaignSortKey(b).localeCompare(campaignSortKey(a)) * (group.id === "coming-up" ? -1 : 1)),
  })).filter((group) => group.campaigns.length),
);
const allowance = computed(() => {
  const addOn = transport.value?.managed ? transport.value.addOn : null;
  if (!addOn?.entitled || !addOn.allowance) return null;
  return {
    remaining: addOn.remaining,
    allowance: addOn.allowance,
    usedPercent: Math.min(100, Math.round((addOn.used / addOn.allowance) * 100)),
    low: addOn.remaining <= addOn.allowance * 0.1,
    resetAt: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(addOn.resetAt)),
  };
});
const senderNote = computed(() => {
  const current = transport.value;
  if (!current || current.ready) return null;
  // Server instructions still describe the old plugin setup, so the page words this itself.
  if (!current.managed) return "Connect an email provider before your first send.";
  return "Sending isn't set up yet. Drafts are saved in the meantime.";
});

async function loadPage() {
  loading.value = true;
  loadFailed.value = false;
  try {
    const response = await api.get<PluginsResponse>("/plugins");
    available.value = Boolean(
      response.plugins.find((plugin) => plugin.id === EMAIL_CAMPAIGNS_PLUGIN_ID)?.enabled,
    );
    if (available.value) await loadCampaigns();
  } catch (caught) {
    loadFailed.value = true;
    toastFromUnknown(caught, "Couldn't load campaigns.");
  } finally {
    loading.value = false;
  }
}

async function loadCampaigns(silent = false) {
  try {
    const [campaignResponse, transportResponse] = await Promise.all([
      api.get<{ campaigns: CampaignSummary[] }>("/email/campaigns"),
      api.get<{ transport: TransportStatus }>("/email/campaigns/transport"),
    ]);
    campaigns.value = campaignResponse.campaigns;
    transport.value = transportResponse.transport;
    scheduleRefresh();
  } catch (caught) {
    if (!silent) throw caught;
    toastFromUnknown(caught, "Couldn't refresh campaigns.");
  }
}

// Keep sending progress current without a manual refresh.
function scheduleRefresh() {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = campaigns.value.some((campaign) => canCancelCampaign(campaign.status))
    ? window.setTimeout(() => void loadCampaigns(true), 15_000)
    : null;
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
    toastFromUnknown(caught, "Couldn't set up sending.");
  } finally {
    settingUpSender.value = false;
  }
}

function campaignLink(campaign: CampaignSummary) {
  return campaign.status === "draft"
    ? { path: "/email/campaigns/create", query: { campaign: campaign.id } }
    : `/email/campaigns/${encodeURIComponent(campaign.id)}`;
}

function selectView(next: View) {
  view.value = next;
}

function moveView(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  view.value = view.value === "campaigns" ? "subscribers" : "campaigns";
  (document.getElementById(`campaigns-view-${view.value}`) as HTMLElement | null)?.focus();
}

onMounted(() => void loadPage());
onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
});
</script>

<template>
  <main class="campaigns-page">
    <div class="campaigns-column">
      <PageLoading v-if="loading" label="Loading campaigns…" />

      <section v-else-if="loadFailed" class="campaigns-state" aria-labelledby="campaigns-failed-title">
        <h1 id="campaigns-failed-title">Campaigns didn't load</h1>
        <p>Check your connection and try again.</p>
        <Button color="ghost" shape="soft" size="compact" @click="loadPage">Try again</Button>
      </section>

      <section v-else-if="!available" class="campaigns-state" aria-labelledby="campaigns-unavailable-title">
        <h1 id="campaigns-unavailable-title">Email your subscribers</h1>
        <p>Tell ME3 what's new. It writes the email and sends it when you say so.</p>
        <p class="campaigns-state__example">
          “Tell my subscribers about the November retreat” → a draft for your subscribers, waiting for your OK.
        </p>
        <p>Campaigns isn't available on this account yet.</p>
      </section>

      <template v-else>
        <header class="campaigns-header">
          <h1>Campaigns</h1>
          <Button color="primary" shape="pill" size="compact" to="/email/campaigns/create">
            New campaign
          </Button>
        </header>

        <div class="campaigns-switch" role="tablist" aria-label="Campaigns views" @keydown="moveView">
          <button
            id="campaigns-view-campaigns"
            type="button"
            role="tab"
            :aria-selected="view === 'campaigns'"
            aria-controls="campaigns-panel-campaigns"
            :tabindex="view === 'campaigns' ? 0 : -1"
            @click="selectView('campaigns')"
          >Campaigns</button>
          <button
            id="campaigns-view-subscribers"
            type="button"
            role="tab"
            :aria-selected="view === 'subscribers'"
            aria-controls="campaigns-panel-subscribers"
            :tabindex="view === 'subscribers' ? 0 : -1"
            @click="selectView('subscribers')"
          >Subscribers</button>
        </div>

        <section
          v-if="view === 'campaigns'"
          id="campaigns-panel-campaigns"
          role="tabpanel"
          aria-labelledby="campaigns-view-campaigns"
        >
          <p v-if="allowance" class="campaigns-meter" :class="{ 'campaigns-meter--low': allowance.low }">
            <span class="campaigns-meter__bar" aria-hidden="true"><i :style="{ width: `${allowance.usedPercent}%` }" /></span>
            <span><b>{{ formatCount(allowance.remaining) }}</b> of {{ formatCount(allowance.allowance) }} sends left · resets {{ allowance.resetAt }}</span>
          </p>
          <p v-if="senderNote" class="campaigns-note" role="status">
            <span>{{ senderNote }}</span>
            <Button
              v-if="transport?.managed"
              color="ghost"
              shape="soft"
              size="compact"
              :disabled="settingUpSender"
              @click="setupSender"
            >{{ settingUpSender ? "Setting up…" : "Set up sending" }}</Button>
          </p>

          <section
            v-for="group in groups"
            :key="group.id"
            class="campaigns-group"
            :aria-labelledby="`campaigns-group-${group.id}`"
          >
            <h2 :id="`campaigns-group-${group.id}`">{{ group.label }}</h2>
            <ul class="campaigns-list">
              <li v-for="campaign in group.campaigns" :key="campaign.id" class="campaign-row">
                <RouterLink
                  class="campaign-row__link"
                  :to="campaignLink(campaign)"
                  :aria-label="`Open ${campaignTitle(campaign)}`"
                >
                  <span class="campaign-row__subject">{{ campaignTitle(campaign) }}</span>
                  <span class="campaign-row__detail">{{ campaignDetail(campaign) }}</span>
                </RouterLink>
                <div class="campaign-row__side">
                  <span class="campaign-pill" :class="`campaign-pill--${campaignStatusTone(campaign.status)}`">
                    {{ campaignStatusLabel(campaign.status) }}
                  </span>
                  <Button
                    v-if="canCancelCampaign(campaign.status)"
                    class="campaign-row__action"
                    color="ghost"
                    shape="soft"
                    size="small"
                    :disabled="actions.isBusy(campaign.id)"
                    @click="actions.askCancel(campaign)"
                  >Cancel</Button>
                  <Button
                    v-else-if="canDeleteCampaign(campaign.status)"
                    class="campaign-row__action campaign-row__action--danger"
                    color="ghost"
                    shape="soft"
                    size="small"
                    :disabled="actions.isBusy(campaign.id)"
                    @click="actions.askDelete(campaign)"
                  >Delete</Button>
                </div>
              </li>
            </ul>
          </section>

          <div v-if="!campaigns.length" class="campaigns-empty">
            <p>No campaigns yet. Tell ME3 what's new and it will write the first one.</p>
            <RouterLink to="/email/campaigns/create">Write a campaign</RouterLink>
          </div>
        </section>

        <section
          v-else
          id="campaigns-panel-subscribers"
          role="tabpanel"
          aria-labelledby="campaigns-view-subscribers"
          class="campaigns-empty"
        >
          <p>Your subscribers will be listed here soon. For now you'll find them on your site's page.</p>
          <RouterLink to="/sites">Open Sites</RouterLink>
        </section>
      </template>
    </div>

    <ConfirmationDialog
      :open="Boolean(actions.dialog.value)"
      :title="actions.dialog.value?.title || ''"
      :message="actions.dialog.value?.message || ''"
      :confirm-label="actions.dialog.value?.confirmLabel"
      :cancel-label="actions.dialog.value?.cancelLabel"
      :busy="actions.busy.value"
      danger
      @cancel="actions.dismiss"
      @confirm="actions.confirm"
    />
  </main>
</template>

<style scoped>
/* Own destination: plain page flow so the app scrolls it at every size (no Email shell, no fixed height). */
.campaigns-page { min-height: calc(100dvh - var(--app-topbar-height)); background: var(--ui-bg); color: var(--ui-text); }
.campaigns-column { box-sizing: border-box; width: min(100%, 560px); margin: 0 auto; padding: 16px 16px 96px; }
.campaigns-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.campaigns-header h1 { margin: 0; font-size: 22px; font-weight: 650; line-height: 1.2; }
.campaigns-switch { display: inline-flex; gap: 2px; margin-top: 14px; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.campaigns-switch button { min-height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text-muted); font: 500 13px var(--font-sans); cursor: pointer; }
.campaigns-switch button[aria-selected="true"] { background: var(--ui-primary); color: var(--ui-primary-contrast); font-weight: 600; }
.campaigns-switch button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.campaigns-meter { display: flex; align-items: center; gap: 10px; margin: 14px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.campaigns-meter b { color: var(--ui-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.campaigns-meter__bar { flex: 0 0 120px; height: 5px; overflow: hidden; border-radius: 99px; background: var(--ui-surface-muted); }
.campaigns-meter__bar i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); }
.campaigns-meter--low .campaigns-meter__bar i { background: var(--ui-warning, #b26a00); }
.campaigns-note { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; margin: 12px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.campaigns-group { margin-top: 22px; }
.campaigns-group h2 { margin: 0 0 4px; color: var(--ui-text-muted); font-size: 12px; font-weight: 600; letter-spacing: .02em; }
.campaigns-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--ui-border); }
.campaign-row { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--ui-border); }
.campaign-row__link { display: grid; flex: 1 1 auto; min-width: 0; gap: 2px; padding: 11px 2px; color: inherit; text-decoration: none; border-radius: var(--ui-radius-sm); }
.campaign-row__link:hover .campaign-row__subject { text-decoration: underline; text-underline-offset: 3px; }
.campaign-row__link:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.campaign-row__subject { overflow: hidden; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.campaign-row__detail { overflow: hidden; color: var(--ui-text-muted); font-size: 13px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
.campaign-row__side { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.campaign-row__side :deep(.campaign-row__action) { min-height: 32px; padding-inline: 8px; color: var(--ui-text-muted); }
.campaign-row__side :deep(.campaign-row__action--danger) { color: var(--ui-danger, color-mix(in oklab, #c62828 75%, var(--ui-text))); }
.campaign-pill { --tone: var(--ui-text-muted); padding: 2px 8px; border-radius: 999px; background: var(--ui-surface-muted); color: var(--tone); font-size: 12px; font-weight: 600; white-space: nowrap; }
/* The theme has no status roles yet; mixing each hue with --ui-text keeps it readable in light and dark. */
.campaign-pill--ok { --tone: var(--ui-success, color-mix(in oklab, #1f8a5b 70%, var(--ui-text))); }
.campaign-pill--go { --tone: var(--ui-accent-strong, var(--ui-accent)); }
.campaign-pill--warn { --tone: var(--ui-warning, color-mix(in oklab, #b26a00 70%, var(--ui-text))); }
.campaign-pill--bad { --tone: var(--ui-danger, color-mix(in oklab, #c62828 75%, var(--ui-text))); }
.campaign-pill:not(.campaign-pill--muted) { background: color-mix(in srgb, var(--tone) 13%, transparent); }
.campaigns-empty { margin-top: 28px; color: var(--ui-text-muted); font-size: 14px; }
.campaigns-empty p { margin: 0 0 6px; }
.campaigns-empty a { color: var(--ui-accent-strong, var(--ui-accent)); font-weight: 600; text-decoration: none; }
.campaigns-empty a:hover { text-decoration: underline; }
.campaigns-state { margin-top: 40px; }
.campaigns-state h1 { margin: 0; font-size: 22px; font-weight: 650; }
.campaigns-state p { margin: 8px 0 0; color: var(--ui-text-muted); line-height: 1.5; }
.campaigns-state .campaigns-state__example { margin-top: 14px; padding: 10px 12px; border-radius: var(--ui-radius-sm); background: var(--ui-surface-muted); color: var(--ui-text); font-size: 14px; }
.campaigns-state :deep(.me3-btn) { margin-top: 12px; }
@media (max-width: 480px) {
  .campaigns-meter__bar { flex-basis: 56px; }
  .campaign-row { align-items: flex-start; }
  .campaign-row__side { flex-direction: column; align-items: flex-end; gap: 0; padding-top: 10px; }
}
</style>

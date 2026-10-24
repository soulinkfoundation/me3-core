<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { api } from "../../../api";
import Button from "../../../components/Button.vue";
import CampaignEmailPreview from "../../../components/CampaignEmailPreview.vue";
import ConfirmationDialog from "../../../components/ConfirmationDialog.vue";
import PageLoading from "../../../components/PageLoading.vue";
import { useAppToast } from "../../../composables/useAppToast";
import { useCampaignActions } from "../../../composables/useCampaignActions";
import {
  campaignStatusLabel,
  campaignStatusTone,
  campaignTitle,
  canCancelCampaign,
  canDeleteCampaign,
  formatCampaignDate,
  formatCount,
  type CampaignStatus,
} from "../../../utils/campaigns";

definePage({
  meta: {
    requiresAuth: true,
    title: "Campaign | ME3",
    description: "A campaign and how it went.",
    robots: "noindex,follow",
  },
});

type Campaign = {
  id: string;
  siteUsername: string;
  status: CampaignStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  failureReason: string | null;
  sender: { fromAddress: string } | null;
  approval?: { approvedAt: string; recipientCount: number | null } | null;
  updatedAt: string;
  revision: {
    subject: string;
    replyToAddress: string | null;
    document: { brand?: { name?: string } };
    renderedHtml: string | null;
  };
  progress: Record<string, number>;
};

type CampaignResults = {
  sentTo: number;
  delivered: number;
  replies: number;
  replyMessages: Array<{ messageId: string; from: string; subject: string; receivedAt: string }>;
  unsubscribed: number;
  markedSpam: number;
  didntArrive: number;
  didntArriveReasons: Record<"bounced" | "blocked" | "refused" | "failed", number>;
};

const REASON_LABELS: Record<keyof CampaignResults["didntArriveReasons"], string> = {
  bounced: "bounced",
  blocked: "blocked from earlier",
  refused: "refused by their provider",
  failed: "couldn't be sent",
};

const route = useRoute();
const router = useRouter();
const { toastFromUnknown } = useAppToast();
const loading = ref(true);
const campaign = ref<Campaign | null>(null);
const results = ref<CampaignResults | null>(null);
const copying = ref<"again" | "duplicate" | null>(null);
const campaignId = computed(() => String((route.params as { campaignId?: string }).campaignId || ""));
const actions = useCampaignActions({
  cancelled: () => load(),
  deleted: () => { void router.replace("/email/campaigns"); },
});

const summary = computed(() => {
  const current = campaign.value;
  if (!current) return null;
  return { id: current.id, subject: current.revision.subject, status: current.status };
});
const when = computed(() => {
  const current = campaign.value;
  if (!current) return "";
  if (current.status === "scheduled" && current.scheduledFor) return `Sends ${formatCampaignDate(current.scheduledFor)}`;
  if (current.sentAt) return `Sent ${formatCampaignDate(current.sentAt)}`;
  if (current.status === "cancelled") return `Cancelled ${formatCampaignDate(current.cancelledAt || current.updatedAt)}`;
  if (current.status === "failed") return current.failureReason || "Something went wrong before it sent";
  return `Updated ${formatCampaignDate(current.updatedAt)}`;
});
const stats = computed(() => {
  const current = results.value;
  if (!current?.sentTo) return [];
  return [
    { label: "delivered", value: current.delivered },
    { label: current.replies === 1 ? "reply" : "replies", value: current.replies },
    { label: "unsubscribed", value: current.unsubscribed },
    { label: "didn't arrive", value: current.didntArrive },
  ];
});
const resultNotes = computed(() => {
  const current = results.value;
  if (!current) return [];
  const notes: string[] = [];
  const reasons = (Object.keys(REASON_LABELS) as Array<keyof typeof REASON_LABELS>)
    .filter((reason) => current.didntArriveReasons[reason] > 0)
    .map((reason) => `${formatCount(current.didntArriveReasons[reason])} ${REASON_LABELS[reason]}`);
  if (reasons.length) notes.push(`Didn't arrive: ${reasons.join(", ")}.`);
  if (current.markedSpam) {
    notes.push(`${formatCount(current.markedSpam)} marked it as spam, so they won't get campaigns again.`);
  }
  return notes;
});
const approvalLine = computed(() => {
  const approval = campaign.value?.approval;
  if (!approval) return "";
  const count = approval.recipientCount ?? 0;
  return `You approved it for ${formatCount(count)} ${count === 1 ? "person" : "people"} on ${formatCampaignDate(approval.approvedAt)}.`;
});
const canSendAgain = computed(() => campaign.value?.status === "sent");

async function load() {
  loading.value = !campaign.value;
  try {
    const response = await api.get<{ campaign: Campaign }>(
      `/email/campaigns/${encodeURIComponent(campaignId.value)}`,
    );
    // Drafts are edited in the campaign editor.
    if (response.campaign.status === "draft") {
      await router.replace({ path: "/email/campaigns/create", query: { campaign: response.campaign.id } });
      return;
    }
    campaign.value = response.campaign;
    if (response.campaign.status !== "scheduled") {
      results.value = (await api.get<{ results: CampaignResults }>(
        `/email/campaigns/${encodeURIComponent(response.campaign.id)}/results`,
      )).results;
    }
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't open this campaign.");
  } finally {
    loading.value = false;
  }
}

async function copyCampaign(kind: "again" | "duplicate") {
  if (!campaign.value || copying.value) return;
  copying.value = kind;
  try {
    const response = await api.post<{ campaign: { id: string } }>(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}/duplicate`,
      { onlyNewSubscribers: kind === "again" },
    );
    await router.push({ path: "/email/campaigns/create", query: { campaign: response.campaign.id } });
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't copy this campaign.");
  } finally {
    copying.value = null;
  }
}

function replyFrom(from: string) {
  return from.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || from;
}

function replyDate(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "" : formatCampaignDate(date.toISOString());
}

onMounted(() => void load());
</script>

<template>
  <main class="campaign-page">
    <div class="campaign-column">
      <RouterLink class="campaign-back" to="/email/campaigns">← Campaigns</RouterLink>
      <PageLoading v-if="loading" label="Loading campaign…" />
      <section v-else-if="!campaign" class="campaign-missing">
        <h1>This campaign couldn't be opened</h1>
        <p>It may have been deleted.</p>
      </section>
      <template v-else>
        <header class="campaign-header">
          <div>
            <h1>{{ campaignTitle(campaign.revision) }}</h1>
            <p>{{ when }}</p>
            <p v-if="approvalLine" class="campaign-header__approval">{{ approvalLine }}</p>
          </div>
          <span class="campaign-pill" :class="`campaign-pill--${campaignStatusTone(campaign.status)}`">
            {{ campaignStatusLabel(campaign.status) }}
          </span>
        </header>

        <dl v-if="stats.length" class="campaign-stats">
          <div v-for="stat in stats" :key="stat.label">
            <dt>{{ stat.label }}</dt>
            <dd>{{ formatCount(stat.value) }}</dd>
          </div>
        </dl>

        <ul v-if="resultNotes.length" class="campaign-notes">
          <li v-for="note in resultNotes" :key="note">{{ note }}</li>
        </ul>

        <section v-if="results?.replyMessages.length" class="campaign-replies" aria-labelledby="campaign-replies-title">
          <h2 id="campaign-replies-title">Replies</h2>
          <ul>
            <li v-for="reply in results.replyMessages" :key="reply.messageId">
              <RouterLink :to="{ path: '/email', query: { message: reply.messageId } }">
                <span class="campaign-replies__from">{{ replyFrom(reply.from) }}</span>
                <span class="campaign-replies__date">{{ replyDate(reply.receivedAt) }}</span>
              </RouterLink>
            </li>
          </ul>
          <p v-if="results.replies > results.replyMessages.length" class="campaign-replies__more">
            And {{ formatCount(results.replies - results.replyMessages.length) }} more in your Inbox.
          </p>
        </section>

        <div v-if="summary" class="campaign-actions">
          <Button
            v-if="canSendAgain"
            color="primary"
            shape="pill"
            size="compact"
            :disabled="Boolean(copying)"
            @click="copyCampaign('again')"
          >{{ copying === "again" ? "Copying…" : "Send to new subscribers" }}</Button>
          <Button
            color="secondary"
            shape="pill"
            size="compact"
            :disabled="Boolean(copying)"
            @click="copyCampaign('duplicate')"
          >{{ copying === "duplicate" ? "Copying…" : "Duplicate" }}</Button>
          <Button
            v-if="canCancelCampaign(campaign.status)"
            color="outline"
            shape="soft"
            size="compact"
            :disabled="actions.isBusy(campaign.id)"
            @click="actions.askCancel(summary)"
          >Cancel campaign</Button>
          <Button
            v-else-if="canDeleteCampaign(campaign.status) || campaign.status === 'sent'"
            class="campaign-actions__delete"
            color="ghost"
            shape="soft"
            size="compact"
            :disabled="actions.isBusy(campaign.id)"
            @click="actions.askDelete(summary)"
          >Delete campaign</Button>
        </div>

        <CampaignEmailPreview
          class="campaign-preview"
          :subject="campaign.revision.subject"
          :sender-name="campaign.revision.document.brand?.name || ''"
          :from-address="campaign.sender?.fromAddress || ''"
          :reply-to-address="campaign.revision.replyToAddress || ''"
          :to-label="`@${campaign.siteUsername} subscribers`"
          :html="campaign.revision.renderedHtml || ''"
        />
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
.campaign-page { min-height: calc(100dvh - var(--app-topbar-height)); background: var(--ui-bg); color: var(--ui-text); }
.campaign-column { box-sizing: border-box; width: min(100%, 560px); margin: 0 auto; padding: 8px 16px 96px; }
.campaign-back { display: inline-flex; min-height: 32px; align-items: center; color: var(--ui-text-muted); font-size: 14px; text-decoration: none; }
.campaign-back:hover { color: var(--ui-text); }
.campaign-back:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 6px; }
.campaign-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-top: 8px; }
.campaign-header h1 { margin: 0; font-size: 22px; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
.campaign-header p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 14px; }
.campaign-header .campaign-header__approval { margin-top: 2px; font-size: 13px; }
.campaign-pill { --tone: var(--ui-text-muted); flex: 0 0 auto; margin-top: 4px; padding: 2px 8px; border-radius: 999px; background: var(--ui-surface-muted); color: var(--tone); font-size: 12px; font-weight: 600; white-space: nowrap; }
.campaign-pill--ok { --tone: var(--ui-success, color-mix(in oklab, #1f8a5b 70%, var(--ui-text))); }
.campaign-pill--go { --tone: var(--ui-accent-strong, var(--ui-accent)); }
.campaign-pill--bad { --tone: var(--ui-danger, color-mix(in oklab, #c62828 75%, var(--ui-text))); }
.campaign-pill:not(.campaign-pill--muted) { background: color-mix(in srgb, var(--tone) 13%, transparent); }
.campaign-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 18px 0 0; }
.campaign-notes { margin: 10px 0 0; padding: 0; list-style: none; color: var(--ui-text-muted); font-size: 13px; }
.campaign-notes li + li { margin-top: 2px; }
.campaign-replies { margin-top: 18px; }
.campaign-replies h2 { margin: 0 0 4px; color: var(--ui-text-muted); font-size: 12px; font-weight: 600; }
.campaign-replies ul { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--ui-border); }
.campaign-replies li { border-bottom: 1px solid var(--ui-border); }
.campaign-replies a { display: flex; justify-content: space-between; gap: 12px; padding: 9px 2px; color: var(--ui-text); font-size: 14px; text-decoration: none; }
.campaign-replies a:hover .campaign-replies__from { text-decoration: underline; }
.campaign-replies a:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 6px; }
.campaign-replies__from { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.campaign-replies__date { flex: 0 0 auto; color: var(--ui-text-muted); font-size: 13px; }
.campaign-replies__more { margin: 6px 0 0; color: var(--ui-text-muted); font-size: 13px; }
@media (max-width: 480px) { .campaign-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.campaign-stats div { display: flex; flex-direction: column-reverse; min-width: 0; padding: 10px 12px; border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.campaign-stats dt { color: var(--ui-text-muted); font-size: 12px; }
.campaign-stats dd { margin: 0; font-size: 19px; font-weight: 650; font-variant-numeric: tabular-nums; }
.campaign-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.campaign-actions :deep(.campaign-actions__delete) { color: var(--ui-danger, color-mix(in oklab, #c62828 75%, var(--ui-text))); }
.campaign-preview { margin-top: 20px; }
.campaign-missing h1 { margin: 24px 0 0; font-size: 20px; }
.campaign-missing p { margin: 6px 0 0; color: var(--ui-text-muted); }
</style>

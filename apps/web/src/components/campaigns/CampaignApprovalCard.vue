<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { ApiError, api } from "../../api";
import Button from "../Button.vue";
import { useAppToast } from "../../composables/useAppToast";
import { formatCount } from "../../utils/campaigns";
import { zonedLocalToUtc } from "../../utils/zonedTime";

/**
 * The one place a campaign is approved. The button says exactly what happens, and the server
 * records the approval for this revision and count, so any later edit needs a new one.
 */
const props = defineProps<{
  campaignId: string;
  revisionId: string;
  recipientCount: number | null;
  audienceLine: string;
  leftOut?: string;
  senderReady: boolean;
  mailingAddressMissing?: boolean;
  sendsLeft?: number | null;
  timeZone: string;
  testing?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  test: [];
  sent: [];
  stale: [];
}>();

const { toastError, toastFromUnknown } = useAppToast();
const mode = ref<"now" | "later">("now");
const localTime = ref("");
const sending = ref(false);
const titleId = `campaign-approval-${useId()}`;

const scheduledFor = computed(() => {
  if (mode.value !== "later" || !localTime.value) return null;
  return zonedLocalToUtc(localTime.value, props.timeZone);
});
const count = computed(() => props.recipientCount || 0);
const blocker = computed(() => {
  if (!props.senderReady) return "Sending isn't set up yet, so this stays a draft.";
  if (props.mailingAddressMissing) return "Add a mailing address in From before sending.";
  if (!count.value) return "Nobody on this list can be emailed yet.";
  if (props.sendsLeft !== null && props.sendsLeft !== undefined && count.value > props.sendsLeft) {
    return `This needs ${formatCount(count.value)} sends and ${formatCount(props.sendsLeft)} are left this month.`;
  }
  if (mode.value === "later" && !localTime.value) return "Choose when it should go.";
  if (scheduledFor.value && Date.parse(scheduledFor.value) <= Date.now()) return "Choose a time in the future.";
  return "";
});
const whenLabel = computed(() => {
  if (!scheduledFor.value) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: props.timeZone,
  }).format(new Date(scheduledFor.value));
});
const actionLabel = computed(() => {
  if (sending.value) return mode.value === "later" ? "Scheduling…" : "Sending…";
  if (mode.value === "later") return whenLabel.value ? `Schedule for ${whenLabel.value}` : "Schedule";
  return `Send to ${formatCount(count.value)} ${count.value === 1 ? "person" : "people"}`;
});
const sendsLine = computed(() => {
  if (props.sendsLeft === null || props.sendsLeft === undefined) return "";
  return `Uses ${formatCount(count.value)} of ${formatCount(props.sendsLeft)} sends left`;
});

async function approve() {
  if (sending.value || blocker.value) return;
  sending.value = true;
  try {
    await api.post(`/email/campaigns/${encodeURIComponent(props.campaignId)}/send`, {
      revisionId: props.revisionId,
      recipientCount: count.value,
      scheduledFor: scheduledFor.value,
    });
    emit("sent");
  } catch (caught) {
    if (caught instanceof ApiError && ["campaign_changed", "audience_changed"].includes(String(caught.code))) {
      toastError(caught.message);
      emit("stale");
      return;
    }
    toastFromUnknown(caught, "Couldn't send this campaign.");
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <section class="campaign-approval" :aria-labelledby="titleId">
    <div class="campaign-approval__head">
      <h2 :id="titleId">Ready to send</h2>
      <span class="campaign-approval__pill">Needs your OK</span>
    </div>
    <dl class="campaign-approval__grid">
      <dt>To</dt>
      <dd>
        {{ audienceLine }}
        <span v-if="leftOut" class="campaign-approval__muted">{{ leftOut }}</span>
      </dd>
      <dt>When</dt>
      <dd>
        <div class="campaign-approval__seg" role="radiogroup" aria-label="When to send">
          <button type="button" role="radio" :aria-checked="mode === 'now'" @click="mode = 'now'">Now</button>
          <button type="button" role="radio" :aria-checked="mode === 'later'" @click="mode = 'later'">Later</button>
        </div>
        <label v-if="mode === 'later'" class="campaign-approval__time">
          <input v-model="localTime" type="datetime-local" aria-label="Send time" />
          <span class="campaign-approval__muted">{{ timeZone.replace(/_/g, " ") }} time</span>
        </label>
      </dd>
      <template v-if="sendsLine">
        <dt>Sends</dt>
        <dd>{{ sendsLine }}</dd>
      </template>
    </dl>
    <p v-if="blocker" class="campaign-approval__blocker" role="status">{{ blocker }}</p>
    <div class="campaign-approval__actions">
      <Button color="ghost" shape="soft" size="compact" :disabled="testing || !senderReady" @click="emit('test')">
        {{ testing ? "Sending test…" : "Send test" }}
      </Button>
      <span class="campaign-approval__spacer" />
      <Button color="secondary" shape="pill" size="compact" :disabled="sending" @click="emit('edit')">Edit</Button>
      <Button color="primary" shape="pill" size="compact" :disabled="sending || Boolean(blocker)" @click="approve">
        {{ actionLabel }}
      </Button>
    </div>
  </section>
</template>

<style scoped>
.campaign-approval { padding: 14px 16px; border-radius: var(--ui-radius-lg); background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.campaign-approval__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.campaign-approval__head h2 { margin: 0; font-size: 15px; font-weight: 600; }
.campaign-approval__pill { --tone: var(--ui-warning, color-mix(in oklab, #b26a00 70%, var(--ui-text))); padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--tone) 13%, transparent); color: var(--tone); font-size: 12px; font-weight: 600; white-space: nowrap; }
.campaign-approval__grid { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px 10px; margin: 12px 0 0; font-size: 14px; }
.campaign-approval__grid dt { color: var(--ui-text-muted); }
.campaign-approval__grid dd { display: grid; gap: 4px; margin: 0; min-width: 0; }
.campaign-approval__muted { color: var(--ui-text-muted); font-size: 13px; }
.campaign-approval__seg { display: inline-flex; width: fit-content; gap: 2px; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.campaign-approval__seg button { min-height: 30px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text-muted); font: 500 13px var(--font-sans); cursor: pointer; }
.campaign-approval__seg button[aria-checked="true"] { background: var(--ui-primary); color: var(--ui-primary-contrast); font-weight: 600; }
.campaign-approval__seg button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.campaign-approval__time { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 4px; }
.campaign-approval__time input { min-height: 36px; padding: 4px 8px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-bg); color: var(--ui-text); font: inherit; }
.campaign-approval__blocker { margin: 10px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.campaign-approval__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
.campaign-approval__spacer { flex: 1; }
@media (max-width: 480px) {
  .campaign-approval__spacer { display: none; }
  .campaign-approval__actions :deep(.me3-btn--primary), .campaign-approval__actions :deep(.me3-btn:last-child) { flex: 1 1 100%; }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useWizardStore } from "../../stores/wizard";
import { api } from "../../api";
import UiIcon from "../UiIcon.vue";
import type {
  AgentJob,
  RelationshipScheduleFrequency,
} from "../../types/agent-jobs";
import {
  getTimeZoneDisplayLabel,
  getTimeZoneShortName,
} from "../../utils/timezone";

const props = defineProps<{
  jobId: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "job-updated", job: AgentJob): void;
}>();

const auth = useAuthStore();
const wizard = useWizardStore();

type JobRun = {
  id: string;
  jobType: string;
  status: "success" | "failed";
  startedAt: string;
  completedAt: string | null;
  outputPreview: string | null;
  deliveryStatus: string | null;
  errorMessage: string | null;
};

const loading = ref(false);
const error = ref("");
const job = ref<AgentJob | null>(null);
const toggling = ref(false);
const triggering = ref(false);
const triggerMessage = ref("");
const runs = ref<JobRun[]>([]);
const runsLoading = ref(false);
const savingSchedule = ref(false);

type ClientDiscoveryConfigPayload = {
  frequency: RelationshipScheduleFrequency;
  searchProvider: "brave" | "serper";
  targetNiches: string[];
  targetLocations: string[];
  idealClientSignals: string[];
  excludeSignals: string[];
  fitThreshold: number;
  maxProspectsPerScan: number;
  minProspectThreshold: number;
  maxTotalProspects: number;
  offerServiceId: string | null;
  offerPageUrl: string | null;
  discoverySources: string[];
};

/** Must match `DEFAULT_CLIENT_DISCOVERY_CONFIG` in worker `outreach/config.ts`. */
const DISCOVERY_PAYLOAD_DEFAULTS = {
  searchProvider: "brave" as const,
  fitThreshold: 6,
  maxProspectsPerScan: 6,
  minProspectThreshold: 10,
  maxTotalProspects: 100,
};

type OfferOption = {
  id: string;
  title: string;
  description: string | null;
};

type OutreachSampleFormRow = {
  id: string | null;
  label: string;
  channel: "email" | "linkedin" | "instagram" | "x" | "general";
  content: string;
};

type JobModalView = "overview" | "history";

const jobModalView = ref<JobModalView>("overview");
const discoveryPanelLoading = ref(false);
const discoveryPanelSaving = ref(false);
const discoveryPanelError = ref("");
const discoveryPanelNotice = ref("");
const availableOffers = ref<OfferOption[]>([]);
/** Server: derived from published me.json briefing (R2). */
const offerClarityReadyServer = ref(false);

/** Same bar as Wizard Offer clarity: audience + problem + solution in local wizard state. */
const offerClarityReadyLocal = computed(() => {
  const b = wizard.profile?.business;
  if (!b) return false;
  return Boolean(
    String(b.audience ?? "").trim() &&
      String(b.primaryProblem ?? "").trim() &&
      String(b.solution ?? "").trim(),
  );
});

const showOfferClarityRequiredAlert = computed(
  () => !offerClarityReadyLocal.value && !offerClarityReadyServer.value,
);

const showOfferClarityPublishHint = computed(
  () => offerClarityReadyLocal.value && !offerClarityReadyServer.value,
);

const discoveryForm = ref({
  frequency: "weekly" as RelationshipScheduleFrequency,
  targetNiches: "",
  targetLocations: "",
  idealClientSignals: "",
  excludeSignals: "",
  offerServiceId: "",
  offerPageUrl: "",
  discoverySources: "",
});

const sampleRows = ref<OutreachSampleFormRow[]>([
  { id: null, label: "Email tone", channel: "email", content: "" },
  { id: null, label: "LinkedIn DM tone", channel: "linkedin", content: "" },
  { id: null, label: "General tone", channel: "general", content: "" },
]);

const samplePlaceholders: Record<string, string> = {
  email:
    "Hello,\n\nI prefer clear, direct email. Please keep replies brief, practical, and friendly. Avoid over-promising, and ask a follow-up question when context is missing.\n\nThanks.",
  linkedin:
    "I write in a conversational professional voice. I like specific examples, plain language, and useful takeaways. Please avoid hype and generic business cliches.",
  general:
    "Use a warm, grounded tone. Prefer short sentences, concrete details, and a calm pace. Sound like a thoughtful person, not a press release.",
};

const editHour = ref(7);
const editDayOfWeek = ref(1);
const scheduleTimeZone = computed(() => auth.user?.timezone || "UTC");

const canEditScheduleTime = computed(
  () =>
    job.value?.jobType === "daily_briefing" ||
    job.value?.jobType === "weekly_review",
);

const bookingRemindersEnabled = computed({
  get: () => wizard.profile.booking.reminders.enabled,
  set: (val: boolean) =>
    wizard.setBooking({
      reminders: { ...wizard.profile.booking.reminders, enabled: val },
    }),
});

const bookingReminder24h = computed({
  get: () => wizard.profile.booking.reminders.reminder24h,
  set: (val: boolean) =>
    wizard.setBooking({
      reminders: { ...wizard.profile.booking.reminders, reminder24h: val },
    }),
});

const bookingReminder2h = computed({
  get: () => wizard.profile.booking.reminders.reminder2h,
  set: (val: boolean) =>
    wizard.setBooking({
      reminders: { ...wizard.profile.booking.reminders, reminder2h: val },
    }),
});

const scheduleHasChanges = computed(() => {
  if (!job.value || !canEditScheduleTime.value) return false;
  if (job.value.jobType === "daily_briefing") {
    return editHour.value !== (job.value.scheduleHour ?? 7);
  }
  if (job.value.jobType === "weekly_review") {
    return (
      editHour.value !== (job.value.scheduleHour ?? 8) ||
      editDayOfWeek.value !== (job.value.scheduleDayOfWeek ?? 1)
    );
  }
  return false;
});

function syncEditFields() {
  if (!job.value) return;
  if (job.value.jobType === "daily_briefing") {
    editHour.value = job.value.scheduleHour ?? 7;
  } else if (job.value.jobType === "weekly_review") {
    editHour.value = job.value.scheduleHour ?? 8;
    editDayOfWeek.value = job.value.scheduleDayOfWeek ?? 1;
  }
}

async function saveSchedule() {
  if (!job.value || savingSchedule.value || !scheduleHasChanges.value) return;
  savingSchedule.value = true;
  try {
    const payload: Record<string, unknown> = { enabled: job.value.enabled };
    if (job.value.jobType === "daily_briefing") {
      payload.scheduleHour = editHour.value;
    } else if (job.value.jobType === "weekly_review") {
      payload.scheduleHour = editHour.value;
      payload.scheduleDayOfWeek = editDayOfWeek.value;
    }
    const data = await api.put<{ job: AgentJob }>(
      `/agent/jobs/${job.value.id}`,
      payload,
    );
    job.value = data.job;
    syncEditFields();
    emit("job-updated", data.job);
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to update schedule";
  } finally {
    savingSchedule.value = false;
  }
}

const JOB_DESCRIPTIONS: Record<string, string> = {
  daily_briefing:
    "Delivers a short summary every morning with key stats, recent emails handled, and today's upcoming bookings. Sent via Soulink (primary) or email.",
  weekly_review:
    "A digest of the past 7 days — bookings completed, emails handled, site activity, and notable events. Delivered weekly at your chosen time.",
  booking_reminders:
    "Sends booking reminders to you and your guest 24 hours and 2 hours before confirmed site bookings. Email is the default; Telegram/Soulink owner reminders are added when connected.",
  invoice_triage:
    "Scans inbound mailbox messages for invoice and receipt emails, then files likely expenses into Accounts. Lower-confidence matches are marked for review.",
  relationship_scan:
    "Scans public conversations related to your work, drafts value-first responses, and resurfaces dormant relationships worth reactivating.",
  client_discovery:
    "Searches for businesses that match your niches, locations, and fit signals, then adds strong matches as prospects for outreach.",
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

const JOB_SCHEDULES_STATIC: Record<string, string> = {
  booking_reminders: "24 hours and 2 hours before a confirmed site booking",
  invoice_triage: "Every 6 hours",
  relationship_scan: "Weekly by default",
  client_discovery: "Weekly by default",
};

const JOB_CHANNELS: Record<string, string> = {
  daily_briefing: "Soulink, Email",
  weekly_review: "Soulink, Email",
  booking_reminders: "Email; Telegram/Soulink if connected",
  invoice_triage: "Accounts ledger",
  relationship_scan: "Relationship Builder",
  client_discovery: "Contacts (Prospects)",
};

const description = computed(() =>
  job.value ? JOB_DESCRIPTIONS[job.value.jobType] || "Custom job" : "",
);

const schedule = computed(() => {
  if (!job.value) return "";
  const shortTimeZone = getTimeZoneShortName(scheduleTimeZone.value);
  if (job.value.jobType === "daily_briefing") {
    const hour = job.value.scheduleHour ?? 7;
    return `Every day at ${formatHour(hour)} ${shortTimeZone}`;
  }
  if (job.value.jobType === "weekly_review") {
    const day = job.value.scheduleDayOfWeek ?? 1;
    const hour = job.value.scheduleHour ?? 8;
    return `Every ${DAY_NAMES[day]} at ${formatHour(hour)} ${shortTimeZone}`;
  }
  if (job.value.jobType === "client_discovery") {
    const f = job.value.scheduleFrequency || "weekly";
    if (f === "daily") return "Every day";
    if (f === "biweekly") return "Every two weeks";
    return "Every week";
  }
  return JOB_SCHEDULES_STATIC[job.value.jobType] || "Custom schedule";
});

const channels = computed(() =>
  job.value ? JOB_CHANNELS[job.value.jobType] || "—" : "",
);

const clientDiscoveryRunBlocked = computed(
  () =>
    job.value?.jobType === "client_discovery" &&
    !offerClarityReadyServer.value,
);

const clientDiscoveryEnableBlocked = computed(
  () =>
    job.value?.jobType === "client_discovery" &&
    !offerClarityReadyServer.value &&
    !job.value?.enabled,
);

const headerTitle = computed(() => {
  if (job.value) return job.value.name;
  if (loading.value) return "Loading…";
  return "Job";
});

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDiscoveryDeliveryStatus(value: string | null): string {
  if (!value) return "—";
  const labels: Record<string, string> = {
    stored: "Stored",
    no_matches: "No matches",
    threshold_skip: "Threshold skip",
    cap_reached: "Cap reached",
    no_queries: "No queries",
    no_niches: "No niches",
    missing_job: "Missing job",
    error: "Error",
  };
  return labels[value] || value.replace(/_/g, " ");
}

function listToTextarea(values: string[]): string {
  return values.join("\n");
}

function textareaToList(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function applyConfigToDiscoveryForm(
  config: ClientDiscoveryConfigPayload,
  offers: OfferOption[],
) {
  availableOffers.value = offers;
  discoveryForm.value = {
    frequency: config.frequency,
    targetNiches: listToTextarea(config.targetNiches),
    targetLocations: listToTextarea(config.targetLocations),
    idealClientSignals: listToTextarea(config.idealClientSignals),
    excludeSignals: listToTextarea(config.excludeSignals),
    offerServiceId: config.offerServiceId || "",
    offerPageUrl: config.offerPageUrl || "",
    discoverySources: listToTextarea(config.discoverySources),
  };
}

function buildDiscoveryConfigPayload(): ClientDiscoveryConfigPayload & {
  enabled: boolean;
} {
  if (!job.value) {
    throw new Error("Job not loaded");
  }
  return {
    enabled: job.value.enabled,
    frequency: discoveryForm.value.frequency,
    ...DISCOVERY_PAYLOAD_DEFAULTS,
    targetNiches: textareaToList(discoveryForm.value.targetNiches),
    targetLocations: textareaToList(discoveryForm.value.targetLocations),
    idealClientSignals: textareaToList(discoveryForm.value.idealClientSignals),
    excludeSignals: textareaToList(discoveryForm.value.excludeSignals),
    offerServiceId: discoveryForm.value.offerServiceId.trim() || null,
    offerPageUrl: discoveryForm.value.offerPageUrl.trim() || null,
    discoverySources: textareaToList(discoveryForm.value.discoverySources),
  };
}

function resetDiscoveryPanel() {
  discoveryPanelError.value = "";
  discoveryPanelNotice.value = "";
  offerClarityReadyServer.value = false;
  jobModalView.value = "overview";
}

async function loadClientDiscoveryPanel() {
  if (!job.value || job.value.jobType !== "client_discovery") return;
  discoveryPanelLoading.value = true;
  discoveryPanelError.value = "";
  try {
    const [configResponse, samplesResponse] = await Promise.all([
      api.get<{
        config: ClientDiscoveryConfigPayload;
        offers: OfferOption[];
        offerClarityReady?: boolean;
      }>("/client-discovery/config"),
      api.get<{
        samples: Array<{
          id: string;
          label: string | null;
          channel: "email" | "linkedin" | "instagram" | "x" | "general" | null;
          content: string;
        }>;
      }>("/outreach/samples"),
    ]);

    applyConfigToDiscoveryForm(configResponse.config, configResponse.offers);
    offerClarityReadyServer.value = configResponse.offerClarityReady === true;

    const nextRows: OutreachSampleFormRow[] = [
      { id: null, label: "Email tone", channel: "email", content: "" },
      { id: null, label: "LinkedIn DM tone", channel: "linkedin", content: "" },
      { id: null, label: "General tone", channel: "general", content: "" },
    ];
    for (let index = 0; index < nextRows.length; index += 1) {
      const sample = samplesResponse.samples[index];
      if (!sample) continue;
      nextRows[index] = {
        id: sample.id,
        label: sample.label || nextRows[index].label,
        channel: sample.channel || nextRows[index].channel,
        content: sample.content,
      };
    }
    sampleRows.value = nextRows;
  } catch (err) {
    discoveryPanelError.value =
      err instanceof Error ? err.message : "Failed to load discovery settings";
  } finally {
    discoveryPanelLoading.value = false;
  }
}

async function saveClientDiscoveryPanel() {
  if (!job.value || job.value.jobType !== "client_discovery") return;
  discoveryPanelSaving.value = true;
  discoveryPanelError.value = "";
  discoveryPanelNotice.value = "";
  try {
    await api.put("/client-discovery/config", buildDiscoveryConfigPayload());

    for (const row of sampleRows.value) {
      const content = row.content.trim();
      const payload = {
        label: row.label.trim() || null,
        channel: row.channel,
        content,
      };

      if (row.id && !content) {
        await api.delete(`/outreach/samples/${row.id}`);
        row.id = null;
        continue;
      }

      if (!content) continue;

      if (row.id) {
        await api.put(`/outreach/samples/${row.id}`, payload);
      } else {
        const response = await api.post<{
          ok: boolean;
          sample: { id: string };
        }>("/outreach/samples", payload);
        row.id = response.sample.id;
      }
    }

    discoveryPanelNotice.value = "Settings saved.";
    const data = await api.get<{ job: AgentJob }>(`/agent/jobs/${props.jobId}`);
    job.value = data.job;
    emit("job-updated", data.job);
  } catch (err) {
    discoveryPanelError.value =
      err instanceof Error ? err.message : "Failed to save discovery settings";
  } finally {
    discoveryPanelSaving.value = false;
  }
}

async function loadJob() {
  loading.value = true;
  error.value = "";
  job.value = null;
  runs.value = [];
  resetDiscoveryPanel();
  try {
    const data = await api.get<{ job: AgentJob }>(`/agent/jobs/${props.jobId}`);
    job.value = data.job;
    syncEditFields();
    await loadRuns();
    if (data.job.jobType === "client_discovery") {
      await loadClientDiscoveryPanel();
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load job";
  } finally {
    loading.value = false;
  }
}

async function triggerJob() {
  if (!job.value || triggering.value) return;
  triggering.value = true;
  triggerMessage.value = "";
  try {
    await api.post(`/agent/jobs/${job.value.id}/trigger`, {});
    triggerMessage.value =
      job.value.jobType === "relationship_scan"
        ? "Triggered — new suggestions should appear in Relationship Builder shortly."
        : job.value.jobType === "client_discovery"
          ? "Triggered — check the Prospects tab for new leads and the Scan history tab here for the run summary."
          : "Triggered — check Soulink or your email.";
    setTimeout(async () => {
      await loadJob();
    }, 3000);
  } catch (err) {
    triggerMessage.value =
      err instanceof Error ? err.message : "Trigger failed";
  } finally {
    triggering.value = false;
  }
}

async function loadRuns() {
  if (!job.value) return;
  runsLoading.value = true;
  try {
    const data = await api.get<{ runs: JobRun[] }>(
      `/agent/jobs/${job.value.id}/runs?limit=20`,
    );
    runs.value = data.runs;
  } catch {
    /* non-fatal */
  } finally {
    runsLoading.value = false;
  }
}

async function toggleJob() {
  if (!job.value || toggling.value) return;
  toggling.value = true;
  try {
    const data = await api.put<{ job: AgentJob }>(
      `/agent/jobs/${job.value.id}`,
      { enabled: !job.value.enabled },
    );
    job.value = data.job;
    emit("job-updated", data.job);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update job";
  } finally {
    toggling.value = false;
  }
}

watch(
  () => props.jobId,
  (id) => {
    if (id) void loadJob();
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="job-detail-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="job-detail-modal-title"
    @click.self="emit('close')"
  >
    <div class="job-detail-modal">
      <div class="job-detail-modal__header">
        <h2 id="job-detail-modal-title" class="job-detail-modal__title">
          Assistant job: {{ headerTitle }}
        </h2>
        <div class="job-detail-modal__header-right">
          <div
            v-if="job && !loading && !error"
            class="job-detail-modal__toolbar"
            role="toolbar"
            aria-label="Job actions"
          >
            <button
              type="button"
              class="toolbar-tab"
              :class="{ 'toolbar-tab--active': jobModalView === 'history' }"
              role="tab"
              :aria-selected="jobModalView === 'history'"
              @click="jobModalView = 'history'"
            >
              Execution history
            </button>
            <button
              v-if="job.enabled"
              type="button"
              class="toolbar-btn"
              :disabled="triggering || clientDiscoveryRunBlocked"
              :title="
                clientDiscoveryRunBlocked
                  ? 'Publish your site so Offer clarity is synced, or complete it in the editor'
                  : undefined
              "
              @click="triggerJob"
            >
              {{ triggering ? "Running…" : "Run now" }}
            </button>
            <button
              type="button"
              class="toggle-btn"
              :class="{ 'toggle-btn--on': job.enabled }"
              :disabled="toggling || clientDiscoveryEnableBlocked"
              :title="
                clientDiscoveryEnableBlocked
                  ? 'Publish your site so Offer clarity is synced before enabling'
                  : undefined
              "
              :aria-label="job.enabled ? 'Disable job' : 'Enable job'"
              @click="toggleJob"
            >
              <span class="toggle-label">{{
                job.enabled ? "Active" : "Paused"
              }}</span>
              <span class="toggle-track">
                <span class="toggle-thumb" />
              </span>
            </button>
          </div>
          <button
            type="button"
            class="job-detail-modal__close"
            aria-label="Close"
            @click="emit('close')"
          >
            ×
          </button>
        </div>
      </div>

      <div class="job-detail-modal__body">
        <div v-if="loading" class="state-card">Loading job…</div>
        <div v-else-if="error" class="state-card state-card--error">
          {{ error }}
        </div>

        <template v-else-if="job">
          <p
            v-if="jobModalView === 'overview' && triggerMessage"
            class="trigger-message"
          >
            {{ triggerMessage }}
          </p>

          <section
            v-if="jobModalView === 'overview'"
            class="detail-panel detail-panel--compact"
            :class="{
              'detail-panel--discovery': job.jobType === 'client_discovery',
            }"
            aria-label="Job details"
          >
            <p class="detail-description detail-description--compact">
              {{ description }}
            </p>

            <div
              v-if="job.jobType === 'booking_reminders'"
              class="booking-reminders-settings"
            >
              <div class="booking-reminders-settings__header">
                <label class="booking-reminders-settings__label">
                  Reminder settings
                </label>
                <p class="booking-reminders-settings__note">
                  These settings stay with your booking setup so reminder
                  behavior and the assistant job stay in sync.
                </p>
              </div>
              <label class="checkbox-row booking-reminders-settings__row">
                <input v-model="bookingRemindersEnabled" type="checkbox" />
                <span class="checkbox-label">Enable booking reminders</span>
              </label>
              <label class="checkbox-row booking-reminders-settings__row">
                <input
                  v-model="bookingReminder24h"
                  type="checkbox"
                  :disabled="!bookingRemindersEnabled"
                />
                <span class="checkbox-label">Send a reminder 24 hours before</span>
              </label>
              <label class="checkbox-row booking-reminders-settings__row">
                <input
                  v-model="bookingReminder2h"
                  type="checkbox"
                  :disabled="!bookingRemindersEnabled"
                />
                <span class="checkbox-label">Send a reminder 2 hours before</span>
              </label>
              <p class="booking-reminders-settings__hint">
                Changes here update your published booking settings. Come back
                here anytime to adjust them.
              </p>
            </div>

            <div v-if="canEditScheduleTime" class="schedule-editor">
              <label class="schedule-field">
                <span class="schedule-label">Send time</span>
                <select v-model.number="editHour" class="schedule-select">
                  <option v-for="h in 24" :key="h - 1" :value="h - 1">
                    {{ formatHour(h - 1) }}
                  </option>
                </select>
              </label>
              <label
                v-if="job?.jobType === 'weekly_review'"
                class="schedule-field"
              >
                <span class="schedule-label">Day of week</span>
                <select v-model.number="editDayOfWeek" class="schedule-select">
                  <option
                    v-for="(name, idx) in DAY_NAMES"
                    :key="idx"
                    :value="idx"
                  >
                    {{ name }}
                  </option>
                </select>
              </label>
              <div class="schedule-timezone">
                {{ getTimeZoneDisplayLabel(scheduleTimeZone) }}
              </div>
              <button
                v-if="scheduleHasChanges"
                class="schedule-save-btn"
                :disabled="savingSchedule"
                @click="saveSchedule"
              >
                {{ savingSchedule ? "Saving…" : "Save schedule" }}
              </button>
            </div>

            <dl class="detail-grid">
              <div class="detail-grid__cell">
                <dt>Schedule</dt>
                <dd v-if="job.jobType === 'client_discovery'">
                  <template v-if="discoveryPanelLoading">…</template>
                  <label
                    v-else
                    class="detail-grid__schedule-label"
                  >
                    <select
                      v-model="discoveryForm.frequency"
                      class="detail-grid__schedule-select"
                      aria-label="Client discovery scan frequency"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                    </select>
                  </label>
                </dd>
                <dd v-else>{{ schedule }}</dd>
              </div>
              <div class="detail-grid__cell">
                <dt>Channels</dt>
                <dd>{{ channels }}</dd>
              </div>
              <div class="detail-grid__cell">
                <dt>Last run</dt>
                <dd :class="job.lastRunStatus === 'failed' ? 'run-failed' : ''">
                  {{ job.lastRunAt ? formatDate(job.lastRunAt) : "Never" }}
                  <span
                    v-if="job.lastRunStatus"
                    class="run-status-badge"
                    :class="`run-status-badge--${job.lastRunStatus}`"
                  >
                    {{ job.lastRunStatus }}
                  </span>
                </dd>
              </div>
              <div
                v-if="job.jobType === 'client_discovery'"
                class="detail-grid__cell"
              >
                <dt>Next run</dt>
                <dd>
                  {{
                    job.nextRunAt && job.enabled
                      ? formatDate(job.nextRunAt)
                      : "—"
                  }}
                </dd>
              </div>
              <div
                v-else-if="job.nextRunAt && job.enabled"
                class="detail-grid__cell"
              >
                <dt>Next run</dt>
                <dd>{{ formatDate(job.nextRunAt) }}</dd>
              </div>
            </dl>

            <div
              v-if="job.jobType === 'client_discovery'"
              class="discovery-settings-block"
            >
              <div v-if="discoveryPanelLoading" class="state-card">
                Loading settings…
              </div>

              <template v-else>
                <p v-if="discoveryPanelError" class="discovery-inline-error">
                  {{ discoveryPanelError }}
                </p>
                <p v-if="discoveryPanelNotice" class="discovery-inline-notice">
                  {{ discoveryPanelNotice }}
                </p>

                <div
                  v-if="showOfferClarityRequiredAlert"
                  class="discovery-clarity-alert"
                  role="alert"
                >
                  <strong>Offer clarity required.</strong>
                  Set your “I help … with … by …” sentence in the
                  <router-link class="discovery-clarity-link" to="/create">
                    site editor
                  </router-link>
                  under Offerings, then save. Client Discovery uses that context
                  to find prospects and judge fit.
                </div>

                <div
                  v-else-if="showOfferClarityPublishHint"
                  class="discovery-clarity-hint"
                  role="status"
                >
                  Offer clarity is saved in your editor. Publish your site so the
                  assistant can read it from me.json, then you can run discovery.
                </div>

                <div class="discovery-tab-panel discovery-settings-scroll">
                  <details class="discovery-accordion" open>
                    <summary class="discovery-accordion__summary">
                      <UiIcon
                        class="discovery-accordion__chevron"
                        name="ChevronRight"
                        :size="16"
                        aria-hidden="true"
                      />
                      <span>
                        Configure draft messages in your own voice to help speed
                        up outreach
                      </span>
                    </summary>
                    <div class="discovery-accordion__body">
                      <p class="discovery-panel-intro discovery-panel-intro--tight">
                        Sample lines teach ME3 your tone for prospect outreach.
                        Drafts use your full website as offer context.
                      </p>
                      <div class="samples-grid samples-grid--compact">
                        <article
                          v-for="(row, index) in sampleRows"
                          :key="index"
                          class="sample-card sample-card--compact"
                        >
                          <div class="sample-card__row">
                            <label>
                              <span>Label</span>
                              <input
                                v-model="row.label"
                                type="text"
                                placeholder="Email tone"
                              />
                            </label>

                            <label>
                              <span>Channel</span>
                              <select v-model="row.channel">
                                <option value="email">Email</option>
                                <option value="linkedin">LinkedIn</option>
                                <option value="instagram">Instagram</option>
                                <option value="x">X</option>
                                <option value="general">General</option>
                              </select>
                            </label>
                          </div>

                          <div class="sample-message-block">
                            <span class="sample-message-label"
                              >Sample message {{ index + 1 }}</span
                            >
                            <textarea
                              v-model="row.content"
                              rows="5"
                              class="sample-message-textarea"
                              :placeholder="
                                samplePlaceholders[row.channel] ||
                                'Paste a message you’ve actually sent so ME3 can match your tone.'
                              "
                            />
                          </div>
                        </article>
                      </div>
                    </div>
                  </details>

                  <details class="discovery-accordion">
                    <summary class="discovery-accordion__summary">
                      <UiIcon
                        class="discovery-accordion__chevron"
                        name="ChevronRight"
                        :size="16"
                        aria-hidden="true"
                      />
                      <span>Advanced discovery settings</span>
                    </summary>
                    <div class="discovery-accordion__body">
                      <p class="discovery-panel-intro discovery-panel-intro--tight">
                        Optional overrides. Leave blank to rely on prefilled
                        values from your offer clarity and me.json profile.
                      </p>

                      <div class="field-grid field-grid--compact field-grid--wide">
                        <label>
                          <span>Target niches</span>
                          <textarea
                            v-model="discoveryForm.targetNiches"
                            rows="4"
                            class="discovery-textarea"
                            placeholder="Life coach&#10;Executive coach"
                          />
                        </label>

                        <label>
                          <span>Target locations</span>
                          <textarea
                            v-model="discoveryForm.targetLocations"
                            rows="4"
                            class="discovery-textarea"
                            placeholder="Europe&#10;Dublin&#10;Remote"
                          />
                        </label>
                      </div>

                      <div class="field-grid field-grid--compact field-grid--wide">
                        <label>
                          <span>Ideal client signals</span>
                          <textarea
                            v-model="discoveryForm.idealClientSignals"
                            rows="4"
                            class="discovery-textarea"
                            placeholder="Weak website&#10;No booking flow"
                          />
                        </label>

                        <label>
                          <span>Exclude signals</span>
                          <textarea
                            v-model="discoveryForm.excludeSignals"
                            rows="4"
                            class="discovery-textarea"
                            placeholder="Large firm&#10;Enterprise consultancy"
                          />
                        </label>
                      </div>

                      <label class="discovery-field-full">
                        <span>Discovery sources</span>
                        <textarea
                          v-model="discoveryForm.discoverySources"
                          rows="4"
                          class="discovery-textarea"
                          placeholder="https://example.org/directory"
                        />
                      </label>

                      <div class="field-grid field-grid--compact field-grid--wide">
                        <label>
                          <span>Primary offer</span>
                          <select v-model="discoveryForm.offerServiceId">
                            <option value="">Use full profile context</option>
                            <option
                              v-for="offer in availableOffers"
                              :key="offer.id"
                              :value="offer.id"
                            >
                              {{ offer.title }}
                            </option>
                          </select>
                        </label>

                        <label>
                          <span>Offer page URL</span>
                          <input
                            v-model="discoveryForm.offerPageUrl"
                            type="url"
                            placeholder="https://yourdomain.com/services/offer"
                          />
                        </label>
                      </div>

                      <p v-if="availableOffers.length === 0" class="discovery-note">
                        No services on your website yet. You can still set a
                        custom offer URL.
                      </p>
                    </div>
                  </details>
                </div>

                <div class="discovery-save-row">
                  <button
                    type="button"
                    class="discovery-save-btn"
                    :disabled="discoveryPanelSaving"
                    @click="saveClientDiscoveryPanel"
                  >
                    {{ discoveryPanelSaving ? "Saving…" : "Save settings" }}
                  </button>
                </div>
              </template>
            </div>
          </section>

          <section v-else-if="jobModalView === 'history'" class="detail-panel">
            <div class="subview-bar">
              <button
                type="button"
                class="subview-back"
                @click="jobModalView = 'overview'"
              >
                ← Back to details
              </button>
              <span v-if="runsLoading" class="panel-meta">Loading…</span>
            </div>
            <p
              v-if="job.jobType === 'client_discovery'"
              class="detail-description detail-description--compact"
            >
              Recent discovery runs and summaries.
            </p>

            <template v-if="job.jobType === 'client_discovery'">
              <div v-if="runs.length === 0 && !runsLoading" class="empty-state">
                No scans yet. This job hasn’t run since it was created.
              </div>
              <div v-else-if="runs.length > 0" class="discovery-run-list">
                <article
                  v-for="run in runs"
                  :key="run.id"
                  class="discovery-run-card"
                >
                  <div class="discovery-run-card__meta">
                    <span
                      class="run-status-badge"
                      :class="`run-status-badge--${run.status}`"
                    >
                      {{ run.status }}
                    </span>
                    <span class="run-delivery">{{
                      formatDiscoveryDeliveryStatus(run.deliveryStatus)
                    }}</span>
                    <span class="discovery-run-card__time">{{
                      formatDate(run.startedAt)
                    }}</span>
                    <span
                      v-if="run.completedAt"
                      class="discovery-run-card__duration"
                    >
                      {{ formatDuration(run.startedAt, run.completedAt) }}
                    </span>
                  </div>
                  <p class="discovery-run-card__summary">
                    {{
                      run.outputPreview ||
                      run.errorMessage ||
                      "No summary was saved for this run."
                    }}
                  </p>
                </article>
              </div>
            </template>

            <template v-else>
              <div v-if="runs.length === 0 && !runsLoading" class="empty-state">
                No runs yet. This job hasn't executed since it was created.
              </div>
              <table v-else-if="runs.length > 0" class="runs-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Delivery</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="run in runs" :key="run.id">
                    <td>{{ formatDate(run.startedAt) }}</td>
                    <td>
                      <span
                        class="run-status-badge"
                        :class="`run-status-badge--${run.status}`"
                      >
                        {{ run.status }}
                      </span>
                    </td>
                    <td class="run-delivery">
                      {{ run.deliveryStatus || "—" }}
                    </td>
                    <td>
                      {{
                        run.completedAt
                          ? formatDuration(run.startedAt, run.completedAt)
                          : "—"
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.job-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 52;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.job-detail-modal {
  width: min(900px, 100%);
  max-height: min(92vh, 960px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-bg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2);
}

.job-detail-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
  padding: 16px 20px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.job-detail-modal__title {
  margin: 0;
  font-size: 18px;
  line-height: 1.25;
  flex: 1 1 200px;
  min-width: 0;
}

.job-detail-modal__header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: auto;
}

.job-detail-modal__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 8px;
  max-width: min(100%, 520px);
}

.toolbar-tab {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  white-space: nowrap;
}

.toolbar-tab--active {
  border-color: var(--color-text);
  background: var(--color-text);
  color: var(--color-bg);
}

.toolbar-btn {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.job-detail-modal__close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  padding: 4px;
}

.job-detail-modal__toolbar .toggle-btn {
  margin-left: 2px;
}

.job-detail-modal__body {
  padding: 16px 24px 24px;
  overflow-y: auto;
  display: grid;
  gap: 16px;
}

.detail-panel {
  padding: 0px;
}

.trigger-message {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.subview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.subview-back {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.subview-back:hover {
  color: var(--color-text);
}

.discovery-settings-subhead {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.discovery-settings-subhead--outreach {
  margin-top: 22px;
}

.discovery-settings-scroll {
  max-height: min(52vh, 520px);
  overflow-y: auto;
  padding-right: 4px;
}

.discovery-field-full--solo select {
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
}

.discovery-textarea {
  font-family: inherit;
  font-size: 14px;
  line-height: 1.45;
  resize: vertical;
  min-height: 96px;
  overflow-y: auto;
}

.sample-card__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.sample-card__row label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sample-card__row label > span {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.sample-card__row input,
.sample-card__row select {
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  width: 100%;
  box-sizing: border-box;
}

.sample-message-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sample-message-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.sample-message-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  resize: vertical;
  min-height: 120px;
  overflow-y: auto;
  max-height: 280px;
}

.detail-description {
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 16px;
}

.detail-description--compact {
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 12px;
}

.booking-reminders-settings {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
}

.booking-reminders-settings__header {
  margin-bottom: 10px;
}

.booking-reminders-settings__label {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
}

.booking-reminders-settings__note,
.booking-reminders-settings__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.booking-reminders-settings__hint {
  margin-top: 10px;
}

.booking-reminders-settings__row {
  margin-top: 10px;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}

.checkbox-row input {
  margin: 0;
  flex-shrink: 0;
}

.checkbox-label {
  line-height: 1.4;
}

.schedule-editor {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  flex-wrap: wrap;
}

.schedule-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.schedule-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.schedule-select {
  padding: 6px 10px;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  min-width: 120px;
}

.schedule-save-btn {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid var(--color-text);
  border-radius: 6px;
  background: var(--color-text);
  color: var(--color-bg);
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.1s ease;
}

.schedule-timezone {
  font-size: 13px;
  color: var(--color-text-muted);
  white-space: nowrap;
  align-self: center;
}

.schedule-save-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.schedule-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.detail-grid {
  display: flex;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 0;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-subtle);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.detail-grid__cell {
  flex: 1 1 0;
  min-width: 112px;
  padding: 0 10px;
  border-left: 1px solid var(--color-border);
}

.detail-grid__cell:first-child {
  border-left: none;
  padding-left: 0;
}

.detail-grid__cell:last-child {
  padding-right: 0;
}

.detail-grid dt {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0 0 2px;
}

.detail-grid dd {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.panel-meta {
  font-size: 12px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
}

.toggle-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toggle-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
}

.toggle-btn--on .toggle-label {
  color: var(--color-text);
}

.toggle-track {
  display: block;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: var(--color-border);
  position: relative;
  transition: background 0.15s ease;
}

.toggle-btn--on .toggle-track {
  background: #000;
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}

.toggle-btn--on .toggle-thumb {
  transform: translateX(18px);
}

.state-card {
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-muted);
}

.state-card--error {
  color: #b33b2e;
}

.empty-state {
  padding: 18px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-text-muted);
  background: var(--color-bg-subtle);
  font-size: 14px;
  line-height: 1.5;
}

.run-status-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.run-status-badge--success {
  background: #e6f4ea;
  color: #1a7f3c;
}

.run-status-badge--failed {
  background: #fdecea;
  color: #b33b2e;
}

.run-failed {
  color: #b33b2e;
}

.runs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.runs-table th {
  text-align: left;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}

.runs-table td {
  padding: 8px 8px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

.runs-table tbody tr:last-child td {
  border-bottom: none;
}

.run-delivery {
  color: var(--color-text-muted);
  font-size: 12px;
}

.detail-panel--discovery .detail-description {
  margin-bottom: 14px;
}

.discovery-settings-block {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}

.discovery-inline-error {
  margin: 0 0 10px;
  font-size: 14px;
  color: #b33b2e;
}

.discovery-inline-notice {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--color-text-muted);
}

.discovery-tab-panel {
  margin-bottom: 16px;
}

.discovery-panel-intro {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.discovery-panel-intro--tight {
  margin-bottom: 10px;
  font-size: 13px;
}

.discovery-clarity-alert {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text);
}

.discovery-clarity-link {
  font-weight: 600;
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.discovery-clarity-hint {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.detail-grid__schedule-label {
  display: block;
  margin: 0;
}

.detail-grid__schedule-select {
  max-width: 100%;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
}

.discovery-accordion {
  margin-top: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
}

.discovery-accordion__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.discovery-accordion__summary::-webkit-details-marker {
  display: none;
}

.discovery-accordion__chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.discovery-accordion[open] .discovery-accordion__chevron {
  transform: rotate(90deg);
}

.discovery-accordion__body {
  padding: 0 14px 14px;
  border-top: 1px solid var(--color-border);
}

.discovery-field-full {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.discovery-field-full span {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.discovery-note {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.field-grid {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.field-grid--compact label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-grid--compact label > span {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.field-grid--compact input,
.field-grid--compact select,
.field-grid--compact textarea {
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
}

.field-grid--compact textarea {
  resize: vertical;
  min-height: 72px;
  font-family: inherit;
}

.field-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.field-grid--wide {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.samples-grid--compact {
  display: grid;
  gap: 12px;
}

.sample-card--compact {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-bg-subtle);
}

.sample-card__row.field-grid {
  margin-bottom: 10px;
}

.discovery-save-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
  margin-top: 8px;
}

.discovery-save-btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 700;
  border: 1px solid var(--color-text);
  border-radius: 6px;
  background: var(--color-text);
  color: var(--color-bg);
  cursor: pointer;
}

.discovery-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.discovery-run-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.discovery-run-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--color-bg-subtle);
}

.discovery-run-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 8px;
  font-size: 12px;
}

.discovery-run-card__time {
  color: var(--color-text-muted);
  font-weight: 600;
}

.discovery-run-card__duration {
  color: var(--color-text-muted);
}

.discovery-run-card__summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre-wrap;
}

@media (max-width: 960px) {
  .job-detail-modal__header-right {
    width: 100%;
    justify-content: space-between;
  }

  .job-detail-modal__toolbar {
    justify-content: flex-start;
    max-width: none;
  }

  .job-detail-overlay {
    padding: 12px;
    align-items: flex-end;
  }

  .job-detail-modal {
    max-height: 95vh;
  }

  .field-grid--3,
  .field-grid--wide {
    grid-template-columns: 1fr;
  }
}
</style>

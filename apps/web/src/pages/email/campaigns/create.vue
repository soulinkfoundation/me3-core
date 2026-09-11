<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../../api";
import Button from "../../../components/Button.vue";
import CampaignEmailPreview from "../../../components/CampaignEmailPreview.vue";
import PageLoading from "../../../components/PageLoading.vue";
import TiptapEditor from "../../../components/TiptapEditor.vue";
import UiIcon from "../../../components/UiIcon.vue";
import { useAppToast } from "../../../composables/useAppToast";
import { useAuthStore } from "../../../stores/auth";
import { useSitesStore } from "../../../stores/sites";
import {
  campaignDocumentToEditorHtml,
  campaignEditorHtmlToBlocks,
  type CampaignDocument,
} from "../../../utils/campaignDocument";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "Create campaign | ME3",
    description: "Compose and schedule an email campaign.",
    robots: "noindex,follow",
  },
});

type Campaign = {
  id: string;
  siteId: string;
  siteUsername: string;
  name: string;
  status: string;
  audienceFilter: { kind: "all" | "customers"; itemRef?: string | null };
  revision: {
    id: string;
    subject: string;
    previewText: string;
    replyToAddress: string | null;
    document: CampaignDocument;
    rendererVersion: string | null;
    renderedHtml: string | null;
    renderedText: string | null;
  };
};
type TransportStatus = {
  managed: boolean;
  ready: boolean;
  reason: string | null;
  sender: { ref: string; fromAddress: string; domain: string } | null;
  addOn: { allowance: number; remaining: number; entitled: boolean } | null;
  instructions: string[];
};
type Review = {
  audience: {
    eligibleCount: number;
    excludedCount: number;
    exclusionCounts: Record<string, number>;
  };
  transport: TransportStatus;
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sites = useSitesStore();
const { toastError, toastFromUnknown } = useAppToast();
const remoteApiHost = import.meta.env.DEV
  ? import.meta.env.VITE_REMOTE_API_HOST || ""
  : "";
const loading = ref(true);
const loadFailed = ref(false);
const campaign = ref<Campaign | null>(null);
const transport = ref<TransportStatus | null>(null);
const review = ref<Review | null>(null);
const step = ref<1 | 2 | 3>(1);
const creating = ref(false);
const saving = ref(false);
const testing = ref(false);
const testMessage = ref("");
const sending = ref(false);
const hydrating = ref(true);
let saveTimer: number | null = null;

const selectedSiteId = ref("");
const audienceKind = ref<"all" | "customers">("all");
const audienceItem = ref("");
const audienceItems = ref<Array<{ value: string; label: string }>>([]);
const subject = ref("");
const previewText = ref("");
const replyToAddress = ref("");
const richTextHtml = ref("<p></p>");
const brand = ref<CampaignDocument["brand"]>({
  name: "ME3",
  homeUrl: "https://me3.app/",
  logoUrl: null,
  logoAlignment: "center",
  backgroundColor: "#f4f5f4",
  surfaceColor: "#ffffff",
  textColor: "#18201d",
  accentColor: "#147d64",
});
const sendMode = ref<"now" | "schedule">("now");
const scheduledLocal = ref("");

const ownerEmail = computed(() => auth.user?.email?.trim().toLowerCase() || "");
const canDraftCampaign = computed(() => Boolean(transport.value || remoteApiHost));
const canCreate = computed(() => Boolean(selectedSiteId.value && canDraftCampaign.value));
const canReview = computed(() =>
  Boolean(brand.value.name.trim() && subject.value.trim() && campaign.value),
);
const stepName = computed(() => ({
  1: "Email list",
  2: "Compose",
  3: "Review",
})[step.value]);
const excludedReasons = computed(() =>
  Object.entries(review.value?.audience.exclusionCounts || {}).filter(([, count]) => count > 0),
);
const previewFromAddress = computed(() => transport.value?.sender?.fromAddress || "");
const previewToLabel = computed(() =>
  campaign.value
    ? audienceKind.value === "customers"
      ? `@${campaign.value.siteUsername} customers`
      : `@${campaign.value.siteUsername} subscribers`
    : "Subscribers",
);
const currentRendererVersion = "me3.email-renderer.v2";

async function initialize() {
  loading.value = true;
  loadFailed.value = false;
  try {
    await sites.ensureSites();
    const transportResponse = await api.get<{ transport: TransportStatus }>(
      "/email/campaigns/transport",
    );
    transport.value = transportResponse.transport;
    const campaignId = typeof route.query.campaign === "string" ? route.query.campaign : "";
    if (campaignId) await loadCampaign(campaignId);
    else {
      selectedSiteId.value = sites.sites[0]?.id || "";
      replyToAddress.value = ownerEmail.value;
    }
  } catch (caught) {
    loadFailed.value = true;
    toastFromUnknown(caught, "Unable to open the campaign builder.");
  } finally {
    hydrating.value = false;
    loading.value = false;
  }
}

async function loadAudienceItems(siteId: string) {
  if (!siteId) {
    audienceItems.value = [];
    return;
  }
  try {
    const response = await api.get<{ items: Array<{ value: string; label: string }> }>(
      `/email/campaigns/audience-items?siteId=${encodeURIComponent(siteId)}`,
    );
    audienceItems.value = response.items || [];
  } catch {
    audienceItems.value = [];
  }
}

async function loadCampaign(campaignId: string) {
  const response = await api.get<{ campaign: Campaign }>(
    `/email/campaigns/${encodeURIComponent(campaignId)}`,
  );
  applyCampaign(response.campaign);
  step.value = 2;
  if (
    response.campaign.status === "draft" &&
    response.campaign.revision.rendererVersion !== currentRendererVersion
  ) {
    await saveDraft();
  }
}

function applyCampaign(next: Campaign) {
  hydrating.value = true;
  campaign.value = next;
  selectedSiteId.value = next.siteId;
  audienceKind.value = next.audienceFilter?.kind === "customers" ? "customers" : "all";
  audienceItem.value = next.audienceFilter?.itemRef || "";
  subject.value = next.revision.subject;
  previewText.value = next.revision.previewText;
  replyToAddress.value = next.revision.replyToAddress || ownerEmail.value;
  brand.value = {
    ...next.revision.document.brand,
    logoUrl: null,
    logoAlignment: "center",
  };
  richTextHtml.value = campaignDocumentToEditorHtml(next.revision.document);
  queueMicrotask(() => {
    hydrating.value = false;
  });
}

async function createDraft() {
  if (!canCreate.value || creating.value) return;
  creating.value = true;
  try {
    const response = await api.post<{ campaign: Campaign }>("/email/campaigns", {
      siteId: selectedSiteId.value,
      audienceFilter: { kind: audienceKind.value, itemRef: audienceItem.value || null },
    });
    applyCampaign(response.campaign);
    step.value = 2;
    await router.replace({
      path: "/email/campaigns/create",
      query: { campaign: response.campaign.id },
    });
  } catch (caught) {
    toastFromUnknown(caught, "Unable to create campaign.");
  } finally {
    creating.value = false;
  }
}

function buildDocument(): CampaignDocument {
  return {
    version: "me3.campaign-document.v1",
    brand: { ...brand.value, logoUrl: null, logoAlignment: "center" },
    blocks: campaignEditorHtmlToBlocks(richTextHtml.value),
  };
}

async function saveDraft(): Promise<boolean> {
  if (!campaign.value || campaign.value.status !== "draft") return true;
  if (saving.value) {
    await waitForCurrentSave();
    return saveDraft();
  }
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  saving.value = true;
  try {
    const response = await api.put<{ campaign: Campaign }>(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}`,
      {
        siteId: selectedSiteId.value,
        name: subject.value.trim() || campaign.value.name,
        subject: subject.value,
        previewText: previewText.value,
        replyToAddress: replyToAddress.value || null,
        audienceFilter: { kind: audienceKind.value, itemRef: audienceItem.value || null },
        document: buildDocument(),
      },
    );
    campaign.value = response.campaign;
    return true;
  } catch (caught) {
    toastFromUnknown(caught, "Unable to save campaign.");
    return false;
  } finally {
    saving.value = false;
  }
}

function waitForCurrentSave(): Promise<void> {
  if (!saving.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(saving, (active) => {
      if (active) return;
      stop();
      resolve();
    });
  });
}

function scheduleSave() {
  if (hydrating.value || !campaign.value || campaign.value.status !== "draft") return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveDraft(), 900);
}

async function continueToReview() {
  if (!brand.value.name.trim()) {
    toastError("Add a sender name before continuing.");
    return;
  }
  if (!subject.value.trim()) {
    toastError("Add a subject before continuing.");
    return;
  }
  if (!(await saveDraft()) || !campaign.value) return;
  try {
    await loadReview();
    step.value = 3;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (caught) {
    toastFromUnknown(caught, "Unable to review this campaign.");
  }
}

async function saveAndExit() {
  if (await saveDraft()) await router.push("/email/campaigns");
}

async function exitWizard() {
  if (campaign.value) await saveAndExit();
  else await router.push("/email/campaigns");
}

async function continueFromList() {
  if (!selectedSiteId.value) {
    toastError("Choose an email list before continuing.");
    return;
  }
  if (!campaign.value) {
    await createDraft();
    return;
  }
  if (await saveDraft()) step.value = 2;
}

async function goToPreviousStep(target: number) {
  if (target !== 1 && target !== 2) return;
  if (target >= step.value) return;
  if (step.value === 2 && !(await saveDraft())) return;
  step.value = target;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadReview() {
  if (!campaign.value) return;
  review.value = await api.get<Review>(
    `/email/campaigns/${encodeURIComponent(campaign.value.id)}/review`,
  );
  transport.value = review.value.transport;
}

async function sendTest() {
  if (!campaign.value || testing.value) return;
  testing.value = true;
  testMessage.value = "";
  try {
    const response = await api.post<{ test: { status: string } }>(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}/test`,
    );
    testMessage.value = response.test.status === "accepted"
      ? `Test sent to ${ownerEmail.value}.`
      : `Test status: ${response.test.status}.`;
  } catch (caught) {
    toastFromUnknown(caught, "Unable to send test.");
  } finally {
    testing.value = false;
  }
}

async function approveSend() {
  if (!campaign.value || sending.value || !review.value?.transport.ready) return;
  if (review.value.audience.eligibleCount === 0) {
    toastError("This Site has no eligible subscribers.");
    return;
  }
  if (sendMode.value === "schedule" && !scheduledLocal.value) {
    toastError("Choose a send time.");
    return;
  }
  sending.value = true;
  try {
    await api.post(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}/send`,
      {
        scheduledFor:
          sendMode.value === "schedule"
            ? new Date(scheduledLocal.value).toISOString()
            : null,
      },
    );
    await router.push("/email/campaigns");
  } catch (caught) {
    toastFromUnknown(caught, "Unable to queue campaign.");
  } finally {
    sending.value = false;
  }
}

async function uploadCampaignImage(input: {
  blob: Blob;
  filename: string;
  mimeType: string;
}) {
  if (!campaign.value) throw new Error("Create the campaign before adding an image.");
  const form = new FormData();
  form.append("file", input.blob, input.filename);
  const response = await api.upload<{
    asset: { id: string; url: string };
  }>(`/email/campaigns/${encodeURIComponent(campaign.value.id)}/assets`, form);
  return { id: response.asset.id, src: response.asset.url };
}

watch([subject, previewText, replyToAddress, richTextHtml, brand], scheduleSave, {
  deep: true,
});
watch(selectedSiteId, (siteId, previousSiteId) => {
  if (previousSiteId && previousSiteId !== siteId) audienceItem.value = "";
  void loadAudienceItems(siteId);
});

onMounted(() => void initialize());
onBeforeUnmount(() => {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
});
</script>

<template>
  <div class="campaign-wizard-page">
    <header class="wizard-header">
      <div class="header-center">
        <div class="step-indicator" aria-live="polite">
          <span class="step-current">{{ step }}</span>
          <span class="step-divider">/</span>
          <span class="step-total">3</span>
          <span class="step-name">{{ stepName }}</span>
        </div>
      </div>
      <div class="header-right">
        <button class="exit-btn" type="button" @click="exitWizard">Exit</button>
      </div>
    </header>

    <div class="progress-bar" role="navigation" aria-label="Campaign wizard progress">
      <div class="progress-track" aria-hidden="true">
        <div class="progress-fill" :style="{ width: `${((step - 1) / 2) * 100}%` }" />
      </div>
      <div class="progress-steps">
        <button
          v-for="number in [1, 2, 3]"
          :key="number"
          type="button"
          class="progress-step"
          :class="{
            'is-current': step === number,
            'is-visited': number <= step,
            'is-jumpable': number < step,
          }"
          :aria-label="number === 1 ? 'Choose email list' : number === 2 ? 'Compose campaign' : 'Review campaign'"
          :aria-current="step === number ? 'step' : undefined"
          :disabled="number > step"
          @click="goToPreviousStep(number)"
        >
          <span class="progress-step-dot" aria-hidden="true">
            <span v-if="step === number" class="progress-step-core" />
            <span v-else-if="number < step" class="progress-step-check">✓</span>
          </span>
        </button>
      </div>
    </div>

    <main class="campaign-wizard-shell">

      <PageLoading v-if="loading" label="Opening campaign builder…" />
      <section v-else-if="loadFailed" class="availability-card" aria-labelledby="campaign-builder-load-failed">
        <UiIcon name="Info" :size="22" aria-hidden="true" />
        <div>
          <h1 id="campaign-builder-load-failed">Campaign builder could not be opened</h1>
          <p>Check your connection and try again.</p>
          <Button color="primary" shape="soft" @click="initialize">Try again</Button>
        </div>
      </section>

      <template v-else>
        <section v-if="!canDraftCampaign && !campaign" class="availability-card">
          <UiIcon name="Info" :size="22" aria-hidden="true" />
          <div>
            <h1>Campaign drafting is not ready</h1>
            <p>Return to Campaigns and activate the Email Campaigns plugin first.</p>
            <Button color="outline" shape="soft" to="/email/campaigns">View campaign history</Button>
          </div>
        </section>

        <section v-else-if="step === 1" class="start-card">
          <h1>{{ campaign ? "Choose email list" : "Create Email Campaign" }}</h1>
          <label class="field">
            <span>Email list</span>
            <select v-model="selectedSiteId">
              <option disabled value="">Choose an email list</option>
              <option v-for="site in sites.sites" :key="site.id" :value="site.id">@{{ site.username }}</option>
            </select>
          </label>
          <label class="field">
            <span>Recipients</span>
            <select v-model="audienceKind">
              <option value="all">All eligible subscribers</option>
              <option value="customers">Eligible customers</option>
            </select>
            <small>A purchase alone never subscribes someone to marketing email.</small>
          </label>
          <label v-if="audienceKind === 'customers' && audienceItems.length" class="field">
            <span>Product or service</span>
            <select v-model="audienceItem">
              <option value="">All products and services</option>
              <option v-for="item in audienceItems" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <Button
            color="neutral"
            shape="soft"
            size="large"
            :disabled="campaign ? !selectedSiteId || saving : !canCreate || creating"
            @click="continueFromList"
          >
            {{ creating ? "Creating…" : campaign ? "Next" : "Start composing" }}
          </Button>
        </section>

        <template v-else-if="campaign && step === 2">
          <section class="compose-heading">
            <h1>Compose campaign</h1>
          </section>

          <div class="compose-grid">
            <section class="campaign-form">
              <div class="field-grid">
                <label class="field field--wide">
                  <span>Sender name</span>
                  <input
                    v-model="brand.name"
                    maxlength="120"
                    placeholder="The name subscribers will see"
                  />
                </label>
                <label class="field field--wide"><span>Subject</span><input v-model="subject" maxlength="200" placeholder="A useful update" /></label>
                <label class="field field--wide"><span>Preview text</span><input v-model="previewText" maxlength="240" placeholder="A short line shown beside the subject" /></label>
                <label class="field field--wide">
                  <span>Reply-to</span>
                  <input v-model="replyToAddress" type="email" :placeholder="ownerEmail" />
                  <small>Leave blank if you don’t want replies.</small>
                </label>
              </div>

              <div class="section-label">
                <span>Message</span>
              </div>
              <TiptapEditor
                v-model="richTextHtml"
                variant="campaign"
                placeholder="Write your campaign…"
                :upload-image="uploadCampaignImage"
              />
            </section>

            <aside class="compose-preview">
              <CampaignEmailPreview
                :subject="subject"
                :sender-name="brand.name"
                :from-address="previewFromAddress"
                :reply-to-address="replyToAddress"
                :to-label="previewToLabel"
                :html="campaign.revision.renderedHtml || ''"
              />
            </aside>
          </div>

          <nav class="wizard-actions" aria-label="Campaign steps">
            <Button color="secondary" shape="soft" size="large" :disabled="saving" @click="goToPreviousStep(1)">Back</Button>
            <Button color="neutral" shape="soft" size="large" :disabled="!canReview || saving" @click="continueToReview">Next</Button>
          </nav>
        </template>

        <template v-else-if="campaign">
          <div class="send-review">
            <section class="review-heading">
              <h1>Review and schedule</h1>
              <p>Check the email and audience before you send it.</p>
            </section>

            <CampaignEmailPreview
              :subject="campaign.revision.subject"
              :sender-name="brand.name"
              :from-address="previewFromAddress"
              :reply-to-address="campaign.revision.replyToAddress || ''"
              :to-label="previewToLabel"
              :html="campaign.revision.renderedHtml || ''"
            />

            <section class="review-details">
              <div v-if="review && !review.transport.ready" class="delivery-notice">
                <div>
                  <strong>Delivery is not active</strong>
                  <p>{{ review.transport.instructions[0] || "You can keep this draft. Activate or configure delivery from the Campaigns page before sending." }}</p>
                </div>
                <Button color="outline" shape="soft" size="small" to="/email/campaigns">Manage delivery</Button>
              </div>
              <div class="audience-count">
                <strong>{{ review?.audience.eligibleCount || 0 }}</strong>
                <span>
                  eligible {{ review?.audience.eligibleCount === 1 ? "subscriber" : "subscribers" }}
                  in
                  <router-link :to="`/sites/${encodeURIComponent(campaign.siteUsername)}`">
                    @{{ campaign.siteUsername }}
                  </router-link>
                </span>
              </div>
              <details v-if="review?.audience.excludedCount">
                <summary>{{ review.audience.excludedCount }} excluded</summary>
                <ul><li v-for="[reason, count] in excludedReasons" :key="reason">{{ count }} · {{ reason.replace(/_/g, ' ') }}</li></ul>
              </details>

              <div class="test-send">
                <div><strong>Send a test</strong><p>Send a test to {{ ownerEmail }}.</p></div>
                <Button
                  color="outline"
                  shape="soft"
                  size="small"
                  :disabled="testing || !review?.transport.ready"
                  :title="!review?.transport.ready ? review?.transport.instructions[0] : undefined"
                  @click="sendTest"
                >{{ testing ? "Sending…" : "Send test" }}</Button>
              </div>
              <p v-if="testMessage" class="test-message" role="status">{{ testMessage }}</p>

              <fieldset class="send-choice">
                <legend>When should it send?</legend>
                <label><input v-model="sendMode" type="radio" value="now" /> Send now</label>
                <label><input v-model="sendMode" type="radio" value="schedule" /> Schedule</label>
                <label v-if="sendMode === 'schedule'" class="field"><span>Send time</span><input v-model="scheduledLocal" type="datetime-local" /></label>
              </fieldset>
            </section>

            <nav class="send-actions" aria-label="Campaign steps">
              <Button class="send-action-primary" color="neutral" shape="soft" size="large" :disabled="sending || !review?.transport.ready || !review?.audience.eligibleCount" @click="approveSend">
                {{ sending ? "Queuing…" : sendMode === "schedule" ? "Schedule campaign" : "Send campaign" }}
              </Button>
              <Button class="send-action-back" color="secondary" shape="soft" size="large" @click="goToPreviousStep(2)">Back</Button>
            </nav>
          </div>
        </template>
      </template>
    </main>
  </div>
</template>

<style scoped>
.campaign-wizard-page { display: flex; flex-direction: column; min-height: 100vh; background: var(--ui-bg, var(--color-bg)); color: var(--ui-text, var(--color-text)); }
.campaign-wizard-shell { width: min(100%, 1080px); box-sizing: border-box; margin: 0 auto; padding: 32px 24px 64px; }
.wizard-header { display: grid; grid-template-columns: 1fr minmax(0, auto) 1fr; align-items: center; padding: 16px 24px; }
.header-center { grid-column: 2; justify-self: center; }
.header-right { display: flex; grid-column: 3; justify-self: end; }
.step-indicator { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.step-current { color: var(--ui-text, var(--color-text)); font-weight: 700; }
.step-divider, .step-total, .step-name { color: var(--ui-text-muted, var(--color-text-muted)); }
.step-name { margin-left: 8px; }
.exit-btn { min-height: 44px; margin-right: 4px; padding: 6px 14px; border: 0; border-radius: 999px; background: var(--ui-border, var(--color-border)); color: var(--ui-text, var(--color-text)); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.exit-btn:hover { background: var(--ui-text-muted, var(--color-text-muted)); color: var(--ui-bg, var(--color-bg)); }
.exit-btn:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }
.progress-bar { position: relative; padding: 10px 24px 6px; }
.progress-track { position: absolute; top: 31px; right: 40px; left: 40px; height: 3px; border-radius: 999px; background: var(--ui-border, var(--color-border)); }
.progress-fill { height: 100%; border-radius: 999px; background: var(--ui-text, var(--color-text)); transition: width .3s ease; }
.progress-steps { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; }
.progress-step { position: relative; display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 8px 0; border: 0; background: none; color: var(--ui-text-muted, var(--color-text-muted)); cursor: default; }
.progress-step.is-jumpable { cursor: pointer; }
.progress-step-dot { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: 2px solid currentColor; border-radius: 999px; background: var(--ui-bg, var(--color-bg)); }
.progress-step.is-visited .progress-step-dot { color: var(--ui-text, var(--color-text)); }
.progress-step.is-visited:not(.is-current) .progress-step-dot { border-color: var(--ui-text, var(--color-text)); background: var(--ui-text, var(--color-text)); color: var(--ui-bg, var(--color-bg)); }
.progress-step.is-current .progress-step-dot { width: 22px; height: 22px; border-color: var(--ui-text, var(--color-text)); color: var(--ui-text, var(--color-text)); box-shadow: 0 0 0 4px var(--ui-border, var(--color-border)); }
.progress-step:focus-visible { outline: none; }
.progress-step:focus-visible .progress-step-dot { box-shadow: 0 0 0 4px var(--ui-border, var(--color-border)); }
.progress-step-core { width: 8px; height: 8px; border-radius: 999px; background: currentColor; }
.progress-step-check { font-size: 11px; font-weight: 700; line-height: 1; }
.availability-card { margin-bottom: 20px; padding: 15px 16px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface-muted, var(--color-bg-subtle)); }
.availability-card { display: flex; max-width: 680px; gap: 16px; margin: 70px auto; }
.availability-card h1, .availability-card p { margin: 0 0 10px; }
.availability-card p { color: var(--ui-text-muted, var(--color-text-muted)); line-height: 1.55; }
.start-card { display: grid; max-width: 640px; gap: 20px; margin: 42px auto; }
.start-card h1 { margin: 0 0 6px; }
.compose-heading, .review-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.compose-heading h1, .review-heading h1 { margin: 0; letter-spacing: -.035em; }
.review-heading { display: block; text-align: center; }
.review-heading p { margin: 5px 0 0; color: var(--ui-text-muted, var(--color-text-muted)); }
.compose-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(310px, 390px); align-items: start; gap: 24px; }
.compose-preview { position: sticky; top: calc(var(--workspace-topbar-height) + 18px); min-width: 0; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 22px; }
.field--wide { grid-column: 1 / -1; }
.field { display: grid; gap: 6px; min-width: 0; }
.field > span, .section-label > span, .send-choice legend { font-size: .8rem; font-weight: 750; }
.field small, .section-label small { color: var(--ui-text-muted, var(--color-text-muted)); font-size: .74rem; }
.field input, .field select { width: 100%; min-height: 42px; box-sizing: border-box; padding: 9px 11px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: 9px; background: var(--ui-surface, var(--color-bg)); color: var(--ui-text, var(--color-text)); font: inherit; }
.field input:focus, .field select:focus { outline: 2px solid var(--ui-primary, var(--ui-accent)); outline-offset: 1px; }
.section-label { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.wizard-actions { display: flex; justify-content: space-between; gap: 12px; padding-top: 40px; }
.send-review { display: grid; width: min(100%, 720px); gap: 28px; margin: 0 auto; }
.send-review .review-heading { margin-bottom: 0; }
.review-details { display: grid; gap: 16px; width: min(100%, 560px); margin: 0 auto; }
.audience-count { display: flex; align-items: baseline; gap: 8px; }
.audience-count strong { font-size: 2rem; letter-spacing: -.04em; }
.audience-count span { color: var(--ui-text-muted, var(--color-text-muted)); }
.audience-count a { color: var(--ui-accent, var(--color-primary)); font-weight: 700; }
.audience-count a:hover { color: var(--ui-accent-strong, var(--ui-accent, var(--color-primary))); }
.audience-count a:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }
details summary { cursor: pointer; font-weight: 700; }
details ul { margin-bottom: 0; color: var(--ui-text-muted, var(--color-text-muted)); font-size: .82rem; }
.test-send { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-top: 14px; border-top: 1px solid var(--ui-border, var(--color-border)); }
.test-send p, .test-message { margin: 3px 0 0; color: var(--ui-text-muted, var(--color-text-muted)); font-size: .78rem; line-height: 1.4; }
.delivery-notice { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface-muted, var(--color-bg-subtle)); }
.delivery-notice strong, .delivery-notice p { margin: 0; }
.delivery-notice p { margin-top: 3px; color: var(--ui-text-muted, var(--color-text-muted)); font-size: .8rem; line-height: 1.4; }
.send-choice { display: grid; gap: 10px; padding: 16px 0 0; border: 0; border-top: 1px solid var(--ui-border, var(--color-border)); margin: 0; }
.send-choice label { display: flex; align-items: center; gap: 8px; font-size: .86rem; }
.send-choice .field { display: grid; align-items: stretch; }
.send-actions { display: flex; flex-direction: column; align-items: center; gap: 16px; width: min(100%, 560px); margin: 4px auto 0; }
.send-actions :deep(.send-action-primary) { width: 100%; }
.send-actions :deep(.send-action-back) { min-width: 180px; }
@media (max-width: 820px) {
  .campaign-wizard-shell { padding-inline: 16px; }
  .compose-grid { grid-template-columns: 1fr; }
  .compose-preview { position: static; }
}
@media (max-width: 560px) {
  .wizard-header { padding: 14px 16px; }
  .step-indicator { font-size: 13px; }
  .step-name { display: none; }
  .progress-bar { padding: 8px 14px 4px; }
  .progress-track { top: 27px; right: 26px; left: 26px; }
  .progress-step-dot { width: 16px; height: 16px; }
  .progress-step.is-current .progress-step-dot { width: 20px; height: 20px; }
  .field-grid { grid-template-columns: 1fr; }
  .wizard-actions { flex-direction: column-reverse; }
  .wizard-actions :deep(.me3-btn) { width: 100%; }
  .audience-count { align-items: flex-start; }
}
</style>

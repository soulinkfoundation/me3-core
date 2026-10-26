<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { api } from "../../../api";
import AppDialog from "../../../components/AppDialog.vue";
import Button from "../../../components/Button.vue";
import CampaignEmailPreview from "../../../components/CampaignEmailPreview.vue";
import CampaignApprovalCard from "../../../components/campaigns/CampaignApprovalCard.vue";
import CampaignSenderSetup from "../../../components/campaigns/CampaignSenderSetup.vue";
import PageLoading from "../../../components/PageLoading.vue";
import TiptapEditor from "../../../components/TiptapEditor.vue";
import { useAppToast } from "../../../composables/useAppToast";
import { useAuthStore } from "../../../stores/auth";
import { useSitesStore } from "../../../stores/sites";
import {
  campaignDocumentToEditorHtml,
  campaignEditorHtmlToBlocks,
  type CampaignDocument,
} from "../../../utils/campaignDocument";
import { exclusionReasonLabel, exclusionSentence, formatCount } from "../../../utils/campaigns";

definePage({
  meta: {
    requiresAuth: true,
    // Email hides the top bar on wide screens; Campaigns is its own destination and keeps it (with Home).
    hideTopBarOnWide: false,
    title: "Campaign | ME3",
    description: "Write an email campaign.",
    robots: "noindex,follow",
  },
});

type Campaign = {
  id: string;
  siteId: string;
  siteUsername: string;
  name: string;
  status: string;
  audienceFilter: { kind: "all" | "customers"; itemRef?: string | null; notSentBy?: string | null };
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
  /** Self-hosted: the owner's own provider. */
  provider?: { id: string; label: string } | null;
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

/** Mirrors the Worker's default so a new draft shows the name it will be saved with. */
function defaultSenderName(username: string) {
  const name = username.replace(/^@/, "").replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sites = useSitesStore();
const { toastError, toastFromUnknown, toastSuccess } = useAppToast();
const remoteApiHost = import.meta.env.DEV
  ? import.meta.env.VITE_REMOTE_API_HOST || ""
  : "";
const loading = ref(true);
const loadFailed = ref(false);
const campaign = ref<Campaign | null>(null);
const transport = ref<TransportStatus | null>(null);
const review = ref<Review | null>(null);
const creating = ref(false);
const saving = ref(false);
const savedOnce = ref(false);
const testing = ref(false);
const hydrating = ref(true);
const reviewOpen = ref(false);
const fromSheetOpen = ref(false);
const audienceSheetOpen = ref(false);
type Recipients = {
  eligibleCount: number;
  excludedCount: number;
  eligible: Array<{ email: string; name: string | null }>;
  excluded: Array<{ email: string; reason: string }>;
};
const recipients = ref<Recipients | null>(null);
const recipientsOpen = ref(false);
const recipientsLoading = ref(false);
const audienceSheetTitleId = `campaign-audience-title-${useId()}`;
// Until the owner picks a sender name, a new draft keeps the one the Worker gives it.
let senderNameChosen = false;
let saveTimer: number | null = null;
let reviewRequest = 0;

const selectedSiteId = ref("");
const audienceKind = ref<"all" | "customers">("all");
const audienceItem = ref("");
// Set when this draft came from "Send to new subscribers": only people that campaign didn't reach.
const notSentBy = ref<string | null>(null);
const notSentByOriginal = ref<string | null>(null);
const notSentBySubject = ref("");
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
const fromSheetName = ref("");
const fromSheetRepliesOn = ref(true);
const fromSheetAddress = ref("");
const fromSheetTitleId = `campaign-from-title-${useId()}`;

const ownerEmail = computed(() => auth.user?.email?.trim().toLowerCase() || "");
const canDraftCampaign = computed(() => Boolean(transport.value || remoteApiHost));
const selectedSite = computed(() => sites.sites.find((site) => site.id === selectedSiteId.value));
const siteUsername = computed(() => campaign.value?.siteUsername || selectedSite.value?.username || "");
const sendingReady = computed(() => Boolean((review.value?.transport || transport.value)?.ready));
const sendsLeft = computed(() => {
  const current = review.value?.transport || transport.value;
  return current?.managed && current.addOn?.entitled ? current.addOn.remaining : null;
});
// Scheduled times are the owner's wall-clock time, wherever this browser is.
const ownerTimeZone = auth.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const eligibleCount = computed(() => review.value?.audience.eligibleCount ?? null);
const leftOut = computed(() => exclusionSentence(review.value?.audience.exclusionCounts));
const audienceLabel = computed(() =>
  audienceKind.value === "customers" ? "customers" : "subscribers",
);
const previewFromAddress = computed(() => transport.value?.sender?.fromAddress || "");
// Self-hosted installs send through the owner's own provider, which is connected from the From sheet.
const ownSenderMissing = computed(() => Boolean(transport.value && !transport.value.managed && !transport.value.ready));
const ownSenderLine = computed(() => {
  const current = transport.value;
  if (!current || current.managed) return "";
  if (!current.ready) return "No sender connected yet";
  return `Sends through ${current.provider?.label || "your provider"} from ${current.sender?.fromAddress || ""}`;
});
const previewToLabel = computed(() =>
  siteUsername.value ? `@${siteUsername.value} ${audienceLabel.value}` : "Subscribers",
);
const saveState = computed(() => {
  if (saving.value || creating.value) return "Saving…";
  return savedOnce.value ? "Saved" : "";
});
const currentRendererVersion = "me3.email-renderer.v3";

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
      brand.value.name = defaultSenderName(selectedSite.value?.username || "") || brand.value.name;
    }
  } catch (caught) {
    loadFailed.value = true;
    toastFromUnknown(caught, "Couldn't open this campaign.");
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
  // Only drafts are edited; anything already sent or scheduled has its own page.
  if (response.campaign.status !== "draft") {
    await router.replace(`/email/campaigns/${encodeURIComponent(response.campaign.id)}`);
    return;
  }
  applyCampaign(response.campaign);
  savedOnce.value = true;
  if (response.campaign.revision.rendererVersion !== currentRendererVersion) {
    await saveDraft();
  }
  void loadReview();
}

function applyCampaign(next: Campaign) {
  hydrating.value = true;
  campaign.value = next;
  selectedSiteId.value = next.siteId;
  audienceKind.value = next.audienceFilter?.kind === "customers" ? "customers" : "all";
  audienceItem.value = next.audienceFilter?.itemRef || "";
  notSentBy.value = next.audienceFilter?.notSentBy || null;
  if (notSentBy.value && !notSentByOriginal.value) {
    notSentByOriginal.value = notSentBy.value;
    void loadNotSentBySubject(notSentBy.value);
  }
  subject.value = next.revision.subject;
  previewText.value = next.revision.previewText;
  replyToAddress.value = next.revision.replyToAddress || "";
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

/** A new campaign is saved the first time the owner changes something, not when the page opens. */
async function ensureCampaign(): Promise<Campaign | null> {
  if (campaign.value) return campaign.value;
  if (!selectedSiteId.value || !canDraftCampaign.value) return null;
  if (creating.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(creating, (active) => {
        if (active) return;
        stop();
        resolve();
      });
    });
    return campaign.value;
  }
  creating.value = true;
  try {
    const response = await api.post<{ campaign: Campaign }>("/email/campaigns", {
      siteId: selectedSiteId.value,
      audienceFilter: currentAudienceFilter(),
    });
    campaign.value = response.campaign;
    if (!senderNameChosen) brand.value.name = response.campaign.revision.document.brand.name;
    // The site remembers its footer address, so a new campaign starts with it.
    if (!brand.value.mailingAddress && response.campaign.revision.document.brand.mailingAddress) {
      brand.value.mailingAddress = response.campaign.revision.document.brand.mailingAddress;
    }
    await router.replace({
      path: "/email/campaigns/create",
      query: { campaign: response.campaign.id },
    });
    return campaign.value;
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't save this campaign.");
    return null;
  } finally {
    creating.value = false;
  }
}

function currentAudienceFilter() {
  return { kind: audienceKind.value, itemRef: audienceItem.value || null, notSentBy: notSentBy.value };
}

async function loadNotSentBySubject(campaignId: string) {
  try {
    const response = await api.get<{ campaign: Campaign }>(`/email/campaigns/${encodeURIComponent(campaignId)}`);
    notSentBySubject.value = response.campaign.revision.subject.trim();
  } catch {
    notSentBySubject.value = "";
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
  if (campaign.value && campaign.value.status !== "draft") return true;
  if (saving.value) {
    await waitForCurrentSave();
    return saveDraft();
  }
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  const current = await ensureCampaign();
  if (!current) return false;
  saving.value = true;
  try {
    const response = await api.put<{ campaign: Campaign }>(
      `/email/campaigns/${encodeURIComponent(current.id)}`,
      {
        siteId: selectedSiteId.value,
        name: subject.value.trim() || current.name,
        subject: subject.value,
        previewText: previewText.value,
        replyToAddress: replyToAddress.value || null,
        audienceFilter: currentAudienceFilter(),
        document: buildDocument(),
      },
    );
    campaign.value = response.campaign;
    savedOnce.value = true;
    return true;
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't save this campaign.");
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

// The body editor normalises its HTML on mount, so a new campaign waits for real content.
function hasContent() {
  const bodyText = richTextHtml.value.replace(/<(?!img\b)[^>]*>/gi, "").trim();
  return Boolean(subject.value.trim() || previewText.value.trim() || bodyText || senderNameChosen);
}

function scheduleSave() {
  if (hydrating.value || (campaign.value && campaign.value.status !== "draft")) return;
  if (!campaign.value && !hasContent()) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveDraft(), 900);
}

async function loadReview() {
  if (!campaign.value) return;
  const request = ++reviewRequest;
  try {
    const response = await api.get<Review>(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}/review`,
    );
    if (request !== reviewRequest) return;
    review.value = response;
    transport.value = response.transport;
  } catch (caught) {
    if (reviewOpen.value) toastFromUnknown(caught, "Couldn't count who this goes to.");
  }
}

async function ownSenderConnected() {
  try {
    transport.value = (await api.get<{ transport: TransportStatus }>("/email/campaigns/transport")).transport;
    if (review.value) await loadReview();
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't check the sender.");
  }
}

async function openReview() {
  if (!brand.value.name.trim()) {
    toastError("Add a sender name first.");
    openFromSheet();
    return;
  }
  if (!subject.value.trim()) {
    toastError("Add a subject first.");
    return;
  }
  if (!(await saveDraft())) return;
  await loadReview();
  reviewOpen.value = true;
}

async function sendTest() {
  if (testing.value) return;
  if (!(await saveDraft()) || !campaign.value) return;
  testing.value = true;
  try {
    const response = await api.post<{ test: { status: string } }>(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}/test`,
    );
    if (response.test.status === "accepted") toastSuccess(`Test sent to ${ownerEmail.value}.`);
    else toastError(`The test wasn't sent (${response.test.status}).`);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't send the test.");
  } finally {
    testing.value = false;
  }
}

async function toggleRecipients() {
  recipientsOpen.value = !recipientsOpen.value;
  if (!recipientsOpen.value || recipients.value || !campaign.value) return;
  recipientsLoading.value = true;
  try {
    recipients.value = await api.get<Recipients>(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}/recipients`,
    );
  } catch (caught) {
    recipientsOpen.value = false;
    toastFromUnknown(caught, "Couldn't load who this goes to.");
  } finally {
    recipientsLoading.value = false;
  }
}

/** The server refused because the email or its count moved: reload both so the card shows the truth. */
async function refreshAfterStale() {
  if (!campaign.value) return;
  try {
    const response = await api.get<{ campaign: Campaign }>(
      `/email/campaigns/${encodeURIComponent(campaign.value.id)}`,
    );
    campaign.value = response.campaign;
  } catch {
    // The toast already explained; the next save will catch up.
  }
  await loadReview();
}

function openFromSheet() {
  fromSheetName.value = brand.value.name;
  fromSheetRepliesOn.value = Boolean(replyToAddress.value);
  fromSheetAddress.value = brand.value.mailingAddress || "";
  fromSheetOpen.value = true;
}

function saveFromSheet() {
  const name = fromSheetName.value.trim();
  if (!name) {
    toastError("Add the name subscribers will see.");
    return;
  }
  brand.value.name = name;
  brand.value.mailingAddress = fromSheetAddress.value.split(/\n+/).map((part) => part.trim()).filter(Boolean).join(", ");
  senderNameChosen = true;
  // The Worker only accepts the owner's own address as reply-to.
  replyToAddress.value = fromSheetRepliesOn.value ? ownerEmail.value : "";
  fromSheetOpen.value = false;
}

async function uploadCampaignImage(input: {
  blob: Blob;
  filename: string;
  mimeType: string;
}) {
  const current = await ensureCampaign();
  if (!current) throw new Error("Save the campaign before adding an image.");
  const form = new FormData();
  form.append("file", input.blob, input.filename);
  const response = await api.upload<{
    asset: { id: string; url: string };
  }>(`/email/campaigns/${encodeURIComponent(current.id)}/assets`, form);
  return { id: response.asset.id, src: response.asset.url };
}

watch([subject, previewText, replyToAddress, richTextHtml, brand], scheduleSave, {
  deep: true,
});
watch([selectedSiteId, audienceKind, audienceItem, notSentBy], async (next, previous) => {
  if (previous[0] && previous[0] !== next[0]) audienceItem.value = "";
  if (next[0] !== previous[0]) void loadAudienceItems(next[0]);
  if (hydrating.value || !campaign.value) return;
  // Who it goes to changes the count, so save straight away and recount.
  recipients.value = null;
  recipientsOpen.value = false;
  if (await saveDraft()) await loadReview();
});
// Any edit after opening the send controls means they have to be looked at again.
watch([subject, previewText, richTextHtml, brand, replyToAddress], () => {
  if (!hydrating.value) reviewOpen.value = false;
}, { deep: true });

onMounted(() => void initialize());
onBeforeUnmount(() => {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
});
</script>

<template>
  <main class="campaign-editor-page">
    <header class="campaign-editor-bar">
      <RouterLink class="campaign-editor-bar__back" to="/email/campaigns">← Campaigns</RouterLink>
      <div v-if="!loading && !loadFailed && canDraftCampaign" class="campaign-editor-bar__actions">
        <span class="campaign-editor-bar__saved" aria-live="polite">{{ saveState }}</span>
        <Button
          color="secondary"
          shape="pill"
          size="compact"
          :disabled="testing || !sendingReady"
          :title="!sendingReady ? 'Sending isn\'t set up yet' : undefined"
          @click="sendTest"
        >{{ testing ? "Sending…" : "Send test" }}</Button>
        <Button
          color="primary"
          shape="pill"
          size="compact"
          :disabled="saving || creating"
          @click="openReview"
        >Review and send</Button>
      </div>
    </header>

    <PageLoading v-if="loading" label="Opening campaign…" />

    <section v-else-if="loadFailed" class="campaign-editor-state">
      <h1>This campaign didn't open</h1>
      <p>Check your connection and try again.</p>
      <Button color="ghost" shape="soft" size="compact" @click="initialize">Try again</Button>
    </section>

    <section v-else-if="!canDraftCampaign" class="campaign-editor-state">
      <h1>Campaigns isn't available on this account yet</h1>
      <RouterLink to="/email/campaigns">Back to Campaigns</RouterLink>
    </section>

    <div v-else class="campaign-editor">
      <CampaignApprovalCard
        v-if="reviewOpen && campaign"
        class="campaign-editor__approval"
        :campaign-id="campaign.id"
        :revision-id="campaign.revision.id"
        :recipient-count="eligibleCount"
        :audience-line="`${formatCount(eligibleCount || 0)} ${audienceLabel} of @${siteUsername}`"
        :left-out="leftOut"
        :sender-ready="sendingReady"
        :mailing-address-missing="!brand.mailingAddress"
        :sends-left="sendsLeft"
        :time-zone="ownerTimeZone"
        :testing="testing"
        @edit="reviewOpen = false"
        @test="sendTest"
        @sent="router.push('/email/campaigns')"
        @stale="refreshAfterStale"
      />

      <div class="campaign-editor__grid">
        <section class="campaign-editor__main" aria-label="Email">
          <label class="campaign-field campaign-field--subject">
            <span>Subject</span>
            <input v-model="subject" maxlength="200" placeholder="What's this email about?" />
          </label>
          <label class="campaign-field">
            <span>Preview line</span>
            <input v-model="previewText" maxlength="240" placeholder="Shown after the subject in the inbox" />
          </label>
          <TiptapEditor
            v-model="richTextHtml"
            class="campaign-editor__body"
            variant="campaign"
            placeholder="Write your email…"
            :upload-image="uploadCampaignImage"
          />
        </section>

        <aside class="campaign-editor__side" aria-label="Details">
          <section class="campaign-side-block" aria-labelledby="campaign-to-title">
            <div class="campaign-side-block__head">
              <h2 id="campaign-to-title">To</h2>
              <button type="button" class="campaign-side-block__change" @click="audienceSheetOpen = true">Change</button>
            </div>
            <p v-if="eligibleCount !== null" class="campaign-side-block__value">
              <b>{{ formatCount(eligibleCount) }}</b> {{ audienceLabel }}<template v-if="siteUsername"> of @{{ siteUsername }}</template>
            </p>
            <p v-else class="campaign-side-block__value">All {{ audienceLabel }}<template v-if="siteUsername"> of @{{ siteUsername }}</template></p>
            <p v-if="notSentBy" class="campaign-side-block__hint">Only people who didn't get {{ notSentBySubject ? `“${notSentBySubject}”` : "the earlier email" }}</p>
            <p v-if="leftOut" class="campaign-side-block__hint campaign-side-block__left-out">{{ leftOut }}</p>
          </section>

          <section class="campaign-side-block" aria-labelledby="campaign-from-title">
            <div class="campaign-side-block__head">
              <h2 id="campaign-from-title">From</h2>
              <button type="button" class="campaign-side-block__change" @click="openFromSheet">Change</button>
            </div>
            <p class="campaign-side-block__value">{{ brand.name }}</p>
            <p class="campaign-side-block__hint">
              {{ replyToAddress ? `Replies go to ${replyToAddress}` : "Replies aren't collected" }}
            </p>
            <p v-if="ownSenderLine" class="campaign-side-block__hint">{{ ownSenderLine }}</p>
            <p v-if="brand.mailingAddress" class="campaign-side-block__hint">{{ brand.mailingAddress }}</p>
            <p v-else class="campaign-side-block__hint campaign-side-block__missing">
              Add a mailing address before sending.
            </p>
          </section>

          <section class="campaign-side-block campaign-side-block--preview" aria-labelledby="campaign-preview-title">
            <h2 id="campaign-preview-title">Preview</h2>
            <CampaignEmailPreview
              :subject="subject"
              :sender-name="brand.name"
              :from-address="previewFromAddress"
              :reply-to-address="replyToAddress"
              :to-label="previewToLabel"
              :html="campaign?.revision.renderedHtml || ''"
            />
          </section>
        </aside>
      </div>
    </div>

    <AppDialog :open="audienceSheetOpen" :labelled-by="audienceSheetTitleId" close-on-backdrop @close="audienceSheetOpen = false">
      <form class="campaign-from-sheet" @submit.prevent="audienceSheetOpen = false">
        <h2 :id="audienceSheetTitleId">Who gets this</h2>
        <label v-if="sites.sites.length > 1" class="campaign-side-field">
          <span>List</span>
          <select v-model="selectedSiteId">
            <option v-for="site in sites.sites" :key="site.id" :value="site.id">@{{ site.username }}</option>
          </select>
        </label>
        <fieldset class="campaign-audience-options">
          <legend class="sr-only">Audience</legend>
          <label><input v-model="audienceKind" type="radio" value="all" /> Everyone who subscribed</label>
          <label><input v-model="audienceKind" type="radio" value="customers" /> Customers who subscribed</label>
        </fieldset>
        <label v-if="notSentByOriginal" class="campaign-audience-options">
          <span class="campaign-audience-options__check">
            <input
              type="checkbox"
              :checked="Boolean(notSentBy)"
              @change="notSentBy = ($event.target as HTMLInputElement).checked ? notSentByOriginal : null"
            />
            Only people who didn't get {{ notSentBySubject ? `“${notSentBySubject}”` : "the earlier email" }}
          </span>
        </label>
        <label v-if="audienceKind === 'customers' && audienceItems.length" class="campaign-side-field">
          <span>Bought</span>
          <select v-model="audienceItem">
            <option value="">Anything</option>
            <option v-for="item in audienceItems" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <p class="campaign-audience-count" aria-live="polite">
          <template v-if="eligibleCount !== null"><b>{{ formatCount(eligibleCount) }}</b> {{ eligibleCount === 1 ? "person" : "people" }} will get it.</template>
          <template v-else>The count shows once the email is saved.</template>
          <template v-if="leftOut">{{ ` ${leftOut}` }}</template>
        </p>
        <button
          v-if="campaign && eligibleCount !== null"
          type="button"
          class="campaign-side-block__change campaign-recipients__toggle"
          :aria-expanded="recipientsOpen"
          @click="toggleRecipients"
        >{{ recipientsOpen ? "Hide who" : "See who" }}</button>
        <div v-if="recipientsOpen" class="campaign-recipients">
          <p v-if="recipientsLoading" class="campaign-audience-count">Loading…</p>
          <template v-else-if="recipients">
            <ul aria-label="Will get it">
              <li v-for="person in recipients.eligible" :key="person.email">
                <span>{{ person.email }}</span>
                <span v-if="person.name" class="campaign-recipients__muted">{{ person.name }}</span>
              </li>
            </ul>
            <template v-if="recipients.excluded.length">
              <h3>Left out</h3>
              <ul aria-label="Left out">
                <li v-for="person in recipients.excluded" :key="`${person.email}-${person.reason}`">
                  <span>{{ person.email }}</span>
                  <span class="campaign-recipients__muted">{{ exclusionReasonLabel(person.reason) }}</span>
                </li>
              </ul>
            </template>
            <p v-if="recipients.eligibleCount > recipients.eligible.length" class="campaign-audience-count">
              Showing the first {{ formatCount(recipients.eligible.length) }}.
            </p>
          </template>
        </div>
        <div class="campaign-from-sheet__actions">
          <Button color="primary" shape="soft" size="compact" type="submit">Done</Button>
        </div>
      </form>
    </AppDialog>

    <AppDialog :open="fromSheetOpen" :labelled-by="fromSheetTitleId" close-on-backdrop @close="fromSheetOpen = false">
      <div class="campaign-from-sheet">
        <CampaignSenderSetup v-if="ownSenderMissing" class="campaign-from-sheet__sender" @connected="ownSenderConnected" />
        <form class="campaign-from-sheet__form" @submit.prevent="saveFromSheet">
          <h2 :id="fromSheetTitleId">Who it's from</h2>
          <label class="campaign-field">
            <span>Sender name</span>
            <input v-model="fromSheetName" maxlength="120" placeholder="The name subscribers will see" />
          </label>
          <label class="campaign-from-sheet__replies">
            <input v-model="fromSheetRepliesOn" type="checkbox" />
            <span>Send replies to {{ ownerEmail }}</span>
          </label>
          <small v-if="!fromSheetRepliesOn" class="campaign-from-sheet__hint">Replies won't be collected.</small>
          <small v-if="ownSenderLine && !ownSenderMissing" class="campaign-from-sheet__hint">{{ ownSenderLine }}</small>
          <label class="campaign-field">
            <span>Mailing address</span>
            <textarea v-model="fromSheetAddress" rows="3" maxlength="300" placeholder="PO Box 12, Dublin 2, Ireland" />
            <small>Shown at the bottom of every email. Marketing email needs a postal address; a PO box or business address is fine.</small>
          </label>
          <div class="campaign-from-sheet__actions">
            <Button color="outline" shape="soft" size="compact" type="button" @click="fromSheetOpen = false">Cancel</Button>
            <Button color="primary" shape="soft" size="compact" type="submit">Done</Button>
          </div>
        </form>
      </div>
    </AppDialog>
  </main>
</template>

<style scoped>
/* Lives in the Campaigns destination: the app top bar, then this page's own back link and actions. */
.campaign-editor-page { min-height: calc(100dvh - var(--app-topbar-height)); background: var(--ui-bg); color: var(--ui-text); }
.campaign-editor-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; box-sizing: border-box; width: min(100%, 1040px); margin: 0 auto; padding: 4px 16px 8px; }
.campaign-editor-bar__back { display: inline-flex; min-height: 36px; align-items: center; color: var(--ui-text-muted); font-size: 14px; text-decoration: none; }
.campaign-editor-bar__back:hover { color: var(--ui-text); }
.campaign-editor-bar__actions { display: flex; align-items: center; gap: 8px; }
.campaign-editor-bar__saved { color: var(--ui-text-muted); font-size: 12px; }
.campaign-editor-bar a:focus-visible, .campaign-side-block__change:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 6px; }
.campaign-editor { box-sizing: border-box; width: min(100%, 1040px); margin: 0 auto; padding: 0 16px 96px; }
.campaign-editor__grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; gap: 32px; margin-top: 8px; }
.campaign-editor__main { display: grid; gap: 14px; min-width: 0; }
.campaign-field { display: grid; gap: 4px; min-width: 0; }
.campaign-field > span { color: var(--ui-text-muted); font-size: 12px; font-weight: 600; }
.campaign-field input { box-sizing: border-box; width: 100%; min-height: 40px; padding: 6px 0; border: 0; border-bottom: 1px solid var(--ui-border); border-radius: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; }
.campaign-field--subject input { font-size: 20px; font-weight: 600; }
.campaign-field input:focus { outline: none; border-bottom-color: var(--ui-accent); box-shadow: 0 1px 0 var(--ui-accent); }
.campaign-field small { color: var(--ui-text-muted); font-size: 12px; }
.campaign-editor__body { margin-top: 4px; }
.campaign-editor__side { position: sticky; top: calc(var(--app-topbar-height) + 12px); display: grid; min-width: 0; font-size: 14px; }
.campaign-side-block { display: grid; gap: 6px; padding: 14px 0; border-bottom: 1px solid var(--ui-border); }
.campaign-side-block:first-child { padding-top: 0; }
.campaign-side-block--preview { border-bottom: 0; }
.campaign-side-block h2 { margin: 0; color: var(--ui-text-muted); font-size: 12px; font-weight: 600; }
.campaign-side-block__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.campaign-side-block__change { min-height: 28px; padding: 0; border: 0; background: none; color: var(--ui-accent-strong, var(--ui-accent)); font: 600 13px var(--font-sans); cursor: pointer; }
.campaign-side-block__value { margin: 0; overflow-wrap: anywhere; }
.campaign-side-block__value b { font-weight: 650; font-variant-numeric: tabular-nums; }
.campaign-side-block__hint { margin: 0; color: var(--ui-text-muted); font-size: 13px; overflow-wrap: anywhere; }
.campaign-audience-options { display: grid; gap: 10px; margin: 0; padding: 0; border: 0; font-size: 14px; }
.campaign-audience-options label { display: flex; align-items: center; gap: 8px; }
.campaign-editor__approval { margin: 4px 0 16px; }
.campaign-audience-options__check { display: flex; align-items: center; gap: 8px; }
.campaign-field textarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-bg); color: var(--ui-text); font: inherit; font-size: 14px; resize: vertical; }
.campaign-field textarea:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.campaign-side-block__missing { color: var(--ui-warning, color-mix(in oklab, #b26a00 70%, var(--ui-text))); }
.campaign-from-sheet__replies { display: flex; align-items: center; gap: 8px; font-size: 14px; overflow-wrap: anywhere; }
.campaign-from-sheet__hint { margin-top: -8px; color: var(--ui-text-muted); font-size: 12px; }
.campaign-audience-count { margin: 0; color: var(--ui-text-muted); font-size: 13px; }
.campaign-recipients__toggle { justify-self: start; }
.campaign-recipients { max-height: 240px; overflow-y: auto; padding: 4px 0; border-top: 1px solid var(--ui-border); font-size: 13px; }
.campaign-recipients ul { margin: 0; padding: 0; list-style: none; }
.campaign-recipients li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; overflow-wrap: anywhere; }
.campaign-recipients h3 { margin: 10px 0 2px; color: var(--ui-text-muted); font-size: 12px; font-weight: 600; }
.campaign-recipients__muted { flex: 0 0 auto; color: var(--ui-text-muted); }
.campaign-audience-count b { color: var(--ui-text); font-variant-numeric: tabular-nums; }
.campaign-side-field { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 8px; color: var(--ui-text-muted); font-size: 13px; }
.campaign-side-field select { min-width: 0; min-height: 34px; padding: 4px 8px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface); color: var(--ui-text); font: inherit; font-size: 13px; }
.campaign-side-field select:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.campaign-editor-state { box-sizing: border-box; width: min(100%, 560px); margin: 32px auto 0; padding: 0 16px; }
.campaign-editor-state h1 { margin: 0; font-size: 20px; }
.campaign-editor-state p { margin: 6px 0 0; color: var(--ui-text-muted); }
.campaign-editor-state a { display: inline-block; margin-top: 10px; color: var(--ui-accent-strong, var(--ui-accent)); font-weight: 600; text-decoration: none; }
.campaign-from-sheet { box-sizing: border-box; display: grid; gap: 16px; width: min(100%, 420px); padding: 20px; border-radius: var(--ui-radius-lg); background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.campaign-from-sheet h2 { margin: 0; font-size: 18px; }
.campaign-from-sheet__form { display: grid; gap: 16px; }
.campaign-from-sheet__sender { padding-bottom: 16px; border-bottom: 1px solid var(--ui-border); }
.campaign-from-sheet__sender :deep(h2) { font-size: 18px; }
.campaign-from-sheet__actions { display: flex; justify-content: flex-end; gap: 8px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 860px) {
  .campaign-editor__grid { grid-template-columns: 1fr; gap: 8px; }
  .campaign-editor__side { position: static; }
  .campaign-side-block:first-child { padding-top: 14px; border-top: 1px solid var(--ui-border); }
}
@media (max-width: 480px) {
  .campaign-editor-bar__saved { display: none; }
  }
</style>

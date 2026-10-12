<script setup lang="ts">
import { definePage } from "unplugin-vue-router/runtime";
import { computed, onMounted, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWizardStore,
  type WizardSiteRole,
  type WizardStepId,
} from "../stores/wizard";
import { useSitesStore } from "../stores/sites";
import { usePublish } from "../composables/usePublish";
import GeneratedSitePreview from "../components/GeneratedSitePreview.vue";
import PageLoading from "../components/PageLoading.vue";
import AppDialog from "../components/AppDialog.vue";
import UiIcon from "../components/UiIcon.vue";
import { resolvePublicSiteUrl } from "../utils/publicSiteUrl";
import { useAppToast } from "../composables/useAppToast";

// Step components
import WizardBasics from "../components/wizard/WizardBasics.vue";
import WizardAvatar from "../components/wizard/WizardAvatar.vue";
import WizardBanner from "../components/wizard/WizardBanner.vue";
import WizardMission from "../components/wizard/WizardMission.vue";
import WizardGoals from "../components/wizard/WizardGoals.vue";
import WizardLinks from "../components/wizard/WizardLinks.vue";
import WizardCallToAction from "../components/wizard/WizardCallToAction.vue";
import WizardPages from "../components/wizard/WizardPages.vue";
import WizardAdditionalFeatures from "../components/wizard/WizardAdditionalFeatures.vue";
import WizardNewsletter from "../components/wizard/WizardNewsletter.vue";
import WizardBlog from "../components/wizard/WizardBlog.vue";
import WizardBookings from "../components/wizard/WizardBookings.vue";
import WizardShop from "../components/wizard/WizardShop.vue";
import WizardTestimonials from "../components/wizard/WizardTestimonials.vue";
import WizardLook from "../components/wizard/WizardLook.vue";

definePage({
  meta: {
    requiresAuth: true,
    title: "Site Wizard | ME3",
    description:
      "Create your me3 site in minutes with the step-by-step wizard.",
    robots: "noindex,follow",
  },
});

const wizard = useWizardStore();
const sites = useSitesStore();
const route = useRoute();
const router = useRouter();
const { isPublishing, publishError, publishNeedsStorage, publishProgress, publish } = usePublish();
const { toastSuccess, toastFromUnknown } = useAppToast();
const stepsOpen = ref(false);
const previewOpen = ref(false);
const previewViewport = ref<"mobile" | "desktop">("mobile");
const published = ref(false);
const publishedSiteUrl = ref("");
const publishValidationError = ref("");
const siteIsPublic = computed(() => wizard.siteRole === "organization" || wizard.profile.visibility === "public");
const showIntroScreen = ref(false);
const isOpeningWizard = ref(true);

const requestedSiteRole = computed<WizardSiteRole>(() =>
  route.query.siteRole === "organization" ? "organization" : "profile",
);
const startingNewSite = computed(() => route.query.new === "1");
const requestedSiteId = computed(() =>
  typeof route.query.siteId === "string" ? route.query.siteId.trim() : "",
);
const isAdditionalSite = computed(() =>
  startingNewSite.value
    ? requestedSiteRole.value === "organization"
    : wizard.siteRole === "organization",
);
const introTitle = computed(() =>
  isAdditionalSite.value ? "Create a new site" : "Create your website",
);
const openingLabel = computed(() =>
  isAdditionalSite.value ? "Opening your site..." : "Opening your website...",
);

const stepComponentById = {
  basics: WizardBasics,
  avatar: WizardAvatar,
  banner: WizardBanner,
  mission: WizardMission,
  goals: WizardGoals,
  links: WizardLinks,
  "call-to-action": WizardCallToAction,
  pages: WizardPages,
  "additional-features": WizardAdditionalFeatures,
  newsletter: WizardNewsletter,
  bookings: WizardBookings,
  blog: WizardBlog,
  offerings: WizardShop,
  testimonials: WizardTestimonials,
  publish: WizardLook,
} satisfies Record<WizardStepId, Component>;

// Reference to the current component instance
const currentComponentRef = ref<
  | InstanceType<typeof WizardPages>
  | InstanceType<typeof WizardBlog>
  | InstanceType<typeof WizardShop>
  | InstanceType<typeof WizardBookings>
  | null
>(null);

const stepComponents = computed(() =>
  wizard.steps.map((step) => stepComponentById[step.id]),
);

const currentComponent = computed(
  () => stepComponents.value[wizard.currentStep - 1],
);

const previewActiveView = computed(() => {
  if (currentComponent.value === WizardBlog) {
    const blogRef = currentComponentRef.value as InstanceType<
      typeof WizardBlog
    > | null;
    if (blogRef?.activePostSlug) {
      return `${wizard.blogPath}:${blogRef.activePostSlug}`;
    }
    return wizard.blogPath;
  }
  return null;
});

const importedDraftHost = computed(() => {
  const sourceUrl = wizard.draftSourceUrl;
  if (!sourceUrl) return null;

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl;
  }
});

const showImportedDraftRecovery = computed(
  () =>
    !!importedDraftHost.value &&
    !wizard.lastPublishedAt &&
    !showIntroScreen.value,
);

function hasMeaningfulRestoredDraft(): boolean {
  const profile = wizard.profile;
  return Boolean(
    profile.name.trim() ||
      profile.bio.trim() ||
      profile.location.trim() ||
      profile.logo ||
      profile.avatar ||
      profile.banner ||
      Object.values(profile.links).some(
        (value) => typeof value === "string" && value.trim(),
      ) ||
      profile.buttons.length ||
      profile.business.goals.length ||
      profile.business.positioningStatement.trim() ||
      profile.business.audience.trim() ||
      profile.business.primaryProblem.trim() ||
      profile.business.solution.trim() ||
      profile.business.targetMarket.trim() ||
      profile.business.primaryOutcome.trim() ||
      wizard.pages.length ||
      wizard.posts.length ||
      wizard.products.length ||
      wizard.testimonials.length ||
      wizard.furthestStep > 1
  );
}

const showPreview = computed(() => !showIntroScreen.value && wizard.currentStepId !== "goals");
const inlinePreview = computed(() => ["basics", "avatar", "banner", "publish"].includes(wizard.currentStepId || ""));

// Check if WizardPages/Blog/Offerings/Bookings is in editing mode
const isEditingPage = computed(() => {
  if (!currentComponentRef.value) return false;

  if (currentComponent.value === WizardPages) {
    return (currentComponentRef.value as InstanceType<typeof WizardPages>)
      .isEditingPage;
  }
  if (currentComponent.value === WizardBlog) {
    return (currentComponentRef.value as InstanceType<typeof WizardBlog>)
      .isEditingPost;
  }
  if (currentComponent.value === WizardShop) {
    return (currentComponentRef.value as InstanceType<typeof WizardShop>)
      .isEditingProduct;
  }

  return false;
});

function handleBack() {
  if (wizard.currentStep === 1) {
    handleExit();
  } else {
    wizard.prevStep();
  }
}

function handleNext() {
  wizard.nextStep();
}

function handleStepJump(step: number) {
  wizard.goToStep(step);
  stepsOpen.value = false;
  window.scrollTo({ top: 0, behavior: "instant" });
}

function applyRouteStep() {
  const step = typeof route.query.step === "string" ? route.query.step : "";
  if (!step) return;
  if (step === "wheel-of-life" || step === "wheel") {
    void router.replace("/wheel-of-life");
    return;
  }
  if (step === "goals" && wizard.siteRole === "profile" && !isOpeningWizard.value) {
    void router.replace("/tasks?goals=1");
    return;
  }
  const navigated = wizard.goToStepId(step, { enableOptional: true });
  if (!navigated) return;
  showIntroScreen.value = false;
}

function syncRouteStep() {
  if (typeof route.query.step !== "string") return;
  if (!wizard.currentStepId || route.query.step === wizard.currentStepId) return;
  router.replace({
    path: route.path,
    query: { ...route.query, step: wizard.currentStepId },
  });
}

function exitWizardDestination(): string {
  const returnPath =
    typeof route.query.return === "string" ? route.query.return.trim() : "";
  if (returnPath.startsWith("/") && !returnPath.startsWith("//")) {
    return returnPath;
  }
  const site = (wizard.username || wizard.profile.handle || "")
    .trim()
    .toLowerCase();
  if (site.length >= 3) return `/sites/${site}`;
  return "/sites";
}

function handleExit() {
  router.push(exitWizardDestination());
}

function handleIntroGetStarted() {
  showIntroScreen.value = false;
}

async function handlePublish() {
  if (isPublishing.value) return;
  publishValidationError.value = "";
  if (wizard.profile.name.trim().length < 2 || wizard.username.trim().length < 3) {
    publishValidationError.value = "Add your name and a username of at least three characters in Basics before publishing.";
    wizard.goToStepId("basics");
    return;
  }
  if (wizard.isCheckingUsername || wizard.isUsernameAvailable === false) {
    publishValidationError.value = "Choose an available username in Basics before publishing.";
    wizard.goToStepId("basics");
    return;
  }
  const success = await publish({ openSite: false, celebrate: false });
  if (!success) return;
  publishedSiteUrl.value = await resolvePublicSiteUrl(wizard.username, sites.sites.find(site => site.username === wizard.username) || { site_role: wizard.siteRole });
  published.value = true;
  window.scrollTo({ top: 0, behavior: "instant" });
}
async function copySiteLink() {
  try { await navigator.clipboard.writeText(publishedSiteUrl.value); toastSuccess("Site link copied."); }
  catch (error) { toastFromUnknown(error, "Couldn't copy the site link."); }
}

function clearImportedDraft() {
  wizard.reset();
  router.push("/sites");
}

let wizardOpenRequest = 0;
let wizardMounted = false;

async function openWizardTarget() {
  if (route.query.step === "wheel-of-life" || route.query.step === "wheel") {
    await router.replace("/wheel-of-life");
    return;
  }
  const requestId = ++wizardOpenRequest;
  let openedExistingSite = false;
  isOpeningWizard.value = true;
  published.value = false;
  try {
    await sites.ensureSites();
    if (requestId !== wizardOpenRequest) return;
    const requestedUsername =
      typeof route.query.site === "string" ? route.query.site.trim() : "";
    const targetSite = requestedSiteId.value
      ? sites.sites.find((site) => site.id === requestedSiteId.value)
      : requestedUsername
        ? sites.sites.find((site) => site.username === requestedUsername)
        : sites.sites.find((site) => site.site_role === "profile");

    if (startingNewSite.value) {
      wizard.activateDraftContext({ role: requestedSiteRole.value });
    } else if (targetSite?.username) {
      openedExistingSite = true;
      const targetRole: WizardSiteRole =
        targetSite.site_role === "organization" ? "organization" : "profile";
      const draft = wizard.activateDraftContext({
        siteId: targetSite.id,
        username: targetSite.username,
        role: targetRole,
      });
      const preserveLocalDraft =
        draft.restored &&
        hasMeaningfulRestoredDraft() &&
        (draft.migratedLegacy || wizard.needsPublish);
      if (preserveLocalDraft && targetSite.published_at) {
        wizard.restorePublishedBaseline(targetSite.published_at);
      }
      if (!preserveLocalDraft) {
        const content = await sites.getSiteContent(targetSite.username);
        if (requestId !== wizardOpenRequest) return;
        if (content?.ok && content.profile) {
          wizard.loadFromSiteContent(
            content.profile,
            content.pages,
            content.posts,
            content.products || [],
            targetSite.username,
            targetSite.published_at || null,
            undefined,
            targetRole,
          );
        }
      }
    } else if (requestedSiteId.value || requestedUsername) {
      wizard.activateDraftContext({ role: requestedSiteRole.value });
    } else {
      wizard.activateDraftContext({ role: "profile" });
    }
  } finally {
    if (requestId !== wizardOpenRequest) return;
    showIntroScreen.value = !openedExistingSite;
    if (route.query.step === "goals" && wizard.siteRole === "profile") {
      void router.replace("/tasks?goals=1");
      return;
    }
    applyRouteStep();
    isOpeningWizard.value = false;
  }
}

onMounted(async () => {
  wizardMounted = true;
  await openWizardTarget();
});

watch(() => route.query.step, applyRouteStep);
watch(() => wizard.currentStepId, syncRouteStep);
watch(
  () => [
    route.query.siteId,
    route.query.site,
    route.query.new,
    route.query.siteRole,
  ],
  () => {
    if (wizardMounted) void openWizardTarget();
  },
);
</script>

<template>
  <PageLoading v-if="isOpeningWizard" :label="openingLabel" />
  <div v-else class="wizard-page">
    <section v-if="published" class="wizard-finish" aria-labelledby="wizard-finish-title">
      <UiIcon name="CircleCheck" :size="72" class="wizard-finish__check" aria-hidden="true" />
      <h1 id="wizard-finish-title">{{ siteIsPublic ? "You’re live" : "Your site is saved" }}</h1>
      <p v-if="!siteIsPublic">Your profile is private. Make it public in Basics when you’re ready to share it.</p>
      <button v-if="siteIsPublic" type="button" class="wizard-copy-link" @click="copySiteLink">{{ publishedSiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') }}<UiIcon name="Copy" :size="16" /></button>
      <div class="wizard-finish__preview"><GeneratedSitePreview viewport="mobile" compact /></div>
      <div class="wizard-finish__actions">
        <a v-if="siteIsPublic" :href="publishedSiteUrl" target="_blank" rel="noopener noreferrer"><UiIcon name="ExternalLink" :size="18" />View site</a>
        <RouterLink v-else :to="`/sites/${encodeURIComponent(wizard.username)}`">View site</RouterLink>
        <button type="button" class="nav-btn next" @click="handleExit">Done</button>
      </div>
    </section>
    <template v-else-if="!showIntroScreen">
      <header class="wizard-header">
        <button type="button" class="exit-btn wizard-icon-button" aria-label="Close editor" @click="handleExit"><UiIcon name="X" :size="20" /></button>
        <button type="button" class="wizard-step-button" :aria-label="`Step ${wizard.currentStep} of ${wizard.totalSteps}: ${wizard.currentStepName}. Show all steps`" aria-haspopup="dialog" :aria-expanded="stepsOpen" @click="stepsOpen = true"><span class="step-name">{{ wizard.currentStepName }}<UiIcon name="ChevronDown" :size="15" /></span><small>Step {{ wizard.currentStep }} of {{ wizard.totalSteps }}</small></button>
        <button type="button" class="wizard-icon-button" aria-label="Preview your site" @click="previewOpen = true"><UiIcon name="Eye" :size="20" /></button>
        <button type="button" class="wizard-publish" :disabled="isPublishing || wizard.isCheckingUsername" @click="handlePublish">{{ isPublishing ? 'Publishing…' : 'Publish' }}</button>
      </header>
      <div class="wizard-progress" role="progressbar" aria-label="Site editor progress" :aria-valuenow="wizard.currentStep" :aria-valuemin="1" :aria-valuemax="wizard.totalSteps" :aria-valuetext="`${wizard.currentStepName}, step ${wizard.currentStep} of ${wizard.totalSteps}`"><span v-for="(step, index) in wizard.steps" :key="step.id" :class="{ filled: index < wizard.currentStep }" /></div>
      <div v-if="showImportedDraftRecovery" class="draft-recovery-banner"><div><strong>Imported draft saved locally.</strong><p>Imported from {{ importedDraftHost }}. Publish, keep editing or start over.</p></div><button type="button" @click="clearImportedDraft">Start over</button></div>
      <p v-if="publishProgress" class="wizard-publish-status" role="status">{{ publishProgress }}</p>
      <p v-if="publishError || publishValidationError" class="wizard-publish-error" role="alert">{{ publishError || publishValidationError }}<RouterLink v-if="publishNeedsStorage" to="/settings?section=storage">Activate storage</RouterLink></p>
    </template>
    <main v-if="showIntroScreen && !published" class="wizard-intro">
      <section class="intro-panel" aria-labelledby="intro-title">
        <img
          class="intro-image"
          src="/me3protocol.jpg"
          alt="ME3 protocol profile preview"
        />
        <div class="intro-copy">
          <h1 id="intro-title">{{ introTitle }}</h1>
          <p v-if="isAdditionalSite">
            Build a focused site for a business, project, brand, community, or
            organisation. You can shape the content now and publish when it is
            ready.
          </p>
          <p v-else>
            Your website represents you online and gives your ME3 agent
            useful public context.
            <a href="https://me3.app/protocol" target="_blank" rel="noreferrer">
              Learn more about that here </a
            >.
          </p>
          <button
            class="intro-button"
            type="button"
            @click="handleIntroGetStarted"
          >
            Get started
          </button>
        </div>
      </section>
    </main>


    <main v-if="!showIntroScreen && !published" class="wizard-main" :class="{ 'wizard-main--inline-preview': inlinePreview }">
      <div class="step-content">
        <component :is="currentComponent" :key="`${wizard.draftContextId}:${wizard.currentStepId}`" ref="currentComponentRef" />
      </div>
      <aside v-if="showPreview" class="preview-panel" aria-label="Live site preview">
        <div class="wizard-preview-label"><UiIcon name="Eye" :size="15" />Live preview<button type="button" @click="previewOpen = true">Expand</button></div>
        <GeneratedSitePreview :active-view="previewActiveView || undefined" viewport="mobile" compact />
      </aside>
      <nav v-if="!isEditingPage" class="step-nav" aria-label="Editor steps">
        <button class="nav-btn back" type="button" :disabled="isPublishing" @click="handleBack"><UiIcon name="ArrowLeft" :size="18" />{{ wizard.currentStep === 1 ? 'Cancel' : 'Back' }}</button>
        <button v-if="wizard.currentStep < wizard.totalSteps" class="nav-btn next" type="button" :disabled="!wizard.canProceed || isPublishing" @click="handleNext">{{ wizard.currentStep === wizard.totalSteps - 1 ? 'Choose a look' : 'Next' }}<UiIcon name="ArrowRight" :size="18" /></button>
        <button v-else class="nav-btn next" type="button" :disabled="isPublishing || wizard.isCheckingUsername" @click="handlePublish">{{ isPublishing ? 'Publishing…' : 'Publish now' }}<UiIcon name="Send" :size="18" /></button>
      </nav>
    </main>
    <AppDialog :open="stepsOpen" aria-label="All editor steps" close-on-backdrop @close="stepsOpen = false">
      <section class="wizard-dialog-panel wizard-jump-list"><header><h2>All steps</h2><button type="button" class="wizard-icon-button" aria-label="Close step list" @click="stepsOpen = false"><UiIcon name="X" :size="20" /></button></header>
        <nav aria-label="Choose an editor step"><button v-for="(step, index) in wizard.steps" :key="step.id" type="button" :aria-current="index + 1 === wizard.currentStep ? 'step' : undefined" @click="handleStepJump(index + 1)"><UiIcon v-if="index + 1 < wizard.currentStep" name="CircleCheck" :size="18" /><span v-else class="wizard-jump-number">{{ index + 1 }}</span><span>{{ step.name }}</span><small v-if="index + 1 === wizard.currentStep">You’re here</small></button></nav>
        <p>Turn features on or off in Features to change the steps.</p>
      </section>
    </AppDialog>
    <AppDialog :open="previewOpen" aria-label="Preview of your site" close-on-backdrop @close="previewOpen = false">
      <section class="wizard-dialog-panel wizard-preview-dialog"><header><h2>Preview</h2><div class="wizard-preview-viewport" role="group" aria-label="Preview width"><button v-for="viewport in ['mobile', 'desktop'] as const" :key="viewport" type="button" :aria-label="`${viewport === 'mobile' ? 'Mobile' : 'Desktop'} preview`" :aria-pressed="previewViewport === viewport" @click="previewViewport = viewport"><UiIcon :name="viewport === 'mobile' ? 'Smartphone' : 'Monitor'" :size="18" /></button></div><button type="button" class="wizard-icon-button" aria-label="Close preview" @click="previewOpen = false"><UiIcon name="X" :size="20" /></button></header>
        <GeneratedSitePreview :active-view="previewActiveView || undefined" :viewport="previewViewport" compact />
      </section>
    </AppDialog>
  </div>
</template>

<style scoped>
.wizard-page { min-height: calc(100dvh - var(--app-topbar-height)); padding-bottom: 110px; box-sizing: border-box; }
.wizard-header { position: sticky; top: var(--app-topbar-height); z-index: 45; display: flex; align-items: center; gap: 8px; max-width: 1120px; margin: auto; padding: 10px 16px; box-sizing: border-box; background: var(--ui-bg); }
.wizard-icon-button { display: grid; place-items: center; flex: 0 0 auto; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; color: var(--ui-text); background: transparent; cursor: pointer; }
.wizard-step-button { display: grid; justify-items: center; flex: 1; min-width: 0; min-height: 44px; gap: 3px; border: 0; background: transparent; color: var(--ui-text); font: inherit; cursor: pointer; }
.step-name { display: flex; align-items: center; gap: 4px; font-size: 16px; font-weight: 600; }
.wizard-step-button small { font-size: 12px; color: var(--ui-text-muted); }
.wizard-publish { min-height: 44px; padding: 0 4px; border: 0; background: transparent; color: var(--ui-accent-strong); font: 600 14px var(--font-sans); cursor: pointer; }
.wizard-progress { display: flex; gap: 4px; max-width: 1120px; margin: 0 auto 10px; padding: 0 16px; box-sizing: border-box; }
.wizard-progress span { flex: 1; height: 3px; border-radius: 2px; background: var(--ui-surface-muted); }
.wizard-progress .filled { background: var(--ui-accent-strong); }
.wizard-main { display: grid; grid-template-columns: minmax(0, 520px) minmax(0, 430px); justify-content: center; align-items: start; gap: 40px; max-width: 1120px; margin: 24px auto; padding: 0 24px; }
.step-content { min-width: 0; }
.step-content :deep(h2) { margin: 2px 0 8px; color: var(--ui-text); font-size: 24px; line-height: 1.2; font-weight: 600; letter-spacing: -.02em; }
.step-content :deep(.section-desc), .step-content :deep(.step-desc) { margin: 0 0 20px; font-size: 15px; line-height: 1.45; color: var(--ui-text-muted); }
.step-content :deep(input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']):not([type='file'])), .step-content :deep(textarea), .step-content :deep(select), .step-content :deep(.booking-offer-description-editor), .step-content :deep(.handle-input) { box-sizing: border-box; border: 0; border-radius: 14px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 16px; }
.step-content :deep(input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']):not([type='file'])), .step-content :deep(textarea), .step-content :deep(select) { padding: 13px 14px; }
.step-content :deep(.handle-input input) { background: transparent; }
.step-content :deep(.form-group > label), .step-content :deep(.section-label) { color: var(--ui-text-muted); font-size: 13px; font-weight: 500; }
.step-content :deep(.form-group) { margin-bottom: 16px; }
.step-content :deep(.btn.primary), .step-content :deep(.setting-action.primary) { border: 0; background: var(--ui-primary); color: var(--ui-primary-contrast); }
.step-content :deep(.btn.secondary) { border: 0; background: var(--ui-surface-muted); color: var(--ui-text); }
.step-content :deep(input:focus-visible), .step-content :deep(select:focus-visible), .step-content :deep(textarea:focus-visible), .step-content :deep(.booking-offer-description-editor:focus-within) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.step-content :deep(.visibility-group) { padding: 12px 16px; border: 0; border-radius: 18px; box-shadow: var(--ui-shadow-sm); background: var(--ui-surface); }
.preview-panel { position: sticky; top: calc(var(--app-topbar-height) + 90px); min-width: 0; overflow: hidden; }
.preview-panel :deep(.generated-site-preview) { width: 100%; height: min(680px, calc(100dvh - 230px)); min-height: 240px; border: 0; border-radius: 24px; box-shadow: var(--ui-shadow-md); }
.wizard-preview-label { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 13px; color: var(--ui-text-muted); }
.wizard-preview-label button { margin-left: auto; min-height: 32px; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.step-nav { position: fixed; bottom: 0; left: 50%; z-index: 44; display: flex; align-items: center; gap: 12px; width: min(620px, 100%); padding: 22px 16px max(24px, env(safe-area-inset-bottom)); box-sizing: border-box; transform: translateX(-50%); background: linear-gradient(transparent, var(--ui-bg) 30%); }
.nav-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; padding: 10px 22px; border: 0; border-radius: 26px; font: 600 16px var(--font-sans); cursor: pointer; }
.nav-btn.back { background: transparent; color: var(--ui-text-muted); }.nav-btn.next { flex: 1; background: var(--ui-primary); color: var(--ui-primary-contrast); }
button:disabled { opacity: .45; cursor: not-allowed; } button:focus-visible, a:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.wizard-publish-error, .wizard-publish-status { max-width: 960px; margin: 16px auto; padding: 0 16px; font-size: 14px; }.wizard-publish-error { color: var(--ui-danger); }.wizard-publish-error a { display: block; color: inherit; }
.draft-recovery-banner { display: flex; align-items: center; gap: 12px; max-width: 960px; margin: 16px auto; padding: 16px; border-radius: 18px; background: var(--ui-surface-muted); font-size: 14px; }.draft-recovery-banner p { margin: 4px 0 0; }.draft-recovery-banner button { min-height: 44px; border: 0; background: transparent; color: var(--ui-text); font: inherit; cursor: pointer; }
.wizard-intro { max-width: 960px; margin: 40px auto; padding: 24px; }.intro-panel { display: flex; align-items: center; gap: 40px; }.intro-image { width: 42%; max-width: 360px; border-radius: 24px; }.intro-copy { flex: 1; }.intro-copy h1 { font-size: 32px; font-weight: 600; }.intro-copy p { color: var(--ui-text-muted); font-size: 16px; line-height: 1.5; }.intro-button { min-height: 48px; border: 0; border-radius: 24px; padding: 12px 24px; background: var(--ui-primary); color: var(--ui-primary-contrast); font: 600 16px var(--font-sans); cursor: pointer; }
.wizard-dialog-panel { width: min(560px, 100%); margin: auto; padding: 20px; box-sizing: border-box; border-radius: 24px; background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.wizard-dialog-panel header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }.wizard-dialog-panel h2 { flex: 1; margin: 0; font-size: 20px; font-weight: 600; }
.wizard-jump-list nav { display: grid; max-height: min(65dvh, 600px); overflow: auto; }.wizard-jump-list nav button { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-text); font: 500 15px var(--font-sans); text-align: left; cursor: pointer; }
.wizard-jump-list [aria-current='step'] { background: var(--ui-surface-muted); font-weight: 600; }.wizard-jump-list small { margin-left: auto; color: var(--ui-text-muted); font-weight: 400; }.wizard-jump-list p { margin: 16px 0 0; color: var(--ui-text-muted); font-size: 13px; }.wizard-jump-number { display: grid; place-items: center; width: 18px; font-variant-numeric: tabular-nums; color: var(--ui-text-muted); }
.wizard-preview-dialog { width: min(960px, 100%); }.wizard-preview-dialog :deep(.generated-site-preview) { width: 100%; height: min(65dvh, 640px); border: 0; border-radius: 18px; }.wizard-preview-viewport { display: flex; gap: 2px; padding: 3px; background: var(--ui-surface-muted); border-radius: 24px; }.wizard-preview-viewport button { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text-muted); cursor: pointer; }.wizard-preview-viewport [aria-pressed='true'] { background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.wizard-finish { display: grid; justify-items: center; gap: 16px; max-width: 620px; margin: 60px auto; padding: 0 16px; text-align: center; }.wizard-finish h1 { margin: 0; font-size: 28px; font-weight: 600; }.wizard-finish > p { margin: 0; color: var(--ui-text-muted); }.wizard-finish__check { color: var(--ui-accent-strong); }.wizard-copy-link { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 10px 16px; border: 0; border-radius: 24px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; overflow-wrap: anywhere; cursor: pointer; }
.wizard-finish__preview { width: 100%; }.wizard-finish__preview :deep(.generated-site-preview) { height: 330px; border: 0; border-radius: 24px; box-shadow: var(--ui-shadow-sm); }.wizard-finish__actions { display: flex; align-items: center; gap: 12px; width: 100%; }.wizard-finish__actions a { display: flex; align-items: center; justify-content: center; gap: 8px; flex: 1; min-height: 50px; border-radius: 26px; background: var(--ui-surface-muted); color: var(--ui-text); text-decoration: none; font-weight: 600; }
@media(max-width:900px) {
  .wizard-main { grid-template-columns: minmax(0, 620px); margin: 18px auto; gap: 20px; padding: 0 16px; }
  .preview-panel { display: none; position: static; }.wizard-main--inline-preview .preview-panel { display: block; grid-row: 1; }
  .wizard-main--inline-preview .preview-panel :deep(.generated-site-preview) { height: 170px; min-height: 170px; border-radius: 20px; }
  .wizard-header { padding: 8px 12px; gap: 4px; }.wizard-progress { padding-inline: 16px; }.wizard-step-button { gap: 2px; }.wizard-step-button .step-name { font-size: 15px; }
  .intro-panel { flex-direction: column; gap: 20px; }.intro-image { width: min(100%, 320px); }.intro-copy h1 { font-size: 28px; }.wizard-intro { margin: 12px auto; padding: 16px; }
  .wizard-finish { margin-top: 36px; }
}
@media(prefers-reduced-motion:reduce) { *, *::before, *::after { transition: none; animation: none; scroll-behavior: auto; } }

.step-content :deep(.booking-offer-description-editor__surface) { border: 0; border-radius: 14px; background: var(--ui-surface-muted); }
.step-content :deep(.booking-offer-description-editor__toolbar) { padding: 4px; gap: 2px; }
.step-content :deep(.booking-offer-description-editor__btn) { border: 0; background: transparent; border-radius: 12px; color: var(--ui-text-muted); }
.step-content :deep(.handle-prefix) { border: 0; background: transparent; }
</style>

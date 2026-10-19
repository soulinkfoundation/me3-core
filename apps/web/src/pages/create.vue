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
import AppPageBar from "../components/AppPageBar.vue";
import GeneratedSitePreview from "../components/GeneratedSitePreview.vue";
import PageLoading from "../components/PageLoading.vue";
import AppDialog from "../components/AppDialog.vue";
import UiIcon from "../components/UiIcon.vue";
import Button from "../components/Button.vue";
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
const { toastSuccess, toastFromUnknown, toastError } = useAppToast();
const stepsOpen = ref(false);
const previewOpen = ref(false);
const previewViewport = ref<"mobile" | "desktop">("mobile");
const published = ref(false);
const publishedSiteUrl = ref("");
const publishValidationError = ref("");
watch([publishError, publishValidationError], ([error, validation]) => {
  if ((error || validation) && !publishNeedsStorage.value) toastError(error || validation);
});
const siteIsPublic = computed(() => wizard.siteRole === "organization" || wizard.profile.visibility === "public");
// The live bar stays while the owner moves between steps and clears once they change something again.
watch(() => wizard.needsPublish, (needsPublish) => { if (needsPublish) published.value = false; });
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

// Round step dots: visited steps jump straight back; later steps stay locked.
const progressSteps = computed(() =>
  wizard.steps.map((step, index) => {
    const number = index + 1;
    const isCurrent = number === wizard.currentStep;
    const isVisited = number <= wizard.furthestStep;
    return {
      id: step.id,
      name: step.name,
      number,
      isCurrent,
      isVisited,
      ariaLabel: isCurrent
        ? `Current step: ${step.name}`
        : isVisited
          ? `Go to ${step.name}`
          : `${step.name} unlocks after the earlier steps`,
    };
  }),
);
const progressFill = computed(() =>
  wizard.totalSteps > 1 ? ((wizard.currentStep - 1) / (wizard.totalSteps - 1)) * 100 : 0,
);

function handleProgressStepClick(step: { number: number; isVisited: boolean; isCurrent: boolean }) {
  if (!step.isVisited || step.isCurrent) return;
  handleStepJump(step.number);
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
    void router.replace("/mission?focus=goals");
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
  const success = await publish({ openSite: false });
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
      void router.replace("/mission?focus=goals");
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
// One getter per param: a single getter returning a fresh array would fire on every route change,
// including the step sync on Next/Back, and reopen the wizard.
watch(
  [
    () => route.query.siteId,
    () => route.query.site,
    () => route.query.new,
    () => route.query.siteRole,
  ],
  () => {
    if (wizardMounted) void openWizardTarget();
  },
);
</script>

<template>
  <PageLoading v-if="isOpeningWizard" :label="openingLabel" />
  <div v-else class="wizard-page">
    <template v-if="!showIntroScreen">
      <!-- Step selector and preview sit in the app top bar, beside Home, instead of a second header row. -->
      <Teleport to="#app-page-controls" defer>
        <div class="wizard-topbar">
          <button type="button" class="wizard-step-button" :aria-label="`Step ${wizard.currentStep} of ${wizard.totalSteps}: ${wizard.currentStepName}. Show all steps`" aria-haspopup="dialog" :aria-expanded="stepsOpen" @click="stepsOpen = true"><span class="step-count">{{ wizard.currentStep }}<span>/</span>{{ wizard.totalSteps }}</span><span class="step-name">{{ wizard.currentStepName }}<UiIcon name="ChevronDown" :size="15" /></span></button>
          <Button color="ghost" size="large" icon-only class="wizard-icon-button" aria-label="Preview your site" @click="previewOpen = true"><UiIcon name="Eye" :size="20" /></Button>
        </div>
      </Teleport>
      <header class="wizard-header">
        <nav class="progress-bar" aria-label="Editor steps">
          <div class="progress-track" aria-hidden="true"><div class="progress-fill" :style="{ width: `${progressFill}%` }" /></div>
          <div class="progress-steps" :style="{ gridTemplateColumns: `repeat(${wizard.totalSteps}, minmax(0, 1fr))` }">
            <button v-for="step in progressSteps" :key="step.id" type="button" class="progress-step" :class="{ 'is-current': step.isCurrent, 'is-visited': step.isVisited }" :data-step-name="step.name" :aria-label="step.ariaLabel" :aria-current="step.isCurrent ? 'step' : undefined" :disabled="!step.isVisited" @click="handleProgressStepClick(step)">
              <span class="progress-step-dot" aria-hidden="true"><span v-if="step.isCurrent" class="progress-step-core" /><UiIcon v-else-if="step.isVisited" name="Check" :size="11" /></span>
              <span class="progress-step-tooltip" aria-hidden="true">{{ step.name }}</span>
            </button>
          </div>
        </nav>
      </header>
      <section v-if="published" class="wizard-live" role="status" aria-label="Published">
        <UiIcon name="CircleCheck" :size="22" class="wizard-live__check" aria-hidden="true" />
        <div class="wizard-live__text">
          <strong>{{ siteIsPublic ? "You’re live" : "Your site is saved" }}</strong>
          <button v-if="siteIsPublic" type="button" class="wizard-copy-link" aria-label="Copy site link" @click="copySiteLink">{{ publishedSiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') }}<UiIcon name="Copy" :size="15" /></button>
          <span v-else>Your profile is private. Make it public in Basics when you’re ready to share it.</span>
        </div>
        <a v-if="siteIsPublic" class="wizard-live__view" :href="publishedSiteUrl" target="_blank" rel="noopener noreferrer"><UiIcon name="ExternalLink" :size="16" />View site</a>
        <RouterLink v-else class="wizard-live__view" :to="`/sites/${encodeURIComponent(wizard.username)}`">View site</RouterLink>
      </section>
      <div v-if="showImportedDraftRecovery" class="draft-recovery-banner"><div><strong>Imported draft saved locally.</strong><p>Imported from {{ importedDraftHost }}. Publish, keep editing or start over.</p></div><button type="button" @click="clearImportedDraft">Start over</button></div>
      <p v-if="publishProgress" class="wizard-publish-status" role="status">{{ publishProgress }}</p>
      <p v-if="publishNeedsStorage" class="wizard-publish-error" role="alert">{{ publishError }}<RouterLink to="/settings?section=storage">Activate storage</RouterLink></p>
    </template>
    <AppPageBar v-if="showIntroScreen" title="Website" />
    <main v-if="showIntroScreen" class="wizard-intro">
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


    <main v-if="!showIntroScreen" class="wizard-main" :class="{ 'wizard-main--inline-preview': inlinePreview }">
      <div class="step-content">
        <component :is="currentComponent" :key="`${wizard.draftContextId}:${wizard.currentStepId}`" ref="currentComponentRef" />
        <nav v-if="!isEditingPage" class="step-nav" aria-label="Step navigation">
          <Button class="nav-btn back" color="secondary" size="large" :disabled="isPublishing" @click="handleBack">{{ wizard.currentStep === 1 ? 'Cancel' : 'Back' }}</Button>
          <div class="step-nav__right">
            <Button v-if="wizard.needsPublish" class="nav-btn publish" color="primary" size="large" :disabled="isPublishing || wizard.isCheckingUsername" @click="handlePublish">{{ isPublishing ? 'Publishing…' : 'Publish' }}</Button>
            <Button v-if="wizard.currentStep < wizard.totalSteps" class="nav-btn next" color="neutral" size="large" :disabled="!wizard.canProceed || isPublishing" @click="handleNext">Next</Button>
          </div>
        </nav>
      </div>
      <aside v-if="showPreview" class="preview-panel" aria-label="Live site preview">
        <div class="wizard-preview-label"><UiIcon name="Eye" :size="15" />Live preview<button type="button" @click="previewOpen = true">Expand</button></div>
        <GeneratedSitePreview :active-view="previewActiveView || undefined" viewport="mobile" compact />
      </aside>
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
.wizard-page { min-height: calc(100dvh - var(--app-topbar-height)); padding-bottom: 48px; box-sizing: border-box; }
/* Step name and dots stay pinned under the app top bar while the form scrolls. */
.wizard-header { position: sticky; top: var(--app-topbar-height); z-index: 45; background: var(--ui-bg); }
.wizard-topbar { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.wizard-topbar .wizard-step-button { grid-column: 2; }
.wizard-icon-button { display: grid; place-items: center; flex: 0 0 auto; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; color: var(--ui-text); background: transparent; cursor: pointer; }
.wizard-step-button { display: flex; align-items: center; justify-content: center; gap: 10px; min-width: 0; min-height: 44px; border: 0; background: transparent; color: var(--ui-text); font: inherit; cursor: pointer; }
.step-count { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }.step-count span { margin: 0 3px; color: var(--ui-text-muted); font-weight: 400; }
.step-name { display: flex; align-items: center; gap: 4px; overflow: hidden; color: var(--ui-text-muted); font-size: 14px; font-weight: 500; white-space: nowrap; }
.progress-bar { position: relative; max-width: 1120px; margin: 0 auto; padding: 4px 24px 8px; box-sizing: border-box; }
.progress-track { position: absolute; top: 25px; right: 40px; left: 40px; height: 3px; border-radius: 999px; background: var(--ui-border); }
.progress-fill { height: 100%; border-radius: inherit; background: var(--ui-accent); transition: width .3s ease; }
.progress-steps { position: relative; display: grid; align-items: center; }
.progress-step { position: relative; display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 0; border: 0; background: none; color: var(--ui-text-muted); cursor: pointer; }
.progress-step:disabled, .progress-step.is-current { cursor: default; opacity: 1; }
.progress-step-dot { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; box-sizing: border-box; border: 2px solid var(--ui-border-strong, var(--ui-border)); border-radius: 999px; background: var(--ui-bg); transition: transform .2s ease, box-shadow .2s ease; }
.progress-step.is-visited .progress-step-dot { border-color: var(--ui-accent); background: var(--ui-accent); color: var(--ui-accent-contrast, #fff); }
.progress-step.is-current .progress-step-dot { width: 22px; height: 22px; background: var(--ui-bg); color: var(--ui-accent); box-shadow: 0 0 0 4px var(--ui-accent-soft); }
.progress-step.is-visited:not(.is-current):hover .progress-step-dot { transform: translateY(-1px); }
.progress-step:focus-visible { outline: none; }.progress-step:focus-visible .progress-step-dot { box-shadow: 0 0 0 4px var(--ui-accent-soft); }
.progress-step-core { width: 8px; height: 8px; border-radius: 999px; background: currentColor; }
.progress-step-tooltip { position: absolute; top: calc(100% + 4px); left: 50%; z-index: 2; padding: 6px 10px; border-radius: 999px; background: var(--ui-text); color: var(--ui-bg); font-size: 12px; font-weight: 600; line-height: 1; white-space: nowrap; opacity: 0; pointer-events: none; transform: translate(-50%, -4px); transition: opacity .18s ease, transform .18s ease; }
.progress-step:hover .progress-step-tooltip, .progress-step:focus-visible .progress-step-tooltip { opacity: 1; transform: translate(-50%, 0); }
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
/* A legend sits on a fieldset's top border by default; float it so the title stays inside the card. */
.step-content :deep(.visibility-group legend) { float: left; width: 100%; }
.step-content :deep(.visibility-group .visibility-checkbox) { clear: both; }
/* The @handle wrapper clips its input, so the focus ring goes on the wrapper rather than showing as a sliver. */
.step-content :deep(.handle-input input:focus-visible) { outline: none; }
.step-content :deep(.handle-input:focus-within) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.preview-panel { position: sticky; top: calc(var(--app-topbar-height) + 76px); min-width: 0; overflow: hidden; }
.preview-panel :deep(.generated-site-preview) { width: 100%; height: min(680px, calc(100dvh - 230px)); min-height: 240px; border: 0; border-radius: 24px; box-shadow: var(--ui-shadow-md); }
.wizard-preview-label { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 13px; color: var(--ui-text-muted); }
.wizard-preview-label button { margin-left: auto; min-height: 32px; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.step-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 40px; }
.step-nav__right { display: flex; align-items: center; gap: 12px; }
.nav-btn { min-height: 48px; padding: 0 28px; font: 600 15px var(--font-sans); }
button:disabled { opacity: .45; cursor: not-allowed; } button:focus-visible, a:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.wizard-publish-error, .wizard-publish-status { max-width: 960px; margin: 16px auto; padding: 0 16px; font-size: 14px; }.wizard-publish-error { color: var(--ui-danger); }.wizard-publish-error a { display: block; color: inherit; }
.draft-recovery-banner { display: flex; align-items: center; gap: 12px; max-width: 960px; margin: 16px auto; padding: 16px; border-radius: 18px; background: var(--ui-surface-muted); font-size: 14px; }.draft-recovery-banner p { margin: 4px 0 0; }.draft-recovery-banner button { min-height: 44px; border: 0; background: transparent; color: var(--ui-text); font: inherit; cursor: pointer; }
.wizard-intro { max-width: 960px; margin: 40px auto; padding: 24px; }.intro-panel { display: flex; align-items: center; gap: 40px; }.intro-image { width: 42%; max-width: 360px; border-radius: 24px; }.intro-copy { flex: 1; }.intro-copy h1 { font-size: 32px; font-weight: 600; }.intro-copy p { color: var(--ui-text-muted); font-size: 16px; line-height: 1.5; }.intro-button { min-height: 48px; border: 0; border-radius: 24px; padding: 12px 24px; background: var(--ui-primary); color: var(--ui-primary-contrast); font: 600 16px var(--font-sans); cursor: pointer; }
.wizard-dialog-panel { width: min(560px, 100%); margin: auto; padding: 20px; box-sizing: border-box; border-radius: 24px; background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.wizard-dialog-panel header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }.wizard-dialog-panel h2 { flex: 1; margin: 0; font-size: 20px; font-weight: 600; }
.wizard-jump-list nav { display: grid; max-height: min(65dvh, 600px); overflow: auto; }.wizard-jump-list nav button { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-text); font: 500 15px var(--font-sans); text-align: left; cursor: pointer; }
.wizard-jump-list [aria-current='step'] { background: var(--ui-surface-muted); font-weight: 600; }.wizard-jump-list small { margin-left: auto; color: var(--ui-text-muted); font-weight: 400; }.wizard-jump-list p { margin: 16px 0 0; color: var(--ui-text-muted); font-size: 13px; }.wizard-jump-number { display: grid; place-items: center; width: 18px; font-variant-numeric: tabular-nums; color: var(--ui-text-muted); }
.wizard-preview-dialog { width: min(960px, 100%); }.wizard-preview-dialog :deep(.generated-site-preview) { width: 100%; height: min(65dvh, 640px); border: 0; border-radius: 18px; }.wizard-preview-viewport { display: flex; gap: 2px; padding: 3px; background: var(--ui-surface-muted); border-radius: 24px; }.wizard-preview-viewport button { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text-muted); cursor: pointer; }.wizard-preview-viewport [aria-pressed='true'] { background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.wizard-live { display: flex; align-items: center; gap: 12px; max-width: 960px; margin: 16px auto 0; padding: 10px 12px 10px 16px; box-sizing: border-box; border-radius: 18px; background: var(--ui-surface-muted); }.wizard-live__check { flex: 0 0 auto; color: var(--ui-accent-strong); }
.wizard-live__text { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; flex: 1; min-width: 0; font-size: 14px; }.wizard-live__text strong { font-size: 15px; font-weight: 600; }.wizard-live__text span { color: var(--ui-text-muted); }
.wizard-copy-link { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px 12px; border: 0; border-radius: 18px; background: var(--ui-surface); color: var(--ui-text); font: inherit; overflow-wrap: anywhere; text-align: left; cursor: pointer; }
.wizard-live__view { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 44px; padding: 0 16px; border-radius: 22px; background: var(--ui-surface); color: var(--ui-text); text-decoration: none; font-weight: 600; font-size: 14px; }
@media(max-width:900px) {
  .wizard-main { grid-template-columns: minmax(0, 620px); margin: 18px auto; gap: 20px; padding: 0 16px; }
  .preview-panel { display: none; position: static; }.wizard-main--inline-preview .preview-panel { display: block; grid-row: 1; }
  .wizard-main--inline-preview .preview-panel :deep(.generated-site-preview) { height: 170px; min-height: 170px; border-radius: 20px; }
  .wizard-topbar { grid-template-columns: minmax(0, 1fr) 44px; }.wizard-topbar .wizard-step-button { grid-column: 1; justify-content: flex-start; }.progress-bar { padding-inline: 12px; }.progress-track { right: 24px; left: 24px; }
  .progress-step-dot { width: 14px; height: 14px; }.progress-step.is-current .progress-step-dot { width: 18px; height: 18px; }.progress-step-tooltip { display: none; }
  .step-nav { padding-top: 28px; }.nav-btn { padding: 0 20px; }
  .intro-panel { flex-direction: column; gap: 20px; }.intro-image { width: min(100%, 320px); }.intro-copy h1 { font-size: 28px; }.wizard-intro { margin: 12px auto; padding: 16px; }
  .wizard-live { margin: 12px 16px 0; align-items: flex-start; }.wizard-live__check { margin-top: 8px; }.wizard-live__view { padding: 0 12px; }
}
@media(prefers-reduced-motion:reduce) { *, *::before, *::after { transition: none; animation: none; scroll-behavior: auto; } }

.step-content :deep(.booking-offer-description-editor__surface) { border: 0; border-radius: 14px; background: var(--ui-surface-muted); }
.step-content :deep(.booking-offer-description-editor__toolbar) { padding: 4px; gap: 2px; }
.step-content :deep(.booking-offer-description-editor__btn) { border: 0; background: transparent; border-radius: 12px; color: var(--ui-text-muted); }
.step-content :deep(.handle-prefix) { border: 0; background: transparent; }
</style>

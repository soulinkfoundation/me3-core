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
import WizardPublish from "../components/wizard/WizardPublish.vue";

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
const { isPublishing: isQuickPublishing, publish } = usePublish();
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
  isAdditionalSite.value ? "Create a new site" : "Create your ME3 Profile",
);
const openingLabel = computed(() =>
  isAdditionalSite.value ? "Opening your site..." : "Opening your ME3 Profile...",
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
  publish: WizardPublish,
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
  if (currentComponent.value === WizardTestimonials) {
    if (wizard.testimonialsPlacement === "standalone") {
      return wizard.testimonialsPath;
    }
    if (wizard.testimonialsPlacement === "blog") {
      return wizard.blogPath;
    }
    if (wizard.testimonialsPlacement === "shop") {
      return wizard.shopPath;
    }
    if (wizard.testimonialsPlacement.startsWith("page:")) {
      return wizard.testimonialsPlacement.slice("page:".length) || null;
    }
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

// Progress percentage
const progress = computed(
  () => ((wizard.currentStep - 1) / (wizard.totalSteps - 1)) * 100,
);

const progressSteps = computed(() =>
  wizard.stepNames.map((name, index) => {
    const number = index + 1;
    const isCurrent = number === wizard.currentStep;
    const isVisited = number <= wizard.furthestStep;

    return {
      name,
      number,
      isCurrent,
      isVisited,
      isJumpable: isVisited && !isCurrent,
      title: isCurrent
        ? `${name} (current step)`
        : isVisited
          ? `Go to ${name}`
          : `${name} is locked until you complete the earlier steps`,
      ariaLabel: isCurrent
        ? `Current step: ${name}`
        : isVisited
          ? `Go to ${name}`
          : `${name} is locked until you complete the earlier steps`,
    };
  }),
);

// Show preview on larger screens
const showPreview = computed(
  () =>
    !showIntroScreen.value &&
    wizard.currentStep < wizard.totalSteps &&
    wizard.currentStepId !== "goals",
);

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
}

function applyRouteStep() {
  const step = typeof route.query.step === "string" ? route.query.step : "";
  if (!step) return;
  if (step === "wheel-of-life" || step === "wheel") {
    void router.replace("/journal/wheel-of-life");
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

function handleProgressStepClick(stepNumber: number, isVisited: boolean) {
  if (!isVisited) return;
  handleStepJump(stepNumber);
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

async function handleQuickPublish() {
  await publish({ openSite: false });
}

function clearImportedDraft() {
  wizard.reset();
  router.push("/sites");
}

let wizardOpenRequest = 0;
let wizardMounted = false;

async function openWizardTarget() {
  if (route.query.step === "wheel-of-life" || route.query.step === "wheel") {
    await router.replace("/journal/wheel-of-life");
    return;
  }
  const requestId = ++wizardOpenRequest;
  let openedExistingSite = false;
  isOpeningWizard.value = true;
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
    <!-- Header -->
    <header v-if="!showIntroScreen" class="wizard-header">
      <div class="header-center">
        <div class="step-indicator">
          <span class="step-current">{{ wizard.currentStep }}</span>
          <span class="step-divider">/</span>
          <span class="step-total">{{ wizard.totalSteps }}</span>
          <span class="step-name">{{ wizard.currentStepName }}</span>
        </div>
      </div>

      <div class="header-right">
        <button
          class="exit-btn"
          type="button"
          @click="handleExit"
          :title="
            (wizard.username || wizard.profile.handle || '').trim().length >= 3
              ? 'Back to site'
              : 'Back to dashboard'
          "
        >
          Exit
        </button>
      </div>
    </header>

    <!-- Progress bar -->
    <div
      v-if="!showIntroScreen"
      class="progress-bar"
      role="navigation"
      aria-label="Wizard progress"
    >
      <div class="progress-track" aria-hidden="true">
        <div class="progress-fill" :style="{ width: `${progress}%` }" />
      </div>

      <div
        class="progress-steps"
        :style="{
          gridTemplateColumns: `repeat(${wizard.totalSteps}, minmax(0, 1fr))`,
        }"
      >
        <button
          v-for="step in progressSteps"
          :key="step.name"
          type="button"
          class="progress-step"
          :class="{
            'is-current': step.isCurrent,
            'is-visited': step.isVisited,
            'is-jumpable': step.isJumpable,
          }"
          :data-step-name="step.name"
          :aria-label="step.ariaLabel"
          :aria-current="step.isCurrent ? 'step' : undefined"
          :disabled="!step.isVisited"
          @click="handleProgressStepClick(step.number, step.isVisited)"
        >
          <span class="progress-step-dot" aria-hidden="true">
            <span v-if="step.isCurrent" class="progress-step-core" />
            <span v-else-if="step.isVisited" class="progress-step-check"
              >✓</span
            >
          </span>
          <span class="progress-step-tooltip" aria-hidden="true">
            {{ step.name }}
          </span>
        </button>
      </div>

      <div v-if="showImportedDraftRecovery" class="draft-recovery-banner">
        <div class="draft-recovery-copy">
          <strong>Imported draft saved locally.</strong>
          <span>
            We imported your site from
            {{ importedDraftHost }}. You can publish, keep editing or start
            over.
          </span>
        </div>
        <button
          class="draft-recovery-button"
          type="button"
          @click="clearImportedDraft"
        >
          Start over
        </button>
      </div>
    </div>

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
            Your ME3 profile includes everything you might need for an effective
            website, it's also important context for your ME3 agent.
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

    <!-- Main content -->
    <main v-else class="wizard-main">
      <!-- Step content -->
      <div
        class="step-content"
        :class="{ 'publish-step': wizard.currentStep === wizard.totalSteps }"
      >
        <component
          :is="currentComponent"
          :key="`${wizard.draftContextId}:${wizard.currentStepId}`"
          ref="currentComponentRef"
        />

        <!-- Navigation -->
        <div v-if="!isEditingPage" class="step-nav">
          <button class="nav-btn back" type="button" @click="handleBack">
            {{ wizard.currentStep === 1 ? "← Exit" : "← Back" }}
          </button>

          <div class="nav-actions-right">
            <!-- Quick Publish button - only for existing sites with unpublished changes -->
            <button
              v-if="
                wizard.lastPublishedAt &&
                wizard.needsPublish &&
                wizard.currentStep < wizard.totalSteps
              "
              class="nav-btn publish-quick"
              type="button"
              :disabled="isQuickPublishing"
              @click="handleQuickPublish"
            >
              {{ isQuickPublishing ? "Publishing..." : "Publish" }}
            </button>

            <button
              v-if="wizard.currentStep < wizard.totalSteps"
              class="nav-btn next"
              type="button"
              :disabled="!wizard.canProceed"
              @click="handleNext"
            >
              {{
                wizard.currentStep === wizard.totalSteps - 1
                  ? "Review →"
                  : "Next →"
              }}
            </button>
          </div>
        </div>
      </div>

      <!-- Preview panel -->
      <div v-if="showPreview" class="preview-panel">
        <GeneratedSitePreview
          :active-view="previewActiveView || undefined"
          compact
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.wizard-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.wizard-header {
  display: grid;
  grid-template-columns: 1fr minmax(0, auto) 1fr;
  align-items: center;
  padding: 16px 24px;
}

.header-center {
  grid-column: 2;
  justify-self: center;
  display: flex;
  justify-content: center;
}

.header-right {
  grid-column: 3;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: var(--color-text);
}

.logo-img {
  display: block;
  height: 28px;
  width: auto;
}

.step-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.step-current {
  font-weight: 700;
  color: var(--color-text);
}

.step-divider,
.step-total {
  color: var(--color-text-muted);
}

.step-name {
  color: var(--color-text-muted);
  margin-left: 8px;
}

.exit-btn {
  background: var(--color-border);
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  cursor: pointer;
  min-height: 44px;
  padding: 6px 14px;
  border-radius: 999px;
  margin-right: 4px;
}

.exit-btn:hover {
  background: var(--color-text-muted);
  color: var(--color-bg);
}

/* Progress bar */
.progress-bar {
  position: relative;
  padding: 10px 24px 6px;
}

.progress-track {
  position: absolute;
  left: 40px;
  right: 40px;
  top: 31px;
  height: 3px;
  background: var(--color-border);
  border-radius: 999px;
}

.progress-fill {
  height: 100%;
  background: var(--color-text);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.progress-steps {
  position: relative;
  display: grid;
  align-items: center;
}

.progress-step {
  position: relative;
  min-height: 44px;
  padding: 8px 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: default;
}

.progress-step.is-jumpable {
  cursor: pointer;
}

.progress-step:disabled {
  cursor: default;
}

.progress-step-dot {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 2px solid currentColor;
  background: var(--color-bg);
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.progress-step.is-visited .progress-step-dot {
  color: var(--color-text);
}

.progress-step.is-visited:not(.is-current) .progress-step-dot {
  background: var(--color-text);
  color: var(--color-bg);
  border-color: var(--color-text);
}

.progress-step.is-current .progress-step-dot {
  width: 22px;
  height: 22px;
  border-color: var(--color-text);
  color: var(--color-text);
  box-shadow: 0 0 0 4px var(--color-border);
}

.progress-step.is-jumpable:hover .progress-step-dot {
  transform: translateY(-1px);
}

.progress-step:focus-visible {
  outline: none;
}

.progress-step:focus-visible .progress-step-dot {
  box-shadow: 0 0 0 4px var(--color-border);
}

.progress-step-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translate(-50%, 8px);
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--color-text);
  color: var(--color-bg);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  z-index: 2;
}

.progress-step-tooltip::after {
  content: "";
  position: absolute;
  left: 50%;
  top: calc(100% - 2px);
  width: 8px;
  height: 8px;
  background: var(--color-text);
  transform: translateX(-50%) rotate(45deg);
}

.progress-step:hover .progress-step-tooltip,
.progress-step:focus-visible .progress-step-tooltip {
  opacity: 1;
  transform: translate(-50%, 0);
}

.progress-step-core {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
}

.progress-step-check {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

/* Main */
.wizard-intro {
  flex: 1;
  display: grid;
  place-items: center;
  width: 100%;
  padding: 40px 24px;
}

.intro-panel {
  width: min(100%, 550px);
  display: grid;
  justify-items: center;
  gap: 24px;
  text-align: center;
}

.intro-image {
  display: block;
  width: min(68vw, 270px);
  height: min(68vw, 270px);
  object-fit: cover;
  border-radius: 50%;
  box-shadow: var(--ui-shadow-md, 0 22px 70px rgba(15, 23, 42, 0.14));
}

.intro-copy {
  display: grid;
  justify-items: center;
  gap: 18px;
}

.intro-copy h1 {
  margin: 0;
  color: var(--ui-text, var(--color-text));
  font-size: clamp(34px, 4.6vw, 48px);
  line-height: 1;
  letter-spacing: 0;
}

.intro-copy p {
  max-width: 550px;
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 17px;
  line-height: 1.55;
}

.intro-copy a {
  color: var(--ui-text, var(--color-text));
  font-weight: 700;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}

.intro-button {
  min-width: 150px;
  padding: 14px 24px;
  border: 0;
  border-radius: var(--ui-radius-md, 10px);
  background: var(--ui-text, var(--color-text));
  color: var(--ui-bg, var(--color-bg));
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.intro-button:hover {
  transform: translateY(-1px);
  opacity: 0.92;
}

.wizard-main {
  flex: 1;
  display: flex;
  gap: 20px;
  padding: 40px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.step-content {
  flex: 1;
  display: flex;
  max-width: 680px;
  flex-direction: column;
}

.step-content.publish-step {
  max-width: 600px;
  margin: 0 auto;
}

.step-nav {
  display: flex;
  justify-content: space-between;
  padding-top: 40px;
}

.step-content.publish-step .step-nav {
  max-width: 600px;
  margin: 0 auto;
}

.nav-btn {
  padding: 14px 28px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-btn.back {
  background: var(--color-border);
  color: var(--color-text);
}

.nav-btn.back:hover {
  background: var(--color-text-muted);
  color: var(--color-bg);
}

.nav-btn.next {
  background: var(--color-text);
  color: var(--color-bg);
}

.nav-btn.next:hover:not(:disabled) {
  opacity: 0.9;
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-actions-right {
  display: flex;
  gap: 12px;
}

.nav-btn.publish-quick {
  background: transparent;
  border: 2px solid var(--color-text);
  color: var(--color-text);
}

.nav-btn.publish-quick:hover:not(:disabled) {
  background: var(--color-text);
  color: var(--color-bg);
}

/* Preview panel */
.preview-panel {
  flex-shrink: 0;
  position: sticky;
  top: 40px;
  align-self: flex-start;
  margin: 0 auto;
  width: 400px;
}

/* Draft recovery banner */
.draft-recovery-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin: 16px 24px 0;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid rgba(59, 130, 246, 0.22);
  background: rgba(59, 130, 246, 0.08);
  color: var(--color-text);
}

.draft-recovery-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
  line-height: 1.45;
}

.draft-recovery-copy strong {
  font-size: 14px;
}

.draft-recovery-button {
  flex-shrink: 0;
  padding: 10px 14px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.draft-recovery-button:hover {
  background: rgba(59, 130, 246, 0.06);
}

/* Responsive */
@media (max-width: 900px) {
  .wizard-main {
    flex-direction: column;
    padding: 24px;
  }

  .step-content {
    max-width: 100%;
  }

  .preview-panel {
    display: none;
  }
}

@media (max-width: 640px) {
  .wizard-header {
    padding: 14px 16px;
  }

  .step-indicator {
    font-size: 13px;
  }

  .step-name {
    display: none;
  }

  .progress-bar {
    padding: 8px 14px 4px;
  }

  .progress-track {
    left: 26px;
    right: 26px;
    top: 27px;
  }

  .progress-step-dot {
    width: 16px;
    height: 16px;
  }

  .progress-step.is-current .progress-step-dot {
    width: 20px;
    height: 20px;
  }

  .progress-step-tooltip {
    display: none;
  }

  .wizard-intro {
    padding: 28px 18px;
  }

  .intro-panel {
    gap: 22px;
  }

  .intro-image {
    width: min(70vw, 230px);
    height: min(70vw, 230px);
  }

  .intro-copy h1 {
    font-size: 34px;
  }

  .intro-copy p {
    font-size: 16px;
  }
}
</style>

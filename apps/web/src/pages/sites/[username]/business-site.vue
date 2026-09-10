<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute, useRouter } from "vue-router";
import {
  getLandingPageValidationErrors,
  getSelectableLandingPageDesignPacks,
  type BusinessSiteDocumentV1,
  type LandingPageActionKind,
  type LandingPageDocumentV3,
  type LandingPageTemplateId,
  type LandingPageV3Section,
} from "@me3-core/plugin-landing-pages";
import { API_BASE, api } from "../../../api";
import SiteEventFields from "../../../components/SiteEventFields.vue";
import Button from "../../../components/Button.vue";
import TiptapEditor from "../../../components/TiptapEditor.vue";
import UiIcon from "../../../components/UiIcon.vue";
import { useAppToast } from "../../../composables/useAppToast";
import { useSitesStore, type SitePage } from "../../../stores/sites";

definePage({
  meta: {
    requiresAuth: true,
    requiresPlugin: "me3.landing-pages",
    title: "Business Site Builder | ME3",
    description: "Build and publish a structured multi-page Business Site.",
    robots: "noindex,follow",
  },
});

type BusinessSiteRevisionSummary = {
  id: string;
  createdAt: string;
  pageCount: number;
};

type BusinessSitePageSummary = Omit<SitePage, "document">;

type BusinessSiteResponse = {
  document: BusinessSiteDocumentV1;
  pages: BusinessSitePageSummary[];
  revisions: BusinessSiteRevisionSummary[];
  profile: { id: string; username: string; published_at: string | null } | null;
  publishedAt: string | null;
  publicUrl: string;
};

const wizardSteps = [
  { id: "details", name: "Site details" },
  { id: "pages", name: "Pages" },
  { id: "navigation", name: "Navigation" },
  { id: "theme", name: "Theme" },
  { id: "footer", name: "Footer" },
  { id: "review", name: "Review" },
] as const;

const route = useRoute();
const router = useRouter();
const sites = useSitesStore();
const { toastError, toastSuccess } = useAppToast();
const username = computed(() => route.params.username as string);
const document = ref<BusinessSiteDocumentV1 | null>(null);
const pages = ref<BusinessSitePageSummary[]>([]);
const revisions = ref<BusinessSiteRevisionSummary[]>([]);
const representedProfile = ref<BusinessSiteResponse["profile"]>(null);
const selectedPageId = ref("");
const selectedPageDraft = ref<LandingPageDocumentV3 | null>(null);
const selectedSectionId = ref("");
const selectedPageName = ref("");
const customSeo = ref(false);
const previewHtml = ref("");
const publicUrl = ref("");
const publishedAt = ref<string | null>(null);
const loading = ref(true);
const pageLoading = ref(false);
const busy = ref(false);
const blockingError = ref("");
const savedSiteSnapshot = ref("");
const savedPageSnapshot = ref("");
const currentStepIndex = ref(0);
const newPageOpen = ref(false);
const newPageTitle = ref("");
const newPageSlug = ref("");
const newPageBrief = ref("");
const newPageError = ref("");
const newPageTemplate = ref<LandingPageTemplateId>("service");
const designPacks = getSelectableLandingPageDesignPacks();

const profileSites = computed(() =>
  sites.sites.filter((site) => site.site_role === "profile"),
);
const currentStep = computed(() => wizardSteps[currentStepIndex.value]);
const progress = computed(() =>
  wizardSteps.length <= 1
    ? 100
    : (currentStepIndex.value / (wizardSteps.length - 1)) * 100,
);
const siteDirty = computed(
  () => !!document.value && JSON.stringify(document.value) !== savedSiteSnapshot.value,
);
const pageDirty = computed(
  () =>
    !!selectedPageDraft.value &&
    JSON.stringify(selectedPageDraft.value) !== savedPageSnapshot.value,
);
const isDirty = computed(() => siteDirty.value || pageDirty.value);
const selectedPage = computed(
  () => pages.value.find((page) => page.id === selectedPageId.value) || null,
);
const selectedSection = computed(() =>
  selectedPageDraft.value?.content.sections.find(
    (section) => section.id === selectedSectionId.value,
  ),
);
const primaryAction = computed(() =>
  selectedPageDraft.value?.actions.find(
    (action) => action.id === selectedPageDraft.value?.hero.primaryActionId,
  ),
);
const orderedPages = computed(() => {
  if (!document.value) return pages.value;
  const rank = new Map(
    document.value.navigation.items
      .filter((item) => item.pageSlug)
      .map((item, index) => [item.pageSlug, index]),
  );
  return [...pages.value].sort(
    (a, b) => (rank.get(a.slug) ?? 999) - (rank.get(b.slug) ?? 999),
  );
});
const visibleNavigationCount = computed(
  () => document.value?.navigation.items.filter((item) => item.visible).length || 0,
);
const selectedDesignPackName = computed(() =>
  designPacks.find((pack) => pack.id === document.value?.design.packId)?.name,
);
const previewEndpoint = computed(() =>
  selectedPage.value
    ? `${API_BASE}/sites/${encodeURIComponent(username.value)}/business-site/pages/${encodeURIComponent(selectedPage.value.id)}/preview-html`
    : "",
);
const automaticSeoTitle = computed(
  () =>
    (selectedPage.value?.slug === document.value?.homepageSlug
      ? document.value?.name.trim()
      : selectedPageName.value.trim()) ||
    selectedPage.value?.title ||
    "Untitled page",
);
const automaticSeoDescription = computed(() => {
  const intro = selectedPageDraft.value?.hero.subheadline.trim();
  if (intro) return intro.slice(0, 180);
  return document.value?.seo.description.trim().slice(0, 180) || "";
});
const pageValidationErrors = computed(() =>
  selectedPageDraft.value
    ? getLandingPageValidationErrors(selectedPageDraft.value)
    : [],
);

watch(
  [automaticSeoTitle, automaticSeoDescription],
  () => {
    if (!selectedPageDraft.value || customSeo.value) return;
    selectedPageDraft.value.seo.title = automaticSeoTitle.value;
    selectedPageDraft.value.seo.description = automaticSeoDescription.value;
  },
);

watch(selectedPageName, (name) => {
  const item = selectedPage.value ? navigationItem(selectedPage.value.slug) : undefined;
  if (item && name.trim()) item.label = name.trim();
});

function pageSummary(page: SitePage): BusinessSitePageSummary {
  const { document: _document, ...summary } = page;
  return summary;
}

function navigationItem(slug: string) {
  return document.value?.navigation.items.find((item) => item.pageSlug === slug);
}

function ensureNavigationItems() {
  if (!document.value) return;
  for (const page of pages.value) {
    if (navigationItem(page.slug)) continue;
    document.value.navigation.items.push({
      id: crypto.randomUUID(),
      label: page.title,
      pageSlug: page.slug,
      visible: true,
    });
  }
}

async function load() {
  loading.value = true;
  blockingError.value = "";
  try {
    if (!sites.sites.length) await sites.fetchSites();
    const response = await api.get<BusinessSiteResponse>(
      `/sites/${encodeURIComponent(username.value)}/business-site`,
    );
    document.value = structuredClone(response.document);
    document.value.design.customization ||= { accentColor: "#b66b46" };
    pages.value = response.pages;
    revisions.value = response.revisions;
    representedProfile.value = response.profile;
    publicUrl.value = response.publicUrl;
    publishedAt.value = response.publishedAt;
    ensureNavigationItems();
    savedSiteSnapshot.value = JSON.stringify(document.value);
    const requestedPage = String(route.query.page || "");
    selectedPageId.value =
      pages.value.find((page) => page.id === requestedPage)?.id ||
      pages.value.find((page) => page.slug === document.value?.homepageSlug)?.id ||
      pages.value[0]?.id ||
      "";
    if (selectedPageId.value) await loadSelectedPage(selectedPageId.value);
  } catch (caught) {
    blockingError.value =
      caught instanceof Error ? caught.message : "Could not load the Business Site.";
  } finally {
    loading.value = false;
  }
}

async function loadSelectedPage(pageId: string) {
  pageLoading.value = true;
  try {
    const record = await api.get<{ page: SitePage }>(
      `/sites/${encodeURIComponent(username.value)}/pages/${encodeURIComponent(pageId)}`,
    );
    selectedPageDraft.value = structuredClone(record.page.document);
    selectedPageDraft.value.hero.imageLayout ||= "split";
    selectedPageDraft.value.hero.showActions ??= true;
    selectedSectionId.value = selectedPageDraft.value.content.sections[0]?.id || "";
    selectedPageName.value = navigationItem(record.page.slug)?.label || record.page.title;
    const derivedTitle =
      (record.page.slug === document.value?.homepageSlug
        ? document.value?.name.trim()
        : selectedPageName.value.trim()) || record.page.title;
    const derivedDescription =
      selectedPageDraft.value.hero.subheadline.trim().slice(0, 180) ||
      document.value?.seo.description.trim().slice(0, 180) ||
      "";
    customSeo.value =
      selectedPageDraft.value.seo.title.trim() !== derivedTitle ||
      selectedPageDraft.value.seo.description.trim() !== derivedDescription;
    if (!customSeo.value) applyAutomaticSeo();
    savedPageSnapshot.value = JSON.stringify(selectedPageDraft.value);
    await refreshPreview();
  } catch (caught) {
    toastError(caught instanceof Error ? caught.message : "Could not load this page.");
  } finally {
    pageLoading.value = false;
  }
}

function applyAutomaticSeo() {
  if (!selectedPageDraft.value) return;
  selectedPageDraft.value.seo.title = automaticSeoTitle.value;
  selectedPageDraft.value.seo.description = automaticSeoDescription.value;
}

function handleCustomSeoChange() {
  if (!customSeo.value) applyAutomaticSeo();
}

async function save(options: { quiet?: boolean } = {}) {
  if (!document.value || busy.value) return false;
  busy.value = true;
  try {
    if (selectedPageDraft.value && selectedPage.value && pageDirty.value) {
      if (!customSeo.value) applyAutomaticSeo();
      selectedPageDraft.value.updatedAt = new Date().toISOString();
      const response = await api.put<{ page: SitePage }>(
        `/sites/${encodeURIComponent(username.value)}/pages/${encodeURIComponent(selectedPage.value.id)}`,
        { document: selectedPageDraft.value },
      );
      selectedPageDraft.value = structuredClone(response.page.document);
      savedPageSnapshot.value = JSON.stringify(selectedPageDraft.value);
      const index = pages.value.findIndex((page) => page.id === response.page.id);
      if (index >= 0) pages.value[index] = pageSummary(response.page);
    }
    if (siteDirty.value) {
      document.value.updatedAt = new Date().toISOString();
      const response = await api.put<{ document: BusinessSiteDocumentV1 }>(
        `/sites/${encodeURIComponent(username.value)}/business-site`,
        { document: document.value },
      );
      document.value = structuredClone(response.document);
      savedSiteSnapshot.value = JSON.stringify(document.value);
    }
    await refreshPreview();
    if (!options.quiet) toastSuccess("Business Site draft saved.");
    return true;
  } catch (caught) {
    toastError(caught instanceof Error ? caught.message : "Could not save the Business Site.");
    return false;
  } finally {
    busy.value = false;
  }
}

async function publish() {
  if (!(await save({ quiet: true }))) return;
  busy.value = true;
  try {
    const response = await api.post<{
      revisionId: string;
      publishedAt: string;
      publicUrl: string;
    }>(`/sites/${encodeURIComponent(username.value)}/business-site/publish`, {});
    publishedAt.value = response.publishedAt;
    publicUrl.value = response.publicUrl;
    await sites.fetchSites();
    await loadRevisions();
    toastSuccess("Business Site published.");
  } catch (caught) {
    toastError(caught instanceof Error ? caught.message : "Could not publish the Business Site.");
  } finally {
    busy.value = false;
  }
}

async function loadRevisions() {
  const response = await api.get<{ revisions: BusinessSiteRevisionSummary[] }>(
    `/sites/${encodeURIComponent(username.value)}/business-site/revisions`,
  );
  revisions.value = response.revisions;
}

async function restore(revisionId: string) {
  if (!window.confirm("Restore this published version as the current draft?")) return;
  busy.value = true;
  try {
    await api.post(
      `/sites/${encodeURIComponent(username.value)}/business-site/revisions/${revisionId}/restore`,
      {},
    );
    toastSuccess("Published version restored as a draft.");
    await load();
  } catch (caught) {
    toastError(caught instanceof Error ? caught.message : "Could not restore this version.");
  } finally {
    busy.value = false;
  }
}

async function refreshPreview() {
  if (!selectedPage.value) {
    previewHtml.value = "";
    return;
  }
  try {
    const response = await fetch(previewEndpoint.value, { credentials: "include" });
    if (response.ok) previewHtml.value = await response.text();
  } catch {
    // Keep the current preview visible when a refresh fails.
  }
}

async function selectPage(pageId: string) {
  newPageOpen.value = false;
  if (pageId === selectedPageId.value) return;
  if (pageDirty.value && !(await save({ quiet: true }))) return;
  selectedPageId.value = pageId;
  await router.replace({ query: { ...route.query, page: pageId } });
  await loadSelectedPage(pageId);
}

function handlePageTabKeydown(event: KeyboardEvent, index: number) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = Array.from(
    (event.currentTarget as HTMLElement)
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [],
  );
  if (!tabs.length) return;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function moveNavigation(slug: string, offset: -1 | 1) {
  if (!document.value) return;
  const linkedItems = document.value.navigation.items.filter((item) => item.pageSlug);
  const linkedIndex = linkedItems.findIndex((item) => item.pageSlug === slug);
  const targetItem = linkedItems[linkedIndex + offset];
  if (linkedIndex < 0 || !targetItem) return;
  const sourceIndex = document.value.navigation.items.findIndex((item) => item.pageSlug === slug);
  const targetIndex = document.value.navigation.items.findIndex((item) => item.id === targetItem.id);
  [document.value.navigation.items[sourceIndex], document.value.navigation.items[targetIndex]] = [
    document.value.navigation.items[targetIndex],
    document.value.navigation.items[sourceIndex],
  ];
}

async function createPage() {
  newPageError.value = "";
  if (!document.value || busy.value) return;
  if (!newPageTitle.value.trim() || !newPageSlug.value.trim() || !newPageBrief.value.trim()) {
    newPageError.value = "Add a page title, path, and short brief.";
    return;
  }
  if (pageDirty.value && !(await save({ quiet: true }))) return;
  busy.value = true;
  try {
    let response = await api.post<{ page: SitePage }>(
      `/sites/${encodeURIComponent(username.value)}/pages`,
      {
        slug: newPageSlug.value,
        brief: newPageBrief.value,
        templateId: newPageTemplate.value,
        designPackId: document.value.design.packId,
      },
    );
    response.page.document.seo.title = newPageTitle.value.trim();
    response.page.document.seo.description = response.page.document.hero.subheadline;
    response = await api.put<{ page: SitePage }>(
      `/sites/${encodeURIComponent(username.value)}/pages/${encodeURIComponent(response.page.id)}`,
      { document: response.page.document },
    );
    pages.value.push(pageSummary(response.page));
    document.value.navigation.items.push({
      id: crypto.randomUUID(),
      label: newPageTitle.value.trim(),
      pageSlug: response.page.slug,
      visible: true,
    });
    document.value.updatedAt = new Date().toISOString();
    const siteResponse = await api.put<{ document: BusinessSiteDocumentV1 }>(
      `/sites/${encodeURIComponent(username.value)}/business-site`,
      { document: document.value },
    );
    document.value = structuredClone(siteResponse.document);
    savedSiteSnapshot.value = JSON.stringify(document.value);
    selectedPageId.value = response.page.id;
    newPageOpen.value = false;
    newPageTitle.value = "";
    newPageSlug.value = "";
    newPageBrief.value = "";
    await router.replace({ query: { ...route.query, page: response.page.id } });
    await loadSelectedPage(response.page.id);
    toastSuccess("Page added and linked to navigation.");
  } catch (caught) {
    newPageError.value = caught instanceof Error ? caught.message : "Could not create the page.";
  } finally {
    busy.value = false;
  }
}

async function assignProfile(event: Event) {
  const profileSiteId = (event.target as HTMLSelectElement).value;
  if (!profileSiteId || busy.value) return;
  busy.value = true;
  try {
    await api.put(`/sites/${encodeURIComponent(username.value)}/profile-owner`, { profileSiteId });
    await sites.fetchSites();
    const profile = profileSites.value.find((candidate) => candidate.id === profileSiteId);
    representedProfile.value = {
      id: profileSiteId,
      username: profile?.username || "",
      published_at: profile?.published_at || null,
    };
    toastSuccess("Represented ME3 Profile updated.");
  } catch (caught) {
    toastError(caught instanceof Error ? caught.message : "Could not assign the profile.");
  } finally {
    busy.value = false;
  }
}

function setActionKind(kind: LandingPageActionKind) {
  if (!primaryAction.value) return;
  primaryAction.value.kind = kind;
  primaryAction.value.href = kind === "link" ? primaryAction.value.href || "https://" : undefined;
  primaryAction.value.resourceId = undefined;
  primaryAction.value.label =
    kind === "subscribe" ? "Join the list" : kind === "booking" ? "Book now" : kind === "product" ? "Buy now" : "Learn more";
}

function handleActionKindChange(event: Event) {
  setActionKind((event.target as HTMLSelectElement).value as LandingPageActionKind);
}

function moveSection(index: number, offset: -1 | 1) {
  if (!selectedPageDraft.value) return;
  const target = index + offset;
  if (target < 0 || target >= selectedPageDraft.value.content.sections.length) return;
  const sections = selectedPageDraft.value.content.sections;
  [sections[index], sections[target]] = [sections[target], sections[index]];
}

function removeSection(index: number) {
  if (!selectedPageDraft.value || selectedPageDraft.value.content.sections.length <= 1) return;
  const [removed] = selectedPageDraft.value.content.sections.splice(index, 1);
  if (removed.id === selectedSectionId.value) {
    selectedSectionId.value = selectedPageDraft.value.content.sections[Math.max(0, index - 1)]?.id || "";
  }
}

function duplicateSection(index: number) {
  if (!selectedPageDraft.value) return;
  const copy = structuredClone(selectedPageDraft.value.content.sections[index]);
  copy.id = `${copy.type}-${Date.now().toString(36)}`;
  copy.heading = `${copy.heading} copy`;
  selectedPageDraft.value.content.sections.splice(index + 1, 0, copy);
  selectedSectionId.value = copy.id;
}

function addSection(type: LandingPageV3Section["type"]) {
  if (!selectedPageDraft.value) return;
  const id = `${type}-${Date.now().toString(36)}`;
  let section: LandingPageV3Section;
  if (type === "feature-list") {
    section = { id, type, heading: "What to expect", items: [{ title: "A clear benefit", body: "Explain what this gives the visitor." }] };
  } else if (type === "faq") {
    section = { id, type, heading: "Questions", items: [{ question: "What should people know?", answer: "Add a useful answer." }] };
  } else if (type === "action") {
    section = { id, type, heading: "Take the next step", body: "Make the next action clear and low-friction.", actionId: selectedPageDraft.value.hero.primaryActionId };
  } else if (type === "details") {
    section = { id, type, heading: "Details", items: [{ label: "Detail", value: "Add information" }] };
  } else if (type === "steps") {
    section = { id, type, heading: "How it works", items: [{ title: "First step", body: "Explain what happens." }] };
  } else if (type === "profile") {
    section = { id, type, heading: "About", body: "Introduce the person behind this work." };
  } else if (type === "image-text") {
    section = { id, type, heading: "Image and text", body: "Add the important detail here.", image: "", imageAlt: "", imagePosition: "left" };
  } else if (type === "testimonials") {
    section = { id, type, heading: "What people say", items: [{ quote: "Add a specific, attributable quote.", name: "Customer name", role: "" }] };
  } else if (type === "team") {
    section = { id, type, heading: "Meet the team", items: [{ name: "Team member", role: "Role", bio: "Add a concise, credible biography.", image: null }] };
  } else if (type === "pricing") {
    section = { id, type, heading: "Services and pricing", items: [{ name: "Service", price: "From €0", description: "Explain what is included.", features: ["Included detail"] }] };
  } else if (type === "logo-row") {
    section = { id, type, heading: "Trusted by", items: [{ name: "Organization" }] };
  } else if (type === "collection") {
    section = { id, type, heading: "Explore", items: [{ title: "Item", body: "Describe this service, resource, or article.", href: "/" }] };
  } else if (type === "legal") {
    section = { id, type, heading: "Important information", body: "Add the required policy or disclaimer." };
  } else {
    section = { id, type, heading: "New section", body: "Add the important detail here." };
  }
  selectedPageDraft.value.content.sections.push(section);
  selectedSectionId.value = id;
}

async function uploadHero(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !selectedPageDraft.value) return;
  busy.value = true;
  const uploaded = await sites.uploadImage(username.value, file, "hero");
  busy.value = false;
  if (!uploaded) {
    toastError(sites.error || "Could not upload the image.");
    return;
  }
  selectedPageDraft.value.hero.image = uploaded.path;
  selectedPageDraft.value.assets.heroImage = uploaded.path;
  toastSuccess("Image ready. Save the draft to refresh the preview.");
}

function addFooterLink() {
  document.value?.footer.links.push({ id: crypto.randomUUID(), label: "New link", href: "/" });
}

function addRedirect() {
  document.value?.redirects.push({ id: crypto.randomUUID(), from: "/old-page", to: "/" });
}

async function goToStep(index: number) {
  if (index < 0 || index >= wizardSteps.length || index === currentStepIndex.value) return;
  if (isDirty.value && !(await save({ quiet: true }))) return;
  currentStepIndex.value = index;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function handleExit() {
  if (isDirty.value && !(await save({ quiet: true }))) return;
  await router.push(`/sites/${username.value}`);
}

onMounted(load);
</script>

<template>
  <div class="business-wizard">
    <header v-if="!loading" class="wizard-header">
      <div class="header-status" aria-live="polite">
        <span>{{ currentStepIndex + 1 }}</span><span aria-hidden="true">/</span><span>{{ wizardSteps.length }}</span>
        <strong>{{ currentStep.name }}</strong>
        <span class="draft-state">{{ isDirty ? "Unsaved draft" : publishedAt ? "Published" : "Draft" }}</span>
      </div>
      <button class="exit-button" type="button" @click="handleExit">Exit</button>
    </header>

    <nav v-if="!loading" class="wizard-progress" aria-label="Business Site builder progress">
      <div class="progress-track" aria-hidden="true"><span :style="{ width: `${progress}%` }" /></div>
      <div class="progress-steps" :style="{ gridTemplateColumns: `repeat(${wizardSteps.length}, minmax(0, 1fr))` }">
        <button v-for="(step, index) in wizardSteps" :key="step.id" type="button" class="progress-step" :class="{ current: index === currentStepIndex, complete: index < currentStepIndex }" :aria-current="index === currentStepIndex ? 'step' : undefined" :aria-label="`Go to ${step.name}`" @click="goToStep(index)">
          <span class="progress-dot" aria-hidden="true"><span v-if="index < currentStepIndex">✓</span><i v-else-if="index === currentStepIndex" /></span>
          <span class="progress-label">{{ step.name }}</span>
        </button>
      </div>
    </nav>

    <main v-if="document && !loading" class="wizard-main">
      <section class="step-content" :class="{ 'pages-step': currentStep.id === 'pages' }">
        <template v-if="currentStep.id === 'details'">
          <div class="step-heading"><h1>Tell us about this site</h1><p>These details identify the business and supply structured information automatically.</p></div>
          <div class="form-stack">
            <label>Site name<input v-model="document.name" autocomplete="organization" /></label>
            <label>Represented ME3 Profile<select :value="representedProfile?.id || ''" :disabled="busy" @change="assignProfile"><option v-for="profile in profileSites" :key="profile.id" :value="profile.id">@{{ profile.username }}</option></select></label>
            <p class="field-note">The linked profile owns identity and connected resources. This site owns presentation and navigation.</p>
            <label>Homepage<select v-model="document.homepageSlug"><option v-for="page in orderedPages" :key="page.id" :value="page.slug">{{ navigationItem(page.slug)?.label || page.title }}</option></select></label>
            <label>Business description<textarea v-model="document.organization.description" rows="4" /></label>
            <div class="two-column-fields"><label>Public email<input v-model="document.organization.email" type="email" autocomplete="email" /></label><label>Telephone<input v-model="document.organization.telephone" type="tel" autocomplete="tel" /></label></div>
            <label>Address<textarea v-model="document.organization.address" rows="3" autocomplete="street-address" /></label>
          </div>
        </template>

        <template v-else-if="currentStep.id === 'pages'">
          <div class="step-heading page-step-heading"><div><h1>Build your pages</h1><p>Only the selected page is loaded. Add sections and shape the content without leaving the wizard.</p></div><a v-if="selectedPage" :href="previewEndpoint" target="_blank" rel="noreferrer" class="mobile-preview-action"><UiIcon name="Monitor" :size="17" aria-hidden="true" /> Preview</a></div>

          <nav class="page-tabs" role="tablist" aria-label="Site pages">
            <button v-for="(page, index) in orderedPages" :id="`page-tab-${page.id}`" :key="page.id" type="button" role="tab" :aria-selected="!newPageOpen && selectedPageId === page.id" :aria-controls="`page-panel-${page.id}`" :tabindex="!newPageOpen && selectedPageId === page.id ? 0 : -1" :class="{ active: !newPageOpen && selectedPageId === page.id }" @click="selectPage(page.id)" @keydown="handlePageTabKeydown($event, index)">{{ navigationItem(page.slug)?.label || page.title }}</button>
            <button id="page-tab-add" class="add-page-tab" type="button" role="tab" aria-label="Add page" aria-controls="new-page-panel" :aria-selected="newPageOpen" :tabindex="newPageOpen ? 0 : -1" :class="{ active: newPageOpen }" @click="newPageOpen = !newPageOpen" @keydown="handlePageTabKeydown($event, orderedPages.length)"><UiIcon name="Plus" :size="18" aria-hidden="true" /></button>
          </nav>

          <form v-if="newPageOpen" id="new-page-panel" class="new-page-form" role="tabpanel" aria-labelledby="page-tab-add" @submit.prevent="createPage">
            <div class="new-page-heading"><strong>Add a page</strong><button type="button" aria-label="Close add page form" @click="newPageOpen = false">×</button></div>
            <div class="two-column-fields"><label>Page name<input v-model="newPageTitle" /></label><label>Path<input v-model="newPageSlug" placeholder="services" inputmode="url" /></label></div>
            <label>Page purpose<select v-model="newPageTemplate"><option value="service">Service or information</option><option value="event">Event</option><option value="waitlist">Signup or launch</option></select></label>
            <label>Brief<textarea v-model="newPageBrief" rows="3" placeholder="What should this page help a visitor understand or do?" /></label>
            <p v-if="newPageError" class="field-error" role="alert">{{ newPageError }}</p>
            <Button color="primary" shape="soft" size="compact" type="submit" :disabled="busy">Add page</Button>
          </form>

          <div v-if="!newPageOpen && pageLoading" class="page-loading" role="status">Loading page…</div>
          <div v-else-if="!newPageOpen && selectedPageDraft && selectedPage" :id="`page-panel-${selectedPage.id}`" class="page-editor" role="tabpanel" :aria-labelledby="`page-tab-${selectedPage.id}`">
            <section class="page-basics" aria-labelledby="page-content-title">
              <div class="section-heading-row"><div><h2 id="page-content-title">Page content</h2><p>/{{ selectedPage.slug }}</p></div><router-link :to="`/sites/${username}/pages/${selectedPage.id}`" class="quiet-link">Open full editor</router-link></div>
              <label>Page name<input v-model="selectedPageName" maxlength="70" /></label>
              <label>Headline<input v-model="selectedPageDraft.hero.headline" /></label>
              <label>Introduction<textarea v-model="selectedPageDraft.hero.subheadline" rows="4" /></label>
              <SiteEventFields v-model="selectedPageDraft.event" />
              <div class="two-column-fields"><label>Hero layout<select v-model="selectedPageDraft.hero.imageLayout"><option value="split">Split image panel</option><option value="background">Full-bleed background</option></select></label><label class="checkbox-field"><input v-model="selectedPageDraft.hero.showActions" type="checkbox" /> Show primary action</label></div>
              <label>Hero image<input type="file" accept="image/*" @change="uploadHero" /></label>
            </section>

            <section class="page-action" aria-labelledby="page-action-title">
              <h2 id="page-action-title">Primary action</h2>
              <div class="two-column-fields"><label>Action type<select :value="primaryAction?.kind" @change="handleActionKindChange"><option value="link">Link</option><option value="subscribe">Email signup</option><option value="booking">Booking</option><option value="product">Product payment</option></select></label><label v-if="primaryAction">Button label<input v-model="primaryAction.label" /></label></div>
              <label v-if="primaryAction?.kind === 'link'">Destination<input v-model="primaryAction.href" /></label>
              <p v-else class="field-note">Connected booking, product, and signup resources can be selected in the full editor.</p>
            </section>

            <section class="sections-workspace" aria-labelledby="sections-title">
              <div class="section-heading-row"><div><h2 id="sections-title">Sections</h2><p>{{ selectedPageDraft.content.sections.length }} on this page</p></div></div>
              <div class="section-layout">
                <aside class="section-outline" aria-label="Page sections">
                  <div v-for="(section, index) in selectedPageDraft.content.sections" :key="section.id" class="section-row" :class="{ active: selectedSectionId === section.id }">
                    <button type="button" class="section-select" @click="selectedSectionId = section.id"><span>{{ section.heading }}</span><small>{{ section.type }}</small></button>
                    <div class="section-tools"><button type="button" :disabled="index === 0" :aria-label="`Move ${section.heading} up`" @click="moveSection(index, -1)">↑</button><button type="button" :disabled="index === selectedPageDraft.content.sections.length - 1" :aria-label="`Move ${section.heading} down`" @click="moveSection(index, 1)">↓</button><button type="button" :aria-label="`Duplicate ${section.heading}`" @click="duplicateSection(index)">⧉</button><button type="button" :disabled="selectedPageDraft.content.sections.length <= 1" :aria-label="`Remove ${section.heading}`" @click="removeSection(index)">×</button></div>
                  </div>
                  <details class="add-section-menu"><summary><UiIcon name="Plus" :size="15" aria-hidden="true" /> Add section</summary><div><button type="button" @click="addSection('story')">Text</button><button type="button" @click="addSection('feature-list')">Features</button><button type="button" @click="addSection('image-text')">Image + text</button><button type="button" @click="addSection('steps')">Steps</button><button type="button" @click="addSection('faq')">FAQ</button><button type="button" @click="addSection('action')">Action</button><button type="button" @click="addSection('testimonials')">Testimonials</button><button type="button" @click="addSection('team')">Team</button><button type="button" @click="addSection('pricing')">Pricing</button><button type="button" @click="addSection('logo-row')">Logos</button><button type="button" @click="addSection('collection')">Collection</button><button type="button" @click="addSection('legal')">Legal</button></div></details>
                </aside>

                <div v-if="selectedSection" class="section-editor">
                  <div class="section-editor-heading"><h3>{{ selectedSection.heading }}</h3><span>{{ selectedSection.type }}</span></div>
                  <label>Section heading<input v-model="selectedSection.heading" /></label>
                  <div v-if="selectedSection.type === 'story' || selectedSection.type === 'profile' || selectedSection.type === 'action' || selectedSection.type === 'image-text' || selectedSection.type === 'legal'" class="rich-text-field"><span class="field-label">Body</span><TiptapEditor v-model="selectedSection.body" variant="section" placeholder="Write this section…" /></div>

                  <template v-if="selectedSection.type === 'image-text'"><label>Image URL<input v-model="selectedSection.image" /></label><label>Alternative text<input v-model="selectedSection.imageAlt" /></label><label>Image position<select v-model="selectedSection.imagePosition"><option value="left">Left</option><option value="right">Right</option></select></label></template>
                  <template v-if="selectedSection.type === 'feature-list' || selectedSection.type === 'steps'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row"><label>Title<input v-model="item.title" /></label><label>Copy<textarea v-model="item.body" rows="3" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div><button type="button" class="secondary-button" @click="selectedSection.items.push({ title: 'New point', body: 'Explain why it matters.' })">Add item</button></template>
                  <template v-if="selectedSection.type === 'details'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row compact"><label>Label<input v-model="item.label" /></label><label>Value<input v-model="item.value" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div></template>
                  <template v-if="selectedSection.type === 'faq'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row"><label>Question<input v-model="item.question" /></label><label>Answer<textarea v-model="item.answer" rows="3" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div><button type="button" class="secondary-button" @click="selectedSection.items.push({ question: 'New question', answer: 'Add the answer.' })">Add question</button></template>
                  <template v-if="selectedSection.type === 'testimonials'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row"><label>Quote<textarea v-model="item.quote" rows="3" /></label><label>Name<input v-model="item.name" /></label><label>Role<input v-model="item.role" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div><button type="button" class="secondary-button" @click="selectedSection.items.push({ quote: 'Add a specific quote.', name: 'Customer name' })">Add testimonial</button></template>
                  <template v-if="selectedSection.type === 'team'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row"><label>Name<input v-model="item.name" /></label><label>Role<input v-model="item.role" /></label><label>Biography<textarea v-model="item.bio" rows="3" /></label><label>Image URL<input v-model="item.image" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div><button type="button" class="secondary-button" @click="selectedSection.items.push({ name: 'Team member', role: 'Role', bio: 'Add a concise biography.', image: null })">Add team member</button></template>
                  <template v-if="selectedSection.type === 'pricing'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row"><label>Name<input v-model="item.name" /></label><label>Price<input v-model="item.price" /></label><label>Description<textarea v-model="item.description" rows="3" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div><button type="button" class="secondary-button" @click="selectedSection.items.push({ name: 'Service', price: 'From €0', description: 'Explain what is included.', features: [] })">Add price</button></template>
                  <template v-if="selectedSection.type === 'logo-row'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row compact"><label>Name<input v-model="item.name" /></label><label>Image URL<input v-model="item.image" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div><button type="button" class="secondary-button" @click="selectedSection.items.push({ name: 'Organization' })">Add logo</button></template>
                  <template v-if="selectedSection.type === 'collection'"><div v-for="(item, index) in selectedSection.items" :key="index" class="repeater-row"><label>Title<input v-model="item.title" /></label><label>Label<input v-model="item.label" /></label><label>Copy<textarea v-model="item.body" rows="3" /></label><label>Destination<input v-model="item.href" /></label><button type="button" @click="selectedSection.items.splice(index, 1)">Remove</button></div><button type="button" class="secondary-button" @click="selectedSection.items.push({ title: 'Item', body: 'Describe this item.' })">Add item</button></template>
                </div>
              </div>
            </section>

            <details class="advanced-settings"><summary>Advanced search preview <span>{{ customSeo ? "Custom" : "Automatic" }}</span></summary><div class="search-preview"><small>{{ publicUrl }}{{ selectedPage.slug === document.homepageSlug ? '' : `/${selectedPage.slug}/` }}</small><strong>{{ customSeo ? selectedPageDraft.seo.title : automaticSeoTitle }}<template v-if="document.seo.titleSuffix && !(customSeo ? selectedPageDraft.seo.title : automaticSeoTitle).toLowerCase().includes(document.seo.titleSuffix.toLowerCase())"> | {{ document.seo.titleSuffix }}</template></strong><p>{{ customSeo ? selectedPageDraft.seo.description : automaticSeoDescription }}</p></div><label class="checkbox-field"><input v-model="customSeo" type="checkbox" @change="handleCustomSeoChange" /> Override the automatic title and description</label><template v-if="customSeo"><label>Search title<input v-model="selectedPageDraft.seo.title" maxlength="70" /></label><label>Description<textarea v-model="selectedPageDraft.seo.description" maxlength="180" rows="3" /></label></template></details>
            <div v-if="pageValidationErrors.length" class="validation-panel" role="status"><strong>Before publishing</strong><ul><li v-for="message in pageValidationErrors" :key="message">{{ message }}</li></ul></div>
          </div>
          <div v-else-if="!newPageOpen" class="empty-state">Use the + tab to add the first page.</div>
        </template>

        <template v-else-if="currentStep.id === 'navigation'">
          <div class="step-heading"><h1>Shape the main menu</h1><p>Every page is linked automatically. Choose what appears, change its label, and set the order.</p></div>
          <div class="navigation-list"><div v-for="(page, index) in orderedPages" :key="page.id" class="navigation-row"><div class="navigation-copy"><strong>{{ navigationItem(page.slug)?.label || page.title }}</strong><span>/{{ page.slug }}</span></div><label class="navigation-label">Menu label<input v-model="navigationItem(page.slug)!.label" /></label><label class="visibility-toggle"><input v-model="navigationItem(page.slug)!.visible" type="checkbox" /><span>Show</span></label><div class="order-buttons"><button type="button" :disabled="index === 0" :aria-label="`Move ${navigationItem(page.slug)?.label || page.title} up`" @click="moveNavigation(page.slug, -1)">↑</button><button type="button" :disabled="index === orderedPages.length - 1" :aria-label="`Move ${navigationItem(page.slug)?.label || page.title} down`" @click="moveNavigation(page.slug, 1)">↓</button></div></div></div>
          <p class="field-note">Internal URLs come from the page path and cannot drift out of sync with navigation.</p>
        </template>

        <template v-else-if="currentStep.id === 'theme'">
          <div class="step-heading"><h1>Choose a theme</h1><p>The theme applies consistently across every page while content and structure stay portable.</p></div>
          <fieldset class="theme-list"><legend class="sr-only">Available themes</legend><label v-for="pack in designPacks" :key="pack.id" :class="{ selected: document.design.packId === pack.id }"><input v-model="document.design.packId" type="radio" name="site-theme" :value="pack.id" /><span><strong>{{ pack.name }}</strong><small>{{ pack.description }}</small><em>{{ pack.bestFor }}</em></span></label></fieldset>
          <label class="color-field">Accent colour<input v-model="document.design.customization!.accentColor" type="color" /></label>
        </template>

        <template v-else-if="currentStep.id === 'footer'">
          <div class="step-heading"><h1>Finish the footer</h1><p>Keep the closing information useful and concise across every page.</p></div>
          <div class="form-stack"><label>Footer note<textarea v-model="document.footer.note" rows="4" /></label><div class="section-heading-row"><h2>Footer links</h2><button type="button" class="quiet-link" @click="addFooterLink">Add link</button></div><div v-for="(link, index) in document.footer.links" :key="link.id" class="footer-link-row"><label>Label<input v-model="link.label" /></label><label>Destination<input v-model="link.href" /></label><button type="button" :aria-label="`Remove ${link.label}`" @click="document.footer.links.splice(index, 1)">Remove</button></div></div>
        </template>

        <template v-else>
          <div class="step-heading"><h1>Review and publish</h1><p>ME3 handles page metadata, sharing tags, structured business data, sitemap generation, and mobile navigation automatically.</p></div>
          <dl class="review-list"><div><dt>Site</dt><dd>{{ document.name }}</dd></div><div><dt>Pages</dt><dd>{{ pages.length }}</dd></div><div><dt>Menu links</dt><dd>{{ visibleNavigationCount }}</dd></div><div><dt>Theme</dt><dd>{{ selectedDesignPackName }}</dd></div><div><dt>Search</dt><dd>{{ document.seo.indexing === 'index' ? 'Ready for search engines' : 'Hidden from search engines' }}</dd></div></dl>
          <div class="review-actions"><Button color="primary" shape="soft" type="button" :disabled="busy || pages.length === 0" @click="publish">{{ busy ? "Publishing…" : publishedAt ? "Publish changes" : "Publish site" }}</Button><a v-if="publishedAt" :href="publicUrl" target="_blank" rel="noreferrer" class="secondary-button">Open live site</a></div>
          <details class="advanced-settings"><summary>Advanced site settings</summary><label>Search visibility<select v-model="document.seo.indexing"><option value="index">Allow indexing</option><option value="noindex">Keep out of search results</option></select></label><label>Default description<textarea v-model="document.seo.description" rows="3" /></label><div class="section-heading-row"><h2>Redirects</h2><button type="button" class="quiet-link" @click="addRedirect">Add redirect</button></div><div v-for="(redirect, index) in document.redirects" :key="redirect.id" class="footer-link-row"><label>Old path<input v-model="redirect.from" /></label><label>New destination<input v-model="redirect.to" /></label><button type="button" aria-label="Remove redirect" @click="document.redirects.splice(index, 1)">Remove</button></div></details>
          <details class="advanced-settings history-panel"><summary>Published history</summary><p v-if="!revisions.length">No published versions yet.</p><button v-for="revision in revisions" :key="revision.id" type="button" :disabled="busy" @click="restore(revision.id)">Restore {{ new Date(revision.createdAt).toLocaleString() }} · {{ revision.pageCount }} pages</button></details>
        </template>

        <footer class="step-navigation"><button class="back-button" type="button" @click="currentStepIndex === 0 ? handleExit() : goToStep(currentStepIndex - 1)">{{ currentStepIndex === 0 ? "← Exit" : "← Back" }}</button><div><Button color="neutral" shape="soft" size="compact" type="button" :disabled="busy || !isDirty" @click="save()">{{ busy ? "Working…" : "Save draft" }}</Button><Button v-if="currentStepIndex < wizardSteps.length - 1" color="primary" shape="soft" size="compact" type="button" :disabled="busy" @click="goToStep(currentStepIndex + 1)">Next →</Button></div></footer>
      </section>

      <aside class="preview-panel" aria-label="Selected page preview"><div class="preview-heading"><div><strong>Preview of {{ selectedPageName || document.name }}</strong><span>{{ selectedPage ? `/${selectedPage.slug}` : "Add a page to preview" }}</span></div><a v-if="selectedPage" :href="previewEndpoint" target="_blank" rel="noreferrer" aria-label="Open desktop preview" title="Open desktop preview"><UiIcon name="Monitor" :size="19" aria-hidden="true" /></a></div><iframe v-if="previewHtml" :srcdoc="previewHtml" :title="`${selectedPageName || document.name} preview`" /><div v-else class="preview-empty">Save or choose a page to see its preview.</div></aside>
    </main>
    <main v-else class="loading-state" role="status">{{ blockingError || "Loading Business Site…" }}</main>
  </div>
</template>

<style scoped>
.business-wizard{min-height:100vh;background:var(--ui-bg,var(--color-bg));color:var(--ui-text,var(--color-text))}.wizard-header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;min-height:72px;padding:10px 28px;border-bottom:1px solid var(--ui-border,var(--color-border))}.header-status{grid-column:2;display:flex;align-items:center;gap:7px;font-size:.88rem}.header-status strong{margin-left:7px}.draft-state{margin-left:10px;color:var(--ui-text-muted,var(--color-text-muted));font-size:.78rem}.exit-button{grid-column:3;justify-self:end;min-width:56px;min-height:44px;padding:0 14px;border:0;border-radius:999px;background:var(--ui-surface-muted,var(--color-bg-subtle));color:inherit;font:inherit;font-weight:700;cursor:pointer}.wizard-progress{position:relative;padding:10px 24px 6px;border-bottom:1px solid var(--ui-border,var(--color-border))}.progress-track{position:absolute;top:31px;left:calc(100% / 12);right:calc(100% / 12);height:3px;border-radius:999px;background:var(--ui-border,var(--color-border));overflow:hidden}.progress-track span{display:block;height:100%;border-radius:inherit;background:var(--ui-text,var(--color-text));transition:width .25s ease}.progress-steps{position:relative;display:grid}.progress-step{position:relative;display:flex;min-height:44px;align-items:center;justify-content:center;padding:8px 0;border:0;background:transparent;color:var(--ui-text-muted,var(--color-text-muted));font:inherit;cursor:pointer}.progress-dot{display:grid;width:18px;height:18px;place-items:center;border:2px solid currentColor;border-radius:999px;background:var(--ui-bg,var(--color-bg));font-size:.68rem}.progress-step.complete{color:var(--ui-text,var(--color-text))}.progress-step.complete .progress-dot{border-color:var(--ui-text,var(--color-text));background:var(--ui-text,var(--color-text));color:var(--ui-bg,var(--color-bg))}.progress-step.current{color:var(--ui-text,var(--color-text))}.progress-step.current .progress-dot{width:22px;height:22px;border-color:var(--ui-text,var(--color-text));box-shadow:0 0 0 4px var(--ui-border,var(--color-border))}.progress-step.current i{width:8px;height:8px;border-radius:50%;background:currentColor}.progress-label{position:absolute;top:38px;display:none;padding:5px 8px;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));font-size:.72rem;white-space:nowrap;box-shadow:var(--ui-shadow-sm,0 8px 20px rgba(0,0,0,.08));z-index:4}.progress-step:hover .progress-label,.progress-step:focus-visible .progress-label{display:block}.wizard-main{display:flex;width:min(1240px,100%);margin:0 auto;gap:48px;padding:40px 32px 64px}.step-content{width:min(100%,720px);min-width:0}.step-content.pages-step{width:min(100%,780px)}.step-heading{margin-bottom:32px}.step-heading h1{margin:0;font-size:clamp(1.8rem,3vw,2.35rem);line-height:1.08;letter-spacing:-.035em}.step-heading p{max-width:680px;margin:12px 0 0;color:var(--ui-text-muted,var(--color-text-muted));line-height:1.55}.page-step-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.form-stack,.page-basics,.page-action,.section-editor,.advanced-settings{display:grid;gap:16px}.form-stack label,.page-basics label,.page-action label,.section-editor label,.advanced-settings label,.footer-link-row label,.new-page-form label,.navigation-label{display:grid;gap:7px;font-weight:700}.form-stack input,.form-stack textarea,.form-stack select,.page-basics input,.page-basics textarea,.page-basics select,.page-action input,.page-action select,.section-editor input,.section-editor textarea,.section-editor select,.advanced-settings input,.advanced-settings textarea,.advanced-settings select,.footer-link-row input,.new-page-form input,.new-page-form textarea,.new-page-form select,.navigation-label input{width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--ui-border-strong,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:inherit;font:inherit}.two-column-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field-note{margin:0;color:var(--ui-text-muted,var(--color-text-muted));font-size:.9rem;line-height:1.5}.field-error{margin:0;color:var(--ui-danger,#b42318);font-size:.9rem}.checkbox-field{display:flex!important;min-height:46px;align-items:center;gap:10px}.checkbox-field input{width:20px!important;min-height:20px!important;margin:0}.page-tabs{display:flex;gap:2px;margin:0 0 24px;overflow-x:auto;border-bottom:1px solid var(--ui-border,var(--color-border));scrollbar-width:thin}.page-tabs button{flex:none;min-height:46px;padding:0 14px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--ui-text-muted,var(--color-text-muted));font:inherit;font-weight:700;cursor:pointer}.page-tabs button.active{border-bottom-color:var(--ui-accent,var(--color-accent));color:var(--ui-text,var(--color-text))}.page-tabs .add-page-tab{width:46px;padding:0;color:var(--ui-text,var(--color-text))}.new-page-form{display:grid;gap:14px;margin:-8px 0 26px;padding:20px;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-md,10px);background:var(--ui-surface-muted,var(--color-bg-subtle))}.new-page-heading,.section-heading-row,.section-editor-heading,.preview-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.new-page-heading>button{width:44px;height:44px;border:0;background:transparent;color:inherit;font-size:1.6rem;cursor:pointer}.page-loading,.empty-state{display:grid;min-height:260px;place-items:center;color:var(--ui-text-muted,var(--color-text-muted))}.page-editor{display:grid;gap:28px}.page-basics,.page-action,.sections-workspace{padding-bottom:28px;border-bottom:1px solid var(--ui-border,var(--color-border))}.page-basics h2,.page-action h2,.sections-workspace h2,.section-heading-row h2{margin:0;font-size:1.25rem}.section-heading-row p{margin:4px 0 0;color:var(--ui-text-muted,var(--color-text-muted));font-size:.85rem}.quiet-link{display:inline-flex;min-height:44px;align-items:center;padding:0;border:0;background:transparent;color:var(--ui-text,var(--color-text));font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.mobile-preview-action{display:none;min-height:44px;align-items:center;gap:7px;color:inherit;font-weight:700;text-decoration:none}.section-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;margin-top:20px}.section-outline{min-width:0}.section-row{display:grid;grid-template-columns:minmax(0,1fr) auto;border-bottom:1px solid var(--ui-border,var(--color-border))}.section-row.active{background:var(--ui-accent-soft,color-mix(in srgb,var(--ui-accent) 10%,transparent))}.section-select{display:grid;gap:3px;min-height:56px;padding:9px 10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.section-select span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}.section-select small,.section-editor-heading span{color:var(--ui-text-muted,var(--color-text-muted));font-size:.75rem}.section-tools{display:none;align-items:center}.section-row:hover .section-tools,.section-row:focus-within .section-tools{display:flex}.section-tools button{width:32px;min-height:40px;border:0;background:transparent;color:var(--ui-text-muted,var(--color-text-muted));cursor:pointer}.add-section-menu{margin-top:12px}.add-section-menu summary{display:flex;min-height:44px;align-items:center;gap:7px;font-weight:700;cursor:pointer}.add-section-menu>div{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding-top:8px}.add-section-menu button{min-height:38px;padding:0 8px;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:inherit;font:inherit;font-size:.78rem;cursor:pointer}.section-editor{min-width:0}.section-editor h3{margin:0;font-size:1.1rem}.field-label{font-weight:700}.rich-text-field{display:grid;gap:7px;min-width:0}.rich-text-field :deep(.editor-toolbar){position:static;border:1px solid var(--ui-border,var(--color-border));background:var(--ui-surface-muted,var(--color-bg-subtle))}.rich-text-field :deep(.editor-content-wrapper){min-height:170px;border:1px solid var(--ui-border-strong,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg))}.repeater-row{display:grid;gap:10px;padding:14px 0;border-bottom:1px dashed var(--ui-border,var(--color-border))}.repeater-row.compact{grid-template-columns:1fr 1fr auto;align-items:end}.repeater-row>button,.footer-link-row>button{min-height:40px;justify-self:start;border:0;background:transparent;color:var(--ui-danger,var(--color-danger,#b42318));font:inherit;font-weight:700;cursor:pointer}.secondary-button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;justify-self:start;padding:0 15px;border:1px solid var(--ui-border-strong,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:inherit;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.advanced-settings{padding:18px 0;border-bottom:1px solid var(--ui-border,var(--color-border))}.advanced-settings summary{min-height:44px;font-weight:700;cursor:pointer}.advanced-settings summary span{margin-left:8px;color:var(--ui-success,var(--color-success));font-size:.78rem}.search-preview{display:grid;gap:4px;padding:16px;border-left:3px solid var(--ui-accent,var(--color-accent));background:var(--ui-surface-muted,var(--color-bg-subtle))}.search-preview small{color:var(--ui-success,var(--color-success))}.search-preview strong{font-size:1.05rem}.search-preview p{margin:0;color:var(--ui-text-muted,var(--color-text-muted));line-height:1.45}.validation-panel{padding:16px;border:1px solid var(--ui-border-strong,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface-muted,var(--color-bg-subtle))}.validation-panel ul{margin:8px 0 0;padding-left:20px}.navigation-list{display:grid;border-top:1px solid var(--ui-border,var(--color-border))}.navigation-row{display:grid;grid-template-columns:minmax(140px,.8fr) minmax(180px,1.4fr) auto auto;align-items:end;gap:16px;padding:16px 0;border-bottom:1px solid var(--ui-border,var(--color-border))}.navigation-copy{display:grid;gap:3px;align-self:center}.navigation-copy span{color:var(--ui-text-muted,var(--color-text-muted));font-size:.8rem}.visibility-toggle{display:flex;min-height:46px;align-items:center;gap:8px;font-weight:700}.visibility-toggle input{width:20px;height:20px}.order-buttons{display:flex}.order-buttons button{width:44px;height:44px;border:0;background:transparent;color:inherit;font-size:1rem;cursor:pointer}.theme-list{display:grid;margin:0;padding:0;border:0;border-top:1px solid var(--ui-border,var(--color-border))}.theme-list label{display:grid;grid-template-columns:auto 1fr;gap:14px;padding:18px 4px;border-bottom:1px solid var(--ui-border,var(--color-border));cursor:pointer}.theme-list label.selected{background:var(--ui-accent-soft,color-mix(in srgb,var(--ui-accent) 10%,transparent))}.theme-list input{width:20px;height:20px;margin-top:2px;accent-color:var(--ui-accent,var(--color-accent))}.theme-list span{display:grid;gap:5px}.theme-list small,.theme-list em{color:var(--ui-text-muted,var(--color-text-muted));line-height:1.4}.theme-list em{font-size:.78rem}.color-field{display:flex;align-items:center;gap:16px;margin-top:24px;font-weight:700}.color-field input{width:62px;height:44px;padding:4px;border:1px solid var(--ui-border-strong,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg))}.footer-link-row{display:grid;grid-template-columns:1fr 1fr auto;align-items:end;gap:10px;padding:12px 0;border-bottom:1px solid var(--ui-border,var(--color-border))}.review-list{display:grid;margin:0;border-top:1px solid var(--ui-border,var(--color-border))}.review-list>div{display:grid;grid-template-columns:140px 1fr;gap:20px;padding:16px 0;border-bottom:1px solid var(--ui-border,var(--color-border))}.review-list dt{color:var(--ui-text-muted,var(--color-text-muted))}.review-list dd{margin:0;font-weight:700}.review-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.history-panel>button{display:block;width:100%;min-height:44px;border:0;border-bottom:1px solid var(--ui-border,var(--color-border));background:transparent;color:inherit;text-align:left;cursor:pointer}.step-navigation{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:42px;padding-top:22px;border-top:1px solid var(--ui-border,var(--color-border))}.step-navigation>div{display:flex;gap:10px}.back-button{min-height:44px;padding:0 8px;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer}.preview-panel{position:sticky;top:32px;align-self:flex-start;width:400px;height:min(760px,calc(100vh - 64px));padding:12px;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-lg,14px);background:var(--ui-surface-muted,var(--color-bg-subtle));box-shadow:var(--ui-shadow-md,0 18px 45px rgba(0,0,0,.08))}.preview-heading{height:52px;padding:0 4px}.preview-heading>div{display:grid;min-width:0}.preview-heading strong,.preview-heading span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-heading span{color:var(--ui-text-muted,var(--color-text-muted));font-size:.78rem}.preview-heading>a{display:grid;width:44px;height:44px;flex:none;place-items:center;border-radius:var(--ui-radius-sm,8px);color:inherit}.preview-panel iframe,.preview-empty{width:100%;height:calc(100% - 52px);border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-md,10px);background:#fff}.preview-empty{display:grid;place-items:center;padding:20px;text-align:center;color:var(--ui-text-muted,var(--color-text-muted))}.loading-state{display:grid;min-height:60vh;place-items:center}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--ui-focus,var(--ui-accent,var(--color-accent)));outline-offset:3px}button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:1120px){.wizard-main{gap:28px;padding-inline:24px}.preview-panel{width:350px}}@media(max-width:920px){.wizard-main{display:block}.step-content,.step-content.pages-step{width:min(100%,760px);margin:0 auto}.preview-panel{display:none}.mobile-preview-action{display:inline-flex}}@media(max-width:700px){.wizard-header{grid-template-columns:1fr auto;padding-inline:16px}.header-status{grid-column:1;justify-self:start}.draft-state{display:none}.exit-button{grid-column:2}.wizard-progress{padding-inline:12px}.progress-track{left:calc(100% / 12);right:calc(100% / 12)}.wizard-main{padding:28px 16px 48px}.two-column-fields,.section-layout,.navigation-row,.footer-link-row{grid-template-columns:1fr}.section-outline{border-bottom:1px solid var(--ui-border,var(--color-border));padding-bottom:18px}.section-tools{display:flex}.navigation-row{align-items:start}.visibility-toggle{min-height:32px}.footer-link-row>button{justify-self:start}.page-step-heading{display:block}.mobile-preview-action{margin-top:12px}.step-navigation{align-items:flex-end}.step-navigation>div{display:grid}.progress-label{display:none!important}}@media(max-width:480px){.header-status strong{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.page-tabs{margin-inline:-16px;padding-inline:16px}.step-navigation{display:grid}.step-navigation>div{grid-template-columns:1fr 1fr}.step-navigation>div>*{width:100%}.repeater-row.compact{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
.page-tabs .add-page-tab{position:sticky;right:0;z-index:2;border-left:1px solid var(--ui-border,var(--color-border));background:var(--ui-bg,var(--color-bg));box-shadow:-12px 0 14px var(--ui-bg,var(--color-bg))}
</style>

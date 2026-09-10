<script setup lang="ts">
import SiteEventFields from "../../../../components/SiteEventFields.vue";
import { computed, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute } from "vue-router";
import {
  getLandingPageValidationErrors,
  type LandingPageActionKind,
  type LandingPageDocumentV3,
  type LandingPageV3Section,
} from "@me3-core/plugin-landing-pages";
import { useSitesStore, type SitePageRevision } from "../../../../stores/sites";
import { resolvePublicSiteUrl } from "../../../../utils/publicSiteUrl";
import UiIcon from "../../../../components/UiIcon.vue";
import { API_BASE, api } from "../../../../api";
import { useAppToast } from "../../../../composables/useAppToast";

definePage({
  meta: {
    requiresAuth: true,
    requiresPlugin: "me3.landing-pages",
    title: "Page Builder | ME3",
    description: "Edit and publish a structured ME3 page.",
    robots: "noindex,follow",
  },
});

const route = useRoute();
const sites = useSitesStore();
const { toastSuccess } = useAppToast();
const username = computed(() => route.params.username as string);
const pageId = computed(() => route.params.pageId as string);
const page = computed(() => sites.sitePages.find((candidate) => candidate.id === pageId.value));
const currentSite = computed(() =>
  sites.sites.find((candidate) => candidate.username === username.value),
);
const isBusinessSite = computed(() => currentSite.value?.site_role === "organization");
const builderBackUrl = computed(() =>
  isBusinessSite.value
    ? `/sites/${username.value}/business-site`
    : `/sites/${username.value}`,
);
const draft = ref<LandingPageDocumentV3 | null>(null);
const previewHtml = ref("");
const activeSectionId = ref("");
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const liveUrl = ref("");
const revisions = ref<SitePageRevision[]>([]);
const bookingOffers = ref<Array<{ id: string; title: string; paid: boolean }>>([]);
const products = ref<Array<{ slug: string; title: string }>>([]);
const paymentsReady = ref(false);
const randomImageBusy = ref(false);
const businessHomepageSlug = ref("");

const activeSection = computed(() =>
  draft.value?.content.sections.find((section) => section.id === activeSectionId.value),
);
const primaryAction = computed(() =>
  draft.value?.actions.find((action) => action.id === draft.value?.hero.primaryActionId),
);
const validationErrors = computed(() =>
  draft.value ? getLandingPageValidationErrors(draft.value) : [],
);

async function load() {
  loading.value = true;
  error.value = "";
  await sites.ensureSites();
  const record = await sites.getSitePage(username.value, pageId.value);
  if (!record?.document) {
    error.value = sites.error || "Page not found.";
    loading.value = false;
    return;
  }
  draft.value = structuredClone(record.document);
  draft.value.hero.imageLayout ||= "split";
  draft.value.hero.showActions ??= true;
  activeSectionId.value = draft.value.content.sections[0]?.id || "";
  let base = await resolvePublicSiteUrl(username.value, currentSite.value);
  if (isBusinessSite.value) {
    try {
      const business = await api.get<{
        document: { homepageSlug: string };
        publicUrl: string;
      }>(
        `/sites/${encodeURIComponent(username.value)}/business-site`,
      );
      businessHomepageSlug.value = business.document.homepageSlug;
      base = business.publicUrl;
    } catch {
      businessHomepageSlug.value = "home";
    }
  }
  liveUrl.value =
    isBusinessSite.value && record.slug === businessHomepageSlug.value
      ? `${base.replace(/\/+$/, "")}/`
      : `${base.replace(/\/+$/, "")}/${record.slug}${isBusinessSite.value ? "/" : ""}`;
  await Promise.all([loadResources(), refreshPreview(), loadRevisions()]);
  loading.value = false;
}

async function loadResources() {
  const profileUsername = isBusinessSite.value
    ? sites.sites.find((site) => site.id === currentSite.value?.profile_site_id)?.username
    : username.value;
  const content = await sites.getSiteContent(profileUsername || username.value);
  if (!content?.profile) return;
  const book = content.profile.intents?.book as
    | {
        offers?: Array<{ id?: string; title?: string; pricing?: { enabled?: boolean } }>;
        bookingTypes?: Array<{
          offers?: Array<{ id?: string; title?: string; pricing?: { enabled?: boolean } }>;
        }>;
      }
    | undefined;
  const found = new Map<string, { title: string; paid: boolean }>();
  for (const offer of book?.offers || []) {
    if (offer.id) found.set(offer.id, { title: offer.title || offer.id, paid: offer.pricing?.enabled === true });
  }
  for (const type of book?.bookingTypes || []) {
    for (const offer of type.offers || []) {
      if (offer.id) found.set(offer.id, { title: offer.title || offer.id, paid: offer.pricing?.enabled === true });
    }
  }
  bookingOffers.value = [...found].map(([id, offer]) => ({ id, ...offer }));
  products.value = content.products
    .filter((product) => product.available !== false)
    .map((product) => ({ slug: product.slug, title: product.title }));
  try {
    const commerce = await api.get<{ stripe?: { configured?: boolean } }>(
      "/commerce/status",
    );
    paymentsReady.value = commerce.stripe?.configured === true;
  } catch {
    paymentsReady.value = false;
  }
}

async function refreshPreview() {
  if (isBusinessSite.value) {
    try {
      const response = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(username.value)}/business-site/pages/${encodeURIComponent(pageId.value)}/preview-html`,
        { credentials: "include" },
      );
      if (response.ok) previewHtml.value = await response.text();
    } catch {
      // The current preview remains visible when a refresh fails.
    }
    return;
  }
  const html = await sites.fetchSitePagePreview(username.value, pageId.value);
  if (html !== null) previewHtml.value = html;
}

async function loadRevisions() {
  revisions.value = await sites.getSitePageRevisions(username.value, pageId.value);
}

async function save(options: { quiet?: boolean } = {}) {
  if (!draft.value || busy.value) return false;
  busy.value = true;
  error.value = "";
  draft.value.updatedAt = new Date().toISOString();
  const saved = await sites.saveSitePage(username.value, pageId.value, draft.value);
  busy.value = false;
  if (!saved) {
    error.value = sites.error || "Could not save the page.";
    return false;
  }
  draft.value = structuredClone(saved.document);
  await refreshPreview();
  if (!options.quiet) toastSuccess("Draft saved.");
  return true;
}

async function publish() {
  if (!(await save({ quiet: true }))) return;
  if (validationErrors.value.length > 0) {
    error.value = validationErrors.value.join(" ");
    return;
  }
  busy.value = true;
  const published = isBusinessSite.value
    ? await api
        .post(`/sites/${encodeURIComponent(username.value)}/business-site/publish`, {})
        .then(() => sites.getSitePage(username.value, pageId.value))
        .catch((caught: unknown) => {
          error.value = caught instanceof Error ? caught.message : "Could not publish the site.";
          return null;
        })
    : await sites.publishSitePage(username.value, pageId.value);
  busy.value = false;
  if (!published) {
    error.value = sites.error || "Could not publish the page.";
    return;
  }
  toastSuccess(isBusinessSite.value ? "Business Site published." : "Page published.");
  await loadRevisions();
}

async function unpublish() {
  busy.value = true;
  const result = isBusinessSite.value
    ? await sites.unpublishLandingPage(username.value)
    : await sites.unpublishSitePage(username.value, pageId.value);
  busy.value = false;
  if (!result) {
    error.value = sites.error || "Could not unpublish the page.";
    return;
  }
  toastSuccess(isBusinessSite.value ? "Business Site unpublished. The draft is still here." : "Page unpublished. The draft is still here.");
}

async function restore(revisionId: string) {
  busy.value = true;
  const restored = await sites.restoreSitePageRevision(
    username.value,
    pageId.value,
    revisionId,
  );
  busy.value = false;
  if (!restored) {
    error.value = sites.error || "Could not restore this version.";
    return;
  }
  draft.value = structuredClone(restored.document);
  activeSectionId.value = draft.value.content.sections[0]?.id || "";
  await refreshPreview();
  toastSuccess("Previous version restored as the current draft.");
}

function setActionKind(kind: LandingPageActionKind) {
  if (!primaryAction.value) return;
  primaryAction.value.kind = kind;
  primaryAction.value.href = kind === "link" ? primaryAction.value.href || "https://" : undefined;
  primaryAction.value.resourceId = undefined;
  primaryAction.value.label =
    kind === "subscribe"
      ? "Join the list"
      : kind === "booking"
        ? "Book now"
        : kind === "product"
          ? "Buy now"
          : "Learn more";
}

function handleActionKindChange(event: Event) {
  setActionKind((event.target as HTMLSelectElement).value as LandingPageActionKind);
}

function moveSection(index: number, offset: -1 | 1) {
  if (!draft.value) return;
  const target = index + offset;
  if (target < 0 || target >= draft.value.content.sections.length) return;
  const sections = draft.value.content.sections;
  [sections[index], sections[target]] = [sections[target], sections[index]];
}

function removeSection(index: number) {
  if (!draft.value || draft.value.content.sections.length <= 1) return;
  const [removed] = draft.value.content.sections.splice(index, 1);
  if (removed.id === activeSectionId.value) {
    activeSectionId.value = draft.value.content.sections[Math.max(0, index - 1)]?.id || "";
  }
}

function duplicateSection(index: number) {
  if (!draft.value) return;
  const copy = structuredClone(draft.value.content.sections[index]);
  copy.id = `${copy.type}-${Date.now().toString(36)}`;
  copy.heading = `${copy.heading} copy`;
  draft.value.content.sections.splice(index + 1, 0, copy);
  activeSectionId.value = copy.id;
}

function addSection(type: LandingPageV3Section["type"]) {
  if (!draft.value) return;
  const id = `${type}-${Date.now().toString(36)}`;
  let section: LandingPageV3Section;
  if (type === "feature-list") {
    section = {
      id,
      type,
      heading: "What to expect",
      items: [{ title: "A clear benefit", body: "Explain what this gives the visitor." }],
    };
  } else if (type === "faq") {
    section = {
      id,
      type,
      heading: "Questions",
      items: [{ question: "What should people know?", answer: "Add a useful answer." }],
    };
  } else if (type === "action") {
    section = {
      id,
      type,
      heading: "Take the next step",
      body: "Make the next action clear and low-friction.",
      actionId: draft.value.hero.primaryActionId,
    };
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
  draft.value.content.sections.push(section);
  activeSectionId.value = id;
}

async function uploadHero(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !draft.value) return;
  busy.value = true;
  const uploaded = await sites.uploadImage(username.value, file, "hero");
  busy.value = false;
  if (!uploaded) {
    error.value = sites.error || "Could not upload the image.";
    return;
  }
  draft.value.hero.image = uploaded.path;
  draft.value.assets.heroImage = uploaded.path;
  toastSuccess("Image ready. Save the draft to update the preview.");
}

async function fetchWithTimeout(input: RequestInfo | URL, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function useRandomHero() {
  if (!draft.value || randomImageBusy.value) return;
  randomImageBusy.value = true;
  error.value = "";

  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const imageUrl = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1600/1000`;

  try {
    const response = await fetchWithTimeout(imageUrl, 10_000);
    if (!response.ok) {
      throw new Error(`Could not load a random image (${response.status}).`);
    }
    const uploaded = await sites.uploadImage(
      username.value,
      await response.blob(),
      "hero",
    );
    if (!uploaded) {
      throw new Error(sites.error || "Could not upload the random image.");
    }
    draft.value.hero.image = uploaded.path;
    draft.value.assets.heroImage = uploaded.path;
    toastSuccess("Random image ready. Save the draft to update the preview.");
  } catch (caught) {
    error.value =
      caught instanceof Error
        ? caught.message
        : "Could not load a random image. Please try again.";
  } finally {
    randomImageBusy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-builder">
    <header class="builder-topbar">
      <router-link :to="builderBackUrl" class="back-link">
        <UiIcon name="ArrowLeft" :size="17" aria-hidden="true" />
        Sites
      </router-link>
      <div class="builder-title">
        <strong>{{ page?.title || "Page builder" }}</strong>
        <span v-if="page">{{ isBusinessSite ? `/${page.slug}` : `/me/${page.slug}` }}</span>
      </div>
      <div class="top-actions">
        <a v-if="page?.publishedAt" :href="liveUrl" target="_blank" rel="noreferrer" class="button ghost">
          Open live
        </a>
        <button class="button secondary" type="button" :disabled="busy" @click="save()">
          {{ busy ? "Working…" : "Save" }}
        </button>
        <button v-if="isBusinessSite || !page?.publishedAt" class="button primary" type="button" :disabled="busy" @click="publish">
          {{ isBusinessSite ? "Publish site" : "Publish" }}
        </button>
        <button v-else class="button secondary" type="button" :disabled="busy" @click="unpublish">
          Unpublish
        </button>
      </div>
    </header>

    <main v-if="draft && !loading" class="builder-workspace">
      <aside class="outline-panel" aria-label="Page outline">
        <div class="panel-heading">
          <h2>Page</h2>
          <span>{{ draft.recipe.name }}</span>
        </div>
        <nav aria-label="Page sections" class="section-list">
          <div v-for="(section, index) in draft.content.sections" :key="section.id" class="section-row" :class="{ active: activeSectionId === section.id }">
            <button type="button" class="section-select" @click="activeSectionId = section.id">
              <span>{{ section.heading }}</span>
              <small>{{ section.type }}</small>
            </button>
            <div class="row-tools">
              <button type="button" :disabled="index === 0" :aria-label="`Move ${section.heading} up`" @click="moveSection(index, -1)">↑</button>
              <button type="button" :disabled="index === draft.content.sections.length - 1" :aria-label="`Move ${section.heading} down`" @click="moveSection(index, 1)">↓</button>
              <button type="button" :aria-label="`Duplicate ${section.heading}`" @click="duplicateSection(index)">⧉</button>
              <button type="button" :disabled="draft.content.sections.length <= 1" :aria-label="`Remove ${section.heading}`" @click="removeSection(index)">×</button>
            </div>
          </div>
        </nav>
        <div class="add-section">
          <span>Add section</span>
          <div>
            <button type="button" @click="addSection('story')">Text</button>
            <button type="button" @click="addSection('feature-list')">Features</button>
            <button type="button" @click="addSection('faq')">FAQ</button>
            <button type="button" @click="addSection('action')">Action</button>
            <button type="button" @click="addSection('image-text')">Image + text</button>
            <button type="button" @click="addSection('testimonials')">Testimonials</button>
            <button type="button" @click="addSection('team')">Team</button>
            <button type="button" @click="addSection('pricing')">Pricing</button>
            <button type="button" @click="addSection('logo-row')">Logos</button>
            <button type="button" @click="addSection('collection')">Collection</button>
            <button type="button" @click="addSection('legal')">Legal</button>
          </div>
        </div>
        <details class="history-panel">
          <summary>Published history</summary>
          <p v-if="revisions.length === 0">No published versions yet.</p>
          <button v-for="revision in revisions" :key="revision.id" type="button" :disabled="busy" @click="restore(revision.id)">
            Restore {{ new Date(revision.createdAt).toLocaleString() }}
          </button>
        </details>
      </aside>

      <section class="editor-panel" aria-labelledby="editor-title">
        <div class="editor-group hero-editor">
          <h1 id="editor-title">Content</h1>
          <label>Headline<input v-model="draft.hero.headline" /></label>
          <label>Introduction<textarea v-model="draft.hero.subheadline" rows="4" /></label>
          <SiteEventFields v-model="draft.event" />
          <label>Hero layout
            <select v-model="draft.hero.imageLayout">
              <option value="split">Split image panel</option>
              <option value="background">Full-bleed background</option>
            </select>
          </label>
          <label class="checkbox-field">
            <input v-model="draft.hero.showActions" type="checkbox" />
            Show primary action in hero
          </label>
          <div class="image-field">
            <label>Hero image<input type="file" accept="image/*" @change="uploadHero" /></label>
            <button
              type="button"
              class="button secondary"
              :disabled="busy || randomImageBusy"
              @click="useRandomHero"
            >
              <UiIcon name="Sparkles" :size="16" aria-hidden="true" />
              {{ randomImageBusy ? "Finding an image…" : "Surprise me" }}
            </button>
          </div>
        </div>

        <div class="editor-group action-editor">
          <h2>Primary action</h2>
          <label>Action type
            <select :value="primaryAction?.kind" @change="handleActionKindChange">
              <option value="link">External link</option>
              <option value="subscribe">Email signup</option>
              <option value="booking">Booking</option>
              <option value="product">Product payment</option>
            </select>
          </label>
          <label v-if="primaryAction">Button label<input v-model="primaryAction.label" /></label>
          <label v-if="primaryAction?.kind === 'link'">Destination URL<input v-model="primaryAction.href" type="url" /></label>
          <label v-if="primaryAction?.kind === 'booking'">Booking offer
            <select v-model="primaryAction.resourceId">
              <option value="">Choose an existing offer</option>
              <option v-for="offer in bookingOffers" :key="offer.id" :value="offer.id">{{ offer.title }}{{ offer.paid ? " · paid" : "" }}</option>
            </select>
          </label>
          <p v-if="primaryAction?.kind === 'booking' && bookingOffers.length === 0" class="field-note">Create and publish a booking offer in the site wizard first.</p>
          <p v-if="primaryAction?.kind === 'booking' && bookingOffers.some((offer) => offer.id === primaryAction?.resourceId && offer.paid) && !paymentsReady" class="field-note warning">Connect Stripe in Account → Payments before publishing this paid booking.</p>
          <label v-if="primaryAction?.kind === 'product'">Product
            <select v-model="primaryAction.resourceId">
              <option value="">Choose an existing product</option>
              <option v-for="product in products" :key="product.slug" :value="product.slug">{{ product.title }}</option>
            </select>
          </label>
          <p v-if="primaryAction?.kind === 'product' && products.length === 0" class="field-note">Create and publish a product in the site wizard first.</p>
          <p v-if="primaryAction?.kind === 'product' && !paymentsReady" class="field-note warning">Connect Stripe in Account → Payments before publishing this product action.</p>
        </div>

        <div v-if="activeSection" class="editor-group section-editor">
          <div class="section-editor-heading">
            <h2>{{ activeSection.heading }}</h2>
            <span>{{ activeSection.type }}</span>
          </div>
          <label>Section heading<input v-model="activeSection.heading" /></label>
          <label v-if="activeSection.type === 'story' || activeSection.type === 'profile' || activeSection.type === 'action' || activeSection.type === 'image-text' || activeSection.type === 'legal'">Body<textarea v-model="activeSection.body" rows="6" /></label>

          <template v-if="activeSection.type === 'image-text'">
            <label>Image URL<input v-model="activeSection.image" /></label>
            <label>Alternative text<input v-model="activeSection.imageAlt" /></label>
            <label>Image position
              <select v-model="activeSection.imagePosition"><option value="left">Left</option><option value="right">Right</option></select>
            </label>
          </template>

          <template v-if="activeSection.type === 'feature-list' || activeSection.type === 'steps'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row">
              <label>Title<input v-model="item.title" /></label>
              <label>Copy<textarea v-model="item.body" rows="3" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ title: 'New point', body: 'Explain why it matters.' })">Add item</button>
          </template>

          <template v-if="activeSection.type === 'details'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row compact">
              <label>Label<input v-model="item.label" /></label>
              <label>Value<input v-model="item.value" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ label: 'Detail', value: 'Add information' })">Add detail</button>
          </template>

          <template v-if="activeSection.type === 'faq'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row">
              <label>Question<input v-model="item.question" /></label>
              <label>Answer<textarea v-model="item.answer" rows="3" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ question: 'New question', answer: 'Add the answer.' })">Add question</button>
          </template>

          <template v-if="activeSection.type === 'testimonials'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row">
              <label>Quote<textarea v-model="item.quote" rows="3" /></label>
              <label>Name<input v-model="item.name" /></label>
              <label>Role<input v-model="item.role" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ quote: 'Add a specific quote.', name: 'Customer name' })">Add testimonial</button>
          </template>

          <template v-if="activeSection.type === 'team'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row">
              <label>Name<input v-model="item.name" /></label>
              <label>Role<input v-model="item.role" /></label>
              <label>Biography<textarea v-model="item.bio" rows="3" /></label>
              <label>Image URL<input v-model="item.image" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ name: 'Team member', role: 'Role', bio: 'Add a concise biography.', image: null })">Add team member</button>
          </template>

          <template v-if="activeSection.type === 'pricing'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row">
              <label>Name<input v-model="item.name" /></label>
              <label>Price<input v-model="item.price" /></label>
              <label>Description<textarea v-model="item.description" rows="3" /></label>
              <label>Features, one per line<textarea :value="item.features.join('\n')" rows="4" @input="item.features = ($event.target as HTMLTextAreaElement).value.split('\n').filter(Boolean)" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ name: 'Service', price: 'From €0', description: 'Explain what is included.', features: [] })">Add price</button>
          </template>

          <template v-if="activeSection.type === 'logo-row'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row compact">
              <label>Name<input v-model="item.name" /></label>
              <label>Image URL<input v-model="item.image" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ name: 'Organization' })">Add logo</button>
          </template>

          <template v-if="activeSection.type === 'collection'">
            <div v-for="(item, index) in activeSection.items" :key="index" class="repeater-row">
              <label>Title<input v-model="item.title" /></label>
              <label>Label<input v-model="item.label" /></label>
              <label>Copy<textarea v-model="item.body" rows="3" /></label>
              <label>Destination<input v-model="item.href" /></label>
              <label>Image URL<input v-model="item.image" /></label>
              <button type="button" @click="activeSection.items.splice(index, 1)">Remove</button>
            </div>
            <button type="button" class="button secondary" @click="activeSection.items.push({ title: 'Item', body: 'Describe this item.' })">Add item</button>
          </template>
        </div>

        <div class="editor-group seo-editor">
          <h2>Search and sharing</h2>
          <label>Page title<input v-model="draft.seo.title" maxlength="70" /></label>
          <label>Description<textarea v-model="draft.seo.description" maxlength="180" rows="4" /></label>
        </div>

        <div v-if="validationErrors.length" class="validation-panel" role="alert">
          <strong>Before publishing</strong>
          <ul><li v-for="message in validationErrors" :key="message">{{ message }}</li></ul>
        </div>
        <p v-if="error" class="message error" role="alert">{{ error }}</p>
      </section>

      <aside class="preview-panel" aria-label="Page preview">
        <div class="preview-heading"><strong>Preview</strong><span>{{ page?.publishedAt ? "Published" : "Draft" }}</span></div>
        <iframe v-if="previewHtml" :srcdoc="previewHtml" title="Landing page preview" />
        <div v-else class="preview-empty">Save the draft to refresh the preview.</div>
      </aside>
    </main>
    <main v-else class="loading-state" role="status">{{ error || "Loading page…" }}</main>
  </div>
</template>

<style scoped>
.page-builder{min-height:100vh;background:var(--ui-bg,var(--color-bg));color:var(--ui-text,var(--color-text))}.builder-topbar{position:sticky;top:0;z-index:10;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:18px;min-height:68px;padding:10px 20px;border-bottom:1px solid var(--ui-border,var(--color-border));background:color-mix(in srgb,var(--ui-bg,var(--color-bg)) 94%,transparent);backdrop-filter:blur(14px)}.back-link,.button{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--ui-radius-sm,8px);font:inherit;font-weight:700;text-decoration:none}.back-link{color:var(--ui-text-muted,var(--color-text-muted))}.builder-title{display:grid;min-width:0}.builder-title strong,.builder-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.builder-title span{font-size:.85rem;color:var(--ui-text-muted,var(--color-text-muted))}.top-actions{display:flex;gap:8px}.button{padding:0 15px;border:1px solid var(--ui-border-strong,var(--color-border));cursor:pointer}.button.primary{border-color:var(--ui-accent,var(--color-accent));background:var(--ui-accent,var(--color-accent));color:var(--ui-accent-contrast,#fff)}.button.secondary,.button.ghost{background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text))}.button.ghost{border-color:transparent}.button:disabled{opacity:.55;cursor:not-allowed}.builder-workspace{display:grid;grid-template-columns:260px minmax(420px,640px) minmax(360px,1fr);gap:0;align-items:start}.outline-panel,.editor-panel{min-height:calc(100vh - 68px);border-right:1px solid var(--ui-border,var(--color-border))}.outline-panel{position:sticky;top:68px;max-height:calc(100vh - 68px);overflow:auto;padding:20px 14px}.editor-panel{padding:26px 28px}.preview-panel{position:sticky;top:68px;height:calc(100vh - 68px);padding:16px;background:var(--ui-surface-muted,var(--color-bg-subtle))}.panel-heading,.section-editor-heading,.preview-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.panel-heading h2,.editor-group h1,.editor-group h2{margin:0}.panel-heading span,.section-editor-heading span,.preview-heading span{color:var(--ui-text-muted,var(--color-text-muted));font-size:.82rem}.section-list{display:grid;gap:5px;margin:18px 0}.section-row{display:grid;grid-template-columns:minmax(0,1fr) auto;border-radius:var(--ui-radius-sm,8px)}.section-row.active{background:var(--ui-accent-soft,color-mix(in srgb,var(--ui-accent) 12%,transparent))}.section-select{display:grid;gap:2px;min-height:48px;padding:8px 10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.section-select span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}.section-select small{color:var(--ui-text-muted,var(--color-text-muted))}.row-tools{display:none;align-items:center}.section-row:hover .row-tools,.section-row:focus-within .row-tools{display:flex}.row-tools button,.add-section button,.history-panel button,.repeater-row>button{min-width:36px;min-height:36px;border:0;background:transparent;color:var(--ui-text-muted,var(--color-text-muted));cursor:pointer}.add-section{display:grid;gap:10px;padding-top:16px;border-top:1px solid var(--ui-border,var(--color-border));font-size:.85rem}.add-section>div{display:flex;flex-wrap:wrap;gap:4px}.add-section button{padding:0 9px;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-sm,8px)}.history-panel{margin-top:20px;border-top:1px solid var(--ui-border,var(--color-border));padding-top:16px}.history-panel summary{cursor:pointer;font-weight:700}.history-panel button{display:block;width:100%;height:auto;padding:8px 0;text-align:left}.editor-group{display:grid;gap:14px;padding:0 0 26px;margin:0 0 26px;border-bottom:1px solid var(--ui-border,var(--color-border))}.editor-group label{display:grid;gap:7px;font-weight:700}.editor-group input,.editor-group textarea,.editor-group select{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--ui-border-strong,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text));font:inherit}.editor-group textarea{resize:vertical}.image-field{display:grid;gap:10px}.image-field .button{justify-self:start}.field-note{margin:0;color:var(--ui-text-muted,var(--color-text-muted));font-size:.9rem}.repeater-row{display:grid;gap:10px;padding:14px 0;border-bottom:1px dashed var(--ui-border,var(--color-border))}.repeater-row.compact{grid-template-columns:1fr 1fr auto;align-items:end}.validation-panel{padding:15px;border:1px solid color-mix(in srgb,#b7791f 45%,var(--ui-border));border-radius:var(--ui-radius-sm,8px);background:color-mix(in srgb,#f6ad55 10%,var(--ui-surface));}.validation-panel ul{margin:8px 0 0;padding-left:20px}.message{min-height:1.4em}.message.error{color:#b42318}.preview-heading{height:42px}.preview-panel iframe,.preview-empty{width:100%;height:calc(100% - 42px);border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-md,10px);background:#fff}.preview-empty{display:grid;place-items:center;padding:20px;text-align:center;color:var(--ui-text-muted,var(--color-text-muted))}.loading-state{display:grid;place-items:center;min-height:60vh}.button:focus-visible,.back-link:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--ui-accent,var(--color-accent));outline-offset:2px}@media(max-width:1180px){.builder-workspace{grid-template-columns:230px minmax(0,1fr)}.preview-panel{position:static;grid-column:1/-1;height:760px;border-top:1px solid var(--ui-border,var(--color-border))}}@media(max-width:760px){.builder-topbar{position:static;grid-template-columns:1fr}.top-actions{display:grid;grid-template-columns:1fr 1fr}.builder-workspace{display:block}.outline-panel{position:static;max-height:none;min-height:0;border-right:0;border-bottom:1px solid var(--ui-border,var(--color-border))}.editor-panel{min-height:0;padding:22px 18px;border-right:0}.preview-panel{height:620px;padding:12px}.repeater-row.compact{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
.editor-group .checkbox-field{display:flex;align-items:center;gap:10px}.editor-group .checkbox-field input{width:20px;min-height:20px;margin:0}
</style>

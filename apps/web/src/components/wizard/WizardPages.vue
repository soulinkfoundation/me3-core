<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import draggable from "vuedraggable";
import {
  useWizardStore,
  type WizardContentAsset,
  type WizardPage,
} from "../../stores/wizard";
import TiptapEditor from "../TiptapEditor.vue";
import UiIcon from "../UiIcon.vue";
import type { UiIconName } from "../../utils/icons";

const wizard = useWizardStore();
const editingHome = ref(false);
const sectionLabels = { offers: "Offers", booking: "Booking calendar", writing: "Latest writing", testimonials: "Testimonials", newsletter: "Newsletter" } as const;

function reorderPages(rows: Array<{ page: WizardPage; index: number }>) {
  const positions = rows.map(row => row.index).sort((a, b) => a - b);
  rows.forEach((row, index) => wizard.movePage(wizard.pages.indexOf(row.page), positions[index]));
}
function pageRowKey(row: { page: WizardPage }) { return row.page.slug; }

function moveHomeSection(index: number, direction: -1 | 1) {
  const sections = [...wizard.homeSections];
  const target = index + direction;
  if (target < 0 || target >= sections.length) return;
  [sections[index], sections[target]] = [sections[target], sections[index]];
  wizard.setHomeSections(sections);
}

function toggleHomeSection(index: number, visible: boolean) {
  const id = wizard.homeSections[index]?.id;
  if (!visible && ((id === "offers" && wizard.primaryAction?.kind === "offer") || (id === "newsletter" && wizard.primaryAction?.kind === "subscribe"))) wizard.setPrimaryAction(undefined);
  wizard.setHomeSections(wizard.homeSections.map((section, itemIndex) => itemIndex === index ? { ...section, visible } : section));
}

// Currently selected page index for editing
const selectedPageIndex = ref<number | null>(null);

// Page title input for editing
const editingTitle = ref("");
const editingSlug = ref("");
const editingNavigationGroup = ref("");
const routeTouched = ref(false);
const showRouteEditor = ref(false);
const routeInputRef = ref<HTMLInputElement | null>(null);

function slugifyRouteSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30)
  );
}

const selectedPage = computed(() => {
  if (selectedPageIndex.value === null) return null;
  return wizard.pages[selectedPageIndex.value] || null;
});

// Generate a preview slug from the current editing title
const previewSlug = computed(() => {
  const shouldUseCustomRoute =
    routeTouched.value || Boolean(selectedPage.value?.slugCustomized);

  if (shouldUseCustomRoute) {
    const customSlug = slugifyRouteSegment(editingSlug.value);
    if (customSlug) return customSlug;
  }

  if (!editingTitle.value.trim()) {
    return selectedPage.value?.slug || "untitled";
  }

  return slugifyRouteSegment(editingTitle.value) || "untitled";
});

const editorContent = ref("");
const editorRef = ref<InstanceType<typeof TiptapEditor> | null>(null);

function handleContentAssetAdded(asset: WizardContentAsset) {
  if (selectedPageIndex.value === null) return;
  wizard.addPageContentAsset(selectedPageIndex.value, asset);
}

// Watch for page selection changes to update editor content
watch(selectedPageIndex, (newIndex) => {
  if (newIndex !== null && wizard.pages[newIndex]) {
    const page = wizard.pages[newIndex];
    editingTitle.value = page.title;
    editingSlug.value = page.slug;
    editingNavigationGroup.value = page.navigationGroup || "";
    routeTouched.value = false;
    showRouteEditor.value = false;
    editorContent.value = page.content || "";
  }
});

// Watch for editor content changes to update page
watch(editorContent, (newContent) => {
  if (selectedPageIndex.value !== null) {
    const assetIds = editorRef.value?.getAssetIds() || new Set<string>();
    wizard.updatePage(selectedPageIndex.value, {
      content: newContent,
    });
    wizard.syncPageContentAssets(selectedPageIndex.value, assetIds);
  }
});

function addPageWithVisibility(title: string, visible: boolean) {
  const newPage = wizard.addPage(title, { visible });
  if (newPage) {
    const newIndex = wizard.pages.length - 1;
    selectedPageIndex.value = newIndex;
  }
}

function addNewPage() {
  addPageWithVisibility("About", true);
}

function addNewAdminPage() {
  addPageWithVisibility("Admin Page", false);
}

function selectPage(index: number) {
  persistPageMeta();
  editingHome.value = false;
  selectedPageIndex.value = index;
}

function syncEditingRoute() {
  if (selectedPageIndex.value === null) return;
  const page = wizard.pages[selectedPageIndex.value];
  if (!page) return;
  editingSlug.value = page.slug;
  routeTouched.value = false;
}

function persistPageMeta() {
  if (selectedPageIndex.value === null) return;

  const updates: Partial<WizardPage> = {};
  if (editingTitle.value.trim()) {
    updates.title = editingTitle.value.trim();
  }
  if (routeTouched.value || selectedPage.value?.slugCustomized) {
    updates.slug = editingSlug.value;
  }
  updates.navigationGroup = editingNavigationGroup.value;
  if (Object.keys(updates).length === 0) return;

  wizard.updatePage(selectedPageIndex.value, updates);
  syncEditingRoute();
}

function updatePageTitle() {
  persistPageMeta();
}

function updatePageSlug() {
  if (selectedPageIndex.value === null) return;
  const updates: Partial<WizardPage> = {
    slug: editingSlug.value,
  };
  if (editingTitle.value.trim()) {
    updates.title = editingTitle.value.trim();
  }
  wizard.updatePage(selectedPageIndex.value, updates);
  syncEditingRoute();
}

async function openRouteEditor() {
  showRouteEditor.value = true;
  await nextTick();
  routeInputRef.value?.focus();
  routeInputRef.value?.select();
}

function closeRouteEditor() {
  showRouteEditor.value = false;
}

function handleRouteBlur() {
  updatePageSlug();
  closeRouteEditor();
}

function cancelRouteEdit() {
  syncEditingRoute();
  closeRouteEditor();
}

function togglePagePublished(index: number) {
  const page = wizard.pages[index];
  if (!page) return;
  wizard.updatePage(index, { draft: page.draft ? undefined : true });
}

function deletePage(index: number) {
  if (!confirm("Delete this page?")) return;

  wizard.removePage(index);

  // Adjust selection if needed
  if (selectedPageIndex.value === index) {
    selectedPageIndex.value = wizard.pages.length > 0 ? 0 : null;
  } else if (
    selectedPageIndex.value !== null &&
    selectedPageIndex.value > index
  ) {
    selectedPageIndex.value--;
  }
}

function movePageWithinList(
  items: Array<{ page: (typeof wizard.pages)[number]; index: number }>,
  displayIndex: number,
  direction: -1 | 1,
) {
  const current = items[displayIndex];
  const target = items[displayIndex + direction];
  if (!current || !target) return;
  wizard.movePage(current.index, target.index);
}

function moveMainPage(displayIndex: number, direction: -1 | 1) {
  movePageWithinList(mainPages.value, displayIndex, direction);
}

function moveAdminPage(displayIndex: number, direction: -1 | 1) {
  movePageWithinList(adminPages.value, displayIndex, direction);
}

function closeEditor() {
  persistPageMeta();
  editorRef.value?.flushPendingAssets?.();
  selectedPageIndex.value = null;
  editingHome.value = false;
}

// Page suggestions
const pageSuggestions: Array<{ title: string; icon: UiIconName }> = [
  { title: "About", icon: "User" },
];

const adminPageSuggestions: Array<{ title: string; icon: UiIconName }> = [
  { title: "Privacy Policy", icon: "Shield" },
  { title: "Terms of Service", icon: "FileText" },
];

function addSuggestedPage(title: string) {
  addPageWithVisibility(title, true);
}

function addSuggestedAdminPage(title: string) {
  addPageWithVisibility(title, false);
}

const canAddMore = computed(
  () => wizard.pages.length < wizard.maxPages,
);
const mainPages = computed(() =>
  wizard.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.visible !== false),
);
const adminPages = computed(() =>
  wizard.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.visible === false),
);
const navigationGroups = computed(() =>
  Array.from(
    new Set(
      wizard.pages
        .filter((page) => page.visible !== false)
        .map((page) => page.navigationGroup?.trim())
        .filter((group): group is string => Boolean(group)),
    ),
  ),
);

// Expose editing state to parent
const isEditingPage = computed(() => selectedPageIndex.value !== null || editingHome.value);

defineExpose({
  isEditingPage,
});
</script>

<template>
  <div class="step-pages">
    <h2>Pages</h2>
    <div v-if="selectedPageIndex === null && !editingHome">
      <div class="page-list"><div class="page-item home-page-item"><div class="page-header"><span class="page-icon" aria-hidden="true"><UiIcon name="LayoutGrid" :size="20" /></span><div class="page-details"><strong class="page-title">Home</strong><span class="page-slug">/</span></div><button class="home-edit-button" type="button" @click="editingHome = true">Edit home</button></div></div></div>
      <!-- Page list -->
      <draggable v-if="mainPages.length > 0" :model-value="mainPages" :item-key="pageRowKey" handle=".page-details,.page-icon" :animation="160" :delay="250" :delay-on-touch-only="true" class="page-list" @update:model-value="reorderPages">
        <template #item="{ element: { page, index }, index: displayIndex }">
        <div class="page-item" :class="{ 'is-draft': page.draft }">
          <div class="page-header">
            <span class="page-icon" aria-hidden="true">
              <UiIcon name="FileText" :size="18" aria-hidden="true" />
            </span>
            <div class="page-details">
              <span class="page-title">{{ page.title }}</span>
              <span v-if="page.navigationGroup" class="page-group">
                {{ page.navigationGroup }} menu
              </span>
              <span class="page-slug">/{{ page.slug }}</span>
              <span v-if="page.draft" class="page-status">Unpublished</span>
            </div>

            <div class="page-actions">
              <button
                class="action-btn"
                type="button"
                title="Move page up"
                :disabled="displayIndex === 0"
                @click="moveMainPage(displayIndex, -1)"
              >
                <UiIcon name="ChevronUp" :size="18" aria-hidden="true" />
              </button>
              <button
                class="action-btn"
                type="button"
                title="Move page down"
                :disabled="displayIndex === mainPages.length - 1"
                @click="moveMainPage(displayIndex, 1)"
              >
                <UiIcon name="ChevronDown" :size="18" aria-hidden="true" />
              </button>
              <button
                class="action-btn edit-btn"
                type="button"
                title="Edit page"
                @click="selectPage(index)"
              >
                <UiIcon name="Pencil" :size="18" aria-hidden="true" />
              </button>
              <button
                class="action-btn"
                type="button"
                :title="page.draft ? 'Publish page' : 'Unpublish page'"
                :aria-label="page.draft ? `Publish ${page.title}` : `Unpublish ${page.title}`"
                @click="togglePagePublished(index)"
              >
                <UiIcon :name="page.draft ? 'EyeOff' : 'Eye'" :size="18" aria-hidden="true" />
              </button>
              <button
                class="action-btn remove-btn"
                type="button"
                title="Delete page"
                @click="deletePage(index)"
              >
                <UiIcon name="X" :size="18" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        </template>
      </draggable>
      <!-- Add page buttons -->
      <div v-if="canAddMore" class="add-pages">
        <div class="platform-buttons">
          <button
            v-for="s in pageSuggestions"
            :key="s.title"
            class="platform-btn"
            type="button"
            :disabled="
              wizard.pages.some(
                (p) => p.title.toLowerCase() === s.title.toLowerCase()
              )
            "
            @click="addSuggestedPage(s.title)"
          >
            <span class="platform-btn-icon" aria-hidden="true">
              <UiIcon :name="s.icon" :size="16" />
            </span>
            <span class="platform-btn-label">{{ s.title }}</span>
          </button>
          <button
            class="platform-btn more-btn"
            type="button"
            @click="addNewPage"
          >
            <span class="platform-btn-icon" aria-hidden="true">
              <UiIcon name="Pencil" :size="16" />
            </span>
            <span class="platform-btn-label">Custom</span>
          </button>
        </div>
      </div>

      <div class="divider"></div>

      <div class="admin-section">
        <div class="section-header">
          <h3 class="section-title">Admin pages</h3>
          <p class="section-hint">
            Hidden from your main menu. Add links in your footer, blog, or page
            content.
          </p>
        </div>
        <draggable v-if="adminPages.length > 0" :model-value="adminPages" :item-key="pageRowKey" handle=".page-details,.page-icon" :animation="160" :delay="250" :delay-on-touch-only="true" class="page-list" @update:model-value="reorderPages">
          <template #item="{ element: { page, index }, index: displayIndex }">
          <div class="page-item" :class="{ 'is-draft': page.draft }">
            <div class="page-header">
              <span class="page-icon" aria-hidden="true">
                <UiIcon name="FileText" :size="18" aria-hidden="true" />
              </span>
              <div class="page-details">
                <span class="page-title">{{ page.title }}</span>
                <span class="page-slug">/{{ page.slug }}</span>
                <span v-if="page.draft" class="page-status">Unpublished</span>
              </div>

              <div class="page-actions">
                <button
                  class="action-btn"
                  type="button"
                  title="Move page up"
                  :disabled="displayIndex === 0"
                  @click="moveAdminPage(displayIndex, -1)"
                >
                  <UiIcon name="ChevronUp" :size="18" aria-hidden="true" />
                </button>
                <button
                  class="action-btn"
                  type="button"
                  title="Move page down"
                  :disabled="displayIndex === adminPages.length - 1"
                  @click="moveAdminPage(displayIndex, 1)"
                >
                  <UiIcon name="ChevronDown" :size="18" aria-hidden="true" />
                </button>
                <button
                  class="action-btn edit-btn"
                  type="button"
                  title="Edit page"
                  @click="selectPage(index)"
                >
                  <UiIcon name="Pencil" :size="18" aria-hidden="true" />
                </button>
                <button
                  class="action-btn"
                  type="button"
                  :title="page.draft ? 'Publish page' : 'Unpublish page'"
                  :aria-label="page.draft ? `Publish ${page.title}` : `Unpublish ${page.title}`"
                  @click="togglePagePublished(index)"
                >
                  <UiIcon :name="page.draft ? 'EyeOff' : 'Eye'" :size="18" aria-hidden="true" />
                </button>
                <button
                  class="action-btn remove-btn"
                  type="button"
                  title="Delete page"
                  @click="deletePage(index)"
                >
                  <UiIcon name="X" :size="18" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          </template>
        </draggable>
        <div v-if="canAddMore" class="add-pages admin-add-pages">
          <div class="platform-buttons">
            <button
              v-for="s in adminPageSuggestions"
              :key="s.title"
              class="platform-btn"
              type="button"
              :disabled="
                wizard.pages.some(
                  (p) => p.title.toLowerCase() === s.title.toLowerCase()
                )
              "
              @click="addSuggestedAdminPage(s.title)"
            >
              <span class="platform-btn-icon" aria-hidden="true">
                <UiIcon :name="s.icon" :size="16" />
              </span>
              <span class="platform-btn-label">{{ s.title }}</span>
            </button>
            <button
              class="platform-btn more-btn"
              type="button"
              @click="addNewAdminPage"
            >
              <span class="platform-btn-icon" aria-hidden="true">
                <UiIcon name="Pencil" :size="16" />
              </span>
              <span class="platform-btn-label">Custom</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="editingHome" class="home-editor">
      <button class="editor-back-link" type="button" @click="closeEditor">← Back to pages</button>
      <h3>Home</h3>
      <p>Drag to arrange the sections below your profile header.</p>
      <h4>Homepage sections</h4>
      <draggable :model-value="wizard.homeSections" item-key="id" handle=".home-section-label" :animation="160" :delay="250" :delay-on-touch-only="true" class="home-section-list" @update:model-value="wizard.setHomeSections">
        <template #item="{ element: section, index }">
        <div class="home-section-row">
          <span class="home-section-label">{{ sectionLabels[section.id as keyof typeof sectionLabels] }}</span>
          <div class="home-section-controls">
            <button type="button" :disabled="index === 0" :aria-label="`Move ${sectionLabels[section.id as keyof typeof sectionLabels]} up`" @click="moveHomeSection(index, -1)">↑</button>
            <button type="button" :disabled="index === wizard.homeSections.length - 1" :aria-label="`Move ${sectionLabels[section.id as keyof typeof sectionLabels]} down`" @click="moveHomeSection(index, 1)">↓</button>
            <label><input type="checkbox" :checked="section.visible" @change="toggleHomeSection(index, ($event.target as HTMLInputElement).checked)" /> Show</label>
          </div>
        </div>
        </template>
      </draggable>
    </div>

    <!-- Editor view -->
    <div v-if="selectedPageIndex !== null && selectedPage" class="editor-view">
      <!-- Back to pages button - positioned at bottom left -->
      <div class="editor-nav">
        <button class="editor-back-link" @click="closeEditor">
          ← Back to pages
        </button>
      </div>
      <div class="editor-form">
        <div class="form-group title-input">
          <label for="page-title-input" class="field-label">Title</label>
          <input
            id="page-title-input"
            v-model="editingTitle"
            type="text"
            placeholder="Title (e.g. About)"
            maxlength="50"
            @blur="updatePageTitle"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
        </div>
        <div class="route-row">
          <template v-if="showRouteEditor">
            <span class="slug-preview">URL: /</span>
            <input
              id="page-route-input"
              ref="routeInputRef"
              v-model="editingSlug"
              class="route-inline-input"
              type="text"
              inputmode="url"
              placeholder="about"
              maxlength="50"
              @input="routeTouched = true"
              @blur="handleRouteBlur"
              @keydown.esc.prevent="cancelRouteEdit"
              @keyup.enter="($event.target as HTMLInputElement).blur()"
            />
          </template>
          <template v-else>
            <span class="slug-preview">URL: /{{ previewSlug }}</span>
            <button
              class="route-edit-btn"
              type="button"
              @click="openRouteEditor"
            >
              <UiIcon name="Pencil" :size="14" />
              <span>Edit</span>
            </button>
          </template>
        </div>

        <div
          v-if="selectedPage.visible !== false"
          class="form-group navigation-group-input"
        >
          <label for="page-navigation-group" class="field-label">
            Navigation group <span>(optional)</span>
          </label>
          <input
            id="page-navigation-group"
            v-model="editingNavigationGroup"
            type="text"
            list="page-navigation-groups"
            placeholder="e.g. Services"
            maxlength="40"
            @blur="persistPageMeta"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
          <datalist id="page-navigation-groups">
            <option v-for="group in navigationGroups" :key="group" :value="group" />
          </datalist>
          <p>
            Pages with the same group appear together in one dropdown menu.
          </p>
        </div>

        <!-- Tiptap Editor -->
        <TiptapEditor
          ref="editorRef"
          v-model="editorContent"
          placeholder="Write your page content here..."
          @asset-added="handleContentAssetAdded"
        />
      </div>
    </div>

    <!-- Max reached -->
    <p v-if="!canAddMore && selectedPageIndex === null" class="max-hint">
      Maximum {{ wizard.maxPages }} pages reached.
    </p>
  </div>
</template>

<style scoped>
.step-pages h2 {
  font-size: 28px;
  margin-bottom: 16px;
}

/* Page list - matches .links-list / .buttons-list */
.page-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.page-item {
  background: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: 12px;
  padding: 12px 16px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.page-item:hover {
  border-color: var(--color-text-muted);
}

.page-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
}

.page-icon svg {
  width: 20px;
  height: 20px;
}

.page-details {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.page-title {
  font-weight: 500;
  font-size: 15px;
}

.page-slug {
  font-size: 12px;
  color: var(--color-text-muted);
}

.page-status {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.page-item.is-draft .page-title,
.page-item.is-draft .page-icon {
  opacity: 0.55;
}

.page-group {
  color: var(--ui-accent-strong, var(--color-primary));
  font-size: 11px;
  font-weight: 600;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.route-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: -2px;
  margin-bottom: 4px;
  min-height: 32px;
}

.route-inline-input {
  min-width: 0;
  width: min(260px, 100%);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
}

.route-inline-input:focus {
  outline: none;
  border-color: var(--color-text);
}

.route-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  padding: 4px 0;
  font-size: 12px;
  cursor: pointer;
}

.route-edit-btn:hover {
  color: var(--color-text);
}

.page-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--color-text-muted);
  transition: background 0.2s, color 0.2s;
}

.action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.action-btn:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.action-btn:disabled:hover {
  background: none;
  color: var(--color-text-muted);
}

.action-btn.remove-btn:hover {
  color: #ef4444;
}

.action-btn svg {
  width: 16px;
  height: 16px;
}

/* Add Pages Section - matches .add-platforms / .add-buttons */
.add-pages {
  margin-bottom: 20px;
}

.platform-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.platform-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-border);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text);
  transition: background 0.2s, transform 0.1s;
}

.platform-btn:hover:not(:disabled) {
  background: var(--color-text-muted);
  color: var(--color-bg);
}

.platform-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.platform-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.platform-btn-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.platform-btn.more-btn {
  background: transparent;
  border: 2px dashed var(--color-border);
}

.platform-btn.more-btn:hover {
  border-color: var(--color-text-muted);
  background: var(--color-border);
  color: var(--color-text);
}

/* Editor view */
.editor-view {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.editor-nav {
  margin-top: auto;
  padding-bottom: 10px;
}

.editor-back-link {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.editor-back-btn:hover {
  background: var(--color-text-muted);
  color: var(--color-bg);
}

.editor-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group.title-input {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.form-group input {
  padding: 12px 14px;
  font-size: 18px;
  font-weight: 600;
  border: 1px solid var(--color-border);
  flex: 1;
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-text);
}

.navigation-group-input {
  max-width: 360px;
}

.navigation-group-input .field-label span {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.navigation-group-input input {
  min-height: 42px;
  font-size: 14px;
  font-weight: 500;
}

.navigation-group-input p {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.45;
}

.slug-preview {
  font-size: 12px;
  color: var(--color-text-muted);
}

/* Hints */
.max-hint {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
  padding: 32px 0;
}

.admin-section {
  margin-top: 4px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.section-title {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0;
}

.section-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
}

.divider {
  margin: 24px 0;
  border: 1px solid var(--color-border);
}
.home-page-item{border-color:var(--ui-accent,var(--color-border));background:var(--ui-accent-soft,var(--color-bg))}
.home-edit-button{min-height:44px;padding:0 16px;border:1px solid var(--ui-border,var(--color-border));border-radius:8px;background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text));font:inherit;font-weight:700;cursor:pointer}
.home-editor{display:grid;gap:18px}
.home-editor h3,.home-editor h4,.home-editor p{margin:0}
.home-editor h3{font-size:1.5rem}
.home-editor p{color:var(--ui-text-muted,var(--color-text-muted))}
.home-action-label{font-weight:700}
.home-editor select{width:100%;min-height:44px;padding:8px 12px;border:1px solid var(--ui-border,var(--color-border));border-radius:8px;background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text));font:inherit}
.home-section-list{border-top:1px solid var(--ui-border,var(--color-border))}
.home-section-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:60px;border-bottom:1px solid var(--ui-border,var(--color-border))}
.home-section-controls{display:flex;align-items:center;gap:4px}
.home-section-controls button{width:40px;height:44px;border:0;background:transparent;color:var(--ui-text,var(--color-text));font:inherit;cursor:pointer}
.home-section-controls button:disabled{opacity:.35;cursor:default}
.home-section-controls label{display:flex;align-items:center;gap:8px;min-height:44px;margin-left:10px}
.home-section-controls input{width:18px;height:18px}
@media(max-width:480px){.home-section-row{align-items:flex-start;flex-direction:column;padding:10px 0}.home-section-controls{align-self:flex-end}}
</style>

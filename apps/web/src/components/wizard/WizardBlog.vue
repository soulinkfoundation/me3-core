<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from "vue";
import {
  useWizardStore,
  type WizardContentAsset,
  type WizardPost,
} from "../../stores/wizard";
import { useSitesStore } from "../../stores/sites";
import { usePublish } from "../../composables/usePublish";
import TiptapEditor from "../TiptapEditor.vue";
import UiIcon from "../UiIcon.vue";

const wizard = useWizardStore();
const sites = useSitesStore();
const {
  publish,
  isPublishing,
  publishProgress,
  publishError,
  publishNeedsStorage,
} = usePublish();

// Publish function for broadcasting
async function publishSite(): Promise<void> {
  // Use the composable's publish function without celebration or opening site
  const success = await publish({ celebrate: false, openSite: false });
  if (!success) {
    throw new Error(publishError.value || "Failed to publish post");
  }
}

async function handlePublishClick() {
  try {
    if (selectedPost.value?.draft && selectedPostIndex.value !== null) {
      const now = new Date().toISOString();
      wizard.updatePost(
        selectedPostIndex.value,
        {
          draft: false,
          publishedAt: selectedPost.value.publishedAt || now,
        },
        { siteAffecting: true },
      );
      editingDate.value = formatDateInput(
        selectedPost.value.publishedAt || now,
      );
    }

    if (wizard.needsPublish) {
      await publishSite();
    }
  } catch (error) {
    console.error(error);
  }
}

// Currently selected post index for editing
const selectedPostIndex = ref<number | null>(null);

// Post title/excerpt/date inputs
const editingTitle = ref("");
const editingExcerpt = ref("");
const editingDate = ref("");
const editingSlug = ref("");
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

const selectedPost = computed(() => {
  if (selectedPostIndex.value === null) return null;
  return wizard.posts[selectedPostIndex.value] || null;
});

const selectedPostType = computed(() => selectedPost.value?.type || "article");

const previewSlug = computed(() => {
  const shouldUseCustomRoute =
    routeTouched.value || Boolean(selectedPost.value?.slugCustomized);

  if (shouldUseCustomRoute) {
    const customSlug = slugifyRouteSegment(editingSlug.value);
    if (customSlug) return customSlug;
  }

  if (!editingTitle.value.trim()) {
    return selectedPost.value?.slug || "untitled";
  }

  return slugifyRouteSegment(editingTitle.value) || "untitled";
});

const publishButtonLabel = computed(() => {
  if (isPublishing.value) return "Publishing...";
  if (selectedPost.value?.draft || wizard.needsPublish) return "Publish";
  return "Published";
});

const canRunPrimaryPublish = computed(
  () =>
    !!selectedPost.value && (!!selectedPost.value.draft || wizard.needsPublish),
);

const editorContent = ref("");
const editorRef = ref<InstanceType<typeof TiptapEditor> | null>(null);

function formatDateInput(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function setPublishedDate(value: string) {
  if (selectedPostIndex.value === null) return;
  if (!value) {
    wizard.updatePost(
      selectedPostIndex.value,
      { publishedAt: undefined },
      { siteAffecting: true },
    );
    return;
  }
  const iso = new Date(`${value}T00:00:00`).toISOString();
  wizard.updatePost(
    selectedPostIndex.value,
    { publishedAt: iso },
    { siteAffecting: true },
  );
}

function revertToDraft() {
  if (selectedPostIndex.value === null) return;
  wizard.updatePost(
    selectedPostIndex.value,
    {
      draft: true,
    },
    { siteAffecting: true },
  );
}

function handleContentAssetAdded(asset: WizardContentAsset) {
  if (selectedPostIndex.value === null) return;

  wizard.addPostContentAsset(
    selectedPostIndex.value,
    asset,
    {
      siteAffecting: true,
    },
  );
}

// Watch for post selection changes to update editor content
watch(selectedPostIndex, (newIndex) => {
  if (newIndex !== null && wizard.posts[newIndex]) {
    const post = wizard.posts[newIndex];
    editingTitle.value = post.title;
    editingExcerpt.value = post.excerpt || "";
    editingDate.value = formatDateInput(post.publishedAt);
    editingSlug.value = post.slug;
    routeTouched.value = false;
    showRouteEditor.value = false;
    editorContent.value = post.content || "";
  }
});

// Watch for editor content changes to update post
watch(editorContent, (newContent) => {
  if (selectedPostIndex.value !== null) {
    const assetIds = editorRef.value?.getAssetIds() || new Set<string>();
    wizard.updatePost(
      selectedPostIndex.value,
      {
        content: newContent,
      },
      {
        siteAffecting: true,
      },
    );
    wizard.syncPostContentAssets(selectedPostIndex.value, assetIds, {
      siteAffecting: true,
    });
  }
});

function addNewPost(type: "article" | "video") {
  const newPost = wizard.addPost("", type, {
    siteAffecting: true,
  });
  if (newPost) {
    const newIndex = wizard.posts.length - 1;
    selectedPostIndex.value = newIndex;
  }
}

function selectPost(post: { slug: string }) {
  persistPostMeta();
  // Find the original index by slug since we're displaying sorted posts
  const originalIndex = wizard.posts.findIndex((p) => p.slug === post.slug);
  selectedPostIndex.value = originalIndex >= 0 ? originalIndex : null;
}

function syncEditingRoute() {
  if (selectedPostIndex.value === null) return;
  const post = wizard.posts[selectedPostIndex.value];
  if (!post) return;
  editingSlug.value = post.slug;
  routeTouched.value = false;
}

function persistPostMeta() {
  if (selectedPostIndex.value === null) return;

  const updates: Partial<WizardPost> = {};
  if (editingTitle.value.trim()) {
    updates.title = editingTitle.value.trim();
  }
  if (routeTouched.value || selectedPost.value?.slugCustomized) {
    updates.slug = editingSlug.value;
  }
  if (Object.keys(updates).length === 0) return;

  wizard.updatePost(selectedPostIndex.value, updates, {
    siteAffecting: true,
  });
  syncEditingRoute();
}

function updatePostTitle() {
  persistPostMeta();
}

function updatePostSlug() {
  if (selectedPostIndex.value === null) return;
  const updates: Partial<WizardPost> = {
    slug: editingSlug.value,
  };
  if (editingTitle.value.trim()) {
    updates.title = editingTitle.value.trim();
  }
  wizard.updatePost(
    selectedPostIndex.value,
    updates,
    { siteAffecting: true },
  );
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
  updatePostSlug();
  closeRouteEditor();
}

function cancelRouteEdit() {
  syncEditingRoute();
  closeRouteEditor();
}

function updatePostDate() {
  if (selectedPostIndex.value === null) return;
  setPublishedDate(editingDate.value);
}

async function handleVideoFileChange(event: Event) {
  if (selectedPostIndex.value === null) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const post = wizard.posts[selectedPostIndex.value];
  const username = wizard.username || wizard.profile.handle || "";
  if (post?.media?.id && username) {
    await sites.deleteStreamVideo(username, post.media.id);
  }
  wizard.updatePost(
    selectedPostIndex.value,
    {
      mediaFile: file,
      media: undefined,
    },
    { siteAffecting: true },
  );
}

async function clearVideoMedia() {
  if (selectedPostIndex.value === null) return;
  const post = wizard.posts[selectedPostIndex.value];
  const username = wizard.username || wizard.profile.handle || "";
  if (post?.media?.id && username) {
    await sites.deleteStreamVideo(username, post.media.id);
  }
  wizard.updatePost(
    selectedPostIndex.value,
    {
      mediaFile: null,
      media: undefined,
    },
    { siteAffecting: true },
  );
}

async function deletePost(index: number) {
  if (!confirm("Delete this post?")) return;

  const post = wizard.posts[index];
  const username = wizard.username || wizard.profile.handle || "";
  if (post?.type === "video" && post?.media?.id && username) {
    await sites.deleteStreamVideo(username, post.media.id);
  }

  wizard.removePost(index, {
    siteAffecting: true,
  });

  // Adjust selection if needed
  if (selectedPostIndex.value === index) {
    selectedPostIndex.value = wizard.posts.length > 0 ? 0 : null;
  } else if (
    selectedPostIndex.value !== null &&
    selectedPostIndex.value > index
  ) {
    selectedPostIndex.value--;
  }
}

function closeEditor() {
  persistPostMeta();
  editorRef.value?.flushPendingAssets?.();
  selectedPostIndex.value = null;
}

const canAddMore = computed(() => wizard.posts.length < 50);

// Sort posts newest to oldest for display
const sortedPosts = computed(() => {
  return [...wizard.posts].sort((a, b) => {
    const aDate = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bDate = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bDate - aDate;
  });
});

// Expose editing state to parent
const isEditingPost = computed(() => selectedPostIndex.value !== null);
const activePostSlug = computed(() => selectedPost.value?.slug || null);

defineExpose({
  isEditingPost,
  activePostSlug,
});

onMounted(() => {
  void sites.fetchSites();
});
</script>

<template>
  <div class="step-blog">
    <h2>Blog</h2>
    <p>Add posts and optionally send them to email subscribers.</p>

    <div class="blog-menu-title">
      <label class="blog-menu-title-label" for="blog-menu-title-input">
        Main menu title
      </label>
      <input
        id="blog-menu-title-input"
        v-model="wizard.blogTitle"
        type="text"
        class="blog-menu-title-input"
        placeholder="Blog"
        maxlength="40"
      />
      <p class="blog-menu-title-hint">URL path: /{{ wizard.blogPath }}</p>
    </div>

    <!-- Post list -->
    <div
      v-if="wizard.posts.length > 0 && selectedPostIndex === null"
      class="post-list"
    >
      <div v-for="post in sortedPosts" :key="post.slug" class="post-item">
        <div class="post-details">
          <span class="post-title">{{ post.title }}</span>
          <span v-if="post.draft" class="post-type draft-badge">Draft</span>
          <span v-if="post.type === 'video'" class="post-type">Video</span>
          <span class="post-slug">/{{ wizard.blogPath }}/{{ post.slug }}</span>
          <span v-if="post.publishedAt" class="post-date">
            {{ new Date(post.publishedAt).toLocaleDateString() }}
          </span>
          <span v-if="post.emailedAt" class="sent-badge">
            Sent {{ new Date(post.emailedAt).toLocaleDateString() }}
          </span>
        </div>
        <div class="post-actions">
          <button
            class="action-btn edit-btn"
            type="button"
            title="Edit post"
            @click="selectPost(post)"
          >
            <UiIcon name="Pencil" :size="16" />
          </button>
          <button
            class="action-btn remove-btn"
            type="button"
            title="Delete post"
            @click="
              deletePost(wizard.posts.findIndex((p) => p.slug === post.slug))
            "
          >
            <UiIcon name="X" :size="16" />
          </button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-if="wizard.posts.length === 0 && selectedPostIndex === null"
      class="empty-state"
    >
      <p>No posts yet.</p>
      <div class="add-btn-container">
        <button
          class="primary-btn"
          :disabled="!canAddMore"
          @click="addNewPost('article')"
        >
          New article
        </button>
        <button
          class="secondary-btn"
          :disabled="!canAddMore"
          @click="addNewPost('video')"
        >
          New video
        </button>
      </div>
    </div>

    <!-- Add button -->
    <div v-if="selectedPostIndex === null" class="add-btn-container">
      <button
        class="add-btn"
        :disabled="!canAddMore"
        @click="addNewPost('article')"
      >
        + New article
      </button>
      <button
        class="add-btn"
        :disabled="!canAddMore"
        @click="addNewPost('video')"
      >
        + New video
      </button>
    </div>

    <!-- Editor -->
    <div v-if="selectedPost" class="editor">
      <div class="editor-header">
        <button class="editor-back-link" @click="closeEditor">
          ← Back to posts
        </button>
        <div class="editor-actions">
          <button
            class="editor-action publish"
            type="button"
            :disabled="isPublishing || !canRunPrimaryPublish"
            @click="handlePublishClick"
          >
            {{ publishButtonLabel }}
          </button>
        </div>
      </div>

      <p v-if="publishProgress" class="publish-status">
        {{ publishProgress }}
      </p>
      <p v-if="publishError" class="publish-status error">
        {{ publishError }}
        <router-link
          v-if="publishNeedsStorage"
          to="/account?section=storage"
        >
          Activate storage
        </router-link>
      </p>

      <div class="editor-header-title-date">
        <div class="field field-title">
          <label for="blog-title-input">Title</label>
          <input
            id="blog-title-input"
            v-model="editingTitle"
            type="text"
            placeholder="Post title"
            @blur="updatePostTitle"
          />
        </div>
        <div class="field">
          <label for="blog-date-input">Date</label>
          <input
            id="blog-date-input"
            v-model="editingDate"
            type="date"
            :disabled="selectedPost?.draft"
            @change="updatePostDate"
          />
        </div>
      </div>

      <div class="editor-meta">
        <div class="editor-meta-right">
          <div class="route-row">
            <template v-if="showRouteEditor">
              <span class="slug-preview">URL: /{{ wizard.blogPath }}/</span>
              <input
                id="blog-route-input"
                ref="routeInputRef"
                v-model="editingSlug"
                class="route-inline-input"
                type="text"
                inputmode="url"
                placeholder="post-title"
                @input="routeTouched = true"
                @blur="handleRouteBlur"
                @keydown.esc.prevent="cancelRouteEdit"
                @keyup.enter="($event.target as HTMLInputElement).blur()"
              />
            </template>
            <template v-else>
              <div class="slug-preview">
                URL: /{{ wizard.blogPath }}/{{ previewSlug }}
              </div>
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
          <button
            v-if="!selectedPost?.draft"
            class="revert-draft-link"
            type="button"
            @click="revertToDraft"
          >
            Revert to Draft
          </button>
        </div>
      </div>

      <div v-if="selectedPostType === 'video'" class="video-panel">
        <div class="field">
          <label>Video file</label>
          <input type="file" accept="video/*" @change="handleVideoFileChange" />
        </div>
        <div class="video-status" v-if="selectedPost.media?.url">
          Video ready
        </div>
        <div class="video-status" v-else-if="selectedPost.mediaFile">
          File selected — will upload on publish.
        </div>
        <button class="secondary-btn" type="button" @click="clearVideoMedia">
          Clear video
        </button>
      </div>
      <TiptapEditor
        ref="editorRef"
        v-model="editorContent"
        placeholder="Write your post here..."
        @asset-added="handleContentAssetAdded"
      />
    </div>

  </div>
</template>

<style scoped>
.editor-header-title-date {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.editor-header-title-date .field-title {
  flex: 1;
}

.editor-header-title-date .field-route {
  min-width: 180px;
}

.route-row {
  display: flex;
  align-items: center;
  gap: 8px;
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

.editor-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.step-blog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.blog-menu-title {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg);
}

.blog-menu-title-label {
  font-size: 13px;
  font-weight: 600;
}

.blog-menu-title-input {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface, var(--color-bg));
  color: var(--color-text);
  font: inherit;
}

.blog-menu-title-hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.post-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg);
}

.post-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.post-title {
  font-weight: 600;
  font-size: 14px;
}

.post-type {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: rgba(0, 0, 0, 0.08);
}

.post-slug,
.post-date {
  color: var(--color-text-muted);
  font-size: 12px;
}

.sent-badge {
  color: #059669;
  font-size: 12px;
  font-weight: 500;
}

.sent-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stats-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  padding: 4px 8px;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.stats-btn:hover {
  background: var(--color-border);
}

.post-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--color-text);
}

.empty-state {
  border: 1px dashed var(--color-border);
  padding: 16px;
  border-radius: 12px;
  text-align: center;
}

.add-btn,
.primary-btn,
.secondary-btn,
.back-btn {
  border: none;
  border-radius: 999px;
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
}

.primary-btn {
  background: var(--color-accent);
  color: var(--color-bg);
}

.secondary-btn {
  background: var(--color-border);
  color: var(--color-text);
}

.add-btn-container {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 8px;
}

.add-btn {
  background: var(--color-border);
  color: var(--color-text);
  align-self: flex-start;
}

.editor {
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 18px;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.video-panel {
  border: 1px dashed var(--color-border);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.02);
}

.video-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
}

.video-status {
  font-size: 12px;
  font-weight: 600;
  color: #059669;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.slug-preview {
  color: var(--color-text-muted);
  font-size: 12px;
  letter-spacing: 0.02em;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.field input,
.field textarea {
  padding: 6px 8px 8px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 14px;
}

.field textarea {
  resize: vertical;
  min-height: 54px;
}

.field-title input {
  font-size: 22px;
  font-weight: 600;
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

.editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.editor-action {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.editor-action.send span {
  padding-right: 6px;
}

.editor-action.publish {
  background: var(--color-text);
  color: var(--color-bg);
  border-color: var(--color-text);
}

.editor-action:disabled,
.editor-action[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.editor-action:hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--color-border);
  color: var(--color-text);
}

.editor-action.publish:hover:not(:disabled):not([aria-disabled="true"]) {
  opacity: 0.92;
}

.publish-status {
  margin: -4px 0 4px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.publish-status.error {
  color: #dc2626;
}

.publish-status a {
  color: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.draft-badge {
  background: rgba(255, 165, 0, 0.15) !important;
  color: #ff8c00 !important;
}

.editor-meta-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.revert-draft-link {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  padding: 0;
  cursor: pointer;
  font-size: 11px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.revert-draft-link:hover {
  color: var(--color-text);
}
</style>

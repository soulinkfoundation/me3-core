<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { API_BASE, api } from "../../api";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";
import type { DriveFile, DriveFolder } from "../../stores/social";

type MediaKind = "image" | "video";
type Filter = "all" | MediaKind;

/**
 * Picks existing photos and videos from ME3 Files. Photos stack up in the order
 * they're picked; a video is always on its own, so picking one clears the rest.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    kinds?: MediaKind[];
    title?: string;
  }>(),
  { kinds: () => ["image", "video"], title: "Choose from Files" },
);

const emit = defineEmits<{
  close: [];
  select: [files: DriveFile[]];
}>();

const { toastFromUnknown } = useAppToast();
const titleId = `files-picker-${useId()}`;
const folders = ref<DriveFolder[]>([]);
const files = ref<DriveFile[]>([]);
const folderId = ref<string | null>(null);
const query = ref("");
const filter = ref<Filter>("all");
const picked = ref<DriveFile[]>([]);
const loading = ref(false);
let loadToken = 0;

const allowsBoth = computed(() => props.kinds.includes("image") && props.kinds.includes("video"));

const crumbs = computed(() => {
  const trail: DriveFolder[] = [];
  let current = folders.value.find((folder) => folder.id === folderId.value);
  while (current) {
    trail.unshift(current);
    current = folders.value.find((folder) => folder.id === current!.parentId);
  }
  return trail;
});

const needle = computed(() => query.value.trim().toLowerCase());

const visibleFolders = computed(() =>
  folders.value
    .filter((folder) => folder.parentId === folderId.value)
    .filter((folder) => !needle.value || folder.name.toLowerCase().includes(needle.value))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const visibleFiles = computed(() =>
  files.value
    .filter((file) => file.status === "ready")
    .filter((file) => {
      const kind = mediaKind(file);
      return kind && props.kinds.includes(kind) && (filter.value === "all" || filter.value === kind);
    })
    .filter((file) => !needle.value || file.filename.toLowerCase().includes(needle.value)),
);

const pickedVideo = computed(() => picked.value.some((file) => mediaKind(file) === "video"));
const summary = computed(() => {
  if (!picked.value.length) return "";
  if (pickedVideo.value) return "1 video";
  return picked.value.length === 1 ? "1 photo selected" : `${picked.value.length} photos selected`;
});

function mediaKind(file: DriveFile): MediaKind | null {
  if (file.mimeType.startsWith("image/")) return "image";
  if (file.mimeType.startsWith("video/")) return "video";
  return null;
}

function contentUrl(file: DriveFile): string {
  return `${API_BASE}/files/${encodeURIComponent(file.id)}/content`;
}

function extension(file: DriveFile): string {
  return file.filename.split(".").pop()?.toUpperCase().slice(0, 4) || "VIDEO";
}

function pickIndex(file: DriveFile): number {
  return picked.value.findIndex((item) => item.id === file.id);
}

function toggle(file: DriveFile) {
  const index = pickIndex(file);
  if (index >= 0) {
    picked.value = picked.value.filter((item) => item.id !== file.id);
    return;
  }
  // One video per post, and never mixed with photos.
  if (mediaKind(file) === "video" || pickedVideo.value) picked.value = [file];
  else picked.value = [...picked.value, file];
}

async function loadFolder(id: string | null) {
  const token = ++loadToken;
  folderId.value = id;
  loading.value = true;
  try {
    const query = id ? `?folderId=${encodeURIComponent(id)}` : "";
    const data = await api.get<{ files: DriveFile[] }>(`/files/items${query}`);
    if (token === loadToken) files.value = data.files || [];
  } catch (caught) {
    if (token === loadToken) files.value = [];
    toastFromUnknown(caught, "Couldn't open that folder.");
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

function openFolder(id: string | null) {
  query.value = "";
  void loadFolder(id);
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    picked.value = [];
    query.value = "";
    filter.value = "all";
    const [folderData] = await Promise.all([
      api.get<{ folders: DriveFolder[] }>("/files/folders").catch(() => ({ folders: [] as DriveFolder[] })),
      loadFolder(null),
    ]);
    folders.value = folderData.folders || [];
  },
  { immediate: true },
);

function confirm() {
  if (!picked.value.length) return;
  emit("select", picked.value);
  emit("close");
}
</script>

<template>
  <AppDialog :open="open" :labelled-by="titleId" close-on-backdrop @close="emit('close')">
    <div class="files-picker">
      <header class="files-picker__head">
        <h2 :id="titleId">{{ title }}</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="18" />
        </Button>
      </header>

      <div class="files-picker__tools">
        <label class="files-picker__search">
          <UiIcon name="Search" :size="16" />
          <span class="visually-hidden">Search files</span>
          <input v-model="query" type="search" placeholder="Search files">
        </label>
        <div v-if="allowsBoth" class="files-picker__filter" role="radiogroup" aria-label="Show">
          <button
            v-for="option in [{ id: 'all', label: 'All' }, { id: 'image', label: 'Photos' }, { id: 'video', label: 'Videos' }] as const"
            :key="option.id"
            type="button"
            role="radio"
            :aria-checked="filter === option.id"
            :class="{ 'is-on': filter === option.id }"
            @click="filter = option.id"
          >{{ option.label }}</button>
        </div>
      </div>

      <nav class="files-picker__crumbs" aria-label="Folder">
        <template v-if="crumbs.length">
          <button type="button" @click="openFolder(null)">Files</button>
          <template v-for="(folder, index) in crumbs" :key="folder.id">
            <UiIcon name="ChevronRight" :size="14" />
            <strong v-if="index === crumbs.length - 1">{{ folder.name }}</strong>
            <button v-else type="button" @click="openFolder(folder.id)">{{ folder.name }}</button>
          </template>
        </template>
        <strong v-else>Files</strong>
      </nav>

      <div class="files-picker__body">
        <ul v-if="visibleFolders.length" class="files-picker__folders">
          <li v-for="folder in visibleFolders" :key="folder.id">
            <button type="button" @click="openFolder(folder.id)">
              <UiIcon name="Folder" :size="16" />
              <span>{{ folder.name }}</span>
              <UiIcon name="ChevronRight" :size="16" />
            </button>
          </li>
        </ul>

        <p v-if="loading && !files.length" class="files-picker__empty">Loading…</p>
        <p v-else-if="!visibleFiles.length" class="files-picker__empty">
          {{ needle ? "Nothing matches that search" : kinds.length === 1 && kinds[0] === "video" ? "No videos here" : kinds.length === 1 ? "No photos here" : "No photos or videos here" }}
        </p>
        <ul v-else class="files-picker__grid" aria-label="Files">
          <li v-for="file in visibleFiles" :key="file.id">
            <button
              type="button"
              class="files-picker__tile"
              :class="{ 'is-picked': pickIndex(file) >= 0 }"
              :aria-pressed="pickIndex(file) >= 0"
              :aria-label="file.filename"
              @click="toggle(file)"
            >
              <video v-if="mediaKind(file) === 'video'" :src="`${contentUrl(file)}#t=0.1`" preload="metadata" muted playsinline />
              <img v-else :src="contentUrl(file)" alt="" loading="lazy">
              <span v-if="mediaKind(file) === 'video'" class="files-picker__badge">
                <UiIcon name="Play" :size="11" /> {{ extension(file) }}
              </span>
              <span class="files-picker__check" aria-hidden="true">
                <template v-if="pickIndex(file) >= 0">
                  <UiIcon v-if="mediaKind(file) === 'video'" name="Check" :size="12" />
                  <template v-else>{{ pickIndex(file) + 1 }}</template>
                </template>
              </span>
              <span class="files-picker__name">{{ file.filename }}</span>
            </button>
          </li>
        </ul>
      </div>

      <footer class="files-picker__foot">
        <span class="files-picker__summary" aria-live="polite">{{ summary }}</span>
        <div class="files-picker__actions">
          <Button color="ghost" shape="pill" size="compact" @click="emit('close')">Cancel</Button>
          <Button color="primary" shape="pill" size="compact" :disabled="!picked.length" @click="confirm">
            {{ picked.length > 1 ? `Add ${picked.length}` : "Add" }}
          </Button>
        </div>
      </footer>
    </div>
  </AppDialog>
</template>

<style scoped>
.files-picker {
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  width: min(640px, calc(100vw - 32px));
  height: min(600px, calc(100dvh - 48px));
  overflow: hidden;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
  color: var(--ui-text);
}
.files-picker__head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 4px; }
.files-picker__head h2 { margin: 0; font-size: 17px; font-weight: 650; }
.files-picker__tools { display: flex; align-items: center; gap: 10px; padding: 8px 18px; }
.files-picker__search {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  color: var(--ui-text-muted);
}
.files-picker__search:focus-within { border-color: var(--ui-focus, var(--ui-accent)); }
.files-picker__search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--ui-text); font: 14px var(--font-sans); }
.files-picker__filter { display: inline-flex; flex: none; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.files-picker__filter button {
  padding: 4px 11px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  font: 500 13px var(--font-sans);
  cursor: pointer;
}
.files-picker__filter button.is-on { background: var(--ui-primary); color: var(--ui-primary-contrast); }
.files-picker__crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 18px 8px; color: var(--ui-text-muted); font-size: 13px; }
.files-picker__crumbs button { padding: 0; border: 0; background: none; color: var(--ui-text-muted); font: inherit; cursor: pointer; }
.files-picker__crumbs button:hover, .files-picker__crumbs button:focus-visible { color: var(--ui-text); text-decoration: underline; outline: none; }
.files-picker__crumbs strong { color: var(--ui-text); font-weight: 600; }
.files-picker__body { overflow: auto; padding: 0 18px 12px; }
.files-picker__folders { margin: 0 0 12px; padding: 0; list-style: none; }
.files-picker__folders button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 4px;
  border: 0;
  border-bottom: 1px solid var(--ui-border);
  background: none;
  color: var(--ui-text);
  font: 14px var(--font-sans);
  text-align: left;
  cursor: pointer;
}
.files-picker__folders button span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files-picker__folders button > :last-child { color: var(--ui-text-muted); }
.files-picker__folders button:hover, .files-picker__folders button:focus-visible { background: var(--ui-surface-muted); outline: none; }
.files-picker__empty { margin: 40px 0; color: var(--ui-text-muted); text-align: center; }
.files-picker__grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; }
.files-picker__tile {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
  cursor: pointer;
}
.files-picker__tile img, .files-picker__tile video { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.files-picker__tile.is-picked { outline: 3px solid var(--ui-accent); outline-offset: -3px; }
.files-picker__tile:focus-visible { outline: 3px solid var(--ui-focus, var(--ui-accent)); outline-offset: -3px; }
.files-picker__name {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 14px 6px 4px;
  overflow: hidden;
  background: linear-gradient(transparent, rgba(0, 0, 0, .55));
  color: #fff;
  font-size: 11px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files-picker__badge {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px 2px 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .6);
  color: #fff;
  font: 600 10px var(--font-sans);
}
.files-picker__check {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: rgba(0, 0, 0, .2);
  color: #fff;
  font: 700 12px var(--font-sans);
}
.is-picked .files-picker__check { border-color: var(--ui-accent); background: var(--ui-accent); color: var(--ui-accent-contrast, #fff); }
.files-picker__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--ui-border); }
.files-picker__summary { color: var(--ui-text-muted); font-size: 13px; }
.files-picker__actions { display: flex; gap: 8px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 640px) {
  .files-picker { width: 100vw; height: calc(100dvh - 56px); border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; }
  .files-picker__head { padding: 12px 16px 4px; }
  .files-picker__tools { flex-direction: column; align-items: stretch; gap: 8px; padding: 6px 16px; }
  .files-picker__filter { align-self: flex-start; }
  .files-picker__crumbs { padding: 2px 16px 6px; }
  .files-picker__body { padding: 0 16px 10px; }
  .files-picker__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .files-picker__foot { padding: 10px 16px calc(14px + env(safe-area-inset-bottom)); }
}
</style>

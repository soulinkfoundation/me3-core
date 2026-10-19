<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { API_BASE, ApiError, api } from "../api";
import AppPageBar from "../components/AppPageBar.vue";
import Button from "../components/Button.vue";
import PageLoading from "../components/PageLoading.vue";
import UiIcon from "../components/UiIcon.vue";
import { useAppToast } from "../composables/useAppToast";
import {
  uploadDriveFiles,
  type DriveUploadProgress,
} from "../utils/drive-upload";
import type { UiIconName } from "../utils/icons";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "Files | ME3",
    description: "Browse private ME3 files stored in R2.",
    robots: "noindex,follow",
  },
});

type PreviewKind =
  | "image"
  | "pdf"
  | "text"
  | "markdown"
  | "csv"
  | "spreadsheet"
  | "download";

type DriveFolder = {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  path: string;
  status: "active" | "trashed";
  createdAt: string;
  updatedAt: string;
};

type DriveFile = {
  id: string;
  ownerId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  etag: string | null;
  sha256: string | null;
  status: "uploading" | "ready" | "trashed" | "failed";
  previewKind: PreviewKind;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type FilesStatusResponse = {
  ok: true;
  r2Available: boolean;
  binding: "SITE_ASSETS";
};

type FoldersResponse = {
  ok: true;
  folders: DriveFolder[];
};

type ItemsResponse = {
  ok: true;
  folderId: string | null;
  q: string;
  folders: DriveFolder[];
  files: DriveFile[];
};

type PreviewResponse =
  | {
      ok: true;
      file: DriveFile;
      previewKind: "image" | "pdf" | "download" | "spreadsheet";
      truncated: false;
    }
  | {
      ok: true;
      file: DriveFile;
      previewKind: "text" | "markdown" | "csv";
      text: string;
      truncated: boolean;
    };

type DriveItem =
  | { kind: "folder"; id: string; folder: DriveFolder }
  | { kind: "file"; id: string; file: DriveFile };

type DialogMode = "new-folder" | "rename" | "move" | "delete";

const status = ref<FilesStatusResponse | null>(null);
const folders = ref<DriveFolder[]>([]);
const currentFolders = ref<DriveFolder[]>([]);
const currentFiles = ref<DriveFile[]>([]);
const currentFolderId = ref<string | null>(null);
const selected = ref<{ kind: DriveItem["kind"]; id: string } | null>(null);
const preview = ref<PreviewResponse | null>(null);
const pdfPreviewUrl = ref("");
const loading = ref(true);
const itemsLoading = ref(false);
const previewLoading = ref(false);
const uploadBusy = ref(false);
const uploadProgress = ref<DriveUploadProgress | null>(null);
const actionBusy = ref(false);
const dropActive = ref(false);
const error = ref("");
const searchQuery = ref("");
const sortKey = ref<"name" | "modified" | "size">("name");
const sortDirection = ref<"asc" | "desc">("asc");
const rowMenuId = ref<string | null>(null);
const uploadInput = ref<HTMLInputElement | null>(null);
const dialogMode = ref<DialogMode | null>(null);
const dialogItem = ref<DriveItem | null>(null);
const dialogName = ref("");
const dialogFolderId = ref<string | null>(null);
let searchTimer: number | null = null;
let previewRequestId = 0;
const { toastSuccess } = useAppToast();

const r2Available = computed(() => status.value?.r2Available === true);
const combinedItems = computed<DriveItem[]>(() => [
  ...currentFolders.value.map((folder) => ({
    kind: "folder" as const,
    id: folder.id,
    folder,
  })),
  ...currentFiles.value.map((file) => ({
    kind: "file" as const,
    id: file.id,
    file,
  })),
]);
const sortedItems = computed(() => {
  return [...combinedItems.value].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    const direction = sortDirection.value === "asc" ? 1 : -1;
    if (sortKey.value === "modified") {
      return (
        (new Date(itemUpdatedAt(a)).getTime() - new Date(itemUpdatedAt(b)).getTime()) *
        direction
      );
    }
    if (sortKey.value === "size") {
      return (itemSize(a) - itemSize(b)) * direction;
    }
    return itemName(a).localeCompare(itemName(b), undefined, { sensitivity: "base" }) * direction;
  });
});
const selectedItem = computed(() => {
  if (!selected.value) return null;
  return (
    combinedItems.value.find(
      (item) => item.kind === selected.value?.kind && item.id === selected.value?.id,
    ) || null
  );
});
const selectedFile = computed(() =>
  selectedItem.value?.kind === "file" ? selectedItem.value.file : null,
);
const selectedFolder = computed(() =>
  selectedItem.value?.kind === "folder" ? selectedItem.value.folder : null,
);
const folderOptions = computed(() => {
  const movingFolder = dialogItem.value?.kind === "folder" ? dialogItem.value.folder : null;
  return folders.value.filter((folder) => {
    if (!movingFolder) return true;
    return folder.id !== movingFolder.id && !folder.path.startsWith(`${movingFolder.path}/`);
  });
});
const dialogTitle = computed(() => {
  if (dialogMode.value === "new-folder") return "New folder";
  if (dialogMode.value === "rename") return `Rename ${dialogItemName.value}`;
  if (dialogMode.value === "move") return `Move ${dialogItemName.value}`;
  if (dialogMode.value === "delete") return `Delete ${dialogItemName.value}`;
  return "";
});
const dialogItemName = computed(() => (dialogItem.value ? itemName(dialogItem.value) : "item"));
const dialogSubmitLabel = computed(() => {
  if (dialogMode.value === "delete") return "Delete";
  if (dialogMode.value === "move") return "Move";
  if (dialogMode.value === "rename") return "Rename";
  return "Create";
});
const dialogSubmitDisabled = computed(() => {
  if (actionBusy.value) return true;
  if (dialogMode.value === "new-folder" || dialogMode.value === "rename") {
    return dialogName.value.trim().length === 0;
  }
  return false;
});
const previewText = computed(() =>
  preview.value && "text" in preview.value ? preview.value.text : "",
);
const csvRows = computed(() => {
  if (!preview.value || preview.value.previewKind !== "csv" || !("text" in preview.value)) {
    return [];
  }
  return preview.value.text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 30)
    .map(parseCsvLine)
    .slice(0, 30);
});
const hasItems = computed(() => currentFolders.value.length > 0 || currentFiles.value.length > 0);
const isSearching = computed(() => searchQuery.value.trim().length > 0);

onMounted(() => {
  document.addEventListener("click", closeRowMenu);
  void loadInitial();
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeRowMenu);
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  clearPdfPreviewUrl();
});

watch(currentFolderId, () => {
  selected.value = null;
  preview.value = null;
  void loadItems();
});

watch(searchQuery, () => {
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    void loadItems();
  }, 220);
});

watch(selectedFile, (file) => {
  if (!file) {
    previewRequestId += 1;
    preview.value = null;
    clearPdfPreviewUrl();
    return;
  }
  void loadPreview(file.id);
});

async function loadInitial() {
  loading.value = true;
  error.value = "";
  try {
    status.value = await api.get<FilesStatusResponse>("/files/status");
    if (status.value.r2Available) {
      await refreshFoldersAndItems();
    }
  } catch (e) {
    error.value = apiErrorMessage(e, "Failed to load Files");
  } finally {
    loading.value = false;
  }
}

async function refreshFoldersAndItems() {
  await Promise.all([loadFolders(), loadItems()]);
}

async function loadFolders() {
  const response = await api.get<FoldersResponse>("/files/folders");
  folders.value = response.folders;
}

async function loadItems() {
  if (!r2Available.value) return;
  itemsLoading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (currentFolderId.value) params.set("folderId", currentFolderId.value);
    const query = searchQuery.value.trim();
    if (query) params.set("q", query);
    const response = await api.get<ItemsResponse>(
      `/files/items${params.toString() ? `?${params.toString()}` : ""}`,
    );
    currentFolders.value = response.folders;
    currentFiles.value = response.files;
    reconcileSelection();
  } catch (e) {
    error.value = apiErrorMessage(e, "Failed to load files");
  } finally {
    itemsLoading.value = false;
  }
}

async function loadPreview(fileId: string) {
  const requestId = ++previewRequestId;
  previewLoading.value = true;
  preview.value = null;
  clearPdfPreviewUrl();
  try {
    const nextPreview = await api.get<PreviewResponse>(
      `/files/${encodeURIComponent(fileId)}/preview`,
    );
    if (requestId !== previewRequestId) return;
    preview.value = nextPreview;

    if (nextPreview.previewKind === "pdf") {
      const response = await fetch(contentUrl(nextPreview.file), { credentials: "include" });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let message = body;
        try {
          message = (JSON.parse(body) as { error?: string }).error || body;
        } catch {
          // Keep the response text as the fallback error message.
        }
        throw new ApiError(message || "Failed to load PDF preview", response.status);
      }
      const url = URL.createObjectURL(await response.blob());
      if (requestId !== previewRequestId) {
        URL.revokeObjectURL(url);
        return;
      }
      pdfPreviewUrl.value = url;
    }
  } catch (e) {
    if (requestId === previewRequestId) {
      error.value = apiErrorMessage(e, "Failed to load preview");
    }
  } finally {
    if (requestId === previewRequestId) previewLoading.value = false;
  }
}

function clearPdfPreviewUrl() {
  if (pdfPreviewUrl.value) URL.revokeObjectURL(pdfPreviewUrl.value);
  pdfPreviewUrl.value = "";
}

function openFolder(folderId: string | null) {
  currentFolderId.value = folderId;
  rowMenuId.value = null;
}

function selectItem(item: DriveItem) {
  selected.value = { kind: item.kind, id: item.id };
}

function closePreview() {
  selected.value = null;
  rowMenuId.value = null;
}

function activateItem(item: DriveItem) {
  if (item.kind === "folder") {
    openFolder(item.id);
  } else {
    selectItem(item);
  }
}

function handleRowKeydown(event: KeyboardEvent, item: DriveItem) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateItem(item);
  }
}

function openNewFolderDialog() {
  dialogMode.value = "new-folder";
  dialogItem.value = null;
  dialogName.value = "";
  dialogFolderId.value = currentFolderId.value;
}

function openRenameDialog(item: DriveItem | null = selectedItem.value) {
  if (!item) return;
  dialogMode.value = "rename";
  dialogItem.value = item;
  dialogName.value = itemName(item);
  dialogFolderId.value = null;
  rowMenuId.value = null;
}

function openMoveDialog(item: DriveItem | null = selectedItem.value) {
  if (!item) return;
  dialogMode.value = "move";
  dialogItem.value = item;
  dialogName.value = "";
  dialogFolderId.value = item.kind === "folder" ? item.folder.parentId : item.file.folderId;
  rowMenuId.value = null;
}

function openDeleteDialog(item: DriveItem | null = selectedItem.value) {
  if (!item) return;
  dialogMode.value = "delete";
  dialogItem.value = item;
  dialogName.value = "";
  dialogFolderId.value = null;
  rowMenuId.value = null;
}

function closeDialog() {
  if (actionBusy.value) return;
  dialogMode.value = null;
  dialogItem.value = null;
  dialogName.value = "";
  dialogFolderId.value = null;
}

async function submitDialog() {
  if (!dialogMode.value || dialogSubmitDisabled.value) return;
  actionBusy.value = true;
  error.value = "";
  try {
    if (dialogMode.value === "new-folder") {
      const response = await api.post<{ ok: true; folder: DriveFolder }>("/files/folders", {
        name: dialogName.value.trim(),
        parentId: currentFolderId.value,
      });
      toastSuccess("Folder created.");
      selected.value = { kind: "folder", id: response.folder.id };
    } else if (dialogMode.value === "rename" && dialogItem.value) {
      await renameItem(dialogItem.value, dialogName.value.trim());
      toastSuccess("Renamed.");
    } else if (dialogMode.value === "move" && dialogItem.value) {
      await moveItem(dialogItem.value, dialogFolderId.value);
      toastSuccess("Moved.");
    } else if (dialogMode.value === "delete" && dialogItem.value) {
      await deleteItem(dialogItem.value);
      toastSuccess("Deleted.");
      selected.value = null;
    }
    closeDialogAfterAction();
    await refreshFoldersAndItems();
  } catch (e) {
    error.value = apiErrorMessage(e, "Action failed");
  } finally {
    actionBusy.value = false;
  }
}

async function renameItem(item: DriveItem, name: string) {
  if (item.kind === "folder") {
    await api.put(`/files/folders/${encodeURIComponent(item.id)}`, { name });
  } else {
    await api.put(`/files/${encodeURIComponent(item.id)}`, { filename: name });
  }
}

async function moveItem(item: DriveItem, folderId: string | null) {
  if (item.kind === "folder") {
    await api.put(`/files/folders/${encodeURIComponent(item.id)}`, { parentId: folderId });
  } else {
    await api.put(`/files/${encodeURIComponent(item.id)}`, { folderId });
  }
}

async function deleteItem(item: DriveItem) {
  if (item.kind === "folder") {
    await api.delete(`/files/folders/${encodeURIComponent(item.id)}`);
  } else {
    await api.delete(`/files/${encodeURIComponent(item.id)}`);
  }
}

function closeDialogAfterAction() {
  dialogMode.value = null;
  dialogItem.value = null;
  dialogName.value = "";
  dialogFolderId.value = null;
}

function triggerUpload() {
  uploadInput.value?.click();
}

async function handleUploadInput(event: Event) {
  const input = event.target as HTMLInputElement;
  await uploadFileList(input.files);
  input.value = "";
}

async function uploadFileList(list: FileList | File[] | null | undefined) {
  const filesToUpload = Array.from(list || []);
  if (filesToUpload.length === 0 || uploadBusy.value) return;
  uploadBusy.value = true;
  error.value = "";
  try {
    const uploadedFiles = await uploadDriveFiles<DriveFile>(filesToUpload, {
      folderId: currentFolderId.value,
      onProgress: (progress) => {
        uploadProgress.value = progress;
      },
    });
    const uploadMessage =
      uploadedFiles.length === 1
        ? `${uploadedFiles[0]?.filename || "File"} uploaded.`
        : `${uploadedFiles.length} files uploaded.`;
    toastSuccess(uploadMessage);
    if (uploadedFiles[0]) selected.value = { kind: "file", id: uploadedFiles[0].id };
    await refreshFoldersAndItems();
  } catch (e) {
    error.value = `${apiErrorMessage(e, "Upload failed")} Choose the same file again to resume.`;
  } finally {
    uploadBusy.value = false;
    uploadProgress.value = null;
  }
}

function handleDrop(event: DragEvent) {
  dropActive.value = false;
  void uploadFileList(event.dataTransfer?.files);
}

function toggleSortDirection() {
  sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
}

function toggleRowMenu(item: DriveItem, event: MouseEvent) {
  event.stopPropagation();
  const id = rowKey(item);
  rowMenuId.value = rowMenuId.value === id ? null : id;
}

function closeRowMenu() {
  rowMenuId.value = null;
}

function reconcileSelection() {
  if (!selected.value) return;
  const stillVisible = combinedItems.value.some(
    (item) => item.kind === selected.value?.kind && item.id === selected.value.id,
  );
  if (!stillVisible) {
    selected.value = null;
    preview.value = null;
  }
}

function rowKey(item: DriveItem): string {
  return `${item.kind}:${item.id}`;
}

function itemName(item: DriveItem): string {
  return item.kind === "folder" ? item.folder.name : item.file.filename;
}

function itemUpdatedAt(item: DriveItem): string {
  return item.kind === "folder" ? item.folder.updatedAt : item.file.updatedAt;
}

function itemSize(item: DriveItem): number {
  return item.kind === "folder" ? 0 : item.file.size;
}

function itemPreviewKind(item: DriveItem): PreviewKind | "folder" {
  return item.kind === "folder" ? "folder" : item.file.previewKind;
}

function itemIcon(item: DriveItem): UiIconName {
  if (item.kind === "folder") return "Folder";
  if (item.file.previewKind === "image") return "Image";
  if (item.file.previewKind === "pdf") return "FileText";
  if (item.file.previewKind === "spreadsheet" || item.file.previewKind === "csv") return "LayoutGrid";
  return "FileText";
}

function formatPreviewKind(kind: PreviewKind | "folder"): string {
  if (kind === "folder") return "Folder";
  if (kind === "pdf") return "PDF";
  if (kind === "csv") return "CSV";
  if (kind === "spreadsheet") return "Spreadsheet";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 104857.6) / 10} MB`;
  return `${Math.round(bytes / 107374182.4) / 10} GB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function contentUrl(file: DriveFile, download = false): string {
  return `${API_BASE}/files/${encodeURIComponent(file.id)}/content${download ? "?download=1" : ""}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.slice(0, 12);
}

function apiErrorMessage(errorValue: unknown, fallback: string): string {
  if (errorValue instanceof ApiError) return errorValue.message;
  if (errorValue instanceof Error) return errorValue.message;
  return fallback;
}
</script>

<template>
  <main class="files-page">
    <Teleport
      v-if="r2Available"
      to="#app-page-controls"
      defer
    >
      <div class="files-mobile-controls">
        <form class="files-search" role="search" @submit.prevent="loadItems">
          <UiIcon name="Search" :size="16" aria-hidden="true" />
          <label class="sr-only" for="files-search-input">Search files</label>
          <input
            id="files-search-input"
            v-model="searchQuery"
            type="search"
            placeholder="Search"
          />
        </form>

        <Button
          color="outline"
          shape="soft"
          size="compact"
          type="button"
          @click="openNewFolderDialog"
        >
          <template #icon>
            <UiIcon name="Folder" :size="15" aria-hidden="true" />
          </template>
          New folder
        </Button>

        <Button
          color="primary"
          shape="soft"
          size="compact"
          type="button"
          :disabled="uploadBusy"
          @click="triggerUpload"
        >
          <template #icon>
            <UiIcon name="Upload" :size="15" aria-hidden="true" />
          </template>
          {{ uploadBusy ? "Uploading" : "Upload" }}
        </Button>
      </div>
    </Teleport>

    <input
      ref="uploadInput"
      class="files-hidden-input"
      type="file"
      multiple
      @change="handleUploadInput"
    />

    <PageLoading v-if="loading" label="Loading files..." />

    <section v-else-if="!r2Available" class="files-empty-setup">
      <AppPageBar title="Files" />
      <div class="files-empty-setup__icon" aria-hidden="true">📂</div>
      <h1>Files need storage</h1>
      <Button color="primary" shape="soft" size="medium" to="/account?section=storage">
        Configure storage
      </Button>
    </section>

    <section
      v-else
      class="files-workspace"
      :class="{ 'is-drop-active': dropActive }"
      @dragenter.prevent="dropActive = true"
      @dragover.prevent="dropActive = true"
      @dragleave.prevent="dropActive = false"
      @drop.prevent="handleDrop"
    >
      <div v-if="error || uploadProgress" class="files-status-line" aria-live="polite">
        <p v-if="error" class="files-status-line__error" role="alert">{{ error }}</p>
        <div v-else-if="uploadProgress" class="files-upload-progress" role="status">
          <span>
            Uploading {{ uploadProgress.filename }} · {{ uploadProgress.percent }}%
          </span>
          <progress :value="uploadProgress.percent" max="100">
            {{ uploadProgress.percent }}%
          </progress>
        </div>
      </div>

      <div class="files-body" :class="{ 'files-body--preview-open': selectedFile }">
        <aside class="files-tree" aria-label="Folders">
          <button
            type="button"
            class="files-tree__row"
            :class="{ 'is-active': currentFolderId === null }"
            @click="openFolder(null)"
          >
            <UiIcon name="Folder" :size="16" aria-hidden="true" />
            <span>Files</span>
          </button>
          <button
            v-for="folder in folders"
            :key="folder.id"
            type="button"
            class="files-tree__row"
            :class="{ 'is-active': currentFolderId === folder.id }"
            :style="{ '--folder-depth': String(folder.path.split('/').length + 1) }"
            @click="openFolder(folder.id)"
          >
            <UiIcon name="Folder" :size="16" aria-hidden="true" />
            <span>{{ folder.name }}</span>
          </button>
        </aside>

        <section class="files-list-panel" aria-label="Current folder">
          <div class="files-list-controls">
            <div class="files-list-controls__meta">
              <span>{{ sortedItems.length }} items</span>
              <span v-if="isSearching">Search: {{ searchQuery.trim() }}</span>
              <PageLoading v-if="itemsLoading" label="Refreshing files" />
            </div>
            <div class="files-list-controls__sort">
              <label for="files-sort-select">Sort</label>
              <select id="files-sort-select" v-model="sortKey">
                <option value="name">Name</option>
                <option value="modified">Modified</option>
                <option value="size">Size</option>
              </select>
              <button
                type="button"
                class="files-icon-button"
                :aria-label="sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'"
                :title="sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'"
                @click="toggleSortDirection"
              >
                <UiIcon
                  :name="sortDirection === 'asc' ? 'ArrowUp' : 'ChevronDown'"
                  :size="16"
                  aria-hidden="true"
                />
              </button>
              <span class="files-list-view" title="List view">
                <UiIcon name="List" :size="16" aria-hidden="true" />
              </span>
            </div>
          </div>

          <div v-if="!hasItems && !itemsLoading" class="files-folder-empty">
            <UiIcon name="Folder" :size="28" aria-hidden="true" />
            <h2>{{ isSearching ? "No matching files" : "This folder is empty" }}</h2>
            <p>
              {{
                isSearching
                  ? "Try a different search or clear the field."
                  : "Drop files here, upload from your computer, or create a folder."
              }}
            </p>
          </div>

          <div v-else class="files-list" role="listbox" aria-label="Files and folders">
            <div class="files-list__header" aria-hidden="true">
              <span>Name</span>
              <span>Type</span>
              <span>Size</span>
              <span>Modified</span>
              <span />
            </div>
            <div
              v-for="item in sortedItems"
              :key="rowKey(item)"
              class="files-row"
              :class="{ 'is-selected': selected?.kind === item.kind && selected?.id === item.id }"
              role="option"
              tabindex="0"
              :aria-selected="selected?.kind === item.kind && selected?.id === item.id"
              @click="selectItem(item)"
              @dblclick="activateItem(item)"
              @keydown="handleRowKeydown($event, item)"
            >
              <div class="files-row__name">
                <UiIcon :name="itemIcon(item)" :size="18" aria-hidden="true" />
                <span>{{ itemName(item) }}</span>
              </div>
              <span>{{ formatPreviewKind(itemPreviewKind(item)) }}</span>
              <span>{{ item.kind === "folder" ? "-" : formatBytes(item.file.size) }}</span>
              <span>{{ formatDate(itemUpdatedAt(item)) }}</span>
              <div class="files-row__actions">
                <button
                  type="button"
                  class="files-icon-button"
                  aria-label="Open item actions"
                  title="Actions"
                  aria-haspopup="menu"
                  :aria-expanded="rowMenuId === rowKey(item)"
                  @click="toggleRowMenu(item, $event)"
                >
                  <UiIcon name="Ellipsis" :size="16" aria-hidden="true" />
                </button>
                <div
                  v-if="rowMenuId === rowKey(item)"
                  class="files-menu"
                  role="menu"
                  @click.stop
                >
                  <button
                    v-if="item.kind === 'file'"
                    type="button"
                    role="menuitem"
                    @click="selectItem(item)"
                  >
                    <UiIcon name="Eye" :size="14" aria-hidden="true" />
                    Preview
                  </button>
                  <a
                    v-if="item.kind === 'file'"
                    role="menuitem"
                    :href="contentUrl(item.file, true)"
                  >
                    <UiIcon name="Download" :size="14" aria-hidden="true" />
                    Download
                  </a>
                  <button type="button" role="menuitem" @click="openRenameDialog(item)">
                    <UiIcon name="Pencil" :size="14" aria-hidden="true" />
                    Rename
                  </button>
                  <button type="button" role="menuitem" @click="openMoveDialog(item)">
                    <UiIcon name="Folder" :size="14" aria-hidden="true" />
                    Move
                  </button>
                  <button
                    type="button"
                    class="is-danger"
                    role="menuitem"
                    @click="openDeleteDialog(item)"
                  >
                    <UiIcon name="Trash2" :size="14" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside class="files-preview" aria-label="Selected file details">
          <template v-if="selectedItem">
            <header class="files-preview__header">
              <button
                type="button"
                class="files-icon-button files-preview__back"
                aria-label="Back to files"
                title="Back to files"
                @click="closePreview"
              >
                <UiIcon name="ArrowLeft" :size="16" aria-hidden="true" />
              </button>
              <div class="files-preview__title">
                <UiIcon :name="itemIcon(selectedItem)" :size="20" aria-hidden="true" />
                <h2>{{ itemName(selectedItem) }}</h2>
              </div>
              <div class="files-preview__actions">
                <a
                  v-if="selectedFile"
                  class="files-icon-button"
                  :href="contentUrl(selectedFile, true)"
                  aria-label="Download file"
                  title="Download"
                >
                  <UiIcon name="Download" :size="16" aria-hidden="true" />
                </a>
                <button
                  type="button"
                  class="files-icon-button"
                  aria-label="Rename"
                  title="Rename"
                  @click="() => openRenameDialog()"
                >
                  <UiIcon name="Pencil" :size="16" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="files-icon-button files-icon-button--danger"
                  aria-label="Delete"
                  title="Delete"
                  @click="() => openDeleteDialog()"
                >
                  <UiIcon name="Trash2" :size="16" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div v-if="selectedFolder" class="files-preview__empty">
              <UiIcon name="Folder" :size="44" aria-hidden="true" />
              <p>{{ selectedFolder.path }}</p>
              <Button
                color="outline"
                shape="soft"
                size="compact"
                type="button"
                @click="openFolder(selectedFolder.id)"
              >
                Open folder
              </Button>
            </div>

            <div v-else-if="selectedFile" class="files-preview__body">
              <div v-if="previewLoading" class="files-preview__empty">
                <PageLoading label="Loading preview..." />
              </div>

              <template v-else-if="preview">
                <img
                  v-if="preview.previewKind === 'image'"
                  class="files-image-preview"
                  :src="contentUrl(selectedFile)"
                  :alt="selectedFile.filename"
                />
                <video
                  v-else-if="selectedFile.mimeType.startsWith('video/')"
                  class="files-video-preview"
                  :src="contentUrl(selectedFile)"
                  controls
                  preload="metadata"
                >
                  Your browser cannot preview this video.
                </video>
                <iframe
                  v-else-if="preview.previewKind === 'pdf' && pdfPreviewUrl"
                  class="files-pdf-preview"
                  :src="pdfPreviewUrl"
                  :title="`Preview of ${selectedFile.filename}`"
                />
                <div v-else-if="preview.previewKind === 'csv'" class="files-table-preview">
                  <table v-if="csvRows.length">
                    <tbody>
                      <tr v-for="(row, rowIndex) in csvRows" :key="rowIndex">
                        <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                          {{ cell }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="'truncated' in preview && preview.truncated" class="files-preview-note">
                    Preview truncated.
                  </p>
                </div>
                <pre
                  v-else-if="preview.previewKind === 'text' || preview.previewKind === 'markdown'"
                  class="files-text-preview"
                >{{ previewText }}</pre>
                <div v-else class="files-preview__empty">
                  <UiIcon name="Download" :size="36" aria-hidden="true" />
                  <p>Preview is not available for this file type.</p>
                  <Button
                    color="outline"
                    shape="soft"
                    size="compact"
                    :href="contentUrl(selectedFile, true)"
                  >
                    Download
                  </Button>
                </div>
              </template>
            </div>

            <dl class="files-details">
              <div>
                <dt>Type</dt>
                <dd>{{ formatPreviewKind(itemPreviewKind(selectedItem)) }}</dd>
              </div>
              <div v-if="selectedFile">
                <dt>Size</dt>
                <dd>{{ formatBytes(selectedFile.size) }}</dd>
              </div>
              <div>
                <dt>Modified</dt>
                <dd>{{ formatDate(itemUpdatedAt(selectedItem)) }}</dd>
              </div>
            </dl>
          </template>

          <div v-else class="files-preview__empty">
            <UiIcon name="Eye" :size="42" aria-hidden="true" />
            <p>Select a file to preview it.</p>
          </div>
        </aside>
      </div>

      <div class="files-drop-overlay" aria-hidden="true">
        <UiIcon name="Upload" :size="32" />
        <span>Drop files to upload</span>
      </div>
    </section>

    <div
      v-if="dialogMode"
      class="files-dialog-backdrop"
      role="presentation"
      @click.self="closeDialog"
    >
      <form
        class="files-dialog"
        role="dialog"
        aria-modal="true"
        @submit.prevent="submitDialog"
        @keydown.esc.prevent="closeDialog"
      >
        <header class="files-dialog__header">
          <h2>{{ dialogTitle }}</h2>
          <button
            type="button"
            class="files-icon-button"
            aria-label="Close dialog"
            @click="closeDialog"
          >
            <UiIcon name="X" :size="16" aria-hidden="true" />
          </button>
        </header>

        <label v-if="dialogMode === 'new-folder' || dialogMode === 'rename'" class="files-field">
          <span>{{ dialogMode === "new-folder" ? "Folder name" : "Name" }}</span>
          <input v-model="dialogName" type="text" autocomplete="off" />
        </label>

        <label v-if="dialogMode === 'move'" class="files-field">
          <span>Destination</span>
          <select v-model="dialogFolderId">
            <option :value="null">Files</option>
            <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">
              {{ folder.path }}
            </option>
          </select>
        </label>

        <p v-if="dialogMode === 'delete'" class="files-dialog__copy">
          This moves the item out of the active file browser. Folder deletion also hides its
          contents.
        </p>

        <footer class="files-dialog__actions">
          <Button color="ghost" shape="soft" size="compact" type="button" @click="closeDialog">
            Cancel
          </Button>
          <Button
            :color="dialogMode === 'delete' ? 'danger' : 'primary'"
            shape="soft"
            size="compact"
            type="submit"
            :disabled="dialogSubmitDisabled"
          >
            {{ actionBusy ? "Working" : dialogSubmitLabel }}
          </Button>
        </footer>
      </form>
    </div>
  </main>
</template>

<style scoped>
.files-page {
  min-height: 100%;
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
}

.files-hidden-input {
  display: none;
}

.files-empty-setup {
  display: grid;
  min-height: 100dvh;
  place-items: center;
  align-content: center;
  gap: 14px;
  padding: 32px;
  text-align: center;
}

.files-empty-setup {
  max-width: 520px;
  margin: 0 auto;
}

.files-empty-setup__icon {
  font-size: 42px;
  line-height: 1;
}

.files-empty-setup h1,
.files-folder-empty h2,
.files-preview h2,
.files-dialog h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  letter-spacing: 0;
}

.files-folder-empty p,
.files-preview__empty p,
.files-dialog__copy {
  max-width: 58ch;
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  line-height: 1.5;
}

.files-workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--app-topbar-height));
  overflow: hidden;
}

.files-mobile-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.files-search {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.files-search input {
  min-width: 0;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
  outline: none;
}

.files-status-line {
  padding: 8px 16px 0;
}

.files-status-line p {
  margin: 0;
  font-size: 13px;
}

.files-status-line__error {
  color: #dc2626;
}

.files-upload-progress {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(120px, 280px);
  align-items: center;
  gap: 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.files-upload-progress progress {
  width: 100%;
  height: 8px;
  accent-color: var(--ui-accent, var(--color-accent));
}

.files-body {
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(0, 1fr) minmax(260px, 330px);
  flex: 1;
  min-height: 0;
}

.files-tree {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
  padding: 14px 10px;
  border-right: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-surface, var(--color-bg));
  overflow: auto;
}

.files-tree__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px 0 calc(10px + max(0, var(--folder-depth, 1) - 1) * 12px);
  border: none;
  border-radius: var(--ui-radius-sm, 6px);
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.files-tree__row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-tree__row:hover,
.files-tree__row:focus-visible,
.files-tree__row.is-active {
  background: var(--ui-accent-soft, var(--color-bg-subtle));
  color: var(--ui-accent, var(--color-accent));
}

.files-list-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--ui-bg, var(--color-bg));
}

.files-list-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.files-list-controls__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.files-list-controls__sort {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.files-list-controls__sort select,
.files-field input,
.files-field select {
  height: 34px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
}

.files-list-view,
.files-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  text-decoration: none;
}

button.files-icon-button {
  font: inherit;
  cursor: pointer;
}

.files-icon-button:hover,
.files-icon-button:focus-visible {
  border-color: var(--ui-accent, var(--color-accent));
  color: var(--ui-accent, var(--color-accent));
}

.files-icon-button--danger:hover,
.files-icon-button--danger:focus-visible {
  border-color: #dc2626;
  color: #dc2626;
}

.files-list-view {
  background: var(--ui-accent-soft, var(--color-bg-subtle));
  color: var(--ui-accent, var(--color-accent));
}

.files-list {
  min-height: 0;
  overflow: auto;
}

.files-list__header,
.files-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(90px, 120px) 88px minmax(120px, 150px) 42px;
  gap: 10px;
  align-items: center;
  min-height: 42px;
  padding: 0 12px;
}

.files-list__header {
  position: sticky;
  top: 0;
  z-index: 2;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  font-weight: 700;
}

.files-row {
  position: relative;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  cursor: default;
}

.files-row:hover,
.files-row:focus-visible,
.files-row.is-selected {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.files-row:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: -2px;
}

.files-row__name {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
  color: var(--ui-text, var(--color-text));
  font-weight: 650;
}

.files-row__name span,
.files-row > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-row__actions {
  position: relative;
  display: flex;
  justify-content: flex-end;
}

.files-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 6;
  display: grid;
  min-width: 150px;
  padding: 5px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md, var(--shadow-soft));
}

.files-menu button,
.files-menu a {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 9px;
  border: none;
  border-radius: var(--ui-radius-sm, 6px);
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}

.files-menu button:hover,
.files-menu button:focus-visible,
.files-menu a:hover,
.files-menu a:focus-visible {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.files-menu .is-danger {
  color: #dc2626;
}

.files-folder-empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  min-height: 320px;
  padding: 28px;
  text-align: center;
}

.files-preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-surface, var(--color-bg));
}

.files-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 58px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.files-preview__title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.files-preview__title h2 {
  overflow-wrap: anywhere;
  font-size: 15px;
}

.files-preview__actions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
}

.files-preview__back {
  display: none;
  flex-shrink: 0;
}

.files-preview__body {
  min-height: 230px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  overflow: auto;
}

.files-preview__empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  min-height: 230px;
  padding: 18px;
  text-align: center;
}

.files-image-preview {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.files-video-preview {
  display: block;
  width: 100%;
  max-height: 520px;
  background: #000;
}

.files-pdf-preview {
  display: block;
  width: 100%;
  height: 420px;
  border: none;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.files-text-preview {
  min-height: 260px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  color: var(--ui-text, var(--color-text));
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.files-table-preview {
  max-height: 420px;
  overflow: auto;
}

.files-table-preview table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.files-table-preview td {
  max-width: 220px;
  padding: 7px 8px;
  border: 1px solid var(--ui-border, var(--color-border));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-preview-note {
  margin: 10px 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
}

.files-details {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 4px 12px 14px;
}

.files-details div {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.files-details dt {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
}

.files-details dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.files-drop-overlay {
  position: absolute;
  inset: 66px 16px 16px;
  z-index: 20;
  display: none;
  place-items: center;
  align-content: center;
  gap: 12px;
  border: 2px dashed var(--ui-accent, var(--color-accent));
  border-radius: var(--ui-radius-md, 8px);
  background: color-mix(in oklab, var(--ui-bg, var(--color-bg)), transparent 8%);
  color: var(--ui-accent, var(--color-accent));
  font-weight: 750;
  pointer-events: none;
}

.files-workspace.is-drop-active .files-drop-overlay {
  display: grid;
}

.files-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in oklab, var(--ui-text, var(--color-text)), transparent 72%);
}

.files-dialog {
  display: grid;
  gap: 16px;
  width: min(420px, 100%);
  padding: 16px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 8px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md, var(--shadow-soft));
}

.files-dialog__header,
.files-dialog__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.files-dialog__actions {
  justify-content: flex-end;
}

.files-field {
  display: grid;
  gap: 7px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.files-field input,
.files-field select {
  width: 100%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 980px) {
  .files-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .files-body:not(.files-body--preview-open) .files-preview {
    display: none;
  }

  .files-body--preview-open {
    overflow: hidden;
  }

  .files-body--preview-open .files-tree,
  .files-body--preview-open .files-list-panel {
    display: none;
  }

  .files-tree {
    height: 160px;
    flex-direction: column;
    border-right: none;
    border-bottom: 1px solid var(--ui-border, var(--color-border));
    overflow-x: hidden;
    overflow-y: auto;
  }

  .files-tree__row {
    flex: 0 0 auto;
  }

  .files-preview {
    min-height: 320px;
    border-left: none;
    border-top: 1px solid var(--ui-border, var(--color-border));
  }

  .files-body--preview-open .files-preview {
    border-top: none;
  }

  .files-preview__back {
    display: inline-flex;
  }
}

@media (max-width: 700px) {
  .files-upload-progress {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .files-list__header {
    display: none;
  }

  .files-row {
    grid-template-columns: minmax(0, 1fr) 42px;
    gap: 6px;
    min-height: 58px;
  }

  .files-row > span {
    display: none;
  }

  .files-row__actions {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>

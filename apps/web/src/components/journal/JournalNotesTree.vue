<script setup lang="ts" generic="T extends { id: string; title: string | null; updatedAt: string; projectId?: string | null; folderId?: string | null }">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import UiIcon from "../UiIcon.vue";
import JournalNoteMoveMenu from "./JournalNoteMoveMenu.vue";
import ProjectIcon from "../tasks/ProjectIcon.vue";
import { groupNotes, samePlacement, type NoteFolder, type NotePlacement, type NoteProject, type NoteProjectGroup } from "../../utils/journalNotes";

// The Notes tab of the Journal library: projects, then folders inside them, then loose notes.
// One line per row; guide lines show what sits inside what.
const props = withDefaults(defineProps<{
  notes: T[];
  folders: NoteFolder[];
  projects: NoteProject[];
  activeId: string | null;
  wordCount: (note: T) => number;
  query?: string;
}>(), { query: "" });

const emit = defineEmits<{
  open: [id: string];
  delete: [note: T];
  move: [note: T, placement: NotePlacement];
  "new-note": [placement: NotePlacement];
  "new-folder": [projectId: string | null];
  "new-project": [note: T];
  "rename-folder": [folder: NoteFolder];
  "delete-folder": [folder: NoteFolder];
}>();

const COLLAPSED_KEY = "me3.journal.notes.collapsed";
const collapsed = ref(new Set<string>(readCollapsed()));
// Menus near the bottom of the screen open upwards so the move list stays visible.
const menu = ref<{ id: string; view: "actions" | "move"; up: boolean } | null>(null);

const groups = computed(() => groupNotes(props.notes, props.folders, props.projects));
const projectIcon = (projectId: string | null) => props.projects.find((project) => project.id === projectId)?.icon ?? null;
const search = computed(() => props.query.trim().toLowerCase());
const noteTitle = (note: T) => note.title || "Untitled note";

function readCollapsed(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function saveCollapsed(next: Set<string>) {
  collapsed.value = next;
  try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* per-browser convenience only */ }
}

// A search shows every match, so it opens everything without changing what stays collapsed.
function isOpen(key: string) {
  return Boolean(search.value) || !collapsed.value.has(key);
}

function toggle(key: string, open?: boolean) {
  const next = new Set(collapsed.value);
  if (open ?? next.has(key)) next.delete(key);
  else next.add(key);
  saveCollapsed(next);
}

const groupKeys = computed(() => groups.value.flatMap((group) => [group.key, ...group.folders.map(({ folder }) => folder.id)]));
const allCollapsed = computed(() => groupKeys.value.length > 0 && groupKeys.value.every((key) => collapsed.value.has(key)));

function collapseAll() {
  saveCollapsed(allCollapsed.value ? new Set() : new Set(groupKeys.value));
}

defineExpose({ collapseAll, allCollapsed });

type Row =
  | { kind: "group"; key: string; depth: 0; group: NoteProjectGroup<T>; open: boolean; holdsActive: boolean; count: number }
  | { kind: "folder"; key: string; depth: 1; folder: NoteFolder; projectId: string | null; open: boolean; holdsActive: boolean; count: number }
  | { kind: "empty"; key: string; depth: 2 }
  | { kind: "note"; key: string; depth: 1 | 2; note: T; placement: NotePlacement };

// Each project, then its folders with their notes when open, then its loose notes.
const rows = computed<Row[]>(() => {
  const query = search.value;
  const matches = (note: T) => !query || noteTitle(note).toLowerCase().includes(query);
  const out: Row[] = [];
  for (const group of groups.value) {
    const folders = group.folders.map(({ folder, notes }) => ({ folder, notes: notes.filter(matches) }));
    const loose = group.notes.filter(matches);
    const shownFolders = query ? folders.filter((item) => item.notes.length > 0) : folders;
    if (query && shownFolders.length === 0 && loose.length === 0) continue;

    const groupOpen = isOpen(group.key);
    const groupHolds = [...loose, ...folders.flatMap((item) => item.notes)].some((note) => note.id === props.activeId);
    const count = query ? loose.length + shownFolders.reduce((sum, item) => sum + item.notes.length, 0) : group.count;
    out.push({ kind: "group", key: group.key, depth: 0, group, open: groupOpen, holdsActive: groupHolds, count });
    if (!groupOpen) continue;

    for (const { folder, notes } of shownFolders) {
      const open = isOpen(folder.id);
      out.push({ kind: "folder", key: folder.id, depth: 1, folder, projectId: group.projectId, open, holdsActive: notes.some((note) => note.id === props.activeId), count: notes.length });
      if (!open) continue;
      if (notes.length === 0) out.push({ kind: "empty", key: `${folder.id}:empty`, depth: 2 });
      for (const note of notes) out.push({ kind: "note", key: note.id, depth: 2, note, placement: { projectId: group.projectId, folderId: folder.id } });
    }
    for (const note of loose) out.push({ kind: "note", key: note.id, depth: 1, note, placement: { projectId: group.projectId, folderId: null } });
  }
  return out;
});

const noMatches = computed(() => Boolean(search.value) && rows.value.length === 0);

function wordsLabel(note: T) {
  const words = props.wordCount(note);
  return `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
}

function toggleMenu(id: string, event?: Event) {
  const target = event?.currentTarget instanceof Element ? event.currentTarget : null;
  const up = target ? window.innerHeight - target.getBoundingClientRect().bottom < 380 : false;
  menu.value = menu.value?.id === id ? null : { id, view: "actions", up };
}

function closeMenu() {
  menu.value = null;
}

function move(note: T, placement: NotePlacement) {
  closeMenu();
  emit("move", note, placement);
}

function newProject(note: T) {
  closeMenu();
  emit("new-project", note);
}

function newFolder(projectId: string | null) {
  closeMenu();
  emit("new-folder", projectId);
}

// Drag a note onto a project or folder header to file it there. Mouse only: touch keeps "Move to…".
// A private type keeps the editor and other drop zones from treating the drag as text.
const DRAG_TYPE = "application/x-me3-journal-note";
const OPEN_DELAY_MS = 600;
const dragging = shallowRef<{ note: T; placement: NotePlacement } | null>(null);
const dropKey = ref<string | null>(null);
let openTimer: ReturnType<typeof setTimeout> | null = null;

function clearOpenTimer() {
  if (openTimer) clearTimeout(openTimer);
  openTimer = null;
}

function onNoteDragStart(event: DragEvent, note: T, placement: NotePlacement) {
  if (!event.dataTransfer) return;
  closeMenu();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(DRAG_TYPE, note.id);
  dragging.value = { note, placement };
}

function onDragEnd() {
  dragging.value = null;
  dropKey.value = null;
  clearOpenTimer();
}

function canDrop(placement: NotePlacement) {
  return dragging.value !== null && !samePlacement(dragging.value.placement, placement);
}

// Hovering a closed project or folder opens it after a moment, so notes can reach folders inside.
function onDragOver(event: DragEvent, key: string, placement: NotePlacement, closed: boolean) {
  if (!dragging.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = canDrop(placement) ? "move" : "none";
  if (dropKey.value === key) return;
  dropKey.value = key;
  clearOpenTimer();
  if (closed) openTimer = setTimeout(() => toggle(key, true), OPEN_DELAY_MS);
}

function onDragLeave(event: DragEvent, key: string) {
  const next = event.relatedTarget;
  if (next instanceof Node && (event.currentTarget as Element).contains(next)) return;
  if (dropKey.value === key) {
    dropKey.value = null;
    clearOpenTimer();
  }
}

function onDrop(event: DragEvent, placement: NotePlacement) {
  const drag = dragging.value;
  onDragEnd();
  if (!drag) return;
  event.preventDefault();
  if (!samePlacement(drag.placement, placement)) emit("move", drag.note, placement);
}

onMounted(() => window.addEventListener("click", closeMenu));
onBeforeUnmount(() => {
  window.removeEventListener("click", closeMenu);
  clearOpenTimer();
});
</script>

<template>
  <div class="notes-tree">
    <template v-for="item in rows" :key="item.key">
      <div
        v-if="item.kind === 'group'"
        class="notes-tree__head notes-tree__head--project"
        :class="{ 'is-muted': !item.group.projectId, 'is-drop-target': dropKey === item.key && canDrop({ projectId: item.group.projectId, folderId: null }) }"
        :style="{ '--depth': item.depth }"
        @dragover="onDragOver($event, item.key, { projectId: item.group.projectId, folderId: null }, !item.open)"
        @dragleave="onDragLeave($event, item.key)"
        @drop="onDrop($event, { projectId: item.group.projectId, folderId: null })"
      >
        <button type="button" class="notes-tree__toggle" :aria-expanded="item.open" @click="toggle(item.key)">
          <UiIcon class="notes-tree__chevron" name="ChevronRight" :size="14" aria-hidden="true" />
          <ProjectIcon v-if="item.group.projectId" :icon="projectIcon(item.group.projectId)" :name="item.group.name" size="small" />
          <UiIcon v-else class="notes-tree__icon" name="Inbox" :size="15" aria-hidden="true" />
          <span class="notes-tree__name">{{ item.group.name }}</span>
          <span v-if="!item.open && item.holdsActive" class="notes-tree__dot" title="The open note is in here" />
          <span class="notes-tree__count">{{ item.count }}</span>
        </button>
        <div class="notes-tree__actions">
          <button type="button" class="notes-tree__icon-btn" :aria-label="`New note in ${item.group.name}`" title="New note" @click="emit('new-note', { projectId: item.group.projectId, folderId: null })"><UiIcon name="Plus" :size="15" aria-hidden="true" /></button>
          <button type="button" class="notes-tree__icon-btn" :aria-label="`New folder in ${item.group.name}`" title="New folder" @click="emit('new-folder', item.group.projectId)"><UiIcon name="FolderPlus" :size="15" aria-hidden="true" /></button>
        </div>
      </div>

      <div
        v-else-if="item.kind === 'folder'"
        class="notes-tree__head notes-tree__head--folder"
        :class="{ 'is-drop-target': dropKey === item.key && canDrop({ projectId: item.projectId, folderId: item.folder.id }) }"
        :style="{ '--depth': item.depth }"
        @dragover="onDragOver($event, item.key, { projectId: item.projectId, folderId: item.folder.id }, !item.open)"
        @dragleave="onDragLeave($event, item.key)"
        @drop="onDrop($event, { projectId: item.projectId, folderId: item.folder.id })"
      >
        <button type="button" class="notes-tree__toggle" :aria-expanded="item.open" @click="toggle(item.key)">
          <UiIcon class="notes-tree__chevron" name="ChevronRight" :size="14" aria-hidden="true" />
          <UiIcon class="notes-tree__icon" :name="item.open ? 'FolderOpen' : 'Folder'" :size="15" aria-hidden="true" />
          <span class="notes-tree__name">{{ item.folder.name }}</span>
          <span v-if="!item.open && item.holdsActive" class="notes-tree__dot" title="The open note is in here" />
          <span class="notes-tree__count">{{ item.count }}</span>
        </button>
        <div class="notes-tree__actions">
          <button type="button" class="notes-tree__icon-btn" :aria-label="`New note in ${item.folder.name}`" title="New note" @click="emit('new-note', { projectId: item.projectId, folderId: item.folder.id })"><UiIcon name="Plus" :size="15" aria-hidden="true" /></button>
          <button type="button" class="notes-tree__icon-btn" :aria-label="`Rename ${item.folder.name}`" title="Rename folder" @click="emit('rename-folder', item.folder)"><UiIcon name="Pencil" :size="14" aria-hidden="true" /></button>
          <button type="button" class="notes-tree__icon-btn" :aria-label="`Delete ${item.folder.name}`" title="Delete folder" @click="emit('delete-folder', item.folder)"><UiIcon name="Trash2" :size="14" aria-hidden="true" /></button>
        </div>
      </div>

      <p v-else-if="item.kind === 'empty'" class="notes-tree__empty" :style="{ '--depth': item.depth }">Empty folder</p>

      <div
        v-else
        class="notes-tree__row"
        :class="{ 'is-active': item.note.id === activeId, 'is-menu-open': menu?.id === item.note.id, 'is-dragging': dragging?.note.id === item.note.id }"
        :style="{ '--depth': item.depth }"
        draggable="true"
        @dragstart="onNoteDragStart($event, item.note, item.placement)"
        @dragend="onDragEnd"
      >
        <button type="button" class="notes-tree__row-main" :title="`${noteTitle(item.note)} · ${wordsLabel(item.note)}`" :aria-current="item.note.id === activeId ? 'page' : undefined" @click="emit('open', item.note.id)">
          <span class="notes-tree__spacer" aria-hidden="true" />
          <UiIcon class="notes-tree__icon" name="FileText" :size="14" aria-hidden="true" />
          <span class="notes-tree__name">{{ noteTitle(item.note) }}</span>
        </button>
        <div class="notes-tree__actions" @click.stop>
          <button type="button" class="notes-tree__icon-btn" :aria-label="`Actions for ${noteTitle(item.note)}`" aria-haspopup="menu" :aria-expanded="menu?.id === item.note.id ? 'true' : 'false'" title="Note actions" @click="toggleMenu(item.note.id, $event)"><UiIcon name="Ellipsis" :size="15" aria-hidden="true" /></button>
          <div v-if="menu?.id === item.note.id && menu.view === 'actions'" class="notes-tree__menu" :class="{ 'is-up': menu.up }" role="menu">
            <button type="button" role="menuitem" class="notes-tree__menu-item" @click="menu = { ...menu!, view: 'move' }"><UiIcon name="FolderInput" :size="15" aria-hidden="true" />Move to…</button>
            <button type="button" role="menuitem" class="notes-tree__menu-item is-danger" @click="closeMenu(); emit('delete', item.note)"><UiIcon name="Trash2" :size="15" aria-hidden="true" />Delete note</button>
          </div>
          <JournalNoteMoveMenu v-if="menu?.id === item.note.id && menu.view === 'move'" class="notes-tree__move" :class="{ 'is-up': menu.up }" :projects="projects" :folders="folders" :current="item.placement" @move="move(item.note, $event)" @new-folder="newFolder" @new-project="newProject(item.note)" />
        </div>
      </div>
    </template>
    <p v-if="noMatches" class="notes-tree__none">No notes match.</p>
  </div>
</template>

<style scoped>
.notes-tree {
  --indent: 16px;
  --row-height: 30px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.notes-tree__head,
.notes-tree__row,
.notes-tree__empty {
  position: relative;
  border-radius: var(--ui-radius-sm, 8px);
}

/* One guide line per level, under the chevron of the row it belongs to. */
.notes-tree__head::before,
.notes-tree__row::before,
.notes-tree__empty::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 6px;
  width: calc(var(--depth, 0) * var(--indent));
  background: repeating-linear-gradient(to right, transparent 0 7px, var(--ui-border, var(--color-border)) 7px 8px, transparent 8px var(--indent));
  pointer-events: none;
}

.notes-tree__head--project:not(:first-child) {
  margin-top: 6px;
}

.notes-tree__head:hover,
.notes-tree__head:focus-within,
.notes-tree__row:hover,
.notes-tree__row.is-menu-open {
  background: var(--ui-surface-muted, var(--color-surface-muted));
}

.notes-tree__head.is-drop-target {
  background: var(--ui-accent-soft, var(--ui-surface-muted));
  box-shadow: inset 0 0 0 2px var(--ui-accent);
}

.notes-tree__row.is-active {
  background: var(--ui-accent-soft, var(--ui-surface-muted));
}

.notes-tree__row.is-active .notes-tree__name {
  color: var(--ui-accent-strong, var(--ui-accent));
  font-weight: 600;
}

.notes-tree__row.is-active .notes-tree__icon {
  color: var(--ui-accent);
}

.notes-tree__row.is-dragging {
  opacity: 0.45;
}

.notes-tree__toggle,
.notes-tree__row-main {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: var(--row-height);
  border: 0;
  padding: 0 8px 0 calc(6px + var(--depth, 0) * var(--indent));
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 0.84rem;
  text-align: left;
  cursor: pointer;
}

.notes-tree__head--project .notes-tree__toggle {
  font-weight: 600;
}

.notes-tree__head--folder .notes-tree__toggle {
  font-weight: 500;
}

.notes-tree__head.is-muted .notes-tree__name {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.notes-tree__toggle:focus-visible,
.notes-tree__row-main:focus-visible,
.notes-tree__icon-btn:focus-visible {
  outline: 2px solid var(--ui-focus, var(--ui-accent));
  outline-offset: -2px;
  border-radius: var(--ui-radius-sm, 8px);
}

.notes-tree__chevron,
.notes-tree__spacer {
  flex-shrink: 0;
  width: 14px;
}

.notes-tree__chevron {
  color: var(--ui-text-muted, var(--color-text-muted));
  transform: rotate(90deg);
  transition: transform 0.15s ease;
}

.notes-tree__toggle[aria-expanded="false"] .notes-tree__chevron {
  transform: none;
}

.notes-tree__icon {
  flex-shrink: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.notes-tree__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notes-tree__dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-accent);
}

.notes-tree__count {
  margin-left: auto;
  padding-left: 6px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.75rem;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

/* Hover actions sit over the count, so they never squeeze the name. */
.notes-tree__actions {
  position: absolute;
  top: 50%;
  right: 2px;
  transform: translateY(-50%);
  display: flex;
  gap: 1px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.notes-tree__head:hover .notes-tree__actions,
.notes-tree__head:focus-within .notes-tree__actions,
.notes-tree__row:hover .notes-tree__actions,
.notes-tree__row:focus-within .notes-tree__actions,
.notes-tree__row.is-menu-open .notes-tree__actions {
  opacity: 1;
  pointer-events: auto;
}

.notes-tree__head:hover .notes-tree__count,
.notes-tree__head:focus-within .notes-tree__count {
  visibility: hidden;
}

.notes-tree__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: var(--ui-surface-muted, var(--color-surface-muted));
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
}

.notes-tree__icon-btn:hover {
  background: var(--ui-border, var(--color-border));
  color: var(--ui-text, var(--color-text));
}

.notes-tree__row.is-active .notes-tree__icon-btn {
  background: var(--ui-accent-soft, var(--ui-surface-muted));
}

.notes-tree__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 35;
  min-width: 160px;
  box-sizing: border-box;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  padding: 6px;
  background: var(--ui-surface, var(--color-surface));
  box-shadow: var(--ui-shadow-md, 0 14px 32px rgba(15, 23, 42, 0.16));
}

.notes-tree__move {
  top: calc(100% + 4px);
  right: 0;
}

.notes-tree__menu.is-up,
.notes-tree__move.is-up {
  top: auto;
  bottom: calc(100% + 4px);
}

.notes-tree__menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  padding: 8px 10px;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.notes-tree__menu-item:hover,
.notes-tree__menu-item:focus-visible {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  outline: none;
}

.notes-tree__menu-item.is-danger {
  color: var(--color-danger, #b42318);
}

.notes-tree__empty {
  margin: 0;
  min-height: var(--row-height);
  display: flex;
  align-items: center;
  padding-left: calc(6px + var(--depth, 0) * var(--indent) + 20px);
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.8rem;
}

.notes-tree__none {
  margin: 12px 10px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.84rem;
}

/* Touch has no hover: taller rows, actions always shown in place of the count. */
@media (hover: none) {
  .notes-tree {
    --row-height: 40px;
  }

  .notes-tree__actions {
    opacity: 1;
    pointer-events: auto;
  }

  .notes-tree__count {
    display: none;
  }

  .notes-tree__icon-btn {
    width: 34px;
    height: 34px;
    background: transparent;
  }

  .notes-tree__head .notes-tree__toggle {
    padding-right: 110px;
  }

  .notes-tree__row-main {
    padding-right: 44px;
  }
}
</style>

<script setup lang="ts" generic="T extends { id: string; title: string | null; updatedAt: string; projectId?: string | null; folderId?: string | null }">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import JournalNoteMoveMenu from "./JournalNoteMoveMenu.vue";
import ProjectIcon from "../tasks/ProjectIcon.vue";
import { groupNotes, samePlacement, type NoteFolder, type NotePlacement, type NoteProject, type NoteProjectGroup } from "../../utils/journalNotes";

// The Notes tab of the Journal library: projects, then folders inside them, then loose notes.
const props = defineProps<{
  notes: T[];
  folders: NoteFolder[];
  projects: NoteProject[];
  activeId: string | null;
  wordCount: (note: T) => number;
  subtitle: (note: T) => string;
}>();

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

function readCollapsed(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

// The group holding the open note always shows it.
function isOpen(key: string, holdsActive: boolean) {
  return holdsActive || !collapsed.value.has(key);
}

function toggle(key: string, open?: boolean) {
  const next = new Set(collapsed.value);
  if (open ?? next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
  try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* per-browser convenience only */ }
}

function groupHoldsActive(projectId: string | null) {
  return groups.value.some((group) => group.projectId === projectId && (group.notes.some((note) => note.id === props.activeId) || group.folders.some((folder) => folder.notes.some((note) => note.id === props.activeId))));
}

type Row =
  | { kind: "folder"; key: string; folder: NoteFolder; count: number; open: boolean }
  | { kind: "empty"; key: string }
  | { kind: "note"; key: string; note: T; placement: NotePlacement };

// Folders first, each followed by its notes when open, then the group's loose notes.
function rowsOf(group: NoteProjectGroup<T>): Row[] {
  const rows: Row[] = [];
  for (const { folder, notes } of group.folders) {
    const open = isOpen(folder.id, notes.some((note) => note.id === props.activeId));
    rows.push({ kind: "folder", key: folder.id, folder, count: notes.length, open });
    if (!open) continue;
    if (notes.length === 0) rows.push({ kind: "empty", key: `${folder.id}:empty` });
    for (const note of notes) rows.push({ kind: "note", key: note.id, note, placement: { projectId: group.projectId, folderId: folder.id } });
  }
  for (const note of group.notes) rows.push({ kind: "note", key: note.id, note, placement: { projectId: group.projectId, folderId: null } });
  return rows;
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
    <section v-for="group in groups" :key="group.key" class="notes-tree__group">
      <div
        class="notes-tree__head"
        :class="{ 'is-muted': !group.projectId, 'is-drop-target': dropKey === group.key && canDrop({ projectId: group.projectId, folderId: null }) }"
        @dragover="onDragOver($event, group.key, { projectId: group.projectId, folderId: null }, !isOpen(group.key, groupHoldsActive(group.projectId)))"
        @dragleave="onDragLeave($event, group.key)"
        @drop="onDrop($event, { projectId: group.projectId, folderId: null })"
      >
        <button
          type="button"
          class="notes-tree__toggle"
          :aria-expanded="isOpen(group.key, groupHoldsActive(group.projectId))"
          @click="toggle(group.key)"
        >
          <UiIcon class="notes-tree__chevron" name="ChevronDown" :size="15" aria-hidden="true" />
          <ProjectIcon v-if="group.projectId" :icon="projectIcon(group.projectId)" :name="group.name" size="small" />
          <span class="notes-tree__name">{{ group.name }}</span>
          <span class="notes-tree__count">{{ group.count }}</span>
        </button>
        <div class="notes-tree__head-actions">
          <Button color="ghost" shape="soft" size="compact" icon-only type="button" :aria-label="`New note in ${group.name}`" title="New note" @click="emit('new-note', { projectId: group.projectId, folderId: null })"><UiIcon name="Plus" :size="15" aria-hidden="true" /></Button>
          <Button color="ghost" shape="soft" size="compact" icon-only type="button" :aria-label="`New folder in ${group.name}`" title="New folder" @click="emit('new-folder', group.projectId)"><UiIcon name="FolderPlus" :size="15" aria-hidden="true" /></Button>
        </div>
      </div>

      <div v-if="isOpen(group.key, groupHoldsActive(group.projectId))" class="notes-tree__body">
        <template v-for="item in rowsOf(group)" :key="item.key">
          <div
            v-if="item.kind === 'folder'"
            class="notes-tree__head notes-tree__head--folder"
            :class="{ 'is-drop-target': dropKey === item.folder.id && canDrop({ projectId: group.projectId, folderId: item.folder.id }) }"
            @dragover="onDragOver($event, item.folder.id, { projectId: group.projectId, folderId: item.folder.id }, !item.open)"
            @dragleave="onDragLeave($event, item.folder.id)"
            @drop="onDrop($event, { projectId: group.projectId, folderId: item.folder.id })"
          >
            <button type="button" class="notes-tree__toggle" :aria-expanded="item.open" @click="toggle(item.folder.id)">
              <UiIcon class="notes-tree__chevron" name="ChevronDown" :size="15" aria-hidden="true" />
              <UiIcon name="Folder" :size="15" aria-hidden="true" />
              <span class="notes-tree__name">{{ item.folder.name }}</span>
              <span class="notes-tree__count">{{ item.count }}</span>
            </button>
            <div class="notes-tree__head-actions">
              <Button color="ghost" shape="soft" size="compact" icon-only type="button" :aria-label="`New note in ${item.folder.name}`" title="New note" @click="emit('new-note', { projectId: group.projectId, folderId: item.folder.id })"><UiIcon name="Plus" :size="15" aria-hidden="true" /></Button>
              <Button color="ghost" shape="soft" size="compact" icon-only type="button" :aria-label="`Rename ${item.folder.name}`" title="Rename folder" @click="emit('rename-folder', item.folder)"><UiIcon name="Pencil" :size="14" aria-hidden="true" /></Button>
              <Button color="ghost" shape="soft" size="compact" icon-only type="button" :aria-label="`Delete ${item.folder.name}`" title="Delete folder" @click="emit('delete-folder', item.folder)"><UiIcon name="Trash2" :size="14" aria-hidden="true" /></Button>
            </div>
          </div>
          <p v-else-if="item.kind === 'empty'" class="notes-tree__empty">Empty folder</p>
          <div
            v-else
            class="notes-tree__row"
            :class="{ 'is-active': item.note.id === activeId, 'is-menu-open': menu?.id === item.note.id, 'is-filed': item.placement.folderId, 'is-dragging': dragging?.note.id === item.note.id }"
            draggable="true"
            @dragstart="onNoteDragStart($event, item.note, item.placement)"
            @dragend="onDragEnd"
          >
            <button type="button" class="notes-tree__row-main" @click="emit('open', item.note.id)">
              <span class="notes-tree__row-head"><strong>{{ item.note.title || 'Untitled note' }}</strong><small>{{ wordCount(item.note).toLocaleString() }} words</small></span>
              <span>{{ subtitle(item.note) }}</span>
            </button>
            <div class="notes-tree__row-actions" @click.stop>
              <Button color="ghost" shape="soft" size="compact" icon-only type="button" :aria-label="`Actions for ${item.note.title || 'Untitled note'}`" aria-haspopup="menu" :aria-expanded="menu?.id === item.note.id ? 'true' : 'false'" title="Note actions" @click="toggleMenu(item.note.id, $event)"><UiIcon name="Ellipsis" :size="16" aria-hidden="true" /></Button>
              <div v-if="menu?.id === item.note.id && menu.view === 'actions'" class="notes-tree__menu" :class="{ 'is-up': menu.up }" role="menu">
                <button type="button" role="menuitem" class="notes-tree__menu-item" @click="menu = { ...menu!, view: 'move' }"><UiIcon name="FolderInput" :size="15" aria-hidden="true" />Move to…</button>
                <button type="button" role="menuitem" class="notes-tree__menu-item is-danger" @click="closeMenu(); emit('delete', item.note)"><UiIcon name="Trash2" :size="15" aria-hidden="true" />Delete note</button>
              </div>
              <JournalNoteMoveMenu v-if="menu?.id === item.note.id && menu.view === 'move'" class="notes-tree__move" :class="{ 'is-up': menu.up }" :projects="projects" :folders="folders" :current="item.placement" @move="move(item.note, $event)" @new-folder="newFolder" @new-project="newProject(item.note)" />
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.notes-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notes-tree__group,
.notes-tree__folder,
.notes-tree__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notes-tree__group + .notes-tree__group {
  margin-top: 6px;
}

.notes-tree__head--folder,
.notes-tree__row.is-filed,
.notes-tree__empty {
  margin-left: 14px;
}

.notes-tree__head {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--ui-radius-sm, 8px);
}

.notes-tree__head:hover,
.notes-tree__head:focus-within {
  background: var(--ui-surface-muted, var(--color-surface-muted));
}

.notes-tree__head.is-drop-target {
  background: var(--ui-accent-soft, var(--ui-surface-muted));
  box-shadow: inset 0 0 0 2px var(--ui-accent);
}

.notes-tree__row.is-dragging {
  opacity: 0.45;
}

.notes-tree__toggle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  border: 0;
  padding: 7px 8px;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.notes-tree__head--folder .notes-tree__toggle {
  font-weight: 500;
}

.notes-tree__head.is-muted .notes-tree__toggle {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.notes-tree__toggle:focus-visible {
  outline: 2px solid var(--ui-focus, var(--ui-accent));
  border-radius: var(--ui-radius-sm, 8px);
}

.notes-tree__chevron {
  color: var(--ui-text-muted, var(--color-text-muted));
  transition: transform 0.15s ease;
}

.notes-tree__toggle[aria-expanded="false"] .notes-tree__chevron {
  transform: rotate(-90deg);
}

.notes-tree__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notes-tree__count {
  margin-left: auto;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.78rem;
  font-weight: 400;
}

/* Hover actions sit over the count so they never squeeze the name. */
.notes-tree__head-actions {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: flex;
  gap: 2px;
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-surface-muted));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.notes-tree__head:hover .notes-tree__head-actions,
.notes-tree__head:focus-within .notes-tree__head-actions {
  opacity: 1;
  pointer-events: auto;
}


.notes-tree__row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  border-radius: var(--ui-radius-sm, 8px);
  color: var(--ui-text, var(--color-text));
}

.notes-tree__row:hover,
.notes-tree__row.is-active,
.notes-tree__row.is-menu-open {
  background: var(--ui-surface-muted, var(--color-surface-muted));
}

.notes-tree__row.is-active {
  box-shadow: inset 3px 0 0 var(--ui-accent);
}

.notes-tree__row.is-active strong {
  color: var(--ui-accent-strong, var(--ui-accent));
}

.notes-tree__row-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  border: 0;
  padding: 8px 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.notes-tree__row-main:focus-visible {
  outline: 2px solid var(--ui-focus, var(--ui-accent));
  border-radius: var(--ui-radius-sm, 8px);
}

.notes-tree__row-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.notes-tree__row-head small {
  flex-shrink: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.78rem;
}

.notes-tree__row-main strong,
.notes-tree__row-main > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notes-tree__row-main strong {
  font-size: 0.92rem;
}

.notes-tree__row-main > span:last-child {
  font-size: 0.82rem;
  color: var(--ui-text-muted, var(--color-text-muted));
}

/* Sits over the word count on hover, so it never narrows the row. */
.notes-tree__row-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  justify-content: center;
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-surface-muted));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.notes-tree__row:hover .notes-tree__row-actions,
.notes-tree__row:focus-within .notes-tree__row-actions,
.notes-tree__row.is-menu-open .notes-tree__row-actions {
  opacity: 1;
  pointer-events: auto;
}

.notes-tree__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 4px;
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
  right: 4px;
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
  margin-top: 2px;
  margin-bottom: 6px;
  padding: 0 10px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.82rem;
}

@media (hover: none) {
  .notes-tree__head-actions {
    position: static;
    transform: none;
    background: transparent;
  }

  .notes-tree__head-actions,
  .notes-tree__row-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .notes-tree__row {
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .notes-tree__row-actions {
    position: relative;
    top: auto;
    right: auto;
    background: transparent;
  }

  .notes-tree__head .notes-tree__count {
    display: none;
  }
}
</style>

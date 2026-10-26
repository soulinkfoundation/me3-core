<script setup lang="ts">
import { computed } from "vue";
import UiIcon from "../UiIcon.vue";
import { samePlacement, type NoteFolder, type NotePlacement, type NoteProject } from "../../utils/journalNotes";

// Move to: every project with its folders, then No project with its folders.
const props = defineProps<{
  projects: NoteProject[];
  folders: NoteFolder[];
  current: NotePlacement;
}>();

const emit = defineEmits<{
  move: [placement: NotePlacement];
  "new-folder": [projectId: string | null];
}>();

const targets = computed(() => {
  const known = new Set(props.projects.map((project) => project.id));
  const foldersIn = (projectId: string | null) => props.folders
    .filter((folder) => (folder.projectId && known.has(folder.projectId) ? folder.projectId : null) === projectId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return [
    ...props.projects.map((project) => ({ projectId: project.id as string | null, name: project.name, folders: foldersIn(project.id) })),
    { projectId: null, name: "No project", folders: foldersIn(null) },
  ];
});

const currentProjectName = computed(() => targets.value.find((target) => target.projectId === (props.current.projectId ?? null))?.name ?? "No project");

function isCurrent(placement: NotePlacement) {
  return samePlacement(placement, props.current);
}
</script>

<template>
  <div class="note-move-menu" role="menu" aria-label="Move to" @click.stop>
    <p class="note-move-menu__label">Move to</p>
    <template v-for="target in targets" :key="target.projectId ?? 'none'">
      <button
        type="button"
        role="menuitemradio"
        class="note-move-menu__item"
        :aria-checked="isCurrent({ projectId: target.projectId, folderId: null })"
        @click="emit('move', { projectId: target.projectId, folderId: null })"
      >
        <UiIcon :name="target.projectId ? 'Target' : 'FileText'" :size="15" aria-hidden="true" />
        <span>{{ target.name }}</span>
        <UiIcon v-if="isCurrent({ projectId: target.projectId, folderId: null })" class="note-move-menu__check" name="Check" :size="15" aria-hidden="true" />
      </button>
      <button
        v-for="folder in target.folders"
        :key="folder.id"
        type="button"
        role="menuitemradio"
        class="note-move-menu__item note-move-menu__item--folder"
        :aria-checked="isCurrent({ projectId: target.projectId, folderId: folder.id })"
        @click="emit('move', { projectId: target.projectId, folderId: folder.id })"
      >
        <UiIcon name="Folder" :size="15" aria-hidden="true" />
        <span>{{ folder.name }}</span>
        <UiIcon v-if="isCurrent({ projectId: target.projectId, folderId: folder.id })" class="note-move-menu__check" name="Check" :size="15" aria-hidden="true" />
      </button>
    </template>
    <hr class="note-move-menu__divider">
    <button type="button" role="menuitem" class="note-move-menu__item" @click="emit('new-folder', current.projectId ?? null)">
      <UiIcon name="FolderPlus" :size="15" aria-hidden="true" />
      <span>New folder in {{ currentProjectName }}</span>
    </button>
  </div>
</template>

<style scoped>
.note-move-menu {
  position: absolute;
  z-index: 40;
  width: 248px;
  max-height: min(420px, 70vh);
  overflow-y: auto;
  box-sizing: border-box;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  padding: 6px;
  background: var(--ui-surface, var(--color-surface));
  box-shadow: var(--ui-shadow-md, 0 14px 32px rgba(15, 23, 42, 0.16));
  text-align: left;
}

.note-move-menu__label {
  margin: 4px 10px 4px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.note-move-menu__item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  padding: 7px 10px;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}

.note-move-menu__item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-move-menu__item--folder {
  padding-left: 30px;
}

.note-move-menu__item:hover,
.note-move-menu__item:focus-visible {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  outline: none;
}

.note-move-menu__item[aria-checked="true"] {
  color: var(--ui-accent-strong, var(--ui-accent));
  font-weight: 600;
}

.note-move-menu__check {
  margin-left: auto;
}

.note-move-menu__divider {
  margin: 4px 0;
  border: 0;
  border-top: 1px solid var(--ui-border, var(--color-border));
}
</style>

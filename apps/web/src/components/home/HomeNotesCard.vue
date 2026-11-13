<script lang="ts">
import { ref } from "vue";
// Cancel keeps what was typed until the app is closed, so a slip never loses a note.
const draft = ref("");
const draftProject = ref("");
</script>

<script setup lang="ts">
import { nextTick, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import { useVoiceDictation } from "../../composables/useVoiceDictation";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";

// The Notes card body on Home (me3-qvyt): the latest three standalone notes, and a field to jot a new one.
// Standalone notes are Journal articles; daily notes never show here.
export type HomeNote = { id: string; title: string | null; preview?: string; projectName?: string | null };
const props = defineProps<{ notes: HomeNote[]; open: boolean }>();
const emit = defineEmits<{ "update:open": [open: boolean]; saved: [note: HomeNote] }>();
const router = useRouter();
const { toastFromUnknown, toastSuccess } = useAppToast();
const field = ref<HTMLTextAreaElement | null>(null);
const projects = ref<{ id: string; name: string }[]>([]);
const saving = ref(false);
let projectsLoaded = false;

const dictation = useVoiceDictation({
  filenamePrefix: "note-dictation",
  disabled: () => saving.value,
  onTranscript: text => { draft.value = draft.value.trim() ? `${draft.value.trimEnd()} ${text}` : text; void nextTick(() => field.value?.focus()); },
});
const { state: voiceState, statusText: voiceError, elapsedLabel: voiceElapsed, canUse: canDictate } = dictation;

watch(() => props.open, async open => {
  if (!open) { dictation.stop({ discard: true }); return; }
  await nextTick(); field.value?.focus();
  if (projectsLoaded) return;
  projectsLoaded = true;
  // The project chip is simply absent when Projects is off or empty.
  try { projects.value = (await api.get<{ projects: { id: string; name: string }[] }>("/mission-control/projects")).projects || []; }
  catch { projects.value = []; }
}, { immediate: true });

async function dictate() {
  emit("update:open", true);
  await nextTick();
  if (voiceState.value === "idle") await dictation.start();
}
defineExpose({ dictate });

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function create() {
  const text = draft.value.trim();
  const projectId = projects.value.some(project => project.id === draftProject.value) ? draftProject.value : null;
  const body = text.split("\n").map(line => `<p>${escapeHtml(line) || "<br>"}</p>`).join("");
  const { article } = await api.post<{ article: { id: string } }>("/journal/articles", { title: null, body, bodyFormat: "html", projectId });
  const note = { id: article.id, title: null, preview: text.split("\n")[0].trim(), projectName: projects.value.find(project => project.id === projectId)?.name ?? null };
  draft.value = ""; draftProject.value = "";
  emit("saved", note); emit("update:open", false);
  return note;
}
async function save() {
  if (!draft.value.trim() || saving.value) return;
  saving.value = true;
  try { await create(); toastSuccess("Saved to Notes"); }
  catch (error) { toastFromUnknown(error, "Couldn't save your note. It's still here."); }
  finally { saving.value = false; }
}
// The full editor carries on with what was typed; an empty field starts a fresh note there.
async function expand() {
  if (saving.value) return;
  if (!draft.value.trim()) { emit("update:open", false); void router.push("/journal?new=note"); return; }
  saving.value = true;
  try { const note = await create(); void router.push({ path: "/journal", query: { note: note.id } }); }
  catch (error) { toastFromUnknown(error, "Couldn't save your note. It's still here."); }
  finally { saving.value = false; }
}
</script>

<template>
  <div v-if="open" class="notes-new" @keydown.esc.stop.prevent="emit('update:open', false)">
    <textarea ref="field" v-model="draft" rows="4" placeholder="Jot a note…" aria-label="Note" @keydown.meta.enter.prevent="save" @keydown.ctrl.enter.prevent="save" />
    <div class="notes-new__row">
      <label v-if="projects.length" class="notes-chip" :class="{ 'is-on': draftProject }">
        <UiIcon name="Folder" :size="15" aria-hidden="true" />
        <select v-model="draftProject" aria-label="Project">
          <option value="">Project</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
      </label>
      <button type="button" class="notes-chip notes-chip--icon" :class="{ 'is-on': voiceState === 'listening' }" :aria-label="voiceState === 'listening' ? 'Stop dictation' : 'Dictate'" :aria-pressed="voiceState === 'listening'" :disabled="!canDictate" @click="dictation.toggle()"><UiIcon :name="voiceState === 'listening' ? 'Square' : 'Mic'" :size="16" /></button>
      <button type="button" class="notes-chip notes-chip--icon" aria-label="Open full editor" title="Open full editor" :disabled="saving" @click="expand"><UiIcon name="Maximize2" :size="16" /></button>
      <span class="notes-new__status" role="status">{{ voiceState === 'listening' ? `Listening ${voiceElapsed}` : voiceState === 'processing' ? 'Writing it down…' : voiceError }}</span>
      <Button color="primary" shape="pill" size="compact" type="button" :disabled="!draft.trim() || saving" @click="save">Save</Button>
    </div>
  </div>
  <template v-else>
    <RouterLink v-for="note in notes" :key="note.id" :to="{ path: '/journal', query: { note: note.id } }" class="notes-row">
      <span class="notes-row__label">{{ note.title || note.preview || 'Untitled note' }}</span>
      <span v-if="note.projectName" class="notes-row__tag">{{ note.projectName }}</span>
    </RouterLink>
    <p v-if="!notes.length" class="notes-empty">No notes yet</p>
  </template>
</template>

<style scoped>
.notes-row { display: flex; align-items: center; gap: 10px; min-height: 40px; color: var(--ui-text); text-decoration: none; }
.notes-row:hover .notes-row__label { text-decoration: underline; text-underline-offset: 3px; }
.notes-row__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notes-row__tag { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; border-radius: 999px; background: var(--ui-accent-soft); color: var(--ui-accent-strong); font-size: 12px; font-weight: 600; }
.notes-empty { min-height: 36px; display: flex; align-items: center; margin: 0; color: var(--ui-text-muted); font-size: 14px; }
.notes-new { display: grid; gap: 10px; padding-top: 2px; }
.notes-new textarea { width: 100%; min-height: 110px; padding: 12px 14px; border: 0; border-radius: 14px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 16px; line-height: 1.5; resize: vertical; }
/* The caret marks focus; the mockup keeps the field free of an accent border. */
.notes-new textarea:focus-visible { outline: none; }
.notes-new__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.notes-new__status { flex: 1; min-width: 0; color: var(--ui-text-muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notes-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; max-width: 46%; padding: 0 12px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.notes-chip.is-on { background: var(--ui-accent-soft); color: var(--ui-accent-strong); }
.notes-chip--icon { justify-content: center; width: 36px; min-width: 36px; padding: 0; }
.notes-chip:disabled { opacity: .35; cursor: default; }
.notes-chip:focus-visible, .notes-chip:focus-within { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.notes-chip select { min-width: 0; max-width: 100%; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; appearance: none; text-overflow: ellipsis; }
.notes-chip select:focus { outline: none; }
</style>

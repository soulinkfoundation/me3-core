<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import { useContactsStore, type ProspectImportResult } from "../../stores/contacts";
import { parseProspectList } from "../../utils/outreachImport";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; imported: [result: ProspectImportResult] }>();

const contactsStore = useContactsStore();
const text = ref("");
const saving = ref(false);
const error = ref("");
const result = ref<ProspectImportResult | null>(null);

const parsed = computed(() => parseProspectList(text.value));
const canImport = computed(() => parsed.value.rows.length > 0 && !saving.value);
const preview = computed(() => parsed.value.rows.slice(0, 5));
const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    text.value = "";
    error.value = "";
    result.value = null;
  },
);

async function pickFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 2_000_000) {
    error.value = "That file is too big. Import up to 2 MB at a time.";
    return;
  }
  error.value = "";
  text.value = await file.text();
}

async function runImport() {
  if (!canImport.value) return;
  saving.value = true;
  error.value = "";
  try {
    const done = await contactsStore.importProspects(parsed.value.rows);
    if (done.error) error.value = done.error;
    if (done.created + done.updated > 0) emit("imported", done);
    if (done.error || done.skipped.length > 0) result.value = done;
    else emit("close");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" aria-label="Import a list" close-on-backdrop @close="emit('close')">
    <form class="import-prospects" @submit.prevent="runImport">
      <div class="import-prospects__bar">
        <button type="button" class="import-prospects__link import-prospects__link--muted" @click="emit('close')">
          {{ result ? "Done" : "Cancel" }}
        </button>
        <h2>Import a list</h2>
        <button v-if="!result" type="submit" class="import-prospects__link" :disabled="!canImport">
          {{ saving ? "Importing…" : "Import" }}
        </button>
        <span v-else />
      </div>

      <template v-if="result">
        <p class="import-prospects__summary" role="status">
          Added {{ people(result.created) }}<template v-if="result.updated">, updated {{ result.updated }}</template>.
        </p>
        <template v-if="result.skipped.length">
          <p class="import-prospects__hint">Left out:</p>
          <ul class="import-prospects__list">
            <li v-for="(item, index) in result.skipped" :key="index">
              <span>{{ item.name || "No name" }}</span>
              <span class="import-prospects__reason">{{ item.reason }}</span>
            </li>
          </ul>
        </template>
      </template>
      <template v-else>
        <textarea
          v-model="text"
          class="import-prospects__paste"
          rows="7"
          aria-label="Your list"
          placeholder="Paste rows from a spreadsheet, or one name per line"
          spellcheck="false"
        />
        <label class="import-prospects__file">
          <UiIcon name="Upload" :size="16" aria-hidden="true" />
          <span>Choose a CSV file</span>
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" @change="pickFile" />
        </label>
        <p class="import-prospects__hint">
          With a heading row, ME3 reads name, organisation, email, phone, offer, status, follow up and notes.
        </p>
        <div v-if="parsed.rows.length" class="import-prospects__preview" aria-live="polite">
          <p class="import-prospects__summary">
            {{ people(parsed.rows.length) }} ready<template v-if="parsed.unnamed">, {{ parsed.unnamed }} without a name left out</template>.
          </p>
          <ul class="import-prospects__list">
            <li v-for="(row, index) in preview" :key="index">
              <span>{{ row.organisation && row.organisation !== row.name ? `${row.organisation} · ${row.name}` : row.name }}</span>
              <span class="import-prospects__reason">{{ [row.email, row.phone, row.status].filter(Boolean).join(" · ") }}</span>
            </li>
            <li v-if="parsed.rows.length > preview.length" class="import-prospects__reason">
              and {{ parsed.rows.length - preview.length }} more
            </li>
          </ul>
        </div>
      </template>

      <p v-if="error" class="import-prospects__error" role="alert">{{ error }}</p>
      <p class="import-prospects__note">
        <UiIcon name="Lock" :size="14" aria-hidden="true" />
        Only in your ME3. Nothing is sent to them.
      </p>
    </form>
  </AppDialog>
</template>

<style scoped>
.import-prospects {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(480px, 100%);
  max-height: min(86vh, 720px);
  overflow-y: auto;
  padding: 16px 18px 22px;
  border-radius: 20px;
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md);
  color: var(--ui-text);
}

.import-prospects__bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.import-prospects__bar h2 {
  margin: 0;
  font-size: 17px;
}

.import-prospects__link {
  justify-self: end;
  min-height: 36px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--ui-accent);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.import-prospects__link--muted {
  justify-self: start;
  color: var(--ui-text-muted);
  font-weight: 500;
}

.import-prospects__link:disabled {
  opacity: 0.35;
  cursor: default;
}

.import-prospects__paste {
  box-sizing: border-box;
  width: 100%;
  min-height: 132px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  outline: none;
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font: inherit;
  font-size: 15px;
  line-height: 1.4;
  resize: vertical;
}

.import-prospects__paste:focus-visible {
  box-shadow: inset 0 0 0 2px var(--ui-accent);
}

.import-prospects__file {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  min-height: 36px;
  color: var(--ui-accent);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.import-prospects__file input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.import-prospects__file:focus-within {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
  border-radius: 6px;
}

.import-prospects__hint,
.import-prospects__note {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.import-prospects__note {
  display: flex;
  align-items: center;
  gap: 6px;
}

.import-prospects__summary {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.import-prospects__preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.import-prospects__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
}

.import-prospects__list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.import-prospects__list li > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-prospects__reason {
  flex-shrink: 0;
  max-width: 60%;
  overflow: hidden;
  color: var(--ui-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-prospects__error {
  margin: 0;
  color: #b33b2e;
  font-size: 14px;
}

@media (max-width: 640px) {
  .import-prospects {
    width: 100%;
    border-radius: 20px 20px 0 0;
    padding-bottom: max(22px, env(safe-area-inset-bottom));
  }
}
</style>

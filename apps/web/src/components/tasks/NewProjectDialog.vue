<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ApiError, api } from "../../api";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import IconPicker from "../IconPicker.vue";
import ProjectIcon from "./ProjectIcon.vue";

// Adds a project from outside Tasks (the Journal). Projects are shared with Tasks,
// so editing, logos and deleting stay there.
export type CreatedProject = { id: string; name: string; slug?: string | null; icon?: string | null; description?: string | null };

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [project: CreatedProject] }>();

const name = ref("");
const purpose = ref("");
const icon = ref("");
const saving = ref(false);
const error = ref("");

const disabled = computed(() => saving.value || !name.value.trim());

watch(() => props.open, (open) => {
  if (!open) return;
  name.value = "";
  purpose.value = "";
  icon.value = "";
  error.value = "";
});

function close() {
  if (saving.value) return;
  emit("close");
}

async function save() {
  if (disabled.value) return;
  saving.value = true;
  error.value = "";
  try {
    const response = await api.post<{ project: CreatedProject }>("/mission-control/projects", {
      name: name.value.trim(),
      description: purpose.value.trim() || null,
      icon: icon.value || null,
    });
    emit("created", response.project);
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : "Project could not be added";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" labelled-by="new-project-dialog-title" close-on-backdrop @close="close">
    <form class="new-project" @submit.prevent="save">
      <header class="new-project__header">
        <Button color="ghost" shape="soft" size="compact" type="button" @click="close">Cancel</Button>
        <h2 id="new-project-dialog-title">New project</h2>
        <Button color="primary" shape="soft" size="compact" type="submit" :disabled="disabled">
          {{ saving ? "Adding..." : "Add" }}
        </Button>
      </header>
      <div class="new-project__content">
        <div class="new-project__heading">
          <ProjectIcon :icon="icon" :name="name || 'Project'" size="large" />
          <div>
            <strong>{{ name || "New project" }}</strong>
            <span>Shared with your tasks.</span>
          </div>
        </div>
        <label class="new-project__field">
          <span>Name</span>
          <input v-model="name" type="text" autocomplete="off" autofocus />
        </label>
        <label class="new-project__field">
          <span>Purpose</span>
          <textarea v-model="purpose" rows="3" />
        </label>
        <label class="new-project__field">
          <span>Icon</span>
          <IconPicker v-model="icon" aria-label="Project icon" />
        </label>
        <p v-if="error" class="new-project__error" role="alert">{{ error }}</p>
        <RouterLink class="new-project__link" to="/tasks" @click="emit('close')">Manage projects in Tasks</RouterLink>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.new-project {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(520px, calc(100vw - 32px));
  max-height: min(820px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}

.new-project__header {
  display: grid;
  grid-template-columns: minmax(72px, 1fr) auto minmax(72px, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ui-border);
}

.new-project__header > :first-child {
  justify-self: start;
}

.new-project__header > :last-child {
  justify-self: end;
}

.new-project__header h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.2;
}

.new-project__content {
  display: grid;
  gap: 18px;
  overflow-y: auto;
  padding: 20px;
}

.new-project__heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.new-project__heading > div {
  display: grid;
  gap: 3px;
}

.new-project__heading span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.new-project__field {
  display: grid;
  gap: 7px;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 680;
}

.new-project__field input,
.new-project__field textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg);
  color: var(--ui-text);
  font: inherit;
}

.new-project__field input {
  min-height: 42px;
  padding: 0 11px;
}

.new-project__field textarea {
  resize: vertical;
  padding: 11px;
  line-height: 1.5;
}

.new-project__field input:focus,
.new-project__field textarea:focus {
  border-color: var(--ui-focus);
  outline: 2px solid color-mix(in oklab, var(--ui-focus), transparent 65%);
  outline-offset: 1px;
}

.new-project__error {
  margin: 0;
  color: var(--ui-danger);
  font-size: 13px;
}

.new-project__link {
  justify-self: start;
  color: var(--ui-text-muted);
  font-size: 13px;
}

@media (max-width: 640px) {
  .new-project {
    width: 100vw;
    max-height: min(92vh, 92dvh);
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0;
  }

  .new-project__content {
    padding: 18px 16px 28px;
  }
}
</style>

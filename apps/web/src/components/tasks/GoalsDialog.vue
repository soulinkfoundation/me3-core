<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";

type Goal = { id: string; title: string; status: "active" | "completed" };
const emit = defineEmits<{ close: [] }>();
const { toastSuccess, toastFromUnknown } = useAppToast();
const goals = ref<Goal[]>([]);
const form = ref<HTMLFormElement | null>(null);
const loading = ref(true);
const saving = ref(false);
const loaded = ref(false);

async function loadGoals() {
  loading.value = true;
  try {
    const response = await api.get<{ goals: Goal[] }>("/tasks/goals");
    goals.value = response.goals.map((goal) => ({ ...goal }));
    loaded.value = true;
  } catch (error) {
    toastFromUnknown(error, "Goals could not be loaded");
  } finally {
    loading.value = false;
  }
}

function addGoal() {
  goals.value.push({ id: `goal-${crypto.randomUUID()}`, title: "", status: "active" });
  void nextTick(() => {
    form.value?.querySelectorAll<HTMLInputElement>(".goal-title").item(goals.value.length - 1)?.focus();
  });
}

async function saveGoals() {
  if (!loaded.value || saving.value) return;
  saving.value = true;
  try {
    await api.patch("/tasks/goals", {
      goals: goals.value
        .map((goal) => ({ ...goal, title: goal.title.trim() }))
        .filter((goal) => goal.title),
    });
    toastSuccess("Goals saved");
    emit("close");
  } catch (error) {
    toastFromUnknown(error, "Goals could not be saved");
  } finally {
    saving.value = false;
  }
}

onMounted(loadGoals);
</script>

<template>
  <AppDialog
    open
    labelled-by="goals-title"
    described-by="goals-description"
    @close="!saving && emit('close')"
  >
    <form ref="form" class="goals-dialog" :aria-busy="loading || saving" @submit.prevent="saveGoals">
      <header>
        <h2 id="goals-title">Goals</h2>
        <Button
          color="ghost"
          size="compact"
          shape="soft"
          icon-only
          aria-label="Close goals"
          title="Close goals"
          :disabled="saving"
          @click="emit('close')"
        >
          <UiIcon name="X" :size="18" />
        </Button>
      </header>
      <p id="goals-description">Keep the outcomes you are working towards here.</p>
      <p v-if="loading" role="status">Loading goals…</p>
      <Button v-else-if="!loaded" color="outline" @click="loadGoals">Retry loading goals</Button>
      <fieldset v-else :disabled="saving">
        <legend class="sr-only">Your goals</legend>
        <p v-if="!goals.length" class="goals-empty">What would you like to work towards?</p>
        <div v-for="(goal, index) in goals" :key="goal.id" class="goal-row">
          <input
            v-model="goal.status"
            type="checkbox"
            true-value="completed"
            false-value="active"
            :aria-label="`Mark ${goal.title || 'goal'} ${goal.status === 'completed' ? 'active' : 'complete'}`"
          />
          <label class="sr-only" :for="`goal-${index}`">Goal {{ index + 1 }}</label>
          <input
            :id="`goal-${index}`"
            v-model="goal.title"
            class="goal-title"
            :class="{ 'is-completed': goal.status === 'completed' }"
            maxlength="600"
            placeholder="e.g. Publish four useful videos this month"
          />
          <Button
            color="ghost"
            size="compact"
            shape="soft"
            icon-only
            :aria-label="`Remove ${goal.title || 'goal'}`"
            title="Remove goal"
            @click="goals.splice(index, 1)"
          >
            <UiIcon name="Trash2" :size="16" />
          </Button>
        </div>
        <Button color="ghost" size="compact" shape="soft" :disabled="goals.length >= 20" @click="addGoal"><UiIcon name="Plus" :size="16" /> Add goal</Button>
      </fieldset>
      <footer>
        <Button color="ghost" shape="soft" :disabled="saving" @click="emit('close')">Cancel</Button>
        <Button type="submit" color="primary" shape="soft" :disabled="loading || !loaded || saving">{{ saving ? "Saving…" : "Save goals" }}</Button>
      </footer>
    </form>
  </AppDialog>
</template>

<style scoped>
.goals-dialog {
  box-sizing: border-box;
  width: min(600px, 100%);
  max-height: calc(100dvh - 48px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-bg);
  color: var(--ui-text);
  box-shadow: var(--ui-shadow-md);
}
header, footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 20px;
}
p {
  color: var(--ui-text-muted);
  font-size: 14px;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 20px 0;
  min-width: 0;
}
.goal-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border);
}
.goal-row:last-of-type {
  margin-bottom: 12px;
}
.goal-row input[type="checkbox"] {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  accent-color: var(--ui-accent);
}
.goal-title {
  min-width: 0;
  flex: 1;
  padding: 9px 4px;
  color: var(--ui-text);
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 14px;
}
.goal-title:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
  border-radius: var(--ui-radius-sm);
}
.is-completed {
  text-decoration: line-through;
  color: var(--ui-text-muted);
}
footer {
  justify-content: flex-end;
  margin-top: 20px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 640px) {
  .goals-dialog {
    align-self: end;
    max-height: 90dvh;
    padding: 20px 16px;
    border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0;
  }
}
</style>

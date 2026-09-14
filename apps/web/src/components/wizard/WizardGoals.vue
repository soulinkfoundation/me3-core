<script setup lang="ts">
import { ref } from "vue";
import { useWizardStore, type WizardSiteGoal } from "../../stores/wizard";
import { useAppToast } from "../../composables/useAppToast";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";

const wizard = useWizardStore();
const { toastSuccess } = useAppToast();
const goals = ref<WizardSiteGoal[]>(wizard.profile.business.goals.map((goal) => ({ ...goal })));
function addGoal() {
  goals.value.push({ id: `goal-${crypto.randomUUID()}`, title: "", status: "active" });
}
function saveGoals() {
  const siteGoals = goals.value.map((goal) => ({ ...goal, title: goal.title.trim() })).filter((goal) => goal.title);
  wizard.updateProfile({ business: { ...wizard.profile.business, goals: siteGoals } });
  goals.value = siteGoals;
  toastSuccess("Site goals saved");
}
function removeGoal(goalId: string) {
  goals.value = goals.value.filter((goal) => goal.id !== goalId);
  saveGoals();
}
</script>

<template>
  <div class="step-goals">
    <h2>Site goals</h2>
    <p class="section-desc">
      Keep the outcomes this site is working towards here.
    </p>

    <div class="goal-list">
      <div
        v-for="(goal, index) in goals"
        :key="goal.id"
        class="goal-card"
      >
        <label class="goal-toggle">
          <input
            v-model="goal.status"
            type="checkbox"
            true-value="completed"
            false-value="active"
            :aria-label="
              goal.status === 'completed'
                ? `Mark ${goal.title || 'goal'} active`
                : `Mark ${goal.title || 'goal'} complete`
            "
            @change="saveGoals"
          />
          <span class="goal-toggle-ui" />
        </label>
        <input
          v-model="goal.title"
          class="goal-input"
          type="text"
          maxlength="600"
          placeholder="e.g. Publish four useful videos this month"
          :aria-label="`Goal ${index + 1} title`"
          :class="{ 'is-completed': goal.status === 'completed' }"
          @change="saveGoals"
        />
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          type="button"
          :aria-label="`Remove ${goal.title || 'goal'}`"
          title="Remove goal"
          @click="removeGoal(goal.id)"
        >
          <UiIcon name="Trash2" :size="16" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <Button
      color="outline"
      shape="soft"
      size="compact"
      type="button"
      @click="addGoal"
    >
      <UiIcon name="Plus" :size="16" aria-hidden="true" />
      Add goal
    </Button>

  </div>
</template>

<style scoped>
.step-goals h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.section-desc {
  color: var(--color-text-muted);
  font-size: 14px;
  margin-bottom: 24px;
}

.goal-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.goal-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg);
}

.goal-input {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  padding: 10px 12px;
}

.goal-input:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.goal-input.is-completed {
  color: var(--color-text-muted);
  text-decoration: line-through;
}

.goal-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.goal-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.goal-toggle-ui {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 2px solid var(--color-border);
  border-radius: 999px;
}

.goal-toggle input:checked + .goal-toggle-ui {
  border-color: var(--color-text);
  background: var(--color-text);
}

.goal-toggle input:focus-visible + .goal-toggle-ui {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.goal-toggle input:checked + .goal-toggle-ui::after {
  content: "✓";
  color: var(--color-bg);
  font-size: 14px;
  font-weight: 700;
}

@media (max-width: 640px) {
  .goal-card {
    align-items: flex-start;
  }
}
</style>

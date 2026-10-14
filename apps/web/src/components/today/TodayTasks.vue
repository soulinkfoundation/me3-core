<script setup lang="ts">
import { ref } from "vue";
import UiIcon from "../UiIcon.vue";
import TodaySection from "./TodaySection.vue";
import type { HomeTask } from "../../utils/homeSummary";

const props = withDefaults(defineProps<{ tasks: HomeTask[]; focusGoalId?: string | null; busy?: string[]; limit?: number; moreTo?: string; backlogCount?: number }>(), { focusGoalId: null, busy: () => [], limit: 0, moreTo: "/tasks", backlogCount: 0 });
const emit = defineEmits<{ complete: [task: HomeTask]; add: [title: string, done: () => void] }>();
const draft = ref("");
const adding = ref(false);
const shown = () => props.limit ? props.tasks.slice(0, props.limit) : props.tasks;
function submit() {
  const title = draft.value.trim();
  if (!title || adding.value) return;
  adding.value = true;
  emit("add", title, () => { adding.value = false; draft.value = ""; });
}
</script>

<template>
  <TodaySection title="Tasks" to="/tasks" label="Open Tasks">
    <div v-for="task in shown()" :key="task.id" class="today-task">
      <button type="button" class="today-task__check" :aria-label="`Complete ${task.title}`" :disabled="busy.includes(task.id)" @click="emit('complete', task)"><UiIcon name="Circle" :size="20" /></button>
      <RouterLink :to="`/tasks?task=${encodeURIComponent(task.id)}`" class="today-task__title">{{ task.title }}</RouterLink>
      <UiIcon v-if="focusGoalId && task.goalId === focusGoalId" name="Goal" :size="15" class="today-task__goal" title="Focus goal" aria-label="Focus goal" />
    </div>
    <!-- Empty: one quiet line, and a way into the backlog when it has something. -->
    <p v-if="!tasks.length" class="today-task__empty">Nothing for today.<RouterLink v-if="backlogCount" :to="{ path: '/tasks', query: { view: 'backlog' } }">Pick from backlog</RouterLink></p>
    <RouterLink v-if="limit && tasks.length > limit" :to="moreTo" class="today-task__more">{{ tasks.length - limit }} more</RouterLink>
    <form class="today-task today-task--add" @submit.prevent="submit">
      <UiIcon name="Plus" :size="18" class="today-task__plus" />
      <input v-model="draft" type="text" placeholder="Add a task" aria-label="Add a task" maxlength="300" :disabled="adding" />
    </form>
  </TodaySection>
</template>

<style scoped>
.today-task { display: flex; align-items: center; gap: 8px; min-height: 40px; font-size: 15px; }
.today-task__check { display: grid; place-items: center; width: 36px; min-width: 36px; min-height: 40px; margin-left: -8px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.today-task__check:hover { background: var(--ui-surface-muted); }
.today-task__check:disabled { opacity: .35; cursor: default; }
.today-task__title { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-text); text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.today-task__goal { flex-shrink: 0; color: var(--ui-text-muted); opacity: .6; }
.today-task__more { align-self: flex-start; min-height: 32px; color: var(--ui-text-muted); font-size: 14px; text-decoration: none; }
.today-task__empty { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 4px 0 2px; color: var(--ui-text-muted); font-size: 14px; }
.today-task__empty a { color: var(--ui-text-muted); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
.today-task__empty a:hover { color: var(--ui-text); }
.today-task--add { color: var(--ui-text-muted); }
.today-task__plus { width: 20px; margin: 0 8px 0 0; flex-shrink: 0; }
.today-task--add input { flex: 1; min-width: 0; min-height: 40px; padding: 0; border: 0; outline: none; background: transparent; color: var(--ui-text); font: inherit; }
.today-task--add input::placeholder { color: var(--ui-text-muted); opacity: .8; }
.today-task--add:focus-within { box-shadow: inset 0 -1px 0 var(--ui-accent); }
</style>

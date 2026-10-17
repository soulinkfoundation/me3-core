<script setup lang="ts">
import { computed, ref } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import { focusGoal, homeTodayTasks, localDateKey, type HomeGoal, type HomeTask } from "../../utils/homeSummary";

// Today's page is where you work: the focus goal, then today's tasks, then your notes.
// Tasks are added from the editor (the task button, or Task on selected text), so there's no add row.
const props = withDefaults(defineProps<{ tasks: HomeTask[]; goals: HomeGoal[]; busy?: string[] }>(), { busy: () => [] });
const emit = defineEmits<{ complete: [task: HomeTask]; focus: [goalId: string] }>();
const picking = ref(false);
const activeGoals = computed(() => props.goals.filter(goal => goal.status !== "completed"));
const focus = computed(() => focusGoal(props.goals));
const doneToday = computed(() => props.tasks.filter(task => !task.archivedAt && task.status === "done" && task.updatedAt && localDateKey(new Date(task.updatedAt)) === localDateKey(new Date())));
const dayTasks = computed(() => [...doneToday.value, ...homeTodayTasks(props.tasks)]);
function choose(id: string) { picking.value = false; if (id !== focus.value?.id) emit("focus", id); }
</script>

<template>
  <section class="day-plan" aria-label="Today's plan">
    <button v-if="focus" type="button" class="day-plan__goal" :aria-label="`Focus goal: ${focus.title}, ${focus.progress || 0} percent. Choose a different focus goal`" @click="picking = true">
      <span class="day-plan__goal-title"><UiIcon name="Goal" :size="18" class="day-plan__goal-icon" />{{ focus.title }}</span>
      <span class="day-plan__bar" aria-hidden="true"><i :style="{ width: `${focus.progress || 0}%` }" /></span>
    </button>
    <div class="day-plan__head"><h3>Tasks</h3><RouterLink to="/tasks">All tasks</RouterLink></div>
    <div v-for="task in dayTasks" :key="task.id" class="day-plan__task" :class="{ 'is-done': task.status === 'done' }">
      <button type="button" :disabled="task.status === 'done' || busy.includes(task.id)" :aria-label="task.status === 'done' ? `${task.title}, done` : `Complete ${task.title}`" @click="emit('complete', task)">
        <UiIcon :name="task.status === 'done' ? 'CircleCheck' : 'Circle'" :size="20" />
      </button>
      <RouterLink :to="`/tasks?task=${encodeURIComponent(task.id)}`">{{ task.title }}</RouterLink>
    </div>
    <p v-if="!dayTasks.length" class="day-plan__empty">Nothing for today. Select text and choose Task, or use the task button.</p>
    <AppDialog :open="picking" aria-label="Focus goal" @close="picking = false">
      <section class="day-plan__picker">
        <header><h2>Focus goal</h2><button type="button" aria-label="Close" @click="picking = false"><UiIcon name="X" :size="18" /></button></header>
        <button v-for="goal in activeGoals" :key="goal.id" type="button" class="day-plan__option" :aria-pressed="goal.id === focus?.id" @click="choose(goal.id)">
          <span class="day-plan__goal-title">{{ goal.title }}<UiIcon v-if="goal.id === focus?.id" name="Check" :size="16" class="day-plan__check" /></span>
          <span class="day-plan__bar" aria-hidden="true"><i :style="{ width: `${goal.progress || 0}%` }" /></span>
        </button>
        <RouterLink to="/mission" class="day-plan__mission" @click="picking = false">Open Mission</RouterLink>
      </section>
    </AppDialog>
  </section>
</template>

<style scoped>
.day-plan { display: flex; flex-direction: column; margin: 4px 0 18px; }
.day-plan__goal, .day-plan__option { display: grid; gap: 8px; width: 100%; min-height: 44px; padding: 6px 0; border: 0; background: transparent; color: var(--ui-text); font: inherit; text-align: left; cursor: pointer; }
.day-plan__goal { margin-bottom: 12px; }
.day-plan__goal-title { display: flex; align-items: flex-start; gap: 8px; font-size: 15px; font-weight: 600; line-height: 1.35; }
.day-plan__goal-icon { flex-shrink: 0; margin-top: 1px; color: var(--ui-accent); }
.day-plan__bar { display: block; height: 4px; margin-left: 26px; border-radius: 4px; background: var(--ui-surface-muted); overflow: hidden; }
.day-plan__bar i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); }
.day-plan__head { display: flex; align-items: center; justify-content: space-between; min-height: 32px; }
.day-plan__head h3 { margin: 0; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.day-plan__head a { color: var(--ui-accent); font-size: 14px; font-weight: 600; text-decoration: none; }
.day-plan__task { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 16px; }
.day-plan__task button { display: grid; place-items: center; width: 36px; min-height: 40px; margin-left: -8px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.day-plan__task button:hover:not(:disabled) { background: var(--ui-surface-muted); }
.day-plan__task a { flex: 1; min-width: 0; color: var(--ui-text); text-decoration: none; }
.day-plan__task.is-done button { color: var(--ui-accent); cursor: default; }
.day-plan__task.is-done a { color: var(--ui-text-muted); text-decoration: line-through; }
.day-plan__empty { margin: 4px 0; color: var(--ui-text-muted); font-size: 14px; }
.day-plan__picker { display: grid; gap: 4px; width: min(480px, 100%); padding: 18px; }
.day-plan__picker header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.day-plan__picker h2 { margin: 0; font-size: 17px; }
.day-plan__picker header button { display: grid; place-items: center; min-width: 44px; min-height: 44px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-text); cursor: pointer; }
.day-plan__option { padding: 10px 12px; border-radius: 14px; }
.day-plan__option[aria-pressed="true"] { background: var(--ui-accent-soft); }
.day-plan__option .day-plan__bar { margin-left: 0; }
.day-plan__check { margin-left: auto; flex-shrink: 0; color: var(--ui-accent); }
.day-plan__mission { min-height: 44px; display: flex; align-items: center; padding: 0 12px; color: var(--ui-accent); font-weight: 600; text-decoration: none; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
</style>

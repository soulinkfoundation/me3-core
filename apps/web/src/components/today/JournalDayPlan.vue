<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import { focusGoal, homeTodayTasks, localDateKey, type HomeGoal, type HomeTask } from "../../utils/homeSummary";

// Today's page is where you work: the focus goal, then today's tasks, then your notes.
// Tasks are added from the editor: Task on selected text, or the task button. On an empty line
// the task button opens the add row here. With no tasks the section isn't shown at all.
const props = withDefaults(defineProps<{ tasks: HomeTask[]; goals: HomeGoal[]; busy?: string[]; adding?: boolean }>(), { busy: () => [], adding: false });
const emit = defineEmits<{ complete: [task: HomeTask]; focus: [goalId: string]; progress: [goalId: string, progress: number]; add: [title: string]; "cancel-add": [] }>();
const newTask = ref("");
const addInput = ref<HTMLInputElement | null>(null);
watch(() => props.adding, async (adding) => {
  newTask.value = "";
  if (adding) { await nextTick(); addInput.value?.focus(); }
});
function submitNewTask() {
  const title = newTask.value.trim();
  if (title) emit("add", title);
  else emit("cancel-add");
  newTask.value = "";
}
const picking = ref(false);
const focus = computed(() => focusGoal(props.goals));
const otherGoals = computed(() => props.goals.filter(goal => goal.status !== "completed" && goal.id !== focus.value?.id));
// The slider moves freely and the goal saves once you let go, so a drag is one save, not twenty.
const dragging = ref<number | null>(null);
const shownProgress = computed(() => dragging.value ?? focus.value?.progress ?? 0);
function commitProgress() {
  if (dragging.value === null || !focus.value) return;
  const value = dragging.value; dragging.value = null;
  if (value !== (focus.value.progress || 0)) emit("progress", focus.value.id, value);
}
const doneToday = computed(() => props.tasks.filter(task => !task.archivedAt && task.status === "done" && task.updatedAt && localDateKey(new Date(task.updatedAt)) === localDateKey(new Date())));
const dayTasks = computed(() => [...doneToday.value, ...homeTodayTasks(props.tasks)]);
const visible = computed(() => Boolean(focus.value) || dayTasks.value.length > 0 || props.adding);
function choose(id: string) { if (id !== focus.value?.id) emit("focus", id); }
</script>

<template>
  <section v-if="visible || picking" class="day-plan" aria-label="Today's plan">
    <button v-if="focus" type="button" class="day-plan__goal" :aria-label="`Focus goal: ${focus.title}, ${focus.progress || 0} percent. Update progress or change focus`" @click="picking = true">
      <span class="day-plan__goal-title"><UiIcon name="Goal" :size="18" class="day-plan__goal-icon" />{{ focus.title }}</span>
      <span class="day-plan__bar" aria-hidden="true"><i :style="{ width: `${focus.progress || 0}%` }" /></span>
    </button>
    <div v-for="task in dayTasks" :key="task.id" class="day-plan__task" :class="{ 'is-done': task.status === 'done' }">
      <button type="button" :disabled="task.status === 'done' || busy.includes(task.id)" :aria-label="task.status === 'done' ? `${task.title}, done` : `Complete ${task.title}`" @click="emit('complete', task)">
        <UiIcon :name="task.status === 'done' ? 'CircleCheck' : 'Circle'" :size="20" />
      </button>
      <RouterLink :to="`/tasks?task=${encodeURIComponent(task.id)}`">{{ task.title }}</RouterLink>
    </div>
    <form v-if="adding" class="day-plan__task day-plan__add" @submit.prevent="submitNewTask">
      <UiIcon name="Circle" :size="20" class="day-plan__add-icon" />
      <input ref="addInput" v-model="newTask" type="text" maxlength="180" placeholder="New task" aria-label="New task" enterkeyhint="done" @keydown.esc.prevent="emit('cancel-add')" @blur="submitNewTask" />
    </form>
    <RouterLink v-if="dayTasks.length || adding" to="/tasks" class="day-plan__all">All tasks</RouterLink>
    <AppDialog :open="picking" labelled-by="day-plan-goal-title" close-on-backdrop @close="picking = false">
      <section class="goal-sheet">
        <header class="goal-sheet__head">
          <h2 id="day-plan-goal-title">Focus goal</h2>
          <button type="button" class="goal-sheet__close" aria-label="Close" @click="picking = false"><UiIcon name="X" :size="18" /></button>
        </header>
        <div v-if="focus" class="goal-sheet__focus">
          <p class="goal-sheet__title">{{ focus.title }}</p>
          <label class="goal-sheet__range"><span>Progress</span><output>{{ shownProgress }}%</output>
            <input type="range" min="0" max="100" step="5" :value="shownProgress" :aria-label="`Progress for ${focus.title}`"
              @input="dragging = Number(($event.target as HTMLInputElement).value)" @change="commitProgress" />
          </label>
        </div>
        <template v-if="otherGoals.length">
          <h3 class="goal-sheet__label">Switch focus</h3>
          <button v-for="goal in otherGoals" :key="goal.id" type="button" class="goal-sheet__option" :aria-label="`Make ${goal.title} the focus goal, ${goal.progress || 0} percent`" @click="choose(goal.id)">
            <span class="goal-sheet__option-title">{{ goal.title }}</span>
            <span class="goal-sheet__meta"><span class="day-plan__bar" aria-hidden="true"><i :style="{ width: `${goal.progress || 0}%` }" /></span>{{ goal.progress || 0 }}%</span>
          </button>
        </template>
        <footer class="goal-sheet__foot"><RouterLink to="/mission" @click="picking = false">Open Mission<UiIcon name="ChevronRight" :size="16" /></RouterLink></footer>
      </section>
    </AppDialog>
  </section>
</template>

<style scoped>
.day-plan { display: flex; flex-direction: column; margin: 4px 0 18px; }
.day-plan__goal { display: grid; gap: 8px; width: 100%; min-height: 44px; margin-bottom: 12px; padding: 6px 0; border: 0; background: transparent; color: var(--ui-text); font: inherit; text-align: left; cursor: pointer; }
.day-plan__goal-title { display: flex; align-items: flex-start; gap: 8px; font-size: 15px; font-weight: 600; line-height: 1.35; }
.day-plan__goal-icon { flex-shrink: 0; margin-top: 1px; color: var(--ui-accent); }
.day-plan__bar { display: block; height: 4px; margin-left: 26px; border-radius: 4px; background: var(--ui-surface-muted); overflow: hidden; }
.day-plan__bar i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); }
.day-plan__all { align-self: flex-end; color: var(--ui-text-muted); font-size: 13px; text-decoration: none; }
.day-plan__all:hover { color: var(--ui-text); }
.day-plan__add-icon { flex-shrink: 0; width: 36px; margin-left: -8px; color: var(--ui-text-muted); }
.day-plan__add input { flex: 1; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--ui-text); font: inherit; outline: none; }
.day-plan__add input::placeholder { color: var(--ui-text-muted); }
.day-plan__task { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 16px; }
.day-plan__task button { display: grid; place-items: center; width: 36px; min-height: 40px; margin-left: -8px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.day-plan__task button:hover:not(:disabled) { background: var(--ui-surface-muted); }
.day-plan__task a { flex: 1; min-width: 0; color: var(--ui-text); text-decoration: none; }
.day-plan__task.is-done button { color: var(--ui-accent); cursor: default; }
.day-plan__task.is-done a { color: var(--ui-text-muted); text-decoration: line-through; }
.goal-sheet { box-sizing: border-box; display: grid; gap: 4px; width: min(100%, 440px); padding: 8px 20px 12px; border-radius: var(--ui-radius-lg); background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.goal-sheet__head { display: flex; align-items: center; justify-content: space-between; margin-right: -12px; }
.goal-sheet__head h2 { margin: 0; font-size: 17px; font-weight: 600; }
.goal-sheet__close { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: var(--ui-radius-md); background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.goal-sheet__close:hover { background: var(--ui-surface-muted); color: var(--ui-text); }
.goal-sheet__focus { display: grid; gap: 12px; padding: 14px 16px 10px; border-radius: var(--ui-radius-md); background: var(--ui-accent-soft); }
.goal-sheet__title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.35; }
.goal-sheet__range { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 8px; color: var(--ui-text-muted); font-size: 13px; }
.goal-sheet__range output { color: var(--ui-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.goal-sheet__range input { grid-column: 1 / -1; width: 100%; min-height: 32px; margin: 0; accent-color: var(--ui-accent); cursor: pointer; }
.goal-sheet__label { margin: 14px 0 2px; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.goal-sheet__option { display: grid; gap: 6px; width: calc(100% + 16px); min-height: 52px; margin: 0 -8px; padding: 8px; border: 0; border-radius: var(--ui-radius-md); background: transparent; color: var(--ui-text); font: inherit; text-align: left; cursor: pointer; }
.goal-sheet__option:hover { background: var(--ui-surface-muted); }
.goal-sheet__option-title { font-size: 15px; font-weight: 500; line-height: 1.35; }
.goal-sheet__meta { display: flex; align-items: center; gap: 8px; color: var(--ui-text-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.goal-sheet__meta .day-plan__bar { flex: 0 1 160px; margin-left: 0; }
.goal-sheet__foot { display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 4px; border-top: 1px solid var(--ui-border); }
.goal-sheet__foot a { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; color: var(--ui-accent); font-size: 14px; font-weight: 600; text-decoration: none; }
@media (max-width: 640px) {
  .goal-sheet { width: 100%; padding-bottom: max(12px, env(safe-area-inset-bottom)); border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; }
}
button:focus-visible, a:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
</style>

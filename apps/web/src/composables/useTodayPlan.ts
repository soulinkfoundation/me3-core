import { computed, ref } from "vue";
import { api } from "../api";
import { focusGoal, goalsWithFocus, homeOpenTasks, type HomeGoal, type HomeTask } from "../utils/homeSummary";
import { createGoalSaveQueue } from "../utils/goalSaves";

// Today's tasks and the focus goal, shared by the Home Today card, the daily page and Mission.
export function useTodayPlan() {
  const tasks = ref<HomeTask[]>([]);
  const goals = ref<HomeGoal[]>([]);
  const busy = ref<string[]>([]);
  // ME3 replaces the whole goal list on save, so nothing saves until the goals have loaded.
  const goalsLoaded = ref(false);
  const saveGoalList = createGoalSaveQueue(list => api.patch<{ goals: HomeGoal[] }>("/tasks/goals", { goals: list }).then(response => response.goals));
  const focus = computed(() => focusGoal(goals.value));
  const openTasks = computed(() => homeOpenTasks(tasks.value));

  async function loadTasks() {
    const all: HomeTask[] = []; const seen = new Set<string>(); let cursor: string | undefined;
    do {
      const page = await api.get<{ tasks: HomeTask[]; nextCursor?: string }>(`/mission-control/tasks?${new URLSearchParams({ active: "1", limit: "100", ...(cursor ? { cursor } : {}) })}`);
      all.push(...page.tasks); cursor = page.nextCursor || undefined;
      if (cursor && seen.has(cursor)) throw new Error("Couldn't finish loading tasks. Try again.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    tasks.value = all;
  }

  async function loadGoals() {
    goals.value = (await api.get<{ goals: HomeGoal[] }>("/tasks/goals")).goals || [];
    goalsLoaded.value = true;
  }

  // Goals save as they change. Saves queue up, so a quick run of edits lands in order.
  async function saveGoals() {
    if (!goalsLoaded.value) throw new Error("Goals haven't loaded yet. Try again.");
    await saveGoalList(goals.value.map(goal => ({ ...goal })));
  }

  // Changes one goal and saves. Returns the goal as it was and where, so the change can be undone.
  async function changeGoal(id: string, edit: (goal: HomeGoal) => void) {
    const index = goals.value.findIndex(goal => goal.id === id);
    if (index < 0) return null;
    const before = { ...goals.value[index] };
    edit(goals.value[index]);
    await saveGoals();
    return { goal: before, index };
  }

  async function restoreGoal(undo: { goal: HomeGoal; index: number }) {
    const current = goals.value.findIndex(goal => goal.id === undo.goal.id);
    if (current >= 0) goals.value[current] = undo.goal;
    else goals.value.splice(Math.min(undo.index, goals.value.length), 0, undo.goal);
    await saveGoals();
  }

  async function complete(task: HomeTask) {
    if (busy.value.includes(task.id)) return;
    busy.value.push(task.id);
    try {
      const result = await api.patch<{ task: HomeTask }>(`/mission-control/tasks/${encodeURIComponent(task.id)}`, { status: "done" });
      tasks.value = tasks.value.map(item => item.id === task.id ? { ...task, ...result.task } : item);
    } finally { busy.value = busy.value.filter(id => id !== task.id); }
  }

  // Quick add puts the task in Now, so it shows on today's list straight away.
  async function addTask(title: string) {
    const result = await api.post<{ task: HomeTask }>("/mission-control/tasks", { title, status: "in_progress" });
    tasks.value = [...tasks.value, result.task];
  }

  // Goal order is the focus: the first active goal shows on Today.
  async function makeFocus(id: string) {
    const previous = goals.value;
    goals.value = goalsWithFocus(previous, id);
    try { await saveGoals(); } catch (error) { goals.value = previous; throw error; }
  }

  return { tasks, goals, goalsLoaded, busy, focus, openTasks, loadTasks, loadGoals, saveGoals, changeGoal, restoreGoal, complete, addTask, makeFocus };
}

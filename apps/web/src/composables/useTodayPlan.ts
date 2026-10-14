import { computed, ref } from "vue";
import { api } from "../api";
import { focusGoal, goalsWithFocus, homeOpenTasks, type HomeGoal, type HomeTask } from "../utils/homeSummary";

// Today's tasks and the focus goal, shared by the Home Today card, the daily page and Mission.
export function useTodayPlan() {
  const tasks = ref<HomeTask[]>([]);
  const goals = ref<HomeGoal[]>([]);
  const busy = ref<string[]>([]);
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

  // Goal order is the focus: only id and metadata are sent, so task and project links stay as they are.
  async function makeFocus(id: string) {
    const previous = goals.value;
    goals.value = goalsWithFocus(previous, id);
    try {
      await api.patch("/tasks/goals", { goals: goals.value.map(({ id, title, status, areaId, progress }) => ({ id, title, status, areaId: areaId ?? null, progress: progress ?? 0 })) });
    } catch (error) { goals.value = previous; throw error; }
  }

  return { tasks, goals, busy, focus, openTasks, loadTasks, loadGoals, complete, addTask, makeFocus };
}

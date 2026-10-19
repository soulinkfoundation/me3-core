import type { HomeGoal } from "./homeSummary";

// An untitled goal stays on screen while you type but never reaches the install. Task links are left out so
// ME3 keeps the tasks linked from Tasks; project links are sent because Mission edits them.
export function goalPayload(goals: HomeGoal[]) {
  return goals
    .map(({ id, title, status, areaId, progress, projectIds }) => ({
      id, title: title.trim(), status, areaId: areaId ?? null, progress: progress ?? 0, ...(projectIds ? { projectIds } : {}),
    }))
    .filter(goal => goal.title);
}

// ME3 takes the whole goal list in one PATCH, so saves go one at a time. An edit made while a save is in flight
// waits, and only the latest waiting list is sent, so an older answer never lands on newer edits. Resolves with
// the install's goals once nothing newer waits, or null when the list joined a save already running.
export function createGoalSaveQueue(send: (goals: ReturnType<typeof goalPayload>) => Promise<HomeGoal[]>) {
  let running = false;
  let waiting: HomeGoal[] | null = null;
  return async function save(goals: HomeGoal[]): Promise<HomeGoal[] | null> {
    if (running) { waiting = goals; return null; }
    running = true;
    let next = goals;
    try {
      for (;;) {
        const saved = await send(goalPayload(next));
        if (!waiting) return saved;
        next = waiting;
        waiting = null;
      }
    } catch (error) {
      waiting = null;
      throw error;
    } finally {
      running = false;
    }
  };
}

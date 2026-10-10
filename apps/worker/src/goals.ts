import type { Env } from "./types";
import {
  MissionControlInputError,
  isRecord,
  normalizeNullableText,
  parseJsonRecord,
} from "./workspace-input";

export function normalizeMainGoal(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 600);
}

const WHEEL_AREA_IDS = ["health", "spirituality", "work", "finances", "home", "joy"] as const;
type WheelAreaId = typeof WHEEL_AREA_IDS[number];
type MissionGoal = {
  id: string;
  title: string;
  status: "active" | "completed";
  areaId: WheelAreaId | null;
  progress: number;
  taskIds: string[];
  projectIds: string[];
};

function isWheelAreaId(value: unknown): value is WheelAreaId {
  return typeof value === "string" && (WHEEL_AREA_IDS as readonly string[]).includes(value);
}

function normalizeLinkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string")
    .map(id => id.trim()).filter(Boolean))].slice(0, 500);
}

export function normalizeMissionGoals(value: unknown, legacyMainGoal: string, previous: MissionGoal[] = []): MissionGoal[] {
  const incoming = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const goals = incoming.slice(0, 20).flatMap((item, index) => {
    const input: Record<string, unknown> = isRecord(item)
      ? item
      : { title: item };
    const title = normalizeMainGoal(input.title);
    if (!title) return [];
    const candidateId = normalizeNullableText(input.id) || `goal-${index + 1}`;
    const baseId = candidateId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `goal-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (seen.has(id)) {
      const suffixText = `-${suffix}`;
      id = `${baseId.slice(0, 80 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    seen.add(id);
    const existing = previous.find(goal => goal.id === id);
    const areaId = input.areaId === undefined ? existing?.areaId : input.areaId;
    const progress = input.progress === undefined ? existing?.progress : input.progress;
    return [
      {
        id,
        title,
        status: input.status === "completed" ? ("completed" as const) : ("active" as const),
        areaId: isWheelAreaId(areaId) ? areaId : null,
        progress: typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
        taskIds: normalizeLinkIds(input.taskIds === undefined ? existing?.taskIds : input.taskIds),
        projectIds: normalizeLinkIds(input.projectIds === undefined ? existing?.projectIds : input.projectIds),
      },
    ];
  });

  if (!Array.isArray(value) && goals.length === 0 && legacyMainGoal) {
    goals.push({
      id: "legacy-main-goal",
      title: legacyMainGoal,
      status: "active",
      areaId: null,
      progress: 0,
      taskIds: [],
      projectIds: [],
    });
  }
  return goals;
}

// Goal metadata stays in owner settings; mission_tasks.goal_id owns direct links.
export async function getGoals(env: Env, userId: string) {
  const row = await env.DB.prepare(
    "SELECT settings_json FROM mission_dashboard_settings WHERE user_id = ?",
  ).bind(userId).first<{ settings_json: string }>();
  const settings = parseJsonRecord(row?.settings_json || null);
  const goals = normalizeMissionGoals(settings.goals, normalizeMainGoal(settings.mainGoal));
  if (goals.length) {
    const linked = await env.DB.prepare(
      "SELECT id, goal_id FROM mission_tasks WHERE user_id = ? AND goal_id IS NOT NULL ORDER BY id",
    ).bind(userId).all<{ id: string; goal_id: string }>();
    for (const goal of goals) goal.taskIds = (linked.results || []).filter(task => task.goal_id === goal.id).map(task => task.id);
  }
  return { goals };
}

export async function updateGoals(env: Env, userId: string, input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.goals)) {
    throw new MissionControlInputError("Goals must be a list");
  }
  if (input.goals.length > 20) throw new MissionControlInputError("Keep up to 20 goals");
  for (const item of input.goals) {
    if (!isRecord(item)) continue;
    if (item.areaId !== undefined && item.areaId !== null && !isWheelAreaId(item.areaId)) {
      throw new MissionControlInputError("Goal area is invalid");
    }
    if (item.progress !== undefined && (typeof item.progress !== "number" || !Number.isFinite(item.progress) || item.progress < 0 || item.progress > 100)) {
      throw new MissionControlInputError("Goal progress must be a number from 0 to 100");
    }
    for (const key of ["taskIds", "projectIds"]) {
      const ids = item[key];
      if (ids !== undefined && (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== "string" || !id.trim() || id.length > 200))) {
        throw new MissionControlInputError(`Goal ${key} must be a list of up to 500 ids`);
      }
    }
  }
  const previous = (await getGoals(env, userId)).goals;
  const goals = normalizeMissionGoals(input.goals, "", previous);
  const goalInputs = input.goals.filter(item => normalizeMainGoal(isRecord(item) ? item.title : item));
  const explicitTaskLinks = new Map<string, string[]>();
  const assignedTasks = new Set<string>();
  for (const [index, goal] of goals.entries()) {
    const item = goalInputs[index];
    if (!isRecord(item)) continue;
    if (item.projectIds !== undefined) await ensureOwnedLinks(env, userId, "mission_projects", goal.projectIds);
    if (item.taskIds !== undefined) {
      for (const taskId of goal.taskIds) {
        if (assignedTasks.has(taskId)) throw new MissionControlInputError("A task can belong to only one goal");
        assignedTasks.add(taskId);
      }
      await ensureOwnedLinks(env, userId, "mission_tasks", goal.taskIds);
      explicitTaskLinks.set(goal.id, goal.taskIds);
    }
  }
  const persistedGoals = goals.map(({ taskIds: _taskIds, ...goal }) => goal);
  const statements = [env.DB.prepare(`
    INSERT INTO mission_dashboard_settings (user_id, cards_json, quick_links_json, settings_json)
    VALUES (?, '[]', '[]', json_object('goals', json(?)))
    ON CONFLICT(user_id) DO UPDATE SET
      settings_json = json_set(mission_dashboard_settings.settings_json, '$.goals', json(?)),
      updated_at = datetime('now')
  `).bind(userId, JSON.stringify(persistedGoals), JSON.stringify(persistedGoals)),
  env.DB.prepare(`UPDATE mission_tasks SET goal_id = NULL, updated_at = datetime('now')
    WHERE user_id = ? AND goal_id IS NOT NULL AND goal_id NOT IN (SELECT value FROM json_each(?))`)
    .bind(userId, JSON.stringify(goals.map(goal => goal.id)))];
  for (const goalId of explicitTaskLinks.keys()) {
    statements.push(env.DB.prepare("UPDATE mission_tasks SET goal_id = NULL, updated_at = datetime('now') WHERE user_id = ? AND goal_id = ?").bind(userId, goalId));
  }
  for (const [goalId, taskIds] of explicitTaskLinks) {
    if (taskIds.length) statements.push(env.DB.prepare(`UPDATE mission_tasks SET goal_id = ?, updated_at = datetime('now')
      WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`).bind(goalId, userId, JSON.stringify(taskIds)));
  }
  await env.DB.batch(statements);
  return getGoals(env, userId);
}

async function ensureOwnedLinks(env: Env, userId: string, table: "mission_tasks" | "mission_projects", ids: string[]) {
  if (!ids.length) return;
  const owned = await env.DB.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`)
    .bind(userId, JSON.stringify(ids)).all<{ id: string }>();
  if ((owned.results || []).length !== ids.length) throw new MissionControlInputError(table === "mission_tasks" ? "Linked task not found" : "Linked project not found", 404);
}

export async function resolveMissionGoalId(env: Env, userId: string, value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) throw new MissionControlInputError("Goal id is invalid");
  const id = value.trim();
  if (!(await getGoals(env, userId)).goals.some(goal => goal.id === id)) throw new MissionControlInputError("Goal not found", 404);
  return id;
}

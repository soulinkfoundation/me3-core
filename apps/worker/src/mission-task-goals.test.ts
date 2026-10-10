import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getGoals, updateGoals } from "./goals";
import { createMissionTask, getMissionTaskDetail, listMissionTaskPage, updateMissionTask } from "./mission-control";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const schema = readFileSync(new URL("../migrations/0001_initial_public_schema.sql", import.meta.url), "utf8");
  for (const table of ["mission_dashboard_settings", "mission_projects", "mission_tasks"]) {
    db.exec(schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))![0]);
  }
  db.exec(readFileSync(new URL("../migrations/0005_project_columns.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0013_mission_task_positions.sql", import.meta.url), "utf8"));
  const prepare = (sql: string) => {
    const statement = (values: (string | number | null)[]) => ({
      first: async () => db.prepare(sql).get(...values) || null,
      all: async () => ({ results: db.prepare(sql).all(...values) }),
      run: async () => ({ meta: db.prepare(sql).run(...values) }),
    });
    return { ...statement([]), bind: (...values: (string | number | null)[]) => statement(values) };
  };
  const env = { DB: { prepare, batch: async (statements: { run(): Promise<unknown> }[]) => {
    db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      db.exec("COMMIT");
      return results;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } } } as unknown as Env;
  return { db, env };
}
function migrate(db: DatabaseSync) {
  db.exec(readFileSync(new URL("../migrations/0060_mission_goal_links.sql", import.meta.url), "utf8"));
}

describe("Mission task goal links", () => {
  it("migrates old tasks additively and leaves legacy goals and dashboard data intact", async () => {
    const { db, env } = fixture();
    db.exec("INSERT INTO mission_tasks (id, user_id, title) VALUES ('old', 'owner', 'Existing task'); INSERT INTO mission_dashboard_settings (user_id, settings_json, cards_json) VALUES ('owner', '{\"mainGoal\":\"Legacy goal\",\"unrelated\":true}', '[\"keep\"]')");
    migrate(db);
    expect(db.prepare("SELECT title, goal_id FROM mission_tasks WHERE id='old'").get()).toEqual({ title: "Existing task", goal_id: null });
    expect(db.prepare("SELECT settings_json, cards_json FROM mission_dashboard_settings").get()).toEqual({ settings_json: '{"mainGoal":"Legacy goal","unrelated":true}', cards_json: '["keep"]' });
    expect((await getGoals(env, "owner")).goals[0]).toMatchObject({ id: "legacy-main-goal", title: "Legacy goal", areaId: null, progress: 0, taskIds: [] });
    expect((await getMissionTaskDetail(env, "owner", "old")).task.goalId).toBeNull();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mission_tasks_goal'").get()).toBeTruthy();
  });
  it("creates, lists, updates and clears a task's goal without losing links on older task edits", async () => {
    const { db, env } = fixture();
    migrate(db);
    await updateGoals(env, "owner", { goals: [{ id: "run", title: "Run a 10k", areaId: "health", progress: 35 }, { id: "journal", title: "Journal", areaId: "spirituality" }] });
    const { task } = await createMissionTask(env, "owner", { title: "Easy 5k", goalId: "run" });
    expect(task.goalId).toBe("run");
    expect((await getGoals(env, "owner")).goals[0].taskIds).toEqual([task.id]);
    const unlinked = await createMissionTask(env, "owner", { title: "Unlinked task" });
    expect(unlinked.task.goalId).toBeNull();
    expect((await listMissionTaskPage(env, "owner", { goalId: "run" })).tasks.map(row => row.id)).toEqual([task.id]);
    expect((await updateMissionTask(env, "owner", task.id, { title: "Easy 5k after lunch" })).task.goalId).toBe("run");
    expect((await updateMissionTask(env, "owner", task.id, { goalId: "journal" })).task.goalId).toBe("journal");
    expect((await getGoals(env, "owner")).goals.map(goal => goal.taskIds)).toEqual([[], [task.id]]);
    expect((await updateMissionTask(env, "owner", task.id, { goalId: null })).task.goalId).toBeNull();
    expect(db.prepare("SELECT goal_id FROM mission_tasks WHERE id=?").get(task.id)?.goal_id).toBeNull();
  });
  it("rejects missing and foreign owner goals before changing a task", async () => {
    const { db, env } = fixture();
    migrate(db);
    await updateGoals(env, "other", { goals: [{ id: "private", title: "Private goal" }] });
    const { task } = await createMissionTask(env, "owner", { title: "Keep this" });
    for (const goalId of ["missing", "private", 42]) {
      await expect(createMissionTask(env, "owner", { title: "Invalid", goalId })).rejects.toThrow();
      await expect(updateMissionTask(env, "owner", task.id, { title: "Replace", goalId })).rejects.toThrow();
      expect((await getMissionTaskDetail(env, "owner", task.id)).task.title).toBe("Keep this");
    }
  });
});

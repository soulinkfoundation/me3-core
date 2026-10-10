import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getGoals, normalizeMissionGoals, updateGoals } from "./goals";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });
function fixture(settings?: object) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE mission_dashboard_settings (
    user_id TEXT PRIMARY KEY, cards_json TEXT NOT NULL DEFAULT '[]',
    quick_links_json TEXT NOT NULL DEFAULT '[]', settings_json TEXT NOT NULL DEFAULT '{}',
    mission_statement TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE mission_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, goal_id TEXT, updated_at TEXT);
  CREATE TABLE mission_projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`);
  if (settings) db.prepare("INSERT INTO mission_dashboard_settings (user_id, settings_json, cards_json, mission_statement) VALUES ('owner', ?, '[\"keep-card\"]', 'Keep mission')").run(JSON.stringify(settings));
  const prepare = (sql: string) => ({ bind: (...values: (string | number | null)[]) => ({
    first: async () => db.prepare(sql).get(...values) || null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => ({ meta: db.prepare(sql).run(...values) }),
  }) });
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

describe("focused goals storage", () => {
  it("reads legacy goals and preserves dashboard fields when updating", async () => {
    const { db, env } = fixture({ mainGoal: "Legacy goal", kanbanEnabled: true, unrelated: { keep: true } });
    expect((await getGoals(env, "owner")).goals[0].title).toBe("Legacy goal");
    await updateGoals(env, "owner", { goals: [{ id: "goal-1", title: " New direction ", status: "completed" }] });
    const row = db.prepare("SELECT * FROM mission_dashboard_settings WHERE user_id='owner'").get()!;
    expect(row.cards_json).toBe('["keep-card"]');
    expect(row.mission_statement).toBe("Keep mission");
    expect(JSON.parse(String(row.settings_json))).toMatchObject({ kanbanEnabled: true, unrelated: { keep: true } });
    expect((await getGoals(env, "owner")).goals).toEqual([{id:"goal-1", title:"New direction",status:"completed", areaId: null, progress: 0, taskIds: [], projectIds: []}]);
    await updateGoals(env, "owner", { goals: [] });
    expect((await getGoals(env, "owner")).goals).toEqual([]);
  });
  it("creates owner-scoped goals without needing the old dashboard's tables", async () => {
    const { env } = fixture();
    expect((await getGoals(env, "alice")).goals).toEqual([]);
    await updateGoals(env, "alice", { goals: [{ id: "first", title: "Walk daily" }] });
    expect((await getGoals(env, "alice")).goals[0].title).toBe("Walk daily");
    expect((await getGoals(env, "bob")).goals).toEqual([]);
    await expect(updateGoals(env, "alice", {})).rejects.toThrow("list");
    await expect(updateGoals(env, "alice", { goals: Array(21).fill("Too many") })).rejects.toThrow("20");
    expect((await getGoals(env, "alice")).goals).toHaveLength(1);
  });
  it("normalizes stored metadata and gives legacy goals safe defaults", () => {
    expect(normalizeMissionGoals(undefined, "Legacy")).toEqual([
      { id: "legacy-main-goal", title: "Legacy", status: "active", areaId: null, progress: 0, taskIds: [], projectIds: [] },
    ]);
    expect(normalizeMissionGoals([
      { id: " Health Goal ", title: " Run 10k ", areaId: "health", progress: 35.5, taskIds: [" a ", "a", 2], projectIds: [" p ", "p"] },
      { id: "health-goal", title: "Invalid stored values", areaId: "other", progress: Infinity },
      { title: "Clamp stored values", progress: 150 },
    ], "")).toEqual([
      { id: "health-goal", title: "Run 10k", status: "active", areaId: "health", progress: 35.5, taskIds: ["a"], projectIds: ["p"] },
      { id: "health-goal-2", title: "Invalid stored values", status: "active", areaId: null, progress: 0, taskIds: [], projectIds: [] },
      { id: "goal-3", title: "Clamp stored values", status: "active", areaId: null, progress: 100, taskIds: [], projectIds: [] },
    ]);
  });
  it("round-trips metadata and task links while old clients preserve new fields", async () => {
    const { db, env } = fixture();
    db.exec("INSERT INTO mission_tasks (id, user_id) VALUES ('task-a', 'owner'), ('task-b', 'owner'), ('private-task', 'other'); INSERT INTO mission_projects VALUES ('project-a', 'owner'), ('private-project', 'other')");
    const goal = { id: "run", title: "Run a 10k", status: "active", areaId: "health", progress: 35, taskIds: ["task-a"], projectIds: ["project-a"] };
    expect(await updateGoals(env, "owner", { goals: [goal] })).toEqual({ goals: [goal] });
    await updateGoals(env, "owner", { goals: [{ id: "run", title: "Run 10k by December", status: "active" }] });
    expect((await getGoals(env, "owner")).goals).toEqual([{ ...goal, title: "Run 10k by December" }]);
    expect(db.prepare("SELECT goal_id FROM mission_tasks WHERE id='task-a'").get()?.goal_id).toBe("run");
    await updateGoals(env, "owner", { goals: [{ ...goal, areaId: null, progress: 0, taskIds: ["task-b"], projectIds: [] }] });
    expect((await getGoals(env, "owner")).goals[0]).toMatchObject({ areaId: null, progress: 0, taskIds: ["task-b"], projectIds: [] });
    expect(db.prepare("SELECT goal_id FROM mission_tasks WHERE id='task-a'").get()?.goal_id).toBeNull();
    await updateGoals(env, "owner", { goals: [] });
    expect(db.prepare("SELECT goal_id FROM mission_tasks WHERE id='task-b'").get()?.goal_id).toBeNull();
  });
  it("rejects invalid metadata and another owner's links before writing", async () => {
    const { db, env } = fixture({ goals: [{ id: "keep", title: "Keep" }] });
    db.exec("INSERT INTO mission_tasks (id, user_id) VALUES ('private-task', 'other'); INSERT INTO mission_projects VALUES ('private-project', 'other')");
    for (const metadata of [
      { areaId: "other" }, { progress: -1 }, { progress: 101 }, { progress: "35" },
      { taskIds: "private-task" }, { taskIds: [null] }, { projectIds: ["private-project"] },
      { taskIds: ["private-task"] }, { taskIds: ["missing"] },
    ]) {
      await expect(updateGoals(env, "owner", { goals: [{ id: "keep", title: "Replace", ...metadata }] })).rejects.toThrow();
      expect((await getGoals(env, "owner")).goals[0].title).toBe("Keep");
    }
  });
  it("reassigns direct links and rejects conflicting explicit assignments", async () => {
    const { db, env } = fixture();
    db.exec("INSERT INTO mission_tasks (id, user_id) VALUES ('task-a', 'owner')");
    await updateGoals(env, "owner", { goals: [{ id: "first", title: "First", taskIds: ["task-a"] }, { id: "second", title: "Second" }] });
    await updateGoals(env, "owner", { goals: [{ id: "first", title: "First" }, { id: "second", title: "Second", taskIds: ["task-a"] }] });
    expect((await getGoals(env, "owner")).goals.map(goal => goal.taskIds)).toEqual([[], ["task-a"]]);
    await expect(updateGoals(env, "owner", { goals: [{ id: "first", title: "First", taskIds: ["task-a"] }, { id: "second", title: "Second", taskIds: ["task-a"] }] })).rejects.toThrow("one goal");
  });
});

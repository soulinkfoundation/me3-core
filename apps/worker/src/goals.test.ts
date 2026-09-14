import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getGoals, updateGoals } from "./goals";
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
  )`);
  if (settings) db.prepare("INSERT INTO mission_dashboard_settings (user_id, settings_json, cards_json, mission_statement) VALUES ('owner', ?, '[\"keep-card\"]', 'Keep mission')").run(JSON.stringify(settings));
  const env = { DB: { prepare: (sql: string) => ({ bind: (...values: (string | number)[]) => ({
    first: async () => db.prepare(sql).get(...values) || null,
    run: async () => db.prepare(sql).run(...values),
  }) }) } } as unknown as Env;
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
    expect((await getGoals(env, "owner")).goals).toEqual([{id:"goal-1", title:"New direction",status:"completed"}]);
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
});

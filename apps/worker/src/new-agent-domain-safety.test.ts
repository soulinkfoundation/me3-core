import { describe, expect, it } from "vitest";
import { archiveAgentMissionTask, updateAgentMissionTask } from "@me3-core/plugin-mission-control";

const task = { id: "task-1", title: "Review launch", description: "Original", projectId: "project-1", projectName: "Launch", dueAt: "2026-10-15", status: "backlog", priority: 3 };

function database(options: { changed?: boolean; race?: boolean } = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const db = { prepare(sql: string) { return { bind(...values: unknown[]) { return {
    async first<T>() { return { id: task.id, title: options.changed ? "Changed by owner" : task.title, description: task.description, project_id: task.projectId, project_name: task.projectName, due_at: task.dueAt, status: task.status, priority: task.priority } as T; },
    async all<T>() { return { results: [{ id: "project-1", name: "Launch", slug: "launch", status: "active" }] as T[] }; },
    async run() { writes.push({ sql, values }); return { meta: { changes: options.race && sql.includes("AND title IS ?") ? 0 : 1 } }; },
  }; } }; } };
  return { db, writes };
}

describe("new agent Mission task preconditions", () => {
  it("rejects a task changed since the durable read without writing", async () => {
    const { db, writes } = database({ changed: true });
    const result = await updateAgentMissionTask({ DB: db }, "owner", { taskId: task.id, status: "done" }, task);
    expect(result).toMatchObject({ error: expect.stringMatching(/changed/i), status: 409 });
    expect(writes).toHaveLength(0);
  });

  it("compares the reviewed snapshot atomically when updating", async () => {
    const { db, writes } = database({ race: true });
    const result = await updateAgentMissionTask({ DB: db }, "owner", { taskId: task.id, status: "done" }, task);
    expect(result).toMatchObject({ error: expect.stringMatching(/changed/i), status: 409 });
    const write = writes.find(write => write.sql.includes("UPDATE mission_tasks"));
    expect(write?.sql).toContain("AND title IS ?");
    expect(write?.values.slice(-6)).toEqual([task.title, task.description, task.projectId, task.status, task.priority, task.dueAt]);
  });

  it("compares the reviewed snapshot atomically before archiving", async () => {
    const { db, writes } = database({ race: true });
    const result = await archiveAgentMissionTask({ DB: db }, "owner", task.id, task);
    expect(result).toMatchObject({ error: expect.stringMatching(/changed/i), status: 409 });
    expect(writes[0].values).toContain("owner");
    expect(writes[0].sql).toContain("AND title IS ?");
  });
});

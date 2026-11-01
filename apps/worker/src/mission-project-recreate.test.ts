import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  archiveMissionProject,
  createMissionProject,
  listMissionProjects,
} from "./mission-control";
import type { Env } from "./types";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const statement = (sql: string, values: unknown[]) => ({
    async first<T>() { return (sqlite.prepare(sql).get(...(values as never[])) || null) as T | null; },
    async all<T>() { return { results: sqlite.prepare(sql).all(...(values as never[])) as T[] }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...(values as never[])).changes) } }; },
  });
  const db = {
    prepare(sql: string) {
      return { ...statement(sql, []), bind: (...values: unknown[]) => statement(sql, values) };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((item) => item.run()));
    },
  };
  return { env: { DB: db } as unknown as Env, sqlite };
}

describe("recreating a deleted project", () => {
  it("allows a new project with the same name as a deleted one", async () => {
    const { env, sqlite } = fixture();
    try {
      const { project: first } = await createMissionProject(env, "owner", { name: "Me3" });
      await archiveMissionProject(env, "owner", first.id);

      const { project: second } = await createMissionProject(env, "owner", { name: "Me3" });

      expect(second.id).not.toBe(first.id);
      expect(second).toMatchObject({ name: "Me3", slug: "me3", status: "active" });
      const visible = (await listMissionProjects(env, "owner")).map((project) => project.id);
      expect(visible).toContain(second.id);
      expect(visible).not.toContain(first.id);
    } finally { sqlite.close(); }
  });

  it("still rejects a name used by a live project", async () => {
    const { env, sqlite } = fixture();
    try {
      await createMissionProject(env, "owner", { name: "Me3" });
      await expect(createMissionProject(env, "owner", { name: "me3" })).rejects.toMatchObject({
        message: "A project with that name already exists",
        status: 409,
      });
    } finally { sqlite.close(); }
  });
});

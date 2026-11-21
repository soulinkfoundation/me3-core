import { describe, expect, it } from "vitest";
import { createD1Adapter } from "../src/d1-adapter";
import { FREE_EXPORT_FORMAT, FREE_EXPORT_OWNER_FIELDS, FREE_EXPORT_TABLES, exportFreeContent } from "../src/upgrade";
import { activateUserDatabase, prepareUserDatabase } from "../src/user-database";
import { createSqliteHost } from "./sqlite-host";

// Failure modes: the export carries a secret, a token, a chat or the Cloud identity into the paid ME3;
// a table is exported before one its rows point to; an allowlisted table no longer exists in Core's schema.
describe("free content export", () => {
  async function database() {
    const host = createSqliteHost();
    const db = createD1Adapter(host);
    await prepareUserDatabase(host, db);
    await activateUserDatabase(db, { userId: "user_1", email: "ada@example.test", name: "Ada", handle: "ada", coreToken: "t".repeat(40) });
    return { host, db };
  }

  it("exports the user's content and nothing that identifies or unlocks the free ME3", async () => {
    const { host, db } = await database();
    await db.batch([
      db.prepare("UPDATE owner_profile SET bio = 'Engineer', password_hash = 'never' WHERE id = 'owner'"),
      db.prepare("INSERT INTO mission_projects (id, user_id, name, slug) VALUES ('p1', 'owner', 'Engine', 'engine')"),
      db.prepare("INSERT INTO mission_tasks (id, user_id, project_id, title) VALUES ('t1', 'owner', 'p1', 'Write notes')"),
      db.prepare("INSERT INTO mission_private_memory (id, user_id, memory_kind, title, body) VALUES ('m1', 'owner', 'preference', 'Tea', 'Prefers tea')"),
      db.prepare("INSERT INTO journal_entries (id, user_id, entry_date, body) VALUES ('j1', 'owner', '2026-11-21', 'A good day')"),
    ]);
    const snapshot = exportFreeContent(host, new Date("2026-11-21T10:00:00Z"));
    expect(snapshot.format).toBe(FREE_EXPORT_FORMAT);
    expect(snapshot.exportedAt).toBe("2026-11-21T10:00:00.000Z");
    expect(Object.keys(snapshot.tables)).toEqual([...FREE_EXPORT_TABLES]);
    expect(snapshot.tables.mission_tasks).toMatchObject([{ id: "t1", project_id: "p1", title: "Write notes" }]);
    expect(snapshot.tables.mission_private_memory).toMatchObject([{ id: "m1", body: "Prefers tea" }]);
    expect(snapshot.tables.journal_entries).toMatchObject([{ id: "j1", body: "A good day" }]);
    expect(snapshot.owner).toMatchObject({ name: "Ada", bio: "Engineer" });
    expect(Object.keys(snapshot.owner).sort()).toEqual([...FREE_EXPORT_OWNER_FIELDS].sort());
    const text = JSON.stringify(snapshot);
    for (const leaked of ["t".repeat(40), "user_1", "core_", "never", "ada@example.test"]) expect(text).not.toContain(leaked);
  });

  it("names only tables Core has, each after the tables it points to", async () => {
    const { host } = await database();
    const seen = new Set<string>(["owner_profile"]);
    for (const table of FREE_EXPORT_TABLES) {
      expect(host.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray(), table).toHaveLength(1);
      for (const parent of host.sql.exec(`SELECT "table" AS parent FROM pragma_foreign_key_list('${table}')`).toArray()) {
        expect(seen.has(String(parent.parent)), `${table} -> ${parent.parent}`).toBe(true);
      }
      seen.add(table);
    }
    expect(FREE_EXPORT_TABLES.filter((table) => /secret|token|session|agent|assistant|push|calendar|free_runtime/.test(table))).toEqual([]);
  });
});

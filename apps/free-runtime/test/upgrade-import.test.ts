import { describe, expect, it } from "vitest";
import { importFreeContent, FreeImportInputError } from "../../worker/src/free-import";
import type { Env } from "../../worker/src/types";
import { createD1Adapter } from "../src/d1-adapter";
import { exportFreeContent } from "../src/upgrade";
import { activateUserDatabase, prepareUserDatabase } from "../src/user-database";
import { createSqliteHost } from "./sqlite-host";

// Failure modes: a retry duplicates or overwrites; content the user wrote in the paid ME3 is lost or replaced;
// one bad row loses the rest; an export from a different schema version fails; the import writes outside its tables.
async function database(name: string) {
  const host = createSqliteHost();
  const db = createD1Adapter(host);
  await prepareUserDatabase(host, db);
  await activateUserDatabase(db, { userId: name, email: `${name}@example.test`, name: "Ada", handle: "ada" });
  host.db.exec("PRAGMA foreign_keys = ON");
  return { host, db, env: { DB: db } as Env };
}

async function freeMe3() {
  const free = await database("free");
  await free.db.batch([
    free.db.prepare("UPDATE owner_profile SET bio = 'Engineer', assistant_name = 'Byron' WHERE id = 'owner'"),
    free.db.prepare("INSERT INTO mission_projects (id, user_id, name, slug) VALUES ('p-free', 'owner', 'Engine', 'engine')"),
    free.db.prepare("INSERT INTO mission_project_columns (id, user_id, project_id, name, status, position) VALUES ('c1', 'owner', 'p-free', 'To do', 'backlog', 0)"),
    free.db.prepare("INSERT INTO mission_tasks (id, user_id, project_id, column_id, title) VALUES ('t1', 'owner', 'p-free', 'c1', 'Write notes')"),
    free.db.prepare("INSERT INTO mission_tasks (id, user_id, title) VALUES ('t2', 'owner', 'Loose task')"),
    free.db.prepare("INSERT INTO mission_private_memory (id, user_id, memory_kind, title, body) VALUES ('m1', 'owner', 'preference', 'Tea', 'Prefers tea')"),
    free.db.prepare("INSERT INTO mission_dashboard_settings (user_id, mission_statement) VALUES ('owner', 'Build the engine')"),
    free.db.prepare("INSERT INTO journal_entries (id, user_id, entry_date, body) VALUES ('j1', 'owner', '2026-11-20', 'Yesterday')"),
    free.db.prepare("INSERT INTO journal_entries (id, user_id, entry_date, body) VALUES ('j2', 'owner', '2026-11-21', 'Free morning')"),
    free.db.prepare("INSERT INTO journal_project_links (id, user_id, journal_entry_id, project_id, source_text) VALUES ('l1', 'owner', 'j2', 'p-free', 'engine')"),
    free.db.prepare("INSERT INTO journal_articles (id, user_id, title, body) VALUES ('a1', 'owner', 'Note', 'Body')"),
    free.db.prepare("INSERT INTO user_reminders (id, user_id, title, remind_at, timezone) VALUES ('r1', 'owner', 'Call', '2026-12-01T09:00:00Z', 'UTC')"),
  ]);
  return exportFreeContent(free.host);
}

const count = (db: D1Database, table: string) => db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n");

describe("bringing free content into a paid ME3", () => {
  it("brings everything across, and a second run changes nothing", async () => {
    const snapshot = JSON.parse(JSON.stringify(await freeMe3()));
    const paid = await database("paid");
    const first = await importFreeContent(paid.env, snapshot);
    expect(first.tables.mission_tasks).toEqual({ received: 2, added: 2, merged: 0, skipped: 0 });
    expect(first.tables.journal_entries.added).toBe(2);
    expect(first.ownerFieldsFilled.sort()).toEqual(["assistant_name", "bio"]);
    expect(await paid.db.prepare("SELECT title, project_id, column_id FROM mission_tasks WHERE id = 't1'").first()).toEqual({ title: "Write notes", project_id: "p-free", column_id: "c1" });
    expect(await paid.db.prepare("SELECT body FROM mission_private_memory").first("body")).toBe("Prefers tea");
    expect(await paid.db.prepare("SELECT mission_statement FROM mission_dashboard_settings").first("mission_statement")).toBe("Build the engine");
    expect(await paid.db.prepare("SELECT name, bio, email FROM owner_profile").first()).toEqual({ name: "Ada", bio: "Engineer", email: "paid@example.test" });
    // The journal and task search index is filled by the same inserts.
    expect(await paid.db.prepare("SELECT count(*) AS n FROM owner_content_search WHERE owner_content_search MATCH 'Yesterday'").first("n")).toBe(1);

    const before = JSON.stringify(await paid.db.prepare("SELECT * FROM journal_entries ORDER BY id").all().then((rows) => rows.results));
    const second = await importFreeContent(paid.env, snapshot);
    for (const counts of Object.values(second.tables)) expect(counts.added).toBe(0);
    expect(second.ownerFieldsFilled).toEqual([]);
    expect(await count(paid.db, "mission_tasks")).toBe(2);
    expect(JSON.stringify(await paid.db.prepare("SELECT * FROM journal_entries ORDER BY id").all().then((rows) => rows.results))).toBe(before);
  });

  it("keeps what the user already wrote in the paid ME3", async () => {
    const snapshot = await freeMe3();
    const paid = await database("paid");
    await paid.db.batch([
      paid.db.prepare("UPDATE owner_profile SET bio = 'Paid bio' WHERE id = 'owner'"),
      paid.db.prepare("INSERT INTO mission_projects (id, user_id, name, slug) VALUES ('p-paid', 'owner', 'Engine', 'engine')"),
      paid.db.prepare("INSERT INTO mission_dashboard_settings (user_id, mission_statement) VALUES ('owner', 'Paid mission')"),
      paid.db.prepare("INSERT INTO journal_entries (id, user_id, entry_date, body) VALUES ('j-paid', 'owner', '2026-11-21', 'Paid evening')"),
    ]);
    for (const _run of [1, 2]) {
      const result = await importFreeContent(paid.env, snapshot);
      expect(result.tables.mission_projects.merged).toBe(1);
      expect(result.tables.journal_entries.merged).toBe(1);
    }
    expect(await count(paid.db, "mission_projects")).toBe(1);
    // The free project's task, column and journal link now belong to the project the user already had.
    expect(await paid.db.prepare("SELECT project_id FROM mission_tasks WHERE id = 't1'").first("project_id")).toBe("p-paid");
    expect(await paid.db.prepare("SELECT project_id, journal_entry_id FROM journal_project_links WHERE id = 'l1'").first()).toEqual({ project_id: "p-paid", journal_entry_id: "j-paid" });
    expect(await paid.db.prepare("SELECT body FROM journal_entries WHERE entry_date = '2026-11-21'").first("body")).toBe("Paid evening\n\nFree morning");
    expect(await count(paid.db, "journal_entries")).toBe(2);
    expect(await paid.db.prepare("SELECT mission_statement FROM mission_dashboard_settings").first("mission_statement")).toBe("Paid mission");
    expect(await paid.db.prepare("SELECT bio FROM owner_profile").first("bio")).toBe("Paid bio");
  });

  it("imports the rest when a row cannot go in, and ignores columns and tables it does not know", async () => {
    const snapshot = JSON.parse(JSON.stringify(await freeMe3()));
    snapshot.tables.mission_tasks.push({ id: "t-orphan", user_id: "owner", project_id: "missing", title: "Orphan" });
    snapshot.tables.mission_tasks[0].column_from_the_future = "x";
    snapshot.tables.install_secrets = [{ name: "JWT_SECRET", value: "stolen" }];
    snapshot.tables.mission_private_memory.push({ id: { nested: true }, user_id: "owner", memory_kind: "preference", title: "Bad", body: "Bad" });
    const paid = await database("paid");
    const result = await importFreeContent(paid.env, snapshot);
    expect(result.tables.mission_tasks).toEqual({ received: 3, added: 2, merged: 0, skipped: 1 });
    expect(result.tables.mission_private_memory).toEqual({ received: 2, added: 1, merged: 0, skipped: 1 });
    expect(result.tables.install_secrets).toBeUndefined();
    expect(await paid.db.prepare("SELECT count(*) AS n FROM install_secrets WHERE value = 'stolen'").first("n")).toBe(0);
  });

  it("refuses anything that is not a free export", async () => {
    const paid = await database("paid");
    await expect(importFreeContent(paid.env, { format: "me3-portable-v1", tables: {} })).rejects.toBeInstanceOf(FreeImportInputError);
    await expect(importFreeContent(paid.env, { format: "me3-free-export-v1", tables: { mission_tasks: "all of them" } })).rejects.toBeInstanceOf(FreeImportInputError);
  });
});

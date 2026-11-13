import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJournalFolder, deleteJournalFolder, listJournalFolders, renameJournalFolder } from "./journal-folders";
import { createJournalArticle, deleteJournalArticle, getJournalArticle, listJournalArticlePreviews, listJournalArticles, updateJournalArticle } from "./journal-articles";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.useRealTimers(); });

function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(new URL("../migrations/0056_journal_articles.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0089_journal_article_projects.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0094_journal_folders.sql", import.meta.url), "utf8"));
  db.exec("CREATE TABLE mission_projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT)");
  db.exec("INSERT INTO mission_projects (id, user_id, name) VALUES ('project_launch', 'alice', 'ME3 launch'), ('project_bob', 'bob', 'Bob')");
  const env = { DB: { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({
    first: async () => db.prepare(sql).get(...values as (string | number | null)[]) || null,
    all: async () => ({ results: db.prepare(sql).all(...values as (string | number | null)[]) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values as (string | number | null)[]).changes) } }),
  }) }) } } as unknown as Env;
  return { db, env };
}

describe("journal articles", () => {
  it("links an article to one of the owner's projects and keeps it when a save omits the project", async () => {
    const { env } = fixture();
    const note = (await createJournalArticle(env, "alice", { title: "Launch", body: "<p>x</p>", projectId: "project_launch" })).article;
    expect(note.projectId).toBe("project_launch");
    await createJournalArticle(env, "alice", { title: "Loose", body: "<p>y</p>" });
    expect((await listJournalArticles(env, "alice", "project_launch")).articles.map((item) => item.id)).toEqual([note.id]);

    const kept = (await updateJournalArticle(env, "alice", note.id, { title: "Launch", body: "<p>z</p>" }, 1)).article;
    expect(kept.projectId).toBe("project_launch");
    const cleared = (await updateJournalArticle(env, "alice", note.id, { title: "Launch", body: "<p>z</p>", projectId: null }, 2)).article;
    expect(cleared.projectId).toBeNull();

    await expect(updateJournalArticle(env, "alice", note.id, { body: "<p>z</p>", projectId: "project_bob" }, 3)).rejects.toThrow("Project not found");
    await expect(createJournalArticle(env, "alice", { body: "", projectId: "missing" })).rejects.toThrow("Project not found");
  });

  // Home's Notes card and the mobile widgets (me3-qvyt): a few rows, no bodies.
  it("lists the latest notes as previews with their project name", async () => {
    const { env } = fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const bodies: [string | null, string, string, string | null][] = [
      ["Titled", "<p>Body</p>", "html", null],
      [null, "<p><br></p><h2>Boiler &amp; radiator</h2><p>Second line</p>", "html", "project_launch"],
      [null, "\n# Call plumber\n- [ ] Tue 10am", "markdown", null],
      [null, "- [ ] **Buy** milk", "markdown", null],
      [null, "", "html", null],
    ];
    for (const [index, [title, body, bodyFormat, projectId]] of bodies.entries()) {
      vi.setSystemTime(new Date(`2026-11-13T07:00:0${index}Z`));
      await createJournalArticle(env, "alice", { title, body, bodyFormat, projectId });
    }
    const all = (await listJournalArticlePreviews(env, "alice")).articles;
    expect(all.map((item) => item.preview)).toEqual(["", "Buy milk", "Call plumber", "Boiler & radiator", "Body"]);
    expect(all.map((item) => item.projectName)).toEqual([null, null, null, "ME3 launch", null]);
    expect(all.every((item) => !("body" in item))).toBe(true);
    expect(all[4].title).toBe("Titled");

    const latest = (await listJournalArticlePreviews(env, "alice", undefined, 3)).articles;
    expect(latest.map((item) => item.preview)).toEqual(["", "Buy milk", "Call plumber"]);
    // Without preview the response keeps its body, as older clients expect.
    const full = (await listJournalArticles(env, "alice", undefined, 1)).articles;
    expect(full).toHaveLength(1);
    expect(full[0]).toHaveProperty("body", "");
    expect((await listJournalArticles(env, "alice", undefined, 0)).articles).toHaveLength(5);
  });

  it("creates owner-scoped articles, lists newest first, rejects stale patches, and deletes", async () => {
    const { env } = fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T07:00:00Z"));
    const first = (await createJournalArticle(env, "alice", { title: "First", body: "<p>One</p>" })).article;
    vi.setSystemTime(new Date("2026-10-13T07:00:01Z"));
    const second = (await createJournalArticle(env, "alice", { title: "Second", body: "<p>Two</p>" })).article;
    expect((await listJournalArticles(env, "alice")).articles.map((item) => item.id)).toEqual([second.id, first.id]);
    expect((await listJournalArticles(env, "bob")).articles).toEqual([]);
    await expect(getJournalArticle(env, "bob", first.id)).rejects.toThrow("not found");
    const saved = (await updateJournalArticle(env, "alice", first.id, { title: "Revised", body: "<p>One</p>" }, 1)).article;
    expect(saved.revision).toBe(2);
    await expect(updateJournalArticle(env, "alice", first.id, { title: "Lost", body: "" }, 1)).rejects.toThrow("changed");
    await expect(deleteJournalArticle(env, "alice", first.id, 1)).rejects.toThrow("changed");
    await deleteJournalArticle(env, "alice", first.id, 2);
    await expect(getJournalArticle(env, "alice", first.id)).rejects.toThrow("not found");
  });

  it("files notes into project folders, moves them, and keeps them when a folder is deleted", async () => {
    const { db, env } = fixture();
    db.exec("INSERT INTO mission_projects (id, user_id) VALUES ('project_garden', 'alice')");
    const posts = (await createJournalFolder(env, "alice", { name: " Posts ", projectId: "project_launch" })).folder;
    const essays = (await createJournalFolder(env, "alice", { name: "Essays" })).folder;
    expect(posts).toMatchObject({ name: "Posts", projectId: "project_launch" });
    expect(essays.projectId).toBeNull();
    await expect(createJournalFolder(env, "alice", { name: "Deep", parentId: posts.id })).rejects.toThrow("cannot contain folders");
    await expect(createJournalFolder(env, "alice", { name: "X", projectId: "project_bob" })).rejects.toThrow("Project not found");
    await expect(createJournalFolder(env, "alice", { name: "  " })).rejects.toThrow("name is required");
    expect((await listJournalFolders(env, "bob")).folders).toEqual([]);

    // Filing into a folder sets the folder's project.
    const note = (await createJournalArticle(env, "alice", { body: "<p>x</p>", folderId: posts.id })).article;
    expect(note).toMatchObject({ projectId: "project_launch", folderId: posts.id });
    await expect(createJournalArticle(env, "alice", { body: "", folderId: posts.id, projectId: null })).rejects.toThrow("another project");
    await expect(createJournalArticle(env, "bob", { body: "", folderId: posts.id })).rejects.toThrow("Folder not found");

    // Saves that omit folderId keep it; a same-project projectId keeps it; another project clears it.
    const kept = (await updateJournalArticle(env, "alice", note.id, { body: "<p>y</p>" }, 1)).article;
    expect(kept.folderId).toBe(posts.id);
    const same = (await updateJournalArticle(env, "alice", note.id, { body: "<p>y</p>", projectId: "project_launch" }, 2)).article;
    expect(same.folderId).toBe(posts.id);
    const moved = (await updateJournalArticle(env, "alice", note.id, { body: "<p>y</p>", projectId: "project_garden" }, 3)).article;
    expect(moved).toMatchObject({ projectId: "project_garden", folderId: null });
    const refiled = (await updateJournalArticle(env, "alice", note.id, { body: "<p>y</p>", folderId: essays.id }, 4)).article;
    expect(refiled).toMatchObject({ projectId: null, folderId: essays.id });
    const unfiled = (await updateJournalArticle(env, "alice", note.id, { body: "<p>y</p>", folderId: null }, 5)).article;
    expect(unfiled).toMatchObject({ projectId: null, folderId: null });

    expect((await renameJournalFolder(env, "alice", posts.id, { name: "Launch posts" })).folder.name).toBe("Launch posts");
    const filed = (await updateJournalArticle(env, "alice", note.id, { body: "<p>y</p>", folderId: posts.id }, 6)).article;
    await deleteJournalFolder(env, "alice", posts.id);
    const after = (await getJournalArticle(env, "alice", note.id)).article;
    expect(after).toMatchObject({ projectId: "project_launch", folderId: null, revision: filed.revision });
    expect((await listJournalFolders(env, "alice")).folders.map((folder) => folder.name)).toEqual(["Essays"]);
  });

  it("reads a folder whose project was deleted as a No project folder", async () => {
    const { db, env } = fixture();
    const folder = (await createJournalFolder(env, "alice", { name: "Old", projectId: "project_launch" })).folder;
    db.exec("DELETE FROM mission_projects WHERE id = 'project_launch'");
    expect((await listJournalFolders(env, "alice")).folders[0]).toMatchObject({ id: folder.id, projectId: null });
    const note = (await createJournalArticle(env, "alice", { body: "", folderId: folder.id })).article;
    expect(note).toMatchObject({ projectId: null, folderId: folder.id });
  });
});

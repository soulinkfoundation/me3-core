import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJournalArticle, deleteJournalArticle, getJournalArticle, listJournalArticles, updateJournalArticle } from "./journal-articles";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.useRealTimers(); });

function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(new URL("../migrations/0056_journal_articles.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0089_journal_article_projects.sql", import.meta.url), "utf8"));
  db.exec("CREATE TABLE mission_projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)");
  db.exec("INSERT INTO mission_projects (id, user_id) VALUES ('project_launch', 'alice'), ('project_bob', 'bob')");
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
});

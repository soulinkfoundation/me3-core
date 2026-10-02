import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createJournalArticle, deleteJournalArticle, getJournalArticle, listJournalArticles, updateJournalArticle } from "./journal-articles";
import { validateJournalAssistResult } from "./journal-assist";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(new URL("../migrations/0056_journal_articles.sql", import.meta.url), "utf8"));
  const env = { DB: { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({
    first: async () => db.prepare(sql).get(...values as (string | number | null)[]) || null,
    all: async () => ({ results: db.prepare(sql).all(...values as (string | number | null)[]) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values as (string | number | null)[]).changes) } }),
  }) }) } } as unknown as Env;
  return { db, env };
}

describe("journal articles", () => {
  it("creates owner-scoped articles, lists newest first, rejects stale patches, and deletes", async () => {
    const { env } = fixture();
    const first = (await createJournalArticle(env, "alice", { title: "First", body: "<p>One</p>" })).article;
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

describe("journal Assist validation", () => {
  const paragraphs = [{ id: "a", text: "My exact words" }, { id: "b", text: "Second paragraph" }];
  it("rejects invented structure and outline phrases", () => {
    for (const mode of ["structure", "outline"] as const) {
      expect(() => validateJournalAssistResult(mode, { groups: [{ label: "Topic", phrases: ["invented prose"] }] }, paragraphs)).toThrow();
      expect(validateJournalAssistResult(mode, { groups: [{ label: "Topic", phrases: ["My exact words"] }] }, paragraphs)).toEqual({ groups: [{ label: "Topic", phrases: ["My exact words"] }] });
    }
  });
  it("accepts only a permutation of paragraph ids", () => {
    expect(() => validateJournalAssistResult("restructure", { order: ["a", "a"], reason: "Flow" }, paragraphs)).toThrow();
    expect(validateJournalAssistResult("restructure", { order: ["b", "a"], reason: "Flow" }, paragraphs)).toEqual({ order: ["b", "a"], reason: "Flow" });
  });
  it("anchors feedback to exact text and discards replacement fields", () => {
    const note = { id: "1", paragraphId: "a", quote: "exact words", category: "Clarity", comment: "Expand this thought." };
    expect(validateJournalAssistResult("feedback", { notes: [note] }, paragraphs)).toEqual({ notes: [note] });
    expect(() => validateJournalAssistResult("feedback", { notes: [{ ...note, quote: "other" }] }, paragraphs)).toThrow();
    expect(() => validateJournalAssistResult("feedback", { notes: [{ ...note, replacement: "New words" }] }, paragraphs)).toThrow();
    expect(() => validateJournalAssistResult("feedback", { notes: [note, note] }, paragraphs)).toThrow();
  });
});

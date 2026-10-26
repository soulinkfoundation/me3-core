import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { readJournalNotesForAgent, type JournalAgentDb, type JournalAgentNote, type JournalAgentNoteSummary } from "@me3-core/plugin-journal";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(new URL("../migrations/0056_journal_articles.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0089_journal_article_projects.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0094_journal_folders.sql", import.meta.url), "utf8"));
  db.exec("CREATE TABLE mission_projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL)");
  db.exec("INSERT INTO mission_projects (id, user_id, name) VALUES ('project_launch', 'alice', 'Launch')");
  const insert = db.prepare(
    "INSERT INTO journal_articles (id, user_id, title, body, body_format, revision, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'html', 1, ?, ?, ?)",
  );
  const agentDb = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({
    all: async () => ({ results: db.prepare(sql).all(...values as (string | number | null)[]) }),
  }) }) } as unknown as JournalAgentDb;
  return { db, insert, agentDb };
}

describe("Journal notes agent read", () => {
  it("lists the owner's latest notes with a plain-text preview, newest first", async () => {
    const { insert, agentDb } = fixture();
    insert.run("article_" + "1".repeat(36), "alice", "Older", "<p>First <strong>note</strong></p>", null, "2026-10-01T09:00:00Z", "2026-10-01T09:00:00Z");
    insert.run("article_" + "2".repeat(36), "alice", null, "<h2>Plan</h2><p>Second note body.</p>", "project_launch", "2026-10-02T09:00:00Z", "2026-10-05T09:00:00Z");
    insert.run("article_" + "3".repeat(36), "bob", "Bob's", "<p>Not Alice's</p>", null, "2026-10-03T09:00:00Z", "2026-10-03T09:00:00Z");

    const result = await readJournalNotesForAgent(agentDb, "alice", {});

    expect(result.notes.map((note) => note.id)).toEqual(["article_" + "2".repeat(36), "article_" + "1".repeat(36)]);
    expect(result.notes[0]).toMatchObject({ title: null, preview: "Plan Second note body.", projectId: "project_launch", projectName: "Launch", wordCount: 4 });
    expect(result.notes[0]).not.toHaveProperty("body");
    expect((result.notes[1] as JournalAgentNoteSummary | undefined)?.preview).toBe("First note");
    expect(result.hasMore).toBe(false);
  });

  it("filters by project and honours the limit", async () => {
    const { insert, agentDb } = fixture();
    for (let index = 1; index <= 3; index += 1) {
      insert.run(`article_${String(index).repeat(36)}`, "alice", `Note ${index}`, "<p>x</p>", index === 2 ? "project_launch" : null, `2026-10-0${index}T09:00:00Z`, `2026-10-0${index}T09:00:00Z`);
    }
    const byProject = await readJournalNotesForAgent(agentDb, "alice", { projectId: "project_launch" });
    expect(byProject.notes.map((note) => note.title)).toEqual(["Note 2"]);

    const limited = await readJournalNotesForAgent(agentDb, "alice", { limit: 2 });
    expect(limited.notes.map((note) => note.title)).toEqual(["Note 3", "Note 2"]);
    expect(limited.hasMore).toBe(true);
  });

  it("reads one note in full by id as plain text, and refuses other owners' notes", async () => {
    const { insert, agentDb } = fixture();
    const id = "article_" + "a".repeat(36);
    insert.run(id, "alice", "Full", "<h1>Heading</h1><p>Para one.</p><ul><li>Point</li></ul>", null, "2026-10-01T09:00:00Z", "2026-10-01T09:00:00Z");

    const result = await readJournalNotesForAgent(agentDb, "alice", { noteId: id });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ id, title: "Full", body: "Heading\n\nPara one.\n\nPoint", bodyFormat: "plain_text", bodyTruncated: false, revision: 1 });

    await expect(readJournalNotesForAgent(agentDb, "bob", { noteId: id })).rejects.toThrow("Note not found");
    await expect(readJournalNotesForAgent(agentDb, "alice", { noteId: "nope" })).rejects.toThrow("Note id is invalid");
  });

  it("truncates very long bodies and says so", async () => {
    const { insert, agentDb } = fixture();
    const id = "article_" + "b".repeat(36);
    insert.run(id, "alice", "Long", `<p>${"word ".repeat(10_000)}</p>`, null, "2026-10-01T09:00:00Z", "2026-10-01T09:00:00Z");
    const result = await readJournalNotesForAgent(agentDb, "alice", { noteId: id });
    expect((result.notes[0] as JournalAgentNote | undefined)?.bodyTruncated).toBe(true);
    expect((result.notes[0] as JournalAgentNote | undefined)?.body.length).toBeLessThanOrEqual(24_000);
  });

  it("names each note's folder and filters by folder", async () => {
    const { db, insert, agentDb } = fixture();
    db.exec("INSERT INTO journal_folders (id, user_id, project_id, name) VALUES ('folder_posts', 'alice', 'project_launch', 'Posts')");
    insert.run("article_" + "1".repeat(36), "alice", "Filed", "<p>x</p>", "project_launch", "2026-10-01T09:00:00Z", "2026-10-01T09:00:00Z");
    insert.run("article_" + "2".repeat(36), "alice", "Loose", "<p>y</p>", "project_launch", "2026-10-02T09:00:00Z", "2026-10-02T09:00:00Z");
    db.exec(`UPDATE journal_articles SET folder_id = 'folder_posts' WHERE id = 'article_${"1".repeat(36)}'`);

    const all = await readJournalNotesForAgent(agentDb, "alice", {});
    expect(all.notes.map((note) => [note.title, note.folderName])).toEqual([["Loose", null], ["Filed", "Posts"]]);
    const filed = await readJournalNotesForAgent(agentDb, "alice", { projectId: "project_launch", folderId: "folder_posts" });
    expect(filed.notes.map((note) => note.title)).toEqual(["Filed"]);
    expect(filed.notes[0]).toMatchObject({ folderId: "folder_posts", projectName: "Launch" });
  });
});

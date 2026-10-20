import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { conversationTools, conversationSnippet, conversationSearchTerms } from "../../../packages/agent/src/tools/conversations";

function setup() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE assistant_threads (id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, status TEXT DEFAULT 'active', archived_at TEXT, deleted_at TEXT);
    CREATE TABLE assistant_messages (id TEXT PRIMARY KEY, owner_id TEXT, role TEXT, content TEXT, created_at TEXT, thread_id TEXT, metadata_json TEXT DEFAULT '{}');`);
  raw.exec(`INSERT INTO assistant_threads VALUES ('main','owner','Main','active',NULL,NULL),('old','owner','Earlier chat','archived','2026-09-30',NULL),('gone','owner','Deleted','deleted',NULL,'2026-10-01'),('theirs','other','Other','active',NULL,NULL)`);
  const add = raw.prepare("INSERT INTO assistant_messages (id,owner_id,role,content,created_at,thread_id) VALUES (?,?,?,?,?,?)");
  add.run("a1", "owner", "user", "Let's go with Acme Print for the launch flyers, they quoted 400 euro.", "2026-09-12 10:00:00", "old");
  add.run("a2", "owner", "assistant", "Noted: Acme Print for the flyers.", "2026-09-12 10:00:05", "old");
  for (let i = 0; i < 70; i++) add.run(`m${i}`, "owner", i % 2 ? "assistant" : "user", `Filler message ${i} about the weekly plan.`, `2026-10-${String(10 + Math.floor(i / 10)).padStart(2, "0")} 09:${String(i % 60).padStart(2, "0")}:00`, "main");
  add.run("d1", "owner", "user", "Acme Print secret from a deleted chat", "2026-09-20 10:00:00", "gone");
  add.run("o1", "other", "user", "Acme Print for another owner", "2026-09-21 10:00:00", "theirs");
  add.run("turn-now:user", "owner", "user", "What did we decide about Acme Print?", "2026-10-20 12:00:00", "main");
  add.run("s1", "owner", "system", "Acme Print system row", "2026-09-22 10:00:00", "main");
  const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({
    all: async () => ({ results: raw.prepare(sql).all(...(values as never[])) }), first: async () => raw.prepare(sql).get(...(values as never[])) ?? null, run: async () => ({}) }) }) };
  const context = { db, ownerId: "owner", threadId: "main", turnId: "turn-now", requestId: "r", toolCallId: "c", idempotencyKey: "k", ownerTimezone: "Europe/Dublin", messageText: "", messages: [], enabledPluginIds: new Set<string>(), signal: new AbortController().signal } as never;
  return { raw, context, tool: conversationTools()[0] };
}

describe("conversation search", () => {
  it("finds a decision made more than 60 messages ago in an archived chat, scoped to the owner", async () => {
    const { tool, context } = setup();
    const result = await tool.execute({ query: "what did we decide about Acme Print" }, context) as { status: string; data: { results: Array<Record<string, unknown>> } };
    expect(result.status).toBe("ok");
    expect(result.data.results.map(row => row.messageId)).toEqual(["a2", "a1"]);
    expect(result.data.results[0]).toMatchObject({ matchedTerms: 2 });
    expect(result.data.results[1]).toMatchObject({ threadTitle: "Earlier chat", archivedChat: true, speaker: "owner", at: "2026-09-12 10:00:00" });
    expect(String(result.data.results[1].snippet)).toContain("Acme Print");
  });

  it("caps results, honours dates and never returns system rows or the current turn", async () => {
    const { tool, context } = setup();
    const capped = await tool.execute({ query: "weekly plan", limit: 50 }, context) as { data: { results: unknown[]; limitReached: boolean } };
    expect(capped.data.results).toHaveLength(10);
    expect(capped.data.limitReached).toBe(true);
    const dated = await tool.execute({ query: "Acme Print", dateTo: "2026-09-11" }, context) as { data: { results: unknown[] } };
    expect(dated.data.results).toEqual([]);
    const all = await tool.execute({ query: "Acme", limit: 10 }, context) as { data: { results: Array<{ messageId: string }> } };
    expect(all.data.results.map(row => row.messageId).sort()).toEqual(["a1", "a2"]);
    expect(await tool.execute({ query: "a b" }, context)).toMatchObject({ status: "error" });
  });

  it("builds bounded snippets around the first matching term", () => {
    expect(conversationSearchTerms("What did we decide about Acme's flyers last month?")).toEqual(["acme's", "flyers"]);
    const snippet = conversationSnippet(`${"x".repeat(500)} Acme Print ${"y".repeat(500)}`, ["acme"]);
    expect(snippet.startsWith("…") && snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("Acme Print");
    expect(snippet.length).toBeLessThanOrEqual(282);
  });
});

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDb, AgentMessage, AgentModel } from "../../../packages/agent/src/types";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { rememberFromTurn } from "./agent-memory";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  raw.exec("INSERT INTO owner_profile(id,username) VALUES('owner','synthetic'),('other','other-synthetic')");
  const db: AgentDb = { prepare(sql) {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first<T>() { return (query.get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: query.all(...values as never[]) as T[] }; },
      async run() { query.run(...values as never[]); return {}; } };
    return statement;
  } };
  const memory = (id: string, values: { owner?: string; kind?: string; body: string; source?: string; status?: string; importance?: number; expiresAt?: string | null; updatedAt?: string }) =>
    raw.prepare(`INSERT INTO mission_private_memory(id,user_id,memory_kind,body,source_kind,review_status,importance,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id, values.owner || "owner", values.kind || "owner_note", values.body, values.source || "agent", values.status || "active", values.importance ?? 3, values.expiresAt ?? null, values.updatedAt || "2026-10-01T09:00:00Z");
  const rows = () => raw.prepare("SELECT id,user_id,memory_kind,body,source_kind,source_ref,review_status,importance,expires_at FROM mission_private_memory ORDER BY rowid").all() as Array<Record<string, unknown>>;
  return { db, memory, rows };
}

function fakeModel(ops: unknown[]) {
  const seen: AgentMessage[][] = [];
  const model: AgentModel = { id: "fake", async step(input) { seen.push([...input.messages]); return { text: "", toolCalls: [{ id: "1", name: "core_memory_ops", arguments: { ops } }] }; } };
  return { model, seen };
}

const turn = { ownerId: "owner", turnId: "turn-1", ownerMessage: "My daughter Mia starts school on Monday.", replyText: "Noted, good luck to Mia!" };
const signal = new AbortController().signal;

describe("automatic agent memory", () => {
  it("saves a new fact as an active agent memory linked to its turn", async () => {
    const f = fixture();
    await rememberFromTurn(f.db, fakeModel([{ op: "add", kind: "relationship_note", body: "Owner's daughter is Mia.", importance: 4 }]).model, turn, signal);
    expect(f.rows()).toEqual([expect.objectContaining({ user_id: "owner", memory_kind: "relationship_note", body: "Owner's daughter is Mia.", source_kind: "agent", source_ref: "turn-1", review_status: "active", importance: 4 })]);
  });

  it("holds sensitive facts for the owner's review", async () => {
    const f = fixture();
    await rememberFromTurn(f.db, fakeModel([{ op: "add", kind: "owner_note", body: "Owner is managing a back injury.", importance: 3, sensitive: true }]).model, turn, signal);
    expect(f.rows()[0]).toMatchObject({ review_status: "needs_review" });
  });

  it("replaces an outdated agent memory and archives one that no longer holds", async () => {
    const f = fixture();
    f.memory("m-city", { body: "Owner lives in Dublin." });
    f.memory("m-trip", { body: "Owner is in Lisbon this week." });
    await rememberFromTurn(f.db, fakeModel([
      { op: "update", id: "m-city", body: "Owner lives in Cork.", importance: 4 },
      { op: "archive", id: "m-trip" },
    ]).model, turn, signal);
    expect(f.rows()).toEqual([
      expect.objectContaining({ id: "m-city", body: "Owner lives in Cork.", importance: 4, review_status: "active", source_ref: "turn-1" }),
      expect.objectContaining({ id: "m-trip", review_status: "archived" }),
    ]);
  });

  it("never changes owner-written or another owner's memories", async () => {
    const f = fixture();
    f.memory("m-manual", { body: "Keep replies short.", kind: "preference", source: "manual" });
    f.memory("m-other", { owner: "other", body: "Other owner's fact." });
    await rememberFromTurn(f.db, fakeModel([
      { op: "update", id: "m-manual", body: "Write long replies." },
      { op: "archive", id: "m-manual" },
      { op: "update", id: "m-other", body: "Changed." },
      { op: "archive", id: "m-other" },
    ]).model, turn, signal);
    expect(f.rows()).toEqual([
      expect.objectContaining({ id: "m-manual", body: "Keep replies short.", review_status: "active" }),
      expect.objectContaining({ id: "m-other", body: "Other owner's fact.", review_status: "active" }),
    ]);
  });

  it("ignores duplicates, malformed ops and anything past three per turn", async () => {
    const f = fixture();
    f.memory("m-mia", { body: "Owner's daughter is Mia." });
    await rememberFromTurn(f.db, fakeModel([
      { op: "add", kind: "owner_note", body: "  owner's daughter is   mia. " },
      { op: "add", kind: "not_a_kind", body: "Bad kind." },
      { op: "add", kind: "owner_note", body: "" },
      { op: "add", kind: "owner_note", body: "Fact one." },
      { op: "add", kind: "owner_note", body: "Fact two." },
      { op: "add", kind: "owner_note", body: "Fact three." },
      { op: "add", kind: "owner_note", body: "Fact four." },
    ]).model, turn, signal);
    expect(f.rows().map(row => row.body)).toEqual(["Owner's daughter is Mia.", "Fact one.", "Fact two.", "Fact three."]);
  });

  it("shows the model only the owner's words, the reply and this owner's live memories", async () => {
    const f = fixture();
    f.memory("m-live", { body: "Owner runs on Saturdays." });
    f.memory("m-gone", { body: "Archived fact.", status: "archived" });
    f.memory("m-other", { owner: "other", body: "Other owner's fact." });
    const { model, seen } = fakeModel([]);
    await rememberFromTurn(f.db, model, turn, signal);
    const prompt = JSON.stringify(seen[0]);
    expect(prompt).toContain("My daughter Mia starts school on Monday.");
    expect(prompt).toContain("m-live");
    expect(prompt).not.toContain("Archived fact.");
    expect(prompt).not.toContain("Other owner's fact.");
  });
});

describe("owner snapshot memory", () => {
  const owner = { id: "owner", name: "Synthetic", username: "synthetic", timezone: "UTC", assistantName: "ME3" };

  it("separates how the owner wants the agent to work from what it knows about them", async () => {
    const f = fixture();
    f.memory("m-pref", { kind: "preference", body: "Never suggest calls before 10am.", source: "manual" });
    f.memory("m-fact", { kind: "relationship_note", body: "Owner's daughter is Mia." });
    const { prompt } = await loadOwnerSnapshotContext({ db: f.db, ownerId: "owner", owner, meJsonUrl: null });
    const work = prompt.indexOf("How the owner wants you to work");
    const known = prompt.indexOf("What you know about the owner");
    expect(work).toBeGreaterThan(-1);
    expect(known).toBeGreaterThan(work);
    expect(prompt.slice(work, known)).toContain("Never suggest calls before 10am.");
    expect(prompt.slice(work, known)).not.toContain("Mia");
    expect(prompt.slice(known)).toContain("Owner's daughter is Mia.");
  });

  it("drops expired memories and keeps important ones over newer trivia when space runs out", async () => {
    const f = fixture();
    f.memory("m-expired", { body: "Owner is in Lisbon this week.", expiresAt: "2020-01-01T00:00:00Z" });
    f.memory("m-key", { body: "Owner's partner is Sam.", importance: 5, updatedAt: "2026-01-01T09:00:00Z" });
    for (let index = 0; index < 40; index++) f.memory(`m-trivia-${index}`, { body: `Trivia ${index} ${"x".repeat(200)}`, importance: 1, updatedAt: "2026-10-10T09:00:00Z" });
    const { prompt } = await loadOwnerSnapshotContext({ db: f.db, ownerId: "owner", owner, meJsonUrl: null });
    expect(prompt).not.toContain("Lisbon");
    expect(prompt).toContain("Owner's partner is Sam.");
  });
});

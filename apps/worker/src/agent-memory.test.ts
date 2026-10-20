import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDb, AgentMessage, AgentModel } from "../../../packages/agent/src/types";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { ownerFacingMemory, rememberFromTurn } from "./agent-memory";
import { createDomainTools } from "../../../packages/agent/src/tools";
import type { AgentToolContext } from "../../../packages/agent/src/types";
import { Hono } from "hono";
import type { Env } from "./types";
import { registerAssistantRoutes } from "./routes/assistant";

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
  const memory = (id: string, values: { owner?: string; kind?: string; body: string; source?: string; status?: string; importance?: number; expiresAt?: string | null; updatedAt?: string; forgottenAt?: string | null }) =>
    raw.prepare(`INSERT INTO mission_private_memory(id,user_id,memory_kind,body,source_kind,review_status,importance,expires_at,updated_at,forgotten_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, values.owner || "owner", values.kind || "owner_note", values.body, values.source || "agent", values.status || "active", values.importance ?? 3, values.expiresAt ?? null, values.updatedAt || "2026-10-01T09:00:00Z", values.forgottenAt ?? null);
  const rows = () => raw.prepare("SELECT id,user_id,memory_kind,body,source_kind,source_ref,review_status,importance,expires_at FROM mission_private_memory ORDER BY rowid").all() as Array<Record<string, unknown>>;
  return { raw, db, memory, rows };
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
    f.memory("m-gone", { body: "Forgotten fact.", status: "archived", forgottenAt: "2026-10-02T09:00:00Z" });
    f.memory("m-old", { body: "Outdated fact the agent retired.", status: "archived" });
    f.memory("m-other", { owner: "other", body: "Other owner's fact." });
    const { model, seen } = fakeModel([]);
    await rememberFromTurn(f.db, model, turn, signal);
    const prompt = JSON.stringify(seen[0]);
    const payload = JSON.parse(String(seen[0].find(message => message.role === "user")?.content));
    expect(payload.ownerMessage).toBe("My daughter Mia starts school on Monday.");
    expect(payload.existingMemories.map((memory: { id: string }) => memory.id)).toEqual(["m-live"]);
    expect(payload.doNotRepeat).toEqual(["Forgotten fact."]);
    expect(prompt).not.toContain("Outdated fact the agent retired.");
    expect(prompt).not.toContain("Other owner's fact.");
  });
});

describe("owner snapshot memory", () => {
  const owner = { id: "owner", name: "Synthetic", username: "synthetic", timezone: "UTC", assistantName: "ME3" };

  it("separates how the owner wants the agent to work from what it knows about them", async () => {
    const f = fixture();
    f.memory("m-pref", { kind: "preference", body: "Never suggest calls before 10am.", source: "manual" });
    f.memory("m-fact", { kind: "relationship_note", body: "Owner's daughter is Mia." });
    f.memory("m-typed", { kind: "owner_note", body: "Always offer two meeting times.", source: "manual" });
    const { prompt } = await loadOwnerSnapshotContext({ db: f.db, ownerId: "owner", owner, meJsonUrl: null });
    const work = prompt.indexOf("How the owner wants you to work");
    const known = prompt.indexOf("What you know about the owner");
    expect(work).toBeGreaterThan(-1);
    expect(known).toBeGreaterThan(work);
    expect(prompt.slice(work, known)).toContain("Never suggest calls before 10am.");
    expect(prompt.slice(work, known)).not.toContain("Mia");
    expect(prompt.slice(work, known)).toContain("Always offer two meeting times.");
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

describe("memory review and forgetting", () => {
  it("reports what it held back for review, most important first", async () => {
    const f = fixture();
    const outcome = await rememberFromTurn(f.db, fakeModel([
      { op: "add", kind: "owner_note", body: "Owner has a mild back injury.", importance: 2, sensitive: true },
      { op: "add", kind: "owner_note", body: "Owner is going through a divorce.", importance: 5, sensitive: true },
      { op: "add", kind: "preference", body: "Owner likes short replies.", importance: 4 },
    ]).model, turn, signal);
    expect(outcome.held.map(item => item.body)).toEqual(["Owner is going through a divorce.", "Owner has a mild back injury."]);
    expect(outcome.held.every(item => typeof item.id === "string")).toBe(true);
  });

  it("never proposes again what the owner declined, and tells the model not to", async () => {
    const f = fixture();
    f.memory("m-declined", { body: "Owner has high blood pressure.", status: "archived", forgottenAt: "2026-10-02T09:00:00Z" });
    const { model, seen } = fakeModel([{ op: "add", kind: "owner_note", body: "owner has high blood pressure", sensitive: true }]);
    const outcome = await rememberFromTurn(f.db, model, turn, signal);
    expect(outcome.held).toEqual([]);
    expect(f.rows()).toHaveLength(1);
    expect(JSON.stringify(seen[0])).toContain("Owner has high blood pressure.");
  });

  it("shows a reply's review card with the memory's current status, never another owner's", async () => {
    const f = fixture();
    f.raw.exec("INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic')");
    f.memory("m-pending", { body: "Owner has a back injury.", status: "needs_review" });
    f.memory("m-kept", { body: "Owner is training for a marathon.", status: "active" });
    f.memory("m-no", { body: "Owner is in debt.", status: "archived" });
    f.memory("m-foreign", { owner: "other", body: "Other owner's secret.", status: "needs_review" });
    const insert = f.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,created_at,metadata_json) VALUES(?,?,?,?,?,?,?)");
    ["m-pending", "m-kept", "m-no", "m-foreign"].forEach((memoryId, index) =>
      insert.run(`t${index}:assistant:complete:final`, "owner", "thread", "assistant", `Reply ${index}`, `2026-10-20T09:0${index}:00Z`, JSON.stringify({ runtime: "agent", turnId: `t${index}`, memoryReview: { memoryId } })));
    const app = new Hono<{ Bindings: Env }>();
    registerAssistantRoutes(app as never, { requireOwner: async () => "owner", unauthorized: () => new Response("Unauthorized", { status: 401 }), getSessionOwnerId: async () => "owner", getSetupRequired: async () => [] } as never);
    const response = await app.request("/api/assistant/threads/thread/messages?limit=10", {}, { DB: f.db } as unknown as Env);
    const body = await response.json() as { messages: Array<{ memoryReview?: unknown }> };
    expect(body.messages.map(message => message.memoryReview ?? null)).toEqual([
      { id: "m-pending", body: "Owner has a back injury.", displayBody: "You have a back injury.", status: "pending" },
      { id: "m-kept", body: "Owner is training for a marathon.", displayBody: "You are training for a marathon.", status: "remembered" },
      { id: "m-no", body: "Owner is in debt.", displayBody: "You are in debt.", status: "declined" },
      null,
    ]);
  });

  it("finds what it remembers and forgets only a memory it read this turn", async () => {
    const f = fixture();
    f.raw.exec("INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic')");
    f.memory("m-bp", { body: "Owner has high blood pressure.", source: "manual" });
    f.memory("m-run", { body: "Owner runs on Saturdays." });
    f.memory("m-foreign", { owner: "other", body: "Other owner has high blood pressure." });
    const tools = createDomainTools();
    const search = tools.find(tool => tool.name === "core_memory_search")!;
    const forget = tools.find(tool => tool.name === "core_memory_forget")!;
    const context = { db: f.db, ownerId: "owner", threadId: "thread", turnId: "turn-1", requestId: "request-1", toolCallId: "call-1", idempotencyKey: "key-1", ownerTimezone: "UTC", messageText: "Forget that I have high blood pressure", messages: [], enabledPluginIds: new Set(["me3.mission-control"]), signal } as unknown as AgentToolContext;

    expect((await forget.execute({ memoryId: "m-run" }, context)).status).toBe("error");
    const found = await search.execute({ query: "blood pressure" }, context);
    expect(found.status).toBe("ok");
    expect((found.data as { memories: Array<{ id: string }> }).memories.map(memory => memory.id)).toEqual(["m-bp"]);
    expect((await forget.execute({ memoryId: "m-bp" }, context)).status).toBe("ok");
    expect(f.rows().find(row => row.id === "m-bp")).toMatchObject({ review_status: "archived" });
    expect(f.raw.prepare("SELECT forgotten_at FROM mission_private_memory WHERE id = 'm-bp'").get()).toMatchObject({ forgotten_at: expect.any(String) });
    expect(f.rows().find(row => row.id === "m-run")).toMatchObject({ review_status: "active" });
  });
});

describe("memory shown to the owner", () => {
  it("speaks to the owner in second person", () => {
    expect(ownerFacingMemory("Owner's daughter is Mia.")).toBe("Your daughter is Mia.");
    expect(ownerFacingMemory("Owner is in debt.")).toBe("You are in debt.");
    expect(ownerFacingMemory("Owner has a back injury.")).toBe("You have a back injury.");
    expect(ownerFacingMemory("Owner was born in Leeds.")).toBe("You were born in Leeds.");
    expect(ownerFacingMemory("Owner doesn't drink coffee.")).toBe("You don't drink coffee.");
    expect(ownerFacingMemory("The owner prefers short replies.")).toBe("You prefer short replies.");
  });

  it("conjugates the owner's verbs, past any adverbs", () => {
    expect(ownerFacingMemory("Owner uses a standing desk.")).toBe("You use a standing desk.");
    expect(ownerFacingMemory("Owner watches football on Sundays.")).toBe("You watch football on Sundays.");
    expect(ownerFacingMemory("Owner studies Spanish.")).toBe("You study Spanish.");
    expect(ownerFacingMemory("Owner goes running daily.")).toBe("You go running daily.");
    expect(ownerFacingMemory("Owner plays tennis.")).toBe("You play tennis.");
    expect(ownerFacingMemory("Owner usually prefers mornings.")).toBe("You usually prefer mornings.");
    expect(ownerFacingMemory("Owner no longer drinks alcohol.")).toBe("You no longer drink alcohol.");
    expect(ownerFacingMemory("Owner started a new job in October 2026.")).toBe("You started a new job in October 2026.");
    expect(ownerFacingMemory("Owner can't eat gluten.")).toBe("You can't eat gluten.");
  });

  it("rewrites every reference to the owner in the sentence", () => {
    expect(ownerFacingMemory("Owner's daughter is Mia; Owner picks her up on Fridays.")).toBe("Your daughter is Mia; you pick her up on Fridays.");
    expect(ownerFacingMemory("Mia is Owner's daughter.")).toBe("Mia is your daughter.");
    expect(ownerFacingMemory("Owner is the owner of a bakery.")).toBe("You are the owner of a bakery.");
    expect(ownerFacingMemory("Owner pushes themselves too hard.")).toBe("You push yourself too hard.");
  });

  it("keeps the original wording when it can't be sure", () => {
    for (const body of ["Keep replies short.", "Owner, a nurse, works nights.", "Sam emails Owner weekly.", "Owner Kieran runs a bakery.", ""]) {
      expect(ownerFacingMemory(body)).toBe(body);
    }
  });
});

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createDomainTools } from "../../../packages/agent/src/tools/index";
import type { AgentDb, AgentStatement, AgentToolContext } from "../../../packages/agent/src/types";
import { loadAgentMessageDraft, readAgentMessageDraft } from "./agent-message-draft";
import type { Env } from "./types";

// "Tell Erum I'm running late": the tool drafts for one Soulink-reachable contact
// and never sends. Failure modes: guessing between two people, drafting to someone
// ME3 cannot message, reaching another owner's contacts, a card from a failed draft.
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function context() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  raw.exec(`CREATE TABLE contacts (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, email TEXT, source TEXT, source_ref TEXT,
    status TEXT DEFAULT 'active', social_handles TEXT, metadata TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  const add = (id: string, name: string, extra: { owner?: string; node?: string; handle?: string; status?: string } = {}) =>
    raw.prepare("INSERT INTO contacts (id,user_id,name,source,status,social_handles,metadata) VALUES (?,?,?,?,?,?,?)").run(
      id, extra.owner ?? "owner", name, extra.node ? "soulink" : "manual", extra.status ?? "active",
      extra.handle ? JSON.stringify({ soulink: extra.handle }) : null, extra.node ? JSON.stringify({ soulinkNodeId: extra.node }) : null);
  const statement = (sql: string, values: unknown[] = []): AgentStatement => ({
    bind: (...bound) => statement(sql, bound),
    async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
    async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
    async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
  });
  const db: AgentDb = { prepare: sql => statement(sql) };
  const ctx = { db, ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "request", toolCallId: "call", idempotencyKey: "k",
    ownerTimezone: "Europe/Dublin", messageText: "", messages: [], enabledPluginIds: new Set(), signal: new AbortController().signal } as unknown as AgentToolContext;
  const draft = (args: Record<string, unknown>) => createDomainTools().find(tool => tool.name === "core_messages_draft")!.execute(args, ctx);
  return { add, draft };
}

describe("core_messages_draft", () => {
  it("drafts to the one person the owner named, without sending", async () => {
    const { add, draft } = context();
    add("c-erum", "Erum Hayat", { node: "node_erum", handle: "erum" });
    add("c-sam", "Sam Lee", { node: "node_sam" });
    const result = await draft({ to: "Erum", text: "I'm running ten minutes late." });
    expect(result).toMatchObject({ status: "ok", data: { drafted: true, draft: {
      contactId: "c-erum", recipientName: "Erum Hayat", soulinkNodeId: "node_erum", soulinkHandle: "erum", text: "I'm running ten minutes late.",
    } } });
    expect(JSON.stringify(result)).toContain("nothing is sent until they tap Send");
  });

  it("asks who when the name is unknown or matches two people", async () => {
    const { add, draft } = context();
    add("c-sam-1", "Sam Lee", { node: "node_sam1" });
    add("c-sam-2", "Sam Patel", { node: "node_sam2" });
    expect(await draft({ to: "Priya", text: "Hi" })).toMatchObject({ status: "ok", data: { drafted: false, reason: "unknown" } });
    expect(await draft({ to: "Sam", text: "Hi" })).toMatchObject({ status: "ok", data: { drafted: false, reason: "ambiguous",
      candidates: expect.arrayContaining([{ contactId: "c-sam-1", name: "Sam Lee" }, { contactId: "c-sam-2", name: "Sam Patel" }]) } });
    // The owner picks one; the exact full name also settles it.
    expect(await draft({ contactId: "c-sam-2", text: "Hi" })).toMatchObject({ data: { drafted: true, draft: { recipientName: "Sam Patel" } } });
    expect(await draft({ to: "sam lee", text: "Hi" })).toMatchObject({ data: { drafted: true, draft: { contactId: "c-sam-1" } } });
  });

  it("says when the person cannot get ME3 messages", async () => {
    const { add, draft } = context();
    add("c-mum", "Mum");
    expect(await draft({ to: "Mum", text: "Home soon" })).toMatchObject({ status: "ok", data: { drafted: false, reason: "not_on_me3", recipient: { contactId: "c-mum" } } });
  });

  it("never reaches another owner's or an archived contact", async () => {
    const { add, draft } = context();
    add("c-other", "Erum Hayat", { owner: "someone-else", node: "node_x" });
    add("c-old", "Erum Old", { node: "node_old", status: "archived" });
    expect(await draft({ to: "Erum", text: "Hi" })).toMatchObject({ data: { drafted: false, reason: "unknown" } });
    expect(await draft({ contactId: "c-other", text: "Hi" })).toMatchObject({ data: { drafted: false, reason: "unknown" } });
  });

  it("needs the message and someone to send it to", async () => {
    const { draft } = context();
    expect(await draft({ to: "Erum" })).toMatchObject({ status: "error" });
    expect(await draft({ text: "Hi" })).toMatchObject({ status: "error" });
    expect(await draft({ to: "Erum", text: "Hi", body: "x" })).toMatchObject({ status: "error" });
  });
});

function receipts(rows: Array<{ turn: string; tool?: string; result: unknown }>) {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  raw.exec("CREATE TABLE me3_agent_tool_receipts (owner_id TEXT, turn_id TEXT, tool_name TEXT, status TEXT, result_json TEXT, updated_at TEXT)");
  rows.forEach((row, index) => raw.prepare("INSERT INTO me3_agent_tool_receipts VALUES ('owner',?,?,'finished',?,?)")
    .run(row.turn, row.tool ?? "core_messages_draft", JSON.stringify(row.result), `2026-11-22 10:00:0${index}`));
  return { DB: { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ first: async () => raw.prepare(sql).get(...values as never[]) ?? null }) }) } } as unknown as Env;
}

describe("message draft card payload", () => {
  const card = { contactId: "c-erum", recipientName: "Erum Hayat", soulinkNodeId: "node_erum", soulinkHandle: "erum", text: "Running late" };

  it("uses the turn's latest drafted message", async () => {
    expect(await loadAgentMessageDraft(receipts([
      { turn: "t1", result: { status: "ok", data: { drafted: true, draft: { ...card, text: "Old" } } } },
      { turn: "t1", result: { status: "ok", data: { drafted: true, draft: card } } },
      { turn: "t2", result: { status: "ok", data: { drafted: true, draft: { ...card, text: "Other turn" } } } },
    ]), { ownerId: "owner", turnId: "t1" })).toEqual(card);
  });

  it("shows no card when the tool asked who, failed, or was another tool", async () => {
    expect(await loadAgentMessageDraft(receipts([{ turn: "t1", result: { status: "ok", data: { drafted: false, reason: "ambiguous" } } }]), { ownerId: "owner", turnId: "t1" })).toBeNull();
    expect(await loadAgentMessageDraft(receipts([{ turn: "t1", result: { status: "error", error: "x" } }]), { ownerId: "owner", turnId: "t1" })).toBeNull();
    expect(await loadAgentMessageDraft(receipts([{ turn: "t1", tool: "core_mailbox_draft", result: { status: "ok", data: { drafted: true, draft: card } } }]), { ownerId: "owner", turnId: "t1" })).toBeNull();
  });

  it("rejects incomplete saved shapes", () => {
    expect(readAgentMessageDraft({ ...card, text: " " })).toBeNull();
    expect(readAgentMessageDraft({ ...card, soulinkNodeId: null })).toBeNull();
    expect(readAgentMessageDraft({ ...card, soulinkHandle: 7 })).toBeNull();
    expect(readAgentMessageDraft({ ...card, soulinkHandle: null })).toEqual({ ...card, soulinkHandle: null });
  });
});

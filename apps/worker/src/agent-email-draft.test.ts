import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { loadAgentEmailDraft, readAgentEmailDraft } from "./agent-email-draft";
import type { Env } from "./types";

function env(rows: Array<{ turn: string; tool?: string; status?: string; args: unknown; result: unknown }>) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE me3_agent_tool_receipts (owner_id TEXT, idempotency_key TEXT, turn_id TEXT, tool_name TEXT, arguments_json TEXT, status TEXT, result_json TEXT, created_at TEXT, updated_at TEXT)");
  rows.forEach((row, index) => raw.prepare("INSERT INTO me3_agent_tool_receipts VALUES ('owner',?,?,?,?,?,?,?,?)")
    .run(`k${index}`, row.turn, row.tool ?? "core_mailbox_draft", JSON.stringify(row.args), row.status ?? "finished", JSON.stringify(row.result), "2026-10-17", `2026-10-17 10:00:0${index}`));
  return { DB: { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ first: async () => raw.prepare(sql).get(...values as never[]) ?? null }) }) } } as unknown as Env;
}

describe("email draft card payload", () => {
  it("uses the turn's latest saved draft", async () => {
    const draft = await loadAgentEmailDraft(env([
      { turn: "t1", args: { to: "a@example.test", subject: "Old", body: "Old body" }, result: { status: "ok", data: { draft: { id: "d1", toAddress: "a@example.test", subject: "Old", body: "Old body" } } } },
      { turn: "t1", args: { to: "erum@example.test", subject: "Session", body: "Hi Erum" }, result: { status: "ok", data: { draft: { id: "d2", toAddress: "erum@example.test", subject: "Session", body: "Hi Erum" } } } },
      { turn: "t2", args: {}, result: { status: "ok", data: { draft: { id: "other", toAddress: "x@example.test", subject: "X", body: "X" } } } },
    ]), { ownerId: "owner", turnId: "t1" });
    expect(draft).toEqual({ draftId: "d2", to: "erum@example.test", recipientName: null, contactId: null, subject: "Session", body: "Hi Erum", replyToMessageId: null });
  });

  it("carries an unsaved draft that still needs an address", async () => {
    const draft = await loadAgentEmailDraft(env([{ turn: "t1", args: { recipientName: "Erum Hayat", contactId: "c1", subject: "Session", body: "Hi Erum" },
      result: { status: "ok", data: { saved: false, draft: { id: null, toAddress: "", recipientName: "Erum Hayat", contactId: "c1", subject: "Session", body: "Hi Erum", replyToMessageId: null } } } }]), { ownerId: "owner", turnId: "t1" });
    expect(draft).toMatchObject({ draftId: null, to: "", recipientName: "Erum Hayat", contactId: "c1" });
  });

  it("ignores failed drafts and other tools", async () => {
    expect(await loadAgentEmailDraft(env([
      { turn: "t1", args: {}, result: { status: "error", error: "Mailbox not found" } },
      { turn: "t1", tool: "core_reminders_create", args: {}, result: { status: "ok", data: { draft: { id: "x", toAddress: "", subject: "S", body: "B" } } } },
    ]), { ownerId: "owner", turnId: "t1" })).toBeNull();
  });

  it("rejects incomplete saved shapes", () => {
    expect(readAgentEmailDraft({ draftId: null, to: "", recipientName: null, contactId: null, subject: "S", body: "", replyToMessageId: null })).toBeNull();
    expect(readAgentEmailDraft({ draftId: 7, to: "", recipientName: null, contactId: null, subject: "S", body: "B", replyToMessageId: null })).toBeNull();
  });
});

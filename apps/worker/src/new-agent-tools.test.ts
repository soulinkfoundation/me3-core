import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createDomainTools } from "../../../packages/agent/src/tools/index";
import { rememberTargets } from "../../../packages/agent/src/tools/targets";
import type { AgentDb, AgentStatement, AgentToolContext } from "../../../packages/agent/src/types";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function context(): AgentToolContext & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  raw.exec(readFileSync(new URL("../migrations/0059_agent_targets.sql", import.meta.url), "utf8"));
  raw.exec(`CREATE TABLE user_reminders (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, notes TEXT, remind_at TEXT, timezone TEXT, recurrence_rule TEXT, context_type TEXT, context_id TEXT, context_label TEXT, status TEXT, delivered_at TEXT, dismissed_at TEXT, cancelled_at TEXT, created_at TEXT, updated_at TEXT, error_message TEXT, source_dispatch_id TEXT, created_via TEXT); CREATE UNIQUE INDEX reminder_write ON user_reminders(user_id, source_dispatch_id);`);
  raw.prepare(`INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,status) VALUES (?,?,?,?,?,?)`).run("r1", "owner", "Call Ada", "2099-10-11T08:00:00.000Z", "Europe/Dublin", "pending");
  raw.prepare(`INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,status) VALUES (?,?,?,?,?,?)`).run("r2", "owner", "Call Ada", "2099-10-12T08:00:00.000Z", "Europe/Dublin", "pending");
  function statement(sql: string, values: unknown[] = []): AgentStatement {
    return { bind: (...bound) => statement(sql, bound), async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; } };
  }
  const db: AgentDb = { prepare: sql => statement(sql) };
  return { raw, db, ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "request", toolCallId: "call", idempotencyKey: "write-1", ownerTimezone: "Europe/Dublin", messageText: "Move Call Ada", messages: [], enabledPluginIds: new Set(), signal: new AbortController().signal };
}
const tool = (name: string) => { const result = createDomainTools().find(tool => tool.name === name); if (!result) throw new Error(`Missing ${name}`); return result; };

describe("new agent domain tools", () => {
  it("ports all 40 active tools and declares safe external and destructive policies", () => {
    const tools = createDomainTools();
    expect(tools).toHaveLength(42); // 40 active capabilities plus explicit mailbox sending and stable scheduling read.
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    for (const value of tools) {
      expect(value.parameters.additionalProperties).toBe(false);
      if (["external", "destructive"].includes(value.effect)) expect(value.approval).toBe("required");
    }
    expect(tool("core_reminders_update").parameters.required).toContain("reminderId");
  });

  it("creates a calendar event only once when the domain call is replayed", async () => {
    const ctx = context(); ctx.enabledPluginIds = new Set(["me3.calendar"]);
    ctx.raw.exec(`CREATE TABLE user_calendar_events (id TEXT PRIMARY KEY,user_id TEXT,title TEXT,notes TEXT,location TEXT,starts_at TEXT,ends_at TEXT,timezone TEXT,all_day INTEGER,kind TEXT,recurrence_rule TEXT);`);
    const args = { title: "Launch review", startDate: "2099-10-11", startTime: "10:00", startTimezone: "Europe/Dublin" };
    expect((await tool("core_calendar_event_create").execute(args, ctx)).status).toBe("ok");
    expect((await tool("core_calendar_event_create").execute(args, ctx)).status).toBe("ok");
    expect(ctx.raw.prepare("SELECT COUNT(*) AS count FROM user_calendar_events").get()).toMatchObject({ count: 1 });
  });

  it("does not expose disabled plugin data through execution", async () => {
    const ctx = context();
    expect(await tool("core_calendar_events_list").execute({ dateFrom: "2099-10-11", dateTo: "2099-10-11" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/enabled/i) });
  });

  it("filters Mission tasks before the bounded result page", async () => {
    const ctx = context(); ctx.enabledPluginIds = new Set(["me3.mission-control"]);
    ctx.raw.exec(`CREATE TABLE mission_projects(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,slug TEXT,description TEXT,status TEXT);
      CREATE TABLE mission_tasks(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,description TEXT,project_id TEXT,status TEXT,priority INTEGER,due_at TEXT,scheduled_for TEXT,source_ref TEXT,archived_at TEXT,updated_at TEXT);
      INSERT INTO mission_projects(id,user_id,name,slug,status) VALUES ('launch','owner','Launch','launch','active'),('other','owner','Other','other','active');
      INSERT INTO mission_tasks(id,user_id,title,project_id,status,priority,updated_at) VALUES ('target','owner','Older launch task','launch','backlog',3,'2000-01-01');`);
    for (let index = 0; index < 101; index++) ctx.raw.prepare("INSERT INTO mission_tasks(id,user_id,title,project_id,status,priority,updated_at) VALUES (?,?,?,?,?,?,?)").run(`new-${index}`, "owner", `New ${index}`, "other", "backlog", 3, "2099-01-01");
    expect(await tool("core_mission_task_list").execute({ projectId: "launch", status: "backlog" }, ctx)).toMatchObject({ status: "ok", data: { tasks: [expect.objectContaining({ id: "target" })] } });
  });

  it("refuses invented target IDs and stale durable snapshots", async () => {
    const ctx = context();
    const args = { reminderId: "r1", date: "2099-10-13", time: "10:00" };
    expect(await tool("core_reminders_update").execute(args, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/read/i) });
    await tool("core_reminders_list").execute({}, ctx);
    ctx.raw.prepare("UPDATE user_reminders SET title = 'Changed by owner' WHERE id = 'r1'").run();
    expect(await tool("core_reminders_update").execute(args, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/changed/i) });
    expect(ctx.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='r1'").get()).toMatchObject({ remind_at: "2099-10-11T08:00:00.000Z" });
  });

  it("binds a numbered reply to persisted candidates and preserves unrelated reminder fields", async () => {
    const ctx = context();
    await tool("core_reminders_list").execute({ query: "Call Ada" }, ctx);
    ctx.turnId = "turn-2"; ctx.messageText = "2";
    expect(await tool("core_reminders_update").execute({ reminderId: "r1", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/selection/i) });
    const result = await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx);
    expect(result).toMatchObject({ status: "ok", data: { reminder: { id: "r2", title: "Call Ada", remindAt: "2099-10-13T09:00:00.000Z" } } });
    expect(ctx.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='r1'").get()).toMatchObject({ remind_at: "2099-10-11T08:00:00.000Z" });
  });

  it("binds a generic ordinal owner reply to the recorded candidate ID", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({ query: "Call Ada" }, ctx);
    ctx.turnId = "turn-2"; ctx.messageText = "The second one.";
    expect(await tool("core_reminders_update").execute({ reminderId: "r1", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/selection/i) });
  });

  it("can change a reminder twice without losing its persisted read shape", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    expect((await tool("core_reminders_update").execute({ reminderId: "r1", date: "2099-10-13", time: "10:00" }, ctx)).status).toBe("ok");
    expect((await tool("core_reminders_update").execute({ reminderId: "r1", date: "2099-10-14", time: "11:00" }, ctx)).status).toBe("ok");
  });

  it("keeps the original approved draft snapshot when a later turn reads a changed draft", async () => {
    const ctx = context(); let sends = 0;
    let message = { id: "draft-1", status: "draft", to: "ada@example.test", subject: "Launch", bodyText: "Ready" };
    ctx.services = { mailbox: { read: async () => ({ message }), sendDraft: async () => { sends++; return { message }; } } };
    await tool("core_mailbox_read").execute({ messageId: "draft-1" }, ctx);
    const pending = await tool("core_mailbox_send").prepareApproval!({ draftId: "draft-1" }, ctx);
    expect(pending.status).toBe("needs_approval"); expect(sends).toBe(0);
    message = { ...message, bodyText: "Changed later" };
    await tool("core_mailbox_read").execute({ messageId: "draft-1" }, { ...ctx, turnId: "later" });
    const result = await tool("core_mailbox_send").execute({ draftId: "draft-1" }, { ...ctx, approved: true, approvalData: pending.approval });
    expect(result).toMatchObject({ status: "error", error: expect.stringMatching(/changed/i) });
    expect(sends).toBe(0);
  });

  it("rejects a numeric reply when the previous turn produced conflicting candidate sets", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({ query: "Call Ada" }, ctx);
    ctx.raw.prepare(`INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,status) VALUES (?,?,?,?,?,?)`).run("r3", "owner", "Call Ada", "2099-10-14T08:00:00.000Z", "UTC", "pending");
    await tool("core_reminders_list").execute({ query: "Call Ada" }, ctx);
    ctx.turnId = "turn-2"; ctx.messageText = "2";
    const result = await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx);
    expect(result).toMatchObject({ status: "error", error: expect.stringMatching(/candidate sets/i) });
  });

  it("rejects an older domain's numbered choices after a newer domain list", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    await rememberTargets({ ...ctx, turnId: "newer-task-turn" }, "task", [{ id: "t1" }, { id: "t2" }]);
    ctx.turnId = "selection-turn"; ctx.messageText = "The second one.";
    expect(await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/selection/i) });
    expect(ctx.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='r2'").get()).toMatchObject({ remind_at: "2099-10-12T08:00:00.000Z" });
    ctx.messageText = "Move reminder r2 to 10 tomorrow.";
    expect((await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx)).status).toBe("ok");
  });

  it.each([0, 1])("invalidates old numbered choices after a newer list with %i records", async count => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    await rememberTargets({ ...ctx, turnId: "newer-task-turn" }, "task", [{ id: "t1" }].slice(0, count));
    ctx.raw.prepare("UPDATE me3_agent_selections SET created_at=?").run(new Date().toISOString()); // Timestamp ties cannot revive an older domain's choices.
    ctx.turnId = "selection-turn"; ctx.messageText = "2";
    expect(await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/selection/i) });
    expect(ctx.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='r2'").get()).toMatchObject({ remind_at: "2099-10-12T08:00:00.000Z" });
  });

  it("rejects tied selection turns after an import changes their row order", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    await rememberTargets({ ...ctx, turnId: "newer-task-turn" }, "task", [{ id: "t1" }, { id: "t2" }]);
    ctx.raw.prepare("UPDATE me3_agent_selections SET created_at=?").run(new Date().toISOString());
    ctx.raw.exec(`CREATE TEMP TABLE exported_selections AS SELECT * FROM me3_agent_selections;
      DELETE FROM me3_agent_selections;
      INSERT INTO me3_agent_selections SELECT * FROM exported_selections ORDER BY CASE domain WHEN 'task' THEN 0 ELSE 1 END;`);
    ctx.turnId = "selection-turn"; ctx.messageText = "2";
    expect(await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/selection/i) });
    expect(ctx.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='r2'").get()).toMatchObject({ remind_at: "2099-10-12T08:00:00.000Z" });
  });

  it("keeps an owner's reply bound to the prior turn despite a fresh current-turn read", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    ctx.turnId = "selection-turn"; ctx.messageText = "2";
    await rememberTargets(ctx, "task", [{ id: "t1" }]);
    expect((await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx)).status).toBe("ok");
  });

  it("rejects a numbered reply after mixed-domain choices in the same prior turn", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    await rememberTargets(ctx, "task", [{ id: "t1" }, { id: "t2" }]);
    ctx.turnId = "selection-turn"; ctx.messageText = "2";
    expect(await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/candidate sets/i) });
    expect(ctx.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='r2'").get()).toMatchObject({ remind_at: "2099-10-12T08:00:00.000Z" });
  });

  it("rejects zero as an invalid numbered choice before any reminder write", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    ctx.turnId = "selection-turn"; ctx.messageText = "0";
    expect(await tool("core_reminders_update").execute({ reminderId: "r1", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/selection/i) });
    expect(ctx.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='r1'").get()).toMatchObject({ remind_at: "2099-10-11T08:00:00.000Z" });
  });

  it("keeps numbered choices bound after reading the selected record", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({ query: "Call Ada" }, ctx);
    ctx.turnId = "turn-2"; ctx.messageText = "2";
    const result = await tool("core_reminders_update").execute({ reminderId: "r2", date: "2099-10-13", time: "10:00" }, ctx);
    expect(result.status).toBe("ok");
  });

  it("searches reminders outside the first upcoming page", async () => {
    const ctx = context();
    for (let i = 0; i < 10; i++) ctx.raw.prepare(`INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,status) VALUES (?,?,?,?,?,?)`).run(`extra-${i}`, "owner", `Earlier ${i}`, "2099-10-10T07:00:00.000Z", "UTC", "pending");
    const result = await tool("core_reminders_list").execute({ query: "Call Ada" }, ctx);
    expect(result).toMatchObject({ status: "ok", data: { reminders: [expect.objectContaining({ id: "r1" }), expect.objectContaining({ id: "r2" })] } });
  });

  it("scopes durable read receipts to the owner and thread", async () => {
    const ctx = context(); await tool("core_reminders_list").execute({}, ctx);
    ctx.threadId = "other-thread";
    expect(await tool("core_reminders_update").execute({ reminderId: "r1", date: "2099-10-13", time: "10:00" }, ctx)).toMatchObject({ status: "error", error: expect.stringMatching(/read/i) });
  });

  it("returns a structured approval before sending a reviewed email and never treats confirmed as authorization", async () => {
    const ctx = context(); let sends = 0;
    const message = { id: "draft-1", status: "draft", to: "ada@example.test", subject: "Launch", bodyText: "Ready" };
    ctx.services = { mailbox: { read: async () => ({ message }), sendDraft: async () => { sends++; return { message: { ...message, status: "sent" } }; } } };
    await tool("core_mailbox_read").execute({ messageId: "draft-1" }, ctx);
    expect(await tool("core_mailbox_send").execute({ draftId: "draft-1", confirmed: true }, ctx)).toMatchObject({ status: "error" });
    const pending = await tool("core_mailbox_send").execute({ draftId: "draft-1" }, ctx);
    expect(pending).toMatchObject({ status: "needs_approval", approval: { title: "Send email", summary: expect.stringContaining("ada@example.test") } });
    expect(sends).toBe(0);
    ctx.approved = true; ctx.approvalData = pending.approval;
    expect(await tool("core_mailbox_send").execute({ draftId: "draft-1" }, ctx)).toMatchObject({ status: "ok" });
    expect(sends).toBe(1);
  });
});

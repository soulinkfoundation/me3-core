import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createD1TurnStore, persistAgentInput, runAgentTurn } from "../../../packages/agent/src";
import * as agent from "../../../packages/agent/src";
import { createDomainTools } from "../../../packages/agent/src/tools";
import { rememberTargets } from "../../../packages/agent/src/tools/targets";
import type { AgentDb, AgentModel, AgentStatement, AgentTool, AgentToolContext } from "../../../packages/agent/src/types";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
const firstId = "presentation-reminder-jan15";
const secondId = "presentation-reminder-jan17";
const label = "ME3 QA check launch";
const changes = { date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" };
const originalIdentity = { ownerId: "owner", threadId: "thread", turnId: "present-turn", requestId: "present-request" };
const originalText = "Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.";
type Presentation = { id: string; ownerId: string; threadId: string; [key: string]: unknown };
type Selection = { presentationId: string; candidateId: string };
type PresentationApi = {
  prepareTargetPresentation(context: AgentToolContext, input: { selectionId: string; toolName: string; arguments: Record<string, unknown> }, tools: readonly AgentTool[]): Promise<Presentation>;
  loadTargetPresentation(db: AgentDb, input: { ownerId: string; threadId: string; presentationId: string }): Promise<Presentation | null>;
  validateTargetSelection(context: AgentToolContext, selection: Selection, tools: ReturnType<typeof createDomainTools>): Promise<{ presentation: Presentation; call: { id: string; name: string; arguments: Record<string, unknown> } }>;
  targetSelectionClaimStatement(db: AgentDb, presentation: Presentation, input: { ownerId: string; threadId: string; turnId: string; requestId: string; candidateId: string; inputJson: string }): AgentStatement;
};
function api() {
  const exports = agent as unknown as PresentationApi;
  for (const key of ["prepareTargetPresentation", "loadTargetPresentation", "validateTargetSelection", "targetSelectionClaimStatement"] as const) expect(typeof exports[key], `Missing ${key} public contract`).toBe("function");
  return exports;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "me3-target-presentation-"));
  const databasePath = join(directory, "installation.sqlite");
  let raw = new DatabaseSync(databasePath);
  cleanup.push(() => { raw.close(); rmSync(directory, { recursive: true, force: true }); });
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, migrations), "utf8"));
  raw.exec("PRAGMA foreign_keys=ON");
  raw.exec(`INSERT INTO owner_profile(id,username,timezone) VALUES('owner','synthetic-owner','Europe/Dublin'),('other-owner','synthetic-other','Europe/Dublin');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic selection'),('other-thread','owner','Other conversation'),('foreign-thread','other-owner','Other owner');
    CREATE TABLE test_reminder_effects(id INTEGER PRIMARY KEY,reminder_id TEXT);
    CREATE TRIGGER test_reminder_write AFTER UPDATE ON user_reminders BEGIN INSERT INTO test_reminder_effects(reminder_id) VALUES(new.id); END;
    INSERT INTO mission_projects(id,user_id,name,slug) VALUES('selection-project','owner','Selection project','selection-project');
    INSERT INTO mission_tasks(id,user_id,project_id,title,status) VALUES('selection-task','owner','selection-project','An independent read task','backlog');`);
  for (const [id, owner, date] of [[firstId, "owner", "2027-01-15"], [secondId, "owner", "2027-01-17"], ["foreign-reminder", "other-owner", "2027-01-17"]]) {
    raw.prepare(`INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,notes,recurrence_rule,status)
      VALUES(?,?,?,?,'Europe/Dublin','Keep these notes','weekly:fri','pending')`).run(id, owner, label, `${date}T12:00:00.000Z`);
  }
  const executions = new WeakMap<AgentStatement, () => unknown>();
  let beforeReminderWrite: (() => void) | undefined;
  const db: AgentDb = {
    prepare(sql) {
      let values: unknown[] = [];
      const statement: AgentStatement = {
        bind(...args) { values = args; return statement; },
        async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
        async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
        async run() {
          if (beforeReminderWrite && /^\s*UPDATE\s+user_reminders\b/i.test(sql)) { const race = beforeReminderWrite; beforeReminderWrite = undefined; race(); }
          return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } };
        },
      };
      executions.set(statement, () => {
        const query = raw.prepare(sql);
        return query.columns().length ? { results: query.all(...values as never[]) } : { meta: { changes: Number(query.run(...values as never[]).changes) } };
      });
      return statement;
    },
    async batch(statements) {
      const calls = statements.map(statement => {
        const execute = executions.get(statement);
        if (!execute) throw new Error("Statement from a different disposable installation");
        return execute;
      });
      raw.exec("BEGIN IMMEDIATE");
      try { const results = calls.map(execute => execute()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  };
  const context: AgentToolContext = { ...originalIdentity, db, toolCallId: "read-call", idempotencyKey: "read-key", ownerTimezone: "Europe/Dublin", messageText: originalText, messages: [], enabledPluginIds: new Set(["me3.calendar", "me3.mission-control"]), signal: new AbortController().signal };
  const tools = createDomainTools();
  const tool = (name: string) => {
    const value = tools.find(value => value.name === name);
    if (!value) throw new Error(`Missing target presentation contract: ${name}`);
    return value;
  };
  const reminders = () => raw.prepare("SELECT id,user_id,title,remind_at,timezone,notes,recurrence_rule,status FROM user_reminders ORDER BY id").all();
  const read = async () => {
    const result = await tool("core_reminders_list").execute({ query: label }, context);
    expect(result.status).toBe("ok");
    return result.data as { selectionId: string; candidates: Array<{ id: string; option: number }> };
  };
  const present = async (selectionId: string, extra: Partial<AgentToolContext> = {}, action = { toolName: "core_reminders_update", arguments: changes as Record<string, unknown> }) => tool("core_targets_present").execute({ selectionId, ...action }, { ...context, toolCallId: "present-call", idempotencyKey: "present-key", ...extra });
  const getPresentation = async () => {
    await persistAgentInput(db, originalIdentity, { userId: "owner", threadId: "thread", turnId: originalIdentity.turnId, requestId: originalIdentity.requestId, messageText: originalText });
    const result = await present((await read()).selectionId);
    expect(result.status).toBe("needs_selection");
    const card = (result.data as { targetPresentation: { id: string } }).targetPresentation;
    expect(typeof card.id).toBe("string");
    return card.id;
  };
  const selectedContext = (presentationId: string, candidateId = secondId, extra: Partial<AgentToolContext> = {}) => ({ ...context, turnId: "choice-turn", requestId: "choice-request", toolCallId: "chosen-call", idempotencyKey: "chosen-key", messageText: "The second one.", targetSelection: { presentationId, candidateId }, ...extra });
  const choose = async (presentationId: string, candidateId = secondId) => {
    const selected = selectedContext(presentationId, candidateId);
    const validated = await api().validateTargetSelection(selected, selected.targetSelection, tools);
    await persistAgentInput(db, selected, { userId: selected.ownerId, threadId: selected.threadId, turnId: selected.turnId, requestId: selected.requestId, messageText: selected.messageText, targetSelection: selected.targetSelection });
    const canonical = raw.prepare("SELECT input_json FROM me3_agent_turns WHERE owner_id=? AND turn_id=?").get(selected.ownerId, selected.turnId)!;
    expect((await api().targetSelectionClaimStatement(db, validated.presentation, { ...selected, candidateId, inputJson: String(canonical.input_json) }).run()).meta?.changes).toBe(1);
    return selected;
  };
  const effects = () => raw.prepare("SELECT reminder_id FROM test_reminder_effects ORDER BY id").all();
  const runChosen = async (selected: ReturnType<typeof selectedContext>) => {
    const observations: unknown[] = [];
    const model: AgentModel = { id: "simulated-read-only-model", async step() { observations.push(reminders()); return { text: "The tool result is available.", toolCalls: [] }; } };
    const result = await runAgentTurn({ model, tools, messages: [{ role: "user", content: selected.messageText }], context: selected, store: createD1TurnStore(db, selected), signal: selected.signal });
    return { result, observations };
  };
  return { get raw() { return raw; }, db, context, tools, tool, read, present, reminders, getPresentation, selectedContext, choose, effects, runChosen,
    beforeReminderWrite(callback: () => void) { beforeReminderWrite = callback; },
    async persistOriginal(text = originalText) { await persistAgentInput(db, originalIdentity, { userId: "owner", threadId: "thread", turnId: originalIdentity.turnId, requestId: originalIdentity.requestId, messageText: text }); },
    reopen() { raw.close(); raw = new DatabaseSync(databasePath); raw.exec("PRAGMA foreign_keys=ON"); },
  };
}

describe("durable generic target presentations with real SQLite", () => {
  it("renders canonical ordered duplicate snapshots and exact pending changes without a domain write", async () => {
    const f = fixture(); await f.persistOriginal(); const before = f.reminders();
    const selection = await f.read();
    const result = await f.present(selection.selectionId);
    expect(result.status).toBe("needs_selection");
    expect(result.data).toMatchObject({ targetPresentation: { status: "pending", candidates: [{ id: firstId, option: 1, label }, { id: secondId, option: 2, label }] } });
    const data = result.data as { targetPresentation: { id: string; changes: Array<{ label: string; value: string }>; candidates: Array<{ fields: Array<{ label: string; value: string }> }> } };
    expect(data.targetPresentation.changes.map(change => change.value).join(" ")).toContain("2027-01-16");
    expect(data.targetPresentation.changes.map(change => change.value).join(" ")).toContain("09:30");
    expect(data.targetPresentation.candidates[0].fields.map(field => field.value).join(" ")).toContain("2027-01-15");
    expect(data.targetPresentation.candidates[1].fields.map(field => field.value).join(" ")).toContain("2027-01-17");
    f.reopen();
    const stored = f.raw.prepare("SELECT tool_name,arguments_json,candidates_json,status FROM me3_agent_presentations WHERE id=?").get(data.targetPresentation.id)!;
    expect(stored).toMatchObject({ tool_name: "core_reminders_update", status: "pending" });
    expect(JSON.parse(String(stored.arguments_json))).toEqual(changes);
    const persisted = JSON.parse(String(stored.candidates_json));
    expect(persisted.candidates.map((candidate: { id: string; option: number }) => [candidate.option, candidate.id])).toEqual([[1, firstId], [2, secondId]]);
    expect(persisted.candidates.map((candidate: { snapshot: { notes: string; recurrenceRule: string } }) => [candidate.snapshot.notes, candidate.snapshot.recurrenceRule])).toEqual([["Keep these notes", "weekly:fri"], ["Keep these notes", "weekly:fri"]]);
    expect(f.reminders()).toEqual(before);
  });

  it("keeps the explicit reminder presentation usable after nonempty calendar and task background reads", async () => {
    const f = fixture(); const id = await f.getPresentation();
    f.raw.prepare(`INSERT INTO user_calendar_events(id,user_id,title,starts_at,ends_at,timezone) VALUES('background-event','owner','Background event','2027-01-18T12:00:00.000Z','2027-01-18T13:00:00.000Z','Europe/Dublin')`).run();
    await f.tool("core_calendar_events_list").execute({ dateFrom: "2027-01-18", dateTo: "2027-01-18" }, f.context);
    await f.tool("core_mission_task_list").execute({ projectId: "selection-project" }, f.context);
    f.reopen(); const selected = await f.choose(id);
    const chosen = await f.runChosen(selected);
    expect(chosen.result.status).toBe("complete");
    expect(f.raw.prepare("SELECT remind_at FROM user_reminders WHERE id=?").get(secondId)).toMatchObject({ remind_at: "2027-01-16T09:30:00.000Z" });
    expect(f.effects()).toEqual([{ reminder_id: secondId }]);
  });

  it("ends the presentation turn before later reads or effects in the same model response", async () => {
    const f = fixture(); await f.persistOriginal(); const selection = await f.read(); let planningCalls = 0;
    const model: AgentModel = { id: "simulated-terminal-presentation", async step() {
      planningCalls++;
      return { text: "", toolCalls: [
        { id: "present", name: "core_targets_present", arguments: { selectionId: selection.selectionId, toolName: "core_reminders_update", arguments: changes } },
        { id: "later-read", name: "core_mission_task_list", arguments: { projectId: "selection-project" } },
        { id: "later-write", name: "core_reminders_update", arguments: { reminderId: firstId, ...changes } },
      ] };
    } };
    const before = f.reminders();
    const result = await runAgentTurn({ model, tools: f.tools, messages: [{ role: "user", content: originalText }], context: f.context, store: createD1TurnStore(f.db, originalIdentity) });
    expect(result.status).toBe("complete");
    expect(result).toMatchObject({ targetPresentation: { candidates: [{ id: firstId }, { id: secondId }] } });
    expect(planningCalls).toBe(1);
    expect(result.toolCalls.map(call => call.name)).toEqual(["core_targets_present"]);
    f.reopen(); expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
    expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_selections WHERE domain='task'").get()).toMatchObject({ n: 0 });
  });

  it("executes the server-bound edit before planning and replays once across database reopen and retry", async () => {
    const f = fixture(); const before = f.reminders(); const id = await f.getPresentation();
    const selected = await f.choose(id); f.reopen();
    const first = await f.runChosen(selected);
    expect(first.result.status).toBe("complete");
    expect(first.observations[0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: secondId, remind_at: "2027-01-16T09:30:00.000Z" })]));
    f.reopen(); expect((await f.runChosen(selected)).result.status).toBe("complete");
    expect(f.effects()).toEqual([{ reminder_id: secondId }]);
    expect(f.reminders().filter(row => row.id !== secondId)).toEqual(before.filter(row => row.id !== secondId));
    expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_tool_receipts WHERE tool_name='core_reminders_update' AND status='finished'").get()).toMatchObject({ n: 1 });
  });

  it.each(["expiry", "superseded", "cancelled"])("rejects a %s presentation before authenticating any choice", async reason => {
    const f = fixture(); const id = await f.getPresentation(); const before = f.reminders();
    if (reason === "expiry") f.raw.prepare("UPDATE me3_agent_presentations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(id);
    if (reason === "superseded") {
      await persistAgentInput(f.db, { ...originalIdentity, turnId: "new-menu-turn", requestId: "new-menu-request" }, { userId: "owner", threadId: "thread", turnId: "new-menu-turn", requestId: "new-menu-request", messageText: originalText });
      expect((await f.present((await f.read()).selectionId, { turnId: "new-menu-turn", requestId: "new-menu-request", idempotencyKey: "new-menu-key" })).status).toBe("needs_selection");
    }
    if (reason === "cancelled") f.raw.prepare("INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES('owner',?)").run(originalIdentity.requestId);
    f.reopen(); const selected = f.selectedContext(id);
    await expect(api().validateTargetSelection(selected, selected.targetSelection, f.tools)).rejects.toThrow();
    expect(f.effects()).toEqual([]); expect(f.reminders()).toEqual(before);
  });

  it.each([{ ownerId: "other-owner", threadId: "foreign-thread" }, { threadId: "other-thread" }])("rejects a cross-scope presentation without exposing candidates: %j", async extra => {
    const f = fixture(); const id = await f.getPresentation(); const selected = f.selectedContext(id, secondId, extra);
    expect(await api().loadTargetPresentation(f.db, { ownerId: selected.ownerId, threadId: selected.threadId, presentationId: id })).toBeNull();
    await expect(api().validateTargetSelection(selected, selected.targetSelection, f.tools)).rejects.toThrow();
    expect(f.effects()).toEqual([]);
  });

  it("rejects a fabricated or foreign candidate rather than substituting a record", async () => {
    const f = fixture(); const id = await f.getPresentation(); const before = f.reminders();
    for (const candidateId of ["invented-id", "foreign-reminder"]) {
      const selected = f.selectedContext(id, candidateId);
      await expect(api().validateTargetSelection(selected, selected.targetSelection, f.tools)).rejects.toThrow();
    }
    expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
  });

  it("does not accept a model-forged selection context without the authenticated persisted choice", async () => {
    const f = fixture(); const id = await f.getPresentation(); const before = f.reminders();
    const forged = f.selectedContext(id);
    const result = await f.tool("core_reminders_update").execute({ reminderId: secondId, ...changes }, forged);
    expect(result.status).toBe("error"); expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
  });

  it("does not admit a model-only guessed target when no presentation choice exists", async () => {
    const f = fixture(); await f.getPresentation(); const before = f.reminders();
    const result = await f.tool("core_reminders_update").execute({ reminderId: secondId, ...changes }, { ...f.context, turnId: "guess-turn", requestId: "guess-request" });
    expect(result.status).toBe("error"); expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
  });

  it.each([{ date: "2027-01-18" }, { time: "10:00" }, { timezone: "UTC" }, { notes: "Model-added change" }, { reminderId: firstId }])("refuses altered bound arguments or target: %j", async extra => {
    const f = fixture(); const selected = await f.choose(await f.getPresentation()); const before = f.reminders();
    const result = await f.tool("core_reminders_update").execute({ reminderId: secondId, ...changes, ...extra }, selected);
    expect(result.status).toBe("error"); f.reopen(); expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
  });

  it("rejects another action name or domain despite valid owner read receipts", async () => {
    const f = fixture(); await f.tool("core_mission_task_list").execute({ projectId: "selection-project" }, f.context);
    const selected = await f.choose(await f.getPresentation());
    expect((await f.tool("core_reminders_cancel").execute({ reminderId: secondId }, selected)).status).toBe("error");
    expect((await f.tool("core_mission_task_update").execute({ taskId: "selection-task", status: "done" }, selected)).status).toBe("error");
    f.reopen(); expect(f.effects()).toEqual([]);
    expect(f.raw.prepare("SELECT status FROM mission_tasks WHERE id='selection-task'").get()).toMatchObject({ status: "backlog" });
    expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_approvals").get()).toMatchObject({ n: 0 });
  });

  it("does not overwrite a selected record changed after presentation, even after a model reread", async () => {
    const f = fixture(); const selected = await f.choose(await f.getPresentation());
    f.raw.prepare("UPDATE user_reminders SET notes='Edited by owner later' WHERE id=?").run(secondId);
    await f.tool("core_reminders_list").execute({ query: label }, selected);
    const before = f.reminders(), effectsBefore = f.effects(); f.reopen();
    const result = await f.tool("core_reminders_update").execute({ reminderId: secondId, ...changes }, selected);
    expect(result.status).toBe("error"); expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual(effectsBefore);
  });

  it("retains compare-before-write when a selected record changes between lookup and the actual SQL update", async () => {
    const f = fixture(); const selected = await f.choose(await f.getPresentation());
    f.beforeReminderWrite(() => f.raw.prepare("UPDATE user_reminders SET notes='Concurrent owner edit' WHERE id=?").run(secondId));
    const result = await f.tool("core_reminders_update").execute({ reminderId: secondId, ...changes }, selected);
    expect(result.status).toBe("error"); f.reopen();
    expect(f.raw.prepare("SELECT remind_at,notes FROM user_reminders WHERE id=?").get(secondId)).toMatchObject({ remind_at: "2027-01-17T12:00:00.000Z", notes: "Concurrent owner edit" });
    expect(f.effects()).toEqual([{ reminder_id: secondId }]); // The racing owner edit only; the requested move never writes.
  });

  it("rejects another choice request racing or replaying the already chosen menu", async () => {
    const f = fixture(); const id = await f.getPresentation(); await f.choose(id);
    const conflict = f.selectedContext(id, firstId, { turnId: "other-choice-turn", requestId: "other-choice-request" });
    await expect(api().validateTargetSelection(conflict, conflict.targetSelection, f.tools)).rejects.toThrow();
    f.reopen(); expect(f.raw.prepare("SELECT chosen_record_id,choice_turn_id,choice_request_id FROM me3_agent_presentations WHERE id=?").get(id)).toMatchObject({ chosen_record_id: secondId, choice_turn_id: "choice-turn", choice_request_id: "choice-request" });
    expect(f.effects()).toEqual([]);
  });

  it("does not treat an authenticated destructive target choice as action approval", async () => {
    const f = fixture(); const text = "Cancel my ME3 QA check launch reminder.";
    await f.persistOriginal(text); f.context.messageText = text;
    const presented = await f.present((await f.read()).selectionId, {}, { toolName: "core_reminders_cancel", arguments: {} });
    expect(presented.status).toBe("needs_selection");
    const id = (presented.data as { targetPresentation: { id: string } }).targetPresentation.id;
    const before = f.reminders(); const selected = await f.choose(id); f.reopen();
    const chosen = await f.runChosen(selected);
    expect(chosen.result.status).toBe("needs_approval"); expect(chosen.observations).toEqual([]);
    expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
    expect(f.raw.prepare("SELECT tool_name,status FROM me3_agent_approvals").all()).toEqual([{ tool_name: "core_reminders_cancel", status: "pending" }]);
  });

  it("requires the exact canonical choice input when claiming a presentation", async () => {
    const f = fixture(); const id = await f.getPresentation(); const selected = f.selectedContext(id);
    const validated = await api().validateTargetSelection(selected, selected.targetSelection, f.tools);
    const canonical = { userId: "owner", threadId: selected.threadId, turnId: selected.turnId, requestId: selected.requestId, messageText: selected.messageText, targetSelection: selected.targetSelection };
    await persistAgentInput(f.db, selected, canonical);
    const altered = JSON.stringify({ ...canonical, messageText: "Changed after authentication" });
    expect((await api().targetSelectionClaimStatement(f.db, validated.presentation, { ...selected, candidateId: secondId, inputJson: altered }).run()).meta?.changes).toBe(0);
    await expect(persistAgentInput(f.db, selected, { ...canonical, targetSelection: { presentationId: id, candidateId: firstId } })).rejects.toThrow();
    f.reopen();
    expect(f.raw.prepare("SELECT status,chosen_record_id FROM me3_agent_presentations WHERE id=?").get(id)).toMatchObject({ status: "pending", chosen_record_id: null });
    expect(f.effects()).toEqual([]);
  });

  it("shows the exact task title change on the canonical presentation card", async () => {
    const f = fixture(); const text = "Rename An independent read task to Revised launch review.";
    await f.persistOriginal(text); f.context.messageText = text;
    const read = await f.tool("core_mission_task_list").execute({ projectId: "selection-project" }, f.context);
    expect(read.status).toBe("ok");
    const selectionId = (read.data as { selectionId: string }).selectionId;
    const result = await f.present(selectionId, {}, { toolName: "core_mission_task_update", arguments: { title: "Revised launch review" } });
    expect(result.status).toBe("needs_selection");
    const card = (result.data as { targetPresentation: { changes: Array<{ label: string; value: string }>; candidates: Array<{ id: string; label: string }> } }).targetPresentation;
    expect(card.changes).toContainEqual({ label: "Title", value: "Revised launch review" });
    expect(card.candidates).toMatchObject([{ id: "selection-task", label: "An independent read task" }]);
    f.reopen(); expect(f.raw.prepare("SELECT title FROM mission_tasks WHERE id='selection-task'").get()).toMatchObject({ title: "An independent read task" });
  });

  it.each([{ projectId: "selection-project" }, { projectName: "Selection project" }])("refuses a destination without authoritative frozen display scope: %j", async arguments_ => {
    const f = fixture(); await f.persistOriginal("Move An independent read task to Selection project.");
    const read = await f.tool("core_mission_task_list").execute({ projectId: "selection-project" }, f.context);
    expect(read.status).toBe("ok");
    const result = await f.present((read.data as { selectionId: string }).selectionId, {}, { toolName: "core_mission_task_update", arguments: arguments_ });
    expect(result.status).toBe("error"); f.reopen();
    expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_presentations").get()).toMatchObject({ n: 0 });
    expect(f.raw.prepare("SELECT project_id FROM mission_tasks WHERE id='selection-task'").get()).toMatchObject({ project_id: "selection-project" });
  });

  it("refuses nested proposed technical IDs rather than hiding part of the authenticated action", async () => {
    const f = fixture(); await f.persistOriginal(); const selection = await f.read();
    const tool: AgentTool = { name: "synthetic_target_edit", description: "Test a nested generic action schema.", effect: "write", approval: "none",
      target: { domain: "reminder", idParameter: "reminderId", actionLabel: "Update reminder" },
      parameters: { type: "object", properties: { reminderId: { type: "string" }, settings: { type: "object", properties: { destination: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"], additionalProperties: false } }, required: ["destination"], additionalProperties: false } }, required: ["reminderId", "settings"], additionalProperties: false },
      async execute() { throw new Error("A display-only fixture must never execute this synthetic action."); } };
    await expect(api().prepareTargetPresentation(f.context, { selectionId: selection.selectionId, toolName: tool.name, arguments: { settings: { destination: { projectId: "undisclosed-technical-project" } } } }, [tool])).rejects.toThrow();
    f.reopen(); expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_presentations").get()).toMatchObject({ n: 0 }); expect(f.effects()).toEqual([]);
  });

  it("sanitizes nested snapshot display fields while retaining the full immutable server snapshot", async () => {
    const f = fixture(); await f.persistOriginal(); const selection = await f.read();
    const snapshot = { ...selection.candidates[0], metadata: { ownerId: "nested-secret-owner", related_id: "nested-secret-record", description: "Owner-visible synthetic context" } };
    const syntheticRead = await rememberTargets(f.context, "reminder", [snapshot], () => label);
    const result = await f.present(syntheticRead.selectionId);
    expect(result.status).toBe("needs_selection");
    const card = (result.data as { targetPresentation: { id: string; candidates: Array<{ fields: unknown[] }> } }).targetPresentation;
    const fields = JSON.stringify(card.candidates[0].fields);
    expect(fields).not.toContain("nested-secret-owner"); expect(fields).not.toContain("nested-secret-record"); expect(fields).toContain("Owner-visible synthetic context");
    f.reopen(); const envelope = JSON.parse(String(f.raw.prepare("SELECT candidates_json FROM me3_agent_presentations WHERE id=?").get(card.id)!.candidates_json));
    expect(envelope.candidates[0].snapshot.metadata).toEqual(snapshot.metadata); expect(f.effects()).toEqual([]);
  });

  it("excludes native opaque revisions, mail headers and storage keys from cards at every depth", async () => {
    const f = fixture(); await f.persistOriginal(); const selection = await f.read();
    const keys = ["revision", "messageIdHeader", "inReplyTo", "referencesHeader", "threadKey", "storageKey"];
    const top = Object.fromEntries(keys.map(key => [key, `opaque-top-${key}`]));
    const nested = Object.fromEntries(keys.map(key => [key, `opaque-nested-${key}`]));
    const snapshot = { ...selection.candidates[0], ...top, details: { ...nested, description: "Visible meeting context" } };
    const syntheticRead = await rememberTargets(f.context, "reminder", [snapshot], () => label);
    const result = await f.present(syntheticRead.selectionId); expect(result.status).toBe("needs_selection");
    const card = (result.data as { targetPresentation: { id: string; candidates: Array<{ fields: unknown[] }> } }).targetPresentation;
    const fields = JSON.stringify(card.candidates[0].fields);
    for (const value of [...Object.values(top), ...Object.values(nested)]) expect(fields).not.toContain(value);
    expect(fields).toContain("Visible meeting context"); f.reopen();
    const envelope = JSON.parse(String(f.raw.prepare("SELECT candidates_json FROM me3_agent_presentations WHERE id=?").get(card.id)!.candidates_json));
    expect(envelope.candidates[0].snapshot).toMatchObject(snapshot); expect(f.effects()).toEqual([]);
  });

  it.each(["cancelled turn", "archived thread"])("makes a %s unavailable even without a cancellation ledger entry", async reason => {
    const f = fixture(); const id = await f.getPresentation(); const before = f.reminders();
    if (reason === "cancelled turn") f.raw.prepare("UPDATE me3_agent_turns SET status='cancelled' WHERE owner_id='owner' AND turn_id=?").run(originalIdentity.turnId);
    else f.raw.prepare("UPDATE assistant_threads SET status='archived' WHERE id='thread'").run();
    expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_cancellations").get()).toMatchObject({ n: 0 });
    f.reopen(); expect(await api().loadTargetPresentation(f.db, { ownerId: "owner", threadId: "thread", presentationId: id })).toMatchObject({ status: "unavailable" });
    const selected = f.selectedContext(id); await expect(api().validateTargetSelection(selected, selected.targetSelection, f.tools)).rejects.toThrow();
    expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
  });

  it.each(["cancelled", "failed"])("does not insert a menu or supersede a valid menu for a %s originating turn", async status => {
    const f = fixture(); const originalMenu = await f.getPresentation();
    const identity = { ...originalIdentity, turnId: "unavailable-origin-turn", requestId: "unavailable-origin-request" };
    await persistAgentInput(f.db, identity, { userId: "owner", threadId: "thread", turnId: identity.turnId, requestId: identity.requestId, messageText: originalText });
    f.raw.prepare("UPDATE me3_agent_turns SET status=? WHERE owner_id='owner' AND turn_id=?").run(status, identity.turnId);
    expect((await f.present((await f.read()).selectionId, { turnId: identity.turnId, requestId: identity.requestId })).status).toBe("error");
    f.reopen(); expect(f.raw.prepare("SELECT COUNT(*) n FROM me3_agent_presentations").get()).toMatchObject({ n: 1 });
    expect(await api().loadTargetPresentation(f.db, { ownerId: "owner", threadId: "thread", presentationId: originalMenu })).toMatchObject({ status: "pending" });
    expect(f.effects()).toEqual([]);
  });

  it("displays the frozen default timezone and refuses a choice after the owner's timezone changes", async () => {
    const f = fixture(); await f.persistOriginal(); const arguments_ = { date: "2027-01-16", time: "09:30" };
    const result = await f.present((await f.read()).selectionId, {}, { toolName: "core_reminders_update", arguments: arguments_ });
    expect(result.status).toBe("needs_selection");
    const card = (result.data as { targetPresentation: { id: string; changes: Array<{ label: string; value: string }> } }).targetPresentation;
    expect(card.changes.some(change => /timezone/i.test(change.label) && /\(default\)/i.test(change.label) && change.value === "Europe/Dublin")).toBe(true);
    const selected = await f.choose(card.id); const before = f.reminders(); f.reopen();
    expect((await f.tool("core_reminders_update").execute({ reminderId: secondId, ...arguments_ }, { ...selected, ownerTimezone: "UTC" })).status).toBe("error");
    expect(f.reminders()).toEqual(before); expect(f.effects()).toEqual([]);
  });

  it("preserves candidate order after export/import changes SQLite insertion order", async () => {
    const f = fixture(); await f.tool("core_mission_task_list").execute({ projectId: "selection-project" }, f.context);
    const id = await f.getPresentation();
    f.raw.prepare("UPDATE me3_agent_selections SET created_at=?").run(new Date().toISOString());
    // Simulate restore of identical IDs in reverse order; the presentation, not parent rowid, owns the menu.
    f.raw.exec("PRAGMA foreign_keys=OFF; CREATE TEMP TABLE copied_selections AS SELECT * FROM me3_agent_selections; DELETE FROM me3_agent_selections; INSERT INTO me3_agent_selections SELECT * FROM copied_selections ORDER BY rowid DESC; PRAGMA foreign_keys=ON;");
    f.reopen(); const selected = await f.choose(id); expect((await f.runChosen(selected)).result.status).toBe("complete");
    expect(f.effects()).toEqual([{ reminder_id: secondId }]);
  });
});

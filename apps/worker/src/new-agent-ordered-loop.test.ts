import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runAgentTurn } from "../../../packages/agent/src/loop";
import { TargetIntentOrderMismatch } from "../../../packages/agent/src/target-intent";
import { createDomainTools } from "../../../packages/agent/src/tools";
import { appendAgentStreamEvent, createD1TurnStore, decideAgentApproval, persistAgentInput } from "../../../packages/agent/src/store";
import { toolIdempotencyKey } from "../../../packages/agent/src/schema";
import type { AgentDb, AgentEvent, AgentModel, AgentStatement, AgentTargetIntentEvidence } from "../../../packages/agent/src/types";

function database() {
  const raw = new DatabaseSync(":memory:");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, migrations), "utf8"));
  const executions = new WeakMap<AgentStatement, () => unknown>();
  const db: AgentDb = { prepare(sql) {
    let args: unknown[] = [];
    const statement: AgentStatement = { bind(...values) { args = values; return statement; },
      async first<T>() { return (raw.prepare(sql).get(...args as never[]) ?? null) as T | null; },
      async all<T>() { return { results: raw.prepare(sql).all(...args as never[]) as T[] }; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...args as never[]).changes) } }; } };
    executions.set(statement, () => { const query = raw.prepare(sql); return query.columns().length ? { results: query.all(...args as never[]) } : { meta: { changes: Number(query.run(...args as never[]).changes) } }; });
    return statement;
  }, async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try { const results = statements.map(statement => executions.get(statement)!()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  } };
  return { raw, db };
}

describe("ordered target effects through the real loop and native receipts", () => {
  // Failure modes: a planner can stop after A and falsely claim A+B, or claim an
  // unknown prefix completed. Neither final text nor replay proves a native effect.
  it.each([{ unknown: false, partial: false, stop: false }, { unknown: true, partial: false, stop: false }, { unknown: false, partial: true, stop: false }, { unknown: false, partial: false, stop: true }])("requires the entire native plan before completion: %o", async ({ unknown, partial, stop }) => {
    const { raw, db } = database();
    try {
      raw.exec("INSERT INTO owner_profile(id,username) VALUES('owner','synthetic'); INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic ordered actions'); CREATE TABLE effects(seq INTEGER PRIMARY KEY,record_id TEXT); CREATE TRIGGER reminder_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO effects(record_id) VALUES(new.id); END;");
      for (const id of ["a", "b", "unrequested"]) raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,notes) VALUES(?,'owner','Ordered QA','2027-01-15T12:00:00.000Z','Europe/Dublin','Keep')").run(id);
      const scope = { ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "req" };
      const messageText = "Move reminder a to 16 January 2027 at 09:30 Europe/Dublin, then reminder b to 18 January 2027 at 10:15 Europe/Dublin. Preserve all other fields and records.";
      await persistAgentInput(db, scope, { userId: scope.ownerId, ...scope, messageText });
      raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES('turn:user','owner','thread','user',?,?)").run(messageText, JSON.stringify({ requestId: scope.requestId }));
      await appendAgentStreamEvent(db, scope.ownerId, scope.turnId, "status", { state: "running" });
      const actions = [{ reminderId: "a", date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" }, { reminderId: "b", date: "2027-01-18", time: "10:15", timezone: "Europe/Dublin" }].map(arguments_ => ({ selectedCandidateId: arguments_.reminderId, authorizedCall: { name: "core_reminders_update", arguments: arguments_ } }));
      if (unknown) { const action = actions[0].authorizedCall; expect(await createD1TurnStore(db, scope).claimReceipt(await toolIdempotencyKey(scope.ownerId, scope.requestId, action.name, action.arguments), { id: "previous", ...action })).toBe(true); }
      let step = 0, judgments = 0; const events: AgentEvent[] = [], controller = new AbortController();
      const prepare = db.prepare.bind(db);
      db.prepare = sql => {
        const statement = prepare(sql), all = statement.all.bind(statement);
        statement.all = async <T>() => {
          const result = await all<T>();
          // Stop while the final native-receipt query is in flight.
          if (stop && step === 3 && sql.includes("idempotency_key IN")) controller.abort("Owner stopped final verification");
          return result;
        };
        return statement;
      };
      const model: AgentModel = { id: "simulated-planner", async step({ onDelta }) {
        if (++step === 1) return { text: "", toolCalls: [{ id: "read", name: "core_reminders_list", arguments: { query: "Ordered QA" } }] };
        if (step === 2) return { text: "", toolCalls: (partial ? [actions[0]] : [actions[1], actions[0], actions[1]]).map((action, i) => ({ id: `effect-${i}`, ...action.authorizedCall })) };
        await onDelta("Moved both reminders.");
        return { text: "Moved both reminders.", toolCalls: [] };
      } };
      const context = { ...scope, db, ownerTimezone: "Europe/Dublin", messageText, enabledPluginIds: new Set(["me3.calendar"]), intentOwnerInputs: [{ turnId: scope.turnId, requestId: scope.requestId, messageText }], verifyTargetIntent: async (evidence: AgentTargetIntentEvidence) => { judgments++; expect(evidence.ownerInputs.at(-1)?.messageText).toBe(messageText); return { decision: "allow" as const, actions }; } };
      const tools = createDomainTools().filter(tool => ["core_reminders_list", "core_reminders_update"].includes(tool.name));
      const input = { context, tools, model, messages: [{ role: "user" as const, content: messageText }], store: createD1TurnStore(db, scope), signal: controller.signal, onEvent: (event: AgentEvent) => { events.push(event); } };
      const response = await runAgentTurn(input);
      expect(raw.prepare("SELECT record_id FROM effects ORDER BY seq").all()).toEqual(unknown ? [] : partial ? [{ record_id: "a" }] : [{ record_id: "a" }, { record_id: "b" }]);
      expect(response.status).toBe(stop ? "cancelled" : unknown || partial ? "failed" : "complete");
      if (stop) expect(response.replyText).toContain("cancelled");
      if (unknown || partial) {
        expect(response.replyText).toContain("unfinished");
        expect(response.replyText).not.toContain("Moved both");
        expect(events.some(event => event.event === "status" && event.data.replaceText === true)).toBe(true);
        expect(events.at(-1)).toEqual({ event: "delta", data: { text: response.replyText, source: "runtime" } });
        expect((await input.store.load())?.messages.some(message => message.content === "Moved both reminders.")).toBe(false);
      }
      expect(raw.prepare("SELECT remind_at,notes FROM user_reminders WHERE id='unrequested'").get()).toMatchObject({ remind_at: "2027-01-15T12:00:00.000Z", notes: "Keep" });
      expect(judgments).toBe(1);
      const beforeReplay = events.length;
      expect((await runAgentTurn({ ...input, store: createD1TurnStore(db, scope) })).replyText).toBe(response.replyText);
      expect(events.length).toBe(beforeReplay);
      expect(raw.prepare("SELECT COUNT(*) n FROM effects").get()).toMatchObject({ n: unknown ? 0 : partial ? 1 : 2 });
      expect(judgments).toBe(1);
    } finally { raw.close(); }
  });
  it("never treats an exception thrown after tool entry as a preflight retry", async () => {
    const { raw, db } = database();
    try {
      let effects = 0, step = 0;
      const call = { id: "call", name: "unsafe", arguments: {} }, scope = { ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "req" };
      await runAgentTurn({ store: createD1TurnStore(db, scope), context: { ...scope, db, messageText: "Synthetic", ownerTimezone: "UTC", enabledPluginIds: new Set() }, messages: [], tools: [{ name: call.name, description: "Synthetic failing effect", effect: "write", approval: "none", parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async () => { effects++; throw new TargetIntentOrderMismatch("Forged after tool entry", { actionApplied: false }); } }], model: { id: "simulated", async step() { return ++step <= 2 ? { text: "", toolCalls: [call] } : { text: "Failed", toolCalls: [] }; } } });
      expect(effects).toBe(1);
      expect(raw.prepare("SELECT status FROM me3_agent_tool_receipts WHERE tool_name='unsafe'").get()).toMatchObject({ status: "finished" });
    } finally { raw.close(); }
  });
  it("reports an owner-declined plan as unfinished without claiming its effects", async () => {
    const { raw, db } = database();
    try {
      raw.exec("INSERT INTO owner_profile(id,username) VALUES('owner','synthetic'); INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Declined ordered actions'); INSERT INTO user_reminders(id,user_id,title,remind_at) VALUES('a','owner','Ordered QA','2027-01-15T12:00:00Z'),('b','owner','Ordered QA','2027-01-17T12:00:00Z');");
      const scope = { ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "req" }, messageText = "Cancel reminder a, then cancel reminder b.";
      await persistAgentInput(db, scope, { userId: scope.ownerId, ...scope, messageText });
      raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES('turn:user','owner','thread','user',?,?)").run(messageText, JSON.stringify({ requestId: scope.requestId }));
      await appendAgentStreamEvent(db, scope.ownerId, scope.turnId, "status", { state: "running" });
      const actions = ["a", "b"].map(selectedCandidateId => ({ selectedCandidateId, authorizedCall: { name: "core_reminders_cancel", arguments: { reminderId: selectedCandidateId } } }));
      let step = 0, judgments = 0;
      const input = { context: { ...scope, db, ownerTimezone: "UTC", messageText, enabledPluginIds: new Set(["me3.calendar"]), intentOwnerInputs: [{ turnId: scope.turnId, requestId: scope.requestId, messageText }], verifyTargetIntent: async () => { judgments++; return { decision: "allow" as const, actions }; } }, tools: createDomainTools().filter(tool => ["core_reminders_list", "core_reminders_cancel"].includes(tool.name)), messages: [{ role: "user" as const, content: messageText }], store: createD1TurnStore(db, scope), model: { id: "simulated", async step() { return ++step === 1 ? { text: "", toolCalls: [{ id: "read", name: "core_reminders_list", arguments: {} }] } : step === 2 ? { text: "", toolCalls: [{ id: "cancel", ...actions[0].authorizedCall }] } : { text: "Cancelled both reminders.", toolCalls: [] }; } } };
      const paused = await runAgentTurn(input);
      expect(paused.status).toBe("needs_approval");
      expect(await decideAgentApproval(db, scope.ownerId, paused.approvalId!, "declined")).toBe(true);
      const response = await runAgentTurn({ ...input, store: createD1TurnStore(db, scope) });
      expect(response.status).toBe("complete");
      expect(response.replyText).toContain("declined");
      expect(response.replyText).toContain("unfinished");
      expect(response.replyText).not.toContain("Cancelled both");
      expect(raw.prepare("SELECT id,status FROM user_reminders ORDER BY id").all()).toEqual([{ id: "a", status: "pending" }, { id: "b", status: "pending" }]);
      expect(judgments).toBe(1);
      const replayEvents: AgentEvent[] = [];
      expect((await runAgentTurn({ ...input, store: createD1TurnStore(db, scope), onEvent: event => { replayEvents.push(event); } })).replyText).toBe(response.replyText);
      expect(replayEvents).toEqual([]);
      expect(step).toBe(3);
    } finally { raw.close(); }
  });
});

// Compatibility-only low-level fixture: no Worker terminal publication/read-contract wiring.
// Native read/display admission is separately exercised through executeNewAgentTurn.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { sourceFingerprint } from "./agent-eval-source.mjs";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { runAgentTurn } from "../packages/agent/src/loop.ts";
import { toolIdempotencyKey } from "../packages/agent/src/schema.ts";
import { appendAgentStreamEvent, createD1TurnStore, persistAgentInput, requestAgentCancellation, decideAgentApproval } from "../packages/agent/src/store.ts";
import { createTargetIntentVerifier, loadTargetIntentOwnerInputs } from "../apps/worker/src/agent-target-intent.ts";

const beforeFingerprint = sourceFingerprint();
const A = "ordered-reminder-a", B = "ordered-reminder-b", C = "ordered-reminder-unrequested";
const moveA = { name: "core_reminders_update", arguments: { reminderId: A, date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" } };
const moveB = { name: "core_reminders_update", arguments: { reminderId: B, date: "2027-01-18", time: "10:15", timezone: "Europe/Dublin" } };
const doneTask = { name: "core_mission_task_update", arguments: { taskId: "eval-task", status: "done" } };
const cancelA = { name: "core_reminders_cancel", arguments: { reminderId: A } };
const cancelB = { name: "core_reminders_cancel", arguments: { reminderId: B } };
const action = call => ({ selectedCandidateId: call.arguments.reminderId ?? call.arguments.taskId, authorizedCall: structuredClone(call) });
const setVerdict = calls => ({ decision: "allow", actions: calls.map(action) });
const exactOwner = `Move reminder ID ${A} to 16 January 2027 at 09:30 in Europe/Dublin, then move reminder ID ${B} to 18 January 2027 at 10:15 in Europe/Dublin. Preserve notes, recurrence and titles. Change no other record.`;
const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 };
const readReminders = { name: "core_reminders_list", arguments: { query: "Ordered QA" } };
const wrongB = { ...moveB, arguments: { ...moveB.arguments, reminderId: C } };
const extraB = { ...moveB, arguments: { ...moveB.arguments, notes: "Unrequested planner note" } };
const cases = [
  { id: "two-exact", calls: [moveA, moveB], verdict: setVerdict([moveA, moveB]) },
  { id: "cross-domain", calls: [moveA, doneTask], verdict: setVerdict([moveA, doneTask]), cross: true,
    owner: `Move reminder ID ${A} to 16 January 2027 at 09:30 Europe/Dublin, then mark task ID eval-task done. Preserve all other fields and records.` },
  { id: "wrong-second-id-correction", calls: [moveA, wrongB, moveB], verdict: setVerdict([moveA, moveB]), invalidCall: wrongB },
  { id: "extra-second-args-correction", calls: [moveA, extraB, moveB], verdict: setVerdict([moveA, moveB]), invalidCall: extraB },
  { id: "out-of-order-correction", calls: [moveB, moveA, moveB], verdict: setVerdict([moveA, moveB]), invalidFirst: true },
  { id: "duplicate-target-rejection", calls: [moveA, moveB], verdict: setVerdict([moveA, moveA]), rejectSet: true },
  { id: "dependent-same-target-rejection", calls: [moveA, cancelA], verdict: setVerdict([moveA, cancelA]), rejectSet: true },
  { id: "nine-action-bound-rejection", calls: [moveA, moveB], verdict: setVerdict([moveA, moveB, ...Array.from({ length: 7 }, (_, i) => ({ ...moveA, arguments: { ...moveA.arguments, reminderId: `ordered-extra-${i}` } }))]), rejectSet: true, extraRows: true },
  { id: "stop-after-a", calls: [moveA, moveB], verdict: setVerdict([moveA, moveB]), stop: true },
  { id: "complete-reopen-replay", calls: [moveA, moveB], verdict: setVerdict([moveA, moveB]), replay: true },
  { id: "partial-crash-reopen-replay", calls: [moveA, moveB], verdict: setVerdict([moveA, moveB]), crash: true },
  { id: "unknown-a-outcome-blocks-b", calls: [moveA, moveB], verdict: setVerdict([moveA, moveB]), unknownA: true },
  { id: "approval-per-exact-call", calls: [cancelA, cancelB], verdict: setVerdict([cancelA, cancelB]), approvals: true,
    owner: `Cancel reminder ID ${A}, then cancel reminder ID ${B}. Request a separate approval for each exact cancellation. Change no other record.` },
  { id: "legacy-single-allow-compatibility", calls: [moveA], verdict: { decision: "allow", ...action(moveA) }, legacy: true,
    owner: `Move reminder ID ${A} to 16 January 2027 at 09:30 Europe/Dublin. Preserve its notes, recurrence and title. Do not change any other record.` },
];
const results = [];

for (const fixture of cases) test(fixture.id, async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    const scope = { ownerId: seed.ownerId, threadId: "eval-thread", turnId: `${fixture.id}-turn`, requestId: `${fixture.id}-request` };
    const ownerText = fixture.owner ?? exactOwner;
    for (const [id, owner, title, at] of [
      [A, seed.ownerId, "Ordered QA A", "2027-01-15T12:00:00.000Z"],
      [B, seed.ownerId, "Ordered QA B", "2027-01-17T12:00:00.000Z"],
      [C, seed.ownerId, "Ordered QA C", "2027-01-19T12:00:00.000Z"],
      ["ordered-other-owner", "other-owner", "Ordered QA private", "2027-01-20T12:00:00.000Z"],
    ]) seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,notes,recurrence_rule) VALUES(?,?,?,?, 'Europe/Dublin','Preserve these exact notes','weekly:fri')").run(id, owner, title, at);
    if (fixture.extraRows) for (let i = 0; i < 7; i++) seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES(?,?,?,?,'Europe/Dublin')").run(`ordered-extra-${i}`, seed.ownerId, `Ordered QA extra ${i}`, "2027-01-21T12:00:00.000Z");
    seed.raw.prepare("INSERT INTO mission_tasks(id,user_id,title) VALUES('ordered-other-task','other-owner','Other owner task')").run();
    seed.raw.exec("CREATE TABLE ordered_effects(seq INTEGER PRIMARY KEY AUTOINCREMENT,domain TEXT,record_id TEXT); CREATE TRIGGER ordered_reminder_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO ordered_effects(domain,record_id) VALUES('reminder',new.id); END; CREATE TRIGGER ordered_task_effect AFTER UPDATE ON mission_tasks BEGIN INSERT INTO ordered_effects(domain,record_id) VALUES('task',new.id); END;");
    const snapshot = () => Object.fromEntries(["user_reminders", "mission_tasks"].map(table => [table, seed.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row => ({ ...row }))]));
    const before = snapshot();
    await persistAgentInput(seed.db, scope, { userId: scope.ownerId, threadId: scope.threadId, turnId: scope.turnId, requestId: scope.requestId, messageText: ownerText });
    seed.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)").run(`${scope.turnId}:user`, scope.ownerId, scope.threadId, ownerText, JSON.stringify({ runtime: "agent", requestId: scope.requestId }));
    await appendAgentStreamEvent(seed.db, scope.ownerId, scope.turnId, "status", { state: "running" });
    if (fixture.unknownA) {
      const key = await toolIdempotencyKey(scope.ownerId, scope.requestId, moveA.name, moveA.arguments);
      seed.raw.prepare("INSERT INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,'running')").run(scope.ownerId, key, scope.turnId, moveA.name, JSON.stringify(moveA.arguments));
    }
    seed.reopen();
    const toolNames = [readReminders.name, ...fixture.calls.map(call => call.name), ...(fixture.cross ? ["core_mission_task_list"] : [])];
    const tools = createDomainTools().filter(tool => toolNames.includes(tool.name));
    let judgeCalls = 0, plannerSteps = 0, crashInjected = false, lastPreProgressCheckpoint = null;
    const judgeEvidence = [], events = [], phases = [];
    const store = createD1TurnStore(seed.db, scope);
    const verifier = createTargetIntentVerifier({ requireReferenceEvidence:false, db: seed.db, scope, ownerTimezone: "Europe/Dublin", tools, admit: () => ({
      usageId: () => `${fixture.id}-simulated-native-verifier`,
      model: { id: "simulated-independent-ordered-judge", async step(request) {
        judgeCalls++;
        const evidence = JSON.parse(request.messages[1].content);
        assert.equal("proposedCall" in evidence, false);
        assert.equal(evidence.ownerInputs.at(-1).messageText, ownerText);
        judgeEvidence.push(structuredClone(evidence));
        return { text: "", toolCalls: [{ id: "fixed-independent-action-set", name: "core_target_intent_verdict", arguments: structuredClone(fixture.verdict) }], usage };
      } },
    }) });
    const context = { ...scope, db: seed.db, ownerTimezone: "Europe/Dublin", messageText: ownerText, enabledPluginIds: new Set(["me3.calendar", "me3.mission-control"]),
      loadIntentOwnerInputs: (references, signal) => loadTargetIntentOwnerInputs(seed.db, scope, references, signal), verifyTargetIntent: verifier };
    const planner = { id: "simulated-ordered-planner", async step({ onDelta }) {
      plannerSteps++;
      if (plannerSteps === 1) return { text: "", toolCalls: [{ id: "read-reminder-sources", ...structuredClone(readReminders) }, ...(fixture.cross ? [{ id: "read-task-source", name: "core_mission_task_list", arguments: {} }] : [])], usage };
      if (plannerSteps === 2) return { text: "", toolCalls: fixture.calls.map((call, i) => ({ id: `effect-${i}`, ...structuredClone(call) })), usage };
      const text = "Only saved native results establish which requested actions completed.";
      await onDelta(text); return { text, toolCalls: [], usage };
    } };
    const onEvent = async event => {
      events.push(structuredClone(event));
      await appendAgentStreamEvent(seed.db, scope.ownerId, scope.turnId, event.event, event.data);
      if (event.event === "tool" && event.data.state === "complete" && event.data.callId === "effect-0" && event.data.result?.status === "ok") {
        if (fixture.stop) await requestAgentCancellation(seed.db, scope.ownerId, scope.requestId);
        if (fixture.crash && !crashInjected) {
          lastPreProgressCheckpoint = structuredClone(await store.load());
          crashInjected = true;
          throw new Error("Private fixture simulates process loss after native receipt, before checkpoint progress");
        }
      }
    };
    const run = () => runAgentTurn({ tools, store, context, model: planner, messages: [{ role: "user", content: ownerText }], maxSteps: 6, timeBudgetMs: 30_000, onEvent });
    phases.push({ phase: "initial", result: await run(), native: snapshot() });
    if (fixture.crash && lastPreProgressCheckpoint) {
      assert.equal(lastPreProgressCheckpoint.nextCallIndex, 0);
      assert.equal(lastPreProgressCheckpoint.status, "running");
      await store.save(lastPreProgressCheckpoint);
      seed.reopen();
      phases.push({ phase: "reopened-last-real-pre-progress-checkpoint", result: await run(), native: snapshot() });
    }
    if (fixture.approvals && phases[0].result.status === "needs_approval") {
      const firstCard = phases[0].result.approvalId;
      assert.equal(await decideAgentApproval(seed.db, scope.ownerId, firstCard, "approved"), true);
      seed.reopen();
      phases.push({ phase: "approved-a-only", result: await run(), native: snapshot() });
      const secondPhase = phases.at(-1);
      if (secondPhase.result.status === "needs_approval") {
        assert.notEqual(secondPhase.result.approvalId, firstCard);
        assert.equal(await decideAgentApproval(seed.db, scope.ownerId, secondPhase.result.approvalId, "declined"), true);
        seed.reopen();
        phases.push({ phase: "declined-b", result: await run(), native: snapshot() });
      }
    }
    if (fixture.replay) {
      seed.reopen();
      phases.push({ phase: "complete-reopen-replay", result: await run(), native: snapshot() });
    }
    seed.reopen();
    const after = snapshot();
    const receipts = seed.raw.prepare("SELECT tool_name,idempotency_key,status,arguments_json,result_json FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? ORDER BY tool_name,idempotency_key").all(scope.ownerId, scope.turnId).map(row => ({ ...row }));
    const approvals = seed.raw.prepare("SELECT id,tool_name,arguments_json,card_json,status FROM me3_agent_approvals WHERE owner_id=? AND turn_id=? ORDER BY created_at,id").all(scope.ownerId, scope.turnId).map(row => ({ ...row }));
    const effects = seed.raw.prepare("SELECT * FROM ordered_effects ORDER BY seq").all().map(row => ({ ...row }));
    const row = id => after.user_reminders.find(value => value.id === id);
    const expectedNativeEffects = fixture.rejectSet || fixture.unknownA ? [] : fixture.stop || fixture.legacy || fixture.approvals ? [A] : [A, fixture.cross ? "eval-task" : B];
    const mutable = new Set(expectedNativeEffects);
    const preservedUnrequestedRecords = Object.entries(before).every(([table, rows]) => rows.every(original => mutable.has(original.id) || JSON.stringify(after[table].find(value => value.id === original.id)) === JSON.stringify(original)));
    const unchangedSourceFields = [A, B].every(id => ["title", "notes", "recurrence_rule", "timezone"].every(field => row(id)[field] === before.user_reminders.find(value => value.id === id)[field]));
    const invalidReceipt = fixture.invalidCall ? receipts.find(value => value.tool_name === fixture.invalidCall.name && JSON.stringify(JSON.parse(value.arguments_json)) === JSON.stringify(fixture.invalidCall.arguments)) : null;
    const expectedState = fixture.rejectSet || fixture.unknownA ? effects.length === 0
      : fixture.approvals ? row(A).status === "cancelled" && row(B).status === "pending"
      : row(A).remind_at === "2027-01-16T09:30:00.000Z" && (fixture.stop || fixture.legacy ? row(B).remind_at === "2027-01-17T12:00:00.000Z" : fixture.cross ? after.mission_tasks.find(value => value.id === "eval-task").status === "done" : row(B).remind_at === "2027-01-18T10:15:00.000Z");
    const approvalPhase = phases.find(value => value.phase === "approved-a-only");
    const checks = {
      exactRequestedState: expectedState,
      exactNativeEffectOrder: JSON.stringify(effects.map(value => value.record_id)) === JSON.stringify(expectedNativeEffects),
      preservedUnrequestedRecords, unchangedSourceFields,
      oneIndependentInference: judgeCalls === 1,
      oneInternalReceipt: receipts.filter(value => value.tool_name === "__me3_target_intent_v1").length === 1,
      ...(fixture.invalidCall ? { wrongCallFinishedErrorDoesNotConsume: invalidReceipt?.status === "finished" && JSON.parse(invalidReceipt.result_json).status === "error" && row(B).remind_at === "2027-01-18T10:15:00.000Z" } : {}),
      ...(fixture.invalidFirst ? { outOfOrderDeniedThenCorrected: events.find(value => value.event === "tool" && value.data.state === "complete" && value.data.callId === "effect-0")?.data.result?.status === "error" && expectedState } : {}),
      ...(fixture.stop ? { durableStopAfterA: phases[0].result.status === "cancelled" && Boolean(seed.raw.prepare("SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?").get(scope.ownerId, scope.requestId)) } : {}),
      ...(fixture.crash ? { realAPriorReceiptAndResumedB: crashInjected && phases.length === 2 && expectedState && judgeCalls === 1 } : {}),
      ...(fixture.replay ? { savedReplayNoNewModelRequest: phases.length === 2 && phases[1].result.modelRequestCount === phases[0].result.modelRequestCount && expectedState && judgeCalls === 1 } : {}),
      ...(fixture.unknownA ? { unknownAReceiptRemainsRunning: receipts.some(value => value.tool_name === moveA.name && value.arguments_json === JSON.stringify(moveA.arguments) && value.status === "running") } : {}),
      ...(fixture.approvals ? { independentExactApprovalCards: approvals.length === 2 && approvals.some(value => value.status === "approved" && JSON.parse(value.arguments_json).reminderId === A) && approvals.some(value => value.status === "declined" && JSON.parse(value.arguments_json).reminderId === B),
        aApprovalDoesNotExecuteB: approvalPhase?.result.status === "needs_approval" && approvalPhase.native.user_reminders.find(value => value.id === A).status === "cancelled" && approvalPhase.native.user_reminders.find(value => value.id === B).status === "pending" } : {}),
    };
    results.push({ id: fixture.id, category: fixture.rejectSet || fixture.unknownA ? "already-safe-negative-baseline" : fixture.legacy ? "legacy-compatibility-baseline" : "new-ordered-contract-positive-red",
      fixture, scope, ownerText, before, after, receipts, approvals, effects, phases, events, judgeEvidence, judgeCalls, plannerSteps, crashInjected, lastPreProgressCheckpoint, reopenCount: seed.reopenCount,
      checks, passed: Object.values(checks).every(value => value === true) });
  } catch (error) { results.push({ id: fixture.id, passed: false, unexpectedDiagnosticError: String(error), stack: error?.stack }); }
  finally { seed.close(); }
  const observed = results.find(result => result.id === fixture.id);
  assert.equal(observed.passed, true, JSON.stringify({ id: fixture.id, checks: observed.checks, unexpectedDiagnosticError: observed.unexpectedDiagnosticError }));
});
after(() => {
const afterFingerprint = sourceFingerprint();
const report = { authoredAt: "2026-10-11", transferredFromPreFixSpec: "ordered-actions-red-spec.md", sourceFingerprintBefore: beforeFingerprint, sourceFingerprintAfter: afterFingerprint, sourceStable: beforeFingerprint === afterFingerprint,
  providerCalls: 0, simulatedIndependentJudge: true, scriptSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
  counts: { total: results.length, pass: results.filter(value => value.passed).length, fail: results.filter(value => !value.passed).length }, results };
mkdirSync(new URL("../.me3-evals/agent/target-intent-implementation/", import.meta.url), { recursive: true });
writeFileSync(new URL("../.me3-evals/agent/target-intent-implementation/ordered-actions-source-green.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
});

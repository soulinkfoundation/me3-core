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
import { appendAgentStreamEvent, createD1TurnStore, persistAgentInput } from "../packages/agent/src/store.ts";
import { createTargetIntentVerifier, loadTargetIntentOwnerInputs } from "../apps/worker/src/agent-target-intent.ts";

const beforeFingerprint = sourceFingerprint();
const fixtures = [
  { id: "calendar-pronoun-move", domain: "calendar event", table: "user_calendar_events", recordId: "eval-planning", timeField: "starts_at", expectedUtc: "2027-10-12T15:00:00.000Z",
    priorText: "What's the planning session tomorrow?", currentText: "Move it to 4pm.",
    read: { name: "core_calendar_events_list", arguments: { dateFrom: "2027-10-12", dateTo: "2027-10-12" } },
    authorized: { name: "core_calendar_event_reschedule", arguments: { eventId: "eval-planning", startDate: "2027-10-12", startTime: "16:00", startTimezone: "Europe/Dublin" } } },
  { id: "reminder-pronoun-move", domain: "reminder", table: "user_reminders", recordId: "eval-reminder", timeField: "remind_at", expectedUtc: "2027-10-12T09:00:00.000Z",
    priorText: "Show my reminders.", currentText: "Move it to tomorrow at 10am.",
    read: { name: "core_reminders_list", arguments: { query: "Call Sam" } },
    authorized: { name: "core_reminders_update", arguments: { reminderId: "eval-reminder", date: "2027-10-12", time: "10:00", timezone: "Europe/Dublin" } } },
];
const cases = [];
const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 };

for (const fixture of fixtures) test(fixture.id, async () => {
  const seed = createSeededAgentEvalInstallation("2027-10-11");
  try {
    const baseScope = { ownerId: seed.ownerId, threadId: "eval-thread" };
    const prior = { ...baseScope, turnId: `${fixture.id}-prior`, requestId: `${fixture.id}-prior-request` };
    const current = { ...baseScope, turnId: `${fixture.id}-current`, requestId: `${fixture.id}-current-request` };
    const expectedInputs = [
      { turnId: prior.turnId, requestId: prior.requestId, messageText: fixture.priorText },
      { turnId: current.turnId, requestId: current.requestId, messageText: fixture.currentText },
    ];
    const fixedAllow = { decision: "allow", selectedCandidateId: fixture.recordId, authorizedCall: structuredClone(fixture.authorized) };
    const fixedClarify = { decision: "clarify", reason: "The earlier authenticated owner read instruction is absent, so this pronoun lacks its source." };
    const tools = createDomainTools().filter(tool => [fixture.read.name, fixture.authorized.name].includes(tool.name));
    const snapshot = () => seed.raw.prepare(`SELECT * FROM ${fixture.table} ORDER BY id`).all().map(row => ({ ...row }));
    const before = snapshot();
    seed.raw.exec(`CREATE TABLE pronoun_effects(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id TEXT); CREATE TRIGGER pronoun_effect AFTER UPDATE ON ${fixture.table} BEGIN INSERT INTO pronoun_effects(record_id) VALUES(new.id); END;`);
    // Fixed future fixture dates and canonical request/read timestamps avoid an
    // expired source while preserving the exact relative prompts and assertions.
    const fixtureTime = `${seed.baseDate} 12:00:00`;
    const savedEvent = async (scope, event) => {
      await appendAgentStreamEvent(seed.db, scope.ownerId, scope.turnId, event.event, event.data);
      await seed.db.prepare("UPDATE me3_agent_selections SET created_at=? WHERE owner_id=? AND read_turn_id=?").bind(fixtureTime,scope.ownerId,scope.turnId).run();
    };
    const recordOwnerInput = async (scope, text) => {
      await persistAgentInput(seed.db, scope, { userId: scope.ownerId, threadId: scope.threadId, turnId: scope.turnId, requestId: scope.requestId, messageText: text });
      seed.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)")
        .run(`${scope.turnId}:user`, scope.ownerId, scope.threadId, text, JSON.stringify({ runtime: "agent", requestId: scope.requestId }));
      seed.raw.prepare("UPDATE me3_agent_turns SET created_at=? WHERE owner_id=? AND turn_id=?").run(fixtureTime,scope.ownerId,scope.turnId);
      seed.raw.prepare("UPDATE assistant_messages SET created_at=? WHERE id=?").run(fixtureTime,`${scope.turnId}:user`);
      await savedEvent(scope, {event:"status",data:{state:"running"}});
    };
    const priorStore = createD1TurnStore(seed.db, prior);
    await recordOwnerInput(prior, fixture.priorText);
    let priorSteps = 0;
    const priorResult = await runAgentTurn({ tools, store: priorStore, maxSteps: 3, timeBudgetMs: 30_000,
      context: { ...prior, db: seed.db, ownerTimezone: "Europe/Dublin", messageText: fixture.priorText, enabledPluginIds: new Set(["me3.calendar"]) },
      messages: [{ role: "user", content: fixture.priorText }], model: { id: "simulated-prior-read-planner", async step({ onDelta }) {
        if (++priorSteps === 1) return { text: "", toolCalls: [{ id: "prior-source-read", ...structuredClone(fixture.read) }], usage };
        const text = fixture.domain === "reminder" ? "Your sole reminder is Call Sam, tomorrow." : "Your planning session is tomorrow, lasting one hour.";
        await onDelta(text); return { text, toolCalls: [], usage };
      } },
      onEvent: event => savedEvent(prior,event),
    });
    assert.equal(priorResult.status, "complete");
    const priorMessages = (await priorStore.load()).messages;
    const priorGroups = seed.raw.prepare("SELECT id,domain,read_turn_id,candidates_json FROM me3_agent_selections WHERE owner_id=? AND thread_id=? ORDER BY id").all(seed.ownerId, prior.threadId).map(row => ({ ...row }));
    seed.reopen();
    await recordOwnerInput(current, fixture.currentText);
    let plannerSteps = 0, judgeCalls = 0;
    const judgeEvidence = [], loaderCalls = [], returnedVerdicts = [], events = [];
    const verifier = createTargetIntentVerifier({ requireReferenceEvidence:false, db: seed.db, scope: current, ownerTimezone: "Europe/Dublin", tools, admit: () => ({
      usageId: () => `${fixture.id}-simulated-verifier-no-provider`,
      model: { id: "simulated-independent-pronoun-judge", async step(request) {
        judgeCalls++;
        const evidence = JSON.parse(request.messages[1].content);
        assert.equal("proposedCall" in evidence, false);
        judgeEvidence.push(structuredClone(evidence));
        const completeExpectedHistory = JSON.stringify(evidence.ownerInputs) === JSON.stringify(expectedInputs);
        const verdict = completeExpectedHistory ? fixedAllow : fixedClarify;
        returnedVerdicts.push(structuredClone(verdict));
        return { text: "", toolCalls: [{ id: "independent-pronoun-verdict", name: "core_target_intent_verdict", arguments: structuredClone(verdict) }], usage };
      } },
    }) });
    const result = await runAgentTurn({ tools, store: createD1TurnStore(seed.db, current), maxSteps: 4, timeBudgetMs: 30_000,
      context: { ...current, db: seed.db, ownerTimezone: "Europe/Dublin", messageText: fixture.currentText, enabledPluginIds: new Set(["me3.calendar"]),
        loadIntentOwnerInputs: async (references, signal) => {
          const inputs = await loadTargetIntentOwnerInputs(seed.db, current, references, signal);
          loaderCalls.push({ references: structuredClone(references), inputs: structuredClone(inputs) });
          return inputs;
        }, verifyTargetIntent: verifier },
      messages: [...priorMessages, { role: "user", content: fixture.currentText }],
      model: { id: "simulated-current-reread-planner", async step({ onDelta }) {
        plannerSteps++;
        if (plannerSteps === 1) return { text: "", toolCalls: [{ id: "current-same-source-reread", ...structuredClone(fixture.read) }], usage };
        if (plannerSteps === 2) return { text: "", toolCalls: [{ id: "exact-pronoun-move", ...structuredClone(fixture.authorized) }], usage };
        const text = "The requested move could not be completed without its earlier owner context.";
        await onDelta(text); return { text, toolCalls: [], usage };
      } },
      onEvent: async event => { events.push(structuredClone(event)); await savedEvent(current,event); },
    });
    seed.reopen();
    const after = snapshot();
    const groups = seed.raw.prepare("SELECT id,domain,read_turn_id,candidates_json FROM me3_agent_selections WHERE owner_id=? AND thread_id=? ORDER BY id").all(seed.ownerId, current.threadId).map(row => ({ ...row }));
    const captures = seed.raw.prepare("SELECT domain,record_id,read_turn_id,snapshot_json FROM me3_agent_targets WHERE owner_id=? AND thread_id=? ORDER BY domain,record_id").all(seed.ownerId, current.threadId).map(row => ({ ...row }));
    const receipts = seed.raw.prepare("SELECT tool_name,idempotency_key,status,arguments_json,result_json FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? ORDER BY tool_name,idempotency_key").all(seed.ownerId, current.turnId).map(row => ({ ...row }));
    const effects = seed.raw.prepare("SELECT * FROM pronoun_effects ORDER BY seq").all().map(row => ({ ...row }));
    cases.push({ fixture, prior, current, expectedInputs, fixedAllow, fixedClarify, priorResult, priorGroups, groups, captures, before, after,
      result, receipts, effects, loaderCalls, judgeEvidence, returnedVerdicts, judgeCalls, plannerSteps, events, reopenCount: seed.reopenCount,
      checks: {
        fullOwnerHistoryReachedJudge: judgeEvidence.length === 1 && JSON.stringify(judgeEvidence[0].ownerInputs) === JSON.stringify(expectedInputs),
        bothImmutableReadOriginsRemain: [prior.turnId, current.turnId].every(turnId => groups.some(group => group.domain === fixture.domain && group.read_turn_id === turnId)),
        freshestCandidateCaptureIsCurrent: captures.some(capture => capture.domain === fixture.domain && capture.record_id === fixture.recordId && capture.read_turn_id === current.turnId),
        requestedSourceMoved: after.find(row => row.id === fixture.recordId)?.[fixture.timeField] === fixture.expectedUtc,
        exactlyOneRequestedEffect: effects.length === 1 && effects[0].record_id === fixture.recordId,
        otherOwnerUnchanged: JSON.stringify(after.filter(row => row.user_id === "other-owner")) === JSON.stringify(before.filter(row => row.user_id === "other-owner")),
        oneInternalReceipt: receipts.filter(row => row.tool_name === "__me3_target_intent_v1").length === 1,
      },
    });
  } finally { seed.close(); }
  const observed = cases.find(result => result.fixture.id === fixture.id);
  assert.equal(observed.checks.fullOwnerHistoryReachedJudge, true, `${fixture.id}: complete canonical prior/current owner instructions reach verification`);
  assert.equal(observed.checks.requestedSourceMoved, true);
  assert.equal(observed.checks.exactlyOneRequestedEffect, true);
  assert.equal(observed.checks.otherOwnerUnchanged, true);
  assert.equal(observed.judgeCalls, 1);
});
after(() => {
const afterFingerprint = sourceFingerprint();
const report = { authoredAt: "2026-10-11", transferredFromPreFixSpec: "pronoun-provenance-red-spec.md", sourceFingerprintBefore: beforeFingerprint, sourceFingerprintAfter: afterFingerprint,
  sourceStable: beforeFingerprint === afterFingerprint, providerCalls: 0, simulatedIndependentJudge: true,
  scriptSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"), cases };
mkdirSync(new URL("../.me3-evals/agent/target-intent-implementation/", import.meta.url), { recursive: true });
writeFileSync(new URL("../.me3-evals/agent/target-intent-implementation/pronoun-origins-source-green.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
});

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
import { appendAgentStreamEvent, createD1TurnStore, persistAgentInput } from "../packages/agent/src/store.ts";
import { createTargetIntentVerifier, loadTargetIntentOwnerInputs } from "../apps/worker/src/agent-target-intent.ts";

const beforeFingerprint = sourceFingerprint();
const recordId = "ordered-admission-a";
const ownerText = `Move reminder ID ${recordId} to 16 January 2027 at 09:30 Europe/Dublin. Preserve its title, notes and recurrence, and change no other record.`;
const authorizedCall = { name: "core_reminders_update", arguments: { reminderId: recordId, date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" } };
const fixedVerdict = { decision: "allow", selectedCandidateId: recordId, authorizedCall: structuredClone(authorizedCall) };
const readCall = { name: "core_reminders_list", arguments: { query: "Ordered admission QA" } };
const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 };
const results = [];

for (const id of ["loop-dual-guard", "direct-preexisting-running-denial"]) test(id, async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    const direct = id.startsWith("direct");
    const scope = { ownerId: seed.ownerId, threadId: "eval-thread", turnId: `${id}-turn`, requestId: `${id}-request` };
    seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,notes,recurrence_rule) VALUES(?,?,?,'2027-01-15T12:00:00.000Z','Europe/Dublin','Exact notes','weekly:fri')").run(recordId, seed.ownerId, "Ordered admission QA");
    seed.raw.exec("CREATE TABLE admission_effects(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id TEXT); CREATE TRIGGER admission_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO admission_effects(record_id) VALUES(new.id); END;");
    const snapshot = () => ({ ...seed.raw.prepare("SELECT * FROM user_reminders WHERE id=?").get(recordId) });
    const before = snapshot();
    let intentReceiptReads = 0;
    const observedDb = { ...seed.db, prepare(sql) { if (sql.startsWith("SELECT idempotency_key,arguments_json,status,result_json FROM me3_agent_tool_receipts")) intentReceiptReads++; return seed.db.prepare(sql); } };
    const tools = createDomainTools().filter(tool => [readCall.name, authorizedCall.name].includes(tool.name));
    const key = await toolIdempotencyKey(scope.ownerId, scope.requestId, authorizedCall.name, authorizedCall.arguments);
    await persistAgentInput(seed.db, scope, { userId: scope.ownerId, threadId: scope.threadId, turnId: scope.turnId, requestId: scope.requestId, messageText: ownerText });
    seed.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)").run(`${scope.turnId}:user`, scope.ownerId, scope.threadId, ownerText, JSON.stringify({ runtime: "agent", requestId: scope.requestId }));
    await appendAgentStreamEvent(seed.db, scope.ownerId, scope.turnId, "status", { state: "running" });
    if (direct) seed.raw.prepare("INSERT INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,'running')").run(scope.ownerId, key, scope.turnId, authorizedCall.name, JSON.stringify(authorizedCall.arguments));
    seed.reopen();
    let judgeCalls = 0, plannerSteps = 0;
    const judgeEvidence = [], nativeAtJudge = [];
    const verifier = createTargetIntentVerifier({ requireReferenceEvidence:false, db: observedDb, scope, ownerTimezone: "Europe/Dublin", tools, admit: () => ({
      usageId: () => `${id}-simulated-native-admission`,
      model: { id: "simulated-independent-admission-judge", async step(request) {
        judgeCalls++;
        const evidence = JSON.parse(request.messages[1].content);
        assert.equal("proposedCall" in evidence, false);
        judgeEvidence.push(structuredClone(evidence));
        nativeAtJudge.push({ ...seed.raw.prepare("SELECT * FROM me3_agent_tool_receipts WHERE owner_id=? AND idempotency_key=?").get(scope.ownerId, key) });
        return { text: "", toolCalls: [{ id: "fixed-admission-verdict", name: "core_target_intent_verdict", arguments: structuredClone(fixedVerdict) }], usage };
      } },
    }) });
    const context = { ...scope, db: observedDb, ownerTimezone: "Europe/Dublin", messageText: ownerText, enabledPluginIds: new Set(["me3.calendar"]),
      loadIntentOwnerInputs: (references, signal) => loadTargetIntentOwnerInputs(observedDb, scope, references, signal), verifyTargetIntent: verifier };
    const loopResult = await runAgentTurn({ tools, store: createD1TurnStore(observedDb, scope), context, messages: [{ role: "user", content: ownerText }], maxSteps: 4, timeBudgetMs: 30_000,
      model: { id: "simulated-admission-planner", async step({ onDelta }) {
        plannerSteps++;
        if (plannerSteps === 1) return { text: "", toolCalls: [{ id: "read-admission-source", ...structuredClone(readCall) }], usage };
        if (!direct && plannerSteps === 2) return { text: "", toolCalls: [{ id: "loop-claimed-effect", ...structuredClone(authorizedCall) }], usage };
        const text = direct ? "The source has been read; no effect was requested from this loop fixture." : "Native receipt records the requested move.";
        await onDelta(text); return { text, toolCalls: [], usage };
      } },
      onEvent: event => appendAgentStreamEvent(seed.db, scope.ownerId, scope.turnId, event.event, event.data),
    });
    let directResult;
    if (direct) directResult = await tools.find(tool => tool.name === authorizedCall.name).execute(structuredClone(authorizedCall.arguments), {
      ...context, messages: [{ role: "user", content: ownerText }], toolCall: { id: "direct-unclaimed-effect", ...structuredClone(authorizedCall) }, toolCallId: "direct-unclaimed-effect", idempotencyKey: key,
      signal: new AbortController().signal,
      intentToolContracts: tools.filter(tool => tool.target).map(({ name, description, parameters, effect, approval, target }) => ({ name, description, parameters, effect, approval, target: { domain: target.domain, idParameter: target.idParameter } })),
    });
    seed.reopen();
    const after = snapshot();
    const receipts = seed.raw.prepare("SELECT * FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? ORDER BY tool_name,idempotency_key").all(scope.ownerId, scope.turnId).map(row => ({ ...row }));
    const effects = seed.raw.prepare("SELECT * FROM admission_effects ORDER BY seq").all().map(row => ({ ...row }));
    const checks = direct ? {
      directReturnsError: directResult.status === "error",
      noDirectNativeEffect: effects.length === 0 && JSON.stringify(before) === JSON.stringify(after),
      uncertainReceiptStillRunning: receipts.some(receipt => receipt.idempotency_key === key && receipt.status === "running"),
    } : {
      exactlyOneNativeMove: effects.length === 1 && effects[0].record_id === recordId && after.remind_at === "2027-01-16T09:30:00.000Z",
      centralAndRequireTargetBothVerified: intentReceiptReads >= 2,
      oneIndependentInference: judgeCalls === 1,
      currentClaimWasRunningAtJudge: nativeAtJudge[0]?.status === "running" && nativeAtJudge[0]?.idempotency_key === key,
      finishedExactNativeOK: receipts.some(receipt => receipt.idempotency_key === key && receipt.status === "finished" && JSON.parse(receipt.result_json).status === "ok"),
    };
    results.push({ id, scope, key, ownerText, fixedVerdict, before, after, loopResult, directResult, intentReceiptReads, judgeCalls, judgeEvidence, nativeAtJudge, receipts, effects, reopenCount: seed.reopenCount, checks, passed: Object.values(checks).every(Boolean) });
  } finally { seed.close(); }
  const observed = results.find(result => result.id === id);
  assert.equal(observed.passed, true, JSON.stringify({ id, checks: observed.checks }));
});
after(() => {
const afterFingerprint = sourceFingerprint();
const report = { authoredAt: "2026-10-11", transferredFromPreFixSpec: "ordered-admission-red-spec.md", sourceFingerprintBefore: beforeFingerprint, sourceFingerprintAfter: afterFingerprint, sourceStable: beforeFingerprint === afterFingerprint, providerCalls: 0,
  scriptSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"), counts: { total: results.length, pass: results.filter(value => value.passed).length, fail: results.filter(value => !value.passed).length }, results };
mkdirSync(new URL("../.me3-evals/agent/target-intent-implementation/", import.meta.url), { recursive: true });
writeFileSync(new URL("../.me3-evals/agent/target-intent-implementation/ordered-admission-source-green.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
});

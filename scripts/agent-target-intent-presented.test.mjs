import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { appendAgentStreamEvent, persistAgentInput } from "../packages/agent/src/store.ts";
import { createTargetIntentVerifier, loadTargetIntentOwnerInputs } from "../apps/worker/src/agent-target-intent.ts";

const firstId = "presented-jan15", secondId = "presented-jan17", title = "Presented QA launch";
const changes = { date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" };
async function fixture({ subset = false, inspect }, body) {
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES(?,?,?,'2027-01-15T12:00:00Z','Europe/Dublin'),(?,?,?,'2027-01-17T12:00:00Z','Europe/Dublin')")
      .run(firstId, seed.ownerId, title, secondId, seed.ownerId, title);
    seed.raw.exec("CREATE TABLE test_presented_effects(record_id TEXT); CREATE TRIGGER test_presented_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO test_presented_effects(record_id) VALUES(new.id); END;");
    const tools = createDomainTools(), tool = name => tools.find(value => value.name === name);
    async function ownerTurn(turnId, messageText) {
      const context = { db: seed.db, ownerId: seed.ownerId, threadId: "eval-thread", turnId, requestId: `${turnId}:request`, messageText,
        ownerTimezone: "Europe/Dublin", messages: [], enabledPluginIds: new Set(["me3.calendar"]), toolCallId: `${turnId}:call`, idempotencyKey: `${turnId}:write`, signal: new AbortController().signal };
      await persistAgentInput(seed.db, context, { userId: seed.ownerId, threadId: context.threadId, turnId, requestId: context.requestId, messageText });
      seed.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)")
        .run(`${turnId}:user`, seed.ownerId, context.threadId, messageText, JSON.stringify({ requestId: context.requestId }));
      await appendAgentStreamEvent(seed.db, seed.ownerId, turnId, "status", { state: "running" });
      return context;
    }
    const read = await ownerTurn("original-source-read", "Show my Presented QA launch reminders.");
    const listed = await tool("core_reminders_list").execute({ query: title }, read);
    assert.equal(listed.status, "ok"); assert.equal(listed.data.reminders.length, 2);
    seed.raw.prepare("UPDATE me3_agent_turns SET status='complete' WHERE turn_id=?").run(read.turnId);
    const menu = await ownerTurn("later-shown-menu", "Let me choose which Presented QA launch reminder to move to 16 January 2027 at 09:30 Europe/Dublin.");
    let selectionId = listed.data.selectionId;
    if (subset) {
      // A model-authored narrower reread cannot erase the earlier broader sources.
      const { rememberTargets } = await import("../packages/agent/src/tools/targets.ts");
      selectionId = (await rememberTargets(menu, "reminder", [listed.data.reminders[0]], value => value.title)).selectionId;
    }
    const presented = await tool("core_targets_present").execute({ selectionId, toolName: "core_reminders_update", arguments: changes }, menu);
    assert.equal(presented.status, "needs_selection");
    seed.raw.prepare("UPDATE me3_agent_turns SET status='complete',checkpoint_json=? WHERE turn_id=?")
      .run(JSON.stringify({ status: "complete", targetPresentation: presented.data.targetPresentation }), menu.turnId);
    const current = await ownerTurn("actual-owner-choice", subset
      ? `Actually, move reminder ID ${secondId} to 16 January 2027 at 09:30 Europe/Dublin instead.` : "The second one.");
    const scope = { ownerId: current.ownerId, threadId: current.threadId, turnId: current.turnId, requestId: current.requestId };
    current.loadIntentOwnerInputs = (references, signal) => loadTargetIntentOwnerInputs(seed.db, scope, references, signal);
    current.intentToolContracts = tools.filter(value => value.target && (!value.pluginId || current.enabledPluginIds.has(value.pluginId)))
      .map(({ name, description, parameters, effect, approval, target }) => ({ name, description, parameters, effect, approval, target: { domain: target.domain, idParameter: target.idParameter } }));
    let calls = 0;
    current.verifyTargetIntent = createTargetIntentVerifier({ db: seed.db, scope, ownerTimezone: current.ownerTimezone, tools: tools.filter(value => !value.pluginId || current.enabledPluginIds.has(value.pluginId)), admit: () => ({
      usageId: () => "simulated-presented-usage", model: { id: "simulated-independent-judge", async step(request) {
        calls++; const evidence = JSON.parse(request.messages[1].content); inspect(evidence);
        assert.equal("proposedCall" in evidence, false);
        assert.deepEqual(evidence.ownerInputs.map(value => value.turnId), [read.turnId, menu.turnId, current.turnId]);
        return { text: "", toolCalls: [{ id: "independent-verdict", name: "core_target_intent_verdict", arguments: { decision: "allow", selectedCandidateId: secondId, authorizedCall: { name: "core_reminders_update", arguments: { reminderId: secondId, ...changes } } } }],
          usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, estimatedCostUsd: 0.00004 } };
      } },
    }) });
    seed.reopen();
    await body({ seed, current, tool, get calls() { return calls; } });
  } finally { seed.close(); }
}

for (const subset of [false, true]) test(subset
  ? "same-domain subset card preserves broader source evidence for a later explicit owner ID"
  : "a later genuinely shown card retains its original selection read-turn provenance", async () => {
  await fixture({ subset, inspect(evidence) {
    assert.equal(evidence.presentation.createdTurnId, "later-shown-menu");
    assert.deepEqual(evidence.presentation.candidates.map(value => value.id), subset ? [firstId] : [firstId, secondId]);
    const panel = evidence.targets.find(value => value.domain === "reminder");
    assert.deepEqual(panel.candidates.map(value => value.id).sort(), [firstId, secondId]);
    assert.equal(panel.candidates.find(value => value.id === secondId).readTurnId, "original-source-read");
  } }, async f => {
    const result = await f.tool("core_reminders_update").execute({ reminderId: secondId, ...changes }, f.current);
    assert.equal(result.status, "ok", result.error); assert.equal(f.calls, 1); f.seed.reopen();
    assert.deepEqual(f.seed.raw.prepare("SELECT id,remind_at FROM user_reminders WHERE id IN (?,?) ORDER BY id").all(firstId, secondId).map(row => ({ ...row })),
      [{ id: firstId, remind_at: "2027-01-15T12:00:00Z" }, { id: secondId, remind_at: "2027-01-16T09:30:00.000Z" }]);
    assert.deepEqual(f.seed.raw.prepare("SELECT record_id FROM test_presented_effects").all().map(row => ({ ...row })), [{ record_id: secondId }]);
  });
});

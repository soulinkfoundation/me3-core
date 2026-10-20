import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCreateIntentEvidence, createIntentVerifierFromModel, parseCreateIntentVerdict } from "../src/create-intent.ts";

test("evidence holds the latest owner request, earlier context and the proposed record", () => {
  const messages = [{ role: "system" as const, content: "rules" }, ...Array.from({ length: 12 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` })), { role: "tool" as const, toolCallId: "t", content: "{}" }];
  const evidence = buildCreateIntentEvidence(messages, { name: "core_reminders_create", description: "Create" }, { arguments: { title: "Call Alex" } }, "Europe/Dublin");
  assert.equal(evidence.ownerRequest, "m10");
  assert.equal(evidence.recentConversation.length, 8);
  assert.deepEqual(evidence.recentConversation.at(-1), { role: "assistant", text: "m9" });
  assert.deepEqual(evidence.recentConversation[0], { role: "owner", text: "m2" });
  assert.deepEqual(evidence.proposedAction, { name: "core_reminders_create", description: "Create", arguments: { title: "Call Alex" } });
});

test("only a single well-formed verdict counts; prose is ignored", async () => {
  assert.equal(parseCreateIntentVerdict({ decision: "maybe", reason: "x" }), null);
  assert.equal(parseCreateIntentVerdict({ decision: "allow", reason: " " }), null);
  const model = (toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) => ({ id: "m", step: async (input: { toolChoice?: string }) => { assert.equal(input.toolChoice, "core_create_intent_verdict"); return { text: "Let me check.", toolCalls, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, estimatedCostUsd: 0 } }; } });
  const evidence = buildCreateIntentEvidence([{ role: "user", content: "Remind me at 9" }], { name: "c", description: "d" }, { arguments: {} }, "UTC");
  const allowed = await createIntentVerifierFromModel(model([{ id: "1", name: "core_create_intent_verdict", arguments: { decision: "allow", reason: "Asked." } }]))(evidence, AbortSignal.timeout(1000));
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.inference?.modelId, "m");
  const twice = await createIntentVerifierFromModel(model([{ id: "1", name: "core_create_intent_verdict", arguments: { decision: "allow", reason: "a" } }, { id: "2", name: "core_create_intent_verdict", arguments: { decision: "allow", reason: "b" } }]))(evidence, AbortSignal.timeout(1000));
  assert.equal(twice.decision, "clarify");
});

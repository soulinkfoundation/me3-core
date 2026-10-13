import { createOwnerCreateIntentVerifier } from "../apps/worker/src/agent-owner-create-intent.ts";
import { createCloudflareModel } from "../packages/agent/src/model.ts";

// Native creation guard and persistence are real; only offline verdict outputs
// are independent authored fixtures. No planner proposal reaches the judge.
export function createEvalOwnerCreateVerifier({ db, scope, tools, route, fixtureVerdicts = [] }) {
  const verdicts = [...fixtureVerdicts], modelResponses = [];
  const verify = createOwnerCreateIntentVerifier({ db, scope, tools, admit: () => {
    let usageId;
    const model = route.model === "scripted-fixture" ? {
      id: "scripted-fixture", async step() {
        const verdict = verdicts.shift() || { decision: "clarify", reason: "Independent authored creation verdict was not specified." };
        return { text: "", toolCalls: [{ id: crypto.randomUUID(), name: "core_owner_create_intent_verdict", arguments: verdict }],
          usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, estimatedCostUsd: 0 } };
      },
    } : createCloudflareModel({ model: route.model, gatewayId: route.aiGateway.gatewayId,
      ai: { run: (model, request, options) => route.ai.run(model, request, { ...options, onAdmission: id => { usageId = id; } }) },
      metadata: { purpose: "owner_create_intent" }, recordUsage: usage => route.recordUsage({ usage: { ...usage, purpose: "owner_create_intent" } }) });
    return { model: { id: model.id, async step(request) {
      const response = await model.step(request);
      modelResponses.push(structuredClone({ modelId: model.id, text: response.text, toolCalls: response.toolCalls, usage: response.usage }));
      return response;
    } }, usageId: () => usageId };
  } });
  verify.modelResponses = modelResponses;
  return verify;
}

import { createCloudflareModel, ModelRequestRejectedError } from "../../../packages/agent/src/model";
import { gatewayProviderKeys } from "../../worker/src/agent-runtime";
import type { Env } from "../../worker/src/types";

// Runs the chat fallback the agent loop runs (packages/agent/src/loop.ts) with the primary refusing like a
// rate-limited Haiku, against the live gateway, keys and backup model. Not charged to any user's allowance.
export async function backupCheck(env: Env) {
  const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID ?? "default";
  const backupModel = env.ME3_AI_CHAT_BACKUP_MODEL ?? "";
  const { anthropicByok, deepseekByok } = await gatewayProviderKeys(env, env.CLOUDFLARE_ACCOUNT_ID ?? null, gatewayId, null);
  const step = { messages: [{ role: "user" as const, content: "In one short sentence, what can you help me with?" }], tools: [], signal: AbortSignal.timeout(60_000), onDelta: async () => {} };
  const primary = { id: `anthropic/${env.ME3_AI_CHAT_MODEL}`, step: async () => { throw new ModelRequestRejectedError("429 rate_limit_error (forced by backup-check)"); } };
  const backup = createCloudflareModel({ ai: env.AI as never, model: backupModel, gatewayId, anthropicByok, deepseekByok, metadata: { me3_runtime: "backup-check" } });
  const started = Date.now();
  let primaryError = "";
  try { await primary.step(); } catch (error) { primaryError = (error as Error).message; }
  try {
    const response = await backup.step(step);
    return { ok: true, primary: primary.id, primaryError, model: backup.id, provider: response.usage?.provider ?? "workers-ai", deepseekKey: Boolean(deepseekByok), ms: Date.now() - started, usage: response.usage, text: response.text.slice(0, 200) };
  } catch (error) {
    return { ok: false, primary: primary.id, primaryError, model: backup.id, deepseekKey: Boolean(deepseekByok), ms: Date.now() - started, error: (error as Error).message.slice(0, 300) };
  }
}

import type { AgentGeneratedImageAction, AgentImageGenerationServices } from "../../../packages/agent/src/tools";
import { getAiSettings } from "./ai-providers";
import { getAiGatewayRuntimeConfig } from "./ai-gateway";
import { getManagedAiBillingSettings, syncManagedAiUsage } from "./managed-ai-billing";
import { isManagedRuntime } from "./managed-runtime-lifecycle";
import { generateAgentProviderImage, verifiedImageCost } from "./agent-image-provider";
import type { Env } from "./types";
export { AGENT_IMAGE_SCHEMA_STATEMENTS } from "./agent-image-schema";

type Scope = { ownerId: string; threadId: string; turnId: string };
type Operation = Scope & { id: string; owner_id: string; thread_id: string; turn_id: string; request_id: string; idempotency_key: string; prompt: string; model: string; billing_managed: number; status: string; usage_event_id: string; attachment_id: string | null; storage_key: string | null; mime_type: string | null; size: number | null; width: number | null; height: number | null; revised_prompt: string | null; sha256: string | null; error: string | null };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
async function hash(bytes: Uint8Array): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))).map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function readOperation(env: Env, ownerId: string, key: string) { return env.DB.prepare("SELECT * FROM me3_agent_image_operations WHERE owner_id=? AND idempotency_key=?").bind(ownerId, key).first<Operation>(); }

async function actionFor(env: Env, op: Operation): Promise<AgentGeneratedImageAction | null> {
  if (op.status !== "complete" || !op.attachment_id || !op.storage_key || !op.mime_type || !/^image\/(png|jpeg|webp)$/.test(op.mime_type) || !op.sha256 || !Number.isSafeInteger(op.size) || !op.size || op.size < 0 || op.size > 10 * 1024 * 1024 || !Number.isSafeInteger(op.width) || !Number.isSafeInteger(op.height) || !op.width || !op.height || op.width < 0 || op.height < 0 || op.width > 4096 || op.height > 4096) return null;
  const asset = await env.DB.prepare(`SELECT id,filename FROM assistant_attachments WHERE id=? AND owner_id=? AND thread_id=?
    AND kind='image' AND status='ready' AND storage_key=? AND mime_type=? AND size=?
    AND json_extract(metadata_json,'$.operationId')=? AND json_extract(metadata_json,'$.sha256')=?
    AND EXISTS(SELECT 1 FROM assistant_threads WHERE id=? AND owner_id=? AND status='active')`)
    .bind(op.attachment_id, op.owner_id, op.thread_id, op.storage_key, op.mime_type, op.size, op.id, op.sha256, op.thread_id, op.owner_id).first<{ id: string; filename: string }>();
  if (!asset) return null;
  return { kind: "generated", status: "complete", prompt: op.prompt, revisedPrompt: op.revised_prompt, providerId: "workers-ai", model: op.model, reason: null, assets: [{ id: asset.id, attachmentId: asset.id, name: asset.filename, mimeType: op.mime_type, size: op.size, width: op.width, height: op.height, url: `/api/assistant/attachments/${encodeURIComponent(asset.id)}/content`, storageKey: op.storage_key }] };
}
export async function loadAgentGeneratedImageAction(env: Env, scope: Scope): Promise<AgentGeneratedImageAction | null> {
  const ops = await env.DB.prepare("SELECT * FROM me3_agent_image_operations WHERE owner_id=? AND thread_id=? AND turn_id=? AND status='complete' ORDER BY created_at,id").bind(scope.ownerId, scope.threadId, scope.turnId).all<Operation>();
  const actions = await Promise.all((ops.results || []).map(op => actionFor(env, op)));
  const valid = actions.filter((action): action is AgentGeneratedImageAction => action !== null);
  return valid.length ? { ...valid[0], assets: valid.flatMap(action => action.assets) } : null;
}

async function assertActiveScope(env: Env, ownerId: string, input: Parameters<AgentImageGenerationServices["generate"]>[1]) {
  input.signal.throwIfAborted();
  const scope = await env.DB.prepare(`SELECT t.turn_id FROM me3_agent_turns t JOIN assistant_threads h ON h.id=t.thread_id
    WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=? AND t.request_id=? AND h.owner_id=? AND h.status='active'
    AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?)`)
    .bind(ownerId, input.threadId, input.turnId, input.requestId, ownerId, ownerId, input.requestId).first();
  if (!scope) throw new Error("Image generation conversation or request is unavailable");
  input.signal.throwIfAborted();
}
async function managedAdmission(env: Env, ownerId: string, signal: AbortSignal): Promise<number> {
  await syncManagedAiUsage(env);
  const snapshot = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ai_usage_events WHERE user_id=?
    AND created_at >= datetime('now','start of month') AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL`).bind(ownerId).first<{ count: number }>();
  const policy = await getManagedAiBillingSettings(env, { syncUsage: false });
  signal.throwIfAborted();
  if (!policy.available || !policy.eligible || policy.fallbackActive || policy.currentMonthUsageMicrousd >= policy.effectiveMaximumCents * 10_000) throw new Error(policy.ineligibleReason || "Managed image generation is unavailable at the current budget");
  return snapshot?.count || 0;
}

export function createAgentImageGenerationServices(env: Env, ownerId: string): AgentImageGenerationServices | undefined {
  if (!env.AI || !env.SITE_ASSETS) return undefined;
  return { async generate(rawPrompt, input) {
    let operation: Operation | null = null; let providerStarted = false; let ownsAdmission = false;
    try {
      const prompt = rawPrompt.trim();
      if (!prompt || prompt.length > 4000 || !input.idempotencyKey) throw new Error("Image generation prompt or identity is invalid");
      await assertActiveScope(env, ownerId, input);
      operation = await readOperation(env, ownerId, input.idempotencyKey);
      if (operation) {
        if (operation.thread_id !== input.threadId || operation.turn_id !== input.turnId || operation.request_id !== input.requestId || operation.prompt !== prompt) throw new Error("Image operation does not match this request");
        if (operation.status === "complete") { const action = await actionFor(env, operation); if (!action) throw new Error("Generated image is no longer available"); return { status: "complete", operationId: operation.id, action }; }
        return { status: "unknown", operationId: operation.id, error: "Image operation requires reconciliation before retrying" };
      }
      const unresolved = await env.DB.prepare("SELECT id FROM me3_agent_image_operations WHERE owner_id=? AND turn_id=? AND status IN ('admitted','unknown') LIMIT 1").bind(ownerId, input.turnId).first<{ id: string }>();
      if (unresolved) return { status: "unknown", operationId: unresolved.id, error: "An image operation for this request requires reconciliation before another generation" };
      const receipt = await env.DB.prepare("SELECT arguments_json FROM me3_agent_tool_receipts WHERE owner_id=? AND idempotency_key=? AND turn_id=? AND tool_name='core_images_generate' AND status='running'").bind(ownerId, input.idempotencyKey, input.turnId).first<{ arguments_json: string }>();
      if (!receipt || JSON.parse(receipt.arguments_json)?.prompt?.trim() !== prompt) throw new Error("Image tool receipt does not match this request");
      if (!env.AI || !env.SITE_ASSETS) throw new Error("Private image generation provider or storage is unavailable");
      const route = (await getAiSettings(env, ownerId)).defaults.image_generation;
      let model = route.model;
      if (route.providerId === "openai") model = model.startsWith("openai/") ? model : `openai/${model}`;
      if (route.providerId === "workers-ai" && /^black-forest-labs\/flux-2-(klein-4b|dev)$/.test(model)) model = `@cf/${model}`;
      if (!route.configured || !["openai/gpt-image-2", "@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-dev"].includes(model)) throw new Error("Configured image model is unavailable for private generation");
      const managed = isManagedRuntime(env);
      const reportCount = managed ? await managedAdmission(env, ownerId, input.signal) : 0;
      const gateway = await getAiGatewayRuntimeConfig(env, ownerId);
      await assertActiveScope(env, ownerId, input);
      const id = `agent-image:${await hash(new TextEncoder().encode(JSON.stringify([ownerId, input.idempotencyKey])))}`;
      const usageId = `${id}:usage`;
      const billingFeeRate = managed && !model.startsWith("@cf/") ? 0.05 : 0;
      const metadata = { me3_runtime: "agent", me3_turn_id: input.turnId, me3_request_id: input.requestId, me3_thread_id: input.threadId, operationId: id, billingManaged: managed, modelAuthor: model.replace(/^@cf\//, "").split("/")[0], billingFeeRate, baseCostUsd: null as number | null, costKnown: false, usageReported: false };
      const admitted = await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO me3_agent_image_operations(id,owner_id,thread_id,turn_id,request_id,idempotency_key,prompt,model,billing_managed,status,usage_event_id)
          SELECT ?,?,?,?,?,?,?,?,?, 'admitted',? WHERE NOT EXISTS(SELECT 1 FROM me3_agent_image_operations WHERE owner_id=? AND turn_id=? AND status IN ('admitted','unknown'))
          AND NOT EXISTS(SELECT 1 FROM ai_usage_events WHERE id=?)
          AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?)
          AND (?=0 OR (NOT EXISTS(SELECT 1 FROM ai_usage_events WHERE user_id=? AND created_at >= datetime('now','start of month')
            AND json_extract(metadata_json,'$.me3_runtime')='agent' AND json_extract(metadata_json,'$.billingManaged')=1 AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NULL)
            AND ?=(SELECT COUNT(*) FROM ai_usage_events WHERE user_id=? AND created_at >= datetime('now','start of month') AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL)))`)
          .bind(id, ownerId, input.threadId, input.turnId, input.requestId, input.idempotencyKey, prompt, model, managed ? 1 : 0, usageId, ownerId, input.turnId, usageId, ownerId, input.requestId, managed ? 1 : 0, ownerId, reportCount, ownerId),
        env.DB.prepare(`INSERT OR IGNORE INTO ai_usage_events(id,user_id,kind,provider,model,successful_request_count,metadata_json)
          SELECT ?,?,'image','workers-ai',?,0,? WHERE EXISTS(SELECT 1 FROM me3_agent_image_operations WHERE id=? AND status='admitted')`).bind(usageId, ownerId, model, JSON.stringify(metadata), id),
      ]);
      if (admitted[0].meta.changes !== 1 || admitted[1].meta.changes !== 1) {
        if (admitted[0].meta.changes === 1) await env.DB.prepare("DELETE FROM me3_agent_image_operations WHERE id=? AND owner_id=? AND status='admitted'").bind(id,ownerId).run();
        throw new Error("Image admission is pending reconciliation or the managed budget changed");
      }
      ownsAdmission = true;
      operation = await readOperation(env, ownerId, input.idempotencyKey);
      await assertActiveScope(env, ownerId, input);
      providerStarted = true;
      const image = await generateAgentProviderImage(env, model, prompt, gateway.gatewayId || env.CLOUDFLARE_AI_GATEWAY_ID || "default", input.signal, { me3_runtime: "agent", operationId: id, me3_turn_id: input.turnId, me3_request_id: input.requestId, me3_thread_id: input.threadId });
      const cost = verifiedImageCost(model, image);
      await env.DB.prepare("UPDATE ai_usage_events SET tokens_in=?,tokens_out=?,estimated_cost_usd=?,successful_request_count=1,metadata_json=? WHERE id=? AND user_id=?")
        .bind(cost?.inputTokens || 0, cost?.outputTokens || 0, cost ? cost.baseCostUsd * (1 + billingFeeRate) : 0, JSON.stringify({ ...metadata, costKnown: Boolean(cost), usageReported: cost?.usageReported || false, baseCostUsd: cost?.baseCostUsd ?? null, pricingBasis: cost?.pricingBasis ?? null }), usageId, ownerId).run();
      const attachmentId = `${id}:asset`; const storageKey = `assistant/${ownerId}/generated/${id.replace(":", "-")}`;
      const sha256 = await hash(image.bytes); const filename = `Generated image.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1]}`;
      await env.DB.prepare("UPDATE me3_agent_image_operations SET attachment_id=?,storage_key=?,mime_type=?,size=?,width=?,height=?,revised_prompt=?,sha256=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=? AND status='admitted'")
        .bind(attachmentId,storageKey,image.mimeType,image.bytes.length,image.width,image.height,image.revisedPrompt,sha256,id,ownerId).run();
      await env.SITE_ASSETS.put(storageKey, image.bytes, { httpMetadata: { contentType: image.mimeType }, customMetadata: { ownerId, operationId: id, sha256 } });
      const completed = { ...operation!, status: "complete", attachment_id: attachmentId, storage_key: storageKey, mime_type: image.mimeType, size: image.bytes.length, width: image.width, height: image.height, sha256, revised_prompt: image.revisedPrompt };
      const action: AgentGeneratedImageAction = { kind: "generated", status: "complete", prompt, revisedPrompt: image.revisedPrompt, providerId: "workers-ai", model, reason: null, assets: [{ id: attachmentId, attachmentId, name: filename, mimeType: image.mimeType, size: image.bytes.length, width: image.width, height: image.height, url: `/api/assistant/attachments/${encodeURIComponent(attachmentId)}/content`, storageKey }] };
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO assistant_attachments(id,owner_id,thread_id,filename,mime_type,size,kind,status,storage_key,metadata_json) VALUES(?,?,?,?,?,?,'image','ready',?,?)").bind(attachmentId, ownerId, input.threadId, filename, image.mimeType, image.bytes.length, storageKey, JSON.stringify({ operationId: id, sha256, generated: true, width: image.width, height: image.height })),
          env.DB.prepare("UPDATE me3_agent_image_operations SET status='complete',attachment_id=?,storage_key=?,mime_type=?,size=?,width=?,height=?,revised_prompt=?,sha256=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=? AND status='admitted'").bind(attachmentId, storageKey, image.mimeType, image.bytes.length, image.width, image.height, image.revisedPrompt, sha256, id, ownerId),
          env.DB.prepare("UPDATE me3_agent_tool_receipts SET status='finished',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND idempotency_key=? AND turn_id=? AND tool_name='core_images_generate'").bind(JSON.stringify({ status: "ok", data: { operationId: id, imageAction: action } }), ownerId, input.idempotencyKey, input.turnId),
        ]);
      } catch (error) {
        // A lost D1 acknowledgement may follow a committed batch. Never delete committed media.
        const saved = await readOperation(env, ownerId, input.idempotencyKey);
        if (saved?.status === "complete") {
          const savedAction = await actionFor(env, saved);
          if (savedAction) return { status: "complete", operationId: saved.id, action: savedAction };
        } else if (saved?.status === "admitted") await env.SITE_ASSETS.delete(storageKey).catch(() => {});
        throw error;
      }
      operation = completed;
      return { status: "complete", operationId: id, action };
    } catch (error) {
      if (ownsAdmission && operation && operation.status !== "complete") {
        if (!providerStarted) {
          // This invocation owns the atomic admission and has not entered AI.run. Removing
          // that exact provisional pair is authoritative evidence that no provider was called.
          await env.DB.batch([
            env.DB.prepare("DELETE FROM ai_usage_events WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM me3_agent_image_operations WHERE id=? AND owner_id=? AND status='admitted')").bind(operation.usage_event_id, ownerId, operation.id, ownerId),
            env.DB.prepare("DELETE FROM me3_agent_image_operations WHERE id=? AND owner_id=? AND status='admitted'").bind(operation.id, ownerId),
          ]);
          return { status: "failed", error: errorText(error) };
        }
        const status = "unknown";
        await env.DB.prepare("UPDATE me3_agent_image_operations SET status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=? AND status='admitted'").bind(status, errorText(error).slice(0, 1000), operation.id, ownerId).run();
        return { status: "unknown", operationId: operation.id, error: "Image operation outcome requires reconciliation before retrying" };
      }
      return { status: "failed", error: errorText(error) };
    }
  } };
}

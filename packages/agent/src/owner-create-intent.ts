import type { AgentDb, AgentTool, AgentToolContext, AgentTargetIntentInference, AgentTargetIntentOwnerInput } from "./types";
import { canonicalJson, toolIdempotencyKey, validateArguments } from "./schema";

const RECEIPT_TOOL = "__me3_owner_create_intent_v1";
export type OwnerCreateOperation = Pick<AgentTool, "name" | "description" | "parameters" | "effect" | "approval">;
export type OwnerCreateEvidence = { version: 1; ownerId: string; threadId: string; turnId: string; requestId: string; ownerTimezone: string; ownerInputs: AgentTargetIntentOwnerInput[]; operation: OwnerCreateOperation };
export type OwnerCreateVerdict = { decision: "allow"; authorizedCall: { name: string; arguments: Record<string, unknown> } } | { decision: "deny" | "clarify"; reason: string };
export type OwnerCreateVerdictResult = OwnerCreateVerdict & { inference?: AgentTargetIntentInference };
export type OwnerCreateVerifier = (evidence: OwnerCreateEvidence, signal: AbortSignal) => Promise<OwnerCreateVerdictResult>;
export type OwnerCreateAuthorization = { ownerId: string; threadId: string; turnId: string; requestId: string; inputJson: string; messageText: string; metadataJson: string; evidenceJson: string; receiptId: string; receiptResultJson: string; argumentsJson: string };
type Scope = Pick<AgentToolContext, "ownerId" | "threadId" | "turnId" | "requestId" | "ownerTimezone">;
type RecordData = { verdict?: OwnerCreateVerdict; inference?: AgentTargetIntentInference; uncertain?: boolean };

export function ownerCreateVerdictSchema(operation: OwnerCreateOperation) {
  return { type: "object", anyOf: [
    { type: "object", additionalProperties: false, required: ["decision", "reason"], properties: { decision: { enum: ["deny", "clarify"] }, reason: { type: "string", minLength: 1, maxLength: 500 } } },
    { type: "object", additionalProperties: false, required: ["decision", "authorizedCall"], properties: { decision: { enum: ["allow"] }, authorizedCall: { type: "object", additionalProperties: false, required: ["name", "arguments"], properties: { name: { enum: [operation.name] }, arguments: operation.parameters } } } },
  ] };
}
export function ownerCreateInference(value: unknown): AgentTargetIntentInference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = value as AgentTargetIntentInference;
  if (typeof metadata.modelId !== "string" || !metadata.modelId || metadata.usageId !== undefined && typeof metadata.usageId !== "string") return undefined;
  const usage = metadata.usage;
  const valid = usage && [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteInputTokens ?? 0].every(v => Number.isSafeInteger(v) && v >= 0)
    && (usage.cacheWriteInputTokens === undefined || Number.isSafeInteger(usage.cacheWriteInputTokens) && usage.cacheWriteInputTokens >= 0)
    && usage.cachedInputTokens + (usage.cacheWriteInputTokens ?? 0) <= usage.inputTokens
    && (usage.estimatedCostUsd === null || typeof usage.estimatedCostUsd === "number" && Number.isFinite(usage.estimatedCostUsd) && usage.estimatedCostUsd >= 0);
  return { modelId: metadata.modelId, ...(metadata.usageId ? { usageId: metadata.usageId } : {}), ...(valid ? { usage } : {}) };
}
export async function loadOwnerCreateEvidence(db: AgentDb, scope: Scope, operation: OwnerCreateOperation, signal: AbortSignal) {
  signal.throwIfAborted();
  if (operation.name !== "core_quotes_save" || operation.effect !== "write" || operation.approval !== "none") throw Error("Unsupported owner creation contract.");
  const row = await db.prepare(`SELECT t.input_json,m.content,m.metadata_json FROM me3_agent_turns t
    JOIN assistant_threads a ON a.id=t.thread_id AND a.owner_id=t.owner_id AND a.status='active' AND a.deleted_at IS NULL AND a.archived_at IS NULL
    JOIN assistant_messages m ON m.id=t.turn_id||':user' AND m.owner_id=t.owner_id AND m.thread_id=t.thread_id AND m.role='user'
    WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=? AND t.request_id=? AND t.status='running'
      AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations c WHERE c.owner_id=t.owner_id AND c.request_id=t.request_id)
      AND NOT EXISTS(SELECT 1 FROM me3_agent_request_aliases x WHERE x.owner_id=t.owner_id AND x.request_id=t.request_id)`)
    .bind(scope.ownerId, scope.threadId, scope.turnId, scope.requestId).first<{ input_json: string; content: string; metadata_json: string }>();
  if (!row?.input_json) throw Error("Canonical owner creation request is unavailable.");
  const input = JSON.parse(row.input_json);
  const metadata = JSON.parse(row.metadata_json);
  if (input.userId !== scope.ownerId || input.threadId !== scope.threadId || input.turnId !== scope.turnId || input.requestId !== scope.requestId || input.messageText !== row.content) throw Error("Canonical owner creation input changed.");
  if (!metadata || metadata.requestId !== scope.requestId || metadata.runtime !== "agent" || metadata.turnId !== undefined && metadata.turnId !== scope.turnId) throw Error("Canonical owner message provenance changed.");
  const evidence: OwnerCreateEvidence = { version: 1, ownerId: scope.ownerId, threadId: scope.threadId, turnId: scope.turnId, requestId: scope.requestId, ownerTimezone: scope.ownerTimezone, ownerInputs: [{ turnId: scope.turnId, requestId: scope.requestId, messageText: row.content }], operation };
  if (new TextEncoder().encode(canonicalJson(evidence)).length > 65_536) throw Error("Complete owner creation evidence exceeds the bound.");
  signal.throwIfAborted();
  return { evidence, inputJson: row.input_json, messageText: row.content, metadataJson: row.metadata_json };
}
export function ownerCreateAuthorizationPredicate(proof: OwnerCreateAuthorization) {
  return { sql: `EXISTS(SELECT 1 FROM me3_agent_turns t
    JOIN assistant_threads a ON a.id=t.thread_id AND a.owner_id=t.owner_id AND a.status='active' AND a.deleted_at IS NULL AND a.archived_at IS NULL
    JOIN assistant_messages m ON m.id=t.turn_id||':user' AND m.owner_id=t.owner_id AND m.thread_id=t.thread_id AND m.role='user'
    JOIN me3_agent_tool_receipts r ON r.owner_id=t.owner_id AND r.turn_id=t.turn_id
    WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=? AND t.request_id=? AND t.status='running' AND t.input_json=? AND m.content=? AND m.metadata_json=?
      AND r.idempotency_key=? AND r.tool_name=? AND r.status='finished' AND r.arguments_json=? AND r.result_json=?
      AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations c WHERE c.owner_id=t.owner_id AND c.request_id=t.request_id)
      AND NOT EXISTS(SELECT 1 FROM me3_agent_request_aliases x WHERE x.owner_id=t.owner_id AND x.request_id=t.request_id))`,
    values: [proof.ownerId, proof.threadId, proof.turnId, proof.requestId, proof.inputJson, proof.messageText, proof.metadataJson, proof.receiptId, RECEIPT_TOOL, proof.evidenceJson, proof.receiptResultJson] };
}
export async function assertOwnerCreateAuthorization(db: AgentDb, proof: OwnerCreateAuthorization, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const predicate = ownerCreateAuthorizationPredicate(proof);
  if (!await db.prepare(`SELECT 1 WHERE ${predicate.sql}`).bind(...predicate.values).first()) throw Error("Owner creation authorization changed before saving.");
  signal?.throwIfAborted();
}
export async function requireOwnerCreateIntent(context: AgentToolContext, tool: AgentTool, args: Record<string, unknown>): Promise<OwnerCreateAuthorization> {
  if (!context.verifyOwnerCreateIntent) throw Error("Independent owner creation verification is unavailable.");
  const effectKey = await toolIdempotencyKey(context.ownerId, context.requestId, tool.name, args);
  if (effectKey !== context.idempotencyKey) throw Error("Complete owner creation effect identity does not match.");
  const effect = await context.db.prepare("SELECT turn_id,tool_name,arguments_json,status FROM me3_agent_tool_receipts WHERE owner_id=? AND idempotency_key=?")
    .bind(context.ownerId, effectKey).first<{ turn_id: string; tool_name: string; arguments_json: string; status: string }>();
  if (effect && !(context.effectReceiptClaimed === true && effect.status === "running" && effect.turn_id === context.turnId && effect.tool_name === tool.name && canonicalJson(JSON.parse(effect.arguments_json)) === canonicalJson(args))) throw Error("Owner creation has an existing uncertain or settled native effect; inspect its receipt.");
  const operation = { name: tool.name, description: tool.description, parameters: tool.parameters, effect: tool.effect, approval: tool.approval };
  const loaded = await loadOwnerCreateEvidence(context.db, context, operation, context.signal);
  const key = await toolIdempotencyKey(context.ownerId, context.requestId, RECEIPT_TOOL, { evidence: loaded.evidence, inputJson: loaded.inputJson, metadataJson: loaded.metadataJson });
  const saved = await context.db.prepare("SELECT idempotency_key,turn_id,arguments_json,status,result_json FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? AND tool_name=?")
    .bind(context.ownerId, context.turnId, RECEIPT_TOOL).first<{ idempotency_key: string; turn_id: string; arguments_json: string; status: string; result_json: string | null }>();
  let data: RecordData, resultJson: string;
  const observe = (value: RecordData, cacheHit: boolean) => context.onTargetIntentReceipt?.({ receiptId: key, inference: value.inference, uncertain: value.uncertain, cacheHit });
  if (saved) {
    if (saved.idempotency_key !== key || saved.turn_id !== context.turnId || saved.arguments_json !== canonicalJson(loaded.evidence)) throw Error("Cached owner creation scope changed.");
    data = saved.result_json ? JSON.parse(saved.result_json).data : {};
    data.inference = ownerCreateInference(data.inference);
    await observe(data, true);
    if (saved.status !== "finished" || !data.verdict || data.uncertain) throw Error("Owner creation inference has an uncertain saved outcome; do not retry.");
    resultJson = saved.result_json!;
  } else {
    const claimed = await context.db.prepare(`INSERT OR IGNORE INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status)
      SELECT ?,?,?,?,?,'running' WHERE EXISTS(SELECT 1 FROM me3_agent_turns t JOIN assistant_messages m ON m.id=t.turn_id||':user' AND m.owner_id=t.owner_id AND m.thread_id=t.thread_id AND m.role='user'
      WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=? AND t.request_id=? AND t.status='running' AND t.input_json=? AND m.content=? AND m.metadata_json=?)
      AND NOT EXISTS(SELECT 1 FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? AND tool_name=?)`)
      .bind(context.ownerId, key, context.turnId, RECEIPT_TOOL, canonicalJson(loaded.evidence), context.ownerId, context.threadId, context.turnId, context.requestId, loaded.inputJson, loaded.messageText, loaded.metadataJson, context.ownerId, context.turnId, RECEIPT_TOOL).run();
    if (!claimed.meta?.changes) throw Error("Owner creation inference admission raced another attempt.");
    let raw: OwnerCreateVerdictResult;
    try { raw = await context.verifyOwnerCreateIntent(structuredClone(loaded.evidence), context.signal); }
    catch (error) {
      const inference = ownerCreateInference(error && typeof error === "object" && "inference" in error ? error.inference : undefined);
      data = { uncertain: true, ...(inference ? { inference } : {}) };
      await observe(data, false);
      await context.db.prepare("UPDATE me3_agent_tool_receipts SET result_json=? WHERE owner_id=? AND idempotency_key=? AND status='running'").bind(canonicalJson({ status: "error", data }), context.ownerId, key).run();
      throw error;
    }
    const inference = ownerCreateInference(raw?.inference);
    const { inference: _inference, ...verdict } = raw || {};
    const invalid = validateArguments(ownerCreateVerdictSchema(operation), verdict);
    data = { verdict: invalid ? { decision: "deny", reason: "Independent creation verdict is malformed or unsupported." } : verdict as OwnerCreateVerdict, ...(inference ? { inference } : {}) };
    if (!inference?.usage || inference.usage.estimatedCostUsd === null) { data.uncertain = true; data.verdict = { decision: "deny", reason: "Independent creation usage remains unknown." }; }
    try { const current = await loadOwnerCreateEvidence(context.db, context, operation, context.signal); if (canonicalJson(current.evidence) !== canonicalJson(loaded.evidence) || current.inputJson !== loaded.inputJson || current.metadataJson !== loaded.metadataJson) throw Error("Owner input changed."); }
    catch { data.verdict = { decision: "deny", reason: "Canonical owner creation evidence changed or the owner stopped." }; }
    await observe(data, false);
    resultJson = canonicalJson({ status: "ok", data });
    const finished = await context.db.prepare("UPDATE me3_agent_tool_receipts SET status=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND idempotency_key=? AND turn_id=? AND status='running'")
      .bind(data.uncertain ? "running" : "finished", resultJson, context.ownerId, key, context.turnId).run();
    if (!finished.meta?.changes) throw Error("Owner creation verdict could not be durably saved.");
  }
  if (!data.verdict || validateArguments(ownerCreateVerdictSchema(operation), data.verdict) || !data.inference?.usage || data.inference.usage.estimatedCostUsd === null || data.uncertain) throw Error("Owner creation authorization is unavailable or uncertain.");
  if (data.verdict.decision !== "allow") throw Error(`Owner creation refused: ${data.verdict.reason}`);
  if (canonicalJson(data.verdict.authorizedCall) !== canonicalJson({ name: tool.name, arguments: args })) throw Object.assign(Error("Correct the quote to the independently authorized exact save; no effect occurred."), { data: { authorizedCall: data.verdict.authorizedCall, actionApplied: false } });
  const proof = { ownerId: context.ownerId, threadId: context.threadId, turnId: context.turnId, requestId: context.requestId, inputJson: loaded.inputJson, messageText: loaded.messageText, metadataJson: loaded.metadataJson, evidenceJson: canonicalJson(loaded.evidence), receiptId: key, receiptResultJson: resultJson, argumentsJson: canonicalJson(args) };
  await assertOwnerCreateAuthorization(context.db, proof, context.signal);
  return proof;
}

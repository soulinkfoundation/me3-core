import type { Env } from "./types";
import type { ManagedCommerceBridgeConfig } from "./commerce-bridge";
import { getAiGatewayRuntimeConfig } from "./ai-gateway";

// A managed agent receipt is written before inference and priced when the call finishes. An
// interrupted stream, a timeout or a crash leaves it unpriced, and admission holds every later
// managed call until it is settled. ME3 Cloud looks up the exact attempt in AI Gateway logs and
// returns authoritative evidence; missing, ambiguous or unpriced evidence keeps the hold.
// Receipts older than 35 days fall outside the usage outbox and are left for an operator.

export const AI_USAGE_SETTLEMENTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ai_usage_settlements (
  usage_event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('charged', 'no_charge')),
  evidence_source TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  base_cost_usd REAL NOT NULL CHECK (base_cost_usd >= 0),
  actor TEXT NOT NULL,
  prior_metadata_json TEXT NOT NULL,
  settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TRIGGER IF NOT EXISTS ai_usage_settlements_immutable
BEFORE UPDATE ON ai_usage_settlements
BEGIN
  SELECT RAISE(ABORT, 'ai_usage_settlements is append-only');
END`,
];

// Gateway calls time out after 60 seconds, so a receipt this old is no longer in flight.
const SETTLE_AFTER_MINUTES = 15;
// Each attempt queries AI Gateway logs in ME3 Cloud; held receipts retry on this interval.
const RETRY_AFTER_MINUTES = 10;
const MAX_RECEIPTS_PER_ATTEMPT = 20;
const SETTLEMENT_ACTOR = "me3-cloud:ai-gateway-evidence";
const EVIDENCE_SOURCE = "ai-gateway-log";

type UnknownReceiptRow = {
  id: string;
  user_id: string;
  kind: "text" | "image";
  model: string;
  created_at: string;
  metadata_json: string;
};

export type ManagedAiReconcileEvent = {
  id: string;
  kind: "text" | "image";
  model: string;
  occurredAt: string;
  gatewayId: string;
  correlation: { key: string; value: string };
};

export type ManagedAiSettlement = {
  id: string;
  resolution: "charged" | "no_charge";
  evidenceId: string;
  evidenceHash: string;
  inputTokens: number;
  outputTokens: number;
  baseCostUsd: number;
};

/** Settles unpriced managed agent receipts from ME3 Cloud's gateway evidence. Never throws. */
export async function reconcileUnknownManagedAiCosts(
  env: Env,
  bridge: ManagedCommerceBridgeConfig,
): Promise<number> {
  let rows: UnknownReceiptRow[];
  try {
    rows = (await env.DB.prepare(
      `SELECT r.id, r.user_id, r.kind, r.model, r.created_at, r.metadata_json
       FROM ai_usage_events r
       WHERE json_extract(r.metadata_json, '$.me3_runtime') = 'agent'
         AND json_extract(r.metadata_json, '$.billingManaged') = 1
         AND json_extract(r.metadata_json, '$.costKnown') = 0
         AND coalesce(json_extract(r.metadata_json, '$.purpose'), '') <> 'fast_path'
         AND r.created_at >= datetime('now', '-35 days')
         AND r.created_at <= datetime('now', ?)
         AND coalesce(json_extract(r.metadata_json, '$.reconcileAttemptedAt'), '') <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         AND NOT EXISTS (SELECT 1 FROM ai_usage_settlements s WHERE s.usage_event_id = r.id)
       ORDER BY r.created_at ASC
       LIMIT ?`,
    )
      .bind(`-${SETTLE_AFTER_MINUTES} minutes`, `-${RETRY_AFTER_MINUTES} minutes`, MAX_RECEIPTS_PER_ATTEMPT)
      .all<UnknownReceiptRow>()).results || [];
  } catch (error) {
    console.error("Managed AI reconciliation query failed", error);
    return 0;
  }
  if (rows.length === 0) return 0;

  const receipts = new Map<string, UnknownReceiptRow>();
  const events: ManagedAiReconcileEvent[] = [];
  for (const row of rows) {
    const event = await reconcileEventFor(env, row);
    if (!event) continue;
    receipts.set(row.id, row);
    events.push(event);
  }
  const attemptedAt = new Date().toISOString();
  for (const row of rows) {
    await env.DB.prepare(
      "UPDATE ai_usage_events SET metadata_json = json_set(metadata_json, '$.reconcileAttemptedAt', ?) WHERE id = ? AND json_extract(metadata_json, '$.costKnown') = 0",
    ).bind(attemptedAt, row.id).run().catch(() => {});
  }
  if (events.length === 0) return 0;

  let settlements: ManagedAiSettlement[];
  try {
    const response = await fetch(`${bridge.origin}/v1/ai-billing/reconcile`, {
      method: "POST",
      headers: { ...bridge.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    const payload = await response.json<unknown>().catch(() => null);
    const raw = (payload as { settlements?: unknown } | null)?.settlements;
    if (!response.ok || !Array.isArray(raw)) {
      console.error("Managed AI reconciliation rejected", response.status);
      return 0;
    }
    settlements = raw.map(parseSettlement).filter((item): item is ManagedAiSettlement => Boolean(item && receipts.has(item.id)));
  } catch (error) {
    console.error("Managed AI reconciliation failed", error);
    return 0;
  }

  let settled = 0;
  for (const settlement of settlements) {
    try {
      if (await applyManagedAiSettlement(env, receipts.get(settlement.id)!.user_id, settlement)) settled += 1;
    } catch (error) {
      console.error("Managed AI settlement write failed", settlement.id, error);
    }
  }
  return settled;
}

/**
 * Writes the audit row and prices the original receipt in one transaction, only while that
 * owner's receipt is still unpriced. Replaying identical evidence is a no-op; different
 * evidence for a settled receipt is refused.
 */
export async function applyManagedAiSettlement(
  env: Env,
  ownerId: string,
  settlement: ManagedAiSettlement,
): Promise<boolean> {
  const existing = await env.DB.prepare(
    "SELECT evidence_hash FROM ai_usage_settlements WHERE usage_event_id = ?",
  ).bind(settlement.id).first<{ evidence_hash: string }>();
  if (existing) {
    if (existing.evidence_hash !== settlement.evidenceHash) {
      console.error("Managed AI settlement conflicts with recorded evidence", settlement.id);
    }
    return false;
  }
  const charged = settlement.resolution === "charged";
  const pricingBasis = charged ? "ai-gateway-log-cost" : "ai-gateway-no-charge";
  const settlementId = `${EVIDENCE_SOURCE}:${settlement.evidenceId}`;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ai_usage_settlements (
         usage_event_id, user_id, resolution, evidence_source, evidence_id, evidence_hash,
         input_tokens, output_tokens, base_cost_usd, actor, prior_metadata_json
       )
       SELECT id, user_id, ?, ?, ?, ?, ?, ?, ?, ?, metadata_json
       FROM ai_usage_events
       WHERE id = ? AND user_id = ? AND json_extract(metadata_json, '$.costKnown') = 0
       ON CONFLICT(usage_event_id) DO NOTHING`,
    ).bind(
      settlement.resolution, EVIDENCE_SOURCE, settlement.evidenceId, settlement.evidenceHash,
      settlement.inputTokens, settlement.outputTokens, settlement.baseCostUsd, SETTLEMENT_ACTOR,
      settlement.id, ownerId,
    ),
    env.DB.prepare(
      `UPDATE ai_usage_events
       SET tokens_in = ?, tokens_out = ?,
           estimated_cost_usd = ? * (1 + coalesce(json_extract(metadata_json, '$.billingFeeRate'), 0)),
           successful_request_count = CASE WHEN kind = 'image' AND ? = 1 THEN 1 ELSE successful_request_count END,
           metadata_json = json_set(metadata_json,
             '$.costKnown', json('true'),
             '$.usageReported', json(?),
             '$.baseCostUsd', ?,
             '$.pricingBasis', ?,
             '$.settlementId', ?)
       WHERE id = ? AND user_id = ? AND json_extract(metadata_json, '$.costKnown') = 0
         AND EXISTS (SELECT 1 FROM ai_usage_settlements WHERE usage_event_id = ? AND user_id = ? AND evidence_hash = ?)`,
    ).bind(
      settlement.inputTokens, settlement.outputTokens, settlement.baseCostUsd, charged ? 1 : 0,
      charged ? "true" : "false", settlement.baseCostUsd, pricingBasis, settlementId,
      settlement.id, ownerId, settlement.id, ownerId, settlement.evidenceHash,
    ),
  ]);
  return Number(results[1]?.meta?.changes || 0) === 1;
}

async function reconcileEventFor(env: Env, row: UnknownReceiptRow): Promise<ManagedAiReconcileEvent | null> {
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  let correlation: ManagedAiReconcileEvent["correlation"] | null = null;
  if (metadata.gatewayCorrelation === "me3_usage_id") {
    correlation = { key: "me3_usage_id", value: row.id };
  } else if (text(metadata.operationId)) {
    // Image calls have always tagged the gateway with their operation id.
    correlation = { key: "operationId", value: text(metadata.operationId)! };
  } else if (row.kind === "text" && text(metadata.me3_request_id)) {
    // Receipts from before per-attempt correlation can only be matched by request and model,
    // which is unambiguous only when the request made a single call to that model.
    const siblings = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ai_usage_events
       WHERE user_id = ? AND model = ? AND json_extract(metadata_json, '$.me3_request_id') = ?`,
    ).bind(row.user_id, row.model, metadata.me3_request_id).first<{ count: number }>();
    if (Number(siblings?.count) === 1) correlation = { key: "me3_request_id", value: text(metadata.me3_request_id)! };
  }
  if (!correlation) return null;
  const gatewayId = text(metadata.gatewayId) ||
    (await getAiGatewayRuntimeConfig(env, row.user_id).then(config => config.gatewayId).catch(() => null)) ||
    env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || "default";
  const occurredAt = new Date(`${row.created_at.replace(" ", "T")}Z`);
  return {
    id: row.id,
    kind: row.kind,
    model: row.model,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? row.created_at : occurredAt.toISOString(),
    gatewayId,
    correlation,
  };
}

function parseSettlement(value: unknown): ManagedAiSettlement | null {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item) return null;
  const count = (input: unknown): input is number => typeof input === "number" && Number.isSafeInteger(input) && input >= 0;
  const { id, resolution, evidenceId, evidenceHash, inputTokens, outputTokens, baseCostUsd } = item;
  if (typeof id !== "string" || (resolution !== "charged" && resolution !== "no_charge")) return null;
  if (typeof evidenceId !== "string" || !evidenceId || evidenceId.length > 200) return null;
  if (typeof evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(evidenceHash)) return null;
  if (!count(inputTokens) || !count(outputTokens)) return null;
  if (typeof baseCostUsd !== "number" || !Number.isFinite(baseCostUsd) || baseCostUsd < 0) return null;
  if (resolution === "no_charge" && (baseCostUsd !== 0 || outputTokens !== 0)) return null;
  return { id, resolution, evidenceId, evidenceHash, inputTokens, outputTokens, baseCostUsd };
}

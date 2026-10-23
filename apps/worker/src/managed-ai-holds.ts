import { modelPricing } from "../../../packages/agent/src";
import { requestedImageCostUsd } from "./agent-image-provider";
import type { Env } from "./types";

// An unpriced managed receipt (a call still running, or one that ended without a price) holds
// the most that call could have cost instead of stopping the owner's agent. Holds count against
// the monthly maximum until AI Gateway evidence prices them; one that is never priced is charged
// at its hold (managed-ai-reconciliation.ts), so a missing price can never undercharge.

export const MAX_PROVISIONAL_HOLDS = 3;
// Agent context is compacted to 64,000 characters plus the system prompt and tools, and the
// planner asks for at most 4,096 output tokens, so these bound one text call with headroom.
const HOLD_INPUT_TOKENS = 64_000;
const HOLD_OUTPUT_TOKENS = 4_096;

/** The most one managed call can cost before the gateway fee, or null when it has no bound. */
export function provisionalHoldUsd(kind: string, model: string): number | null {
  if (kind === "image") return requestedImageCostUsd(model);
  const price = modelPricing(model);
  return price ? (HOLD_INPUT_TOKENS * price.input + HOLD_OUTPUT_TOKENS * price.output) / 1_000_000 : null;
}

export type ManagedProvisionalHolds = { count: number; microusd: number; unbounded: boolean };

/** This month's unpriced managed agent receipts and the budget they reserve. */
export async function managedProvisionalHolds(env: Env, ownerId: string): Promise<ManagedProvisionalHolds> {
  const rows = (await env.DB.prepare(`SELECT kind, model, json_extract(metadata_json,'$.billingFeeRate') AS feeRate FROM ai_usage_events WHERE user_id=?
    AND created_at >= datetime('now','start of month')
    AND json_extract(metadata_json,'$.me3_runtime')='agent'
    AND json_extract(metadata_json,'$.billingManaged')=1
    AND coalesce(json_extract(metadata_json,'$.purpose'),'')<>'fast_path'
    AND json_extract(metadata_json,'$.costKnown')=0`).bind(ownerId).all<{ kind: string; model: string; feeRate: number | null }>()).results || [];
  let microusd = 0; let unbounded = false;
  for (const row of rows) {
    const hold = provisionalHoldUsd(row.kind, row.model);
    if (hold === null) unbounded = true;
    else microusd += Math.ceil(hold * (1 + (Number(row.feeRate) || 0)) * 1_000_000);
  }
  return { count: rows.length, microusd, unbounded };
}

/** Throws while the holds cannot be covered; otherwise returns the budget they reserve. */
export async function assertProvisionalHoldsCovered(env: Env, ownerId: string): Promise<number> {
  const holds = await managedProvisionalHolds(env, ownerId);
  if (holds.unbounded || holds.count >= MAX_PROVISIONAL_HOLDS) throw new Error("Managed AI cost is awaiting reconciliation before another model call");
  return holds.microusd;
}

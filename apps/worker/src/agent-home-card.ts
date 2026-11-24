import type { Env } from "./types";

/**
 * The custom Home card ME3 built or changed in a turn (me3-c5h8.2), saved with the reply as its id so the
 * chat preview is still there when the conversation is reopened. Clients read the card live by id, so a
 * card removed since shows nothing rather than a stale copy.
 */
export type AgentHomeCard = { id: string; isUpdate: boolean };

const CARD_TOOLS = new Set(["core_cards_create", "core_cards_update"]);
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function readAgentHomeCard(value: unknown): AgentHomeCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && ID.test(row.id) ? { id: row.id, isUpdate: row.isUpdate === true } : null;
}

/** The turn's last card from a finished create or update tool. */
export async function loadAgentHomeCard(env: Env, scope: { ownerId: string; turnId: string }): Promise<AgentHomeCard | null> {
  const rows = await env.DB.prepare(
    `SELECT data_json FROM me3_agent_stream_events
     WHERE owner_id = ? AND turn_id = ? AND event = 'tool' AND data_json LIKE '%core_cards_%' ORDER BY seq`,
  ).bind(scope.ownerId, scope.turnId).all<{ data_json: string }>().catch(() => null);
  let card: AgentHomeCard | null = null;
  for (const row of rows?.results || []) {
    let data: { toolName?: unknown; state?: unknown; result?: { status?: unknown; data?: unknown } };
    try { data = JSON.parse(row.data_json); } catch { continue; }
    if (data.state !== "complete" || data.result?.status !== "ok" || !CARD_TOOLS.has(String(data.toolName))) continue;
    const record = data.result.data as { card?: { id?: unknown } } | null | undefined;
    card = readAgentHomeCard({ id: record?.card?.id, isUpdate: data.toolName === "core_cards_update" }) || card;
  }
  return card;
}

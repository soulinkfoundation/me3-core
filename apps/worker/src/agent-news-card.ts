import type { Env } from "./types";

/**
 * What a News turn draws under ME3's reply (me3-6ptk): the setup card (topic chips, "Read it now")
 * and the pick ME3 found when asked for something to watch or read. Saved with the reply so the
 * card is still there when the conversation is reopened, or read on another device.
 */
export type AgentNewsCard = {
  card: "topics" | "time" | "ready" | "paper";
  time: string;
  counts: { considered: number; stories: number; videos: number; pages: number } | null;
};
export type AgentNewsReply = { newsCard: AgentNewsCard | null; newsServingId: string | null };

const CARD_TOOLS = new Set(["core_news_settings_update", "core_news_settings_read", "core_news_paper"]);
const SERVE_TOOL = "core_news_serve";
const KINDS = new Set(["topics", "time", "ready", "paper"]);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

export function readAgentNewsCard(value: unknown): AgentNewsCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!KINDS.has(String(row.card))) return null;
  const paper = row.paper && typeof row.paper === "object" ? row.paper as Record<string, unknown> : null;
  const raw = (paper?.counts ?? row.counts) as Record<string, unknown> | null | undefined;
  const counts = raw && typeof raw === "object" ? { considered: count(raw.considered), stories: count(raw.stories), videos: count(raw.videos), pages: count(raw.pages) } : null;
  // "Read it now" needs a paper to open.
  if (row.card === "ready" && !counts) return null;
  return { card: row.card as AgentNewsCard["card"], time: typeof row.time === "string" ? row.time.slice(0, 5) : "", counts };
}

export function readAgentNewsServingId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 120 ? value : null;
}

/** The turn's last News card and served pick, read from the tool results the turn streamed. */
export async function loadAgentNewsReply(env: Env, scope: { ownerId: string; turnId: string }): Promise<AgentNewsReply> {
  const reply: AgentNewsReply = { newsCard: null, newsServingId: null };
  const rows = await env.DB.prepare(
    `SELECT data_json FROM me3_agent_stream_events
     WHERE owner_id = ? AND turn_id = ? AND event = 'tool' AND data_json LIKE '%core_news_%' ORDER BY seq`,
  ).bind(scope.ownerId, scope.turnId).all<{ data_json: string }>().catch(() => null);
  for (const row of rows?.results || []) {
    let data: { toolName?: unknown; state?: unknown; result?: { status?: unknown; data?: unknown } };
    try { data = JSON.parse(row.data_json); } catch { continue; }
    if (data.state !== "complete" || data.result?.status !== "ok") continue;
    const result = data.result.data as Record<string, unknown> | null | undefined;
    if (CARD_TOOLS.has(String(data.toolName))) reply.newsCard = readAgentNewsCard(result) || reply.newsCard;
    else if (data.toolName === SERVE_TOOL && result?.served === true) reply.newsServingId = readAgentNewsServingId(result.servingId) || reply.newsServingId;
  }
  return reply;
}

import type { Env } from "./types";

/**
 * The chat message ME3 drafted in a turn ("Tell Erum I'm running late"), shown on
 * the phone as a card with Edit and Send. The phone sends it through Soulink chat;
 * Core never sends it and never sees a reply.
 */
export type AgentMessageDraft = {
  contactId: string;
  recipientName: string;
  soulinkNodeId: string;
  soulinkHandle: string | null;
  text: string;
};

/** The turn's latest drafted message, if any. */
export async function loadAgentMessageDraft(env: Env, scope: { ownerId: string; turnId: string }): Promise<AgentMessageDraft | null> {
  const row = await env.DB.prepare(
    `SELECT result_json FROM me3_agent_tool_receipts
     WHERE owner_id = ? AND turn_id = ? AND tool_name = 'core_messages_draft' AND status = 'finished'
     ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
  ).bind(scope.ownerId, scope.turnId).first<{ result_json: string | null }>().catch(() => null);
  if (!row?.result_json) return null;
  try {
    const result = JSON.parse(row.result_json) as { status?: unknown; data?: { drafted?: unknown; draft?: unknown } };
    return result.status === "ok" && result.data?.drafted === true ? readAgentMessageDraft(result.data.draft) : null;
  } catch {
    return null;
  }
}

/** Accepts only a complete draft (live payloads and saved history). */
export function readAgentMessageDraft(value: unknown): AgentMessageDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const filled = (key: string) => typeof draft[key] === "string" && (draft[key] as string).trim() ? draft[key] as string : null;
  const contactId = filled("contactId"), recipientName = filled("recipientName"), soulinkNodeId = filled("soulinkNodeId"), text = filled("text");
  if (!contactId || !recipientName || !soulinkNodeId || !text) return null;
  if (draft.soulinkHandle !== null && draft.soulinkHandle !== undefined && typeof draft.soulinkHandle !== "string") return null;
  return { contactId, recipientName, soulinkNodeId, soulinkHandle: filled("soulinkHandle"), text };
}

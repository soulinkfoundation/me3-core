import { loadTargetPresentation, targetPresentationCard } from "../../../packages/agent/src/presentations";
import type { Env } from "./types";

export async function loadAgentTargetPresentation(env: Env, scope: { ownerId: string; threadId: string; turnId: string; presentationId?: string }) {
  const row = await env.DB.prepare(`SELECT p.id FROM me3_agent_presentations p
    JOIN me3_agent_turns t ON t.owner_id=p.owner_id AND t.thread_id=p.thread_id AND t.turn_id=?
    WHERE p.owner_id=? AND p.thread_id=? AND (p.created_turn_id=t.turn_id OR p.choice_turn_id=t.turn_id)
    AND (? IS NULL OR p.id=?) ORDER BY p.ordinal DESC LIMIT 1`)
    .bind(scope.turnId, scope.ownerId, scope.threadId, scope.presentationId || null, scope.presentationId || null).first<{ id: string }>();
  if (!row) return null;
  const presentation = await loadTargetPresentation(env.DB, { ...scope, presentationId: row.id });
  return presentation ? targetPresentationCard(presentation) : null;
}

export async function revalidateAgentTargetPayload(env: Env, scope: { ownerId: string; threadId: string; turnId: string }, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!payload.targetPresentation) return payload;
  const { targetPresentation: _saved, ...rest } = payload;
  const presentationId = typeof _saved === "object" && _saved && "id" in _saved ? (_saved as { id: unknown }).id : null;
  if (typeof presentationId !== "string") return rest;
  const targetPresentation = await loadAgentTargetPresentation(env, { ...scope, presentationId });
  return targetPresentation ? { ...rest, targetPresentation } : rest;
}

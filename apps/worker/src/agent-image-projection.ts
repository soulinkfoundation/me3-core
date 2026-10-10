import { loadAgentGeneratedImageAction } from "./agent-image-generation";
import type { Env } from "./types";

// Saved responses and events retain audit evidence; rendering rechecks live private assets.
export async function revalidateAgentImagePayload(
  env: Env,
  scope: { ownerId: string; threadId: string; turnId: string },
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!payload.imageAction) return payload;
  const { imageAction: _savedAction, ...rest } = payload;
  const action = await loadAgentGeneratedImageAction(env, scope);
  return action ? { ...rest, imageAction: action } : rest;
}

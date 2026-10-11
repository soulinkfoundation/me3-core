import { createDomainTools } from "../../../packages/agent/src/tools";
import { validateTargetSelection, targetSelectionClaimStatement, targetSelectionEligibility } from "../../../packages/agent/src/presentations";
import { AgentInputConflictError, persistAgentInput } from "../../../packages/agent/src/store";
import type { AgentTargetSelection, AgentToolContext } from "../../../packages/agent/src/types";
import { listCorePluginRecords } from "./plugins";
import type { NewAgentDispatchInput } from "./agent-runtime";
import type { Env } from "./types";

export function parseAgentTargetSelection(value: unknown): AgentTargetSelection | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentInputConflictError("Invalid target selection");
  const selection = value as Record<string, unknown>;
  if (Object.keys(selection).some(key => !["presentationId", "candidateId"].includes(key)) ||
      [selection.presentationId, selection.candidateId].some(id => typeof id !== "string" || !id.trim() || id.length > 500)) {
    throw new AgentInputConflictError("Invalid target selection");
  }
  return { presentationId: selection.presentationId as string, candidateId: selection.candidateId as string };
}

async function selectionContext(env: Env, input: Pick<NewAgentDispatchInput, "userId" | "threadId" | "requestId" | "messageText"> & { turnId?: string }): Promise<AgentToolContext> {
  const owner = await env.DB.prepare("SELECT timezone FROM owner_profile WHERE id=?").bind(input.userId).first<{ timezone: string | null }>();
  const thread = await env.DB.prepare("SELECT id FROM assistant_threads WHERE owner_id=? AND id=? AND status='active'").bind(input.userId, input.threadId).first();
  if (!owner || !thread) throw new AgentInputConflictError("Target conversation is unavailable");
  const blocked = await env.DB.prepare(`SELECT 1 FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=?
    UNION ALL SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=? LIMIT 1`)
    .bind(input.userId, input.requestId, input.userId, input.requestId).first();
  if (blocked) throw new AgentInputConflictError("This request cannot admit a target choice");
  const plugins = await listCorePluginRecords(env);
  return { db: env.DB, ownerId: input.userId, threadId: input.threadId, turnId: input.turnId || "", requestId: input.requestId,
    ownerTimezone: owner.timezone || "UTC", messageText: input.messageText, messages: [], enabledPluginIds: new Set(plugins.filter(plugin => plugin.enabled && plugin.status === "installed").map(plugin => plugin.id)),
    toolCallId: "target-selection", idempotencyKey: "target-selection", signal: new AbortController().signal };
}

export async function preflightAgentTargetSelection(env: Env, input: { userId: string; threadId: string; requestId: string; messageText: string }, selection: AgentTargetSelection): Promise<void> {
  const saved = await env.DB.prepare("SELECT turn_id FROM me3_agent_turns WHERE owner_id=? AND request_id=?").bind(input.userId, input.requestId).first<{ turn_id: string }>();
  try { await validateTargetSelection(await selectionContext(env, { ...input, turnId: saved?.turn_id }), selection, createDomainTools()); }
  catch (error) { throw new AgentInputConflictError(error instanceof Error ? error.message : "Target selection is unavailable"); }
}

// D1 is the admission authority: a raced or changed choice cannot create a turn or consume the menu.
export async function persistAgentTargetSelectionInput(env: Env, input: NewAgentDispatchInput): Promise<void> {
  if (!input.targetSelection) return persistAgentInput(env.DB, { ownerId: input.userId, threadId: input.threadId, turnId: input.turnId, requestId: input.requestId }, input);
  try {
    const context = await selectionContext(env, input);
    const { presentation } = await validateTargetSelection(context, input.targetSelection, createDomainTools());
    const identity = { ownerId: input.userId, threadId: input.threadId, turnId: input.turnId, requestId: input.requestId, candidateId: input.targetSelection.candidateId };
    const eligible = targetSelectionEligibility(presentation, identity);
    const inputJson = JSON.stringify(input);
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO me3_agent_turns(turn_id,owner_id,thread_id,request_id,input_json)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM me3_agent_presentations p WHERE ${eligible.sql})
        AND EXISTS(SELECT 1 FROM assistant_threads WHERE owner_id=? AND id=? AND status='active')
        AND NOT EXISTS(SELECT 1 FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=?)`)
        .bind(input.turnId, input.userId, input.threadId, input.requestId, inputJson, ...eligible.values, input.userId, input.threadId, input.userId, input.requestId),
      targetSelectionClaimStatement(env.DB, presentation, { ...identity, inputJson }) as D1PreparedStatement,
    ]);
    const saved = await env.DB.prepare("SELECT turn_id,thread_id,input_json FROM me3_agent_turns WHERE owner_id=? AND request_id=?").bind(input.userId, input.requestId).first<{ turn_id: string; thread_id: string; input_json: string }>();
    if (saved?.turn_id !== input.turnId || saved.thread_id !== input.threadId || saved.input_json !== inputJson) throw new AgentInputConflictError("Target selection conflicts with its saved turn");
    await validateTargetSelection(context, input.targetSelection, createDomainTools());
    const claimed = await env.DB.prepare("SELECT choice_turn_id,choice_request_id,chosen_record_id FROM me3_agent_presentations WHERE id=? AND owner_id=? AND thread_id=?").bind(input.targetSelection.presentationId, input.userId, input.threadId).first<{ choice_turn_id: string; choice_request_id: string; chosen_record_id: string }>();
    if (claimed?.choice_turn_id !== input.turnId || claimed.choice_request_id !== input.requestId || claimed.chosen_record_id !== input.targetSelection.candidateId) throw new AgentInputConflictError("Target selection was not admitted");
  } catch (error) { throw error instanceof AgentInputConflictError ? error : new AgentInputConflictError(error instanceof Error ? error.message : "Target selection is unavailable"); }
}

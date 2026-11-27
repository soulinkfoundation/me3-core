import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { rememberFromTurn } from "./agent-memory";
import { createAgentModels } from "./agent-runtime";
import { fastModelAllowed, ownerPublicPage } from "./owner-public-page";
import type { AgentDb } from "../../../packages/agent/src/types";
import type { Env } from "./types";

// A busy runtime finishes a turn without memory extraction and marks the turn here (me3-bybb.15).
// rememberDeferredTurns later reads several marked turns in one model call, when the runtime is quiet.
const MAX_TURNS_PER_BATCH = 8;
const MAX_MESSAGE_CHARS = 1_000;

export async function deferTurnMemory(db: AgentDb, ownerId: string, turnId: string): Promise<void> {
  await db.prepare("UPDATE me3_agent_turns SET trace_json=json_set(coalesce(trace_json,'{}'),'$.memoryDeferred',1) WHERE owner_id=? AND turn_id=?").bind(ownerId, turnId).run();
}

type DeferredTurn = { owner_id: string; thread_id: string; turn_id: string; request_id: string; owner_message: string | null };

/** Extracts memory from turns a busy runtime deferred, oldest first, one model call per owner. Returns the turns handled. */
export async function rememberDeferredTurns(env: Env, signal: AbortSignal): Promise<number> {
  if (env.ME3_AGENT_MEMORY?.trim() === "off") return 0;
  const turns = (await env.DB.prepare(
    `SELECT t.owner_id, t.thread_id, t.turn_id, t.request_id, m.content AS owner_message
     FROM me3_agent_turns t LEFT JOIN assistant_messages m ON m.id = t.turn_id || ':user'
     WHERE json_extract(t.trace_json,'$.memoryDeferred') = 1
     ORDER BY t.created_at, t.turn_id LIMIT ?`,
  ).bind(MAX_TURNS_PER_BATCH).all<DeferredTurn>()).results || [];
  if (!turns.length || !await fastModelAllowed(env)) return 0;
  let handled = 0;
  for (const ownerId of new Set(turns.map(turn => turn.owner_id))) {
    const batch = turns.filter(turn => turn.owner_id === ownerId);
    const last = batch.at(-1)!;
    // Cleared first: a failed extraction only means no memory from these turns, as for a live turn.
    await env.DB.batch(batch.map(turn => env.DB.prepare("UPDATE me3_agent_turns SET trace_json=json_remove(trace_json,'$.memoryDeferred') WHERE owner_id=? AND turn_id=?").bind(ownerId, turn.turn_id)));
    handled += batch.length;
    const messages = batch.map(turn => turn.owner_message?.trim()).filter((text): text is string => Boolean(text));
    if (!messages.length) continue;
    const owner = await env.DB.prepare("SELECT id, name, username, timezone, assistant_name FROM owner_profile WHERE id=?").bind(ownerId).first<{ id: string; name: string | null; username: string | null; timezone: string | null; assistant_name: string | null }>();
    if (!owner) continue;
    try {
      const snapshot = await loadOwnerSnapshotContext({ db: env.DB, ownerId, owner: { id: owner.id, name: owner.name, username: owner.username, timezone: owner.timezone || "UTC", assistantName: owner.assistant_name || "ME3" }, meJsonUrl: null, publicProfile: await ownerPublicPage(env) });
      const { modelFor } = await createAgentModels(env, { userId: ownerId, threadId: last.thread_id, turnId: `${last.turn_id}:memory-batch`, requestId: `${last.request_id}:memory-batch` });
      const ownerMessage = messages.length === 1 ? messages[0] : `The owner's messages from several recent turns, oldest first:\n${messages.map((text, index) => `${index + 1}. ${text.slice(0, MAX_MESSAGE_CHARS)}`).join("\n")}`;
      await rememberFromTurn(env.DB, modelFor(env.ME3_AGENT_FAST_MODEL?.trim() || "anthropic/claude-haiku-5.5", { purpose: "memory_extraction" }),
        { ownerId, turnId: last.turn_id, ownerMessage, ownerSnapshot: snapshot.prompt }, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    } catch (error) {
      console.error("Deferred memory extraction failed", error);
    }
  }
  return handled;
}

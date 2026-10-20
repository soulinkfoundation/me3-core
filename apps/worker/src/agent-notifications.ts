import { notifyAgentTurnReady } from "./push-notifications";
import { replyToOwnerInstruction } from "./mailbox-instructions";
import type { Env } from "./types";

export const AGENT_NOTIFICATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS me3_agent_chat_presence (
    owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, client_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL, PRIMARY KEY(owner_id, thread_id, client_id)
  )`,
  `CREATE TABLE IF NOT EXISTS me3_agent_notifications (
    owner_id TEXT NOT NULL, turn_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('complete','needs_you')),
    status TEXT NOT NULL CHECK(status IN ('pending','suppressed','relayed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(owner_id, turn_id)
  )`,
] as const;

type NotificationRow = { owner_id: string; turn_id: string; thread_id: string; kind: "complete" | "needs_you"; status: string };

export async function updateAgentChatPresence(env: Env, ownerId: string, threadId: string, clientId: string, watching: boolean) {
  const thread = await env.DB.prepare("SELECT id FROM assistant_threads WHERE owner_id=? AND id=? AND status='active'").bind(ownerId, threadId).first();
  if (!thread) return false;
  if (watching) {
    await env.DB.prepare(`INSERT INTO me3_agent_chat_presence(owner_id,thread_id,client_id,expires_at)
      VALUES(?,?,?,?) ON CONFLICT(owner_id,thread_id,client_id) DO UPDATE SET expires_at=excluded.expires_at`)
      .bind(ownerId, threadId, clientId, Date.now() + 60_000).run();
  } else {
    await env.DB.prepare("DELETE FROM me3_agent_chat_presence WHERE owner_id=? AND thread_id=? AND client_id=?").bind(ownerId, threadId, clientId).run();
  }
  return true;
}

export async function notifyAgentTurnFinished(env: Env, ownerId: string, turnId: string) {
  // A turn the owner started by email is answered by email too.
  await replyToOwnerInstruction(env, ownerId, turnId).catch((error: unknown) => {
    console.warn("Email reply to the owner was deferred", { turnId, error: error instanceof Error ? error.message : "Unknown reply error" });
  });
  try {
    const turn = await env.DB.prepare(`SELECT t.thread_id,t.status FROM me3_agent_turns t
      JOIN assistant_threads a ON a.id=t.thread_id AND a.owner_id=t.owner_id AND a.status='active'
      WHERE t.owner_id=? AND t.turn_id=? AND t.response_json IS NOT NULL`).bind(ownerId, turnId).first<{ thread_id: string; status: string }>();
    if (!turn || !["complete", "needs_approval", "failed"].includes(turn.status)) return;
    await decideAndRelay(env, ownerId, turnId, turn.thread_id, turn.status === "complete" ? "complete" : "needs_you", turn.status === "needs_approval");
  } catch (error) {
    // Notification infrastructure must never change a saved turn's outcome.
    console.warn("Agent notification was deferred", { turnId, error: error instanceof Error ? error.message : "Unknown notification error" });
  }
}

/**
 * Background work that finishes outside a chat turn (computer jobs) uses the same
 * per-result decision, presence suppression, relay and retries. `resultId` is the
 * prefix of the assistant message the client anchors to.
 */
export async function notifyAgentBackgroundResult(env: Env, ownerId: string, result: { resultId: string; threadId: string; kind: "complete" | "needs_you" }) {
  try {
    const thread = await env.DB.prepare("SELECT id FROM assistant_threads WHERE owner_id=? AND id=? AND status='active'").bind(ownerId, result.threadId).first();
    if (!thread) return;
    await decideAndRelay(env, ownerId, result.resultId, result.threadId, result.kind, result.kind === "needs_you");
  } catch (error) {
    console.warn("Agent notification was deferred", { resultId: result.resultId, error: error instanceof Error ? error.message : "Unknown notification error" });
  }
}

async function decideAndRelay(env: Env, ownerId: string, turnId: string, threadId: string, kind: "complete" | "needs_you", pause: boolean) {
  let notification = await env.DB.prepare("SELECT * FROM me3_agent_notifications WHERE owner_id=? AND turn_id=?").bind(ownerId, turnId).first<NotificationRow>();
  if (!notification) {
    const watching = await env.DB.prepare("SELECT client_id FROM me3_agent_chat_presence WHERE owner_id=? AND thread_id=? AND expires_at>? LIMIT 1").bind(ownerId, threadId, Date.now()).first();
    // A watched approval can still finish later while the owner is away.
    if (watching && pause) return;
    await env.DB.prepare(`INSERT OR IGNORE INTO me3_agent_notifications(owner_id,turn_id,thread_id,kind,status) VALUES(?,?,?,?,?)`)
      .bind(ownerId, turnId, threadId, kind, watching ? "suppressed" : "pending").run();
    notification = await env.DB.prepare("SELECT * FROM me3_agent_notifications WHERE owner_id=? AND turn_id=?").bind(ownerId, turnId).first<NotificationRow>();
  }
  if (notification?.status === "pending") await relayNotification(env, notification);
}

async function relayNotification(env: Env, row: NotificationRow) {
  const active = await env.DB.prepare("SELECT id FROM assistant_threads WHERE owner_id=? AND id=? AND status='active'").bind(row.owner_id, row.thread_id).first();
  if (!active) {
    await env.DB.prepare("UPDATE me3_agent_notifications SET status='suppressed' WHERE owner_id=? AND turn_id=? AND status='pending'").bind(row.owner_id, row.turn_id).run();
    return;
  }
  const result = await notifyAgentTurnReady(env, { threadId: row.thread_id, turnId: row.turn_id, kind: row.kind });
  if (result.ok && !result.retryable) {
    await env.DB.prepare("UPDATE me3_agent_notifications SET status='relayed' WHERE owner_id=? AND turn_id=? AND status='pending'").bind(row.owner_id, row.turn_id).run();
  }
}

export async function retryAgentTurnNotifications(env: Env) {
  const rows = await env.DB.prepare("SELECT * FROM me3_agent_notifications WHERE status='pending' ORDER BY created_at LIMIT 50").all<NotificationRow>();
  for (const row of rows.results || []) {
    await relayNotification(env, row).catch(() => undefined);
  }
  await env.DB.prepare("DELETE FROM me3_agent_chat_presence WHERE expires_at<=?").bind(Date.now()).run();
}

import type { Env } from "./types";

export type AssistantThreadRow = {
  id: string;
  owner_id: string;
  title: string;
  origin_surface: "assistant" | "launcher" | "soulink" | "job" | "system";
  project_id: string | null;
  status: "active" | "archived" | "deleted";
  pinned_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function getPrimaryAssistantThread(env: Env, ownerId: string) {
  return env.DB.prepare(`SELECT t.* FROM assistant_primary_threads p
    JOIN assistant_threads t ON t.id = p.thread_id AND t.owner_id = p.owner_id
    WHERE p.owner_id = ? AND t.status = 'active' AND t.project_id IS NULL`)
    .bind(ownerId).first<AssistantThreadRow>();
}

export async function resolvePrimaryAssistantThread(env: Env, ownerId: string): Promise<AssistantThreadRow> {
  const existing = await getPrimaryAssistantThread(env, ownerId);
  if (existing) return existing;

  // D1 batches are atomic. Choose the mapping before inserting its thread so
  // competing first requests cannot leave duplicate, empty main conversations.
  // The deferred FK is satisfied by the second statement before commit.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO assistant_primary_threads(owner_id, thread_id)
      VALUES (?, COALESCE((
        SELECT t.id FROM assistant_threads t
        LEFT JOIN agent_channel_connections c
          ON c.user_id = t.owner_id AND c.channel = 'soulink' AND c.status = 'active'
        WHERE t.owner_id = ? AND t.status = 'active' AND t.project_id IS NULL
          AND (t.id = 'soulink:' || c.provider_thread_id OR t.id = c.provider_thread_id
            OR t.origin_surface IN ('assistant', 'launcher'))
        ORDER BY CASE WHEN t.id = 'soulink:' || c.provider_thread_id THEN 0
                      WHEN t.id = c.provider_thread_id THEN 1 ELSE 2 END,
                 t.last_message_at DESC, t.updated_at DESC, t.id
        LIMIT 1
      ), ?))
      ON CONFLICT(owner_id) DO UPDATE SET thread_id = excluded.thread_id
      WHERE NOT EXISTS (
        SELECT 1 FROM assistant_threads t
        WHERE t.id = assistant_primary_threads.thread_id
          AND t.owner_id = assistant_primary_threads.owner_id
          AND t.status = 'active' AND t.project_id IS NULL
      )`).bind(ownerId, ownerId, crypto.randomUUID()),
    env.DB.prepare(`INSERT INTO assistant_threads(id, owner_id, title, origin_surface, status)
      SELECT thread_id, owner_id, 'ME3', 'assistant', 'active'
      FROM assistant_primary_threads WHERE owner_id = ?
      ON CONFLICT(id) DO NOTHING`).bind(ownerId),
  ]);
  const thread = await getPrimaryAssistantThread(env, ownerId);
  if (!thread) throw new Error("The main assistant conversation could not be prepared. Try again.");
  return thread;
}

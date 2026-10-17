import type { Env } from "./types";

export const MAILBOX_ATTACHMENT_STAGING_SQL = `CREATE TABLE IF NOT EXISTS mailbox_attachment_staging (
  message_id TEXT PRIMARY KEY,
  storage_keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

// Record every intended key before the first R2 write, including writes whose
// response may be lost. The message transaction removes this record on commit.
// A later call for the same message replaces the list, so pass every key.
export async function stageMailboxAttachmentKeys(env: Env, messageId: string, keys: string[]) {
  if (!keys.length) return;
  await env.DB.prepare(
    `INSERT INTO mailbox_attachment_staging (message_id, storage_keys_json, created_at) VALUES (?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET storage_keys_json = excluded.storage_keys_json`,
  )
    .bind(messageId, JSON.stringify(keys), new Date().toISOString()).run();
}

export function finishMailboxAttachmentStaging(env: Env, messageId: string) {
  return env.DB.prepare(`DELETE FROM mailbox_attachment_staging WHERE message_id = ?`).bind(messageId);
}

export async function cleanMailboxAttachmentStaging(env: Env, messageId: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT storage_keys_json FROM mailbox_attachment_staging WHERE message_id = ?`)
    .bind(messageId).first<{ storage_keys_json: string }>();
  if (!row) return;
  // A D1 commit may have succeeded even if its response was lost. Never delete
  // attachments belonging to a persisted message.
  const message = await env.DB.prepare(`SELECT id FROM mailbox_messages WHERE id = ?`)
    .bind(messageId).first<{ id: string }>();
  if (!message) {
    if (!env.SITE_ASSETS) return;
    const keys: string[] = JSON.parse(row.storage_keys_json);
    if (keys.length) await env.SITE_ASSETS.delete(keys);
  }
  await finishMailboxAttachmentStaging(env, messageId).run();
}

export async function reconcileMailboxAttachmentStaging(env: Env, now = new Date()): Promise<void> {
  if (!env.SITE_ASSETS) return;
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(`SELECT message_id FROM mailbox_attachment_staging WHERE created_at < ? ORDER BY created_at LIMIT 100`)
    .bind(cutoff).all<{ message_id: string }>();
  for (const row of rows.results || []) {
    await cleanMailboxAttachmentStaging(env, row.message_id).catch((error) => {
      console.error("Mailbox attachment cleanup deferred", error);
    });
  }
}

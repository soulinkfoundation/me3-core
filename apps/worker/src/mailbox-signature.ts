import type { Env } from "./types";

// The owner's email signature: light Markdown added to new mail, replies and
// forwards in the web compose. Stored on the owner's mailbox row.

export const MAX_MAILBOX_SIGNATURE_LENGTH = 2000;

export async function getMailboxSignature(env: Env, ownerId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT signature FROM mailbox_aliases WHERE user_id = ? LIMIT 1")
    .bind(ownerId)
    .first<{ signature: string | null }>();
  return row?.signature?.trim() || null;
}

export function normalizeMailboxSignature(value: unknown): string | null | { error: string } {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return { error: "Signature must be text" };
  const signature = value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
  if (signature.length > MAX_MAILBOX_SIGNATURE_LENGTH) {
    return { error: `Keep the signature under ${MAX_MAILBOX_SIGNATURE_LENGTH} characters` };
  }
  return signature || null;
}

export async function saveMailboxSignature(
  env: Env,
  ownerId: string,
  signature: string | null,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE mailbox_aliases SET signature = ?, updated_at = ? WHERE user_id = ?",
  )
    .bind(signature, new Date().toISOString(), ownerId)
    .run();
  return (result.meta?.changes || 0) > 0;
}

import {
  EmailProviderInputError,
  normalizeEmailProviderId,
  sendEmailWithProvider,
} from "./email-providers";
import { MANAGED_EMAIL_PROVIDER_ID } from "./managed-email-outbound";
import { constantTimeEqual, sha256Text } from "./sites";
import type { Env } from "./types";

/**
 * Send-as addresses (me3-lmax): addresses the owner forwards into ME3, such as a
 * work address, that they may also send from. Each address names the provider
 * that can sign for its domain. Adding one sends a code from the address to
 * itself through that provider; the forward brings it back to the ME3 inbox and
 * the owner types it in. One send proves both the forward and the sender.
 */

const CODE_TTL_MS = 30 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_IDENTITIES = 20;

export type EmailSendIdentity = {
  id: string;
  address: string;
  displayName: string;
  providerId: string;
  status: "pending" | "verified";
  verifiedAt: string | null;
  codeSentAt: string | null;
  createdAt: string;
};

type DbEmailSendIdentity = {
  id: string;
  user_id: string;
  address: string;
  display_name: string;
  provider_id: string;
  status: string;
  code_hash: string | null;
  code_expires_at: string | null;
  code_attempts: number;
  code_sent_at: string | null;
  verified_at: string | null;
  created_at: string;
};

function serialize(row: DbEmailSendIdentity): EmailSendIdentity {
  return {
    id: row.id,
    address: row.address,
    displayName: row.display_name,
    providerId: row.provider_id,
    status: row.status === "verified" ? "verified" : "pending",
    verifiedAt: row.verified_at,
    codeSentAt: row.code_sent_at,
    createdAt: row.created_at,
  };
}

function normalizeAddress(value: unknown): string | null {
  const address = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@<>,;:"()]+@[^\s@<>,;:"()]+\.[^\s@<>,;:"()]+$/.test(address) && address.length <= 254
    ? address
    : null;
}

function normalizeDisplayName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, 128) : "";
}

function createCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function hashCode(identityId: string, code: string): Promise<string> {
  return sha256Text(`${identityId}:${code}`);
}

async function getRow(env: Env, ownerId: string, id: string): Promise<DbEmailSendIdentity | null> {
  return env.DB.prepare("SELECT * FROM email_send_identities WHERE id = ? AND user_id = ?")
    .bind(id, ownerId)
    .first<DbEmailSendIdentity>();
}

export async function listEmailSendIdentities(env: Env, ownerId: string): Promise<EmailSendIdentity[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM email_send_identities WHERE user_id = ? ORDER BY created_at, address",
  )
    .bind(ownerId)
    .all<DbEmailSendIdentity>();
  return (rows.results || []).map(serialize);
}

export async function listVerifiedSendAddresses(env: Env, ownerId: string): Promise<EmailSendIdentity[]> {
  try {
    return (await listEmailSendIdentities(env, ownerId)).filter((identity) => identity.status === "verified");
  } catch {
    return [];
  }
}

export async function createEmailSendIdentity(
  env: Env,
  ownerId: string,
  input: unknown,
): Promise<EmailSendIdentity> {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const address = normalizeAddress(body.address);
  if (!address) throw new EmailProviderInputError("Enter a valid email address");
  if (address.endsWith("@me3.app") || address.endsWith("@me3.local")) {
    throw new EmailProviderInputError("Your ME3 address is already a sender");
  }
  const providerId = normalizeEmailProviderId(body.providerId);
  if (!providerId || providerId === MANAGED_EMAIL_PROVIDER_ID) {
    throw new EmailProviderInputError("Choose the email service that sends for this address");
  }

  const existing = await env.DB.prepare(
    "SELECT * FROM email_send_identities WHERE user_id = ? AND address = ?",
  )
    .bind(ownerId, address)
    .first<DbEmailSendIdentity>();
  if (existing?.status === "verified") {
    throw new EmailProviderInputError("This address is already a sender", 409);
  }
  if (!existing) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM email_send_identities WHERE user_id = ?")
      .bind(ownerId)
      .first<{ count: number }>();
    if ((count?.count || 0) >= MAX_IDENTITIES) {
      throw new EmailProviderInputError("You have reached the limit of send-as addresses", 409);
    }
  }

  const id = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO email_send_identities (id, user_id, address, display_name, provider_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT (user_id, address) DO UPDATE SET
       display_name = excluded.display_name, provider_id = excluded.provider_id, updated_at = excluded.updated_at`,
  )
    .bind(id, ownerId, address, normalizeDisplayName(body.displayName), providerId, now, now)
    .run();

  return sendEmailSendIdentityCode(env, ownerId, id, { ignoreInterval: true });
}

export async function sendEmailSendIdentityCode(
  env: Env,
  ownerId: string,
  id: string,
  options: { ignoreInterval?: boolean } = {},
): Promise<EmailSendIdentity> {
  const row = await getRow(env, ownerId, id);
  if (!row) throw new EmailProviderInputError("Send-as address not found", 404);
  if (row.status === "verified") return serialize(row);
  if (
    !options.ignoreInterval &&
    row.code_sent_at &&
    Date.now() - Date.parse(row.code_sent_at) < RESEND_INTERVAL_MS
  ) {
    throw new EmailProviderInputError("Wait a minute before sending another code", 429);
  }

  const code = createCode();
  const now = new Date();
  const sentAt = now.toISOString();
  const providerId = normalizeEmailProviderId(row.provider_id);
  if (!providerId) throw new EmailProviderInputError("Choose the email service that sends for this address");

  // Sent before the code is stored, so a provider that cannot send as this
  // address leaves no code behind and the owner sees the provider's reason.
  await sendEmailWithProvider(env, ownerId, {
    providerId,
    purpose: "workflow",
    operationId: `send-as-code:${row.id}:${sentAt}`,
    fromAddress: row.address,
    fromName: row.display_name || null,
    replyToAddress: row.address,
    toAddress: row.address,
    subject: `Your ME3 code: ${code}`,
    textBody: [
      `Your code is ${code}.`,
      "",
      `Enter it in ME3 to send email as ${row.address}. It expires in 30 minutes.`,
      "If you did not ask for this, you can ignore this email.",
    ].join("\n"),
    metadata: { me3_action: "send_as_verification", send_identity_id: row.id },
    createdBy: "owner",
    approvedByUserId: ownerId,
  }).catch((error) => {
    // A provider's 401/403 is about its credentials, not the owner's ME3 session.
    if (error instanceof EmailProviderInputError && (error.status === 401 || error.status === 403)) {
      throw new EmailProviderInputError(error.message, 422);
    }
    throw error;
  });

  await env.DB.prepare(
    `UPDATE email_send_identities
     SET code_hash = ?, code_expires_at = ?, code_attempts = 0, code_sent_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'pending'`,
  )
    .bind(await hashCode(row.id, code), new Date(now.getTime() + CODE_TTL_MS).toISOString(), sentAt, sentAt, row.id, ownerId)
    .run();

  return serialize((await getRow(env, ownerId, id))!);
}

export async function verifyEmailSendIdentity(
  env: Env,
  ownerId: string,
  id: string,
  input: unknown,
): Promise<EmailSendIdentity> {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  const row = await getRow(env, ownerId, id);
  if (!row) throw new EmailProviderInputError("Send-as address not found", 404);
  if (row.status === "verified") return serialize(row);
  if (!row.code_hash || !row.code_expires_at || Date.parse(row.code_expires_at) < Date.now()) {
    throw new EmailProviderInputError("This code has expired. Send a new one.", 410);
  }
  if (row.code_attempts >= MAX_CODE_ATTEMPTS) {
    throw new EmailProviderInputError("Too many wrong codes. Send a new one.", 429);
  }
  if (!/^\d{6}$/.test(code) || !constantTimeEqual(await hashCode(row.id, code), row.code_hash)) {
    await env.DB.prepare(
      "UPDATE email_send_identities SET code_attempts = code_attempts + 1, updated_at = ? WHERE id = ? AND user_id = ?",
    )
      .bind(new Date().toISOString(), row.id, ownerId)
      .run();
    throw new EmailProviderInputError("That code is not right", 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE email_send_identities
     SET status = 'verified', verified_at = ?, code_hash = NULL, code_expires_at = NULL, code_attempts = 0, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(now, now, row.id, ownerId)
    .run();
  return serialize((await getRow(env, ownerId, id))!);
}

export async function deleteEmailSendIdentity(env: Env, ownerId: string, id: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM email_send_identities WHERE id = ? AND user_id = ?")
    .bind(id, ownerId)
    .run();
  return (result.meta?.changes || 0) > 0;
}

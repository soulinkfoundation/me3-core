import { getOrCreateInstallSessionSecret } from "./install-secrets";
import { sha256Text } from "./sites";
import type { Env } from "./types";

export const OWNER_CREDENTIAL_GENERATION_NAME = "OWNER_CREDENTIAL_GENERATION";

/**
 * Owner credentials (web session cookies, mobile refresh tokens and pending ME3 claims) record
 * the generation they were issued under. Setting up, changing or resetting the password and
 * "sign out everywhere" advance the counter. The session secret's fingerprint is part of the
 * generation, so rotating JWT_SECRET retires mobile refresh tokens as well as cookies.
 */
export async function getOwnerCredentialGeneration(env: Env): Promise<string> {
  const counter = await readCredentialCounter(env);
  const fingerprint = (await sha256Text(await getOrCreateInstallSessionSecret(env))).slice(0, 16);
  return `${counter}.${fingerprint}`;
}

export async function isCurrentOwnerCredentialGeneration(
  env: Env,
  issuedGeneration: unknown,
): Promise<boolean> {
  if (typeof issuedGeneration === "string" && issuedGeneration) {
    return issuedGeneration === (await getOwnerCredentialGeneration(env));
  }
  // Credentials issued before generations existed stay valid until the first credential reset,
  // so deploying this does not sign anyone out.
  return (await readCredentialCounter(env)) === 0;
}

/**
 * Retires every outstanding owner credential: older session cookies stop verifying, active
 * mobile refresh tokens are revoked and pending ME3 claims are dropped. `keepMobileTokenId`
 * keeps the device that made the change signed in.
 */
export async function advanceOwnerCredentialGeneration(
  env: Env,
  options: { keepMobileTokenId?: string | null } = {},
): Promise<string> {
  const next = (await readCredentialCounter(env)) + 1;
  await env.DB.prepare(
    `INSERT INTO install_secrets (name, value, created_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(OWNER_CREDENTIAL_GENERATION_NAME, String(next))
    .run();

  const generation = await getOwnerCredentialGeneration(env);
  const now = new Date().toISOString();
  const keepId = options.keepMobileTokenId || "";
  await env.DB.prepare(
    `UPDATE mobile_refresh_tokens
     SET status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE status = 'active' AND id != ?`,
  )
    .bind(now, now, keepId)
    .run();
  if (keepId) {
    await env.DB.prepare(
      `UPDATE mobile_refresh_tokens
       SET credential_generation = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
    )
      .bind(generation, now, keepId)
      .run();
  }
  await deleteAllMe3ClaimStates(env);
  return generation;
}

export async function deleteAllMe3ClaimStates(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM me3_install_claim_states").bind().run();
}

async function readCredentialCounter(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
    .bind(OWNER_CREDENTIAL_GENERATION_NAME)
    .first<{ value: string }>();
  const counter = Number.parseInt(row?.value || "0", 10);
  return Number.isSafeInteger(counter) && counter > 0 ? counter : 0;
}

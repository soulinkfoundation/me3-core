import { getOrCreateInstallSessionSecret } from "./install-secrets";
import { verifyMe3CloudJwt } from "./me3-cloud-jwt";
import {
  getOwnerCredentialGeneration,
  isCurrentOwnerCredentialGeneration,
} from "./owner-credentials";
import {
  getStoredMe3CloudOwnerId,
  getOwnerProfile,
  normalizeNullableText,
  sha256Text,
} from "./sites";
import type { Env } from "./types";

export class MobilePairingInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 501 = 400,
  ) {
    super(message);
  }
}

type MobileDeviceDescriptor = {
  id: string;
  name: string;
  platform: string;
  appVersion: string | null;
};

type MobilePairingStatus = "pending" | "approved" | "claimed" | "expired" | "revoked";

type MobilePairingRow = {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  platform: string;
  app_version: string | null;
  code_hash: string;
  status: MobilePairingStatus;
  expires_at: string;
  approved_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

type MobileRefreshTokenRow = {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  platform: string;
  app_version: string | null;
  token_hash: string;
  status: "active" | "rotated" | "revoked";
  scope_json: string;
  expires_at: string;
  last_used_at: string | null;
  credential_generation: string | null;
  created_at: string;
  updated_at: string;
};

type MobileAccessPayload = {
  typ: "me3_mobile_access";
  sub: string;
  did: string;
  rid: string;
  scope: string[];
  iat: number;
  exp: number;
};

type HostedMobileSessionPayload = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  typ?: unknown;
  email?: unknown;
  handle?: unknown;
  install_ids?: unknown;
  scope?: unknown;
  iat?: unknown;
  exp?: unknown;
  jti?: unknown;
};

type MobileOriginOptions = {
  apiOrigin: string;
  webOrigin: string;
};

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const PAIRING_TTL_SECONDS = 10 * 60;
const ME3_CORE_INSTALL_ID_SECRET_NAME = "ME3_CORE_INSTALL_ID";
const ME3_CORE_INSTALL_ID_REGEX =
  /^core_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MOBILE_ACCESS_TOKEN_PREFIX = "me3mat_";
const MOBILE_REFRESH_TOKEN_PREFIX = "me3mrt_";
const MOBILE_SCOPE = [
  "mobile.v1",
  "assistant",
  "mission-control",
  "calendar",
  "journal",
  "mailbox",
  "sites",
  "account",
];

export async function getMobileConfig(env: Env, origins: MobileOriginOptions) {
  const install = await getMobileInstallDescriptor(env, origins);
  return {
    installId: install.id,
    label: install.label,
    publicURL: install.publicURL,
    mobileApiVersion: 1,
    capabilities: {
      assistant: true,
      missionControl: true,
      calendar: true,
      journal: true,
      mailbox: true,
      sites: true,
      account: true,
    },
    auth: {
      pairing: "owner-approved-code",
      tokenEndpoint: "/api/mobile/token",
      refreshEndpoint: "/api/mobile/token/refresh",
      revokeEndpoint: "/api/mobile/token/revoke",
    },
  };
}

export async function startMobilePairing(
  env: Env,
  input: unknown,
  origins: MobileOriginOptions,
) {
  const device = normalizeDeviceDescriptor(isRecord(input) ? input.device : null);
  const pairingId = crypto.randomUUID();
  const userCode = createUserCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO mobile_pairings
       (id, user_id, device_id, device_name, platform, app_version, code_hash, status, expires_at, created_at, updated_at)
     VALUES (?, 'owner', ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      pairingId,
      device.id,
      device.name,
      device.platform,
      device.appVersion,
      await pairingCodeHash(pairingId, userCode),
      expiresAt,
    )
    .run();

  return {
    pairingId,
    verificationURL: `${origins.webOrigin}/mobile/pair/${encodeURIComponent(pairingId)}`,
    userCode: formatUserCode(userCode),
    expiresIn: PAIRING_TTL_SECONDS,
  };
}

export async function getMobilePairingApproval(
  env: Env,
  ownerId: string,
  pairingId: string,
) {
  const row = await requireMobilePairing(env, ownerId, pairingId);
  const current = await expirePairingIfNeeded(env, row);
  return { ok: true, pairing: serializePairing(current) };
}

export async function approveMobilePairing(
  env: Env,
  ownerId: string,
  pairingId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const userCode = normalizeUserCode(body.userCode ?? body.code);
  if (!userCode) throw new MobilePairingInputError("Verification code is required");

  const row = await requireMobilePairing(env, ownerId, pairingId);
  const current = await expirePairingIfNeeded(env, row);
  if (current.status !== "pending") {
    throw new MobilePairingInputError("This pairing is no longer pending", 409);
  }
  if (!(await pairingCodeMatches(current, userCode))) {
    throw new MobilePairingInputError("Verification code was not accepted", 401);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE mobile_pairings
     SET status = 'approved', approved_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'pending'`,
  )
    .bind(now, now, current.id, ownerId)
    .run();

  return {
    ok: true,
    pairing: serializePairing({
      ...current,
      status: "approved",
      approved_at: now,
      updated_at: now,
    }),
  };
}

export async function claimMobilePairing(
  env: Env,
  input: unknown,
  origins: MobileOriginOptions,
) {
  const body = isRecord(input) ? input : {};
  const pairingId = normalizeNullableText(body.pairingId);
  const userCode = normalizeUserCode(body.userCode);
  const deviceId = normalizeNullableText(body.deviceId);
  if (!pairingId) throw new MobilePairingInputError("Pairing id is required");
  if (!userCode) throw new MobilePairingInputError("Verification code is required");
  if (!deviceId) throw new MobilePairingInputError("Device id is required");

  const row = await getMobilePairing(env, pairingId);
  if (!row) throw new MobilePairingInputError("Pairing was not found", 404);
  const current = await expirePairingIfNeeded(env, row);
  if (current.status === "pending") {
    throw new MobilePairingInputError("Approve this pairing in ME3 first", 409);
  }
  if (current.status !== "approved") {
    throw new MobilePairingInputError("This pairing can no longer be claimed", 409);
  }
  if (current.device_id !== deviceId) {
    throw new MobilePairingInputError("Device was not accepted", 401);
  }
  if (!(await pairingCodeMatches(current, userCode))) {
    throw new MobilePairingInputError("Verification code was not accepted", 401);
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE mobile_pairings
     SET status = 'claimed', claimed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'approved'`,
  )
    .bind(now, now, current.id)
    .run();
  if ((result.meta?.changes || 0) < 1) {
    throw new MobilePairingInputError("This pairing can no longer be claimed", 409);
  }

  return issueMobileTokens(env, current.user_id, {
    id: current.device_id,
    name: current.device_name,
    platform: current.platform,
    appVersion: current.app_version,
  }, origins);
}

export async function claimMobileTokenFromHostedSession(
  env: Env,
  input: unknown,
  origins: MobileOriginOptions,
) {
  const body = isRecord(input) ? input : {};
  if (normalizeNullableText(body.grant_type) !== "me3_app_claim") {
    throw new MobilePairingInputError("Unsupported mobile token grant", 400);
  }

  const requestedInstallId = normalizeMe3InstallId(body.installId ?? body.install_id);
  if (!requestedInstallId) throw new MobilePairingInputError("Install id is required");

  const localInstallId = await getOrCreateMe3InstallId(env);
  if (requestedInstallId !== localInstallId) {
    throw new MobilePairingInputError("Hosted ME3 session is for a different install", 403);
  }

  const sessionToken = normalizeNullableText(
    body.me3SessionToken ?? body.me3_session_token,
  );
  if (!sessionToken) {
    throw new MobilePairingInputError("Hosted ME3 session token is required", 401);
  }

  let payload: HostedMobileSessionPayload;
  try {
    payload = await verifyMe3CloudJwt<HostedMobileSessionPayload>(env, sessionToken);
  } catch {
    throw new MobilePairingInputError("Hosted ME3 session was not accepted", 401);
  }

  if (!hostedSessionAllowsInstall(payload, localInstallId)) {
    throw new MobilePairingInputError("Hosted ME3 session is not allowed for this install", 403);
  }

  const storedCloudOwnerId = await getStoredMe3CloudOwnerId(env).catch(() => null);
  if (storedCloudOwnerId && payload.sub !== storedCloudOwnerId) {
    throw new MobilePairingInputError("Hosted ME3 session is not allowed for this owner", 403);
  }

  const deviceInput = isRecord(body.device)
    ? body.device
    : {
        id: body.deviceId ?? body.device_id,
        name: body.deviceName ?? body.device_name,
        platform: body.platform,
        appVersion: body.appVersion ?? body.app_version,
      };
  return issueMobileTokens(env, "owner", normalizeDeviceDescriptor(deviceInput), origins);
}

export async function refreshMobileToken(
  env: Env,
  input: unknown,
  origins: MobileOriginOptions,
) {
  const body = isRecord(input) ? input : {};
  const refreshToken = normalizeNullableText(body.refreshToken);
  const deviceId = normalizeNullableText(body.deviceId);
  if (!refreshToken) throw new MobilePairingInputError("Refresh token is required", 401);
  if (!deviceId) throw new MobilePairingInputError("Device id is required", 401);

  const row = await requireRefreshTokenRow(env, refreshToken, deviceId);
  const newRefreshToken = createRefreshToken(row.id);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `UPDATE mobile_refresh_tokens
     SET token_hash = ?, expires_at = ?, last_used_at = ?, updated_at = ?, credential_generation = ?
     WHERE id = ? AND status = 'active'`,
  )
    .bind(
      await sha256Text(newRefreshToken),
      expiresAt,
      now,
      now,
      await getOwnerCredentialGeneration(env),
      row.id,
    )
    .run();

  return {
    accessToken: await signMobileAccessToken(env, {
      sub: row.user_id,
      did: row.device_id,
      rid: row.id,
      scope: parseScope(row.scope_json),
      iat: currentUnixTime(),
      exp: currentUnixTime() + ACCESS_TOKEN_TTL_SECONDS,
      typ: "me3_mobile_access",
    }),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: newRefreshToken,
    scope: parseScope(row.scope_json),
    install: await getMobileInstallDescriptor(env, origins),
  };
}

export async function revokeMobileToken(env: Env, input: unknown) {
  const body = isRecord(input) ? input : {};
  const refreshToken = normalizeNullableText(body.refreshToken);
  const deviceId = normalizeNullableText(body.deviceId);
  if (!refreshToken || !deviceId) return { revoked: true };

  const tokenId = refreshTokenIdFromToken(refreshToken);
  if (!tokenId) return { revoked: true };

  const row = await env.DB.prepare(
    `SELECT *
     FROM mobile_refresh_tokens
     WHERE id = ? AND device_id = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(tokenId, deviceId)
    .first<MobileRefreshTokenRow>();

  if (row && constantTimeEqual(await sha256Text(refreshToken), row.token_hash)) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE mobile_refresh_tokens
       SET status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(now, now, row.id)
      .run();
  }

  return { revoked: true };
}

export async function authenticateMobileOwner(
  env: Env,
  authorizationHeader: string | null,
): Promise<string | null> {
  return (await authenticateMobileSession(env, authorizationHeader))?.ownerId || null;
}

/** The owner and refresh-token row behind a mobile bearer, so a route can act on that device. */
export async function authenticateMobileSession(
  env: Env,
  authorizationHeader: string | null,
): Promise<{ ownerId: string; refreshTokenId: string } | null> {
  const token = bearerToken(authorizationHeader);
  if (!token) return null;

  try {
    const payload = await verifyMobileAccessToken(env, token);
    return payload?.sub ? { ownerId: payload.sub, refreshTokenId: payload.rid } : null;
  } catch {
    return null;
  }
}

/** Signs one device out: its refresh token stops refreshing and its access tokens stop verifying. */
export async function revokeMobileRefreshTokenById(env: Env, refreshTokenId: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE mobile_refresh_tokens
     SET status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(now, now, refreshTokenId)
    .run();
}

async function issueMobileTokens(
  env: Env,
  ownerId: string,
  device: MobileDeviceDescriptor,
  origins: MobileOriginOptions,
) {
  const refreshTokenId = crypto.randomUUID();
  const refreshToken = createRefreshToken(refreshTokenId);
  const now = new Date().toISOString();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `UPDATE mobile_refresh_tokens
     SET status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE user_id = ? AND device_id = ? AND status = 'active'`,
  )
    .bind(now, now, ownerId, device.id)
    .run();

  await env.DB.prepare(
    `INSERT INTO mobile_refresh_tokens
       (id, user_id, device_id, device_name, platform, app_version, token_hash, status, scope_json, expires_at, created_at, updated_at, credential_generation)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  )
    .bind(
      refreshTokenId,
      ownerId,
      device.id,
      device.name,
      device.platform,
      device.appVersion,
      await sha256Text(refreshToken),
      JSON.stringify(MOBILE_SCOPE),
      refreshExpiresAt,
      now,
      now,
      await getOwnerCredentialGeneration(env),
    )
    .run();

  return {
    accessToken: await signMobileAccessToken(env, {
      sub: ownerId,
      did: device.id,
      rid: refreshTokenId,
      scope: MOBILE_SCOPE,
      iat: currentUnixTime(),
      exp: currentUnixTime() + ACCESS_TOKEN_TTL_SECONDS,
      typ: "me3_mobile_access",
    }),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    scope: MOBILE_SCOPE,
    install: await getMobileInstallDescriptor(env, origins),
  };
}

async function verifyMobileAccessToken(
  env: Env,
  token: string,
): Promise<MobileAccessPayload | null> {
  if (!token.startsWith(MOBILE_ACCESS_TOKEN_PREFIX)) return null;
  const compact = token.slice(MOBILE_ACCESS_TOKEN_PREFIX.length);
  const [encodedPayload, encodedSignature] = compact.split(".");
  if (!encodedPayload || !encodedSignature) return null;

  const expectedSignature = encodeBase64Url(
    await hmacSha256(encodedPayload, await getOrCreateInstallSessionSecret(env)),
  );
  if (!(await constantTimeHashEqual(encodedSignature, expectedSignature))) return null;

  const payload = parseAccessPayload(decodeBase64Url(encodedPayload));
  if (!payload || payload.exp <= currentUnixTime()) return null;

  const row = await env.DB.prepare(
    `SELECT id, device_id, status, expires_at, credential_generation
     FROM mobile_refresh_tokens
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(payload.rid)
    .first<
      Pick<
        MobileRefreshTokenRow,
        "id" | "device_id" | "status" | "expires_at" | "credential_generation"
      >
    >();
  if (
    !row ||
    row.status !== "active" ||
    row.device_id !== payload.did ||
    Date.parse(row.expires_at) <= Date.now() ||
    !(await isCurrentOwnerCredentialGeneration(env, row.credential_generation))
  ) {
    return null;
  }

  return payload;
}

async function signMobileAccessToken(env: Env, payload: MobileAccessPayload): Promise<string> {
  const encodedPayload = encodeBase64UrlJson(payload);
  const signature = encodeBase64Url(
    await hmacSha256(encodedPayload, await getOrCreateInstallSessionSecret(env)),
  );
  return `${MOBILE_ACCESS_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}

async function requireRefreshTokenRow(
  env: Env,
  refreshToken: string,
  deviceId: string,
): Promise<MobileRefreshTokenRow> {
  const tokenId = refreshTokenIdFromToken(refreshToken);
  if (!tokenId) throw new MobilePairingInputError("Refresh token was not accepted", 401);

  const row = await env.DB.prepare(
    `SELECT *
     FROM mobile_refresh_tokens
     WHERE id = ? AND device_id = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(tokenId, deviceId)
    .first<MobileRefreshTokenRow>();
  if (!row) throw new MobilePairingInputError("Refresh token was not accepted", 401);
  if (Date.parse(row.expires_at) <= Date.now()) {
    throw new MobilePairingInputError("Refresh token has expired", 401);
  }
  if (!constantTimeEqual(await sha256Text(refreshToken), row.token_hash)) {
    throw new MobilePairingInputError("Refresh token was not accepted", 401);
  }
  // A password change, reset, "sign out everywhere" or session-secret rotation retires the token.
  if (!(await isCurrentOwnerCredentialGeneration(env, row.credential_generation))) {
    throw new MobilePairingInputError("Refresh token was not accepted", 401);
  }

  return row;
}

async function getMobileInstallDescriptor(env: Env, origins: MobileOriginOptions) {
  const owner = await getOwnerProfile(env, "owner").catch(() => null);
  const label = mobileInstallLabel(owner?.name || null);

  return {
    id: await getOrCreateMe3InstallId(env),
    label,
    apiBaseURL: `${origins.apiOrigin}/api`,
    publicURL: origins.webOrigin,
    capabilities: MOBILE_SCOPE,
  };
}

function mobileInstallLabel(ownerName: string | null): string {
  const name = ownerName?.trim();
  if (!name || /^ME3(?: Core)? Owner$/i.test(name)) return "ME3";
  if (/ME3$/i.test(name)) return name;
  return `${name}'s ME3`;
}

async function getOrCreateMe3InstallId(env: Env): Promise<string> {
  const stored = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
    .bind(ME3_CORE_INSTALL_ID_SECRET_NAME)
    .first<{ value: string }>();
  const normalized = normalizeMe3InstallId(stored?.value);
  if (normalized) return normalized;

  const installId = `core_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO install_secrets (name, value, created_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(ME3_CORE_INSTALL_ID_SECRET_NAME, installId)
    .run();
  return installId;
}

function normalizeMe3InstallId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ME3_CORE_INSTALL_ID_REGEX.test(normalized) ? normalized : null;
}

function hostedSessionAllowsInstall(
  payload: HostedMobileSessionPayload,
  installId: string,
): boolean {
  if (
    payload.typ !== "me3_mobile_hosted_session" ||
    payload.aud !== "me3-mobile-hosted-session" ||
    payload.scope !== "mobile.v1" ||
    typeof payload.sub !== "string"
  ) {
    return false;
  }
  return Array.isArray(payload.install_ids) && payload.install_ids.includes(installId);
}

async function getMobilePairing(env: Env, pairingId: string): Promise<MobilePairingRow | null> {
  const result = await env.DB.prepare(
    `SELECT *
     FROM mobile_pairings
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(pairingId)
    .first<MobilePairingRow>();
  return result ?? null;
}

async function requireMobilePairing(
  env: Env,
  ownerId: string,
  pairingId: string,
): Promise<MobilePairingRow> {
  const row = await env.DB.prepare(
    `SELECT *
     FROM mobile_pairings
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
  )
    .bind(pairingId, ownerId)
    .first<MobilePairingRow>();
  if (!row) throw new MobilePairingInputError("Pairing was not found", 404);
  return row;
}

async function expirePairingIfNeeded(
  env: Env,
  row: MobilePairingRow,
): Promise<MobilePairingRow> {
  if (
    (row.status === "pending" || row.status === "approved") &&
    Date.parse(row.expires_at) <= Date.now()
  ) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE mobile_pairings
       SET status = 'expired', updated_at = ?
       WHERE id = ? AND status IN ('pending', 'approved')`,
    )
      .bind(now, row.id)
      .run();
    return { ...row, status: "expired", updated_at: now };
  }
  return row;
}

function serializePairing(row: MobilePairingRow) {
  return {
    id: row.id,
    status: row.status,
    device: {
      id: row.device_id,
      name: row.device_name,
      platform: row.platform,
      appVersion: row.app_version,
    },
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
  };
}

async function pairingCodeMatches(row: MobilePairingRow, userCode: string): Promise<boolean> {
  return constantTimeEqual(await pairingCodeHash(row.id, userCode), row.code_hash);
}

async function pairingCodeHash(pairingId: string, userCode: string): Promise<string> {
  return sha256Text(`mobile-pairing:${pairingId}:${normalizeUserCode(userCode)}`);
}

function normalizeDeviceDescriptor(value: unknown): MobileDeviceDescriptor {
  const body = isRecord(value) ? value : {};
  const id = normalizeBoundedText(body.id, 160);
  if (!id) throw new MobilePairingInputError("Device id is required");

  return {
    id,
    name: normalizeBoundedText(body.name, 120) || "iPhone",
    platform: normalizeBoundedText(body.platform, 40) || "ios",
    appVersion: normalizeBoundedText(body.appVersion, 40),
  };
}

function normalizeBoundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return trimmed || null;
}

function normalizeUserCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

function createUserCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);
  return [
    letters[random[0] % letters.length],
    letters[random[1] % letters.length],
    letters[random[2] % letters.length],
    digits[random[3] % digits.length],
    digits[random[4] % digits.length],
    digits[random[5] % digits.length],
  ].join("");
}

function formatUserCode(code: string): string {
  const normalized = normalizeUserCode(code) || "";
  return normalized.length > 3
    ? `${normalized.slice(0, 3)}-${normalized.slice(3)}`
    : normalized;
}

function createRefreshToken(tokenId: string): string {
  return `${MOBILE_REFRESH_TOKEN_PREFIX}${tokenId}_${randomBase64Url(32)}`;
}

function refreshTokenIdFromToken(token: string): string | null {
  const match = /^me3mrt_([0-9a-f-]{36})_[A-Za-z0-9_-]+$/.exec(token);
  return match?.[1] || null;
}

function bearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] || null;
}

function parseScope(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : MOBILE_SCOPE;
  } catch {
    return MOBILE_SCOPE;
  }
}

function parseAccessPayload(value: string): MobileAccessPayload | null {
  try {
    const payload = JSON.parse(value) as Partial<MobileAccessPayload>;
    if (
      payload.typ !== "me3_mobile_access" ||
      payload.sub !== "owner" ||
      typeof payload.did !== "string" ||
      typeof payload.rid !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      !Array.isArray(payload.scope)
    ) {
      return null;
    }
    return payload as MobileAccessPayload;
  } catch {
    return null;
  }
}

async function hmacSha256(data: string, secret: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

function encodeBase64UrlJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

async function constantTimeHashEqual(a: string, b: string): Promise<boolean> {
  return constantTimeEqual(await sha256Text(a), await sha256Text(b));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function currentUnixTime(): number {
  return Math.floor(Date.now() / 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

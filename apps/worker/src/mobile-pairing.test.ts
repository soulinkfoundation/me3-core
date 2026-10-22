import { describe, expect, it, vi } from "vitest";
import {
  approveMobilePairing,
  authenticateMobileOwner,
  authenticateMobileSession,
  claimMobilePairing,
  claimMobileTokenFromHostedSession,
  getMobileConfig,
  refreshMobileToken,
  revokeMobileRefreshTokenById,
  revokeMobileToken,
  startMobilePairing,
} from "./mobile-pairing";
import { advanceOwnerCredentialGeneration } from "./owner-credentials";
import type { Env } from "./types";

type PairingRow = {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  platform: string;
  app_version: string | null;
  code_hash: string;
  status: "pending" | "approved" | "claimed" | "expired" | "revoked";
  expires_at: string;
  approved_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

type RefreshTokenRow = {
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
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  credential_generation?: string | null;
};

type TestState = {
  installSecrets: Map<string, string>;
  pairings: PairingRow[];
  refreshTokens: RefreshTokenRow[];
};

const origins = {
  apiOrigin: "https://me3.example",
  webOrigin: "https://me3.example",
};

describe("mobile pairing", () => {
  it("requires owner approval before a device can claim tokens", async () => {
    const env = createEnv();
    const challenge = await startMobilePairing(env, {
      device: {
        id: "ios-device-1",
        name: "Kieran's iPhone",
        platform: "ios",
        appVersion: "0.1.0",
      },
    }, origins);

    await expect(
      claimMobilePairing(env, {
        pairingId: challenge.pairingId,
        userCode: challenge.userCode,
        deviceId: "ios-device-1",
      }, origins),
    ).rejects.toMatchObject({ status: 409 });

    await approveMobilePairing(env, "owner", challenge.pairingId, {
      userCode: challenge.userCode,
    });
    const tokenResponse = await claimMobilePairing(env, {
      pairingId: challenge.pairingId,
      userCode: challenge.userCode,
      deviceId: "ios-device-1",
    }, origins);

    expect(tokenResponse.install.label).toBe("Kieran's ME3");
    expect(tokenResponse.install.apiBaseURL).toBe("https://me3.example/api");
    expect(await authenticateMobileOwner(
      env,
      `Bearer ${tokenResponse.accessToken}`,
    )).toBe("owner");

    const refreshResponse = await refreshMobileToken(env, {
      refreshToken: tokenResponse.refreshToken,
      deviceId: "ios-device-1",
    }, origins);
    expect(refreshResponse.accessToken).toMatch(/^me3mat_/);
    expect(refreshResponse.refreshToken).toMatch(/^me3mrt_/);

    await revokeMobileToken(env, {
      refreshToken: refreshResponse.refreshToken,
      deviceId: "ios-device-1",
    });
    expect(await authenticateMobileOwner(
      env,
      `Bearer ${refreshResponse.accessToken}`,
    )).toBeNull();
  });

  it("keeps refresh tokens issued before credential generations until the first reset", async () => {
    const env = createEnv();
    const tokens = await pairDevice(env, "ios-legacy-1");
    const state = (env as unknown as { DB: { state: TestState } }).DB.state;
    state.refreshTokens[0].credential_generation = null;

    const refreshed = await refreshMobileToken(env, {
      refreshToken: tokens.refreshToken,
      deviceId: "ios-legacy-1",
    }, origins);
    expect(state.refreshTokens[0].credential_generation).toMatch(/^0\./);

    state.refreshTokens[0].credential_generation = null;
    state.installSecrets.set("OWNER_CREDENTIAL_GENERATION", "1");
    await expect(
      refreshMobileToken(env, {
        refreshToken: refreshed.refreshToken,
        deviceId: "ios-legacy-1",
      }, origins),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("signs out other devices on a credential reset and keeps the device that made it", async () => {
    const env = createEnv();
    const phone = await pairDevice(env, "ios-phone");
    const tablet = await pairDevice(env, "ios-tablet");
    const phoneRow = (env as unknown as { DB: { state: TestState } }).DB.state.refreshTokens
      .find((token) => token.device_id === "ios-phone")!;

    await advanceOwnerCredentialGeneration(env, { keepMobileTokenId: phoneRow.id });

    expect(await authenticateMobileOwner(env, `Bearer ${tablet.accessToken}`)).toBeNull();
    await expect(
      refreshMobileToken(env, { refreshToken: tablet.refreshToken, deviceId: "ios-tablet" }, origins),
    ).rejects.toMatchObject({ status: 401 });
    expect(await authenticateMobileOwner(env, `Bearer ${phone.accessToken}`)).toBe("owner");
    await expect(
      refreshMobileToken(env, { refreshToken: phone.refreshToken, deviceId: "ios-phone" }, origins),
    ).resolves.toMatchObject({ refreshToken: expect.stringMatching(/^me3mrt_/) });

    await advanceOwnerCredentialGeneration(env);
    expect(await authenticateMobileOwner(env, `Bearer ${phone.accessToken}`)).toBeNull();
  });

  it("signs a device out from its own access token on logout", async () => {
    const env = createEnv();
    const tokens = await pairDevice(env, "ios-logout-1");

    const session = await authenticateMobileSession(env, `Bearer ${tokens.accessToken}`);
    expect(session).toMatchObject({ ownerId: "owner" });
    await revokeMobileRefreshTokenById(env, session!.refreshTokenId);

    expect(await authenticateMobileOwner(env, `Bearer ${tokens.accessToken}`)).toBeNull();
    await expect(
      refreshMobileToken(env, { refreshToken: tokens.refreshToken, deviceId: "ios-logout-1" }, origins),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects refresh tokens after the session secret is rotated", async () => {
    const env = createEnv();
    const tokens = await pairDevice(env, "ios-rotate-1");
    const state = (env as unknown as { DB: { state: TestState } }).DB.state;

    state.installSecrets.delete("JWT_SECRET");

    await expect(
      refreshMobileToken(env, {
        refreshToken: tokens.refreshToken,
        deviceId: "ios-rotate-1",
      }, origins),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects approval with the wrong code", async () => {
    const env = createEnv();
    const challenge = await startMobilePairing(env, {
      device: {
        id: "ios-device-2",
        name: "iPhone",
      },
    }, origins);

    await expect(
      approveMobilePairing(env, "owner", challenge.pairingId, {
        userCode: "WRONG1",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("replaces an existing active credential when the same device reconnects", async () => {
    const env = createEnv();
    const device = {
      id: "ios-reconnect-1",
      name: "Kieran's iPhone",
      platform: "ios",
      appVersion: "0.1.0",
    };

    const firstChallenge = await startMobilePairing(env, { device }, origins);
    await approveMobilePairing(env, "owner", firstChallenge.pairingId, {
      userCode: firstChallenge.userCode,
    });
    const firstTokens = await claimMobilePairing(env, {
      pairingId: firstChallenge.pairingId,
      userCode: firstChallenge.userCode,
      deviceId: device.id,
    }, origins);

    const secondChallenge = await startMobilePairing(env, { device }, origins);
    await approveMobilePairing(env, "owner", secondChallenge.pairingId, {
      userCode: secondChallenge.userCode,
    });
    const secondTokens = await claimMobilePairing(env, {
      pairingId: secondChallenge.pairingId,
      userCode: secondChallenge.userCode,
      deviceId: device.id,
    }, origins);

    expect(await authenticateMobileOwner(env, `Bearer ${firstTokens.accessToken}`)).toBeNull();
    expect(await authenticateMobileOwner(env, `Bearer ${secondTokens.accessToken}`)).toBe("owner");
    await expect(refreshMobileToken(env, {
      refreshToken: firstTokens.refreshToken,
      deviceId: device.id,
    }, origins)).rejects.toMatchObject({ status: 401 });
  });

  it("returns the mobile config contract", async () => {
    const config = await getMobileConfig(createEnv(), origins);

    expect(config.mobileApiVersion).toBe(1);
    expect(config.auth.pairing).toBe("owner-approved-code");
    expect(config.auth.refreshEndpoint).toBe("/api/mobile/token/refresh");
    expect(config.capabilities.assistant).toBe(true);
  });

  it("issues mobile tokens for a valid hosted ME3 session", async () => {
    const env = createEnv();
    const config = await getMobileConfig(env, origins);
    const signed = await createSignedHostedSession({
      issuer: "https://api.me3.test",
      installIds: [config.installId],
    });
    stubJwks(signed.publicJwk);

    try {
      const tokenResponse = await claimMobileTokenFromHostedSession(env, {
        grant_type: "me3_app_claim",
        installId: config.installId,
        me3SessionToken: signed.token,
        device: {
          id: "ios-hosted-1",
          name: "Kieran's iPhone",
          platform: "ios",
          appVersion: "0.2.0",
        },
      }, origins);

      expect(tokenResponse.accessToken).toMatch(/^me3mat_/);
      expect(tokenResponse.refreshToken).toMatch(/^me3mrt_/);
      expect(await authenticateMobileOwner(
        env,
        `Bearer ${tokenResponse.accessToken}`,
      )).toBe("owner");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects hosted ME3 sessions for the wrong install id", async () => {
    const env = createEnv();
    const config = await getMobileConfig(env, origins);
    const signed = await createSignedHostedSession({
      issuer: "https://api.me3.test",
      installIds: [config.installId],
    });
    stubJwks(signed.publicJwk);

    try {
      await expect(
        claimMobileTokenFromHostedSession(env, {
          grant_type: "me3_app_claim",
          installId: "core_22222222-2222-4222-8222-222222222222",
          me3SessionToken: signed.token,
          device: { id: "ios-hosted-2", name: "iPhone" },
        }, origins),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects expired hosted ME3 sessions", async () => {
    const env = createEnv();
    const config = await getMobileConfig(env, origins);
    const signed = await createSignedHostedSession({
      issuer: "https://api.me3.test",
      installIds: [config.installId],
      expiresIn: -60,
    });

    await expect(
      claimMobileTokenFromHostedSession(env, {
        grant_type: "me3_app_claim",
        installId: config.installId,
        me3SessionToken: signed.token,
        device: { id: "ios-hosted-3", name: "iPhone" },
      }, origins),
    ).rejects.toMatchObject({ status: 401 });
  });
});

function createEnv(): Env {
  const state: TestState = {
    installSecrets: new Map(),
    pairings: [],
    refreshTokens: [],
  };
  return {
    DB: new MobilePairingDb(state) as unknown as D1Database,
    ME3_CLOUD_API_ORIGIN: "https://api.me3.test",
  } as Env;
}

async function pairDevice(env: Env, deviceId: string) {
  const challenge = await startMobilePairing(env, {
    device: { id: deviceId, name: "iPhone", platform: "ios" },
  }, origins);
  await approveMobilePairing(env, "owner", challenge.pairingId, {
    userCode: challenge.userCode,
  });
  return claimMobilePairing(env, {
    pairingId: challenge.pairingId,
    userCode: challenge.userCode,
    deviceId,
  }, origins);
}

class MobilePairingDb {
  constructor(readonly state: TestState) {}

  prepare(sql: string) {
    return new MobilePairingStatement(this.state, sql);
  }
}

class MobilePairingStatement {
  private values: unknown[] = [];

  constructor(
    private readonly state: TestState,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM install_secrets")) {
      const [name] = this.values as [string];
      const value = this.state.installSecrets.get(name);
      return (value ? { value } : null) as T | null;
    }

    if (this.sql.includes("FROM owner_profile")) {
      return {
        id: "owner",
        email: "kieran@example.com",
        name: "Kieran",
        username: "kieran",
        bio: null,
        avatar_url: null,
        timezone: "Europe/Dublin",
        locale: "en-IE",
        assistant_name: null,
        password_hash: null,
      } as T;
    }

    if (this.sql.includes("FROM mobile_pairings")) {
      const [id, userId] = this.values as [string, string | undefined];
      const row = this.state.pairings.find(
        (pairing) => pairing.id === id && (!userId || pairing.user_id === userId),
      );
      return (row || null) as T | null;
    }

    if (this.sql.includes("FROM mobile_refresh_tokens")) {
      const [id, deviceId] = this.values as [string, string | undefined];
      const row = this.state.refreshTokens.find(
        (token) =>
          token.id === id &&
          (!deviceId || token.device_id === deviceId) &&
          (!this.sql.includes("status = 'active'") || token.status === "active"),
      );
      return (row || null) as T | null;
    }

    return null as T | null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO install_secrets")) {
      const [name, value] = this.values as [string, string];
      this.state.installSecrets.set(name, value);
      return result(1);
    }

    if (this.sql.includes("INSERT INTO mobile_pairings")) {
      const [
        id,
        deviceId,
        deviceName,
        platform,
        appVersion,
        codeHash,
        expiresAt,
      ] = this.values as string[];
      this.state.pairings.push({
        id,
        user_id: "owner",
        device_id: deviceId,
        device_name: deviceName,
        platform,
        app_version: appVersion || null,
        code_hash: codeHash,
        status: "pending",
        expires_at: expiresAt,
        approved_at: null,
        claimed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return result(1);
    }

    if (this.sql.includes("SET status = 'approved'")) {
      const [approvedAt, updatedAt, id, userId] = this.values as string[];
      const row = this.state.pairings.find(
        (pairing) =>
          pairing.id === id &&
          pairing.user_id === userId &&
          pairing.status === "pending",
      );
      if (!row) return result(0);
      row.status = "approved";
      row.approved_at = approvedAt;
      row.updated_at = updatedAt;
      return result(1);
    }

    if (this.sql.includes("SET status = 'claimed'")) {
      const [claimedAt, updatedAt, id] = this.values as string[];
      const row = this.state.pairings.find(
        (pairing) => pairing.id === id && pairing.status === "approved",
      );
      if (!row) return result(0);
      row.status = "claimed";
      row.claimed_at = claimedAt;
      row.updated_at = updatedAt;
      return result(1);
    }

    if (this.sql.includes("SET status = 'expired'")) {
      const [updatedAt, id] = this.values as string[];
      const row = this.state.pairings.find((pairing) => pairing.id === id);
      if (!row || !["pending", "approved"].includes(row.status)) return result(0);
      row.status = "expired";
      row.updated_at = updatedAt;
      return result(1);
    }

    if (this.sql.includes("INSERT INTO mobile_refresh_tokens")) {
      const [
        id,
        userId,
        deviceId,
        deviceName,
        platform,
        appVersion,
        tokenHash,
        scopeJson,
        expiresAt,
        createdAt,
        updatedAt,
        credentialGeneration,
      ] = this.values as string[];
      this.state.refreshTokens.push({
        id,
        user_id: userId,
        device_id: deviceId,
        device_name: deviceName,
        platform,
        app_version: appVersion || null,
        token_hash: tokenHash,
        status: "active",
        scope_json: scopeJson,
        expires_at: expiresAt,
        last_used_at: null,
        revoked_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        credential_generation: credentialGeneration ?? null,
      });
      return result(1);
    }

    if (this.sql.includes("SET token_hash = ?")) {
      const [tokenHash, expiresAt, lastUsedAt, updatedAt, credentialGeneration, id] =
        this.values as string[];
      const row = this.state.refreshTokens.find(
        (token) => token.id === id && token.status === "active",
      );
      if (!row) return result(0);
      row.token_hash = tokenHash;
      row.expires_at = expiresAt;
      row.last_used_at = lastUsedAt;
      row.updated_at = updatedAt;
      row.credential_generation = credentialGeneration;
      return result(1);
    }

    if (this.sql.includes("SET credential_generation = ?")) {
      const [credentialGeneration, updatedAt, id] = this.values as string[];
      const row = this.state.refreshTokens.find(
        (token) => token.id === id && token.status === "active",
      );
      if (!row) return result(0);
      row.credential_generation = credentialGeneration;
      row.updated_at = updatedAt;
      return result(1);
    }

    if (this.sql.includes("SET status = 'revoked'")) {
      if (this.sql.includes("WHERE status = 'active' AND id != ?")) {
        const [revokedAt, updatedAt, keepId] = this.values as string[];
        const rows = this.state.refreshTokens.filter(
          (token) => token.status === "active" && token.id !== keepId,
        );
        for (const row of rows) {
          row.status = "revoked";
          row.revoked_at = revokedAt;
          row.updated_at = updatedAt;
        }
        return result(rows.length);
      }
      if (this.sql.includes("WHERE user_id = ? AND device_id = ?")) {
        const [revokedAt, updatedAt, userId, deviceId] = this.values as string[];
        const rows = this.state.refreshTokens.filter(
          (token) =>
            token.user_id === userId &&
            token.device_id === deviceId &&
            token.status === "active",
        );
        for (const row of rows) {
          row.status = "revoked";
          row.revoked_at = revokedAt;
          row.updated_at = updatedAt;
        }
        return result(rows.length);
      }

      const [revokedAt, updatedAt, id] = this.values as string[];
      const row = this.state.refreshTokens.find((token) => token.id === id);
      if (!row) return result(0);
      row.status = "revoked";
      row.revoked_at = revokedAt;
      row.updated_at = updatedAt;
      return result(1);
    }

    return result(0);
  }
}

function result(changes: number) {
  return { success: true, meta: { changes } };
}

async function createSignedHostedSession(input: {
  issuer: string;
  installIds: string[];
  userId?: string;
  expiresIn?: number;
}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & {
    kid?: string;
    alg?: string;
    use?: string;
  };
  publicJwk.kid = "hosted-session-test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: publicJwk.kid };
  const payload = {
    iss: input.issuer,
    sub: input.userId || "user123",
    aud: "me3-mobile-hosted-session",
    typ: "me3_mobile_hosted_session",
    email: "owner@example.com",
    install_ids: input.installIds,
    scope: "mobile.v1",
    iat: now,
    exp: now + (input.expiresIn ?? 300),
    jti: crypto.randomUUID(),
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return {
    token: `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`,
    publicJwk,
  };
}

function stubJwks(publicJwk: JsonWebKey) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://api.me3.test/.well-known/jwks.json") {
        return Response.json({ keys: [publicJwk] });
      }
      return Response.json({}, { status: 404 });
    }),
  );
}

function base64UrlJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

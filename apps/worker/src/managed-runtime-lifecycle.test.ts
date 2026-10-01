import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./sdk-user-agent", () => ({ Me3SdkUserAgent: class {} }));
import app from "./app";
import { ME3_CORE_VERSION } from "./core-version";
import { shouldBlockManagedRuntimeBackground } from "./index";
import {
  ManagedRuntimeLifecycleError,
  applyManagedRuntimeAction,
  beginManagedRuntimeWriteLease,
  getManagedRuntimeRequestMode,
  getManagedRuntimeStatus,
  releaseManagedRuntimeWriteLease,
  validateManagedRuntimeControlClaims,
} from "./managed-runtime-lifecycle";
import type { Env } from "./types";

const INSTALLATION_ID = "mi-1234567890abcdef";
const QUIESCE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const SUSPEND_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const REVOKE_REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const PURGE_REQUEST_ID = "55555555-5555-4555-8555-555555555555";

describe("managed runtime lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts only short-lived, installation-bound ME3 Cloud control claims", () => {
    const env = createEnv();
    const now = 1_800_000_000;
    const claims = {
      sub: INSTALLATION_ID,
      aud: "me3-managed-runtime-control",
      typ: "me3_managed_runtime_control",
      installation_id: INSTALLATION_ID,
      action: "quiesce",
      expected_generation: 1,
      request_id: QUIESCE_REQUEST_ID,
      jti: QUIESCE_REQUEST_ID,
      iat: now - 5,
      exp: now + 60,
    };

    expect(
      validateManagedRuntimeControlClaims(
        env,
        claims,
        "quiesce",
        QUIESCE_REQUEST_ID,
        now,
      ),
    ).toEqual({
      installationId: INSTALLATION_ID,
      requestId: QUIESCE_REQUEST_ID,
      expectedGeneration: 1,
    });
    expect(() =>
      validateManagedRuntimeControlClaims(
        env,
        { ...claims, installation_id: "mi-aaaaaaaaaaaaaaaa" },
        "quiesce",
        QUIESCE_REQUEST_ID,
        now,
      ),
    ).toThrowError(ManagedRuntimeLifecycleError);
    expect(() =>
      validateManagedRuntimeControlClaims(
        env,
        { ...claims, exp: now + 600 },
        "quiesce",
        QUIESCE_REQUEST_ID,
        now,
      ),
    ).toThrowError(ManagedRuntimeLifecycleError);
  });

  it("drains tracked writes, fails closed for new writes, and resumes idempotently", async () => {
    const env = createEnv();
    const lease = await beginManagedRuntimeWriteLease(env, "POST", "api");
    expect(lease).not.toBeNull();

    const first = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: QUIESCE_REQUEST_ID,
      action: "quiesce",
      expectedGeneration: 1,
    });
    expect(first).toMatchObject({ state: "quiesced", activeWrites: 1, exportReady: false });
    expect(await beginManagedRuntimeWriteLease(env, "POST", "api")).toBeNull();
    expect(shouldBlockManagedRuntimeBackground(env, null)).toBe(true);
    expect(shouldBlockManagedRuntimeBackground(env, lease)).toBe(false);
    const publicWrite = await app.fetch(
      new Request("http://localhost/subscribe", { method: "POST", body: "email=test@example.com" }),
      env,
    );
    expect(publicWrite.status).toBe(423);
    await expect(publicWrite.json()).resolves.toMatchObject({ code: "managed_runtime_quiesced" });

    await releaseManagedRuntimeWriteLease(env, lease);
    expect(await getManagedRuntimeStatus(env)).toMatchObject({
      state: "quiesced",
      activeWrites: 0,
      exportReady: true,
    });

    const repeated = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: QUIESCE_REQUEST_ID,
      action: "quiesce",
      expectedGeneration: 1,
    });
    expect(repeated.generation).toBe(first.generation);

    await expect(
      applyManagedRuntimeAction(env, {
        installationId: INSTALLATION_ID,
        requestId: QUIESCE_REQUEST_ID,
        action: "suspend",
        expectedGeneration: first.generation,
      }),
    ).rejects.toMatchObject({ code: "managed_control_request_conflict" });

    const resumed = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: RESUME_REQUEST_ID,
      action: "resume",
      expectedGeneration: first.generation,
    });
    expect(resumed).toMatchObject({ state: "active", exportReady: false });
    expect(await beginManagedRuntimeWriteLease(env, "POST", "api")).not.toBeNull();
  });

  it("uses resume as a generation fence against pre-cancellation controls", async () => {
    const env = createEnv();
    const quiesced = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: QUIESCE_REQUEST_ID,
      action: "quiesce",
      expectedGeneration: 1,
    });
    const resumed = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: RESUME_REQUEST_ID,
      action: "resume",
      expectedGeneration: quiesced.generation,
    });
    expect(resumed).toMatchObject({
      state: "active",
      quiescedAt: null,
      suspendedAt: null,
      credentialsRevokedAt: null,
      storagePurgedAt: null,
    });

    await expect(
      applyManagedRuntimeAction(env, {
        installationId: INSTALLATION_ID,
        requestId: SUSPEND_REQUEST_ID,
        action: "suspend",
        expectedGeneration: quiesced.generation,
      }),
    ).rejects.toMatchObject({ code: "managed_runtime_state_conflict" });
    expect(await getManagedRuntimeStatus(env)).toMatchObject({
      state: "active",
      generation: resumed.generation,
    });
  });

  it("requires tracked writes to drain before credential revocation", async () => {
    const db = new LifecycleDb();
    const env = createEnv(db);
    const lease = await beginManagedRuntimeWriteLease(env, "POST", "api");
    expect(lease).not.toBeNull();

    await expect(
      applyManagedRuntimeAction(env, {
        installationId: INSTALLATION_ID,
        requestId: REVOKE_REQUEST_ID,
        action: "revoke_credentials",
        expectedGeneration: 1,
      }),
    ).rejects.toMatchObject({ code: "managed_runtime_not_drained" });
    expect(db.credentialStatements).toHaveLength(0);
    expect(await getManagedRuntimeStatus(env)).toMatchObject({
      state: "suspended",
      activeWrites: 1,
    });

    await releaseManagedRuntimeWriteLease(env, lease);
    const revoked = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: REVOKE_REQUEST_ID,
      action: "revoke_credentials",
      expectedGeneration: 1,
    });
    expect(revoked.credentialsRevokedAt).toBeTruthy();
  });

  it("does not reap a streaming write lease until the conservative six-hour horizon", async () => {
    const db = new LifecycleDb();
    const env = createEnv(db);
    const lease = await beginManagedRuntimeWriteLease(env, "POST", "api-stream");
    expect(lease).not.toBeNull();

    await getManagedRuntimeStatus(env);
    expect(db.staleLeaseMinutes.at(-1)).toBe(6 * 60);

    await releaseManagedRuntimeWriteLease(env, lease);
  });

  it("uses a single state read for steady-state managed requests", async () => {
    const db = new LifecycleDb();
    const env = createEnv(db);
    await getManagedRuntimeStatus(env);
    db.statements.splice(0);

    await expect(getManagedRuntimeRequestMode(env)).resolves.toBe("active");
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toContain("FROM managed_runtime_state");
  });

  it("serves managed owner app assets without lifecycle database work", async () => {
    const db = new LifecycleDb();
    const env = createEnv(db);
    env.CORE_WEB_ORIGIN = "https://tester.me3.app";
    env.ASSETS = {
      fetch: vi.fn(async () =>
        new Response("export default true", {
          headers: {
            "Content-Type": "text/javascript",
            "Cache-Control": "public, max-age=0, must-revalidate",
          },
        }),
      ),
    } as unknown as Fetcher;

    const response = await app.fetch(
      new Request("https://tester.me3.app/assets/index-AbCd1234.js"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(db.statements).toHaveLength(0);
  });

  it("avoids write leases for active GETs and still blocks them while quiesced", async () => {
    const db = new LifecycleDb();
    const env = createEnv(db);
    await getManagedRuntimeStatus(env);
    db.statements.splice(0);

    const activeResponse = await app.fetch(
      new Request("http://localhost/api/core/version"),
      env,
    );
    expect(activeResponse.status).toBe(200);
    expect(
      db.statements.some((sql) =>
        sql.includes("INSERT INTO managed_runtime_write_leases"),
      ),
    ).toBe(false);

    await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: QUIESCE_REQUEST_ID,
      action: "quiesce",
      expectedGeneration: 1,
    });
    const quiescedResponse = await app.fetch(
      new Request("http://localhost/api/core/version"),
      env,
    );
    expect(quiescedResponse.status).toBe(423);
    await expect(quiescedResponse.json()).resolves.toMatchObject({
      code: "managed_runtime_quiesced",
    });
  });

  it("revokes access irreversibly and empties bound storage before marking it purged", async () => {
    const db = new LifecycleDb();
    const bucket = new LifecycleBucket(["one.txt", "nested/two.txt", "three.txt"]);
    const env = createEnv(db, bucket);
    const purgeLegacy = vi.fn(async () => new Response(null, { status: 204 }));
    const purgeSdk = vi.fn(async () => new Response(null, { status: 204 }));
    env.ME3_USER_AGENT = { idFromName: () => "legacy", get: () => ({ fetch: purgeLegacy }) } as unknown as DurableObjectNamespace;
    env.ME3_SDK_USER_AGENT = { idFromName: () => "sdk", get: () => ({ fetch: purgeSdk }) } as unknown as DurableObjectNamespace;
    await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: SUSPEND_REQUEST_ID,
      action: "suspend",
      expectedGeneration: 1,
    });
    const revoked = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: REVOKE_REQUEST_ID,
      action: "revoke_credentials",
      expectedGeneration: 2,
    });
    expect(revoked.state).toBe("suspended");
    expect(revoked.credentialsRevokedAt).toBeTruthy();
    expect(db.credentialStatements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("DELETE FROM install_secrets"),
        expect.stringContaining("UPDATE mobile_refresh_tokens"),
        expect.stringContaining("UPDATE local_executor_pairings"),
        expect.stringContaining("UPDATE mission_daemon_pairings"),
        expect.stringContaining("UPDATE agent_channel_connections"),
      ]),
    );
    await expect(
      applyManagedRuntimeAction(env, {
        installationId: INSTALLATION_ID,
        requestId: RESUME_REQUEST_ID,
        action: "resume",
        expectedGeneration: revoked.generation,
      }),
    ).rejects.toMatchObject({ code: "managed_runtime_resume_forbidden" });

    const purged = await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: PURGE_REQUEST_ID,
      action: "purge_storage",
      expectedGeneration: revoked.generation,
    });
    expect(bucket.keys).toHaveLength(0);
    expect(purgeLegacy).toHaveBeenCalledTimes(1);
    expect(purgeSdk).toHaveBeenCalledTimes(1);
    expect(purged.storagePurgedAt).toBeTruthy();
    expect(purged.exportReady).toBe(false);

    bucket.keys.push("late-object.txt");
    const retryRequestId = "77777777-7777-4777-8777-777777777777";
    await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: retryRequestId,
      action: "purge_storage",
      expectedGeneration: purged.generation,
    });
    expect(bucket.keys).toHaveLength(0);
  });

  it("keeps the signed control route reachable while suspension blocks ordinary APIs", async () => {
    const db = new LifecycleDb();
    const env = createEnv(db);
    await applyManagedRuntimeAction(env, {
      installationId: INSTALLATION_ID,
      requestId: SUSPEND_REQUEST_ID,
      action: "suspend",
      expectedGeneration: 1,
    });

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
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    Object.assign(publicJwk, { kid: "managed-runtime-test-key", alg: "RS256", use: "sig" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ keys: [publicJwk] }),
    );
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    const statusRequestId = "66666666-6666-4666-8666-666666666666";
    const token = await signControlToken(keyPair.privateKey, {
      iss: "https://api.me3.example",
      sub: INSTALLATION_ID,
      aud: "me3-managed-runtime-control",
      typ: "me3_managed_runtime_control",
      installation_id: INSTALLATION_ID,
      action: "status",
      request_id: statusRequestId,
      jti: statusRequestId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const blocked = await app.fetch(new Request("http://localhost/api/core/version"), env);
    expect(blocked.status).toBe(423);
    await expect(blocked.json()).resolves.toMatchObject({ code: "managed_runtime_suspended" });

    const control = await app.fetch(
      new Request("http://localhost/api/managed/lifecycle", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(control.status).toBe(200);
    await expect(control.json()).resolves.toMatchObject({
      ok: true,
      runtime: {
        installationId: INSTALLATION_ID,
        state: "suspended",
        lifecycleProtocol: "me3-managed-lifecycle-v2",
        portableExportPolicy: "me3-portable-v1-policy-1",
        releaseVersion: ME3_CORE_VERSION,
      },
    });

    const resumeRequestId = "88888888-8888-4888-8888-888888888888";
    const resumeToken = await signControlToken(keyPair.privateKey, {
      iss: "https://api.me3.example",
      sub: INSTALLATION_ID,
      aud: "me3-managed-runtime-control",
      typ: "me3_managed_runtime_control",
      installation_id: INSTALLATION_ID,
      action: "resume",
      expected_generation: 2,
      request_id: resumeRequestId,
      jti: resumeRequestId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const resumed = await app.fetch(
      new Request("http://localhost/api/managed/lifecycle", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resumeToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          installationId: INSTALLATION_ID,
          action: "resume",
          requestId: resumeRequestId,
          expectedGeneration: 2,
        }),
      }),
      env,
    );
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({
      ok: true,
      runtime: { state: "active", generation: 3 },
    });

    const staleRequestId = "99999999-9999-4999-8999-999999999999";
    const staleToken = await signControlToken(keyPair.privateKey, {
      iss: "https://api.me3.example",
      sub: INSTALLATION_ID,
      aud: "me3-managed-runtime-control",
      typ: "me3_managed_runtime_control",
      installation_id: INSTALLATION_ID,
      action: "suspend",
      expected_generation: 2,
      request_id: staleRequestId,
      jti: staleRequestId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const stale = await app.fetch(
      new Request("http://localhost/api/managed/lifecycle", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${staleToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          installationId: INSTALLATION_ID,
          action: "suspend",
          requestId: staleRequestId,
          expectedGeneration: 2,
        }),
      }),
      env,
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      ok: false,
      code: "managed_runtime_state_conflict",
    });
  });
});

function createEnv(db = new LifecycleDb(), bucket?: LifecycleBucket): Env {
  return {
    DB: db as unknown as D1Database,
    SITE_ASSETS: bucket as unknown as R2Bucket,
    ENVIRONMENT: "production",
    ME3_DEPLOYMENT_MODE: "managed",
    ME3_MANAGED_INSTALLATION_ID: INSTALLATION_ID,
  };
}

type StateRow = {
  installation_id: string;
  state: "active" | "quiesced" | "suspended";
  generation: number;
  quiesced_at: string | null;
  suspended_at: string | null;
  credentials_revoked_at: string | null;
  storage_purged_at: string | null;
  last_request_id: string | null;
};

class LifecycleDb {
  state: StateRow | null = null;
  readonly requests = new Map<
    string,
    {
      installation_id: string;
      action: string;
      expected_generation: number;
      status: "applying" | "applied";
    }
  >();
  readonly leases = new Map<string, string>();
  readonly credentialStatements: string[] = [];
  readonly staleLeaseMinutes: number[] = [];
  readonly statements: string[] = [];

  prepare(sql: string) {
    this.statements.push(sql);
    return new LifecycleStatement(this, sql);
  }

  async batch(statements: LifecycleStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class LifecycleStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: LifecycleDb,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("COUNT(*) AS count")) {
      return { count: this.db.leases.size } as T;
    }
    if (this.sql.includes("FROM managed_runtime_control_requests")) {
      return (this.db.requests.get(String(this.values[0])) || null) as T | null;
    }
    if (this.sql.includes("FROM managed_runtime_state")) {
      return this.db.state as T | null;
    }
    return null as T | null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO managed_runtime_state")) {
      if (!this.db.state) {
        this.db.state = {
          installation_id: String(this.values[0]),
          state: "active",
          generation: 1,
          quiesced_at: null,
          suspended_at: null,
          credentials_revoked_at: null,
          storage_purged_at: null,
          last_request_id: null,
        };
        return changed(1);
      }
      return changed(0);
    }
    if (this.sql.includes("INSERT INTO managed_runtime_write_leases")) {
      if (this.db.state?.state !== "active") return changed(0);
      this.db.leases.set(String(this.values[0]), String(this.values[1]));
      return changed(1);
    }
    if (this.sql.includes("DELETE FROM managed_runtime_write_leases")) {
      if (this.sql.includes("created_at <")) {
        this.db.staleLeaseMinutes.push(Number(this.values[1]));
        return changed(0);
      }
      return changed(this.db.leases.delete(String(this.values[0])) ? 1 : 0);
    }
    if (this.sql.includes("INSERT INTO managed_runtime_control_requests")) {
      const requestId = String(this.values[0]);
      if (this.db.requests.has(requestId)) return changed(0);
      this.db.requests.set(requestId, {
        installation_id: String(this.values[1]),
        action: String(this.values[2]),
        expected_generation: Number(this.values[3]),
        status: "applying",
      });
      return changed(1);
    }
    if (this.sql.includes("SET status = 'applied'")) {
      const request = this.db.requests.get(String(this.values[1]));
      if (request) request.status = "applied";
      return changed(request ? 1 : 0);
    }
    if (this.sql.includes("SET state = ?")) {
      const expectedGeneration = Number(this.values[7]);
      if (!this.db.state || this.db.state.generation !== expectedGeneration) return changed(0);
      const target = this.values[0] as "quiesced" | "suspended";
      this.db.state.state = target;
      this.db.state.generation += 1;
      this.db.state.quiesced_at ||= String(this.values[1]);
      if (target === "suspended") this.db.state.suspended_at ||= String(this.values[3]);
      this.db.state.last_request_id = String(this.values[4]);
      return changed(1);
    }
    if (this.sql.includes("SET state = 'active'")) {
      const expectedGeneration = Number(this.values[3]);
      if (!this.db.state || this.db.state.generation !== expectedGeneration) return changed(0);
      this.db.state.state = "active";
      this.db.state.generation += 1;
      this.db.state.quiesced_at = null;
      this.db.state.suspended_at = null;
      this.db.state.last_request_id = String(this.values[0]);
      return changed(1);
    }
    if (this.sql.includes("SET credentials_revoked_at = ?")) {
      if (!this.db.state || this.db.state.credentials_revoked_at) return changed(0);
      this.db.state.credentials_revoked_at = String(this.values[0]);
      this.db.state.generation += 1;
      this.db.state.last_request_id = String(this.values[1]);
      return changed(1);
    }
    if (this.sql.includes("SET storage_purged_at = ?")) {
      if (
        !this.db.state ||
        this.db.state.state !== "suspended" ||
        !this.db.state.credentials_revoked_at ||
        this.db.state.storage_purged_at ||
        this.db.leases.size > 0
      ) {
        return changed(0);
      }
      this.db.state.storage_purged_at = String(this.values[0]);
      this.db.state.generation += 1;
      this.db.state.last_request_id = String(this.values[1]);
      return changed(1);
    }
    if (
      /(?:DELETE FROM|UPDATE) (?:install_secrets|mobile_|local_executor_|mission_daemon_|agent_channel_|social_|telegram_|ai_gateway_|me3_install_|email_provider_)/.test(
        this.sql,
      )
    ) {
      this.db.credentialStatements.push(this.sql);
      return changed(1);
    }
    return changed(0);
  }
}

class LifecycleBucket {
  constructor(readonly keys: string[]) {}

  async list(options?: { limit?: number }) {
    return {
      objects: this.keys.slice(0, options?.limit || 1_000).map((key) => ({ key })),
      truncated: this.keys.length > (options?.limit || 1_000),
    };
  }

  async delete(keys: string | string[]) {
    const removed = new Set(Array.isArray(keys) ? keys : [keys]);
    for (let index = this.keys.length - 1; index >= 0; index -= 1) {
      if (removed.has(this.keys[index] || "")) this.keys.splice(index, 1);
    }
  }
}

function changed(changes: number) {
  return { success: true, meta: { changes } };
}

async function signControlToken(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = encodeBase64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: "managed-runtime-test-key" }),
  );
  const body = encodeBase64Url(JSON.stringify(payload));
  const input = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

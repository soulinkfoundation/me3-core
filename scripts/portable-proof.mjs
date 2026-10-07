import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import {
  PortableError,
  RUNTIME_MIGRATIONS,
  exportPortableV1,
  restorePortableV1,
} from "./portable-v1.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const PROOF_INSTALL_ID = "core_11111111-1111-4111-8111-111111111111";
export const PROOF_PASSPHRASE = "me3-portable-proof-passphrase-32bytes";
export const PROOF_PLATFORM_SECRET = "platform-credential-must-not-export";
export const PROOF_SESSION_SECRET = "old-session-secret-must-rotate";
export const PROOF_LOCAL_PASSWORD = "portable-owner-local-password";
export const PROOF_DEVICE_REFRESH_TOKEN =
  "me3mrt_11111111-1111-4111-8111-111111111111_old-device-refresh-credential";
export const PROOF_DEVICE_TOKEN_HASH = createHash("sha256")
  .update(PROOF_DEVICE_REFRESH_TOKEN)
  .digest("hex");

export async function runLocalProof({ keep = false, root } = {}) {
  const proofRoot = root || mkdtempSync(join(tmpdir(), "me3-portable-proof-"));
  const source = createMigratedDatabase(join(proofRoot, "source"));
  const target = createMigratedDatabase(join(proofRoot, "target"));
  const sourceR2 = join(proofRoot, "source-r2");
  const targetR2 = join(proofRoot, "target-r2");
  const archive = join(proofRoot, "snapshot.me3-portable");

  seedProofInstallation(source, sourceR2);
  const sourceSession = queryScalar(
    source,
    "SELECT value FROM install_secrets WHERE name = 'JWT_SECRET';",
  );

  try {
    const exported = await exportPortableV1({
      database: source,
      r2Directory: sourceR2,
      output: archive,
      passphrase: PROOF_PASSPHRASE,
      createdAt: "2026-07-15T12:00:00.000Z",
    });
    const restored = restorePortableV1({
      archive,
      targetDatabase: target,
      targetR2Directory: targetR2,
      passphrase: PROOF_PASSPHRASE,
    });

    const targetSession = queryScalar(
      target,
      "SELECT value FROM install_secrets WHERE name = 'JWT_SECRET';",
    );
    if (!targetSession || targetSession === sourceSession) {
      throw new PortableError("PROOF_FAILED", "Restore did not rotate the browser session secret");
    }
    if (Number(queryScalar(target, "SELECT COUNT(*) FROM mobile_refresh_tokens;")) !== 0) {
      throw new PortableError("PROOF_FAILED", "Restore retained a mobile device credential");
    }
    if (Number(queryScalar(target, "SELECT COUNT(*) FROM mobile_pairings;")) !== 0) {
      throw new PortableError("PROOF_FAILED", "Restore retained a mobile pairing");
    }

    const runtime = await proveRestoredRuntime(join(proofRoot, "target"), target);
    const freshCredential = proveFreshClientRepair(target);
    const result = {
      ok: true,
      format: exported.manifest.format,
      logicalInstallId: restored.logicalInstallId,
      core: exported.manifest.core,
      databaseRows: restored.databaseRows,
      r2Objects: restored.r2Objects,
      sessionsRotated: restored.sessionsRotated,
      oldDeviceCredentialsRemoved: true,
      oldBrowserSessionRejected: runtime.oldBrowserSessionRejected,
      oldDeviceAccessRejected: runtime.oldDeviceAccessRejected,
      oldDeviceRefreshRejected: runtime.oldDeviceRefreshRejected,
      restoredLocalPasswordLoginVerified: runtime.restoredLocalPasswordLoginVerified,
      clientRepairedWithFreshCredential: freshCredential !== PROOF_DEVICE_TOKEN_HASH,
      archive: keep ? archive : "temporary (removed after proof)",
    };
    assertNoProofCredentialMaterial(JSON.stringify(result));
    if (!keep && !root) rmSync(proofRoot, { recursive: true, force: true });
    return result;
  } catch (error) {
    if (!keep && !root) rmSync(proofRoot, { recursive: true, force: true });
    throw error;
  }
}

async function proveRestoredRuntime(persistDirectory, database) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const emptyEnvFile = join(persistDirectory, "proof.env");
  writeFileSync(emptyEnvFile, "", { mode: 0o600 });
  const worker = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--config",
      "apps/worker/wrangler.core.example.toml",
      "--persist-to",
      persistDirectory,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
      "--env-file",
      emptyEnvFile,
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const runtimeLogChunks = [];
  worker.stdout.on("data", (chunk) => runtimeLogChunks.push(chunk));
  worker.stderr.on("data", (chunk) => runtimeLogChunks.push(chunk));

  try {
    await waitForRuntime(origin, worker);
    const oldBrowserSession = await fetch(`${origin}/api/auth/me`, {
      headers: { Cookie: `me3_core_session=${proofBrowserSession(PROOF_SESSION_SECRET)}` },
    });
    const oldDeviceAccess = await fetch(`${origin}/api/account`, {
      headers: { Authorization: `Bearer ${proofMobileAccessToken(PROOF_SESSION_SECRET)}` },
    });
    const oldDeviceRefresh = await fetch(`${origin}/api/mobile/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: PROOF_DEVICE_REFRESH_TOKEN,
        deviceId: "iphone-old",
      }),
    });
    if (
      oldBrowserSession.status !== 401 ||
      oldDeviceAccess.status !== 401 ||
      oldDeviceRefresh.status !== 401
    ) {
      throw new PortableError(
        "PROOF_FAILED",
        "Restored runtime accepted a pre-transfer session or device credential",
      );
    }

    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.test",
        password: PROOF_LOCAL_PASSWORD,
      }),
    });
    const loginText = await login.text();
    const passwordHash = queryScalar(
      database,
      "SELECT password_hash FROM owner_profile WHERE id = 'owner';",
    );
    if (
      login.status !== 200 ||
      loginText.includes(PROOF_LOCAL_PASSWORD) ||
      loginText.includes(passwordHash)
    ) {
      throw new PortableError("PROOF_FAILED", "Restored runtime local login failed");
    }
    const session = login.headers.get("set-cookie")?.split(";")[0];
    if (!session) {
      throw new PortableError("PROOF_FAILED", "Restored runtime did not issue a fresh session");
    }

    const [owner, config] = await Promise.all([
      fetch(`${origin}/api/auth/me`, { headers: { Cookie: session } }),
      fetch(`${origin}/api/config`),
    ]);
    const configText = await config.text();
    const configBody = JSON.parse(configText);
    if (
      owner.status !== 200 ||
      config.status !== 200 ||
      configBody.deploymentMode !== "self_hosted" ||
      configBody.transferReadiness?.ready !== true ||
      configText.includes(PROOF_LOCAL_PASSWORD) ||
      configText.includes(passwordHash)
    ) {
      throw new PortableError(
        "PROOF_FAILED",
        "Restored runtime did not expose verified transfer readiness",
      );
    }

    return {
      oldBrowserSessionRejected: true,
      oldDeviceAccessRejected: true,
      oldDeviceRefreshRejected: true,
      restoredLocalPasswordLoginVerified: true,
    };
  } finally {
    await stopProcess(worker);
    assertNoProofCredentialMaterial(Buffer.concat(runtimeLogChunks).toString("utf8"));
  }
}

function assertNoProofCredentialMaterial(value) {
  const sensitiveValues = [
    PROOF_LOCAL_PASSWORD,
    proofPasswordHash(),
    PROOF_PLATFORM_SECRET,
    PROOF_SESSION_SECRET,
    PROOF_DEVICE_REFRESH_TOKEN,
    PROOF_DEVICE_TOKEN_HASH,
  ];
  if (sensitiveValues.some((secret) => value.includes(secret))) {
    throw new PortableError("PROOF_FAILED", "Proof output exposed credential material");
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new PortableError("PROOF_SETUP_FAILED", "Could not reserve a local proof port");
  return port;
}

async function waitForRuntime(origin, worker) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) break;
    try {
      const response = await fetch(`${origin}/api/core/version`);
      if (response.ok) return;
    } catch {
      // The local Worker is still starting.
    }
    await delay(100);
  }
  throw new PortableError("PROOF_SETUP_FAILED", "Restored local runtime did not start");
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function proofBrowserSession(secret) {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    sub: "owner",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3_600,
  });
  return signProofToken(`${header}.${payload}`, secret);
}

function proofMobileAccessToken(secret) {
  const payload = base64UrlJson({
    typ: "me3_mobile_access",
    sub: "owner",
    did: "iphone-old",
    rid: "11111111-1111-4111-8111-111111111111",
    scope: ["mobile.v1", "account"],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  });
  return `me3mat_${signProofToken(payload, secret)}`;
}

function signProofToken(payload, secret) {
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export function createMigratedDatabase(persistDirectory) {
  mkdirSync(persistDirectory, { recursive: true });
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "me3-core-db",
      "--local",
      "--config",
      "apps/worker/wrangler.core.example.toml",
      "--persist-to",
      persistDirectory,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new PortableError(
      "PROOF_SETUP_FAILED",
      result.stderr.trim() || result.stdout.trim() || "Could not create proof D1 database",
    );
  }
  const databases = findFiles(persistDirectory).filter(
    (path) => path.endsWith(".sqlite") && !path.endsWith("metadata.sqlite"),
  );
  if (databases.length !== 1) {
    throw new PortableError("PROOF_SETUP_FAILED", "Could not identify the proof D1 SQLite file", {
      databases,
    });
  }
  const database = databases[0];
  runSqlite(database, "PRAGMA wal_checkpoint(TRUNCATE);");
  const runtimeRows = RUNTIME_MIGRATIONS.map(
    ([id, checksum]) =>
      `INSERT INTO core_runtime_migrations (id, checksum) VALUES (${quote(id)}, ${quote(checksum)});`,
  );
  runSqlite(
    database,
    `CREATE TABLE core_runtime_migrations (
       id TEXT PRIMARY KEY,
       checksum TEXT NOT NULL,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     );
     ${runtimeRows.join("\n")}`,
  );
  return database;
}

export function seedProofInstallation(database, r2Directory) {
  const now = "2026-07-15T12:00:00.000Z";
  const secrets = [
    ["ME3_CORE_INSTALL_ID", PROOF_INSTALL_ID],
    ["TOKEN_ENCRYPTION_KEY", "fixture-owner-encryption-key"],
    ["JWT_SECRET", PROOF_SESSION_SECRET],
    ["ME3_CLOUD_OWNER_ID", "managed-owner-123"],
    ["ME3_CLOUD_CORE_TOKEN", PROOF_PLATFORM_SECRET],
    ["ME3_MANAGED_CAMPAIGN_CALLBACK_SECRET", "a".repeat(64)],
  ];
  runSqlite(
    database,
    `PRAGMA foreign_keys=ON;
     BEGIN IMMEDIATE;
     INSERT INTO owner_profile
       (id, email, name, username, timezone, password_hash, created_at, updated_at)
       VALUES ('owner', 'owner@example.test', 'Portable Owner', 'portable-owner', 'Europe/Dublin',
               ${quote(proofPasswordHash())}, ${quote(now)}, ${quote(now)});
     INSERT INTO core_install (id, installed_at, schema_version)
       VALUES ('me3-core', ${quote(now)}, 1);
     ${secrets
       .map(
         ([name, value]) =>
           `INSERT INTO install_secrets (name, value, created_at, updated_at) VALUES (${quote(name)}, ${quote(value)}, ${quote(now)}, ${quote(now)});`,
       )
       .join("\n")}
     INSERT INTO mission_projects (id, user_id, name, slug, description)
       VALUES ('project-1', 'owner', 'Ownership Proof', 'ownership-proof', 'Portable project');
     INSERT INTO mission_tasks (id, user_id, project_id, title, description, status)
       VALUES ('task-1', 'owner', 'project-1', 'Restore ME3', 'Verify clean restore', 'done');
     INSERT INTO assistant_threads (id, owner_id, title, project_id)
       VALUES ('thread-1', 'owner', 'Portable conversation', 'project-1');
     INSERT INTO assistant_threads (id, owner_id, title)
       VALUES ('main-thread-1', 'owner', 'ME3');
     INSERT INTO assistant_primary_threads (owner_id, thread_id)
       VALUES ('owner', 'main-thread-1');
     INSERT INTO assistant_messages (id, owner_id, thread_id, role, content)
       VALUES ('message-1', 'owner', 'thread-1', 'user', 'Keep this owner message');
     INSERT INTO assistant_attachments
       (id, owner_id, thread_id, filename, mime_type, size, kind, status, storage_key)
       VALUES ('attachment-1', 'owner', 'thread-1', 'proof.txt', 'text/plain', 18, 'text', 'ready',
               'assistant/owner/proof.txt');
     INSERT INTO journal_entries (id, user_id, entry_date, title, body, body_format, metadata_json)
       VALUES ('journal-1', 'owner', '2026-07-15', 'Portable day',
               '<p>Photo: /api/journal/2026-07-15/media/proof.png</p>', 'html', '{}');
     INSERT INTO contacts (id, user_id, name, email)
       VALUES ('contact-1', 'owner', 'Proof Contact', 'contact@example.test');
     INSERT INTO calendar_sources
       (id, user_id, kind, name, encrypted_source_url, source_url_hint, status)
       VALUES ('calendar-source-1', 'owner', 'ics_url', 'Owner calendar', 'v1.fixture.encrypted-url',
               'https://calendar.example/***', 'active');
     INSERT INTO calendar_source_events
       (id, source_id, external_key, title, starts_at, ends_at)
       VALUES ('calendar-event-1', 'calendar-source-1', 'event-1', 'Restore drill',
               '2026-07-16T09:00:00.000Z', '2026-07-16T10:00:00.000Z');
     INSERT INTO sites
       (id, user_id, username, site_type, site_role, custom_domain, custom_domain_status, custom_domain_cf_id)
       VALUES ('site-1', 'owner', 'portable-owner', 'profile', 'profile', 'owner.example.test', 'active',
               'cloudflare-domain-id-must-reset');
     INSERT INTO subscribers
       (id, site_id, email, first_name, source, subscribed_at, marketing_status,
        marketing_permission_method, marketing_permission_granted_at,
        marketing_permission_evidence_json, delivery_status)
       VALUES (1, 'site-1', 'reader@example.test', 'Portable', 'me3', ${quote(now)}, 'marketable',
               'single_opt_in', ${quote(now)},
               '{"version":1,"kind":"site_form","source":"me3"}', 'deliverable');
     INSERT INTO email_campaigns
       (id, site_id, name, status, current_revision_id, audience_snapshot_id,
        sender_ref, from_address, created_at, updated_at)
       VALUES ('campaign-1', 'site-1', 'Portable campaign', 'sending',
               'campaign-revision-1', 'campaign-audience-1', 'managed-sender-1',
               'campaign@managed.example.test', ${quote(now)}, ${quote(now)});
     INSERT INTO email_campaign_revisions
       (id, campaign_id, revision_number, subject, preview_text, document_version, document_json,
        renderer_version, rendered_html, rendered_text, created_at)
       VALUES ('campaign-revision-1', 'campaign-1', 1, 'Portable subject', 'Portable preview',
               'me3.campaign-document.v1',
               '{"version":"me3.campaign-document.v1","blocks":[{"type":"text","text":"Portable body"}]}',
               'me3.email-renderer.v1', '<p>Portable body</p>', 'Portable body', ${quote(now)});
     INSERT INTO email_campaign_audience_snapshots
       (id, campaign_id, revision_id, site_id, eligible_count, excluded_count,
        exclusion_counts_json, created_at)
       VALUES ('campaign-audience-1', 'campaign-1', 'campaign-revision-1', 'site-1', 1, 0, '{}',
               ${quote(now)});
     INSERT INTO email_campaign_audience_members
       (id, snapshot_id, subscriber_id, normalized_email, first_name, permission_method,
        permission_granted_at, permission_evidence_json, created_at)
       VALUES ('campaign-audience-member-1', 'campaign-audience-1', 1, 'reader@example.test',
               'Portable', 'single_opt_in', ${quote(now)},
               '{"version":1,"kind":"site_form","source":"me3"}', ${quote(now)});
     INSERT INTO email_campaign_assets
       (id, campaign_id, site_id, content_hash, storage_path, filename, content_type, size,
        created_at)
       VALUES ('campaign-asset-1', 'campaign-1', 'site-1', '${"a".repeat(64)}',
               'campaigns/campaign-1/${"a".repeat(64)}.png', 'portable-image.png', 'image/png', 31,
               ${quote(now)});
     INSERT INTO email_campaign_revision_assets (revision_id, asset_id, created_at)
       VALUES ('campaign-revision-1', 'campaign-asset-1', ${quote(now)});
     INSERT INTO email_campaign_recipient_jobs
       (id, campaign_id, revision_id, audience_snapshot_id, audience_member_id,
        kind, recipient_ref, recipient_email, status, request_json,
        next_attempt_at, created_at, updated_at)
       VALUES
       ('campaign-operation-1', 'campaign-1', 'campaign-revision-1',
        'campaign-audience-1', 'campaign-audience-member-1', 'campaign',
        'campaign-audience-member-1', 'reader@example.test', 'delivered',
        '{"version":"me3-managed-campaign/2","operationId":"campaign-operation-1"}',
        ${quote(now)}, ${quote(now)}, ${quote(now)}),
       ('campaign-test-operation-1', 'campaign-1', 'campaign-revision-1',
        NULL, NULL, 'test', 'campaign-test-operation-1', 'owner@example.test',
        'queued', '{"version":"me3-managed-campaign/2","kind":"test"}',
        ${quote(now)}, ${quote(now)}, ${quote(now)});
     INSERT INTO email_campaign_events
       (event_id, operation_id, campaign_id, recipient_ref, sequence,
        event_type, reason, occurred_at, created_at)
       VALUES ('campaign-event-1', 'campaign-operation-1', 'campaign-1',
               'campaign-audience-member-1', 2, 'delivery.delivered', NULL,
               ${quote(now)}, ${quote(now)});
     INSERT INTO email_campaign_transport_state
       (id, sender_ref, from_address, sender_domain, ready, event_cursor,
        last_checked_at, updated_at)
       VALUES ('managed', 'managed-sender-1', 'campaign@managed.example.test',
               'managed.example.test', 1, '42', ${quote(now)}, ${quote(now)});
     INSERT INTO site_files (site_id, path, content, content_type, size, sha256)
       VALUES ('site-1', 'me.json', X'7B7D', 'application/json', 2,
               '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
     INSERT INTO mailbox_aliases
       (id, user_id, alias_local_part, forwarding_email, forwarding_status, forwarding_enabled,
        forwarding_mode, status, activated_at, cf_destination_id, cf_rule_id)
       VALUES ('mailbox-1', 'owner', 'portable', 'owner@example.test', 'verified', 1, 'forward',
               'active', ${quote(now)}, 'cf-destination-must-reset', 'cf-rule-must-reset');
     INSERT INTO mailbox_messages
       (id, mailbox_id, direction, message_kind, status, from_address, to_address, subject,
        text_body, metadata_json)
       VALUES ('mail-1', 'mailbox-1', 'inbound', 'email', 'received', 'sender@example.test',
               'portable@me3.app', 'Portable email', 'Keep this message',
               '{"attachments":[{"storageKey":"mailbox/mail-1/proof.txt"}]}');
     INSERT INTO drive_files
       (id, owner_id, filename, mime_type, size, storage_key, sha256, status, preview_kind)
       VALUES ('drive-file-1', 'owner', 'owner-file.txt', 'text/plain', 16,
               'drive/owner/owner-file.txt',
               'd45d8e6d0f5bbda8507e1a9c0e2e53d9d97f9a442802d2d0c1b4ca8f47f1b773',
               'ready', 'text');
     INSERT INTO ai_provider_credentials
       (user_id, provider_id, encrypted_api_key, api_key_hint, api_key_updated_at)
       VALUES ('owner', 'openai', 'v1.fixture.owner-ai-key', '***1234', ${quote(now)});
     INSERT INTO email_provider_settings
       (user_id, provider_id, is_active, encrypted_secret, secret_hint, last_status)
       VALUES ('owner', 'smtp', 1, 'v1.fixture.owner-email-secret', '***5678', 'ready');
     INSERT INTO email_provider_settings
       (user_id, provider_id, is_active, encrypted_secret, secret_hint, last_status)
       VALUES ('owner', 'cloudflare-email', 0, 'v1.fixture.cloudflare-email-secret', '***9999',
               'ready');
     INSERT INTO commerce_settings
       (user_id, encrypted_stripe_secret_key, stripe_key_hint, default_currency)
       VALUES ('owner', 'v1.fixture.owner-commerce-key', '***4242', 'EUR');
     INSERT INTO ai_gateway_settings
       (user_id, account_id, gateway_id, encrypted_api_token, api_token_hint)
       VALUES ('owner', 'cloudflare-account-must-not-export', 'managed-gateway-must-not-export',
               ${quote(PROOF_PLATFORM_SECRET)}, '***0000');
     INSERT INTO social_provider_settings
       (user_id, provider_id, client_id, encrypted_client_secret, secret_hint, enabled)
       VALUES ('owner', 'linkedin', 'owner-linkedin-client', 'v1.fixture.social-secret', '***8888', 1);
     INSERT INTO social_accounts
       (id, user_id, site_id, platform, platform_account_id, platform_handle,
        access_token_ciphertext, refresh_token_ciphertext)
       VALUES ('social-1', 'owner', 'site-1', 'linkedin', 'linkedin-owner', 'portable-owner',
               'v1.fixture.social-access', 'v1.fixture.social-refresh');
     INSERT INTO telegram_settings
       (user_id, bot_username, encrypted_bot_token, bot_token_hint, encrypted_webhook_secret,
        webhook_secret_hint)
       VALUES ('owner', 'portableproofbot', 'v1.fixture.telegram-token', '***1111',
               'v1.fixture.telegram-webhook', '***2222');
     INSERT INTO plugin_installations (plugin_id, version, enabled, status)
       VALUES ('mission-control', '1', 1, 'installed');
     INSERT INTO auth_rate_limits
       (key, route, subject_hash, attempt_count, window_started_at)
       VALUES ('rate-1', '/api/auth/login', 'subject-hash', 5, ${quote(now)});
     INSERT INTO me3_install_claim_states (state, redirect_path, expires_at, install_id)
       VALUES ('one-time-claim-state', '/account', '2026-07-15T13:00:00.000Z', ${quote(PROOF_INSTALL_ID)});
     INSERT INTO mobile_pairings
       (id, user_id, device_id, device_name, platform, code_hash, status, expires_at)
       VALUES ('pairing-old', 'owner', 'iphone-old', 'Old iPhone', 'ios', 'old-code-hash', 'claimed',
               '2026-08-15T12:00:00.000Z');
     INSERT INTO mobile_refresh_tokens
       (id, user_id, device_id, device_name, platform, token_hash, status, scope_json, expires_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'owner', 'iphone-old', 'Old iPhone', 'ios',
               ${quote(PROOF_DEVICE_TOKEN_HASH)}, 'active', '["mobile.v1"]',
               '2026-08-15T12:00:00.000Z');
     INSERT INTO agent_turn_results (user_id, request_id, turn_id, response_json)
       VALUES ('owner', 'request-ephemeral', 'turn-ephemeral', '{"ephemeral":true}');
     COMMIT;`,
  );

  const objects = new Map([
    ["assistant/owner/proof.txt", "assistant proof\n"],
    ["drive/owner/owner-file.txt", "drive proof\n"],
    ["journal/owner/2026-07-15/proof.png", "synthetic image bytes\n"],
    ["mailbox/mail-1/proof.txt", "mailbox proof\n"],
    [
      `sites/portable-owner/campaigns/campaign-1/${"a".repeat(64)}.png`,
      "synthetic campaign image bytes\n",
    ],
    ["sites/site-1/index.html", "<h1>Portable site</h1>\n"],
  ]);
  for (const [key, value] of objects) {
    const path = join(r2Directory, ...key.split("/"));
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, value);
  }
}

function proofPasswordHash() {
  const salt = Buffer.from("portable-proof!!", "utf8");
  const hash = pbkdf2Sync(PROOF_LOCAL_PASSWORD, salt, 100_000, 32, "sha256");
  return `pbkdf2_sha256$100000$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function proveFreshClientRepair(database) {
  const credential = `fresh-device-${randomBytes(24).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(credential).digest("hex");
  runSqlite(
    database,
    `BEGIN IMMEDIATE;
     INSERT INTO mobile_pairings
       (id, user_id, device_id, device_name, platform, code_hash, status, expires_at, approved_at, claimed_at)
       VALUES ('pairing-fresh', 'owner', 'iphone-fresh', 'Fresh iPhone', 'ios', 'fresh-code-hash',
               'claimed', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO mobile_refresh_tokens
       (id, user_id, device_id, device_name, platform, token_hash, status, scope_json, expires_at)
       VALUES ('22222222-2222-4222-8222-222222222222', 'owner', 'iphone-fresh', 'Fresh iPhone',
               'ios', ${quote(tokenHash)}, 'active', '["mobile.v1"]', '2099-01-01T00:00:00.000Z');
     COMMIT;`,
  );
  if (
    Number(
      queryScalar(
        database,
        `SELECT COUNT(*) FROM mobile_refresh_tokens WHERE token_hash = ${quote(tokenHash)} AND status = 'active';`,
      ),
    ) !== 1
  ) {
    throw new PortableError("PROOF_FAILED", "Fresh client credential was not issued after restore");
  }
  return tokenHash;
}

function findFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function queryScalar(database, sql) {
  return runSqlite(database, sql).trim();
}

function runSqlite(database, sql) {
  const result = spawnSync("sqlite3", [database], {
    input: `.bail on\n${sql}\n`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new PortableError("PROOF_SETUP_FAILED", result.stderr.trim() || "Proof SQLite command failed", {
      sql,
    });
  }
  return result.stdout;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

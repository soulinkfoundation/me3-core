import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  after,
  before,
  test,
} from "node:test";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import {
  PortableError,
  RUNTIME_MIGRATIONS,
  buildManifestForTest,
  comparePortableArchives,
  exportPortableV1,
  resolveCoreInfo,
  restorePortableV1,
  validateArchive,
} from "./portable-v1.mjs";
import {
  managedPortablePasswordMatches,
  prepareManagedPortableCapture,
} from "./prepare-managed-portable-capture.mjs";
import {
  createManagedExportEnvelope,
  extractManagedExportEnvelope,
} from "./managed-export-envelope.mjs";
import {
  PROOF_DEVICE_TOKEN_HASH,
  PROOF_INSTALL_ID,
  PROOF_LOCAL_PASSWORD,
  PROOF_PASSPHRASE,
  PROOF_PLATFORM_SECRET,
  PROOF_SESSION_SECRET,
  createMigratedDatabase,
  seedProofInstallation,
} from "./portable-proof.mjs";

let root;
let source;
let sourceR2;
let cleanTarget;
let archive;

test("portable migration allowlist exactly matches Core runtime migrations", () => {
  const source = readFileSync(
    new URL("../apps/worker/src/core-runtime-migrations.ts", import.meta.url),
    "utf8",
  );
  const declarationStart = source.indexOf(
    "const runtimeMigrations: RuntimeMigration[] = [",
  );
  assert.notEqual(declarationStart, -1, "Core runtime migration list declaration is missing");

  const declarationEnd = source.indexOf("\n];", declarationStart);
  assert.notEqual(declarationEnd, -1, "Core runtime migration list terminator is missing");

  const declaration = source.slice(declarationStart, declarationEnd);
  const runtimeMigrations = [
    ...declaration.matchAll(
      /\{\s*id:\s*"([^"]+)",\s*checksum:\s*"([^"]+)",\s*(?:apply:|async\s+apply\s*\()/gs,
    ),
  ].map((match) => [match[1], match[2]]);

  assert.equal(
    runtimeMigrations.length,
    [...declaration.matchAll(/\b(?:apply:\s*|async\s+apply\s*\()/g)].length,
    "Every Core runtime migration must have a literal id and checksum",
  );
  assert.deepEqual(RUNTIME_MIGRATIONS, runtimeMigrations);
});

before(async () => {
  root = mkdtempSync(join(tmpdir(), "me3-portable-tests-"));
  source = createMigratedDatabase(join(root, "source"));
  cleanTarget = createMigratedDatabase(join(root, "clean-target"));
  sourceR2 = join(root, "source-r2");
  archive = join(root, "snapshot.me3-portable");
  seedProofInstallation(source, sourceR2);
  runSqlite(
    source,
    `INSERT INTO managed_runtime_state
       (id, installation_id, state, generation, last_request_id)
     VALUES ('managed', 'mi-aaaaaaaaaaaaaaaa', 'quiesced', 2, 'managed-control-must-not-export');
     INSERT INTO managed_runtime_control_requests
       (request_id, installation_id, action, expected_generation, status, applied_generation)
     VALUES ('11111111-1111-4111-8111-111111111111', 'mi-aaaaaaaaaaaaaaaa', 'quiesce', 1, 'applied', 2);
     INSERT INTO managed_runtime_write_leases
       (lease_id, installation_id, method, path_class)
     VALUES ('managed-write-lease-must-not-export', 'mi-aaaaaaaaaaaaaaaa', 'POST', 'api');`,
  );
  await exportPortableV1({
    database: source,
    r2Directory: sourceR2,
    output: archive,
    passphrase: PROOF_PASSPHRASE,
    createdAt: "2026-07-15T12:00:00.000Z",
  });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

test("exports sanitized owner data and restores the exact identity, D1 rows, and R2 objects", async () => {
  const target = freshTarget("round-trip");
  const targetR2 = join(root, "round-trip-r2");
  const importSql = join(root, "round-trip-import.sql");
  const validated = validateArchive(archive, PROOF_PASSPHRASE);
  assert.deepEqual(Object.keys(validated.secrets.installSecrets).sort(), [
    "ME3_CORE_INSTALL_ID",
    "TOKEN_ENCRYPTION_KEY",
  ]);
  const result = restorePortableV1({
    archive,
    targetDatabase: target,
    targetR2Directory: targetR2,
    importSqlOutput: importSql,
    passphrase: PROOF_PASSPHRASE,
  });

  assert.equal(result.logicalInstallId, PROOF_INSTALL_ID);
  assert.equal(result.databaseRows, validated.manifest.database.portableRowCount);
  assert.equal(result.r2Objects, validated.manifest.objects.count);
  assert.equal(result.sessionsRotated, true);
  assert.equal(result.requiresClientRepair, true);
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM assistant_messages;"), "1");
  assert.equal(queryScalar(target, "SELECT thread_id FROM assistant_primary_threads WHERE owner_id = 'owner';"), "main-thread-1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM mission_tasks;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM journal_entries;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaigns;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_revisions;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_audience_snapshots;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_audience_members;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_assets;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_revision_assets;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_recipient_jobs;"), "2");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_events;"), "1");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM email_campaign_transport_state;"), "0");
  assert.equal(
    queryScalar(
      target,
      `SELECT status = 'paused' AND request_json IS NULL
          AND provider_reason = 'restore_requires_managed_transport'
       FROM email_campaign_recipient_jobs WHERE id = 'campaign-test-operation-1';`,
    ),
    "1",
  );
  assert.equal(
    queryScalar(
      target,
      `SELECT status = 'delivered' AND request_json IS NOT NULL
       FROM email_campaign_recipient_jobs WHERE id = 'campaign-operation-1';`,
    ),
    "1",
  );
  assert.equal(
    queryScalar(
      target,
      `SELECT marketing_status = 'marketable'
          AND marketing_permission_method = 'single_opt_in'
          AND delivery_status = 'deliverable'
       FROM subscribers WHERE id = 1;`,
    ),
    "1",
  );
  assert.equal(
    queryScalar(
      target,
      `SELECT normalized_email = 'reader@example.test'
          AND permission_method = 'single_opt_in'
       FROM email_campaign_audience_members WHERE id = 'campaign-audience-member-1';`,
    ),
    "1",
  );
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM mobile_pairings;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM mobile_refresh_tokens;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM auth_rate_limits;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM me3_install_claim_states;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM managed_runtime_state;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM managed_runtime_control_requests;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM managed_runtime_write_leases;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM agent_turn_results;"), "0");
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM social_accounts;"), "1");
  assert.equal(
    queryScalar(
      target,
      `SELECT access_token_ciphertext = 'portable-reconnect-required'
          AND refresh_token_ciphertext IS NULL
          AND token_expires_at IS NULL
          AND scopes_json = '[]'
          AND status = 'revoked'
          AND metadata_json = '{"portableReconnectRequired":true}'
          AND last_verified_at IS NULL
       FROM social_accounts WHERE id = 'social-1';`,
    ),
    "1",
  );
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM ai_gateway_settings;"), "0");
  assert.equal(
    queryScalar(target, "SELECT COUNT(*) FROM email_provider_settings WHERE provider_id = 'cloudflare-email';"),
    "0",
  );
  assert.equal(
    queryScalar(target, "SELECT encrypted_client_secret IS NULL AND enabled = 0 FROM social_provider_settings;"),
    "1",
  );
  assert.equal(
    queryScalar(target, "SELECT custom_domain_cf_id IS NULL AND custom_domain_status = 'pending' FROM sites;"),
    "1",
  );
  assert.equal(
    queryScalar(target, "SELECT cf_destination_id IS NULL AND cf_rule_id IS NULL AND status = 'pending_setup' FROM mailbox_aliases;"),
    "1",
  );
  assert.equal(
    queryScalar(target, "SELECT value FROM install_secrets WHERE name = 'ME3_CORE_INSTALL_ID';"),
    PROOF_INSTALL_ID,
  );
  assert.notEqual(
    queryScalar(target, "SELECT value FROM install_secrets WHERE name = 'JWT_SECRET';"),
    PROOF_SESSION_SECRET,
  );
  assert.equal(
    queryScalar(target, "SELECT COUNT(*) FROM install_secrets WHERE name IN ('ME3_CLOUD_OWNER_ID', 'ME3_CLOUD_CORE_TOKEN', 'ME3_MANAGED_CAMPAIGN_CALLBACK_SECRET');"),
    "0",
  );
  assert.equal(readFileSync(join(targetR2, "assistant", "owner", "proof.txt"), "utf8"), "assistant proof\n");
  assert.equal(
    readFileSync(
      join(
        targetR2,
        "sites",
        "portable-owner",
        "campaigns",
        "campaign-1",
        `${"a".repeat(64)}.png`,
      ),
      "utf8",
    ),
    "synthetic campaign image bytes\n",
  );
  assert.equal(listFiles(targetR2).length, 6);
  assert.equal(statSync(importSql).mode & 0o777, 0o600);
  assert.equal(readFileSync(importSql, "utf8").includes(PROOF_PLATFORM_SECRET), false);
  assert.equal(readFileSync(importSql, "utf8").includes(PROOF_SESSION_SECRET), false);
  assert.equal(readFileSync(importSql, "utf8").includes("BEGIN TRANSACTION"), false);
  assert.equal(readFileSync(importSql, "utf8").includes("COMMIT;"), false);
  const remoteImportTarget = freshTarget("remote-import");
  runSqlite(
    remoteImportTarget,
    `PRAGMA foreign_keys=ON;\n${readFileSync(importSql, "utf8")}`,
  );
  assert.equal(
    queryScalar(remoteImportTarget, "SELECT COUNT(*) FROM pragma_foreign_key_check;"),
    "0",
  );
  assert.equal(
    queryScalar(remoteImportTarget, "SELECT COUNT(*) FROM mission_tasks;"),
    "1",
  );

  const restoredArchive = join(root, "restored-snapshot.me3-portable");
  await exportPortableV1({
    database: target,
    r2Directory: targetR2,
    output: restoredArchive,
    passphrase: PROOF_PASSPHRASE,
    createdAt: "2026-07-15T12:30:00.000Z",
  });
  assert.equal(
    comparePortableArchives({
      sourceArchive: archive,
      restoredArchive,
      passphrase: PROOF_PASSPHRASE,
    }).ok,
    true,
  );
});

test("restores across equivalent D1 ledgers when runtime migrations produced the same schema", async () => {
  const legacySource = cloneSource("legacy-d1-ledger-source");
  runSqlite(
    legacySource,
    `DELETE FROM d1_migrations
     WHERE name IN (
       '0032_social_version_publishing_settings.sql',
       '0033_manual_payments.sql',
       '0034_owner_onboarding.sql'
     );
     UPDATE d1_migrations SET id = id + 100;`,
  );
  const legacyArchive = join(root, "legacy-d1-ledger.me3-portable");
  await exportPortableV1({
    database: legacySource,
    r2Directory: sourceR2,
    output: legacyArchive,
    passphrase: PROOF_PASSPHRASE,
  });

  const target = freshTarget("legacy-d1-ledger-target");
  const result = restorePortableV1({
    archive: legacyArchive,
    targetDatabase: target,
    targetR2Directory: join(root, "legacy-d1-ledger-r2"),
    passphrase: PROOF_PASSPHRASE,
  });
  assert.equal(result.logicalInstallId, PROOF_INSTALL_ID);
});

test("preserves CRLF owner content through generated import SQL", async () => {
  const crlfSource = cloneSource("crlf-source");
  runSqlite(
    crlfSource,
    `UPDATE mailbox_messages
     SET text_body = 'first' || char(13) || char(10) || 'second',
         html_body = '<p>first</p>' || char(13) || char(10) || '<p>second</p>',
         raw_message = 'Header: value' || char(13) || char(10) || char(13) || char(10) || 'Body';`,
  );
  const crlfArchive = join(root, "crlf.me3-portable");
  await exportPortableV1({
    database: crlfSource,
    r2Directory: sourceR2,
    output: crlfArchive,
    passphrase: PROOF_PASSPHRASE,
  });

  const target = freshTarget("crlf-target");
  restorePortableV1({
    archive: crlfArchive,
    targetDatabase: target,
    targetR2Directory: join(root, "crlf-r2"),
    passphrase: PROOF_PASSPHRASE,
  });
  for (const column of ["text_body", "html_body", "raw_message"]) {
    assert.equal(
      queryScalar(target, `SELECT hex(${column}) FROM mailbox_messages WHERE id = 'mail-1';`),
      queryScalar(crlfSource, `SELECT hex(${column}) FROM mailbox_messages WHERE id = 'mail-1';`),
    );
  }
});

test("chunks large text and blob values into D1-safe import statements", async () => {
  const largeSource = cloneSource("large-values-source");
  runSqlite(
    largeSource,
    `UPDATE mission_tasks
     SET description = replace(hex(zeroblob(100000)), '00', 'x')
     WHERE id = 'task-1';
     UPDATE site_files
     SET content = randomblob(100000)
     WHERE site_id = 'site-1' AND path = 'me.json';`,
  );
  const largeArchive = join(root, "large-values.me3-portable");
  await exportPortableV1({
    database: largeSource,
    r2Directory: sourceR2,
    output: largeArchive,
    passphrase: PROOF_PASSPHRASE,
  });
  const sql = gunzipSync(
    readFileSync(join(largeArchive, "data", "d1-sanitized.sql.gz")),
  ).toString("utf8");
  assert.ok(
    sql.split("\n").every((statement) => Buffer.byteLength(statement, "utf8") <= 48 * 1024),
  );

  const target = freshTarget("large-values-target");
  restorePortableV1({
    archive: largeArchive,
    targetDatabase: target,
    targetR2Directory: join(root, "large-values-r2"),
    passphrase: PROOF_PASSPHRASE,
  });
  assert.equal(
    queryScalar(target, "SELECT hex(description) FROM mission_tasks WHERE id = 'task-1';"),
    queryScalar(largeSource, "SELECT hex(description) FROM mission_tasks WHERE id = 'task-1';"),
  );
  assert.equal(
    queryScalar(target, "SELECT hex(content) FROM site_files WHERE site_id = 'site-1' AND path = 'me.json';"),
    queryScalar(largeSource, "SELECT hex(content) FROM site_files WHERE site_id = 'site-1' AND path = 'me.json';"),
  );
});

test("rejects a clean target with an unrelated extra D1 migration ledger entry", () => {
  const target = freshTarget("unknown-d1-ledger");
  runSqlite(
    target,
    "INSERT INTO d1_migrations (id, name, applied_at) VALUES (999, '9999_unknown.sql', CURRENT_TIMESTAMP);",
  );
  assertPortableCode(
    () =>
      restorePortableV1({
        archive,
        targetDatabase: target,
        targetR2Directory: join(root, "unknown-d1-ledger-r2"),
        passphrase: PROOF_PASSPHRASE,
      }),
    "MIGRATION_MISMATCH",
  );
});

test("portable restore resets an interrupted suggestion claim without deleting its deterministic Post", async () => {
  const interruptedSource = cloneSource("interrupted-social-suggestion");
  const interruptedArchive = join(root, "interrupted-social-suggestion.me3-portable");
  const target = freshTarget("interrupted-social-suggestion-target");

  runSqlite(
    interruptedSource,
    `
      INSERT INTO social_packages (
        id, site_id, post_slug, post_title_snapshot, source_hash, status, created_by,
        source_type, source_ref, source_snapshot, source_text, idea_text,
        created_at, updated_at
      ) VALUES (
        'social-post-portable-reset', 'site-1', 'portable-reset', 'Portable reset',
        'portable-reset-source-hash', 'ready', 'agent', 'journal', 'journal:journal-1',
        '{}', 'Portable source', 'Portable suggestion body',
        '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_variants (
        id, package_id, platform, format, body_text, approval_status, created_at, updated_at
      ) VALUES (
        'social-variant-portable-reset-x', 'social-post-portable-reset', 'x', 'post',
        'Portable suggestion body', 'draft',
        '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_suggestions (
        id, site_id, source_type, source_ref, source_title, source_snapshot, source_text,
        suggestion_kind, body_text, source_excerpt, quote_trimmed, status,
        choose_token, choosing_at, choose_platforms_json, created_by, created_at, updated_at
      ) VALUES (
        'social-suggestion-portable-reset', 'site-1', 'journal', 'journal:journal-1',
        'Portable source', '{}', 'Portable source', 'short_post',
        'Portable suggestion body', 'Portable source', 0, 'choosing',
        'ephemeral-claim-token', '2026-07-18T10:00:00.000Z', '["x"]', 'agent',
        '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
    `,
  );

  await exportPortableV1({
    database: interruptedSource,
    r2Directory: sourceR2,
    output: interruptedArchive,
    passphrase: PROOF_PASSPHRASE,
    createdAt: "2026-07-18T10:05:00.000Z",
  });
  restorePortableV1({
    archive: interruptedArchive,
    targetDatabase: target,
    targetR2Directory: join(root, "interrupted-social-suggestion-r2"),
    passphrase: PROOF_PASSPHRASE,
  });

  assert.equal(
    queryScalar(
      target,
      "SELECT status FROM social_suggestions WHERE id = 'social-suggestion-portable-reset';",
    ),
    "suggested",
  );
  assert.equal(
    queryScalar(
      target,
      `
        SELECT choose_token IS NULL
          AND choosing_at IS NULL
          AND choose_platforms_json IS NULL
          AND selected_post_id IS NULL
        FROM social_suggestions
        WHERE id = 'social-suggestion-portable-reset';
      `,
    ),
    "1",
  );
  assert.equal(
    queryScalar(
      target,
      "SELECT COUNT(*) FROM social_packages WHERE id = 'social-post-portable-reset';",
    ),
    "1",
  );
  assert.equal(
    queryScalar(
      target,
      `
        SELECT COUNT(*)
        FROM social_variants
        WHERE package_id = 'social-post-portable-reset' AND platform = 'x';
      `,
    ),
    "1",
  );
});

test("portable restore releases an interrupted Posting plan claim and preserves its deterministic Publication", async () => {
  const interruptedSource = cloneSource("interrupted-social-posting-plan");
  const interruptedArchive = join(root, "interrupted-social-posting-plan.me3-portable");
  const target = freshTarget("interrupted-social-posting-plan-target");

  runSqlite(
    interruptedSource,
    `
      INSERT INTO social_packages (
        id, site_id, post_slug, post_title_snapshot, source_hash, status, created_by,
        source_type, source_ref, source_snapshot, source_text, idea_text, tags_json,
        created_at, updated_at
      ) VALUES (
        'social-post-plan-reset', 'site-1', 'plan-reset', 'Portable Posting plan',
        'portable-plan-source-hash', 'ready', 'agent', 'journal', 'journal:journal-1',
        '{}', 'Portable source', 'Portable plan body', '["portable"]',
        '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_variants (
        id, package_id, platform, target_account_id, format, body_text,
        asset_manifest_json, approval_status, approved_at, approved_by_user_id,
        created_at, updated_at
      ) VALUES (
        'social-version-plan-reset', 'social-post-plan-reset', 'linkedin', 'social-1',
        'post', 'Portable plan body', '[]', 'approved',
        '2026-07-18T10:00:00.000Z', 'owner',
        '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_posting_preferences (
        account_id, timezone, preferred_times_json, minimum_gap_minutes,
        minimum_repost_days, created_at, updated_at
      ) VALUES (
        'social-1', 'Europe/Dublin', '[{"day":"monday","localTime":"09:00"}]',
        120, 30, '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_posting_plans (
        id, user_id, site_id, account_id, status, request_json, warnings_json,
        confirmation_token, confirmation_started_at, expires_at, created_at, updated_at
      ) VALUES (
        'social-plan-portable-reset', 'owner', 'site-1', 'social-1', 'confirming',
        '{"windowStart":"2026-07-20T00:00:00.000Z","windowEnd":"2026-07-27T00:00:00.000Z","requestedCount":1,"minimumGapMinutes":120,"minimumRepostDays":30,"timezone":"Europe/Dublin","versionIds":["social-version-plan-reset"]}',
        '[]', 'ephemeral-confirmation-token', '2026-07-18T10:01:00.000Z',
        '2026-07-19T10:00:00.000Z', '2026-07-18T10:00:00.000Z',
        '2026-07-18T10:01:00.000Z'
      );
      INSERT INTO social_posting_plan_items (
        id, plan_id, position, variant_id, version_updated_at_snapshot,
        approval_status_snapshot, version_fingerprint, scheduled_for, timezone,
        is_repost, status, created_at, updated_at
      ) VALUES (
        'social-plan-item-portable-reset', 'social-plan-portable-reset', 0,
        'social-version-plan-reset', '2026-07-18T10:00:00.000Z', 'approved',
        'portable-version-fingerprint', '2026-07-20T08:00:00.000Z', 'Europe/Dublin',
        0, 'reserved', '2026-07-18T10:00:00.000Z', '2026-07-18T10:01:00.000Z'
      );
      INSERT INTO social_posting_reservations (
        id, plan_item_id, account_id, scheduled_for, range_start, range_end,
        status, created_at, updated_at
      ) VALUES (
        'social-reservation-portable-reset', 'social-plan-item-portable-reset', 'social-1',
        '2026-07-20T08:00:00.000Z', '2026-07-20T06:00:00.000Z',
        '2026-07-20T10:00:00.000Z', 'reserved',
        '2026-07-18T10:01:00.000Z', '2026-07-18T10:01:00.000Z'
      );
      INSERT INTO social_publications (
        id, variant_id, site_id, platform, status, scheduled_for, timezone,
        target_account_id_snapshot, format_snapshot, body_text_snapshot,
        asset_manifest_json_snapshot, approval_status_snapshot, approved_at_snapshot,
        approved_by_user_id_snapshot, requested_by_type, requested_by_user_id,
        request_context_json, created_at, updated_at
      ) VALUES (
        'social-publication-social-plan-item-portable-reset',
        'social-version-plan-reset', 'site-1', 'linkedin', 'scheduled',
        '2026-07-20T08:00:00.000Z', 'Europe/Dublin', 'social-1', 'post',
        'Portable plan body', '[]', 'approved', '2026-07-18T10:00:00.000Z',
        'owner', 'agent', 'owner',
        '{"surface":"posting_plan","postingPlanId":"social-plan-portable-reset"}',
        '2026-07-18T10:01:00.000Z', '2026-07-18T10:01:00.000Z'
      );
    `,
  );

  await exportPortableV1({
    database: interruptedSource,
    r2Directory: sourceR2,
    output: interruptedArchive,
    passphrase: PROOF_PASSPHRASE,
    createdAt: "2026-07-18T10:05:00.000Z",
  });
  restorePortableV1({
    archive: interruptedArchive,
    targetDatabase: target,
    targetR2Directory: join(root, "interrupted-social-posting-plan-r2"),
    passphrase: PROOF_PASSPHRASE,
  });

  assert.equal(
    queryScalar(
      target,
      `SELECT status = 'needs_attention'
          AND confirmation_token IS NULL
          AND confirmation_started_at IS NULL
       FROM social_posting_plans WHERE id = 'social-plan-portable-reset';`,
    ),
    "1",
  );
  assert.equal(
    queryScalar(
      target,
      "SELECT status FROM social_posting_plan_items WHERE id = 'social-plan-item-portable-reset';",
    ),
    "suggested",
  );
  assert.equal(
    queryScalar(
      target,
      "SELECT status FROM social_posting_reservations WHERE id = 'social-reservation-portable-reset';",
    ),
    "released",
  );
  assert.equal(
    queryScalar(
      target,
      "SELECT COUNT(*) FROM social_publications WHERE id = 'social-publication-social-plan-item-portable-reset';",
    ),
    "1",
  );
  assert.equal(
    queryScalar(target, "SELECT COUNT(*) FROM social_posting_preferences WHERE account_id = 'social-1';"),
    "1",
  );

  runSqlite(
    target,
    `INSERT INTO social_accounts (
       id, user_id, site_id, platform, platform_account_id, platform_handle,
       access_token_ciphertext, status
     ) VALUES (
       'replacement-id', 'owner', 'site-1', 'linkedin', 'linkedin-owner',
       'portable-owner', 'new-encrypted-access', 'active'
     )
     ON CONFLICT(site_id, platform, platform_account_id) DO UPDATE SET
       access_token_ciphertext = excluded.access_token_ciphertext,
       status = 'active';`,
  );
  assert.equal(
    queryScalar(
      target,
      `SELECT id = 'social-1' AND status = 'active'
          AND access_token_ciphertext = 'new-encrypted-access'
       FROM social_accounts WHERE platform_account_id = 'linkedin-owner';`,
    ),
    "1",
  );
});

test("portable restore preserves immutable Carousel media, render inputs, SVG assets, and Version attachment", async () => {
  const carouselSource = cloneSource("social-carousel");
  const carouselArchive = join(root, "social-carousel.me3-portable");
  const target = freshTarget("social-carousel-target");
  const mediaHash = `sha256:${"1".repeat(64)}`;
  const fingerprint = `sha256:${"2".repeat(64)}`;
  const svgHash = `sha256:${"3".repeat(64)}`;

  runSqlite(
    carouselSource,
    `
      INSERT INTO social_packages (
        id, site_id, post_slug, post_title_snapshot, source_hash, status, created_by,
        source_type, source_ref, source_snapshot, source_text, idea_text,
        created_at, updated_at
      ) VALUES (
        'social-post-carousel-portable', 'site-1', 'carousel-portable',
        'Portable Carousel Source', '${"4".repeat(64)}', 'ready', 'user',
        'journal', 'journal:journal-1', 'Portable source', 'Portable source',
        'Portable Carousel', '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_variants (
        id, package_id, platform, format, body_text, asset_manifest_json,
        approval_status, created_at, updated_at
      ) VALUES (
        'social-version-carousel-portable', 'social-post-carousel-portable', 'x',
        'carousel', 'Portable Carousel', '[]', 'draft',
        '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_carousel_media (
        id, user_id, site_id, content_hash, storage_key, immutable_url, mime_type,
        pixel_width, pixel_height, byte_length, bytes, created_at
      ) VALUES (
        'social-carousel-media-portable', 'owner', 'site-1', '${mediaHash}',
        'social-media/sha256/${"1".repeat(64)}.png',
        '/api/social/media/sha256/${"1".repeat(64)}.png', 'image/png',
        1, 1, 8, X'89504E470D0A1A0A', '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_carousel_render_sets (
        id, user_id, site_id, post_id, created_from_version_id, input_fingerprint,
        model_version, renderer_version, template_id, template_version,
        canvas_width, canvas_height, model_json, canonical_input,
        asset_manifest_json, created_at
      ) VALUES (
        'social-carousel-render-portable', 'owner', 'site-1',
        'social-post-carousel-portable', 'social-version-carousel-portable',
        '${fingerprint}', 'me3.carousel-model.v1', 'me3.carousel-svg.v1',
        'owner-editorial', 1, 1080, 1350,
        '{"modelVersion":"me3.carousel-model.v1","source":{"sourceRef":"journal:journal-1"}}',
        '{"modelVersion":"me3.carousel-model.v1","rendererVersion":"me3.carousel-svg.v1"}',
        '[{"url":"/api/social/carousels/assets/social-carousel-asset-portable","path":"social-carousels/sha256/${"3".repeat(64)}.svg","filename":"01-cover.svg","mimeType":"image/svg+xml","kind":"image","assetIndex":0}]',
        '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_carousel_render_assets (
        id, render_set_id, slide_id, position, content_hash, storage_key,
        immutable_url, file_name, mime_type, pixel_width, pixel_height,
        byte_length, alt_text, source_evidence_json, media_ref_ids_json,
        svg_text, created_at
      ) VALUES (
        'social-carousel-asset-portable', 'social-carousel-render-portable',
        'cover', 0, '${svgHash}', 'social-carousels/sha256/${"3".repeat(64)}.svg',
        '/api/social/carousels/assets/social-carousel-asset-portable', '01-cover.svg',
        'image/svg+xml', 1080, 1350, 46, 'Portable Carousel cover slide.',
        '[{"id":"evidence-cover","start":0,"end":8,"excerpt":"Portable"}]',
        '["social-carousel-media-portable"]',
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        '2026-07-18T10:00:00.000Z'
      );
      INSERT INTO social_carousel_render_set_media (render_set_id, media_id, content_hash)
      VALUES ('social-carousel-render-portable', 'social-carousel-media-portable', '${mediaHash}');
      UPDATE social_variants
      SET carousel_render_set_id = 'social-carousel-render-portable',
          asset_manifest_json = '[{"url":"/api/social/carousels/assets/social-carousel-asset-portable"}]'
      WHERE id = 'social-version-carousel-portable';
    `,
  );

  await exportPortableV1({
    database: carouselSource,
    r2Directory: sourceR2,
    output: carouselArchive,
    passphrase: PROOF_PASSPHRASE,
    createdAt: "2026-07-18T10:05:00.000Z",
  });
  restorePortableV1({
    archive: carouselArchive,
    targetDatabase: target,
    targetR2Directory: join(root, "social-carousel-r2"),
    passphrase: PROOF_PASSPHRASE,
  });

  assert.equal(
    queryScalar(
      target,
      "SELECT hex(bytes) FROM social_carousel_media WHERE id = 'social-carousel-media-portable';",
    ),
    "89504E470D0A1A0A",
  );
  assert.equal(
    queryScalar(
      target,
      "SELECT svg_text FROM social_carousel_render_assets WHERE id = 'social-carousel-asset-portable';",
    ),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );
  assert.equal(
    queryScalar(
      target,
      `SELECT carousel_render_set_id
       FROM social_variants WHERE id = 'social-version-carousel-portable';`,
    ),
    "social-carousel-render-portable",
  );
  assert.equal(
    queryScalar(
      target,
      `SELECT created_from_version_id = 'social-version-carousel-portable'
          AND model_json LIKE '%me3.carousel-model.v1%'
          AND canonical_input LIKE '%me3.carousel-svg.v1%'
       FROM social_carousel_render_sets WHERE id = 'social-carousel-render-portable';`,
    ),
    "1",
  );
  assert.equal(queryScalar(target, "SELECT COUNT(*) FROM pragma_foreign_key_check;"), "0");
});

test("archive omits platform, session, device, and managed-only credentials", () => {
  const textFiles = listFiles(archive)
    .filter((path) => !path.includes(`${join("objects", "blobs")}`))
    .map((path) =>
      path.endsWith("d1-sanitized.sql.gz")
        ? gunzipSync(readFileSync(path)).toString("utf8")
        : readFileSync(path, "utf8"),
    )
    .join("\n");
  assert.equal(textFiles.includes(PROOF_PLATFORM_SECRET), false);
  assert.equal(textFiles.includes(PROOF_SESSION_SECRET), false);
  assert.equal(textFiles.includes(PROOF_DEVICE_TOKEN_HASH), false);
  assert.equal(textFiles.includes(PROOF_LOCAL_PASSWORD), false);
  assert.equal(textFiles.includes("cloudflare-account-must-not-export"), false);
  assert.equal(textFiles.includes("managed-gateway-must-not-export"), false);
  assert.equal(textFiles.includes("cloudflare-domain-id-must-reset"), false);
  assert.equal(textFiles.includes("cf-destination-must-reset"), false);
  assert.equal(textFiles.includes("cf-rule-must-reset"), false);
  assert.equal(textFiles.includes("v1.fixture.social-access"), false);
  assert.equal(textFiles.includes("v1.fixture.social-refresh"), false);
  assert.equal(textFiles.includes("v1.fixture.social-secret"), false);
  assert.equal(textFiles.includes("ephemeral-confirmation-token"), false);
  assert.equal(textFiles.includes("managed-control-must-not-export"), false);
  assert.equal(textFiles.includes("managed-write-lease-must-not-export"), false);
});

test("export requires verified local password login before creating output", async () => {
  const missingPassword = cloneSource("missing-local-password");
  const missingOutput = join(root, "missing-local-password-archive");
  runSqlite(missingPassword, "UPDATE owner_profile SET password_hash = NULL WHERE id = 'owner';");
  await assert.rejects(
    exportPortableV1({
      database: missingPassword,
      r2Directory: sourceR2,
      output: missingOutput,
      passphrase: PROOF_PASSPHRASE,
    }),
    (error) => error instanceof PortableError && error.code === "LOCAL_PASSWORD_REQUIRED",
  );
  assert.equal(existsSync(missingOutput), false);

  const malformedPassword = cloneSource("malformed-local-password");
  const malformedOutput = join(root, "malformed-local-password-archive");
  runSqlite(
    malformedPassword,
    "UPDATE owner_profile SET password_hash = 'pbkdf2_sha256$100000$invalid$invalid' WHERE id = 'owner';",
  );
  await assert.rejects(
    exportPortableV1({
      database: malformedPassword,
      r2Directory: sourceR2,
      output: malformedOutput,
      passphrase: PROOF_PASSPHRASE,
    }),
    (error) => error instanceof PortableError && error.code === "LOCAL_PASSWORD_REQUIRED",
  );
  assert.equal(existsSync(malformedOutput), false);
});

test("managed hosting export prepares a temporary login on the captured copy only", async () => {
  const managedCapture = cloneSource("managed-hosted-null-password");
  const managedArchive = join(root, "managed-hosted.me3-portable");
  const managedTarget = freshTarget("managed-hosted-target");
  runSqlite(managedCapture, "UPDATE owner_profile SET password_hash = NULL WHERE id = 'owner';");

  prepareManagedPortableCapture(managedCapture, PROOF_PASSPHRASE);
  assert.equal(managedPortablePasswordMatches(managedCapture, PROOF_PASSPHRASE), true);
  await exportPortableV1({
    database: managedCapture,
    r2Directory: sourceR2,
    output: managedArchive,
    passphrase: PROOF_PASSPHRASE,
    managedHosted: true,
    createdAt: "2026-07-18T12:00:00.000Z",
  });
  const validated = validateArchive(managedArchive, PROOF_PASSPHRASE);
  assert.equal(validated.manifest.restore.managedHostedRecovery, true);
  assert.equal(validated.manifest.restore.requiresImmediatePasswordChange, true);
  assert.match(
    readFileSync(join(managedArchive, "README.txt"), "utf8"),
    /export passphrase is also the temporary restored local login password/,
  );
  restorePortableV1({
    archive: managedArchive,
    targetDatabase: managedTarget,
    targetR2Directory: join(root, "managed-hosted-target-r2"),
    passphrase: PROOF_PASSPHRASE,
  });
  assert.equal(managedPortablePasswordMatches(managedTarget, PROOF_PASSPHRASE), true);
});

test("owner can decrypt a managed envelope into a verified portable-v1 archive", async () => {
  const envelope = join(root, "owner-download.me3export");
  const extracted = join(root, "owner-extracted-portable");
  await createManagedExportEnvelope({
    archive,
    output: envelope,
    passphrase: PROOF_PASSPHRASE,
    installationId: "mi-1234567890abcdef",
    operationId: "88888888-8888-4888-8888-888888888888",
    keyVersion: "v1",
  });
  const result = await extractManagedExportEnvelope({
    envelope,
    output: extracted,
    passphrase: PROOF_PASSPHRASE,
  });
  assert.equal(result.logicalInstallId, PROOF_INSTALL_ID);
  assert.equal(validateArchive(extracted, PROOF_PASSPHRASE).manifest.format, "me3-portable-v1");
});

test("wrong passphrases, tampering, version mismatches, and non-clean targets fail before mutation", () => {
  const wrongKeyTarget = freshTarget("wrong-key");
  const wrongKeyBefore = fileHash(wrongKeyTarget);
  assertPortableCode(
    () =>
      restorePortableV1({
        archive,
        targetDatabase: wrongKeyTarget,
        targetR2Directory: join(root, "wrong-key-r2"),
        passphrase: "this-passphrase-is-wrong",
      }),
    "WRONG_PASSPHRASE",
  );
  assert.equal(fileHash(wrongKeyTarget), wrongKeyBefore);
  assert.equal(existsSync(join(root, "wrong-key-r2")), false);

  const tamperedArchive = join(root, "tampered.me3-portable");
  cpSync(archive, tamperedArchive, { recursive: true });
  const blob = listFiles(join(tamperedArchive, "objects", "blobs"))[0];
  writeFileSync(blob, "tampered");
  const tamperedTarget = freshTarget("tampered");
  const tamperedBefore = fileHash(tamperedTarget);
  assertPortableCode(
    () =>
      restorePortableV1({
        archive: tamperedArchive,
        targetDatabase: tamperedTarget,
        targetR2Directory: join(root, "tampered-r2"),
        passphrase: PROOF_PASSPHRASE,
      }),
    "ARCHIVE_TAMPERED",
  );
  assert.equal(fileHash(tamperedTarget), tamperedBefore);

  const reboundArchive = join(root, "rebound-tampered.me3-portable");
  cpSync(archive, reboundArchive, { recursive: true });
  const configPath = join(reboundArchive, "config", "install.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.requiresClientRepair = false;
  writeFileSync(configPath, `${JSON.stringify(config)}\n`);
  const manifestPath = join(reboundArchive, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.files.installConfigSha256 = fileHash(configPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  rewriteArchiveChecksums(reboundArchive);
  assertPortableCode(
    () => validateArchive(reboundArchive, PROOF_PASSPHRASE),
    "ARCHIVE_TAMPERED",
  );

  const versionTarget = freshTarget("version");
  const versionBefore = fileHash(versionTarget);
  const currentCore = resolveCoreInfo();
  assertPortableCode(
    () =>
      restorePortableV1({
        archive,
        targetDatabase: versionTarget,
        targetR2Directory: join(root, "version-r2"),
        passphrase: PROOF_PASSPHRASE,
        core: { ...currentCore, version: "999.0.0" },
      }),
    "CORE_VERSION_MISMATCH",
  );
  assert.equal(fileHash(versionTarget), versionBefore);

  const occupiedTarget = freshTarget("occupied");
  runSqlite(occupiedTarget, "INSERT INTO owner_profile (id, name) VALUES ('owner', 'Already claimed');");
  const occupiedBefore = fileHash(occupiedTarget);
  assertPortableCode(
    () =>
      restorePortableV1({
        archive,
        targetDatabase: occupiedTarget,
        targetR2Directory: join(root, "occupied-r2"),
        passphrase: PROOF_PASSPHRASE,
      }),
    "TARGET_NOT_CLEAN",
  );
  assert.equal(fileHash(occupiedTarget), occupiedBefore);
});

test("unknown tables, credential fields, and install secret names fail closed", async () => {
  const unknownTable = cloneSource("unknown-table");
  runSqlite(unknownTable, "CREATE TABLE managed_billing_records (id TEXT PRIMARY KEY);");
  await assert.rejects(
    exportPortableV1({
      database: unknownTable,
      r2Directory: sourceR2,
      output: join(root, "unknown-table-archive"),
      passphrase: PROOF_PASSPHRASE,
    }),
    (error) => error instanceof PortableError && error.code === "SCHEMA_UNCLASSIFIED",
  );

  const unknownField = cloneSource("unknown-field");
  runSqlite(unknownField, "ALTER TABLE owner_profile ADD COLUMN deployment_token TEXT;");
  await assert.rejects(
    exportPortableV1({
      database: unknownField,
      r2Directory: sourceR2,
      output: join(root, "unknown-field-archive"),
      passphrase: PROOF_PASSPHRASE,
    }),
    (error) => error instanceof PortableError && error.code === "SECRET_FIELD_UNCLASSIFIED",
  );

  const unknownSecret = cloneSource("unknown-secret");
  runSqlite(
    unknownSecret,
    "INSERT INTO install_secrets (name, value) VALUES ('UNCLASSIFIED_SECRET', 'must-fail');",
  );
  await assert.rejects(
    exportPortableV1({
      database: unknownSecret,
      r2Directory: sourceR2,
      output: join(root, "unknown-secret-archive"),
      passphrase: PROOF_PASSPHRASE,
    }),
    (error) => error instanceof PortableError && error.code === "SECRET_UNCLASSIFIED",
  );

  const invalidSource = cloneSource("invalid-source");
  runSqlite(
    invalidSource,
    "PRAGMA foreign_keys=OFF; UPDATE assistant_messages SET owner_id = 'missing-owner';",
  );
  await assert.rejects(
    exportPortableV1({
      database: invalidSource,
      r2Directory: sourceR2,
      output: join(root, "invalid-source-archive"),
      passphrase: PROOF_PASSPHRASE,
    }),
    (error) => error instanceof PortableError && error.code === "SOURCE_INVALID",
  );
});

test("manifest serialization and semantic content are deterministic", async () => {
  const first = buildManifestForTest({ z: 1, a: { y: 2, b: 3 }, rows: [{ z: 4, a: 5 }] });
  const second = buildManifestForTest({ rows: [{ a: 5, z: 4 }], a: { b: 3, y: 2 }, z: 1 });
  assert.equal(first, second);

  const secondArchive = join(root, "deterministic.me3-portable");
  await exportPortableV1({
    database: source,
    r2Directory: sourceR2,
    output: secondArchive,
    passphrase: PROOF_PASSPHRASE,
    createdAt: "2026-07-15T12:00:00.000Z",
  });
  const firstManifest = JSON.parse(readFileSync(join(archive, "manifest.json"), "utf8"));
  const secondManifest = JSON.parse(readFileSync(join(secondArchive, "manifest.json"), "utf8"));
  delete firstManifest.secrets.envelopeSha256;
  delete secondManifest.secrets.envelopeSha256;
  assert.equal(buildManifestForTest(firstManifest), buildManifestForTest(secondManifest));
});

function freshTarget(name) {
  const path = join(root, `${name}.sqlite`);
  copyFileSync(cleanTarget, path);
  return path;
}

function cloneSource(name) {
  const path = join(root, `${name}.sqlite`);
  copyFileSync(source, path);
  return path;
}

function queryScalar(database, sql) {
  return runSqlite(database, sql).trim();
}

function runSqlite(database, sql) {
  const result = spawnSync("sqlite3", [database], {
    input: `.bail on\n${sql}\n`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function listFiles(rootPath) {
  if (!existsSync(rootPath)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(rootPath);
  return files.sort();
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function rewriteArchiveChecksums(archivePath) {
  const lines = listFiles(archivePath)
    .filter((path) => !path.endsWith("checksums.sha256"))
    .map((path) => `${fileHash(path)}  ${relative(archivePath, path).split(sep).join("/")}`)
    .sort();
  writeFileSync(join(archivePath, "checksums.sha256"), `${lines.join("\n")}\n`);
}

function assertPortableCode(fn, code) {
  assert.throws(fn, (error) => error instanceof PortableError && error.code === code);
}

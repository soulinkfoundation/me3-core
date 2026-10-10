import { execFileSync, spawnSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { managedPortablePasswordMatches } from "./prepare-managed-portable-capture.mjs";

export const PORTABLE_FORMAT = "me3-portable-v1";
export const PORTABLE_VERSION = 1;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_ID_RE = /^core_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMPTY_SHA256 = sha256("");
const MAX_IMPORT_STATEMENT_BYTES = 48 * 1024;
const IMPORT_VALUE_CHUNK_BYTES = 16 * 1024;

export const RUNTIME_MIGRATIONS = [
  ["0002_mission_task_pins", "2026-06-24-mission-task-pins-v1"],
  ["0009_commerce_default_currency", "2026-06-24-commerce-default-currency-v1"],
  ["0010_ai_usage_events", "2026-06-24-ai-usage-events-v1"],
  ["0011_financial_entry_projects", "2026-06-24-financial-entry-projects-v1"],
  ["0012_drive_files", "2026-06-30-drive-files-v1"],
  ["0014_mobile_pairing", "2026-07-06-mobile-pairing-v1"],
  ["0015_agent_runtime_idempotency", "2026-07-09-agent-runtime-idempotency-v2"],
  ["0016_social_content_packages", "2026-07-10-social-content-packages-v1"],
  ["0017_site_pages_and_commerce", "2026-07-19-site-pages-and-commerce-v1"],
  ["0018_social_publication_idempotency", "2026-07-10-social-publication-idempotency-v1"],
  ["0019_owner_content_search", "2026-07-15-owner-content-search-v1"],
  ["0020_mailbox_thread_index", "2026-07-16-mailbox-thread-index-v1"],
  ["0021_managed_email_inbound_deliveries", "2026-07-18-managed-email-inbound-deliveries-v1"],
  ["0022_social_posts_canonical", "2026-07-18-social-posts-canonical-v1"],
  ["0023_social_publications_reusable", "2026-07-18-social-publications-reusable-v1"],
  ["0024_social_suggestions", "2026-07-18-social-suggestions-v2"],
  ["0025_social_posting_plans", "2026-07-18-social-posting-plans-v1"],
  ["0026_social_carousels", "2026-07-18-social-carousels-v1"],
  ["0027_managed_runtime_lifecycle", "2026-07-18-managed-runtime-lifecycle-v2"],
  ["0028_journal_entry_revision", "2026-07-23-journal-entry-revision-v1"],
  ["0029_social_media_delivery", "2026-07-21-social-media-delivery-v1"],
  ["0030_social_youtube_tiktok", "2026-07-21-social-youtube-tiktok-v2"],
  ["0031_social_publication_formats", "2026-07-25-social-publication-formats-v1"],
  ["0032_social_version_publishing_settings", "2026-07-29-social-version-publishing-settings-v1"],
  ["0033_manual_payments", "2026-07-31-manual-payments-v1"],
  ["0034_owner_onboarding", "2026-07-31-owner-onboarding-v1"],
  ["0035_calendar_source_event_dismissals", "2026-08-18-calendar-source-event-dismissals-v1"],
  ["0036_calendar_push_notifications", "2026-08-19-calendar-push-notifications-v1"],
  ["0037_event_booking_capacity", "2026-08-21-event-booking-capacity-v1"],
  ["0038_site_roles", "2026-08-24-site-roles-v1"],
  ["0040_remove_mission_task_review", "2026-08-26-remove-mission-task-review-v1"],
  ["0041_email_campaign_foundations", "2026-08-26-email-campaign-foundations-v1"],
  ["0042_email_campaign_assets", "2026-08-26-email-campaign-assets-v1"],
  ["0043_email_campaign_delivery", "2026-08-26-email-campaign-delivery-v1"],
  ["0044_site_branding", "2026-08-27-site-branding-v1"],
  ["0045_commerce_stripe_provider", "2026-08-31-commerce-stripe-provider-v1"],
  ["0046_business_site_profile_ownership", "2026-08-31-business-site-profile-ownership-v1"],
  ["0047_subscriber_double_opt_in", "2026-09-03-subscriber-double-opt-in-v1"],
  ["0048_mailbox_attachment_staging", "2026-09-09-mailbox-attachment-staging-v1"],
  ["0049_commerce_confirmation_delivery", "2026-09-11-commerce-confirmation-delivery-v1"],
  ["0050_accounts_customer_payments", "2026-09-11-accounts-customer-payments-v1"],
  ["0051_owner_navigation_features", "2026-09-18-owner-navigation-features-v2"],
  ["0052_owner_feature_discovery", "2026-09-17-owner-feature-discovery-v1"],
  ["0053_booking_meeting", "2026-09-23-booking-meeting-v1"],
  ["0054_wheel_of_life_navigation", "2026-09-30-wheel-of-life-navigation-v1"],
  ["0055_calendar_agent_cancellation_approvals", "2026-10-01-calendar-agent-cancellation-approvals-v1"],
  ["0056_journal_articles", "2026-10-02-journal-articles-v1"],
  ["0057_assistant_primary_thread", "2026-10-07-assistant-primary-thread-v1"],
  ["0058_agent_turns", "2026-10-10-agent-turns-v3"],
  ["0059_agent_targets", "2026-10-10-agent-targets-v1"],
  ["0060_mission_goal_links", "2026-10-10-mission-goal-links-v1"],
  ["0061_agent_image_operations", "2026-10-10-agent-image-operations-v1"],
];

const VERIFY_TABLES = ["core_runtime_migrations", "d1_migrations"];
const DERIVED_TABLES = [
  "owner_content_search",
  "owner_content_search_config",
  "owner_content_search_content",
  "owner_content_search_data",
  "owner_content_search_docsize",
  "owner_content_search_idx",
];
const OPTIONAL_PLATFORM_TABLES = new Set(["_cf_METADATA"]);
const SECRET_TABLES = ["install_secrets"];
const EXCLUDED_TABLES = [
  "agent_channel_connections",
  "agent_channel_events",
  "agent_tool_executions",
  "agent_turn_results",
  "ai_gateway_settings",
  "assistant_job_ingress_events",
  "auth_rate_limits",
  "booking_holds",
  "calendar_push_dispatches",
  "drive_multipart_parts",
  "drive_multipart_uploads",
  "local_executor_audit_events",
  "local_executor_pairings",
  "local_executor_project_policies",
  "local_executor_run_events",
  "local_executor_runs",
  "managed_email_inbound_deliveries",
  "email_campaign_transport_state",
  "managed_runtime_control_requests",
  "managed_runtime_state",
  "managed_runtime_write_leases",
  "me3_install_claim_states",
  "mission_daemon_allowlist_entries",
  "mission_daemon_audit_events",
  "mission_daemon_pairings",
  "mobile_pairings",
  "mobile_push_preferences",
  "mobile_refresh_tokens",
  "social_media_delivery_grants",
  "social_oauth_states",
  "telegram_settings",
];
const TRANSFORMED_TABLES = [
  "email_campaign_recipient_jobs",
  "email_provider_settings",
  "mailbox_aliases",
  "sites",
  "social_accounts",
  "social_posting_plan_items",
  "social_posting_plans",
  "social_posting_reservations",
  "social_provider_settings",
  "social_suggestions",
];
const COPIED_TABLES = [
  "me3_agent_cancellations",
  "me3_agent_request_aliases",
  "me3_agent_turns",
  "me3_agent_stream_events",
  "me3_agent_tool_receipts",
  "me3_agent_approvals",
  "me3_agent_targets",
  "me3_agent_selections",
  "me3_agent_image_operations",
  "ai_model_defaults",
  "ai_provider_credentials",
  "ai_usage_events",
  "assistant_attachments",
  "assistant_job_action_results",
  "assistant_job_artifacts",
  "assistant_job_run_events",
  "assistant_job_runs",
  "assistant_job_versions",
  "assistant_jobs",
  "assistant_message_assets",
  "assistant_messages",
  "assistant_primary_threads",
  "assistant_skills",
  "assistant_threads",
  "booking_reminders",
  "bookings",
  "calendar_agent_cancellation_approvals",
  "calendar_source_event_dismissals",
  "calendar_source_events",
  "calendar_sources",
  "commerce_orders",
  "commerce_settings",
  "contacts",
  "content_bank_items",
  "core_install",
  "drive_files",
  "drive_folders",
  "email_campaign_assets",
  "email_campaign_audience_members",
  "email_campaign_audience_snapshots",
  "email_campaign_revisions",
  "email_campaign_revision_assets",
  "email_campaign_events",
  "email_campaigns",
  "email_send_audit",
  "financial_categories",
  "financial_entries",
  "journal_entries",
  "journal_articles",
  "journal_project_links",
  "mailbox_messages",
  "mailbox_attachment_staging",
  "mission_agent_run_events",
  "mission_agent_runs",
  "mission_approvals",
  "mission_context_sources",
  "mission_dashboard_settings",
  "mission_plugin_activity",
  "mission_private_memory",
  "mission_project_columns",
  "mission_projects",
  "mission_tasks",
  "mission_wheel_settings",
  "mission_wheel_snapshots",
  "owner_onboarding",
  "owner_feature_discovery",
  "owner_navigation_features",
  "owner_profile",
  "payment_push_dispatches",
  "plugin_installations",
  "scheduling_request_audit",
  "scheduling_request_votes",
  "scheduling_requests",
  "scheduling_time_types",
  "site_files",
  "site_branding",
  "site_booking_meetings",
  "site_page_revisions",
  "site_pages",
  "social_carousel_media",
  "social_carousel_render_assets",
  "social_carousel_render_set_media",
  "social_carousel_render_sets",
  "social_packages",
  "social_posting_preferences",
  "social_publication_events",
  "social_publications",
  "social_variants",
  "subscribers",
  "user_calendar_events",
  "user_reminders",
];

export const TABLE_POLICIES = new Map([
  ...VERIFY_TABLES.map((name) => [name, "verify"]),
  ...DERIVED_TABLES.map((name) => [name, "derived"]),
  ...SECRET_TABLES.map((name) => [name, "secret-envelope"]),
  ...EXCLUDED_TABLES.map((name) => [name, "exclude"]),
  ...TRANSFORMED_TABLES.map((name) => [name, "transform"]),
  ...COPIED_TABLES.map((name) => [name, "copy"]),
]);

const TRANSFORMS = {
  email_campaign_recipient_jobs: {
    columns: {
      status:
        "CASE WHEN status IN ('queued', 'submitting', 'retry_wait', 'paused') THEN 'paused' ELSE status END",
      request_json:
        "CASE WHEN status IN ('queued', 'submitting', 'retry_wait', 'paused') THEN NULL ELSE request_json END",
      provider_reason:
        "CASE WHEN status IN ('queued', 'submitting', 'retry_wait', 'paused') THEN 'restore_requires_managed_transport' ELSE provider_reason END",
    },
  },
  email_provider_settings: {
    where: `provider_id <> 'cloudflare-email'`,
  },
  mailbox_aliases: {
    columns: {
      forwarding_status: "'pending'",
      forwarding_enabled: "0",
      status: "'pending_setup'",
      activated_at: "NULL",
      cf_destination_id: "NULL",
      cf_destination_verified_at: "NULL",
      cf_rule_id: "NULL",
      cf_last_synced_at: "NULL",
      cf_last_error: "NULL",
    },
  },
  sites: {
    columns: {
      custom_domain_status:
        "CASE WHEN custom_domain IS NULL OR trim(custom_domain) = '' THEN NULL ELSE 'pending' END",
      custom_domain_cf_id: "NULL",
    },
  },
  social_accounts: {
    columns: {
      access_token_ciphertext: "'portable-reconnect-required'",
      refresh_token_ciphertext: "NULL",
      token_expires_at: "NULL",
      scopes_json: "'[]'",
      status: "'revoked'",
      metadata_json: "'{\"portableReconnectRequired\":true}'",
      last_verified_at: "NULL",
    },
  },
  social_posting_plan_items: {
    columns: {
      status: "CASE WHEN status = 'reserved' THEN 'suggested' ELSE status END",
    },
  },
  social_posting_plans: {
    columns: {
      status: "CASE WHEN status = 'confirming' THEN 'needs_attention' ELSE status END",
      confirmation_token: "NULL",
      confirmation_started_at: "NULL",
    },
  },
  social_posting_reservations: {
    columns: {
      status: "CASE WHEN status = 'reserved' THEN 'released' ELSE status END",
    },
  },
  social_provider_settings: {
    columns: {
      encrypted_client_secret: "NULL",
      secret_hint: "NULL",
      secret_updated_at: "NULL",
      enabled: "0",
    },
  },
  social_suggestions: {
    columns: {
      status: "CASE WHEN status = 'choosing' THEN 'suggested' ELSE status END",
      choose_token: "NULL",
      choosing_at: "NULL",
      choose_platforms_json:
        "CASE WHEN status = 'choosing' THEN NULL ELSE choose_platforms_json END",
    },
  },
};

const SENSITIVE_FIELD_POLICIES = new Map([
  ["managed_runtime_state.credentials_revoked_at", "exclude hosted credential revocation state"],
  ["managed_runtime_state.state", "exclude hosted lifecycle state"],
  ["agent_channel_connections.setup_token", "exclude and re-pair"],
  ["ai_gateway_settings.account_id", "exclude platform configuration"],
  ["ai_gateway_settings.gateway_id", "exclude platform configuration"],
  ["ai_gateway_settings.encrypted_api_token", "exclude platform credential"],
  ["ai_gateway_settings.api_token_hint", "exclude platform credential metadata"],
  ["ai_gateway_settings.api_token_updated_at", "exclude platform credential metadata"],
  ["ai_provider_credentials.encrypted_api_key", "preserve encrypted owner credential"],
  ["booking_holds.hold_token", "exclude one-time state"],
  ["bookings.meeting_guest_token_hash", "preserve hashed guest meeting authorization"],
  ["calendar_sources.encrypted_source_url", "preserve encrypted owner credential"],
  ["commerce_settings.encrypted_stripe_secret_key", "preserve encrypted owner commerce credential"],
  ["email_provider_settings.encrypted_secret", "preserve encrypted non-platform credential"],
  ["email_provider_settings.secret_hint", "preserve non-secret hint"],
  ["email_provider_settings.secret_updated_at", "preserve credential metadata"],
  ["install_secrets.value", "allowlist into encrypted envelope"],
  ["local_executor_pairings.token_hash", "exclude and re-pair"],
  ["mailbox_aliases.cf_destination_id", "reset host-bound platform configuration"],
  ["mailbox_aliases.cf_destination_verified_at", "reset host-bound platform configuration"],
  ["mailbox_aliases.cf_rule_id", "reset host-bound platform configuration"],
  ["mailbox_aliases.cf_last_synced_at", "reset host-bound platform configuration"],
  ["mailbox_aliases.cf_last_error", "reset host-bound platform configuration"],
  ["me3_install_claim_states.state", "exclude one-time state"],
  ["mission_daemon_pairings.token_hash", "exclude and re-pair"],
  ["mobile_pairings.code_hash", "exclude and re-pair"],
  ["mobile_refresh_tokens.token_hash", "exclude and re-pair"],
  ["owner_profile.password_hash", "preserve local owner login"],
  ["sites.custom_domain_cf_id", "reset host-bound platform configuration"],
  ["social_accounts.access_token_ciphertext", "replace with noncredential reconnect marker"],
  ["social_accounts.refresh_token_ciphertext", "clear and reconnect"],
  ["social_accounts.token_expires_at", "clear and reconnect"],
  ["social_media_delivery_grants.token_hash", "exclude short-lived provider delivery grant"],
  ["social_posting_plans.confirmation_token", "reset ephemeral confirmation claim"],
  ["social_suggestions.choose_token", "reset ephemeral choose claim"],
  ["social_oauth_states.state", "exclude one-time state"],
  ["social_provider_settings.encrypted_client_secret", "exclude and reconnect"],
  ["social_provider_settings.secret_hint", "exclude credential metadata"],
  ["social_provider_settings.secret_updated_at", "exclude credential metadata"],
  ["subscribers.confirmation_token_hash", "preserve hashed subscriber confirmation token"],
  ["telegram_settings.encrypted_bot_token", "exclude and reconnect"],
  ["telegram_settings.bot_token_hint", "exclude credential metadata"],
  ["telegram_settings.bot_token_updated_at", "exclude credential metadata"],
  ["telegram_settings.encrypted_webhook_secret", "exclude and rotate"],
  ["telegram_settings.webhook_secret_hint", "exclude credential metadata"],
  ["telegram_settings.webhook_secret_updated_at", "exclude credential metadata"],
]);

const SENSITIVE_COLUMN_RE =
  /(?:^|_)(?:token|secret|password|credential)(?:_|$)|^encrypted_|_ciphertext$|^cf_|_cf_|^state$|code_hash/i;
const KNOWN_INSTALL_SECRETS = new Map([
  ["ME3_CORE_INSTALL_ID", "preserve"],
  ["TOKEN_ENCRYPTION_KEY", "preserve"],
  ["JWT_SECRET", "rotate"],
  ["ME3_CLOUD_OWNER_ID", "exclude"],
  ["ME3_CLOUD_CORE_TOKEN", "exclude"],
  ["ME3_MANAGED_CAMPAIGN_CALLBACK_SECRET", "exclude"],
]);

const FORBIDDEN_ARCHIVE_PATTERNS = [
  ["private key", /-----BEGIN [^-]*PRIVATE KEY-----/i],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["live Stripe secret", /\bsk_live_[A-Za-z0-9]{12,}\b/],
  ["Cloudflare API bearer token", /\b(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN)\s*[=:]\s*['\"]?[A-Za-z0-9_-]{20,}/i],
  ["deployment token", /\b(?:DEPLOYMENT_TOKEN|GITHUB_TOKEN)\s*[=:]\s*['\"]?[^\s'\"]{12,}/i],
];

const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".html", "text/html"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
]);

export class PortableError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "PortableError";
    this.code = code;
    this.details = details;
  }
}

export function resolveCoreInfo(repoRoot = REPO_ROOT) {
  const metadata = JSON.parse(readFileSync(join(repoRoot, "me3-core.json"), "utf8"));
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // A source archive can still prove its published tag/version without a .git directory.
  }
  const releaseTag = String(metadata.releaseNotesUrl || "").split("/").filter(Boolean).at(-1);
  return {
    version: metadata.version,
    tag: releaseTag || `v${metadata.version}`,
    commit,
    releaseChannel: metadata.releaseChannel,
  };
}

export async function exportPortableV1({
  database,
  r2Directory,
  output,
  passphrase,
  installId,
  managedHosted = false,
  createdAt = new Date().toISOString(),
  core = resolveCoreInfo(),
}) {
  requirePassphrase(passphrase);
  requireFile(database, "Source D1 SQLite file");
  if (typeof output !== "string" || !output) {
    throw new PortableError("INVALID_PATH", "Portable archive output path is required");
  }
  if (r2Directory) requireDirectory(r2Directory, "Source R2 materialization");
  if (existsSync(output)) {
    throw new PortableError("OUTPUT_EXISTS", `Portable archive path already exists: ${output}`);
  }

  const schema = validateDatabaseSchema(database);
  assertLocalLoginAvailable(database);
  if (managedHosted && !managedPortablePasswordMatches(database, passphrase)) {
    throw new PortableError(
      "MANAGED_RECOVERY_PASSWORD_INVALID",
      "Managed export passphrase does not match the prepared local recovery login",
    );
  }
  assertForeignKeys(database, "SOURCE_INVALID", "Source D1 foreign keys are invalid");
  const installSecrets = readInstallSecrets(database);
  const logicalInstallId = resolveInstallId(installId, installSecrets.get("ME3_CORE_INSTALL_ID"));
  const tokenEncryptionKey =
    installSecrets.get("TOKEN_ENCRYPTION_KEY") || randomBytes(32).toString("hex");
  assertEncryptionKeyAvailable(database, installSecrets.get("TOKEN_ENCRYPTION_KEY"));
  const migrations = readMigrationState(database);
  const providerConnections = readProviderConnections(database);
  const databaseExport = buildDatabaseExport(database);

  const temporaryOutput = `${output}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  mkdirSync(join(temporaryOutput, "data"), { recursive: true });
  mkdirSync(join(temporaryOutput, "objects", "blobs"), { recursive: true });
  mkdirSync(join(temporaryOutput, "config"), { recursive: true });
  mkdirSync(join(temporaryOutput, "secrets"), { recursive: true });

  try {
    const sql = databaseExport.sql;
    const compressedSql = gzipSync(Buffer.from(sql), { level: 9, mtime: 0 });
    writeFileSync(join(temporaryOutput, "data", "d1-sanitized.sql.gz"), compressedSql);

    const objects = exportR2Objects(r2Directory, temporaryOutput);
    const installConfig = {
      format: PORTABLE_FORMAT,
      logicalInstallId,
      destinationDeploymentMode: "self_hosted",
      requiresClientRepair: true,
      managedHostedRecovery: managedHosted,
      ...(managedHosted
        ? {
            recoveryPasswordSource: "managed-export-passphrase",
            requiresImmediatePasswordChange: true,
          }
        : {}),
      rotatedCredentials: ["JWT_SECRET", "mobile pairings", "mobile refresh tokens"],
      resetConfiguration: [
        "Cloudflare AI Gateway",
        "Cloudflare mailbox routing",
        "custom-domain Cloudflare identifiers",
        "ME3 Cloud claim/update credentials",
        "social OAuth connections",
        "Telegram/channel/daemon/local-executor pairings",
      ],
    };
    writeStableJson(join(temporaryOutput, "config", "install.json"), installConfig);
    writeStableJson(
      join(temporaryOutput, "config", "provider-connections.json"),
      providerConnections,
    );
    writeFileSync(
      join(temporaryOutput, "README.txt"),
      portableReadme({ logicalInstallId, core, createdAt, managedHosted }),
    );

    const secretPolicy = {
      portableNames: ["ME3_CORE_INSTALL_ID", "TOKEN_ENCRYPTION_KEY"],
      rotatedNames: ["JWT_SECRET"],
      excludedNames: [...installSecrets.entries()]
        .filter(([name]) => KNOWN_INSTALL_SECRETS.get(name) === "exclude")
        .map(([name]) => name)
        .sort(),
    };
    const manifestCore = {
      format: PORTABLE_FORMAT,
      formatVersion: PORTABLE_VERSION,
      createdAt,
      consistency: "quiescent-source-required",
      logicalInstallId,
      core,
      schema: {
        checksum: schema.checksum,
        coreInstallVersion: migrations.coreInstallVersion,
        d1Migration: migrations.d1.at(-1) || null,
        runtimeMigration: migrations.runtime.at(-1) || null,
        d1Migrations: migrations.d1,
        runtimeMigrations: migrations.runtime,
      },
      database: {
        sourceRowCount: databaseExport.sourceRowCount,
        portableRowCount: databaseExport.portableRowCount,
        excludedRowCount: databaseExport.excludedRowCount,
        sha256: sha256(sql),
        compressedSha256: sha256(compressedSql),
        tables: databaseExport.tables,
      },
      objects: {
        count: objects.count,
        bytes: objects.bytes,
        manifestSha256: objects.manifestSha256,
        aggregateSha256: objects.aggregateSha256,
      },
      files: {
        installConfigSha256: sha256(
          readFileSync(join(temporaryOutput, "config", "install.json")),
        ),
        providerConnectionsSha256: sha256(
          readFileSync(join(temporaryOutput, "config", "provider-connections.json")),
        ),
        readmeSha256: sha256(readFileSync(join(temporaryOutput, "README.txt"))),
      },
      secrets: secretPolicy,
      restore: {
        requiresCleanTarget: true,
        requiresExactCore: true,
        requiresExactMigrations: true,
        requiresClientRepair: true,
        managedHostedRecovery: managedHosted,
        requiresImmediatePasswordChange: managedHosted,
      },
    };
    const authenticatedBinding = buildAuthenticatedBinding(manifestCore);
    const envelope = encryptSecretEnvelope(
      {
        format: PORTABLE_FORMAT,
        logicalInstallId,
        authenticatedBinding,
        installSecrets: {
          ME3_CORE_INSTALL_ID: logicalInstallId,
          TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
        },
      },
      passphrase,
    );
    writeStableJson(join(temporaryOutput, "secrets", "portable-secrets.enc"), envelope);
    const manifest = {
      ...manifestCore,
      secrets: {
        ...secretPolicy,
        envelopeSha256: sha256(
          readFileSync(join(temporaryOutput, "secrets", "portable-secrets.enc")),
        ),
      },
      integrity: { authenticatedBinding },
    };
    writeStableJson(join(temporaryOutput, "manifest.json"), manifest);

    assertNoForbiddenSecrets([
      ["D1 export", sql],
      ["install config", readFileSync(join(temporaryOutput, "config", "install.json"), "utf8")],
      [
        "provider config",
        readFileSync(join(temporaryOutput, "config", "provider-connections.json"), "utf8"),
      ],
    ]);
    writeArchiveChecksums(temporaryOutput);
    validateArchive(temporaryOutput, passphrase, { core });
    renameSync(temporaryOutput, output);
    return { archive: output, manifest };
  } catch (error) {
    rmSync(temporaryOutput, { recursive: true, force: true });
    throw error;
  }
}

export function validateArchive(archive, passphrase, { core = resolveCoreInfo() } = {}) {
  requirePassphrase(passphrase);
  requireDirectory(archive, "Portable archive");
  validateArchiveChecksums(archive);

  const manifest = readJson(join(archive, "manifest.json"), "manifest");
  if (manifest.format !== PORTABLE_FORMAT || manifest.formatVersion !== PORTABLE_VERSION) {
    throw new PortableError("INVALID_ARCHIVE", "Unsupported portable archive format or version");
  }
  if (normalizeInstallId(manifest.logicalInstallId) !== manifest.logicalInstallId) {
    throw new PortableError("INVALID_ARCHIVE", "Portable manifest logical installation id is invalid");
  }
  assertExactCore(manifest.core, core);

  const sqlCompressed = readFileSync(join(archive, "data", "d1-sanitized.sql.gz"));
  let sql;
  try {
    sql = gunzipSync(sqlCompressed).toString("utf8");
  } catch (error) {
    throw new PortableError("INVALID_ARCHIVE", "Portable D1 export is not valid gzip data", error);
  }
  if (
    sha256(sqlCompressed) !== manifest.database.compressedSha256 ||
    sha256(sql) !== manifest.database.sha256
  ) {
    throw new PortableError("ARCHIVE_TAMPERED", "Portable D1 checksums do not match the manifest");
  }

  const envelopePath = join(archive, "secrets", "portable-secrets.enc");
  const envelopeBytes = readFileSync(envelopePath);
  if (sha256(envelopeBytes) !== manifest.secrets.envelopeSha256) {
    throw new PortableError("ARCHIVE_TAMPERED", "Portable secret envelope checksum does not match");
  }
  const secrets = decryptSecretEnvelope(JSON.parse(envelopeBytes.toString("utf8")), passphrase);
  const authenticatedBinding = buildAuthenticatedBinding(manifest);
  if (
    secrets.format !== PORTABLE_FORMAT ||
    secrets.logicalInstallId !== manifest.logicalInstallId ||
    secrets.authenticatedBinding !== authenticatedBinding ||
    manifest.integrity?.authenticatedBinding !== authenticatedBinding ||
    secrets.installSecrets?.ME3_CORE_INSTALL_ID !== manifest.logicalInstallId ||
    typeof secrets.installSecrets?.TOKEN_ENCRYPTION_KEY !== "string" ||
    !secrets.installSecrets.TOKEN_ENCRYPTION_KEY
  ) {
    throw new PortableError(
      secrets.authenticatedBinding === authenticatedBinding
        ? "INVALID_ARCHIVE"
        : "ARCHIVE_TAMPERED",
      "Portable secret envelope identity or authenticated archive binding is invalid",
    );
  }

  const fileChecks = [
    ["config/install.json", manifest.files?.installConfigSha256],
    ["config/provider-connections.json", manifest.files?.providerConnectionsSha256],
    ["README.txt", manifest.files?.readmeSha256],
  ];
  for (const [path, checksum] of fileChecks) {
    if (typeof checksum !== "string" || sha256(readFileSync(safeArchivePath(archive, path))) !== checksum) {
      throw new PortableError("ARCHIVE_TAMPERED", `Authenticated archive file differs: ${path}`);
    }
  }

  const objectManifestText = readFileSync(join(archive, "objects", "r2-manifest.ndjson"), "utf8");
  if (sha256(objectManifestText) !== manifest.objects.manifestSha256) {
    throw new PortableError("ARCHIVE_TAMPERED", "R2 manifest checksum does not match");
  }
  const objects = parseObjectManifest(objectManifestText);
  if (
    objects.length !== manifest.objects.count ||
    objects.reduce((sum, object) => sum + object.size, 0) !== manifest.objects.bytes ||
    sha256(objects.map((object) => `${object.key}\0${object.sha256}\0${object.size}\n`).join("")) !==
      manifest.objects.aggregateSha256
  ) {
    throw new PortableError("ARCHIVE_TAMPERED", "R2 counts or aggregate checksum do not match");
  }
  for (const object of objects) {
    const blob = readFileSync(safeArchivePath(archive, object.blob));
    if (blob.byteLength !== object.size || sha256(blob) !== object.sha256) {
      throw new PortableError("ARCHIVE_TAMPERED", `R2 object is missing or changed: ${object.key}`);
    }
  }
  assertArchiveFileSet(archive, objects);

  assertNoForbiddenSecrets([
    ["D1 export", sql],
    ["install config", readFileSync(join(archive, "config", "install.json"), "utf8")],
    [
      "provider config",
      readFileSync(join(archive, "config", "provider-connections.json"), "utf8"),
    ],
  ]);
  return { manifest, objects, secrets, sql };
}

export function restorePortableV1({
  archive,
  targetDatabase,
  targetR2Directory,
  importSqlOutput,
  passphrase,
  core = resolveCoreInfo(),
}) {
  requireFile(targetDatabase, "Target D1 SQLite file");
  if (typeof targetR2Directory !== "string" || !targetR2Directory) {
    throw new PortableError("INVALID_PATH", "Target R2 directory path is required");
  }
  if (importSqlOutput && existsSync(importSqlOutput)) {
    throw new PortableError("OUTPUT_EXISTS", `D1 import SQL path already exists: ${importSqlOutput}`);
  }
  const validated = validateArchive(archive, passphrase, { core });
  const targetSchema = validateDatabaseSchema(targetDatabase);
  if (targetSchema.checksum !== validated.manifest.schema.checksum) {
    throw new PortableError("SCHEMA_MISMATCH", "Target D1 schema does not match the snapshot schema");
  }
  assertMigrationState(targetDatabase, validated.manifest.schema);
  assertCleanTarget(targetDatabase);
  assertEmptyR2Target(targetR2Directory);

  const nonce = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const stagedDatabase = `${targetDatabase}.me3-restore-${nonce}`;
  const stagedR2 = `${targetR2Directory}.me3-restore-${nonce}`;
  checkpointDatabase(targetDatabase);
  copyFileSync(targetDatabase, stagedDatabase);
  mkdirSync(stagedR2, { recursive: true });

  try {
    for (const object of validated.objects) {
      const destination = safeR2Path(stagedR2, object.key);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(safeArchivePath(archive, object.blob), destination);
      if (sha256(readFileSync(destination)) !== object.sha256) {
        throw new PortableError("RESTORE_VERIFY_FAILED", `Restored R2 checksum failed: ${object.key}`);
      }
    }

    const now = new Date().toISOString();
    const sessionSecret = randomBytes(32).toString("hex");
    const secretRows = [
      ["ME3_CORE_INSTALL_ID", validated.manifest.logicalInstallId],
      ["TOKEN_ENCRYPTION_KEY", validated.secrets.installSecrets.TOKEN_ENCRYPTION_KEY],
      ["JWT_SECRET", sessionSecret],
    ];
    const secretStatements = secretRows.map(
      ([name, value]) =>
        `INSERT INTO install_secrets (name, value, created_at, updated_at) VALUES (${sqlQuote(name)}, ${sqlQuote(value)}, ${sqlQuote(now)}, ${sqlQuote(now)});`,
    );
    const restoreSql = [
      "PRAGMA defer_foreign_keys=TRUE;",
      "BEGIN TRANSACTION;",
      validated.sql,
      ...secretStatements,
      "COMMIT;",
    ].join("\n");
    // Wrangler's remote D1 import endpoint wraps the uploaded file in its own
    // atomic transaction and rejects explicit BEGIN/COMMIT statements.
    const importSql = [
      "PRAGMA defer_foreign_keys=TRUE;",
      validated.sql,
      ...secretStatements,
    ].join("\n");
    runSqlite(stagedDatabase, restoreSql);

    assertForeignKeys(
      stagedDatabase,
      "RESTORE_VERIFY_FAILED",
      "Restored D1 foreign keys are invalid",
    );
    verifyRestoredDatabase(stagedDatabase, validated.manifest);
    verifyRestoredObjects(stagedR2, validated.objects);

    rmSync(`${targetDatabase}-wal`, { force: true });
    rmSync(`${targetDatabase}-shm`, { force: true });
    if (existsSync(targetR2Directory)) rmSync(targetR2Directory, { recursive: true });
    renameSync(stagedR2, targetR2Directory);
    try {
      renameSync(stagedDatabase, targetDatabase);
    } catch (error) {
      renameSync(targetR2Directory, stagedR2);
      throw error;
    }
    if (importSqlOutput) {
      mkdirSync(dirname(importSqlOutput), { recursive: true });
      writeFileSync(importSqlOutput, `${importSql}\n`, { mode: 0o600 });
    }

    return {
      ok: true,
      logicalInstallId: validated.manifest.logicalInstallId,
      databaseRows: validated.manifest.database.portableRowCount,
      r2Objects: validated.manifest.objects.count,
      sessionsRotated: true,
      deviceCredentialsRotated: true,
      requiresClientRepair: true,
      ...(importSqlOutput ? { importSqlOutput } : {}),
    };
  } catch (error) {
    rmSync(stagedDatabase, { force: true });
    rmSync(`${stagedDatabase}-wal`, { force: true });
    rmSync(`${stagedDatabase}-shm`, { force: true });
    rmSync(stagedR2, { recursive: true, force: true });
    throw error;
  }
}

export function comparePortableArchives({
  sourceArchive,
  restoredArchive,
  passphrase,
  core = resolveCoreInfo(),
}) {
  const source = validateArchive(sourceArchive, passphrase, { core });
  const restored = validateArchive(restoredArchive, passphrase, { core });
  const sourceProof = portableProofShape(source);
  const restoredProof = portableProofShape(restored);
  if (stableJson(sourceProof) !== stableJson(restoredProof)) {
    throw new PortableError("RESTORE_VERIFY_FAILED", "Restored snapshot does not match the source", {
      source: sourceProof,
      restored: restoredProof,
    });
  }
  if (
    source.secrets.installSecrets.TOKEN_ENCRYPTION_KEY !==
    restored.secrets.installSecrets.TOKEN_ENCRYPTION_KEY
  ) {
    throw new PortableError(
      "RESTORE_VERIFY_FAILED",
      "Restored snapshot did not preserve the owner credential encryption key",
    );
  }
  return { ok: true, ...sourceProof };
}

export function buildManifestForTest(value) {
  return stableJson(value);
}

export function inspectPortableDatabase(database) {
  validateDatabaseSchema(database);
  return buildDatabaseExport(database);
}

function validateDatabaseSchema(database) {
  const tables = sqliteJson(
    database,
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  ).map((row) => row.name);
  const unknown = tables.filter((name) => !TABLE_POLICIES.has(name) && !OPTIONAL_PLATFORM_TABLES.has(name));
  const missing = [...TABLE_POLICIES.keys()].filter((name) => !tables.includes(name));
  if (unknown.length || missing.length) {
    throw new PortableError("SCHEMA_UNCLASSIFIED", "D1 schema is not fully classified for portability", {
      unknown,
      missing,
    });
  }

  const schema = [];
  for (const table of tables.filter((name) => name !== "_cf_METADATA")) {
    const columns = sqliteJson(database, `PRAGMA table_info(${identifier(table)});`);
    for (const column of columns) {
      const key = `${table}.${column.name}`;
      if (SENSITIVE_COLUMN_RE.test(column.name) && !SENSITIVE_FIELD_POLICIES.has(key)) {
        throw new PortableError(
          "SECRET_FIELD_UNCLASSIFIED",
          `Credential-bearing D1 field is not classified: ${key}`,
        );
      }
    }
    schema.push({
      table,
      columns: columns.map(({ cid, name, type, notnull, dflt_value, pk }) => ({
        cid,
        name,
        type,
        notnull,
        default: dflt_value,
        primaryKey: pk,
      })),
    });
  }
  return { tables, checksum: sha256(stableJson(schema)) };
}

function assertLocalLoginAvailable(database) {
  const rows = sqliteJson(
    database,
    "SELECT email, password_hash AS passwordHash FROM owner_profile WHERE id = 'owner';",
  );
  const owner = rows.length === 1 ? rows[0] : null;
  if (
    typeof owner?.email !== "string" ||
    !owner.email.trim().includes("@") ||
    !isSupportedPasswordHash(owner.passwordHash)
  ) {
    throw new PortableError(
      "LOCAL_PASSWORD_REQUIRED",
      "Verified local password login is required before portable export",
    );
  }
}

function isSupportedPasswordHash(value) {
  if (typeof value !== "string") return false;
  const [algorithm, rawIterations, rawSalt, expectedHash, extra] = value.split("$");
  const iterations = Number(rawIterations);
  if (
    extra !== undefined ||
    algorithm !== "pbkdf2_sha256" ||
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !/^[A-Za-z0-9_-]+$/.test(rawSalt || "") ||
    !/^[A-Za-z0-9_-]+$/.test(expectedHash || "")
  ) {
    return false;
  }
  const salt = Buffer.from(rawSalt, "base64url");
  const hash = Buffer.from(expectedHash, "base64url");
  return (
    salt.byteLength > 0 &&
    hash.byteLength === 32 &&
    salt.toString("base64url") === rawSalt &&
    hash.toString("base64url") === expectedHash
  );
}

function readInstallSecrets(database) {
  const rows = sqliteJson(database, "SELECT name, value FROM install_secrets ORDER BY name;");
  const unknown = rows.map((row) => row.name).filter((name) => !KNOWN_INSTALL_SECRETS.has(name));
  if (unknown.length) {
    throw new PortableError(
      "SECRET_UNCLASSIFIED",
      "install_secrets contains names without a portable-v1 classification",
      { unknown },
    );
  }
  return new Map(rows.map((row) => [row.name, row.value]));
}

function resolveInstallId(input, stored) {
  const explicit = normalizeInstallId(input);
  const fromDatabase = normalizeInstallId(stored);
  if (stored && !fromDatabase) {
    throw new PortableError("INVALID_IDENTITY", "Stored ME3 logical installation id is invalid");
  }
  if (explicit && fromDatabase && explicit !== fromDatabase) {
    throw new PortableError("IDENTITY_MISMATCH", "Explicit and stored installation identities differ");
  }
  const resolved = explicit || fromDatabase;
  if (!resolved) {
    throw new PortableError(
      "INVALID_IDENTITY",
      "A valid ME3_CORE_INSTALL_ID is required for a portable snapshot",
    );
  }
  return resolved;
}

function normalizeInstallId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return INSTALL_ID_RE.test(normalized) ? normalized : null;
}

function assertEncryptionKeyAvailable(database, key) {
  const encryptedChecks = [
    ["ai_provider_credentials", "encrypted_api_key"],
    ["calendar_sources", "encrypted_source_url"],
    ["commerce_settings", "encrypted_stripe_secret_key"],
    ["email_provider_settings", "encrypted_secret"],
  ];
  const encryptedRows = encryptedChecks.reduce(
    (sum, [table, column]) =>
      sum + Number(sqliteScalar(database, `SELECT COUNT(*) FROM ${identifier(table)} WHERE ${identifier(column)} IS NOT NULL;`)),
    0,
  );
  if (encryptedRows > 0 && !key) {
    throw new PortableError(
      "SECRET_MISSING",
      "Encrypted owner credentials exist but TOKEN_ENCRYPTION_KEY is not stored in D1",
    );
  }
}

function readMigrationState(database) {
  const d1 = sqliteJson(database, "SELECT id, name FROM d1_migrations ORDER BY id;").map((row) => ({
    id: Number(row.id),
    name: row.name,
  }));
  const runtime = sqliteJson(
    database,
    "SELECT id, checksum FROM core_runtime_migrations ORDER BY id;",
  ).map((row) => ({ id: row.id, checksum: row.checksum }));
  const expectedRuntime = RUNTIME_MIGRATIONS.map(([id, checksum]) => ({ id, checksum }));
  if (stableJson(runtime) !== stableJson(expectedRuntime)) {
    throw new PortableError("MIGRATION_MISMATCH", "Core runtime migration state is incomplete or changed", {
      expected: expectedRuntime,
      actual: runtime,
    });
  }
  if (d1.length === 0) {
    throw new PortableError("MIGRATION_MISMATCH", "D1 migration state is empty");
  }
  const coreInstallVersion = sqliteJson(
    database,
    "SELECT id, schema_version AS schemaVersion FROM core_install ORDER BY id;",
  );
  return { d1, runtime, coreInstallVersion };
}

function assertMigrationState(database, expectedSchema) {
  const actual = readMigrationState(database);
  if (
    !d1MigrationStateIsCompatible(
      actual.d1,
      expectedSchema.d1Migrations,
      expectedSchema.runtimeMigrations,
    ) ||
    stableJson(actual.runtime) !== stableJson(expectedSchema.runtimeMigrations)
  ) {
    throw new PortableError("MIGRATION_MISMATCH", "Target migration level does not match the snapshot");
  }
}

function d1MigrationStateIsCompatible(actual, expected, runtime) {
  const actualNames = actual.map((migration) => migration.name);
  const expectedNames = expected.map((migration) => migration.name);
  if (
    new Set(actualNames).size !== actualNames.length ||
    new Set(expectedNames).size !== expectedNames.length
  ) {
    return false;
  }

  const actualNameSet = new Set(actualNames);
  if (expectedNames.some((name) => !actualNameSet.has(name))) return false;

  // D1 assigns ledger IDs from deployment history, so two installations with
  // the same migration names and schema can legitimately have different IDs.
  // A fresh install can also record a migration that an upgraded install
  // already applied through the identically named Core runtime migration.
  const expectedNameSet = new Set(expectedNames);
  const runtimeMigrationNames = new Set(
    runtime.map((migration) => `${migration.id}.sql`),
  );
  return actualNames.every(
    (name) => expectedNameSet.has(name) || runtimeMigrationNames.has(name),
  );
}

function buildDatabaseExport(database) {
  const statementsByTable = new Map();
  const tables = [];
  let sourceRowCount = 0;
  let portableRowCount = 0;
  let excludedRowCount = 0;

  for (const [name, policy] of [...TABLE_POLICIES.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sourceRows = Number(sqliteScalar(database, `SELECT COUNT(*) FROM ${identifier(name)};`));
    sourceRowCount += policy === "verify" || policy === "derived" ? 0 : sourceRows;
    if (policy === "copy" || policy === "transform") {
      const exported = canonicalTableRows(database, name);
      statementsByTable.set(name, exported.statements);
      portableRowCount += exported.rows;
      excludedRowCount += sourceRows - exported.rows;
      tables.push({
        name,
        policy,
        sourceRows,
        rows: exported.rows,
        sha256: exported.sha256,
      });
    } else {
      if (policy !== "verify" && policy !== "derived") excludedRowCount += sourceRows;
      tables.push({ name, policy, sourceRows, rows: 0, sha256: EMPTY_SHA256 });
    }
  }
  const statements = foreignKeySafeTableOrder(
    database,
    [...statementsByTable.keys()],
  ).flatMap((name) => statementsByTable.get(name) || []);
  return {
    sql: statements.length ? `${statements.join("\n")}\n` : "",
    sourceRowCount,
    portableRowCount,
    excludedRowCount,
    tables,
  };
}

function foreignKeySafeTableOrder(database, tableNames) {
  const included = new Set(tableNames);
  const dependencies = new Map(
    tableNames.map((name) => [
      name,
      sqliteJson(database, `PRAGMA foreign_key_list(${identifier(name)});`)
        .map((row) => row.table)
        .filter((dependency) => dependency !== name && included.has(dependency))
        .sort(),
    ]),
  );
  const ordered = [];
  const visited = new Set();
  const active = new Set();
  const visit = (name) => {
    if (visited.has(name)) return;
    if (active.has(name)) {
      throw new PortableError(
        "SCHEMA_UNCLASSIFIED",
        "Portable tables contain a cyclic foreign-key dependency",
      );
    }
    active.add(name);
    for (const dependency of dependencies.get(name) || []) visit(dependency);
    active.delete(name);
    visited.add(name);
    ordered.push(name);
  };
  for (const name of [...tableNames].sort()) visit(name);
  return ordered;
}

function canonicalTableRows(database, table) {
  const tableColumns = sqliteJson(database, `PRAGMA table_info(${identifier(table)});`);
  const columns = tableColumns.map((row) => row.name);
  const primaryColumns = tableColumns
    .filter((row) => Number(row.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((row) => row.name);
  if (!primaryColumns.length) {
    throw new PortableError(
      "SCHEMA_UNCLASSIFIED",
      `Portable table requires a primary key: ${table}`,
    );
  }
  const transform = TRANSFORMS[table] || {};
  const projected = columns.map(
    (column) => `${transform.columns?.[column] || identifier(column)} AS ${identifier(column)}`,
  );
  const quoted = columns
    .map((column) => {
      const value = identifier(column);
      // SQL parsers normalize CRLF inside string literals. Encode text as a
      // UTF-8 blob cast back to TEXT so email bodies and other owner content
      // survive the generated import SQL byte-for-byte.
      return `CASE WHEN typeof(${value}) = 'text' THEN 'CAST(X''' || hex(CAST(${value} AS BLOB)) || ''' AS TEXT)' ELSE quote(${value}) END`;
    })
    .join(", ");
  const order = columns.map(identifier).join(", ");
  const query = `SELECT json_array(${quoted}) FROM (SELECT ${projected.join(", ")} FROM ${identifier(table)}${transform.where ? ` WHERE ${transform.where}` : ""}) ORDER BY ${order};`;
  const output = runSqlite(database, query).trim();
  const rowLines = output ? output.split("\n") : [];
  const statements = rowLines.flatMap((line) => {
    const values = JSON.parse(line);
    return chunkedInsertStatements(table, columns, primaryColumns, values);
  });
  const canonical = statements.length ? `${statements.join("\n")}\n` : "";
  return { statements, rows: rowLines.length, sha256: sha256(canonical) };
}

function chunkedInsertStatements(table, columns, primaryColumns, values) {
  const working = [...values];
  const primaryIndexes = new Set(
    primaryColumns.map((column) => columns.indexOf(column)),
  );
  const candidates = values
    .map((value, index) => ({ index, ...parseChunkableLiteral(value) }))
    .filter((candidate) => candidate.type && candidate.hex && !primaryIndexes.has(candidate.index))
    .sort((a, b) => b.hex.length - a.hex.length || a.index - b.index);
  const buildInsert = () =>
    `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(", ")}) VALUES (${working.join(", ")});`;

  let insert = buildInsert();
  const deferred = [];
  while (Buffer.byteLength(insert, "utf8") > MAX_IMPORT_STATEMENT_BYTES && candidates.length) {
    const candidate = candidates.shift();
    working[candidate.index] = candidate.type === "blob" ? "X''" : "CAST(X'' AS TEXT)";
    deferred.push(candidate);
    insert = buildInsert();
  }
  if (Buffer.byteLength(insert, "utf8") > MAX_IMPORT_STATEMENT_BYTES) {
    throw new PortableError(
      "ROW_TOO_LARGE",
      `Portable row cannot be represented safely: ${table}`,
    );
  }

  const where = primaryColumns
    .map((column) => {
      const index = columns.indexOf(column);
      return `${identifier(column)} IS ${values[index]}`;
    })
    .join(" AND ");
  const statements = [insert];
  for (const candidate of deferred.sort((a, b) => a.index - b.index)) {
    const column = identifier(columns[candidate.index]);
    for (
      let offset = 0;
      offset < candidate.hex.length;
      offset += IMPORT_VALUE_CHUNK_BYTES * 2
    ) {
      const chunk = candidate.hex.slice(offset, offset + IMPORT_VALUE_CHUNK_BYTES * 2);
      statements.push(
        `UPDATE ${identifier(table)} SET ${column} = CAST(${column} AS TEXT) || CAST(X'${chunk}' AS TEXT) WHERE ${where};`,
      );
    }
    if (candidate.type === "blob") {
      statements.push(
        `UPDATE ${identifier(table)} SET ${column} = CAST(${column} AS BLOB) WHERE ${where};`,
      );
    }
  }
  if (statements.some((statement) => Buffer.byteLength(statement, "utf8") > MAX_IMPORT_STATEMENT_BYTES)) {
    throw new PortableError(
      "ROW_TOO_LARGE",
      `Portable row chunk exceeds the import limit: ${table}`,
    );
  }
  return statements;
}

function parseChunkableLiteral(value) {
  const text = /^CAST\(X'([0-9A-F]*)' AS TEXT\)$/.exec(value);
  if (text) return { type: "text", hex: text[1] };
  const blob = /^X'([0-9A-F]*)'$/.exec(value);
  if (blob) return { type: "blob", hex: blob[1] };
  return { type: null, hex: "" };
}

function readProviderConnections(database) {
  return {
    format: PORTABLE_FORMAT,
    aiProviders: sqliteJson(
      database,
      `SELECT provider_id AS providerId,
              encrypted_api_key IS NOT NULL AS credentialPreserved,
              api_key_hint AS credentialHint,
              api_key_updated_at AS credentialUpdatedAt
       FROM ai_provider_credentials ORDER BY provider_id;`,
    ),
    calendarSources: sqliteJson(
      database,
      `SELECT id, kind, name, source_url_hint AS sourceHint, status,
              encrypted_source_url IS NOT NULL AS credentialPreserved
       FROM calendar_sources ORDER BY id;`,
    ),
    commerce: sqliteJson(
      database,
      `SELECT encrypted_stripe_secret_key IS NOT NULL AS credentialPreserved,
              stripe_key_hint AS credentialHint
       FROM commerce_settings ORDER BY user_id;`,
    ),
    emailProviders: sqliteJson(
      database,
      `SELECT provider_id AS providerId,
              provider_id <> 'cloudflare-email' AS portable,
              CASE WHEN provider_id = 'cloudflare-email' THEN 1 ELSE 0 END AS reconnectRequired,
              encrypted_secret IS NOT NULL AS credentialPreserved,
              secret_hint AS credentialHint
       FROM email_provider_settings ORDER BY provider_id;`,
    ),
    socialAccounts: sqliteJson(
      database,
      `SELECT platform, platform_handle AS handle, display_name AS displayName,
              status, 1 AS reconnectRequired
       FROM social_accounts ORDER BY platform, platform_account_id;`,
    ),
    socialProviderApps: sqliteJson(
      database,
      `SELECT provider_id AS providerId, client_id AS clientId, 1 AS reconnectRequired
       FROM social_provider_settings ORDER BY provider_id;`,
    ),
    telegram: sqliteJson(
      database,
      `SELECT bot_username AS botUsername, 1 AS reconnectRequired
       FROM telegram_settings ORDER BY user_id;`,
    ),
    cloudflareAiGateway: Number(sqliteScalar(database, "SELECT COUNT(*) FROM ai_gateway_settings;"))
      ? { reconnectRequired: true }
      : null,
  };
}

function exportR2Objects(sourceDirectory, archiveRoot) {
  const sourceFiles = sourceDirectory ? collectFiles(sourceDirectory) : [];
  const objects = [];
  const copiedBlobs = new Set();
  for (const sourcePath of sourceFiles) {
    const key = relative(resolve(sourceDirectory), sourcePath).split(sep).join("/");
    assertSafeR2Key(key);
    const bytes = readFileSync(sourcePath);
    const checksum = sha256(bytes);
    const blob = `objects/blobs/${checksum}`;
    if (!copiedBlobs.has(checksum)) {
      copyFileSync(sourcePath, join(archiveRoot, ...blob.split("/")));
      copiedBlobs.add(checksum);
    }
    objects.push({
      key,
      blob,
      size: bytes.byteLength,
      sha256: checksum,
      contentType: CONTENT_TYPES.get(extname(key).toLowerCase()) || "application/octet-stream",
      customMetadata: {},
    });
  }
  objects.sort((a, b) => a.key.localeCompare(b.key));
  const manifestText = objects.map((object) => stableJson(object)).join("\n") + (objects.length ? "\n" : "");
  writeFileSync(join(archiveRoot, "objects", "r2-manifest.ndjson"), manifestText);
  return {
    count: objects.length,
    bytes: objects.reduce((sum, object) => sum + object.size, 0),
    manifestSha256: sha256(manifestText),
    aggregateSha256: sha256(
      objects.map((object) => `${object.key}\0${object.sha256}\0${object.size}\n`).join(""),
    ),
  };
}

function parseObjectManifest(text) {
  if (!text.trim()) return [];
  const objects = text
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new PortableError("INVALID_ARCHIVE", `Invalid R2 manifest line ${index + 1}`, error);
      }
    });
  const keys = new Set();
  for (const object of objects) {
    if (
      !object ||
      typeof object.key !== "string" ||
      typeof object.blob !== "string" ||
      typeof object.sha256 !== "string" ||
      !Number.isSafeInteger(object.size) ||
      object.size < 0
    ) {
      throw new PortableError("INVALID_ARCHIVE", "R2 manifest contains an invalid object record");
    }
    assertSafeR2Key(object.key);
    if (!/^objects\/blobs\/[a-f0-9]{64}$/.test(object.blob) || object.blob.slice(-64) !== object.sha256) {
      throw new PortableError("INVALID_ARCHIVE", `R2 blob path is invalid: ${object.key}`);
    }
    if (keys.has(object.key)) {
      throw new PortableError("INVALID_ARCHIVE", `R2 manifest repeats object key: ${object.key}`);
    }
    keys.add(object.key);
  }
  return objects;
}

function verifyRestoredDatabase(database, manifest) {
  const actual = buildDatabaseExport(database);
  const mismatch = actual.tables.find((table, index) => {
    const expected = manifest.database.tables[index];
    return table.name !== expected?.name || table.rows !== expected.rows || table.sha256 !== expected.sha256;
  });
  if (actual.portableRowCount !== manifest.database.portableRowCount || mismatch) {
    const expected = mismatch
      ? manifest.database.tables.find((table) => table.name === mismatch.name)
      : null;
    throw new PortableError(
      "RESTORE_VERIFY_FAILED",
      "Restored D1 row counts or checksums differ",
      {
        expectedRows: manifest.database.portableRowCount,
        actualRows: actual.portableRowCount,
        ...(mismatch
          ? {
              table: mismatch.name,
              expectedTableRows: expected?.rows,
              actualTableRows: mismatch.rows,
              expectedTableSha256: expected?.sha256,
              actualTableSha256: mismatch.sha256,
            }
          : {}),
      },
    );
  }
  const installSecrets = readInstallSecrets(database);
  if (
    installSecrets.size !== 3 ||
    installSecrets.get("ME3_CORE_INSTALL_ID") !== manifest.logicalInstallId ||
    !installSecrets.get("TOKEN_ENCRYPTION_KEY") ||
    !installSecrets.get("JWT_SECRET")
  ) {
    throw new PortableError("RESTORE_VERIFY_FAILED", "Restored installation credentials are invalid");
  }
}

function verifyRestoredObjects(targetDirectory, expected) {
  const files = collectFiles(targetDirectory);
  if (files.length !== expected.length) {
    throw new PortableError("RESTORE_VERIFY_FAILED", "Restored R2 object count differs");
  }
  for (const object of expected) {
    const bytes = readFileSync(safeR2Path(targetDirectory, object.key));
    if (bytes.byteLength !== object.size || sha256(bytes) !== object.sha256) {
      throw new PortableError("RESTORE_VERIFY_FAILED", `Restored R2 object differs: ${object.key}`);
    }
  }
}

function portableProofShape(validated) {
  return {
    format: validated.manifest.format,
    formatVersion: validated.manifest.formatVersion,
    logicalInstallId: validated.manifest.logicalInstallId,
    core: validated.manifest.core,
    schema: {
      checksum: validated.manifest.schema.checksum,
      d1Migrations: validated.manifest.schema.d1Migrations,
      runtimeMigrations: validated.manifest.schema.runtimeMigrations,
    },
    database: {
      portableRowCount: validated.manifest.database.portableRowCount,
      tables: validated.manifest.database.tables.map(({ name, policy, rows, sha256: checksum }) => ({
        name,
        policy,
        rows,
        sha256: checksum,
      })),
    },
    objects: validated.manifest.objects,
  };
}

function buildAuthenticatedBinding(manifest) {
  return sha256(
    stableJson({
      format: manifest.format,
      formatVersion: manifest.formatVersion,
      createdAt: manifest.createdAt,
      consistency: manifest.consistency,
      logicalInstallId: manifest.logicalInstallId,
      core: manifest.core,
      schema: manifest.schema,
      database: manifest.database,
      objects: manifest.objects,
      files: manifest.files,
      secrets: {
        portableNames: manifest.secrets?.portableNames,
        rotatedNames: manifest.secrets?.rotatedNames,
        excludedNames: manifest.secrets?.excludedNames,
      },
      restore: manifest.restore,
    }),
  );
}

function assertArchiveFileSet(archive, objects) {
  const expected = [
    "README.txt",
    "checksums.sha256",
    "config/install.json",
    "config/provider-connections.json",
    "data/d1-sanitized.sql.gz",
    "manifest.json",
    "objects/r2-manifest.ndjson",
    "secrets/portable-secrets.enc",
    ...new Set(objects.map((object) => object.blob)),
  ].sort();
  const actual = collectFiles(archive)
    .map((path) => relative(archive, path).split(sep).join("/"))
    .sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw new PortableError("INVALID_ARCHIVE", "Portable archive contains unclassified files");
  }
}

function assertCleanTarget(database) {
  const occupied = [];
  for (const [table, policy] of TABLE_POLICIES) {
    if (policy === "verify" || policy === "derived") continue;
    const rows = Number(sqliteScalar(database, `SELECT COUNT(*) FROM ${identifier(table)};`));
    if (rows > 0) occupied.push({ table, rows });
  }
  if (occupied.length) {
    throw new PortableError("TARGET_NOT_CLEAN", "Restore target D1 contains installation data", {
      occupied,
    });
  }
}

function assertEmptyR2Target(directory) {
  if (!existsSync(directory)) return;
  if (!statSync(directory).isDirectory() || collectFiles(directory).length > 0) {
    throw new PortableError("TARGET_NOT_CLEAN", "Restore target R2 directory is not empty");
  }
}

function checkpointDatabase(database) {
  runSqlite(database, "PRAGMA wal_checkpoint(TRUNCATE);");
}

function assertForeignKeys(database, code, message) {
  const foreignKeyErrors = sqliteJson(database, "PRAGMA foreign_key_check;");
  if (foreignKeyErrors.length > 0) {
    throw new PortableError(code, message, { foreignKeyErrors });
  }
}

function assertExactCore(snapshot, current) {
  for (const field of ["version", "tag", "commit"]) {
    if (snapshot?.[field] !== current?.[field]) {
      throw new PortableError(
        "CORE_VERSION_MISMATCH",
        `Snapshot Core ${field} ${snapshot?.[field] || "unknown"} does not match ${current?.[field] || "unknown"}`,
      );
    }
  }
}

function encryptSecretEnvelope(payload, passphrase) {
  const dataKey = randomBytes(32);
  const salt = randomBytes(16);
  const wrappingKey = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  return {
    format: PORTABLE_FORMAT,
    cipher: "aes-256-gcm",
    kdf: { name: "scrypt", N: 16384, r: 8, p: 1, salt: salt.toString("base64") },
    wrappedKey: encryptBytes(dataKey, wrappingKey),
    payload: encryptBytes(Buffer.from(stableJson(payload)), dataKey),
  };
}

function decryptSecretEnvelope(envelope, passphrase) {
  try {
    if (
      envelope?.format !== PORTABLE_FORMAT ||
      envelope?.cipher !== "aes-256-gcm" ||
      envelope?.kdf?.name !== "scrypt" ||
      envelope.kdf.N !== 16384 ||
      envelope.kdf.r !== 8 ||
      envelope.kdf.p !== 1
    ) {
      throw new Error("unsupported envelope");
    }
    const salt = Buffer.from(envelope.kdf.salt, "base64");
    const wrappingKey = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
    const dataKey = decryptBytes(envelope.wrappedKey, wrappingKey);
    return JSON.parse(decryptBytes(envelope.payload, dataKey).toString("utf8"));
  } catch (error) {
    throw new PortableError("WRONG_PASSPHRASE", "Portable archive passphrase was not accepted", error);
  }
}

function encryptBytes(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptBytes(value, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]);
}

function writeArchiveChecksums(root) {
  const lines = collectFiles(root)
    .map((path) => `${sha256(readFileSync(path))}  ${relative(root, path).split(sep).join("/")}`)
    .sort();
  writeFileSync(join(root, "checksums.sha256"), `${lines.join("\n")}\n`);
}

function validateArchiveChecksums(root) {
  const checksumPath = join(root, "checksums.sha256");
  requireFile(checksumPath, "Archive checksum file");
  const records = readFileSync(checksumPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      if (!match) throw new PortableError("INVALID_ARCHIVE", "Invalid checksums.sha256 record");
      return { checksum: match[1], path: match[2] };
    });
  const actualPaths = collectFiles(root)
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path !== "checksums.sha256")
    .sort();
  const expectedPaths = records.map((record) => record.path).sort();
  if (stableJson(actualPaths) !== stableJson(expectedPaths)) {
    throw new PortableError("ARCHIVE_TAMPERED", "Portable archive file set is incomplete or unexpected");
  }
  for (const record of records) {
    const path = safeArchivePath(root, record.path);
    if (sha256(readFileSync(path)) !== record.checksum) {
      throw new PortableError("ARCHIVE_TAMPERED", `Portable archive checksum failed: ${record.path}`);
    }
  }
}

function assertNoForbiddenSecrets(documents) {
  for (const [document, value] of documents) {
    for (const [label, pattern] of FORBIDDEN_ARCHIVE_PATTERNS) {
      if (pattern.test(value)) {
        throw new PortableError("FORBIDDEN_SECRET", `${document} contains a forbidden ${label}`);
      }
    }
  }
}

function collectFiles(root) {
  if (!existsSync(root)) return [];
  const resolvedRoot = resolve(root);
  if (!statSync(resolvedRoot).isDirectory()) {
    throw new PortableError("INVALID_PATH", `Expected a directory: ${root}`);
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PortableError("INVALID_PATH", `Symbolic links are not allowed: ${path}`);
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new PortableError("INVALID_PATH", `Unsupported filesystem entry: ${path}`);
    }
  };
  visit(resolvedRoot);
  return files.sort();
}

function assertSafeR2Key(key) {
  if (!key || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new PortableError("INVALID_OBJECT_KEY", `R2 object key is unsafe for portable restore: ${key}`);
  }
}

function safeR2Path(root, key) {
  assertSafeR2Key(key);
  const destination = resolve(root, ...key.split("/"));
  if (!destination.startsWith(`${resolve(root)}${sep}`)) {
    throw new PortableError("INVALID_OBJECT_KEY", `R2 object key escapes restore directory: ${key}`);
  }
  return destination;
}

function safeArchivePath(root, path) {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || !part)) {
    throw new PortableError("INVALID_ARCHIVE", `Archive path is unsafe: ${path}`);
  }
  const resolved = resolve(root, ...path.split("/"));
  if (!resolved.startsWith(`${resolve(root)}${sep}`)) {
    throw new PortableError("INVALID_ARCHIVE", `Archive path escapes root: ${path}`);
  }
  return resolved;
}

function sqliteJson(database, sql) {
  const output = runSqlite(database, sql, { json: true }).trim();
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new PortableError("SQLITE_FAILED", "SQLite returned invalid JSON", { sql, output, error });
  }
}

function sqliteScalar(database, sql) {
  return runSqlite(database, sql).trim();
}

function runSqlite(database, sql, { json = false } = {}) {
  const result = spawnSync("sqlite3", [...(json ? ["-json"] : []), database], {
    input: `.bail on\n${sql}\n`,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error?.code === "ENOENT") {
    throw new PortableError("SQLITE_MISSING", "sqlite3 is required for ME3 portable export/restore");
  }
  if (result.status !== 0) {
    throw new PortableError("SQLITE_FAILED", result.stderr.trim() || "SQLite command failed", {
      sql,
    });
  }
  return result.stdout;
}

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}

function writeStableJson(path, value) {
  writeFileSync(path, `${stableJson(value)}\n`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new PortableError("INVALID_ARCHIVE", `Portable ${label} is invalid JSON`, error);
  }
}

function requirePassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new PortableError(
      "PASSPHRASE_REQUIRED",
      "ME3_PORTABLE_PASSPHRASE must contain at least 12 characters",
    );
  }
}

function requireFile(path, label) {
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    throw new PortableError("INVALID_PATH", `${label} was not found: ${path || "(missing)"}`);
  }
}

function requireDirectory(path, label) {
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
    throw new PortableError("INVALID_PATH", `${label} was not found: ${path || "(missing)"}`);
  }
}

function portableReadme({ logicalInstallId, core, createdAt, managedHosted = false }) {
  return `ME3 portable snapshot\n\nFormat: ${PORTABLE_FORMAT}\nCreated: ${createdAt}\nLogical installation: ${logicalInstallId}\nCore: ${core.version} (${core.tag}, ${core.commit})\n\nThis snapshot requires a clean installation running the exact same Core and migration versions.\nSet ME3_PORTABLE_PASSPHRASE, then run pnpm portable:restore with the archive, target D1 SQLite file, and empty target R2 directory.\nThe source must be quiescent while D1 and R2 are materialized. This v1 proof does not provide a live-write barrier.\nBrowser sessions, mobile/device credentials, one-time state, platform credentials, and host-bound configuration are not restored. ${managedHosted ? "For this managed-hosting export, the export passphrase is also the temporary restored local login password; change it immediately after signing in. " : "Sign in with the local owner password. "}Re-pair clients after restore.\n`;
}

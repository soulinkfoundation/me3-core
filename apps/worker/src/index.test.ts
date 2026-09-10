import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { validateMe3KnowledgeAgainstPlugins } from "@me3/knowledge";
import {
  DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
  DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
  allowsAgentChatRawModelSelection,
  normalizeMe3DeploymentMode,
} from "@me3-core/plugin-agent-chat";
import app, { getMe3CloudUsernamePublishBlockReason } from "./index";
import coreApp from "./app";
import * as networkDirectory from "./network-directory";
import {
  DEFAULT_WORKERS_AI_TEXT_MODEL,
  generateAiText,
  updateAiSettings,
} from "./ai-providers";
import { ME3_CORE_VERSION } from "./core-version";
import {
  CORE_PLUGIN_CATALOG,
  validateCorePluginAgentToolContracts,
  type DbPluginInstallation,
} from "./plugins";
import type {
  DbAiModelDefault,
  DbAiProviderCredential,
  DbContact,
  DbCalendarSource,
  DbCalendarSourceEvent,
  DbEmailProviderSetting,
  DbEmailSendAudit,
  DbMailboxAlias,
  DbMailboxMessage,
  DbBooking,
  DbSchedulingRequest,
  DbSchedulingRequestAudit,
  DbSchedulingRequestVote,
  DbSite,
  DbUserCalendarEvent,
  DbUserReminder,
  Env,
  OwnerProfile,
} from "./types";

type StoredMessage = {
  id: string;
  ownerId: string;
  role: string;
  content: string;
  threadId?: string | null;
  created_at?: string;
  metadata_json?: string | null;
};
type StoredAiGatewaySettings = {
  user_id: string;
  account_id: string | null;
  gateway_id: string | null;
  encrypted_api_token: string | null;
  api_token_hint: string | null;
  api_token_updated_at: string | null;
  route_workers_ai: number;
  route_external_providers: number;
  created_at: string;
  updated_at: string;
};
type StoredAssistantThread = {
  id: string;
  owner_id: string;
  title: string;
  origin_surface: "assistant" | "launcher" | "soulink" | "job" | "system";
  project_id: string | null;
  status: "active" | "archived" | "deleted";
  pinned_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};
type StoredAssistantAttachment = {
  id: string;
  owner_id: string;
  thread_id: string | null;
  filename: string;
  mime_type: string;
  size: number;
  kind: "text" | "image";
  status: "ready" | "error" | "deleted";
  storage_key: string | null;
  extracted_text: string | null;
  text_truncated: number;
  metadata_json: string;
};
type StoredMissionProject = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
};

type StoredOwner = OwnerProfile & { password_hash: string | null };
type StoredMailboxMessage = DbMailboxMessage & {
  mailbox_id: string;
  updated_at: string;
};
type StoredTelegramConnection = {
  id: string;
  user_id: string;
  channel: "telegram" | "sandbox" | "soulink";
  status: "pending" | "active" | "disconnected";
  setup_token: string;
  provider_connection_id: string | null;
  provider_user_id: string | null;
  provider_thread_id: string | null;
  provider_username: string | null;
  provider_metadata_json: string | null;
  telegram_user_id: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
};
type StoredAgentChannelEvent = {
  id: string;
  connection_id: string;
  channel: "telegram" | "sandbox" | "soulink";
  direction: "inbound" | "outbound" | "system";
  event_type: "start" | "message" | "link" | "send" | "error";
  status: "received" | "pending" | "sent" | "failed" | "linked" | "skipped";
  provider_event_id: string | null;
  provider_message_id: string | null;
  reply_to_message_id: string | null;
  text_body: string | null;
  raw_json: string | null;
};
type TestForwardableEmailMessage = {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  readonly canBeForwarded: boolean;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  rejectedWith: string | null;
  forwardedTo: string[];
};

type StoredSocialAccount = {
  id: string;
  user_id: string;
  site_id: string;
  platform: "x" | "linkedin" | "instagram" | "instagram_business";
  platform_account_id: string;
  platform_handle: string | null;
  display_name: string | null;
  access_token_ciphertext?: string;
  refresh_token_ciphertext?: string | null;
  token_expires_at?: string | null;
  status: "active" | "expired" | "revoked" | "error";
  scopes_json: string;
  metadata_json?: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};
type StoredSocialProviderSetting = {
  user_id: string;
  provider_id: string;
  client_id: string;
  encrypted_client_secret: string | null;
  secret_hint: string | null;
  secret_updated_at: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};
type StoredSocialOauthState = {
  id: string;
  state: string;
  user_id: string;
  site_id: string;
  platform: "x" | "linkedin" | "instagram" | "instagram_business";
  return_path: string;
  code_verifier: string | null;
  expires_at: string;
  created_at: string;
};
type StoredSocialPublication = {
  id: string;
  variant_id: string;
  site_id: string;
  platform: "x" | "linkedin" | "instagram" | "instagram_business";
  status: "queued" | "publishing" | "published" | "failed" | "cancelled";
  platform_post_id: string | null;
  platform_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_response_json: string | null;
  queued_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
type StoredSocialPublicationEvent = {
  id: string;
  publication_id: string | null;
  variant_id: string;
  event_type: string;
  payload_json: string | null;
  created_at: string;
};
type StoredSocialPost = {
  id: string;
  site_id: string;
  source_type:
    | "journal"
    | "mission_task"
    | "site"
    | "file"
    | "script"
    | "pasted"
    | "legacy_content_bank_read_only";
  source_ref: string | null;
  source_snapshot: string;
  source_text: string;
  idea_text: string;
  goal: string | null;
  status: "draft" | "ready" | "partially_published" | "published" | "failed" | "archived";
  created_by: "user" | "agent";
  created_at: string;
  updated_at: string;
};
type StoredPostVersion = {
  id: string;
  package_id: string;
  platform: "x" | "linkedin" | "instagram" | "instagram_business";
  target_account_id: string | null;
  format: "post" | "carousel";
  body_text: string;
  asset_manifest_json: string;
  source_excerpt: string | null;
  approval_status: "draft" | "approved" | "rejected";
  approved_at: string | null;
  approved_by_user_id: string | null;
  scheduled_for: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
};
type StoredMe3ClaimState = {
  state: string;
  redirect_path: string | null;
  install_id: string | null;
  expires_at: string;
};
type StoredAuthRateLimit = {
  key: string;
  route: string;
  subject_hash: string;
  attempt_count: number;
  window_started_at: string;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
};
type StoredCommerceSettings = {
  user_id: string;
  encrypted_stripe_secret_key: string | null;
  stripe_key_hint: string | null;
  stripe_key_updated_at: string | null;
  preferred_stripe_provider: string | null;
  default_currency: string | null;
  created_at: string;
  updated_at: string;
};
type StoredSiteFile = {
  site_id: string;
  path: string;
  content: Uint8Array;
  content_type: string;
  size: number;
  sha256: string | null;
  updated_at: string;
};
type StoredBookingHold = {
  id: string;
  site_id: string;
  booking_id: string | null;
  offer_id: string | null;
  booking_type: "one_to_one" | "class" | "retreat";
  hold_token: string;
  slot_start: string;
  slot_end: string;
  status: "active" | "confirmed" | "released" | "expired";
  expires_at: string;
  created_at: string;
  updated_at: string;
};
type StoredSchedulingTimeType = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  windows_json: string;
  allowed_tiers_json: string;
  payment_mode: "free" | "paid_checkout" | "owner_review";
  public_booking_offer_id: string | null;
  owner_pre_review: "always" | "unless_close_contact";
  allow_close_contact_candidate_sharing: number;
  final_approval: "both_owners";
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};
type StoredTelegramSettings = {
  user_id: string;
  bot_username: string | null;
  encrypted_bot_token: string | null;
  bot_token_hint: string | null;
  bot_token_updated_at: string | null;
  encrypted_webhook_secret: string | null;
  webhook_secret_hint: string | null;
  webhook_secret_updated_at: string | null;
  created_at: string;
  updated_at: string;
};
type StoredContentItem = {
  id: string;
  site_id: string;
  site_username: string;
  user_id: string;
  body: string;
  media_manifest_json: string;
  platforms_json: string;
  source_type: "original" | "blog_extract" | "imported" | "reworked";
  source_ref: string | null;
  status: "bank" | "queued" | "scheduled" | "publishing" | "posted" | "failed" | "archived";
  queue_position: number | null;
  scheduled_for: string | null;
  timezone: string | null;
  created_by: "human" | "agent_suggested";
  approved_by_human: number;
  evergreen: number;
  times_posted: number;
  last_posted_at: string | null;
  cooldown_days: number;
  tags_json: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function createEnv(): Env & {
  owner: StoredOwner | null;
  assistantThreads: StoredAssistantThread[];
  assistantAttachments: StoredAssistantAttachment[];
  failAssistantAttachmentInsert: boolean;
  missionProjects: StoredMissionProject[];
  messages: StoredMessage[];
  mailbox: DbMailboxAlias | null;
  pluginInstallations: DbPluginInstallation[];
  installSecrets: Map<string, string>;
  aiCredentials: DbAiProviderCredential[];
  aiDefaults: DbAiModelDefault[];
  aiGatewaySettings: StoredAiGatewaySettings | null;
  emailProviderSettings: DbEmailProviderSetting[];
  emailSendAudit: DbEmailSendAudit[];
  failEmailSendAuditInsertOnce: boolean;
  failMailboxDraftSentUpdateOnce: boolean;
  emailSends: Array<Record<string, unknown>>;
  mailboxMessages: StoredMailboxMessage[];
  reminders: DbUserReminder[];
  userCalendarEvents: DbUserCalendarEvent[];
  calendarSources: DbCalendarSource[];
  calendarSourceEvents: DbCalendarSourceEvent[];
  contacts: DbContact[];
  telegramConnection: StoredTelegramConnection | null;
  sandboxConnection: StoredTelegramConnection | null;
  soulinkConnection: StoredTelegramConnection | null;
  agentEvents: StoredAgentChannelEvent[];
  socialAccounts: StoredSocialAccount[];
  socialProviderSettings: StoredSocialProviderSetting[];
  socialOauthStates: StoredSocialOauthState[];
  socialPublications: StoredSocialPublication[];
  socialPublicationEvents: StoredSocialPublicationEvent[];
  socialPosts: StoredSocialPost[];
  postVersions: StoredPostVersion[];
  socialPublishQueueMessages: Array<{ publicationId: string }>;
  me3ClaimStates: StoredMe3ClaimState[];
  authRateLimits: StoredAuthRateLimit[];
  commerceSettings: StoredCommerceSettings | null;
  telegramSettings: StoredTelegramSettings | null;
  contentItems: StoredContentItem[];
  sites: DbSite[];
  siteFiles: StoredSiteFile[];
  bookings: DbBooking[];
  bookingHolds: StoredBookingHold[];
  schedulingTimeTypes: StoredSchedulingTimeType[];
  schedulingRequests: DbSchedulingRequest[];
  schedulingRequestVotes: DbSchedulingRequestVote[];
  schedulingRequestAudit: DbSchedulingRequestAudit[];
  managedRuntimeInstallationId: string | null;
} {
  const state = {
    owner: null as StoredOwner | null,
    assistantThreads: [] as StoredAssistantThread[],
    assistantAttachments: [] as StoredAssistantAttachment[],
    failAssistantAttachmentInsert: false,
    missionProjects: [] as StoredMissionProject[],
    messages: [] as StoredMessage[],
    mailbox: null as DbMailboxAlias | null,
    pluginInstallations: [] as DbPluginInstallation[],
    installSecrets: new Map<string, string>(),
    aiCredentials: [] as DbAiProviderCredential[],
    aiDefaults: [] as DbAiModelDefault[],
    aiGatewaySettings: null as StoredAiGatewaySettings | null,
    emailProviderSettings: [] as DbEmailProviderSetting[],
    emailSendAudit: [] as DbEmailSendAudit[],
    failEmailSendAuditInsertOnce: false,
    failMailboxDraftSentUpdateOnce: false,
    emailSends: [] as Array<Record<string, unknown>>,
    mailboxMessages: [] as StoredMailboxMessage[],
    reminders: [] as DbUserReminder[],
    userCalendarEvents: [] as DbUserCalendarEvent[],
    calendarSources: [] as DbCalendarSource[],
    calendarSourceEvents: [] as DbCalendarSourceEvent[],
    contacts: [] as DbContact[],
    telegramConnection: null as StoredTelegramConnection | null,
    sandboxConnection: null as StoredTelegramConnection | null,
    soulinkConnection: null as StoredTelegramConnection | null,
    agentEvents: [] as StoredAgentChannelEvent[],
    socialAccounts: [] as StoredSocialAccount[],
    socialProviderSettings: [] as StoredSocialProviderSetting[],
    socialOauthStates: [] as StoredSocialOauthState[],
    socialPublications: [] as StoredSocialPublication[],
    socialPublicationEvents: [] as StoredSocialPublicationEvent[],
    socialPosts: [] as StoredSocialPost[],
    postVersions: [] as StoredPostVersion[],
    socialPublishQueueMessages: [] as Array<{ publicationId: string }>,
    me3ClaimStates: [] as StoredMe3ClaimState[],
    authRateLimits: [] as StoredAuthRateLimit[],
    commerceSettings: null as StoredCommerceSettings | null,
    telegramSettings: null as StoredTelegramSettings | null,
    contentItems: [] as StoredContentItem[],
    sites: [] as DbSite[],
    siteFiles: [] as StoredSiteFile[],
    bookings: [] as DbBooking[],
    bookingHolds: [] as StoredBookingHold[],
    schedulingTimeTypes: [] as StoredSchedulingTimeType[],
    schedulingRequests: [] as DbSchedulingRequest[],
    schedulingRequestVotes: [] as DbSchedulingRequestVote[],
    schedulingRequestAudit: [] as DbSchedulingRequestAudit[],
    managedRuntimeInstallationId: null as string | null,
  };

  const toStoredSiteFileContent = (value: unknown): Uint8Array => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value as number[]);
    return new TextEncoder().encode(String(value ?? ""));
  };

  const db = {
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
    async exec() {
      return { count: 1, duration: 0 };
    },
    prepare(sql: string) {
      const runtimeTableNames = new Set([
        "mission_tasks",
        "journal_entries",
        "commerce_settings",
        "commerce_orders",
        "content_bank_items",
        "financial_entries",
        "social_packages",
        "social_accounts",
        "social_oauth_states",
        "social_provider_settings",
        "social_publication_events",
        "social_publications",
        "social_variants",
        "sites",
        "subscribers",
        "email_campaigns",
        "email_campaign_revisions",
        "email_campaign_audience_snapshots",
        "email_campaign_audience_members",
        "email_campaign_assets",
        "email_campaign_revision_assets",
        "email_campaign_recipient_jobs",
        "bookings",
        "managed_runtime_state",
        "managed_runtime_control_requests",
        "managed_runtime_write_leases",
      ]);
      return {
        async run() {
          return { success: true };
        },
        async first<T>() {
          if (sql.includes("FROM managed_runtime_state")) {
            return (state.managedRuntimeInstallationId
              ? {
                  installation_id: state.managedRuntimeInstallationId,
                  state: "active",
                  generation: 1,
                  quiesced_at: null,
                  suspended_at: null,
                  credentials_revoked_at: null,
                  storage_purged_at: null,
                  last_request_id: null,
                }
              : null) as T | null;
          }
          if (sql.includes("FROM sites") && sql.includes("site_role = 'profile'")) {
            return (
              state.sites.find((site) => site.site_role === "profile") || null
            ) as T | null;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes("PRAGMA table_info")) {
            return {
              results: [
                { name: "pinned_at" },
                { name: "default_currency" },
                { name: "project_id" },
              ] as T[],
            };
          }
          if (sql.includes("FROM plugin_installations")) {
            return { results: state.pluginInstallations as T[] };
          }
          if (sql.includes("FROM social_accounts")) {
            return { results: state.socialAccounts as T[] };
          }
          if (sql.includes("FROM social_provider_settings")) {
            return { results: state.socialProviderSettings as T[] };
          }
          return { results: [] as T[] };
        },
        bind(...values: unknown[]) {
          return {
            async run() {
              if (sql.includes("INSERT INTO managed_runtime_state")) {
                state.managedRuntimeInstallationId = String(values[0]);
              }
              if (sql.includes("INSERT INTO managed_runtime_write_leases")) {
                return { success: true, meta: { changes: 1 } };
              }

              if (sql.includes("INSERT INTO owner_profile")) {
                const existingOwner = state.owner;
                if (
                  existingOwner !== null &&
                  existingOwner.id === values[0] &&
                  sql.includes("username = COALESCE(owner_profile.username")
                ) {
                  state.owner = {
                    id: existingOwner.id,
                    email: values[1] as string | null,
                    name: values[2] as string | null,
                    username: existingOwner.username || (values[3] as string | null),
                    bio: existingOwner.bio,
                    avatar_url: existingOwner.avatar_url,
                    timezone: existingOwner.timezone,
                    locale: existingOwner.locale,
                    assistant_name: existingOwner.assistant_name,
                    password_hash: existingOwner.password_hash,
                  };
                } else {
                  state.owner = {
                    id: values[0] as string,
                    email: values[1] as string | null,
                    name: values[2] as string | null,
                    username: values[3] as string | null,
                    bio: values[4] as string | null,
                    avatar_url: values[5] as string | null,
                    timezone: values[6] as string | null,
                    locale: null,
                    assistant_name: null,
                    password_hash: values[7] as string | null,
                  };
                }
              }

              if (sql.includes("UPDATE owner_profile") && state.owner) {
                if (sql.includes("password_hash = ?")) {
                  state.owner.password_hash = values[0] as string;
                  return { success: true };
                }
                let valueIndex = 0;
                if (sql.includes("timezone = ?")) {
                  state.owner.timezone = values[valueIndex] as string | null;
                  valueIndex += 1;
                }
                if (sql.includes("assistant_name = ?")) {
                  state.owner.assistant_name = values[valueIndex] as string | null;
                  valueIndex += 1;
                }
                if (sql.includes("locale = ?")) {
                  state.owner.locale = values[valueIndex] as string | null;
                }
              }

              if (sql.includes("DELETE FROM owner_profile")) {
                state.owner = null;
              }

              if (sql.includes("DELETE FROM install_secrets")) {
                state.installSecrets.delete(values[0] as string);
              }

              if (sql.includes("INSERT INTO assistant_threads")) {
                const existing = state.assistantThreads.some((thread) => thread.id === values[0]);
                if (sql.includes("ON CONFLICT(id)") && existing) {
                  return { success: true, meta: { changes: 0 } };
                }
                state.assistantThreads.push({
                  id: values[0] as string,
                  owner_id: values[1] as string,
                  title: values[2] as string,
                  origin_surface: sql.includes("'soulink'") ? "soulink" : "assistant",
                  project_id: sql.includes("project_id") ? (values[3] as string | null) : null,
                  status: "active",
                  pinned_at: null,
                  archived_at: null,
                  deleted_at: null,
                  last_message_at: "2026-05-11T10:06:00Z",
                  created_at: "2026-05-11T10:06:00Z",
                  updated_at: "2026-05-11T10:06:00Z",
                });
                return { success: true, meta: { changes: 1 } };
              }

              if (sql.includes("UPDATE assistant_threads")) {
                if (sql.includes("SET title = ?")) {
                  state.assistantThreads = state.assistantThreads.map((thread) =>
                    thread.id === values[5] && thread.owner_id === values[6]
                      ? {
                          ...thread,
                          title: values[0] as string,
                          project_id: values[1] as string | null,
                          status: values[2] as StoredAssistantThread["status"],
                          pinned_at: values[3] ? thread.pinned_at || "2026-05-11T10:08:00Z" : null,
                          archived_at:
                            values[4] === "archived"
                              ? thread.archived_at || "2026-05-11T10:08:00Z"
                              : null,
                          updated_at: "2026-05-11T10:08:00Z",
                        }
                      : thread,
                  );
                } else if (
                  sql.includes("status = 'deleted'") &&
                  sql.includes("status = 'archived'")
                ) {
                  state.assistantThreads = state.assistantThreads.map((thread) =>
                    thread.owner_id === values[0] && thread.status === "archived"
                      ? {
                          ...thread,
                          status: "deleted",
                          deleted_at: thread.deleted_at || "2026-05-11T10:09:00Z",
                          archived_at: null,
                          updated_at: "2026-05-11T10:09:00Z",
                        }
                      : thread,
                  );
                } else if (sql.includes("status = 'deleted'")) {
                  state.assistantThreads = state.assistantThreads.map((thread) =>
                    thread.id === values[0] && thread.owner_id === values[1]
                      ? {
                          ...thread,
                          status: "deleted",
                          deleted_at: thread.deleted_at || "2026-05-11T10:09:00Z",
                          archived_at: null,
                          updated_at: "2026-05-11T10:09:00Z",
                        }
                      : thread,
                  );
                } else {
                  state.assistantThreads = state.assistantThreads.map((thread) =>
                    thread.id === values[0] && thread.owner_id === values[1]
                      ? {
                          ...thread,
                          last_message_at: "2026-05-11T10:07:00Z",
                          updated_at: "2026-05-11T10:07:00Z",
                        }
                      : thread,
                  );
                }
              }

              if (sql.includes("UPDATE assistant_messages")) {
                const ownerId = values[0] as string;
                const archivedThreadIds = sql.includes("thread_id IN")
                  ? new Set(
                      state.assistantThreads
                        .filter(
                          (thread) =>
                            thread.owner_id === ownerId && thread.status === "archived",
                        )
                        .map((thread) => thread.id),
                    )
                  : null;
                state.messages = state.messages.map((message) => {
                  const matches =
                    message.ownerId === ownerId &&
                    (archivedThreadIds
                      ? archivedThreadIds.has(message.threadId || "")
                      : message.threadId === values[1]);
                  return matches ? { ...message, content: "", metadata_json: "{}" } : message;
                });
              }

              if (sql.includes("INSERT INTO assistant_messages")) {
                const hasThreadId = sql.includes("thread_id");
                const hasMetadata = sql.includes("metadata_json");
                const metadataIndex = hasThreadId ? 5 : 4;
                state.messages.push({
                  id: values[0] as string,
                  ownerId: values[1] as string,
                  role: values[2] as string,
                  content: values[3] as string,
                  threadId: hasThreadId ? (values[4] as string | null) : null,
                  metadata_json: hasMetadata ? (values[metadataIndex] as string) : "{}",
                  created_at: "2026-05-11T10:07:00Z",
                });
              }

              if (sql.includes("INSERT INTO site_files")) {
                const content = toStoredSiteFileContent(values[2]);
                const file: StoredSiteFile = {
                  site_id: values[0] as string,
                  path: values[1] as string,
                  content,
                  content_type: values[3] as string,
                  size: Number(values[4]) || content.byteLength,
                  sha256: values[5] as string | null,
                  updated_at: "2026-06-05T10:00:00Z",
                };
                const existingIndex = state.siteFiles.findIndex(
                  (entry) => entry.site_id === file.site_id && entry.path === file.path,
                );
                if (existingIndex >= 0) {
                  state.siteFiles[existingIndex] = file;
                } else {
                  state.siteFiles.push(file);
                }
              }

              if (sql.includes("DELETE FROM site_files")) {
                state.siteFiles = state.siteFiles.filter(
                  (file) => !(file.site_id === values[0] && file.path === values[1]),
                );
              }

              if (sql.includes("UPDATE sites SET published_at = datetime('now')")) {
                state.sites = state.sites.map((site) =>
                  site.id === values[0]
                    ? {
                        ...site,
                        published_at: "2026-06-05T10:00:00Z",
                        updated_at: "2026-06-05T10:00:00Z",
                      }
                    : site,
                );
              }

              if (sql.includes("UPDATE sites SET published_at = NULL")) {
                state.sites = state.sites.map((site) =>
                  site.id === values[0]
                    ? { ...site, published_at: null, updated_at: "2026-06-05T10:00:00Z" }
                    : site,
                );
              }

              if (
                sql.includes("UPDATE sites") &&
                sql.includes("SET custom_domain = ?")
              ) {
                state.sites = state.sites.map((site) =>
                  site.id === values[2]
                    ? {
                        ...site,
                        custom_domain: String(values[0]),
                        custom_domain_status: values[1] as DbSite["custom_domain_status"],
                        custom_domain_cf_id: null,
                        updated_at: "2026-06-05T10:00:00Z",
                      }
                    : site,
                );
              }

              if (
                sql.includes("UPDATE sites") &&
                sql.includes("SET custom_domain = NULL")
              ) {
                state.sites = state.sites.map((site) =>
                  site.id === values[0]
                    ? {
                        ...site,
                        custom_domain: null,
                        custom_domain_status: null,
                        custom_domain_cf_id: null,
                        updated_at: "2026-06-05T10:00:00Z",
                      }
                    : site,
                );
              }

              if (sql.includes("INSERT INTO assistant_attachments")) {
                if (state.failAssistantAttachmentInsert) {
                  throw new Error("D1_ERROR: no such table: assistant_attachments");
                }
                state.assistantAttachments.push({
                  id: values[0] as string,
                  owner_id: values[1] as string,
                  thread_id: values[2] as string | null,
                  filename: values[3] as string,
                  mime_type: values[4] as string,
                  size: values[5] as number,
                  kind: values[6] as "text" | "image",
                  status: "ready",
                  storage_key: values[7] as string | null,
                  extracted_text: values[8] as string | null,
                  text_truncated: values[9] as number,
                  metadata_json: values[10] as string,
                });
              }

              if (sql.includes("INSERT INTO plugin_installations")) {
                const existingIndex = state.pluginInstallations.findIndex(
                  (installation) => installation.plugin_id === values[0],
                );
                const existing =
                  existingIndex >= 0 ? state.pluginInstallations[existingIndex] : null;
                const installation: DbPluginInstallation = {
                  plugin_id: values[0] as string,
                  version: values[1] as string,
                  enabled: values[2] as number,
                  status: values[3] as DbPluginInstallation["status"],
                  granted_permissions_json:
                    sql.includes("granted_permissions_json = excluded.granted_permissions_json") ||
                    !existing
                      ? (values[4] as string)
                      : existing.granted_permissions_json,
                  setup_state_json: values[5] as string,
                  installed_at: existing?.installed_at || (values[6] as string),
                  updated_at: values[7] as string,
                };
                if (existingIndex >= 0) {
                  state.pluginInstallations[existingIndex] = installation;
                } else {
                  state.pluginInstallations.push(installation);
                }
              }

              if (sql.includes("INSERT INTO social_provider_settings")) {
                const existingIndex = state.socialProviderSettings.findIndex(
                  (setting) =>
                    setting.user_id === values[0] && setting.provider_id === values[1],
                );
                const existing =
                  existingIndex >= 0 ? state.socialProviderSettings[existingIndex] : null;
                const setting: StoredSocialProviderSetting = {
                  user_id: values[0] as string,
                  provider_id: values[1] as string,
                  client_id: values[2] as string,
                  encrypted_client_secret: values[3] as string | null,
                  secret_hint: values[4] as string | null,
                  secret_updated_at: values[5] as string | null,
                  enabled: values[6] as number,
                  created_at: existing?.created_at || (values[7] as string),
                  updated_at: values[8] as string,
                };
                if (existingIndex >= 0) {
                  state.socialProviderSettings[existingIndex] = setting;
                } else {
                  state.socialProviderSettings.push(setting);
                }
              }

              if (sql.includes("INSERT INTO social_oauth_states")) {
                state.socialOauthStates.push({
                  id: values[0] as string,
                  state: values[1] as string,
                  user_id: values[2] as string,
                  site_id: values[3] as string,
                  platform: values[4] as StoredSocialOauthState["platform"],
                  return_path: values[5] as string,
                  code_verifier: values[6] as string | null,
                  expires_at: values[7] as string,
                  created_at: "2026-05-11T10:00:00Z",
                });
              }

              if (sql.includes("DELETE FROM social_oauth_states")) {
                state.socialOauthStates = state.socialOauthStates.filter(
                  (oauthState) => oauthState.id !== values[0],
                );
              }

              if (sql.includes("INSERT INTO me3_install_claim_states")) {
                const existingIndex = state.me3ClaimStates.findIndex(
                  (entry) => entry.state === values[0],
                );
                const entry: StoredMe3ClaimState = {
                  state: values[0] as string,
                  redirect_path: values[1] as string | null,
                  install_id: values[2] as string | null,
                  expires_at: values[3] as string,
                };
                if (existingIndex >= 0) {
                  state.me3ClaimStates[existingIndex] = entry;
                } else {
                  state.me3ClaimStates.push(entry);
                }
              }

              if (sql.includes("DELETE FROM me3_install_claim_states")) {
                state.me3ClaimStates = state.me3ClaimStates.filter(
                  (entry) => entry.state !== values[0],
                );
              }

              if (sql.includes("INSERT INTO auth_rate_limits")) {
                const existingIndex = state.authRateLimits.findIndex(
                  (entry) => entry.key === values[0],
                );
                const existing =
                  existingIndex >= 0 ? state.authRateLimits[existingIndex] : null;
                const entry: StoredAuthRateLimit = {
                  key: values[0] as string,
                  route: values[1] as string,
                  subject_hash: values[2] as string,
                  attempt_count: values[3] as number,
                  window_started_at: values[4] as string,
                  locked_until: values[5] as string | null,
                  created_at: existing?.created_at || (values[6] as string),
                  updated_at: values[7] as string,
                };
                if (existingIndex >= 0) {
                  state.authRateLimits[existingIndex] = entry;
                } else {
                  state.authRateLimits.push(entry);
                }
              }

              if (sql.includes("DELETE FROM auth_rate_limits")) {
                state.authRateLimits = state.authRateLimits.filter(
                  (entry) => entry.key !== values[0],
                );
              }

              if (sql.includes("INSERT INTO social_accounts")) {
                const existingIndex = state.socialAccounts.findIndex(
                  (account) =>
                    account.site_id === values[2] &&
                    account.platform === values[3] &&
                    account.platform_account_id === values[4],
                );
                const existing =
                  existingIndex >= 0 ? state.socialAccounts[existingIndex] : null;
                const account: StoredSocialAccount = {
                  id: existing?.id || (values[0] as string),
                  user_id: values[1] as string,
                  site_id: values[2] as string,
                  platform: values[3] as StoredSocialAccount["platform"],
                  platform_account_id: values[4] as string,
                  platform_handle: values[5] as string | null,
                  display_name: values[6] as string | null,
                  access_token_ciphertext: values[7] as string,
                  refresh_token_ciphertext: values[8] as string | null,
                  token_expires_at: values[9] as string | null,
                  scopes_json: values[10] as string,
                  status: "active",
                  metadata_json: values[11] as string | null,
                  last_verified_at: values[12] as string | null,
                  created_at: existing?.created_at || (values[13] as string),
                  updated_at: values[14] as string,
                };
                if (existingIndex >= 0) {
                  state.socialAccounts[existingIndex] = account;
                } else {
                  state.socialAccounts.push(account);
                }
              }

              if (sql.includes("UPDATE social_accounts") && sql.includes("access_token_ciphertext = ?")) {
                const account = state.socialAccounts.find((entry) => entry.id === values[5]);
                if (account) {
                  account.access_token_ciphertext = values[0] as string;
                  account.refresh_token_ciphertext = values[1] as string | null;
                  account.token_expires_at = values[2] as string | null;
                  account.status = "active";
                  account.last_verified_at = values[3] as string;
                  account.updated_at = values[4] as string;
                }
              }

              if (sql.includes("INSERT INTO social_packages")) {
                state.socialPosts.push({
                  id: values[0] as string,
                  site_id: values[1] as string,
                  source_type: values[7] as StoredSocialPost["source_type"],
                  source_ref: values[8] as string | null,
                  source_snapshot: values[9] as string,
                  source_text: values[10] as string,
                  idea_text: values[11] as string,
                  goal: values[5] as string | null,
                  status: "ready",
                  created_by: values[6] as StoredSocialPost["created_by"],
                  created_at: values[12] as string,
                  updated_at: values[13] as string,
                });
              }

              if (sql.includes("INSERT INTO social_variants")) {
                state.postVersions.push({
                  id: values[0] as string,
                  package_id: values[1] as string,
                  platform: values[2] as StoredPostVersion["platform"],
                  target_account_id: values[3] as string | null,
                  format: values[4] as StoredPostVersion["format"],
                  body_text: values[5] as string,
                  asset_manifest_json: values[6] as string,
                  source_excerpt: values[7] as string | null,
                  approval_status: "draft",
                  approved_at: null,
                  approved_by_user_id: null,
                  scheduled_for: null,
                  timezone: null,
                  created_at: values[8] as string,
                  updated_at: values[9] as string,
                });
              }

              if (sql.includes("INSERT INTO content_bank_items")) {
                state.contentItems.push({
                  id: values[0] as string,
                  site_id: values[1] as string,
                  site_username: "owner",
                  user_id: values[2] as string,
                  body: values[3] as string,
                  media_manifest_json: values[4] as string,
                  platforms_json: values[5] as string,
                  source_type: "original",
                  source_ref: null,
                  status: "bank",
                  queue_position: null,
                  scheduled_for: null,
                  timezone: values[6] as string | null,
                  notes: values[7] as string | null,
                  evergreen: values[8] as number,
                  tags_json: values[9] as string,
                  approved_by_human: 1,
                  created_by: "human",
                  times_posted: 0,
                  last_posted_at: null,
                  cooldown_days: 30,
                  created_at: "2026-05-12T09:00:00Z",
                  updated_at: "2026-05-12T09:00:00Z",
                });
              }

              if (sql.includes("INSERT INTO social_publications")) {
                state.socialPublications.push({
                  id: values[0] as string,
                  variant_id: values[1] as string,
                  site_id: values[2] as string,
                  platform: values[3] as StoredSocialPublication["platform"],
                  status: "queued",
                  platform_post_id: null,
                  platform_post_url: null,
                  error_code: null,
                  error_message: null,
                  provider_response_json: null,
                  queued_at: values[4] as string,
                  published_at: null,
                  created_at: "2026-05-12T09:00:00Z",
                  updated_at: "2026-05-12T09:00:00Z",
                });
              }

              if (sql.includes("INSERT INTO social_publication_events")) {
                state.socialPublicationEvents.push({
                  id: values[0] as string,
                  publication_id: values[1] as string | null,
                  variant_id: values[2] as string,
                  event_type: values[3] as string,
                  payload_json: values[4] as string | null,
                  created_at: "2026-05-12T09:00:00Z",
                });
              }

              if (sql.includes("UPDATE social_publications")) {
                const publicationId = values[values.length - 1] as string;
                const publication = state.socialPublications.find(
                  (entry) => entry.id === publicationId,
                );
                if (publication) {
                  if (sql.includes("status = 'publishing'")) {
                    publication.status = "publishing";
                  }
                  if (sql.includes("status = 'published'")) {
                    publication.status = "published";
                    publication.platform_post_id = values[0] as string | null;
                    publication.platform_post_url = values[1] as string | null;
                    publication.provider_response_json = values[2] as string | null;
                    publication.published_at = "2026-05-12T09:10:00Z";
                    publication.error_code = null;
                    publication.error_message = null;
                  }
                  if (sql.includes("status = 'failed'")) {
                    publication.status = "failed";
                    publication.error_code = values[0] as string | null;
                    publication.error_message = values[1] as string | null;
                    publication.provider_response_json = values[2] as string | null;
                  }
                  if (sql.includes("SET status = ?")) {
                    publication.status = values[0] as StoredSocialPublication["status"];
                    publication.error_code = values[1] as string | null;
                    publication.error_message = values[2] as string | null;
                    publication.provider_response_json = values[3] as string | null;
                  }
                  publication.updated_at = "2026-05-12T09:10:00Z";
                }
              }

              if (sql.includes("UPDATE content_bank_items")) {
                const resequence = sql.includes("WHERE id = ? AND user_id = ? AND site_id = ?");
                const idOnly = sql.includes("WHERE id = ?") && !sql.includes("user_id = ?");
                const id = (resequence
                  ? values[1]
                  : idOnly
                    ? values[values.length - 1]
                    : values[values.length - 2]) as string;
                const userId = (resequence
                  ? values[2]
                  : idOnly
                    ? undefined
                    : values[values.length - 1]) as string | undefined;
                const item = state.contentItems.find(
                  (entry) => entry.id === id && (!userId || entry.user_id === userId),
                );
                if (item) {
                  if (resequence) {
                    item.queue_position = values[0] as number;
                    item.updated_at = "2026-05-12T09:05:00Z";
                    return { success: true };
                  }
                  if (sql.includes("status = ?")) {
                    item.status = values[0] as StoredContentItem["status"];
                    item.queue_position = values[1] as number | null;
                    item.scheduled_for = null;
                  }
                  if (sql.includes("status = 'posted'")) {
                    item.status = "posted";
                    item.queue_position = null;
                    item.scheduled_for = null;
                    item.times_posted += 1;
                    item.last_posted_at = (values[0] as string | null) || "2026-05-12T09:10:00Z";
                  }
                  if (sql.includes("status = 'failed'")) {
                    item.status = "failed";
                    item.queue_position = null;
                    item.scheduled_for = null;
                  }
                  if (sql.includes("body = ?")) item.body = values[0] as string;
                  item.approved_by_human = 1;
                  item.updated_at = "2026-05-12T09:05:00Z";
                }
              }

              if (sql.includes("DELETE FROM content_bank_items")) {
                state.contentItems = state.contentItems.filter(
                  (entry) => !(entry.id === values[0] && entry.user_id === values[1]),
                );
              }

              if (sql.includes("INSERT INTO install_secrets")) {
                state.installSecrets.set(values[0] as string, values[1] as string);
              }

              if (sql.includes("INSERT INTO commerce_settings")) {
                const existing = state.commerceSettings;
                state.commerceSettings = {
                  user_id: values[0] as string,
                  encrypted_stripe_secret_key: values[1] as string | null,
                  stripe_key_hint: values[2] as string | null,
                  stripe_key_updated_at: values[3] as string | null,
                  preferred_stripe_provider: values[4] as string | null,
                  default_currency: values[5] as string | null,
                  created_at: existing?.created_at || "2026-05-29T10:00:00Z",
                  updated_at: "2026-05-29T10:05:00Z",
                };
              }

              if (sql.includes("INSERT INTO telegram_settings")) {
                const existing = state.telegramSettings;
                state.telegramSettings = {
                  user_id: values[0] as string,
                  bot_username: values[1] as string | null,
                  encrypted_bot_token: values[2] as string | null,
                  bot_token_hint: values[3] as string | null,
                  bot_token_updated_at: values[4] as string | null,
                  encrypted_webhook_secret: values[5] as string | null,
                  webhook_secret_hint: values[6] as string | null,
                  webhook_secret_updated_at: values[7] as string | null,
                  created_at: existing?.created_at || "2026-05-31T10:00:00Z",
                  updated_at: "2026-05-31T10:05:00Z",
                };
              }

              if (sql.includes("INSERT INTO ai_provider_credentials")) {
                const existingIndex = state.aiCredentials.findIndex(
                  (credential) =>
                    credential.user_id === values[0] &&
                    credential.provider_id === values[1],
                );
                const credential: DbAiProviderCredential = {
                  user_id: values[0] as string,
                  provider_id: values[1] as string,
                  encrypted_api_key: values[2] as string,
                  api_key_hint: values[3] as string,
                  api_key_updated_at: values[4] as string,
                  created_at: values[5] as string,
                  updated_at: values[6] as string,
                };
                if (existingIndex >= 0) {
                  state.aiCredentials[existingIndex] = {
                    ...state.aiCredentials[existingIndex],
                    ...credential,
                    created_at: state.aiCredentials[existingIndex].created_at,
                  };
                } else {
                  state.aiCredentials.push(credential);
                }
              }

              if (sql.includes("DELETE FROM ai_provider_credentials")) {
                state.aiCredentials = state.aiCredentials.filter(
                  (credential) =>
                    credential.user_id !== values[0] ||
                    credential.provider_id !== values[1],
                );
              }

              if (sql.includes("INSERT INTO ai_model_defaults")) {
                const existingIndex = state.aiDefaults.findIndex(
                  (defaultRow) =>
                    defaultRow.user_id === values[0] &&
                    defaultRow.use_case === values[1],
                );
                const defaultRow: DbAiModelDefault = {
                  user_id: values[0] as string,
                  use_case: values[1] as string,
                  provider_id: values[2] as string,
                  model: values[3] as string,
                  created_at: values[4] as string,
                  updated_at: values[5] as string,
                };
                if (existingIndex >= 0) {
                  state.aiDefaults[existingIndex] = {
                    ...state.aiDefaults[existingIndex],
                    ...defaultRow,
                    created_at: state.aiDefaults[existingIndex].created_at,
                  };
                } else {
                  state.aiDefaults.push(defaultRow);
                }
              }

              if (sql.includes("INSERT INTO ai_gateway_settings")) {
                state.aiGatewaySettings = {
                  user_id: values[0] as string,
                  account_id: values[1] as string | null,
                  gateway_id: values[2] as string | null,
                  encrypted_api_token: values[3] as string | null,
                  api_token_hint: values[4] as string | null,
                  api_token_updated_at: values[5] as string | null,
                  route_workers_ai: values[6] as number,
                  route_external_providers: values[7] as number,
                  created_at:
                    state.aiGatewaySettings?.created_at || (values[8] as string),
                  updated_at: values[9] as string,
                };
              }

              if (sql.includes("DELETE FROM ai_model_defaults")) {
                state.aiDefaults = state.aiDefaults.filter(
                  (defaultRow) =>
                    defaultRow.user_id !== values[0] ||
                    defaultRow.use_case !== values[1],
                );
              }

              if (sql.includes("INSERT INTO email_provider_settings")) {
                const existingIndex = state.emailProviderSettings.findIndex(
                  (setting) =>
                    setting.user_id === values[0] &&
                    setting.provider_id === values[1],
                );
                const existing =
                  existingIndex >= 0 ? state.emailProviderSettings[existingIndex] : null;
                const setting: DbEmailProviderSetting = {
                  user_id: values[0] as string,
                  provider_id: values[1] as string,
                  is_active: values[2] as number,
                  encrypted_secret: values[3] as string | null,
                  secret_hint: values[4] as string | null,
                  secret_updated_at: values[5] as string | null,
                  config_json: values[6] as string | null,
                  last_status: existing?.last_status || null,
                  last_status_checked_at: existing?.last_status_checked_at || null,
                  last_test_sent_at: existing?.last_test_sent_at || null,
                  last_test_error: existing?.last_test_error || null,
                  created_at: existing?.created_at || (values[7] as string),
                  updated_at: values[8] as string,
                };
                if (existingIndex >= 0) {
                  state.emailProviderSettings[existingIndex] = setting;
                } else {
                  state.emailProviderSettings.push(setting);
                }
              }

              if (
                sql.includes("UPDATE email_provider_settings") &&
                sql.includes("SET is_active = 0")
              ) {
                state.emailProviderSettings = state.emailProviderSettings.map((setting) =>
                  setting.user_id === values[0] ? { ...setting, is_active: 0 } : setting,
                );
              }

              if (
                sql.includes("UPDATE email_provider_settings") &&
                sql.includes("SET is_active = 1")
              ) {
                state.emailProviderSettings = state.emailProviderSettings.map((setting) =>
                  setting.user_id === values[1] && setting.provider_id === values[2]
                    ? { ...setting, is_active: 1, updated_at: values[0] as string }
                    : setting,
                );
              }

              if (
                sql.includes("UPDATE email_provider_settings") &&
                sql.includes("last_status = ?")
              ) {
                state.emailProviderSettings = state.emailProviderSettings.map((setting) =>
                  setting.user_id === values[5] && setting.provider_id === values[6]
                    ? {
                        ...setting,
                        last_status: values[0] as DbEmailProviderSetting["last_status"],
                        last_status_checked_at: values[1] as string,
                        last_test_sent_at:
                          (values[2] as string | null) || setting.last_test_sent_at,
                        last_test_error: values[3] as string | null,
                        updated_at: values[4] as string,
                      }
                    : setting,
                );
              }

              if (sql.includes("INSERT INTO email_send_audit")) {
                if (state.failEmailSendAuditInsertOnce) {
                  state.failEmailSendAuditInsertOnce = false;
                  throw new Error("Simulated email send audit insert failure");
                }
                state.emailSendAudit.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  mailbox_id: values[2] as string | null,
                  mailbox_message_id: values[3] as string | null,
                  provider_id: values[4] as string,
                  provider_message_id: values[5] as string | null,
                  provider_status: values[6] as string | null,
                  status: values[7] as DbEmailSendAudit["status"],
                  purpose: values[8] as DbEmailSendAudit["purpose"],
                  from_address: values[9] as string,
                  to_address: values[10] as string,
                  subject: values[11] as string,
                  thread_key: values[12] as string | null,
                  message_id_header: values[13] as string | null,
                  in_reply_to: values[14] as string | null,
                  references_header: values[15] as string | null,
                  metadata_json: values[16] as string,
                  error_message: values[17] as string | null,
                  created_by: values[18] as string,
                  approved_by_user_id: values[19] as string | null,
                  requested_at: values[20] as string,
                  sent_at: values[21] as string | null,
                  created_at: values[22] as string,
                  updated_at: values[23] as string,
                });
              }

              if (
                sql.includes("INTO mailbox_messages") &&
                sql.includes("'inbound'")
              ) {
                state.mailboxMessages.push({
                  id: values[0] as string,
                  mailbox_id: values[1] as string,
                  direction: "inbound",
                  message_kind: "email",
                  status: values[2] as DbMailboxMessage["status"],
                  thread_key: values[3] as string,
                  provider_id: values[4] as string,
                  provider_message_id: values[5] as string | null,
                  from_address: values[6] as string,
                  to_address: values[7] as string,
                  subject: values[8] as string,
                  text_body: values[9] as string,
                  html_body: values[10] as string | null,
                  raw_headers_json: values[11] as string,
                  raw_message: values[12] as string,
                  metadata_json: values[13] as string,
                  source_id: null,
                  folder: "inbox",
                  read_at: null,
                  agent_summary: null,
                  agent_labels_json: null,
                  forwarded_to: null,
                  error_message: null,
                  created_by: "cloudflare-email-routing",
                  approved_by_user_id: null,
                  received_at: values[14] as string,
                  approved_at: null,
                  sent_at: null,
                  created_at: values[15] as string,
                  updated_at: values[16] as string,
                });
              }

              if (
                sql.includes("INTO mailbox_messages") &&
                sql.includes("'outbound'")
              ) {
                const duplicate = state.mailboxMessages.some(
                  (message) =>
                    values[9] &&
                    message.mailbox_id === values[1] &&
                    message.agent_idempotency_key === values[9],
                );
                if (!duplicate) state.mailboxMessages.push({
                  id: values[0] as string,
                  mailbox_id: values[1] as string,
                  direction: "outbound",
                  message_kind: "draft",
                  status: "pending_approval",
                  thread_key: values[2] as string,
                  provider_id: null,
                  provider_message_id: null,
                  from_address: values[3] as string,
                  to_address: values[4] as string,
                  subject: values[5] as string,
                  text_body: values[6] as string,
                  html_body: values[7] as string | null,
                  raw_headers_json: null,
                  raw_message: null,
                  metadata_json: values[8] as string,
                  agent_idempotency_key: values[9] as string | null,
                  source_id: values[10] as string | null,
                  folder: "drafts",
                  read_at: null,
                  agent_summary: null,
                  agent_labels_json: null,
                  forwarded_to: null,
                  error_message: null,
                  created_by: values[11] as string,
                  approved_by_user_id: null,
                  received_at: null,
                  approved_at: null,
                  sent_at: null,
                  created_at: values[12] as string,
                  updated_at: values[13] as string,
                });
              }

              if (sql.includes("INSERT INTO mailbox_aliases")) {
                state.mailbox = {
                  id: values[0] as string,
                  user_id: values[1] as string,
                  alias_local_part: values[2] as string,
                  forwarding_email: values[3] as string,
                  forwarding_status: values[4] as DbMailboxAlias["forwarding_status"],
                  forwarding_enabled: values[5] as number,
                  forwarding_mode: values[6] as DbMailboxAlias["forwarding_mode"],
                  status: "pending_setup",
                  approval_policy: "all",
                  daily_inbound_limit: values[7] as number,
                  daily_outbound_limit: values[8] as number,
                  activated_at: null,
                  cf_destination_id: null,
                  cf_destination_verified_at: null,
                  cf_rule_id: null,
                  cf_last_synced_at: null,
                  cf_last_error: null,
                  created_at: values[9] as string,
                  updated_at: values[10] as string,
                };
              }

              if (sql.includes("INTO user_reminders")) {
                const duplicate = state.reminders.some(
                  (reminder) =>
                    values[7] &&
                    reminder.user_id === values[1] &&
                    reminder.source_dispatch_id === values[7],
                );
                if (!duplicate) state.reminders.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  title: values[2] as string,
                  notes: values[3] as string | null,
                  remind_at: values[4] as string,
                  timezone: values[5] as string | null,
                  recurrence_rule: values[6] as string | null,
                  source_dispatch_id: values[7] as string | null,
                  context_type: null,
                  context_id: null,
                  context_label: null,
                  status: "pending",
                  delivered_at: null,
                  dismissed_at: null,
                  created_at: "2026-05-13T20:00:00Z",
                });
              }

              if (sql.includes("INSERT INTO contacts")) {
                state.contacts.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  name: values[2] as string,
                  email: values[3] as string | null,
                  phone: values[4] as string | null,
                  source: values[5] as DbContact["source"],
                  source_ref: values[6] as string | null,
                  relationship: values[7] as DbContact["relationship"],
                  status: values[8] as DbContact["status"],
                  notes: values[9] as string | null,
                  tags: values[10] as string | null,
                  last_interaction_at: values[11] as string | null,
                  next_followup_at: values[12] as string | null,
                  outreach_status: values[13] as DbContact["outreach_status"],
                  social_handles: values[14] as string | null,
                  metadata: values[15] as string | null,
                  created_at: "2026-05-13T20:10:00Z",
                  updated_at: "2026-05-13T20:10:00Z",
                  booking_count: 0,
                  last_booking_at: null,
                });
              }

              if (sql.includes("INSERT INTO bookings")) {
                const isUnpaidConfirmedBooking = sql.includes("'not_required'");
                const isFreeBooking = isUnpaidConfirmedBooking && values[11] === 1;
                state.bookings.push({
                  id: values[0] as string,
                  site_id: values[1] as string,
                  offer_id: values[2] as string | null,
                  booking_type: "one_to_one",
                  guest_name: values[3] as string,
                  guest_email: values[4] as string,
                  starts_at: values[5] as string,
                  ends_at: values[6] as string,
                  duration_minutes: values[7] as number,
                  calendar_event_id: null,
                  status: "confirmed",
                  notes: values[8] as string | null,
                  created_at: "2026-05-31T22:30:00Z",
                  cancelled_at: null,
                  payment_intent_id: isUnpaidConfirmedBooking
                    ? null
                    : (values[9] as string | null),
                  amount_paid: isUnpaidConfirmedBooking
                    ? null
                    : (values[10] as number | null),
                  suggested_amount: isUnpaidConfirmedBooking
                    ? (values[9] as number | null)
                    : (values[11] as number | null),
                  currency: isUnpaidConfirmedBooking
                    ? (values[10] as DbBooking["currency"])
                    : (values[12] as DbBooking["currency"]),
                  payment_status: isUnpaidConfirmedBooking
                    ? "not_required"
                    : "succeeded",
                  is_free_booking: isFreeBooking ? 1 : 0,
                  paid_at: isUnpaidConfirmedBooking
                    ? null
                    : "2026-05-31T22:30:00Z",
                });
              }

              if (sql.includes("INSERT INTO booking_holds")) {
                state.bookingHolds.push({
                  id: values[0] as string,
                  site_id: values[1] as string,
                  booking_id: null,
                  offer_id: values[2] as string | null,
                  booking_type: "one_to_one",
                  hold_token: values[3] as string,
                  slot_start: values[4] as string,
                  slot_end: values[5] as string,
                  status: "active",
                  expires_at: values[6] as string,
                  created_at: "2026-05-31T22:30:00Z",
                  updated_at: "2026-05-31T22:30:00Z",
                });
              }

              if (
                sql.includes("UPDATE booking_holds") &&
                sql.includes("SET status = 'confirmed'")
              ) {
                state.bookingHolds = state.bookingHolds.map((hold) =>
                  hold.hold_token === values[1] && hold.status === "active"
                    ? {
                        ...hold,
                        status: "confirmed",
                        booking_id: values[0] as string,
                        updated_at: "2026-06-05T12:00:00Z",
                      }
                    : hold,
                );
              }

              if (
                sql.includes("UPDATE booking_holds") &&
                sql.includes("SET status = 'released'")
              ) {
                state.bookingHolds = state.bookingHolds.map((hold) =>
                  hold.hold_token === values[0] && hold.status === "active"
                    ? {
                        ...hold,
                        status: "released",
                        updated_at: "2026-06-05T12:00:00Z",
                      }
                    : hold,
                );
              }

              if (sql.includes("INSERT INTO scheduling_time_types")) {
                state.schedulingTimeTypes.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  title: values[2] as string,
                  description: values[3] as string | null,
                  duration_minutes: values[4] as number,
                  buffer_minutes: values[5] as number,
                  timezone: values[6] as string,
                  windows_json: values[7] as string,
                  allowed_tiers_json: values[8] as string,
                  payment_mode: sql.includes("'free', NULL")
                    ? "free"
                    : (values[9] as StoredSchedulingTimeType["payment_mode"]),
                  public_booking_offer_id: null,
                  owner_pre_review: sql.includes("'unless_close_contact'")
                    ? "unless_close_contact"
                    : (values[10] as StoredSchedulingTimeType["owner_pre_review"]),
                  allow_close_contact_candidate_sharing: sql.includes("'free', NULL")
                    ? 1
                    : (values[11] as number),
                  final_approval: "both_owners",
                  status: "active",
                  created_at: "2026-06-05T12:00:00Z",
                  updated_at: "2026-06-05T12:00:00Z",
                });
              }

              if (sql.includes("UPDATE scheduling_time_types")) {
                state.schedulingTimeTypes = state.schedulingTimeTypes.map((timeType) =>
                  timeType.user_id === values[11] && timeType.id === values[12]
                    ? {
                        ...timeType,
                        title: values[0] as string,
                        description: values[1] as string | null,
                        duration_minutes: values[2] as number,
                        buffer_minutes: values[3] as number,
                        timezone: values[4] as string,
                        windows_json: values[5] as string,
                        allowed_tiers_json: values[6] as string,
                        payment_mode: values[7] as StoredSchedulingTimeType["payment_mode"],
                        owner_pre_review:
                          values[8] as StoredSchedulingTimeType["owner_pre_review"],
                        allow_close_contact_candidate_sharing: values[9] as number,
                        status: values[10] as StoredSchedulingTimeType["status"],
                        updated_at: "2026-06-05T12:10:00Z",
                      }
                    : timeType,
                );
              }

              if (sql.includes("INSERT INTO scheduling_requests")) {
                state.schedulingRequests.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  contact_id: values[2] as string | null,
                  time_type_id: values[3] as string,
                  status: values[4] as DbSchedulingRequest["status"],
                  requester_name: values[5] as string | null,
                  target_name: values[6] as string | null,
                  reason: values[7] as string | null,
                  date_range_start: values[8] as string,
                  date_range_end: values[9] as string,
                  candidate_slots_json: values[10] as string,
                  selected_slot_json: null,
                  policy_json: values[11] as string | null,
                  stream_payload_json: values[12] as string | null,
                  checkout_url: null,
                  requester_approved_at: null,
                  target_approved_at: null,
                  finalized_calendar_event_id: null,
                  finalized_booking_id: null,
                  finalized_at: null,
                  created_at: "2026-06-05T12:20:00Z",
                  updated_at: "2026-06-05T12:20:00Z",
                });
              }

              if (sql.includes("INSERT INTO scheduling_request_votes")) {
                const existingIndex = state.schedulingRequestVotes.findIndex(
                  (vote) =>
                    vote.request_id === values[1] &&
                    vote.participant_role === values[2] &&
                    vote.slot_starts_at === values[4] &&
                    vote.slot_ends_at === values[5],
                );
                const vote: DbSchedulingRequestVote = {
                  id: existingIndex >= 0
                    ? state.schedulingRequestVotes[existingIndex].id
                    : (values[0] as string),
                  request_id: values[1] as string,
                  participant_role: values[2] as DbSchedulingRequestVote["participant_role"],
                  voter_label: values[3] as string | null,
                  slot_starts_at: values[4] as string,
                  slot_ends_at: values[5] as string,
                  preference: values[6] as DbSchedulingRequestVote["preference"],
                  raw_json: values[7] as string | null,
                  created_at: existingIndex >= 0
                    ? state.schedulingRequestVotes[existingIndex].created_at
                    : "2026-06-05T12:21:00Z",
                  updated_at: "2026-06-05T12:21:00Z",
                };
                if (existingIndex >= 0) state.schedulingRequestVotes[existingIndex] = vote;
                else state.schedulingRequestVotes.push(vote);
              }

              if (sql.includes("INSERT INTO scheduling_request_audit")) {
                state.schedulingRequestAudit.push({
                  id: values[0] as string,
                  request_id: values[1] as string,
                  user_id: values[2] as string,
                  event_type: values[3] as DbSchedulingRequestAudit["event_type"],
                  actor_role: values[4] as DbSchedulingRequestAudit["actor_role"],
                  summary: values[5] as string | null,
                  metadata_json: values[6] as string | null,
                  created_at: "2026-06-05T12:22:00Z",
                });
              }

              if (sql.includes("UPDATE scheduling_requests")) {
                if (sql.includes("status = 'checkout_required'")) {
                  state.schedulingRequests = state.schedulingRequests.map((request) =>
                    request.id === values[1] && request.user_id === values[2]
                      ? {
                          ...request,
                          status: "checkout_required",
                          checkout_url: values[0] as string | null,
                          updated_at: "2026-06-05T12:25:00Z",
                        }
                      : request,
                  );
                } else if (sql.includes("status = 'finalized'")) {
                  state.schedulingRequests = state.schedulingRequests.map((request) =>
                    request.id === values[2] && request.user_id === values[3]
                      ? {
                          ...request,
                          status: "finalized",
                          finalized_booking_id: values[0] as string | null,
                          finalized_calendar_event_id: values[1] as string | null,
                          finalized_at: "2026-06-05T12:25:00Z",
                          updated_at: "2026-06-05T12:25:00Z",
                        }
                      : request,
                  );
                } else if (sql.includes("selected_slot_json")) {
                  state.schedulingRequests = state.schedulingRequests.map((request) => {
                    if (request.id !== values[5] || request.user_id !== values[6]) return request;
                    const approvingRole = values[1] as string;
                    const requesterApproved =
                      approvingRole === "requester"
                        ? "2026-06-05T12:23:00Z"
                        : request.requester_approved_at;
                    const targetApproved =
                      approvingRole === "target"
                        ? "2026-06-05T12:23:00Z"
                        : request.target_approved_at;
                    return {
                      ...request,
                      selected_slot_json: request.selected_slot_json || (values[0] as string),
                      requester_approved_at: requesterApproved,
                      target_approved_at: targetApproved,
                      status: requesterApproved && targetApproved ? "approved" : "pending_approval",
                      updated_at: "2026-06-05T12:23:00Z",
                    };
                  });
                } else if (sql.includes("status = CASE")) {
                  state.schedulingRequests = state.schedulingRequests.map((request) =>
                    request.id === values[0] && request.user_id === values[1]
                      ? {
                          ...request,
                          status: request.status === "candidates_shared" ? "voting" : request.status,
                          updated_at: "2026-06-05T12:21:00Z",
                        }
                      : request,
                  );
                }
              }

              if (sql.includes("INSERT INTO user_calendar_events")) {
                const locationIsInlineNull = sql.includes("VALUES (?, ?, ?, ?, NULL,");
                state.userCalendarEvents.push({
                  id: values[0] as string,
                  user_id: values[1] as string,
                  title: values[2] as string,
                  notes: values[3] as string | null,
                  location: locationIsInlineNull ? null : (values[4] as string | null),
                  starts_at: locationIsInlineNull ? (values[4] as string) : (values[5] as string),
                  ends_at: locationIsInlineNull ? (values[5] as string) : (values[6] as string),
                  timezone: locationIsInlineNull ? (values[6] as string | null) : (values[7] as string | null),
                  all_day: locationIsInlineNull ? 0 : (values[8] as number),
                  kind: locationIsInlineNull ? "event" : (values[9] as DbUserCalendarEvent["kind"]),
                  recurrence_rule: locationIsInlineNull ? null : (values[10] as string | null),
                  created_at: "2026-06-05T12:25:00Z",
                });
              }

              if (sql.includes("UPDATE mailbox_aliases") && state.mailbox) {
                if (sql.includes("alias_local_part = ?")) {
                  state.mailbox.alias_local_part = values[0] as string;
                  state.mailbox.forwarding_email = values[1] as string;
                  state.mailbox.forwarding_status = values[2] as DbMailboxAlias["forwarding_status"];
                  state.mailbox.forwarding_enabled = values[3] as number;
                  state.mailbox.forwarding_mode = values[4] as DbMailboxAlias["forwarding_mode"];
                  state.mailbox.updated_at = values[5] as string;
                } else if (sql.includes("status = 'active'")) {
                  state.mailbox.status = "active";
                  state.mailbox.activated_at = state.mailbox.activated_at || (values[0] as string);
                  state.mailbox.updated_at = values[1] as string;
                } else if (sql.includes("status = 'paused'")) {
                  state.mailbox.status = "paused";
                  state.mailbox.updated_at = values[0] as string;
                }
              }

              if (
                sql.includes("UPDATE mailbox_messages") &&
                sql.includes("status = 'forwarded'")
              ) {
                state.mailboxMessages = state.mailboxMessages.map((message) =>
                  message.id === values[2] && message.mailbox_id === values[3]
                    ? {
                        ...message,
                        status: "forwarded",
                        forwarded_to: values[0] as string,
                        updated_at: values[1] as string,
                      }
                    : message,
                );
              }

              if (
                sql.includes("UPDATE mailbox_messages") &&
                sql.includes("SET status = 'approved'")
              ) {
                const eligible = state.mailboxMessages.some(
                  (message) =>
                    message.id === values[3] &&
                    message.mailbox_id === values[4] &&
                    message.message_kind === "draft" &&
                    (message.status === "pending_approval" || message.status === "failed"),
                );
                if (!eligible) return { success: true, meta: { changes: 0 } };
                state.mailboxMessages = state.mailboxMessages.map((message) =>
                  message.id === values[3] && message.mailbox_id === values[4]
                    ? {
                        ...message,
                        status: "approved",
                        error_message: null,
                        approved_by_user_id: values[0] as string,
                        approved_at: values[1] as string,
                        updated_at: values[2] as string,
                      }
                    : message,
                );
                return { success: true, meta: { changes: 1 } };
              }

              if (
                sql.includes("UPDATE mailbox_messages") &&
                sql.includes("message_kind = 'email'")
              ) {
                if (state.failMailboxDraftSentUpdateOnce) {
                  state.failMailboxDraftSentUpdateOnce = false;
                  throw new Error("Simulated mailbox sent update failure");
                }
                state.mailboxMessages = state.mailboxMessages.map((message) =>
                  message.id === values[6] && message.mailbox_id === values[7]
                    ? {
                        ...message,
                        message_kind: "email",
                        status: "sent",
                        folder: "sent",
                        provider_id: values[0] as string,
                        provider_message_id: values[1] as string | null,
                        error_message: null,
                        approved_by_user_id: values[2] as string,
                        approved_at: values[3] as string,
                        sent_at: values[4] as string,
                        updated_at: values[5] as string,
                      }
                    : message,
                );
              }

              if (
                sql.includes("UPDATE mailbox_messages") &&
                sql.includes("status = 'pending_approval'")
              ) {
                state.mailboxMessages = state.mailboxMessages.map((message) =>
                  message.id === values[10] && message.mailbox_id === values[11]
                    ? {
                        ...message,
                        status: "pending_approval",
                        thread_key: values[0] as string,
                        from_address: values[1] as string,
                        to_address: values[2] as string,
                        subject: values[3] as string,
                        text_body: values[4] as string,
                        html_body: values[5] as string | null,
                        metadata_json: values[6] as string,
                        source_id: values[7] as string | null,
                        folder: "drafts",
                        created_by: values[8] as string,
                        error_message: null,
                        updated_at: values[9] as string,
                      }
                    : message,
                );
              }

              if (
                sql.includes("UPDATE mailbox_messages") &&
                sql.includes("status = 'failed'")
              ) {
                state.mailboxMessages = state.mailboxMessages.map((message) =>
                  message.id === values[2] && message.mailbox_id === values[3]
                    ? {
                        ...message,
                        status: "failed",
                        error_message: values[0] as string,
                        updated_at: values[1] as string,
                      }
                    : message,
                );
              }

              if (
                sql.includes("UPDATE mailbox_messages") &&
                sql.includes("status = 'rejected'")
              ) {
                state.mailboxMessages = state.mailboxMessages.map((message) =>
                  message.id === values[3] && message.mailbox_id === values[4]
                    ? {
                        ...message,
                        status: "rejected",
                        folder: "trash",
                        approved_by_user_id: values[0] as string,
                        approved_at: values[1] as string,
                        updated_at: values[2] as string,
                      }
                    : message,
                );
              }

              if (sql.includes("INSERT INTO agent_channel_connections")) {
                if (sql.includes("'soulink'")) {
                  state.soulinkConnection = {
                    id: (state.soulinkConnection?.id || values[0]) as string,
                    user_id: values[1] as string,
                    channel: "soulink",
                    status: "active",
                    setup_token: values[2] as string,
                    provider_connection_id: values[3] as string | null,
                    provider_user_id: values[4] as string | null,
                    provider_thread_id: values[5] as string | null,
                    provider_username: values[6] as string | null,
                    provider_metadata_json: values[7] as string | null,
                    telegram_user_id: null,
                    telegram_chat_id: null,
                    telegram_username: null,
                    telegram_first_name: null,
                    telegram_last_name: null,
                    connected_at: "2026-05-11T10:00:00Z",
                    disconnected_at: null,
                    last_inbound_at: null,
                    last_outbound_at: null,
                    created_at: "2026-05-11T10:00:00Z",
                    updated_at: "2026-05-11T10:00:00Z",
                  };
                  return { success: true };
                }
                const connection: StoredTelegramConnection = {
                  id: sql.includes("'sandbox'")
                    ? (values[0] as string)
                    : ((state.telegramConnection?.id || values[0]) as string),
                  user_id: values[1] as string,
                  channel: sql.includes("'sandbox'") ? "sandbox" : "telegram",
                  status: sql.includes("'sandbox'") ? "active" : "pending",
                  setup_token: values[2] as string,
                  provider_connection_id: null,
                  provider_user_id: null,
                  provider_thread_id: null,
                  provider_username: null,
                  provider_metadata_json: null,
                  telegram_user_id: null,
                  telegram_chat_id: null,
                  telegram_username: null,
                  telegram_first_name: null,
                  telegram_last_name: null,
                  connected_at: sql.includes("'sandbox'")
                    ? "2026-05-11T10:00:00Z"
                    : null,
                  disconnected_at: null,
                  last_inbound_at: null,
                  last_outbound_at: null,
                  created_at: "2026-05-11T10:00:00Z",
                  updated_at: "2026-05-11T10:00:00Z",
                };
                if (connection.channel === "sandbox") {
                  state.sandboxConnection = connection;
                } else {
                  state.telegramConnection = connection;
                }
              }

              if (sql.includes("UPDATE agent_channel_connections")) {
                if (
                  sql.includes("telegram_user_id = ?") &&
                  state.telegramConnection &&
                  values[5] === state.telegramConnection.id
                ) {
                  state.telegramConnection = {
                    ...state.telegramConnection,
                    status: "active",
                    telegram_user_id: values[0] as string | null,
                    telegram_chat_id: values[1] as string | null,
                    telegram_username: values[2] as string | null,
                    telegram_first_name: values[3] as string | null,
                    telegram_last_name: values[4] as string | null,
                    connected_at: "2026-05-11T10:05:00Z",
                    disconnected_at: null,
                    last_inbound_at: "2026-05-11T10:05:00Z",
                    updated_at: "2026-05-11T10:05:00Z",
                  };
                } else if (
                  sql.includes("last_inbound_at = CURRENT_TIMESTAMP") &&
                  state.telegramConnection &&
                  values[0] === state.telegramConnection.id
                ) {
                  state.telegramConnection = {
                    ...state.telegramConnection,
                    last_inbound_at: "2026-05-11T10:06:00Z",
                    updated_at: "2026-05-11T10:06:00Z",
                  };
                } else if (
                  sql.includes("last_inbound_at = CURRENT_TIMESTAMP") &&
                  state.soulinkConnection &&
                  values[0] === state.soulinkConnection.id
                ) {
                  state.soulinkConnection = {
                    ...state.soulinkConnection,
                    last_inbound_at: "2026-05-11T10:06:00Z",
                    updated_at: "2026-05-11T10:06:00Z",
                  };
                } else if (
                  sql.includes("last_outbound_at = CURRENT_TIMESTAMP") &&
                  state.telegramConnection &&
                  values[0] === state.telegramConnection.id
                ) {
                  state.telegramConnection = {
                    ...state.telegramConnection,
                    last_outbound_at: "2026-05-11T10:07:00Z",
                    updated_at: "2026-05-11T10:07:00Z",
                  };
                } else if (
                  sql.includes("last_outbound_at = CURRENT_TIMESTAMP") &&
                  state.soulinkConnection &&
                  values[0] === state.soulinkConnection.id
                ) {
                  state.soulinkConnection = {
                    ...state.soulinkConnection,
                    last_outbound_at: "2026-05-11T10:07:00Z",
                    updated_at: "2026-05-11T10:07:00Z",
                  };
                } else if (sql.includes("status = 'active'") && state.sandboxConnection) {
                  state.sandboxConnection = {
                    ...state.sandboxConnection,
                    status: "active",
                    updated_at: "2026-05-11T10:05:00Z",
                  };
                } else if (sql.includes("channel = 'soulink'") && state.soulinkConnection) {
                  state.soulinkConnection = {
                    ...state.soulinkConnection,
                    status: "disconnected",
                    disconnected_at: "2026-05-11T10:05:00Z",
                    updated_at: "2026-05-11T10:05:00Z",
                  };
                } else if (state.telegramConnection) {
                  state.telegramConnection = {
                    ...state.telegramConnection,
                    status: "disconnected",
                    telegram_user_id: null,
                    telegram_chat_id: null,
                    telegram_username: null,
                    telegram_first_name: null,
                    telegram_last_name: null,
                    disconnected_at: "2026-05-11T10:05:00Z",
                    updated_at: "2026-05-11T10:05:00Z",
                  };
                }
              }

              if (sql.includes("INTO agent_channel_events")) {
                if (sql.includes("'sandbox'")) {
                  const duplicate = state.agentEvents.some(
                    (event) =>
                      event.connection_id === values[1] &&
                      event.provider_event_id === values[2],
                  );
                  if (!duplicate) {
                    state.agentEvents.push({
                      id: values[0] as string,
                      connection_id: values[1] as string,
                      channel: "sandbox",
                      direction: "inbound",
                      event_type: "message",
                      status: "received",
                      provider_event_id: values[2] as string,
                      provider_message_id: null,
                      reply_to_message_id: values[3] as string | null,
                      text_body: values[4] as string | null,
                      raw_json: values[5] as string | null,
                    });
                  }
                } else if (!sql.includes("'telegram'")) {
                  const duplicate = state.agentEvents.some(
                    (event) =>
                      event.connection_id === values[1] &&
                      event.provider_event_id === values[6],
                  );
                  if (sql.includes("INSERT OR IGNORE") && duplicate) {
                    return { success: true, meta: { changes: 0 } };
                  }
                  state.agentEvents.push({
                    id: values[0] as string,
                    connection_id: values[1] as string,
                    channel: values[2] as StoredAgentChannelEvent["channel"],
                    direction: values[3] as StoredAgentChannelEvent["direction"],
                    event_type: values[4] as StoredAgentChannelEvent["event_type"],
                    status: values[5] as StoredAgentChannelEvent["status"],
                    provider_event_id: values[6] as string | null,
                    provider_message_id: values[7] as string | null,
                    reply_to_message_id: values[8] as string | null,
                    text_body: values[9] as string | null,
                    raw_json: values[10] as string | null,
                  });
                  return { success: true, meta: { changes: 1 } };
                } else {
                  state.agentEvents.push({
                    id: values[0] as string,
                    connection_id: values[1] as string,
                    channel: "telegram",
                    direction: values[2] as StoredAgentChannelEvent["direction"],
                    event_type: values[3] as StoredAgentChannelEvent["event_type"],
                    status: values[4] as StoredAgentChannelEvent["status"],
                    provider_event_id: null,
                    provider_message_id: null,
                    reply_to_message_id: values[6] as string | null,
                    text_body: values[10] as string | null,
                    raw_json: values[11] as string | null,
                  });
                }
              }

              if (sql.includes("UPDATE agent_channel_events")) {
                if (sql.includes("SET text_body = ?")) {
                  const existing = state.agentEvents.find((event) => event.id === values[2]);
                  if (!existing) return { success: true, meta: { changes: 0 } };
                  state.agentEvents = state.agentEvents.map((event) =>
                    event.id === values[2]
                      ? {
                          ...event,
                          text_body: values[0] as string,
                          raw_json: values[1] as string,
                        }
                      : event,
                  );
                  return { success: true, meta: { changes: 1 } };
                }
                if (sql.includes("direction = 'inbound'")) {
                  const existing = state.agentEvents.find((event) => event.id === values[2]);
                  if (!existing) return { success: true, meta: { changes: 0 } };
                  state.agentEvents = state.agentEvents.map((event) =>
                    event.id === values[2]
                      ? { ...event, status: values[0] as StoredAgentChannelEvent["status"] }
                      : event,
                  );
                  return { success: true, meta: { changes: 1 } };
                }
                if (sql.includes("provider_message_id IS NULL OR provider_message_id = ?")) {
                  const existing = state.agentEvents.find((event) => event.id === values[3]);
                  if (!existing || (existing.provider_message_id && existing.provider_message_id !== values[4])) {
                    return { success: true, meta: { changes: 0 } };
                  }
                  state.agentEvents = state.agentEvents.map((event) =>
                    event.id === values[3]
                      ? {
                          ...event,
                          status: values[0] as StoredAgentChannelEvent["status"],
                          provider_message_id: values[1] as string,
                        }
                      : event,
                  );
                  return { success: true, meta: { changes: 1 } };
                }
                state.agentEvents = state.agentEvents.map((event) =>
                  event.id === values[4]
                    ? {
                        ...event,
                        status: values[0] as StoredAgentChannelEvent["status"],
                        provider_message_id: values[1] as string | null,
                        raw_json: values[2] as string | null,
                      }
                    : event,
                );
              }

              return { success: true };
            },
            async first<T>() {
              if (sql.includes("COUNT(*) AS count") && sql.includes("FROM mailbox_messages")) {
                const mailboxId = values[0] as string;
                return {
                  count: state.mailboxMessages.filter(
                    (message) => message.mailbox_id === mailboxId,
                  ).length,
                } as T;
              }

              if (
                sql.includes("COUNT(*) AS count") &&
                sql.includes("FROM assistant_threads")
              ) {
                return {
                  count: state.assistantThreads.filter(
                    (thread) =>
                      thread.owner_id === values[0] && thread.status === "archived",
                  ).length,
                } as T;
              }

              if (sql.includes("SELECT id, password_hash FROM owner_profile")) {
                return state.owner
                  ? ({ id: state.owner.id, password_hash: state.owner.password_hash } as T)
                  : null;
              }

              if (sql.includes("SELECT password_hash FROM owner_profile")) {
                return state.owner ? ({ password_hash: state.owner.password_hash } as T) : null;
              }

              if (sql.includes("lower(email)") && String(values[0]) === state.owner?.email?.toLowerCase()) {
                return state.owner as T;
              }

              if (sql.includes("FROM owner_profile") && values[0] === state.owner?.id) {
                return state.owner as T;
              }
              if (sql.includes("FROM ai_gateway_settings")) {
                return (
                  state.aiGatewaySettings?.user_id === values[0]
                    ? state.aiGatewaySettings
                    : null
                ) as T | null;
              }
              if (sql.includes("FROM assistant_threads")) {
                return (
                  state.assistantThreads.find(
                    (thread) =>
                      thread.id === values[0] &&
                      thread.owner_id === values[1] &&
                      thread.status !== "deleted",
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM assistant_attachments")) {
                const row = state.assistantAttachments.find(
                  (attachment) =>
                    attachment.id === values[0] && attachment.owner_id === values[1],
                );
                return row
                  ? ({
                      id: row.id,
                      filename: row.filename,
                      mime_type: row.mime_type,
                      kind: row.kind,
                      status: row.status,
                      storage_key: row.storage_key,
                      extracted_text: row.extracted_text,
                      text_truncated: row.text_truncated,
                    } as T)
                  : null;
              }
              if (sql.includes("FROM mission_projects")) {
                return (
                  state.missionProjects.find(
                    (project) =>
                      project.id === values[0] &&
                      project.user_id === values[1] &&
                      project.status !== "archived",
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM email_send_audit")) {
                const [auditOwnerId, mailboxOwnerId, messageId] = values as [
                  string,
                  string,
                  string,
                ];
                const message = state.mailboxMessages.find(
                  (entry) => entry.id === messageId,
                );
                const attemptStartedAt =
                  message?.approved_at || message?.updated_at || message?.created_at || "";
                return (
                  state.mailbox &&
                  state.mailbox.user_id === mailboxOwnerId &&
                  message?.mailbox_id === state.mailbox.id
                    ? state.emailSendAudit
                        .filter(
                          (audit) =>
                            audit.user_id === auditOwnerId &&
                            audit.mailbox_message_id === messageId &&
                            (audit.status === "sent" || audit.status === "failed") &&
                            audit.requested_at >= attemptStartedAt,
                        )
                        .sort((left, right) =>
                          right.requested_at.localeCompare(left.requested_at),
                        )[0] || null
                    : null
                ) as T | null;
              }
              if (
                sql.includes("FROM mailbox_messages") &&
                sql.includes("JOIN mailbox_aliases")
              ) {
                return (
                  state.mailbox && state.mailbox.user_id === values[0]
                    ? state.mailboxMessages.find(
                        (message) =>
                          message.id === values[1] &&
                          message.mailbox_id === state.mailbox?.id,
                      )
                    : null
                ) as T | null;
              }
              if (sql.includes("FROM mailbox_aliases")) {
                if (sql.includes("status = 'active'")) {
                  return state.mailbox?.status === "active" ? (state.mailbox as T) : null;
                }
                return state.mailbox && values[0] === state.mailbox.user_id
                  ? (state.mailbox as T)
                  : null;
              }
              if (sql.includes("FROM email_provider_settings")) {
                return (
                  state.emailProviderSettings.find(
                    (setting) =>
                      setting.user_id === values[0] &&
                      setting.provider_id === "postmark",
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM mailbox_messages")) {
                if (sql.includes("agent_idempotency_key = ?")) {
                  return (
                    state.mailboxMessages.find(
                      (message) =>
                        message.mailbox_id === values[0] &&
                        message.agent_idempotency_key === values[1],
                    ) || null
                  ) as T | null;
                }
                return (
                  state.mailboxMessages.find(
                    (message) =>
                      message.id === values[0] && message.mailbox_id === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM user_reminders")) {
                return (
                  state.reminders.find(
                    (reminder) =>
                      reminder.user_id === values[0] &&
                      reminder.source_dispatch_id === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM agent_channel_connections")) {
                if (sql.includes("channel = 'sandbox'")) {
                  return state.sandboxConnection &&
                    values[0] === state.sandboxConnection.user_id
                    ? (state.sandboxConnection as T)
                    : null;
                }
                if (sql.includes("setup_token = ?") && sql.includes("channel = 'soulink'")) {
                  return state.soulinkConnection &&
                    values[0] === state.soulinkConnection.setup_token &&
                    state.soulinkConnection.status === "active"
                    ? (state.soulinkConnection as T)
                    : null;
                }
                if (sql.includes("provider_thread_id = ?")) {
                  return state.soulinkConnection &&
                    values[0] === state.soulinkConnection.provider_thread_id &&
                    state.soulinkConnection.status === "active"
                    ? (state.soulinkConnection as T)
                    : null;
                }
                if (sql.includes("channel = 'soulink'")) {
                  return state.soulinkConnection &&
                    values[0] === state.soulinkConnection.user_id
                    ? (state.soulinkConnection as T)
                    : null;
                }
                if (sql.includes("setup_token = ?")) {
                  return state.telegramConnection &&
                    values[0] === state.telegramConnection.setup_token
                    ? (state.telegramConnection as T)
                    : null;
                }
                if (sql.includes("telegram_chat_id = ?")) {
                  return state.telegramConnection &&
                    values[0] === state.telegramConnection.telegram_chat_id &&
                    state.telegramConnection.status === "active"
                    ? (state.telegramConnection as T)
                    : null;
                }
                return state.telegramConnection &&
                  values[0] === state.telegramConnection.user_id
                  ? (state.telegramConnection as T)
                  : null;
              }
              if (sql.includes("FROM agent_channel_events")) {
                if (sql.includes("provider_event_id = ?")) {
                  return (
                    state.agentEvents.find(
                      (event) =>
                        event.connection_id === values[0] &&
                        event.provider_event_id === values[1],
                    ) || null
                  ) as T | null;
                }
                return null;
              }
              if (sql.includes("FROM plugin_installations")) {
                return (
                  state.pluginInstallations.find(
                    (installation) => installation.plugin_id === values[0],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM social_accounts") && sql.includes("WHERE id = ?")) {
                return (
                  state.socialAccounts.find(
                    (account) =>
                      account.id === values[0] &&
                      account.user_id === values[1] &&
                      account.site_id === values[2] &&
                      account.platform === values[3] &&
                      account.status === "active",
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM social_variants v")) {
                const version = state.postVersions.find((entry) => entry.id === values[0]);
                const post = version
                  ? state.socialPosts.find((entry) => entry.id === version.package_id)
                  : null;
                return post && values[1] === "owner"
                  ? ({ ...version, site_id: post.site_id } as T)
                  : null;
              }
              if (sql.includes("FROM social_variants WHERE id = ?")) {
                return (
                  state.postVersions.find((entry) => entry.id === values[0]) || null
                ) as T | null;
              }
              if (sql.includes("FROM social_packages p")) {
                const post = state.socialPosts.find((entry) => entry.id === values[0]);
                return post && values[1] === "owner" ? (post as T) : null;
              }
              if (sql.includes("FROM content_bank_items")) {
                if (sql.includes("SUM(CASE")) {
                  const userId = values[0] as string;
                  const siteId = values[1] as string;
                  const rows = state.contentItems.filter(
                    (item) => item.user_id === userId && item.site_id === siteId,
                  );
                  return {
                    bank_count: rows.filter((item) => item.status === "bank").length,
                    queued_count: rows.filter(
                      (item) => item.status === "queued" || item.status === "scheduled",
                    ).length,
                    posted_count: rows.filter((item) => item.status === "posted").length,
                    next_scheduled_at: null,
                  } as T;
                }
                return (
                  state.contentItems.find(
                    (item) => item.id === values[0] && item.user_id === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM social_publications")) {
                if (sql.includes("JOIN content_bank_items")) {
                  const publication = state.socialPublications.find(
                    (entry) => entry.id === values[0],
                  );
                  if (!publication) return null;
                  const item = state.contentItems.find(
                    (entry) => entry.id === publication.variant_id,
                  );
                  if (!item) return null;
                  const account =
                    state.socialAccounts.find(
                      (entry) =>
                        entry.site_id === publication.site_id &&
                        entry.platform === publication.platform &&
                        entry.status === "active",
                    ) || null;
                  return {
                    publication_id: publication.id,
                    variant_id: publication.variant_id,
                    site_id: publication.site_id,
                    platform: publication.platform,
                    pub_status: publication.status,
                    body: item.body,
                    media_manifest_json: item.media_manifest_json,
                    platforms_json: item.platforms_json,
                    approved_by_human: item.approved_by_human,
                    user_id: item.user_id,
                    account_id: account?.id || null,
                    platform_account_id: account?.platform_account_id || null,
                    access_token_ciphertext: account?.access_token_ciphertext || null,
                    refresh_token_ciphertext: account?.refresh_token_ciphertext || null,
                    token_expires_at: account?.token_expires_at || null,
                    account_status: account?.status || null,
                  } as T;
                }
                return (
                  state.socialPublications.find(
                    (entry) =>
                      entry.variant_id === values[0] &&
                      entry.platform === values[1] &&
                      (entry.status === "queued" || entry.status === "publishing"),
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM sites")) {
                if (sql.includes("lower(custom_domain)")) {
                  const domain = String(values[0] || "").toLowerCase();
                  return (
                    state.sites.find(
                      (site) =>
                        site.custom_domain?.toLowerCase() === domain &&
                        (!sql.includes("id <> ?") || site.id !== values[1]),
                    ) || null
                  ) as T | null;
                }
                if (values.length === 1) {
                  return (
                    state.sites.find((site) =>
                      sql.includes("WHERE id = ?")
                        ? site.id === values[0]
                        : site.username === values[0],
                    ) ||
                    (values[0] === "owner"
                      ? ({ id: "site-1", user_id: "owner", username: "owner" } as DbSite)
                      : null)
                  ) as T | null;
                }
                const site = state.sites.find(
                  (entry) => entry.user_id === values[0] && entry.username === values[1],
                );
                if (site) return site as T;
                return values[0] === "site-1" && values[1] === "owner"
                  ? ({ id: "site-1", user_id: "owner", username: "owner" } as T)
                  : null;
              }
              if (sql.includes("FROM site_files")) {
                return (
                  state.siteFiles.find(
                    (file) => file.site_id === values[0] && file.path === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM bookings")) {
                if (sql.includes("WHERE id = ?")) {
                  return (
                    state.bookings.find((booking) => booking.id === values[0]) || null
                  ) as T | null;
                }
                if (sql.includes("WHERE payment_intent_id = ?")) {
                  return (
                    state.bookings.find((booking) => booking.payment_intent_id === values[0]) ||
                    null
                  ) as T | null;
                }
                if (sql.includes("status = 'confirmed'")) {
                  const [siteId, offerId, , endsAt, startsAt] = values as string[];
                  return (
                    state.bookings.find(
                      (booking) =>
                        booking.site_id === siteId &&
                        booking.status === "confirmed" &&
                        (!offerId || booking.offer_id === offerId) &&
                        booking.starts_at < endsAt &&
                        booking.ends_at > startsAt,
                    ) || null
                  ) as T | null;
                }
                return null;
              }
              if (sql.includes("FROM booking_holds")) {
                if (sql.includes("WHERE hold_token = ?")) {
                  return (
                    state.bookingHolds.find(
                      (hold) =>
                        hold.hold_token === values[0] &&
                        hold.status === "active" &&
                        new Date(hold.expires_at).getTime() > Date.now(),
                    ) || null
                  ) as T | null;
                }

                const [siteId, offerId, , endsAt, startsAt] = values as string[];
                return (
                  state.bookingHolds.find(
                    (hold) =>
                      hold.site_id === siteId &&
                      hold.status === "active" &&
                      new Date(hold.expires_at).getTime() > Date.now() &&
                      (!offerId || hold.offer_id === offerId) &&
                      hold.slot_start < endsAt &&
                      hold.slot_end > startsAt,
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM scheduling_time_types")) {
                if (sql.includes("LIMIT 1") && !sql.includes("AND id = ?")) {
                  return (
                    state.schedulingTimeTypes.find(
                      (timeType) => timeType.user_id === values[0],
                    ) || null
                  ) as T | null;
                }
                return (
                  state.schedulingTimeTypes.find(
                    (timeType) =>
                      timeType.user_id === values[0] && timeType.id === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM scheduling_requests")) {
                return (
                  state.schedulingRequests.find(
                    (request) => request.user_id === values[0] && request.id === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM user_calendar_events")) {
                return (
                  state.userCalendarEvents.find(
                    (event) => event.id === values[0] && event.user_id === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM social_provider_settings")) {
                return (
                  state.socialProviderSettings.find(
                    (setting) =>
                      setting.user_id === values[0] && setting.provider_id === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM social_oauth_states")) {
                return (
                  state.socialOauthStates.find(
                    (oauthState) =>
                      oauthState.state === values[0] && oauthState.platform === values[1],
                  ) || null
                ) as T | null;
              }
              if (sql.includes("FROM me3_install_claim_states")) {
                return (
                  state.me3ClaimStates.find((entry) => entry.state === values[0]) || null
                ) as T | null;
              }
              if (sql.includes("FROM auth_rate_limits")) {
                return (
                  state.authRateLimits.find((entry) => entry.key === values[0]) || null
                ) as T | null;
              }
              if (sql.includes("FROM install_secrets")) {
                const value = state.installSecrets.get(values[0] as string);
                return value ? ({ value } as T) : null;
              }
              if (sql.includes("FROM sqlite_master")) {
                const name = values[0] as string;
                if (!runtimeTableNames.has(name)) return null;
                if (sql.includes("SELECT sql")) {
                  return {
                    sql: `CREATE TABLE ${name} (platform TEXT CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business')))`,
                  } as T;
                }
                return { name } as T;
              }
              if (sql.includes("FROM core_runtime_migrations")) {
                return null;
              }
              if (sql.includes("FROM commerce_settings")) {
                return state.commerceSettings?.user_id === values[0]
                  ? (state.commerceSettings as T)
                  : null;
              }
              if (sql.includes("FROM telegram_settings")) {
                if (sql.includes("LIMIT 1")) {
                  return state.telegramSettings as T | null;
                }
                return state.telegramSettings?.user_id === values[0]
                  ? (state.telegramSettings as T)
                  : null;
              }
              if (sql.includes("FROM contacts")) {
                return (
                  state.contacts.find(
                    (contact) => contact.user_id === values[0] && contact.id === values[1],
                  ) || null
                ) as T | null;
              }
              return null;
            },
            async all<T>() {
              if (sql.includes("FROM assistant_threads")) {
                const searchValue =
                  sql.includes("LIKE") && typeof values[2] === "string"
                    ? String(values[2]).replace(/^%|%$/g, "").toLowerCase()
                    : "";
                return {
                  results: state.assistantThreads
                    .filter((thread) => {
                      const ownerMatches = !values[0] || thread.owner_id === values[0];
                      const statusMatches = !values[1] || thread.status === values[1];
                      const searchMatches =
                        !searchValue ||
                        thread.title.toLowerCase().includes(searchValue) ||
                        state.messages.some(
                          (message) =>
                            message.ownerId === thread.owner_id &&
                            message.threadId === thread.id &&
                            message.content.toLowerCase().includes(searchValue),
                        );
                      return ownerMatches && statusMatches && searchMatches;
                    })
                    .sort((a, b) =>
                      String(b.last_message_at || b.updated_at).localeCompare(
                        String(a.last_message_at || a.updated_at),
                      ),
                    ) as T[],
                };
              }
              if (sql.includes("FROM assistant_messages")) {
                const ownerId = values[0] as string;
                const threadId = sql.includes("thread_id = ?")
                  ? (values[1] as string)
                  : null;
                return {
                  results: state.messages
                    .filter(
                      (message) =>
                        message.ownerId === ownerId &&
                        (!threadId || message.threadId === threadId) &&
                        (message.role === "user" || message.role === "assistant"),
                    )
                    .map((message) => ({
                      id: message.id,
                      role: message.role,
                      content: message.content,
                      metadata_json: message.metadata_json || "{}",
                      created_at: message.created_at || "2026-05-11T10:07:00Z",
                    })) as T[],
                };
              }
              if (sql.includes("FROM contacts")) {
                return {
                  results: state.contacts.filter(
                    (contact) => contact.user_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM bookings b")) {
                const [ownerId, windowStart, windowEnd] = values as string[];
                return {
                  results: state.bookings.filter((booking) => {
                    const site = state.sites.find((entry) => entry.id === booking.site_id);
                    return (
                      site?.user_id === ownerId &&
                      booking.status === "confirmed" &&
                      booking.ends_at > windowStart &&
                      booking.starts_at < windowEnd
                    );
                  }) as T[],
                };
              }
              if (sql.includes("FROM user_calendar_events")) {
                const ownerId = values[0] as string;
                const recurring = sql.includes("recurrence_rule IS NOT NULL");
                const windowStart = values[1] as string | undefined;
                const windowEnd = values[2] as string | undefined;
                return {
                  results: state.userCalendarEvents.filter((event) => {
                    if (event.user_id !== ownerId) return false;
                    if (recurring) return event.recurrence_rule !== null;
                    return (
                      event.recurrence_rule === null &&
                      typeof windowStart === "string" &&
                      typeof windowEnd === "string" &&
                      event.ends_at > windowStart &&
                      event.starts_at < windowEnd
                    );
                  }) as T[],
                };
              }
              if (sql.includes("FROM calendar_source_events")) {
                const [ownerId, windowStart, windowEnd] = values as string[];
                return {
                  results: state.calendarSourceEvents.filter((event) => {
                    const source = state.calendarSources.find(
                      (entry) => entry.id === event.source_id,
                    );
                    return (
                      source?.user_id === ownerId &&
                      event.ends_at > windowStart &&
                      event.starts_at < windowEnd
                    );
                  }) as T[],
                };
              }
              if (sql.includes("FROM scheduling_time_types")) {
                return {
                  results: state.schedulingTimeTypes.filter(
                    (timeType) =>
                      timeType.user_id === values[0] &&
                      (!sql.includes("status = 'active'") || timeType.status === "active"),
                  ) as T[],
                };
              }
              if (sql.includes("FROM scheduling_request_votes")) {
                return {
                  results: state.schedulingRequestVotes.filter(
                    (vote) => vote.request_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM scheduling_request_audit")) {
                return {
                  results: state.schedulingRequestAudit.filter(
                    (entry) => entry.request_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM ai_provider_credentials")) {
                return {
                  results: state.aiCredentials.filter(
                    (credential) => credential.user_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM ai_model_defaults")) {
                return {
                  results: state.aiDefaults.filter(
                    (defaultRow) => defaultRow.user_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM ai_gateway_settings")) {
                return {
                  results:
                    state.aiGatewaySettings?.user_id === values[0]
                      ? ([state.aiGatewaySettings] as T[])
                      : ([] as T[]),
                };
              }
              if (sql.includes("FROM email_provider_settings")) {
                return {
                  results: state.emailProviderSettings.filter(
                    (setting) => setting.user_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM mailbox_messages")) {
                const mailboxId = values[0] as string;
                return {
                  results: state.mailboxMessages.filter(
                    (message) => message.mailbox_id === mailboxId,
                  ) as T[],
                };
              }
              if (sql.includes("FROM agent_channel_events")) {
                return {
                  results: state.agentEvents.filter(
                    (event) => event.connection_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM social_accounts")) {
                return {
                  results: state.socialAccounts.filter(
                    (account) => account.user_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM social_provider_settings")) {
                return {
                  results: state.socialProviderSettings.filter(
                    (setting) => setting.user_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM social_packages p")) {
                const siteId = values[1] as string | null;
                return {
                  results: state.socialPosts.filter(
                    (post) =>
                      post.status !== "archived" &&
                      (!siteId || post.site_id === siteId),
                  ) as T[],
                };
              }
              if (sql.includes("FROM social_variants v")) {
                return {
                  results: state.postVersions.filter(
                    (version) => version.package_id === values[0],
                  ) as T[],
                };
              }
              if (sql.includes("FROM content_bank_items")) {
                if (sql.includes("status IN ('queued', 'scheduled')")) {
                  return {
                    results: state.contentItems
                      .filter(
                        (item) =>
                          item.user_id === values[0] &&
                          item.site_id === values[1] &&
                          (item.status === "queued" || item.status === "scheduled"),
                      )
                      .sort(
                        (a, b) =>
                          (a.queue_position || Number.MAX_SAFE_INTEGER) -
                          (b.queue_position || Number.MAX_SAFE_INTEGER),
                      ) as T[],
                  };
                }
                return {
                  results: state.contentItems.filter((item) => {
                    const status = values[2] as string | null;
                    return (
                      item.user_id === values[0] &&
                      item.site_id === values[1] &&
                      (!status || item.status === status)
                    );
                  }) as T[],
                };
              }
              if (sql.includes("FROM social_publications")) {
                return {
                  results: state.socialPublications
                    .filter((publication) => publication.variant_id === values[0])
                    .map((publication) => ({
                      status: publication.status,
                      published_at: publication.published_at,
                    })) as T[],
                };
              }
              if (sql.includes("FROM sites")) {
                return {
                  results: state.sites
                    .filter((site) => {
                      const ownerMatches = !values[0] || site.user_id === values[0];
                      const typeMatches =
                        !sql.includes("COALESCE(site_type, 'profile') = 'profile'") ||
                        (site.site_type || "profile") === "profile";
                      const publishedMatches =
                        !sql.includes("published_at IS NOT NULL") ||
                        site.published_at !== null;
                      return ownerMatches && typeMatches && publishedMatches;
                    })
                    .sort((first, second) =>
                      String(second.published_at || second.updated_at || "").localeCompare(
                        String(first.published_at || first.updated_at || ""),
                      ),
                    ) as T[],
                };
              }
              if (sql.includes("FROM site_files")) {
                const siteId = values[0] as string;
                const pathPattern = String(values[1] || "");
                const prefix = pathPattern.endsWith("%")
                  ? pathPattern.slice(0, -1)
                  : pathPattern;
                return {
                  results: state.siteFiles
                    .filter(
                      (file) =>
                        file.site_id === siteId &&
                        (sql.includes("path LIKE ?")
                          ? file.path.startsWith(prefix)
                          : file.path === pathPattern),
                    )
                    .sort((first, second) => first.path.localeCompare(second.path)) as T[],
                };
              }
              return { results: [] as T[] };
            },
          };
        },
      };
    },
  };

  return {
    get owner() {
      return state.owner;
    },
    set owner(value: StoredOwner | null) {
      state.owner = value;
    },
    get messages() {
      return state.messages;
    },
    get assistantThreads() {
      return state.assistantThreads;
    },
    get assistantAttachments() {
      return state.assistantAttachments;
    },
    get failAssistantAttachmentInsert() {
      return state.failAssistantAttachmentInsert;
    },
    set failAssistantAttachmentInsert(value: boolean) {
      state.failAssistantAttachmentInsert = value;
    },
    get missionProjects() {
      return state.missionProjects;
    },
    get mailbox() {
      return state.mailbox;
    },
    set mailbox(value: DbMailboxAlias | null) {
      state.mailbox = value;
    },
    get pluginInstallations() {
      return state.pluginInstallations;
    },
    get installSecrets() {
      return state.installSecrets;
    },
    get aiCredentials() {
      return state.aiCredentials;
    },
    get aiDefaults() {
      return state.aiDefaults;
    },
    get aiGatewaySettings() {
      return state.aiGatewaySettings;
    },
    get emailProviderSettings() {
      return state.emailProviderSettings;
    },
    get emailSendAudit() {
      return state.emailSendAudit;
    },
    get failEmailSendAuditInsertOnce() {
      return state.failEmailSendAuditInsertOnce;
    },
    set failEmailSendAuditInsertOnce(value: boolean) {
      state.failEmailSendAuditInsertOnce = value;
    },
    get failMailboxDraftSentUpdateOnce() {
      return state.failMailboxDraftSentUpdateOnce;
    },
    set failMailboxDraftSentUpdateOnce(value: boolean) {
      state.failMailboxDraftSentUpdateOnce = value;
    },
    get emailSends() {
      return state.emailSends;
    },
    get mailboxMessages() {
      return state.mailboxMessages;
    },
    get reminders() {
      return state.reminders;
    },
    get userCalendarEvents() {
      return state.userCalendarEvents;
    },
    get calendarSources() {
      return state.calendarSources;
    },
    get calendarSourceEvents() {
      return state.calendarSourceEvents;
    },
    get contacts() {
      return state.contacts;
    },
    get telegramConnection() {
      return state.telegramConnection;
    },
    set telegramConnection(value: StoredTelegramConnection | null) {
      state.telegramConnection = value;
    },
    get sandboxConnection() {
      return state.sandboxConnection;
    },
    get soulinkConnection() {
      return state.soulinkConnection;
    },
    set soulinkConnection(value: StoredTelegramConnection | null) {
      state.soulinkConnection = value;
    },
    get agentEvents() {
      return state.agentEvents;
    },
    get socialAccounts() {
      return state.socialAccounts;
    },
    get socialProviderSettings() {
      return state.socialProviderSettings;
    },
    get socialOauthStates() {
      return state.socialOauthStates;
    },
    get socialPublications() {
      return state.socialPublications;
    },
    get socialPublicationEvents() {
      return state.socialPublicationEvents;
    },
    get socialPosts() {
      return state.socialPosts;
    },
    get postVersions() {
      return state.postVersions;
    },
    get socialPublishQueueMessages() {
      return state.socialPublishQueueMessages;
    },
    get me3ClaimStates() {
      return state.me3ClaimStates;
    },
    get authRateLimits() {
      return state.authRateLimits;
    },
    get commerceSettings() {
      return state.commerceSettings;
    },
    get telegramSettings() {
      return state.telegramSettings;
    },
    get contentItems() {
      return state.contentItems;
    },
    get sites() {
      return state.sites;
    },
    get siteFiles() {
      return state.siteFiles;
    },
    get bookings() {
      return state.bookings;
    },
    get bookingHolds() {
      return state.bookingHolds;
    },
    get schedulingTimeTypes() {
      return state.schedulingTimeTypes;
    },
    get schedulingRequests() {
      return state.schedulingRequests;
    },
    get schedulingRequestVotes() {
      return state.schedulingRequestVotes;
    },
    get schedulingRequestAudit() {
      return state.schedulingRequestAudit;
    },
    get managedRuntimeInstallationId() {
      return state.managedRuntimeInstallationId;
    },
    set managedRuntimeInstallationId(value: string | null) {
      state.managedRuntimeInstallationId = value;
    },
    DB: db as unknown as D1Database,
    ENVIRONMENT: "local",
    ME3_DEPLOYMENT_MODE: "self_hosted",
    CORE_WEB_ORIGIN: "http://localhost:4000",
    CORE_API_ORIGIN: "http://localhost:8787",
    JWT_SECRET: "test-secret-at-least-long-enough",
    TOKEN_ENCRYPTION_KEY: "test-encryption-key",
    SETUP_PASSWORD: "owner-code",
    TELEGRAM_BOT_USERNAME: "me3_core_test_bot",
    TELEGRAM_BOT_TOKEN: "123:test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    SOULINK_API_ORIGIN: "https://soulink.test",
    EMAIL: {
      async send(message) {
        state.emailSends.push(message as Record<string, unknown>);
        return { messageId: `cf-${state.emailSends.length}` };
      },
    },
    SOCIAL_PUBLISH_QUEUE: {
      async send(message: { publicationId: string }) {
        state.socialPublishQueueMessages.push(message);
      },
    } as unknown as Queue<{ publicationId: string }>,
  };
}

async function bootstrap(env: Env) {
  return app.fetch(
    new Request("http://localhost/api/admin/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:4000" },
      body: JSON.stringify({
        bootstrapCode: "owner-code",
        email: "owner@example.com",
        name: "ME3 Owner",
        username: "owner",
        password: "correct-horse-battery",
      }),
    }),
    env,
  );
}

function createInboundEmailMessage(raw: string, init?: {
  from?: string;
  to?: string;
  headers?: HeadersInit;
  canBeForwarded?: boolean;
}): TestForwardableEmailMessage {
  const bytes = new TextEncoder().encode(raw);
  const forwardedTo: string[] = [];
  const message = {
    from: init?.from || "client@example.com",
    to: init?.to || "name@example.com",
    headers: new Headers(init?.headers),
    raw: new Response(bytes).body!,
    rawSize: bytes.byteLength,
    canBeForwarded: init?.canBeForwarded ?? true,
    rejectedWith: null as string | null,
    forwardedTo,
    setReject(reason: string) {
      message.rejectedWith = reason;
    },
    async forward(rcptTo: string) {
      forwardedTo.push(rcptTo);
    },
  };
  return message;
}

function emailWorker() {
  return app as typeof app & {
    email(message: TestForwardableEmailMessage, env: Env): Promise<void>;
  };
}

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

function responseCookieCleared(response: Response): boolean {
  const setCookie = response.headers.get("set-cookie") || "";
  return setCookie.includes("me3_core_session=") && setCookie.includes("Max-Age=0");
}

function addSiteFileText(
  env: ReturnType<typeof createEnv>,
  siteId: string,
  path: string,
  text: string,
  contentType: string,
) {
  const content = new TextEncoder().encode(text);
  env.siteFiles.push({
    site_id: siteId,
    path,
    content,
    content_type: contentType,
    size: content.byteLength,
    sha256: null,
    updated_at: "2026-06-05T09:00:00Z",
  });
}

function siteFileText(
  env: ReturnType<typeof createEnv>,
  siteId: string,
  path: string,
): string | null {
  const file = env.siteFiles.find(
    (entry) => entry.site_id === siteId && entry.path === path,
  );
  return file ? new TextDecoder().decode(file.content) : null;
}

function addAssistantEditableSite(
  env: ReturnType<typeof createEnv>,
  options: {
    blogEnabled?: boolean;
    publishedAt?: string | null;
    assistantSiteToolsEnabled?: boolean;
  } = {},
) {
  if (options.assistantSiteToolsEnabled === false) {
    delete env.ME3_ASSISTANT_SITE_TOOLS_ENABLED;
  } else {
    env.ME3_ASSISTANT_SITE_TOOLS_ENABLED = "1";
  }
  env.sites.push({
    id: "site-assistant",
    user_id: "owner",
    username: "owner",
    site_type: "profile",
    site_role: "profile",
    template_id: "me3",
    custom_domain: null,
    custom_domain_status: null,
    custom_domain_cf_id: null,
    created_at: "2026-06-05T09:00:00Z",
    updated_at: "2026-06-05T09:00:00Z",
    published_at: options.publishedAt ?? null,
  });
  addSiteFileText(
    env,
    "site-assistant",
    "src/me.json",
    JSON.stringify(
      {
        version: "0.1",
        handle: "owner",
        name: "Owner",
        bio: "Original bio.",
        pages: [{ slug: "about", title: "About", file: "about.md" }],
        blogEnabled: options.blogEnabled === true,
        posts: [],
      },
      null,
      2,
    ),
    "application/json",
  );
  addSiteFileText(
    env,
    "site-assistant",
    "src/about.md",
    "# About\n\nOriginal about.",
    "text/markdown",
  );
}

function addBookableSite(
  env: ReturnType<typeof createEnv>,
  bookIntent: Record<string, unknown> = {
    enabled: true,
    offers: [
      {
        id: "free-session",
        title: "Free session",
        duration: 60,
        pricing: { enabled: false },
      },
    ],
    availability: {
      timezone: "Europe/Dublin",
      windows: { tuesday: ["15:00-16:30"] },
    },
  },
) {
  env.sites.push({
    id: "site-booking",
    user_id: "owner",
    username: "owner",
    site_type: "profile",
    site_role: "profile",
    template_id: "me3",
    custom_domain: null,
    custom_domain_status: null,
    custom_domain_cf_id: null,
    created_at: "2026-05-31T22:00:00Z",
    updated_at: "2026-05-31T22:00:00Z",
    published_at: "2026-05-31T22:00:00Z",
  });
  const meJson = {
    version: "0.1",
    name: "Booking Owner",
    handle: "owner",
    intents: {
      book: bookIntent,
    },
  };
  const content = new TextEncoder().encode(JSON.stringify(meJson));
  env.siteFiles.push({
    site_id: "site-booking",
    path: "public/me.json",
    content,
    content_type: "application/json",
    size: content.byteLength,
    sha256: null,
    updated_at: "2026-05-31T22:00:00Z",
  });
}

function addReadyCloudflareEmailProvider(env: ReturnType<typeof createEnv>) {
  env.emailProviderSettings.push({
    user_id: "owner",
    provider_id: "cloudflare-email",
    is_active: 1,
    encrypted_secret: null,
    secret_hint: null,
    secret_updated_at: null,
    config_json: JSON.stringify({
      transport: "binding",
      fromAddress: "owner@example.com",
      fromName: "ME3 Owner",
      sendingDomain: "example.com",
    }),
    last_status: "ready",
    last_status_checked_at: "2026-06-05T12:00:00.000Z",
    last_test_sent_at: "2026-06-05T12:00:00.000Z",
    last_test_error: null,
    created_at: "2026-06-05T12:00:00.000Z",
    updated_at: "2026-06-05T12:00:00.000Z",
  });
}

function createFakeSmtpConnect(): {
  connect: NonNullable<Env["SMTP_CONNECT"]>;
  commands: string[];
  messages: string[];
} {
  const commands: string[] = [];
  const messages: string[] = [];
  return {
    commands,
    messages,
    connect: () => new FakeSmtpSocket(commands, messages, true),
  };
}

class FakeSmtpSocket implements Socket {
  readonly opened = Promise.resolve({});
  readonly closed = Promise.resolve();
  readonly upgraded = false;
  readonly secureTransport = "starttls";
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private buffer = "";
  private dataMode = false;

  constructor(
    private readonly commands: string[],
    private readonly messages: string[],
    greet: boolean,
  ) {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        if (greet) this.enqueue("220 smtp.test ESMTP\r\n");
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.handleWrite(new TextDecoder().decode(chunk));
      },
    });
  }

  async close(): Promise<void> {
    try {
      this.controller?.close();
    } catch {
      // Already closed.
    }
  }

  startTls(): Socket {
    return new FakeSmtpSocket(this.commands, this.messages, false);
  }

  private handleWrite(text: string) {
    this.buffer += text;
    if (this.dataMode) {
      const terminatorIndex = this.buffer.indexOf("\r\n.\r\n");
      if (terminatorIndex < 0) return;
      this.messages.push(this.buffer.slice(0, terminatorIndex));
      this.commands.push("[DATA]");
      this.buffer = this.buffer.slice(terminatorIndex + 5);
      this.dataMode = false;
      this.enqueue("250 2.0.0 Ok: queued as smtp-test-1\r\n");
    }

    while (!this.dataMode) {
      const newlineIndex = this.buffer.indexOf("\r\n");
      if (newlineIndex < 0) return;
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 2);
      this.handleCommand(line);
    }
  }

  private handleCommand(line: string) {
    this.commands.push(line);
    if (line.startsWith("EHLO ")) {
      this.enqueue("250-smtp.test\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
      return;
    }
    if (line === "STARTTLS") {
      this.enqueue("220 2.0.0 Ready to start TLS\r\n");
      return;
    }
    if (line.startsWith("AUTH PLAIN ")) {
      this.enqueue("235 2.7.0 Authentication successful\r\n");
      return;
    }
    if (line.startsWith("MAIL FROM:")) {
      this.enqueue("250 2.1.0 Sender OK\r\n");
      return;
    }
    if (line.startsWith("RCPT TO:")) {
      this.enqueue("250 2.1.5 Recipient OK\r\n");
      return;
    }
    if (line === "DATA") {
      this.dataMode = true;
      this.enqueue("354 End data with <CR><LF>.<CR><LF>\r\n");
      return;
    }
    if (line === "QUIT") {
      this.enqueue("221 2.0.0 Bye\r\n");
      return;
    }
    this.enqueue("250 OK\r\n");
  }

  private enqueue(value: string) {
    this.controller?.enqueue(new TextEncoder().encode(value));
  }
}

async function createSignedMe3ClaimToken(input: {
  issuer: string;
  userId?: string;
  state: string;
  coreOrigin: string;
  callbackUrl: string;
  email: string;
  name?: string | null;
  handle?: string | null;
  installId?: string;
  coreUpdateToken?: string;
  managedEmailAddress?: string | null;
}): Promise<{ token: string; publicJwk: JsonWebKey & { kid?: string; alg?: string; use?: string } }> {
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
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "test-key" };
  const payload: Record<string, unknown> = {
    iss: input.issuer,
    sub: input.userId || "user123",
    aud: "me3-core-install-claim",
    email: input.email,
    install_id: input.installId || "core_11111111-1111-4111-8111-111111111111",
    core_update_token: input.coreUpdateToken || "core-update-token-123",
    core_origin: input.coreOrigin,
    callback_url: input.callbackUrl,
    state: input.state,
    redirect_path: "/account",
    claim_id: "claim-123",
    iat: now,
    exp: now + 600,
  };
  if (input.handle !== null) {
    payload.handle = input.handle || "kieran";
  }
  if (input.name !== undefined) {
    payload.name = input.name;
  }
  if (input.managedEmailAddress !== undefined) {
    payload.managed_email_address = input.managedEmailAddress;
  }
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return {
    token: `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`,
    publicJwk,
  };
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPostmarkMailboxDraft(
  env: ReturnType<typeof createEnv>,
  session: string,
): Promise<string> {
  const settingsResponse = await app.fetch(
    new Request("http://localhost/api/email-provider-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: session },
      body: JSON.stringify({
        activeProviderId: "postmark",
        providers: [
          {
            id: "postmark",
            fromAddress: "hello@example.com",
            fromName: "ME3 Mail",
            messageStream: "outbound",
            serverToken: "postmark-secret-1234",
          },
        ],
      }),
    }),
    env,
  );
  expect(settingsResponse.status).toBe(200);

  const mailboxResponse = await app.fetch(
    new Request("http://localhost/api/mailbox", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: session },
      body: JSON.stringify({ aliasLocalPart: "owner", forwardingEnabled: false }),
    }),
    env,
  );
  expect(mailboxResponse.status).toBe(200);

  const draftResponse = await app.fetch(
    new Request("http://localhost/api/mailbox/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session },
      body: JSON.stringify({
        to: "client@example.com",
        subject: "Delivery boundary",
        textBody: "Delivery boundary test",
        source: "user",
      }),
    }),
    env,
  );
  expect(draftResponse.status).toBe(201);
  const body = (await draftResponse.json()) as { draft: { id: string } };
  return body.draft.id;
}

describe("ME3 Worker auth", () => {
  it("normalizes only managed and self_hosted deployment modes", () => {
    expect(normalizeMe3DeploymentMode(" MANAGED ")).toBe("managed");
    expect(normalizeMe3DeploymentMode("self_hosted")).toBe("self_hosted");
    expect(normalizeMe3DeploymentMode("hosted")).toBeNull();
    expect(normalizeMe3DeploymentMode(undefined)).toBeNull();
    expect(allowsAgentChatRawModelSelection({ ME3_DEPLOYMENT_MODE: "self_hosted" })).toBe(
      true,
    );
    expect(allowsAgentChatRawModelSelection({ ME3_DEPLOYMENT_MODE: "managed" })).toBe(
      false,
    );
    expect(
      allowsAgentChatRawModelSelection({
        ME3_DEPLOYMENT_MODE: "invalid",
        ME3_AI_RAW_MODEL_SELECTION_ENABLED: "true",
      }),
    ).toBe(false);
  });

  it("exposes the canonical deployment mode and fails closed on invalid config", async () => {
    const managedEnv = createEnv();
    managedEnv.ME3_DEPLOYMENT_MODE = " MANAGED ";
    const managedResponse = await app.fetch(
      new Request("http://localhost/api/config"),
      managedEnv,
    );
    expect(managedResponse.status).toBe(200);
    await expect(managedResponse.json()).resolves.toMatchObject({ deploymentMode: "managed" });

    const invalidEnv = createEnv();
    invalidEnv.ME3_DEPLOYMENT_MODE = "hosted";
    const invalidResponse = await app.fetch(
      new Request("http://localhost/api/config"),
      invalidEnv,
    );
    const invalidBody = (await invalidResponse.json()) as Record<string, unknown>;
    expect(invalidResponse.status).toBe(503);
    expect(invalidBody).toEqual({
      ok: false,
      code: "INVALID_DEPLOYMENT_MODE",
      error: "ME3 deployment mode must be managed or self_hosted",
    });
  });

  it("exposes Core version metadata", async () => {
    const env = createEnv();

    const response = await app.fetch(new Request("http://localhost/api/core/version"), env);
    const body = (await response.json()) as {
      version: string;
      releaseChannel: string;
      updateManifestUrl: string;
    };

    expect(response.status).toBe(200);
    expect(body.version).toBe(ME3_CORE_VERSION);
    expect(body.releaseChannel).toBe("stable");
    expect(body.updateManifestUrl).toContain("updates/stable.json");
  });

  it("adds security and no-store headers to API responses", async () => {
    const env = createEnv();

    const response = await app.fetch(new Request("https://example.com/api/config"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("redirects non-local HTTP requests to HTTPS", async () => {
    const env = createEnv();

    const response = await app.fetch(new Request("http://kieranbutler.com/account?tab=security"), env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://kieranbutler.com/account?tab=security");
  });

  it("does not redirect local HTTP requests", async () => {
    const env = createEnv();

    const response = await app.fetch(new Request("http://localhost/api/config"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("serves the published site profile at the root me.json discovery path", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";

    const response = await app.fetch(new Request("https://kieranbutler.com/me.json"), env);
    const body = (await response.json()) as {
      version: string;
      kind: string;
      name: string;
      handle: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(body.version).toBe("0.3");
    expect(body.kind).toBe("person");
    expect(body.name).toBe("Booking Owner");
    expect(body.handle).toBe("owner");
  });

  it("serves each published site from its stable fallback path", async () => {
    const env = createEnv();
    env.CORE_WEB_ORIGIN = "https://owner.me3.app";
    env.sites.push({
      id: "site-studio",
      user_id: "owner",
      username: "studio",
      site_type: "profile",
      site_role: "organization",
      template_id: "me3",
      custom_domain: null,
      custom_domain_status: null,
      custom_domain_cf_id: null,
      created_at: "2026-08-24T09:00:00Z",
      updated_at: "2026-08-24T09:00:00Z",
      published_at: "2026-08-24T10:00:00Z",
    });
    addSiteFileText(
      env,
      "site-studio",
      "public/index.html",
      "<!doctype html><h1>Studio site</h1>",
      "text/html; charset=utf-8",
    );

    const response = await app.fetch(
      new Request("https://owner.me3.app/site/studio/"),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Studio site");
  });

  it("routes exact custom hosts and rejects discovery on unknown hosts", async () => {
    const env = createEnv();
    env.CORE_WEB_ORIGIN = "https://owner.me3.app";
    env.sites.push({
      id: "site-studio",
      user_id: "owner",
      username: "studio",
      site_type: "profile",
      site_role: "organization",
      template_id: "me3",
      custom_domain: "studio.example.com",
      custom_domain_status: "active",
      custom_domain_cf_id: null,
      created_at: "2026-08-24T09:00:00Z",
      updated_at: "2026-08-24T09:00:00Z",
      published_at: "2026-08-24T10:00:00Z",
    });
    addSiteFileText(
      env,
      "site-studio",
      "public/index.html",
      "<!doctype html><h1>Exact studio</h1>",
      "text/html; charset=utf-8",
    );

    const exact = await app.fetch(
      new Request("https://studio.example.com/"),
      env,
    );
    const unknown = await app.fetch(
      new Request("https://unknown.example.com/me.json"),
      env,
    );
    const unknownFallbackPath = await app.fetch(
      new Request("https://unknown.example.com/site/studio/"),
      env,
    );
    const privateAuth = await app.fetch(
      new Request("https://studio.example.com/api/auth/session"),
      env,
    );

    expect(exact.status).toBe(200);
    expect(await exact.text()).toContain("Exact studio");
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({
      error: "Site not configured",
    });
    expect(unknownFallbackPath.status).toBe(404);
    expect(await unknownFallbackPath.text()).not.toContain("Exact studio");
    expect(privateAuth.status).toBe(404);
  });

  it("revalidates published HTML and revokes cached access immediately on unpublish", async () => {
    const env = createEnv();
    addBookableSite(env);
    addSiteFileText(env, "site-booking", "public/index.html", "<html>First</html>", "text/html");
    env.ME3_SITE_USERNAME = "owner";
    const first = await app.fetch(new Request("https://kieranbutler.com/"), env);
    const etag = first.headers.get("ETag")!;
    expect(first.headers.get("Link")).toContain('</me.json>');
    const conditional = () => new Request("https://kieranbutler.com/", { headers: { "If-None-Match": etag } });
    expect((await app.fetch(conditional(), env)).status).toBe(304);
    const preview = await app.fetch(new Request("https://me3.example/preview/owner/"), env);
    expect(preview.headers.get("Cache-Control")).toBe("no-store");
    expect(preview.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    env.sites.find(site => site.id === "site-booking")!.published_at = null;
    const revoked = await app.fetch(conditional(), env);
    expect(revoked.status).toBe(404);
    expect(revoked.headers.get("Cache-Control")).toBe("no-store");
  });

  it("revalidates mutable public site images while adding safe response headers", async () => {
    const env = createEnv();
    addBookableSite(env);
    addSiteFileText(env, "site-booking", "public/files/avatar.png", "PNG", "image/png");
    env.ME3_SITE_USERNAME = "owner";

    const response = await app.fetch(new Request("https://kieranbutler.com/files/avatar.png"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBeNull();
  });

  it("serves an existing png when published html still asks for a webp page image", async () => {
    const env = createEnv();
    addBookableSite(env);
    addSiteFileText(env, "site-booking", "public/files/about-1.png", "PNG", "image/png");
    env.ME3_SITE_USERNAME = "owner";

    const response = await app.fetch(new Request("https://kieranbutler.com/files/about-1.webp"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("PNG");
  });

  it("canonicalizes /me so relative site files resolve under the Worker public prefix", async () => {
    const env = createEnv();
    addBookableSite(env);
    addSiteFileText(
      env,
      "site-booking",
      "public/index.html",
      '<!doctype html><img src="./files/avatar.png" alt="Owner">',
      "text/html; charset=utf-8",
    );
    addSiteFileText(env, "site-booking", "public/files/avatar.png", "PNG", "image/png");
    env.ME3_SITE_USERNAME = "owner";

    const redirect = await app.fetch(
      new Request("https://kierans-me3.example.workers.dev/me?ref=share"),
      env,
    );
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("Location")).toBe(
      "https://kierans-me3.example.workers.dev/me/?ref=share",
    );

    const pageUrl = "https://kierans-me3.example.workers.dev/me/";
    const page = await app.fetch(new Request(pageUrl), env);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('src="./files/avatar.png"');

    const assetUrl = new URL("./files/avatar.png", pageUrl).toString();
    const asset = await app.fetch(new Request(assetUrl), env);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toBe("image/png");
  });

  it("serves the published site profile at the well-known me.json discovery path", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";

    const response = await app.fetch(
      new Request("https://kieranbutler.com/.well-known/me.json"),
      env,
    );
    const body = (await response.json()) as { name: string; handle: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.name).toBe("Booking Owner");
    expect(body.handle).toBe("owner");
  });

  it("serves security.txt from public site hosts instead of the generated site", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";

    const response = await app.fetch(
      new Request("https://kieranbutler.com/.well-known/security.txt"),
      env,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("Contact: https://kieranbutler.com/account");
    expect(body).toContain("Canonical: https://kieranbutler.com/.well-known/security.txt");
    expect(body).not.toContain("<!doctype html>");
  });

  it("falls back to a Core owner me.json before a site is published", async () => {
    const env = createEnv();
    env.ME3_SITE_USERNAME = "owner";
    env.owner = {
      id: "owner",
      email: "owner@example.com",
      name: "ME3 Owner",
      username: "owner",
      bio: "Core identity",
      avatar_url: null,
      timezone: "Europe/Dublin",
      locale: null,
      password_hash: null,
    };
    env.sites.push({
      id: "site-draft",
      user_id: "owner",
      username: "owner",
      site_type: "profile",
      site_role: "profile",
      template_id: "me3",
      custom_domain: null,
      custom_domain_status: null,
      custom_domain_cf_id: null,
      created_at: "2026-06-03T10:00:00Z",
      updated_at: "2026-06-03T10:00:00Z",
      published_at: null,
    });

    const response = await app.fetch(new Request("https://me3.example/me.json"), env);
    const body = (await response.json()) as {
      version: string;
      kind: string;
      name: string;
      handle: string;
    };

    expect(response.status).toBe(200);
    expect(body.version).toBe("0.3");
    expect(body.kind).toBe("person");
    expect(body.name).toBe("ME3 Owner");
    expect(body.handle).toBe("owner");
  });

  it("serves a public-site 404 on the root domain inferred from the admin host", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";
    env.CORE_WEB_ORIGIN = "https://me3.kieranbutler.com";

    const response = await app.fetch(
      new Request("https://kieranbutler.com/somenonexistentpage"),
      env,
    );
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("Page not found");
    expect(html).toContain("Return home");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("ThemeToggle");
  });

  it("does not expose the login page on the public root domain", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";
    env.CORE_WEB_ORIGIN = "https://me3.kieranbutler.com";

    const response = await app.fetch(new Request("https://kieranbutler.com/login"), env);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("Page not found");
    expect(html).not.toContain("Sign in with ME3.app");
  });

  it("does not expose the login page on a root custom domain without admin env vars", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";
    env.CORE_WEB_ORIGIN = undefined;

    const response = await app.fetch(new Request("https://kieranbutler.com/login"), env);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("Page not found");
    expect(html).not.toContain("Sign in with ME3.app");
  });

  it("connects a managed public domain through ME3 Cloud and keeps login on me3.app", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.ME3_DEPLOYMENT_MODE = "managed";
    env.ME3_MANAGED_INSTALLATION_ID = "mi-1234567890abcdef";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    env.managedRuntimeInstallationId = env.ME3_MANAGED_INSTALLATION_ID;
    addBookableSite(env);
    env.installSecrets.set(
      "ME3_CORE_INSTALL_ID",
      "core_11111111-1111-4111-8111-111111111111",
    );
    env.installSecrets.set("ME3_CLOUD_CORE_TOKEN", "core-update-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        connected: true,
        domain: "www.example.com",
        status: "pending",
        ssl_status: "pending_validation",
        verification_records: [
          {
            type: "cname",
            name: "www.example.com",
            value: "sites.me3.app",
          },
        ],
      }),
    );

    try {
      const response = await app.fetch(
        new Request("https://tester.me3.app/api/domains/owner", {
          method: "POST",
          headers: {
            Cookie: session,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ domain: "www.example.com" }),
        }),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        connected: true,
        domain: "www.example.com",
        status: "pending",
      });
      expect(env.sites[0]).toMatchObject({
        custom_domain: "www.example.com",
        custom_domain_status: "pending",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.me3.example/v1/installs/core_11111111-1111-4111-8111-111111111111/sites/site-booking/domain",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-ME3-Core-Update-Token": "core-update-token",
            "X-ME3-Core-Site-ID": "site-booking",
            "X-ME3-Core-Site-Username": "owner",
            "X-ME3-Core-Site-Role": "profile",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("does not attach one canonical domain to two sites", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addBookableSite(env);
    env.sites[0].custom_domain = "shared.example.com";
    env.sites[0].custom_domain_status = "active";
    env.sites.push({
      id: "site-studio",
      user_id: "owner",
      username: "studio",
      site_type: "profile",
      site_role: "organization",
      template_id: "me3",
      custom_domain: null,
      custom_domain_status: null,
      custom_domain_cf_id: null,
      created_at: "2026-08-24T09:00:00Z",
      updated_at: "2026-08-24T09:00:00Z",
      published_at: "2026-08-24T10:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/domains/studio", {
        method: "POST",
        headers: {
          Cookie: session,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ domain: "shared.example.com" }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This domain is already connected to another site.",
    });
    expect(env.sites[1].custom_domain).toBeNull();
  });

  it("blocks owner auth endpoints on the public root domain", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";
    env.CORE_WEB_ORIGIN = "https://me3.kieranbutler.com";

    const response = await app.fetch(
      new Request("https://kieranbutler.com/api/auth/login", { method: "POST" }),
      env,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not found");
  });

  it("allows owner auth endpoints through loopback api aliases during local development", async () => {
    const env = createEnv();
    addBookableSite(env);
    env.ME3_SITE_USERNAME = "owner";
    env.CORE_WEB_ORIGIN = "http://localhost:4000";
    env.CORE_API_ORIGIN = "http://localhost:8787";

    const response = await app.fetch(
      new Request("http://127.0.0.1:8787/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          password: "wrong-password",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Invalid email or password");
  });

  it("bootstraps the owner and sets an httpOnly session cookie", async () => {
    const env = createEnv();

    const response = await bootstrap(env);
    const body = (await response.json()) as { ok: boolean; owner: OwnerProfile };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.owner.email).toBe("owner@example.com");
    expect(env.owner?.password_hash?.split("$")[1]).toBe("100000");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("me3_core_session=");
  });

  it("generates an install encryption key during bootstrap when no env key is provided", async () => {
    const env = createEnv();
    env.TOKEN_ENCRYPTION_KEY = undefined;

    const response = await bootstrap(env);
    const configResponse = await app.fetch(new Request("http://localhost/api/config"), env);
    const config = (await configResponse.json()) as { setupRequired: string[] };

    expect(response.status).toBe(200);
    expect(env.installSecrets.get("TOKEN_ENCRYPTION_KEY")).toMatch(/^[a-f0-9]{64}$/);
    expect(config.setupRequired).not.toContain("TOKEN_ENCRYPTION_KEY");
  });

  it("generates a persistent owner session secret when no env JWT secret is provided", async () => {
    const env = createEnv();
    env.JWT_SECRET = undefined;

    const response = await bootstrap(env);
    const session = cookieHeader(response);
    const meResponse = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { Cookie: session },
      }),
      env,
    );
    const configResponse = await app.fetch(new Request("http://localhost/api/config"), env);
    const config = (await configResponse.json()) as { setupRequired: string[] };

    expect(response.status).toBe(200);
    expect(meResponse.status).toBe(200);
    expect(env.installSecrets.get("JWT_SECRET")).toMatch(/^[a-f0-9]{64}$/);
    expect(config.setupRequired).not.toContain("JWT_SECRET");
  });

  it("reports whether owner password auth is configured", async () => {
    const env = createEnv();

    const before = await app.fetch(new Request("http://localhost/api/config"), env);
    expect(await before.json()).toMatchObject({
      ownerAuthConfigured: false,
      transferReadiness: {
        ready: false,
        blockers: ["LOCAL_PASSWORD_REQUIRED"],
      },
    });

    await bootstrap(env);

    const after = await app.fetch(new Request("http://localhost/api/config"), env);
    expect(await after.json()).toMatchObject({
      ownerAuthConfigured: true,
      transferReadiness: { ready: true, blockers: [] },
    });
  });

  it("lets an authenticated managed owner establish verified local login", async () => {
    const env = createEnv();
    env.ME3_DEPLOYMENT_MODE = "managed";
    const session = cookieHeader(await bootstrap(env));
    env.SETUP_PASSWORD = "operator-secret-must-not-return";
    env.owner!.password_hash = null;
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "managed-owner");
    const localPassword = "owner-local-password";

    const response = await app.fetch(
      new Request("http://localhost/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          password: localPassword,
          passwordConfirmation: localPassword,
        }),
      }),
      env,
    );
    const responseText = await response.text();
    const body = JSON.parse(responseText) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      localPasswordConfigured: true,
      transferReadiness: { ready: true, blockers: [] },
    });
    expect(responseText).not.toContain(localPassword);
    expect(responseText).not.toContain(env.SETUP_PASSWORD);
    expect(responseText).not.toContain(env.owner!.password_hash!);

    const loginResponse = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.com",
          password: localPassword,
        }),
      }),
      env,
    );
    expect(loginResponse.status).toBe(200);

    const configResponse = await app.fetch(new Request("http://localhost/api/config"), env);
    await expect(configResponse.json()).resolves.toMatchObject({
      deploymentMode: "managed",
      ownerPasswordAuthConfigured: true,
      transferReadiness: { ready: true, blockers: [] },
    });

    const connectionsResponse = await app.fetch(
      new Request("http://localhost/api/account/app-connections", {
        headers: { Cookie: session },
      }),
      env,
    );
    const connectionsText = await connectionsResponse.text();
    expect(JSON.parse(connectionsText)).toMatchObject({
      localAccess: {
        passwordConfigured: true,
        transferReadiness: { ready: true, blockers: [] },
      },
    });
    expect(connectionsText).not.toContain(localPassword);
    expect(connectionsText).not.toContain(env.owner!.password_hash!);
  });

  it("requires owner authentication and matching password confirmation", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.owner!.password_hash = null;

    const unauthorizedResponse = await app.fetch(
      new Request("http://localhost/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "new-owner-password",
          passwordConfirmation: "new-owner-password",
        }),
      }),
      env,
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(env.owner!.password_hash).toBeNull();

    const mismatchResponse = await app.fetch(
      new Request("http://localhost/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          password: "new-owner-password",
          passwordConfirmation: "different-password",
        }),
      }),
      env,
    );
    expect(mismatchResponse.status).toBe(400);
    expect(env.owner!.password_hash).toBeNull();
  });

  it("rate limits authenticated local password changes without storing password material", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.owner!.password_hash = null;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.fetch(
        new Request("http://localhost/api/account/password", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({
            password: "new-owner-password",
            passwordConfirmation: "different-password",
          }),
        }),
        env,
      );
      expect(response.status).toBe(400);
    }

    const blockedResponse = await app.fetch(
      new Request("http://localhost/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          password: "new-owner-password",
          passwordConfirmation: "different-password",
        }),
      }),
      env,
    );
    expect(blockedResponse.status).toBe(429);
    expect(JSON.stringify([...env.authRateLimits.entries()])).not.toContain(
      "new-owner-password",
    );
    expect(JSON.stringify([...env.authRateLimits.entries()])).not.toContain(
      "different-password",
    );
  });

  it("does not treat a placeholder owner row as configured auth", async () => {
    const env = createEnv();
    env.owner = {
      id: "owner",
      email: null,
      name: null,
      username: "owner",
      bio: null,
      avatar_url: null,
      timezone: null,
      locale: null,
      password_hash: null,
    };

    const response = await app.fetch(new Request("http://localhost/api/config"), env);
    const config = (await response.json()) as {
      ownerAuthConfigured: boolean;
      ownerPasswordAuthConfigured: boolean;
      ownerMe3AuthConfigured: boolean;
    };

    expect(config).toMatchObject({
      ownerAuthConfigured: false,
      ownerPasswordAuthConfigured: false,
      ownerMe3AuthConfigured: false,
    });
  });

  it("starts ME3 Cloud install claim for unclaimed installs", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";

    const response = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: "/account" }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; url: string; state: string };
    const claimUrl = new URL(body.url);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state).toMatch(/[0-9a-f-]{36}/);
    expect(claimUrl.searchParams.get("install_id")).toMatch(
      /^core_[0-9a-f-]{36}$/,
    );
    expect(env.installSecrets.get("ME3_CORE_INSTALL_ID")).toBe(
      claimUrl.searchParams.get("install_id"),
    );
    expect(claimUrl.origin).toBe("https://me3.example");
    expect(claimUrl.pathname).toBe("/core/claim");
    expect(claimUrl.searchParams.get("core_origin")).toBe("http://localhost:4000");
    expect(claimUrl.searchParams.get("callback_url")).toBe(
      "http://localhost:8787/api/auth/me3/callback",
    );
    expect(claimUrl.searchParams.get("redirect")).toBe("/account");
  });

  it("rate limits ME3 Cloud install claim starts by client", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    try {
      const env = createEnv();
      env.ME3_CLOUD_ORIGIN = "https://me3.example";
      const init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify({ redirect: "/account" }),
      };

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await app.fetch(
          new Request("https://core.example/api/auth/me3/start", init),
          env,
        );
        expect(response.status).toBe(200);
      }

      const blockedResponse = await app.fetch(
        new Request("https://core.example/api/auth/me3/start", init),
        env,
      );
      const blockedBody = (await blockedResponse.json()) as {
        error: string;
        retryAfterSeconds: number;
      };

      expect(blockedResponse.status).toBe(429);
      expect(blockedResponse.headers.get("Retry-After")).toBe("600");
      expect(blockedBody.error).toBe("Too many attempts. Try again later.");
      expect(blockedBody.retryAfterSeconds).toBe(600);
      expect(env.me3ClaimStates).toHaveLength(20);
      expect(env.authRateLimits).toHaveLength(1);
      expect(JSON.stringify(env.authRateLimits)).not.toContain("203.0.113.10");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the same stable install id across claim starts on different URLs", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.CORE_WEB_ORIGIN = undefined;

    const workerResponse = await app.fetch(
      new Request("https://kierans-me3.kieranbutler.workers.dev/api/auth/me3/start", {
        method: "POST",
      }),
      env,
    );
    const customResponse = await app.fetch(
      new Request("https://me3.kieranbutler.com/api/auth/me3/start", {
        method: "POST",
      }),
      env,
    );
    const workerUrl = new URL(((await workerResponse.json()) as { url: string }).url);
    const customUrl = new URL(((await customResponse.json()) as { url: string }).url);

    expect(workerUrl.searchParams.get("install_id")).toMatch(
      /^core_[0-9a-f-]{36}$/,
    );
    expect(customUrl.searchParams.get("install_id")).toBe(
      workerUrl.searchParams.get("install_id"),
    );
    expect(env.me3ClaimStates).toHaveLength(2);
    expect(env.me3ClaimStates[0].install_id).toBe(
      workerUrl.searchParams.get("install_id"),
    );
    expect(env.me3ClaimStates[1].install_id).toBe(
      workerUrl.searchParams.get("install_id"),
    );
  });

  it("uses the explicit admin host for ME3 claim callbacks when no API host is configured", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CUSTOM_DOMAIN = "kieranbutler.com";
    env.ME3_SITE_HOST = "kieranbutler.com";
    env.ME3_ADMIN_HOST = "me3.kieranbutler.com";
    env.CORE_WEB_ORIGIN = "https://me3.kieranbutler.com";
    env.CORE_API_ORIGIN = undefined;
    env.ME3_API_HOST = undefined;

    const response = await app.fetch(
      new Request("https://me3.kieranbutler.com/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: "/account" }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; url: string };
    const claimUrl = new URL(body.url);

    expect(response.status).toBe(200);
    expect(claimUrl.searchParams.get("core_origin")).toBe(
      "https://me3.kieranbutler.com",
    );
    expect(claimUrl.searchParams.get("callback_url")).toBe(
      "https://me3.kieranbutler.com/api/auth/me3/callback",
    );
  });

  it("uses the inferred admin host for ME3 claim callbacks from a single custom-domain var", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CUSTOM_DOMAIN = "kieranbutler.com";
    env.CORE_WEB_ORIGIN = undefined;
    env.CORE_API_ORIGIN = undefined;
    env.ME3_ADMIN_HOST = undefined;
    env.ME3_API_HOST = undefined;

    const response = await app.fetch(
      new Request("https://me3.kieranbutler.com/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: "/account" }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; url: string };
    const claimUrl = new URL(body.url);

    expect(response.status).toBe(200);
    expect(claimUrl.searchParams.get("core_origin")).toBe(
      "https://me3.kieranbutler.com",
    );
    expect(claimUrl.searchParams.get("callback_url")).toBe(
      "https://me3.kieranbutler.com/api/auth/me3/callback",
    );
  });

  it("accepts a verified ME3 Cloud install claim callback", async () => {
    const env = createEnv();
    env.TOKEN_ENCRYPTION_KEY = undefined;
    env.ME3_DEPLOYMENT_MODE = "managed";
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";

    const startResponse = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: "/account" }),
      }),
      env,
    );
    const startBody = (await startResponse.json()) as { state: string };
    const installId = env.me3ClaimStates[0].install_id || "";
    const signedClaim = await createSignedMe3ClaimToken({
      issuer: "https://api.me3.example",
      state: startBody.state,
      installId,
      coreOrigin: "http://localhost:4000",
      callbackUrl: "http://localhost:8787/api/auth/me3/callback",
      email: "owner@example.com",
      managedEmailAddress: "my_name@me3.app",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [signedClaim.publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost:8787/api/auth/me3/callback?state=${encodeURIComponent(
          startBody.state,
        )}&claim_token=${encodeURIComponent(signedClaim.token)}`,
      ),
      env,
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("/account");
    expect(cookieHeader(callbackResponse)).toMatch(/^me3_core_session=/);
    expect(env.owner).toMatchObject({
      id: "owner",
      email: "owner@example.com",
      name: "Owner",
      username: "kieran",
      password_hash: null,
    });
    expect(env.installSecrets.get("ME3_CLOUD_OWNER_ID")).toBe("user123");
    expect(env.installSecrets.get("ME3_CLOUD_CORE_TOKEN")).toBe("core-update-token-123");
    expect(env.installSecrets.get("TOKEN_ENCRYPTION_KEY")).toMatch(/^[a-f0-9]{64}$/);
    expect(env.me3ClaimStates).toHaveLength(0);
    expect(env.mailbox).toMatchObject({
      user_id: "owner",
      alias_local_part: "my_name",
      status: "active",
      forwarding_enabled: 0,
    });

    const configResponse = await app.fetch(
      new Request("http://localhost:8787/api/config"),
      env,
    );
    await expect(configResponse.json()).resolves.toMatchObject({
      deploymentMode: "managed",
      managedEmailAddress: "my_name@me3.app",
    });

    const mailboxUpdate = await app.fetch(
      new Request("http://localhost:8787/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader(callbackResponse),
        },
        body: JSON.stringify({
          aliasLocalPart: "changed-name",
          forwardingEnabled: false,
        }),
      }),
      env,
    );
    expect(mailboxUpdate.status).toBe(409);
    expect(env.mailbox?.alias_local_part).toBe("my_name");

    fetchMock.mockRestore();
  });

  it("rejects a verified ME3 Cloud claim from a different linked ME3 user", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    env.owner = {
      id: "owner",
      email: "owner@example.com",
      name: "Owner",
      username: "kieran",
      bio: null,
      avatar_url: null,
      timezone: null,
      locale: null,
      assistant_name: null,
      password_hash: null,
    };
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    env.installSecrets.set("ME3_CLOUD_CORE_TOKEN", "core-update-token-123");

    const startResponse = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: "/account" }),
      }),
      env,
    );
    const startBody = (await startResponse.json()) as { state: string };
    const installId = env.me3ClaimStates[0].install_id || "";
    const signedClaim = await createSignedMe3ClaimToken({
      issuer: "https://api.me3.example",
      userId: "user456",
      state: startBody.state,
      installId,
      coreOrigin: "http://localhost:4000",
      callbackUrl: "http://localhost:8787/api/auth/me3/callback",
      email: "attacker@example.com",
      handle: "attacker",
      coreUpdateToken: "attacker-core-update-token",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [signedClaim.publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost:8787/api/auth/me3/callback?state=${encodeURIComponent(
          startBody.state,
        )}&claim_token=${encodeURIComponent(signedClaim.token)}`,
      ),
      env,
    );

    expect(startResponse.status).toBe(200);
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toContain(
      "me3_claim_error=claim_owner_mismatch",
    );
    expect(callbackResponse.headers.get("set-cookie")).toBeNull();
    expect(env.owner).toMatchObject({
      email: "owner@example.com",
      name: "Owner",
      username: "kieran",
      password_hash: null,
    });
    expect(env.installSecrets.get("ME3_CLOUD_OWNER_ID")).toBe("user123");
    expect(env.installSecrets.get("ME3_CLOUD_CORE_TOKEN")).toBe("core-update-token-123");
    expect(env.me3ClaimStates).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("uses the ME3 Cloud display name when claiming an install", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";

    const startResponse = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
      env,
    );
    const startBody = (await startResponse.json()) as { state: string };
    const signedClaim = await createSignedMe3ClaimToken({
      issuer: "https://api.me3.example",
      state: startBody.state,
      installId: env.me3ClaimStates[0].install_id || "",
      coreOrigin: "http://localhost:4000",
      callbackUrl: "http://localhost:8787/api/auth/me3/callback",
      email: "kieranbutler22@gmail.com",
      name: "Kieran Butler",
      handle: "kieranbutler22",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [signedClaim.publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost:8787/api/auth/me3/callback?state=${encodeURIComponent(
          startBody.state,
        )}&claim_token=${encodeURIComponent(signedClaim.token)}`,
      ),
      env,
    );

    expect(callbackResponse.status).toBe(302);
    expect(env.owner).toMatchObject({
      email: "kieranbutler22@gmail.com",
      name: "Kieran Butler",
      username: "kieranbutler22",
    });

    fetchMock.mockRestore();
  });

  it("humanizes the email local part when a ME3 Cloud claim has no display name", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";

    const startResponse = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
      env,
    );
    const startBody = (await startResponse.json()) as { state: string };
    const signedClaim = await createSignedMe3ClaimToken({
      issuer: "https://api.me3.example",
      state: startBody.state,
      installId: env.me3ClaimStates[0].install_id || "",
      coreOrigin: "http://localhost:4000",
      callbackUrl: "http://localhost:8787/api/auth/me3/callback",
      email: "kieranbutler22@gmail.com",
      handle: "kieranbutler22",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [signedClaim.publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost:8787/api/auth/me3/callback?state=${encodeURIComponent(
          startBody.state,
        )}&claim_token=${encodeURIComponent(signedClaim.token)}`,
      ),
      env,
    );

    expect(callbackResponse.status).toBe(302);
    expect(env.owner).toMatchObject({
      email: "kieranbutler22@gmail.com",
      name: "Kieranbutler",
      username: "kieranbutler22",
    });

    fetchMock.mockRestore();
  });

  it("rejects ME3 Cloud install claim callbacks without a valid handle", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";

    const startResponse = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: "/account" }),
      }),
      env,
    );
    const startBody = (await startResponse.json()) as { state: string };
    const installId = env.me3ClaimStates[0].install_id || "";
    const signedClaim = await createSignedMe3ClaimToken({
      issuer: "https://api.me3.example",
      state: startBody.state,
      installId,
      coreOrigin: "http://localhost:4000",
      callbackUrl: "http://localhost:8787/api/auth/me3/callback",
      email: "owner@example.com",
      handle: null,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [signedClaim.publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost:8787/api/auth/me3/callback?state=${encodeURIComponent(
          startBody.state,
        )}&claim_token=${encodeURIComponent(signedClaim.token)}`,
      ),
      env,
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toContain(
      "me3_claim_error=claim_mismatch",
    );
    expect(env.owner).toBeNull();

    fetchMock.mockRestore();
  });

  it("rejects ME3 Cloud install claim callbacks for a different install id", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";

    const startResponse = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: "/account" }),
      }),
      env,
    );
    const startBody = (await startResponse.json()) as { state: string };
    const signedClaim = await createSignedMe3ClaimToken({
      issuer: "https://api.me3.example",
      state: startBody.state,
      installId: "core_22222222-2222-4222-8222-222222222222",
      coreOrigin: "http://localhost:4000",
      callbackUrl: "http://localhost:8787/api/auth/me3/callback",
      email: "owner@example.com",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [signedClaim.publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost:8787/api/auth/me3/callback?state=${encodeURIComponent(
          startBody.state,
        )}&claim_token=${encodeURIComponent(signedClaim.token)}`,
      ),
      env,
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toContain(
      "me3_claim_error=claim_mismatch",
    );
    expect(env.owner).toBeNull();
    expect(env.me3ClaimStates).toHaveLength(1);

    fetchMock.mockRestore();
  });

  it("lets a password owner start a protected ME3 app connection link", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    const session = cookieHeader(await bootstrap(env));

    const publicStartResponse = await app.fetch(
      new Request("https://core.example/api/auth/me3/start", {
        method: "POST",
      }),
      env,
    );
    expect(publicStartResponse.status).toBe(409);

    const response = await app.fetch(
      new Request("https://core.example/api/account/app-connections/me3/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ redirect: "/account?section=connections" }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; url: string; state: string };
    const claimUrl = new URL(body.url);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(claimUrl.origin).toBe("https://me3.example");
    expect(claimUrl.searchParams.get("redirect")).toBe("/account?section=connections");
    expect(env.me3ClaimStates).toHaveLength(1);
  });

  it("links ME3 app auth without removing the existing password login", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    const session = cookieHeader(await bootstrap(env));
    const passwordHash = env.owner?.password_hash;

    const startResponse = await app.fetch(
      new Request("https://core.example/api/account/app-connections/me3/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ redirect: "/account?section=connections" }),
      }),
      env,
    );
    const startBody = (await startResponse.json()) as { state: string };
    const installId = env.me3ClaimStates[0].install_id || "";
    const signedClaim = await createSignedMe3ClaimToken({
      issuer: "https://api.me3.example",
      state: startBody.state,
      installId,
      coreOrigin: "http://localhost:4000",
      callbackUrl: "http://localhost:8787/api/auth/me3/callback",
      email: "owner@example.com",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [signedClaim.publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost:8787/api/auth/me3/callback?state=${encodeURIComponent(
          startBody.state,
        )}&claim_token=${encodeURIComponent(signedClaim.token)}`,
      ),
      env,
    );
    const configResponse = await app.fetch(new Request("http://localhost/api/config"), env);
    const config = (await configResponse.json()) as {
      ownerPasswordAuthConfigured: boolean;
      ownerMe3AuthConfigured: boolean;
    };

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("/account?section=connections");
    expect(env.owner?.password_hash).toBe(passwordHash);
    expect(env.installSecrets.get("ME3_CLOUD_OWNER_ID")).toBe("user123");
    expect(env.installSecrets.get("ME3_CLOUD_CORE_TOKEN")).toBe("core-update-token-123");
    expect(config).toMatchObject({
      ownerPasswordAuthConfigured: true,
      ownerMe3AuthConfigured: true,
    });

    fetchMock.mockRestore();
  });

  it("exposes linked ME3 app connection metadata for the Core install", async () => {
    const env = createEnv();
    env.ME3_CLOUD_ORIGIN = "https://me3.example";
    const session = cookieHeader(await bootstrap(env));
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    env.installSecrets.set("ME3_CLOUD_CORE_TOKEN", "core-update-token-123");
    env.installSecrets.set(
      "ME3_CORE_INSTALL_ID",
      "core_11111111-1111-4111-8111-111111111111",
    );
    env.installSecrets.set("ME3_CLOUD_CORE_TOKEN", "core-update-token-123");

    const response = await app.fetch(
      new Request("http://localhost/api/account/app-connections", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      me3: {
        connected: boolean;
        origin: string;
        disconnectAvailable: boolean;
        installId: string;
        coreOrigin: string;
        coreApiOrigin: string;
        meJsonUrl: string;
        meJsonSource: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.me3).toEqual({
      connected: true,
      origin: "https://me3.example",
      disconnectAvailable: true,
      installId: "core_11111111-1111-4111-8111-111111111111",
      coreOrigin: "http://localhost:4000",
      coreApiOrigin: "http://localhost:8787",
      meJsonUrl: "http://localhost:4000/.well-known/me.json",
      meJsonSource: "core_install",
    });
  });

  it("reports GitHub updater setup needs ME3.app before calling Cloud", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await app.fetch(
      new Request("http://localhost/api/core/github/status", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      me3AppConnected: boolean;
      github: { connected: boolean };
      unavailableReason: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.me3AppConnected).toBe(false);
    expect(body.github.connected).toBe(false);
    expect(body.unavailableReason).toBe("Connect ME3.app first.");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("proxies GitHub updater install start to the ME3 Cloud broker", async () => {
    const env = createEnv();
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    const session = cookieHeader(await bootstrap(env));
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    env.installSecrets.set(
      "ME3_CORE_INSTALL_ID",
      "core_11111111-1111-4111-8111-111111111111",
    );
    env.installSecrets.set("ME3_CLOUD_CORE_TOKEN", "core-update-token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          url: "https://github.com/apps/me3-updater/installations/new",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await app.fetch(
      new Request("https://core.example/api/core/github/install/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ redirect: "/account?section=connections" }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; url: string };
    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    const requestBody = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://github.com/apps/me3-updater/installations/new");
    expect(url).toBe("https://api.me3.example/api/github/install/start");
    expect(headers.get("X-ME3-Core-Owner-ID")).toBe("user123");
    expect(headers.get("X-ME3-Core-Install-ID")).toBe(
      "core_11111111-1111-4111-8111-111111111111",
    );
    expect(headers.get("X-ME3-Core-Update-Token")).toBe("core-update-token-123");
    expect(requestBody).toMatchObject({
      coreInstallId: "core_11111111-1111-4111-8111-111111111111",
      coreOwnerId: "user123",
      coreOrigin: "http://localhost:4000",
      coreApiOrigin: "http://localhost:8787",
      redirect: "/account?section=connections",
    });

    fetchMock.mockRestore();
  });

  it("proxies GitHub updater install completion to the ME3 Cloud broker", async () => {
    const env = createEnv();
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    const session = cookieHeader(await bootstrap(env));
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    env.installSecrets.set(
      "ME3_CORE_INSTALL_ID",
      "core_11111111-1111-4111-8111-111111111111",
    );
    env.installSecrets.set("ME3_CLOUD_CORE_TOKEN", "core-update-token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          connected: true,
          repositoryOwner: "kieranbutler",
          repositoryName: "my-me3",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await app.fetch(
      new Request("https://core.example/api/core/github/install/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          installationId: "12345678",
          setupAction: "install",
          repositorySelection: "selected",
          state: "state-123",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; connected: boolean };
    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    const requestBody = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      unknown
    >;

    expect(response.status).toBe(200);
    expect(body.connected).toBe(true);
    expect(url).toBe("https://api.me3.example/api/github/install/complete");
    expect(headers.get("X-ME3-Core-Owner-ID")).toBe("user123");
    expect(headers.get("X-ME3-Core-Install-ID")).toBe(
      "core_11111111-1111-4111-8111-111111111111",
    );
    expect(headers.get("X-ME3-Core-Update-Token")).toBe("core-update-token-123");
    expect(requestBody).toMatchObject({
      coreInstallId: "core_11111111-1111-4111-8111-111111111111",
      coreOwnerId: "user123",
      installationId: "12345678",
      setupAction: "install",
      repositorySelection: "selected",
      state: "state-123",
    });

    fetchMock.mockRestore();
  });

  it("reports optional R2 storage status without requiring a binding", async () => {
    const env = createEnv();
    env.ME3_WORKER_NAME = "kierans-me3";
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/core/storage/status", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      r2Available: false,
      binding: "SITE_ASSETS",
      suggestedBucketName: "kierans-me3-storage",
      r2ActivationUrl: "https://dash.cloudflare.com/?to=/:account/r2/plans",
    });
  });

  it("proxies R2 storage activation to the ME3 Cloud broker", async () => {
    const env = createEnv();
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    const session = cookieHeader(await bootstrap(env));
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    env.installSecrets.set(
      "ME3_CORE_INSTALL_ID",
      "core_11111111-1111-4111-8111-111111111111",
    );
    env.installSecrets.set("ME3_CLOUD_CORE_TOKEN", "core-update-token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          dispatched: true,
          runUrl: "https://github.com/example/me3/actions/runs/123",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await app.fetch(
      new Request("https://core.example/api/core/storage/r2/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({}),
      }),
      env,
    );
    const body = (await response.json()) as Record<string, unknown>;
    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    const requestBody = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      unknown
    >;

    expect(response.status).toBe(200);
    expect(body.runUrl).toBe("https://github.com/example/me3/actions/runs/123");
    expect(url).toBe("https://api.me3.example/api/core/storage/r2/activate");
    expect(headers.get("X-ME3-Core-Owner-ID")).toBe("user123");
    expect(headers.get("X-ME3-Core-Update-Token")).toBe("core-update-token-123");
    expect(requestBody).toMatchObject({
      coreInstallId: "core_11111111-1111-4111-8111-111111111111",
      coreOwnerId: "user123",
      bucketName: "core-11111111-1111-4111-8111-111111111111-me3-storage",
      binding: "SITE_ASSETS",
    });

    fetchMock.mockRestore();
  });

  it("disconnects ME3 app auth only when password login remains available", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");

    const response = await app.fetch(
      new Request("http://localhost/api/account/app-connections/me3", {
        method: "DELETE",
        headers: { Cookie: session },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(env.installSecrets.get("ME3_CLOUD_OWNER_ID")).toBeUndefined();
    expect(env.installSecrets.get("ME3_CLOUD_CORE_TOKEN")).toBeUndefined();
  });

  it("does not check ME3 Cloud username conflicts before the install is linked", async () => {
    const env = createEnv();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(getMe3CloudUsernamePublishBlockReason(env, "owner")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("blocks Core publishing when ME3 Cloud reports the username is taken", async () => {
    const env = createEnv();
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ available: false }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getMe3CloudUsernamePublishBlockReason(env, "owner")).resolves.toBe(
      "This username is already taken on ME3 Cloud. Choose another handle before publishing.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.me3.example/api/usernames/owner/available",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-ME3-Core-Owner-ID": "user123",
        }),
      }),
    );

    fetchMock.mockRestore();
  });

  it("checks onboarding username availability through ME3 Cloud with the linked owner", async () => {
    const env = createEnv();
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ available: true, handle: "soup" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/usernames/soup/available"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      username: "soup",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.me3.example/api/usernames/soup/available",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-ME3-Core-Owner-ID": "user123",
        }),
      }),
    );

    fetchMock.mockRestore();
  });

  it("rejects invalid bootstrap codes without issuing a session", async () => {
    const env = createEnv();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bootstrapCode: "wrong" }),
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rate limits setup bootstrap failures by client", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    try {
      const env = createEnv();
      const requestInit = (bootstrapCode: string) => ({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.20",
        },
        body: JSON.stringify({
          bootstrapCode,
          email: "owner@example.com",
          name: "ME3 Owner",
          username: "owner",
          password: "correct-horse-battery",
        }),
      });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.fetch(
          new Request("http://localhost/api/admin/bootstrap", requestInit("wrong")),
          env,
        );
        expect(response.status).toBe(401);
      }

      const blockedResponse = await app.fetch(
        new Request("http://localhost/api/admin/bootstrap", requestInit("owner-code")),
        env,
      );
      const blockedBody = (await blockedResponse.json()) as { error: string };

      expect(blockedResponse.status).toBe(429);
      expect(blockedResponse.headers.get("Retry-After")).toBe("1800");
      expect(blockedBody.error).toBe("Too many attempts. Try again later.");
      expect(env.owner).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a password during bootstrap", async () => {
    const env = createEnv();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bootstrapCode: "owner-code",
          email: "owner@example.com",
          name: "ME3 Owner",
          username: "owner",
          password: "short",
        }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("logs in the owner with email and password", async () => {
    const env = createEnv();
    await bootstrap(env);

    const response = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "correct-horse-battery",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; owner: OwnerProfile & { password_hash?: string } };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.owner.id).toBe("owner");
    expect(body.owner.password_hash).toBeUndefined();
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects invalid owner passwords", async () => {
    const env = createEnv();
    await bootstrap(env);

    const response = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "wrong-password",
        }),
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rate limits owner login failures by client and email", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    try {
      const env = createEnv();
      await bootstrap(env);
      const requestInit = (password: string) => ({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.30",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password,
        }),
      });

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await app.fetch(
          new Request("http://localhost/api/auth/login", requestInit("wrong-password")),
          env,
        );
        expect(response.status).toBe(401);
      }

      const blockedResponse = await app.fetch(
        new Request("http://localhost/api/auth/login", requestInit("correct-horse-battery")),
        env,
      );
      expect(blockedResponse.status).toBe(429);
      expect(blockedResponse.headers.get("Retry-After")).toBe("900");
      expect(blockedResponse.headers.get("set-cookie")).toBeNull();

      vi.setSystemTime(new Date("2026-06-10T12:15:01Z"));

      const recoveredResponse = await app.fetch(
        new Request("http://localhost/api/auth/login", requestInit("correct-horse-battery")),
        env,
      );
      expect(recoveredResponse.status).toBe(200);
      expect(recoveredResponse.headers.get("set-cookie")).toContain("HttpOnly");
      expect(env.authRateLimits).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the owner password with the bootstrap code", async () => {
    const env = createEnv();
    await bootstrap(env);

    const resetResponse = await app.fetch(
      new Request("http://localhost/api/auth/password-reset/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.com",
          bootstrapCode: "owner-code",
          password: "new-correct-horse",
        }),
      }),
      env,
    );

    expect(resetResponse.status).toBe(200);
    expect(responseCookieCleared(resetResponse)).toBe(true);

    const loginResponse = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "new-correct-horse",
        }),
      }),
      env,
    );

    expect(loginResponse.status).toBe(200);
  });

  it("rejects bootstrap password reset with a bad bootstrap code", async () => {
    const env = createEnv();
    await bootstrap(env);
    const previousHash = env.owner?.password_hash;

    const response = await app.fetch(
      new Request("http://localhost/api/auth/password-reset/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.com",
          bootstrapCode: "wrong-code",
          password: "new-correct-horse",
        }),
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(env.owner?.password_hash).toBe(previousHash);
  });

  it("rate limits bootstrap password reset failures by client", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    try {
      const env = createEnv();
      await bootstrap(env);
      const previousHash = env.owner?.password_hash;
      const requestInit = (bootstrapCode: string) => ({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.40",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          bootstrapCode,
          password: "new-correct-horse",
        }),
      });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.fetch(
          new Request(
            "http://localhost/api/auth/password-reset/bootstrap",
            requestInit("wrong-code"),
          ),
          env,
        );
        expect(response.status).toBe(401);
      }

      const blockedResponse = await app.fetch(
        new Request(
          "http://localhost/api/auth/password-reset/bootstrap",
          requestInit("owner-code"),
        ),
        env,
      );

      expect(blockedResponse.status).toBe(429);
      expect(blockedResponse.headers.get("Retry-After")).toBe("1800");
      expect(env.owner?.password_hash).toBe(previousHash);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hydrates the owner session from the signed cookie", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      user: OwnerProfile;
      workspace: { hasProfileSite: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.user.id).toBe("owner");
    expect(body.workspace.hasProfileSite).toBe(false);

    addAssistantEditableSite(env);
    const responseWithSite = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { Cookie: session },
      }),
      env,
    );
    const bodyWithSite = (await responseWithSite.json()) as {
      workspace: { hasProfileSite: boolean };
    };
    expect(bodyWithSite.workspace.hasProfileSite).toBe(true);
  });

  it("clears the owner session cookie on logout", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("me3_core_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects owner-only assistant requests without a valid session", async () => {
    const env = createEnv();

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello" }),
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(env.messages).toHaveLength(0);
  });

  it("allows owner-only assistant requests with a valid session", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ message: "Hello" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(env.messages).toMatchObject([{ ownerId: "owner", content: "Hello" }]);
  });

  it("uploads typed assistant text attachments with extracted text", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const form = new FormData();
    form.append(
      "attachments",
      new File(["# Notes\n\nRemember the launch checklist."], "notes.md", {
        type: "text/markdown",
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/attachments", {
        method: "POST",
        headers: { Cookie: session },
        body: form,
      }),
      env,
    );
    const payload = (await response.json()) as {
      ok: boolean;
      attachments: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.attachments[0]).toMatchObject({
      name: "notes.md",
      mimeType: "text/markdown",
      kind: "text",
      status: "ready",
      hasText: true,
      text: "# Notes\n\nRemember the launch checklist.",
      textTruncated: false,
    });
    expect(env.assistantAttachments[0]).toMatchObject({
      owner_id: "owner",
      filename: "notes.md",
      mime_type: "text/markdown",
      kind: "text",
      storage_key: null,
      extracted_text: "# Notes\n\nRemember the launch checklist.",
      text_truncated: 0,
    });
  });

  it("accepts browser-safe JSON assistant attachment uploads", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const content = "# Browser notes\n\nThe upload should not depend on multipart parsing.";

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/attachments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          attachments: [
            {
              filename: "browser-notes.md",
              mimeType: "text/markdown",
              dataBase64: btoa(content),
            },
          ],
        }),
      }),
      env,
    );
    const payload = (await response.json()) as {
      ok: boolean;
      attachments: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.attachments[0]).toMatchObject({
      name: "browser-notes.md",
      mimeType: "text/markdown",
      kind: "text",
      status: "ready",
      hasText: true,
      text: content,
    });
    expect(env.assistantAttachments[0]).toMatchObject({
      owner_id: "owner",
      filename: "browser-notes.md",
      extracted_text: content,
    });
  });

  it("returns a setup error when assistant attachment storage is not migrated", async () => {
    const env = createEnv();
    env.failAssistantAttachmentInsert = true;
    const session = cookieHeader(await bootstrap(env));
    const form = new FormData();
    form.append("attachments", new File(["hello"], "hello.txt", { type: "text/plain" }));

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/attachments", {
        method: "POST",
        headers: { Cookie: session },
        body: form,
      }),
      env,
    );
    const payload = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Assistant attachment storage is not migrated yet");
  });

  it("stores assistant image attachments in R2 when configured", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const storedObjects: Array<{
      key: string;
      value: ArrayBuffer | ReadableStream | string;
      options?: R2PutOptions;
    }> = [];
    env.SITE_ASSETS = {
      put: vi.fn(async (key: string, value: ArrayBuffer | ReadableStream | string, options?: R2PutOptions) => {
        storedObjects.push({ key, value, options });
        return null;
      }),
    } as unknown as R2Bucket;

    const form = new FormData();
    form.append(
      "attachments",
      new File([new Uint8Array([137, 80, 78, 71])], "diagram.png", {
        type: "image/png",
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/attachments", {
        method: "POST",
        headers: { Cookie: session },
        body: form,
      }),
      env,
    );
    const payload = (await response.json()) as {
      ok: boolean;
      attachments: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(201);
    expect(payload.attachments[0]).toMatchObject({
      name: "diagram.png",
      mimeType: "image/png",
      kind: "image",
      status: "ready",
      hasText: false,
    });
    expect(storedObjects[0]?.key).toContain("assistant/owner/attachments/");
    expect(env.assistantAttachments[0]).toMatchObject({
      owner_id: "owner",
      filename: "diagram.png",
      mime_type: "image/png",
      kind: "image",
      extracted_text: null,
    });
    expect(env.assistantAttachments[0]?.storage_key).toContain(
      "assistant/owner/attachments/",
    );
  });

  it("dispatches owner assistant chat turns through the agent runtime", async () => {
    const env = createEnv();
    env.ME3_DEPLOYMENT_MODE = "self_hosted";
    const session = cookieHeader(await bootstrap(env));
    const runtimeCalls: Array<[string, RequestInit]> = [];
    const runtimeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      runtimeCalls.push([url, init || {}]);
      return Response.json({
        ok: true,
        auditId: null,
        turnId: "turn-1",
        specialist: "core.agent-chat",
        replyText: "Hello from Core chat.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      });
    });

    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;
    env.assistantAttachments.push({
      id: "att-1",
      owner_id: "owner",
      thread_id: null,
      filename: "notes.md",
      mime_type: "text/markdown",
      size: 128,
      kind: "text",
      status: "ready",
      storage_key: null,
      extracted_text: "# Notes\n\nRemember the launch checklist.",
      text_truncated: 0,
      metadata_json: "{}",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: "Hello agent",
          model: {
            providerId: "openai",
            model: "gpt-test",
            optionId: "openai-gpt-test",
          },
          attachments: [
            {
              id: "att-1",
              name: "notes.md",
              mimeType: "text/markdown",
              size: 128.4,
              kind: "text",
              status: "ready",
              hasText: true,
              textTruncated: false,
              text: "do not audit raw attachment text",
            },
          ],
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      mode: "everyday",
      specialist: "core.agent-chat",
      replyText: "Hello from Core chat.",
    });
    expect(payload.threadId).toBe(env.assistantThreads[0]?.id);
    expect(env.assistantThreads).toMatchObject([
      {
        owner_id: "owner",
        title: "Hello agent",
        origin_surface: "assistant",
        status: "active",
      },
    ]);
    expect(env.agentEvents).toHaveLength(1);
    expect(env.agentEvents[0]).toMatchObject({
      channel: "sandbox",
      direction: "inbound",
      text_body: "Hello agent",
    });
    expect(JSON.parse(env.agentEvents[0]?.raw_json || "{}")).toMatchObject({
      runtime: "sandbox",
      surface: "assistant",
      route: "/api/assistant/chat/turn",
      mode: "everyday",
      threadId: env.assistantThreads[0]?.id,
      requestedThreadId: null,
      selectedModel: {
        providerId: "openai",
        model: "gpt-test",
        optionId: "openai-gpt-test",
      },
      attachmentCount: 1,
      attachmentManifest: [
        {
          id: "att-1",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 128,
          kind: "text",
          status: "ready",
          hasText: true,
          textTruncated: false,
        },
      ],
    });
    expect(JSON.parse(env.agentEvents[0]?.raw_json || "{}")).not.toHaveProperty(
      "attachmentManifest.0.text",
    );
    expect(env.agentEvents[0]?.raw_json).not.toContain(
      "Remember the launch checklist",
    );
    expect(runtimeFetch).toHaveBeenCalledOnce();
    const runtimeInit = runtimeCalls[0]?.[1] || {};
    const runtimeBody = JSON.parse(String(runtimeInit.body));
    expect(runtimeBody).toMatchObject({
      userId: "owner",
      threadId: env.assistantThreads[0]?.id,
      messageText: "Hello agent",
      mode: "everyday",
      selectedModel: {
        providerId: "openai",
        model: "gpt-test",
        optionId: "openai-gpt-test",
      },
      attachments: [
        {
          id: "att-1",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 128,
          kind: "text",
          status: "ready",
          hasText: true,
          textTruncated: false,
        },
      ],
    });
    expect(runtimeBody.attachmentTextContext).toContain("File: notes.md");
    expect(runtimeBody.attachmentTextContext).toContain(
      "# Notes\n\nRemember the launch checklist.",
    );
    expect(runtimeBody.attachmentTextContext).not.toContain(
      "do not audit raw attachment text",
    );
  });

  it("reuses the same sandbox turn for a repeated client request id", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const runtimeBodies: Array<Record<string, unknown>> = [];
    const runtimeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      runtimeBodies.push(body);
      return Response.json({
        ok: true,
        auditId: null,
        turnId: body.turnId,
        specialist: "core.agent-chat",
        replyText: "Recorded once.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      });
    });
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const send = (threadId?: string) =>
      app.fetch(
        new Request("http://localhost/api/assistant/chat/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({
            requestId: "client-request-1",
            messageText: "Record this once",
            ...(threadId ? { threadId } : {}),
          }),
        }),
        env,
      );

    const first = await send();
    const firstPayload = (await first.json()) as Record<string, unknown>;
    const second = await send(String(firstPayload.threadId));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(env.agentEvents).toHaveLength(1);
    expect(env.agentEvents[0]).toMatchObject({
      provider_event_id: "client-request-1",
    });
    expect(runtimeBodies).toHaveLength(2);
    expect(runtimeBodies[0]).toMatchObject({ requestId: "client-request-1" });
    expect(runtimeBodies[1]?.turnId).toBe(runtimeBodies[0]?.turnId);
  });

  it("keeps generic blog drafting prompts in agent chat", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env);
    const runtimeCalls: Array<[string, RequestInit]> = [];
    const runtimeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      runtimeCalls.push([url, init || {}]);
      return Response.json({
        ok: true,
        auditId: null,
        turnId: `turn-${runtimeCalls.length}`,
        specialist: "core.agent-chat",
        replyText:
          runtimeCalls.length === 1 ? "Creative draft from Core chat." : "Yes, the model is working.",
        model: "gpt-5.5",
        source: "openai",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      });
    });

    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const creativePrompt =
      "Draft a blog post in a humorous Mission: Impossible style for ME3. Transcript: 'Good morning, Mr. Phelps. Your mission, Jim, should you decide to accept it, is to make Stefan believe Townsend's information. This tape will self-destruct in five seconds.'";
    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: creativePrompt,
          model: {
            providerId: "openai",
            model: "gpt-5.5",
            optionId: "openai-gpt-5.5",
          },
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;
    const threadId = String(payload.threadId);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      specialist: "core.agent-chat",
      replyText: "Creative draft from Core chat.",
      model: "gpt-5.5",
      source: "openai",
    });
    expect(payload.siteAction).toBeUndefined();
    expect(runtimeFetch).toHaveBeenCalledOnce();
    expect(
      env.siteFiles.some(
        (file) =>
          file.site_id === "site-assistant" &&
          (file.path.startsWith("assistant/site-update-drafts/") ||
            file.path.startsWith("src/blog/")),
      ),
    ).toBe(false);
    expect(JSON.parse(String(runtimeCalls[0]?.[1].body))).toMatchObject({
      messageText: creativePrompt,
      selectedModel: {
        providerId: "openai",
        model: "gpt-5.5",
        optionId: "openai-gpt-5.5",
      },
    });

    const followupResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          threadId,
          messageText: "is the model working",
          model: {
            providerId: "openai",
            model: "gpt-5.5",
            optionId: "openai-gpt-5.5",
          },
        }),
      }),
      env,
    );
    const followupPayload = (await followupResponse.json()) as Record<string, unknown>;

    expect(followupResponse.status).toBe(200);
    expect(followupPayload).toMatchObject({
      ok: true,
      specialist: "core.agent-chat",
      replyText: "Yes, the model is working.",
    });
    expect(runtimeFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(runtimeCalls[1]?.[1].body))).toMatchObject({
      threadId,
      messageText: "is the model working",
    });
  });

  it("routes site-looking prompts through agent chat when assistant site tools are disabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, {
      blogEnabled: true,
      assistantSiteToolsEnabled: false,
    });
    const runtimeFetch = vi.fn(async () =>
      Response.json({
        ok: true,
        auditId: null,
        turnId: "turn-agent",
        specialist: "core.agent-chat",
        replyText: "Agent chat reply.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      }),
    );
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({ bio: "This should not be written." }),
    }));
    env.AI = { run: aiRun } as unknown as Ai;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: 'Update my site short bio field to say "This should not be written."',
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      specialist: "core.agent-chat",
      replyText: "Agent chat reply.",
    });
    expect(String(payload.replyText)).not.toContain("Add @site");
    expect(payload.siteAction).toBeUndefined();
    expect(runtimeFetch).toHaveBeenCalledOnce();
    expect(aiRun).not.toHaveBeenCalled();
    expect(siteFileText(env, "site-assistant", "src/me.json")).not.toContain(
      "This should not be written.",
    );
    expect(
      env.siteFiles.some(
        (file) =>
          file.site_id === "site-assistant" &&
          file.path.startsWith("assistant/site-update-drafts/"),
      ),
    ).toBe(false);
  });

  it("does not intercept advanced site turns with the everyday chat generator", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env);
    const runtimeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return Response.json({
        ok: true,
        mode: input.mode,
        specialist: "core.agent-chat",
        replyText: "Advanced runtime reply.",
      });
    });
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({ bio: "This should not be written." }),
    }));
    env.AI = { run: aiRun } as unknown as Ai;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          messageText: '@site Update my short bio to say "This should not be written."',
          mode: "advanced",
        }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      mode: "advanced",
      specialist: "core.agent-chat",
    });
    expect(runtimeFetch).toHaveBeenCalledOnce();
    expect(aiRun).not.toHaveBeenCalled();
    expect(siteFileText(env, "site-assistant", "src/me.json")).not.toContain(
      "This should not be written.",
    );
  });

  it("requires @site again before publishing a pending assistant site draft", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, { blogEnabled: true });
    env.AI = {
      run: vi.fn(async () => ({
        response: JSON.stringify({
          bio: "Scoped draft bio.",
        }),
      })),
    } as unknown as Ai;

    const draftResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: '@site update my site bio to "Scoped draft bio."',
        }),
      }),
      env,
    );
    const draftPayload = (await draftResponse.json()) as Record<string, unknown>;
    const threadId = String(draftPayload.threadId);

    const publishResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          threadId,
          messageText: "publish it",
        }),
      }),
      env,
    );
    const publishPayload = (await publishResponse.json()) as Record<string, unknown>;

    expect(draftResponse.status).toBe(200);
    expect(publishResponse.status).toBe(200);
    expect(publishPayload).toMatchObject({
      ok: true,
      specialist: "core.assistant-scopes",
      siteAction: null,
    });
    expect(String(publishPayload.replyText)).toContain("Add @site");
    expect(env.sites.find((site) => site.id === "site-assistant")?.published_at).toBeNull();
    expect(siteFileText(env, "site-assistant", "public/me.json") || "").not.toContain(
      "Scoped draft bio.",
    );
    expect(
      env.siteFiles.some(
        (file) =>
          file.site_id === "site-assistant" &&
          file.path.startsWith("assistant/site-update-drafts/") &&
          file.path.endsWith(`${threadId}.json`),
      ),
    ).toBe(true);
  });

  it("saves and clears the assistant display name", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const initialResponse = await app.fetch(
      new Request("http://localhost/api/assistant/settings", {
        headers: { Cookie: session },
      }),
      env,
    );
    const initialPayload = (await initialResponse.json()) as {
      assistantName: string | null;
      displayName: string;
    };

    expect(initialResponse.status).toBe(200);
    expect(initialPayload).toEqual({
      assistantName: null,
      displayName: "ME3",
    });

    const saveResponse = await app.fetch(
      new Request("http://localhost/api/assistant/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ assistantName: "  Atlas   Prime  " }),
      }),
      env,
    );
    const savePayload = (await saveResponse.json()) as {
      assistantName: string | null;
      displayName: string;
    };

    expect(saveResponse.status).toBe(200);
    expect(savePayload).toEqual({
      assistantName: "Atlas Prime",
      displayName: "Atlas Prime",
    });
    expect(env.owner?.assistant_name).toBe("Atlas Prime");

    const clearResponse = await app.fetch(
      new Request("http://localhost/api/assistant/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ assistantName: "" }),
      }),
      env,
    );
    const clearPayload = (await clearResponse.json()) as {
      assistantName: string | null;
      displayName: string;
    };

    expect(clearResponse.status).toBe(200);
    expect(clearPayload).toEqual({
      assistantName: null,
      displayName: "ME3",
    });
    expect(env.owner?.assistant_name).toBeNull();
  });

  it.each(["Update my site bio", "publish it", "Update @missing site bio"])(
    "does not choose a site for an ambiguous or unknown request: %s",
    async (message) => {
      const env = createEnv();
      const session = cookieHeader(await bootstrap(env));
      addAssistantEditableSite(env);
      env.sites.push({ ...env.sites[0]!, id: "studio", username: "studio", site_role: "organization" });
      const before = env.siteFiles.map((file) => ({ ...file }));
      const response = await app.fetch(new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({ messageText: `@site ${message}` }),
      }), env);
      expect(response.status).toBe(200);
      const payload = await response.json() as { replyText: string; siteAction: { siteId: string | null } };
      expect(payload.replyText).toContain(message.includes("@missing") ? "could not find @missing" : "Which site");
      expect(payload.siteAction.siteId).toBeNull();
      expect(env.siteFiles).toEqual(before);
    },
  );

  it("does not publish a personal draft when approval names a different site", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env);
    env.sites.push({ ...env.sites[0]!, id: "studio", username: "studio", site_role: "organization" });
    const send = (messageText: string, threadId?: string) => app.fetch(new Request("http://localhost/api/assistant/chat/turn", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: session },
      body: JSON.stringify({ messageText, threadId }),
    }), env);
    const drafted = await send('@site Update @owner short bio field to say "Personal update."');
    expect(drafted.status).toBe(200);
    const payload = await drafted.json() as { threadId: string; siteAction: { siteId: string } };
    expect(payload.siteAction.siteId).toBe("site-assistant");
    const before = env.siteFiles.map((file) => ({ ...file }));
    const approval = await send("@site publish @studio", payload.threadId);
    expect(approval.status).toBe(200);
    expect(await approval.json()).toMatchObject({ replyText: expect.stringContaining("no pending draft for @studio") });
    expect(env.siteFiles).toEqual(before);
    expect(env.sites.every((site) => !site.published_at)).toBe(true);
  });

  it.each([["profile", "publish"], ["organization", "publish"], ["profile", "upload"], ["organization", "upload"]] as const)(
    "only syncs the personal directory for a %s site via %s",
    async (role, method) => {
      const env = createEnv();
      const session = cookieHeader(await bootstrap(env));
      addAssistantEditableSite(env);
      env.sites[0]!.site_role = role;
      addSiteFileText(env, "site-assistant", "public/index.html", "<h1>Site</h1>", "text/html");
      addSiteFileText(env, "site-assistant", "public/me.json", JSON.stringify({ kind: "person", name: "Site" }), "application/json");
      const sync = vi.spyOn(networkDirectory, "syncPublishedProfileToSoulinkDirectory").mockResolvedValue("synced");
      const pending: Promise<unknown>[] = [];
      try {
        const form = new FormData();
        form.append("files", new File([JSON.stringify({ version: "0.1", name: "Site", handle: "owner" })], "me.json", { type: "application/json" }));
        const response = await app.fetch(new Request(`http://localhost/api/sites/owner/${method}`, {
          method: "POST", headers: { Cookie: session }, body: method === "upload" ? form : undefined,
        }), env, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); }, passThroughOnException() {} } as unknown as ExecutionContext);
        expect(response.status).toBe(200);
        await Promise.all(pending);
        expect(sync).toHaveBeenCalledTimes(role === "profile" ? 1 : 0);
      } finally {
        sync.mockRestore();
      }
    },
  );

  it("drafts and publishes profile site updates from assistant approval", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, { blogEnabled: true });
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        aboutParagraph:
          "Model-written about paragraph for a public site that feels specific, useful, and alive.",
        blogPost: {
          title: "Personal AI Assistants in Practice",
          bodyMarkdown:
            "# Personal AI Assistants in Practice\n\nModel-written blog copy about practical personal AI assistants, context, and momentum.",
          excerpt: "Model-written blog copy about practical personal AI assistants.",
        },
      }),
    }));
    env.AI = { run: aiRun } as unknown as Ai;

    const draftResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText:
            "@site Update my site, add a made up paragraph to my about page and add a blog post about 'personal ai assistants'. make it all up, do your best :)",
        }),
      }),
      env,
    );
    const draftPayload = (await draftResponse.json()) as Record<string, unknown>;
    const threadId = String(draftPayload.threadId);
    const draftFile = env.siteFiles.find(
      (file) =>
        file.site_id === "site-assistant" &&
        file.path.startsWith("assistant/site-update-drafts/") &&
        file.path.endsWith(`${threadId}.json`),
    );

    expect(draftResponse.status).toBe(200);
    expect(draftPayload).toMatchObject({
      ok: true,
      source: "workers-ai",
      specialist: "core.sites.update_draft",
      model: DEFAULT_WORKERS_AI_TEXT_MODEL,
    });
    expect(env.assistantThreads[0]?.title).not.toContain("@site");
    expect(aiRun).toHaveBeenCalledOnce();
    expect(String(draftPayload.replyText)).toContain("Reply `publish`");
    expect(String(draftPayload.replyText)).toContain(`Generated with ${DEFAULT_WORKERS_AI_TEXT_MODEL}`);
    expect(String((draftPayload.siteAction as Record<string, unknown>).url)).toContain(
      "/sites/owner?edit=blog",
    );
    const persistedAssistantMessage = env.messages.find(
      (message) =>
        message.threadId === threadId &&
        message.role === "assistant" &&
        message.content.includes("Draft saved"),
    );
    const persistedUserMessage = env.messages.find(
      (message) => message.threadId === threadId && message.role === "user",
    );
    expect(persistedUserMessage?.content).toContain("@site Update my site");
    expect(JSON.parse(persistedUserMessage?.metadata_json || "{}")).toMatchObject({
      assistantScopes: ["site"],
      assistantScopeTokens: ["@site"],
    });
    const persistedMetadata = JSON.parse(
      persistedAssistantMessage?.metadata_json || "{}",
    ) as Record<string, any>;
    expect(persistedMetadata.siteAction).toMatchObject({
      kind: "draft_created",
      postTitle: "Personal AI Assistants in Practice",
      url: expect.stringContaining("/sites/owner?edit=blog"),
    });
    expect(draftFile).toBeTruthy();
    const savedDraft = JSON.parse(new TextDecoder().decode(draftFile?.content)) as {
      changes: { postDraft?: boolean };
      sourceFiles: Record<string, string>;
    };
    const savedDraftProfile = JSON.parse(savedDraft.sourceFiles["me.json"]) as {
      posts?: Array<{ slug?: string; draft?: boolean; publishedAt?: string }>;
    };
    expect(savedDraft.changes.postDraft).toBe(true);
    expect(savedDraftProfile.posts?.[0]).toMatchObject({
      slug: "personal-ai-assistants-in-practice",
      draft: true,
    });
    expect(savedDraftProfile.posts?.[0]?.publishedAt).toBeUndefined();
    expect(siteFileText(env, "site-assistant", "src/about.md")).toContain(
      "Model-written about paragraph",
    );
    expect(env.sites.find((site) => site.id === "site-assistant")?.published_at).toBeNull();

    const publishResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          threadId,
          messageText: "@site yes publish them",
        }),
      }),
      env,
    );
    const publishPayload = (await publishResponse.json()) as Record<string, unknown>;

    expect(publishResponse.status).toBe(200);
    expect(publishPayload).toMatchObject({
      ok: true,
      source: "tool",
      specialist: "core.sites.publish",
    });
    expect(String(publishPayload.replyText)).toContain("Published");
    expect(String(publishPayload.replyText)).toContain("I updated your site");
    expect(String(publishPayload.replyText)).toContain(
      'Blog title: "Personal AI Assistants in Practice"',
    );
    expect(String(publishPayload.replyText)).toContain("Open your site dashboard");
    expect(String(publishPayload.replyText)).toContain("/sites/owner?edit=blog");
    expect(String((publishPayload.siteAction as Record<string, unknown>).url)).toContain(
      "/sites/owner?edit=blog",
    );
    expect(String(publishPayload.replyText)).not.toContain("@owner");
    expect(env.sites.find((site) => site.id === "site-assistant")?.published_at).toBeTruthy();
    const publishedProfile = JSON.parse(
      siteFileText(env, "site-assistant", "src/me.json") || "{}",
    ) as { posts?: Array<{ slug?: string; draft?: boolean; publishedAt?: string }> };
    const publishedPost = publishedProfile.posts?.find(
      (post) => post.slug === "personal-ai-assistants-in-practice",
    );
    expect(publishedPost).toMatchObject({ draft: false });
    expect(publishedPost?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(siteFileText(env, "site-assistant", "src/about.md")).toContain(
      "Model-written about paragraph",
    );
    expect(
      siteFileText(
        env,
        "site-assistant",
        "src/blog/personal-ai-assistants-in-practice.md",
      ),
    ).toContain("Model-written blog copy");
    expect(
      siteFileText(
        env,
        "site-assistant",
        "public/blog/personal-ai-assistants-in-practice.html",
      ),
    ).toContain("Model-written blog copy");
    expect(siteFileText(env, "site-assistant", "public/me.json")).toContain(
      "personal-ai-assistants-in-practice",
    );
    expect(
      env.siteFiles.find(
        (file) =>
          file.site_id === "site-assistant" &&
          file.path.startsWith("assistant/site-update-drafts/") &&
          file.path.endsWith(`${threadId}.json`),
      ),
    ).toBeUndefined();
  });

  it("drafts profile bio updates into me.json instead of the about page", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env);
    env.AI = {
      run: vi.fn(async () => ({
        response: JSON.stringify({
          bio: "I build useful AI systems for everyday creative momentum.",
        }),
      })),
    } as unknown as Ai;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText:
            '@site update @owner short bio field to say "I build useful AI systems for everyday creative momentum."',
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;
    const profile = JSON.parse(siteFileText(env, "site-assistant", "src/me.json") || "{}") as {
      bio?: string;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      specialist: "core.sites.update_draft",
      siteAction: { kind: "draft_created", pending: true, published: false },
    });
    expect(String(payload.replyText)).toContain("Bio: updated the short profile bio");
    expect(String(payload.replyText)).not.toContain("About page");
    expect(profile.bio).toBe("I build useful AI systems for everyday creative momentum.");
    expect(siteFileText(env, "site-assistant", "src/about.md")).toBe("# About\n\nOriginal about.");
    expect(env.sites.find((site) => site.id === "site-assistant")?.published_at).toBeNull();
  });

  it("publishes assistant drafts for already-published local sites without Cloud username blocking", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, {
      publishedAt: "2026-06-04T10:00:00Z",
    });
    env.ME3_CLOUD_API_ORIGIN = "https://api.me3.example";
    env.installSecrets.set("ME3_CLOUD_OWNER_ID", "user123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ available: false }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    env.AI = {
      run: vi.fn(async () => ({
        response: JSON.stringify({
          bio: "Published local site bio.",
        }),
      })),
    } as unknown as Ai;

    const draftResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: '@site Update my site short bio field to say "Published local site bio."',
        }),
      }),
      env,
    );
    const draftPayload = (await draftResponse.json()) as Record<string, unknown>;
    const threadId = String(draftPayload.threadId);

    const publishResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          threadId,
          messageText: "@site publish it",
        }),
      }),
      env,
    );
    const publishPayload = (await publishResponse.json()) as Record<string, unknown>;

    expect(draftResponse.status).toBe(200);
    expect(publishResponse.status).toBe(200);
    expect(publishPayload).toMatchObject({
      ok: true,
      specialist: "core.sites.publish",
      siteAction: { kind: "published", published: true },
    });
    expect(String(publishPayload.replyText)).not.toContain("username is already taken");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(siteFileText(env, "site-assistant", "public/me.json")).toContain(
      "Published local site bio.",
    );

    fetchMock.mockRestore();
  });

  it("rejects assistant blog post drafts when the site blog feature is disabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env);

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: "@site Update my site, draft a blog post about personal ai assistants.",
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      source: "tool",
      specialist: "core.sites.update_draft",
      siteAction: {
        kind: "unsupported_feature",
        siteId: "site-assistant",
        username: "owner",
        pending: false,
        published: false,
        files: [],
      },
    });
    expect(String((payload.siteAction as Record<string, unknown>).url)).toContain(
      "/sites/owner?edit=additional-features",
    );
    expect(String(payload.replyText)).toContain("Blog is not enabled");
    expect(String(payload.replyText)).toContain("Additional features");
    expect(
      env.siteFiles.some(
        (file) =>
          file.site_id === "site-assistant" &&
          file.path.startsWith("assistant/site-update-drafts/"),
      ),
    ).toBe(false);
    expect(
      env.siteFiles.some(
        (file) =>
          file.site_id === "site-assistant" &&
          file.path.startsWith("src/blog/"),
      ),
    ).toBe(false);
  });

  it("retries a disabled blog request as a draft after Blog is enabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env);

    const blockedResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText:
            "@site For my site, draft and save an outline for a blog post on the benefits of an open source personal ai assistant.",
        }),
      }),
      env,
    );
    const blockedPayload = (await blockedResponse.json()) as Record<string, unknown>;
    const threadId = String(blockedPayload.threadId);
    const meJsonFile = env.siteFiles.find(
      (file) => file.site_id === "site-assistant" && file.path === "src/me.json",
    );
    expect(meJsonFile).toBeTruthy();
    if (!meJsonFile) throw new Error("Missing assistant site me.json fixture");
    const meJson = JSON.parse(new TextDecoder().decode(meJsonFile.content)) as Record<
      string,
      unknown
    >;
    meJson.blogEnabled = true;
    meJson.blogTitle = "Blog";
    const nextContent = new TextEncoder().encode(JSON.stringify(meJson, null, 2));
    if (meJsonFile) {
      meJsonFile.content = nextContent;
      meJsonFile.size = nextContent.byteLength;
    }

    const retryResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          threadId,
          messageText: "@site Ok I enabled it, please try again",
        }),
      }),
      env,
    );
    const retryPayload = (await retryResponse.json()) as Record<string, unknown>;

    expect(blockedResponse.status).toBe(200);
    expect(String(blockedPayload.replyText)).toContain("Blog is not enabled");
    expect(retryResponse.status).toBe(200);
    expect(retryPayload).toMatchObject({
      ok: true,
      source: "fallback",
      specialist: "core.sites.update_draft",
      siteAction: {
        kind: "draft_created",
        siteId: "site-assistant",
        username: "owner",
        pending: true,
        published: false,
      },
    });
    expect(String(retryPayload.replyText)).toContain("Draft saved");
    expect(String(retryPayload.replyText)).toContain("Blog draft title");
    expect(String(retryPayload.replyText)).toContain("Review it in your site dashboard");
    expect(String(retryPayload.replyText)).not.toContain("Published");
    expect(env.sites.find((site) => site.id === "site-assistant")?.published_at).toBeNull();
    expect(
      env.siteFiles.some(
        (file) =>
          file.site_id === "site-assistant" &&
          file.path.startsWith("assistant/site-update-drafts/") &&
          file.path.endsWith(`${threadId}.json`),
      ),
    ).toBe(true);
  });

  it("keeps save-draft follow-ups in the assistant site update flow", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, { blogEnabled: true });

    const draftResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: "@site Update my site, draft a blog post about personal ai assistants.",
        }),
      }),
      env,
    );
    const draftPayload = (await draftResponse.json()) as Record<string, unknown>;
    const threadId = String(draftPayload.threadId);

    const saveResponse = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          threadId,
          messageText: "@site can you save it as a draft?",
        }),
      }),
      env,
    );
    const savePayload = (await saveResponse.json()) as Record<string, unknown>;

    expect(draftResponse.status).toBe(200);
    expect(saveResponse.status).toBe(200);
    expect(savePayload).toMatchObject({
      ok: true,
      source: "tool",
      specialist: "core.sites.approval_status",
      siteAction: {
        kind: "approval_status",
        siteId: "site-assistant",
        username: "owner",
        pending: true,
        published: false,
      },
    });
    expect(String(savePayload.replyText)).toContain("already saved as a pending draft");
    expect(String(savePayload.replyText)).not.toContain("email");
  });

  it("trims outline-only instructions out of fallback blog titles", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, { blogEnabled: true });

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText:
            "@site Update my site, draft a humorous blog post about bees, just the outline will do I will write it myself.",
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;
    const replyText = String(payload.replyText);

    expect(response.status).toBe(200);
    expect(replyText).toContain('Blog draft title: "The Rise of Bees"');
    expect(replyText).not.toContain("Outline Will Do");
    expect(replyText).not.toContain("I Will Write It Myself");
  });

  it("lists profile site blog posts from assistant chat", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, { blogEnabled: true });
    const meJson = JSON.parse(siteFileText(env, "site-assistant", "src/me.json") || "{}");
    meJson.posts = [
      {
        slug: "published-note",
        title: "Published Note",
        file: "blog/published-note.md",
        publishedAt: "2026-06-01",
        draft: false,
      },
      {
        slug: "draft-note",
        title: "Draft Note",
        file: "blog/draft-note.md",
        draft: true,
      },
    ];
    addSiteFileText(
      env,
      "site-assistant",
      "src/me.json",
      JSON.stringify(meJson, null, 2),
      "application/json",
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: "@site list all blog posts",
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      source: "tool",
      specialist: "core.sites.approval_status",
      siteAction: {
        kind: "listed_blog_posts",
        siteId: "site-assistant",
        username: "owner",
      },
    });
    expect(String((payload.siteAction as Record<string, unknown>).url)).toContain(
      "/sites/owner?edit=blog",
    );
    expect(String(payload.replyText)).toContain("Published Note");
    expect(String(payload.replyText)).toContain("published, 2026-06-01");
    expect(String(payload.replyText)).toContain("Draft Note");
    expect(String(payload.replyText)).toContain("draft");
  });

  it("publishes a prior plain-text assistant site draft when the user approves it", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env, { blogEnabled: true });
    env.assistantThreads.push({
      id: "thread-legacy-site-draft",
      owner_id: "owner",
      title: "Update my site",
      origin_surface: "assistant",
      project_id: null,
      status: "active",
      pinned_at: null,
      archived_at: null,
      deleted_at: null,
      last_message_at: "2026-06-05T09:10:00Z",
      created_at: "2026-06-05T09:10:00Z",
      updated_at: "2026-06-05T09:10:00Z",
    });
    env.messages.push(
      {
        id: "message-user-site-request",
        ownerId: "owner",
        role: "user",
        content:
          "Update my site, add a made up paragraph to my about page and add a blog post about 'personal ai assistants'.",
        threadId: "thread-legacy-site-draft",
        created_at: "2026-06-05T09:11:00Z",
      },
      {
        id: "message-assistant-site-draft",
        ownerId: "owner",
        role: "assistant",
        content:
          "About Page Paragraph: \"Welcome to my world of innovation and transformation! This site is a place for imaginary experiments, generous curiosity, and practical AI companions.\"\n\nBlog Post: 'The Rise of Personal AI Assistants': \"In today's fast-paced world, personal AI assistants are becoming trusted creative partners. They help people capture ideas, make plans, and keep momentum visible.\"",
        threadId: "thread-legacy-site-draft",
        created_at: "2026-06-05T09:12:00Z",
      },
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          threadId: "thread-legacy-site-draft",
          messageText: "@site just do it",
        }),
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      source: "tool",
      specialist: "core.sites.publish",
    });
    expect(siteFileText(env, "site-assistant", "src/about.md")).toContain(
      "Welcome to my world of innovation and transformation",
    );
    expect(
      siteFileText(
        env,
        "site-assistant",
        "src/blog/the-rise-of-personal-ai-assistants.md",
      ),
    ).toContain("In today's fast-paced world");
    expect(env.sites.find((site) => site.id === "site-assistant")?.published_at).toBeTruthy();
  });

  it("streams owner assistant chat turns through server-sent events", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const runtimeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body || "{}")) as {
        threadId?: string;
        mode?: string;
      };
      const done = {
        ok: true,
        auditId: null,
        turnId: "turn-1",
        threadId: input.threadId,
        mode: input.mode,
        specialist: "core.agent-chat",
        replyText: "Hello from the streaming route.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
        performance: {
          version: 1,
          resultSource: "fresh",
          executionMs: 12,
          durableObjectTotalMs: 20,
        },
        streamMetrics: {
          timeToFirstTokenMs: 8,
          totalDurationMs: 12,
          deltaCount: 2,
          modelRequestCount: 1,
          modelRequestDurationMs: 11,
          toolCallCount: 0,
          toolExecutionDurationMs: 0,
          inputCharacterCount: 100,
          availableToolCount: 3,
          toolSchemaCharacterCount: 500,
        },
      };
      return new Response([
        'event: status\ndata: {"state":"model_started"}\n\n',
        'event: tool\ndata: {"state":"started","capabilityId":"core.reminders.list"}\n\n',
        'event: delta\ndata: {"text":"Hello from "}\n\n',
        'event: delta\ndata: {"text":"the streaming route."}\n\n',
        `event: done\ndata: ${JSON.stringify(done)}\n\n`,
      ].join(""), {
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: "Stream this",
          mode: "advanced",
          attachments: [{ id: "att-1", kind: "text" }],
        }),
      }),
      env,
    );
    const streamText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(streamText).toContain("event: status");
    expect(streamText).toContain("event: thread");
    expect(streamText).toContain("event: delta");
    expect(streamText).toContain("event: tool");
    expect(streamText).toContain("Hello from the streaming route.");
    expect(streamText).toContain("event: done");
    expect(streamText).toContain('"mode":"advanced"');
    expect(streamText).toContain(env.assistantThreads[0]?.id);
    expect(runtimeFetch.mock.calls[0]?.[0]).toContain("/dispatch/sandbox/stream");
    expect(JSON.parse(String(runtimeFetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      mode: "advanced",
    });
    expect(JSON.parse(env.agentEvents[0]?.raw_json || "{}")).toMatchObject({
      route: "/api/assistant/chat/turn/stream",
      stream: true,
      mode: "advanced",
      attachmentCount: 1,
      attachmentManifest: [
        {
          id: "att-1",
          kind: "text",
        },
      ],
    });
    expect(env.agentEvents[1]).toMatchObject({
      channel: "sandbox",
      direction: "system",
      event_type: "message",
      status: "sent",
    });
    expect(JSON.parse(env.agentEvents[1]?.raw_json || "{}")).toMatchObject({
      route: "/api/assistant/chat/turn/stream",
      stream: true,
      streamOutcome: "completed",
      mode: "advanced",
      attachmentCount: 1,
      attachmentManifest: [
        {
          id: "att-1",
          kind: "text",
        },
      ],
      performance: {
        route: {
          version: 1,
          durableObjectStreamMs: expect.any(Number),
          routeToRuntimeDoneMs: expect.any(Number),
        },
        runtime: {
          executionMs: 12,
          durableObjectTotalMs: 20,
        },
        stream: {
          timeToFirstTokenMs: 8,
          totalDurationMs: 12,
        },
      },
    });
  });

  it("requires @site on streaming assistant site update turns", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addAssistantEditableSite(env);
    const runtimeFetch = vi.fn(async () =>
      Response.json({
        ok: true,
        auditId: null,
        turnId: "turn-stream-agent",
        specialist: "core.agent-chat",
        replyText: "Agent chat reply.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      }),
    );
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: 'Update my site short bio field to say "Streaming unsafe write."',
        }),
      }),
      env,
    );
    const streamText = await response.text();

    expect(response.status).toBe(200);
    expect(streamText).toContain("event: delta");
    expect(streamText).toContain("Add @site");
    expect(streamText).toContain("core.assistant-scopes");
    expect(runtimeFetch).not.toHaveBeenCalled();
    expect(siteFileText(env, "site-assistant", "src/me.json")).not.toContain(
      "Streaming unsafe write.",
    );
  });

  it("records stopped owner assistant streams in sandbox audit metadata", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const abortController = new AbortController();
    const runtimeFetch = vi.fn(async () => {
      abortController.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        signal: abortController.signal,
        body: JSON.stringify({ messageText: "Stop this" }),
      }),
      env,
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(env.agentEvents[1]).toMatchObject({
      channel: "sandbox",
      direction: "system",
      event_type: "message",
      status: "skipped",
    });
    expect(JSON.parse(env.agentEvents[1]?.raw_json || "{}")).toMatchObject({
      route: "/api/assistant/chat/turn/stream",
      stream: true,
      streamOutcome: "stopped",
      threadId: env.assistantThreads[0]?.id,
    });
  });

  it("loads persisted assistant thread messages for refresh resilience", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.assistantThreads.push({
      id: "thread-1",
      owner_id: "owner",
      title: "Project check-in",
      origin_surface: "assistant",
      project_id: null,
      status: "active",
      pinned_at: null,
      archived_at: null,
      deleted_at: null,
      last_message_at: "2026-05-11T10:07:00Z",
      created_at: "2026-05-11T10:06:00Z",
      updated_at: "2026-05-11T10:07:00Z",
    });
    env.messages.push(
      {
        id: "message-1",
        ownerId: "owner",
        role: "user",
        content: "What should I do next?",
        threadId: "thread-1",
        created_at: "2026-05-11T10:06:00Z",
      },
      {
        id: "message-2",
        ownerId: "owner",
        role: "assistant",
        content: "Done. I set a reminder for tomorrow: follow up with Sam.",
        threadId: "thread-1",
        created_at: "2026-05-11T10:07:00Z",
        metadata_json: JSON.stringify({
          actionCards: [
            {
              id: "reminder:reminder-1",
              kind: "reminder.created",
              capabilityId: "core.reminders.create",
              title: "Reminder created",
              summary: "follow up with Sam",
              status: "complete",
              statusLabel: "Complete",
              changed: [
                { label: "Reminder", value: "follow up with Sam" },
                { label: "When", value: "1 Jun 2026, 09:00" },
              ],
              records: [{ kind: "reminder", id: "reminder-1" }],
              primaryAction: { label: "Open calendar", href: "/calendar" },
              secondaryActions: [],
            },
          ],
        }),
      },
      {
        id: "message-3",
        ownerId: "owner",
        role: "assistant",
        content: "Done. I saved that email as a draft in `/email` for your review.",
        threadId: "thread-1",
        created_at: "2026-05-11T10:08:00Z",
        metadata_json: JSON.stringify({
          actionCards: [
            {
              id: "mailbox-draft:draft-1",
              kind: "mailbox.draft_saved",
              capabilityId: "core.mailbox.draft",
              title: "Email draft saved",
              summary: "Saved to mailbox drafts for review. It has not been sent.",
              status: "pending_approval",
              statusLabel: "Needs review",
              changed: [
                { label: "To", value: "ada@example.com" },
                { label: "Subject", value: "Launch notes" },
              ],
              records: [{ kind: "mailbox_draft", id: "draft-1" }],
              primaryAction: { label: "Review draft", href: "/email" },
              secondaryActions: [],
            },
          ],
        }),
      },
      {
        id: "message-4",
        ownerId: "owner",
        role: "assistant",
        content: "Draft saved. I updated your site draft.",
        threadId: "thread-1",
        created_at: "2026-05-11T10:09:00Z",
        metadata_json: JSON.stringify({
          siteAction: {
            kind: "draft_created",
            siteId: "site-1",
            username: "test",
            pending: true,
            published: false,
            files: ["blog/cats.md"],
            postTitle: "Cats",
            url: "http://localhost:4000/sites/test?edit=blog",
          },
        }),
      },
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/threads/thread-1/messages", {
        headers: { Cookie: session },
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      thread: {
        id: "thread-1",
        title: "Project check-in",
        status: "active",
      },
      messages: [
        { id: "message-1", role: "user", text: "What should I do next?" },
        {
          id: "message-2",
          role: "assistant",
          text: "Done. I set a reminder for tomorrow: follow up with Sam.",
          actionCards: [
            {
              kind: "reminder.created",
              title: "Reminder created",
              records: [{ kind: "reminder", id: "reminder-1" }],
              primaryAction: { label: "Open calendar", href: "/calendar" },
            },
          ],
        },
        {
          id: "message-3",
          role: "assistant",
          actionCards: [
            {
              kind: "mailbox.draft_saved",
              title: "Email draft saved",
              records: [{ kind: "mailbox_draft", id: "draft-1" }],
              primaryAction: { label: "Review draft", href: "/email" },
            },
          ],
        },
        {
          id: "message-4",
          role: "assistant",
          siteAction: {
            kind: "draft_created",
            postTitle: "Cats",
            url: "http://localhost:4000/sites/test?edit=blog",
          },
        },
      ],
    });
  });

  it("lists active assistant threads for the assistant history panel", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.assistantThreads.push(
      {
        id: "thread-older",
        owner_id: "owner",
        title: "Older chat",
        origin_surface: "assistant",
        project_id: null,
        status: "active",
        pinned_at: null,
        archived_at: null,
        deleted_at: null,
        last_message_at: "2026-05-10T10:00:00Z",
        created_at: "2026-05-10T09:00:00Z",
        updated_at: "2026-05-10T10:00:00Z",
      },
      {
        id: "thread-newer",
        owner_id: "owner",
        title: "Newer chat",
        origin_surface: "assistant",
        project_id: null,
        status: "active",
        pinned_at: null,
        archived_at: null,
        deleted_at: null,
        last_message_at: "2026-05-11T10:00:00Z",
        created_at: "2026-05-11T09:00:00Z",
        updated_at: "2026-05-11T10:00:00Z",
      },
      {
        id: "thread-archived",
        owner_id: "owner",
        title: "Archived chat",
        origin_surface: "assistant",
        project_id: null,
        status: "archived",
        pinned_at: null,
        archived_at: "2026-05-11T11:00:00Z",
        deleted_at: null,
        last_message_at: "2026-05-11T08:00:00Z",
        created_at: "2026-05-11T07:00:00Z",
        updated_at: "2026-05-11T11:00:00Z",
      },
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/threads", {
        headers: { Cookie: session },
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      threads: [
        { id: "thread-newer", title: "Newer chat", status: "active" },
        { id: "thread-older", title: "Older chat", status: "active" },
      ],
    });
  });

  it("assigns assistant threads to Mission Control projects", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.missionProjects.push({
      id: "project-1",
      user_id: "owner",
      name: "me3-core",
      slug: "me3-core",
      status: "active",
    });
    env.assistantThreads.push({
      id: "thread-1",
      owner_id: "owner",
      title: "Project chat",
      origin_surface: "assistant",
      project_id: null,
      status: "active",
      pinned_at: null,
      archived_at: null,
      deleted_at: null,
      last_message_at: "2026-05-11T10:00:00Z",
      created_at: "2026-05-11T09:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/threads/thread-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ projectId: "project-1" }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      thread: { id: "thread-1", projectId: "project-1" },
    });
    expect(env.assistantThreads[0]?.project_id).toBe("project-1");
  });

  it("searches active assistant transcript text without returning archived chats", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.assistantThreads.push(
      {
        id: "thread-active",
        owner_id: "owner",
        title: "Launch planning",
        origin_surface: "assistant",
        project_id: null,
        status: "active",
        pinned_at: null,
        archived_at: null,
        deleted_at: null,
        last_message_at: "2026-05-11T10:00:00Z",
        created_at: "2026-05-11T09:00:00Z",
        updated_at: "2026-05-11T10:00:00Z",
      },
      {
        id: "thread-archived",
        owner_id: "owner",
        title: "Alpha archive",
        origin_surface: "assistant",
        project_id: null,
        status: "archived",
        pinned_at: null,
        archived_at: "2026-05-11T11:00:00Z",
        deleted_at: null,
        last_message_at: "2026-05-11T08:00:00Z",
        created_at: "2026-05-11T07:00:00Z",
        updated_at: "2026-05-11T11:00:00Z",
      },
    );
    env.messages.push({
      id: "message-1",
      ownerId: "owner",
      role: "assistant",
      content: "Alpha plan lives here.",
      threadId: "thread-active",
      created_at: "2026-05-11T10:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/threads?q=alpha", {
        headers: { Cookie: session },
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      threads: [{ id: "thread-active", status: "active" }],
    });
  });

  it("exports assistant transcripts and tombstones deleted transcript text", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.assistantThreads.push({
      id: "thread-1",
      owner_id: "owner",
      title: "Export me",
      origin_surface: "assistant",
      project_id: null,
      status: "active",
      pinned_at: null,
      archived_at: null,
      deleted_at: null,
      last_message_at: "2026-05-11T10:00:00Z",
      created_at: "2026-05-11T09:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    });
    env.messages.push({
      id: "message-1",
      ownerId: "owner",
      role: "user",
      content: "Keep this in transcript export only.",
      threadId: "thread-1",
      created_at: "2026-05-11T10:00:00Z",
    });

    const exportResponse = await app.fetch(
      new Request("http://localhost/api/assistant/threads/thread-1/export", {
        headers: { Cookie: session },
      }),
      env,
    );
    const exportPayload = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exportPayload).toMatchObject({
      thread: { id: "thread-1" },
      messages: [{ id: "message-1", text: "Keep this in transcript export only." }],
    });

    const deleteResponse = await app.fetch(
      new Request("http://localhost/api/assistant/threads/thread-1", {
        method: "DELETE",
        headers: { Cookie: session },
      }),
      env,
    );

    expect(deleteResponse.status).toBe(200);
    expect(env.assistantThreads[0]?.status).toBe("deleted");
    expect(env.messages[0]?.content).toBe("");
  });

  it("bulk deletes archived assistant threads", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.assistantThreads.push(
      {
        id: "thread-active",
        owner_id: "owner",
        title: "Keep me",
        origin_surface: "assistant",
        project_id: null,
        status: "active",
        pinned_at: null,
        archived_at: null,
        deleted_at: null,
        last_message_at: "2026-05-11T10:00:00Z",
        created_at: "2026-05-11T09:00:00Z",
        updated_at: "2026-05-11T10:00:00Z",
      },
      {
        id: "thread-archived-1",
        owner_id: "owner",
        title: "Archive one",
        origin_surface: "assistant",
        project_id: null,
        status: "archived",
        pinned_at: null,
        archived_at: "2026-05-11T11:00:00Z",
        deleted_at: null,
        last_message_at: "2026-05-11T08:00:00Z",
        created_at: "2026-05-11T07:00:00Z",
        updated_at: "2026-05-11T11:00:00Z",
      },
      {
        id: "thread-archived-2",
        owner_id: "owner",
        title: "Archive two",
        origin_surface: "assistant",
        project_id: null,
        status: "archived",
        pinned_at: null,
        archived_at: "2026-05-11T12:00:00Z",
        deleted_at: null,
        last_message_at: "2026-05-11T09:00:00Z",
        created_at: "2026-05-11T07:30:00Z",
        updated_at: "2026-05-11T12:00:00Z",
      },
    );
    env.messages.push(
      {
        id: "message-active",
        ownerId: "owner",
        role: "user",
        content: "Keep this.",
        threadId: "thread-active",
        created_at: "2026-05-11T10:00:00Z",
      },
      {
        id: "message-archived-1",
        ownerId: "owner",
        role: "user",
        content: "Delete this.",
        threadId: "thread-archived-1",
        created_at: "2026-05-11T10:00:00Z",
      },
      {
        id: "message-archived-2",
        ownerId: "owner",
        role: "assistant",
        content: "Delete this too.",
        threadId: "thread-archived-2",
        created_at: "2026-05-11T10:01:00Z",
      },
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/threads?status=archived", {
        method: "DELETE",
        headers: { Cookie: session },
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, deleted: 2 });
    expect(
      env.assistantThreads.find((thread) => thread.id === "thread-active")?.status,
    ).toBe("active");
    expect(
      env.assistantThreads.filter((thread) => thread.status === "archived"),
    ).toHaveLength(0);
    expect(env.messages.find((message) => message.id === "message-active")?.content).toBe(
      "Keep this.",
    );
    expect(env.messages.find((message) => message.id === "message-archived-1")?.content).toBe(
      "",
    );
    expect(env.messages.find((message) => message.id === "message-archived-2")?.content).toBe(
      "",
    );
  });

  it.each([
    ["normal", "/api/assistant/chat/turn"],
    ["streaming", "/api/assistant/chat/turn/stream"],
  ])("rejects invalid assistant modes on the %s endpoint", async (_kind, path) => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ messageText: "Hello agent", mode: "Everyday" }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      ok: false,
      error: "mode must be everyday, advanced, or owner",
    });
  });

  it.each([
    ["/api/assistant/chat/turn", "everyday"],
    ["/api/assistant/chat/turn", "advanced"],
    ["/api/assistant/chat/turn/stream", "everyday"],
    ["/api/assistant/chat/turn/stream", "advanced"],
  ])(
    "rejects managed raw model overrides on %s in %s mode",
    async (path, mode) => {
      const env = createEnv();
      env.ME3_DEPLOYMENT_MODE = "managed";
      const session = cookieHeader(await bootstrap(env));

      const response = await app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({
            messageText: "Hello agent",
            mode,
            model: { providerId: "workers-ai", model: "@cf/example/model" },
          }),
        }),
        env,
      );
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toMatchObject({
        ok: false,
        error:
          "Raw model overrides are not allowed for managed everyday or advanced modes",
      });
    },
  );

  it("retains raw model selection for explicitly enabled managed evaluation installs", async () => {
    const env = createEnv();
    env.ME3_DEPLOYMENT_MODE = "managed";
    env.ME3_AI_RAW_MODEL_SELECTION_ENABLED = "yes";
    const session = cookieHeader(await bootstrap(env));
    const runtimeBodies: Array<Record<string, unknown>> = [];
    const runtimeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      runtimeBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      return Response.json({
        ok: true,
        specialist: "core.agent-chat",
        replyText: "Evaluation reply.",
      });
    });
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          messageText: "Evaluate this model",
          mode: "advanced",
          model: {
            providerId: "workers-ai",
            model: "@cf/evaluation/model",
            optionId: "evaluation-model",
          },
        }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, mode: "advanced" });
    expect(runtimeBodies[0]).toMatchObject({
      mode: "advanced",
      selectedModel: {
        providerId: "workers-ai",
        model: "@cf/evaluation/model",
        optionId: "evaluation-model",
      },
    });
  });

  it("allows managed owner mode to reach the runtime with its requested model", async () => {
    const env = createEnv();
    env.ME3_DEPLOYMENT_MODE = "managed";
    const session = cookieHeader(await bootstrap(env));
    const runtimeBodies: Array<Record<string, unknown>> = [];
    const runtimeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      runtimeBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      return Response.json({
        ok: true,
        specialist: "core.agent-chat",
        replyText: "Owner AI reply.",
      });
    });
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          messageText: "Use my provider",
          mode: "owner",
          model: {
            providerId: "openai",
            model: "gpt-owner",
            optionId: "openai-owner",
          },
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(runtimeBodies[0]).toMatchObject({
      mode: "owner",
      selectedModel: {
        providerId: "openai",
        model: "gpt-owner",
        optionId: "openai-owner",
      },
    });
  });

  it("rejects unsupported assistant chat model selections", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          messageText: "Hello agent",
          model: { providerId: "made-up", model: "whatever" },
        }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      ok: false,
      error: "model.providerId is not supported",
    });
  });

  it("keeps the legacy sandbox chat endpoint as an alias", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const runtimeFetch = vi.fn(async () =>
      Response.json({
        ok: true,
        auditId: null,
        turnId: "turn-1",
        specialist: "core.agent-chat",
        replyText: "Hello from the legacy alias.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      }),
    );

    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.fetch(
      new Request("http://localhost/api/agent/sandbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ messageText: "Hello legacy route" }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      replyText: "Hello from the legacy alias.",
    });
    expect(runtimeFetch).toHaveBeenCalledOnce();
  });

  it("blocks assistant chat turns when the Agent Chat plugin is disabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/plugins/me3.agent-chat/deactivate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/assistant/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ messageText: "Hello agent" }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      ok: false,
      error: "Agent Chat plugin is disabled",
    });
    expect(env.agentEvents).toHaveLength(0);
  });

  it("creates owner reminders through the agent chat package surface", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/agent/reminders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          title: "Follow up with Sam",
          notes: "Ask about the proposal",
          date: "2026-05-20",
          time: "09:30",
          timezone: "Europe/Dublin",
          recurrence: "weekly",
        }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      reminder: {
        title: "Follow up with Sam",
        notes: "Ask about the proposal",
        timezone: "Europe/Dublin",
        recurrenceRule: "weekly:wed",
        status: "pending",
      },
    });
    expect(env.reminders).toHaveLength(1);
    expect(env.reminders[0]).toMatchObject({
      user_id: "owner",
      title: "Follow up with Sam",
      recurrence_rule: "weekly:wed",
    });
  });

  it("creates calendar events when the web form submits no recurrence", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/calendar/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          title: "Lads tonight",
          startDate: "2026-06-22",
          startTime: "18:00",
          endDate: "2026-06-23",
          endTime: "18:00",
          timezone: "Europe/Dublin",
          allDay: false,
          recurrenceRule: "none",
        }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      event: {
        title: "Lads tonight",
        timezone: "Europe/Dublin",
        allDay: false,
        recurrenceRule: null,
      },
    });
    expect(env.userCalendarEvents).toHaveLength(1);
    expect(env.userCalendarEvents[0]).toMatchObject({
      user_id: "owner",
      title: "Lads tonight",
      recurrence_rule: null,
    });
  });

  it("creates owner contacts through the agent chat package surface", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          name: "Sam Client",
          email: "SAM@EXAMPLE.COM",
          relationship: "prospect",
          tags: ["proposal"],
          closeness: "close",
          socialHandles: { linkedin: "sam-client" },
        }),
      }),
      env,
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      ok: true,
      contact: {
        name: "Sam Client",
        email: "sam@example.com",
        relationship: "prospect",
        status: "active",
        closeness: "close",
        tags: ["proposal"],
        socialHandles: { linkedin: "sam-client" },
      },
    });
    expect(env.contacts).toHaveLength(1);
    expect(env.contacts[0]).toMatchObject({
      user_id: "owner",
      name: "Sam Client",
      email: "sam@example.com",
      relationship: "prospect",
    });
  });

  it("returns a friendly duplicate contact email error", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.contacts.push({
      id: "existing-contact",
      user_id: "owner",
      name: "Existing Sam",
      email: "kieranbutler22@gmail.com",
      phone: null,
      source: "manual",
      source_ref: null,
      relationship: "contact",
      status: "active",
      notes: null,
      tags: "[]",
      last_interaction_at: null,
      next_followup_at: null,
      outreach_status: null,
      social_handles: "{}",
      metadata: null,
      created_at: "2026-05-13T20:00:00Z",
      updated_at: "2026-05-13T20:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          name: "Sam",
          email: "KIERANBUTLER22@gmail.com",
        }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This email is already saved as a contact.",
    });
    expect(env.contacts).toHaveLength(1);
  });

  it("loads account settings for the signed-in owner", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/account", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      user: { email: string; timezone: string; locale: string; localeSource: string };
    };

    expect(response.status).toBe(200);
    expect(body.user.email).toBe("owner@example.com");
    expect(body.user.timezone).toBeNull();
    expect(body.user.locale).toBe("en-US");
    expect(body.user.localeSource).toBe("inferred");
  });

  it("disables direct Stripe key setup on managed hosting while allowing removal and currency changes", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.ME3_DEPLOYMENT_MODE = "managed";
    const headers = { "Content-Type": "application/json", Cookie: session };
    const status = await app.fetch(new Request("http://localhost/api/commerce/status", { headers }), env);
    expect(await status.json()).toMatchObject({ stripe: { directKeySetupAllowed: false } });
    for (const body of [{ stripeSecretKey: "sk_test_managed_setup" }, { preferredStripeProvider: "direct" }]) {
      const response = await app.fetch(new Request("http://localhost/api/commerce/settings", {
        method: "PUT", headers, body: JSON.stringify(body),
      }), env);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "Use Stripe Connect for payments on managed hosting." });
    }
    const response = await app.fetch(new Request("http://localhost/api/commerce/settings", {
      method: "PUT", headers, body: JSON.stringify({ clearStripeSecretKey: true, defaultCurrency: "EUR" }),
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ defaultCurrency: "EUR", stripe: { directKeySetupAllowed: false } });
  });

  it("stores Stripe payment settings for the signed-in owner", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.TOKEN_ENCRYPTION_KEY = undefined;

    await app.fetch(
      new Request("http://localhost/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({ timezone: "Europe/Dublin" }),
      }),
      env,
    );

    const beforeResponse = await app.fetch(
      new Request("http://localhost/api/commerce/status", {
        headers: { Cookie: session },
      }),
      env,
    );
    const beforeBody = (await beforeResponse.json()) as {
      encryptionConfigured: boolean;
      defaultCurrency: string;
      stripe: { configured: boolean; source: string; keyHint: string | null };
    };

    expect(beforeResponse.status).toBe(200);
    expect(beforeBody.encryptionConfigured).toBe(false);
    expect(beforeBody.defaultCurrency).toBe("EUR");
    expect(beforeBody.stripe).toMatchObject({
      directKeySetupAllowed: true,
      configured: false,
      source: "not_configured",
      keyHint: null,
    });

    const saveResponse = await app.fetch(
      new Request("http://localhost/api/commerce/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          defaultCurrency: "GBP",
          stripeSecretKey: ["sk", "test", "accountsettings1234"].join("_"),
        }),
      }),
      env,
    );
    const saveBody = (await saveResponse.json()) as {
      defaultCurrency: string;
      stripe: { configured: boolean; source: string; keyHint: string | null };
    };

    expect(saveResponse.status).toBe(200);
    expect(env.installSecrets.get("TOKEN_ENCRYPTION_KEY")).toMatch(/^[a-f0-9]{64}$/);
    expect(saveBody.defaultCurrency).toBe("GBP");
    expect(saveBody.stripe).toMatchObject({
      configured: true,
      source: "stored",
      keyHint: "***1234",
    });

    const clearResponse = await app.fetch(
      new Request("http://localhost/api/commerce/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({ clearStripeSecretKey: true }),
      }),
      env,
    );
    const clearBody = (await clearResponse.json()) as {
      defaultCurrency: string;
      stripe: { configured: boolean; source: string; keyHint: string | null };
    };

    expect(clearResponse.status).toBe(200);
    expect(clearBody.defaultCurrency).toBe("GBP");
    expect(clearBody.stripe).toMatchObject({
      configured: false,
      source: "not_configured",
      keyHint: null,
    });
  });

  it("starts managed Stripe onboarding from owner payment settings", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.ME3_COMMERCE_BRIDGE_ORIGIN = "https://commerce.me3.example";
    env.ME3_COMMERCE_BRIDGE_TOKEN = "bridge-token";
    env.CORE_WEB_ORIGIN = "https://core.example";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        connected: false,
        status: "not_connected",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        url: "https://connect.stripe.test/onboard",
        accountId: "acct_123",
        mode: "onboard",
      })));

    const statusResponse = await app.fetch(
      new Request("http://localhost/api/commerce/status", {
        headers: { Cookie: session },
      }),
      env,
    );
    expect(await statusResponse.json()).toMatchObject({
      stripe: {
        configured: false,
        source: "managed",
        mode: "managed",
        connectionStatus: "not_connected",
      },
    });

    const onboardResponse = await app.fetch(
      new Request("http://localhost/api/commerce/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({ country: "IE" }),
      }),
      env,
    );
    expect(onboardResponse.status).toBe(200);
    expect(await onboardResponse.json()).toMatchObject({
      url: "https://connect.stripe.test/onboard",
      accountId: "acct_123",
    });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      country: "IE",
      returnUrl: "https://core.example/settings?section=payments",
    });
    fetchMock.mockRestore();
  });

  it("switches to Stripe Connect without deleting a stored direct key", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const directResponse = await app.fetch(
      new Request("http://localhost/api/commerce/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          stripeSecretKey: ["sk", "test", "providerfallback1234"].join("_"),
        }),
      }),
      env,
    );
    expect(directResponse.status).toBe(200);

    env.ME3_COMMERCE_BRIDGE_ORIGIN = "https://commerce.me3.example";
    env.ME3_COMMERCE_BRIDGE_TOKEN = "bridge-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        connected: true,
        status: "active",
        accountId: "acct_123",
        chargesEnabled: true,
        payoutsEnabled: true,
        requirementsDue: [],
      }))
    );

    const managedResponse = await app.fetch(
      new Request("http://localhost/api/commerce/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({ preferredStripeProvider: "managed" }),
      }),
      env,
    );
    expect(managedResponse.status).toBe(200);
    expect(await managedResponse.json()).toMatchObject({
      stripe: {
        configured: true,
        source: "managed",
        mode: "managed",
        preferredProvider: "managed",
        directConfigured: true,
        directSource: "stored",
        managedAvailable: true,
      },
    });
    expect(env.commerceSettings?.preferred_stripe_provider).toBe("managed");
    expect(env.commerceSettings?.encrypted_stripe_secret_key).toBeTruthy();

    const fallbackResponse = await app.fetch(
      new Request("http://localhost/api/commerce/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({ preferredStripeProvider: "direct" }),
      }),
      env,
    );
    expect(fallbackResponse.status).toBe(200);
    expect(await fallbackResponse.json()).toMatchObject({
      stripe: {
        source: "stored",
        mode: "direct",
        preferredProvider: "direct",
      },
    });
    fetchMock.mockRestore();
  });

  describe("public booking routes", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

  it("creates confirmed free bookings from public generated sites", async () => {
    const env = createEnv();
    await bootstrap(env);
    addBookableSite(env);
    addReadyCloudflareEmailProvider(env);

    const response = await app.fetch(
      new Request("http://localhost/api/book/owner/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          localDate: "2026-06-09",
          localTime: "15:15",
          guestName: "Test Guest",
          guestEmail: "guest@example.com",
          notes: "Looking forward to it.",
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      booking: { guestEmail: string; startsAt: string; paymentStatus: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.booking).toMatchObject({
      guestEmail: "guest@example.com",
      startsAt: "2026-06-09T14:15:00.000Z",
      paymentStatus: "not_required",
    });
    expect(env.bookings).toHaveLength(1);
    expect(env.bookings[0]).toMatchObject({
      offer_id: "free-session",
      guest_email: "guest@example.com",
      payment_status: "not_required",
      is_free_booking: 1,
    });
    expect(env.emailSends).toHaveLength(2);
    expect(env.emailSends[0]).toMatchObject({
      to: "guest@example.com",
      subject: "Booking confirmed: Free session",
    });
    expect(String(env.emailSends[0].text)).toContain("Add to Google Calendar:");
    expect(String(env.emailSends[0].html)).toContain("Add to Google Calendar");
    expect(String(env.emailSends[0].html)).toContain("20260609T141500Z%2F20260609T151500Z");
    expect(env.emailSends[1]).toMatchObject({
      to: "owner@example.com",
      subject: "New booking: Test Guest",
    });
  });

  it("confirms pay-separately bookings and emails the selected amount", async () => {
    const env = createEnv();
    await bootstrap(env);
    addBookableSite(env, {
      enabled: true,
      offers: [
        {
          id: "manual-session",
          title: "Manual session",
          duration: 60,
          pricing: {
            enabled: true,
            suggestedAmount: 80,
            currency: "EUR",
            minimumAmount: 50,
            allowFlexiblePricing: true,
            paymentMethod: "manual",
            paymentInstructions: "Pay at https://pay.example/session",
          },
        },
      ],
      availability: {
        timezone: "Europe/Dublin",
        windows: { tuesday: ["15:00-16:30"] },
      },
    });
    addReadyCloudflareEmailProvider(env);

    const response = await app.fetch(
      new Request("http://localhost/api/book/owner/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "manual-session",
          localDate: "2026-06-09",
          localTime: "15:15",
          guestName: "Manual Guest",
          guestEmail: "manual@example.com",
          amount: 95,
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(env.bookings[0]).toMatchObject({
      suggested_amount: 9500,
      currency: "eur",
      payment_status: "not_required",
      is_free_booking: 0,
    });
    expect(env.emailSends[0]).toMatchObject({
      to: "manual@example.com",
      text: expect.stringContaining("Amount due: €95.00"),
    });
    expect(String(env.emailSends[0].text)).toContain(
      "Payment details:\nPay at https://pay.example/session",
    );
  });

  it("adds custom booking confirmation copy and can skip host copies", async () => {
    const env = createEnv();
    await bootstrap(env);
    addBookableSite(env, {
      enabled: true,
      offers: [
        {
          id: "free-session",
          title: "Free session",
          duration: 60,
          pricing: { enabled: false },
        },
      ],
      availability: {
        timezone: "Europe/Dublin",
        windows: { tuesday: ["15:00-16:30"] },
      },
      confirmationEmail: {
        message:
          "Hi {{ guestName }}, bring your questions for {{ bookingTitle }} at {{ bookingTime }}.",
        sendHostCopy: false,
      },
    });
    addReadyCloudflareEmailProvider(env);

    const response = await app.fetch(
      new Request("http://localhost/api/book/owner/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          localDate: "2026-06-09",
          localTime: "15:15",
          guestName: "Test Guest",
          guestEmail: "guest@example.com",
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(env.emailSends).toHaveLength(1);
    expect(env.emailSends[0]).toMatchObject({
      to: "guest@example.com",
      subject: "Booking confirmed: Free session",
    });
    expect(String(env.emailSends[0].text)).toContain(
      "Hi Test Guest, bring your questions for Free session at",
    );
  });

  it("rejects invalid and overlapping free public bookings", async () => {
    const env = createEnv();
    addBookableSite(env);

    const invalidEmailResponse = await app.fetch(
      new Request("http://localhost/api/book/owner/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          localDate: "2026-06-09",
          localTime: "15:15",
          guestName: "Test Guest",
          guestEmail: "test.com",
        }),
      }),
      env,
    );
    const invalidEmailBody = (await invalidEmailResponse.json()) as { error: string };

    expect(invalidEmailResponse.status).toBe(400);
    expect(invalidEmailBody.error).toBe("Enter a valid email address");
    expect(env.bookings).toHaveLength(0);

    const firstResponse = await app.fetch(
      new Request("http://localhost/api/book/owner/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          localDate: "2026-06-09",
          localTime: "15:15",
          guestName: "First Guest",
          guestEmail: "first@example.com",
        }),
      }),
      env,
    );
    expect(firstResponse.status).toBe(200);

    const overlapResponse = await app.fetch(
      new Request("http://localhost/api/book/owner/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          localDate: "2026-06-09",
          localTime: "15:30",
          guestName: "Second Guest",
          guestEmail: "second@example.com",
        }),
      }),
      env,
    );
    const overlapBody = (await overlapResponse.json()) as { error: string };

    expect(overlapResponse.status).toBe(409);
    expect(overlapBody.error).toBe("That time has already been booked");
    expect(env.bookings).toHaveLength(1);
  });

  it("returns public slots for a single offer and excludes active holds", async () => {
    const env = createEnv();
    addBookableSite(env, {
      enabled: true,
      offers: [
        {
          id: "free-session",
          title: "Free session",
          duration: 60,
          pricing: { enabled: false },
        },
      ],
      availability: {
        timezone: "Europe/Dublin",
        windows: { tuesday: ["15:00-17:30"] },
      },
    });
    env.bookingHolds.push({
      id: "hold-1",
      site_id: "site-booking",
      booking_id: null,
      offer_id: "free-session",
      booking_type: "one_to_one",
      hold_token: "hold-token",
      slot_start: "2026-06-09T14:00:00.000Z",
      slot_end: "2026-06-09T15:00:00.000Z",
      status: "active",
      expires_at: "2099-01-01T00:00:00.000Z",
      created_at: "2026-06-05T12:00:00.000Z",
      updated_at: "2026-06-05T12:00:00.000Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/book/owner/slots?date=2026-06-09"),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      timezone: string;
      offer: { id: string; duration: number };
      slots: Array<{ localTime: string; slotStart: string; slotEnd: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.timezone).toBe("Europe/Dublin");
    expect(body.offer).toMatchObject({ id: "free-session", duration: 60 });
    expect(body.slots.map((slot) => slot.localTime)).toEqual([
      "16:00",
      "16:15",
      "16:30",
    ]);
    expect(body.slots[0]).toMatchObject({
      slotStart: "2026-06-09T15:00:00.000Z",
      slotEnd: "2026-06-09T16:00:00.000Z",
    });
  });

  it("requires offerId for multi-offer public slot lookup", async () => {
    const env = createEnv();
    addBookableSite(env, {
      enabled: true,
      offers: [
        { id: "intro", title: "Intro", duration: 30, pricing: { enabled: false } },
        { id: "deep-dive", title: "Deep Dive", duration: 60, pricing: { enabled: false } },
      ],
      availability: {
        timezone: "UTC",
        windows: { tuesday: ["09:00-10:00"] },
      },
    });

    const missingOfferResponse = await app.fetch(
      new Request("http://localhost/api/book/owner/slots?date=2026-06-09"),
      env,
    );
    const missingOfferBody = (await missingOfferResponse.json()) as { error: string };

    expect(missingOfferResponse.status).toBe(400);
    expect(missingOfferBody.error).toBe(
      "offerId is required when multiple booking offers exist",
    );

    const response = await app.fetch(
      new Request(
        "http://localhost/api/book/owner/slots?date=2026-06-09&offerId=intro",
      ),
      env,
    );
    const body = (await response.json()) as {
      offer: { id: string; duration: number };
      slots: Array<{ localTime: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.offer).toMatchObject({ id: "intro", duration: 30 });
    expect(body.slots.map((slot) => slot.localTime)).toEqual([
      "09:00",
      "09:15",
      "09:30",
    ]);
  });

  it("confirms free bookings through the public action contract", async () => {
    const env = createEnv();
    addBookableSite(env);

    const response = await app.fetch(
      new Request("http://localhost/api/book/owner/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          slotStart: "2026-06-09T14:15:00.000Z",
          slotEnd: "2026-06-09T15:15:00.000Z",
          guestName: "Contract Guest",
          guestEmail: "contract@example.com",
          notes: "Booked through me.json action.",
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      booking: { guestEmail: string; startsAt: string; endsAt: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.booking).toMatchObject({
      guestEmail: "contract@example.com",
      startsAt: "2026-06-09T14:15:00.000Z",
      endsAt: "2026-06-09T15:15:00.000Z",
    });
    expect(env.bookings).toHaveLength(1);
    expect(env.bookings[0]).toMatchObject({
      offer_id: "free-session",
      guest_email: "contract@example.com",
      payment_status: "not_required",
    });
  });

  it("rejects overlaps and missing availability through the public contract", async () => {
    const env = createEnv();
    addBookableSite(env);

    const firstResponse = await app.fetch(
      new Request("http://localhost/api/book/owner/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          slotStart: "2026-06-09T14:15:00.000Z",
          slotEnd: "2026-06-09T15:15:00.000Z",
          guestName: "First Guest",
          guestEmail: "first@example.com",
        }),
      }),
      env,
    );
    expect(firstResponse.status).toBe(200);

    const overlapResponse = await app.fetch(
      new Request("http://localhost/api/book/owner/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          slotStart: "2026-06-09T14:30:00.000Z",
          slotEnd: "2026-06-09T15:30:00.000Z",
          guestName: "Second Guest",
          guestEmail: "second@example.com",
        }),
      }),
      env,
    );
    const overlapBody = (await overlapResponse.json()) as { error: string };

    expect(overlapResponse.status).toBe(409);
    expect(overlapBody.error).toBe("That time has already been booked");

    const missingAvailabilityResponse = await app.fetch(
      new Request("http://localhost/api/book/owner/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "free-session",
          slotStart: "2026-06-10T14:15:00.000Z",
          slotEnd: "2026-06-10T15:15:00.000Z",
          guestName: "Wednesday Guest",
          guestEmail: "wednesday@example.com",
        }),
      }),
      env,
    );
    const missingAvailabilityBody = (await missingAvailabilityResponse.json()) as {
      error: string;
    };

    expect(missingAvailabilityResponse.status).toBe(400);
    expect(missingAvailabilityBody.error).toBe(
      "This date is not available for bookings",
    );
  });

  it("routes paid public confirmations to checkout", async () => {
    const env = createEnv();
    addBookableSite(env, {
      enabled: true,
      offers: [
        {
          id: "paid-session",
          title: "Paid Session",
          duration: 60,
          pricing: {
            enabled: true,
            suggestedAmount: 75,
            currency: "EUR",
            minimumAmount: 5,
          },
        },
      ],
      availability: {
        timezone: "Europe/Dublin",
        windows: { tuesday: ["15:00-16:30"] },
      },
    });

    const response = await app.fetch(
      new Request("http://localhost/api/book/owner/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "paid-session",
          slotStart: "2026-06-09T14:15:00.000Z",
          slotEnd: "2026-06-09T15:15:00.000Z",
          guestName: "Paid Guest",
          guestEmail: "paid@example.com",
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      error: string;
      action: string;
      checkoutUrl: string;
    };

    expect(response.status).toBe(402);
    expect(body).toMatchObject({
      error: "Use checkout for paid booking offers",
      action: "createBookingCheckout",
      checkoutUrl: "/api/book/owner/checkout-session",
    });
    expect(env.bookings).toHaveLength(0);
  });

  it("finalizes paid booking checkout from a signed Stripe webhook", async () => {
    const env = createEnv();
    await bootstrap(env);
    addReadyCloudflareEmailProvider(env);
    env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
    addBookableSite(env, {
      enabled: true,
      offers: [
        {
          id: "paid-session",
          title: "Paid Session",
          duration: 60,
          pricing: {
            enabled: true,
            suggestedAmount: 75,
            currency: "EUR",
            minimumAmount: 5,
          },
        },
      ],
      availability: {
        timezone: "Europe/Dublin",
        windows: { tuesday: ["15:00-16:30"] },
      },
    });
    env.bookingHolds.push({
      id: "hold-paid",
      site_id: "site-booking",
      booking_id: null,
      offer_id: "paid-session",
      booking_type: "one_to_one",
      hold_token: "hold-paid-token",
      slot_start: "2026-06-09T14:15:00.000Z",
      slot_end: "2026-06-09T15:15:00.000Z",
      status: "active",
      expires_at: "2099-01-01T00:00:00.000Z",
      created_at: "2026-06-05T12:00:00.000Z",
      updated_at: "2026-06-05T12:00:00.000Z",
    });

    const stripe = new Stripe("sk_test_webhook_test", {
      apiVersion: "2025-02-24.acacia",
    });
    const payload = JSON.stringify({
      id: "evt_booking_paid",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_booking_paid",
          object: "checkout.session",
          payment_status: "paid",
          payment_intent: "pi_booking_paid",
          amount_total: 500,
          amount_subtotal: 500,
          currency: "eur",
          metadata: {
            purchase_kind: "booking",
            site_id: "site-booking",
            offer_id: "paid-session",
            booking_type: "one_to_one",
            hold_token: "hold-paid-token",
            guest_name: "Paid Guest",
            guest_email: "paid@example.com",
            notes: "Paid webhook booking",
            starts_at: "2026-06-09T14:15:00.000Z",
            ends_at: "2026-06-09T15:15:00.000Z",
            duration_minutes: "60",
          },
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: env.STRIPE_WEBHOOK_SECRET,
    });

    const response = await app.fetch(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": signature,
          "Content-Type": "application/json",
        },
        body: payload,
      }),
      env,
    );
    const body = (await response.json()) as { received: boolean };

    expect(response.status).toBe(200);
    expect(body.received).toBe(true);
    expect(env.bookings).toHaveLength(1);
    expect(env.bookings[0]).toMatchObject({
      offer_id: "paid-session",
      guest_email: "paid@example.com",
      payment_intent_id: "pi_booking_paid",
      payment_status: "succeeded",
      amount_paid: 500,
    });
    expect(env.bookingHolds[0]).toMatchObject({
      status: "confirmed",
      booking_id: env.bookings[0].id,
    });
    expect(env.emailSends).toHaveLength(2);
    expect(env.emailSends[0]).toMatchObject({
      to: "paid@example.com",
      subject: "Booking confirmed: Paid Session",
    });
  });

  });

  describe("scheduling routes", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

  it("lists default private scheduling time types and maps public booking offers", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addBookableSite(env, {
      enabled: true,
      offers: [
        {
          id: "paid-session",
          title: "Paid Session",
          description: "A paid public session.",
          duration: 60,
          pricing: { enabled: true, suggestedAmount: 75, currency: "EUR" },
        },
      ],
      bufferTime: 15,
      availability: {
        timezone: "Europe/Dublin",
        windows: { tuesday: ["15:00-17:00"] },
      },
    });

    const response = await app.fetch(
      new Request("http://localhost/api/scheduling/time-types", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      timeTypes: Array<{
        id: string;
        title: string;
        source: string;
        paymentMode: string;
        allowedTiers: string[];
        publicBookingOfferId?: string;
        bufferMinutes: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.timeTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Catch-up",
          source: "owner",
          paymentMode: "free",
          allowedTiers: ["contact", "close_contact", "client"],
        }),
        expect.objectContaining({
          id: "public:owner:paid-session",
          title: "Paid Session",
          source: "public_booking_offer",
          paymentMode: "paid_checkout",
          publicBookingOfferId: "paid-session",
          bufferMinutes: 15,
        }),
      ]),
    );
    expect(env.schedulingTimeTypes).toHaveLength(1);
  });

  it("creates and updates private scheduling time types", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const createResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/time-types", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          title: "Work call",
          description: "Private working time.",
          durationMinutes: 45,
          bufferMinutes: 15,
          timezone: "Europe/Dublin",
          windows: { monday: ["10:00-12:00"] },
          allowedTiers: ["contact", "close_contact"],
          paymentMode: "owner_review",
          ownerPreReview: "always",
          allowCloseContactCandidateSharing: false,
        }),
      }),
      env,
    );
    const created = (await createResponse.json()) as {
      timeType: { id: string; title: string; durationMinutes: number };
    };

    expect(createResponse.status).toBe(201);
    expect(created.timeType).toMatchObject({
      title: "Work call",
      durationMinutes: 45,
    });

    const updateResponse = await app.fetch(
      new Request(
        `http://localhost/api/scheduling/time-types/${created.timeType.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({
            title: "Deep work call",
            durationMinutes: 60,
            bufferMinutes: 20,
            timezone: "Europe/Dublin",
            windows: { monday: ["10:00-13:00"] },
            allowedTiers: ["contact", "close_contact"],
            paymentMode: "free",
            ownerPreReview: "unless_close_contact",
            allowCloseContactCandidateSharing: true,
          }),
        },
      ),
      env,
    );
    const updated = (await updateResponse.json()) as {
      timeType: {
        title: string;
        durationMinutes: number;
        bufferMinutes: number;
        paymentMode: string;
      };
    };

    expect(updateResponse.status).toBe(200);
    expect(updated.timeType).toMatchObject({
      title: "Deep work call",
      durationMinutes: 60,
      bufferMinutes: 20,
      paymentMode: "free",
    });
  });

  it("resolves scheduling privilege tiers and review policy", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const createResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/time-types", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          title: "Coffee chat",
          durationMinutes: 30,
          bufferMinutes: 10,
          timezone: "UTC",
          windows: { friday: ["09:00-11:00"] },
          allowedTiers: ["contact", "close_contact"],
          ownerPreReview: "unless_close_contact",
          allowCloseContactCandidateSharing: true,
        }),
      }),
      env,
    );
    const created = (await createResponse.json()) as {
      timeType: { id: string };
    };

    env.contacts.push({
      id: "ordinary-contact",
      user_id: "owner",
      name: "Ordinary Contact",
      email: "ordinary@example.com",
      phone: null,
      source: "manual",
      source_ref: null,
      relationship: "contact",
      status: "active",
      notes: null,
      tags: null,
      last_interaction_at: null,
      next_followup_at: null,
      outreach_status: null,
      social_handles: null,
      metadata: JSON.stringify({ closeness: "acquaintance" }),
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.contacts.push({
      id: "close-contact",
      user_id: "owner",
      name: "Close Contact",
      email: "close@example.com",
      phone: null,
      source: "manual",
      source_ref: null,
      relationship: "contact",
      status: "active",
      notes: null,
      tags: null,
      last_interaction_at: null,
      next_followup_at: null,
      outreach_status: null,
      social_handles: null,
      metadata: JSON.stringify({ closeness: "close" }),
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });

    const publicResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/policy/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({ timeTypeId: created.timeType.id }),
      }),
      env,
    );
    const publicBody = (await publicResponse.json()) as {
      policy: {
        tier: string;
        allowed: boolean;
        candidateSharingAllowed: boolean;
      };
    };

    expect(publicResponse.status).toBe(200);
    expect(publicBody.policy).toMatchObject({
      tier: "public",
      allowed: false,
      candidateSharingAllowed: false,
    });

    const ordinaryResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/policy/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: created.timeType.id,
          contactId: "ordinary-contact",
        }),
      }),
      env,
    );
    const ordinaryBody = (await ordinaryResponse.json()) as {
      policy: {
        tier: string;
        allowed: boolean;
        ownerReviewRequired: boolean;
        candidateSharingAllowed: boolean;
      };
    };

    expect(ordinaryResponse.status).toBe(200);
    expect(ordinaryBody.policy).toMatchObject({
      tier: "contact",
      allowed: true,
      ownerReviewRequired: true,
      candidateSharingAllowed: false,
    });

    const closeResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/policy/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: created.timeType.id,
          contactId: "close-contact",
        }),
      }),
      env,
    );
    const closeBody = (await closeResponse.json()) as {
      policy: {
        tier: string;
        allowed: boolean;
        ownerReviewRequired: boolean;
        candidateSharingAllowed: boolean;
      };
    };

    expect(closeResponse.status).toBe(200);
    expect(closeBody.policy).toMatchObject({
      tier: "close_contact",
      allowed: true,
      ownerReviewRequired: false,
      candidateSharingAllowed: true,
    });
  });

  it("generates timezone-aware scheduling candidates and ignores reminders", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.schedulingTimeTypes.push({
      id: "dublin-catchup",
      user_id: "owner",
      title: "Dublin catch-up",
      description: null,
      duration_minutes: 30,
      buffer_minutes: 0,
      timezone: "Europe/Dublin",
      windows_json: JSON.stringify({ monday: ["09:00-10:00"] }),
      allowed_tiers_json: JSON.stringify(["public", "contact", "close_contact"]),
      payment_mode: "free",
      public_booking_offer_id: null,
      owner_pre_review: "unless_close_contact",
      allow_close_contact_candidate_sharing: 1,
      final_approval: "both_owners",
      status: "active",
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.reminders.push({
      id: "reminder-1",
      user_id: "owner",
      title: "Reminder should not block",
      notes: null,
      remind_at: "2026-06-08T08:15:00.000Z",
      timezone: "Europe/Dublin",
      recurrence_rule: null,
      context_type: null,
      context_id: null,
      context_label: null,
      status: "pending",
      delivered_at: null,
      dismissed_at: null,
      created_at: "2026-06-05T12:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/scheduling/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: "dublin-catchup",
          dateRange: { start: "2026-06-08", end: "2026-06-08" },
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      status: string;
      slots: Array<{
        startsAt: string;
        endsAt: string;
        timezone: string;
        localStartTime: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("review_required");
    expect(body.slots).toEqual([
      expect.objectContaining({
        startsAt: "2026-06-08T08:00:00.000Z",
        endsAt: "2026-06-08T08:30:00.000Z",
        timezone: "Europe/Dublin",
        localStartTime: "09:00",
      }),
      expect.objectContaining({
        startsAt: "2026-06-08T08:15:00.000Z",
        localStartTime: "09:15",
      }),
      expect.objectContaining({
        startsAt: "2026-06-08T08:30:00.000Z",
        localStartTime: "09:30",
      }),
    ]);
  });

  it("excludes slots overlapping bookings and native events with buffer", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addBookableSite(env);
    env.schedulingTimeTypes.push({
      id: "buffered-call",
      user_id: "owner",
      title: "Buffered call",
      description: null,
      duration_minutes: 30,
      buffer_minutes: 15,
      timezone: "UTC",
      windows_json: JSON.stringify({ monday: ["09:00-12:00"] }),
      allowed_tiers_json: JSON.stringify(["public", "contact", "close_contact"]),
      payment_mode: "free",
      public_booking_offer_id: null,
      owner_pre_review: "unless_close_contact",
      allow_close_contact_candidate_sharing: 1,
      final_approval: "both_owners",
      status: "active",
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.bookings.push({
      id: "booking-blocker",
      site_id: "site-booking",
      offer_id: "free-session",
      booking_type: "one_to_one",
      guest_name: "Booked",
      guest_email: "booked@example.com",
      starts_at: "2026-06-08T09:30:00.000Z",
      ends_at: "2026-06-08T10:00:00.000Z",
      duration_minutes: 30,
      calendar_event_id: null,
      status: "confirmed",
      notes: "private booking notes",
      created_at: "2026-06-05T12:00:00Z",
      cancelled_at: null,
      payment_intent_id: null,
      amount_paid: null,
      suggested_amount: null,
      currency: null,
      payment_status: "not_required",
      is_free_booking: 1,
      paid_at: null,
    });
    env.userCalendarEvents.push({
      id: "event-blocker",
      user_id: "owner",
      title: "Private event title",
      notes: "private event notes",
      location: null,
      starts_at: "2026-06-08T10:45:00.000Z",
      ends_at: "2026-06-08T11:15:00.000Z",
      timezone: "UTC",
      all_day: 0,
      kind: "event",
      recurrence_rule: null,
      created_at: "2026-06-05T12:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/scheduling/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: "buffered-call",
          dateRange: { start: "2026-06-08", end: "2026-06-08" },
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      slots: Array<{ localStartTime: string; startsAt: string; endsAt: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.slots).toEqual([
      expect.objectContaining({
        localStartTime: "11:30",
        startsAt: "2026-06-08T11:30:00.000Z",
        endsAt: "2026-06-08T12:00:00.000Z",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("Private event title");
    expect(JSON.stringify(body)).not.toContain("private booking notes");
  });

  it("blocks all-day calendar events and returns empty availability safely", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.schedulingTimeTypes.push({
      id: "all-day-test",
      user_id: "owner",
      title: "All day test",
      description: null,
      duration_minutes: 30,
      buffer_minutes: 0,
      timezone: "UTC",
      windows_json: JSON.stringify({ tuesday: ["09:00-10:00"] }),
      allowed_tiers_json: JSON.stringify(["public", "contact", "close_contact"]),
      payment_mode: "free",
      public_booking_offer_id: null,
      owner_pre_review: "unless_close_contact",
      allow_close_contact_candidate_sharing: 1,
      final_approval: "both_owners",
      status: "active",
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.userCalendarEvents.push({
      id: "all-day-blocker",
      user_id: "owner",
      title: "All day private event",
      notes: "not returned",
      location: null,
      starts_at: "2026-06-09T00:00:00.000Z",
      ends_at: "2026-06-10T00:00:00.000Z",
      timezone: "UTC",
      all_day: 1,
      kind: "event",
      recurrence_rule: null,
      created_at: "2026-06-05T12:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/scheduling/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: "all-day-test",
          dateRange: { start: "2026-06-09", end: "2026-06-09" },
        }),
      }),
      env,
    );
    const body = (await response.json()) as { slots: unknown[] };

    expect(response.status).toBe(200);
    expect(body.slots).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("All day private event");
  });

  it("uses imported calendar events as blockers without exposing details", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.schedulingTimeTypes.push({
      id: "imported-test",
      user_id: "owner",
      title: "Imported test",
      description: null,
      duration_minutes: 30,
      buffer_minutes: 0,
      timezone: "UTC",
      windows_json: JSON.stringify({ wednesday: ["09:00-10:00"] }),
      allowed_tiers_json: JSON.stringify(["public", "contact", "close_contact"]),
      payment_mode: "free",
      public_booking_offer_id: null,
      owner_pre_review: "unless_close_contact",
      allow_close_contact_candidate_sharing: 1,
      final_approval: "both_owners",
      status: "active",
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.calendarSources.push({
      id: "source-1",
      user_id: "owner",
      kind: "ics_upload",
      name: "Imported calendar",
      original_filename: "private.ics",
      imported_event_count: 1,
      created_at: "2026-06-05T12:00:00Z",
    });
    env.calendarSourceEvents.push({
      id: "imported-blocker",
      source_id: "source-1",
      external_key: "secret-key",
      external_uid: "secret-uid",
      title: "Secret imported appointment",
      notes: "secret imported notes",
      location: "secret room",
      starts_at: "2026-06-10T09:15:00.000Z",
      ends_at: "2026-06-10T09:45:00.000Z",
      timezone: "UTC",
      all_day: 0,
      created_at: "2026-06-05T12:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/scheduling/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: "imported-test",
          dateRange: { start: "2026-06-10", end: "2026-06-10" },
        }),
      }),
      env,
    );
    const body = (await response.json()) as { slots: unknown[] };

    expect(response.status).toBe(200);
    expect(body.slots).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Secret imported appointment");
    expect(JSON.stringify(body)).not.toContain("secret imported notes");
  });

  it("returns policy-safe statuses for denied and close-contact candidate requests", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.schedulingTimeTypes.push({
      id: "close-only",
      user_id: "owner",
      title: "Close only",
      description: null,
      duration_minutes: 30,
      buffer_minutes: 0,
      timezone: "UTC",
      windows_json: JSON.stringify({ thursday: ["09:00-10:00"] }),
      allowed_tiers_json: JSON.stringify(["close_contact"]),
      payment_mode: "free",
      public_booking_offer_id: null,
      owner_pre_review: "unless_close_contact",
      allow_close_contact_candidate_sharing: 1,
      final_approval: "both_owners",
      status: "active",
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.contacts.push({
      id: "close-contact-for-candidates",
      user_id: "owner",
      name: "Close Contact",
      email: "close-candidate@example.com",
      phone: null,
      source: "manual",
      source_ref: null,
      relationship: "contact",
      status: "active",
      notes: null,
      tags: null,
      last_interaction_at: null,
      next_followup_at: null,
      outreach_status: null,
      social_handles: null,
      metadata: JSON.stringify({ closeness: "very_close" }),
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });

    const deniedResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: "close-only",
          dateRange: { start: "2026-06-11", end: "2026-06-11" },
        }),
      }),
      env,
    );
    const deniedBody = (await deniedResponse.json()) as {
      status: string;
      policy: { tier: string; allowed: boolean };
      slots: unknown[];
    };

    expect(deniedResponse.status).toBe(200);
    expect(deniedBody).toMatchObject({
      status: "not_allowed",
      policy: { tier: "public", allowed: false },
      slots: [],
    });

    const closeResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: "close-only",
          contactId: "close-contact-for-candidates",
          dateRange: { start: "2026-06-11", end: "2026-06-11" },
        }),
      }),
      env,
    );
    const closeBody = (await closeResponse.json()) as {
      status: string;
      policy: {
        tier: string;
        allowed: boolean;
        ownerReviewRequired: boolean;
        candidateSharingAllowed: boolean;
      };
      slots: Array<{ localStartTime: string }>;
    };

    expect(closeResponse.status).toBe(200);
    expect(closeBody.status).toBe("ok");
    expect(closeBody.policy).toMatchObject({
      tier: "close_contact",
      allowed: true,
      ownerReviewRequired: false,
      candidateSharingAllowed: true,
    });
    expect(closeBody.slots.map((slot) => slot.localStartTime)).toEqual([
      "09:00",
      "09:15",
      "09:30",
    ]);
  });

  it("creates a Soulink scheduling poll request and finalizes only after both approvals", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.soulinkConnection = {
      id: "soulink-scheduling",
      user_id: "owner",
      channel: "soulink",
      status: "active",
      setup_token: "setup-token",
      provider_connection_id: "messaging",
      provider_user_id: "node-owner",
      provider_thread_id: "assistant-channel",
      provider_username: "assistant-owner",
      provider_metadata_json: JSON.stringify({ ownerNodeId: "node-owner" }),
      telegram_user_id: null,
      telegram_chat_id: null,
      telegram_username: null,
      telegram_first_name: null,
      telegram_last_name: null,
      connected_at: "2026-05-11T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-05-11T10:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    };
    env.schedulingTimeTypes.push({
      id: "soulink-coffee",
      user_id: "owner",
      title: "Coffee chat",
      description: null,
      duration_minutes: 30,
      buffer_minutes: 0,
      timezone: "UTC",
      windows_json: JSON.stringify({ thursday: ["09:00-11:00"] }),
      allowed_tiers_json: JSON.stringify(["close_contact"]),
      payment_mode: "free",
      public_booking_offer_id: null,
      owner_pre_review: "unless_close_contact",
      allow_close_contact_candidate_sharing: 1,
      final_approval: "both_owners",
      status: "active",
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.contacts.push({
      id: "close-soulink-contact",
      user_id: "owner",
      name: "Close Soulink Contact",
      email: "close@example.com",
      phone: null,
      source: "soulink",
      source_ref: "node-close",
      relationship: "contact",
      status: "active",
      notes: null,
      tags: null,
      last_interaction_at: null,
      next_followup_at: null,
      outreach_status: null,
      social_handles: null,
      metadata: JSON.stringify({ closeness: "close", soulinkNodeId: "node-close" }),
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });

    const fetchMock = vi.fn(async () => Response.json({ ok: true, messageId: "stream-poll-1" }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const createResponse = await app.fetch(
        new Request("http://localhost/api/scheduling/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({
            timeTypeId: "soulink-coffee",
            contactId: "close-soulink-contact",
            requesterName: "Owner",
            targetName: "Close Contact",
            reason: "Catch up properly",
            dateRange: { start: "2026-06-11", end: "2026-06-11" },
            limit: 5,
          }),
        }),
        env,
      );
      const created = (await createResponse.json()) as {
        request: {
          id: string;
          status: string;
          candidateSlots: Array<{ startsAt: string; endsAt: string; localStartTime: string }>;
        };
        streamPayload: {
          kind: string;
          poll: { options: unknown[] };
          actionCard: { actions: unknown[] };
        };
        audit: Array<{ eventType: string }>;
        soulinkDelivery: { attempted: boolean; status: string };
      };

      expect(createResponse.status).toBe(201);
      expect(created.request.status).toBe("candidates_shared");
      expect(created.request.candidateSlots.map((slot) => slot.localStartTime)).toEqual([
        "09:00",
        "09:15",
        "09:30",
        "09:45",
        "10:00",
      ]);
      expect(created.streamPayload).toMatchObject({
        kind: "scheduling_poll",
        poll: { options: expect.any(Array) },
        actionCard: { actions: expect.any(Array) },
      });
      expect(created.streamPayload.poll.options).toHaveLength(5);
      expect(created.audit.map((entry) => entry.eventType)).toEqual([
        "request_created",
        "candidates_shared",
      ]);
      expect(created.soulinkDelivery).toEqual({ attempted: true, status: "sent" });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(env.agentEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channel: "soulink",
            direction: "outbound",
            provider_event_id: `scheduling:${created.request.id}:candidates`,
            status: "sent",
          }),
        ]),
      );
      expect(env.userCalendarEvents).toHaveLength(0);
      expect(env.bookings).toHaveLength(0);

      const blockedFinalizeResponse = await app.fetch(
        new Request(`http://localhost/api/scheduling/requests/${created.request.id}/finalize`, {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      expect(blockedFinalizeResponse.status).toBe(409);
      expect(env.userCalendarEvents).toHaveLength(0);

      for (const participantRole of ["requester", "target"]) {
        const voteResponse = await app.fetch(
          new Request(`http://localhost/api/scheduling/requests/${created.request.id}/votes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: session },
            body: JSON.stringify({
              participantRole,
              slotId: "1",
              preference: "yes",
              voterLabel: participantRole,
            }),
          }),
          env,
        );
        expect(voteResponse.status).toBe(200);

        const approvalResponse = await app.fetch(
          new Request(`http://localhost/api/scheduling/requests/${created.request.id}/approvals`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: session },
            body: JSON.stringify({ participantRole, slotId: "1" }),
          }),
          env,
        );
        expect(approvalResponse.status).toBe(200);
      }

      expect(env.schedulingRequestVotes).toHaveLength(2);
      const finalizeResponse = await app.fetch(
        new Request(`http://localhost/api/scheduling/requests/${created.request.id}/finalize`, {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const finalized = (await finalizeResponse.json()) as {
        request: { status: string; finalizedCalendarEventId: string | null };
        calendarEvent: { title: string; startsAt: string; endsAt: string };
      };

      expect(finalizeResponse.status).toBe(200);
      expect(finalized.request.status).toBe("finalized");
      expect(finalized.request.finalizedCalendarEventId).toBeTruthy();
      expect(finalized.calendarEvent).toMatchObject({
        title: "Coffee chat with Close Contact",
        startsAt: "2026-06-11T09:00:00.000Z",
        endsAt: "2026-06-11T09:30:00.000Z",
      });
      expect(env.userCalendarEvents).toHaveLength(1);
      expect(env.schedulingRequestAudit.map((entry) => entry.event_type)).toEqual(
        expect.arrayContaining([
          "request_created",
          "candidates_shared",
          "vote_recorded",
          "approval_recorded",
          "finalization_blocked",
          "finalized",
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hands paid scheduling requests to checkout after approvals without creating bookings", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addBookableSite(env, {
      enabled: true,
      offers: [
        {
          id: "paid-session",
          title: "Paid Session",
          duration: 60,
          pricing: { enabled: true, suggestedAmount: 75, currency: "EUR" },
        },
      ],
      bufferTime: 0,
      availability: {
        timezone: "UTC",
        windows: { monday: ["09:00-11:00"] },
      },
    });
    env.contacts.push({
      id: "close-paid-contact",
      user_id: "owner",
      name: "Close Paid Contact",
      email: "paid@example.com",
      phone: null,
      source: "manual",
      source_ref: null,
      relationship: "contact",
      status: "active",
      notes: null,
      tags: null,
      last_interaction_at: null,
      next_followup_at: null,
      outreach_status: null,
      social_handles: null,
      metadata: JSON.stringify({ closeness: "close" }),
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });

    const createResponse = await app.fetch(
      new Request("http://localhost/api/scheduling/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          timeTypeId: "public:owner:paid-session",
          contactId: "close-paid-contact",
          requesterName: "Client",
          targetName: "Owner",
          dateRange: { start: "2026-06-08", end: "2026-06-08" },
          limit: 3,
        }),
      }),
      env,
    );
    const created = (await createResponse.json()) as {
      request: { id: string; candidateSlots: Array<{ localStartTime: string }> };
    };
    expect(createResponse.status).toBe(201);
    expect(created.request.candidateSlots.map((slot) => slot.localStartTime)).toEqual([
      "09:00",
      "09:15",
      "09:30",
    ]);

    for (const participantRole of ["requester", "target"]) {
      const approvalResponse = await app.fetch(
        new Request(`http://localhost/api/scheduling/requests/${created.request.id}/approvals`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({ participantRole, slotId: "1" }),
        }),
        env,
      );
      expect(approvalResponse.status).toBe(200);
    }

    const finalizeResponse = await app.fetch(
      new Request(`http://localhost/api/scheduling/requests/${created.request.id}/finalize`, {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const finalized = (await finalizeResponse.json()) as {
      request: { status: string; checkoutUrl: string; finalizedBookingId: string | null };
      checkoutUrl: string;
    };

    expect(finalizeResponse.status).toBe(200);
    expect(finalized.request.status).toBe("checkout_required");
    expect(finalized.request.finalizedBookingId).toBeNull();
    expect(finalized.checkoutUrl).toContain("/book/owner");
    expect(finalized.checkoutUrl).toContain("offerId=paid-session");
    expect(env.bookings).toHaveLength(0);
    expect(env.userCalendarEvents).toHaveLength(0);
    expect(env.schedulingRequestAudit.map((entry) => entry.event_type)).toContain(
      "checkout_handoff",
    );
  });
  });

  it("lists curated Core plugins for the signed-in owner", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/plugins", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      catalogVersion: string;
      plugins: Array<{
        id: string;
        status: string;
        installed: boolean;
        enabled: boolean;
        implementationStatus: string;
        showInPluginList: boolean;
        releaseStage: string;
        activationAllowed: boolean;
        agentTools: Array<{ id: string; approvalMode: string }>;
        setupRequirements: Array<{ kind: string; configured: boolean; required: boolean }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.catalogVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(body.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "me3.agent-chat",
          showInPluginList: false,
          status: "installed",
          implementationStatus: "bundled",
        }),
        expect.objectContaining({
          id: "me3.calendar",
          showInPluginList: false,
          status: "installed",
          implementationStatus: "bundled",
        }),
        expect.objectContaining({
          id: "me3.journal",
          showInPluginList: false,
          status: "installed",
          implementationStatus: "bundled",
        }),
        expect.objectContaining({
          id: "me3.social-publishing",
          showInPluginList: true,
          status: "available",
          implementationStatus: "bundled",
        }),
        expect.objectContaining({
          id: "me3.landing-pages",
          showInPluginList: false,
          status: "available",
          implementationStatus: "bundled",
          releaseStage: "available",
          activationAllowed: true,
          enabled: false,
        }),
        expect.objectContaining({
          id: "me3.email-campaigns",
          showInPluginList: true,
          status: "available",
          implementationStatus: "bundled",
          releaseStage: "available",
          activationAllowed: true,
          enabled: false,
        }),
      ]),
    );
    expect(body.plugins).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "me3.telegram",
        }),
      ]),
    );
    expect(
      body.plugins
        .filter((plugin) => plugin.showInPluginList === false)
        .map((plugin) => plugin.id),
    ).toEqual([
      "me3.agent-chat",
      "me3.mission-control",
      "me3.journal",
      "me3.calendar",
      "me3.local-executor",
      "me3.landing-pages",
    ]);
    const socialPlugin = body.plugins.find(
      (plugin) => plugin.id === "me3.social-publishing",
    );
    const agentChatPlugin = body.plugins.find((plugin) => plugin.id === "me3.agent-chat");
    const calendarPlugin = body.plugins.find((plugin) => plugin.id === "me3.calendar");
    expect(agentChatPlugin).toMatchObject({
      status: "installed",
      installed: true,
      enabled: true,
    });
    expect(calendarPlugin).toMatchObject({
      status: "installed",
      installed: true,
      enabled: true,
    });
    expect(agentChatPlugin?.setupRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "migration",
          configured: true,
          required: true,
        }),
      ]),
    );
    expect(calendarPlugin?.agentTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "calendar.event.create",
          approvalMode: "approval_required",
        }),
      ]),
    );
    expect(socialPlugin?.agentTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "social.version.publish",
          approvalMode: "approval_required",
        }),
      ]),
    );
    expect(socialPlugin?.setupRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "package",
          configured: true,
        }),
        expect.objectContaining({
          kind: "queue",
          configured: true,
          required: false,
        }),
      ]),
    );
  });

  it("keeps shared ME3 knowledge aligned with plugin manifest tools", () => {
    expect(validateMe3KnowledgeAgainstPlugins(CORE_PLUGIN_CATALOG)).toEqual([]);
    expect(validateCorePluginAgentToolContracts(CORE_PLUGIN_CATALOG)).toEqual([]);
  });

  it("keeps Journal enabled even if an old install row marks it disabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/plugins/me3.journal/deactivate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const catalogResponse = await app.fetch(
      new Request("http://localhost/api/plugins", {
        headers: { Cookie: session },
      }),
      env,
    );
    const catalog = (await catalogResponse.json()) as {
      plugins: Array<{ id: string; enabled: boolean; status: string }>;
    };
    const journal = catalog.plugins.find((plugin) => plugin.id === "me3.journal");

    expect(journal).toMatchObject({
      enabled: true,
      status: "installed",
    });

    const archiveResponse = await app.fetch(
      new Request("http://localhost/api/journal/archive", {
        headers: { Cookie: session },
      }),
      env,
    );

    expect(archiveResponse.status).toBe(200);
  });

  it("requires owner auth for plugin catalog access", async () => {
    const env = createEnv();

    const response = await app.fetch(new Request("http://localhost/api/plugins"), env);

    expect(response.status).toBe(401);
  });

  it("exposes shared ME3 knowledge with runtime setup state", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/knowledge", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      schemaVersion: string;
      catalogVersion: string;
      facts: Array<{ id: string }>;
      capabilities: Array<{ id: string; runtimeState: string; runtimeNote: string }>;
      plugins: Array<{ id: string; routePaths: string[]; agentToolIds: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(body.schemaVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(body.catalogVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(body.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "me3.boundary.public_private" }),
      ]),
    );
    expect(body.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workspace.mission_control",
          runtimeState: "available",
        }),
        expect.objectContaining({
          id: "calendar.events_reminders",
          runtimeState: "available",
        }),
        expect.objectContaining({
          id: "content.social_publishing",
          runtimeState: "setup_required",
        }),
        expect.objectContaining({
          id: "ai.chat_provider",
          runtimeState: "setup_required",
        }),
      ]),
    );
    expect(body.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "me3.mission-control",
          agentToolIds: expect.arrayContaining(["mission.task.create"]),
          capabilityIds: expect.not.arrayContaining(["workspace.daily_capture"]),
        }),
      ]),
    );
    const missionControlPlugin = body.plugins.find(
      (plugin: { id: string }) => plugin.id === "me3.mission-control",
    );
    expect(missionControlPlugin?.routePaths).toEqual(
      expect.arrayContaining(["/api/mission-control/projects"]),
    );
    expect(missionControlPlugin?.routePaths).toEqual(
      expect.not.arrayContaining(["/api/mission-control/overview"]),
    );
  });

  it("requires owner auth for ME3 knowledge access", async () => {
    const env = createEnv();

    const response = await app.fetch(new Request("http://localhost/api/knowledge"), env);

    expect(response.status).toBe(401);
  });

  it("activates bundled Social Publishing when Core prerequisites are configured", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      plugin: {
        id: string;
        installed: boolean;
        enabled: boolean;
        status: string;
        grantedPermissions: string[];
        setupRequirements: Array<{ kind: string; configured: boolean; required: boolean }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.plugin).toMatchObject({
      id: "me3.social-publishing",
      installed: true,
      enabled: true,
      status: "installed",
    });
    expect(body.plugin.grantedPermissions).toEqual([
      "content.social.publish",
      "content.social.accounts.manage",
    ]);
    expect(body.plugin.setupRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "package", configured: true }),
        expect.objectContaining({ kind: "queue", configured: true, required: false }),
      ]),
    );

    const catalogResponse = await app.fetch(
      new Request("http://localhost/api/plugins", {
        headers: { Cookie: session },
      }),
      env,
    );
    const catalog = (await catalogResponse.json()) as {
      plugins: Array<{ id: string; status: string }>;
    };

    expect(catalog.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "me3.social-publishing",
          status: "installed",
        }),
      ]),
    );
  });

  it("activates Social Publishing after generating install encryption during setup", async () => {
    const env = createEnv();
    env.TOKEN_ENCRYPTION_KEY = undefined;
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      plugin: {
        status: string;
        setupRequirements: Array<{ kind: string; label: string; configured: boolean }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.plugin.status).toBe("installed");
    expect(body.plugin.setupRequirements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "secret",
          label: "Token encryption key",
        }),
      ]),
    );
  });

  it("deactivates an installed Social Publishing plugin", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/deactivate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      plugin: { id: string; installed: boolean; enabled: boolean; status: string };
    };

    expect(response.status).toBe(200);
    expect(body.plugin).toMatchObject({
      id: "me3.social-publishing",
      installed: true,
      enabled: false,
      status: "disabled",
    });
  });

  it("exposes Social Publishing runtime status and accounts when installed", async () => {
    const env = createEnv();
    env.ME3_SOCIAL_OAUTH_ORIGIN = "https://social-oauth.example";
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    env.socialAccounts.push({
      id: "social-account-1",
      user_id: "owner",
      site_id: "site-1",
      platform: "linkedin",
      platform_account_id: "linkedin-owner",
      platform_handle: null,
      display_name: "Owner LinkedIn",
      metadata_json: JSON.stringify({ avatarUrl: "https://cdn.test/linkedin-owner.jpg" }),
      status: "active",
      scopes_json: JSON.stringify(["w_member_social"]),
      last_verified_at: "2026-05-11T10:00:00Z",
      created_at: "2026-05-11T09:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    });

    const statusResponse = await app.fetch(
      new Request("http://localhost/api/social/status", {
        headers: { Cookie: session },
      }),
      env,
    );
    const statusBody = (await statusResponse.json()) as {
      plugin: {
        status: string;
        ready: boolean;
        platformCapabilities: Array<{
          platform: string;
          draft: boolean;
          schedule: boolean;
          publish: boolean;
          deliveryMode: string;
          supportedDeliveryModes?: string[];
          deliveryLabel: string;
          contentRules: Array<{ contentType: string }>;
          reason: string | null;
        }>;
      };
      hostedOAuth: { configured: boolean; platforms: string[] };
    };

    expect(statusResponse.status).toBe(200);
    expect(statusBody.plugin).toMatchObject({ status: "installed", ready: true });
    expect(statusBody.plugin.platformCapabilities).toEqual([
      expect.objectContaining({
        platform: "linkedin",
        draft: true,
        schedule: true,
        publish: true,
        deliveryMode: "direct_publish",
        deliveryLabel: "Publishes directly",
        contentRules: expect.arrayContaining([
          expect.objectContaining({ contentType: "text" }),
          expect.objectContaining({ contentType: "image" }),
          expect.objectContaining({ contentType: "carousel", maxMediaItems: 20 }),
        ]),
        reason: null,
      }),
      expect.objectContaining({
        platform: "x",
        draft: true,
        schedule: true,
        publish: true,
        deliveryMode: "direct_publish",
        deliveryLabel: "Publishes directly",
        contentRules: expect.arrayContaining([
          expect.objectContaining({ contentType: "text" }),
          expect.objectContaining({ contentType: "carousel" }),
          expect.objectContaining({ contentType: "short_video" }),
        ]),
        reason: null,
      }),
      expect.objectContaining({
        platform: "instagram",
        draft: true,
        schedule: true,
        publish: true,
        deliveryMode: "direct_publish",
        contentRules: expect.arrayContaining([
          expect.objectContaining({ contentType: "image" }),
          expect.objectContaining({ contentType: "carousel" }),
          expect.objectContaining({ contentType: "short_video" }),
        ]),
        reason: null,
      }),
      expect.objectContaining({
        platform: "instagram_business",
        draft: true,
        schedule: true,
        publish: true,
        deliveryMode: "direct_publish",
        reason: null,
      }),
      expect.objectContaining({
        platform: "youtube",
        draft: true,
        schedule: false,
        publish: true,
        deliveryMode: "direct_publish",
        deliveryLabel: "Uploads directly",
        contentRules: [
          expect.objectContaining({ contentType: "short_video" }),
        ],
        reason: null,
      }),
      expect.objectContaining({
        platform: "tiktok",
        draft: true,
        schedule: false,
        publish: true,
        deliveryMode: "provider_draft",
        supportedDeliveryModes: ["provider_draft", "direct_publish"],
        deliveryLabel: "Draft or Direct Post",
        reason: null,
      }),
    ]);
    expect(statusBody.hostedOAuth).toEqual({
      configured: true,
      platforms: ["linkedin", "instagram", "youtube", "tiktok"],
    });

    const response = await app.fetch(
      new Request("http://localhost/api/social/accounts", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      plugin: { status: string; ready: boolean };
      accounts: Array<{
        id: string;
        platform: string;
        scopes: string[];
        avatarUrl: string | null;
        avatarSource: string | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.plugin).toMatchObject({ status: "installed", ready: true });
    expect(body.accounts).toEqual([
      expect.objectContaining({
        id: "social-account-1",
        platform: "linkedin",
        scopes: ["w_member_social"],
        avatarUrl: "https://cdn.test/linkedin-owner.jpg",
        avatarSource: "provider",
      }),
    ]);
  });

  it("gates Social Publishing account reads when setup is required", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const now = new Date().toISOString();
    env.pluginInstallations.push({
      plugin_id: "me3.social-publishing",
      version: "0.1.0",
      enabled: 1,
      status: "setup_required",
      granted_permissions_json: "[]",
      setup_state_json: "{}",
      installed_at: now,
      updated_at: now,
    });

    const response = await app.fetch(
      new Request("http://localhost/api/social/accounts", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      error: string;
      plugin: { status: string; ready: boolean };
    };

    expect(response.status).toBe(424);
    expect(body.error).toBe("Social Publishing setup is required");
    expect(body.plugin).toMatchObject({ status: "setup_required", ready: false });
  });

  it("gates Social Publishing account reads when disabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/deactivate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/social/accounts", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      error: string;
      plugin: { status: string; enabled: boolean; ready: boolean };
    };

    expect(response.status).toBe(403);
    expect(body.error).toBe("Social Publishing is disabled");
    expect(body.plugin).toMatchObject({
      status: "disabled",
      enabled: false,
      ready: false,
    });
  });

  it("creates and lists a source-backed Social Post and Version", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const createResponse = await app.fetch(
      new Request("http://localhost/api/social/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          siteId: "site-1",
          sourceType: "journal",
          sourceRef: "journal:2026-07-18",
          sourceSnapshot: "We shipped the smallest useful slice today.",
          sourceText: "We shipped the smallest useful slice today.",
          ideaText: "Small useful releases build momentum.",
          versions: [
            {
              platform: "linkedin",
              bodyText: "The smallest useful release is often the best next step.",
            },
          ],
        }),
      }),
      env,
    );
    const createBody = (await createResponse.json()) as {
      ok: boolean;
      post: {
        post: {
          id: string;
          sourceType: string;
          sourceRef: string;
          sourceSnapshot: string;
          sourceText: string;
        };
        versions: Array<{
          id: string;
          postId: string;
          platform: string;
          bodyText: string;
          approvalStatus: string;
        }>;
      };
    };

    expect(createResponse.status).toBe(201);
    expect(createBody.ok).toBe(true);
    expect(createBody.post.post).toMatchObject({
      sourceType: "journal",
      sourceRef: "journal:2026-07-18",
      sourceSnapshot: "We shipped the smallest useful slice today.",
      sourceText: "We shipped the smallest useful slice today.",
    });
    expect(createBody.post.versions).toEqual([
      expect.objectContaining({
        postId: createBody.post.post.id,
        platform: "linkedin",
        bodyText: "The smallest useful release is often the best next step.",
        approvalStatus: "draft",
      }),
    ]);

    const listResponse = await app.fetch(
      new Request("http://localhost/api/social/posts?siteId=site-1", {
        headers: { Cookie: session },
      }),
      env,
    );
    const listBody = (await listResponse.json()) as {
      posts: Array<{
        post: { id: string; sourceRef: string; sourceText: string };
        versions: Array<{ id: string; postId: string; platform: string }>;
      }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.posts).toEqual([
      {
        post: expect.objectContaining({
          id: createBody.post.post.id,
          sourceRef: "journal:2026-07-18",
          sourceText: "We shipped the smallest useful slice today.",
        }),
        versions: [
          expect.objectContaining({
            id: createBody.post.versions[0]?.id,
            postId: createBody.post.post.id,
            platform: "linkedin",
          }),
        ],
      },
    ]);
  });

  it("does not expose the retired legacy content-item routes", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const [listResponse, createResponse] = await Promise.all([
      app.fetch(
        new Request("http://localhost/api/content/items?siteId=site-1", {
          headers: { Cookie: session },
        }),
        env,
      ),
      app.fetch(
        new Request("http://localhost/api/content/items", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({ siteId: "site-1", body: "obsolete" }),
        }),
        env,
      ),
    ]);

    expect(listResponse.status).toBe(404);
    expect(createResponse.status).toBe(404);
  });

  it("stores Social Publishing provider settings without returning secrets", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/social/provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providers: [
            {
              id: "linkedin",
              clientId: "linkedin-client",
              clientSecret: "linkedin-secret-1234",
              enabled: true,
            },
          ],
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      providers: Array<{ providerId: string; configured: boolean; secretHint: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "linkedin",
          configured: true,
          secretHint: "***1234",
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain("linkedin-secret-1234");
    expect(env.socialProviderSettings[0].encrypted_client_secret).toMatch(/^v1\./);
    expect(env.socialProviderSettings[0].encrypted_client_secret).not.toContain(
      "linkedin-secret-1234",
    );
  });

  it("rejects Social Publishing OAuth start when provider secrets are missing", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/social/linkedin/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ siteId: "site-1" }),
      }),
      env,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(424);
    expect(body.error).toBe("LinkedIn integration is not configured");
  });

  it("starts hosted Social Publishing OAuth without provider secrets", async () => {
    const env = createEnv();
    env.ME3_SOCIAL_OAUTH_ORIGIN = "https://social-oauth.example";
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/social/linkedin/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          siteId: "site-1",
          returnPath: "/social",
          credentialSource: "managed",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { url: string };
    const url = new URL(body.url);

    expect(response.status).toBe(200);
    expect(url.origin).toBe("https://social-oauth.example");
    expect(url.pathname).toBe("/api/social/linkedin/authorize");
    expect(url.searchParams.get("core_callback")).toBe(
      "http://localhost:8787/api/social/linkedin/callback",
    );
    expect(env.socialOauthStates).toHaveLength(1);
  });

  it("redeems hosted Social Publishing OAuth with the Worker global fetch context", async () => {
    const env = createEnv();
    env.ME3_SOCIAL_OAUTH_ORIGIN = "https://social-oauth.example";
    const session = cookieHeader(
      await coreApp.fetch(
        new Request("http://localhost/api/admin/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost:4000" },
          body: JSON.stringify({
            bootstrapCode: "owner-code",
            email: "owner@example.com",
            name: "ME3 Owner",
            username: "owner",
            password: "correct-horse-battery",
          }),
        }),
        env,
      ),
    );
    await coreApp.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const authorizeResponse = await coreApp.fetch(
      new Request("http://localhost/api/social/linkedin/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          siteId: "site-1",
          returnPath: "/social",
          credentialSource: "managed",
        }),
      }),
      env,
    );
    const authorizeBody = (await authorizeResponse.json()) as { url: string };
    const state = new URL(authorizeBody.url).searchParams.get("state");

    const fetchMock = vi.fn(
      function (this: typeof globalThis, input: RequestInfo | URL) {
        expect(this).toBe(globalThis);
        expect(String(input)).toBe("https://social-oauth.example/api/social/oauth/redeem");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              account: {
                id: "linkedin-owner",
                handle: "owner",
                displayName: "Owner LinkedIn",
              },
              token: {
                accessToken: "linkedin-access-token",
                refreshToken: "linkedin-refresh-token",
                expiresAt: "2026-08-01T00:00:00.000Z",
                scopes: ["openid", "profile", "w_member_social"],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const callbackResponse = await coreApp.fetch(
        new Request(
          `http://localhost/api/social/linkedin/callback?state=${encodeURIComponent(
            state || "",
          )}&handoff=hosted-linkedin-handoff`,
        ),
        env,
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:4000/social?social_connected=linkedin",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(env.socialOauthStates).toHaveLength(0);
      expect(env.socialAccounts).toEqual([
        expect.objectContaining({
          platform: "linkedin",
          platform_account_id: "linkedin-owner",
          platform_handle: "owner",
          display_name: "Owner LinkedIn",
          status: "active",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("allows explicit BYO OAuth when the hosted bridge is configured", async () => {
    const env = createEnv();
    env.ME3_SOCIAL_OAUTH_ORIGIN = "https://social-oauth.example";
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/social/provider-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          providers: [{
            id: "linkedin",
            clientId: "owner-linkedin-client",
            clientSecret: "owner-linkedin-secret",
            enabled: true,
          }],
        }),
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/social/linkedin/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session },
        body: JSON.stringify({
          siteId: "site-1",
          returnPath: "/social",
          credentialSource: "byo",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { url: string };
    const url = new URL(body.url);

    expect(response.status).toBe(200);
    expect(url.origin).toBe("https://www.linkedin.com");
    expect(url.searchParams.get("client_id")).toBe("owner-linkedin-client");
    expect(url.searchParams.get("scope")).toBe(
      "openid profile w_member_social",
    );
  });

  it("gates Social Publishing OAuth start when disabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/deactivate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/social/linkedin/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ siteId: "site-1" }),
      }),
      env,
    );
    const body = (await response.json()) as {
      error: string;
      plugin: { status: string; ready: boolean };
    };

    expect(response.status).toBe(403);
    expect(body.error).toBe("Social Publishing is disabled");
    expect(body.plugin).toMatchObject({ status: "disabled", ready: false });
  });

  it("starts LinkedIn OAuth and connects a social account from callback state", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/social/provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providers: [
            {
              id: "linkedin",
              clientId: "linkedin-client",
              clientSecret: "linkedin-secret-1234",
              enabled: true,
            },
          ],
        }),
      }),
      env,
    );

    const authorizeResponse = await app.fetch(
      new Request("http://localhost/api/social/linkedin/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ siteId: "site-1", returnPath: "/social" }),
      }),
      env,
    );
    const authorizeBody = (await authorizeResponse.json()) as { url: string };
    const authorizeUrl = new URL(authorizeBody.url);
    const state = authorizeUrl.searchParams.get("state");

    expect(authorizeResponse.status).toBe(200);
    expect(authorizeUrl.origin).toBe("https://www.linkedin.com");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("linkedin-client");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/api/social/linkedin/callback",
    );
    expect(state).toBeTruthy();
    expect(env.socialOauthStates).toHaveLength(1);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("accessToken")) {
        return new Response(
          JSON.stringify({
            access_token: "linkedin-access-token",
            refresh_token: "linkedin-refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          sub: "linkedin-owner",
          name: "Owner LinkedIn",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const callbackResponse = await app.fetch(
        new Request(
          `http://localhost/api/social/linkedin/callback?code=ok-code&state=${encodeURIComponent(
            state || "",
          )}`,
        ),
        env,
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:4000/social?social_connected=linkedin",
      );
      expect(env.socialOauthStates).toHaveLength(0);
      expect(env.socialAccounts).toEqual([
        expect.objectContaining({
          platform: "linkedin",
          platform_account_id: "linkedin-owner",
          display_name: "Owner LinkedIn",
          status: "active",
        }),
      ]);
      expect(env.socialAccounts[0].access_token_ciphertext).toMatch(/^v1\./);
      expect(env.socialAccounts[0].access_token_ciphertext).not.toContain(
        "linkedin-access-token",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects Social Publishing callback with invalid state", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/plugins/me3.social-publishing/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const response = await app.fetch(
      new Request(
        "http://localhost/api/social/linkedin/callback?code=ok-code&state=missing-state",
      ),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:4000/social?social_error=state_expired",
    );
  });

  it("rejects activation for plugins outside the catalog", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/plugins/unknown.plugin/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    expect(response.status).toBe(404);
  });

  it("activates the landing-pages plugin", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/plugins/me3.landing-pages/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      plugin: { id: string; status: string; enabled: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.plugin).toMatchObject({
      id: "me3.landing-pages",
      status: "installed",
      enabled: true,
    });
  });

  it("keeps campaign APIs behind the activatable Email Campaigns plugin", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const disabled = await app.fetch(
      new Request("http://localhost/api/email/campaigns", {
        headers: { Cookie: session },
      }),
      env,
    );
    expect(disabled.status).toBe(403);
    await expect(disabled.json()).resolves.toMatchObject({
      code: "campaign_plugin_required",
    });

    const activation = await app.fetch(
      new Request("http://localhost/api/plugins/me3.email-campaigns/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    expect(activation.status).toBe(200);

    const enabled = await app.fetch(
      new Request("http://localhost/api/email/campaigns", {
        headers: { Cookie: session },
      }),
      env,
    );
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({ campaigns: [] });
  });

  it("keeps landing pages inside an existing site", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/sites", {
        method: "POST",
        headers: {
          Cookie: session,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "owner-event",
          siteType: "landing_page",
          templateId: "event",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { error: string; action: string };

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Create landing pages inside an existing site.",
      action: "createSitePage",
    });
  });

  it("loads AI provider settings for the signed-in owner", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/ai-settings", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      encryptionConfigured: boolean;
      providers: Array<{ id: string; configured: boolean; setupRequired: boolean }>;
      routes: Array<{ id: string; providerId: string; model: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.encryptionConfigured).toBe(true);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "openai",
          configured: false,
          setupRequired: true,
        }),
        expect.objectContaining({
          id: "workers-ai",
          configured: false,
          setupRequired: true,
        }),
      ]),
    );
    expect(body.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "chat",
          providerId: "workers-ai",
          model: DEFAULT_WORKERS_AI_TEXT_MODEL,
        }),
        expect.objectContaining({
          id: "image_generation",
          providerId: "workers-ai",
          model: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
        }),
      ]),
    );
  });

  it("reports GPT Image 2 as the managed image route without route variables", async () => {
    const env = createEnv();
    env.ME3_DEPLOYMENT_MODE = "managed";
    env.OPENAI_API_KEY = "sk-managed-openai";
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/ai-settings", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      deploymentMode: string;
      defaults: {
        image_generation: {
          providerId: string;
          model: string;
          configured: boolean;
          source: string;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.deploymentMode).toBe("managed");
    expect(body.defaults.image_generation).toMatchObject({
      providerId: "openai",
      model: DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
      configured: true,
      source: "recommended",
    });
  });

  it("saves encrypted AI provider keys and model defaults", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/ai-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providers: [{ id: "openai", apiKey: "sk-test-secret-1234" }],
          defaults: {
            chat: { providerId: "openai", model: "gpt-4.1-mini" },
            reasoning: { providerId: "openai", model: "o4-mini" },
            extraction: { providerId: "openai", model: "gpt-4.1-mini" },
          },
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      providers: Array<{ id: string; configured: boolean; source: string; keyHint: string }>;
      defaults: { chat: { providerId: string; model: string; configured: boolean } };
    };

    expect(response.status).toBe(200);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "openai",
          configured: true,
          source: "stored",
          keyHint: "***1234",
        }),
      ]),
    );
    expect(body.defaults.chat).toMatchObject({
      providerId: "openai",
      model: "gpt-4.1-mini",
      configured: true,
    });
    expect(env.aiCredentials[0].encrypted_api_key).toMatch(/^v1\./);
    expect(env.aiCredentials[0].encrypted_api_key).not.toContain("sk-test-secret-1234");
    expect(env.aiDefaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          use_case: "chat",
          provider_id: "openai",
          model: "gpt-4.1-mini",
        }),
      ]),
    );
  });

  it("routes OpenAI text generation through AI Gateway when enabled", async () => {
    const env = createEnv();
    env.CLOUDFLARE_AI_GATEWAY_ID = "friend-one";
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/ai-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providers: [{ id: "openai", apiKey: "sk-openai-secret" }],
        }),
      }),
      env,
    );
    const gatewayResponse = await app.fetch(
      new Request("http://localhost/api/ai-gateway-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          accountId: "cf-account",
          apiToken: "cf-gateway-token",
        }),
      }),
      env,
    );
    expect(await gatewayResponse.json()).toMatchObject({
      configured: true,
      gatewayId: "friend-one",
      routeWorkersAi: true,
      routeExternalProviders: true,
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: "Gateway reply" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await generateAiText(env, "owner", {
        selectedModel: { providerId: "openai", model: "gpt-4.1-mini" },
        messages: [{ role: "user", content: "Hello" }],
      });
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

      expect(result.text).toBe("Gateway reply");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://gateway.ai.cloudflare.com/v1/cf-account/friend-one/openai/chat/completions",
        expect.any(Object),
      );
      expect(init.headers).toMatchObject({
        Authorization: "Bearer sk-openai-secret",
        "cf-aig-authorization": "Bearer cf-gateway-token",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses stored AI provider keys when encryption key lives in install secrets", async () => {
    const env = createEnv();
    env.TOKEN_ENCRYPTION_KEY = undefined;

    await updateAiSettings(env, "owner", {
      providers: [{ id: "openai", apiKey: "sk-openai-secret" }],
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: "Stored key reply" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await generateAiText(env, "owner", {
        selectedModel: { providerId: "openai", model: "gpt-4.1-mini" },
        messages: [{ role: "user", content: "Hello" }],
      });
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

      expect(result.text).toBe("Stored key reply");
      expect(env.installSecrets.get("TOKEN_ENCRYPTION_KEY")).toBeTruthy();
      expect(init.headers).toMatchObject({
        Authorization: "Bearer sk-openai-secret",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits unsupported sampling controls for OpenAI reasoning models", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/ai-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providers: [{ id: "openai", apiKey: "sk-openai-secret" }],
        }),
      }),
      env,
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: "Reasoning reply" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await generateAiText(env, "owner", {
        selectedModel: { providerId: "openai", model: "gpt-5.5" },
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.4,
        maxTokens: 1600,
      });
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;

      expect(result.text).toBe("Reasoning reply");
      expect(body).toMatchObject({
        model: "gpt-5.5",
        max_completion_tokens: 1600,
      });
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("max_tokens");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes Anthropic text generation through AI Gateway when enabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/ai-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providers: [{ id: "anthropic", apiKey: "sk-ant-secret" }],
        }),
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/ai-gateway-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          accountId: "cf-account",
          gatewayId: "me3",
          apiToken: "cf-gateway-token",
          routeExternalProviders: true,
        }),
      }),
      env,
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ content: [{ type: "text", text: "Claude gateway reply" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await generateAiText(env, "owner", {
        selectedModel: { providerId: "anthropic", model: "claude-3-5-haiku-latest" },
        messages: [{ role: "user", content: "Hello" }],
      });
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

      expect(result.text).toBe("Claude gateway reply");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://gateway.ai.cloudflare.com/v1/cf-account/me3/anthropic/v1/messages",
        expect.any(Object),
      );
      expect(init.headers).toMatchObject({
        "x-api-key": "sk-ant-secret",
        "cf-aig-authorization": "Bearer cf-gateway-token",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes OpenAI text generation through AI Gateway when legacy routing flags are disabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/ai-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providers: [{ id: "openai", apiKey: "sk-openai-secret" }],
        }),
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/ai-gateway-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          accountId: "cf-account",
          gatewayId: "me3",
          apiToken: "cf-gateway-token",
          routeExternalProviders: false,
        }),
      }),
      env,
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: "Gateway reply" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await generateAiText(env, "owner", {
        selectedModel: { providerId: "openai", model: "gpt-4.1-mini" },
        messages: [{ role: "user", content: "Hello" }],
      });
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

      expect(result.text).toBe("Gateway reply");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://gateway.ai.cloudflare.com/v1/cf-account/me3/openai/chat/completions",
        expect.any(Object),
      );
      expect(init.headers).toMatchObject({
        Authorization: "Bearer sk-openai-secret",
        "cf-aig-authorization": "Bearer cf-gateway-token",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires owner auth for AI provider settings", async () => {
    const env = createEnv();

    const response = await app.fetch(new Request("http://localhost/api/ai-settings"), env);

    expect(response.status).toBe(401);
  });

  it("loads SMTP-first email provider settings for the signed-in owner", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      encryptionConfigured: boolean;
      activeProviderId: string;
      providers: Array<{
        id: string;
        recommended: boolean;
        setupRequirements: Array<{ id: string; label: string }>;
      }>;
      futureProviders: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.encryptionConfigured).toBe(true);
    expect(body.activeProviderId).toBe("smtp");
    expect(body.providers[0]).toMatchObject({
      id: "smtp",
      recommended: true,
      stable: true,
    });
    expect(body.providers[0].setupRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "smtp-host",
          label: "SMTP host",
        }),
        expect.objectContaining({
          id: "submission-port",
        }),
      ]),
    );
    expect(body.providers[1]).toMatchObject({
      id: "mailgun",
      recommended: false,
      stable: true,
    });
    expect(body.providers[2]).toMatchObject({
      id: "postmark",
      recommended: false,
      stable: true,
    });
    expect(body.providers[3]).toMatchObject({
      id: "cloudflare-email",
      recommended: false,
    });
    expect(body.futureProviders.map((provider) => provider.id)).not.toContain("mailgun");
  });

  it("saves encrypted Postmark sender settings without returning the token", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "postmark",
          providers: [
            {
              id: "postmark",
              fromAddress: "hello@example.com",
              fromName: "ME3 Mail",
              replyToAddress: "reply@example.com",
              messageStream: "outbound",
              serverToken: "postmark-secret-1234",
            },
          ],
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      activeProviderId: string;
      providers: Array<{
        id: string;
        configured: boolean;
        source: string;
        keyHint: string | null;
        config: { fromAddress: string; fromName: string };
      }>;
    };
    const postmark = body.providers.find((provider) => provider.id === "postmark");

    expect(response.status).toBe(200);
    expect(body.activeProviderId).toBe("postmark");
    expect(postmark).toMatchObject({
      configured: true,
      source: "stored",
      keyHint: "***1234",
      config: {
        fromAddress: "hello@example.com",
        fromName: "ME3 Mail",
      },
    });
    expect(JSON.stringify(body)).not.toContain("postmark-secret-1234");
    expect(env.emailProviderSettings[0].encrypted_secret).toMatch(/^v1\./);
    expect(env.emailProviderSettings[0].encrypted_secret).not.toContain(
      "postmark-secret-1234",
    );
  });

  it("saves encrypted SMTP sender settings without returning the password", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "smtp",
          providers: [
            {
              id: "smtp",
              fromAddress: "hello@example.com",
              fromName: "ME3 Mail",
              smtpHost: "smtp.example.com",
              smtpPort: 587,
              smtpSecurity: "starttls",
              smtpUsername: "smtp-user",
              apiToken: "smtp-password-1234",
            },
          ],
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      activeProviderId: string;
      providers: Array<{
        id: string;
        configured: boolean;
        source: string;
        keyHint: string | null;
        config: { smtpHost: string; smtpPort: number; smtpSecurity: string };
      }>;
    };
    const smtp = body.providers.find((provider) => provider.id === "smtp");

    expect(response.status).toBe(200);
    expect(body.activeProviderId).toBe("smtp");
    expect(smtp).toMatchObject({
      configured: true,
      source: "stored",
      keyHint: "***1234",
      config: {
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpSecurity: "starttls",
      },
    });
    expect(JSON.stringify(body)).not.toContain("smtp-password-1234");
    expect(env.emailProviderSettings[0].encrypted_secret).toMatch(/^v1\./);
    expect(env.emailProviderSettings[0].encrypted_secret).not.toContain(
      "smtp-password-1234",
    );
  });

  it("saves encrypted Mailgun sender settings without returning the API key", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "mailgun",
          providers: [
            {
              id: "mailgun",
              fromAddress: "hello@example.com",
              fromName: "ME3 Mail",
              replyToAddress: "reply@example.com",
              sendingDomain: "mg.example.com",
              mailgunRegion: "eu",
              apiToken: "mailgun-secret-1234",
            },
          ],
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      activeProviderId: string;
      providers: Array<{
        id: string;
        configured: boolean;
        source: string;
        keyHint: string | null;
        config: {
          fromAddress: string;
          replyToAddress: string;
          sendingDomain: string;
          mailgunRegion: string;
        };
      }>;
    };
    const mailgun = body.providers.find((provider) => provider.id === "mailgun");

    expect(response.status).toBe(200);
    expect(body.activeProviderId).toBe("mailgun");
    expect(mailgun).toMatchObject({
      configured: true,
      source: "stored",
      keyHint: "***1234",
      config: {
        fromAddress: "hello@example.com",
        replyToAddress: "reply@example.com",
        sendingDomain: "mg.example.com",
        mailgunRegion: "eu",
      },
    });
    expect(JSON.stringify(body)).not.toContain("mailgun-secret-1234");
    expect(env.emailProviderSettings[0].encrypted_secret).toMatch(/^v1\./);
    expect(env.emailProviderSettings[0].encrypted_secret).not.toContain(
      "mailgun-secret-1234",
    );
  });

  it("sends a Cloudflare Email Service test message through the binding adapter", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "cloudflare-email",
          providers: [
            {
              id: "cloudflare-email",
              transport: "binding",
              fromAddress: "owner@example.com",
              fromName: "ME3 Owner",
              sendingDomain: "example.com",
            },
          ],
        }),
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          providerId: "cloudflare-email",
          to: "owner@example.com",
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      providerId: string;
      providerMessageId: string;
      sentTo: string;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      providerId: "cloudflare-email",
      providerMessageId: "cf-1",
      sentTo: "owner@example.com",
    });
    expect(env.emailSends[0]).toMatchObject({
      from: { email: "owner@example.com", name: "ME3 Owner" },
      to: "owner@example.com",
      subject: "ME3 test email",
    });
    expect(env.emailSendAudit).toEqual([
      expect.objectContaining({
        provider_id: "cloudflare-email",
        provider_message_id: "cf-1",
        status: "sent",
        purpose: "test",
      }),
    ]);
  });

  it("sends product purchase confirmation test emails through the configured sender", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addBookableSite(env);
    addReadyCloudflareEmailProvider(env);

    const response = await app.fetch(
      new Request("http://localhost/api/sites/owner/products/confirmation-email/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          productSlug: "guide",
          productTitle: "Launch Guide",
          siteName: "Booking Owner",
          subject: "Your {{ productTitle }}",
          message: "Hi {{ buyerName }}, here are the next steps.",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; sentTo: string; subject: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      sentTo: "owner@example.com",
      subject: "[Test] Your Launch Guide",
    });
    expect(env.emailSends[0]).toMatchObject({
      to: "owner@example.com",
      subject: "[Test] Your Launch Guide",
    });
  });

  it("sends booking confirmation test emails through the configured sender", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    addBookableSite(env);
    addReadyCloudflareEmailProvider(env);

    const response = await app.fetch(
      new Request("http://localhost/api/sites/owner/bookings/confirmation-email/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          to: "preview@example.com",
          bookingTitle: "Book a Call",
          siteName: "Booking Owner",
          durationMinutes: 75,
          timezone: "Europe/Dublin",
          paymentMethod: "manual",
          amountDue: 80,
          currency: "EUR",
          paymentInstructions: "Pay at https://pay.example/session",
        }),
      }),
      env,
    );
    const body = (await response.json()) as { ok: boolean; sentTo: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, sentTo: "preview@example.com" });
    expect(env.emailSends[0]).toMatchObject({
      to: "preview@example.com",
      subject: "[Test] Booking confirmed: Book a Call",
      text: expect.stringContaining(
        "Payment details:\nPay at https://pay.example/session",
      ),
    });
  });

  it("approves Cloudflare Email Service drafts without platform-controlled headers", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "cloudflare-email",
          providers: [
            {
              id: "cloudflare-email",
              transport: "binding",
              fromAddress: "owner@example.com",
              fromName: "ME3 Owner",
              sendingDomain: "example.com",
            },
          ],
        }),
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          aliasLocalPart: "owner",
          forwardingEnabled: false,
        }),
      }),
      env,
    );

    const draftResponse = await app.fetch(
      new Request("http://localhost/api/mailbox/drafts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          to: "client@example.com",
          subject: "Hello",
          textBody: "Approved send body",
          source: "user",
        }),
      }),
      env,
    );
    const draftBody = (await draftResponse.json()) as {
      draft: { id: string; status: string };
    };
    expect(draftResponse.status).toBe(201);
    expect(draftBody.draft.status).toBe("pending_approval");

    const approveResponse = await app.fetch(
      new Request(`http://localhost/api/mailbox/drafts/${draftBody.draft.id}/approve`, {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const approveBody = (await approveResponse.json()) as {
      draft: { status: string; providerId: string; providerMessageId: string };
    };

    expect(approveResponse.status).toBe(200);
    expect(approveBody.draft).toMatchObject({
      status: "sent",
      providerId: "cloudflare-email",
      providerMessageId: "cf-1",
    });
    expect(env.emailSends[0]).toMatchObject({
      from: { email: "owner@example.com", name: "ME3 Owner" },
      to: "client@example.com",
      subject: "Hello",
    });
    expect(env.emailSends[0].headers).toMatchObject({
      "X-ME3-Provider": "cloudflare-email",
    });
    expect(env.emailSends[0].headers).not.toHaveProperty("Message-ID");
    expect(env.emailSends[0].headers).toHaveProperty("X-ME3-Requested-Message-ID");
  });

  it("sends a Postmark test message through the provider adapter", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ErrorCode: 0,
            Message: "OK",
            MessageID: "pm-test-1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await app.fetch(
        new Request("http://localhost/api/email-provider-settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({
            activeProviderId: "postmark",
            providers: [
              {
                id: "postmark",
                fromAddress: "owner@example.com",
                fromName: "ME3 Owner",
                messageStream: "outbound",
                serverToken: "postmark-secret-1234",
              },
            ],
          }),
        }),
        env,
      );

      const response = await app.fetch(
        new Request("http://localhost/api/email-provider-settings/test", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({ to: "owner@example.com" }),
        }),
        env,
      );
      const body = (await response.json()) as {
        ok: boolean;
        providerId: string;
        providerMessageId: string;
        sentTo: string;
      };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        providerId: "postmark",
        providerMessageId: "pm-test-1",
        sentTo: "owner@example.com",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(env.emailSendAudit).toEqual([
        expect.objectContaining({
          provider_id: "postmark",
          provider_message_id: "pm-test-1",
          status: "sent",
          purpose: "test",
        }),
      ]);
      expect(env.emailProviderSettings[0]).toMatchObject({
        provider_id: "postmark",
        last_status: "ready",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends a Mailgun test message through the provider adapter", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "<mg-test-1@mg.example.com>",
            message: "Queued. Thank you.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await app.fetch(
        new Request("http://localhost/api/email-provider-settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({
            activeProviderId: "mailgun",
            providers: [
              {
                id: "mailgun",
                fromAddress: "owner@example.com",
                fromName: "ME3 Owner",
                replyToAddress: "reply@example.com",
                sendingDomain: "mg.example.com",
                mailgunRegion: "eu",
                apiToken: "mailgun-secret-1234",
              },
            ],
          }),
        }),
        env,
      );

      const response = await app.fetch(
        new Request("http://localhost/api/email-provider-settings/test", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({ to: "owner@example.com" }),
        }),
        env,
      );
      const body = (await response.json()) as {
        ok: boolean;
        providerId: string;
        providerMessageId: string;
        sentTo: string;
      };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        providerId: "mailgun",
        providerMessageId: "<mg-test-1@mg.example.com>",
        sentTo: "owner@example.com",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.eu.mailgun.net/v3/mg.example.com/messages",
      );
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toMatchObject({
        Authorization: `Basic ${btoa("api:mailgun-secret-1234")}`,
      });
      const form = init.body as FormData;
      expect(form.get("from")).toBe("ME3 Owner <owner@example.com>");
      expect(form.get("to")).toBe("owner@example.com");
      expect(form.get("subject")).toBe("ME3 test email");
      expect(form.get("text")).toBe(
        "This is a test email from your ME3 outbound sender settings.",
      );
      expect(form.get("html")).toBe(
        "<p>This is a test email from your ME3 outbound sender settings.</p>",
      );
      expect(form.get("h:Reply-To")).toBe("reply@example.com");
      expect(form.get("h:X-ME3-Provider")).toBe("mailgun");
      expect(env.emailSendAudit).toEqual([
        expect.objectContaining({
          provider_id: "mailgun",
          provider_message_id: "<mg-test-1@mg.example.com>",
          status: "sent",
          purpose: "test",
        }),
      ]);
      expect(env.emailProviderSettings[0]).toMatchObject({
        provider_id: "mailgun",
        last_status: "ready",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends an SMTP test message through the socket adapter", async () => {
    const env = createEnv();
    const smtp = createFakeSmtpConnect();
    env.SMTP_CONNECT = smtp.connect;
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "smtp",
          providers: [
            {
              id: "smtp",
              fromAddress: "owner@example.com",
              fromName: "ME3 Owner",
              smtpHost: "smtp.example.com",
              smtpPort: 587,
              smtpSecurity: "starttls",
              smtpUsername: "smtp-user",
              apiToken: "smtp-password-1234",
            },
          ],
        }),
      }),
      env,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ providerId: "smtp", to: "owner@example.com" }),
      }),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      providerId: string;
      providerMessageId: string;
      sentTo: string;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      providerId: "smtp",
      providerMessageId: "smtp-test-1",
      sentTo: "owner@example.com",
    });
    expect(smtp.commands).toEqual(
      expect.arrayContaining([
        "EHLO example.com",
        "STARTTLS",
        "AUTH PLAIN AHNtdHAtdXNlcgBzbXRwLXBhc3N3b3JkLTEyMzQ=",
        "MAIL FROM:<owner@example.com>",
        "RCPT TO:<owner@example.com>",
        "DATA",
        "[DATA]",
        "QUIT",
      ]),
    );
    expect(smtp.messages[0]).toContain("Subject: ME3 test email");
    expect(smtp.messages[0]).toContain("X-ME3-Provider: smtp");
    expect(env.emailSendAudit).toEqual([
      expect.objectContaining({
        provider_id: "smtp",
        provider_message_id: "smtp-test-1",
        status: "sent",
        purpose: "test",
      }),
    ]);
    expect(env.emailProviderSettings[0]).toMatchObject({
      provider_id: "smtp",
      last_status: "ready",
    });
  });

  it("rejects SMTP port 25 because Workers cannot use it for outbound SMTP", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "smtp",
          providers: [
            {
              id: "smtp",
              fromAddress: "owner@example.com",
              smtpHost: "smtp.example.com",
              smtpPort: 25,
              smtpSecurity: "starttls",
              smtpUsername: "smtp-user",
              apiToken: "smtp-password-1234",
            },
          ],
        }),
      }),
      env,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("SMTP port 25 is not supported");
  });

  it("requires owner auth for email provider settings", async () => {
    const env = createEnv();

    const response = await app.fetch(
      new Request("http://localhost/api/email-provider-settings"),
      env,
    );

    expect(response.status).toBe(401);
  });

  it("updates account timezone and explicit locale", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/account", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ timezone: "Europe/Dublin", locale: "en-IE" }),
      }),
      env,
    );
    const body = (await response.json()) as {
      user: { timezone: string; locale: string; localeSource: string };
    };

    expect(response.status).toBe(200);
    expect(body.user.timezone).toBe("Europe/Dublin");
    expect(body.user.locale).toBe("en-IE");
    expect(body.user.localeSource).toBe("explicit");
  });

  it("creates and updates Core mailbox settings", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const createResponse = await app.fetch(
      new Request("http://localhost/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          aliasLocalPart: "Owner.Mail",
          forwardingEnabled: true,
          forwardingEmail: "inbox@example.com",
        }),
      }),
      env,
    );
    const createBody = (await createResponse.json()) as {
      mailbox: {
        aliasAddress: string | null;
        forwardingEnabled: boolean;
        dailyInboundLimit: number;
        dailyOutboundLimit: number;
      };
      sources: { address: string }[];
    };

    expect(createResponse.status).toBe(200);
    expect(createBody.mailbox.aliasAddress).toBeNull();
    expect(createBody.mailbox.forwardingEnabled).toBe(true);
    expect(createBody.mailbox.dailyInboundLimit).toBe(200);
    expect(createBody.mailbox.dailyOutboundLimit).toBe(200);
    expect(createBody.sources).toEqual([]);

    const activateResponse = await app.fetch(
      new Request("http://localhost/api/mailbox/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    expect(activateResponse.status).toBe(200);
    expect(env.mailbox?.status).toBe("active");

    const providerResponse = await app.fetch(
      new Request("http://localhost/api/email-provider-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          activeProviderId: "postmark",
          providers: [
            {
              id: "postmark",
              fromAddress: "owner@custom.example",
              fromName: "Owner",
              messageStream: "outbound",
              serverToken: "postmark-secret-1234",
            },
          ],
        }),
      }),
      env,
    );
    expect(providerResponse.status).toBe(200);

    const configuredResponse = await app.fetch(
      new Request("http://localhost/api/mailbox", {
        headers: { Cookie: session },
      }),
      env,
    );
    const configuredBody = (await configuredResponse.json()) as {
      mailbox: { aliasAddress: string | null };
      sources: Array<{
        address: string;
        status: string;
        inboundEnabled: boolean;
        outboundEnabled: boolean;
      }>;
    };
    expect(configuredResponse.status).toBe(200);
    expect(configuredBody.mailbox.aliasAddress).toBeNull();
    expect(configuredBody.sources).toEqual([
      expect.objectContaining({
        address: "owner@custom.example",
        status: "active",
        inboundEnabled: false,
        outboundEnabled: true,
      }),
    ]);
  });

  it("exposes the public @me3.app address for managed mailboxes", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ aliasLocalPart: "tester", forwardingEnabled: false }),
      }),
      env,
    );
    env.ME3_DEPLOYMENT_MODE = "managed";

    const response = await app.fetch(
      new Request("http://localhost/api/mailbox", { headers: { Cookie: session } }),
      env,
    );
    const body = (await response.json()) as {
      cloudflareManaged: boolean;
      mailbox: { aliasAddress: string };
      sources: Array<{ address: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.cloudflareManaged).toBe(true);
    expect(body.mailbox.aliasAddress).toBe("tester@me3.app");
    expect(body.sources).toMatchObject([{ address: "tester@me3.app" }]);
  });

  it("stores inbound Cloudflare Email Routing messages in the active mailbox", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ aliasLocalPart: "name", forwardingEnabled: false }),
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/mailbox/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const inbound = createInboundEmailMessage(
      [
        "From: Client <client@example.com>",
        "To: name@example.com",
        "Subject: =?UTF-8?Q?It=E2=80=99s_getting_there_bro?=",
        "Message-ID: <standalone-test@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hello from Cloudflare Email Routing.",
      ].join("\r\n"),
      { from: "0100019eee31ac31@bounce.stripe.com" },
    );
    await emailWorker().email(inbound, env);

    expect(inbound.rejectedWith).toBeNull();
    expect(env.mailboxMessages).toEqual([
      expect.objectContaining({
        direction: "inbound",
        message_kind: "email",
        status: "received",
        provider_id: "cloudflare-email-routing",
        provider_message_id: "<standalone-test@example.com>",
        from_address: "client@example.com",
        to_address: "name@example.com",
        subject: "It’s getting there bro",
        text_body: "Hello from Cloudflare Email Routing.",
        folder: "inbox",
        created_by: "cloudflare-email-routing",
      }),
    ]);
  });

  it("exposes and performs one-click unsubscribe for inbound list messages", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({ aliasLocalPart: "name", forwardingEnabled: false }),
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/mailbox/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const inbound = createInboundEmailMessage(
      [
        "From: List <news@example.com>",
        "To: name@example.com",
        "Subject: Newsletter",
        "Message-ID: <newsletter@example.com>",
        "List-Unsubscribe: <mailto:unsubscribe@example.com>, <https://example.com/unsubscribe/token>",
        "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Latest news.",
      ].join("\r\n"),
    );
    await emailWorker().email(inbound, env);

    const messagesResponse = await app.fetch(
      new Request("http://localhost/api/mailbox/messages?folder=inbox&direction=inbound", {
        headers: { Cookie: session },
      }),
      env,
    );
    const messagesBody = (await messagesResponse.json()) as {
      messages: Array<{ id: string; unsubscribeAction: unknown }>;
    };
    expect(messagesBody.messages[0]?.unsubscribeAction).toEqual({
      available: true,
      mode: "one_click",
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const unsubscribeResponse = await app.fetch(
        new Request(
          `http://localhost/api/mailbox/messages/${messagesBody.messages[0]?.id}/unsubscribe`,
          {
            method: "POST",
            headers: { Cookie: session },
          },
        ),
        env,
      );
      expect(unsubscribeResponse.status).toBe(200);
      expect(await unsubscribeResponse.json()).toEqual({
        ok: true,
        mode: "one_click",
        status: 204,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/unsubscribe/token",
        expect.objectContaining({
          method: "POST",
          body: "List-Unsubscribe=One-Click",
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forwards inbound mailbox copies when forwarding is enabled", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          aliasLocalPart: "name",
          forwardingEnabled: true,
          forwardingEmail: "archive@example.com",
        }),
      }),
      env,
    );
    await app.fetch(
      new Request("http://localhost/api/mailbox/activate", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const inbound = createInboundEmailMessage(
      "Subject: Forward me\r\nMessage-ID: <forward-me@example.com>\r\n\r\nKeep a copy.",
    );
    await emailWorker().email(inbound, env);

    expect(inbound.forwardedTo).toEqual(["archive@example.com"]);
    expect(env.mailboxMessages[0]).toMatchObject({
      status: "forwarded",
      forwarded_to: "archive@example.com",
    });
  });

  it("rejects inbound email when no mailbox is active", async () => {
    const env = createEnv();
    await bootstrap(env);

    const inbound = createInboundEmailMessage("Subject: No mailbox\r\n\r\nHello.");
    await emailWorker().email(inbound, env);

    expect(inbound.rejectedWith).toBe(
      "The ME3 mailbox is not active for this installation.",
    );
    expect(env.mailboxMessages).toEqual([]);
  });

  it("loads a mailbox draft by id for assistant draft cards", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    await app.fetch(
      new Request("http://localhost/api/mailbox", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          aliasLocalPart: "owner",
          forwardingEnabled: false,
        }),
      }),
      env,
    );

    const draftResponse = await app.fetch(
      new Request("http://localhost/api/mailbox/drafts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          to: "client@example.com",
          subject: "Hello",
          textBody: "Short draft body",
          source: "agent",
        }),
      }),
      env,
    );
    const draftBody = (await draftResponse.json()) as {
      draft: { id: string };
    };

    const readResponse = await app.fetch(
      new Request(
        `http://localhost/api/mailbox/messages/${draftBody.draft.id}`,
        {
          headers: { Cookie: session },
        },
      ),
      env,
    );
    const readBody = (await readResponse.json()) as {
      message: { id: string; toAddress: string; subject: string; body: string };
    };

    expect(readResponse.status).toBe(200);
    expect(readBody.message).toMatchObject({
      id: draftBody.draft.id,
      toAddress: "client@example.com",
      subject: "Hello",
      body: "Short draft body",
    });
  });

  it("approves mailbox drafts through the active Postmark provider", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ErrorCode: 0,
            Message: "OK",
            MessageID: "pm-draft-1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await app.fetch(
        new Request("http://localhost/api/email-provider-settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({
            activeProviderId: "postmark",
            providers: [
              {
                id: "postmark",
                fromAddress: "hello@example.com",
                fromName: "ME3 Mail",
                messageStream: "outbound",
                serverToken: "postmark-secret-1234",
              },
            ],
          }),
        }),
        env,
      );
      await app.fetch(
        new Request("http://localhost/api/mailbox", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({
            aliasLocalPart: "owner",
            forwardingEnabled: false,
          }),
        }),
        env,
      );

      const draftResponse = await app.fetch(
        new Request("http://localhost/api/mailbox/drafts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: session,
          },
          body: JSON.stringify({
            to: "client@example.com",
            subject: "Hello",
            textBody: "Approved send body",
            source: "user",
          }),
        }),
        env,
      );
      const draftBody = (await draftResponse.json()) as {
        draft: { id: string; status: string };
      };
      expect(draftResponse.status).toBe(201);
      expect(draftBody.draft.status).toBe("pending_approval");

      const approveResponse = await app.fetch(
        new Request(`http://localhost/api/mailbox/drafts/${draftBody.draft.id}/approve`, {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const approveBody = (await approveResponse.json()) as {
        draft: { status: string; providerId: string; providerMessageId: string };
      };

      expect(approveResponse.status).toBe(200);
      expect(approveBody.draft).toMatchObject({
        status: "sent",
        providerId: "postmark",
        providerMessageId: "pm-draft-1",
      });
      expect(env.mailboxMessages[0]).toMatchObject({
        status: "sent",
        provider_id: "postmark",
        provider_message_id: "pm-draft-1",
      });
      expect(env.emailSendAudit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mailbox_message_id: draftBody.draft.id,
            provider_id: "postmark",
            provider_message_id: "pm-draft-1",
            purpose: "draft",
            status: "sent",
          }),
        ]),
      );
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        From: "ME3 Mail <hello@example.com>",
        To: "client@example.com",
        Subject: "Hello",
        MessageStream: "outbound",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a draft approved when the provider response is unknown", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const draftId = await createPostmarkMailboxDraft(env, session);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Provider request timed out");
      }),
    );

    try {
      const response = await app.fetch(
        new Request(`http://localhost/api/mailbox/drafts/${draftId}/approve`, {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const body = (await response.json()) as {
        error: string;
        delivery: { state: string };
      };

      expect(response.status).toBe(502);
      expect(body.error).toContain("could not be confirmed");
      expect(body.delivery.state).toBe("sending");
      expect(env.mailboxMessages[0]).toMatchObject({
        id: draftId,
        message_kind: "draft",
        status: "approved",
        folder: "drafts",
        error_message: null,
      });
      expect(env.emailSendAudit).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a provider-accepted draft approved when its sent audit cannot be stored", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const draftId = await createPostmarkMailboxDraft(env, session);
    env.failEmailSendAuditInsertOnce = true;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ErrorCode: 0, Message: "OK", MessageID: "pm-unknown-1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const response = await app.fetch(
        new Request(`http://localhost/api/mailbox/drafts/${draftId}/approve`, {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const body = (await response.json()) as {
        error: string;
        delivery: { state: string };
      };

      expect(response.status).toBe(502);
      expect(body.error).toContain("provider accepted the message");
      expect(body.delivery.state).toBe("sending");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(env.mailboxMessages[0]).toMatchObject({
        id: draftId,
        message_kind: "draft",
        status: "approved",
        folder: "drafts",
        error_message: null,
      });
      expect(env.emailSendAudit).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reconciles a sent audit when the first mailbox sent update fails", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const draftId = await createPostmarkMailboxDraft(env, session);
    env.failMailboxDraftSentUpdateOnce = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ErrorCode: 0, Message: "OK", MessageID: "pm-reconciled-1" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    try {
      const response = await app.fetch(
        new Request(`http://localhost/api/mailbox/drafts/${draftId}/approve`, {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const body = (await response.json()) as {
        draft: { status: string; providerMessageId: string | null };
      };

      expect(response.status).toBe(200);
      expect(body.draft).toMatchObject({
        status: "sent",
        providerMessageId: "pm-reconciled-1",
      });
      expect(env.mailboxMessages[0]).toMatchObject({
        id: draftId,
        message_kind: "email",
        status: "sent",
        folder: "sent",
        error_message: null,
      });
      expect(env.emailSendAudit).toEqual([
        expect.objectContaining({
          mailbox_message_id: draftId,
          provider_message_id: "pm-reconciled-1",
          status: "sent",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("approves mailbox replies with provider thread headers", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ ErrorCode: 0, Message: "OK", MessageID: "pm-reply-1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await app.fetch(
        new Request("http://localhost/api/email-provider-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({
            activeProviderId: "postmark",
            providers: [
              {
                id: "postmark",
                fromAddress: "hello@example.com",
                fromName: "ME3 Mail",
                messageStream: "outbound",
                serverToken: "postmark-secret-1234",
              },
            ],
          }),
        }),
        env,
      );
      await app.fetch(
        new Request("http://localhost/api/mailbox", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({ aliasLocalPart: "owner", forwardingEnabled: false }),
        }),
        env,
      );

      const now = new Date().toISOString();
      env.mailboxMessages.push({
        id: "inbound-1",
        mailbox_id: env.mailbox!.id,
        direction: "inbound",
        message_kind: "email",
        status: "received",
        thread_key: "thread-1",
        provider_id: "postmark",
        provider_message_id: "inbound-provider-1",
        from_address: "client@example.com",
        to_address: "owner@me3.local",
        subject: "Question",
        text_body: "Can you help?",
        html_body: null,
        raw_headers_json: JSON.stringify({
          "message-id": "<client-message@example.com>",
          references: "<previous@example.com>",
        }),
        raw_message: null,
        metadata_json: null,
        source_id: null,
        folder: "inbox",
        read_at: null,
        agent_summary: null,
        agent_labels_json: null,
        forwarded_to: null,
        error_message: null,
        created_by: "system",
        approved_by_user_id: null,
        received_at: now,
        approved_at: null,
        sent_at: null,
        created_at: now,
        updated_at: now,
      });

      const draftResponse = await app.fetch(
        new Request("http://localhost/api/mailbox/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session },
          body: JSON.stringify({
            fromAddress: "hello@example.com",
            to: "client@example.com",
            subject: "Re: Question",
            textBody: "Happy to help.",
            source: "user",
            replyToMessageId: "inbound-1",
          }),
        }),
        env,
      );
      const draftBody = (await draftResponse.json()) as {
        draft: { id: string; metadata: Record<string, Record<string, string>> };
      };
      expect(draftResponse.status).toBe(201);
      expect(draftBody.draft.metadata.outbound_headers).toMatchObject({
        in_reply_to: "<client-message@example.com>",
        references: "<previous@example.com> <client-message@example.com>",
      });

      const approveResponse = await app.fetch(
        new Request(`http://localhost/api/mailbox/drafts/${draftBody.draft.id}/approve`, {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );

      expect(approveResponse.status).toBe(200);
      expect(env.emailSendAudit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mailbox_message_id: draftBody.draft.id,
            purpose: "reply",
            message_id_header: expect.stringMatching(/^<.+@example\.com>$/),
            in_reply_to: "<client-message@example.com>",
            references_header: "<previous@example.com> <client-message@example.com>",
            status: "sent",
          }),
        ]),
      );
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(init?.body)).Headers).toEqual(
        expect.arrayContaining([
          { Name: "In-Reply-To", Value: "<client-message@example.com>" },
          {
            Name: "References",
            Value: "<previous@example.com> <client-message@example.com>",
          },
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deletes the owner account and clears the session cookie", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(env.owner).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("prepares a Core Telegram setup connection", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/telegram/setup", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      configured: boolean;
      startUrl: string;
      connection: { status: string; telegramUsername: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.startUrl).toContain("https://t.me/me3_core_test_bot?start=");
    expect(body.connection.status).toBe("pending");
    expect(body.connection.telegramUsername).toBeNull();
  });

  it("reports unavailable Telegram setup when the Core bot username is not configured", async () => {
    const env = createEnv();
    env.TELEGRAM_BOT_USERNAME = undefined;
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/telegram/setup", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Telegram bot username is not configured",
    });
  });

  it("reports unavailable Telegram setup when the bot token is not configured", async () => {
    const env = createEnv();
    env.TELEGRAM_BOT_TOKEN = undefined;
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/telegram/setup", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Telegram bot token is not configured",
    });
  });

  it("stores owner-managed Telegram bot settings without returning secrets", async () => {
    const env = createEnv();
    env.TELEGRAM_BOT_USERNAME = undefined;
    env.TELEGRAM_BOT_TOKEN = undefined;
    env.TELEGRAM_WEBHOOK_SECRET = undefined;
    const session = cookieHeader(await bootstrap(env));

    const response = await app.fetch(
      new Request("http://localhost/api/telegram/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          botUsername: "owner_me3_bot",
          botToken: "123456:telegram-token-secret-1234",
          webhookSecret: "webhook_secret_1234",
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      configured: boolean;
      botUsername: string;
      tokenConfigured: boolean;
      webhookSecretConfigured: boolean;
      botTokenHint: string;
      webhookSecretHint: string;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      configured: true,
      botUsername: "owner_me3_bot",
      tokenConfigured: true,
      webhookSecretConfigured: true,
      botTokenHint: "***1234",
      webhookSecretHint: "***1234",
    });
    expect(JSON.stringify(body)).not.toContain("telegram-token-secret-1234");
    expect(JSON.stringify(body)).not.toContain("webhook_secret_1234");
    expect(env.telegramSettings?.encrypted_bot_token).toMatch(/^v1\./);
    expect(env.telegramSettings?.encrypted_bot_token).not.toContain(
      "telegram-token-secret-1234",
    );
    expect(env.telegramSettings?.encrypted_webhook_secret).toMatch(/^v1\./);
    expect(env.telegramSettings?.encrypted_webhook_secret).not.toContain(
      "webhook_secret_1234",
    );
  });

  it("sets the Telegram webhook from owner-managed settings", async () => {
    const env = createEnv();
    env.TELEGRAM_BOT_USERNAME = undefined;
    env.TELEGRAM_BOT_TOKEN = undefined;
    env.TELEGRAM_WEBHOOK_SECRET = undefined;
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/telegram/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify({
          botUsername: "owner_me3_bot",
          botToken: "123456:telegram-token-secret-1234",
          webhookSecret: "webhook_secret_1234",
        }),
      }),
      env,
    );

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/telegram/webhook/sync", {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const body = (await response.json()) as { ok: boolean; webhookUrl: string };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        webhookUrl: "http://localhost:8787/api/telegram/webhook",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.telegram.org/bot123456:telegram-token-secret-1234/setWebhook",
      );
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toMatchObject({
        url: "http://localhost:8787/api/telegram/webhook",
        secret_token: "webhook_secret_1234",
        allowed_updates: ["message"],
        drop_pending_updates: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("links Telegram webhook start messages to pending account connections", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/telegram/setup", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );

    const sendMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: {} }),
    );
    vi.stubGlobal("fetch", sendMock);

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/telegram/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
          },
          body: JSON.stringify({
            update_id: 1,
            message: {
              message_id: 10,
              text: `/start ${env.telegramConnection?.setup_token}`,
              chat: { id: 456, type: "private" },
              from: {
                id: 123,
                username: "owner",
                first_name: "Core",
                last_name: "Owner",
              },
            },
          }),
        }),
        env,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ ok: true, action: "linked" });
      expect(env.telegramConnection).toMatchObject({
        status: "active",
        telegram_user_id: "123",
        telegram_chat_id: "456",
        telegram_username: "owner",
      });
      expect(env.agentEvents).toContainEqual(
        expect.objectContaining({
          channel: "telegram",
          direction: "inbound",
          event_type: "start",
          status: "linked",
        }),
      );
      expect(sendMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("dispatches active Telegram messages through the agent runtime and replies", async () => {
    const env = createEnv();
    await bootstrap(env);
    env.telegramConnection = {
      id: "telegram-connection",
      user_id: "owner",
      channel: "telegram",
      status: "active",
      setup_token: "setup-token",
      provider_connection_id: null,
      provider_user_id: null,
      provider_thread_id: null,
      provider_username: null,
      provider_metadata_json: null,
      telegram_user_id: "123",
      telegram_chat_id: "456",
      telegram_username: "owner",
      telegram_first_name: "Core",
      telegram_last_name: "Owner",
      connected_at: "2026-05-11T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-05-11T10:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    };

    const runtimeFetch = vi.fn(async () =>
      Response.json({
        ok: true,
        auditId: null,
        turnId: "turn-1",
        specialist: "core.agent-chat",
        replyText:
          "## 1) Setup\n**Set goal:** Use [ME3](https://me3.app) and `code`.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      }),
    );
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const sendMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: {} }),
    );
    vi.stubGlobal("fetch", sendMock);

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/telegram/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
          },
          body: JSON.stringify({
            update_id: 2,
            message: {
              message_id: 11,
              text: "Hello agent",
              chat: { id: 456, type: "private" },
              from: { id: 123, username: "owner" },
            },
          }),
        }),
        env,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ ok: true, action: "agent_reply" });
      expect(runtimeFetch).toHaveBeenCalledOnce();
      expect(env.agentEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channel: "telegram",
            direction: "inbound",
            event_type: "message",
            text_body: "Hello agent",
          }),
          expect.objectContaining({
            channel: "telegram",
            direction: "outbound",
            event_type: "send",
            text_body:
              "## 1) Setup\n**Set goal:** Use [ME3](https://me3.app) and `code`.",
          }),
        ]),
      );
      expect(sendMock).toHaveBeenCalledOnce();
      const sendInit = sendMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(sendInit.body))).toMatchObject({
        chat_id: "456",
        text:
          '<b>1) Setup</b>\n<b>Set goal:</b> Use <a href="https://me3.app">ME3</a> and <code>code</code>.',
        parse_mode: "HTML",
        reply_to_message_id: 11,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("provisions Soulink as the primary assistant chat connector", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const provisionMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).includes("/api/me3/links")
        ? Response.json({ ok: true, ownerNodeId: "node-owner", links: [] })
        : Response.json({
          ok: true,
          ownerNodeId: "node-owner",
          assistantNodeId: "assistant-owner",
          streamChannelType: "messaging",
          streamChannelId: "assistant-channel",
          soulinkChatUrl: "https://soulink.test/chats/assistant-channel",
        }),
    );
    vi.stubGlobal("fetch", provisionMock);

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/soulink/setup", {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const body = (await response.json()) as {
        ok: boolean;
        configured: boolean;
        connection: { status: string; streamChannelId: string };
      };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        configured: true,
        connection: {
          status: "active",
          streamChannelId: "assistant-channel",
        },
      });
      expect(env.soulinkConnection).toMatchObject({
        channel: "soulink",
        status: "active",
        provider_thread_id: "assistant-channel",
        provider_user_id: "node-owner",
        provider_username: "assistant-owner",
      });
      expect(provisionMock).toHaveBeenCalledTimes(2);
      const init = provisionMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toMatchObject({
        runtime: {
          kind: "standalone-me3-core",
          callbackUrl: "http://localhost:8787/api/agent/channels/soulink/dispatch",
          dispatchToken: env.soulinkConnection?.setup_token,
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps Soulink setup event logging idempotent on reconnect", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    const provisionMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).includes("/api/me3/links")
        ? Response.json({ ok: true, ownerNodeId: "node-owner", links: [] })
        : Response.json({
          ok: true,
          ownerNodeId: "node-owner",
          assistantNodeId: "assistant-owner",
          streamChannelType: "messaging",
          streamChannelId: "assistant-channel",
          soulinkChatUrl: "https://soulink.test/chats/assistant-channel",
        }),
    );
    vi.stubGlobal("fetch", provisionMock);

    try {
      const firstResponse = await app.fetch(
        new Request("http://localhost/api/soulink/setup", {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );
      const secondResponse = await app.fetch(
        new Request("http://localhost/api/soulink/setup", {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(provisionMock).toHaveBeenCalledTimes(4);
      const provisionCalls = provisionMock.mock.calls.filter(([input]) =>
        !String(input).includes("/api/me3/links")
      );
      const firstInit = provisionCalls[0]?.[1] as RequestInit;
      const secondInit = provisionCalls[1]?.[1] as RequestInit;
      const firstProvision = JSON.parse(String(firstInit.body)) as {
        runtime: { dispatchToken: string };
      };
      const secondProvision = JSON.parse(String(secondInit.body)) as {
        runtime: { dispatchToken: string };
      };
      expect(secondProvision.runtime.dispatchToken).not.toBe(
        firstProvision.runtime.dispatchToken,
      );
      expect(env.soulinkConnection?.setup_token).toBe(
        secondProvision.runtime.dispatchToken,
      );
      expect(
        env.agentEvents.filter(
          (event) =>
            event.connection_id === env.soulinkConnection?.id &&
            event.provider_event_id === "setup:assistant-channel",
        ),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("dispatches Soulink messages through the agent runtime", async () => {
    const env = createEnv();
    await bootstrap(env);
    env.soulinkConnection = {
      id: "soulink-connection",
      user_id: "owner",
      channel: "soulink",
      status: "active",
      setup_token: "setup-token",
      provider_connection_id: "messaging",
      provider_user_id: "node-owner",
      provider_thread_id: "assistant-channel",
      provider_username: "assistant-owner",
      provider_metadata_json: JSON.stringify({
        ownerNodeId: "node-owner",
        assistantNodeId: "assistant-owner",
      }),
      telegram_user_id: null,
      telegram_chat_id: null,
      telegram_username: null,
      telegram_first_name: null,
      telegram_last_name: null,
      connected_at: "2026-05-11T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-05-11T10:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    };

    const runtimeFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        ok: true,
        auditId: null,
        turnId: "turn-1",
        specialist: "core.agent-chat",
        replyText: "Hello from Soulink Core.",
        model: "test-model",
        source: "fallback",
        fallbackReason: null,
        debugError: null,
        emailAction: null,
        reminderAction: null,
        contentAction: null,
        contactsChanged: false,
      }),
    );
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.fetch(
      new Request("http://localhost/api/agent/channels/soulink/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer setup-token",
        },
        body: JSON.stringify({
          sourceEventId: "stream-message-1",
          conversationId: "assistant-channel",
          streamChannelType: "messaging",
          streamChannelId: "assistant-channel",
          messageText: "Hello from Soulink",
        }),
      }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      replyText: "Hello from Soulink Core.",
      streamChannelId: "assistant-channel",
    });
    expect(runtimeFetch).toHaveBeenCalledOnce();
    const runtimeRequest = runtimeFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(runtimeRequest.body))).toMatchObject({
      threadId: "soulink:assistant-channel",
      attachmentTextContext: null,
    });
    expect(env.assistantThreads).toEqual([
      expect.objectContaining({
        id: "soulink:assistant-channel",
        origin_surface: "soulink",
      }),
    ]);
    expect(env.agentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "soulink",
          direction: "inbound",
          provider_event_id: "stream-message-1",
          text_body: "Hello from Soulink",
        }),
        expect.objectContaining({
          channel: "soulink",
          direction: "outbound",
          provider_event_id: "stream-message-1:reply",
          text_body: "Hello from Soulink Core.",
        }),
      ]),
    );

    const duplicateResponse = await app.fetch(
      new Request("http://localhost/api/agent/channels/soulink/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer setup-token",
        },
        body: JSON.stringify({
          sourceEventId: "stream-message-1",
          conversationId: "assistant-channel",
          streamChannelType: "messaging",
          streamChannelId: "assistant-channel",
          messageText: "Hello from Soulink",
        }),
      }),
      env,
    );
    expect(duplicateResponse.status).toBe(200);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      ok: true,
      deduped: true,
      turnId: "turn-1",
      replyText: "Hello from Soulink Core.",
    });
    expect(runtimeFetch).toHaveBeenCalledOnce();
    expect(env.assistantThreads).toHaveLength(1);

    const unauthorizedDelivery = await app.fetch(
      new Request("http://localhost/api/agent/channels/soulink/delivery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({
          sourceEventId: "stream-message-1",
          streamChannelId: "assistant-channel",
          providerMessageId: "stream-reply-1",
          status: "sent",
        }),
      }),
      env,
    );
    expect(unauthorizedDelivery.status).toBe(401);

    const deliveryRequest = () =>
      new Request("http://localhost/api/agent/channels/soulink/delivery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer setup-token",
        },
        body: JSON.stringify({
          sourceEventId: "stream-message-1",
          streamChannelId: "assistant-channel",
          providerMessageId: "stream-reply-1",
          status: "sent",
        }),
      });
    const deliveryResponse = await app.fetch(deliveryRequest(), env);
    expect(deliveryResponse.status).toBe(200);
    await expect(deliveryResponse.json()).resolves.toMatchObject({ ok: true, deduped: false });
    expect(
      env.agentEvents.find((event) => event.provider_event_id === "stream-message-1:reply"),
    ).toMatchObject({ status: "sent", provider_message_id: "stream-reply-1" });

    const repeatedDelivery = await app.fetch(deliveryRequest(), env);
    expect(repeatedDelivery.status).toBe(200);
    await expect(repeatedDelivery.json()).resolves.toMatchObject({ ok: true, deduped: true });

    runtimeFetch.mockResolvedValueOnce(
      Response.json({ ok: false, error: "Temporary agent runtime failure" }, { status: 503 }),
    );
    const retryBody = {
      sourceEventId: "stream-message-2",
      conversationId: "assistant-channel",
      streamChannelType: "messaging",
      streamChannelId: "assistant-channel",
      messageText: "Try this tool after a transient failure",
    };
    const failedTurn = await app.fetch(
      new Request("http://localhost/api/agent/channels/soulink/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer setup-token",
        },
        body: JSON.stringify(retryBody),
      }),
      env,
    );
    expect(failedTurn.status).toBe(503);
    const retriedTurn = await app.fetch(
      new Request("http://localhost/api/agent/channels/soulink/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer setup-token",
        },
        body: JSON.stringify(retryBody),
      }),
      env,
    );
    expect(retriedTurn.status).toBe(200);
    await expect(retriedTurn.json()).resolves.toMatchObject({
      ok: true,
      replyText: "Hello from Soulink Core.",
    });
    expect(runtimeFetch).toHaveBeenCalledTimes(3);
    const failedRuntimeBody = JSON.parse(String(runtimeFetch.mock.calls[1]?.[1]?.body));
    const retriedRuntimeBody = JSON.parse(String(runtimeFetch.mock.calls[2]?.[1]?.body));
    expect(retriedRuntimeBody.sourceEventId).toBe(failedRuntimeBody.sourceEventId);
  });

  it("downloads and transcribes Soulink voice turns once across runtime retries", async () => {
    const env = createEnv();
    await bootstrap(env);
    env.soulinkConnection = {
      id: "soulink-voice-connection",
      user_id: "owner",
      channel: "soulink",
      status: "active",
      setup_token: "voice-setup-token",
      provider_connection_id: "messaging",
      provider_user_id: "node-owner",
      provider_thread_id: "assistant-voice-channel",
      provider_username: "assistant-owner",
      provider_metadata_json: JSON.stringify({
        ownerNodeId: "node-owner",
        assistantNodeId: "assistant-owner",
      }),
      telegram_user_id: null,
      telegram_chat_id: null,
      telegram_username: null,
      telegram_first_name: null,
      telegram_last_name: null,
      connected_at: "2026-08-19T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-08-19T10:00:00Z",
      updated_at: "2026-08-19T10:00:00Z",
    };

    const aiRun = vi.fn(async () => ({
      text: "List my overdue tasks",
      word_count: 4,
      language: "en",
    }));
    env.AI = { run: aiRun } as unknown as Ai;
    const assetFetch = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: {
          "Content-Type": "audio/mp4",
          "Content-Length": "4",
        },
      }),
    );
    vi.stubGlobal("fetch", assetFetch);

    const successfulRuntimeResponse = {
      ok: true,
      auditId: "voice-audit-1",
      turnId: "voice-turn-1",
      specialist: "core.agent-chat",
      replyText: "You have two overdue tasks.",
      model: "test-model",
      source: "provider",
      fallbackReason: null,
      debugError: null,
      emailAction: null,
      reminderAction: null,
      contentAction: null,
      contactsChanged: false,
    };
    const runtimeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: false, error: "Temporary agent runtime failure" }, { status: 503 }),
      )
      .mockResolvedValue(Response.json(successfulRuntimeResponse));
    env.ME3_USER_AGENT = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: runtimeFetch })),
    } as unknown as DurableObjectNamespace;

    const requestBody = {
      sourceEventId: "stream-voice-message-1",
      conversationId: "assistant-voice-channel",
      streamChannelType: "messaging",
      streamChannelId: "assistant-voice-channel",
      messageText: "",
      input: {
        version: 1,
        kind: "voice",
        text: null,
        attachments: [
          {
            type: "voiceRecording",
            provider: "stream",
            assetUrl: "https://dublin.stream-io-cdn.com/audio/voice-note.m4a",
            mimeType: "audio/mp4",
            title: "voice-note.m4a",
            durationSeconds: 3.2,
            fileSizeBytes: 4,
          },
        ],
      },
    };
    const dispatchRequest = () =>
      new Request("http://localhost/api/agent/channels/soulink/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer voice-setup-token",
        },
        body: JSON.stringify(requestBody),
      });

    try {
      const failedTurn = await app.fetch(dispatchRequest(), env);
      expect(failedTurn.status).toBe(503);

      const retriedTurn = await app.fetch(dispatchRequest(), env);
      expect(retriedTurn.status).toBe(200);
      await expect(retriedTurn.json()).resolves.toMatchObject({
        ok: true,
        replyText: "You have two overdue tasks.",
      });

      const replayedTurn = await app.fetch(dispatchRequest(), env);
      expect(replayedTurn.status).toBe(200);
      await expect(replayedTurn.json()).resolves.toMatchObject({
        ok: true,
        deduped: true,
        replyText: "You have two overdue tasks.",
      });

      expect(assetFetch).toHaveBeenCalledOnce();
      expect(aiRun).toHaveBeenCalledOnce();
      expect(runtimeFetch).toHaveBeenCalledTimes(2);
      for (const call of runtimeFetch.mock.calls) {
        const runtimeRequest = call[1] as RequestInit;
        expect(JSON.parse(String(runtimeRequest.body))).toMatchObject({
          messageText: "List my overdue tasks",
          threadId: "soulink:assistant-voice-channel",
          attachmentTextContext: expect.stringContaining(
            "successfully processed and transcribed",
          ),
        });
      }
      const inboundEvent = env.agentEvents.find(
        (event) => event.provider_event_id === "stream-voice-message-1",
      );
      expect(inboundEvent).toMatchObject({
        text_body: "List my overdue tasks",
        status: "received",
      });
      expect(JSON.parse(inboundEvent?.raw_json || "{}")).toMatchObject({
        me3Resolution: {
          version: 1,
          kind: "voice",
          messageText: "List my overdue tasks",
          transcription: {
            providerId: "cloudflare-whisper",
            audioBytes: 4,
          },
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exposes privacy-safe Soulink Links to connected Core installs", async () => {
    const env = createEnv();
    await bootstrap(env);
    env.soulinkConnection = {
      id: "soulink-links-connection",
      user_id: "owner",
      channel: "soulink",
      status: "active",
      setup_token: "dispatch-token",
      provider_connection_id: "messaging",
      provider_user_id: "node-owner",
      provider_thread_id: "assistant-channel",
      provider_username: "assistant-owner",
      provider_metadata_json: JSON.stringify({
        ownerNodeId: "node-owner",
        assistantNodeId: "assistant-owner",
      }),
      telegram_user_id: null,
      telegram_chat_id: null,
      telegram_username: null,
      telegram_first_name: null,
      telegram_last_name: null,
      connected_at: "2026-05-11T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-05-11T10:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    };
    env.contacts.push({
      id: "soulink-contact-1",
      user_id: "owner",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+353 1 555 0000",
      source: "soulink",
      source_ref: "link-ada",
      relationship: "contact",
      status: "active",
      notes: "private note should not leak",
      tags: "private,tags",
      last_interaction_at: "2026-06-04T12:00:00Z",
      next_followup_at: "2026-06-10T12:00:00Z",
      outreach_status: null,
      social_handles: JSON.stringify({
        soulink: "ada",
        me3: "https://ada.example/me.json",
      }),
      metadata: JSON.stringify({
        avatarUrl: "https://cdn.test/ada.png",
        me3Url: "https://ada.example",
        soulinkLinkId: "link-ada",
        soulinkNodeId: "node-ada",
        soulinkChatUrl: "https://soulink.test/?chat=messaging%3Achat-ada",
        soulinkSourceChatId: "chat-ada",
        soulinkContextLabel: "Friends",
        soulinkSourceChatTitle: "Ada chat",
        soulinkSourceChatKind: "direct",
        soulinkStatus: "active",
        soulinkLastActiveAt: "2026-06-05T09:00:00Z",
      }),
      created_at: "2026-06-01T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });
    env.contacts.push({
      id: "manual-contact",
      user_id: "owner",
      name: "Manual Contact",
      email: "manual@example.com",
      phone: null,
      source: "manual",
      source_ref: null,
      relationship: "contact",
      status: "active",
      notes: "not linked",
      tags: null,
      last_interaction_at: null,
      next_followup_at: null,
      outreach_status: null,
      social_handles: null,
      metadata: null,
      created_at: "2026-06-01T12:00:00Z",
      updated_at: "2026-06-05T12:00:00Z",
    });

    const response = await app.fetch(
      new Request("http://localhost/api/me3/links?ownerNodeId=node-owner", {
        headers: { Authorization: "Bearer dispatch-token" },
      }),
      env,
    );
    const body = (await response.json()) as {
      ok: boolean;
      ownerNodeId: string;
      links: Array<{
        id: string;
        fromNodeId: string;
        toNodeId: string;
        sourceChatId: string;
        status: string;
        otherNode: {
          id: string;
          displayName: string;
          handle: string;
          me3Url: string;
          avatarUrl: string;
          email: string;
          contactEmail: string;
        };
        context: {
          sourceChatId: string;
          sourceChatTitle: string;
          sourceChatKind: string;
          streamChannelId: string;
          soulinkChatUrl: string;
          label: string;
        };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ownerNodeId: "node-owner",
      links: [
        {
          id: "link-ada",
          fromNodeId: "node-owner",
          toNodeId: "node-ada",
          sourceChatId: "chat-ada",
          status: "active",
          otherNode: {
            id: "node-ada",
            displayName: "Ada Lovelace",
            handle: "ada",
            me3Url: "https://ada.example",
            avatarUrl: "https://cdn.test/ada.png",
            email: "ada@example.com",
            contactEmail: "ada@example.com",
          },
          context: {
            sourceChatId: "chat-ada",
            sourceChatTitle: "Ada chat",
            sourceChatKind: "direct",
            streamChannelId: "chat-ada",
            soulinkChatUrl: "https://soulink.test/?chat=messaging%3Achat-ada",
            label: "Friends",
          },
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("private note should not leak");
    expect(JSON.stringify(body)).not.toContain("private,tags");
    expect(JSON.stringify(body)).not.toContain("+353");
    expect(JSON.stringify(body)).not.toContain("Manual Contact");
  });

  it("asks the owner to reconnect when Soulink contact sync rejects the Core token", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.soulinkConnection = {
      id: "soulink-links-connection",
      user_id: "owner",
      channel: "soulink",
      status: "active",
      setup_token: "stale-dispatch-token",
      provider_connection_id: "messaging",
      provider_user_id: "node-owner",
      provider_thread_id: "assistant-channel",
      provider_username: "assistant-owner",
      provider_metadata_json: JSON.stringify({ ownerNodeId: "node-owner" }),
      telegram_user_id: null,
      telegram_chat_id: null,
      telegram_username: null,
      telegram_first_name: null,
      telegram_last_name: null,
      connected_at: "2026-05-11T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-05-11T10:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    };

    const linksMock = vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", linksMock);

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/soulink/contacts/sync", {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "Connect Soulink before syncing contacts",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("syncs connected Soulink Links into Core contacts", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));
    env.soulinkConnection = {
      id: "soulink-links-connection",
      user_id: "owner",
      channel: "soulink",
      status: "active",
      setup_token: "dispatch-token",
      provider_connection_id: "messaging",
      provider_user_id: "node-owner",
      provider_thread_id: "assistant-channel",
      provider_username: "assistant-owner",
      provider_metadata_json: JSON.stringify({ ownerNodeId: "node-owner" }),
      telegram_user_id: null,
      telegram_chat_id: null,
      telegram_username: null,
      telegram_first_name: null,
      telegram_last_name: null,
      connected_at: "2026-05-11T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-05-11T10:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    };

    const linksMock = vi.fn(async () =>
      Response.json({
        ok: true,
        ownerNodeId: "node-owner",
        links: [
          {
            id: "link-ada",
            fromNodeId: "node-owner",
            toNodeId: "node-ada",
            sourceChatId: "chat-ada",
            status: "active",
            createdAt: "2026-06-01T12:00:00Z",
            updatedAt: "2026-06-05T12:00:00Z",
            otherNode: {
              id: "node-ada",
              displayName: "Ada Lovelace",
              handle: "ada",
              me3Url: null,
              kind: "person",
              avatarUrl: "https://cdn.test/ada.png",
            },
            context: {
              sourceChatId: "chat-ada",
              sourceChatTitle: "Ada chat",
              sourceChatKind: "direct",
              streamChannelId: "direct-ada",
              directMessageUrl: "https://soulink.test/?node=node-ada",
              lastActiveAt: "2026-06-05T09:00:00Z",
              label: "Shared 1:1 chat",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", linksMock);

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/soulink/contacts/sync", {
          method: "POST",
          headers: { Cookie: session },
        }),
        env,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        synced: 1,
        created: 1,
        updated: 0,
        skipped: 0,
      });
      expect(linksMock).toHaveBeenCalledOnce();
      expect(linksMock).toHaveBeenCalledWith(
        "https://soulink.test/api/me3/links?ownerNodeId=node-owner",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer dispatch-token",
          }),
        }),
      );
      expect(env.contacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            user_id: "owner",
            name: "Ada Lovelace",
            source: "soulink",
            source_ref: "node-ada",
          }),
        ]),
      );
      const syncedContact = env.contacts.find(
        (contact) => contact.source_ref === "node-ada",
      );
      expect(JSON.parse(syncedContact?.metadata || "{}")).toMatchObject({
        soulinkLinkId: "link-ada",
        soulinkNodeId: "node-ada",
        soulinkChatUrl:
          "https://soulink.test/?node=node-ada",
        soulinkSourceChatId: "chat-ada",
        soulinkStreamChannelId: "direct-ada",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects Soulink Links requests for invalid tokens and mismatched owners", async () => {
    const env = createEnv();
    await bootstrap(env);
    env.soulinkConnection = {
      id: "soulink-links-connection",
      user_id: "owner",
      channel: "soulink",
      status: "active",
      setup_token: "dispatch-token",
      provider_connection_id: "messaging",
      provider_user_id: "node-owner",
      provider_thread_id: "assistant-channel",
      provider_username: "assistant-owner",
      provider_metadata_json: JSON.stringify({ ownerNodeId: "node-owner" }),
      telegram_user_id: null,
      telegram_chat_id: null,
      telegram_username: null,
      telegram_first_name: null,
      telegram_last_name: null,
      connected_at: "2026-05-11T10:01:00Z",
      disconnected_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      created_at: "2026-05-11T10:00:00Z",
      updated_at: "2026-05-11T10:00:00Z",
    };

    const invalidResponse = await app.fetch(
      new Request("http://localhost/api/me3/links", {
        headers: { Authorization: "Bearer wrong-token" },
      }),
      env,
    );
    const mismatchResponse = await app.fetch(
      new Request("http://localhost/api/me3/links?ownerNodeId=other-owner", {
        headers: { Authorization: "Bearer dispatch-token" },
      }),
      env,
    );

    expect(invalidResponse.status).toBe(401);
    expect(await invalidResponse.json()).toMatchObject({
      ok: false,
      error: "Invalid Soulink dispatch token",
    });
    expect(mismatchResponse.status).toBe(403);
    expect(await mismatchResponse.json()).toMatchObject({
      ok: false,
      error: "Dispatch token is not valid for that owner node",
    });
  });

  it("disconnects an active Telegram account-level connection", async () => {
    const env = createEnv();
    const session = cookieHeader(await bootstrap(env));

    await app.fetch(
      new Request("http://localhost/api/telegram/setup", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    env.telegramConnection = {
      ...env.telegramConnection!,
      status: "active",
      telegram_user_id: "123",
      telegram_chat_id: "456",
      telegram_username: "owner",
      connected_at: "2026-05-11T10:01:00Z",
    };

    const response = await app.fetch(
      new Request("http://localhost/api/telegram/disconnect", {
        method: "POST",
        headers: { Cookie: session },
      }),
      env,
    );
    const body = (await response.json()) as {
      disconnected: boolean;
      connection: { status: string; telegramUsername: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.disconnected).toBe(true);
    expect(body.connection.status).toBe("disconnected");
    expect(body.connection.telegramUsername).toBeNull();
  });
});

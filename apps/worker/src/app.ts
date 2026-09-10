import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Me3UserAgent } from "./user-agent";
import {
  AiSettingsInputError,
  generateAiText,
  getAiRoutingSummary,
  getAiSettings,
  hasConfiguredAiProvider,
  type AiTextGenerationResult,
  type AiTextMessage,
  updateAiSettings,
} from "./ai-providers";
import {
  AiGatewayInputError,
  getAiGatewaySettings,
  updateAiGatewaySettings,
} from "./ai-gateway";
import {
  createAssistantJobBuilderAction,
  dispatchDueScheduledAssistantJobs,
  ensureDefaultAssistantJobs,
  markAssistantJobQueueMessageFailed,
  processAssistantJobQueueMessage,
  type AssistantJobBuilderAction,
} from "./assistant-jobs";
import {
  BOOKING_REMINDER_QUEUE_NAME,
  dispatchDueBookingReminders,
  processBookingReminderBatch,
} from "./booking-reminders";
import {
  EmailProviderInputError,
  EmailProviderDeliveryUnknownError,
  getEmailProviderSettings,
  sendEmailProviderTest,
  sendEmailWithProvider,
  updateEmailProviderSettings,
  type EmailProviderAttachment,
} from "./email-providers";
import {
  CORE_PLUGIN_CATALOG_VERSION,
  PluginInstallInputError,
  activateCorePlugin,
  deactivateCorePlugin,
  isCorePluginEnabled,
  listCorePluginRecords,
  type CorePluginRecord,
} from "./plugins";
import { getCoreVersionInfo } from "./core-version";
import {
  SocialPublishingGateError,
  SocialPublishingInputError,
  completeSocialOAuth,
  dispatchDueSocialPublications,
  getManagedXUsageWarning,
  getSocialPublishingRuntimeStatus,
  listSocialProviderSettings,
  listSocialPublishingAccounts,
  processSocialPublishBatch,
  resolveHostedSocialOAuthOrigin,
  SOCIAL_PUBLISH_QUEUE_NAME,
  startSocialOAuth,
  updateSocialProviderSettings,
} from "./social-publishing";
import {
  getOrCreateInstallEncryptionKey,
  getOrCreateInstallSessionSecret,
} from "./install-secrets";
import {
  TelegramSettingsInputError,
  getTelegramSettings,
  resolveTelegramBotToken,
  resolveTelegramBotTokenForInstall,
  resolveTelegramWebhookSecret,
  resolveTelegramWebhookSecretForInstall,
  updateTelegramSettings,
} from "./telegram-settings";
import {
  VoiceDictationInputError,
  transcribeVoiceDictation,
} from "./voice-dictation";
import { authenticateMobileOwner } from "./mobile-pairing";
import { verifyMe3CloudJwt } from "./me3-cloud-jwt";
import { registerAccountsRoutes } from "./routes/accounts";
import { registerAssistantRoutes } from "./routes/assistant";
import { registerBookingRoutes } from "./routes/booking";
import { registerEventBookingRoutes } from "./routes/event-booking";
import { registerCommerceRoutes } from "./routes/commerce";
import { registerCalendarRoutes } from "./routes/calendar";
import { registerCalendarSourceRoutes } from "./routes/calendar-sources";
import { registerCampaignRoutes } from "./routes/campaigns";
import { registerChannelRoutes } from "./routes/channels";
import { registerAgentSchedulingRoutes } from "./routes/agent-scheduling";
import { registerAssistantJobsRoutes } from "./routes/assistant-jobs";
import { registerAssistantSkillsRoutes } from "./routes/assistant-skills";
import { registerContactsRoutes } from "./routes/contacts";
import { registerCoreGithubUpdaterRoutes } from "./routes/core-github-updater";
import { registerFilesRoutes } from "./routes/files";
import { registerJournalRoutes } from "./routes/journal";
import { registerLocalExecutorRoutes } from "./routes/local-executor";
import { registerManagedRuntimeRoutes } from "./routes/managed-runtime";
import { registerManagedSetupSessionRoutes } from "./routes/managed-setup-session";
import {
  getPendingOnboardingStartStep,
  registerOnboardingRoutes,
} from "./routes/onboarding";
import {
  acknowledgeStarterProfileHandoff,
  importManagedStarterProfile,
} from "./managed-starter-profile";
import {
  getManagedAiBillingSettings,
  ManagedAiBillingInputError,
  updateManagedAiBillingSettings,
} from "./managed-ai-billing";
import { registerMobileRoutes } from "./routes/mobile";
import { registerPushNotificationRoutes } from "./routes/push-notifications";
import {
  handleInboundEmail,
  registerMailboxRoutes,
  type ForwardableEmailMessageLike,
} from "./routes/mailbox";
import { registerMissionControlRoutes } from "./routes/mission-control";
import { registerSchedulingRoutes } from "./routes/scheduling";
import { registerSocialContentRoutes } from "./routes/social-content";
import { registerSocialAccountRoutes } from "./routes/social-accounts";
import { registerSocialCarouselRoutes } from "./routes/social-carousels";
import { registerSocialMediaDeliveryRoutes } from "./routes/social-media-delivery";
import { registerPublicSiteRoutes, registerSiteRoutes } from "./routes/sites";
import { registerBusinessSiteRoutes } from "./routes/business-sites";
import { registerUsernameRoutes } from "./routes/usernames";
import {
  getMe3KnowledgeSnapshot,
  type Me3KnowledgeRuntimeContext,
} from "@me3/knowledge";
import {
  activateAgentMailbox,
  convertAgentContactToClient,
  createAgentMailboxDraft,
  createAgentSandboxTurnRecord,
  createAgentContact,
  deleteAgentContact,
  getAgentMailboxDraftForApproval,
  getAgentMailboxOutboundHeaders,
  getAgentMailboxOverview,
  listAgentMailboxMessages,
  listAgentContacts,
  markAgentMailboxDraftFailed,
  markAgentMailboxDraftSent,
  moveAgentMailboxMessage,
  normalizeMe3DeploymentMode,
  pauseAgentMailbox,
  rejectAgentMailboxDraft,
  setAgentMailboxMessageReadState,
  trashAgentMailboxMessage,
  updateAgentMailboxDraft,
  updateAgentContact,
  updateAgentContactOutreachStatus,
  upsertAgentContact,
  upsertAgentMailbox,
  type AgentMailboxMessage,
  type AgentSandboxDispatchResponse,
  type AgentMailboxDraftInput,
  type AgentMailboxUpdateInput,
} from "./agent-chat";
import {
  dispatchAgentChannelTurn,
  getAgentChannelEventByProviderEventId,
  insertProviderChannelEvent,
  insertProviderChannelEventOnce,
} from "./agent-channels";
import { searchLocationQuery } from "./location-search";
import {
  createEmptyPublishManifest,
  deleteSiteFile,
  getAdminHost,
  getApiHost,
  getContentType,
  getCoreApiOrigin,
  getCoreWebOrigin,
  getCorsOrigin,
  getGeneratedSiteContentType,
  getMe3CloudApiOrigin,
  getMe3CloudOrigin,
  getMe3CloudUsernamePublishBlockReason,
  getSiteFileText,
  getSiteHost,
  hostnameFromUrl,
  hostsMatch,
  imageExtension,
  isMissingSiteFilesTableError,
  isPublicSiteHost,
  loadPublishManifest,
  loadSiteSourceFiles,
  normalizeSiteFileName,
  originFromUrl,
  parseSiteProfile,
  pruneGeneratedPublicFiles,
  pruneUnreferencedSiteSourceFiles,
  putSiteFile,
  putSiteMediaFile,
  savePublishManifest,
  servePublicSiteRequest,
  sha256Text,
  shouldIgnoreSiteSourceFile,
  siteStorageSetupRequired,
  titleFromSlug,
  type PublishManifest,
} from "./sites";
import { generateSiteHtml, type Me3SiteProfile } from "@me3-core/site-renderer";
import type {
  AssistantJobEventQueueMessage,
  BookingReminderQueueMessage,
  DbAgentChannelConnection,
  DbAgentChannelEvent,
  DbContact,
  DbMailboxAlias,
  DbSite,
  Env,
  OwnerProfile,
  SocialPublishQueueMessage,
} from "./types";
import {
  MANAGED_RUNTIME_CONTROL_PATH,
  beginManagedRuntimeWriteLease,
  getManagedInstallationId,
  getManagedRuntimeRequestMode,
  getManagedRuntimeStatus,
  isManagedRuntime,
  releaseManagedRuntimeWriteLease,
} from "./managed-runtime-lifecycle";

export { Me3UserAgent };
export { getMe3CloudUsernamePublishBlockReason };


type BootstrapBody = Partial<OwnerProfile> & { bootstrapCode?: string; password?: string };
type LoginBody = { email?: string; password?: string };
type BootstrapPasswordResetBody = {
  email?: string;
  bootstrapCode?: string;
  password?: string;
};
type OwnerPasswordBody = {
  password?: string;
  passwordConfirmation?: string;
};
type Me3ClaimStartBody = {
  redirect?: string;
};
type Me3ClaimTokenPayload = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  email?: unknown;
  name?: unknown;
  display_name?: unknown;
  handle?: unknown;
  managed_email_address?: unknown;
  starter_profile_handoff?: unknown;
  install_id?: unknown;
  core_update_token?: unknown;
  core_origin?: unknown;
  callback_url?: unknown;
  state?: unknown;
  redirect_path?: unknown;
  claim_id?: unknown;
  iat?: unknown;
  exp?: unknown;
};
type Me3ClaimStateRecord = {
  state: string;
  redirect_path: string | null;
  install_id: string | null;
  expires_at: string;
};
type OwnerAuthState = {
  configured: boolean;
  passwordConfigured: boolean;
  me3Configured: boolean;
};
type Me3AppConnectionDetails = {
  connected: boolean;
  origin: string;
  disconnectAvailable: boolean;
  installId: string | null;
  coreOrigin: string;
  coreApiOrigin: string;
  meJsonUrl: string;
  meJsonSource: "core_install" | "hosted_profile";
};
type AccountUpdateBody = { timezone?: unknown; locale?: unknown };
type SessionPayload = { sub: string; iat: number; exp: number };
type OwnerRecord = OwnerProfile & { password_hash: string | null };
type AuthRateLimitPolicy = {
  route: string;
  maxAttempts: number;
  windowSeconds: number;
  lockoutSeconds: number;
};
type AuthRateLimitScope = {
  key: string;
  route: string;
  subjectHash: string;
};
type AuthRateLimitRecord = {
  attempt_count: number | string;
  window_started_at: string;
  locked_until: string | null;
};
const SESSION_COOKIE_NAME = "me3_core_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const ME3_CLOUD_OWNER_SECRET_NAME = "ME3_CLOUD_OWNER_ID";
const ME3_CLOUD_CORE_TOKEN_SECRET_NAME = "ME3_CLOUD_CORE_TOKEN";
const ME3_CORE_INSTALL_ID_SECRET_NAME = "ME3_CORE_INSTALL_ID";
const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;
const ME3_CORE_INSTALL_ID_REGEX =
  /^core_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ASSISTANT_ATTACHMENT_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ASSISTANT_TEXT_ATTACHMENT_BYTES = 1 * 1024 * 1024;
const MAX_ASSISTANT_ATTACHMENT_UPLOAD_COUNT = 4;
const MAX_ASSISTANT_EXTRACTED_TEXT_CHARS = 48_000;
const AUTH_RATE_LIMITS = {
  claimStart: {
    route: "auth.me3_claim_start",
    maxAttempts: 20,
    windowSeconds: 10 * 60,
    lockoutSeconds: 10 * 60,
  },
  bootstrap: {
    route: "auth.bootstrap",
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    lockoutSeconds: 30 * 60,
  },
  login: {
    route: "auth.login",
    maxAttempts: 10,
    windowSeconds: 15 * 60,
    lockoutSeconds: 15 * 60,
  },
  passwordReset: {
    route: "auth.password_reset_bootstrap",
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    lockoutSeconds: 30 * 60,
  },
  ownerPassword: {
    route: "auth.owner_password",
    maxAttempts: 10,
    windowSeconds: 15 * 60,
    lockoutSeconds: 15 * 60,
  },
} satisfies Record<string, AuthRateLimitPolicy>;
const OWNER_APP_ROUTE_PREFIXES = [
  "/account",
  "/accounts",
  "/assistant",
  "/calendar",
  "/contacts",
  "/create",
  "/email",
  "/files",
  "/journal",
  "/login",
  "/mobile",
  "/mission-control",
  "/sites",
  "/social",
  "/tasks",
];
const STRICT_TRANSPORT_SECURITY_HEADER = "max-age=31536000";
const fetchWithWorkerGlobalContext: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);

const app = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

app.onError((error, c) => {
  console.error(error);

  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json(
      {
        ok: false,
        error:
          c.env.ENVIRONMENT === "production"
            ? "Internal server error"
            : error instanceof Error
              ? error.message
              : "Internal server error",
      },
      500,
    );
  }

  return c.text("Internal Server Error", 500);
});

app.use("*", async (c, next) => {
  const requestUrl = new URL(c.req.url);
  if (shouldRedirectToHttps(requestUrl)) {
    requestUrl.protocol = "https:";
    return c.redirect(requestUrl.toString(), 301);
  }

  await next();
  if (isPublicMeJsonPath(requestUrl.pathname)) {
    c.res.headers.set("Access-Control-Allow-Origin", "*");
    c.res.headers.delete("Access-Control-Allow-Credentials");
  }
});

app.use(
  "*",
  cors({
    origin: (origin, c) => getCorsOrigin(c.env, c.req.url, origin),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use("*", async (c, next) => {
  await next();
  await applyResponseSecurityHeaders(c);
});

app.use("*", async (c, next) => {
  if (!isManagedRuntime(c.env)) return next();
  const pathname = new URL(c.req.url).pathname;
  if (pathname === MANAGED_RUNTIME_CONTROL_PATH || pathname === "/health") return next();

  if (!getManagedInstallationId(c.env)) {
    if (c.env.ENVIRONMENT !== "production") return next();
    return c.json(
      {
        ok: false,
        code: "managed_runtime_identity_invalid",
        error: "Managed runtime configuration is unavailable",
      },
      503,
    );
  }

  if (isManagedOwnerAppStaticAssetRequest(c, pathname)) return next();

  const runtimeMode = await getManagedRuntimeRequestMode(c.env);
  if (!runtimeMode) return next();
  if (runtimeMode === "suspended") {
    return c.json(
      {
        ok: false,
        code: "managed_runtime_suspended",
        error: "This managed ME3 installation is suspended",
      },
      423,
    );
  }

  const method = c.req.method.toUpperCase();
  if (
    runtimeMode === "quiesced" &&
    pathname.startsWith("/api/") &&
    (method === "GET" || method === "HEAD")
  ) {
    return c.json(
      {
        ok: false,
        code: "managed_runtime_quiesced",
        error: "This managed ME3 installation is temporarily read-only for export",
      },
      423,
    );
  }
  const shouldLease =
    method !== "OPTIONS" && method !== "GET" && method !== "HEAD";
  if (!shouldLease) return next();
  const lease = await beginManagedRuntimeWriteLease(
    c.env,
    c.req.method,
    pathname === "/api/auth/me3/callback" ? "auth_callback" : "api",
  );
  if (!lease) {
    return c.json(
      {
        ok: false,
        code: "managed_runtime_quiesced",
        error: "This managed ME3 installation is temporarily read-only for export",
      },
      423,
    );
  }
  let releaseWithResponseBody = false;
  let released = false;
  const releaseLeaseOnce = async () => {
    if (released) return;
    released = true;
    await releaseManagedRuntimeWriteLease(c.env, lease);
  };
  try {
    await next();
    if (c.res.body) {
      releaseWithResponseBody = true;
      c.res = responseWithManagedLease(c.res, releaseLeaseOnce);
    }
  } finally {
    if (!releaseWithResponseBody) await releaseLeaseOnce();
  }
});

app.use("*", async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (
    !isPublicDiscoveryPath(pathname) &&
    pathname.startsWith("/api/auth/") &&
    await isPublicSiteHost(c.env, c.req.url)
  ) {
    return c.json({ error: "Not found" }, 404);
  }
  if (
    !isPublicDiscoveryPath(pathname) &&
    !pathname.startsWith("/api/") &&
    await isPublicSiteHost(c.env, c.req.url)
  ) {
    return servePublicSiteRequest(c.env, c.req.raw);
  }
  await next();
});

app.get("/health", async (c) => {
  return c.json({
    ok: true,
    service: "me3-core",
    core: getCoreVersionInfo(),
    environment: getEnvironment(c.env),
    bindings: {
      db: Boolean(c.env.DB),
      userAgent: Boolean(c.env.ME3_USER_AGENT),
      workersAi: Boolean(c.env.AI),
      siteAssets: Boolean(c.env.SITE_ASSETS),
    },
    hosts: {
      admin: getAdminHost(c.env, c.req.url),
      api: getApiHost(c.env, c.req.url),
      site: getSiteHost(c.env) || null,
    },
    setupRequired: await getSetupRequired(c.env),
  });
});

registerManagedRuntimeRoutes(app);
registerManagedSetupSessionRoutes(app, { setOwnerSession });

app.get("/api/config", async (c) => {
  const deploymentMode = normalizeMe3DeploymentMode(c.env.ME3_DEPLOYMENT_MODE);
  if (!deploymentMode) {
    return c.json(
      {
        ok: false,
        code: "INVALID_DEPLOYMENT_MODE",
        error: "ME3 deployment mode must be managed or self_hosted",
      },
      503,
    );
  }

  const authState = await getOwnerAuthState(c.env);
  const aiRoutes = await getAiRoutingSummary(c.env, "owner");
  const cloudOrigin = getMe3CloudOrigin(c.env);
  const managedEmailAddress = await getProvisionedManagedEmailAddress(c.env);

  return c.json({
    core: getCoreVersionInfo(),
    deploymentMode,
    transferReadiness: getTransferReadiness(authState),
    apiOrigin: getCoreApiOrigin(c.env, c.req.url),
    webOrigin: getCoreWebOrigin(c.env, c.req.url),
    adminHost: getAdminHost(c.env, c.req.url) || null,
    siteHost: getSiteHost(c.env) || null,
    managedEmailAddress,
    ai: {
      defaultProvider: aiRoutes.default.providerId,
      defaultModel: aiRoutes.default.model,
      chatProvider: aiRoutes.chat.providerId,
      chatModel: aiRoutes.chat.model,
      reasoningProvider: aiRoutes.reasoning.providerId,
      reasoningModel: aiRoutes.reasoning.model,
      extractionProvider: aiRoutes.extraction.providerId,
      extractionModel: aiRoutes.extraction.model,
    },
    me3Cloud: {
      origin: cloudOrigin,
      claimUrl: `${cloudOrigin}/core/claim`,
    },
    setupRequired: await getSetupRequired(c.env),
    ownerAuthConfigured: authState.configured,
    ownerPasswordAuthConfigured: authState.passwordConfigured,
    ownerMe3AuthConfigured: authState.me3Configured,
  });
});

app.get("/api/core/version", (c) => {
  return c.json(getCoreVersionInfo());
});

registerBookingRoutes(app);
registerEventBookingRoutes(app);
registerCommerceRoutes(app, { requireOwner, unauthorized, getCoreWebOrigin });
registerUsernameRoutes(app);

app.post("/api/auth/me3/start", async (c) => {
  const authState = await getOwnerAuthState(c.env);
  if (authState.passwordConfigured && !authState.me3Configured) {
    return c.json({ ok: false, error: "Connect a ME3 account from Account settings first" }, 409);
  }

  const body = await c.req.json<Me3ClaimStartBody>().catch((): Me3ClaimStartBody => ({}));
  return createMe3ClaimStartResponse(c, body.redirect);
});

app.get("/api/auth/me3/callback", async (c) => {
  const state = c.req.query("state")?.trim() || "";
  const claimToken = c.req.query("claim_token")?.trim() || "";

  if (!state || !claimToken) {
    return redirectMe3ClaimError(c, "missing_claim");
  }

  const pending = await getMe3ClaimState(c.env, state);
  if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) {
    return redirectMe3ClaimError(c, "claim_expired");
  }

  let payload: Me3ClaimTokenPayload;
  try {
    payload = await verifyMe3ClaimToken(c.env, claimToken);
  } catch (error) {
    console.error("ME3 Cloud claim verification failed:", error);
    return redirectMe3ClaimError(c, "invalid_claim", pending.redirect_path);
  }

  const webOrigin = getCoreWebOrigin(c.env, c.req.url);
  const apiOrigin = getCoreApiOrigin(c.env, c.req.url);
  const callbackUrl = `${apiOrigin}/api/auth/me3/callback`;
  const claimedHandle = normalizeUsername(payload.handle);
  const claimedInstallId = normalizeMe3CoreInstallId(payload.install_id);
  const managedEmailAddress =
    payload.managed_email_address === undefined || payload.managed_email_address === null
      ? null
      : normalizeManagedEmailAddress(payload.managed_email_address);

  if (
    payload.state !== state ||
    payload.aud !== "me3-core-install-claim" ||
    !pending.install_id ||
    claimedInstallId !== pending.install_id ||
    payload.core_origin !== webOrigin ||
    payload.callback_url !== callbackUrl ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    !payload.email.trim() ||
    !claimedHandle ||
    !USERNAME_REGEX.test(claimedHandle) ||
    (payload.managed_email_address != null && !managedEmailAddress) ||
    (managedEmailAddress &&
      normalizeMe3DeploymentMode(c.env.ME3_DEPLOYMENT_MODE) !== "managed")
  ) {
    return redirectMe3ClaimError(c, "claim_mismatch", pending.redirect_path);
  }

  const storedMe3OwnerId = await getStoredMe3CloudOwnerId(c.env);
  if (storedMe3OwnerId && payload.sub !== storedMe3OwnerId) {
    await deleteMe3ClaimState(c.env, state);
    return redirectMe3ClaimError(c, "claim_owner_mismatch", pending.redirect_path);
  }

  await upsertMe3ClaimedOwner(c.env, payload, claimedHandle);
  if (payload.starter_profile_handoff === true) {
    try {
      const adoption = await importManagedStarterProfile(c.env, {
        claimToken,
        handle: claimedHandle,
      });
      await acknowledgeStarterProfileHandoff(c.env, claimToken, {
        outcome:
          adoption.reason === "existing_profile"
            ? "existing_profile"
            : "starter_imported",
        visibility: adoption.visibility,
      });
    } catch (error) {
      console.warn(
        "Starter profile adoption failed; continuing with local profile setup:",
        error,
      );
      try {
        await acknowledgeStarterProfileHandoff(c.env, claimToken, {
          outcome: "failed",
          errorCode: "profile_import_failed",
        });
      } catch (acknowledgementError) {
        console.warn(
          "Starter profile failure acknowledgement did not reach ME3 Cloud:",
          acknowledgementError,
        );
      }
    }
  }
  if (managedEmailAddress) {
    await bootstrapManagedEmailMailbox(c.env, managedEmailAddress, payload.email);
  }
  await getOrCreateInstallEncryptionKey(c.env);
  await deleteMe3ClaimState(c.env, state);
  await setOwnerSession(c, "owner");

  return c.redirect(
    normalizeClaimRedirect(c.req.query("redirect")) || pending.redirect_path || "/account",
  );
});

app.post("/api/admin/bootstrap", async (c) => {
  const body = await c.req.json<BootstrapBody>().catch((): BootstrapBody => ({}));
  const setupPassword = getSetupPassword(c.env);
  const rateLimitScope = await createAuthRateLimitScope(c, AUTH_RATE_LIMITS.bootstrap);
  const rateLimitBlock = await checkAuthRateLimit(c, rateLimitScope);
  if (rateLimitBlock) return rateLimitBlock;

  if (!setupPassword) {
    return c.json({ ok: false, error: "Owner auth is not configured" }, 503);
  }

  if (body.bootstrapCode !== setupPassword) {
    await recordAuthRateLimitAttempt(c.env, AUTH_RATE_LIMITS.bootstrap, rateLimitScope);
    return c.json({ ok: false, error: "Invalid setup password" }, 401);
  }

  const password = body.password?.trim();
  if (!password || password.length < 8) {
    return c.json({ ok: false, error: "Password must be at least 8 characters" }, 400);
  }

  const email = body.email?.trim() || null;
  if (!email) {
    return c.json({ ok: false, error: "Email is required" }, 400);
  }

  const passwordHash = await hashPassword(password);
  const owner: OwnerProfile = {
    id: "owner",
    email,
    name: body.name ?? "ME3 Owner",
    username: body.username ?? "owner",
    bio: body.bio ?? "Personal AI assistant powered by ME3.",
    avatar_url: body.avatar_url ?? null,
    timezone:
      body.timezone !== undefined ? normalizeTimeZone(body.timezone) : null,
  };

  await c.env.DB.prepare(
    `INSERT INTO owner_profile (id, email, name, username, bio, avatar_url, timezone, password_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       username = excluded.username,
       bio = excluded.bio,
       avatar_url = excluded.avatar_url,
       timezone = excluded.timezone,
       password_hash = excluded.password_hash,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(owner.id, owner.email, owner.name, owner.username, owner.bio, owner.avatar_url, owner.timezone, passwordHash)
    .run();

  await getOrCreateInstallEncryptionKey(c.env);
  await ensureDefaultAssistantJobs(c.env, owner.id);
  await clearAuthRateLimit(c.env, rateLimitScope);
  await setOwnerSession(c, owner.id);

  return c.json({ ok: true, owner });
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<LoginBody>().catch((): LoginBody => ({}));
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();
  const rateLimitScope = await createAuthRateLimitScope(
    c,
    AUTH_RATE_LIMITS.login,
    email || "unknown-email",
  );
  const rateLimitBlock = await checkAuthRateLimit(c, rateLimitScope);
  if (rateLimitBlock) return rateLimitBlock;

  if (!email || !password) {
    return c.json({ ok: false, error: "Email and password are required" }, 400);
  }

  const owner = await getOwnerByEmail(c.env, email);
  if (!owner?.password_hash || !(await verifyPassword(password, owner.password_hash))) {
    await recordAuthRateLimitAttempt(c.env, AUTH_RATE_LIMITS.login, rateLimitScope);
    return c.json({ ok: false, error: "Invalid email or password" }, 401);
  }

  await clearAuthRateLimit(c.env, rateLimitScope);
  await setOwnerSession(c, owner.id);

  return c.json({ ok: true, owner: toPublicOwner(owner) });
});

app.post("/api/auth/password-reset/bootstrap", async (c) => {
  const body = await c.req
    .json<BootstrapPasswordResetBody>()
    .catch((): BootstrapPasswordResetBody => ({}));
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();
  const setupPassword = getSetupPassword(c.env);
  const rateLimitScope = await createAuthRateLimitScope(c, AUTH_RATE_LIMITS.passwordReset);
  const rateLimitBlock = await checkAuthRateLimit(c, rateLimitScope);
  if (rateLimitBlock) return rateLimitBlock;

  if (!setupPassword) {
    return c.json({ ok: false, error: "Owner recovery is not configured" }, 503);
  }

  if (body.bootstrapCode !== setupPassword) {
    await recordAuthRateLimitAttempt(c.env, AUTH_RATE_LIMITS.passwordReset, rateLimitScope);
    return c.json({ ok: false, error: "Invalid setup password" }, 401);
  }

  if (!email) {
    return c.json({ ok: false, error: "Email is required" }, 400);
  }

  if (!password || password.length < 8) {
    return c.json({ ok: false, error: "Password must be at least 8 characters" }, 400);
  }

  const owner = await getOwnerByEmail(c.env, email);
  if (!owner) {
    await recordAuthRateLimitAttempt(c.env, AUTH_RATE_LIMITS.passwordReset, rateLimitScope);
    return c.json({ ok: false, error: "Owner account not found" }, 404);
  }

  await c.env.DB.prepare(
    "UPDATE owner_profile SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(await hashPassword(password), owner.id)
    .run();

  await clearAuthRateLimit(c.env, rateLimitScope);
  clearOwnerSession(c);

  return c.json({ ok: true, owner: toPublicOwner(owner) });
});

app.get("/api/auth/me", async (c) => {
  const ownerId = await getSessionOwnerId(c);
  if (!ownerId) {
    return c.json({ ok: false, user: null }, 401);
  }

  const [owner, hasProfileSite, onboardingStartStep] = await Promise.all([
    getOwnerProfile(c.env, ownerId),
    hasOwnerProfileSite(c.env, ownerId),
    getPendingOnboardingStartStep(c.env, ownerId),
  ]);
  if (!owner) {
    clearOwnerSession(c);
    return c.json({ ok: false, user: null }, 401);
  }

  return c.json({
    ok: true,
    user: toPublicOwner(owner),
    workspace: { hasProfileSite, onboardingStartStep },
  });
});

app.post("/api/auth/logout", (c) => {
  clearOwnerSession(c);
  return c.json({ ok: true });
});

registerAssistantRoutes(app, { requireOwner, unauthorized, getSessionOwnerId, getSetupRequired });
registerOnboardingRoutes(app, { requireOwner, unauthorized });

app.get("/api/account", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const owner = await getOwnerProfile(c.env, ownerId);
  if (!owner) return c.json({ error: "Account not found" }, 404);

  return c.json({ user: serializeAccountOwner(owner) });
});

app.put("/api/account/password", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);
  const rateLimitScope = await createAuthRateLimitScope(
    c,
    AUTH_RATE_LIMITS.ownerPassword,
    ownerId,
  );
  const rateLimitBlock = await checkAuthRateLimit(c, rateLimitScope);
  if (rateLimitBlock) return rateLimitBlock;
  await recordAuthRateLimitAttempt(c.env, AUTH_RATE_LIMITS.ownerPassword, rateLimitScope);

  const body = await c.req.json<OwnerPasswordBody>().catch((): OwnerPasswordBody => ({}));
  const password = body.password?.trim();
  const passwordConfirmation = body.passwordConfirmation?.trim();
  if (!password || password.length < 8) {
    return c.json({ ok: false, error: "Password must be at least 8 characters" }, 400);
  }
  if (password !== passwordConfirmation) {
    return c.json({ ok: false, error: "Password confirmation does not match" }, 400);
  }

  const owner = await getOwnerProfile(c.env, ownerId);
  if (!owner?.email) {
    return c.json({ ok: false, error: "Owner email is required for local login" }, 409);
  }

  const passwordHash = await hashPassword(password);
  if (!(await verifyPassword(password, passwordHash))) {
    return c.json({ ok: false, error: "Local password could not be verified" }, 500);
  }

  await c.env.DB.prepare(
    "UPDATE owner_profile SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(passwordHash, ownerId)
    .run();

  return c.json({
    ok: true,
    localPasswordConfigured: true,
    transferReadiness: getTransferReadiness(await getOwnerAuthState(c.env)),
  });
});

app.get("/api/account/app-connections", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);
  const authState = await getOwnerAuthState(c.env);

  return c.json({
    me3: await getMe3AppConnectionDetails(c),
    localAccess: {
      passwordConfigured: authState.passwordConfigured,
      transferReadiness: getTransferReadiness(authState),
    },
  });
});

app.post("/api/account/app-connections/me3/start", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const body = await c.req.json<Me3ClaimStartBody>().catch((): Me3ClaimStartBody => ({}));
  return createMe3ClaimStartResponse(c, body.redirect || "/account?section=connections");
});

app.delete("/api/account/app-connections/me3", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const authState = await getOwnerAuthState(c.env);
  if (!authState.passwordConfigured) {
    return c.json(
      { ok: false, error: "Add password authentication before disconnecting ME3.app" },
      409,
    );
  }

  await deleteStoredMe3CloudOwnerId(c.env);
  return c.json({ ok: true });
});

app.get("/api/plugins", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  return c.json({
    catalogVersion: CORE_PLUGIN_CATALOG_VERSION,
    plugins: await listCorePluginRecords(c.env),
  });
});

app.get("/api/knowledge", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const [plugins, aiConfigured] = await Promise.all([
    listCorePluginRecords(c.env),
    hasConfiguredAiProvider(c.env, ownerId),
  ]);
  const snapshot = getMe3KnowledgeSnapshot(
    buildKnowledgeRuntimeContext(plugins, aiConfigured),
    plugins,
  );

  return c.json({
    ...snapshot,
    catalogVersion: CORE_PLUGIN_CATALOG_VERSION,
  });
});

app.post("/api/plugins/:pluginId/activate", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  try {
    return c.json({
      plugin: await activateCorePlugin(c.env, c.req.param("pluginId")),
    });
  } catch (error) {
    if (error instanceof PluginInstallInputError) {
      return c.json({ error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.post("/api/plugins/:pluginId/deactivate", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  try {
    return c.json({
      plugin: await deactivateCorePlugin(c.env, c.req.param("pluginId")),
    });
  } catch (error) {
    if (error instanceof PluginInstallInputError) {
      return c.json({ error: error.message }, error.status as any);
    }
    throw error;
  }
});

registerAccountsRoutes(app, { requireOwner, unauthorized });
registerFilesRoutes(app, { requireOwner, unauthorized });
registerJournalRoutes(app, { requireOwner, unauthorized });
registerMissionControlRoutes(app, { requireOwner, unauthorized });
registerLocalExecutorRoutes(app, { requireOwner, unauthorized, getCoreApiOrigin });
registerMobileRoutes(app, { requireOwner, unauthorized, getCoreApiOrigin, getCoreWebOrigin });
registerPushNotificationRoutes(app, { requireOwner, unauthorized });
registerSocialContentRoutes(app, { requireOwner, unauthorized });
registerSocialAccountRoutes(app, { requireOwner, unauthorized });
registerSocialCarouselRoutes(app, { requireOwner, unauthorized });
registerSocialMediaDeliveryRoutes(app);
app.get("/api/social/status", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);
  const [hostedOAuthOrigin, managedXUsage] = await Promise.all([
    resolveHostedSocialOAuthOrigin(c.env),
    getManagedXUsageWarning(c.env),
  ]);
  const managedDeployment =
    c.env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed";

  return c.json({
    plugin: await getSocialPublishingRuntimeStatus(c.env),
    hostedOAuth: {
      configured: Boolean(hostedOAuthOrigin),
      platforms: hostedOAuthOrigin
        ? [
            ...(managedDeployment ? ["x"] : []),
            "linkedin",
            "instagram",
            "youtube",
            "tiktok",
          ]
        : [],
    },
    managedXUsage,
    localDemo: c.env.ENVIRONMENT === "local",
  });
});

app.get("/api/social/accounts", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  try {
    return c.json({
      plugin: await getSocialPublishingRuntimeStatus(c.env),
      accounts: await listSocialPublishingAccounts(c.env, ownerId),
    });
  } catch (error) {
    if (error instanceof SocialPublishingGateError) {
      return c.json(
        {
          ok: false,
          error: error.message,
          plugin: error.gate,
        },
        error.status as any,
      );
    }
    throw error;
  }
});

app.get("/api/social/provider-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  try {
    return c.json({
      providers: await listSocialProviderSettings(c.env, ownerId),
    });
  } catch (error) {
    if (error instanceof SocialPublishingGateError) {
      return c.json({ ok: false, error: error.message, plugin: error.gate }, error.status as any);
    }
    throw error;
  }
});

app.put("/api/social/provider-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  try {
    return c.json({
      providers: await updateSocialProviderSettings(
        c.env,
        ownerId,
        body as any,
        await getOrCreateInstallEncryptionKey(c.env),
      ),
    });
  } catch (error) {
    if (error instanceof SocialPublishingGateError) {
      return c.json({ ok: false, error: error.message, plugin: error.gate }, error.status as any);
    }
    if (error instanceof SocialPublishingInputError) {
      return c.json({ ok: false, error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.post("/api/social/:platform/authorize", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  try {
    const hostedOAuthOrigin = await resolveHostedSocialOAuthOrigin(c.env);
    return c.json(
      await startSocialOAuth(
        c.env,
        ownerId,
        { ...(body && typeof body === "object" ? body : {}), platform: c.req.param("platform") },
        {
          apiOrigin: getCoreApiOrigin(c.env, c.req.url),
          hostedOAuthOrigin,
        },
      ),
    );
  } catch (error) {
    if (error instanceof SocialPublishingGateError) {
      return c.json({ ok: false, error: error.message, plugin: error.gate }, error.status as any);
    }
    if (error instanceof SocialPublishingInputError) {
      return c.json({ ok: false, error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.get("/api/social/:platform/callback", async (c) => {
  try {
    const hostedOAuthOrigin = await resolveHostedSocialOAuthOrigin(c.env);
    const redirect = await completeSocialOAuth(
      c.env,
      c.req.param("platform"),
      {
        code: c.req.query("code"),
        state: c.req.query("state"),
        error: c.req.query("error"),
        handoff: c.req.query("handoff"),
      },
      {
        apiOrigin: getCoreApiOrigin(c.env, c.req.url),
        webOrigin: getCoreWebOrigin(c.env, c.req.url),
        fetch: fetchWithWorkerGlobalContext,
        installKey: await getOrCreateInstallEncryptionKey(c.env),
        hostedOAuthOrigin,
      },
    );
    return c.redirect(redirect);
  } catch (error) {
    if (error instanceof SocialPublishingInputError) {
      const url = new URL("/social", getCoreWebOrigin(c.env, c.req.url));
      url.searchParams.set("social_error", error.message);
      return c.redirect(url.toString());
    }
    throw error;
  }
});

app.get("/api/ai-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  return c.json(await getAiSettings(c.env, ownerId));
});

app.put("/api/ai-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  try {
    return c.json(await updateAiSettings(c.env, ownerId, body));
  } catch (error) {
    if (error instanceof AiSettingsInputError) {
      return c.json({ error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.get("/api/managed-ai-billing-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);
  return c.json(await getManagedAiBillingSettings(c.env));
});

app.put("/api/managed-ai-billing-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);
  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  const input = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  if (
    typeof input.defaultModel !== "string" ||
    !input.defaultModel.trim() ||
    typeof input.overagesEnabled !== "boolean" ||
    typeof input.monthlyMaximumCents !== "number" ||
    !Number.isInteger(input.monthlyMaximumCents)
  ) {
    return c.json({ error: "Invalid managed AI billing settings" }, 400);
  }
  try {
    return c.json(
      await updateManagedAiBillingSettings(c.env, {
        defaultModel: input.defaultModel.trim(),
        overagesEnabled: input.overagesEnabled,
        monthlyMaximumCents: input.monthlyMaximumCents,
      }),
    );
  } catch (error) {
    if (error instanceof ManagedAiBillingInputError) {
      return c.json({ error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.get("/api/ai-gateway-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  return c.json(await getAiGatewaySettings(c.env, ownerId));
});

app.put("/api/ai-gateway-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  try {
    return c.json(await updateAiGatewaySettings(c.env, ownerId, body));
  } catch (error) {
    if (error instanceof AiGatewayInputError) {
      return c.json({ error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.get("/api/email-provider-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  return c.json(await getEmailProviderSettings(c.env, ownerId));
});

app.put("/api/email-provider-settings", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  try {
    return c.json(await updateEmailProviderSettings(c.env, ownerId, body));
  } catch (error) {
    if (error instanceof EmailProviderInputError) {
      return c.json({ error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.post("/api/email-provider-settings/test", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const owner = await getOwnerProfile(c.env, ownerId);
  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  try {
    return c.json(await sendEmailProviderTest(c.env, ownerId, owner?.email, body));
  } catch (error) {
    if (error instanceof EmailProviderDeliveryUnknownError) {
      return c.json({ error: error.message, code: "delivery_unknown", status: "pending" }, 502);
    }
    if (error instanceof EmailProviderInputError) {
      return c.json({ error: error.message }, error.status as any);
    }
    throw error;
  }
});

app.put("/api/account", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  const body = await c.req.json<AccountUpdateBody>().catch((): AccountUpdateBody => ({}));
  if (body.timezone === undefined && body.locale === undefined) {
    return c.json({ error: "timezone or locale is required" }, 400);
  }

  const timezone = body.timezone === undefined ? undefined : normalizeTimeZone(body.timezone);
  if (body.timezone !== undefined && !timezone) {
    return c.json({ error: "Invalid timezone" }, 400);
  }

  const locale = body.locale === undefined ? undefined : normalizeLocale(body.locale);
  if (body.locale !== undefined && body.locale !== null && body.locale !== "" && !locale) {
    return c.json({ error: "Invalid locale" }, 400);
  }

  const updates = ["updated_at = CURRENT_TIMESTAMP"];
  const values: Array<string | null> = [];
  if (timezone !== undefined) {
    updates.push("timezone = ?");
    values.push(timezone);
  }
  if (locale !== undefined) {
    updates.push("locale = ?");
    values.push(locale);
  }

  await c.env.DB.prepare(
    `UPDATE owner_profile
     SET ${updates.join(", ")}
     WHERE id = ?`,
  )
    .bind(...values, ownerId)
    .run();

  const owner = await getOwnerProfile(c.env, ownerId);
  if (!owner) return c.json({ error: "Account not found" }, 404);

  return c.json({ user: serializeAccountOwner(owner) });
});

app.post("/api/account/delete", async (c) => {
  const ownerId = await requireOwner(c);
  if (!ownerId) return unauthorized(c);

  await c.env.DB.prepare("DELETE FROM assistant_messages WHERE owner_id = ?")
    .bind(ownerId)
    .run();
  await c.env.DB.prepare("DELETE FROM owner_profile WHERE id = ?")
    .bind(ownerId)
    .run();
  clearOwnerSession(c);

  return c.json({ ok: true });
});

registerSiteRoutes(app, { requireOwner, unauthorized });

registerBusinessSiteRoutes(app, { requireOwner, unauthorized });

registerCampaignRoutes(app, { requireOwner, unauthorized });

registerMailboxRoutes(app, { requireOwner, unauthorized });

registerChannelRoutes(app, { requireOwner, unauthorized });

registerAgentSchedulingRoutes(app);

registerSchedulingRoutes(app, { requireOwner, unauthorized });

registerCalendarRoutes(app, { requireOwner, unauthorized });

registerCalendarSourceRoutes(app, { requireOwner, unauthorized });

registerContactsRoutes(app, { requireOwner, unauthorized });

registerCoreGithubUpdaterRoutes(app, { requireOwner, unauthorized });

registerPublicSiteRoutes(app);

app.notFound(async (c) => {
  if (await isPublicSiteHost(c.env, c.req.url)) {
    return servePublicSiteRequest(c.env, c.req.raw);
  }
  if (c.env.ASSETS) {
    const response = await c.env.ASSETS.fetch(c.req.raw);
    return applyOwnerAppAssetCachePolicy(
      response,
      new URL(c.req.url).pathname,
    );
  }
  return c.text("Not found", 404, { "Cache-Control": "no-store" });
});

function normalizeClaimRedirect(value: unknown): string {
  if (typeof value !== "string") return "";
  const redirect = value.trim();
  if (!redirect || redirect.length > 500) return "";
  if (redirect.startsWith("/") && !redirect.startsWith("//")) return redirect;
  return "";
}

function responseWithManagedLease(
  response: Response,
  release: () => Promise<void>,
): Response {
  const reader = response.body!.getReader();
  let released = false;
  const releaseOnce = async () => {
    if (released) return;
    released = true;
    reader.releaseLock();
    await release();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          await releaseOnce();
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        await releaseOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await releaseOnce();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

async function requireOwner(c: AppContext): Promise<string | null> {
  return (
    await getSessionOwnerId(c) ||
    await authenticateMobileOwner(c.env, c.req.header("Authorization") || null)
  );
}

function unauthorized(c: AppContext) {
  return c.json({ ok: false, error: "Authentication required" }, 401);
}

async function createAuthRateLimitScope(
  c: AppContext,
  policy: AuthRateLimitPolicy,
  discriminator = "",
): Promise<AuthRateLimitScope> {
  const clientKey = getRateLimitClientKey(c);
  const subject = discriminator ? `${clientKey}|${discriminator}` : clientKey;
  const subjectHash = await sha256Text(subject);
  return {
    key: `${policy.route}:${subjectHash}`,
    route: policy.route,
    subjectHash,
  };
}

async function checkAuthRateLimit(
  c: AppContext,
  scope: AuthRateLimitScope,
): Promise<Response | null> {
  const row = await getAuthRateLimitRecord(c.env, scope.key);
  const lockedUntilMs = row?.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (!Number.isFinite(lockedUntilMs) || lockedUntilMs <= Date.now()) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 1000));
  c.header("Retry-After", String(retryAfterSeconds));
  return c.json(
    {
      ok: false,
      error: "Too many attempts. Try again later.",
      retryAfterSeconds,
    },
    429,
  );
}

async function recordAuthRateLimitAttempt(
  env: Env,
  policy: AuthRateLimitPolicy,
  scope: AuthRateLimitScope,
): Promise<void> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const existing = await getAuthRateLimitRecord(env, scope.key);
  const windowStartedMs = existing?.window_started_at
    ? new Date(existing.window_started_at).getTime()
    : 0;
  const windowActive =
    Number.isFinite(windowStartedMs) &&
    windowStartedMs > 0 &&
    windowStartedMs + policy.windowSeconds * 1000 > nowMs;
  const attemptCount = windowActive ? Number(existing?.attempt_count || 0) + 1 : 1;
  const windowStartedAt = windowActive ? existing!.window_started_at : nowIso;
  const lockedUntil =
    attemptCount >= policy.maxAttempts
      ? new Date(nowMs + policy.lockoutSeconds * 1000).toISOString()
      : null;

  await env.DB.prepare(
    `INSERT INTO auth_rate_limits
       (key, route, subject_hash, attempt_count, window_started_at, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       attempt_count = excluded.attempt_count,
       window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until,
       updated_at = excluded.updated_at`,
  )
    .bind(
      scope.key,
      scope.route,
      scope.subjectHash,
      attemptCount,
      windowStartedAt,
      lockedUntil,
      nowIso,
      nowIso,
    )
    .run();
}

async function clearAuthRateLimit(env: Env, scope: AuthRateLimitScope): Promise<void> {
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE key = ?")
    .bind(scope.key)
    .run();
}

async function getAuthRateLimitRecord(
  env: Env,
  key: string,
): Promise<AuthRateLimitRecord | null> {
  const result = await env.DB.prepare(
    `SELECT attempt_count, window_started_at, locked_until
     FROM auth_rate_limits
     WHERE key = ?`,
  )
    .bind(key)
    .first<AuthRateLimitRecord>();

  return result ?? null;
}

function getRateLimitClientKey(c: AppContext): string {
  const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp =
    c.req.header("cf-connecting-ip")?.trim() ||
    forwardedFor ||
    c.req.header("x-real-ip")?.trim();
  if (clientIp) return `ip:${clientIp}`;

  return `host:${hostnameFromUrl(c.req.url) || "unknown"}`;
}

async function applyResponseSecurityHeaders(c: AppContext) {
  const requestUrl = new URL(c.req.url);
  const pathname = requestUrl.pathname;
  const isApiRequest = pathname.startsWith("/api/");
  const isPublicSiteResponse =
    !isApiRequest && await isPublicSiteHost(c.env, c.req.url);

  setDefaultHeader(c, "X-Content-Type-Options", "nosniff");
  setDefaultHeader(c, "Referrer-Policy", "strict-origin-when-cross-origin");
  if (requestUrl.protocol === "https:") {
    setDefaultHeader(c, "Strict-Transport-Security", STRICT_TRANSPORT_SECURITY_HEADER);
  }

  if (isApiRequest) {
    setDefaultHeader(c, "Cache-Control", "no-store");
  }

  if (!isPublicSiteResponse && isOwnerSurfaceRequest(c, pathname)) {
    setDefaultHeader(c, "X-Frame-Options", "DENY");
    setDefaultHeader(c, "Content-Security-Policy", "frame-ancestors 'none'");
  }
}

function setDefaultHeader(c: AppContext, name: string, value: string) {
  if (!c.res.headers.has(name)) c.header(name, value);
}

function shouldRedirectToHttps(requestUrl: URL): boolean {
  return requestUrl.protocol === "http:" && !isLocalDevelopmentHost(requestUrl.hostname);
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  );
}

function isPublicDiscoveryPath(pathname: string): boolean {
  return (
    pathname === "/me.json" ||
    pathname === "/.well-known/me.json" ||
    pathname === "/security.txt" ||
    pathname === "/.well-known/security.txt"
  );
}

function isPublicMeJsonPath(pathname: string): boolean {
  return pathname === "/me.json" || pathname === "/.well-known/me.json";
}

function isOwnerSurfaceRequest(c: AppContext, pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;

  if (
    OWNER_APP_ROUTE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }

  const hasExplicitOwnerHost = Boolean(
    c.env.ME3_ADMIN_HOST ||
      c.env.ME3_API_HOST ||
      c.env.CORE_WEB_ORIGIN ||
      c.env.CORE_API_ORIGIN,
  );
  if (!hasExplicitOwnerHost) return false;

  const requestHost = hostnameFromUrl(c.req.url);
  return (
    hostsMatch(requestHost, getAdminHost(c.env, c.req.url)) ||
    hostsMatch(requestHost, getApiHost(c.env, c.req.url))
  );
}

function isManagedOwnerAppStaticAssetRequest(
  c: AppContext,
  pathname: string,
): boolean {
  if (!isManagedRuntime(c.env) || !isOwnerSurfaceRequest(c, pathname)) {
    return false;
  }
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.png" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/me3-logo-light.png" ||
    pathname === "/me3-logo-dark.png"
  );
}

function applyOwnerAppAssetCachePolicy(
  response: Response,
  pathname: string,
): Response {
  if (
    response.status < 200 ||
    response.status >= 400 ||
    !/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(pathname)
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function localDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function normalizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeLongText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeEmail(value: unknown): string {
  const email = normalizeShortText(value, 254).toLowerCase();
  return EMAIL_REGEX.test(email) ? email : "";
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOwnerDisplayName(value: unknown): string | null {
  const normalized = normalizeNullableText(value)?.replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) return null;
  if (EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

function humanizeEmailLocalPart(email: string): string | null {
  const localPart = email.split("@")[0]?.split("+")[0] || "";
  const withoutTrailingDigits = localPart.replace(/\d+$/g, "");
  const source = withoutTrailingDigits || localPart;
  const words = source
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]+/g, ""))
    .filter((word) => word.length > 0);

  if (words.length === 0) return null;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timezone = value.trim();
  if (!timezone) return null;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return null;
  }
}

function normalizeLocale(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const locale = value.trim();
  if (!locale) return null;

  try {
    Intl.getCanonicalLocales(locale);
    return locale;
  } catch {
    return null;
  }
}

function serializeAccountOwner(owner: OwnerRecord) {
  const storedTimezone = normalizeTimeZone(owner.timezone);
  const effectiveTimezone = storedTimezone || "UTC";
  const explicitLocale = owner.locale?.trim() || null;

  return {
    id: owner.id,
    email: owner.email,
    name: owner.name || "ME3 Owner",
    username: owner.username || "owner",
    timezone: storedTimezone,
    locale: explicitLocale || inferLocaleFromTimeZone(effectiveTimezone),
    localeSource: explicitLocale ? "explicit" : "inferred",
  };
}

function inferLocaleFromTimeZone(timezone: string): string {
  if (timezone.startsWith("Europe/Dublin") || timezone.startsWith("Europe/London")) return "en-GB";
  if (timezone.startsWith("Europe/")) return "en-GB";
  if (timezone.startsWith("America/")) return "en-US";
  if (timezone.startsWith("Australia/")) return "en-AU";
  return "en-US";
}

async function getOwnerProfile(env: Env, ownerId: string): Promise<OwnerRecord | null> {
  const result = await env.DB.prepare(
    "SELECT id, email, name, username, bio, avatar_url, timezone, locale, assistant_name, password_hash FROM owner_profile WHERE id = ?",
  )
    .bind(ownerId)
    .first<OwnerRecord>();

  return result ?? null;
}

async function hasOwnerProfileSite(env: Env, ownerId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `SELECT id
     FROM sites
     WHERE user_id = ?
       AND COALESCE(site_type, 'profile') = 'profile' AND site_role = 'profile'
     LIMIT 1`,
  )
    .bind(ownerId)
    .all<{ id: string }>();

  return (result.results || []).length > 0;
}

async function getOwnerByEmail(env: Env, email: string): Promise<OwnerRecord | null> {
  const result = await env.DB.prepare(
    "SELECT id, email, name, username, bio, avatar_url, timezone, locale, assistant_name, password_hash FROM owner_profile WHERE lower(email) = ?",
  )
    .bind(email)
    .first<OwnerRecord>();

  return result ?? null;
}

async function createMe3ClaimStartResponse(c: AppContext, rawRedirect?: unknown): Promise<Response> {
  const rateLimitScope = await createAuthRateLimitScope(c, AUTH_RATE_LIMITS.claimStart);
  const rateLimitBlock = await checkAuthRateLimit(c, rateLimitScope);
  if (rateLimitBlock) return rateLimitBlock;
  await recordAuthRateLimitAttempt(c.env, AUTH_RATE_LIMITS.claimStart, rateLimitScope);

  const webOrigin = getCoreWebOrigin(c.env, c.req.url);
  const apiOrigin = getCoreApiOrigin(c.env, c.req.url);
  const installId = await getOrCreateMe3CoreInstallId(c.env);
  const state = crypto.randomUUID();
  const claimUrl = new URL("/core/claim", getMe3CloudOrigin(c.env));
  const redirect = normalizeClaimRedirect(rawRedirect);

  await storeMe3ClaimState(c.env, state, redirect, installId);

  claimUrl.searchParams.set("install_id", installId);
  claimUrl.searchParams.set("core_origin", webOrigin);
  claimUrl.searchParams.set("callback_url", `${apiOrigin}/api/auth/me3/callback`);
  claimUrl.searchParams.set("state", state);

  if (redirect) {
    claimUrl.searchParams.set("redirect", redirect);
  }

  return c.json({
    ok: true,
    url: claimUrl.toString(),
    state,
  });
}

async function getOwnerAuthState(env: Env): Promise<OwnerAuthState> {
  const result = await env.DB.prepare(
    "SELECT id, email, password_hash FROM owner_profile WHERE id = ?",
  )
    .bind("owner")
    .first<{ id: string; email: string | null; password_hash: string | null }>();
  const passwordConfigured = Boolean(
    result?.email?.trim() && parsePasswordHash(result.password_hash),
  );
  const me3Configured = Boolean(await getStoredMe3CloudOwnerId(env));
  const configured = passwordConfigured || me3Configured;

  return {
    configured,
    passwordConfigured,
    me3Configured,
  };
}

function getTransferReadiness(authState: OwnerAuthState) {
  return {
    ready: authState.passwordConfigured,
    blockers: authState.passwordConfigured ? [] : ["LOCAL_PASSWORD_REQUIRED"],
  };
}

async function getMe3AppConnectionDetails(c: AppContext): Promise<Me3AppConnectionDetails> {
  const authState = await getOwnerAuthState(c.env);
  const coreOrigin = getCoreWebOrigin(c.env, c.req.url);
  const storedInstallId = await getStoredMe3CoreInstallId(c.env);

  return {
    connected: authState.me3Configured,
    origin: getMe3CloudOrigin(c.env),
    disconnectAvailable: authState.passwordConfigured,
    installId:
      storedInstallId ||
      (authState.me3Configured ? await getOrCreateMe3CoreInstallId(c.env) : null),
    coreOrigin,
    coreApiOrigin: getCoreApiOrigin(c.env, c.req.url),
    meJsonUrl: `${coreOrigin}/.well-known/me.json`,
    meJsonSource: authState.me3Configured ? "core_install" : "hosted_profile",
  };
}

async function getOwnerAuthConfigured(env: Env): Promise<boolean> {
  return (await getOwnerAuthState(env)).configured;
}

function toPublicOwner(owner: OwnerRecord): OwnerProfile {
  return {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    username: owner.username,
    bio: owner.bio,
    avatar_url: owner.avatar_url,
    timezone: owner.timezone,
    assistant_name: owner.assistant_name ?? null,
  };
}

async function storeMe3ClaimState(
  env: Env,
  state: string,
  redirectPath: string,
  installId: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO me3_install_claim_states (state, redirect_path, install_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(state) DO UPDATE SET
       redirect_path = excluded.redirect_path,
       install_id = excluded.install_id,
       expires_at = excluded.expires_at`,
  )
    .bind(state, redirectPath || null, installId, expiresAt)
    .run();
}

async function getMe3ClaimState(
  env: Env,
  state: string,
): Promise<Me3ClaimStateRecord | null> {
  const result = await env.DB.prepare(
    "SELECT state, redirect_path, install_id, expires_at FROM me3_install_claim_states WHERE state = ?",
  )
    .bind(state)
    .first<Me3ClaimStateRecord>();

  return result ?? null;
}

function normalizeMe3CoreInstallId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ME3_CORE_INSTALL_ID_REGEX.test(normalized) ? normalized : null;
}

function normalizeManagedEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (address !== address.toLowerCase() || address.length > 254) return null;
  const suffix = "@me3.app";
  if (!address.endsWith(suffix)) return null;
  const localPart = address.slice(0, -suffix.length);
  if (
    localPart.length < 1 ||
    localPart.length > 64 ||
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(localPart) ||
    localPart.includes("+")
  ) {
    return null;
  }
  return address;
}

async function bootstrapManagedEmailMailbox(
  env: Env,
  address: string,
  ownerEmail: unknown,
): Promise<void> {
  const aliasLocalPart = address.slice(0, address.lastIndexOf("@"));
  const saved = await upsertAgentMailbox(
    env,
    "owner",
    { aliasLocalPart, forwardingEnabled: false },
    { email: typeof ownerEmail === "string" ? ownerEmail : null },
  );
  if ("error" in saved) throw new Error(`Managed email bootstrap failed: ${saved.error}`);
  const activated = await activateAgentMailbox(env, "owner");
  if ("error" in activated) {
    throw new Error(`Managed email activation failed: ${activated.error}`);
  }
}

async function getProvisionedManagedEmailAddress(env: Env): Promise<string | null> {
  if (normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) !== "managed") return null;
  const mailbox = await env.DB.prepare(
    `SELECT alias_local_part
     FROM mailbox_aliases
     WHERE user_id = 'owner' AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1`,
  )
    .bind()
    .first<{ alias_local_part: string }>();
  return normalizeManagedEmailAddress(
    mailbox?.alias_local_part ? `${mailbox.alias_local_part}@me3.app` : null,
  );
}

async function getOrCreateMe3CoreInstallId(env: Env): Promise<string> {
  const existing = await getStoredMe3CoreInstallId(env);
  if (existing) return existing;

  const installId = `core_${crypto.randomUUID()}`;
  await setStoredInstallSecret(env, ME3_CORE_INSTALL_ID_SECRET_NAME, installId);
  return installId;
}

async function getStoredMe3CoreInstallId(env: Env): Promise<string | null> {
  const stored = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
    .bind(ME3_CORE_INSTALL_ID_SECRET_NAME)
    .first<{ value: string }>();
  return normalizeMe3CoreInstallId(stored?.value);
}

async function deleteMe3ClaimState(env: Env, state: string): Promise<void> {
  await env.DB.prepare("DELETE FROM me3_install_claim_states WHERE state = ?")
    .bind(state)
    .run();
}

function redirectMe3ClaimError(
  c: AppContext,
  code: string,
  redirectPath?: string | null,
): Response {
  const target = new URL(normalizeClaimRedirect(redirectPath) || "/", getCoreWebOrigin(c.env, c.req.url));
  target.searchParams.set("me3_claim_error", code);
  return c.redirect(target.toString());
}

async function upsertMe3ClaimedOwner(
  env: Env,
  payload: Me3ClaimTokenPayload,
  handle: string,
): Promise<void> {
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const name =
    normalizeOwnerDisplayName(payload.name) ||
    normalizeOwnerDisplayName(payload.display_name) ||
    (email ? humanizeEmailLocalPart(email) : null) ||
    "ME3 Owner";

  await env.DB.prepare(
    `INSERT INTO owner_profile (id, email, name, username, bio, avatar_url, timezone, password_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       username = COALESCE(owner_profile.username, excluded.username),
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind("owner", email, name, handle, null, null, null, null)
    .run();

  await setStoredMe3CloudOwnerId(env, String(payload.sub));
  await ensureDefaultAssistantJobs(env, "owner");
  if (typeof payload.core_update_token === "string" && payload.core_update_token.trim()) {
    await setStoredInstallSecret(
      env,
      ME3_CLOUD_CORE_TOKEN_SECRET_NAME,
      payload.core_update_token.trim(),
    );
  }
}

async function getStoredMe3CloudOwnerId(env: Env): Promise<string | null> {
  const result = await env.DB.prepare(
    "SELECT value FROM install_secrets WHERE name = ?",
  )
    .bind(ME3_CLOUD_OWNER_SECRET_NAME)
    .first<{ value: string }>();

  return result?.value || null;
}

async function setStoredMe3CloudOwnerId(env: Env, ownerId: string): Promise<void> {
  await setStoredInstallSecret(env, ME3_CLOUD_OWNER_SECRET_NAME, ownerId);
}

async function setStoredInstallSecret(
  env: Env,
  name: string,
  value: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO install_secrets (name, value, created_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(name, value)
    .run();
}

async function deleteStoredMe3CloudOwnerId(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM install_secrets WHERE name = ?")
    .bind(ME3_CLOUD_OWNER_SECRET_NAME)
    .run();
  await env.DB.prepare("DELETE FROM install_secrets WHERE name = ?")
    .bind(ME3_CLOUD_CORE_TOKEN_SECRET_NAME)
    .run();
}

async function setOwnerSession(
  c: AppContext,
  ownerId: string,
  ttlSeconds = SESSION_TTL_SECONDS,
) {
  const sessionSecret = await getOrCreateInstallSessionSecret(c.env);

  const token = await signSessionToken(
    {
      sub: ownerId,
      iat: currentUnixTime(),
      exp: currentUnixTime() + ttlSeconds,
    },
    sessionSecret,
  );

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(c.env),
    sameSite: "Lax",
    path: "/",
    maxAge: ttlSeconds,
  });
}

function clearOwnerSession(c: AppContext) {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: "/",
    secure: shouldUseSecureCookie(c.env),
    sameSite: "Lax",
  });
}

async function getSessionOwnerId(c: AppContext): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;

  const payload = await verifySessionToken(
    token,
    await getOrCreateInstallSessionSecret(c.env),
  );
  if (!payload || payload.exp <= currentUnixTime()) return null;
  if (payload.sub !== "owner") return null;

  return payload.sub;
}

async function signSessionToken(payload: SessionPayload, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = encodeBase64UrlJson(header);
  const encodedPayload = encodeBase64UrlJson(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(data, secret);
  return `${data}.${encodeBase64Url(signature)}`;
}

async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const expectedSignature = encodeBase64Url(
    await hmacSha256(`${encodedHeader}.${encodedPayload}`, secret),
  );

  if (!constantTimeEqual(encodedSignature, expectedSignature)) return null;

  try {
    const header = JSON.parse(decodeBase64Url(encodedHeader)) as { alg?: string };
    if (header.alg !== "HS256") return null;

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyMe3ClaimToken(env: Env, token: string): Promise<Me3ClaimTokenPayload> {
  return verifyMe3CloudJwt<Me3ClaimTokenPayload>(env, token);
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

async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_ALGORITHM,
    String(PASSWORD_HASH_ITERATIONS),
    encodeBase64Url(salt),
    encodeBase64Url(hash),
  ].join("$");
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;
  const actualHash = encodeBase64Url(
    await derivePasswordHash(password, parsed.salt, parsed.iterations),
  );
  return constantTimeEqual(actualHash, parsed.expectedHash);
}

function parsePasswordHash(storedHash: string | null | undefined): {
  iterations: number;
  salt: Uint8Array;
  expectedHash: string;
} | null {
  if (!storedHash) return null;
  const [algorithm, rawIterations, rawSalt, expectedHash, extra] = storedHash.split("$");
  const iterations = Number(rawIterations);
  if (
    extra !== undefined ||
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !/^[A-Za-z0-9_-]+$/.test(rawSalt || "") ||
    !/^[A-Za-z0-9_-]+$/.test(expectedHash || "")
  ) {
    return null;
  }

  try {
    const salt = decodeBase64UrlBytes(rawSalt);
    const expectedBytes = decodeBase64UrlBytes(expectedHash);
    if (
      salt.byteLength === 0 ||
      expectedBytes.byteLength !== 32 ||
      encodeBase64Url(expectedBytes) !== expectedHash
    ) {
      return null;
    }
    return { iterations, salt, expectedHash };
  } catch {
    return null;
  }
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    key,
    256,
  );
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
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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

function shouldUseSecureCookie(env: Env): boolean {
  return getEnvironment(env) !== "local";
}

async function getSetupRequired(env: Env, ownerId = "owner"): Promise<string[]> {
  const missing: string[] = [];

  if (!getSetupPassword(env)) missing.push("SETUP_PASSWORD");
  if (!(await hasConfiguredAiProvider(env, ownerId))) {
    missing.push("AI_PROVIDER");
  }

  return missing;
}

function buildKnowledgeRuntimeContext(
  plugins: CorePluginRecord[],
  aiConfigured: boolean,
): Me3KnowledgeRuntimeContext {
  return {
    surface: "core",
    chatRuntime: "conversation_only",
    installedPluginIds: plugins
      .filter((plugin) => plugin.installed)
      .map((plugin) => plugin.id),
    enabledPluginIds: plugins
      .filter((plugin) => plugin.enabled && plugin.status === "installed")
      .map((plugin) => plugin.id),
    setupRequiredPluginIds: plugins
      .filter((plugin) => plugin.status === "setup_required")
      .map((plugin) => plugin.id),
    disabledPluginIds: plugins
      .filter((plugin) => plugin.status === "disabled")
      .map((plugin) => plugin.id),
    configuredFeatureIds: aiConfigured ? ["ai.chat_provider"] : [],
    missingFeatureIds: aiConfigured ? [] : ["ai.chat_provider"],
  };
}

function getEnvironment(env: Env): string {
  return env.ENVIRONMENT || "production";
}

function getSetupPassword(env: Env): string | undefined {
  return env.SETUP_PASSWORD;
}

export default app;

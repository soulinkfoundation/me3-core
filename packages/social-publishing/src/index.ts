import {
  adapterFor,
  normalizeTikTokDeliveryOptions,
  normalizeYouTubePublishingSettings,
  queryTikTokCreatorInfo,
  type TikTokCreatorInfo,
  type YouTubePrivacyStatus,
} from "./adapters";
import {
  canPublishSocialPlatform,
  canScheduleSocialPlatform,
  getSocialPlatformCapabilities,
  type SocialPlatformCapabilities,
} from "./capabilities";
import {
  blockPostingPlanItem,
  claimPostingPlanForConfirmation,
  finishPostingPlanConfirmation,
  linkPostingPlanItemPublication,
  markPostingPlanNeedsAttention,
  postingPlanPublicationId,
  reservePostingPlanItem,
  type ConfirmPostingPlanInput,
  type PostingPlan,
} from "./posting-plans";

export {
  adapterFor,
  normalizeTikTokDeliveryOptions,
  normalizeYouTubePublishingSettings,
  type SocialPublishAdapter,
  type SocialPublishAdapterResult,
  type SocialPublishFailureClass,
  type TikTokCreatorInfo,
  type TikTokDeliveryOptions,
  type TikTokPrivacyLevel,
  type YouTubePrivacyStatus,
  type YouTubePublishingSettings,
} from "./adapters";

export {
  SOCIAL_POST_SOURCE_TYPES,
  SocialPostInputError,
  addPostVersion,
  createSocialPost,
  deletePostVersion,
  ensureLocalSocialDemo,
  deleteSocialPost,
  getSocialPost,
  listSocialPosts,
  updateSocialPost,
  updatePostVersion,
  type CreatePostVersionInput,
  type CreateSocialPostInput,
  type PostVersion,
  type PostVersionPublishingSettings,
  type SocialPost,
  type SocialPostApprovalStatus,
  type SocialPostDetail,
  type SocialPostEnv,
  type SocialPostFormat,
  type SocialPostSourceType,
  type UpdatePostVersionInput,
  type UpdateSocialPostInput,
} from "./content-packages";

export {
  CAROUSEL_CANVAS,
  CAROUSEL_CONTENT_SLIDE_MAX,
  CAROUSEL_CONTENT_SLIDE_MIN,
  CAROUSEL_RASTER_MIME_TYPES,
  CAROUSEL_RENDER_MODEL_VERSION,
  CAROUSEL_SAFE_AREA,
  CAROUSEL_TEMPLATE_VERSIONS,
  CarouselRenderModelError,
  changeCarouselTemplate,
  createCarouselRenderModel,
  editCarouselSlide,
  reorderCarouselContentSlides,
  type CarouselCanvas,
  type CarouselClosingSlide,
  type CarouselContentSlide,
  type CarouselCoverSlide,
  type CarouselMediaReference,
  type CarouselOwnerStyleTokens,
  type CarouselRasterMimeType,
  type CarouselRenderModel,
  type CarouselSlide,
  type CarouselSlideEdit,
  type CarouselSource,
  type CarouselSourceEvidence,
  type CarouselTemplateId,
  type CarouselTemplateReference,
  type CreateCarouselRenderModelInput,
} from "./carousel-render-model";

export {
  CAROUSEL_RENDERER_VERSION,
  CarouselRenderValidationError,
  canonicalCarouselRenderInput,
  carouselReproducibleRenderInput,
  escapeCarouselSvgAttribute,
  escapeCarouselSvgText,
  fingerprintCarouselRenderInput,
  renderCarouselSvgSet,
  sniffCarouselRasterMimeType,
  validateCarouselRenderModel,
  type CarouselMediaByteResolver,
  type CarouselMediaBytes,
  type CarouselRenderedAsset,
  type CarouselRenderOptions,
  type CarouselRenderSet,
  type CarouselReproducibleMediaReference,
  type CarouselReproducibleRenderInput,
  type CarouselValidationCode,
  type CarouselValidationIssue,
} from "./carousel-renderer";

export {
  SOCIAL_CAROUSEL_D1_ROW_PAYLOAD_MAX_BYTES,
  SOCIAL_CAROUSEL_MEDIA_MAX_BYTES,
  SOCIAL_CAROUSEL_MEDIA_MAX_DIMENSION,
  SOCIAL_CAROUSEL_MEDIA_MAX_PIXELS,
  SocialCarouselInputError,
  getSocialCarouselMediaBytes,
  getSocialCarouselMediaBytesByHash,
  getSocialCarouselRenderedAsset,
  getSocialCarouselRenderSet,
  listSocialCarouselMedia,
  renderAndAttachSocialCarousel,
  uploadSocialCarouselMedia,
  type RenderAndAttachSocialCarouselInput,
  type RenderAndAttachSocialCarouselResult,
  type SocialCarouselAssetManifestItem,
  type SocialCarouselEnv,
  type SocialCarouselMedia,
  type SocialCarouselRenderAsset,
  type SocialCarouselRenderSet,
  type UploadSocialCarouselMediaInput,
} from "./carousels";

export {
  POSTING_WEEKDAYS,
  SocialPostingPlanInputError,
  blockPostingPlanItem,
  claimPostingPlanForConfirmation,
  createPostingPlan,
  finishPostingPlanConfirmation,
  getPostingPlan,
  getPreferredPostingTimes,
  linkPostingPlanItemPublication,
  markPostingPlanNeedsAttention,
  postingPlanPublicationId,
  reservePostingPlanItem,
  searchPostLibrary,
  updatePreferredPostingTimes,
  type ConfirmPostingPlanInput,
  type CreatePostingPlanInput,
  type PostLibraryItem,
  type PostLibrarySearchInput,
  type PostingPlan,
  type PostingPlanConfirmationClaim,
  type PostingPlanItem,
  type PostingPlanItemStatus,
  type PostingPlanReservation,
  type PostingPlanStatus,
  type PostingPlanWarning,
  type PostingPlanWarningCode,
  type PostingWeekday,
  type PreferredPostingTime,
  type PreferredPostingTimes,
  type SocialPostingPlanEnv,
  type UpdatePreferredPostingTimesInput,
} from "./posting-plans";

export {
  canPublishSocialPlatform,
  canScheduleSocialPlatform,
  getSocialPlatformCapabilities,
  socialPlatformCapabilities,
  type SocialContentType,
  type SocialDeliveryMode,
  type SocialMediaKind,
  type SocialPlatformCapabilities,
  type SocialPlatformContentRule,
} from "./capabilities";

export {
  listApprovedPostVersionsForScheduling,
  listCalendarSocialPublications,
  type ApprovedPostVersionScheduleOption,
  type SocialPublicationCalendarEntry,
  type SocialPublicationCalendarState,
  type SocialPublicationCalendarWindow,
} from "./calendar";

export {
  SOCIAL_SUGGESTION_KINDS,
  SocialSuggestionInputError,
  chooseSocialSuggestion,
  createSocialSuggestions,
  discardSocialSuggestion,
  listSocialSuggestions,
  updateSocialSuggestion,
  type ChooseSocialSuggestionInput,
  type CreateSocialSuggestionsInput,
  type DiscardSocialSuggestionInput,
  type SocialSuggestion,
  type SocialSuggestionKind,
  type SocialSuggestionStatus,
  type UpdateSocialSuggestionInput,
} from "./suggestions";

export const SOCIAL_PUBLISHING_PLUGIN_ID = "me3.social-publishing";
export const SOCIAL_PUBLISH_QUEUE_NAME = "me3-social-publish";
export const SOCIAL_PUBLISH_DLQ_NAME = "me3-social-publish-dlq";
export const SOCIAL_PUBLISH_QUEUE_BINDING = "SOCIAL_PUBLISH_QUEUE";
const fetchWithGlobalContext: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);

export const SOCIAL_PUBLISHING_RUNTIME = {
  id: SOCIAL_PUBLISHING_PLUGIN_ID,
  packageName: "@me3-core/plugin-social-publishing",
  bundled: true,
  runtimeStatus: "approval_first_publish_runtime",
  supportedPlatforms: [
    "x",
    "linkedin",
    "instagram",
    "instagram_business",
    "youtube",
    "tiktok",
  ],
  excludedProviders: [],
  queuesAndCrons: [
    {
      id: "social.publish-queue",
      kind: "queue",
      binding: SOCIAL_PUBLISH_QUEUE_BINDING,
      queueName: SOCIAL_PUBLISH_QUEUE_NAME,
      producerEntrypoint:
        "@me3-core/plugin-social-publishing#createPostVersionPublication",
      consumerEntrypoint:
        "@me3-core/plugin-social-publishing#processSocialPublishBatch",
      maxRetries: 2,
    },
    {
      id: "social.scheduled-dispatch",
      kind: "cron",
      schedule: "* * * * *",
      consumerEntrypoint:
        "@me3-core/plugin-social-publishing#dispatchDueSocialPublications",
    },
  ],
  notes: [
    "Core bundles the plugin runtime through an explicit workspace package.",
    "Every schedule or repost creates an immutable Publication snapshot with independent delivery and audit history.",
    "Live provider writes are disabled unless the plugin is installed, enabled, the exact Post Version is human-approved, and a matching active account is connected.",
  ],
} as const;

export type SocialPublishingRuntimeStatus =
  | "available"
  | "installed"
  | "setup_required"
  | "disabled";

export type SocialPublishingGate = {
  pluginId: typeof SOCIAL_PUBLISHING_PLUGIN_ID;
  status: SocialPublishingRuntimeStatus;
  enabled: boolean;
  ready: boolean;
  statusLabel: string;
  platformCapabilities: SocialPlatformCapabilities[];
};

export type SocialPublishingAccount = {
  id: string;
  siteId: string;
  platform: string;
  platformAccountId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  avatarSource: "provider" | "owner_profile" | null;
  credentialSource: "hosted_oauth" | "byo";
  publishingDefaults: SocialPublishingDefaults;
  status: string;
  scopes: string[];
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SocialPublishingDefaults = {
  youtube?: {
    privacyStatus: YouTubePrivacyStatus;
    madeForKids: boolean;
    containsSyntheticMedia: boolean;
  };
};

export type ManagedXUsageWarning = {
  usedPercent: number;
  blocked: boolean;
  resetsAt: string;
};

export const SOCIAL_PLATFORMS = [
  "x",
  "linkedin",
  "instagram",
  "instagram_business",
  "youtube",
  "tiktok",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialProviderSetting = {
  providerId: SocialPlatform;
  label: string;
  clientId: string;
  configured: boolean;
  enabled: boolean;
  secretHint: string | null;
  secretUpdatedAt: string | null;
  callbackPath: string;
};

export type SocialAuthorizeInput = {
  platform?: unknown;
  siteId?: unknown;
  returnPath?: unknown;
  credentialSource?: unknown;
};

export type SocialAuthorizeOptions = {
  apiOrigin: string;
  hostedOAuthOrigin?: string | null;
};

export type SocialCallbackOptions = {
  apiOrigin: string;
  webOrigin: string;
  fetch: typeof fetch;
  installKey: string;
  hostedOAuthOrigin?: string | null;
};

export type SocialProviderSettingsUpdate = {
  providers?: unknown;
};

type ContentPlatform = SocialPlatform;

type ContentItemStatus =
  | "bank"
  | "queued"
  | "scheduled"
  | "publishing"
  | "posted"
  | "failed"
  | "archived";

export type SocialMediaAsset = {
  url: string;
  fileId?: string;
  filename?: string;
  mimeType?: string;
  kind?: "image" | "video";
  altText?: string;
  contentHash?: string;
  byteLength?: number;
  path?: string;
  assetIndex?: number;
};

type ContentMediaAsset = SocialMediaAsset;

type ContentItem = {
  id: string;
  siteId: string;
  siteUsername: string;
  userId: string;
  body: string;
  mediaManifest: ContentMediaAsset[];
  platforms: ContentPlatform[];
  sourceType: "original" | "blog_extract" | "imported" | "reworked";
  sourceRef: string | null;
  status: ContentItemStatus;
  queuePosition: number | null;
  scheduledFor: string | null;
  timezone: string | null;
  createdBy: "human" | "agent_suggested";
  approvedByHuman: boolean;
  evergreen: boolean;
  timesPosted: number;
  lastPostedAt: string | null;
  cooldownDays: number;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type ContentStats = {
  bankCount: number;
  queuedCount: number;
  postedCount: number;
  nextScheduledAt: string | null;
};

type CreateContentItemInput = {
  siteId?: unknown;
  body?: unknown;
  platforms?: unknown;
  mediaManifest?: unknown;
  timezone?: unknown;
  notes?: unknown;
  evergreen?: unknown;
  tags?: unknown;
};

type UpdateContentItemInput = Partial<CreateContentItemInput> & {
  status?: unknown;
};

type PluginInstallationRow = {
  enabled: number;
  status: "installed" | "setup_required" | "disabled";
};

type SiteRow = {
  id: string;
  user_id: string;
  username?: string;
};

type SocialAccountRow = {
  id: string;
  site_id: string;
  platform: string;
  platform_account_id: string;
  platform_handle: string | null;
  display_name: string | null;
  metadata_json: string | null;
  owner_avatar_url: string | null;
  status: string;
  scopes_json: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type SocialProviderSettingRow = {
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

type SocialOauthStateRow = {
  id: string;
  state: string;
  user_id: string;
  site_id: string;
  platform: SocialPlatform;
  return_path: string;
  code_verifier: string | null;
  expires_at: string;
};

type ContentItemRow = {
  id: string;
  site_id: string;
  site_username: string;
  user_id: string;
  body: string;
  media_manifest_json: string;
  platforms_json: string;
  source_type: ContentItem["sourceType"];
  source_ref: string | null;
  status: ContentItemStatus;
  queue_position: number | null;
  scheduled_for: string | null;
  timezone: string | null;
  created_by: ContentItem["createdBy"];
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

type ContentQueueRow = {
  id: string;
  status: ContentItemStatus;
  queue_position: number | null;
};

type SocialPublicationEventType =
  | "generated"
  | "approved"
  | "scheduled"
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "retried"
  | "cancelled";

type SocialPublicationRow = {
  publication_id: string;
  variant_id: string;
  site_id: string;
  platform: SocialPlatform;
  pub_status: PublicationStatus;
  scheduled_for: string | null;
  pub_updated_at: string;
  pub_error_code: string | null;
  pub_provider_response_json: string | null;
  pub_request_context_json: string;
  title: string;
  body: string;
  media_manifest_json: string;
  platforms_json: string;
  approved_by_human: number;
  user_id: string;
  account_id: string | null;
  platform_account_id: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  account_status: string | null;
  account_metadata_json: string | null;
};

type PublishingAccessTokenRow = Pick<
  SocialPublicationRow,
  | "platform"
  | "user_id"
  | "account_id"
  | "access_token_ciphertext"
  | "refresh_token_ciphertext"
  | "token_expires_at"
  | "account_status"
  | "account_metadata_json"
>;

export type SocialPublishQueueMessage = {
  publicationId: string;
};

class SocialPublishRetrySignal extends Error {
  constructor(public readonly delaySeconds: number) {
    super("Social publication scheduled for retry");
    this.name = "SocialPublishRetrySignal";
  }
}

const SOCIAL_PUBLISHING_LEASE_RETRY_SECONDS = 11 * 60;

export type PublicationStatus =
  | "scheduled"
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type Publication = {
  id: string;
  versionId: string;
  platform: SocialPlatform;
  status: PublicationStatus;
  scheduledFor: string | null;
  timezone: string | null;
  queuedAt: string | null;
  platformPostId: string | null;
  platformPostUrl: string | null;
  publishedAt: string | null;
  failureClass: import("./adapters").SocialPublishFailureClass | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByType: "owner" | "agent" | "migration" | null;
  requestedByUserId: string | null;
  requestContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreatePublicationInput = {
  scheduledFor?: unknown;
  timezone?: unknown;
  requestedByType?: unknown;
  requestContext?: unknown;
};

type CreatePublicationInternalOptions = {
  publicationId?: string;
  reservationId?: string;
};

export type ReschedulePublicationInput = {
  scheduledFor?: unknown;
  timezone?: unknown;
  expectedUpdatedAt?: unknown;
  requestContext?: unknown;
};

export type PublicationScheduleChange = {
  action: "rescheduled";
  publication: Publication;
  previousScheduledFor: string;
  previousTimezone: string | null;
  approvalPreserved: true;
  auditEvent: "scheduled";
};

type PublicationRow = {
  id: string;
  variant_id: string;
  platform: SocialPlatform;
  status: PublicationStatus;
  scheduled_for: string | null;
  timezone: string | null;
  queued_at: string | null;
  platform_post_id: string | null;
  platform_post_url: string | null;
  published_at: string | null;
  error_code: string | null;
  error_message: string | null;
  requested_by_type: Publication["requestedByType"];
  requested_by_user_id: string | null;
  request_context_json: string;
  created_at: string;
  updated_at: string;
};

type PublicationScheduleGuardRow = PublicationRow & {
  approval_status_snapshot: string | null;
  current_approval_status: string;
  post_source_type: string;
  account_status: string | null;
};

type PostVersionPublicationCandidate = {
  id: string;
  platform: SocialPlatform;
  target_account_id: string | null;
  account_metadata_json: string | null;
  format: string;
  body_text: string;
  post_title: string;
  asset_manifest_json: string;
  publishing_settings_json: string;
  approval_status: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
  site_id: string;
  post_source_type: string;
};

type SocialVariantPublication = Omit<Publication, "versionId"> & { variantId: string };

type D1BoundStatementLike = {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

type D1StatementLike = {
  bind(...values: unknown[]): D1BoundStatementLike;
};

type SocialPublishingEnv = {
  DB: {
    prepare(sql: string): D1StatementLike;
    batch(statements: D1BoundStatementLike[]): Promise<unknown[]>;
  };
  SITE_ASSETS?: unknown;
  SOCIAL_PUBLISH_QUEUE?: {
    send(message: SocialPublishQueueMessage): Promise<unknown>;
  };
  CORE_API_ORIGIN?: string;
  CORE_WEB_ORIGIN?: string;
  ME3_API_HOST?: string;
  ME3_SITE_HOST?: string;
  ME3_CUSTOM_DOMAIN?: string;
  ME3_DEPLOYMENT_MODE?: string;
  ME3_SOCIAL_OAUTH_ORIGIN?: string;
  TOKEN_ENCRYPTION_KEY?: string;
};

const ME3_CLOUD_SOCIAL_OAUTH_ORIGIN = "https://api.me3.app";
const INSTAGRAM_GRAPH_VERSION = "v25.0";
const HOSTED_SOCIAL_OAUTH_LINK_SECRET_NAMES = [
  "ME3_CLOUD_OWNER_ID",
  "ME3_CORE_INSTALL_ID",
  "ME3_CLOUD_CORE_TOKEN",
] as const;

export async function resolveHostedSocialOAuthOrigin(
  env: SocialPublishingEnv,
): Promise<string | null> {
  const configuredOrigin = env.ME3_SOCIAL_OAUTH_ORIGIN?.trim().replace(/\/+$/, "") || null;
  if (configuredOrigin && configuredOrigin !== ME3_CLOUD_SOCIAL_OAUTH_ORIGIN) {
    return configuredOrigin;
  }
  if (!isManagedDeployment(env)) return null;

  try {
    const [ownerId, installId, installToken] = await Promise.all(
      HOSTED_SOCIAL_OAUTH_LINK_SECRET_NAMES.map(async (name) => {
        const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
          .bind(name)
          .first<{ value: string }>();
        return row?.value?.trim() || "";
      }),
    );
    return ownerId && installId && installToken
      ? configuredOrigin || ME3_CLOUD_SOCIAL_OAUTH_ORIGIN
      : null;
  } catch {
    return null;
  }
}

type ManagedXUsageQuote = {
  publicationId: string;
  scheduledFor: string | null;
  hasUrl: boolean;
  mediaCount: number;
  altTextCount: number;
  videoCount: number;
};

type ManagedXUsageReservation = {
  managed: boolean;
  warning: ManagedXUsageWarning | null;
};

function isManagedDeployment(env: SocialPublishingEnv): boolean {
  return env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed";
}

function bodyContainsUrl(body: string): boolean {
  return /(?:https?:\/\/|www\.)\S+/i.test(body);
}

function managedXUsageQuote(
  publicationId: string,
  scheduledFor: string | null,
  body: string,
  assets: SocialMediaAsset[],
): ManagedXUsageQuote {
  return {
    publicationId,
    scheduledFor,
    hasUrl: bodyContainsUrl(body),
    mediaCount: assets.length,
    altTextCount: assets.filter((asset) => Boolean(asset.altText?.trim())).length,
    videoCount: assets.filter((asset) => asset.kind === "video").length,
  };
}

async function managedXUsageRequest<T>(
  env: SocialPublishingEnv,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<{ response: Response; body: T | null }> {
  const [origin, headers] = await Promise.all([
    resolveHostedSocialOAuthOrigin(env),
    getHostedOAuthInstallationHeaders(env),
  ]);
  if (!origin || !headers) {
    throw new SocialPublishingInputError(
      "Managed X publishing is not configured",
      424,
    );
  }
  const response = await fetcher(`${origin}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null) as T | null;
  return { response, body };
}

export async function getManagedXUsageWarning(
  env: SocialPublishingEnv,
  fetcher: typeof fetch = fetchWithGlobalContext,
): Promise<ManagedXUsageWarning | null> {
  if (!isManagedDeployment(env)) return null;
  try {
    const { response, body } = await managedXUsageRequest<{
      warning?: ManagedXUsageWarning | null;
    }>(
      env,
      "/api/social/x/usage",
      { method: "GET" },
      fetcher,
    );
    if (!response.ok) return null;
    return body?.warning || null;
  } catch {
    return null;
  }
}

async function reserveManagedXUsage(
  env: SocialPublishingEnv,
  quote: ManagedXUsageQuote,
  fetcher: typeof fetch,
): Promise<ManagedXUsageReservation> {
  const { response, body } = await managedXUsageRequest<{
    allowed?: boolean;
    warning?: ManagedXUsageWarning | null;
    resetsAt?: string;
  }>(
    env,
    "/api/social/x/usage/reservations",
    {
      method: "POST",
      body: JSON.stringify(quote),
    },
    fetcher,
  );
  if (response.status === 429) {
    const reset = body?.resetsAt
      ? new Date(body.resetsAt).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : "next month";
    throw new SocialPublishingInputError(
      `X publishing is unavailable until ${reset}.`,
      429,
    );
  }
  if (!response.ok || body?.allowed !== true) {
    throw new SocialPublishingInputError(
      "X publishing is temporarily unavailable",
      503,
    );
  }
  return { managed: true, warning: body.warning || null };
}

async function settleManagedXUsage(
  env: SocialPublishingEnv,
  publicationId: string,
  action: "consume" | "release",
  fetcher: typeof fetch,
): Promise<void> {
  const { response } = await managedXUsageRequest(
    env,
    `/api/social/x/usage/reservations/${encodeURIComponent(publicationId)}/${action}`,
    {
      method: "POST",
      body: "{}",
    },
    fetcher,
  );
  if (!response.ok) {
    throw new SocialPublishingInputError(
      action === "consume"
        ? "X publishing is temporarily unavailable"
        : "Could not release the X publishing reservation",
      503,
    );
  }
}

async function managedXAccountMetadata(
  env: SocialPublishingEnv,
  ownerId: string,
  accountId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!accountId) return null;
  const account = await env.DB.prepare(
    `SELECT metadata_json
     FROM social_accounts
     WHERE id = ? AND user_id = ? AND platform = 'x'`,
  )
    .bind(accountId, ownerId)
    .first<{ metadata_json: string | null }>();
  return account ? parseJsonObject(account.metadata_json) : null;
}

async function reserveManagedXUsageForVersion(
  env: SocialPublishingEnv,
  ownerId: string,
  version: Pick<
    PostVersionPublicationCandidate,
    "platform" | "target_account_id" | "body_text" | "asset_manifest_json"
  >,
  publicationId: string,
  scheduledFor: string | null,
  fetcher: typeof fetch,
): Promise<ManagedXUsageReservation> {
  if (version.platform !== "x") return { managed: false, warning: null };
  const metadata = await managedXAccountMetadata(
    env,
    ownerId,
    version.target_account_id,
  );
  if (metadata?.credentialSource !== "hosted_oauth") {
    return { managed: false, warning: null };
  }
  if (!isManagedDeployment(env)) {
    throw new SocialPublishingInputError(
      "ME3-managed X publishing is available only with managed hosting",
      403,
    );
  }
  return reserveManagedXUsage(
    env,
    managedXUsageQuote(
      publicationId,
      scheduledFor,
      version.body_text,
      normalizeMediaManifest(parseJsonArray(version.asset_manifest_json)),
    ),
    fetcher,
  );
}

async function reserveManagedXUsageForPublication(
  env: SocialPublishingEnv,
  ownerId: string,
  publicationId: string,
  scheduledFor: string | null,
  fetcher: typeof fetch,
  reservationId = publicationId,
): Promise<ManagedXUsageReservation> {
  const row = await env.DB.prepare(
    `SELECT publication.platform, publication.target_account_id_snapshot,
            publication.body_text_snapshot, publication.asset_manifest_json_snapshot
     FROM social_publications publication
     JOIN social_variants version ON version.id = publication.variant_id
     JOIN social_packages post ON post.id = version.package_id
     JOIN sites site ON site.id = post.site_id
     WHERE publication.id = ? AND site.user_id = ?`,
  )
    .bind(publicationId, ownerId)
    .first<{
      platform: SocialPlatform;
      target_account_id_snapshot: string | null;
      body_text_snapshot: string;
      asset_manifest_json_snapshot: string;
    }>();
  if (!row) return { managed: false, warning: null };
  return reserveManagedXUsageForVersion(
    env,
    ownerId,
    {
      platform: row.platform,
      target_account_id: row.target_account_id_snapshot,
      body_text: row.body_text_snapshot,
      asset_manifest_json: row.asset_manifest_json_snapshot,
    },
    reservationId,
    scheduledFor,
    fetcher,
  );
}

async function releaseManagedXUsageForPublication(
  env: SocialPublishingEnv,
  platform: SocialPlatform,
  publicationId: string,
  fetcher: typeof fetch,
): Promise<void> {
  if (platform !== "x" || !isManagedDeployment(env)) return;
  await settleManagedXUsage(env, publicationId, "release", fetcher).catch(
    () => undefined,
  );
}

async function releaseManagedXUsageForAccount(
  env: SocialPublishingEnv,
  ownerId: string,
  accountId: string,
  fetcher: typeof fetch,
): Promise<void> {
  if (!isManagedDeployment(env)) return;
  const publications = await env.DB.prepare(
    `SELECT publication.id
     FROM social_publications publication
     JOIN social_variants version ON version.id = publication.variant_id
     JOIN social_packages post ON post.id = version.package_id
     JOIN sites site ON site.id = post.site_id
     WHERE publication.target_account_id_snapshot = ?
       AND site.user_id = ?
       AND publication.platform = 'x'
       AND publication.status IN ('scheduled', 'queued')`,
  )
    .bind(accountId, ownerId)
    .all<{ id: string }>();
  for (const publication of publications.results || []) {
    await settleManagedXUsage(
      env,
      publication.id,
      "release",
      fetcher,
    ).catch(() => undefined);
  }
}

function managedXReservationIdForAttempt(
  publicationId: string,
  attempt: number,
): string {
  return attempt > 1
    ? `${publicationId}-retry-${attempt}`
    : publicationId;
}

export class SocialPublishingGateError extends Error {
  constructor(
    public readonly gate: SocialPublishingGate,
    message = gateErrorMessage(gate),
  ) {
    super(message);
    this.name = "SocialPublishingGateError";
  }

  get status(): 403 | 404 | 424 {
    if (this.gate.status === "available") return 404;
    if (this.gate.status === "setup_required") return 424;
    return 403;
  }
}

export class SocialPublishingInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "SocialPublishingInputError";
  }
}

class SocialMediaDeliverySetupError extends SocialPublishingInputError {
  constructor(message: string) {
    super(message, 424);
    this.name = "SocialMediaDeliverySetupError";
  }
}

export async function getSocialPublishingRuntimeStatus(
  env: SocialPublishingEnv,
): Promise<SocialPublishingGate> {
  const row = await env.DB.prepare(
    `SELECT enabled, status
     FROM plugin_installations
     WHERE plugin_id = ?`,
  )
    .bind(SOCIAL_PUBLISHING_PLUGIN_ID)
    .first<PluginInstallationRow>();

  if (!row) return createGate("available", false);
  if (row.enabled === 0 || row.status === "disabled") return createGate("disabled", false);
  if (row.status === "setup_required") return createGate("setup_required", true);
  return createGate("installed", true);
}

export async function listSocialPublishingAccounts(
  env: SocialPublishingEnv,
  ownerId: string,
): Promise<SocialPublishingAccount[]> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) {
    throw new SocialPublishingGateError(gate);
  }

  const rows = await env.DB.prepare(
    `SELECT account.id, account.site_id, account.platform, account.platform_account_id,
            account.platform_handle, account.display_name, account.metadata_json,
            owner.avatar_url AS owner_avatar_url, account.status, account.scopes_json,
            account.last_verified_at, account.created_at, account.updated_at
     FROM social_accounts account
     LEFT JOIN owner_profile owner ON owner.id = account.user_id
     WHERE account.user_id = ?
       AND account.platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')
     ORDER BY account.updated_at DESC`,
  )
    .bind(ownerId)
    .all<SocialAccountRow>();

  return (rows.results || []).map((row) => {
    const metadata = parseJsonObject(row.metadata_json);
    const providerAvatarUrl = normalizeAvatarUrl(metadata.avatarUrl);
    const ownerAvatarUrl = normalizeAvatarUrl(row.owner_avatar_url);
    return {
      id: row.id,
      siteId: row.site_id,
      platform: row.platform,
      platformAccountId: row.platform_account_id,
      handle: row.platform_handle,
      displayName: row.display_name,
      avatarUrl: providerAvatarUrl || ownerAvatarUrl,
      avatarSource: providerAvatarUrl
        ? "provider" as const
        : ownerAvatarUrl ? "owner_profile" as const : null,
      credentialSource:
        metadata.credentialSource === "hosted_oauth"
          ? "hosted_oauth" as const
          : "byo" as const,
      publishingDefaults: socialPublishingDefaultsFromMetadata(metadata),
      status: row.status,
      scopes: parseStringArray(row.scopes_json),
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function updateSocialPublishingAccountDefaults(
  env: SocialPublishingEnv,
  ownerId: string,
  accountIdInput: unknown,
  input: unknown,
): Promise<SocialPublishingDefaults> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const accountId = normalizeId(accountIdInput);
  if (!accountId) throw new SocialPublishingInputError("Social account id is required");
  const account = await env.DB.prepare(
    `SELECT id, platform, metadata_json
     FROM social_accounts
     WHERE id = ? AND user_id = ?`,
  )
    .bind(accountId, ownerId)
    .first<{ id: string; platform: SocialPlatform; metadata_json: string | null }>();
  if (!account) throw new SocialPublishingInputError("Social account not found", 404);
  if (account.platform !== "youtube") {
    throw new SocialPublishingInputError(
      "Account-wide publishing defaults are currently available for YouTube only",
    );
  }
  const rawYouTube = isRecord(input) && isRecord(input.youtube)
    ? input.youtube
    : null;
  const youtube = normalizeYouTubePublishingSettings(rawYouTube);
  if (!youtube.privacyStatus || youtube.madeForKids === null) {
    throw new SocialPublishingInputError(
      "Choose YouTube visibility and audience before saving defaults",
    );
  }

  const metadata = parseJsonObject(account.metadata_json);
  const publishingDefaults: SocialPublishingDefaults = {
    ...socialPublishingDefaultsFromMetadata(metadata),
    youtube: {
      privacyStatus: youtube.privacyStatus,
      madeForKids: youtube.madeForKids,
      containsSyntheticMedia: youtube.containsSyntheticMedia,
    },
  };
  await env.DB.prepare(
    `UPDATE social_accounts
     SET metadata_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      JSON.stringify({ ...metadata, publishingDefaults }),
      new Date().toISOString(),
      account.id,
      ownerId,
    )
    .run();
  return publishingDefaults;
}

export async function getTikTokCreatorInfo(
  env: SocialPublishingEnv,
  ownerId: string,
  accountIdInput: unknown,
  fetcher: typeof fetch = fetchWithGlobalContext,
): Promise<TikTokCreatorInfo | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const accountId = normalizeId(accountIdInput);
  if (!accountId) throw new SocialPublishingInputError("TikTok account id is required");

  const account = await env.DB.prepare(
    `SELECT account.platform,
            account.user_id,
            account.id AS account_id,
            account.access_token_ciphertext,
            account.refresh_token_ciphertext,
            account.token_expires_at,
            account.status AS account_status,
            account.metadata_json AS account_metadata_json
     FROM social_accounts account
     WHERE account.id = ? AND account.user_id = ? AND account.platform = 'tiktok'`,
  )
    .bind(accountId, ownerId)
    .first<PublishingAccessTokenRow>();
  if (!account) return null;

  const accessToken = await resolvePublishingAccessToken(env, account, fetcher);
  if (!accessToken) {
    throw new SocialPublishingInputError(
      "Reconnect TikTok before loading Direct Post settings.",
      424,
    );
  }
  const result = await queryTikTokCreatorInfo(accessToken, fetcher);
  if (!result.ok) {
    if (
      result.errorCode === "scope_not_authorized" ||
      result.errorCode === "access_token_invalid"
    ) {
      throw new SocialPublishingInputError(
        "Reconnect TikTok to grant Direct Post access.",
        424,
      );
    }
    throw new SocialPublishingInputError(
      result.errorMessage,
      result.status === 429 ? 429 : 502,
    );
  }
  return result.creatorInfo;
}

export async function disconnectSocialPublishingAccount(
  env: SocialPublishingEnv,
  ownerId: string,
  accountIdInput: unknown,
): Promise<boolean> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const accountId = normalizeId(accountIdInput);
  if (!accountId) throw new SocialPublishingInputError("Social account id is required");
  const account = await env.DB.prepare(
    `SELECT id, platform, metadata_json FROM social_accounts
     WHERE id = ? AND user_id = ?`,
  )
    .bind(accountId, ownerId)
    .first<{ id: string; platform: SocialPlatform; metadata_json: string | null }>();
  if (!account) return false;

  const pending = await env.DB.prepare(
    `SELECT pub.id AS publication_id, pub.variant_id, pub.status
     FROM social_publications pub
     JOIN social_variants v ON v.id = pub.variant_id
     WHERE v.target_account_id = ? AND pub.status IN ('queued', 'publishing')`,
  )
    .bind(accountId)
    .all<{ publication_id: string; variant_id: string; status: "queued" | "publishing" }>();

  await env.DB.prepare(
    `UPDATE social_accounts
     SET status = 'revoked', access_token_ciphertext = '', refresh_token_ciphertext = NULL,
         token_expires_at = NULL, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(accountId)
    .run();

  for (const publication of pending.results || []) {
    const outcomeUnknown = publication.status === "publishing";
    await failContentPublication(
      env,
      publication,
      outcomeUnknown
        ? "outcome_unknown:account_disconnected_during_publish"
        : "reconnect_required:account_disconnected",
      outcomeUnknown
        ? "The account was disconnected while publishing. Check the provider before retrying."
        : "Reconnect the selected account before publishing.",
      publication.status,
      undefined,
      outcomeUnknown,
    );
  }
  if (
    account.platform === "x" &&
    parseJsonObject(account.metadata_json).credentialSource === "hosted_oauth"
  ) {
    await releaseManagedXUsageForAccount(
      env,
      ownerId,
      account.id,
      fetchWithGlobalContext,
    );
  }
  return true;
}

export async function listSocialProviderSettings(
  env: SocialPublishingEnv,
  ownerId: string,
): Promise<SocialProviderSetting[]> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const rows = await listProviderSettingRows(env, ownerId);
  return SOCIAL_PLATFORMS.map((platform) =>
    serializeProviderSetting(platform, rows.get(platform) || null),
  );
}

export async function updateSocialProviderSettings(
  env: SocialPublishingEnv,
  ownerId: string,
  input: SocialProviderSettingsUpdate,
  installKey: string,
): Promise<SocialProviderSetting[]> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  if (!isRecord(input) || !Array.isArray(input.providers)) {
    throw new SocialPublishingInputError("providers must be an array");
  }

  const existing = await listProviderSettingRows(env, ownerId);
  const now = new Date().toISOString();
  for (const item of input.providers) {
    if (!isRecord(item)) {
      throw new SocialPublishingInputError("provider updates must be objects");
    }
    const platform = normalizePlatform(item.id ?? item.providerId);
    if (!platform) throw new SocialPublishingInputError("Unknown social provider");

    const current = existing.get(platform) || null;
    const clientId = normalizeClientId(item.clientId ?? current?.client_id ?? "");
    let encryptedSecret = current?.encrypted_client_secret || null;
    let secretHint = current?.secret_hint || null;
    let secretUpdatedAt = current?.secret_updated_at || null;
    const secretInput = normalizeSecretInput(item.clientSecret);

    if (item.clearSecret === true || secretInput === null) {
      encryptedSecret = null;
      secretHint = null;
      secretUpdatedAt = null;
    } else if (secretInput) {
      encryptedSecret = await encryptSecret(secretInput, installKey);
      secretHint = getSecretHint(secretInput);
      secretUpdatedAt = now;
    }

    const enabled = item.enabled === undefined ? Boolean(clientId && encryptedSecret) : item.enabled === true;
    await env.DB.prepare(
      `INSERT INTO social_provider_settings (
         user_id, provider_id, client_id, encrypted_client_secret, secret_hint,
         secret_updated_at, enabled, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider_id) DO UPDATE SET
         client_id = excluded.client_id,
         encrypted_client_secret = excluded.encrypted_client_secret,
         secret_hint = excluded.secret_hint,
         secret_updated_at = excluded.secret_updated_at,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
      .bind(
        ownerId,
        platform,
        clientId,
        encryptedSecret,
        secretHint,
        secretUpdatedAt,
        enabled ? 1 : 0,
        current?.created_at || now,
        now,
      )
      .run();
  }

  return listSocialProviderSettings(env, ownerId);
}

export async function startSocialOAuth(
  env: SocialPublishingEnv,
  ownerId: string,
  input: SocialAuthorizeInput,
  options: SocialAuthorizeOptions,
): Promise<{ url: string; platform: SocialPlatform }> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const platform = normalizePlatform(input.platform);
  if (!platform) throw new SocialPublishingInputError("Unsupported social platform");
  const siteId = normalizeId(input.siteId);
  if (!siteId) throw new SocialPublishingInputError("siteId is required");
  const credentialSource = normalizeCredentialSource(input.credentialSource);

  const site = await env.DB.prepare("SELECT id, user_id FROM sites WHERE id = ? AND user_id = ?")
    .bind(siteId, ownerId)
    .first<SiteRow>();
  if (!site) throw new SocialPublishingInputError("Site not found", 404);

  const useHostedOAuth =
    credentialSource === "managed" ||
    (credentialSource === null && Boolean(options.hostedOAuthOrigin));
  if ((platform === "youtube" || platform === "tiktok") && !useHostedOAuth) {
    throw new SocialPublishingInputError(
      `${platformLabel(platform)} connects securely through ME3 Cloud`,
      424,
    );
  }
  if (useHostedOAuth) {
    if (!options.hostedOAuthOrigin) {
      throw new SocialPublishingInputError("ME3 managed OAuth is not configured", 424);
    }
    const id = randomToken("socst");
    const state = randomToken(`soc_${platform}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const returnPath = sanitizeReturnPath(input.returnPath);

    await env.DB.prepare(
      `INSERT INTO social_oauth_states (
         id, state, user_id, site_id, platform, return_path, code_verifier, expires_at, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'))`,
    )
      .bind(id, state, ownerId, siteId, platform, returnPath, expiresAt)
      .run();

    return {
      platform,
      url: buildHostedAuthorizeUrl(platform, state, options),
    };
  }

  const setting = await getProviderSettingRow(env, ownerId, platform);
  if (!setting?.enabled || !setting.client_id || !setting.encrypted_client_secret) {
    throw new SocialPublishingInputError(`${platformLabel(platform)} integration is not configured`, 424);
  }

  const id = randomToken("socst");
  const state = randomToken(`soc_${platform}`);
  const codeVerifier = platform === "x" ? randomVerifier() : null;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const returnPath = sanitizeReturnPath(input.returnPath);

  await env.DB.prepare(
    `INSERT INTO social_oauth_states (
       id, state, user_id, site_id, platform, return_path, code_verifier, expires_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(id, state, ownerId, siteId, platform, returnPath, codeVerifier, expiresAt)
    .run();

  return {
    platform,
    url: await buildAuthorizeUrl(platform, setting.client_id, state, codeVerifier, options.apiOrigin),
  };
}

function normalizeCredentialSource(value: unknown): "managed" | "byo" | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "managed" || value === "byo") return value;
  throw new SocialPublishingInputError("Unknown social credential source");
}

function buildHostedAuthorizeUrl(
  platform: SocialPlatform,
  state: string,
  options: SocialAuthorizeOptions,
): string {
  const origin = options.hostedOAuthOrigin?.replace(/\/$/, "");
  if (!origin) throw new SocialPublishingInputError("Hosted social OAuth is not configured", 424);
  const url = new URL(`/api/social/${platform}/authorize`, origin);
  url.searchParams.set("state", state);
  url.searchParams.set("core_callback", `${options.apiOrigin.replace(/\/$/, "")}/api/social/${platform}/callback`);
  return url.toString();
}

export async function completeSocialOAuth(
  env: SocialPublishingEnv,
  platformInput: unknown,
  query: { code?: string | null; state?: string | null; error?: string | null; handoff?: string | null },
  options: SocialCallbackOptions,
): Promise<string> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  const platform = normalizePlatform(platformInput);
  const frontend = options.webOrigin;
  if (query.error) return buildFrontendRedirect(frontend, "/social", { social_error: query.error });
  if (!platform || !query.state) {
    return buildFrontendRedirect(frontend, "/social", { social_error: "missing_params" });
  }
  if (!gate.ready) {
    return buildFrontendRedirect(frontend, "/social", { social_error: gate.status });
  }

  const stateRow = await env.DB.prepare(
    `SELECT id, state, user_id, site_id, platform, return_path, code_verifier, expires_at
     FROM social_oauth_states
     WHERE state = ? AND platform = ?`,
  )
    .bind(query.state, platform)
    .first<SocialOauthStateRow>();

  if (!stateRow || new Date(stateRow.expires_at) < new Date()) {
    return buildFrontendRedirect(frontend, "/social", { social_error: "state_expired" });
  }

  if (query.handoff) {
    return completeHostedSocialOAuth(env, stateRow, query.handoff, options);
  }

  if (!query.code) {
    return buildFrontendRedirect(frontend, "/social", { social_error: "missing_params" });
  }

  const setting = await getProviderSettingRow(env, stateRow.user_id, platform);
  if (!setting?.client_id || !setting.encrypted_client_secret) {
    return buildFrontendRedirect(frontend, stateRow.return_path, { social_error: "config" });
  }

  const clientSecret = await decryptSecret(setting.encrypted_client_secret, options.installKey);
  const token = await exchangeOAuthCode(platform, query.code, setting.client_id, clientSecret, stateRow.code_verifier, options);
  const profile = await fetchSocialProfile(platform, token.accessToken, options.fetch);
  const publishingAccessToken = profile.accessToken || token.accessToken;
  const now = new Date().toISOString();
  const previousAccount = await env.DB.prepare(
    `SELECT id, metadata_json
     FROM social_accounts
     WHERE site_id = ? AND platform = ? AND platform_account_id = ?`,
  )
    .bind(stateRow.site_id, platform, profile.id)
    .first<{ id: string; metadata_json: string | null }>();
  const previousPublishingDefaults = socialPublishingDefaultsFromMetadata(
    parseJsonObject(previousAccount?.metadata_json),
  );

  await env.DB.prepare("DELETE FROM social_oauth_states WHERE id = ?")
    .bind(stateRow.id)
    .run();

  await env.DB.prepare(
    `INSERT INTO social_accounts (
       id, user_id, site_id, platform, platform_account_id, platform_handle, display_name,
       access_token_ciphertext, refresh_token_ciphertext, token_expires_at, scopes_json,
       status, metadata_json, last_verified_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
     ON CONFLICT(site_id, platform, platform_account_id) DO UPDATE SET
       platform_handle = excluded.platform_handle,
       display_name = excluded.display_name,
       access_token_ciphertext = excluded.access_token_ciphertext,
       refresh_token_ciphertext = excluded.refresh_token_ciphertext,
       token_expires_at = excluded.token_expires_at,
       scopes_json = excluded.scopes_json,
       status = 'active',
       metadata_json = excluded.metadata_json,
       last_verified_at = excluded.last_verified_at,
       updated_at = excluded.updated_at`,
  )
    .bind(
      randomToken("socacct"),
      stateRow.user_id,
      stateRow.site_id,
      platform,
      profile.id,
      profile.handle,
      profile.displayName,
      await encryptSecret(publishingAccessToken, options.installKey),
      token.refreshToken ? await encryptSecret(token.refreshToken, options.installKey) : null,
      token.expiresAt,
      JSON.stringify(token.scopes),
      JSON.stringify({
        provider: platform,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        ...(Object.keys(previousPublishingDefaults).length
          ? { publishingDefaults: previousPublishingDefaults }
          : {}),
      }),
      now,
      now,
      now,
    )
    .run();
  if (
    platform === "x" &&
    isManagedDeployment(env) &&
    previousAccount &&
    parseJsonObject(previousAccount.metadata_json).credentialSource === "hosted_oauth"
  ) {
    await releaseManagedXUsageForAccount(
      env,
      stateRow.user_id,
      previousAccount.id,
      options.fetch,
    );
  }

  return buildFrontendRedirect(frontend, stateRow.return_path, { social_connected: platform });
}

async function completeHostedSocialOAuth(
  env: SocialPublishingEnv,
  stateRow: SocialOauthStateRow,
  handoff: string,
  options: SocialCallbackOptions,
): Promise<string> {
  const origin = options.hostedOAuthOrigin?.replace(/\/$/, "");
  if (!origin) {
    return buildFrontendRedirect(options.webOrigin, stateRow.return_path, { social_error: "config" });
  }

  const response = await options.fetch(`${origin}/api/social/oauth/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handoff,
      state: stateRow.state,
      platform: stateRow.platform,
    }),
  });
  const payload = await readJsonResponse<{
    account?: {
      id?: string;
      handle?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
    };
    token?: {
      accessToken?: string;
      refreshToken?: string | null;
      expiresAt?: string | null;
      scopes?: string[];
    };
  }>(response);

  if (!payload.account?.id || !payload.token?.accessToken) {
    throw new SocialPublishingInputError("Hosted social handoff was invalid", 502);
  }

  const now = new Date().toISOString();
  const previousAccount = await env.DB.prepare(
    `SELECT metadata_json
     FROM social_accounts
     WHERE site_id = ? AND platform = ? AND platform_account_id = ?`,
  )
    .bind(stateRow.site_id, stateRow.platform, payload.account.id)
    .first<{ metadata_json: string | null }>();
  const previousPublishingDefaults = socialPublishingDefaultsFromMetadata(
    parseJsonObject(previousAccount?.metadata_json),
  );
  await env.DB.prepare("DELETE FROM social_oauth_states WHERE id = ?")
    .bind(stateRow.id)
    .run();

  await env.DB.prepare(
    `INSERT INTO social_accounts (
       id, user_id, site_id, platform, platform_account_id, platform_handle, display_name,
       access_token_ciphertext, refresh_token_ciphertext, token_expires_at, scopes_json,
       status, metadata_json, last_verified_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
     ON CONFLICT(site_id, platform, platform_account_id) DO UPDATE SET
       platform_handle = excluded.platform_handle,
       display_name = excluded.display_name,
       access_token_ciphertext = excluded.access_token_ciphertext,
       refresh_token_ciphertext = excluded.refresh_token_ciphertext,
       token_expires_at = excluded.token_expires_at,
       scopes_json = excluded.scopes_json,
       status = 'active',
       metadata_json = excluded.metadata_json,
       last_verified_at = excluded.last_verified_at,
       updated_at = excluded.updated_at`,
  )
    .bind(
      randomToken("socacct"),
      stateRow.user_id,
      stateRow.site_id,
      stateRow.platform,
      payload.account.id,
      payload.account.handle || null,
      payload.account.displayName || null,
      await encryptSecret(payload.token.accessToken, options.installKey),
      payload.token.refreshToken ? await encryptSecret(payload.token.refreshToken, options.installKey) : null,
      payload.token.expiresAt || null,
      JSON.stringify(Array.isArray(payload.token.scopes) ? payload.token.scopes : []),
      JSON.stringify({
        provider: stateRow.platform,
        credentialSource: "hosted_oauth",
        ...(normalizeAvatarUrl(payload.account.avatarUrl)
          ? { avatarUrl: normalizeAvatarUrl(payload.account.avatarUrl) }
          : {}),
        ...(Object.keys(previousPublishingDefaults).length
          ? { publishingDefaults: previousPublishingDefaults }
          : {}),
      }),
      now,
      now,
      now,
    )
    .run();

  return buildFrontendRedirect(options.webOrigin, stateRow.return_path, { social_connected: stateRow.platform });
}

async function listContentItems(
  env: SocialPublishingEnv,
  ownerId: string,
  siteIdInput: unknown,
  statusInput?: unknown,
): Promise<ContentItem[]> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const siteId = normalizeId(siteIdInput);
  if (!siteId) throw new SocialPublishingInputError("siteId is required");
  const site = await getOwnedSite(env, ownerId, siteId);
  if (!site) return [];

  const status = normalizeContentStatus(statusInput);
  const rows = await env.DB.prepare(
    `SELECT c.*, s.username AS site_username
     FROM content_bank_items c
     JOIN sites s ON s.id = c.site_id
     WHERE c.user_id = ?
       AND c.site_id = ?
       AND (? IS NULL OR c.status = ?)
     ORDER BY
       CASE
         WHEN c.status IN ('queued', 'scheduled') THEN 0
         WHEN c.status = 'publishing' THEN 1
         WHEN c.status = 'posted' THEN 3
         ELSE 2
       END ASC,
       CASE
         WHEN c.status IN ('queued', 'scheduled') THEN COALESCE(c.queue_position, 2147483647)
         ELSE NULL
       END ASC,
       CASE
         WHEN c.status = 'posted' THEN COALESCE(c.last_posted_at, c.updated_at)
         ELSE c.updated_at
       END DESC`,
  )
    .bind(ownerId, site.id, status ?? null, status ?? null)
    .all<ContentItemRow>();

  return (rows.results || []).map(serializeContentItem);
}

async function getContentStats(
  env: SocialPublishingEnv,
  ownerId: string,
  siteIdInput: unknown,
): Promise<ContentStats | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const siteId = normalizeId(siteIdInput);
  if (!siteId) throw new SocialPublishingInputError("siteId is required");
  const site = await getOwnedSite(env, ownerId, siteId);
  if (!site) return null;

  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'bank' THEN 1 ELSE 0 END) AS bank_count,
       SUM(CASE WHEN status IN ('queued', 'scheduled') THEN 1 ELSE 0 END) AS queued_count,
       SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted_count,
       MIN(CASE WHEN status = 'scheduled' THEN scheduled_for ELSE NULL END) AS next_scheduled_at
     FROM content_bank_items
     WHERE user_id = ? AND site_id = ?`,
  )
    .bind(ownerId, site.id)
    .first<{
      bank_count: number | null;
      queued_count: number | null;
      posted_count: number | null;
      next_scheduled_at: string | null;
    }>();

  return {
    bankCount: row?.bank_count || 0,
    queuedCount: row?.queued_count || 0,
    postedCount: row?.posted_count || 0,
    nextScheduledAt: row?.next_scheduled_at || null,
  };
}

async function createContentItem(
  env: SocialPublishingEnv,
  ownerId: string,
  input: CreateContentItemInput,
): Promise<ContentItem> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const siteId = normalizeId(input.siteId);
  if (!siteId) throw new SocialPublishingInputError("siteId is required");
  const site = await getOwnedSite(env, ownerId, siteId);
  if (!site) throw new SocialPublishingInputError("Site not found", 404);

  const body = normalizeBody(input.body);
  if (!body) throw new SocialPublishingInputError("Content body is required");
  const platforms = normalizeContentPlatforms(input.platforms);
  if (platforms.length === 0) {
    throw new SocialPublishingInputError("Choose at least one platform");
  }

  const id = randomToken("content");
  await env.DB.prepare(
    `INSERT INTO content_bank_items (
       id, site_id, user_id, body, media_manifest_json, platforms_json,
       source_type, source_ref, timezone, notes, evergreen, tags_json,
       approved_by_human, created_by, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, 'original', NULL, ?, ?, ?, ?, 1, 'human', datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      site.id,
      ownerId,
      body,
      JSON.stringify(normalizeMediaManifest(input.mediaManifest)),
      JSON.stringify(platforms),
      typeof input.timezone === "string" ? input.timezone.trim() || null : null,
      typeof input.notes === "string" ? input.notes.trim() || null : null,
      input.evergreen === true ? 1 : 0,
      JSON.stringify(normalizeTags(input.tags)),
    )
    .run();

  const created = await getOwnedContentItem(env, ownerId, id);
  if (!created) throw new SocialPublishingInputError("Could not create content item", 500);
  return serializeContentItem(created);
}

async function updateContentItem(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
  input: UpdateContentItemInput,
): Promise<ContentItem | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const id = normalizeId(idInput);
  if (!id) throw new SocialPublishingInputError("Content item id is required");
  const existing = await getOwnedContentItem(env, ownerId, id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];
  if (input.body !== undefined) {
    const body = normalizeBody(input.body);
    if (!body) throw new SocialPublishingInputError("Content body is required");
    updates.push("body = ?");
    values.push(body);
  }
  if (input.platforms !== undefined) {
    const platforms = normalizeContentPlatforms(input.platforms);
    if (platforms.length === 0) {
      throw new SocialPublishingInputError("Choose at least one platform");
    }
    updates.push("platforms_json = ?");
    values.push(JSON.stringify(platforms));
  }
  if (input.mediaManifest !== undefined) {
    updates.push("media_manifest_json = ?");
    values.push(JSON.stringify(normalizeMediaManifest(input.mediaManifest)));
  }
  if (input.status !== undefined) {
    const status = normalizeContentStatus(input.status);
    if (!status) throw new SocialPublishingInputError("Unsupported content status");
    updates.push("status = ?");
    values.push(status);
  }
  if (input.timezone !== undefined) {
    updates.push("timezone = ?");
    values.push(typeof input.timezone === "string" ? input.timezone.trim() || null : null);
  }
  if (input.notes !== undefined) {
    updates.push("notes = ?");
    values.push(typeof input.notes === "string" ? input.notes.trim() || null : null);
  }
  if (input.evergreen !== undefined) {
    updates.push("evergreen = ?");
    values.push(input.evergreen === true ? 1 : 0);
  }
  if (input.tags !== undefined) {
    updates.push("tags_json = ?");
    values.push(JSON.stringify(normalizeTags(input.tags)));
  }

  if (updates.length === 0) return serializeContentItem(existing);

  await env.DB.prepare(
    `UPDATE content_bank_items
     SET ${updates.join(", ")}, approved_by_human = 1, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(...values, id, ownerId)
    .run();

  const updated = await getOwnedContentItem(env, ownerId, id);
  return updated ? serializeContentItem(updated) : null;
}

async function deleteContentItem(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
): Promise<boolean> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const id = normalizeId(idInput);
  if (!id) throw new SocialPublishingInputError("Content item id is required");
  const existing = await getOwnedContentItem(env, ownerId, id);
  if (!existing) return false;

  await env.DB.prepare("DELETE FROM content_bank_items WHERE id = ? AND user_id = ?")
    .bind(id, ownerId)
    .run();

  if (existing.status === "queued" || existing.status === "scheduled") {
    await resequenceContentQueue(env, ownerId, existing.site_id);
  }
  return true;
}

async function appendContentItemMedia(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
  asset: ContentMediaAsset,
): Promise<ContentItem | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const id = normalizeId(idInput);
  if (!id) throw new SocialPublishingInputError("Content item id is required");
  const existing = await getOwnedContentItem(env, ownerId, id);
  if (!existing) return null;

  const nextManifest = [
    ...normalizeMediaManifest(parseJsonArray(existing.media_manifest_json)),
    asset,
  ];

  await env.DB.prepare(
    `UPDATE content_bank_items
     SET media_manifest_json = ?, approved_by_human = 1, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(JSON.stringify(nextManifest), id, ownerId)
    .run();

  const updated = await getOwnedContentItem(env, ownerId, id);
  return updated ? serializeContentItem(updated) : null;
}

async function queueContentItem(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
): Promise<ContentItem | null> {
  return setContentQueueState(env, ownerId, idInput, "queued");
}

async function unqueueContentItem(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
): Promise<ContentItem | null> {
  return setContentQueueState(env, ownerId, idInput, "bank");
}

async function markContentItemPublishing(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
): Promise<ContentItem | null> {
  const item = await setContentQueueState(env, ownerId, idInput, "publishing");
  return item;
}

async function createQueuedContentPublicationAndEnqueue(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
): Promise<{ item: ContentItem; publicationIds: string[] } | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const id = normalizeId(idInput);
  if (!id) throw new SocialPublishingInputError("Content item id is required");
  const existing = await getOwnedContentItem(env, ownerId, id);
  if (!existing) return null;
  if (existing.approved_by_human !== 1) {
    throw new SocialPublishingInputError("Content item must be approved before publishing", 403);
  }
  if (existing.status === "publishing") {
    throw new SocialPublishingInputError("This item is already publishing");
  }

  const platforms = normalizeContentPlatforms(parseJsonArray(existing.platforms_json));
  if (platforms.length === 0) {
    throw new SocialPublishingInputError("Choose at least one platform");
  }

  const accounts = await listActiveAccountsByPlatform(env, ownerId, existing.site_id, platforms);
  const missing = platforms.filter((platform) => !accounts.has(platform));
  if (missing.length > 0) {
    throw new SocialPublishingInputError(
      `Connect ${missing.map(platformLabel).join(", ")} before publishing`,
      424,
    );
  }

  const publicationIds: string[] = [];
  for (const platform of platforms) {
    const existingPublication = await env.DB.prepare(
      `SELECT id, status
       FROM social_publications
       WHERE variant_id = ? AND platform = ? AND status IN ('queued', 'publishing')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(existing.id, platform)
      .first<{ id: string; status: string }>();

    if (existingPublication) {
      publicationIds.push(existingPublication.id);
      continue;
    }

    const publicationId = randomToken("socpub");
    publicationIds.push(publicationId);
    await env.DB.prepare(
      `INSERT INTO social_publications (
         id, variant_id, site_id, platform, status, queued_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 'queued', ?, datetime('now'), datetime('now'))`,
    )
      .bind(publicationId, existing.id, existing.site_id, platform, new Date().toISOString())
      .run();
    await insertSocialPublicationEvent(env, {
      publicationId,
      variantId: existing.id,
      eventType: "queued",
      payload: { platform, contentItemId: existing.id },
    });
    if (env.SOCIAL_PUBLISH_QUEUE) {
      await env.SOCIAL_PUBLISH_QUEUE.send({ publicationId });
    }
  }

  await setContentQueueState(env, ownerId, existing.id, "publishing");
  if (!env.SOCIAL_PUBLISH_QUEUE) {
    for (const publicationId of publicationIds) {
      await publishQueuedPublication(env, publicationId);
    }
  }

  const updated = await getOwnedContentItem(env, ownerId, existing.id);
  if (!updated) throw new SocialPublishingInputError("Could not update content item", 500);
  return { item: serializeContentItem(updated), publicationIds };
}

async function createQueuedSocialVariantPublicationAndEnqueue(
  env: SocialPublishingEnv,
  ownerId: string,
  variantIdInput: unknown,
  fetcher: typeof fetch = fetchWithGlobalContext,
): Promise<SocialVariantPublication | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const variantId = normalizeId(variantIdInput);
  if (!variantId) throw new SocialPublishingInputError("Post Version id is required");

  const variant = await env.DB.prepare(
    `SELECT v.id, v.platform, v.target_account_id, v.approval_status, p.site_id,
            p.source_type AS post_source_type
     FROM social_variants v
     JOIN social_packages p ON p.id = v.package_id
     JOIN sites s ON s.id = p.site_id
     WHERE v.id = ? AND s.user_id = ?`,
  )
    .bind(variantId, ownerId)
    .first<{
      id: string;
      platform: SocialPlatform;
      target_account_id: string | null;
      approval_status: string;
      site_id: string;
      post_source_type: string;
    }>();
  if (!variant) return null;
  if (!canPublishSocialPlatform(variant.platform)) {
    throw new SocialPublishingInputError(
      `${platformLabel(variant.platform)} Versions are draft-only and cannot be published yet`,
    );
  }
  if (variant.approval_status !== "approved") {
    throw new SocialPublishingInputError(
      `Approve this exact ${platformLabel(variant.platform)} Version before publishing`,
      403,
    );
  }
  if (!variant.target_account_id) {
    throw new SocialPublishingInputError(
      `Choose a connected ${platformLabel(variant.platform)} account before publishing`,
      424,
    );
  }
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts
     WHERE id = ? AND user_id = ? AND site_id = ? AND platform = ? AND status = 'active'`,
  )
    .bind(variant.target_account_id, ownerId, variant.site_id, variant.platform)
    .first<{ id: string }>();
  if (!account) {
    throw new SocialPublishingInputError(
      `Reconnect the selected ${platformLabel(variant.platform)} account before publishing`,
      424,
    );
  }

  const existing = await latestSocialVariantPublication(env, variantId, [
    "queued",
    "publishing",
    "published",
  ]);
  if (existing) {
    await env.DB.prepare(
      "UPDATE social_variants SET scheduled_for = NULL, timezone = NULL WHERE id = ?",
    )
      .bind(variant.id)
      .run();
    return existing;
  }
  if (variant.post_source_type === "legacy_content_bank_read_only") {
    throw new SocialPublishingInputError(
      "This imported Post is read-only. Create a source-backed Post before publishing.",
      403,
    );
  }

  const publicationId = randomToken("socpub");
  try {
    await env.DB.prepare(
      `INSERT INTO social_publications (
         id, variant_id, site_id, platform, status, queued_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'queued', ?, datetime('now'), datetime('now'))`,
    )
      .bind(publicationId, variant.id, variant.site_id, variant.platform, new Date().toISOString())
      .run();
  } catch (error) {
    const concurrent = await latestSocialVariantPublication(env, variantId, [
      "queued",
      "publishing",
      "published",
    ]);
    if (concurrent) return concurrent;
    throw error;
  }
  await env.DB.prepare(
    "UPDATE social_variants SET scheduled_for = NULL, timezone = NULL, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(variant.id)
    .run();
  await insertSocialPublicationEvent(env, {
    publicationId,
    variantId: variant.id,
    eventType: "queued",
    payload: { platform: variant.platform, targetAccountId: variant.target_account_id },
  });

  if (env.SOCIAL_PUBLISH_QUEUE) {
    await env.SOCIAL_PUBLISH_QUEUE.send({ publicationId });
  } else {
    await publishQueuedPublication(env, publicationId, fetcher);
  }
  return latestSocialVariantPublication(env, variantId);
}

async function resolveSocialVariantPublicationOutcome(
  env: SocialPublishingEnv,
  ownerId: string,
  variantIdInput: unknown,
  input: { outcome?: unknown; platformPostUrl?: unknown },
): Promise<SocialVariantPublication | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const variantId = normalizeId(variantIdInput);
  if (!variantId) throw new SocialPublishingInputError("Post Version id is required");
  const owned = await env.DB.prepare(
    `SELECT v.id
     FROM social_variants v
     JOIN social_packages p ON p.id = v.package_id
     JOIN sites s ON s.id = p.site_id
     WHERE v.id = ? AND s.user_id = ?`,
  )
    .bind(variantId, ownerId)
    .first<{ id: string }>();
  if (!owned) return null;
  const publication = await env.DB.prepare(
    `SELECT id, error_code
     FROM social_publications
     WHERE variant_id = ? AND status = 'publishing'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(variantId)
    .first<{ id: string; error_code: string | null }>();
  if (!publication || parseFailureClass(publication.error_code) !== "outcome_unknown") {
    throw new SocialPublishingInputError("This publication does not need outcome resolution", 409);
  }

  if (input.outcome === "published") {
    const platformPostUrl = normalizeId(input.platformPostUrl);
    if (!platformPostUrl || !isHttpsUrl(platformPostUrl)) {
      throw new SocialPublishingInputError("Paste the published post URL to confirm the outcome");
    }
    await env.DB.prepare(
      `UPDATE social_publications
       SET status = 'published', platform_post_url = ?, published_at = datetime('now'),
           error_code = NULL, error_message = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(platformPostUrl, publication.id)
      .run();
    await insertSocialPublicationEvent(env, {
      publicationId: publication.id,
      variantId,
      eventType: "published",
      payload: { resolution: "owner_confirmed", platformPostUrl, ownerId },
    });
  } else if (input.outcome === "not_published") {
    await failContentPublication(
      env,
      { publication_id: publication.id, variant_id: variantId },
      "retryable:owner_confirmed_not_published",
      "The owner confirmed that no provider post was created.",
      "publishing",
    );
  } else {
    throw new SocialPublishingInputError("Choose published or not_published");
  }
  await syncContentItemStatusFromPublications(env, variantId);
  return latestSocialVariantPublication(env, variantId);
}

async function getOwnedPostVersionPublicationCandidate(
  env: SocialPublishingEnv,
  ownerId: string,
  versionId: string,
): Promise<PostVersionPublicationCandidate | null> {
  return env.DB.prepare(
    `SELECT v.id, v.platform, v.target_account_id,
            account.metadata_json AS account_metadata_json, v.format, v.body_text,
            COALESCE(NULLIF(TRIM(v.title), ''), p.post_title_snapshot) AS post_title,
            v.asset_manifest_json, v.publishing_settings_json,
            v.approval_status, v.approved_at,
            v.approved_by_user_id, p.site_id, p.source_type AS post_source_type
     FROM social_variants v
     JOIN social_packages p ON p.id = v.package_id
     JOIN sites s ON s.id = p.site_id
     LEFT JOIN social_accounts account ON account.id = v.target_account_id
     WHERE v.id = ? AND s.user_id = ?`,
  )
    .bind(versionId, ownerId)
    .first<PostVersionPublicationCandidate>();
}

async function assertPostVersionCanCreatePublication(
  env: SocialPublishingEnv,
  ownerId: string,
  version: PostVersionPublicationCandidate,
  isScheduled: boolean,
): Promise<void> {
  if (version.post_source_type === "legacy_content_bank_read_only") {
    throw new SocialPublishingInputError(
      `This imported Post is read-only. Create a source-backed Post before ${isScheduled ? "scheduling" : "publishing"}.`,
      403,
    );
  }
  if (
    isScheduled
      ? !canScheduleSocialPlatform(version.platform)
      : !canPublishSocialPlatform(version.platform)
  ) {
    throw new SocialPublishingInputError(
      `${platformLabel(version.platform)} Versions are draft-only and cannot be ${isScheduled ? "scheduled" : "published"} yet`,
    );
  }
  if (version.approval_status !== "approved") {
    throw new SocialPublishingInputError(
      `Approve this exact ${platformLabel(version.platform)} Version before ${isScheduled ? "scheduling" : "publishing"}`,
      403,
    );
  }
  if (!version.target_account_id) {
    throw new SocialPublishingInputError(
      `Choose a connected ${platformLabel(version.platform)} account before ${isScheduled ? "scheduling" : "publishing"}`,
      424,
    );
  }
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts
     WHERE id = ? AND user_id = ? AND site_id = ? AND platform = ? AND status = 'active'`,
  )
    .bind(version.target_account_id, ownerId, version.site_id, version.platform)
    .first<{ id: string }>();
  if (!account) {
    throw new SocialPublishingInputError(
      `Reconnect the selected ${platformLabel(version.platform)} account before ${isScheduled ? "scheduling" : "publishing"}`,
      424,
    );
  }
  const assets = normalizeMediaManifest(parseJsonArray(version.asset_manifest_json));
  const validation = adapterFor(version.platform).validateDraft({
    title: version.post_title,
    bodyText: version.body_text,
    assets,
  });
  if (!validation.ok) {
    throw new SocialPublishingInputError(validation.error);
  }
  assertPrivateMediaDeliveryReady(env, assets);
}

export async function createPostVersionPublication(
  env: SocialPublishingEnv,
  ownerId: string,
  versionId: unknown,
  input: CreatePublicationInput = {},
  fetcher: typeof fetch = fetchWithGlobalContext,
  internal: CreatePublicationInternalOptions = {},
): Promise<Publication | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const normalizedVersionId = normalizeId(versionId);
  if (!normalizedVersionId) {
    throw new SocialPublishingInputError("Post Version id is required");
  }

  const version = await getOwnedPostVersionPublicationCandidate(
    env,
    ownerId,
    normalizedVersionId,
  );
  if (!version) return null;

  const scheduledForInput = normalizeId(input.scheduledFor);
  const isScheduled = Boolean(scheduledForInput);
  await assertPostVersionCanCreatePublication(env, ownerId, version, isScheduled);

  let scheduledFor: string | null = null;
  let timezone: string | null = null;
  if (scheduledForInput) {
    const timestamp = Date.parse(scheduledForInput);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      throw new SocialPublishingInputError("Schedule time must be in the future");
    }
    scheduledFor = new Date(timestamp).toISOString();
    timezone = publicationTimezone(input.timezone);
    if (internal.publicationId) {
      const recovered = await getOwnedPublication(env, ownerId, internal.publicationId);
      if (recovered) {
        if (recovered.status === "cancelled" || recovered.status === "failed") {
          throw new SocialPublishingInputError(
            "The recovered Posting plan Publication ended without a safe schedule",
            409,
          );
        }
        if (
          recovered.versionId !== version.id ||
          recovered.scheduledFor !== scheduledFor ||
          recovered.timezone !== timezone
        ) {
          throw new SocialPublishingInputError(
            "The recovered Posting plan Publication does not match this exact Version and time",
            409,
          );
        }
        return recovered;
      }
    }
    if (internal.reservationId) {
      const reservation = await env.DB.prepare(
        `SELECT reservation.id
         FROM social_posting_reservations reservation
         JOIN social_posting_plan_items item ON item.id = reservation.plan_item_id
         JOIN social_posting_plans plan ON plan.id = item.plan_id
         WHERE reservation.id = ? AND plan.user_id = ?
           AND reservation.account_id = ? AND reservation.scheduled_for = ?
           AND reservation.status IN ('reserved', 'fulfilled')
           AND item.variant_id = ?`,
      )
        .bind(
          internal.reservationId,
          ownerId,
          version.target_account_id,
          scheduledFor,
          version.id,
        )
        .first<{ id: string }>();
      if (!reservation) {
        throw new SocialPublishingInputError(
          "Posting plan reservation is no longer valid. Refresh the plan before scheduling.",
          409,
        );
      }
    }
    const duplicate = await findScheduledPublication(env, version.id, scheduledFor);
    if (duplicate) {
      throw new SocialPublishingInputError(
        "This Version already has a Publication at that time",
        409,
      );
    }
  } else {
    const inFlight = await latestSocialVariantPublication(env, version.id, [
      "queued",
      "publishing",
    ]);
    if (inFlight) {
      await resumeQueuedPublicationHandoff(env, inFlight, fetcher);
      return canonicalPublication(
        (await latestSocialVariantPublication(env, version.id, [
          "queued",
          "publishing",
          "published",
          "failed",
        ])) || inFlight,
      );
    }
  }

  const requestedByType = input.requestedByType === "agent" ? "agent" : "owner";
  const requestContextJson = publicationRequestContextForVersion(version, input.requestContext);
  const publicationId = internal.publicationId || randomToken("socpub");
  const now = new Date().toISOString();
  const managedXReservation = await reserveManagedXUsageForVersion(
    env,
    ownerId,
    version,
    publicationId,
    scheduledFor,
    fetcher,
  );
  if (isScheduled) {
    const auditEventId = randomToken("socevt");
    let inserted: {
      id: string;
      platform: SocialPlatform;
      target_account_id_snapshot: string | null;
    } | null;
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO social_publications (
             id, variant_id, site_id, platform, status, scheduled_for, timezone,
             target_account_id_snapshot, format_snapshot, body_text_snapshot,
             asset_manifest_json_snapshot, approval_status_snapshot,
             approved_at_snapshot, approved_by_user_id_snapshot, requested_by_type,
             requested_by_user_id, request_context_json, queued_at, created_at, updated_at
           )
           SELECT ?, v.id, p.site_id, v.platform, 'scheduled', ?, ?,
                  v.target_account_id, v.format, v.body_text, v.asset_manifest_json,
                  v.approval_status, v.approved_at, v.approved_by_user_id, ?, ?, ?,
                  NULL, ?, ?
           FROM social_variants v
           JOIN social_packages p ON p.id = v.package_id
           JOIN sites s ON s.id = p.site_id
           JOIN social_accounts account
             ON account.id = v.target_account_id
            AND account.user_id = s.user_id
            AND account.site_id = p.site_id
            AND account.platform = v.platform
            AND account.status = 'active'
           WHERE v.id = ?
             AND s.user_id = ?
             AND p.source_type <> 'legacy_content_bank_read_only'
             AND v.approval_status = 'approved'
             AND v.platform = ?
             AND (
               ? IS NULL
               OR EXISTS (
                 SELECT 1
                 FROM social_posting_reservations own_reservation
                 JOIN social_posting_plan_items own_item
                   ON own_item.id = own_reservation.plan_item_id
                 WHERE own_reservation.id = ?
                   AND own_reservation.account_id = v.target_account_id
                   AND own_reservation.scheduled_for = ?
                   AND own_reservation.status = 'reserved'
                   AND own_item.variant_id = v.id
               )
             )
             AND NOT EXISTS (
               SELECT 1 FROM social_posting_reservations reservation
               WHERE reservation.account_id = v.target_account_id
                 AND reservation.status = 'reserved'
                 AND (
                   ? IS NULL OR reservation.id <> ?
                 )
                 AND (
                   reservation.scheduled_for = ?
                   OR (? > reservation.range_start AND ? < reservation.range_end)
                 )
             )
             AND NOT EXISTS (
               SELECT 1
               FROM social_publications existing
               WHERE existing.variant_id = v.id
                 AND existing.scheduled_for = ?
                 AND existing.status = 'scheduled'
             )`,
        ).bind(
          publicationId,
          scheduledFor,
          timezone,
          requestedByType,
          ownerId,
          requestContextJson,
          now,
          now,
          version.id,
          ownerId,
          version.platform,
          internal.reservationId || null,
          internal.reservationId || null,
          scheduledFor,
          internal.reservationId || null,
          internal.reservationId || null,
          scheduledFor,
          scheduledFor,
          scheduledFor,
          scheduledFor,
        ),
        env.DB.prepare(
          `INSERT INTO social_publication_events (
             id, publication_id, variant_id, event_type, payload_json, created_at
           )
           SELECT ?, publication.id, publication.variant_id, 'scheduled',
                  json_object(
                    'action', 'scheduled',
                    'platform', publication.platform,
                    'targetAccountId', publication.target_account_id_snapshot,
                    'scheduledFor', publication.scheduled_for,
                    'timezone', publication.timezone,
                    'requestedByType', publication.requested_by_type,
                    'requestedByUserId', publication.requested_by_user_id
                  ),
                  ?
           FROM social_publications publication
           WHERE publication.id = ? AND changes() > 0`,
        ).bind(auditEventId, now, publicationId),
      ]);
      inserted = await env.DB.prepare(
        `SELECT publication.id, publication.platform,
                publication.target_account_id_snapshot
         FROM social_publications publication
         JOIN social_publication_events event
           ON event.id = ?
          AND event.publication_id = publication.id
          AND event.event_type = 'scheduled'
         WHERE publication.id = ?`,
      )
        .bind(auditEventId, publicationId)
        .first<{
          id: string;
          platform: SocialPlatform;
          target_account_id_snapshot: string | null;
        }>();
    } catch (error) {
      if (managedXReservation.managed) {
        await settleManagedXUsage(env, publicationId, "release", fetcher).catch(
          () => undefined,
        );
      }
      if (scheduledFor && await findScheduledPublication(env, version.id, scheduledFor)) {
        throw new SocialPublishingInputError(
          "This Version already has a Publication at that time",
          409,
        );
      }
      throw error;
    }

    if (!inserted) {
      if (managedXReservation.managed) {
        await settleManagedXUsage(env, publicationId, "release", fetcher).catch(
          () => undefined,
        );
      }
      if (scheduledFor && await findScheduledPublication(env, version.id, scheduledFor)) {
        throw new SocialPublishingInputError(
          "This Version already has a Publication at that time",
          409,
        );
      }
      if (
        scheduledFor &&
        await findBlockingPostingReservation(
          env,
          version.target_account_id,
          scheduledFor,
          internal.reservationId || null,
        )
      ) {
        throw new SocialPublishingInputError(
          "This account has another Posting plan too close to that time",
          409,
        );
      }
      const current = await getOwnedPostVersionPublicationCandidate(
        env,
        ownerId,
        version.id,
      );
      if (!current) return null;
      await assertPostVersionCanCreatePublication(env, ownerId, current, true);
      throw new SocialPublishingInputError(
        "This Version changed while it was being scheduled. Refresh and try again.",
        409,
      );
    }
  } else {
    try {
      const insertPublication = env.DB.prepare(
        `INSERT INTO social_publications (
           id, variant_id, site_id, platform, status, scheduled_for, timezone,
           target_account_id_snapshot, format_snapshot, body_text_snapshot,
           asset_manifest_json_snapshot, approval_status_snapshot,
           approved_at_snapshot, approved_by_user_id_snapshot, requested_by_type,
           requested_by_user_id, request_context_json, queued_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          publicationId,
          version.id,
          version.site_id,
          version.platform,
          "queued",
          scheduledFor,
          timezone,
          version.target_account_id,
          version.format,
          version.body_text,
          version.asset_manifest_json,
          version.approval_status,
          version.approved_at,
          version.approved_by_user_id,
          requestedByType,
          ownerId,
          requestContextJson,
          null,
          now,
          now,
        );
      const statements = [insertPublication];
      if (version.platform === "tiktok" || version.platform === "youtube") {
        statements.push(
          env.DB.prepare(
            `UPDATE social_variants
             SET publishing_settings_json = '{}', updated_at = ?
             WHERE id = ?`,
          ).bind(now, version.id),
        );
      }
      await env.DB.batch(statements);
    } catch (error) {
      if (managedXReservation.managed) {
        await settleManagedXUsage(env, publicationId, "release", fetcher).catch(
          () => undefined,
        );
      }
      const concurrent = await latestSocialVariantPublication(env, version.id, [
        "queued",
        "publishing",
      ]);
      if (concurrent) {
        await resumeQueuedPublicationHandoff(env, concurrent, fetcher);
        return canonicalPublication(
          (await latestSocialVariantPublication(env, version.id, [
            "queued",
            "publishing",
            "published",
            "failed",
          ])) || concurrent,
        );
      }
      throw error;
    }
  }

  if (!isScheduled) {
    await insertSocialPublicationEvent(env, {
      publicationId,
      variantId: version.id,
      eventType: "queued",
      payload: {
        action: "publish_requested",
        platform: version.platform,
        targetAccountId: version.target_account_id,
        scheduledFor,
        timezone,
        requestedByType,
        requestedByUserId: ownerId,
      },
    });
    await resumeQueuedPublicationHandoff(
      env,
      {
        id: publicationId,
        status: "queued",
        queuedAt: null,
      },
      fetcher,
    );
  }
  return getOwnedPublication(env, ownerId, publicationId);
}

export async function confirmPostingPlan(
  env: SocialPublishingEnv,
  ownerId: string,
  planId: unknown,
  input: ConfirmPostingPlanInput,
  options: { requestedByType?: "owner" | "agent" } = {},
): Promise<PostingPlan | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const claim = await claimPostingPlanForConfirmation(env, ownerId, planId, input);
  if (!claim) return null;
  if (claim.alreadyConfirmed || !claim.token) return claim.plan;

  try {
    for (const item of claim.plan.items) {
      if (item.status === "scheduled" && item.publicationId) continue;
      try {
        const reservation = await reservePostingPlanItem(
          env,
          ownerId,
          claim.plan.id,
          item.id,
          claim.token,
        );
        const publication = await createPostVersionPublication(
          env,
          ownerId,
          item.versionId,
          {
            scheduledFor: item.scheduledFor,
            timezone: item.timezone,
            requestedByType: options.requestedByType === "agent" ? "agent" : "owner",
            requestContext: {
              surface: "posting_plan",
              postingPlanId: claim.plan.id,
              postingPlanItemId: item.id,
              repost: item.isRepost,
            },
          },
          fetchWithGlobalContext,
          {
            publicationId: reservation.publicationId,
            reservationId: reservation.id,
          },
        );
        if (!publication) {
          throw new SocialPublishingInputError("The approved Version is no longer available", 409);
        }
        await linkPostingPlanItemPublication(
          env,
          ownerId,
          claim.plan.id,
          item.id,
          claim.token,
          publication.id,
        );
      } catch (error) {
        const recovered = await getOwnedPublication(
          env,
          ownerId,
          postingPlanPublicationId(item.id),
        );
        if (
          recovered &&
          recovered.status !== "cancelled" &&
          recovered.status !== "failed" &&
          recovered.versionId === item.versionId &&
          recovered.scheduledFor === item.scheduledFor &&
          recovered.timezone === item.timezone
        ) {
          await linkPostingPlanItemPublication(
            env,
            ownerId,
            claim.plan.id,
            item.id,
            claim.token,
            recovered.id,
          );
          continue;
        }
        await blockPostingPlanItem(
          env,
          ownerId,
          claim.plan.id,
          item.id,
          claim.token,
          error instanceof Error ? error.message : "This Post could not be scheduled.",
        );
      }
    }
    return finishPostingPlanConfirmation(env, ownerId, claim.plan.id, claim.token);
  } catch (error) {
    await markPostingPlanNeedsAttention(env, ownerId, claim.plan.id, claim.token);
    throw error;
  }
}

async function resumeQueuedPublicationHandoff(
  env: SocialPublishingEnv,
  publication: Pick<SocialVariantPublication, "id" | "status" | "queuedAt">,
  fetcher: typeof fetch,
): Promise<void> {
  if (publication.status !== "queued") return;
  if (env.SOCIAL_PUBLISH_QUEUE) {
    if (publication.queuedAt) return;
    const claimed = await env.DB.prepare(
      `UPDATE social_publications
       SET queued_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND status = 'queued' AND queued_at IS NULL
       RETURNING id`,
    )
      .bind(publication.id)
      .first<{ id: string }>();
    if (!claimed) return;
    try {
      await env.SOCIAL_PUBLISH_QUEUE.send({ publicationId: publication.id });
    } catch (error) {
      await env.DB.prepare(
        `UPDATE social_publications
         SET queued_at = NULL, updated_at = datetime('now')
         WHERE id = ? AND status = 'queued'`,
      )
        .bind(publication.id)
        .run();
      throw error;
    }
    return;
  }
  await publishQueuedPublication(env, publication.id, fetcher);
}

export async function listPostVersionPublications(
  env: SocialPublishingEnv,
  ownerId: string,
  versionIdInput: unknown,
): Promise<Publication[]> {
  const versionId = normalizeId(versionIdInput);
  if (!versionId) throw new SocialPublishingInputError("Post Version id is required");
  const rows = await env.DB.prepare(
    `${publicationSelectSql()}
     JOIN social_variants v ON v.id = pub.variant_id
     JOIN social_packages p ON p.id = v.package_id
     JOIN sites s ON s.id = p.site_id
     WHERE pub.variant_id = ? AND s.user_id = ?
     ORDER BY COALESCE(pub.scheduled_for, pub.created_at) DESC, pub.created_at DESC`,
  )
    .bind(versionId, ownerId)
    .all<PublicationRow>();
  return (rows.results || []).map(serializePublication);
}

export async function reschedulePublication(
  env: SocialPublishingEnv,
  ownerId: string,
  publicationIdInput: unknown,
  input: ReschedulePublicationInput,
): Promise<PublicationScheduleChange | null> {
  const publicationId = normalizeId(publicationIdInput);
  if (!publicationId) throw new SocialPublishingInputError("Publication id is required");

  const scheduledForInput = normalizeId(input.scheduledFor);
  if (!scheduledForInput) {
    throw new SocialPublishingInputError("Choose a new schedule time");
  }
  const timestamp = Date.parse(scheduledForInput);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new SocialPublishingInputError("Schedule time must be in the future");
  }
  const scheduledFor = new Date(timestamp).toISOString();
  const timezone = publicationTimezone(input.timezone);
  const expectedUpdatedAt = normalizeId(input.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    throw new SocialPublishingInputError(
      "Refresh this Publication before changing its schedule",
      409,
    );
  }
  const requestContext = parseJsonObject(publicationRequestContextJson(input.requestContext));

  const existing = await getPublicationScheduleGuardRow(env, ownerId, publicationId);
  if (!existing) return null;
  assertPublicationCanBeRescheduled(existing);
  if (existing.updated_at !== expectedUpdatedAt) {
    throw new SocialPublishingInputError(
      "This Publication changed after Calendar loaded it. Refresh and try again.",
      409,
    );
  }
  if (existing.scheduled_for === scheduledFor && existing.timezone === timezone) {
    throw new SocialPublishingInputError("Choose a different schedule time", 409);
  }

  const duplicate = await env.DB.prepare(
    `SELECT id FROM social_publications
     WHERE variant_id = ? AND scheduled_for = ? AND status = 'scheduled' AND id <> ?
     LIMIT 1`,
  )
    .bind(existing.variant_id, scheduledFor, existing.id)
    .first<{ id: string }>();
  if (duplicate) {
    throw new SocialPublishingInputError(
      "This Version already has a Publication at that time",
      409,
    );
  }

  const managedXReservation = await reserveManagedXUsageForPublication(
    env,
    ownerId,
    publicationId,
    scheduledFor,
    fetchWithGlobalContext,
  );
  const restoreManagedXReservation = async () => {
    if (!managedXReservation.managed) return;
    await reserveManagedXUsageForPublication(
      env,
      ownerId,
      publicationId,
      existing.scheduled_for,
      fetchWithGlobalContext,
    ).catch(() => undefined);
  };

  let updatedAt = new Date().toISOString();
  if (updatedAt === expectedUpdatedAt) {
    updatedAt = new Date(Date.now() + 1).toISOString();
  }
  const auditPayload = JSON.stringify({
    action: "rescheduled",
    surface: "calendar",
    previous: {
      scheduledFor: existing.scheduled_for,
      timezone: existing.timezone,
    },
    next: { scheduledFor, timezone },
    approvalPreserved: true,
    ownerId,
    requestContext,
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_publications AS publication
         SET scheduled_for = ?, timezone = ?, updated_at = ?
         WHERE publication.id = ?
           AND publication.status = 'scheduled'
           AND publication.updated_at = ?
           AND publication.approval_status_snapshot = 'approved'
           AND publication.platform = ?
           AND NOT EXISTS (
             SELECT 1 FROM social_posting_reservations reservation
             WHERE reservation.account_id = publication.target_account_id_snapshot
               AND reservation.status = 'reserved'
               AND (
                 reservation.scheduled_for = ?
                 OR (? > reservation.range_start AND ? < reservation.range_end)
               )
           )
           AND EXISTS (
             SELECT 1
             FROM social_variants version
             JOIN social_packages post ON post.id = version.package_id
             JOIN sites site ON site.id = post.site_id
             JOIN social_accounts account
               ON account.id = publication.target_account_id_snapshot
              AND account.user_id = site.user_id
              AND account.site_id = publication.site_id
              AND account.platform = publication.platform
              AND account.status = 'active'
             WHERE version.id = publication.variant_id
               AND version.approval_status = 'approved'
               AND post.source_type <> 'legacy_content_bank_read_only'
               AND site.user_id = ?
           )
         RETURNING id`,
      ).bind(
        scheduledFor,
        timezone,
        updatedAt,
        existing.id,
        expectedUpdatedAt,
        existing.platform,
        scheduledFor,
        scheduledFor,
        scheduledFor,
        ownerId,
      ),
      env.DB.prepare(
        `INSERT INTO social_publication_events (
           id, publication_id, variant_id, event_type, payload_json, created_at
         )
         SELECT ?, ?, ?, 'scheduled', ?, ?
         WHERE changes() > 0`,
      ).bind(
        randomToken("socevt"),
        existing.id,
        existing.variant_id,
        auditPayload,
        updatedAt,
      ),
    ]);
  } catch (error) {
    await restoreManagedXReservation();
    const conflict = await env.DB.prepare(
      `SELECT id FROM social_publications
       WHERE variant_id = ? AND scheduled_for = ? AND status = 'scheduled' AND id <> ?
       LIMIT 1`,
    )
      .bind(existing.variant_id, scheduledFor, existing.id)
      .first<{ id: string }>();
    if (conflict) {
      throw new SocialPublishingInputError(
        "This Version already has a Publication at that time",
        409,
      );
    }
    throw error;
  }

  const refreshed = await getPublicationScheduleGuardRow(env, ownerId, publicationId);
  if (!refreshed) return null;
  if (
    refreshed.status !== "scheduled" ||
    refreshed.updated_at !== updatedAt ||
    refreshed.scheduled_for !== scheduledFor ||
    refreshed.timezone !== timezone
  ) {
    if (await findBlockingPostingReservationForPublication(env, existing.id, scheduledFor)) {
      await restoreManagedXReservation();
      throw new SocialPublishingInputError(
        "This account has another Posting plan too close to that time",
        409,
      );
    }
    try {
      assertPublicationCanBeRescheduled(refreshed);
    } catch (error) {
      await restoreManagedXReservation();
      throw error;
    }
    await restoreManagedXReservation();
    throw new SocialPublishingInputError(
      "This Publication changed while its schedule was being updated. Refresh and try again.",
      409,
    );
  }

  return {
    action: "rescheduled",
    publication: serializePublication(refreshed),
    previousScheduledFor: existing.scheduled_for!,
    previousTimezone: existing.timezone,
    approvalPreserved: true,
    auditEvent: "scheduled",
  };
}

export async function cancelPublication(
  env: SocialPublishingEnv,
  ownerId: string,
  publicationIdInput: unknown,
): Promise<Publication | null> {
  const publicationId = normalizeId(publicationIdInput);
  if (!publicationId) throw new SocialPublishingInputError("Publication id is required");
  const publication = await getOwnedPublication(env, ownerId, publicationId);
  if (!publication) return null;
  if (publication.status !== "scheduled") {
    throw new SocialPublishingInputError("Only a scheduled Publication can be cancelled", 409);
  }

  const previousTimestamp = Date.parse(publication.updatedAt);
  const updatedAt = new Date(Math.max(
    Date.now(),
    Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0,
  )).toISOString();
  const auditEventId = randomToken("socevt");
  const auditPayload = JSON.stringify({
    action: "cancelled",
    reason: "owner_request",
    ownerId,
  });
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE social_publications AS publication
       SET status = 'cancelled', error_code = 'cancelled:owner_request',
           error_message = 'Cancelled by the owner.', updated_at = ?
       WHERE publication.id = ?
         AND publication.status = 'scheduled'
         AND EXISTS (
           SELECT 1
           FROM social_variants version
           JOIN social_packages post ON post.id = version.package_id
           JOIN sites site ON site.id = post.site_id
           WHERE version.id = publication.variant_id
             AND site.user_id = ?
         )
       RETURNING id`,
    ).bind(updatedAt, publication.id, ownerId),
    env.DB.prepare(
      `INSERT INTO social_publication_events (
         id, publication_id, variant_id, event_type, payload_json, created_at
       )
       SELECT ?, ?, ?, 'cancelled', ?, ?
       WHERE changes() > 0`,
    ).bind(
      auditEventId,
      publication.id,
      publication.versionId,
      auditPayload,
      updatedAt,
    ),
  ]);

  const refreshed = await getOwnedPublication(env, ownerId, publication.id);
  if (!refreshed) return null;
  const auditEvent = await env.DB.prepare(
    `SELECT id FROM social_publication_events
     WHERE id = ? AND publication_id = ? AND event_type = 'cancelled'`,
  )
    .bind(auditEventId, publication.id)
    .first<{ id: string }>();
  if (
    refreshed.status !== "cancelled" ||
    refreshed.errorCode !== "cancelled:owner_request" ||
    refreshed.updatedAt !== updatedAt ||
    !auditEvent
  ) {
    throw new SocialPublishingInputError(
      "This Publication is already being dispatched and can no longer be cancelled",
      409,
    );
  }
  await releaseManagedXUsageForPublication(
    env,
    publication.platform,
    publication.id,
    fetchWithGlobalContext,
  );
  return refreshed;
}

export async function resolvePublicationOutcome(
  env: SocialPublishingEnv,
  ownerId: string,
  publicationIdInput: unknown,
  input: { outcome?: unknown; platformPostUrl?: unknown },
): Promise<Publication | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
  const publicationId = normalizeId(publicationIdInput);
  if (!publicationId) throw new SocialPublishingInputError("Publication id is required");
  const publication = await getOwnedPublication(env, ownerId, publicationId);
  if (!publication) return null;
  if (
    publication.status !== "publishing" ||
    publication.failureClass !== "outcome_unknown"
  ) {
    throw new SocialPublishingInputError("This Publication does not need outcome resolution", 409);
  }

  if (input.outcome === "published") {
    const platformPostUrl = normalizeId(input.platformPostUrl);
    if (!platformPostUrl || !isHttpsUrl(platformPostUrl)) {
      throw new SocialPublishingInputError("Paste the published post URL to confirm the outcome");
    }
    const resolvedAt = new Date().toISOString();
    const auditEventId = randomToken("socevt");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_publications
         SET status = 'published', platform_post_url = ?, published_at = ?,
             error_code = NULL, error_message = NULL, updated_at = ?
         WHERE id = ? AND status = 'publishing'
           AND (error_code = 'outcome_unknown' OR error_code LIKE 'outcome_unknown:%')`,
      ).bind(platformPostUrl, resolvedAt, resolvedAt, publication.id),
      env.DB.prepare(
        `INSERT INTO social_publication_events (
           id, publication_id, variant_id, event_type, payload_json, created_at
         )
         SELECT ?, ?, ?, 'published', ?, ?
         WHERE changes() > 0`,
      ).bind(
        auditEventId,
        publication.id,
        publication.versionId,
        JSON.stringify({ resolution: "owner_confirmed", platformPostUrl, ownerId }),
        resolvedAt,
      ),
    ]);
    const auditEvent = await env.DB.prepare(
      `SELECT id FROM social_publication_events
       WHERE id = ? AND publication_id = ? AND event_type = 'published'`,
    )
      .bind(auditEventId, publication.id)
      .first<{ id: string }>();
    if (!auditEvent) {
      throw new SocialPublishingInputError(
        "This Publication outcome was already resolved",
        409,
      );
    }
  } else if (input.outcome === "not_published") {
    const errorCode = "retryable:owner_confirmed_not_published";
    const errorMessage = "The owner confirmed that no provider post was created.";
    const resolvedAt = new Date().toISOString();
    const auditEventId = randomToken("socevt");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_publications
         SET status = 'failed', error_code = ?, error_message = ?,
             provider_response_json = NULL, updated_at = ?
         WHERE id = ? AND status = 'publishing'
           AND (error_code = 'outcome_unknown' OR error_code LIKE 'outcome_unknown:%')`,
      ).bind(errorCode, errorMessage, resolvedAt, publication.id),
      env.DB.prepare(
        `INSERT INTO social_publication_events (
           id, publication_id, variant_id, event_type, payload_json, created_at
         )
         SELECT ?, ?, ?, 'failed', ?, ?
         WHERE changes() > 0`,
      ).bind(
        auditEventId,
        publication.id,
        publication.versionId,
        JSON.stringify({
          code: errorCode,
          message: errorMessage,
          resolution: "owner_confirmed",
        }),
        resolvedAt,
      ),
    ]);
    const auditEvent = await env.DB.prepare(
      `SELECT id FROM social_publication_events
       WHERE id = ? AND publication_id = ? AND event_type = 'failed'`,
    )
      .bind(auditEventId, publication.id)
      .first<{ id: string }>();
    if (!auditEvent) {
      throw new SocialPublishingInputError(
        "This Publication outcome was already resolved",
        409,
      );
    }
  } else {
    throw new SocialPublishingInputError("Choose published or not_published");
  }
  await syncContentItemStatusFromPublications(env, publication.versionId);
  return getOwnedPublication(env, ownerId, publication.id);
}

export async function dispatchDueSocialPublications(
  env: SocialPublishingEnv,
): Promise<{ queued: number; skipped: number }> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) return { queued: 0, skipped: 0 };

  let queued = 0;
  let skipped = 0;
  const publications = await env.DB.prepare(
    `SELECT id, variant_id, scheduled_for
     FROM social_publications
     WHERE status = 'scheduled'
       AND scheduled_for IS NOT NULL
       AND datetime(scheduled_for) <= datetime('now')
     ORDER BY scheduled_for ASC, created_at ASC
     LIMIT 20`,
  )
    .bind()
    .all<{ id: string; variant_id: string; scheduled_for: string }>();
  for (const publication of publications.results || []) {
    let claimed = false;
    try {
      const claim = await env.DB.prepare(
        `UPDATE social_publications
         SET status = 'queued', queued_at = NULL, updated_at = datetime('now')
         WHERE id = ? AND status = 'scheduled' AND scheduled_for = ?
           AND datetime(scheduled_for) <= datetime('now')
         RETURNING id, variant_id`,
      )
        .bind(publication.id, publication.scheduled_for)
        .first<{ id: string; variant_id: string }>();
      if (!claim) {
        skipped += 1;
        continue;
      }
      claimed = true;
      await insertSocialPublicationEvent(env, {
        publicationId: claim.id,
        variantId: claim.variant_id,
        eventType: "queued",
        payload: { dispatch: "scheduled" },
      });
      await resumeQueuedPublicationHandoff(
        env,
        { id: claim.id, status: "queued", queuedAt: null },
        fetchWithGlobalContext,
      );
      queued += 1;
    } catch {
      if (claimed) {
        const reset = await env.DB.prepare(
          `UPDATE social_publications
           SET status = 'scheduled', queued_at = NULL, updated_at = datetime('now')
           WHERE id = ? AND status = 'queued'
           RETURNING id, variant_id`,
        )
          .bind(publication.id)
          .first<{ id: string; variant_id: string }>();
        if (reset) {
          await insertSocialPublicationEvent(env, {
            publicationId: reset.id,
            variantId: reset.variant_id,
            eventType: "scheduled",
            payload: { dispatch: "rollback", reason: "queue_handoff_failed" },
          });
        }
      }
      skipped += 1;
    }
  }
  return { queued, skipped };
}

export async function recoverStrandedQueuedSocialPublications(
  env: SocialPublishingEnv,
  fetcher: typeof fetch = fetchWithGlobalContext,
): Promise<{ requeued: number; skipped: number }> {
  const staleRows = await env.DB.prepare(
    `SELECT id, updated_at
     FROM social_publications
     WHERE status = 'queued'
       AND datetime(updated_at) <= datetime('now', '-10 minutes')
     ORDER BY updated_at ASC
     LIMIT 25`,
  ).bind().all<{ id: string; updated_at: string }>();

  let requeued = 0;
  let skipped = 0;
  for (const row of staleRows.results || []) {
    const claimed = await env.DB.prepare(
      `UPDATE social_publications
       SET queued_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND status = 'queued' AND updated_at = ?
       RETURNING id`,
    )
      .bind(row.id, row.updated_at)
      .first<{ id: string }>();
    if (!claimed) {
      skipped += 1;
      continue;
    }
    try {
      await resumeQueuedPublicationHandoff(
        env,
        { id: row.id, status: "queued", queuedAt: null },
        fetcher,
      );
      const publication = await getQueuedPublicationRow(env, row.id);
      if (publication) {
        await insertSocialPublicationEvent(env, {
          publicationId: row.id,
          variantId: publication.variant_id,
          eventType: "queued",
          payload: { dispatch: "stranded_queue_recovery" },
        });
      }
      requeued += 1;
    } catch {
      skipped += 1;
    }
  }
  return { requeued, skipped };
}

/** A post went live on its platform; fired once per Publication. */
export type SocialPublishedEvent = {
  userId: string;
  publicationId: string;
  variantId: string;
  platform: SocialPlatform;
  platformLabel: string;
  title: string | null;
  platformPostUrl: string | null;
};

/** Lets the host record what the plugin did without the plugin knowing about host tables. */
export type SocialPublishHooks = {
  onPublished?(event: SocialPublishedEvent): Promise<void>;
};

export async function processSocialPublishBatch(
  batch: {
    queue?: string;
    messages: ReadonlyArray<{
      body: SocialPublishQueueMessage;
      ack(): void;
      retry(options?: { delaySeconds?: number }): void;
    }>;
  },
  env: SocialPublishingEnv,
  hooks: SocialPublishHooks = {},
): Promise<void> {
  const isDeadLetterBatch =
    batch.queue === SOCIAL_PUBLISH_DLQ_NAME || Boolean(batch.queue?.includes("dlq"));
  for (const message of batch.messages) {
    try {
      if (isDeadLetterBatch) {
        await markSocialPublishQueueMessageDeadLettered(env, message.body);
        message.ack();
        continue;
      }
      await publishQueuedPublication(
        env,
        message.body.publicationId,
        fetchWithGlobalContext,
        hooks,
      );
      message.ack();
    } catch (error) {
      if (isDeadLetterBatch) {
        console.error(
          "social publish dead-letter handling failed",
          message.body.publicationId,
        );
        message.ack();
        continue;
      }
      if (error instanceof SocialPublishRetrySignal) {
        message.retry({ delaySeconds: error.delaySeconds });
        continue;
      }
      console.error("social publish job failed", message.body.publicationId, error);
      try {
        const recovery = await recoverUnexpectedSocialPublishFailure(env, message.body);
        if (recovery.retryDelaySeconds !== null) {
          message.retry({ delaySeconds: recovery.retryDelaySeconds });
        } else {
          message.ack();
        }
      } catch (recoveryError) {
        console.error(
          "social publish failure recovery failed",
          message.body.publicationId,
          recoveryError,
        );
        message.retry({ delaySeconds: SOCIAL_PUBLISHING_LEASE_RETRY_SECONDS });
      }
    }
  }
}

async function recoverUnexpectedSocialPublishFailure(
  env: SocialPublishingEnv,
  message: SocialPublishQueueMessage,
): Promise<{ retryDelaySeconds: number | null }> {
  const publicationId = normalizeId(message.publicationId);
  if (!publicationId) return { retryDelaySeconds: null };
  const row = await getQueuedPublicationRow(env, publicationId);
  if (!row) return { retryDelaySeconds: null };
  if (row.pub_status !== "queued" && row.pub_status !== "publishing") {
    return { retryDelaySeconds: null };
  }
  if (
    row.pub_status === "publishing" &&
    parseFailureClass(row.pub_error_code) === "outcome_unknown"
  ) {
    return { retryDelaySeconds: null };
  }

  const attempt = await publicationAttemptNumber(env, publicationId);
  const hostedXConnection =
    row.platform === "x" &&
    parseJsonObject(row.account_metadata_json).credentialSource === "hosted_oauth";
  if (hostedXConnection && isManagedDeployment(env)) {
    await releaseManagedXUsageForPublication(
      env,
      row.platform,
      managedXReservationIdForAttempt(row.publication_id, attempt),
      fetchWithGlobalContext,
    );
  }
  const code = "retryable:unexpected_pre_provider_failure";
  const errorMessage =
    "ME3 hit an unexpected failure before the provider publishing request started. It is safe to retry.";
  if (attempt >= 3) {
    await failContentPublication(
      env,
      row,
      code,
      errorMessage,
      row.pub_status,
    );
    return { retryDelaySeconds: null };
  }

  const delaySeconds = attempt === 1 ? 60 : 300;
  const retriedAt = new Date().toISOString();
  const auditEventId = randomToken("socevt");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE social_publications
       SET status = 'queued', error_code = ?, error_message = ?,
           provider_response_json = NULL, updated_at = ?
       WHERE id = ? AND status = ?
         AND updated_at = ?
         AND (
           error_code IS NULL
           OR (
             error_code <> 'outcome_unknown'
             AND error_code NOT LIKE 'outcome_unknown:%'
           )
         )`,
    ).bind(
      code,
      errorMessage,
      retriedAt,
      row.publication_id,
      row.pub_status,
      row.pub_updated_at,
    ),
    env.DB.prepare(
      `INSERT INTO social_publication_events (
         id, publication_id, variant_id, event_type, payload_json, created_at
       )
       SELECT ?, ?, ?, 'retried', ?, ?
       WHERE changes() > 0`,
    ).bind(
      auditEventId,
      row.publication_id,
      row.variant_id,
      JSON.stringify({
        attempt,
        nextAttempt: attempt + 1,
        delaySeconds,
        phase: "before_provider_write",
        code,
      }),
      retriedAt,
    ),
  ]);
  const auditEvent = await env.DB.prepare(
    `SELECT id FROM social_publication_events
     WHERE id = ? AND publication_id = ? AND event_type = 'retried'`,
  )
    .bind(auditEventId, row.publication_id)
    .first<{ id: string }>();
  return { retryDelaySeconds: auditEvent ? delaySeconds : null };
}

export async function markSocialPublishQueueMessageDeadLettered(
  env: SocialPublishingEnv,
  message: SocialPublishQueueMessage,
): Promise<boolean> {
  const publicationId = normalizeId(message.publicationId);
  if (!publicationId) return false;
  const row = await getQueuedPublicationRow(env, publicationId);
  if (!row || (row.pub_status !== "queued" && row.pub_status !== "publishing")) {
    return false;
  }
  const failed = await failContentPublication(
    env,
    row,
    "retryable:queue_dead_lettered",
    "Social publishing stopped after the queue exhausted its delivery attempts.",
    row.pub_status,
  );
  if (
    failed &&
    row.platform === "x" &&
    parseJsonObject(row.account_metadata_json).credentialSource === "hosted_oauth" &&
    isManagedDeployment(env)
  ) {
    const attempt = await publicationAttemptNumber(env, row.publication_id);
    await releaseManagedXUsageForPublication(
      env,
      row.platform,
      managedXReservationIdForAttempt(row.publication_id, attempt),
      fetchWithGlobalContext,
    );
  }
  return failed;
}

export async function publishQueuedPublication(
  env: SocialPublishingEnv,
  publicationIdInput: unknown,
  fetcher: typeof fetch = fetchWithGlobalContext,
  hooks: SocialPublishHooks = {},
): Promise<void> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  const publicationId = normalizeId(publicationIdInput);
  if (!publicationId) throw new SocialPublishingInputError("publicationId is required");

  const row = await getQueuedPublicationRow(env, publicationId);
  if (!row) return;
  const hostedXConnection =
    row.platform === "x" &&
    parseJsonObject(row.account_metadata_json).credentialSource === "hosted_oauth";
  if (
    row.platform === "x" &&
    !hostedXConnection &&
    isManagedDeployment(env)
  ) {
    await releaseManagedXUsageForPublication(
      env,
      row.platform,
      row.publication_id,
      fetcher,
    );
  }
  let managedXReservationId = row.publication_id;
  const releaseManagedReservation = async () => {
    if (!hostedXConnection || !isManagedDeployment(env)) return;
    await releaseManagedXUsageForPublication(
      env,
      row.platform,
      managedXReservationId,
      fetcher,
    );
  };
  if (
    row.pub_status === "scheduled" ||
    row.pub_status === "published" ||
    row.pub_status === "cancelled" ||
    row.pub_status === "failed"
  ) return;
  if (row.pub_status === "publishing") {
    const stale = isStalePublishingTimestamp(row.pub_updated_at);
    if (parseFailureClass(row.pub_error_code) === "outcome_unknown") {
      if (stale) {
        await failContentPublication(
          env,
          row,
          "outcome_unknown:delivery_interrupted",
          "A previous publishing attempt did not finish cleanly. Check the provider before retrying.",
          "publishing",
          undefined,
          true,
        );
      }
      return;
    }
    if (!stale) {
      throw new SocialPublishRetrySignal(SOCIAL_PUBLISHING_LEASE_RETRY_SECONDS);
    }
    const recovery = await recoverUnexpectedSocialPublishFailure(env, {
      publicationId: row.publication_id,
    });
    if (recovery.retryDelaySeconds !== null) {
      throw new SocialPublishRetrySignal(recovery.retryDelaySeconds);
    }
    return;
  }

  if (!gate.ready) {
    await failContentPublication(env, row, gate.status, gateErrorMessage(gate), "queued");
    await releaseManagedReservation();
    return;
  }

  if (hostedXConnection && !isManagedDeployment(env)) {
    await failContentPublication(
      env,
      row,
      "managed_x_unavailable",
      "ME3-managed X publishing is available only with managed hosting.",
      "queued",
    );
    return;
  }

  if (row.approved_by_human !== 1) {
    await failContentPublication(
      env,
      row,
      "not_approved",
      "The exact Post Version must be approved before publishing.",
      "queued",
    );
    await releaseManagedReservation();
    return;
  }

  if (!row.account_id || !row.platform_account_id || !row.access_token_ciphertext) {
    await failContentPublication(
      env,
      row,
      "reconnect_required:no_account",
      `Connect ${platformLabel(row.platform)} before publishing.`,
      "queued",
    );
    await releaseManagedReservation();
    return;
  }

  if (row.account_status !== "active" && row.account_status !== "expired") {
    await failContentPublication(
      env,
      row,
      "reconnect_required:account_not_ready",
      `${platformLabel(row.platform)} connection is not ready.`,
      "queued",
    );
    await releaseManagedReservation();
    return;
  }

  const claimedAt = new Date().toISOString();
  const resumeProviderResponse = row.pub_provider_response_json
    ? parseJsonObject(row.pub_provider_response_json)
    : undefined;
  const claim = await env.DB.prepare(
    `UPDATE social_publications
     SET status = 'publishing', error_code = NULL, error_message = NULL,
         updated_at = ?
     WHERE id = ? AND status = 'queued'
     RETURNING id, updated_at`,
  )
    .bind(claimedAt, row.publication_id)
    .first<{ id: string; updated_at: string }>();
  if (!claim) return;

  const accessToken = await resolvePublishingAccessToken(env, row, fetcher);
  if (!accessToken) {
    await env.DB.prepare(
      "UPDATE social_accounts SET status = 'expired', updated_at = datetime('now') WHERE id = ?",
    )
      .bind(row.account_id)
      .run();
    await failContentPublication(
      env,
      row,
      "reconnect_required:token_expired",
      `Reconnect ${platformLabel(row.platform)} before publishing.`,
      "publishing",
    );
    await releaseManagedReservation();
    return;
  }

  const manifestAssets = absolutizeContentAssets(
    env,
    normalizeMediaManifest(parseJsonArray(row.media_manifest_json)),
  );
  const adapter = adapterFor(row.platform);
  const validation = adapter.validateDraft({
    title: row.title,
    bodyText: row.body,
    assets: manifestAssets,
  });
  if (!validation.ok) {
    const failureClass = validation.error.includes("currently supports")
      ? "unsupported"
      : "rejected";
    const failed = await failContentPublication(
      env,
      row,
      `${failureClass}:validation_failed`,
      validation.error,
      "publishing",
    );
    if (failed) await revokeSocialVariantApproval(env, row.variant_id);
    await releaseManagedReservation();
    return;
  }

  let assets: ContentMediaAsset[];
  try {
    assets = await resolveProviderMediaAssets(env, {
      publicationId: row.publication_id,
      ownerId: row.user_id,
      platform: row.platform,
      assets: manifestAssets,
    });
  } catch (error) {
    const setupFailure = error instanceof SocialMediaDeliverySetupError;
    const failed = await failContentPublication(
      env,
      row,
      setupFailure
        ? "retryable:media_delivery_setup"
        : "rejected:media_unavailable",
      error instanceof Error ? error.message : "Attached media is unavailable.",
      "publishing",
    );
    if (failed && !setupFailure) await revokeSocialVariantApproval(env, row.variant_id);
    await releaseManagedReservation();
    return;
  }

  const attempt = await publicationAttemptNumber(env, row.publication_id);
  managedXReservationId = managedXReservationIdForAttempt(
    row.publication_id,
    attempt,
  );
  let managedXReservation: ManagedXUsageReservation = {
    managed: false,
    warning: null,
  };
  try {
    managedXReservation = await reserveManagedXUsageForPublication(
      env,
      row.user_id,
      row.publication_id,
      null,
      fetcher,
      managedXReservationId,
    );
  } catch (error) {
    if (error instanceof SocialPublishingInputError && error.status === 429) {
      await failContentPublication(
        env,
        row,
        "allowance_exhausted",
        error.message,
        "publishing",
      );
      return;
    }
    throw error;
  }

  const publishingEventId = randomToken("socevt");
  const publishingEvent = await env.DB.prepare(
    `INSERT INTO social_publication_events (
       id, publication_id, variant_id, event_type, payload_json, created_at
     )
     SELECT ?, ?, ?, 'publishing', ?, ?
     WHERE EXISTS (
       SELECT 1 FROM social_publications publication
       WHERE publication.id = ? AND publication.status = 'publishing'
         AND (
           publication.error_code IS NULL
           OR (
             publication.error_code <> 'outcome_unknown'
             AND publication.error_code NOT LIKE 'outcome_unknown:%'
           )
         )
     )
     RETURNING id`,
  )
    .bind(
      publishingEventId,
      row.publication_id,
      row.variant_id,
      JSON.stringify({ platform: row.platform, contentItemId: row.variant_id, attempt }),
      new Date().toISOString(),
      row.publication_id,
    )
    .first<{ id: string }>();
  if (!publishingEvent) {
    if (managedXReservation.managed) await releaseManagedReservation();
    return;
  }

  let managedXCostStarted = false;
  let result: import("./adapters").SocialPublishAdapterResult;
  try {
    const requestContext = parseJsonObject(row.pub_request_context_json);
    result = await adapter.publish({
      accessToken,
      accountId: row.platform_account_id,
      title: row.title,
      bodyText: row.body,
      assets,
      fetcher,
      providerOptions:
        row.platform === "tiktok"
          ? requestContext.tiktok
          : row.platform === "youtube"
            ? requestContext.youtube
            : undefined,
      resumeProviderResponse,
      markProviderCostStarted: managedXReservation.managed
        ? async () => {
            if (managedXCostStarted) return;
            await settleManagedXUsage(
              env,
              managedXReservationId,
              "consume",
              fetcher,
            );
            managedXCostStarted = true;
          }
        : undefined,
      markProviderWriteStarted: () =>
        markSocialProviderWriteStarted(
          env,
          row,
          claim.updated_at,
          resumeProviderResponse,
        ),
    });
  } catch (error) {
    if (managedXReservation.managed && !managedXCostStarted) {
      await releaseManagedReservation();
    }
    throw error;
  }

  if (!result.ok) {
    if (managedXReservation.managed && !managedXCostStarted) {
      await releaseManagedReservation();
    }
    const failureClass = result.failureClass || "rejected";
    if (failureClass === "retryable" && env.SOCIAL_PUBLISH_QUEUE && attempt < 3) {
      const delaySeconds = attempt === 1 ? 60 : 300;
      const retriedAt = new Date().toISOString();
      const auditEventId = randomToken("socevt");
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE social_publications
           SET status = 'queued', error_code = ?, error_message = ?,
               provider_response_json = ?, updated_at = ?
           WHERE id = ? AND status = 'publishing'`,
        ).bind(
          `retryable:${result.errorCode || "provider_failed"}`,
          result.errorMessage || "Social provider publish failed.",
          result.providerResponse === undefined ? null : JSON.stringify(result.providerResponse),
          retriedAt,
          row.publication_id,
        ),
        env.DB.prepare(
          `INSERT INTO social_publication_events (
             id, publication_id, variant_id, event_type, payload_json, created_at
           )
           SELECT ?, ?, ?, 'retried', ?, ?
           WHERE changes() > 0`,
        ).bind(
          auditEventId,
          row.publication_id,
          row.variant_id,
          JSON.stringify({ attempt, nextAttempt: attempt + 1, delaySeconds }),
          retriedAt,
        ),
      ]);
      const auditEvent = await env.DB.prepare(
        `SELECT id FROM social_publication_events
         WHERE id = ? AND publication_id = ? AND event_type = 'retried'`,
      )
        .bind(auditEventId, row.publication_id)
        .first<{ id: string }>();
      if (!auditEvent) return;
      throw new SocialPublishRetrySignal(delaySeconds);
    }
    const failed = await failContentPublication(
      env,
      row,
      `${failureClass}:${result.errorCode || "provider_failed"}`,
      result.errorMessage || "Social provider publish failed.",
      "publishing",
      result.providerResponse,
      failureClass === "outcome_unknown",
    );
    if (failed && (failureClass === "rejected" || failureClass === "unsupported")) {
      await revokeSocialVariantApproval(env, row.variant_id);
    }
    if (failed && failureClass === "reconnect_required" && row.account_id) {
      await env.DB.prepare(
        "UPDATE social_accounts SET status = 'expired', updated_at = datetime('now') WHERE id = ?",
      )
        .bind(row.account_id)
        .run();
    }
    return;
  }

  const publishedAt = new Date().toISOString();
  const auditEventId = randomToken("socevt");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE social_publications
       SET status = 'published',
           platform_post_id = ?,
           platform_post_url = ?,
           provider_response_json = ?,
           published_at = ?,
           error_code = NULL,
           error_message = NULL,
           updated_at = ?
       WHERE id = ? AND status = 'publishing'`,
    ).bind(
      result.platformPostId || null,
      result.platformPostUrl || null,
      result.providerResponse !== undefined ? JSON.stringify(result.providerResponse) : null,
      publishedAt,
      publishedAt,
      row.publication_id,
    ),
    env.DB.prepare(
      `INSERT INTO social_publication_events (
         id, publication_id, variant_id, event_type, payload_json, created_at
       )
       SELECT ?, ?, ?, 'published', ?, ?
       WHERE changes() > 0`,
    ).bind(
      auditEventId,
      row.publication_id,
      row.variant_id,
      JSON.stringify({
        platform: row.platform,
        contentItemId: row.variant_id,
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
      }),
      publishedAt,
    ),
  ]);
  const auditEvent = await env.DB.prepare(
    `SELECT id FROM social_publication_events
     WHERE id = ? AND publication_id = ? AND event_type = 'published'`,
  )
    .bind(auditEventId, row.publication_id)
    .first<{ id: string }>();
  if (!auditEvent) return;
  if (assets.some((asset) => asset.fileId)) {
    await revokeProviderMediaGrants(env, row.publication_id);
  }
  await syncContentItemStatusFromPublications(env, row.variant_id);
  try {
    await hooks.onPublished?.({
      userId: row.user_id,
      publicationId: row.publication_id,
      variantId: row.variant_id,
      platform: row.platform,
      platformLabel: platformLabel(row.platform),
      title: row.title?.trim() || null,
      platformPostUrl: result.platformPostUrl || null,
    });
  } catch (error) {
    // The post is live; a host hook failure must not retry the publish.
    console.warn("social publish hook failed", row.publication_id, error);
  }
}

async function publicationAttemptNumber(
  env: SocialPublishingEnv,
  publicationId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM social_publication_events
     WHERE publication_id = ? AND event_type = 'retried'`,
  )
    .bind(publicationId)
    .first<{ count: number }>();
  return Number(row?.count || 0) + 1;
}

async function markSocialProviderWriteStarted(
  env: SocialPublishingEnv,
  row: Pick<SocialPublicationRow, "publication_id">,
  expectedUpdatedAt: string,
  resumeProviderResponse?: unknown,
): Promise<void> {
  const marked = await env.DB.prepare(
    `UPDATE social_publications
     SET error_code = 'outcome_unknown:provider_write_started',
         error_message = ?,
         provider_response_json = COALESCE(?, provider_response_json),
         updated_at = datetime('now')
     WHERE id = ? AND status = 'publishing'
       AND updated_at = ?
       AND (
         error_code IS NULL
         OR (
           error_code <> 'outcome_unknown'
           AND error_code NOT LIKE 'outcome_unknown:%'
         )
       )
     RETURNING id`,
  )
    .bind(
      "The provider publishing request started, but ME3 has not recorded a final outcome. Check the provider before trying again.",
      resumeProviderResponse === undefined
        ? null
        : JSON.stringify(resumeProviderResponse),
      row.publication_id,
      expectedUpdatedAt,
    )
    .first<{ id: string }>();
  if (!marked) {
    throw new Error("Social Publication claim changed before provider delivery");
  }
}

async function reorderContentQueue(
  env: SocialPublishingEnv,
  ownerId: string,
  siteIdInput: unknown,
  itemIdsInput: unknown,
): Promise<ContentItem[]> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const siteId = normalizeId(siteIdInput);
  if (!siteId) throw new SocialPublishingInputError("siteId is required");
  const site = await getOwnedSite(env, ownerId, siteId);
  if (!site) throw new SocialPublishingInputError("Site not found", 404);
  const itemIds = Array.isArray(itemIdsInput)
    ? Array.from(
        new Set(
          itemIdsInput
            .map(normalizeId)
            .filter((id): id is string => Boolean(id)),
        ),
      )
    : [];
  if (itemIds.length === 0) throw new SocialPublishingInputError("Queue order is required");

  const rows = await listQueueRows(env, ownerId, site.id);
  const currentIds = rows.map((row) => row.id);
  if (
    itemIds.length !== currentIds.length ||
    itemIds.some((id) => !currentIds.includes(id))
  ) {
    throw new SocialPublishingInputError("Queue order does not match current queue");
  }

  await resequenceContentQueue(env, ownerId, site.id, itemIds);
  return listContentItems(env, ownerId, site.id, null);
}

function createGate(
  status: SocialPublishingRuntimeStatus,
  enabled: boolean,
): SocialPublishingGate {
  return {
    pluginId: SOCIAL_PUBLISHING_PLUGIN_ID,
    status,
    enabled,
    ready: status === "installed" && enabled,
    statusLabel: statusToLabel(status),
    platformCapabilities: getSocialPlatformCapabilities(),
  };
}

function statusToLabel(status: SocialPublishingRuntimeStatus): string {
  switch (status) {
    case "installed":
      return "Installed";
    case "setup_required":
      return "Setup required";
    case "disabled":
      return "Disabled";
    default:
      return "Available";
  }
}

async function listProviderSettingRows(
  env: SocialPublishingEnv,
  ownerId: string,
): Promise<Map<SocialPlatform, SocialProviderSettingRow>> {
  const rows = await env.DB.prepare(
    `SELECT user_id, provider_id, client_id, encrypted_client_secret, secret_hint,
            secret_updated_at, enabled, created_at, updated_at
     FROM social_provider_settings
     WHERE user_id = ?`,
  )
    .bind(ownerId)
    .all<SocialProviderSettingRow>();

  return new Map(
    (rows.results || [])
      .map((row) => [normalizePlatform(row.provider_id), row] as const)
      .filter((entry): entry is [SocialPlatform, SocialProviderSettingRow] => Boolean(entry[0])),
  );
}

async function getProviderSettingRow(
  env: SocialPublishingEnv,
  ownerId: string,
  platform: SocialPlatform,
): Promise<SocialProviderSettingRow | null> {
  return env.DB.prepare(
    `SELECT user_id, provider_id, client_id, encrypted_client_secret, secret_hint,
            secret_updated_at, enabled, created_at, updated_at
     FROM social_provider_settings
     WHERE user_id = ? AND provider_id = ?`,
  )
    .bind(ownerId, platform)
    .first<SocialProviderSettingRow>();
}

function serializeProviderSetting(
  platform: SocialPlatform,
  row: SocialProviderSettingRow | null,
): SocialProviderSetting {
  const configured = Boolean(row?.client_id && row.encrypted_client_secret);
  return {
    providerId: platform,
    label: platformLabel(platform),
    clientId: row?.client_id || "",
    configured,
    enabled: configured && row?.enabled !== 0,
    secretHint: row?.secret_hint || null,
    secretUpdatedAt: row?.secret_updated_at || null,
    callbackPath: `/api/social/${platform}/callback`,
  };
}

async function buildAuthorizeUrl(
  platform: SocialPlatform,
  clientId: string,
  state: string,
  codeVerifier: string | null,
  apiOrigin: string,
): Promise<string> {
  if (platform === "youtube" || platform === "tiktok") {
    throw new SocialPublishingInputError(
      `${platformLabel(platform)} connects securely through ME3 Cloud`,
      424,
    );
  }
  const redirectUri = `${apiOrigin.replace(/\/$/, "")}/api/social/${platform}/callback`;
  if (platform === "x") {
    if (!codeVerifier) throw new SocialPublishingInputError("X OAuth verifier is missing");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: ["tweet.read", "tweet.write", "media.write", "users.read", "offline.access"].join(" "),
      state,
      code_challenge: await pkceChallenge(codeVerifier),
      code_challenge_method: "S256",
    });
    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  if (platform === "linkedin") {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: ["openid", "profile", "w_member_social"].join(" "),
      state,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  if (platform === "instagram") {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: ["instagram_business_basic", "instagram_business_content_publish"].join(","),
      state,
    });
    return `https://api.instagram.com/oauth/authorize?${params.toString()}`;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "pages_show_list",
      "pages_read_engagement",
      "business_management",
      "instagram_basic",
      "instagram_content_publish",
    ].join(","),
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

async function exchangeOAuthCode(
  platform: SocialPlatform,
  code: string,
  clientId: string,
  clientSecret: string,
  codeVerifier: string | null,
  options: SocialCallbackOptions,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string[] }> {
  if (platform === "youtube" || platform === "tiktok") {
    throw new SocialPublishingInputError(
      `${platformLabel(platform)} OAuth must complete through ME3 Cloud`,
      424,
    );
  }
  const redirectUri = `${options.apiOrigin.replace(/\/$/, "")}/api/social/${platform}/callback`;
  if (platform === "x") {
    const response = await options.fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier || "",
      }),
    });
    const body = await readJsonResponse<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
    return normalizeToken(body, ["tweet.read", "tweet.write", "media.write", "users.read", "offline.access"]);
  }

  if (platform === "linkedin") {
    const response = await options.fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const body = await readJsonResponse<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
    return normalizeToken(body, ["openid", "profile", "w_member_social"]);
  }

  const tokenUrl =
    platform === "instagram"
      ? "https://api.instagram.com/oauth/access_token"
      : "https://graph.facebook.com/v21.0/oauth/access_token";
  const response = await options.fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const body = await readJsonResponse<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
  if (platform === "instagram") {
    if (!body.access_token) {
      throw new SocialPublishingInputError("Social token response was invalid", 502);
    }
    const longLivedResponse = await options.fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: clientSecret,
        access_token: body.access_token,
      }).toString()}`,
    );
    const longLived = await readJsonResponse<{ access_token?: string; expires_in?: number }>(
      longLivedResponse,
    );
    if (!longLived.access_token) {
      throw new SocialPublishingInputError("Instagram long-lived token response was invalid", 502);
    }
    return {
      accessToken: longLived.access_token,
      refreshToken: longLived.access_token,
      expiresAt: longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
        : null,
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    };
  }
  return normalizeToken(
    body,
    [
      "pages_show_list",
      "pages_read_engagement",
      "business_management",
      "instagram_basic",
      "instagram_content_publish",
    ],
  );
}

async function fetchSocialProfile(
  platform: SocialPlatform,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<{
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken?: string;
}> {
  if (platform === "youtube" || platform === "tiktok") {
    throw new SocialPublishingInputError(
      `${platformLabel(platform)} profiles are resolved through ME3 Cloud`,
      424,
    );
  }
  if (platform === "x") {
    const response = await fetcher("https://api.twitter.com/2/users/me?user.fields=username,name,profile_image_url", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await readJsonResponse<{
      data?: { id?: string; username?: string; name?: string; profile_image_url?: string };
    }>(response);
    if (!body.data?.id) throw new SocialPublishingInputError("Social profile response was invalid", 502);
    return {
      id: body.data.id,
      handle: body.data.username || null,
      displayName: body.data.name || null,
      avatarUrl: normalizeAvatarUrl(body.data.profile_image_url),
    };
  }

  if (platform === "linkedin") {
    const response = await fetcher("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await readJsonResponse<{
      sub?: string;
      name?: string;
      given_name?: string;
      picture?: string;
    }>(response);
    if (!body.sub) throw new SocialPublishingInputError("Social profile response was invalid", 502);
    return {
      id: body.sub,
      handle: null,
      displayName: body.name || body.given_name || null,
      avatarUrl: normalizeAvatarUrl(body.picture),
    };
  }

  if (platform === "instagram_business") {
    const response = await fetcher(
      "https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const body = await readJsonResponse<{
      data?: Array<{
        access_token?: string;
        instagram_business_account?: {
          id?: string;
          username?: string;
          name?: string;
          profile_picture_url?: string;
        };
      }>;
    }>(response);
    const page = body.data?.find(
      (item) => item.access_token && item.instagram_business_account?.id,
    );
    const account = page?.instagram_business_account;
    if (!page?.access_token || !account?.id) {
      throw new SocialPublishingInputError(
        "No Instagram professional account is connected to an accessible Facebook Page",
        424,
      );
    }
    return {
      id: account.id,
      handle: account.username || null,
      displayName: account.name || account.username || null,
      avatarUrl: normalizeAvatarUrl(account.profile_picture_url),
      accessToken: page.access_token,
    };
  }

  const response = await fetcher(
    `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/me?${new URLSearchParams({
      fields: "user_id,username,profile_picture_url",
      access_token: accessToken,
    })}`,
  );
  const body = await readJsonResponse<{
    user_id?: string;
    username?: string;
    profile_picture_url?: string;
    data?: Array<{
      user_id?: string;
      username?: string;
      profile_picture_url?: string;
    }>;
  }>(response);
  const profile = body.data?.[0] || body;
  if (!profile.user_id) {
    throw new SocialPublishingInputError("Social profile response was invalid", 502);
  }
  return {
    id: profile.user_id,
    handle: profile.username || null,
    displayName: profile.username || null,
    avatarUrl: normalizeAvatarUrl(profile.profile_picture_url),
  };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new SocialPublishingInputError("Social provider request failed", 502);
  }
  return response.json() as Promise<T>;
}

function normalizeToken(
  body: { access_token?: string; refresh_token?: string; expires_in?: number },
  scopes: string[],
): { accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string[] } {
  if (!body.access_token) throw new SocialPublishingInputError("Social token response was invalid", 502);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    scopes,
  };
}

async function getOwnedSite(
  env: SocialPublishingEnv,
  ownerId: string,
  siteId: string,
): Promise<Required<Pick<SiteRow, "id" | "user_id" | "username">> | null> {
  return env.DB.prepare("SELECT id, user_id, username FROM sites WHERE id = ? AND user_id = ?")
    .bind(siteId, ownerId)
    .first<Required<Pick<SiteRow, "id" | "user_id" | "username">>>();
}

async function listActiveAccountsByPlatform(
  env: SocialPublishingEnv,
  ownerId: string,
  siteId: string,
  platforms: SocialPlatform[],
): Promise<Map<SocialPlatform, SocialAccountRow>> {
  const rows = await env.DB.prepare(
    `SELECT id, site_id, platform, platform_account_id, platform_handle, display_name,
            status, scopes_json, last_verified_at, created_at, updated_at
     FROM social_accounts
     WHERE user_id = ?
       AND site_id = ?
       AND status = 'active'`,
  )
    .bind(ownerId, siteId)
    .all<SocialAccountRow>();
  const wanted = new Set(platforms);
  return new Map(
    (rows.results || [])
      .map((row) => [normalizePlatform(row.platform), row] as const)
      .filter((entry): entry is [SocialPlatform, SocialAccountRow] =>
        Boolean(entry[0] && wanted.has(entry[0])),
      ),
  );
}

async function getQueuedPublicationRow(
  env: SocialPublishingEnv,
  publicationId: string,
): Promise<SocialPublicationRow | null> {
  return env.DB.prepare(
    `SELECT pub.id AS publication_id,
            pub.variant_id,
            pub.site_id,
            pub.platform,
            pub.status AS pub_status,
            pub.scheduled_for,
            pub.updated_at AS pub_updated_at,
            pub.error_code AS pub_error_code,
            pub.provider_response_json AS pub_provider_response_json,
            pub.request_context_json AS pub_request_context_json,
            COALESCE(NULLIF(TRIM(v.title), ''), p.post_title_snapshot) AS title,
            pub.body_text_snapshot AS body,
            COALESCE(pub.asset_manifest_json_snapshot, '[]') AS media_manifest_json,
            '[]' AS platforms_json,
            CASE WHEN pub.approval_status_snapshot = 'approved' THEN 1 ELSE 0 END
              AS approved_by_human,
            s.user_id AS user_id,
            acct.id AS account_id,
            acct.platform_account_id,
            acct.access_token_ciphertext,
            acct.refresh_token_ciphertext,
            acct.token_expires_at,
            acct.status AS account_status,
            acct.metadata_json AS account_metadata_json
     FROM social_publications pub
     JOIN social_variants v ON v.id = pub.variant_id
     JOIN social_packages p ON p.id = v.package_id
     JOIN sites s ON s.id = p.site_id
     LEFT JOIN social_accounts acct
       ON acct.id = pub.target_account_id_snapshot
      AND acct.site_id = pub.site_id
      AND acct.platform = pub.platform
     WHERE pub.id = ?
     LIMIT 1`,
  )
    .bind(publicationId)
    .first<SocialPublicationRow>();
}

async function latestSocialVariantPublication(
  env: SocialPublishingEnv,
  variantId: string,
  statuses?: SocialVariantPublication["status"][],
): Promise<SocialVariantPublication | null> {
  const statusFilter = statuses?.length
    ? ` AND status IN (${statuses.map(() => "?").join(", ")})`
    : "";
  const row = await env.DB.prepare(
    `${publicationSelectSql()}
     WHERE pub.variant_id = ?${statusFilter}
     ORDER BY pub.created_at DESC
     LIMIT 1`,
  )
    .bind(variantId, ...(statuses || []))
    .first<PublicationRow>();
  if (!row) return null;
  const { versionId, ...publication } = serializePublication(row);
  return { ...publication, variantId: versionId };
}

function canonicalPublication(publication: SocialVariantPublication): Publication {
  const { variantId, ...rest } = publication;
  return { ...rest, versionId: variantId };
}

function publicationSelectSql(): string {
  return `SELECT pub.id, pub.variant_id, pub.platform, pub.status, pub.scheduled_for,
                 pub.timezone, pub.queued_at, pub.platform_post_id, pub.platform_post_url,
                 pub.published_at, pub.error_code, pub.error_message,
                 pub.requested_by_type, pub.requested_by_user_id,
                 pub.request_context_json, pub.created_at, pub.updated_at
          FROM social_publications pub`;
}

function serializePublication(row: PublicationRow): Publication {
  return {
    id: row.id,
    versionId: row.variant_id,
    platform: row.platform,
    status: row.status,
    scheduledFor: row.scheduled_for,
    timezone: row.timezone,
    queuedAt: row.queued_at,
    platformPostId: row.platform_post_id,
    platformPostUrl: row.platform_post_url,
    publishedAt: row.published_at,
    failureClass: parseFailureClass(row.error_code),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    requestedByType: row.requested_by_type,
    requestedByUserId: row.requested_by_user_id,
    requestContext: parseJsonObject(row.request_context_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOwnedPublication(
  env: SocialPublishingEnv,
  ownerId: string,
  publicationId: string,
): Promise<Publication | null> {
  const row = await env.DB.prepare(
    `${publicationSelectSql()}
     JOIN social_variants v ON v.id = pub.variant_id
     JOIN social_packages p ON p.id = v.package_id
     JOIN sites s ON s.id = p.site_id
     WHERE pub.id = ? AND s.user_id = ?
     LIMIT 1`,
  )
    .bind(publicationId, ownerId)
    .first<PublicationRow>();
  return row ? serializePublication(row) : null;
}

async function getPublicationScheduleGuardRow(
  env: SocialPublishingEnv,
  ownerId: string,
  publicationId: string,
): Promise<PublicationScheduleGuardRow | null> {
  return env.DB.prepare(
    `SELECT pub.id, pub.variant_id, pub.platform, pub.status, pub.scheduled_for,
            pub.timezone, pub.queued_at, pub.platform_post_id, pub.platform_post_url,
            pub.published_at, pub.error_code, pub.error_message,
            pub.requested_by_type, pub.requested_by_user_id,
            pub.request_context_json, pub.created_at, pub.updated_at,
            pub.approval_status_snapshot, version.approval_status AS current_approval_status,
            post.source_type AS post_source_type, account.status AS account_status
     FROM social_publications pub
     JOIN social_variants version ON version.id = pub.variant_id
     JOIN social_packages post ON post.id = version.package_id
     JOIN sites site ON site.id = post.site_id
     LEFT JOIN social_accounts account
       ON account.id = pub.target_account_id_snapshot
      AND account.user_id = site.user_id
      AND account.site_id = pub.site_id
      AND account.platform = pub.platform
     WHERE pub.id = ? AND site.user_id = ?
     LIMIT 1`,
  )
    .bind(publicationId, ownerId)
    .first<PublicationScheduleGuardRow>();
}

function assertPublicationCanBeRescheduled(
  publication: PublicationScheduleGuardRow,
): void {
  if (publication.status !== "scheduled" || !publication.scheduled_for) {
    throw new SocialPublishingInputError(
      "Only a planned Publication can be rescheduled",
      409,
    );
  }
  if (!canScheduleSocialPlatform(publication.platform)) {
    throw new SocialPublishingInputError(
      `${platformLabel(publication.platform)} Versions cannot be scheduled yet`,
      409,
    );
  }
  if (
    publication.approval_status_snapshot !== "approved" ||
    publication.current_approval_status !== "approved"
  ) {
    throw new SocialPublishingInputError(
      "Approve this exact Version before changing its schedule",
      409,
    );
  }
  if (publication.post_source_type === "legacy_content_bank_read_only") {
    throw new SocialPublishingInputError(
      "This imported Post is read-only. Create a source-backed Post before scheduling.",
      403,
    );
  }
  if (publication.account_status !== "active") {
    throw new SocialPublishingInputError(
      `Reconnect the selected ${platformLabel(publication.platform)} account before changing this schedule`,
      424,
    );
  }
}

async function findScheduledPublication(
  env: SocialPublishingEnv,
  versionId: string,
  scheduledFor: string,
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `SELECT id FROM social_publications
     WHERE variant_id = ? AND scheduled_for = ? AND status = 'scheduled'
     LIMIT 1`,
  )
    .bind(versionId, scheduledFor)
    .first<{ id: string }>();
}

async function findBlockingPostingReservation(
  env: SocialPublishingEnv,
  accountId: string | null,
  scheduledFor: string,
  ownReservationId: string | null,
): Promise<{ id: string } | null> {
  if (!accountId) return null;
  return env.DB.prepare(
    `SELECT id FROM social_posting_reservations
     WHERE account_id = ? AND status = 'reserved'
       AND (? IS NULL OR id <> ?)
       AND (scheduled_for = ? OR (? > range_start AND ? < range_end))
     LIMIT 1`,
  )
    .bind(
      accountId,
      ownReservationId,
      ownReservationId,
      scheduledFor,
      scheduledFor,
      scheduledFor,
    )
    .first<{ id: string }>();
}

async function findBlockingPostingReservationForPublication(
  env: SocialPublishingEnv,
  publicationId: string,
  scheduledFor: string,
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `SELECT reservation.id
     FROM social_publications publication
     JOIN social_posting_reservations reservation
       ON reservation.account_id = publication.target_account_id_snapshot
     WHERE publication.id = ? AND reservation.status = 'reserved'
       AND (
         reservation.scheduled_for = ?
         OR (? > reservation.range_start AND ? < reservation.range_end)
       )
     LIMIT 1`,
  )
    .bind(publicationId, scheduledFor, scheduledFor, scheduledFor)
    .first<{ id: string }>();
}

async function insertSocialPublicationEvent(
  env: SocialPublishingEnv,
  input: {
    publicationId: string | null;
    variantId: string;
    eventType: SocialPublicationEventType;
    payload?: unknown;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO social_publication_events (
       id, publication_id, variant_id, event_type, payload_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(
      randomToken("socevt"),
      input.publicationId,
      input.variantId,
      input.eventType,
      input.payload === undefined ? null : JSON.stringify(input.payload),
    )
    .run();
}

async function failContentPublication(
  env: SocialPublishingEnv,
  row: Pick<SocialPublicationRow, "publication_id" | "variant_id">,
  code: string,
  message: string,
  expectedStatus: "queued" | "publishing",
  providerResponse?: unknown,
  outcomeUnknown = false,
): Promise<boolean> {
  const failedAt = new Date().toISOString();
  const auditEventId = randomToken("socevt");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE social_publications
       SET status = ?,
           error_code = ?,
           error_message = ?,
           provider_response_json = ?,
           updated_at = ?
       WHERE id = ? AND status = ?`,
    ).bind(
      outcomeUnknown ? "publishing" : "failed",
      code,
      message,
      providerResponse === undefined ? null : JSON.stringify(providerResponse),
      failedAt,
      row.publication_id,
      expectedStatus,
    ),
    env.DB.prepare(
      `INSERT INTO social_publication_events (
         id, publication_id, variant_id, event_type, payload_json, created_at
       )
       SELECT ?, ?, ?, 'failed', ?, ?
       WHERE changes() > 0`,
    ).bind(
      auditEventId,
      row.publication_id,
      row.variant_id,
      JSON.stringify({ code, message }),
      failedAt,
    ),
  ]);
  const auditEvent = await env.DB.prepare(
    `SELECT id FROM social_publication_events
     WHERE id = ? AND publication_id = ? AND event_type = 'failed'`,
  )
    .bind(auditEventId, row.publication_id)
    .first<{ id: string }>();
  if (!auditEvent) return false;
  await syncContentItemStatusFromPublications(env, row.variant_id);
  return true;
}

function parseFailureClass(
  code: string | null,
): import("./adapters").SocialPublishFailureClass | null {
  const value = code?.split(":", 1)[0];
  return value === "retryable" ||
      value === "reconnect_required" ||
      value === "rejected" ||
      value === "unsupported" ||
      value === "outcome_unknown"
    ? value
    : null;
}

async function syncContentItemStatusFromPublications(
  env: SocialPublishingEnv,
  contentItemId: string,
): Promise<void> {
  const variant = await env.DB.prepare(
    "SELECT package_id FROM social_variants WHERE id = ?",
  )
    .bind(contentItemId)
    .first<{ package_id: string }>();
  if (variant) {
    await syncSocialVariantStatusFromPublications(env, contentItemId, variant.package_id);
    return;
  }

  const rows = await env.DB.prepare(
    `SELECT status, published_at
     FROM social_publications
     WHERE variant_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(contentItemId)
    .all<{ status: string; published_at: string | null }>();

  const publications = rows.results || [];
  if (publications.length === 0) return;
  const hasPending = publications.some(
    (row) => row.status === "queued" || row.status === "publishing",
  );
  const hasPublished = publications.some((row) => row.status === "published");
  const hasFailed = publications.some((row) => row.status === "failed");
  if (hasPending) return;

  if (hasPublished) {
    const latestPublishedAt =
      publications
        .map((row) => row.published_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null;
    await env.DB.prepare(
      `UPDATE content_bank_items
       SET status = 'posted',
           queue_position = NULL,
           scheduled_for = NULL,
           times_posted = times_posted + 1,
           last_posted_at = COALESCE(?, last_posted_at, datetime('now')),
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(latestPublishedAt, contentItemId)
      .run();
    return;
  }

  if (hasFailed) {
    await env.DB.prepare(
      `UPDATE content_bank_items
       SET status = 'failed',
           queue_position = NULL,
           scheduled_for = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(contentItemId)
      .run();
  }
}

async function syncSocialVariantStatusFromPublications(
  env: SocialPublishingEnv,
  variantId: string,
  packageId: string,
): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, status
     FROM social_publications
     WHERE variant_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(variantId)
    .all<{ id: string; status: string }>();
  const publications = rows.results || [];
  if (publications.some((row) => row.status === "queued" || row.status === "publishing")) return;

  const published = publications.find((row) => row.status === "published");
  if (published) {
    await env.DB.prepare(
      `UPDATE social_variants
       SET published_variant_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(published.id, variantId)
      .run();
    const counts = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM social_publications pub
                WHERE pub.variant_id = v.id AND pub.status = 'published'
              ) THEN 1 ELSE 0 END) AS published_count
       FROM social_variants v
       WHERE v.package_id = ?`,
    )
      .bind(packageId)
      .first<{ total: number; published_count: number }>();
    await env.DB.prepare(
      "UPDATE social_packages SET status = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(
        counts && counts.total > 0 && counts.published_count === counts.total
          ? "published"
          : "partially_published",
        packageId,
      )
      .run();
    return;
  }

  if (publications.some((row) => row.status === "failed")) {
    await env.DB.prepare(
      "UPDATE social_packages SET status = 'failed', updated_at = datetime('now') WHERE id = ?",
    )
      .bind(packageId)
      .run();
  }
}

function absolutizeContentAssets(
  env: SocialPublishingEnv,
  assets: ContentMediaAsset[],
): ContentMediaAsset[] {
  const origin = getPublicAssetOrigin(env);
  return assets.map((asset) => {
    if (!asset.url.startsWith("/") || !origin) return asset;
    return { ...asset, url: `${origin}${asset.url}` };
  });
}

async function resolveProviderMediaAssets(
  env: SocialPublishingEnv,
  input: {
    publicationId: string;
    ownerId: string;
    platform: SocialPlatform;
    assets: ContentMediaAsset[];
  },
): Promise<ContentMediaAsset[]> {
  assertPrivateMediaDeliveryReady(env, input.assets);
  const origin = getPublicAssetOrigin(env);

  const resolved: ContentMediaAsset[] = [];
  for (const asset of input.assets) {
    if (!asset.fileId) {
      resolved.push(asset);
      continue;
    }
    const file = await env.DB.prepare(
      `SELECT id, size, sha256
       FROM drive_files
       WHERE id = ? AND owner_id = ? AND status = 'ready'
       LIMIT 1`,
    )
      .bind(asset.fileId, input.ownerId)
      .first<{ id: string; size: number | string; sha256: string | null }>();
    if (!file) throw new SocialPublishingInputError("An attached Files item is no longer available.", 409);
    if (asset.byteLength !== undefined && Number(file.size) !== asset.byteLength) {
      throw new SocialPublishingInputError("An attached Files item changed after approval.", 409);
    }
    if (
      asset.contentHash &&
      file.sha256 &&
      asset.contentHash !== `sha256:${file.sha256.toLowerCase()}`
    ) {
      throw new SocialPublishingInputError("An attached Files item changed after approval.", 409);
    }

    const token = randomToken("socmedia");
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_media_delivery_grants
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE publication_id = ? AND file_id = ? AND provider = ? AND revoked_at IS NULL`,
      ).bind(input.publicationId, file.id, input.platform),
      env.DB.prepare(
        `INSERT INTO social_media_delivery_grants
           (id, publication_id, file_id, owner_id, provider, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        randomToken("socgrant"),
        input.publicationId,
        file.id,
        input.ownerId,
        input.platform,
        tokenHash,
        expiresAt,
      ),
    ]);
    resolved.push({
      ...asset,
      url: `${origin}/api/social/media/${encodeURIComponent(token)}`,
    });
  }
  return resolved;
}

function assertPrivateMediaDeliveryReady(
  env: SocialPublishingEnv,
  assets: ContentMediaAsset[],
): void {
  if (!assets.some((asset) => asset.fileId)) return;
  if (!getPublicAssetOrigin(env)) {
    throw new SocialMediaDeliverySetupError(
      "ME3 needs an exact public API origin before private Files media can be delivered.",
    );
  }
  if (!env.SITE_ASSETS) {
    throw new SocialMediaDeliverySetupError(
      "ME3 needs Files storage before private media can be delivered.",
    );
  }
}

async function revokeProviderMediaGrants(
  env: SocialPublishingEnv,
  publicationId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE social_media_delivery_grants
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
     WHERE publication_id = ? AND revoked_at IS NULL`,
  )
    .bind(publicationId)
    .run();
}

function getPublicAssetOrigin(env: SocialPublishingEnv): string | null {
  const origin =
    env.CORE_API_ORIGIN ||
    env.CORE_WEB_ORIGIN ||
    (env.ME3_API_HOST ? `https://${env.ME3_API_HOST}` : null) ||
    (env.ME3_CUSTOM_DOMAIN ? `https://${env.ME3_CUSTOM_DOMAIN}` : null);
  return origin ? origin.replace(/\/$/, "") : null;
}

function tokenLooksExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time < Date.now() + 60_000;
}

async function revokeSocialVariantApproval(
  env: SocialPublishingEnv,
  variantId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE social_variants
     SET approval_status = 'draft', approved_at = NULL, approved_by_user_id = NULL,
         scheduled_for = NULL, timezone = NULL, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(variantId)
    .run();
  const scheduled = await env.DB.prepare(
    `SELECT id, platform FROM social_publications
     WHERE variant_id = ? AND status = 'scheduled'`,
  )
    .bind(variantId)
    .all<{ id: string; platform: SocialPlatform }>();
  for (const publication of scheduled.results || []) {
    await env.DB.prepare(
      `UPDATE social_publications
       SET status = 'cancelled', error_code = 'cancelled:approval_revoked',
           error_message = 'Cancelled because Version approval was removed.',
           updated_at = datetime('now')
       WHERE id = ? AND status = 'scheduled'`,
    )
      .bind(publication.id)
      .run();
    await insertSocialPublicationEvent(env, {
      publicationId: publication.id,
      variantId,
      eventType: "cancelled",
      payload: { reason: "approval_revoked" },
    });
    await releaseManagedXUsageForPublication(
      env,
      publication.platform,
      publication.id,
      fetchWithGlobalContext,
    );
  }
}

async function resolvePublishingAccessToken(
  env: SocialPublishingEnv,
  row: PublishingAccessTokenRow,
  fetcher: typeof fetch,
): Promise<string | null> {
  if (!row.access_token_ciphertext) return null;
  const installKey = await resolveInstallKey(env);
  if (row.account_status === "active" && !tokenLooksExpired(row.token_expires_at)) {
    return decryptSecret(row.access_token_ciphertext, installKey);
  }
  if (!row.account_id || !row.refresh_token_ciphertext) return null;
  if (
    row.platform !== "linkedin" &&
    row.platform !== "x" &&
    row.platform !== "instagram" &&
    row.platform !== "youtube" &&
    row.platform !== "tiktok"
  ) {
    return null;
  }

  try {
    const refreshToken = await decryptSecret(row.refresh_token_ciphertext, installKey);
    const metadata = parseJsonObject(row.account_metadata_json);
    let token: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: string | null;
    } | null;
    if (metadata.credentialSource === "hosted_oauth") {
      token = await refreshHostedProviderToken(
        env,
        row.platform,
        refreshToken,
        fetcher,
      );
    } else if (row.platform === "youtube" || row.platform === "tiktok") {
      token = null;
    } else {
      const setting = await getProviderSettingRow(env, row.user_id, row.platform);
      token = setting?.enabled && setting.client_id && setting.encrypted_client_secret
        ? await refreshProviderToken(
            row.platform,
            refreshToken,
            setting.client_id,
            await decryptSecret(setting.encrypted_client_secret, installKey),
            fetcher,
          )
        : null;
    }
    if (!token) return null;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE social_accounts
       SET access_token_ciphertext = ?, refresh_token_ciphertext = ?, token_expires_at = ?,
           status = 'active', last_verified_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        await encryptSecret(token.accessToken, installKey),
        await encryptSecret(token.refreshToken || refreshToken, installKey),
        token.expiresAt,
        now,
        now,
        row.account_id,
      )
      .run();
    return token.accessToken;
  } catch {
    return null;
  }
}

async function refreshHostedProviderToken(
  env: SocialPublishingEnv,
  platform: "linkedin" | "x" | "instagram" | "youtube" | "tiktok",
  refreshToken: string,
  fetcher: typeof fetch,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null } | null> {
  const origin = await resolveHostedSocialOAuthOrigin(env);
  if (!origin) return null;
  const installationHeaders = await getHostedOAuthInstallationHeaders(env);
  if (!installationHeaders) return null;
  const response = await fetcher(`${origin}/api/social/oauth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...installationHeaders,
    },
    body: JSON.stringify({ platform, refreshToken }),
  });
  if (!response.ok) throw new Error(`Hosted token refresh failed (${response.status})`);
  const body = await response.json() as {
    accessToken?: string;
    refreshToken?: string | null;
    expiresAt?: string | null;
  };
  if (!body.accessToken) throw new Error("Hosted token refresh response was invalid");
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken || null,
    expiresAt: body.expiresAt || null,
  };
}

async function getHostedOAuthInstallationHeaders(
  env: SocialPublishingEnv,
): Promise<Record<string, string> | null> {
  const secretNames = [
    "ME3_CLOUD_OWNER_ID",
    "ME3_CORE_INSTALL_ID",
    "ME3_CLOUD_CORE_TOKEN",
  ] as const;
  const [ownerId, installId, installToken] = await Promise.all(
    secretNames.map(async (name) => {
      try {
        const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
          .bind(name)
          .first<{ value: string }>();
        return row?.value?.trim() || "";
      } catch {
        return "";
      }
    }),
  );
  if (!ownerId || !installId || !installToken) return null;
  return {
    "X-ME3-Core-Owner-ID": ownerId,
    "X-ME3-Core-Install-ID": installId,
    "X-ME3-Core-Update-Token": installToken,
  };
}

async function refreshProviderToken(
  platform: "linkedin" | "x" | "instagram",
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  fetcher: typeof fetch,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null }> {
  if (platform === "instagram") {
    const response = await fetcher(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: refreshToken,
      }).toString()}`,
    );
    if (!response.ok) throw new Error(`Instagram token refresh failed (${response.status})`);
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Instagram token refresh response was invalid");
    return {
      accessToken: body.access_token,
      refreshToken: body.access_token,
      expiresAt: body.expires_in
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : null,
    };
  }
  const response = await fetcher(
    platform === "linkedin"
      ? "https://www.linkedin.com/oauth/v2/accessToken"
      : "https://api.twitter.com/2/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(platform === "x"
          ? { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` }
          : {}),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        ...(platform === "linkedin"
          ? { client_id: clientId, client_secret: clientSecret }
          : {}),
      }),
    },
  );
  if (!response.ok) throw new Error(`Token refresh failed (${response.status})`);
  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("Token refresh response was invalid");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000).toISOString()
      : null,
  };
}

async function resolveInstallKey(env: SocialPublishingEnv): Promise<string> {
  if (env.TOKEN_ENCRYPTION_KEY) return env.TOKEN_ENCRYPTION_KEY;
  const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
    .bind("TOKEN_ENCRYPTION_KEY")
    .first<{ value: string }>();
  if (!row?.value) {
    throw new SocialPublishingInputError("Token encryption key is not configured", 424);
  }
  return row.value;
}

async function getOwnedContentItem(
  env: SocialPublishingEnv,
  ownerId: string,
  id: string,
): Promise<ContentItemRow | null> {
  return env.DB.prepare(
    `SELECT c.*, s.username AS site_username
     FROM content_bank_items c
     JOIN sites s ON s.id = c.site_id
     WHERE c.id = ? AND c.user_id = ?`,
  )
    .bind(id, ownerId)
    .first<ContentItemRow>();
}

async function listQueueRows(
  env: SocialPublishingEnv,
  ownerId: string,
  siteId: string,
): Promise<ContentQueueRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, status, queue_position
     FROM content_bank_items
     WHERE user_id = ?
       AND site_id = ?
       AND status IN ('queued', 'scheduled')
     ORDER BY COALESCE(queue_position, 2147483647), updated_at DESC`,
  )
    .bind(ownerId, siteId)
    .all<ContentQueueRow>();
  return rows.results || [];
}

async function resequenceContentQueue(
  env: SocialPublishingEnv,
  ownerId: string,
  siteId: string,
  orderedIds?: string[],
): Promise<void> {
  const rows = await listQueueRows(env, ownerId, siteId);
  const ids = orderedIds && orderedIds.length > 0 ? orderedIds : rows.map((row) => row.id);
  for (const [index, id] of ids.entries()) {
    await env.DB.prepare(
      `UPDATE content_bank_items
       SET queue_position = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND site_id = ?`,
    )
      .bind(index + 1, id, ownerId, siteId)
      .run();
  }
}

async function setContentQueueState(
  env: SocialPublishingEnv,
  ownerId: string,
  idInput: unknown,
  status: "bank" | "queued" | "publishing",
): Promise<ContentItem | null> {
  const gate = await getSocialPublishingRuntimeStatus(env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);

  const id = normalizeId(idInput);
  if (!id) throw new SocialPublishingInputError("Content item id is required");
  const existing = await getOwnedContentItem(env, ownerId, id);
  if (!existing) return null;
  if (existing.status === "publishing") {
    throw new SocialPublishingInputError("This item is already publishing");
  }

  let queuePosition: number | null = null;
  if (status === "queued") {
    const alreadyQueued = existing.status === "queued" || existing.status === "scheduled";
    const rows = await listQueueRows(env, ownerId, existing.site_id);
    queuePosition = alreadyQueued
      ? existing.queue_position || rows.length || 1
      : rows.length + 1;
  }

  await env.DB.prepare(
    `UPDATE content_bank_items
     SET status = ?,
         queue_position = ?,
         scheduled_for = NULL,
         approved_by_human = 1,
         updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(status, queuePosition, id, ownerId)
    .run();

  if (
    existing.status === "queued" ||
    existing.status === "scheduled" ||
    status === "queued"
  ) {
    await resequenceContentQueue(env, ownerId, existing.site_id);
  }

  const updated = await getOwnedContentItem(env, ownerId, id);
  return updated ? serializeContentItem(updated) : null;
}

function serializeContentItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    siteId: row.site_id,
    siteUsername: row.site_username,
    userId: row.user_id,
    body: row.body,
    mediaManifest: normalizeMediaManifest(parseJsonArray(row.media_manifest_json)),
    platforms: normalizeContentPlatforms(parseJsonArray(row.platforms_json)),
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    status: row.status,
    queuePosition: row.queue_position,
    scheduledFor: row.scheduled_for,
    timezone: row.timezone,
    createdBy: row.created_by,
    approvedByHuman: row.approved_by_human === 1,
    evergreen: row.evergreen === 1,
    timesPosted: row.times_posted,
    lastPostedAt: row.last_posted_at,
    cooldownDays: row.cooldown_days,
    tags: normalizeTags(parseJsonArray(row.tags_json)),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeContentStatus(value: unknown): ContentItemStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return [
    "bank",
    "queued",
    "scheduled",
    "publishing",
    "posted",
    "failed",
    "archived",
  ].includes(normalized)
    ? (normalized as ContentItemStatus)
    : null;
}

function normalizeContentPlatforms(value: unknown): ContentPlatform[] {
  if (!Array.isArray(value)) return [];
  const platforms = value
    .map(normalizePlatform)
    .filter((platform): platform is ContentPlatform => Boolean(platform));
  return Array.from(new Set(platforms));
}

function normalizeBody(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSocialMediaAssets(value: unknown): SocialMediaAsset[] {
  if (!Array.isArray(value)) return [];
  const assets: SocialMediaAsset[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) continue;
    assets.push({
      url,
      fileId: typeof item.fileId === "string" ? item.fileId.trim() || undefined : undefined,
      filename: typeof item.filename === "string" ? item.filename.trim() || undefined : undefined,
      mimeType: typeof item.mimeType === "string" ? item.mimeType.trim() || undefined : undefined,
      kind: item.kind === "image" || item.kind === "video" ? item.kind : undefined,
      altText: typeof item.altText === "string" ? item.altText.trim() || undefined : undefined,
      contentHash:
        typeof item.contentHash === "string" && /^sha256:[a-f0-9]{64}$/i.test(item.contentHash.trim())
          ? item.contentHash.trim().toLowerCase()
          : undefined,
      byteLength:
        typeof item.byteLength === "number" && Number.isFinite(item.byteLength) && item.byteLength >= 0
          ? Math.round(item.byteLength)
          : undefined,
      path: typeof item.path === "string" ? item.path.trim() || undefined : undefined,
      assetIndex:
        typeof item.assetIndex === "number" && Number.isFinite(item.assetIndex) && item.assetIndex >= 0
          ? Math.round(item.assetIndex)
          : undefined,
    });
  }
  return assets;
}

const normalizeMediaManifest = normalizeSocialMediaAssets;

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function socialPublishingDefaultsFromMetadata(
  metadata: Record<string, unknown>,
): SocialPublishingDefaults {
  const rawDefaults = isRecord(metadata.publishingDefaults)
    ? metadata.publishingDefaults
    : {};
  const youtube = normalizeYouTubePublishingSettings(rawDefaults.youtube);
  return youtube.privacyStatus && youtube.madeForKids !== null
    ? {
        youtube: {
          privacyStatus: youtube.privacyStatus,
          madeForKids: youtube.madeForKids,
          containsSyntheticMedia: youtube.containsSyntheticMedia,
        },
      }
    : {};
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048) return null;
  if (trimmed.startsWith("/")) return trimmed;
  return isHttpsUrl(trimmed) ? trimmed : null;
}

function gateErrorMessage(gate: SocialPublishingGate): string {
  if (gate.status === "available") return "Social Publishing is not installed";
  if (gate.status === "setup_required") return "Social Publishing setup is required";
  return "Social Publishing is disabled";
}

function normalizePlatform(value: unknown): SocialPlatform | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SOCIAL_PLATFORMS.includes(normalized as SocialPlatform)
    ? (normalized as SocialPlatform)
    : null;
}

function platformLabel(platform: SocialPlatform): string {
  switch (platform) {
    case "x":
      return "X";
    case "linkedin":
      return "LinkedIn";
    case "instagram":
      return "Instagram";
    case "instagram_business":
      return "Instagram Business";
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
  }
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 160 ? trimmed : null;
}

function publicationTimezone(value: unknown): string {
  const timezone = normalizeId(value) || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new SocialPublishingInputError("Choose a valid timezone");
  }
}

function publicationRequestContextJson(value: unknown): string {
  const json = JSON.stringify(isRecord(value) ? value : {});
  if (json.length > 20_000) {
    throw new SocialPublishingInputError("Publication request context is too large");
  }
  return json;
}

function publicationRequestContextForVersion(
  version: PostVersionPublicationCandidate,
  input: unknown,
): string {
  const requestContext = isRecord(input) ? { ...input } : {};
  if (version.platform === "youtube") {
    const accountDefaults = socialPublishingDefaultsFromMetadata(
      parseJsonObject(version.account_metadata_json),
    );
    const savedSettings = parseJsonObject(version.publishing_settings_json);
    const savedYouTube = isRecord(savedSettings.youtube)
      ? savedSettings.youtube
      : null;
    const requestedYouTube = isRecord(requestContext.youtube)
      ? requestContext.youtube
      : null;
    const rawYouTube = requestedYouTube || accountDefaults.youtube || savedYouTube;
    if (!rawYouTube) {
      throw new SocialPublishingInputError(
        "Review YouTube publishing settings before uploading this video",
        409,
      );
    }
    const youtube = normalizeYouTubePublishingSettings(rawYouTube);
    if (!youtube.privacyStatus) {
      throw new SocialPublishingInputError(
        "Choose who can view this YouTube video before uploading",
        409,
      );
    }
    if (youtube.madeForKids === null) {
      throw new SocialPublishingInputError(
        "Choose whether this YouTube video is made for kids before uploading",
        409,
      );
    }
    requestContext.youtube = youtube;
  }
  if (version.platform === "tiktok") {
    const savedSettings = parseJsonObject(version.publishing_settings_json);
    const savedTikTok = isRecord(savedSettings.tiktok) ? savedSettings.tiktok : null;
    const requestedTikTok = isRecord(requestContext.tiktok) ? requestContext.tiktok : null;
    const rawTikTok = requestedTikTok || savedTikTok;
    if (!rawTikTok) {
      throw new SocialPublishingInputError(
        "Review TikTok delivery settings before publishing this Post",
        409,
      );
    }
    const tiktok = normalizeTikTokDeliveryOptions(rawTikTok);
    if (tiktok.deliveryMode === "direct_publish") {
      if (!tiktok.privacyLevel) {
        throw new SocialPublishingInputError(
          "Choose who can view this TikTok before publishing",
          409,
        );
      }
      if (!tiktok.consent) {
        throw new SocialPublishingInputError(
          "Confirm TikTok's music usage terms before publishing",
          409,
        );
      }
      if (
        !Number.isFinite(tiktok.videoDurationSeconds) ||
        tiktok.videoDurationSeconds <= 0
      ) {
        throw new SocialPublishingInputError(
          "ME3 needs the TikTok video duration before publishing",
          409,
        );
      }
    }
    requestContext.tiktok = tiktok;
  }
  return publicationRequestContextJson(requestContext);
}

function isStalePublishingTimestamp(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return !Number.isFinite(timestamp) || timestamp < Date.now() - 10 * 60_000;
}

function normalizeClientId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 300);
}

function normalizeSecretInput(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new SocialPublishingInputError("Client secret must be a string");
  const trimmed = value.trim();
  return trimmed || undefined;
}

function sanitizeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/social";
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/social";
  return value;
}

function buildFrontendRedirect(
  frontend: string,
  returnPath: string,
  params: Record<string, string>,
): string {
  const url = new URL(sanitizeReturnPath(returnPath), frontend);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `${prefix}_${encodeBase64Url(bytes)}`;
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return encodeBase64Url(hash);
}

function getSecretHint(secret: string): string {
  return `***${secret.slice(-4)}`;
}

async function encryptSecret(secret: string, installKey: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importSecretCryptoKey(installKey, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

async function decryptSecret(ciphertext: string, installKey: string): Promise<string> {
  const parts = ciphertext.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new SocialPublishingInputError("Stored social secret is invalid", 500);
  }
  const iv = decodeBase64Url(parts[1]);
  const data = decodeBase64Url(parts[2]);
  const key = await importSecretCryptoKey(installKey, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: copyBytes(iv) },
    key,
    copyBytes(data),
  );
  return new TextDecoder().decode(plain);
}

async function importSecretCryptoKey(
  installKey: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(installKey),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

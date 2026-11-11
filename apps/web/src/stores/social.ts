import { defineStore } from "pinia";
import { ref } from "vue";
import { api, ApiError } from "../api";

export type SocialPlatform =
  | "x"
  | "linkedin"
  | "instagram"
  | "instagram_business"
  | "facebook"
  | "youtube"
  | "tiktok";

export type SocialContentType = "text" | "image" | "carousel" | "short_video" | "document";
export type SocialDeliveryMode = "direct_publish" | "provider_draft" | "draft_only";

export type SocialPlatformContentRule = {
  contentType: SocialContentType;
  label: string;
  requiresText: boolean;
  maxTextCharacters: number | null;
  minMediaItems: number;
  maxMediaItems: number;
  allowedMediaKinds: Array<"image" | "video" | "document">;
  allowedMimeTypes: string[];
  maxBytesPerItem: number | null;
  guidance: string | null;
};

export type SocialPlatformCapabilities = {
  platform: SocialPlatform;
  draft: boolean;
  schedule: boolean;
  publish: boolean;
  deliveryMode: SocialDeliveryMode;
  supportedDeliveryModes?: SocialDeliveryMode[];
  deliveryLabel: string;
  contentRules: SocialPlatformContentRule[];
  reason: string | null;
};

export type SocialAccountRow = {
  id: string;
  siteId: string;
  platform: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  avatarSource?: "provider" | "owner_profile" | null;
  credentialSource: "hosted_oauth" | "byo";
  publishingDefaults?: SocialPublishingDefaults;
  status: string;
  scopes?: string[];
  lastVerifiedAt: string | null;
};

export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type TikTokCreatorInfo = {
  avatarUrl: string | null;
  username: string;
  nickname: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSeconds: number;
};

export type TikTokPublishingSettings =
  | { deliveryMode: "provider_draft" }
  | {
    deliveryMode: "direct_publish";
    privacyLevel: TikTokPrivacyLevel;
    allowComment: boolean;
    allowDuet: boolean;
    allowStitch: boolean;
    brandContent: boolean;
    brandOrganic: boolean;
    isAiGenerated: boolean;
    consent: true;
    videoDurationSeconds: number;
  };

export type YouTubePrivacyStatus = "private" | "unlisted" | "public";

export type YouTubePublishingSettings = {
  privacyStatus: YouTubePrivacyStatus;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
};

export type SocialPublishingDefaults = {
  youtube?: YouTubePublishingSettings;
};

/** Per-platform choices saved on a version and applied when it posts. */
export type SocialPostOptions = {
  thread?: boolean;
  firstComment?: string;
  /** "@ME3" → "@me3_app": this platform's handle for a mention in the text. */
  mentions?: Record<string, string>;
  /** Added at the end of the post on this platform. */
  hashtags?: string;
};

export type DriveFolder = {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
};

export type DriveFile = {
  id: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string | null;
  status: "uploading" | "ready" | "trashed" | "failed";
  previewKind: "image" | "pdf" | "text" | "markdown" | "csv" | "spreadsheet" | "download";
};

export type SocialLinkPreview = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string;
};

export type SocialStatus = {
  /** "locked": the owner's plan doesn't include Social. */
  access?: "included" | "locked";
  plugin: {
    status: string;
    enabled: boolean;
    ready: boolean;
    statusLabel: string;
    platformCapabilities: SocialPlatformCapabilities[];
  };
  hostedOAuth: {
    configured: boolean;
    platforms: string[];
  };
  managedXUsage?: {
    usedPercent: number;
    blocked: boolean;
    resetsAt: string;
  } | null;
  /** Posts left this month on ME3's shared X app; text-only posts cost less than posts with a link. */
  managedXAllowance?: {
    postsLeft: number;
    linkPostsLeft: number;
    usedPercent: number;
    resetsAt: string;
  } | null;
  localDemo?: boolean;
};

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

export type SocialMediaAsset = {
  url: string;
  fileId?: string;
  filename?: string;
  mimeType?: string;
  kind?: "image" | "video" | "document";
  altText?: string;
  contentHash?: string;
  byteLength?: number;
  assetIndex?: number;
  /** Videos: the cover frame, in milliseconds (Instagram uses it). */
  coverTimeMs?: number;
};

export type PostVersion = {
  id: string;
  postId: string;
  platform: SocialPlatform;
  targetAccountId: string | null;
  format: "post" | "image" | "carousel" | "short_video";
  title?: string | null;
  bodyText: string;
  assetManifest: SocialMediaAsset[];
  publishingSettings?: {
    tiktok?: TikTokPublishingSettings;
    youtube?: YouTubePublishingSettings;
    /** X thread and first comment, per platform. */
    post?: SocialPostOptions;
  };
  sourceExcerpt: string | null;
  approvalStatus: "draft" | "approved" | "rejected";
  approvedAt: string | null;
  approvedByUserId: string | null;
  scheduledFor: string | null;
  timezone: string | null;
  publicationStatus: "scheduled" | "queued" | "publishing" | "published" | "failed" | "cancelled" | null;
  platformPostUrl: string | null;
  publishedAt: string | null;
  failureClass: "retryable" | "reconnect_required" | "rejected" | "unsupported" | "outcome_unknown" | null;
  errorCode?: string | null;
  errorMessage: string | null;
  carouselRenderSetId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CarouselHex = `#${string}`;

/** A saved slide look. Values left on "site" follow the site's Look (theme, accent, logo). */
export type CarouselTemplateSettings = {
  background: "site-light" | "site-dark" | "photo" | CarouselHex;
  photoFileId: string | null;
  dim: number;
  accent: "site" | CarouselHex;
  font: "site" | "serif" | "sans";
  weight: "regular" | "bold";
  position: "top" | "middle" | "bottom";
  align: "left" | "center";
  rule: boolean;
  cornerLeft: string;
  cornerRight: string;
  logo: boolean;
};

export type CarouselTemplate = {
  id: string;
  siteId: string;
  name: string;
  settings: CarouselTemplateSettings;
  createdAt: string;
  updatedAt: string;
};

export type TextCarouselSlide = {
  id: string;
  main: string;
  small: string;
  swap: boolean;
  photoFileId: string | null;
};

export type TextCarousel = {
  postId: string;
  templateId: string | null;
  slides: TextCarouselSlide[];
  /** Files ids of the JPEGs last added to the post. */
  fileIds: string[];
  updatedAt: string;
};

export type SocialPostDetail = {
  post: {
    id: string;
    siteId: string;
    sourceType: "journal" | "mission_task" | "site" | "file" | "script" | "pasted" | "legacy_content_bank_read_only";
    sourceRef: string | null;
    sourceTitle: string;
    sourceSnapshot: string;
    sourceText: string;
    ideaText: string;
    tags: string[];
    goal: string | null;
    status: "draft" | "ready" | "partially_published" | "published" | "failed" | "archived";
    createdBy: "user" | "agent";
    createdAt: string;
    updatedAt: string;
  };
  versions: PostVersion[];
};

export type SocialSuggestionKind = "quote" | "short_post" | "thread" | "carousel_outline";

export type SocialSuggestion = {
  id: string;
  siteId: string;
  sourceType: "journal" | "mission_task" | "site" | "file" | "script" | "pasted";
  sourceRef: string;
  sourceTitle: string;
  sourceSnapshot: string;
  sourceText: string;
  kind: SocialSuggestionKind;
  bodyText: string;
  sourceExcerpt: string;
  quoteTrimmed: boolean;
  status: "suggested" | "choosing" | "chosen" | "discarded";
  selectedPostId: string | null;
  choosingPlatforms: SocialPlatform[] | null;
  choosingAt: string | null;
  createdBy: "user" | "agent";
  createdAt: string;
  updatedAt: string;
};

export type SocialSuggestionUpdate = {
  expectedUpdatedAt: string;
  bodyText?: string;
  sourceExcerpt?: string;
  quoteTrimmed?: boolean;
};

export type CreateSocialPostInput = {
  siteId: string;
  sourceTitle?: string;
  sourceType: "pasted";
  sourceSnapshot: string;
  sourceText: string;
  ideaText: string;
  versions: Array<{
    platform: SocialPlatform;
    targetAccountId?: string | null;
    format?: PostVersion["format"];
    title?: string | null;
    bodyText: string;
    assetManifest?: SocialMediaAsset[];
  }>;
};

export type PostVersionUpdate = {
  targetAccountId?: string | null;
  title?: string | null;
  bodyText?: string;
  assetManifest?: SocialMediaAsset[];
  publishingSettings?: PostVersion["publishingSettings"];
  approvalStatus?: PostVersion["approvalStatus"];
};

export type CreatePostVersionInput = {
  platform: SocialPlatform;
  targetAccountId?: string | null;
  format?: PostVersion["format"];
  title?: string | null;
  bodyText: string;
  assetManifest?: SocialMediaAsset[];
};

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
  failureClass: PostVersion["failureClass"];
  errorCode: string | null;
  errorMessage: string | null;
  requestedByType: "owner" | "agent" | "migration" | null;
  requestedByUserId: string | null;
  requestContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreatePublicationInput = {
  scheduledFor?: string | null;
  timezone?: string | null;
  requestContext?: unknown;
};

export type PostLibrarySearch = {
  siteId?: string;
  query?: string;
  source?: string;
  platform?: SocialPlatform;
  accountId?: string;
  approvalStatus?: PostVersion["approvalStatus"];
  deliveryState?: PublicationStatus;
  tag?: string;
  publishedFrom?: string;
  publishedTo?: string;
  limit?: number;
};

export type PostLibraryItem = {
  postId: string;
  versionId: string;
  siteId: string;
  sourceType: string;
  sourceRef: string | null;
  sourceTitle: string;
  postText: string;
  tags: string[];
  platform: SocialPlatform;
  accountId: string | null;
  accountLabel: string | null;
  approvalStatus: PostVersion["approvalStatus"];
  deliveryState: PublicationStatus | null;
  lastPublishedAt: string | null;
  nextScheduledAt: string | null;
  publishedCount: number;
  eligibleForPostingPlan: boolean;
  updatedAt: string;
};

export type PreferredPostingTime = {
  day: "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
  localTime: string;
};

export type PreferredPostingTimes = {
  accountId: string;
  siteId: string;
  platform: SocialPlatform;
  accountLabel: string;
  timezone: string;
  times: PreferredPostingTime[];
  minimumGapMinutes: number;
  minimumRepostDays: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PostingPlanWarning = {
  code: string;
  message: string;
  versionId?: string;
  scheduledFor?: string;
};

export type PostingPlanItem = {
  id: string;
  position: number;
  versionId: string;
  postId: string;
  sourceTitle: string;
  postText: string;
  platform: SocialPlatform;
  accountId: string;
  scheduledFor: string;
  timezone: string;
  isRepost: boolean;
  status: "suggested" | "reserved" | "scheduled" | "blocked";
  publicationId: string | null;
  errorMessage: string | null;
};

export type PostingPlan = {
  id: string;
  siteId: string;
  accountId: string;
  accountLabel: string;
  platform: SocialPlatform;
  status: "suggested" | "confirming" | "needs_attention" | "confirmed" | "expired";
  timezone: string;
  windowStart: string;
  windowEnd: string;
  requestedCount: number;
  minimumGapMinutes: number;
  minimumRepostDays: number | null;
  warnings: PostingPlanWarning[];
  items: PostingPlanItem[];
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const useSocialStore = defineStore("social", () => {
  const error = ref<string | null>(null);
  const loading = ref(false);

  async function fetchSocialStatus(): Promise<SocialStatus> {
    error.value = null;
    return api.get<SocialStatus>("/social/status");
  }

  async function fetchSocialAccounts(): Promise<SocialAccountRow[]> {
    error.value = null;
    const data = await api.get<{ accounts: SocialAccountRow[] }>("/social/accounts");
    return data.accounts || [];
  }

  async function fetchProviderSettings(): Promise<SocialProviderSetting[]> {
    error.value = null;
    const data = await api.get<{ providers: SocialProviderSetting[] }>(
      "/social/provider-settings",
    );
    return data.providers || [];
  }

  async function fetchSocialPosts(siteId: string): Promise<SocialPostDetail[]> {
    error.value = null;
    const query = siteId ? `?siteId=${encodeURIComponent(siteId)}` : "";
    const data = await api.get<{ posts: SocialPostDetail[] }>(`/social/posts${query}`);
    return data.posts || [];
  }

  async function fetchSocialPost(postId: string): Promise<SocialPostDetail> {
    error.value = null;
    const data = await api.get<{ post: SocialPostDetail }>(`/social/posts/${encodeURIComponent(postId)}`);
    if (!data.post) throw new Error("No Social Post returned");
    return data.post;
  }

  async function reschedulePublication(
    publicationId: string,
    input: { scheduledFor: string; timezone: string | null; expectedUpdatedAt?: string },
  ): Promise<Publication> {
    error.value = null;
    const data = await api.patch<{ publication: Publication }>(
      `/social/publications/${encodeURIComponent(publicationId)}`,
      input,
    );
    if (!data.publication) throw new Error("No Publication returned");
    return data.publication;
  }

  async function createSocialPost(input: CreateSocialPostInput): Promise<SocialPostDetail> {
    error.value = null;
    const data = await api.post<{ post: SocialPostDetail }>("/social/posts", input);
    if (!data.post) throw new Error("No Social Post returned");
    return data.post;
  }

  async function createLocalSocialDemo(siteId: string): Promise<SocialPostDetail> {
    error.value = null;
    const data = await api.post<{ post: SocialPostDetail }>("/social/local-demo", { siteId });
    if (!data.post) throw new Error("No local Social demo returned");
    return data.post;
  }

  async function fetchCarouselTemplates(siteId: string): Promise<CarouselTemplate[]> {
    error.value = null;
    const data = await api.get<{ templates: CarouselTemplate[] }>(
      `/social/carousel-templates?siteId=${encodeURIComponent(siteId)}`,
    );
    return data.templates || [];
  }

  async function createCarouselTemplate(
    siteId: string,
    name: string,
    settings: CarouselTemplateSettings,
  ): Promise<CarouselTemplate> {
    error.value = null;
    const data = await api.post<{ template: CarouselTemplate }>("/social/carousel-templates", { siteId, name, settings });
    if (!data.template) throw new Error("No template returned");
    return data.template;
  }

  async function updateCarouselTemplate(
    templateId: string,
    patch: { name?: string; settings?: CarouselTemplateSettings },
  ): Promise<CarouselTemplate> {
    error.value = null;
    const data = await api.patch<{ template: CarouselTemplate }>(
      `/social/carousel-templates/${encodeURIComponent(templateId)}`,
      patch,
    );
    if (!data.template) throw new Error("No template returned");
    return data.template;
  }

  async function fetchTextCarousel(postId: string): Promise<TextCarousel | null> {
    error.value = null;
    const data = await api.get<{ carousel: TextCarousel | null }>(
      `/social/posts/${encodeURIComponent(postId)}/text-carousel`,
    );
    return data.carousel || null;
  }

  async function saveTextCarousel(
    postId: string,
    input: { templateId: string | null; slides: TextCarouselSlide[]; fileIds: string[] },
  ): Promise<TextCarousel> {
    error.value = null;
    const data = await api.put<{ carousel: TextCarousel }>(
      `/social/posts/${encodeURIComponent(postId)}/text-carousel`,
      input,
    );
    if (!data.carousel) throw new Error("No carousel returned");
    return data.carousel;
  }

  async function searchPostLibrary(input: PostLibrarySearch = {}): Promise<PostLibraryItem[]> {
    error.value = null;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null || value === "") continue;
      query.set(key, String(value));
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    const data = await api.get<{ items: PostLibraryItem[] }>(`/social/library${suffix}`);
    return data.items || [];
  }

  async function fetchLinkPreview(url: string): Promise<SocialLinkPreview | null> {
    error.value = null;
    const data = await api.get<{ preview: SocialLinkPreview | null }>(
      `/social/link-preview?url=${encodeURIComponent(url)}`,
    );
    return data.preview || null;
  }

  async function updateSocialPost(
    postId: string,
    input: { title?: string; tags?: string[]; expectedUpdatedAt: string },
  ): Promise<SocialPostDetail> {
    error.value = null;
    const data = await api.patch<{ post: SocialPostDetail }>(
      `/social/posts/${encodeURIComponent(postId)}`,
      input,
    );
    if (!data.post) throw new Error("No Social Post returned");
    return data.post;
  }

  async function addPostVersion(
    postId: string,
    input: CreatePostVersionInput,
  ): Promise<SocialPostDetail> {
    error.value = null;
    const data = await api.post<{ post: SocialPostDetail }>(
      `/social/posts/${encodeURIComponent(postId)}/versions`,
      input,
    );
    if (!data.post) throw new Error("No Social Post returned");
    return data.post;
  }

  /** An AI rewrite under the limit, in the owner's words; the owner reviews it. */
  async function shortenText(text: string, limit: number): Promise<string> {
    const data = await api.post<{ text?: string }>("/social/shorten", { text, limit });
    if (!data.text) throw new Error("ME3 couldn't shorten this.");
    return data.text;
  }

  /** An AI draft of alt text from a small JPEG data URL; the owner edits it before saving. */
  async function draftAltText(image: string, context: string): Promise<string> {
    const data = await api.post<{ altText?: string }>("/social/alt-text", { image, context });
    if (!data.altText) throw new Error("ME3 couldn't describe this image.");
    return data.altText;
  }

  async function deletePostVersion(versionId: string): Promise<SocialPostDetail> {
    error.value = null;
    const data = await api.delete<{ post: SocialPostDetail }>(
      `/social/versions/${encodeURIComponent(versionId)}`,
    );
    if (!data.post) throw new Error("No Social Post returned");
    return data.post;
  }

  async function deleteSocialPost(postId: string, expectedUpdatedAt: string): Promise<void> {
    error.value = null;
    await api.delete(
      `/social/posts/${encodeURIComponent(postId)}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    );
  }

  async function listDriveFolders(): Promise<DriveFolder[]> {
    error.value = null;
    const data = await api.get<{ folders: DriveFolder[] }>("/files/folders");
    return data.folders || [];
  }

  async function listDriveFiles(folderId: string | null): Promise<DriveFile[]> {
    error.value = null;
    const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
    const data = await api.get<{ files: DriveFile[] }>(`/files/items${query}`);
    return data.files || [];
  }

  async function fetchPreferredPostingTimes(
    accountId: string,
  ): Promise<PreferredPostingTimes | null> {
    error.value = null;
    const data = await api.get<{ preference: PreferredPostingTimes | null }>(
      `/social/accounts/${encodeURIComponent(accountId)}/preferred-posting-times`,
    );
    return data.preference || null;
  }

  async function updatePreferredPostingTimes(
    accountId: string,
    input: {
      timezone: string;
      times: PreferredPostingTime[];
      minimumGapMinutes: number;
      minimumRepostDays: number | null;
    },
  ): Promise<PreferredPostingTimes> {
    error.value = null;
    const data = await api.put<{ preference: PreferredPostingTimes }>(
      `/social/accounts/${encodeURIComponent(accountId)}/preferred-posting-times`,
      input,
    );
    if (!data.preference) throw new Error("No Preferred posting times returned");
    return data.preference;
  }

  async function createPostingPlan(input: {
    accountId: string;
    versionIds?: string[];
    windowStart: string;
    windowEnd: string;
    count: number;
  }): Promise<PostingPlan> {
    error.value = null;
    const data = await api.post<{ plan: PostingPlan }>("/social/posting-plans", input);
    if (!data.plan) throw new Error("No Posting plan returned");
    return data.plan;
  }

  async function fetchPostingPlan(planId: string): Promise<PostingPlan> {
    error.value = null;
    const data = await api.get<{ plan: PostingPlan }>(
      `/social/posting-plans/${encodeURIComponent(planId)}`,
    );
    if (!data.plan) throw new Error("No Posting plan returned");
    return data.plan;
  }

  async function confirmPostingPlan(plan: PostingPlan): Promise<PostingPlan> {
    error.value = null;
    const data = await api.post<{ plan: PostingPlan }>(
      `/social/posting-plans/${encodeURIComponent(plan.id)}/confirm`,
      { confirmed: true, expectedUpdatedAt: plan.updatedAt },
    );
    if (!data.plan) throw new Error("No Posting plan returned");
    return data.plan;
  }

  async function fetchSocialSuggestions(siteId: string): Promise<SocialSuggestion[]> {
    error.value = null;
    const query = siteId ? `?siteId=${encodeURIComponent(siteId)}` : "";
    const data = await api.get<{ suggestions: SocialSuggestion[] }>(
      `/social/suggestions${query}`,
    );
    return data.suggestions || [];
  }

  async function updateSocialSuggestion(
    suggestionId: string,
    input: SocialSuggestionUpdate,
  ): Promise<SocialSuggestion> {
    error.value = null;
    const data = await api.patch<{ suggestion: SocialSuggestion }>(
      `/social/suggestions/${encodeURIComponent(suggestionId)}`,
      input,
    );
    if (!data.suggestion) throw new Error("No Social Suggestion returned");
    return data.suggestion;
  }

  async function discardSocialSuggestion(
    suggestionId: string,
    expectedUpdatedAt: string,
  ): Promise<SocialSuggestion> {
    error.value = null;
    const data = await api.delete<{ suggestion: SocialSuggestion }>(
      `/social/suggestions/${encodeURIComponent(suggestionId)}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    );
    if (!data.suggestion) throw new Error("No Social Suggestion returned");
    return data.suggestion;
  }

  async function chooseSocialSuggestion(
    suggestionId: string,
    platforms: SocialPlatform[],
    expectedUpdatedAt: string,
  ): Promise<{ suggestion: SocialSuggestion; post: SocialPostDetail }> {
    error.value = null;
    const data = await api.post<{
      suggestion: SocialSuggestion;
      post: SocialPostDetail;
    }>(`/social/suggestions/${encodeURIComponent(suggestionId)}/post`, {
      platforms,
      expectedUpdatedAt,
    });
    if (!data.suggestion || !data.post) {
      throw new Error("No chosen Social Suggestion Post returned");
    }
    return data;
  }

  async function updatePostVersion(
    versionId: string,
    input: PostVersionUpdate,
  ): Promise<PostVersion> {
    error.value = null;
    const data = await api.patch<{ version: PostVersion }>(
      `/social/versions/${encodeURIComponent(versionId)}`,
      input,
    );
    if (!data.version) throw new Error("No Post Version returned");
    return data.version;
  }

  async function publishPostVersion(
    versionId: string,
    input: CreatePublicationInput = {},
  ): Promise<Publication> {
    error.value = null;
    const data = await api.post<{ publication: Publication }>(
      `/social/versions/${encodeURIComponent(versionId)}/publish`,
      input,
    );
    if (!data.publication) throw new Error("No Publication returned");
    return data.publication;
  }

  async function getTikTokCreatorInfo(accountId: string): Promise<TikTokCreatorInfo> {
    error.value = null;
    const data = await api.get<{ creatorInfo: TikTokCreatorInfo }>(
      `/social/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info`,
    );
    if (!data.creatorInfo) throw new Error("No TikTok creator information returned");
    return data.creatorInfo;
  }

  async function updateSocialAccountPublishingDefaults(
    accountId: string,
    publishingDefaults: SocialPublishingDefaults,
  ): Promise<SocialPublishingDefaults> {
    error.value = null;
    const data = await api.patch<{ publishingDefaults: SocialPublishingDefaults }>(
      `/social/accounts/${encodeURIComponent(accountId)}/publishing-defaults`,
      publishingDefaults,
    );
    return data.publishingDefaults || {};
  }

  async function listPostVersionPublications(versionId: string): Promise<Publication[]> {
    error.value = null;
    const data = await api.get<{ publications: Publication[] }>(
      `/social/versions/${encodeURIComponent(versionId)}/publications`,
    );
    return data.publications || [];
  }

  async function createPostVersionPublication(
    versionId: string,
    input: CreatePublicationInput = {},
  ): Promise<Publication> {
    error.value = null;
    const data = await api.post<{ publication: Publication }>(
      `/social/versions/${encodeURIComponent(versionId)}/publications`,
      input,
    );
    if (!data.publication) throw new Error("No Publication returned");
    return data.publication;
  }

  async function cancelPublication(publicationId: string): Promise<Publication> {
    error.value = null;
    const data = await api.delete<{ publication: Publication }>(
      `/social/publications/${encodeURIComponent(publicationId)}`,
    );
    if (!data.publication) throw new Error("No Publication returned");
    return data.publication;
  }

  async function resolvePublicationOutcome(
    publicationId: string,
    outcome: "published" | "not_published",
    platformPostUrl?: string,
  ): Promise<Publication> {
    error.value = null;
    const data = await api.post<{ publication: Publication }>(
      `/social/publications/${encodeURIComponent(publicationId)}/resolve`,
      {
        outcome,
        platformPostUrl: platformPostUrl || null,
      },
    );
    if (!data.publication) throw new Error("No Publication returned");
    return data.publication;
  }

  async function updateProviderSetting(payload: {
    id: SocialProviderSetting["providerId"];
    clientId: string;
    clientSecret?: string;
    enabled: boolean;
  }): Promise<SocialProviderSetting[]> {
    error.value = null;
    const data = await api.put<{ providers: SocialProviderSetting[] }>(
      "/social/provider-settings",
      { providers: [payload] },
    );
    return data.providers || [];
  }

  async function startSocialOAuth(
    platform: SocialPlatform,
    siteId: string,
    returnPath?: string,
    credentialSource?: "managed" | "byo",
  ): Promise<string> {
    error.value = null;
    const data = await api.post<{ url: string }>(
      `/social/${platform}/authorize`,
      { siteId, returnPath: returnPath || null, credentialSource },
    );
    if (!data.url) throw new Error("No OAuth URL");
    return data.url;
  }

  async function disconnectSocialAccount(accountId: string): Promise<void> {
    error.value = null;
    await api.delete(`/social/accounts/${encodeURIComponent(accountId)}`);
  }

  function setErrorFromApi(e: unknown, fallback: string) {
    error.value = e instanceof ApiError ? e.message : fallback;
  }

  return {
    error,
    loading,
    fetchSocialStatus,
    fetchSocialAccounts,
    fetchProviderSettings,
    fetchSocialPosts,
    fetchSocialPost,
    reschedulePublication,
    fetchCarouselTemplates,
    createCarouselTemplate,
    updateCarouselTemplate,
    fetchTextCarousel,
    saveTextCarousel,
    searchPostLibrary,
    fetchLinkPreview,
    fetchSocialSuggestions,
    createSocialPost,
    createLocalSocialDemo,
    updateSocialPost,
    addPostVersion,
    deletePostVersion,
    draftAltText,
    shortenText,
    deleteSocialPost,
    listDriveFolders,
    listDriveFiles,
    fetchPreferredPostingTimes,
    updatePreferredPostingTimes,
    createPostingPlan,
    fetchPostingPlan,
    confirmPostingPlan,
    updateSocialSuggestion,
    discardSocialSuggestion,
    chooseSocialSuggestion,
    updatePostVersion,
    publishPostVersion,
    listPostVersionPublications,
    createPostVersionPublication,
    getTikTokCreatorInfo,
    updateSocialAccountPublishingDefaults,
    cancelPublication,
    resolvePublicationOutcome,
    updateProviderSetting,
    startSocialOAuth,
    disconnectSocialAccount,
    setErrorFromApi,
  };
});

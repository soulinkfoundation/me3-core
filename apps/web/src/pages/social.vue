<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import AppDialog from "../components/AppDialog.vue";
import Button from "../components/Button.vue";
import ConfirmationDialog from "../components/ConfirmationDialog.vue";
import SocialAccountsPanel from "../components/SocialAccountsPanel.vue";
import UiIcon from "../components/UiIcon.vue";
import WorkspaceTabs from "../components/WorkspaceTabs.vue";
import { API_BASE } from "../api";
import { useAppToast } from "../composables/useAppToast";
import { socialPlatformIconPath } from "../utils/social-platform-icons";
import { resolveLocalDateTimeToUtc } from "../utils/timezone";
import {
  uploadDriveFiles,
  usesMultipartDriveUpload,
  type DriveUploadProgress,
} from "../utils/drive-upload";
import { useAuthStore } from "../stores/auth";
import { useSitesStore } from "../stores/sites";
import {
  useSocialStore,
  type PostVersion,
  type DriveFile,
  type DriveFolder,
  type SocialAccountRow,
  type SocialContentType,
  type SocialLinkPreview,
  type SocialPlatform,
  type SocialPlatformCapabilities,
  type SocialPlatformContentRule,
  type SocialPostDetail,
  type TikTokCreatorInfo,
  type TikTokPublishingSettings,
  type TikTokPrivacyLevel,
  type YouTubePrivacyStatus,
  type YouTubePublishingSettings,
} from "../stores/social";

definePage({
  meta: {
    requiresAuth: true,
    title: "Social | ME3",
    description: "Write, review, approve, and publish social posts.",
    robots: "noindex,follow",
  },
});

type WorkspaceMode = "drafts" | "scheduled" | "published";
type TikTokDeliveryMode = "provider_draft" | "direct_publish";

type WorkspaceSnapshot = {
  posts: SocialPostDetail[];
  activeMode: WorkspaceMode;
  selectedPostId: string | null;
  selectedVersionId: string | null;
  editorScope: "shared" | "platform";
  editorTitle: string;
  editorBody: string;
  editorAccountId: string;
  mobileDetailOpen: boolean;
};

type PublicationPreparation = {
  post: SocialPostDetail;
  versions: PostVersion[];
  wasShared: boolean;
  selectedVersionId: string | null;
  editedVersionIds: Set<string>;
  bodyText: string;
  accountId: string;
  title: string;
  titleChanged: boolean;
};

type EditorDraft = {
  bodyText: string;
  title: string;
  targetAccountId: string | null;
};

type DeleteCandidate = {
  detail: SocialPostDetail;
  version: PostVersion | null;
};

const auth = useAuthStore();
const sites = useSitesStore();
const social = useSocialStore();
const selectedSiteId = ref("");
const posts = ref<SocialPostDetail[]>([]);
const accounts = ref<SocialAccountRow[]>([]);
const capabilities = ref<SocialPlatformCapabilities[]>([]);
const localDemoAvailable = ref(false);
const activeMode = ref<WorkspaceMode>("drafts");
const selectedPostId = ref<string | null>(null);
const selectedVersionId = ref<string | null>(null);
const editorScope = ref<"shared" | "platform">("platform");
const editorTitle = ref("");
const editorBody = ref("");
const editorAccountId = ref("");
const mobileDetailOpen = ref(false);
const initializing = ref(true);
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const error = ref("");
const showAccounts = ref(false);
const instagramPreviewIndex = ref(0);
const showMediaPicker = ref(false);
const mediaFolders = ref<DriveFolder[]>([]);
const mediaFiles = ref<DriveFile[]>([]);
const mediaFolderId = ref<string | null>(null);
const selectedMediaFileIds = ref<string[]>([]);
const mediaLoading = ref(false);
const mediaError = ref("");
const mediaUploadInput = ref<HTMLInputElement | null>(null);
const mediaUploadBusy = ref(false);
const mediaUploadProgress = ref<DriveUploadProgress | null>(null);
const showSchedule = ref(false);
const scheduleDate = ref("");
const scheduleTime = ref("09:00");
const scheduleTimezone = computed(
  () => auth.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
);
const scheduleError = ref("");
const scheduling = ref(false);
const showTikTokSettings = ref(false);
const tiktokSettingsSaving = ref(false);
const tiktokSettingsVersionId = ref<string | null>(null);
const tiktokDeliveryMode = ref<TikTokDeliveryMode>("direct_publish");
const tiktokCreatorInfo = ref<TikTokCreatorInfo | null>(null);
const tiktokCreatorInfoLoading = ref(false);
const tiktokCreatorInfoError = ref("");
const tiktokPrivacyLevel = ref<TikTokPrivacyLevel | "">("");
const tiktokAllowComment = ref(false);
const tiktokAllowDuet = ref(false);
const tiktokAllowStitch = ref(false);
const tiktokCommercialContent = ref(false);
const tiktokBrandOrganic = ref(false);
const tiktokBrandContent = ref(false);
const tiktokIsAiGenerated = ref(false);
const tiktokConsent = ref(false);
const tiktokVideoDurationSeconds = ref<number | null>(null);
const tiktokCaptionCopied = ref(false);
const showYouTubeSettings = ref(false);
const youtubeSettingsSaving = ref(false);
const youtubeSettingsVersionId = ref<string | null>(null);
const youtubeSettingsError = ref("");
const youtubePrivacyStatus = ref<YouTubePrivacyStatus | "">("");
const youtubeMadeForKids = ref<"yes" | "no" | "">("");
const youtubeContainsSyntheticMedia = ref(false);
const deleteCandidate = ref<DeleteCandidate | null>(null);
const linkPreview = ref<SocialLinkPreview | null>(null);
const linkPreviewLoading = ref(false);
const showPublishingChecks = ref(false);
const showDestinations = ref(false);
const destinationMode = ref<"create" | "manage">("create");
const destinationContentType = ref<SocialContentType>("text");
const selectedDestinationAccountIds = ref<string[]>([]);
const destinationError = ref("");
const { toast, toastError, toastSuccess } = useAppToast();
let deliveryPollTimer: ReturnType<typeof setInterval> | null = null;
let editorSaveTimer: ReturnType<typeof setTimeout> | null = null;
let linkPreviewTimer: ReturnType<typeof setTimeout> | null = null;
let linkPreviewSequence = 0;
let workspaceLoadSequence = 0;
let tiktokCreatorInfoSequence = 0;
let tiktokCaptionCopiedTimer: ReturnType<typeof setTimeout> | null = null;
const MEDIA_CACHE_TTL_MS = 60_000;
const mediaFileCache = new Map<string, { files: DriveFile[]; cachedAt: number }>();
let mediaFolderCache: { folders: DriveFolder[]; cachedAt: number } | null = null;
const editorDrafts = new Map<string, EditorDraft>();
const linkPreviewCache = new Map<string, SocialLinkPreview | null>();

const currentSite = computed(
  () => sites.sites.find((site) => site.id === selectedSiteId.value) || null,
);

const activeAccounts = computed(() =>
  accounts.value.filter(
    (account) => account.siteId === selectedSiteId.value && account.status === "active",
  ),
);

function visibleVersionsFor(detail: SocialPostDetail): PostVersion[] {
  return detail.versions.filter((version) => versionMode(version) === activeMode.value);
}

const visiblePosts = computed(() =>
  posts.value
    .filter((detail) =>
      visibleVersionsFor(detail).length > 0
    )
    .sort((left, right) => {
      if (activeMode.value === "scheduled") {
        const leftScheduledAt = scheduledDateFor(left);
        const rightScheduledAt = scheduledDateFor(right);
        if (leftScheduledAt && rightScheduledAt) {
          return Date.parse(leftScheduledAt) - Date.parse(rightScheduledAt);
        }
        if (leftScheduledAt) return -1;
        if (rightScheduledAt) return 1;
      }
      return Date.parse(right.post.updatedAt) - Date.parse(left.post.updatedAt);
    }),
);

const modeTabs = computed(() =>
  (["drafts", "scheduled", "published"] as WorkspaceMode[]).map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    count: posts.value.filter((detail) =>
      detail.versions.some((version) => versionMode(version) === id),
    ).length,
  })),
);

const selectedPost = computed(
  () => posts.value.find((detail) => detail.post.id === selectedPostId.value) || null,
);

const selectedVersion = computed(
  () =>
    selectedPost.value?.versions.find((version) => version.id === selectedVersionId.value) ||
    null,
);

const editorLinkUrl = computed(() => {
  if (
    sharedEditor.value ||
    (selectedVersion.value?.platform !== "linkedin" && selectedVersion.value?.platform !== "x")
  ) {
    return null;
  }
  return previewLinkUrl(editorBody.value);
});

const selectedVisibleVersions = computed(() =>
  selectedPost.value ? visibleVersionsFor(selectedPost.value) : [],
);

const sharedEditor = computed(
  () => editorScope.value === "shared" && selectedVisibleVersions.value.length > 1,
);

const editorVersions = computed(() =>
  sharedEditor.value
    ? selectedVisibleVersions.value
    : selectedVersion.value ? [selectedVersion.value] : [],
);

const editorAssetManifest = computed(
  () => selectedVersion.value?.assetManifest || [],
);

const sharedBodyMixed = computed(() => {
  const [first, ...rest] = selectedVisibleVersions.value;
  return Boolean(first && rest.some((version) => version.bodyText !== first.bodyText));
});

const sharedMediaMixed = computed(() => {
  const [first, ...rest] = selectedVisibleVersions.value;
  const firstManifest = JSON.stringify(first?.assetManifest || []);
  return Boolean(first && rest.some(
    (version) => JSON.stringify(version.assetManifest) !== firstManifest,
  ));
});

const selectedPostReadOnly = computed(
  () => selectedPost.value?.post.sourceType === "legacy_content_bank_read_only",
);

const selectedPostOptimistic = computed(
  () => selectedPost.value?.post.id.startsWith("optimistic-social-post-") === true,
);

const titleDirty = computed(() =>
  Boolean(
    !sharedEditor.value &&
    selectedVersion.value?.platform === "youtube" &&
    editorTitle.value.trim() !== (selectedVersion.value.title || ""),
  ),
);

const draftAccounts = computed(() => {
  const supported = new Set(
    capabilities.value.filter((capability) => capability.draft).map((capability) => capability.platform),
  );
  const seen = new Set<SocialPlatform>();
  return activeAccounts.value.filter((account) => {
    const platform = account.platform as SocialPlatform;
    if (!supported.has(platform) || seen.has(platform)) return false;
    seen.add(platform);
    return true;
  });
});

const destinationAccounts = computed(() => draftAccounts.value.map((account) => {
  const capability = capabilityFor(account.platform as SocialPlatform);
  return {
    account,
    capability,
    compatible: Boolean(
      capability?.contentRules?.some((rule) => rule.contentType === destinationContentType.value),
    ),
  };
}));

const targetValidations = computed(() => selectedVisibleVersions.value.map((version) => ({
  version,
  ...validateVersion(
    version,
    editorVersions.value.some((candidate) => candidate.id === version.id)
      ? editorBody.value
      : version.bodyText,
    sharedEditor.value && editorVersions.value.some((candidate) => candidate.id === version.id)
      ? editorAssetManifest.value
      : version.assetManifest,
    !sharedEditor.value && selectedVersionId.value === version.id
      ? editorTitle.value
      : version.title || "",
  ),
})));

const actionableValidations = computed(() => {
  const versionIds = new Set(editorVersions.value.map((version) => version.id));
  return targetValidations.value.filter((validation) => versionIds.has(validation.version.id));
});

const publicationTikTokVersion = computed(
  () => selectedVisibleVersions.value.find(
    (version) => version.platform === "tiktok",
  ) || null,
);

const publicationYouTubeVersion = computed(
  () => selectedVisibleVersions.value.find(
    (version) => version.platform === "youtube",
  ) || null,
);

const publicationIsYouTubeOnly = computed(
  () => actionableValidations.value.length === 1 &&
    actionableValidations.value[0]?.version.platform === "youtube",
);

const tiktokSettingsVersion = computed(
  () => tiktokSettingsVersionId.value
    ? versionById(tiktokSettingsVersionId.value)
    : publicationTikTokVersion.value,
);

const youtubeSettingsVersion = computed(
  () => youtubeSettingsVersionId.value
    ? versionById(youtubeSettingsVersionId.value)
    : publicationYouTubeVersion.value,
);

const youtubeSettingsAccount = computed(() =>
  youtubeSettingsVersion.value
    ? accountForVersion(youtubeSettingsVersion.value)
    : null,
);

function savedTikTokSettings(
  version: PostVersion | null | undefined,
): TikTokPublishingSettings | null {
  return version?.publishingSettings?.tiktok || null;
}

function hasSavedTikTokSettings(version: PostVersion | null | undefined): boolean {
  const settings = savedTikTokSettings(version);
  return settings?.deliveryMode === "provider_draft" ||
    (
      settings?.deliveryMode === "direct_publish" &&
      Boolean(settings.privacyLevel) &&
      settings.consent === true &&
      Number.isFinite(settings.videoDurationSeconds) &&
      settings.videoDurationSeconds > 0
    );
}

function tikTokSettingsSummary(version: PostVersion | null | undefined): string {
  const settings = savedTikTokSettings(version);
  if (settings?.deliveryMode === "provider_draft") return "Send as creator draft";
  if (settings?.deliveryMode === "direct_publish") {
    return `Direct Post · ${tiktokPrivacyLabel(settings.privacyLevel)}`;
  }
  return "Direct Post review required";
}

function savedYouTubeSettings(
  version: PostVersion | null | undefined,
): YouTubePublishingSettings | null {
  if (!version) return null;
  return accountForVersion(version)?.publishingDefaults?.youtube ||
    version.publishingSettings?.youtube ||
    null;
}

function hasSavedYouTubeSettings(version: PostVersion | null | undefined): boolean {
  const settings = savedYouTubeSettings(version);
  return Boolean(
    settings?.privacyStatus &&
    typeof settings.madeForKids === "boolean",
  );
}

function youtubePrivacyLabel(status: YouTubePrivacyStatus): string {
  if (status === "public") return "Public";
  if (status === "unlisted") return "Unlisted";
  return "Private";
}

function youtubeSettingsSummary(version: PostVersion | null | undefined): string {
  const settings = savedYouTubeSettings(version);
  if (!settings) return "Visibility and audience review required";
  const audience = settings.madeForKids ? "Made for kids" : "Not made for kids";
  const disclosure = settings.containsSyntheticMedia
    ? " · Altered or synthetic"
    : "";
  return `${youtubePrivacyLabel(settings.privacyStatus)} · ${audience}${disclosure}`;
}

const tiktokDirectPostSupported = computed(() =>
  capabilityFor("tiktok")?.supportedDeliveryModes?.includes("direct_publish") === true,
);

const canPublish = computed(() => Boolean(
  !selectedPostReadOnly.value &&
  actionableValidations.value.length > 0 &&
  actionableValidations.value.every(
    (validation) => validation.contentValid && validation.accountValid,
  ),
));

const canSchedule = computed(() => Boolean(
  canPublish.value &&
  actionableValidations.value.every(
    (validation) =>
      validation.capability?.schedule &&
      !versionHasActivePublication(validation.version),
  ),
));

const canPublishNow = computed(() => Boolean(
  canPublish.value &&
  actionableValidations.value.every(
    (validation) =>
      validation.capability?.publish &&
      !versionHasActivePublication(validation.version),
  ),
));

const tiktokCommercialSelectionValid = computed(() =>
  !tiktokCommercialContent.value ||
  tiktokBrandOrganic.value ||
  tiktokBrandContent.value,
);

const tiktokVideoDurationValid = computed(() => Boolean(
  tiktokCreatorInfo.value &&
  tiktokVideoDurationSeconds.value &&
  tiktokVideoDurationSeconds.value <=
    tiktokCreatorInfo.value.maxVideoPostDurationSeconds,
));

const tiktokDirectPostReady = computed(() => Boolean(
  tiktokDeliveryMode.value === "direct_publish" &&
  tiktokCreatorInfo.value &&
  !tiktokCreatorInfoLoading.value &&
  !tiktokCreatorInfoError.value &&
  tiktokPrivacyLevel.value &&
  tiktokCommercialSelectionValid.value &&
  !(tiktokBrandContent.value && tiktokPrivacyLevel.value === "SELF_ONLY") &&
  tiktokVideoDurationValid.value &&
  tiktokConsent.value,
));

const canSubmitPublishNow = computed(() => Boolean(
  canPublishNow.value &&
  (
    !publicationTikTokVersion.value ||
    hasSavedTikTokSettings(publicationTikTokVersion.value)
  ) &&
  (
    !publicationYouTubeVersion.value ||
    hasSavedYouTubeSettings(publicationYouTubeVersion.value)
  ),
));

const canOpenSchedule = computed(() => canSchedule.value || canPublishNow.value);

const selectedDeleteVersion = computed(() =>
  !sharedEditor.value && selectedPost.value && selectedPost.value.versions.length > 1
    ? selectedVersion.value
    : null,
);

const canDeleteDraft = computed(() => {
  const detail = selectedPost.value;
  if (!detail) return false;
  return selectedDeleteVersion.value
    ? canRemoveVersion(selectedDeleteVersion.value)
    : canDeletePost(detail);
});

const deleteConfirmationMessage = computed(() => {
  const candidate = deleteCandidate.value;
  if (!candidate) return "";
  const { detail, version } = candidate;
  if (version) {
    return `Remove ${platformLabel(version.platform)} from this Post? Other platform versions will be kept.`;
  }
  const title = postPreviewText(detail);
  const hasScheduledDelivery = detail.versions.some((version) =>
    Boolean(version.scheduledFor) || version.publicationStatus === "scheduled",
  );
  const hasQueuedRetries = detail.versions.some((version) =>
    version.publicationStatus === "queued" && version.failureClass === "retryable",
  );
  const hasDeliveryHistory = detail.versions.some((version) =>
    Boolean(version.publicationStatus) || Boolean(version.failureClass),
  );
  const hasPublishedDelivery = detail.versions.some((version) =>
    version.publicationStatus === "published",
  );
  if (hasPublishedDelivery && hasScheduledDelivery) {
    return `Cancel scheduled delivery and remove “${title}” from ME3? Already published posts will stay on their social platforms. Delivery history will be retained.`;
  }
  if (hasScheduledDelivery) {
    return `Cancel scheduled delivery and delete “${title}”? Delivery history will be retained.`;
  }
  if (hasQueuedRetries) {
    return `Stop pending retries and delete “${title}”? Delivery history will be retained.`;
  }
  if (hasPublishedDelivery) {
    return `Remove “${title}” from ME3? Published posts will stay on their social platforms. Delivery history will be retained.`;
  }
  if (hasDeliveryHistory) {
    return `Delete “${title}”? Delivery history will be retained.`;
  }
  return `Delete “${title}”? This cannot be undone.`;
});

const deleteConfirmationLabel = computed(() => {
  if (deleteCandidate.value?.version) {
    return `Remove ${platformLabel(deleteCandidate.value.version.platform)}`;
  }
  if (deleteCandidate.value?.detail.versions.some((version) =>
    Boolean(version.scheduledFor) || version.publicationStatus === "scheduled"
  )) {
    return "Cancel and delete";
  }
  return deleteCandidate.value?.detail.versions.some(
    (version) => version.publicationStatus === "published",
  )
    ? "Remove from ME3"
    : "Delete";
});

const deleteActionLabel = computed(() => {
  if (selectedDeleteVersion.value) {
    return `Delete ${platformLabel(selectedDeleteVersion.value.platform)} draft`;
  }
  return selectedPost.value?.versions.some(
    (version) => version.publicationStatus === "published",
  )
    ? "Remove post from ME3"
    : "Delete draft";
});

const publishingCheckIssueCount = computed(() =>
  targetValidations.value.filter((validation) =>
    Boolean(
      validation.issue ||
      !validation.capability?.publish ||
      validation.version.failureClass ||
      validation.version.publicationStatus === "failed" ||
      validation.version.publicationStatus === "cancelled",
    ),
  ).length,
);

const publishingChecksLabel = computed(() =>
  publishingCheckIssueCount.value > 0
    ? `Review publishing checks, ${publishingCheckIssueCount.value} issue${publishingCheckIssueCount.value === 1 ? "" : "s"}`
    : `Review publishing checks, all ${targetValidations.value.length} platform${targetValidations.value.length === 1 ? "" : "s"} ready`,
);

const selectedVersionDeliveryError = computed(() => {
  const version = sharedEditor.value ? null : selectedVersion.value;
  return version ? versionDeliveryError(version) : "";
});

const selectedVersionDeliveryHeading = computed(() => {
  const version = sharedEditor.value ? null : selectedVersion.value;
  if (!version) return "";
  return version.failureClass === "outcome_unknown"
    ? `${platformLabel(version.platform)} delivery needs review`
    : `${platformLabel(version.platform)} delivery failed`;
});

function platformLabel(platform: string): string {
  if (platform === "x") return "X";
  if (platform === "linkedin") return "LinkedIn";
  if (platform === "youtube") return "YouTube";
  if (platform === "tiktok") return "TikTok";
  return platform === "instagram_business" ? "Instagram Business" : "Instagram";
}

function platformIconPath(platform: SocialPlatform): string {
  return socialPlatformIconPath(platform);
}

function previewAccountName(version: PostVersion): string {
  const account = accounts.value.find((item) => item.id === version.targetAccountId);
  return account?.displayName || account?.handle || "Your account";
}

function previewAccountHandle(version: PostVersion): string {
  const account = accounts.value.find((item) => item.id === version.targetAccountId);
  return account?.handle ? `@${account.handle.replace(/^@/, "")}` : "@you";
}

function accountForVersion(version: PostVersion): SocialAccountRow | null {
  return accounts.value.find((account) => account.id === version.targetAccountId) || null;
}

function accountInitials(version: PostVersion): string {
  const label = previewAccountName(version).trim();
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : label.slice(0, 2))
    .toUpperCase();
}

function accountLabel(version: PostVersion): string {
  const account = accountForVersion(version);
  return `${platformLabel(version.platform)} · ${account?.displayName || account?.handle || "Connected account"}`;
}

function accountAvatarUrl(version: PostVersion): string | null {
  return accountForVersion(version)?.avatarUrl || null;
}

function accountDisplayName(account: SocialAccountRow): string {
  return account.displayName || account.handle || platformLabel(account.platform);
}

function accountInitialsForAccount(account: SocialAccountRow): string {
  const parts = accountDisplayName(account).trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
    : accountDisplayName(account).slice(0, 2)
  ).toUpperCase();
}

function capabilityFor(platform: SocialPlatform): SocialPlatformCapabilities | null {
  return capabilities.value.find((capability) => capability.platform === platform) || null;
}

function contentTypeFor(
  capability: SocialPlatformCapabilities | null,
  assets: PostVersion["assetManifest"],
  format?: PostVersion["format"],
): SocialContentType {
  if (assets.some(isVideoAsset)) return "short_video";
  if (assets.length > 1) return "carousel";
  if (assets.length === 1) return "image";
  if (capability?.contentRules?.some((rule) => rule.contentType === "text")) return "text";
  if (format === "short_video" || format === "image" || format === "carousel") return format;
  if (capability?.contentRules?.some((rule) => rule.contentType === destinationContentType.value)) {
    return destinationContentType.value;
  }
  return capability?.contentRules?.[0]?.contentType || "text";
}

function mimeTypeAllowed(mimeType: string | undefined, allowed: string[]): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.split(";", 1)[0]!.trim().toLowerCase();
  return allowed.some((entry) =>
    entry.endsWith("/*")
      ? normalized.startsWith(entry.slice(0, -1))
      : normalized === entry,
  );
}

function validateVersion(
  version: PostVersion,
  bodyText = version.bodyText,
  assets = version.assetManifest,
  title = version.title || "",
): {
  capability: SocialPlatformCapabilities | null;
  rule: SocialPlatformContentRule | null;
  contentType: SocialContentType;
  contentValid: boolean;
  accountValid: boolean;
  issue: string | null;
} {
  const capability = capabilityFor(version.platform);
  const contentType = contentTypeFor(capability, assets, version.format);
  const rule = capability?.contentRules?.find((candidate) =>
    candidate.contentType === contentType,
  ) || null;
  const account = accountForVersion(version);
  const accountValid = Boolean(account && account.status === "active");
  let issue: string | null = null;

  if (version.platform === "youtube" && !title.trim()) {
    issue = "Add a YouTube title.";
  } else if (
    version.platform === "youtube" &&
    Array.from(title.trim()).length > 100
  ) {
    issue = "Shorten the YouTube title to 100 characters.";
  } else if (!rule) {
    issue = `${platformLabel(version.platform)} does not support this content type in ME3 yet.`;
  } else if (rule.requiresText && !bodyText.trim()) {
    issue = "Add post text.";
  } else if (
    rule.maxTextCharacters !== null &&
    Array.from(bodyText.trim()).length > rule.maxTextCharacters
  ) {
    issue = `Shorten the text to ${rule.maxTextCharacters.toLocaleString()} characters.`;
  } else if (assets.length < rule.minMediaItems) {
    issue = rule.contentType === "short_video"
      ? "Add one video."
      : `Add at least ${rule.minMediaItems} image${rule.minMediaItems === 1 ? "" : "s"}.`;
  } else if (assets.length > rule.maxMediaItems) {
    issue = `Use no more than ${rule.maxMediaItems} media item${rule.maxMediaItems === 1 ? "" : "s"}.`;
  } else {
    for (const asset of assets) {
      const kind = isVideoAsset(asset) ? "video" : "image";
      if (!rule.allowedMediaKinds.includes(kind)) {
        issue = `${rule.label} does not support ${kind} media.`;
        break;
      }
      if (rule.allowedMimeTypes.length && !mimeTypeAllowed(asset.mimeType, rule.allowedMimeTypes)) {
        issue = `Use a supported ${kind} file type.`;
        break;
      }
      if (
        rule.maxBytesPerItem !== null &&
        asset.byteLength &&
        asset.byteLength > rule.maxBytesPerItem
      ) {
        issue = `This ${kind} is too large for ${platformLabel(version.platform)}.`;
        break;
      }
    }
  }

  if (!issue && !accountValid) {
    issue =
      version.platform === "tiktok" &&
      version.errorCode?.includes(
        "unaudited_client_can_only_post_to_private_accounts",
      )
        ? "Set the TikTok account to private and choose Only me until app review is approved."
        : `Reconnect the ${platformLabel(version.platform)} account.`;
  }
  return {
    capability,
    rule,
    contentType,
    contentValid: !issue || (!accountValid && issue.startsWith("Reconnect")),
    accountValid,
    issue,
  };
}

function canDeletePost(detail: SocialPostDetail): boolean {
  if (detail.post.sourceType === "legacy_content_bank_read_only") return false;
  return detail.versions.every((version) =>
    !(
      version.publicationStatus === "publishing" &&
      version.failureClass !== "outcome_unknown"
    ) &&
    (
      version.publicationStatus !== "queued" ||
      version.failureClass === "retryable"
    ),
  );
}

function canRemoveVersion(version: PostVersion): boolean {
  return selectedPost.value?.versions.length !== 1 &&
    version.approvalStatus === "draft" &&
    !version.scheduledFor &&
    !version.publicationStatus;
}

function destinationVersion(account: SocialAccountRow): PostVersion | null {
  return selectedPost.value?.versions.find(
    (version) => version.platform === account.platform,
  ) || null;
}

function destinationLocked(account: SocialAccountRow): boolean {
  const version = destinationMode.value === "manage" ? destinationVersion(account) : null;
  return Boolean(version && !canRemoveVersion(version));
}

function isVideoAsset(asset: PostVersion["assetManifest"][number]): boolean {
  return asset.kind === "video" || asset.mimeType?.startsWith("video/") === true;
}

function isShortVideoVersion(version: PostVersion): boolean {
  return version.format === "short_video" || version.assetManifest.some(isVideoAsset);
}

function previewLinkUrl(bodyText: string): string | null {
  return bodyText.match(/https?:\/\/[^\s<>()]+/i)?.[0] || null;
}

function previewLinkHost(bodyText: string): string {
  const url = previewLinkUrl(bodyText);
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function scheduleLinkPreview(url: string | null) {
  if (linkPreviewTimer) clearTimeout(linkPreviewTimer);
  linkPreviewTimer = null;
  linkPreviewSequence += 1;
  linkPreview.value = null;
  linkPreviewLoading.value = false;
  if (!url) return;

  if (linkPreviewCache.has(url)) {
    linkPreview.value = linkPreviewCache.get(url) || null;
    return;
  }

  const sequence = linkPreviewSequence;
  linkPreviewLoading.value = true;
  linkPreviewTimer = setTimeout(async () => {
    linkPreviewTimer = null;
    try {
      const preview = await social.fetchLinkPreview(url);
      linkPreviewCache.set(url, preview);
      if (sequence === linkPreviewSequence && editorLinkUrl.value === url) {
        linkPreview.value = preview;
      }
    } catch {
      linkPreviewCache.set(url, null);
    } finally {
      if (sequence === linkPreviewSequence) linkPreviewLoading.value = false;
    }
  }, 350);
}

function hidePreviewImage() {
  if (linkPreview.value) {
    linkPreview.value = { ...linkPreview.value, imageUrl: null };
  }
}

function externalSourceUrl(detail: SocialPostDetail): string | null {
  const sourceRef = detail.post.sourceRef?.trim();
  return sourceRef && /^https?:\/\//i.test(sourceRef) ? sourceRef : null;
}

function versionMode(version: PostVersion): WorkspaceMode {
  if (version.publicationStatus === "published") return "published";
  if (
    version.scheduledFor ||
    version.publicationStatus === "queued" ||
    version.publicationStatus === "publishing"
  ) {
    return "scheduled";
  }
  return "drafts";
}

function versionHasActivePublication(version: PostVersion): boolean {
  if (
    version.publicationStatus === "failed" ||
    version.publicationStatus === "cancelled"
  ) {
    return false;
  }
  return Boolean(
    version.scheduledFor ||
    version.publicationStatus === "scheduled" ||
    version.publicationStatus === "queued" ||
    version.publicationStatus === "publishing"
  );
}

function versionDeliveryError(version: PostVersion): string {
  if (
    version.publicationStatus !== "failed" &&
    version.publicationStatus !== "cancelled" &&
    version.failureClass !== "outcome_unknown"
  ) {
    return "";
  }
  if (
    version.platform === "tiktok" &&
    version.errorCode?.includes(
      "unaudited_client_can_only_post_to_private_accounts",
    )
  ) {
    return "Until app review is approved, set this TikTok account to private and choose Only me visibility.";
  }
  return version.errorMessage ||
    (version.publicationStatus === "cancelled"
      ? "The previous delivery was cancelled."
      : "The previous delivery failed. Review this platform and retry when ready.");
}

function versionDeliveryFeedback(version: PostVersion): string {
  const deliveryError = versionDeliveryError(version);
  if (deliveryError) return deliveryError;
  if (
    version.publicationStatus === "queued" &&
    version.failureClass === "retryable"
  ) {
    return version.errorMessage
      ? `Retrying automatically — ${version.errorMessage}`
      : "Retrying automatically";
  }
  if (
    version.publicationStatus === "queued" ||
    version.publicationStatus === "publishing"
  ) {
    return "Publishing";
  }
  if (version.scheduledFor || version.publicationStatus === "scheduled") {
    return version.scheduledFor
      ? `Scheduled for ${formatDate(version.scheduledFor)}`
      : "Scheduled";
  }
  return "";
}

function scheduledDateFor(detail: SocialPostDetail): string | null {
  const scheduledDates = visibleVersionsFor(detail)
    .map((version) => version.scheduledFor)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return scheduledDates[0] || null;
}

function postPreviewText(detail: SocialPostDetail): string {
  const preview = visibleVersionsFor(detail)
    .map((version) => version.bodyText.trim())
    .find(Boolean);
  return preview || "Untitled draft";
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function setActiveMode(value: string) {
  if (!(value === "drafts" || value === "scheduled" || value === "published")) return;
  activeMode.value = value;
  mobileDetailOpen.value = false;
  ensureVisibleSelection();
}

function selectPost(detail: SocialPostDetail, openDetail = true) {
  selectedPostId.value = detail.post.id;
  mobileDetailOpen.value = openDetail;
  const versions = visibleVersionsFor(detail);
  if (versions.length > 1) {
    selectSharedVersions(versions);
  } else {
    selectVersion(versions[0] || null);
  }
}

function selectVersion(version: PostVersion | null) {
  const draft = version ? editorDrafts.get(version.id) : null;
  editorScope.value = "platform";
  selectedVersionId.value = version?.id || null;
  instagramPreviewIndex.value = 0;
  editorTitle.value = draft?.title ?? version?.title ?? "";
  editorBody.value = draft?.bodyText ?? version?.bodyText ?? "";
  editorAccountId.value = draft?.targetAccountId || version?.targetAccountId || activeAccounts.value.find(
    (account) => account.platform === version?.platform,
  )?.id || "";
}

function selectSharedVersions(versions = selectedVisibleVersions.value) {
  const first = versions[0] || null;
  const draft = first ? editorDrafts.get(first.id) : null;
  editorScope.value = versions.length > 1 ? "shared" : "platform";
  selectedVersionId.value = first?.id || null;
  instagramPreviewIndex.value = 0;
  editorTitle.value = "";
  editorBody.value = draft?.bodyText ?? first?.bodyText ?? "";
  editorAccountId.value = draft?.targetAccountId || first?.targetAccountId || "";
}

function setInstagramPreview(index: number) {
  const total = selectedVersion.value?.assetManifest.length || 0;
  if (total > 0) instagramPreviewIndex.value = Math.max(0, Math.min(index, total - 1));
}

function ensureVisibleSelection() {
  const current = visiblePosts.value.find((detail) => detail.post.id === selectedPostId.value);
  if (current) {
    selectPost(current, mobileDetailOpen.value);
  } else if (visiblePosts.value[0]) {
    selectPost(visiblePosts.value[0], false);
  } else {
    selectedPostId.value = null;
    mobileDetailOpen.value = false;
    selectVersion(null);
  }
}

function closeMobileDetail() {
  mobileDetailOpen.value = false;
}

function selectLinkedSocialRecord(): boolean {
  const postId = currentQueryParam("postId");
  const versionId = currentQueryParam("versionId");
  if (!postId || !versionId) return false;
  const detail = posts.value.find((item) => item.post.id === postId);
  const version = detail?.versions.find((item) => item.id === versionId) || null;
  if (!detail || !version) return false;
  activeMode.value = versionMode(version);
  selectedPostId.value = detail.post.id;
  mobileDetailOpen.value = true;
  selectVersion(version);
  return true;
}

async function loadWorkspace() {
  if (!selectedSiteId.value) return;
  const requestedSiteId = selectedSiteId.value;
  const loadSequence = ++workspaceLoadSequence;
  loading.value = true;
  error.value = "";
  try {
    const nextPosts = await social.fetchSocialPosts(requestedSiteId);
    if (
      loadSequence !== workspaceLoadSequence ||
      selectedSiteId.value !== requestedSiteId
    ) return;
    posts.value = nextPosts;
    if (!selectLinkedSocialRecord()) ensureVisibleSelection();
  } catch (value) {
    if (loadSequence !== workspaceLoadSequence) return;
    social.setErrorFromApi(value, "Failed to load social posts");
    error.value = social.error || "Failed to load social posts";
  } finally {
    if (loadSequence === workspaceLoadSequence) loading.value = false;
  }
}

async function initializeWorkspace() {
  const loadSequence = ++workspaceLoadSequence;
  initializing.value = true;
  loading.value = true;
  error.value = "";
  try {
    const linkedSiteId = currentQueryParam("siteId");
    selectedSiteId.value =
      sites.sites.find((site) => site.id === linkedSiteId)?.id ||
      sites.sites[0]?.id ||
      "";
    const initialPostsRequest = selectedSiteId.value
      ? social.fetchSocialPosts(selectedSiteId.value)
      : Promise.resolve(null);

    const [, nextAccounts, status, initialPosts] = await Promise.all([
      sites.sites.length === 0 ? sites.ensureSites() : Promise.resolve(),
      social.fetchSocialAccounts(),
      social.fetchSocialStatus(),
      initialPostsRequest,
    ]);
    if (loadSequence !== workspaceLoadSequence) return;

    accounts.value = nextAccounts;
    capabilities.value = status.plugin.platformCapabilities || [];
    localDemoAvailable.value = status.localDemo === true;

    if (!selectedSiteId.value) {
      selectedSiteId.value =
        sites.sites.find((site) => site.id === linkedSiteId)?.id ||
        sites.sites[0]?.id ||
        "";
    }
    if (!selectedSiteId.value) return;

    const nextPosts = initialPosts ||
      await social.fetchSocialPosts(selectedSiteId.value);
    if (loadSequence !== workspaceLoadSequence) return;
    posts.value = nextPosts;
    if (!selectLinkedSocialRecord()) ensureVisibleSelection();
  } catch (value) {
    if (loadSequence !== workspaceLoadSequence) return;
    social.setErrorFromApi(value, "Failed to load social posts");
    error.value = social.error || "Failed to load social posts";
  } finally {
    if (loadSequence === workspaceLoadSequence) {
      initializing.value = false;
      loading.value = false;
    }
  }
}

function workspaceHasActiveDeliveries(): boolean {
  return posts.value.some((detail) =>
    detail.versions.some((version) =>
      version.publicationStatus === "queued" ||
      version.publicationStatus === "publishing",
    ),
  );
}

async function refreshDeliveryStates() {
  if (
    !selectedSiteId.value ||
    loading.value ||
    saving.value ||
    scheduling.value ||
    !workspaceHasActiveDeliveries()
  ) return;
  const requestedSiteId = selectedSiteId.value;
  try {
    const nextPosts = await social.fetchSocialPosts(requestedSiteId);
    if (selectedSiteId.value !== requestedSiteId) return;
    const selectedId = selectedVersionId.value;
    posts.value = nextPosts;
    const refreshedVersion = selectedId
      ? nextPosts.flatMap((detail) => detail.versions)
        .find((version) => version.id === selectedId)
      : null;
    const refreshedDetail = refreshedVersion
      ? nextPosts.find((detail) => detail.post.id === refreshedVersion.postId)
      : null;
    const selectedPostStillInMode = refreshedDetail?.versions.some(
      (version) => versionMode(version) === activeMode.value,
    );
    if (
      refreshedVersion &&
      !selectedPostStillInMode &&
      versionMode(refreshedVersion) !== activeMode.value
    ) {
      activeMode.value = versionMode(refreshedVersion);
    }
    if (!selectedPost.value) ensureVisibleSelection();
  } catch {
    // Polling is best-effort. Explicit actions still surface errors through the
    // workspace banner while a temporary refresh failure leaves the editor usable.
  }
}


function replaceVersion(version: PostVersion, syncEditor = true) {
  posts.value = posts.value.map((detail) =>
    detail.post.id === version.postId
      ? {
          ...detail,
          versions: detail.versions.map((item) => (item.id === version.id ? version : item)),
        }
      : detail,
  );
  if (syncEditor && !sharedEditor.value && selectedVersionId.value === version.id) {
    selectVersion(version);
  }
}

function captureWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    posts: posts.value,
    activeMode: activeMode.value,
    selectedPostId: selectedPostId.value,
    selectedVersionId: selectedVersionId.value,
    editorScope: editorScope.value,
    editorTitle: editorTitle.value,
    editorBody: editorBody.value,
    editorAccountId: editorAccountId.value,
    mobileDetailOpen: mobileDetailOpen.value,
  };
}

function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  posts.value = snapshot.posts;
  activeMode.value = snapshot.activeMode;
  selectedPostId.value = snapshot.selectedPostId;
  selectedVersionId.value = snapshot.selectedVersionId;
  editorScope.value = snapshot.editorScope;
  editorTitle.value = snapshot.editorTitle;
  editorBody.value = snapshot.editorBody;
  editorAccountId.value = snapshot.editorAccountId;
  mobileDetailOpen.value = snapshot.mobileDetailOpen;
}

function versionById(versionId: string): PostVersion | null {
  return posts.value
    .flatMap((detail) => detail.versions)
    .find((version) => version.id === versionId) || null;
}

function clearEditorSaveTimer() {
  if (!editorSaveTimer) return;
  clearTimeout(editorSaveTimer);
  editorSaveTimer = null;
}

function editorDraftMatches(left: EditorDraft | undefined, right: EditorDraft): boolean {
  return Boolean(
    left &&
    left.bodyText === right.bodyText &&
    left.title === right.title &&
    left.targetAccountId === right.targetAccountId
  );
}

function captureEditorDraft() {
  const wasShared = sharedEditor.value;
  for (const version of editorVersions.value) {
    const draft: EditorDraft = {
      bodyText: editorBody.value.trim(),
      title:
        !wasShared && version.platform === "youtube"
          ? editorTitle.value.trim()
          : version.title || "",
      targetAccountId:
        wasShared ? version.targetAccountId : editorAccountId.value || null,
    };
    const unchanged =
      draft.bodyText === version.bodyText &&
      draft.title === (version.title || "") &&
      draft.targetAccountId === version.targetAccountId;
    if (unchanged) editorDrafts.delete(version.id);
    else editorDrafts.set(version.id, draft);
  }
}

function scheduleEditorSave() {
  queueEditorSave(true);
}

function queueEditorSave(capture: boolean) {
  if (capture) captureEditorDraft();
  clearEditorSaveTimer();
  if (
    selectedPostReadOnly.value ||
    editorDrafts.size === 0
  ) return;
  editorSaveTimer = setTimeout(() => {
    editorSaveTimer = null;
    void saveDraft();
  }, 700);
}

async function flushPendingEditorSave() {
  clearEditorSaveTimer();
  await saveDraft();
}

async function saveDraft() {
  const pending = [...editorDrafts.entries()]
    .map(([versionId, draft]) => ({ version: versionById(versionId), draft }))
    .filter(
      (item): item is { version: PostVersion; draft: EditorDraft } =>
        Boolean(item.version && item.draft.bodyText),
    );
  if (pending.length === 0 || selectedPostReadOnly.value) return;
  if (saving.value) {
    queueEditorSave(false);
    return;
  }
  let saveFailed = false;
  saving.value = true;
  error.value = "";
  try {
    for (const { version, draft } of pending) {
      replaceVersion(await social.updatePostVersion(version.id, {
        bodyText: draft.bodyText,
        ...(version.platform === "youtube"
          ? { title: draft.title }
          : {}),
        targetAccountId: draft.targetAccountId,
      }), false);
      if (editorDraftMatches(editorDrafts.get(version.id), draft)) {
        editorDrafts.delete(version.id);
      }
    }
  } catch (value) {
    saveFailed = true;
    social.setErrorFromApi(value, "Failed to save this draft");
    error.value = social.error || "Failed to save this draft";
    toastError(error.value);
  } finally {
    saving.value = false;
    if (!saveFailed && editorDrafts.size > 0) queueEditorSave(false);
  }
}

function capturePublicationPreparation(): PublicationPreparation | null {
  const post = selectedPost.value;
  const versions = [...selectedVisibleVersions.value];
  if (!post || versions.length === 0 || selectedPostReadOnly.value || !canPublish.value) {
    return null;
  }
  const wasShared = sharedEditor.value;
  const editedVersionIds = new Set(editorVersions.value.map((version) => version.id));
  const selectedId = selectedVersionId.value;
  return {
    post,
    versions,
    wasShared,
    selectedVersionId: selectedId,
    editedVersionIds,
    bodyText: editorBody.value.trim(),
    accountId: editorAccountId.value,
    title: editorTitle.value.trim(),
    titleChanged: titleDirty.value,
  };
}

function applyOptimisticPublication(
  preparation: PublicationPreparation,
  delivery: {
    publicationStatus: "scheduled" | "queued";
    scheduledFor: string | null;
    timezone: string | null;
  },
) {
  const approvedAt = new Date().toISOString();
  posts.value = posts.value.map((detail) => {
    if (detail.post.id !== preparation.post.post.id) return detail;
    return {
      post: detail.post,
      versions: detail.versions.map((version) => {
        if (!preparation.versions.some((candidate) => candidate.id === version.id)) {
          return version;
        }
        return {
          ...version,
          title:
            preparation.titleChanged && version.id === preparation.selectedVersionId
              ? preparation.title
              : version.title,
          bodyText: preparation.editedVersionIds.has(version.id)
            ? preparation.bodyText
            : version.bodyText,
          targetAccountId:
            !preparation.wasShared && version.id === preparation.selectedVersionId
              ? preparation.accountId
              : version.targetAccountId,
          approvalStatus: "approved",
          approvedAt: version.approvedAt || approvedAt,
          scheduledFor: delivery.scheduledFor,
          timezone: delivery.timezone,
          publicationStatus: delivery.publicationStatus,
          platformPostUrl: null,
          publishedAt: null,
          failureClass: null,
          errorCode: null,
          errorMessage: null,
        };
      }),
    };
  });
  ensureVisibleSelection();
}

async function persistPublicationPreparation(
  preparation: PublicationPreparation,
): Promise<PostVersion[]> {
  const prepared = await Promise.all(preparation.versions.map((version) =>
    social.updatePostVersion(version.id, {
      title:
        preparation.titleChanged && version.id === preparation.selectedVersionId
          ? preparation.title
          : version.title,
      bodyText: preparation.editedVersionIds.has(version.id)
        ? preparation.bodyText
        : version.bodyText,
      targetAccountId:
        !preparation.wasShared && version.id === preparation.selectedVersionId
          ? preparation.accountId
          : version.targetAccountId,
      approvalStatus: "approved",
    }),
  ));

  for (const version of prepared) {
    const optimistic = versionById(version.id);
    replaceVersion(
      optimistic
        ? {
            ...version,
            scheduledFor: optimistic.scheduledFor,
            timezone: optimistic.timezone,
            publicationStatus: optimistic.publicationStatus,
            platformPostUrl: optimistic.platformPostUrl,
            publishedAt: optimistic.publishedAt,
            failureClass: optimistic.failureClass,
            errorCode: optimistic.errorCode,
            errorMessage: optimistic.errorMessage,
          }
        : version,
    );
  }

  const current = posts.value.find(
    (detail) => detail.post.id === preparation.post.post.id,
  );
  if (current) {
    if (preparation.wasShared) selectSharedVersions(visibleVersionsFor(current));
    else selectVersion(
      current.versions.find(
        (version) => version.id === preparation.selectedVersionId,
      ) || current.versions[0] || null,
    );
  }
  return prepared;
}

function openCreateDraft() {
  destinationMode.value = "create";
  destinationContentType.value = "text";
  selectedDestinationAccountIds.value = [];
  destinationError.value = "";
  showDestinations.value = true;
}

function openManageDestinations() {
  const detail = selectedPost.value;
  if (!detail || selectedPostReadOnly.value) return;
  destinationMode.value = "manage";
  const base = selectedVersion.value || detail.versions[0] || null;
  const contentType = base
    ? contentTypeFor(capabilityFor(base.platform), base.assetManifest, base.format)
    : "short_video";
  destinationContentType.value = contentType === "carousel" ? "image" : contentType;
  selectedDestinationAccountIds.value = detail.versions
    .map((version) => version.targetAccountId)
    .filter((accountId): accountId is string => Boolean(accountId));
  destinationError.value = "";
  showDestinations.value = true;
}

function toggleDestinationAccount(accountId: string) {
  const option = destinationAccounts.value.find((item) => item.account.id === accountId);
  if (!option?.compatible) return;
  if (
    destinationLocked(option.account) &&
    selectedDestinationAccountIds.value.includes(accountId)
  ) return;
  selectedDestinationAccountIds.value = selectedDestinationAccountIds.value.includes(accountId)
    ? selectedDestinationAccountIds.value.filter((id) => id !== accountId)
    : [...selectedDestinationAccountIds.value, accountId];
}

async function saveDestinations() {
  if (selectedDestinationAccountIds.value.length === 0) {
    destinationError.value = "Choose at least one platform.";
    return;
  }
  if (destinationMode.value === "create") {
    await createDraft();
  } else {
    await updateDestinations();
  }
}

async function createDraft() {
  const site = currentSite.value;
  const selectedAccounts = draftAccounts.value.filter((account) =>
    selectedDestinationAccountIds.value.includes(account.id),
  );
  if (!site || selectedAccounts.length === 0 || saving.value) return;
  const draftText = "Untitled draft";
  const draftFormat =
    destinationContentType.value === "text" ? "post" : destinationContentType.value;
  const createdAt = new Date().toISOString();
  const optimisticPostId = `optimistic-social-post-${Date.now()}`;
  const optimisticDetail: SocialPostDetail = {
    post: {
      id: optimisticPostId,
      siteId: site.id,
      sourceType: "pasted",
      sourceRef: `pasted:${optimisticPostId}`,
      sourceTitle: draftText,
      sourceSnapshot: draftText,
      sourceText: draftText,
      ideaText: draftText,
      tags: [],
      goal: null,
      status: "draft",
      createdBy: "user",
      createdAt,
      updatedAt: createdAt,
    },
    versions: selectedAccounts.map((account) => ({
      id: `${optimisticPostId}-${account.id}`,
      postId: optimisticPostId,
      platform: account.platform as SocialPlatform,
      targetAccountId: account.id,
      format: draftFormat,
      title: account.platform === "youtube" ? draftText : null,
      bodyText: draftText,
      assetManifest: [],
      sourceExcerpt: draftText,
      approvalStatus: "draft",
      approvedAt: null,
      approvedByUserId: null,
      scheduledFor: null,
      timezone: null,
      publicationStatus: null,
      platformPostUrl: null,
      publishedAt: null,
      failureClass: null,
      errorCode: null,
      errorMessage: null,
      carouselRenderSetId: null,
      createdAt,
      updatedAt: createdAt,
    })),
  };
  saving.value = true;
  destinationError.value = "";
  error.value = "";
  posts.value = [optimisticDetail, ...posts.value];
  activeMode.value = "drafts";
  showDestinations.value = false;
  selectPost(optimisticDetail);
  try {
    const detail = await social.createSocialPost({
      siteId: site.id,
      sourceType: "pasted",
      sourceSnapshot: draftText,
      sourceText: draftText,
      ideaText: draftText,
      versions: selectedAccounts.map((account) => {
        return {
          platform: account.platform as SocialPlatform,
          format: draftFormat,
          ...(account.platform === "youtube" ? { title: draftText } : {}),
          bodyText: draftText,
          targetAccountId: account.id,
        };
      }),
    });
    posts.value = posts.value.map((item) =>
      item.post.id === optimisticPostId ? detail : item,
    );
    if (selectedPostId.value === optimisticPostId) selectPost(detail);
    toastSuccess(`Draft created for ${selectedAccounts.length} platform${selectedAccounts.length === 1 ? "" : "s"}.`);
  } catch (value) {
    posts.value = posts.value.filter((item) => item.post.id !== optimisticPostId);
    if (selectedPostId.value === optimisticPostId) {
      selectedPostId.value = null;
      selectVersion(null);
      ensureVisibleSelection();
    }
    showDestinations.value = true;
    social.setErrorFromApi(value, "Failed to create a draft");
    destinationError.value = social.error || "Failed to create a draft";
  } finally {
    saving.value = false;
  }
}

async function updateDestinations() {
  const detail = selectedPost.value;
  const base = selectedVersion.value || detail?.versions[0] || null;
  if (!detail || !base || saving.value) return;
  const selectedAccounts = draftAccounts.value.filter((account) =>
    selectedDestinationAccountIds.value.includes(account.id),
  );
  const selectedPlatforms = new Set(selectedAccounts.map((account) => account.platform));
  const additions = selectedAccounts.filter((account) =>
    !detail.versions.some((version) => version.platform === account.platform),
  );
  const removals = detail.versions.filter((version) =>
    !selectedPlatforms.has(version.platform) && canRemoveVersion(version),
  );

  saving.value = true;
  destinationError.value = "";
  try {
    let nextDetail = detail;
    for (const account of additions) {
      nextDetail = await social.addPostVersion(nextDetail.post.id, {
        platform: account.platform as SocialPlatform,
        targetAccountId: account.id,
        format: destinationContentType.value === "text" ? "post" : destinationContentType.value,
        bodyText: editorBody.value.trim() || base.bodyText,
        assetManifest: editorAssetManifest.value,
      });
      posts.value = posts.value.map((item) =>
        item.post.id === nextDetail.post.id ? nextDetail : item,
      );
    }
    for (const version of removals) {
      nextDetail = await social.deletePostVersion(version.id);
      posts.value = posts.value.map((item) =>
        item.post.id === nextDetail.post.id ? nextDetail : item,
      );
    }
    showDestinations.value = false;
    selectPost(nextDetail);
    toastSuccess("Publishing platforms updated.");
  } catch (value) {
    social.setErrorFromApi(value, "Failed to update publishing platforms");
    destinationError.value = social.error || "Failed to update publishing platforms";
  } finally {
    saving.value = false;
  }
}

async function loadLocalDemo() {
  const site = currentSite.value;
  if (!site || !localDemoAvailable.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const detail = await social.createLocalSocialDemo(site.id);
    posts.value = [detail, ...posts.value.filter((item) => item.post.id !== detail.post.id)];
    accounts.value = await social.fetchSocialAccounts();
    activeMode.value = "drafts";
    selectPost(detail);
    toastSuccess("Local demo loaded. It is safe to edit, approve, schedule, and delete.");
  } catch (value) {
    social.setErrorFromApi(value, "Failed to load the local Social demo");
    error.value = social.error || "Failed to load the local Social demo";
  } finally {
    saving.value = false;
  }
}

function requestDeleteDraft() {
  const detail = selectedPost.value;
  const version = selectedDeleteVersion.value;
  if (
    !detail ||
    saving.value ||
    deleting.value ||
    (version ? !canRemoveVersion(version) : !canDeletePost(detail))
  ) return;
  deleteCandidate.value = { detail, version };
}

async function confirmDeleteDraft() {
  const candidate = deleteCandidate.value;
  if (!candidate || deleting.value) return;
  const { detail, version } = candidate;
  if (version && !canRemoveVersion(version)) return;
  if (!version && !canDeletePost(detail)) return;
  const hasFailedHistory = detail.versions.some((version) =>
    version.publicationStatus === "failed" ||
    version.publicationStatus === "cancelled" ||
    Boolean(version.failureClass),
  );
  const hasScheduledHistory = detail.versions.some((version) =>
    Boolean(version.scheduledFor) || version.publicationStatus === "scheduled",
  );
  const hasPublishedHistory = detail.versions.some((version) =>
    version.publicationStatus === "published",
  );
  const snapshot = captureWorkspaceSnapshot();

  deleteCandidate.value = null;
  deleting.value = true;
  error.value = "";
  if (version) {
    const remainingVersions = detail.versions.filter((item) => item.id !== version.id);
    editorDrafts.delete(version.id);
    posts.value = posts.value.map((postDetail) =>
      postDetail.post.id === detail.post.id
        ? { ...postDetail, versions: remainingVersions }
        : postDetail,
    );
    if (remainingVersions.length > 1) selectSharedVersions(remainingVersions);
    else selectVersion(remainingVersions[0] || null);
  } else {
    for (const item of detail.versions) editorDrafts.delete(item.id);
    posts.value = posts.value.filter(
      (postDetail) => postDetail.post.id !== detail.post.id,
    );
    if (selectedPostId.value === detail.post.id) {
      selectedPostId.value = null;
      selectVersion(null);
      ensureVisibleSelection();
    }
  }

  try {
    if (version) {
      const updated = await social.deletePostVersion(version.id);
      posts.value = posts.value.map((postDetail) =>
        postDetail.post.id === updated.post.id ? updated : postDetail,
      );
      const remaining = updated.versions.filter(
        (item) => versionMode(item) === activeMode.value,
      );
      if (remaining.length > 1) selectSharedVersions(remaining);
      else selectVersion(remaining[0] || updated.versions[0] || null);
      toastSuccess(`${platformLabel(version.platform)} draft removed.`);
    } else {
      await social.deleteSocialPost(detail.post.id, detail.post.updatedAt);
      toastSuccess(
        hasScheduledHistory
          ? "Post deleted and scheduled delivery cancelled."
          : hasPublishedHistory
            ? "Post removed from ME3. Published social posts were not deleted."
          : hasFailedHistory
            ? "Post deleted. Delivery history was retained."
            : "Draft deleted.",
      );
    }
  } catch (value) {
    restoreWorkspaceSnapshot(snapshot);
    social.setErrorFromApi(value, "Failed to delete this draft");
    error.value = social.error || "Failed to delete this draft";
    toastError(error.value);
  } finally {
    deleting.value = false;
  }
}

function isMediaFile(file: DriveFile): boolean {
  return file.status === "ready" && (
    file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/")
  );
}

function isVideoFile(file: DriveFile): boolean {
  return file.mimeType.startsWith("video/");
}

function driveFileUrl(fileId: string): string {
  return `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(fileId)}/content`;
}

async function loadMediaFiles() {
  const cacheKey = mediaFolderId.value || "";
  const cached = mediaFileCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < MEDIA_CACHE_TTL_MS) {
    mediaFiles.value = cached.files;
    mediaLoading.value = false;
    return;
  }
  mediaLoading.value = true;
  mediaError.value = "";
  try {
    const files = (await social.listDriveFiles(mediaFolderId.value)).filter(isMediaFile);
    mediaFiles.value = files;
    mediaFileCache.set(cacheKey, { files, cachedAt: Date.now() });
  } catch (value) {
    social.setErrorFromApi(value, "Failed to load media from Files");
    mediaError.value = social.error || "Failed to load media from Files";
  } finally {
    mediaLoading.value = false;
  }
}

async function openMediaPicker() {
  if (editorVersions.value.length === 0 || selectedPostReadOnly.value) return;
  showMediaPicker.value = true;
  selectedMediaFileIds.value = [];
  mediaFolderId.value = null;
  mediaError.value = "";
  mediaUploadProgress.value = null;
  const cachedFiles = mediaFileCache.get("");
  if (
    mediaFolderCache &&
    cachedFiles &&
    Date.now() - mediaFolderCache.cachedAt < MEDIA_CACHE_TTL_MS &&
    Date.now() - cachedFiles.cachedAt < MEDIA_CACHE_TTL_MS
  ) {
    mediaFolders.value = mediaFolderCache.folders;
    mediaFiles.value = cachedFiles.files;
    mediaLoading.value = false;
    return;
  }
  mediaLoading.value = true;
  try {
    const [folders, files] = await Promise.all([
      social.listDriveFolders(),
      social.listDriveFiles(null),
    ]);
    const readyFiles = files.filter(isMediaFile);
    mediaFolders.value = folders;
    mediaFiles.value = readyFiles;
    mediaFolderCache = { folders, cachedAt: Date.now() };
    mediaFileCache.set("", { files: readyFiles, cachedAt: Date.now() });
  } catch (value) {
    social.setErrorFromApi(value, "Failed to load media from Files");
    mediaError.value = social.error || "Failed to load media from Files";
  } finally {
    mediaLoading.value = false;
  }
}

function triggerMediaUpload() {
  mediaUploadInput.value?.click();
}

async function handleMediaUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (files.length === 0 || mediaUploadBusy.value) return;

  mediaUploadBusy.value = true;
  mediaError.value = "";
  try {
    const uploaded = await uploadDriveFiles<DriveFile>(files, {
      folderId: mediaFolderId.value,
      onProgress: (progress) => {
        mediaUploadProgress.value = progress;
      },
    });
    const uploadedMedia = uploaded.filter(isMediaFile);
    mediaFileCache.delete(mediaFolderId.value || "");
    await loadMediaFiles();

    const uploadedVideo = uploadedMedia.find(isVideoFile);
    if (uploadedVideo) {
      selectedMediaFileIds.value = [uploadedVideo.id];
    } else {
      const selectedImages = selectedMediaFileIds.value.filter((id) => {
        const file = mediaFiles.value.find((item) => item.id === id);
        return Boolean(file && !isVideoFile(file));
      });
      selectedMediaFileIds.value = [...new Set([
        ...selectedImages,
        ...uploadedMedia.map((file) => file.id),
      ])];
    }

    if (uploadedMedia.length === 0) {
      mediaError.value = "The upload completed, but none of the files were images or videos.";
    } else {
      toastSuccess(
        uploadedMedia.length === 1
          ? `${uploadedMedia[0]!.filename} uploaded to Files and selected.`
          : `${uploadedMedia.length} media files uploaded to Files and selected.`,
      );
    }
  } catch (value) {
    social.setErrorFromApi(value, "Upload failed");
    const resumable = files.some(usesMultipartDriveUpload);
    mediaError.value = `${social.error || "Upload failed"}${
      resumable ? " Choose the same file again to resume." : ""
    }`;
  } finally {
    mediaUploadBusy.value = false;
    mediaUploadProgress.value = null;
  }
}

function toggleMediaFile(fileId: string) {
  if (selectedMediaFileIds.value.includes(fileId)) {
    selectedMediaFileIds.value = selectedMediaFileIds.value.filter((id) => id !== fileId);
    return;
  }
  const file = mediaFiles.value.find((item) => item.id === fileId);
  if (!file) return;
  const selectedFiles = selectedMediaFileIds.value
    .map((id) => mediaFiles.value.find((item) => item.id === id))
    .filter((item): item is DriveFile => Boolean(item));
  if (isVideoFile(file) || selectedFiles.some(isVideoFile)) {
    selectedMediaFileIds.value = [fileId];
    return;
  }
  selectedMediaFileIds.value = [...selectedMediaFileIds.value, fileId];
}

function driveFileAsset(
  file: DriveFile,
  assetIndex: number,
): PostVersion["assetManifest"][number] {
  return {
    url: driveFileUrl(file.id),
    fileId: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    kind: isVideoFile(file) ? "video" : "image",
    altText: isVideoFile(file) ? undefined : file.filename.replace(/\.[^.]+$/, ""),
    contentHash: file.sha256 ? `sha256:${file.sha256.toLowerCase()}` : undefined,
    byteLength: file.size,
    assetIndex,
  };
}

async function updateEditorMedia(
  assetManifest: PostVersion["assetManifest"],
  successMessage: string,
) {
  const versions = [...editorVersions.value];
  const wasShared = sharedEditor.value;
  const selectedId = selectedVersionId.value;
  const pendingTitle = editorTitle.value;
  const pendingBody = editorBody.value;
  const pendingAccountId = editorAccountId.value;
  const preserveTitle = titleDirty.value;
  const preserveBody = versions.some(
    (version) => pendingBody.trim() !== version.bodyText,
  );
  const preserveAccount = !wasShared && versions.some(
    (version) => (pendingAccountId || null) !== version.targetAccountId,
  );
  for (const version of versions) {
    replaceVersion(await social.updatePostVersion(version.id, { assetManifest }));
  }
  const current = selectedPost.value;
  if (current) {
    if (wasShared) selectSharedVersions(selectedVisibleVersions.value);
    else selectVersion(
      current.versions.find((version) => version.id === selectedId) || current.versions[0] || null,
    );
  }
  if (preserveTitle) editorTitle.value = pendingTitle;
  if (preserveBody) editorBody.value = pendingBody;
  if (preserveAccount) editorAccountId.value = pendingAccountId;
  toastSuccess(successMessage);
}

async function attachSelectedMedia() {
  if (editorVersions.value.length === 0 || selectedMediaFileIds.value.length === 0) return;
  const files = selectedMediaFileIds.value
    .map((id) => mediaFiles.value.find((file) => file.id === id))
    .filter((file): file is DriveFile => Boolean(file));
  if (!files.length) return;
  const selectedVideo = files.find(isVideoFile);
  const existingVideo = editorAssetManifest.value.some(isVideoAsset);
  if ((selectedVideo && editorAssetManifest.value.length > 0) || (existingVideo && files.length > 0)) {
    mediaError.value = "A video must be attached by itself. Remove the existing media first.";
    return;
  }
  const existingIds = new Set(
    editorAssetManifest.value.map((asset) => asset.fileId || asset.url),
  );
  const newFiles = files.filter(
    (file) => !existingIds.has(file.id) && !existingIds.has(driveFileUrl(file.id)),
  );
  saving.value = true;
  mediaError.value = "";
  try {
    const assetManifest = [
      ...editorAssetManifest.value.map((asset, index) => ({ ...asset, assetIndex: index })),
      ...newFiles
        .map((file, index) => driveFileAsset(file, editorAssetManifest.value.length + index)),
    ].map((asset, index) => ({ ...asset, assetIndex: index }));
    await updateEditorMedia(
      assetManifest,
      selectedVideo
        ? `Video attached to ${editorVersions.value.length} platform${editorVersions.value.length === 1 ? "" : "s"}.`
        : files.length === 1 ? "Image attached." : `${files.length} images attached in selection order.`,
    );
    showMediaPicker.value = false;
  } catch (value) {
    social.setErrorFromApi(value, "Failed to attach images");
    mediaError.value = social.error || "Failed to attach images";
  } finally {
    saving.value = false;
  }
}

async function moveMedia(fromIndex: number, offset: -1 | 1) {
  const toIndex = fromIndex + offset;
  if (
    editorVersions.value.length === 0 ||
    selectedPostReadOnly.value ||
    saving.value ||
    toIndex < 0 ||
    toIndex >= editorAssetManifest.value.length
  ) return;
  const assetManifest = [...editorAssetManifest.value];
  const [moved] = assetManifest.splice(fromIndex, 1);
  if (!moved) return;
  assetManifest.splice(toIndex, 0, moved);
  saving.value = true;
  error.value = "";
  try {
    await updateEditorMedia(
      assetManifest.map((asset, index) => ({ ...asset, assetIndex: index })),
      "Media order updated.",
    );
  } catch (value) {
    social.setErrorFromApi(value, "Failed to reorder media");
    error.value = social.error || "Failed to reorder media";
  } finally {
    saving.value = false;
  }
}

async function removeMedia(assetUrl: string) {
  if (editorVersions.value.length === 0 || selectedPostReadOnly.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    await updateEditorMedia(
      editorAssetManifest.value.filter((asset) => asset.url !== assetUrl),
      "Media removed.",
    );
  } catch (value) {
    social.setErrorFromApi(value, "Failed to remove this image");
    error.value = social.error || "Failed to remove this image";
  } finally {
    saving.value = false;
  }
}

function tiktokPrivacyLabel(level: TikTokPrivacyLevel): string {
  if (level === "PUBLIC_TO_EVERYONE") return "Everyone";
  if (level === "FOLLOWER_OF_CREATOR") return "Followers";
  if (level === "MUTUAL_FOLLOW_FRIENDS") return "Friends";
  return "Only me";
}

function resetTikTokDirectPostOptions() {
  tiktokCreatorInfoSequence += 1;
  tiktokCreatorInfo.value = null;
  tiktokCreatorInfoLoading.value = false;
  tiktokCreatorInfoError.value = "";
  tiktokPrivacyLevel.value = "";
  tiktokAllowComment.value = false;
  tiktokAllowDuet.value = false;
  tiktokAllowStitch.value = false;
  tiktokCommercialContent.value = false;
  tiktokBrandOrganic.value = false;
  tiktokBrandContent.value = false;
  tiktokIsAiGenerated.value = false;
  tiktokConsent.value = false;
  tiktokVideoDurationSeconds.value = null;
}

function captureTikTokVideoMetadata(event: Event) {
  const video = event.currentTarget as HTMLVideoElement | null;
  const duration = Number(video?.duration);
  tiktokVideoDurationSeconds.value =
    Number.isFinite(duration) && duration > 0 ? duration : null;
}

async function probeTikTokVideoDuration(): Promise<number | null> {
  if (tiktokVideoDurationSeconds.value) return tiktokVideoDurationSeconds.value;
  const asset = tiktokSettingsVersion.value?.assetManifest.find(isVideoAsset);
  if (!asset?.url || typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      resolve(duration);
    };
    const timeout = setTimeout(() => finish(null), 5_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      finish(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    video.onerror = () => finish(null);
    video.src = asset.url;
  });
}

async function loadTikTokCreatorInfo() {
  const version = tiktokSettingsVersion.value;
  const accountId = version?.targetAccountId;
  if (!version || !accountId) {
    tiktokCreatorInfoError.value =
      "Choose a connected TikTok account before using Direct Post.";
    return;
  }
  const sequence = ++tiktokCreatorInfoSequence;
  tiktokCreatorInfoLoading.value = true;
  tiktokCreatorInfoError.value = "";
  tiktokCreatorInfo.value = null;
  try {
    const [creatorInfo, duration] = await Promise.all([
      social.getTikTokCreatorInfo(accountId),
      probeTikTokVideoDuration(),
    ]);
    if (sequence !== tiktokCreatorInfoSequence) return;
    tiktokCreatorInfo.value = creatorInfo;
    tiktokVideoDurationSeconds.value = duration;
    if (
      tiktokPrivacyLevel.value &&
      !creatorInfo.privacyLevelOptions.includes(tiktokPrivacyLevel.value)
    ) {
      tiktokPrivacyLevel.value = "";
    }
    if (creatorInfo.commentDisabled) tiktokAllowComment.value = false;
    if (creatorInfo.duetDisabled) tiktokAllowDuet.value = false;
    if (creatorInfo.stitchDisabled) tiktokAllowStitch.value = false;
    accounts.value = await social.fetchSocialAccounts().catch(() => accounts.value);
  } catch (value) {
    if (sequence !== tiktokCreatorInfoSequence) return;
    social.setErrorFromApi(value, "TikTok Direct Post settings could not be loaded.");
    tiktokCreatorInfoError.value =
      social.error || "TikTok Direct Post settings could not be loaded.";
  } finally {
    if (sequence === tiktokCreatorInfoSequence) {
      tiktokCreatorInfoLoading.value = false;
    }
  }
}

function handleTikTokDeliveryModeChange() {
  if (tiktokDeliveryMode.value === "direct_publish") {
    void loadTikTokCreatorInfo();
  } else {
    resetTikTokDirectPostOptions();
  }
}

async function openTikTokSettings(version = publicationTikTokVersion.value) {
  if (!version || version.platform !== "tiktok") return;
  await flushPendingEditorSave();
  const current = versionById(version.id) || version;
  const previewDuration =
    selectedVersion.value?.id === current.id
      ? tiktokVideoDurationSeconds.value
      : null;
  tiktokSettingsVersionId.value = current.id;
  resetTikTokDirectPostOptions();
  const saved = savedTikTokSettings(current);
  tiktokDeliveryMode.value = saved?.deliveryMode || "direct_publish";
  if (saved?.deliveryMode === "direct_publish") {
    tiktokPrivacyLevel.value = saved.privacyLevel;
    tiktokAllowComment.value = saved.allowComment;
    tiktokAllowDuet.value = saved.allowDuet;
    tiktokAllowStitch.value = saved.allowStitch;
    tiktokBrandContent.value = saved.brandContent;
    tiktokBrandOrganic.value = saved.brandOrganic;
    tiktokCommercialContent.value = saved.brandContent || saved.brandOrganic;
    tiktokIsAiGenerated.value = saved.isAiGenerated;
    tiktokConsent.value = saved.consent;
    tiktokVideoDurationSeconds.value = saved.videoDurationSeconds;
  } else if (previewDuration) {
    tiktokVideoDurationSeconds.value = previewDuration;
  }
  showTikTokSettings.value = true;
  if (tiktokDeliveryMode.value === "direct_publish") {
    await loadTikTokCreatorInfo();
  }
}

function closeTikTokSettings() {
  showTikTokSettings.value = false;
  tiktokSettingsVersionId.value = null;
  resetTikTokDirectPostOptions();
}

async function saveTikTokSettings() {
  const version = tiktokSettingsVersion.value;
  if (
    !version ||
    tiktokSettingsSaving.value ||
    (
      tiktokDeliveryMode.value === "direct_publish" &&
      !tiktokDirectPostReady.value
    )
  ) return;

  const settings: TikTokPublishingSettings =
    tiktokDeliveryMode.value === "provider_draft"
      ? { deliveryMode: "provider_draft" }
      : {
        deliveryMode: "direct_publish",
        privacyLevel: tiktokPrivacyLevel.value as TikTokPrivacyLevel,
        allowComment: tiktokAllowComment.value,
        allowDuet: tiktokAllowDuet.value,
        allowStitch: tiktokAllowStitch.value,
        brandContent: tiktokCommercialContent.value && tiktokBrandContent.value,
        brandOrganic: tiktokCommercialContent.value && tiktokBrandOrganic.value,
        isAiGenerated: tiktokIsAiGenerated.value,
        consent: true,
        videoDurationSeconds: tiktokVideoDurationSeconds.value as number,
      };

  tiktokSettingsSaving.value = true;
  try {
    replaceVersion(await social.updatePostVersion(version.id, {
      publishingSettings: { tiktok: settings },
    }));
    toastSuccess(
      settings.deliveryMode === "direct_publish"
        ? "TikTok Direct Post settings saved for this Post."
        : "TikTok will receive this Post as a creator draft.",
    );
    closeTikTokSettings();
  } catch (value) {
    social.setErrorFromApi(value, "TikTok settings could not be saved.");
    tiktokCreatorInfoError.value =
      social.error || "TikTok settings could not be saved.";
  } finally {
    tiktokSettingsSaving.value = false;
  }
}

async function copyTikTokCaption() {
  const caption = editorBody.value;
  if (!caption.trim()) return;
  try {
    await navigator.clipboard.writeText(caption);
    tiktokCaptionCopied.value = true;
    toastSuccess("TikTok caption copied.");
    if (tiktokCaptionCopiedTimer) clearTimeout(tiktokCaptionCopiedTimer);
    tiktokCaptionCopiedTimer = setTimeout(() => {
      tiktokCaptionCopied.value = false;
      tiktokCaptionCopiedTimer = null;
    }, 2_000);
  } catch {
    toastError("Could not copy the TikTok caption.");
  }
}

function resetYouTubeSettings() {
  youtubeSettingsError.value = "";
  youtubePrivacyStatus.value = "public";
  youtubeMadeForKids.value = "";
  youtubeContainsSyntheticMedia.value = false;
}

async function openYouTubeSettings(
  version = publicationYouTubeVersion.value,
) {
  if (!version || version.platform !== "youtube") return;
  await flushPendingEditorSave();
  const current = versionById(version.id) || version;
  youtubeSettingsVersionId.value = current.id;
  resetYouTubeSettings();
  const saved = savedYouTubeSettings(current);
  if (saved) {
    youtubePrivacyStatus.value = saved.privacyStatus;
    youtubeMadeForKids.value = saved.madeForKids ? "yes" : "no";
    youtubeContainsSyntheticMedia.value = saved.containsSyntheticMedia;
  }
  showYouTubeSettings.value = true;
}

function closeYouTubeSettings() {
  showYouTubeSettings.value = false;
  youtubeSettingsVersionId.value = null;
  resetYouTubeSettings();
}

async function saveYouTubeSettings() {
  const version = youtubeSettingsVersion.value;
  const account = youtubeSettingsAccount.value;
  if (
    !version ||
    !account ||
    youtubeSettingsSaving.value ||
    !youtubePrivacyStatus.value ||
    !youtubeMadeForKids.value
  ) return;

  const settings: YouTubePublishingSettings = {
    privacyStatus: youtubePrivacyStatus.value,
    madeForKids: youtubeMadeForKids.value === "yes",
    containsSyntheticMedia: youtubeContainsSyntheticMedia.value,
  };

  youtubeSettingsSaving.value = true;
  try {
    const publishingDefaults = await social.updateSocialAccountPublishingDefaults(
      account.id,
      { youtube: settings },
    );
    accounts.value = accounts.value.map((candidate) =>
      candidate.id === account.id
        ? { ...candidate, publishingDefaults }
        : candidate,
    );
    toastSuccess("YouTube defaults saved for this channel.");
    closeYouTubeSettings();
  } catch (value) {
    social.setErrorFromApi(value, "YouTube settings could not be saved.");
    youtubeSettingsError.value =
      social.error || "YouTube settings could not be saved.";
  } finally {
    youtubeSettingsSaving.value = false;
  }
}

async function openSchedule() {
  await flushPendingEditorSave();
  const tiktokVersion = publicationTikTokVersion.value;
  if (tiktokVersion && !hasSavedTikTokSettings(tiktokVersion)) {
    if (!sharedEditor.value && selectedVersionId.value !== tiktokVersion.id) {
      selectVersion(tiktokVersion);
    }
    await openTikTokSettings(tiktokVersion);
    return;
  }
  const youtubeVersion = publicationYouTubeVersion.value;
  if (youtubeVersion && !hasSavedYouTubeSettings(youtubeVersion)) {
    if (!sharedEditor.value && selectedVersionId.value !== youtubeVersion.id) {
      selectVersion(youtubeVersion);
    }
    await openYouTubeSettings(youtubeVersion);
    return;
  }
  if (!canOpenSchedule.value) return;
  const start = new Date(Date.now() + 60 * 60 * 1000);
  scheduleDate.value = start.toISOString().slice(0, 10);
  scheduleTime.value = start.toTimeString().slice(0, 5);
  scheduleError.value = "";
  showSchedule.value = true;
}

async function schedulePost() {
  if (!canSchedule.value) return;
  const resolution = resolveLocalDateTimeToUtc(
    scheduleDate.value,
    scheduleTime.value,
    scheduleTimezone.value,
  );
  if (!resolution.ok) {
    scheduleError.value = "Choose a valid future date, time, and timezone.";
    return;
  }
  if (Date.parse(resolution.value) <= Date.now()) {
    scheduleError.value = "Schedule time must be in the future.";
    return;
  }
  const preparation = capturePublicationPreparation();
  if (!preparation) return;
  const snapshot = captureWorkspaceSnapshot();

  scheduling.value = true;
  scheduleError.value = "";
  error.value = "";
  showSchedule.value = false;
  applyOptimisticPublication(preparation, {
    publicationStatus: "scheduled",
    scheduledFor: resolution.value,
    timezone: scheduleTimezone.value,
  });

  try {
    const versions = await persistPublicationPreparation(preparation);
    const results = await Promise.allSettled(versions.map(async (version) => {
      const publication = await social.createPostVersionPublication(version.id, {
        scheduledFor: resolution.value,
        timezone: scheduleTimezone.value,
        requestContext: { surface: "social-editor", batch: true },
      });
      replaceVersion({
        ...version,
        scheduledFor: publication.scheduledFor,
        timezone: publication.timezone,
        publicationStatus: publication.status,
      });
      return publication;
    }));
    results.forEach((result, index) => {
      if (result.status === "rejected" && versions[index]) {
        replaceVersion(versions[index]!);
      }
    });
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    if (failed) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (firstFailure) {
        social.setErrorFromApi(firstFailure.reason, "One or more platforms could not be scheduled.");
      }
      const summary = `${succeeded} platform${succeeded === 1 ? "" : "s"} scheduled; ${failed} need attention. Successful schedules were kept.`;
      scheduleError.value = social.error ? `${summary} ${social.error}` : summary;
      error.value = scheduleError.value;
      toastError(scheduleError.value);
      if (succeeded === 0) activeMode.value = snapshot.activeMode;
      ensureVisibleSelection();
      return;
    }
    toastSuccess(`Post scheduled for ${succeeded} platform${succeeded === 1 ? "" : "s"}.`);
  } catch (value) {
    restoreWorkspaceSnapshot(snapshot);
    showSchedule.value = true;
    social.setErrorFromApi(value, "Failed to schedule this post");
    scheduleError.value = social.error || "Failed to schedule this post";
  } finally {
    scheduling.value = false;
  }
}

async function publishNow() {
  if (!canSubmitPublishNow.value) return;
  const preparation = capturePublicationPreparation();
  if (!preparation) return;
  const snapshot = captureWorkspaceSnapshot();

  scheduling.value = true;
  error.value = "";
  showSchedule.value = false;
  applyOptimisticPublication(preparation, {
    publicationStatus: "queued",
    scheduledFor: null,
    timezone: null,
  });

  try {
    const versions = await persistPublicationPreparation(preparation);
    const results = await Promise.allSettled(versions.map(async (version) => {
      const tiktok =
        version.platform === "tiktok"
          ? savedTikTokSettings(version)
          : null;
      const youtube =
        version.platform === "youtube"
          ? savedYouTubeSettings(version)
          : null;
      const publication = await social.publishPostVersion(
        version.id,
        tiktok || youtube
          ? {
          requestContext: {
            surface: "social-editor",
            batch: versions.length > 1,
            ...(tiktok ? { tiktok } : {}),
            ...(youtube ? { youtube } : {}),
          },
        }
          : {},
      );
      replaceVersion({
        ...version,
        publicationStatus: publication.status,
        platformPostUrl: publication.platformPostUrl,
        publishedAt: publication.publishedAt,
        failureClass: publication.failureClass,
        errorMessage: publication.errorMessage,
      });
      return publication;
    }));
    results.forEach((result, index) => {
      if (result.status === "rejected" && versions[index]) {
        replaceVersion(versions[index]!);
      }
    });
    const publications = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const failedPublications = publications.filter(
      (publication) => publication.status === "failed" || publication.status === "cancelled",
    );
    const failed = rejected.length + failedPublications.length;
    const succeeded = results.length - failed;
    if (failed > 0) {
      const providerMessage = failedPublications.find(
        (publication) => publication.errorMessage,
      )?.errorMessage;
      if (!providerMessage && rejected[0]) {
        social.setErrorFromApi(rejected[0].reason, "Failed to publish this post");
      }
      const failureReason =
        providerMessage ||
        social.error ||
        "One or more platforms could not start publishing.";
      const message = succeeded > 0
        ? `${succeeded} platform${succeeded === 1 ? "" : "s"} started; ${failed} failed. ${failureReason}`
        : failureReason;
      if (succeeded === 0) activeMode.value = snapshot.activeMode;
      ensureVisibleSelection();
      toastError(message);
      return;
    }
    const includesTikTok = versions.some((version) => version.platform === "tiktok");
    const includesTikTokDirectPost =
      versions.some(
        (version) =>
          version.platform === "tiktok" &&
          savedTikTokSettings(version)?.deliveryMode === "direct_publish",
      );
    const inProgress = publications.filter(
      (publication) =>
        publication.status === "queued" ||
        publication.status === "publishing" ||
        publication.status === "scheduled",
    );
    if (inProgress.length > 0) {
      toast(
        `Sending to ${inProgress.length} platform${inProgress.length === 1 ? "" : "s"}…` +
        (
          includesTikTokDirectPost
            ? " TikTok is processing the Direct Post."
            : includesTikTok
              ? " TikTok will receive a creator draft to finish in the app."
              : ""
        ),
      );
    } else if (includesTikTok) {
      toastSuccess(
        includesTikTokDirectPost
          ? succeeded === 1
            ? "TikTok Direct Post submitted."
            : `Published to ${succeeded} platforms, including TikTok.`
          : succeeded === 1
            ? "TikTok draft sent to your inbox."
            : `Published to ${succeeded} platforms. The TikTok draft was sent to your inbox.`,
      );
    } else {
      toastSuccess(`Published to ${succeeded} platform${succeeded === 1 ? "" : "s"}.`);
    }
  } catch (value) {
    restoreWorkspaceSnapshot(snapshot);
    social.setErrorFromApi(value, "Failed to publish this post");
    toastError(social.error || "Failed to publish this post");
  } finally {
    scheduling.value = false;
  }
}

watch(mediaFolderId, () => {
  if (showMediaPicker.value) void loadMediaFiles();
});

watch(destinationContentType, () => {
  selectedDestinationAccountIds.value = selectedDestinationAccountIds.value.filter((accountId) => {
    const option = destinationAccounts.value.find((item) => item.account.id === accountId);
    return Boolean(option && (option.compatible || destinationLocked(option.account)));
  });
});

watch(tiktokPrivacyLevel, (privacyLevel) => {
  if (privacyLevel === "SELF_ONLY") {
    tiktokBrandContent.value = false;
  }
});

watch(tiktokCommercialContent, (enabled) => {
  if (enabled) return;
  tiktokBrandOrganic.value = false;
  tiktokBrandContent.value = false;
});

watch(
  () =>
    selectedVersion.value?.platform === "tiktok"
      ? selectedVersion.value.assetManifest.map((asset) => asset.url).join("|")
      : "",
  () => {
    tiktokVideoDurationSeconds.value = null;
  },
);

watch(editorLinkUrl, (url) => {
  scheduleLinkPreview(url);
}, { immediate: true });

watch(selectedSiteId, () => {
  if (initializing.value) return;
  void loadWorkspace();
});

onMounted(async () => {
  await initializeWorkspace();
  deliveryPollTimer = setInterval(() => {
    void refreshDeliveryStates();
  }, 5_000);
});

onUnmounted(() => {
  if (deliveryPollTimer) clearInterval(deliveryPollTimer);
  clearEditorSaveTimer();
  if (linkPreviewTimer) clearTimeout(linkPreviewTimer);
  if (tiktokCaptionCopiedTimer) clearTimeout(tiktokCaptionCopiedTimer);
  linkPreviewSequence += 1;
});

function currentQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name)?.trim() || null;
}

</script>

<template>
  <div class="social-page">
    <main class="social-main">
      <h1 class="sr-only">Social Publishing</h1>

      <header class="social-toolbar">
        <div class="toolbar-actions">
          <Button
            v-if="localDemoAvailable"
            color="outline"
            shape="soft"
            size="compact"
            type="button"
            :disabled="saving || !currentSite"
            @click="loadLocalDemo"
          >
            Load demo
          </Button>
          <Button
            :color="activeAccounts.length === 0 ? 'primary' : 'outline'"
            shape="soft"
            size="compact"
            type="button"
            :disabled="initializing || !currentSite"
            @click="showAccounts = true"
          >
            <UiIcon name="Link" :size="18" aria-hidden="true" />
            {{ activeAccounts.length === 0 ? 'Connect accounts' : 'Social accounts' }}
          </Button>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            aria-label="New Post"
            title="New Post"
            :disabled="!currentSite || draftAccounts.length === 0 || saving"
            @click="openCreateDraft"
          >
            <UiIcon name="SquarePen" :size="18" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div v-if="initializing" class="empty-state" role="status">
        Loading social publishing…
      </div>

      <div v-else-if="sites.sites.length === 0" class="empty-state">
        <strong>Create your website to start publishing.</strong>
        <RouterLink to="/create">Create your website</RouterLink>
      </div>

      <div v-else class="social-workspace-shell">
        <nav class="social-tabs-rail" aria-label="Social publishing views">
          <WorkspaceTabs
            :tabs="modeTabs"
            :model-value="activeMode"
            aria-label="Social publishing views"
            semantics="navigation"
            @update:model-value="setActiveMode"
          />
        </nav>

        <div
          :class="['social-workspace', { 'social-workspace--mobile-detail-open': mobileDetailOpen }]"
          :aria-busy="loading"
        >
          <section class="post-list" aria-label="Social posts">
          <div v-if="loading" class="empty-state">Loading social posts…</div>
          <div v-else-if="visiblePosts.length === 0" class="empty-state">
            <strong>No {{ activeMode }} yet.</strong>
            <Button
              v-if="activeMode === 'drafts'"
              color="outline"
              shape="soft"
              size="compact"
              type="button"
              :disabled="draftAccounts.length === 0 || saving"
              @click="openCreateDraft"
            >
              Create a Post
            </Button>
          </div>
          <template v-else>
            <article
              v-for="detail in visiblePosts"
              :key="detail.post.id"
              class="post-row"
              :class="{ 'post-row--active': selectedPostId === detail.post.id }"
            >
              <button
                type="button"
                class="post-row__select"
                :aria-current="selectedPostId === detail.post.id ? 'true' : undefined"
                @click="selectPost(detail)"
              >
                <span class="post-row__meta">
                  <span
                    v-if="activeMode === 'scheduled' && scheduledDateFor(detail)"
                    class="post-row__schedule"
                  >
                    <span>Scheduled for</span>
                    <time :datetime="scheduledDateFor(detail)!">
                      {{ formatDate(scheduledDateFor(detail)) }}
                    </time>
                  </span>
                  <time v-else :datetime="detail.post.updatedAt">
                    {{ formatDate(detail.post.updatedAt) }}
                  </time>
                </span>
                <strong>{{ postPreviewText(detail) }}</strong>
                <span class="post-row__footer">
                  <span class="platform-list">
                    <span v-for="version in visibleVersionsFor(detail)" :key="version.id" class="platform-chip" :title="accountLabel(version)">
                      <span :class="['social-account-avatar', 'social-account-avatar--compact', `social-account-avatar--${version.platform}`]" aria-hidden="true">
                        <img
                          v-if="accountAvatarUrl(version)"
                          class="social-account-avatar__image"
                          :src="accountAvatarUrl(version)!"
                          alt=""
                          referrerpolicy="no-referrer"
                        />
                        <template v-else>{{ accountInitials(version) }}</template>
                        <span class="social-account-avatar__platform">
                          <svg viewBox="0 0 24 24"><path :d="platformIconPath(version.platform)" /></svg>
                        </span>
                      </span>
                      <span class="sr-only">{{ accountLabel(version) }}</span>
                    </span>
                  </span>
                </span>
              </button>
            </article>
          </template>
          </section>

          <section v-if="selectedPost" class="post-detail" aria-live="polite">
          <header class="detail-header">
            <Button
              class="detail-back-btn"
              color="ghost"
              shape="soft"
              size="compact"
              icon-only
              type="button"
              title="Back"
              aria-label="Back to social post list"
              @click="closeMobileDetail"
            >
              <UiIcon name="ArrowLeft" :size="17" aria-hidden="true" />
            </Button>
            <a
              v-if="externalSourceUrl(selectedPost)"
              class="source-link"
              :href="externalSourceUrl(selectedPost)!"
              target="_blank"
              rel="noopener noreferrer"
            >
              View source <UiIcon name="ExternalLink" :size="14" aria-hidden="true" />
            </a>
          </header>

          <aside
            v-if="selectedPostReadOnly"
            class="state-banner read-only-banner"
            aria-label="Imported Post is read-only"
          >
            <strong>Imported Post — read-only</strong>
            <span>
              This legacy content is preserved for reference and Publication history. Create a
              source-backed Post to edit, approve, schedule, or publish it again.
            </span>
          </aside>

          <aside
            v-if="selectedVersionDeliveryError"
            class="state-banner state-banner--error delivery-error-banner"
            role="alert"
          >
            <strong>{{ selectedVersionDeliveryHeading }}</strong>
            <span>{{ selectedVersionDeliveryError }}</span>
          </aside>

          <div class="version-tabs" role="tablist" aria-label="Post versions">
            <button
              v-if="selectedVisibleVersions.length > 1"
              type="button"
              role="tab"
              :aria-selected="sharedEditor"
              :class="['version-tab', 'version-tab--shared', { 'version-tab--active': sharedEditor }]"
              title="Edit shared copy and media for every selected platform"
              @click="selectSharedVersions()"
            >
              <span>All</span>
            </button>
            <button
              v-for="version in selectedVisibleVersions"
              :key="version.id"
              type="button"
              role="tab"
              :aria-selected="!sharedEditor && selectedVersionId === version.id"
              :class="['version-tab', { 'version-tab--active': !sharedEditor && selectedVersionId === version.id }]"
              :title="accountLabel(version)"
              @click="selectVersion(version)"
            >
              <span :class="['social-account-avatar', `social-account-avatar--${version.platform}`]" aria-hidden="true">
                <img
                  v-if="accountAvatarUrl(version)"
                  class="social-account-avatar__image"
                  :src="accountAvatarUrl(version)!"
                  alt=""
                  referrerpolicy="no-referrer"
                />
                <template v-else>{{ accountInitials(version) }}</template>
                <span class="social-account-avatar__platform">
                  <svg viewBox="0 0 24 24"><path :d="platformIconPath(version.platform)" /></svg>
                </span>
              </span>
              <span class="sr-only">{{ accountLabel(version) }}</span>
              <span
                v-if="
                  (version.platform === 'tiktok' && !hasSavedTikTokSettings(version)) ||
                  (version.platform === 'youtube' && !hasSavedYouTubeSettings(version))
                "
                class="version-tab__setup-dot"
                aria-hidden="true"
              />
              <span
                v-if="version.platform === 'tiktok' && !hasSavedTikTokSettings(version)"
                class="sr-only"
              >
                TikTok publishing review required
              </span>
              <span
                v-if="version.platform === 'youtube' && !hasSavedYouTubeSettings(version)"
                class="sr-only"
              >
                YouTube publishing review required
              </span>
            </button>
            <button
              v-if="!selectedPostReadOnly && activeMode === 'drafts'"
              type="button"
              class="version-tab version-tab--add"
              aria-label="Add or remove publishing platforms"
              title="Add or remove platforms"
              @click="openManageDestinations"
            >
              <UiIcon name="Plus" :size="18" aria-hidden="true" />
            </button>
          </div>

          <div
            v-if="selectedVersion"
            :class="['version-workspace', { 'version-workspace--shared': sharedEditor }]"
          >
            <div class="version-editor">
              <div v-if="sharedEditor && (sharedBodyMixed || sharedMediaMixed)" class="state-banner shared-variation-notice" role="status">
                Some platforms already have custom {{ sharedBodyMixed && sharedMediaMixed ? 'copy and media' : sharedBodyMixed ? 'copy' : 'media' }}. Saving here will replace those custom fields across all selected platforms.
              </div>
              <label v-if="!sharedEditor && selectedVersion.platform === 'youtube'" class="field">
                <span>YouTube title</span>
                <input
                  v-model="editorTitle"
                  type="text"
                  maxlength="100"
                  :readonly="selectedPostReadOnly || selectedPostOptimistic"
                  required
                  @input="scheduleEditorSave"
                  @blur="flushPendingEditorSave"
                />
              </label>
              <label class="field">
                <textarea
                  v-model="editorBody"
                  rows="6"
                  :aria-label="selectedVersion.platform === 'youtube' && !sharedEditor ? 'Caption' : 'Post text'"
                  :readonly="selectedPostReadOnly || selectedPostOptimistic"
                  @input="scheduleEditorSave"
                  @blur="flushPendingEditorSave"
                />
              </label>
              <div class="editor-validation-summary" aria-live="polite">
                <span>{{ Array.from(editorBody).length.toLocaleString() }} characters</span>
                <Button
                  v-if="
                    publicationTikTokVersion &&
                    (sharedEditor || selectedVersion?.platform === 'tiktok')
                  "
                  class="tiktok-caption-copy"
                  color="ghost"
                  shape="soft"
                  size="compact"
                  icon-only
                  type="button"
                  :disabled="!editorBody.trim()"
                  :aria-label="tiktokCaptionCopied ? 'TikTok caption copied' : 'Copy TikTok caption'"
                  :title="tiktokCaptionCopied ? 'Copied' : 'Copy TikTok caption'"
                  @click="copyTikTokCaption"
                >
                  <UiIcon
                    :name="tiktokCaptionCopied ? 'Check' : 'Copy'"
                    :size="14"
                    aria-hidden="true"
                  />
                </Button>
                <span v-if="!sharedEditor && targetValidations.find((item) => item.version.id === selectedVersionId)?.issue" class="validation-issue">
                  {{ targetValidations.find((item) => item.version.id === selectedVersionId)?.issue }}
                </span>
              </div>

              <div v-if="!selectedPostReadOnly && !selectedPostOptimistic" class="media-attachments">
                <div class="media-attachments__toolbar">
                  <Button color="ghost" shape="soft" size="compact" type="button" :disabled="saving" @click="openMediaPicker">
                    <UiIcon name="Images" :size="17" aria-hidden="true" />
                    Add media
                  </Button>
                  <span v-if="editorAssetManifest.length > 1">{{ editorAssetManifest.length }} attached</span>
                </div>
                <div v-if="editorAssetManifest.length" class="media-attachments__items">
                  <figure v-for="(asset, index) in editorAssetManifest" :key="asset.url" class="media-attachment">
                    <div class="media-attachment__preview">
                      <img v-if="!isVideoAsset(asset)" :src="asset.url" :alt="asset.altText || asset.filename || 'Attached media'" />
                      <video v-else :src="asset.url" muted preload="metadata" />
                      <Button class="media-attachment__remove" color="ghost" shape="soft" size="compact" icon-only type="button" :aria-label="`Remove ${asset.filename || 'media'}`" @click="removeMedia(asset.url)">
                        <UiIcon name="X" :size="14" aria-hidden="true" />
                      </Button>
                    </div>
                    <div v-if="editorAssetManifest.length > 1" class="media-attachment__order">
                      <Button class="media-attachment__move" color="ghost" shape="soft" size="compact" icon-only type="button" :disabled="saving || index === 0" :aria-label="`Move ${asset.filename || 'media'} earlier`" @click="moveMedia(index, -1)">
                        <UiIcon name="ChevronLeft" :size="15" aria-hidden="true" />
                      </Button>
                      <span aria-hidden="true">{{ index + 1 }}</span>
                      <Button class="media-attachment__move" color="ghost" shape="soft" size="compact" icon-only type="button" :disabled="saving || index === editorAssetManifest.length - 1" :aria-label="`Move ${asset.filename || 'media'} later`" @click="moveMedia(index, 1)">
                        <UiIcon name="ChevronRight" :size="15" aria-hidden="true" />
                      </Button>
                    </div>
                  </figure>
                </div>
              </div>

              <div v-if="!selectedPostReadOnly && !selectedPostOptimistic" class="editor-actions">
                <Button color="neutral" shape="soft" size="compact" type="button" :disabled="saving || scheduling || !canOpenSchedule" @click="openSchedule">
                  <template #icon>
                    <UiIcon
                      :name="canSchedule ? 'CalendarClock' : 'Send'"
                      :size="16"
                      aria-hidden="true"
                    />
                  </template>
                  {{ publicationIsYouTubeOnly ? 'Upload' : canSchedule ? 'Schedule' : 'Publish' }}
                </Button>
                <Button
                  v-if="publishingCheckIssueCount"
                  class="editor-actions__checks"
                  color="ghost"
                  shape="soft"
                  size="compact"
                  icon-only
                  type="button"
                  :aria-label="publishingChecksLabel"
                  :title="publishingChecksLabel"
                  @click="showPublishingChecks = true"
                >
                  <UiIcon name="Info" :size="19" aria-hidden="true" />
                </Button>
                <Button
                  v-if="
                    publicationTikTokVersion &&
                    (sharedEditor || selectedVersion?.platform === 'tiktok')
                  "
                  class="editor-actions__settings"
                  color="ghost"
                  shape="soft"
                  size="compact"
                  type="button"
                  :disabled="saving || scheduling"
                  @click="openTikTokSettings(publicationTikTokVersion)"
                >
                  <UiIcon name="SlidersHorizontal" :size="16" aria-hidden="true" />
                  Review settings
                </Button>
                <Button
                  v-if="
                    publicationYouTubeVersion &&
                    (sharedEditor || selectedVersion?.platform === 'youtube')
                  "
                  class="editor-actions__settings"
                  color="ghost"
                  shape="soft"
                  size="compact"
                  type="button"
                  :disabled="saving || scheduling"
                  @click="openYouTubeSettings(publicationYouTubeVersion)"
                >
                  <UiIcon name="SlidersHorizontal" :size="16" aria-hidden="true" />
                  YouTube settings
                </Button>
                <Button
                  v-if="canDeleteDraft"
                  class="editor-actions__delete"
                  color="danger"
                  shape="soft"
                  size="compact"
                  icon-only
                  type="button"
                  :aria-label="deleteActionLabel"
                  :title="deleteActionLabel"
                  :disabled="saving || scheduling || deleting"
                  @click="requestDeleteDraft"
                >
                  <UiIcon name="Trash2" :size="16" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <aside
              v-if="!sharedEditor"
              :class="[
                'post-preview',
                `post-preview--${selectedVersion.platform}`,
                {
                  'post-preview--youtube-short': selectedVersion.platform === 'youtube',
                  'post-preview--instagram-reel':
                    (selectedVersion.platform === 'instagram' ||
                      selectedVersion.platform === 'instagram_business') &&
                    isShortVideoVersion(selectedVersion),
                },
              ]"
              aria-label="Post preview"
            >
              <template v-if="selectedVersion.platform === 'tiktok'">
                <div class="tiktok-preview__platform-bar">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="platformIconPath(selectedVersion.platform)" /></svg>
                  <span>TikTok preview</span>
                </div>
                <div class="tiktok-preview__stage">
                  <template v-if="selectedVersion.assetManifest.length">
                    <video
                      v-if="isVideoAsset(selectedVersion.assetManifest[0]!)"
                      :src="selectedVersion.assetManifest[0]!.url"
                      controls
                      muted
                      playsinline
                      preload="metadata"
                      class="tiktok-preview__media"
                      :aria-label="selectedVersion.assetManifest[0]!.altText || selectedVersion.assetManifest[0]!.filename || 'TikTok video preview'"
                      @loadedmetadata="captureTikTokVideoMetadata"
                    />
                    <img
                      v-else
                      :src="selectedVersion.assetManifest[0]!.url"
                      :alt="selectedVersion.assetManifest[0]!.altText || selectedVersion.assetManifest[0]!.filename || 'TikTok post preview'"
                      class="tiktok-preview__media"
                    />
                  </template>
                  <div v-else class="tiktok-preview__empty">
                    <UiIcon name="Play" :size="28" aria-hidden="true" />
                    <span>Add a video to preview your TikTok</span>
                  </div>

                  <div class="tiktok-preview__rail" aria-hidden="true">
                    <span class="tiktok-preview__profile-avatar">
                      <img
                        v-if="accountAvatarUrl(selectedVersion)"
                        :src="accountAvatarUrl(selectedVersion) || undefined"
                        alt=""
                        referrerpolicy="no-referrer"
                      />
                      <span v-else>{{ accountInitials(selectedVersion) }}</span>
                    </span>
                    <span class="tiktok-preview__rail-action">
                      <UiIcon name="Heart" :size="25" />
                      <strong>22</strong>
                    </span>
                    <span class="tiktok-preview__rail-action">
                      <UiIcon name="MessageCircle" :size="25" />
                      <strong>Add 1st</strong>
                    </span>
                    <span class="tiktok-preview__rail-action">
                      <UiIcon name="Bookmark" :size="25" />
                      <strong>0</strong>
                    </span>
                    <span class="tiktok-preview__rail-action">
                      <UiIcon name="Ellipsis" :size="25" />
                    </span>
                  </div>

                  <div class="tiktok-preview__bottom-fade" aria-hidden="true" />
                  <div class="tiktok-preview__caption">
                    <div class="tiktok-preview__caption-author">
                      <strong>{{ previewAccountHandle(selectedVersion) }}</strong>
                      <span>· now</span>
                    </div>
                    <p>{{ editorBody || 'Your TikTok caption will appear here.' }}</p>
                    <span class="tiktok-preview__sound">♫ Original sound</span>
                  </div>

                  <div class="tiktok-preview__progress" aria-hidden="true">
                    <span />
                  </div>
                </div>
              </template>
              <template v-else-if="selectedVersion.platform === 'youtube'">
                <div class="short-video-preview__platform-bar">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="platformIconPath(selectedVersion.platform)" /></svg>
                  <span>YouTube Short</span>
                </div>
                <div class="short-video-preview__stage youtube-short-preview__stage">
                  <template v-if="selectedVersion.assetManifest[0]">
                    <video
                      v-if="isVideoAsset(selectedVersion.assetManifest[0])"
                      :src="selectedVersion.assetManifest[0].url"
                      controls
                      muted
                      playsinline
                      preload="metadata"
                      class="short-video-preview__media"
                      :aria-label="selectedVersion.assetManifest[0].altText || selectedVersion.assetManifest[0].filename || 'YouTube Short video preview'"
                    />
                    <img
                      v-else
                      :src="selectedVersion.assetManifest[0].url"
                      :alt="selectedVersion.assetManifest[0].altText || selectedVersion.assetManifest[0].filename || 'YouTube Short preview'"
                      class="short-video-preview__media"
                    />
                  </template>
                  <div v-else class="short-video-preview__empty">
                    <UiIcon name="Play" :size="28" aria-hidden="true" />
                    <span>Add a video to preview your Short</span>
                  </div>

                  <div class="short-video-preview__bottom-fade" aria-hidden="true" />
                  <div class="youtube-short-preview__caption">
                    <div class="youtube-short-preview__channel">
                      <span class="short-video-preview__avatar">
                        <img
                          v-if="accountAvatarUrl(selectedVersion)"
                          :src="accountAvatarUrl(selectedVersion) || undefined"
                          alt=""
                          referrerpolicy="no-referrer"
                        />
                        <span v-else>{{ accountInitials(selectedVersion) }}</span>
                      </span>
                      <strong>{{ previewAccountHandle(selectedVersion) }}</strong>
                      <span class="youtube-short-preview__subscribe">Subscribe</span>
                    </div>
                    <p>{{ editorTitle || editorBody || 'Your Short title will appear here.' }}</p>
                  </div>
                  <div class="youtube-short-preview__progress" aria-hidden="true"><span /></div>
                </div>
                <a
                  v-if="selectedVersion.platformPostUrl"
                  class="short-video-preview__published-link"
                  :href="selectedVersion.platformPostUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View published Short
                </a>
              </template>
              <template
                v-else-if="
                  (selectedVersion.platform === 'instagram' ||
                    selectedVersion.platform === 'instagram_business') &&
                  isShortVideoVersion(selectedVersion)
                "
              >
                <div class="short-video-preview__platform-bar">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="platformIconPath(selectedVersion.platform)" /></svg>
                  <span>Instagram Reel</span>
                </div>
                <div class="short-video-preview__stage instagram-reel-preview__stage">
                  <template v-if="selectedVersion.assetManifest[0]">
                    <video
                      v-if="isVideoAsset(selectedVersion.assetManifest[0])"
                      :src="selectedVersion.assetManifest[0].url"
                      controls
                      muted
                      playsinline
                      preload="metadata"
                      class="short-video-preview__media"
                      :aria-label="selectedVersion.assetManifest[0].altText || selectedVersion.assetManifest[0].filename || 'Instagram Reel video preview'"
                    />
                    <img
                      v-else
                      :src="selectedVersion.assetManifest[0].url"
                      :alt="selectedVersion.assetManifest[0].altText || selectedVersion.assetManifest[0].filename || 'Instagram Reel preview'"
                      class="short-video-preview__media"
                    />
                  </template>
                  <div v-else class="short-video-preview__empty">
                    <UiIcon name="Play" :size="28" aria-hidden="true" />
                    <span>Add a video to preview your Reel</span>
                  </div>

                  <div class="instagram-reel-preview__topbar" aria-hidden="true">
                    <strong>Reels</strong>
                    <span>
                      <UiIcon name="Plus" :size="22" />
                      <UiIcon name="SlidersHorizontal" :size="21" />
                    </span>
                  </div>

                  <div class="instagram-reel-preview__rail" aria-hidden="true">
                    <UiIcon name="Heart" :size="25" />
                    <UiIcon name="MessageCircle" :size="25" />
                    <UiIcon name="Send" :size="25" />
                    <UiIcon name="Ellipsis" :size="25" />
                  </div>

                  <div class="short-video-preview__bottom-fade" aria-hidden="true" />
                  <div class="instagram-reel-preview__caption">
                    <div class="instagram-reel-preview__identity">
                      <span class="short-video-preview__avatar">
                        <img
                          v-if="accountAvatarUrl(selectedVersion)"
                          :src="accountAvatarUrl(selectedVersion) || undefined"
                          alt=""
                          referrerpolicy="no-referrer"
                        />
                        <span v-else>{{ accountInitials(selectedVersion) }}</span>
                      </span>
                      <strong>{{ previewAccountHandle(selectedVersion) }}</strong>
                      <span class="instagram-reel-preview__follow">Follow</span>
                    </div>
                    <p>{{ editorBody || 'Your Reel caption will appear here.' }}</p>
                  </div>
                </div>
                <a
                  v-if="selectedVersion.platformPostUrl"
                  class="short-video-preview__published-link"
                  :href="selectedVersion.platformPostUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View published Reel
                </a>
              </template>
              <template v-else>
                <div class="preview-platform-bar">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="platformIconPath(selectedVersion.platform)" /></svg>
                  <span>{{ platformLabel(selectedVersion.platform) }}</span>
                </div>
                <div class="preview-profile">
                  <span class="preview-avatar">
                    <img
                      v-if="accountAvatarUrl(selectedVersion)"
                      :src="accountAvatarUrl(selectedVersion) || undefined"
                      alt=""
                      referrerpolicy="no-referrer"
                    />
                    <span v-else>{{ accountInitials(selectedVersion) }}</span>
                  </span>
                  <span><strong>{{ previewAccountName(selectedVersion) }}</strong><small>{{ previewAccountHandle(selectedVersion) }} · now</small></span>
                  <UiIcon name="Ellipsis" :size="18" aria-hidden="true" />
                </div>
                <p>{{ editorBody || 'Your Post preview will appear here.' }}</p>
                <div
                  v-if="selectedVersion.assetManifest.length"
                  :class="[
                    'preview-media',
                    {
                      'preview-media--gallery':
                        selectedVersion.assetManifest.length > 1 &&
                        selectedVersion.platform !== 'instagram' &&
                        selectedVersion.platform !== 'instagram_business',
                    },
                  ]"
                >
                  <template v-if="(selectedVersion.platform === 'instagram' || selectedVersion.platform === 'instagram_business') && selectedVersion.assetManifest.length > 1">
                    <div class="instagram-preview-carousel" aria-label="Instagram image carousel">
                      <div class="instagram-preview-carousel__track" :style="{ transform: `translateX(-${instagramPreviewIndex * 100}%)` }">
                        <div v-for="(asset, index) in selectedVersion.assetManifest" :key="`${asset.url}-${index}`" class="instagram-preview-carousel__slide">
                          <video
                            v-if="isVideoAsset(asset)"
                            :src="asset.url"
                            controls
                            muted
                            preload="metadata"
                            :aria-label="asset.altText || asset.filename || 'Post video'"
                          />
                          <img v-else :src="asset.url" :alt="asset.altText || asset.filename || 'Post image'" />
                        </div>
                      </div>
                      <div class="instagram-preview-carousel__dots" role="tablist" aria-label="Choose carousel image">
                        <button
                          v-for="(_, index) in selectedVersion.assetManifest"
                          :key="index"
                          type="button"
                          :class="{ 'is-active': instagramPreviewIndex === index }"
                          :aria-label="`Show image ${index + 1} of ${selectedVersion.assetManifest.length}`"
                          :aria-selected="instagramPreviewIndex === index"
                          role="tab"
                          @click="setInstagramPreview(index)"
                        />
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <template v-for="(asset, index) in selectedVersion.assetManifest" :key="`${asset.url}-${index}`">
                    <video
                      v-if="isVideoAsset(asset)"
                      :src="asset.url"
                      controls
                      muted
                      preload="metadata"
                      :aria-label="asset.altText || asset.filename || 'Post video'"
                    />
                    <img
                      v-else
                      :src="asset.url"
                      :alt="asset.altText || asset.filename || 'Post image'"
                    />
                    </template>
                  </template>
                  <span v-if="selectedVersion.assetManifest.length > 1 && selectedVersion.platform !== 'instagram' && selectedVersion.platform !== 'instagram_business'" class="preview-media__count">
                    <UiIcon name="Copy" :size="14" aria-hidden="true" />
                    {{ selectedVersion.assetManifest.length }}
                  </span>
                </div>
                <a
                  v-if="editorLinkUrl"
                  class="preview-link-card"
                  :href="linkPreview?.url || editorLinkUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    v-if="linkPreview?.imageUrl"
                    class="preview-link-card__image"
                    :src="linkPreview.imageUrl"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="hidePreviewImage"
                  />
                  <span class="preview-link-card__content">
                    <span class="preview-link-card__eyebrow">
                      {{ linkPreview?.siteName || previewLinkHost(editorBody) }}
                    </span>
                    <strong>{{ linkPreview?.title || editorLinkUrl }}</strong>
                    <span v-if="linkPreview?.description" class="preview-link-card__description">
                      {{ linkPreview.description }}
                    </span>
                    <span v-else-if="linkPreviewLoading" class="preview-link-card__loading">
                      Loading preview…
                    </span>
                  </span>
                </a>
                <a v-if="selectedVersion.platformPostUrl" :href="selectedVersion.platformPostUrl" target="_blank" rel="noopener noreferrer">
                  View published Post
                </a>
                <div class="preview-actions" aria-hidden="true">
                  <template v-if="selectedVersion.platform === 'x'">
                    <UiIcon name="MessageCircle" :size="18" />
                    <UiIcon name="Redo" :size="18" />
                    <UiIcon name="Heart" :size="18" />
                    <UiIcon name="Activity" :size="18" />
                    <UiIcon name="Bookmark" :size="18" />
                    <UiIcon name="Upload" :size="18" />
                  </template>
                  <template v-else-if="selectedVersion.platform === 'instagram' || selectedVersion.platform === 'instagram_business'">
                    <UiIcon name="Heart" :size="20" />
                    <UiIcon name="MessageCircle" :size="20" />
                    <UiIcon name="Redo" :size="20" />
                    <UiIcon name="Send" :size="20" />
                    <UiIcon name="Bookmark" class="preview-actions__bookmark" :size="20" />
                  </template>
                  <template v-else>
                    <UiIcon name="MessageCircle" :size="17" />
                    <UiIcon name="Redo" :size="17" />
                    <UiIcon name="Heart" :size="17" />
                    <UiIcon name="Send" :size="17" />
                  </template>
                </div>
              </template>
            </aside>
          </div>

          </section>

          <section v-else class="detail-empty" aria-label="No social Post selected">
            <UiIcon name="SquarePen" :size="24" aria-hidden="true" />
            <p>Select a Post to review it, or write a new one.</p>
          </section>
        </div>
      </div>
    </main>

    <AppDialog :open="showDestinations" labelled-by="social-destinations-title" @close="showDestinations = false">
      <section class="social-destinations-dialog">
        <header>
          <div>
            <h2 id="social-destinations-title">{{ destinationMode === 'create' ? 'Choose publishing platforms' : 'Publishing platforms' }}</h2>
          </div>
          <Button color="ghost" shape="soft" size="compact" icon-only type="button" aria-label="Close platform picker" @click="showDestinations = false">
            <UiIcon name="X" :size="17" aria-hidden="true" />
          </Button>
        </header>

        <fieldset class="content-type-picker">
          <legend>What are you posting?</legend>
          <label :class="{ 'is-selected': destinationContentType === 'short_video' }">
            <input v-model="destinationContentType" type="radio" value="short_video" />
            <UiIcon name="Play" :size="17" aria-hidden="true" />
            <span>Short video</span>
          </label>
          <label :class="{ 'is-selected': destinationContentType === 'image' || destinationContentType === 'carousel' }">
            <input v-model="destinationContentType" type="radio" value="image" />
            <UiIcon name="Images" :size="17" aria-hidden="true" />
            <span>Images</span>
          </label>
          <label :class="{ 'is-selected': destinationContentType === 'text' }">
            <input v-model="destinationContentType" type="radio" value="text" />
            <UiIcon name="FileText" :size="17" aria-hidden="true" />
            <span>Text</span>
          </label>
        </fieldset>

        <div class="destination-options" role="group" aria-label="Connected platform accounts">
          <button
            v-for="option in destinationAccounts"
            :key="option.account.id"
            type="button"
            :class="['destination-option', { 'is-selected': selectedDestinationAccountIds.includes(option.account.id) }]"
            :aria-pressed="selectedDestinationAccountIds.includes(option.account.id)"
            :disabled="!option.compatible && !destinationLocked(option.account)"
            @click="toggleDestinationAccount(option.account.id)"
          >
            <span :class="['social-account-avatar', `social-account-avatar--${option.account.platform}`]" aria-hidden="true">
              <img
                v-if="option.account.avatarUrl"
                class="social-account-avatar__image"
                :src="option.account.avatarUrl"
                alt=""
                referrerpolicy="no-referrer"
              />
              <template v-else>{{ accountInitialsForAccount(option.account) }}</template>
              <span class="social-account-avatar__platform">
                <svg viewBox="0 0 24 24"><path :d="platformIconPath(option.account.platform as SocialPlatform)" /></svg>
              </span>
            </span>
            <span class="destination-option__copy">
              <strong>{{ platformLabel(option.account.platform) }}</strong>
              <small>{{ accountDisplayName(option.account) }} · {{ option.capability?.deliveryLabel }}</small>
              <small v-if="!option.compatible">{{ destinationLocked(option.account) ? 'Publication history keeps this platform attached.' : `Not available for ${destinationContentType.replace('_', ' ')}.` }}</small>
            </span>
            <UiIcon
              :name="selectedDestinationAccountIds.includes(option.account.id) ? (destinationLocked(option.account) ? 'Shield' : 'Check') : 'Plus'"
              :size="17"
              aria-hidden="true"
            />
          </button>
        </div>

        <p v-if="destinationError" class="form-error" role="alert">{{ destinationError }}</p>
        <footer>
          <div class="inline-actions">
            <Button color="outline" shape="soft" size="compact" type="button" :disabled="saving" @click="showDestinations = false">Cancel</Button>
            <Button color="primary" shape="soft" size="compact" type="button" :disabled="saving || selectedDestinationAccountIds.length === 0" @click="saveDestinations">
              {{ saving ? 'Saving…' : destinationMode === 'create' ? 'Create draft' : 'Update platforms' }}
            </Button>
          </div>
        </footer>
      </section>
    </AppDialog>

    <AppDialog :open="showMediaPicker" labelled-by="social-media-picker-title" @close="showMediaPicker = false">
      <section class="social-media-picker">
        <header>
          <div>
            <h2 id="social-media-picker-title">Add media</h2>
            <p>Choose multiple images in posting order, or choose one video.</p>
          </div>
          <div class="social-media-picker__header-actions">
            <Button
              color="outline"
              shape="soft"
              size="compact"
              type="button"
              :disabled="mediaUploadBusy || mediaLoading"
              @click="triggerMediaUpload"
            >
              <template #icon>
                <UiIcon name="Upload" :size="16" aria-hidden="true" />
              </template>
              {{ mediaUploadBusy ? "Uploading…" : "Upload" }}
            </Button>
            <Button
              color="ghost"
              shape="soft"
              size="compact"
              icon-only
              type="button"
              aria-label="Close media picker"
              :disabled="mediaUploadBusy"
              @click="showMediaPicker = false"
            >
              <UiIcon name="X" :size="17" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <input
          ref="mediaUploadInput"
          class="social-media-picker__upload-input"
          type="file"
          accept="image/*,video/*"
          multiple
          @change="handleMediaUpload"
        />

        <label class="field">
          <span>Folder</span>
          <select v-model="mediaFolderId" :disabled="mediaLoading || mediaUploadBusy">
            <option :value="null">All files</option>
            <option v-for="folder in mediaFolders" :key="folder.id" :value="folder.id">{{ folder.path || folder.name }}</option>
          </select>
        </label>

        <p v-if="mediaError" class="form-error" role="alert">{{ mediaError }}</p>
        <div v-else-if="mediaUploadProgress" class="social-media-picker__upload-progress" role="status" aria-live="polite">
          <span>Uploading {{ mediaUploadProgress.filename }} · {{ mediaUploadProgress.percent }}%</span>
          <progress :value="mediaUploadProgress.percent" max="100">{{ mediaUploadProgress.percent }}%</progress>
        </div>
        <p v-else-if="mediaLoading" class="form-hint" role="status">Loading media…</p>
        <p v-else-if="mediaFiles.length === 0" class="form-hint">No images or videos in this folder yet. Upload them here or add them in Files.</p>

        <div v-else class="social-media-picker__grid" role="listbox" aria-label="Media in Files" aria-multiselectable="true">
          <button
            v-for="file in mediaFiles"
            :key="file.id"
            type="button"
            :class="{ 'is-selected': selectedMediaFileIds.includes(file.id) }"
            :aria-selected="selectedMediaFileIds.includes(file.id)"
            :aria-label="`${file.filename}, ${isVideoFile(file) ? 'video' : 'image'}${selectedMediaFileIds.includes(file.id) ? `, selected ${selectedMediaFileIds.indexOf(file.id) + 1}` : ''}`"
            @click="toggleMediaFile(file.id)"
          >
            <span class="social-media-picker__preview">
              <video v-if="isVideoFile(file)" :src="driveFileUrl(file.id)" muted preload="metadata" aria-hidden="true" />
              <img v-else :src="driveFileUrl(file.id)" alt="" loading="lazy" decoding="async" />
              <span v-if="selectedMediaFileIds.includes(file.id)" class="social-media-picker__order" aria-hidden="true">
                {{ selectedMediaFileIds.indexOf(file.id) + 1 }}
              </span>
            </span>
            <span class="social-media-picker__name">{{ file.filename }}</span>
          </button>
        </div>

        <footer>
          <Button color="outline" shape="soft" size="compact" type="button" :disabled="mediaUploadBusy" @click="showMediaPicker = false">Cancel</Button>
          <Button color="primary" shape="soft" size="compact" type="button" :disabled="saving || mediaUploadBusy || selectedMediaFileIds.length === 0" @click="attachSelectedMedia">
            Add {{ selectedMediaFileIds.length || "" }} {{ selectedMediaFileIds.some((id) => mediaFiles.find((file) => file.id === id && isVideoFile(file))) ? "video" : `image${selectedMediaFileIds.length === 1 ? "" : "s"}` }}
          </Button>
        </footer>
      </section>
    </AppDialog>

    <AppDialog
      :open="showPublishingChecks"
      labelled-by="social-publishing-checks-title"
      @close="showPublishingChecks = false"
    >
      <section class="publishing-checks-dialog">
        <header>
          <div>
            <h2 id="social-publishing-checks-title">Publishing checks</h2>
            <p>
              {{ targetValidations.length }} selected destination{{ targetValidations.length === 1 ? '' : 's' }}.
              {{ publishingCheckIssueCount ? `${publishingCheckIssueCount} need attention.` : 'Everything is ready.' }}
            </p>
          </div>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            aria-label="Close publishing checks"
            @click="showPublishingChecks = false"
          >
            <UiIcon name="X" :size="17" aria-hidden="true" />
          </Button>
        </header>
        <ul class="publish-target-list">
          <li v-for="validation in targetValidations" :key="validation.version.id">
            <span>
              <strong>{{ platformLabel(validation.version.platform) }}</strong>
              <small>{{ validation.capability?.deliveryLabel }}</small>
            </span>
            <span class="publishing-checks-dialog__result">
              <span
                :class="[
                  'validation-state',
                  {
                    'validation-state--ready':
                      validation.contentValid &&
                      validation.accountValid &&
                      validation.capability?.publish &&
                      !versionDeliveryFeedback(validation.version),
                  },
                ]"
              >
                {{
                  validation.issue ||
                  versionDeliveryFeedback(validation.version) ||
                  (validation.capability?.publish
                    ? 'Ready'
                    : validation.capability?.reason || 'Unavailable')
                }}
              </span>
              <code v-if="validation.version.errorCode">
                {{ validation.version.errorCode }}
              </code>
            </span>
          </li>
        </ul>
        <footer>
          <Button
            color="primary"
            shape="soft"
            size="compact"
            type="button"
            @click="showPublishingChecks = false"
          >
            Done
          </Button>
        </footer>
      </section>
    </AppDialog>

    <ConfirmationDialog
      :open="Boolean(deleteCandidate)"
      title="Delete Post?"
      :message="deleteConfirmationMessage"
      :confirm-label="deleteConfirmationLabel"
      danger
      @cancel="deleteCandidate = null"
      @confirm="confirmDeleteDraft"
    />

    <AppDialog :open="showSchedule" labelled-by="social-schedule-title" @close="showSchedule = false">
      <form class="social-schedule-dialog" @submit.prevent="schedulePost">
        <header>
          <div>
            <h2 id="social-schedule-title">
              {{ publicationIsYouTubeOnly ? 'Upload to YouTube' : 'Publish post' }}
            </h2>
            <p v-if="canSchedule">
              Publish immediately or choose a date and time.
            </p>
            <p v-else-if="publicationIsYouTubeOnly">
              Review the saved YouTube settings, then upload this Short.
            </p>
            <p v-else>Publish the selected platforms immediately.</p>
          </div>
          <Button color="ghost" shape="soft" size="compact" icon-only type="button" aria-label="Close schedule dialog" @click="showSchedule = false">
            <UiIcon name="X" :size="17" aria-hidden="true" />
          </Button>
        </header>

        <div
          v-if="publicationTikTokVersion"
          class="platform-publish-summary"
        >
          <UiIcon name="CircleCheck" :size="18" aria-hidden="true" />
          <span>
            <strong>TikTok ready</strong>
            <small>{{ tikTokSettingsSummary(publicationTikTokVersion) }}</small>
          </span>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            type="button"
            :disabled="scheduling"
            @click="showSchedule = false; openTikTokSettings(publicationTikTokVersion)"
          >
            Edit
          </Button>
        </div>

        <div
          v-if="publicationYouTubeVersion"
          class="platform-publish-summary"
        >
          <UiIcon name="CircleCheck" :size="18" aria-hidden="true" />
          <span>
            <strong>YouTube ready</strong>
            <small>{{ youtubeSettingsSummary(publicationYouTubeVersion) }}</small>
          </span>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            type="button"
            :disabled="scheduling"
            @click="showSchedule = false; openYouTubeSettings(publicationYouTubeVersion)"
          >
            Edit
          </Button>
        </div>

        <div v-if="canSchedule" class="schedule-fields">
          <label class="field"><span>Date</span><input v-model="scheduleDate" type="date" required /></label>
          <label class="field"><span>Time</span><input v-model="scheduleTime" type="time" required /></label>
        </div>
        <p v-if="scheduleError" class="form-error" role="alert">{{ scheduleError }}</p>
        <footer>
          <Button color="outline" shape="soft" size="compact" type="button" :disabled="scheduling" @click="showSchedule = false">Cancel</Button>
          <Button
            color="outline"
            shape="soft"
            size="compact"
            type="button"
            :disabled="scheduling || !canSubmitPublishNow"
            @click="publishNow"
          >
            <template #icon>
              <UiIcon name="Send" :size="16" aria-hidden="true" />
            </template>
            {{
              publicationIsYouTubeOnly
                ? (scheduling ? 'Uploading…' : 'Upload now')
                : (scheduling ? 'Posting…' : 'Post now')
            }}
          </Button>
          <Button
            v-if="canSchedule"
            color="primary"
            shape="soft"
            size="compact"
            type="submit"
            :disabled="scheduling || !canSchedule"
          >
            <template #icon>
              <UiIcon name="CalendarClock" :size="16" aria-hidden="true" />
            </template>
            {{ scheduling ? 'Scheduling…' : 'Schedule' }}
          </Button>
        </footer>
      </form>
    </AppDialog>

    <AppDialog
      :open="showTikTokSettings"
      labelled-by="tiktok-settings-title"
      @close="closeTikTokSettings"
    >
      <form class="tiktok-settings-dialog" @submit.prevent="saveTikTokSettings">
        <header>
          <div>
            <h2 id="tiktok-settings-title">TikTok publishing</h2>
            <p>
              Review once for this Post. ME3 will use the saved choice when publishing
              with other platforms.
            </p>
          </div>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            aria-label="Close TikTok publishing settings"
            :disabled="tiktokSettingsSaving"
            @click="closeTikTokSettings"
          >
            <UiIcon name="X" :size="17" aria-hidden="true" />
          </Button>
        </header>

        <fieldset class="tiktok-delivery-options">
          <legend>Delivery</legend>
          <label
            :class="[
              'tiktok-delivery-option',
              {
                'is-selected': tiktokDeliveryMode === 'direct_publish',
                'is-disabled': !tiktokDirectPostSupported,
              },
            ]"
          >
            <input
              v-model="tiktokDeliveryMode"
              type="radio"
              value="direct_publish"
              :disabled="!tiktokDirectPostSupported"
              @change="handleTikTokDeliveryModeChange"
            />
            <span>
              <strong>Post directly</strong>
              <small>Default · publish this exact video and caption.</small>
            </span>
          </label>
          <label
            :class="[
              'tiktok-delivery-option',
              { 'is-selected': tiktokDeliveryMode === 'provider_draft' },
            ]"
          >
            <input
              v-model="tiktokDeliveryMode"
              type="radio"
              value="provider_draft"
              @change="handleTikTokDeliveryModeChange"
            />
            <span>
              <strong>Send as draft</strong>
              <small>Finish the caption, sound, and post inside TikTok.</small>
            </span>
          </label>
        </fieldset>

        <section
          v-if="tiktokDeliveryMode === 'direct_publish'"
          class="tiktok-direct-post"
          aria-labelledby="tiktok-direct-post-title"
        >
          <h3 id="tiktok-direct-post-title">Direct Post settings</h3>

          <p
            v-if="tiktokCreatorInfoLoading"
            class="tiktok-direct-post__status"
            role="status"
          >
            Loading the latest settings from TikTok…
          </p>

          <div v-else-if="tiktokCreatorInfoError" class="state-banner state-banner--error">
            <span role="alert">{{ tiktokCreatorInfoError }}</span>
            <Button
              color="outline"
              shape="soft"
              size="compact"
              type="button"
              @click="closeTikTokSettings(); showAccounts = true"
            >
              Reconnect TikTok
            </Button>
          </div>

          <template v-else-if="tiktokCreatorInfo">
            <div class="tiktok-direct-post__creator">
              <img
                v-if="tiktokCreatorInfo.avatarUrl"
                :src="tiktokCreatorInfo.avatarUrl"
                alt=""
                referrerpolicy="no-referrer"
              />
              <span v-else aria-hidden="true">
                {{ tiktokCreatorInfo.nickname.slice(0, 1).toUpperCase() }}
              </span>
              <p>
                Posting to
                <strong>{{ tiktokCreatorInfo.nickname }}</strong>
                <small>@{{ tiktokCreatorInfo.username }}</small>
              </p>
            </div>

            <label class="field">
              <span>Who can view this post?</span>
              <select v-model="tiktokPrivacyLevel" required>
                <option disabled value="">Choose visibility</option>
                <option
                  v-for="level in tiktokCreatorInfo.privacyLevelOptions"
                  :key="level"
                  :value="level"
                >
                  {{ tiktokPrivacyLabel(level) }}
                </option>
              </select>
            </label>

            <fieldset class="tiktok-direct-post__checks">
              <legend>Allow interactions</legend>
              <label>
                <input
                  v-model="tiktokAllowComment"
                  type="checkbox"
                  :disabled="tiktokCreatorInfo.commentDisabled"
                />
                Comments
                <small v-if="tiktokCreatorInfo.commentDisabled">Unavailable in TikTok settings</small>
              </label>
              <label>
                <input
                  v-model="tiktokAllowDuet"
                  type="checkbox"
                  :disabled="tiktokCreatorInfo.duetDisabled"
                />
                Duet
                <small v-if="tiktokCreatorInfo.duetDisabled">Unavailable in TikTok settings</small>
              </label>
              <label>
                <input
                  v-model="tiktokAllowStitch"
                  type="checkbox"
                  :disabled="tiktokCreatorInfo.stitchDisabled"
                />
                Stitch
                <small v-if="tiktokCreatorInfo.stitchDisabled">Unavailable in TikTok settings</small>
              </label>
            </fieldset>

            <fieldset class="tiktok-direct-post__checks">
              <legend>Content disclosure</legend>
              <label>
                <input v-model="tiktokCommercialContent" type="checkbox" />
                This content promotes a brand, product, or service
              </label>
              <template v-if="tiktokCommercialContent">
                <label class="tiktok-direct-post__nested-check">
                  <input v-model="tiktokBrandOrganic" type="checkbox" />
                  Your brand
                  <small>The video will be labelled Promotional content.</small>
                </label>
                <label class="tiktok-direct-post__nested-check">
                  <input
                    v-model="tiktokBrandContent"
                    type="checkbox"
                    :disabled="tiktokPrivacyLevel === 'SELF_ONLY'"
                  />
                  Branded content
                  <small>
                    {{
                      tiktokPrivacyLevel === 'SELF_ONLY'
                        ? 'Paid partnerships cannot use Only me visibility.'
                        : 'The video will be labelled Paid partnership.'
                    }}
                  </small>
                </label>
                <p
                  v-if="!tiktokCommercialSelectionValid"
                  class="form-error"
                  role="alert"
                >
                  Indicate whether this promotes your brand, a third party, or both.
                </p>
              </template>
              <label>
                <input v-model="tiktokIsAiGenerated" type="checkbox" />
                Label this as AI-generated content
              </label>
            </fieldset>

            <p
              :class="[
                'tiktok-direct-post__duration',
                { 'is-invalid': !tiktokVideoDurationValid },
              ]"
            >
              <template v-if="tiktokVideoDurationSeconds">
                Video length: {{ Math.ceil(tiktokVideoDurationSeconds) }} seconds.
                This account allows up to
                {{ tiktokCreatorInfo.maxVideoPostDurationSeconds }} seconds.
              </template>
              <template v-else>
                ME3 could not read this video’s duration. Reload the video preview before posting.
              </template>
            </p>

            <label class="tiktok-direct-post__consent">
              <input v-model="tiktokConsent" type="checkbox" />
              <span>
                By posting, I agree to TikTok’s
                <a
                  href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                  target="_blank"
                  rel="noopener noreferrer"
                >Music Usage Confirmation</a>
                <template v-if="tiktokBrandContent">
                  and
                  <a
                    href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                    target="_blank"
                    rel="noopener noreferrer"
                  >Branded Content Policy</a>
                </template>.
              </span>
            </label>

            <p class="tiktok-direct-post__notice">
              TikTok requires these choices for each Post. They remain saved until this
              publishing attempt starts or the Post changes.
            </p>
          </template>
        </section>

        <footer>
          <Button
            color="outline"
            shape="soft"
            size="compact"
            type="button"
            :disabled="tiktokSettingsSaving"
            @click="closeTikTokSettings"
          >
            Cancel
          </Button>
          <Button
            color="primary"
            shape="soft"
            size="compact"
            type="submit"
            :disabled="
              tiktokSettingsSaving ||
              (
                tiktokDeliveryMode === 'direct_publish' &&
                !tiktokDirectPostReady
              )
            "
          >
            {{ tiktokSettingsSaving ? 'Saving…' : 'Save TikTok settings' }}
          </Button>
        </footer>
      </form>
    </AppDialog>

    <AppDialog
      :open="showYouTubeSettings"
      labelled-by="youtube-settings-title"
      @close="closeYouTubeSettings"
    >
      <form class="youtube-settings-dialog" @submit.prevent="saveYouTubeSettings">
        <header>
          <div>
            <h2 id="youtube-settings-title">YouTube publishing</h2>
            <p>
              Set the defaults ME3 will use for every upload to this channel.
            </p>
          </div>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            aria-label="Close YouTube publishing settings"
            :disabled="youtubeSettingsSaving"
            @click="closeYouTubeSettings"
          >
            <UiIcon name="X" :size="17" aria-hidden="true" />
          </Button>
        </header>

        <section class="youtube-upload-settings" aria-labelledby="youtube-upload-settings-title">
          <h3 id="youtube-upload-settings-title">Upload settings</h3>

          <div
            v-if="youtubeSettingsAccount"
            class="youtube-upload-settings__channel"
          >
            <img
              v-if="youtubeSettingsAccount.avatarUrl"
              :src="youtubeSettingsAccount.avatarUrl"
              alt=""
              referrerpolicy="no-referrer"
            />
            <span v-else aria-hidden="true">
              {{ accountInitialsForAccount(youtubeSettingsAccount) }}
            </span>
            <p>
              Uploading to
              <strong>{{ accountDisplayName(youtubeSettingsAccount) }}</strong>
              <small v-if="youtubeSettingsAccount.handle">
                @{{ youtubeSettingsAccount.handle.replace(/^@/, '') }}
              </small>
            </p>
          </div>

          <label class="field">
            <span>Visibility</span>
            <select v-model="youtubePrivacyStatus" required>
              <option disabled value="">Choose visibility</option>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
          </label>

          <fieldset class="youtube-upload-settings__checks">
            <legend>Audience</legend>
            <label>
              <input v-model="youtubeMadeForKids" type="radio" value="no" required />
              No, it’s not made for kids
            </label>
            <label>
              <input v-model="youtubeMadeForKids" type="radio" value="yes" required />
              Yes, it’s made for kids
            </label>
          </fieldset>

          <fieldset class="youtube-upload-settings__checks">
            <legend>Content disclosure</legend>
            <label>
              <input v-model="youtubeContainsSyntheticMedia" type="checkbox" />
              <span>
                This video contains realistic altered or synthetic content
                <small>
                  Select this when realistic people, places, scenes, or events were
                  meaningfully generated or altered.
                </small>
              </span>
            </label>
          </fieldset>

          <p class="youtube-upload-settings__notice">
            These defaults apply to every YouTube upload until you edit them here.
          </p>
        </section>

        <p v-if="youtubeSettingsError" class="form-error" role="alert">
          {{ youtubeSettingsError }}
        </p>

        <footer>
          <Button
            color="outline"
            shape="soft"
            size="compact"
            type="button"
            :disabled="youtubeSettingsSaving"
            @click="closeYouTubeSettings"
          >
            Cancel
          </Button>
          <Button
            color="primary"
            shape="soft"
            size="compact"
            type="submit"
            :disabled="
              youtubeSettingsSaving ||
              !youtubePrivacyStatus ||
              !youtubeMadeForKids
            "
          >
            {{ youtubeSettingsSaving ? 'Saving…' : 'Save YouTube defaults' }}
          </Button>
        </footer>
      </form>
    </AppDialog>

    <AppDialog :open="showAccounts" aria-label="Social accounts" @close="showAccounts = false">
      <section class="accounts-card">
        <Button class="accounts-close" color="ghost" shape="soft" size="compact" icon-only type="button" aria-label="Close social accounts" @click="showAccounts = false">
          <UiIcon name="X" :size="17" aria-hidden="true" />
        </Button>
        <SocialAccountsPanel v-if="currentSite" :site-id="currentSite.id" />
      </section>
    </AppDialog>

  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.social-page {
  min-height: 100%;
  background: var(--ui-bg);
  color: var(--ui-text);
}

.social-main {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 0 0 40px;
}

.state-banner {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-muted);
}

.state-banner--error,
.recovery-banner {
  border-color: color-mix(in srgb, #c94b4b 45%, var(--ui-border));
}

.read-only-banner {
  display: grid;
  gap: 4px;
  margin-top: 18px;
}

.delivery-error-banner {
  display: grid;
  gap: 4px;
  margin-top: 18px;
}

.social-toolbar,
.toolbar-actions,
.editor-actions,
.publication-actions,
.inline-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.social-toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
  justify-content: flex-end;
  margin-left: calc(var(--app-shell-mobile-nav-leading-padding) - 16px);
  padding: var(--workspace-topbar-padding-block) 0 0;
  background: var(--ui-bg);
}

.toolbar-actions {
  justify-content: flex-end;
}

.social-workspace-shell {
  display: grid;
}

.social-tabs-rail {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-height: 40px;
  padding: 4px 8px 0;
  box-sizing: border-box;
  background: var(--ui-bg);
}

.social-tabs-rail :deep(.workspace-tabs__tab--active) {
  margin-bottom: -1px;
  border-bottom-color: transparent;
  background: var(--ui-surface);
}

.toolbar-actions :deep(button) {
  min-width: 44px;
  min-height: 44px;
}

.social-toolbar__more {
  position: relative;
}

.social-toolbar__more > summary {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  list-style: none;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-text-muted);
  cursor: pointer;
}

.social-toolbar__more > summary::-webkit-details-marker {
  display: none;
}

.social-toolbar__more > summary:hover,
.social-toolbar__more[open] > summary {
  background: var(--ui-surface-muted);
  color: var(--ui-text);
}

.social-toolbar__more > summary:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.social-toolbar__menu {
  position: absolute;
  z-index: 5;
  top: calc(100% + 6px);
  right: 0;
  display: grid;
  width: 190px;
  padding: 5px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}

.social-toolbar__menu button {
  min-height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.social-toolbar__menu button:hover:not(:disabled) {
  background: var(--ui-surface-muted);
}

.social-toolbar__menu button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.social-workspace {
  display: grid;
  grid-template-columns: minmax(230px, 0.55fr) minmax(0, 2fr);
  min-height: 640px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
}

.post-list {
  border-right: 1px solid var(--ui-border);
  background: var(--ui-surface-muted);
}

.post-tags {
  display: flex;
  align-items: end;
  gap: 8px;
}

.post-source-group > h2 {
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: 0.74rem;
  font-weight: 650;
  overflow: hidden;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-row {
  position: relative;
  width: 100%;
  border-bottom: 1px solid var(--ui-border);
  background: transparent;
  color: inherit;
}

.post-row__select {
  display: grid;
  width: 100%;
  gap: 8px;
  padding: 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.post-row:hover,
.post-row--active {
  background: var(--ui-surface);
}

.post-row__select:focus-visible,
.version-tab:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: -2px;
}

.post-row__meta,
.post-row__footer,
.detail-meta,
.preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
}

.post-row__schedule {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
}

.post-row__schedule time {
  color: var(--ui-text);
  font-size: 0.86rem;
  font-weight: 750;
}

.post-row strong {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.4;
}

.platform-list,
.version-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.editor-actions {
  flex-wrap: wrap;
  gap: 0;
}

.editor-actions__checks {
  width: 36px;
  min-width: 36px;
  color: #a54545;
}

.editor-actions__checks:hover:not(:disabled) {
  background: color-mix(in srgb, #a54545 10%, transparent);
  color: #a54545;
}

.platform-chip {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
}

.social-account-avatar {
  position: relative;
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-text);
  color: var(--ui-bg);
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.social-account-avatar--compact {
  width: 29px;
  height: 29px;
  font-size: 0.6rem;
}

.social-account-avatar__image {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.social-account-avatar__platform {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  width: 19px;
  height: 19px;
  place-items: center;
  border: 2px solid var(--ui-surface);
  border-radius: 50%;
  background: #111827;
  color: #fff;
}

.social-account-avatar--linkedin .social-account-avatar__platform {
  background: #0a66c2;
}

.social-account-avatar--instagram .social-account-avatar__platform,
.social-account-avatar--instagram_business .social-account-avatar__platform {
  background: #c13584;
}

.social-account-avatar__platform svg {
  width: 11px;
  height: 11px;
  fill: currentColor;
}

.social-account-avatar--compact .social-account-avatar__platform {
  width: 16px;
  height: 16px;
}

.social-account-avatar--compact .social-account-avatar__platform svg {
  width: 9px;
  height: 9px;
}

.platform-chip svg,
.preview-platform-bar svg {
  width: 13px;
  height: 13px;
  fill: currentColor;
}

.post-detail {
  min-width: 0;
  padding: 24px;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-back-btn {
  display: none;
}

.publication-panel,
.recovery-banner {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-muted);
}

.post-preview p {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  line-height: 1.55;
}

.post-tags {
  margin-top: 14px;
}

.post-tags .field {
  flex: 1;
}

.post-tags small {
  color: var(--ui-text-muted);
  font-size: 0.76rem;
  font-weight: 400;
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 7px;
  color: var(--ui-text-muted);
  font-size: 0.82rem;
  text-decoration: none;
}

.source-link:hover {
  color: var(--ui-text);
  text-decoration: underline;
}

.version-tabs {
  margin-top: 18px;
  border-bottom: 1px solid var(--ui-border);
}

.version-tab {
  position: relative;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
  filter: grayscale(1);
  opacity: 0.48;
}

.version-tab__setup-dot {
  position: absolute;
  top: 5px;
  right: 4px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--ui-surface);
  border-radius: 50%;
  background: var(--ui-accent);
}

.version-tab--shared {
  grid-auto-flow: column;
  width: auto;
  min-width: 44px;
  padding: 0 8px;
  filter: none;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
}

.version-tab--add {
  border: 1px dashed var(--ui-border-strong);
  border-bottom-width: 1px;
  border-radius: 50%;
  filter: none;
  opacity: 0.72;
}

.version-tab--active {
  border-bottom-color: var(--ui-accent);
  color: var(--ui-text);
  filter: none;
  opacity: 1;
}

.version-workspace {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(280px, 1.1fr);
  gap: 20px;
  margin-top: 20px;
}

.version-workspace--shared {
  grid-template-columns: minmax(0, 680px);
}

.version-editor,
.field {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.version-editor {
  align-self: start;
  align-content: start;
  gap: 14px;
  min-width: 0;
}

.editor-validation-summary {
  color: var(--ui-text-muted);
  font-size: 0.76rem;
  line-height: 1.4;
}

.shared-variation-notice {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
}

.editor-validation-summary {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: -6px;
}

.validation-issue {
  color: #a54545;
  text-align: right;
}

.publish-target-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.validation-state {
  max-width: 190px;
  color: #a54545;
  font-size: 0.72rem;
  line-height: 1.35;
  text-align: right;
}

.validation-state--ready {
  color: var(--ui-accent-strong);
}

.media-attachments {
  display: grid;
  gap: 9px;
}

.media-attachments__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.media-attachments__toolbar > span {
  color: var(--ui-text-muted);
  font-size: 0.78rem;
}

.media-attachments__items {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px;
}

.media-attachment {
  flex: 0 0 86px;
  width: 86px;
  margin: 0;
}

.media-attachment__preview {
  position: relative;
  width: 86px;
  height: 74px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
}

.media-attachment__preview img,
.media-attachment__preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-attachment__remove:deep(button),
.media-attachment__remove {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 24px;
  min-height: 24px;
  padding: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
}

.media-attachment__order {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 2px;
  min-height: 34px;
  color: var(--ui-text-muted);
  font-size: 0.72rem;
  text-align: center;
}

.media-attachment__order :deep(button) {
  min-width: 32px;
  min-height: 32px;
  padding: 0;
}

.field > span {
  font-size: 0.82rem;
  font-weight: 650;
}

textarea,
select,
input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
}

textarea {
  min-width: 0;
  resize: vertical;
  padding: 12px;
  line-height: 1.5;
}

select,
input {
  min-height: 40px;
  padding: 8px 10px;
}

textarea:focus,
select:focus,
input:focus {
  border-color: var(--ui-accent);
  outline: 2px solid var(--ui-accent-soft);
}

.post-preview {
  align-self: start;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: #fff;
  color: #111827;
}

.post-preview img {
  width: 100%;
  display: block;
}

.preview-media {
  position: relative;
  display: grid;
  overflow: hidden;
  margin-top: 2px;
  border-top: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
  background: #f1f5f9;
}

.preview-media--gallery {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
}

.preview-media img,
.preview-media video {
  width: 100%;
  min-height: 160px;
  max-height: 340px;
  object-fit: cover;
  background: #0f172a;
}

.preview-media--gallery img,
.preview-media--gallery video {
  min-height: 130px;
  max-height: 190px;
}

.instagram-preview-carousel {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.instagram-preview-carousel__track {
  display: flex;
  width: 100%;
  transition: transform 180ms ease-out;
}

.instagram-preview-carousel__slide {
  flex: 0 0 100%;
  width: 100%;
  aspect-ratio: 1;
}

.instagram-preview-carousel__slide img,
.instagram-preview-carousel__slide video {
  width: 100%;
  height: 100%;
  min-height: 0;
  max-height: none;
  object-fit: cover;
}

.instagram-preview-carousel__dots {
  position: absolute;
  right: 0;
  bottom: 9px;
  left: 0;
  display: flex;
  justify-content: center;
  gap: 4px;
}

.instagram-preview-carousel__dots button {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgb(255 255 255 / 72%);
  cursor: pointer;
}

.instagram-preview-carousel__dots button.is-active {
  width: 7px;
  background: #0095f6;
}

.preview-media__count {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 999px;
  background: rgb(15 23 42 / 78%);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
}

.preview-link-card {
  display: grid;
  margin: 0 14px 12px;
  padding: 0;
  border: 1px solid #d8e0e5;
  border-radius: 11px;
  background: #f8fafc;
  color: #111827;
  overflow: hidden;
  text-decoration: none;
}

.preview-link-card__image {
  display: block;
  width: 100%;
  max-height: 220px;
  aspect-ratio: 1.91 / 1;
  border-bottom: 1px solid #d8e0e5;
  object-fit: cover;
}

.preview-link-card__content {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 10px 11px;
}

.preview-link-card:hover {
  background: #f1f5f9;
}

.preview-link-card__eyebrow {
  color: #64748b;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.preview-link-card strong {
  overflow: hidden;
  font-size: 0.76rem;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-link-card__description {
  display: -webkit-box;
  overflow: hidden;
  color: #475569;
  font-size: 0.72rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.preview-link-card__loading {
  color: #64748b;
  font-size: 0.72rem;
}

.preview-platform-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 13px;
  border-bottom: 1px solid #e5e7eb;
  color: #64748b;
  font-size: 0.76rem;
  font-weight: 700;
}

.preview-profile {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 14px 14px 4px;
}

.preview-profile > span:not(.preview-avatar) {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.preview-profile strong,
.preview-profile small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-profile strong {
  font-size: 0.8rem;
}

.preview-profile small {
  color: #64748b;
  font-size: 0.72rem;
}

.preview-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #dbe3ea;
  color: #334155;
  font-size: 0.75rem;
  font-weight: 750;
}

.preview-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.post-preview p {
  margin: 10px 14px 14px;
  font-size: 0.88rem;
}

.post-preview > a {
  display: inline-block;
  margin: 10px 14px;
  color: #0a66c2;
  font-size: 0.8rem;
  font-weight: 650;
}

.preview-actions {
  display: flex;
  justify-content: space-around;
  padding: 10px 14px;
  border-top: 1px solid #e5e7eb;
  color: #64748b;
}

/* TikTok keeps the video primary: the caption and social chrome live on the
   lower edge of a portrait stage instead of above the media like a feed post. */
.post-preview--tiktok {
  width: min(100%, 380px);
  justify-self: center;
  border-color: #0f0f0f;
  border-radius: 18px;
  background: #000;
  color: #fff;
  box-shadow: 0 18px 38px rgb(15 23 42 / 16%);
}

.tiktok-preview__platform-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 13px;
  border-bottom: 1px solid #2b2b2b;
  background: #0f0f0f;
  color: #fff;
  font-size: 0.76rem;
  font-weight: 700;
}

.tiktok-preview__platform-bar svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.tiktok-preview__stage {
  position: relative;
  width: 100%;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  background: #121212;
}

.tiktok-preview__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #121212;
}

.tiktok-preview__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 9px;
  padding: 28px;
  color: rgb(255 255 255 / 72%);
  font-size: 0.8rem;
  text-align: center;
}

.tiktok-preview__rail {
  position: absolute;
  z-index: 4;
  right: 8px;
  bottom: 104px;
  display: grid;
  justify-items: center;
  gap: 13px;
  width: 42px;
  color: #fff;
  text-shadow: 0 1px 4px rgb(0 0 0 / 55%);
}

.tiktok-preview__profile-avatar {
  display: grid;
  width: 35px;
  height: 35px;
  place-items: center;
  overflow: hidden;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #343434;
  font-size: 0.72rem;
  font-weight: 750;
}

.tiktok-preview__profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tiktok-preview__rail-action {
  display: grid;
  justify-items: center;
  gap: 2px;
  font-size: 0.64rem;
  font-weight: 650;
  line-height: 1.15;
}

.tiktok-preview__rail-action :deep(svg) {
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 42%));
}

.tiktok-preview__bottom-fade {
  position: absolute;
  z-index: 1;
  inset: 52% 0 0;
  background: linear-gradient(180deg, transparent 0%, rgb(0 0 0 / 14%) 36%, rgb(0 0 0 / 88%) 100%);
  pointer-events: none;
}

.tiktok-preview__caption {
  position: absolute;
  z-index: 3;
  right: 58px;
  bottom: 48px;
  left: 14px;
  text-shadow: 0 1px 4px rgb(0 0 0 / 60%);
}

.tiktok-preview__caption-author {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 0.78rem;
}

.tiktok-preview__caption-author span {
  color: rgb(255 255 255 / 78%);
  font-size: 0.68rem;
}

.tiktok-preview__caption p {
  display: -webkit-box;
  overflow: hidden;
  margin: 6px 0 5px;
  color: #fff;
  font-size: 0.76rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  white-space: pre-wrap;
}

.tiktok-preview__sound {
  display: block;
  overflow: hidden;
  color: rgb(255 255 255 / 90%);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tiktok-preview__progress {
  position: absolute;
  z-index: 5;
  right: 8px;
  bottom: 5px;
  left: 8px;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 42%);
  pointer-events: none;
}

.tiktok-preview__progress span {
  display: block;
  width: 34%;
  height: 100%;
  border-radius: inherit;
  background: #fff;
}

.post-preview--linkedin .preview-platform-bar {
  color: #0a66c2;
}

.post-preview--linkedin .preview-profile {
  padding-top: 12px;
}

.post-preview--linkedin .preview-actions {
  justify-content: space-between;
}

.post-preview--x {
  border-color: #cfd9de;
  border-radius: 16px;
}

.post-preview--x .preview-platform-bar {
  display: none;
}

.post-preview--x .preview-profile {
  grid-template-columns: 40px minmax(0, 1fr) auto;
  padding: 13px 14px 3px;
}

.post-preview--x .preview-avatar {
  width: 40px;
  height: 40px;
  background: #111827;
  color: #fff;
}

.post-preview--x .preview-profile > span:not(.preview-avatar) {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 5px;
}

.post-preview--x .preview-profile strong {
  flex: 0 1 auto;
  font-size: 0.9rem;
}

.post-preview--x .preview-profile small {
  min-width: 0;
  flex: 1;
  font-size: 0.8rem;
}

.post-preview--x > p {
  margin: 3px 14px 9px 63px;
  font-size: 0.95rem;
  line-height: 1.4;
}

.post-preview--x .preview-actions {
  justify-content: space-between;
  margin-left: 49px;
  padding: 10px 14px 12px;
  border-top: 0;
  color: #536471;
}

.post-preview--x .preview-media {
  margin: 2px 14px 12px 63px;
  border: 1px solid #cfd9de;
  border-radius: 13px;
}

.post-preview--x .preview-media--gallery {
  gap: 1px;
}

.post-preview--x .preview-media img,
.post-preview--x .preview-media video {
  min-height: 180px;
  max-height: 350px;
}

.post-preview--x .preview-link-card {
  margin-left: 63px;
  border-color: #cfd9de;
  border-radius: 13px;
  background: #fff;
}

.post-preview--instagram,
.post-preview--instagram_business {
  border-color: #dbdbdb;
  border-radius: 3px;
}

.post-preview--instagram .preview-platform-bar,
.post-preview--instagram_business .preview-platform-bar {
  display: none;
}

.post-preview--instagram .preview-profile,
.post-preview--instagram_business .preview-profile {
  order: 1;
  padding: 12px 12px 8px;
}

.post-preview--instagram .preview-avatar,
.post-preview--instagram_business .preview-avatar {
  width: 30px;
  height: 30px;
  background: linear-gradient(135deg, #f9ce34, #ee2a7b 52%, #6228d7);
  box-shadow: 0 0 0 2px #fff, 0 0 0 3px #e1306c;
  color: #fff;
}

.post-preview--instagram p,
.post-preview--instagram_business p {
  order: 3;
  margin: 10px 12px 14px;
  font-size: 0.83rem;
}

.post-preview--instagram .preview-media,
.post-preview--instagram_business .preview-media {
  order: 2;
  margin: 0;
  border: 0;
}

.post-preview--instagram .preview-media img,
.post-preview--instagram .preview-media video,
.post-preview--instagram_business .preview-media img,
.post-preview--instagram_business .preview-media video {
  min-height: 210px;
  max-height: 390px;
}

.post-preview--instagram .preview-link-card,
.post-preview--instagram_business .preview-link-card {
  order: 4;
  margin: 0 12px 12px;
  border-radius: 3px;
}

.post-preview--instagram .preview-actions,
.post-preview--instagram_business .preview-actions {
  order: 5;
  justify-content: flex-start;
  gap: 16px;
  padding: 10px 12px;
  border-top: 0;
  color: #262626;
}

.post-preview--instagram .preview-actions__bookmark,
.post-preview--instagram_business .preview-actions__bookmark {
  margin-left: auto;
}

/* Short-form previews keep the video dominant and borrow only the most
   recognisable platform chrome. They are intentionally quieter than the apps. */
.post-preview--youtube-short,
.post-preview--instagram-reel {
  width: min(100%, 380px);
  justify-self: center;
  border-color: #202124;
  border-radius: 18px;
  background: #0f0f0f;
  color: #fff;
  box-shadow: 0 18px 38px rgb(15 23 42 / 16%);
}

.short-video-preview__platform-bar {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  border-bottom: 1px solid #2b2b2b;
  color: rgb(255 255 255 / 88%);
  font-size: 0.75rem;
  font-weight: 700;
}

.short-video-preview__platform-bar svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}

.post-preview--youtube-short .short-video-preview__platform-bar svg {
  color: #ff0033;
}

.short-video-preview__stage {
  position: relative;
  width: 100%;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  background: #171717;
  color: #fff;
}

.short-video-preview__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-height: none;
  object-fit: cover;
  background: #171717;
}

.short-video-preview__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 9px;
  padding: 28px;
  color: rgb(255 255 255 / 70%);
  font-size: 0.78rem;
  text-align: center;
}

.short-video-preview__bottom-fade {
  position: absolute;
  z-index: 1;
  inset: 48% 0 0;
  background: linear-gradient(180deg, transparent 0%, rgb(0 0 0 / 14%) 34%, rgb(0 0 0 / 82%) 100%);
  pointer-events: none;
}

.short-video-preview__avatar {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 72%);
  border-radius: 50%;
  background: #353535;
  color: #fff;
  font-size: 0.64rem;
  font-weight: 800;
}

.short-video-preview__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.youtube-short-preview__caption {
  position: absolute;
  z-index: 3;
  right: 15px;
  bottom: 22px;
  left: 15px;
  color: #fff;
  text-shadow: 0 1px 4px rgb(0 0 0 / 68%);
}

.youtube-short-preview__channel {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.youtube-short-preview__channel strong {
  overflow: hidden;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.youtube-short-preview__subscribe {
  margin-left: 2px;
  padding: 7px 11px;
  border-radius: 999px;
  background: #fff;
  color: #111;
  font-size: 0.68rem;
  font-weight: 750;
  text-shadow: none;
}

.post-preview--youtube-short .youtube-short-preview__caption p {
  display: -webkit-box;
  overflow: hidden;
  margin: 10px 0 0;
  color: #fff;
  font-size: 0.78rem;
  font-weight: 650;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: pre-wrap;
}

.youtube-short-preview__progress {
  position: absolute;
  z-index: 4;
  right: 8px;
  bottom: 5px;
  left: 8px;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 35%);
  pointer-events: none;
}

.youtube-short-preview__progress span {
  display: block;
  width: 24%;
  height: 100%;
  border-radius: inherit;
  background: #ff0033;
}

.instagram-reel-preview__topbar {
  position: absolute;
  z-index: 3;
  top: 13px;
  right: 13px;
  left: 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #fff;
  pointer-events: none;
  text-shadow: 0 1px 4px rgb(0 0 0 / 62%);
}

.instagram-reel-preview__topbar strong {
  font-size: 1rem;
  letter-spacing: -0.01em;
}

.instagram-reel-preview__topbar > span {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}

.instagram-reel-preview__rail {
  position: absolute;
  z-index: 3;
  right: 10px;
  bottom: 92px;
  display: grid;
  justify-items: center;
  gap: 19px;
  color: #fff;
  pointer-events: none;
  filter: drop-shadow(0 1px 3px rgb(0 0 0 / 62%));
}

.instagram-reel-preview__caption {
  position: absolute;
  z-index: 3;
  right: 54px;
  bottom: 22px;
  left: 13px;
  color: #fff;
  text-shadow: 0 1px 4px rgb(0 0 0 / 68%);
}

.instagram-reel-preview__identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.instagram-reel-preview__identity strong {
  overflow: hidden;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instagram-reel-preview__follow {
  padding: 5px 9px;
  border: 1px solid rgb(255 255 255 / 76%);
  border-radius: 7px;
  font-size: 0.66rem;
  font-weight: 750;
}

.post-preview--instagram-reel .instagram-reel-preview__caption p {
  display: -webkit-box;
  overflow: hidden;
  margin: 9px 0 0;
  color: #fff;
  font-size: 0.75rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  white-space: pre-wrap;
}

.post-preview > .short-video-preview__published-link {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  margin: 0;
  border-top: 1px solid #2b2b2b;
  color: rgb(255 255 255 / 86%);
  font-size: 0.75rem;
  text-decoration: none;
}

.post-preview > .short-video-preview__published-link:hover {
  background: #191919;
  color: #fff;
}

.post-preview > .short-video-preview__published-link:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: -3px;
}

.publication-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.publication-panel h2,
.publication-panel p {
  margin: 0;
}

.publication-panel p {
  margin-top: 5px;
  color: var(--ui-text-muted);
  font-size: 0.85rem;
}

.publication-history {
  display: grid;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
}

.publication-history__heading,
.publication-history__list li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.publication-history__heading {
  justify-content: space-between;
}

.publication-history__heading h2,
.publication-history__empty {
  margin: 0;
}

.publication-history__heading span,
.publication-history__empty,
.publication-history__list time,
.publication-history__error {
  color: var(--ui-text-muted);
  font-size: 0.85rem;
}

.publication-history__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.publication-history__list li {
  min-width: 0;
}

.publication-history__list li.publication-history__item--linked {
  padding: 8px;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-accent-soft);
  outline: 1px solid var(--ui-accent);
  outline-offset: 1px;
}

.publication-history__list a,
.publication-history__error {
  margin-left: auto;
}

.empty-state,
.detail-empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  min-height: 220px;
  padding: 24px;
  color: var(--ui-text-muted);
  text-align: center;
}

.accounts-card,
.social-destinations-dialog,
.social-media-picker,
.social-schedule-dialog,
.tiktok-settings-dialog,
.youtube-settings-dialog,
.publishing-checks-dialog {
  position: relative;
  width: min(680px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}

.social-media-picker,
.social-schedule-dialog,
.tiktok-settings-dialog,
.youtube-settings-dialog,
.publishing-checks-dialog {
  display: grid;
  gap: 18px;
}

.social-destinations-dialog {
  display: grid;
  gap: 18px;
}

.social-destinations-dialog > header,
.social-destinations-dialog > footer,
.social-media-picker header,
.social-media-picker footer,
.social-schedule-dialog header,
.social-schedule-dialog footer,
.tiktok-settings-dialog header,
.tiktok-settings-dialog footer,
.youtube-settings-dialog header,
.youtube-settings-dialog footer,
.publishing-checks-dialog header,
.publishing-checks-dialog footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.social-destinations-dialog > footer {
  justify-content: flex-end;
}

.social-destinations-dialog h2,
.social-destinations-dialog p,
.social-media-picker h2,
.social-media-picker p,
.social-schedule-dialog h2,
.social-schedule-dialog p,
.tiktok-settings-dialog h2,
.tiktok-settings-dialog p,
.youtube-settings-dialog h2,
.youtube-settings-dialog p,
.publishing-checks-dialog h2,
.publishing-checks-dialog p {
  margin: 0;
}

.social-destinations-dialog header p,
.social-media-picker header p,
.social-schedule-dialog header p,
.tiktok-settings-dialog header p,
.youtube-settings-dialog header p,
.publishing-checks-dialog header p {
  margin-top: 4px;
  color: var(--ui-text-muted);
}

.content-type-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0;
  padding: 0;
  border: 0;
}

.content-type-picker legend {
  width: 100%;
  margin-bottom: 2px;
  color: var(--ui-text-muted);
  font-size: 0.76rem;
}

.content-type-picker label {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  cursor: pointer;
}

.content-type-picker label.is-selected {
  border-color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.content-type-picker input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.content-type-picker label:focus-within {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.editor-action-error {
  margin: 10px 0 0;
}

.destination-options {
  display: grid;
  gap: 7px;
}

.destination-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: 64px;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.destination-option:hover:not(:disabled),
.destination-option.is-selected {
  border-color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.destination-option:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.destination-option:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.destination-option__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.destination-option__copy small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 0.76rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-target-list {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
}

.publish-target-list li {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ui-border);
}

.publish-target-list li:last-child {
  border-bottom: 0;
}

.publish-target-list li > span:first-child {
  display: grid;
  gap: 2px;
}

.publish-target-list small {
  color: var(--ui-text-muted);
  font-size: 0.74rem;
}

.publishing-checks-dialog__result {
  display: grid;
  justify-items: end;
  gap: 3px;
}

.publishing-checks-dialog__result code {
  color: var(--ui-text-muted);
  font-size: 0.66rem;
  overflow-wrap: anywhere;
}

.social-media-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
  max-height: min(440px, 52vh);
  overflow: auto;
}

.social-media-picker__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.social-media-picker__upload-input {
  display: none;
}

.social-media-picker__upload-progress {
  display: grid;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
}

.social-media-picker__upload-progress progress {
  width: 100%;
  height: 6px;
  accent-color: var(--ui-accent);
}

.social-media-picker__grid button {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font: inherit;
  font-size: 0.76rem;
  text-align: left;
  cursor: pointer;
}

.social-media-picker__grid button:hover,
.social-media-picker__grid button.is-selected {
  border-color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.social-media-picker__preview {
  position: relative;
  display: block;
}

.social-media-picker__grid img,
.social-media-picker__grid video {
  width: 100%;
  aspect-ratio: 1;
  border-radius: calc(var(--ui-radius-sm) - 2px);
  object-fit: cover;
  background: #0f172a;
}

.social-media-picker__order {
  position: absolute;
  top: 7px;
  right: 7px;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-accent-strong);
  color: var(--ui-accent-contrast);
  font-weight: 750;
}

.social-media-picker__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tiktok-caption-copy {
  width: 44px;
  min-width: 44px;
  min-height: 44px;
  flex: 0 0 auto;
  margin: -10px 0 -10px auto;
  padding: 0;
}

.platform-publish-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: 52px;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-muted);
}

.platform-publish-summary {
  border-color: color-mix(in srgb, var(--ui-accent) 36%, var(--ui-border));
  background: var(--ui-accent-soft);
}

.platform-publish-summary > svg {
  color: var(--ui-accent-strong);
}

.platform-publish-summary span,
.platform-publish-summary small {
  display: block;
}

.platform-publish-summary small {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
}

.tiktok-delivery-options,
.tiktok-direct-post__checks {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.tiktok-delivery-options legend,
.tiktok-direct-post__checks legend {
  margin-bottom: 2px;
  font-size: 0.82rem;
  font-weight: 700;
}

.tiktok-delivery-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 64px;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  cursor: pointer;
}

.tiktok-delivery-option:hover,
.tiktok-delivery-option.is-selected {
  border-color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.tiktok-delivery-option:focus-within {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.tiktok-delivery-option.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.tiktok-delivery-option input,
.tiktok-direct-post__checks input,
.tiktok-direct-post__consent input {
  width: 18px;
  min-height: 18px;
  margin: 0;
  padding: 0;
  accent-color: var(--ui-accent-strong);
}

.tiktok-delivery-option span,
.tiktok-delivery-option small,
.tiktok-direct-post__creator p,
.tiktok-direct-post__creator small {
  display: block;
}

.tiktok-delivery-option small,
.tiktok-direct-post__creator small,
.tiktok-direct-post__checks small {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1.35;
}

.tiktok-direct-post {
  display: grid;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-muted);
}

.tiktok-direct-post h3 {
  margin: 0;
  font-size: 0.94rem;
}

.tiktok-direct-post__status,
.tiktok-direct-post__duration,
.tiktok-direct-post__notice {
  color: var(--ui-text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.tiktok-direct-post__duration.is-invalid {
  color: var(--ui-danger, #a54545);
}

.tiktok-direct-post__creator {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.tiktok-direct-post__creator > img,
.tiktok-direct-post__creator > span {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  background: var(--ui-surface);
  object-fit: cover;
}

.tiktok-direct-post__creator p {
  min-width: 0;
}

.tiktok-direct-post__checks label,
.tiktok-direct-post__consent {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  min-height: 44px;
  align-items: center;
  gap: 10px;
  font-size: 0.82rem;
  line-height: 1.4;
}

.tiktok-direct-post__checks label:has(small) {
  grid-template-rows: auto auto;
}

.tiktok-direct-post__checks label:has(small) input {
  grid-row: 1 / 3;
}

.tiktok-direct-post__nested-check {
  margin-left: 28px;
}

.tiktok-direct-post__consent {
  align-items: start;
}

.tiktok-direct-post__consent input {
  margin-top: 2px;
}

.tiktok-direct-post__consent a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.youtube-upload-settings {
  display: grid;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-muted);
}

.youtube-upload-settings h3 {
  margin: 0;
  font-size: 0.94rem;
}

.youtube-upload-settings__channel {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.youtube-upload-settings__channel > img,
.youtube-upload-settings__channel > span {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  background: var(--ui-surface);
  object-fit: cover;
}

.youtube-upload-settings__channel p,
.youtube-upload-settings__channel strong,
.youtube-upload-settings__channel small {
  display: block;
}

.youtube-upload-settings__channel p {
  min-width: 0;
}

.youtube-upload-settings__channel small,
.youtube-upload-settings__checks small,
.youtube-upload-settings__notice {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1.4;
}

.youtube-upload-settings__checks {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.youtube-upload-settings__checks legend {
  margin-bottom: 2px;
  font-size: 0.82rem;
  font-weight: 700;
}

.youtube-upload-settings__checks label {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  min-height: 44px;
  align-items: center;
  gap: 10px;
  font-size: 0.82rem;
  line-height: 1.4;
}

.youtube-upload-settings__checks input {
  width: 18px;
  min-height: 18px;
  margin: 0;
  padding: 0;
  accent-color: var(--ui-accent-strong);
}

.youtube-upload-settings__checks small {
  display: block;
}

.schedule-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.accounts-close {
  position: absolute;
  top: 10px;
  right: 10px;
}

@media (max-width: 820px) {
  .social-main {
    width: min(100% - 20px, 680px);
    padding-top: 0;
  }

  .publication-panel,
  .publication-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .social-toolbar {
    justify-content: flex-end;
    gap: 8px;
    margin-left: calc(var(--app-shell-mobile-nav-leading-padding) - 10px);
    padding-top: var(--workspace-topbar-padding-block);
    padding-bottom: 0;
  }

  .social-workspace {
    display: block;
    background: var(--ui-surface-muted);
  }

  .version-workspace {
    grid-template-columns: 1fr;
  }

  .post-list {
    min-height: inherit;
    border-right: 0;
    border-bottom: 0;
    background: var(--ui-surface-muted);
  }

  .post-detail,
  .detail-empty {
    display: none;
  }

  .social-workspace--mobile-detail-open .post-list {
    display: none;
  }

  .social-workspace--mobile-detail-open .post-detail {
    display: block;
  }

  .detail-header {
    position: sticky;
    top: 0;
    z-index: 2;
    align-items: center;
    min-height: 44px;
    margin: -12px -12px 0;
    padding: 8px 12px;
    background: var(--ui-surface);
  }

  .detail-back-btn {
    display: inline-flex;
    min-width: 44px;
    min-height: 44px;
  }
}

@media (max-width: 520px) {
  .platform-publish-summary {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .platform-publish-summary :deep(.me3-btn) {
    grid-column: 1 / -1;
    justify-self: stretch;
  }

  .media-attachment__order :deep(.media-attachment__move.me3-btn) {
    width: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  .post-detail {
    padding: 16px;
  }
}
</style>

import type { PostVersion, SocialAccountRow, SocialPlatformCapabilities, SocialPostDetail } from "../stores/social";

/** Shared Social test data. */
export function version(overrides: Partial<PostVersion> = {}): PostVersion {
  return {
    id: `version-${overrides.platform || "x"}`,
    postId: "post-1",
    platform: "x",
    targetAccountId: null,
    format: "post",
    bodyText: "Studio open day on Saturday.",
    assetManifest: [],
    sourceExcerpt: null,
    approvalStatus: "draft",
    approvedAt: null,
    approvedByUserId: null,
    scheduledFor: null,
    timezone: null,
    publicationStatus: null,
    platformPostUrl: null,
    publishedAt: null,
    failureClass: null,
    errorMessage: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

export function post(versions: PostVersion[], overrides: Partial<SocialPostDetail["post"]> = {}): SocialPostDetail {
  return {
    post: {
      id: "post-1",
      siteId: "site-1",
      sourceType: "pasted",
      sourceRef: null,
      sourceTitle: "Pasted text",
      sourceSnapshot: "",
      sourceText: "",
      ideaText: "Studio open day on Saturday.\nCoffee and reviews.",
      tags: [],
      goal: null,
      status: "draft",
      createdBy: "user",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      ...overrides,
    },
    versions,
  };
}

export function account(platform: string, status = "active"): SocialAccountRow {
  return {
    id: `account-${platform}`,
    siteId: "site-1",
    platform,
    handle: "mayastudio",
    displayName: "Maya",
    credentialSource: "hosted_oauth",
    status,
    lastVerifiedAt: null,
  };
}

export const capabilities: SocialPlatformCapabilities[] = [
  {
    platform: "x",
    draft: true,
    schedule: true,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "",
    reason: null,
    contentRules: [
      { contentType: "text", label: "", requiresText: true, maxTextCharacters: 280, minMediaItems: 0, maxMediaItems: 0, allowedMediaKinds: [], allowedMimeTypes: [], maxBytesPerItem: null, guidance: null },
      { contentType: "carousel", label: "", requiresText: true, maxTextCharacters: 280, minMediaItems: 2, maxMediaItems: 4, allowedMediaKinds: ["image"], allowedMimeTypes: ["image/jpeg", "image/png"], maxBytesPerItem: null, guidance: null },
    ],
  },
  {
    platform: "instagram",
    draft: true,
    schedule: true,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "",
    reason: null,
    contentRules: [
      { contentType: "image", label: "", requiresText: true, maxTextCharacters: 2200, minMediaItems: 1, maxMediaItems: 10, allowedMediaKinds: ["image"], allowedMimeTypes: ["image/jpeg"], maxBytesPerItem: null, guidance: null },
    ],
  },
];

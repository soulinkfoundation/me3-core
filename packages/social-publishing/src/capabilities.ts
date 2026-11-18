import type { SocialPlatform } from "./platforms";

export type SocialContentType = "text" | "image" | "carousel" | "short_video" | "document";
export type SocialDeliveryMode = "direct_publish" | "provider_draft" | "draft_only";
export type SocialMediaKind = "image" | "video" | "document";

export type SocialPlatformContentRule = {
  contentType: SocialContentType;
  label: string;
  requiresText: boolean;
  maxTextCharacters: number | null;
  minMediaItems: number;
  maxMediaItems: number;
  allowedMediaKinds: SocialMediaKind[];
  allowedMimeTypes: string[];
  maxBytesPerItem: number | null;
  guidance: string | null;
  /** Shortest video the platform accepts, in seconds. Null when it states none. */
  minVideoDurationSeconds?: number | null;
  /**
   * Longest video the platform accepts, in seconds. Null when there's no fixed limit:
   * YouTube takes any length (15 minutes and over needs a verified channel), and TikTok's
   * limit comes from creator_info for each account at post time.
   */
  maxVideoDurationSeconds?: number | null;
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

const textRule = (
  maxTextCharacters: number,
  guidance: string | null = null,
): SocialPlatformContentRule => ({
  contentType: "text",
  label: "Text post",
  requiresText: true,
  maxTextCharacters,
  minMediaItems: 0,
  maxMediaItems: 0,
  allowedMediaKinds: [],
  allowedMimeTypes: [],
  maxBytesPerItem: null,
  guidance,
});

const imageRule = (
  maxTextCharacters: number,
  guidance: string | null = null,
  allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"],
): SocialPlatformContentRule => ({
  contentType: "image",
  label: "Image post",
  requiresText: true,
  maxTextCharacters,
  minMediaItems: 1,
  maxMediaItems: 1,
  allowedMediaKinds: ["image"],
  allowedMimeTypes,
  maxBytesPerItem: null,
  guidance,
});

const carouselRule = (
  maxTextCharacters: number,
  maxMediaItems: number,
  guidance: string,
  allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"],
): SocialPlatformContentRule => ({
  contentType: "carousel",
  label: "Carousel",
  requiresText: true,
  maxTextCharacters,
  minMediaItems: 2,
  maxMediaItems,
  allowedMediaKinds: ["image"],
  allowedMimeTypes,
  maxBytesPerItem: null,
  guidance,
});

const shortVideoRule = (
  maxTextCharacters: number | null,
  allowedMimeTypes: string[],
  maxBytesPerItem: number,
  guidance: string,
  duration: { min: number | null; max: number | null },
): SocialPlatformContentRule => ({
  contentType: "short_video",
  label: "Short video",
  requiresText: maxTextCharacters !== null,
  maxTextCharacters,
  minMediaItems: 1,
  maxMediaItems: 1,
  allowedMediaKinds: ["video"],
  allowedMimeTypes,
  maxBytesPerItem,
  guidance,
  minVideoDurationSeconds: duration.min,
  maxVideoDurationSeconds: duration.max,
});

/**
 * Video lengths from each platform's API docs, checked 2026-11-16 (me3-s0ib):
 * X tweet_video 0.5 s to 20 min (125 min for Premium, which ME3 can't see; 140 s is DMs only),
 * LinkedIn Videos API 3 s to 30 min, Instagram Reels 3 s to 15 min, TikTok per account from
 * creator_info (the API allows up to 10 min). YouTube takes any length.
 */
export const VIDEO_DURATION_SECONDS = {
  x: { min: 0.5, max: 20 * 60 },
  linkedin: { min: 3, max: 30 * 60 },
  instagram: { min: 3, max: 15 * 60 },
  youtube: { min: null, max: null },
  tiktok: { min: null, max: null },
  facebook: { min: 1, max: 4 * 60 * 60 },
} as const;

/** YouTube files a video as a Short when it's this long or shorter and square or vertical. */
export const YOUTUBE_SHORT_MAX_SECONDS = 3 * 60;

/** YouTube needs a verified channel (longUploadsStatus allowed) above this length. */
export const YOUTUBE_UNVERIFIED_MAX_SECONDS = 15 * 60;

const PLATFORM_CAPABILITIES: Record<SocialPlatform, SocialPlatformCapabilities> = {
  linkedin: {
    platform: "linkedin",
    draft: true,
    schedule: true,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "Publishes directly",
    contentRules: [
      textRule(3_000),
      imageRule(
        3_000,
        "Publishes as a LinkedIn image post.",
        ["image/jpeg", "image/png", "image/gif"],
      ),
      carouselRule(
        3_000,
        20,
        "Two to twenty ordered images publish as a LinkedIn multi-image post.",
        ["image/jpeg", "image/png", "image/gif"],
      ),
      shortVideoRule(
        3_000,
        ["video/mp4"],
        500 * 1024 * 1024,
        "Publishes one MP4 video (75 KB to 500 MB). LinkedIn takes one video or images, not both.",
        VIDEO_DURATION_SECONDS.linkedin,
      ),
      {
        contentType: "document",
        label: "Document (PDF carousel)",
        requiresText: true,
        maxTextCharacters: 3_000,
        minMediaItems: 1,
        maxMediaItems: 1,
        allowedMediaKinds: ["document"],
        allowedMimeTypes: ["application/pdf"],
        maxBytesPerItem: 100 * 1024 * 1024,
        guidance: "Publishes one PDF (up to 100 MB, 300 pages) as a swipeable document. Its file name is the title.",
      },
    ],
    reason: null,
  },
  x: {
    platform: "x",
    draft: true,
    schedule: true,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "Publishes directly",
    contentRules: [
      textRule(280),
      imageRule(280),
      carouselRule(280, 4, "Up to four ordered raster images publish in one X post."),
      shortVideoRule(
        280,
        ["video/mp4"],
        512 * 1024 * 1024,
        "Publishes one MP4 video. X accepts one video or up to four images per post.",
        VIDEO_DURATION_SECONDS.x,
      ),
    ],
    reason: null,
  },
  instagram: {
    platform: "instagram",
    draft: true,
    schedule: true,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "Publishes directly",
    contentRules: [
      imageRule(2_200, "Publishes as an Instagram feed post."),
      {
        ...carouselRule(
          2_200,
          20,
          "Two to twenty photos and videos, in order, publish as a carousel.",
          ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"],
        ),
        allowedMediaKinds: ["image", "video"],
      },
      shortVideoRule(
        2_200,
        ["video/mp4", "video/quicktime"],
        1024 * 1024 * 1024,
        "Publishes as an Instagram Reel. A vertical 9:16 video is recommended.",
        VIDEO_DURATION_SECONDS.instagram,
      ),
    ],
    reason: null,
  },
  instagram_business: {
    platform: "instagram_business",
    draft: true,
    schedule: true,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "Publishes directly",
    contentRules: [
      imageRule(2_200, "Publishes as an Instagram feed post."),
      {
        ...carouselRule(
          2_200,
          20,
          "Two to twenty photos and videos, in order, publish as a carousel.",
          ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"],
        ),
        allowedMediaKinds: ["image", "video"],
      },
      shortVideoRule(
        2_200,
        ["video/mp4", "video/quicktime"],
        1024 * 1024 * 1024,
        "Publishes as an Instagram Reel. A vertical 9:16 video is recommended.",
        VIDEO_DURATION_SECONDS.instagram,
      ),
    ],
    reason: null,
  },
  facebook: {
    platform: "facebook",
    draft: true,
    schedule: true,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "Publishes to your Page",
    contentRules: [
      textRule(63_206, "Publishes as a post on the connected Facebook Page."),
      imageRule(63_206, "Publishes as a photo post on the connected Facebook Page."),
      carouselRule(63_206, 10, "Two to ten ordered images publish as one Page post."),
      shortVideoRule(
        63_206,
        ["video/mp4", "video/quicktime"],
        10 * 1024 * 1024 * 1024,
        "Publishes one MP4 or MOV video on its own as a Page post.",
        VIDEO_DURATION_SECONDS.facebook,
      ),
    ],
    reason: null,
  },
  youtube: {
    platform: "youtube",
    draft: true,
    schedule: false,
    publish: true,
    deliveryMode: "direct_publish",
    deliveryLabel: "Uploads directly",
    contentRules: [
      shortVideoRule(
        5_000,
        ["video/*", "application/octet-stream"],
        256 * 1024 * 1024 * 1024,
        "Choose the audience, visibility, and content disclosures before uploading. YouTube derives Shorts eligibility from the video.",
        VIDEO_DURATION_SECONDS.youtube,
      ),
    ],
    reason: null,
  },
  tiktok: {
    platform: "tiktok",
    draft: true,
    schedule: false,
    publish: true,
    deliveryMode: "direct_publish",
    supportedDeliveryModes: ["direct_publish"],
    deliveryLabel: "Posts directly after you choose TikTok's settings",
    contentRules: [
      shortVideoRule(
        2_200,
        ["video/mp4", "video/quicktime", "video/webm"],
        4 * 1024 * 1024 * 1024,
        "TikTok takes one vertical video. Choose who can see it before you post.",
        VIDEO_DURATION_SECONDS.tiktok,
      ),
    ],
    reason: null,
  },
};

export function getSocialPlatformCapabilities(): SocialPlatformCapabilities[] {
  return [
    PLATFORM_CAPABILITIES.linkedin,
    PLATFORM_CAPABILITIES.x,
    PLATFORM_CAPABILITIES.instagram,
    PLATFORM_CAPABILITIES.instagram_business,
    PLATFORM_CAPABILITIES.facebook,
    PLATFORM_CAPABILITIES.youtube,
    PLATFORM_CAPABILITIES.tiktok,
  ];
}

export function socialPlatformCapabilities(
  platform: SocialPlatform,
): SocialPlatformCapabilities {
  return PLATFORM_CAPABILITIES[platform];
}

export function canScheduleSocialPlatform(platform: SocialPlatform): boolean {
  return PLATFORM_CAPABILITIES[platform].schedule;
}

export function canPublishSocialPlatform(platform: SocialPlatform): boolean {
  return PLATFORM_CAPABILITIES[platform].publish;
}

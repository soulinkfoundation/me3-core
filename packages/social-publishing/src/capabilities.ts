import type { SocialPlatform } from "./index";

export type SocialContentType = "text" | "image" | "carousel" | "short_video";
export type SocialDeliveryMode = "direct_publish" | "provider_draft" | "draft_only";
export type SocialMediaKind = "image" | "video";

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
});

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
      carouselRule(2_200, 10, "Two to ten ordered images publish as a carousel."),
      shortVideoRule(
        2_200,
        ["video/mp4", "video/quicktime"],
        1024 * 1024 * 1024,
        "Publishes as an Instagram Reel. A vertical 9:16 video is recommended.",
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
      carouselRule(2_200, 10, "Two to ten ordered images publish as a carousel."),
      shortVideoRule(
        2_200,
        ["video/mp4", "video/quicktime"],
        1024 * 1024 * 1024,
        "Publishes as an Instagram Reel. A vertical 9:16 video is recommended.",
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
      ),
    ],
    reason: null,
  },
  tiktok: {
    platform: "tiktok",
    draft: true,
    schedule: false,
    publish: true,
    deliveryMode: "provider_draft",
    supportedDeliveryModes: ["provider_draft", "direct_publish"],
    deliveryLabel: "Draft or Direct Post",
    contentRules: [
      shortVideoRule(
        null,
        ["video/mp4", "video/quicktime", "video/webm"],
        4 * 1024 * 1024 * 1024,
        "Choose a TikTok creator draft to finish in the app or a consented Direct Post.",
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

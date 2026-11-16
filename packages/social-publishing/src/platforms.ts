/** Kept apart from index.ts so browser code (the New post rules) can use it without the Worker code. */
export const SOCIAL_PLATFORMS = [
  "x",
  "linkedin",
  "instagram",
  "instagram_business",
  "facebook",
  "youtube",
  "tiktok",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

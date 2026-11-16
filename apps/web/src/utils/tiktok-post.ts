import type { TikTokCreatorInfo, TikTokPrivacyLevel, TikTokPublishingSettings } from "../stores/social";

/**
 * TikTok's Direct Post rules (Content Sharing Guidelines), kept free of Vue so the page and tests share them.
 * Nothing is chosen for the owner: no default audience, every interaction off, disclosure off.
 */

export const TIKTOK_CAPTION_LIMIT = 2200;
export const TIKTOK_MUSIC_TERMS_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const TIKTOK_BRANDED_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export type TikTokPostChoices = {
  privacyLevel: TikTokPrivacyLevel | "";
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** "Disclose commercial content" switch. */
  disclose: boolean;
  /** Promotes the owner's own business: labelled Promotional content. */
  yourBrand: boolean;
  /** Paid partnership with a third party: labelled Paid partnership. */
  brandedContent: boolean;
};

export function emptyTikTokChoices(): TikTokPostChoices {
  return {
    privacyLevel: "",
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    disclose: false,
    yourBrand: false,
    brandedContent: false,
  };
}

export function tiktokPrivacyLabel(level: TikTokPrivacyLevel): string {
  if (level === "PUBLIC_TO_EVERYONE") return "Everyone";
  if (level === "FOLLOWER_OF_CREATOR") return "Followers";
  if (level === "MUTUAL_FOLLOW_FRIENDS") return "Friends";
  return "Only me";
}

/** The label TikTok will show on the post, or null when nothing is disclosed. */
export function tiktokDisclosureLabel(choices: TikTokPostChoices): string | null {
  if (!choices.disclose) return null;
  if (choices.brandedContent) return "Your video will be labeled as 'Paid partnership'";
  if (choices.yourBrand) return "Your video will be labeled as 'Promotional content'";
  return null;
}

/** The declaration shown above the post button; branded content adds TikTok's Branded Content Policy. */
export function tiktokDeclaration(choices: TikTokPostChoices): { brandedPolicy: boolean } {
  return { brandedPolicy: choices.disclose && choices.brandedContent };
}

/** Branded content can't be private, so Only me is off the list while it's chosen. */
export function tiktokPrivacyDisabled(level: TikTokPrivacyLevel, choices: TikTokPostChoices): string | null {
  return level === "SELF_ONLY" && choices.disclose && choices.brandedContent
    ? "Branded content visibility cannot be set to private."
    : null;
}

/** Keeps choices inside what this creator allows right now. */
export function fitTikTokChoices(choices: TikTokPostChoices, creator: TikTokCreatorInfo | null): TikTokPostChoices {
  const next = { ...choices };
  if (!next.disclose) {
    next.yourBrand = false;
    next.brandedContent = false;
  }
  if (creator) {
    if (next.privacyLevel && !creator.privacyLevelOptions.includes(next.privacyLevel)) next.privacyLevel = "";
    if (creator.commentDisabled) next.allowComment = false;
    if (creator.duetDisabled) next.allowDuet = false;
    if (creator.stitchDisabled) next.allowStitch = false;
  }
  if (next.privacyLevel === "SELF_ONLY" && next.disclose && next.brandedContent) next.privacyLevel = "";
  return next;
}

/** Why TikTok can't post yet, in the owner's words, or null when it's ready. */
export function tiktokChoicesProblem(
  choices: TikTokPostChoices,
  creator: TikTokCreatorInfo | null,
  durationSeconds: number | null,
): string | null {
  if (!creator) return "TikTok settings are still loading.";
  if (!choices.privacyLevel) return "Choose who can see it on TikTok.";
  if (!creator.privacyLevelOptions.includes(choices.privacyLevel)) return "Choose who can see it on TikTok.";
  if (choices.disclose && !choices.yourBrand && !choices.brandedContent) {
    return "You need to indicate if your content promotes yourself, a third party, or both.";
  }
  if (choices.disclose && choices.brandedContent && choices.privacyLevel === "SELF_ONLY") {
    return "Branded content visibility cannot be set to private.";
  }
  if (!durationSeconds) return "ME3 couldn't read the video's length. Try adding it again.";
  if (durationSeconds > creator.maxVideoPostDurationSeconds) {
    return `This TikTok account takes videos up to ${creator.maxVideoPostDurationSeconds} seconds.`;
  }
  return null;
}

/** What ME3 sends to TikTok when the owner presses Post: the press is their consent. */
export function tiktokDeliveryOptions(choices: TikTokPostChoices, durationSeconds: number): TikTokPublishingSettings {
  return {
    deliveryMode: "direct_publish" as const,
    privacyLevel: choices.privacyLevel as TikTokPrivacyLevel,
    allowComment: choices.allowComment,
    allowDuet: choices.allowDuet,
    allowStitch: choices.allowStitch,
    brandOrganic: choices.disclose && choices.yourBrand,
    brandContent: choices.disclose && choices.brandedContent,
    isAiGenerated: false,
    consent: true as const,
    videoDurationSeconds: Math.ceil(durationSeconds),
  };
}

/**
 * What stops a TikTok post, from the settings panel's last report. No report yet means the
 * settings haven't loaded; a report with no problem means TikTok is ready to post.
 */
export function tiktokBlocker(report: { problem: string | null } | undefined): string | null {
  return report ? report.problem : "Choose TikTok's settings.";
}

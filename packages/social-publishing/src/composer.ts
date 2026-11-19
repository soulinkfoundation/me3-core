import {
  VIDEO_DURATION_SECONDS,
  YOUTUBE_SHORT_MAX_SECONDS,
  YOUTUBE_UNVERIFIED_MAX_SECONDS,
  socialPlatformCapabilities,
} from "./capabilities";

/**
 * What each connected account gets from a New post (me3-s0ib), shared by web and iOS.
 * Pure and free of Vue so the web unit tests and the iOS port run the same JSON cases
 * (fixtures/new-post-cases.json). ME3 never writes the post: these rules only decide
 * which of the owner's own words and media reach each account.
 *
 * The kind picked first leads on X and LinkedIn, which take one video or images but not
 * both, with a swap on the row. This deliberately replaces the old "video wins" rule.
 */

export type ComposerPostType = "text" | "images" | "video";
export type ComposerNetwork = "x" | "linkedin" | "instagram" | "facebook" | "youtube" | "tiktok";
export type ComposerMediaKind = "image" | "video";

export type ComposerVideoInfo = {
  /** Read from the file on pick. Null when the browser or device couldn't read it. */
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

export type ComposerMediaInput = {
  /** The picked media in the order shown. At most one video. */
  items: ComposerMediaKind[];
  video?: ComposerVideoInfo | null;
  /** The kind the owner picked first. It leads on X and LinkedIn when both are present. */
  firstKind?: ComposerMediaKind | null;
};

export type ComposerAccountInput = {
  id: string;
  network: ComposerNetwork;
  /** TikTok creator_info max_video_post_duration_sec, when loaded. */
  tiktokMaxVideoSeconds?: number | null;
  /** YouTube channels.list status.longUploadsStatus, when known. Only "allowed" posts over 15 minutes. */
  youtubeLongUploads?: "allowed" | "eligible" | "disallowed" | null;
};

export type ComposerInput = {
  type: ComposerPostType;
  media: ComposerMediaInput;
  accounts: ComposerAccountInput[];
  /** Accounts on X or LinkedIn where the owner chose the other kind of media. */
  swapped?: string[];
};

export type ComposerActionKind = "reorder" | "swap_to_video" | "swap_to_images" | "pick_cut" | "verify_youtube";

/** `href` is set for actions that leave ME3, such as verifying a YouTube channel. */
export type ComposerAction = { kind: ComposerActionKind; label: string; href?: string };

export const YOUTUBE_VERIFY_URL = "https://www.youtube.com/verify";

export type ComposerRow = {
  accountId: string;
  network: ComposerNetwork;
  /** Whether the account can take the post as it stands. */
  canTake: boolean;
  /** Whether the row starts ticked. */
  ticked: boolean;
  /** What the account gets, shown when it can take the post. */
  label: string | null;
  /** Why it can't take the post. */
  reason: string | null;
  /** "warn" when the account gets only part of the media. */
  tone: "normal" | "warn";
  actions: ComposerAction[];
  /** Positions in media.items this account gets, in order. */
  items: number[];
  /** "short_video" when the account gets the video on its own. */
  format: "short_video" | null;
  /** YouTube only: what the video will be, when its length and shape are known. */
  youtubeKind: "short" | "regular" | null;
  /** A non-blocking note, such as a landscape video for Reels. */
  hint: string | null;
  /** TikTok only: its length limit for this account isn't known yet, so it's checked on the post screen. */
  lengthUnchecked: boolean;
};

const NAMES: Record<ComposerNetwork, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
};

const VIDEO_ONLY = "Video only";
const TIKTOK_NEXT = "You choose who sees it on the next screen.";

/** The most images each network takes in one post, from its capabilities. */
export function composerImageLimit(network: ComposerNetwork): number {
  const rules = socialPlatformCapabilities(network).contentRules;
  return Math.max(0, ...rules.filter((rule) => rule.allowedMediaKinds.includes("image")).map((rule) => rule.maxMediaItems));
}

/** 0:48, 3:20, 20:00, 1:02:05. */
export function formatVideoDuration(seconds: number): string {
  if (seconds < 1) return "half a second";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function imagesText(count: number): string {
  return count === 1 ? "an image" : `${count} images`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type LengthCheck = { ok: true; unchecked: boolean } | { ok: false; reason: string; action: ComposerAction };

function videoLength(account: ComposerAccountInput, video: ComposerVideoInfo | null | undefined): LengthCheck {
  const network = account.network;
  if (network === "tiktok" && account.tiktokMaxVideoSeconds == null) return { ok: true, unchecked: true };
  const duration = video?.durationSeconds;
  if (duration == null || !Number.isFinite(duration)) return { ok: true, unchecked: false };
  const limits = network in VIDEO_DURATION_SECONDS ? VIDEO_DURATION_SECONDS[network as keyof typeof VIDEO_DURATION_SECONDS] : null;
  const max = network === "tiktok" ? account.tiktokMaxVideoSeconds ?? null : limits?.max ?? null;
  const min = limits?.min ?? null;
  if (max != null && duration > max) {
    const where = network === "tiktok" ? " on this account" : "";
    return {
      ok: false,
      reason: `Too long: ${NAMES[network]} takes up to ${formatVideoDuration(max)}${where}`,
      action: { kind: "pick_cut", label: "Pick a shorter cut" },
    };
  }
  if (network === "youtube" && duration > YOUTUBE_UNVERIFIED_MAX_SECONDS && account.youtubeLongUploads && account.youtubeLongUploads !== "allowed") {
    return {
      ok: false,
      reason: "Verify your channel in YouTube to post videos over 15 minutes",
      action: { kind: "verify_youtube", label: "Verify in YouTube", href: YOUTUBE_VERIFY_URL },
    };
  }
  if (min != null && duration < min) {
    return {
      ok: false,
      reason: `Too short: ${NAMES[network]} needs at least ${formatVideoDuration(min)}`,
      action: { kind: "pick_cut", label: "Pick a longer cut" },
    };
  }
  return { ok: true, unchecked: false };
}

function shape(video: ComposerVideoInfo | null | undefined): "landscape" | "upright" | null {
  if (!video?.width || !video?.height) return null;
  return video.width > video.height ? "landscape" : "upright";
}

/** Short when 3:00 or less and square or vertical, regular otherwise, null when it can't tell. */
export function youtubeVideoKind(video: ComposerVideoInfo | null | undefined): "short" | "regular" | null {
  const duration = video?.durationSeconds;
  if (duration == null) return null;
  if (duration > YOUTUBE_SHORT_MAX_SECONDS) return "regular";
  const form = shape(video);
  if (!form) return null;
  return form === "upright" ? "short" : "regular";
}

function landscapeHint(network: ComposerNetwork, video: ComposerVideoInfo | null | undefined): string | null {
  if (shape(video) !== "landscape") return null;
  if (network === "instagram") return "Reels show best vertical (9:16).";
  if (network === "tiktok") return "TikTok shows best vertical (9:16).";
  if (network === "youtube" && (video?.durationSeconds ?? Infinity) <= YOUTUBE_SHORT_MAX_SECONDS) {
    return "Square or vertical would make it a Short.";
  }
  return null;
}

function base(account: ComposerAccountInput): ComposerRow {
  return {
    accountId: account.id,
    network: account.network,
    canTake: true,
    ticked: true,
    label: null,
    reason: null,
    tone: "normal",
    actions: [],
    items: [],
    format: null,
    youtubeKind: null,
    hint: null,
    lengthUnchecked: false,
  };
}

function cant(row: ComposerRow, reason: string, actions: ComposerAction[] = []): ComposerRow {
  return { ...row, canTake: false, ticked: false, label: null, reason, actions, items: [], format: null, tone: "normal" };
}

/** Images for X, LinkedIn, Facebook or Instagram: the first ones in order, up to the network's limit. */
function imagesRow(row: ComposerRow, imageIndexes: number[], suffix = ""): ComposerRow {
  const limit = composerImageLimit(row.network);
  const total = imageIndexes.length;
  const over = total > limit;
  const items = imageIndexes.slice(0, limit);
  let label: string;
  if (row.network === "instagram" && !suffix) {
    label = over ? `Carousel, first ${limit} of ${total}` : total === 1 ? "An image" : `Carousel of ${total}`;
  } else {
    label = over ? `First ${limit} of ${total} images` : capitalise(imagesText(total));
  }
  return {
    ...row,
    label: `${label}${suffix}`,
    tone: over ? "warn" : "normal",
    actions: over ? [{ kind: "reorder", label: "Reorder to choose" }] : [],
    items,
  };
}

/** The video on its own. */
function videoRow(
  row: ComposerRow,
  account: ComposerAccountInput,
  media: ComposerMediaInput,
  videoIndex: number | null,
  withImages: boolean,
): ComposerRow {
  const network = account.network;
  const length = videoLength(account, media.video);
  const swapBack: ComposerAction[] =
    withImages && (network === "x" || network === "linkedin") ? [{ kind: "swap_to_images", label: "Send the images instead" }] : [];
  if (!length.ok) return cant(row, length.reason, [length.action, ...swapBack]);
  const youtubeKind = network === "youtube" ? youtubeVideoKind(media.video) : null;
  let label: string;
  if (withImages && (network === "x" || network === "linkedin")) label = "The video, not the images";
  else if (network === "instagram") label = "Reel";
  else if (network === "youtube") {
    label = youtubeKind === "short" ? "Short" : youtubeKind === "regular" ? "Regular video" : "Video";
  } else if (network === "tiktok") label = `Video. ${TIKTOK_NEXT}`;
  else label = "Video";
  return {
    ...row,
    label,
    actions: swapBack,
    items: videoIndex == null ? [] : [videoIndex],
    format: "short_video",
    youtubeKind,
    hint: landscapeHint(network, media.video),
    lengthUnchecked: length.unchecked,
  };
}

function textRow(row: ComposerRow): ComposerRow {
  switch (row.network) {
    case "x":
    case "linkedin":
      return { ...row, label: "Text post" };
    case "facebook":
      return { ...row, label: "Post on your Page" };
    case "instagram":
      return cant(row, "Needs an image or video");
    default:
      return cant(row, VIDEO_ONLY);
  }
}

/** Before any images are picked, say how many each account takes. */
function emptyImagesRow(row: ComposerRow): ComposerRow {
  if (row.network === "youtube" || row.network === "tiktok") return cant(row, VIDEO_ONLY);
  return { ...row, label: `Up to ${composerImageLimit(row.network)} images` };
}

function mixedRow(
  row: ComposerRow,
  account: ComposerAccountInput,
  input: ComposerInput,
  imageIndexes: number[],
  videoIndex: number,
  lead: ComposerMediaKind,
): ComposerRow {
  const network = account.network;
  const media = input.media;
  if (network === "instagram") {
    const limit = composerImageLimit("instagram");
    const total = media.items.length;
    const items = media.items.map((_, index) => index).slice(0, limit);
    if (total > limit) {
      return { ...row, label: `Carousel, first ${limit} of ${total}`, tone: "warn", actions: [{ kind: "reorder", label: "Reorder to choose" }], items };
    }
    return { ...row, label: `Carousel: ${imagesText(imageIndexes.length)} and the video`, items };
  }
  if (network === "facebook") return imagesRow(row, imageIndexes);
  if (network === "youtube" || network === "tiktok") {
    const video = videoRow(row, account, media, videoIndex, true);
    if (lead === "video" || !video.canTake) return video;
    return { ...video, ticked: false, label: "Would get just the video", hint: null };
  }
  // X and LinkedIn take one or the other: the kind picked first, unless the owner swapped.
  const swapped = input.swapped?.includes(account.id) ?? false;
  const gets: ComposerMediaKind = swapped ? (lead === "image" ? "video" : "image") : lead;
  if (gets === "video") return videoRow(row, account, media, videoIndex, true);
  const images = imagesRow(row, imageIndexes, ", not the video");
  const length = videoLength(account, media.video);
  return length.ok ? { ...images, actions: [...images.actions, { kind: "swap_to_video", label: "Send the video instead" }] } : images;
}

/** One row per connected account: what it gets, whether it can take it, and whether it starts ticked. */
export function composerRows(input: ComposerInput): ComposerRow[] {
  const items = input.media.items;
  const imageIndexes = items.flatMap((kind, index) => (kind === "image" ? [index] : []));
  const videoPosition = items.indexOf("video");
  const videoIndex = videoPosition < 0 ? null : videoPosition;
  const lead: ComposerMediaKind = input.media.firstKind ?? (input.type === "video" ? "video" : "image");
  return input.accounts.map((account) => {
    const row = base(account);
    if (input.type === "text") return textRow(row);
    if (imageIndexes.length && videoIndex != null) return mixedRow(row, account, input, imageIndexes, videoIndex, lead);
    if (videoIndex != null || (input.type === "video" && !imageIndexes.length)) {
      return videoRow(row, account, input.media, videoIndex, false);
    }
    if (imageIndexes.length) {
      if (account.network === "youtube" || account.network === "tiktok") return cant(row, VIDEO_ONLY);
      return imagesRow(row, imageIndexes);
    }
    return emptyImagesRow(row);
  });
}

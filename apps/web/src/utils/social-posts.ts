import type {
  PostVersion,
  SocialAccountRow,
  SocialPlatform,
  SocialPlatformCapabilities,
  SocialPostDetail,
  SocialSuggestion,
} from "../stores/social";

/**
 * Owner-facing rules for Social (me3-bli3.3): one row per post, plain words, no internal names
 * (Version, Publication, Source) and no ids. Kept free of Vue so pages and tests share them.
 */

export type SocialTab = "ideas" | "drafts" | "scheduled" | "posted";

export const SOCIAL_TABS: ReadonlyArray<{ id: SocialTab; label: string }> = [
  { id: "ideas", label: "Ideas" },
  { id: "drafts", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "posted", label: "Posted" },
];

/** The accounts the owner can connect, in the order the accounts sheet shows them. TikTok stays hidden. */
export type SocialNetwork = "x" | "linkedin" | "instagram" | "facebook" | "youtube";

export const SOCIAL_NETWORKS: ReadonlyArray<{
  id: SocialNetwork;
  label: string;
  mark: string;
  note: string;
}> = [
  { id: "x", label: "X", mark: "X", note: "Posts to your X profile" },
  { id: "linkedin", label: "LinkedIn", mark: "in", note: "Posts to your LinkedIn profile" },
  { id: "instagram", label: "Instagram", mark: "IG", note: "Business or creator account" },
  { id: "facebook", label: "Facebook", mark: "f", note: "Posts to a Page you manage" },
  {
    id: "youtube",
    label: "YouTube Shorts",
    mark: "▶",
    note: "Uploads as a private draft. You publish it in YouTube.",
  },
];

export const YOUTUBE_TITLE_LIMIT = 100;

/** A Short's starting title: the first line of the owner's text, cut to YouTube's limit. */
export function youtubeTitleFrom(text: string): string {
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "";
  const chars = Array.from(firstLine);
  return chars.length > YOUTUBE_TITLE_LIMIT ? `${chars.slice(0, YOUTUBE_TITLE_LIMIT - 1).join("").trimEnd()}…` : firstLine;
}

export function socialNetwork(platform: SocialPlatform | string): SocialNetwork | null {
  if (platform === "instagram_business") return "instagram";
  return SOCIAL_NETWORKS.some((network) => network.id === platform) ? (platform as SocialNetwork) : null;
}

export function networkLabel(platform: SocialPlatform | string): string {
  const network = socialNetwork(platform);
  if (network === "youtube") return "YouTube";
  return SOCIAL_NETWORKS.find((item) => item.id === network)?.label || "Social";
}

export function networkMark(platform: SocialPlatform | string): string {
  return SOCIAL_NETWORKS.find((item) => item.id === socialNetwork(platform))?.mark || "•";
}

/** Platforms the owner can see on a post; TikTok drafts from the old app stay out of the owner UI. */
export function visibleVersions(detail: SocialPostDetail): PostVersion[] {
  const order = SOCIAL_NETWORKS.map((network) => network.id as string);
  return detail.versions
    .filter((version) => socialNetwork(version.platform))
    .sort((a, b) => order.indexOf(socialNetwork(a.platform)!) - order.indexOf(socialNetwork(b.platform)!));
}

const IN_FLIGHT = new Set(["scheduled", "queued", "publishing"]);

export function postTab(detail: SocialPostDetail): Exclude<SocialTab, "ideas"> {
  const versions = visibleVersions(detail);
  if (versions.some((version) => IN_FLIGHT.has(version.publicationStatus || ""))) return "scheduled";
  if (versions.some((version) => version.publicationStatus === "published")) return "posted";
  // A post that failed outright stays with Scheduled, where its fix is.
  if (versions.some((version) => version.publicationStatus === "failed")) return "scheduled";
  return "drafts";
}

const GENERIC_TITLES = new Set(["", "pasted text", "untitled", "untitled post"]);

export function postTitle(detail: SocialPostDetail): string {
  const title = detail.post.sourceTitle?.trim() || "";
  if (!GENERIC_TITLES.has(title.toLowerCase())) return title;
  const text = detail.post.ideaText?.trim() || visibleVersions(detail)[0]?.bodyText?.trim() || "";
  const firstLine = text.split(/\n/, 1)[0]?.trim() || "";
  if (!firstLine) return "Untitled post";
  return firstLine.length > 70 ? `${firstLine.slice(0, 67).trimEnd()}…` : firstLine;
}

export function postSourceLabel(detail: SocialPostDetail): string | null {
  switch (detail.post.sourceType) {
    case "journal":
      return "From your journal";
    case "site":
      return "From your site";
    case "mission_task":
      return "From a task";
    case "file":
      return "From your files";
    case "pasted":
      return detail.post.createdBy === "agent" ? "From your message" : null;
    default:
      return null;
  }
}

export function nextScheduledAt(detail: SocialPostDetail): string | null {
  const times = visibleVersions(detail)
    .filter((version) => IN_FLIGHT.has(version.publicationStatus || "") && version.scheduledFor)
    .map((version) => version.scheduledFor!)
    .sort();
  return times[0] || null;
}

export function lastPostedAt(detail: SocialPostDetail): string | null {
  const times = visibleVersions(detail)
    .map((version) => version.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return times[times.length - 1] || null;
}

export function formatWhen(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day}, ${time}`;
}

/** "Thu 12:30": the short form the Schedule button names. */
export function formatShortWhen(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day} ${time}`;
}

export type AccountState = "connected" | "disconnected" | "not_connected";

export function accountsFor(network: SocialNetwork, accounts: SocialAccountRow[]): SocialAccountRow[] {
  return accounts.filter((account) => socialNetwork(account.platform) === network);
}

export function accountState(network: SocialNetwork, accounts: SocialAccountRow[]): AccountState {
  const matching = accountsFor(network, accounts);
  if (matching.some((account) => account.status === "active")) return "connected";
  return matching.length ? "disconnected" : "not_connected";
}

export function activeAccount(platform: SocialPlatform, accounts: SocialAccountRow[]): SocialAccountRow | null {
  return (
    accounts.find((account) => account.platform === platform && account.status === "active") ||
    accounts.find(
      (account) => socialNetwork(account.platform) === socialNetwork(platform) && account.status === "active",
    ) ||
    null
  );
}

export function accountName(account: SocialAccountRow): string {
  if (account.handle) return account.handle.startsWith("@") ? account.handle : `@${account.handle}`;
  return account.displayName || "Connected";
}

/** Scheduled posts waiting on an account that needs reconnecting. */
export function pausedPostCount(network: SocialNetwork, posts: SocialPostDetail[], accounts: SocialAccountRow[]): number {
  if (accountState(network, accounts) !== "disconnected") return 0;
  return posts.filter((detail) =>
    visibleVersions(detail).some(
      (version) =>
        socialNetwork(version.platform) === network &&
        (IN_FLIGHT.has(version.publicationStatus || "") || version.failureClass === "reconnect_required"),
    ),
  ).length;
}

export type AttentionItem =
  | { kind: "disconnected"; network: SocialNetwork; label: string; paused: number }
  | { kind: "failed"; postId: string; title: string; detail: string };

export function attentionItems(posts: SocialPostDetail[], accounts: SocialAccountRow[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const paused = pausedPostCount(network.id, posts, accounts);
    if (accountState(network.id, accounts) === "disconnected" && paused > 0) {
      items.push({ kind: "disconnected", network: network.id, label: network.label, paused });
    }
  }
  for (const detail of posts) {
    const failed = visibleVersions(detail).find(
      (version) => version.publicationStatus === "failed" && version.failureClass !== "reconnect_required",
    );
    if (failed) {
      items.push({
        kind: "failed",
        postId: detail.post.id,
        title: postTitle(detail),
        detail: resultFor(failed).message,
      });
    }
  }
  return items;
}

/** The line under a row in the list. */
export function postRowDetail(
  detail: SocialPostDetail,
  capabilities: SocialPlatformCapabilities[],
  accounts: SocialAccountRow[] = [],
): {
  text: string;
  tone: "muted" | "danger";
} {
  const versions = visibleVersions(detail);
  const failed = versions.find((version) => version.publicationStatus === "failed");
  if (failed) return { text: resultFor(failed).message, tone: "danger" };
  const paused = versions.find(
    (version) =>
      IN_FLIGHT.has(version.publicationStatus || "") &&
      accountState(socialNetwork(version.platform)!, accounts) === "disconnected",
  );
  if (paused) return { text: `Paused until ${networkLabel(paused.platform)} reconnects`, tone: "danger" };
  if (postTab(detail) === "drafts") {
    const problem = versions.flatMap((version) => versionChecks(version, capabilities).filter((check) => check.blocking))[0];
    if (problem) return { text: problem.message, tone: "danger" };
  }
  const images = Math.max(0, ...versions.map((version) => version.assetManifest.filter(isImageAsset).length));
  if (images > 1) return { text: `${images} images`, tone: "muted" };
  if (images === 1) return { text: "1 image", tone: "muted" };
  return { text: postSourceLabel(detail) || `${versions.length} platform${versions.length === 1 ? "" : "s"}`, tone: "muted" };
}

export type VersionCheck = {
  message: string;
  blocking: boolean;
  field: "text" | "images" | "account";
  /** A one-click fix ME3 can make. */
  fix?: "convert_video" | "thread_or_shorten";
};

function textLimit(platform: SocialPlatform, capabilities: SocialPlatformCapabilities[]): number | null {
  const rules = capabilities.find((item) => item.platform === platform)?.contentRules || [];
  const limits = rules.map((rule) => rule.maxTextCharacters).filter((limit): limit is number => typeof limit === "number");
  return limits.length ? Math.max(...limits) : null;
}

export function versionTextLimit(version: PostVersion, capabilities: SocialPlatformCapabilities[]): number | null {
  return textLimit(version.platform, capabilities);
}

function maxImages(platform: SocialPlatform, capabilities: SocialPlatformCapabilities[]): number {
  const rules = capabilities.find((item) => item.platform === platform)?.contentRules || [];
  return Math.max(0, ...rules.filter((rule) => rule.allowedMediaKinds.includes("image")).map((rule) => rule.maxMediaItems));
}

type ContentRule = SocialPlatformCapabilities["contentRules"][number];

function rulesFor(platform: SocialPlatform, capabilities: SocialPlatformCapabilities[]): ContentRule[] {
  return capabilities.find((item) => item.platform === platform)?.contentRules || [];
}

/** A photo, including old assets saved without a kind. */
export function isImageAsset(asset: { kind?: string }): boolean {
  return !asset.kind || asset.kind === "image";
}

/** The video a platform takes on its own (a Reel, a Short, an X video); null when it takes none. */
export function videoRule(platform: SocialPlatform, capabilities: SocialPlatformCapabilities[]): ContentRule | null {
  const rules = rulesFor(platform, capabilities).filter((rule) => rule.allowedMediaKinds.includes("video"));
  return rules.find((rule) => !rule.allowedMediaKinds.includes("image")) || rules[0] || null;
}

/** A carousel that mixes photos and videos (Instagram), or null. */
export function mixedMediaRule(platform: SocialPlatform, capabilities: SocialPlatformCapabilities[]): ContentRule | null {
  return rulesFor(platform, capabilities).find((rule) => rule.allowedMediaKinds.includes("image") && rule.allowedMediaKinds.includes("video")) || null;
}

/** A PDF document post (LinkedIn), or null. */
export function documentRule(platform: SocialPlatform, capabilities: SocialPlatformCapabilities[]): ContentRule | null {
  return rulesFor(platform, capabilities).find((rule) => rule.allowedMediaKinds.includes("document")) || null;
}

export function takesImages(platform: SocialPlatform, capabilities: SocialPlatformCapabilities[]): boolean {
  return maxImages(platform, capabilities) > 0;
}

function mimeAllowed(type: string, allowed: string[]): boolean {
  return allowed.some((item) => item === type || (item.endsWith("/*") && type.startsWith(item.slice(0, -1))));
}

function fileKind(type: string): string {
  if (type === "video/quicktime") return "MOV";
  return type.replace(/^[a-z]+\//, "").split("+")[0]!.toUpperCase();
}

function videoChecks(version: PostVersion, capabilities: SocialPlatformCapabilities[], label: string): VersionCheck[] {
  const videos = version.assetManifest.filter((asset) => asset.kind === "video");
  if (!videos.length) return [];
  const rule = videoRule(version.platform, capabilities);
  if (!rule) return [{ message: `${label} doesn't take video here. Remove it or use images.`, blocking: true, field: "images" }];
  const checks: VersionCheck[] = [];
  const mixed = mixedMediaRule(version.platform, capabilities);
  if (mixed && version.assetManifest.length > 1) {
    if (version.assetManifest.length > mixed.maxMediaItems) {
      checks.push({ message: `${label} takes up to ${mixed.maxMediaItems} photos and videos.`, blocking: true, field: "images" });
    }
  } else if (version.assetManifest.length > rule.maxMediaItems) {
    checks.push({ message: `${label} takes one video and no images.`, blocking: true, field: "images" });
  }
  const video = videos.find((item) => {
    const type = item.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
    return type && rule.allowedMimeTypes.length && !mimeAllowed(type, rule.allowedMimeTypes);
  }) || videos[0]!;
  const type = video.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  const convertible = mimeAllowed("video/mp4", rule.allowedMimeTypes);
  if (type && rule.allowedMimeTypes.length && !mimeAllowed(type, rule.allowedMimeTypes)) {
    const wanted = rule.allowedMimeTypes.map(fileKind).join(" or ");
    checks.push({
      message:
        type === "video/quicktime"
          ? `${label} takes ${wanted} video, and this is a MOV (iPhone) file.`
          : `${label} takes ${wanted} video, not ${fileKind(type)}.`,
      blocking: true,
      field: "images",
      ...(convertible ? { fix: "convert_video" as const } : {}),
    });
  } else if (rule.maxBytesPerItem && typeof video.byteLength === "number" && video.byteLength > rule.maxBytesPerItem) {
    checks.push({
      message: `The video is too big for ${label} (up to ${Math.round(rule.maxBytesPerItem / 1024 / 1024).toLocaleString()} MB).`,
      blocking: true,
      field: "images",
      ...(convertible ? { fix: "convert_video" as const } : {}),
    });
  }
  return checks;
}

function documentChecks(version: PostVersion, capabilities: SocialPlatformCapabilities[], label: string): VersionCheck[] {
  const documents = version.assetManifest.filter((asset) => asset.kind === "document");
  if (!documents.length) return [];
  const rule = documentRule(version.platform, capabilities);
  if (!rule) return [{ message: `${label} doesn't take PDFs. Remove it to post here.`, blocking: true, field: "images" }];
  if (version.assetManifest.length > 1) return [{ message: `${label} posts a PDF on its own, without photos or video.`, blocking: true, field: "images" }];
  const size = documents[0]!.byteLength;
  if (rule.maxBytesPerItem && typeof size === "number" && size > rule.maxBytesPerItem) {
    return [{ message: `The PDF is too big for ${label} (up to ${Math.round(rule.maxBytesPerItem / 1024 / 1024)} MB).`, blocking: true, field: "images" }];
  }
  return [];
}

/** Problems shown beside the field they affect. Blocking ones stop scheduling for that platform. */
export function versionChecks(
  version: PostVersion,
  capabilities: SocialPlatformCapabilities[],
  accounts?: SocialAccountRow[],
): VersionCheck[] {
  const label = networkLabel(version.platform);
  const checks: VersionCheck[] = [];
  const length = Array.from(version.bodyText).length;
  const limit = textLimit(version.platform, capabilities);
  const images = version.assetManifest.filter(isImageAsset);
  const videos = version.assetManifest.filter((asset) => asset.kind === "video");
  if (!version.bodyText.trim() && version.platform !== "youtube") {
    checks.push({ message: `Add some text for ${label}.`, blocking: true, field: "text" });
  }
  if (limit !== null && isThread(version)) {
    const parts = threadParts(version.bodyText);
    parts.forEach((part, index) => {
      const partLength = Array.from(part).length;
      if (partLength > limit) {
        checks.push({ message: `Post ${index + 1} of the thread is ${partLength} characters, ${label}'s limit is ${limit}.`, blocking: true, field: "text" });
      }
    });
    if (parts.length > 25) checks.push({ message: "A thread can have up to 25 posts.", blocking: true, field: "text" });
  } else if (limit !== null && length > limit) {
    checks.push({
      message: `${length} characters, ${label}'s limit is ${limit.toLocaleString()}.`,
      blocking: true,
      field: "text",
      ...(version.platform === "x" ? { fix: "thread_or_shorten" as const } : {}),
    });
  }
  if (socialNetwork(version.platform) === "instagram" && version.assetManifest.length === 0) {
    const message = videoRule(version.platform, capabilities) ? "Instagram needs an image or a video." : "Instagram needs an image.";
    checks.push({ message, blocking: true, field: "images" });
  }
  if (version.platform === "youtube" && videos.length === 0) {
    checks.push({ message: "YouTube Shorts needs a video.", blocking: true, field: "images" });
  }
  if (version.platform === "youtube") {
    const titleLength = Array.from(version.title?.trim() || "").length;
    if (!titleLength) checks.push({ message: "Give the Short a title.", blocking: true, field: "text" });
    else if (titleLength > YOUTUBE_TITLE_LIMIT) {
      checks.push({ message: `The title is ${titleLength} characters, YouTube's limit is ${YOUTUBE_TITLE_LIMIT}.`, blocking: true, field: "text" });
    }
  }
  if (version.platform !== "youtube") checks.push(...videoChecks(version, capabilities, label));
  checks.push(...documentChecks(version, capabilities, label));
  const allowed = maxImages(version.platform, capabilities);
  if (images.length > allowed && version.platform !== "youtube") {
    checks.push({
      message: allowed ? `${label} takes up to ${allowed} images.` : `${label} doesn't take images.`,
      blocking: true,
      field: "images",
    });
  }
  const allowedTypes = new Set(
    (capabilities.find((item) => item.platform === version.platform)?.contentRules || [])
      .filter((rule) => rule.allowedMediaKinds.includes("image"))
      .flatMap((rule) => rule.allowedMimeTypes),
  );
  images.forEach((asset, index) => {
    const type = asset.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
    if (type && allowedTypes.size && !allowedTypes.has(type)) {
      checks.push({
        message: `${label} can't use image ${index + 1} (${type.replace("image/", "").split("+")[0]!.toUpperCase()}).`,
        blocking: true,
        field: "images",
      });
    }
  });
  if (accounts && !activeAccount(version.platform, accounts)) {
    const state = accountState(socialNetwork(version.platform)!, accounts);
    checks.push({
      message: state === "disconnected" ? `Reconnect ${label} to post.` : `Connect ${label} to post.`,
      blocking: true,
      field: "account",
    });
  }
  return checks;
}

export type ResultAction = "view" | "retry" | "reconnect" | "edit" | "mark_posted" | "open_youtube" | null;

export type VersionResult = {
  state: "draft" | "scheduled" | "posting" | "posted" | "retrying" | "failed" | "unknown";
  message: string;
  action: ResultAction;
  actionLabel: string | null;
};

/** One outcome per platform with one next step, mapped from the failure class. */
export function resultFor(version: PostVersion): VersionResult {
  const label = networkLabel(version.platform);
  switch (version.publicationStatus) {
    case "published":
      if (version.platform === "youtube") {
        return { state: "posted", message: "Uploaded as a private draft", action: "open_youtube", actionLabel: "Publish in YouTube" };
      }
      return {
        state: "posted",
        message: version.publishedAt ? `Posted ${formatWhen(version.publishedAt)}` : "Posted",
        action: version.platformPostUrl ? "view" : null,
        actionLabel: version.platformPostUrl ? "View" : null,
      };
    case "scheduled":
      return { state: "scheduled", message: `Scheduled for ${formatWhen(version.scheduledFor)}`, action: null, actionLabel: null };
    case "queued":
    case "publishing":
      return { state: "posting", message: "Posting…", action: null, actionLabel: null };
    case "failed":
      break;
    default:
      return { state: "draft", message: "Not scheduled", action: null, actionLabel: null };
  }
  switch (version.failureClass) {
    case "retryable":
      return { state: "retrying", message: `${label} didn't answer. Try again in a moment.`, action: "retry", actionLabel: "Try again" };
    case "reconnect_required":
      return { state: "failed", message: `${label} is disconnected. Reconnect to post.`, action: "reconnect", actionLabel: "Reconnect" };
    case "outcome_unknown":
      return { state: "unknown", message: "Not confirmed. Check your profile.", action: "mark_posted", actionLabel: "Mark as posted" };
    case "unsupported":
      return { state: "failed", message: `${label} doesn't accept this post. Edit it and try again.`, action: "edit", actionLabel: "Edit and retry" };
    default:
      return {
        state: "failed",
        message: plainError(version.errorMessage) || `${label} didn't accept this post.`,
        action: "edit",
        actionLabel: "Edit and retry",
      };
  }
}

/** Provider messages can carry codes and internal names; keep the first plain sentence. */
function plainError(message: string | null | undefined): string | null {
  const text = message?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/version|publication|\b[a-z]+_[a-z_]+\b|\(#?\d+\)/i.test(text)) return null;
  const sentence = text.split(/(?<=\.)\s/, 1)[0] || text;
  return sentence.length > 140 ? null : sentence;
}

export function ideaTitle(idea: SocialSuggestion): string {
  const title = idea.sourceTitle?.trim();
  if (title && !GENERIC_TITLES.has(title.toLowerCase())) return title;
  const text = idea.bodyText.trim().split(/\n/, 1)[0] || "Idea";
  return text.length > 70 ? `${text.slice(0, 67).trimEnd()}…` : text;
}

export function ideaSourceLabel(idea: SocialSuggestion): string {
  switch (idea.sourceType) {
    case "journal":
      return "From your journal";
    case "site":
      return "From your site";
    case "mission_task":
      return "From a task";
    case "file":
      return "From your files";
    default:
      return "Saved idea";
  }
}

/** The one suggested time: the next weekday at 12:30, at least an hour away. */
export function suggestedTime(now = new Date()): Date {
  const next = new Date(now);
  next.setHours(12, 30, 0, 0);
  if (next.getTime() - now.getTime() < 60 * 60 * 1000) next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

/** Where each feed cuts a caption behind "see more": characters, then lines, whichever comes first. */
const FOLDS: Partial<Record<SocialNetwork, { chars: number; lines: number; label: string }>> = {
  linkedin: { chars: 210, lines: 3, label: "…see more" },
  instagram: { chars: 125, lines: 2, label: "… more" },
  facebook: { chars: 480, lines: 5, label: "See more" },
};

export function foldFor(platform: SocialPlatform | string): { chars: number; lines: number; label: string } | null {
  const network = socialNetwork(platform);
  return (network && FOLDS[network]) || null;
}

/** The index in the text where the feed folds it, or null when it all shows. */
export function foldIndex(platform: SocialPlatform | string, text: string): number | null {
  const fold = foldFor(platform);
  if (!fold) return null;
  let index = text.length;
  let lines = 1;
  for (let position = 0; position < text.length; position += 1) {
    if (text[position] === "\n" && ++lines > fold.lines) {
      index = position;
      break;
    }
  }
  // Count in characters people see (emoji are one), not UTF-16 units.
  const chars = Array.from(text);
  if (chars.length > fold.chars) index = Math.min(index, chars.slice(0, fold.chars).join("").length);
  const shown = text.slice(0, index).trimEnd().length;
  return shown < text.trimEnd().length ? shown : null;
}

/** The list with one item moved from one position to another. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** A line holding only three or more dashes separates the posts of an X thread. */
const THREAD_SEPARATOR = /\n[ \t]*-{3,}[ \t]*(?:\n|$)/;
export const THREAD_JOIN = "\n\n---\n\n";

export function threadParts(text: string): string[] {
  return text.split(THREAD_SEPARATOR).map((part) => part.trim()).filter(Boolean);
}

export function isThread(version: PostVersion): boolean {
  return version.platform === "x" && version.publishingSettings?.post?.thread === true;
}

/** Splits text into posts of at most `limit` characters: between paragraphs, then sentences, then words. */
export function splitIntoThread(text: string, limit = 280): string[] {
  const size = (value: string) => Array.from(value).length;
  const pieces: string[] = [];
  for (const paragraph of text.trim().split(/\n{2,}/)) {
    for (const sentence of paragraph.split(/(?<=[.!?…])\s+/)) {
      if (size(sentence) <= limit) {
        pieces.push(sentence);
        continue;
      }
      let line = "";
      for (const word of sentence.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (size(next) > limit && line) {
          pieces.push(line);
          line = word;
        } else line = next;
      }
      if (line) pieces.push(line);
    }
    pieces.push("\n\n");
  }
  const posts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (piece === "\n\n") {
      if (current) current += "\n\n";
      continue;
    }
    const joined = current ? (current.endsWith("\n\n") ? current + piece : `${current} ${piece}`) : piece;
    if (size(joined.trim()) <= limit) current = joined;
    else {
      if (current.trim()) posts.push(current.trim());
      current = piece;
    }
  }
  if (current.trim()) posts.push(current.trim());
  return posts;
}

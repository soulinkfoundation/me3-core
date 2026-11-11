/**
 * Per-platform choices the owner saves on a Post Version (publishingSettings.post) and that
 * travel with each publication: an X thread, and a first comment or reply (usually the link).
 */

export type SocialPostOptions = {
  /** X only: the text is a thread, one post per part between lines of "---". */
  thread?: boolean;
  /** Posted right after the post, as a comment (LinkedIn, Instagram, Facebook) or reply (X). */
  firstComment?: string;
  /** This platform's handle for a mention written in the text: "@ME3" → "@me3_app". */
  mentions?: Record<string, string>;
  /** Hashtags for this platform, added at the end of the post. */
  hashtags?: string;
};

export const POST_OPTION_PLATFORMS = ["x", "linkedin", "instagram", "instagram_business", "facebook"] as const;
export const THREAD_PART_LIMIT = 25;
export const FIRST_COMMENT_MAX_CHARS = 1_250;

export const MENTION_LIMIT = 30;
export const MENTION_TOKEN = /^@[\p{L}\p{N}_.]{1,60}$/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The text as this platform posts it: its own handle for each mapped mention, then its
 * hashtags (unless the text already ends with them).
 */
export function renderPostText(body: string, options: SocialPostOptions): string {
  let text = body;
  for (const [token, handle] of Object.entries(options.mentions || {})) {
    text = text.replace(new RegExp(`(^|[^\\p{L}\\p{N}_@])${escapeRegExp(token)}(?![\\p{L}\\p{N}_])`, "gu"), `$1${handle}`);
  }
  const hashtags = options.hashtags?.trim();
  if (hashtags && !text.trimEnd().endsWith(hashtags)) text = `${text.trimEnd()}\n\n${hashtags}`;
  return text;
}

/** A line holding only three or more dashes separates thread posts. */
const THREAD_SEPARATOR = /\n[ \t]*-{3,}[ \t]*(?:\n|$)/;

export function threadParts(body: string): string[] {
  return body
    .split(THREAD_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizePostOptions(value: unknown, platform?: string): SocialPostOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const options: SocialPostOptions = {};
  if (record.thread === true && (!platform || platform === "x")) options.thread = true;
  if (record.mentions && typeof record.mentions === "object" && !Array.isArray(record.mentions)) {
    const mentions: Record<string, string> = {};
    for (const [token, value] of Object.entries(record.mentions as Record<string, unknown>).slice(0, MENTION_LIMIT)) {
      if (!MENTION_TOKEN.test(token) || typeof value !== "string") continue;
      const handle = value.trim().slice(0, 100);
      if (handle && handle !== token) mentions[token] = handle;
    }
    if (Object.keys(mentions).length) options.mentions = mentions;
  }
  if (typeof record.hashtags === "string") {
    const hashtags = record.hashtags.replace(/\s+/g, " ").trim().slice(0, 500);
    if (hashtags) options.hashtags = hashtags;
  }
  if (typeof record.firstComment === "string") {
    const comment = record.firstComment.trim();
    if (comment) options.firstComment = Array.from(comment).slice(0, FIRST_COMMENT_MAX_CHARS).join("");
  }
  return options;
}

/** The posts an X publication makes: the parts of a thread, or the one post. */
export function xPostTexts(body: string, options: SocialPostOptions): string[] {
  const text = renderPostText(body, options);
  return options.thread ? threadParts(text) : [text.trim()];
}

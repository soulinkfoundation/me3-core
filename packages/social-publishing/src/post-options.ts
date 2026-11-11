/**
 * Per-platform choices the owner saves on a Post Version (publishingSettings.post) and that
 * travel with each publication: an X thread, and a first comment or reply (usually the link).
 */

export type SocialPostOptions = {
  /** X only: the text is a thread, one post per part between lines of "---". */
  thread?: boolean;
  /** Posted right after the post, as a comment (LinkedIn, Instagram, Facebook) or reply (X). */
  firstComment?: string;
};

export const POST_OPTION_PLATFORMS = ["x", "linkedin", "instagram", "instagram_business", "facebook"] as const;
export const THREAD_PART_LIMIT = 25;
export const FIRST_COMMENT_MAX_CHARS = 1_250;

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
  if (typeof record.firstComment === "string") {
    const comment = record.firstComment.trim();
    if (comment) options.firstComment = Array.from(comment).slice(0, FIRST_COMMENT_MAX_CHARS).join("");
  }
  return options;
}

/** The posts an X publication makes: the parts of a thread, or the one post. */
export function xPostTexts(body: string, options: SocialPostOptions): string[] {
  return options.thread ? threadParts(body) : [body.trim()];
}

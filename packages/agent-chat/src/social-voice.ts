/**
 * Own-voice rule for social drafts (me3-bli3.3.5): ME3 shapes the owner's words for each platform (trims, splits,
 * fits limits). It never writes a post from nothing, so every word in a draft must come from the owner's text.
 */

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function words(text: string): string[] {
  return (text.normalize("NFKC").toLowerCase().match(WORD) || []).map((word) => word.replace(/’/g, "'"));
}

/** Words in the draft that the owner never wrote. Empty means the draft keeps the owner's wording. */
export function wordsNotFromOwner(draft: string, ownerText: string): string[] {
  const own = new Set(words(ownerText));
  return [...new Set(words(draft).filter((word) => !own.has(word)))];
}

export function assertOwnerWords(draft: string, ownerText: string, label: string): void {
  const added = wordsNotFromOwner(draft, ownerText);
  if (added.length) {
    throw new Error(
      `${label} adds words the owner didn't write (${added.slice(0, 6).join(", ")}). Keep the owner's own words: trim or reorder them, don't add new ones.`,
    );
  }
}

/** Fits the owner's text to a limit without adding words: whole sentences first, then whole words with "…". */
export function fitOwnerText(text: string, limit: number): string {
  const trimmed = text.trim();
  if (Array.from(trimmed).length <= limit) return trimmed;
  const sentences = trimmed.match(/[^.!?\n]+[.!?]*\s*/g) || [trimmed];
  let kept = "";
  for (const sentence of sentences) {
    if (Array.from(kept + sentence).length > limit) break;
    kept += sentence;
  }
  if (kept.trim()) return kept.trim();
  const room = Array.from(trimmed).slice(0, Math.max(0, limit - 1)).join("");
  const cut = room.replace(/\s+\S*$/, "").trim();
  return `${cut || room.trim()}…`;
}

export const SOCIAL_TEXT_LIMITS: Record<string, number> = {
  x: 280,
  linkedin: 3_000,
  instagram: 2_200,
  instagram_business: 2_200,
  facebook: 63_206,
};

/** Nudge at most once a week, only when fewer than two posts are scheduled for the coming week. */
export function socialNudgeDue(input: {
  scheduledNext7Days: number;
  lastNudgeAt: string | null;
  nudgesOff: boolean;
  now?: Date;
}): { due: boolean; reason: string } {
  const now = input.now || new Date();
  if (input.nudgesOff) return { due: false, reason: "The owner switched social nudges off." };
  if (input.scheduledNext7Days >= 2) return { due: false, reason: "Enough is scheduled for the coming week." };
  const last = input.lastNudgeAt ? Date.parse(input.lastNudgeAt) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < 7 * 24 * 60 * 60 * 1000) {
    return { due: false, reason: "ME3 already nudged this week." };
  }
  return {
    due: true,
    reason: input.scheduledNext7Days === 0 ? "Nothing is scheduled for the coming week." : "Only one post is scheduled for the coming week.",
  };
}

// "Who do you follow?" in News setup on the web (me3-6ptk.10, .11): faces from The Human Soup's
// curated list, someone else by name or link, and a one-off import of YouTube subscriptions.
// Pure pieces live here so they can be tested; the views are NewsFollow.vue and NewsYouTubePick.vue.

export type NewsMedium = "read" | "listen" | "watch";
/** A voice the owner follows, as News settings keep it. */
export type NewsFollowPick = { id: string; name: string; medium: NewsMedium; feed: string; image: string | null };
/** One face in "Who do you follow?". */
export type NewsFollowCard = NewsFollowPick & { kind: string; url: string; note: string; following: boolean };
/** A channel from the owner's YouTube subscriptions, held only while they pick. */
export type NewsYouTubeChannel = { id: string; title: string; image: string | null };
export type NewsResolved = { query: string; ok: boolean; id?: string; name?: string; medium?: string; feed?: string; image?: string | null; reason?: string };

export const MAX_NEWS_FOLLOWS = 30;
export const NEWS_YOUTUBE_MESSAGE = "me3-news-youtube";
const RESOLVE_BATCH = 10;

const medium = (value: unknown): NewsMedium => value === "listen" || value === "watch" ? value : "read";
const text = (value: unknown) => typeof value === "string" ? value : "";
const https = (value: unknown) => typeof value === "string" && value.startsWith("https://") ? value : null;

export function readFollowCards(value: unknown): NewsFollowCard[] {
  const list = (value as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((row): NewsFollowCard[] => {
    const entry = (row || {}) as Record<string, unknown>;
    const id = text(entry.id), name = text(entry.name), feed = text(entry.feed);
    if (!id || !name || !feed) return [];
    return [{ id, name, medium: medium(entry.medium), feed, image: https(entry.image), kind: text(entry.kind) || "show", url: text(entry.url) || feed, note: text(entry.note), following: entry.following === true }];
  });
}

export function readFollowPicks(value: unknown): NewsFollowPick[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): NewsFollowPick[] => {
    const entry = (row || {}) as Record<string, unknown>;
    const id = text(entry.id), name = text(entry.name), feed = text(entry.feed);
    return id && name && feed ? [{ id, name, medium: medium(entry.medium), feed, image: https(entry.image) }] : [];
  }).slice(0, MAX_NEWS_FOLLOWS);
}

export const toPick = (card: NewsFollowPick): NewsFollowPick => ({ id: card.id, name: card.name, medium: card.medium, feed: card.feed, image: card.image });

/** A resolved source as a face, or null when Soup couldn't use it. */
export function cardFromResolved(found: NewsResolved, note: string, fallback?: { name?: string; image?: string | null }): NewsFollowCard | null {
  if (!found.ok || !found.id || !found.feed) return null;
  const name = found.name || fallback?.name;
  if (!name) return null;
  return { id: found.id, name, medium: medium(found.medium ?? "watch"), feed: found.feed, image: https(found.image) ?? fallback?.image ?? null, kind: "show", url: found.feed, note, following: true };
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
}

export type NewsYouTubeReturn = { handoff: string } | { error: string } | null;
/**
 * What the sign-in pop-up sent back, for this sign-in only. Anything from another origin, another
 * sign-in or in the wrong shape is ignored (null).
 */
export function readYouTubeReturn(data: unknown, origin: string, expectedOrigin: string, state: string): NewsYouTubeReturn {
  if (origin !== expectedOrigin || !data || typeof data !== "object") return null;
  const message = data as { type?: unknown; state?: unknown; handoff?: unknown; error?: unknown };
  if (message.type !== NEWS_YOUTUBE_MESSAGE) return null;
  if (typeof message.state !== "string" || !message.state || message.state !== state) return null;
  if (typeof message.handoff === "string" && /^nyh_[A-Za-z0-9_-]{8,100}$/.test(message.handoff)) return { handoff: message.handoff };
  return { error: typeof message.error === "string" && /^[a-z0-9_]{1,40}$/.test(message.error) ? message.error : "failed" };
}

export function youtubeMessage(code: string): string {
  if (code === "access_denied") return "";
  if (code === "youtube_no_subscriptions") return "No subscriptions on that YouTube account. Add channels by name above instead.";
  return "YouTube didn’t connect. Try again, or add channels by name above.";
}

/**
 * Soup finds and checks each picked channel, ten at a time; only the ones it can serve come back as
 * faces. A failed batch stops the rest and says how many were added.
 */
export async function resolveYouTubeChannels(
  picked: NewsYouTubeChannel[],
  resolve: (queries: string[]) => Promise<NewsResolved[]>,
): Promise<{ cards: NewsFollowCard[]; quiet: number; failed: boolean }> {
  const cards: NewsFollowCard[] = [];
  let quiet = 0;
  for (let start = 0; start < picked.length; start += RESOLVE_BATCH) {
    const batch = picked.slice(start, start + RESOLVE_BATCH);
    let results: NewsResolved[];
    try { results = await resolve(batch.map(channel => channel.id)); }
    catch { return { cards, quiet, failed: true }; }
    for (const found of results) {
      const channel = batch.find(entry => entry.id === found.query);
      const card = cardFromResolved(found, "From your YouTube", { name: channel?.title, image: channel?.image });
      if (card) cards.push(card); else quiet++;
    }
  }
  return { cards, quiet, failed: false };
}

export function youtubeAddedNote(added: number, quiet: number, failed: boolean): string {
  if (failed) return added > 0 ? `Added ${added}. The rest couldn’t be looked up just now.` : "Couldn’t look those up just now. Try again in a moment.";
  const addedText = added === 1 ? "Added 1 channel." : `Added ${added} channels.`;
  return quiet === 0 ? addedText : `${addedText} ${quiet} haven’t posted lately, so ME3 left them out.`;
}

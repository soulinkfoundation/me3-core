import type { NewsFollowPick } from "./news-follow";
// News on web (me3-6ptk.5): the shapes the worker sends for the owner's morning paper and its
// settings, and the small helpers the Home card, the reader and the setup chat share.
export const NEWS_SETTINGS_TOOL = "core_news_settings_update";
export const NEWS_SETTINGS_READ_TOOL = "core_news_settings_read";
export const NEWS_PAPER_TOOL = "core_news_paper";

export type NewsStory = {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  image?: string;
  publishedAt?: string;
  tag?: string;
  note?: string;
  action?: { label: string; prompt: string };
  medium: "read" | "watch" | "listen";
  minutes?: number;
  embedUrl?: string;
  /** A listen's own audio file, played in the paper. */
  audioUrl?: string;
  /** Trusted accounts that shared it on X. */
  sharedBy?: { count: number; handles: string[] };
  /** Which of the owner's feelings it serves. */
  feeling?: NewsFeelingId;
};
export type NewsFeelingId = "hopeful" | "motivated" | "know" | "connected";
/** The four feelings as the setup sheet names them. */
export const NEWS_FEELING_TAGS: Record<NewsFeelingId, { emoji: string; name: string }> = {
  hopeful: { emoji: "🌱", name: "Hopeful" },
  motivated: { emoji: "⚡", name: "Motivated" },
  know: { emoji: "📡", name: "In the know" },
  connected: { emoji: "🤝", name: "Connected" },
};
export function newsFeelingTag(story: Pick<NewsStory, "feeling">): string {
  const tag = story.feeling ? NEWS_FEELING_TAGS[story.feeling] : null;
  return tag ? `${tag.emoji} ${tag.name}` : "";
}
/** "What's in today's bowl": the paper's food label (me3-6ptk.16). Missing on older papers. */
export type NewsBowl = {
  sources: number; voices: number; fromVoices: number; base: NewsFeelingId[]; bigStories: boolean;
  sauce: string[]; fromSauce: number; stories: number; episodes: number; videos: number;
  feelings: Partial<Record<NewsFeelingId, number>>;
  skimmed: { fearOutrage: number; sponsored: number; aiFiller: number; total: number } | null;
};
export type NewsBowlLine = { label: string; value: string; strong?: boolean; quiet?: boolean };
/** The label's lines, top to bottom: the serving, the feelings, the sauce, and what was skimmed off. */
export function newsBowlLines(bowl: NewsBowl, minutes: number): NewsBowlLine[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const serving = [plural(bowl.stories, "story", "stories"), bowl.episodes ? plural(bowl.episodes, "episode", "episodes") : "", bowl.videos ? plural(bowl.videos, "video", "videos") : ""].filter(Boolean).join(" · ");
  const lines: NewsBowlLine[] = [{ label: serving, value: `about ${minutes} min`, strong: true }];
  for (const id of Object.keys(NEWS_FEELING_TAGS) as NewsFeelingId[]) {
    const count = bowl.feelings[id];
    if (count) lines.push({ label: `${NEWS_FEELING_TAGS[id].emoji} ${NEWS_FEELING_TAGS[id].name}`, value: String(count) });
  }
  if (bowl.fromSauce) lines.push({ label: "🧂 Your sauce", value: String(bowl.fromSauce) });
  if (bowl.fromVoices) lines.push({ label: "👋 From people you follow", value: String(bowl.fromVoices) });
  if (bowl.skimmed) {
    lines.push({ label: "Skimmed off: fear and outrage", value: String(bowl.skimmed.fearOutrage), quiet: true });
    lines.push({ label: "Skimmed off: AI filler and ads", value: String(bowl.skimmed.aiFiller + bowl.skimmed.sponsored), quiet: true });
  }
  return lines;
}
export type NewsWeather = { emoji: string; temp: string; text: string };
export type NewsPages = {
  front: { lead: NewsStory; briefs: NewsStory[] };
  work: { topics: string[]; stories: NewsStory[] } | null;
  /** `listens`: the Listen strip, new episodes from people the owner follows. */
  media: { video: NewsStory | null; listen: NewsStory | null; more?: NewsStory[]; listens?: NewsStory[] } | null;
  topics: { stories: NewsStory[] } | null;
  near: { city: string | null; weather: NewsWeather | null; local: NewsStory | null; good: NewsStory | null } | null;
};
export type NewsRating = "fire" | "ok" | "sleepy";
export type NewsPaper = {
  id: string;
  dateKey: string;
  time: string;
  deliverAt: string;
  readyAt: string;
  readAt: string | null;
  hiddenAt: string | null;
  rating: NewsRating | null;
  frontOnly: boolean;
  pages: NewsPages;
  counts: { pages: number; stories: number; videos: number; minutes: number; considered: number };
  bowl?: NewsBowl;
};
export type NewsToday = { setUp: boolean; paused: boolean; paper: NewsPaper | null; time: string; nextTime: string };
export type NewsTopicChip = { word: string; label: string; on: boolean };
export type NewsSettings = {
  setUp: boolean;
  paused: boolean;
  work: NewsTopicChip[];
  mine: NewsTopicChip[];
  lessOf: string[];
  city: string | null;
  country: string | null;
  time: string;
  weekendOffsetMinutes: number;
  notify: boolean;
  /** Voices the owner follows (me3-6ptk.10). Older installs leave it out. */
  follows?: NewsFollowPick[];
};
export type NewsPaperAction = "read" | "hide" | "unhide" | "rate";

export type NewsPageKind = "front" | "work" | "media" | "topics" | "near" | "end";
export const NEWS_PAGE_TITLES: Record<NewsPageKind, string> = { front: "Front page", work: "Your work", media: "Watch & listen", topics: "Your topics", near: "Near you", end: "The end" };

/** The pages this paper has, in reading order. A paper always ends with its last page. */
export function newsPageKinds(paper: Pick<NewsPaper, "pages">): NewsPageKind[] {
  const { pages } = paper;
  return ["front", ...(pages.work ? ["work" as const] : []), ...(pages.media ? ["media" as const] : []), ...(pages.topics ? ["topics" as const] : []), ...(pages.near ? ["near" as const] : []), "end"];
}

/** The paper's own day, from its date key, so it never shifts with the browser's timezone. */
export function newsDate(dateKey: string, style: "long" | "short", locale?: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: style, day: "numeric", month: style }).format(date).replace(/,/g, "");
}

/** "17:02" for a video, "12 min" for something to listen to. */
export function newsLength(story: Pick<NewsStory, "minutes" | "medium">): string {
  return story.minutes ? `${story.minutes} min` : "";
}

/** Only video players ME3 knows are embedded; anything else opens at the source. */
export function newsEmbedUrl(story: Pick<NewsStory, "embedUrl">): string | null {
  if (!story.embedUrl) return null;
  try {
    const url = new URL(story.embedUrl);
    if (url.protocol !== "https:" || !["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"].includes(url.hostname)) return null;
    if (url.hostname !== "player.vimeo.com") { url.hostname = "www.youtube-nocookie.com"; url.searchParams.set("autoplay", "1"); }
    return url.toString();
  } catch { return null; }
}

/** A soft paper tint for a story without a picture, steady for that story. */
const TINTS = ["#C9D6DE", "#CBD3E6", "#E3D3B8", "#BFD9DA", "#E2D9C7", "#D8CFE3", "#E6CFC4", "#D9E2CF", "#CFE0C8"];
export function newsTint(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export const NEWS_TIME_CHOICES = ["06:30", "06:45", "07:00", "07:30", "08:00"];

/** What a news tool result asks the chat to draw under the reply. */
export type NewsChatCard = { kind: "topics" | "time" | "ready" | "paper"; time: string; considered: number; stories: number; pages: number };
export function newsChatCardFromTool(data: unknown): NewsChatCard | null {
  const row = data && typeof data === "object" ? data as { card?: unknown; time?: unknown; paper?: { counts?: NewsPaper["counts"] } | null; counts?: NewsPaper["counts"] } : null;
  if (!row || !["topics", "time", "ready", "paper"].includes(String(row.card))) return null;
  const counts = row.paper?.counts || row.counts;
  if (row.card === "ready" && !counts) return null;
  return { kind: row.card as NewsChatCard["kind"], time: typeof row.time === "string" ? row.time : "", considered: counts?.considered || 0, stories: (counts?.stories || 0) + (counts?.videos || 0), pages: counts?.pages || 0 };
}

/** "Shared on X by @rtenews and 3 others", or null when no trusted account shared the story. */
export function newsSharedLine(story: Pick<NewsStory, "sharedBy">): string | null {
  const shared = story.sharedBy;
  if (!shared || shared.count < 1) return null;
  const first = shared.handles[0];
  if (!first) return `Shared on X by ${shared.count} ${shared.count === 1 ? "account" : "accounts"} you trust`;
  const others = shared.count - 1;
  return `Shared on X by @${first}${others > 0 ? ` and ${others} ${others === 1 ? "other" : "others"}` : ""}`;
}

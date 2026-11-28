import { describe, expect, it, vi } from "vitest";
import { NEWS_YOUTUBE_MESSAGE, cardFromResolved, readFollowCards, readFollowPicks, readYouTubeReturn, resolveYouTubeChannels, youtubeAddedNote, youtubeMessage } from "./news-follow";

// Failure modes: a pop-up from another site or another sign-in handing in a channel list, a broken
// face from a bad row, a channel Soup can't serve being followed, and a failed lookup losing the
// channels already added.
const ORIGIN = "https://core.example";
const STATE = "s".repeat(32);

describe("the YouTube sign-in's answer", () => {
  it("takes only this sign-in's handoff from this origin", () => {
    const message = { type: NEWS_YOUTUBE_MESSAGE, state: STATE, handoff: "nyh_abc12345" };
    expect(readYouTubeReturn(message, ORIGIN, ORIGIN, STATE)).toEqual({ handoff: "nyh_abc12345" });
    expect(readYouTubeReturn(message, "https://evil.example", ORIGIN, STATE)).toBeNull();
    expect(readYouTubeReturn(message, ORIGIN, ORIGIN, "t".repeat(32))).toBeNull();
    expect(readYouTubeReturn({ ...message, type: "other" }, ORIGIN, ORIGIN, STATE)).toBeNull();
    expect(readYouTubeReturn({ ...message, state: "" }, ORIGIN, ORIGIN, "")).toBeNull();
  });

  it("turns anything else into a short error, and says nothing when the owner said no", () => {
    expect(readYouTubeReturn({ type: NEWS_YOUTUBE_MESSAGE, state: STATE, handoff: "javascript:x" }, ORIGIN, ORIGIN, STATE)).toEqual({ error: "failed" });
    expect(readYouTubeReturn({ type: NEWS_YOUTUBE_MESSAGE, state: STATE, error: "access_denied" }, ORIGIN, ORIGIN, STATE)).toEqual({ error: "access_denied" });
    expect(youtubeMessage("access_denied")).toBe("");
    expect(youtubeMessage("youtube_no_subscriptions")).toMatch(/No subscriptions/);
    expect(youtubeMessage("failed")).toMatch(/didn’t connect/);
  });
});

describe("faces", () => {
  it("keeps only rows with an id, a name and a feed, and only https pictures", () => {
    const cards = readFollowCards({ suggestions: [
      { id: "src-1", name: "Tara Brach", medium: "listen", feed: "https://feed.example/tara", image: "http://insecure.example/a.jpg", note: "Calm", following: true },
      { id: "", name: "No id", feed: "https://x.example" },
      "junk",
    ] });
    expect(cards).toEqual([{ id: "src-1", name: "Tara Brach", medium: "listen", feed: "https://feed.example/tara", image: null, kind: "show", url: "https://feed.example/tara", note: "Calm", following: true }]);
    expect(readFollowCards(null)).toEqual([]);
    expect(readFollowPicks([{ id: "a", name: "A", medium: "odd", feed: "https://a.example" }, { id: "b" }])).toEqual([{ id: "a", name: "A", medium: "read", feed: "https://a.example", image: null }]);
  });

  it("makes a face only from a source Soup can serve", () => {
    expect(cardFromResolved({ query: "x", ok: false, reason: "No posts" }, "Added by you")).toBeNull();
    expect(cardFromResolved({ query: "UC1", ok: true, id: "src-2", feed: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1" }, "From your YouTube", { name: "Fireship", image: "https://yt3.example/f.jpg" }))
      .toMatchObject({ id: "src-2", name: "Fireship", medium: "watch", image: "https://yt3.example/f.jpg" });
  });
});

describe("adding YouTube channels", () => {
  const channel = (n: number) => ({ id: `UC${n}`, title: `Channel ${n}`, image: null });
  const ok = (query: string) => ({ query, ok: true, id: `src-${query}`, feed: `https://www.youtube.com/feeds/videos.xml?channel_id=${query}`, name: query });

  it("looks them up ten at a time and leaves out quiet ones", async () => {
    const resolve = vi.fn(async (queries: string[]) => queries.map(query => query === "UC3" ? { query, ok: false } : ok(query)));
    const result = await resolveYouTubeChannels(Array.from({ length: 23 }, (_, n) => channel(n)), resolve);
    expect(resolve.mock.calls.map(([queries]) => queries.length)).toEqual([10, 10, 3]);
    expect(result).toMatchObject({ quiet: 1, failed: false });
    expect(result.cards).toHaveLength(22);
    expect(youtubeAddedNote(22, 1, false)).toBe("Added 22 channels. 1 haven’t posted lately, so ME3 left them out.");
    expect(youtubeAddedNote(1, 0, false)).toBe("Added 1 channel.");
  });

  it("keeps what was added when a later lookup fails", async () => {
    let calls = 0;
    const resolve = async (queries: string[]) => { if (calls++) throw new Error("down"); return queries.map(ok); };
    const result = await resolveYouTubeChannels(Array.from({ length: 15 }, (_, n) => channel(n)), resolve);
    expect(result).toMatchObject({ failed: true });
    expect(result.cards).toHaveLength(10);
    expect(youtubeAddedNote(10, 0, true)).toBe("Added 10. The rest couldn’t be looked up just now.");
  });
});

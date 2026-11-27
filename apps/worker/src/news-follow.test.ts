import { describe, expect, it } from "vitest";
import { applyNewsPatch, describeNewsSettings } from "./news-settings";
import { newsFollowTopics } from "./news-follow";
import { newsTodayQuery, readNewsToday, readResolvedSources, readSoupFollow, soupFollowQuery } from "./soup-client";
import { FOLLOWED_LANE, toNewsCandidates } from "./news-paper";
import { emptySoupTaste, readNewsPrefs } from "./soup-taste";

describe("who to follow", () => {
  it("asks Soup with topic words, feelings and a country only", () => {
    const params = soupFollowQuery({ topics: ["Coaching", "AI agents", ""], feelings: ["hopeful", "know", "connected"], country: "IE", limit: 50 });
    expect(Object.fromEntries(params)).toEqual({ topics: "coaching,ai agents", feelings: "hopeful,know", country: "IE", limit: "30" });
  });

  it("keeps only usable voices from Soup", () => {
    const list = readSoupFollow({ suggestions: [
      { id: "tara-brach", name: "Tara Brach", kind: "person", medium: "listen", image: "https://img/tara.jpg", feed: "https://feeds/tara", url: "https://tarabrach.com", category: "spirituality", note: "Meditation teacher", matched: ["meditation"] },
      { id: "no-feed", name: "No feed", medium: "read" },
      { id: "plain-image", name: "Plain", medium: "watch", feed: "https://yt/plain", image: "http://insecure" },
    ] });
    expect(list.map(entry => entry.id)).toEqual(["tara-brach", "plain-image"]);
    expect(list[1]).toMatchObject({ image: null, url: "https://yt/plain", kind: "show" });
  });

  it("sends topics without the owner's own project names", () => {
    expect(newsFollowTopics(["soulink", "coaching"], ["surfing", "coaching"], new Set(["soulink"]))).toEqual(["coaching", "surfing"]);
  });

  it("saves the voices the owner picks", () => {
    const context = { projectIds: new Set<string>(), defaultTime: "07:30" };
    const taste = applyNewsPatch(emptySoupTaste(), { follows: [
      { id: "tara-brach", name: "Tara Brach", medium: "listen", feed: "https://feeds/tara", image: "https://img/tara.jpg" },
      { id: "tara-brach", name: "Twice", medium: "listen", feed: "https://feeds/tara" },
      { id: "Bad id!", name: "Bad", medium: "read", feed: "https://x" },
    ] }, context);
    expect(taste.news?.follows).toEqual([{ id: "tara-brach", name: "Tara Brach", medium: "listen", feed: "https://feeds/tara", image: "https://img/tara.jpg" }]);
    expect(describeNewsSettings({ taste, setUp: false, setUpAt: null, projects: [] }).follows).toHaveLength(1);
    expect(readNewsPrefs({})?.follows).toEqual([]);
  });
});

describe("follows in the paper", () => {
  const story = (id: string, medium: "read" | "listen" | "watch", headline = id) => ({ id, headline, summary: "", url: `https://example.com/${id}`, sources: [{ name: "Voice", url: "https://example.com" }], topics: [], medium });

  it("sends feelings, big stories and follow ids, and nothing else new", () => {
    const params = newsTodayQuery({ topics: ["coaching"], country: "IE", base: ["hopeful", "nonsense", "know"], bigStories: false, follows: ["tara-brach", "https://bad.example"] });
    expect(params.get("base")).toBe("hopeful,know");
    expect(params.get("bigStories")).toBe("0");
    expect(params.get("follows")).toBe("tara-brach");
    expect(newsTodayQuery({ topics: [], bigStories: true }).has("bigStories")).toBe(false);
  });

  it("reads followed and puts it first: reading in its own lane, episodes and videos at the front of media", () => {
    const news = readNewsToday({ frontPage: [], byTopic: [{ topic: "surfing", stories: [story("s1", "read")] }], local: [], media: [story("m1", "watch"), story("f2", "listen")], followed: [story("f1", "read"), story("f2", "listen")], meta: {} });
    const candidates = toNewsCandidates(news, { workTopics: [], interests: ["surfing"], lessOf: [] });
    expect(candidates.mine.map(lane => [lane.topic, lane.stories.map(s => s.id)])).toEqual([[FOLLOWED_LANE, ["f1"]], ["surfing", ["s1"]]]);
    expect(candidates.media.map(s => s.id)).toEqual(["f2", "m1"]);
    expect(readNewsToday({}).followed).toEqual([]);
  });
});

describe("naming your own sources", () => {
  it("keeps only usable answers from Soup, with a reason for the rest", () => {
    const results = readResolvedSources({ results: [
      { query: "The Rest Is History", ok: true, id: "src-1a2b3c4d5e6f", name: "The Rest Is History", medium: "listen", feed: "https://feeds/rih", image: "https://img/rih.jpg" },
      { query: "Old blog", ok: false, reason: "Old blog hasn't published since 2024-01-02." },
      { query: "Odd", ok: true, id: "Bad Id", name: "Odd", medium: "read" },
      { ok: true },
    ] });
    expect(results).toEqual([
      { query: "The Rest Is History", ok: true, id: "src-1a2b3c4d5e6f", name: "The Rest Is History", medium: "listen", feed: "https://feeds/rih", image: "https://img/rih.jpg" },
      { query: "Old blog", ok: false, reason: "Old blog hasn't published since 2024-01-02." },
      { query: "Odd", ok: false, reason: "Couldn't find that one." },
    ]);
  });
});

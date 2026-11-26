import { describe, expect, it } from "vitest";
import { applyNewsPatch, describeNewsSettings } from "./news-settings";
import { newsFollowTopics } from "./news-follow";
import { readSoupFollow, soupFollowQuery } from "./soup-client";
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

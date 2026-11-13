import { describe, expect, it } from "vitest";
import { newsPatchFromAgent } from "./agent-soup";
import { clockTime, countPaper, layoutPaper, newsBuildDue, newsDueMinutes, newsFromSearch, readPaperPicks, sameEvent, shouldBuildPaper, toNewsCandidates, writeNewsPicks } from "./news-paper";
import { applyNewsPatch, defaultNewsPrefs, describeNewsSettings, newsIsSetUp } from "./news-settings";
import { cityFromTimezone, cleanCityName, describeWeather, geocodeCity } from "./news-weather";
import { SoupUnavailableError, newsTodayQuery, readNewsToday, type SoupClient } from "./soup-client";
import { emptySoupTaste, snapNewsTime, type SoupTaste } from "./soup-taste";
import { NEWS_FIXTURE_COACH, NEWS_FIXTURE_FOUNDER, newsFixtureFor } from "./testing/news-today.fixture";
import type { AgentModel } from "../../../packages/agent/src/types";

// Failure modes: a paper built twice or outside its window, a failed build that is never retried,
// a model that fails leaving the owner with nothing, a pick for a story Soup never offered, the
// same event printed twice from two outlets, a note that leaks the Wheel of Life or runs long,
// and anything but topic words and a region reaching Soup.

const founderTaste = (): SoupTaste => ({
  ...emptySoupTaste(),
  workTopics: ["ai agents", "cloudflare", "online payments", "running a small business"].map(topic => ({ topic, projectId: null, source: "owner" as const })),
  interests: ["surfing", "poetry"],
  news: { ...defaultNewsPrefs("06:45"), city: "Dublin", country: "IE", lat: 53.35, lon: -6.26, labels: { "ai agents": "AI agents" }, setUpAt: "2026-11-12T20:00:00.000Z" },
});
const coachTaste = (): SoupTaste => ({
  ...emptySoupTaste(),
  workTopics: ["coaching", "wellbeing", "instagram marketing", "running a small business"].map(topic => ({ topic, projectId: null, source: "owner" as const })),
  interests: ["yoga", "gardening"],
  news: { ...defaultNewsPrefs("06:30"), city: "Galway", country: "IE", lat: 53.27, lon: -9.05, setUpAt: "2026-11-12T20:00:00.000Z" },
});
const extras = { labels: { "ai agents": "AI agents" }, city: "Dublin", weather: { emoji: "🌥️", temp: "11°", text: "Cloudy" }, good: null };

describe("news build window", () => {
  const prefs = founderTaste().news!;
  it("is an hour later at the weekend", () => {
    expect(clockTime(newsDueMinutes(prefs, 5))).toBe("06:45");
    expect(clockTime(newsDueMinutes(prefs, 6))).toBe("07:45");
    expect(clockTime(newsDueMinutes(prefs, 0))).toBe("07:45");
    expect(clockTime(newsDueMinutes({ time: "23:30", weekendOffsetMinutes: 60 }, 6))).toBe("23:45");
  });
  it("opens thirty minutes before the owner's time and closes after the catch-up", () => {
    const at = (time: string, weekday = 5) => { const [h, m] = time.split(":").map(Number); return newsBuildDue(prefs, { minutes: h * 60 + m, weekday }); };
    expect(at("06:00")).toBe(false);
    expect(at("06:15")).toBe(true);
    expect(at("06:45")).toBe(true);
    expect(at("09:30")).toBe(true);
    expect(at("09:45")).toBe(false);
    expect(at("06:15", 6)).toBe(false);
    expect(at("07:15", 6)).toBe(true);
  });
  it("never builds while paused or before setup", () => {
    expect(newsBuildDue({ ...prefs, paused: true }, { minutes: 6 * 60 + 30, weekday: 5 })).toBe(false);
    expect(newsBuildDue({ ...prefs, setUpAt: null }, { minutes: 6 * 60 + 30, weekday: 5 })).toBe(false);
  });
  it("builds once, retries a failure and takes over a stale claim", () => {
    const now = Date.UTC(2026, 10, 13, 6, 30);
    expect(shouldBuildPaper(null, now)).toBe(true);
    expect(shouldBuildPaper({ status: "ready", claimed_at: now - 900_000 }, now)).toBe(false);
    expect(shouldBuildPaper({ status: "failed", claimed_at: now - 900_000 }, now)).toBe(true);
    expect(shouldBuildPaper({ status: "pending", claimed_at: now - 60_000 }, now)).toBe(false);
    expect(shouldBuildPaper({ status: "pending", claimed_at: now - 900_000 }, now)).toBe(true);
  });
});

describe("news layout", () => {
  it("lays out six pages for the founder and the coach from the contract fixture", () => {
    for (const [fixture, taste, workLead, local] of [
      [NEWS_FIXTURE_FOUNDER, founderTaste(), "EU agrees first rules for AI agents that spend money for people", "Luas Green line closed this weekend for works"],
      [NEWS_FIXTURE_COACH, coachTaste(), "ICF asks coaches to get consent before using AI note-takers", "Galway Christmas market opens next Friday in Eyre Square"],
    ] as const) {
      const candidates = toNewsCandidates(fixture, taste);
      const result = layoutPaper(candidates, {}, extras)!;
      expect(result.frontOnly).toBe(false);
      expect(result.pages.front.lead.headline).toMatch(/^Storm Bram/);
      expect(result.pages.front.briefs).toHaveLength(2);
      expect(result.pages.work!.stories).toHaveLength(3);
      expect(result.pages.work!.stories[0].headline).toBe(workLead);
      expect(result.pages.media!.video!.medium).toBe("watch");
      expect(result.pages.media!.listen!.medium).toBe("listen");
      expect(result.pages.topics!.stories).toHaveLength(2);
      expect(new Set(result.pages.topics!.stories.map(story => story.tag)).size).toBe(2);
      expect(result.pages.near!.local!.headline).toBe(local);
      expect(countPaper(result.pages, fixture.meta.considered)).toMatchObject({ pages: 6, stories: 9, videos: 1 });
    }
  });

  it("still delivers a front page when the picks fail", () => {
    const result = layoutPaper(toNewsCandidates(NEWS_FIXTURE_FOUNDER, founderTaste()), null, extras)!;
    expect(result.frontOnly).toBe(true);
    expect(result.pages.front.briefs).toHaveLength(2);
    expect(result.pages).toMatchObject({ work: null, media: null, topics: null, near: null });
    expect(countPaper(result.pages, 214)).toMatchObject({ pages: 2, stories: 3, videos: 0 });
  });

  it("has nothing to print when Soup offered nothing", () => {
    expect(layoutPaper({ front: [], work: [], mine: [], local: [], media: [], considered: 0 }, null, extras)).toBeNull();
  });

  it("never prints the same event twice, even when the model picks both outlets", () => {
    const candidates = toNewsCandidates(NEWS_FIXTURE_FOUNDER, founderTaste());
    const [storm, , , stormAgain] = candidates.front;
    expect(sameEvent(storm.headline, stormAgain.headline)).toBe(true);
    expect(sameEvent(storm.headline, candidates.front[1].headline)).toBe(false);
    const result = layoutPaper(candidates, { lead: { id: storm.id }, briefs: [stormAgain.id, storm.id] }, extras)!;
    const front = [result.pages.front.lead, ...result.pages.front.briefs].map(story => story.headline);
    expect(front.filter(headline => /Storm Bram/.test(headline))).toHaveLength(1);
    expect(front).toHaveLength(3);
  });

  it("keeps the model's notes and actions only on the stories it picked", () => {
    const candidates = toNewsCandidates(NEWS_FIXTURE_FOUNDER, founderTaste());
    const eu = candidates.work[0].stories[0];
    const result = layoutPaper(candidates, { lead: { id: candidates.front[0].id, note: "You're in Galway on Sunday." }, work: [{ id: eu.id, note: "Touches ME3 payments.", action: { label: "Add a task", prompt: "Add a task: spending limits for agent payments" } }] }, extras)!;
    expect(result.pages.front.lead.note).toBe("You're in Galway on Sunday.");
    expect(result.pages.work!.stories[0]).toMatchObject({ id: eu.id, note: "Touches ME3 payments.", action: { label: "Add a task" } });
    expect(result.pages.work!.stories.slice(1).every(story => !story.note && !story.action)).toBe(true);
    expect(result.pages.topics!.stories.map(story => story.tag)).toEqual(["Surfing", "Poetry"]);
  });

  it("drops what the owner wants less of", () => {
    const candidates = toNewsCandidates(NEWS_FIXTURE_FOUNDER, { ...founderTaste(), lessOf: ["storm"] });
    expect(candidates.front.some(story => /storm/i.test(story.headline))).toBe(false);
  });

  it("makes a paper from search headlines where Soup has no news API, leading with work", async () => {
    const item = (id: string, title: string, kind: "article" | "video" = "article") => ({ item: { id, kind, url: `https://example.com/${id}`, title, creator: { name: "Source" } }, card: { summary: "s", why: "", format: "news", topics: [] }, reason: { kind: "match", text: "" }, soup: { handle: "h", title: "H" } });
    const client = { find: async (request: { q?: string }) => ({ items: request.q === "ai agents" ? [item("a", "Agents get wallets"), item("v", "A talk", "video")] : [item("a", "Agents get wallets"), item("b", "Poems for winter")], fallback: false, contractVersion: null }) } as unknown as SoupClient;
    const news = await newsFromSearch(client, ["ai agents", "poetry"], { exclude: [], since: "2026-11-12T00:00:00.000Z" });
    expect(news.frontPage).toEqual([]);
    expect(news.byTopic.map(entry => entry.stories.map(story => story.id))).toEqual([["a"], ["b"]]);
    expect(news.media.map(story => story.id)).toEqual(["v"]);
    const taste = { ...emptySoupTaste(), workTopics: [{ topic: "ai agents", projectId: null, source: "owner" as const }], interests: ["poetry"] };
    const result = layoutPaper(toNewsCandidates(news, taste), null, extras)!;
    expect(result.pages.front.lead.headline).toBe("Agents get wallets");
    const failing = { find: async () => { throw new SoupUnavailableError("down", 503); } } as unknown as SoupClient;
    await expect(newsFromSearch(failing, ["ai agents"], { exclude: [], since: "2026-11-12T00:00:00.000Z" })).rejects.toThrow("down");
  });
});

describe("news picks", () => {
  const ids = ["a", "b", "c"];
  it("keeps only real ids, short plain notes and short actions", () => {
    const picks = readPaperPicks({
      lead: { id: "a", note: "ME3 · You're in Galway on Sunday." },
      briefs: ["b", "nope", "c", "a"],
      work: [{ id: "b", note: "x".repeat(141), actionLabel: "Add a task", actionPrompt: "Add a task: check limits" }, { id: "c", note: "Your Wheel of Life says work is low." }, { id: "zzz" }],
      video: { id: "nope" }, listen: { id: "c" }, topics: "none", local: { id: "a" },
    }, ids)!;
    expect(picks.lead).toEqual({ id: "a", note: "You're in Galway on Sunday." });
    expect(picks.briefs).toEqual(["b", "c"]);
    expect(picks.work).toEqual([{ id: "b", action: { label: "Add a task", prompt: "Add a task: check limits" } }, { id: "c" }]);
    expect(picks.video).toBeUndefined();
    expect(picks.listen).toEqual({ id: "c" });
    expect(picks.topics).toEqual([]);
    expect(readPaperPicks({ lead: { id: "nope" } }, ids)).toBeNull();
    expect(readPaperPicks("nope", ids)).toBeNull();
  });

  it("forces the layout tool and gives the model the week and the snapshot, which never go to Soup", async () => {
    let seen: Parameters<AgentModel["step"]>[0] | null = null;
    const candidates = toNewsCandidates(NEWS_FIXTURE_FOUNDER, founderTaste());
    const model = { id: "fast", async step(step) { seen = step; return { text: "", toolCalls: [{ id: "1", name: "core_news_layout", arguments: { lead: { id: candidates.front[0].id } } }] }; } } as AgentModel;
    const picks = await writeNewsPicks(model, { candidates, taste: founderTaste(), ownerSnapshot: "Mission: ship ME3 payments", week: { calendar: ["2026-11-15T10:00 Galway trip"], tasks: ["Stripe Link wallets"] }, date: "2026-11-13", city: "Dublin", lastRating: "sleepy" }, AbortSignal.timeout(1000));
    expect(picks?.lead?.id).toBe(candidates.front[0].id);
    expect(seen!.toolChoice).toBe("core_news_layout");
    const sent = JSON.parse(String(seen!.messages[1].content));
    expect(sent.comingWeek.calendar).toEqual(["2026-11-15T10:00 Galway trip"]);
    expect(sent.yesterday).toMatch(/dull/);
    expect(sent.candidates.media[0]).toMatchObject({ medium: "watch", minutes: 17 });
  });
});

describe("what reaches Soup for news", () => {
  it("sends topic words, a country, a city and shown story ids only", () => {
    const params = newsTodayQuery({ topics: ["AI agents", "kieran@example.com", "https://x.test", "Poetry"], country: "ie", city: "Galway", since: "2026-11-12T00:00:00Z", exclude: ["news:a", "bad id"] });
    expect(Object.fromEntries(params)).toEqual({ topics: "ai agents,poetry", country: "IE", city: "Galway", since: "2026-11-12T00:00:00.000Z", exclude: "news:a", agent: "me3", scheduled: "1" });
    expect(() => newsTodayQuery({ topics: [], ownerName: "Kieran" } as never)).toThrow(/never carry ownerName/);
    expect(newsTodayQuery({ topics: ["x"], city: "12 Main St" }).has("city")).toBe(false);
  });

  it("reads a response defensively and keeps summaries short", () => {
    const news = readNewsToday({ frontPage: [{ id: "1", headline: " Hi ", url: "https://a.test/1", summary: "x".repeat(900), image: { url: "http://insecure.test/a.jpg" }, sources: [{ name: "A", url: "https://a.test" }, { name: 1 }], medium: "odd" }, { id: "2", headline: "No link", url: "javascript:alert(1)" }, null], byTopic: [{ topic: "AI Agents", stories: [] }, "bad"], meta: { considered: "many" } });
    expect(news.frontPage).toHaveLength(1);
    expect(news.frontPage[0]).toMatchObject({ headline: "Hi", medium: "read", sources: [{ name: "A", url: "https://a.test" }] });
    expect(news.frontPage[0].summary).toHaveLength(500);
    expect(news.frontPage[0].image).toBeUndefined();
    expect(news.byTopic).toEqual([{ topic: "ai agents", stories: [] }]);
    expect(news.meta).toEqual({ considered: 0, grouped: false });
    expect(newsFixtureFor({ city: "Galway" }).local[0].headline).toMatch(/Galway/);
  });
});

describe("news settings", () => {
  const context = { projectIds: new Set(["p1"]), defaultTime: "07:30", now: new Date("2026-11-13T08:00:00Z") };
  it("keeps labels for the chips and sends lower-case words", () => {
    const taste = applyNewsPatch(emptySoupTaste(), { work: [{ label: "AI agents", on: true, projectId: "p1" }, { label: "Cloudflare", on: true, projectId: "gone" }, { label: "Marketing", on: false }], mine: ["Surfing", { label: "Irish history", on: false }] }, context);
    expect(taste.workTopics).toEqual([{ topic: "ai agents", projectId: "p1", source: "project" }, { topic: "cloudflare", projectId: null, source: "owner" }]);
    expect(taste.interests).toEqual(["surfing"]);
    expect(taste.news).toMatchObject({ time: "07:30", moreWork: ["marketing"], moreMine: ["irish history"], setUpAt: null });
    const settings = describeNewsSettings({ taste, setUp: false, setUpAt: null, projects: [] });
    expect(settings.setUp).toBe(false);
    expect(settings.work).toEqual([{ word: "ai agents", label: "AI agents", on: true }, { word: "cloudflare", label: "Cloudflare", on: true }, { word: "marketing", label: "Marketing", on: false }]);
    expect(settings.mine.map(chip => chip.label)).toEqual(["Surfing", "Irish history"]);
  });

  it("is set up only once confirmed with at least one topic, and snaps the time to a quarter hour", () => {
    expect(() => applyNewsPatch(emptySoupTaste(), { setUp: true }, context)).toThrow(/at least one topic/);
    const taste = applyNewsPatch(emptySoupTaste(), { mine: ["Yoga"], time: "06:40", setUp: true }, { ...context, place: { city: "Galway", country: "IE", lat: 53.27, lon: -9.05 } });
    expect(taste.news).toMatchObject({ time: "06:45", city: "Galway", country: "IE", setUpAt: "2026-11-13T08:00:00.000Z", paused: false });
    expect(newsIsSetUp({ taste })).toBe(true);
    // A Soup setup from before News is not a News setup.
    expect(newsIsSetUp({ taste: emptySoupTaste() })).toBe(false);
    expect(snapNewsTime("23:59")).toBe("23:45");
    expect(snapNewsTime("7am")).toBeNull();
    expect(() => applyNewsPatch(taste, { time: "soon" }, context)).toThrow(/06:45/);
  });

  it("keeps a city the lookup did not know and drops the old coordinates", () => {
    const taste = applyNewsPatch(founderTaste(), {}, { ...context, city: "Inis Meáin" });
    expect(taste.news).toMatchObject({ city: "Inis Meáin", country: "IE", lat: null, lon: null });
  });

  it("turns the agent's plain lines into chips and keeps suggestions it did not mention", () => {
    const current = describeNewsSettings({ taste: applyNewsPatch(emptySoupTaste(), { mine: ["Surfing", { label: "Music", on: false }] }, context), setUp: false, setUpAt: null, projects: [] });
    const patch = newsPatchFromAgent({ workTopics: ["AI agents @ ME3"], interests: ["Surfing", "Poetry"], city: "Dublin", time: "06:45", setUp: true, headsUp: true }, current, new Map([["p1", "ME3"]]));
    expect(patch).toEqual({ work: [{ label: "AI agents", on: true, projectId: "p1" }], mine: [{ label: "Surfing", on: true }, { label: "Poetry", on: true }, { label: "Music", on: false }], city: "Dublin", time: "06:45", setUp: true });
  });
});

describe("news place and weather", () => {
  it("takes a place name only", () => {
    expect(cleanCityName("Galway, Ireland")).toBe("Galway");
    expect(cleanCityName("12 Shop Street")).toBeNull();
    expect(cleanCityName("me@example.com")).toBeNull();
    expect(cityFromTimezone("Europe/Dublin")).toBe("Dublin");
    expect(cityFromTimezone("America/New_York")).toBe("New York");
    expect(cityFromTimezone("UTC")).toBeNull();
  });
  it("looks a city up with nothing but its name, and survives a failed lookup", async () => {
    let url = "";
    const place = await geocodeCity("Galway", { fetch: async input => { url = input; return Response.json({ results: [{ name: "Galway", latitude: 53.2719, longitude: -9.0489, country_code: "ie" }] }); } });
    expect(place).toEqual({ city: "Galway", country: "IE", lat: 53.27, lon: -9.05 });
    expect(new URL(url).searchParams.get("name")).toBe("Galway");
    expect([...new URL(url).searchParams.keys()].sort()).toEqual(["count", "format", "language", "name"]);
    expect(await geocodeCity("Galway", { fetch: async () => { throw new Error("offline"); } })).toBeNull();
  });
  it("says the weather the way a person would", () => {
    expect(describeWeather({ code: 3, temp: 10.6, windMax: 55, tomorrowCode: 61 })).toEqual({ emoji: "🌥️", temp: "11°", text: "Cloudy, strong wind, rain tomorrow" });
    expect(describeWeather({ code: 999, temp: 4 }).text).toBe("Cloudy");
  });
});

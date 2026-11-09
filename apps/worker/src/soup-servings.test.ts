import { describe, expect, it } from "vitest";
import { parseServingLine, parseWorkTopicLine, tastePatchFromAgent } from "./agent-soup";
import { withSoupLine } from "./morning-calendar-push";
import { dueServings, readSoupPicks, servingQueries, soupBriefingLine, specForServing, writeSoupPicks } from "./soup-servings";
import { emptySoupTaste, fadeWorkTopics, readServingSpecs } from "./soup-taste";
import type { AgentModel } from "../../../packages/agent/src/types";

// Failure modes: a pick that names an item Soup never offered, a for-you line that leaks the
// Wheel of Life or runs long, a serving composed twice in one day or outside its window,
// project text or names reaching a Soup query, and a 🍲 line that pushes the briefing past
// its push budget.
describe("soup picks", () => {
  it("keeps only picks for real candidates with short, plain for-you lines", () => {
    expect(readSoupPicks([
      { itemId: "yt:a", forYou: "Unblocks the Link wallet step in ME3 payments." },
      { itemId: "yt:a", forYou: "Duplicate." },
      { itemId: "yt:nope", forYou: "Not a candidate." },
      { itemId: "yt:b", forYou: "Your Wheel of Life says health is low." },
      { itemId: "yt:c", forYou: "x".repeat(121) },
      { itemId: "yt:d", forYou: "  You asked for more poetry this month.  " },
    ], ["yt:a", "yt:b", "yt:c", "yt:d"], 3)).toEqual([
      { itemId: "yt:a", forYou: "Unblocks the Link wallet step in ME3 payments." },
      { itemId: "yt:d", forYou: "You asked for more poetry this month." },
    ]);
    expect(readSoupPicks("nope", ["yt:a"], 3)).toEqual([]);
  });

  it("forces the picks tool and sends taste words, candidates and the snapshot", async () => {
    let seen: Parameters<AgentModel["step"]>[0] | undefined;
    const model = { id: "fast", async step(step) { seen = step; return { text: "", toolCalls: [{ id: "1", name: "core_soup_picks", arguments: { picks: [{ itemId: "yt:a", forYou: "Fits the Soup launch page you are writing." }] } }] }; } } as AgentModel;
    const taste = { ...emptySoupTaste(), workTopics: [{ topic: "agent payments", projectId: "p1", source: "project" as const }], interests: ["poetry"] };
    const candidate = { id: "yt:a", soup: "hackertube", soupTitle: "HackerTube", title: "Working backwards", url: "https://youtu.be/a", creator: "AWS", kind: "video" as const, medium: "listen" as const, minutes: 17, summary: "PR-FAQ first.", why: "HN loves it.", forYou: null, state: "served" as const };
    const picks = await writeSoupPicks(model, { candidates: [candidate], taste, ownerSnapshot: "Mission: ship ME3 payments", count: 1, occasion: "a 20-minute walk" }, new AbortController().signal);
    expect(picks).toEqual([{ itemId: "yt:a", forYou: "Fits the Soup launch page you are writing." }]);
    expect(seen?.toolChoice).toBe("core_soup_picks");
    expect(String(seen?.messages[1].content)).toContain("ship ME3 payments");
  });
});

describe("soup queries", () => {
  const taste = { ...emptySoupTaste(), workTopics: [{ topic: "agent payments", projectId: "p1", source: "project" as const }, { topic: "cloudflare workers", projectId: null, source: "mission" as const }], interests: ["poetry", "surfing"], lessOf: ["crypto"], soups: ["soul-soup"] };

  it("sends topic words, filters and served ids only", () => {
    const queries = servingQueries("headlines", taste, { exclude: ["yt:old"], since: "2026-11-02T00:00:00Z" });
    // One ranked search per topic: Soup's topics filter wants the exact phrase on the card and misses fresh news.
    expect(queries).toEqual([
      { exclude: ["yt:old"], q: "agent payments", style: "headlines", limit: 5, since: "2026-11-02T00:00:00Z" },
      { exclude: ["yt:old"], q: "cloudflare workers", style: "headlines", limit: 5, since: "2026-11-02T00:00:00Z" },
      { exclude: ["yt:old"], q: "poetry", style: "headlines", limit: 5, since: "2026-11-02T00:00:00Z" },
      { exclude: ["yt:old"], q: "surfing", style: "headlines", limit: 5, since: "2026-11-02T00:00:00Z" },
      { exclude: ["yt:old"], soups: ["soul-soup"], q: "poetry surfing agent payments cloudflare workers", limit: 6 },
    ]);
    for (const query of queries) expect(Object.keys(query).every(key => ["exclude", "q", "style", "limit", "since", "soups", "medium", "maxMinutes"].includes(key))).toBe(true);
  });

  it("keeps a long work lane from crowding out stated interests", () => {
    const busy = { ...taste, soups: [], workTopics: Array.from({ length: 12 }, (_, n) => ({ topic: `work ${n}`, projectId: null, source: "owner" as const })) };
    const queries = servingQueries("pick", busy, { exclude: [] });
    expect(queries.map(query => query.q)).toEqual(["poetry", "surfing", "work 0", "work 1", "work 2", "work 3", "work 4"]);
  });

  it("uses the agent's topic words for a bowl asked in chat", () => {
    expect(servingQueries("pick", taste, { exclude: [], ask: { topics: ["innovation", "product"], medium: "listen", maxMinutes: 20 } })).toEqual([
      { exclude: [], q: "innovation", limit: 6, medium: "listen", maxMinutes: 20 },
      { exclude: [], q: "product", limit: 6, medium: "listen", maxMinutes: 20 },
    ]);
  });
});

describe("soup servings schedule", () => {
  const servings = readServingSpecs([
    { name: "Morning headlines", time: "07:30", kind: "headlines" },
    { name: "Thursday walk", time: "13:00", days: [4], kind: "pick", medium: "listen", maxMinutes: 20 },
  ]);
  const taste = { ...emptySoupTaste(), servings };

  it("is due from ten minutes before its time until the catch-up window closes, on its days only", () => {
    expect(dueServings(taste, { minutes: 7 * 60 + 19, weekday: 1 }).map(s => s.id)).toEqual([]);
    expect(dueServings(taste, { minutes: 7 * 60 + 20, weekday: 1 }).map(s => s.id)).toEqual(["morning-headlines"]);
    expect(dueServings(taste, { minutes: 10 * 60 + 30, weekday: 1 }).map(s => s.id)).toEqual([]);
    expect(dueServings(taste, { minutes: 12 * 60 + 55, weekday: 4 }).map(s => s.id)).toEqual(["thursday-walk"]);
    expect(dueServings(taste, { minutes: 12 * 60 + 55, weekday: 3 }).map(s => s.id)).toEqual([]);
  });

  it("gives headlines the whole day and a pick a few hours", () => {
    const morning = specForServing(servings[0], "2026-11-04", "Europe/Dublin");
    expect(morning.dueAt.toISOString()).toBe("2026-11-04T07:30:00.000Z");
    expect(morning.expiresAt.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    const walk = specForServing(servings[1], "2026-11-05", "Europe/Dublin");
    expect(walk.expiresAt.toISOString()).toBe("2026-11-05T19:00:00.000Z");
    expect(walk.medium).toBe("listen");
    expect(walk.maxMinutes).toBe(20);
  });

  it("fades work topics whose project is gone", () => {
    const topics = [{ topic: "agent payments", projectId: "p1", source: "project" as const }, { topic: "poetry tech", projectId: null, source: "owner" as const }, { topic: "old thing", projectId: "gone", source: "project" as const }];
    expect(fadeWorkTopics(topics, new Set(["p1"])).map(t => t.topic)).toEqual(["agent payments", "poetry tech"]);
  });
});

describe("soup taste from the agent", () => {
  it("reads topic @ project and HH:MM | kind | name lines", () => {
    const projects = new Set(["proj_1"]);
    expect(parseWorkTopicLine("agent payments @ proj_1", projects)).toEqual({ topic: "agent payments", projectId: "proj_1", source: "project" });
    expect(parseWorkTopicLine("poetry @ proj_unknown", projects)).toEqual({ topic: "poetry", projectId: null, source: "owner" });
    expect(parseServingLine("07:30 | headlines | Morning headlines", 0)).toEqual({ id: "morning-headlines", name: "Morning headlines", time: "07:30", days: [], kind: "headlines" });
    expect(parseServingLine("20:00 | pick | Something longer | listen | 45min", 1)).toEqual({ id: "something-longer", name: "Something longer", time: "20:00", days: [], kind: "pick", medium: "listen", maxMinutes: 45 });
    expect(() => parseServingLine("morning", 0)).toThrow(/HH:MM/);
    expect(tastePatchFromAgent({ interests: ["Poetry"], servings: [], setUp: true }, projects)).toEqual({ interests: ["Poetry"], servings: [], setUp: true });
  });
});

describe("morning briefing soup line", () => {
  it("adds the first headline and a count when it fits, and never cuts the briefing", () => {
    const serving = { kind: "headlines" as const, items: [{ title: "Stripe opens Link agent wallets in the UK" }, { title: "b" }, { title: "c" }] as never };
    expect(soupBriefingLine(serving)).toBe("🍲 Stripe opens Link agent wallets in the UK, + 2 more");
    expect(soupBriefingLine({ kind: "pick", items: [{ title: "x" }] as never })).toBeNull();
    expect(withSoupLine({ title: "t", body: "Design review at 10:00." }, soupBriefingLine(serving)).body).toBe("Design review at 10:00. 🍲 Stripe opens Link agent wallets in the UK, + 2 more");
    const full = { title: "t", body: "x".repeat(232) };
    expect(withSoupLine(full, "🍲 Something").body).toBe(full.body);
    const tight = withSoupLine({ title: "t", body: "x".repeat(200) }, "🍲 A very long headline that will not fit in the remaining room at all").body;
    expect(tight.length).toBeLessThanOrEqual(240);
    expect(tight.endsWith("…")).toBe(true);
  });
});

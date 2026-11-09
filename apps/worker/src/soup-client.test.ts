import { describe, expect, it } from "vitest";
import { cleanSoupTopic, createSoupClient, soupSearchQuery, SoupUnavailableError } from "./soup-client";

// Failure modes: owner data leaking into a Soup request (names, emails, project text, unknown
// keys), oversized topic lists, search being unavailable on an older Soup deployment, and a
// Soup outage surfacing as a broken card instead of an error the caller can hide.
const item = (id: string, soup = "hackertube") => ({
  item: { id, kind: "video", url: `https://youtube.com/watch?v=${id}`, title: `Video ${id}`, creator: { name: "Someone" } },
  card: { summary: "What it is.", why: "Why it is good.", format: "talk", topics: ["agents"] },
  reason: { kind: "fresh", text: "Published today." },
  soup: { handle: soup, title: soup },
});

describe("soup client", () => {
  it("sends only topic words and filters, never owner details", () => {
    const params = soupSearchQuery({ q: "agent payments", topics: ["Cloudflare Workers", "kieran@example.com", "x".repeat(50), "Poetry"], medium: "listen", maxMinutes: 20, exclude: ["yt:abc", "bad id!"], since: "2026-11-02T07:00:00Z", limit: 50 });
    expect(Object.fromEntries(params)).toEqual({ q: "agent payments", topics: "cloudflare workers,poetry", medium: "listen", maxMinutes: "20", exclude: "yt:abc", since: "2026-11-02T07:00:00.000Z", limit: "20" });
    expect(() => soupSearchQuery({ ownerName: "Kieran" } as never)).toThrow(/never carry ownerName/);
    expect(soupSearchQuery({ q: "Agent Payments!" }).get("q")).toBe("agent payments");
    expect(soupSearchQuery({ q: "mail kieran@example.com about soil" }).has("q")).toBe(false);
    expect(soupSearchQuery({ q: "see https://example.com/plan" }).has("q")).toBe(false);
    expect(soupSearchQuery({ exclude: Array.from({ length: 500 }, (_, n) => `yt:${n}`) }).get("exclude")!.split(",")).toHaveLength(300);
    expect(cleanSoupTopic("Ship ME3 payments by Friday for Sam's team")).toBeNull();
    expect(cleanSoupTopic("Irish history")).toBe("irish history");
  });

  it("falls back to per-soup bowls when search is missing", async () => {
    const calls: string[] = [];
    const client = createSoupClient({ origin: "https://soup.test/", fetch: async url => {
      calls.push(url);
      if (url.includes("/v1/search")) return new Response("Not found", { status: 404 });
      if (url.endsWith("/v1/soups")) return Response.json({ soups: [{ handle: "hackertube", title: "HackerTube" }, { handle: "soul-soup", title: "Soul Soup" }] });
      if (url.includes("/bowl")) return Response.json({ soup: { handle: url.includes("soul") ? "soul-soup" : "hackertube", title: "x" }, items: [item(url.includes("soul") ? "s1" : "h1")] });
      return new Response("", { status: 500 });
    } });
    const result = await client.find({ q: "agents", limit: 4, medium: "listen" });
    expect(result.fallback).toBe(true);
    expect(calls.filter(url => url.includes("/bowl")).every(url => url.includes("topics=agents") && !url.includes("q="))).toBe(true);
    expect(result.items.map(row => row.item.id).sort()).toEqual(["h1", "s1"]);
    expect(calls.filter(url => url.includes("/bowl")).every(url => url.includes("mode=fresh") && url.includes("medium=listen"))).toBe(true);
  });

  it("uses search when it is there and reports the contract version", async () => {
    const client = createSoupClient({ fetch: async url => {
      expect(url).toBe("https://api.thehumansoup.ai/v1/search?topics=agents&style=headlines");
      return Response.json({ contractVersion: "2026-11-04", items: [item("a"), { broken: true }], plating: { intro: "Fresh today." } });
    } });
    const result = await client.find({ topics: ["agents"], style: "headlines" });
    expect(result).toEqual({ items: [item("a")], fallback: false, contractVersion: "2026-11-04", intro: "Fresh today." });
  });

  it("throws a SoupUnavailableError when Soup is down everywhere", async () => {
    const client = createSoupClient({ fetch: async () => { throw new Error("ECONNREFUSED"); } });
    await expect(client.find({ topics: ["agents"] })).rejects.toBeInstanceOf(SoupUnavailableError);
    await expect(client.find({})).resolves.toEqual({ items: [], fallback: false, contractVersion: null });
  });
});

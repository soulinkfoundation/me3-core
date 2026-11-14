import { describe, expect, it } from "vitest";
import { loadAgentNewsReply, readAgentNewsCard, readAgentNewsServingId } from "./agent-news-card";
import type { Env } from "./types";

function envWith(events: Array<Record<string, unknown>>) {
  return { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: events.map(data => ({ data_json: JSON.stringify(data) })) }) }) }) } } as unknown as Env;
}
const tool = (toolName: string, data: unknown, status = "ok") => ({ state: "complete", toolName, result: { status, data } });

describe("news cards saved with ME3's reply", () => {
  it("keeps the topics card a setup turn showed", async () => {
    const reply = await loadAgentNewsReply(envWith([tool("core_news_settings_read", { card: "topics", time: "07:00", setUp: false })]), { ownerId: "o", turnId: "t" });
    expect(reply).toEqual({ newsCard: { card: "topics", time: "07:00", counts: null }, newsServingId: null });
  });

  it("keeps the last card of the turn, with the paper's counts", async () => {
    const reply = await loadAgentNewsReply(envWith([
      tool("core_news_settings_update", { card: "topics" }),
      tool("core_news_settings_update", { card: "ready", time: "06:30", paper: { counts: { considered: 214, stories: 14, videos: 2, pages: 6 } } }),
    ]), { ownerId: "o", turnId: "t" });
    expect(reply.newsCard).toEqual({ card: "ready", time: "06:30", counts: { considered: 214, stories: 14, videos: 2, pages: 6 } });
  });

  it("keeps the pick ME3 found, and nothing from failed or unfinished tools", async () => {
    const reply = await loadAgentNewsReply(envWith([
      { state: "running", toolName: "core_news_serve" },
      tool("core_news_paper", { card: "paper", counts: { stories: 3 } }, "error"),
      tool("core_news_serve", { served: false }),
      tool("core_news_serve", { served: true, servingId: "serving-1" }),
    ]), { ownerId: "o", turnId: "t" });
    expect(reply).toEqual({ newsCard: null, newsServingId: "serving-1" });
  });

  it("refuses shapes it does not draw", () => {
    expect(readAgentNewsCard({ card: "ready" })).toBeNull();
    expect(readAgentNewsCard({ card: "other" })).toBeNull();
    expect(readAgentNewsCard("topics")).toBeNull();
    expect(readAgentNewsServingId(7)).toBeNull();
  });
});

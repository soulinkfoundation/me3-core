import { describe, expect, it } from "vitest";
import { loadAgentHomeCard, readAgentHomeCard } from "./agent-home-card";
import type { Env } from "./types";

function envWith(events: Array<Record<string, unknown>>) {
  return { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: events.map(data => ({ data_json: JSON.stringify(data) })) }) }) }) } } as unknown as Env;
}
const tool = (toolName: string, data: unknown, status = "ok") => ({ state: "complete", toolName, result: { status, data } });

describe("custom card saved with ME3's reply", () => {
  it("keeps the card a turn built", async () => {
    expect(await loadAgentHomeCard(envWith([tool("core_cards_create", { card: { id: "card-habits" }, state: {} })]), { ownerId: "o", turnId: "t" })).toEqual({ id: "card-habits", isUpdate: false });
    // A card ME3 built on an earlier turn already has its preview there.
    expect(await loadAgentHomeCard(envWith([tool("core_cards_create", { card: { id: "card-habits" }, state: {}, existing: true })]), { ownerId: "o", turnId: "t" })).toBeNull();
  });

  it("keeps the last card, marks a change, and skips failed or unfinished tools", async () => {
    const card = await loadAgentHomeCard(envWith([
      tool("core_cards_create", { card: { id: "card-a" } }),
      { state: "running", toolName: "core_cards_update" },
      tool("core_cards_update", { card: { id: "card-b" } }),
      tool("core_cards_update", { card: { id: "card-c" } }, "error"),
      tool("core_cards_list", { cards: [{ card: { id: "card-d" } }] }),
    ]), { ownerId: "o", turnId: "t" });
    expect(card).toEqual({ id: "card-b", isUpdate: true });
  });

  it("refuses shapes it does not draw", async () => {
    expect(readAgentHomeCard({ id: "../x" })).toBeNull();
    expect(readAgentHomeCard("card-a")).toBeNull();
    expect(await loadAgentHomeCard(envWith([]), { ownerId: "o", turnId: "t" })).toBeNull();
  });
});

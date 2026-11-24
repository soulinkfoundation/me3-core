import { describe, expect, it } from "vitest";
import { counterSubtitle, habitSubtitle, homeCardCall, homeCardFromTool, homeCardIdeas, homeCardRequestText, homePanelOrder, optimisticHomeCard, readHomeCardsResponse, shownCustomCards, withCustomCard, withoutCustomCard, type HomeCardRecord } from "./homeCards";

const record = (id = "card-habits"): HomeCardRecord => ({
  card: { id, name: "Habits", emoji: "✅", version: 1, blocks: [{ type: "habit", key: "run", label: "Run" }, { type: "list", key: "list1", source: "tasks" }], createdBy: "agent", createdAt: "2026-11-24T09:00:00Z", updatedAt: "", history: [] },
  state: { date: "2026-11-24", done: 0, total: 1, blocks: { run: { type: "habit", today: false, streak: 0 }, list1: { type: "list", empty: "", rows: [{ id: "t1", title: "Ship it", check: { on: false, taskId: "t1" } }] } } },
});
const layout = (extra = {}) => ({ order: [], hidden: [], pinned: [], earned: [], ...extra });

describe("custom card ideas", () => {
  it("offers only ideas whose sources this plan has", () => {
    expect(homeCardIdeas(["tasks", "reminders", "goal"]).map(idea => idea.text)).toEqual(["A goal with its tasks", "Track my habits", "Count something every day"]);
    expect(homeCardIdeas(undefined)).toHaveLength(7);
  });
  it("turns the owner's words into a card request", () => {
    expect(homeCardRequestText("  water I drink ")).toBe("Make me a Home card: water I drink");
    expect(homeCardRequestText("Make me a habit tracker card for: reading")).toBe("Make me a habit tracker card for: reading");
    expect(homeCardRequestText(" ")).toBeNull();
  });
});

describe("custom card data", () => {
  it("drops cards and blocks it can't read, keeps offered and sources", () => {
    const card = record();
    card.card.blocks.push({ type: "chart" });
    const response = readHomeCardsResponse({ date: "2026-11-24", cards: [card, { card: { id: 7 }, state: "broken" }], offered: true, sources: ["tasks"] });
    expect(response.cards).toHaveLength(1);
    expect(response.cards[0]!.card.blocks.map(block => block.type)).toEqual(["habit", "list"]);
    expect(response).toMatchObject({ offered: true, sources: ["tasks"] });
    expect(readHomeCardsResponse({ cards: [] }).sources).toBeUndefined();
  });
  it("routes task ticks to the A2UI action endpoint and the rest to act", () => {
    expect(homeCardCall("card-a", { action: "task.done", key: "list1", on: true, taskId: "t1" })).toEqual({ path: "/home/cards/card-a/action", body: { name: "task.done", sourceComponentId: "list1", context: { taskId: "t1", on: true } } });
    expect(homeCardCall("card-a", { action: "tick", key: "run", on: false })).toEqual({ path: "/home/cards/card-a/act", body: { action: "tick", key: "run", on: false } });
  });
  it("flips a tick before the install answers", () => {
    expect(optimisticHomeCard(record(), { action: "tick", key: "run", on: true }).state.blocks.run!.today).toBe(true);
    expect(optimisticHomeCard(record(), { action: "task.done", key: "list1", on: true, taskId: "t1" }).state.blocks.list1!.rows![0]!.check!.on).toBe(true);
  });
  it("words habits and counters as mobile does", () => {
    expect(habitSubtitle({ type: "habit", streak: 3 })).toBe("🔥 3 days");
    expect(habitSubtitle({ type: "habit", perWeek: 3, thisWeek: 1 })).toBe("1 of 3 this week");
    expect(habitSubtitle({ type: "habit", longest: 4 })).toBe("Longest 4");
    expect(counterSubtitle({ type: "counter", unit: "glasses", goal: 8 }, { type: "counter", today: 2.5 })).toBe("2.5 of 8 glasses");
  });
  it("reads the card ME3 built from its tool result", () => {
    expect(homeCardFromTool("core_cards_update", { status: "ok", data: record() })).toMatchObject({ isUpdate: true });
    expect(homeCardFromTool("core_cards_create", { status: "error", data: record() })).toBeNull();
    expect(homeCardFromTool("core_cards_list", { status: "ok", data: record() })).toBeNull();
  });
});

describe("custom cards in the Home layout", () => {
  it("shows a card while pinned and not hidden, at its place in the order", () => {
    const saved = layout({ order: ["today", "card-b", "people"], pinned: ["card-a", "card-b"], hidden: ["card-c"] });
    const shown = shownCustomCards(saved, [record("card-a"), record("card-b"), record("card-c")]);
    expect(shown).toEqual(["card-a", "card-b"]);
    expect(homePanelOrder(saved, ["today", "people"], shown)).toEqual(["today", "card-b", "people", "card-a"]);
  });
  it("pins, unpins and forgets a card", () => {
    const on = withCustomCard(layout({ hidden: ["card-a"] }), "card-a", true);
    expect(on).toMatchObject({ order: ["card-a"], pinned: ["card-a"], hidden: [] });
    expect(withCustomCard(on, "card-a", false)).toMatchObject({ order: ["card-a"], pinned: [], hidden: ["card-a"] });
    expect(withoutCustomCard(on, "card-a")).toEqual(layout());
  });
});

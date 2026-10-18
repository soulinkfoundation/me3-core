import { afterEach, describe, expect, it } from "vitest";
import { HOME_CARDS_SCHEMA, type HomeCardBlockState, actOnHomeCard, createAgentHomeCardServices, createHomeCard, deleteHomeCard, getHomeCard, listHomeCards, rollbackHomeCard, updateHomeCard } from "./home-cards";
import { getHomeLayout, saveHomeLayout, HOME_LAYOUT_SCHEMA } from "./home-layout";
import { createDomainTools } from "../../../packages/agent/src/tools";
import { visibleTools, withToolLoader } from "../../../packages/agent/src/tool-groups";
import type { AgentToolContext } from "../../../packages/agent/src/types";
import { gratitudeFixture } from "./test-utils/gratitude-fixture";

// Failure modes written first: malformed specs accepted, duplicate keys, ids
// colliding with built-in cards, ticks on future or unknown keys, double ticks
// counted twice, streaks broken by an unticked today, weeks not starting on
// Monday in the owner's zone, updates losing data, rollback rewriting history,
// delete leaving entries or layout ids behind, agent tools skipping validation.
const fixtures: ReturnType<typeof gratitudeFixture>[] = [];
function fixture(timezone?: string) {
  const f = gratitudeFixture(timezone);
  for (const sql of [...HOME_LAYOUT_SCHEMA, ...HOME_CARDS_SCHEMA]) f.raw.exec(sql);
  fixtures.push(f); return f;
}
afterEach(() => { fixtures.splice(0).forEach(f => f.raw.close()); });
// Saturday 10 Oct 2026, 09:00 in Dublin.
const saturday = new Date("2026-10-10T08:00:00Z");
const habit = (state: HomeCardBlockState) => state as Extract<HomeCardBlockState, { type: "habit" }>;
const habits = { name: "Habits", emoji: "✅", blocks: [
  { type: "habit", key: "med", label: "Meditate", emoji: "🧘" },
  { type: "habit", key: "run", label: "Run", emoji: "🏃", perWeek: 3 },
  { type: "counter", key: "water", label: "Water", emoji: "💧", unit: "glasses", goal: 8 },
  { type: "note", key: "win", label: "Today's win", emoji: "🏆" },
  { type: "text", text: "Small steps, every day." },
] };

describe("Home card specs", () => {
  it("rejects malformed specs before anything is stored", async () => {
    const f = fixture();
    const bad: unknown[] = [
      null, {}, { name: "", emoji: "✅", blocks: habits.blocks }, { name: "Habits", emoji: "", blocks: habits.blocks },
      { name: "Habits", emoji: "✅", blocks: [] }, { name: "Habits", emoji: "✅", blocks: [{ type: "chart", key: "x", label: "X" }] },
      { name: "Habits", emoji: "✅", blocks: [{ type: "habit", key: "a", label: "A" }, { type: "habit", key: "a", label: "B" }] },
      { name: "Habits", emoji: "✅", blocks: [{ type: "habit", key: "Bad Key", label: "A" }] },
      { name: "Habits", emoji: "✅", blocks: [{ type: "habit", key: "a", label: "A", perWeek: 9 }] },
      { name: "Habits", emoji: "✅", blocks: Array.from({ length: 13 }, (_, i) => ({ type: "habit", key: `h${i}`, label: "H" })) },
      { name: "Habits", emoji: "✅", blocks: [{ type: "text", text: "" }] },
      { name: "x".repeat(41), emoji: "✅", blocks: habits.blocks },
    ];
    for (const input of bad) await expect(createHomeCard(f.env, "owner", input, "agent", saturday)).rejects.toThrow();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM home_cards").get()).toMatchObject({ count: 0 });
  });

  it("gives every card its own id, never one of the built-in cards", async () => {
    const f = fixture();
    const today = await createHomeCard(f.env, "owner", { name: "Today", emoji: "🗓️", blocks: [{ type: "text", text: "Hi" }] }, "agent", saturday);
    expect(today.card.id).toBe("card-today");
    const second = await createHomeCard(f.env, "owner", { name: "Today", emoji: "🗓️", blocks: [{ type: "text", text: "Hi" }] }, "agent", saturday);
    expect(second.card.id).toBe("card-today-2");
    const odd = await createHomeCard(f.env, "owner", { name: "Déjà vu!! 🎉", emoji: "🎉", blocks: [{ type: "text", text: "Hi" }] }, "agent", saturday);
    expect(odd.card.id).toMatch(/^card-[a-z0-9-]+$/);
    expect((await listHomeCards(f.env, "owner", saturday)).cards.map(c => c.card.id)).toEqual(["card-today", "card-today-2", odd.card.id]);
  });
});

describe("Home card data", () => {
  it("ticks habits once per day, refuses future dates and unknown keys, and unticks", async () => {
    const f = fixture();
    const { card } = await createHomeCard(f.env, "owner", habits, "agent", saturday);
    await actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med" }, saturday);
    await actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med" }, saturday);
    let state = (await getHomeCard(f.env, "owner", card.id, saturday)).state;
    expect(state.date).toBe("2026-10-10");
    expect(state.blocks.med).toMatchObject({ today: true, streak: 1, thisWeek: 1 });
    expect(state.done).toBe(1); expect(state.total).toBe(3);
    await expect(actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med", date: "2026-10-11" }, saturday)).rejects.toThrow(/future/i);
    await expect(actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "nope" }, saturday)).rejects.toThrow(/no block/i);
    await expect(actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "water" }, saturday)).rejects.toThrow(/habit/i);
    await expect(actOnHomeCard(f.env, "owner", "card-missing", { action: "tick", key: "med" }, saturday)).rejects.toThrow(/not found/i);
    await actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med", on: false }, saturday);
    state = (await getHomeCard(f.env, "owner", card.id, saturday)).state;
    expect(state.blocks.med).toMatchObject({ today: false, streak: 0 });
    expect(f.raw.prepare("SELECT COUNT(*) count FROM home_card_entries").get()).toMatchObject({ count: 0 });
  });

  it("counts streaks up to today or yesterday, the longest run, and Monday-start weeks in the owner's zone", async () => {
    const f = fixture("Pacific/Auckland"); // Saturday 10 Oct 21:00 there.
    const { card } = await createHomeCard(f.env, "owner", habits, "agent", saturday);
    for (const date of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-07", "2026-10-08", "2026-10-09"]) {
      await actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med", date }, saturday);
    }
    let med = habit((await getHomeCard(f.env, "owner", card.id, saturday)).state.blocks.med);
    // Today is not ticked yet, so the run ending yesterday still counts.
    expect(med).toMatchObject({ today: false, streak: 3, longest: 3, thisWeek: 3 });
    expect(med.week).toEqual([false, false, true, true, true, false, null]);
    await actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med" }, saturday);
    med = habit((await getHomeCard(f.env, "owner", card.id, saturday)).state.blocks.med);
    expect(med).toMatchObject({ today: true, streak: 4, longest: 4, thisWeek: 4 });
    // Two days later with nothing ticked, the streak is over.
    const monday = new Date("2026-10-12T08:00:00Z");
    med = habit((await getHomeCard(f.env, "owner", card.id, monday)).state.blocks.med);
    expect(med).toMatchObject({ today: false, streak: 0, longest: 4, thisWeek: 0 });
    expect(med.week).toEqual([false, null, null, null, null, null, null]);
    const run = (await getHomeCard(f.env, "owner", card.id, saturday)).state.blocks.run;
    expect(run).toMatchObject({ thisWeek: 0, perWeek: 3 });
  });

  it("adds to counters per day, clamps at zero, sets notes, and counts goals as done", async () => {
    const f = fixture();
    const { card } = await createHomeCard(f.env, "owner", habits, "agent", saturday);
    await actOnHomeCard(f.env, "owner", card.id, { action: "add", key: "water" }, saturday);
    await actOnHomeCard(f.env, "owner", card.id, { action: "add", key: "water", by: 6 }, saturday);
    let state = (await getHomeCard(f.env, "owner", card.id, saturday)).state;
    expect(state.blocks.water).toMatchObject({ today: 7, goal: 8, done: false });
    await actOnHomeCard(f.env, "owner", card.id, { action: "add", key: "water", by: -10 }, saturday);
    expect((await getHomeCard(f.env, "owner", card.id, saturday)).state.blocks.water.today).toBe(0);
    await actOnHomeCard(f.env, "owner", card.id, { action: "set", key: "water", value: 8 }, saturday);
    await actOnHomeCard(f.env, "owner", card.id, { action: "set", key: "win", value: "  Shipped the card  " }, saturday);
    state = (await getHomeCard(f.env, "owner", card.id, saturday)).state;
    expect(state.blocks.water).toMatchObject({ today: 8, done: true });
    expect(state.blocks.win).toMatchObject({ today: "Shipped the card" });
    expect(state.done).toBe(1);
    await expect(actOnHomeCard(f.env, "owner", card.id, { action: "set", key: "win", value: "x".repeat(201) }, saturday)).rejects.toThrow();
    await expect(actOnHomeCard(f.env, "owner", card.id, { action: "set", key: "water", value: "eight" }, saturday)).rejects.toThrow();
    await expect(actOnHomeCard(f.env, "owner", card.id, { action: "add", key: "med" }, saturday)).rejects.toThrow(/counter/i);
    await expect(actOnHomeCard(f.env, "owner", card.id, { action: "explode", key: "water" }, saturday)).rejects.toThrow();
  });
});

describe("Home card versions", () => {
  it("keeps data across updates, records linear history, and rolls back as a new version", async () => {
    const f = fixture();
    const { card } = await createHomeCard(f.env, "owner", habits, "agent", saturday);
    await actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med" }, saturday);
    const v2 = await updateHomeCard(f.env, "owner", card.id, { blocks: [...habits.blocks, { type: "habit", key: "shower", label: "Cold shower", emoji: "🚿" }] }, "Added cold shower", saturday);
    expect(v2.card.version).toBe(2);
    expect(v2.card.blocks).toHaveLength(6);
    expect(v2.state.blocks.med).toMatchObject({ today: true });
    expect(v2.card.history.map(h => [h.version, h.summary])).toEqual([[2, "Added cold shower"], [1, "Made by your ME3"]]);
    await expect(updateHomeCard(f.env, "owner", card.id, { blocks: [] }, "Broken", saturday)).rejects.toThrow();
    await expect(updateHomeCard(f.env, "owner", card.id, { name: "Renamed" }, "", saturday)).rejects.toThrow(/summary/i);
    const v3 = await updateHomeCard(f.env, "owner", card.id, { name: "Daily habits", emoji: "🌅" }, "Renamed", saturday);
    expect(v3.card).toMatchObject({ id: card.id, name: "Daily habits", emoji: "🌅", version: 3 });
    expect(v3.card.blocks).toHaveLength(6);
    const back = await rollbackHomeCard(f.env, "owner", card.id, 1, saturday);
    expect(back.card).toMatchObject({ name: "Habits", emoji: "✅", version: 4 });
    expect(back.card.blocks).toHaveLength(5);
    expect(back.card.history[0]).toMatchObject({ version: 4, summary: "Back to v1" });
    expect(back.state.blocks.med).toMatchObject({ today: true });
    await expect(rollbackHomeCard(f.env, "owner", card.id, 9, saturday)).rejects.toThrow();
  });

  it("deletes the card, its entries and versions, and drops it from the Home layout", async () => {
    const f = fixture();
    const { card } = await createHomeCard(f.env, "owner", habits, "agent", saturday);
    await actOnHomeCard(f.env, "owner", card.id, { action: "tick", key: "med" }, saturday);
    await saveHomeLayout(f.env, "owner", { order: ["today", card.id], pinned: [card.id], hidden: [], earned: [] });
    await deleteHomeCard(f.env, "owner", card.id);
    await expect(getHomeCard(f.env, "owner", card.id, saturday)).rejects.toThrow(/not found/i);
    for (const table of ["home_cards", "home_card_versions", "home_card_entries"]) {
      expect(f.raw.prepare(`SELECT COUNT(*) count FROM ${table}`).get()).toMatchObject({ count: 0 });
    }
    expect((await getHomeLayout(f.env, "owner")).layout).toEqual({ order: ["today"], pinned: [], hidden: [], earned: [] });
    await expect(deleteHomeCard(f.env, "owner", card.id)).rejects.toThrow(/not found/i);
  });
});

describe("Home card agent tools", () => {
  function context(f: ReturnType<typeof fixture>): AgentToolContext {
    return { db: f.env.DB, ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "request", toolCallId: "call", idempotencyKey: "key", ownerTimezone: "Europe/Dublin", messageText: "Make me a habit tracker", messages: [], signal: new AbortController().signal, enabledPluginIds: new Set(), services: { cards: createAgentHomeCardServices(f.env, "owner", () => saturday) } } as unknown as AgentToolContext;
  }
  it("stays out of ordinary turns until loaded, then builds, changes, reads and ticks cards", async () => {
    const f = fixture();
    const tools = withToolLoader(createDomainTools());
    const names = (messages: Parameters<typeof visibleTools>[1]) => visibleTools(tools, messages).map(tool => tool.name);
    expect(names([])).not.toContain("core_cards_create");
    expect(names([{ role: "assistant", content: "", toolCalls: [{ id: "load", name: "core_tools_load", arguments: { groups: ["cards"] } }] }]))
      .toEqual(expect.arrayContaining(["core_cards_list", "core_cards_read", "core_cards_create", "core_cards_update", "core_cards_act"]));
    const tool = (name: string) => tools.find(t => t.name === name)!;
    const created = await tool("core_cards_create").execute({ name: "Habits", emoji: "✅", blocks: habits.blocks }, context(f));
    expect(created.status).toBe("ok");
    const card = (created.data as { card: { id: string; version: number } }).card;
    expect(card).toMatchObject({ id: "card-habits", version: 1 });
    expect((created.data as { state: { total: number } }).state.total).toBe(3);
    expect((await tool("core_cards_create").execute({ name: "Habits", emoji: "✅", blocks: [{ type: "pie" }] }, context(f))).status).toBe("error");
    expect((await tool("core_cards_create").execute({ name: "Habits", emoji: "✅", blocks: habits.blocks, surprise: 1 }, context(f))).status).toBe("error");
    const ticked = await tool("core_cards_act").execute({ cardId: card.id, action: "tick", key: "run" }, context(f));
    expect(ticked.status).toBe("ok");
    expect((ticked.data as { state: { blocks: Record<string, { today: boolean; thisWeek: number }> } }).state.blocks.run).toMatchObject({ today: true, thisWeek: 1 });
    const changed = await tool("core_cards_update").execute({ cardId: card.id, blocks: [...habits.blocks, { type: "habit", key: "read", label: "Read 20 pages", emoji: "📖" }], summary: "Added reading" }, context(f));
    expect(changed.status).toBe("ok");
    expect((changed.data as { card: { version: number } }).card.version).toBe(2);
    const read = await tool("core_cards_read").execute({ cardId: card.id }, context(f));
    expect((read.data as { card: { history: unknown[] }; state: { blocks: Record<string, { today: boolean }> } }).card.history).toHaveLength(2);
    expect((read.data as { state: { blocks: Record<string, { today: boolean }> } }).state.blocks.run.today).toBe(true);
    const list = await tool("core_cards_list").execute({}, context(f));
    expect((list.data as { cards: unknown[] }).cards).toHaveLength(1);
    expect((await tool("core_cards_act").execute({ cardId: "card-nope", action: "tick", key: "run" }, context(f))).status).toBe("error");
    expect((await tool("core_cards_update").execute({ cardId: card.id, name: "X" }, context(f))).status).toBe("error");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { homeCardDataState, pickCardCurrency, type HomeCardLoaders } from "./home-card-data";
import { HOME_CARDS_SCHEMA, createHomeCard, handleHomeCardAction, homeCardAccess, homeCardSurface, parseHomeCardSpec } from "./home-cards";
import { HOME_LAYOUT_SCHEMA } from "./home-layout";
import { gratitudeFixture } from "./test-utils/gratitude-fixture";

// Failure modes written first: a data block showing a source it can't draw
// (days of invoices), a money bar without a goal, goal ids leaking onto other
// sources, bookings counted on the wrong local day, money in the wrong
// currency, past bookings listed as upcoming, a failing source breaking the
// whole card, a card ticking a task it doesn't show, and access hiding what a
// card can read.
const fixtures: ReturnType<typeof gratitudeFixture>[] = [];
afterEach(() => { fixtures.splice(0).forEach(f => f.raw.close()); });

// Tuesday 24 Nov 2026, 09:00 in Dublin.
const now = new Date("2026-11-24T09:00:00Z");
function loaders(overrides: Partial<HomeCardLoaders> = {}): HomeCardLoaders {
  return {
    timezone: "Europe/Dublin", today: "2026-11-24", now,
    currency: async () => "GBP",
    bookings: async () => [],
    moneyToday: async () => 0,
    moneyMonth: async () => 0,
    invoices: async () => [],
    enquiries: async () => [],
    tasks: async () => [],
    reminders: async () => [],
    goal: async () => null,
    ...overrides,
  };
}

describe("data block specs", () => {
  it("rejects blocks that can't draw their source", () => {
    const bad: unknown[] = [
      { type: "days", source: "invoices.unpaid" },
      { type: "progress", source: "money.month" },
      { type: "list", source: "money.today" },
      { type: "stat", source: "weather" },
      { type: "stat", source: "money.today", goalId: "g1" },
      { type: "list", source: "tasks", limit: 9 },
      { type: "action", label: "Remind them" },
    ];
    for (const block of bad) expect(() => parseHomeCardSpec({ name: "Biz", emoji: "💷", blocks: [block] })).toThrow();
  });

  it("names data blocks itself and keeps owner keys unique", () => {
    const spec = parseHomeCardSpec({ name: "Biz", emoji: "💷", blocks: [
      { type: "stat", source: "money.today" }, { type: "stat", key: "stat1", source: "money.month" },
      { type: "progress", source: "money.month", goal: 3000 }, { type: "action", label: "Remind them", prompt: "Remind my late payers" },
    ] });
    expect(spec.blocks.map(block => "key" in block ? block.key : "")).toEqual(["stat2", "stat1", "progress1", "action1"]);
  });

  it("lists what a card can read and change", () => {
    const spec = parseHomeCardSpec({ name: "Launch", emoji: "🚀", blocks: [
      { type: "progress", source: "goal", goalId: "g1" }, { type: "list", source: "tasks", goalId: "g1" }, { type: "list", source: "reminders" },
    ] });
    expect(homeCardAccess(spec.blocks)).toEqual({ sees: ["Goals", "Tasks", "Reminders"], changes: ["Ticks tasks"] });
    expect(homeCardAccess([{ type: "habit", key: "med", label: "Meditate" }])).toEqual({ sees: [], changes: ["Its own entries"] });
  });
});

describe("data block state", () => {
  it("counts bookings on the owner's local day and lists only upcoming ones", async () => {
    const bookings = async () => [
      { startsAt: "2026-11-23T10:00:00Z", guestName: "Past Pat", durationMinutes: 60, paid: true },
      { startsAt: "2026-11-24T23:30:00Z", guestName: "Late Lou", durationMinutes: 30, paid: false }, // Tue 23:30 Dublin
      { startsAt: "2026-11-25T10:00:00Z", guestName: "Anna Price", durationMinutes: 60, paid: true },
    ];
    expect(await homeCardDataState({ type: "days", key: "d", source: "bookings.week" }, loaders({ bookings }))).toEqual({ type: "days", values: [1, 1, 1, 0, 0, 0, 0], labels: ["M", "T", "W", "T", "F", "S", "S"], today: 1 });
    expect(await homeCardDataState({ type: "stat", key: "s", source: "bookings.week" }, loaders({ bookings }))).toMatchObject({ value: "3", label: "booked this week" });
    const list = await homeCardDataState({ type: "list", key: "l", source: "bookings.week" }, loaders({ bookings }));
    expect(list).toMatchObject({ rows: [{ title: "Today 23:30 · Late Lou", sub: "30 min" }, { title: "Tomorrow 10:00 · Anna Price", sub: "60 min · paid" }] });
  });

  it("shows money in the owner's currency against their goal", async () => {
    const money = loaders({ moneyToday: async () => 18000, moneyMonth: async () => 124000 });
    expect(await homeCardDataState({ type: "stat", key: "s", source: "money.today" }, money)).toMatchObject({ value: "£180", label: "in today" });
    expect(await homeCardDataState({ type: "progress", key: "p", source: "money.month", goal: 3000 }, money)).toEqual({ type: "progress", pct: 41, label: "£1,240 of your £3,000 goal for November" });
  });

  // Found on a live install: an owner whose default currency was never set (EUR) but who is paid in GBP saw €0.
  it("shows money in the currency the owner is actually paid in", () => {
    expect(pickCardCurrency("EUR", [{ currency: "GBP", amountCents: 124000 }])).toBe("GBP");
    expect(pickCardCurrency("EUR", [{ currency: "GBP", amountCents: 500 }, { currency: "EUR", amountCents: 100 }])).toBe("EUR");
    expect(pickCardCurrency("EUR", [{ currency: "USD", amountCents: 100 }, { currency: "GBP", amountCents: 900 }])).toBe("GBP");
    expect(pickCardCurrency("EUR", [])).toBe("EUR");
  });

  it("keeps the amounts on a money bar that ME3 labelled", async () => {
    const money = loaders({ moneyMonth: async () => 124000 });
    expect(await homeCardDataState({ type: "progress", key: "p", source: "money.month", goal: 3000, label: "Progress toward £3,000" }, money)).toEqual({ type: "progress", pct: 41, label: "£1,240 of your £3,000 goal for November" });
  });

  it("marks overdue invoices and totals only the owner's currency", async () => {
    const invoices = async () => [
      { id: "i1", customer: "Sarah Kim", amountCents: 24000, currency: "GBP", date: "2026-11-12", overdue: true },
      { id: "i2", customer: "Jo Patel", amountCents: 28000, currency: "GBP", date: "2026-11-20", overdue: false },
      { id: "i3", customer: "Euro Ed", amountCents: 5000, currency: "EUR", date: "2026-11-20", overdue: false },
    ];
    expect(await homeCardDataState({ type: "stat", key: "s", source: "invoices.unpaid" }, loaders({ invoices }))).toMatchObject({ value: "£520", label: "unpaid · 3 invoices" });
    expect(await homeCardDataState({ type: "stat", key: "s", source: "invoices.overdue" }, loaders({ invoices }))).toMatchObject({ value: "£240", tone: "late" });
    expect(await homeCardDataState({ type: "list", key: "l", source: "invoices.unpaid", limit: 2 }, loaders({ invoices }))).toMatchObject({ rows: [
      { title: "Sarah Kim", sub: "Overdue · 12 Nov", value: "£240", tone: "late" }, { title: "Jo Patel", sub: "Sent 20 Nov", value: "£280" },
    ] });
  });

  it("lists a goal's open tasks first with tick boxes", async () => {
    const tasks = async (goalId?: string) => goalId === "g1" ? [
      { id: "t1", title: "Outline lessons", done: true, dueAt: null, goalId: "g1" },
      { id: "t2", title: "Record lesson 1", done: false, dueAt: null, goalId: "g1" },
    ] : [];
    const list = await homeCardDataState({ type: "list", key: "l", source: "tasks", goalId: "g1" }, loaders({ tasks }));
    expect(list).toMatchObject({ rows: [{ id: "t2", check: { on: false, taskId: "t2" } }, { id: "t1", check: { on: true, taskId: "t1" } }] });
  });

  it("shows a failing source as empty instead of breaking the card", async () => {
    const broken = loaders({ invoices: async () => { throw new Error("D1 down"); } });
    expect(await homeCardDataState({ type: "list", key: "l", source: "invoices.unpaid" }, broken)).toEqual({ type: "list", rows: [], empty: "Can’t load this right now." });
    expect(await homeCardDataState({ type: "list", key: "l", source: "invoices.unpaid" }, loaders())).toEqual({ type: "list", rows: [], empty: "Everyone has paid." });
  });
});

describe("card surface and actions", () => {
  it("serves the card as an A2UI surface bound to its data model", () => {
    const blocks = parseHomeCardSpec({ name: "Owed", emoji: "🧾", blocks: [
      { type: "stat", source: "invoices.unpaid" }, { type: "habit", key: "med", label: "Meditate" }, { type: "action", label: "Remind them", prompt: "Remind my late payers" },
    ] }).blocks;
    const state = { date: "2026-11-24", done: 0, total: 1, blocks: { stat1: { type: "stat" as const, value: "£640", label: "unpaid" } } };
    const surface = homeCardSurface({ id: "card-owed", name: "Owed", emoji: "🧾", blocks }, state).createSurface;
    expect(surface).toMatchObject({ surfaceId: "card-owed", catalogId: "me3/cards/v1", dataModel: { blocks: { stat1: { value: "£640" } } } });
    expect(surface.components).toEqual([
      { id: "root", component: "Card", title: "Owed", emoji: "🧾", children: ["stat1", "med", "action1"] },
      { id: "stat1", component: "Stat", source: "invoices.unpaid", data: { "@path": "/blocks/stat1" } },
      { id: "med", component: "Habit", label: "Meditate", data: { "@path": "/blocks/med" }, action: { event: { name: "tick", context: { key: "med" } } } },
      { id: "action1", component: "Action", label: "Remind them", action: { functionCall: { call: "askME3", args: { prompt: "Remind my late payers" } } } },
    ]);
  });

  it("refuses to tick a task from a card that doesn't list tasks", async () => {
    const f = gratitudeFixture();
    for (const sql of [...HOME_LAYOUT_SCHEMA, ...HOME_CARDS_SCHEMA]) f.raw.exec(sql);
    fixtures.push(f);
    const card = await createHomeCard(f.env, "owner", { name: "Habits", emoji: "✅", blocks: [{ type: "habit", key: "med", label: "Meditate" }] }, "agent", now);
    await expect(handleHomeCardAction(f.env, "owner", card.card.id, { name: "task.done", sourceComponentId: "med", context: { taskId: "t1" } }, now)).rejects.toThrow(/can't tick tasks/);
    await expect(handleHomeCardAction(f.env, "owner", card.card.id, { name: "delete", sourceComponentId: "med" }, now)).rejects.toThrow(/Action must be/);
    const ticked = await handleHomeCardAction(f.env, "owner", card.card.id, { name: "tick", sourceComponentId: "med", context: { on: true } }, now);
    expect(ticked.state.blocks.med).toMatchObject({ today: true });
    expect(ticked.surface.createSurface.dataModel).toMatchObject({ done: 1, total: 1 });
  });
});

import { describe, expect, it } from "vitest";
import { addUserSpend, budgetDecision, recordLoad, shouldShed, RATE_LIMIT_SHED_MS, LEDGER_REUSE_MS, reusableLedgerAnswer, localDay, messagesLeft, nextLocalMidnight, usageCostMicroUsd, DEFAULT_BUDGET, TYPICAL_MESSAGE_MICRO_USD, type BudgetState } from "../src/budget";

// Failure modes: spend carries into the next day and blocks chat forever (or never resets); the kill switch
// or an exhausted budget still lets a turn through; a user past their daily messages keeps chatting; usage
// with no known price counts as free, so the budget never fills.
const DAY = Date.UTC(2026, 11, 12, 21, 0);
const state = (patch: Partial<BudgetState> = {}): BudgetState => ({ ...DEFAULT_BUDGET, day: "2026-12-12", spentMicroUsd: 0, ...patch });

describe("global AI budget", () => {
  it("allows chat under the budget and adds reported spend", () => {
    const result = budgetDecision(state({ spentMicroUsd: 1_000_000 }), DAY, 250_000);
    expect(result.allowed).toBe(true);
    expect(result.state.spentMicroUsd).toBe(1_250_000);
  });
  it("stops chat once the day's budget is spent", () => {
    const result = budgetDecision(state({ dailyBudgetMicroUsd: 100_000_000, spentMicroUsd: 99_999_000 }), DAY, 2_000);
    expect(result).toMatchObject({ allowed: false, reason: "budget" });
  });
  it("stops chat when paused, whatever the spend", () => {
    expect(budgetDecision(state({ paused: true }), DAY, 0)).toMatchObject({ allowed: false, reason: "paused" });
  });
  it("starts a new day at zero and keeps the settings", () => {
    const result = budgetDecision(state({ day: "2026-12-11", spentMicroUsd: 100_000_000, perUserDailyMessages: 7 }), DAY, 500);
    expect(result.allowed).toBe(true);
    expect(result.state).toMatchObject({ day: "2026-12-12", spentMicroUsd: 500, perUserDailyMessages: 7, perUserDailyMicroUsd: 150_000 });
  });
  it("ignores negative or non-numeric spend", () => {
    expect(budgetDecision(state({ spentMicroUsd: 10 }), DAY, -5).state.spentMicroUsd).toBe(10);
    expect(budgetDecision(state({ spentMicroUsd: 10 }), DAY, Number.NaN).state.spentMicroUsd).toBe(10);
  });
});

describe("per-user daily allowance", () => {
  const limits = { perUserDailyMessages: 60, perUserDailyMicroUsd: 150_000 };
  it("starts a fresh day at the allowance divided by a typical message", () => {
    expect(messagesLeft({ day: "", count: 0, spentMicroUsd: 0 }, "2026-12-12", limits)).toBe(Math.floor(150_000 / TYPICAL_MESSAGE_MICRO_USD));
  });
  it("estimates from the user's own average once they have spent", () => {
    // 10 messages cost $0.10, so $0.05 left buys about 5 more.
    expect(messagesLeft({ day: "2026-12-12", count: 10, spentMicroUsd: 100_000 }, "2026-12-12", limits)).toBe(5);
  });
  it("stops when the spend allowance is used, however few messages were sent", () => {
    // Two heavy multi-step messages can use the whole day.
    expect(messagesLeft({ day: "2026-12-12", count: 2, spentMicroUsd: 150_000 }, "2026-12-12", limits)).toBe(0);
  });
  it("stops at the message backstop even when spend is low", () => {
    expect(messagesLeft({ day: "2026-12-12", count: 60, spentMicroUsd: 1_000 }, "2026-12-12", limits)).toBe(0);
  });
  it("leaves at least one message while any allowance remains", () => {
    expect(messagesLeft({ day: "2026-12-12", count: 5, spentMicroUsd: 149_000 }, "2026-12-12", limits)).toBe(1);
  });
  it("starts again on the user's next day", () => {
    const spent = { day: "2026-12-11", count: 60, spentMicroUsd: 500_000 };
    expect(messagesLeft(spent, "2026-12-12", limits)).toBeGreaterThan(0);
    expect(addUserSpend(spent, "2026-12-12", 3_000)).toEqual({ day: "2026-12-12", count: 0, spentMicroUsd: 3_000 });
  });
  it("adds spend within the day and ignores bad amounts", () => {
    expect(addUserSpend({ day: "2026-12-12", count: 3, spentMicroUsd: 10 }, "2026-12-12", 5)).toEqual({ day: "2026-12-12", count: 3, spentMicroUsd: 15 });
    expect(addUserSpend({ day: "2026-12-12", count: 3, spentMicroUsd: 10 }, "2026-12-12", Number.NaN).spentMicroUsd).toBe(10);
  });
  it("refuses everything when either limit is zero", () => {
    expect(messagesLeft({ day: "", count: 0, spentMicroUsd: 0 }, "2026-12-12", { perUserDailyMessages: 0, perUserDailyMicroUsd: 150_000 })).toBe(0);
    expect(messagesLeft({ day: "", count: 0, spentMicroUsd: 0 }, "2026-12-12", { perUserDailyMessages: 60, perUserDailyMicroUsd: 0 })).toBe(0);
  });
});

describe("the user's own day", () => {
  // 21:00 UTC on 12 Dec is already 13 Dec in Auckland and still 12 Dec in Los Angeles.
  it("follows the user's time zone", () => {
    expect(localDay(DAY, "Pacific/Auckland")).toBe("2026-12-13");
    expect(localDay(DAY, "America/Los_Angeles")).toBe("2026-12-12");
    expect(localDay(DAY, null)).toBe("2026-12-12");
    expect(localDay(DAY, "Not/AZone")).toBe("2026-12-12");
  });
  it("renews at the user's next midnight", () => {
    expect(new Date(nextLocalMidnight(DAY, "Europe/Dublin")).toISOString()).toBe("2026-12-13T00:00:00.000Z");
    expect(new Date(nextLocalMidnight(DAY, "America/New_York")).toISOString()).toBe("2026-12-13T05:00:00.000Z");
    expect(new Date(nextLocalMidnight(DAY, "Asia/Kolkata")).toISOString()).toBe("2026-12-13T18:30:00.000Z");
  });
});

describe("usage cost", () => {
  it("uses the recorded cost when there is one", () => {
    expect(usageCostMicroUsd([{ estimated_cost_usd: 0.0012, tokens_in: 5000, tokens_out: 200 }])).toBe(1200);
  });
  it("prices tokens at the fallback rate when the cost is unknown", () => {
    // 1M in at $0.50 + 1M out at $2.00
    expect(usageCostMicroUsd([{ estimated_cost_usd: 0, tokens_in: 1_000_000, tokens_out: 1_000_000 }])).toBe(2_500_000);
  });
  it("charges a flat amount when nothing was reported", () => {
    expect(usageCostMicroUsd([{ estimated_cost_usd: 0, tokens_in: 0, tokens_out: 0 }])).toBe(2000);
  });
});

// Failure modes: every idle tick and allowance read hits the single global ledger (a hot spot at 100k users);
// or a cached answer swallows real spend, or keeps chat running long after the kill switch.
describe("reusing the global ledger's answer", () => {
  const cached = { at: DAY, value: { allowed: true } };
  it("reuses a fresh answer when there is nothing to report", () => {
    expect(reusableLedgerAnswer(cached, false, DAY + LEDGER_REUSE_MS - 1)).toEqual({ allowed: true });
  });
  it("always calls the ledger when there is new spend to report", () => {
    expect(reusableLedgerAnswer(cached, true, DAY + 1)).toBeNull();
  });
  it("asks again once the answer is older than the window, so a pause lands within it", () => {
    expect(reusableLedgerAnswer(cached, false, DAY + LEDGER_REUSE_MS)).toBeNull();
    expect(LEDGER_REUSE_MS).toBeLessThanOrEqual(60_000);
  });
  it("asks the ledger when nothing is cached or the clock went backwards", () => {
    expect(reusableLedgerAnswer(null, false, DAY)).toBeNull();
    expect(reusableLedgerAnswer(cached, false, DAY - 1)).toBeNull();
  });
});

// Failure modes: a busy runtime keeps making three calls a message and runs into the provider's per-minute input
// limit; or a quiet one sheds forever after one busy minute or one refused call, and nobody gets follow-ups or memory.
describe("shedding after-turn calls when free chat is busy", () => {
  const minute = Math.floor(DAY / 60_000);
  it("is quiet by default", () => {
    expect(shouldShed(state(), DAY)).toBe(false);
  });
  it("sheds above the turns-a-minute line and stops two minutes later", () => {
    let busy = state({ shedTurnsPerMinute: 3 });
    for (let i = 0; i < 3; i++) busy = recordLoad(busy, DAY, { turn: true });
    expect(shouldShed(busy, DAY)).toBe(true);
    expect(shouldShed(busy, DAY + 60_000)).toBe(true);
    expect(shouldShed(busy, DAY + 120_000)).toBe(false);
    expect(recordLoad(busy, DAY + 120_000, {})).toMatchObject({ minute: minute + 2, turnsThisMinute: 0, turnsLastMinute: 0 });
  });
  it("sheds for a while after a refused model call", () => {
    const refused = recordLoad(state(), DAY, { rateLimited: 1 });
    expect(shouldShed(refused, DAY + RATE_LIMIT_SHED_MS - 1)).toBe(true);
    expect(shouldShed(refused, DAY + RATE_LIMIT_SHED_MS)).toBe(false);
  });
  it("sheds once most of today's budget is spent, not yesterday's", () => {
    expect(shouldShed(state({ spentMicroUsd: 80_000_000 }), DAY)).toBe(true);
    expect(shouldShed(state({ day: "2026-12-11", spentMicroUsd: 99_000_000 }), DAY)).toBe(false);
  });
  it("can be switched on or off by hand", () => {
    expect(shouldShed(state({ shed: "on" }), DAY)).toBe(true);
    expect(shouldShed(state({ shed: "off", rateLimitedAt: DAY }), DAY)).toBe(false);
  });
});

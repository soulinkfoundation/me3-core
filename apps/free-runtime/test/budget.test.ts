import { describe, expect, it } from "vitest";
import { budgetDecision, countMessage, usageCostMicroUsd, DEFAULT_BUDGET, type BudgetState } from "../src/budget";

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
    expect(result.state).toMatchObject({ day: "2026-12-12", spentMicroUsd: 500, perUserDailyMessages: 7 });
  });
  it("ignores negative or non-numeric spend", () => {
    expect(budgetDecision(state({ spentMicroUsd: 10 }), DAY, -5).state.spentMicroUsd).toBe(10);
    expect(budgetDecision(state({ spentMicroUsd: 10 }), DAY, Number.NaN).state.spentMicroUsd).toBe(10);
  });
});

describe("per-user daily messages", () => {
  it("counts up to the limit, then refuses", () => {
    let meta = { day: "2026-12-12", count: 18 };
    const first = countMessage(meta, 20, DAY);
    expect(first).toEqual({ allowed: true, day: "2026-12-12", count: 19 });
    const second = countMessage(first, 20, DAY);
    expect(second.allowed).toBe(true);
    expect(countMessage(second, 20, DAY)).toEqual({ allowed: false, day: "2026-12-12", count: 20 });
  });
  it("resets on a new day", () => {
    expect(countMessage({ day: "2026-12-11", count: 20 }, 20, DAY)).toEqual({ allowed: true, day: "2026-12-12", count: 1 });
  });
  it("refuses everything when the limit is zero", () => {
    expect(countMessage({ day: "2026-12-12", count: 0 }, 0, DAY).allowed).toBe(false);
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

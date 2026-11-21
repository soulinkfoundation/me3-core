/**
 * Free chat spend limits. One global daily budget with a kill switch, and a daily message count per user.
 * Days are UTC. Amounts are whole micro-dollars so sums stay exact.
 */
export type BudgetState = {
  day: string;
  spentMicroUsd: number;
  dailyBudgetMicroUsd: number;
  perUserDailyMessages: number;
  paused: boolean;
};

export const DEFAULT_BUDGET: BudgetState = { day: "", spentMicroUsd: 0, dailyBudgetMicroUsd: 100_000_000, perUserDailyMessages: 20, paused: false };

// Used only when a model call recorded no cost: roughly a mid-priced small model, deliberately not cheap.
const FALLBACK_INPUT_MICRO_USD_PER_TOKEN = 0.5;
const FALLBACK_OUTPUT_MICRO_USD_PER_TOKEN = 2;
const FALLBACK_CALL_MICRO_USD = 2000;

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

export function budgetDecision(state: BudgetState, now: number, addMicroUsd: number): { allowed: boolean; reason?: "paused" | "budget"; state: BudgetState } {
  const day = utcDay(now);
  const add = Number.isFinite(addMicroUsd) && addMicroUsd > 0 ? Math.round(addMicroUsd) : 0;
  const next: BudgetState = { ...state, day, spentMicroUsd: (state.day === day ? state.spentMicroUsd : 0) + add };
  if (next.paused) return { allowed: false, reason: "paused", state: next };
  if (next.spentMicroUsd >= next.dailyBudgetMicroUsd) return { allowed: false, reason: "budget", state: next };
  return { allowed: true, state: next };
}

export function countMessage(meta: { day: string; count: number }, limit: number, now: number): { allowed: boolean; day: string; count: number } {
  const day = utcDay(now);
  const count = meta.day === day ? meta.count : 0;
  if (count >= limit) return { allowed: false, day, count };
  return { allowed: true, day, count: count + 1 };
}

export function usageCostMicroUsd(rows: { estimated_cost_usd: number; tokens_in: number; tokens_out: number }[]): number {
  let total = 0;
  for (const row of rows) {
    if (row.estimated_cost_usd > 0) total += row.estimated_cost_usd * 1_000_000;
    else if (row.tokens_in > 0 || row.tokens_out > 0) total += row.tokens_in * FALLBACK_INPUT_MICRO_USD_PER_TOKEN + row.tokens_out * FALLBACK_OUTPUT_MICRO_USD_PER_TOKEN;
    else total += FALLBACK_CALL_MICRO_USD;
  }
  return Math.round(total);
}

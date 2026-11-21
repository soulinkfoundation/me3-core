/**
 * Free chat spend limits. One global daily budget (UTC days) with a kill switch, and per user a daily
 * spend allowance plus a message count backstop (the user's own days). Amounts are whole micro-dollars.
 */
export type BudgetState = {
  day: string;
  spentMicroUsd: number;
  dailyBudgetMicroUsd: number;
  perUserDailyMessages: number;
  perUserDailyMicroUsd: number;
  paused: boolean;
};

export const DEFAULT_BUDGET: BudgetState = {
  day: "", spentMicroUsd: 0, dailyBudgetMicroUsd: 100_000_000, perUserDailyMessages: 60, perUserDailyMicroUsd: 150_000, paused: false,
};

/** What one message costs before a user has any spend today to judge by (a cold DeepSeek turn measured ~$0.004). */
export const TYPICAL_MESSAGE_MICRO_USD = 4_000;

/** The calendar day in the user's time zone, so their allowance renews at their own midnight. */
export function localDay(now: number, timeZone: string | null | undefined): string {
  try {
    if (timeZone) return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    // An unknown zone falls back to UTC.
  }
  return utcDay(now);
}

/** The next midnight in the user's time zone. */
export function nextLocalMidnight(now: number, timeZone: string | null | undefined): number {
  const today = localDay(now, timeZone);
  // Step forward in hours until the local day changes, then back to the exact minute; handles any offset and DST.
  let at = now;
  while (localDay(at, timeZone) === today) at += 60 * 60 * 1000;
  let low = at - 60 * 60 * 1000;
  while (at - low > 60 * 1000) {
    const mid = low + Math.floor((at - low) / 2);
    if (localDay(mid, timeZone) === today) low = mid; else at = mid;
  }
  return Math.ceil(at / 60_000) * 60_000;
}

export type UserAllowance = { day: string; count: number; spentMicroUsd: number };

/** Adds settled spend to the user's day, starting again on a new day. */
export function addUserSpend(allowance: UserAllowance, day: string, addMicroUsd: number): UserAllowance {
  const add = Number.isFinite(addMicroUsd) && addMicroUsd > 0 ? Math.round(addMicroUsd) : 0;
  return allowance.day === day ? { ...allowance, spentMicroUsd: allowance.spentMicroUsd + add } : { day, count: 0, spentMicroUsd: add };
}

/** Messages a user can still send today: the smaller of the message backstop and what their spend allows. */
export function messagesLeft(allowance: UserAllowance, day: string, limits: { perUserDailyMessages: number; perUserDailyMicroUsd: number }): number {
  const today = allowance.day === day ? allowance : { day, count: 0, spentMicroUsd: 0 };
  const byCount = limits.perUserDailyMessages - today.count;
  const remaining = limits.perUserDailyMicroUsd - today.spentMicroUsd;
  if (remaining <= 0 || byCount <= 0) return 0;
  const perMessage = today.count > 0 ? Math.max(today.spentMicroUsd / today.count, 1) : TYPICAL_MESSAGE_MICRO_USD;
  return Math.max(0, Math.min(byCount, Math.max(1, Math.floor(remaining / perMessage))));
}

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

export function usageCostMicroUsd(rows: { estimated_cost_usd: number; tokens_in: number; tokens_out: number }[]): number {
  let total = 0;
  for (const row of rows) {
    if (row.estimated_cost_usd > 0) total += row.estimated_cost_usd * 1_000_000;
    else if (row.tokens_in > 0 || row.tokens_out > 0) total += row.tokens_in * FALLBACK_INPUT_MICRO_USD_PER_TOKEN + row.tokens_out * FALLBACK_OUTPUT_MICRO_USD_PER_TOKEN;
    else total += FALLBACK_CALL_MICRO_USD;
  }
  return Math.round(total);
}

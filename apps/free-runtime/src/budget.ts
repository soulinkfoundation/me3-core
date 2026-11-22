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
  /** Shedding drops after-turn model calls (follow-ups, memory) so a message is one call: "auto" sheds when busy. */
  shed: "auto" | "on" | "off";
  /** Busy above this many chat turns a minute, runtime-wide. */
  shedTurnsPerMinute: number;
  minute: number;
  turnsThisMinute: number;
  turnsLastMinute: number;
  /** When a model call was last refused (rate limited or overloaded), in ms. */
  rateLimitedAt: number;
};

export const DEFAULT_BUDGET: BudgetState = {
  day: "", spentMicroUsd: 0, dailyBudgetMicroUsd: 100_000_000, perUserDailyMessages: 60, perUserDailyMicroUsd: 150_000, paused: false,
  shed: "auto", shedTurnsPerMinute: 300, minute: 0, turnsThisMinute: 0, turnsLastMinute: 0, rateLimitedAt: 0,
};

/** Busy for this long after any refused model call. */
export const RATE_LIMIT_SHED_MS = 2 * 60_000;
/** Busy once this share of the daily budget is spent. */
export const BUDGET_SHED_SHARE = 0.8;

/** Counts a chat turn and any refused model calls into the per-minute load. */
export function recordLoad(state: BudgetState, now: number, load: { turn?: boolean; rateLimited?: number }): BudgetState {
  const minute = Math.floor(now / 60_000);
  const next = minute === state.minute ? { ...state }
    : { ...state, minute, turnsLastMinute: minute === state.minute + 1 ? state.turnsThisMinute : 0, turnsThisMinute: 0 };
  if (load.turn) next.turnsThisMinute += 1;
  if ((load.rateLimited ?? 0) > 0) next.rateLimitedAt = now;
  return next;
}

/** Whether after-turn model calls should wait: switched on, recent refusals, a busy minute, or most of today's budget gone. */
export function shouldShed(state: BudgetState, now: number): boolean {
  if (state.shed !== "auto") return state.shed === "on";
  const minute = Math.floor(now / 60_000);
  const thisMinute = minute === state.minute ? state.turnsThisMinute : 0;
  const lastMinute = minute === state.minute ? state.turnsLastMinute : minute === state.minute + 1 ? state.turnsThisMinute : 0;
  return now - state.rateLimitedAt < RATE_LIMIT_SHED_MS
    || Math.max(thisMinute, lastMinute) >= state.shedTurnsPerMinute
    || (state.day === utcDay(now) && state.spentMicroUsd >= state.dailyBudgetMicroUsd * BUDGET_SHED_SHARE);
}

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

/**
 * How long one isolate may reuse the global ledger's answer when it has no new spend to report. Without this
 * every user's 15-minute tick and every allowance read would hit the one ledger object (about 110 requests a
 * second at 100k users). Spend reports and chat turns still go straight through; other reads see a pause within this window.
 */
export const LEDGER_REUSE_MS = 30_000;

export type LedgerAnswer<T> = { at: number; value: T };

/** The cached ledger answer, if it may stand in for a ledger call that would report nothing. */
export function reusableLedgerAnswer<T>(cached: LedgerAnswer<T> | null, hasNewSpend: boolean, now: number): T | null {
  if (hasNewSpend || !cached) return null;
  return now >= cached.at && now - cached.at < LEDGER_REUSE_MS ? cached.value : null;
}

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

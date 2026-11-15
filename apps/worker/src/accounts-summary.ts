import { getEcbExchangeRate, type AccountCurrencyEstimate } from "./account-exchange-rates";
import { syncWebsiteIncomeEntries } from "./accounts";
import { getDefaultCommerceCurrency } from "./commerce-settings";
import type { Env } from "./types";

/** Paid totals for one entry type, day and currency. */
export type AccountsSummaryRow = {
  entry_type: "income" | "expense";
  date: string;
  currency: string;
  total: number;
  category_id?: string | null;
  category_name?: string | null;
};

export type AccountsSummaryPeriod = { key: string; label: string; start: string; end: string };

type MoneyTotal = { currency: string; amountCents: number };
type Total = { totals: MoneyTotal[]; estimate: AccountCurrencyEstimate };
type Category = Total & { id: string | null; name: string };
type Side = Total & { categories: Category[] };

/**
 * Tax years that differ from the calendar year, keyed by the owner's default
 * currency. Calendar-year countries already have "This year".
 */
const TAX_YEAR_STARTS: Record<string, { month: number; day: number }> = {
  GBP: { month: 4, day: 6 },
  AUD: { month: 7, day: 1 },
  NZD: { month: 4, day: 1 },
};

/**
 * Income, expenses and net (paid entries only) for the periods a small business
 * owner checks: month, quarter, year and, where it differs, the tax year.
 */
export async function getAccountsSummary(env: Env, userId: string, now = new Date()) {
  await syncWebsiteIncomeEntries(env, userId);
  const defaultCurrency = await getDefaultCommerceCurrency(env, userId);
  const periods = accountsSummaryPeriods(now, defaultCurrency);
  const start = periods.reduce((earliest, period) => (period.start < earliest ? period.start : earliest), periods[0].start);
  const end = periods.reduce((latest, period) => (period.end > latest ? period.end : latest), periods[0].end);
  const [rowsResult, reviewResult] = await Promise.all([
    env.DB.prepare(
      `SELECT e.entry_type, e.date, UPPER(e.currency) AS currency, COALESCE(SUM(e.amount_cents), 0) AS total,
              fc.id AS category_id, fc.name AS category_name
       FROM financial_entries e
       LEFT JOIN financial_categories fc ON fc.id = e.category_id
       WHERE e.user_id = ? AND e.status = 'paid' AND e.date >= ? AND e.date < ?
       GROUP BY e.entry_type, e.date, UPPER(e.currency), fc.id`,
    ).bind(userId, start, end).all<AccountsSummaryRow>(),
    env.DB.prepare(
      `SELECT entry_type, COUNT(*) AS count
       FROM financial_entries
       WHERE user_id = ? AND status = 'needs_review'
       GROUP BY entry_type`,
    ).bind(userId).all<{ entry_type: string; count: number }>(),
  ]);
  const needsReview = { income: 0, expense: 0 };
  for (const row of reviewResult.results || []) {
    if (row.entry_type === "income" || row.entry_type === "expense") needsReview[row.entry_type] = Number(row.count) || 0;
  }
  return {
    summary: {
      defaultCurrency,
      needsReview,
      periods: await buildAccountsSummary(rowsResult.results || [], periods, defaultCurrency, now),
    },
  };
}

export function accountsSummaryPeriods(now: Date, defaultCurrency: string): AccountsSummaryPeriod[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const quarter = Math.floor(month / 3) * 3;
  const periods: AccountsSummaryPeriod[] = [
    { key: "this_month", label: "This month", start: isoDate(year, month, 1), end: isoDate(year, month + 1, 1) },
    { key: "last_month", label: "Last month", start: isoDate(year, month - 1, 1), end: isoDate(year, month, 1) },
    { key: "this_quarter", label: "This quarter", start: isoDate(year, quarter, 1), end: isoDate(year, quarter + 3, 1) },
    { key: "last_quarter", label: "Last quarter", start: isoDate(year, quarter - 3, 1), end: isoDate(year, quarter, 1) },
    { key: "this_year", label: "This year", start: isoDate(year, 0, 1), end: isoDate(year + 1, 0, 1) },
    { key: "last_year", label: "Last year", start: isoDate(year - 1, 0, 1), end: isoDate(year, 0, 1) },
  ];
  const taxStart = TAX_YEAR_STARTS[defaultCurrency.toUpperCase()];
  if (taxStart) {
    const today = isoDate(year, month, now.getUTCDate());
    const thisYearStart = isoDate(year, taxStart.month - 1, taxStart.day);
    const startYear = today >= thisYearStart ? year : year - 1;
    const taxYear = (from: number) => ({
      label: `Tax year ${from}–${String((from + 1) % 100).padStart(2, "0")}`,
      start: isoDate(from, taxStart.month - 1, taxStart.day),
      end: isoDate(from + 1, taxStart.month - 1, taxStart.day),
    });
    periods.push({ key: "this_tax_year", ...taxYear(startYear) }, { key: "last_tax_year", ...taxYear(startYear - 1) });
  }
  return periods;
}

/**
 * Converted figures use one ECB reference rate per currency and month (the 15th,
 * or today for the current month), so a year needs at most twelve lookups.
 */
export async function buildAccountsSummary(
  rows: AccountsSummaryRow[],
  periods: AccountsSummaryPeriod[],
  defaultCurrency: string,
  now = new Date(),
) {
  const target = defaultCurrency.toUpperCase();
  const today = now.toISOString().slice(0, 10);
  const rates = new Map<string, Promise<{ rate: number; date: string } | null>>();
  const rateFor = (currency: string, date: string) => {
    const rateDate = `${date.slice(0, 7)}-15` < today ? `${date.slice(0, 7)}-15` : today;
    const key = `${currency}:${rateDate}`;
    if (!rates.has(key)) rates.set(key, getEcbExchangeRate(currency, target, rateDate));
    return rates.get(key)!;
  };

  const total = async (periodRows: AccountsSummaryRow[]): Promise<Total> => {
    const byCurrency = new Map<string, number>();
    for (const row of periodRows) byCurrency.set(row.currency, (byCurrency.get(row.currency) || 0) + (Number(row.total) || 0));
    const totals = [...byCurrency.entries()]
      .filter(([, amountCents]) => amountCents > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amountCents]) => ({ currency, amountCents }));
    const foreign = periodRows.filter(row => row.currency !== target && Number(row.total) > 0);
    if (!foreign.length) {
      return { totals, estimate: { status: "not_needed", targetCurrency: target, amountCents: byCurrency.get(target) || 0 } };
    }
    const converted = await Promise.all(foreign.map(async row => {
      const rate = await rateFor(row.currency, row.date);
      return rate ? { cents: Number(row.total) * rate.rate, date: rate.date } : null;
    }));
    if (converted.some(item => item === null)) return { totals, estimate: { status: "unavailable", targetCurrency: target } };
    const valid = converted as Array<{ cents: number; date: string }>;
    return {
      totals,
      estimate: {
        status: "estimated",
        targetCurrency: target,
        amountCents: Math.round((byCurrency.get(target) || 0) + valid.reduce((sum, item) => sum + item.cents, 0)),
        provider: "ECB",
        rateDates: [...new Set(valid.map(item => item.date))].sort(),
      },
    };
  };

  /** Largest first; entries without a category share one "Uncategorized" row. */
  const side = async (periodRows: AccountsSummaryRow[]): Promise<Side> => {
    const groups = new Map<string, { id: string | null; name: string; rows: AccountsSummaryRow[] }>();
    for (const row of periodRows) {
      const id = row.category_id || null;
      const key = id ?? "";
      const group = groups.get(key) || { id, name: id ? row.category_name || "Uncategorized" : "Uncategorized", rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    const [overall, categories] = await Promise.all([
      total(periodRows),
      Promise.all([...groups.values()].map(async group => ({ id: group.id, name: group.name, ...(await total(group.rows)) }))),
    ]);
    const size = (category: Category) => category.estimate.amountCents ?? category.totals.reduce((sum, item) => sum + item.amountCents, 0);
    return {
      ...overall,
      categories: categories.filter(category => category.totals.length).sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name)),
    };
  };

  return Promise.all(periods.map(async period => {
    const inPeriod = rows.filter(row => row.date >= period.start && row.date < period.end);
    const [income, expenses] = await Promise.all([
      side(inPeriod.filter(row => row.entry_type === "income")),
      side(inPeriod.filter(row => row.entry_type === "expense")),
    ]);
    return { ...period, income, expenses, net: net(income, expenses, target) };
  }));
}

function net(income: Total, expenses: Total, target: string): Total {
  const byCurrency = new Map<string, number>();
  for (const total of income.totals) byCurrency.set(total.currency, (byCurrency.get(total.currency) || 0) + total.amountCents);
  for (const total of expenses.totals) byCurrency.set(total.currency, (byCurrency.get(total.currency) || 0) - total.amountCents);
  const totals = [...byCurrency.entries()]
    .filter(([, amountCents]) => amountCents !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountCents]) => ({ currency, amountCents }));
  const a = income.estimate;
  const b = expenses.estimate;
  if (a.amountCents === undefined || b.amountCents === undefined) {
    return { totals, estimate: { status: "unavailable", targetCurrency: target } };
  }
  const estimated = a.status === "estimated" || b.status === "estimated";
  return {
    totals,
    estimate: {
      status: estimated ? "estimated" : "not_needed",
      targetCurrency: target,
      amountCents: a.amountCents - b.amountCents,
      ...(estimated ? { provider: "ECB" as const, rateDates: [...new Set([...(a.rateDates || []), ...(b.rateDates || [])])].sort() } : {}),
    },
  };
}

function isoDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { accountsSummaryPeriods, buildAccountsSummary, type AccountsSummaryRow } from "./accounts-summary";

afterEach(() => vi.unstubAllGlobals());

// Failure modes covered:
// - period boundaries drift (quarter, year, tax year) or include the end date
// - net mixes currencies instead of subtracting like for like
// - a missing reference rate produces a made-up converted net
// - the same rate is fetched once per period instead of once per month
// - a currency with a calendar tax year gets a duplicate "tax year" period

describe("accounts summary periods", () => {
  it("covers month, quarter and year windows with exclusive ends", () => {
    const periods = accountsSummaryPeriods(new Date("2026-11-14T10:00:00Z"), "EUR");
    expect(periods.map(({ key, start, end }) => ({ key, start, end }))).toEqual([
      { key: "this_month", start: "2026-11-01", end: "2026-12-01" },
      { key: "last_month", start: "2026-10-01", end: "2026-11-01" },
      { key: "this_quarter", start: "2026-10-01", end: "2027-01-01" },
      { key: "last_quarter", start: "2026-07-01", end: "2026-10-01" },
      { key: "this_year", start: "2026-01-01", end: "2027-01-01" },
      { key: "last_year", start: "2025-01-01", end: "2026-01-01" },
    ]);
  });

  it("adds the UK tax year for GBP, starting on 6 April", () => {
    const periods = accountsSummaryPeriods(new Date("2026-03-02T00:00:00Z"), "GBP");
    expect(periods.find(period => period.key === "this_tax_year")).toMatchObject({
      label: "Tax year 2025–26", start: "2025-04-06", end: "2026-04-06",
    });
    expect(periods.find(period => period.key === "last_tax_year")).toMatchObject({
      label: "Tax year 2024–25", start: "2024-04-06", end: "2025-04-06",
    });
  });

  it("starts the Australian tax year on 1 July", () => {
    const periods = accountsSummaryPeriods(new Date("2026-07-01T00:00:00Z"), "AUD");
    expect(periods.find(period => period.key === "this_tax_year")).toMatchObject({ start: "2026-07-01", end: "2027-07-01" });
  });
});

describe("accounts summary totals", () => {
  const today = new Date("2026-11-14T10:00:00Z");
  const row = (entryType: "income" | "expense", date: string, currency: string, total: number): AccountsSummaryRow =>
    ({ entry_type: entryType, date, currency, total });

  it("subtracts expenses from income per period and keeps boundary dates in the right period", async () => {
    const periods = accountsSummaryPeriods(today, "EUR");
    const summary = await buildAccountsSummary([
      row("income", "2026-11-01", "EUR", 50_000),
      row("expense", "2026-11-13", "EUR", 12_000),
      row("income", "2026-10-31", "EUR", 7_000),
      row("expense", "2025-12-31", "EUR", 1_000),
    ], periods, "EUR", today);

    const byKey = Object.fromEntries(summary.map(period => [period.key, period]));
    expect(byKey.this_month.income.estimate).toMatchObject({ status: "not_needed", amountCents: 50_000 });
    expect(byKey.this_month.net.estimate).toMatchObject({ status: "not_needed", amountCents: 38_000 });
    expect(byKey.last_month.net.totals).toEqual([{ currency: "EUR", amountCents: 7_000 }]);
    expect(byKey.this_quarter.net.estimate?.amountCents).toBe(45_000);
    expect(byKey.last_year.net.totals).toEqual([{ currency: "EUR", amountCents: -1_000 }]);
    expect(byKey.last_year.income.totals).toEqual([]);
  });

  it("converts other currencies once per month and estimates the net", async () => {
    const fetchMock = vi.fn(async () => Response.json({ date: "2026-11-13", base: "USD", quote: "EUR", rate: 0.9 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => undefined } });
    const periods = accountsSummaryPeriods(today, "EUR");
    const summary = await buildAccountsSummary([
      row("income", "2026-11-03", "EUR", 10_000),
      row("expense", "2026-11-04", "USD", 1_000),
      row("expense", "2026-11-09", "USD", 1_000),
    ], periods, "EUR", today);

    const thisMonth = summary.find(period => period.key === "this_month")!;
    expect(thisMonth.expenses.totals).toEqual([{ currency: "USD", amountCents: 2_000 }]);
    expect(thisMonth.expenses.estimate).toMatchObject({ status: "estimated", amountCents: 1_800 });
    expect(thisMonth.net.estimate).toMatchObject({ status: "estimated", amountCents: 8_200, targetCurrency: "EUR" });
    expect(thisMonth.net.totals).toEqual([{ currency: "EUR", amountCents: 10_000 }, { currency: "USD", amountCents: -2_000 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the net unconverted when a reference rate is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => undefined } });
    const periods = accountsSummaryPeriods(today, "EUR");
    const summary = await buildAccountsSummary([
      row("income", "2026-11-03", "EUR", 10_000),
      row("expense", "2026-11-04", "USD", 1_000),
    ], periods, "EUR", today);
    const thisMonth = summary.find(period => period.key === "this_month")!;
    expect(thisMonth.net.estimate).toMatchObject({ status: "unavailable" });
    expect(thisMonth.net.estimate?.amountCents).toBeUndefined();
  });
});

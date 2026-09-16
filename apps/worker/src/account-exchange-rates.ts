const FRANKFURTER_ECB_ORIGIN = "https://api.frankfurter.dev";
const CACHE_ORIGIN = "https://accounts-rates.me3.internal";

export type AccountDailyCurrencyTotal = {
  date: string;
  currency: string;
  amountCents: number;
};

export type AccountCurrencyEstimate = {
  status: "estimated" | "not_needed" | "unavailable";
  targetCurrency: string;
  amountCents?: number;
  provider?: "ECB";
  rateDates?: string[];
};

type ExchangeRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

/**
 * Produces an all-or-nothing estimate. The caller keeps and displays original
 * currency totals whenever one of the required reference rates is unavailable.
 */
export async function estimateAccountCurrencyTotal(
  targetCurrency: string,
  dailyTotals: AccountDailyCurrencyTotal[],
): Promise<AccountCurrencyEstimate> {
  const target = normalizeCurrency(targetCurrency);
  if (!target) return { status: "unavailable", targetCurrency: "USD" };

  const meaningfulTotals = dailyTotals.filter(
    (row) => Number.isSafeInteger(row.amountCents) && row.amountCents > 0 && normalizeCurrency(row.currency),
  );
  const requiresConversion = meaningfulTotals.some((row) => normalizeCurrency(row.currency) !== target);
  if (!requiresConversion) {
    return {
      status: "not_needed",
      targetCurrency: target,
      amountCents: meaningfulTotals.reduce((sum, row) => sum + row.amountCents, 0),
    };
  }

  const rateLookups = await Promise.all(
    meaningfulTotals.map(async (row) => {
      const source = normalizeCurrency(row.currency)!;
      if (source === target) return { row, rate: 1, rateDate: null };
      const exchangeRate = await getEcbExchangeRate(source, target, row.date);
      return exchangeRate ? { row, rate: exchangeRate.rate, rateDate: exchangeRate.date } : null;
    }),
  );
  if (rateLookups.some((row) => row === null)) {
    return { status: "unavailable", targetCurrency: target };
  }

  const validRates = rateLookups as Array<{ row: AccountDailyCurrencyTotal; rate: number; rateDate: string | null }>;
  const amountCents = Math.round(validRates.reduce((sum, { row, rate }) => sum + row.amountCents * rate, 0));
  return {
    status: "estimated",
    targetCurrency: target,
    amountCents,
    provider: "ECB",
    rateDates: [...new Set(validRates.flatMap(({ rateDate }) => (rateDate ? [rateDate] : [])))].sort(),
  };
}

async function getEcbExchangeRate(base: string, quote: string, date: string): Promise<ExchangeRate | null> {
  if (!isIsoDate(date)) return null;
  const cacheKey = new Request(`${CACHE_ORIGIN}/${base}/${quote}/${date}`);
  const cache = getDefaultCache();
  try {
    const cached = await cache?.match(cacheKey);
    if (cached) {
      const stored = await cached.json<unknown>();
      if (isExchangeRate(stored, base, quote, date)) return stored;
    }
  } catch {
    // Cache failures must not hide a usable public reference rate.
  }

  let response: Response;
  try {
    response = await fetch(
      `${FRANKFURTER_ECB_ORIGIN}/v2/providers/ecb/rate/${base.toLowerCase()}/${quote.toLowerCase()}?date=${date}`,
      { headers: { Accept: "application/json" } },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let rate: unknown;
  try {
    rate = await response.json();
  } catch {
    return null;
  }
  if (!isExchangeRate(rate, base, quote, date)) return null;

  try {
    await cache?.put(
      cacheKey,
      Response.json(rate, {
        headers: { "Cache-Control": `public, max-age=${date === today() ? 14400 : 31536000}, immutable` },
      }),
    );
  } catch {
    // Estimation still works if the runtime cache is temporarily unavailable.
  }
  return rate;
}

function getDefaultCache(): Cache | null {
  const cacheStorage = (globalThis as typeof globalThis & { caches?: { default?: Cache } }).caches;
  return cacheStorage?.default || null;
}

function isExchangeRate(value: unknown, base: string, quote: string, requestedDate: string): value is ExchangeRate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExchangeRate>;
  return candidate.base === base
    && candidate.quote === quote
    && typeof candidate.date === "string"
    && isIsoDate(candidate.date)
    && candidate.date <= requestedDate
    && daysBetween(candidate.date, requestedDate) <= 7
    && typeof candidate.rate === "number"
    && Number.isFinite(candidate.rate)
    && candidate.rate > 0;
}

function normalizeCurrency(value: string): string | null {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000;
}

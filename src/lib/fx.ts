import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// FX rates move slowly relative to Moatboard's 10-year CAGR verdicts. Six
// hours of in-memory caching is plenty: the same render path won't hit
// yfinance with concurrent FX requests, and a stale-by-a-few-hours rate
// shifts an implied-return number by basis points, not categories.
const TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map<string, { rate: number; fetchedAt: number }>();

// Returns the multiplier that converts `currency` amounts into USD.
// USD short-circuits to 1. Returns null on failure so callers decide
// whether to skip the field, fall back to SEC data, or hide the verdict.
export async function getFxToUsd(
  currency: string | null | undefined,
): Promise<number | null> {
  if (!currency) return null;
  const code = currency.toUpperCase();
  if (code === "USD") return 1;

  const hit = cache.get(code);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.rate;

  try {
    const r = await yf.quote(`${code}USD=X`);
    const rate = r?.regularMarketPrice ?? null;
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      cache.set(code, { rate, fetchedAt: Date.now() });
      return rate;
    }
    return null;
  } catch (err) {
    console.warn(`FX fetch failed for ${code}USD=X:`, err);
    return null;
  }
}

// Multiplies a numeric field by `fxToUsd` if both are finite. Pass-through
// for null inputs and for fxToUsd === 1 (USD reporters need no work).
export function applyFx(
  value: number | null | undefined,
  fxToUsd: number | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (fxToUsd === null || fxToUsd === undefined || fxToUsd === 1) {
    return Number.isFinite(value) ? value : null;
  }
  if (!Number.isFinite(fxToUsd) || fxToUsd <= 0) return null;
  return value * fxToUsd;
}

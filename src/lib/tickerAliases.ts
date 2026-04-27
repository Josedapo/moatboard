// Canonical-ticker resolution for dual-class shares (GOOG/GOOGL,
// BRK-B/BRK-A, etc.). Same business, two ticker symbols.
//
// Convention: if no row exists in `ticker_aliases` for a ticker, the
// ticker is its own canonical. SQL consumers use
// `COALESCE(canonical_ticker, ticker)` after a LEFT JOIN. Application
// code uses `getCanonicalTicker(ticker)` which returns the input
// unchanged when no alias is configured.
//
// The table is small (< 30 entries in practice) so this module keeps
// an in-memory Map. The cache is loaded lazily on first lookup. Mutations
// (the seed script, ad-hoc INSERTs) must call `refreshAliasCache()` to
// invalidate; in dev/serverless this matters less because module state
// resets per request, but the helper exists for explicit invalidation.

import { sql } from "@/lib/db";

let _cache: Map<string, string> | null = null;

async function loadCache(): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT ticker, canonical_ticker FROM ticker_aliases
  `) as unknown as { ticker: string; canonical_ticker: string }[];
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.ticker.toUpperCase(), r.canonical_ticker.toUpperCase());
  }
  return map;
}

async function ensureCache(): Promise<Map<string, string>> {
  if (_cache !== null) return _cache;
  _cache = await loadCache();
  return _cache;
}

export async function refreshAliasCache(): Promise<void> {
  _cache = await loadCache();
}

// Returns the canonical ticker for the given input. If the input is not
// an alias (or is itself a canonical), returns the input unchanged
// (uppercased).
export async function getCanonicalTicker(ticker: string): Promise<string> {
  const upper = ticker.toUpperCase();
  const map = await ensureCache();
  return map.get(upper) ?? upper;
}

// Batch resolver for use in queries that need to canonicalize many
// tickers at once (e.g. enriching a list with cache lookups). Returns a
// Map keyed on the input tickers (uppercased).
export async function getCanonicalTickerMap(
  tickers: string[],
): Promise<Map<string, string>> {
  const map = await ensureCache();
  const result = new Map<string, string>();
  for (const t of tickers) {
    const upper = t.toUpperCase();
    result.set(upper, map.get(upper) ?? upper);
  }
  return result;
}

// Reverse lookup: given a canonical ticker, return all share classes
// (the canonical itself plus every alias pointing at it). Useful for
// migration scripts and the rare data-cleanup case.
export async function getActualTickersForCanonical(
  canonical: string,
): Promise<string[]> {
  const upperCanonical = canonical.toUpperCase();
  const map = await ensureCache();
  const aliases: string[] = [];
  for (const [ticker, c] of map.entries()) {
    if (c === upperCanonical) aliases.push(ticker);
  }
  return [upperCanonical, ...aliases];
}

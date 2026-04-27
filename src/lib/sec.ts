// SEC EDGAR XBRL integration — plumbing layer (Session 1 of 3).
//
// Responsibilities:
//   - Resolve ticker → CIK from sec.gov/files/company_tickers.json (weekly refresh)
//   - Fetch raw companyfacts JSON from data.sec.gov with a declarative User-Agent
//   - Persist raw payload into sec_fundamentals_cache for Session 2 (parser) to consume
//
// Out of scope for this file: any parsing of XBRL facts into AnnualFundamentalRow.
// Parsing lives in src/lib/secParser.ts (Session 2).

import { sql } from "@/lib/db";
import {
  parseFundamentals,
  type ParsedFundamentals,
} from "@/lib/secParser";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import type { MultiYearFundamentals } from "@/lib/financial";

const SEC_USER_AGENT = process.env.SEC_USER_AGENT;
if (!SEC_USER_AGENT) {
  throw new Error(
    "SEC_USER_AGENT is not set. SEC EDGAR requires 'Name Email' format (see .env.local).",
  );
}

const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const COMPANYFACTS_URL = (cik10: string) =>
  `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`;

const CIK_MAP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days per SEC refresh cadence
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000; // 24h; good enough for daily dogfood use

// ---------------------------------------------------------------------------
// Ticker → CIK resolution
// ---------------------------------------------------------------------------

type RawTickerMapRow = { cik_str: number; ticker: string; title: string };

async function fetchTickerMap(): Promise<RawTickerMapRow[]> {
  const res = await fetch(TICKER_MAP_URL, {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `SEC ticker map fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as Record<string, RawTickerMapRow>;
  return Object.values(data);
}

async function refreshTickerCikTable(): Promise<void> {
  const rows = await fetchTickerMap();

  const tickers: string[] = [];
  const ciks: string[] = [];
  const titles: string[] = [];
  for (const r of rows) {
    tickers.push(r.ticker.toUpperCase());
    ciks.push(String(r.cik_str).padStart(10, "0"));
    titles.push(r.title ?? "");
  }

  // Single-statement bulk replace: truncate then multi-row insert via UNNEST.
  // 10k rows comfortably fits in one round trip with this approach.
  await sql.query("TRUNCATE TABLE sec_ticker_cik");
  await sql.query(
    `INSERT INTO sec_ticker_cik (ticker, cik, title, last_refreshed)
     SELECT t, c, ti, NOW()
     FROM UNNEST($1::text[], $2::text[], $3::text[]) AS u(t, c, ti)`,
    [tickers, ciks, titles],
  );
}

export async function getCikForTicker(ticker: string): Promise<string | null> {
  // Canonicalize so dual-class share pairs resolve to the same SEC row.
  // Both GOOG and GOOGL share CIK 0001652044 (Alphabet); GOOG analysis
  // and GOOGL analysis must hit the same `sec_fundamentals_cache` row
  // — keyed under the canonical ticker — so we don't double-fetch from
  // SEC EDGAR or store two identical raw_facts blobs.
  const key = await getCanonicalTicker(ticker);

  const rows = (await sql`
    SELECT cik, last_refreshed
    FROM sec_ticker_cik
    WHERE ticker = ${key}
    LIMIT 1
  `) as unknown as { cik: string; last_refreshed: string }[];

  const row = rows[0];
  const fresh =
    row &&
    Date.now() - new Date(row.last_refreshed).getTime() < CIK_MAP_TTL_MS;
  if (fresh) return row.cik;

  try {
    await refreshTickerCikTable();
  } catch (err) {
    console.error(
      `SEC ticker map refresh failed: ${(err as Error).message}. Falling back to stale row if present.`,
    );
    return row?.cik ?? null;
  }

  const afterRows = (await sql`
    SELECT cik FROM sec_ticker_cik WHERE ticker = ${key} LIMIT 1
  `) as unknown as { cik: string }[];
  return afterRows[0]?.cik ?? null;
}

// ---------------------------------------------------------------------------
// Raw companyfacts fetch
// ---------------------------------------------------------------------------

export type SecCompanyFacts = {
  cik: number;
  entityName?: string;
  facts: Record<string, Record<string, unknown>>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchCompanyFacts(
  cik10: string,
): Promise<SecCompanyFacts | null> {
  const url = COMPANYFACTS_URL(cik10);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": SEC_USER_AGENT! },
      cache: "no-store",
    });

    if (res.ok) {
      return (await res.json()) as SecCompanyFacts;
    }

    if (res.status === 404) {
      // CIK not in XBRL (rare — very new filer, or CIK with no XBRL-era filings)
      return null;
    }

    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      if (body.includes("Request Rate Threshold") && attempt === 0) {
        await sleep(60_000);
        continue;
      }
      throw new Error(
        `SEC 403 for CIK${cik10} — likely User-Agent or rate limit. Body: ${body.slice(0, 200)}`,
      );
    }

    if (res.status >= 500 && attempt === 0) {
      await sleep(2_000);
      continue;
    }

    throw new Error(
      `SEC companyfacts fetch failed for CIK${cik10}: ${res.status} ${res.statusText}`,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cache orchestration
// ---------------------------------------------------------------------------

export type SecCacheStatus = "ok" | "no_cik" | "fetch_error" | "parse_error";

export type EnsureSecRawResult = {
  status: SecCacheStatus;
  cik?: string;
  raw_facts?: SecCompanyFacts;
};

async function writeCacheMiss(
  ticker: string,
  cik: string,
  status: Exclude<SecCacheStatus, "ok">,
): Promise<void> {
  await sql`
    INSERT INTO sec_fundamentals_cache (ticker, cik, status, raw_facts, last_fetched)
    VALUES (${ticker}, ${cik}, ${status}, NULL, NOW())
    ON CONFLICT (ticker) DO UPDATE
      SET status = EXCLUDED.status,
          cik = EXCLUDED.cik,
          raw_facts = NULL,
          parsed_annual = NULL,
          years_available = NULL,
          earliest_year = NULL,
          latest_year = NULL,
          parse_notes = NULL,
          last_fetched = NOW()
  `;
}

async function writeCacheOk(
  ticker: string,
  cik: string,
  facts: SecCompanyFacts,
): Promise<void> {
  await sql`
    INSERT INTO sec_fundamentals_cache (ticker, cik, entity_name, status, raw_facts, last_fetched)
    VALUES (
      ${ticker}, ${cik}, ${facts.entityName ?? null},
      'ok', ${JSON.stringify(facts)}, NOW()
    )
    ON CONFLICT (ticker) DO UPDATE
      SET cik = EXCLUDED.cik,
          entity_name = EXCLUDED.entity_name,
          status = 'ok',
          raw_facts = EXCLUDED.raw_facts,
          last_fetched = NOW()
  `;
}

export async function ensureSecRawCache(
  ticker: string,
): Promise<EnsureSecRawResult> {
  // Cache row is keyed under canonical: GOOG and GOOGL share Alphabet's
  // CIK and SEC payload, so caching twice would be waste.
  const key = await getCanonicalTicker(ticker);

  const cachedRows = (await sql`
    SELECT cik, status, raw_facts, last_fetched
    FROM sec_fundamentals_cache
    WHERE ticker = ${key}
    LIMIT 1
  `) as unknown as {
    cik: string;
    status: SecCacheStatus;
    raw_facts: SecCompanyFacts | null;
    last_fetched: string;
  }[];

  const cached = cachedRows[0];
  const fresh =
    cached &&
    Date.now() - new Date(cached.last_fetched).getTime() < FUNDAMENTALS_TTL_MS;

  if (fresh && cached.status === "ok" && cached.raw_facts) {
    return { status: "ok", cik: cached.cik, raw_facts: cached.raw_facts };
  }

  const cik = await getCikForTicker(key);
  if (!cik) {
    await writeCacheMiss(key, "", "no_cik");
    return { status: "no_cik" };
  }

  let facts: SecCompanyFacts | null = null;
  try {
    facts = await fetchCompanyFacts(cik);
  } catch (err) {
    console.error(
      `SEC fetch error for ${key} (CIK${cik}): ${(err as Error).message}`,
    );
    await writeCacheMiss(key, cik, "fetch_error");
    return { status: "fetch_error", cik };
  }

  if (!facts) {
    await writeCacheMiss(key, cik, "fetch_error");
    return { status: "fetch_error", cik };
  }

  await writeCacheOk(key, cik, facts);
  return { status: "ok", cik, raw_facts: facts };
}

// ---------------------------------------------------------------------------
// Parsed-fundamentals layer (Session 2)
// ---------------------------------------------------------------------------

export type EnsureSecFundamentalsResult = {
  status: SecCacheStatus;
  cik?: string;
  parsed?: ParsedFundamentals;
};

async function writeParsed(
  ticker: string,
  cik: string,
  parsed: ParsedFundamentals,
): Promise<void> {
  await sql`
    UPDATE sec_fundamentals_cache
       SET parsed_annual = ${JSON.stringify(parsed.years)},
           parse_notes = ${JSON.stringify(parsed.parseNotes)},
           years_available = ${parsed.yearsAvailable},
           earliest_year = ${parsed.earliestYear},
           latest_year = ${parsed.latestYear},
           latest_quarter_accession = ${parsed.latestFiling?.accession ?? null},
           latest_quarter_period_end = ${parsed.latestFiling?.period_end ?? null},
           latest_quarter_form = ${parsed.latestFiling?.form ?? null},
           latest_quarter_filed = ${parsed.latestFiling?.filed ?? null}
     WHERE ticker = ${ticker} AND cik = ${cik}
  `;
}

async function markParseError(ticker: string): Promise<void> {
  await sql`
    UPDATE sec_fundamentals_cache
       SET status = 'parse_error',
           parsed_annual = NULL,
           parse_notes = NULL,
           years_available = NULL,
           earliest_year = NULL,
           latest_year = NULL,
           latest_quarter_accession = NULL,
           latest_quarter_period_end = NULL,
           latest_quarter_form = NULL,
           latest_quarter_filed = NULL
     WHERE ticker = ${ticker}
  `;
}

// Ensures both the raw cache AND the parsed rows are populated. Session 3
// will route scorecard.ts/valuation.ts through this.
export async function ensureSecFundamentals(
  ticker: string,
): Promise<EnsureSecFundamentalsResult> {
  // Mirror ensureSecRawCache: parsed cache row is keyed under canonical.
  const key = await getCanonicalTicker(ticker);

  // First, ensure the raw cache is hot.
  const raw = await ensureSecRawCache(key);
  if (raw.status !== "ok" || !raw.raw_facts || !raw.cik) {
    return { status: raw.status, cik: raw.cik };
  }

  // Read the existing row to see if parsed_annual is still fresh.
  const cachedRows = (await sql`
    SELECT parsed_annual, parse_notes, years_available, earliest_year, latest_year,
           latest_quarter_accession,
           TO_CHAR(latest_quarter_period_end, 'YYYY-MM-DD') AS latest_quarter_period_end,
           latest_quarter_form,
           TO_CHAR(latest_quarter_filed, 'YYYY-MM-DD') AS latest_quarter_filed
    FROM sec_fundamentals_cache
    WHERE ticker = ${key}
    LIMIT 1
  `) as unknown as {
    parsed_annual: unknown;
    parse_notes: unknown;
    years_available: number | null;
    earliest_year: number | null;
    latest_year: number | null;
    latest_quarter_accession: string | null;
    latest_quarter_period_end: string | null;
    latest_quarter_form: string | null;
    latest_quarter_filed: string | null;
  }[];

  const cached = cachedRows[0];
  // Fast path: the parsed cache is complete AND carries the latest-
  // filing metadata needed by delta alerts + quarterly snapshots. Rows
  // cached before that column existed fall through to re-parse so they
  // can backfill without waiting for TTL expiry.
  if (
    cached &&
    Array.isArray(cached.parsed_annual) &&
    cached.years_available !== null &&
    cached.latest_quarter_accession !== null
  ) {
    return {
      status: "ok",
      cik: raw.cik,
      parsed: {
        years: cached.parsed_annual as ParsedFundamentals["years"],
        parseNotes: cached.parse_notes as ParsedFundamentals["parseNotes"],
        yearsAvailable: cached.years_available,
        earliestYear: cached.earliest_year,
        latestYear: cached.latest_year,
        latestFiling: {
          accession: cached.latest_quarter_accession,
          period_end: cached.latest_quarter_period_end ?? "",
          form: cached.latest_quarter_form ?? "",
          filed: cached.latest_quarter_filed ?? "",
        },
      },
    };
  }

  // Run the parser.
  let parsed: ParsedFundamentals;
  try {
    parsed = parseFundamentals(raw.raw_facts);
  } catch (err) {
    console.error(
      `SEC parse error for ${key}: ${(err as Error).message}`,
    );
    await markParseError(key);
    return { status: "parse_error", cik: raw.cik };
  }

  // Guard: if parsing returned < 3 usable years, consider it a parse error
  // per plan §3.3. Caller falls back to yfinance in Session 3.
  if (parsed.yearsAvailable < 3) {
    await markParseError(key);
    return { status: "parse_error", cik: raw.cik };
  }

  await writeParsed(key, raw.cik, parsed);
  return { status: "ok", cik: raw.cik, parsed };
}

// ---------------------------------------------------------------------------
// Adapter for financial.ts
// ---------------------------------------------------------------------------

// Shape-compatible with yfinance's fetchMultiYearFundamentals. Returns null
// on any SEC path failure (no_cik / fetch_error / parse_error) so the caller
// can fall back to yfinance.
export async function fetchMultiYearFundamentalsSec(
  ticker: string,
): Promise<MultiYearFundamentals | null> {
  const result = await ensureSecFundamentals(ticker);
  if (result.status !== "ok" || !result.parsed) return null;
  // `symbol` reports the ticker the caller asked about (per-share-class
  // accuracy), even though the underlying SEC data is the same business.
  return {
    symbol: ticker.toUpperCase(),
    years: result.parsed.years,
    yearsAvailable: result.parsed.yearsAvailable,
  };
}

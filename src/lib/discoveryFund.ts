// Per-fund detail queries for the Discovery fund page.
//
// Returns the fund meta, its latest filing, and the full holdings list
// (ticker-enriched) ordered by weight_in_fund desc — i.e. highest
// conviction first. Each row carries the user's ticker_state so the
// UI can overlay owned / watchlist / discarded badges.

import { sql } from "@/lib/db";

export type FundMeta = {
  id: number;
  cik: string;
  manager_name: string;
  display_name: string;
  tier: "A" | "B" | "C" | "D" | "E";
  tier_weight: number;
  philosophy: string | null;
  active: boolean;
};

export type FundFilingInfo = {
  id: number;
  accession: string;
  period_of_report: string; // YYYY-MM-DD
  filing_date: string;
  total_value_usd: number;
  holdings_count: number;
  source_url: string | null;
};

// Movement relative to the prior filing. `null` means the fund only
// has one filing on record (no comparison possible).
export type HoldingMovement =
  | "new"
  | "add"
  | "held"
  | "trim"
  | null;

export type FundHolding = {
  ticker: string | null;
  // Canonical ticker for the business (collapses dual-class share pairs).
  // Equal to `ticker` when there's no alias. Used for the "Analizar →"
  // link so both BRK-A and BRK-B rows route to the canonical analysis.
  canonical_ticker: string | null;
  cusip: string;
  issuer_name: string;
  class_title: string | null;
  shares: string; // bigint serialized
  value_usd: number;
  weight_in_fund: number;
  ticker_state: string | null;
  movement: HoldingMovement;
  shares_pct_change: number | null;
};

export type FundDetail = {
  fund: FundMeta;
  filing: FundFilingInfo | null;
  holdings: FundHolding[];
  priorFiling: FundFilingInfo | null;
};

export async function getFundByCik(cik: string): Promise<FundMeta | null> {
  const padded = cik.replace(/^0+/, "").padStart(10, "0");
  const rows = (await sql`
    SELECT id, cik, manager_name, display_name, tier,
           tier_weight::float AS tier_weight, philosophy, active
    FROM discovery_funds
    WHERE cik = ${padded}
    LIMIT 1
  `) as unknown as FundMeta[];
  return rows[0] ?? null;
}

export async function getFundDetail({
  userId,
  cik,
}: {
  userId: string | number;
  cik: string;
}): Promise<FundDetail | null> {
  const fund = await getFundByCik(cik);
  if (!fund) return null;

  const filings = (await sql`
    SELECT id, accession,
           TO_CHAR(period_of_report, 'YYYY-MM-DD') AS period_of_report,
           TO_CHAR(filing_date, 'YYYY-MM-DD') AS filing_date,
           total_value_usd::float AS total_value_usd,
           holdings_count, source_url
    FROM discovery_filings
    WHERE fund_id = ${fund.id}
    ORDER BY period_of_report DESC, id DESC
    LIMIT 2
  `) as unknown as FundFilingInfo[];

  const latestFiling = filings[0] ?? null;
  const priorFiling = filings[1] ?? null;

  if (!latestFiling) {
    return { fund, filing: null, holdings: [], priorFiling: null };
  }

  // Roll up to one row per CUSIP. 13F filers sometimes report the
  // same CUSIP twice (shared vs. sole voting authority). Without
  // this the table shows apparent duplicates. Also joins against the
  // prior filing (when available) to derive the per-position movement
  // indicator the UI shows alongside each row.
  const priorFilingId = priorFiling?.id ?? null;
  const holdings = (await sql`
    WITH latest AS (
      SELECT h.cusip,
             MAX(h.ticker) AS ticker,
             MAX(h.issuer_name) AS issuer_name,
             MAX(h.class_title) AS class_title,
             SUM(h.shares) AS shares,
             SUM(h.value_usd)::float AS value_usd,
             SUM(h.weight_in_fund)::float AS weight_in_fund
      FROM discovery_holdings h
      WHERE h.filing_id = ${latestFiling.id}
      GROUP BY h.cusip
    ),
    prior AS (
      SELECT h.cusip, SUM(h.shares) AS shares
      FROM discovery_holdings h
      WHERE h.filing_id = ${priorFilingId ?? -1}
      GROUP BY h.cusip
    )
    SELECT
      l.ticker,
      COALESCE(ta.canonical_ticker, l.ticker) AS canonical_ticker,
      l.cusip,
      l.issuer_name,
      l.class_title,
      l.shares::text AS shares,
      l.value_usd,
      l.weight_in_fund,
      ts.status AS ticker_state,
      CASE
        WHEN ${priorFilingId}::int IS NULL THEN NULL
        WHEN p.shares IS NULL OR p.shares = 0 THEN 'new'
        WHEN l.shares > p.shares * 1.05 THEN 'add'
        WHEN l.shares < p.shares * 0.95 THEN 'trim'
        ELSE 'held'
      END AS movement,
      CASE
        WHEN p.shares IS NULL OR p.shares = 0 THEN NULL
        ELSE ((l.shares::numeric - p.shares::numeric) / p.shares::numeric * 100)::float
      END AS shares_pct_change
    FROM latest l
    LEFT JOIN prior p ON p.cusip = l.cusip
    LEFT JOIN ticker_aliases ta ON ta.ticker = l.ticker
    -- Per-user state attaches via canonical so a watchlist entry under
    -- either share class shows on both rows (BRK-A and BRK-B).
    LEFT JOIN (
      SELECT DISTINCT ON (COALESCE(ta2.canonical_ticker, ts2.ticker))
        COALESCE(ta2.canonical_ticker, ts2.ticker) AS canonical_ticker,
        ts2.status
      FROM ticker_states ts2
      LEFT JOIN ticker_aliases ta2 ON ta2.ticker = ts2.ticker
      WHERE ts2.user_id = ${userId}
      ORDER BY COALESCE(ta2.canonical_ticker, ts2.ticker), ts2.last_touched_at DESC
    ) ts ON ts.canonical_ticker = COALESCE(ta.canonical_ticker, l.ticker)
    ORDER BY l.weight_in_fund DESC
  `) as unknown as FundHolding[];

  return {
    fund,
    filing: latestFiling,
    holdings,
    priorFiling,
  };
}

// Latest vs. prior filing comparison for a fund. Categories are
// share-count-driven (not weight-driven) because weight moves with
// price even if the manager held the position untouched. The ±5%
// threshold filters out routine stake-price drift and surfaces only
// active manager decisions.
export type MovementCategory = "new" | "exit" | "add" | "trim";

export type Movement = {
  category: MovementCategory;
  cusip: string;
  ticker: string | null;
  issuer_name: string;
  prior_shares: string;
  latest_shares: string;
  prior_weight: number; // percentage 0-100
  latest_weight: number;
  shares_pct_change: number | null; // null when prior_shares = 0
  ticker_state: string | null;
};

export type FundMovements = {
  latestPeriod: string;
  priorPeriod: string;
  newPositions: Movement[];
  exits: Movement[];
  additions: Movement[];
  trims: Movement[];
};

const ACTIVE_CHANGE_THRESHOLD = 0.05; // 5% share-count change

export async function computeFundMovements({
  userId,
  latestFilingId,
  priorFilingId,
  latestPeriod,
  priorPeriod,
}: {
  userId: string | number;
  latestFilingId: number;
  priorFilingId: number;
  latestPeriod: string;
  priorPeriod: string;
}): Promise<FundMovements> {
  const rows = (await sql`
    WITH latest AS (
      -- 13F allows multiple rows for the same CUSIP within one
      -- filing (e.g. shared vs sole voting authority reported
      -- separately). Roll them up so each (filing, cusip) is one
      -- row, otherwise the JOIN below produces duplicate keys.
      SELECT cusip,
             MAX(ticker) AS ticker,
             MAX(issuer_name) AS issuer_name,
             SUM(shares) AS shares,
             SUM(weight_in_fund) AS weight_in_fund
      FROM discovery_holdings
      WHERE filing_id = ${latestFilingId}
      GROUP BY cusip
    ),
    prior AS (
      SELECT cusip,
             MAX(ticker) AS ticker,
             MAX(issuer_name) AS issuer_name,
             SUM(shares) AS shares,
             SUM(weight_in_fund) AS weight_in_fund
      FROM discovery_holdings
      WHERE filing_id = ${priorFilingId}
      GROUP BY cusip
    )
    SELECT
      COALESCE(l.cusip, p.cusip) AS cusip,
      COALESCE(l.ticker, p.ticker) AS ticker,
      COALESCE(l.issuer_name, p.issuer_name) AS issuer_name,
      COALESCE(l.shares::text, '0') AS latest_shares,
      COALESCE(p.shares::text, '0') AS prior_shares,
      COALESCE(l.weight_in_fund::float, 0) AS latest_weight,
      COALESCE(p.weight_in_fund::float, 0) AS prior_weight,
      ts.status AS ticker_state
    FROM latest l
    FULL OUTER JOIN prior p ON p.cusip = l.cusip
    LEFT JOIN ticker_states ts
      ON ts.ticker = COALESCE(l.ticker, p.ticker)
      AND ts.user_id = ${userId}
  `) as unknown as Array<{
    cusip: string;
    ticker: string | null;
    issuer_name: string;
    latest_shares: string;
    prior_shares: string;
    latest_weight: number;
    prior_weight: number;
    ticker_state: string | null;
  }>;

  const newPositions: Movement[] = [];
  const exits: Movement[] = [];
  const additions: Movement[] = [];
  const trims: Movement[] = [];

  for (const r of rows) {
    const latestN = safeBigInt(r.latest_shares);
    const priorN = safeBigInt(r.prior_shares);

    // Ignore rows without actual holdings in either filing (can
    // happen from weird deduplication cases).
    if (latestN === BigInt(0) && priorN === BigInt(0)) continue;

    let pctChange: number | null = null;
    if (priorN > BigInt(0)) {
      pctChange =
        (Number(latestN - priorN) / Number(priorN)) * 100;
    }

    const base: Omit<Movement, "category" | "shares_pct_change"> & {
      shares_pct_change: number | null;
    } = {
      cusip: r.cusip,
      ticker: r.ticker,
      issuer_name: r.issuer_name,
      prior_shares: r.prior_shares,
      latest_shares: r.latest_shares,
      prior_weight: r.prior_weight,
      latest_weight: r.latest_weight,
      shares_pct_change: pctChange,
      ticker_state: r.ticker_state,
    };

    if (priorN === BigInt(0) && latestN > BigInt(0)) {
      newPositions.push({ ...base, category: "new" });
    } else if (priorN > BigInt(0) && latestN === BigInt(0)) {
      exits.push({ ...base, category: "exit" });
    } else if (priorN > BigInt(0) && latestN > BigInt(0)) {
      const rel = Number(latestN - priorN) / Number(priorN);
      if (rel > ACTIVE_CHANGE_THRESHOLD) {
        additions.push({ ...base, category: "add" });
      } else if (rel < -ACTIVE_CHANGE_THRESHOLD) {
        trims.push({ ...base, category: "trim" });
      }
    }
  }

  // Sort each bucket by current weight (biggest positions first
  // within the bucket; for exits, biggest former position first).
  newPositions.sort((a, b) => b.latest_weight - a.latest_weight);
  additions.sort((a, b) => b.latest_weight - a.latest_weight);
  trims.sort((a, b) => b.latest_weight - a.latest_weight);
  exits.sort((a, b) => b.prior_weight - a.prior_weight);

  return {
    latestPeriod,
    priorPeriod,
    newPositions,
    exits,
    additions,
    trims,
  };
}

function safeBigInt(s: string): bigint {
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}

export async function listActiveFundsForNav(): Promise<FundMeta[]> {
  const rows = (await sql`
    SELECT id, cik, manager_name, display_name, tier,
           tier_weight::float AS tier_weight, philosophy, active
    FROM discovery_funds
    WHERE active = TRUE
    ORDER BY tier, display_name
  `) as unknown as FundMeta[];
  return rows;
}

// ─── Per-ticker funds list (used by the position/watchlist Overview) ───

export type FundHoldingTicker = {
  cik: string;
  display_name: string;
  tier: "A" | "B" | "C" | "D" | "E";
  weight_in_fund: number; // 0-100
  value_usd: number;
  // The ticker symbol the fund actually reports the holding under,
  // not the canonical. For BRK-A canonical, a fund holding BRK-B
  // would surface here as actual_ticker='BRK-B' so the UI can show
  // "(via BRK-B)" if useful — kept opaque by default.
  actual_ticker: string;
};

// Returns the curated funds whose latest 13F-HR holds `ticker` (or any
// of its share-class siblings via ticker_aliases). Sorted by tier then
// weight_in_fund desc so the highest-conviction A-tier holders read
// first. Used in the position/watchlist Overview to surface "smart
// money exposure" without requiring the user to drill into Discovery.
export async function listFundsHoldingTicker(
  canonicalTicker: string,
): Promise<FundHoldingTicker[]> {
  const upper = canonicalTicker.toUpperCase();
  const rows = (await sql`
    WITH latest_filing AS (
      SELECT DISTINCT ON (fund_id)
        id, fund_id
      FROM discovery_filings
      ORDER BY fund_id, period_of_report DESC
    ),
    -- Match the holding's ticker (or its canonical) against the target.
    -- A fund holding GOOG should show up when we ask for GOOGL, and
    -- vice versa — match through ticker_aliases. Aggregate by fund so
    -- a fund holding multiple share classes (GOOG + GOOGL, BRK-A +
    -- BRK-B) collapses into a single row with combined weight and value.
    -- string_agg keeps the actual tickers for the "(vía …)" UI label.
    matched AS (
      SELECT
        f.fund_id,
        SUM(h.value_usd)::float AS value_usd,
        SUM(h.weight_in_fund)::float AS weight_in_fund,
        string_agg(DISTINCT h.ticker, '/' ORDER BY h.ticker) AS actual_ticker
      FROM discovery_holdings h
      JOIN latest_filing f ON f.id = h.filing_id
      LEFT JOIN ticker_aliases ta ON ta.ticker = h.ticker
      WHERE h.ticker IS NOT NULL
        AND COALESCE(ta.canonical_ticker, h.ticker) = ${upper}
      GROUP BY f.fund_id
    )
    SELECT
      df.cik,
      df.display_name,
      df.tier,
      m.actual_ticker,
      m.weight_in_fund,
      m.value_usd
    FROM matched m
    JOIN discovery_funds df ON df.id = m.fund_id
    WHERE df.active = TRUE
    ORDER BY df.tier ASC, m.weight_in_fund DESC, df.display_name ASC
  `) as unknown as FundHoldingTicker[];
  return rows;
}

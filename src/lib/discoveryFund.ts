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
  // Weight of this holding in the prior 13F filing. `null` when the
  // holding didn't exist last quarter (movement = 'new') or there's no
  // prior filing on record. Surfaced as a column so the user can
  // compare current vs prior at a glance — even moves below the
  // conviction threshold show up here as raw data.
  prior_weight_in_fund: number | null;
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
      SELECT h.cusip,
             SUM(h.shares) AS shares,
             SUM(h.weight_in_fund)::float AS weight
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
      p.weight AS prior_weight_in_fund,
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
      SELECT DISTINCT ON (COALESCE(ta2.canonical_ticker, we2.ticker))
        COALESCE(ta2.canonical_ticker, we2.ticker) AS canonical_ticker,
        'watchlist'::text AS status
      FROM watchlist_entries we2
      LEFT JOIN ticker_aliases ta2 ON ta2.ticker = we2.ticker
      WHERE we2.user_id = ${userId}
      ORDER BY COALESCE(ta2.canonical_ticker, we2.ticker), we2.last_touched_at DESC
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

// Latest vs. prior filing comparison for a fund. Categories surface only
// genuine conviction shifts (not pure rebalances or passive drift):
//
//   - new     — position didn't exist last quarter, exists now
//   - exit    — position existed, gone now
//   - add     — share count up + weight up + weight movement is material
//   - trim    — share count down + weight down + weight movement is material
//
// Pure rebalances (e.g., the fund holds GOOG at a 10% target and trims
// shares to keep it there as the price runs) and passive drift (the
// fund untouched, weight moves because the rest of the cartera moved)
// are silenced — classified as "rebalance" by the helper and dropped
// before bucketing.
//
// Why this heuristic (vs the old ±5% share-count threshold): looking
// at share count alone surfaces every share trade regardless of whether
// the fund's bet on the business actually changed. The signal that
// matters for a Moatboard user is "did this manager get more or less
// confident in this name relative to the rest of their book?" — and
// that's a weight-delta question, not a share-count one. The "same
// direction" rule + "material weight change" rule are deliberately
// coarse: they filter the obvious noise (perfect rebalances, passive
// drift) but can't disambiguate "rebalance to target" from "small
// genuine conviction add" without knowing the manager's targets.
// Accepted limit; the noise reduction vs the old model is large.
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

// Weight-delta threshold for "this is a real conviction shift, not a
// rebalance". Absolute pp: ≥2pp move in the position's share of the
// fund. Replaces the prior 20% relative threshold (2026-04-29) which
// produced false positives on small positions — a 1% → 1.3% drift
// (+30% relative) flagged as "add" despite being noise. The 2pp
// absolute filter naturally scales: a 1% position must reach 3% (or
// 0%, surfaced via NEW/EXIT regardless) to count as conviction; a
// 10% position needs to cross 8% or 12%; the GOOGL 16.58% → 15.63%
// rebalance case (-0.95pp) stays silenced. Earlier draft tried 0.5pp
// which was too low for large positions; 2pp is high enough to
// silence target-rebalancing while still surfacing moderate shifts
// like 5% → 3% or 8% → 10%. NEW and EXIT are independent of this
// threshold (driven by share count = 0 in either filing).
const WEIGHT_DELTA_PP_MIN = 2.0;

// Classifier reused by computeFundMovements (UI) and
// generateCrossSignalsForFiling (Inbox). Returns "rebalance" for the
// noise cases so callers can log/skip uniformly.
export function classifyConvictionMovement({
  priorShares,
  latestShares,
  priorWeight,
  latestWeight,
}: {
  priorShares: bigint;
  latestShares: bigint;
  priorWeight: number; // 0-100
  latestWeight: number; // 0-100
}): MovementCategory | "rebalance" | null {
  // Both empty — not a holding in either filing. Skip.
  if (priorShares === BigInt(0) && latestShares === BigInt(0)) return null;

  // Entry / exit are always conviction signals.
  if (priorShares === BigInt(0) && latestShares > BigInt(0)) return "new";
  if (priorShares > BigInt(0) && latestShares === BigInt(0)) return "exit";

  // Both > 0 — measure the active vs passive question.
  const shareDelta = Number(latestShares - priorShares);
  const shareSign = Math.sign(shareDelta);
  const weightDeltaPp = latestWeight - priorWeight;
  const weightSign = Math.sign(weightDeltaPp);

  // Direction guard: shares and weight must move the same way. Opposite
  // signs (e.g., trimmed shares but weight rose because the stock
  // outperformed harder than the trim removed) → passive drift, not
  // conviction. Either sign being zero (no share move at all, or
  // perfectly flat weight) → rebalance.
  if (shareSign === 0 || weightSign === 0) return "rebalance";
  if (shareSign !== weightSign) return "rebalance";

  // Magnitude guard: absolute pp change must be at least the threshold.
  // Below it, the move is treated as rebalancing or noise regardless of
  // its relative magnitude on the prior position.
  if (Math.abs(weightDeltaPp) < WEIGHT_DELTA_PP_MIN) return "rebalance";

  return shareSign > 0 ? "add" : "trim";
}

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
      CASE WHEN we.ticker IS NOT NULL THEN 'watchlist' ELSE NULL END AS ticker_state
    FROM latest l
    FULL OUTER JOIN prior p ON p.cusip = l.cusip
    LEFT JOIN watchlist_entries we
      ON we.ticker = COALESCE(l.ticker, p.ticker)
      AND we.user_id = ${userId}
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

    const category = classifyConvictionMovement({
      priorShares: priorN,
      latestShares: latestN,
      priorWeight: r.prior_weight,
      latestWeight: r.latest_weight,
    });
    if (category === null || category === "rebalance") continue;

    let pctChange: number | null = null;
    if (priorN > BigInt(0)) {
      pctChange =
        (Number(latestN - priorN) / Number(priorN)) * 100;
    }

    const movement: Movement = {
      category,
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

    if (category === "new") newPositions.push(movement);
    else if (category === "exit") exits.push(movement);
    else if (category === "add") additions.push(movement);
    else trims.push(movement);
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

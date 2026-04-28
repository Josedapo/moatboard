// Quarter-over-quarter conviction deltas for Discovery.
//
// For each ticker, compute the current conviction score and the prior
// quarter's conviction score (if available), so the UI can surface
// where smart-money concentration is growing vs shrinking, and what
// tickers entered the roster for the first time this quarter.

import { sql } from "@/lib/db";

export type DeltaRow = {
  ticker: string;
  issuer_name: string;
  latest_conviction: number;
  prior_conviction: number;
  delta: number;
  latest_n_funds: number;
  prior_n_funds: number;
  ticker_state: string | null;
};

export type NewEntrant = {
  ticker: string;
  issuer_name: string;
  n_funds: number;
  conviction: number;
  tier_a_funds: number;
  tier_b_funds: number;
  fund_names: string[];
  ticker_state: string | null;
};

export type DeltaWindow = {
  latestQuarter: string | null;
  priorQuarter: string | null;
  deltas: DeltaRow[];
  newEntrants: NewEntrant[];
};

// The two most-recent distinct filing quarters observed across all
// funds. Used to frame the delta window displayed in the UI.
async function resolveDeltaQuarters(): Promise<{
  latest: string | null;
  prior: string | null;
}> {
  const rows = (await sql`
    SELECT DISTINCT TO_CHAR(period_of_report, 'YYYY-MM-DD') AS q
    FROM discovery_filings
    ORDER BY q DESC
    LIMIT 2
  `) as unknown as { q: string }[];
  return {
    latest: rows[0]?.q ?? null,
    prior: rows[1]?.q ?? null,
  };
}

// Returns a single object containing both delta list and new-entrants
// list, plus the window framing. Latest/prior are whatever the two
// most-recent filing quarters are across the roster — not every fund
// may file on the same calendar boundary (Cantillon tends to lag).
export async function computeDeltaWindow(
  userId: string | number,
): Promise<DeltaWindow> {
  const { latest, prior } = await resolveDeltaQuarters();
  if (!latest || !prior) {
    return { latestQuarter: latest, priorQuarter: prior, deltas: [], newEntrants: [] };
  }

  // Per-ticker aggregate score for a given quarter anchor. A fund
  // contributes its latest filing whose period_of_report is <=
  // quarterAnchor — this tolerates funds that filed Q3 but not yet
  // Q4 (still shows their Q3 view in the Q4 picture).
  const deltas = (await sql`
    WITH latest_per_fund AS (
      SELECT DISTINCT ON (fund_id)
        id, fund_id, period_of_report
      FROM discovery_filings
      WHERE period_of_report <= ${latest}::date
      ORDER BY fund_id, period_of_report DESC
    ),
    prior_per_fund AS (
      SELECT DISTINCT ON (fund_id)
        id, fund_id, period_of_report
      FROM discovery_filings
      WHERE period_of_report <= ${prior}::date
      ORDER BY fund_id, period_of_report DESC
    ),
    latest_agg AS (
      -- Canonicalize at the holding level so dual-class share pairs
      -- (GOOG/GOOGL, BRK-A/BRK-B) collapse into one business row.
      -- Otherwise the delta would split conviction across the two
      -- share classes and obscure the real per-business movement.
      SELECT
        COALESCE(ta.canonical_ticker, h.ticker) AS ticker,
        MAX(h.issuer_name) AS issuer_name,
        SUM(df.tier_weight * h.weight_in_fund)::float AS conviction,
        COUNT(DISTINCT f.fund_id)::int AS n_funds
      FROM discovery_holdings h
      JOIN latest_per_fund f ON f.id = h.filing_id
      JOIN discovery_funds df ON df.id = f.fund_id
      LEFT JOIN ticker_aliases ta ON ta.ticker = h.ticker
      WHERE h.ticker IS NOT NULL AND df.active = TRUE
      GROUP BY COALESCE(ta.canonical_ticker, h.ticker)
    ),
    prior_agg AS (
      SELECT
        COALESCE(ta.canonical_ticker, h.ticker) AS ticker,
        SUM(df.tier_weight * h.weight_in_fund)::float AS conviction,
        COUNT(DISTINCT f.fund_id)::int AS n_funds
      FROM discovery_holdings h
      JOIN prior_per_fund f ON f.id = h.filing_id
      JOIN discovery_funds df ON df.id = f.fund_id
      LEFT JOIN ticker_aliases ta ON ta.ticker = h.ticker
      WHERE h.ticker IS NOT NULL AND df.active = TRUE
      GROUP BY COALESCE(ta.canonical_ticker, h.ticker)
    )
    SELECT
      COALESCE(la.ticker, pa.ticker) AS ticker,
      la.issuer_name AS issuer_name,
      COALESCE(la.conviction, 0)::float AS latest_conviction,
      COALESCE(pa.conviction, 0)::float AS prior_conviction,
      (COALESCE(la.conviction, 0) - COALESCE(pa.conviction, 0))::float AS delta,
      COALESCE(la.n_funds, 0)::int AS latest_n_funds,
      COALESCE(pa.n_funds, 0)::int AS prior_n_funds,
      ts.status AS ticker_state
    FROM latest_agg la
    FULL OUTER JOIN prior_agg pa ON pa.ticker = la.ticker
    -- Per-user watchlist overlay, canonicalized so a star under either
    -- share class attaches to the canonical delta row.
    LEFT JOIN (
      SELECT DISTINCT ON (COALESCE(ta.canonical_ticker, we2.ticker))
        COALESCE(ta.canonical_ticker, we2.ticker) AS canonical_ticker,
        'watchlist'::text AS status
      FROM watchlist_entries we2
      LEFT JOIN ticker_aliases ta ON ta.ticker = we2.ticker
      WHERE we2.user_id = ${userId}
      ORDER BY COALESCE(ta.canonical_ticker, we2.ticker), we2.last_touched_at DESC
    ) ts ON ts.canonical_ticker = COALESCE(la.ticker, pa.ticker)
    WHERE COALESCE(la.conviction, 0) > 0 OR COALESCE(pa.conviction, 0) > 0
    ORDER BY delta DESC
  `) as unknown as DeltaRow[];

  // New entrants: tickers with >=5 funds in the latest quarter that
  // didn't exist in the prior quarter at all. Joined against funds
  // again so we can surface which names back the entry.
  const newEntrants = (await sql`
    WITH latest_per_fund AS (
      SELECT DISTINCT ON (fund_id)
        id, fund_id
      FROM discovery_filings
      WHERE period_of_report <= ${latest}::date
      ORDER BY fund_id, period_of_report DESC
    ),
    prior_per_fund AS (
      SELECT DISTINCT ON (fund_id)
        id, fund_id
      FROM discovery_filings
      WHERE period_of_report <= ${prior}::date
      ORDER BY fund_id, period_of_report DESC
    ),
    -- latest_set / prior_set are canonical-ticker sets so dual-class
    -- pairs count as one business. Without this, GOOG entering with 3
    -- funds + GOOGL entering with 4 funds would each fall under the
    -- HAVING ≥5 threshold and the entrant would never surface.
    latest_set AS (
      SELECT DISTINCT COALESCE(ta.canonical_ticker, h.ticker) AS ticker
      FROM discovery_holdings h
      JOIN latest_per_fund f ON f.id = h.filing_id
      LEFT JOIN ticker_aliases ta ON ta.ticker = h.ticker
      WHERE h.ticker IS NOT NULL
    ),
    prior_set AS (
      SELECT DISTINCT COALESCE(ta.canonical_ticker, h.ticker) AS ticker
      FROM discovery_holdings h
      JOIN prior_per_fund f ON f.id = h.filing_id
      LEFT JOIN ticker_aliases ta ON ta.ticker = h.ticker
      WHERE h.ticker IS NOT NULL
    ),
    entrants AS (
      SELECT ls.ticker
      FROM latest_set ls
      LEFT JOIN prior_set ps ON ps.ticker = ls.ticker
      WHERE ps.ticker IS NULL
    ),
    -- Pre-canonicalize holdings before aggregation so the outer query
    -- groups on a single column (canonical) instead of a COALESCE
    -- expression. The earlier shape used COALESCE in both the GROUP BY
    -- and the issuer_name subquery, which Postgres rejects with
    -- "subquery uses ungrouped column from outer query" because the
    -- two component columns are not in the GROUP BY.
    holdings_canonical AS (
      SELECT
        COALESCE(ta.canonical_ticker, h.ticker) AS canonical,
        h.issuer_name,
        h.weight_in_fund,
        h.filing_id,
        f.fund_id,
        df.tier,
        df.tier_weight,
        df.display_name,
        df.active
      FROM discovery_holdings h
      JOIN latest_per_fund f ON f.id = h.filing_id
      JOIN discovery_funds df ON df.id = f.fund_id
      LEFT JOIN ticker_aliases ta ON ta.ticker = h.ticker
      WHERE h.ticker IS NOT NULL AND df.active = TRUE
    )
    SELECT
      hc.canonical AS ticker,
      MAX(hc.issuer_name) AS issuer_name,
      COUNT(DISTINCT hc.fund_id)::int AS n_funds,
      SUM(hc.tier_weight * hc.weight_in_fund)::float AS conviction,
      COUNT(DISTINCT hc.fund_id) FILTER (WHERE hc.tier = 'A')::int AS tier_a_funds,
      COUNT(DISTINCT hc.fund_id) FILTER (WHERE hc.tier = 'B')::int AS tier_b_funds,
      ARRAY_AGG(DISTINCT hc.display_name ORDER BY hc.display_name) AS fund_names,
      ts.status AS ticker_state
    FROM holdings_canonical hc
    LEFT JOIN (
      SELECT DISTINCT ON (COALESCE(ta.canonical_ticker, we2.ticker))
        COALESCE(ta.canonical_ticker, we2.ticker) AS canonical_ticker,
        'watchlist'::text AS status
      FROM watchlist_entries we2
      LEFT JOIN ticker_aliases ta ON ta.ticker = we2.ticker
      WHERE we2.user_id = ${userId}
      ORDER BY COALESCE(ta.canonical_ticker, we2.ticker), we2.last_touched_at DESC
    ) ts ON ts.canonical_ticker = hc.canonical
    WHERE hc.canonical IN (SELECT ticker FROM entrants)
    GROUP BY hc.canonical, ts.status
    HAVING COUNT(DISTINCT hc.fund_id) >= 5
    ORDER BY conviction DESC
  `) as unknown as NewEntrant[];

  return {
    latestQuarter: latest,
    priorQuarter: prior,
    deltas,
    newEntrants,
  };
}

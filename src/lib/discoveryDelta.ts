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
      SELECT
        h.ticker,
        h.issuer_name,
        SUM(df.tier_weight * h.weight_in_fund)::float AS conviction,
        COUNT(DISTINCT f.fund_id)::int AS n_funds
      FROM discovery_holdings h
      JOIN latest_per_fund f ON f.id = h.filing_id
      JOIN discovery_funds df ON df.id = f.fund_id
      WHERE h.ticker IS NOT NULL AND df.active = TRUE
      GROUP BY h.ticker, h.issuer_name
    ),
    prior_agg AS (
      SELECT
        h.ticker,
        SUM(df.tier_weight * h.weight_in_fund)::float AS conviction,
        COUNT(DISTINCT f.fund_id)::int AS n_funds
      FROM discovery_holdings h
      JOIN prior_per_fund f ON f.id = h.filing_id
      JOIN discovery_funds df ON df.id = f.fund_id
      WHERE h.ticker IS NOT NULL AND df.active = TRUE
      GROUP BY h.ticker
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
    LEFT JOIN ticker_states ts ON ts.ticker = COALESCE(la.ticker, pa.ticker)
      AND ts.user_id = ${userId}
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
    latest_set AS (
      SELECT DISTINCT h.ticker
      FROM discovery_holdings h
      JOIN latest_per_fund f ON f.id = h.filing_id
      WHERE h.ticker IS NOT NULL
    ),
    prior_set AS (
      SELECT DISTINCT h.ticker
      FROM discovery_holdings h
      JOIN prior_per_fund f ON f.id = h.filing_id
      WHERE h.ticker IS NOT NULL
    ),
    entrants AS (
      SELECT ls.ticker
      FROM latest_set ls
      LEFT JOIN prior_set ps ON ps.ticker = ls.ticker
      WHERE ps.ticker IS NULL
    )
    SELECT
      h.ticker,
      (SELECT issuer_name FROM discovery_holdings
       WHERE ticker = h.ticker
       GROUP BY issuer_name ORDER BY COUNT(*) DESC LIMIT 1) AS issuer_name,
      COUNT(DISTINCT f.fund_id)::int AS n_funds,
      SUM(df.tier_weight * h.weight_in_fund)::float AS conviction,
      COUNT(DISTINCT f.fund_id) FILTER (WHERE df.tier = 'A')::int AS tier_a_funds,
      COUNT(DISTINCT f.fund_id) FILTER (WHERE df.tier = 'B')::int AS tier_b_funds,
      ARRAY_AGG(DISTINCT df.display_name ORDER BY df.display_name) AS fund_names,
      ts.status AS ticker_state
    FROM discovery_holdings h
    JOIN latest_per_fund f ON f.id = h.filing_id
    JOIN discovery_funds df ON df.id = f.fund_id
    LEFT JOIN ticker_states ts ON ts.ticker = h.ticker AND ts.user_id = ${userId}
    WHERE h.ticker IN (SELECT ticker FROM entrants)
      AND df.active = TRUE
    GROUP BY h.ticker, ts.status
    HAVING COUNT(DISTINCT f.fund_id) >= 5
    ORDER BY conviction DESC
  `) as unknown as NewEntrant[];

  return {
    latestQuarter: latest,
    priorQuarter: prior,
    deltas,
    newEntrants,
  };
}

// Server-side aggregation for the Discovery leaderboard.
//
// Computes the per-ticker conviction score by joining the latest
// filing per fund with its holdings, then summing tier_weight ×
// weight_in_fund across all funds that hold the ticker. This is the
// core scoring formula from the Discovery research: quality-aligned
// managers (Tier A, weight 3.0) outweigh growth hedges (Tier E, 0.5).

import { sql } from "@/lib/db";

export type FundInPosition = {
  display_name: string;
  tier: "A" | "B" | "C" | "D" | "E";
  weight_in_fund: number; // percentage 0-100
};

export type LeaderboardRow = {
  ticker: string;
  issuer_name: string;
  n_funds: number;
  tier_a_funds: number;
  tier_b_funds: number;
  tier_c_funds: number;
  tier_d_funds: number;
  tier_e_funds: number;
  conviction_score: number;
  total_value_usd: number;
  fund_breakdown: FundInPosition[];
  ticker_state: string | null; // in_portfolio / watchlist / discarded / outside_circle / null
};

export type LeaderboardMeta = {
  latestQuarter: string | null; // YYYY-MM-DD
  fundsCovered: number;
  tickersResolved: number;
  tickersUnresolved: number;
};

// For each fund, pick only the most recent filing (the leaderboard
// represents "current" conviction, not cumulative history). Then
// aggregate by ticker.
export async function computeLeaderboard(
  userId: string | number,
): Promise<{ rows: LeaderboardRow[]; meta: LeaderboardMeta }> {
  const rows = (await sql`
    WITH latest_filing AS (
      SELECT DISTINCT ON (fund_id)
        id, fund_id, period_of_report
      FROM discovery_filings
      ORDER BY fund_id, period_of_report DESC
    ),
    fund_holdings AS (
      SELECT
        h.ticker,
        h.issuer_name,
        f.fund_id,
        df.tier,
        df.tier_weight::float AS tier_weight,
        df.display_name,
        h.value_usd::float AS value_usd,
        h.weight_in_fund::float AS weight_in_fund
      FROM discovery_holdings h
      JOIN latest_filing f ON f.id = h.filing_id
      JOIN discovery_funds df ON df.id = f.fund_id
      WHERE h.ticker IS NOT NULL AND df.active = TRUE
    )
    SELECT
      fh.ticker,
      -- Use the modal issuer_name (tie-broken by first) — different
      -- filers sometimes spell company names differently.
      (SELECT issuer_name FROM fund_holdings
       WHERE ticker = fh.ticker
       GROUP BY issuer_name ORDER BY COUNT(*) DESC LIMIT 1) AS issuer_name,
      COUNT(DISTINCT fh.fund_id)::int AS n_funds,
      COUNT(DISTINCT fh.fund_id) FILTER (WHERE fh.tier = 'A')::int AS tier_a_funds,
      COUNT(DISTINCT fh.fund_id) FILTER (WHERE fh.tier = 'B')::int AS tier_b_funds,
      COUNT(DISTINCT fh.fund_id) FILTER (WHERE fh.tier = 'C')::int AS tier_c_funds,
      COUNT(DISTINCT fh.fund_id) FILTER (WHERE fh.tier = 'D')::int AS tier_d_funds,
      COUNT(DISTINCT fh.fund_id) FILTER (WHERE fh.tier = 'E')::int AS tier_e_funds,
      ROUND(SUM(fh.tier_weight * fh.weight_in_fund)::numeric, 2)::float AS conviction_score,
      SUM(fh.value_usd)::float AS total_value_usd,
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'display_name', fh.display_name,
          'tier', fh.tier,
          'weight_in_fund', fh.weight_in_fund
        ) ORDER BY fh.tier, fh.display_name
      ) AS fund_breakdown,
      ts.status AS ticker_state
    FROM fund_holdings fh
    LEFT JOIN ticker_states ts ON ts.ticker = fh.ticker AND ts.user_id = ${userId}
    GROUP BY fh.ticker, ts.status
    ORDER BY conviction_score DESC
  `) as unknown as LeaderboardRow[];

  const metaRows = (await sql`
    SELECT
      (SELECT TO_CHAR(MAX(period_of_report), 'YYYY-MM-DD')
         FROM discovery_filings) AS latest_quarter,
      (SELECT COUNT(DISTINCT fund_id) FROM discovery_filings) AS funds_covered,
      (SELECT COUNT(*) FROM discovery_holdings WHERE ticker IS NOT NULL) AS resolved,
      (SELECT COUNT(*) FROM discovery_holdings WHERE ticker IS NULL) AS unresolved
  `) as unknown as {
    latest_quarter: string | null;
    funds_covered: number;
    resolved: number;
    unresolved: number;
  }[];
  const m = metaRows[0];

  return {
    rows,
    meta: {
      latestQuarter: m.latest_quarter ?? null,
      fundsCovered: Number(m.funds_covered),
      tickersResolved: Number(m.resolved),
      tickersUnresolved: Number(m.unresolved),
    },
  };
}

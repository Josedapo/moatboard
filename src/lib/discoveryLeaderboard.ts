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
  cik: string;
  tier: "A" | "B" | "C" | "D" | "E";
  weight_in_fund: number; // percentage 0-100
};

export type BusinessTier = "exceptional" | "good" | "mediocre" | "poor";

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
  // Populated when the user has already analyzed this ticker and Moatboard
  // has a cached verdict / red flag extraction. Null/zero when unseen.
  business_tier: BusinessTier | null;
  serious_flag_count: number;
  watch_flag_count: number;
};

export type LeaderboardMeta = {
  latestQuarter: string | null; // YYYY-MM-DD
  fundsCovered: number;
  tickersResolved: number;
  tickersUnresolved: number;
};

// For each fund, pick only the most recent filing (the leaderboard
// represents "current" conviction, not cumulative history). Then
// aggregate by canonical ticker — dual-class share pairs (GOOG/GOOGL,
// BRK-A/BRK-B) collapse into one business via ticker_aliases so a fund
// that holds both share classes contributes once with summed weight.
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
    fund_holdings_raw AS (
      -- First roll-up: one row per (fund, canonical_ticker) collapsing
      -- multiple CUSIPs that map to the same actual ticker (legacy
      -- post-split CUSIPs). Canonicalization in the same step folds
      -- share-class siblings into the canonical (GOOG → GOOGL,
      -- BRK-B → BRK-A) so the next CTE treats them as one business.
      SELECT
        COALESCE(ta.canonical_ticker, h.ticker) AS ticker,
        MAX(h.issuer_name) AS issuer_name,
        f.fund_id,
        df.tier,
        df.tier_weight::float AS tier_weight,
        df.display_name,
        df.cik,
        SUM(h.value_usd)::float AS value_usd,
        SUM(h.weight_in_fund)::float AS weight_in_fund
      FROM discovery_holdings h
      JOIN latest_filing f ON f.id = h.filing_id
      JOIN discovery_funds df ON df.id = f.fund_id
      LEFT JOIN ticker_aliases ta ON ta.ticker = h.ticker
      WHERE h.ticker IS NOT NULL AND df.active = TRUE
      GROUP BY COALESCE(ta.canonical_ticker, h.ticker),
               f.fund_id, df.tier, df.tier_weight, df.display_name, df.cik
    ),
    fund_holdings AS (
      -- Second roll-up across share classes: a fund holding both GOOG
      -- and GOOGL contributes one fund_breakdown entry under GOOGL
      -- with summed value/weight, so JSON_AGG below stays dedup-free
      -- and the conviction score reflects the fund's full exposure to
      -- the business, not the sum of both share-class lines (which
      -- would double-count when the SQL later SUMs tier_weight ×
      -- weight_in_fund per fund).
      SELECT
        ticker,
        MAX(issuer_name) AS issuer_name,
        fund_id, tier, tier_weight, display_name, cik,
        SUM(value_usd)::float AS value_usd,
        SUM(weight_in_fund)::float AS weight_in_fund
      FROM fund_holdings_raw
      GROUP BY ticker, fund_id, tier, tier_weight, display_name, cik
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
          'cik', fh.cik,
          'tier', fh.tier,
          'weight_in_fund', fh.weight_in_fund
        ) ORDER BY fh.tier, fh.display_name
      ) AS fund_breakdown,
      ts.status AS ticker_state,
      -- Per-user: the most recent quality verdict this user computed for
      -- this business, across any position (draft or live) of any share
      -- class. Joins via canonical so a GOOG-position analysis surfaces
      -- on the GOOGL row and vice versa. Null when the user hasn't
      -- analyzed the business yet.
      (SELECT ma.tier
         FROM moatboard_analyses ma
         JOIN positions p ON p.id = ma.position_id
         LEFT JOIN ticker_aliases p_ta ON p_ta.ticker = p.ticker
         WHERE p.user_id = ${userId}
           AND COALESCE(p_ta.canonical_ticker, p.ticker) = fh.ticker
         ORDER BY ma.generated_at DESC
         LIMIT 1) AS business_tier,
      -- Per-ticker shared cache, keyed under canonical post-migration
      -- (so fh.ticker matches qualitative_red_flags.ticker directly).
      COALESCE((SELECT COUNT(*)::int
         FROM qualitative_red_flags qrf,
              jsonb_array_elements(qrf.flags) AS f
         WHERE qrf.ticker = fh.ticker
           AND f->>'severity' = 'serious'), 0) AS serious_flag_count,
      COALESCE((SELECT COUNT(*)::int
         FROM qualitative_red_flags qrf,
              jsonb_array_elements(qrf.flags) AS f
         WHERE qrf.ticker = fh.ticker
           AND f->>'severity' = 'watch'), 0) AS watch_flag_count
    FROM fund_holdings fh
    -- Per-user state: canonicalize the user's ticker_states row before
    -- joining so a watchlist/discarded entry under either share class
    -- attaches to the canonical leaderboard row. DISTINCT ON keeps the
    -- most-recent state per canonical in the rare case the user has
    -- entries under both share classes (pre-migration only).
    LEFT JOIN (
      SELECT DISTINCT ON (COALESCE(ta.canonical_ticker, ts2.ticker))
        COALESCE(ta.canonical_ticker, ts2.ticker) AS canonical_ticker,
        ts2.status
      FROM ticker_states ts2
      LEFT JOIN ticker_aliases ta ON ta.ticker = ts2.ticker
      WHERE ts2.user_id = ${userId}
      ORDER BY COALESCE(ta.canonical_ticker, ts2.ticker), ts2.last_touched_at DESC
    ) ts ON ts.canonical_ticker = fh.ticker
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

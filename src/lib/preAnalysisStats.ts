// Aggregate stats over discovery_pre_analyses for the heartbeat
// banner shown above the Discovery leaderboard.

import { sql } from "@/lib/db";

export type PreAnalysisStats = {
  covered: number;
  not_covered: number;
  pending: number;
  errored: number;
  // From the candidate pool (fund_count >= 2 in latest filings) — how
  // many tickers are eligible in principle. Lets the UI show
  // "190/272 covered" so the user knows the agent's universe size.
  candidate_pool: number;
  by_tier: {
    exceptional: number;
    good: number;
    mediocre: number;
    poor: number;
  };
};

export async function getPreAnalysisStats(): Promise<PreAnalysisStats> {
  const [statusRows, tierRows, poolRows] = await Promise.all([
    sql`
      SELECT status, COUNT(*)::int AS n
      FROM discovery_pre_analyses
      GROUP BY status
    ` as unknown as Promise<Array<{ status: string; n: number }>>,
    sql`
      SELECT tier, COUNT(*)::int AS n
      FROM discovery_pre_analyses
      WHERE status = 'covered'
      GROUP BY tier
    ` as unknown as Promise<Array<{ tier: string; n: number }>>,
    sql`
      WITH latest_filing_per_fund AS (
        SELECT DISTINCT ON (fund_id) id, fund_id
        FROM discovery_filings
        ORDER BY fund_id, period_of_report DESC
      )
      SELECT COUNT(*)::int AS n FROM (
        SELECT dh.ticker
        FROM discovery_holdings dh
        JOIN latest_filing_per_fund lfpf ON lfpf.id = dh.filing_id
        JOIN discovery_filings df ON df.id = lfpf.id
        JOIN discovery_funds dfu ON dfu.id = df.fund_id
        WHERE dh.ticker IS NOT NULL AND dfu.active = TRUE
        GROUP BY dh.ticker
        HAVING COUNT(DISTINCT df.fund_id) >= 2
      ) candidates
    ` as unknown as Promise<Array<{ n: number }>>,
  ]);

  const bucket = (s: string) =>
    statusRows.find((r) => r.status === s)?.n ?? 0;
  const tierN = (t: string) => tierRows.find((r) => r.tier === t)?.n ?? 0;

  return {
    covered: bucket("covered"),
    not_covered: bucket("not_covered"),
    pending: bucket("pending"),
    errored: bucket("error"),
    candidate_pool: poolRows[0]?.n ?? 0,
    by_tier: {
      exceptional: tierN("exceptional"),
      good: tierN("good"),
      mediocre: tierN("mediocre"),
      poor: tierN("poor"),
    },
  };
}

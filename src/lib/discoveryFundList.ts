// Aggregate stats per fund for the Discovery funds index page.
//
// Returns: roster meta + latest filing size + top-5 concentration +
// movement count vs prior quarter. Funds with no filing ingested yet
// get null stats but still appear in the list.

import { sql } from "@/lib/db";

export type FundListRow = {
  cik: string;
  manager_name: string;
  display_name: string;
  tier: "A" | "B" | "C" | "D" | "E";
  tier_weight: number;
  philosophy: string | null;
  period_of_report: string | null;
  filing_date: string | null;
  total_value_usd: number | null;
  holdings_count: number | null;
  top5_pct: number | null; // sum of top 5 weights within the fund
  movements_count: number | null; // null when only one filing is on record
};

export async function listFundsWithStats(): Promise<FundListRow[]> {
  const rows = (await sql`
    WITH latest AS (
      SELECT DISTINCT ON (fund_id)
        id, fund_id, period_of_report, filing_date,
        total_value_usd, holdings_count
      FROM discovery_filings
      ORDER BY fund_id, period_of_report DESC
    ),
    prior AS (
      SELECT DISTINCT ON (df.fund_id)
        df.id AS prior_id, df.fund_id
      FROM discovery_filings df
      JOIN latest l
        ON l.fund_id = df.fund_id AND df.period_of_report < l.period_of_report
      ORDER BY df.fund_id, df.period_of_report DESC
    ),
    top5 AS (
      SELECT filing_id, SUM(weight_in_fund)::float AS top5_pct
      FROM (
        SELECT filing_id, weight_in_fund,
               ROW_NUMBER() OVER (
                 PARTITION BY filing_id ORDER BY weight_in_fund DESC
               ) AS rn
        FROM discovery_holdings
      ) ranked
      WHERE rn <= 5
      GROUP BY filing_id
    )
    SELECT
      df.cik,
      df.manager_name,
      df.display_name,
      df.tier,
      df.tier_weight::float AS tier_weight,
      df.philosophy,
      TO_CHAR(l.period_of_report, 'YYYY-MM-DD') AS period_of_report,
      TO_CHAR(l.filing_date, 'YYYY-MM-DD') AS filing_date,
      l.total_value_usd::float AS total_value_usd,
      l.holdings_count,
      t5.top5_pct,
      l.id AS latest_filing_id,
      p.prior_id AS prior_filing_id
    FROM discovery_funds df
    LEFT JOIN latest l ON l.fund_id = df.id
    LEFT JOIN prior p ON p.fund_id = df.id
    LEFT JOIN top5 t5 ON t5.filing_id = l.id
    WHERE df.active = TRUE
    ORDER BY df.tier, df.display_name
  `) as unknown as Array<
    FundListRow & {
      latest_filing_id: number | null;
      prior_filing_id: number | null;
    }
  >;

  // Movements count: one targeted query per fund that has both
  // filings. 31 fund roundtrips is cheap and keeps the main CTE
  // readable; each runs in <50ms against the indexed filings.
  const results: FundListRow[] = [];
  for (const row of rows) {
    const movements_count =
      row.latest_filing_id != null && row.prior_filing_id != null
        ? await countMovements(row.latest_filing_id, row.prior_filing_id)
        : null;
    const { latest_filing_id: _lf, prior_filing_id: _pf, ...rest } = row;
    void _lf;
    void _pf;
    results.push({ ...rest, movements_count });
  }
  return results;
}

async function countMovements(
  latestFilingId: number,
  priorFilingId: number,
): Promise<number> {
  const rows = (await sql`
    WITH curr AS (
      SELECT cusip, SUM(shares) AS shares
      FROM discovery_holdings
      WHERE filing_id = ${latestFilingId}
      GROUP BY cusip
    ),
    prev AS (
      SELECT cusip, SUM(shares) AS shares
      FROM discovery_holdings
      WHERE filing_id = ${priorFilingId}
      GROUP BY cusip
    )
    SELECT COUNT(*)::int AS cnt
    FROM curr
    FULL OUTER JOIN prev ON prev.cusip = curr.cusip
    WHERE
      (COALESCE(prev.shares, 0) = 0 AND COALESCE(curr.shares, 0) > 0)
      OR (COALESCE(prev.shares, 0) > 0 AND COALESCE(curr.shares, 0) = 0)
      OR (prev.shares > 0 AND curr.shares > prev.shares * 1.05)
      OR (prev.shares > 0 AND curr.shares > 0 AND curr.shares < prev.shares * 0.95)
  `) as unknown as { cnt: number }[];
  return rows[0]?.cnt ?? 0;
}

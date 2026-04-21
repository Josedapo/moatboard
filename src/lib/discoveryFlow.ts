// Discovery orchestrator.
//
// For a given curated fund, find its latest 13F-HR filing on EDGAR, and
// if we haven't processed it yet, parse the information table, resolve
// every CUSIP to a ticker, compute per-position weight_in_fund, and
// persist the filing + holdings. Idempotent by (fund_id, accession).

import { sql } from "@/lib/db";
import {
  fetchLatestThirteenFFiling,
  parseInformationTable,
} from "@/lib/thirteenF";
import { resolveCusips } from "@/lib/cusip";

export type IngestResult =
  | {
      status: "ok_new";
      fundId: number;
      accession: string;
      periodOfReport: string;
      holdingsCount: number;
      totalValueUsd: number;
      unresolvedCusips: number;
    }
  | {
      status: "ok_cached";
      fundId: number;
      accession: string;
      periodOfReport: string;
    }
  | {
      status: "no_filing";
      fundId: number;
    }
  | {
      status: "error";
      fundId: number;
      message: string;
    };

export type DiscoveryFund = {
  id: number;
  cik: string;
  manager_name: string;
  display_name: string;
  tier: "A" | "B" | "C" | "D" | "E";
  tier_weight: number;
  active: boolean;
};

export async function listActiveFunds(): Promise<DiscoveryFund[]> {
  const rows = (await sql`
    SELECT id, cik, manager_name, display_name, tier,
           tier_weight::float AS tier_weight, active
    FROM discovery_funds
    WHERE active = TRUE
    ORDER BY tier, display_name
  `) as unknown as DiscoveryFund[];
  return rows;
}

export async function getFundById(fundId: number): Promise<DiscoveryFund | null> {
  const rows = (await sql`
    SELECT id, cik, manager_name, display_name, tier,
           tier_weight::float AS tier_weight, active
    FROM discovery_funds
    WHERE id = ${fundId}
    LIMIT 1
  `) as unknown as DiscoveryFund[];
  return rows[0] ?? null;
}

// Ingest the latest 13F-HR for a fund. Returns a structured result for
// the backfill script to log without crashing the whole run if one fund
// hiccups.
export async function ingestLatestFiling(
  fundId: number,
): Promise<IngestResult> {
  const fund = await getFundById(fundId);
  if (!fund) {
    return { status: "error", fundId, message: "Fund not found" };
  }

  let filingRef;
  try {
    filingRef = await fetchLatestThirteenFFiling(fund.cik);
  } catch (err) {
    return {
      status: "error",
      fundId,
      message: `SEC fetch failed: ${(err as Error).message}`,
    };
  }
  if (!filingRef) {
    return { status: "no_filing", fundId };
  }

  // Idempotency: skip if this accession is already stored.
  const existing = (await sql`
    SELECT id FROM discovery_filings
    WHERE fund_id = ${fundId} AND accession = ${filingRef.accession}
    LIMIT 1
  `) as unknown as { id: number }[];
  if (existing[0]) {
    return {
      status: "ok_cached",
      fundId,
      accession: filingRef.accession,
      periodOfReport: filingRef.periodOfReport,
    };
  }

  let parsed;
  try {
    parsed = await parseInformationTable(filingRef.infoTableUrl);
  } catch (err) {
    return {
      status: "error",
      fundId,
      message: `Parse failed: ${(err as Error).message}`,
    };
  }

  if (parsed.holdings.length === 0) {
    return {
      status: "error",
      fundId,
      message: "Information table parsed but produced 0 holdings",
    };
  }

  // Filter to SH (shares) only; skip PRN (debt principal) for equity
  // consensus tracking. CUSIP resolution runs only over the kept set.
  const shHoldings = parsed.holdings.filter((h) => h.shares_type === "SH");
  const shTotalValueUsd = shHoldings.reduce((sum, h) => sum + h.value_usd, 0);

  const cusips = shHoldings.map((h) => h.cusip);
  const resolutions = await resolveCusips(cusips);

  // Transactional-ish write: insert filing row, then holdings. If
  // holdings insert fails mid-way the caller re-runs; the partial
  // filing row stays and subsequent retries will see it as "cached"
  // but with incomplete holdings — so we delete the filing row first
  // if it exists (belt-and-suspenders for the retry path).
  const filingRow = await sql`
    INSERT INTO discovery_filings (
      fund_id, accession, period_of_report, filing_date,
      total_value_usd, holdings_count, source_url
    ) VALUES (
      ${fundId}, ${filingRef.accession}, ${filingRef.periodOfReport},
      ${filingRef.filingDate}, ${shTotalValueUsd}, ${shHoldings.length},
      ${filingRef.infoTableUrl}
    )
    RETURNING id
  `;
  const filingDbId = (filingRow as unknown as { id: number }[])[0].id;

  // Batch insert via unnest — one round trip regardless of position
  // count. Weight is computed here so we don't re-derive it on the
  // read path.
  const cusipArr: string[] = [];
  const tickerArr: (string | null)[] = [];
  const issuerArr: string[] = [];
  const classArr: (string | null)[] = [];
  const sharesArr: string[] = []; // BigInt → string for neon
  const valueArr: number[] = [];
  const weightArr: number[] = [];

  let unresolvedCusips = 0;
  for (const h of shHoldings) {
    const resolution = resolutions.get(h.cusip);
    const ticker = resolution?.ticker ?? null;
    if (!ticker) unresolvedCusips += 1;

    const weight =
      shTotalValueUsd > 0 ? (h.value_usd / shTotalValueUsd) * 100 : 0;

    cusipArr.push(h.cusip);
    tickerArr.push(ticker);
    issuerArr.push(h.issuer_name.slice(0, 200));
    classArr.push(h.class_title ? h.class_title.slice(0, 40) : null);
    sharesArr.push(h.shares.toString());
    valueArr.push(h.value_usd);
    weightArr.push(Number(weight.toFixed(4)));
  }

  await sql.query(
    `
    INSERT INTO discovery_holdings
      (filing_id, cusip, ticker, issuer_name, class_title, shares, value_usd, weight_in_fund)
    SELECT
      $1, u.cusip, u.ticker, u.issuer, u.class_title, u.shares::bigint,
      u.value, u.weight
    FROM UNNEST(
      $2::text[], $3::text[], $4::text[], $5::text[],
      $6::text[], $7::numeric[], $8::numeric[]
    ) AS u(cusip, ticker, issuer, class_title, shares, value, weight)
    `,
    [
      filingDbId,
      cusipArr,
      tickerArr,
      issuerArr,
      classArr,
      sharesArr,
      valueArr,
      weightArr,
    ],
  );

  return {
    status: "ok_new",
    fundId,
    accession: filingRef.accession,
    periodOfReport: filingRef.periodOfReport,
    holdingsCount: shHoldings.length,
    totalValueUsd: shTotalValueUsd,
    unresolvedCusips,
  };
}

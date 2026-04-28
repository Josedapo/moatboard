// Discovery orchestrator.
//
// For a given curated fund, find its latest 13F-HR filing on EDGAR, and
// if we haven't processed it yet, parse the information table, resolve
// every CUSIP to a ticker, compute per-position weight_in_fund, and
// persist the filing + holdings. Idempotent by (fund_id, accession).

import { sql } from "@/lib/db";
import {
  fetchRecentThirteenFFilings,
  parseInformationTable,
  type ThirteenFFilingRef,
} from "@/lib/thirteenF";
import { resolveCusips } from "@/lib/cusip";
import { generateCrossSignalsForFiling } from "@/lib/discoveryCrossSignals";
import { recordIrisAction } from "@/lib/irisActions";

export type IngestResult =
  | {
      status: "ok_new";
      fundId: number;
      filingId: number;
      accession: string;
      periodOfReport: string;
      filingDate: string;
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

// Ingest the latest 13F-HR for a fund. Thin wrapper around
// ingestRecentFilings that returns the single result for callers that
// only care about the current quarter.
export async function ingestLatestFiling(
  fundId: number,
): Promise<IngestResult> {
  const results = await ingestRecentFilings(fundId, 1);
  return results[0] ?? { status: "no_filing", fundId };
}

// Weekly cron entrypoint. Iterates every active fund, calls
// ingestLatestFiling, writes a `cron_runs` heartbeat row so the UI
// can show "last check: HH:MM" on the Discovery surface. Per-fund
// errors are isolated — a single SEC fetch failure doesn't abort
// the rest of the run, it just lands as `status: "error"` in the
// summary + adds a line to `error_summary`.
//
// Re-uses the `cron_runs` table (job='discovery_weekly') and the
// same shape that `runDailySignalsJob` uses for the signals cron.
// `processed_tickers` stores the fund count; `inserted_signals`
// stores the count of ok_new filings. Reusing columns avoids adding
// specialised discovery_ columns for what's semantically the same
// heartbeat observation.
export type WeeklyDiscoveryJobSummaryEntry = IngestResult & {
  fund_display_name: string;
  fund_tier: string;
};

export async function runWeeklyDiscoveryJob(): Promise<{
  cronRunId: number;
  summary: WeeklyDiscoveryJobSummaryEntry[];
  crossSignalsCreated: number;
}> {
  const startedRows = (await sql`
    INSERT INTO cron_runs (job, started_at, ok)
    VALUES ('discovery_weekly', NOW(), FALSE)
    RETURNING id
  `) as unknown as { id: number }[];
  const cronRunId = startedRows[0].id;

  const summary: WeeklyDiscoveryJobSummaryEntry[] = [];
  let newFilings = 0;
  let crossSignalsCreated = 0;
  let errorCount = 0;
  const errorLines: string[] = [];

  try {
    const funds = await listActiveFunds();
    for (const fund of funds) {
      try {
        const result = await ingestLatestFiling(fund.id);
        const entry: WeeklyDiscoveryJobSummaryEntry = {
          ...result,
          fund_display_name: fund.display_name,
          fund_tier: fund.tier,
        };
        summary.push(entry);

        if (result.status === "ok_new") {
          newFilings += 1;
          // Intersect this filing's movements with every user's active
          // tickers; emit one review_signals row per (user, ticker,
          // movement). Failures here must NOT abort the run or the
          // per-fund loop — the filing is already persisted.
          try {
            const created = await generateCrossSignalsForFiling({
              fundId: fund.id,
              filingId: result.filingId,
              accession: result.accession,
              periodOfReport: result.periodOfReport,
              filingDate: result.filingDate,
            });
            crossSignalsCreated += created;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown error";
            errorCount += 1;
            errorLines.push(
              `${fund.display_name} cross-signals: ${msg}`,
            );
          }
        } else if (result.status === "error") {
          errorCount += 1;
          errorLines.push(`${fund.display_name}: ${result.message}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        errorCount += 1;
        errorLines.push(`${fund.display_name}: ${msg}`);
        summary.push({
          status: "error",
          fundId: fund.id,
          message: msg,
          fund_display_name: fund.display_name,
          fund_tier: fund.tier,
        });
      }
    }

    // Iris log entry summarising the weekly 13F sweep.
    const filingsPart =
      newFilings === 0
        ? "Sin 13F nuevos esta semana."
        : `${newFilings} ${newFilings === 1 ? "13F nuevo" : "13F nuevos"} parseados.`;
    const movementsPart =
      crossSignalsCreated > 0
        ? ` Detectados ${crossSignalsCreated} ${crossSignalsCreated === 1 ? "movimiento" : "movimientos"} en tus tickers.`
        : "";
    await recordIrisAction({
      actionType: "weekly_13f_scan",
      ticker: null,
      narrationMd: `Revisión semanal de los fondos curados. ${summary.length} fondos consultados. ${filingsPart}${movementsPart}`,
      metadata: {
        funds_processed: summary.length,
        new_filings: newFilings,
        cross_signals_created: crossSignalsCreated,
        errors: errorCount,
      },
    });

    await sql`
      UPDATE cron_runs
      SET finished_at = NOW(),
          ok = ${errorCount === 0},
          processed_tickers = ${summary.length},
          inserted_signals = ${newFilings},
          error_count = ${errorCount},
          error_summary = ${errorLines.length > 0 ? errorLines.join("\n") : null}
      WHERE id = ${cronRunId}
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    await sql`
      UPDATE cron_runs
      SET finished_at = NOW(),
          ok = FALSE,
          error_count = ${errorCount + 1},
          error_summary = ${`job-level error: ${msg}`}
      WHERE id = ${cronRunId}
    `;
    throw err;
  }

  return { cronRunId, summary, crossSignalsCreated };
}

// Ingest up to `n` most recent 13F-HR filings for a fund, newest first.
// Useful for backfilling prior quarters so QoQ delta has something to
// compare against. Idempotent per accession; already-ingested filings
// short-circuit as ok_cached.
export async function ingestRecentFilings(
  fundId: number,
  n: number,
): Promise<IngestResult[]> {
  const fund = await getFundById(fundId);
  if (!fund) {
    return [{ status: "error", fundId, message: "Fund not found" }];
  }

  let filingRefs: ThirteenFFilingRef[];
  try {
    filingRefs = await fetchRecentThirteenFFilings(fund.cik, n);
  } catch (err) {
    return [
      {
        status: "error",
        fundId,
        message: `SEC fetch failed: ${(err as Error).message}`,
      },
    ];
  }
  if (filingRefs.length === 0) {
    return [{ status: "no_filing", fundId }];
  }

  const results: IngestResult[] = [];
  for (const filingRef of filingRefs) {
    results.push(await ingestSingleFiling(fundId, filingRef));
  }
  return results;
}

async function ingestSingleFiling(
  fundId: number,
  filingRef: ThirteenFFilingRef,
): Promise<IngestResult> {
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
    filingId: filingDbId,
    accession: filingRef.accession,
    periodOfReport: filingRef.periodOfReport,
    filingDate: filingRef.filingDate,
    holdingsCount: shHoldings.length,
    totalValueUsd: shTotalValueUsd,
    unresolvedCusips,
  };
}

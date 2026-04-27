// Orchestrator for the agentic Discovery pre-tiering job.
//
// Iterates the work items returned by listWorkItems() (covered
// candidates that need first-time analysis or refresh) and produces
// a global Quality + Moat + Red flags pre-tier per ticker.
//
// Per ticker, the pipeline is:
//   1. runAnalysis(ticker) — Quality scorecard + Moat assessment
//      (which now reads the 10-K), produces tier + applicable
//      dimensions + scorecard summary. Cached side effects: writes to
//      moat_assessments + sec_fundamentals_cache.
//   2. Coverage gate check: if scorecard has <5 applicable dimensions,
//      markNotCovered and skip red flags (saves the expensive 10-K
//      Item 1A call). This mirrors the wizard's "Moatboard can't
//      analyze" gate.
//   3. generateRedFlags(ticker) with the Item 1A 10-K extract — counts
//      serious + watch flags. Caches in qualitative_red_flags.
//   4. saveCoveredPreAnalysis with the combined picture.
//
// Concurrency: serial. The orchestrator hits Anthropic (moat + verdict
// prose + red flags ≈ 3 model calls) plus SEC EDGAR per ticker. Going
// parallel risks rate limits at both endpoints and obscures error
// locations. Once dogfooded the cap can be raised. Heartbeat in
// cron_runs under job='discovery_pre_analysis_weekly'.

import { sql } from "@/lib/db";
import { runAnalysis } from "@/lib/analysis";
import { generateRedFlags } from "@/lib/redFlagsAi";
import { prepareRedFlagsFiling } from "@/lib/filingForPrompt";
import { ensureSecFundamentals } from "@/lib/sec";
import {
  listWorkItems,
  saveCoveredPreAnalysis,
  markNotCovered,
  markError,
  type WorkItem,
} from "@/lib/discoveryPreAnalysis";

const MIN_APPLICABLE_DIMENSIONS = 5;

export type PreAnalysisItemResult = {
  ticker: string;
  outcome: "covered" | "not_covered" | "error";
  tier?: string;
  applicableDimensions?: number;
  seriousFlags?: number;
  watchFlags?: number;
  reason?: string;
  errorMessage?: string;
};

export type PreAnalysisJobResult = {
  cronRunId: number;
  total: number;
  covered: number;
  not_covered: number;
  errored: number;
  items: PreAnalysisItemResult[];
};

// Process a single ticker end-to-end. Idempotent at the SQL layer
// (saveCoveredPreAnalysis upserts) so re-running is safe.
export async function processPreAnalysisForTicker(
  ticker: string,
): Promise<PreAnalysisItemResult> {
  try {
    // Quality + Moat. The analysis call internally fetches quote +
    // fundamentals + multi-year + moat (with 10-K filing post-Fase 0).
    const analysis = await runAnalysis(ticker);
    const sc = analysis.scorecard_summary;
    const applicable = sc.strong + sc.acceptable + sc.weak;

    if (applicable < MIN_APPLICABLE_DIMENSIONS) {
      const reason = `<${MIN_APPLICABLE_DIMENSIONS} applicable scorecard dimensions (got ${applicable})`;
      await markNotCovered(ticker, reason);
      return { ticker, outcome: "not_covered", reason };
    }

    // Red flags. We need quote + fundamentals; runAnalysis already
    // fetched them once but they're side-data on the result so we
    // pass them through instead of re-fetching.
    const filing = await prepareRedFlagsFiling(ticker);
    const { flags } = await generateRedFlags(
      ticker,
      analysis.quote,
      analysis.fundamentals,
      filing,
    );
    const seriousCount = flags.filter((f) => f.severity === "serious").length;
    const watchCount = flags.filter((f) => f.severity === "watch").length;

    // Latest 10-K accession from sec_fundamentals_cache (the analysis
    // path already populated/refreshed it). One round-trip — cheap.
    const accessionRow = (await sql`
      SELECT latest_quarter_accession AS accession,
             latest_quarter_period_end AS period_end
      FROM sec_fundamentals_cache
      WHERE ticker = ${ticker.toUpperCase()}
      LIMIT 1
    `) as unknown as Array<{ accession: string | null; period_end: string | null }>;
    const last10kAccession = accessionRow[0]?.accession ?? null;
    const last10kPeriodEnd = accessionRow[0]?.period_end ?? null;

    await saveCoveredPreAnalysis({
      ticker,
      tier: analysis.tier,
      applicableDimensions: applicable,
      scorecardSummary: sc,
      moatStrength: analysis.moat_strength,
      moatArchetype: analysis.moat_archetype,
      hasSeriousRedFlags: seriousCount > 0,
      seriousRedFlagsCount: seriousCount,
      watchRedFlagsCount: watchCount,
      last10kAccession,
      last10kPeriodEnd,
      model: "claude-mixed", // pipeline mixes models per call type
    });

    return {
      ticker,
      outcome: "covered",
      tier: analysis.tier,
      applicableDimensions: applicable,
      seriousFlags: seriousCount,
      watchFlags: watchCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(ticker, msg);
    return { ticker, outcome: "error", errorMessage: msg };
  }
}

// Cron entrypoint. Iterates listWorkItems() and processes each ticker
// serially. Optionally limited via `maxItems` for partial runs (useful
// for backfill scripts that want to chunk the work).
export async function runDiscoveryPreAnalysisJob(
  options: { maxItems?: number } = {},
): Promise<PreAnalysisJobResult> {
  const startedRows = (await sql`
    INSERT INTO cron_runs (job, started_at, ok)
    VALUES ('discovery_pre_analysis_weekly', NOW(), FALSE)
    RETURNING id
  `) as unknown as { id: number }[];
  const cronRunId = startedRows[0].id;

  const items: PreAnalysisItemResult[] = [];
  let covered = 0;
  let notCovered = 0;
  let errored = 0;
  const errorLines: string[] = [];

  try {
    let work: WorkItem[] = await listWorkItems();
    if (options.maxItems !== undefined) {
      work = work.slice(0, options.maxItems);
    }

    for (const w of work) {
      const result = await processPreAnalysisForTicker(w.ticker);
      items.push(result);
      if (result.outcome === "covered") covered++;
      else if (result.outcome === "not_covered") notCovered++;
      else {
        errored++;
        errorLines.push(`${w.ticker}: ${result.errorMessage ?? "unknown"}`);
      }
    }

    await sql`
      UPDATE cron_runs
      SET finished_at = NOW(),
          ok = ${errored === 0},
          processed_tickers = ${items.length},
          inserted_signals = ${covered},
          error_count = ${errored},
          error_summary = ${errorLines.length > 0 ? errorLines.join("\n") : null}
      WHERE id = ${cronRunId}
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    await sql`
      UPDATE cron_runs
      SET finished_at = NOW(),
          ok = FALSE,
          error_count = ${errored + 1},
          error_summary = ${`job-level error: ${msg}`}
      WHERE id = ${cronRunId}
    `;
    throw err;
  }

  return {
    cronRunId,
    total: items.length,
    covered,
    not_covered: notCovered,
    errored,
    items,
  };
}

// Used by the warmup script: ensure SEC fundamentals cache is populated
// for a ticker before the gate query runs. Returns minimal status — the
// underlying ensureSecFundamentals does CIK lookup + raw fetch + parse
// in one call.
export async function warmSecCacheForTicker(ticker: string): Promise<{
  ticker: string;
  status: string;
  yearsAvailable: number | null;
  errored: boolean;
  errorMessage?: string;
}> {
  try {
    const result = await ensureSecFundamentals(ticker);
    return {
      ticker,
      status: result.status,
      yearsAvailable: result.parsed?.yearsAvailable ?? null,
      errored: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ticker,
      status: "fetch_error",
      yearsAvailable: null,
      errored: true,
      errorMessage: msg,
    };
  }
}

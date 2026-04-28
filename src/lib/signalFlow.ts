// Orchestrator for the review-signals pipeline. Composes:
//   sec fetch → classify → idempotent insert
//
// Kept separate from `reviewSignals.ts` (pure CRUD) and `secFilings.ts`
// (pure fetch) so the cron entrypoint is a thin caller and unit tests
// can stub each layer independently.

import { sql } from "@/lib/db";
import { fetchRecentFilings, buildFilingUrl } from "@/lib/secFilings";
import { classifyFiling } from "@/lib/signalClassifier";
import { createSignalIfMissing } from "@/lib/reviewSignals";
import {
  ensureInsiderSignalsForTicker,
  type EnsureInsiderSignalsResult,
} from "@/lib/form4Flow";
import { getPreAnalysis } from "@/lib/discoveryPreAnalysis";
import { processPreAnalysisForTicker } from "@/lib/preAnalysisFlow";
import { recordIrisAction } from "@/lib/irisActions";

export type EnsureSignalsResult = {
  ticker: string;
  scanned: number; // filings fetched + matched form filter
  inserted: number; // new rows created (dedup hits don't count)
  skipped: number; // classified as "not material" (returned null)
  // Accessions of newly-inserted 10-K (annual) signals. The daily job
  // uses this to trigger a shared-cache refresh exactly once per ticker
  // that just published a fresh annual report — the only path that
  // re-runs the IA pipeline (Quality + Moat + Red flags) outside the
  // wizard.
  newTenKAccessions: string[];
  errored: boolean;
  errorMessage?: string;
};

// Pull recent filings for a ticker, classify each, insert the ones that
// warrant a signal. Idempotent by (user, ticker, accession) — safe to
// call any number of times; re-runs won't duplicate rows.
export async function ensureSignalsForTicker({
  userId,
  ticker,
  sinceDays,
}: {
  userId: string | number;
  ticker: string;
  sinceDays?: number;
}): Promise<EnsureSignalsResult> {
  const result: EnsureSignalsResult = {
    ticker,
    scanned: 0,
    inserted: 0,
    skipped: 0,
    newTenKAccessions: [],
    errored: false,
  };

  try {
    const filings = await fetchRecentFilings(ticker, { sinceDays });
    if (filings === null) {
      // No CIK for this ticker — neither an error nor a hit. Could be
      // a foreign listing or a ticker renamed after SEC map refresh.
      return result;
    }

    result.scanned = filings.length;

    for (const filing of filings) {
      const classified = classifyFiling({
        form: filing.form,
        items: filing.items,
      });
      if (!classified) {
        result.skipped++;
        continue;
      }

      const inserted = await createSignalIfMissing({
        userId,
        ticker,
        source: classified.source,
        eventType: classified.eventType,
        eventDate: filing.filingDate,
        sourceRef: filing.accession,
        sourceUrl: buildFilingUrl(filing),
        severity: classified.severity,
        rawPayload: {
          form: filing.form,
          items: filing.items,
          primaryDocument: filing.primaryDocument,
        },
        deduplicationKey: filing.accession,
      });

      if (inserted) {
        result.inserted++;
        // Track only fresh annual filings — amendments (10-K/A) don't
        // trigger the IA pipeline since they touch the same fiscal year
        // already processed.
        if (filing.form === "10-K") {
          result.newTenKAccessions.push(filing.accession);
        }
      }
    }
  } catch (err) {
    result.errored = true;
    result.errorMessage =
      err instanceof Error ? err.message : "unknown error";
  }

  return result;
}

// Resolve the set of tickers the user cares about — live portfolio
// (positions with net shares > 0) ∪ watchlist. Discarded tickers are
// deliberately excluded per the agent recommendation: if the user wants
// to resurrect a discarded ticker, opening it manually is the trigger,
// not a passive alert feed.
export async function listActiveTickersForUser(
  userId: string | number,
): Promise<string[]> {
  const rows = (await sql`
    SELECT DISTINCT ticker FROM (
      SELECT p.ticker
      FROM positions p
      WHERE p.user_id = ${userId}
        AND COALESCE((
          SELECT SUM(
            CASE WHEN t.type IN ('buy', 'add') THEN t.shares ELSE -t.shares END
          )
          FROM position_transactions t
          WHERE t.position_id = p.id
        ), 0) > 0
      UNION ALL
      SELECT we.ticker
      FROM watchlist_entries we
      WHERE we.user_id = ${userId}
    ) AS all_active
    ORDER BY ticker
  `) as unknown as { ticker: string }[];
  return rows.map((r) => r.ticker);
}

// Iterate all active tickers for every user in the DB and run the
// signals pipeline. Records one `cron_runs` row with aggregate counts
// and error summary so the UI can show a heartbeat.
//
// Errors are per-ticker isolated — a single ticker failing doesn't abort
// the whole run. The summary aggregates error messages so the next
// human touch has context.
export async function runDailySignalsJob(): Promise<{
  cronRunId: number;
  summary: EnsureSignalsResult[];
  insiderSummary: EnsureInsiderSignalsResult[];
}> {
  const startedRows = (await sql`
    INSERT INTO cron_runs (job, started_at, ok)
    VALUES ('signals_daily', NOW(), FALSE)
    RETURNING id
  `) as unknown as { id: number }[];
  const cronRunId = startedRows[0].id;

  const summary: EnsureSignalsResult[] = [];
  const insiderSummary: EnsureInsiderSignalsResult[] = [];
  let totalInserted = 0;
  let insiderSignalsInserted = 0;
  let errorCount = 0;
  const errorLines: string[] = [];

  try {
    // For every user (today: just Joseda), iterate active tickers.
    // Keeping this user-by-user instead of one big ticker UNION is
    // cheaper operationally: a per-user error is isolated and errors
    // remain attributable in the summary.
    const users = (await sql`
      SELECT id FROM users ORDER BY id
    `) as unknown as { id: number }[];

    const processedTickers = new Set<string>();
    // Tickers that had a brand-new 10-K appear today (across any user).
    // Used after the user loop to refresh the shared per-ticker analysis
    // exactly once per ticker — IA cost amortized across users.
    const tickersWithNewTenK = new Set<string>();

    for (const u of users) {
      const tickers = await listActiveTickersForUser(u.id);
      for (const ticker of tickers) {
        processedTickers.add(ticker);
        const r = await ensureSignalsForTicker({ userId: u.id, ticker });
        summary.push(r);
        totalInserted += r.inserted;
        if (r.newTenKAccessions.length > 0) {
          tickersWithNewTenK.add(ticker);
        }
        if (r.errored) {
          errorCount++;
          errorLines.push(`${ticker}: ${r.errorMessage ?? "unknown"}`);
        }

        // Form 4 insider purchases — same ticker, same user, separate
        // pipeline. Runs in-line so a failure on one path doesn't
        // mask the other: each reports its own errored flag.
        const ins = await ensureInsiderSignalsForTicker({
          userId: u.id,
          ticker,
        });
        insiderSummary.push(ins);
        insiderSignalsInserted += ins.signalsInserted;
        if (ins.errored) {
          errorCount++;
          errorLines.push(
            `${ticker} (form4): ${ins.errorMessage ?? "unknown"}`,
          );
        }
      }
    }

    // After the per-user loop, refresh the shared per-ticker analysis
    // for any ticker that has a row in discovery_pre_analyses AND
    // reported a new 10-K today. Skips tickers no user has analyzed
    // yet (no row in the shared cache to refresh — first analysis will
    // happen when a user walks them through the wizard manually).
    // Per-ticker error isolated; IA cost is contained to "tickers with
    // a new 10-K AND existing shared row" ≈ 1 per ticker per year.
    for (const ticker of tickersWithNewTenK) {
      try {
        const existing = await getPreAnalysis(ticker);
        if (!existing) continue;
        const refreshed = await processPreAnalysisForTicker(ticker);
        if (refreshed.outcome === "error") {
          errorCount++;
          errorLines.push(
            `${ticker} (10-K refresh): ${refreshed.errorMessage ?? "unknown"}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        errorCount++;
        errorLines.push(`${ticker} (10-K refresh): ${msg}`);
      }
    }

    // Iris log entry for the full daily scan. Single row that
    // summarises the whole run; per-ticker filing rows go in via
    // ensureSignalsForTicker below in a future hook (kept light for v1).
    const newFilingsTotal = totalInserted + insiderSignalsInserted;
    const filingsPart =
      newFilingsTotal === 0
        ? "Sin novedades."
        : `Detectados ${newFilingsTotal} ${newFilingsTotal === 1 ? "filing nuevo" : "filings nuevos"}.`;
    await recordIrisAction({
      actionType: "daily_sec_scan",
      ticker: null,
      narrationMd: `Escaneo diario de SEC EDGAR. ${processedTickers.size} ${processedTickers.size === 1 ? "ticker" : "tickers"} revisados. ${filingsPart}`,
      metadata: {
        processed_tickers: processedTickers.size,
        new_signals: totalInserted,
        new_insider_signals: insiderSignalsInserted,
        tickers_with_new_10k: tickersWithNewTenK.size,
        errors: errorCount,
      },
    });

    await sql`
      UPDATE cron_runs
      SET finished_at = NOW(),
          ok = ${errorCount === 0},
          processed_tickers = ${processedTickers.size},
          inserted_signals = ${totalInserted + insiderSignalsInserted},
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

  return { cronRunId, summary, insiderSummary };
}

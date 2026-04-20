// Daily cron: scans SEC EDGAR for new 10-Q / 10-K / 8-K filings across
// every active ticker (portfolio + watchlist) of every user and inserts
// rows into `review_signals` for the ones that match the deterministic
// Item-code filter in `signalClassifier.ts`.
//
// Triggered by Vercel Cron per `vercel.json` ("0 7 * * *" UTC). Also
// callable manually with `Authorization: Bearer <CRON_SECRET>` for
// dogfood / debugging.
//
// The job writes a `cron_runs` heartbeat row (started_at → finished_at +
// ok flag + error summary) so the UI can show "last check: HH:MM" and
// warn when the pipeline hasn't run in >36h. Without this, an empty
// inbox would lie when the cron silently fails — the reviewer's
// explicit call-out in the Phase 6 planning.

import { NextResponse } from "next/server";
import { runDailySignalsJob } from "@/lib/signalFlow";
import { expireOldSignals } from "@/lib/reviewSignals";

// Node runtime: needs Neon pool + SEC fetch without edge latency.
export const runtime = "nodejs";

// Never cache the result — this endpoint mutates DB state every call.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. The secret
  // is set in Vercel project settings; when absent locally the endpoint
  // is open so `curl localhost:3000/api/cron/signals` works for dogfood
  // (dev-only comfort, matches how the rest of the app treats missing
  // secrets in .env.local).
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { cronRunId, summary } = await runDailySignalsJob();
    const expired = await expireOldSignals(90);

    return NextResponse.json({
      ok: true,
      cronRunId,
      tickersProcessed: summary.length,
      newSignals: summary.reduce((acc, s) => acc + s.inserted, 0),
      errors: summary.filter((s) => s.errored).length,
      expiredThisRun: expired,
      // Per-ticker breakdown kept so a manual hit surfaces what was
      // touched. In production the cron_runs row is the durable record.
      perTicker: summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("Daily signals cron failed:", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}

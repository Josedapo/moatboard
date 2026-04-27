// Weekly cron: agentic Discovery pre-tiering. For every covered
// candidate (≥5y SEC fundamentals AND held by ≥2 active funds) that
// has no pre-analysis yet, has a newer 10-K than the cached one, or
// crossed the defensive 30-day TTL, runs:
//
//   Quality + Moat (10-K-grounded) + Red flags
//
// Persists tier + serious-flags signal in `discovery_pre_analyses`.
//
// Triggered by Vercel Cron per `vercel.json` ("0 8 * * 2" UTC, Tuesday
// morning — staggered an hour after the daily signals cron and a day
// after the weekly Discovery 13F refresh, so the candidate pool is
// already current). Also callable manually with `Authorization: Bearer
// <CRON_SECRET>` for dogfood / debugging.

import { NextResponse } from "next/server";
import { runDiscoveryPreAnalysisJob } from "@/lib/preAnalysisFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pre-analysis runs many model calls + SEC fetches; allow a generous
// upper bound. Vercel Hobby caps at 60s, Pro at 300s. The job's serial
// loop will exit cleanly if the platform aborts mid-run — partial
// progress is persisted per ticker.
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Optional ?max=N query param for partial runs (e.g. when poking the
  // cron from staging without burning the whole queue). Defaults to
  // unbounded.
  const url = new URL(request.url);
  const maxParam = url.searchParams.get("max");
  const maxItems =
    maxParam && Number.isFinite(Number(maxParam))
      ? Number(maxParam)
      : undefined;

  try {
    const result = await runDiscoveryPreAnalysisJob({ maxItems });
    return NextResponse.json({
      ok: true,
      cronRunId: result.cronRunId,
      total: result.total,
      covered: result.covered,
      not_covered: result.not_covered,
      errored: result.errored,
      items: result.items,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("Weekly pre-analysis cron failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Weekly cron: scans SEC EDGAR for the latest 13F-HR across every
// active curated fund in `discovery_funds` and, when a new accession
// appears, ingests its information table into `discovery_holdings`.
//
// Triggered by Vercel Cron per `vercel.json` ("0 7 * * 1" UTC, Monday
// mornings). Also callable manually with `Authorization: Bearer
// <CRON_SECRET>` for dogfood / debugging.
//
// Mirrors the daily signals cron at `/api/cron/signals` — same auth,
// same heartbeat pattern (`cron_runs` row per invocation), same
// error isolation per fund so one SEC hiccup doesn't abort the run.

import { NextResponse } from "next/server";
import { runWeeklyDiscoveryJob } from "@/lib/discoveryFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { cronRunId, summary, crossSignalsCreated } =
      await runWeeklyDiscoveryJob();
    const newFilings = summary.filter((s) => s.status === "ok_new").length;
    const cachedFilings = summary.filter((s) => s.status === "ok_cached").length;
    const errors = summary.filter((s) => s.status === "error").length;

    return NextResponse.json({
      ok: true,
      cronRunId,
      fundsProcessed: summary.length,
      newFilings,
      cachedFilings,
      crossSignalsCreated,
      errors,
      perFund: summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("Weekly discovery cron failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

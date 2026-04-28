// Iris's narrative action log. The user-facing chronicle of what the
// system has been doing — what cron_runs is to ops, this is to product.
//
// Voice convention: editorial-natural Spanish, third-person from
// Moatboard's perspective (NOT Iris speaking in first person — that
// turns cursi at scale). Short, factual, plain language.
//
// Examples:
//   "Detectado 10-K nuevo de MSFT — calidad refrescada y red flags actualizadas."
//   "Trimestral de KNSL: nuevos números aplicados al scorecard."
//   "Escaneo diario · 0 filings nuevos en los 12 tickers de tu cartera."
//
// Filter convention: when a userId is provided, the log filters to
// rows where the action's ticker matches a position the user owns
// (live, draft, closed, watchlist, discarded — any of them via
// COALESCE(ta.canonical_ticker, p.ticker)). System-wide rows
// (action_type = daily_sec_scan / weekly_13f_scan, ticker IS NULL)
// always show up because they describe Iris's overall activity.

import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";

export type IrisActionType =
  | "daily_sec_scan"
  | "weekly_13f_scan"
  | "tenk_refresh"
  | "tenq_recompute"
  | "understanding_regen"
  | "tier_propagated"
  | "snapshot_created"
  | "filing_detected";

export type IrisAction = {
  id: number;
  action_type: IrisActionType;
  ticker: string | null;
  narration_md: string;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
};

export type RecordIrisActionInput = {
  actionType: IrisActionType;
  ticker?: string | null;
  narrationMd: string;
  metadata?: Record<string, unknown> | null;
};

// Best-effort insert — never throws. The log is observational; if it
// fails we don't want to break the underlying job. Any DB hiccup gets
// logged to stderr for diagnostics but the caller continues.
export async function recordIrisAction({
  actionType,
  ticker,
  narrationMd,
  metadata,
}: RecordIrisActionInput): Promise<void> {
  try {
    const canonical = ticker
      ? (await getCanonicalTicker(ticker)).toUpperCase()
      : null;
    await sql`
      INSERT INTO iris_actions (action_type, ticker, narration_md, metadata)
      VALUES (
        ${actionType},
        ${canonical},
        ${narrationMd},
        ${metadata ? JSON.stringify(metadata) : null}::jsonb
      )
    `;
  } catch (err) {
    console.warn(
      `[iris] recordIrisAction failed (${actionType}, ${ticker ?? "system"}):`,
      err,
    );
  }
}

// List recent actions. When userId is provided, restricts ticker-bound
// rows to tickers the user has any relationship with. System-wide
// rows (ticker IS NULL) are always included — they describe Iris's
// global activity which all users can see.
export async function listRecentIrisActions({
  userId,
  limit = 50,
  scope = "user",
}: {
  // The owner of the "Tus tickers" filter. Required when scope='user';
  // ignored when scope='all'.
  userId?: string | number;
  limit?: number;
  // 'user' = filter ticker-bound rows to the user's universe.
  // 'all'  = no filter (the public Iris feed across the whole system).
  scope?: "user" | "all";
}): Promise<IrisAction[]> {
  if (scope === "all" || !userId) {
    const rows = (await sql`
      SELECT id, action_type, ticker, narration_md, metadata, occurred_at
      FROM iris_actions
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `) as unknown as IrisAction[];
    return rows;
  }

  // user-scoped: include all system-wide rows (ticker IS NULL) plus
  // rows whose ticker resolves canonically to one in the user's
  // position set. We canonicalize on both sides of the join so a
  // BRK-B holder sees actions logged under canonical BRK-A.
  const rows = (await sql`
    WITH user_canonicals AS (
      SELECT DISTINCT COALESCE(ta.canonical_ticker, p.ticker) AS ticker
      FROM positions p
      LEFT JOIN ticker_aliases ta ON ta.ticker = p.ticker
      WHERE p.user_id = ${userId}
      UNION
      SELECT DISTINCT COALESCE(ta.canonical_ticker, we.ticker) AS ticker
      FROM watchlist_entries we
      LEFT JOIN ticker_aliases ta ON ta.ticker = we.ticker
      WHERE we.user_id = ${userId}
    )
    SELECT a.id, a.action_type, a.ticker, a.narration_md, a.metadata, a.occurred_at
    FROM iris_actions a
    WHERE a.ticker IS NULL
       OR a.ticker IN (SELECT ticker FROM user_canonicals)
    ORDER BY a.occurred_at DESC
    LIMIT ${limit}
  `) as unknown as IrisAction[];
  return rows;
}

// Convenience reader for the latest cron-summary action of each kind.
// Used by the agent page header to show "última verificación hace Xh"
// without scanning the entire log.
export async function getLatestActionByType(
  actionType: IrisActionType,
): Promise<IrisAction | null> {
  const rows = (await sql`
    SELECT id, action_type, ticker, narration_md, metadata, occurred_at
    FROM iris_actions
    WHERE action_type = ${actionType}
    ORDER BY occurred_at DESC
    LIMIT 1
  `) as unknown as IrisAction[];
  return rows[0] ?? null;
}

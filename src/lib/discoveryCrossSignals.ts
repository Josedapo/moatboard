// Cross-signal generator: when a newly-ingested Discovery 13F filing
// MOVES a ticker that the user owns or watchlists, emit a row into
// `review_signals` so the Inbox surfaces the cross-reference.
//
// Single-fund cross-signals get `severity: informational` — they're
// context, not a mandatory review. The high-value case is the user
// seeing "3 Tier-A funds exited your position this quarter" aggregated
// over multiple weeks of cron runs; that cross-fund pattern emerges
// naturally from separate informational rows.
//
// Idempotency: the deduplication_key packs fund + accession + ticker +
// movement so re-running the cron never duplicates. Re-running after a
// schema migration, or if a manual backfill re-ingests the same filing,
// is a no-op.

import { sql } from "@/lib/db";
import {
  classifyConvictionMovement,
  type MovementCategory,
} from "@/lib/discoveryFund";
import { getFundById } from "@/lib/discoveryFlow";
import { createSignalIfMissing } from "@/lib/reviewSignals";
import { listActiveTickersForUser } from "@/lib/signalFlow";
import type {
  SignalEventType,
  SignalSeverity,
} from "@/lib/signalClassifier";

function movementToEventType(cat: MovementCategory): SignalEventType {
  switch (cat) {
    case "new":
      return "fund_initiated_position";
    case "add":
      return "fund_increased_position";
    case "trim":
      return "fund_reduced_position";
    case "exit":
      return "fund_exited_position";
  }
}

type FilingRef = {
  id: number;
  accession: string;
  period_of_report: string;
  filing_date: string;
};

async function getPriorFilingForFund(
  fundId: number,
  currentPeriod: string,
): Promise<FilingRef | null> {
  const rows = (await sql`
    SELECT id, accession,
           TO_CHAR(period_of_report, 'YYYY-MM-DD') AS period_of_report,
           TO_CHAR(filing_date, 'YYYY-MM-DD') AS filing_date
    FROM discovery_filings
    WHERE fund_id = ${fundId}
      AND period_of_report < ${currentPeriod}::date
    ORDER BY period_of_report DESC
    LIMIT 1
  `) as unknown as FilingRef[];
  return rows[0] ?? null;
}

type HoldingMini = {
  ticker: string;
  shares: string; // bigint → string (neon)
  value_usd: number;
  weight_in_fund: number;
};

// Roll-up per (filing_id, ticker) — 13F filers can report the same
// CUSIP twice (shared vs sole voting authority). Summing is the right
// fix, matches what `getFundDetail` / `computeFundMovements` do.
async function loadHoldingsByTicker(
  filingId: number,
  tickers: string[],
): Promise<Map<string, HoldingMini>> {
  if (tickers.length === 0) return new Map();
  const rows = (await sql`
    SELECT
      ticker,
      SUM(shares)::text AS shares,
      SUM(value_usd)::float AS value_usd,
      SUM(weight_in_fund)::float AS weight_in_fund
    FROM discovery_holdings
    WHERE filing_id = ${filingId}
      AND ticker = ANY(${tickers}::text[])
    GROUP BY ticker
  `) as unknown as HoldingMini[];
  const map = new Map<string, HoldingMini>();
  for (const r of rows) map.set(r.ticker, r);
  return map;
}

function safeBigInt(s: string | null | undefined): bigint {
  if (!s) return BigInt(0);
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}

// Emit cross-signals for ALL users whose active tickers intersect with
// the filing's holdings. Called from runWeeklyDiscoveryJob after each
// ok_new ingestion. Returns the count of signals created this run.
//
// If the fund has no prior filing on record (first ingestion ever),
// there's no base of comparison — we skip rather than flood the inbox
// with "NEW" for every ticker. The rationale matches how Discovery as
// a whole treats the first backfill: it's data, not movement.
export async function generateCrossSignalsForFiling({
  fundId,
  filingId,
  accession,
  periodOfReport,
  filingDate,
}: {
  fundId: number;
  filingId: number;
  accession: string;
  periodOfReport: string;
  filingDate: string;
}): Promise<number> {
  const fund = await getFundById(fundId);
  if (!fund) return 0;

  const prior = await getPriorFilingForFund(fundId, periodOfReport);
  if (!prior) return 0;

  const users = (await sql`SELECT id FROM users ORDER BY id`) as unknown as {
    id: number;
  }[];

  const severity: SignalSeverity = "informational";
  const sourceUrl = `/dashboard/discovery/fund/${fund.cik}`;

  let created = 0;

  for (const u of users) {
    const tickers = await listActiveTickersForUser(u.id);
    if (tickers.length === 0) continue;

    const [latestMap, priorMap] = await Promise.all([
      loadHoldingsByTicker(filingId, tickers),
      loadHoldingsByTicker(prior.id, tickers),
    ]);

    const tickerSet = new Set<string>([
      ...latestMap.keys(),
      ...priorMap.keys(),
    ]);

    for (const ticker of tickerSet) {
      const latest = latestMap.get(ticker);
      const priorH = priorMap.get(ticker);

      const latestShares = safeBigInt(latest?.shares);
      const priorShares = safeBigInt(priorH?.shares);
      const movement = classifyConvictionMovement({
        priorShares,
        latestShares,
        priorWeight: priorH?.weight_in_fund ?? 0,
        latestWeight: latest?.weight_in_fund ?? 0,
      });
      if (movement === null || movement === "rebalance") continue;

      let sharesPctChange: number | null = null;
      if (priorShares > BigInt(0)) {
        sharesPctChange =
          (Number(latestShares - priorShares) / Number(priorShares)) * 100;
      }

      const rawPayload = {
        fund_id: fund.id,
        fund_cik: fund.cik,
        fund_display_name: fund.display_name,
        fund_tier: fund.tier,
        movement,
        prior_shares: priorShares.toString(),
        latest_shares: latestShares.toString(),
        shares_pct_change: sharesPctChange,
        latest_weight: latest?.weight_in_fund ?? 0,
        prior_weight: priorH?.weight_in_fund ?? 0,
        period_of_report: periodOfReport,
        prior_period_of_report: prior.period_of_report,
      };

      const inserted = await createSignalIfMissing({
        userId: u.id,
        ticker,
        source: "discovery_13f",
        eventType: movementToEventType(movement),
        eventDate: filingDate,
        sourceRef: accession,
        sourceUrl,
        severity,
        rawPayload,
        deduplicationKey: `cross-${fund.id}-${accession}-${ticker}-${movement}`,
      });
      if (inserted) created += 1;
    }
  }

  return created;
}

// Emit a "fund filed" announcement signal — one per (user, fund,
// filing) — for every user with at least one active ticker in the
// fund. INDEPENDENT of whether any conviction shifts fired: even when
// every holding is below the conviction threshold, the user still
// gets a heads-up that the fund reported. Anchored to the user's
// largest-weight holding in the fund as the ticker reference (the
// schema requires a ticker; the message is fund-scoped and the
// payload + sourceUrl point to the fund detail page where the
// holdings table — with its prior-weight column — lets the user
// review every move regardless of threshold).
//
// Skips users with zero active tickers in this fund (matches the
// scoping of the conviction signals — no portfolio overlap means
// no notification).
export async function generateFundFiledSignal({
  fundId,
  filingId,
  accession,
  periodOfReport,
  filingDate,
}: {
  fundId: number;
  filingId: number;
  accession: string;
  periodOfReport: string;
  filingDate: string;
}): Promise<number> {
  const fund = await getFundById(fundId);
  if (!fund) return 0;

  const users = (await sql`SELECT id FROM users ORDER BY id`) as unknown as {
    id: number;
  }[];

  const severity: SignalSeverity = "informational";
  const sourceUrl = `/dashboard/discovery/fund/${fund.cik}`;

  let created = 0;

  for (const u of users) {
    const tickers = await listActiveTickersForUser(u.id);
    if (tickers.length === 0) continue;

    const latestMap = await loadHoldingsByTicker(filingId, tickers);
    if (latestMap.size === 0) continue;

    // Pick the user's largest-weight holding in this fund as the
    // anchor ticker. Schema requires NOT NULL ticker; the signal is
    // fund-scoped semantically but we hang it off the most-relevant
    // ticker so the inbox grouping still works coherently.
    let anchorTicker: string | null = null;
    let anchorWeight = -1;
    for (const [ticker, h] of latestMap.entries()) {
      if (h.weight_in_fund > anchorWeight) {
        anchorWeight = h.weight_in_fund;
        anchorTicker = ticker;
      }
    }
    if (!anchorTicker) continue;

    const rawPayload = {
      fund_id: fund.id,
      fund_cik: fund.cik,
      fund_display_name: fund.display_name,
      fund_tier: fund.tier,
      period_of_report: periodOfReport,
      anchor_ticker: anchorTicker,
      anchor_weight: anchorWeight,
      // List every active ticker the user has in this fund so the UI
      // can render "your other holdings in this fund: …" if it wants.
      user_holdings_in_fund: Array.from(latestMap.entries()).map(
        ([t, h]) => ({ ticker: t, weight: h.weight_in_fund }),
      ),
    };

    const inserted = await createSignalIfMissing({
      userId: u.id,
      ticker: anchorTicker,
      source: "discovery_13f",
      eventType: "fund_filed",
      eventDate: filingDate,
      sourceRef: accession,
      sourceUrl,
      severity,
      rawPayload,
      deduplicationKey: `fund-filed-${fund.id}-${accession}`,
    });
    if (inserted) created += 1;
  }

  return created;
}

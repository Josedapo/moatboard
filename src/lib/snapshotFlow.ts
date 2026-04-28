// Snapshot orchestrators.
//
// Snapshots are immutable frozen frames of a (user, ticker)'s complete quality
// + valuation picture at a specific moment. Two triggers create them:
//
//   1. Transactional — user records a buy / add / trim / sell. Freezes the
//      evidence behind the decision. Invoked from the wizard's decision step
//      in Phase 3.
//
//   2. Quarterly — a new 10-Q or 10-K filing is detected for a ticker the
//      user already holds. Freezes the updated fundamentals automatically so
//      the trajectory grows even when the user doesn't transact.
//
// Both flows go through the same `buildSnapshotInput` helper so the scorecard,
// valuation, moat, guide, understanding, and thesis data are captured the
// same way regardless of trigger. Only the identifying metadata differs
// (transactionId vs secFilingAccession, trigger label).

import { getPositionById } from "@/lib/positions";
import { getTransactionById } from "@/lib/positionTransactions";
import {
  fetchQuoteAndFundamentals,
  fetchMultiYearFundamentals,
} from "@/lib/financial";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import { getMoatAssessment } from "@/lib/moats";
import { getCurrentUnderstanding } from "@/lib/businessUnderstanding";
import { getThesisByPositionId } from "@/lib/theses";
import { ensureSecFundamentals } from "@/lib/sec";
import { recordIrisAction } from "@/lib/irisActions";
import {
  createSnapshot,
  getSnapshotByFiling,
  getPreviousSnapshot,
  type CreateSnapshotInput,
  type FundamentalsSnapshot,
  type MoatSnapshot,
  type SnapshotTrigger,
} from "@/lib/snapshots";
import {
  detectMaterialChanges,
  hasMaterialChange,
  severityFromChanges,
  type MaterialChanges,
} from "@/lib/snapshotDiff";
import { createSignalIfMissing } from "@/lib/reviewSignals";
import { buildFilingIndexUrlFromAccession } from "@/lib/secFilings";
import { refreshScorecardOnly } from "@/lib/preAnalysisFlow";
import type {
  RelativeValuationSnapshot,
  Valuation,
} from "@/lib/valuations";
import type { LatestFiling } from "@/lib/secParser";

// -----------------------------------------------------------------------------
// Transactional snapshot
// -----------------------------------------------------------------------------

export async function createTransactionalSnapshot({
  userId,
  positionId,
  transactionId,
}: {
  userId: string | number;
  positionId: number;
  transactionId: number;
}): Promise<FundamentalsSnapshot> {
  const transaction = await getTransactionById(transactionId);
  if (!transaction || transaction.position_id !== positionId) {
    throw new Error(
      `Transaction ${transactionId} does not belong to position ${positionId}`,
    );
  }
  const input = await buildSnapshotInput({
    userId,
    positionId,
    trigger: "transaction",
    transactionId,
    secFilingAccession: null,
  });
  return createSnapshot(input);
}

// -----------------------------------------------------------------------------
// Quarterly / annual snapshot
// -----------------------------------------------------------------------------

export type EnsureQuarterlySnapshotsResult = {
  createdCount: number;
  latestFiling: LatestFiling | null;
  snapshot: FundamentalsSnapshot | null;
};

// Invoked when the position detail page loads. If SEC has published a 10-Q
// or 10-K newer than any snapshot we already took for this (user, ticker),
// a new snapshot is created. Otherwise it's a no-op. Idempotent by design —
// the partial unique index on (user_id, ticker, sec_filing_accession)
// prevents duplicate snapshots for the same filing.
export async function ensureQuarterlySnapshots({
  userId,
  positionId,
  ticker,
}: {
  userId: string | number;
  positionId: number;
  ticker: string;
}): Promise<EnsureQuarterlySnapshotsResult> {
  const secResult = await ensureSecFundamentals(ticker);
  if (secResult.status !== "ok" || !secResult.parsed?.latestFiling) {
    return { createdCount: 0, latestFiling: null, snapshot: null };
  }
  const filing = secResult.parsed.latestFiling;

  const existing = await getSnapshotByFiling({
    userId,
    ticker,
    accession: filing.accession,
  });
  if (existing) {
    return { createdCount: 0, latestFiling: filing, snapshot: existing };
  }

  const trigger = inferTriggerFromForm(filing.form);
  const input = await buildSnapshotInput({
    userId,
    positionId,
    trigger,
    transactionId: null,
    secFilingAccession: filing.accession,
  });
  const snapshot = await createSnapshot(input);

  // Delta alert: compare the fresh snapshot against its immediate
  // predecessor and emit a review_signals row if any quality threshold
  // was crossed. Idempotent via deduplication_key — re-invocations of
  // ensureQuarterlySnapshots with the same accession cannot produce
  // duplicates (the snapshot itself is short-circuited earlier anyway).
  await maybeEmitDeltaSignal({
    userId,
    ticker,
    newSnapshot: snapshot,
    filing,
  }).catch((err) => {
    // Non-fatal: snapshot is already persisted. Log and move on so the
    // caller (position page load) doesn't fail because of inbox issues.
    console.error(
      `maybeEmitDeltaSignal failed for ${ticker} accession ${filing.accession}: ${(err as Error).message}`,
    );
  });

  // Refresh the shared per-ticker scorecard cache with the fresh
  // numbers. Quarterly trigger (10-Q): scorecard + tier recompute, no
  // IA — moat and red flags stay anchored to the latest 10-K.
  // Annual trigger (10-K): the daily SEC signals cron handles the full
  // IA refresh once per ticker per year, so we skip it here to avoid
  // duplicating the work when the position page loads first.
  if (trigger === "quarterly_10q") {
    refreshScorecardOnly(ticker).catch((err) => {
      console.error(
        `refreshScorecardOnly failed for ${ticker}: ${(err as Error).message}`,
      );
    });
  }

  // Iris log: snapshot creation. Per-user side effect (snapshots are
  // per-user) but the action is keyed by ticker so the public log
  // surfaces the work too. Best-effort: a logging failure must not
  // affect the user-facing flow.
  await recordIrisAction({
    actionType: "snapshot_created",
    ticker,
    narrationMd:
      trigger === "annual_10k"
        ? `${ticker} cerró su año fiscal: snapshot anual congelado para Evolución.`
        : `Trimestral de ${ticker} congelada: snapshot disponible para la línea de Evolución.`,
    metadata: {
      trigger,
      accession: filing.accession,
      form: filing.form,
    },
  });

  return { createdCount: 1, latestFiling: filing, snapshot };
}

async function maybeEmitDeltaSignal({
  userId,
  ticker,
  newSnapshot,
  filing,
}: {
  userId: string | number;
  ticker: string;
  newSnapshot: FundamentalsSnapshot;
  filing: LatestFiling;
}): Promise<void> {
  const previous = await getPreviousSnapshot({
    userId,
    ticker,
    snapshotId: newSnapshot.id,
  });
  if (!previous) return; // first snapshot ever for this (user, ticker) — nothing to compare

  const changes = detectMaterialChanges(previous, newSnapshot);
  if (!hasMaterialChange(changes)) return;

  const severity = severityFromChanges(changes);
  const rawPayload = buildDeltaPayload({ previous, newSnapshot, filing, changes });

  await createSignalIfMissing({
    userId,
    ticker,
    source: "snapshot_diff",
    eventType: "material_fundamentals_change",
    eventDate: newSnapshot.taken_at.slice(0, 10),
    sourceRef: filing.accession,
    sourceUrl: buildFilingIndexUrlFromAccession(filing.accession),
    severity,
    rawPayload,
    // One signal per (user, ticker, target-snapshot). Re-runs are
    // idempotent; a subsequent filing gets its own snapshot and thus
    // its own dedupe key.
    deduplicationKey: `snapshot_diff:${newSnapshot.id}`,
  });
}

function buildDeltaPayload({
  previous,
  newSnapshot,
  filing,
  changes,
}: {
  previous: FundamentalsSnapshot;
  newSnapshot: FundamentalsSnapshot;
  filing: LatestFiling;
  changes: MaterialChanges;
}) {
  return {
    from_snapshot_id: previous.id,
    to_snapshot_id: newSnapshot.id,
    filing_accession: filing.accession,
    filing_form: filing.form,
    filing_period_end: filing.period_end,
    tier: changes.tier,
    gate: changes.gate,
    dimension_drops: changes.dimensionDrops,
  };
}

// 10-K and 20-F are the annual filings; anything else we treat as quarterly.
// Empty string (cached rows where form wasn't persisted) falls through to
// quarterly — the worst case is a mislabeled trigger, not a missing snapshot.
function inferTriggerFromForm(form: string): SnapshotTrigger {
  const upper = form.toUpperCase();
  if (upper.startsWith("10-K") || upper.startsWith("20-F")) {
    return "annual_10k";
  }
  return "quarterly_10q";
}

// -----------------------------------------------------------------------------
// Shared builder — fetches live data, runs the analytical pipeline, packages
// everything into a CreateSnapshotInput.
// -----------------------------------------------------------------------------

type BuildInputArgs = {
  userId: string | number;
  positionId: number;
  trigger: SnapshotTrigger;
  transactionId: number | null;
  secFilingAccession: string | null;
};

async function buildSnapshotInput(
  args: BuildInputArgs,
): Promise<CreateSnapshotInput> {
  const position = await getPositionById(args.positionId, args.userId);
  if (!position) {
    throw new Error(
      `Position ${args.positionId} not found for user ${args.userId}`,
    );
  }
  const ticker = position.ticker;

  const { quote, fundamentals } = await fetchQuoteAndFundamentals(ticker);
  if (!fundamentals) {
    throw new Error(
      `Cannot snapshot ${ticker}: fundamentals not available from any source.`,
    );
  }

  // Run quality + valuation. These auto-persist into the live tables —
  // correct behavior here: both transactional (user just transacted) and
  // quarterly (new filing dropped) snapshots imply the "live" view should
  // reflect the latest numbers.
  const [analysis, valuation] = await Promise.all([
    ensureAnalysis(args.positionId, ticker),
    ensureValuation(args.positionId, ticker, quote, fundamentals),
  ]);

  // AI valuation guide depends on which relative-valuation tools actually
  // rendered (e.g. P/B null when book value ≤ 0). Mirror the position page's
  // availability check so the snapshot stores what the user would see.
  const availability = extractGuideAvailability(valuation);
  const guide = availability
    ? await ensureValuationGuide(ticker, quote, fundamentals, availability)
    : null;

  const moatAssessment = await getMoatAssessment(ticker);
  const moat: MoatSnapshot | null = moatAssessment
    ? {
        strength: moatAssessment.strength,
        archetype: moatAssessment.archetype,
        reasoning: moatAssessment.reasoning,
      }
    : null;

  const [understanding, thesis, multiYear] = await Promise.all([
    getCurrentUnderstanding(ticker),
    getThesisByPositionId(args.positionId),
    fetchMultiYearFundamentals(ticker),
  ]);

  const thesisSnapshot = thesis
    ? thesis.structured_content
      ? { source: thesis.source, structured: thesis.structured_content }
      : { source: thesis.source, raw_text: thesis.raw_text }
    : null;

  return {
    userId: args.userId,
    ticker,
    positionId: args.positionId,
    transactionId: args.transactionId,
    trigger: args.trigger,
    secFilingAccession: args.secFilingAccession,
    currentPrice:
      quote?.regularMarketPrice != null ? quote.regularMarketPrice : null,
    tier: analysis.tier,
    scorecardSummary: analysis.scorecard_summary,
    multiYear,
    moat,
    valuationMethod: valuation?.method ?? null,
    valuationIntrinsicValue: toNum(valuation?.intrinsic_value),
    valuationIntrinsicValueLow: toNum(valuation?.intrinsic_value_low),
    valuationIntrinsicValueHigh: toNum(valuation?.intrinsic_value_high),
    valuationMarginOfSafetyPct: toNum(valuation?.margin_of_safety_pct),
    valuationAssumptions: valuation?.assumptions ?? null,
    valuationGuide: guide
      ? {
          primary_tool: guide.primary_tool,
          secondary_tool: guide.secondary_tool,
          cautious_tool: guide.cautious_tool,
          reasoning: guide.reasoning,
        }
      : null,
    businessUnderstandingVersion: understanding?.version ?? null,
    thesisSnapshot,
  };
}

function extractGuideAvailability(valuation: Valuation | null): {
  pe: boolean;
  pfcf: boolean;
  pb: boolean;
} | null {
  if (!valuation) return null;
  const snapshot = (
    valuation.assumptions as { relative_valuation?: RelativeValuationSnapshot }
  ).relative_valuation;
  if (!snapshot) return null;
  const ready = (s: RelativeValuationSnapshot["pe"] | undefined) =>
    !!s &&
    s.current !== null &&
    s.median !== null &&
    s.q1 !== null &&
    s.q3 !== null &&
    s.min !== null &&
    s.max !== null;
  return {
    pe: ready(snapshot.pe),
    pfcf: ready(snapshot.fcf_yield),
    pb: ready(snapshot.pb),
  };
}

function toNum(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

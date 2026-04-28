// Per-ticker pre-analysis pipeline. Populates the shared
// `discovery_pre_analyses` row so all users see the same Quality + Moat
// + Red flags picture for a given ticker.
//
// Two distinct entry points:
//
//   1. processPreAnalysisForTicker(ticker) — full re-evaluation: Quality
//      + Moat + Red flags. Runs IA. Used when a NEW 10-K is detected
//      (yearly per ticker, amortized across users).
//
//   2. upsertPreAnalysisFromExisting(ticker) — cheap consolidation:
//      reads the rows the user just wrote during the wizard
//      (moatboard_analyses, moat_assessments, qualitative_red_flags,
//      sec_fundamentals_cache) and lifts them into the shared row.
//      Zero IA calls. Used when a user completes the wizard so their
//      analysis becomes the cache for future users / Discovery.
//
//   3. refreshScorecardOnly(ticker) — quarterly recompute: re-runs the
//      scorecard against fresh SEC numbers (10-Q just published).
//      Reuses cached moat (no IA) and preserves existing red flag
//      counts (Item 1A lives only in 10-K). Updates tier if numerics
//      moved enough. Used by ensureQuarterlySnapshots.

import { sql } from "@/lib/db";
import { runAnalysis, type AnalysisResult } from "@/lib/analysis";
import { generateRedFlags } from "@/lib/redFlagsAi";
import {
  prepareRedFlagsFiling,
  prepareUnderstandingFiling,
} from "@/lib/filingForPrompt";
import {
  saveCoveredPreAnalysis,
  markNotCovered,
  markError,
  getPreAnalysis,
} from "@/lib/discoveryPreAnalysis";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { recordIrisAction } from "@/lib/irisActions";
import { saveAnalysis } from "@/lib/moatboardAnalyses";
import {
  getCurrentUnderstanding,
  isBusinessUnderstandingStale,
  saveNewUnderstanding,
} from "@/lib/businessUnderstanding";
import { generateBusinessUnderstanding } from "@/lib/businessUnderstandingAi";
import type {
  Tier,
  MoatStrength,
  MoatArchetype,
  ScorecardSummary,
} from "@/lib/verdict";

const MIN_APPLICABLE_DIMENSIONS = 5;

const TIER_LABEL_ES: Record<Tier, string> = {
  exceptional: "Exceptional",
  good: "Good",
  mediocre: "Mediocre",
  poor: "Poor",
};

// Propagate a fresh runAnalysis result to every per-user
// `moatboard_analyses` row that's keyed off a position whose canonical
// ticker matches. Triggered after the shared cache refreshes (10-K full
// IA re-run, 10-Q scorecard-only) so the user's Calidad tab reflects
// the same tier the snapshot diff just emitted as a `material` signal.
//
// Zero additional IA cost: the verdict_reason is the same prose
// `runAnalysis` already paid for to compute shared cache. We simply
// reuse it on each per-position row instead of forcing the user to
// click Regenerar.
//
// `moatboard_analyses` rows for closed/draft positions are also
// updated — they're cheap to keep coherent and Joseda's discarded
// ficha reads from the same row.
async function propagateAnalysisToPerUserRows(
  canonicalTicker: string,
  analysis: AnalysisResult,
): Promise<number> {
  const positions = (await sql`
    SELECT p.id
      FROM positions p
      LEFT JOIN ticker_aliases ta ON ta.ticker = p.ticker
     WHERE COALESCE(ta.canonical_ticker, p.ticker) = ${canonicalTicker}
  `) as unknown as Array<{ id: number }>;

  if (positions.length === 0) return 0;

  // Filter to positions that already have a moatboard_analyses row.
  // Discarded/draft positions without one stay untouched — creating
  // analyses out of nowhere would surprise a user who hasn't opened
  // the ficha yet (they'd see a tier they never asked for).
  const positionIds = positions.map((p) => p.id);
  const existing = (await sql`
    SELECT position_id FROM moatboard_analyses
    WHERE position_id = ANY(${positionIds}::int[])
  `) as unknown as Array<{ position_id: number }>;

  if (existing.length === 0) return 0;

  for (const row of existing) {
    await saveAnalysis({
      positionId: row.position_id,
      tier: analysis.tier,
      verdictReason: analysis.verdict_reason,
      scorecardSummary: analysis.scorecard_summary,
      moatStrength: analysis.moat_strength,
      moatArchetype: analysis.moat_archetype,
    });
  }

  return existing.length;
}

// Refresh per-user `valuations` rows for every position whose canonical
// matches `ticker`. Inputs that move with a new filing (FCF TTM, median
// / Q1 multiple distributions, the scorecard tier driving the implied-
// return threshold) all propagate through `computeAndSaveValuation`.
// User overrides on growth and terminal multiple are carried forward
// automatically by `computeAndSaveValuation`.
//
// IA cost: zero on the 10-Q path (valuation guide cached 365d). The
// 10-K path may pay one guide refresh when the cache expires — that's
// the cadence the 365d TTL was designed for.
//
// Only refreshes positions that already have a `valuations` row; never
// creates new ones, mirroring `propagateAnalysisToPerUserRows`'s rule
// against surprising the user with content they didn't ask for.
async function refreshValuationOnly(ticker: string): Promise<number> {
  const canonical = await getCanonicalTicker(ticker);

  const positions = (await sql`
    SELECT p.id, p.ticker
      FROM positions p
      LEFT JOIN ticker_aliases ta ON ta.ticker = p.ticker
     WHERE COALESCE(ta.canonical_ticker, p.ticker) = ${canonical}
  `) as unknown as Array<{ id: number; ticker: string }>;

  if (positions.length === 0) return 0;

  const positionIds = positions.map((p) => p.id);
  const existing = (await sql`
    SELECT position_id FROM valuations
    WHERE position_id = ANY(${positionIds}::int[])
  `) as unknown as Array<{ position_id: number }>;

  if (existing.length === 0) return 0;

  const { fetchQuoteAndFundamentals } = await import("@/lib/financial");
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(canonical);
  if (!quote || quote.regularMarketPrice == null) return 0;

  const { computeAndSaveValuation } = await import("@/lib/positionFlow");

  let count = 0;
  for (const row of existing) {
    try {
      await computeAndSaveValuation(
        row.position_id,
        canonical,
        quote,
        fundamentals,
      );
      count++;
    } catch (err) {
      console.warn(
        `refreshValuationOnly: failed for position ${row.position_id} (${canonical}):`,
        err,
      );
    }
  }
  return count;
}

// 10-K-only: refresh the shared business_understanding row when the
// cached version was generated against an older 10-K accession. Skipped
// when no row exists (no user has reached Step 1 of the wizard for this
// ticker yet) — we don't generate from scratch in the cron because the
// row is opt-in per the user's wizard pass.
async function refreshUnderstandingIfStale(
  ticker: string,
  latest10kAccession: string | null,
  latest10kPeriodEnd: string | null,
): Promise<{ refreshed: boolean; reason?: string }> {
  if (!latest10kAccession) return { refreshed: false, reason: "no 10-K accession on file" };
  const existing = await getCurrentUnderstanding(ticker);
  if (!existing) return { refreshed: false, reason: "no cached understanding" };
  if (!isBusinessUnderstandingStale(existing, latest10kAccession)) {
    return { refreshed: false, reason: "already up to date" };
  }
  const filing = await prepareUnderstandingFiling(ticker);
  // Without the 10-K text the prompt would produce generic content; better
  // to skip and leave the stale banner up than write a low-fidelity row.
  if (!filing) return { refreshed: false, reason: "10-K text unavailable" };

  // Quote/fundamentals the prompt uses for the company header. They're
  // narrative scaffolding only, not the source of facts. Lazily fetched
  // here so the generic "no understanding cached" path doesn't pay yfinance.
  const { fetchQuoteAndFundamentals } = await import("@/lib/financial");
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(ticker);

  const { generated, model } = await generateBusinessUnderstanding(
    ticker,
    quote,
    fundamentals,
    filing,
  );
  await saveNewUnderstanding({
    ticker,
    summaryMd: generated.summary_md,
    questionsAndAnswers: generated.questions_and_answers,
    sources: generated.sources,
    last10kAccession: latest10kAccession,
    last10kPeriodEnd: latest10kPeriodEnd,
    model,
  });
  return { refreshed: true };
}

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

// Full re-run. Used when a new 10-K is detected — the only path that
// regenerates Red flags (Item 1A is annual). Quality + Moat run inside
// runAnalysis with their own caches.
export async function processPreAnalysisForTicker(
  ticker: string,
): Promise<PreAnalysisItemResult> {
  const canonical = await getCanonicalTicker(ticker);
  try {
    const analysis = await runAnalysis(canonical);
    const sc = analysis.scorecard_summary;
    const applicable = sc.strong + sc.acceptable + sc.weak;

    if (applicable < MIN_APPLICABLE_DIMENSIONS) {
      const reason = `<${MIN_APPLICABLE_DIMENSIONS} applicable scorecard dimensions (got ${applicable})`;
      await markNotCovered(canonical, reason);
      return { ticker: canonical, outcome: "not_covered", reason };
    }

    const filing = await prepareRedFlagsFiling(canonical);
    const { flags } = await generateRedFlags(
      canonical,
      analysis.quote,
      analysis.fundamentals,
      filing,
    );
    const seriousCount = flags.filter((f) => f.severity === "serious").length;
    const watchCount = flags.filter((f) => f.severity === "watch").length;

    const accessionRow = (await sql`
      SELECT latest_quarter_accession AS accession,
             latest_quarter_period_end AS period_end
      FROM sec_fundamentals_cache
      WHERE ticker = ${canonical}
      LIMIT 1
    `) as unknown as Array<{
      accession: string | null;
      period_end: string | null;
    }>;

    await saveCoveredPreAnalysis({
      ticker: canonical,
      tier: analysis.tier,
      applicableDimensions: applicable,
      scorecardSummary: sc,
      moatStrength: analysis.moat_strength,
      moatArchetype: analysis.moat_archetype,
      hasSeriousRedFlags: seriousCount > 0,
      seriousRedFlagsCount: seriousCount,
      watchRedFlagsCount: watchCount,
      last10kAccession: accessionRow[0]?.accession ?? null,
      last10kPeriodEnd: accessionRow[0]?.period_end ?? null,
      model: "claude-mixed",
    });

    // Propagate the fresh tier + prose to every per-user analyses row
    // for this canonical (cartera, watchlist, descartada). Reuses the
    // verdict_reason runAnalysis already paid for — no extra IA.
    const propagated = await propagateAnalysisToPerUserRows(
      canonical,
      analysis,
    ).catch((err) => {
      console.warn(
        `[10-K] propagateAnalysisToPerUserRows failed for ${canonical}:`,
        err,
      );
      return 0;
    });

    // Annual business understanding refresh: only if the cached version
    // is older than this 10-K (some user generated it during a prior
    // wizard pass). Skipped silently when no cache exists or the 10-K
    // text is unavailable.
    const understandingResult = await refreshUnderstandingIfStale(
      canonical,
      accessionRow[0]?.accession ?? null,
      accessionRow[0]?.period_end ?? null,
    ).catch((err) => {
      console.warn(`[10-K] refreshUnderstandingIfStale failed for ${canonical}:`, err);
      return { refreshed: false, reason: "error" };
    });
    if (understandingResult.refreshed) {
      console.log(`[10-K] business_understanding regenerated for ${canonical}`);
    }

    // Refresh per-user valuations: anchors derived from filings (FCF
    // TTM, multiple distributions) need a cycle to stay coherent with
    // the new 10-K. User overrides on growth / terminal multiple are
    // preserved by computeAndSaveValuation's carry-forward logic.
    const valuationsRefreshed = await refreshValuationOnly(canonical).catch(
      (err) => {
        console.warn(`[10-K] refreshValuationOnly failed for ${canonical}:`, err);
        return 0;
      },
    );

    // Iris log entry: one summary row per ticker refreshed on a 10-K.
    const tierLabel = TIER_LABEL_ES[analysis.tier];
    const flagsPart =
      seriousCount + watchCount > 0
        ? ` Detectadas ${seriousCount + watchCount} red flags${seriousCount > 0 ? ` (${seriousCount} graves)` : ""}.`
        : " Sin red flags relevantes.";
    const understandingPart = understandingResult.refreshed
      ? " Resumen de negocio reescrito con la nueva edición."
      : "";
    const valuationPart =
      valuationsRefreshed > 0
        ? ` Valoración recalculada en ${valuationsRefreshed} ${valuationsRefreshed === 1 ? "ficha" : "fichas"}.`
        : "";
    await recordIrisAction({
      actionType: "tenk_refresh",
      ticker: canonical,
      narrationMd: `${canonical} publicó un 10-K nuevo. Calidad recalculada (${tierLabel}).${flagsPart}${understandingPart}${valuationPart}`,
      metadata: {
        tier: analysis.tier,
        applicable_dimensions: applicable,
        serious_red_flags: seriousCount,
        watch_red_flags: watchCount,
        propagated_to_per_user: propagated,
        understanding_regenerated: understandingResult.refreshed,
        valuations_refreshed: valuationsRefreshed,
      },
    });

    return {
      ticker: canonical,
      outcome: "covered",
      tier: analysis.tier,
      applicableDimensions: applicable,
      seriousFlags: seriousCount,
      watchFlags: watchCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(canonical, msg);
    return { ticker: canonical, outcome: "error", errorMessage: msg };
  }
}

// Cheap upsert from existing per-user wizard outputs. Zero IA calls —
// reads what's already persisted and lifts it into the shared row.
// Idempotent. Safe to call from anywhere in the wizard advance path.
export async function upsertPreAnalysisFromExisting(
  ticker: string,
): Promise<void> {
  const canonical = await getCanonicalTicker(ticker);

  // Latest scorecard for this canonical ticker across any user.
  const analysisRows = (await sql`
    SELECT ma.tier, ma.scorecard_summary
    FROM moatboard_analyses ma
    JOIN positions p ON p.id = ma.position_id
    LEFT JOIN ticker_aliases ta ON ta.ticker = p.ticker
    WHERE COALESCE(ta.canonical_ticker, p.ticker) = ${canonical}
    ORDER BY ma.generated_at DESC
    LIMIT 1
  `) as unknown as Array<{
    tier: Tier;
    scorecard_summary: ScorecardSummary;
  }>;

  if (!analysisRows[0]) return; // no analysis persisted yet

  const sc = analysisRows[0].scorecard_summary;
  const applicable = sc.strong + sc.acceptable + sc.weak;

  if (applicable < MIN_APPLICABLE_DIMENSIONS) {
    await markNotCovered(
      canonical,
      `<${MIN_APPLICABLE_DIMENSIONS} applicable scorecard dimensions (got ${applicable})`,
    );
    return;
  }

  // Moat is shared across users; the wizard's runAnalysis populates it.
  const moatRows = (await sql`
    SELECT strength, archetype
    FROM moat_assessments
    WHERE ticker = ${canonical}
    LIMIT 1
  `) as unknown as Array<{
    strength: MoatStrength;
    archetype: MoatArchetype;
  }>;
  if (!moatRows[0]) return; // moat missing — wait until wizard finishes Quality

  // Red flags optional — wizard might be at Quality step before reaching
  // Red flags. We persist counts=0 in that case; the next upsert call
  // (after the user advances to Red flags) overwrites with real counts.
  const flagsRows = (await sql`
    SELECT flags
    FROM qualitative_red_flags
    WHERE ticker = ${canonical}
    LIMIT 1
  `) as unknown as Array<{
    flags: Array<{ severity: string }>;
  }>;
  const flags = flagsRows[0]?.flags ?? [];
  const seriousCount = flags.filter((f) => f.severity === "serious").length;
  const watchCount = flags.filter((f) => f.severity === "watch").length;

  const accessionRow = (await sql`
    SELECT latest_quarter_accession AS accession,
           latest_quarter_period_end AS period_end
    FROM sec_fundamentals_cache
    WHERE ticker = ${canonical}
    LIMIT 1
  `) as unknown as Array<{
    accession: string | null;
    period_end: string | null;
  }>;

  await saveCoveredPreAnalysis({
    ticker: canonical,
    tier: analysisRows[0].tier,
    applicableDimensions: applicable,
    scorecardSummary: sc,
    moatStrength: moatRows[0].strength,
    moatArchetype: moatRows[0].archetype,
    hasSeriousRedFlags: seriousCount > 0,
    seriousRedFlagsCount: seriousCount,
    watchRedFlagsCount: watchCount,
    last10kAccession: accessionRow[0]?.accession ?? null,
    last10kPeriodEnd: accessionRow[0]?.period_end ?? null,
    model: "user-wizard",
  });
}

// Quarterly recompute: refresh scorecard + tier with fresh SEC numbers
// without re-running Red flags (which live in Item 1A of the 10-K).
// Moat is read from cache — runAnalysis will only call moatAi if the
// cached moat is stale, which after a 10-K refresh shouldn't be the
// case. Idempotent.
export async function refreshScorecardOnly(ticker: string): Promise<void> {
  const canonical = await getCanonicalTicker(ticker);
  const existing = await getPreAnalysis(canonical);
  if (!existing || existing.status !== "covered") return;

  try {
    const analysis = await runAnalysis(canonical);
    const sc = analysis.scorecard_summary;
    const applicable = sc.strong + sc.acceptable + sc.weak;

    if (applicable < MIN_APPLICABLE_DIMENSIONS) {
      await markNotCovered(
        canonical,
        `<${MIN_APPLICABLE_DIMENSIONS} applicable scorecard dimensions (got ${applicable})`,
      );
      return;
    }

    await saveCoveredPreAnalysis({
      ticker: canonical,
      tier: analysis.tier,
      applicableDimensions: applicable,
      scorecardSummary: sc,
      moatStrength: analysis.moat_strength,
      moatArchetype: analysis.moat_archetype,
      // Preserve red flags + 10-K anchor — those only refresh on a real 10-K.
      hasSeriousRedFlags: existing.has_serious_red_flags,
      seriousRedFlagsCount: existing.serious_red_flags_count,
      watchRedFlagsCount: existing.watch_red_flags_count,
      last10kAccession: existing.last_10k_accession,
      last10kPeriodEnd: existing.last_10k_period_end,
      model: "auto-10q-refresh",
    });

    // Propagate the fresh tier + prose to every per-user analyses row
    // for this canonical so the user's Calidad tab reflects the same
    // tier the snapshot diff just emitted as a `material` signal.
    // Reuses the verdict_reason runAnalysis already paid for — no
    // extra IA cost beyond what the 10-Q refresh was already paying.
    const propagated = await propagateAnalysisToPerUserRows(
      canonical,
      analysis,
    ).catch((err) => {
      console.warn(
        `[10-Q] propagateAnalysisToPerUserRows failed for ${canonical}:`,
        err,
      );
      return 0;
    });
    if (propagated > 0) {
      console.log(
        `[10-Q] tier propagated to ${propagated} per-user analyses for ${canonical}`,
      );
    }

    // Refresh per-user valuations with the fresh quarter's numbers.
    // Zero IA cost: the valuation guide (TTL 365d) hits cache, the
    // scorecard tier is the one we just recomputed, and the FCF TTM /
    // multiple distributions read straight from SEC fundamentals cache.
    const valuationsRefreshed = await refreshValuationOnly(canonical).catch(
      (err) => {
        console.warn(`[10-Q] refreshValuationOnly failed for ${canonical}:`, err);
        return 0;
      },
    );

    // Iris log entry. Tier change vs the previous snapshot is what
    // makes 10-Qs interesting — surface it explicitly in the narration.
    const newTier = analysis.tier;
    const oldTier = existing.tier;
    const tierChanged = newTier !== oldTier;
    const newTierLabel = TIER_LABEL_ES[newTier];
    const tierPart = tierChanged
      ? ` Calidad pasó de ${oldTier ? TIER_LABEL_ES[oldTier] : "—"} a ${newTierLabel}.`
      : ` Calidad se mantiene en ${newTierLabel}.`;
    const valuationPart =
      valuationsRefreshed > 0
        ? ` Valoración recalculada en ${valuationsRefreshed} ${valuationsRefreshed === 1 ? "ficha" : "fichas"}.`
        : "";
    await recordIrisAction({
      actionType: "tenq_recompute",
      ticker: canonical,
      narrationMd: `Trimestral de ${canonical}: scorecard recalculado con números frescos.${tierPart}${valuationPart}`,
      metadata: {
        tier_before: oldTier,
        tier_after: newTier,
        tier_changed: tierChanged,
        applicable_dimensions: applicable,
        propagated_to_per_user: propagated,
        valuations_refreshed: valuationsRefreshed,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(canonical, msg);
  }
}

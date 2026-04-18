// Orchestrator: produces the Moatboard Business Analysis (verdict + reason)
// for a given ticker. Combines:
//   1. Fresh fundamentals from yfinance
//   2. Cached moat assessment (or AI-evaluated on cache miss / staleness)
//   3. Pure formulaic tier computation
//   4. Templated verdict reason — no AI needed for prose

import {
  fetchQuoteAndFundamentals,
  fetchMultiYearFundamentals,
  fetchHistoricalPriceNear,
  type Quote,
  type Fundamentals,
  type MultiYearFundamentals,
} from "@/lib/financial";
import { getMoatAssessment, saveMoatAssessment, isMoatStale } from "@/lib/moats";
import { assessMoat } from "@/lib/moatAi";
import {
  computeQualityTier,
  renderVerdictReason,
  summarizeScorecard,
  type Tier,
  type ScorecardSummary,
  type MoatStrength,
  type MoatArchetype,
} from "@/lib/verdict";
import { computeRetentionMultiple } from "@/lib/scorecard";
import { composeVerdictNarrative } from "@/lib/verdictAi";
import { assessTooHard } from "@/lib/tooHard";

export type AnalysisResult = {
  tier: Tier;
  verdict_reason: string;
  scorecard_summary: ScorecardSummary;
  moat_strength: MoatStrength;
  moat_archetype: MoatArchetype;
  // Side data also returned so callers can avoid a duplicate yfinance fetch
  quote: Quote | null;
  fundamentals: Fundamentals | null;
  multiYear: MultiYearFundamentals | null;
};

export async function runAnalysis(ticker: string): Promise<AnalysisResult> {
  const [{ quote, fundamentals }, multiYear] = await Promise.all([
    fetchQuoteAndFundamentals(ticker),
    fetchMultiYearFundamentals(ticker),
  ]);

  if (!fundamentals) {
    throw new Error(
      `Cannot run analysis for ${ticker}: fundamentals not available.`,
    );
  }

  // Get or create moat assessment (cached, shared across users)
  let moat = await getMoatAssessment(ticker);
  if (!moat || isMoatStale(moat)) {
    const { evaluation, model } = await assessMoat(
      ticker,
      quote,
      fundamentals,
      multiYear,
    );
    moat = await saveMoatAssessment({
      ticker,
      strength: evaluation.strength,
      archetype: evaluation.archetype,
      reasoning: evaluation.reasoning,
      model,
    });
  }

  // Buffett's one-dollar test — reference signal, shown in Additional
  // Signals. Anchor the "then" market cap to the earliest fiscal year with
  // usable share-count data. yfinance occasionally returns the oldest row
  // with most fields null; if so, walk forward to the first row where we
  // can price a market cap. Retained earnings are summed from the SAME
  // anchor year, so retained capital and value-created cover the same
  // window (a 4y retained vs 3y value-created comparison would be biased).
  // Cap the retention-multiple window at 12 years back even when SEC gives
  // us 18y of fundamentals. Rationale: yfinance's historical price feed is
  // reliable out to ~15 years; anchoring the retention-multiple market cap
  // further back produces a null "then" market cap and the one-dollar test
  // becomes unavailable for the strongest compounders (plan §6.5).
  // Twelve years is long enough to span a full cycle and short enough to
  // stay well within yfinance's price horizon.
  const RETENTION_MAX_YEARS = 12;
  const anchorCutoff = new Date();
  anchorCutoff.setFullYear(anchorCutoff.getFullYear() - RETENTION_MAX_YEARS);
  const anchorIndex =
    multiYear?.years.findIndex(
      (r) =>
        r.sharesDiluted !== null &&
        r.sharesDiluted > 0 &&
        !!r.fiscalYearEnd &&
        new Date(r.fiscalYearEnd).getTime() >= anchorCutoff.getTime(),
    ) ?? -1;
  let retentionMultiple;
  if (!multiYear || anchorIndex < 0) {
    retentionMultiple = computeRetentionMultiple({
      mya: multiYear,
      currentMarketCap: quote?.marketCap ?? null,
      oldestMarketCap: null,
    });
  } else {
    const anchorRow = multiYear.years[anchorIndex];
    const anchorDate = new Date(anchorRow.fiscalYearEnd);
    const anchorPrice = !Number.isNaN(anchorDate.getTime())
      ? await fetchHistoricalPriceNear(ticker, anchorDate)
      : null;
    const anchorMarketCap =
      anchorPrice !== null && anchorRow.sharesDiluted
        ? anchorPrice * anchorRow.sharesDiluted
        : null;
    const partialMya: MultiYearFundamentals = {
      ...multiYear,
      years: multiYear.years.slice(anchorIndex),
    };
    retentionMultiple = computeRetentionMultiple({
      mya: partialMya,
      currentMarketCap: quote?.marketCap ?? null,
      oldestMarketCap: anchorMarketCap,
    });
  }

  const scorecard = summarizeScorecard(
    fundamentals,
    multiYear,
    quote?.sector ?? null,
    quote?.industry ?? null,
    retentionMultiple,
  );
  let tier = computeQualityTier(scorecard, moat.strength, moat.archetype, fundamentals);

  // "Too hard" downgrade: if the business combines a hard-to-predict sector
  // with a weak or absent moat, Moatboard's own philosophy says it doesn't
  // belong in the punch card. The tier reflects that — we downgrade one
  // level so the badge doesn't contradict the risk_factors caveat.
  const tooHard = assessTooHard({
    sector: quote?.sector ?? null,
    industry: quote?.industry ?? null,
    moatStrength: moat.strength,
    moatArchetype: moat.archetype,
  });
  if (tooHard.isHard) {
    tier = downgradeTier(tier);
  }

  // Try AI-composed narrative; fall back to deterministic template on failure
  // so the page never breaks if the model API is unavailable.
  let verdict_reason: string;
  try {
    verdict_reason = await composeVerdictNarrative({
      ticker,
      tier,
      scorecard,
      moatStrength: moat.strength,
      moatArchetype: moat.archetype,
      moatReasoning: moat.reasoning,
      quote,
      fundamentals,
      tooHardReason: tooHard.isHard ? tooHard.reason : null,
    });
  } catch (err) {
    console.error("composeVerdictNarrative failed, falling back to template:", err);
    verdict_reason = renderVerdictReason({
      tier,
      scorecard,
      moatStrength: moat.strength,
      moatArchetype: moat.archetype,
      fundamentals,
    });
    if (tooHard.isHard && tooHard.reason) {
      verdict_reason += ` ${tooHard.reason}`;
    }
  }

  return {
    tier,
    verdict_reason,
    scorecard_summary: scorecard,
    moat_strength: moat.strength,
    moat_archetype: moat.archetype,
    quote,
    fundamentals,
    multiYear,
  };
}

function downgradeTier(tier: Tier): Tier {
  switch (tier) {
    case "exceptional":
      return "good";
    case "good":
      return "mediocre";
    case "mediocre":
    case "poor":
      return tier;
  }
}

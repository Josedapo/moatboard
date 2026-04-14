// Orchestrator: produces the Moatboard Business Analysis (verdict + reason)
// for a given ticker. Combines:
//   1. Fresh fundamentals from yfinance
//   2. Cached moat assessment (or AI-evaluated on cache miss / staleness)
//   3. Pure formulaic tier computation
//   4. Templated verdict reason — no AI needed for prose

import {
  fetchQuoteAndFundamentals,
  type Quote,
  type Fundamentals,
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
import { composeVerdictNarrative } from "@/lib/verdictAi";

export type AnalysisResult = {
  tier: Tier;
  verdict_reason: string;
  scorecard_summary: ScorecardSummary;
  moat_strength: MoatStrength;
  moat_archetype: MoatArchetype;
  // Side data also returned so callers can avoid a duplicate yfinance fetch
  quote: Quote | null;
  fundamentals: Fundamentals | null;
};

export async function runAnalysis(ticker: string): Promise<AnalysisResult> {
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(ticker);

  if (!fundamentals) {
    throw new Error(
      `Cannot run analysis for ${ticker}: fundamentals not available.`,
    );
  }

  // Get or create moat assessment (cached, shared across users)
  let moat = await getMoatAssessment(ticker);
  if (!moat || isMoatStale(moat)) {
    const { evaluation, model } = await assessMoat(ticker, quote, fundamentals);
    moat = await saveMoatAssessment({
      ticker,
      strength: evaluation.strength,
      archetype: evaluation.archetype,
      reasoning: evaluation.reasoning,
      model,
    });
  }

  const scorecard = summarizeScorecard(fundamentals);
  const tier = computeQualityTier(scorecard, moat.strength, fundamentals);

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
  }

  return {
    tier,
    verdict_reason,
    scorecard_summary: scorecard,
    moat_strength: moat.strength,
    moat_archetype: moat.archetype,
    quote,
    fundamentals,
  };
}

// "Ensure" helpers — get-or-create flows used by the position detail page so
// the data is auto-computed on first visit, no buttons required.

import { runAnalysis } from "@/lib/analysis";
import {
  getAnalysisByPositionId,
  saveAnalysis,
  type MoatboardAnalysis,
} from "@/lib/moatboardAnalyses";
import {
  computeDcfIntrinsicValue,
  classifyMarginOfSafety,
} from "@/lib/valuation";
import {
  suggestDcfAssumptions,
  estimateWithMultiples,
} from "@/lib/valuationAi";
import {
  getValuationByPositionId,
  saveValuation,
  type Valuation,
  type DcfStoredAssumptions,
} from "@/lib/valuations";
import type { Quote, Fundamentals } from "@/lib/financial";

export async function ensureAnalysis(
  positionId: number,
  ticker: string,
): Promise<MoatboardAnalysis> {
  const existing = await getAnalysisByPositionId(positionId);
  if (existing) return existing;

  const result = await runAnalysis(ticker);
  return saveAnalysis({
    positionId,
    tier: result.tier,
    verdictReason: result.verdict_reason,
    scorecardSummary: result.scorecard_summary,
    moatStrength: result.moat_strength,
    moatArchetype: result.moat_archetype,
  });
}

export async function ensureValuation(
  positionId: number,
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<Valuation | null> {
  const existing = await getValuationByPositionId(positionId);
  if (existing) return existing;

  if (!quote || quote.regularMarketPrice == null) {
    // Cannot compute without a current market price
    return null;
  }

  const currentPrice = quote.regularMarketPrice;
  const fcf = fundamentals?.freeCashflow ?? null;
  const sharesOutstanding = quote.sharesOutstanding;
  const useDcf =
    fcf !== null && fcf > 0 && sharesOutstanding !== null && sharesOutstanding > 0;

  if (useDcf) {
    const assumptions = await suggestDcfAssumptions(ticker, quote, fundamentals);
    const netDebt =
      (fundamentals?.totalDebt ?? 0) - (fundamentals?.totalCash ?? 0);

    const breakdown = computeDcfIntrinsicValue({
      fcfBase: fcf!,
      growthRate: assumptions.growth_rate,
      terminalGrowth: assumptions.terminal_growth,
      discountRate: assumptions.discount_rate,
      netDebt,
      sharesOutstanding: sharesOutstanding!,
    });

    const { mosPct, tier } = classifyMarginOfSafety(
      breakdown.intrinsicValue,
      currentPrice,
    );

    const stored: DcfStoredAssumptions = {
      fcf_base: fcf!,
      growth_rate: assumptions.growth_rate,
      terminal_growth: assumptions.terminal_growth,
      discount_rate: assumptions.discount_rate,
      net_debt: netDebt,
      shares_outstanding: sharesOutstanding!,
    };

    return saveValuation({
      positionId,
      method: "dcf",
      intrinsicValue: breakdown.intrinsicValue,
      currentPrice,
      marginOfSafetyPct: mosPct,
      tier,
      assumptions: stored,
      reasoning: assumptions.reasoning,
    });
  }

  // AI multiples fallback
  const reasonNotApplicable =
    fcf === null
      ? "FCF data not available"
      : fcf <= 0
        ? "FCF is negative"
        : "shares outstanding not available";

  const estimate = await estimateWithMultiples(ticker, quote, fundamentals);
  const { mosPct, tier } = classifyMarginOfSafety(
    estimate.intrinsic_value,
    currentPrice,
  );

  return saveValuation({
    positionId,
    method: "ai_multiples",
    intrinsicValue: estimate.intrinsic_value,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier,
    assumptions: {
      basis: estimate.basis,
      sector_multiple_used: estimate.sector_multiple_used,
    },
    reasoning: `${estimate.reasoning} (DCF not applicable: ${reasonNotApplicable}.)`,
  });
}

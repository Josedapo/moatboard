// "Ensure" helpers — get-or-create flows used by the position detail page so
// the data is auto-computed on first visit, no buttons required.

import { runAnalysis } from "@/lib/analysis";
import {
  getAnalysisByPositionId,
  saveAnalysis,
  type MoatboardAnalysis,
} from "@/lib/moatboardAnalyses";
import {
  classifyMarginOfSafety,
  computeIntrinsicValueRange,
  computeOwnerEarningsBase,
  observedGrowthRate,
  STAGE_ONE_YEARS,
  DEFAULT_HURDLE_RATES,
} from "@/lib/valuation";
import { estimateWithMultiples } from "@/lib/valuationAi";
import {
  getValuationByPositionId,
  saveValuation,
  type Valuation,
  type DcfStoredAssumptions,
} from "@/lib/valuations";
import {
  fetchMultiYearFundamentals,
  fetchTenYearTreasuryYieldAverage,
  type Quote,
  type Fundamentals,
} from "@/lib/financial";

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
  const sharesOutstanding = quote.sharesOutstanding;

  if (sharesOutstanding === null || sharesOutstanding <= 0) {
    return runMultiplesFallback(
      positionId,
      ticker,
      quote,
      fundamentals,
      currentPrice,
      "shares outstanding not available",
    );
  }

  // Fetch multi-year + treasury in parallel — both are cacheable / cheap
  const [multiYear, treasury] = await Promise.all([
    fetchMultiYearFundamentals(ticker),
    fetchTenYearTreasuryYieldAverage(),
  ]);

  const trailingFcf = fundamentals?.freeCashflow ?? null;
  const ownerEarnings = computeOwnerEarningsBase(multiYear, trailingFcf);

  if (!ownerEarnings || ownerEarnings.value <= 0) {
    const reason =
      trailingFcf !== null && trailingFcf <= 0
        ? "owner earnings / FCF is negative"
        : "cash-flow base not available";
    return runMultiplesFallback(
      positionId,
      ticker,
      quote,
      fundamentals,
      currentPrice,
      reason,
    );
  }

  const stageOneGrowth = observedGrowthRate(multiYear);
  const terminalGrowth = treasury.fiveYearAveragePct;
  const netDebt =
    (fundamentals?.totalDebt ?? 0) - (fundamentals?.totalCash ?? 0);

  const range = computeIntrinsicValueRange({
    ownerEarningsBase: ownerEarnings.value,
    stageOneGrowth,
    terminalGrowth,
    netDebt,
    sharesOutstanding,
  });

  const { mosPct, tier } = classifyMarginOfSafety(range.base, currentPrice);

  const stored: DcfStoredAssumptions = {
    owner_earnings_base: ownerEarnings.value,
    net_income: ownerEarnings.netIncome,
    depreciation_amortization: ownerEarnings.depreciationAmortization,
    maintenance_capex_proxy: ownerEarnings.maintenanceCapexProxy,
    stage_one_growth: stageOneGrowth,
    terminal_growth: terminalGrowth,
    treasury_yield_pct: treasury.fiveYearAveragePct,
    treasury_source: treasury.source,
    hurdle_rates: {
      low: DEFAULT_HURDLE_RATES[2],
      base: DEFAULT_HURDLE_RATES[1],
      high: DEFAULT_HURDLE_RATES[0],
    },
    net_debt: netDebt,
    shares_outstanding: sharesOutstanding,
    years_of_history: ownerEarnings.yearsUsed,
    base_note: ownerEarnings.note,
  };

  return saveValuation({
    positionId,
    method: "dcf",
    intrinsicValue: range.base,
    intrinsicValueLow: range.low,
    intrinsicValueHigh: range.high,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier,
    assumptions: stored,
    reasoning: buildDcfReasoning(ownerEarnings.yearsUsed, stageOneGrowth, terminalGrowth, treasury.source),
  });
}

async function runMultiplesFallback(
  positionId: number,
  ticker: string,
  quote: Quote,
  fundamentals: Fundamentals | null,
  currentPrice: number,
  reasonNotApplicable: string,
): Promise<Valuation> {
  const estimate = await estimateWithMultiples(ticker, quote, fundamentals);
  const { mosPct, tier } = classifyMarginOfSafety(
    estimate.intrinsic_value,
    currentPrice,
  );

  return saveValuation({
    positionId,
    method: "ai_multiples",
    intrinsicValue: estimate.intrinsic_value,
    intrinsicValueLow: estimate.intrinsic_value,
    intrinsicValueHigh: estimate.intrinsic_value,
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

export function buildDcfReasoning(
  yearsUsed: number,
  stageOneGrowth: number,
  terminalGrowth: number,
  treasurySource: "yfinance_tnx" | "fallback",
): string {
  const growthText = `${(stageOneGrowth * 100).toFixed(1)}% for years 1–${STAGE_ONE_YEARS}, fading to ${(terminalGrowth * 100).toFixed(1)}% by year 10`;
  const terminalAnchor =
    treasurySource === "yfinance_tnx"
      ? "anchored to the 5-year average of the US 10-year Treasury yield"
      : "using a conservative 2.5% fallback (Treasury yield fetch unavailable)";
  const historyNote =
    yearsUsed >= 3
      ? `Owner earnings base uses the latest annual report with a ${yearsUsed}-year average capex as a maintenance-capex proxy.`
      : yearsUsed > 0
        ? `Owner earnings base uses the latest year; capex proxy is noisy with only ${yearsUsed} year(s) of history.`
        : `Owner earnings fall back to trailing FCF (no multi-year history).`;
  return `${historyNote} Growth projected at ${growthText}. Terminal growth ${terminalAnchor}. Intrinsic value shown as a range across three hurdle rates (10% / 12% / 14%); the headline is the 12% base case.`;
}

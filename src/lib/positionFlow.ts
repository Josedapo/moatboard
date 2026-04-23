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
  computeExcessReturnsBase,
  computeExcessReturnsRange,
  computeCostOfEquity,
  EQUITY_RISK_PREMIUM,
  STAGE_ONE_YEARS,
  DEFAULT_HURDLE_RATES,
  type DcfTier,
  type RelativeTier,
  type CompoundTier,
} from "@/lib/valuation";
import { isBalanceSheetBusiness, isRealEstate } from "@/lib/scorecard";
import {
  classifyCompoundTier,
  classifyRelativeTier,
  computeDistributionStats,
  computePercentile,
} from "@/lib/relativeValuation";
import { estimateWithMultiples } from "@/lib/valuationAi";
import {
  getValuationByPositionId,
  saveValuation,
  type Valuation,
  type DcfStoredAssumptions,
  type ExcessReturnsStoredAssumptions,
  type RelativeValuationSnapshot,
  type ValuationMethod,
} from "@/lib/valuations";
import {
  fetchMultiYearFundamentals,
  fetchTenYearTreasuryYieldAverage,
  fetchRelativeValuationHistory,
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

// Drift M helper: fetches the business's own multiple history, computes the
// distribution snapshot, and classifies the relative tier using PE as the
// primary metric (FCF yield snapshot is informational). Returns null when
// there isn't enough history (<3 years / <36 monthly points). Never throws.
export type RelativeValuationContext = {
  snapshot: RelativeValuationSnapshot;
  relativeTier: RelativeTier;
};

export async function computeRelativeValuationContext(
  ticker: string,
): Promise<RelativeValuationContext | null> {
  const history = await fetchRelativeValuationHistory(ticker);
  if (!history || history.points.length === 0) return null;

  const peValues = history.points
    .map((p) => p.peRatio)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  const fcfYieldValues = history.points
    .map((p) => p.fcfYield)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  const pbValues = history.points
    .map((p) => p.pbRatio)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);

  const peStats = computeDistributionStats(peValues);
  // Classification requires PE stats — the primary relative metric. If PE
  // doesn't have enough data, fall back to DCF-only (null).
  if (!peStats) return null;

  // Most recent point's multiples as "current".
  const latest = history.points[history.points.length - 1];
  const currentPe = latest.peRatio;
  if (currentPe === null || currentPe <= 0 || !Number.isFinite(currentPe)) {
    return null;
  }

  const relativeTier = classifyRelativeTier(currentPe, peStats);

  const peSorted = [...peValues].sort((a, b) => a - b);
  const pePercentile = computePercentile(peSorted, currentPe);

  const fcfStats = computeDistributionStats(fcfYieldValues);
  const currentFcfYield = latest.fcfYield;
  const fcfSorted = [...fcfYieldValues].sort((a, b) => a - b);
  const fcfPercentile =
    fcfStats && currentFcfYield !== null && currentFcfYield > 0
      ? computePercentile(fcfSorted, currentFcfYield)
      : null;

  // P/B snapshot — computed when equity has been positive and stable enough
  // across the history. When the current book value is zero/negative (some
  // aggressive-buyback names) the current reads null and the UI will render
  // "Insufficient data" rather than a misleading multiple.
  const pbStats = computeDistributionStats(pbValues);
  const currentPb = latest.pbRatio;
  const pbSorted = [...pbValues].sort((a, b) => a - b);
  const pbPercentile =
    pbStats && currentPb !== null && currentPb > 0
      ? computePercentile(pbSorted, currentPb)
      : null;

  const snapshot: RelativeValuationSnapshot = {
    years_of_data: Number(history.yearsOfData.toFixed(2)),
    points_count: history.points.length,
    period_start: history.points[0].date,
    period_end: history.points[history.points.length - 1].date,
    pe: {
      current: currentPe,
      median: peStats.median,
      q1: peStats.q1,
      q3: peStats.q3,
      min: peStats.min,
      max: peStats.max,
      current_percentile: pePercentile,
    },
    fcf_yield: fcfStats
      ? {
          current: currentFcfYield,
          median: fcfStats.median,
          q1: fcfStats.q1,
          q3: fcfStats.q3,
          min: fcfStats.min,
          max: fcfStats.max,
          current_percentile: fcfPercentile,
        }
      : {
          current: currentFcfYield,
          median: null,
          q1: null,
          q3: null,
          min: null,
          max: null,
          current_percentile: null,
        },
    pb: pbStats
      ? {
          current: currentPb,
          median: pbStats.median,
          q1: pbStats.q1,
          q3: pbStats.q3,
          min: pbStats.min,
          max: pbStats.max,
          current_percentile: pbPercentile,
        }
      : {
          current: currentPb,
          median: null,
          q1: null,
          q3: null,
          min: null,
          max: null,
          current_percentile: null,
        },
  };

  return { snapshot, relativeTier };
}

// Pure helper: given a DCF tier and an optional relative context, return the
// compound tier + the relative tier value (or null). Used by both
// ensureValuation and the runValuationAction to keep classification logic
// in one place.
export function deriveCompoundTier(
  dcfTier: DcfTier,
  relativeContext: RelativeValuationContext | null,
): { compoundTier: CompoundTier; relativeTier: RelativeTier | null } {
  const relativeTier = relativeContext?.relativeTier ?? null;
  return {
    compoundTier: classifyCompoundTier(dcfTier, relativeTier),
    relativeTier,
  };
}

export async function ensureValuation(
  positionId: number,
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<Valuation | null> {
  const existing = await getValuationByPositionId(positionId);
  if (existing) return existing;
  return computeAndSaveValuation(positionId, ticker, quote, fundamentals);
}

// Core compute-and-save: used by both ensureValuation (first-visit auto)
// and runValuationAction (explicit Regenerate button). Having both paths
// go through this helper is what keeps the sector-aware dispatch (banks →
// Excess Returns, REITs → AFFO, rest → Owner Earnings DCF) applied
// consistently. Before this consolidation, runValuationAction carried a
// duplicate of the old single-branch logic and never routed banks/REITs.
export async function computeAndSaveValuation(
  positionId: number,
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<Valuation | null> {
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

  // Fetch multi-year, treasury, and relative history in parallel. Treasury +
  // multi-year feed the DCF; relative history feeds the drift-M second anchor.
  const [multiYear, treasury, relativeContext] = await Promise.all([
    fetchMultiYearFundamentals(ticker),
    fetchTenYearTreasuryYieldAverage(),
    computeRelativeValuationContext(ticker),
  ]);

  const sector = quote.sector ?? null;
  const industry = quote.industry ?? null;

  // ─── Balance-sheet businesses (banks, insurers, asset managers) ──────
  // Excess Returns Model instead of DCF. Invested capital isn't meaningful
  // for a bank; stockholder equity × (ROE − Cost of Equity) is.
  if (isBalanceSheetBusiness(sector, industry)) {
    const base = computeExcessReturnsBase(
      multiYear,
      fundamentals,
      sharesOutstanding,
    );
    if (base && base.bookValue > 0 && base.stableRoe > 0) {
      const costOfEquity = computeCostOfEquity({
        beta: fundamentals?.beta ?? null,
        riskFreeRate: treasury.currentPct,
      });
      const range = computeExcessReturnsRange({
        bookValue: base.bookValue,
        stableRoe: base.stableRoe,
        retentionRatio: base.retentionRatio,
        sharesOutstanding,
        costOfEquity,
        terminalRoe: costOfEquity,
      });

      const { mosPct, tier: dcfTier } = classifyMarginOfSafety(
        range.base,
        currentPrice,
      );
      const { compoundTier, relativeTier } = deriveCompoundTier(
        dcfTier,
        relativeContext,
      );

      const stored: ExcessReturnsStoredAssumptions = {
        book_value: base.bookValue,
        stable_roe: base.stableRoe,
        retention_ratio: base.retentionRatio,
        cost_of_equity: costOfEquity,
        risk_free_rate: treasury.currentPct,
        beta: fundamentals?.beta ?? null,
        equity_risk_premium: EQUITY_RISK_PREMIUM,
        terminal_roe: costOfEquity,
        hurdle_rates: {
          low: range.costsOfEquity.low,
          base: range.costsOfEquity.base,
          high: range.costsOfEquity.high,
        },
        shares_outstanding: sharesOutstanding,
        years_of_history: base.yearsUsed,
        base_note: base.note,
        relative_valuation: relativeContext?.snapshot,
      };

      return saveValuation({
        positionId,
        method: "excess_returns",
        intrinsicValue: range.base,
        intrinsicValueLow: range.low,
        intrinsicValueHigh: range.high,
        currentPrice,
        marginOfSafetyPct: mosPct,
        tier: compoundTier,
        dcfTier,
        relativeTier,
        assumptions: stored,
        reasoning: buildExcessReturnsReasoning(
          base.yearsUsed,
          base.stableRoe,
          costOfEquity,
          fundamentals?.beta ?? null,
          treasury.source,
        ),
      });
    }
    // Distressed bank/insurer: ROE or book value unreliable → fall through
    // to multiples with an explicit reason.
    return runMultiplesFallback(
      positionId,
      ticker,
      quote,
      fundamentals,
      currentPrice,
      "ROE-based excess returns not computable",
      relativeContext,
    );
  }

  // ─── Owner earnings / AFFO DCF path ──────────────────────────────────
  // REITs use the same formula but it's re-labeled as AFFO — for real
  // estate, NI + D&A − capex is the industry-standard AFFO approximation.
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
      relativeContext,
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

  const { mosPct, tier: dcfTier } = classifyMarginOfSafety(
    range.base,
    currentPrice,
  );
  const { compoundTier, relativeTier } = deriveCompoundTier(
    dcfTier,
    relativeContext,
  );

  // Terminal-value concentration at the base hurdle — surfaced in UI so the
  // reader can see when IV is dominated by the perpetuity (Damodaran's
  // warning; audit drift V1, 2026-04-18).
  const baseBreakdown = range.breakdowns.base;
  const baseEv = baseBreakdown.enterpriseValue;
  const pvBreakdown =
    baseEv > 0
      ? {
          stage_one_pct: baseBreakdown.pvOfStageOne / baseEv,
          stage_two_pct: baseBreakdown.pvOfStageTwo / baseEv,
          terminal_pct: baseBreakdown.pvOfTerminal / baseEv,
        }
      : undefined;

  const stored: DcfStoredAssumptions = {
    owner_earnings_base: ownerEarnings.value,
    net_income: ownerEarnings.netIncome,
    depreciation_amortization: ownerEarnings.depreciationAmortization,
    maintenance_capex_proxy: ownerEarnings.maintenanceCapexProxy,
    stage_one_growth: stageOneGrowth,
    terminal_growth: terminalGrowth,
    treasury_yield_pct: treasury.fiveYearAveragePct,
    treasury_current_pct: treasury.currentPct,
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
    relative_valuation: relativeContext?.snapshot,
    pv_breakdown: pvBreakdown,
  };

  const method: ValuationMethod = isRealEstate(sector) ? "affo_dcf" : "dcf";

  return saveValuation({
    positionId,
    method,
    intrinsicValue: range.base,
    intrinsicValueLow: range.low,
    intrinsicValueHigh: range.high,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier: compoundTier,
    dcfTier,
    relativeTier,
    assumptions: stored,
    reasoning:
      method === "affo_dcf"
        ? buildAffoReasoning(
            ownerEarnings.yearsUsed,
            stageOneGrowth,
            terminalGrowth,
            treasury.source,
          )
        : buildDcfReasoning(
            ownerEarnings.yearsUsed,
            stageOneGrowth,
            terminalGrowth,
            treasury.source,
          ),
  });
}

async function runMultiplesFallback(
  positionId: number,
  ticker: string,
  quote: Quote,
  fundamentals: Fundamentals | null,
  currentPrice: number,
  reasonNotApplicable: string,
  // Optional: a relative-valuation context already computed by the caller.
  // If null/undefined we'll try to compute it ourselves so the second anchor
  // still applies to multiples-based valuations.
  precomputedRelative?: RelativeValuationContext | null,
): Promise<Valuation> {
  const estimate = await estimateWithMultiples(ticker, quote, fundamentals);
  const { mosPct, tier: dcfTier } = classifyMarginOfSafety(
    estimate.intrinsic_value,
    currentPrice,
  );
  const relativeContext =
    precomputedRelative ?? (await computeRelativeValuationContext(ticker));
  const { compoundTier, relativeTier } = deriveCompoundTier(
    dcfTier,
    relativeContext,
  );

  return saveValuation({
    positionId,
    method: "ai_multiples",
    intrinsicValue: estimate.intrinsic_value,
    intrinsicValueLow: estimate.intrinsic_value,
    intrinsicValueHigh: estimate.intrinsic_value,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier: compoundTier,
    dcfTier,
    relativeTier,
    assumptions: {
      basis: estimate.basis,
      sector_multiple_used: estimate.sector_multiple_used,
      relative_valuation: relativeContext?.snapshot,
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

// AFFO-based DCF reasoning for REITs. The math is identical to owner
// earnings DCF (NI + D&A − avg capex) — for real estate this formula is
// the industry-standard AFFO proxy because property depreciation is
// non-cash and reported capex approximates maintenance.
export function buildAffoReasoning(
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
      ? `AFFO base approximates Funds From Operations minus maintenance capex: Net Income + D&A − ${yearsUsed}-year average capex. For real-estate businesses, property D&A is non-cash and reported capex approximates maintenance.`
      : yearsUsed > 0
        ? `AFFO base uses the latest year with a ${yearsUsed}-year capex average — noisy with this little history.`
        : `AFFO base falls back to trailing FCF (no multi-year history).`;
  return `${historyNote} Growth projected at ${growthText}. Terminal growth ${terminalAnchor}. Intrinsic value shown as a range across three hurdle rates (10% / 12% / 14%); the headline is the 12% base case.`;
}

// Excess Returns Model reasoning for banks/insurers. IV = current book
// value + PV of economic profits (ROE − Ke) × BV over a 10-year horizon,
// fading to zero excess returns at year 10 (competitive equilibrium).
export function buildExcessReturnsReasoning(
  yearsUsed: number,
  stableRoe: number,
  costOfEquity: number,
  beta: number | null,
  treasurySource: "yfinance_tnx" | "fallback",
): string {
  const roePct = (stableRoe * 100).toFixed(1);
  const kePct = (costOfEquity * 100).toFixed(1);
  const excessPct = ((stableRoe - costOfEquity) * 100).toFixed(1);
  const betaText = beta !== null ? `β ${beta.toFixed(2)}` : "β 1.0 (not reported)";
  const rfAnchor =
    treasurySource === "yfinance_tnx"
      ? "spot US 10-year Treasury yield"
      : "a 4% fallback (Treasury yield fetch unavailable)";
  const historyNote =
    yearsUsed >= 3
      ? `Stable ROE is the ${yearsUsed}-year median of Net Income / Equity.`
      : `Stable ROE uses only ${yearsUsed} year(s) of history — the median is noisy.`;
  return `Excess Returns Model (Damodaran): intrinsic value = current book value + present value of economic profits. ${historyNote} Stable ROE ${roePct}% vs Cost of Equity ${kePct}% (CAPM: ${betaText}, risk-free anchored to ${rfAnchor}, equity risk premium 5%) yields ${excessPct}pp of excess return. Stage 1 (years 1–5) projects book value compounding at ROE × retention; stage 2 (years 6–10) fades ROE to Cost of Equity; beyond year 10 excess returns collapse to zero (competitive equilibrium). Intrinsic value shown as a range across Cost of Equity ± 200bp.`;
}

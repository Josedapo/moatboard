// "Ensure" helpers — get-or-create flows used by the position detail page so
// the data is auto-computed on first visit, no buttons required.
//
// 2026-04-25 redesign: the primary valuation method is now `implied_return`
// (FCF Yield + Sustainable Growth + Δ Multiple → CAGR vs threshold by tier).
// The previous absolute-valuation methods (DCF / AFFO / Excess Returns / AI
// multiples) are still computed and persisted as a `cross_check` inside the
// `assumptions` JSONB, so users can see the deep-value lens in "Otros métodos"
// without it driving the verdict. See `lib/impliedReturn.ts` for the math.

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
  type AiMultiplesStoredAssumptions,
  type ImpliedReturnStoredAssumptions,
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
import { computeSustainableGrowth } from "@/lib/sustainableGrowth";
import {
  computeImpliedReturn,
  deriveMultipleChangeStress,
  deriveMultipleChangeBase,
  deriveBaseMultiple,
  deriveStressMultiple,
} from "@/lib/impliedReturn";
import { selectPrimaryMultipleSnapshot } from "@/lib/multipleSelection";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import { getPeerMedian } from "@/lib/peerMedians";
import type { Tier } from "@/lib/verdict";

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
  if (!peStats) return null;

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
// compound tier + the relative tier value (or null). Kept so legacy DCF /
// Excess Returns rows that pre-date implied_return still classify coherently.
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
  qualityTier?: Tier,
): Promise<Valuation | null> {
  const existing = await getValuationByPositionId(positionId);
  if (existing) return existing;
  return computeAndSaveValuation(
    positionId,
    ticker,
    quote,
    fundamentals,
    qualityTier,
  );
}

// Cross-check result shape — what the legacy absolute-valuation methods
// produce, kept inside the implied_return assumptions JSONB for users who
// want to see the deep-value lens.
type LegacyValuationResult = {
  method: "dcf" | "affo_dcf" | "excess_returns" | "ai_multiples";
  intrinsicValue: number;
  intrinsicValueLow: number;
  intrinsicValueHigh: number;
  dcfTier: DcfTier;
  marginOfSafetyPct: number;
  assumptions:
    | DcfStoredAssumptions
    | ExcessReturnsStoredAssumptions
    | AiMultiplesStoredAssumptions;
  reasoning: string;
};

// Core compute-and-save. Computes the implied-return verdict (primary)
// and the legacy absolute-valuation method (cross-check) in parallel,
// then persists with method='implied_return' and the legacy result
// stored under assumptions.cross_check.
export async function computeAndSaveValuation(
  positionId: number,
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  qualityTier?: Tier,
): Promise<Valuation | null> {
  if (!quote || quote.regularMarketPrice == null) {
    return null;
  }

  const currentPrice = quote.regularMarketPrice;
  const sharesOutstanding = quote.sharesOutstanding;
  const marketCap = quote.marketCap;

  // Carry-forward existing user overrides so regenerations don't silently
  // discard manual edits. The override fields live on assumptions JSONB;
  // when present, they bypass the auto-derivation downstream. Only the
  // dedicated server action (updateImpliedReturnOverrideAction) clears
  // them by setting to null.
  const existingValuation = await getValuationByPositionId(positionId);
  const existingAssumptions =
    existingValuation?.method === "implied_return"
      ? (existingValuation.assumptions as ImpliedReturnStoredAssumptions)
      : null;
  const carriedBaseOverride =
    existingAssumptions?.multiple_change_base_override ?? null;
  const carriedStressOverride =
    existingAssumptions?.multiple_change_stress_override ?? null;
  const carriedGrowthBaseOverride =
    existingAssumptions?.growth_base_override ?? null;
  const carriedGrowthStressOverride =
    existingAssumptions?.growth_stress_override ?? null;

  // Resolve the quality tier — needed for the implied-return threshold.
  // Caller can pass it; otherwise we read from moatboard_analyses; final
  // fallback is 'good' (middle-of-the-road threshold of 14% so the verdict
  // doesn't artificially inflate or deflate when the analysis is missing).
  let resolvedTier: Tier = qualityTier ?? "good";
  if (qualityTier === undefined) {
    const analysis = await getAnalysisByPositionId(positionId);
    if (analysis) resolvedTier = analysis.tier;
  }

  // Fetch multi-year, treasury, and relative history in parallel.
  const [multiYear, treasury, relativeContext] = await Promise.all([
    fetchMultiYearFundamentals(ticker),
    fetchTenYearTreasuryYieldAverage(),
    computeRelativeValuationContext(ticker),
  ]);

  const sector = quote.sector ?? null;
  const industry = quote.industry ?? null;

  // Legacy absolute-valuation result (cross-check). Always computed so users
  // can drill down into the deep-value lens. Returns null only when the
  // ticker is genuinely uncomputable (no shares outstanding, no method
  // applies) — in that case implied_return still runs if FCF and growth are
  // available.
  const legacy = await computeLegacyValuation({
    ticker,
    quote,
    fundamentals,
    multiYear,
    treasury,
    relativeContext,
    sharesOutstanding,
    currentPrice,
    sector,
    industry,
  });

  // Sustainable growth — base, stress, optimistic + the anchors used.
  const growth = computeSustainableGrowth({
    multiYear,
    fundamentals,
    sector,
    industry,
  });

  // FCF yield. Prefer TTM yfinance freeCashflow / market cap; fallback to
  // the most recent SEC fiscal-year FCF if TTM is unavailable.
  const fcfTtm =
    fundamentals?.freeCashflow !== null && fundamentals?.freeCashflow !== undefined
      ? fundamentals.freeCashflow
      : null;
  const recentSecFcf =
    multiYear && multiYear.years.length > 0
      ? (multiYear.years[multiYear.years.length - 1].freeCashFlow ?? null)
      : null;
  const fcf = fcfTtm ?? recentSecFcf ?? 0;
  const fcfYield = marketCap && marketCap > 0 ? fcf / marketCap : 0;

  // Resolve the primary multiple — whichever P/X is most informative for
  // this business per the AI guide, with a deterministic business-type
  // fallback. The same multiple drives both base (compress to median if
  // current > median, else hold at current) and stress (compress to Q1).
  // We need the AI guide to compute this, so it has to run BEFORE the
  // implied-return computation. Availability flags mirror the position
  // page's logic exactly so the guide is told which tools are renderable.
  const isDistributionReady = (
    s: { current: number | null; median: number | null; q1: number | null; q3: number | null; min: number | null; max: number | null } | null | undefined,
  ) =>
    !!s &&
    s.current !== null &&
    s.median !== null &&
    s.q1 !== null &&
    s.q3 !== null &&
    s.min !== null &&
    s.max !== null;
  const peAvailable = isDistributionReady(relativeContext?.snapshot.pe);
  const pfcfAvailable = isDistributionReady(relativeContext?.snapshot.fcf_yield);
  const pbAvailable = isDistributionReady(relativeContext?.snapshot.pb);
  const valuationGuide = await ensureValuationGuide(ticker, quote, fundamentals, {
    pe: peAvailable,
    pfcf: pfcfAvailable,
    pb: pbAvailable,
  });

  const primaryMultiple = selectPrimaryMultipleSnapshot({
    guide: valuationGuide,
    relative: relativeContext?.snapshot,
    sector,
    industry,
  });
  const primarySnapshot = primaryMultiple?.snapshot ?? null;
  const autoMultipleChangeBase = deriveMultipleChangeBase(primarySnapshot);
  const autoMultipleChangeStress = deriveMultipleChangeStress(primarySnapshot);
  const autoBaseTerminalMultiple = deriveBaseMultiple(primarySnapshot);
  const autoStressTerminalMultiple = deriveStressMultiple(primarySnapshot);

  // Peer median (cross-sectional anchor) — informational only, drives
  // the disclaimer in the calculator UI when the current multiple
  // significantly exceeds peer norm. Does NOT change the verdict math.
  const peerMedian = primaryMultiple
    ? getPeerMedian({
        sector,
        industry,
        multipleLabel: primaryMultiple.label,
      })
    : null;

  // Apply overrides if Joseda manually edited the terminal multiple in
  // a prior turn. The override is the persisted %/año; we use it
  // directly instead of the auto-derived value. Terminal multiple shown
  // in UI is computed from current * (1+override)^10 so it reflects
  // exactly what the user typed.
  const effectiveBaseChange = carriedBaseOverride ?? autoMultipleChangeBase;
  const effectiveStressChange =
    carriedStressOverride ?? autoMultipleChangeStress;
  const baseTerminalMultiple =
    carriedBaseOverride !== null && primaryMultiple?.current
      ? primaryMultiple.current * Math.pow(1 + carriedBaseOverride, 10)
      : autoBaseTerminalMultiple;
  const stressTerminalMultiple =
    carriedStressOverride !== null && primaryMultiple?.current
      ? primaryMultiple.current * Math.pow(1 + carriedStressOverride, 10)
      : autoStressTerminalMultiple;

  // Growth overrides applied: when Joseda has manually set a growth_*_override,
  // it replaces the auto-derived growth.base / growth.stress in the
  // CAGR computation. The auto values stay in the persisted growth.* fields
  // so the UI can show "auto: X% · manual: Y%".
  const effectiveGrowthBase = carriedGrowthBaseOverride ?? growth.base;
  const effectiveGrowthStress = carriedGrowthStressOverride ?? growth.stress;

  const impliedReturn = computeImpliedReturn({
    fcfYield,
    growthBase: effectiveGrowthBase,
    growthStress: effectiveGrowthStress,
    multipleChangeBase: effectiveBaseChange,
    multipleChangeStress: effectiveStressChange,
    qualityTier: resolvedTier,
    treasuryYield: treasury.currentPct,
  });

  // Build the cross-check block from the legacy result so users can see
  // the absolute-valuation lens without re-running the math.
  const crossCheck = legacy
    ? {
        method: legacy.method,
        intrinsic_value: legacy.intrinsicValue,
        intrinsic_value_low: legacy.intrinsicValueLow,
        intrinsic_value_high: legacy.intrinsicValueHigh,
        assumptions: legacy.assumptions,
        reasoning: legacy.reasoning,
      }
    : undefined;

  const stored: ImpliedReturnStoredAssumptions = {
    fcf_yield: fcfYield,
    fcf_ttm: fcf,
    market_cap: marketCap ?? 0,
    growth: {
      // base/stress here are the AUTO-derived values (from sustainable
      // growth computation). The UI reads effective via growth_*_override
      // ?? growth.base. base_cagr / stress_cagr already reflect effective.
      base: growth.base,
      stress: growth.stress,
      optimistic: growth.optimistic,
      driver: growth.driver,
      cap_applied: growth.capApplied,
      note: growth.note,
      anchors: growth.anchors,
    },
    growth_base_override: carriedGrowthBaseOverride,
    growth_stress_override: carriedGrowthStressOverride,
    multiple_change_base: effectiveBaseChange,
    multiple_change_stress: effectiveStressChange,
    multiple_change_base_override: carriedBaseOverride,
    multiple_change_stress_override: carriedStressOverride,
    multiple_label: primaryMultiple?.label,
    multiple_source: primaryMultiple?.source,
    multiple_current: primaryMultiple?.current ?? null,
    multiple_median: primaryMultiple?.median ?? null,
    multiple_q1: primaryMultiple?.q1 ?? null,
    multiple_base_terminal: baseTerminalMultiple,
    multiple_stress_terminal: stressTerminalMultiple,
    peer_median: peerMedian?.value ?? null,
    peer_median_label: primaryMultiple?.label,
    peer_median_source: peerMedian?.source ?? null,
    peer_median_match_key: peerMedian?.matchKey ?? null,
    quality_tier: resolvedTier,
    threshold: impliedReturn.threshold,
    floor: impliedReturn.floor,
    treasury_yield: treasury.currentPct,
    base_cagr: impliedReturn.baseCAGR,
    stress_cagr: impliedReturn.stressCAGR,
    optimistic_cagr: impliedReturn.optimisticCAGR,
    passes_attractiveness: impliedReturn.passesAttractiveness,
    passes_no_disaster: impliedReturn.passesNoDisaster,
    verdict: impliedReturn.verdict,
    verdict_reason: impliedReturn.reason,
    cross_check: crossCheck,
    relative_valuation: relativeContext?.snapshot,
  };

  // The DB schema requires intrinsic_value, intrinsic_value_low/high,
  // margin_of_safety_pct, tier, dcf_tier — kept for legacy back-compat.
  // For implied_return the meaningful fields live in assumptions; the
  // legacy columns are populated with cross-check values when available
  // so reads from old code paths still get something coherent.
  const ivBase = legacy?.intrinsicValue ?? currentPrice;
  const ivLow = legacy?.intrinsicValueLow ?? currentPrice;
  const ivHigh = legacy?.intrinsicValueHigh ?? currentPrice;
  const mosPct = legacy?.marginOfSafetyPct ?? 0;
  const dcfTier: DcfTier = legacy?.dcfTier ?? "fair";
  const { compoundTier, relativeTier } = deriveCompoundTier(
    dcfTier,
    relativeContext,
  );

  const reasoning = `${impliedReturn.reason}${legacy ? ` Cross-check (${legacy.method}): ${legacy.reasoning}` : ""}`;

  return saveValuation({
    positionId,
    method: "implied_return",
    intrinsicValue: ivBase,
    intrinsicValueLow: ivLow,
    intrinsicValueHigh: ivHigh,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier: compoundTier,
    dcfTier,
    relativeTier,
    assumptions: stored,
    reasoning,
  });
}

// ─── Legacy absolute-valuation pipeline (now: cross-check, not verdict) ──
// Pure compute — does not write to DB. Returns null when the ticker has no
// usable absolute-valuation method (negative shares, no FCF history, no
// book value for a bank, etc.).
async function computeLegacyValuation({
  ticker,
  quote,
  fundamentals,
  multiYear,
  treasury,
  relativeContext,
  sharesOutstanding,
  currentPrice,
  sector,
  industry,
}: {
  ticker: string;
  quote: Quote;
  fundamentals: Fundamentals | null;
  multiYear: Awaited<ReturnType<typeof fetchMultiYearFundamentals>>;
  treasury: Awaited<ReturnType<typeof fetchTenYearTreasuryYieldAverage>>;
  relativeContext: RelativeValuationContext | null;
  sharesOutstanding: number | null;
  currentPrice: number;
  sector: string | null;
  industry: string | null;
}): Promise<LegacyValuationResult | null> {
  if (sharesOutstanding === null || sharesOutstanding <= 0) {
    return computeMultiplesFallbackResult(
      ticker,
      quote,
      fundamentals,
      currentPrice,
      "shares outstanding not available",
      relativeContext,
    );
  }

  // Balance-sheet businesses → Excess Returns Model.
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

      return {
        method: "excess_returns",
        intrinsicValue: range.base,
        intrinsicValueLow: range.low,
        intrinsicValueHigh: range.high,
        dcfTier,
        marginOfSafetyPct: mosPct,
        assumptions: stored,
        reasoning: buildExcessReturnsReasoning(
          base.yearsUsed,
          base.stableRoe,
          costOfEquity,
          fundamentals?.beta ?? null,
          treasury.source,
        ),
      };
    }
    return computeMultiplesFallbackResult(
      ticker,
      quote,
      fundamentals,
      currentPrice,
      "ROE-based excess returns not computable",
      relativeContext,
    );
  }

  // Owner-earnings / AFFO DCF path.
  const trailingFcf = fundamentals?.freeCashflow ?? null;
  const ownerEarnings = computeOwnerEarningsBase(multiYear, trailingFcf);

  if (!ownerEarnings || ownerEarnings.value <= 0) {
    const reason =
      trailingFcf !== null && trailingFcf <= 0
        ? "owner earnings / FCF is negative"
        : "cash-flow base not available";
    return computeMultiplesFallbackResult(
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

  return {
    method: method === "affo_dcf" ? "affo_dcf" : "dcf",
    intrinsicValue: range.base,
    intrinsicValueLow: range.low,
    intrinsicValueHigh: range.high,
    dcfTier,
    marginOfSafetyPct: mosPct,
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
  };
}

async function computeMultiplesFallbackResult(
  ticker: string,
  quote: Quote,
  fundamentals: Fundamentals | null,
  currentPrice: number,
  reasonNotApplicable: string,
  relativeContext: RelativeValuationContext | null,
): Promise<LegacyValuationResult | null> {
  try {
    const estimate = await estimateWithMultiples(ticker, quote, fundamentals);
    const { mosPct, tier: dcfTier } = classifyMarginOfSafety(
      estimate.intrinsic_value,
      currentPrice,
    );
    const stored: AiMultiplesStoredAssumptions = {
      basis: estimate.basis,
      sector_multiple_used: estimate.sector_multiple_used,
      relative_valuation: relativeContext?.snapshot,
    };
    return {
      method: "ai_multiples",
      intrinsicValue: estimate.intrinsic_value,
      intrinsicValueLow: estimate.intrinsic_value,
      intrinsicValueHigh: estimate.intrinsic_value,
      dcfTier,
      marginOfSafetyPct: mosPct,
      assumptions: stored,
      reasoning: `${estimate.reasoning} (DCF not applicable: ${reasonNotApplicable}.)`,
    };
  } catch (err) {
    console.warn(
      `AI multiples fallback failed for ${ticker}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
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

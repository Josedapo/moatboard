// Pure functions — no I/O, no SDK. Owner-earnings two-stage DCF and
// Margin of Safety classification. Reusable by server actions today and
// by the Phase 2 public DCF Calculator (KD 6, ~1300 vol/mo).

import type {
  AnnualFundamentalRow,
  MultiYearFundamentals,
} from "@/lib/financial";

export type MosTier = "margin" | "acceptable" | "fair" | "premium";

export const HORIZON_YEARS = 10;
export const STAGE_ONE_YEARS = 5; // years at observed growth (capped)
export const MAX_STAGE_ONE_GROWTH = 0.15; // cap to prevent hockey sticks
export const DEFAULT_HURDLE_RATES = [0.1, 0.12, 0.14] as const; // base/mid/high

export type OwnerEarningsBase = {
  value: number; // dollars of owner earnings per year (base year)
  netIncome: number;
  depreciationAmortization: number;
  maintenanceCapexProxy: number; // absolute dollars, positive number
  yearsUsed: number;
  note?: string; // e.g. "Insufficient history" / "Using trailing FCF fallback"
};

// Owner earnings (Buffett 1986) = Net Income + D&A − maintenance capex.
// We approximate maintenance capex as the 5-year average of reported capex.
// yfinance reports capex as a negative cash-flow outflow — we take its
// absolute value. If multi-year data isn't available we fall back to
// trailing FCF so the DCF still runs, with a note surfaced to the user.
export function computeOwnerEarningsBase(
  multiYear: MultiYearFundamentals | null,
  fallbackTrailingFcf: number | null,
): OwnerEarningsBase | null {
  if (!multiYear || multiYear.years.length === 0) {
    if (fallbackTrailingFcf !== null && fallbackTrailingFcf > 0) {
      return {
        value: fallbackTrailingFcf,
        netIncome: 0,
        depreciationAmortization: 0,
        maintenanceCapexProxy: 0,
        yearsUsed: 0,
        note: "No annual history — using trailing FCF as base",
      };
    }
    return null;
  }

  const rows = multiYear.years;
  const usable = rows.filter(
    (r) =>
      r.netIncome !== null &&
      r.depreciationAmortization !== null &&
      r.capitalExpenditure !== null,
  );

  if (usable.length === 0) {
    if (fallbackTrailingFcf !== null && fallbackTrailingFcf > 0) {
      return {
        value: fallbackTrailingFcf,
        netIncome: 0,
        depreciationAmortization: 0,
        maintenanceCapexProxy: 0,
        yearsUsed: 0,
        note: "Owner earnings inputs missing — using trailing FCF",
      };
    }
    return null;
  }

  // Most recent year: base NI and D&A. Capex: 5-year average (absolute).
  const latest = usable[usable.length - 1] as AnnualFundamentalRow;
  const capexAbs =
    usable
      .map((r) => Math.abs(r.capitalExpenditure as number))
      .reduce((s, v) => s + v, 0) / usable.length;

  const value =
    (latest.netIncome as number) +
    (latest.depreciationAmortization as number) -
    capexAbs;

  return {
    value,
    netIncome: latest.netIncome as number,
    depreciationAmortization: latest.depreciationAmortization as number,
    maintenanceCapexProxy: capexAbs,
    yearsUsed: usable.length,
    note:
      usable.length < 3 ? "Insufficient history — capex proxy is noisy" : undefined,
  };
}

// Observed 5-year revenue CAGR, capped at MAX_STAGE_ONE_GROWTH so a pandemic
// rebound or a recent IPO hockey-stick can't drive the entire 10y projection.
export function observedGrowthRate(
  multiYear: MultiYearFundamentals | null,
): number {
  if (!multiYear || multiYear.years.length < 2) return 0.04; // conservative default
  const withRevenue = multiYear.years.filter(
    (r): r is AnnualFundamentalRow & { revenue: number } =>
      r.revenue !== null && r.revenue > 0,
  );
  if (withRevenue.length < 2) return 0.04;
  const oldest = withRevenue[0].revenue;
  const newest = withRevenue[withRevenue.length - 1].revenue;
  const years = withRevenue.length - 1;
  const cagr = Math.pow(newest / oldest, 1 / years) - 1;
  // Clamp to a sane band. Negative-growth businesses won't be valuation
  // candidates anyway (scorecard sends them to Poor before we reach here).
  return Math.min(Math.max(cagr, 0), MAX_STAGE_ONE_GROWTH);
}

export type TwoStageDcfInputs = {
  ownerEarningsBase: number;
  stageOneGrowth: number; // years 1..5, already capped
  terminalGrowth: number; // long-term anchor (e.g. 5y treasury avg)
  discountRate: number;
  netDebt: number;
  sharesOutstanding: number;
};

export type DcfBreakdown = {
  intrinsicValue: number;
  enterpriseValue: number;
  equityValue: number;
  pvOfStageOne: number;
  pvOfStageTwo: number;
  pvOfTerminal: number;
  terminalValue: number;
  projectedCashFlows: Array<{ year: number; cashFlow: number; growth: number }>;
};

// Two-stage DCF:
//   Stage 1 (years 1..5):    grow at stageOneGrowth each year
//   Stage 2 (years 6..10):   growth fades geometrically from stageOneGrowth
//                            to terminalGrowth (linear decay in log space)
//   Terminal:                Gordon growth perpetuity from year 10
export function computeTwoStageDcf(inputs: TwoStageDcfInputs): DcfBreakdown {
  const {
    ownerEarningsBase,
    stageOneGrowth,
    terminalGrowth,
    discountRate,
    netDebt,
    sharesOutstanding,
  } = inputs;

  if (sharesOutstanding <= 0) {
    throw new Error("sharesOutstanding must be positive");
  }
  if (discountRate <= terminalGrowth) {
    throw new Error("discountRate must exceed terminalGrowth (Gordon model)");
  }

  const projected: Array<{ year: number; cashFlow: number; growth: number }> = [];
  let pvOfStageOne = 0;
  let pvOfStageTwo = 0;
  let current = ownerEarningsBase;

  for (let t = 1; t <= HORIZON_YEARS; t++) {
    let growth: number;
    if (t <= STAGE_ONE_YEARS) {
      growth = stageOneGrowth;
    } else {
      // Fade: interpolate between stageOneGrowth (year 5) and terminalGrowth (year 10)
      const progress = (t - STAGE_ONE_YEARS) / (HORIZON_YEARS - STAGE_ONE_YEARS);
      growth = stageOneGrowth + (terminalGrowth - stageOneGrowth) * progress;
    }

    current = current * (1 + growth);
    const pv = current / Math.pow(1 + discountRate, t);
    projected.push({ year: t, cashFlow: current, growth });

    if (t <= STAGE_ONE_YEARS) pvOfStageOne += pv;
    else pvOfStageTwo += pv;
  }

  const lastCashFlow = projected[projected.length - 1].cashFlow;
  const terminalValue =
    (lastCashFlow * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const pvOfTerminal = terminalValue / Math.pow(1 + discountRate, HORIZON_YEARS);

  const enterpriseValue = pvOfStageOne + pvOfStageTwo + pvOfTerminal;
  const equityValue = enterpriseValue - netDebt;
  const intrinsicValue = equityValue / sharesOutstanding;

  return {
    intrinsicValue,
    enterpriseValue,
    equityValue,
    pvOfStageOne,
    pvOfStageTwo,
    pvOfTerminal,
    terminalValue,
    projectedCashFlows: projected,
  };
}

export type IntrinsicValueRange = {
  low: number; // most pessimistic hurdle rate (14%)
  base: number; // 12%
  high: number; // 10%
  hurdleRates: { low: number; base: number; high: number };
  breakdowns: {
    low: DcfBreakdown;
    base: DcfBreakdown;
    high: DcfBreakdown;
  };
};

// Run the same DCF at three hurdle rates so the UI can present IV as a range.
// Buffett operates in ranges with higher hurdle rates for riskier business —
// 14% for the "bear" lens, 10% for the "bull" lens, 12% in the middle.
export function computeIntrinsicValueRange(
  params: Omit<TwoStageDcfInputs, "discountRate">,
): IntrinsicValueRange {
  const [bull, base, bear] = DEFAULT_HURDLE_RATES; // 10, 12, 14
  const lowBreakdown = computeTwoStageDcf({ ...params, discountRate: bear });
  const baseBreakdown = computeTwoStageDcf({ ...params, discountRate: base });
  const highBreakdown = computeTwoStageDcf({ ...params, discountRate: bull });
  return {
    low: lowBreakdown.intrinsicValue,
    base: baseBreakdown.intrinsicValue,
    high: highBreakdown.intrinsicValue,
    hurdleRates: { low: bear, base, high: bull },
    breakdowns: {
      low: lowBreakdown,
      base: baseBreakdown,
      high: highBreakdown,
    },
  };
}

export type ClassificationResult = {
  mosPct: number; // positive = margin of safety; negative = price above intrinsic
  ivPriceRatio: number; // IV / Price; >1 below intrinsic, <1 above intrinsic
  tier: MosTier;
};

export function classifyMarginOfSafety(
  intrinsicValue: number,
  currentPrice: number,
): ClassificationResult {
  if (intrinsicValue <= 0 || currentPrice <= 0) {
    return { mosPct: 0, ivPriceRatio: 0, tier: "premium" };
  }

  // IV/Price ratio = IV / Price  (1.15x means IV is 15% higher than price)
  // MoS%           = (IV/Price - 1) × 100. Positive = trading below intrinsic.
  const ivPriceRatio = intrinsicValue / currentPrice;
  const mosPct = (ivPriceRatio - 1) * 100;

  // Buffett-aligned thresholds. The philosophy review rejects the earlier
  // 20% "margin of safety": Graham/early Buffett wanted 33–50%+, and any
  // price above intrinsic value is simply "premium" — the degree is not a
  // decision input, since you don't buy at a premium regardless.
  //   IV/P ≥ 1.40  → margin       (≥ 40% MoS)
  //   1.15 – 1.40  → acceptable   (15–40%)
  //   0.90 – 1.15  → fair         (−10% to +15%)
  //   < 0.90       → premium      (price above intrinsic)
  let tier: MosTier;
  if (ivPriceRatio >= 1.4) tier = "margin";
  else if (ivPriceRatio >= 1.15) tier = "acceptable";
  else if (ivPriceRatio >= 0.9) tier = "fair";
  else tier = "premium";

  return { mosPct, ivPriceRatio, tier };
}

export const MOS_TIER_LABELS: Record<MosTier, string> = {
  margin: "Margin of Safety",
  acceptable: "Acceptable",
  fair: "Fair Price",
  premium: "Premium",
};

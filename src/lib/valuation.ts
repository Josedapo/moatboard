// Pure functions — no I/O, no SDK. Owner-earnings two-stage DCF and
// Margin of Safety classification. Reusable by server actions today and
// by the Phase 2 public DCF Calculator (KD 6, ~1300 vol/mo).

import type {
  AnnualFundamentalRow,
  Fundamentals,
  MultiYearFundamentals,
} from "@/lib/financial";

// DCF-only tier (kept for the inner Margin of Safety classifier and for the
// "dcf_only" fallback when relative history is missing). `MosTier` is kept as
// an alias so call sites that specifically mean the DCF MoS classification
// stay readable.
export type DcfTier = "margin" | "acceptable" | "fair" | "premium";
export type MosTier = DcfTier;

// Relative tier: where the business trades vs its own 10y (or 5-7y) multiple
// distribution, with IQR-outlier exclusion. Drift M (philosophy review,
// 2026-04-16) — Buffett/Munger value wonderful businesses against their own
// history, not against a generic DCF bar.
export type RelativeTier = "rare" | "within" | "above" | "stratospheric";

// Compound valuation tier — the public display. Combines DCF + Relative.
// `dcf_only` is the fallback when relative history is unavailable (new IPOs,
// broken time-series, etc.) — UI falls back to the DCF tier's vocabulary.
export type CompoundTier =
  | "rare_opportunity"
  | "within_historical"
  | "above_historical"
  | "stratospheric"
  | "dcf_only";

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

// --- Excess Returns Model (banks, insurers, balance-sheet businesses) ---
//
// Standard Damodaran formulation. For businesses where "invested capital"
// is not a product-economics concept — banks (deposits as liabilities),
// insurers (reserves as liabilities), asset managers (fees as revenue) —
// the right absolute valuation is:
//
//   IV = Book Value + Σ PV of (ROE − Cost of Equity) × BV_{t−1}
//
// If the business earns ROE = Ke, no economic value is created and IV =
// Book Value. If it earns above Ke, the excess compounds over time. We
// stop excess returns at year 10 — the assumption that competitive
// equilibrium eventually arrives (zero economic profit in steady state).

export const EQUITY_RISK_PREMIUM = 0.05; // textbook US historical middle

export type CostOfEquityInputs = {
  beta: number | null;
  riskFreeRate: number | null; // decimal (e.g. 0.043)
  equityRiskPremium?: number;
};

export function computeCostOfEquity({
  beta,
  riskFreeRate,
  equityRiskPremium = EQUITY_RISK_PREMIUM,
}: CostOfEquityInputs): number {
  const rf = riskFreeRate !== null && Number.isFinite(riskFreeRate) ? riskFreeRate : 0.04;
  const b = beta !== null && Number.isFinite(beta) ? beta : 1.0;
  return rf + b * equityRiskPremium;
}

export type ExcessReturnsBase = {
  bookValue: number; // current stockholders' equity, absolute USD
  stableRoe: number; // multi-year median ROE (decimal)
  retentionRatio: number; // 1 − payoutRatio, clamped to [0, 0.95]
  sharesOutstanding: number;
  yearsUsed: number;
  note?: string;
};

// Multi-year median ROE from annual rows. Requires netIncome and
// stockholdersEquity both available and equity positive for each year.
function computeMedianRoe(
  rows: AnnualFundamentalRow[],
): { median: number | null; yearsUsed: number } {
  const series = rows
    .map((r) => {
      if (
        r.netIncome === null ||
        r.stockholdersEquity === null ||
        r.stockholdersEquity <= 0
      )
        return null;
      return r.netIncome / r.stockholdersEquity;
    })
    .filter((x): x is number => x !== null);
  if (series.length === 0) return { median: null, yearsUsed: 0 };
  const sorted = [...series].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, yearsUsed: series.length };
}

export function computeExcessReturnsBase(
  multiYear: MultiYearFundamentals | null,
  fundamentals: Fundamentals | null,
  sharesOutstanding: number,
): ExcessReturnsBase | null {
  if (!multiYear || multiYear.years.length === 0) return null;
  const rows = multiYear.years;

  // Book value: latest reported stockholders' equity. Must be positive.
  const latestWithEquity = [...rows]
    .reverse()
    .find((r) => r.stockholdersEquity !== null && r.stockholdersEquity > 0);
  if (!latestWithEquity) return null;
  const bookValue = latestWithEquity.stockholdersEquity as number;

  const { median, yearsUsed } = computeMedianRoe(rows);
  if (median === null || yearsUsed < 2 || median <= 0) return null;

  // Retention ratio = what fraction of earnings is kept (grows BV). Fallback
  // to 0.5 when yfinance doesn't expose payoutRatio. Clamped to avoid
  // pathological values (a bank paying 99% of earnings is an edge case; we
  // still allow some retention so BV grows).
  const payout = fundamentals?.payoutRatio;
  let retention: number;
  if (payout === null || payout === undefined || !Number.isFinite(payout)) {
    retention = 0.5;
  } else {
    retention = 1 - payout;
  }
  retention = Math.max(0, Math.min(0.95, retention));

  return {
    bookValue,
    stableRoe: median,
    retentionRatio: retention,
    sharesOutstanding,
    yearsUsed,
    note:
      yearsUsed < 3
        ? "Insufficient history (<3 years) — ROE median is noisy"
        : undefined,
  };
}

export type ExcessReturnsInputs = {
  bookValue: number;
  stableRoe: number;
  retentionRatio: number;
  costOfEquity: number;
  terminalRoe: number; // ROE at year 10 (typically = costOfEquity)
  sharesOutstanding: number;
};

export type ExcessReturnsBreakdown = {
  intrinsicValue: number; // per share
  bookValuePerShare: number;
  pvOfExcessReturns: number; // sum over horizon, absolute USD
  projected: Array<{
    year: number;
    bookValueStart: number;
    roe: number;
    excessReturn: number;
    pv: number;
  }>;
};

export function computeExcessReturnsValuation(
  inputs: ExcessReturnsInputs,
): ExcessReturnsBreakdown {
  const {
    bookValue,
    stableRoe,
    retentionRatio,
    costOfEquity,
    terminalRoe,
    sharesOutstanding,
  } = inputs;

  if (sharesOutstanding <= 0) {
    throw new Error("sharesOutstanding must be positive");
  }
  if (costOfEquity <= 0) {
    throw new Error("costOfEquity must be positive");
  }

  let bv = bookValue;
  let pvOfExcessReturns = 0;
  const projected: ExcessReturnsBreakdown["projected"] = [];

  for (let t = 1; t <= HORIZON_YEARS; t++) {
    let roe: number;
    if (t <= STAGE_ONE_YEARS) {
      roe = stableRoe;
    } else {
      // Linear fade from stableRoe at year STAGE_ONE_YEARS to terminalRoe at HORIZON_YEARS
      const progress =
        (t - STAGE_ONE_YEARS) / (HORIZON_YEARS - STAGE_ONE_YEARS);
      roe = stableRoe + (terminalRoe - stableRoe) * progress;
    }
    const excessReturn = (roe - costOfEquity) * bv;
    const pv = excessReturn / Math.pow(1 + costOfEquity, t);
    projected.push({
      year: t,
      bookValueStart: bv,
      roe,
      excessReturn,
      pv,
    });
    pvOfExcessReturns += pv;
    // BV grows by retained earnings (ROE × retention) for the next year.
    bv = bv * (1 + roe * retentionRatio);
  }

  // Terminal: zero excess returns beyond year 10 (steady state at ROE = Ke).
  // IV = current book value + present value of all excess returns over the horizon.
  const totalEquityValue = bookValue + pvOfExcessReturns;
  const intrinsicValue = totalEquityValue / sharesOutstanding;
  const bookValuePerShare = bookValue / sharesOutstanding;

  return {
    intrinsicValue,
    bookValuePerShare,
    pvOfExcessReturns,
    projected,
  };
}

export type ExcessReturnsRange = {
  low: number; // most pessimistic Ke (Ke + 200bp)
  base: number; // base Ke
  high: number; // most optimistic Ke (Ke − 200bp)
  costsOfEquity: { low: number; base: number; high: number };
  breakdowns: {
    low: ExcessReturnsBreakdown;
    base: ExcessReturnsBreakdown;
    high: ExcessReturnsBreakdown;
  };
};

// Three-cost-of-equity range — consistent with the DCF's three-hurdle-rate
// range so the Bear/Base/Bull visual vocabulary applies to both methods.
// Ke ± 200bp reflects reasonable uncertainty on beta and ERP.
export function computeExcessReturnsRange(
  params: Omit<ExcessReturnsInputs, "costOfEquity"> & { costOfEquity: number },
): ExcessReturnsRange {
  const ke = params.costOfEquity;
  const bearKe = ke + 0.02;
  const bullKe = Math.max(0.04, ke - 0.02);
  const lowBreakdown = computeExcessReturnsValuation({
    ...params,
    costOfEquity: bearKe,
    terminalRoe: bearKe,
  });
  const baseBreakdown = computeExcessReturnsValuation({
    ...params,
    costOfEquity: ke,
    terminalRoe: ke,
  });
  const highBreakdown = computeExcessReturnsValuation({
    ...params,
    costOfEquity: bullKe,
    terminalRoe: bullKe,
  });
  return {
    low: lowBreakdown.intrinsicValue,
    base: baseBreakdown.intrinsicValue,
    high: highBreakdown.intrinsicValue,
    costsOfEquity: { low: bearKe, base: ke, high: bullKe },
    breakdowns: {
      low: lowBreakdown,
      base: baseBreakdown,
      high: highBreakdown,
    },
  };
}

// Labels for the compound tier. Non-blocking language — "Within historical
// range" does not tell the buy-and-hold investor "don't buy"; it says "this
// price is coherent with what the market has paid for this business for a
// decade." Only "Stratospheric for this business" is an unambiguous red flag.
export const COMPOUND_TIER_LABELS: Record<CompoundTier, string> = {
  rare_opportunity: "Rare opportunity",
  within_historical: "Within historical range",
  above_historical: "Above historical, defensible",
  stratospheric: "Stratospheric for this business",
  dcf_only: "DCF only",
};

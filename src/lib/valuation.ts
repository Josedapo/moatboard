// Pure functions — no I/O, no SDK. DCF computation and Margin of Safety
// classification. Reusable by server actions today and by the Phase 2 public
// DCF Calculator (KD 6, ~1300 vol/mo).

export type MosTier = "margin" | "fair" | "premium" | "overvalued";

export type DcfInputs = {
  fcfBase: number;
  growthRate: number; // years 1-10, e.g. 0.10 = 10%
  terminalGrowth: number; // e.g. 0.025 = 2.5%
  discountRate: number; // WACC, e.g. 0.10 = 10%
  netDebt: number; // totalDebt - totalCash
  sharesOutstanding: number;
};

export type DcfBreakdown = {
  intrinsicValue: number;
  enterpriseValue: number;
  equityValue: number;
  pvOfFcfs: number;
  pvOfTerminal: number;
  terminalValue: number;
};

const HORIZON_YEARS = 10;

export function computeDcfIntrinsicValue(inputs: DcfInputs): DcfBreakdown {
  const { fcfBase, growthRate, terminalGrowth, discountRate, netDebt, sharesOutstanding } = inputs;

  if (sharesOutstanding <= 0) {
    throw new Error("sharesOutstanding must be positive");
  }
  if (discountRate <= terminalGrowth) {
    throw new Error("discountRate must exceed terminalGrowth (Gordon model)");
  }

  let pvOfFcfs = 0;
  let lastFcf = fcfBase;
  for (let t = 1; t <= HORIZON_YEARS; t++) {
    const fcfT = fcfBase * Math.pow(1 + growthRate, t);
    pvOfFcfs += fcfT / Math.pow(1 + discountRate, t);
    if (t === HORIZON_YEARS) lastFcf = fcfT;
  }

  const terminalValue =
    (lastFcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const pvOfTerminal = terminalValue / Math.pow(1 + discountRate, HORIZON_YEARS);

  const enterpriseValue = pvOfFcfs + pvOfTerminal;
  const equityValue = enterpriseValue - netDebt;
  const intrinsicValue = equityValue / sharesOutstanding;

  return {
    intrinsicValue,
    enterpriseValue,
    equityValue,
    pvOfFcfs,
    pvOfTerminal,
    terminalValue,
  };
}

export type ClassificationResult = {
  mosPct: number; // positive = margin of safety; negative = overvalued (above intrinsic)
  ivPriceRatio: number; // IV / Price; >1 undervalued, <1 overvalued
  tier: MosTier;
};

export function classifyMarginOfSafety(
  intrinsicValue: number,
  currentPrice: number,
): ClassificationResult {
  if (intrinsicValue <= 0 || currentPrice <= 0) {
    return { mosPct: 0, ivPriceRatio: 0, tier: "overvalued" };
  }

  // Vigil-aligned formulation (matches how value investors typically think):
  //   IV/Price ratio = IV / Price  (1.15x means IV is 15% higher than price)
  //   MoS%           = (IV - Price) / Price × 100
  //                  = (IV/Price - 1) × 100
  // Positive MoS = trading below intrinsic (good), Negative = above intrinsic (bad).
  const ivPriceRatio = intrinsicValue / currentPrice;
  const mosPct = (ivPriceRatio - 1) * 100;

  // Tier thresholds (Buffett-aligned):
  //   IV/P ≥ 1.20x → margin       (≥ 20% MoS)
  //   0.85x – 1.20x → fair        (-15% to +20%)
  //   0.65x – 0.85x → premium     (-35% to -15%)
  //   < 0.65x → overvalued        (< -35%)
  let tier: MosTier;
  if (ivPriceRatio >= 1.20) tier = "margin";
  else if (ivPriceRatio >= 0.85) tier = "fair";
  else if (ivPriceRatio >= 0.65) tier = "premium";
  else tier = "overvalued";

  return { mosPct, ivPriceRatio, tier };
}

export const MOS_TIER_LABELS: Record<MosTier, string> = {
  margin: "Margin of Safety",
  fair: "Fair Price",
  premium: "Premium",
  overvalued: "Overvalued",
};

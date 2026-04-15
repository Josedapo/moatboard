// Pure functions — no I/O, no SDK. DCF computation and Margin of Safety
// classification. Reusable by server actions today and by the Phase 2 public
// DCF Calculator (KD 6, ~1300 vol/mo).

export type MosTier = "margin" | "acceptable" | "fair" | "premium";

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

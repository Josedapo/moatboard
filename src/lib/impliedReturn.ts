// Implied Return — the central frame of Moatboard's Valuation section after
// the 2026-04-25 redesign.
//
// The question Moatboard now answers operationally:
//
//   "If I buy this business at the current price and hold it for 10 years,
//    what annual return can I reasonably expect — and is the worst case
//    not a disaster?"
//
// The formula (Buffett's "owner returns", Smith's three-pillar framing):
//
//   Expected CAGR ≈ FCF Yield + Sustainable Growth + Δ Multiple
//
// Three components:
//   - FCF Yield = trailing FCF / market cap. The cash the business returns
//     to the holder the first year at the current price. Smith's anchor.
//   - Sustainable growth (base) = min(historical CAGR, ROIC × retention).
//     The disciplined growth assumption — never extrapolate above the
//     fundamental ceiling.
//   - Δ Multiple (annualized) = the assumed change in P/FCF over 10 years.
//     Default 0% (multiple stable). Stress case assumes compression to Q1.
//
// Decision rule — Buffett's "two-step" applied:
//
//   Step 1 (Attractiveness):  Base CAGR ≥ tier threshold
//                             (Exceptional ≥12%, Good ≥14%, Mediocre ≥17%)
//   Step 2 (No-disaster):     Stress CAGR ≥ floor
//                             (Treasury 10y + 2%)
//
//   Both must pass for the business to be "comprable at current price".
//
// The thresholds-by-tier reflect the asymmetry between quality and variance:
// an Exceptional with 12% expected return is a better investment than a
// Mediocre with 18%, because the variance around the base is lower for the
// Exceptional (the bear case is not a disaster). Higher-tier thresholds
// for lower quality compensate the higher variance on those tiers.

import type { Tier } from "@/lib/verdict";

// Tier thresholds. Anchored on:
//   - Buffett: "the price you pay determines your rate of return"
//   - Damodaran: equity premium 5% over 10y Treasury (~4.5% in 2026)
//     → equity benchmark ~9.5-10%
//   - Quality compounders earn a margin above the index over time
//     (Smith, Polen, Akre data: 12-15% long-run for top-quartile)
// Higher tiers earn lower thresholds because the variance is tighter —
// an Exceptional reliably compounds near its base, a Mediocre might miss
// by a wide margin. The asymmetry rewards quality.
export const TIER_THRESHOLDS: Record<Tier, number> = {
  exceptional: 0.12,
  good: 0.14,
  mediocre: 0.17,
  // The "Moatboard can't analyze" gate normally blocks Poor before reaching
  // valuation. If it ever surfaces, we still need a number for completeness.
  poor: 0.2,
};

// Floor (no-disaster threshold) = Treasury 10y + 2%. Below this in stress
// case means even the bear scenario doesn't beat the bond by a reasonable
// margin — opportunity cost is too high regardless of base expectations.
export const FLOOR_PREMIUM_OVER_TREASURY = 0.02;

// Default multiple change assumption: 0% (multiple stable). Conservative.
// Stress case assumes some compression — handled by the calculator caller.
export const DEFAULT_MULTIPLE_CHANGE = 0;

export type ImpliedReturnInputs = {
  fcfYield: number; // decimal, e.g. 0.047 for 4.7%
  growthBase: number; // decimal
  growthStress: number; // decimal
  multipleChangeBase: number; // annualized decimal, signed
  multipleChangeStress: number; // annualized decimal, signed (typically more negative)
  qualityTier: Tier;
  treasuryYield: number; // decimal, current 10y Treasury
};

export type ImpliedReturnResult = {
  baseCAGR: number;
  stressCAGR: number;
  optimisticCAGR: number; // for reference; not part of the verdict
  threshold: number; // tier threshold
  floor: number; // treasury + premium
  passesAttractiveness: boolean; // baseCAGR >= threshold
  passesNoDisaster: boolean; // stressCAGR >= floor
  verdict: ImpliedReturnVerdict;
  reason: string; // one-line user-facing rationale (Spanish)
};

export type ImpliedReturnVerdict =
  | "comprable" // both checks pass
  | "no_comprable_caro" // attractiveness fails — base too low for tier
  | "no_comprable_riesgo" // attractiveness passes but stress fails — asymmetric risk
  | "no_comprable_ambos"; // both fail

export function computeImpliedReturn({
  fcfYield,
  growthBase,
  growthStress,
  multipleChangeBase,
  multipleChangeStress,
  qualityTier,
  treasuryYield,
}: ImpliedReturnInputs): ImpliedReturnResult {
  const baseCAGR = fcfYield + growthBase + multipleChangeBase;
  const stressCAGR = fcfYield + growthStress + multipleChangeStress;
  const optimisticCAGR = fcfYield + growthBase; // multiple stable = optimistic-ish lens

  const threshold = TIER_THRESHOLDS[qualityTier];
  const floor = treasuryYield + FLOOR_PREMIUM_OVER_TREASURY;

  const passesAttractiveness = baseCAGR >= threshold;
  const passesNoDisaster = stressCAGR >= floor;

  let verdict: ImpliedReturnVerdict;
  let reason: string;

  if (passesAttractiveness && passesNoDisaster) {
    verdict = "comprable";
    reason = `Caso base ${pct(baseCAGR)} supera el umbral ${pct(threshold)} para ${tierLabel(qualityTier)}. Estrés ${pct(stressCAGR)} supera el suelo ${pct(floor)} (Treasury + 2%).`;
  } else if (!passesAttractiveness && !passesNoDisaster) {
    verdict = "no_comprable_ambos";
    reason = `Base ${pct(baseCAGR)} por debajo del umbral ${pct(threshold)} y estrés ${pct(stressCAGR)} por debajo del suelo ${pct(floor)}. Precio caro para esta calidad y riesgo asimétrico.`;
  } else if (!passesAttractiveness) {
    verdict = "no_comprable_caro";
    reason = `Caso base ${pct(baseCAGR)} no supera el umbral ${pct(threshold)} para ${tierLabel(qualityTier)}. Buen negocio, mal precio.`;
  } else {
    verdict = "no_comprable_riesgo";
    reason = `Base ${pct(baseCAGR)} cumple el umbral, pero el estrés ${pct(stressCAGR)} cae por debajo del suelo ${pct(floor)}. Riesgo asimétrico — el escenario malo no compensa.`;
  }

  return {
    baseCAGR,
    stressCAGR,
    optimisticCAGR,
    threshold,
    floor,
    passesAttractiveness,
    passesNoDisaster,
    verdict,
    reason,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function tierLabel(t: Tier): string {
  switch (t) {
    case "exceptional":
      return "Exceptional";
    case "good":
      return "Good";
    case "mediocre":
      return "Mediocre";
    case "poor":
      return "Poor";
  }
}

// Convenience: derive the multiple-change stress assumption from the
// PE / P-FCF distribution snapshot. If current multiple is at percentile X
// of its own history, a stress scenario assumes compression to Q1 over
// 10 years. Returns annualized decimal, always ≤ 0 (compression, not expansion).
//
// Formula: if current multiple is M_now and Q1 is M_q1, total compression
// over 10y = M_q1 / M_now − 1. Annualized = (M_q1/M_now)^(1/10) − 1.
export function deriveMultipleChangeStress({
  currentMultiple,
  q1Multiple,
}: {
  currentMultiple: number | null;
  q1Multiple: number | null;
}): number {
  if (
    currentMultiple === null ||
    q1Multiple === null ||
    currentMultiple <= 0 ||
    q1Multiple <= 0
  ) {
    // No history — assume modest 1.5%/y compression as a generic stress.
    return -0.015;
  }
  if (q1Multiple >= currentMultiple) {
    // Current is already at or below Q1 — stress assumes no further compression.
    return 0;
  }
  const totalChange = q1Multiple / currentMultiple;
  const annualized = Math.pow(totalChange, 1 / 10) - 1;
  return annualized;
}

export const VERDICT_LABELS: Record<ImpliedReturnVerdict, string> = {
  comprable: "Comprable",
  no_comprable_caro: "No comprable — precio caro para la calidad",
  no_comprable_riesgo: "No comprable — riesgo asimétrico",
  no_comprable_ambos: "No comprable — precio y riesgo no compensan",
};

// Target buy price — the price at which both verdict checks would pass.
// Inverts the CAGR formula on the FCF Yield component (the only term that
// depends on price): if growth assumptions and multiple change stay
// constant, what market cap brings the base CAGR up to the tier threshold
// AND the stress CAGR up to the floor? The binding constraint is whichever
// requires the lower market cap (= lower price).
export type TargetBuyPriceResult = {
  // The price at which the business becomes "comprable". Null when the
  // verdict already passes both checks, or when the math has no finite
  // solution (FCF non-positive, or growth alone already exceeds the
  // required return so no price drop is needed for that constraint).
  targetPrice: number | null;
  // Which check is the binding constraint at the target price — the one
  // that fails first as price rises from the target.
  bindingConstraint: "attractiveness" | "no_disaster" | null;
  // Decimal change vs current price (negative = drop required).
  changeFromCurrentPct: number | null;
  // FCF Yield at the target price for the binding constraint. Shown in
  // the UI as the "this is what would be required" anchor so the reader
  // can see the lever that's actually being moved.
  requiredFcfYieldAtTarget: number | null;
  // FCF Yield at the current price (= fcfTtm / marketCap). Pre-computed
  // here so the UI doesn't repeat the math.
  currentFcfYield: number | null;
  // True when the only-failing check has growth ≥ required return; in
  // that case price doesn't need to drop because growth alone covers the
  // hurdle. Visible to the UI as an explanatory note.
  growthAlreadyCoversNonBinding?: boolean;
};

export function computeTargetBuyPrice({
  fcfTtm,
  marketCap,
  currentPrice,
  growthBase,
  growthStress,
  multipleChangeBase,
  multipleChangeStress,
  threshold,
  floor,
  passesAttractiveness,
  passesNoDisaster,
}: {
  fcfTtm: number;
  marketCap: number;
  currentPrice: number;
  growthBase: number;
  growthStress: number;
  multipleChangeBase: number;
  multipleChangeStress: number;
  threshold: number;
  floor: number;
  passesAttractiveness: boolean;
  passesNoDisaster: boolean;
}): TargetBuyPriceResult {
  // Already comprable — no target needed.
  if (passesAttractiveness && passesNoDisaster) {
    return {
      targetPrice: null,
      bindingConstraint: null,
      changeFromCurrentPct: null,
      requiredFcfYieldAtTarget: null,
      currentFcfYield: null,
    };
  }
  // Math undefined when FCF, MC or price are non-positive.
  if (
    !Number.isFinite(fcfTtm) ||
    fcfTtm <= 0 ||
    !Number.isFinite(marketCap) ||
    marketCap <= 0 ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return {
      targetPrice: null,
      bindingConstraint: null,
      changeFromCurrentPct: null,
      requiredFcfYieldAtTarget: null,
      currentFcfYield: null,
    };
  }
  const currentFcfYield = fcfTtm / marketCap;

  // Required FCF yield in each scenario, derived from CAGR equation.
  // base:    threshold = yield + growthBase + multipleChangeBase
  // stress:  floor     = yield + growthStress + multipleChangeStress
  // Negative or zero requirement means growth + multiple alone already
  // exceeds the hurdle — no price drop needed for that check.
  const requiredYieldBase = threshold - growthBase - multipleChangeBase;
  const requiredYieldStress = floor - growthStress - multipleChangeStress;

  // Target market cap = FCF / required_yield. Lower MC = lower price.
  const constraints: Array<{
    mc: number;
    key: "attractiveness" | "no_disaster";
    yieldRequired: number;
  }> = [];
  if (!passesAttractiveness && requiredYieldBase > 0) {
    constraints.push({
      mc: fcfTtm / requiredYieldBase,
      key: "attractiveness",
      yieldRequired: requiredYieldBase,
    });
  }
  if (!passesNoDisaster && requiredYieldStress > 0) {
    constraints.push({
      mc: fcfTtm / requiredYieldStress,
      key: "no_disaster",
      yieldRequired: requiredYieldStress,
    });
  }

  // Edge case: a check fails but its required yield is ≤ 0. That means
  // growth + multiple already cover that hurdle — the failing check would
  // pass at any price. Surface this honestly (the binding constraint is
  // whichever check still has a positive required yield).
  if (constraints.length === 0) {
    return {
      targetPrice: null,
      bindingConstraint: null,
      changeFromCurrentPct: null,
      requiredFcfYieldAtTarget: null,
      currentFcfYield,
      growthAlreadyCoversNonBinding: true,
    };
  }

  // Most restrictive (lowest target MC = lowest target price) is the binding constraint.
  const binding = constraints.reduce((a, b) => (a.mc <= b.mc ? a : b));
  const targetPrice = (currentPrice * binding.mc) / marketCap;
  const changeFromCurrentPct = targetPrice / currentPrice - 1;

  return {
    targetPrice,
    bindingConstraint: binding.key,
    changeFromCurrentPct,
    requiredFcfYieldAtTarget: binding.yieldRequired,
    currentFcfYield,
  };
}

export const VERDICT_TONES: Record<
  ImpliedReturnVerdict,
  "positive" | "negative"
> = {
  comprable: "positive",
  no_comprable_caro: "negative",
  no_comprable_riesgo: "negative",
  no_comprable_ambos: "negative",
};

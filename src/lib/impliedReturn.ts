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
//   - Δ Multiple (annualized) = the assumed change in the primary multiple
//     over 10 years. Base case: compress to min(current, median) — assume
//     mean-reversion when stretched, hold at current when already cheap.
//     Stress: compress to Q1 of own history. The "primary multiple" is
//     P/E, P/FCF or P/B per the AI valuation guide / business-type fallback
//     — see lib/multipleSelection.ts.
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
import type { ImpliedReturnStoredAssumptions } from "@/lib/valuations";

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

// Legacy constant — kept for back-compat with any external imports. The
// implied-return pipeline now derives the base-case multiple change via
// `deriveMultipleChangeBase` instead of a fixed default.
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

// Generic multi-quartile snapshot of "the primary multiple" — whatever
// Moatboard has decided is the most informative one for this business
// (P/E for compounders with clean earnings, P/FCF when SBC/capex makes
// PE noisy, P/B for balance-sheet businesses). Unit-agnostic — math works
// the same way regardless of whether values are P/E ratios or P/FCF.
export type MultipleSnapshot = {
  current: number | null;
  median: number | null;
  q1: number | null; // 25th percentile — "cheap end" of own history
};

// Stress-case multiple change: assume the multiple compresses from current
// to Q1 over 10 years. Returns annualized decimal, always ≤ 0 (compression,
// not expansion).
//
// Formula: if current multiple is M_now and Q1 is M_q1,
//   total compression over 10y = M_q1 / M_now − 1
//   annualized = (M_q1/M_now)^(1/10) − 1.
export function deriveMultipleChangeStress(
  snapshot: MultipleSnapshot | null,
): number {
  if (
    snapshot === null ||
    snapshot.current === null ||
    snapshot.q1 === null ||
    snapshot.current <= 0 ||
    snapshot.q1 <= 0
  ) {
    // No history — assume modest 1.5%/y compression as a generic stress.
    return -0.015;
  }
  if (snapshot.q1 >= snapshot.current) {
    // Current is already at or below Q1 — stress assumes no further compression.
    return 0;
  }
  const totalChange = snapshot.q1 / snapshot.current;
  const annualized = Math.pow(totalChange, 1 / 10) - 1;
  return annualized;
}

// Base-case multiple change: disciplined "no re-rating" rule.
//
// Target multiple at year 10 = min(current, median).
//   - When current > median (multiple stretched): assume mean-reversion to
//     the own historical median over 10 years. Compression baked in.
//   - When current ≤ median (multiple at or below norm): hold at current.
//     Refuse to bake re-expansion into the base case — the value-investor
//     position. The cheap entry is already captured in FCF Yield; assuming
//     the multiple comes back to median would double-count the value.
//
// Returns annualized signed decimal: 0 when no compression needed,
// negative when compression is assumed.
export function deriveMultipleChangeBase(
  snapshot: MultipleSnapshot | null,
): number {
  if (
    snapshot === null ||
    snapshot.current === null ||
    snapshot.median === null ||
    snapshot.current <= 0 ||
    snapshot.median <= 0
  ) {
    // No history or unusable median — keep the conservative neutral default.
    return 0;
  }
  // min(current, median): if current is at or below median, no re-rating
  // assumed (return 0); if current is above median, compress toward median.
  if (snapshot.current <= snapshot.median) {
    return 0;
  }
  const totalChange = snapshot.median / snapshot.current;
  const annualized = Math.pow(totalChange, 1 / 10) - 1;
  return annualized;
}

// What multiple does the base case end up at? Used by the UI so it can
// label the assumption transparently ("27.5x mediana 10y" vs "11.0x actual").
// Returns null when the snapshot is unusable.
export function deriveBaseMultiple(
  snapshot: MultipleSnapshot | null,
): number | null {
  if (
    snapshot === null ||
    snapshot.current === null ||
    snapshot.median === null ||
    snapshot.current <= 0 ||
    snapshot.median <= 0
  ) {
    return snapshot?.current ?? null;
  }
  return snapshot.current <= snapshot.median ? snapshot.current : snapshot.median;
}

// Inverse of deriveBaseMultiple / deriveStressMultiple — given a user-
// supplied terminal multiple, return the equivalent annualized signed
// change over 10 years. Used by the override server action to convert
// "Joseda asume 2.0x P/B al año 10" into the persisted %/año form.
//
// Returns 0 (no change) when inputs are unusable rather than throwing —
// the caller then treats it as "no override" semantically.
export function multipleToAnnualizedChange(
  currentMultiple: number,
  terminalMultiple: number,
): number {
  if (
    !Number.isFinite(currentMultiple) ||
    !Number.isFinite(terminalMultiple) ||
    currentMultiple <= 0 ||
    terminalMultiple <= 0
  ) {
    return 0;
  }
  return Math.pow(terminalMultiple / currentMultiple, 1 / 10) - 1;
}

// Re-derive the implied-return assumptions at a fresh market cap (today's
// price × shares outstanding). The persisted assumptions row freezes the
// snapshot from the last regenerate; this helper produces a "live" version
// that re-prices the FCF yield + the multiple-change derivation against
// today's quote, so verdict chips and the calculator's Conclusión zone
// reflect today rather than days/weeks ago.
//
// What changes:
//   - fcf_yield (and market_cap)        ← directly price-sensitive
//   - multiple_current                   ← scales linearly with price
//   - multiple_change_base / _stress     ← re-derived against new current
//   - multiple_base / _stress_terminal   ← derived from the new rates
//   - base/stress/optimistic_cagr        ← new from the formula
//   - passes_*, verdict, verdict_reason  ← new from the decision rule
//
// What stays:
//   - growth (anchors, base, stress, optimistic, driver, cap_applied)
//   - multiple_label / source / median / q1 (regime data, not price)
//   - peer_median (cross-sectional anchor — yearly hardcoded table)
//   - quality_tier, threshold, floor, treasury_yield
//   - cross_check, relative_valuation
//   - overrides (multiple_change_*_override, growth_*_override) — respected
//     verbatim; user intent freezes when they set them
//
// Returns the stored assumptions unchanged when inputs are unusable.
export function deriveLiveImpliedReturn(
  stored: ImpliedReturnStoredAssumptions,
  currentMarketCap: number,
): ImpliedReturnStoredAssumptions {
  if (
    !Number.isFinite(currentMarketCap) ||
    currentMarketCap <= 0 ||
    !stored.fcf_ttm ||
    stored.fcf_ttm <= 0 ||
    !stored.market_cap ||
    stored.market_cap <= 0
  ) {
    return stored;
  }

  const liveFcfYield = stored.fcf_ttm / currentMarketCap;
  const priceRatio = currentMarketCap / stored.market_cap;

  const persistedCurrent = stored.multiple_current ?? null;
  const liveCurrent =
    persistedCurrent !== null && persistedCurrent > 0
      ? persistedCurrent * priceRatio
      : null;

  const median = stored.multiple_median ?? null;
  const q1 = stored.multiple_q1 ?? null;

  // Multiple change — recompute against live current unless the user has
  // an override active. Override semantics: stored as annualized rate at
  // the time of edit; we keep the rate verbatim. (User's intent at override
  // time was a specific terminal Nx; if a future iteration stores terminals
  // instead of rates, this helper would reconvert here.)
  const liveBaseChange =
    stored.multiple_change_base_override !== null &&
    stored.multiple_change_base_override !== undefined
      ? stored.multiple_change_base_override
      : liveCurrent !== null && median !== null && median > 0
        ? liveCurrent > median
          ? Math.pow(median / liveCurrent, 1 / 10) - 1
          : 0
        : stored.multiple_change_base;

  const liveStressChange =
    stored.multiple_change_stress_override !== null &&
    stored.multiple_change_stress_override !== undefined
      ? stored.multiple_change_stress_override
      : liveCurrent !== null && q1 !== null && q1 > 0
        ? liveCurrent > q1
          ? Math.pow(q1 / liveCurrent, 1 / 10) - 1
          : 0
        : stored.multiple_change_stress;

  // Growth — overrides respected verbatim; otherwise persisted auto values.
  const effectiveGrowthBase =
    stored.growth_base_override ?? stored.growth.base;
  const effectiveGrowthStress =
    stored.growth_stress_override ?? stored.growth.stress;

  const result = computeImpliedReturn({
    fcfYield: liveFcfYield,
    growthBase: effectiveGrowthBase,
    growthStress: effectiveGrowthStress,
    multipleChangeBase: liveBaseChange,
    multipleChangeStress: liveStressChange,
    qualityTier: stored.quality_tier,
    treasuryYield: stored.treasury_yield,
  });

  const liveBaseTerminal =
    liveCurrent !== null
      ? liveCurrent * Math.pow(1 + liveBaseChange, 10)
      : (stored.multiple_base_terminal ?? null);
  const liveStressTerminal =
    liveCurrent !== null
      ? liveCurrent * Math.pow(1 + liveStressChange, 10)
      : (stored.multiple_stress_terminal ?? null);

  return {
    ...stored,
    fcf_yield: liveFcfYield,
    market_cap: currentMarketCap,
    multiple_change_base: liveBaseChange,
    multiple_change_stress: liveStressChange,
    multiple_current: liveCurrent,
    multiple_base_terminal: liveBaseTerminal,
    multiple_stress_terminal: liveStressTerminal,
    base_cagr: result.baseCAGR,
    stress_cagr: result.stressCAGR,
    optimistic_cagr: result.optimisticCAGR,
    passes_attractiveness: result.passesAttractiveness,
    passes_no_disaster: result.passesNoDisaster,
    verdict: result.verdict,
    verdict_reason: result.reason,
  };
}

// What multiple does the stress case end up at? = Q1 of own history if
// usable, otherwise null.
export function deriveStressMultiple(
  snapshot: MultipleSnapshot | null,
): number | null {
  if (
    snapshot === null ||
    snapshot.current === null ||
    snapshot.q1 === null ||
    snapshot.current <= 0 ||
    snapshot.q1 <= 0
  ) {
    return null;
  }
  return snapshot.q1 >= snapshot.current ? snapshot.current : snapshot.q1;
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

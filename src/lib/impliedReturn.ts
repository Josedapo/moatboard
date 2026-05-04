// Implied Return — the central frame of Moatboard's Valuation section.
//
// The question Moatboard answers operationally:
//
//   "If I buy this business at the current price and hold it for 10 years,
//    what annual return can I reasonably expect?"
//
// Formula (Buffett's "owner returns", Smith's three-pillar framing):
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
//     Stress: compress to Q1 of own history.
//
// **No verdict layer.** Moatboard surfaces the expected return; what level
// is "buyable" is a function of the user's opportunity cost and conviction
// in the business — subjective per investor, never a framework decree.
// Treasury 10y + 2% is shown as a factual reference (the bar a stress case
// would have to clear to beat the bond), not as a rule.

import type { ImpliedReturnStoredAssumptions } from "@/lib/valuations";

// Reference premium over the Treasury 10y for a "no-disaster" comparison.
// Not a rule — exposed so the UI can render the factual line "Treasury
// 10y + 2% = X.X%" alongside the stress CAGR. The user judges whether
// the stress case clearing or missing this line matters for them.
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
  treasuryYield: number; // decimal, current 10y Treasury — for the factual reference
};

export type ImpliedReturnResult = {
  baseCAGR: number;
  stressCAGR: number;
  optimisticCAGR: number; // multiple stable, growth full
  floor: number; // treasury + reference premium (factual reference, not a rule)
};

export function computeImpliedReturn({
  fcfYield,
  growthBase,
  growthStress,
  multipleChangeBase,
  multipleChangeStress,
  treasuryYield,
}: ImpliedReturnInputs): ImpliedReturnResult {
  const baseCAGR = fcfYield + growthBase + multipleChangeBase;
  const stressCAGR = fcfYield + growthStress + multipleChangeStress;
  const optimisticCAGR = fcfYield + growthBase;
  const floor = treasuryYield + FLOOR_PREMIUM_OVER_TREASURY;

  return {
    baseCAGR,
    stressCAGR,
    optimisticCAGR,
    floor,
  };
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

// Re-derive the implied-return assumptions at a fresh market cap (today's
// price × shares outstanding). The persisted assumptions row freezes the
// snapshot from the last regenerate; this helper produces a "live" version
// that re-prices the FCF yield + the multiple-change derivation against
// today's quote, so the calculator's numbers reflect today rather than
// days/weeks ago.
//
// What changes:
//   - fcf_yield (and market_cap)        ← directly price-sensitive
//   - multiple_current                   ← scales linearly with price
//   - multiple_change_base / _stress     ← re-derived against new current
//   - multiple_base / _stress_terminal   ← derived from the new rates
//   - base/stress/optimistic_cagr        ← new from the formula
//
// What stays:
//   - growth (anchors, base, stress, optimistic, driver, cap_applied)
//   - multiple_label / source / median / q1 (regime data, not price)
//   - peer_median (cross-sectional anchor — yearly hardcoded table)
//   - quality_tier, floor, treasury_yield
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

  // Override resolution. Two override paths exist:
  //   1. Absolute terminal Nx (current model) — `multiple_*_terminal_override`.
  //      The terminal stays fixed; the annualized rate re-derives against
  //      the live current. This matches Joseda's mental model: "this is the
  //      multiple I believe the business should converge to; the price
  //      oscillates around it".
  //   2. Annualized rate (legacy, pre-migration) — `multiple_change_*_override`.
  //      Kept as fallback for rows that haven't been migrated yet. Used
  //      verbatim, terminal recomputed from current * (1+rate)^10.
  //
  // New rows write only path 1. The migration script converts legacy rows.
  const baseTerminalOverride = stored.multiple_base_terminal_override ?? null;
  const stressTerminalOverride = stored.multiple_stress_terminal_override ?? null;

  const liveBaseChange =
    baseTerminalOverride !== null && liveCurrent !== null && liveCurrent > 0
      ? Math.pow(baseTerminalOverride / liveCurrent, 1 / 10) - 1
      : stored.multiple_change_base_override !== null &&
          stored.multiple_change_base_override !== undefined
        ? stored.multiple_change_base_override
        : liveCurrent !== null && median !== null && median > 0
          ? liveCurrent > median
            ? Math.pow(median / liveCurrent, 1 / 10) - 1
            : 0
          : stored.multiple_change_base;

  const liveStressChange =
    stressTerminalOverride !== null && liveCurrent !== null && liveCurrent > 0
      ? Math.pow(stressTerminalOverride / liveCurrent, 1 / 10) - 1
      : stored.multiple_change_stress_override !== null &&
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

// Pure functions for relative-to-self valuation (drift M, improvement #6).
// Given a time series of a company's own historical multiples (PE, FCF yield),
// compute distribution statistics with IQR-outlier exclusion, then classify
// where the current multiple sits inside its own history. Combined with the
// DCF tier, produces a CompoundTier that the UI renders with non-blocking
// language so a buy-and-hold investor can actually buy a compounder.

import type {
  CompoundTier,
  DcfTier,
  RelativeTier,
} from "@/lib/valuation";

// Minimum data points required to treat the distribution as statistically
// meaningful. Below this we return `null` and the caller falls back to the
// DCF-only tier. 36 monthly points ≈ 3 years.
export const MIN_POINTS_FOR_STATS = 36;

export type DistributionStats = {
  count: number;
  median: number;
  q1: number;
  q3: number;
  min: number; // min after outlier exclusion
  max: number; // max after outlier exclusion
  outliersExcluded: number;
};

// Returns distribution stats over `values`. Outliers outside
// [Q1 − 1.5·IQR, Q3 + 1.5·IQR] are excluded from min / max so the "own
// historical range" used for tier thresholds isn't dominated by single-month
// spikes (e.g. a ticker briefly trading at 200x earnings during an earnings
// collapse). Median/Q1/Q3 are computed on the full data because percentiles
// are already robust to tails.
export function computeDistributionStats(
  values: readonly number[],
): DistributionStats | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length < MIN_POINTS_FOR_STATS) return null;

  const sorted = [...clean].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const withoutOutliers = sorted.filter(
    (v) => v >= lowerFence && v <= upperFence,
  );
  const min =
    withoutOutliers.length > 0 ? withoutOutliers[0] : sorted[0];
  const max =
    withoutOutliers.length > 0
      ? withoutOutliers[withoutOutliers.length - 1]
      : sorted[sorted.length - 1];

  return {
    count: clean.length,
    median,
    q1,
    q3,
    min,
    max,
    outliersExcluded: sorted.length - withoutOutliers.length,
  };
}

// Linear-interpolated percentile (Type 7, matches numpy/R default). `sorted`
// must be ascending.
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const weight = rank - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

// Where does `current` fall inside the (outlier-trimmed) distribution?
// 0 = at or below min, 100 = at or above max. Used to surface "current PE is
// at the 73rd percentile of its 5-year history" in the UI.
export function computePercentile(
  sorted: readonly number[],
  current: number,
): number {
  if (sorted.length === 0) return 50;
  if (!Number.isFinite(current)) return 50;
  let below = 0;
  for (const v of sorted) {
    if (v <= current) below++;
    else break;
  }
  return (below / sorted.length) * 100;
}

// Classify the relative-to-self tier using the thresholds defined in drift M:
//   ≤ Q1                   → rare
//   between Q1 and Q3      → within
//   between Q3 and max     → above
//   > max (trimmed)        → stratospheric
//
// Note on ordering: for PE and FCF yield we interpret "lower = cheaper". PE
// cheaper = lower; FCF yield cheaper = *higher* yield. The caller inverts FCF
// yield (pass 1/fcfYield, i.e. "price / FCF") to keep the "lower = cheaper"
// convention uniform across metrics.
export function classifyRelativeTier(
  current: number,
  stats: DistributionStats,
): RelativeTier {
  if (current <= stats.q1) return "rare";
  if (current <= stats.q3) return "within";
  if (current <= stats.max) return "above";
  return "stratospheric";
}

// Combines DCF tier + Relative tier into the public-facing CompoundTier.
//
// Lookup logic (drift M):
//   relative stratospheric → "stratospheric"          (the only unambiguous red flag)
//   relative above         → "above_historical"       (premium but reasonable)
//   relative within        → "within_historical"      (buy-and-hold can enter)
//   relative rare:
//     dcf margin           → "rare_opportunity"       (both anchors aligned)
//     dcf acceptable/fair/premium → "within_historical"  (relative says cheap but DCF disagrees; treated as defensible buy zone, not "rare")
export function classifyCompoundTier(
  dcfTier: DcfTier,
  relativeTier: RelativeTier | null,
): CompoundTier {
  if (relativeTier === null) return "dcf_only";
  switch (relativeTier) {
    case "stratospheric":
      return "stratospheric";
    case "above":
      return "above_historical";
    case "within":
      return "within_historical";
    case "rare":
      return dcfTier === "margin" ? "rare_opportunity" : "within_historical";
  }
}

// Pure functions — no I/O, no SDK. Compute the Moatboard quality verdict from
// the scorecard + cached moat. Used by server actions today and by the Quality
// Universe batch script tomorrow.

import {
  scoreRoic,
  scoreFcfMargin,
  scoreShareCountTrend,
  scoreGrossMargin,
  scoreOperatingMargin,
  scoreRevenueGrowthMultiYear,
  scoreDebtToEquity,
  scoreMetric,
  computeFcfConversionMedian,
  scoreRoeMultiYear,
  scoreRoaMultiYear,
  scoreBookValuePerShareCagr,
  scoreAffoPayout,
  scoreNetDebtToEbitda,
  scoreAffoPerShareCagr,
  isBalanceSheetBusiness,
  isRealEstate,
  type Quality,
  type MultiYearScore,
  type SingleYearScore,
  type RetentionMultiple,
} from "@/lib/scorecard";
import type { Fundamentals, MultiYearFundamentals } from "@/lib/financial";

export type Tier = "exceptional" | "good" | "mediocre" | "poor";

export type MoatStrength = "strong" | "weak" | "unclear";
export type MoatArchetype =
  | "brand"
  | "network_effects"
  | "switching_costs"
  | "scale"
  | "ip"
  | "regulatory"
  | "cost_advantage"
  | "none";

export type ScorecardSummary = {
  strong: number;
  acceptable: number;
  weak: number;
  neutral: number;
  yearsOfHistory: number; // how many annual rows carried the signal
  dimensions: {
    // ─── Product-business dimensions ───
    returnOnInvestedCapital: Quality;
    fcfMargin: Quality;
    grossMargin: Quality;
    shareCountTrend: Quality;
    operatingMargins: Quality;
    debtToEquity: Quality;
    revenueGrowth: Quality;
    // ─── Bank / insurer-specific ───
    returnOnEquity: Quality;
    returnOnAssets: Quality;
    bookValuePerShareCagr: Quality;
    // ─── REIT-specific ───
    affoPayoutRatio: Quality;
    netDebtToEbitda: Quality;
    affoPerShareCagr: Quality;
  };
  multiYear: {
    returnOnInvestedCapital: MultiYearScore;
    fcfMargin: MultiYearScore;
    grossMargin: MultiYearScore;
    shareCountTrend: MultiYearScore;
    operatingMargin: MultiYearScore;
    revenueGrowth: MultiYearScore;
    // Bank/insurer-specific multi-year
    returnOnEquity: MultiYearScore;
    returnOnAssets: MultiYearScore;
    bookValuePerShareCagr: MultiYearScore;
    // REIT-specific multi-year (only AFFO/share CAGR is multi-year;
    // the other two REIT dimensions are latest-year snapshots)
    affoPerShareCagr: MultiYearScore;
  };
  // REIT latest-year snapshots (leverage and payout — industry convention
  // is point-in-time, not multi-year median).
  reit: {
    affoPayoutRatio: SingleYearScore;
    netDebtToEbitda: SingleYearScore;
  };
  // Reference-only, surfaced in Additional Signals (not scored).
  fcfConversion: { median: number | null; yearsUsed: number };
  // Buffett's "one-dollar test" — reference, not scored.
  retentionMultiple: RetentionMultiple;
  // Context notes for scored dimensions that need clarification in the UI
  // (e.g. "Not a quality signal for this sector" when D/E is neutralized
  // for a bank). Only populated when a note applies.
  notes?: {
    debtToEquity?: string;
  };
};

export const TIER_LABELS: Record<Tier, string> = {
  exceptional: "Exceptional business",
  good: "Good business",
  mediocre: "Mediocre business",
  poor: "Poor business",
};

const ARCHETYPE_LABELS: Record<MoatArchetype, string> = {
  brand: "brand strength",
  network_effects: "network effects",
  switching_costs: "switching costs",
  scale: "scale advantages",
  ip: "intellectual property",
  regulatory: "regulatory barriers",
  cost_advantage: "cost advantages",
  none: "no identifiable moat",
};

export function summarizeScorecard(
  fundamentals: Fundamentals,
  multiYear: MultiYearFundamentals | null,
  sector: string | null,
  industry: string | null,
  retentionMultiple: RetentionMultiple,
): ScorecardSummary {
  // Product-universal scores (applicability is sector-aware inside each).
  const roicScore = scoreRoic(multiYear, sector, industry);
  const fcfMarginScore = scoreFcfMargin(multiYear, sector, industry);
  const grossMarginScore = scoreGrossMargin(multiYear, sector, industry);
  const shareCountScore = scoreShareCountTrend(multiYear);
  const opMarginMY = scoreOperatingMargin(multiYear);
  const revenueGrowthMY = scoreRevenueGrowthMultiYear(multiYear);
  const debtToEquityScore = scoreDebtToEquity(
    fundamentals.debtToEquity,
    sector,
    industry,
  );

  // Business-type gating: bank/insurer dimensions only apply when balance-
  // sheet business; REIT dimensions only apply to real estate. For all
  // other sectors these return `neutral` so they don't count in the tier.
  // Mortgage REITs sit in both buckets (sector=Real Estate AND industry=
  // REIT—Mortgage in BALANCE_SHEET_INDUSTRIES) — bank wins, because they
  // are spread businesses, not property operators.
  const isBank = isBalanceSheetBusiness(sector, industry);
  const isReit = isRealEstate(sector) && !isBank;

  const roeScore: MultiYearScore = isBank
    ? scoreRoeMultiYear(multiYear)
    : { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  const roaScore: MultiYearScore = isBank
    ? scoreRoaMultiYear(multiYear)
    : { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  const bvCagrScore: MultiYearScore = isBank
    ? scoreBookValuePerShareCagr(multiYear)
    : { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };

  const affoPayoutScore: SingleYearScore = isReit
    ? scoreAffoPayout(multiYear)
    : { quality: "neutral", value: null };
  const ndEbitdaScore: SingleYearScore = isReit
    ? scoreNetDebtToEbitda(multiYear)
    : { quality: "neutral", value: null };
  const affoCagrScore: MultiYearScore = isReit
    ? scoreAffoPerShareCagr(multiYear)
    : { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };

  // Fallback to trailing signals when multi-year data is not available, so
  // freshly-listed tickers still get a score on op margin and revenue growth.
  const operatingMarginQuality =
    opMarginMY.yearsUsed >= 3
      ? opMarginMY.quality
      : scoreMetric("operatingMargins", fundamentals.operatingMargins);
  const revenueGrowthQuality =
    revenueGrowthMY.yearsUsed >= 3
      ? revenueGrowthMY.quality
      : scoreMetric("revenueGrowth", fundamentals.revenueGrowth);

  const dimensions = {
    returnOnInvestedCapital: roicScore.quality,
    fcfMargin: fcfMarginScore.quality,
    grossMargin: grossMarginScore.quality,
    shareCountTrend: shareCountScore.quality,
    operatingMargins: operatingMarginQuality,
    debtToEquity: debtToEquityScore.quality,
    revenueGrowth: revenueGrowthQuality,
    returnOnEquity: roeScore.quality,
    returnOnAssets: roaScore.quality,
    bookValuePerShareCagr: bvCagrScore.quality,
    affoPayoutRatio: affoPayoutScore.quality,
    netDebtToEbitda: ndEbitdaScore.quality,
    affoPerShareCagr: affoCagrScore.quality,
  };

  const counts = { strong: 0, acceptable: 0, weak: 0, neutral: 0 };
  for (const q of Object.values(dimensions)) counts[q] += 1;

  return {
    ...counts,
    yearsOfHistory: multiYear?.yearsAvailable ?? 0,
    dimensions,
    multiYear: {
      returnOnInvestedCapital: roicScore,
      fcfMargin: fcfMarginScore,
      grossMargin: grossMarginScore,
      shareCountTrend: shareCountScore,
      operatingMargin: opMarginMY,
      revenueGrowth: revenueGrowthMY,
      returnOnEquity: roeScore,
      returnOnAssets: roaScore,
      bookValuePerShareCagr: bvCagrScore,
      affoPerShareCagr: affoCagrScore,
    },
    reit: {
      affoPayoutRatio: affoPayoutScore,
      netDebtToEbitda: ndEbitdaScore,
    },
    fcfConversion: computeFcfConversionMedian(multiYear),
    retentionMultiple,
    notes: debtToEquityScore.note
      ? { debtToEquity: debtToEquityScore.note }
      : undefined,
  };
}

export function computeQualityTier(
  scorecard: ScorecardSummary,
  moatStrength: MoatStrength,
  moatArchetype: MoatArchetype,
  fundamentals: Fundamentals,
): Tier {
  const strongCount = scorecard.strong;
  const weakCount = scorecard.weak;

  // Hard-fail conditions push to Poor regardless of other signals.
  // The old "FCF > 0" check is replaced by "ROIC worst year < 0" (losing
  // money on invested capital) when multi-year data is available; when not,
  // we fall back to the trailing FCF solvency check.
  const roicWorst = scorecard.multiYear.returnOnInvestedCapital.worstYear;
  const hardRoicFail = roicWorst !== null && roicWorst < 0;
  const hardFcfFail =
    scorecard.multiYear.returnOnInvestedCapital.yearsUsed === 0 &&
    fundamentals.freeCashflow !== null &&
    fundamentals.freeCashflow <= 0;

  if (
    hardRoicFail ||
    hardFcfFail ||
    weakCount >= 3 ||
    (moatStrength === "weak" && strongCount < 3)
  ) {
    return "poor";
  }

  // Drift I: archetype "none" means no identifiable moat. Trailing numbers
  // mean-revert precisely because there's no moat, so Buffett would never
  // call this "good" regardless of how strong the current scorecard looks.
  // Cap at Mediocre — hard-fails above still apply for genuinely broken
  // businesses.
  if (moatArchetype === "none") {
    return "mediocre";
  }

  // Dimensions counted against the bar are those that *apply* to this
  // business — neutral dimensions (e.g. gross margin on a bank, or REIT
  // leverage on a product business) don't count toward either side.
  // Computing from the non-neutral counts keeps this independent of how
  // many dimension fields exist in the scorecard type (some are gated on
  // business type — ROE for banks, AFFO payout for REITs).
  const applicable = strongCount + scorecard.acceptable + weakCount;

  // Exceptional: at most one non-strong applicable dimension (no weaks) +
  // strong moat. For applicable=7 this is ≥6 strong; for applicable=6 it's
  // ≥5 strong — proportional, not absolute.
  if (
    strongCount >= applicable - 1 &&
    weakCount === 0 &&
    moatStrength === "strong"
  ) {
    return "exceptional";
  }

  // Good: at most two non-strong applicable dimensions (≤1 weak), moat at
  // least plausible. For applicable=7 this is ≥5 strong; for applicable=6
  // it's ≥4 strong.
  if (
    strongCount >= applicable - 2 &&
    weakCount <= 1 &&
    (moatStrength === "strong" || moatStrength === "unclear")
  ) {
    return "good";
  }

  return "mediocre";
}

export function renderVerdictReason({
  tier,
  scorecard,
  moatStrength,
  moatArchetype,
  fundamentals,
}: {
  tier: Tier;
  scorecard: ScorecardSummary;
  moatStrength: MoatStrength;
  moatArchetype: MoatArchetype;
  fundamentals: Fundamentals;
}): string {
  // `neutral` dimensions don't participate in the "X of N" count — they're
  // metrics that don't apply to this business type (e.g. gross margin on a
  // bank). The denominator is the count of applicable dimensions
  // (whatever they are for this business type).
  const total = scorecard.strong + scorecard.acceptable + scorecard.weak;
  const strong = scorecard.strong;
  const weak = scorecard.weak;
  const moatLabel = ARCHETYPE_LABELS[moatArchetype];

  const metricSnippet = formatKeyMetrics(fundamentals, scorecard);

  const moatPhrase = (() => {
    if (moatStrength === "strong") return `durable moat from ${moatLabel}`;
    if (moatStrength === "weak") return `no meaningful moat`;
    return `unclear moat (${moatLabel})`;
  })();

  switch (tier) {
    case "exceptional":
      return `Exceptional business: ${strong} of ${total} quality dimensions strong, ${moatPhrase}. ${metricSnippet}`;
    case "good":
      return `Good business: ${strong} of ${total} quality dimensions strong, ${moatPhrase}. ${metricSnippet}`;
    case "mediocre":
      return `Mediocre business: mixed quality signals (${strong} strong, ${weak} weak), ${moatPhrase}. ${metricSnippet}`;
    case "poor":
      return `Poor business: ${weak} of ${total} dimensions failing, ${moatPhrase}. ${metricSnippet}`;
  }
}

function formatKeyMetrics(
  fd: Fundamentals,
  scorecard: ScorecardSummary,
): string {
  const parts: string[] = [];
  const roicMed = scorecard.multiYear.returnOnInvestedCapital.median;
  const roicYears = scorecard.multiYear.returnOnInvestedCapital.yearsUsed;
  if (roicMed !== null && roicYears >= 3) {
    parts.push(`ROIC ${(roicMed * 100).toFixed(1)}% (${roicYears}y median)`);
  }
  const gmMed = scorecard.multiYear.grossMargin.median;
  const gmYears = scorecard.multiYear.grossMargin.yearsUsed;
  if (gmMed !== null && gmYears >= 3) {
    parts.push(
      `Gross margin ${(gmMed * 100).toFixed(1)}% (${gmYears}y median)`,
    );
  }
  const fcfMed = scorecard.multiYear.fcfMargin.median;
  const fcfYears = scorecard.multiYear.fcfMargin.yearsUsed;
  if (fcfMed !== null && fcfYears >= 3) {
    parts.push(`FCF margin ${(fcfMed * 100).toFixed(1)}% (${fcfYears}y median)`);
  }
  const opMed = scorecard.multiYear.operatingMargin.median;
  const opYears = scorecard.multiYear.operatingMargin.yearsUsed;
  if (opMed !== null && opYears >= 3) {
    parts.push(`Op margin ${(opMed * 100).toFixed(1)}% (${opYears}y median)`);
  } else if (fd.operatingMargins !== null && Number.isFinite(fd.operatingMargins)) {
    parts.push(`Op margin ${(fd.operatingMargins * 100).toFixed(1)}%`);
  }
  if (fd.debtToEquity !== null && Number.isFinite(fd.debtToEquity)) {
    parts.push(`D/E ${fd.debtToEquity.toFixed(0)}%`);
  }
  const shareCagr = scorecard.multiYear.shareCountTrend.median;
  if (shareCagr !== null) {
    const sign = shareCagr <= 0 ? "−" : "+";
    parts.push(
      `Shares ${sign}${Math.abs(shareCagr * 100).toFixed(1)}%/yr`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") + "." : "";
}

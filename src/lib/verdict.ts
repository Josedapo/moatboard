// Pure functions — no I/O, no SDK. Compute the Moatboard quality verdict from
// the scorecard + cached moat. Used by server actions today and by the Quality
// Universe batch script tomorrow.

import {
  scoreMetric,
  scoreRoic,
  scoreFcfMargin,
  scoreShareCountTrend,
  type Quality,
  type MultiYearScore,
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
    returnOnInvestedCapital: Quality;
    fcfMargin: Quality;
    shareCountTrend: Quality;
    operatingMargins: Quality;
    debtToEquity: Quality;
    revenueGrowth: Quality;
  };
  multiYear: {
    returnOnInvestedCapital: MultiYearScore;
    fcfMargin: MultiYearScore;
    shareCountTrend: MultiYearScore;
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
): ScorecardSummary {
  const roicScore = scoreRoic(multiYear);
  const fcfMarginScore = scoreFcfMargin(multiYear);
  const shareCountScore = scoreShareCountTrend(multiYear);

  const dimensions = {
    returnOnInvestedCapital: roicScore.quality,
    fcfMargin: fcfMarginScore.quality,
    shareCountTrend: shareCountScore.quality,
    operatingMargins: scoreMetric(
      "operatingMargins",
      fundamentals.operatingMargins,
    ),
    debtToEquity: scoreMetric("debtToEquity", fundamentals.debtToEquity),
    revenueGrowth: scoreMetric("revenueGrowth", fundamentals.revenueGrowth),
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
      shareCountTrend: shareCountScore,
    },
  };
}

export function computeQualityTier(
  scorecard: ScorecardSummary,
  moatStrength: MoatStrength,
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

  // Exceptional: essentially all six dimensions firing + strong moat.
  if (strongCount >= 5 && weakCount === 0 && moatStrength === "strong") {
    return "exceptional";
  }

  // Good: clear majority strong, at most one weak, moat at least plausible.
  if (
    strongCount >= 4 &&
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
  const total = 6;
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
  const fcfMed = scorecard.multiYear.fcfMargin.median;
  const fcfYears = scorecard.multiYear.fcfMargin.yearsUsed;
  if (fcfMed !== null && fcfYears >= 3) {
    parts.push(`FCF margin ${(fcfMed * 100).toFixed(1)}% (${fcfYears}y median)`);
  }
  if (fd.operatingMargins !== null && Number.isFinite(fd.operatingMargins)) {
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

// Pure functions — no I/O, no SDK. Compute the Moatboard quality verdict from
// the scorecard + cached moat. Used by server actions today and by the Quality
// Universe batch script tomorrow.

import { scoreMetric, type Quality } from "@/lib/scorecard";
import type { Fundamentals } from "@/lib/financial";

export type Tier = "exceptional" | "good" | "average" | "poor";

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
  dimensions: {
    returnOnEquity: Quality;
    operatingMargins: Quality;
    freeCashflow: Quality;
    debtToEquity: Quality;
    revenueGrowth: Quality;
  };
};

export const TIER_LABELS: Record<Tier, string> = {
  exceptional: "Exceptional business",
  good: "Good business",
  average: "Average business",
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
): ScorecardSummary {
  const dimensions = {
    returnOnEquity: scoreMetric("returnOnEquity", fundamentals.returnOnEquity),
    operatingMargins: scoreMetric(
      "operatingMargins",
      fundamentals.operatingMargins,
    ),
    freeCashflow: scoreMetric("freeCashflow", fundamentals.freeCashflow),
    debtToEquity: scoreMetric("debtToEquity", fundamentals.debtToEquity),
    revenueGrowth: scoreMetric("revenueGrowth", fundamentals.revenueGrowth),
  };

  const counts = { strong: 0, acceptable: 0, weak: 0, neutral: 0 };
  for (const q of Object.values(dimensions)) counts[q] += 1;

  return { ...counts, dimensions };
}

export function computeQualityTier(
  scorecard: ScorecardSummary,
  moatStrength: MoatStrength,
  fundamentals: Fundamentals,
): Tier {
  const strongCount = scorecard.strong;
  const weakCount = scorecard.weak;
  const hardFcfFail =
    fundamentals.freeCashflow !== null && fundamentals.freeCashflow <= 0;

  // Hard-fail conditions push to Poor regardless of other signals
  if (
    hardFcfFail ||
    weakCount >= 3 ||
    (moatStrength === "weak" && strongCount < 3)
  ) {
    return "poor";
  }

  if (strongCount >= 4 && weakCount === 0 && moatStrength === "strong") {
    return "exceptional";
  }

  if (
    strongCount >= 3 &&
    weakCount <= 1 &&
    (moatStrength === "strong" || moatStrength === "unclear")
  ) {
    return "good";
  }

  return "average";
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
  const total = 5;
  const strong = scorecard.strong;
  const weak = scorecard.weak;
  const moatLabel = ARCHETYPE_LABELS[moatArchetype];

  const metricSnippet = formatKeyMetrics(fundamentals);

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
    case "average":
      return `Average business: mixed quality signals (${strong} strong, ${weak} weak), ${moatPhrase}. ${metricSnippet}`;
    case "poor":
      return `Poor business: ${weak} of ${total} dimensions failing, ${moatPhrase}. ${metricSnippet}`;
  }
}

function formatKeyMetrics(fd: Fundamentals): string {
  const parts: string[] = [];
  if (fd.returnOnEquity !== null && Number.isFinite(fd.returnOnEquity)) {
    parts.push(`ROE ${(fd.returnOnEquity * 100).toFixed(1)}%`);
  }
  if (fd.operatingMargins !== null && Number.isFinite(fd.operatingMargins)) {
    parts.push(`Op margin ${(fd.operatingMargins * 100).toFixed(1)}%`);
  }
  if (fd.freeCashflow !== null && Number.isFinite(fd.freeCashflow)) {
    parts.push(`FCF ${formatLargeUSD(fd.freeCashflow)}`);
  }
  if (fd.debtToEquity !== null && Number.isFinite(fd.debtToEquity)) {
    parts.push(`D/E ${fd.debtToEquity.toFixed(0)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") + "." : "";
}

function formatLargeUSD(value: number): string {
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

// Quality scoring thresholds for each metric.
// Returns "strong" | "acceptable" | "weak" | "neutral" (for metrics where
// color-coding doesn't add signal, like sector-dependent P/E).

import type {
  AnnualFundamentalRow,
  MultiYearFundamentals,
} from "@/lib/financial";

export type Quality = "strong" | "acceptable" | "weak" | "neutral";

export type MetricKind =
  | "returnOnEquity"
  | "returnOnAssets"
  | "profitMargins"
  | "operatingMargins"
  | "grossMargins"
  | "freeCashflow"
  | "debtToEquity"
  | "currentRatio"
  | "earningsGrowth"
  | "revenueGrowth"
  | "trailingPE"
  | "forwardPE";

export function scoreMetric(
  kind: MetricKind,
  value: number | null,
): Quality {
  if (value === null || !Number.isFinite(value)) return "neutral";

  switch (kind) {
    case "returnOnEquity":
      if (value >= 0.15) return "strong";
      if (value >= 0.10) return "acceptable";
      return "weak";
    case "returnOnAssets":
      if (value >= 0.10) return "strong";
      if (value >= 0.05) return "acceptable";
      return "weak";
    case "grossMargins":
      if (value >= 0.40) return "strong";
      if (value >= 0.25) return "acceptable";
      return "weak";
    case "operatingMargins":
      if (value >= 0.20) return "strong";
      if (value >= 0.10) return "acceptable";
      return "weak";
    case "profitMargins":
      if (value >= 0.15) return "strong";
      if (value >= 0.05) return "acceptable";
      return "weak";
    case "freeCashflow":
      if (value > 0) return "strong";
      if (value === 0) return "acceptable";
      return "weak";
    case "debtToEquity":
      // yfinance returns D/E as a percentage (e.g. 102.63 = 102.63%)
      if (value < 50) return "strong";
      if (value < 100) return "acceptable";
      return "weak";
    case "currentRatio":
      if (value >= 1.5) return "strong";
      if (value >= 1.0) return "acceptable";
      return "weak";
    case "revenueGrowth":
      if (value >= 0.10) return "strong";
      if (value >= 0.05) return "acceptable";
      return "weak";
    case "earningsGrowth":
      if (value >= 0.15) return "strong";
      if (value >= 0.05) return "acceptable";
      return "weak";
    case "trailingPE":
    case "forwardPE":
      // P/E is sector-dependent — don't color-code
      return "neutral";
  }
}

// --- Multi-year Buffett-aligned scoring ---
// These replace ROE and "FCF > 0 as quality" in the tier calculation. Each
// score requires the metric to clear the threshold on BOTH the 5-year median
// AND the worst year — so a cyclical peak doesn't earn "strong".

export type MultiYearScore = {
  quality: Quality;
  median: number | null;
  worstYear: number | null;
  yearsUsed: number;
  note?: string; // e.g. "Insufficient history (<3 years)"
};

export function computeRoicPerYear(
  rows: AnnualFundamentalRow[],
): { year: string; value: number }[] {
  // NOPAT / Invested Capital where NOPAT = EBIT × (1 − taxRate).
  // When taxRate is missing we assume 21% (US corporate statutory) as a
  // conservative fallback rather than skipping the year.
  return rows
    .map((r) => {
      if (r.ebit === null || r.investedCapital === null) return null;
      if (r.investedCapital <= 0) return null; // ROIC undefined on negative IC
      const taxRate =
        r.taxRate !== null && r.taxRate >= 0 && r.taxRate < 1 ? r.taxRate : 0.21;
      const nopat = r.ebit * (1 - taxRate);
      return { year: r.fiscalYearEnd, value: nopat / r.investedCapital };
    })
    .filter((x): x is { year: string; value: number } => x !== null);
}

export function computeFcfMarginPerYear(
  rows: AnnualFundamentalRow[],
): { year: string; value: number }[] {
  return rows
    .map((r) => {
      if (r.revenue === null || r.revenue <= 0 || r.freeCashFlow === null)
        return null;
      return { year: r.fiscalYearEnd, value: r.freeCashFlow / r.revenue };
    })
    .filter((x): x is { year: string; value: number } => x !== null);
}

export function computeShareCountCagr(
  rows: AnnualFundamentalRow[],
): number | null {
  // Sorted ascending on input. Use oldest and newest rows with shares data.
  const withShares = rows.filter((r) => r.sharesDiluted !== null);
  if (withShares.length < 2) return null;
  const oldest = withShares[0].sharesDiluted as number;
  const newest = withShares[withShares.length - 1].sharesDiluted as number;
  if (oldest <= 0 || newest <= 0) return null;
  const years = withShares.length - 1;
  // CAGR. Positive = dilution, negative = buybacks reducing count.
  return Math.pow(newest / oldest, 1 / years) - 1;
}

export function scoreRoic(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const series = computeRoicPerYear(mya.years);
  if (series.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const values = series.map((s) => s.value);
  const med = median(values);
  const worst = Math.min(...values);
  if (series.length < 3) {
    return {
      quality: "neutral",
      median: med,
      worstYear: worst,
      yearsUsed: series.length,
      note: "Insufficient history (<3 years)",
    };
  }
  // Buffett-aligned: strong needs BOTH good median AND no ugly trough
  let quality: Quality;
  if (med >= 0.15 && worst >= 0.1) quality = "strong";
  else if (med >= 0.1 && worst >= 0.05) quality = "acceptable";
  else quality = "weak";
  return { quality, median: med, worstYear: worst, yearsUsed: series.length };
}

export function scoreFcfMargin(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const series = computeFcfMarginPerYear(mya.years);
  if (series.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const values = series.map((s) => s.value);
  const med = median(values);
  const worst = Math.min(...values);
  if (series.length < 3) {
    return {
      quality: "neutral",
      median: med,
      worstYear: worst,
      yearsUsed: series.length,
      note: "Insufficient history (<3 years)",
    };
  }
  let quality: Quality;
  if (med >= 0.15 && worst >= 0.08) quality = "strong";
  else if (med >= 0.08 && worst >= 0.02) quality = "acceptable";
  else quality = "weak";
  return { quality, median: med, worstYear: worst, yearsUsed: series.length };
}

export function scoreShareCountTrend(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length < 2) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const cagr = computeShareCountCagr(mya.years);
  if (cagr === null) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  // Negative CAGR = count shrinking (buybacks > issuance) = strong.
  let quality: Quality;
  if (cagr <= -0.01) quality = "strong";
  else if (cagr <= 0.01) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: cagr,
    worstYear: null,
    yearsUsed: mya.years.filter((r) => r.sharesDiluted !== null).length,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function qualityStyles(quality: Quality) {
  switch (quality) {
    case "strong":
      return {
        border: "border-l-emerald-500",
        dot: "bg-emerald-500",
        label: "Strong",
        labelColor: "text-emerald-700",
      };
    case "acceptable":
      return {
        border: "border-l-amber-500",
        dot: "bg-amber-500",
        label: "Acceptable",
        labelColor: "text-amber-700",
      };
    case "weak":
      return {
        border: "border-l-red-500",
        dot: "bg-red-500",
        label: "Weak",
        labelColor: "text-red-700",
      };
    case "neutral":
      return {
        border: "border-l-navy-200",
        dot: "bg-navy-300",
        label: "",
        labelColor: "",
      };
  }
}

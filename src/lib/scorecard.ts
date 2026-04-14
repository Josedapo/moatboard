// Quality scoring thresholds for each metric.
// Returns "strong" | "acceptable" | "weak" | "neutral" (for metrics where
// color-coding doesn't add signal, like sector-dependent P/E).

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

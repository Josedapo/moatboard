// Quality scoring thresholds for each metric.
// Returns "strong" | "acceptable" | "weak" | "neutral" (for metrics where
// color-coding doesn't add signal, like sector-dependent P/E).

import type {
  AnnualFundamentalRow,
  MultiYearFundamentals,
} from "@/lib/financial";

export type Quality = "strong" | "acceptable" | "weak" | "neutral";

// Scoring window cap. SEC EDGAR delivers 10–18 years of annual data, but
// the quality literature is explicit about using a 10-year lookback for
// median + worst-year scoring:
//   - Buffett, 1987 shareholder letter: endorsed a Fortune screen of
//     "average ROE > 20% AND no year below 15% over 10 years" (1977-1986).
//   - Pat Dorsey, *The Little Book That Builds Wealth* (2008), ch. 8: a
//     wide moat requires ~15 years of returns above cost of capital — but
//     that's for moat-durability judgement, not median scoring.
//   - Terry Smith, *Investing for Growth* (2020): quality selection uses
//     5-year average cash conversion + 10-year average margins; the
//     portfolio scorecard itself is TTM.
//   - Aswath Damodaran, *Valuation* ch. 11: historical CAGR beyond 5
//     years is a poor predictor; ventanas largas cruzan regime changes.
// Windows longer than 10y cross regime changes (pre/post-iPhone,
// pre/post-cloud, pre/post-GFC, management turnovers, transformative
// M&A) that distort medians. Keep the full EDGAR window in `mya.years`
// for context and narrative, but cap what feeds the scorers.
export const SCORING_WINDOW_YEARS = 10;

export function capMultiYearForScoring(
  mya: MultiYearFundamentals | null,
): MultiYearFundamentals | null {
  if (!mya) return null;
  if (mya.years.length <= SCORING_WINDOW_YEARS) return mya;
  const capped = mya.years.slice(-SCORING_WINDOW_YEARS);
  const yearsAvailable = capped.filter(
    (r) =>
      r.revenue !== null &&
      r.ebit !== null &&
      r.investedCapital !== null &&
      r.freeCashFlow !== null,
  ).length;
  return { ...mya, years: capped, yearsAvailable };
}

// D/E scoring with sector awareness. Banks, insurers and REITs operate
// at high leverage by design — the 50%/100% thresholds used for product
// businesses would misclassify them. Neutralize instead.
export function scoreDebtToEquity(
  value: number | null,
  sector: string | null,
  industry: string | null,
): { quality: Quality; note?: string } {
  if (isDebtToEquityNeutral(sector, industry)) {
    return {
      quality: "neutral",
      note: "Not a quality signal for this sector",
    };
  }
  if (value === null || !Number.isFinite(value)) {
    return { quality: "neutral" };
  }
  if (value < 50) return { quality: "strong" };
  if (value < 100) return { quality: "acceptable" };
  return { quality: "weak" };
}

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
  // Latest reported value of the metric. For ratios (ROIC, FCF margin,
  // op margin, etc.) this is the most recent year's value of the ratio
  // itself. For CAGR-based metrics (revenue growth, AFFO/share, BV/share)
  // this is the most recent year's YoY change. Used by the UI to render
  // a triangulation hint ("último año vs mediana 10y") so the reader
  // can spot regime change that the long-window aggregate hides.
  latestValue?: number | null;
  // True when `median` is actually a CAGR (compound rate over the
  // window) rather than a year-by-year median — applies to revenue
  // growth, AFFO/share growth, BV/share growth. The UI uses this flag
  // to label correctly ("vs CAGR 10y" instead of "vs mediana 10y").
  isCagr?: boolean;
};

// Helper: latest value of a per-year series (chronologically ordered).
// For ratio-based scorers (ROIC, FCF margin, etc.) — returns the most
// recent year's value of the ratio. Null when the series is empty.
function latestOfSeries(
  series: { year: string; value: number }[],
): number | null {
  return series.length > 0 ? series[series.length - 1].value : null;
}

// Helper: YoY change of the last two non-null/positive values from a
// chronologically-ordered list of nullable values. Used by CAGR-based
// scorers (revenue growth, BV/share, AFFO/share) where the headline
// is a CAGR over the window but we want to surface the most recent
// year's YoY as a triangulation hint.
function latestYoY(values: (number | null)[]): number | null {
  const valid = values.filter(
    (v): v is number => v !== null && Number.isFinite(v) && v > 0,
  );
  if (valid.length < 2) return null;
  const last = valid[valid.length - 1];
  const prev = valid[valid.length - 2];
  return (last - prev) / prev;
}

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

export function computeGrossMarginPerYear(
  rows: AnnualFundamentalRow[],
): { year: string; value: number }[] {
  return rows
    .map((r) => {
      if (r.revenue === null || r.revenue <= 0 || r.grossProfit === null)
        return null;
      return { year: r.fiscalYearEnd, value: r.grossProfit / r.revenue };
    })
    .filter((x): x is { year: string; value: number } => x !== null);
}

export function computeOperatingMarginPerYear(
  rows: AnnualFundamentalRow[],
): { year: string; value: number }[] {
  return rows
    .map((r) => {
      if (r.revenue === null || r.revenue <= 0 || r.operatingIncome === null)
        return null;
      return { year: r.fiscalYearEnd, value: r.operatingIncome / r.revenue };
    })
    .filter((x): x is { year: string; value: number } => x !== null);
}

export function computeRevenueCagr(
  rows: AnnualFundamentalRow[],
): number | null {
  const withRevenue = rows.filter(
    (r) => r.revenue !== null && r.revenue > 0,
  );
  if (withRevenue.length < 2) return null;
  const oldest = withRevenue[0].revenue as number;
  const newest = withRevenue[withRevenue.length - 1].revenue as number;
  const years = withRevenue.length - 1;
  return Math.pow(newest / oldest, 1 / years) - 1;
}

export function computeFcfConversionPerYear(
  rows: AnnualFundamentalRow[],
): { year: string; value: number }[] {
  // FCF / Net Income — Smith's fifth metric. Reference only, not scored.
  return rows
    .map((r) => {
      if (r.netIncome === null || r.netIncome <= 0 || r.freeCashFlow === null)
        return null;
      return { year: r.fiscalYearEnd, value: r.freeCashFlow / r.netIncome };
    })
    .filter((x): x is { year: string; value: number } => x !== null);
}

// Buffett's "one-dollar test" (1983 shareholder letter): for every dollar the
// business has retained (net income not paid out as dividends), has it
// generated at least a dollar of market value? Directional capital-allocation
// signal, shown as a reference card — NOT scored. Market-cap change is a
// noisy proxy over 5y because it blends value creation with multiple
// expansion; the test is most informative at extremes and is neutral
// otherwise.
export type RetentionMultiple = {
  ratio: number | null; // value created per dollar retained
  retainedCapital: number | null; // Σ (NI − Dividends) over the window, USD
  valueCreated: number | null; // current market cap − market cap at window start, USD
  yearsUsed: number;
  // Reading using Buffett's 1983 one-dollar threshold. Universal (not
  // sector-dependent), so we surface it as a visual cue on the reference
  // card. It does NOT contribute to the tier — share count already covers
  // capital allocation in the scorecard.
  quality: Quality;
  note?: string;
};

export function computeRetentionMultiple({
  mya,
  currentMarketCap,
  oldestMarketCap,
}: {
  mya: MultiYearFundamentals | null;
  currentMarketCap: number | null;
  oldestMarketCap: number | null;
}): RetentionMultiple {
  if (!mya || mya.years.length < 3) {
    return {
      ratio: null,
      retainedCapital: null,
      valueCreated: null,
      yearsUsed: mya?.years.length ?? 0,
      quality: "neutral",
      note: "Insufficient history (<3 years)",
    };
  }
  if (
    currentMarketCap === null ||
    oldestMarketCap === null ||
    !Number.isFinite(currentMarketCap) ||
    !Number.isFinite(oldestMarketCap) ||
    oldestMarketCap <= 0
  ) {
    return {
      ratio: null,
      retainedCapital: null,
      valueCreated: null,
      yearsUsed: mya.years.length,
      quality: "neutral",
      note: "Market cap history unavailable",
    };
  }

  // Retained capital = Σ (Net Income − Dividends paid). yfinance reports
  // cashDividendsPaid as a negative outflow, so subtracting it adds back.
  let retained = 0;
  let yearsUsed = 0;
  for (const r of mya.years) {
    if (r.netIncome === null) continue;
    const dividends = r.cashDividendsPaid ?? 0; // typically negative
    // NI plus (−dividends paid) → NI minus |dividends|
    retained += r.netIncome + dividends;
    yearsUsed += 1;
  }

  if (yearsUsed === 0 || retained <= 0) {
    // Net distributor (e.g. REITs paying out > earnings) — the one-dollar
    // test is not defined in its standard form.
    return {
      ratio: null,
      retainedCapital: retained,
      valueCreated: currentMarketCap - oldestMarketCap,
      yearsUsed,
      quality: "neutral",
      note: retained <= 0 ? "Net distributor — test not applicable" : undefined,
    };
  }

  const valueCreated = currentMarketCap - oldestMarketCap;
  const ratio = valueCreated / retained;
  // Buffett's one-dollar test thresholds:
  //   ≥ 1.5x = capital allocation accretive (strong)
  //   1.0 – 1.5x = just passes the test (acceptable)
  //   < 1.0x or negative = sub-par or actively destructive (weak)
  let quality: Quality;
  if (ratio >= 1.5) quality = "strong";
  else if (ratio >= 1.0) quality = "acceptable";
  else quality = "weak";
  return {
    ratio,
    retainedCapital: retained,
    valueCreated,
    yearsUsed,
    quality,
  };
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
  sector: string | null = null,
  industry: string | null = null,
): MultiYearScore {
  // Banks, insurers, REITs — "invested capital" in the traditional sense
  // doesn't apply (balance sheet IS the product). Neutralize rather than
  // score a number that would mislead.
  if (isRoicNeutral(sector, industry)) {
    return {
      quality: "neutral",
      median: null,
      worstYear: null,
      yearsUsed: 0,
      note: "Not a quality signal for this sector",
    };
  }
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
  return {
    quality,
    median: med,
    worstYear: worst,
    yearsUsed: series.length,
    latestValue: latestOfSeries(series),
  };
}

export function scoreFcfMargin(
  mya: MultiYearFundamentals | null,
  sector: string | null = null,
  industry: string | null = null,
): MultiYearScore {
  // Banks and insurers — FCF is dominated by loan/deposit/claim flows,
  // not by cash the business generates from operating a product. Not a
  // meaningful quality signal in that context.
  if (isFcfMarginNeutral(sector, industry)) {
    return {
      quality: "neutral",
      median: null,
      worstYear: null,
      yearsUsed: 0,
      note: "Not a quality signal for this sector",
    };
  }
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
  return {
    quality,
    median: med,
    worstYear: worst,
    yearsUsed: series.length,
    latestValue: latestOfSeries(series),
  };
}

// --- Sector/industry classification helpers ---
//
// yfinance's sector/industry taxonomy uses em-dashes ("Banks—Diversified")
// in some responses and hyphens / en-dashes in others. Normalize to a
// single canonical form before comparing so matching is robust.
function normalizeTaxonomy(s: string | null): string | null {
  if (s === null) return null;
  // U+002D (-), U+2010 (‐), U+2012 (‒), U+2013 (–), U+2014 (—), U+2212 (−)
  return s.replace(/[-\u2010\u2012\u2013\u2014\u2212]/g, "—").trim();
}

// Within Financial Services, these industries DO have meaningful
// cost-of-revenue and pricing-power gross margin — payment networks,
// exchanges, data providers. They should be scored like any product
// business, not neutralized.
const FINANCIAL_SERVICES_SCORED_INDUSTRIES = new Set([
  "Credit Services",
  "Financial Data & Stock Exchanges",
  "Capital Markets",
]);

// Balance-sheet businesses: revenue is net interest income or net premium
// (banks, insurers, mortgage finance, asset managers). ROIC (no "invested
// capital" in the product sense), FCF margin (cash flow dominated by loan
// / deposit / claim flows), gross margin (no COGS), and D/E (leveraged by
// design) are all not quality signals in these businesses.
const BALANCE_SHEET_INDUSTRIES = new Set([
  "Banks—Diversified",
  "Banks—Regional",
  "Mortgage Finance",
  "Insurance—Diversified",
  "Insurance—Life",
  "Insurance—Property & Casualty",
  "Insurance—Reinsurance",
  "Insurance—Specialty",
  "Insurance Brokers",
  "Asset Management",
  "Financial Conglomerates",
  // Health insurers — revenue is net premium, expenses are claims.
  // Structurally identical to P&C / life in framework terms even though
  // yfinance classifies them under sector "Healthcare" rather than
  // "Financial Services" / "Insurance".
  "Healthcare Plans",
  // Mortgage REITs — spread businesses (NII on mortgage-backed securities)
  // more than real-estate operators. AFFO doesn't apply; ROE / ROA / book
  // value CAGR (the bank scorecard) is the faithful frame.
  "REIT—Mortgage",
]);

export function isBalanceSheetBusiness(
  sector: string | null,
  industry: string | null,
): boolean {
  const normSector = normalizeTaxonomy(sector);
  const normIndustry = normalizeTaxonomy(industry);
  if (normSector === "Insurance") return true;
  if (normIndustry && BALANCE_SHEET_INDUSTRIES.has(normIndustry)) return true;
  if (normSector === "Financial Services") {
    // Catch-all for Financial Services industries not in the "scored" list.
    // This protects against yfinance adding new bank-like industries that
    // aren't in BALANCE_SHEET_INDUSTRIES yet.
    if (
      !normIndustry ||
      !FINANCIAL_SERVICES_SCORED_INDUSTRIES.has(normIndustry)
    ) {
      return true;
    }
  }
  return false;
}

// Real estate (REITs) — gross margin not meaningful (revenue is rent, no
// COGS concept); D/E thresholds don't apply (REITs use leverage by
// design). FCF margin IS meaningful (close to AFFO), kept scored.
export function isRealEstate(sector: string | null): boolean {
  return normalizeTaxonomy(sector) === "Real Estate";
}

// Commodity producers and cyclical businesses — gross margin dominated by
// commodity cycles, not pricing power.
const COMMODITY_CYCLICAL_SECTORS = new Set(["Energy", "Basic Materials"]);
const COMMODITY_CYCLICAL_INDUSTRIES = new Set([
  "Biotechnology",
  "Drug Manufacturers—Specialty & Generic",
  "Airlines",
  "Oil & Gas Exploration & Production",
  "Oil & Gas Drilling",
  "Coal",
  "Copper",
  "Silver",
  "Gold",
  "Aluminum",
  "Uranium",
  "Semiconductor Equipment & Materials",
]);

export function isCommodityCyclical(
  sector: string | null,
  industry: string | null,
): boolean {
  const normSector = normalizeTaxonomy(sector);
  const normIndustry = normalizeTaxonomy(industry);
  if (normSector && COMMODITY_CYCLICAL_SECTORS.has(normSector)) return true;
  if (normIndustry && COMMODITY_CYCLICAL_INDUSTRIES.has(normIndustry))
    return true;
  return false;
}

// Per-metric applicability
export function isGrossMarginNeutral(
  sector: string | null,
  industry: string | null,
): boolean {
  return (
    isBalanceSheetBusiness(sector, industry) ||
    isRealEstate(sector) ||
    isCommodityCyclical(sector, industry)
  );
}

export function isRoicNeutral(
  sector: string | null,
  industry: string | null,
): boolean {
  return isBalanceSheetBusiness(sector, industry) || isRealEstate(sector);
}

export function isFcfMarginNeutral(
  sector: string | null,
  industry: string | null,
): boolean {
  return isBalanceSheetBusiness(sector, industry);
}

export function isDebtToEquityNeutral(
  sector: string | null,
  industry: string | null,
): boolean {
  return isBalanceSheetBusiness(sector, industry) || isRealEstate(sector);
}

export function scoreGrossMargin(
  mya: MultiYearFundamentals | null,
  sector: string | null,
  industry: string | null,
): MultiYearScore {
  // Sector-aware neutralization: in businesses where gross margin is not a
  // moat signal (banks, insurers, real estate, commodity producers),
  // return `neutral` rather than scoring a number that would mislead.
  if (isGrossMarginNeutral(sector, industry)) {
    return {
      quality: "neutral",
      median: null,
      worstYear: null,
      yearsUsed: 0,
      note: "Not a quality signal for this sector",
    };
  }
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const series = computeGrossMarginPerYear(mya.years);
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
  // Buffett/Smith-faithful thresholds: high pricing power looks like 50%+
  // gross margin sustained (Coca-Cola, Moody's, Visa); acceptable territory
  // is 35-50% (many healthcare / consumer compounders).
  let quality: Quality;
  if (med >= 0.5 && worst >= 0.4) quality = "strong";
  else if (med >= 0.35 && worst >= 0.25) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: med,
    worstYear: worst,
    yearsUsed: series.length,
    latestValue: latestOfSeries(series),
  };
}

export function scoreOperatingMargin(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const series = computeOperatingMarginPerYear(mya.years);
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
  // Thresholds match the former trailing `scoreMetric("operatingMargins")`
  // but now require the worst year to clear a floor, Buffett-aligned.
  let quality: Quality;
  if (med >= 0.2 && worst >= 0.1) quality = "strong";
  else if (med >= 0.1 && worst >= 0.05) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: med,
    worstYear: worst,
    yearsUsed: series.length,
    latestValue: latestOfSeries(series),
  };
}

export function scoreRevenueGrowthMultiYear(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length < 2) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const cagr = computeRevenueCagr(mya.years);
  if (cagr === null) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const withRev = mya.years.filter((r) => r.revenue !== null && r.revenue > 0)
    .length;
  if (withRev < 3) {
    return {
      quality: "neutral",
      median: cagr,
      worstYear: null,
      yearsUsed: withRev,
      note: "Insufficient history (<3 years)",
    };
  }
  let quality: Quality;
  if (cagr >= 0.1) quality = "strong";
  else if (cagr >= 0.05) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: cagr,
    worstYear: null,
    yearsUsed: withRev,
    latestValue: latestYoY(mya.years.map((r) => r.revenue)),
    isCagr: true,
  };
}

export function computeFcfConversionMedian(
  mya: MultiYearFundamentals | null,
): { median: number | null; yearsUsed: number } {
  if (!mya || mya.years.length === 0) return { median: null, yearsUsed: 0 };
  const series = computeFcfConversionPerYear(mya.years);
  if (series.length === 0) return { median: null, yearsUsed: 0 };
  return { median: median(series.map((s) => s.value)), yearsUsed: series.length };
}

// ─── Bank / insurer (balance-sheet business) scored dimensions ─────────────
// Three dimensions that replace the four neutralizations (ROIC, Gross Margin,
// FCF Margin, D/E) for balance-sheet businesses: ROE and ROA multi-year
// (median + worst year, the Buffett/Damodaran framework for bank quality) +
// Book Value per share 5y CAGR (the Buffett "one-dollar test" for bank
// capital allocation — retained capital should grow book value over time).
// Thresholds from `Context/bank-reit-thresholds-research.md` (2026-04-17).

export function computeRoePerYear(
  rows: AnnualFundamentalRow[],
): { year: string; value: number }[] {
  return rows
    .map((r) => {
      if (
        r.netIncome === null ||
        r.stockholdersEquity === null ||
        r.stockholdersEquity <= 0
      )
        return null;
      return { year: r.fiscalYearEnd, value: r.netIncome / r.stockholdersEquity };
    })
    .filter((x): x is { year: string; value: number } => x !== null);
}

export function computeRoaPerYear(
  rows: AnnualFundamentalRow[],
): { year: string; value: number }[] {
  return rows
    .map((r) => {
      if (
        r.netIncome === null ||
        r.totalAssets === null ||
        r.totalAssets <= 0
      )
        return null;
      return { year: r.fiscalYearEnd, value: r.netIncome / r.totalAssets };
    })
    .filter((x): x is { year: string; value: number } => x !== null);
}

export function computeBookValuePerShareCagr(
  rows: AnnualFundamentalRow[],
): number | null {
  const usable = rows.filter(
    (r) =>
      r.stockholdersEquity !== null &&
      r.stockholdersEquity > 0 &&
      r.sharesDiluted !== null &&
      r.sharesDiluted > 0,
  );
  if (usable.length < 2) return null;
  const oldest = usable[0];
  const newest = usable[usable.length - 1];
  const oldestBvps =
    (oldest.stockholdersEquity as number) / (oldest.sharesDiluted as number);
  const newestBvps =
    (newest.stockholdersEquity as number) / (newest.sharesDiluted as number);
  if (oldestBvps <= 0 || newestBvps <= 0) return null;
  const years = usable.length - 1;
  return Math.pow(newestBvps / oldestBvps, 1 / years) - 1;
}

export function scoreRoeMultiYear(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const series = computeRoePerYear(mya.years);
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
  // Damodaran sector data (Jan 2026): Money Center 12.86%, Regional 9.75%,
  // P&C 18.71%, Life 12.87%. Cost of equity ~10–12% for US banks. Strong
  // ≥ 15% puts the bank decisively above cost of equity. Worst-year 10%
  // requires survival above cost of equity in a recession (Buffett 1989).
  let quality: Quality;
  if (med >= 0.15 && worst >= 0.1) quality = "strong";
  else if (med >= 0.1 && worst >= 0.05) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: med,
    worstYear: worst,
    yearsUsed: series.length,
    latestValue: latestOfSeries(series),
  };
}

export function scoreRoaMultiYear(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const series = computeRoaPerYear(mya.years);
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
  // Buffett 1990 benchmark for Wells Fargo: 1.25% ROA = "exceptional bank".
  // FFIEC UBPR top-quartile large banks sit at 1.2–1.4%. Strong 1.2% /
  // worst 0.8% captures the Buffett-class bank; acceptable catches the
  // merely profitable operator.
  let quality: Quality;
  if (med >= 0.012 && worst >= 0.008) quality = "strong";
  else if (med >= 0.008 && worst >= 0.004) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: med,
    worstYear: worst,
    yearsUsed: series.length,
    latestValue: latestOfSeries(series),
  };
}

export function scoreBookValuePerShareCagr(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length < 2) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const cagr = computeBookValuePerShareCagr(mya.years);
  if (cagr === null) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const withData = mya.years.filter(
    (r) =>
      r.stockholdersEquity !== null &&
      r.stockholdersEquity > 0 &&
      r.sharesDiluted !== null &&
      r.sharesDiluted > 0,
  ).length;
  if (withData < 3) {
    return {
      quality: "neutral",
      median: cagr,
      worstYear: null,
      yearsUsed: withData,
      note: "Insufficient history (<3 years)",
    };
  }
  // Buffett's one-dollar test for banks: retained capital should grow
  // book value. Berkshire's own BV/share compounding ran ~20% long-run;
  // quality US banks grow BV/share 7–10% (buybacks + retained earnings).
  // Strong ≥ 7% — quality compounder rate. Acceptable ≥ 3% — at least
  // keeping up with inflation.
  let quality: Quality;
  if (cagr >= 0.07) quality = "strong";
  else if (cagr >= 0.03) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: cagr,
    worstYear: null,
    yearsUsed: withData,
    latestValue: latestYoY(
      mya.years.map((r) =>
        r.stockholdersEquity !== null &&
        r.stockholdersEquity > 0 &&
        r.sharesDiluted !== null &&
        r.sharesDiluted > 0
          ? r.stockholdersEquity / r.sharesDiluted
          : null,
      ),
    ),
    isCagr: true,
  };
}

// ─── REIT scored dimensions ────────────────────────────────────────────────
// Three dimensions that replace the three neutralizations (ROIC, Gross
// Margin, D/E) for REITs. FCF Margin stays scored because AFFO ≈ FCF
// for real estate. AFFO payout ratio and Net Debt / EBITDA are latest-year
// snapshots (industry convention); AFFO/share CAGR is multi-year trend.
// Thresholds from `Context/bank-reit-thresholds-research.md` (2026-04-17).

// Single-snapshot score shape for REIT leverage and payout, which are
// reported at point-in-time by industry convention (unlike the cycle-
// sensitive margins).
export type SingleYearScore = {
  quality: Quality;
  value: number | null;
  note?: string;
};

export function scoreAffoPayout(
  mya: MultiYearFundamentals | null,
): SingleYearScore {
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", value: null };
  }
  // Use the latest year with both dividends paid and positive FCF (AFFO
  // proxy). Payout = |dividends| / FCF.
  const latest = [...mya.years]
    .reverse()
    .find(
      (r) =>
        r.cashDividendsPaid !== null &&
        r.freeCashFlow !== null &&
        r.freeCashFlow > 0,
    );
  if (!latest) {
    return { quality: "neutral", value: null, note: "AFFO or dividends not reported" };
  }
  const dividendsAbs = Math.abs(latest.cashDividendsPaid as number);
  const fcf = latest.freeCashFlow as number;
  const ratio = dividendsAbs / fcf;
  // Green Street Advisors "safety band": ≤ 80% is the healthy zone;
  // 80–90% is acceptable but watchful; > 90% is the pre-distress tail
  // (historical O, STOR, NNN cycles).
  let quality: Quality;
  if (ratio <= 0.8) quality = "strong";
  else if (ratio <= 0.9) quality = "acceptable";
  else quality = "weak";
  return { quality, value: ratio };
}

export function scoreNetDebtToEbitda(
  mya: MultiYearFundamentals | null,
): SingleYearScore {
  if (!mya || mya.years.length === 0) {
    return { quality: "neutral", value: null };
  }
  const latest = [...mya.years]
    .reverse()
    .find(
      (r) =>
        r.totalDebt !== null &&
        r.operatingIncome !== null &&
        r.depreciationAmortization !== null,
    );
  if (!latest) {
    return {
      quality: "neutral",
      value: null,
      note: "Debt or EBITDA inputs not reported",
    };
  }
  const cash = latest.cash ?? 0;
  const netDebt = (latest.totalDebt as number) - cash;
  const ebitda =
    (latest.operatingIncome as number) +
    (latest.depreciationAmortization as number);
  if (ebitda <= 0) {
    return { quality: "neutral", value: null, note: "Negative EBITDA" };
  }
  const ratio = netDebt / ebitda;
  // Moody's Global REITs Rating Methodology (Sept 2022): investment-grade
  // REITs cluster < 6.5x; conservative operators (PLD, O) sit at 5.0–5.5x;
  // > 7x is the aggressive tail associated with credit-rating pressure.
  let quality: Quality;
  if (ratio < 5.5) quality = "strong";
  else if (ratio < 6.5) quality = "acceptable";
  else quality = "weak";
  return { quality, value: ratio };
}

export function computeAffoPerShareCagr(
  rows: AnnualFundamentalRow[],
): number | null {
  const usable = rows.filter(
    (r) =>
      r.freeCashFlow !== null &&
      r.freeCashFlow > 0 &&
      r.sharesDiluted !== null &&
      r.sharesDiluted > 0,
  );
  if (usable.length < 2) return null;
  const oldest = usable[0];
  const newest = usable[usable.length - 1];
  const oldestAffoPs =
    (oldest.freeCashFlow as number) / (oldest.sharesDiluted as number);
  const newestAffoPs =
    (newest.freeCashFlow as number) / (newest.sharesDiluted as number);
  if (oldestAffoPs <= 0 || newestAffoPs <= 0) return null;
  const years = usable.length - 1;
  return Math.pow(newestAffoPs / oldestAffoPs, 1 / years) - 1;
}

export function scoreAffoPerShareCagr(
  mya: MultiYearFundamentals | null,
): MultiYearScore {
  if (!mya || mya.years.length < 2) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const cagr = computeAffoPerShareCagr(mya.years);
  if (cagr === null) {
    return { quality: "neutral", median: null, worstYear: null, yearsUsed: 0 };
  }
  const withData = mya.years.filter(
    (r) =>
      r.freeCashFlow !== null &&
      r.freeCashFlow > 0 &&
      r.sharesDiluted !== null &&
      r.sharesDiluted > 0,
  ).length;
  if (withData < 3) {
    return {
      quality: "neutral",
      median: cagr,
      worstYear: null,
      yearsUsed: withData,
      note: "Insufficient history (<3 years)",
    };
  }
  // Industry benchmarks: O and PLD typically sustain 4–6% AFFO/share
  // growth through cycles; VICI at 6–7% as a younger REIT; broad REIT
  // universe sits at 2–4%. Strong ≥ 5% distinguishes the quality
  // operator; acceptable ≥ 2% catches at-inflation compounders.
  let quality: Quality;
  if (cagr >= 0.05) quality = "strong";
  else if (cagr >= 0.02) quality = "acceptable";
  else quality = "weak";
  return {
    quality,
    median: cagr,
    worstYear: null,
    yearsUsed: withData,
    latestValue: latestYoY(
      mya.years.map((r) =>
        r.freeCashFlow !== null &&
        r.freeCashFlow > 0 &&
        r.sharesDiluted !== null &&
        r.sharesDiluted > 0
          ? r.freeCashFlow / r.sharesDiluted
          : null,
      ),
    ),
    isCagr: true,
  };
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
    latestValue: latestYoY(mya.years.map((r) => r.sharesDiluted)),
    isCagr: true,
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

// Sustainable growth — the second core anchor of the Implied Return frame.
//
// Convergent across Smith, Polen, Damodaran, Akre: a business cannot grow
// sustainably above what its return on capital × retention rate supports
// without external financing. Smith calls it "the natural growth ceiling";
// Damodaran's textbook formula:
//
//   Sustainable Growth = ROIC × (1 − payout)        (product businesses)
//   Sustainable Growth = ROE × (1 − payout)         (balance-sheet)
//   Sustainable Growth ≈ ROA × (1 − payout)         (REITs, AFFO proxy)
//
// We compute two anchors per ticker:
//
//   1. Historical CAGR — what the business actually did. Track record manda.
//   2. Sustainable fundamental — what the math of the business supports.
//
// Base case = min(historical, fundamental), capped at 20% (no business
// sustains > 20% growth for 10 years — Buffett dixit, S&P data confirms).
// Stress case = base × 0.7 (cushion for assumption errors).
// Optimistic = max(historical, fundamental), capped at 20% (informational).
//
// "The lesser anchor wins" enforces Smith's discipline: never extrapolate
// growth beyond what either the track record or the math supports.

import {
  capMultiYearForScoring,
  computeAffoPerShareCagr,
  computeRevenueCagr,
  isBalanceSheetBusiness,
  isRealEstate,
} from "@/lib/scorecard";
import type {
  Fundamentals,
  MultiYearFundamentals,
} from "@/lib/financial";

export const GROWTH_CAP = 0.2;
export const STRESS_FACTOR = 0.7;

// Default payout when yfinance doesn't expose payoutRatio. Conservative
// midpoint — keeps fundamental growth from being inflated when payout is
// genuinely missing rather than zero.
const DEFAULT_PAYOUT = 0.5;

// Multi-year median ROIC pulled from the scorecard pipeline. Re-implemented
// here to avoid pulling the full scorecard machinery for a single number.
function computeMedianRoic(
  multiYear: MultiYearFundamentals | null,
): number | null {
  if (!multiYear || multiYear.years.length === 0) return null;
  const values = multiYear.years
    .map((r) => {
      if (
        r.ebit === null ||
        r.investedCapital === null ||
        r.investedCapital <= 0
      )
        return null;
      const taxRate =
        r.taxRate !== null && r.taxRate >= 0 && r.taxRate < 1 ? r.taxRate : 0.21;
      const nopat = r.ebit * (1 - taxRate);
      return nopat / r.investedCapital;
    })
    .filter((x): x is number => x !== null);
  if (values.length < 3) return null;
  return median(values);
}

function computeMedianRoe(
  multiYear: MultiYearFundamentals | null,
): number | null {
  if (!multiYear || multiYear.years.length === 0) return null;
  const values = multiYear.years
    .map((r) => {
      if (
        r.netIncome === null ||
        r.stockholdersEquity === null ||
        r.stockholdersEquity <= 0
      )
        return null;
      return r.netIncome / r.stockholdersEquity;
    })
    .filter((x): x is number => x !== null);
  if (values.length < 3) return null;
  return median(values);
}

function computeMedianRoa(
  multiYear: MultiYearFundamentals | null,
): number | null {
  if (!multiYear || multiYear.years.length === 0) return null;
  const values = multiYear.years
    .map((r) => {
      if (
        r.netIncome === null ||
        r.totalAssets === null ||
        r.totalAssets <= 0
      )
        return null;
      return r.netIncome / r.totalAssets;
    })
    .filter((x): x is number => x !== null);
  if (values.length < 3) return null;
  return median(values);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clampPayout(payout: number | null | undefined): number {
  if (payout === null || payout === undefined || !Number.isFinite(payout)) {
    return DEFAULT_PAYOUT;
  }
  // yfinance occasionally reports payouts > 1 (when dividends exceed earnings
  // in a transitional year). Cap at 0.95 so retention stays positive.
  return Math.max(0, Math.min(0.95, payout));
}

export type GrowthAnchorKey = "historical" | "fundamental";

export type GrowthAnchor = {
  key: GrowthAnchorKey;
  label: string; // user-facing label, Spanish
  value: number | null; // decimal (0.12 = 12%)
  formula: string; // user-facing description of how it was computed
  note?: string;
};

export type SustainableGrowthResult = {
  base: number; // min(anchors), capped — used as growth in base CAGR
  stress: number; // base × STRESS_FACTOR — used as growth in stress CAGR
  optimistic: number; // max(anchors), capped — informational
  driver: GrowthAnchorKey | null; // which anchor pinned the base; null if all anchors null
  anchors: GrowthAnchor[];
  capApplied: boolean; // true when uncapped base would have exceeded GROWTH_CAP
  note?: string; // rendered as a one-line explainer in the widget
};

// Conservative default for tickers where neither anchor is computable —
// applies to recent IPOs with thin history and no usable ROIC. Matches
// the historical default in valuation.ts (observedGrowthRate fallback).
const FALLBACK_GROWTH = 0.04;

export function computeSustainableGrowth({
  multiYear,
  fundamentals,
  sector,
  industry,
}: {
  multiYear: MultiYearFundamentals | null;
  fundamentals: Fundamentals | null;
  sector: string | null;
  industry: string | null;
}): SustainableGrowthResult {
  // Cap the history to the same 10-year window the scorecard uses
  // (SCORING_WINDOW_YEARS in scorecard.ts) — anchored on Buffett 1987,
  // Smith 2020, Damodaran ch. 11. Without this cap a ticker with deep
  // SEC history (MSFT 18y) would compute its growth anchor on a window
  // that crosses regime changes (pre-Nadella era) and disagree with the
  // scorecard's revenue-growth dimension on the same page.
  const cappedMultiYear = capMultiYearForScoring(multiYear);
  const anchors: GrowthAnchor[] = [];

  // Anchor 1 — historical CAGR.
  // For REITs prefer AFFO/share CAGR (industry convention); else revenue CAGR.
  const isReit = isRealEstate(sector);
  let historicalValue: number | null = null;
  let historicalLabel: string;
  let historicalFormula: string;
  if (isReit) {
    historicalValue = cappedMultiYear
      ? computeAffoPerShareCagr(cappedMultiYear.years)
      : null;
    historicalLabel = "Histórico AFFO/share (10y)";
    historicalFormula = "CAGR de AFFO por acción · ventana 10y";
  } else {
    historicalValue = cappedMultiYear
      ? computeRevenueCagr(cappedMultiYear.years)
      : null;
    historicalLabel = "Histórico revenue CAGR (10y)";
    historicalFormula = "Crecimiento anualizado de ingresos · ventana 10y";
  }

  anchors.push({
    key: "historical",
    label: historicalLabel,
    value: historicalValue,
    formula: historicalFormula,
    note:
      historicalValue !== null && historicalValue < 0
        ? "Histórico negativo — el negocio se ha contraído"
        : undefined,
  });

  // Anchor 2 — sustainable fundamental.
  // ROIC × (1 − payout) for product businesses, ROE × (1 − payout) for
  // balance-sheet, ROA × (1 − payout) for REITs.
  const payout = clampPayout(fundamentals?.payoutRatio);
  const retention = 1 - payout;

  const isBank = isBalanceSheetBusiness(sector, industry);
  let fundamentalValue: number | null = null;
  let fundamentalFormula: string;
  if (isBank) {
    const roe = computeMedianRoe(cappedMultiYear);
    fundamentalValue = roe !== null ? roe * retention : null;
    fundamentalFormula = `ROE mediano (10y) × retención (${(retention * 100).toFixed(0)}%)`;
  } else if (isReit) {
    const roa = computeMedianRoa(cappedMultiYear);
    fundamentalValue = roa !== null ? roa * retention : null;
    fundamentalFormula = `ROA mediano (10y) × retención (${(retention * 100).toFixed(0)}%)`;
  } else {
    const roic = computeMedianRoic(cappedMultiYear);
    fundamentalValue = roic !== null ? roic * retention : null;
    fundamentalFormula = `ROIC mediano (10y) × retención (${(retention * 100).toFixed(0)}%)`;
  }

  anchors.push({
    key: "fundamental",
    label: "Fundamental sostenible",
    value: fundamentalValue,
    formula: fundamentalFormula,
    note:
      fundamentalValue !== null && fundamentalValue < 0
        ? "ROIC/ROE/ROA negativo — el negocio destruye capital"
        : undefined,
  });

  // Apply the rule: base case = min of available anchors, capped.
  const usable = anchors.filter(
    (a): a is GrowthAnchor & { value: number } =>
      a.value !== null && Number.isFinite(a.value),
  );

  if (usable.length === 0) {
    return {
      base: FALLBACK_GROWTH,
      stress: FALLBACK_GROWTH * STRESS_FACTOR,
      optimistic: FALLBACK_GROWTH,
      driver: null,
      anchors,
      capApplied: false,
      note: "Sin datos suficientes — usando fallback conservador del 4%",
    };
  }

  const minAnchor = usable.reduce((a, b) => (a.value <= b.value ? a : b));
  const maxAnchor = usable.reduce((a, b) => (a.value >= b.value ? a : b));

  // Negative growth means the business is shrinking — for the implied return
  // calculator we floor the base at 0%. The optimistic stays unchanged so the
  // user sees the underlying numbers honestly.
  const rawBase = Math.max(0, minAnchor.value);
  const cappedBase = Math.min(rawBase, GROWTH_CAP);
  const capApplied = rawBase > GROWTH_CAP;

  const rawOptimistic = Math.max(0, maxAnchor.value);
  const cappedOptimistic = Math.min(rawOptimistic, GROWTH_CAP);

  return {
    base: cappedBase,
    stress: cappedBase * STRESS_FACTOR,
    optimistic: cappedOptimistic,
    driver: minAnchor.key,
    anchors,
    capApplied,
    note: capApplied
      ? `Cap del ${(GROWTH_CAP * 100).toFixed(0)}% aplicado — ningún negocio sostiene más durante 10 años`
      : usable.length === 1
        ? `Solo una ancla disponible (${minAnchor.label}) — sin cross-check`
        : undefined,
  };
}

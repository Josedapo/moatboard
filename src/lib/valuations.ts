import { sql } from "@/lib/db";
import type { CompoundTier, DcfTier, RelativeTier } from "@/lib/valuation";

export type ValuationMethod =
  | "dcf" // owner earnings two-stage DCF (default for product businesses)
  | "affo_dcf" // same math as dcf, labeled for real estate (AFFO proxy)
  | "excess_returns" // banks/insurers — ROE vs Cost of Equity on book value
  | "ai_multiples"; // fallback when no absolute method applies

// Per-metric snapshot of the relative-to-self valuation: where the current
// multiple sits inside the company's own multi-year distribution (trimmed of
// IQR outliers). Persisted as part of `assumptions` JSONB so legacy rows
// without this data still parse.
export type RelativeMetricSnapshot = {
  current: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
  current_percentile: number | null; // 0-100
};

export type RelativeValuationSnapshot = {
  years_of_data: number;
  points_count: number;
  pe: RelativeMetricSnapshot;
  fcf_yield: RelativeMetricSnapshot; // "price / FCF per share" convention — lower = cheaper
  // P/B ratio vs own history. Optional so snapshots generated before P/B was
  // added still parse. When equity is negative (aggressive-buyback names) the
  // metric stays null rather than producing misleading negative multiples.
  pb?: RelativeMetricSnapshot;
  // Note on conventions:
  // - PE: lower = cheaper. Tier thresholds use PE directly.
  // - FCF: stored as yield (FCF/price), but classified via 1/yield (price/FCF)
  //   so "lower = cheaper" holds across metrics. The stored snapshot keeps
  //   the yield form because yield is what's intuitive to report.
  // - P/B: lower = cheaper, stored directly as price/book.
  note?: string;
};

export type DcfStoredAssumptions = {
  owner_earnings_base: number;
  net_income: number;
  depreciation_amortization: number;
  maintenance_capex_proxy: number;
  stage_one_growth: number; // years 1-5
  terminal_growth: number; // fades into from year 5 onward
  treasury_yield_pct: number; // 5y avg of ^TNX used as terminal anchor
  // Current (spot) Treasury 10y yield at generation time, used in the
  // Relative card to compare FCF yield vs risk-free alternative. Optional
  // because legacy valuations generated before this field was added won't
  // have it.
  treasury_current_pct?: number;
  treasury_source: "yfinance_tnx" | "fallback";
  hurdle_rates: { low: number; base: number; high: number };
  net_debt: number;
  shares_outstanding: number;
  years_of_history: number;
  base_note?: string;
  relative_valuation?: RelativeValuationSnapshot;
  // Present-value concentration at the base hurdle rate — the share of IV
  // coming from years 1-5, years 6-10, and the Gordon terminal perpetuity.
  // Surfaced in the UI so the reader can see when IV is dominated by
  // assumptions about the far future (Damodaran's terminal-value warning;
  // the "Coca-Cola 1998" regime). Decimals 0-1. Optional because legacy
  // valuations don't have it.
  pv_breakdown?: {
    stage_one_pct: number;
    stage_two_pct: number;
    terminal_pct: number;
  };
};

export type AiMultiplesStoredAssumptions = {
  basis: "forward_pe" | "price_to_sales" | "comparables";
  sector_multiple_used: number;
  relative_valuation?: RelativeValuationSnapshot;
};

// Banks, insurers, balance-sheet businesses — Excess Returns Model.
// IV = Book Value + PV of (ROE − Cost of Equity) × BV_{t-1} over a 10y
// horizon, fading to zero excess returns beyond year 10 (competitive
// equilibrium). Hurdle rates are Ke ± 200bp for the bear/base/bull range.
export type ExcessReturnsStoredAssumptions = {
  book_value: number; // current stockholders' equity
  stable_roe: number; // multi-year median ROE
  retention_ratio: number; // 1 − payoutRatio (clamped)
  cost_of_equity: number; // base Ke used for the headline IV
  risk_free_rate: number; // 10y Treasury current rate
  beta: number | null; // yfinance beta, null if unavailable
  equity_risk_premium: number; // fixed US ERP used in CAPM (5%)
  terminal_roe: number; // ROE at year 10 (typically = Ke)
  hurdle_rates: { low: number; base: number; high: number }; // Ke variants
  shares_outstanding: number;
  years_of_history: number; // yearsUsed from the stable ROE computation
  base_note?: string;
  relative_valuation?: RelativeValuationSnapshot;
};

export type Valuation = {
  id: number;
  position_id: number;
  method: ValuationMethod;
  intrinsic_value: string; // numeric returned as string by pg (base / 12% hurdle)
  intrinsic_value_low: string; // most pessimistic hurdle (14%)
  intrinsic_value_high: string; // most optimistic hurdle (10%)
  current_price: string;
  margin_of_safety_pct: string;
  tier: CompoundTier;
  dcf_tier: DcfTier;
  relative_tier: RelativeTier | null;
  assumptions:
    | DcfStoredAssumptions
    | AiMultiplesStoredAssumptions
    | ExcessReturnsStoredAssumptions;
  reasoning: string;
  generated_at: string;
};

export async function getValuationByPositionId(
  positionId: number,
): Promise<Valuation | null> {
  const rows = (await sql`
    SELECT id, position_id, method, intrinsic_value, intrinsic_value_low,
           intrinsic_value_high, current_price, margin_of_safety_pct, tier,
           dcf_tier, relative_tier, assumptions, reasoning, generated_at
    FROM valuations
    WHERE position_id = ${positionId}
    LIMIT 1
  `) as unknown as Valuation[];
  return rows[0] ?? null;
}

export async function saveValuation({
  positionId,
  method,
  intrinsicValue,
  intrinsicValueLow,
  intrinsicValueHigh,
  currentPrice,
  marginOfSafetyPct,
  tier,
  dcfTier,
  relativeTier,
  assumptions,
  reasoning,
}: {
  positionId: number;
  method: ValuationMethod;
  intrinsicValue: number;
  intrinsicValueLow: number;
  intrinsicValueHigh: number;
  currentPrice: number;
  marginOfSafetyPct: number;
  tier: CompoundTier;
  dcfTier: DcfTier;
  relativeTier: RelativeTier | null;
  assumptions:
    | DcfStoredAssumptions
    | AiMultiplesStoredAssumptions
    | ExcessReturnsStoredAssumptions;
  reasoning: string;
}): Promise<Valuation> {
  const rows = (await sql`
    INSERT INTO valuations (
      position_id, method, intrinsic_value, intrinsic_value_low,
      intrinsic_value_high, current_price, margin_of_safety_pct, tier,
      dcf_tier, relative_tier, assumptions, reasoning
    )
    VALUES (
      ${positionId}, ${method}, ${intrinsicValue}, ${intrinsicValueLow},
      ${intrinsicValueHigh}, ${currentPrice}, ${marginOfSafetyPct}, ${tier},
      ${dcfTier}, ${relativeTier}, ${JSON.stringify(assumptions)}, ${reasoning}
    )
    ON CONFLICT (position_id) DO UPDATE
      SET method = EXCLUDED.method,
          intrinsic_value = EXCLUDED.intrinsic_value,
          intrinsic_value_low = EXCLUDED.intrinsic_value_low,
          intrinsic_value_high = EXCLUDED.intrinsic_value_high,
          current_price = EXCLUDED.current_price,
          margin_of_safety_pct = EXCLUDED.margin_of_safety_pct,
          tier = EXCLUDED.tier,
          dcf_tier = EXCLUDED.dcf_tier,
          relative_tier = EXCLUDED.relative_tier,
          assumptions = EXCLUDED.assumptions,
          reasoning = EXCLUDED.reasoning,
          generated_at = NOW()
    RETURNING id, position_id, method, intrinsic_value, intrinsic_value_low,
              intrinsic_value_high, current_price, margin_of_safety_pct, tier,
              dcf_tier, relative_tier, assumptions, reasoning, generated_at
  `) as unknown as Valuation[];
  return rows[0];
}

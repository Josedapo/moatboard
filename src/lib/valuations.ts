import { sql } from "@/lib/db";
import type { CompoundTier, DcfTier, RelativeTier } from "@/lib/valuation";

export type ValuationMethod =
  | "implied_return" // 2026-04-25 — primary method, FCF Yield + Growth + Δ Multiple
  | "dcf" // owner earnings two-stage DCF (cross-check, secondary)
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
  // Period covered by the history (YYYY-MM-DD). Optional so legacy snapshots
  // generated before these fields were added still parse; the UI degrades
  // gracefully to showing just years_of_data when they're absent.
  period_start?: string;
  period_end?: string;
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

// Implied Return Model — primary method since 2026-04-25 redesign. Frames
// valuation as "what return can I expect at this price?" rather than "is
// this below intrinsic?". The frame Buffett post-1985, Smith, and Akre
// use operationally. See lib/impliedReturn.ts for the math; lib/sustainable
// Growth.ts for how growth anchors are derived.
//
// `cross_check` carries the absolute-valuation result (DCF / AFFO / Excess
// Returns / AI multiples) computed in parallel — kept secondary for users
// who want to see the deep-value lens, never used as the primary verdict.
export type ImpliedReturnStoredAssumptions = {
  // Inputs
  fcf_yield: number;
  fcf_ttm: number; // absolute USD, used to render the calculation transparently
  market_cap: number;
  // Growth — the full set of anchors so the UI can render the rationale.
  growth: {
    base: number;
    stress: number;
    optimistic: number;
    driver: "historical" | "fundamental" | null;
    cap_applied: boolean;
    note?: string;
    anchors: Array<{
      key: "historical" | "fundamental";
      label: string;
      value: number | null;
      formula: string;
      note?: string;
    }>;
  };
  multiple_change_base: number; // signed, annualized — effective value used in CAGR (override if present, else auto-derived)
  multiple_change_stress: number; // signed, annualized
  // User-supplied terminal overrides. Persisted as the absolute Nx target
  // ("the multiple I believe this business should converge to long-term"),
  // not as a rate — so when price moves, the terminal stays anchored and
  // the implied %/año re-derives against the new current. This matches the
  // mental model: the multiple is the anchor, the price oscillates around
  // it. Cleared by setting to null via updateImpliedReturnOverrideAction.
  multiple_base_terminal_override?: number | null;
  multiple_stress_terminal_override?: number | null;
  // Legacy rate-based overrides — kept readable for rows that haven't been
  // migrated to the absolute-terminal model yet. Always null on new rows.
  // Migration script: scripts/migrate-multiple-overrides-to-absolute.mjs.
  multiple_change_base_override?: number | null;
  multiple_change_stress_override?: number | null;
  // Same override pattern for sustainable growth assumptions. Used when
  // the auto-derived growth (min of historical CAGR and ROIC × retention)
  // diverges from what Joseda observes happening in the recent year(s) —
  // typically prompted by the latest-year line in the Quality scorecard
  // showing deterioration the 10y CAGR hides. Decimals (0.12 = 12%/year).
  growth_base_override?: number | null;
  growth_stress_override?: number | null;
  // Multiple metadata — surfaced in the UI so the reader can see WHICH
  // multiple is driving the verdict and at what level it lands in each
  // scenario. Optional so legacy implied_return rows generated before this
  // metadata existed still parse.
  multiple_label?: "P/E" | "P/FCF" | "P/B";
  multiple_source?:
    | "ai_guide"
    | "deterministic_fallback"
    | "peer_median_fallback";
  multiple_current?: number | null;
  multiple_median?: number | null;
  multiple_q1?: number | null;
  // Computed terminal multiples for each scenario. Base ends at min(current,
  // median); stress ends at q1. Nullable when the snapshot is unusable.
  // When an override is active the terminal reflects the override.
  multiple_base_terminal?: number | null;
  multiple_stress_terminal?: number | null;
  // Cross-sectional anchor (peer median by business type). Used by the
  // calculator UI to render a disclaimer when the current multiple
  // significantly exceeds peer norm — does NOT affect the verdict math.
  peer_median?: number | null;
  peer_median_label?: "P/E" | "P/FCF" | "P/B";
  peer_median_source?: "industry" | "sector" | null;
  // Exact yfinance industry string or sector name that matched the peer
  // median lookup. Surfaced in the UI so users see the specific category
  // (e.g. "Insurance - Property & Casualty") instead of just "industria".
  peer_median_match_key?: string | null;
  // Quality tier — surfaced as a context label in the calculator, never
  // as a threshold driver. What return is acceptable for a given tier is
  // a per-investor judgment; Moatboard shows the expected CAGR and lets
  // the user calibrate.
  quality_tier: "exceptional" | "good" | "mediocre" | "poor";
  // Treasury 10y + 2% — kept as a factual reference line in the UI ("the
  // bar a stress case would have to clear to beat the bond"), not as a
  // pass/fail gate. `floor` is the precomputed sum, `treasury_yield` is
  // the bare 10y rate at generation time so the UI can label transparently.
  floor: number;
  treasury_yield: number;
  // Outputs
  base_cagr: number;
  stress_cagr: number;
  optimistic_cagr: number;
  // Optional cross-check (DCF / AFFO / Excess Returns / AI multiples). Kept
  // so users can see the deep-value lens in "Otros métodos" without losing
  // the legacy data path.
  cross_check?: {
    method: "dcf" | "affo_dcf" | "excess_returns" | "ai_multiples";
    intrinsic_value: number;
    intrinsic_value_low: number;
    intrinsic_value_high: number;
    assumptions:
      | DcfStoredAssumptions
      | ExcessReturnsStoredAssumptions
      | AiMultiplesStoredAssumptions;
    reasoning: string;
  };
  // Relative valuation (multiples vs own history) — same shape as legacy.
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
    | ImpliedReturnStoredAssumptions
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
    | ImpliedReturnStoredAssumptions
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

import { sql } from "@/lib/db";
import type { MosTier } from "@/lib/valuation";

export type ValuationMethod = "dcf" | "ai_multiples";

export type DcfStoredAssumptions = {
  owner_earnings_base: number;
  net_income: number;
  depreciation_amortization: number;
  maintenance_capex_proxy: number;
  stage_one_growth: number; // years 1-5
  terminal_growth: number; // fades into from year 5 onward
  treasury_yield_pct: number; // 5y avg of ^TNX used as terminal anchor
  treasury_source: "yfinance_tnx" | "fallback";
  hurdle_rates: { low: number; base: number; high: number };
  net_debt: number;
  shares_outstanding: number;
  years_of_history: number;
  base_note?: string;
};

export type AiMultiplesStoredAssumptions = {
  basis: "forward_pe" | "price_to_sales" | "comparables";
  sector_multiple_used: number;
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
  tier: MosTier;
  assumptions: DcfStoredAssumptions | AiMultiplesStoredAssumptions;
  reasoning: string;
  generated_at: string;
};

export async function getValuationByPositionId(
  positionId: number,
): Promise<Valuation | null> {
  const rows = (await sql`
    SELECT id, position_id, method, intrinsic_value, intrinsic_value_low,
           intrinsic_value_high, current_price, margin_of_safety_pct, tier,
           assumptions, reasoning, generated_at
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
  tier: MosTier;
  assumptions: DcfStoredAssumptions | AiMultiplesStoredAssumptions;
  reasoning: string;
}): Promise<Valuation> {
  const rows = (await sql`
    INSERT INTO valuations (
      position_id, method, intrinsic_value, intrinsic_value_low,
      intrinsic_value_high, current_price, margin_of_safety_pct, tier,
      assumptions, reasoning
    )
    VALUES (
      ${positionId}, ${method}, ${intrinsicValue}, ${intrinsicValueLow},
      ${intrinsicValueHigh}, ${currentPrice}, ${marginOfSafetyPct}, ${tier},
      ${JSON.stringify(assumptions)}, ${reasoning}
    )
    ON CONFLICT (position_id) DO UPDATE
      SET method = EXCLUDED.method,
          intrinsic_value = EXCLUDED.intrinsic_value,
          intrinsic_value_low = EXCLUDED.intrinsic_value_low,
          intrinsic_value_high = EXCLUDED.intrinsic_value_high,
          current_price = EXCLUDED.current_price,
          margin_of_safety_pct = EXCLUDED.margin_of_safety_pct,
          tier = EXCLUDED.tier,
          assumptions = EXCLUDED.assumptions,
          reasoning = EXCLUDED.reasoning,
          generated_at = NOW()
    RETURNING id, position_id, method, intrinsic_value, intrinsic_value_low,
              intrinsic_value_high, current_price, margin_of_safety_pct, tier,
              assumptions, reasoning, generated_at
  `) as unknown as Valuation[];
  return rows[0];
}

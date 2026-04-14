import { sql } from "@/lib/db";
import type { MosTier } from "@/lib/valuation";

export type ValuationMethod = "dcf" | "ai_multiples";

export type DcfStoredAssumptions = {
  fcf_base: number;
  growth_rate: number;
  terminal_growth: number;
  discount_rate: number;
  net_debt: number;
  shares_outstanding: number;
};

export type AiMultiplesStoredAssumptions = {
  basis: "forward_pe" | "price_to_sales" | "comparables";
  sector_multiple_used: number;
};

export type Valuation = {
  id: number;
  position_id: number;
  method: ValuationMethod;
  intrinsic_value: string; // numeric returned as string by pg
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
    SELECT id, position_id, method, intrinsic_value, current_price,
           margin_of_safety_pct, tier, assumptions, reasoning, generated_at
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
  currentPrice,
  marginOfSafetyPct,
  tier,
  assumptions,
  reasoning,
}: {
  positionId: number;
  method: ValuationMethod;
  intrinsicValue: number;
  currentPrice: number;
  marginOfSafetyPct: number;
  tier: MosTier;
  assumptions: DcfStoredAssumptions | AiMultiplesStoredAssumptions;
  reasoning: string;
}): Promise<Valuation> {
  const rows = (await sql`
    INSERT INTO valuations (
      position_id, method, intrinsic_value, current_price,
      margin_of_safety_pct, tier, assumptions, reasoning
    )
    VALUES (
      ${positionId}, ${method}, ${intrinsicValue}, ${currentPrice},
      ${marginOfSafetyPct}, ${tier}, ${JSON.stringify(assumptions)}, ${reasoning}
    )
    ON CONFLICT (position_id) DO UPDATE
      SET method = EXCLUDED.method,
          intrinsic_value = EXCLUDED.intrinsic_value,
          current_price = EXCLUDED.current_price,
          margin_of_safety_pct = EXCLUDED.margin_of_safety_pct,
          tier = EXCLUDED.tier,
          assumptions = EXCLUDED.assumptions,
          reasoning = EXCLUDED.reasoning,
          generated_at = NOW()
    RETURNING id, position_id, method, intrinsic_value, current_price,
              margin_of_safety_pct, tier, assumptions, reasoning, generated_at
  `) as unknown as Valuation[];
  return rows[0];
}

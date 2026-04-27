import { callText } from "@/lib/claudeClient";
import { parseJsonObject } from "@/lib/aiJson";
import type { Quote, Fundamentals } from "@/lib/financial";

// DCF assumptions (growth / terminal / discount) are NOT AI-suggested.
// The two-stage model in `valuation.ts` derives them deterministically from
// observed history (stage 1 = capped 5y revenue CAGR), the US 10y Treasury
// yield (terminal anchor), and three fixed hurdle rates (10/12/14%).
// The AI is kept only for the multiples fallback path used for businesses
// where DCF cannot be applied (negative owner earnings, no shares out, etc.).

export type MultiplesEstimate = {
  intrinsic_value: number;
  basis: "forward_pe" | "price_to_sales" | "comparables";
  sector_multiple_used: number;
  reasoning: string;
};

export async function estimateWithMultiples(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<MultiplesEstimate> {
  const prompt = `You are estimating intrinsic value using multiples for a business where DCF is not reliable (e.g., negative or volatile FCF). Be honest about limitations and use sector-appropriate multiples.

Company: ${quote?.longName ?? ticker} (${ticker})
Sector: ${quote?.sector ?? "Unknown"}
Industry: ${quote?.industry ?? "Unknown"}
Market cap: ${quote?.marketCap ? `$${(quote.marketCap / 1e9).toFixed(2)}B` : "Unknown"}
Current price: ${formatNum(quote?.regularMarketPrice)}
Shares outstanding: ${formatNum(quote?.sharesOutstanding)}

Fundamentals:
- FCF: ${formatLargeUSD(fundamentals?.freeCashflow)}
- Forward P/E: ${formatNum(fundamentals?.forwardPE)}
- Revenue growth YoY: ${formatPct(fundamentals?.revenueGrowth)}
- Operating margin: ${formatPct(fundamentals?.operatingMargins)}

Choose ONE basis:
- "forward_pe": if forward earnings positive and a reasonable sector multiple exists. intrinsic_value = forward_eps × sector_multiple_used.
- "price_to_sales": if pre-profit growth stock with positive revenue. intrinsic_value = revenue_per_share × sector_multiple_used.
- "comparables": for special situations where neither applies cleanly; explain reasoning.

IMPORTANT — language: write the 'reasoning' string in SPANISH, close conversational tone. Financial acronyms (DCF, PE, FCF, etc.) stay in English; everything else in natural Spanish. Enum values (basis) stay in English.

OUTPUT (strict JSON, no preamble):

{
  "intrinsic_value": <number, per share, in current price's currency>,
  "basis": "forward_pe" | "price_to_sales" | "comparables",
  "sector_multiple_used": <number>,
  "reasoning": "1-2 frases en español explicando el múltiplo elegido y por qué DCF no aplicaba."
}`;

  const { text: raw } = await callText(prompt, { maxTokens: 600 });
  const parsed = parseJsonObject<MultiplesEstimate>(raw);

  if (!Number.isFinite(parsed.intrinsic_value) || parsed.intrinsic_value <= 0) {
    throw new Error("Intrinsic value invalid");
  }
  if (!["forward_pe", "price_to_sales", "comparables"].includes(parsed.basis)) {
    throw new Error(`Invalid basis: ${parsed.basis}`);
  }

  return parsed;
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  return value.toFixed(2);
}

function formatLargeUSD(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

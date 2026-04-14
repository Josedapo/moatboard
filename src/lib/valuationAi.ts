import Anthropic from "@anthropic-ai/sdk";
import type { Quote, Fundamentals } from "@/lib/financial";

export type DcfAssumptions = {
  growth_rate: number;
  terminal_growth: number;
  discount_rate: number;
  reasoning: string;
};

export type MultiplesEstimate = {
  intrinsic_value: number;
  basis: "forward_pe" | "price_to_sales" | "comparables";
  sector_multiple_used: number;
  reasoning: string;
};

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function suggestDcfAssumptions(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<DcfAssumptions> {
  const prompt = `You are setting conservative-realistic DCF assumptions for a buy-and-hold investor. Goal: avoid optimistic projections that inflate intrinsic value.

Company: ${quote?.longName ?? ticker} (${ticker})
Sector: ${quote?.sector ?? "Unknown"}
Industry: ${quote?.industry ?? "Unknown"}
Business: ${quote?.longBusinessSummary?.slice(0, 600) ?? "n/a"}

Recent fundamentals:
- Revenue Growth YoY: ${formatPct(fundamentals?.revenueGrowth)}
- Earnings Growth YoY: ${formatPct(fundamentals?.earningsGrowth)}
- Operating Margin: ${formatPct(fundamentals?.operatingMargins)}
- FCF: ${formatLargeUSD(fundamentals?.freeCashflow)}
- Debt/Equity: ${formatNum(fundamentals?.debtToEquity)}%
- Trailing P/E: ${formatNum(fundamentals?.trailingPE)}
- Forward P/E: ${formatNum(fundamentals?.forwardPE)}

Rules:
- growth_rate (years 1-10): anchor on observed historical growth tempered by competitive dynamics, sector maturity, and base-rate reality. Cap at 0.20 (20%) even for the fastest growers — long-horizon DCF cannot justify higher.
- terminal_growth: 0.02-0.03 (2-3%, GDP-like). Default 0.025.
- discount_rate (WACC): 0.08-0.14 based on risk profile. Higher for cyclicals, leveraged businesses, geographic risk; lower for stable, low-debt, defensive businesses. Default 0.10.

OUTPUT (strict JSON, no preamble):

{
  "growth_rate": 0.10,
  "terminal_growth": 0.025,
  "discount_rate": 0.10,
  "reasoning": "1-2 sentences explaining the choice of growth, terminal, and discount given this business."
}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  const raw = textBlock.text.trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Could not find JSON: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]) as DcfAssumptions;

  if (
    !Number.isFinite(parsed.growth_rate) ||
    !Number.isFinite(parsed.terminal_growth) ||
    !Number.isFinite(parsed.discount_rate)
  ) {
    throw new Error("DCF assumptions missing or non-numeric");
  }

  // Sanity bounds — clamp to safe ranges
  parsed.growth_rate = clamp(parsed.growth_rate, 0.0, 0.25);
  parsed.terminal_growth = clamp(parsed.terminal_growth, 0.0, 0.04);
  parsed.discount_rate = clamp(parsed.discount_rate, 0.06, 0.18);

  return parsed;
}

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

OUTPUT (strict JSON, no preamble):

{
  "intrinsic_value": <number, per share, in current price's currency>,
  "basis": "forward_pe" | "price_to_sales" | "comparables",
  "sector_multiple_used": <number>,
  "reasoning": "1-2 sentences explaining the multiple chosen and explicitly noting why DCF wasn't applicable."
}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  const raw = textBlock.text.trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Could not find JSON: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]) as MultiplesEstimate;

  if (!Number.isFinite(parsed.intrinsic_value) || parsed.intrinsic_value <= 0) {
    throw new Error("Intrinsic value invalid");
  }
  if (!["forward_pe", "price_to_sales", "comparables"].includes(parsed.basis)) {
    throw new Error(`Invalid basis: ${parsed.basis}`);
  }

  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

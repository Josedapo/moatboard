import Anthropic from "@anthropic-ai/sdk";
import type { Quote, Fundamentals } from "@/lib/financial";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";

export type MoatEvaluation = {
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
};

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

const ARCHETYPES: MoatArchetype[] = [
  "brand",
  "network_effects",
  "switching_costs",
  "scale",
  "ip",
  "regulatory",
  "cost_advantage",
  "none",
];

function buildPrompt(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): string {
  const companyInfo = quote
    ? `
Company: ${quote.longName ?? ticker} (${ticker})
Sector: ${quote.sector ?? "Unknown"}
Industry: ${quote.industry ?? "Unknown"}
Market cap: ${quote.marketCap ? `$${(quote.marketCap / 1e9).toFixed(2)}B` : "Unknown"}
Business: ${quote.longBusinessSummary ?? "No description available."}
`.trim()
    : `Ticker: ${ticker} (no market data available).`;

  const fd = fundamentals;
  const fundamentalsInfo = fd
    ? `
Quality signals (trailing/most recent):
- Gross Margin: ${formatPct(fd.grossMargins)}  (sustained high gross margin suggests pricing power / brand)
- Operating Margin: ${formatPct(fd.operatingMargins)}  (operating leverage)
- ROE: ${formatPct(fd.returnOnEquity)}  (capital efficiency, proxies ROIC)
- ROA: ${formatPct(fd.returnOnAssets)}  (asset productivity)
- Revenue Growth YoY: ${formatPct(fd.revenueGrowth)}
- Earnings Growth YoY: ${formatPct(fd.earningsGrowth)}
`.trim()
    : "Fundamentals not available.";

  return `You are evaluating the COMPETITIVE MOAT of a business for a buy-and-hold investor.

A moat is a structural, durable advantage that lets the business sustain high returns on capital despite competition over many years. Examples:
- brand: pricing power from brand recognition (Coca-Cola, LVMH)
- network_effects: value grows with users (Visa, Meta, Airbnb)
- switching_costs: customers locked in (Salesforce, Microsoft, Adobe)
- scale: cost advantages from size (Amazon, Costco)
- ip: patents, formulas, exclusive technology (pharma, semis)
- regulatory: licenses, exclusivity, government barriers (utilities, defense)
- cost_advantage: structural cost edge (low-cost producer in commodities)
- none: no identifiable moat — commodity-like, intense competition, easily replicable

Be honest. If the moat is absent or trivial, return strength="weak" and archetype="none". Do NOT invent a moat to be polite.

If a moat exists but its archetype is not clear-cut, pick the BEST FIT and set strength to "unclear" (you see signals of an advantage but can't pinpoint why).

${companyInfo}

${fundamentalsInfo}

OUTPUT (strict JSON, no preamble, no commentary):

{
  "strength": "strong" | "weak" | "unclear",
  "archetype": "brand" | "network_effects" | "switching_costs" | "scale" | "ip" | "regulatory" | "cost_advantage" | "none",
  "reasoning": "1-2 sentences citing specific evidence — sustained gross margins, dominant share, regulatory entry barrier, recurring revenue, etc."
}`;
}

export async function assessMoat(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<{ evaluation: MoatEvaluation; model: string }> {
  const prompt = buildPrompt(ticker, quote, fundamentals);

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
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not find JSON in response: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as MoatEvaluation;

  if (!["strong", "weak", "unclear"].includes(parsed.strength)) {
    throw new Error(`Invalid moat strength: ${parsed.strength}`);
  }
  if (!ARCHETYPES.includes(parsed.archetype)) {
    throw new Error(`Invalid moat archetype: ${parsed.archetype}`);
  }
  if (
    typeof parsed.reasoning !== "string" ||
    parsed.reasoning.trim().length === 0
  ) {
    throw new Error("Missing moat reasoning");
  }

  return { evaluation: parsed, model: MODEL };
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

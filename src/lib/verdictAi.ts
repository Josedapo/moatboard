import Anthropic from "@anthropic-ai/sdk";
import type { Quote, Fundamentals } from "@/lib/financial";
import type {
  Tier,
  ScorecardSummary,
  MoatStrength,
  MoatArchetype,
} from "@/lib/verdict";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

const TIER_FRAMING: Record<Tier, string> = {
  exceptional:
    "an EXCEPTIONAL business — top-tier compounder territory: durable advantage and capital efficiency that few businesses sustain.",
  good:
    "a GOOD business — solid, with most quality dimensions in healthy territory and a recognizable moat, even if not at the top tier.",
  average:
    "an AVERAGE business — real strengths balanced by material weaknesses; not a clear-cut compounder, not a clear-cut avoid.",
  poor:
    "a POOR business — fails Moatboard's quality bar on multiple dimensions; the things Buffett cares about are absent or broken here.",
};

function buildPrompt({
  tier,
  scorecard,
  moatStrength,
  moatArchetype,
  moatReasoning,
  quote,
  fundamentals,
  ticker,
}: {
  tier: Tier;
  scorecard: ScorecardSummary;
  moatStrength: MoatStrength;
  moatArchetype: MoatArchetype;
  moatReasoning: string;
  quote: Quote | null;
  fundamentals: Fundamentals;
  ticker: string;
}): string {
  const dims = scorecard.dimensions;

  const metricsLine = [
    fundamentals.returnOnEquity !== null
      ? `ROE ${(fundamentals.returnOnEquity * 100).toFixed(1)}%`
      : null,
    fundamentals.operatingMargins !== null
      ? `Operating margin ${(fundamentals.operatingMargins * 100).toFixed(1)}%`
      : null,
    fundamentals.freeCashflow !== null
      ? `FCF ${formatLargeUSD(fundamentals.freeCashflow)}`
      : null,
    fundamentals.debtToEquity !== null
      ? `D/E ${fundamentals.debtToEquity.toFixed(0)}%`
      : null,
    fundamentals.revenueGrowth !== null
      ? `Revenue growth ${(fundamentals.revenueGrowth * 100).toFixed(1)}%`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const dimSnapshot = Object.entries(dims)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  return `You are writing one short paragraph (2-3 sentences, ~50-80 words) about the quality of a business for a buy-and-hold investor. The investor will read this immediately under a tier badge ("${tier.toUpperCase()} BUSINESS"); your paragraph elaborates with sophistication, like a seasoned analyst's note.

Moatboard considers ${quote?.longName ?? ticker} ${TIER_FRAMING[tier]}

Moat: ${moatStrength} — ${moatArchetype.replace("_", " ")}. ${moatReasoning}

Quality dimensions snapshot:
${dimSnapshot}

Key fundamentals: ${metricsLine}

Write the paragraph now. Rules:
- Calm, observational, written in flowing prose. NOT a checklist. NOT a list of "X of Y dimensions strong".
- Integrate the strengths and weaknesses naturally — name 1-2 specific metrics that best illustrate the verdict.
- Reference the moat with substance (what kind, why it matters here), not just the label.
- No hype, no superlatives without evidence, no "buy/sell/hold" language, no price talk.
- Output ONLY the paragraph. No preamble, no JSON, no quotes around it.`;
}

export async function composeVerdictNarrative(args: {
  ticker: string;
  tier: Tier;
  scorecard: ScorecardSummary;
  moatStrength: MoatStrength;
  moatArchetype: MoatArchetype;
  moatReasoning: string;
  quote: Quote | null;
  fundamentals: Fundamentals;
}): Promise<string> {
  const prompt = buildPrompt(args);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 250,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const narrative = textBlock.text.trim();
  if (narrative.length === 0) {
    throw new Error("Empty narrative");
  }
  return narrative;
}

function formatLargeUSD(value: number): string {
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

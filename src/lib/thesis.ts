import Anthropic from "@anthropic-ai/sdk";
import type {
  Quote,
  Fundamentals,
  ManagementSignals,
} from "@/lib/financial";
import type { Tier } from "@/lib/verdict";
import type { TooHardAssessment } from "@/lib/tooHard";

export type ThesisField = {
  highlight: string;
  body: string;
};

export type ThesisContent = {
  why_worth_owning: ThesisField;
  moat: ThesisField;
  financial_strengths: ThesisField;
  management: ThesisField;
  what_to_watch: ThesisField;
  risk_factors: ThesisField;
};

export type ThesisFieldKey = keyof ThesisContent;

export const THESIS_FIELD_LABELS: Record<keyof ThesisContent, string> = {
  why_worth_owning: "Why this business is worth owning",
  moat: "Moat",
  financial_strengths: "Key financial strengths",
  management: "Management & capital allocation",
  what_to_watch: "What to watch",
  risk_factors: "Risk factors",
};

export const THESIS_FIELD_ORDER: (keyof ThesisContent)[] = [
  "why_worth_owning",
  "moat",
  "financial_strengths",
  "management",
  "what_to_watch",
  "risk_factors",
];

// Lazy: avoid running browser-detection at module load time so this file
// can be imported (for types/constants) by client components.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

function buildPrompt(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  management: ManagementSignals | null,
  tooHard: TooHardAssessment | null,
  shareCountCagr: number | null,
  tier: Tier,
  verdictReason: string,
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
Current fundamentals (trailing/most recent):
- ROE: ${formatPct(fd.returnOnEquity)}
- ROA: ${formatPct(fd.returnOnAssets)}
- Gross Margin: ${formatPct(fd.grossMargins)}
- Operating Margin: ${formatPct(fd.operatingMargins)}
- Profit Margin: ${formatPct(fd.profitMargins)}
- Free Cash Flow: ${formatLargeUSD(fd.freeCashflow)}
- Debt/Equity: ${formatNum(fd.debtToEquity)}%
- Current Ratio: ${formatNum(fd.currentRatio)}
- Revenue Growth YoY: ${formatPct(fd.revenueGrowth)}
- Earnings Growth YoY: ${formatPct(fd.earningsGrowth)}
- Trailing P/E: ${formatNum(fd.trailingPE)}
- Forward P/E: ${formatNum(fd.forwardPE)}
`.trim()
    : "Fundamentals data not available.";

  const mgmt = management;
  const shareCountLine =
    shareCountCagr !== null
      ? `- Share count 5y CAGR: ${shareCountCagr <= 0 ? "−" : "+"}${Math.abs(shareCountCagr * 100).toFixed(1)}%/yr (${shareCountCagr <= 0 ? "buybacks — shrinking" : "dilution — growing"})`
      : "- Share count 5y CAGR: n/a";
  const managementInfo = mgmt
    ? `
Management signals:
- CEO: ${mgmt.ceoName ?? "n/a"}${mgmt.ceoTitle ? ` (${mgmt.ceoTitle})` : ""}${mgmt.ceoAge !== null ? `, age ${mgmt.ceoAge}` : ""}
- CEO total compensation (latest filed year): ${formatLargeUSD(mgmt.ceoTotalPay)}
- Insider ownership: ${formatPct(mgmt.insiderOwnershipPct)}
- Net insider transactions (6m, as % of insider shares): ${formatPct(mgmt.insiderNet6mPct)}  (positive = insiders net buying, negative = net selling)
- Insider buy / sell count (6m): ${mgmt.insiderBuyCount6m ?? "n/a"} buys · ${mgmt.insiderSellCount6m ?? "n/a"} sells
- Employees: ${mgmt.employees !== null ? mgmt.employees.toLocaleString() : "n/a"}
${shareCountLine}
`.trim()
    : `Management signals not available.
${shareCountLine}`;

  const tooHardBanner = tooHard?.isHard
    ? `\n⚠ MUNGER'S "TOO HARD PILE" FLAG
${tooHard.reason}

The thesis MUST state this limitation prominently in the "risk_factors" field and treat it as the primary risk, overriding any financial strength. Do not paper it over with confidence.\n`
    : "";

  const toneGuidance =
    tier === "exceptional"
      ? "Moatboard considers this an EXCEPTIONAL BUSINESS. Articulate a confident thesis explaining why this business is worth owning long-term, grounded in the strengths."
      : "Moatboard considers this a GOOD BUSINESS. Articulate a clear thesis grounded in the strengths, while staying honest about any limitations.";

  return `You are an investment analyst writing a structured thesis for a buy-and-hold investor who thinks like a business owner. They care about durable quality, moats, capital efficiency, and the judgement of management — not trading.

${toneGuidance}
${tooHardBanner}
Verdict reason from Moatboard's analysis: "${verdictReason}"

${companyInfo}

${fundamentalsInfo}

${managementInfo}

Write the thesis as JSON with exactly these fields. Each field has TWO parts: a one-line "highlight" (a synthesized headline of the section, scannable, max 12 words) and a "body" (2-3 sentences expanding on it):

{
  "why_worth_owning": {
    "highlight": "One-line synthesis (max 12 words) of why this business is worth owning long-term.",
    "body": "2-3 sentences elaborating on the highlight. Lead with the business model and its durability."
  },
  "moat": {
    "highlight": "One-line synthesis of the competitive advantage.",
    "body": "2-3 sentences with specific evidence. If the moat has caveats, state them."
  },
  "financial_strengths": {
    "highlight": "One-line synthesis of what fundamentals reveal today.",
    "body": "2-3 sentences citing specific metrics: capital efficiency, cash generation, balance sheet, growth."
  },
  "management": {
    "highlight": "One-line take on management quality and capital-allocation record.",
    "body": "2-3 sentences citing the management signals (CEO identity/tenure/comp, insider ownership, 6m insider transactions, 5y share-count trend). Favour evidence over flattery — note concerns (heavy dilution, dumping insiders, excessive comp vs size) where visible. If the CEO is unknown or data is sparse, say so honestly."
  },
  "what_to_watch": {
    "highlight": "One-line synthesis of the leading indicators to monitor.",
    "body": "2-3 sentences on what would invalidate the thesis if it deteriorated. Be specific and measurable."
  },
  "risk_factors": {
    "highlight": "One-line synthesis of the main risk.",
    "body": "2-3 sentences on real risks (competitive, regulatory, technological, cyclical). Be honest.${tooHard?.isHard ? " This ticker has been flagged as 'too hard' — state that limitation here as the dominant risk." : ""}"
  }
}

Rules:
- Calm, analytical prose. No hype. No price predictions. No superlatives without evidence.
- The "highlight" is a strong one-line takeaway — written so a busy reader scanning only the highlights gets the core thesis.
- The "body" expands on the highlight with specifics. Do not just repeat the highlight.
- Ground claims in the business, fundamentals, and management signals provided.
- Output ONLY valid JSON. No preamble, no commentary outside the JSON.`;
}

export async function generateThesis(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  management: ManagementSignals | null,
  tooHard: TooHardAssessment | null,
  shareCountCagr: number | null,
  tier: Tier,
  verdictReason: string,
): Promise<ThesisContent> {
  if (tier === "poor" || tier === "mediocre") {
    throw new Error(
      `AI thesis generation is not available for businesses Moatboard rates as ${tier === "poor" ? "Poor" : "Mediocre"}.`,
    );
  }

  const prompt = buildPrompt(
    ticker,
    quote,
    fundamentals,
    management,
    tooHard,
    shareCountCagr,
    tier,
    verdictReason,
  );

  const response = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
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

  const parsed = JSON.parse(jsonMatch[0]) as ThesisContent;

  for (const field of THESIS_FIELD_ORDER) {
    const value = parsed[field];
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.highlight !== "string" ||
      value.highlight.trim().length === 0 ||
      typeof value.body !== "string" ||
      value.body.trim().length === 0
    ) {
      throw new Error(`Missing or invalid field in thesis: ${field}`);
    }
  }

  return parsed;
}

export function structuredToProse(content: ThesisContent): string {
  return THESIS_FIELD_ORDER.map(
    (field) =>
      `${THESIS_FIELD_LABELS[field]}\n${content[field].highlight}\n\n${content[field].body}`,
  ).join("\n\n");
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toFixed(2);
}

function formatLargeUSD(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

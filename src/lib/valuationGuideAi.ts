// Valuation Guide — AI-generated advice on which valuation tools matter
// most for a specific business. The output is NOT a verdict on the stock
// (buy/sell/hold) but a weighting on the five available tools based on the
// nature of the business. A bank should be judged primarily by P/B, a
// high-FCF compounder by P/FCF + DCF, etc.
//
// Design rules (enforced in the prompt):
// - Conditional language only ("more informative", "typically primary",
//   "less reliable for"). Never "use X", "you should".
// - No buy/sell language. Ever.
// - Only recommend tools that are actually available (caller passes the
//   list — P/B gets excluded when book value is negative).

import { callText } from "@/lib/claudeClient";
import type { Quote, Fundamentals } from "@/lib/financial";

export type ToolId = "dcf" | "pe" | "pfcf" | "pb" | "cash_yield";

export type ValuationGuideEvaluation = {
  primary: ToolId;
  secondary: ToolId | null;
  cautious: ToolId | null;
  reasoning: string;
};

export async function assessValuationGuide(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  availability: {
    pe: boolean;
    pfcf: boolean;
    pb: boolean;
  },
): Promise<{ evaluation: ValuationGuideEvaluation; model: string }> {
  // Tool list the AI is allowed to pick from. Tools that aren't computable
  // for this ticker are stripped so the AI can't recommend a vara that the
  // UI won't render. DCF is always offered — the Intrinsic Value card
  // renders for all methods (owner earnings / AFFO / excess returns /
  // multiples fallback). The relative tools (pe / pfcf / pb) only render
  // when their distribution has valid data (all quartiles + current).
  // NOTE: cash_yield was removed from the valuation toolkit — it's an
  // indicator (FCF yield vs 10y Treasury spread), not a valuation method:
  // a raw spread number doesn't produce a cheap/expensive reading without
  // own-history context. Legacy guides referencing it are invalidated on
  // the next page load.
  const availableTools: ToolId[] = ["dcf"];
  if (availability.pe) availableTools.push("pe");
  if (availability.pfcf) availableTools.push("pfcf");
  if (availability.pb) availableTools.push("pb");
  const availableToolsStr = availableTools.join(", ");

  const description = quote?.longBusinessSummary
    ? quote.longBusinessSummary.slice(0, 500)
    : "";

  const prompt = `You are a Buffett/Munger-influenced investment analyst. Tell the user which valuation tools to prioritize for THIS specific business, and which to weigh with care.

Business: ${quote?.longName ?? ticker} (${ticker})
Sector: ${quote?.sector ?? "Unknown"}
Industry: ${quote?.industry ?? "Unknown"}
${description ? `Description: ${description}` : ""}

Financial signals:
- Free cash flow (TTM): ${formatLargeUSD(fundamentals?.freeCashflow)}
- FCF per share (TTM): ${formatUsd(fundamentals?.fcfPerShare)}
- EPS (TTM): ${formatUsd(fundamentals?.trailingEps)}
- Trailing PE: ${formatNum(fundamentals?.trailingPE)}
- Debt / Equity: ${formatNum(fundamentals?.debtToEquity)}
- ROE: ${formatPct(fundamentals?.returnOnEquity)}
- ROA: ${formatPct(fundamentals?.returnOnAssets)}
- Operating margin: ${formatPct(fundamentals?.operatingMargins)}
- Gross margin: ${formatPct(fundamentals?.grossMargins)}
- Revenue growth YoY: ${formatPct(fundamentals?.revenueGrowth)}
- Dividend yield: ${formatPct(fundamentals?.dividendYield)}

Valuation tools available for this ticker: ${availableToolsStr}

Tool IDs and their nature:
- dcf: Owner earnings 2-stage DCF (or AFFO DCF for REITs, Excess Returns Model for banks/insurers). Absolute-floor view. Sensitive to growth assumptions; conservative by design. Good for stable-cash-flow compounders.
- pe: PE ratio vs business's own historical distribution. Reliable when earnings are clean. Distorted by SBC (software), provisions (banks), one-offs, deferred tax swings. Good for consumer durables, payment networks, branded goods.
- pfcf: P/FCF ratio vs business's own historical distribution. Better than PE when SBC inflates earnings or earnings ≠ cash. Primary vara for software, platforms, high-quality compounders.
- pb: P/Book ratio vs business's own historical distribution. Primary vara for financial institutions, asset-heavy businesses (industrials, utilities, REITs). Irrelevant for asset-light businesses whose economic value is intangible (brand, IP, network).

Decision guardrails (apply the matching rule):
- Financial institutions (banks, insurance, asset managers, brokers): pb primary when available; dcf secondary. PE and pfcf are distorted by provisions and reserve accounting — flag one of them as cautious.
- Utilities, REITs, pipelines, regulated infrastructure: pb primary when available; dcf secondary. PE through regulated rate cycles often misleads — flag as cautious.
- Consumer staples with stable dividends (KO, PEP, PG-like): pfcf primary; dcf secondary.
- Consumer durables, branded platforms, premium brands (AAPL, NKE, DIS, MCD-like): pfcf primary; dcf secondary. PE often has SBC / tax noise, flag as cautious.
- SaaS / software with positive FCF (MSFT, CRM-like): pfcf primary; dcf secondary. PE cautious due to heavy SBC distortion.
- Payment networks (V, MA): pfcf primary; dcf secondary.
- Cyclical industrials (CAT, DE, steel, chemicals): pb primary when available; pfcf secondary. PE through the cycle is unreliable, flag as cautious.
- Early-stage growth without stable FCF: pfcf only if positive; otherwise pfcf cautious, pe cautious.
- Tech compounders with high ROIC and durable moat (GOOGL, META): pfcf primary; dcf secondary.

Output strict JSON, no preamble. CRITICAL: primary, secondary, and cautious must each be a DIFFERENT tool (or null). Never repeat the same tool across roles — if no additional tool merits the role, use null.

{
  "primary": "<one of: ${availableToolsStr}>",
  "secondary": "<one of the remaining tools> | null (null if no other tool merits secondary)",
  "cautious": "<one of the remaining tools> | null (null if no other tool merits cautious)",
  "reasoning": "2-3 frases en ESPAÑOL explicando por qué estas prioridades aplican a ESTE negocio en concreto. Cita la economía del negocio (ej: 'los márgenes altos de servicios enmascaran las necesidades de capex', 'las provisiones distorsionan los earnings reported trimestre a trimestre', 'el modelo asset-light hace que book value sea poco informativo'). Usa lenguaje condicional: 'suele ser más informativo', 'typically primary', 'menos fiable para'. NUNCA escribas 'usa X', 'deberías', 'comprar', 'vender', 'hold', 'overvalued', 'undervalued'. Tono cercano, directo. Jerga financiera (DCF, PE, P/FCF, P/B, capex, book value, SBC, FCF, ROIC) en inglés; el resto en español natural."
}`;

  const { text: raw, model } = await callText(prompt, { maxTokens: 600 });
  const trimmed = raw.trim();
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Could not find JSON: ${trimmed.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]) as ValuationGuideEvaluation;

  // Validate: primary must be in the allowed list.
  if (!availableTools.includes(parsed.primary)) {
    throw new Error(
      `AI returned invalid primary tool "${parsed.primary}" (allowed: ${availableToolsStr})`,
    );
  }
  // Secondary and cautious: silently null if AI picked something not allowed.
  if (parsed.secondary && !availableTools.includes(parsed.secondary)) {
    parsed.secondary = null;
  }
  if (parsed.cautious && !availableTools.includes(parsed.cautious)) {
    parsed.cautious = null;
  }
  // Deduplicate: secondary and cautious must be distinct from primary and
  // from each other. When the AI fills these with the same tool (typically
  // when only one tool is available and it ignores the "null" option),
  // drop the duplicate rather than display a contradiction on screen.
  if (parsed.secondary === parsed.primary) {
    parsed.secondary = null;
  }
  if (parsed.cautious === parsed.primary) {
    parsed.cautious = null;
  }
  if (parsed.cautious !== null && parsed.cautious === parsed.secondary) {
    parsed.cautious = null;
  }
  if (!parsed.reasoning || parsed.reasoning.trim().length === 0) {
    throw new Error("AI returned empty reasoning");
  }

  return { evaluation: parsed, model };
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

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  return `$${value.toFixed(2)}`;
}

function formatLargeUSD(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

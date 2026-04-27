// AI generator for the competitive moat.
//
// When a 10-K is available (post-2026-04-27 flow), we feed the model the
// start-truncated 10-K (Item 1 contains the business description that
// is the primary evidence for moat archetype + strength) and the prompt
// requires the model to cite the literal English excerpt that grounds
// its claim. That lands as `source_excerpt` on the assessment.
//
// When no 10-K is reachable (recent IPO, primary document not on EDGAR
// yet, 20-F-only ADR), we fall back to the pre-10K behaviour — Claude
// uses yfinance's longBusinessSummary plus training-data knowledge.
// Caller decides whether to flag this in the UI; this module just
// returns the assessment with `source_excerpt = null`.

import { callJson } from "@/lib/claudeClient";
import type {
  Quote,
  Fundamentals,
  MultiYearFundamentals,
} from "@/lib/financial";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";
import { computeRoicPerYear, computeFcfMarginPerYear } from "@/lib/scorecard";

export type MoatEvaluation = {
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
  source_excerpt?: string;
};

// Filing input mirrors UnderstandingFilingInput — same shape, different
// caller. Kept as a separate type so `prepareMoatFiling` can be tuned
// independently if the moat ever needs different truncation rules.
export type MoatFilingInput = {
  text: string;
  truncated: boolean;
  accession: string;
  form: string;
  filingDate: string; // YYYY-MM-DD
  reportDate: string | null;
  url: string;
};

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

const STRENGTHS: MoatStrength[] = ["strong", "weak", "unclear"];

function buildPrompt(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  multiYear: MultiYearFundamentals | null,
  filing: MoatFilingInput | null,
): string {
  const companyInfo = quote
    ? `
Company: ${quote.longName ?? ticker} (${ticker})
Sector: ${quote.sector ?? "Unknown"}
Industry: ${quote.industry ?? "Unknown"}
Market cap: ${quote.marketCap ? `$${(quote.marketCap / 1e9).toFixed(2)}B` : "Unknown"}
`.trim()
    : `Ticker: ${ticker} (no market data available).`;

  const summaryLine = quote?.longBusinessSummary
    ? `Yahoo summary (secondary context, NOT primary source): ${quote.longBusinessSummary.slice(0, 500)}`
    : "Yahoo summary not available.";

  const fd = fundamentals;

  const roicSeries = multiYear ? computeRoicPerYear(multiYear.years) : [];
  const fcfMarginSeries = multiYear ? computeFcfMarginPerYear(multiYear.years) : [];

  const roicLine =
    roicSeries.length > 0
      ? `- ROIC by year: ${roicSeries
          .map(
            (r) =>
              `${r.year.slice(0, 4)} ${(r.value * 100).toFixed(1)}%`,
          )
          .join(" · ")}`
      : "- ROIC: not available (insufficient history)";

  const fcfMarginLine =
    fcfMarginSeries.length > 0
      ? `- FCF margin by year: ${fcfMarginSeries
          .map(
            (r) =>
              `${r.year.slice(0, 4)} ${(r.value * 100).toFixed(1)}%`,
          )
          .join(" · ")}`
      : "- FCF margin: not available";

  const fundamentalsInfo = fd
    ? `
Quality signals (sustained = evidence of an underlying advantage):
- Gross Margin (trailing): ${formatPct(fd.grossMargins)}  (pricing power / brand)
- Operating Margin (trailing): ${formatPct(fd.operatingMargins)}  (operating leverage)
${roicLine}  (capital efficiency — sustained high ROIC is the real moat test)
${fcfMarginLine}  (cash conversion quality)
- Revenue Growth YoY (trailing): ${formatPct(fd.revenueGrowth)}
`.trim()
    : "Fundamentals not available.";

  const filingBlock = filing
    ? `
PRIMARY SOURCE — ${filing.form} from SEC EDGAR (${filing.reportDate ? `period ${filing.reportDate}, ` : ""}filed ${filing.filingDate}).
The text is the start of the 10-K, which contains Item 1 (Business description) — the canonical place where management describes how the business actually competes (customers, suppliers, distribution, technology, regulation, brand, scale).${filing.truncated ? " The filing was truncated by length; later sections (10-K Item 7 MD&A, Item 7A risk metrics) may not be in the slice." : ""}

=== ${filing.form} TEXT (plain, English) ===
${filing.text}
=== END DOCUMENT ===
`
    : `
(No recent 10-K reachable for this ticker. Work from the secondary context below and be conservative — without a primary source, prefer strength="unclear" or "weak" unless the advantage is publicly notorious. Do NOT cite a source_excerpt if there is no filing.)
`;

  const sourceInstructions = filing
    ? `- **source_excerpt** (REQUIRED when filing is provided): the literal English fragment from the 10-K that grounds your moat call. 100-300 chars, copy verbatim — do not paraphrase. Pick the sentence that most directly supports the archetype you chose (e.g. for "brand", a passage about pricing power or brand recognition; for "network_effects", a passage about user-side or merchant-side scale; for "switching_costs", language about contracts, integrations, multi-year deployments).`
    : `- **source_excerpt**: omit (no filing provided).`;

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

${filingBlock}
SECONDARY CONTEXT (for cross-reference, not as evidence):
${summaryLine}

${fundamentalsInfo}

CRITICAL SOURCE-USE RULES:
- The moat call MUST be supported by what management says in the ${filing ? "10-K above" : "available context"} — not by your training-data knowledge of the company.
- If the 10-K does not describe a clear durable advantage, prefer "unclear" or "weak/none" over inventing one.
- Sustained quality fundamentals (high ROIC over multiple years) are CORROBORATING evidence, not the moat itself. The moat is the structural reason the fundamentals stay high.

OUTPUT requirements:
- **strength**: "strong" | "weak" | "unclear"
- **archetype**: one of ${ARCHETYPES.join(", ")}
- **reasoning**: 1-2 sentences in SPANISH, close conversational tone, citing the concrete evidence (sustained gross margins, dominant share, regulatory entry barrier, recurring revenue, etc.). Financial acronyms (ROIC, FCF, moat, gross margin, switching costs) stay in English. The enum values stay in English; only 'reasoning' is translated.
${sourceInstructions}

Call the submit_moat_assessment tool. Do not write plain text.`;
}

export async function assessMoat(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  multiYear: MultiYearFundamentals | null,
  filing: MoatFilingInput | null = null,
): Promise<{ evaluation: MoatEvaluation; model: string }> {
  const prompt = buildPrompt(ticker, quote, fundamentals, multiYear, filing);

  const { data: parsed, model } = await callJson<{
    strength?: string;
    archetype?: string;
    reasoning?: string;
    source_excerpt?: string;
  }>(prompt, {
    schemaName: "submit_moat_assessment",
    schemaDescription:
      "Submit the competitive moat assessment for the company.",
    maxTokens: 800,
    jsonSchema: {
      type: "object",
      properties: {
        strength: {
          type: "string",
          enum: STRENGTHS,
          description: "Moat strength judgement.",
        },
        archetype: {
          type: "string",
          enum: ARCHETYPES,
          description: "The dominant moat archetype, or 'none' if absent.",
        },
        reasoning: {
          type: "string",
          description:
            "1-2 Spanish sentences citing concrete evidence. Financial jargon stays in English.",
        },
        source_excerpt: {
          type: "string",
          description:
            "Literal English text from the 10-K that supports the moat call (100-300 chars). Required when a filing is provided; omit when no filing was supplied.",
        },
      },
      required: ["strength", "archetype", "reasoning"],
    },
  });

  if (!parsed.strength || !STRENGTHS.includes(parsed.strength as MoatStrength)) {
    throw new Error(`Invalid moat strength: ${parsed.strength}`);
  }
  if (!parsed.archetype || !ARCHETYPES.includes(parsed.archetype as MoatArchetype)) {
    throw new Error(`Invalid moat archetype: ${parsed.archetype}`);
  }
  if (
    typeof parsed.reasoning !== "string" ||
    parsed.reasoning.trim().length === 0
  ) {
    throw new Error("Missing moat reasoning");
  }

  const evaluation: MoatEvaluation = {
    strength: parsed.strength as MoatStrength,
    archetype: parsed.archetype as MoatArchetype,
    reasoning: parsed.reasoning.trim(),
  };
  if (typeof parsed.source_excerpt === "string") {
    const trimmed = parsed.source_excerpt.trim();
    if (trimmed.length > 0) {
      evaluation.source_excerpt = trimmed.slice(0, 500);
    }
  }

  return { evaluation, model };
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

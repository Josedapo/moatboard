import { callText } from "@/lib/claudeClient";
import type { Quote, Fundamentals } from "@/lib/financial";
import type {
  Tier,
  ScorecardSummary,
  MoatStrength,
  MoatArchetype,
} from "@/lib/verdict";

const TIER_FRAMING: Record<Tier, string> = {
  exceptional:
    "an EXCEPTIONAL business — top-tier compounder territory: durable advantage and capital efficiency that few businesses sustain.",
  good:
    "a GOOD business — solid, with most quality dimensions in healthy territory and a recognizable moat, even if not at the top tier.",
  mediocre:
    "a MEDIOCRE business — real strengths offset by material weaknesses. In Buffett/Munger's framework, the punch card is for wonderful or good businesses at the right price; mediocre is the default answer, not a third option to own.",
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
  tooHardReason,
}: {
  tier: Tier;
  scorecard: ScorecardSummary;
  moatStrength: MoatStrength;
  moatArchetype: MoatArchetype;
  moatReasoning: string;
  quote: Quote | null;
  fundamentals: Fundamentals;
  ticker: string;
  tooHardReason: string | null;
}): string {
  const dims = scorecard.dimensions;

  const roicMed = scorecard.multiYear.returnOnInvestedCapital.median;
  const roicYears = scorecard.multiYear.returnOnInvestedCapital.yearsUsed;
  const roicWorst = scorecard.multiYear.returnOnInvestedCapital.worstYear;
  const gmMed = scorecard.multiYear.grossMargin.median;
  const gmYears = scorecard.multiYear.grossMargin.yearsUsed;
  const fcfMed = scorecard.multiYear.fcfMargin.median;
  const fcfYears = scorecard.multiYear.fcfMargin.yearsUsed;
  const opMed = scorecard.multiYear.operatingMargin.median;
  const opYears = scorecard.multiYear.operatingMargin.yearsUsed;
  const revCagr = scorecard.multiYear.revenueGrowth.median;
  const revYears = scorecard.multiYear.revenueGrowth.yearsUsed;
  const shareCagr = scorecard.multiYear.shareCountTrend.median;
  const fcfConvMed = scorecard.fcfConversion?.median ?? null;
  const retention = scorecard.retentionMultiple?.ratio ?? null;
  const retentionYears = scorecard.retentionMultiple?.yearsUsed ?? 0;

  const metricsLine = [
    roicMed !== null && roicYears >= 3
      ? `ROIC ${(roicMed * 100).toFixed(1)}% median (${roicYears}y, worst ${((roicWorst ?? 0) * 100).toFixed(1)}%)`
      : null,
    gmMed !== null && gmYears >= 3
      ? `Gross margin ${(gmMed * 100).toFixed(1)}% median (${gmYears}y)`
      : null,
    fcfMed !== null && fcfYears >= 3
      ? `FCF margin ${(fcfMed * 100).toFixed(1)}% median (${fcfYears}y)`
      : null,
    opMed !== null && opYears >= 3
      ? `Op margin ${(opMed * 100).toFixed(1)}% median (${opYears}y)`
      : fundamentals.operatingMargins !== null
        ? `Op margin ${(fundamentals.operatingMargins * 100).toFixed(1)}%`
        : null,
    fundamentals.debtToEquity !== null
      ? `D/E ${fundamentals.debtToEquity.toFixed(0)}%`
      : null,
    shareCagr !== null
      ? `Share count ${shareCagr <= 0 ? "−" : "+"}${Math.abs(shareCagr * 100).toFixed(1)}%/yr (5y CAGR)`
      : null,
    revCagr !== null && revYears >= 3
      ? `Revenue ${revCagr >= 0 ? "+" : "−"}${Math.abs(revCagr * 100).toFixed(1)}%/yr (${revYears}y CAGR)`
      : fundamentals.revenueGrowth !== null
        ? `Revenue growth ${(fundamentals.revenueGrowth * 100).toFixed(1)}%`
        : null,
    fcfConvMed !== null
      ? `FCF conversion ${(fcfConvMed * 100).toFixed(0)}% (FCF/NI median)`
      : null,
    retention !== null
      ? `Retention multiple ${retention.toFixed(2)}x (${retentionYears}y · value created per $1 retained; Buffett one-dollar test)`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const dimSnapshot = Object.entries(dims)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  const tooHardLine = tooHardReason
    ? `\nIMPORTANT: this ticker has been flagged as "too hard" (Munger's phrase) — ${tooHardReason} The tier has been downgraded one level as a result. The paragraph MUST acknowledge this limitation explicitly alongside the quality signals; do not let strong financials override the structural predictability problem.\n`
    : "";

  return `You are writing one short paragraph (2-3 sentences, ~50-80 words) about the quality of a business for a buy-and-hold investor. The investor will read this immediately under a tier badge ("${tier.toUpperCase()} BUSINESS"); your paragraph elaborates with sophistication, like a seasoned analyst's note.

Moatboard considers ${quote?.longName ?? ticker} ${TIER_FRAMING[tier]}
${tooHardLine}
Moat: ${moatStrength} — ${moatArchetype.replace("_", " ")}. ${moatReasoning}

Quality dimensions snapshot:
${dimSnapshot}

Key fundamentals: ${metricsLine}

Write the paragraph now. Rules:
- Write in SPANISH, close conversational tone — as if explaining to a fellow investor over coffee. Financial acronyms and jargon (ROIC, FCF, moat, gross margin, op margin, DCF, PE, etc.) stay in English; everything else in natural Spanish prose.
- Calm, observational, written in flowing prose. NOT a checklist. NOT a list of "X of Y dimensions strong".
- Integrate the strengths and weaknesses naturally — name 1-2 specific metrics that best illustrate the verdict.
- Reference the moat with substance (what kind, why it matters here), not just the label.
- No hype, no superlatives without evidence, no "buy/sell/hold" language, no price talk.
- Output ONLY the paragraph in Spanish. No preamble, no JSON, no quotes around it.`;
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
  tooHardReason: string | null;
}): Promise<string> {
  const prompt = buildPrompt(args);

  const { text } = await callText(prompt, { maxTokens: 250 });
  const narrative = text.trim();
  if (narrative.length === 0) {
    throw new Error("Empty narrative");
  }
  return narrative;
}

import { callText } from "@/lib/claudeClient";
import { parseJsonObject } from "@/lib/aiJson";
import type { Quote } from "@/lib/financial";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";

// Delta-style moat evaluation. Given a previously registered moat, Claude
// assesses whether it is still valid today, grading the change into one of
// four verdicts. This is NOT a fresh `assessMoat` call — the prompt is
// framed as "did the original thesis hold?" so the verdict is comparative.

export type MoatValidationVerdict =
  | "intact"
  | "expanding"
  | "compressing"
  | "dissolved";

export type MoatValidation = {
  verdict: MoatValidationVerdict;
  newStrength: MoatStrength;
  newArchetype: MoatArchetype;
  reasoning: string;
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

const VERDICTS: MoatValidationVerdict[] = [
  "intact",
  "expanding",
  "compressing",
  "dissolved",
];

function buildPrompt({
  ticker,
  quote,
  originalArchetype,
  originalStrength,
  originalReasoning,
  originalRecordedAt,
}: {
  ticker: string;
  quote: Quote | null;
  originalArchetype: MoatArchetype;
  originalStrength: MoatStrength;
  originalReasoning: string;
  originalRecordedAt: string;
}): string {
  const companyInfo = quote
    ? `
Company: ${quote.longName ?? ticker} (${ticker})
Sector: ${quote.sector ?? "Unknown"}
Industry: ${quote.industry ?? "Unknown"}
Market cap: ${quote.marketCap ? `$${(quote.marketCap / 1e9).toFixed(2)}B` : "Unknown"}
Business: ${quote.longBusinessSummary ?? "No description available."}
`.trim()
    : `Ticker: ${ticker} (no market data available).`;

  const recordedDate = originalRecordedAt.slice(0, 10);

  return `You are revalidating the COMPETITIVE MOAT of a business for a buy-and-hold investor.

A moat was registered previously. Your job is to decide whether it still holds today, using your current knowledge of the company and its competitive environment.

${companyInfo}

MOAT REGISTERED ON ${recordedDate}:
- Archetype: ${originalArchetype}
- Strength: ${originalStrength}
- Reasoning at the time: ${originalReasoning}

Return one of four verdicts, chosen strictly on the substance of the moat today versus the registered one:

- "intact": the moat still holds. Same archetype, same level of strength, or equivalent substance. Pick this as the default when you see no material change.
- "expanding": the moat has widened — the original advantage has deepened (more pricing power, stronger network effects, more regulatory entrenchment, etc.), or strength has moved upward (weak→unclear, unclear→strong). Requires concrete evidence, not vague optimism.
- "compressing": the moat has narrowed — the original advantage is under credible pressure (new entrant with traction, technology shift, regulation changing, etc.), or strength has moved downward. The moat is not gone, just less convincing than before.
- "dissolved": the moat no longer applies. The advantage has disappeared, become irrelevant, or was wrong in the first place. Pick this when strength collapses to weak and/or archetype changes to none.

Be honest and skeptical. "Intact" should be the majority answer for well-moated businesses over short horizons (months to a couple of years). "Expanding" and "dissolved" should be rare and require specific evidence. When in doubt between two, pick the more conservative (intact over expanding; compressing over dissolved).

If you change archetype, explain why — an archetype change almost always means the original was wrong or the business has transformed.

IMPORTANT — language: write the 'reasoning' string in SPANISH, close conversational tone. Financial acronyms and jargon (ROIC, FCF, moat, network effects, switching costs, etc.) stay in English. The enum values (verdict, newStrength, newArchetype) stay in English; only the 'reasoning' text is translated.

OUTPUT (strict JSON, no preamble, no commentary):

{
  "verdict": "intact" | "expanding" | "compressing" | "dissolved",
  "newStrength": "strong" | "weak" | "unclear",
  "newArchetype": "brand" | "network_effects" | "switching_costs" | "scale" | "ip" | "regulatory" | "cost_advantage" | "none",
  "reasoning": "3-4 frases en español citando evidencia concreta — qué ha pasado en el negocio/sector desde ${recordedDate} y cómo afecta al moat registrado."
}`;
}

export async function validateMoat({
  ticker,
  quote,
  originalArchetype,
  originalStrength,
  originalReasoning,
  originalRecordedAt,
}: {
  ticker: string;
  quote: Quote | null;
  originalArchetype: MoatArchetype;
  originalStrength: MoatStrength;
  originalReasoning: string;
  originalRecordedAt: string;
}): Promise<{ validation: MoatValidation; model: string }> {
  const prompt = buildPrompt({
    ticker,
    quote,
    originalArchetype,
    originalStrength,
    originalReasoning,
    originalRecordedAt,
  });

  const { text: raw, model } = await callText(prompt, { maxTokens: 800 });
  const parsed = parseJsonObject<MoatValidation>(raw);

  if (!VERDICTS.includes(parsed.verdict)) {
    throw new Error(`Invalid verdict: ${parsed.verdict}`);
  }
  if (!["strong", "weak", "unclear"].includes(parsed.newStrength)) {
    throw new Error(`Invalid newStrength: ${parsed.newStrength}`);
  }
  if (!ARCHETYPES.includes(parsed.newArchetype)) {
    throw new Error(`Invalid newArchetype: ${parsed.newArchetype}`);
  }
  if (
    typeof parsed.reasoning !== "string" ||
    parsed.reasoning.trim().length === 0
  ) {
    throw new Error("Missing reasoning");
  }

  return { validation: parsed, model };
}

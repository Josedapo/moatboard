// CRUD for valuation_guides — cached per ticker, shared across users.
// Follows the same pattern as moat_assessments (TTL 365d, get-or-create).

import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { assessValuationGuide, type ToolId } from "@/lib/valuationGuideAi";
import type { Quote, Fundamentals } from "@/lib/financial";

const GUIDE_TTL_DAYS = 365;

export type ValuationGuide = {
  ticker: string;
  primary_tool: ToolId;
  secondary_tool: ToolId | null;
  cautious_tool: ToolId | null;
  reasoning: string;
  evaluated_at: string;
  evaluated_with_model: string;
};

export async function getValuationGuide(
  ticker: string,
): Promise<ValuationGuide | null> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, primary_tool, secondary_tool, cautious_tool, reasoning,
           evaluated_at, evaluated_with_model
    FROM valuation_guides
    WHERE ticker = ${canonical}
    LIMIT 1
  `) as unknown as ValuationGuide[];
  return rows[0] ?? null;
}

export async function saveValuationGuide({
  ticker,
  primaryTool,
  secondaryTool,
  cautiousTool,
  reasoning,
  model,
}: {
  ticker: string;
  primaryTool: ToolId;
  secondaryTool: ToolId | null;
  cautiousTool: ToolId | null;
  reasoning: string;
  model: string;
}): Promise<ValuationGuide> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    INSERT INTO valuation_guides (
      ticker, primary_tool, secondary_tool, cautious_tool,
      reasoning, evaluated_with_model
    )
    VALUES (
      ${canonical}, ${primaryTool}, ${secondaryTool}, ${cautiousTool},
      ${reasoning}, ${model}
    )
    ON CONFLICT (ticker) DO UPDATE
      SET primary_tool = EXCLUDED.primary_tool,
          secondary_tool = EXCLUDED.secondary_tool,
          cautious_tool = EXCLUDED.cautious_tool,
          reasoning = EXCLUDED.reasoning,
          evaluated_at = NOW(),
          evaluated_with_model = EXCLUDED.evaluated_with_model
    RETURNING ticker, primary_tool, secondary_tool, cautious_tool,
              reasoning, evaluated_at, evaluated_with_model
  `) as unknown as ValuationGuide[];
  return rows[0];
}

export function isGuideStale(guide: ValuationGuide): boolean {
  const ageMs = Date.now() - new Date(guide.evaluated_at).getTime();
  return ageMs > GUIDE_TTL_DAYS * 24 * 3600 * 1000;
}

// Get-or-create. The AI call is the only expensive part; everything after
// the first hit reads from the Postgres cache. Non-fatal: if the AI fails
// for any reason (API outage, invalid response), returns null and the UI
// renders the valuation toolkit without the guide block.
export async function ensureValuationGuide(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  availability: {
    pe: boolean;
    pfcf: boolean;
    pb: boolean;
  },
): Promise<ValuationGuide | null> {
  try {
    const existing = await getValuationGuide(ticker);
    // Reuse the cache unless it's stale OR it recommends a tool that is no
    // longer renderable — handles cases where the ticker's data shape
    // has changed (book value turned negative, FCF now reported, etc.),
    // where an older guide was generated before we gated a given tool,
    // or where the guide still references `cash_yield` (retired from the
    // valuation toolkit — it was an indicator, not a valuation method).
    if (existing && !isGuideStale(existing)) {
      const currentlyAvailable = new Set<ToolId>(["dcf"]);
      if (availability.pe) currentlyAvailable.add("pe");
      if (availability.pfcf) currentlyAvailable.add("pfcf");
      if (availability.pb) currentlyAvailable.add("pb");
      const recommendations: (ToolId | null)[] = [
        existing.primary_tool,
        existing.secondary_tool,
        existing.cautious_tool,
      ];
      const recommendsUnavailable = recommendations.some(
        (t): t is ToolId => t !== null && !currentlyAvailable.has(t),
      );
      // Also invalidate degenerate guides where the AI filled multiple
      // roles with the same tool (older versions did this when only one
      // tool was available). The UI must never show "Primary: X · Use
      // with care: X" — it's a contradiction that undermines trust.
      const hasDuplicates =
        existing.secondary_tool === existing.primary_tool ||
        existing.cautious_tool === existing.primary_tool ||
        (existing.cautious_tool !== null &&
          existing.cautious_tool === existing.secondary_tool);
      if (!recommendsUnavailable && !hasDuplicates) return existing;
    }

    const { evaluation, model } = await assessValuationGuide(
      ticker,
      quote,
      fundamentals,
      availability,
    );
    return saveValuationGuide({
      ticker,
      primaryTool: evaluation.primary,
      secondaryTool: evaluation.secondary,
      cautiousTool: evaluation.cautious,
      reasoning: evaluation.reasoning,
      model,
    });
  } catch (err) {
    console.error(`ensureValuationGuide failed for ${ticker}:`, err);
    return null;
  }
}

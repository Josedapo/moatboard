import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";

export type MoatAssessment = {
  ticker: string;
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
  evaluated_at: string;
  evaluated_with_model: string;
};

const TTL_DAYS = 365;

export async function getMoatAssessment(
  ticker: string,
): Promise<MoatAssessment | null> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, strength, archetype, reasoning, evaluated_at, evaluated_with_model
    FROM moat_assessments
    WHERE ticker = ${canonical}
    LIMIT 1
  `) as unknown as MoatAssessment[];
  return rows[0] ?? null;
}

export async function saveMoatAssessment({
  ticker,
  strength,
  archetype,
  reasoning,
  model = "claude-sonnet-4-6",
}: {
  ticker: string;
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
  model?: string;
}): Promise<MoatAssessment> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    INSERT INTO moat_assessments (ticker, strength, archetype, reasoning, evaluated_with_model)
    VALUES (${canonical}, ${strength}, ${archetype}, ${reasoning}, ${model})
    ON CONFLICT (ticker) DO UPDATE
      SET strength = EXCLUDED.strength,
          archetype = EXCLUDED.archetype,
          reasoning = EXCLUDED.reasoning,
          evaluated_at = NOW(),
          evaluated_with_model = EXCLUDED.evaluated_with_model
    RETURNING ticker, strength, archetype, reasoning, evaluated_at, evaluated_with_model
  `) as unknown as MoatAssessment[];
  return rows[0];
}

export function isMoatStale(assessment: MoatAssessment): boolean {
  const evaluatedMs = new Date(assessment.evaluated_at).getTime();
  const ageDays = (Date.now() - evaluatedMs) / (1000 * 60 * 60 * 24);
  return ageDays > TTL_DAYS;
}

import { sql } from "@/lib/db";
import type {
  Tier,
  ScorecardSummary,
  MoatStrength,
  MoatArchetype,
} from "@/lib/verdict";

export type MoatboardAnalysis = {
  id: number;
  position_id: number;
  tier: Tier;
  verdict_reason: string;
  scorecard_summary: ScorecardSummary;
  moat_strength: MoatStrength;
  moat_archetype: MoatArchetype;
  generated_at: string;
};

export async function getAnalysisByPositionId(
  positionId: number,
): Promise<MoatboardAnalysis | null> {
  const rows = (await sql`
    SELECT id, position_id, tier, verdict_reason,
           scorecard_summary, moat_strength, moat_archetype, generated_at
    FROM moatboard_analyses
    WHERE position_id = ${positionId}
    LIMIT 1
  `) as unknown as MoatboardAnalysis[];
  return rows[0] ?? null;
}

export async function saveAnalysis({
  positionId,
  tier,
  verdictReason,
  scorecardSummary,
  moatStrength,
  moatArchetype,
}: {
  positionId: number;
  tier: Tier;
  verdictReason: string;
  scorecardSummary: ScorecardSummary;
  moatStrength: MoatStrength;
  moatArchetype: MoatArchetype;
}): Promise<MoatboardAnalysis> {
  const rows = (await sql`
    INSERT INTO moatboard_analyses (
      position_id, tier, verdict_reason, scorecard_summary, moat_strength, moat_archetype
    )
    VALUES (
      ${positionId}, ${tier}, ${verdictReason},
      ${JSON.stringify(scorecardSummary)}, ${moatStrength}, ${moatArchetype}
    )
    ON CONFLICT (position_id) DO UPDATE
      SET tier = EXCLUDED.tier,
          verdict_reason = EXCLUDED.verdict_reason,
          scorecard_summary = EXCLUDED.scorecard_summary,
          moat_strength = EXCLUDED.moat_strength,
          moat_archetype = EXCLUDED.moat_archetype,
          generated_at = NOW()
    RETURNING id, position_id, tier, verdict_reason,
              scorecard_summary, moat_strength, moat_archetype, generated_at
  `) as unknown as MoatboardAnalysis[];
  return rows[0];
}

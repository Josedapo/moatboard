import { sql } from "@/lib/db";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";
import type { MoatValidationVerdict } from "@/lib/moatValidationAi";

// Persisted row for a comparative moat validation run from the trajectory
// screen. Decoupled from `moat_assessments` on purpose — the trajectory's
// "Validar con IA" button is exploratory; overwriting the ticker-wide
// cache would silently change what the main position card and future
// quarterly snapshots see. Each row is immutable; multiple validations
// against the same `from_snapshot_id` are allowed so the table doubles
// as a revalidation history.
export type MoatValidation = {
  id: number;
  user_id: number;
  position_id: number;
  ticker: string;
  from_snapshot_id: number;
  original_archetype: MoatArchetype;
  original_strength: MoatStrength;
  original_reasoning: string;
  original_recorded_at: string;
  verdict: MoatValidationVerdict;
  new_archetype: MoatArchetype;
  new_strength: MoatStrength;
  reasoning: string;
  validated_at: string;
  validated_with_model: string;
};

export async function createMoatValidation(input: {
  userId: string | number;
  positionId: number;
  ticker: string;
  fromSnapshotId: number;
  originalArchetype: MoatArchetype;
  originalStrength: MoatStrength;
  originalReasoning: string;
  originalRecordedAt: string;
  verdict: MoatValidationVerdict;
  newArchetype: MoatArchetype;
  newStrength: MoatStrength;
  reasoning: string;
  model: string;
}): Promise<MoatValidation> {
  const rows = (await sql`
    INSERT INTO moat_validations (
      user_id, position_id, ticker, from_snapshot_id,
      original_archetype, original_strength, original_reasoning, original_recorded_at,
      verdict, new_archetype, new_strength, reasoning,
      validated_with_model
    ) VALUES (
      ${input.userId},
      ${input.positionId},
      ${input.ticker.toUpperCase()},
      ${input.fromSnapshotId},
      ${input.originalArchetype},
      ${input.originalStrength},
      ${input.originalReasoning},
      ${input.originalRecordedAt},
      ${input.verdict},
      ${input.newArchetype},
      ${input.newStrength},
      ${input.reasoning},
      ${input.model}
    )
    RETURNING id, user_id, position_id, ticker, from_snapshot_id,
              original_archetype, original_strength, original_reasoning, original_recorded_at,
              verdict, new_archetype, new_strength, reasoning,
              validated_at, validated_with_model
  `) as unknown as MoatValidation[];
  return rows[0];
}

// Returns a lookup of from_snapshot_id → latest validation for every
// snapshot that has at least one validation. Cheaper than N queries in
// the trajectory page (where the client-side selector may change the
// "Desde" anchor without a page reload, so we preload everything).
export async function listLatestMoatValidationsForPosition({
  userId,
  positionId,
}: {
  userId: string | number;
  positionId: number;
}): Promise<Record<number, MoatValidation>> {
  const rows = (await sql`
    SELECT DISTINCT ON (from_snapshot_id)
           id, user_id, position_id, ticker, from_snapshot_id,
           original_archetype, original_strength, original_reasoning, original_recorded_at,
           verdict, new_archetype, new_strength, reasoning,
           validated_at, validated_with_model
    FROM moat_validations
    WHERE user_id = ${userId} AND position_id = ${positionId}
    ORDER BY from_snapshot_id, validated_at DESC, id DESC
  `) as unknown as MoatValidation[];
  const map: Record<number, MoatValidation> = {};
  for (const r of rows) map[r.from_snapshot_id] = r;
  return map;
}

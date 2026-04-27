import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";

export type MoatAssessment = {
  ticker: string;
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
  source_excerpt: string | null;
  last_10k_accession: string | null;
  last_10k_period_end: string | null;
  evaluated_at: string;
  evaluated_with_model: string;
};

const TTL_DAYS = 365;

export async function getMoatAssessment(
  ticker: string,
): Promise<MoatAssessment | null> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, strength, archetype, reasoning,
           source_excerpt, last_10k_accession, last_10k_period_end,
           evaluated_at, evaluated_with_model
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
  sourceExcerpt = null,
  last10kAccession = null,
  last10kPeriodEnd = null,
  model = "claude-sonnet-4-6",
}: {
  ticker: string;
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
  sourceExcerpt?: string | null;
  last10kAccession?: string | null;
  last10kPeriodEnd?: string | null;
  model?: string;
}): Promise<MoatAssessment> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    INSERT INTO moat_assessments (
      ticker, strength, archetype, reasoning,
      source_excerpt, last_10k_accession, last_10k_period_end,
      evaluated_with_model
    )
    VALUES (
      ${canonical}, ${strength}, ${archetype}, ${reasoning},
      ${sourceExcerpt}, ${last10kAccession}, ${last10kPeriodEnd},
      ${model}
    )
    ON CONFLICT (ticker) DO UPDATE
      SET strength = EXCLUDED.strength,
          archetype = EXCLUDED.archetype,
          reasoning = EXCLUDED.reasoning,
          source_excerpt = EXCLUDED.source_excerpt,
          last_10k_accession = EXCLUDED.last_10k_accession,
          last_10k_period_end = EXCLUDED.last_10k_period_end,
          evaluated_at = NOW(),
          evaluated_with_model = EXCLUDED.evaluated_with_model
    RETURNING ticker, strength, archetype, reasoning,
              source_excerpt, last_10k_accession, last_10k_period_end,
              evaluated_at, evaluated_with_model
  `) as unknown as MoatAssessment[];
  return rows[0];
}

// A moat is stale when any of these conditions hold:
//   1. It has no source_excerpt AND no last_10k_accession (legacy row,
//      written before the 10-K-grounded prompt was the default).
//   2. The latest 10-K accession on file for this ticker is newer than
//      the one this moat was evaluated against.
//   3. It is older than the TTL (defensive cap so even tickers with
//      no new filings get periodically refreshed).
//
// `latestAccession` should be the accession of the most recent 10-K the
// caller is aware of. Pass `null` to skip the accession check (e.g.
// when SEC fetch failed and we don't want to invalidate on uncertainty).
export function isMoatStale(
  assessment: MoatAssessment,
  latestAccession: string | null = null,
): boolean {
  if (!assessment.last_10k_accession && !assessment.source_excerpt) {
    return true;
  }
  if (
    latestAccession &&
    assessment.last_10k_accession &&
    assessment.last_10k_accession !== latestAccession
  ) {
    return true;
  }
  const evaluatedMs = new Date(assessment.evaluated_at).getTime();
  const ageDays = (Date.now() - evaluatedMs) / (1000 * 60 * 60 * 24);
  return ageDays > TTL_DAYS;
}

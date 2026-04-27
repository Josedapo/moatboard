import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";

export type RedFlagCategory =
  | "auditor"
  | "leadership"
  | "litigation"
  | "restructuring"
  | "going_concern"
  | "other";

// Severity is informational, not a gate:
//   · info   — worth knowing, not a blocker (e.g. routine auditor rotation)
//   · watch  — investigate before investing (material litigation, new CEO)
//   · serious — strong reason to stop (going-concern doubt, material weakness)
export type RedFlagSeverity = "info" | "watch" | "serious";

export type RedFlag = {
  category: RedFlagCategory;
  severity: RedFlagSeverity;
  summary: string;
  detail: string;
  // Populated when the flag was grounded in the real 10-K. Optional for
  // back-compat with rows generated before the 10-K ingestion work.
  source_excerpt?: string;
  source_item?: string; // e.g. "Item 1A", "Item 3", "Item 7"
};

export type QualitativeRedFlags = {
  ticker: string;
  flags: RedFlag[];
  last_10k_accession: string | null;
  last_10k_period_end: string | null; // YYYY-MM-DD
  generated_at: string;
  generated_with_model: string;
};

export async function getRedFlags(
  ticker: string,
): Promise<QualitativeRedFlags | null> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, flags, last_10k_accession,
           TO_CHAR(last_10k_period_end, 'YYYY-MM-DD') AS last_10k_period_end,
           generated_at, generated_with_model
    FROM qualitative_red_flags
    WHERE ticker = ${canonical}
    LIMIT 1
  `) as unknown as QualitativeRedFlags[];
  return rows[0] ?? null;
}

export async function saveRedFlags({
  ticker,
  flags,
  last10kAccession,
  last10kPeriodEnd,
  model = "claude-sonnet-4-6",
}: {
  ticker: string;
  flags: RedFlag[];
  last10kAccession?: string | null;
  last10kPeriodEnd?: string | null;
  model?: string;
}): Promise<QualitativeRedFlags> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    INSERT INTO qualitative_red_flags
      (ticker, flags, last_10k_accession, last_10k_period_end, generated_with_model)
    VALUES
      (${canonical}, ${JSON.stringify(flags)}::jsonb,
       ${last10kAccession ?? null}, ${last10kPeriodEnd ?? null}, ${model})
    ON CONFLICT (ticker) DO UPDATE
      SET flags = EXCLUDED.flags,
          last_10k_accession = EXCLUDED.last_10k_accession,
          last_10k_period_end = EXCLUDED.last_10k_period_end,
          generated_at = NOW(),
          generated_with_model = EXCLUDED.generated_with_model
    RETURNING ticker, flags, last_10k_accession,
              TO_CHAR(last_10k_period_end, 'YYYY-MM-DD') AS last_10k_period_end,
              generated_at, generated_with_model
  `) as unknown as QualitativeRedFlags[];
  return rows[0];
}

// Stale when the tracked 10-K accession differs from the latest one known
// to the caller. Caller provides the current latest accession from SEC —
// this helper only compares.
export function isRedFlagsStale(
  cached: QualitativeRedFlags,
  latest10kAccession: string | null,
): boolean {
  if (!latest10kAccession) return false;
  if (!cached.last_10k_accession) return true;
  return cached.last_10k_accession !== latest10kAccession;
}

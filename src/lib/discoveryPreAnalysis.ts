// CRUD + candidate filtering for the agentic Discovery pre-tiering.
//
// One row per ticker (global, not per-user). Status is one of:
//   - 'covered': full Quality + Moat + Red flags ran successfully
//   - 'not_covered': failed a coverage gate (SEC <5y, <2 funds in roster,
//     <5 applicable scorecard dimensions). Not retried until a manual
//     reset.
//   - 'pending': enqueued, not yet processed (mostly internal)
//   - 'error': last attempt threw; details in error_message
//
// The candidate query implements the B+C filter we agreed on:
//   B) SEC fundamentals ≥ 5 years (foreign filers and recent IPOs are
//      excluded — those need manual analysis)
//   C) Held by ≥ 2 distinct active Discovery funds (latest filing per
//      fund only — kicks single-fund noise)

import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import type { Tier, MoatStrength, MoatArchetype, ScorecardSummary } from "@/lib/verdict";

export type PreAnalysisStatus = "covered" | "not_covered" | "pending" | "error";

export type DiscoveryPreAnalysis = {
  ticker: string;
  status: PreAnalysisStatus;
  tier: Tier | null;
  applicable_dimensions: number | null;
  scorecard_summary: ScorecardSummary | null;
  moat_strength: MoatStrength | null;
  moat_archetype: MoatArchetype | null;
  has_serious_red_flags: boolean;
  serious_red_flags_count: number;
  watch_red_flags_count: number;
  last_10k_accession: string | null;
  last_10k_period_end: string | null;
  not_covered_reason: string | null;
  error_message: string | null;
  evaluated_at: string;
  evaluated_with_model: string | null;
};

const MIN_SEC_YEARS = 5;
const MIN_FUND_COUNT = 2;
const STALE_AFTER_DAYS = 30; // defensive cap for tickers without 10-K refresh

export type CandidateTicker = {
  ticker: string;
  fund_count: number;
  years_available: number;
  latest_10k_accession: string | null;
};

// All Discovery roster tickers that pass the B+C coverage gate. Ordered
// alphabetically for deterministic batches. Held by ≥ MIN_FUND_COUNT
// distinct active funds (latest filing each) AND have ≥ MIN_SEC_YEARS
// of SEC fundamentals successfully parsed.
export async function listCandidateTickers(): Promise<CandidateTicker[]> {
  const rows = (await sql`
    WITH latest_filing_per_fund AS (
      SELECT DISTINCT ON (fund_id) id, fund_id
      FROM discovery_filings
      ORDER BY fund_id, period_of_report DESC
    ),
    fund_coverage AS (
      SELECT dh.ticker, COUNT(DISTINCT df.fund_id) AS fund_count
      FROM discovery_holdings dh
      JOIN latest_filing_per_fund lfpf ON lfpf.id = dh.filing_id
      JOIN discovery_filings df ON df.id = lfpf.id
      JOIN discovery_funds dfu ON dfu.id = df.fund_id
      WHERE dh.ticker IS NOT NULL AND dfu.active = TRUE
      GROUP BY dh.ticker
      HAVING COUNT(DISTINCT df.fund_id) >= ${MIN_FUND_COUNT}
    )
    SELECT
      fc.ticker,
      fc.fund_count::int AS fund_count,
      sfc.years_available::int AS years_available,
      sfc.latest_quarter_accession AS latest_10k_accession
    FROM fund_coverage fc
    JOIN sec_fundamentals_cache sfc ON sfc.ticker = fc.ticker
    WHERE sfc.status = 'ok'
      AND sfc.years_available >= ${MIN_SEC_YEARS}
    ORDER BY fc.ticker
  `) as unknown as CandidateTicker[];
  return rows;
}

// Tickers held by ≥ 2 funds but without SEC coverage (or not in
// sec_fundamentals_cache at all). Useful to mark them not_covered in
// one pass so the agent doesn't keep retrying them every cron.
export async function listUncoveredCandidates(): Promise<
  Array<{ ticker: string; fund_count: number; reason: string }>
> {
  const rows = (await sql`
    WITH latest_filing_per_fund AS (
      SELECT DISTINCT ON (fund_id) id, fund_id
      FROM discovery_filings
      ORDER BY fund_id, period_of_report DESC
    ),
    fund_coverage AS (
      SELECT dh.ticker, COUNT(DISTINCT df.fund_id) AS fund_count
      FROM discovery_holdings dh
      JOIN latest_filing_per_fund lfpf ON lfpf.id = dh.filing_id
      JOIN discovery_filings df ON df.id = lfpf.id
      JOIN discovery_funds dfu ON dfu.id = df.fund_id
      WHERE dh.ticker IS NOT NULL AND dfu.active = TRUE
      GROUP BY dh.ticker
      HAVING COUNT(DISTINCT df.fund_id) >= ${MIN_FUND_COUNT}
    )
    SELECT
      fc.ticker,
      fc.fund_count::int AS fund_count,
      CASE
        WHEN sfc.ticker IS NULL THEN 'No SEC fundamentals cached'
        WHEN sfc.status <> 'ok' THEN 'SEC parse status: ' || sfc.status
        WHEN sfc.years_available < ${MIN_SEC_YEARS} THEN 'SEC <' || ${MIN_SEC_YEARS} || 'y of fundamentals (got ' || sfc.years_available || 'y)'
        ELSE 'unknown'
      END AS reason
    FROM fund_coverage fc
    LEFT JOIN sec_fundamentals_cache sfc ON sfc.ticker = fc.ticker
    WHERE sfc.ticker IS NULL OR sfc.status <> 'ok' OR sfc.years_available < ${MIN_SEC_YEARS}
    ORDER BY fc.ticker
  `) as unknown as Array<{ ticker: string; fund_count: number; reason: string }>;
  return rows;
}

export async function getPreAnalysis(
  ticker: string,
): Promise<DiscoveryPreAnalysis | null> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, status, tier, applicable_dimensions, scorecard_summary,
           moat_strength, moat_archetype,
           has_serious_red_flags, serious_red_flags_count, watch_red_flags_count,
           last_10k_accession, last_10k_period_end,
           not_covered_reason, error_message,
           evaluated_at, evaluated_with_model
    FROM discovery_pre_analyses
    WHERE ticker = ${canonical}
    LIMIT 1
  `) as unknown as DiscoveryPreAnalysis[];
  return rows[0] ?? null;
}

export async function listAllPreAnalyses(): Promise<DiscoveryPreAnalysis[]> {
  const rows = (await sql`
    SELECT ticker, status, tier, applicable_dimensions, scorecard_summary,
           moat_strength, moat_archetype,
           has_serious_red_flags, serious_red_flags_count, watch_red_flags_count,
           last_10k_accession, last_10k_period_end,
           not_covered_reason, error_message,
           evaluated_at, evaluated_with_model
    FROM discovery_pre_analyses
    ORDER BY ticker
  `) as unknown as DiscoveryPreAnalysis[];
  return rows;
}

export type SaveCoveredInput = {
  ticker: string;
  tier: Tier;
  applicableDimensions: number;
  scorecardSummary: ScorecardSummary;
  moatStrength: MoatStrength;
  moatArchetype: MoatArchetype;
  hasSeriousRedFlags: boolean;
  seriousRedFlagsCount: number;
  watchRedFlagsCount: number;
  last10kAccession: string | null;
  last10kPeriodEnd: string | null;
  model: string;
};

export async function saveCoveredPreAnalysis(
  input: SaveCoveredInput,
): Promise<DiscoveryPreAnalysis> {
  const canonical = await getCanonicalTicker(input.ticker);
  const scorecard = JSON.stringify(input.scorecardSummary);
  const rows = (await sql`
    INSERT INTO discovery_pre_analyses (
      ticker, status, tier, applicable_dimensions, scorecard_summary,
      moat_strength, moat_archetype,
      has_serious_red_flags, serious_red_flags_count, watch_red_flags_count,
      last_10k_accession, last_10k_period_end,
      not_covered_reason, error_message,
      evaluated_at, evaluated_with_model
    ) VALUES (
      ${canonical}, 'covered', ${input.tier}, ${input.applicableDimensions}, ${scorecard}::jsonb,
      ${input.moatStrength}, ${input.moatArchetype},
      ${input.hasSeriousRedFlags}, ${input.seriousRedFlagsCount}, ${input.watchRedFlagsCount},
      ${input.last10kAccession}, ${input.last10kPeriodEnd},
      NULL, NULL,
      NOW(), ${input.model}
    )
    ON CONFLICT (ticker) DO UPDATE SET
      status = 'covered',
      tier = EXCLUDED.tier,
      applicable_dimensions = EXCLUDED.applicable_dimensions,
      scorecard_summary = EXCLUDED.scorecard_summary,
      moat_strength = EXCLUDED.moat_strength,
      moat_archetype = EXCLUDED.moat_archetype,
      has_serious_red_flags = EXCLUDED.has_serious_red_flags,
      serious_red_flags_count = EXCLUDED.serious_red_flags_count,
      watch_red_flags_count = EXCLUDED.watch_red_flags_count,
      last_10k_accession = EXCLUDED.last_10k_accession,
      last_10k_period_end = EXCLUDED.last_10k_period_end,
      not_covered_reason = NULL,
      error_message = NULL,
      evaluated_at = NOW(),
      evaluated_with_model = EXCLUDED.evaluated_with_model
    RETURNING ticker, status, tier, applicable_dimensions, scorecard_summary,
              moat_strength, moat_archetype,
              has_serious_red_flags, serious_red_flags_count, watch_red_flags_count,
              last_10k_accession, last_10k_period_end,
              not_covered_reason, error_message,
              evaluated_at, evaluated_with_model
  `) as unknown as DiscoveryPreAnalysis[];
  return rows[0];
}

export async function markNotCovered(
  ticker: string,
  reason: string,
): Promise<void> {
  const canonical = await getCanonicalTicker(ticker);
  await sql`
    INSERT INTO discovery_pre_analyses (ticker, status, not_covered_reason)
    VALUES (${canonical}, 'not_covered', ${reason})
    ON CONFLICT (ticker) DO UPDATE SET
      status = 'not_covered',
      not_covered_reason = EXCLUDED.not_covered_reason,
      error_message = NULL,
      evaluated_at = NOW()
  `;
}

export async function markError(
  ticker: string,
  message: string,
): Promise<void> {
  const canonical = await getCanonicalTicker(ticker);
  // Truncate to fit VARCHAR(500); raw error stack on stderr already.
  const safeMessage = message.slice(0, 480);
  await sql`
    INSERT INTO discovery_pre_analyses (ticker, status, error_message)
    VALUES (${canonical}, 'error', ${safeMessage})
    ON CONFLICT (ticker) DO UPDATE SET
      status = 'error',
      error_message = EXCLUDED.error_message,
      evaluated_at = NOW()
  `;
}

export type WorkItem = {
  ticker: string;
  reason: "missing" | "10k_changed" | "ttl_stale" | "retry_error";
  fund_count: number;
  years_available: number;
  cached_accession: string | null;
  latest_10k_accession: string | null;
};

// What the job should process this run. Returns covered candidates
// where any of:
//   - missing: no pre-analysis row yet
//   - 10k_changed: SEC has a newer 10-K accession than what we evaluated
//   - ttl_stale: defensive refresh after STALE_AFTER_DAYS
//   - retry_error: previous attempt errored, retry once (cron-budget
//     permitting)
//
// not_covered rows are skipped — they were already evaluated against
// the gate and re-running won't help until something upstream changes
// (SEC catches up, fund count rises). Manual reset clears them.
export async function listWorkItems(): Promise<WorkItem[]> {
  const rows = (await sql`
    WITH latest_filing_per_fund AS (
      SELECT DISTINCT ON (fund_id) id, fund_id
      FROM discovery_filings
      ORDER BY fund_id, period_of_report DESC
    ),
    fund_coverage AS (
      SELECT dh.ticker, COUNT(DISTINCT df.fund_id) AS fund_count
      FROM discovery_holdings dh
      JOIN latest_filing_per_fund lfpf ON lfpf.id = dh.filing_id
      JOIN discovery_filings df ON df.id = lfpf.id
      JOIN discovery_funds dfu ON dfu.id = df.fund_id
      WHERE dh.ticker IS NOT NULL AND dfu.active = TRUE
      GROUP BY dh.ticker
      HAVING COUNT(DISTINCT df.fund_id) >= ${MIN_FUND_COUNT}
    ),
    candidates AS (
      SELECT
        fc.ticker,
        fc.fund_count::int AS fund_count,
        sfc.years_available::int AS years_available,
        sfc.latest_quarter_accession AS latest_10k_accession
      FROM fund_coverage fc
      JOIN sec_fundamentals_cache sfc ON sfc.ticker = fc.ticker
      WHERE sfc.status = 'ok' AND sfc.years_available >= ${MIN_SEC_YEARS}
    )
    SELECT
      c.ticker,
      c.fund_count,
      c.years_available,
      dpa.last_10k_accession AS cached_accession,
      c.latest_10k_accession,
      CASE
        WHEN dpa.ticker IS NULL THEN 'missing'
        WHEN dpa.status = 'error' THEN 'retry_error'
        WHEN dpa.last_10k_accession IS DISTINCT FROM c.latest_10k_accession THEN '10k_changed'
        WHEN dpa.evaluated_at < NOW() - (${STALE_AFTER_DAYS}::int || ' days')::interval THEN 'ttl_stale'
        ELSE NULL
      END AS reason
    FROM candidates c
    LEFT JOIN discovery_pre_analyses dpa ON dpa.ticker = c.ticker
    WHERE
      dpa.ticker IS NULL
      OR dpa.status = 'error'
      OR dpa.last_10k_accession IS DISTINCT FROM c.latest_10k_accession
      OR dpa.evaluated_at < NOW() - (${STALE_AFTER_DAYS}::int || ' days')::interval
    ORDER BY c.ticker
  `) as unknown as WorkItem[];
  return rows;
}

import { sql } from "@/lib/db";
import type { Tier, ScorecardSummary } from "@/lib/verdict";
import type { ValuationMethod } from "@/lib/valuations";
import type {
  FundamentalsSnapshot,
  MoatSnapshot,
  SnapshotTrigger,
} from "@/lib/snapshotDiff";

// Types + the pure diff function live in `snapshotDiff.ts` (no DB dep) so
// Client Components can consume them without bundling the Neon driver.
// Re-export here so existing Server-side callers keep working unchanged.
export type {
  FundamentalsSnapshot,
  MoatSnapshot,
  SnapshotTrigger,
} from "@/lib/snapshotDiff";
export { diffSnapshots } from "@/lib/snapshotDiff";
export type { SnapshotDiff } from "@/lib/snapshotDiff";

export type CreateSnapshotInput = {
  userId: string | number;
  ticker: string;
  positionId?: number | null;
  transactionId?: number | null;
  trigger: SnapshotTrigger;
  secFilingAccession?: string | null;
  currentPrice?: number | null;
  tier: Tier | null;
  scorecardSummary: ScorecardSummary;
  multiYear?: unknown;
  moat?: MoatSnapshot | null;
  valuationMethod?: ValuationMethod | null;
  valuationIntrinsicValue?: number | null;
  valuationIntrinsicValueLow?: number | null;
  valuationIntrinsicValueHigh?: number | null;
  valuationMarginOfSafetyPct?: number | null;
  valuationAssumptions?: unknown;
  valuationGuide?: unknown;
  businessUnderstandingVersion?: number | null;
  thesisSnapshot?: unknown;
};

export async function createSnapshot(
  input: CreateSnapshotInput,
): Promise<FundamentalsSnapshot> {
  const rows = (await sql`
    INSERT INTO fundamentals_snapshots (
      user_id, ticker, position_id, transaction_id, trigger,
      sec_filing_accession, current_price, tier,
      scorecard_summary, multi_year, moat,
      valuation_method, valuation_intrinsic_value, valuation_intrinsic_value_low,
      valuation_intrinsic_value_high, valuation_margin_of_safety_pct,
      valuation_assumptions, valuation_guide,
      business_understanding_version, thesis_snapshot
    ) VALUES (
      ${input.userId},
      ${input.ticker.toUpperCase()},
      ${input.positionId ?? null},
      ${input.transactionId ?? null},
      ${input.trigger},
      ${input.secFilingAccession ?? null},
      ${input.currentPrice ?? null},
      ${input.tier ?? null},
      ${JSON.stringify(input.scorecardSummary)}::jsonb,
      ${input.multiYear ? JSON.stringify(input.multiYear) : null}::jsonb,
      ${input.moat ? JSON.stringify(input.moat) : null}::jsonb,
      ${input.valuationMethod ?? null},
      ${input.valuationIntrinsicValue ?? null},
      ${input.valuationIntrinsicValueLow ?? null},
      ${input.valuationIntrinsicValueHigh ?? null},
      ${input.valuationMarginOfSafetyPct ?? null},
      ${input.valuationAssumptions ? JSON.stringify(input.valuationAssumptions) : null}::jsonb,
      ${input.valuationGuide ? JSON.stringify(input.valuationGuide) : null}::jsonb,
      ${input.businessUnderstandingVersion ?? null},
      ${input.thesisSnapshot ? JSON.stringify(input.thesisSnapshot) : null}::jsonb
    )
    RETURNING
      id, user_id, ticker, position_id, transaction_id, trigger,
      sec_filing_accession, taken_at, current_price, tier,
      scorecard_summary, multi_year, moat,
      valuation_method, valuation_intrinsic_value, valuation_intrinsic_value_low,
      valuation_intrinsic_value_high, valuation_margin_of_safety_pct,
      valuation_assumptions, valuation_guide,
      business_understanding_version, thesis_snapshot, created_at
  `) as unknown as FundamentalsSnapshot[];
  return rows[0];
}

export async function listSnapshotsForPosition(
  positionId: number,
): Promise<FundamentalsSnapshot[]> {
  const rows = (await sql`
    SELECT id, user_id, ticker, position_id, transaction_id, trigger,
           sec_filing_accession, taken_at, current_price, tier,
           scorecard_summary, multi_year, moat,
           valuation_method, valuation_intrinsic_value, valuation_intrinsic_value_low,
           valuation_intrinsic_value_high, valuation_margin_of_safety_pct,
           valuation_assumptions, valuation_guide,
           business_understanding_version, thesis_snapshot, created_at
    FROM fundamentals_snapshots
    WHERE position_id = ${positionId}
    ORDER BY taken_at ASC, id ASC
  `) as unknown as FundamentalsSnapshot[];
  return rows;
}

export async function listSnapshotsForTicker({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<FundamentalsSnapshot[]> {
  const rows = (await sql`
    SELECT id, user_id, ticker, position_id, transaction_id, trigger,
           sec_filing_accession, taken_at, current_price, tier,
           scorecard_summary, multi_year, moat,
           valuation_method, valuation_intrinsic_value, valuation_intrinsic_value_low,
           valuation_intrinsic_value_high, valuation_margin_of_safety_pct,
           valuation_assumptions, valuation_guide,
           business_understanding_version, thesis_snapshot, created_at
    FROM fundamentals_snapshots
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    ORDER BY taken_at ASC, id ASC
  `) as unknown as FundamentalsSnapshot[];
  return rows;
}

export async function getLatestSnapshot({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<FundamentalsSnapshot | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, position_id, transaction_id, trigger,
           sec_filing_accession, taken_at, current_price, tier,
           scorecard_summary, multi_year, moat,
           valuation_method, valuation_intrinsic_value, valuation_intrinsic_value_low,
           valuation_intrinsic_value_high, valuation_margin_of_safety_pct,
           valuation_assumptions, valuation_guide,
           business_understanding_version, thesis_snapshot, created_at
    FROM fundamentals_snapshots
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    ORDER BY taken_at DESC, id DESC
    LIMIT 1
  `) as unknown as FundamentalsSnapshot[];
  return rows[0] ?? null;
}

// Returns the snapshot for a given filing if one already exists — used to
// short-circuit `ensureQuarterlySnapshots` so we don't re-create the same
// snapshot on every page load.
export async function getSnapshotByFiling({
  userId,
  ticker,
  accession,
}: {
  userId: string | number;
  ticker: string;
  accession: string;
}): Promise<FundamentalsSnapshot | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, position_id, transaction_id, trigger,
           sec_filing_accession, taken_at, current_price, tier,
           scorecard_summary, multi_year, moat,
           valuation_method, valuation_intrinsic_value, valuation_intrinsic_value_low,
           valuation_intrinsic_value_high, valuation_margin_of_safety_pct,
           valuation_assumptions, valuation_guide,
           business_understanding_version, thesis_snapshot, created_at
    FROM fundamentals_snapshots
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
      AND sec_filing_accession = ${accession}
    LIMIT 1
  `) as unknown as FundamentalsSnapshot[];
  return rows[0] ?? null;
}


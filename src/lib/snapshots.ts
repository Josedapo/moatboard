import { sql } from "@/lib/db";
import type {
  Tier,
  MoatStrength,
  MoatArchetype,
  ScorecardSummary,
} from "@/lib/verdict";
import type { ValuationMethod } from "@/lib/valuations";

export type SnapshotTrigger = "transaction" | "quarterly_10q" | "annual_10k";

export type MoatSnapshot = {
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
};

// The frozen frame. JSONB fields (multi_year, valuation_assumptions, etc.)
// intentionally typed as `unknown` — snapshots are immutable and their shape
// may differ from what callers expect years from now if the live models evolve.
// The caller that reads a snapshot is responsible for narrowing.
export type FundamentalsSnapshot = {
  id: number;
  user_id: number;
  ticker: string;
  position_id: number | null;
  transaction_id: number | null;
  trigger: SnapshotTrigger;
  sec_filing_accession: string | null;
  taken_at: string;
  current_price: string | null;
  tier: Tier | null;
  scorecard_summary: ScorecardSummary;
  multi_year: unknown | null;
  moat: MoatSnapshot | null;
  valuation_method: ValuationMethod | null;
  valuation_intrinsic_value: string | null;
  valuation_intrinsic_value_low: string | null;
  valuation_intrinsic_value_high: string | null;
  valuation_margin_of_safety_pct: string | null;
  valuation_assumptions: unknown | null;
  valuation_guide: unknown | null;
  business_understanding_version: number | null;
  thesis_snapshot: unknown | null;
  created_at: string;
};

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

// Structured diff between two snapshots, for the "compare to previous" UI
// (ampliación) and for delta alerts in monthly review. Kept lightweight —
// returns only the fields that a human would read at a glance.
export type SnapshotDiff = {
  takenAt: { before: string; after: string };
  tier: { before: Tier | null; after: Tier | null; changed: boolean };
  moat: {
    strength: { before: MoatStrength | null; after: MoatStrength | null; changed: boolean };
    archetype: { before: MoatArchetype | null; after: MoatArchetype | null; changed: boolean };
  };
  price: { before: number | null; after: number | null; pct_change: number | null };
  intrinsicValue: { before: number | null; after: number | null; pct_change: number | null };
  marginOfSafety: { before: number | null; after: number | null; delta_pp: number | null };
};

export function diffSnapshots(
  before: FundamentalsSnapshot,
  after: FundamentalsSnapshot,
): SnapshotDiff {
  const priceBefore = before.current_price != null ? Number(before.current_price) : null;
  const priceAfter = after.current_price != null ? Number(after.current_price) : null;
  const ivBefore =
    before.valuation_intrinsic_value != null ? Number(before.valuation_intrinsic_value) : null;
  const ivAfter =
    after.valuation_intrinsic_value != null ? Number(after.valuation_intrinsic_value) : null;
  const mosBefore =
    before.valuation_margin_of_safety_pct != null
      ? Number(before.valuation_margin_of_safety_pct)
      : null;
  const mosAfter =
    after.valuation_margin_of_safety_pct != null
      ? Number(after.valuation_margin_of_safety_pct)
      : null;

  return {
    takenAt: { before: before.taken_at, after: after.taken_at },
    tier: {
      before: before.tier,
      after: after.tier,
      changed: before.tier !== after.tier,
    },
    moat: {
      strength: {
        before: before.moat?.strength ?? null,
        after: after.moat?.strength ?? null,
        changed: (before.moat?.strength ?? null) !== (after.moat?.strength ?? null),
      },
      archetype: {
        before: before.moat?.archetype ?? null,
        after: after.moat?.archetype ?? null,
        changed: (before.moat?.archetype ?? null) !== (after.moat?.archetype ?? null),
      },
    },
    price: {
      before: priceBefore,
      after: priceAfter,
      pct_change:
        priceBefore && priceAfter && priceBefore !== 0
          ? ((priceAfter - priceBefore) / priceBefore) * 100
          : null,
    },
    intrinsicValue: {
      before: ivBefore,
      after: ivAfter,
      pct_change:
        ivBefore && ivAfter && ivBefore !== 0 ? ((ivAfter - ivBefore) / ivBefore) * 100 : null,
    },
    marginOfSafety: {
      before: mosBefore,
      after: mosAfter,
      delta_pp: mosBefore != null && mosAfter != null ? mosAfter - mosBefore : null,
    },
  };
}

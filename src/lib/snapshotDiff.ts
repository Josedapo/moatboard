import type {
  Tier,
  MoatStrength,
  MoatArchetype,
  ScorecardSummary,
} from "@/lib/verdict";
import type { ValuationMethod } from "@/lib/valuations";

// Pure module: types + diffSnapshots, zero DB dependency. Lives apart from
// `snapshots.ts` (which imports `sql`) so Client Components can pull the
// diff without bundling the Neon driver.

export type SnapshotTrigger = "transaction" | "quarterly_10q" | "annual_10k";

export type MoatSnapshot = {
  strength: MoatStrength;
  archetype: MoatArchetype;
  reasoning: string;
};

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

export type SnapshotDiff = {
  takenAt: { before: string; after: string };
  tier: { before: Tier | null; after: Tier | null; changed: boolean };
  moat: {
    strength: {
      before: MoatStrength | null;
      after: MoatStrength | null;
      changed: boolean;
    };
    archetype: {
      before: MoatArchetype | null;
      after: MoatArchetype | null;
      changed: boolean;
    };
  };
  price: { before: number | null; after: number | null; pct_change: number | null };
  intrinsicValue: {
    before: number | null;
    after: number | null;
    pct_change: number | null;
  };
  marginOfSafety: {
    before: number | null;
    after: number | null;
    delta_pp: number | null;
  };
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

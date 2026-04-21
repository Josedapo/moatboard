import type {
  Tier,
  MoatStrength,
  MoatArchetype,
  ScorecardSummary,
} from "@/lib/verdict";
import type { ValuationMethod } from "@/lib/valuations";
import type { Quality } from "@/lib/scorecard";

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

// ─────────────────────────────────────────────────────────────────────────
// Material-change detection — the "delta alerts" layer.
//
// Fired when a new quarterly snapshot crosses a threshold that Joseda (or
// any user) would want to revisit. Deliberately minimalista: any tier
// downgrade, gate activation, or per-dimension downgrade flips the
// signal. False positives are acceptable; missing a thesis-breaker is not.
// ─────────────────────────────────────────────────────────────────────────

// Ordered from best to worst. Numeric value = rank used for comparisons.
const TIER_RANK: Record<Tier, number> = {
  exceptional: 4,
  good: 3,
  mediocre: 2,
  poor: 1,
};

const QUALITY_RANK: Record<Quality, number> = {
  strong: 3,
  acceptable: 2,
  weak: 1,
  neutral: 0,
};

// Minimum applicable dimensions required before the framework is willing
// to publish a verdict. Mirrors the gate in dashboard/position/[id]/page.
const MIN_APPLICABLE_DIMENSIONS = 5;

export type DimensionKey = keyof ScorecardSummary["dimensions"];

export type DimensionDrop = {
  dimension: DimensionKey;
  before: Quality;
  after: Quality;
  levels: number;
};

export type MaterialChanges = {
  tier: {
    before: Tier | null;
    after: Tier | null;
    levelsDropped: number; // 0 if no drop
  };
  gate: {
    applicableBefore: number;
    applicableAfter: number;
    activated: boolean; // wasn't outside framework, now is
  };
  dimensionDrops: DimensionDrop[];
};

export function detectMaterialChanges(
  before: FundamentalsSnapshot,
  after: FundamentalsSnapshot,
): MaterialChanges {
  const beforeRank = before.tier ? TIER_RANK[before.tier] : null;
  const afterRank = after.tier ? TIER_RANK[after.tier] : null;
  const tierLevelsDropped =
    beforeRank !== null && afterRank !== null && beforeRank > afterRank
      ? beforeRank - afterRank
      : 0;

  const beforeApplicable = countApplicable(before.scorecard_summary);
  const afterApplicable = countApplicable(after.scorecard_summary);
  const gateBefore = beforeApplicable < MIN_APPLICABLE_DIMENSIONS;
  const gateAfter = afterApplicable < MIN_APPLICABLE_DIMENSIONS;

  const dimensionDrops: DimensionDrop[] = [];
  const beforeDims = before.scorecard_summary.dimensions;
  const afterDims = after.scorecard_summary.dimensions;
  for (const key of Object.keys(beforeDims) as DimensionKey[]) {
    const b = beforeDims[key];
    const a = afterDims[key];
    // Only count drops between scored qualities. Transitions to/from
    // neutral mean "not applicable" — that's a coverage change, not a
    // deterioration, and we don't want to page Joseda over data drift.
    if (b === "neutral" || a === "neutral") continue;
    const bRank = QUALITY_RANK[b];
    const aRank = QUALITY_RANK[a];
    if (bRank > aRank) {
      dimensionDrops.push({
        dimension: key,
        before: b,
        after: a,
        levels: bRank - aRank,
      });
    }
  }

  return {
    tier: {
      before: before.tier,
      after: after.tier,
      levelsDropped: tierLevelsDropped,
    },
    gate: {
      applicableBefore: beforeApplicable,
      applicableAfter: afterApplicable,
      activated: !gateBefore && gateAfter,
    },
    dimensionDrops,
  };
}

// True when any rule fires — tier drop, gate activation, or any
// dimension downgrade. Caller uses this to decide whether to emit a
// review_signals row.
export function hasMaterialChange(changes: MaterialChanges): boolean {
  return (
    changes.tier.levelsDropped > 0 ||
    changes.gate.activated ||
    changes.dimensionDrops.length > 0
  );
}

// Severity mapping for the inbox. Tier drops and gate activation get
// the louder 'material' frame; dimension-only drops get the quieter
// 'informational' treatment so the inbox doesn't scream at every
// quarter.
export function severityFromChanges(
  changes: MaterialChanges,
): "material" | "informational" {
  if (changes.tier.levelsDropped > 0 || changes.gate.activated) {
    return "material";
  }
  return "informational";
}

function countApplicable(summary: ScorecardSummary): number {
  return summary.strong + summary.acceptable + summary.weak;
}

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

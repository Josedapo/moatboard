import Link from "next/link";
import type { FundamentalsSnapshot } from "@/lib/snapshots";
import type { Tier } from "@/lib/verdict";
import { diffSnapshots } from "@/lib/snapshots";

const TIER_LABEL: Record<Tier, string> = {
  exceptional: "Exceptional",
  good: "Good",
  mediocre: "Mediocre",
  poor: "Poor",
};

const TIER_RANK: Record<Tier, number> = {
  exceptional: 4,
  good: 3,
  mediocre: 2,
  poor: 1,
};

// Minimal trajectory rail. Renders below Valuation as a calm horizontal
// summary of "what changed since the last snapshot". Empty state when only
// one snapshot exists.
export default function SnapshotTrajectoryRail({
  positionId,
  snapshots,
  avgCost,
  currentPrice,
}: {
  positionId: number;
  snapshots: FundamentalsSnapshot[];
  avgCost: number | null;
  currentPrice: number | null;
}) {
  const total = snapshots.length;

  if (total === 0) return null;

  if (total === 1) {
    return (
      <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy-900">Trajectory</h3>
            <p className="mt-1 text-xs text-navy-500">
              Trajectory will appear after the next quarterly snapshot or your
              next buy.
            </p>
          </div>
          <span className="text-xs text-navy-400">1 snapshot taken</span>
        </div>
      </section>
    );
  }

  const previous = snapshots[snapshots.length - 2];
  const latest = snapshots[snapshots.length - 1];
  const diff = diffSnapshots(previous, latest);

  return (
    <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy-900">
          Since last snapshot
        </h3>
        <span className="text-xs text-navy-500">
          Last snapshot {formatDateOnly(latest.taken_at)} · {total} total ·{" "}
          <Link
            href={`/dashboard/position/${positionId}/trajectory`}
            className="font-medium text-navy-600 hover:text-navy-900"
          >
            View trajectory →
          </Link>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <TierPill before={diff.tier.before} after={diff.tier.after} />
        <IvPill
          before={diff.intrinsicValue.before}
          after={diff.intrinsicValue.after}
          pctChange={diff.intrinsicValue.pct_change}
        />
        <PriceVsCostPill avgCost={avgCost} currentPrice={currentPrice} />
      </div>
    </section>
  );
}

function TierPill({
  before,
  after,
}: {
  before: Tier | null;
  after: Tier | null;
}) {
  if (!after) return null;
  const changed = before !== null && before !== after;
  const arrow = !changed
    ? "→"
    : TIER_RANK[after] > TIER_RANK[before!]
      ? "↑"
      : "↓";
  const tone = !changed
    ? "border-navy-200 text-navy-700"
    : TIER_RANK[after] >= TIER_RANK[before!]
      ? "border-emerald-300 text-emerald-800"
      : "border-amber-300 text-amber-800";
  const label = before ? `${TIER_LABEL[before]} ${arrow} ${TIER_LABEL[after]}` : TIER_LABEL[after];
  return (
    <span
      className={`rounded-full border bg-white px-3 py-1 text-xs font-medium ${tone}`}
    >
      Tier · {label}
    </span>
  );
}

function IvPill({
  before,
  after,
  pctChange,
}: {
  before: number | null;
  after: number | null;
  pctChange: number | null;
}) {
  if (after === null) return null;
  const showChange = pctChange !== null && before !== null;
  const arrow =
    !showChange || pctChange === 0
      ? "→"
      : pctChange! > 0
        ? "↑"
        : "↓";
  const tone =
    !showChange || pctChange === 0
      ? "border-navy-200 text-navy-700"
      : pctChange! > 0
        ? "border-emerald-300 text-emerald-800"
        : "border-amber-300 text-amber-800";
  const body = showChange
    ? `$${before!.toFixed(2)} ${arrow} $${after.toFixed(2)} (${pctChange! >= 0 ? "+" : ""}${pctChange!.toFixed(1)}%)`
    : `$${after.toFixed(2)}`;
  return (
    <span
      className={`rounded-full border bg-white px-3 py-1 text-xs font-medium ${tone}`}
    >
      IV · {body}
    </span>
  );
}

function PriceVsCostPill({
  avgCost,
  currentPrice,
}: {
  avgCost: number | null;
  currentPrice: number | null;
}) {
  if (avgCost === null || currentPrice === null || avgCost === 0) return null;
  const pct = ((currentPrice - avgCost) / avgCost) * 100;
  const sign = pct >= 0 ? "+" : "";
  return (
    <span className="rounded-full border border-navy-200 bg-white px-3 py-1 text-xs font-medium text-navy-700">
      Price vs avg cost · {sign}
      {pct.toFixed(1)}%
    </span>
  );
}

function formatDateOnly(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toISOString().slice(0, 10);
  } catch {
    return typeof value === "string" ? value.slice(0, 10) : String(value);
  }
}

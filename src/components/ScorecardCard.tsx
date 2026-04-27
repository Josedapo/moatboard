import { type Quality, qualityStyles } from "@/lib/scorecard";

export default function ScorecardCard({
  label,
  value,
  hint,
  quality,
  compact = false,
  latestValue,
  median,
  higherIsBetter = true,
}: {
  label: string;
  value: string;
  hint?: string;
  quality: Quality;
  compact?: boolean;
  // Latest reported value (most recent year ratio, or YoY for CAGR
  // metrics) + the headline median/cagr — together they let the card
  // render a small triangulation hint so the reader can spot regime
  // change that the long-window aggregate hides.
  latestValue?: number | null;
  median?: number | null;
  // Polarity for the delta arrow color: true → higher is better
  // (default for most metrics). false for share count, AFFO payout,
  // Net Debt/EBITDA, Debt/Equity (lower is better).
  higherIsBetter?: boolean;
}) {
  const styles = qualityStyles(quality);

  if (compact) {
    return (
      <div
        className={`rounded-md border border-navy-100 border-l-2 bg-navy-50/40 px-3 py-2 ${styles.border}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[10px] font-medium uppercase tracking-wide text-navy-500">
            {label}
          </span>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-navy-900">
            {value}
          </span>
        </div>
        {hint && (
          <div className="mt-0.5 text-[10px] leading-tight text-navy-400">
            {hint}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col rounded-lg border border-navy-100 border-l-4 bg-white p-4 ${styles.border}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-navy-500">
          {label}
        </span>
        {styles.label && (
          <span className="flex flex-none items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
            <span className={`text-[10px] font-medium uppercase tracking-wide ${styles.labelColor}`}>
              {styles.label}
            </span>
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-2xl font-semibold text-navy-950">{value}</span>
        <LatestYearInline
          latestValue={latestValue}
          median={median}
          higherIsBetter={higherIsBetter}
        />
      </div>
      {hint && <div className="mt-auto pt-1 text-xs text-navy-500">{hint}</div>}
    </div>
  );
}

// Triangulation hint rendered inline next to the headline value. Shows
// the most recent year's value (in muted small text) followed by an
// arrow when the gap to the headline is meaningful (|delta| ≥ 1pp).
// Polarity-aware color (emerald = "good direction", amber = "bad
// direction") — no red per anti-trading principle.
//
// Compact-by-design: no "Último año:" label, no YoY suffix, no explicit
// pp delta. The user sees both the headline and the latest value side
// by side; the gap is visually obvious. The arrow signals direction.
function LatestYearInline({
  latestValue,
  median,
  higherIsBetter,
}: {
  latestValue: number | null | undefined;
  median: number | null | undefined;
  higherIsBetter: boolean;
}) {
  if (
    latestValue === null ||
    latestValue === undefined ||
    !Number.isFinite(latestValue)
  ) {
    return null;
  }
  const valueStr = `${(latestValue * 100).toFixed(1)}%`;
  const hasDelta =
    median !== null && median !== undefined && Number.isFinite(median);
  const delta = hasDelta ? latestValue - (median as number) : 0;
  const meaningful = Math.abs(delta) >= 0.01;

  let arrow = "";
  let toneClass = "text-navy-500";
  if (meaningful) {
    const isImprovement = higherIsBetter ? delta > 0 : delta < 0;
    arrow = delta > 0 ? "↑" : "↓";
    toneClass = isImprovement ? "text-emerald-700" : "text-amber-700";
  }

  return (
    <span
      className={`text-xs tabular-nums ${toneClass}`}
      title={
        meaningful
          ? `Último año vs mediana 10y: ${delta > 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)}pp`
          : `Último año: ${valueStr}`
      }
    >
      {arrow} {valueStr}
    </span>
  );
}

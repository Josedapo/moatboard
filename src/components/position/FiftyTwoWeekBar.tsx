// Compact 52-week min/max bar with a current-price marker. Follows the same
// navy-neutral visual language as the IV / distribution bars in Valuation.tsx
// (no green/red, no verdict — temperature, not a call to action).

function formatRangePosition(
  current: number,
  low: number,
  high: number,
): string {
  if (current >= high) return "at 52w high";
  if (current <= low) return "at 52w low";
  const pctBelowHigh = ((high - current) / high) * 100;
  if (pctBelowHigh < 1) return "near 52w high";
  return `${pctBelowHigh.toFixed(0)}% below high`;
}

export default function FiftyTwoWeekBar({
  current,
  low,
  high,
}: {
  current: number;
  low: number;
  high: number;
}) {
  // Clamp the marker into [0, 100] so a freak quote outside the 52w range
  // (rare but possible after a sudden move) doesn't break the layout.
  const span = Math.max(high - low, high * 0.01);
  const pct = ((current - low) / span) * 100;
  const markerPct = Math.max(0, Math.min(100, pct));

  return (
    <div className="mt-3 sm:max-w-xs sm:ml-auto">
      <div className="mb-1 flex items-baseline justify-between text-[11px] font-semibold tabular-nums text-navy-600">
        <span>${low.toFixed(2)}</span>
        <span>${high.toFixed(2)}</span>
      </div>
      <div className="relative h-3">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-200" />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-blue-900"
          style={{ left: `${markerPct}%` }}
          aria-label={`current price $${current.toFixed(2)}`}
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[10px] font-medium uppercase tracking-wider text-navy-500">
        <span>52w low</span>
        <span>52w high</span>
      </div>
      <div className="mt-2 text-right text-[11px] text-navy-500">
        {formatRangePosition(current, low, high)}
      </div>
    </div>
  );
}

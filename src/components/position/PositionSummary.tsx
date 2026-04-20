// KPI strip for the Razonamiento tab. Surfaces the position state (shares,
// cost, value, P&L) so the user can see at a glance what they own. Color is
// reserved for the unrealized cell only — the rest is navy-neutral so the
// strip doesn't shout.

export default function PositionSummary({
  shares,
  avgCost,
  invested,
  currentPrice,
  ownedSince,
}: {
  shares: number;
  avgCost: number | null;
  invested: number;
  currentPrice: number | null;
  ownedSince: string | null;
}) {
  const currentValue =
    currentPrice !== null && shares > 0 ? currentPrice * shares : null;
  const unrealized =
    avgCost !== null && currentPrice !== null && shares > 0
      ? (currentPrice - avgCost) * shares
      : null;
  const unrealizedPct =
    avgCost !== null && currentPrice !== null && avgCost > 0
      ? ((currentPrice - avgCost) / avgCost) * 100
      : null;

  const positive = unrealized !== null && unrealized >= 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">
          Position
        </h3>
        {ownedSince && (
          <span className="text-xs text-navy-500">
            Owned since {ownedSince}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-navy-100 sm:grid-cols-5">
        <Cell label="Shares" value={formatShares(shares)} />
        <Cell label="Avg cost" value={avgCost !== null ? `$${avgCost.toFixed(2)}` : "—"} />
        <Cell label="Invested" value={`$${formatMoney(invested)}`} />
        <Cell
          label="Now"
          value={currentValue !== null ? `$${formatMoney(currentValue)}` : "—"}
        />
        <Cell
          label="Unrealized"
          value={
            unrealized !== null
              ? `${positive ? "+" : ""}$${formatMoney(Math.abs(unrealized))}`
              : "—"
          }
          sub={
            unrealizedPct !== null
              ? `${positive ? "+" : ""}${unrealizedPct.toFixed(1)}%`
              : null
          }
          tone={
            unrealized === null
              ? "neutral"
              : positive
                ? "positive"
                : "negative"
          }
        />
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: "neutral" | "positive" | "negative";
}) {
  const valueColor =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-red-600"
        : "text-navy-900";
  const subColor =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "negative"
        ? "text-red-500"
        : "text-navy-500";

  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-navy-500">
        {label}
      </div>
      <div className={`mt-1 text-base font-bold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-xs font-medium tabular-nums ${subColor}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

function formatShares(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// Small banner inside the position Overview tab showing the next
// expected earnings date for this specific ticker. Anticipation, not
// alert — the call to action lives elsewhere (floor banner when the
// 10-Q/10-K actually lands and goes unreviewed).
//
// Close horizons get a subtle amber accent so the user can mentally
// plan; the rest stays navy-neutral. If no date is published by
// yfinance, the card is not rendered (the caller handles the null
// prop). `daysAway` is computed by the caller because React 19's
// purity rule rejects `Date.now()` from server-component render.

export default function NextEarningsCard({
  earningsDate,
  daysAway,
  reportType,
}: {
  earningsDate: string; // ISO
  daysAway: number;
  // "10-K" / "10-Q" when inferable from the last annual filing the cron
  // has recorded, null when we have no history yet (a brand-new ticker
  // on the watchlist) — in that case we show only "Resultados".
  reportType?: "10-K" | "10-Q" | null;
}) {
  const close = daysAway >= 0 && daysAway <= 14;
  const frame = close
    ? "border-amber-200 bg-amber-50/40"
    : "border-navy-100 bg-navy-50/40";
  const labelClass = close ? "text-amber-800" : "text-navy-500";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-3 ${frame}`}
    >
      <div className="flex items-baseline gap-3">
        <span
          className={`text-[10px] font-semibold uppercase tracking-widest ${labelClass}`}
        >
          Próxima presentación
        </span>
        {reportType && (
          <span className="rounded-md border border-navy-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-700">
            {reportType}
          </span>
        )}
        <span className="text-sm font-semibold text-navy-900 tabular-nums">
          {formatDate(earningsDate)}
        </span>
      </div>
      <span className="text-xs text-navy-500">{relativeLabel(daysAway)}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function relativeLabel(days: number): string {
  if (days < 0) {
    const d = Math.abs(days);
    return `hace ${d} ${d === 1 ? "día" : "días"} · fecha estimada sin actualizar`;
  }
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days < 31) return `en ${days} días`;
  const months = Math.round(days / 30);
  return `en ${months} ${months === 1 ? "mes" : "meses"}`;
}

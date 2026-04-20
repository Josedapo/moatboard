import Link from "next/link";

// Upcoming earnings releases block for the dashboard. Anticipation, not
// alert — this is information ("in 12 days, V reports") not a call to
// action. One row per position in portfolio + watchlist, ordered by
// date asc. Tickers without a known earningsDate are not listed; the
// honest thing is absence, not a "—".
//
// Source: yfinance quoteSummary.calendarEvents.earnings.earningsDate[0].
// It's an estimate until the company confirms via 8-K Item 2.02; the
// confirmation, when it lands, comes through the review_signals cron.

export type UpcomingEarning = {
  ticker: string;
  companyName: string | null;
  positionId: number | null; // null for watchlist tickers (no ficha yet)
  earningsDate: string; // ISO
  daysAway: number;
};

export default function UpcomingEarnings({
  entries,
}: {
  entries: UpcomingEarning[];
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-navy-500">
        Próximas presentaciones
      </h2>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-navy-100 bg-navy-50/40 px-5 py-4 text-sm text-navy-600">
          Sin fechas confirmadas para tus tickers activos.
        </div>
      ) : (
        <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-100 bg-white">
          {entries.map((e) => (
            <li
              key={e.ticker}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded-md bg-navy-900 px-2 py-0.5 text-xs font-bold text-white">
                  {e.ticker}
                </span>
                {e.companyName && (
                  <span className="text-sm text-navy-700">{e.companyName}</span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm font-semibold text-navy-900 tabular-nums">
                    {formatDate(e.earningsDate)}
                  </div>
                  <div className="text-[11px] text-navy-500">
                    {relativeLabel(e.daysAway)}
                  </div>
                </div>
                {e.positionId !== null && (
                  <Link
                    href={`/dashboard/position/${e.positionId}`}
                    className="text-xs text-navy-500 hover:text-navy-900"
                  >
                    Ficha →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    return `hace ${d} ${d === 1 ? "día" : "días"}`;
  }
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days < 31) return `en ${days} días`;
  const months = Math.round(days / 30);
  return `en ${months} ${months === 1 ? "mes" : "meses"}`;
}

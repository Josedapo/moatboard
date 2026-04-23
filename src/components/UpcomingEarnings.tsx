import Link from "next/link";

// Upcoming earnings releases for the sidebar. Anticipation, not alert —
// this is information ("in 12 days, V reports") not a call to action.
// One row per position in portfolio + watchlist, ordered by date asc.
// Tickers without a known earningsDate are not listed; the honest
// thing is absence, not a "—".
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

// Editorial earnings list · design-system.md §4 / option-a v2.
// No card chrome, no rounded corners — a list of rows separated by
// rule-soft hairlines. Ticker in Fraunces, form tag in outlined caps,
// date + relative label right-aligned in italic meta.
export default function UpcomingEarnings({
  entries,
}: {
  entries: UpcomingEarning[];
}) {
  if (entries.length === 0) {
    return (
      <p className="font-display text-[13.5px] italic leading-[1.5] text-ink-70">
        Sin fechas confirmadas para tus tickers activos.
      </p>
    );
  }

  return (
    <ul className="m-0 list-none p-0">
      {entries.map((e) => {
        const row = (
          <span className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2.5 last:border-b-0">
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-display text-[16px]">{e.ticker}</span>
              <span className="font-sans text-[9px] font-medium uppercase tracking-[0.1em] text-ink-70 border border-rule rounded-[2px] px-1.5 py-[1px]">
                10-Q
              </span>
            </span>
            <span className="text-right tabular-nums">
              <span className="block text-[12px] text-ink">
                {formatDate(e.earningsDate)}
              </span>
              <span className="block text-[11px] text-ink-50 mt-0.5">
                {relativeLabel(e.daysAway)}
              </span>
            </span>
          </span>
        );
        return (
          <li key={e.ticker}>
            {e.positionId !== null ? (
              <Link
                href={`/dashboard/position/${e.positionId}`}
                className="block no-underline text-ink"
              >
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d
      .toLocaleDateString("es-ES", { day: "numeric", month: "short" })
      .replace(".", "");
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

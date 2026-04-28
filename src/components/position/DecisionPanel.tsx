// Decisión tab — post-2026-04-28 watchlist refactor.
//
// Before: 4 mutually-exclusive states (in_portfolio / watchlist /
// discarded / discovery) with 6 transition forms inline.
//
// After: cartera derives from positions (binary: owned / not), watchlist
// is an orthogonal toggle. The Decisión tab simply surfaces the three
// possible actions: Comprar (link to /dashboard/comprar/[ticker]),
// Watchlist toggle, Re-analizar. Sell is inline on Overview tab — not
// surfaced here.

import Link from "next/link";
import WatchlistStarToggle from "@/components/WatchlistStarToggle";

export default function DecisionPanel({
  ticker,
  isOwned,
  netShares,
  firstBuyDate,
  isOnWatchlist,
  hasAnalysis,
}: {
  ticker: string;
  isOwned: boolean;
  netShares: number;
  firstBuyDate: string | null;
  isOnWatchlist: boolean;
  hasAnalysis: boolean;
}) {
  return (
    <div className="space-y-6">
      <CurrentStateCard
        isOwned={isOwned}
        netShares={netShares}
        firstBuyDate={firstBuyDate}
        isOnWatchlist={isOnWatchlist}
      />

      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <h3 className="mb-1 text-base font-semibold text-navy-900">Acciones</h3>
        <p className="mb-4 text-xs text-navy-500">
          Cartera y watchlist son independientes — puedes tener una empresa
          en ambas a la vez (tenerla y vigilarla).
        </p>

        <div className="space-y-3">
          <Link
            href={`/dashboard/comprar/${ticker}`}
            className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm font-medium text-emerald-900 hover:bg-emerald-50"
          >
            <span>
              {isOwned ? "Añadir más acciones" : "Comprar acciones"}
            </span>
            <span className="text-emerald-500">→</span>
          </Link>

          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <WatchlistStarToggle
                ticker={ticker}
                isOnWatchlist={isOnWatchlist}
              />
              <span className="text-sm font-medium text-amber-900">
                {isOnWatchlist
                  ? "En tu watchlist"
                  : "Añadir a la watchlist"}
              </span>
            </div>
            <span className="text-xs text-amber-700/70">
              {isOnWatchlist ? "Pulsa la estrella para quitar" : "Pulsa la estrella para añadir"}
            </span>
          </div>

          {hasAnalysis && (
            <Link
              href={`/dashboard/analyze/${ticker}`}
              className="flex items-center justify-between rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-3 text-sm font-medium text-navy-800 hover:bg-navy-50"
            >
              <span>Re-analizar</span>
              <span className="text-navy-400">→</span>
            </Link>
          )}

          {!hasAnalysis && (
            <Link
              href={`/dashboard/analyze/${ticker}`}
              className="flex items-center justify-between rounded-xl border border-dashed border-navy-200 bg-navy-50/30 px-4 py-3 text-sm font-medium text-navy-800 hover:bg-navy-50"
            >
              <span>Empezar análisis</span>
              <span className="text-navy-400">→</span>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}

function CurrentStateCard({
  isOwned,
  netShares,
  firstBuyDate,
  isOnWatchlist,
}: {
  isOwned: boolean;
  netShares: number;
  firstBuyDate: string | null;
  isOnWatchlist: boolean;
}) {
  return (
    <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
        Estado actual
      </h3>
      <div className="flex flex-wrap gap-2">
        {isOwned ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
            En cartera
            {netShares > 0 && (
              <span className="text-emerald-700/80">
                · {formatShares(netShares)} acciones
              </span>
            )}
            {firstBuyDate && (
              <span className="text-emerald-700/80">
                · desde {formatDateEs(firstBuyDate)}
              </span>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-navy-200 bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700">
            Sin posición
          </span>
        )}
        {isOnWatchlist && (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            En watchlist
          </span>
        )}
      </div>
    </section>
  );
}

function formatDateEs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatShares(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return Math.round(value).toString();
  }
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

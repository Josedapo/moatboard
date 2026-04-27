"use client";

import { useTransition } from "react";
import { reanalyzeTickerAction } from "@/app/dashboard/actions";
import type { NewEntrant } from "@/lib/discoveryDelta";

const STATE_LABEL: Record<string, string> = {
  in_portfolio: "En cartera",
  watchlist: "Watchlist",
  discarded: "Descartada",
};

// Collapsible "new entrants" panel — tickers that appear in ≥5 curated
// funds this quarter and weren't held by any curated fund the quarter
// before. Intentionally below-the-fold and hidden when empty so the
// main leaderboard stays the default focus.
export default function DiscoveryNewEntrants({
  entrants,
  latestQuarter,
  priorQuarter,
}: {
  entrants: NewEntrant[];
  latestQuarter: string | null;
  priorQuarter: string | null;
}) {
  if (entrants.length === 0) return null;

  const latestLabel = latestQuarter ? formatQuarter(latestQuarter) : "último Q";
  const priorLabel = priorQuarter ? formatQuarter(priorQuarter) : "Q anterior";

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
      <details>
        <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm text-emerald-900 hover:text-emerald-700">
          <span className="font-semibold">
            Entrantes nuevos en ≥5 fondos — {latestLabel}
          </span>
          <span className="text-xs text-emerald-700">
            {entrants.length} {entrants.length === 1 ? "empresa" : "empresas"}
          </span>
        </summary>
        <p className="mt-2 text-xs text-emerald-800">
          Empresas que no existían en ningún fondo del roster en {priorLabel}{" "}
          y que aparecen en al menos 5 fondos en {latestLabel}. Buen punto de
          partida para buscar nombres con los que no estás familiarizado.
        </p>
        <ul className="mt-4 space-y-2">
          {entrants.map((e) => (
            <EntrantRow key={e.ticker} entrant={e} />
          ))}
        </ul>
      </details>
    </section>
  );
}

function EntrantRow({ entrant }: { entrant: NewEntrant }) {
  const stateLabel = entrant.ticker_state
    ? STATE_LABEL[entrant.ticker_state]
    : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-navy-900">
            {entrant.ticker}
          </span>
          <span className="truncate text-sm text-navy-700">
            {entrant.issuer_name}
          </span>
          {stateLabel && (
            <span className="inline-flex rounded-md bg-navy-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-600">
              {stateLabel}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-navy-500">
          {entrant.n_funds} fondos
          {entrant.tier_a_funds > 0 && (
            <> · {entrant.tier_a_funds} Tier A</>
          )}
          {entrant.tier_b_funds > 0 && (
            <> · {entrant.tier_b_funds} Tier B</>
          )}
          {" — "}
          <span className="truncate">{entrant.fund_names.join(", ")}</span>
        </div>
      </div>
      <AnalyzeButton ticker={entrant.ticker} />
    </li>
  );
}

function AnalyzeButton({ ticker }: { ticker: string }) {
  const [isPending, startTransition] = useTransition();
  const onClick = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("ticker", ticker);
      await reanalyzeTickerAction(fd);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="whitespace-nowrap rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:border-emerald-500 disabled:opacity-50"
    >
      {isPending ? "…" : "Analizar →"}
    </button>
  );
}

function formatQuarter(ymd: string): string {
  const [yStr, mStr] = ymd.split("-");
  const month = Number(mStr);
  const q =
    month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${q} ${yStr}`;
}

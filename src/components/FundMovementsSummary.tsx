"use client";

import { useTransition } from "react";
import { reanalyzeTickerAction } from "@/app/dashboard/actions";
import type { FundMovements, Movement } from "@/lib/discoveryFund";

const STATE_LABEL: Record<string, string> = {
  in_portfolio: "En cartera",
  watchlist: "Watchlist",
  discarded: "Descartada",
  outside_circle: "Fuera del círculo",
};

const CATEGORY_META: Record<
  Movement["category"],
  { title: string; frame: string; tag: string }
> = {
  new: {
    title: "Nuevas posiciones",
    frame: "border-emerald-200 bg-emerald-50/40",
    tag: "bg-emerald-100 text-emerald-800",
  },
  add: {
    title: "Aumentos",
    frame: "border-teal-200 bg-teal-50/40",
    tag: "bg-teal-100 text-teal-800",
  },
  trim: {
    title: "Recortes",
    frame: "border-amber-200 bg-amber-50/40",
    tag: "bg-amber-100 text-amber-800",
  },
  exit: {
    title: "Salidas",
    frame: "border-red-200 bg-red-50/40",
    tag: "bg-red-100 text-red-800",
  },
};

// Compact summary: headline counts per category, each a details/summary
// toggle that expands into a list of the actual tickers. Collapsed by
// default to keep the fund page calm; Joseda expands the ones he cares
// about.
export default function FundMovementsSummary({
  movements,
}: {
  movements: FundMovements;
}) {
  const totalChanges =
    movements.newPositions.length +
    movements.additions.length +
    movements.trims.length +
    movements.exits.length;

  if (totalChanges === 0) {
    return (
      <section className="rounded-2xl border border-navy-100 bg-white p-4 text-sm text-navy-600">
        Sin cambios materiales de posición entre{" "}
        {formatQuarter(movements.priorPeriod)} y{" "}
        {formatQuarter(movements.latestPeriod)} (umbral ±5% en número de
        acciones).
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-navy-100 bg-white p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">
          Movimientos {formatQuarter(movements.priorPeriod)} →{" "}
          {formatQuarter(movements.latestPeriod)}
        </h2>
        <p className="text-[11px] text-navy-500">
          Umbral ±5% en número de acciones sobre el trimestre anterior
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CategoryCard count={movements.newPositions.length} category="new" />
        <CategoryCard count={movements.additions.length} category="add" />
        <CategoryCard count={movements.trims.length} category="trim" />
        <CategoryCard count={movements.exits.length} category="exit" />
      </div>

      <div className="space-y-2">
        <MovementsList
          movements={movements.newPositions}
          category="new"
          emptyLabel="Sin nuevas posiciones"
        />
        <MovementsList
          movements={movements.additions}
          category="add"
          emptyLabel="Sin aumentos"
        />
        <MovementsList
          movements={movements.trims}
          category="trim"
          emptyLabel="Sin recortes"
        />
        <MovementsList
          movements={movements.exits}
          category="exit"
          emptyLabel="Sin salidas"
        />
      </div>
    </section>
  );
}

function CategoryCard({
  count,
  category,
}: {
  count: number;
  category: Movement["category"];
}) {
  const meta = CATEGORY_META[category];
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${meta.frame}`}
    >
      <div className="text-[11px] uppercase tracking-wider text-navy-500">
        {meta.title}
      </div>
      <div className="mt-0.5 text-xl font-bold text-navy-900">{count}</div>
    </div>
  );
}

function MovementsList({
  movements,
  category,
  emptyLabel,
}: {
  movements: Movement[];
  category: Movement["category"];
  emptyLabel: string;
}) {
  if (movements.length === 0) return null;
  const meta = CATEGORY_META[category];

  return (
    <details className="rounded-lg border border-navy-100 bg-white">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-navy-700 hover:text-navy-900">
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.tag}`}
        >
          {meta.title}
        </span>
        <span className="text-navy-500">
          {movements.length} {movements.length === 1 ? "empresa" : "empresas"}
        </span>
        <span className="ml-auto text-navy-400">▾</span>
      </summary>
      <ul className="border-t border-navy-100 divide-y divide-navy-50">
        {movements.map((m) => (
          <MovementRow key={m.cusip} movement={m} />
        ))}
      </ul>
      <span className="sr-only">{emptyLabel}</span>
    </details>
  );
}

function MovementRow({ movement }: { movement: Movement }) {
  const state = movement.ticker_state
    ? STATE_LABEL[movement.ticker_state]
    : null;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {movement.ticker ? (
            <span className="font-mono text-sm font-semibold text-navy-900">
              {movement.ticker}
            </span>
          ) : (
            <span className="font-mono text-xs text-navy-400">
              {movement.cusip}
            </span>
          )}
          <span className="truncate text-sm text-navy-700">
            {movement.issuer_name}
          </span>
          {state && (
            <span className="inline-flex rounded-md bg-navy-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-600">
              {state}
            </span>
          )}
        </div>
        <MovementDetail movement={movement} />
      </div>
      {movement.ticker && movement.category !== "exit" && (
        <AnalyzeButton ticker={movement.ticker} />
      )}
    </li>
  );
}

function MovementDetail({ movement }: { movement: Movement }) {
  if (movement.category === "new") {
    return (
      <div className="mt-0.5 text-[11px] text-navy-500">
        Nueva · ahora {movement.latest_weight.toFixed(2)}% del fondo
      </div>
    );
  }
  if (movement.category === "exit") {
    return (
      <div className="mt-0.5 text-[11px] text-navy-500">
        Salida completa · antes {movement.prior_weight.toFixed(2)}%
      </div>
    );
  }
  const arrow = movement.category === "add" ? "▲" : "▼";
  const pct =
    movement.shares_pct_change !== null
      ? `${arrow} ${Math.abs(movement.shares_pct_change).toFixed(1)}%`
      : arrow;
  return (
    <div className="mt-0.5 text-[11px] text-navy-500">
      {pct} acciones · peso {movement.prior_weight.toFixed(2)}% →{" "}
      {movement.latest_weight.toFixed(2)}%
    </div>
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
      className="whitespace-nowrap rounded-lg border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900 disabled:opacity-50"
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

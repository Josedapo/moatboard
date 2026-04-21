"use client";

import { useMemo, useState, useTransition } from "react";
import { reanalyzeTickerAction } from "@/app/dashboard/actions";
import type { FundHolding, HoldingMovement } from "@/lib/discoveryFund";

const STATE_STYLE: Record<string, { label: string; chip: string }> = {
  in_portfolio: {
    label: "En cartera",
    chip: "bg-emerald-100 text-emerald-800",
  },
  watchlist: { label: "Watchlist", chip: "bg-amber-100 text-amber-800" },
  discarded: { label: "Descartada", chip: "bg-navy-100 text-navy-600" },
  outside_circle: {
    label: "Fuera del círculo",
    chip: "bg-navy-100 text-navy-600",
  },
};

export default function FundHoldingsTable({
  holdings,
}: {
  holdings: FundHolding[];
}) {
  const [query, setQuery] = useState("");
  const [onlyAnalyzable, setOnlyAnalyzable] = useState(false);

  const unresolvedCount = useMemo(
    () => holdings.filter((h) => !h.ticker).length,
    [holdings],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return holdings.filter((h) => {
      if (onlyAnalyzable && !h.ticker) return false;
      if (!q) return true;
      return (
        (h.ticker ?? "").includes(q) ||
        h.issuer_name.toUpperCase().includes(q)
      );
    });
  }, [holdings, query, onlyAnalyzable]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">
          Posiciones ({holdings.length}) — ordenadas por peso
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {unresolvedCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyAnalyzable((v) => !v)}
              title={
                onlyAnalyzable
                  ? "Mostrando solo empresas con ticker US. Click para volver a ver todas."
                  : `${unresolvedCount} posición${unresolvedCount === 1 ? "" : "es"} sin ticker US (ADR foráneo, OTC, etc.). Click para ocultarlas.`
              }
              className={
                onlyAnalyzable
                  ? "rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-full border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
              }
            >
              Solo analizables
              <span
                className={
                  onlyAnalyzable
                    ? "ml-1.5 text-navy-200"
                    : "ml-1.5 text-navy-400"
                }
              >
                {holdings.length - unresolvedCount}
              </span>
            </button>
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar…"
            className="w-56 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs text-navy-800 placeholder-navy-400 focus:border-navy-400 focus:outline-none"
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-navy-100 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-navy-100 bg-navy-50 text-xs uppercase tracking-wider text-navy-600">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">#</th>
              <th className="px-4 py-3 text-left font-semibold">Ticker</th>
              <th className="px-4 py-3 text-left font-semibold">Empresa</th>
              <th className="px-4 py-3 text-center font-semibold">Mov.</th>
              <th className="px-4 py-3 text-right font-semibold">Peso</th>
              <th className="px-4 py-3 text-right font-semibold">Valor</th>
              <th className="px-4 py-3 text-left font-semibold">Estado</th>
              <th className="px-4 py-3 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-sm text-navy-500"
                >
                  Sin resultados.
                </td>
              </tr>
            )}
            {filtered.map((h, i) => (
              <HoldingRow key={`${h.cusip}-${i}`} holding={h} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldingRow({
  holding,
  rank,
}: {
  holding: FundHolding;
  rank: number;
}) {
  const state = holding.ticker_state
    ? STATE_STYLE[holding.ticker_state]
    : null;
  const dimmed = !holding.ticker || holding.ticker_state;
  const rowClass = dimmed
    ? "border-b border-navy-50 opacity-70 hover:bg-navy-50/40"
    : "border-b border-navy-50 hover:bg-navy-50/40";

  return (
    <tr className={rowClass}>
      <td className="px-4 py-3 text-xs text-navy-400">{rank}</td>
      <td className="px-4 py-3">
        {holding.ticker ? (
          <span className="font-mono text-sm font-semibold text-navy-900">
            {holding.ticker}
          </span>
        ) : (
          <span className="font-mono text-xs text-navy-400">
            {holding.cusip}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-navy-700">
        {holding.issuer_name}
      </td>
      <td className="px-4 py-3 text-center">
        <MovementBadge
          movement={holding.movement}
          pctChange={holding.shares_pct_change}
        />
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-navy-900">
        {holding.weight_in_fund.toFixed(2)}%
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-navy-700">
        ${formatBillions(holding.value_usd)}
      </td>
      <td className="px-4 py-3">
        {state ? (
          <span
            className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${state.chip}`}
          >
            {state.label}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-navy-400">
            Sin ver
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {holding.ticker ? <AnalyzeButton ticker={holding.ticker} /> : null}
      </td>
    </tr>
  );
}

// Compact per-row movement indicator. Emerald star = new entry this
// quarter, teal triangle up = added to (>5% shares), amber triangle
// down = trimmed (<-5% shares), muted dash = held within the
// threshold. Null when the fund has only one filing on record so no
// prior-quarter comparison exists.
function MovementBadge({
  movement,
  pctChange,
}: {
  movement: HoldingMovement;
  pctChange: number | null;
}) {
  if (movement === null) {
    return <span className="text-navy-300">—</span>;
  }
  if (movement === "new") {
    return (
      <span
        title="Nueva posición este trimestre"
        className="inline-flex items-center justify-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800"
      >
        NEW
      </span>
    );
  }
  if (movement === "held") {
    return (
      <span
        title="Sin cambio material (±5% en acciones)"
        aria-label="Mantenida"
        className="text-navy-400"
      >
        =
      </span>
    );
  }
  const pct =
    pctChange !== null ? `${Math.abs(pctChange).toFixed(1)}%` : "";
  if (movement === "add") {
    return (
      <span
        title={`Aumentada +${pct} en acciones`}
        className="inline-flex items-center gap-0.5 text-xs font-semibold text-teal-700"
      >
        <span aria-hidden>▲</span>
        <span className="font-mono text-[10px] tabular-nums">{pct}</span>
      </span>
    );
  }
  // trim
  return (
    <span
      title={`Recortada −${pct} en acciones`}
      className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-700"
    >
      <span aria-hidden>▼</span>
      <span className="font-mono text-[10px] tabular-nums">{pct}</span>
    </span>
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

function formatBillions(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString("en-US");
}

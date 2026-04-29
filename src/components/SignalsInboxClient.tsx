"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReviewSignal } from "@/lib/reviewSignals";
import SignalCard from "@/components/SignalCard";
import { markSignalsReviewedBatchAction } from "@/app/dashboard/actions";

// Flat chronological list (event_date DESC, already sorted server-side)
// with a per-ticker filter dropdown and a batch-action toolbar. The
// flat ordering matters: "what came in most recently" is more useful
// than "everything for ticker X" when triaging a daily inbox; the
// dropdown takes care of the per-ticker drill-down on demand.
export default function SignalsInboxClient({
  signals,
  positionIdByTicker,
}: {
  signals: ReviewSignal[];
  positionIdByTicker: Record<string, number | null>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  // "" = all tickers. Anything else is the actual ticker symbol.
  const [tickerFilter, setTickerFilter] = useState<string>("");

  // Per-ticker counts for the dropdown options ("GOOGL (3)") and to
  // sort the dropdown alphabetically. Built once per signals refresh.
  const tickerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of signals) m.set(s.ticker, (m.get(s.ticker) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [signals]);

  // After a batch-mark, the active ticker may no longer have any pending
  // signals (revalidatePath refetches, but the client-side filter state
  // persists across re-renders). When that happens, snap the filter
  // back to "Todas" so the user lands on the full list instead of an
  // empty state. Derived from tickerCounts so it fires every time the
  // signals prop changes.
  useEffect(() => {
    if (tickerFilter && !tickerCounts.some(([t]) => t === tickerFilter)) {
      setTickerFilter("");
    }
  }, [tickerFilter, tickerCounts]);

  const filtered = useMemo(
    () =>
      tickerFilter ? signals.filter((s) => s.ticker === tickerFilter) : signals,
    [signals, tickerFilter],
  );
  // "Select all" + the counter both operate on the visible (filtered)
  // set so the user always sees what they're acting on. Selection
  // resets on filter change to avoid the surprise of marking signals
  // they no longer have on screen.
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filtered.map((s) => s.id)));
  const deselectAll = () => setSelected(new Set());

  const onFilterChange = (value: string) => {
    setTickerFilter(value);
    setSelected(new Set());
  };

  const markBatch = () => {
    if (selected.size === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("signalIds", Array.from(selected).join(","));
      await markSignalsReviewedBatchAction(fd);
      setSelected(new Set());
    });
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-navy-100 bg-navy-50/50 px-3 py-2 text-xs text-navy-700">
        <button
          type="button"
          onClick={markBatch}
          disabled={selected.size === 0 || isPending}
          className="rounded-md bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending
            ? "Marcando…"
            : selected.size > 0
              ? `Marcar ${selected.size} revisada${selected.size === 1 ? "" : "s"}`
              : "Marcar revisadas"}
        </button>
        <span className="text-navy-600">
          <span className="font-semibold text-navy-900 tabular-nums">
            {selected.size}
          </span>
          <span className="text-navy-500"> / {filtered.length} seleccionadas</span>
        </span>
        <button
          type="button"
          onClick={allVisibleSelected ? deselectAll : selectAll}
          disabled={filtered.length === 0}
          className="rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[11px] font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900 disabled:opacity-40"
        >
          {allVisibleSelected ? "Deseleccionar todo" : "Seleccionar todo"}
        </button>
        <select
          value={tickerFilter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="ml-auto rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[11px] font-medium text-navy-700 hover:border-navy-400 focus:border-navy-400 focus:outline-none"
          aria-label="Filtrar por empresa"
        >
          <option value="">Todas las empresas ({signals.length})</option>
          {tickerCounts.map(([ticker, count]) => (
            <option key={ticker} value={ticker}>
              {ticker} ({count})
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-navy-200 bg-navy-50/30 p-6 text-center text-sm text-navy-500">
          Sin señales para {tickerFilter}.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <SignalCard
              key={s.id}
              signal={s}
              positionId={positionIdByTicker[s.ticker] ?? null}
              isSelected={selected.has(s.id)}
              onToggleSelected={toggle}
            />
          ))}
        </div>
      )}
    </>
  );
}

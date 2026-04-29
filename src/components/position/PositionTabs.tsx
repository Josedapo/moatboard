"use client";

import { useState } from "react";

export type PositionTabId =
  | "razonamiento"
  | "negocio"
  | "calidad"
  | "valoracion"
  | "presentaciones";

// The "razonamiento" id stays as-is internally to avoid rippling the
// rename through callers; only the user-facing label changes. Tab
// order after Overview mirrors the analysis wizard sequence
// (Calidad → Negocio → Valoración) so the ficha reads in the same
// flow the user just walked through. Señales es operacional, vive
// al final. The Decisión tab was retired 2026-04-29: comprar lives
// in the Cartera form (→ /comprar/[ticker]) and watchlist toggle is
// the star always-visible in the ficha header — both ya cubrían lo
// que la pestaña duplicaba. La entrada al wizard ("Empezar análisis"
// / "Re-analizar") se movió al action area de la cabecera.
const TABS: Array<{ id: PositionTabId; label: string }> = [
  { id: "razonamiento", label: "Overview" },
  { id: "calidad", label: "Calidad" },
  { id: "negocio", label: "Negocio" },
  { id: "valoracion", label: "Valoración" },
  { id: "presentaciones", label: "Señales" },
];

// Client tab shell. The five panels are server-rendered upstream and
// passed as a record; only the active panel is mounted in the DOM.
// Default active tab is "razonamiento" (anti-trading: re-anchor before
// re-litigating). Optional per-tab badge prop carries an integer badge
// (e.g. count of new signals for Presentaciones). `labelOverrides`
// lets callers rename a tab without touching the internal id — used by
// the watchlist ficha, which relabels the first tab "Observación"
// because it has no position to show "Overview" KPIs for.
export default function PositionTabs({
  panels,
  badges,
  labelOverrides,
}: {
  panels: Record<PositionTabId, React.ReactNode>;
  badges?: Partial<Record<PositionTabId, number>>;
  labelOverrides?: Partial<Record<PositionTabId, string>>;
}) {
  const [active, setActive] = useState<PositionTabId>("razonamiento");

  return (
    <>
      <div
        role="tablist"
        aria-label="Position sections"
        className="mb-6 flex flex-wrap gap-1 border-b border-navy-200"
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          const badge = badges?.[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={
                isActive
                  ? "-mb-px inline-flex items-center gap-1.5 border-b-2 border-navy-900 px-4 py-2.5 text-sm font-semibold text-navy-900"
                  : "-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-navy-500 hover:text-navy-900"
              }
            >
              <span>{labelOverrides?.[tab.id] ?? tab.label}</span>
              {badge !== undefined && badge > 0 && (
                <span
                  className={
                    isActive
                      ? "inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                      : "inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800"
                  }
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{panels[active]}</div>
    </>
  );
}

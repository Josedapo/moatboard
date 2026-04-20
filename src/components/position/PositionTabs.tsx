"use client";

import { useState } from "react";

export type PositionTabId =
  | "razonamiento"
  | "negocio"
  | "calidad"
  | "valoracion";

const TABS: Array<{ id: PositionTabId; label: string }> = [
  { id: "razonamiento", label: "Razonamiento" },
  { id: "negocio", label: "Negocio" },
  { id: "calidad", label: "Calidad" },
  { id: "valoracion", label: "Valoración" },
];

// Client tab shell. The four panels are server-rendered upstream and passed
// as a record; only the active panel is mounted in the DOM. Default active
// tab is "razonamiento" (anti-trading: re-anchor before re-litigating).
export default function PositionTabs({
  panels,
}: {
  panels: Record<PositionTabId, React.ReactNode>;
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
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={
                isActive
                  ? "-mb-px border-b-2 border-navy-900 px-4 py-2.5 text-sm font-semibold text-navy-900"
                  : "-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-navy-500 hover:text-navy-900"
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{panels[active]}</div>
    </>
  );
}

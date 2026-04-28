"use client";

// Iris's narrative action log with two tabs:
//   - "Tus tickers" (default) — pre-filtered server-side to actions
//     touching tickers the user has any relationship with, plus
//     system-wide rows (daily/weekly scan summaries).
//   - "Todo Moatboard" (opt-in) — the public feed across the entire
//     system, no per-user filter.
//
// Each row is one editorial-natural sentence in Spanish + relative
// timestamp. The action_type drives the icon/color accent so users
// can scan visually before reading.

import { useState } from "react";
import type { IrisAction, IrisActionType } from "@/lib/irisActions";

const ACTION_ACCENT: Record<IrisActionType, string> = {
  daily_sec_scan: "text-navy-600",
  weekly_13f_scan: "text-navy-600",
  tenk_refresh: "text-emerald-700",
  tenq_recompute: "text-teal-700",
  understanding_regen: "text-emerald-700",
  tier_propagated: "text-teal-700",
  snapshot_created: "text-navy-700",
  filing_detected: "text-amber-700",
};

const ACTION_LABEL: Record<IrisActionType, string> = {
  daily_sec_scan: "Escaneo diario",
  weekly_13f_scan: "Revisión semanal",
  tenk_refresh: "10-K",
  tenq_recompute: "10-Q",
  understanding_regen: "Resumen",
  tier_propagated: "Tier",
  snapshot_created: "Snapshot",
  filing_detected: "Filing",
};

export default function IrisActionLog({
  userActions,
  allActions,
}: {
  userActions: IrisAction[];
  allActions: IrisAction[];
}) {
  const [tab, setTab] = useState<"user" | "all">("user");
  const items = tab === "user" ? userActions : allActions;

  return (
    <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-navy-950">
            Lo que Iris ha hecho
          </h2>
          <p className="mt-1 text-sm text-navy-600">
            Bitácora pública. Cada filing leído, cada análisis refrescado, cada
            snapshot creado deja un rastro aquí.
          </p>
        </div>
      </header>

      <div className="mb-5 flex gap-1 border-b border-navy-100">
        <TabButton active={tab === "user"} onClick={() => setTab("user")}>
          Tus tickers
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          Todo Moatboard
        </TabButton>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-navy-200 bg-navy-50/40 p-6 text-center text-sm italic text-navy-600">
          {tab === "user"
            ? "Iris no ha registrado acciones todavía sobre tus tickers. Cuando llegue un filing nuevo de cualquiera de tus negocios aparecerá aquí."
            : "Aún no hay acciones registradas en el log. Aparecerán cuando se ejecute el próximo escaneo."}
        </p>
      ) : (
        <ol className="divide-y divide-navy-100">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-4 py-3">
              <div className="flex-shrink-0 pt-0.5">
                <span
                  className={`inline-block rounded-md border border-navy-100 bg-paper-sunk px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ACTION_ACCENT[a.action_type]}`}
                  style={{ background: "#f6f1e7" }}
                >
                  {ACTION_LABEL[a.action_type]}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-navy-800">
                  {a.narration_md}
                </p>
                <p className="mt-0.5 text-[11px] text-navy-500">
                  {humaniseRelative(a.occurred_at)}
                  {a.ticker && (
                    <>
                      {" · "}
                      <span className="font-medium text-navy-700">
                        {a.ticker}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-b-2 border-navy-900 text-navy-950"
          : "text-navy-500 hover:text-navy-700"
      }`}
    >
      {children}
    </button>
  );
}

function humaniseRelative(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - target;
  const minutes = Math.round(diffMs / (60 * 1000));

  if (minutes < 1) return "Justo ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `Hace ${days} ${days === 1 ? "día" : "días"}`;
  const weeks = Math.round(days / 7);
  return `Hace ${weeks} ${weeks === 1 ? "semana" : "semanas"}`;
}
